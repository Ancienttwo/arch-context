import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl10TelemetryReadback } from "./architecture-ledger-al10-telemetry-readback";

describe("AL10 local beta telemetry readback evidence", () => {
  test("accepts a complete telemetry packet", () => {
    const result = inspectArchitectureLedgerAl10TelemetryReadback(completePacket());

    expect(result.ok).toBe(true);
    expect(result.status).toBe("verified");
    const gates = result.gates as Record<string, string>;
    expect(gates["AL10-13"]).toBe("verified");
  });

  test("rejects source, drift, or recommendation regressions", () => {
    const packet = completePacket();
    const source = packet.sourceReadbacks.find((item: any) => item.id === "recommendation-quality");
    source.status = "failed";
    source.ok = false;
    source.verified = false;
    source.missingGates = ["AL10-BETA-4"];
    packet.runs.verifiedSourceCount = 7;
    packet.drift.dualModeDriftCount = 1;
    packet.drift.knownUnresolvedDriftCount = 1;
    packet.recommendations.top3Recall = 0.91;
    packet.recommendations.qualityViolationCount = 1;
    packet.assertions.sourceReadbacksVerified = false;
    packet.assertions.driftTelemetryClean = false;
    packet.assertions.recommendationTelemetryCovered = false;
    packet.assertions["AL10-13"] = false;

    const result = inspectArchitectureLedgerAl10TelemetryReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("recommendation-quality: source status must be verified");
    expect(result.failures).toContain("recommendation-quality: source ok must be true");
    expect(result.failures).toContain("recommendation-quality: missing gates AL10-BETA-4");
    expect(result.failures).toContain("runs.verifiedSourceCount must include all AL10 source readbacks");
    expect(result.failures).toContain("drift.dualModeDriftCount must be 0");
    expect(result.failures).toContain("drift.knownUnresolvedDriftCount must be 0");
    expect(result.failures).toContain("recommendations.top3Recall below threshold");
    expect(result.failures).toContain("recommendations.qualityViolationCount must be 0");
    expect(result.failures).toContain("assertions.AL10-13 must be true");
  });

  test("rejects agent spawn, resolution, failure, or privacy regressions", () => {
    const packet = completePacket();
    packet.agentSpawn.defaultTotalSpawnedJobs = 1;
    packet.agentSpawn.defaultPathZeroSpawn = false;
    packet.agentSpawn.directMutationAttempts = 1;
    packet.resolution.rollbackDemonstrated = false;
    packet.resolution.chaosCaseOkCount = 5;
    packet.failureTelemetry.privacyLeakCount = 1;
    packet.failureTelemetry.stressLostEventCount = 1;
    packet.privacy.forbiddenRawContentHitCount = 1;
    packet.privacy.rawContentHits = ["/diff\\s+--git/i"];
    packet.privacy.clean = false;
    packet.assertions.agentSpawnTelemetryCovered = false;
    packet.assertions.resolutionTelemetryCovered = false;
    packet.assertions.failureTelemetryCovered = false;
    packet.assertions.noPrivateContent = false;

    const result = inspectArchitectureLedgerAl10TelemetryReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("agentSpawn.defaultTotalSpawnedJobs must be 0");
    expect(result.failures).toContain("agentSpawn.defaultPathZeroSpawn must be true");
    expect(result.failures).toContain("agentSpawn.directMutationAttempts must be 0");
    expect(result.failures).toContain("resolution.rollbackDemonstrated must be true");
    expect(result.failures).toContain("resolution chaos matrix must be fully ok");
    expect(result.failures).toContain("failureTelemetry.privacyLeakCount must be 0");
    expect(result.failures).toContain("failureTelemetry.stressLostEventCount must be 0");
    expect(result.failures).toContain("privacy forbiddenRawContentHitCount must be 0");
    expect(result.failures).toContain("privacy must be clean");
  });

  test("rejects gate overclaim", () => {
    const packet = completePacket();
    packet.gates.push("AL10-14");
    packet.scope.closedGates.push("AL10-14");
    packet.assertions["AL10-14"] = true;

    const result = inspectArchitectureLedgerAl10TelemetryReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("gates must be exactly AL10-13");
    expect(result.failures).toContain("scope.closedGates must be exactly AL10-13");
    expect(result.failures).toContain("unexpected gate assertion: AL10-14");
  });
});

