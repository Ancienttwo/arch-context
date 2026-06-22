import { describe, expect, test } from "bun:test";
import { inspectFg5RetentionStagingReadback } from "./fg5-retention-staging-readback";

describe("fg5 retention staging readback", () => {
  test("accepts verified staging D1 time-shift retention evidence", () => {
    expect(inspectFg5RetentionStagingReadback(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects retained expired rows and secret markers", () => {
    const recording = verifiedRecording();
    recording.evidence.counts.webhookExpired = 1;
    recording.evidence.ordinaryDeleteRejected = false;
    recording.privacy.privateContentHits = 1;
    (recording.config as Record<string, unknown>).note = "Bearer ghs_private_token";

    const result = inspectFg5RetentionStagingReadback(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("ordinary Attestation DELETE must be rejected");
    expect(result.failures).toContain("webhookExpired must be 0");
    expect(result.failures).toContain("privacy.privateContentHits must be 0");
    expect(result.failures.some((failure) => failure.includes("forbidden secret marker"))).toBe(true);
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg5-retention-staging-readback/v1",
    environment: "staging",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T02:00:00.000Z",
    config: {
      database: "archcontext-control-plane-staging",
      wranglerConfig: "wrangler.jsonc",
      output: "docs/verification/fg5-retention-staging-readback.json",
      now: "2026-06-21T14:00:00.000Z",
      prefix: "fg5eg5_fixture"
    },
    policy: {
      days: {
        webhookDelivery: 30,
        unfinishedChallenge: 7,
        verifiedAttestation: 365,
        rejectedAttestation: 30,
        legacyAttestationAudit: 30,
        checkDelivery: 90,
        revokedRunnerKey: 365,
        rawWebhookBody: 0,
        privateContent: 0
      },
      cutoffs: {
        now: "2026-06-21T14:00:00.000Z",
        webhookDeliveryBefore: "2026-05-22T14:00:00.000Z",
        unfinishedChallengeCreatedBefore: "2026-06-14T14:00:00.000Z",
        verifiedAttestationAcceptedBefore: "2025-06-21T14:00:00.000Z",
        rejectedAttestationAcceptedBefore: "2026-05-22T14:00:00.000Z",
        legacyAttestationAuditBefore: "2026-05-22T14:00:00.000Z",
        checkDeliveryUpdatedBefore: "2026-03-23T14:00:00.000Z",
        revokedRunnerKeyBefore: "2025-06-21T14:00:00.000Z"
      }
    },
    evidence: {
      database: "archcontext-control-plane-staging",
      migration: {
        success: true,
        rowsRead: 65,
        rowsWritten: 71,
        changedDb: true,
        finalBookmark: "00000000-0000000f"
      },
      seed: {
        success: true,
        rowsRead: 0,
        rowsWritten: 18,
        changedDb: true,
        finalBookmark: "00000000-00000010"
      },
      ordinaryDeleteRejected: true,
      purge: {
        success: true,
        rowsRead: 10,
        rowsWritten: 10,
        changedDb: true,
        finalBookmark: "00000000-00000011"
      },
      counts: {
        webhookExpired: 0,
        webhookRecent: 1,
        unfinishedChallengeExpired: 0,
        unfinishedChallengeRecent: 1,
        terminalChallengeOld: 1,
        verifiedAttestationExpired: 0,
        verifiedAttestationRecent: 1,
        rejectedAttestationExpired: 0,
        rejectedAttestationRecent: 1,
        legacyExpired: 0,
        legacyRecent: 1,
        checkExpired: 0,
        checkRecent: 1,
        revokedRunnerExpired: 0,
        revokedRunnerExpiredRepositories: 0,
        revokedRunnerExpiredRotationWindows: 0,
        revokedRunnerRecent: 1,
        retentionPurgeAuthorizations: 0
      }
    },
    privacy: {
      privateContentHits: 0,
      secretMarkerHits: 0,
      codeContentMarkerHits: 0
    },
    failures: []
  };
}
