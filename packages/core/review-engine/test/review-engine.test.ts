import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { digestJson, type PracticeEnforcementEvaluationV1, type RecommendationV2 } from "@archcontext/contracts";
import { validateJsonSchema } from "@archcontext/contracts";
import { CALLER_PROVIDED_REVIEW_CONCLUSION_FIELDS, completeTaskGate, reviewArchitectureCandidateChangeSet, reviewCrossRepoLandscape } from "../src/index";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const sha = `sha256:${"a".repeat(64)}`;
const baseRecommendation: RecommendationV2 = {
  schemaVersion: "archcontext.recommendation/v2",
  recommendationId: "rec.review-gate",
  runId: "rec_run.review-gate",
  fingerprint: digestJson({ recommendation: "review-gate" }),
  subject: "module.checkout",
  practiceId: "runtime.queue-boundary",
  status: "open",
  confidence: "high",
  enforcement: "advisory",
  risk: "high",
  uncertainty: "high",
  evidenceBindingIds: [digestJson({ evidence: "review-gate" })],
  explanation: ["High-risk uncertain recommendation fixture."],
  createdAt: "2026-06-26T12:00:00.000Z",
  updatedAt: "2026-06-26T12:00:00.000Z"
};
const practiceEnforcement: PracticeEnforcementEvaluationV1 = {
  schemaVersion: "archcontext.practice-enforcement-evaluation/v1",
  catalogDigest: `sha256:${"b".repeat(64)}`,
  policyDigest: `sha256:${"c".repeat(64)}`,
  policyMode: "fail-closed",
  blocking: true,
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
  nonBlockingViolations: [],
  waiversApplied: [],
  actionsRequired: ["remove-new-import-cycle-or-add-a-more-specific-boundary"]
};
practiceEnforcement.violations = practiceEnforcement.results;

const failOpenPracticeEnforcement: PracticeEnforcementEvaluationV1 = {
  ...practiceEnforcement,
  policyDigest: `sha256:${"f".repeat(64)}`,
  policyMode: "fail-open",
  blocking: false,
  violations: [],
  nonBlockingViolations: practiceEnforcement.results,
  actionsRequired: []
};

