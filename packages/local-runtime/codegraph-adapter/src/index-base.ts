import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, constants as fsConstants, copyFileSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { CodeGraphBaseRefreshV1 } from "@archcontext/contracts";
import { codeGraphChildEnv } from "./child-env";
import { CODEGRAPH_SEED_PENDING_FILE, REQUIRED_CODEGRAPH_VERSION, codeGraphBundle, openCodeGraphReadSession, pidLockLive, withCodeGraphReadSession, type CodeGraphReadProvider } from "./read-session";

// The shared base index of one Git repository (#608). The primary checkout publishes a consistent
// snapshot of its own index after a successful sync; a linked worktree with no index of its own
// starts from a byte copy of it, and its own `codegraph sync` then reconciles the copy against the
// worktree. A worktree still reads only its own `.codegraph`, and a read never seeds.
//
// ADR-0002 / ADR-0058 exception: `snapshotCodeGraphIndex` is the only archctx code that opens
// `codegraph.db` as an SQLite file, read-only and only for `VACUUM INTO`. It reads no table and
// writes no row; facts are still read only through the provider's read-only handle.

export const CODEGRAPH_BASE_SCHEMA = "archcontext.codegraph-base/v1" as const;

/** `current.json`: the published base. `snapshot` names an immutable file beside it. */
export interface CodeGraphBasePointerV1 {
  schemaVersion: typeof CODEGRAPH_BASE_SCHEMA;
  codeGraphVersion: string;
  extractionVersion: number;
  /** The primary checkout's `HEAD` when the snapshot was taken, read by archctx, not the provider. */
  headSha: string;
  snapshot: string;
  createdAt: string;
}

/**
 * What the seed did. `present`: the worktree already has an index that is not an unverified seed.
 * `seeded`: the base was copied in (again, when an earlier seed's first sync never verified).
 * `no-base`: nothing is published. `base-building`: nothing is published and a refresh is running.
 * `refused`: `.codegraph` is a link or unreadable, or a provider build holds its lock; the caller's
 * own readiness check reports that state.
 */
export type CodeGraphSeedOutcomeV1 = "present" | "seeded" | "no-base" | "base-building" | "refused";

const SNAPSHOT_NAME = /^base-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.db$/;
/** An unreferenced snapshot younger than this may still be a refresher's staging file or a seeder's source. */
const SNAPSHOT_GC_AGE_MS = 10 * 60_000;

interface GitDirs {
  gitDir: string;
  commonDir: string;
}

