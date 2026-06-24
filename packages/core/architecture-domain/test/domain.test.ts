import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertRepoRelativePath,
  activeRepositoriesForTask,
  addCrossRepoRelation,
  addRepositoryToLandscape,
  bindRepository,
  computeReviewWorktreeDigest,
  computeWorktreeDigest,
  createLandscape,
  createInterventionId,
  crossRepoImpact,
  landscapeDigest,
  landscapeYaml,
  listRepoFiles,
  parseCrossRepoRelationFile,
  parseArchitectureDirectionViolationSubject,
  parseLandscapeFile,
  parseRepoScopedArchitectureId,
  repoScopedArchitectureId,
  summarizeLandscapeForSaas,
  validateLandscape,
  repositoryFingerprint,
  assertAdapterDoesNotOverwriteNativeCore,
  canonicalArchitectureJson,
  canonicalArchitectureYaml,
  isArchitectureDirectionViolationSubject,
  isArchitectureDirectionalEdgeViolationSubject,
  parseJsonOrStableYaml,
  stripAdapterProtectedNativeFields
} from "../src/index";

describe("@archcontext/core/architecture-domain", () => {
  test("repository fingerprints are deterministic and path-derived", () => {
    expect(repositoryFingerprint("/tmp/example")).toBe(repositoryFingerprint("/tmp/example"));
    expect(repositoryFingerprint("/tmp/example")).not.toBe(repositoryFingerprint("/tmp/other"));
  });

  test("repository fingerprints use the canonical root for existing directories", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-domain-root-"));
    const link = join(tmpdir(), `archctx-domain-link-${Date.now()}`);
    try {
      symlinkSync(root, link, "dir");
      expect(repositoryFingerprint(link)).toBe(repositoryFingerprint(root));
      expect(bindRepository(link, "abc123").root).toBe(realpathSync.native(root));
    } catch (error) {
      if (!["EPERM", "EACCES", "ENOTSUP"].includes((error as { code?: string }).code ?? "")) throw error;
    } finally {
      rmSync(link, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
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

  test("review worktree digest binds numeric repository head tree and tracked entries", () => {
    const input = {
      repositoryNumericId: 20002,
      headSha: "a".repeat(40),
      headTreeOid: "b".repeat(40),
      trackedTree: [
        { mode: "100644", type: "blob" as const, objectId: "c".repeat(40), path: "src/index.ts" },
        { mode: "160000", type: "commit" as const, objectId: "d".repeat(40), path: "vendor/lib" }
      ],
      sparseScope: ["src"]
    };
    const digest = computeReviewWorktreeDigest(input);
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(computeReviewWorktreeDigest({ ...input, trackedTree: [...input.trackedTree].reverse() })).toBe(digest);
    expect(computeReviewWorktreeDigest({ ...input, headTreeOid: "e".repeat(40) })).not.toBe(digest);
    expect(computeReviewWorktreeDigest({
      ...input,
      trackedTree: [{ ...input.trackedTree[0], objectId: "f".repeat(40) }]
    })).not.toBe(digest);
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

  test("stable YAML parser and canonical serializer round-trip nested architecture JSON", () => {
    const value = {
      schemaVersion: "archcontext.node/v1",
      id: "module.checkout",
      metadata: {
        owners: ["team-checkout", "team-platform"],
        flags: { beta: true, score: 2 }
      },
      name: "Checkout"
    };
    const yaml = canonicalArchitectureYaml(value as any);
    expect(yaml.indexOf("id: \"module.checkout\"")).toBeLessThan(yaml.indexOf("metadata:"));
    expect(parseJsonOrStableYaml(yaml, ".archcontext/model/nodes/module.checkout.yaml")).toEqual(canonicalArchitectureJson(value as any));
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

  test("direction violation subjects bind boundary membership and edge direction", () => {
    const subject = "declared-layer-violation:module.web->module.persistence";

    expect(parseArchitectureDirectionViolationSubject(subject)).toEqual({
      kind: "declared-layer-violation",
      subject: "module.web->module.persistence",
      source: "module.web",
      target: "module.persistence"
    });
    expect(parseArchitectureDirectionViolationSubject("boundary-violation:module.api")).toEqual({
      kind: "boundary-violation",
      subject: "module.api",
      source: "module.api"
    });
    expect(isArchitectureDirectionViolationSubject("cross-boundary-import-added:module.ui->module.data")).toBe(true);
    expect(isArchitectureDirectionalEdgeViolationSubject("cross-boundary-import-added:module.ui->module.data")).toBe(true);
    expect(isArchitectureDirectionalEdgeViolationSubject("cross-boundary-import-added:module.ui")).toBe(false);
    expect(isArchitectureDirectionViolationSubject("cycle:module.a->module.b->module.a")).toBe(false);
    expect(isArchitectureDirectionViolationSubject("declared-layer-violation:")).toBe(false);
    expect(isArchitectureDirectionalEdgeViolationSubject("declared-layer-violation:module.a->module.b->module.c")).toBe(false);
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