const compatibilityPracticeEnforcement: PracticeEnforcementEvaluationV1 = {
  schemaVersion: "archcontext.practice-enforcement-evaluation/v1",
  catalogDigest: `sha256:${"1".repeat(64)}`,
  policyDigest: `sha256:${"2".repeat(64)}`,
  policyMode: "fail-closed",
  blocking: true,
  checkResultDigest: `sha256:${"3".repeat(64)}`,
  results: [
    {
      schemaVersion: "archcontext.practice-check-result/v1",
      practiceId: "compatibility.single-owner",
      checkId: "compatibility-contract-required",
      assetDigest: `sha256:${"4".repeat(64)}`,
      enforcement: "complete",
      status: "fail",
      reasonCode: "violation",
      deterministic: true,
      subjects: ["compatibility-owner", "compatibility-reason"],
      subjectDigests: [
        digestJson({ subject: "compatibility-owner" }),
        digestJson({ subject: "compatibility-reason" })
      ],
      message: "Compatibility path is missing a durable contract.",
      remediation: { action: "add-compatibility-contract-owner-consumers-removal-and-review-date", paths: [] }
    }
  ],
  violations: [],
  nonBlockingViolations: [],
  waiversApplied: [],
  actionsRequired: ["add-compatibility-contract-owner-consumers-removal-and-review-date"]
};
compatibilityPracticeEnforcement.violations = compatibilityPracticeEnforcement.results;

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

  test("recommendations cannot become complete-stage gates without explicit policy eligibility", () => {
    const advisoryGate = completeTaskGate({
      taskSessionId: "task.recommendation-gate",
      posture: "structural",
      headSha: "abc",
      currentHeadSha: "abc",
      worktreeDigest: sha,
      modelDigest: sha,
      codeFactsDigest: sha,
      recommendations: [{
        ...baseRecommendation,
        extensions: { completeStageGate: true }
      }]
    });
    expect(advisoryGate.result).toBe("fail_action_required");
    expect(advisoryGate.findings.map((finding) => finding.id)).toContain(
      "recommendation:rec.review-gate:advisory-complete-gate-forbidden"
    );

    const missingEligibility = completeTaskGate({
      taskSessionId: "task.recommendation-gate",
      posture: "structural",
      headSha: "abc",
      currentHeadSha: "abc",
      worktreeDigest: sha,
      modelDigest: sha,
      codeFactsDigest: sha,
      recommendations: [{
        ...baseRecommendation,
        enforcement: "complete"
      }]
    });
    expect(missingEligibility.result).toBe("fail_action_required");
    expect(missingEligibility.findings.map((finding) => finding.id)).toContain(
      "recommendation:rec.review-gate:complete-eligibility-required"
    );

    const eligible = completeTaskGate({
      taskSessionId: "task.recommendation-gate",
      posture: "structural",
      headSha: "abc",
      currentHeadSha: "abc",
      worktreeDigest: sha,
      modelDigest: sha,
      codeFactsDigest: sha,
      recommendations: [{
        ...baseRecommendation,
        enforcement: "complete",
        extensions: {
          completeStageEligibility: {
            eligible: true,
            policyDigest: digestJson({ policy: "complete-stage-recommendation" })
          }
        }
      }]
    });
    expect(eligible.result).toBe("pass");
    expect(validateJsonSchema(readJson("schemas/runtime/review-result.schema.json") as any, eligible as any).valid).toBe(true);
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

  test("fail-open deterministic practice failures are advisory warnings", () => {
    const result = completeTaskGate({
      taskSessionId: "task.test",
      posture: "structural",
      headSha: "abc",
      currentHeadSha: "abc",
      worktreeDigest: sha,
      modelDigest: sha,
      codeFactsDigest: sha,
      practiceEnforcement: failOpenPracticeEnforcement
    });

    expect(result.result).toBe("pass_with_warnings");
    expect(result.summary).toEqual({ errors: 0, warnings: 1, notices: 0 });
    expect(result.practiceViolations).toEqual([]);
    expect(result.actionsRequired).toEqual([]);
    expect(result.findings).toEqual([expect.objectContaining({
      id: "practice-advisory:modularity.no-new-cycle:no-new-cycle",
      type: "practice-advisory",
      severity: "warning"
    })]);
    expect((result.extensions as any).nonBlockingPracticeViolations).toHaveLength(1);
    expect(result.snapshot).toMatchObject({
      practiceCatalogDigest: failOpenPracticeEnforcement.catalogDigest,
      practicePolicyDigest: failOpenPracticeEnforcement.policyDigest,
      practiceCheckResultDigest: failOpenPracticeEnforcement.checkResultDigest
    });
    expect(validateJsonSchema(readJson("schemas/runtime/review-result.schema.json") as any, result as any).valid).toBe(true);
  });

  test("deduplicates compatibility contract findings already reported by practice enforcement", () => {
    const result = completeTaskGate({
      taskSessionId: "task.test",
      posture: "structural",
      headSha: "abc",
      currentHeadSha: "abc",
      worktreeDigest: sha,
      modelDigest: sha,
      codeFactsDigest: sha,
      compatibilityPathIntroduced: true,
      compatibilityContract: {
        kind: "external-contract",
        reason: "just in case",
        consumers: ["external.client"],
        removalConditions: ["external.client migrates"],
        reviewAt: "2026-07-24T00:00:00.000Z"
      },
      practiceEnforcement: compatibilityPracticeEnforcement
    });

    expect(result.result).toBe("fail_action_required");
    expect(result.practiceViolations).toHaveLength(1);
    expect(result.findings.map((finding) => finding.id)).toEqual(["compatibility-reason", "compatibility-owner"]);
    expect(result.summary.errors).toBe(2);
    expect(result.findings.map((finding) => finding.id)).not.toContain("practice:compatibility.single-owner:compatibility-contract-required");
    expect(result.extensions.suppressedPracticeFindings).toEqual([{
      id: "practice:compatibility.single-owner:compatibility-contract-required",
      reason: "duplicates-compatibility-contract-finding",
      duplicateFindingIds: ["compatibility-owner", "compatibility-reason"]
    }]);
    expect(result.snapshot).toMatchObject({
      practiceCatalogDigest: compatibilityPracticeEnforcement.catalogDigest,
      practicePolicyDigest: compatibilityPracticeEnforcement.policyDigest,
      practiceCheckResultDigest: compatibilityPracticeEnforcement.checkResultDigest
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

  test("rejects unsupported architecture candidate ChangeSet mutations", () => {
    const result = reviewArchitectureCandidateChangeSet({
      taskSessionId: "task.al5-12",
      headSha: "abc",
      currentHeadSha: "abc",
      worktreeDigest: sha,
      modelDigest: sha,
      codeFactsDigest: sha,
      changeSet: {
        schemaVersion: "archcontext.changeset/v1",
        id: "changeset.review-al5-12",
        status: "proposed",
        base: { headSha: "abc", worktreeDigest: sha, modelDigest: sha },
        reason: { taskSessionId: "task.al5-12" },
        operations: [
          {
            op: "delete_entity",
            entityId: "module.legacy",
            expectedHash: "unknown",
            candidateChangeId: "candidate.node.removed",
            targetKind: "node",
            targetId: "module.legacy",
            changeKind: "removed",
            body: "diff --git a/private.ts b/private.ts\nconst secret = 'redacted';\n"
          },
          {
            op: "update_entity_fields",
            entityId: "module.api",
            expectedHash: "unknown",
            candidateChangeId: "candidate.owner.changed",
            targetKind: "owner",
            targetId: "module.api:owner",
            changeKind: "materially_changed"
          },
          {
            op: "update_entity_fields",
            entityId: "module.api",
            expectedHash: "unknown",
            candidateChangeId: "candidate.constraint.relaxed",
            targetKind: "constraint",
            targetId: "constraint.api-boundary",
            changeKind: "materially_changed",
            changes: { reason: "boundary-relaxation" }
          },
          {
            op: "create_entity",
            entityId: "contract.stripe",
            expectedHash: "missing",
            candidateChangeId: "candidate.external.contract",
            targetKind: "constraint",
            targetId: "external-contract.stripe",
            changeKind: "added",
            changes: { claim: "external-contract" }
          }
        ] as any,
        preconditions: ["schema-valid-before", "candidate-delta-policy-evaluated"],
        postconditions: ["ledger-event-batch-previewed"],
        requiresConfirmation: true,
        idempotencyKey: "idem_changeset.review-al5-12"
      }
    });

    expect(result.result).toBe("fail_action_required");
    expect(result.summary.errors).toBe(4);
    expect(result.findings.map((finding) => finding.type)).toEqual([
      "unsupported-entity-deletion",
      "unsupported-owner-change",
      "unsupported-boundary-relaxation",
      "unsupported-external-contract-claim"
    ]);
    expect(result.actionsRequired).toEqual(result.findings.map((finding) => finding.id));
    expect(result.extensions.rejectedCandidateChangeIds).toEqual([
      "candidate.constraint.relaxed",
      "candidate.external.contract",
      "candidate.node.removed",
      "candidate.owner.changed"
    ]);
    expect(JSON.stringify(result)).not.toContain("diff --git");
    expect(JSON.stringify(result)).not.toContain("const secret");
    expect(validateJsonSchema(readJson("schemas/runtime/review-result.schema.json") as any, result as any).valid).toBe(true);
  });

  test("passes supported architecture candidate ChangeSet proposals", () => {
    const result = reviewArchitectureCandidateChangeSet({
      taskSessionId: "task.al5-12",
      headSha: "abc",
      currentHeadSha: "abc",
      worktreeDigest: sha,
      modelDigest: sha,
      codeFactsDigest: sha,
      changeSet: {
        schemaVersion: "archcontext.changeset/v1",
        id: "changeset.review-supported",
        status: "proposed",
        base: { headSha: "abc", worktreeDigest: sha, modelDigest: sha },
        reason: { taskSessionId: "task.al5-12" },
        operations: [
          {
            op: "create_entity",
            entityId: "module.new-api",
            expectedHash: "missing",
            candidateChangeId: "candidate.node.added",
            targetKind: "node",
            targetId: "module.new-api",
            changeKind: "added"
          }
        ] as any,
        preconditions: ["schema-valid-before", "candidate-delta-policy-evaluated"],
        postconditions: ["ledger-event-batch-previewed"],
        requiresConfirmation: true,
        idempotencyKey: "idem_changeset.review-supported"
      }
    });

    expect(result.result).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.extensions.changeSetDigest).toMatch(/^sha256:/);
    expect(validateJsonSchema(readJson("schemas/runtime/review-result.schema.json") as any, result as any).valid).toBe(true);
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
