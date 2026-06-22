import { describe, expect, test } from "bun:test";
import { inspectFg6SloReadback } from "./fg6-slo-readback";

describe("fg6 slo readback evidence", () => {
  test("accepts SLO definitions, source coverage, probes, and success-rate evidence", () => {
    expect(inspectFg6SloReadback(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects missing metrics, over-budget observations, and weak success evidence", () => {
    const recording: any = verifiedRecording();
    recording.evidence.observations.challengeCreateLatencyP95Ms = 3000;
    recording.evidence.observations.verifyLatencyP95Ms = 3000;
    recording.evidence.observations.checkDeliveryLagP95Ms = 70000;
    recording.evidence.observations.eligibleRequiredCheckSuccessRate = 0.5;
    recording.evidence.controlPlaneProbe.publicationPublished = false;
    recording.evidence.controlPlaneProbe.samples[0].metadataDigest = "bad";
    recording.evidence.successEvidence.successfulChecks = 1;
    recording.evidence.successEvidence.secretMarkerHits = 1;
    recording.evidence.sourceCoverage.metricNames = ["challenge_age_ms"];
    recording.evidence.sourceCoverage.controlPlaneTestAssertions.challengeCreateLatency = false;
    recording.evidence.sourceCoverage.controlPlaneTestAssertions.challengeCreateReplayNotDoubleCounted = false;
    recording.evidence.sourceCoverage.prdBudgets.s08CheckUpdateP95Ms = null;
    recording.evidence.sourceCoverage.incidentDashboard.alertKinds = ["webhook-backlog"];
    recording.evidence.assertions.challengeCreateTargetSatisfied = false;
    recording.evidence.assertions.verifyTargetSatisfied = false;
    recording.evidence.assertions.checkDeliveryTargetSatisfied = false;
    recording.evidence.assertions.successRateTargetSatisfied = false;
    recording.evidence.assertions.sourceMetricCoverageComplete = false;
    recording.evidence.assertions.controlPlaneRegressionCoverageComplete = false;
    recording.evidence.assertions.incidentCoverageComplete = false;
    recording.evidence.assertions.prdBudgetsCovered = false;
    recording.evidence.assertions.metadataOnly = false;

    const result = inspectFg6SloReadback(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("challenge create latency exceeds SLO");
    expect(result.failures).toContain("verify latency exceeds SLO");
    expect(result.failures).toContain("check delivery lag exceeds SLO");
    expect(result.failures).toContain("required Check success rate below SLO");
    expect(result.failures).toContain("control-plane probe must publish a success Check delivery");
    expect(result.failures).toContain("probe sample metadataDigest must be sha256");
    expect(result.failures).toContain("all eligible release Checks must be successful");
    expect(result.failures).toContain("success evidence must have zero secret marker hits");
    expect(result.failures).toContain("missing metric coverage: challenge_create_latency_ms");
    expect(result.failures).toContain("control-plane test assertion missing: challengeCreateLatency");
    expect(result.failures).toContain("control-plane test assertion missing: challengeCreateReplayNotDoubleCounted");
    expect(result.failures).toContain("PRD S-08 budget missing");
    expect(result.failures).toContain("incident dashboard missing alert kind: verify-failure");
    expect(result.failures).toContain("assertion metadataOnly must be true");
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg6-slo-readback/v1",
    taskId: "FG6-14",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T10:00:00.000Z",
    sources: {},
    sloDefinitions: [
      { id: "challenge-create-p95" },
      { id: "attestation-verify-p95" },
      { id: "check-delivery-p95" },
      { id: "eligible-required-check-success-rate" }
    ],
    evidence: {
      observations: {
        challengeCreateLatencyP95Ms: 10,
        verifyLatencyP95Ms: 500,
        checkDeliveryLagP95Ms: 40000,
        eligibleRequiredCheckSuccessRate: 1
      },
      controlPlaneProbe: {
        publicationPublished: true,
        samples: [
          { name: "challenge_create_latency_ms", metadataDigest: `sha256:${"a".repeat(64)}` },
          { name: "check_delivery_lag_ms", metadataDigest: `sha256:${"b".repeat(64)}` }
        ]
      },
      successEvidence: {
        eligibleChecks: 3,
        successfulChecks: 3,
        successRate: 1,
        secretMarkerHits: 0
      },
      sourceCoverage: {
        metricNames: [
          "challenge_create_latency_ms",
          "challenge_age_ms",
          "verify_latency_ms",
          "check_delivery_lag_ms",
          "check_delivery_retry_total",
          "reject_reason_total"
        ],
        controlPlaneTestAssertions: {
          challengeCreateLatency: true,
          challengeCreateReplayNotDoubleCounted: true,
          challengeAge: true,
          verifyLatency: true,
          verifyLatencyFixtureMs: 500,
          checkDeliveryLag: true,
          checkDeliveryRetryTotal: true,
          rejectReason: true,
          successPublication: true
        },
        prdBudgets: {
          s08CheckUpdateP95Ms: 60000,
          s09WebhookP95Ms: 2000
        },
        incidentDashboard: {
          alertKinds: ["webhook-backlog", "verify-failure", "check-dlq", "github-api-failure"],
          rows: [
            { alertKind: "webhook-backlog" },
            { alertKind: "verify-failure" },
            { alertKind: "check-dlq" },
            { alertKind: "github-api-failure" }
          ]
        },
        metricSamplesMetadataOnly: true
      },
      assertions: {
        sloDefinitionsComplete: true,
        challengeCreateTargetSatisfied: true,
        verifyTargetSatisfied: true,
        checkDeliveryTargetSatisfied: true,
        successRateTargetSatisfied: true,
        sourceMetricCoverageComplete: true,
        controlPlaneRegressionCoverageComplete: true,
        incidentCoverageComplete: true,
        prdBudgetsCovered: true,
        metadataOnly: true
      }
    },
    failures: []
  };
}
