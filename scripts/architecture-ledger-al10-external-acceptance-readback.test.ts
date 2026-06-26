import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl10ExternalAcceptanceReadback } from "./architecture-ledger-al10-external-acceptance-readback";

describe("AL10 external acceptance readback", () => {
  test("accepts a valid blocked packet without closing external gates", () => {
    const result = inspectArchitectureLedgerAl10ExternalAcceptanceReadback(blockedPacket());

    expect(result.ok).toBe(true);
    expect(result.status).toBe("blocked");
    const gates = result.gates as Record<string, string>;
    expect(gates["AL10-14"]).toBe("blocked");
    expect(gates["AL10-GA-6"]).toBe("blocked");
    expect(gates["AL10-GA-7"]).toBe("blocked");
  });

  test("accepts a complete packet only when all canonical artifacts verify", () => {
    const packet = verifiedPacket();
    const result = inspectArchitectureLedgerAl10ExternalAcceptanceReadback(packet);

    expect(result.ok).toBe(true);
    expect(result.status).toBe("verified");
    expect(result.gates).toEqual({
      "AL10-14": "verified",
      "AL10-GA-6": "verified",
      "AL10-GA-7": "verified"
    });
  });

  test("rejects a verified overclaim while any external gate remains blocked", () => {
    const packet = blockedPacket();
    packet.status = "verified";
    packet.scope.closedGates = ["AL10-14", "AL10-GA-6", "AL10-GA-7"];
    packet.scope.remainingGates = [];
    packet.assertions.externalEvidenceComplete = true;
    packet.assertions.externalEvidenceBlocked = false;

    const result = inspectArchitectureLedgerAl10ExternalAcceptanceReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("verified packet cannot have blocked gates: AL10-14,AL10-GA-6,AL10-GA-7");
  });

  test("rejects using carry-over FG6 evidence as the AL10 independent review artifact", () => {
    const packet = verifiedPacket();
    const review = packet.requiredArtifacts.find((artifact: any) => artifact.id === "independent-architecture-security-review");
    review.path = "docs/security/reviews/fg6-external-security-review.md";

    const result = inspectArchitectureLedgerAl10ExternalAcceptanceReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("independent-architecture-security-review: artifact path must use canonical path docs/approvals/architecture-ledger-al10-independent-review.md");
  });
});

function blockedPacket(): any {
  return {
    schemaVersion: "archcontext.architecture-ledger-al10-external-acceptance-readback/v1",
    generatedAt: "1970-01-01T00:00:00.000Z",
    status: "blocked",
    gates: ["AL10-14", "AL10-GA-6", "AL10-GA-7"],
    scope: {
      auditedGates: ["AL10-14", "AL10-GA-6", "AL10-GA-7"],
      closedGates: [],
      remainingGates: ["AL10-14", "AL10-GA-6", "AL10-GA-7"],
      nonClaims: []
    },
    requiredArtifacts: [
      requiredArtifact("beta-user-interviews", "AL10-14", "docs/verification/architecture-ledger-al10-beta-user-interviews.md", "Verified", "blocked"),
      requiredArtifact("independent-architecture-security-review", "AL10-GA-6", "docs/approvals/architecture-ledger-al10-independent-review.md", "Approved", "blocked"),
      requiredArtifact("production-rollback-drill", "AL10-GA-7", "docs/verification/architecture-ledger-al10-production-rollback-drill.md", "Verified", "blocked")
    ],
    gateResults: [
      gate("AL10-14", "beta-user-interviews", "docs/verification/architecture-ledger-al10-beta-user-interviews.md", "blocked"),
      gate("AL10-GA-6", "independent-architecture-security-review", "docs/approvals/architecture-ledger-al10-independent-review.md", "blocked"),
      gate("AL10-GA-7", "production-rollback-drill", "docs/verification/architecture-ledger-al10-production-rollback-drill.md", "blocked")
    ],
    legacyArtifacts: [
      legacy("fg6-external-security-review", "docs/security/reviews/fg6-external-security-review.md", "FG6 security-only release review; not AL10 architecture-ledger authority promotion approval."),
      legacy("m6-independent-threat-review", "docs/security/reviews/m6-independent-threat-review.md", "M6 deterministic MVP threat review; not AL10 external architecture and security acceptance."),
      legacy("fg6-personal-beta-launch", "docs/approvals/fg6-personal-beta-launch.md", "Personal-user beta launch approval; explicitly not production GA or design-partner rollout."),
      legacy("production-ga-external-readback", "docs/verification/production-ga-external-readback.md", "Production GA external readback is blocked and explicitly not a production launch approval.")
    ],
    sourceReadbacks: [
      source("docs/architecture/architecture-ledger-authority-promotion-review.md"),
      source("docs/runbooks/architecture-ledger-rollout.md"),
      source("docs/verification/architecture-ledger-al10-beta-decision.md"),
      source("docs/verification/architecture-ledger-al10-ga-technical.md")
    ],
    privacy: {
      forbiddenSecretHitCount: 0,
      forbiddenRawContentHitCount: 0,
      secretHits: [],
      rawContentHits: [],
      clean: true
    },
    assertions: {
      canonicalArtifactsPresent: true,
      canonicalSourcesOnly: true,
      externalEvidenceComplete: false,
      externalEvidenceBlocked: true,
      legacyArtifactsRejected: true,
      noGateOverclaim: true,
      privacyClean: true,
      sourceReadbacksPresent: true
    },
    readbackDigest: `sha256:${"a".repeat(64)}`
  };
}

function verifiedPacket(): any {
  const packet = blockedPacket();
  packet.status = "verified";
  packet.scope.closedGates = ["AL10-14", "AL10-GA-6", "AL10-GA-7"];
  packet.scope.remainingGates = [];
  for (const artifact of packet.requiredArtifacts) {
    artifact.status = "verified";
    artifact.verified = true;
    artifact.statusMarkerPresent = true;
    artifact.missingTerms = [];
    artifact.blockedReasons = [];
  }
  for (const result of packet.gateResults) {
    result.status = "verified";
    result.blocker = "";
  }
  packet.assertions.externalEvidenceComplete = true;
  packet.assertions.externalEvidenceBlocked = false;
  return packet;
}

function requiredArtifact(id: string, gate: string, path: string, requiredStatus: string, status: string): any {
  return {
    id,
    gate,
    path,
    exists: true,
    sha256: `sha256:${"b".repeat(64)}`,
    requiredStatus,
    status,
    verified: status === "verified",
    statusMarkerPresent: status === "verified",
    requiredTermsPresent: ["Status"],
    missingTerms: status === "verified" ? [] : ["Verified"],
    blockedReasons: status === "verified" ? [] : ["status marker missing"]
  };
}

function gate(gateId: string, artifactId: string, artifactPath: string, status: string): any {
  return {
    gate: gateId,
    status,
    artifactId,
    artifactPath,
    blocker: status === "verified" ? "" : "status marker missing"
  };
}

function legacy(id: string, path: string, rejectionReason: string): any {
  return {
    id,
    path,
    exists: true,
    sha256: `sha256:${"c".repeat(64)}`,
    rejected: true,
    rejectionReason,
    rejectionTermsPresent: ["term"]
  };
}

function source(path: string): any {
  return {
    path,
    exists: true,
    sha256: `sha256:${"d".repeat(64)}`
  };
}
