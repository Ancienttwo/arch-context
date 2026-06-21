import { describe, expect, test } from "bun:test";
import { inspectFg3NegativeIdentityMatrix } from "./fg3-negative-identity-matrix";

describe("fg3 negative identity matrix evidence", () => {
  test("accepts sanitized negative identity matrix evidence", () => {
    expect(inspectFg3NegativeIdentityMatrix(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects missing matrix cases, weak cleanup proof, and secret markers", () => {
    const recording = verifiedRecording();
    recording.evidence.cliClaimCases = recording.evidence.cliClaimCases.filter((entry) => entry.name !== "wrong-base");
    recording.evidence.wrongTree.cleanupCleaned = false;
    recording.evidence.dirtyDetachedWorktree.reasonCode = "HEAD_SHA_MISMATCH";
    recording.evidence.outputNonceLeaks = 1;
    (recording.evidence as Record<string, unknown>).note = "nonce_fg3_negative_identity_secret";

    const result = inspectFg3NegativeIdentityMatrix(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("missing claim case: wrong-base");
    expect(result.failures).toContain("wrongTree cleanupCleaned must be true");
    expect(result.failures).toContain("dirtyDetachedWorktree must reject with WORKTREE_NOT_CLEAN");
    expect(result.failures).toContain("outputNonceLeaks must be 0");
    expect(result.failures).toContain("recording contains forbidden nonce marker");
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg3-negative-identity-matrix/v1",
    environment: "process-fixture",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-20T21:00:00.000Z",
    evidence: {
      processLevelFixture: true,
      challengeId: "chal_fg3_negative_identity",
      pullRequestNumber: 42,
      sourceRootDirty: true,
      cliClaimCases: [
        {
          name: "wrong-repository",
          expectedReasonCode: "REPOSITORY_MISMATCH",
          observedReasonCode: "REPOSITORY_MISMATCH",
          rejected: true
        },
        {
          name: "wrong-head",
          expectedReasonCode: "HEAD_SHA_MISMATCH",
          observedReasonCode: "HEAD_SHA_MISMATCH",
          rejected: true
        },
        {
          name: "wrong-base",
          expectedReasonCode: "BASE_SHA_MISMATCH",
          observedReasonCode: "BASE_SHA_MISMATCH",
          rejected: true
        }
      ],
      cliClaimRuntimeNotStarted: true,
      wrongTree: {
        rejected: true,
        reasonCode: "TREE_OID_MISMATCH",
        runStarted: false,
        cleanupCleaned: true
      },
      dirtyDetachedWorktree: {
        rejected: true,
        reasonCode: "WORKTREE_NOT_CLEAN",
        cleanupCleaned: true,
        worktreeRemovedAfterCleanup: true
      },
      allRejected: true,
      outputNonceLeaks: 0,
      outputKeyRefLeaks: 0,
      outputVerifierLeaks: 0
    },
    failures: []
  };
}
