import { describe, expect, test } from "bun:test";
import { inspectFg4PublicForkAdversarialReadback } from "./fg4-public-fork-adversarial-readback";

describe("fg4 public fork adversarial readback evidence", () => {
  test("accepts no-secret blocked evidence when no alternate fork namespace is available", () => {
    expect(inspectFg4PublicForkAdversarialReadback(blockedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects fork mutation, false success, and secret markers", () => {
    const recording = blockedRecording();
    recording.ok = true;
    recording.forkAttempt.attempted = true;
    recording.secretScan.containsToken = true;
    recording.blocker.requiredFollowUp = "Bearer ghp_example";

    const result = inspectFg4PublicForkAdversarialReadback(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("blocked readback must not claim ok");
    expect(result.failures).toContain("default readback must not create a fork");
    expect(result.failures).toContain("secretScan.containsToken must be false");
    expect(result.failures.some((failure) => failure.includes("forbidden secret marker"))).toBe(true);
  });

  test("accepts verified public fork adversarial evidence", () => {
    expect(inspectFg4PublicForkAdversarialReadback(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });
});

function blockedRecording() {
  return {
    schemaVersion: "archcontext.fg4-public-fork-adversarial-readback/v1",
    environment: "staging",
    status: "blocked",
    ok: false,
    generatedAt: "2026-06-21T00:00:00.000Z",
    repository: {
      fullName: "Ancienttwo/arch-context",
      visibility: "public",
      private: false,
      allowForking: true
    },
    githubActions: {
      enabled: true,
      forkPullRequestContributorApproval: "unknown-readonly"
    },
    authenticatedUser: {
      login: "Ancienttwo",
      id: 215803476,
      organizations: []
    },
    forkAttempt: {
      attempted: false,
      reasonCode: "EXPLICIT_FORK_NAMESPACE_REQUIRED",
      message: "No fork was created."
    },
    blocker: {
      reasonCode: "FORK_NAMESPACE_UNAVAILABLE",
      message: "No alternate namespace.",
      requiredFollowUp: "Provide a second GitHub user or organization namespace."
    },
    secretScan: {
      containsToken: false,
      containsPrivateKey: false,
      containsWebhookSecret: false
    }
  };
}

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg4-public-fork-adversarial-readback/v1",
    environment: "staging",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-21T00:00:00.000Z",
    repository: {
      fullName: "Ancienttwo/arch-context",
      visibility: "public",
      private: false,
      allowForking: true
    },
    githubActions: {
      enabled: true,
      dangerousPullRequestTargetWorkflowName: "FG4 EG5 Dangerous pull_request_target Canary"
    },
    authenticatedUser: {
      login: "Ancienttwo",
      id: 215803476,
      organizations: ["example-org"]
    },
    forkAttempt: {
      attempted: true,
      requestedForkOwner: "example-org",
      selectedForkOwner: "example-org",
      forkRepository: "example-org/arch-context",
      forkCreatedByReadback: false
    },
    pullRequest: {
      number: 11,
      url: "https://github.com/Ancienttwo/arch-context/pull/11",
      isCrossRepository: true,
      headRepository: "example-org/arch-context",
      headSha: "a".repeat(40),
      closedAfterReadback: true
    },
    adversarialBranch: {
      name: "codex/fg4-eg5-public-fork-readback-test",
      commit: "a".repeat(40),
      deletedAfterReadback: true,
      pullRequestTargetWorkflowPresentInForkCommit: true
    },
    dangerousWorkflow: {
      workflowName: "FG4 EG5 Dangerous pull_request_target Canary",
      marker: "FG4_EG5_DANGEROUS_PULL_REQUEST_TARGET_SHOULD_NOT_RUN",
      runCount: 0,
      runs: [],
      markerLogMatches: 0
    },
    localPolicy: {
      defaultPolicy: {
        run: false,
        schemaVersion: "archcontext.review-action-fork-policy/v1",
        mode: "unsupported",
        fork: true,
        outputConclusion: "neutral",
        reasonCode: "FORK_PR_UNSUPPORTED"
      },
      signingSecretPolicy: {
        run: false,
        schemaVersion: "archcontext.review-action-fork-policy/v1",
        mode: "unsupported",
        fork: true,
        outputConclusion: "neutral",
        reasonCode: "FORK_PR_SECRET_EXPOSURE_FORBIDDEN"
      },
      githubAppProjection: {
        challengeIssued: false,
        challengeCount: 0,
        checkName: "ArchContext / Organization Runner",
        status: "completed",
        conclusion: "neutral",
        outputTitle: "Unsupported",
        unsupportedSummary: true
      },
      privacyAudit: {
        ok: true,
        forbiddenKeys: []
      }
    },
    organizationRunner: {
      checkName: "ArchContext / Organization Runner",
      checkRunId: "82599900001",
      checkRunUrl: "https://github.com/Ancienttwo/arch-context/runs/82599900001",
      conclusion: "neutral",
      outputTitle: "Unsupported"
    },
    egress: [
      {
        category: "github.check-create",
        method: "POST",
        pathTemplate: "/repositories/{repository_id}/check-runs",
        statusCode: 201,
        requestId: "request-id"
      }
    ],
    secretScan: {
      containsToken: false,
      containsPrivateKey: false,
      containsWebhookSecret: false
    },
    failures: []
  };
}
