import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl10ReleasePackagingReadback } from "./architecture-ledger-al10-release-packaging-readback";

describe("AL10 release packaging readback evidence", () => {
  test("accepts a complete release packaging packet", () => {
    const result = inspectArchitectureLedgerAl10ReleasePackagingReadback(completePacket());

    expect(result.ok).toBe(true);
    expect(result.status).toBe("verified");
    const gates = result.gates as Record<string, string>;
    expect(gates["AL10-10"]).toBe("verified");
    expect(gates["AL10-11"]).toBe("verified");
  });

  test("rejects an incomplete migration compatibility matrix", () => {
    const packet = completePacket();
    packet.migrationMatrix = packet.migrationMatrix.filter((row: any) => row.id !== "pre-ledger-0005");
    packet.migrationMatrix[0].integrity = "not ok";
    packet.migrationMatrix[0].passed = false;
    packet.migrationMatrix[0].missingMigrations = ["0009_architecture_ledger_search_fts"];
    packet.assertions["AL10-10"] = false;
    packet.assertions.sqliteIntegrityClean = false;
    packet.assertions.migrationMatrixCoversFreshAndIncremental = false;

    const result = inspectArchitectureLedgerAl10ReleasePackagingReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("migrationMatrix must include 6 supported states");
    expect(result.failures).toContain("migrationMatrix missing pre-ledger-0005");
    expect(result.failures).toContain("fresh-empty: migration must pass");
    expect(result.failures).toContain("fresh-empty: integrity must be ok");
    expect(result.failures).toContain("fresh-empty: missing migrations 0009_architecture_ledger_search_fts");
    expect(result.failures).toContain("assertions.AL10-10 must be true");
  });

  test("rejects a packaged CLI with a conflicting bin and missing release contract signatures", () => {
    const packet = completePacket();
    const hookGroup = packet.releasePackage.bundleSignatures.find((group: any) => group.id === "hooks");
    hookGroup.passed = false;
    hookGroup.presentCount = 3;
    hookGroup.missing = ["archcontext.hook-enqueue-fail-open/v1", "jobsEnqueueGitHook"];
    packet.releasePackage.package.bin.codegraph = "./bin/codegraph.mjs";
    packet.releasePackage.packageFiles.push("bin/codegraph.mjs");
    packet.releasePackage.assertions.bundleIncludesHooks = false;
    packet.releasePackage.assertions.packagedCliIncludesRequiredFiles = false;
    packet.assertions["AL10-11"] = false;

    const result = inspectArchitectureLedgerAl10ReleasePackagingReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("release package bin must expose only archctx");
    expect(result.failures).toContain("package must not include bin/codegraph.mjs");
    expect(result.failures).toContain("bundle signature group failed: hooks: archcontext.hook-enqueue-fail-open/v1,jobsEnqueueGitHook");
    expect(result.failures).toContain("assertions.AL10-11 must be true");
  });

  test("rejects gate overclaim", () => {
    const packet = completePacket();
    packet.gates.push("AL10-12");
    packet.scope.closedGates.push("AL10-12");
    packet.assertions["AL10-12"] = true;

    const result = inspectArchitectureLedgerAl10ReleasePackagingReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("gates must be exactly AL10-10 and AL10-11");
    expect(result.failures).toContain("scope.closedGates must be exactly AL10-10 and AL10-11");
    expect(result.failures).toContain("unexpected gate assertion: AL10-12");
  });
});

function completePacket(): any {
  return {
    schemaVersion: "archcontext.architecture-ledger-al10-release-packaging-readback/v1",
    generatedAt: "1970-01-01T00:00:00.000Z",
    gates: ["AL10-10", "AL10-11"],
    status: "verified",
    scope: {
      closedGates: ["AL10-10", "AL10-11"],
      explicitlyOpen: ["AL10-12", "AL10-GA-1"]
    },
    readbackDigest: `sha256:${"a".repeat(64)}`,
    migrationMatrix: [
      migrationRow("fresh-empty", 0),
      migrationRow("pre-ledger-0005", 5),
      migrationRow("ledger-v1-0006", 6),
      migrationRow("pre-search-fts-0008", 8),
      migrationRow("current-0017", 17),
      migrationRow("current-0018", 18)
    ],
    releasePackage: {
      fg6: {
        ok: true,
        schemaVersion: "archcontext.fg6-npm-release-dry-run/v1",
        taskId: "FG6-release-distribution-dry-run",
        status: "verified"
      },
      package: {
        name: "archctx",
        version: "0.1.3",
        private: false,
        bin: {
          archctx: "./bin/archctx.mjs"
        },
        engines: { node: ">=24 <26" },
        dependencies: {
          "@colbymchenry/codegraph": "1.4.0",
          "@node-rs/jieba": "^2.0.1"
        }
      },
      artifact: {
        artifactDir: "_ops/npm/al10-release-packaging",
        tarball: "archctx-0.1.3.tgz",
        tarballSha256: `sha256:${"b".repeat(64)}`,
        tarballBytes: 1000,
        unpackedBytes: 5000
      },
      bin: {
        path: "bin/archctx.mjs",
        bytes: 5000,
        sha256: `sha256:${"c".repeat(64)}`,
        shebang: "#!/usr/bin/env node"
      },
      packageFiles: ["bin/archctx.mjs", "package.json", "README.md"],
      bundleSignatures: [
        signatureGroup("migrations", 26),
        signatureGroup("hooks", 5),
        signatureGroup("renderers", 5),
        signatureGroup("agent-adapter-contracts", 7)
      ],
      assertions: {
        packagedCliIncludesRequiredFiles: true,
        bundleIncludesMigrations: true,
        bundleIncludesHooks: true,
        bundleIncludesRenderers: true,
        bundleIncludesAgentAdapterContracts: true,
        nodeOnlyRuntime: true,
        packageContentsBounded: true,
        noSourceFilesPackaged: true
      }
    },
    assertions: {
      "AL10-10": true,
      "AL10-11": true,
      migrationMatrixCoversFreshAndIncremental: true,
      currentMigrationIsLatest: true,
      sqliteIntegrityClean: true,
      releaseDryRunVerified: true,
      nodeOnlyPackagedCli: true,
      packageContentsBounded: true,
      noSourceFilesPackaged: true
    },
    failures: []
  };
}

function migrationRow(id: string, fromAppliedCount: number): any {
  return {
    id,
    from: id,
    fromAppliedCount,
    toAppliedCount: 18,
    fromLatestMigrationId: fromAppliedCount === 0 ? null : `000${fromAppliedCount}_migration`,
    toLatestMigrationId: "0018_immutable_evidence_checkpoints",
    fromHasLedgerTables: fromAppliedCount >= 9,
    toHasLedgerTables: true,
    missingTables: [],
    missingMigrations: [],
    integrity: "ok",
    passed: true
  };
}

function signatureGroup(id: string, requiredCount: number): any {
  return {
    id,
    description: id,
    requiredCount,
    presentCount: requiredCount,
    missing: [],
    passed: true
  };
}
