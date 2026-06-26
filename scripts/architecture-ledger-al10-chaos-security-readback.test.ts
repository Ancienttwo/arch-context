import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl10ChaosSecurityReadback } from "./architecture-ledger-al10-chaos-security-readback";

describe("AL10 chaos/security readback evidence", () => {
  test("accepts a complete chaos/security packet", () => {
    const result = inspectArchitectureLedgerAl10ChaosSecurityReadback(completePacket());

    expect(result.ok).toBe(true);
    expect(result.status).toBe("verified");
    const gates = result.gates as Record<string, string>;
    expect(gates["AL10-05"]).toBe("verified");
    expect(gates["AL10-06"]).toBe("verified");
  });

  test("rejects missing required chaos and security cases", () => {
    const packet = completePacket();
    packet.chaos.daemonCrash.ok = false;
    packet.security.staleReplay.ok = false;
    packet.assertions["AL10-05"] = false;
    packet.assertions["AL10-06"] = false;

    const result = inspectArchitectureLedgerAl10ChaosSecurityReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("chaos case daemon-crash must be verified");
    expect(result.failures).toContain("security case stale-replay must be verified");
    expect(result.failures).toContain("AL10-05 assertion failed");
    expect(result.failures).toContain("AL10-06 assertion failed");
  });

  test("rejects gate overclaim and raw payload leaks", () => {
    const packet = completePacket();
    packet.gates.push("AL10-GA-4");
    packet.assertions["AL10-GA-4"] = true;
    packet.privacy.clean = false;
    packet.privacy.forbiddenKeyHits = ["$.security.promptInjection.details.body"];

    const result = inspectArchitectureLedgerAl10ChaosSecurityReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("gates must be exactly AL10-05 and AL10-06");
    expect(result.failures).toContain("privacy scan must be clean");
    expect(result.failures).toContain("privacy forbidden keys present: $.security.promptInjection.details.body");
    expect(result.failures).toContain("unexpected gate assertion: AL10-GA-4");
  });
});

function completePacket(): any {
  return {
    schemaVersion: "archcontext.architecture-ledger-al10-chaos-security-readback/v1",
    generatedAt: "1970-01-01T00:00:00.000Z",
    status: "verified",
    gates: ["AL10-05", "AL10-06"],
    thresholds: {
      chaosCaseCount: 6,
      securityCaseCount: 6,
      requiredChaosCases: ["daemon-crash", "db-lock", "disk-full", "corrupt-row", "interrupted-rebase", "provider-timeout"],
      requiredSecurityCases: ["prompt-injection", "path-traversal", "symlink-escape", "forged-evidence", "event-tamper", "stale-replay"]
    },
    chaos: {
      daemonCrash: probe("daemon-crash"),
      dbLock: probe("db-lock"),
      diskFull: probe("disk-full"),
      corruptRow: probe("corrupt-row"),
      interruptedRebase: probe("interrupted-rebase"),
      providerTimeout: probe("provider-timeout")
    },
    security: {
      promptInjection: probe("prompt-injection"),
      pathTraversal: probe("path-traversal"),
      symlinkEscape: probe("symlink-escape"),
      forgedEvidence: probe("forged-evidence"),
      eventTamper: probe("event-tamper"),
      staleReplay: probe("stale-replay")
    },
    privacy: {
      clean: true,
      forbiddenKeyHits: [],
      forbiddenTokenHits: [],
      scannedSurfaceCount: 2,
      digest: `sha256:${"a".repeat(64)}`
    },
    assertions: {
      "AL10-05": true,
      "AL10-06": true
    },
    failures: []
  };
}

function probe(caseId: string): any {
  return {
    ok: true,
    caseId,
    reasonCode: "verified",
    guard: "test guard",
    details: {}
  };
}
