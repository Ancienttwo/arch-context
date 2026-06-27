import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl10RecommendationQualityReadback } from "./architecture-ledger-al10-recommendation-quality-readback";

describe("AL10 recommendation quality readback evidence", () => {
  test("accepts a complete recommendation quality packet", () => {
    const result = inspectArchitectureLedgerAl10RecommendationQualityReadback(completePacket());

    expect(result.ok).toBe(true);
    expect(result.status).toBe("verified");
    const gates = result.gates as Record<string, string>;
    expect(gates["AL10-08"]).toBe("verified");
    expect(gates["AL10-BETA-4"]).toBe("verified");
  });

  test("rejects AL1 quality regressions", () => {
    const packet = completePacket();
    packet.metrics.top3Recall = 0.91;
    packet.metrics.recommendationPrecisionAt3 = 0.79;
    packet.metrics.noKeywordStructuralRecall = 0.89;
    packet.metrics.directPracticeReferenceRecall = 0.99;
    packet.metrics.evidenceShuffleContaminationRate = 0.1;
    packet.assertions["AL10-BETA-4"] = false;

    const result = inspectArchitectureLedgerAl10RecommendationQualityReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("metrics.top3Recall below AL1 threshold");
    expect(result.failures).toContain("metrics.recommendationPrecisionAt3 below AL1 threshold");
    expect(result.failures).toContain("metrics.noKeywordStructuralRecall below AL1 threshold");
    expect(result.failures).toContain("metrics.directPracticeReferenceRecall below AL1 threshold");
    expect(result.failures).toContain("metrics.evidenceShuffleContaminationRate must be 0");
    expect(result.failures).toContain("assertions.AL10-BETA-4 must be true");
  });

  test("rejects missing frozen no-label and per-practice support evidence", () => {
    const packet = completePacket();
    packet.frozenDatasets = [];
    packet.noLabel.noEvidence = false;
    packet.noLabel.noPracticeBindings = false;
    packet.noLabel.practiceIdTaskHitCaseIds = ["practice-no-label-001"];
    packet.noLabel.verified = false;
    packet.perPracticeSupport[0].matched = 0;
    packet.supportSummary.incompletePracticeIds = ["api.contract-before-implementation"];
    packet.supportSummary.minRecall = 0;
    packet.assertions["AL10-08"] = false;

    const result = inspectArchitectureLedgerAl10RecommendationQualityReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("frozenDatasets must include all representative practice JSONL files");
    expect(result.failures).toContain("noLabel evidence arrays must be empty");
    expect(result.failures).toContain("noLabel practiceBindings must be absent");
    expect(result.failures).toContain("noLabel task label leakage present: practice-no-label-001");
    expect(result.failures).toContain("api.contract-before-implementation: matched support below expected");
    expect(result.failures).toContain("incomplete practice support present: api.contract-before-implementation");
    expect(result.failures).toContain("assertions.AL10-08 must be true");
  });

  test("rejects AL10-09 or GA gate overclaim", () => {
    const packet = completePacket();
    packet.gates.push("AL10-09");
    packet.scope.closedGates.push("AL10-09");
    packet.assertions["AL10-09"] = true;

    const result = inspectArchitectureLedgerAl10RecommendationQualityReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("gates must be exactly AL10-08 and AL10-BETA-4");
    expect(result.failures).toContain("scope.closedGates must be exactly AL10-08 and AL10-BETA-4");
    expect(result.failures).toContain("unexpected gate assertion: AL10-09");
  });
});

