import { describe, expect, test } from "bun:test";
import { inspectFg6OpsRunbook } from "./fg6-ops-runbook-readback";

describe("fg6 ops runbook readback evidence", () => {
  test("accepts complete ops/security runbook coverage", () => {
    expect(inspectFg6OpsRunbook(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects missing runbook coverage and weak operational evidence", () => {
    const recording: any = verifiedRecording();
    recording.evidence.sourceInspections.device.ok = false;
    recording.evidence.runbookCoverage.sections["device-key-compromise"].complete = false;
    recording.evidence.operationalEvidence.deviceKeyCompromise.revokedDeviceRejected = false;
    recording.evidence.operationalEvidence.deviceKeyCompromise.nonceConsumed = true;
    recording.evidence.operationalEvidence.runnerKeyCompromise.reasonCode = "OK";
    recording.evidence.operationalEvidence.runnerKeyCompromise.auditMetadataOnly = false;
    recording.evidence.operationalEvidence.githubOutage.injectedGitHubApiFailureCount = 0;
    recording.evidence.operationalEvidence.githubOutage.deadLetterStatus = "PENDING";
    recording.evidence.operationalEvidence.queueBacklog.webhookBacklogAlert = false;
    recording.evidence.operationalEvidence.queueBacklog.queueRetryEnqueueCount = 0;
    recording.evidence.runbookCoverage.secretMarkerHits = 1;
    recording.evidence.assertions.runbookSectionsComplete = false;
    recording.evidence.assertions.deviceCompromiseEvidenceCovered = false;
    recording.evidence.assertions.runnerCompromiseEvidenceCovered = false;
    recording.evidence.assertions.githubOutageEvidenceCovered = false;
    recording.evidence.assertions.queueBacklogEvidenceCovered = false;
    recording.evidence.assertions.allSourceInspectionsPassed = false;
    recording.evidence.assertions.noPrivateContent = false;

    const result = inspectFg6OpsRunbook(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("device source inspection must pass");
    expect(result.failures).toContain("runbook section incomplete: device-key-compromise");
    expect(result.failures).toContain("device compromise evidence must reject revoked Device Key");
    expect(result.failures).toContain("device compromise evidence must preserve nonce");
    expect(result.failures).toContain("runner compromise evidence must reject revoked Runner Key");
    expect(result.failures).toContain("runner compromise audit must be metadata-only");
    expect(result.failures).toContain("github outage evidence must inject GitHub API failures");
    expect(result.failures).toContain("github outage evidence must reach DLQ");
    expect(result.failures).toContain("queue backlog evidence must include webhook-backlog");
    expect(result.failures).toContain("queue backlog evidence must include retry queue messages");
    expect(result.failures).toContain("runbook secret marker hits must be 0");
    expect(result.failures).toContain("assertion noPrivateContent must be true");
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg6-ops-runbook-readback/v1",
    taskId: "FG6-16",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T12:00:00.000Z",
    sources: {},
    evidence: {
      sourceInspections: {
        device: { ok: true, failures: [] },
        runner: { ok: true, failures: [] },
        incident: { ok: true, failures: [] },
        chaos: { ok: true, failures: [] }
      },
      runbookCoverage: {
        sections: {
          "device-key-compromise": section(),
          "runner-key-compromise": section(),
          "github-outage": section(),
          "queue-backlog": section()
        },
        secretMarkerHits: 0,
        codeContentMarkerHits: 0
      },
      operationalEvidence: {
        deviceKeyCompromise: {
          revokedDeviceRejected: true,
          reasonCode: "DEVICE_REVOKED",
          nonceConsumed: false,
          consumedSetPreserved: true
        },
        runnerKeyCompromise: {
          revokedRunnerRejected: true,
          reasonCode: "RUNNER_REVOKED",
          nonceConsumed: false,
          consumedSetPreserved: true,
          auditMetadataOnly: true
        },
        githubOutage: {
          injectedGitHubApiFailureCount: 2,
          deadLetterStatus: "DEAD_LETTER",
          replayStatusAfterReplay: "PENDING"
        },
        queueBacklog: {
          webhookBacklogAlert: true,
          checkDlqAlert: true,
          queueRetryEnqueueCount: 2
        }
      },
      assertions: {
        runbookSectionsComplete: true,
        deviceCompromiseEvidenceCovered: true,
        runnerCompromiseEvidenceCovered: true,
        githubOutageEvidenceCovered: true,
        queueBacklogEvidenceCovered: true,
        allSourceInspectionsPassed: true,
        noPrivateContent: true
      }
    },
    failures: []
  };
}

function section() {
  return {
    present: true,
    hasSignal: true,
    hasTriage: true,
    hasRemediation: true,
    hasVerification: true,
    hasRequiredTerms: true,
    complete: true
  };
}
