import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { bindRepository, type GitTrackedTreeEntry, type RepositoryBinding } from "@archcontext/core/architecture-domain";

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
    rmSync(temporaryRoot, { recursive: true, force: true });
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
    rmSync(worktree.worktreeRoot, { recursive: true, force: true });
  } finally {
    rmSync(worktree.temporaryRoot || dirname(worktree.worktreeRoot), { recursive: true, force: true });
  }
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
