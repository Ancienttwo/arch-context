import { describe, expect, test } from "bun:test";
import { inspectFg3RequiredTrustStagingReadback } from "./fg3-required-trust-staging-readback";

describe("fg3 requiredTrust staging readback", () => {
  test("accepts sanitized verified Organization requiredTrust evidence", () => {
    const result = inspectFg3RequiredTrustStagingReadback(verifiedRecording());

    expect(result).toEqual({ ok: true, failures: [] });
  });

  test("rejects Developer evidence satisfying Organization policy or leaked secrets", () => {
    const recording = verifiedRecording();
    recording.evidence.policy.developerTrustSatisfiesOrganization = true;
    recording.evidence.policy.developerAttestationVerification.accepted = true;
    recording.evidence.policy.developerAttestationVerification.reasonCode = "";
    recording.evidence.organizationRunner.conclusion = "success";
    recording.evidence.organizationRunner.organizationRequiredSummary = false;
    recording.evidence.ruleset.requiredStatusCheck.context = "ArchContext / Developer Review";
    recording.evidence.ruleset.deletedAfterReadback = false;
    (recording.config as Record<string, unknown>).note = "Bearer ghs_private_token";

    const result = inspectFg3RequiredTrustStagingReadback(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("developer trust must not satisfy organization requiredTrust");
    expect(result.failures).toContain("developer attestation verification must be rejected");
    expect(result.failures).toContain("developer attestation rejection must be TRUST_LEVEL_MISMATCH");
    expect(result.failures).toContain("organizationRunner.conclusion must be failure");
    expect(result.failures).toContain("organizationRunner.organizationRequiredSummary must be true");
    expect(result.failures).toContain("ruleset required context must be Organization Runner");
    expect(result.failures).toContain("temporary ruleset must be deleted after readback");
    expect(result.failures.some((failure) => failure.includes("forbidden secret marker"))).toBe(true);
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg3-required-trust-staging-readback/v1",
    environment: "staging",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-20T22:01:00.000Z",
    config: {
      envFile: "_ops/env/fg2-staging.env",
      packet: "docs/verification/fg2-staging-evidence.json",
      repository: "Ancienttwo/arch-context",
      repositoryId: 1274353501,
      pullRequestNumber: 2,
      appSlug: "archcontext-staging",
      appId: "4102781",
      installationId: 141544438
    },
    evidence: {
      pullHead: {
        headSha: "87d036e06c7c0e2b179ed3c3a5169331c0cc4547",
        baseSha: "e273a98ce640b1a8f52ddc0a14cd0140d112ee64"
      },
      policy: {
        requiredTrust: "organization",
        developerTrustSatisfiesOrganization: false,
        developerAttestationVerification: {
          accepted: false,
          reasonCode: "TRUST_LEVEL_MISMATCH"
        }
      },
      developerReview: {
        checkName: "ArchContext / Developer Review",
        checkRunId: "82520000001",
        checkRunUrl: "https://github.com/Ancienttwo/arch-context/runs/82520000001",
        headSha: "87d036e06c7c0e2b179ed3c3a5169331c0cc4547",
        conclusion: "success",
        outputTitle: "Developer-attested",
        developerAttestedSummary: true
      },
      organizationRunner: {
        checkName: "ArchContext / Organization Runner",
        checkRunId: "82520000002",
        checkRunUrl: "https://github.com/Ancienttwo/arch-context/runs/82520000002",
        headSha: "87d036e06c7c0e2b179ed3c3a5169331c0cc4547",
        conclusion: "failure",
        outputTitle: "Attestation required",
        organizationRequiredSummary: true,
        trustMismatchSummary: true,
        forbiddenSourceCodePhraseMatches: 0
      },
      ruleset: {
        id: 17930001,
        name: "archcontext-fg3-required-trust-smoke-test",
        target: "branch",
        enforcement: "active",
        include: [
          "refs/heads/fg3-required-trust-smoke/*"
        ],
        requiredStatusCheck: {
          context: "ArchContext / Organization Runner",
          integrationId: 4102781
        },
        deletedAfterReadback: true,
        absentAfterDelete: true
      },
      egress: [
        {
          category: "github.pull-head",
          method: "GET",
          pathTemplate: "/repositories/{repository_id}/pulls/{pull_number}",
          statusCode: 200,
          requestId: "req_pull_head"
        },
        {
          category: "github.check-create",
          method: "POST",
          pathTemplate: "/repositories/{repository_id}/check-runs",
          statusCode: 201,
          requestId: "req_create_developer"
        },
        {
          category: "github.check-update",
          method: "PATCH",
          pathTemplate: "/repositories/{repository_id}/check-runs/{check_run_id}",
          statusCode: 200,
          requestId: "req_update_developer"
        }
      ],
      readbackRequests: {
        developerCheckStatus: 200,
        organizationCheckStatus: 200
      }
    },
    failures: []
  };
}
