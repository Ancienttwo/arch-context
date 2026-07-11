import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LANDSCAPE_FILE, landscapeYaml } from "@archcontext/core/architecture-domain";
import {
  ARCHITECTURE_EVIDENCE_LIFECYCLE_PAYLOAD_VERSION,
  applyArchitectureLedgerEvidenceEvent,
  architectureLedgerPayload,
  architectureLedgerStateDigest,
  evidenceLifecycleValueDigest,
  normalizeArchitectureLedgerEvent,
  planAuditRunToArchitectureLedgerEvent,
  replayArchitectureLedgerEvents
} from "@archcontext/core/architecture-ledger";
import { ChangeSetEngine } from "@archcontext/core/changeset-engine";
import { canonicalProjectionReadPlanV1, digestJson, type AgentJobV1, type ArchitectureEventV1, type EvidenceBindingV1, type EvidenceItemV2, type EvidenceLifecycleOperationV1, type ExplorerProjectionV2, type Json } from "@archcontext/contracts";
import { initializeArchContextModel, planGeneratedProjection, YamlModelStore } from "@archcontext/local-runtime/model-store-yaml";
import {
  DEFAULT_EXPLORER_PROJECTION_CACHE_POLICY,
  LOCAL_SQLITE_MIGRATIONS,
  SQLITE_PRAGMAS,
  SqliteLocalStore,
  architectureAffectedSubjects,
  assertExplorerProjectionCacheIntegrity,
  assertNoSourceStorageSchema,
  inspectLegacyLocalStoreMigration,
  migrateLegacyLocalStoreIfNeeded,
  migrationSql,
  runtimeStatePaths
} from "../src/index";
import { TestLocalStore } from "./factories";

const LEGACY_SQLITE_MIGRATION_TIMEOUT_MS = 30_000;
const LOCAL_STORE_SLOW_TEST_TIMEOUT_MS = 15_000;

