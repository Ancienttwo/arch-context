import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { bindRepository, matchesGlob, type GitTrackedTreeEntry, type RepositoryBinding } from "@archcontext/core/architecture-domain";
import { digestJson, type Json } from "@archcontext/contracts";
import { isGitRevisionArgument, localGitEnv, readGitBlobTree, readGitBlobs } from "./blob-reader";
import { GitVisibleFilesUnavailableError } from "./sparse-worktree";
import type { GitChangeSource, GitPathChange, GitPathChangeStatus } from "./workspace-packages";

export * from "./blob-reader";
export * from "./co-change";
export * from "./sparse-worktree";
export * from "./workspace-packages";

/** One `git cat-file --batch` carries every measured blob; a repository-sized tree needs the headroom. */
const GIT_CAT_FILE_MAX_BYTES = 512 * 1024 * 1024;

export function findRepositoryRoot(start: string): string {
  try {
    return resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: start,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim());
  } catch {
    let cursor = resolve(start);
    while (true) {
      if (existsSync(resolve(cursor, ".git"))) return cursor;
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    throw new Error(`Repository root not found from ${start}`);
  }
}

/** Owns a private, detached checkout of a previously resolved commit for the duration of a read. */
export async function withDetachedGitWorktree<T>(root: string, commitSha: string, read: (worktree: string) => T): Promise<T> {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), "archctx-debt-base-"));
  const worktree = join(parent, "checkout");
  const exec = promisify(execFile);
  const git = (...args: string[]) => exec("git", [
    "--no-replace-objects", "-c", `core.hooksPath=${parent}`, "-c", "core.fsmonitor=false",
    "-c", "submodule.recurse=false", "-c", "core.sparseCheckout=false", "-c", "index.sparse=false",
    "worktree", ...args
  ], { cwd: root, env: localGitEnv(), timeout: 120_000, encoding: "utf8" });
  const registered = async (): Promise<boolean> => (await git("list", "--porcelain", "-z")).stdout.split("\0")
    .some(entry => entry.startsWith("worktree ") && resolve(entry.slice("worktree ".length)) === worktree);
  const remove = () => git("remove", "--force", "--", worktree);
  let added = false;
  try {
    await git("add", "--detach", "--", worktree, commitSha);
    added = true;
    return await read(worktree);
  } finally {
    try {
      // A failed add can leave a registration if Git was interrupted after creating it.
      if (added || await registered()) {
        try {
          await remove();
        } catch (error) {
          // A terminal interrupt can reach Git as well as archctx, even during removal.
          const child = error as { signal?: NodeJS.Signals };
          if (child.signal !== "SIGINT" && child.signal !== "SIGTERM") throw error;
          if (await registered()) await remove();
        }
      }
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }
}

/**
 * The repository's Git-visible files: tracked plus untracked, non-ignored files
 * (`git ls-files --cached --others --exclude-standard`), relative to `root`. Projection footprints
 * are measured over them and every worktree digest (`computeWorktreeDigest`) hashes them. A
 * gitignored file — a build artifact, a cache, a nested `node_modules`, a local secret — is never
 * part of a capability's source, even when a `source.include` glob matches it, and never moves a
 * digest. Reads the index and the worktree only, never history, so it behaves the same in a
 * shallow clone. Paths that are not regular files in the worktree (a tracked file deleted locally,
 * a symlink, a submodule) are dropped: there are no bytes to digest.
 *
 * `pathspec` narrows the listing to one repo-relative directory (`git ls-files -- <pathspec>`) for a
 * reader that needs only that directory; paths stay relative to `root`.
 */
export function listGitVisibleFiles(root: string, pathspec?: string): string[] {
  let output: string;
  try {
    output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", ...(pathspec === undefined ? [] : ["--", pathspec])], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024
    });
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    const detail = typeof stderr === "string" && stderr.trim() !== "" ? stderr.trim() : error instanceof Error ? error.message : String(error);
    throw new GitVisibleFilesUnavailableError(root, detail);
  }
  return [...new Set(output.split("\0").filter(Boolean))]
    .filter((path) => {
      try {
        return lstatSync(join(root, path)).isFile();
      } catch {
        return false;
      }
    })
    .sort((left, right) => left.localeCompare(right));
}

