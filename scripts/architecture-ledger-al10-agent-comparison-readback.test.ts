import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl10AgentComparisonReadback } from "./architecture-ledger-al10-agent-comparison-readback";

describe("AL10 agent comparison readback evidence", () => {
  test("accepts a complete deterministic vs plus-agent comparison packet", () => {
    const result = inspectArchitectureLedgerAl10AgentComparisonReadback(completePacket());

    expect(result.ok).toBe(true);
    expect(result.status).toBe("verified");
    const gates = result.gates as Record<string, string>;
    expect(gates["AL10-09"]).toBe("verified");
  });

  test("rejects outcome regression or deterministic gate failure", () => {
    const packet = completePacket();
    packet.deterministicOnly.allEvalGatesPass = false;
    packet.deterministicOnly.failedEvalGateCount = 1;
    packet.outcomeComparison.metricDeltaCount = 1;
    packet.outcomeComparison.metricDeltas = ["top3Recall"];
    packet.outcomeComparison.qualityViolationDeltaCount = 1;
    packet.outcomeComparison.qualityViolationDeltas = ["missedPositiveIds"];
    packet.assertions.noOutcomeRegression = false;

    const result = inspectArchitectureLedgerAl10AgentComparisonReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("deterministic eval gates must pass");
    expect(result.failures).toContain("deterministic failedEvalGateCount must be 0");
    expect(result.failures).toContain("outcome metric deltas present: top3Recall");
    expect(result.failures).toContain("quality violation deltas present: missedPositiveIds");
    expect(result.failures).toContain("assertions.noOutcomeRegression must be true");
  });

  test("rejects missing cost evidence or direct mutation", () => {
    const packet = completePacket();
    packet.deterministicPlusAgent.directMutationAttempts = 1;
    packet.deterministicPlusAgent.runs[0].directMutationAllowed = true;
    packet.deterministicPlusAgent.runs[0].cost.estimatedAgentTokens = 0;
    packet.costComparison.estimatedAgentTokens = 0;
    packet.costComparison.agentDurationMs = 0;
    packet.costComparison.actualExternalProviderCostUsd = 0.25;
    packet.assertions.advisoryOnly = false;
    packet.assertions.costMeasured = false;
    packet.assertions.noExternalProviderCost = false;

    const result = inspectArchitectureLedgerAl10AgentComparisonReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("agent direct mutation attempts must be 0");
    expect(result.failures).toContain("blind-no-label-positive: directMutationAllowed must be false");
    expect(result.failures).toContain("blind-no-label-positive: estimated agent tokens missing");
    expect(result.failures).toContain("estimatedAgentTokens must be positive");
    expect(result.failures).toContain("agentDurationMs must be positive");
    expect(result.failures).toContain("actualExternalProviderCostUsd must be 0 for fake-provider readback");
  });

  test("rejects gate overclaim", () => {
    const packet = completePacket();
    packet.gates.push("AL10-10");
    packet.scope.closedGates.push("AL10-10");
    packet.assertions["AL10-10"] = true;

    const result = inspectArchitectureLedgerAl10AgentComparisonReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("gates must be exactly AL10-09");
    expect(result.failures).toContain("scope.closedGates must be exactly AL10-09");
    expect(result.failures).toContain("unexpected gate assertion: AL10-10");
  });
});

