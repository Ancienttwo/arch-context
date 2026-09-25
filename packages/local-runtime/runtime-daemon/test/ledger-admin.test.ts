import { rmSync, tempRepo, removeTempRepo, readText, createStartedTestDaemon } from "./runtime-test-fixtures";
import { afterAll, describe, expect, test } from "bun:test";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";

const PREVIOUS_ARCHCONTEXT_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const RUNTIME_TEST_STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-ledger-admin-state-"));
process.env.ARCHCONTEXT_STATE_DIR = RUNTIME_TEST_STATE_ROOT;
afterAll(() => {
  if (PREVIOUS_ARCHCONTEXT_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_ARCHCONTEXT_STATE_DIR;
  rmSync(RUNTIME_TEST_STATE_ROOT, { recursive: true, force: true });
});

describe("daemon ledger admin", () => {
  test("ledger project restores missing Git projection from SQLite current state", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        architectureLedger: { rolloutMode: "ledger-authoritative" },
        clock: () => "2026-06-25T04:05:00.000Z"
      });
      await daemon.init(root, "Ledger Project App");
      const path = ".archcontext/model/nodes/module.ledger-project.yaml";
      const plan = await daemon.planUpdate(root, {
        id: "changeset.ledger-project-node",
        operations: [{
          op: "create_entity",
          path,
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v2\nid: module.ledger-project\nkind: module\nname: Ledger Project\nstatus: active\nsummary: Ledger project node\n"
        }]
      });
      await daemon.applyUpdate(root, {
        id: "changeset.ledger-project-node",
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      });
      rmSync(join(root, path), { force: true });

      const drift = await daemon.ledgerDrift(root);
      expect((drift.data as any).drift.reasonCodes).toContain("projection-file-missing");
      expect((drift.data as any).reconcile.schemaVersion).toBe("archcontext.architecture-ledger-reconcile/v1");
      expect((drift.data as any).reconcile.ledgerToGit.reasonCodes).toContain("projection-file-missing");
      expect((drift.data as any).reconcile.gitToLedger.reasonCodes).toContain("semantic-drift");
      expect((drift.data as any).reconcile.reconcileActions.map((action: any) => action.authority)).toContain("ledger");
      const status = await daemon.runtimeStatus(root);
      const project = await daemon.ledgerProject(root, {
        dryRun: false,
        expectedWorktreeDigest: (status.data as any).worktreeDigest
      });

      expect(project.ok).toBe(true);
      expect((project.data as any).writes).toBe("git-projection");
      expect((project.data as any).writtenPaths).toContain(path);
      expect((project.data as any).reconcile.ok).toBe(true);
      expect(readText(join(root, path))).toContain("module.ledger-project");
      expect([...store.changeSetJournals.values()].some((journal) =>
        journal.status === "committed" && journal.files.some((file) => file.path === path)
      )).toBe(true);
      const cleanDrift = await daemon.ledgerDrift(root);
      expect((cleanDrift.data as any).drift.ok).toBe(true);
      expect((cleanDrift.data as any).reconcile.ok).toBe(true);
    } finally {
      removeTempRepo(root);
    }
  });

  test("ledger project write deletes managed YAML the ledger no longer projects", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        architectureLedger: { rolloutMode: "ledger-authoritative" },
        clock: () => "2026-06-25T04:06:00.000Z"
      });
      await daemon.init(root, "Ledger Project Removal App");
      const keptPath = ".archcontext/model/nodes/module.ledger-project.yaml";
      const staleNodePath = ".archcontext/model/nodes/module.project-stale.yaml";
      const staleRelationPath = ".archcontext/model/relations/relation.project-stale.yaml";
      const staleConstraintPath = ".archcontext/model/constraints/constraint.project-stale.yaml";
      const plan = await daemon.planUpdate(root, {
        id: "changeset.ledger-project-removal-node",
        operations: [{
          op: "create_entity",
          path: keptPath,
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v2\nid: module.ledger-project\nkind: module\nname: Ledger Project\nstatus: active\nsummary: Ledger project node\n"
        }]
      });
      await daemon.applyUpdate(root, {
        id: "changeset.ledger-project-removal-node",
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      });
      const manifestBefore = readText(join(root, ".archcontext/manifest.yaml"));
      writeStaleLedgerProjection(root);

      const dryRun = await daemon.ledgerProject(root, { dryRun: true });
      expect(dryRun.ok).toBe(true);
      expect((dryRun.data as any).drift.ok).toBe(false);
      expect(existsSync(join(root, staleNodePath))).toBe(true);

      const status = await daemon.runtimeStatus(root);
      const project = await daemon.ledgerProject(root, {
        dryRun: false,
        expectedWorktreeDigest: (status.data as any).worktreeDigest
      });

      expect(project.ok).toBe(true);
      expect((project.data as any).writtenPaths).toContain(keptPath);
      expect(((project.data as any).removedPaths as string[]).slice().sort())
        .toEqual([staleConstraintPath, staleNodePath, staleRelationPath].slice().sort());
      expect(existsSync(join(root, staleNodePath))).toBe(false);
      expect(existsSync(join(root, staleRelationPath))).toBe(false);
      expect(existsSync(join(root, staleConstraintPath))).toBe(false);
      expect(readText(join(root, keptPath))).toContain("module.ledger-project");
      expect(readText(join(root, ".archcontext/manifest.yaml"))).toBe(manifestBefore);
      expect((project.data as any).drift.ok).toBe(true);
      expect((project.data as any).reconcile.ok).toBe(true);
      expect([...store.changeSetJournals.values()].some((journal) =>
        journal.status === "committed"
        && journal.files.some((file) => file.path === staleNodePath && file.operation === "delete_entity")
      )).toBe(true);

      const cleanDrift = await daemon.ledgerDrift(root);
      expect((cleanDrift.data as any).drift.ok).toBe(true);
    } finally {
      removeTempRepo(root);
    }
  });

  test("ledger project write refuses to delete an obsolete target that changed concurrently", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        architectureLedger: { rolloutMode: "ledger-authoritative" },
        clock: () => "2026-06-25T04:07:00.000Z"
      });
      await daemon.init(root, "Ledger Project Race App");
      const keptPath = ".archcontext/model/nodes/module.ledger-project.yaml";
      const staleNodePath = ".archcontext/model/nodes/module.project-stale.yaml";
      const staleRelationPath = ".archcontext/model/relations/relation.project-stale.yaml";
      const plan = await daemon.planUpdate(root, {
        id: "changeset.ledger-project-race-node",
        operations: [{
          op: "create_entity",
          path: keptPath,
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v2\nid: module.ledger-project\nkind: module\nname: Ledger Project\nstatus: active\nsummary: Ledger project node\n"
        }]
      });
      await daemon.applyUpdate(root, {
        id: "changeset.ledger-project-race-node",
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      });
      writeStaleLedgerProjection(root);

      const status = await daemon.runtimeStatus(root);
      writeFileSync(
        join(root, staleNodePath),
        "schemaVersion: archcontext.node/v2\nid: module.project-stale\nkind: module\nname: Stale Project\nstatus: active\nsummary: Edited after the projection was planned\n",
        "utf8"
      );

      await expect(daemon.ledgerProject(root, {
        dryRun: false,
        expectedWorktreeDigest: (status.data as any).worktreeDigest
      })).rejects.toThrow("Worktree digest changed before ledger project --to-git");

      expect(readText(join(root, staleNodePath))).toContain("Edited after the projection was planned");
      expect(existsSync(join(root, staleRelationPath))).toBe(true);
    } finally {
      removeTempRepo(root);
    }
  });

  test("ledger rollback restores YAML authority projection from SQLite current state with backup", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        architectureLedger: { rolloutMode: "ledger-authoritative" },
        clock: () => "2026-06-25T04:08:00.000Z"
      });
      await daemon.init(root, "Ledger Rollback App");
      const path = ".archcontext/model/nodes/module.ledger-rollback.yaml";
      const stalePath = ".archcontext/model/nodes/module.rollback-stale.yaml";
      const plan = await daemon.planUpdate(root, {
        id: "changeset.ledger-rollback-node",
        operations: [{
          op: "create_entity",
          path,
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v2\nid: module.ledger-rollback\nkind: module\nname: Ledger Rollback\nstatus: active\nsummary: Ledger rollback node\n"
        }]
      });
      await daemon.applyUpdate(root, {
        id: "changeset.ledger-rollback-node",
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      });
      writeFileSync(join(root, path), "schemaVersion: archcontext.node/v2\nid: module.ledger-rollback\nkind: module\nname: Ledger Rollback\nstatus: active\nsummary: Corrupted rollback projection\n", "utf8");
      writeFileSync(join(root, stalePath), "schemaVersion: archcontext.node/v2\nid: module.rollback-stale\nkind: module\nname: Stale Rollback\nstatus: active\nsummary: Stale rollback projection\n", "utf8");

      const dryRun = await daemon.ledgerRollback(root, { toYaml: true, dryRun: true });
      expect(dryRun.ok).toBe(true);
      expect((dryRun.data as any).dryRun).toBe(true);
      expect((dryRun.data as any).writes).toBe("none");
      expect((dryRun.data as any).drift.ok).toBe(false);
      expect(existsSync(join(root, stalePath))).toBe(true);

      const status = await daemon.runtimeStatus(root);
      const rollback = await daemon.ledgerRollback(root, {
        toYaml: true,
        dryRun: false,
        expectedWorktreeDigest: (status.data as any).worktreeDigest
      });

      expect(rollback.ok).toBe(true);
      expect((rollback.data as any).targetAuthority).toBe("yaml");
      expect((rollback.data as any).recommendedEnvironment).toMatchObject({ ARCHCONTEXT_LEDGER_MODE: "yaml" });
      expect((rollback.data as any).removedPaths).toContain(stalePath);
      expect((rollback.data as any).writtenPaths).toContain(path);
      expect((rollback.data as any).drift.ok).toBe(true);
      const backup = (rollback.data as any).backup;
      expect(backup.path).toMatch(/\.archcontext\/backups\/ledger-rollback\//);
      expect(existsSync(join(root, backup.manifestPath))).toBe(true);
      expect(readText(join(root, backup.path, "model/nodes/module.ledger-rollback.yaml"))).toContain("Corrupted rollback projection");
      expect(readText(join(root, backup.path, "model/nodes/module.rollback-stale.yaml"))).toContain("Stale rollback projection");
      expect(readText(join(root, path))).toContain("Ledger rollback node");
      expect(existsSync(join(root, stalePath))).toBe(false);
      expect([...store.changeSetJournals.values()].some((journal) =>
        journal.status === "committed"
        && journal.files.some((file) => file.path === stalePath && file.operation === "delete_entity")
        && journal.files.some((file) => file.path.includes(".archcontext/backups/ledger-rollback/"))
      )).toBe(true);

      const yamlDaemon = await createStartedTestDaemon({
        architectureLedger: { rolloutMode: "yaml" },
        localStore: new TestLocalStore()
      });
      expect((await yamlDaemon.validate(root)).ok).toBe(true);
    } finally {
      removeTempRepo(root);
    }
  });

  test("ledger migrate write creates a backup, verifies replay, and advertises safe downgrade", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        architectureLedger: { rolloutMode: "yaml" },
        clock: () => "2026-06-26T08:00:00.000Z"
      });
      await daemon.init(root, "Ledger Migrate App");

      const dryRun = await daemon.ledgerMigrate(root, { fromYaml: true, dryRun: true });
      expect(dryRun.ok).toBe(true);
      expect((dryRun.data as any)).toMatchObject({
        schemaVersion: "archcontext.runtime-architecture-ledger-migrate/v1",
        status: "planned",
        dryRun: true,
        writes: "none",
        backup: { status: "not-created", reason: "dry-run" },
        append: { status: "not-applied" },
        verification: { status: "not-run", reason: "dry-run" }
      });
      expect((dryRun.data as any).architectureLedger.phaseFlags.safeDowngrade.environment).toMatchObject({
        ARCHCONTEXT_LEDGER_MODE: "yaml"
      });

      const status = await daemon.runtimeStatus(root);
      const migrated = await daemon.ledgerMigrate(root, {
        fromYaml: true,
        dryRun: false,
        expectedWorktreeDigest: (status.data as any).worktreeDigest
      });

      expect(migrated.ok).toBe(true);
      expect((migrated.data as any)).toMatchObject({
        schemaVersion: "archcontext.runtime-architecture-ledger-migrate/v1",
        status: "verified",
        dryRun: false,
        writes: "architecture-ledger",
        backup: {
          schemaVersion: "archcontext.runtime-architecture-ledger-sqlite-backup/v1",
          status: "created",
          integrity: "ok"
        },
        append: {
          status: "appended",
          appendedEventCount: 1
        },
        verification: {
          schemaVersion: "archcontext.runtime-architecture-ledger-migration-verification/v1",
          ok: true,
          driftOk: true,
          reconcileOk: true
        },
        recommendedEnvironment: {
          ARCHCONTEXT_LEDGER_MODE: "dual"
        }
      });
      expect(existsSync((migrated.data as any).backup.backupPath)).toBe(true);
      expect((migrated.data as any).rollback).toMatchObject({
        command: "archctx ledger rollback --to-yaml --write --expected-worktree-digest <current>",
        safeDowngradeEnvironment: {
          ARCHCONTEXT_LEDGER_MODE: "yaml"
        }
      });
      expect((migrated.data as any).verification.graphDigest).toBe((migrated.data as any).graphDigest);
      expect(store.architectureEventAppends.at(-1)?.events[0]?.eventType).toBe("architecture.yaml.import");
    } finally {
      removeTempRepo(root);
    }
  });

  test("ledger rebuild from Git appends once and no-ops when current state already matches Git", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T04:10:00.000Z"
      });
      await daemon.init(root, "Ledger Rebuild App");
      const status = await daemon.runtimeStatus(root);
      const first = await daemon.ledgerRebuild(root, {
        fromGit: true,
        expectedWorktreeDigest: (status.data as any).worktreeDigest
      });
      const second = await daemon.ledgerRebuild(root, {
        fromGit: true,
        expectedWorktreeDigest: (status.data as any).worktreeDigest
      });

      expect(first.ok).toBe(true);
      expect((first.data as any).appendedEventCount).toBe(1);
      expect((first.data as any).graphDigest).toMatch(/^sha256:/);
      expect((second.data as any).appendedEventCount).toBe(0);
      expect((second.data as any).duplicateEventCount).toBe(0);
      expect(((await daemon.ledgerState(root)).data as any).yaml.importedCount).toBeGreaterThan(0);
    } finally {
      removeTempRepo(root);
    }
  });

  test("committed ledger append remains successful when derived feed drain is deferred", async () => {
    class DeferredFeedStore extends TestLocalStore {
      failFeedDrain = true;

      override async listArchitectureChangeFeed(input: Parameters<TestLocalStore["listArchitectureChangeFeed"]>[0]): ReturnType<TestLocalStore["listArchitectureChangeFeed"]> {
        if (this.failFeedDrain) throw new Error("fixture-derived-feed-unavailable");
        return super.listArchitectureChangeFeed(input);
      }
    }

    const root = tempRepo();
    const store = new DeferredFeedStore();
    try {
      const daemon = await createStartedTestDaemon({ localStore: store, clock: () => "2026-07-12T06:05:00.000Z" });
      await daemon.init(root, "Deferred Feed App");
      const status = await daemon.runtimeStatus(root);
      const rebuild = await daemon.ledgerRebuild(root, {
        fromGit: true,
        expectedWorktreeDigest: (status.data as any).worktreeDigest
      });

      expect(rebuild.ok).toBe(true);
      expect((rebuild.data as any).appendedEventCount).toBe(1);
      expect(store.architectureChangeFeed).toHaveLength(1);
      expect(daemon.status().architectureChangeFeed).toMatchObject({ deferredScopeCount: 1 });
      expect(daemon.status().architectureChangeFeed.failureDigests[0]).toMatch(/^sha256:[0-9a-f]{64}$/);

      store.failFeedDrain = false;
      const projection = await daemon.explorerProjectionV2(root, {
        schemaVersion: "archcontext.explorer-projection-query/v2",
        viewId: "system-map",
        semanticLevel: "context",
        depth: 1,
        budget: { maxNodes: 5, maxRelations: 5 }
      });
      expect(projection.ok).toBe(true);
      expect(daemon.status().architectureChangeFeed).toEqual({ deferredScopeCount: 0, failureDigests: [] });
      expect(Math.max(...[...store.architectureChangeFeedConsumers.values()].map((consumer) => consumer.checkpoint), 0)).toBe(1);
    } finally {
      removeTempRepo(root);
    }
  });

  test("ledger rebuild from Git proposes external projection changes before explicit reconcile", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        architectureLedger: { rolloutMode: "ledger-authoritative" },
        clock: () => "2026-06-25T04:15:00.000Z"
      });
      await daemon.init(root, "Ledger Delete Rebuild App");
      const path = ".archcontext/model/nodes/module.rebuild-delete.yaml";
      const plan = await daemon.planUpdate(root, {
        id: "changeset.rebuild-delete-node",
        operations: [{
          op: "create_entity",
          path,
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v2\nid: module.rebuild-delete\nkind: module\nname: Rebuild Delete\nstatus: active\nsummary: Rebuild delete node\n"
        }]
      });
      await daemon.applyUpdate(root, {
        id: "changeset.rebuild-delete-node",
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      });
      expect(((await daemon.ledgerState(root)).data as any).state.entities.map((entity: any) => entity.entityId)).toContain("module.rebuild-delete");

      rmSync(join(root, path), { force: true });
      const status = await daemon.runtimeStatus(root);
      const proposed = await daemon.ledgerRebuild(root, {
        fromGit: true,
        expectedWorktreeDigest: (status.data as any).worktreeDigest
      });

      expect(proposed.ok).toBe(true);
      expect((proposed.data as any).status).toBe("external-projection-proposed");
      expect((proposed.data as any).reconcileRequired).toBe(true);
      expect((proposed.data as any).appendedEventCount).toBe(1);
      expect((proposed.data as any).proposedExternalProjectionChange).toMatchObject({
        baseGraphDigest: expect.stringMatching(/^sha256:/),
        proposedGraphDigest: expect.stringMatching(/^sha256:/)
      });
      expect(((await daemon.ledgerState(root)).data as any).state.entities.map((entity: any) => entity.entityId)).toContain("module.rebuild-delete");

      const accepted = await daemon.ledgerRebuild(root, {
        fromGit: true,
        acceptExternalProjection: true,
        expectedWorktreeDigest: (status.data as any).worktreeDigest
      });
      expect(accepted.ok).toBe(true);
      expect((accepted.data as any).status).toBe("external-projection-accepted");
      expect(((await daemon.ledgerState(root)).data as any).state.entities.map((entity: any) => entity.entityId)).not.toContain("module.rebuild-delete");
    } finally {
      removeTempRepo(root);
    }
  });

});