export function readHeadSha(root: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "unborn";
  }
}

/**
 * The committer date of `HEAD`, normalized to UTC ISO-8601.
 *
 * This is the honest deterministic clock for anything measured at a commit: a measurement of
 * `HEAD` is dated by the commit it measured, so two runs at the same `HEAD` agree byte for byte
 * while still naming a real instant. An unborn or unreadable `HEAD` has no date to report and
 * fails closed rather than substituting the wall clock.
 */
export function readHeadCommitterDate(root: string): string {
  const raw = runGit(root, ["show", "-s", "--format=%cI", "HEAD"]).trim();
  const parsed = new Date(raw);
  if (raw === "" || Number.isNaN(parsed.getTime())) {
    throw new Error(`git-head-committer-date-unreadable: ${root}`);
  }
  return parsed.toISOString();
}

export function readRepositoryBinding(start: string): RepositoryBinding {
  const root = findRepositoryRoot(start);
  return bindRepository(root, readHeadSha(root), listGitVisibleFiles(root));
}

export interface GitChangeMetadata {
  schemaVersion: "archcontext.git-change-metadata/v1";
  source: GitChangeSource;
  baseSha?: string;
  headSha: string;
  paths: GitPathChange[];
  pathCount: number;
  metadataDigest: string;
}