describe("@archcontext/local-runtime/local-store-sqlite", () => {
  test("migration SQL enables required SQLite safety pragmas", () => {
    const sql = migrationSql();
    expect(sql.slice(0, SQLITE_PRAGMAS.length)).toEqual([...SQLITE_PRAGMAS]);
    expect(SQLITE_PRAGMAS).toContain("PRAGMA synchronous = FULL");
    expect(sql.some((statement) => statement.includes("repository_sessions"))).toBe(true);
    expect(LOCAL_SQLITE_MIGRATIONS.map((migration) => migration.id)).toEqual([
      "0001_runtime_state",
      "0002_indexes",
      "0003_landscape_state",
      "0004_changeset_journal",
      "0005_external_docs_cache",
      "0006_architecture_ledger",
      "0007_runtime_job_queue",
      "0008_runtime_job_queue_hardening",
      "0009_architecture_ledger_search_fts",
      "0010_audit_runs",
      "0011_changeset_cleanup_cursor",
      "0012_explorer_projection_index",
      "0013_evidence_lifecycle",
      "0014_architecture_change_feed",
      "0015_snapshot_anchor_v2",
      "0016_manifest_addressed_projection_cache",
      "0017_explorer_cache_lifecycle"
    ]);
    expect(sql.some((statement) => statement.includes("cross_repo_edges"))).toBe(true);
    expect(sql.some((statement) => statement.includes("changeset_journal"))).toBe(true);
    expect(sql.some((statement) => statement.includes("external_docs_cache"))).toBe(true);
    expect(sql.some((statement) => statement.includes("architecture_ledger_search_fts"))).toBe(true);
    expect(sql.some((statement) => statement.includes("architecture_events"))).toBe(true);
    expect(sql.some((statement) => statement.includes("architecture_ledger_operations"))).toBe(true);
    expect(sql.some((statement) => statement.includes("runtime_job_queue"))).toBe(true);
    expect(sql.some((statement) => statement.includes("architecture_current_graph_view"))).toBe(true);
    expect(() => assertNoSourceStorageSchema(sql)).not.toThrow();
  });

  test("evidence lifecycle migration clears pre-manifest Explorer cache rows", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-explorer-cache-migration-"));
    const dbPath = join(root, "runtime.sqlite");
    const db = new Database(dbPath);
    try {
      for (const migration of LOCAL_SQLITE_MIGRATIONS.slice(0, 12)) {
        for (const statement of migration.statements) db.exec(statement);
        db.query("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, "2026-07-11T00:00:00.000Z");
      }
      const digest = `sha256:${"a".repeat(64)}`;
      db.query(
        `INSERT INTO explorer_projection_cache
          (projection_digest, storage_repository_id, storage_workspace_id, view_id, graph_digest, observed_facts_digest,
            view_definition_digest, compiler_version, projection_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(digest, "repo.storage", "workspace.storage", "system-map", digest, digest, digest, "archcontext.explorer-view-compiler/v1", "{}", "2026-07-11T00:00:00.000Z");
      db.query(
        `INSERT INTO explorer_occurrence_dependencies
          (storage_repository_id, storage_workspace_id, projection_digest, occurrence_id, dependency_key)
          VALUES (?, ?, ?, ?, ?)`
      ).run("repo.storage", "workspace.storage", digest, "occurrence.old", "graph:old");
    } finally {
      db.close();
    }
    const store = new SqliteLocalStore(dbPath);
    try {
      await store.migrate();
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM explorer_projection_cache")).toBe(0);
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM explorer_occurrence_dependencies")).toBe(0);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("change feed migration backfills verified historical events and rejects tampered event JSON", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-change-feed-migration-"));
    const dbPath = join(root, "runtime.sqlite");
    const db = new Database(dbPath);
    const normalized = normalizeArchitectureLedgerEvent(architectureEvidenceLifecycleEvent("backfill", []), null);
    const workspaceKey = `ledger-scope:${digestJson({
      storageWorkspaceId: normalized.worktree.storageWorkspaceId,
      branch: normalized.worktree.branch,
      headSha: normalized.worktree.headSha,
      worktreeDigest: normalized.worktree.worktreeDigest
    } as unknown as Json).slice("sha256:".length)}`;
    const storageEventId = `${workspaceKey}:${normalized.eventId}`;
    try {
      for (const migration of LOCAL_SQLITE_MIGRATIONS.slice(0, 13)) {
        for (const statement of migration.statements) db.exec(statement);
        db.query("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, normalized.timestamp);
      }
      db.query(
        `INSERT INTO architecture_events
          (event_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, branch, head_sha,
            worktree_digest, event_type, payload_version, source, actor_kind, actor_id, base_digest, resulting_digest,
            previous_event_hash, event_hash, idempotency_key, payload_json, provenance_json, event_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        storageEventId,
        normalized.repository.repositoryId,
        normalized.repository.storageRepositoryId,
        normalized.worktree.workspaceId,
        workspaceKey,
        normalized.worktree.branch,
        normalized.worktree.headSha,
        normalized.worktree.worktreeDigest,
        normalized.eventType,
        normalized.payloadVersion,
        normalized.source,
        normalized.actor.kind,
        normalized.actor.id,
        normalized.baseDigest,
        normalized.resultingDigest,
        null,
        normalized.eventHash!,
        normalized.idempotencyKey,
        stableJsonFixture(normalized.payload),
        stableJsonFixture(normalized.provenance),
        stableJsonFixture(normalized),
        normalized.timestamp
      );
    } finally {
      db.close();
    }
    const store = new SqliteLocalStore(dbPath);
    try {
      await store.migrate();
      expect(await sqliteScalar(dbPath, "SELECT source_storage_workspace_id AS value FROM architecture_events LIMIT 1"))
        .toBe(normalized.worktree.storageWorkspaceId);
      await expect(store.resolveLatestArchitectureLedgerScope(ARCHITECTURE_LEDGER_SCOPE)).resolves.toEqual(ARCHITECTURE_LEDGER_SCOPE);
      const feed = await store.listArchitectureChangeFeed({ ...ARCHITECTURE_LEDGER_SCOPE, consumerId: "test.migration" });
      expect(feed.records).toHaveLength(1);
      expect(feed.records[0]).toMatchObject({ eventId: normalized.eventId, eventHash: normalized.eventHash, affectedSubjects: [] });
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM architecture_evidence_state_checkpoints")).toBe(1);
      expect(await sqliteScalar(dbPath, "SELECT evidence_state_digest AS value FROM architecture_evidence_state_checkpoints LIMIT 1"))
        .toBe(feed.records[0]!.changedInputDigests.evidenceAfter);
      store.close();

      const incompleteMarkerDb = new Database(dbPath);
      incompleteMarkerDb.prepare("DELETE FROM architecture_change_feed_backfill_state").run();
      incompleteMarkerDb.prepare(
        `INSERT INTO architecture_entities_current
          (storage_repository_id, storage_workspace_id, entity_id, repository_id, workspace_id, branch, head_sha,
            worktree_digest, kind, canonical_name, status, path, summary, metadata_json, last_event_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        normalized.repository.storageRepositoryId,
        workspaceKey,
        "module.corrupt",
        normalized.repository.repositoryId,
        normalized.worktree.workspaceId,
        normalized.worktree.branch,
        normalized.worktree.headSha,
        normalized.worktree.worktreeDigest,
        "module",
        "Corrupt materialized row",
        "active",
        null,
        null,
        "{}",
        storageEventId,
        normalized.timestamp
      );
      incompleteMarkerDb.close();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const incompleteStore = new SqliteLocalStore(dbPath);
        await expect(incompleteStore.migrate()).rejects.toThrow("architecture-change-feed-backfill-materialized-graph-mismatch");
        incompleteStore.close();
      }
      const repairMarkerDb = new Database(dbPath);
      repairMarkerDb.prepare("DELETE FROM architecture_entities_current WHERE entity_id = ?").run("module.corrupt");
      repairMarkerDb.close();
      const repairedStore = new SqliteLocalStore(dbPath);
      await repairedStore.migrate();
      repairedStore.close();

      const tamperedDb = new Database(dbPath);
      tamperedDb.prepare("DELETE FROM architecture_change_feed").run();
      tamperedDb.prepare("DROP TRIGGER architecture_events_immutable_update").run();
      tamperedDb.prepare("UPDATE architecture_events SET event_json = ? WHERE event_id = ?")
        .run(stableJsonFixture({ ...normalized, idempotencyKey: "tampered" }), storageEventId);
      tamperedDb.close();
      const tamperedStore = new SqliteLocalStore(dbPath);
      await expect(tamperedStore.migrate()).rejects.toThrow("architecture-change-feed-backfill-idempotency-key-mismatch");
      tamperedStore.close();
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("snapshot anchor V2 migration removes digest-only V1 rows", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-snapshot-v2-migration-"));
    const dbPath = join(root, "runtime.sqlite");
    const db = new Database(dbPath);
    try {
      for (const migration of LOCAL_SQLITE_MIGRATIONS.slice(0, 14)) {
        for (const statement of migration.statements) db.exec(statement);
        db.query("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, "2026-07-11T00:00:00.000Z");
      }
      const digest = `sha256:${"a".repeat(64)}`;
      db.prepare(
        `INSERT INTO architecture_snapshots
          (snapshot_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, branch, head_sha,
            worktree_digest, source_mode, last_event_id, last_event_hash, graph_digest, projection_digest, entity_count,
            relation_count, constraint_count, input_digests_json, snapshot_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "architecture_snapshot.v1",
        "repo.logical",
        "repo.storage",
        "workspace.logical",
        "workspace.scope",
        "main",
        "a".repeat(40),
        digest,
        "dual",
        "event.storage",
        digest,
        digest,
        digest,
        0,
        0,
        0,
        stableJsonFixture({ modelDigest: digest }),
        stableJsonFixture({ schemaVersion: "archcontext.architecture-snapshot/v1" }),
        "2026-07-11T00:00:00.000Z"
      );
    } finally {
      db.close();
    }
    const store = new SqliteLocalStore(dbPath);
    try {
      await store.migrate();
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM architecture_snapshots")).toBe(0);
      const migratedDb = new Database(dbPath);
      const columns = migratedDb.prepare("PRAGMA table_info(architecture_snapshots)").all().map((row) => String((row as Record<string, unknown>).name));
      const eventColumns = migratedDb.prepare("PRAGMA table_info(architecture_events)").all().map((row) => String((row as Record<string, unknown>).name));
      const immutableTrigger = migratedDb.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'architecture_events_immutable_delete'").get();
      migratedDb.close();
      expect(columns).toEqual(expect.arrayContaining(["snapshot_schema_version", "last_event_sequence", "evidence_digest", "state_digest"]));
      expect(eventColumns).toEqual(expect.arrayContaining(["source_storage_workspace_id", "scope_event_count"]));
      expect(immutableTrigger).toBeDefined();
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("manifest cache migration removes pre-manifest rows and adds exact lookup index", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-manifest-cache-migration-"));
    const dbPath = join(root, "runtime.sqlite");
    const db = new Database(dbPath);
    try {
      for (const migration of LOCAL_SQLITE_MIGRATIONS.slice(0, 15)) {
        for (const statement of migration.statements) db.exec(statement);
        db.query("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, "2026-07-11T00:00:00.000Z");
      }
      const digest = `sha256:${"a".repeat(64)}`;
      db.query(
        `INSERT INTO explorer_projection_cache
          (projection_digest, storage_repository_id, storage_workspace_id, view_id, graph_digest, observed_facts_digest,
            view_definition_digest, compiler_version, projection_json, created_at, invalidated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      ).run(digest, "repo.storage", "workspace.storage", "system-map", digest, digest, digest, "archcontext.explorer-view-compiler/v1", "{}", "2026-07-11T00:00:00.000Z");
    } finally {
      db.close();
    }
    const store = new SqliteLocalStore(dbPath);
    try {
      await store.migrate();
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM explorer_projection_cache")).toBe(0);
      const migratedDb = new Database(dbPath);
      const columns = migratedDb.prepare("PRAGMA table_info(explorer_projection_cache)").all().map((row) => String((row as Record<string, unknown>).name));
      const indexes = migratedDb.prepare("PRAGMA index_list(explorer_projection_cache)").all().map((row) => String((row as Record<string, unknown>).name));
      migratedDb.close();
      expect(columns).toContain("manifest_digest");
      expect(indexes).toContain("idx_explorer_projection_scope_manifest");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("cache lifecycle migration adds bounded accounting, pins, metrics, and startup orphan cleanup", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cache-lifecycle-migration-"));
    const databasePath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(databasePath);
    try {
      await store.migrate();
      const projection = explorerProjectionFixture("orphan-scope-anchor");
      await store.saveExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projection, dependencies: [] });
      store.close();
      const database = new Database(databasePath);
      const columns = database.prepare("PRAGMA table_info(explorer_projection_cache)").all().map((row) => String((row as Record<string, unknown>).name));
      const metricTable = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'explorer_runtime_metrics'").get();
      database.exec("PRAGMA foreign_keys = OFF");
      database.prepare(
        `INSERT INTO explorer_occurrence_dependencies
          (storage_repository_id, storage_workspace_id, projection_digest, occurrence_id, dependency_key)
          VALUES (?, ?, ?, ?, ?)`
      ).run("repo.storage", "orphan.workspace", `sha256:${"f".repeat(64)}`, "occ.orphan", "entity:orphan");
      database.prepare(
        `INSERT INTO explorer_occurrence_dependencies
          (storage_repository_id, storage_workspace_id, projection_digest, occurrence_id, dependency_key)
          VALUES (?, ?, ?, ?, ?)`
      ).run("repo.other", "workspace.other", projection.projectionDigest, "occ.cross-scope", "entity:cross-scope");
      database.close();
      expect(columns).toEqual(expect.arrayContaining(["body_bytes", "last_accessed_at", "access_count", "pinned_until", "pin_reason"]));
      expect(metricTable).toBeDefined();

      const restarted = new SqliteLocalStore(databasePath);
      await restarted.migrate();
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM explorer_occurrence_dependencies")).toBe(0);
      restarted.close();
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("schema guard rejects source or diff storage columns", () => {
    expect(() => assertNoSourceStorageSchema(["CREATE TABLE bad (source_code TEXT NOT NULL)"])).toThrow(
      "source_code"
    );
    expect(() => assertNoSourceStorageSchema(["CREATE TABLE bad (diff_body TEXT NOT NULL)"])).toThrow("diff_body");
  });

  test("Explorer projection cache is digest-addressed, rebuildable, and dependency-scoped", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-explorer-cache-"));
    const store = new SqliteLocalStore(join(root, "runtime.sqlite"));
    try {
      await store.migrate();
      const projection = explorerProjectionFixture();
      await store.saveExplorerProjection({
        ...ARCHITECTURE_LEDGER_SCOPE,
        projection,
        dependencies: [{ occurrenceId: projection.occurrences[0]!.occurrenceId, dependencyKeys: ["entity:module.api", "path:src/api.ts"] }]
      });
      await expect(store.readExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projectionDigest: projection.projectionDigest })).resolves.toEqual(projection);
      await expect(store.readExplorerProjectionByManifest({
        ...ARCHITECTURE_LEDGER_SCOPE,
        manifestDigest: projection.inputManifest.manifestDigest
      })).resolves.toEqual(projection);
      await expect(store.readExplorerProjectionByManifest({
        repository: ARCHITECTURE_LEDGER_SCOPE.repository,
        worktree: { ...ARCHITECTURE_LEDGER_SCOPE.worktree, branch: "other", headSha: "def456ledger" },
        manifestDigest: projection.inputManifest.manifestDigest
      })).resolves.toBeUndefined();
      await expect(store.listAffectedExplorerOccurrences({ ...ARCHITECTURE_LEDGER_SCOPE, dependencyKeys: ["entity:module.api"] })).resolves.toEqual([projection.occurrences[0]!.occurrenceId]);
      await expect(store.listAffectedExplorerOccurrences({ ...ARCHITECTURE_LEDGER_SCOPE, dependencyKeys: ["entity:module.other"] })).resolves.toEqual([]);
      await expect(store.invalidateExplorerOccurrences({ ...ARCHITECTURE_LEDGER_SCOPE, occurrenceIds: [projection.occurrences[0]!.occurrenceId] })).resolves.toBe(2);
      await expect(store.listAffectedExplorerOccurrences({ ...ARCHITECTURE_LEDGER_SCOPE, dependencyKeys: ["entity:module.api"] })).resolves.toEqual([]);
      await expect(store.readExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projectionDigest: projection.projectionDigest })).resolves.toEqual(projection);
      await expect(store.readExplorerProjectionByManifest({
        ...ARCHITECTURE_LEDGER_SCOPE,
        manifestDigest: projection.inputManifest.manifestDigest
      })).resolves.toBeUndefined();
      await expect(store.readLatestExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, viewId: projection.view.id })).resolves.toBeUndefined();
      await expect(store.clearExplorerDerivedState(ARCHITECTURE_LEDGER_SCOPE)).resolves.toBe(1);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("deleting every Explorer cache row cannot change authoritative ledger results", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-explorer-cache-authority-independent-"));
    const store = new SqliteLocalStore(join(root, "runtime.sqlite"));
    try {
      await store.migrate();
      await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [architectureLedgerEvent(0)] });
      const before = await store.replayArchitectureLedger(ARCHITECTURE_LEDGER_SCOPE);
      const projection = explorerProjectionFixture("disposable-cache");
      await store.saveExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projection, dependencies: [] });
      await expect(store.clearExplorerDerivedState(ARCHITECTURE_LEDGER_SCOPE)).resolves.toBe(1);
      const after = await store.replayArchitectureLedger(ARCHITECTURE_LEDGER_SCOPE);
      expect(after.graphDigest).toBe(before.graphDigest);
      expect(after.evidenceState.stateDigest).toBe(before.evidenceState.stateDigest);
      expect(after.cursor).toEqual(before.cursor);
      expect(after.state).toEqual(before.state);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("Explorer latest projection uses insertion order when writes share a timestamp", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-explorer-latest-"));
    const databasePath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(databasePath);
    try {
      await store.migrate();
      const base = explorerProjectionFixture("base");
      const head = explorerProjectionFixture("head");
      await store.saveExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projection: base, dependencies: [] });
      await store.saveExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projection: head, dependencies: [] });

      const database = new Database(databasePath);
      database.prepare("UPDATE explorer_projection_cache SET created_at = ?").run("2026-07-11T00:00:00.000Z");
      database.close();

      await expect(store.readLatestExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, viewId: "system-map" })).resolves.toEqual(head);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("Explorer cache GC retains bounded delta pins and deterministically evicts unpinned LRU rows", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-explorer-cache-gc-"));
    const databasePath = join(root, "runtime.sqlite");
    const policy = {
      schemaVersion: "archcontext.explorer-cache-policy/v1" as const,
      maxEntriesPerScope: 3,
      maxBytesPerScope: 10_000_000,
      maxAgeMs: 60_000,
      maxPinnedEntriesPerScope: 2,
      maxPinTtlMs: 10_000
    };
    let currentNow = "2026-07-11T20:00:04.000Z";
    const store = new SqliteLocalStore(databasePath, policy, () => currentNow);
    try {
      await store.migrate();
      const base = explorerProjectionFixture("base");
      const middle = explorerProjectionFixture("middle");
      const head = explorerProjectionFixture("head");
      await store.saveExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projection: base, dependencies: [] });
      await store.saveExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projection: middle, dependencies: [] });
      await store.saveExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projection: head, dependencies: [] });
      const database = new Database(databasePath);
      database.prepare("UPDATE explorer_projection_cache SET created_at = ?, last_accessed_at = ? WHERE projection_digest = ?")
        .run("2026-07-11T20:00:01.000Z", "2026-07-11T20:00:01.000Z", base.projectionDigest);
      database.prepare("UPDATE explorer_projection_cache SET created_at = ?, last_accessed_at = ? WHERE projection_digest = ?")
        .run("2026-07-11T20:00:02.000Z", "2026-07-11T20:00:02.000Z", middle.projectionDigest);
      database.prepare("UPDATE explorer_projection_cache SET created_at = ?, last_accessed_at = ? WHERE projection_digest = ?")
        .run("2026-07-11T20:00:03.000Z", "2026-07-11T20:00:03.000Z", head.projectionDigest);
      database.close();
      await expect(store.pinExplorerProjections({
        ...ARCHITECTURE_LEDGER_SCOPE,
        projectionDigests: [base.projectionDigest],
        reason: "delta-base",
        expiresAt: "2026-07-12T04:00:09.000+08:00"
      })).resolves.toBe(1);
      currentNow = "2026-07-11T20:00:05.000Z";
      const collected = await store.collectExplorerProjectionCache({
        ...ARCHITECTURE_LEDGER_SCOPE,
        policy: { ...policy, maxEntriesPerScope: 2 }
      });
      expect(collected).toMatchObject({ limitsSatisfied: true, before: { entryCount: 3 }, after: { entryCount: 2, pinnedEntryCount: 1 } });
      expect(collected.evictedProjectionDigests).toEqual([middle.projectionDigest]);
      await expect(store.collectExplorerProjectionCache({
        ...ARCHITECTURE_LEDGER_SCOPE,
        policy: { ...policy, maxBytesPerScope: policy.maxBytesPerScope + 1 }
      })).rejects.toThrow("explorer-cache-policy-cannot-widen-configured-limits");
      await expect(store.readExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projectionDigest: base.projectionDigest })).resolves.toEqual(base);
      await expect(store.readExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projectionDigest: middle.projectionDigest })).resolves.toBeUndefined();
      await expect(store.readExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projectionDigest: head.projectionDigest })).resolves.toEqual(head);

      currentNow = "2026-07-11T20:00:10.000Z";
      const afterExpiry = await store.collectExplorerProjectionCache({
        ...ARCHITECTURE_LEDGER_SCOPE,
        policy: { ...policy, maxEntriesPerScope: 1, maxPinnedEntriesPerScope: 1 }
      });
      expect(afterExpiry.after).toMatchObject({ entryCount: 1, pinnedEntryCount: 0 });
      expect(afterExpiry.limitsSatisfied).toBe(true);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("Explorer save and retention roll back together when GC fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-explorer-cache-atomic-gc-"));
    const databasePath = join(root, "runtime.sqlite");
    const policy = {
      schemaVersion: "archcontext.explorer-cache-policy/v1" as const,
      maxEntriesPerScope: 1,
      maxBytesPerScope: 10_000_000,
      maxAgeMs: 60_000,
      maxPinnedEntriesPerScope: 1,
      maxPinTtlMs: 10_000
    };
    const store = new SqliteLocalStore(databasePath, policy, () => "2026-07-11T20:00:00.000Z");
    try {
      await store.migrate();
      const base = explorerProjectionFixture("atomic-base");
      const head = explorerProjectionFixture("atomic-head");
      await store.saveExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projection: base, dependencies: [] });
      const database = new Database(databasePath);
      database.exec(`CREATE TRIGGER explorer_cache_gc_fault BEFORE DELETE ON explorer_projection_cache
        BEGIN SELECT RAISE(ABORT, 'explorer-cache-gc-fault'); END`);
      database.close();
      await expect(store.saveExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projection: head, dependencies: [] }))
        .rejects.toThrow("explorer-cache-gc-fault");
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM explorer_projection_cache")).toBe(1);
      await expect(store.readExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projectionDigest: base.projectionDigest })).resolves.toEqual(base);
      await expect(store.readExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projectionDigest: head.projectionDigest })).resolves.toBeUndefined();
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("Explorer GC recomputes serialized bytes instead of trusting mutable accounting", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-explorer-cache-byte-accounting-"));
    const databasePath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(databasePath, undefined, () => "2026-07-11T20:00:00.000Z");
    try {
      await store.migrate();
      const projection = explorerProjectionFixture("byte-accounting");
      await store.saveExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projection, dependencies: [] });
      const database = new Database(databasePath);
      database.prepare("UPDATE explorer_projection_cache SET body_bytes = 0 WHERE projection_digest = ?").run(projection.projectionDigest);
      database.close();
      const collected = await store.collectExplorerProjectionCache({
        ...ARCHITECTURE_LEDGER_SCOPE,
        policy: { ...DEFAULT_EXPLORER_PROJECTION_CACHE_POLICY, maxBytesPerScope: 100 }
      });
      expect(collected.before.bodyBytes).toBeGreaterThan(100);
      expect(collected.after).toMatchObject({ entryCount: 0, bodyBytes: 0 });
      expect(collected.limitsSatisfied).toBe(true);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("Explorer cache remains within per-scope count and byte limits after sustained manifest churn and restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-explorer-cache-churn-"));
    const databasePath = join(root, "runtime.sqlite");
    let tick = 0;
    const clock = () => new Date(Date.parse("2026-07-11T20:00:00.000Z") + tick * 1_000).toISOString();
    const store = new SqliteLocalStore(databasePath, DEFAULT_EXPLORER_PROJECTION_CACHE_POLICY, clock);
    try {
      await store.migrate();
      const projections: ExplorerProjectionV2[] = [];
      for (tick = 1; tick <= 160; tick += 1) {
        const projection = explorerProjectionFixture(`churn-${tick}`);
        projections.push(projection);
        await store.saveExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projection, dependencies: [] });
      }
      const stats = await store.readExplorerProjectionCacheStats(ARCHITECTURE_LEDGER_SCOPE);
      expect(stats.entryCount).toBe(DEFAULT_EXPLORER_PROJECTION_CACHE_POLICY.maxEntriesPerScope);
      expect(stats.bodyBytes).toBeLessThanOrEqual(DEFAULT_EXPLORER_PROJECTION_CACHE_POLICY.maxBytesPerScope);
      await expect(store.readExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projectionDigest: projections[0]!.projectionDigest })).resolves.toBeUndefined();
      await expect(store.readExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projectionDigest: projections.at(-1)!.projectionDigest })).resolves.toEqual(projections.at(-1)!);
      store.close();
      const restarted = new SqliteLocalStore(databasePath, DEFAULT_EXPLORER_PROJECTION_CACHE_POLICY, clock);
      await restarted.migrate();
      const restartedStats = await restarted.readExplorerProjectionCacheStats(ARCHITECTURE_LEDGER_SCOPE);
      expect(restartedStats.entryCount).toBe(DEFAULT_EXPLORER_PROJECTION_CACHE_POLICY.maxEntriesPerScope);
      expect(restartedStats.bodyBytes).toBeLessThanOrEqual(DEFAULT_EXPLORER_PROJECTION_CACHE_POLICY.maxBytesPerScope);
      restarted.close();
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("Explorer runtime metrics accept only bounded numeric allow-listed samples", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-explorer-cache-metrics-"));
    const databasePath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(databasePath);
    try {
      await store.migrate();
      await store.recordExplorerRuntimeMetric({ ...ARCHITECTURE_LEDGER_SCOPE, metricName: "compile-time-ms", reasonCode: "projection-compile", value: 12 });
      await store.recordExplorerRuntimeMetric({ ...ARCHITECTURE_LEDGER_SCOPE, metricName: "compile-time-ms", reasonCode: "projection-compile", value: 8 });
      const stats = await store.readExplorerProjectionCacheStats(ARCHITECTURE_LEDGER_SCOPE);
      expect(stats.metrics).toContainEqual(expect.objectContaining({ metricName: "compile-time-ms", reasonCode: "projection-compile", sampleCount: 2, totalValue: 20, maxValue: 12, value: 8 }));
      await expect(store.recordExplorerRuntimeMetric({ ...ARCHITECTURE_LEDGER_SCOPE, metricName: "private-source" as never, reasonCode: "projection-compile", value: 1 }))
        .rejects.toThrow("explorer-runtime-metric-name-invalid");
      await expect(store.recordExplorerRuntimeMetric({ ...ARCHITECTURE_LEDGER_SCOPE, metricName: "cache-hit", reasonCode: "secret-label" as never, value: 1 }))
        .rejects.toThrow("explorer-runtime-metric-reason-invalid");
      await expect(store.recordExplorerRuntimeMetric({ ...ARCHITECTURE_LEDGER_SCOPE, metricName: "cache-hit", reasonCode: "manifest-read", value: Number.NaN }))
        .rejects.toThrow("explorer-runtime-metric-value-invalid");
      await store.recordExplorerRuntimeMetric({ ...ARCHITECTURE_LEDGER_SCOPE, metricName: "cache-hit", reasonCode: "digest-read", value: Number.MAX_SAFE_INTEGER });
      await expect(store.recordExplorerRuntimeMetric({ ...ARCHITECTURE_LEDGER_SCOPE, metricName: "cache-hit", reasonCode: "digest-read", value: 1 }))
        .rejects.toThrow("explorer-runtime-metric-aggregate-overflow");
      await store.recordExplorerRuntimeMetric({
        ...ARCHITECTURE_LEDGER_SCOPE,
        metricName: "cache-miss",
        reasonCode: "manifest-read",
        value: 1,
        recordedAt: "Sat, 11 Jul 2026 12:15:00 GMT (PRIVATE SOURCE BODY secret-token)"
      });
      expect(await sqliteScalar(databasePath, "SELECT updated_at AS value FROM explorer_runtime_metrics WHERE metric_name = 'cache-miss' AND reason_code = 'manifest-read'"))
        .toBe("2026-07-11T12:15:00.000Z");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("startup retention clears invalid and overlong persisted pins before expiry collection", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-explorer-cache-pin-tamper-"));
    const databasePath = join(root, "runtime.sqlite");
    const policy = {
      ...DEFAULT_EXPLORER_PROJECTION_CACHE_POLICY,
      maxEntriesPerScope: 4,
      maxPinnedEntriesPerScope: 2,
      maxAgeMs: 1_000,
      maxPinTtlMs: 10_000
    };
    const clock = () => "2026-07-11T20:00:00.000Z";
    const store = new SqliteLocalStore(databasePath, policy, clock);
    try {
      await store.migrate();
      const invalid = explorerProjectionFixture("invalid-pin");
      const overlong = explorerProjectionFixture("overlong-pin");
      await store.saveExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projection: invalid, dependencies: [] });
      await store.saveExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projection: overlong, dependencies: [] });
      store.close();
      const database = new Database(databasePath);
      database.prepare("UPDATE explorer_projection_cache SET created_at = ?, last_accessed_at = ?, pinned_until = ?, pin_reason = ? WHERE projection_digest = ?")
        .run("2026-07-11T19:59:50.000Z", "2026-07-11T19:59:50.000Z", "zzzz", "delta-base", invalid.projectionDigest);
      database.prepare("UPDATE explorer_projection_cache SET created_at = ?, last_accessed_at = ?, pinned_until = ?, pin_reason = ? WHERE projection_digest = ?")
        .run("2026-07-11T19:59:50.000Z", "2026-07-11T19:59:50.000Z", "2026-07-11T21:00:00.000Z", "delta-head", overlong.projectionDigest);
      database.close();

      const restarted = new SqliteLocalStore(databasePath, policy, clock);
      await restarted.migrate();
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM explorer_projection_cache")).toBe(0);
      restarted.close();
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("manifest-addressed cache rejects corrupted rows and nondeterministic output", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-explorer-manifest-integrity-"));
    const databasePath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(databasePath);
    try {
      await store.migrate();
      const projection = explorerProjectionFixture();
      await store.saveExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projection, dependencies: [] });

      const changed = structuredClone(projection);
      changed.occurrences[0]!.name = "Nondeterministic API";
      const { projectionDigest: _ignored, ...changedWithoutDigest } = changed;
      changed.projectionDigest = digestJson(changedWithoutDigest as unknown as Json);
      await expect(store.saveExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projection: changed, dependencies: [] }))
        .rejects.toThrow("explorer-projection-cache-manifest-conflict");

      const corruptDb = new Database(databasePath);
      const corrupted = structuredClone(projection);
      corrupted.view.title = "Corrupted cache title";
      corruptDb.prepare("UPDATE explorer_projection_cache SET projection_json = ? WHERE manifest_digest = ?")
        .run(stableJsonFixture(corrupted), projection.inputManifest.manifestDigest);
      corruptDb.close();
      await expect(store.readExplorerProjectionByManifest({
        ...ARCHITECTURE_LEDGER_SCOPE,
        manifestDigest: projection.inputManifest.manifestDigest
      })).rejects.toThrow("explorer-projection-cache-integrity-mismatch");

      const schemaPoisoned = structuredClone(projection);
      const schemaSubject = schemaPoisoned.occurrences[0];
      if (!schemaSubject || schemaSubject.role !== "subject") throw new Error("subject fixture required");
      schemaSubject.inspector.sourceSelectors = [{ path: "src/api.ts", memo: "private body" } as never];
      const { projectionDigest: _schemaDigest, ...schemaPoisonedWithoutDigest } = schemaPoisoned;
      schemaPoisoned.projectionDigest = digestJson(schemaPoisonedWithoutDigest as unknown as Json);
      const schemaDb = new Database(databasePath);
      schemaDb.prepare("UPDATE explorer_projection_cache SET projection_digest = ?, projection_json = ? WHERE manifest_digest = ?")
        .run(schemaPoisoned.projectionDigest, stableJsonFixture(schemaPoisoned), projection.inputManifest.manifestDigest);
      schemaDb.close();
      await expect(store.readExplorerProjectionByManifest({
        ...ARCHITECTURE_LEDGER_SCOPE,
        manifestDigest: projection.inputManifest.manifestDigest
      })).rejects.toThrow("explorer-projection-cache-schema-invalid");

      const privacyPoisoned = structuredClone(projection);
      const subject = privacyPoisoned.occurrences[0];
      if (!subject || subject.role !== "subject") throw new Error("subject fixture required");
      subject.name = "diff --git a/private.ts b/private.ts";
      const { projectionDigest: _privacyDigest, ...privacyPoisonedWithoutDigest } = privacyPoisoned;
      privacyPoisoned.projectionDigest = digestJson(privacyPoisonedWithoutDigest as unknown as Json);
      const privacyDb = new Database(databasePath);
      privacyDb.prepare("UPDATE explorer_projection_cache SET projection_digest = ?, projection_json = ? WHERE manifest_digest = ?")
        .run(privacyPoisoned.projectionDigest, stableJsonFixture(privacyPoisoned), projection.inputManifest.manifestDigest);
      privacyDb.close();
      await expect(store.readExplorerProjectionByManifest({
        ...ARCHITECTURE_LEDGER_SCOPE,
        manifestDigest: projection.inputManifest.manifestDigest
      })).rejects.toThrow("explorer-projection-cache-privacy-invalid");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("TestLocalStore enforces production cache scope and body integrity", async () => {
    const store = new TestLocalStore();
    const projection = explorerProjectionFixture();
    await store.saveExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projection, dependencies: [] });
    await expect(store.readExplorerProjectionByManifest({
      repository: { ...ARCHITECTURE_LEDGER_SCOPE.repository, repositoryId: "repo.other-logical-id" },
      worktree: ARCHITECTURE_LEDGER_SCOPE.worktree,
      manifestDigest: projection.inputManifest.manifestDigest
    })).resolves.toBeUndefined();

    const record = store.explorerProjections.get(projection.projectionDigest);
    if (!record) throw new Error("projection fixture must be stored");
    const poisoned = record.projection as ExplorerProjectionV2 & { injected?: string };
    poisoned.injected = "test-double-poison";
    const { projectionDigest: _ignored, ...poisonedWithoutDigest } = poisoned;
    poisoned.projectionDigest = digestJson(poisonedWithoutDigest as unknown as Json);
    await expect(store.readExplorerProjectionByManifest({
      ...ARCHITECTURE_LEDGER_SCOPE,
      manifestDigest: projection.inputManifest.manifestDigest
    })).rejects.toThrow("explorer-projection-cache-schema-invalid");
  });

  test("TestLocalStore rolls back cache dependency pin and metric state when retention telemetry fails", async () => {
    const policy = {
      ...DEFAULT_EXPLORER_PROJECTION_CACHE_POLICY,
      maxEntriesPerScope: 1,
      maxPinnedEntriesPerScope: 1
    };
    const store = new TestLocalStore(policy, () => "2026-07-11T20:00:00.000Z");
    const base = explorerProjectionFixture("test-store-atomic-base");
    const head = explorerProjectionFixture("test-store-atomic-head");
    await store.saveExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projection: base, dependencies: [] });
    await store.recordExplorerRuntimeMetric({
      ...ARCHITECTURE_LEDGER_SCOPE,
      metricName: "cache-eviction",
      reasonCode: "count-pressure",
      value: Number.MAX_SAFE_INTEGER
    });
    await expect(store.saveExplorerProjection({ ...ARCHITECTURE_LEDGER_SCOPE, projection: head, dependencies: [] }))
      .rejects.toThrow("explorer-runtime-metric-aggregate-overflow");
    expect([...store.explorerProjections.keys()]).toEqual([base.projectionDigest]);
    expect(store.explorerCacheMetadata.has(base.projectionDigest)).toBe(true);
    expect(store.explorerCacheMetadata.has(head.projectionDigest)).toBe(false);
    expect(store.explorerRuntimeMetrics).toHaveLength(1);
  });

  test("cache integrity binds cursor authority and canonical view domain policy", () => {
    const ledgerProjection = ledgerExplorerProjectionFixture();
    const divergentCursor = structuredClone(ledgerProjection);
    divergentCursor.cursor.authorityCursor = {
      ...divergentCursor.cursor.authorityCursor!,
      worktree: { ...divergentCursor.cursor.authorityCursor!.worktree, headSha: "b".repeat(40) }
    };
    const { projectionDigest: _cursorDigest, ...divergentCursorWithoutDigest } = divergentCursor;
    divergentCursor.projectionDigest = digestJson(divergentCursorWithoutDigest as unknown as Json);
    expect(() => assertExplorerProjectionCacheIntegrity(divergentCursor, ARCHITECTURE_LEDGER_SCOPE))
      .toThrow("explorer-projection-cache-integrity-mismatch");

    const downgraded = explorerProjectionFixture();
    downgraded.view = { id: "drift-pressure", title: "Drift & Pressure", question: "Where is pressure?" };
    const { projectionDigest: _policyDigest, ...downgradedWithoutDigest } = downgraded;
    downgraded.projectionDigest = digestJson(downgradedWithoutDigest as unknown as Json);
    expect(() => assertExplorerProjectionCacheIntegrity(downgraded, ARCHITECTURE_LEDGER_SCOPE))
      .toThrow("explorer-projection-cache-domain-policy-invalid");

    const unavailableObserved = explorerProjectionFixture();
    unavailableObserved.inputManifest.observedAvailability = { status: "unavailable", reasonCode: "index-missing" };
    const { manifestDigest: _observedManifestDigest, ...unavailableManifestWithoutDigest } = unavailableObserved.inputManifest;
    unavailableObserved.inputManifest.manifestDigest = digestJson(unavailableManifestWithoutDigest as unknown as Json);
    unavailableObserved.cursor.observedAvailability = { status: "unavailable", reasonCode: "index-missing" };
    unavailableObserved.cursor.inputManifestDigest = unavailableObserved.inputManifest.manifestDigest;
    const { projectionDigest: _observedProjectionDigest, ...unavailableObservedWithoutDigest } = unavailableObserved;
    unavailableObserved.projectionDigest = digestJson(unavailableObservedWithoutDigest as unknown as Json);
    expect(() => assertExplorerProjectionCacheIntegrity(unavailableObserved, ARCHITECTURE_LEDGER_SCOPE))
      .toThrow("explorer-projection-cache-integrity-mismatch");

    const tokenMismatch = explorerProjectionFixture();
    tokenMismatch.capabilities.tokenRequired = false;
    const { projectionDigest: _tokenDigest, ...tokenMismatchWithoutDigest } = tokenMismatch;
    tokenMismatch.projectionDigest = digestJson(tokenMismatchWithoutDigest as unknown as Json);
    expect(() => assertExplorerProjectionCacheIntegrity(tokenMismatch, ARCHITECTURE_LEDGER_SCOPE))
      .toThrow("explorer-projection-cache-integrity-mismatch");
  });

  test("bounded Explorer read plan selects a focused SQLite neighborhood and targeted metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-explorer-bounded-read-"));
    const databasePath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(databasePath);
    try {
      await store.migrate();
      const first = architectureLedgerEvent(0);
      const second = architectureLedgerEvent(1, [first]);
      const third = architectureLedgerEvent(2, [first, second]);
      await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [first, second, third] });
      const query = {
        schemaVersion: "archcontext.explorer-projection-query/v2" as const,
        viewId: "system-map" as const,
        semanticLevel: "detail" as const,
        focus: { subjectId: "entity.0" },
        depth: 1 as const,
        budget: { maxNodes: 3, maxRelations: 2 }
      };
      const plan = canonicalProjectionReadPlanV1(query, "verified-ledger-current");
      const authority = await store.readExplorerProjectionAuthority(ARCHITECTURE_LEDGER_SCOPE);
      expect(authority).toBeDefined();
      const authorityPoison = new Database(databasePath);
      const originalEvidenceDigest = String((authorityPoison.query(
        "SELECT evidence_after_digest AS value FROM architecture_change_feed ORDER BY feed_sequence DESC LIMIT 1"
      ).get() as { value: string }).value);
      authorityPoison.run(
        "UPDATE architecture_change_feed SET evidence_after_digest = ? WHERE feed_sequence = (SELECT MAX(feed_sequence) FROM architecture_change_feed)",
        [`sha256:${"f".repeat(64)}`]
      );
      expect(() => authorityPoison.run(
        "UPDATE architecture_evidence_state_checkpoints SET evidence_state_digest = ?",
        [`sha256:${"f".repeat(64)}`]
      )).toThrow("architecture-evidence-state-checkpoints-immutable");
      expect(() => authorityPoison.run(
        "DELETE FROM architecture_evidence_state_checkpoints"
      )).toThrow("architecture-evidence-state-checkpoints-immutable");
      await expect(store.readExplorerProjectionAuthority(ARCHITECTURE_LEDGER_SCOPE))
        .rejects.toThrow("explorer-projection-authority-evidence-checkpoint-mismatch");
      authorityPoison.run(
        "UPDATE architecture_change_feed SET evidence_after_digest = ? WHERE feed_sequence = (SELECT MAX(feed_sequence) FROM architecture_change_feed)",
        [originalEvidenceDigest]
      );
      authorityPoison.close();
      const result = await store.readExplorerProjectionInputs({ ...ARCHITECTURE_LEDGER_SCOPE, query, plan, authorityCursor: authority!.authorityCursor });
      expect(result.graph.entities.map((item) => item.entityId)).toEqual(["entity.0", "entity.1"]);
      expect(result.graph.relations.map((item) => item.relationId)).toEqual(["relation.root-to-worker"]);
      expect(result.graph.constraints.map((item) => item.constraintId)).toEqual(["constraint.root-owned"]);
      expect(result.readSet.rowsRead).toMatchObject({ entities: 2, relations: 1, constraints: 1 });
      expect(result.readSet.planDigest).toBe(plan.planDigest);
      expect(result.readSet.selectedGraphDigest).toBe(architectureLedgerStateDigest(result.graph));
      expect(result.eventBacklinks.every((event) => event.subjectIds.every((id) => ["entity.0", "entity.1", "relation.root-to-worker", "constraint.root-owned"].includes(id)))).toBe(true);

      const noncanonicalWithoutDigest = { ...plan, limits: { ...plan.limits, maxEntities: 1, maxGraphRows: plan.limits.maxGraphRows - 2 } };
      const { planDigest: _ignoredPlanDigest, ...noncanonicalBody } = noncanonicalWithoutDigest;
      const noncanonicalPlan = { ...noncanonicalBody, planDigest: digestJson(noncanonicalBody as unknown as Json) };
      await expect(store.readExplorerProjectionInputs({ ...ARCHITECTURE_LEDGER_SCOPE, query, plan: noncanonicalPlan, authorityCursor: authority!.authorityCursor }))
        .rejects.toThrow("explorer-projection-read-plan-noncanonical");
      const exactFitQuery = { ...query, budget: { maxNodes: 2, maxRelations: 1 } };
      const exactFitPlan = canonicalProjectionReadPlanV1(exactFitQuery, "verified-ledger-current");
      const exactFit = await store.readExplorerProjectionInputs({ ...ARCHITECTURE_LEDGER_SCOPE, query: exactFitQuery, plan: exactFitPlan, authorityCursor: authority!.authorityCursor });
      expect(exactFit.readSet.authoritativeTotals).toMatchObject({ entities: 2, relations: 1 });
      const overflowQuery = { ...query, budget: { maxNodes: 1, maxRelations: 1 } };
      const overflowPlan = canonicalProjectionReadPlanV1(overflowQuery, "verified-ledger-current");
      await expect(store.readExplorerProjectionInputs({ ...ARCHITECTURE_LEDGER_SCOPE, query: overflowQuery, plan: overflowPlan, authorityCursor: authority!.authorityCursor }))
        .rejects.toThrow("explorer-projection-neighborhood-budget-exceeded");

      await expect(store.readExplorerProjectionInputs({
        ...ARCHITECTURE_LEDGER_SCOPE,
        query,
        plan,
        authorityCursor: { ...authority!.authorityCursor, graphDigest: `sha256:${"0".repeat(64)}` }
      })).rejects.toThrow("explorer-projection-authority-cursor-mismatch");

      const poison = new Database(databasePath);
      poison.run("UPDATE architecture_entities_current SET canonical_name = 'POISONED NAME' WHERE entity_id = 'entity.0'");
      await expect(store.readExplorerProjectionInputs({ ...ARCHITECTURE_LEDGER_SCOPE, query, plan, authorityCursor: authority!.authorityCursor }))
        .rejects.toThrow("explorer-projection-materialized-entity-proof-mismatch");
      poison.run("UPDATE architecture_entities_current SET canonical_name = 'root module' WHERE entity_id = 'entity.0'");
      const evidenceRow = poison.query("SELECT evidence_json FROM evidence_items LIMIT 1").get() as { evidence_json: string };
      const poisonedEvidence = JSON.parse(evidenceRow.evidence_json);
      poisonedEvidence.selector.symbolId = "symbol.poison";
      poison.run("UPDATE evidence_items SET evidence_json = ?", [JSON.stringify(poisonedEvidence)]);
      await expect(store.readExplorerProjectionInputs({ ...ARCHITECTURE_LEDGER_SCOPE, query, plan, authorityCursor: authority!.authorityCursor }))
        .rejects.toThrow("explorer-projection-binding-row-mismatch");
      poison.run("UPDATE evidence_items SET evidence_json = ?", [evidenceRow.evidence_json]);
      poison.run("UPDATE architecture_change_feed SET title = 'POISONED PRIVATE NOTE', rationale = 'internalBusinessRule = marginFormula'");
      await expect(store.readExplorerProjectionInputs({ ...ARCHITECTURE_LEDGER_SCOPE, query, plan, authorityCursor: authority!.authorityCursor }))
        .rejects.toThrow("explorer-projection-backlink-authority-mismatch");
      for (const row of poison.query("SELECT architecture_change_feed.event_id, architecture_change_feed.logical_event_id, architecture_events.event_json FROM architecture_change_feed JOIN architecture_events ON architecture_events.event_id = architecture_change_feed.event_id").all() as Array<{ event_id: string; logical_event_id: string; event_json: string }>) {
        const event = JSON.parse(row.event_json) as ArchitectureEventV1;
        const payload = architectureLedgerPayload(event);
        poison.run("UPDATE architecture_change_feed SET title = ?, rationale = ? WHERE event_id = ?", [payload.title ?? null, payload.rationale ?? null, row.event_id]);
      }
      poison.run(
        `INSERT INTO architecture_event_subjects
          (storage_repository_id, storage_workspace_id, event_sequence, event_id, logical_event_id, authority_class, subject_kind, subject_id, operation, created_at)
          SELECT storage_repository_id, storage_workspace_id, event_sequence, event_id, logical_event_id,
            'evidence', 'entity', 'entity.0', 'reference', created_at
          FROM architecture_event_subjects WHERE logical_event_id = ? LIMIT 1`,
        [third.eventId]
      );
      const thirdSubjects = (poison.query(
        "SELECT authority_class, subject_kind, subject_id, operation FROM architecture_event_subjects WHERE logical_event_id = ? ORDER BY authority_class, subject_kind, subject_id, operation"
      ).all(third.eventId) as Array<Record<string, unknown>>).map((row) => ({
        authorityClass: String(row.authority_class),
        subjectKind: String(row.subject_kind),
        subjectId: String(row.subject_id),
        operation: String(row.operation)
      }));
      poison.run("UPDATE architecture_change_feed SET subjects_digest = ? WHERE logical_event_id = ?", [digestJson({ eventId: third.eventId, subjects: thirdSubjects } as unknown as Json), third.eventId]);
      poison.close();
      const forgedBacklinkRead = await store.readExplorerProjectionInputs({ ...ARCHITECTURE_LEDGER_SCOPE, query, plan, authorityCursor: authority!.authorityCursor });
      expect(forgedBacklinkRead.eventBacklinks.some((event) => event.eventId === third.eventId && event.subjectIds.includes("entity.0"))).toBe(false);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
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
    "schema-incomplete target without legacy SQLite upgrades in place",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "archctx-state-old-target-repo-"));
      const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-old-target-root-"));
      try {
        const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        await writeOldRuntimeTarget(paths.localStorePath, "task_old", { source: "old-target" });

        const before = inspectLegacyLocalStoreMigration(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        expect(before.status).toBe("target-incomplete");

        const migration = migrateLegacyLocalStoreIfNeeded(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        expect(migration.migrated).toBe(true);
        expect(migration.status).toBe("target-upgraded");
        expect(migration.integrityCheck.target).toBe("ok");
        expect(migration.integrityCheck.error).toBeUndefined();
        expect(migration.copiedFiles).toEqual([paths.localStorePath]);
        expect(migration.quarantinedFiles).toEqual([]);
        await expectTaskState(paths.localStorePath, "task_old", { source: "old-target" });

        const after = inspectLegacyLocalStoreMigration(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
        expect(after.status).toBe("target-current");
      } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(stateRoot, { recursive: true, force: true });
      }
    },
    LEGACY_SQLITE_MIGRATION_TIMEOUT_MS
  );

  test("unrelated schema-incomplete target without legacy SQLite still requires repair or delete", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-state-unrelated-target-repo-"));
    const stateRoot = mkdtempSync(join(tmpdir(), "archctx-state-unrelated-target-root-"));
    try {
      const paths = runtimeStatePaths(root, { ARCHCONTEXT_STATE_DIR: stateRoot });
      await writeIncompleteSqliteTarget(paths.localStorePath);

      expect(() => migrateLegacyLocalStoreIfNeeded(root, { ARCHCONTEXT_STATE_DIR: stateRoot })).toThrow(
        "target upgrade failed"
      );
      expect(existsSync(paths.localStorePath)).toBe(true);
      expect(existsSync(join(dirname(paths.localStorePath), "quarantine"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

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
  }, LOCAL_STORE_SLOW_TEST_TIMEOUT_MS);

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
      "0006_architecture_ledger",
      "0007_runtime_job_queue",
      "0008_runtime_job_queue_hardening",
      "0009_architecture_ledger_search_fts",
      "0010_audit_runs",
      "0011_changeset_cleanup_cursor",
      "0012_explorer_projection_index",
      "0013_evidence_lifecycle",
      "0014_architecture_change_feed",
      "0015_snapshot_anchor_v2",
      "0016_manifest_addressed_projection_cache",
      "0017_explorer_cache_lifecycle"
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

  test("runtime job queue deduplicates fingerprints and coalesces queued jobs", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-runtime-job-queue-"));
    const store = new SqliteLocalStore(join(root, "runtime.sqlite"));
    try {
      await store.migrate();
      const first = runtimeAgentJob("alpha", {
        fingerprint: "fingerprint.same",
        queuedAt: "2026-06-25T01:00:00.000Z"
      });
      const duplicate = runtimeAgentJob("duplicate", {
        fingerprint: "fingerprint.same",
        queuedAt: "2026-06-25T01:00:01.000Z"
      });
      const newer = runtimeAgentJob("newer", {
        fingerprint: "fingerprint.newer",
        queuedAt: "2026-06-25T01:00:02.000Z"
      });

      await expect(store.enqueueRuntimeAgentJob({
        job: first,
        analysisKind: "architecture-delta",
        coalesceKey: "coalesce.scope",
        maxAttempts: 2
      })).resolves.toMatchObject({ enqueued: true, deduplicated: false, supersededJobIds: [] });
      await expect(store.enqueueRuntimeAgentJob({
        job: duplicate,
        analysisKind: "architecture-delta",
        coalesceKey: "coalesce.scope"
      })).resolves.toMatchObject({ enqueued: false, deduplicated: true, record: { job: { jobId: first.jobId } } });
      await expect(store.enqueueRuntimeAgentJob({
        job: newer,
        analysisKind: "architecture-delta",
        coalesceKey: "coalesce.scope"
      })).resolves.toMatchObject({ enqueued: true, deduplicated: false, supersededJobIds: [first.jobId] });

      const jobs = await store.listRuntimeAgentJobs(ARCHITECTURE_LEDGER_SCOPE);
      expect(jobs.map((job) => [job.job.jobId, job.job.status, job.supersededByJobId])).toEqual([
        [first.jobId, "superseded", newer.jobId],
        [newer.jobId, "queued", undefined]
      ]);
      expect(JSON.stringify(jobs)).not.toContain("diff --git");
      store.close();
      expect(await sqliteScalar(join(root, "runtime.sqlite"), "SELECT COUNT(*) FROM runtime_job_queue")).toBe(2);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, LOCAL_STORE_SLOW_TEST_TIMEOUT_MS);

  test("runtime job queue claims leases, retries failures, and dead-letters exhausted jobs", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-runtime-job-lease-"));
    const store = new SqliteLocalStore(join(root, "runtime.sqlite"));
    try {
      await store.migrate();
      const job = runtimeAgentJob("lease", { queuedAt: "2026-06-25T01:10:00.000Z" });
      await store.enqueueRuntimeAgentJob({ job, analysisKind: "architecture-delta", maxAttempts: 2 });

      const firstClaim = await store.claimRuntimeAgentJob({
        ...ARCHITECTURE_LEDGER_SCOPE,
        workerId: "worker.one",
        leaseMs: 30_000,
        now: "2026-06-25T01:10:01.000Z"
      });
      expect(firstClaim).toMatchObject({
        job: { jobId: job.jobId, status: "running" },
        attemptCount: 1,
        leaseOwner: "worker.one"
      });
      await expect(store.claimRuntimeAgentJob({
        ...ARCHITECTURE_LEDGER_SCOPE,
        workerId: "worker.two",
        leaseMs: 30_000,
        now: "2026-06-25T01:10:02.000Z"
      })).resolves.toBeUndefined();
      await expect(store.completeRuntimeAgentJob({
        jobId: job.jobId,
        workerId: "worker.one",
        status: "failed",
        now: "2026-06-25T01:10:03.000Z",
        error: "fixture-failure"
      })).resolves.toMatchObject({ job: { status: "failed" }, attemptCount: 1, deadLetteredAt: undefined });
      await expect(store.retryRuntimeAgentJob({
        jobId: job.jobId,
        now: "2026-06-25T01:10:04.000Z",
        reason: "retry-fixture"
      })).resolves.toMatchObject({ job: { status: "queued" }, attemptCount: 1 });

      const secondClaim = await store.claimRuntimeAgentJob({
        ...ARCHITECTURE_LEDGER_SCOPE,
        workerId: "worker.two",
        leaseMs: 30_000,
        now: "2026-06-25T01:10:05.000Z"
      });
      expect(secondClaim).toMatchObject({ job: { status: "running" }, attemptCount: 2, leaseOwner: "worker.two" });
      await expect(store.completeRuntimeAgentJob({
        jobId: job.jobId,
        workerId: "worker.two",
        status: "failed",
        now: "2026-06-25T01:10:06.000Z",
        error: "fixture-failure-two"
      })).resolves.toMatchObject({
        job: { status: "failed" },
        attemptCount: 2,
        deadLetteredAt: "2026-06-25T01:10:06.000Z"
      });
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, LOCAL_STORE_SLOW_TEST_TIMEOUT_MS);

  test("runtime job queue rejects duplicate completion of terminal jobs", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-runtime-job-duplicate-complete-"));
    const store = new SqliteLocalStore(join(root, "runtime.sqlite"));
    try {
      await store.migrate();
      const job = runtimeAgentJob("duplicate-complete", { queuedAt: "2026-06-25T01:20:00.000Z" });
      const outputDigest = digestJson({ output: "first-completion" } as unknown as Json);
      await store.enqueueRuntimeAgentJob({ job, analysisKind: "architecture-delta", maxAttempts: 1 });
      await expect(store.claimRuntimeAgentJob({
        ...ARCHITECTURE_LEDGER_SCOPE,
        workerId: "worker.duplicate",
        leaseMs: 30_000,
        now: "2026-06-25T01:20:01.000Z"
      })).resolves.toMatchObject({
        job: { jobId: job.jobId, status: "running" },
        attemptCount: 1
      });
      await expect(store.completeRuntimeAgentJob({
        jobId: job.jobId,
        workerId: "worker.duplicate",
        status: "succeeded",
        now: "2026-06-25T01:20:02.000Z",
        outputDigest
      })).resolves.toMatchObject({
        job: { status: "succeeded", outputDigest },
        attemptCount: 1
      });
      await expect(store.completeRuntimeAgentJob({
        jobId: job.jobId,
        workerId: "worker.duplicate",
        status: "succeeded",
        now: "2026-06-25T01:20:03.000Z",
        outputDigest: digestJson({ output: "duplicate-completion" } as unknown as Json)
      })).rejects.toThrow(`runtime-agent-job-complete-requires-running: ${job.jobId}`);

      const succeeded = (await store.listRuntimeAgentJobs(ARCHITECTURE_LEDGER_SCOPE))
        .filter((record) => record.job.status === "succeeded");
      expect(succeeded).toHaveLength(1);
      expect(succeeded[0].job.outputDigest).toBe(outputDigest);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, LOCAL_STORE_SLOW_TEST_TIMEOUT_MS);

  test("runtime job queue applies priority, queue caps, per-repository concurrency, and local stats", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-runtime-job-hardening-"));
    const store = new SqliteLocalStore(join(root, "runtime.sqlite"));
    try {
      await store.migrate();
      const lowOld = runtimeAgentJob("low-old", {
        fingerprint: "fingerprint.low-old",
        queuedAt: "2026-06-25T01:30:00.000Z"
      });
      const lowNew = runtimeAgentJob("low-new", {
        fingerprint: "fingerprint.low-new",
        queuedAt: "2026-06-25T01:30:01.000Z"
      });
      const high = runtimeAgentJob("high", {
        fingerprint: "fingerprint.high",
        queuedAt: "2026-06-25T01:30:02.000Z"
      });
      const rejectedLow = runtimeAgentJob("rejected-low", {
        fingerprint: "fingerprint.rejected-low",
        queuedAt: "2026-06-25T01:30:03.000Z"
      });
      const otherWorktreeScope = {
        repository: ARCHITECTURE_LEDGER_SCOPE.repository,
        worktree: {
          ...ARCHITECTURE_LEDGER_SCOPE.worktree,
          workspaceId: "workspace.architecture-ledger-other",
          storageWorkspaceId: "workspace.storage.architecture-ledger-other"
        }
      };
      const otherWorktreeJob = {
        ...runtimeAgentJob("other-worktree", {
          fingerprint: "fingerprint.other-worktree",
          queuedAt: "2026-06-25T01:30:04.000Z"
        }),
        worktree: otherWorktreeScope.worktree
      } satisfies AgentJobV1;

      await store.enqueueRuntimeAgentJob({ job: lowOld, analysisKind: "architecture-delta", coalesceKey: "cap.low-old", priority: 0 });
      await store.enqueueRuntimeAgentJob({ job: lowNew, analysisKind: "architecture-delta", coalesceKey: "cap.low-new", priority: 0 });
      await store.enqueueRuntimeAgentJob({ job: otherWorktreeJob, analysisKind: "architecture-delta", coalesceKey: "cap.other-worktree", priority: 0 });
      await expect(store.enqueueRuntimeAgentJob({
        job: high,
        analysisKind: "architecture-delta",
        coalesceKey: "cap.high",
        priority: 10,
        maxQueuedJobs: 2
      })).resolves.toMatchObject({
        enqueued: true,
        evictedJobIds: [lowOld.jobId],
        backpressure: { accepted: true, maxQueuedJobs: 2, priority: 10 }
      });
      await expect(store.enqueueRuntimeAgentJob({
        job: rejectedLow,
        analysisKind: "architecture-delta",
        coalesceKey: "cap.rejected-low",
        priority: 0,
        maxQueuedJobs: 1
      })).resolves.toMatchObject({
        enqueued: false,
        rejected: true,
        reasonCode: "backpressure-queue-cap",
        backpressure: { accepted: false, maxQueuedJobs: 1, priority: 0 }
      });

      const firstClaim = await store.claimRuntimeAgentJob({
        ...ARCHITECTURE_LEDGER_SCOPE,
        workerId: "worker.priority",
        leaseMs: 30_000,
        now: "2026-06-25T01:30:04.000Z",
        maxRunningJobs: 1
      });
      expect(firstClaim).toMatchObject({ job: { jobId: high.jobId, status: "running" }, priority: 10 });
      await expect(store.claimRuntimeAgentJob({
        ...ARCHITECTURE_LEDGER_SCOPE,
        workerId: "worker.second",
        leaseMs: 30_000,
        now: "2026-06-25T01:30:05.000Z",
        maxRunningJobs: 1
      })).resolves.toBeUndefined();
      await expect(store.claimRuntimeAgentJob({
        ...otherWorktreeScope,
        workerId: "worker.other-worktree",
        leaseMs: 30_000,
        now: "2026-06-25T01:30:05.000Z",
        maxRunningJobs: 1
      })).resolves.toBeUndefined();

      await expect(store.queueStatsRuntimeAgentJobs({
        ...ARCHITECTURE_LEDGER_SCOPE,
        now: "2026-06-25T01:30:06.000Z"
      })).resolves.toMatchObject({
        schemaVersion: "archcontext.runtime-agent-job-queue-stats/v1",
        queuedDepth: 1,
        runningDepth: 1,
        activeDepth: 2,
        countsByStatus: { queued: 1, running: 1, expired: 1 },
        totalJobCount: 3,
        lastFailureReason: "backpressure-queue-cap",
        lastFailureJobId: lowOld.jobId
      });
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, LOCAL_STORE_SLOW_TEST_TIMEOUT_MS);

  test("runtime job queue expires stale head or worktree jobs before new analysis can append", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-runtime-job-stale-"));
    const store = new SqliteLocalStore(join(root, "runtime.sqlite"));
    try {
      await store.migrate();
      const stale = runtimeAgentJob("stale", {
        queuedAt: "2026-06-25T01:20:00.000Z",
        headSha: "0".repeat(40)
      });
      const current = runtimeAgentJob("current", {
        queuedAt: "2026-06-25T01:20:01.000Z"
      });
      await store.enqueueRuntimeAgentJob({ job: stale, analysisKind: "architecture-delta", coalesceKey: "stale-a" });
      await store.enqueueRuntimeAgentJob({ job: current, analysisKind: "architecture-delta", coalesceKey: "stale-b" });

      await expect(store.cancelStaleRuntimeAgentJobs({
        ...ARCHITECTURE_LEDGER_SCOPE,
        headSha: ARCHITECTURE_LEDGER_SCOPE.worktree.headSha,
        worktreeDigest: ARCHITECTURE_LEDGER_SCOPE.worktree.worktreeDigest,
        now: "2026-06-25T01:20:02.000Z"
      })).resolves.toMatchObject([{ job: { jobId: stale.jobId, status: "expired" } }]);
      expect((await store.listRuntimeAgentJobs({
        ...ARCHITECTURE_LEDGER_SCOPE,
        statuses: ["queued"]
      })).map((record) => record.job.jobId)).toEqual([current.jobId]);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("runtime job queue stress fixture preserves 100 rapid git cursor changes without duplicate active jobs", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-runtime-job-stress-"));
    const store = new SqliteLocalStore(join(root, "runtime.sqlite"));
    const modes = ["commit", "amend", "rebase", "reset", "branch-switch"] as const;
    try {
      await store.migrate();
      for (let index = 0; index < 100; index += 1) {
        const mode = modes[index % modes.length]!;
        await store.enqueueRuntimeAgentJob({
          job: runtimeAgentJob(`stress-${index}`, {
            fingerprint: `fingerprint.stress.${index}`,
            queuedAt: new Date(Date.parse("2026-06-25T01:40:00.000Z") + index * 1000).toISOString(),
            headSha: index.toString(16).padStart(40, "0"),
            branch: mode === "branch-switch" ? `feature/al4-${index}` : "main",
            worktreeDigest: digestJson({ mode, index } as unknown as Json)
          }),
          analysisKind: "architecture-delta",
          coalesceKey: "stress.git-cursor",
          priority: index % 3,
          maxQueuedJobs: 8
        });
      }

      const jobs = await store.listRuntimeAgentJobs(ARCHITECTURE_LEDGER_SCOPE);
      const active = jobs.filter((record) => record.job.status === "queued" || record.job.status === "running");
      expect(jobs).toHaveLength(100);
      expect(new Set(jobs.map((record) => record.job.jobId)).size).toBe(100);
      expect(active.map((record) => record.job.jobId)).toEqual(["agent_job.stress-99"]);
      expect(await store.queueStatsRuntimeAgentJobs({
        ...ARCHITECTURE_LEDGER_SCOPE,
        now: "2026-06-25T01:42:00.000Z"
      })).toMatchObject({
        queuedDepth: 1,
        runningDepth: 0,
        totalJobCount: 100,
        coalescedJobCount: 99,
        countsByStatus: { queued: 1, superseded: 99 }
      });
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, LOCAL_STORE_SLOW_TEST_TIMEOUT_MS);

  test("sqlite changeset journal recovers pending temp writes after reopen", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-changeset-journal-"));
    const dbPath = join(root, "runtime.sqlite");
    const relativePath = ".archcontext/policies/review.yaml";
    const absolutePath = join(root, relativePath);
    const backupPath = `${absolutePath}.archctx-backup`;
    const tempPath = `${absolutePath}.archctx-tmp-test`;
    const original = "schemaVersion: archcontext.policy/v1\nid: policy.original\n";
    try {
      initializeArchContextModel(root, "Crash Recovery App");
      writeRepoFile(root, relativePath, original);
      const first = new SqliteLocalStore(dbPath);
      await first.migrate();
      const journalId = await first.beginChangeSet(root, changeSetDraft("changeset.recover", relativePath));
      await first.recordChangeSetFile(journalId, {
        path: relativePath,
        tempPath,
        backupPath,
        existed: true,
        operation: "update_entity_fields"
      });
      renameSync(absolutePath, backupPath);
      writeFileSync(tempPath, "partial write", "utf8");
      first.close();

      const second = new SqliteLocalStore(dbPath);
      await second.migrate();
      expect(second.recoverPendingChangeSets()).toBe(1);
      expect(readFileSync(absolutePath, "utf8")).toBe(original);
      expect(existsSync(tempPath)).toBe(false);
      expect(existsSync(backupPath)).toBe(false);
      expect(second.recoverPendingChangeSets()).toBe(0);
      const engine = new ChangeSetEngine({
        modelStore: new YamlModelStore(),
        projection: { planGeneratedProjection },
        journal: second
      });
      const replacement = "schemaVersion: archcontext.policy/v1\nid: policy.after-recovery\n";
      const draft = engine.approve(engine.plan({
        id: "changeset.after-recovery",
        base: {
          headSha: "abc",
          worktreeDigest: digestJson({ worktree: "after-recovery" } as unknown as Json),
          modelDigest: (await new YamlModelStore().validateModel({ root, repositoryId: "repo.test", headSha: "abc" })).modelDigest
        },
        reason: { taskSessionId: "task.after-recovery" },
        operations: [{
          op: "write_policy",
          path: relativePath,
          expectedHash: digestJson({ body: original }),
          body: replacement
        }]
      }));
      await expect(engine.apply(root, draft)).resolves.toMatchObject({ status: "applied" });
      expect(readFileSync(absolutePath, "utf8")).toBe(replacement);
      expect(existsSync(backupPath)).toBe(false);
      second.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("sqlite changeset recovery preserves the original when intent is durable but mutation never starts", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-changeset-intent-only-"));
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
      const journalId = await first.beginChangeSet(root, changeSetDraft("changeset.intent-only", relativePath));
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
      expect(existsSync(backupPath)).toBe(false);
      expect(existsSync(tempPath)).toBe(false);
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

  test("changeset recovery isolates an idempotency conflict and continues remaining pending journals", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-changeset-recovery-isolation-"));
    const dbPath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(dbPath);
    try {
      await store.migrate();
      const planned = architectureLedgerEvent(52);
      const conflicting = {
        ...planned,
        payload: {
          ...(planned.payload as Record<string, Json>),
          title: "Conflicting durable event"
        }
      };
      const conflictedJournal = await store.beginChangeSet(root, changeSetDraft("changeset.recovery-conflict", ".archcontext/policies/conflict.yaml"));
      await store.recordChangeSetLedgerPlan(conflictedJournal, { event: planned });
      const recoverableJournal = await store.beginChangeSet(root, changeSetDraft("changeset.recovery-continues", ".archcontext/policies/continues.yaml"));
      await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [conflicting] });

      expect(store.recoverPendingChangeSets()).toBe(1);
      expect(await sqliteScalar(dbPath, `SELECT status FROM changeset_journal WHERE journal_id = '${conflictedJournal}'`)).toBe("pending");
      expect(await sqliteScalar(dbPath, `SELECT status FROM changeset_journal WHERE journal_id = '${recoverableJournal}'`)).toBe("recovered");
      expect(String(await sqliteScalar(dbPath, `SELECT metadata_json FROM changeset_journal WHERE journal_id = '${conflictedJournal}'`)))
        .toContain("changeset-ledger-recovery-idempotency-conflict");
    } finally {
      store.close();
      removeTempRoot(root);
    }
  });

  test("changeset recovery leaves malformed planned ledger metadata pending and reports the error", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-changeset-recovery-malformed-"));
    const dbPath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(dbPath);
    try {
      await store.migrate();
      const journalId = await store.beginChangeSet(root, changeSetDraft("changeset.recovery-malformed", ".archcontext/policies/malformed.yaml"));
      await sqliteRun(dbPath,
        "UPDATE changeset_journal SET metadata_json = ? WHERE journal_id = ?",
        [JSON.stringify({ architectureLedger: { plannedEvent: { schemaVersion: "invalid" } } }), journalId]
      );

      expect(store.recoverPendingChangeSets()).toBe(0);
      expect(await sqliteScalar(dbPath, `SELECT status FROM changeset_journal WHERE journal_id = '${journalId}'`)).toBe("pending");
      expect(String(await sqliteScalar(dbPath, `SELECT metadata_json FROM changeset_journal WHERE journal_id = '${journalId}'`)))
        .toContain("changeset-ledger-recovery-planned-event-invalid");
    } finally {
      store.close();
      removeTempRoot(root);
    }
  });

  test("startup cleanup processes only the bounded committed-journal backlog", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-changeset-cleanup-bound-"));
    const dbPath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(dbPath);
    try {
      await store.migrate();
      for (let index = 0; index < 101; index += 1) {
        const journalId = await store.beginChangeSet(root, changeSetDraft(`changeset.cleanup-bound-${index}`, `.archcontext/policies/cleanup-${index}.yaml`));
        await store.commitChangeSet(journalId);
      }
      expect(store.recoverPendingChangeSets()).toBe(0);
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM changeset_journal WHERE status = 'committed' AND cleanup_completed_at IS NULL")).toBe(1);
      expect(store.recoverPendingChangeSets()).toBe(0);
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM changeset_journal WHERE status = 'committed' AND cleanup_completed_at IS NULL")).toBe(0);
    } finally {
      store.close();
      removeTempRoot(root);
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

  test("ledger append and changeset commit roll back atomically on failure", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-changeset-ledger-atomic-"));
    const dbPath = join(root, "runtime.sqlite");
    const relativePath = ".archcontext/policies/review.yaml";
    try {
      const store = new SqliteLocalStore(dbPath);
      await store.migrate();
      const journalId = await store.beginChangeSet(root, changeSetDraft("changeset.ledger-atomic", relativePath));
      const event = architectureLedgerEvent(43);
      await store.recordChangeSetLedgerPlan(journalId, { event });

      await expect(store.appendArchitectureEventsAndCommitChangeSet(journalId, {
        writer: "runtime-daemon",
        events: [event],
        faultAfterEvents: 1
      })).rejects.toThrow("architecture-ledger-fault-injection");
      expect(await sqliteScalar(dbPath, "SELECT status FROM changeset_journal WHERE journal_id = '" + journalId + "'")).toBe("pending");
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM architecture_events WHERE idempotency_key = 'architecture-ledger-test-43'")).toBe(0);

      await expect(store.appendArchitectureEventsAndCommitChangeSet(journalId, {
        writer: "runtime-daemon",
        events: [event]
      })).resolves.toMatchObject({ appendedEvents: [{ idempotencyKey: "architecture-ledger-test-43" }] });
      expect(await sqliteScalar(dbPath, "SELECT status FROM changeset_journal WHERE journal_id = '" + journalId + "'")).toBe("committed");
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM architecture_events WHERE idempotency_key = 'architecture-ledger-test-43'")).toBe(1);
      store.close();
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
  }, LOCAL_STORE_SLOW_TEST_TIMEOUT_MS);

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
      const events: ArchitectureEventV1[] = [];
      for (let index = 0; index < 1000; index += 1) events.push(architectureLedgerEvent(index, events));
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
      const neighborhood = await store.readArchitectureLedgerNeighborhood({
        ...ARCHITECTURE_LEDGER_SCOPE,
        id: "entity.0",
        depth: 1
      });
      expect(neighborhood.entities.map((entity) => entity.entityId)).toEqual(["entity.0", "entity.1"]);
      expect(neighborhood.relations.map((relation) => relation.relationId)).toEqual(["relation.root-to-worker"]);
      expect(neighborhood.constraints.map((constraint) => constraint.constraintId)).toEqual(["constraint.root-owned"]);
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
      expect(snapshot).toMatchObject({
        schemaVersion: "archcontext.architecture-snapshot/v2",
        eventCursor: { eventCount: 1000, lastEventSequence: 1000 },
        evidenceDigest: snapshot.state.evidence.stateDigest
      });
      const anchoredAtHead = await store.replayArchitectureLedger(ARCHITECTURE_LEDGER_SCOPE);
      expect(anchoredAtHead.events).toHaveLength(0);
      expect(anchoredAtHead.cursor.eventCount).toBe(1000);
      expect(anchoredAtHead.replay).toMatchObject({ anchorSnapshotId: snapshot.snapshotId, tailEventCount: 0 });
      await expect(store.compactArchitectureLedger({
        ...ARCHITECTURE_LEDGER_SCOPE,
        beforeSnapshotId: snapshot.snapshotId
      })).resolves.toEqual({ snapshotId: snapshot.snapshotId, compactedEventCount: 1000 });
      const deletionDb = new Database(databasePath);
      expect(() => deletionDb.prepare("DELETE FROM architecture_events WHERE event_sequence = 1").run())
        .toThrow("architecture-events-immutable");
      expect(() => deletionDb.prepare("UPDATE architecture_events SET payload_json = ? WHERE event_sequence = 1").run("{}"))
        .toThrow("architecture-events-immutable");
      expect(() => deletionDb.prepare("UPDATE architecture_events SET event_sequence = 0 WHERE event_sequence = 1").run())
        .toThrow("architecture-events-immutable");
      deletionDb.close();
      const compactedReplay = await store.replayArchitectureLedger(ARCHITECTURE_LEDGER_SCOPE);
      expect(compactedReplay.events).toHaveLength(0);
      expect(compactedReplay.replay.tailEventCount).toBe(0);
      const queryPlanDb = new Database(databasePath);
      const tailQueryPlan = queryPlanDb.prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM architecture_events
          WHERE storage_repository_id = ? AND storage_workspace_id = ? AND event_sequence > ? AND event_sequence <= ?
          ORDER BY event_sequence ASC`
      ).all(
        ARCHITECTURE_LEDGER_SCOPE.repository.storageRepositoryId,
        `${ARCHITECTURE_LEDGER_SCOPE.worktree.workspaceId}:${ARCHITECTURE_LEDGER_SCOPE.worktree.branch}:${ARCHITECTURE_LEDGER_SCOPE.worktree.headSha}:${ARCHITECTURE_LEDGER_SCOPE.worktree.worktreeDigest}`,
        1000,
        1000
      ) as Array<{ detail: string }>;
      queryPlanDb.close();
      expect(tailQueryPlan.some((row) => row.detail.includes("idx_architecture_events_scope_sequence"))).toBe(true);
      await expect(store.checkArchitectureLedgerIntegrity(ARCHITECTURE_LEDGER_SCOPE)).resolves.toMatchObject({
        ok: true,
        eventCount: 1000,
        snapshotCount: 1,
        failures: []
      });
      const ftsMatches = await store.queryArchitectureLedgerFts({ ...ARCHITECTURE_LEDGER_SCOPE, query: "root", maxItems: 5 });
      expect(ftsMatches.length).toBeGreaterThan(0);
      expect(ftsMatches.some((match) => Boolean(match.subjectId))).toBe(true);
      expect(ftsMatches[0]?.reasonCodes).toContain("sqlite-fts-match");
      await expect(store.backupArchitectureLedger({ backupPath })).resolves.toMatchObject({ backupPath, integrity: "ok" });
      expect(existsSync(backupPath)).toBe(true);
      store.close();

      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_current_graph_view")).toBe(1002);
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM open_recommendations_view")).toBe(1);
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM recent_architecture_changes_view")).toBe(1000);
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM unresolved_evidence_view")).toBe(0);
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_ledger_fts WHERE architecture_ledger_fts MATCH 'root'")).toBeGreaterThan(0);
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_ledger_search_fts WHERE architecture_ledger_search_fts MATCH 'root'")).toBeGreaterThan(0);
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
        events: [architectureLedgerEvent(0), architectureLedgerEvent(1, [architectureLedgerEvent(0)])],
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

  test("architecture ledger rejects stale base and incorrect resulting digests atomically", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-architecture-ledger-cas-"));
    const databasePath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(databasePath);
    try {
      await store.migrate();
      const valid = architectureLedgerEvent(0);
      await expect(store.appendArchitectureEvents({
        writer: "runtime-daemon",
        events: [{ ...valid, baseDigest: digestJson({ stale: true } as unknown as Json) }]
      })).rejects.toThrow("architecture-ledger-base-digest-conflict");
      await expect(store.appendArchitectureEvents({
        writer: "runtime-daemon",
        events: [{ ...valid, resultingDigest: digestJson({ incorrect: true } as unknown as Json) }]
      })).rejects.toThrow("architecture-ledger-resulting-digest-conflict");
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_events")).toBe(0);
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_entities_current")).toBe(0);
      expect((await store.replayArchitectureLedger(ARCHITECTURE_LEDGER_SCOPE)).events).toEqual([]);
    } finally {
      store.close();
      removeTempRoot(root);
    }
  });

  test("architecture ledger idempotency conflict rolls back earlier events in the same transaction", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-architecture-ledger-idempotency-"));
    const databasePath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(databasePath);
    try {
      await store.migrate();
      const first = architectureLedgerEvent(0);
      await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [first] });
      const second = architectureLedgerEvent(1, [first]);
      const conflict = {
        ...first,
        payload: {
          ...(first.payload as Record<string, Json>),
          title: "Conflicting replay of the first event"
        }
      };

      await expect(store.appendArchitectureEvents({ writer: "runtime-daemon", events: [second, conflict] }))
        .rejects.toThrow("architecture-ledger-idempotency-conflict");
      expect((await store.replayArchitectureLedger(ARCHITECTURE_LEDGER_SCOPE)).events.map((event) => event.eventId))
        .toEqual([first.eventId]);
      expect((await store.readArchitectureLedgerState(ARCHITECTURE_LEDGER_SCOPE)).entities.map((entity) => entity.entityId))
        .toEqual(["entity.0"]);
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_events")).toBe(1);
    } finally {
      store.close();
      removeTempRoot(root);
    }
  });

  test("architecture ledger idempotent append rejects a tampered stored authority row", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-architecture-ledger-idempotency-authority-"));
    const databasePath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(databasePath);
    try {
      await store.migrate();
      const first = architectureLedgerEvent(0);
      await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [first] });
      const poison = new Database(databasePath);
      const stored = poison.query("SELECT event_id, event_json FROM architecture_events LIMIT 1").get() as { event_id: string; event_json: string };
      const forged = JSON.parse(stored.event_json) as ArchitectureEventV1;
      forged.payload = { ...(forged.payload as Record<string, Json>), summary: "forged stored authority" } as Json;
      poison.run("DROP TRIGGER architecture_events_immutable_update");
      poison.run("UPDATE architecture_events SET event_json = ? WHERE event_id = ?", [stableJsonFixture(forged), stored.event_id]);
      poison.close();

      await expect(store.appendArchitectureEvents({ writer: "runtime-daemon", events: [first] }))
        .rejects.toThrow("architecture-ledger-event-authority-mismatch");
      expect(await sqliteScalar(databasePath, "SELECT COUNT(*) FROM architecture_events")).toBe(1);
    } finally {
      store.close();
      removeTempRoot(root);
    }
  });

  test("architecture ledger cursors remain bound to immutable per-event checkpoints", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-architecture-ledger-cursor-authority-"));
    const databasePath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(databasePath);
    try {
      await store.migrate();
      const first = architectureLedgerEvent(0);
      await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [first] });
      const poison = new Database(databasePath);
      poison.run("DROP TRIGGER architecture_events_immutable_update");
      poison.run("DROP TRIGGER architecture_events_scope_backfill_only");
      poison.run("UPDATE architecture_events SET scope_event_count = 999");
      await expect(store.appendArchitectureEvents({ writer: "runtime-daemon", events: [first] }))
        .rejects.toThrow("architecture-ledger-event-authority-mismatch");
      await expect(store.readExplorerProjectionAuthority(ARCHITECTURE_LEDGER_SCOPE))
        .rejects.toThrow("explorer-projection-authority-evidence-checkpoint-mismatch");

      poison.run("UPDATE architecture_events SET scope_event_count = 1, event_sequence = 999");
      await expect(store.appendArchitectureEvents({ writer: "runtime-daemon", events: [first] }))
        .rejects.toThrow("architecture-ledger-event-authority-mismatch");
      await expect(store.readExplorerProjectionAuthority(ARCHITECTURE_LEDGER_SCOPE))
        .rejects.toThrow("explorer-projection-authority-feed-mismatch");
      poison.close();
    } finally {
      store.close();
      removeTempRoot(root);
    }
  });

  test("ADR-0042: audit run pending -> issuing -> issued transitions append without idempotency conflict and project the latest status", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-audit-run-transitions-"));
    const databasePath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(databasePath);
    try {
      await store.migrate();
      const base = {
        repository: ARCHITECTURE_LEDGER_SCOPE.repository,
        worktree: ARCHITECTURE_LEDGER_SCOPE.worktree,
        jobId: "agent_job.audit_transition_test",
        reportId: "investigation_report.audit_transition_test",
        repoNameWithOwner: "acme/widgets",
        issueDraftDigests: [`sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`],
        inputDigest: digestJson({ input: "audit-transition-test" } as unknown as Json),
        outputDigest: digestJson({ output: "audit-transition-test" } as unknown as Json)
      };

      const pendingPlan = planAuditRunToArchitectureLedgerEvent({
        ...base,
        status: "pending",
        repoVisibility: "private",
        createdAt: "2026-07-05T00:00:00.000Z"
      });
      const pendingAppend = await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [pendingPlan.event] });
      expect(pendingAppend.appendedEvents).toHaveLength(1);
      const runId = architectureLedgerPayload(pendingAppend.appendedEvents[0]!).auditRuns![0]!.runId;

      const issuedIssueOne = [{
        draftId: "draft.one",
        draftDigest: base.issueDraftDigests[0]!,
        number: 101,
        url: "https://github.com/acme/widgets/issues/101",
        issuedAt: "2026-07-05T00:00:05.000Z"
      }];
      const issuingPlan = planAuditRunToArchitectureLedgerEvent({
        ...base,
        runId,
        status: "issuing",
        repoVisibility: "private",
        issuedIssues: issuedIssueOne,
        createdAt: "2026-07-05T00:00:06.000Z",
        eventType: "architecture.agent_audit.run_issuing"
      });
      const issuingAppend = await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [issuingPlan.event] });
      expect(issuingAppend.appendedEvents).toHaveLength(1);
      expect(issuingAppend.duplicateEvents).toHaveLength(0);

      const issuedIssuesFinal = [
        ...issuedIssueOne,
        {
          draftId: "draft.two",
          draftDigest: base.issueDraftDigests[1]!,
          number: 102,
          url: "https://github.com/acme/widgets/issues/102",
          issuedAt: "2026-07-05T00:00:10.000Z"
        }
      ];
      const issuedPlan = planAuditRunToArchitectureLedgerEvent({
        ...base,
        runId,
        status: "issued",
        repoVisibility: "private",
        issuedIssues: issuedIssuesFinal,
        createdAt: "2026-07-05T00:00:11.000Z",
        eventType: "architecture.agent_audit.run_issued"
      });
      const issuedAppend = await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [issuedPlan.event] });
      expect(issuedAppend.appendedEvents).toHaveLength(1);
      expect(issuedAppend.duplicateEvents).toHaveLength(0);

      // pending/issuing/issued each compute a distinct idempotencyKey (pending keeps ADR-0041's
      // original per-runId key; issuing/issued are content-addressed per transition), so all three
      // appends above succeeded without ever hitting architecture-ledger-idempotency-conflict.
      const idempotencyKeys = [pendingPlan.event.idempotencyKey, issuingPlan.event.idempotencyKey, issuedPlan.event.idempotencyKey];
      expect(new Set(idempotencyKeys).size).toBe(3);

      // Replaying the identical "issued" transition (e.g. a retried approve call after the ledger
      // append already succeeded but the RPC response was lost) is a safe duplicate no-op: same
      // idempotencyKey, same content, no conflict, and no second row.
      const replay = await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [issuedPlan.event] });
      expect(replay.appendedEvents).toHaveLength(0);
      expect(replay.duplicateEvents).toHaveLength(1);

      // audit_runs.run_id is a primary key behind INSERT OR REPLACE, so the projected row reflects
      // only the latest ("issued") transition, not a stale "pending" or "issuing" snapshot.
      const run = await store.getAuditRun({ ...ARCHITECTURE_LEDGER_SCOPE, runId });
      expect(run?.status).toBe("issued");
      expect(run?.issuedIssues).toHaveLength(2);
      expect(run?.issuedIssues?.map((issue) => issue.number).sort()).toEqual([101, 102]);
      const runs = await store.listAuditRuns(ARCHITECTURE_LEDGER_SCOPE);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.status).toBe("issued");
    } finally {
      store.close();
      removeTempRoot(root);
    }
  });

  test("architecture ledger rejects forbidden payload content before durable persistence", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-ledger-privacy-"));
    const dbPath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(dbPath);
    try {
      await store.migrate();
      const unsafe = {
        ...architectureLedgerEvent(90),
        payload: { rawDiff: "diff --git a/secrets.ts b/secrets.ts" }
      } as ArchitectureEventV1;
      await expect(store.appendArchitectureEvents({ writer: "runtime-daemon", events: [unsafe] }))
        .rejects.toThrow("architecture-ledger-privacy-denied");
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM architecture_events")).toBe(0);
      expect((await store.replayArchitectureLedger(ARCHITECTURE_LEDGER_SCOPE)).events).toEqual([]);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("architecture ledger isolates current state, replay, FTS, and snapshots by the complete worktree cursor", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-ledger-scope-"));
    const dbPath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(dbPath);
    try {
      await store.migrate();
      const mainEvent = architectureLedgerEvent(0);
      const featureScope = {
        repository: ARCHITECTURE_LEDGER_SCOPE.repository,
        worktree: {
          ...ARCHITECTURE_LEDGER_SCOPE.worktree,
          branch: "feature/isolated",
          headSha: "def456ledger",
          worktreeDigest: digestJson({ worktree: "feature-isolated" } as unknown as Json)
        }
      };
      const featureEvent = {
        ...architectureLedgerEvent(0),
        repository: featureScope.repository,
        worktree: featureScope.worktree,
        headSha: featureScope.worktree.headSha,
        eventId: mainEvent.eventId,
        idempotencyKey: mainEvent.idempotencyKey
      };
      const featureOnlyEvent = {
        ...architectureLedgerEvent(102, [featureEvent]),
        repository: featureScope.repository,
        worktree: featureScope.worktree,
        headSha: featureScope.worktree.headSha
      };
      await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [mainEvent] });
      await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [featureEvent, featureOnlyEvent] });

      expect((await store.readArchitectureLedgerState(ARCHITECTURE_LEDGER_SCOPE)).entities.map((entity) => entity.entityId))
        .toEqual(["entity.0"]);
      expect((await store.readArchitectureLedgerState(featureScope)).entities.map((entity) => entity.entityId))
        .toEqual(["entity.0", "entity.102"]);
      expect((await store.replayArchitectureLedger(ARCHITECTURE_LEDGER_SCOPE)).events.map((event) => event.eventId))
        .toEqual([mainEvent.eventId]);
      expect((await store.replayArchitectureLedger(featureScope)).events.map((event) => event.eventId))
        .toEqual([featureEvent.eventId, featureOnlyEvent.eventId]);
      expect(await store.queryArchitectureLedgerFts({ ...ARCHITECTURE_LEDGER_SCOPE, query: "102" })).toEqual([]);

      const mainSnapshot = await store.createArchitectureLedgerSnapshot({
        ...ARCHITECTURE_LEDGER_SCOPE,
        sourceMode: "dual",
        projectionDigest: digestJson({ projection: "main" } as unknown as Json),
        inputDigests: { modelDigest: digestJson({ model: "main" } as unknown as Json) },
        createdAt: "2026-06-25T03:00:00.000Z"
      });
      const featureSnapshot = await store.createArchitectureLedgerSnapshot({
        ...featureScope,
        sourceMode: "dual",
        projectionDigest: digestJson({ projection: "feature" } as unknown as Json),
        inputDigests: { modelDigest: digestJson({ model: "feature" } as unknown as Json) },
        createdAt: "2026-06-25T03:01:00.000Z"
      });
      expect((await store.replayArchitectureLedger({ ...ARCHITECTURE_LEDGER_SCOPE, snapshotId: mainSnapshot.snapshotId })).events)
        .toHaveLength(0);
      expect((await store.replayArchitectureLedger({ ...featureScope, snapshotId: featureSnapshot.snapshotId })).events)
        .toHaveLength(0);
      await expect(store.replayArchitectureLedger({ ...ARCHITECTURE_LEDGER_SCOPE, snapshotId: featureSnapshot.snapshotId }))
        .rejects.toThrow("architecture-ledger-snapshot-not-found");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("snapshot V2 restores verified graph and evidence state then replays only the ordered tail", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-snapshot-anchor-v2-"));
    const dbPath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(dbPath);
    try {
      await store.migrate();
      const history: ArchitectureEventV1[] = [];
      for (let index = 0; index < 20; index += 1) history.push(architectureLedgerEvent(index, history));
      await store.appendArchitectureEvents({ writer: "runtime-daemon", events: history });
      const transientItem = sqliteEvidenceItem("Transient snapshot evidence");
      const transientBinding = sqliteEvidenceBinding(transientItem.evidenceId);
      const transientCreate = architectureEvidenceLifecycleEvent("snapshot-transient-create", [
        { target: "item", action: "create", evidenceId: transientItem.evidenceId, value: transientItem },
        { target: "binding", action: "create", bindingId: transientBinding.bindingId, value: transientBinding }
      ]);
      const transientRemove = architectureEvidenceLifecycleEvent("snapshot-transient-remove", [
        { target: "binding", action: "remove", bindingId: transientBinding.bindingId, previousDigest: evidenceLifecycleValueDigest(transientBinding), reasonCode: "snapshot-fixture" },
        { target: "item", action: "remove", evidenceId: transientItem.evidenceId, previousDigest: evidenceLifecycleValueDigest(transientItem), reasonCode: "snapshot-fixture" }
      ]);
      await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [transientCreate, transientRemove] });
      const snapshot = await store.createArchitectureLedgerSnapshot({
        ...ARCHITECTURE_LEDGER_SCOPE,
        sourceMode: "dual",
        projectionDigest: digestJson({ projection: "snapshot-v2" } as unknown as Json),
        inputDigests: { modelDigest: digestJson({ model: "snapshot-v2" } as unknown as Json) },
        createdAt: "2026-07-11T09:00:00.000Z"
      });
      expect(snapshot.eventCursor.lastEventSequence).toBe(22);
      expect(snapshot.state.graph).toEqual(replayArchitectureLedgerEvents(history) as unknown as Json);
      expect(snapshot.state.evidence.evidenceItems).toHaveLength(1);
      expect(snapshot.state.evidence.tombstones).toHaveLength(2);

      const tail: ArchitectureEventV1[] = [];
      for (let index = 20; index < 25; index += 1) {
        const event = architectureLedgerEvent(index, [...history, ...tail]);
        tail.push(event);
      }
      await store.appendArchitectureEvents({ writer: "runtime-daemon", events: tail });
      const originalEvidence = snapshot.state.evidence.evidenceItems[0]!;
      const updatedEvidence = {
        ...originalEvidence,
        summary: "root module remains the verified architecture entrypoint",
        digest: digestJson({ evidenceId: originalEvidence.evidenceId, revision: 2 } as unknown as Json)
      };
      const evidenceUpdate = architectureEvidenceLifecycleEvent("snapshot-tail-update", [{
        target: "item",
        action: "update",
        evidenceId: originalEvidence.evidenceId,
        previousDigest: evidenceLifecycleValueDigest(originalEvidence),
        value: updatedEvidence
      }]);
      await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [evidenceUpdate] });

      const anchored = await store.replayArchitectureLedger(ARCHITECTURE_LEDGER_SCOPE);
      const genesis = await store.replayArchitectureLedger({ ...ARCHITECTURE_LEDGER_SCOPE, mode: "genesis" });
      expect(anchored.replay).toEqual({
        mode: "anchored",
        anchorSnapshotId: snapshot.snapshotId,
        anchorEventSequence: 22,
        tailEventCount: 6
      });
      expect(anchored.events).toHaveLength(6);
      expect(anchored.cursor.eventCount).toBe(28);
      expect(anchored.state).toEqual(genesis.state);
      expect(anchored.evidenceState).toEqual(genesis.evidenceState);
      expect(anchored.evidenceState.evidenceItems[0]?.summary).toBe(updatedEvidence.summary);
      expect(genesis.events).toHaveLength(28);

      const beforeAnchor = await store.replayArchitectureLedger({ ...ARCHITECTURE_LEDGER_SCOPE, untilEventId: history[9]!.eventId });
      expect(beforeAnchor.replay.anchorSnapshotId).toBeUndefined();
      expect(beforeAnchor.events).toHaveLength(10);
      await expect(store.replayArchitectureLedger({
        ...ARCHITECTURE_LEDGER_SCOPE,
        snapshotId: snapshot.snapshotId,
        untilEventId: history[9]!.eventId
      })).rejects.toThrow("architecture-ledger-snapshot-after-target");
      await expect(store.replayArchitectureLedger({ ...ARCHITECTURE_LEDGER_SCOPE, untilEventId: "architecture_event.missing" }))
        .rejects.toThrow("architecture-ledger-event-not-found");

      const corruptDb = new Database(dbPath);
      corruptDb.prepare("UPDATE architecture_snapshots SET state_digest = ? WHERE snapshot_id = ?")
        .run(`sha256:${"0".repeat(64)}`, snapshot.snapshotId);
      corruptDb.close();
      await expect(store.replayArchitectureLedger(ARCHITECTURE_LEDGER_SCOPE))
        .rejects.toThrow("architecture-ledger-snapshot-integrity-mismatch");
      const metadataCorruptDb = new Database(dbPath);
      metadataCorruptDb.prepare("UPDATE architecture_snapshots SET state_digest = ?, branch = ? WHERE snapshot_id = ?")
        .run(snapshot.stateDigest, "tampered/snapshot-metadata", snapshot.snapshotId);
      metadataCorruptDb.close();
      await expect(store.replayArchitectureLedger(ARCHITECTURE_LEDGER_SCOPE))
        .rejects.toThrow("architecture-ledger-snapshot-integrity-mismatch");
      await expect(store.compactArchitectureLedger({
        ...ARCHITECTURE_LEDGER_SCOPE,
        beforeSnapshotId: snapshot.snapshotId
      })).rejects.toThrow("architecture-ledger-snapshot-integrity-mismatch");
      await expect(store.replayArchitectureLedger({
        ...ARCHITECTURE_LEDGER_SCOPE,
        snapshotId: snapshot.snapshotId,
        mode: "genesis"
      })).rejects.toThrow("architecture-ledger-snapshot-integrity-mismatch");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("replay rejects a typed event row that diverges from its hashed event JSON", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-replay-row-integrity-"));
    const dbPath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(dbPath);
    try {
      await store.migrate();
      const event = architectureLedgerEvent(0);
      await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [event] });
      const corruptDb = new Database(dbPath);
      corruptDb.prepare("DROP TRIGGER architecture_events_immutable_update").run();
      corruptDb.prepare("UPDATE architecture_events SET payload_json = ?")
        .run(JSON.stringify({ title: "forged typed row" }));
      corruptDb.close();
      await expect(store.replayArchitectureLedger({ ...ARCHITECTURE_LEDGER_SCOPE, mode: "genesis" }))
        .rejects.toThrow("architecture-ledger-event-authority-mismatch");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("snapshot creation rejects materialized state that diverges from genesis authority", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-snapshot-authority-"));
    const dbPath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(dbPath);
    try {
      await store.migrate();
      const event = architectureLedgerEvent(0);
      await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [event] });
      const corruptDb = new Database(dbPath);
      corruptDb.prepare("UPDATE architecture_entities_current SET canonical_name = ?").run("forged-materialized-state");
      corruptDb.close();
      await expect(store.createArchitectureLedgerSnapshot({
        ...ARCHITECTURE_LEDGER_SCOPE,
        sourceMode: "dual",
        projectionDigest: digestJson({ projection: "authority-check" } as unknown as Json),
        inputDigests: { modelDigest: digestJson({ model: "authority-check" } as unknown as Json) },
        createdAt: "2026-07-11T09:30:00.000Z"
      })).rejects.toThrow("architecture-ledger-snapshot-materialized-state-mismatch");
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM architecture_snapshots")).toBe(0);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("target and direct scope lookups reject denormalized row corruption", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-direct-lookup-authority-"));
    const dbPath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(dbPath);
    try {
      await store.migrate();
      const event = architectureLedgerEvent(0);
      await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [event] });
      const feedCorruptDb = new Database(dbPath);
      feedCorruptDb.prepare("UPDATE architecture_change_feed SET logical_event_id = ?").run("arch_event.forged-target");
      feedCorruptDb.close();
      await expect(store.replayArchitectureLedger({ ...ARCHITECTURE_LEDGER_SCOPE, untilEventId: "arch_event.forged-target" }))
        .rejects.toThrow("architecture-ledger-event-authority-mismatch");

      const scopeCorruptDb = new Database(dbPath);
      scopeCorruptDb.prepare("DROP TRIGGER architecture_events_immutable_update").run();
      scopeCorruptDb.prepare("UPDATE architecture_events SET head_sha = ?").run("f".repeat(40));
      scopeCorruptDb.close();
      await expect(store.resolveArchitectureLedgerScope(ARCHITECTURE_LEDGER_SCOPE))
        .rejects.toThrow("architecture-ledger-event-authority-mismatch");
      await expect(store.resolveLatestArchitectureLedgerScope(ARCHITECTURE_LEDGER_SCOPE))
        .rejects.toThrow("architecture-ledger-event-authority-mismatch");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("architecture ledger persists evidence lifecycle transitions atomically", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-evidence-lifecycle-"));
    const dbPath = join(root, "runtime.sqlite");
    const store = new SqliteLocalStore(dbPath);
    try {
      await store.migrate();
      const first = sqliteEvidenceItem("Owns API");
      const second = sqliteEvidenceItem("Owns API and routing");
      const binding = sqliteEvidenceBinding(first.evidenceId);
      const create = architectureEvidenceLifecycleEvent("create", [
        { target: "item", action: "create", evidenceId: first.evidenceId, value: first },
        { target: "binding", action: "create", bindingId: binding.bindingId, value: binding }
      ]);
      const update = architectureEvidenceLifecycleEvent("update", [{
        target: "item",
        action: "update",
        evidenceId: first.evidenceId,
        previousDigest: evidenceLifecycleValueDigest(first),
        value: second
      }]);
      const remove = architectureEvidenceLifecycleEvent("remove", [
        { target: "binding", action: "remove", bindingId: binding.bindingId, previousDigest: evidenceLifecycleValueDigest(binding), reasonCode: "superseded" },
        { target: "item", action: "remove", evidenceId: second.evidenceId, previousDigest: evidenceLifecycleValueDigest(second), reasonCode: "superseded" }
      ]);

      await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [create, update, remove] });
      const state = await store.replayArchitectureLedgerEvidence(ARCHITECTURE_LEDGER_SCOPE);
      expect(state.evidenceItems).toEqual([]);
      expect(state.evidenceBindings).toEqual([]);
      expect(state.tombstones).toHaveLength(2);
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM evidence_items")).toBe(0);
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM evidence_bindings")).toBe(0);
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM evidence_tombstones")).toBe(2);

      const invalid = architectureEvidenceLifecycleEvent("invalid", [{
        target: "item",
        action: "create",
        evidenceId: first.evidenceId,
        value: first
      }]);
      await expect(store.appendArchitectureEvents({ writer: "runtime-daemon", events: [invalid] }))
        .rejects.toThrow("create-requires-unused-id");
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM architecture_events")).toBe(3);
      const legacyWriter = {
        ...architectureEvidenceLifecycleEvent("legacy-writer", []),
        payloadVersion: "archcontext.architecture-ledger-payload/v1",
        payload: { summary: "Legacy writer must be rejected", evidenceItems: [first] } as unknown as Json
      };
      await expect(store.appendArchitectureEvents({ writer: "runtime-daemon", events: [legacyWriter] }))
        .rejects.toThrow("architecture-ledger-new-legacy-evidence-forbidden");
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM architecture_events")).toBe(3);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("architecture change feed is transactional typed restart-safe and idempotent", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-change-feed-"));
    const dbPath = join(root, "runtime.sqlite");
    const first = sqliteEvidenceItem("Owns API");
    const second = sqliteEvidenceItem("Owns API and routing");
    const binding = sqliteEvidenceBinding(first.evidenceId);
    const createBase = architectureEvidenceLifecycleEvent("feed-create", [
      { target: "item", action: "create", evidenceId: first.evidenceId, value: first },
      { target: "binding", action: "create", bindingId: binding.bindingId, value: binding }
    ]);
    const create = {
      ...createBase,
      payload: { ...(createBase.payload as Record<string, Json>), title: "Evidence ownership", rationale: "Direct verified selector" }
    } as ArchitectureEventV1;
    const update = architectureEvidenceLifecycleEvent("feed-update", [{
      target: "item",
      action: "update",
      evidenceId: first.evidenceId,
      previousDigest: evidenceLifecycleValueDigest(first),
      value: second
    }]);
    const store = new SqliteLocalStore(dbPath);
    try {
      await store.migrate();
      await expect(store.appendArchitectureEvents({ writer: "runtime-daemon", events: [create, update], faultAfterEvents: 1 }))
        .rejects.toThrow("architecture-ledger-fault-injection");
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM architecture_events")).toBe(0);
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM architecture_event_subjects")).toBe(0);
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM architecture_change_feed")).toBe(0);
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM architecture_evidence_state_checkpoints")).toBe(0);

      await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [create, update] });
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM architecture_evidence_state_checkpoints")).toBe(2);
      const firstPoll = await store.listArchitectureChangeFeed({ ...ARCHITECTURE_LEDGER_SCOPE, consumerId: "test.feed", limit: 10 });
      const duplicatePoll = await store.listArchitectureChangeFeed({ ...ARCHITECTURE_LEDGER_SCOPE, consumerId: "test.feed", limit: 10 });
      expect(duplicatePoll.records).toEqual(firstPoll.records);
      expect(firstPoll.records).toHaveLength(2);
      expect(firstPoll.records[0]?.affectedSubjects).toContainEqual({
        authorityClass: "evidence",
        subjectKind: "evidence-binding",
        subjectId: binding.bindingId,
        operation: "create"
      });
      expect(firstPoll.records[1]?.affectedSubjects).toContainEqual({
        authorityClass: "evidence",
        subjectKind: "evidence-binding",
        subjectId: binding.bindingId,
        operation: "reference"
      });
      expect(firstPoll.records[1]?.changedInputDigests.evidenceBefore).not.toBe(firstPoll.records[1]?.changedInputDigests.evidenceAfter);
      await expect(store.acknowledgeArchitectureChangeFeed({ ...ARCHITECTURE_LEDGER_SCOPE, consumerId: "test.unseen", feedSequence: firstPoll.records[1]!.feedSequence }))
        .rejects.toThrow("ack-requires-delivered-sequence");
      const crossScope = {
        repository: ARCHITECTURE_LEDGER_SCOPE.repository,
        worktree: {
          ...ARCHITECTURE_LEDGER_SCOPE.worktree,
          branch: "other",
          headSha: "b".repeat(40),
          worktreeDigest: digestJson({ scope: "other" } as unknown as Json)
        }
      };
      await expect(store.acknowledgeArchitectureChangeFeed({ ...crossScope, consumerId: "test.feed", feedSequence: firstPoll.records[1]!.feedSequence }))
        .rejects.toThrow("ack-requires-delivered-sequence");
      const checkpoint = await store.acknowledgeArchitectureChangeFeed({
        ...ARCHITECTURE_LEDGER_SCOPE,
        consumerId: "test.feed",
        feedSequence: firstPoll.records[1]!.feedSequence
      });
      await expect(store.acknowledgeArchitectureChangeFeed({ ...ARCHITECTURE_LEDGER_SCOPE, consumerId: "test.feed", feedSequence: checkpoint }))
        .resolves.toBe(checkpoint);
      expect((await store.listArchitectureChangeFeed({ ...ARCHITECTURE_LEDGER_SCOPE, consumerId: "test.feed" })).records).toEqual([]);
      const backlinks = await store.listArchitectureEventBacklinks(ARCHITECTURE_LEDGER_SCOPE);
      expect(backlinks.find((item) => item.eventId === update.eventId)?.subjectIds).toContain(binding.bindingId);
      expect(backlinks.find((item) => item.eventId === create.eventId)).toMatchObject({
        title: "Evidence ownership",
        rationale: "Direct verified selector"
      });
      const corruptDb = new Database(dbPath);
      corruptDb.prepare("UPDATE architecture_change_feed SET event_hash = ? WHERE logical_event_id = ?")
        .run(`sha256:${"0".repeat(64)}`, update.eventId);
      corruptDb.close();
      await expect(store.listArchitectureChangeFeed({ ...ARCHITECTURE_LEDGER_SCOPE, consumerId: "test.corrupt" }))
        .rejects.toThrow("architecture-change-feed-authority-mismatch");
      const repairDb = new Database(dbPath);
      repairDb.prepare("UPDATE architecture_change_feed SET event_hash = ? WHERE logical_event_id = ?")
        .run(firstPoll.records[1]!.eventHash, update.eventId);
      repairDb.close();
      const corruptCursorDb = new Database(dbPath);
      corruptCursorDb.prepare("UPDATE architecture_change_feed_consumers SET feed_sequence = ?, delivered_sequence = ? WHERE consumer_id = ?")
        .run(999_999, 999_999, "test.feed");
      corruptCursorDb.close();
      await expect(store.listArchitectureChangeFeed({ ...ARCHITECTURE_LEDGER_SCOPE, consumerId: "test.feed" }))
        .rejects.toThrow("architecture-change-feed-consumer-checkpoint-missing");
      const repairCursorDb = new Database(dbPath);
      repairCursorDb.prepare("UPDATE architecture_change_feed_consumers SET feed_sequence = ?, delivered_sequence = ? WHERE consumer_id = ?")
        .run(checkpoint, checkpoint, "test.feed");
      repairCursorDb.prepare("UPDATE architecture_event_subjects SET logical_event_id = ? WHERE logical_event_id = ?")
        .run("arch_event.forged", update.eventId);
      repairCursorDb.close();
      await expect(store.listArchitectureEventBacklinks(ARCHITECTURE_LEDGER_SCOPE))
        .rejects.toThrow("architecture-event-backlink-logical-id-mismatch");
      const repairBacklinkDb = new Database(dbPath);
      repairBacklinkDb.prepare("UPDATE architecture_event_subjects SET logical_event_id = ? WHERE logical_event_id = ?")
        .run(update.eventId, "arch_event.forged");
      repairBacklinkDb.close();
      await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [create] });
      expect(await sqliteScalar(dbPath, "SELECT COUNT(*) FROM architecture_change_feed")).toBe(2);
    } finally {
      store.close();
    }

    const restarted = new SqliteLocalStore(dbPath);
    try {
      await restarted.migrate();
      const unread = await restarted.listArchitectureChangeFeed({ ...ARCHITECTURE_LEDGER_SCOPE, consumerId: "test.restart" });
      expect(unread.records).toHaveLength(2);
      expect(unread.records.map((record) => record.eventId)).toEqual([create.eventId, update.eventId]);
    } finally {
      restarted.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("affected subject extraction retains both sides of moved graph and evidence references", () => {
    const first = sqliteEvidenceItem("Old evidence reference");
    const binding = sqliteEvidenceBinding(first.evidenceId);
    const create = architectureEvidenceLifecycleEvent("reference-create", [
      { target: "item", action: "create", evidenceId: first.evidenceId, value: first },
      { target: "binding", action: "create", bindingId: binding.bindingId, value: binding }
    ]);
    const evidenceBefore = applyArchitectureLedgerEvidenceEvent(emptyEvidenceStateFixture(), create);
    const movedItem = {
      ...first,
      subject: "module.api.v2",
      selector: { kind: "path" as const, id: "module.api.v2", path: "packages/api-v2" },
      digest: digestJson({ evidenceId: first.evidenceId, subject: "module.api.v2" } as unknown as Json)
    };
    const movedBinding = { ...binding, target: { kind: "entity" as const, id: "module.api.v2" } };
    const update = architectureEvidenceLifecycleEvent("reference-update", [
      { target: "item", action: "update", evidenceId: first.evidenceId, previousDigest: evidenceLifecycleValueDigest(first), value: movedItem },
      { target: "binding", action: "update", bindingId: binding.bindingId, previousDigest: evidenceLifecycleValueDigest(binding), value: movedBinding }
    ]);
    const evidenceAfter = applyArchitectureLedgerEvidenceEvent(evidenceBefore, update);
    const evidenceSubjects = architectureAffectedSubjects(update, { entities: [], relations: [], constraints: [] }, evidenceBefore, evidenceAfter);
    expect(evidenceSubjects).toContainEqual({ authorityClass: "evidence", subjectKind: "subject", subjectId: "module.api", operation: "reference" });
    expect(evidenceSubjects).toContainEqual({ authorityClass: "evidence", subjectKind: "subject", subjectId: "module.api.v2", operation: "reference" });
    expect(evidenceSubjects).toContainEqual({ authorityClass: "evidence", subjectKind: "entity", subjectId: "module.api", operation: "reference" });
    expect(evidenceSubjects).toContainEqual({ authorityClass: "evidence", subjectKind: "entity", subjectId: "module.api.v2", operation: "reference" });

    const graphEvent = {
      ...architectureEvidenceLifecycleEvent("graph-reference-update", []),
      eventType: "architecture.graph.changed",
      payloadVersion: "archcontext.architecture-ledger-payload/v1",
      payload: {
        summary: "Move relation and constraint references",
        operations: [
          { op: "upsert_relation", relation: { relationId: "rel.api", kind: "calls", sourceEntityId: "module.new-source", targetEntityId: "module.new-target", status: "active" } },
          { op: "upsert_constraint", constraint: { constraintId: "constraint.api", kind: "boundary", subjectId: "module.new-subject", status: "active" } },
          { op: "delete_entity", entityId: "module.new-source" }
        ]
      }
    } as ArchitectureEventV1;
    const graphSubjects = architectureAffectedSubjects(graphEvent, {
      entities: [],
      relations: [{ relationId: "rel.api", kind: "calls", sourceEntityId: "module.old-source", targetEntityId: "module.old-target", status: "active" }],
      constraints: [{ constraintId: "constraint.api", kind: "boundary", subjectId: "module.old-subject", status: "active" }]
    }, evidenceAfter, evidenceAfter);
    for (const subjectId of ["module.old-source", "module.old-target", "module.new-source", "module.new-target"]) {
      expect(graphSubjects).toContainEqual({ authorityClass: "architecture-fact", subjectKind: "entity", subjectId, operation: "reference" });
    }
    for (const subjectId of ["module.old-subject", "module.new-subject"]) {
      expect(graphSubjects).toContainEqual({ authorityClass: "architecture-fact", subjectKind: "subject", subjectId, operation: "reference" });
    }
    expect(graphSubjects).toContainEqual({ authorityClass: "architecture-fact", subjectKind: "relation", subjectId: "rel.api", operation: "delete" });
  });
});

