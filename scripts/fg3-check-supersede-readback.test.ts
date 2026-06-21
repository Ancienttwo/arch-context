import { describe, expect, test } from "bun:test";
import { inspectFg3CheckSupersedeReadback } from "./fg3-check-supersede-readback";

describe("fg3 check supersede readback", () => {
  test("accepts sanitized verified superseded Check evidence", () => {
    const result = inspectFg3CheckSupersedeReadback(verifiedRecording());

    expect(result).toEqual({ ok: true, failures: [] });
  });

  test("rejects stale-style or incomplete supersede evidence", () => {
    const recording = verifiedRecording();
    recording.evidence.headsDiffer = false;
    recording.evidence.oldConclusion = "stale";
    recording.evidence.oldOutputTitle = "Developer-attested";
    recording.evidence.oldSummarySuperseded = false;
    recording.evidence.staleConclusionAttempted = true;
    recording.evidence.newCheckHeadSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    recording.config.note = "Bearer ghs_private_token";

    const result = inspectFg3CheckSupersedeReadback(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("evidence.headsDiffer must be true");
    expect(result.failures).toContain("evidence.oldConclusion must be neutral or cancelled");
    expect(result.failures).toContain("evidence.oldOutputTitle must be Superseded");
    expect(result.failures).toContain("evidence.oldSummarySuperseded must be true");
    expect(result.failures).toContain("evidence.staleConclusionAttempted must be false");
    expect(result.failures).toContain("evidence.newCheckHeadSha must match newHeadSha");
    expect(result.failures.some((failure) => failure.includes("forbidden secret marker"))).toBe(true);
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg3-check-supersede-readback/v1",
    environment: "staging",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-20T20:30:00.000Z",
    config: {
      envFile: "_ops/env/fg2-staging.env",
      packet: "docs/verification/fg2-staging-evidence.json",
      repository: "Ancienttwo/arch-context",
      repositoryId: 1274353501,
      pullRequestNumber: 2,
      appSlug: "archcontext-staging",
      installationId: 141544438
    } as Record<string, unknown>,
    evidence: {
      checkName: "ArchContext / Developer Review",
      oldHeadSha: "6191f583737eed5c4f9acc5e1302ef6b7a220f7f",
      newHeadSha: "87d036e06c7c0e2b179ed3c3a5169331c0cc4547",
      headsDiffer: true,
      oldCheckRunId: "82520000001",
      oldCheckRunUrl: "https://github.com/Ancienttwo/arch-context/runs/82520000001",
      oldConclusion: "neutral",
      oldOutputTitle: "Superseded",
      oldSummarySuperseded: true,
      oldSummaryPrivatePhraseMatches: 0,
      staleConclusionAttempted: false,
      newCheckRunId: "82520000002",
      newCheckRunUrl: "https://github.com/Ancienttwo/arch-context/runs/82520000002",
      newCheckStatus: "queued",
      newCheckHeadSha: "87d036e06c7c0e2b179ed3c3a5169331c0cc4547",
      egress: [
        {
          category: "github.pull-head",
          method: "GET",
          pathTemplate: "/repositories/{repository_id}/pulls/{pull_number}",
          statusCode: 200,
          requestId: "req_pull_head"
        }
      ],
      readbackRequests: {
        oldStatus: 200,
        oldRequestId: "req_old",
        newStatus: 200,
        newRequestId: "req_new"
      }
    },
    failures: []
  };
}
