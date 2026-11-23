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

  test("preserves proven v2 caches (stamping application_id) and fails closed on legacy or unproven stores without DROP", async () => {
    // 1. Existing 0.18.0-0.18.3 v2 cache (user_version=200, application_id=0, exact 3 v2 tables) preserves data and stamps application_id
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
      expect(v2Check.query("SELECT type, name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()).toEqual([
        { type: "table", name: "architecture_debt_base_cache" },
        { type: "table", name: "external_docs_cache" },
        { type: "table", name: "kv_cache" }
      ]);
    } finally {
      v2Check.close();
    }

    // 2. Negative: overlapping table names (schema_migrations, snapshots, waivers, kv_cache) with non-ArchContext schema & active WAL sidecars
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

    // 3. Negative: authentic legacy v1 stores, generated-column/index extensions (r4664702098), and altered/corrupt v2 files all fail closed unchanged
    const v2BaseSql = `
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
      PRAGMA user_version = 200;
    `;
    const legacyCoreSql = `
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE repository_sessions (repository_id TEXT PRIMARY KEY, root TEXT NOT NULL, head_sha TEXT NOT NULL, worktree_digest TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE snapshots (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, head_sha TEXT NOT NULL, worktree_digest TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, committed_at TEXT);
      CREATE TABLE task_states (task_session_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE observed_evidence (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, head_sha TEXT NOT NULL, selector_json TEXT NOT NULL, summary TEXT NOT NULL, confidence TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE review_results (review_id TEXT PRIMARY KEY, task_session_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO schema_migrations (id, applied_at) VALUES ('0001_runtime_state', '2026-11-20T00:00:00.000Z');
    `;
    const waiversTableSql = `
      CREATE TABLE waivers (
        waiver_id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        storage_repository_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        waiver_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT
      );
    `;
    const unmodifiableCases: Array<{ name: string; sql?: string; rawText?: string }> = [
      {
        name: "v0171-legacy-full.sqlite",
        sql: `${legacyCoreSql}
          ${waiversTableSql}
          CREATE VIRTUAL TABLE architecture_ledger_fts USING fts5(kind, summary, rationale, title, evidence_summary, content='');
          CREATE VIEW recent_architecture_changes_view AS SELECT id FROM snapshots;
          INSERT INTO waivers VALUES ('wv1', 'r1', 'sr1', 'w1', 'sw1', 'ev1', 'module', 'm1', '{}', '2026-11-20T00:00:00.000Z', NULL);`
      },
      {
        name: "v0171-legacy-generated-col-index.sqlite",
        sql: `${legacyCoreSql}
          CREATE TABLE waivers (
            waiver_id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, storage_repository_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL, storage_workspace_id TEXT NOT NULL, event_id TEXT NOT NULL,
            target_kind TEXT NOT NULL, target_id TEXT NOT NULL, waiver_json TEXT NOT NULL,
            created_at TEXT NOT NULL, expires_at TEXT,
            local_reporting TEXT GENERATED ALWAYS AS (waiver_id || ':' || target_id) STORED
          );
          CREATE INDEX custom_reporting_idx ON waivers(local_reporting);
          INSERT INTO waivers (waiver_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, event_id, target_kind, target_id, waiver_json, created_at, expires_at)
            VALUES ('wv1', 'r1', 'sr1', 'w1', 'sw1', 'ev1', 'module', 'm1', '{}', '2026-11-20T00:00:00.000Z', NULL);`
      },
      {
        name: "v0171-legacy-debt-cache.sqlite",
        sql: `CREATE TABLE architecture_debt_base_cache (
          repository_id TEXT NOT NULL, base_sha TEXT NOT NULL, archcontext_tree_oid TEXT NOT NULL,
          codegraph_version TEXT NOT NULL, engine_version TEXT NOT NULL, measurement_profile TEXT NOT NULL,
          report_json TEXT NOT NULL,
          PRIMARY KEY (repository_id, base_sha, archcontext_tree_oid, codegraph_version, engine_version, measurement_profile)
        );`
      },
      {
        name: "v2-generated-col.sqlite",
        sql: `
          CREATE TABLE architecture_debt_base_cache (cache_key TEXT PRIMARY KEY, report_json TEXT NOT NULL, updated_at TEXT NOT NULL);
          CREATE TABLE external_docs_cache (
            provider TEXT NOT NULL, library_id TEXT NOT NULL, version TEXT NOT NULL, query_digest TEXT NOT NULL,
            content_digest TEXT NOT NULL, resource_json TEXT NOT NULL, retrieved_at TEXT NOT NULL, expires_at TEXT NOT NULL,
            PRIMARY KEY (provider, library_id, version, query_digest)
          );
          CREATE TABLE kv_cache (
            namespace TEXT NOT NULL, cache_key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL,
            extra_gen TEXT GENERATED ALWAYS AS (namespace || ':' || cache_key) STORED,
            PRIMARY KEY (namespace, cache_key)
          );
          PRAGMA user_version = 200;`
      },
      {
        name: "v2-custom-index.sqlite",
        sql: `${v2BaseSql} CREATE INDEX custom_kv_idx ON kv_cache(updated_at);`
      },
      {
        name: "v2-view.sqlite",
        sql: `${v2BaseSql} CREATE VIEW recent_architecture_changes_view AS SELECT 1;`
      },
      {
        name: "v2-trigger.sqlite",
        sql: `${v2BaseSql} CREATE TRIGGER v2_custom_trigger AFTER INSERT ON kv_cache BEGIN SELECT 1; END;`
      },
      {
        name: "v2-extra-check.sqlite",
        sql: `
          CREATE TABLE architecture_debt_base_cache (cache_key TEXT PRIMARY KEY, report_json TEXT NOT NULL, updated_at TEXT NOT NULL);
          CREATE TABLE external_docs_cache (
            provider TEXT NOT NULL, library_id TEXT NOT NULL, version TEXT NOT NULL, query_digest TEXT NOT NULL,
            content_digest TEXT NOT NULL, resource_json TEXT NOT NULL, retrieved_at TEXT NOT NULL, expires_at TEXT NOT NULL,
            PRIMARY KEY (provider, library_id, version, query_digest)
          );
          CREATE TABLE kv_cache (
            namespace TEXT NOT NULL CHECK(length(namespace) > 0), cache_key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL,
            PRIMARY KEY (namespace, cache_key)
          );
          PRAGMA user_version = 200;`
      },
      {
        name: "spoofed-v200.sqlite",
        sql: "CREATE TABLE architecture_debt_base_cache (cache_key TEXT PRIMARY KEY, report_json TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE external_docs_cache (id TEXT PRIMARY KEY); CREATE TABLE kv_cache (k TEXT PRIMARY KEY, v TEXT NOT NULL); PRAGMA user_version = 200;"
      },
      {
        name: "foreign-appid.sqlite",
        sql: "CREATE TABLE kv_cache (namespace TEXT NOT NULL, cache_key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (namespace, cache_key)); PRAGMA application_id = 123456;"
      },
      {
        name: "corrupt.sqlite",
        rawText: "not-a-sqlite-database\n"
      }
    ];
    for (const testCase of unmodifiableCases) {
      const targetPath = makeTempDb(testCase.name);
      if (testCase.rawText !== undefined) {
        writeFileSync(targetPath, testCase.rawText, "utf8");
      } else {
        const rawDb = new Database(targetPath);
        rawDb.exec(testCase.sql!);
        rawDb.close();
      }
      const bytesBefore = readFileSync(targetPath);
      const storeAttempt = new SqliteLocalStore(targetPath);
      openStores.push(storeAttempt);
      await expect(storeAttempt.writeCacheEntry("ns", "blocked", { blocked: true })).rejects.toMatchObject({
        code: "AC_PRECONDITION_FAILED",
        reasonCode: "local-store-unproven-file"
      });
      expect(readFileSync(targetPath)).toEqual(bytesBefore);
      expect(readdirSync(dirname(targetPath)).sort()).toEqual([testCase.name]);
    }
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
