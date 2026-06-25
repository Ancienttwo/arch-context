import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { bindRepository, type GitTrackedTreeEntry, type RepositoryBinding } from "@archcontext/core/architecture-domain";
import { digestJson, type Json } from "@archcontext/contracts";

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

export function readRepositoryBinding(start: string): RepositoryBinding {
  const root = findRepositoryRoot(start);
  return bindRepository(root, readHeadSha(root));
}

export type GitChangeSource = "commit" | "staged" | "worktree";
export type GitPathChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "typechanged" | "unmerged" | "unknown";

export interface GitPathChange {
  path: string;
  previousPath?: string;
  status: GitPathChangeStatus;
  rawStatus: string;
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

export interface GitChangeFingerprintInput {
  schemaVersion?: "archcontext.git-change-fingerprint-input/v1";
  repositoryId: string;
  baseSha: string;
  headSha: string;
  paths: Array<string | GitPathChange>;
  codeFactsDigest: string;
  analysisKind?: string;
}

export function readCommitChangeMetadata(root: string, ref = "HEAD"): GitChangeMetadata {
  const headSha = runGit(root, ["rev-parse", ref]).trim();
  const parentLine = runGit(root, ["rev-list", "--parents", "-n", "1", ref]).trim();
  const baseSha = parentLine.split(/\s+/)[1] ?? "root";
  const paths = parseNameStatusZ(runGit(root, ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-z", ref]));
  return gitChangeMetadata({ source: "commit", baseSha, headSha, paths });
}

export function readStagedChangeMetadata(root: string, baseRef = "HEAD"): GitChangeMetadata {
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

export function computeGitChangeFingerprint(input: GitChangeFingerprintInput): string {
  const paths = input.paths
    .map((item) => typeof item === "string" ? item : item.path)
    .filter(Boolean)
    .sort();
  return digestJson({
    schemaVersion: "archcontext.git-change-fingerprint-input/v1",
    repositoryId: input.repositoryId,
    baseSha: input.baseSha,
    headSha: input.headSha,
    paths: [...new Set(paths)],
    codeFactsDigest: input.codeFactsDigest,
    analysisKind: input.analysisKind ?? "architecture-change"
  } as unknown as Json);
}

export type DetachedReviewWorktreeReason =
  | "HEAD_UNAVAILABLE"
  | "HEAD_SHA_MISMATCH"
  | "TREE_OID_MISMATCH"
  | "WORKTREE_NOT_DETACHED"
  | "WORKTREE_NOT_CLEAN";

export interface DetachedReviewWorktree {
  schemaVersion: "archcontext.detached-review-worktree/v1";
  sourceRoot: string;
  worktreeRoot: string;
  temporaryRoot: string;
  headSha: string;
  headTreeOid: string;
  detached: true;
  clean: true;
}

export interface DetachedReviewWorktreeVerification {
  schemaVersion: "archcontext.detached-review-worktree-verification/v1";
  accepted: boolean;
  reasonCode?: DetachedReviewWorktreeReason;
  expected: {
    headSha: string;
    headTreeOid?: string;
  };
  observed: {
    headSha?: string;
    headTreeOid?: string;
    detached?: boolean;
    clean?: boolean;
  };
}

export interface DetachedReviewWorktreePreparation extends DetachedReviewWorktreeVerification {
  worktree?: DetachedReviewWorktree;
}

export function readHeadTreeOid(root: string, ref = "HEAD"): string {
  return runGit(root, ["rev-parse", `${ref}^{tree}`]).trim();
}

export function readTrackedTreeEntries(root: string, ref = "HEAD"): GitTrackedTreeEntry[] {
  const output = runGit(root, ["ls-tree", "-rz", "-r", ref]);
  if (output.length === 0) return [];
  return output.split("\0")
    .filter(Boolean)
    .map(parseLsTreeEntry)
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function isDetachedHead(root: string): boolean {
  return runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() === "HEAD";
}

export function isTrackedWorktreeClean(root: string): boolean {
  return gitSucceeds(root, ["diff", "--quiet", "--ignore-submodules=none", "--"])
    && gitSucceeds(root, ["diff", "--cached", "--quiet", "--ignore-submodules=none", "--"]);
}

export function verifyDetachedReviewWorktree(input: {
  worktreeRoot: string;
  expectedHeadSha: string;
  expectedHeadTreeOid?: string;
}): DetachedReviewWorktreeVerification {
  const observed = readDetachedWorktreeObserved(input.worktreeRoot);
  const base = {
    schemaVersion: "archcontext.detached-review-worktree-verification/v1" as const,
    expected: {
      headSha: input.expectedHeadSha,
      headTreeOid: input.expectedHeadTreeOid
    },
    observed
  };

  if (!observed.headSha || !observed.headTreeOid) return { ...base, accepted: false, reasonCode: "HEAD_UNAVAILABLE" };
  if (observed.headSha !== input.expectedHeadSha) return { ...base, accepted: false, reasonCode: "HEAD_SHA_MISMATCH" };
  if (input.expectedHeadTreeOid && observed.headTreeOid !== input.expectedHeadTreeOid) {
    return { ...base, accepted: false, reasonCode: "TREE_OID_MISMATCH" };
  }
  if (observed.detached !== true) return { ...base, accepted: false, reasonCode: "WORKTREE_NOT_DETACHED" };
  if (observed.clean !== true) return { ...base, accepted: false, reasonCode: "WORKTREE_NOT_CLEAN" };
  return { ...base, accepted: true };
}

export function prepareDetachedReviewWorktree(input: {
  sourceRoot: string;
  headSha: string;
  expectedHeadTreeOid?: string;
  tempRoot?: string;
}): DetachedReviewWorktreePreparation {
  const sourceRoot = findRepositoryRoot(input.sourceRoot);
  const expectedHeadTreeOid = input.expectedHeadTreeOid ?? readCommitTreeOid(sourceRoot, input.headSha);
  if (!expectedHeadTreeOid) {
    return {
      schemaVersion: "archcontext.detached-review-worktree-verification/v1",
      accepted: false,
      reasonCode: "HEAD_UNAVAILABLE",
      expected: { headSha: input.headSha, headTreeOid: input.expectedHeadTreeOid },
      observed: {}
    };
  }

  const parent = input.tempRoot ? resolve(input.tempRoot) : tmpdir();
  mkdirSync(parent, { recursive: true });
  const temporaryRoot = mkdtempSync(join(parent, "archctx-review-worktree-"));
  const worktreeRoot = join(temporaryRoot, "worktree");
  try {
    runGit(sourceRoot, ["worktree", "add", "--detach", worktreeRoot, input.headSha]);
    const verification = verifyDetachedReviewWorktree({
      worktreeRoot,
      expectedHeadSha: input.headSha,
      expectedHeadTreeOid
    });
    if (!verification.accepted) {
      removeDetachedReviewWorktree({ sourceRoot, worktreeRoot, temporaryRoot });
      return verification;
    }
    const observedHeadSha = verification.observed.headSha;
    const observedHeadTreeOid = verification.observed.headTreeOid;
    if (!observedHeadSha || !observedHeadTreeOid) throw new Error("detached-worktree-verification-invariant");
    return {
      ...verification,
      worktree: {
        schemaVersion: "archcontext.detached-review-worktree/v1",
        sourceRoot,
        worktreeRoot,
        temporaryRoot,
        headSha: observedHeadSha,
        headTreeOid: observedHeadTreeOid,
        detached: true,
        clean: true
      }
    };
  } catch (error) {
    removePathWithRetry(temporaryRoot);
    if (isGitWorktreeError(error)) {
      return {
        schemaVersion: "archcontext.detached-review-worktree-verification/v1",
        accepted: false,
        reasonCode: "HEAD_UNAVAILABLE",
        expected: { headSha: input.headSha, headTreeOid: input.expectedHeadTreeOid },
        observed: {}
      };
    }
    throw error;
  }
}

export function removeDetachedReviewWorktree(worktree: Pick<DetachedReviewWorktree, "sourceRoot" | "worktreeRoot" | "temporaryRoot">): void {
  try {
    runGit(worktree.sourceRoot, ["worktree", "remove", "--force", worktree.worktreeRoot]);
  } catch {
    removePathWithRetry(worktree.worktreeRoot);
  } finally {
    removePathWithRetry(worktree.temporaryRoot || dirname(worktree.worktreeRoot));
  }
}

export function removePathWithRetry(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
}

function readCommitTreeOid(root: string, headSha: string): string | undefined {
  if (!gitSucceeds(root, ["cat-file", "-e", `${headSha}^{commit}`])) return undefined;
  try {
    return readHeadTreeOid(root, headSha);
  } catch {
    return undefined;
  }
}

function parseLsTreeEntry(entry: string): GitTrackedTreeEntry {
  const match = entry.match(/^(\d{6}) (blob|tree|commit) ([a-f0-9]{40,64})\t(.+)$/);
  if (!match) throw new Error(`git-ls-tree-entry-invalid: ${entry}`);
  return {
    mode: match[1],
    type: match[2] as GitTrackedTreeEntry["type"],
    objectId: match[3],
    path: match[4]
  };
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

function readDetachedWorktreeObserved(worktreeRoot: string): DetachedReviewWorktreeVerification["observed"] {
  try {
    return {
      headSha: runGit(worktreeRoot, ["rev-parse", "HEAD"]).trim(),
      headTreeOid: readHeadTreeOid(worktreeRoot),
      detached: isDetachedHead(worktreeRoot),
      clean: isTrackedWorktreeClean(worktreeRoot)
    };
  } catch {
    return {};
  }
}

function runGit(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function gitSucceeds(root: string, args: string[]): boolean {
  const result = spawnSync("git", args, {
    cwd: root,
    stdio: ["ignore", "ignore", "ignore"]
  });
  return result.status === 0;
}

function isGitWorktreeError(error: unknown): boolean {
  return error instanceof Error && /git|Command failed/.test(error.message);
}