/**
 * Managed node, relation, and constraint YAML that the ledger does not know about, standing in for
 * the projection a retired subject leaves behind. The relation and constraint reference
 * `module.ledger-project` so the model stays valid both before and after the stale files are removed.
 */
function writeStaleLedgerProjection(root: string): void {
  mkdirSync(join(root, ".archcontext/model/relations"), { recursive: true });
  mkdirSync(join(root, ".archcontext/model/constraints"), { recursive: true });
  writeFileSync(
    join(root, ".archcontext/model/nodes/module.project-stale.yaml"),
    "schemaVersion: archcontext.node/v2\nid: module.project-stale\nkind: module\nname: Stale Project\nstatus: active\nsummary: Stale projection node\n",
    "utf8"
  );
  writeFileSync(
    join(root, ".archcontext/model/relations/relation.project-stale.yaml"),
    "schemaVersion: archcontext.relation/v1\nid: relation.project-stale\nkind: calls\nsource: module.ledger-project\ntarget: module.project-stale\nprotocol: HTTP\nintent: Stale projection relation\n",
    "utf8"
  );
  writeFileSync(
    join(root, ".archcontext/model/constraints/constraint.project-stale.yaml"),
    "schemaVersion: archcontext.constraint/v1\nid: constraint.project-stale\nname: Stale projection constraint\nseverity: warning\nscope:\n  nodes: [\"module.ledger-project\"]\nrule:\n  type: require-owner\nrationale: Stale projection constraint\n",
    "utf8"
  );
}

