import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommittedGitRepo, git } from "../../local-store-sqlite/test/git-fixtures";
import { runtimeStatePaths } from "../src/index";

describe("runtime state paths", () => {
test("runtime state paths use an OS/user-data root partitioned by repository and worktree", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-state-paths-repo-"));
    const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-root-"));
    try {
      const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
      expect(paths.source).toBe("environment");
      expect(paths.stateRoot).toBe(stateRoot);
      expect(paths.storageRepositoryId).toMatch(/^repo\.[0-9a-f]{16}$/);
      expect(paths.storageWorkspaceId).toMatch(/^ws\.[0-9a-f]{16}$/);
      expect(paths.repositoryId).toMatch(/^repo\.[0-9a-f]{16}$/);
      expect(paths.workspaceId).toMatch(/^ws\.[0-9a-f]{16}$/);
      expect(paths.repositoryId).toBe(paths.storageRepositoryId);
      expect(paths.workspaceId).toBe(paths.storageWorkspaceId);
      expect(paths.localStorePath).toBe(join(paths.workspaceStateDir, "runtime.sqlite"));
      expect(paths.daemonConnectionPath).toBe(join(paths.workspaceStateDir, "archctxd.json"));
      expect(paths.legacyLocalStorePath).toBe(join(paths.repositoryRoot, ".archcontext", ".local", "runtime.sqlite"));
      expect(paths.localStorePath.startsWith(root)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

test("runtime state paths use Git common-dir for linked worktrees and worktree root for workspace identity", () => {
    const workspace = mkdtempSync(join(tmpdir(), "archctx-state-git-worktrees-"));
    const repo = join(workspace, "repo");
    const linked = join(workspace, "repo-linked");
    const stateRoot = join(workspace, "state");
    try {
      createCommittedGitRepo(repo);
      git(repo, "worktree", "add", "-b", "linked-fixture", linked);

      const primary = runtimeStatePaths(repo, { ARCHCONTEXT_STATE_DIR: stateRoot });
      const linkedPaths = runtimeStatePaths(linked, { ARCHCONTEXT_STATE_DIR: stateRoot });
      expect(primary.storageRepositoryId).toBe(linkedPaths.storageRepositoryId);
      expect(primary.repositoryAnchor).toBe(linkedPaths.repositoryAnchor);
      expect(primary.storageWorkspaceId).not.toBe(linkedPaths.storageWorkspaceId);
      expect(primary.workspaceStateDir).not.toBe(linkedPaths.workspaceStateDir);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

test("runtime state paths collapse monorepo subdirectories and isolate sibling repositories", () => {
    const workspace = mkdtempSync(join(tmpdir(), "archctx-state-git-roots-"));
    const repo = join(workspace, "repo");
    const sibling = join(workspace, "sibling");
    const stateRoot = join(workspace, "state");
    try {
      createCommittedGitRepo(repo);
      mkdirSync(join(repo, "packages", "web"), { recursive: true });
      createCommittedGitRepo(sibling);

      const rootPaths = runtimeStatePaths(repo, { ARCHCONTEXT_STATE_DIR: stateRoot });
      const subdirPaths = runtimeStatePaths(join(repo, "packages", "web"), { ARCHCONTEXT_STATE_DIR: stateRoot });
      const siblingPaths = runtimeStatePaths(sibling, { ARCHCONTEXT_STATE_DIR: stateRoot });
      expect(subdirPaths.repositoryRoot).toBe(rootPaths.repositoryRoot);
      expect(subdirPaths.storageRepositoryId).toBe(rootPaths.storageRepositoryId);
      expect(subdirPaths.storageWorkspaceId).toBe(rootPaths.storageWorkspaceId);
      expect(siblingPaths.storageRepositoryId).not.toBe(rootPaths.storageRepositoryId);
      expect(siblingPaths.workspaceStateDir).not.toBe(rootPaths.workspaceStateDir);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