export function readCommitChangeMetadata(root: string, ref = "HEAD"): GitChangeMetadata {
  assertGitRevisionArgument(ref);
  const headSha = runGit(root, ["rev-parse", ref]).trim();
  const parentLine = runGit(root, ["rev-list", "--parents", "-n", "1", ref]).trim();
  const baseSha = parentLine.split(/\s+/)[1] ?? "root";
  const paths = parseNameStatusZ(runGit(root, ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-z", ref]));
  return gitChangeMetadata({ source: "commit", baseSha, headSha, paths });
}

export function readStagedChangeMetadata(root: string, baseRef = "HEAD"): GitChangeMetadata {
  assertGitRevisionArgument(baseRef);
  const headSha = readHeadSha(root);
  const baseSha = gitSucceeds(root, ["rev-parse", "--verify", baseRef])
    ? runGit(root, ["rev-parse", baseRef]).trim()
    : "unborn";
  const paths = parseNameStatusZ(runGit(root, ["diff", "--cached", "--name-status", "-z", "--"]));
  return gitChangeMetadata({ source: "staged", baseSha, headSha, paths });
}

export function readWorktreeChangeMetadata(root: string): GitChangeMetadata {
  const headSha = readHeadSha(root);
  const tracked = parseNameStatusZ(runGit(root, ["diff", "--name-status", "-z", "--"]));
  const untracked = runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .map((path) => ({ path, status: "added" as const, rawStatus: "??" }));
  return gitChangeMetadata({ source: "worktree", baseSha: headSha, headSha, paths: dedupeGitPathChanges([...tracked, ...untracked]) });
}

export function readTrackedTreeEntries(root: string, ref = "HEAD"): GitTrackedTreeEntry[] {
  assertGitRevisionArgument(ref);
  return readGitBlobTree(root, ref, { maxBytes: GIT_CAT_FILE_MAX_BYTES, sizes: false, trees: false })
    .map(({ path, mode, type, objectId }) => ({ path, mode, type, objectId }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export interface TrackedSourceFileV1 {
  path: string;
  lineCount: number;
}

/**
 * Git-tracked source files with their line counts, measured from the HEAD blobs.
 */
export function readTrackedSourceFiles(root: string, options: { include?: string[]; paths?: ReadonlySet<string> } = {}): TrackedSourceFileV1[] {
  const entries = readTrackedTreeEntries(root)
    .filter((entry) => entry.type === "blob" && (options.paths === undefined || options.paths.has(entry.path)))
    .filter((entry) => options.include === undefined || options.include.some((pattern) => matchesGlob(entry.path, pattern)))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  if (entries.length === 0) return [];
  try {
    const blobs = readGitBlobs(root, entries, { fileBytes: GIT_CAT_FILE_MAX_BYTES, inputBytes: GIT_CAT_FILE_MAX_BYTES, responseBytes: GIT_CAT_FILE_MAX_BYTES });
    return entries.map((entry, index) => ({ path: entry.path, lineCount: countLines(blobs[index]!) }));
  } catch {
    throw new Error(`git-tracked-blob-unreadable: ${entries.map(entry => entry.path).join(", ")}`);
  }
}

export function isTrackedWorktreeClean(root: string, readOnly = false): boolean {
  if (!readOnly) {
    return gitSucceeds(root, ["diff", "--quiet", "--ignore-submodules=none", "--"])
      && gitSucceeds(root, ["diff", "--cached", "--quiet", "--ignore-submodules=none", "--"]);
  }
  const env = localGitEnv();
  const diff = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false",
    "diff", "--no-ext-diff", "--no-textconv", "--ignore-submodules=none"];
  // With refresh disabled, --quiet can treat stat-only changes as dirty. A patch compares the
  // Git-filtered file to its indexed blob without updating the index.
  const unstaged = spawnSync("git", [...diff, "--patch", "--"], {
    cwd: root, env, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1
  });
  return unstaged.status === 0 && unstaged.stdout.length === 0
    && gitSucceeds(root, [...diff, "--cached", "--quiet", "--"], env);
}

/** Same counting rule as the projection engine's footprint scan: a trailing newline is a terminator, not a line. */
function countLines(content: Buffer): number {
  if (content.length === 0) return 0;
  let newlines = 0;
  for (const byte of content) if (byte === 0x0a) newlines += 1;
  return content[content.length - 1] === 0x0a ? newlines : newlines + 1;
}

function parseNameStatusZ(output: string): GitPathChange[] {
  const tokens = output.split("\0").filter(Boolean);
  const changes: GitPathChange[] = [];
  for (let index = 0; index < tokens.length;) {
    const rawStatus = tokens[index++] ?? "";
    if (!rawStatus) continue;
    if (rawStatus.startsWith("R") || rawStatus.startsWith("C")) {
      const previousPath = tokens[index++];
      const path = tokens[index++];
      if (!path || !previousPath) throw new Error(`git-name-status-invalid: ${rawStatus}`);
      changes.push({ path, previousPath, rawStatus, status: statusFromNameStatus(rawStatus) });
      continue;
    }
    const path = tokens[index++];
    if (!path) throw new Error(`git-name-status-invalid: ${rawStatus}`);
    changes.push({ path, rawStatus, status: statusFromNameStatus(rawStatus) });
  }
  return dedupeGitPathChanges(changes);
}

function statusFromNameStatus(status: string): GitPathChangeStatus {
  const code = status[0];
  if (code === "A") return "added";
  if (code === "M") return "modified";
  if (code === "D") return "deleted";
  if (code === "R") return "renamed";
  if (code === "C") return "copied";
  if (code === "T") return "typechanged";
  if (code === "U") return "unmerged";
  return "unknown";
}

function gitChangeMetadata(input: {
  source: GitChangeSource;
  baseSha?: string;
  headSha: string;
  paths: GitPathChange[];
}): GitChangeMetadata {
  const paths = dedupeGitPathChanges(input.paths);
  const payload = {
    schemaVersion: "archcontext.git-change-metadata/v1" as const,
    source: input.source,
    baseSha: input.baseSha,
    headSha: input.headSha,
    paths,
    pathCount: paths.length
  };
  return {
    ...payload,
    metadataDigest: digestJson(payload as unknown as Json)
  };
}

function dedupeGitPathChanges(changes: GitPathChange[]): GitPathChange[] {
  return [...new Map(changes
    .sort((left, right) =>
      left.path.localeCompare(right.path)
      || (left.previousPath ?? "").localeCompare(right.previousPath ?? "")
      || left.rawStatus.localeCompare(right.rawStatus))
    .map((change) => [`${change.rawStatus}\0${change.previousPath ?? ""}\0${change.path}`, change])).values()];
}

function assertGitRevisionArgument(ref: string): void {
  if (!isGitRevisionArgument(ref)) throw new Error(`invalid git revision argument: ${JSON.stringify(ref)}`);
}

function runGit(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function gitSucceeds(root: string, args: string[], env?: NodeJS.ProcessEnv): boolean {
  const result = spawnSync("git", args, {
    cwd: root,
    env,
    stdio: ["ignore", "ignore", "ignore"]
  });
  return result.status === 0;
}
