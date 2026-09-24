import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REVIEW_FAIL_ON_CATEGORIES,
  validateJsonSchema,
  type DependencyConstraintEvaluationV1,
  type ReviewPolicyV1
} from "@archcontext/contracts";
import { completeTaskGate, type CompleteTaskInput } from "../src/index";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const sha = `sha256:${"a".repeat(64)}`;
const reviewSchema = JSON.parse(readFileSync(join(root, "schemas/runtime/review-result.schema.json"), "utf8"));

const base: CompleteTaskInput = {
  taskSessionId: "task.dependency-gate",
  posture: "normal",
  headSha: "abc",
  currentHeadSha: "abc",
  worktreeDigest: sha,
  modelDigest: sha,
  codeFactsDigest: sha
};

const ALL_CATEGORIES: ReviewPolicyV1 = { failOn: [...REVIEW_FAIL_ON_CATEGORIES], source: "policy-file" };

function evaluation(overrides: Partial<DependencyConstraintEvaluationV1> = {}): DependencyConstraintEvaluationV1 {
  return {
    schemaVersion: "archcontext.dependency-constraint-evaluation/v1",
    status: "pass",
    coverage: "complete",
    reasonCodes: [],
    constraintIds: ["constraint.core-not-runtime"],
    importEdgeCount: 12,
    unresolvedImports: [],
    violations: [],
    ...overrides
  };
}

const violation = {
  constraintId: "constraint.core-not-runtime",
  fromPath: "packages/core/review/src/index.ts",
  toPath: "packages/runtime/src/index.ts",
  fromNode: "component.core.review",
  toNode: "module.runtime",
  severity: "error" as const
};

describe("dependency constraint gate", () => {
  test("an error-severity violation fails the review with a prohibited-dependency finding", () => {
    const review = completeTaskGate({
      ...base,
      dependencyConstraints: evaluation({ status: "violated", violations: [violation] }),
      reviewPolicy: ALL_CATEGORIES
    });

    expect(review.result).toBe("fail_action_required");
    expect(review.findings).toEqual([expect.objectContaining({
      id: "prohibited-dependency:constraint.core-not-runtime:packages/core/review/src/index.ts->packages/runtime/src/index.ts",
      type: "prohibited-dependency",
      severity: "error"
    })]);
    expect((review.extensions as any).dependencyConstraintGate.status).toBe("violated");
    expect(validateJsonSchema(reviewSchema, review as any).valid).toBe(true);
  });

  test("a warning-severity constraint passes with warnings", () => {
    const review = completeTaskGate({
      ...base,
      dependencyConstraints: evaluation({ status: "violated", violations: [{ ...violation, severity: "warning" }] }),
      reviewPolicy: ALL_CATEGORIES
    });

    expect(review.result).toBe("pass_with_warnings");
    expect(review.findings.map((finding) => finding.severity)).toEqual(["warning"]);
  });

  test("an undetermined answer is never a pass", () => {
    const undetermined = evaluation({ status: "undetermined", coverage: "unknown", reasonCodes: ["code-facts-unavailable"], importEdgeCount: 0 });

    // Fail closed when the category is enforced, and when no policy was supplied at all.
    for (const reviewPolicy of [ALL_CATEGORIES, undefined]) {
      const review = completeTaskGate({ ...base, dependencyConstraints: undetermined, ...(reviewPolicy ? { reviewPolicy } : {}) });
      expect(review.result).toBe("fail_action_required");
      expect(review.findings).toEqual([expect.objectContaining({ id: "prohibited-dependency:undetermined", severity: "error" })]);
      expect(review.findings[0]!.message.startsWith("Cannot determine")).toBe(true);
    }

    // Not enforced: still visible, as a warning, never as a clean pass.
    const advisory = completeTaskGate({
      ...base,
      dependencyConstraints: undetermined,
      reviewPolicy: { failOn: ["invalid-schema"], source: "policy-file" }
    });
    expect(advisory.result).toBe("pass_with_warnings");
    expect(advisory.findings[0]!.message.startsWith("Cannot determine")).toBe(true);
  });

  test("pass and not-applicable add no finding but record the gate", () => {
    for (const status of ["pass", "not-applicable"] as const) {
      const review = completeTaskGate({ ...base, dependencyConstraints: evaluation({ status }), reviewPolicy: ALL_CATEGORIES });
      expect(review.result).toBe("pass");
      expect(review.findings).toEqual([]);
      expect((review.extensions as any).dependencyConstraintGate.status).toBe(status);
    }
  });

  test("a stale task snapshot skips the evaluation with a marker", () => {
    const review = completeTaskGate({
      ...base,
      currentHeadSha: "def",
      dependencyConstraints: evaluation({ status: "violated", violations: [violation] }),
      reviewPolicy: ALL_CATEGORIES
    });

    expect(review.findings.map((finding) => finding.id)).toEqual(["stale-context"]);
    expect((review.extensions as any).dependencyConstraintChecksSkipped).toBe("stale-context");
    expect((review.extensions as any).dependencyConstraintGate).toBeUndefined();
  });

  test("an invalid model is an invalid-schema finding", () => {
    const review = completeTaskGate({ ...base, modelValidationErrors: [".archcontext/model/constraints/x.yaml: bad"], reviewPolicy: ALL_CATEGORIES });

    expect(review.result).toBe("fail_action_required");
    expect(review.findings).toEqual([expect.objectContaining({ id: "invalid-schema", type: "invalid-schema", severity: "error" })]);
  });
});

