import { describe, expect, test } from "bun:test";
import { digestJson, type RecommendationV2 } from "@archcontext/contracts";
import {
  planRecommendationRun,
  recommendationFingerprint,
  recommendationRunLedgerPayload,
  transitionRecommendationLifecycle,
  type PlanRecommendationRunInput,
  type RecommendationSchedulerCandidate
} from "../src";

describe("recommendation-engine", () => {
  test("creates stable run records, fingerprints and explanation trees", () => {
    const input = inputFixture({
      candidates: [highRiskUncertainCandidate()]
    });
    const plan = planRecommendationRun(input);
    const recommendation = plan.recommendations[0];
    const explanationTree = recommendation.extensions?.explanationTree as any;

    expect(plan.run.engineVersion).toBe("archcontext.recommendation-scheduler/v1");
    expect(plan.run.catalogDigest).toBe(input.catalogDigest);
    expect(plan.run.inputDigest).toStartWith("sha256:");
    expect(plan.run.outputDigest).toStartWith("sha256:");
    expect(plan.run.extensions?.inputCursor).toEqual(input.inputCursor as any);
    expect(recommendation.fingerprint).toBe(recommendationFingerprint(highRiskUncertainCandidate()));
    expect(recommendation.risk).toBe("high");
    expect(recommendation.uncertainty).toBe("high");
    expect(plan.run.trigger.level).toBe("L3");
    expect(plan.investigationEligibleRecommendationIds).toEqual([recommendation.recommendationId]);
    expect(explanationTree).toMatchObject({
      schemaVersion: "archcontext.recommendation-explanation-tree/v1",
      trigger: { level: "L3", source: "checkpoint" },
      subject: "module.checkout-runtime",
      risk: { level: "high" },
      uncertainty: { level: "high" },
      policyOutcome: { l3InvestigationEligible: true }
    });
  });

  test("suppresses unchanged active fingerprints across runs", () => {
    const first = planRecommendationRun(inputFixture({
      candidates: [mediumRiskCandidate()]
    }));
    const second = planRecommendationRun(inputFixture({
      candidates: [mediumRiskCandidate()],
      previousRecommendations: [previousFrom(first.recommendations[0])]
    }));

    expect(second.recommendations).toHaveLength(0);
    expect(second.suppressed).toMatchObject([{
      reasonCode: "duplicate-active-fingerprint",
      fingerprint: first.recommendations[0].fingerprint,
      previousRecommendationId: first.recommendations[0].recommendationId
    }]);
    expect(second.run.metrics.matchCount).toBe(1);
  });

  test("keeps high risk and low uncertainty at L2 unless both thresholds qualify for L3", () => {
    const plan = planRecommendationRun(inputFixture({
      candidates: [{
        ...highRiskUncertainCandidate(),
        confidence: "high",
        uncertaintySignals: []
      }]
    }));

    expect(plan.run.trigger.level).toBe("L2");
    expect(plan.recommendations[0].risk).toBe("high");
    expect(plan.recommendations[0].uncertainty).toBe("low");
    expect(plan.recommendations[0].extensions?.l3InvestigationEligible).toBe(false);
  });

  test("suppresses recommendations under matching practice and subject cooldown", () => {
    const plan = planRecommendationRun(inputFixture({
      candidates: [mediumRiskCandidate()],
      cooldowns: [{
        practiceId: "practice.runtime-boundary",
        subject: "module.checkout-runtime",
        lastRecommendedAt: "2026-06-25T12:00:00.000Z",
        cooldownUntil: "2026-06-30T12:00:00.000Z"
      }]
    }));

    expect(plan.recommendations).toHaveLength(0);
    expect(plan.suppressed).toMatchObject([{
      reasonCode: "cooldown-active",
      subject: "module.checkout-runtime",
      practiceId: "practice.runtime-boundary",
      cooldownUntil: "2026-06-30T12:00:00.000Z"
    }]);
  });

  test("transitions lifecycle states and preserves audit metadata", () => {
    const plan = planRecommendationRun(inputFixture({
      candidates: [mediumRiskCandidate()]
    }));
    const accepted = transitionRecommendationLifecycle(plan.recommendations[0], {
      action: "accept",
      now: "2026-06-26T12:05:00.000Z",
      actor: "developer",
      reason: "accepted by AL8 readback"
    });

    expect(accepted.status).toBe("accepted");
    expect(accepted.updatedAt).toBe("2026-06-26T12:05:00.000Z");
    expect(accepted.extensions?.lifecycle).toMatchObject({
      previousStatus: "open",
      status: "accepted",
      action: "accept",
      actor: "developer"
    });
    expect(() => transitionRecommendationLifecycle(
      { ...accepted, status: "resolved" },
      { action: "accept", now: "2026-06-26T12:06:00.000Z" }
    )).toThrow("recommendation-lifecycle-terminal-status: resolved");
  });

  test("serializes a ledger payload with runs and recommendations only", () => {
    const plan = planRecommendationRun(inputFixture({
      candidates: [mediumRiskCandidate()]
    }));
    const payload = recommendationRunLedgerPayload(plan);

    expect(payload.recommendationRuns).toHaveLength(1);
    expect(payload.recommendations).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain("sourceCode");
    expect(JSON.stringify(payload)).not.toContain("rawDiff");
  });
});