/** The Git directories of `root`, only when `root` is the top level of a worktree. */
function gitDirs(root: string): GitDirs | undefined {
  let output: string;
  try {
    output = execFileSync("git", ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
  const [topLevel, gitDir, commonDir] = output.trim().split(/\r?\n/);
  if (!topLevel || !gitDir || !commonDir || realpathSync.native(topLevel) !== realpathSync.native(root)) return undefined;
  return { gitDir, commonDir };
}

/** `<git-common-dir>/archcontext/codegraph/<REQUIRED_CODEGRAPH_VERSION>`; a provider bump starts empty. */
export function codeGraphBaseDirectory(commonDir: string): string {
  return join(commonDir, "archcontext", "codegraph", REQUIRED_CODEGRAPH_VERSION);
}

function readHead(root: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

/** The published pointer, or `undefined` when there is none or it is not one this version wrote. */
function readBasePointer(baseDir: string): CodeGraphBasePointerV1 | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(join(baseDir, "current.json"), "utf8")); }
  catch { return undefined; }
  const pointer = parsed as Partial<CodeGraphBasePointerV1> | null;
  if (!pointer || pointer.schemaVersion !== CODEGRAPH_BASE_SCHEMA || pointer.codeGraphVersion !== REQUIRED_CODEGRAPH_VERSION) return undefined;
  if (typeof pointer.headSha !== "string" || typeof pointer.snapshot !== "string" || !SNAPSHOT_NAME.test(pointer.snapshot)) return undefined;
  return pointer as CodeGraphBasePointerV1;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/**
 * Seeds `<root>/.codegraph/codegraph.db` from the published base when the worktree has no index.
 * Only commands that run `codegraph sync` next call it. The copy is a byte copy or a copy-on-write
 * clone, never a link, so the worktree's sync never writes the shared file, and it is placed
 * without overwriting, so a concurrent seed or `codegraph init` wins and no reader sees a partial
 * file. Until `completeCodeGraphSeed` verifies the first sync, `CODEGRAPH_SEED_PENDING_FILE` makes
 * every freshness reader refuse the copy. It writes nothing outside `<root>/.codegraph`, and creates
 * that directory only to copy into it.
 */
export function seedCodeGraphIndexFromBase(root: string): CodeGraphSeedOutcomeV1 {
  const indexDir = join(root, ".codegraph");
  const database = join(indexDir, "codegraph.db");
  const pending = join(indexDir, CODEGRAPH_SEED_PENDING_FILE);
  let indexDirExists: boolean;
  try {
    if (lstatSync(indexDir).isSymbolicLink()) return "refused";
    indexDirExists = true;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") return "refused";
    indexDirExists = false;
  }
  if (indexDirExists) {
    let databaseExists = true;
    try { statSync(database); }
    catch (error) {
      if (errorCode(error) !== "ENOENT") return "refused";
      databaseExists = false;
    }
    if (databaseExists && !existsFile(pending)) return "present";
    if (pidLockLive(join(indexDir, "codegraph.lock"))) return "refused";
    // A seed whose first sync never completed and verified: a later sync would not re-extract the
    // files whose hashes it already committed, so the copy is discarded and seeded again.
    if (databaseExists) for (const name of ["codegraph.db", "codegraph.db-wal", "codegraph.db-shm"]) rmSync(join(indexDir, name), { force: true });
  }
  const dirs = gitDirs(root);
  if (!dirs) return "no-base";
  const baseDir = codeGraphBaseDirectory(dirs.commonDir);
  const pointer = readBasePointer(baseDir);
  if (!pointer) return pidLockLive(join(baseDir, "refresh.lock")) ? "base-building" : "no-base";

  if (!indexDirExists) mkdirSync(indexDir);
  if (lstatSync(indexDir).isSymbolicLink()) return "refused";
  const staging = join(indexDir, `codegraph.db.seed-${randomUUID()}`);
  try {
    // Written before the copy becomes visible, so no sync of it starts unmarked. It is never removed
    // here once a database exists: a concurrent seed's or init's index stays unverified until a
    // verified sync clears it (`completeCodeGraphSeed`).
    writeFileSync(pending, `${pointer.snapshot}\n`);
    copyFileSync(join(baseDir, pointer.snapshot), staging, fsConstants.COPYFILE_FICLONE);
    try { linkSync(staging, database); }
    catch (error) { if (errorCode(error) === "EEXIST") return "present"; throw error; }
    return "seeded";
  } catch (error) {
    rmSync(staging, { force: true });
    if (!existsFile(database)) rmSync(pending, { force: true });
    // Remove only the empty directory this seed created; a concurrent writer's files stay.
    if (!indexDirExists) removeEmptyDirectory(indexDir);
    // A pointer whose snapshot is gone was superseded between the two reads; nothing is seeded.
    if (errorCode(error) === "ENOENT") return "no-base";
    throw error;
  } finally {
    rmSync(staging, { force: true });
  }
}

/**
 * Run after a successful `codegraph sync` of `root`. When the index is a seed whose first sync was
 * pending, it becomes readable only if the sync left it fresh against the worktree and unchanged
 * during the check; otherwise the marker stays and the next sync-owning command seeds again.
 */
export function completeCodeGraphSeed(root: string, options: { provider?: CodeGraphReadProvider } = {}): void {
  const pending = join(root, ".codegraph", CODEGRAPH_SEED_PENDING_FILE);
  if (!existsFile(pending)) return;
  withCodeGraphReadSession(root, (opened) => {
    if (opened.state !== "open") return;
    const { added, modified, removed } = opened.session.freshness();
    if (added === 0 && modified === 0 && removed === 0 && opened.session.unchangedSinceOpen()) rmSync(pending, { force: true });
  }, options);
}

function removeEmptyDirectory(path: string): void {
  try { rmdirSync(path); }
  catch (error) { if (errorCode(error) !== "ENOTEMPTY" && errorCode(error) !== "EEXIST" && errorCode(error) !== "ENOENT") throw error; }
}

export interface CodeGraphBaseRefreshOptions {
  /** The read-only provider the revision guard opens the index through; the pinned one unless injected. */
  provider?: CodeGraphReadProvider;
  /** Reads `HEAD`; a test injects one that moves during the snapshot. */
  readHead?: (root: string) => string | undefined;
  /** Writes a consistent copy of `source` to `target`; `snapshotCodeGraphIndex` unless injected. */
  snapshot?: (source: string, target: string) => void;
  /** The clock of `createdAt` and of garbage collection. */
  now?: () => number;
}

/**
 * Publishes a snapshot of the primary checkout's index as the repository's base, when there is none
 * or it names another `HEAD`. Runs only after a successful sync. The snapshot is consistent only
 * when no build ran during it: it opens a read session (which refuses during a provider build and
 * records the revision), takes `HEAD`, copies, then publishes only when the session's revision is
 * unchanged and `HEAD` did not move. `refresh.lock` serializes refreshers; seeders take no lock,
 * because a published snapshot is never rewritten. Never throws.
 */
export function refreshCodeGraphBase(root: string, options: CodeGraphBaseRefreshOptions = {}): CodeGraphBaseRefreshV1 {
  try {
    return refreshCodeGraphBaseUnchecked(root, options);
  } catch {
    return "failed";
  }
}

function refreshCodeGraphBaseUnchecked(root: string, options: CodeGraphBaseRefreshOptions): CodeGraphBaseRefreshV1 {
  const head = options.readHead ?? readHead;
  const now = options.now ?? Date.now;
  const dirs = gitDirs(root);
  if (!dirs || realpathSync.native(dirs.gitDir) !== realpathSync.native(dirs.commonDir)) return "not-primary";
  const headAtStart = head(root);
  if (headAtStart === undefined) return "skipped-unborn";
  const baseDir = codeGraphBaseDirectory(dirs.commonDir);
  const published = readBasePointer(baseDir);
  if (published?.headSha === headAtStart && existsFile(join(baseDir, published.snapshot))) return "current";

  mkdirSync(baseDir, { recursive: true });
  const lock = join(baseDir, "refresh.lock");
  if (!acquirePidLock(lock)) return "skipped-busy";
  try {
    const opened = openCodeGraphReadSession(root, options.provider ? { provider: options.provider } : {});
    if (opened.state === "build-in-progress") return "skipped-moved";
    if (opened.state !== "open") return "failed";
    const { session } = opened;
    const snapshot = `base-${randomUUID()}.db`;
    const target = join(baseDir, snapshot);
    try {
      const headBefore = head(root);
      (options.snapshot ?? snapshotCodeGraphIndex)(join(root, ".codegraph", "codegraph.db"), target);
      if (headBefore === undefined || !session.unchangedSinceOpen() || head(root) !== headBefore) {
        rmSync(target, { force: true });
        return "skipped-moved";
      }
      const pointer: CodeGraphBasePointerV1 = {
        schemaVersion: CODEGRAPH_BASE_SCHEMA,
        codeGraphVersion: REQUIRED_CODEGRAPH_VERSION,
        extractionVersion: session.compatibility().currentExtractionVersion,
        headSha: headBefore,
        snapshot,
        createdAt: new Date(now()).toISOString()
      };
      writeFileAtomically(join(baseDir, "current.json"), `${JSON.stringify(pointer, null, 2)}\n`);
    } catch (error) {
      rmSync(target, { force: true });
      throw error;
    } finally {
      session.close();
    }
    collectUnreferencedSnapshots(baseDir, snapshot, now());
    return "published";
  } finally {
    releasePidLock(lock);
  }
}

/**
 * `VACUUM INTO` on a read-only handle: a consistent single-file copy that includes committed WAL
 * frames. It runs in the provider's own Node runtime, whose `node:sqlite` creates the read-only
 * sidecars that the macOS system SQLite of a Bun process cannot.
 */
export function snapshotCodeGraphIndex(source: string, target: string): void {
  const { platformRoot } = codeGraphBundle();
  const node = join(platformRoot, process.platform === "win32" ? "node.exe" : "node");
  const script = 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(process.argv[1], { readOnly: true }); try { db.prepare("VACUUM INTO ?").run(process.argv[2]); } finally { db.close(); }';
  execFileSync(node, ["--no-warnings", "-e", script, source, target], { stdio: "pipe", timeout: 120_000, env: codeGraphChildEnv() });
}

function existsFile(path: string): boolean {
  try { return statSync(path).isFile(); }
  catch { return false; }
}

/** A pid file created exclusively; a stale one (dead or malformed holder) is replaced once. */
function acquirePidLock(path: string): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      try { writeSync(fd, String(process.pid)); }
      finally { closeSync(fd); }
      return true;
    } catch (error) {
      if (errorCode(error) !== "EEXIST" || pidLockLive(path)) return false;
      rmSync(path, { force: true });
    }
  }
  return false;
}

function releasePidLock(path: string): void {
  try {
    if (readFileSync(path, "utf8").trim() === String(process.pid)) unlinkSync(path);
  } catch {
    // Already gone, or replaced by a refresher that judged it stale; it is not ours to remove.
  }
}

function writeFileAtomically(path: string, content: string): void {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temp, "wx");
    try { writeSync(fd, content); }
    finally { closeSync(fd); }
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

/**
 * Deletes the `base-*.db` files of this version's directory that `current.json` does not name and
 * that are older than `SNAPSHOT_GC_AGE_MS`. Nothing else, and no other version's directory, is
 * touched. A file that cannot be deleted (on Windows, one a seeder still has open) is left for the
 * next refresh.
 */
function collectUnreferencedSnapshots(baseDir: string, current: string, now: number): void {
  for (const name of readdirSync(baseDir)) {
    if (name === current || !SNAPSHOT_NAME.test(name)) continue;
    const path = join(baseDir, name);
    try {
      if (now - statSync(path).mtimeMs >= SNAPSHOT_GC_AGE_MS) unlinkSync(path);
    } catch {
      // Left for the next refresh.
    }
  }
}
