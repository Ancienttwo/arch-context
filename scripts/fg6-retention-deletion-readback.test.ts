import { describe, expect, test } from "bun:test";
import { inspectFg6RetentionDeletion } from "./fg6-retention-deletion-readback";

describe("fg6 retention deletion readback evidence", () => {
  test("accepts retention, install revoke, and account-delete release evidence", () => {
    expect(inspectFg6RetentionDeletion(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects weak retention, install revoke, and account-delete evidence", () => {
    const recording: any = verifiedRecording();
    recording.evidence.sourceInspections.retention.ok = false;
    recording.evidence.sourceInspections.installRevoke.ok = false;
    recording.evidence.retention.expiredRowsRemaining = 1;
    recording.evidence.retention.recentRowsPreserved = 1;
    recording.evidence.retention.retentionPurgeAuthorizations = 1;
    recording.evidence.retention.ordinaryDeleteRejected = false;
    recording.evidence.retention.privacy.secretMarkerHits = 1;
    recording.evidence.installRevoke.tokenRejectedAfterRevoke = false;
    recording.evidence.installRevoke.restoredAfterReadback = false;
    recording.evidence.installRevoke.secretValuesPersisted = true;
    recording.evidence.accountDelete.accountDeleted = false;
    recording.evidence.accountDelete.devicesAfterDelete = 1;
    recording.evidence.accountDelete.revokedDeviceMarkerAfterDelete = true;
    recording.evidence.accountDelete.accountScopedNotificationProviderAfterDelete = true;
    recording.evidence.sourceCoverage.deleteAccountCollectsDeviceIds = false;
    recording.evidence.assertions.retentionSourceInspectionPassed = false;
    recording.evidence.assertions.installRevokeSourceInspectionPassed = false;
    recording.evidence.assertions.retentionDeletesExpiredRows = false;
    recording.evidence.assertions.installRevokeStopsTokenChallengeCheck = false;
    recording.evidence.assertions.accountDeleteClearsScopedState = false;
    recording.evidence.assertions.accountDeleteSourceCovered = false;
    recording.evidence.assertions.noPrivateContent = false;

    const result = inspectFg6RetentionDeletion(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("retention source inspection must pass");
    expect(result.failures).toContain("install revoke source inspection must pass");
    expect(result.failures).toContain("retention expiredRowsRemaining must be 0");
    expect(result.failures).toContain("retention recent rows must be preserved");
    expect(result.failures).toContain("retention authorization table must be empty");
    expect(result.failures).toContain("ordinary Attestation delete must be rejected");
    expect(result.failures).toContain("retention secret hits must be 0");
    expect(result.failures).toContain("install revoke tokenRejectedAfterRevoke must be true");
    expect(result.failures).toContain("install revoke restoredAfterReadback must be true");
    expect(result.failures).toContain("install revoke must not persist secret values");
    expect(result.failures).toContain("account must be deleted");
    expect(result.failures).toContain("account devices must be deleted");
    expect(result.failures).toContain("revoked device marker must be deleted");
    expect(result.failures).toContain("account-scoped notification provider must be deleted");
    expect(result.failures).toContain("source coverage deleteAccountCollectsDeviceIds must be true");
    expect(result.failures).toContain("assertion noPrivateContent must be true");
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg6-retention-deletion-readback/v1",
    taskId: "FG6-15",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T12:00:00.000Z",
    sources: {},
    evidence: {
      sourceInspections: {
        retention: { ok: true, failures: [] },
        installRevoke: { ok: true, failures: [] }
      },
      retention: {
        expiredRowsRemaining: 0,
        recentRowsPreserved: 8,
        retentionPurgeAuthorizations: 0,
        ordinaryDeleteRejected: true,
        privacy: {
          privateContentHits: 0,
          secretMarkerHits: 0,
          codeContentMarkerHits: 0
        }
      },
      installRevoke: {
        installationRevoked: true,
        tokenRejectedAfterRevoke: true,
        challengeCreationStopped: true,
        checkUpdateStopped: true,
        restoredAfterReadback: true,
        secretValuesPersisted: false,
        privateContentPersisted: false
      },
      accountDelete: {
        accountBeforeDelete: true,
        devicesBeforeDelete: 1,
        revokedDeviceMarkerBeforeDelete: true,
        accountScopedNotificationProviderBeforeDelete: true,
        accountDeleted: true,
        devicesAfterDelete: 0,
        revokedDeviceMarkerAfterDelete: false,
        accountScopedNotificationProviderAfterDelete: false
      },
      sourceCoverage: {
        deleteAccountCollectsDeviceIds: true,
        deleteAccountClearsNotificationProviders: true,
        controlPlaneTestCoversAccountDelete: true,
        fg5RetentionGateCovered: true
      },
      assertions: {
        retentionSourceInspectionPassed: true,
        installRevokeSourceInspectionPassed: true,
        retentionDeletesExpiredRows: true,
        installRevokeStopsTokenChallengeCheck: true,
        accountDeleteClearsScopedState: true,
        accountDeleteSourceCovered: true,
        noPrivateContent: true
      }
    },
    failures: []
  };
}
