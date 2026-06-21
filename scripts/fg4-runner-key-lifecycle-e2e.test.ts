import { describe, expect, test } from "bun:test";
import { inspectFg4RunnerKeyLifecycleE2e } from "./fg4-runner-key-lifecycle-e2e";

describe("fg4 runner key lifecycle e2e evidence", () => {
  test("accepts verified rotate and revoke lifecycle evidence", () => {
    expect(inspectFg4RunnerKeyLifecycleE2e(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects weak overlap, revoked submit, audit, and secret evidence", () => {
    const recording = verifiedRecording();
    recording.evidence.lifecyclePolicy.rotatingPreviousKeySubmitAllowed = true;
    recording.evidence.rotation.previousPreflightAcceptedDuringOverlap = false;
    recording.evidence.rotation.nextSubmit.accepted = false;
    recording.evidence.revoke.postRevokePreflightAccepted = true;
    recording.evidence.revoke.postRevokeSubmit.nonceHashConsumed = true;
    recording.evidence.audit.actions = ["runner_key.register"];
    recording.evidence.audit.metadataOnly = false;
    recording.evidence.leakCounters.tokenLeaks = 1;
    (recording.evidence as Record<string, unknown>).leaked = "Bearer ghs_private_token";

    const result = inspectFg4RunnerKeyLifecycleE2e(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("rotating previous key must not submit required check");
    expect(result.failures).toContain("previous key preflight must pass during overlap");
    expect(result.failures).toContain("rotation next submit must be accepted");
    expect(result.failures).toContain("revoked key preflight must fail immediately");
    expect(result.failures).toContain("revoked submit must not consume nonce");
    expect(result.failures).toContain("audit action missing: runner_key.rotate");
    expect(result.failures).toContain("audit action missing: runner_key.revoke");
    expect(result.failures).toContain("audit must be metadata-only");
    expect(result.failures).toContain("tokenLeaks must be 0");
    expect(result.failures).toContain("recording contains token material");
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg4-runner-key-lifecycle-e2e/v1",
    environment: "process-fixture",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-21T00:00:00.000Z",
    evidence: {
      processLevelFixture: true,
      lifecyclePolicy: {
        requiredCheckSubmitIdentityStatus: "active-only",
        rotatingPreviousKeyPreflightGrace: true,
        rotatingPreviousKeySubmitAllowed: false
      },
      rotation: {
        previousRunnerId: "runner_fg4_lifecycle_old",
        nextRunnerId: "runner_fg4_lifecycle_new",
        previousStatus: "rotating",
        nextStatus: "active",
        rotatedAt: "2026-06-20T10:05:00Z",
        overlapUntil: "2026-06-20T10:20:00Z",
        previousPreflightAcceptedDuringOverlap: true,
        previousPreflightAcceptedAfterOverlap: false,
        previousSubmit: rejectedSubmit("RUNNER_REVOKED"),
        nextPreflightAcceptedDuringOverlap: true,
        nextSubmit: {
          accepted: true,
          nonceHashConsumed: true,
          consumedSetPreserved: true
        }
      },
      revoke: {
        runnerId: "runner_fg4_lifecycle_revoked",
        status: "revoked",
        revokedAt: "2026-06-20T10:08:00Z",
        postRevokePreflightAccepted: false,
        postRevokeSubmit: rejectedSubmit("RUNNER_REVOKED"),
        recoveryAction: "register-replacement-runner-key",
        replacementRequired: true
      },
      audit: {
        actions: [
          "runner_key.register",
          "runner_key.rotate",
          "runner_key.register",
          "runner_key.revoke"
        ],
        metadataOnly: true
      },
      leakCounters: {
        plaintextNonceLeaks: 0,
        privateKeyLeaks: 0,
        tokenLeaks: 0
      }
    },
    failures: []
  };
}

function rejectedSubmit(reasonCode: string) {
  return {
    accepted: false,
    expectedReasonCode: reasonCode,
    observedReasonCode: reasonCode,
    nonceHashConsumed: false,
    consumedSetPreserved: true
  };
}