describe("review policy failOn", () => {
  test("a failOn missing the category downgrades its errors to warnings and says why", () => {
    const review = completeTaskGate({
      ...base,
      dependencyConstraints: evaluation({ status: "violated", violations: [violation] }),
      cleanupRequired: 1,
      cleanupCompleted: 0,
      reviewPolicy: { failOn: ["invalid-schema", "stale-context"], source: "policy-file" }
    });

    expect(review.result).toBe("pass_with_warnings");
    expect(review.summary).toEqual({ errors: 0, warnings: 2, notices: 0 });
    expect(review.findings.every((finding) => finding.severity === "warning")).toBe(true);
    expect(review.findings.find((finding) => finding.id === "cleanup-incomplete")!.message)
      .toContain("review policy failOn does not include incomplete-intervention");
    expect((review.extensions as any).reviewPolicy).toEqual({
      failOn: ["invalid-schema", "stale-context"],
      source: "policy-file",
      downgradedFindingIds: [
        "cleanup-incomplete",
        "prohibited-dependency:constraint.core-not-runtime:packages/core/review/src/index.ts->packages/runtime/src/index.ts"
      ]
    });
  });

  test("compatibility finding types map onto unjustified-compatibility", () => {
    const enforced = completeTaskGate({ ...base, compatibilityPathIntroduced: true, reviewPolicy: ALL_CATEGORIES });
    expect(enforced.result).toBe("fail_action_required");

    const relaxed = completeTaskGate({
      ...base,
      compatibilityPathIntroduced: true,
      compatibilityContract: { kind: "not-a-kind", reason: "large diff", owner: "team", consumers: ["x"], removalConditions: ["y"], reviewAt: "2026-12-01" },
      reviewPolicy: { failOn: ["invalid-schema"], source: "policy-file" }
    });
    expect(relaxed.findings.map((finding) => [finding.type, finding.severity])).toEqual([
      ["invalid-compatibility-contract", "warning"],
      ["unjustified-compatibility-path", "warning"]
    ]);
  });

  test("findings outside the vocabulary are untouched, and no policy keeps producer severity", () => {
    const drift = {
      schemaVersion: "archcontext.complete-task-projection-drift/v1" as const,
      ok: false,
      sourceDigest: sha,
      projectionDigest: sha,
      rendererVersion: "v1",
      targetCount: 1,
      fileCount: 1,
      driftCount: 1,
      rejectedCount: 0,
      reasonCodes: ["drift"]
    };
    const governed = completeTaskGate({ ...base, projectionDrift: drift, reviewPolicy: { failOn: [], source: "policy-file" } });
    expect(governed.findings.map((finding) => [finding.id, finding.severity])).toEqual([["projection-drift", "error"]]);

    const ungoverned = completeTaskGate({ ...base, cleanupRequired: 1 });
    expect(ungoverned.findings.map((finding) => finding.severity)).toEqual(["error"]);
    expect((ungoverned.extensions as any).reviewPolicy).toBeUndefined();
  });
});
