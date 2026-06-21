import { describe, expect, test } from "bun:test";
import { inspectFg5FullPlaneDlp } from "./fg5-full-plane-dlp-readback";

describe("fg5 full-plane DLP readback evidence", () => {
  test("accepts verified database log trace and queue DLP evidence", () => {
    expect(inspectFg5FullPlaneDlp(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects code content bait and secret markers", () => {
    const recording = verifiedRecording();
    recording.evidence.scans.database.codeContentMatches = 1;
    recording.evidence.scans.queue.baitValueMatches = 1;
    recording.evidence.scans.queue.forbiddenKeyMatches = 1;
    (recording.config as Record<string, unknown>).note = "Bearer ghs_private_token";

    const result = inspectFg5FullPlaneDlp(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("database.codeContentMatches must be 0");
    expect(result.failures).toContain("queue.baitValueMatches must be 0");
    expect(result.failures).toContain("queue.forbiddenKeyMatches must be 0");
    expect(result.failures.some((failure) => failure.includes("forbidden secret marker"))).toBe(true);
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg5-full-plane-dlp-readback/v1",
    environment: "local-full-plane",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T03:30:00.000Z",
    config: {
      output: "docs/verification/fg5-full-plane-dlp-readback.json",
      now: "2026-06-21T19:00:00.000Z",
      baitFixture: "docs/security/fixtures/cloud-private-content-bait.json",
      baitNeedleCount: 4
    },
    evidence: {
      database: {
        schemaPrivacyOk: true,
        tableCount: 13,
        rowCount: 10,
        tables: [{ name: "review_challenges", rowCount: 1 }]
      },
      exports: {
        logRecordCount: 1,
        traceRecordCount: 1,
        queueRecordCount: 2,
        errorRecordCount: 1,
        queueHasCheckDeliveryMessage: true
      },
      scans: {
        database: scan("database", 10),
        log: scan("log", 1),
        trace: scan("trace", 1),
        queue: scan("queue", 2),
        error: scan("error", 1)
      }
    },
    failures: []
  };
}

function scan(surface: string, exportedRecordCount: number) {
  return {
    surface,
    exportedRecordCount,
    codeContentMatches: 0,
    baitValueMatches: 0,
    forbiddenKeyMatches: 0,
    forbiddenEndpointOrMediaMatches: 0,
    secretMatches: 0
  };
}
