import { describe, expect, test } from "bun:test";
import { inspectFg3RealPrSynchronizeE2E } from "./fg3-real-pr-synchronize-e2e";

describe("fg3 real PR synchronize E2E evidence", () => {
  test("accepts sanitized verified live synchronize evidence", () => {
    const result = inspectFg3RealPrSynchronizeE2E(verifiedRecording());

    expect(result).toEqual({ ok: true, failures: [] });
  });

  test("rejects incomplete or secret-bearing live synchronize evidence", () => {
    const recording = verifiedRecording() as ReturnType<typeof verifiedRecording> & { notes?: string };
    recording.evidence.pullRequest.headsDiffer = false;
    recording.evidence.checks.oldHead.outputTitle = "ArchContext staging webhook verified";
    recording.evidence.checks.oldHead.summarySuperseded = false;
    recording.evidence.checks.newHead.headSha = recording.evidence.pullRequest.openedHeadSha;
    recording.evidence.cleanup.branchDeleted = false;
    recording.evidence.controlPlane.staleSubmitCannotUpdateCurrentHead = false;
    recording.notes = "Bearer ghs_private_token";

    const result = inspectFg3RealPrSynchronizeE2E(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("pullRequest.headsDiffer must be true");
    expect(result.failures).toContain("old check title must be Superseded");
    expect(result.failures).toContain("old check summary must be superseded");
    expect(result.failures).toContain("new check head must match synchronize head");
    expect(result.failures).toContain("temporary branch must be deleted");
    expect(result.failures).toContain("controlPlane.staleSubmitCannotUpdateCurrentHead must be true");
    expect(result.failures.some((failure) => failure.includes("forbidden secret marker"))).toBe(true);
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg3-real-pr-synchronize-e2e/v1",
    environment: "staging",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-20T21:27:00.000Z",
    evidence: {
      workerUrl: "https://archcontext.repoharness.com",
      pullRequest: {
        number: 4,
        url: "https://github.com/Ancienttwo/arch-context/pull/4",
        state: "closed",
        branch: "codex/fg3-sync-e2e-20260620212554",
        eventSequence: "opened->synchronize",
        openedHeadSha: "964f268d774b3b1df95dc5fd3b82e69af0d68ec9",
        synchronizeHeadSha: "71125da8a97299b7f1e352ee56efbbe0af7a7035",
        headsDiffer: true
      },
      checks: {
        oldHead: {
          checkRunId: "82517155939",
          checkName: "ArchContext / Developer Review",
          headSha: "964f268d774b3b1df95dc5fd3b82e69af0d68ec9",
          status: "completed",
          conclusion: "neutral",
          outputTitle: "Superseded",
          summarySuperseded: true,
          summaryPreview: "Superseded by a newer PR head",
          detailsUrl: "https://archcontext.repoharness.com"
        },
        newHead: {
          checkRunId: "82517171581",
          checkName: "ArchContext / Developer Review",
          headSha: "71125da8a97299b7f1e352ee56efbbe0af7a7035",
          status: "completed",
          conclusion: "neutral",
          outputTitle: "ArchContext staging webhook verified",
          detailsUrl: "https://archcontext.repoharness.com"
        }
      },
      cleanup: {
        pullRequestClosed: true,
        branchDeleted: true
      },
      controlPlane: {
        oldActiveChallengesSuperseded: true,
        staleSubmitCannotUpdateCurrentHead: true,
        staleSubmitNonceConsumed: false,
        focusedTests: [
          "packages/cloud/control-plane/test/control-plane.test.ts: supersedes old active Challenge v2 values when a new PR head arrives",
          "packages/cloud/control-plane/test/control-plane.test.ts: rechecks current PR head at submit and rejects raced old-head results before consuming nonce"
        ]
      }
    }
  };
}
