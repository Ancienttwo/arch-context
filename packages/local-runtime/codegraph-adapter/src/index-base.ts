import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, constants as fsConstants, copyFileSync, fstatSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodeGraphBaseRefreshV1, CodeGraphKeptPathV1 } from "@archcontext/contracts";
import { localGitEnv, stripGitLineTerminator } from "@archcontext/local-runtime/git-adapter";
import { codeGraphChildEnv } from "./child-env";
import { CODEGRAPH_OUTPUT_MAX_BYTES, CODEGRAPH_SYNC_TIMEOUT_MS, DEFAULT_CODEGRAPH_BINARY, disableCodeGraphTelemetryByDefault, packagedCodeGraphCliInvocation } from "./cli-invocation";
import { REQUIRED_CODEGRAPH_VERSION, codeGraphBundle, codeGraphChangeCounts, codeGraphIndexIdentity, openCodeGraphReadSession, pidLockLive, type CodeGraphBundle, type CodeGraphReadProvider } from "./read-session";

// The shared base index of one Git repository (#608). The primary checkout publishes a consistent
// snapshot of its own index after a successful sync; a worktree with no index of its own gets a
// private copy of it, synced and checked in a staging folder before it is linked in. A worktree
// still reads only its own `.codegraph`, and a read never seeds.
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
 * What the seed did. `present`: the worktree already has an index, which the seed never touches.
 * `seeded`: a private staged copy of the base passed every check and was linked in. `no-base`:
 * nothing is published. `base-building`: nothing is published and a refresh is running.
 * `declined`: a condition the seed cannot prove; `.codegraph/` holds what it held before, and the
 * caller's readiness check reports the worktree exactly as without a seed.
 */
export type CodeGraphSeedOutcomeV1 = "present" | "seeded" | "no-base" | "base-building" | "declined";

export interface CodeGraphSeedOptions {
  /** The binary of the caller's own sync; any but the packaged CodeGraph declines the seed. */
  binary?: string;
  /** Bound on the staged sync; the default sync bound unless the caller has its own. */
  timeoutMs?: number;
  /** Receives each path the seed leaves in place for hand cleanup. */
  report?: (kept: CodeGraphKeptPathV1) => void;
}