function completePacket(): any {
  return {
    schemaVersion: "archcontext.architecture-ledger-al10-recommendation-quality-readback/v1",
    generatedAt: "1970-01-01T00:00:00.000Z",
    gates: ["AL10-08", "AL10-BETA-4"],
    status: "verified",
    scope: {
      closedGates: ["AL10-08", "AL10-BETA-4"],
      explicitlyOpen: ["AL10-09", "AL10-10"]
    },
    thresholds: {
      practiceTop3Recall: 0.92,
      recommendationPrecisionAt3: 0.8,
      benignPrecision: 0.95,
      noKeywordStructuralRecall: 0.9,
      directPracticeReferenceRecall: 1,
      evidenceShuffleContaminationRate: 0,
      heuristicOnlyHardGateRate: 0,
      dynamicDocHardGateRate: 0,
      waiverRejectedRate: 1,
      noKeywordStructuralPositiveCases: 30,
      directPracticeReferenceCases: 30,
      negativePracticeCases: 60,
      enforcementWaiverAdversarialCases: 20
    },
    evalDigest: `sha256:${"a".repeat(64)}`,
    summary: {
      positiveCases: 60,
      noKeywordStructuralPositiveCases: 30,
      directPracticeReferenceCases: 30,
      negativeCases: 80,
      adversarialCases: 20,
      totalScenarios: 190,
      chineseCases: 65,
      chineseRatio: 0.3421,
      keywordHeavyBenignNegativeCases: 30,
      budgetIrrelevantResourceCases: 20,
      enforcementWaiverAdversarialCases: 20
    },
    metrics: {
      top3Recall: 1,
      recommendationPrecisionAt3: 1,
      recommendationRecallAt3: 0.4444,
      benignPrecision: 1,
      noKeywordStructuralRecall: 1,
      directPracticeReferenceRecall: 1,
      evidenceShuffleContaminationRate: 0,
      heuristicOnlyHardGateRate: 0,
      dynamicDocHardGateRate: 0,
      waiverRejectedRate: 1
    },
    frozenDatasets: [
      frozenDataset("evals/practices/structural-positive.jsonl"),
      frozenDataset("evals/practices/no-keyword-structural-positive.jsonl"),
      frozenDataset("evals/practices/direct-practice-reference.jsonl"),
      frozenDataset("evals/practices/benign-negative.jsonl"),
      frozenDataset("evals/practices/keyword-heavy-benign-negative.jsonl"),
      frozenDataset("evals/practices/budget-irrelevant-resource.jsonl"),
      frozenDataset("evals/practices/enforcement-waiver-adversarial.jsonl")
    ],
    noLabel: {
      path: "evals/practices/no-keyword-structural-positive.jsonl",
      sha256: `sha256:${"b".repeat(64)}`,
      caseCount: 30,
      threshold: 30,
      allNoLabelIds: true,
      idMismatches: [],
      allScenarioTypesNoKeywordStructural: true,
      scenarioTypeMismatches: [],
      noEvidence: true,
      evidenceCaseIds: [],
      noPracticeBindings: true,
      practiceBindingCaseIds: [],
      practiceIdTaskHitCaseIds: [],
      datasetMetadataViolationCount: 0,
      recall: 1,
      verified: true
    },
    supportSummary: {
      practiceCount: 2,
      expectedTotal: 6,
      matchedTotal: 6,
      minRecall: 1,
      incompletePracticeIds: [],
      highConfidenceMatches: 6,
      mediumConfidenceMatches: 0,
      lowConfidenceMatches: 0
    },
    perPracticeSupport: [
      supportRow("api.contract-before-implementation", 5),
      supportRow("data.single-authoritative-model", 1)
    ],
    qualityViolations: {
      datasetMetadataViolations: [],
      prohibitedMatchIds: [],
      evidenceMinimumViolations: [],
      enforcementCeilingViolations: [],
      missedPositiveIds: [],
      missedNoKeywordStructuralIds: [],
      missedDirectReferenceIds: [],
      negativeNonAdvisoryCaseIds: [],
      evidenceShuffleViolationIds: [],
      waiverRejectionMissIds: [],
      hardGateMissIds: []
    },
    failedEvalGates: [],
    assertions: {
      "AL10-08": true,
      "AL10-BETA-4": true,
      frozenDatasetDigestsPresent: true,
      noLabelCaseMinimum: true,
      noLabelTaskAndEvidenceLeakFree: true,
      noLabelDatasetMetadataClean: true,
      perPracticeSupportPublished: true,
      perPracticeSupportComplete: true,
      al1PracticeTop3Recall: true,
      al1RecommendationPrecisionAt3: true,
      al1NoKeywordStructuralRecall: true,
      al1DirectPracticeReferenceRecall: true,
      al1EvidenceShuffleClean: true,
      hardGateFalsePositiveClean: true,
      qualityViolationArraysEmpty: true,
      noFailedEvalGates: true
    },
    failures: []
  };
}

function frozenDataset(path: string): any {
  return {
    id: path,
    role: "test",
    path,
    lineCount: 1,
    caseCount: 1,
    sha256: `sha256:${"c".repeat(64)}`,
    firstCaseId: "case-1",
    lastCaseId: "case-1",
    scenarioTypes: ["test"],
    languages: ["zh"]
  };
}

function supportRow(practiceId: string, expected: number): any {
  return {
    practiceId,
    expected,
    matched: expected,
    recall: 1,
    highConfidence: expected,
    mediumConfidence: 0,
    lowConfidence: 0
  };
}
