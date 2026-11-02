import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  buildArchitectureLedgerAl10ExternalAcceptancePacket,
  inspectArchitectureLedgerAl10ExternalAcceptanceReadback
} from "./architecture-ledger-al10-external-acceptance-readback";

const AL10_REVIEW_URL = "https://github.com/Ancienttwo/arch-context/pull/83#issuecomment-6571947292";
const FG6_LAUNCH_URL = "https://github.com/Ancienttwo/arch-context/pull/2#issuecomment-6571948948";

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
    delete review.url;
    review.path = "docs/security/reviews/fg6-external-security-review.md";

    const result = inspectArchitectureLedgerAl10ExternalAcceptanceReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(`independent-architecture-security-review: artifact url must use canonical url ${AL10_REVIEW_URL}`);
  });

  test("reads the moved approvals only from their comment URLs and records author and body digest", () => {
    const approvedBody = [
      "> **Status**: Approved",
      "independent reviewer, architecture review, security review, ledger-authoritative,",
      "enforcement enablement, unresolved risk"
    ].join("\n");
    const bodies: Record<string, string> = {
      [AL10_REVIEW_URL]: approvedBody,
      [FG6_LAUNCH_URL]: "This approval does not approve production GA."
    };
    const readUrls: string[] = [];
    const packet = buildArchitectureLedgerAl10ExternalAcceptancePacket((url) => {
      readUrls.push(url);
      return { author: "owner", body: bodies[url] };
    });

    expect(readUrls.sort()).toEqual([FG6_LAUNCH_URL, AL10_REVIEW_URL].sort());
    const review: any = packet.requiredArtifacts.find((artifact) => artifact.id === "independent-architecture-security-review");
    expect(review).toMatchObject({ url: AL10_REVIEW_URL, author: "owner", status: "verified", verified: true });
    expect(review.sha256).toBe(`sha256:${createHash("sha256").update(approvedBody, "utf8").digest("hex")}`);
    expect(review.path).toBeUndefined();
    expect(packet.gateResults.find((gate) => gate.gate === "AL10-GA-6")?.artifactLocation).toBe(AL10_REVIEW_URL);
    const launch: any = packet.legacyArtifacts.find((artifact) => artifact.id === "fg6-personal-beta-launch");
    expect(launch).toMatchObject({ url: FG6_LAUNCH_URL, author: "owner", rejected: true, rejectionTermsPresent: ["does not approve", "production GA"] });

    const blocked = buildArchitectureLedgerAl10ExternalAcceptancePacket((url) => ({ author: "owner", body: url === AL10_REVIEW_URL ? approvedBody.replace("Approved", "Pending") : bodies[url] }));
    const blockedReview: any = blocked.requiredArtifacts.find((artifact) => artifact.id === "independent-architecture-security-review");
    expect(blockedReview.status).toBe("blocked");
    expect(blockedReview.blockedReasons).toContain("status marker must be Approved");
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
      requiredArtifact("beta-user-interviews", "AL10-14", { path: "docs/verification/architecture-ledger-al10-beta-user-interviews.md" }, "Verified", "blocked"),
      requiredArtifact("independent-architecture-security-review", "AL10-GA-6", { url: AL10_REVIEW_URL, author: "owner" }, "Approved", "blocked"),
      requiredArtifact("production-rollback-drill", "AL10-GA-7", { path: "docs/verification/architecture-ledger-al10-production-rollback-drill.md" }, "Verified", "blocked")
    ],
    gateResults: [
      gate("AL10-14", "beta-user-interviews", "docs/verification/architecture-ledger-al10-beta-user-interviews.md", "blocked"),
      gate("AL10-GA-6", "independent-architecture-security-review", AL10_REVIEW_URL, "blocked"),
      gate("AL10-GA-7", "production-rollback-drill", "docs/verification/architecture-ledger-al10-production-rollback-drill.md", "blocked")
    ],
    legacyArtifacts: [
      legacy("fg6-external-security-review", { path: "docs/security/reviews/fg6-external-security-review.md" }, "FG6 security-only release review; not AL10 architecture-ledger authority promotion approval."),
      legacy("m6-independent-threat-review", { path: "docs/security/reviews/m6-independent-threat-review.md" }, "M6 deterministic MVP threat review; not AL10 external architecture and security acceptance."),
      legacy("fg6-personal-beta-launch", { url: FG6_LAUNCH_URL, author: "owner" }, "Personal-user beta launch approval; explicitly not production GA or design-partner rollout."),
      legacy("production-ga-external-readback", { path: "docs/verification/production-ga-external-readback.md" }, "Production GA external readback is blocked and explicitly not a production launch approval.")
    ],
    sourceReadbacks: [
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

function requiredArtifact(id: string, gate: string, location: Record<string, string>, requiredStatus: string, status: string): any {
  return {
    id,
    gate,
    ...location,
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

function gate(gateId: string, artifactId: string, artifactLocation: string, status: string): any {
  return {
    gate: gateId,
    status,
    artifactId,
    artifactLocation,
    blocker: status === "verified" ? "" : "status marker missing"
  };
}

function legacy(id: string, location: Record<string, string>, rejectionReason: string): any {
  return {
    id,
    ...location,
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