const SNAPSHOT_NAME = /^base-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.db$/;
/** An unreferenced snapshot younger than this may still be a seeder's source; an older one is reported for hand cleanup. */
const SNAPSHOT_REPORT_AGE_MS = 10 * 60_000;
/** How to clean up each kind of path archctx leaves in place. archctx itself never removes them. */
const KEPT_CLEANUP: Record<CodeGraphKeptPathV1["kind"], string> = {
  "abandoned-staging": "A seed that is no longer running left this folder. Delete it by hand when no archctx or codegraph process is using this worktree.",
  "staging-not-removed": "This seed's folder holds an entry the seed did not create, so it was left as it is. Check the entry, then delete the folder by hand.",
  "unreferenced-snapshot": "current.json does not name this snapshot and it is older than ten minutes. Delete it by hand.",
  "snapshot-not-removed": "This refresh did not publish this snapshot and it is no longer the file the refresh wrote. Check it, then delete it by hand.",
  "stale-refresh-lock": "The refresh that held this lock is gone. Delete the lock by hand so a later refresh can publish.",
  "refresh-lock-not-removed": "This refresh could not remove its refresh.lock because it is no longer the lock this refresh created or could not be unlinked. Check it, then delete it by hand so a later refresh can publish.",
  "unproven-pointer": "archctx cannot prove it wrote this current.json. Delete it by hand so a later refresh can publish.",
  "pointer-temp-not-removed": "This refresh did not publish this temporary pointer file and could not remove it. Check it, then delete it by hand."
};
/** A seed's private staging folder in the worktree root; the owner pid is part of the name. */
const STAGING_NAME = /^\.codegraph-seed-(\d+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The only entries a staging folder may hold; a folder with any other entry is never removed. */
const STAGING_ENTRIES = new Set([".gitignore", "codegraph.db", "codegraph.db-wal", "codegraph.db-shm", "codegraph.lock"]);
/** The installed database and every SQLite sidecar path; each must be untracked and ignored before the link. */
const LIVE_DATABASE_PATHS = ["codegraph.db", "codegraph.db-wal", "codegraph.db-shm", "codegraph.db-journal"].map((name) => `.codegraph/${name}`);
/** The first line of CodeGraph's generated `.codegraph/.gitignore` (pinned `directory.js` GITIGNORE_MARKER). */
const CODEGRAPH_GITIGNORE_MARKER = "# CodeGraph data files";
const SEED_CHILD_TIMEOUT_MS = 120_000;

interface GitDirs {
  gitDir: string;
  commonDir: string;
}

/** The Git directories of `root`, only when `root` is the top level of a worktree. */
function gitDirs(root: string): GitDirs | undefined {
  let output: string;
  try {
    output = execFileSync("git", ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"], {
      cwd: root,
      env: localGitEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return undefined;
  }
  const parts = stripGitLineTerminator(output).split(process.platform === "win32" ? /\r?\n/ : "\n");
  if (parts.length !== 3) return undefined;
  const [topLevel, gitDir, commonDir] = parts;
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
 * Seeds a worktree that has no index (#608): a private copy of the published base is synced in a
 * staging folder under `CODEGRAPH_DIR`, checked, and only then hard-linked to
 * `<root>/.codegraph/codegraph.db`. The live path holds nothing or a full index the checks proved;
 * an existing database is never opened, moved or removed. Any condition it cannot prove declines.
 * Only commands that run `codegraph sync` next call it, and a read never does.
 */
export function seedCodeGraphIndexFromBase(root: string, options: CodeGraphSeedOptions = {}): CodeGraphSeedOutcomeV1 {
  const bundle = seedBundle(options);
  if (!bundle) return "declined";
  const report = options.report ?? (() => undefined);
  reportAbandonedStagings(root, report);
  const dirs = gitDirs(root);
  const baseDir = dirs ? codeGraphBaseDirectory(dirs.commonDir) : undefined;
  const indexDir = join(root, ".codegraph");
  const database = join(indexDir, "codegraph.db");
  const existing = pathState(database);
  if (existing === "present") return "present";
  if (existing === "unreadable") return "declined";
  if (!baseDir) return "no-base";
  const pointer = readBasePointer(baseDir);
  if (!pointer) return pidLockLive(join(baseDir, "refresh.lock")) ? "base-building" : "no-base";

  const stagingName = `.codegraph-seed-${process.pid}-${randomUUID()}`;
  if (!targetsResolveAsExpected(bundle, root, stagingName)) return "declined";
  if (!destinationAccepts(indexDir)) return "declined";
  if (pathState(join(indexDir, ".gitignore")) !== "absent" && !liveDatabasePathsIgnored(root)) return "declined";
  const staging = join(root, stagingName);
  try { mkdirSync(staging); }
  catch { return "declined"; }
  const run = new StagingRun(staging);
  if (!run.ownFolder()) { removeEmptyDirectory(staging); return "declined"; }
  try {
    writeExclusive(join(staging, ".gitignore"), "*\n");
    run.created(".gitignore");
    const staged = join(staging, "codegraph.db");
    try { copyFileSync(join(baseDir, pointer.snapshot), staged, fsConstants.COPYFILE_FICLONE); }
    // A pointer whose snapshot is gone was superseded between the two reads.
    catch (error) { if (errorCode(error) === "ENOENT") return "no-base"; throw error; }
    run.created("codegraph.db");
    const copiedAt = statSync(staged, { bigint: true }).mtimeNs;
    try { runStagedSync(bundle, root, stagingName, options.timeoutMs ?? CODEGRAPH_SYNC_TIMEOUT_MS); }
    finally { run.childExited(); }
    if (pathState(database) !== "absent") return "present";
    // Proof that the provider wrote into the staging folder, and left no writer state behind.
    if (statSync(staged, { bigint: true }).mtimeNs === copiedAt) return "declined";
    if (pathState(join(staging, "codegraph.lock")) !== "absent" || nonEmptyFile(join(staging, "codegraph.db-wal"))) return "declined";
    let ready: boolean;
    try { ready = stagedIndexReady(bundle, root, stagingName); }
    finally { run.childExited(); }
    if (!ready) return "declined";
    if (nonEmptyFile(join(staging, "codegraph.db-wal"))) return "declined";
    return installStagedDatabase(root, staged);
  } catch {
    return "declined";
  } finally {
    // Only `codegraph.db` is ever linked out; the staging name of it and any sidecars go here.
    if (!run.remove()) report({ path: staging, kind: "staging-not-removed", cleanup: KEPT_CLEANUP["staging-not-removed"] });
  }
}

/**
 * The pinned platform bundle the whole seed runs on, or `undefined` when the seed is off: on
 * Windows, with `CODEGRAPH_DIR` set in archctx's own environment, for a caller-named binary, or
 * when the packaged CLI or the platform bundle is not exactly `REQUIRED_CODEGRAPH_VERSION`.
 * `CODEGRAPH_DIR` is read from the pinned provider's source (`directory.js` codeGraphDirName), not
 * from a documented contract, so every other version gets the ordinary path.
 */
function seedBundle(options: CodeGraphSeedOptions): CodeGraphBundle | undefined {
  if (process.platform === "win32" || process.env.CODEGRAPH_DIR?.trim()) return undefined;
  if (options.binary !== undefined && options.binary !== DEFAULT_CODEGRAPH_BINARY) return undefined;
  try {
    packagedCodeGraphCliInvocation();
    const bundle = codeGraphBundle();
    const manifest = JSON.parse(readFileSync(join(bundle.platformRoot, "package.json"), "utf8")) as { version?: unknown };
    return manifest.version === REQUIRED_CODEGRAPH_VERSION ? bundle : undefined;
  } catch {
    return undefined;
  }
}

function bundleNode(bundle: CodeGraphBundle): string {
  return join(bundle.platformRoot, process.platform === "win32" ? "node.exe" : "node");
}

/** In the bundle itself: the plain target must be `<root>/.codegraph` (not `.codegraph-wsl`) and the staged one the staging folder. */
function targetsResolveAsExpected(bundle: CodeGraphBundle, root: string, stagingName: string): boolean {
  const script = "const sdk = require(process.argv[1]); delete process.env.CODEGRAPH_DIR; const plain = sdk.getCodeGraphDir(process.argv[2]); process.env.CODEGRAPH_DIR = process.argv[3]; process.stdout.write(JSON.stringify({ plain, staged: sdk.getCodeGraphDir(process.argv[2]) }));";
  try {
    const out = execFileSync(bundleNode(bundle), ["--no-warnings", "-e", script, join(bundle.dist, "index.js"), root, stagingName], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: SEED_CHILD_TIMEOUT_MS, env: codeGraphChildEnv() });
    const resolved = JSON.parse(out) as { plain?: unknown; staged?: unknown };
    return resolved.plain === join(root, ".codegraph") && resolved.staged === join(root, stagingName);
  } catch {
    return false;
  }
}

/** The bundle's own CLI entry, as its `bin/codegraph` launcher runs it, syncing the staging folder only. */
function runStagedSync(bundle: CodeGraphBundle, root: string, stagingName: string, timeout: number): void {
  disableCodeGraphTelemetryByDefault();
  execFileSync(bundleNode(bundle), ["--liftoff-only", "--disable-warning=ExperimentalWarning", join(bundle.dist, "bin", "codegraph.js"), "sync", root, "--quiet"], {
    cwd: root,
    env: { ...codeGraphChildEnv(), CODEGRAPH_DIR: stagingName },
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: CODEGRAPH_OUTPUT_MAX_BYTES,
    timeout
  });
}

/**
 * The staged copy must be the index a fresh build would give: built by this provider version and
 * extraction version, complete, not stale, and fresh by full content hash against the worktree. The
 * provider's sync skips a same-size edit with an unchanged mtime (`extraction/index.js` reconcile
 * pre-filter), so a successful sync proves no freshness. The read-only open runs in the bundle's
 * Node with `CODEGRAPH_DIR` in that child only: the SDK resolves the directory from the process
 * environment on every lookup, and Bun on macOS cannot open it read-only (ADR-0058 Decision 8).
 * The counting rule is `codeGraphChangeCounts`, the one the in-process freshness reader uses.
 */
function stagedIndexReady(bundle: CodeGraphBundle, root: string, stagingName: string): boolean {
  const script = [
    `const codeGraphChangeCounts = ${codeGraphChangeCounts.toString()};`,
    "const { join } = require('node:path'); const { existsSync } = require('node:fs');",
    "const [dist, root, version] = process.argv.slice(1);",
    "const sdk = require(join(dist, 'index.js'));",
    "const { scanDirectory, hashContent } = require(join(dist, 'extraction/index.js'));",
    "const { readBoundedSourceSync, oversizeStamp } = require(join(dist, 'file-limits.js'));",
    "const { EXTRACTION_VERSION } = require(join(dist, 'extraction/extraction-version.js'));",
    "const graph = sdk.CodeGraph.openSync(root, { readOnly: true });",
    "try {",
    "  const build = graph.getIndexBuildInfo();",
    "  const built = build.version === version && build.extractionVersion === EXTRACTION_VERSION && graph.getIndexState() === 'complete' && !graph.isIndexStale();",
    "  const counts = codeGraphChangeCounts(graph.getFiles(), scanDirectory(root), { exists: (p) => existsSync(join(root, p)), changeHash: (p) => { const read = readBoundedSourceSync(join(root, p)); return hashContent(read.bytes === null ? oversizeStamp(read.stats.size) : read.bytes.toString('utf8')); } });",
    "  process.stdout.write(JSON.stringify({ ready: built && counts.added === 0 && counts.modified === 0 && counts.removed === 0 }));",
    "} finally { graph.close(); }"
  ].join("\n");
  try {
    const out = execFileSync(bundleNode(bundle), ["--no-warnings", "-e", script, bundle.dist, root, REQUIRED_CODEGRAPH_VERSION], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: SEED_CHILD_TIMEOUT_MS, env: { ...codeGraphChildEnv(), CODEGRAPH_DIR: stagingName } });
    return (JSON.parse(out) as { ready?: unknown }).ready === true;
  } catch {
    return false;
  }
}

/**
 * The install: the destination is re-checked, `.codegraph/` and its `.gitignore` are created only
 * when absent (the file exclusively), the database paths are proven ignored, and the staged
 * database is hard-linked without overwriting. A concurrent install or `codegraph init` wins.
 * What this install created is removed again only when it is still exactly what it created.
 */
function installStagedDatabase(root: string, staged: string): CodeGraphSeedOutcomeV1 {
  const indexDir = join(root, ".codegraph");
  const ignore = join(indexDir, ".gitignore");
  const database = join(indexDir, "codegraph.db");
  if (!destinationAccepts(indexDir)) return "declined";
  let createdDir = false;
  let createdIgnore: bigint | undefined;
  const undo = (): CodeGraphSeedOutcomeV1 => {
    if (createdIgnore !== undefined && pathState(database) === "absent") removeOwnFile(ignore, createdIgnore, "*\n");
    if (createdDir) removeEmptyDirectory(indexDir);
    return "declined";
  };
  try { mkdirSync(indexDir); createdDir = true; }
  catch (error) { if (errorCode(error) !== "EEXIST") return "declined"; }
  try { createdIgnore = writeExclusive(ignore, "*\n"); }
  catch (error) { if (errorCode(error) !== "EEXIST") return undo(); }
  if (!destinationAccepts(indexDir) || !liveDatabasePathsIgnored(root)) return undo();
  try {
    linkSync(staged, database);
    return "seeded";
  } catch (error) {
    if (errorCode(error) === "EEXIST") return "present";
    return undo();
  }
}

/**
 * `.codegraph` may receive the database only when it is absent, or a real directory whose only
 * entry is a regular `.gitignore` the provider keeps as it is. Leftover database sidecars or
 * journals, writer files (`codegraph.lock`, `daemon.pid`), any other entry, a link, or an ignore
 * file the provider would rewrite on open all decline, and nothing there is touched.
 */
function destinationAccepts(indexDir: string): boolean {
  let stat;
  try { stat = lstatSync(indexDir); }
  catch (error) { return errorCode(error) === "ENOENT"; }
  if (!stat.isDirectory()) return false;
  let entries: string[];
  try { entries = readdirSync(indexDir); }
  catch { return false; }
  if (entries.some((entry) => entry !== ".gitignore")) return false;
  if (entries.length === 0) return true;
  const ignore = join(indexDir, ".gitignore");
  try {
    return lstatSync(ignore).isFile() && !codeGraphRewritesGitignore(readFileSync(ignore, "utf-8"));
  } catch {
    // The provider rewrites an ignore file it cannot read.
    return false;
  }
}

/**
 * True when the pinned provider would replace `.codegraph/.gitignore` on its next open, read-only
 * opens included: CodeGraph 1.6.2 `isStaleDefaultGitignore` (directory.js), whose `trimStart` also
 * drops leading whitespace and a byte-order mark. Kept character for character with that version.
 */
export function codeGraphRewritesGitignore(content: string): boolean {
  if (!content.trimStart().startsWith(CODEGRAPH_GITIGNORE_MARKER)) return false;
  return !content.split("\n").some((line) => line.trim() === "*");
}

/** Every installed database path is untracked and ignored by the worktree's own rules. */
function liveDatabasePathsIgnored(root: string): boolean {
  const git = (args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: codeGraphChildEnv() });
  try {
    if (git(["ls-files", "-z", "--", ...LIVE_DATABASE_PATHS]) !== "") return false;
    const ignored = new Set(git(["check-ignore", "--", ...LIVE_DATABASE_PATHS]).split(/\r?\n/));
    return LIVE_DATABASE_PATHS.every((path) => ignored.has(path));
  } catch {
    // `check-ignore` exits 1 when no path is ignored.
    return false;
  }
}

/**
 * Reports staging folders whose owner pid (in the name) is dead and whose provider lock names no
 * live process. archctx never removes them: it cannot prove what a crashed run left there, so they
 * are left for hand cleanup.
 */
function reportAbandonedStagings(root: string, report: (kept: CodeGraphKeptPathV1) => void): void {
  let names: string[];
  try { names = readdirSync(root); }
  catch { return; }
  for (const name of names) {
    const match = STAGING_NAME.exec(name);
    if (!match || processAlive(Number(match[1]))) continue;
    const staging = join(root, name);
    if (pidLockLive(join(staging, "codegraph.lock"))) continue;
    report({ path: staging, kind: "abandoned-staging", cleanup: KEPT_CLEANUP["abandoned-staging"] });
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

/**
 * One seed run's staging folder, and the creation identity of each entry created in it during this
 * run, held in memory only. The seed creates the folder (with a fresh name), its `.gitignore` and
 * the database copy; the provider children it runs there create the sidecars and the lock, which
 * are recorded right after each child exits. `remove` unlinks only entries whose identity still
 * matches and removes the folder with `rmdir`; when any entry does not match, nothing is removed.
 */
export class StagingRun {
  readonly #entries = new Map<string, string>();
  #folder: string | undefined;

  constructor(
    private readonly staging: string,
    private readonly identityOf: (path: string) => string | undefined = creationIdentity
  ) {}

  ownFolder(): boolean {
    this.#folder = this.identityOf(this.staging);
    return this.#folder !== undefined;
  }

  created(entry: string): void {
    const identity = this.identityOf(join(this.staging, entry));
    if (identity === undefined) throw new Error("created entry is gone");
    this.#entries.set(entry, identity);
  }

  childExited(): void {
    for (const entry of STAGING_ENTRIES) {
      if (this.#entries.has(entry)) continue;
      const identity = this.identityOf(join(this.staging, entry));
      if (identity !== undefined) this.#entries.set(entry, identity);
    }
  }

  remove(): boolean {
    let entries: string[];
    try {
      if (!lstatSync(this.staging).isDirectory()) return false;
      if (this.#folder === undefined || this.identityOf(this.staging) !== this.#folder) return false;
      entries = readdirSync(this.staging);
      for (const entry of entries) {
        const path = join(this.staging, entry);
        const recorded = this.#entries.get(entry);
        if (recorded === undefined || !lstatSync(path).isFile() || this.identityOf(path) !== recorded) return false;
      }
    } catch (error) {
      return errorCode(error) === "ENOENT";
    }
    for (const entry of entries) rmSync(join(this.staging, entry), { force: true });
    removeEmptyDirectory(this.staging);
    return pathState(this.staging) === "absent";
  }
}

/**
 * A path's creation identity: device, inode and birth time. A backup restore or a same-bytes
 * re-creation at the path has another one. Birth time, not ctime: a sync's writes and the install's
 * hard link change ctime but not the file. A file system that reports no birth time gives none.
 */
function creationIdentity(path: string): string | undefined {
  try {
    const stat = lstatSync(path, { bigint: true });
    return stat.birthtimeNs > 0n ? `${stat.dev}-${stat.ino}-${stat.birthtimeNs}` : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The record that `current.json` is the file archctx wrote: an empty file
 * `records/current.json@<identity>`, created exclusively from the temporary pointer file's
 * identity before publishing it via rename, and never deleted, so one accumulates per publish.
 * Only a `current.json` whose identity has a record is replaced; a restored or re-created one has none.
 */
function recordPointerIdentity(baseDir: string, identity: string): void {
  const records = join(baseDir, "records");
  mkdirSync(records, { recursive: true });
  try { closeSync(openSync(join(records, `current.json@${identity}`), "wx")); }
  catch (error) { if (errorCode(error) !== "EEXIST") throw error; }
}

function pointerProven(baseDir: string, current: string): boolean {
  const identity = creationIdentity(current);
  return identity !== undefined && existsFile(join(baseDir, "records", `current.json@${identity}`));
}

/** Unlinks a file this process created in this run, while it is still that file. */
function removeCreatedFile(path: string, identity: string | undefined): boolean {
  if (identity === undefined || creationIdentity(path) !== identity) return pathState(path) === "absent";
  try { unlinkSync(path); return true; }
  catch (error) { return errorCode(error) === "ENOENT"; }
}

function pathState(path: string): "absent" | "present" | "unreadable" {
  try { lstatSync(path); return "present"; }
  catch (error) { return errorCode(error) === "ENOENT" ? "absent" : "unreadable"; }
}

function nonEmptyFile(path: string): boolean {
  try { return statSync(path).size > 0; }
  catch { return false; }
}

/** Creates `path` exclusively and returns its inode. */
function writeExclusive(path: string, content: string): bigint {
  const fd = openSync(path, "wx");
  try { writeSync(fd, content); return fstatSync(fd, { bigint: true }).ino; }
  finally { closeSync(fd); }
}

/** Unlinks `path` only while it is still the file this process created, unchanged. */
function removeOwnFile(path: string, ino: bigint, content: string): void {
  try {
    if (lstatSync(path, { bigint: true }).ino === ino && readFileSync(path, "utf8") === content) unlinkSync(path);
  } catch {
    // Gone or replaced: not ours to remove.
  }
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
  /** The clock of `createdAt` and of the unreferenced-snapshot report. */
  now?: () => number;
  /** Receives each path the refresh leaves in place for hand cleanup. */
  report?: (kept: CodeGraphKeptPathV1) => void;
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
  const report = options.report ?? (() => undefined);
  const published = readBasePointer(baseDir);
  if (published?.headSha === headAtStart && existsFile(join(baseDir, published.snapshot))) {
    reportStaleRefreshLock(join(baseDir, "refresh.lock"), report);
    reportUnreferencedSnapshots(baseDir, published.snapshot, now(), report);
    return "current";
  }

  mkdirSync(baseDir, { recursive: true });
  const lock = join(baseDir, "refresh.lock");
  const acquired = acquirePidLock(lock, report);
  if (acquired.state !== "acquired") return acquired.state;
  try {
    // The session and the copy must read the same file: the database the SDK resolves must be
    // `<root>/.codegraph/codegraph.db`, and must still be that file after the copy.
    const identityAtStart = codeGraphIndexIdentity(root);
    if (identityAtStart === undefined) return "skipped-unverifiable";
    const opened = openCodeGraphReadSession(root, options.provider ? { provider: options.provider } : {});
    if (opened.state === "build-in-progress") return "skipped-moved";
    if (opened.state !== "open") return "failed";
    const { session } = opened;
    const snapshot = `base-${randomUUID()}.db`;
    const target = join(baseDir, snapshot);
    let written: string | undefined;
    // An unpublished snapshot is removed only while it is still the file this refresh wrote.
    const discard = () => {
      if (!removeCreatedFile(target, written)) report({ path: target, kind: "snapshot-not-removed", cleanup: KEPT_CLEANUP["snapshot-not-removed"] });
    };
    try {
      const headBefore = head(root);
      (options.snapshot ?? snapshotCodeGraphIndex)(join(root, ".codegraph", "codegraph.db"), target);
      written = creationIdentity(target);
      if (headBefore === undefined || !session.unchangedSinceOpen() || head(root) !== headBefore || codeGraphIndexIdentity(root) !== identityAtStart) {
        discard();
        return "skipped-moved";
      }
      const current = join(baseDir, "current.json");
      if (pathState(current) !== "absent" && !pointerProven(baseDir, current)) {
        report({ path: current, kind: "unproven-pointer", cleanup: KEPT_CLEANUP["unproven-pointer"] });
        discard();
        return "skipped-unproven";
      }
      const pointer: CodeGraphBasePointerV1 = {
        schemaVersion: CODEGRAPH_BASE_SCHEMA,
        codeGraphVersion: REQUIRED_CODEGRAPH_VERSION,
        extractionVersion: session.compatibility().currentExtractionVersion,
        headSha: headBefore,
        snapshot,
        createdAt: new Date(now()).toISOString()
      };
      publishBasePointer(baseDir, current, `${JSON.stringify(pointer, null, 2)}\n`, report);
    } catch (error) {
      if (readBasePointer(baseDir)?.snapshot !== snapshot) discard();
      throw error;
    } finally {
      session.close();
    }
    reportUnreferencedSnapshots(baseDir, snapshot, now(), report);
    return "published";
  } finally {
    releasePidLock(lock, acquired.identity, report);
  }
}

function formatFileIdentity(stat: { dev: bigint; ino: bigint; ctimeNs: bigint; mtimeNs: bigint; size: bigint }): string {
  return `${stat.dev}:${stat.ino}:${stat.ctimeNs}:${stat.mtimeNs}:${stat.size}`;
}

/**
 * `VACUUM INTO` on a read-only handle over a private scratch copy (`source` + any regular `-wal`):
 * a consistent single-file snapshot that includes committed WAL frames without creating `-wal`/`-shm`
 * sidecars in `<root>/.codegraph/`. Runs in the provider's Node runtime for `node:sqlite`.
 */
export function snapshotCodeGraphIndex(source: string, target: string): void {
  const { platformRoot } = codeGraphBundle();
  const node = join(platformRoot, process.platform === "win32" ? "node.exe" : "node");
  const journalStat = lstatSync(`${source}-journal`, { throwIfNoEntry: false });
  if (journalStat) {
    throw new Error("CodeGraph snapshot source has an active rollback journal");
  }
  const sourceStat = lstatSync(source, { bigint: true, throwIfNoEntry: false });
  if (!sourceStat || !sourceStat.isFile()) {
    throw new Error("CodeGraph snapshot source is not a regular file");
  }
  const beforeSourceId = formatFileIdentity(sourceStat);
  const walPath = `${source}-wal`;
  const walStat = lstatSync(walPath, { bigint: true, throwIfNoEntry: false });
  if (walStat && !walStat.isFile()) {
    throw new Error("CodeGraph snapshot WAL entry is not a regular file");
  }
  const beforeWalId = walStat ? formatFileIdentity(walStat) : undefined;
  const scratch = mkdtempSync(join(realpathSync(tmpdir()), "archctx-snapshot-"));
  const scratchDb = join(scratch, "codegraph.db");
  try {
    copyFileSync(source, scratchDb, fsConstants.COPYFILE_FICLONE);
    if (walStat) {
      copyFileSync(walPath, `${scratchDb}-wal`, fsConstants.COPYFILE_FICLONE);
    }
    const afterSourceStat = lstatSync(source, { bigint: true, throwIfNoEntry: false });
    const afterSourceId = afterSourceStat?.isFile() ? formatFileIdentity(afterSourceStat) : undefined;
    const afterWalStat = lstatSync(walPath, { bigint: true, throwIfNoEntry: false });
    const afterWalId = afterWalStat?.isFile() ? formatFileIdentity(afterWalStat) : undefined;
    if (
      afterSourceId !== beforeSourceId
      || (afterWalStat && !afterWalStat.isFile())
      || afterWalId !== beforeWalId
      || lstatSync(`${source}-journal`, { throwIfNoEntry: false })
    ) {
      throw new Error("CodeGraph snapshot source changed during copy");
    }
    const script = 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(process.argv[1], { readOnly: true }); try { db.prepare("VACUUM INTO ?").run(process.argv[2]); } finally { db.close(); }';
    execFileSync(node, ["--no-warnings", "-e", script, scratchDb, target], { stdio: "pipe", timeout: 120_000, env: codeGraphChildEnv() });
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
}

function existsFile(path: string): boolean {
  try { return statSync(path).isFile(); }
  catch { return false; }
}

/**
 * A pid file created exclusively. A stale one (dead or malformed holder) is never removed: it is
 * reported for hand cleanup and the refresh is skipped.
 */
function acquirePidLock(path: string, report: (kept: CodeGraphKeptPathV1) => void): { state: "acquired"; identity: string | undefined } | { state: "skipped-busy" | "skipped-unproven" } {
  try {
    const fd = openSync(path, "wx");
    try { writeSync(fd, String(process.pid)); }
    finally { closeSync(fd); }
    return { state: "acquired", identity: creationIdentity(path) };
  } catch (error) {
    if (errorCode(error) !== "EEXIST" || pidLockLive(path)) return { state: "skipped-busy" };
    report({ path, kind: "stale-refresh-lock", cleanup: KEPT_CLEANUP["stale-refresh-lock"] });
    return { state: "skipped-unproven" };
  }
}

/**
 * Reports a present `refresh.lock` whose holder is not alive (dead or malformed pid). Used on the
 * `"current"` fast path where no lock is acquired; a live lock or an absent file is ignored.
 */
function reportStaleRefreshLock(path: string, report: (kept: CodeGraphKeptPathV1) => void): void {
  if (pathState(path) !== "absent" && !pidLockLive(path) && pathState(path) !== "absent") {
    report({ path, kind: "stale-refresh-lock", cleanup: KEPT_CLEANUP["stale-refresh-lock"] });
  }
}

/** Removes the lock only while it is still the file this refresh created; reports it otherwise. */
function releasePidLock(path: string, identity: string | undefined, report: (kept: CodeGraphKeptPathV1) => void): void {
  if (!removeCreatedFile(path, identity)) {
    report({ path, kind: "refresh-lock-not-removed", cleanup: KEPT_CLEANUP["refresh-lock-not-removed"] });
  }
}

/**
 * Writes `current.json` through a temporary file, records its creation identity before publishing
 * it via rename (so a crash right after rename never strands future refreshes at `skipped-unproven`),
 * and reports the temporary path if cleanup after an error cannot remove it.
 */
export function publishBasePointer(
  baseDir: string,
  path: string,
  content: string,
  report: (kept: CodeGraphKeptPathV1) => void,
  beforeRename?: (temp: string) => void
): void {
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, "wx");
  const identity = creationIdentity(temp);
  try {
    try { writeSync(fd, content); }
    finally { closeSync(fd); }
    if (identity === undefined) throw new Error("pointer temp has no creation identity");
    recordPointerIdentity(baseDir, identity);
    beforeRename?.(temp);
    renameSync(temp, path);
  } catch (error) {
    if (!removeCreatedFile(temp, identity)) {
      report({ path: temp, kind: "pointer-temp-not-removed", cleanup: KEPT_CLEANUP["pointer-temp-not-removed"] });
    }
    throw error;
  }
}

/**
 * Reports the `base-*.db` files of this version's directory that `current.json` does not name and
 * that are older than `SNAPSHOT_REPORT_AGE_MS`. archctx never deletes a snapshot an earlier process
 * wrote; these are left for hand cleanup.
 */
function reportUnreferencedSnapshots(baseDir: string, current: string, now: number, report: (kept: CodeGraphKeptPathV1) => void): void {
  for (const name of readdirSync(baseDir)) {
    if (name === current || !SNAPSHOT_NAME.test(name)) continue;
    const path = join(baseDir, name);
    try {
      if (now - statSync(path).mtimeMs >= SNAPSHOT_REPORT_AGE_MS) report({ path, kind: "unreferenced-snapshot", cleanup: KEPT_CLEANUP["unreferenced-snapshot"] });
    } catch {
      // Gone since the listing.
    }
  }
}
