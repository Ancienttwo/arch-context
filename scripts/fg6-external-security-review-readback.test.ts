import { describe, expect, test } from "bun:test";
import { inspectFg6ExternalSecurityReview } from "./fg6-external-security-review-readback";

describe("fg6 external security review readback evidence", () => {
  test("accepts API allowlist, key, replay, fork, logs, and release scan review evidence", () => {
    expect(inspectFg6ExternalSecurityReview(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects weak external security review coverage", () => {
    const recording: any = verifiedRecording();
    recording.evidence.sourceInspections.privacyDlp.ok = false;
    recording.evidence.apiAllowlist.noContentsPermission = false;
    recording.evidence.apiAllowlist.unexpectedCategories = ["github.contents"];
    recording.evidence.keyLifecycle.runnerPostRevokeRejectedWithoutNonce = false;
    recording.evidence.keyLifecycle.deviceRevokedRejectedWithoutNonce = false;
    recording.evidence.replay.replayRejected = false;
    recording.evidence.replay.replayReasonCode = "ACCEPTED";
    recording.evidence.fork.challengeIssued = true;
    recording.evidence.fork.dangerousWorkflowRunCount = 1;
    recording.evidence.logs.runnerSurfacesClean = false;
    recording.evidence.logs.storageSurfacesClean = false;
    recording.evidence.releaseScan.dependencyCriticalHighZero = false;
    recording.evidence.releaseScan.securityManifestVerified = false;
    recording.evidence.reviewDecision.high = 1;
    recording.evidence.reviewDecision.disposition = "fail";
    recording.evidence.assertions.apiAllowlistReviewed = false;
    recording.evidence.assertions.keyLifecycleReviewed = false;
    recording.evidence.assertions.replayReviewed = false;
    recording.evidence.assertions.forkSafetyReviewed = false;
    recording.evidence.assertions.logsReviewed = false;
    recording.evidence.assertions.releaseScanReviewed = false;
    recording.evidence.assertions.noCriticalHighOpen = false;
    recording.evidence.assertions.allSourceInspectionsPassed = false;

    const result = inspectFg6ExternalSecurityReview(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("privacyDlp source inspection must pass");
    expect(result.failures).toContain("apiAllowlist must prove Contents permission absent");
    expect(result.failures).toContain("apiAllowlist unexpectedCategories must be empty");
    expect(result.failures).toContain("keyLifecycle runner revoke must reject without nonce consumption");
    expect(result.failures).toContain("keyLifecycle device revoke must reject without nonce consumption");
    expect(result.failures).toContain("replay attack must be rejected");
    expect(result.failures).toContain("replay reason must be CHALLENGE_ALREADY_CONSUMED");
    expect(result.failures).toContain("fork must not issue Challenge");
    expect(result.failures).toContain("fork dangerous workflow run count must be 0");
    expect(result.failures).toContain("logs runner surfaces must be clean");
    expect(result.failures).toContain("logs storage surfaces must be clean");
    expect(result.failures).toContain("releaseScan dependency Critical/High must be zero");
    expect(result.failures).toContain("releaseScan security manifest must be verified");
    expect(result.failures).toContain("reviewDecision high must be 0");
    expect(result.failures).toContain("reviewDecision disposition must be pass");
    expect(result.failures).toContain("assertion apiAllowlistReviewed must be true");
    expect(result.failures).toContain("assertion keyLifecycleReviewed must be true");
    expect(result.failures).toContain("assertion replayReviewed must be true");
    expect(result.failures).toContain("assertion forkSafetyReviewed must be true");
    expect(result.failures).toContain("assertion logsReviewed must be true");
    expect(result.failures).toContain("assertion releaseScanReviewed must be true");
    expect(result.failures).toContain("assertion noCriticalHighOpen must be true");
    expect(result.failures).toContain("assertion allSourceInspectionsPassed must be true");
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg6-external-security-review-readback/v1",
    taskId: "FG6-12",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T10:00:00.000Z",
    sources: {
      privacySource: "docs/verification/fg6-privacy-dlp-readback.json",
      adversarialSource: "docs/verification/fg6-adversarial-governance-matrix-readback.json",
      securitySource: "docs/verification/fg6-security-release-readback.json",
      replaySource: "docs/verification/fg3-attestation-security-suite.json",
      reportPath: "docs/security/reviews/fg6-external-security-review.md"
    },
    evidence: {
      sourceInspections: {
        privacyDlp: { ok: true, failures: [] },
        adversarialGovernance: { ok: true, failures: [] },
        securityRelease: { ok: true, failures: [] },
        attestationReplay: { ok: true, failures: [] }
      },
      apiAllowlist: {
        staticPassed: true,
        scannedFiles: 18,
        scanRoots: ["packages/cloud", "packages/contracts/src"],
        allowedCategories: ["github.check-create", "github.check-update", "github.pull-head"],
        unexpectedCategories: [],
        forbiddenEndpointOrMediaMatches: 0,
        noContentsPermission: true,
        appPermissionKeys: ["checks", "metadata", "pull_requests", "statuses"]
      },
      keyLifecycle: {
        installationRevokeStopsTokenChallengeAndCheck: true,
        runnerPostRevokeRejectedWithoutNonce: true,
        deviceRevokedRejectedWithoutNonce: true,
        auditMetadataOnly: true,
        leakCountersAllZero: true
      },
      replay: {
        baselineAccepted: true,
        replayRejected: true,
        replayReasonCode: "CHALLENGE_ALREADY_CONSUMED",
        replayNonceHashConsumed: true,
        replayConsumedSetPreserved: true,
        noUnexpectedNonceConsumption: true
      },
      fork: {
        crossRepositoryPr: true,
        challengeIssued: false,
        dangerousWorkflowRunCount: 0,
        signingSecretRun: false,
        signingSecretReasonCode: "FORK_PR_SECRET_EXPOSURE_FORBIDDEN",
        secretScanClean: true,
        cleanupComplete: true
      },
      logs: {
        dynamicSurfacesCovered: true,
        cloudTailClean: true,
        runnerSurfacesClean: true,
        storageSurfacesClean: true,
        releaseSecretScanClean: true
      },
      releaseScan: {
        dependencyCriticalHighZero: true,
        sbomGenerated: true,
        sastCriticalHighZero: true,
        secretScanClean: true,
        securityManifestVerified: true
      },
      reviewDecision: {
        reviewer: "fg6-independent-release-security-review",
        scope: ["api-allowlist", "key-lifecycle", "attestation-replay", "fork-secret-safety", "logs-and-artifacts", "release-security-scan"],
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        disposition: "pass"
      },
      assertions: {
        apiAllowlistReviewed: true,
        keyLifecycleReviewed: true,
        replayReviewed: true,
        forkSafetyReviewed: true,
        logsReviewed: true,
        releaseScanReviewed: true,
        noCriticalHighOpen: true,
        allSourceInspectionsPassed: true
      }
    },
    failures: []
  };
}
