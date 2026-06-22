import { describe, expect, test } from "bun:test";
import { inspectFg4SelfHostedRunnerReadback } from "./fg4-self-hosted-runner-readback";

describe("fg4 self-hosted runner readback evidence", () => {
  test("accepts no-secret blocked evidence when repository has no self-hosted runners", () => {
    expect(inspectFg4SelfHostedRunnerReadback(blockedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects registration attempts, false success, and secret markers", () => {
    const recording = blockedRecording();
    recording.ok = true;
    recording.registration.attempted = true;
    recording.secretScan.containsRegistrationToken = true;
    recording.blocker.requiredFollowUp = "registration_token: ghs_example";

    const result = inspectFg4SelfHostedRunnerReadback(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("blocked readback must not claim ok");
    expect(result.failures).toContain("registration must not be attempted in blocked readback");
    expect(result.failures).toContain("secretScan.containsRegistrationToken must be false");
    expect(result.failures.some((failure) => failure.includes("forbidden secret marker"))).toBe(true);
  });
});

function blockedRecording() {
  return {
    schemaVersion: "archcontext.fg4-self-hosted-runner-readback/v1",
    environment: "staging",
    status: "blocked",
    ok: false,
    generatedAt: "2026-06-21T00:00:00.000Z",
    repository: {
      fullName: "Ancienttwo/arch-context",
      visibility: "public",
      private: false,
      viewerPermission: "ADMIN"
    },
    authenticatedUser: {
      login: "Ancienttwo",
      organizations: []
    },
    selfHostedRunners: {
      scope: "repository",
      query: "gh api repos/Ancienttwo/arch-context/actions/runners",
      totalCount: 0,
      runners: []
    },
    registration: {
      attempted: false,
      reasonCode: "USER_AUTHORIZATION_REQUIRED",
      message: "Requires explicit authorization."
    },
    blocker: {
      reasonCode: "SELF_HOSTED_RUNNER_UNAVAILABLE",
      message: "No self-hosted runners.",
      requiredFollowUp: "Authorize ephemeral runner registration, run readback, unregister."
    },
    secretScan: {
      containsToken: false,
      containsRegistrationToken: false,
      containsPrivateKey: false,
      containsWebhookSecret: false
    }
  };
}
