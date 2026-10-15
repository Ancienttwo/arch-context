import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PROJECTION_REQUEST_SCHEMA_VERSION, type ProjectionExpectedSnapshotV1, type ProjectionRequestV1 } from "@archcontext/contracts";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { runtimeWorktreeDigest } from "../src/changeset-authority";
import { assertProjectionInvocationSnapshot, runProjectionSnapshotCommand } from "../src/projection-service";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function write(root: string, path: string, body: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body, "utf8");
}

function createIgnoringRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-git-visible-digest-"));
  roots.push(root);
  write(root, "README.md", "# fixture\n");
  write(root, ".gitignore", "node_modules/\ndist/\n.DS_Store\n.claude/worktrees/\n");
  write(root, "src/index.ts", "export const value = 1;\n");
  initializeArchContextModel(root, "Git Visible Digest App");
  git(root, "init", "--quiet");
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "fixture");
  return root;
}

function digests(root: string) {
  return {
    repository: runtimeWorktreeDigest(root, "repository"),
    projection: runtimeWorktreeDigest(root, "architecture-documentation-projection")
  };
}

function snapshot(root: string): ProjectionExpectedSnapshotV1 {
  const envelope = runProjectionSnapshotCommand(root);
  expect(envelope.ok).toBe(true);
  return (envelope.data as unknown as { expected: ProjectionExpectedSnapshotV1 }).expected;
}

function checkRequest(expected: ProjectionExpectedSnapshotV1): ProjectionRequestV1 {
  return {
    schemaVersion: PROJECTION_REQUEST_SCHEMA_VERSION,
    requestId: "projection_request.git-visible-digest",
    profile: "repo-harness/v1",
    mode: "check",
    targets: ["architecture-docs"],
    changedPaths: [],
    expected
  } as ProjectionRequestV1;
}

describe("Git-visible worktree digest (#323)", () => {
  test("gitignored trees move neither the projection nor the ChangeSet worktree digest", () => {
    const root = createIgnoringRepo();
    const before = digests(root);
    const expected = snapshot(root);
    expect<string>(expected.worktreeDigest).toBe(before.projection);

    write(root, "packages/a/node_modules/dep/index.js", "module.exports = 1;\n");
    write(root, "dist/out.js", "console.log(1);\n");
    write(root, "src/sub/.DS_Store", "finder\n");
    write(root, ".claude/worktrees/session-1/node_modules/pkg/index.js", "worktree checkout\n");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })).toBe("");

    expect(digests(root)).toEqual(before);
    expect(snapshot(root)).toEqual(expected);
    expect(() => assertProjectionInvocationSnapshot(root, { action: "run", request: checkRequest(expected) })).not.toThrow();
  });

  test("a tracked change and an untracked, not-ignored file move both digests", () => {
    const root = createIgnoringRepo();
    const before = digests(root);
    const expected = snapshot(root);

    write(root, "src/index.ts", "export const value = 2;\n");
    const tracked = digests(root);
    expect(tracked.repository).not.toBe(before.repository);
    expect(tracked.projection).not.toBe(before.projection);
    expect<string>(snapshot(root).worktreeDigest).toBe(tracked.projection);
    expect(() => assertProjectionInvocationSnapshot(root, { action: "run", request: checkRequest(expected) }))
      .toThrow("Projection snapshot mismatch.");

    write(root, "src/index.ts", "export const value = 1;\n");
    expect(digests(root)).toEqual(before);
    write(root, "src/new-file.ts", "export const added = true;\n");
    const untracked = digests(root);
    expect(untracked.repository).not.toBe(before.repository);
    expect(untracked.projection).not.toBe(before.projection);

    rmSync(join(root, "src/new-file.ts"));
    expect(digests(root)).toEqual(before);
    rmSync(join(root, "src/index.ts"));
    const deleted = digests(root);
    expect(deleted.repository).not.toBe(before.repository);
    expect(deleted.projection).not.toBe(before.projection);
  });

  test("projection snapshot returns the expected values a request is checked against", () => {
    const root = createIgnoringRepo();
    const envelope = runProjectionSnapshotCommand(join(root, "src"));
    expect(envelope).toMatchObject({ ok: true, requestId: "projection.snapshot" });
    const expected = (envelope.data as unknown as { expected: ProjectionExpectedSnapshotV1 }).expected;
    expect(Object.keys(expected).sort()).toEqual(["headSha", "repositoryId", "workspaceId", "worktreeDigest"]);
    expect(expected.headSha).toMatch(/^[a-f0-9]{40}$/);
    expect(expected.worktreeDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(() => assertProjectionInvocationSnapshot(root, { action: "run", request: checkRequest(expected) })).not.toThrow();
  });

  test("a root that is not a Git worktree fails closed instead of walking the filesystem", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-git-visible-digest-plain-"));
    roots.push(root);
    write(root, "README.md", "# plain\n");
    initializeArchContextModel(root, "Plain App");
    write(root, ".git", "gitdir: /nonexistent\n");
    expect(() => runtimeWorktreeDigest(root, "repository")).toThrow("Git-visible files require a Git worktree");
    expect(runProjectionSnapshotCommand(root)).toMatchObject({
      ok: false,
      error: { code: "AC_REPO_NOT_FOUND", reasonCode: "git-worktree-required" }
    });
  });
});
