import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isTrackedWorktreeClean,
  prepareDetachedReviewWorktree,
  readTrackedTreeEntries,
  readRepositoryBinding,
  readHeadSha,
  findRepositoryRoot,
  removeDetachedReviewWorktree,
  verifyDetachedReviewWorktree
} from "../src/index";

describe("@archcontext/local-runtime/git-adapter", () => {
  test("discovers the current repository root and HEAD binding", () => {
    const root = findRepositoryRoot(process.cwd());
    expect(root.length).toBeGreaterThan(0);
    expect(findRepositoryRoot(root)).toBe(root);

    const headSha = readHeadSha(root);
    expect(headSha).toMatch(/^[a-f0-9]{40}$/);

    const binding = readRepositoryBinding(process.cwd());
    expect(binding.root).toBe(root);
    expect(binding.headSha).toBe(headSha);
    expect(binding.repositoryId).toMatch(/^repo\.[a-f0-9]{16}$/);
    expect(binding.worktreeDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test("creates a detached temporary worktree at an exact clean commit", () => {
    const root = createGitFixture();
    const tempRoot = mkdtempSync(join(tmpdir(), "archctx-review-worktrees-"));
    try {
      writeFileSync(join(root, "tracked.txt"), "dirty source checkout\n");
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const headTreeOid = gitOut(root, "rev-parse", "HEAD^{tree}");

      const prepared = prepareDetachedReviewWorktree({ sourceRoot: root, headSha, expectedHeadTreeOid: headTreeOid, tempRoot });

      expect(prepared.accepted).toBe(true);
      expect(prepared.reasonCode).toBeUndefined();
      expect(prepared.worktree?.headSha).toBe(headSha);
      expect(prepared.worktree?.headTreeOid).toBe(headTreeOid);
      expect(prepared.worktree?.detached).toBe(true);
      expect(prepared.worktree?.clean).toBe(true);
      expect(prepared.worktree?.worktreeRoot).not.toBe(root);
      expect(gitOut(prepared.worktree!.worktreeRoot, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");
      expect(readFileSync(join(prepared.worktree!.worktreeRoot, "tracked.txt"), "utf8")).toBe("committed\n");
      expect(isTrackedWorktreeClean(prepared.worktree!.worktreeRoot)).toBe(true);
      expect(readTrackedTreeEntries(prepared.worktree!.worktreeRoot)).toEqual([
        {
          mode: "100644",
          type: "blob",
          objectId: gitOut(root, "rev-parse", "HEAD:tracked.txt"),
          path: "tracked.txt"
        }
      ]);

      removeDetachedReviewWorktree(prepared.worktree!);
      expect(existsSync(prepared.worktree!.worktreeRoot)).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
      removeTempRoot(root);
    }
  });

  test("rejects unavailable heads, tree mismatches, non-detached roots, and dirty tracked worktrees", () => {
    const root = createGitFixture();
    const tempRoot = mkdtempSync(join(tmpdir(), "archctx-review-worktrees-"));
    let acceptedWorktree: ReturnType<typeof prepareDetachedReviewWorktree>["worktree"] | undefined;
    try {
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const headTreeOid = gitOut(root, "rev-parse", "HEAD^{tree}");
      const missing = prepareDetachedReviewWorktree({ sourceRoot: root, headSha: "f".repeat(40), tempRoot });
      expect(missing).toMatchObject({ accepted: false, reasonCode: "HEAD_UNAVAILABLE" });

      const wrongTree = prepareDetachedReviewWorktree({
        sourceRoot: root,
        headSha,
        expectedHeadTreeOid: "0".repeat(40),
        tempRoot
      });
      expect(wrongTree).toMatchObject({ accepted: false, reasonCode: "TREE_OID_MISMATCH" });
      expect(wrongTree.worktree).toBeUndefined();

      const branchRoot = verifyDetachedReviewWorktree({
        worktreeRoot: root,
        expectedHeadSha: headSha,
        expectedHeadTreeOid: headTreeOid
      });
      expect(branchRoot).toMatchObject({ accepted: false, reasonCode: "WORKTREE_NOT_DETACHED" });

      const prepared = prepareDetachedReviewWorktree({ sourceRoot: root, headSha, expectedHeadTreeOid: headTreeOid, tempRoot });
      expect(prepared.accepted).toBe(true);
      acceptedWorktree = prepared.worktree;
      writeFileSync(join(acceptedWorktree!.worktreeRoot, "tracked.txt"), "dirty detached worktree\n");
      const dirty = verifyDetachedReviewWorktree({
        worktreeRoot: acceptedWorktree!.worktreeRoot,
        expectedHeadSha: headSha,
        expectedHeadTreeOid: headTreeOid
      });
      expect(dirty).toMatchObject({ accepted: false, reasonCode: "WORKTREE_NOT_CLEAN" });

      const wrongHead = verifyDetachedReviewWorktree({
        worktreeRoot: acceptedWorktree!.worktreeRoot,
        expectedHeadSha: "e".repeat(40),
        expectedHeadTreeOid: headTreeOid
      });
      expect(wrongHead).toMatchObject({ accepted: false, reasonCode: "HEAD_SHA_MISMATCH" });
    } finally {
      if (acceptedWorktree) removeDetachedReviewWorktree(acceptedWorktree);
      rmSync(tempRoot, { recursive: true, force: true });
      removeTempRoot(root);
    }
  });
});

function createGitFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-git-adapter-"));
  writeFileSync(join(root, "tracked.txt"), "committed\n");
  git(root, "init");
  git(root, "add", ".");
  git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture");
  return root;
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function gitOut(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function removeTempRoot(root: string): void {
  rmSync(root, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
}
