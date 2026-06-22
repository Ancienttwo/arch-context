import { describe, expect, test } from "bun:test";
import { inspectFg6ChaosFaultMatrix } from "./fg6-chaos-fault-matrix-readback";

describe("fg6 chaos fault matrix readback evidence", () => {
  test("accepts Webhook DB Queue GitHub API and clock-skew fault evidence", () => {
    expect(inspectFg6ChaosFaultMatrix(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects missing fault classes, rollback, replay, clock skew, and source inspections", () => {
    const recording: any = verifiedRecording();
    recording.evidence.checkFailure.retryScheduledCount = 1;
    recording.evidence.checkFailure.replayStatusAfterReplay = "DEAD_LETTER";
    recording.evidence.incidents.failureClasses = ["queue", "github-api"];
    recording.evidence.controlPlaneFaultContracts.databaseTransactionRollback.checkDeliveryInsertRollback = false;
    recording.evidence.controlPlaneFaultContracts.clockSkewLimits.testRejectsClockSkew = false;
    recording.evidence.controlPlaneFaultContracts.currentHeadCheckGuards.noStaleConclusion = false;
    recording.evidence.sourceInspections.incidentDrill.ok = false;
    recording.evidence.assertions.webhookChaosCovered = false;
    recording.evidence.assertions.databaseChaosCovered = false;
    recording.evidence.assertions.clockSkewChaosCovered = false;
    recording.evidence.assertions.replayRestoresPendingWithoutAttempts = false;

    const result = inspectFg6ChaosFaultMatrix(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("checkFailure retryScheduledCount must be 2");
    expect(result.failures).toContain("checkFailure replay status must be PENDING");
    expect(result.failures).toContain("incident failureClass missing: webhook");
    expect(result.failures).toContain("incident failureClass missing: verify");
    expect(result.failures).toContain("databaseTransactionRollback.checkDeliveryInsertRollback must be true");
    expect(result.failures).toContain("clockSkewLimits.testRejectsClockSkew must be true");
    expect(result.failures).toContain("currentHeadCheckGuards.noStaleConclusion must be true");
    expect(result.failures).toContain("incidentDrill source inspection must pass");
    expect(result.failures).toContain("assertion webhookChaosCovered must be true");
    expect(result.failures).toContain("assertion databaseChaosCovered must be true");
    expect(result.failures).toContain("assertion clockSkewChaosCovered must be true");
    expect(result.failures).toContain("assertion replayRestoresPendingWithoutAttempts must be true");
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg6-chaos-fault-matrix-readback/v1",
    taskId: "FG6-10",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T10:00:00.000Z",
    sources: {
      checkFailureSource: "docs/verification/fg5-check-failure-readback.json",
      incidentDrillSource: "docs/verification/fg5-control-plane-incident-drill.json",
      controlPlaneGate: "docs/verification/fg5-control-plane-gate.md",
      controlPlaneTest: "packages/cloud/control-plane/test/control-plane.test.ts"
    },
    evidence: {
      checkFailure: {
        checkApiFailureInjected: true,
        checkName: "ArchContext / Developer Review",
        injectedGitHubApiFailureCount: 2,
        injectedStatusCodes: [503, 503],
        retryScheduledCount: 2,
        maxAttemptsReached: true,
        maxAttemptRetry: false,
        maxAttemptReason: "check-delivery-max-attempts-reached",
        deadLetterStatus: "DEAD_LETTER",
        deadLetterErrorCode: "CHECK_DELIVERY_MAX_ATTEMPTS",
        replayed: true,
        replaySource: "manual-ops",
        replayStatusAfterReplay: "PENDING",
        replayAttemptCountAfterReplay: 0,
        replayLastErrorCodeAfterReplay: null,
        queueSchemaVersion: "archcontext.check-delivery-queue-message/v1",
        queueRetryEnqueueCount: 2,
        queueReplayEnqueued: true,
        queueMessageStatuses: ["RETRYING", "RETRYING", "PENDING"],
        queueSentMessageCount: 3
      },
      incidents: {
        alertKinds: ["check-dlq", "github-api-failure", "verify-failure", "webhook-backlog"],
        failureClasses: ["github-api", "queue", "verify", "webhook"],
        rows: [
          incidentRow("webhook", "webhook-backlog"),
          incidentRow("verify", "verify-failure"),
          incidentRow("queue", "check-dlq"),
          incidentRow("github-api", "github-api-failure")
        ]
      },
      controlPlaneFaultContracts: {
        webhookIdempotency: {
          duplicateDeliveryLeavesOneRow: true,
          durablePrimaryKeyMentioned: true
        },
        databaseTransactionRollback: {
          statementLevelFaultInjection: true,
          checkDeliveryInsertRollback: true,
          challengeUpdateRollback: true,
          challengeLeftLeased: true,
          leasePreserved: true
        },
        queueAfterCommitFailure: {
          doesNotRollbackAcceptedPersistence: true,
          acceptedSubmitCreatesPendingDelivery: true
        },
        clockSkewLimits: {
          testRejectsClockSkew: true,
          gateRejectsClockSkew: true,
          bodyLimitGuard: true,
          rateLimitGuard: true
        },
        currentHeadCheckGuards: {
          supersededHeadDeadLetters: true,
          headShaMismatchDeadLetters: true,
          trustMismatchDeadLetters: true,
          noStaleConclusion: true
        }
      },
      sourceInspections: {
        checkFailure: { ok: true, failures: [] },
        incidentDrill: { ok: true, failures: [] }
      },
      assertions: {
        webhookChaosCovered: true,
        databaseChaosCovered: true,
        queueChaosCovered: true,
        githubApiChaosCovered: true,
        clockSkewChaosCovered: true,
        noDuplicateCheckConclusionGuarded: true,
        replayRestoresPendingWithoutAttempts: true
      }
    },
    failures: []
  };
}

function incidentRow(failureClass: string, alertKind: string) {
  return {
    failureClass,
    alertKind,
    severity: failureClass === "queue" ? "warning" : "critical",
    surface: failureClass,
    status: "firing",
    runbookPath: "docs/runbooks/control-plane-incidents.md",
    runbookSection: alertKind,
    metricKeys: ["thresholdCount"]
  };
}
