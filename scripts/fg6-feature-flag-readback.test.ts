import { describe, expect, test } from "bun:test";
import { inspectFg6FeatureFlagReadback } from "./fg6-feature-flag-readback";

describe("fg6 feature flag readback evidence", () => {
  test("accepts Developer Organization and requiredTrust feature flag coverage", () => {
    expect(inspectFg6FeatureFlagReadback(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects weak feature flag coverage", () => {
    const recording: any = verifiedRecording();
    recording.evidence.contractDecisions.developerDisabledReason = "enabled";
    recording.evidence.githubAppProbe.developerCheckDisabled.checkCreated = true;
    recording.evidence.githubAppProbe.organizationCheckDisabled.challengeCreated = true;
    recording.evidence.githubAppProbe.requiredTrustDisabled.checkName = "ArchContext / Organization Runner";
    recording.evidence.controlPlaneProbe.developerCreateError = null;
    recording.evidence.controlPlaneProbe.queueRejectError = null;
    recording.evidence.sourceCoverage.controlPlaneCreateGate = false;
    recording.evidence.assertions.controlPlaneFeatureFlagsRejectNewSideEffects = false;

    const result = inspectFg6FeatureFlagReadback(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("Developer Check disabled reason missing");
    expect(result.failures).toContain("Developer Check flag must block GitHub side effects");
    expect(result.failures).toContain("Organization Check flag must block GitHub side effects");
    expect(result.failures).toContain("requiredTrust disabled must fall back to Developer Check");
    expect(result.failures).toContain("Control Plane must reject disabled Developer Check challenge");
    expect(result.failures).toContain("Control Plane queue must reject disabled Developer Check");
    expect(result.failures).toContain("source coverage missing: controlPlaneCreateGate");
    expect(result.failures).toContain("assertion controlPlaneFeatureFlagsRejectNewSideEffects must be true");
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg6-feature-flag-readback/v1",
    taskId: "FG6-17",
    environment: "local-release-readback",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T12:00:00.000Z",
    sources: {},
    evidence: {
      contractDecisions: {
        defaultDeveloperCheck: true,
        defaultOrganizationCheck: true,
        defaultRequiredTrust: true,
        developerDisabledReason: "developer-check-disabled",
        organizationDisabledReason: "organization-check-disabled",
        requiredTrustDisabledReason: "required-trust-disabled",
        developerCheckName: "ArchContext / Developer Review",
        organizationCheckName: "ArchContext / Organization Runner",
        developerRequiredTrust: "developer",
        organizationRequiredTrust: "organization",
        metadataDigests: [`sha256:${"1".repeat(64)}`]
      },
      githubAppProbe: {
        developerCheckDisabled: {
          checkCreated: false,
          challengeCreated: false,
          checkCount: 0,
          challengeCount: 0
        },
        organizationCheckDisabled: {
          checkCreated: false,
          challengeCreated: false,
          checkCount: 0,
          challengeCount: 0
        },
        requiredTrustDisabled: {
          checkName: "ArchContext / Developer Review",
          challengeCreated: true,
          checkCount: 1,
          challengeCount: 1,
          organizationDecisionAllowed: false,
          organizationDecisionReason: "required-trust-disabled"
        }
      },
      controlPlaneProbe: {
        developerCreateError: "governance-feature-disabled: developer-check-disabled",
        organizationCreateError: "governance-feature-disabled: organization-check-disabled",
        requiredTrustCreateError: "governance-feature-disabled: required-trust-disabled",
        queueAllowedCheckName: "ArchContext / Developer Review",
        queueRejectError: "governance-feature-disabled: developer-check-disabled"
      },
      sourceCoverage: {
        contractsDefaultFlags: true,
        contractsDecisionHelper: true,
        contractsRequiredTrustMapping: true,
        controlPlaneCreateGate: true,
        controlPlaneQueueGate: true,
        controlPlanePublishGate: true,
        githubAppPrDecision: true,
        githubAppPublicationGate: true,
        contractFocusedTest: true,
        controlPlaneFocusedTest: true,
        githubAppFocusedTest: true
      },
      assertions: {
        contractFlagsComplete: true,
        githubAppDeveloperCheckFlagBlocksSideEffects: true,
        githubAppOrganizationCheckFlagBlocksSideEffects: true,
        githubAppRequiredTrustFlagFallsBackToDeveloperCheck: true,
        controlPlaneFeatureFlagsRejectNewSideEffects: true,
        checkNameMappingStable: true,
        sourceCoverageComplete: true,
        noPrivateContent: true
      }
    },
    failures: []
  };
}
