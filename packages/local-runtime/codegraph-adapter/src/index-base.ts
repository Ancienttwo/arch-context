import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, constants as fsConstants, copyFileSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { CodeGraphBaseRefreshV1 } from "@archcontext/contracts";
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
  /** Receives each path the seed left in place because it could not prove archctx created it. */
  report?: (kept: string) => void;
}

const SNAPSHOT_NAME = /^base-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.db$/;
/** An unreferenced snapshot younger than this may still be a refresher's staging file or a seeder's source. */
const SNAPSHOT_GC_AGE_MS = 10 * 60_000;
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
  const dirs = gitDirs(root);
  const baseDir = dirs ? codeGraphBaseDirectory(dirs.commonDir) : undefined;
  if (baseDir) reapDeadStagings(root, baseDir, report);
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
  try { recordCreation(baseDir, stagingName, staging); }
  catch { removeEmptyDirectory(staging); return "declined"; }
  try {
    writeExclusive(join(staging, ".gitignore"), "*\n");
    recordCreation(baseDir, `${stagingName}.gitignore`, join(staging, ".gitignore"));
    const staged = join(staging, "codegraph.db");
    try { copyFileSync(join(baseDir, pointer.snapshot), staged, fsConstants.COPYFILE_FICLONE); }
    // A pointer whose snapshot is gone was superseded between the two reads.
    catch (error) { if (errorCode(error) === "ENOENT") return "no-base"; throw error; }
    recordCreation(baseDir, `${stagingName}.db`, staged);
    const copiedAt = statSync(staged, { bigint: true }).mtimeNs;
    runStagedSync(bundle, root, stagingName, options.timeoutMs ?? CODEGRAPH_SYNC_TIMEOUT_MS);
    if (pathState(database) !== "absent") return "present";
    // Proof that the provider wrote into the staging folder, and left no writer state behind.
    if (statSync(staged, { bigint: true }).mtimeNs === copiedAt) return "declined";
    if (pathState(join(staging, "codegraph.lock")) !== "absent" || nonEmptyFile(join(staging, "codegraph.db-wal"))) return "declined";
    if (!stagedIndexReady(bundle, root, stagingName)) return "declined";
    if (nonEmptyFile(join(staging, "codegraph.db-wal"))) return "declined";
    return installStagedDatabase(root, staged);
  } catch {
    return "declined";
  } finally {
    // Only `codegraph.db` is ever linked out; the staging name of it and any sidecars go here.
    if (!removeOwnStaging(baseDir, stagingName, staging)) report(staging);
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
 * Removes staging folders whose owner pid (in the name) is dead and whose provider lock names no
 * live process, with proof that archctx created them. It runs on every seed attempt, with or
 * without a live database; a folder it cannot prove is left in place and reported.
 */
function reapDeadStagings(root: string, baseDir: string, report: (kept: string) => void): void {
  let names: string[];
  try { names = readdirSync(root); }
  catch { return; }
  for (const name of names) {
    const match = STAGING_NAME.exec(name);
    if (!match || processAlive(Number(match[1]))) continue;
    const staging = join(root, name);
    if (pidLockLive(join(staging, "codegraph.lock"))) continue;
    if (!removeOwnStaging(baseDir, name, staging)) report(staging);
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
 * Removes the staging folder `name` only with proof: the folder, its ignore file and its database
 * copy carry the creation identities archctx recorded, and every other entry is a regular file with
 * a provider database name (the sidecars and lock the provider made inside that proven folder).
 * Non-recursive: those files are unlinked, then the folder is removed with `rmdir`. Returns false
 * when anything stays.
 */
function removeOwnStaging(baseDir: string, name: string, staging: string): boolean {
  let entries: string[];
  try {
    if (!lstatSync(staging).isDirectory() || !provenCreation(baseDir, name, staging)) return false;
    entries = readdirSync(staging);
    for (const entry of entries) {
      const path = join(staging, entry);
      if (!STAGING_ENTRIES.has(entry) || !lstatSync(path).isFile()) return false;
      const item = entry === ".gitignore" ? `${name}.gitignore` : entry === "codegraph.db" ? `${name}.db` : undefined;
      if (item !== undefined && !provenCreation(baseDir, item, path)) return false;
    }
  } catch (error) {
    return errorCode(error) === "ENOENT";
  }
  for (const entry of entries) rmSync(join(staging, entry), { force: true });
  removeEmptyDirectory(staging);
  if (pathState(staging) !== "absent") return false;
  for (const item of [name, `${name}.gitignore`, `${name}.db`]) forgetCreation(baseDir, item);
  return true;
}

/**
 * Proof of creation. When archctx creates a path it may later remove or replace, it records the
 * path's creation identity (device, inode and birth time) as an empty file
 * `records/<item>@<identity>` in the base directory, created exclusively and never rewritten. A
 * backup restore or a same-bytes re-creation at that path has another identity, so it has no
 * record and archctx leaves it in place. Birth time, not ctime: a sync's writes and the install's
 * hard link change ctime but not the file. Moving a file's mtime before its birth time moves the
 * birth time on macOS, which also voids the proof, so that file is kept.
 */
function creationIdentity(path: string): string | undefined {
  try {
    const stat = lstatSync(path, { bigint: true });
    // A file system that reports no birth time gives no proof.
    return stat.birthtimeNs > 0n ? `${stat.dev}-${stat.ino}-${stat.birthtimeNs}` : undefined;
  } catch {
    return undefined;
  }
}

function recordCreation(baseDir: string, item: string, path: string): void {
  const identity = creationIdentity(path);
  if (identity === undefined) throw new Error("created path is gone");
  const records = join(baseDir, "records");
  mkdirSync(records, { recursive: true });
  try { closeSync(openSync(join(records, `${item}@${identity}`), "wx")); }
  catch (error) { if (errorCode(error) !== "EEXIST") throw error; }
}

function provenCreation(baseDir: string, item: string, path: string): boolean {
  const identity = creationIdentity(path);
  return identity !== undefined && existsFile(join(baseDir, "records", `${item}@${identity}`));
}

function forgetCreation(baseDir: string, item: string): void {
  let names: string[];
  try { names = readdirSync(join(baseDir, "records")); }
  catch { return; }
  for (const name of names) if (name.startsWith(`${item}@`)) rmSync(join(baseDir, "records", name), { force: true });
}

/** Removes a path archctx created, with proof; otherwise leaves it and reports it. */
function removeOwnFileWithProof(baseDir: string, item: string, path: string, report: (kept: string) => void): void {
  if (!provenCreation(baseDir, item, path)) { if (pathState(path) !== "absent") report(path); return; }
  try { unlinkSync(path); forgetCreation(baseDir, item); }
  catch { report(path); }
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
  /** The clock of `createdAt` and of garbage collection. */
  now?: () => number;
  /** Receives each path the refresh left in place because it could not prove archctx created it. */
  report?: (kept: string) => void;
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

  const report = options.report ?? (() => undefined);
  mkdirSync(baseDir, { recursive: true });
  const lock = join(baseDir, "refresh.lock");
  const acquired = acquirePidLock(baseDir, lock, report);
  if (acquired !== "acquired") return acquired;
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
    try {
      const headBefore = head(root);
      (options.snapshot ?? snapshotCodeGraphIndex)(join(root, ".codegraph", "codegraph.db"), target);
      recordCreation(baseDir, snapshot, target);
      if (headBefore === undefined || !session.unchangedSinceOpen() || head(root) !== headBefore || codeGraphIndexIdentity(root) !== identityAtStart) {
        removeOwnFileWithProof(baseDir, snapshot, target, report);
        return "skipped-moved";
      }
      const current = join(baseDir, "current.json");
      if (pathState(current) !== "absent" && !provenCreation(baseDir, "current.json", current)) {
        report(current);
        removeOwnFileWithProof(baseDir, snapshot, target, report);
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
      writeFileAtomically(current, `${JSON.stringify(pointer, null, 2)}\n`);
      forgetCreation(baseDir, "current.json");
      recordCreation(baseDir, "current.json", current);
    } catch (error) {
      removeOwnFileWithProof(baseDir, snapshot, target, report);
      throw error;
    } finally {
      session.close();
    }
    collectUnreferencedSnapshots(baseDir, snapshot, now(), report);
    return "published";
  } finally {
    releasePidLock(baseDir, lock);
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

/**
 * A pid file created exclusively and recorded. A stale one (dead or malformed holder) is replaced
 * once, only with proof that archctx created it; an unproven one stays and is reported.
 */
function acquirePidLock(baseDir: string, path: string, report: (kept: string) => void): "acquired" | "skipped-busy" | "skipped-unproven" {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      try { writeSync(fd, String(process.pid)); }
      finally { closeSync(fd); }
      try { recordCreation(baseDir, "refresh.lock", path); }
      catch (error) { unlinkSync(path); throw error; }
      return "acquired";
    } catch (error) {
      if (errorCode(error) !== "EEXIST" || pidLockLive(path)) return "skipped-busy";
      if (!provenCreation(baseDir, "refresh.lock", path)) { report(path); return "skipped-unproven"; }
      rmSync(path, { force: true });
      forgetCreation(baseDir, "refresh.lock");
    }
  }
  return "skipped-busy";
}

function releasePidLock(baseDir: string, path: string): void {
  try {
    if (readFileSync(path, "utf8").trim() === String(process.pid)) {
      unlinkSync(path);
      forgetCreation(baseDir, "refresh.lock");
    }
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
 * Deletes the `base-*.db` files of this version's directory that `current.json` does not name, that
 * are older than `SNAPSHOT_GC_AGE_MS`, and that carry the creation identity archctx recorded when
 * it wrote them. Nothing else, and no other version's directory, is touched; an unproven snapshot
 * stays and is reported. A file that cannot be deleted (on Windows, one a seeder still has open) is
 * left for the next refresh.
 */
function collectUnreferencedSnapshots(baseDir: string, current: string, now: number, report: (kept: string) => void): void {
  for (const name of readdirSync(baseDir)) {
    if (name === current || !SNAPSHOT_NAME.test(name)) continue;
    const path = join(baseDir, name);
    try {
      if (now - statSync(path).mtimeMs >= SNAPSHOT_GC_AGE_MS) removeOwnFileWithProof(baseDir, name, path, report);
    } catch {
      // Left for the next refresh.
    }
  }
}