function inputFixture(overrides: Partial<PlanRecommendationRunInput> = {}): PlanRecommendationRunInput {
  return {
    repository: {
      repositoryId: "repo.arch-context",
      storageRepositoryId: "repo.arch-context"
    },
    worktree: {
      workspaceId: "workspace.arch-context",
      storageWorkspaceId: "workspace.arch-context",
      branch: "codex/al8",
      headSha: "0123456789abcdef0123456789abcdef01234567",
      worktreeDigest: digestJson({ fixture: "worktree" })
    },
    triggerSource: "checkpoint",
    policyMode: "advisory",
    catalogDigest: digestJson({ fixture: "catalog" }),
    inputCursor: {
      source: "candidate-delta",
      baseDigest: digestJson({ base: "architecture" }),
      headDigest: digestJson({ head: "architecture" }),
      headSha: "0123456789abcdef0123456789abcdef01234567",
      candidateDeltaDigest: digestJson({ delta: "candidate" })
    },
    candidates: [],
    now: "2026-06-26T12:00:00.000Z",
    ...overrides
  };
}

function highRiskUncertainCandidate(): RecommendationSchedulerCandidate {
  return {
    practiceId: "practice.runtime-boundary",
    subject: "module.checkout-runtime",
    confidence: "low",
    enforcement: "checkpoint",
    evidenceBindingIds: ["evidence.checkout.boundary", "evidence.checkout.payment"],
    explanation: ["Checkout runtime changed a payment-facing persistence boundary with ambiguous ownership evidence."],
    baselineDigest: digestJson({ baseline: "checkout-runtime" }),
    riskSignals: ["persistence-change", "payment-domain-change"],
    uncertaintySignals: ["mapping-ambiguity"],
    score: 91
  };
}

function mediumRiskCandidate(): RecommendationSchedulerCandidate {
  return {
    practiceId: "practice.runtime-boundary",
    subject: "module.checkout-runtime",
    confidence: "medium",
    enforcement: "advisory",
    evidenceBindingIds: ["evidence.checkout.boundary"],
    explanation: ["Runtime boundary changed and should be reviewed by architecture owner."],
    baselineDigest: digestJson({ baseline: "checkout-runtime" }),
    riskSignals: ["boundary-change"],
    uncertaintySignals: [],
    score: 52
  };
}

function previousFrom(recommendation: RecommendationV2) {
  return {
    recommendationId: recommendation.recommendationId,
    fingerprint: recommendation.fingerprint,
    subject: recommendation.subject,
    practiceId: recommendation.practiceId,
    status: recommendation.status,
    updatedAt: recommendation.updatedAt
  };
}
