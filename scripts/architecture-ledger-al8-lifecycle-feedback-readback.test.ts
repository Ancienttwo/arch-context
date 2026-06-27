import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl8LifecycleFeedbackReadback } from "./architecture-ledger-al8-lifecycle-feedback-readback";

describe("architecture-ledger-al8-lifecycle-feedback-readback", () => {
  test("accepts verified AL8 lifecycle feedback evidence", () => {
    expect(inspectArchitectureLedgerAl8LifecycleFeedbackReadback(packet())).toMatchObject({
      ok: true,
      failures: []
    });
  });

  test("rejects missing lifecycle, feedback, metrics and privacy gates", () => {
    const result = inspectArchitectureLedgerAl8LifecycleFeedbackReadback(packet({
      gates: ["AL8-11"],
      lifecycle: {
        cliOk: false,
        previousStatus: "acknowledged",
        nextStatus: "open",
        appendedEventCount: 0,
        duplicateRejected: false
      },
      feedback: {
        schemaVersion: "archcontext.recommendation-feedback/v1",
        explicit: false,
        implicitAcceptance: true,
        actorKind: "cli"
      },
      book: {
        openCount: 1,
        latestStatuses: []
      },
      metrics: {
        schemaVersion: "archcontext.recommendation-lifecycle-metrics/v1",
        recommendationCount: 2,
        feedbackCount: 0,
        acceptedRecommendationRate: 0,
        agentAssistedResolutionRate: 0,
        timeToResolution: { resolvedRecommendationCount: 0 }
      },
      sqlite: {
        feedbackRows: 0
      },
      privacy: {
        containsForbiddenToken: true,
        topLevelRawFieldSeen: true
      }
    }));

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("gate-missing:AL8-12");
    expect(result.failures).toContain("lifecycle-cli-command-failed");
    expect(result.failures).toContain("feedback-not-explicit");
    expect(result.failures).toContain("feedback-implicit-acceptance");
    expect(result.failures).toContain("book-open-includes-accepted");
    expect(result.failures).toContain("metrics-accepted-rate");
    expect(result.failures).toContain("sqlite-feedback-row-count");
    expect(result.failures).toContain("privacy-forbidden-token");
  });
});

function packet(overrides: Record<string, any> = {}) {
  return {
    schemaVersion: "archcontext.architecture-ledger-al8-lifecycle-feedback-readback/v1",
    status: "verified",
    gates: ["AL8-11", "AL8-12", "AL8-13"],
    lifecycle: {
      cliOk: true,
      previousStatus: "open",
      nextStatus: "accepted",
      appendedEventCount: 1,
      duplicateRejected: true
    },
    feedback: {
      schemaVersion: "archcontext.recommendation-feedback/v1",
      explicit: true,
      implicitAcceptance: false,
      actorKind: "subagent"
    },
    book: {
      openCount: 0,
      latestStatuses: ["accepted"]
    },
    metrics: {
      schemaVersion: "archcontext.recommendation-lifecycle-metrics/v1",
      recommendationCount: 1,
      feedbackCount: 1,
      acceptedRecommendationRate: 1,
      agentAssistedResolutionRate: 1,
      timeToResolution: { resolvedRecommendationCount: 1 }
    },
    sqlite: {
      feedbackRows: 1
    },
    privacy: {
      containsForbiddenToken: false,
      topLevelRawFieldSeen: false
    },
    failures: [],
    ...overrides
  };
}
