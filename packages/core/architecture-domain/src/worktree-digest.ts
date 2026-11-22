import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { digestJson, isRepoRelativePosixPath, stableId, type Json } from "@archcontext/contracts";

export interface RepositoryBinding {
  repositoryId: string;
  root: string;
  headSha: string;
  worktreeDigest: string;
}

export interface WorktreeDigestOptions {
  ignore?: string[];
}

export interface GitTrackedTreeEntry {
  mode: string;
  type: "blob" | "tree" | "commit";
  objectId: string;
  path: string;
}

export interface ReviewWorktreeDigestInput {
  repositoryNumericId: number;
  headSha: string;
  headTreeOid: string;
  trackedTree: GitTrackedTreeEntry[];
  sparseScope?: string[];
}

const DEFAULT_IGNORES = new Set([
  ".git",
  ".codegraph",
  "node_modules",
  "coverage",
  "artifacts",
  "_ops",
  "_ref",
  ".archcontext/.local",
  ".claude/.session-id",
  ".claude/.trace.jsonl",
  ".DS_Store"
]);

export function repositoryFingerprint(root: string): string {
  const normalized = canonicalRepositoryRoot(root);
  return `repo.${createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;
}

export function canonicalRepositoryRoot(root: string): string {
  const resolved = resolve(root);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function normalizeDottedId(value: string): string {
  return value
    .split(".")
    .map((part) => stableId(part))
    .filter(Boolean)
    .join(".");
}

/**
 * Digest of the worktree files a precondition binds. `files` is the repository's Git-visible
 * universe (tracked plus untracked, non-ignored regular files), listed by the local runtime's Git
 * adapter (`listGitVisibleFiles`); core never walks the filesystem for it, so a gitignored tree — a
 * nested `node_modules`, build output, a desktop worktree — can never move the digest. The fixed
 * ignores and `options.ignore` exclude further paths from that universe. A tracked file deleted
 * locally is absent from the listing, so the deletion still changes the digest.
 */
export function computeWorktreeDigest(root: string, files: readonly string[], options: WorktreeDigestOptions = {}): string {
  return digestJson(worktreeDigestPaths(files, options).map((path) => readWorktreeDigestEntry(root, path)));
}

/** Hashes two views of one worktree, reusing the content hash for files shared by both. */
export function computeWorktreeDigests(
  root: string,
  gitVisibleFiles: readonly string[],
  secondView: { files: readonly string[]; options: WorktreeDigestOptions }
): [string, string] {
  const entries = new Map<string, ReturnType<typeof readWorktreeDigestEntry>>();
  const digest = (paths: string[]) => digestJson(paths.map((path) => {
    const existing = entries.get(path);
    if (existing) return existing;
    const entry = readWorktreeDigestEntry(root, path);
    entries.set(path, entry);
    return entry;
  }));
  return [digest(worktreeDigestPaths(gitVisibleFiles, {})), digest(worktreeDigestPaths(secondView.files, secondView.options))];
}

function worktreeDigestPaths(files: readonly string[], options: WorktreeDigestOptions): string[] {
  // An untyped caller that omits the listing must fail, never digest an empty universe.
  if (!Array.isArray(files)) throw new TypeError("computeWorktreeDigest requires the Git-visible file list");
  // Hook output changes between preview and apply; harness policy remains part of the binding.
  const ignore = [
    ...DEFAULT_IGNORES,
    ".ai/harness/checks",
    ".ai/harness/evidence",
    ".ai/harness/runs",
    ...(options.ignore ?? [])
  ];
  return [...new Set(files)]
    .filter((path) => !ignore.some((pattern) => path === pattern || path.startsWith(`${pattern}/`)))
    .sort();
}

function readWorktreeDigestEntry(root: string, path: string) {
  const absolute = resolve(root, path);
  return {
    path,
    size: statSync(absolute).size,
    digest: createHash("sha256").update(readFileSync(absolute)).digest("hex")
  };
}

export function computeReviewWorktreeDigest(input: ReviewWorktreeDigestInput): string {
  const trackedTree = input.trackedTree
    .map((entry) => ({
      mode: entry.mode,
      type: entry.type,
      objectId: entry.objectId,
      path: entry.path
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return digestJson({
    schemaVersion: "archcontext.review-worktree-digest/v1",
    repositoryNumericId: input.repositoryNumericId,
    headSha: input.headSha,
    headTreeOid: input.headTreeOid,
    sparseScope: [...(input.sparseScope ?? [])].sort(),
    trackedTree
  } as unknown as Json);
}

/** `files` is the Git-visible universe of `root`, as `computeWorktreeDigest` takes it. */
export function bindRepository(root: string, headSha: string, files: readonly string[]): RepositoryBinding {
  const canonicalRoot = canonicalRepositoryRoot(root);
  return {
    repositoryId: repositoryFingerprint(canonicalRoot),
    root: canonicalRoot,
    headSha,
    worktreeDigest: computeWorktreeDigest(canonicalRoot, files)
  };
}

export function assertRepoRelativePath(path: string): void {
  if (!isRepoRelativePosixPath(path)) {
    throw new Error(`Repository path must be relative POSIX path: ${path}`);
  }
}

export function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}
