import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl10AuthorityReadback } from "./architecture-ledger-al10-authority-readback";

describe("AL10 local authority readback evidence", () => {
  test("accepts a complete local authority packet", () => {
    const result = inspectArchitectureLedgerAl10AuthorityReadback(completePacket());

    expect(result.ok).toBe(true);
    expect(result.status).toBe("verified");
  });

  test("rejects promotion overclaim and raw body persistence", () => {
    const packet = completePacket();
    packet.assertions.authoritativeDriftClean = false;
    packet.privacy.rawBodiesPersisted = true;
    packet.privacy.forbiddenKeys = ["$.authoritative.rollbackDryRun.projectedFiles", "$.authoritative.rollbackDryRun.projectedFiles[0].body"];
    packet.status = "verified";

    const result = inspectArchitectureLedgerAl10AuthorityReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("assertions.authoritativeDriftClean must be true");
    expect(result.failures).toContain("privacy forbidden keys present: $.authoritative.rollbackDryRun.projectedFiles,$.authoritative.rollbackDryRun.projectedFiles[0].body");
    expect(result.failures).toContain("status cannot be verified when failures exist");
  });

  test("rejects unexpected gate names", () => {
    const packet = completePacket();
    packet.gates = ["AL10-local-authority-readback", "AL10-GA-1"];

    const result = inspectArchitectureLedgerAl10AuthorityReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("gates must be exactly AL10-local-authority-readback");
  });
});

function completePacket(): any {
  return {
    schemaVersion: "archcontext.architecture-ledger-al10-authority-readback/v1",
    generatedAt: "1970-01-01T00:00:00.000Z",
    gates: ["AL10-local-authority-readback"],
    status: "verified",
    scope: {
      closedGates: ["AL10-local-authority-readback"],
      explicitlyOpen: ["production-ga", "hard-enforcement"]
    },
    source: {
      stateRoot: "$TMPDIR/archctx-al10-authority-state-*",
      gitHead: "a".repeat(40),
      initialWorktreeDigest: `sha256:${"1".repeat(64)}`
    },
    migration: {
      status: "verified",
      writes: "architecture-ledger",
      graphDigest: `sha256:${"a".repeat(64)}`,
      previousGraphDigest: `sha256:${"0".repeat(64)}`,
      importedCount: 44,
      ignoredFileCount: 1,
      unsupportedFileCount: 0,
      backupStatus: "created",
      backupIntegrity: "ok",
      appendedEventCount: 1,
      duplicateEventCount: 0,
      entityCount: 1,
      relationCount: 0,
      constraintCount: 0,
      verificationOk: true,
      driftOk: true,
      reconcileOk: true,
      recommendedMode: "dual",
      rollbackCommandTemplate: "archctx ledger rollback --to-yaml --write --expected-worktree-digest <current>"
    },
    sqlite: {
      integrity: "ok",
      schemaMigrationCount: 9,
      architectureEvents: 1,
      architectureEntitiesCurrent: 1,
      architectureRelationsCurrent: 0,
      architectureConstraintsCurrent: 0
    },
    dual: {
      status: status("dual", "yaml", "dual"),
      promotionPreflight: promotion("blocked", false, ["mode-sequence-not-ready:dual->ledger-shadow"], "ledger-shadow"),
      rollbackDryRun: rollback()
    },
    ledgerShadow: {
      status: status("ledger-shadow", "yaml", "dual"),
      promotionPreflight: promotion("ready", true, [], "ledger-authoritative")
    },
    authoritative: {
      expectedEnvironment: {
        ARCHCONTEXT_LEDGER_MODE: "ledger-authoritative",
        ARCHCONTEXT_LEDGER_READ_MODE: "ledger",
        ARCHCONTEXT_LEDGER_WRITE_MODE: "ledger-with-projection"
      },
      status: status("ledger-authoritative", "ledger", "ledger-with-projection"),
      drift: {
        driftOk: true,
        reconcileOk: true,
        semanticDrift: false,
        unsupportedFileCount: 0
      },
      promotionPreflight: {
        ...promotion("already-active", false, ["already-ledger-authoritative"], null),
        sideEffects: { sqliteMutated: false },
        boundary: { productionGaClaimed: false }
      },
      rollbackDryRun: rollback()
    },
    assertions: {
      dualMigrationVerified: true,
      runtimeSqliteCurrent: true,
      dualBlocksAuthoritativeSkip: true,
      dualRollbackDryRunClean: true,
      ledgerShadowReady: true,
      authoritativeReadsFromLedger: true,
      authoritativeDriftClean: true,
      authoritativeAlreadyActivePreflight: true,
      authoritativeRollbackDryRunClean: true,
      noRawBodiesPersisted: true
    },
    privacy: {
      rawBodiesPersisted: false,
      forbiddenKeys: []
    },
    readbackDigest: `sha256:${"b".repeat(64)}`,
    failures: []
  };
}

function status(activePhase: string, readAuthority: string, writeAuthority: string): any {
  return {
    rolloutMode: activePhase,
    activePhase,
    readAuthority,
    writeAuthority,
    worktreeDigest: `sha256:${"2".repeat(64)}`
  };
}

function promotion(statusValue: string, ready: boolean, reasonCodes: string[], nextRequiredPhase: string | null): any {
  return {
    status: statusValue,
    ready,
    targetMode: "ledger-authoritative",
    reasonCodes,
    nextRequiredPhase,
    sideEffects: { sqliteMutated: false },
    boundary: { productionGaClaimed: false }
  };
}

function rollback(): any {
  return {
    sourceAuthority: "ledger",
    targetAuthority: "yaml",
    dryRun: true,
    writes: "none",
    driftOk: true,
    reconcileOk: true
  };
}