function emptyEvidenceStateFixture() {
  const withoutDigest = {
    schemaVersion: "archcontext.evidence-state-at-cursor/v1" as const,
    evidenceItems: [],
    evidenceBindings: [],
    tombstones: []
  };
  return { ...withoutDigest, stateDigest: digestJson(withoutDigest as unknown as Json) };
}

function stableJsonFixture(value: unknown): string {
  return JSON.stringify(sortJsonFixture(value));
}

function sortJsonFixture(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonFixture);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, sortJsonFixture(entry)]));
}

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

function explorerProjectionFixture(graphLabel = "one", observedLabel = "one"): ExplorerProjectionV2 {
  const occurrenceId = "occurrence.system-map.entity.module.api";
  const compatibilityDigest = digestJson({ compatibility: "system-map" } as unknown as Json);
  const graphDigest = digestJson({ graph: graphLabel } as unknown as Json);
  const evidenceStateDigest = digestJson({ evidence: "state" } as unknown as Json);
  const observedFactsDigest = digestJson({ observed: observedLabel } as unknown as Json);
  const authorityDigest = digestJson({
    source: "git",
    repository: ARCHITECTURE_LEDGER_SCOPE.repository,
    worktree: ARCHITECTURE_LEDGER_SCOPE.worktree,
    cursor: null,
    evidenceCursor: null,
    graphDigest,
    evidenceStateDigest
  } as unknown as Json);
  const readPlanWithoutDigest = {
    schemaVersion: "archcontext.projection-read-plan/v1" as const,
    plannerVersion: "archcontext.projection-read-planner/v1" as const,
    kind: "bounded-context" as const,
    source: "git-authority" as const,
    queryDigest: digestJson({ query: "system-map" } as unknown as Json),
    semanticLevel: "context" as const,
    focusSubjectId: null,
    expandedKinds: [],
    depth: 1 as const,
    limits: { maxEntities: 80, maxRelations: 160, maxConstraints: 160, maxBindings: 320, maxBacklinks: 640, maxGraphRows: 400 },
    requiredDomains: ["authority", "bindings", "evidence", "graph", "observed"] as ("authority" | "bindings" | "evidence" | "graph" | "observed")[],
    ordering: "canonical-id-asc" as const,
    truncation: "hard-limit-with-authoritative-totals" as const
  };
  const readPlan = { ...readPlanWithoutDigest, planDigest: digestJson(readPlanWithoutDigest as unknown as Json) };
  const readSetWithoutDigest = {
    schemaVersion: "archcontext.projection-read-set/v1" as const,
    planDigest: readPlan.planDigest,
    selectedGraphDigest: graphDigest,
    authoritativeTotals: { entities: 1, relations: 0, constraints: 0 },
    entityKindTotals: [{ kind: "module", count: 1 }],
    rowsRead: { entities: 1, relations: 0, constraints: 0, bindings: 0, backlinks: 0 },
    truncated: false
  };
  const readSet = { ...readSetWithoutDigest, readSetDigest: digestJson(readSetWithoutDigest as unknown as Json) };
  const inputManifestWithoutDigest = {
    schemaVersion: "archcontext.projection-input-manifest/v1" as const,
    repository: ARCHITECTURE_LEDGER_SCOPE.repository,
    worktree: ARCHITECTURE_LEDGER_SCOPE.worktree,
    authoritySource: "git" as const,
    authorityCursor: null,
    evidenceAuthorityCursor: null,
    queryDigest: digestJson({ query: "system-map" } as unknown as Json),
    graphDigest,
    evidenceStateDigest,
    observedFactsDigest,
    observedAvailability: { status: "ready" as const },
    bindingsDigest: digestJson([]),
    eventBacklinksDigest: digestJson([]),
    driftDigest: null,
    pressureDigest: null,
    taskSessionDigest: null,
    readPlan,
    readSet,
    inputDomains: {
      authority: { requirement: "required" as const, status: "ready" as const, digest: authorityDigest },
      graph: { requirement: "required" as const, status: "ready" as const, digest: graphDigest },
      evidence: { requirement: "required" as const, status: "ready" as const, digest: evidenceStateDigest },
      observed: { requirement: "required" as const, status: "ready" as const, digest: observedFactsDigest },
      bindings: { requirement: "required" as const, status: "ready" as const, digest: digestJson([]) },
      "event-backlinks": { requirement: "optional" as const, status: "ready" as const, digest: digestJson([]) },
      drift: { requirement: "optional" as const, status: "unavailable" as const, digest: null, reasonCode: "not-provided" },
      pressure: { requirement: "optional" as const, status: "unavailable" as const, digest: null, reasonCode: "not-provided" },
      "task-session": { requirement: "optional" as const, status: "unavailable" as const, digest: null, reasonCode: "not-provided" }
    },
    viewDefinitionDigest: digestJson({ view: "system-map" } as unknown as Json),
    compilerVersion: "archcontext.explorer-view-compiler/v1" as const,
    tokenRequired: true,
    compatibilityDigest
  };
  const inputManifest = {
    ...inputManifestWithoutDigest,
    manifestDigest: digestJson(inputManifestWithoutDigest as unknown as Json)
  };
  const withoutDigest = {
    schemaVersion: "archcontext.explorer-projection/v2" as const,
    view: { id: "system-map" as const, title: "System Map", question: "What exists?" },
    availableViews: [{ id: "system-map" as const, enabled: true }],
    semanticLevel: "context" as const,
    breadcrumbs: [],
    cursor: {
      repository: ARCHITECTURE_LEDGER_SCOPE.repository,
      worktree: ARCHITECTURE_LEDGER_SCOPE.worktree,
      authoritySource: "git" as const,
      authorityCursor: null,
      evidenceAuthorityCursor: null,
      inputManifestDigest: inputManifest.manifestDigest,
      compatibilityDigest,
      graphDigest,
      evidenceStateDigest,
      observedFactsDigest,
      viewDefinitionDigest: digestJson({ view: "system-map" } as unknown as Json),
      compilerVersion: "archcontext.explorer-view-compiler/v1" as const,
      observedAvailability: { status: "ready" as const }
    },
    inputManifest,
    occurrences: [{
      occurrenceId,
      role: "subject" as const,
      subjectRefs: [{ kind: "architecture-entity" as const, id: "module.api" }],
      name: "API",
      kind: "module",
      childrenCount: 0,
      expandable: false,
      verificationStatus: "UNKNOWN" as const,
      authorityState: "DECLARED_UNOBSERVED" as const,
      pressure: { evaluated: true, level: "low" as const, score: 0, signals: [], inputDigest: digestJson({ pressure: "one" } as unknown as Json) },
      sourceSelectors: [{ path: "src/api.ts" }],
      provenance: { declaredEntityIds: ["module.api"], observedSymbolIds: [], evidenceBindingIds: [] },
      inspector: { constraints: [], decisions: [], sourceSelectors: [{ path: "src/api.ts" }], evidenceBindingIds: [] },
      backlinks: { appearsInViews: ["system-map" as const], affectedByTaskSessionIds: [], constrainedByIds: [], evidencedByBindingIds: [], changedByEventIds: [], decidedByEventIds: [], incomingRelationIds: [], outgoingRelationIds: [] }
    }],
    relations: [],
    page: { budget: { maxNodes: 80, maxRelations: 160 }, totalNodes: 1, totalRelations: 0, returnedNodes: 1, returnedRelations: 0, truncated: false, omittedNodeCount: 0, omittedRelationCount: 0 },
    capabilities: { readOnly: true as const, mutationMode: "forbidden" as const, egress: "none" as const, tokenRequired: true }
  };
  return { ...withoutDigest, projectionDigest: digestJson(withoutDigest as unknown as Json) };
}

