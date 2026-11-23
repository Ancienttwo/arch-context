import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { digestJson, type ArchitectureDebtReportV1 } from "@archcontext/contracts";
import { createLandscape } from "@archcontext/core/architecture-domain";
import { acquireLocalStoreWriterOwnership, localStoreWriterOwnershipPath, SqliteLocalStore, type ArchitectureDebtBaseCacheKey } from "../src/index";

const tempDirs: string[] = [];
const openStores: SqliteLocalStore[] = [];

afterEach(() => {
  for (const store of openStores.splice(0)) store.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeTempDb(name = "runtime.sqlite"): string {
  const dir = mkdtempSync(join(tmpdir(), "archctx-sqlite-cache-"));
  tempDirs.push(dir);
  return join(dir, name);
}

describe("@archcontext/local-runtime/local-store-sqlite discardable cache", () => {
  test("creates only the 3 cache tables with application_id=0x41435458, user_version=200 and busy_timeout=5000", async () => {
    const dbPath = makeTempDb();
    const store = new SqliteLocalStore(dbPath);
    openStores.push(store);
    await store.migrate();
    store.close();

    const raw = new Database(dbPath, { readonly: true });
    try {
      const tables = raw.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name)).toEqual(["architecture_debt_base_cache", "external_docs_cache", "kv_cache"]);
      expect((raw.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(200);
      expect((raw.query("PRAGMA application_id").get() as { application_id: number }).application_id).toBe(0x41435458);
    } finally {
      raw.close();
    }
  });

  test("rebuilds proven legacy ArchContext v1 stores, upgrades v2 caches lacking application_id, and fails closed on foreign overlapping tables", async () => {
    // 1. Real v0.17.1 full runtime store (6 immutable 0001 tables + FK-linked events/evidence/receipts + triggers + FTS5 + legacy view + schema_migrations)
    const legacyV1Path = makeTempDb("legacy-v1.sqlite");
    const legacyV1 = new Database(legacyV1Path);
    legacyV1.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE repository_sessions (repository_id TEXT PRIMARY KEY, root TEXT NOT NULL, head_sha TEXT NOT NULL, worktree_digest TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE snapshots (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, head_sha TEXT NOT NULL, worktree_digest TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, committed_at TEXT);
      CREATE TABLE task_states (task_session_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE observed_evidence (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, head_sha TEXT NOT NULL, selector_json TEXT NOT NULL, summary TEXT NOT NULL, confidence TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE review_results (review_id TEXT PRIMARY KEY, task_session_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE changeset_journal (
        journal_id TEXT PRIMARY KEY,
        changeset_id TEXT NOT NULL,
        root TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        files_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE projection_apply_receipts (
        lookup_key TEXT PRIMARY KEY,
        apply_id TEXT NOT NULL UNIQUE,
        journal_id TEXT NOT NULL UNIQUE,
        receipt_json TEXT NOT NULL,
        refresh_consumed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        recovery_proof_json TEXT,
        FOREIGN KEY(journal_id) REFERENCES changeset_journal(journal_id)
      );
      CREATE TABLE architecture_events (
        event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        repository_id TEXT NOT NULL,
        storage_repository_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        worktree_digest TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_version TEXT NOT NULL,
        source TEXT NOT NULL,
        actor_kind TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        base_digest TEXT NOT NULL,
        resulting_digest TEXT NOT NULL,
        previous_event_hash TEXT,
        event_hash TEXT NOT NULL UNIQUE,
        idempotency_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        event_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        compacted_by_snapshot_id TEXT
      );
      CREATE TABLE evidence_items (
        evidence_id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        storage_repository_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        strength TEXT NOT NULL,
        polarity TEXT NOT NULL,
        origin TEXT NOT NULL,
        subject TEXT NOT NULL,
        selector_json TEXT NOT NULL,
        summary TEXT NOT NULL,
        coverage_json TEXT NOT NULL,
        supports_json TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        digest TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(event_id) REFERENCES architecture_events(event_id) ON DELETE RESTRICT
      );
      CREATE TABLE evidence_bindings (
        binding_id TEXT PRIMARY KEY,
        evidence_id TEXT NOT NULL,
        repository_id TEXT NOT NULL,
        storage_repository_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        binding_reason TEXT NOT NULL,
        authority_effect TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        binding_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(event_id) REFERENCES architecture_events(event_id) ON DELETE RESTRICT,
        FOREIGN KEY(evidence_id) REFERENCES evidence_items(evidence_id) ON DELETE RESTRICT
      );
      CREATE TABLE architecture_evidence_state_checkpoints (
        storage_repository_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        event_id TEXT PRIMARY KEY,
        event_sequence INTEGER NOT NULL,
        scope_event_count INTEGER NOT NULL,
        event_hash TEXT NOT NULL,
        evidence_state_digest TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(event_id) REFERENCES architecture_events(event_id)
      );
      CREATE TRIGGER architecture_events_immutable_delete
        BEFORE DELETE ON architecture_events
        BEGIN
          SELECT RAISE(ABORT, 'architecture-events-immutable');
        END;
      CREATE TRIGGER architecture_evidence_state_checkpoints_immutable_delete
        BEFORE DELETE ON architecture_evidence_state_checkpoints
        BEGIN
          SELECT RAISE(ABORT, 'architecture-evidence-state-checkpoints-immutable');
        END;
      CREATE VIRTUAL TABLE architecture_ledger_fts USING fts5(kind, summary, rationale, title, evidence_summary, content='');
      CREATE VIEW recent_architecture_changes_view AS
        SELECT event_sequence, event_id, storage_repository_id, storage_workspace_id, branch, head_sha, event_type,
          source, actor_kind, actor_id, previous_event_hash, event_hash, created_at
        FROM architecture_events ORDER BY event_sequence DESC;
      INSERT INTO schema_migrations (id, applied_at) VALUES
        ('0001_runtime_state', '2026-11-20T00:00:00.000Z'),
        ('0004_changeset_journal', '2026-11-20T00:00:00.000Z'),
        ('0006_architecture_ledger', '2026-11-20T00:00:00.000Z'),
        ('0018_immutable_evidence_checkpoints', '2026-11-20T00:00:00.000Z'),
        ('0019_projection_apply_receipts', '2026-11-20T00:00:00.000Z');
      INSERT INTO changeset_journal VALUES ('j1', 'cs1', '/repo', 'applied', '{}', '[]', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z');
      INSERT INTO projection_apply_receipts VALUES ('lk1', 'ap1', 'j1', '{}', NULL, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', NULL);
      INSERT INTO architecture_events (
        event_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id,
        branch, head_sha, worktree_digest, event_type, payload_version, source, actor_kind, actor_id,
        base_digest, resulting_digest, previous_event_hash, event_hash, idempotency_key,
        payload_json, provenance_json, event_json, created_at, compacted_by_snapshot_id
      ) VALUES (
        'ev1', 'r1', 'sr1', 'w1', 'sw1', 'main', 'abc', 'wt1', 'changeset.applied', 'v1', 'cli', 'user', 'u1',
        'b1', 'r2', NULL, 'eh1', 'ik1', '{}', '{}', '{}', '2026-11-20T00:00:00.000Z', NULL
      );
      INSERT INTO evidence_items VALUES (
        'ei1', 'r1', 'sr1', 'w1', 'sw1', 'ev1', 'test', 'strong', 'positive', 'cli', 'subj', '{}', 'ok', '{}', '[]', '{}', '{}', 'd1', '2026-11-20T00:00:00.000Z'
      );
      INSERT INTO evidence_bindings VALUES (
        'eb1', 'ei1', 'r1', 'sr1', 'w1', 'sw1', 'ev1', 'module', 'm1', 'reason', 'supporting', '{}', '{}', '2026-11-20T00:00:00.000Z'
      );
      INSERT INTO architecture_evidence_state_checkpoints VALUES ('sr1', 'sw1', 'ev1', 1, 1, 'eh1', 'ed1', '2026-11-20T00:00:00.000Z');
    `);
    legacyV1.close();

    const store = new SqliteLocalStore(legacyV1Path);
    openStores.push(store);
    await store.writeCacheEntry("ns", "k1", { ok: true });
    expect(await store.readCacheEntry("ns", "k1")).toEqual({ ok: true });
    store.close();

    const migratedRaw = new Database(legacyV1Path, { readonly: true });
    try {
      const objects = migratedRaw.query("SELECT type, name FROM sqlite_master WHERE type IN ('table', 'view', 'trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ type: string; name: string }>;
      expect(objects).toEqual([
        { type: "table", name: "architecture_debt_base_cache" },
        { type: "table", name: "external_docs_cache" },
        { type: "table", name: "kv_cache" }
      ]);
      expect((migratedRaw.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(200);
      expect((migratedRaw.query("PRAGMA application_id").get() as { application_id: number }).application_id).toBe(0x41435458);
    } finally {
      migratedRaw.close();
    }

    // 2. Real v0.17.1 standalone architecture_debt_base_cache DB
    const legacyDebtPath = makeTempDb("legacy-debt.sqlite");
    const legacyDebt = new Database(legacyDebtPath);
    legacyDebt.exec(`
      CREATE TABLE architecture_debt_base_cache (
        repository_id TEXT NOT NULL,
        base_sha TEXT NOT NULL,
        archcontext_tree_oid TEXT NOT NULL,
        codegraph_version TEXT NOT NULL,
        engine_version TEXT NOT NULL,
        measurement_profile TEXT NOT NULL,
        report_json TEXT NOT NULL,
        PRIMARY KEY (repository_id, base_sha, archcontext_tree_oid, codegraph_version, engine_version, measurement_profile)
      );
    `);
    legacyDebt.close();
    const debtStore = new SqliteLocalStore(legacyDebtPath);
    openStores.push(debtStore);
    await debtStore.writeCacheEntry("ns", "k-debt", { rebuilt: true });
    expect(await debtStore.readCacheEntry("ns", "k-debt")).toEqual({ rebuilt: true });
    debtStore.close();

    // 3. Existing 0.18.0/0.18.1 v2 cache (user_version=200, application_id=0, optional orphaned v1 views) preserves data, drops orphaned views, and stamps application_id
    const v2LegacyAppIdPath = makeTempDb("v2-zero-appid.sqlite");
    const v2Zero = new Database(v2LegacyAppIdPath);
    v2Zero.exec(`
      CREATE TABLE architecture_debt_base_cache (cache_key TEXT PRIMARY KEY, report_json TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE external_docs_cache (
        provider TEXT NOT NULL, library_id TEXT NOT NULL, version TEXT NOT NULL, query_digest TEXT NOT NULL,
        content_digest TEXT NOT NULL, resource_json TEXT NOT NULL, retrieved_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        PRIMARY KEY (provider, library_id, version, query_digest)
      );
      CREATE TABLE kv_cache (
        namespace TEXT NOT NULL, cache_key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (namespace, cache_key)
      );
      CREATE VIEW recent_architecture_changes_view AS SELECT 1;
      INSERT INTO kv_cache (namespace, cache_key, value_json, updated_at) VALUES ('ns', 'keep', '{"preserved":1}', '2026-11-23T00:00:00.000Z');
      PRAGMA user_version = 200;
    `);
    v2Zero.close();
    const v2Store = new SqliteLocalStore(v2LegacyAppIdPath);
    openStores.push(v2Store);
    expect(await v2Store.readCacheEntry("ns", "keep")).toEqual({ preserved: 1 });
    v2Store.close();
    const v2Check = new Database(v2LegacyAppIdPath, { readonly: true });
    try {
      expect((v2Check.query("PRAGMA application_id").get() as { application_id: number }).application_id).toBe(0x41435458);
      expect(v2Check.query("SELECT type, name FROM sqlite_master WHERE type = 'view'").all()).toEqual([]);
    } finally {
      v2Check.close();
    }

    // 4. Negative: overlapping table names (schema_migrations, snapshots, waivers, kv_cache) with non-ArchContext schema & active WAL sidecars
    const overlappingPath = makeTempDb("overlapping.sqlite");
    const overlappingDb = new Database(overlappingPath);
    try {
      overlappingDb.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE snapshots (id INTEGER PRIMARY KEY, payload BLOB NOT NULL);
        CREATE TABLE waivers (id INTEGER PRIMARY KEY, ticket TEXT NOT NULL);
        CREATE TABLE kv_cache (k TEXT PRIMARY KEY, v TEXT NOT NULL);
        INSERT INTO schema_migrations VALUES (1, 'foreign_v1');
        INSERT INTO waivers VALUES (42, 'SEC-42');
      `);
      const walPath = `${overlappingPath}-wal`;
      const shmPath = `${overlappingPath}-shm`;
      const dbBytesBefore = readFileSync(overlappingPath);
      const walBytesBefore = readFileSync(walPath);
      const shmBytesBefore = readFileSync(shmPath);
      expect(walBytesBefore.length).toBeGreaterThan(0);
      expect(shmBytesBefore.length).toBeGreaterThan(0);

      const overlappingStore = new SqliteLocalStore(overlappingPath);
      openStores.push(overlappingStore);
      await expect(overlappingStore.writeCacheEntry("ns", "clobber", { blocked: true })).rejects.toMatchObject({
        code: "AC_PRECONDITION_FAILED",
        reasonCode: "local-store-unproven-file"
      });
      expect(readFileSync(overlappingPath)).toEqual(dbBytesBefore);
      expect(readFileSync(walPath)).toEqual(walBytesBefore);
      expect(readFileSync(shmPath)).toEqual(shmBytesBefore);
      expect(readdirSync(dirname(overlappingPath)).sort()).toEqual(["overlapping.sqlite", "overlapping.sqlite-shm", "overlapping.sqlite-wal"]);
    } finally {
      overlappingDb.close();
    }

    // 5. Negative: unknown views, spoofed user_version=200 with wrong columns, foreign application_id, and non-SQLite file
    const unknownViewPath = makeTempDb("unknown-view-v200.sqlite");
    const unknownViewDb = new Database(unknownViewPath);
    unknownViewDb.exec(`
      CREATE TABLE architecture_debt_base_cache (cache_key TEXT PRIMARY KEY, report_json TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE external_docs_cache (
        provider TEXT NOT NULL, library_id TEXT NOT NULL, version TEXT NOT NULL, query_digest TEXT NOT NULL,
        content_digest TEXT NOT NULL, resource_json TEXT NOT NULL, retrieved_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        PRIMARY KEY (provider, library_id, version, query_digest)
      );
      CREATE TABLE kv_cache (
        namespace TEXT NOT NULL, cache_key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (namespace, cache_key)
      );
      CREATE VIEW custom_app_view AS SELECT 1;
      PRAGMA user_version = 200;
    `);
    unknownViewDb.close();
    const unknownViewBefore = readFileSync(unknownViewPath);
    const unknownViewStore = new SqliteLocalStore(unknownViewPath);
    openStores.push(unknownViewStore);
    await expect(unknownViewStore.writeCacheEntry("ns", "k1b", { blocked: true })).rejects.toMatchObject({
      code: "AC_PRECONDITION_FAILED",
      reasonCode: "local-store-unproven-file"
    });
    expect(readFileSync(unknownViewPath)).toEqual(unknownViewBefore);
    expect(readdirSync(dirname(unknownViewPath)).sort()).toEqual(["unknown-view-v200.sqlite"]);

    const spoofedPath = makeTempDb("spoofed-v200.sqlite");
    const spoofedDb = new Database(spoofedPath);
    spoofedDb.exec("CREATE TABLE architecture_debt_base_cache (cache_key TEXT PRIMARY KEY, report_json TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE external_docs_cache (id TEXT PRIMARY KEY); CREATE TABLE kv_cache (k TEXT PRIMARY KEY, v TEXT NOT NULL); PRAGMA user_version = 200;");
    spoofedDb.close();
    const spoofedBytes = readFileSync(spoofedPath);
    const spoofedStore = new SqliteLocalStore(spoofedPath);
    openStores.push(spoofedStore);
    await expect(spoofedStore.writeCacheEntry("ns", "k2", { blocked: true })).rejects.toMatchObject({
      code: "AC_PRECONDITION_FAILED",
      reasonCode: "local-store-unproven-file"
    });
    expect(readFileSync(spoofedPath)).toEqual(spoofedBytes);
    expect(readdirSync(dirname(spoofedPath)).sort()).toEqual(["spoofed-v200.sqlite"]);

    const foreignAppIdPath = makeTempDb("foreign-appid.sqlite");
    const foreignAppDb = new Database(foreignAppIdPath);
    foreignAppDb.exec("CREATE TABLE kv_cache (namespace TEXT NOT NULL, cache_key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (namespace, cache_key)); PRAGMA application_id = 123456;");
    foreignAppDb.close();
    const foreignAppBytes = readFileSync(foreignAppIdPath);
    const foreignAppStore = new SqliteLocalStore(foreignAppIdPath);
    openStores.push(foreignAppStore);
    await expect(foreignAppStore.writeCacheEntry("ns", "k3", { blocked: true })).rejects.toMatchObject({
      code: "AC_PRECONDITION_FAILED",
      reasonCode: "local-store-unproven-file"
    });
    expect(readFileSync(foreignAppIdPath)).toEqual(foreignAppBytes);
    expect(readdirSync(dirname(foreignAppIdPath)).sort()).toEqual(["foreign-appid.sqlite"]);

    const corruptPath = makeTempDb("corrupt.sqlite");
    writeFileSync(corruptPath, "not-a-sqlite-database\n", "utf8");
    const corruptStore = new SqliteLocalStore(corruptPath);
    openStores.push(corruptStore);
    await expect(corruptStore.writeCacheEntry("ns", "k4", { blocked: true })).rejects.toMatchObject({
      code: "AC_PRECONDITION_FAILED",
      reasonCode: "local-store-unproven-file"
    });
    expect(readFileSync(corruptPath, "utf8")).toBe("not-a-sqlite-database\n");
    expect(readdirSync(dirname(corruptPath)).sort()).toEqual(["corrupt.sqlite"]);
  });

  test("persists debt base, external docs, landscape sessions, and kv entries", async () => {
    const dbPath = makeTempDb("cache.sqlite");
    const store = new SqliteLocalStore(dbPath);
    openStores.push(store);
    const key: ArchitectureDebtBaseCacheKey = {
      repositoryId: "repo.1",
      baseSha: "abc123",
      archcontextTreeOid: null,
      codeGraphVersion: "1.6.4",
      engineVersion: "0.17.1/2",
      measurementProfile: "edit-time"
    };
    const report = { schemaVersion: "archcontext.architecture-debt/v1", checks: [], items: [], digest: digestJson({ ok: true }), coverage: "complete", coverageReasonCodes: [] } as unknown as ArchitectureDebtReportV1;
    await store.saveArchitectureDebtBase(key, report);
    expect(await store.readArchitectureDebtBase(key)).toEqual(report);

    const contentDigest = digestJson({ content: "hooks" });
    await store.saveExternalDocumentation({
      provider: "context7",
      libraryId: "/facebook/react",
      version: "18.2.0",
      queryDigest: digestJson({ q: "hooks" }),
      contentDigest,
      resource: {
        schemaVersion: "archcontext.external-document/v1",
        uri: `context7:///facebook/react/${contentDigest}`,
        provider: "context7",
        libraryId: "/facebook/react",
        queryDigest: digestJson({ q: "hooks" }),
        contentDigest,
        retrievedAt: "2026-11-22T00:00:00.000Z",
        expiresAt: "2026-11-23T00:00:00.000Z",
        trust: "external-unverified",
        enforcement: "advisory-only",
        byteCount: 0,
        snippets: [],
        cacheStatus: "fresh",
        warning: "untrusted-documentation-data"
      },
      retrievedAt: "2026-11-22T00:00:00.000Z",
      expiresAt: "2026-11-23T00:00:00.000Z"
    });
    expect(await store.listExternalDocumentation("context7")).toHaveLength(1);
    expect(await store.purgeExternalDocumentation({ provider: "context7", libraryId: "/facebook/react" })).toBe(1);

    const landscape = createLandscape({ id: "local", name: "Local", repositories: [] });
    await store.saveLandscape(landscape);
    await store.saveRepositorySession({ repositoryId: "repo.1", root: "/tmp/repo", headSha: "abc", worktreeDigest: digestJson({}), updatedAt: "2026-11-22T00:00:00.000Z" });
    expect(await store.commitRepositoryRemoval("repo.1", landscape)).toBe(true);
    expect(await store.listRepositorySessions()).toEqual([]);
    expect(await store.readLandscape(landscape.id)).toEqual(landscape);
  });

  test("acquireLocalStoreWriterOwnership uses O_EXCL lock with stale-PID recovery and ignores legacy .writer.lock", () => {
    const dbPath = makeTempDb("locked.sqlite");
    writeFileSync(`${dbPath}.writer.lock`, "", "utf8");
    const lockPath = localStoreWriterOwnershipPath(dbPath);
    const first = acquireLocalStoreWriterOwnership(dbPath);
    expect(existsSync(lockPath)).toBe(true);
    expect(() => acquireLocalStoreWriterOwnership(dbPath)).toThrow();
    first.release();
    expect(existsSync(lockPath)).toBe(false);

    writeFileSync(lockPath, JSON.stringify({ pid: 99999999, databasePath: dbPath, token: "stale" }), "utf8");
    const recovered = acquireLocalStoreWriterOwnership(dbPath);
    const body = JSON.parse(readFileSync(lockPath, "utf8")) as { pid: number };
    expect(body.pid).toBe(process.pid);
    recovered.release();
    expect(existsSync(lockPath)).toBe(false);
  });
});
