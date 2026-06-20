import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertRepoRelativePath,
  activeRepositoriesForTask,
  addCrossRepoRelation,
  addRepositoryToLandscape,
  computeWorktreeDigest,
  createLandscape,
  createInterventionId,
  crossRepoImpact,
  landscapeDigest,
  landscapeYaml,
  listRepoFiles,
  parseCrossRepoRelationFile,
  parseLandscapeFile,
  parseRepoScopedArchitectureId,
  repoScopedArchitectureId,
  summarizeLandscapeForSaas,
  validateLandscape,
  repositoryFingerprint,
  assertAdapterDoesNotOverwriteNativeCore,
  stripAdapterProtectedNativeFields
} from "../src/index";

describe("@archcontext/core/architecture-domain", () => {
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

  test("repo-scoped architecture ids preserve repository namespace", () => {
    const id = repoScopedArchitectureId("repo.checkout", "module.billing-api");
    expect(id).toBe("repo.checkout::module.billing-api");
    expect(parseRepoScopedArchitectureId(id)).toEqual({ repositoryId: "repo.checkout", nodeId: "module.billing-api" });
    expect(() => parseRepoScopedArchitectureId("module.billing-api")).toThrow("repo-scoped");
  });

  test("landscape registration validates cross-repo edges and exposes metadata-only SaaS summary", () => {
    const relation = {
      schemaVersion: "archcontext.cross-repo-relation/v1" as const,
      id: "relation.web-calls-api",
      kind: "calls" as const,
      source: { repositoryId: "repo.web", nodeId: "module.checkout-ui" },
      target: { repositoryId: "repo.api", nodeId: "module.billing-api" },
      via: { kind: "interface" as const, id: "interface.billing-http" },
      intent: "Checkout creates subscriptions through the API."
    };
    const landscape = createLandscape({
      id: "archcontext-product",
      name: "ArchContext Product",
      maxActiveRepositories: 2,
      repositories: [
        { repositoryId: "repo.web", numericRepositoryId: 1001, name: "archcontext-web", role: "frontend" },
        { repositoryId: "repo.api", numericRepositoryId: 1002, name: "archcontext-api", role: "runtime" }
      ],
      relations: [relation]
    });
    expect(validateLandscape(landscape, [relation])).toEqual({ valid: true, errors: [] });
    expect(crossRepoImpact([relation], "repo.api").map((item) => item.id)).toEqual(["relation.web-calls-api"]);
    expect(activeRepositoriesForTask(landscape, "change archcontext-api subscription endpoint").map((repo) => repo.repositoryId)).toEqual([
      "repo.api",
      "repo.web"
    ]);
    expect(summarizeLandscapeForSaas(landscape)).toEqual({ repositoryIds: [1001, 1002] });
    expect(landscapeDigest(landscape, [relation])).toMatch(/^sha256:/);
    expect(landscapeYaml(landscape)).toContain("archcontextSyncService: \"forbidden\"");
    expect(parseLandscapeFile(landscapeYaml(landscape))).toEqual(landscape);
    expect(parseCrossRepoRelationFile(JSON.stringify(relation), ".archcontext/relations/relation.web-calls-api.json")).toEqual(relation);

    const expanded = addCrossRepoRelation(addRepositoryToLandscape(landscape, { repositoryId: "repo.worker", numericRepositoryId: 1003, name: "archcontext-worker", role: "worker" }), {
      ...relation,
      id: "relation.worker-subscribes-api",
      source: { repositoryId: "repo.worker", nodeId: "module.billing-worker" },
      via: { kind: "event", id: "event.subscription-created" }
    });
    expect(expanded.repositories.map((repo) => repo.repositoryId)).toContain("repo.worker");
    expect(expanded.relations).toContain("relation.worker-subscribes-api");
  });

  test("adapter imports cannot overwrite Native protected fields", () => {
    const native = {
      id: "module.subscription",
      name: "Subscription",
      evidence: ["verified-call-path"],
      verification: ["bun test"],
      constraint: ["payment-boundary"],
      intervention: ["intervention.billing"]
    };
    const stripped = stripAdapterProtectedNativeFields(native);
    expect(stripped.removedFields).toEqual(["evidence", "verification", "constraint", "intervention"]);
    expect((stripped.clean as any).evidence).toBeUndefined();
    expect(() => assertAdapterDoesNotOverwriteNativeCore(native, { ...native, evidence: ["changed"] })).toThrow("source-of-truth");
    expect(() => assertAdapterDoesNotOverwriteNativeCore(native, native)).not.toThrow();
  });
});