function ledgerExplorerProjectionFixture(): ExplorerProjectionV2 {
  const projection = explorerProjectionFixture();
  const authorityCursor = {
    schemaVersion: "archcontext.authority-cursor/v1" as const,
    repository: ARCHITECTURE_LEDGER_SCOPE.repository,
    worktree: ARCHITECTURE_LEDGER_SCOPE.worktree,
    eventSequence: 1,
    eventId: "event.cache-fixture",
    eventHash: digestJson({ event: "cache-fixture" } as unknown as Json),
    graphDigest: projection.inputManifest.graphDigest,
    evidenceStateDigest: projection.inputManifest.evidenceStateDigest
  };
  projection.inputManifest.authoritySource = "ledger";
  projection.inputManifest.authorityCursor = authorityCursor;
  projection.inputManifest.evidenceAuthorityCursor = authorityCursor;
  projection.inputManifest.readPlan.source = "verified-ledger-current";
  const { planDigest: _planDigest, ...planWithoutDigest } = projection.inputManifest.readPlan;
  projection.inputManifest.readPlan.planDigest = digestJson(planWithoutDigest as unknown as Json);
  projection.inputManifest.readSet.planDigest = projection.inputManifest.readPlan.planDigest;
  const { readSetDigest: _readSetDigest, ...readSetWithoutDigest } = projection.inputManifest.readSet;
  projection.inputManifest.readSet.readSetDigest = digestJson(readSetWithoutDigest as unknown as Json);
  projection.inputManifest.inputDomains.authority.digest = digestJson({
    source: "ledger",
    repository: projection.inputManifest.repository,
    worktree: projection.inputManifest.worktree,
    cursor: authorityCursor,
    evidenceCursor: authorityCursor,
    graphDigest: projection.inputManifest.graphDigest,
    evidenceStateDigest: projection.inputManifest.evidenceStateDigest
  } as unknown as Json);
  const { manifestDigest: _manifestDigest, ...manifestWithoutDigest } = projection.inputManifest;
  projection.inputManifest.manifestDigest = digestJson(manifestWithoutDigest as unknown as Json);
  projection.cursor.authoritySource = "ledger";
  projection.cursor.authorityCursor = authorityCursor;
  projection.cursor.evidenceAuthorityCursor = authorityCursor;
  projection.cursor.inputManifestDigest = projection.inputManifest.manifestDigest;
  const { projectionDigest: _projectionDigest, ...projectionWithoutDigest } = projection;
  projection.projectionDigest = digestJson(projectionWithoutDigest as unknown as Json);
  return projection;
}

