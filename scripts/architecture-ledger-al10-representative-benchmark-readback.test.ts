import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl10RepresentativeBenchmarkReadback } from "./architecture-ledger-al10-representative-benchmark-readback";

describe("AL10 representative benchmark readback evidence", () => {
  test("accepts a complete representative replay and benchmark packet", () => {
    const result = inspectArchitectureLedgerAl10RepresentativeBenchmarkReadback(completePacket());

    expect(result.ok).toBe(true);
    expect(result.status).toBe("verified");
    const gates = result.gates as Record<string, string>;
    expect(gates["AL10-03"]).toBe("verified");
    expect(gates["AL10-04"]).toBe("verified");
    expect(gates["AL10-BETA-1"]).toBe("verified");
  });

  test("rejects missing metrics, drift and privacy evidence", () => {
    const packet = completePacket();
    packet.fixtures[0].metrics.query.elapsedMs = undefined;
    packet.fixtures[1].assertions.dualModeDriftClean = false;
    packet.assertions["AL10-04"] = false;
    packet.assertions["AL10-BETA-1"] = false;
    packet.privacy.noRawSourceSentinel = false;
    packet.privacy.noForbiddenKeys = false;
    packet.privacy.forbiddenKeys = ["$.fixtures[0].body"];

    const result = inspectArchitectureLedgerAl10RepresentativeBenchmarkReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("small-app: query elapsedMs missing");
    expect(result.failures).toContain("medium-monorepo: dual-mode drift not clean");
    expect(result.failures).toContain("AL10-04 assertion failed");
    expect(result.failures).toContain("AL10-BETA-1 assertion failed");
    expect(result.failures).toContain("raw source sentinel leaked");
    expect(result.failures).toContain("privacy forbidden keys present: $.fixtures[0].body");
  });
});

function completePacket(): any {
  const fixtures = [
    fixture("small-app", "Small App", 10, 9, 2),
    fixture("medium-monorepo", "Medium Monorepo", 54, 105, 6),
    fixture("architecture-heavy-service", "Architecture-Heavy Service", 108, 213, 18)
  ];
  return {
    schemaVersion: "archcontext.architecture-ledger-al10-representative-benchmark-readback/v1",
    generatedAt: "1970-01-01T00:00:00.000Z",
    status: "verified",
    gates: ["AL10-03", "AL10-04", "AL10-BETA-1"],
    thresholds: {
      warmQueryP95Ms: 300,
      hookEnqueueP95Ms: 150,
      checkpointP95Ms: 3000,
      querySamples: 8
    },
    fixtures,
    benchmark: {
      fixtureCount: 3,
      totalEntities: 172,
      totalRelations: 327,
      totalConstraints: 26,
      hookEnqueueP95Ms: 12,
      syncP95Ms: 8,
      warmQueryP95Ms: 20,
      checkpointP95Ms: 30,
      completeP95Ms: 15,
      projectionP95Ms: 25,
      replayP95Ms: 35,
      rollbackP95Ms: 18,
      dualModeDriftCount: 0
    },
    privacy: {
      noRawSourceSentinel: true,
      noForbiddenKeys: true,
      forbiddenKeys: []
    },
    assertions: {
      "AL10-03": true,
      "AL10-04": true,
      "AL10-BETA-1": true,
      warmQueryP95WithinBetaBudget: true,
      hookEnqueueP95WithinBetaBudget: true,
      checkpointP95WithinBetaBudget: true,
      privacyClean: true
    },
    failures: []
  };
}

function fixture(name: string, label: string, entityCount: number, relationCount: number, constraintCount: number): any {
  const metric = { ok: true, elapsedMs: 10, requestId: "ok", digest: `sha256:${"a".repeat(64)}` };
  return {
    name,
    label,
    kind: name,
    repositoryShape: {
      entityCount,
      relationCount,
      constraintCount,
      packageCount: 1,
      changedPath: "src/app/module-0.ts"
    },
    loop: {
      migration: {
        dryRunPlanned: true,
        writeVerified: true,
        recommendedMode: "dual",
        backupCreated: true,
        replayIntegrityVerified: true,
        appendedEventCount: 1,
        graphDigest: `sha256:${"b".repeat(64)}`
      },
      drift: {
        afterMigrate: true,
        afterReplay: true,
        docsAfterProjection: true
      },
      rollback: {
        executable: true,
        targetAuthority: "yaml",
        recommendedMode: "yaml"
      },
      complete: {
        result: "pass",
        pass: true
      },
      hook: {
        enqueued: true,
        failOpen: false
      },
      query: {
        returnsExpectedSubject: true,
        coldMs: 12,
        warmP95Ms: 20,
        sampleCount: 8,
        responseDigest: `sha256:${"c".repeat(64)}`
      }
    },
    metrics: {
      hookEnqueue: metric,
      sync: metric,
      query: metric,
      checkpoint: metric,
      complete: metric,
      projection: metric,
      replay: metric
    },
    privacy: {
      noRawSourceSentinel: true,
      noForbiddenKeys: true,
      forbiddenKeys: []
    },
    assertions: {
      fullLoopComplete: true,
      allRequiredMetricsMeasured: true,
      dualModeDriftClean: true,
      queryWithinBudget: true,
      hookWithinBudget: true,
      checkpointWithinBudget: true,
      noSourceLeak: true
    }
  };
}
