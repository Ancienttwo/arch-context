import { describe, expect, test } from "bun:test";
import { inspectFg6RollbackCompatReadback } from "./fg6-rollback-compat-readback";

describe("fg6 rollback compatibility readback evidence", () => {
  test("accepts schema Check context Action and rollback compatibility evidence", () => {
    expect(inspectFg6RollbackCompatReadback(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects weak rollback compatibility evidence", () => {
    const recording: any = verifiedRecording();
    recording.evidence.schemaProbe.invalidChallengeSchemaError = null;
    recording.evidence.rollbackProbe.submitAccepted = true;
    recording.evidence.rollbackProbe.nonceConsumed = true;
    recording.evidence.checkContextProbe.organizationRejectsDeveloperEvidence = false;
    recording.evidence.checkContextProbe.controlPlaneRejectsCheckNameMismatch = false;
    recording.evidence.actionProbe.oldRuntimeRejectedReason = null;
    recording.evidence.actionProbe.reusableCallerPinnedBySha = false;
    recording.evidence.sourceCoverage.controlPlaneLegacyV1RejectTested = false;
    recording.evidence.assertions.rollbackKeepsLegacyAttestationAuditOnly = false;

    const result = inspectFg6RollbackCompatReadback(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("Challenge API must reject old schemaVersion");
    expect(result.failures).toContain("Control Plane must reject legacy Attestation for required checks");
    expect(result.failures).toContain("legacy Attestation rejection must not consume nonce");
    expect(result.failures).toContain("Organization Runner must reject developer evidence");
    expect(result.failures).toContain("Control Plane must reject check context mismatch");
    expect(result.failures).toContain("Review Action must reject old runtime version");
    expect(result.failures).toContain("Reusable workflow caller must be pinned by commit SHA");
    expect(result.failures).toContain("source coverage missing: controlPlaneLegacyV1RejectTested");
    expect(result.failures).toContain("assertion rollbackKeepsLegacyAttestationAuditOnly must be true");
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg6-rollback-compat-readback/v1",
    taskId: "FG6-19",
    environment: "local-release-readback",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T12:00:00.000Z",
    sources: {},
    evidence: {
      schemaProbe: {
        currentChallengeSchema: "archcontext.review-challenge/v2",
        currentAttestationSchema: "archcontext.attestation/v2",
        currentCheckDeliverySchema: "archcontext.check-delivery/v1",
        challengeRequestVersions: [
          "archcontext.challenge-create-request/v1",
          "archcontext.challenge-get-request/v1",
          "archcontext.challenge-list-request/v1",
          "archcontext.challenge-lease-request/v1",
          "archcontext.challenge-submit-request/v1",
          "archcontext.challenge-cancel-request/v1"
        ],
        keyRequestVersions: [
          "archcontext.device-key-register-request/v1",
          "archcontext.device-key-revoke-request/v1",
          "archcontext.runner-key-register-request/v1",
          "archcontext.runner-key-rotate-request/v1",
          "archcontext.runner-key-revoke-request/v1"
        ],
        invalidChallengeSchemaError: "challenge-api-schemaVersion-invalid",
        invalidKeySchemaError: "key-api-schemaVersion-invalid",
        openApiCoversAllRequestVersions: true,
        policyCoversAllRequestVersions: true
      },
      rollbackProbe: {
        legacySchemaVersion: "archcontext.attestation/v1",
        targetSchemaVersion: "archcontext.attestation/v2",
        migrationStatus: "legacy-audit-only",
        requiredCheckEligible: false,
        rejectionReasonCode: "ATTESTATION_SCHEMA_UNSUPPORTED",
        submitAccepted: false,
        submitReasonCode: "ATTESTATION_SCHEMA_UNSUPPORTED",
        nonceConsumed: false,
        challengeStatusAfter: "LEASED",
        auditRecordContainsRepositoryName: false
      },
      checkContextProbe: {
        developerCheckName: "ArchContext / Developer Review",
        organizationCheckName: "ArchContext / Organization Runner",
        developerRequiredTrust: "developer",
        organizationRequiredTrust: "organization",
        developerCheckSuccess: true,
        organizationCheckSuccess: true,
        organizationRejectsDeveloperEvidence: true,
        developerRejectsOrganizationEvidence: true,
        controlPlanePublicationReason: "check-delivery-name-mismatch",
        controlPlanePublicationReasonCode: "TRUST_LEVEL_MISMATCH",
        controlPlaneRejectsCheckNameMismatch: true
      },
      actionProbe: {
        currentRuntimeVersion: "0.1.1",
        currentRuntimeAccepted: true,
        oldRuntimeRejectedReason: "runtime-version-mismatch",
        actionPlanSchemaVersion: "archcontext.review-action-plan/v1",
        actionMajorPinned: true,
        workflowRuntimeInputPresent: true,
        reusableCallerPinnedBySha: true
      },
      sourceCoverage: {
        contractCheckNamesFrozen: true,
        contractSchemaVersionsFrozen: true,
        contractTrustMappingTested: true,
        controlPlaneSchemaGuards: true,
        controlPlaneLegacyV1RejectTested: true,
        controlPlaneCheckNameMismatchTested: true,
        githubAppContextSeparationTested: true,
        runnerRuntimeVersionPinned: true,
        openApiSchemaVersionsDocumented: true,
        compatibilityPolicyRollbackDocumented: true,
        actionWorkflowPinned: true
      },
      assertions: {
        schemaVersionsStrictAndDocumented: true,
        rollbackKeepsLegacyAttestationAuditOnly: true,
        checkContextsStaySeparated: true,
        actionVersionPinningBlocksUnsafeRollback: true,
        sourceCoverageComplete: true,
        noPrivateContent: true
      }
    },
    failures: []
  };
}
