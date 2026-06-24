import { describe, expect, test } from "bun:test";
import {
  buildPracticeAssetsS6EvalReadbackPacket,
  inspectPracticeAssetsS6EvalReadback
} from "./practice-assets-s6-eval-readback";

describe("practice-assets-s6-eval-readback", () => {
  test("accepts a verified S6 eval packet", () => {
    expect(inspectPracticeAssetsS6EvalReadback(buildPracticeAssetsS6EvalReadbackPacket(verifiedEvalResult()))).toMatchObject({
      ok: true,
      positiveCases: 60,
      negativeCases: 80,
      adversarialCases: 20,
      failures: []
    });
  });

  test("reports the live built S6 eval packet without hiding gate failures", () => {
    const packet = buildPracticeAssetsS6EvalReadbackPacket();
    const result = inspectPracticeAssetsS6EvalReadback(packet);

    expect(result.ok).toBe(packet.status === "verified");
    if (packet.status !== "verified") {
      expect(result.failures.length).toBeGreaterThan(0);
      expect(result.failures).toContain("status must be verified");
      expect(packet.failedGates.length).toBeGreaterThan(0);
    }
  });

  test("rejects an undersized practice dataset packet", () => {
    const packet = buildPracticeAssetsS6EvalReadbackPacket();
    packet.status = "failed";
    packet.summary.positiveCases = 59;
    packet.assertions.positiveCaseMinimum = false;

    const result = inspectPracticeAssetsS6EvalReadback(packet);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("status must be verified");
    expect(result.failures).toContain("summary.positiveCases below S6 minimum");
    expect(result.failures).toContain("assertions.positiveCaseMinimum must be true");
  });

  test("rejects failed gate evidence", () => {
    const packet = buildPracticeAssetsS6EvalReadbackPacket();
    packet.status = "failed";
    packet.failedGates = [{
      target: "Practice Top-3 recall",
      metric: "recall @ top-k 3",
      threshold: ">= 92.0%",
      observed: "0.0%",
      pass: false
    }];
    packet.assertions.noFailedGates = false;

    const result = inspectPracticeAssetsS6EvalReadback(packet);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("failed gates present: Practice Top-3 recall");
    expect(result.failures).toContain("assertions.noFailedGates must be true");
  });
});

function verifiedEvalResult(): any {
  return {
    compatibility: {},
    drift: {},
    retrieval: {
      queries: 22,
      constraintRecall: 0.95,
      irrelevantRatio: 0.15
    },
    chinese: {},
    practices: {
      positiveCases: 60,
      negativeCases: 80,
      adversarialCases: 20,
      totalScenarios: 160,
      chineseCases: 50,
      chineseRatio: 0.313,
      noKeywordStructuralPositiveCases: 30,
      directPracticeReferenceCases: 30,
      keywordHeavyBenignNegativeCases: 30,
      enforcementWaiverAdversarialCases: 20,
      budgetIrrelevantResourceCases: 20,
      top3Recall: 0.92,
      benignPrecision: 0.95,
      noKeywordStructuralRecall: 0.85,
      directPracticeReferenceRecall: 1,
      heuristicOnlyHardGateRate: 0,
      dynamicDocHardGateRate: 0,
      waiverRejectedRate: 1,
      datasetMetadataViolations: [],
      prohibitedMatchIds: [],
      evidenceMinimumViolations: [],
      enforcementCeilingViolations: [],
      missedPositiveIds: [],
      missedDirectReferenceIds: [],
      negativeNonAdvisoryCaseIds: [],
      waiverRejectionMissIds: [],
      hardGateMissIds: []
    },
    invariant: {},
    gates: [{ target: "Practice Top-3 recall", metric: "recall @ top-k 3", threshold: ">= 92.0%", observed: "92.0%", pass: true }],
    allPass: true
  };
}