function completePacket(): any {
  return {
    schemaVersion: "archcontext.architecture-ledger-al10-telemetry-readback/v1",
    generatedAt: "1970-01-01T00:00:00.000Z",
    gates: ["AL10-13"],
    status: "verified",
    scope: {
      closedGates: ["AL10-13"],
      explicitlyOpen: ["AL10-14", "AL10-15", "AL10-16", "AL10-GA-1"]
    },
    readbackDigest: `sha256:${"a".repeat(64)}`,
    sourceReadbacks: [
      source("rollout-workflow", ["AL10-01", "AL10-02"]),
      source("representative-benchmark", ["AL10-03", "AL10-04", "AL10-BETA-1"]),
      source("hardening", ["AL10-07", "AL10-BETA-2", "AL10-BETA-3", "AL10-BETA-5", "AL10-BETA-6"]),
      source("chaos-security", ["AL10-05", "AL10-06"]),
      source("recommendation-quality", ["AL10-08", "AL10-BETA-4"]),
      source("agent-comparison", ["AL10-09"]),
      source("release-packaging", ["AL10-10", "AL10-11"]),
      source("runbooks", ["AL10-12"])
    ],
    runs: {
      telemetrySourceCount: 8,
      verifiedSourceCount: 8,
      closedGateEvidenceCount: 19,
      representativeFixtureCount: 3,
      fullLoopReplayCount: 3,
      totalEntities: 172,
      totalRelations: 327,
      totalConstraints: 26,
      stressEventCount: 1000,
      stressReplayEventCount: 1000,
      chaosCaseCount: 6,
      securityCaseCount: 6,
      recommendationScenarioCount: 190,
      recommendationPracticeCount: 26,
      agentComparisonRunCount: 4,
      releaseMigrationStateCount: 5,
      runbookSectionCount: 5
    },
    drift: {
      representativeFixtureCount: 3,
      fixtureDriftCleanCount: 3,
      dualModeDriftCount: 0,
      rolloutDriftClean: true,
      rollbackAuthority: "yaml",
      rollbackRestoresYaml: true,
      knownUnresolvedDriftCount: 0
    },
    recommendations: {
      scenarioCount: 190,
      positiveCases: 60,
      noKeywordStructuralPositiveCases: 30,
      directPracticeReferenceCases: 30,
      negativeCases: 80,
      adversarialCases: 20,
      practiceCount: 26,
      expectedSupportTotal: 90,
      matchedSupportTotal: 90,
      minPracticeRecall: 1,
      supportComplete: true,
      top3Recall: 1,
      recommendationPrecisionAt3: 1,
      noKeywordStructuralRecall: 1,
      directPracticeReferenceRecall: 1,
      benignPrecision: 1,
      evidenceShuffleContaminationRate: 0,
      hardGateFalsePositiveRate: 0,
      waiverRejectedRate: 1,
      qualityViolationCount: 0,
      failedEvalGateCount: 0,
      thresholds: {
        practiceTop3Recall: 0.92,
        recommendationPrecisionAt3: 0.8,
        noKeywordStructuralRecall: 0.9,
        directPracticeReferenceRecall: 1,
        benignPrecision: 0.95
      }
    },
    agentSpawn: {
      defaultHookSampleCount: 9,
      defaultMedianSpawnCount: 0,
      defaultTotalSpawnedJobs: 0,
      defaultHookAllZeroSpawn: true,
      defaultPathZeroSpawn: true,
      explicitHighRiskEnqueued: true,
      agentComparisonRunCount: 4,
      succeededAgentRuns: 4,
      failedAgentRuns: 0,
      fallbackRunCount: 0,
      advisoryFindings: 3,
      advisoryOnly: true,
      directMutationAttempts: 0,
      attempts: 4,
      durationMs: 90,
      estimatedAgentTokens: 4769,
      actualExternalProviderCostUsd: 0
    },
    resolution: {
      rollbackDemonstrated: true,
      rollbackTargetAuthority: "yaml",
      chaosCaseCount: 6,
      chaosCaseOkCount: 6,
      securityCaseCount: 6,
      securityCaseOkCount: 6,
      privacySurfacesClean: true,
      privacySurfaceCount: 5,
      releaseMigrationStateCount: 5,
      releaseMigrationStatesVerified: 5,
      runbookSectionsVerified: 5,
      remainingOpenGates: ["AL10-14", "AL10-15", "AL10-16", "AL10-GA-1"]
    },
    failureTelemetry: {
      sourceReadbackFailureCount: 0,
      failedSourceReadbackCount: 0,
      failedEvalGateCount: 0,
      qualityViolationCount: 0,
      privacyLeakCount: 0,
      stressLostEventCount: 0,
      unexpectedDuplicateEventCount: 0,
      hookEnqueueP95AboveBetaBudget: true,
      activeBetaRiskCount: 1,
      activeBetaRisks: [
        {
          id: "hook-enqueue-p95-beta-budget",
          severity: "tracked-beta-risk",
          metric: "hookEnqueueP95Ms",
          actualMs: 154.458,
          budgetMs: 150
        }
      ],
      remainingOpenGateCount: 10
    },
    privacy: {
      forbiddenSecretHitCount: 0,
      forbiddenRawContentHitCount: 0,
      secretHits: [],
      rawContentHits: [],
      clean: true
    },
    assertions: {
      "AL10-13": true,
      sourceReadbacksVerified: true,
      runTelemetryCovered: true,
      driftTelemetryClean: true,
      recommendationTelemetryCovered: true,
      agentSpawnTelemetryCovered: true,
      resolutionTelemetryCovered: true,
      failureTelemetryCovered: true,
      performanceRiskCaptured: true,
      openGatesPreserved: true,
      noPrivateContent: true
    }
  };
}

function source(id: string, gates: string[]): any {
  return {
    id,
    path: `docs/verification/${id}.json`,
    sha256: `sha256:${"b".repeat(64)}`,
    schemaVersion: `archcontext.${id}/v1`,
    status: "verified",
    ok: true,
    gates,
    missingGates: [],
    requiredTermsPresent: ["term"],
    missingTerms: [],
    failureCount: 0,
    verified: true
  };
}
