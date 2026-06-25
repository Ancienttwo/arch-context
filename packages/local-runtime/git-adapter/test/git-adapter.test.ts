import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeGitChangeFingerprint,
  isTrackedWorktreeClean,
  prepareDetachedReviewWorktree,
  readCommitChangeMetadata,
  readTrackedTreeEntries,
  readRepositoryBinding,
  readHeadSha,
  readStagedChangeMetadata,
  readWorktreeChangeMetadata,
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

  test("non-repository roots fail without walking past the filesystem root", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-git-adapter-nonrepo-"));
    try {
      expect(() => findRepositoryRoot(root)).toThrow("Repository root not found");
    } finally {
      removeTempRoot(root);
    }
  });

  test("reads commit, staged, and worktree change metadata without source or diff bodies", () => {
    const root = createGitFixture();
    try {
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const commit = readCommitChangeMetadata(root);
      expect(commit).toMatchObject({
        source: "commit",
        baseSha: "root",
        headSha,
        pathCount: 1,
        paths: [{ path: "tracked.txt", status: "added", rawStatus: "A" }]
      });

      writeFileSync(join(root, "staged.ts"), "export const staged = true;\n");
      git(root, "add", "staged.ts");
      const staged = readStagedChangeMetadata(root);
      expect(staged).toMatchObject({
        source: "staged",
        baseSha: headSha,
        headSha,
        paths: [{ path: "staged.ts", status: "added", rawStatus: "A" }]
      });

      writeFileSync(join(root, "tracked.txt"), "dirty source checkout\n");
      writeFileSync(join(root, "untracked.ts"), "export const untracked = true;\n");
      const worktree = readWorktreeChangeMetadata(root);
      expect(worktree.source).toBe("worktree");
      expect(worktree.headSha).toBe(headSha);
      expect(worktree.paths).toEqual([
        { path: "tracked.txt", rawStatus: "M", status: "modified" },
        { path: "untracked.ts", rawStatus: "??", status: "added" }
      ]);

      const encoded = JSON.stringify({ commit, staged, worktree });
      expect(encoded).not.toContain("dirty source checkout");
      expect(encoded).not.toContain("export const");
      expect(commit.metadataDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(staged.metadataDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(worktree.metadataDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    } finally {
      removeTempRoot(root);
    }
  });

  test("computes stable change fingerprints from repository, revisions, paths, analysis kind, and CodeGraph digest", () => {
    const first = computeGitChangeFingerprint({
      repositoryId: "repo.test",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      paths: ["src/b.ts", "src/a.ts", "src/a.ts"],
      codeFactsDigest: `sha256:${"1".repeat(64)}`,
      analysisKind: "architecture-delta"
    });
    const reordered = computeGitChangeFingerprint({
      repositoryId: "repo.test",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      paths: [{ path: "src/a.ts", status: "modified", rawStatus: "M" }, { path: "src/b.ts", status: "added", rawStatus: "A" }],
      codeFactsDigest: `sha256:${"1".repeat(64)}`,
      analysisKind: "architecture-delta"
    });
    const differentFacts = computeGitChangeFingerprint({
      repositoryId: "repo.test",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      paths: ["src/a.ts", "src/b.ts"],
      codeFactsDigest: `sha256:${"2".repeat(64)}`,
      analysisKind: "architecture-delta"
    });

    expect(first).toBe(reordered);
    expect(first).not.toBe(differentFacts);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
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
      expect(readText(join(prepared.worktree!.worktreeRoot, "tracked.txt"))).toBe("committed\n");
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

function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function removeTempRoot(root: string): void {
  rmSync(root, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
}
