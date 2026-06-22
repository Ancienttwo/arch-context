import { describe, expect, test } from "bun:test";
import { inspectFg6NewCommitInvalidation } from "./fg6-new-commit-invalidation-readback";

describe("fg6 new commit invalidation readback evidence", () => {
  test("accepts AC-03 new commit invalidation evidence", () => {
    expect(inspectFg6NewCommitInvalidation(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects missing supersede, stale nonce consumption, and forbidden egress", () => {
    const recording = verifiedRecording();
    recording.evidence.synchronize.oldCheck.outputTitle = "Developer-attested";
    recording.evidence.synchronize.controlPlane.staleSubmitNonceConsumed = true;
    recording.evidence.supersede.egress.push({
      category: "github.contents",
      method: "GET",
      pathTemplate: "/repositories/{repository_id}/contents/{path}",
      statusCode: 200,
      requestId: "req_forbidden_contents"
    });

    const result = inspectFg6NewCommitInvalidation(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("old Check title must be Superseded");
    expect(result.failures).toContain("stale submit must not consume nonce");
    expect(result.failures).toContain("unexpected supersede egress category: github.contents");
    expect(result.failures.some((failure) => failure.includes("forbidden code-content marker"))).toBe(true);
  });
});

function verifiedRecording() {
  const oldHead = "9".repeat(40);
  const newHead = "8".repeat(40);
  return {
    schemaVersion: "archcontext.fg6-new-commit-invalidation-readback/v1",
    acceptanceId: "AC-03",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T06:30:00.000Z",
    sources: {
      supersedeSource: "docs/verification/fg3-check-supersede-readback.json",
      synchronizeSource: "docs/verification/fg3-real-pr-synchronize-e2e.json"
    },
    evidence: {
      synchronize: {
        workerUrl: "https://archcontext.repoharness.com",
        repository: "Ancienttwo/arch-context",
        pullRequest: {
          number: 4,
          url: "https://github.com/Ancienttwo/arch-context/pull/4",
          eventSequence: "opened->synchronize",
          openedHeadSha: oldHead,
          synchronizeHeadSha: newHead,
          headsDiffer: true,
          state: "closed",
          branch: "codex/fg3-sync-e2e"
        },
        oldCheck: {
          checkRunId: "82517155939",
          checkRunUrl: "https://github.com/Ancienttwo/arch-context/runs/82517155939",
          checkName: "ArchContext / Developer Review",
          headSha: oldHead,
          status: "completed",
          conclusion: "neutral",
          outputTitle: "Superseded",
          summarySuperseded: true,
          detailsUrl: "https://archcontext.repoharness.com"
        },
        newCheck: {
          checkRunId: "82517171581",
          checkRunUrl: "https://github.com/Ancienttwo/arch-context/runs/82517171581",
          checkName: "ArchContext / Developer Review",
          headSha: newHead,
          status: "completed",
          conclusion: "neutral",
          outputTitle: "ArchContext staging webhook verified",
          detailsUrl: "https://archcontext.repoharness.com"
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
        },
        egressContract: {
          allowedCategories: ["github.pull-head", "github.check-list-for-ref", "github.check-create", "github.check-update"],
          forbiddenCodeContentEndpointsStillDenied: true,
          noContentsPermission: true
        }
      },
      supersede: {
        checkName: "ArchContext / Developer Review",
        oldHeadSha: oldHead,
        newHeadSha: newHead,
        headsDiffer: true,
        oldCheckRunId: "82513246713",
        oldCheckRunUrl: "https://github.com/Ancienttwo/arch-context/runs/82513246713",
        oldConclusion: "neutral",
        oldOutputTitle: "Superseded",
        oldSummarySuperseded: true,
        staleConclusionAttempted: false,
        newCheckRunId: "82513247938",
        newCheckRunUrl: "https://github.com/Ancienttwo/arch-context/runs/82513247938",
        newCheckStatus: "queued",
        newCheckHeadSha: newHead,
        egress: [
          egress("github.pull-head", "GET", "/repositories/{repository_id}/pulls/{pull_number}", 200),
          egress("github.check-create", "POST", "/repositories/{repository_id}/check-runs", 201),
          egress("github.check-update", "PATCH", "/repositories/{repository_id}/check-runs/{check_run_id}", 200)
        ]
      },
      sourceInspections: {
        supersede: { ok: true, failures: [] },
        synchronize: { ok: true, failures: [] }
      },
      assertions: {
        pushNewCommitCreatesNewCheck: true,
        oldHeadCheckSuperseded: true,
        oldChallengeOrResultInvalidated: true,
        staleSubmitRejectedBeforeNonceConsumption: true,
        unsupportedStaleConclusionNotUsed: true,
        stagingGitHubEgressAllowlisted: true
      }
    },
    failures: []
  };
}

function egress(category: string, method: string, pathTemplate: string, statusCode: number) {
  return {
    category,
    method,
    pathTemplate,
    statusCode,
    requestId: `req_${category.replace(/[^a-z]+/g, "_")}`
  };
}
