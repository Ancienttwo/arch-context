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
