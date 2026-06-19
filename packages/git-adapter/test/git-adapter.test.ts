import { describe, expect, test } from "bun:test";
import { readRepositoryBinding, readHeadSha, findRepositoryRoot } from "../src/index";

describe("@archcontext/git-adapter", () => {
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
});
