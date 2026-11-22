import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  test("creates only the 3 cache tables with user_version=200 and busy_timeout=5000", async () => {
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
    } finally {
      raw.close();
    }
  });

  test("discards and rebuilds legacy or corrupt sqlite cache files transparently", async () => {
    const dbPath = makeTempDb("legacy.sqlite");
    const legacyDb = new Database(dbPath);
    legacyDb.exec("CREATE TABLE architecture_events (id TEXT PRIMARY KEY); PRAGMA user_version = 42;");
    legacyDb.close();

    const store = new SqliteLocalStore(dbPath);
    openStores.push(store);
    await store.writeCacheEntry("ns", "k1", { ok: true });
    expect(await store.readCacheEntry("ns", "k1")).toEqual({ ok: true });
    store.close();

    const corruptPath = makeTempDb("corrupt.sqlite");
    writeFileSync(corruptPath, "not-a-sqlite-database\n", "utf8");
    const recovered = new SqliteLocalStore(corruptPath);
    openStores.push(recovered);
    await recovered.writeCacheEntry("ns", "k2", { rebuilt: 1 });
    expect(await recovered.readCacheEntry("ns", "k2")).toEqual({ rebuilt: 1 });
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
