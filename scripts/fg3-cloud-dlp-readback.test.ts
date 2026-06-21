import { describe, expect, test } from "bun:test";
import { inspectFg3CloudDlpReadback } from "./fg3-cloud-dlp-readback";

describe("fg3 cloud DLP readback", () => {
  test("accepts verified FG3 Cloud DTO and tail DLP evidence", () => {
    const result = inspectFg3CloudDlpReadback(verifiedRecording());

    expect(result).toEqual({ ok: true, failures: [] });
  });

  test("rejects bait, unexpected egress, missing tail, and secret markers", () => {
    const recording: any = verifiedRecording();
    recording.evidence.dtoScan.baitValueMatches = 1;
    recording.evidence.egressScan.unexpectedCategories = ["github.contents"];
    recording.evidence.egressScan.forbiddenEndpointOrMediaMatches = 1;
    recording.evidence.tailScan.egressEnvelopeMatches = 0;
    recording.evidence.tailScan.baitMarkerMatches = 1;
    (recording as any).note = "x-hub-signature-256 should not be persisted";

    const result = inspectFg3CloudDlpReadback(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("dtoScan.baitValueMatches must be 0");
    expect(result.failures).toContain("egressScan.unexpectedCategories must be empty");
    expect(result.failures).toContain("egressScan.forbiddenEndpointOrMediaMatches must be 0");
    expect(result.failures).toContain("tailScan.egressEnvelopeMatches must be positive");
    expect(result.failures).toContain("tailScan.baitMarkerMatches must be 0");
    expect(result.failures.some((failure) => failure.includes("forbidden secret marker"))).toBe(true);
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg3-cloud-dlp-readback/v1",
    environment: "staging",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-20T22:10:00.000Z",
    evidence: {
      baitFixture: "docs/security/fixtures/cloud-private-content-bait.json",
      evidenceFiles: [
        { path: "docs/verification/fg3-developer-review-process-e2e.json", status: "verified", ok: true },
        { path: "docs/verification/fg3-negative-identity-matrix.json", status: "verified", ok: true },
        { path: "docs/verification/fg3-adversarial-review-conclusion.json", status: "verified", ok: true },
        { path: "docs/verification/fg3-attestation-security-suite.json", status: "verified", ok: true },
        { path: "docs/verification/fg3-check-supersede-readback.json", status: "verified", ok: true },
        { path: "docs/verification/fg3-developer-review-check-readback.json", status: "verified", ok: true },
        { path: "docs/verification/fg3-real-pr-synchronize-e2e.json", status: "verified", ok: true },
        { path: "docs/verification/fg3-required-trust-staging-readback.json", status: "verified", ok: true }
      ],
      dtoScan: {
        surfaces: ["log", "trace", "queue", "error", "notification", "egress"],
        baitValueMatches: 0,
        forbiddenKeyRetained: 0,
        notificationMinimalRejectedBait: true,
        egressSchemaRejectedBait: true
      },
      egressScan: {
        totalRecordedRequests: 13,
        categories: {
          "github.pull-head": 3,
          "github.check-create": 5,
          "github.check-update": 5
        },
        unexpectedCategories: [],
        forbiddenEndpointOrMediaMatches: 0
      },
      tailScan: {
        tailCaptureLocal: "_ops/env/fg3-eg8-tail-20260620T221000Z.jsonl",
        egressEnvelopeMatches: 5,
        acceptedWebhookLogMatches: 1,
        baitValueMatches: 0,
        baitMarkerMatches: 0,
        forbiddenEndpointOrMediaMatches: 0
      }
    },
    failures: []
  };
}
