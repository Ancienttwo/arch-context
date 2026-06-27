import { expect, test } from "bun:test";
import { inspectArchitectureLedgerAl10ProductionRollbackDrillReadback } from "./architecture-ledger-al10-production-rollback-drill-readback";

test("AL10 production rollback drill readback accepts verified rollback evidence", () => {
  const result = inspectArchitectureLedgerAl10ProductionRollbackDrillReadback(validPacket());
  expect(result.ok).toBe(true);
  expect(result.status).toBe("verified");
});

test("AL10 production rollback drill readback rejects missing YAML recovery", () => {
  const packet = validPacket();
  packet.assertions.rollbackReturnedYaml = false;
  packet.drill.finalMode.rolloutMode = "ledger-authoritative";

  const result = inspectArchitectureLedgerAl10ProductionRollbackDrillReadback(packet);
  expect(result.ok).toBe(false);
  expect(result.failures).toContain("rollbackReturnedYaml assertion failed");
});

function validPacket(): any {
  const assertions = {
    canonicalStatusVerified: true,
    productionEquivalentAccepted: true,
    initialLedgerAuthoritative: true,
    rollbackCommandFreshDigest: true,
    rollbackReturnedYaml: true,
    backupCreated: true,
    validationPassed: true,
    changesetJournalHealthy: true,
    packageBoundaryPassed: true,
    contractTestsPassed: true,
    noDataLoss: true,
    noProjectionDrift: true,
    noOperationalRisk: true,
    privacyClean: true
  };
  return {
    schemaVersion: "archcontext.architecture-ledger-al10-production-rollback-drill-readback/v1",
    gate: "AL10-GA-7",
    status: "verified",
    assertions,
    drill: {
      environment: {
        type: "production-equivalent-staging",
        name: "AL10 temporary Git repository with real SQLite runtime store"
      },
      operator: { id: "codex-local-operator", role: "release-operations" },
      trigger: "production rollback drill",
      initialMode: {
        rolloutMode: "ledger-authoritative",
        readAuthority: "ledger",
        writeAuthority: "ledger"
      },
      rollback: {
        command: "archctx ledger rollback --to-yaml --write --expected-worktree-digest <current>",
        expectedWorktreeDigest: `sha256:${"1".repeat(64)}`
      },
      finalMode: {
        rolloutMode: "yaml",
        readAuthority: "yaml",
        writeAuthority: "yaml"
      }
    }
  };
}
