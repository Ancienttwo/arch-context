import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertRepoRelativePath,
  computeWorktreeDigest,
  createInterventionId,
  listRepoFiles,
  repositoryFingerprint
} from "../src/index";

describe("@archcontext/architecture-domain", () => {
  test("repository fingerprints are deterministic and path-derived", () => {
    expect(repositoryFingerprint("/tmp/example")).toBe(repositoryFingerprint("/tmp/example"));
    expect(repositoryFingerprint("/tmp/example")).not.toBe(repositoryFingerprint("/tmp/other"));
  });

  test("worktree digest ignores configured generated state", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-domain-"));
    try {
      writeFileSync(join(root, "tracked.txt"), "one");
      writeFileSync(join(root, "ignored.txt"), "first");
      const first = computeWorktreeDigest(root, { ignore: ["ignored.txt"] });
      writeFileSync(join(root, "ignored.txt"), "second");
      expect(computeWorktreeDigest(root, { ignore: ["ignored.txt"] })).toBe(first);
      writeFileSync(join(root, "tracked.txt"), "two");
      expect(computeWorktreeDigest(root, { ignore: ["ignored.txt"] })).not.toBe(first);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("repo file listing and path assertion use POSIX repo-relative paths", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-domain-"));
    try {
      writeFileSync(join(root, "a.txt"), "a");
      expect(listRepoFiles(root)).toEqual(["a.txt"]);
      expect(() => assertRepoRelativePath("packages/contracts/src/index.ts")).not.toThrow();
      expect(() => assertRepoRelativePath("../escape")).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("intervention ids are stable and bounded", () => {
    expect(createInterventionId("Unify Subscription & Payment State")).toBe(
      "intervention.unify-subscription-payment-state"
    );
    expect(createInterventionId("")).toBe("intervention.architecture-change");
    expect(createInterventionId("x".repeat(120)).length).toBeLessThanOrEqual("intervention.".length + 80);
  });
});
