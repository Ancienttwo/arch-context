import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl10RolloutWorkflowReadback } from "./architecture-ledger-al10-rollout-workflow-readback";

describe("AL10 rollout workflow readback evidence", () => {
  test("accepts a complete rollout workflow packet", () => {
    const result = inspectArchitectureLedgerAl10RolloutWorkflowReadback(completePacket());

    expect(result.ok).toBe(true);
    expect(result.status).toBe("verified");
  });

  test("rejects missing backup and downgrade evidence", () => {
    const packet = completePacket();
    packet.assertions["AL10-02"] = false;
    packet.workflow.sqliteBackupCreated = false;
    packet.privacy.rawSourcePersisted = true;
    packet.privacy.forbiddenKeys = ["$.workflow.body"];

    const result = inspectArchitectureLedgerAl10RolloutWorkflowReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("AL10-02 assertion failed");
    expect(result.failures).toContain("privacy forbidden keys present: $.workflow.body");
  });
});

function completePacket(): any {
  return {
    schemaVersion: "archcontext.architecture-ledger-al10-rollout-workflow-readback/v1",
    generatedAt: "1970-01-01T00:00:00.000Z",
    gates: ["AL10-01", "AL10-02"],
    workflow: {
      dryRunPlanned: true,
      writeVerified: true,
      phaseFlagsPresent: true,
      safeDowngradeEnvironmentYaml: true,
      recommendedDualModeAfterMigration: true,
      sqliteBackupCreated: true,
      backupIntegrityOk: true,
      replayIntegrityVerified: true,
      driftCleanAfterMigrate: true,
      appendedImportEvent: true,
      rollbackExecutable: true,
      rollbackCommand: "archctx ledger rollback --to-yaml --write --expected-worktree-digest <current>",
      entityCount: 1,
      graphDigest: `sha256:${"a".repeat(64)}`
    },
    privacy: {
      rawSourcePersisted: false,
      forbiddenKeys: []
    },
    assertions: {
      "AL10-01": true,
      "AL10-02": true
    }
  };
}
