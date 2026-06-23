import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { digestJson, type PracticeEnforcementEvaluationV1 } from "@archcontext/contracts";
import { validateJsonSchema } from "@archcontext/contracts";
import { CALLER_PROVIDED_REVIEW_CONCLUSION_FIELDS, completeTaskGate, reviewCrossRepoLandscape } from "../src/index";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const sha = `sha256:${"a".repeat(64)}`;
const practiceEnforcement: PracticeEnforcementEvaluationV1 = {
  schemaVersion: "archcontext.practice-enforcement-evaluation/v1",
  catalogDigest: `sha256:${"b".repeat(64)}`,
  policyDigest: `sha256:${"c".repeat(64)}`,
  checkResultDigest: `sha256:${"d".repeat(64)}`,
  results: [
    {
      schemaVersion: "archcontext.practice-check-result/v1",
      practiceId: "modularity.no-new-cycle",
      checkId: "no-new-cycle",
      assetDigest: `sha256:${"e".repeat(64)}`,
      enforcement: "complete",
      status: "fail",
      reasonCode: "violation",
      deterministic: true,
      subjects: ["module.a->module.b"],
      subjectDigests: [digestJson({ subject: "module.a->module.b" })],
      message: "Complete would introduce a new import cycle.",
      remediation: { action: "remove-new-import-cycle-or-add-a-more-specific-boundary", paths: [] }
    }
  ],
  violations: [],
  waiversApplied: [],
  actionsRequired: ["remove-new-import-cycle-or-add-a-more-specific-boundary"]
};
practiceEnforcement.violations = practiceEnforcement.results;

function readJson(path: string) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

describe("@archcontext/core/review-engine", () => {
  test("returns schema-valid pass results for fresh completed work", () => {
    const result = completeTaskGate({
      taskSessionId: "task.test",
      posture: "normal",
      headSha: "abc",
      currentHeadSha: "abc",
      worktreeDigest: sha,
      modelDigest: sha,
      codeFactsDigest: sha
    });

    expect(result.result).toBe("pass");
    expect(result.extensions.digest).toMatch(/^sha256:/);
    expect(validateJsonSchema(readJson("schemas/runtime/review-result.schema.json") as any, result as any).valid).toBe(true);
  });

  test("fails stale context and unjustified compatibility paths", () => {
    const result = completeTaskGate({
      taskSessionId: "task.test",
      posture: "structural",
      headSha: "old",
      currentHeadSha: "new",
      worktreeDigest: sha,
      modelDigest: sha,
      codeFactsDigest: sha,
      compatibilityPathIntroduced: true,
      compatibilityContract: { reason: "just in case" },
      cleanupRequired: 2,
      cleanupCompleted: 1
    });

    expect(result.result).toBe("fail_action_required");
    expect(result.summary.errors).toBeGreaterThanOrEqual(4);
    expect(result.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(["stale-context", "compatibility-reason", "cleanup-incomplete"])
    );
  });

  test("complete deterministic practice violations are reported with policy and check digests", () => {
    const result = completeTaskGate({
      taskSessionId: "task.test",
      posture: "structural",
      headSha: "abc",
      currentHeadSha: "abc",
      worktreeDigest: sha,
      modelDigest: sha,
      codeFactsDigest: sha,
      practiceEnforcement
    });

    expect(result.result).toBe("fail_action_required");
    expect(result.practiceViolations).toHaveLength(1);
    expect(result.actionsRequired).toEqual(["remove-new-import-cycle-or-add-a-more-specific-boundary"]);
    expect(result.findings.map((finding) => finding.id)).toContain("practice:modularity.no-new-cycle:no-new-cycle");
    expect(result.snapshot).toMatchObject({
      practiceCatalogDigest: practiceEnforcement.catalogDigest,
      practicePolicyDigest: practiceEnforcement.policyDigest,
      practiceCheckResultDigest: practiceEnforcement.checkResultDigest
    });
    expect(validateJsonSchema(readJson("schemas/runtime/review-result.schema.json") as any, result as any).valid).toBe(true);
  });

  test("stale context suppresses practice enforcement conclusions", () => {
    const result = completeTaskGate({
      taskSessionId: "task.test",
      posture: "structural",
      headSha: "old",
      currentHeadSha: "new",
      worktreeDigest: sha,
      modelDigest: sha,
      codeFactsDigest: sha,
      practiceEnforcement
    });

    expect(result.result).toBe("fail_action_required");
    expect(result.practiceViolations).toEqual([]);
    expect(result.actionsRequired).toEqual([]);
    expect(result.findings.map((finding) => finding.id)).toEqual(["stale-context"]);
    expect(result.extensions.practiceChecksSkipped).toBe("stale-context");
  });

  test("rejects caller-provided review conclusion and digest fields", () => {
    expect(CALLER_PROVIDED_REVIEW_CONCLUSION_FIELDS).toEqual([
      "result",
      "reviewDigest",
      "policyDigest",
      "signature",
      "practiceEnforcement",
      "practiceViolations",
      "waiversApplied",
      "actionsRequired",
      "practiceCatalogDigest",
      "practicePolicyDigest",
      "practiceCheckResultDigest"
    ]);
    const base = {
      taskSessionId: "task.test",
      posture: "normal" as const,
      headSha: "abc",
      currentHeadSha: "abc",
      worktreeDigest: sha,
      modelDigest: sha,
      codeFactsDigest: sha
    };

    for (const [field, value] of Object.entries({
      result: "pass",
      reviewDigest: sha,
      policyDigest: sha,
      signature: { algorithm: "ed25519", value: "forged" },
      practiceViolations: []
    })) {
      expect(() => completeTaskGate({ ...base, [field]: value } as any), field).toThrow(`review-conclusion-field-forbidden: ${field}`);
    }

    expect(completeTaskGate(base).result).toBe("pass");
  });

  test("reviews cross-repo landscape drift and pressure", () => {
    const relation = {
      schemaVersion: "archcontext.cross-repo-relation/v1" as const,
      id: "relation.web-calls-api",
      kind: "calls" as const,
      source: { repositoryId: "repo.web", nodeId: "module.checkout-ui" },
      target: { repositoryId: "repo.api", nodeId: "module.billing-api" },
      via: { kind: "interface" as const, id: "interface.billing-http" },
      intent: "checkout to billing"
    };
    const result = reviewCrossRepoLandscape({
      landscape: {
        schemaVersion: "archcontext.landscape/v1",
        id: "landscape.product",
        name: "Product",
        repositories: [{ repositoryId: "repo.web", numericRepositoryId: 1001, name: "web", role: "frontend" }],
        relations: [relation.id],
        syncPolicy: { mode: "git-worktree-only", archcontextSyncService: "forbidden" }
      },
      relations: [relation]
    });
    expect(result.result).toBe("fail_action_required");
    expect(result.findings.map((finding) => finding.type)).toContain("landscape-invalid");
  });
});
