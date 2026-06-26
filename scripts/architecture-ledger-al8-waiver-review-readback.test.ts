import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl8WaiverReviewReadback } from "./architecture-ledger-al8-waiver-review-readback";

describe("architecture-ledger-al8-waiver-review-readback", () => {
  test("accepts verified AL8 waiver review evidence", () => {
    expect(inspectArchitectureLedgerAl8WaiverReviewReadback(packet())).toMatchObject({
      ok: true,
      failures: []
    });
  });

  test("rejects missing waiver, recommendation gate, agent threshold and DLP gates", () => {
    const result = inspectArchitectureLedgerAl8WaiverReviewReadback(packet({
      gates: ["AL8-09"],
      waiver: {
        validReviewAt: "2026-07-10T00:00:00.000Z",
        invalidReviewWindowError: "",
        waivedStatus: "fail",
        waiverApplicationReviewAt: "",
        expiredViolationCount: 0,
        tamperedViolationCount: 0,
        overscopedViolationCount: 0
      },
      recommendationGate: {
        plainAdvisoryResult: "fail_action_required",
        advisoryGateResult: "pass",
        completeMissingEligibilityResult: "pass",
        completeEligibleResult: "fail_action_required"
      },
      agentThreshold: {
        defaultRiskThreshold: "medium",
        defaultUncertaintyThreshold: "medium",
        mediumRiskAllowed: true,
        mediumUncertaintyAllowed: true,
        highRiskHighUncertaintyAllowed: false,
        policyRequestedMediumAllowed: false
      },
      dlp: {
        containsRawSourceSentinel: true,
        containsRawDiff: true
      }
    }));

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("gate-missing:AL8-10");
    expect(result.failures).toContain("waiver-review-window-not-enforced");
    expect(result.failures).toContain("waiver-not-applied");
    expect(result.failures).toContain("plain-advisory-hard-gated");
    expect(result.failures).toContain("missing-complete-eligibility-not-rejected");
    expect(result.failures).toContain("agent-risk-threshold-not-high");
    expect(result.failures).toContain("medium-risk-agent-allowed");
    expect(result.failures).toContain("dlp-raw-source-sentinel");
  });
});

function packet(overrides: Record<string, any> = {}) {
  return {
    schemaVersion: "archcontext.architecture-ledger-al8-waiver-review-readback/v1",
    status: "verified",
    gates: ["AL8-09", "AL8-10", "AL8-EG2", "AL8-EG3", "AL8-EG4"],
    waiver: {
      validReviewAt: "2026-07-10T00:00:00.000Z",
      invalidReviewWindowError: "practice-waiver-review-window-invalid",
      waivedStatus: "waived",
      waiverApplicationReviewAt: "2026-07-10T00:00:00.000Z",
      expiredViolationCount: 1,
      tamperedViolationCount: 1,
      overscopedViolationCount: 1
    },
    recommendationGate: {
      plainAdvisoryResult: "pass",
      advisoryGateResult: "fail_action_required",
      completeMissingEligibilityResult: "fail_action_required",
      completeEligibleResult: "pass"
    },
    agentThreshold: {
      defaultRiskThreshold: "high",
      defaultUncertaintyThreshold: "high",
      mediumRiskAllowed: false,
      mediumUncertaintyAllowed: false,
      highRiskHighUncertaintyAllowed: true,
      policyRequestedMediumAllowed: true
    },
    dlp: {
      containsRawSourceSentinel: false,
      containsRawDiff: false
    },
    failures: [],
    ...overrides
  };
}
