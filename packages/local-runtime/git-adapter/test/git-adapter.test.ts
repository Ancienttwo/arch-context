import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeGitChangeFingerprint,
  isTrackedWorktreeClean,
  prepareDetachedReviewWorktree,
  readCommitChangeMetadata,
  readTrackedSourceFiles,
  readWorkspacePackages,
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

  test("measures Git-tracked source files only, so an untracked build output cannot inflate the footprint", () => {
    const root = createGitFixture();
    try {
      mkdirSync(join(root, "src/dist"), { recursive: true });
      mkdirSync(join(root, "docs"), { recursive: true });
      writeFileSync(join(root, "src/a.ts"), "export const a = 1;\nexport const b = 2;\n");
      writeFileSync(join(root, "src/no-trailing-newline.ts"), "export const c = 3;");
      writeFileSync(join(root, "src/empty.ts"), "");
      writeFileSync(join(root, "docs/guide.md"), "# guide\n");
      commitAll(root, "sources");

      // Exists on disk inside the include glob, but was never committed.
      writeFileSync(join(root, "src/dist/x.ts"), "export const generated = true;\n".repeat(40));

      const measured = readTrackedSourceFiles(root, { include: ["src/**"] });

      expect(measured).toEqual([
        { path: "src/a.ts", lineCount: 2 },
        { path: "src/empty.ts", lineCount: 0 },
        { path: "src/no-trailing-newline.ts", lineCount: 1 }
      ]);
      expect(measured.some((file) => file.path === "src/dist/x.ts")).toBe(false);
      // Tracking it is what changes the measurement, not its presence on disk.
      git(root, "add", "src/dist/x.ts");
      commitAll(root, "generated");
      expect(readTrackedSourceFiles(root, { include: ["src/**"] })).toHaveLength(4);

      // No include filter measures the whole tracked tree.
      expect(readTrackedSourceFiles(root).map((file) => file.path)).toEqual([
        "docs/guide.md",
        "src/a.ts",
        "src/dist/x.ts",
        "src/empty.ts",
        "src/no-trailing-newline.ts",
        "tracked.txt"
      ]);
    } finally {
      removeTempRoot(root);
    }
  });

  test("counts the committed blob, so an uncommitted edit or deletion does not move the measurement", () => {
    const root = createGitFixture();
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
      writeFileSync(join(root, "src/b.ts"), "export const b = 2;\n");
      commitAll(root, "sources");
      const committed = readTrackedSourceFiles(root, { include: ["src/**"] });
      expect(committed).toEqual([{ path: "src/a.ts", lineCount: 1 }, { path: "src/b.ts", lineCount: 1 }]);

      // Grow one tracked file by 40 lines and delete another, without committing either.
      writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n".repeat(41));
      rmSync(join(root, "src/b.ts"));

      // The snapshot describes a commit, not whatever happens to be on disk, so two scans at the
      // same HEAD stay comparable.
      expect(readTrackedSourceFiles(root, { include: ["src/**"] })).toEqual(committed);
    } finally {
      removeTempRoot(root);
    }
  });

  test("a blob Git cannot hand back fails closed naming the path", () => {
    const root = createGitFixture();
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
      commitAll(root, "sources");
      const objectId = gitOut(root, "rev-parse", "HEAD:src/a.ts");
      rmSync(join(root, ".git/objects", objectId.slice(0, 2), objectId.slice(2)));

      // Reporting a smaller footprint than the commit actually has would be a silent wrong answer.
      expect(() => readTrackedSourceFiles(root, { include: ["src/**"] })).toThrow("git-tracked-blob-unreadable: src/a.ts");
    } finally {
      removeTempRoot(root);
    }
  });

  test("reads workspace manifests so bare workspace specifiers can be resolved downstream", () => {
    const root = createGitFixture();
    try {
      mkdirSync(join(root, "packages/alpha"), { recursive: true });
      mkdirSync(join(root, "packages/beta"), { recursive: true });
      writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/beta", "packages/alpha"] }));
      writeFileSync(join(root, "packages/alpha/package.json"), JSON.stringify({
        name: "@fixture/alpha",
        exports: { ".": "./src/index.ts", "./sub": "./sub/src/index.ts" }
      }));
      writeFileSync(join(root, "packages/beta/package.json"), JSON.stringify({ name: "@fixture/beta" }));

      expect(readWorkspacePackages(root)).toEqual([
        { name: "@fixture/alpha", root: "packages/alpha", exports: { ".": "./src/index.ts", "./sub": "./sub/src/index.ts" } },
        // A manifest without `exports` contributes no resolvable subpath rather than a guess.
        { name: "@fixture/beta", root: "packages/beta", exports: {} }
      ]);
    } finally {
      removeTempRoot(root);
    }
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

function commitAll(root: string, message: string): void {
  git(root, "add", ".");
  git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", message);
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
