import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl4CloseoutReadback } from "./architecture-ledger-al4-closeout-readback";

describe("architecture-ledger-al4-closeout-readback", () => {
  test("accepts verified AL4 exit gate evidence", () => {
    expect(inspectArchitectureLedgerAl4CloseoutReadback(packet())).toMatchObject({
      ok: true,
      failures: []
    });
  });

  test("rejects slow hook p95, missing stale rejection, and broken chaining", () => {
    const base = packet();
    const result = inspectArchitectureLedgerAl4CloseoutReadback(packet({
      gates: {
        ...base.gates,
        "AL4-EG1": { ...base.gates["AL4-EG1"], status: "blocked", p95Ms: 151 },
        "AL4-EG4": { ...base.gates["AL4-EG4"], rejected: false },
        "AL4-EG5": { ...base.gates["AL4-EG5"], markerWritten: false }
      }
    }));
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("AL4-EG1 status must be verified");
    expect(result.failures).toContain("AL4-EG1 p95 must be <= 150 ms");
    expect(result.failures).toContain("AL4-EG4 stale completion must be rejected");
    expect(result.failures).toContain("AL4-EG5 user hook marker must be written");
  });
});

function packet(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "archcontext.architecture-ledger-al4-closeout-readback/v1",
    status: "verified",
    gates: {
      "AL4-EG1": {
        status: "verified",
        thresholdMs: 150,
        p95Ms: 42,
        sampleCount: 8
      },
      "AL4-EG2": {
        status: "verified",
        generatedProjectionSkip: envelope({
          schemaVersion: "archcontext.hook-enqueue-skipped/v1",
          egress: "none",
          network: "forbidden",
          hookLog: { egress: "none", network: "forbidden" }
        }),
        doctor: envelope({
          entrypoint: { args: ["hook", "enqueue"] },
          checks: [{ id: "egress", status: "pass", egress: "none", network: "forbidden" }]
        })
      },
      "AL4-EG4": {
        status: "verified",
        rejected: true,
        expired: true,
        errorCode: "AC_CONTEXT_STALE"
      },
      "AL4-EG5": {
        status: "verified",
        markerWritten: true,
        exitCode: 0
      }
    },
    ...overrides
  };
}

function envelope(data: Record<string, unknown>) {
  return {
    schemaVersion: "archcontext.envelope/v1",
    ok: true,
    requestId: "fixture",
    data
  };
}
