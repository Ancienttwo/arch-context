import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { readGitBlobs, readOnlyGit } from "./blob-reader";

/**
 * Thrown when the Git-visible file universe cannot be listed: `root` is not a Git worktree, or
 * `git` cannot run. Projection footprints and worktree digests are defined over Git-visible files,
 * so there is no filesystem fallback that could silently pull ignored files back in. Surfaces map it
 * to `AC_REPO_NOT_FOUND` with reasonCode `git-worktree-required`.
 */
export class GitVisibleFilesUnavailableError extends Error {
  readonly code = "AC_REPO_NOT_FOUND" as const;
  readonly reasonCode = "git-worktree-required" as const;
  constructor(readonly root: string, cause: string) {
    super(`Git-visible files require a Git worktree at ${root}: ${cause}`);
    this.name = "GitVisibleFilesUnavailableError";
  }
}

export function readCurrentBranch(root: string): string {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return branch === "HEAD" ? "detached" : branch;
  } catch {
    return "unknown";
  }
}

/** Distinguishes absent skip-worktree entries from tracked paths deleted in a full checkout. */
export function hasSkippedWorktreePaths(root: string): boolean {
  const entries = readOnlyGit(root, "ls-files", ["--cached", "-t", "-z", "--"], { maxBytes: 256 * 1024 * 1024 });
  return entries.toString("utf8").split("\0").some(entry => entry.startsWith("S ") && !existsSync(join(root, entry.slice(2))));
}

export interface SkippedWorktreeEntry {
  path: string;
  objectId: string;
}

/** Lists skip-worktree (`S `) index entries matching `pathOrPrefix` (#643 Comment 5). */
export function listSkippedWorktreeEntries(root: string, pathOrPrefix: string): SkippedWorktreeEntry[] {
  const raw = readOnlyGit(root, "ls-files", ["--cached", "--stage", "-t", "-z", "--", pathOrPrefix], {
    maxBytes: 64 * 1024 * 1024
  }).toString("utf8");
  const entries: SkippedWorktreeEntry[] = [];
  for (const line of raw.split("\0")) {
    if (!line.startsWith("S ")) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const meta = line.slice(2, tab).split(/\s+/);
    const objectId = meta[1];
    const path = line.slice(tab + 1);
    if (objectId && path) entries.push({ path, objectId });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export function listSkippedWorktreePaths(root: string, pathOrPrefix: string): string[] {
  return listSkippedWorktreeEntries(root, pathOrPrefix).map((entry) => entry.path);
}

/** True when `repoPath` itself or its hidden parent directory is marked skip-worktree in the index. */
export function isPathHiddenBySparseCheckout(root: string, repoPath: string): boolean {
  if (listSkippedWorktreeEntries(root, repoPath).length > 0) return true;
  if (!existsSync(join(root, repoPath))) {
    const parentDir = dirname(repoPath);
    if (parentDir !== "." && !existsSync(join(root, parentDir)) && listSkippedWorktreeEntries(root, parentDir).length > 0) {
      return true;
    }
    const rootSegment = repoPath.split("/")[0];
    if (rootSegment && rootSegment !== repoPath && !existsSync(join(root, rootSegment)) && listSkippedWorktreeEntries(root, rootSegment).length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Reads skip-worktree blobs under `directoryPrefix` directly from the Git object database without
 * modifying sparse checkout rules or materializing working-tree files (#643 Comment 5).
 */
export function readSkippedWorktreeBlobs(root: string, directoryPrefix: string): Map<string, string> {
  const entries = listSkippedWorktreeEntries(root, directoryPrefix);
  const decoded = new Map<string, string>();
  if (entries.length === 0) return decoded;
  const blobs = readGitBlobs(root, entries.map((entry) => ({ objectId: entry.objectId })));
  for (let index = 0; index < entries.length; index += 1) {
    decoded.set(entries[index]!.path, blobs[index]!.toString("utf8"));
  }
  return decoded;
}

/** A repo-relative path that the repository's ignore rules exclude, and the rule that excludes it. */
export interface IgnoredRepositoryPath {
  path: string;
  source: string;
  line: number;
  pattern: string;
}

/**
 * The `paths` that Git's own ignore evaluation excludes (`git check-ignore --no-index`), each with
 * its deciding rule. A path ending in `/` asks about the directory, so a parent rule such as a
 * blanket `/.archcontext/` that cancels later negations is reported. `--no-index` judges the rules
 * alone: a force-added file under an ignored directory still leaves new siblings invisible to Git.
 * A path whose last matching rule is a negation is not ignored and is not returned.
 */
export function ignoredRepositoryPaths(root: string, paths: readonly string[]): IgnoredRepositoryPath[] {
  if (paths.length === 0) return [];
  const result = spawnSync("git", ["check-ignore", "--verbose", "--no-index", "-z", "--stdin"], {
    cwd: root,
    encoding: "utf8",
    input: paths.map((path) => `${path}\0`).join(""),
    stdio: ["pipe", "pipe", "pipe"]
  });
  // Exit 1 means no path is ignored; anything other than 0 or 1 is a Git failure.
  if (result.status !== 0 && result.status !== 1) {
    const detail = result.error?.message ?? (result.stderr.trim() || `git check-ignore exited ${result.status}`);
    throw new GitVisibleFilesUnavailableError(root, detail);
  }
  const fields = result.stdout.split("\0");
  const ignored: IgnoredRepositoryPath[] = [];
  for (let index = 0; index + 3 < fields.length; index += 4) {
    const [source, line, pattern, path] = fields.slice(index, index + 4) as [string, string, string, string];
    if (pattern.startsWith("!")) continue;
    ignored.push({ path, source, line: Number(line), pattern });
  }
  return ignored;
}