function completePacket(): any {
  return {
    schemaVersion: "archcontext.architecture-ledger-al10-agent-comparison-readback/v1",
    generatedAt: "1970-01-01T00:00:00.000Z",
    gates: ["AL10-09"],
    status: "verified",
    scope: {
      closedGates: ["AL10-09"],
      explicitlyOpen: ["AL10-10", "AL10-GA-1"]
    },
    comparisonDigest: `sha256:${"a".repeat(64)}`,
    deterministicOnly: {
      mode: "deterministic-only",
      status: "passed",
      allEvalGatesPass: true,
      evalGateCount: 23,
      failedEvalGateCount: 0,
      metrics: {
        top3Recall: 1,
        recommendationPrecisionAt3: 1,
        noKeywordStructuralRecall: 1,
        directPracticeReferenceRecall: 1,
        benignPrecision: 1,
        evidenceShuffleContaminationRate: 0,
        heuristicOnlyHardGateRate: 0,
        dynamicDocHardGateRate: 0,
        waiverRejectedRate: 1
      },
      qualityViolationCounts: emptyQualityViolationCounts(),
      cost: {
        agentRunCount: 0,
        attempts: 0,
        durationMs: 0,
        inputBytes: 0,
        outputBytes: 0,
        estimatedAgentTokens: 0,
        actualExternalProviderCostUsd: 0
      }
    },
    deterministicPlusAgent: {
      mode: "deterministic-plus-agent",
      status: "passed",
      metrics: {
        top3Recall: 1,
        recommendationPrecisionAt3: 1,
        noKeywordStructuralRecall: 1,
        directPracticeReferenceRecall: 1,
        benignPrecision: 1,
        evidenceShuffleContaminationRate: 0,
        heuristicOnlyHardGateRate: 0,
        dynamicDocHardGateRate: 0,
        waiverRejectedRate: 1
      },
      qualityViolationCounts: emptyQualityViolationCounts(),
      agentRunCount: 4,
      succeededAgentRuns: 4,
      failedAgentRuns: 0,
      fallbackRunCount: 0,
      totalFindings: 3,
      advisoryOnly: true,
      directMutationAttempts: 0,
      runs: [
        run("blind-no-label-positive", 1),
        run("direct-reference-positive", 1),
        run("benign-negative", 0),
        run("waiver-adversarial", 1)
      ]
    },
    outcomeComparison: {
      comparisonComplete: true,
      deterministicAuthorityPreserved: true,
      deterministicStatus: "passed",
      plusAgentStatus: "passed",
      metricDeltas: [],
      metricDeltaCount: 0,
      qualityViolationDeltas: [],
      qualityViolationDeltaCount: 0,
      addedAdvisoryFindings: 3
    },
    costComparison: {
      comparisonComplete: true,
      deterministicAgentRunCount: 0,
      agentRunCount: 4,
      attempts: 4,
      deterministicEstimatedAgentTokens: 0,
      estimatedInputTokens: 1000,
      estimatedOutputTokens: 500,
      estimatedAgentTokens: 1500,
      agentDurationMs: 90,
      inputBytes: 4000,
      outputBytes: 2000,
      actualExternalProviderCostUsd: 0
    },
    assertions: {
      "AL10-09": true,
      deterministicBaselinePasses: true,
      agentRunsComplete: true,
      advisoryOnly: true,
      deterministicAuthorityPreserved: true,
      noOutcomeRegression: true,
      costMeasured: true,
      noExternalProviderCost: true,
      noFallbackUsed: true
    }
  };
}

function run(id: string, expectedFindings: number): any {
  return {
    id,
    deterministicOutcome: "expected",
    expectedFindings,
    reportStatus: "succeeded",
    findingCount: expectedFindings,
    validationValid: true,
    proposalAuthority: "advisory-only",
    proposalRequiredNextStep: "deterministic-validation",
    forbiddenActions: ["write-ledger", "apply-changeset"],
    directMutationAllowed: false,
    metadata: {
      provider: "fake-provider",
      fallbackUsed: false
    },
    cost: {
      attempts: 1,
      durationMs: 20,
      inputBytes: 1000,
      outputBytes: 500,
      estimatedInputTokens: 250,
      estimatedOutputTokens: 125,
      estimatedAgentTokens: 375,
      actualExternalProviderCostUsd: 0
    }
  };
}

function emptyQualityViolationCounts(): any {
  return {
    datasetMetadataViolations: 0,
    prohibitedMatchIds: 0,
    evidenceMinimumViolations: 0,
    enforcementCeilingViolations: 0,
    missedPositiveIds: 0,
    missedNoKeywordStructuralIds: 0,
    missedDirectReferenceIds: 0,
    negativeNonAdvisoryCaseIds: 0,
    evidenceShuffleViolationIds: 0,
    waiverRejectionMissIds: 0,
    hardGateMissIds: 0
  };
}
