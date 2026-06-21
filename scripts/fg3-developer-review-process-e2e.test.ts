import { describe, expect, test } from "bun:test";
import { inspectFg3DeveloperReviewProcessE2E } from "./fg3-developer-review-process-e2e";

describe("fg3 developer review process e2e evidence", () => {
  test("accepts sanitized process-level Developer Review evidence", () => {
    expect(inspectFg3DeveloperReviewProcessE2E(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects weak process evidence and secret markers", () => {
    const recording = verifiedRecording();
    recording.evidence.codeGraphIndexedTemporaryWorktree = false;
    recording.evidence.temporaryWorktreeRemovedAfterCleanup = false;
    recording.evidence.outputNonceLeaks = 1;
    recording.evidence.reviewResult = "fail_action_required";
    (recording.evidence as Record<string, unknown>).note = "nonce_fg3_process_e2e_secret";

    const result = inspectFg3DeveloperReviewProcessE2E(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("CodeGraph must index temporary worktree");
    expect(result.failures).toContain("temporary worktree must be removed after cleanup");
    expect(result.failures).toContain("outputNonceLeaks must be 0");
    expect(result.failures).toContain("evidence.reviewResult must be pass");
    expect(result.failures).toContain("recording contains forbidden nonce marker");
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg3-developer-review-process-e2e/v1",
    environment: "process-fixture",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-20T20:55:00.000Z",
    evidence: {
      processLevelFixture: true,
      challengeId: "chal_fg3_process_e2e",
      pullRequestNumber: 42,
      sourceRootDirty: true,
      observedHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      observedHeadTreeOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      attestationHeadMatches: true,
      attestationTreeMatches: true,
      reviewResult: "pass",
      attestationResult: "pass",
      reviewDigestPrefix: "sha256:111111111111",
      worktreeDigestPrefix: "sha256:222222222222",
      attestationDigestPrefix: "sha256:333333333333",
      codeGraphIndexedTemporaryWorktree: true,
      temporaryWorktreeRemovedAfterCleanup: true,
      cleanupCleaned: true,
      submissionAccepted: true,
      outputNonceLeaks: 0,
      outputSignatureLeaks: 0,
      outputKeyRefLeaks: 0,
      outputVerifierLeaks: 0,
      statePrivateMode: process.platform === "win32" ? "platform-default" : "600"
    },
    failures: []
  };
}