function runtimeAgentJob(suffix: string, input: {
  fingerprint?: string;
  queuedAt?: string;
  headSha?: string;
  branch?: string;
  worktreeDigest?: string;
} = {}): AgentJobV1 {
  const queuedAt = input.queuedAt ?? "2026-06-25T01:00:00.000Z";
  const headSha = input.headSha ?? ARCHITECTURE_LEDGER_SCOPE.worktree.headSha;
  const worktreeDigest = input.worktreeDigest ?? ARCHITECTURE_LEDGER_SCOPE.worktree.worktreeDigest;
  return {
    schemaVersion: "archcontext.agent-job/v1",
    jobId: `agent_job.${suffix}`,
    status: "queued",
    runnerPort: "codex",
    repository: ARCHITECTURE_LEDGER_SCOPE.repository,
    worktree: {
      ...ARCHITECTURE_LEDGER_SCOPE.worktree,
      branch: input.branch ?? ARCHITECTURE_LEDGER_SCOPE.worktree.branch,
      headSha,
      worktreeDigest
    },
    fingerprint: input.fingerprint ?? `fingerprint.${suffix}`,
    trigger: { source: "git_hook", reason: "runtime-job-queue-test" },
    budget: { maxRunsPerTask: 1, maxRunsPerRepositoryPerDay: 4 },
    inputDigest: digestJson({ agentInput: suffix } as unknown as Json),
    promptTemplateDigest: digestJson({ prompt: "runtime-job-queue-test" } as unknown as Json),
    stalePolicy: "cancel-on-head-change",
    directMutationAllowed: false,
    queuedAt,
    updatedAt: queuedAt
  };
}

