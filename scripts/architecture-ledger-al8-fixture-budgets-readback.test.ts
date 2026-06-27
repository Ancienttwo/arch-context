import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl8FixtureBudgetsReadback } from "./architecture-ledger-al8-fixture-budgets-readback";

describe("architecture-ledger-al8-fixture-budgets-readback", () => {
  test("accepts verified AL8 fixture and budget evidence", () => {
    expect(inspectArchitectureLedgerAl8FixtureBudgetsReadback(packet())).toMatchObject({
      ok: true,
      failures: []
    });
  });

  test("rejects missing fixture gates, repo policy budget and privacy failures", () => {
    const result = inspectArchitectureLedgerAl8FixtureBudgetsReadback(packet({
      status: "blocked",
      assertions: {
        "AL8-15": false,
        "AL8-16": false
      },
      fixtureGate: {
        completeEligibleCount: 8,
        readyCount: 7,
        missingFixturePaths: ["modularity.no-new-cycle:missing.jsonl"]
      },
      enforcementGate: {
        missingGateBlocked: false,
        readyGateAllowsCheck: false
      },
      schedulerBudget: {
        loadedFromRepoPolicy: false,
        recommendationCount: 3,
        l3EligibleCount: 2
      },
      privacy: {
        noForbiddenKeys: false
      }
    }));

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("status-not-verified");
    expect(result.failures).toContain("AL8-15 assertion must be true");
    expect(result.failures).toContain("AL8-16 assertion must be true");
    expect(result.failures).toContain("fixture-gate-ready-count");
    expect(result.failures).toContain("fixture-path-missing");
    expect(result.failures).toContain("missing-fixture-gate-not-blocked");
    expect(result.failures).toContain("ready-fixture-gate-did-not-run-check");
    expect(result.failures).toContain("repo-local-policy-not-loaded");
    expect(result.failures).toContain("scheduler-recommendation-budget");
    expect(result.failures).toContain("scheduler-l3-budget");
    expect(result.failures).toContain("privacy-forbidden-key");
  });
});

function packet(overrides: Record<string, any> = {}) {
  return {
    schemaVersion: "archcontext.architecture-ledger-al8-fixture-budgets-readback/v1",
    status: "verified",
    gates: ["AL8-15", "AL8-16"],
    assertions: {
      "AL8-15": true,
      "AL8-16": true
    },
    fixtureGate: {
      completeEligibleCount: 8,
      readyCount: 8,
      missingFixturePaths: []
    },
    enforcementGate: {
      missingGateBlocked: true,
      readyGateAllowsCheck: true
    },
    schedulerBudget: {
      loadedFromRepoPolicy: true,
      recommendationCount: 2,
      l3EligibleCount: 1
    },
    privacy: {
      noForbiddenKeys: true
    },
    failures: [],
    ...overrides
  };
}
