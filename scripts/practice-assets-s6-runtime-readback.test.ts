import { describe, expect, test } from "bun:test";
import { inspectPracticeAssetsS6RuntimeReadback } from "./practice-assets-s6-runtime-readback";

describe("practice-assets-s6-runtime-readback", () => {
  test("accepts a verified runtime gate packet", () => {
    expect(inspectPracticeAssetsS6RuntimeReadback(verifiedPacket())).toMatchObject({
      ok: true,
      catalogWarmP95Ms: 12,
      matchingWarmP95Ms: 24,
      checkpointWarmP95Ms: 96,
      failures: []
    });
  });

  test("rejects performance regressions", () => {
    const packet = verifiedPacket();
    packet.status = "failed";
    packet.performance.p95.catalogWarmMs = 51;
    packet.assertions.catalogWarmP95WithinLimit = false;

    const result = inspectPracticeAssetsS6RuntimeReadback(packet);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("status must be verified");
    expect(result.failures).toContain("performance.p95.catalogWarmMs 51ms exceeds 50ms");
    expect(result.failures).toContain("assertions.catalogWarmP95WithinLimit must be true");
  });

  test("rejects silent corruption and missing stale catalog detection", () => {
    const packet = verifiedPacket();
    packet.reliability.sqliteCorruption.silentDataError = true;
    packet.reliability.staleCatalog.reasonCode = "no-op";
    packet.assertions.sqliteCorruptionTypedRecovery = false;
    packet.assertions.staleCatalogDetected = false;

    const result = inspectPracticeAssetsS6RuntimeReadback(packet);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("reliability.sqliteCorruption.silentDataError must be false");
    expect(result.failures).toContain("reliability.staleCatalog.reasonCode must be stale-catalog");
    expect(result.failures).toContain("assertions.sqliteCorruptionTypedRecovery must be true");
    expect(result.failures).toContain("assertions.staleCatalogDetected must be true");
  });
});

function verifiedPacket(): any {
  return {
    schemaVersion: "archcontext.practice-assets-s6-runtime-readback/v1",
    status: "verified",
    generatedAt: "2026-06-24T00:00:00.000Z",
    thresholds: {
      catalogWarmP95Ms: 50,
      matchingWarmP95Ms: 150,
      checkpointWarmP95Ms: 250
    },
    summary: {
      syntheticPracticeCount: 100,
      effectivePracticeCount: 141,
      samples: 12,
      catalogDigest: `sha256:${"1".repeat(64)}`
    },
    performance: {
      catalogDigest: `sha256:${"1".repeat(64)}`,
      effectivePracticeCount: 141,
      samples: {
        catalogWarmMs: [8, 9, 12],
        matchingWarmMs: [20, 21, 24],
        checkpointWarmMs: [82, 91, 96]
      },
      p95: {
        catalogWarmMs: 12,
        matchingWarmMs: 24,
        checkpointWarmMs: 96
      },
      checkpointNoNetwork: true,
      checkpointCoalescedCount: 0
    },
    reliability: {
      catalogCorruption: {
        typed: true,
        issueCodes: ["practice-yaml-parse-failed"],
        recovered: true,
        silentDataError: false
      },
      sqliteCorruption: {
        status: "target-incomplete",
        typed: true,
        recoveryAction: "repair-or-delete-corrupt-target",
        migrateError: "ArchContext runtime state target is not a valid SQLite database",
        silentDataError: false
      },
      migration: {
        preInspectStatus: "pending",
        forwardStatus: "migrated",
        migrated: true,
        postInspectStatus: "target-current",
        targetIntegrity: "ok",
        unknownTableIgnored: true,
        markerWritten: true,
        markerFile: "runtime.sqlite.migration.json"
      },
      staleCatalog: {
        ok: true,
        fresh: false,
        reasonCode: "stale-catalog",
        staleReasons: ["stale-catalog"],
        previousCatalogDigest: `sha256:${"9".repeat(64)}`,
        catalogDigest: `sha256:${"1".repeat(64)}`,
        worktreeDigest: `sha256:${"2".repeat(64)}`,
        persistedBaselineKey: "practice-checkpoint:repo:task"
      }
    },
    assertions: {
      catalogWarmP95WithinLimit: true,
      matchingWarmP95WithinLimit: true,
      checkpointWarmP95WithinLimit: true,
      checkpointNoNetwork: true,
      catalogCorruptionTypedRecovery: true,
      sqliteCorruptionTypedRecovery: true,
      sqliteMigrationForwardAndBackwardCompatible: true,
      staleCatalogDetected: true
    }
  };
}
