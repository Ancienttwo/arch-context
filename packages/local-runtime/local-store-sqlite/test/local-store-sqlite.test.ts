import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LANDSCAPE_FILE, landscapeYaml } from "@archcontext/core/architecture-domain";
import { digestJson, type ArchitectureEventV1, type Json } from "@archcontext/contracts";
import {
  LOCAL_SQLITE_MIGRATIONS,
  SQLITE_PRAGMAS,
  SqliteLocalStore,
  assertNoSourceStorageSchema,
  inspectLegacyLocalStoreMigration,
  migrateLegacyLocalStoreIfNeeded,
  migrationSql,
  runtimeStatePaths
} from "../src/index";
import { TestLocalStore } from "./factories";

const LEGACY_SQLITE_MIGRATION_TIMEOUT_MS = 30_000;

describe("@archcontext/local-runtime/local-store-sqlite", () => {
  test("migration SQL enables required SQLite safety pragmas", () => {
    const sql = migrationSql();
    expect(sql.slice(0, SQLITE_PRAGMAS.length)).toEqual([...SQLITE_PRAGMAS]);
    expect(sql.some((statement) => statement.includes("repository_sessions"))).toBe(true);
    expect(LOCAL_SQLITE_MIGRATIONS.map((migration) => migration.id)).toEqual([
      "0001_runtime_state",
      "0002_indexes",
      "0003_landscape_state",
      "0004_changeset_journal",
      "0005_external_docs_cache",
      "0006_architecture_ledger"
    ]);
    expect(sql.some((statement) => statement.includes("cross_repo_edges"))).toBe(true);
    expect(sql.some((statement) => statement.includes("changeset_journal"))).toBe(true);
    expect(sql.some((statement) => statement.includes("external_docs_cache"))).toBe(true);
    expect(sql.some((statement) => statement.includes("architecture_events"))).toBe(true);
    expect(sql.some((statement) => statement.includes("architecture_ledger_operations"))).toBe(true);
    expect(sql.some((statement) => statement.includes("architecture_current_graph_view"))).toBe(true);
    expect(() => assertNoSourceStorageSchema(sql)).not.toThrow();
  });

  test("schema guard rejects source or diff storage columns", () => {
    expect(() => assertNoSourceStorageSchema(["CREATE TABLE bad (source_code TEXT NOT NULL)"])).toThrow(
      "source_code"
    );
    expect(() => assertNoSourceStorageSchema(["CREATE TABLE bad (diff_body TEXT NOT NULL)"])).toThrow("diff_body");
  });

  test("runtime state paths use an OS/user-data root partitioned by repository and worktree", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-state-paths-repo-"));
    const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-root-"));
    try {
      const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
      expect(paths.source).toBe("environment");
      expect(paths.stateRoot).toBe(stateRoot);
      expect(paths.storageRepositoryId).toMatch(/^repo\.[0-9a-f]{16}$/);
      expect(paths.storageWorkspaceId).toMatch(/^ws\.[0-9a-f]{16}$/);
      expect(paths.repositoryId).toMatch(/^repo\.[0-9a-f]{16}$/);
      expect(paths.workspaceId).toMatch(/^ws\.[0-9a-f]{16}$/);
      expect(paths.repositoryId).toBe(paths.storageRepositoryId);
      expect(paths.workspaceId).toBe(paths.storageWorkspaceId);
      expect(paths.localStorePath).toBe(join(paths.workspaceStateDir, "runtime.sqlite"));
      expect(paths.daemonConnectionPath).toBe(join(paths.workspaceStateDir, "archctxd.json"));
      expect(paths.legacyLocalStorePath).toBe(join(paths.repositoryRoot, ".archcontext", ".local", "runtime.sqlite"));
      expect(paths.localStorePath.startsWith(root)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  test("runtime state paths use Git common-dir for linked worktrees and worktree root for workspace identity", () => {
    const workspace = mkdtempSync(join(tmpdir(), "archctx-state-git-worktrees-"));
    const repo = join(workspace, "repo");
    const linked = join(workspace, "repo-linked");
    const stateRoot = join(workspace, "state");
    try {
      createCommittedGitRepo(repo);
      git(repo, "worktree", "add", "-b", "linked-fixture", linked);

      const primary = runtimeStatePaths(repo, { ARCHCONTEXT_STATE_DIR: stateRoot });
      const linkedPaths = runtimeStatePaths(linked, { ARCHCONTEXT_STATE_DIR: stateRoot });
      expect(primary.storageRepositoryId).toBe(linkedPaths.storageRepositoryId);
      expect(primary.repositoryAnchor).toBe(linkedPaths.repositoryAnchor);
      expect(primary.storageWorkspaceId).not.toBe(linkedPaths.storageWorkspaceId);
      expect(primary.workspaceStateDir).not.toBe(linkedPaths.workspaceStateDir);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("runtime state paths collapse monorepo subdirectories and isolate sibling repositories", () => {
    const workspace = mkdtempSync(join(tmpdir(), "archctx-state-git-roots-"));
    const repo = join(workspace, "repo");
    const sibling = join(workspace, "sibling");
    const stateRoot = join(workspace, "state");
    try {
      createCommittedGitRepo(repo);
      mkdirSync(join(repo, "packages", "web"), { recursive: true });
      createCommittedGitRepo(sibling);

      const rootPaths = runtimeStatePaths(repo, { ARCHCONTEXT_STATE_DIR: stateRoot });
      const subdirPaths = runtimeStatePaths(join(repo, "packages", "web"), { ARCHCONTEXT_STATE_DIR: stateRoot });
      const siblingPaths = runtimeStatePaths(sibling, { ARCHCONTEXT_STATE_DIR: stateRoot });
      expect(subdirPaths.repositoryRoot).toBe(rootPaths.repositoryRoot);
      expect(subdirPaths.storageRepositoryId).toBe(rootPaths.storageRepositoryId);
      expect(subdirPaths.storageWorkspaceId).toBe(rootPaths.storageWorkspaceId);
      expect(siblingPaths.storageRepositoryId).not.toBe(rootPaths.storageRepositoryId);
      expect(siblingPaths.workspaceStateDir).not.toBe(rootPaths.workspaceStateDir);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test(
    "legacy repo-local SQLite WAL database migrates through staging into the runtime state partition",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "archctx-state-migration-repo-"));
      const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-migration-root-"));
      try {
        const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        await writeTaskState(paths.legacyLocalStorePath, "task_legacy", { migrated: true });

        const migration = migrateLegacyLocalStoreIfNeeded(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        expect(migration.migrated).toBe(true);
        expect(migration.status).toBe("migrated");
        expect(migration.integrityCheck).toMatchObject({ legacy: "ok", staging: "ok", target: "ok" });
        expect(migration.copiedFiles).toEqual([paths.localStorePath]);
        expect(existsSync(migration.markerPath)).toBe(true);
        await expectTaskState(paths.localStorePath, "task_legacy", { migrated: true });
      } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(stateRoot, { recursive: true, force: true });
      }
    },
    LEGACY_SQLITE_MIGRATION_TIMEOUT_MS
  );

  test(
    "partial invalid target is quarantined and migration retries from legacy SQLite",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "archctx-state-partial-target-repo-"));
      const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-partial-target-root-"));
      try {
        const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        await writeTaskState(paths.legacyLocalStorePath, "task_legacy", { recovered: true });
        mkdirSync(dirname(paths.localStorePath), { recursive: true });
        writeFileSync(paths.localStorePath, "partial sqlite target", "utf8");

        const migration = migrateLegacyLocalStoreIfNeeded(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        expect(migration.migrated).toBe(true);
        expect(migration.status).toBe("target-quarantined-and-migrated");
        expect(migration.quarantinedFiles).toHaveLength(1);
        expect(existsSync(migration.quarantinedFiles[0]!)).toBe(true);
        await expectTaskState(paths.localStorePath, "task_legacy", { recovered: true });
      } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(stateRoot, { recursive: true, force: true });
      }
    },
    LEGACY_SQLITE_MIGRATION_TIMEOUT_MS
  );

  test(
    "integrity-valid but schema-incomplete target is quarantined and migration retries from legacy SQLite",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "archctx-state-incomplete-target-repo-"));
      const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-incomplete-target-root-"));
      try {
        const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        await writeTaskState(paths.legacyLocalStorePath, "task_legacy", { recovered: "schema-incomplete-target" });
        await writeIncompleteSqliteTarget(paths.localStorePath);

        const migration = migrateLegacyLocalStoreIfNeeded(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        expect(migration.migrated).toBe(true);
        expect(migration.status).toBe("target-quarantined-and-migrated");
        expect(migration.integrityCheck.target).toBe("ok");
        expect(migration.quarantinedFiles).toHaveLength(1);
        expect(existsSync(migration.quarantinedFiles[0]!)).toBe(true);
        await expectTaskState(paths.localStorePath, "task_legacy", { recovered: "schema-incomplete-target" });
      } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(stateRoot, { recursive: true, force: true });
      }
    },
    LEGACY_SQLITE_MIGRATION_TIMEOUT_MS
  );

  test(
    "valid existing target is not overwritten by stale legacy SQLite",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "archctx-state-existing-target-repo-"));
      const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-existing-target-root-"));
      try {
        const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        await writeTaskState(paths.legacyLocalStorePath, "task_state", { source: "legacy" });
        await writeTaskState(paths.localStorePath, "task_state", { source: "target" });

        const migration = migrateLegacyLocalStoreIfNeeded(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        expect(migration.migrated).toBe(false);
        expect(migration.status).toBe("target-current");
        expect(migration.skippedReason).toBe("target-exists");
        expect(migration.quarantinedFiles).toEqual([]);
        await expectTaskState(paths.localStorePath, "task_state", { source: "target" });
      } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(stateRoot, { recursive: true, force: true });
      }
    },
    LEGACY_SQLITE_MIGRATION_TIMEOUT_MS
  );

  test("active legacy migration lock prevents target quarantine side effects", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-state-active-lock-repo-"));
    const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-active-lock-root-"));
    try {
      const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
      await writeTaskState(paths.legacyLocalStorePath, "task_legacy", { source: "legacy" });
      mkdirSync(dirname(paths.localStorePath), { recursive: true });
      writeFileSync(paths.localStorePath, "malformed target before active-lock check\n", "utf8");
      const lockPath = inspectLegacyLocalStoreMigration(root, { ARCHCONTEXT_STATE_DIR: stateRoot }).lockPath;
      mkdirSync(dirname(lockPath), { recursive: true });
      writeFileSync(lockPath, JSON.stringify({
        schemaVersion: "archcontext.legacy-local-store-migration-lock/v1",
        pid: process.pid,
        root,
        targetLocalStorePath: paths.localStorePath,
        startedAt: "2026-06-23T00:00:00.000Z"
      }), "utf8");

      expect(() => migrateLegacyLocalStoreIfNeeded(root, { ARCHCONTEXT_STATE_DIR: stateRoot })).toThrow(
        "Legacy SQLite migration already in progress"
      );
      expect(readFileSync(paths.localStorePath, "utf8")).toBe("malformed target before active-lock check\n");
      expect(existsSync(join(dirname(paths.localStorePath), "quarantine"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  test("invalid legacy SQLite fails without publishing an empty target", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-state-invalid-legacy-repo-"));
    const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-invalid-legacy-root-"));
    try {
      const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
      mkdirSync(dirname(paths.legacyLocalStorePath), { recursive: true });
      writeFileSync(paths.legacyLocalStorePath, "not sqlite", "utf8");

      expect(() => migrateLegacyLocalStoreIfNeeded(root, { ARCHCONTEXT_STATE_DIR: stateRoot })).toThrow(
        "ArchContext legacy SQLite migration failed"
      );
      expect(existsSync(paths.localStorePath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  test("repo-local legacy SQLite symlink to outside repository is rejected", async () => {
    if (process.platform === "win32") {
      expect(process.platform).toBe("win32");
      return;
    }
    const root = mkdtempSync(join(tmpdir(), "archctx-state-symlink-legacy-repo-"));
    const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-symlink-legacy-root-"));
    const outsideRoot = mkdtempSync(join(tmpdir(), "archctx-state-symlink-outside-"));
    try {
      const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
      const outsideStore = join(outsideRoot, "outside.sqlite");
      await writeTaskState(outsideStore, "task_external", { source: "outside-repo" });
      mkdirSync(dirname(paths.legacyLocalStorePath), { recursive: true });
      symlinkSync(outsideStore, paths.legacyLocalStorePath);

      expect(() => migrateLegacyLocalStoreIfNeeded(root, { ARCHCONTEXT_STATE_DIR: stateRoot })).toThrow(
        "Legacy SQLite source must not be a symbolic link"
      );
      expect(existsSync(paths.localStorePath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(stateRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  test("in-memory store follows snapshot and task state contracts", async () => {
    const store = new TestLocalStore();
    await store.migrate();
    expect([...store.migrations]).toEqual([
      "0001_runtime_state",
      "0002_indexes",
      "0003_landscape_state",
      "0004_changeset_journal",
      "0005_external_docs_cache",
      "0006_architecture_ledger"
    ]);

    const snapshot = {
      repositoryId: "repo.test",
      headSha: "abc123",
      worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    };
    const snapshotId = await store.beginSnapshot(snapshot);
    await store.saveTaskState("task_1", { posture: "normal" });
    await store.saveReviewResult("review_1", { result: "pass" });

    expect(await store.readTaskState("task_1")).toEqual({ posture: "normal" });
    await store.commitSnapshot(snapshotId);
    expect(store.recoverPendingSnapshots()).toBe(0);

    await store.beginSnapshot(snapshot);
    expect(store.recoverPendingSnapshots()).toBe(1);
  });

  test("sqlite changeset journal recovers pending temp writes after reopen", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-changeset-journal-"));
    const dbPath = join(root, "runtime.sqlite");
    const relativePath = ".archcontext/policies/review.yaml";
    const absolutePath = join(root, relativePath);
    const backupPath = `${absolutePath}.archctx-backup`;
    const tempPath = `${absolutePath}.archctx-tmp-test`;
    const original = "schemaVersion: archcontext.policy/v1\nid: policy.original\n";
    try {
      writeRepoFile(root, relativePath, original);
      const first = new SqliteLocalStore(dbPath);
      await first.migrate();
      const journalId = await first.beginChangeSet(root, changeSetDraft("changeset.recover", relativePath));
      renameSync(absolutePath, backupPath);
      writeFileSync(tempPath, "partial write", "utf8");
      await first.recordChangeSetFile(journalId, {
        path: relativePath,
        tempPath,
        backupPath,
        existed: true,
        operation: "update_entity_fields"
      });
      first.close();

      const second = new SqliteLocalStore(dbPath);
      await second.migrate();
      expect(second.recoverPendingChangeSets()).toBe(1);
      expect(readFileSync(absolutePath, "utf8")).toBe(original);
      expect(existsSync(tempPath)).toBe(false);
      expect(existsSync(backupPath)).toBe(false);
      expect(second.recoverPendingChangeSets()).toBe(0);
      second.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("sqlite changeset journal cleans committed backup artifacts after reopen", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-changeset-committed-"));
    const dbPath = join(root, "runtime.sqlite");
    const relativePath = ".archcontext/policies/review.yaml";
    const absolutePath = join(root, relativePath);
    const backupPath = `${absolutePath}.archctx-backup`;
    const tempPath = `${absolutePath}.archctx-tmp-test`;
    try {
      writeRepoFile(root, relativePath, "schemaVersion: archcontext.policy/v1\nid: policy.final\n");
      writeFileSync(backupPath, "old backup", "utf8");
      writeFileSync(tempPath, "old temp", "utf8");
      const first = new SqliteLocalStore(dbPath);
      await first.migrate();
      const journalId = await first.beginChangeSet(root, changeSetDraft("changeset.committed-cleanup", relativePath));
      await first.recordChangeSetFile(journalId, {
        path: relativePath,
        tempPath,
        backupPath,
        existed: true,
        operation: "update_entity_fields"
      });
      await first.commitChangeSet(journalId);
      first.close();

      const second = new SqliteLocalStore(dbPath);
      await second.migrate();
      expect(second.recoverPendingChangeSets()).toBe(0);
      expect(existsSync(absolutePath)).toBe(true);
      expect(existsSync(tempPath)).toBe(false);
      expect(existsSync(backupPath)).toBe(false);
      second.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("sqlite changeset recovery keeps projection when ledger append completed before journal commit", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-changeset-ledger-recover-"));
    const dbPath = join(root, "runtime.sqlite");
    const relativePath = ".archcontext/policies/review.yaml";
    const absolutePath = join(root, relativePath);
    const backupPath = `${absolutePath}.archctx-backup`;
    const tempPath = `${absolutePath}.archctx-tmp-test`;
    const original = "schemaVersion: archcontext.policy/v1\nid: policy.original\n";
    const applied = "schemaVersion: archcontext.policy/v1\nid: policy.applied\n";
    try {
      writeRepoFile(root, relativePath, original);
      const first = new SqliteLocalStore(dbPath);
      await first.migrate();
      const journalId = await first.beginChangeSet(root, changeSetDraft("changeset.ledger-recover", relativePath));
      renameSync(absolutePath, backupPath);
      writeFileSync(absolutePath, applied, "utf8");
      await first.recordChangeSetFile(journalId, {
        path: relativePath,
        tempPath,
        backupPath,
        existed: true,
        operation: "update_entity_fields"
      });
      const event = architectureLedgerEvent(42);
      await first.recordChangeSetLedgerPlan(journalId, { event });
      await first.appendArchitectureEvents({ writer: "runtime-daemon", events: [event] });
      first.close();

      const second = new SqliteLocalStore(dbPath);
      await second.migrate();
      expect(second.recoverPendingChangeSets()).toBe(1);
      expect(readFileSync(absolutePath, "utf8")).toBe(applied);
      expect(existsSync(tempPath)).toBe(false);
      expect(existsSync(backupPath)).toBe(false);
      expect(second.recoverPendingChangeSets()).toBe(0);
      second.close();
      expect(await sqliteScalar(dbPath, "SELECT status FROM changeset_journal WHERE changeset_id = 'changeset.ledger-recover'")).toBe("committed");
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM architecture_events WHERE idempotency_key = 'architecture-ledger-test-42'")).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("sqlite store persists repository session, task state, landscape metadata, and committed snapshots across reopen", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-sqlite-store-"));
    const dbPath = join(root, "runtime.sqlite");
    const snapshot = {
      repositoryId: "repo.test",
      headSha: "abc123",
      worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    };
    const landscape = {
      schemaVersion: "archcontext.landscape/v1" as const,
      id: "landscape.product",
      name: "Product",
      repositories: [
        { repositoryId: "repo.web", numericRepositoryId: 1001, name: "web", role: "frontend" as const }
      ],
      relations: ["relation.web-calls-api"],
      syncPolicy: { mode: "git-worktree-only" as const, archcontextSyncService: "forbidden" as const }
    };
    const relation = {
      schemaVersion: "archcontext.cross-repo-relation/v1" as const,
      id: "relation.web-calls-api",
      kind: "calls" as const,
      source: { repositoryId: "repo.web", nodeId: "module.checkout-ui" },
      target: { repositoryId: "repo.api", nodeId: "module.billing-api" },
      via: { kind: "interface" as const, id: "interface.billing-http" },
      intent: "checkout to billing"
    };

    try {
      const first = new SqliteLocalStore(dbPath);
      await first.migrate();
      const committed = await first.beginSnapshot(snapshot);
      await first.commitSnapshot(committed);
      await first.saveRepositorySession({
        repositoryId: snapshot.repositoryId,
        root,
        headSha: snapshot.headSha,
        worktreeDigest: snapshot.worktreeDigest,
        updatedAt: "2026-06-20T00:00:00.000Z"
      });
      await first.saveTaskState("task_1", { posture: "normal" });
      await first.saveLandscape(landscape);
      await first.saveCrossRepoRelation(relation);
      first.close();

      const second = new SqliteLocalStore(dbPath);
      await second.migrate();
      expect(await second.listRepositorySessions()).toEqual([{
        repositoryId: snapshot.repositoryId,
        root,
        headSha: snapshot.headSha,
        worktreeDigest: snapshot.worktreeDigest,
        updatedAt: "2026-06-20T00:00:00.000Z"
      }]);
      expect(await second.readTaskState("task_1")).toEqual({ posture: "normal" });
      expect(await second.readLandscape("landscape.product")).toEqual(landscape);
      expect(await second.listCrossRepoRelations(landscape)).toEqual([relation]);
      await second.beginSnapshot(snapshot);
      expect(second.recoverPendingSnapshots()).toBe(1);
      second.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rebuilds derived landscape metadata from Git-tracked repo files and CodeGraph indexing", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-landscape-root-"));
    const webRoot = mkdtempSync(join(tmpdir(), "archctx-web-"));
    const apiRoot = mkdtempSync(join(tmpdir(), "archctx-api-"));
    const store = new TestLocalStore();
    try {
      await store.migrate();
      const landscape = {
        schemaVersion: "archcontext.landscape/v1" as const,
        id: "landscape.product",
        name: "Product",
        repositories: [
          { repositoryId: "repo.web", numericRepositoryId: 1001, name: "web", role: "frontend", root: webRoot },
          { repositoryId: "repo.api", numericRepositoryId: 1002, name: "api", role: "runtime", root: apiRoot }
        ],
        relations: ["relation.web-calls-api"],
        syncPolicy: { mode: "git-worktree-only" as const, archcontextSyncService: "forbidden" as const }
      };
      const relation = {
        schemaVersion: "archcontext.cross-repo-relation/v1" as const,
        id: "relation.web-calls-api",
        kind: "calls" as const,
        source: { repositoryId: "repo.web", nodeId: "module.checkout-ui" },
        target: { repositoryId: "repo.api", nodeId: "module.billing-api" },
        via: { kind: "interface" as const, id: "interface.billing-http" },
        intent: "checkout to billing"
      };
      writeRepoFile(root, LANDSCAPE_FILE, landscapeYaml(landscape));
      writeRepoFile(root, ".archcontext/relations/relation.web-calls-api.json", JSON.stringify(relation, null, 2));

      await store.saveLandscape(landscape);
      await store.saveCrossRepoRelation(relation);
      store.clearDerivedLandscapeState();
      expect(await store.readLandscape("landscape.product")).toBeUndefined();
      expect(await store.listCrossRepoRelations()).toEqual([]);

      const indexedRepositories: string[] = [];
      const rebuilt = await store.rebuildDerivedLandscapeState({
        root,
        indexRepository: async (repository) => {
          expect(repository.root).toBe(repository.repositoryId === "repo.web" ? webRoot : apiRoot);
          indexedRepositories.push(repository.repositoryId);
        }
      });

      expect(rebuilt.landscape).toEqual(landscape);
      expect(rebuilt.relations).toEqual([relation]);
      expect(rebuilt.indexedRepositories).toEqual(["repo.web", "repo.api"]);
      expect(rebuilt.digest).toMatch(/^sha256:/);
      expect(indexedRepositories).toEqual(["repo.web", "repo.api"]);
      expect(await store.readLandscape("landscape.product")).toEqual(landscape);
      expect(await store.listCrossRepoRelations(landscape)).toEqual([relation]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(webRoot, { recursive: true, force: true });
      rmSync(apiRoot, { recursive: true, force: true });
    }
  });

  test("rebuild fails when a Git-tracked landscape references missing relation files", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-landscape-root-"));
    const store = new TestLocalStore();
    try {
      await store.migrate();
      writeRepoFile(
        root,
        LANDSCAPE_FILE,
        landscapeYaml({
          schemaVersion: "archcontext.landscape/v1" as const,
          id: "landscape.product",
          name: "Product",
          repositories: [
            { repositoryId: "repo.web", numericRepositoryId: 1001, name: "web", role: "frontend" },
            { repositoryId: "repo.api", numericRepositoryId: 1002, name: "api", role: "runtime" }
          ],
          relations: ["relation.web-calls-api"],
          syncPolicy: { mode: "git-worktree-only" as const, archcontextSyncService: "forbidden" as const }
        })
      );

      await expect(store.rebuildDerivedLandscapeState({ root })).rejects.toThrow("missing relations relation.web-calls-api");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("external docs cache is keyed by provider library version and query digest", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-external-docs-cache-"));
    const store = new SqliteLocalStore(join(root, "runtime.sqlite"));
    try {
      await store.migrate();
      const entry = {
        provider: "context7" as const,
        libraryId: "/facebook/react",
        version: "18.2.0",
        queryDigest: `sha256:${"1".repeat(64)}`,
        contentDigest: `sha256:${"2".repeat(64)}`,
        retrievedAt: "2026-06-24T00:00:00.000Z",
        expiresAt: "2026-07-24T00:00:00.000Z",
        resource: {
          schemaVersion: "archcontext.external-document/v1" as const,
          provider: "context7" as const,
          libraryId: "/facebook/react",
          requestedVersion: "18.2.0",
          resolvedVersion: "18.2.0",
          queryDigest: `sha256:${"1".repeat(64)}`,
          contentDigest: `sha256:${"2".repeat(64)}`,
          retrievedAt: "2026-06-24T00:00:00.000Z",
          expiresAt: "2026-07-24T00:00:00.000Z",
          trust: "external-unverified" as const,
          enforcement: "advisory-only" as const,
          cacheStatus: "fresh" as const,
          uri: `archcontext://external-docs/context7/sha256:${"2".repeat(64)}`,
          byteCount: 34,
          snippets: [{
            title: "React docs",
            contentPreview: "External documentation data only.",
            contentDigest: `sha256:${"2".repeat(64)}`,
            sourceUri: "https://react.dev/reference/react",
            byteCount: 34
          }],
          warning: "untrusted-documentation-data" as const
        }
      };

      await store.saveExternalDocumentation(entry);
      await expect(store.readExternalDocumentation({
        provider: "context7",
        libraryId: "/facebook/react",
        version: "18.2.0",
        queryDigest: `sha256:${"1".repeat(64)}`
      })).resolves.toMatchObject({
        libraryId: "/facebook/react",
        version: "18.2.0",
        resource: { enforcement: "advisory-only" }
      });
      await expect(store.readExternalDocumentationByContentDigest({
        provider: "context7",
        contentDigest: `sha256:${"2".repeat(64)}`
      })).resolves.toMatchObject({
        libraryId: "/facebook/react",
        version: "18.2.0",
        resource: {
          uri: `archcontext://external-docs/context7/sha256:${"2".repeat(64)}`,
          trust: "external-unverified"
        }
      });
      expect(await store.readExternalDocumentation({
        provider: "context7",
        libraryId: "/facebook/react",
        version: "latest",
        queryDigest: `sha256:${"1".repeat(64)}`
      })).toBeUndefined();
      expect(await store.listExternalDocumentation("context7")).toHaveLength(1);
      expect(await store.purgeExternalDocumentation({ provider: "context7", libraryId: "/facebook/react" })).toBe(1);
      expect(await store.listExternalDocumentation("context7")).toHaveLength(0);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("architecture ledger appends, replays, snapshots, compacts, and exposes metadata-only query surfaces", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-architecture-ledger-"));
    const databasePath = join(root, "runtime.sqlite");
    const backupPath = join(root, "ledger-backup.sqlite");
    const store = new SqliteLocalStore(databasePath);
    try {
      await store.migrate();
      const events = Array.from({ length: 1000 }, (_, index) => architectureLedgerEvent(index));
      const appended = await store.appendArchitectureEvents({ writer: "runtime-daemon", events });
      expect(appended.appendedEvents).toHaveLength(1000);
      expect(appended.duplicateEvents).toHaveLength(0);
      expect(appended.entityCount).toBe(1000);
      expect(appended.relationCount).toBe(1);
      expect(appended.constraintCount).toBe(1);

      const duplicate = await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [events[0]!] });
      expect(duplicate.appendedEvents).toHaveLength(0);
      expect(duplicate.duplicateEvents).toHaveLength(1);
      expect(duplicate.entityCount).toBe(1000);

      const materialized = await store.readArchitectureLedgerState(ARCHITECTURE_LEDGER_SCOPE);
      expect(materialized.entities).toHaveLength(1000);
      expect(materialized.relations).toHaveLength(1);
      expect(materialized.constraints).toHaveLength(1);
      await expect(store.readArchitectureLedgerSourceCursor({
        ...ARCHITECTURE_LEDGER_SCOPE,
        cursorId: "cursor.root"
      })).resolves.toMatchObject({
        cursorId: "cursor.root",
        source: "codegraph"
      });
      const replayed = await store.replayArchitectureLedger(ARCHITECTURE_LEDGER_SCOPE);
      expect(replayed.events).toHaveLength(1000);
      expect(replayed.graphDigest).toBe(appended.graphDigest);
      await expect(store.verifyArchitectureLedgerReplay(ARCHITECTURE_LEDGER_SCOPE)).resolves.toMatchObject({
        ok: true,
        eventCount: 1000,
        mismatches: []
      });

      const rebuilt = await store.rebuildArchitectureLedgerCurrentState(ARCHITECTURE_LEDGER_SCOPE);
      expect(rebuilt.graphDigest).toBe(appended.graphDigest);
      const snapshot = await store.createArchitectureLedgerSnapshot({
        ...ARCHITECTURE_LEDGER_SCOPE,
        sourceMode: "ledger-shadow",
        projectionDigest: digestJson({ projection: "test" } as unknown as Json),
        inputDigests: { modelDigest: digestJson({ model: "test" } as unknown as Json) },
        createdAt: "2026-06-25T00:30:00.000Z"
      });
      expect(snapshot.graphDigest).toBe(appended.graphDigest);
      await expect(store.compactArchitectureLedger({
        ...ARCHITECTURE_LEDGER_SCOPE,
        beforeSnapshotId: snapshot.snapshotId
      })).resolves.toEqual({ snapshotId: snapshot.snapshotId, compactedEventCount: 1000 });
      await expect(store.checkArchitectureLedgerIntegrity(ARCHITECTURE_LEDGER_SCOPE)).resolves.toMatchObject({
        ok: true,
        eventCount: 1000,
        snapshotCount: 1,
        failures: []
      });
      await expect(store.backupArchitectureLedger({ backupPath })).resolves.toMatchObject({ backupPath, integrity: "ok" });
      expect(existsSync(backupPath)).toBe(true);
      store.close();

      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_current_graph_view")).toBe(1002);
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM open_recommendations_view")).toBe(1);
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM recent_architecture_changes_view")).toBe(1000);
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM unresolved_evidence_view")).toBe(0);
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_ledger_fts WHERE architecture_ledger_fts MATCH 'root'")).toBeGreaterThan(0);
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_ledger_operations")).toBeGreaterThanOrEqual(5);
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_ledger_operations WHERE rebuild_reason IS NOT NULL")).toBe(1);
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_events WHERE compacted_by_snapshot_id IS NOT NULL")).toBe(1000);
      expect(await sqliteScalar(backupPath, "PRAGMA integrity_check")).toBe("ok");
    } finally {
      store.close();
      removeTempRoot(root);
    }
  }, LEGACY_SQLITE_MIGRATION_TIMEOUT_MS);

  test("architecture ledger rolls back a failed event batch without partial materialization", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-architecture-ledger-rollback-"));
    const databasePath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(databasePath);
    try {
      await store.migrate();
      await expect(store.appendArchitectureEvents({
        writer: "runtime-daemon",
        events: [architectureLedgerEvent(0), architectureLedgerEvent(1)],
        faultAfterEvents: 1
      })).rejects.toThrow("architecture-ledger-fault-injection");
      await expect(store.replayArchitectureLedger(ARCHITECTURE_LEDGER_SCOPE)).resolves.toMatchObject({
        events: [],
        state: { entities: [], relations: [], constraints: [] }
      });
      store.close();
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_events")).toBe(0);
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_entities_current")).toBe(0);
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_ledger_operations")).toBe(0);
    } finally {
      store.close();
      removeTempRoot(root);
    }
  }, LEGACY_SQLITE_MIGRATION_TIMEOUT_MS);
});

const ARCHITECTURE_LEDGER_SCOPE = {
  repository: {
    repositoryId: "repo.architecture-ledger-test",
    storageRepositoryId: "repo.storage.architecture-ledger-test"
  },
  worktree: {
    workspaceId: "workspace.architecture-ledger-test",
    storageWorkspaceId: "workspace.storage.architecture-ledger-test",
    branch: "main",
    headSha: "abc123ledger",
    worktreeDigest: digestJson({ worktree: "architecture-ledger-test" } as unknown as Json)
  }
};

function architectureLedgerEvent(index: number): ArchitectureEventV1 {
  const operations: Record<string, Json>[] = [{
    op: "upsert_entity",
    entity: {
      entityId: `entity.${index}`,
      kind: "module",
      canonicalName: index === 0 ? "root module" : `module ${index}`,
      status: "active",
      path: `src/module-${index}.ts`,
      summary: index === 0 ? "root architecture entrypoint" : `module ${index} summary`,
      metadata: { index }
    }
  }];
  if (index === 1) {
    operations.push(
      {
        op: "upsert_relation",
        relation: {
          relationId: "relation.root-to-worker",
          kind: "calls",
          sourceEntityId: "entity.0",
          targetEntityId: "entity.1",
          status: "active",
          summary: "root delegates to worker",
          metadata: { route: "checkpoint" }
        }
      },
      {
        op: "upsert_constraint",
        constraint: {
          constraintId: "constraint.root-owned",
          kind: "ownership",
          subjectId: "entity.0",
          status: "active",
          severity: "warning",
          summary: "root module has an explicit owner",
          metadata: { owner: "runtime" }
        }
      }
    );
  }

  const provenance = {
    producer: "local-store-sqlite.test",
    command: "bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts",
    inputDigest: digestJson({ event: index } as unknown as Json)
  };
  const payload: Record<string, Json> = {
    summary: index === 0 ? "Append root architecture fact" : `Append architecture fact ${index}`,
    title: index === 0 ? "Root Architecture Decision" : `Architecture Event ${index}`,
    rationale: "Exercise append-only ledger replay without storing source bodies.",
    operations
  };
  if (index === 0) {
    const evidenceDigest = digestJson({ evidence: "root" } as unknown as Json);
    payload.evidenceItems = [{
      schemaVersion: "archcontext.evidence-item/v2",
      evidenceId: "evidence.root",
      kind: "codegraph-summary",
      strength: "observed",
      polarity: "positive",
      origin: "codegraph",
      subject: "entity.0",
      selector: { kind: "symbol", id: "entity.0", path: "src/module-0.ts", startLine: 1, endLine: 12 },
      summary: "root module is observed as the architecture entrypoint",
      coverage: { level: "complete", scope: "architecture-ledger-test" },
      supports: ["recommendation", "checkpoint"],
      provenance,
      createdAt: "2026-06-25T00:00:00.000Z",
      digest: evidenceDigest
    }];
    payload.evidenceBindings = [{
      schemaVersion: "archcontext.evidence-binding/v1",
      bindingId: "binding.root",
      evidenceId: "evidence.root",
      target: { kind: "entity", id: "entity.0" },
      bindingReason: "direct-selector",
      authorityEffect: "checkpoint-eligible",
      createdAt: "2026-06-25T00:00:01.000Z",
      provenance
    }];
    payload.recommendationRuns = [{
      schemaVersion: "archcontext.recommendation-run/v1",
      runId: "recommendation-run.root",
      repository: ARCHITECTURE_LEDGER_SCOPE.repository,
      worktree: ARCHITECTURE_LEDGER_SCOPE.worktree,
      trigger: { level: "L2", source: "checkpoint" },
      engineVersion: "test",
      catalogDigest: digestJson({ catalog: "test" } as unknown as Json),
      inputDigest: digestJson({ input: "test" } as unknown as Json),
      outputDigest: digestJson({ output: "test" } as unknown as Json),
      policyMode: "checkpoint",
      status: "succeeded",
      startedAt: "2026-06-25T00:00:02.000Z",
      completedAt: "2026-06-25T00:00:03.000Z",
      recommendationIds: ["recommendation.root"],
      metrics: { matchCount: 1, evidenceBindingCount: 1, unboundEvidenceCount: 0 }
    }];
    payload.recommendations = [{
      schemaVersion: "archcontext.recommendation/v2",
      recommendationId: "recommendation.root",
      runId: "recommendation-run.root",
      fingerprint: "fingerprint.root",
      subject: "entity.0",
      practiceId: "decision.record-significant-change",
      status: "open",
      confidence: "high",
      enforcement: "checkpoint",
      risk: "medium",
      uncertainty: "low",
      evidenceBindingIds: ["binding.root"],
      explanation: ["Root architecture decision needs durable evidence."],
      createdAt: "2026-06-25T00:00:04.000Z",
      updatedAt: "2026-06-25T00:00:05.000Z"
    }];
    payload.agentJobs = [{
      schemaVersion: "archcontext.agent-job/v1",
      jobId: "agent-job.root",
      status: "queued",
      runnerPort: "codex",
      repository: ARCHITECTURE_LEDGER_SCOPE.repository,
      worktree: ARCHITECTURE_LEDGER_SCOPE.worktree,
      fingerprint: "agent-job-root",
      trigger: { source: "checkpoint", reason: "architecture-ledger-test" },
      budget: { maxRunsPerTask: 1, maxRunsPerRepositoryPerDay: 4 },
      inputDigest: digestJson({ agentInput: "root" } as unknown as Json),
      promptTemplateDigest: digestJson({ prompt: "root" } as unknown as Json),
      stalePolicy: "cancel-on-head-change",
      directMutationAllowed: false,
      queuedAt: "2026-06-25T00:00:06.000Z",
      updatedAt: "2026-06-25T00:00:07.000Z"
    }];
    payload.projectionState = {
      projectionId: "projection.root",
      path: ".archcontext/architecture/root.json",
      projectionDigest: digestJson({ projection: "root" } as unknown as Json)
    };
    payload.sourceCursors = [{
      cursorId: "cursor.root",
      source: "codegraph",
      digest: digestJson({ cursor: "root" } as unknown as Json)
    }];
    payload.waivers = [{
      waiverId: "waiver.root",
      targetKind: "recommendation",
      targetId: "recommendation.root",
      reason: "fixture"
    }];
  }

  return {
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: `architecture_event.${String(index).padStart(4, "0")}`,
    eventType: "architecture.graph.update",
    payloadVersion: "archcontext.architecture-ledger-payload/v1",
    repository: ARCHITECTURE_LEDGER_SCOPE.repository,
    worktree: ARCHITECTURE_LEDGER_SCOPE.worktree,
    baseDigest: digestJson({ base: index } as unknown as Json),
    resultingDigest: digestJson({ result: index } as unknown as Json),
    headSha: ARCHITECTURE_LEDGER_SCOPE.worktree.headSha,
    actor: { kind: "daemon", id: "archctxd" },
    source: "checkpoint",
    timestamp: `2026-06-25T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
    idempotencyKey: `architecture-ledger-test-${index}`,
    provenance,
    payload: payload as unknown as Json
  };
}

async function sqliteScalar(databasePath: string, sql: string): Promise<any> {
  const bunSqlite = await import("bun:sqlite");
  const db = new (bunSqlite as any).Database(databasePath, { readonly: true });
  try {
    const row = db.query(sql).get() as Record<string, unknown> | undefined;
    return row ? Object.values(row)[0] : undefined;
  } finally {
    db.close();
  }
}

function removeTempRoot(root: string): void {
  const maxAttempts = process.platform === "win32" ? 20 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (process.platform !== "win32" || !isTransientWindowsCleanupError(error)) {
        throw error;
      }
      sleepSync(100 + attempt * 50);
    }
  }
  if (isTransientWindowsCleanupError(lastError)) {
    return;
  }
  throw lastError;
}

function isTransientWindowsCleanupError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY";
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

async function writeTaskState(databasePath: string, taskSessionId: string, state: unknown): Promise<void> {
  const store = new SqliteLocalStore(databasePath);
  await store.migrate();
  await store.saveTaskState(taskSessionId, state);
  store.close();
}

async function writeIncompleteSqliteTarget(databasePath: string): Promise<void> {
  mkdirSync(dirname(databasePath), { recursive: true });
  const bunSqlite = await import("bun:sqlite");
  const db = new (bunSqlite as any).Database(databasePath, { create: true });
  try {
    db.exec("CREATE TABLE unrelated_table (id INTEGER PRIMARY KEY, note TEXT)");
    db.exec("INSERT INTO unrelated_table(note) VALUES ('valid-but-incomplete')");
  } finally {
    db.close();
  }
}

async function expectTaskState(databasePath: string, taskSessionId: string, expected: unknown): Promise<void> {
  const store = new SqliteLocalStore(databasePath);
  await store.migrate();
  expect(await store.readTaskState(taskSessionId)).toEqual(expected);
  store.close();
}

function createCommittedGitRepo(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "README.md"), "# fixture\n", "utf8");
  git(root, "init");
  git(root, "add", ".");
  git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture");
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function writeRepoFile(root: string, path: string, body: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, body.endsWith("\n") ? body : `${body}\n`, "utf8");
}

function changeSetDraft(id: string, path: string) {
  return {
    schemaVersion: "archcontext.changeset/v1" as const,
    id,
    status: "approved" as const,
    base: {
      headSha: "abc123",
      worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      modelDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    },
    reason: { taskSessionId: "task.test" },
    operations: [
      {
        op: "update_entity_fields" as const,
        path,
        expectedHash: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        body: "not persisted in journal"
      }
    ],
    preconditions: [],
    postconditions: [],
    requiresConfirmation: true,
    idempotencyKey: `idem_${id}`
  };
}
