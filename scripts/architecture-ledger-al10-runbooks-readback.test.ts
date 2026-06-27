import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl10RunbooksReadback } from "./architecture-ledger-al10-runbooks-readback";

describe("AL10 runbooks readback evidence", () => {
  test("accepts a complete operations runbook packet", () => {
    const result = inspectArchitectureLedgerAl10RunbooksReadback(completePacket());

    expect(result.ok).toBe(true);
    expect(result.status).toBe("verified");
    const gates = result.gates as Record<string, string>;
    expect(gates["AL10-12"]).toBe("verified");
  });

  test("rejects incomplete runbook coverage", () => {
    const packet = completePacket();
    const incident = packet.sectionCoverage.find((section: any) => section.id === "incident");
    incident.complete = false;
    incident.hasVerification = false;
    incident.missingTerms = ["archctx privacy-audit"];
    packet.assertions["AL10-12"] = false;
    packet.assertions.allRunbookSectionsActionable = false;
    packet.assertions.incidentCoversPrivacyStop = false;

    const result = inspectArchitectureLedgerAl10RunbooksReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("incident: Verification is required");
    expect(result.failures).toContain("incident: missing terms archctx privacy-audit");
    expect(result.failures).toContain("incident: runbook section must be complete");
    expect(result.failures).toContain("assertions.AL10-12 must be true");
  });

  test("rejects missing source evidence or privacy contamination", () => {
    const packet = completePacket();
    const source = packet.sourceReadbacks.find((item: any) => item.id === "chaos-security");
    source.status = "failed";
    source.ok = false;
    source.verified = false;
    source.missingTerms = ["stale"];
    packet.privacy.forbiddenRawContentHitCount = 1;
    packet.privacy.rawContentHits = ["/diff\\s+--git/i"];
    packet.privacy.clean = false;
    packet.assertions.sourceEvidenceVerified = false;
    packet.assertions.noPrivateContent = false;

    const result = inspectArchitectureLedgerAl10RunbooksReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("chaos-security: source status must be verified");
    expect(result.failures).toContain("chaos-security: source ok must be true");
    expect(result.failures).toContain("chaos-security: missing evidence terms stale");
    expect(result.failures).toContain("privacy forbiddenRawContentHitCount must be 0");
    expect(result.failures).toContain("privacy must be clean");
  });

  test("rejects gate overclaim", () => {
    const packet = completePacket();
    packet.gates.push("AL10-13");
    packet.scope.closedGates.push("AL10-13");
    packet.assertions["AL10-13"] = true;

    const result = inspectArchitectureLedgerAl10RunbooksReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("gates must be exactly AL10-12");
    expect(result.failures).toContain("scope.closedGates must be exactly AL10-12");
    expect(result.failures).toContain("unexpected gate assertion: AL10-13");
  });
});

function completePacket(): any {
  return {
    schemaVersion: "archcontext.architecture-ledger-al10-runbooks-readback/v1",
    generatedAt: "1970-01-01T00:00:00.000Z",
    gates: ["AL10-12"],
    status: "verified",
    scope: {
      closedGates: ["AL10-12"],
      explicitlyOpen: ["AL10-13", "AL10-GA-1"]
    },
    readbackDigest: `sha256:${"a".repeat(64)}`,
    sectionCoverage: [
      section("incident"),
      section("corruption-recovery"),
      section("drift-recovery"),
      section("provider-disable"),
      section("full-rollback")
    ],
    sourceReadbacks: [
      source("rollout-workflow"),
      source("hardening"),
      source("chaos-security"),
      source("release-packaging"),
      source("agent-comparison")
    ],
    privacy: {
      forbiddenSecretHitCount: 0,
      forbiddenRawContentHitCount: 0,
      secretHits: [],
      rawContentHits: [],
      clean: true
    },
    assertions: {
      "AL10-12": true,
      allRunbookSectionsPresent: true,
      allRunbookSectionsActionable: true,
      sourceEvidenceVerified: true,
      incidentCoversPrivacyStop: true,
      corruptionKeepsGitAsRebuildBoundary: true,
      driftHasBothDirections: true,
      providerDisableKeepsLocalCore: true,
      fullRollbackReturnsYaml: true,
      noPrivateContent: true
    }
  };
}

function section(id: string): any {
  return {
    id,
    title: id,
    present: true,
    hasSignal: true,
    hasTriage: true,
    hasVerification: true,
    hasCommandBlock: true,
    requiredTermsPresent: ["term"],
    missingTerms: [],
    complete: true
  };
}

function source(id: string): any {
  return {
    id,
    path: `docs/verification/${id}.json`,
    schemaVersion: `archcontext.${id}/v1`,
    status: "verified",
    ok: true,
    requiredTermsPresent: ["term"],
    missingTerms: [],
    verified: true
  };
}