function architectureLedgerEvent(index: number, priorEvents: ArchitectureEventV1[] = []): ArchitectureEventV1 {
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
    const evidenceItem = {
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
    } satisfies EvidenceItemV2;
    const evidenceBinding = {
      schemaVersion: "archcontext.evidence-binding/v1",
      bindingId: "binding.root",
      evidenceId: "evidence.root",
      target: { kind: "entity", id: "entity.0" },
      bindingReason: "direct-selector",
      authorityEffect: "checkpoint-eligible",
      createdAt: "2026-06-25T00:00:01.000Z",
      provenance
    } satisfies EvidenceBindingV1;
    payload.evidenceOperations = [
      { target: "item", action: "create", evidenceId: evidenceItem.evidenceId, value: evidenceItem },
      { target: "binding", action: "create", bindingId: evidenceBinding.bindingId, value: evidenceBinding }
    ] as unknown as Json;
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

  const baseDigest = architectureLedgerStateDigest(replayArchitectureLedgerEvents(priorEvents));
  const event: ArchitectureEventV1 = {
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: `architecture_event.${String(index).padStart(4, "0")}`,
    eventType: "architecture.graph.update",
    payloadVersion: index === 0 ? ARCHITECTURE_EVIDENCE_LIFECYCLE_PAYLOAD_VERSION : "archcontext.architecture-ledger-payload/v1",
    repository: ARCHITECTURE_LEDGER_SCOPE.repository,
    worktree: ARCHITECTURE_LEDGER_SCOPE.worktree,
    baseDigest,
    resultingDigest: baseDigest,
    headSha: ARCHITECTURE_LEDGER_SCOPE.worktree.headSha,
    actor: { kind: "daemon", id: "archctxd" },
    source: "checkpoint",
    timestamp: `2026-06-25T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
    idempotencyKey: `architecture-ledger-test-${index}`,
    provenance,
    payload: payload as unknown as Json
  };
  return {
    ...event,
    resultingDigest: architectureLedgerStateDigest(replayArchitectureLedgerEvents([...priorEvents, event]))
  };
}

function architectureEvidenceLifecycleEvent(suffix: string, evidenceOperations: EvidenceLifecycleOperationV1[]): ArchitectureEventV1 {
  const graphDigest = architectureLedgerStateDigest({ entities: [], relations: [], constraints: [] });
  return {
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: `architecture_evidence.${suffix}`,
    eventType: "architecture.evidence.lifecycle",
    payloadVersion: ARCHITECTURE_EVIDENCE_LIFECYCLE_PAYLOAD_VERSION,
    repository: ARCHITECTURE_LEDGER_SCOPE.repository,
    worktree: ARCHITECTURE_LEDGER_SCOPE.worktree,
    baseDigest: graphDigest,
    resultingDigest: graphDigest,
    headSha: ARCHITECTURE_LEDGER_SCOPE.worktree.headSha,
    actor: { kind: "daemon", id: "archctxd" },
    source: "apply_update",
    timestamp: "2026-07-11T00:00:00.000Z",
    idempotencyKey: `architecture-evidence-${suffix}`,
    provenance: {
      producer: "local-store-sqlite.test",
      command: "test evidence lifecycle",
      inputDigest: digestJson(evidenceOperations as unknown as Json)
    },
    payload: { summary: `Evidence lifecycle ${suffix}`, evidenceOperations } as unknown as Json
  };
}

function sqliteEvidenceItem(summary: string): EvidenceItemV2 {
  return {
    schemaVersion: "archcontext.evidence-item/v2",
    evidenceId: "evidence.api",
    kind: "architecture-declaration",
    strength: "declared",
    polarity: "positive",
    origin: "runtime-daemon",
    subject: "module.api",
    selector: { kind: "path", id: "module.api", path: "packages/api" },
    summary,
    coverage: { level: "complete", scope: "module.api" },
    supports: ["checkpoint"],
    provenance: { producer: "local-store-sqlite.test", command: "test evidence lifecycle", inputDigest: digestJson({ summary } as unknown as Json) },
    createdAt: "2026-07-11T00:00:00.000Z",
    digest: digestJson({ evidenceId: "evidence.api", summary } as unknown as Json)
  };
}

function sqliteEvidenceBinding(evidenceId: string): EvidenceBindingV1 {
  return {
    schemaVersion: "archcontext.evidence-binding/v1",
    bindingId: "binding.api",
    evidenceId,
    target: { kind: "entity", id: "module.api" },
    bindingReason: "direct-selector",
    authorityEffect: "checkpoint-eligible",
    createdAt: "2026-07-11T00:00:00.000Z",
    provenance: { producer: "local-store-sqlite.test", command: "test evidence lifecycle", inputDigest: digestJson({ evidenceId } as unknown as Json) }
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

async function sqliteRun(databasePath: string, sql: string, params: unknown[] = []): Promise<void> {
  const bunSqlite = await import("bun:sqlite");
  const db = new (bunSqlite as any).Database(databasePath);
  try {
    db.query(sql).run(...params);
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

async function writeOldRuntimeTarget(databasePath: string, taskSessionId: string, state: unknown): Promise<void> {
  mkdirSync(dirname(databasePath), { recursive: true });
  const bunSqlite = await import("bun:sqlite");
  const db = new (bunSqlite as any).Database(databasePath, { create: true });
  try {
    for (const pragma of SQLITE_PRAGMAS) db.exec(pragma);
    for (const migration of LOCAL_SQLITE_MIGRATIONS.slice(0, 6)) {
      for (const statement of migration.statements) db.exec(statement);
      db.query("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, "2026-06-23T00:00:00.000Z");
    }
    db.query("INSERT OR REPLACE INTO task_states (task_session_id, payload_json, updated_at) VALUES (?, ?, ?)").run(
      taskSessionId,
      JSON.stringify(state),
      "2026-06-23T00:00:00.000Z"
    );
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
