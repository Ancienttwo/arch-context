import { describe, expect, test } from "bun:test";
import { inspectFg6DeveloperReviewProvenance } from "./fg6-developer-review-provenance-readback";

describe("fg6 Developer Review provenance readback evidence", () => {
  test("accepts AC-02 Developer Review provenance evidence", () => {
    expect(inspectFg6DeveloperReviewProvenance(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects missing provenance, weak process evidence, and code-content markers", () => {
    const recording = verifiedRecording();
    recording.evidence.check.outputTitle = "Complete";
    recording.evidence.process.temporaryWorktreeRemovedAfterCleanup = false;
    recording.evidence.check.egress.push({
      category: "github.contents",
      method: "GET",
      pathTemplate: "/repositories/{repository_id}/contents/{path}",
      statusCode: 200,
      requestId: "req_forbidden_contents"
    });

    const result = inspectFg6DeveloperReviewProvenance(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("check output title must be Developer-attested");
    expect(result.failures).toContain("temporary worktree must be cleaned");
    expect(result.failures).toContain("unexpected egress category: github.contents");
    expect(result.failures.some((failure) => failure.includes("forbidden code-content marker"))).toBe(true);
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg6-developer-review-provenance-readback/v1",
    acceptanceId: "AC-02",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T06:00:00.000Z",
    sources: {
      checkSource: "docs/verification/fg3-developer-review-check-readback.json",
      processSource: "docs/verification/fg3-developer-review-process-e2e.json"
    },
    evidence: {
      check: {
        checkName: "ArchContext / Developer Review",
        checkRunId: "82517562192",
        checkRunUrl: "https://github.com/Ancienttwo/arch-context/runs/82517562192",
        headSha: "87d036e06c7c0e2b179ed3c3a5169331c0cc4547",
        baseSha: "e273a98ce640b1a8f52ddc0a14cd0140d112ee64",
        conclusion: "success",
        outputTitle: "Developer-attested",
        attestationV2Verified: true,
        developerAttestedSummary: true,
        executionProvenanceSummary: true,
        attestationDigestSummary: true,
        forbiddenSourceCodePhraseMatches: 0,
        attestationDigestPrefix: "sha256:222a448b99bc",
        egress: [
          egress("github.pull-head", "GET", "/repositories/{repository_id}/pulls/{pull_number}", 200),
          egress("github.check-create", "POST", "/repositories/{repository_id}/check-runs", 201),
          egress("github.check-update", "PATCH", "/repositories/{repository_id}/check-runs/{check_run_id}", 200)
        ]
      },
      process: {
        processLevelFixture: true,
        sourceRootDirty: true,
        attestationHeadMatches: true,
        attestationTreeMatches: true,
        reviewResult: "pass",
        attestationResult: "pass",
        codeGraphIndexedTemporaryWorktree: true,
        temporaryWorktreeRemovedAfterCleanup: true,
        cleanupCleaned: true,
        submissionAccepted: true,
        outputNonceLeaks: 0,
        outputSignatureLeaks: 0,
        outputKeyRefLeaks: 0,
        outputVerifierLeaks: 0
      },
      sourceInspections: {
        check: { ok: true, failures: [] },
        process: { ok: true, failures: [] }
      },
      assertions: {
        realPrDeveloperReviewCheckPublished: true,
        developerAttestedProvenanceVisible: true,
        exactHeadCleanWorktreeReviewProven: true,
        stagingGitHubEgressAllowlisted: true,
        noCodeContentInCheckEvidence: true
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
