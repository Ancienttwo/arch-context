import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl8SchedulerReadback } from "./architecture-ledger-al8-scheduler-readback";

describe("architecture-ledger-al8-scheduler-readback", () => {
  test("accepts verified AL8 scheduler evidence", () => {
    expect(inspectArchitectureLedgerAl8SchedulerReadback(packet())).toMatchObject({
      ok: true,
      failures: []
    });
  });

  test("rejects missing dedupe, persistence, Book readback and privacy gates", () => {
    const result = inspectArchitectureLedgerAl8SchedulerReadback(packet({
      status: "blocked",
      assertions: {
        ...baseAssertions(),
        "AL8-03": false,
        "AL8-EG5": false
      },
      sqlite: {
        recommendationRuns: 2,
        recommendations: 1
      },
      book: {
        recommendationCount: 1
      },
      privacy: {
        noRawSourceBody: false,
        noForbiddenKeys: false
      }
    }));

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("status must be verified");
    expect(result.failures).toContain("AL8-03 assertion must be true");
    expect(result.failures).toContain("AL8-EG5 assertion must be true");
    expect(result.failures).toContain("sqlite must persist three recommendation runs");
    expect(result.failures).toContain("sqlite must persist two open recommendations");
    expect(result.failures).toContain("Book recommendations must expose two open recommendations");
    expect(result.failures).toContain("raw source sentinel leaked");
    expect(result.failures).toContain("forbidden response key present");
  });
});

function packet(overrides: Record<string, any> = {}) {
  return {
    schemaVersion: "archcontext.architecture-ledger-al8-scheduler-readback/v1",
    status: "verified",
    assertions: baseAssertions(),
    sqlite: {
      recommendationRuns: 3,
      recommendations: 2,
      feedback: 0,
      openRecommendations: 2
    },
    book: {
      recommendationCount: 2
    },
    privacy: {
      noRawSourceBody: true,
      noForbiddenKeys: true
    },
    failures: [],
    ...overrides
  };
}

function baseAssertions() {
  return {
    "AL8-01": true,
    "AL8-02": true,
    "AL8-03": true,
    "AL8-04": true,
    "AL8-05": true,
    "AL8-06": true,
    "AL8-07": true,
    "AL8-08": true,
    "AL8-14": true,
    "AL8-EG1": true,
    "AL8-EG2": true,
    "AL8-EG5": true
  };
}
