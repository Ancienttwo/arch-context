import { describe, expect, test } from "bun:test";
import { inspectFg4RunnerDlpReadback } from "./fg4-runner-dlp-readback";

describe("fg4 runner DLP readback evidence", () => {
  test("accepts verified artifact log cache and Cloud DTO scan evidence", () => {
    expect(inspectFg4RunnerDlpReadback(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects code content, bait, endpoint, and secret matches", () => {
    const recording = verifiedRecording();
    recording.evidence.artifactScan.codeContentMatches = 1;
    recording.evidence.logScan.baitValueMatches = 1;
    recording.evidence.cacheScan.forbiddenEndpointOrMediaMatches = 1;
    recording.evidence.cloudDtoScan.secretMatches = 1;
    (recording.evidence as Record<string, unknown>).leaked = "Bearer ghs_private_token";

    const result = inspectFg4RunnerDlpReadback(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("artifact.codeContentMatches must be 0");
    expect(result.failures).toContain("log.baitValueMatches must be 0");
    expect(result.failures).toContain("cache.forbiddenEndpointOrMediaMatches must be 0");
    expect(result.failures).toContain("cloudDto.secretMatches must be 0");
    expect(result.failures.some((failure) => failure.includes("forbidden secret marker"))).toBe(true);
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg4-runner-dlp-readback/v1",
    environment: "staging",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-21T00:00:00.000Z",
    evidence: {
      sourceEvidence: "docs/verification/fg4-github-hosted-runner-readback.json",
      repository: "Ancienttwo/arch-context",
      runId: 27894392126,
      run: {
        databaseId: 27894392126,
        status: "completed",
        conclusion: "success",
        event: "pull_request",
        headBranch: "codex/fg4-eg1-github-hosted-readback-mqnbyfl1",
        headSha: "690811ee827ce4ee2a8d96d0d981c3da0bc62f30",
        workflowName: "FG4 EG1 GitHub-hosted Organization Runner",
        jobCount: 1
      },
      artifactScan: scan({ fileCount: 1, totalBytes: 2016, fileNames: ["archcontext-fg4-eg1-attestation/fg4-eg1-organization-attestation.json"] }),
      logScan: scan({ lineCount: 300, maskedTokenMentions: 2 }),
      cacheScan: scan({ cacheLineCount: 5 }),
      cloudDtoScan: {
        ...scan({}),
        egressCategories: ["github.pull-head", "github.check-create", "github.check-update"]
      }
    },
    failures: []
  };
}

function scan(extra: Record<string, unknown>) {
  return {
    codeContentMatches: 0,
    baitValueMatches: 0,
    forbiddenEndpointOrMediaMatches: 0,
    secretMatches: 0,
    ...extra
  };
}
