import { describe, expect, test } from "bun:test";
import { inspectFg3DeveloperReviewCheckReadback } from "./fg3-developer-review-check-readback";

describe("fg3 developer review check readback", () => {
  test("accepts sanitized verified Developer Review Check evidence", () => {
    const result = inspectFg3DeveloperReviewCheckReadback(verifiedRecording());

    expect(result).toEqual({ ok: true, failures: [] });
  });

  test("rejects missing developer-attested provenance and secret markers", () => {
    const recording = verifiedRecording();
    recording.evidence.outputTitle = "Attestation required";
    recording.evidence.developerAttestedSummary = false;
    recording.evidence.executionProvenanceSummary = false;
    recording.evidence.checkRunUrl = "https://example.com/not-github";
    (recording.config as Record<string, unknown>).note = "Bearer ghs_private_token";

    const result = inspectFg3DeveloperReviewCheckReadback(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("evidence.outputTitle must be Developer-attested");
    expect(result.failures).toContain("evidence.developerAttestedSummary must be true");
    expect(result.failures).toContain("evidence.executionProvenanceSummary must be true");
    expect(result.failures).toContain("evidence.checkRunUrl must be a GitHub Check run URL");
    expect(result.failures.some((failure) => failure.includes("forbidden secret marker"))).toBe(true);
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg3-developer-review-check-readback/v1",
    environment: "staging",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-20T20:10:33.460Z",
    config: {
      envFile: "_ops/env/fg2-staging.env",
      packet: "docs/verification/fg2-staging-evidence.json",
      repository: "Ancienttwo/arch-context",
      repositoryId: 1274353501,
      pullRequestNumber: 2,
      appSlug: "archcontext-staging",
      installationId: 141544438
    },
    evidence: {
      checkName: "ArchContext / Developer Review",
      checkRunId: "82512455975",
      checkRunUrl: "https://github.com/Ancienttwo/arch-context/runs/82512455975",
      headSha: "87d036e06c7c0e2b179ed3c3a5169331c0cc4547",
      baseSha: "e273a98ce640b1a8f52ddc0a14cd0140d112ee64",
      conclusion: "success",
      outputTitle: "Developer-attested",
      attestationV2Verified: true,
      developerAttestedSummary: true,
      executionProvenanceSummary: true,
      attestationDigestSummary: true,
      forbiddenSourceCodePhraseMatches: 0,
      attestationDigestPrefix: "sha256:efc5e4c7cbf8",
      egress: [
        {
          category: "github.pull-head",
          method: "GET",
          pathTemplate: "/repositories/{repository_id}/pulls/{pull_number}",
          statusCode: 200,
          requestId: "req_pull_head"
        }
      ],
      readbackRequest: {
        status: 200,
        requestId: "req_readback"
      }
    },
    failures: []
  };
}
