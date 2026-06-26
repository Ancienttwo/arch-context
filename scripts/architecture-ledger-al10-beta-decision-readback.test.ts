import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl10BetaDecisionReadback } from "./architecture-ledger-al10-beta-decision-readback";

describe("AL10 beta decision governance readback", () => {
  test("accepts a complete beta decision packet", () => {
    const result = inspectArchitectureLedgerAl10BetaDecisionReadback(completePacket());

    expect(result.ok).toBe(true);
    expect(result.status).toBe("verified");
    const gates = result.gates as Record<string, string>;
    expect(gates["AL10-15"]).toBe("verified");
    expect(gates["AL10-16"]).toBe("verified");
  });

  test("rejects missing independent reviewer policy coverage", () => {
    const packet = completePacket();
    const policy = packet.sourceReadbacks.find((item: any) => item.id === "authority-promotion-review");
    policy.status = "blocked";
    policy.verified = false;
    policy.missingTerms = ["independent reviewer", "no self-attestation"];
    packet.assertions["AL10-15"] = false;
    packet.assertions.independentReviewerRequired = false;
    packet.assertions.sourceReadbacksVerified = false;

    const result = inspectArchitectureLedgerAl10BetaDecisionReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("authority-promotion-review: status must be verified");
    expect(result.failures).toContain("authority-promotion-review: source readback must be verified");
    expect(result.failures).toContain("authority-promotion-review: missing terms independent reviewer,no self-attestation");
    expect(result.failures).toContain("assertions.AL10-15 must be true");
    expect(result.failures).toContain("assertions.independentReviewerRequired must be true");
  });

  test("rejects promotion overclaim or missing blocking risks", () => {
    const packet = completePacket();
    packet.decision.decision = "GO";
    packet.decision.promotionAllowed = true;
    packet.decision.enforcementEnablementAllowed = true;
    packet.decision.unresolvedRisks = packet.decision.unresolvedRisks.filter((risk: any) => risk.id !== "missing-beta-user-interviews");
    packet.assertions["AL10-16"] = false;
    packet.assertions.decisionRecorded = false;
    packet.assertions.advisoryOnlyBoundary = false;

    const result = inspectArchitectureLedgerAl10BetaDecisionReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("decision must be NO-GO");
    expect(result.failures).toContain("decision.promotionAllowed must be false");
    expect(result.failures).toContain("decision.enforcementEnablementAllowed must be false");
    expect(result.failures).toContain("decision unresolved risk missing: missing-beta-user-interviews");
    expect(result.failures).toContain("assertions.AL10-16 must be true");
  });

  test("rejects gate overclaim", () => {
    const packet = completePacket();
    packet.gates.push("AL10-14");
    packet.scope.closedGates.push("AL10-14");
    packet.gateBoundary.closedGates.push("AL10-14");
    packet.assertions["AL10-14"] = true;

    const result = inspectArchitectureLedgerAl10BetaDecisionReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("gates must be exactly AL10-15 and AL10-16");
    expect(result.failures).toContain("scope.closedGates must be exactly AL10-15 and AL10-16");
    expect(result.failures).toContain("gateBoundary.closedGates must be exactly AL10-15 and AL10-16");
    expect(result.failures).toContain("unexpected gate assertion: AL10-14");
  });
});

function completePacket(): any {
  return {
    schemaVersion: "archcontext.architecture-ledger-al10-beta-decision-readback/v1",
    generatedAt: "1970-01-01T00:00:00.000Z",
    gates: ["AL10-15", "AL10-16"],
    status: "verified",
    scope: {
      closedGates: ["AL10-15", "AL10-16"],
      explicitlyOpen: [
        "AL10-14",
        "AL10-GA-1",
        "AL10-GA-2",
        "AL10-GA-3",
        "AL10-GA-4",
        "AL10-GA-5",
        "AL10-GA-6",
        "AL10-GA-7"
      ]
    },
    readbackDigest: `sha256:${"a".repeat(64)}`,
    sourceReadbacks: [
      source("authority-promotion-review"),
      source("al10-telemetry", {
        gates: ["AL10-13"],
        explicitlyOpen: ["AL10-14", "AL10-15", "AL10-16", "AL10-GA-1"],
        hookEnqueueP95AboveBetaBudget: true
      }),
      source("authority-matrix"),
      source("adr-0040")
    ],
    decision: {
      decision: "NO-GO",
      scope: "ledger-authoritative-promotion-and-enforcement-enablement",
      advisoryLocalOptInAllowed: true,
      promotionAllowed: false,
      enforcementEnablementAllowed: false,
      productInterviewEvidenceStatus: "missing",
      independentReviewStatus: "required-not-yet-approved",
      reasonCount: 4,
      unresolvedRisks: [
        risk("missing-beta-user-interviews"),
        risk("missing-independent-review-approval"),
        risk("hook-enqueue-p95-beta-budget"),
        risk("ga-gates-open")
      ]
    },
    gateBoundary: {
      closedGates: ["AL10-15", "AL10-16"],
      explicitlyOpen: [
        "AL10-14",
        "AL10-GA-1",
        "AL10-GA-2",
        "AL10-GA-3",
        "AL10-GA-4",
        "AL10-GA-5",
        "AL10-GA-6",
        "AL10-GA-7"
      ],
      noGateOverclaim: true
    },
    privacy: {
      forbiddenSecretHitCount: 0,
      forbiddenRawContentHitCount: 0,
      secretHits: [],
      rawContentHits: [],
      clean: true
    },
    assertions: {
      "AL10-15": true,
      "AL10-16": true,
      sourceReadbacksVerified: true,
      independentReviewerRequired: true,
      decisionRecorded: true,
      advisoryOnlyBoundary: true,
      activeRiskCarriedForward: true,
      openGatesPreserved: true,
      noPrivateContent: true
    }
  };
}

function source(id: string, extras: Record<string, unknown> = {}): any {
  return {
    id,
    path: `docs/verification/${id}.json`,
    sha256: `sha256:${"b".repeat(64)}`,
    status: "verified",
    requiredTermsPresent: ["term"],
    missingTerms: [],
    verified: true,
    ...extras
  };
}

function risk(id: string): any {
  return {
    id,
    severity: "promotion-blocker",
    detail: id
  };
}
