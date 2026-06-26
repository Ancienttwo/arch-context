import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl10HardeningReadback } from "./architecture-ledger-al10-hardening-readback";

describe("AL10 hardening readback evidence", () => {
  test("accepts a complete hardening packet", () => {
    const result = inspectArchitectureLedgerAl10HardeningReadback(completePacket());

    expect(result.ok).toBe(true);
    expect(result.status).toBe("verified");
    const gates = result.gates as Record<string, string>;
    expect(gates["AL10-07"]).toBe("verified");
    expect(gates["AL10-BETA-2"]).toBe("verified");
    expect(gates["AL10-BETA-3"]).toBe("verified");
    expect(gates["AL10-BETA-5"]).toBe("verified");
    expect(gates["AL10-BETA-6"]).toBe("verified");
  });

  test("rejects incomplete stress replay evidence", () => {
    const packet = completePacket();
    packet.stress.replayEventCount = 999;
    packet.stress.duplicateAppendCount = 0;
    packet.assertions["AL10-BETA-2"] = false;

    const result = inspectArchitectureLedgerAl10HardeningReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("stress replay event count must be 1000");
    expect(result.failures).toContain("stress duplicate append count must be 1");
    expect(result.failures).toContain("AL10-BETA-2 assertion failed");
  });

  test("rejects raw-source privacy leaks on any scanned surface", () => {
    const packet = completePacket();
    packet.privacy.sqlite.clean = false;
    packet.privacy.mcp.clean = false;
    packet.privacy.overallClean = false;
    packet.privacy.forbiddenKeyHits = ["sqlite:$.eventRows[0].sourceCode"];
    packet.privacy.forbiddenTokenHits = ["mcp:AL10_HARDENING_RAW_SOURCE_SENTINEL_do_not_emit"];
    packet.assertions["AL10-07"] = false;
    packet.assertions["AL10-BETA-3"] = false;

    const result = inspectArchitectureLedgerAl10HardeningReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("privacy sqlite surface must be clean");
    expect(result.failures).toContain("privacy mcp surface must be clean");
    expect(result.failures).toContain("privacy overallClean must be true");
    expect(result.failures).toContain("privacy forbidden keys present: sqlite:$.eventRows[0].sourceCode");
    expect(result.failures).toContain("privacy forbidden tokens present: mcp:AL10_HARDENING_RAW_SOURCE_SENTINEL_do_not_emit");
    expect(result.failures).toContain("AL10-07 assertion failed");
    expect(result.failures).toContain("AL10-BETA-3 assertion failed");
  });

  test("rejects default hook auto-spawn drift", () => {
    const packet = completePacket();
    packet.defaultHook.medianSpawnCount = 1;
    packet.defaultHook.totalSpawnedJobs = 3;
    packet.defaultHook.defaultHookAllZeroSpawn = false;
    packet.assertions["AL10-BETA-5"] = false;

    const result = inspectArchitectureLedgerAl10HardeningReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("default hook median spawn count must be 0");
    expect(result.failures).toContain("default hook total spawned jobs must be 0");
    expect(result.failures).toContain("default hook samples must all produce zero spawned jobs");
    expect(result.failures).toContain("AL10-BETA-5 assertion failed");
  });

  test("rejects incomplete rollback-to-YAML evidence", () => {
    const packet = completePacket();
    packet.rollback.fullRollbackToYaml = false;
    packet.rollback.rollbackBackupCreated = false;
    packet.assertions["AL10-BETA-6"] = false;

    const result = inspectArchitectureLedgerAl10HardeningReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("rollback must restore YAML authority");
    expect(result.failures).toContain("rollback backup must be created");
    expect(result.failures).toContain("AL10-BETA-6 assertion failed");
  });
});

function completePacket(): any {
  return {
    schemaVersion: "archcontext.architecture-ledger-al10-hardening-readback/v1",
    generatedAt: "1970-01-01T00:00:00.000Z",
    status: "verified",
    gates: ["AL10-07", "AL10-BETA-2", "AL10-BETA-3", "AL10-BETA-5", "AL10-BETA-6"],
    thresholds: {
      stressEventCount: 1000,
      defaultHookSampleCount: 9,
      medianDefaultSpawnCount: 0
    },
    stress: {
      eventCount: 1000,
      appendedEventCount: 1000,
      duplicateAppendCount: 1,
      replayEventCount: 1000,
      uniqueEventIds: 1000,
      integrityOk: true,
      faultRollbackOk: true
    },
    defaultHook: {
      sampleCount: 9,
      medianSpawnCount: 0,
      totalSpawnedJobs: 0,
      defaultHookAllZeroSpawn: true,
      explicitHighRiskEnqueued: true
    },
    rollback: {
      fullRollbackToYaml: true,
      rollbackBackupCreated: true,
      rollbackCommandPresent: true
    },
    privacy: {
      sqlite: cleanSurface("sqlite"),
      cli: cleanSurface("cli"),
      mcp: cleanSurface("mcp"),
      logs: cleanSurface("logs"),
      agentJobs: cleanSurface("agentJobs"),
      forbiddenKeyHits: [],
      forbiddenTokenHits: [],
      overallClean: true,
      noRawSourceSentinel: true,
      scannedSurfaceCount: 5
    },
    assertions: {
      "AL10-07": true,
      "AL10-BETA-2": true,
      "AL10-BETA-3": true,
      "AL10-BETA-5": true,
      "AL10-BETA-6": true
    },
    failures: []
  };
}

function cleanSurface(surface: string): any {
  return {
    clean: true,
    forbiddenKeyHits: [],
    forbiddenTokenHits: [],
    digest: `sha256:${surface.padEnd(64, "0").slice(0, 64)}`
  };
}
