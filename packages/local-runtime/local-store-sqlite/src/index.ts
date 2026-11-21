import { digestJson, FailureError, type ArchitectureDebtReportV1, type ExternalDocumentationCacheEntry, type ExternalDocumentationProvider, type Json, type LocalStorePort } from "@archcontext/contracts";
import type { CrossRepoRelation, Landscape } from "@archcontext/core/architecture-domain";
import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { ARCHCONTEXT_LOCAL_STORE_PATH_ENV, runtimeStatePaths } from "../../runtime-state-paths/src/index";
export { ARCHCONTEXT_STATE_DIR_ENV, ARCHCONTEXT_LOCAL_STORE_PATH_ENV, defaultArchContextStateRoot, runtimeStatePaths, type RuntimeStatePaths } from "../../runtime-state-paths/src/index";

const runtimeRequire = createRequire(import.meta.url);
const LOCAL_CACHE_SCHEMA_VERSION = 200;
const LOCK_ATTEMPTS = 6;
const LOCK_RETRY_MS = 20;

export const LOCAL_STORE_WRITER_OWNED_ERROR = "local-store-writer-owned";
export const SQLITE_PRAGMAS = ["PRAGMA journal_mode = WAL;", "PRAGMA synchronous = NORMAL;", "PRAGMA busy_timeout = 5000;"] as const;

export interface ArchitectureDebtBaseCacheKey {
  repositoryId: string;
  baseSha: string;
  archcontextTreeOid: string | null;
  codeGraphVersion: string;
  engineVersion: string;
  measurementProfile: "edit-time" | "complete";
}

export interface PersistedRepositorySession {
  repositoryId: string;
  root: string;
  headSha: string;
  worktreeDigest: string;
  updatedAt: string;
}

export interface LocalStoreWriterOwnership {
  release(): void;
}

export interface RuntimeLocalStore extends LocalStorePort {
  readArchitectureDebtBase(key: ArchitectureDebtBaseCacheKey): Promise<ArchitectureDebtReportV1 | undefined>;
  saveArchitectureDebtBase(key: ArchitectureDebtBaseCacheKey, report: ArchitectureDebtReportV1): Promise<void>;
  saveRepositorySession(session: PersistedRepositorySession): Promise<void>;
  listRepositorySessions(): Promise<PersistedRepositorySession[]>;
  commitRepositoryRemoval(repositoryId: string, landscape?: Landscape): Promise<boolean>;
  saveLandscape(landscape: Landscape): Promise<void>;
  readLandscape(landscapeId: string): Promise<Landscape | undefined>;
  saveCrossRepoRelation(relation: CrossRepoRelation): Promise<void>;
  listCrossRepoRelations(landscape?: Landscape): Promise<CrossRepoRelation[]>;
  saveExternalDocumentation(entry: ExternalDocumentationCacheEntry): Promise<void>;
  readExternalDocumentation(input: { provider: ExternalDocumentationProvider; libraryId: string; version: string; queryDigest: string }): Promise<ExternalDocumentationCacheEntry | undefined>;
  readExternalDocumentationByContentDigest(input: { provider: ExternalDocumentationProvider; contentDigest: string }): Promise<ExternalDocumentationCacheEntry | undefined>;
  listExternalDocumentation(provider?: ExternalDocumentationProvider): Promise<ExternalDocumentationCacheEntry[]>;
  purgeExternalDocumentation(input: { provider?: ExternalDocumentationProvider; libraryId?: string; all?: boolean }): Promise<number>;
  readCacheEntry<T = unknown>(namespace: string, cacheKey: string): Promise<T | undefined>;
  writeCacheEntry(namespace: string, cacheKey: string, value: unknown): Promise<void>;
  deleteCacheEntry(namespace: string, cacheKey: string): Promise<void>;
  listCacheEntries<T = unknown>(namespace: string): Promise<Array<{ cacheKey: string; value: T; updatedAt: string }>>;
  acquireWriterOwnership?(): void;
  close(): void;
}

export function defaultLocalStorePath(root = process.cwd()): string {
  return runtimeStatePaths(root).localStorePath;
}

export function localStoreWriterOwnershipPath(databasePath: string): string {
  return `${databasePath}.cache.lock`;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") try { chmodSync(dir, 0o700); } catch {}
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Acquires an exclusive advisory lock file via atomic O_CREAT|O_EXCL (`wx`) with stale-PID cleanup. */
export function acquireLocalStoreWriterOwnership(databasePath: string): LocalStoreWriterOwnership {
  const lockPath = localStoreWriterOwnershipPath(databasePath);
  ensurePrivateDir(dirname(lockPath));
  const token = randomUUID();
  const payload = JSON.stringify({ pid: process.pid, databasePath, acquiredAt: new Date().toISOString(), token });
  for (let attempt = 1; ; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      try { writeSync(fd, payload, undefined, "utf8"); }
      finally { closeSync(fd); }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let holderPid: number | undefined;
      try {
        const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown };
        if (typeof parsed.pid === "number") holderPid = parsed.pid;
      } catch {}
      const staleUnreadable = holderPid === undefined && (() => { try { return statSync(lockPath).mtimeMs < Date.now() - 5_000; } catch { return false; } })();
      if ((holderPid !== undefined && !isProcessAlive(holderPid)) || staleUnreadable) {
        try { rmSync(lockPath, { force: true }); } catch {}
        continue;
      }
      if (attempt >= LOCK_ATTEMPTS) throw new FailureError("AC_PRECONDITION_FAILED", "runtime-writer-owned");
      sleepSync(LOCK_RETRY_MS + Math.floor(Math.random() * LOCK_RETRY_MS));
    }
  }
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      try {
        const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as { token?: unknown };
        if (parsed.token === token) rmSync(lockPath, { force: true });
      } catch {}
    }
  };
}

interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

function openSqliteDatabaseSync(databasePath: string): SqliteDatabase {
  if (databasePath !== ":memory:") ensurePrivateDir(dirname(databasePath));
  if (process.versions.bun) {
    const bunSqlite = runtimeRequire("bun:sqlite");
    const db = new bunSqlite.Database(databasePath);
    return { exec: (s) => db.exec(s), prepare: (s) => db.query(s), close: () => { db.clearQueryCache(); db.close(); } };
  }
  if (process.versions.node) {
    const nodeSqlite = runtimeRequire("node:sqlite");
    const db = new nodeSqlite.DatabaseSync(databasePath);
    return { exec: (s) => db.exec(s), prepare: (s) => db.prepare(s), close: () => db.close() };
  }
  throw new Error("Unsupported SQLite runtime: archctx requires Bun or Node.");
}

function removeCacheSidecars(databasePath: string): void {
  if (databasePath === ":memory:") return;
  for (const suffix of ["", "-wal", "-shm"]) try { rmSync(`${databasePath}${suffix}`, { force: true }); } catch {}
}

function debtCacheKey(key: ArchitectureDebtBaseCacheKey): string {
  return digestJson({ ...key } as unknown as Json);
}

const DOCS_COLS = "provider, library_id, version, query_digest, content_digest, resource_json, retrieved_at, expires_at";

function docsRowToEntry(row: Record<string, unknown>): ExternalDocumentationCacheEntry {
  return {
    provider: row.provider as ExternalDocumentationProvider,
    libraryId: String(row.library_id),
    version: String(row.version),
    queryDigest: String(row.query_digest),
    contentDigest: String(row.content_digest),
    resource: JSON.parse(String(row.resource_json)),
    retrievedAt: String(row.retrieved_at),
    expiresAt: String(row.expires_at)
  };
}

/** Discardable local SQLite cache: three tables, WAL + busy_timeout=5000, BEGIN IMMEDIATE writes. */
export class SqliteLocalStore implements RuntimeLocalStore {
  private db?: SqliteDatabase;
  private writerOwnership?: LocalStoreWriterOwnership;

  constructor(private readonly databasePath = defaultLocalStorePath()) {}

  acquireWriterOwnership(): void {
    if (this.databasePath === ":memory:" || this.writerOwnership) return;
    this.writerOwnership = acquireLocalStoreWriterOwnership(this.databasePath);
  }

  private connection(): SqliteDatabase {
    if (this.db) return this.db;
    let db: SqliteDatabase;
    try {
      db = openSqliteDatabaseSync(this.databasePath);
      this.initSchema(db);
    } catch {
      try { db!?.close(); } catch {}
      removeCacheSidecars(this.databasePath);
      db = openSqliteDatabaseSync(this.databasePath);
      this.initSchema(db);
    }
    if (this.databasePath !== ":memory:" && process.platform !== "win32" && existsSync(this.databasePath)) {
      try { chmodSync(this.databasePath, 0o600); } catch {}
    }
    this.db = db;
    return db;
  }

  private initSchema(db: SqliteDatabase): void {
    for (const pragma of SQLITE_PRAGMAS) db.exec(pragma);
    const versionRow = db.prepare("PRAGMA user_version").get();
    const version = Number(versionRow?.user_version ?? 0);
    if (version !== LOCAL_CACHE_SCHEMA_VERSION) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
        for (const table of tables) db.exec(`DROP TABLE IF EXISTS "${String(table.name).replace(/"/g, '""')}"`);
        db.exec(`
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
          PRAGMA user_version = ${LOCAL_CACHE_SCHEMA_VERSION};
        `);
        db.exec("COMMIT");
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch {}
        throw error;
      }
    }
  }

  private writeTx<T>(fn: (db: SqliteDatabase) => T): T {
    const db = this.connection();
    db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn(db);
      db.exec("COMMIT");
      return value;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  async migrate(): Promise<void> { this.connection(); }

  async readCacheEntry<T = unknown>(namespace: string, cacheKey: string): Promise<T | undefined> {
    const row = this.connection().prepare("SELECT value_json FROM kv_cache WHERE namespace = ? AND cache_key = ?").get(namespace, cacheKey);
    return row ? JSON.parse(String(row.value_json)) as T : undefined;
  }

  async writeCacheEntry(namespace: string, cacheKey: string, value: unknown): Promise<void> {
    const updatedAt = new Date().toISOString();
    const json = JSON.stringify(value);
    this.writeTx((db) => db.prepare("INSERT OR REPLACE INTO kv_cache (namespace, cache_key, value_json, updated_at) VALUES (?, ?, ?, ?)").run(namespace, cacheKey, json, updatedAt));
  }

  async deleteCacheEntry(namespace: string, cacheKey: string): Promise<void> {
    this.writeTx((db) => db.prepare("DELETE FROM kv_cache WHERE namespace = ? AND cache_key = ?").run(namespace, cacheKey));
  }

  async listCacheEntries<T = unknown>(namespace: string): Promise<Array<{ cacheKey: string; value: T; updatedAt: string }>> {
    const rows = this.connection().prepare("SELECT cache_key, value_json, updated_at FROM kv_cache WHERE namespace = ? ORDER BY cache_key ASC").all(namespace);
    return rows.map((row) => ({ cacheKey: String(row.cache_key), value: JSON.parse(String(row.value_json)) as T, updatedAt: String(row.updated_at) }));
  }

  async readArchitectureDebtBase(key: ArchitectureDebtBaseCacheKey): Promise<ArchitectureDebtReportV1 | undefined> {
    const row = this.connection().prepare("SELECT report_json FROM architecture_debt_base_cache WHERE cache_key = ?").get(debtCacheKey(key));
    return row ? JSON.parse(String(row.report_json)) as ArchitectureDebtReportV1 : undefined;
  }

  async saveArchitectureDebtBase(key: ArchitectureDebtBaseCacheKey, report: ArchitectureDebtReportV1): Promise<void> {
    const json = JSON.stringify(report);
    const updatedAt = new Date().toISOString();
    this.writeTx((db) => db.prepare("INSERT OR REPLACE INTO architecture_debt_base_cache (cache_key, report_json, updated_at) VALUES (?, ?, ?)").run(debtCacheKey(key), json, updatedAt));
  }

  async saveTaskState(taskSessionId: string, state: unknown): Promise<void> { await this.writeCacheEntry("task_state", taskSessionId, state); }
  async readTaskState(taskSessionId: string): Promise<unknown | undefined> { return this.readCacheEntry("task_state", taskSessionId); }
  async saveReviewResult(reviewId: string, result: unknown): Promise<void> { await this.writeCacheEntry("review_result", reviewId, result); }
  async saveRepositorySession(session: PersistedRepositorySession): Promise<void> { await this.writeCacheEntry("repository_session", session.repositoryId, session); }
  async listRepositorySessions(): Promise<PersistedRepositorySession[]> { return (await this.listCacheEntries<PersistedRepositorySession>("repository_session")).map((e) => e.value); }
  async saveLandscape(landscape: Landscape): Promise<void> { await this.writeCacheEntry("landscape", landscape.id, landscape); }
  async readLandscape(landscapeId: string): Promise<Landscape | undefined> { return this.readCacheEntry<Landscape>("landscape", landscapeId); }
  async saveCrossRepoRelation(relation: CrossRepoRelation): Promise<void> { await this.writeCacheEntry("cross_repo_relation", relation.id, relation); }

  async commitRepositoryRemoval(repositoryId: string, landscape?: Landscape): Promise<boolean> {
    return this.writeTx((db) => {
      const existing = db.prepare("SELECT 1 AS present FROM kv_cache WHERE namespace = 'repository_session' AND cache_key = ?").get(repositoryId);
      db.prepare("DELETE FROM kv_cache WHERE namespace = 'repository_session' AND cache_key = ?").run(repositoryId);
      if (landscape) {
        db.prepare("INSERT OR REPLACE INTO kv_cache (namespace, cache_key, value_json, updated_at) VALUES ('landscape', ?, ?, ?)")
          .run(landscape.id, JSON.stringify(landscape), new Date().toISOString());
      }
      return existing !== undefined;
    });
  }

  async listCrossRepoRelations(landscape?: Landscape): Promise<CrossRepoRelation[]> {
    const all = (await this.listCacheEntries<CrossRepoRelation>("cross_repo_relation")).map((entry) => entry.value);
    if (!landscape) return all;
    const allowed = new Set(landscape.relations);
    return all.filter((relation) => allowed.has(relation.id));
  }

  async saveExternalDocumentation(entry: ExternalDocumentationCacheEntry): Promise<void> {
    this.writeTx((db) => db.prepare(`INSERT OR REPLACE INTO external_docs_cache (${DOCS_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(entry.provider, entry.libraryId, entry.version, entry.queryDigest, entry.contentDigest, JSON.stringify(entry.resource), entry.retrievedAt, entry.expiresAt));
  }

  async readExternalDocumentation(input: { provider: ExternalDocumentationProvider; libraryId: string; version: string; queryDigest: string }): Promise<ExternalDocumentationCacheEntry | undefined> {
    const row = this.connection().prepare(`SELECT ${DOCS_COLS} FROM external_docs_cache WHERE provider = ? AND library_id = ? AND version = ? AND query_digest = ?`)
      .get(input.provider, input.libraryId, input.version, input.queryDigest);
    return row ? docsRowToEntry(row) : undefined;
  }

  async readExternalDocumentationByContentDigest(input: { provider: ExternalDocumentationProvider; contentDigest: string }): Promise<ExternalDocumentationCacheEntry | undefined> {
    const row = this.connection().prepare(`SELECT ${DOCS_COLS} FROM external_docs_cache WHERE provider = ? AND content_digest = ? ORDER BY retrieved_at DESC, library_id ASC LIMIT 1`)
      .get(input.provider, input.contentDigest);
    return row ? docsRowToEntry(row) : undefined;
  }

  async listExternalDocumentation(provider?: ExternalDocumentationProvider): Promise<ExternalDocumentationCacheEntry[]> {
    const rows = provider
      ? this.connection().prepare(`SELECT ${DOCS_COLS} FROM external_docs_cache WHERE provider = ? ORDER BY retrieved_at DESC, library_id ASC`).all(provider)
      : this.connection().prepare(`SELECT ${DOCS_COLS} FROM external_docs_cache ORDER BY retrieved_at DESC, provider ASC, library_id ASC`).all();
    return rows.map(docsRowToEntry);
  }

  async purgeExternalDocumentation(input: { provider?: ExternalDocumentationProvider; libraryId?: string; all?: boolean }): Promise<number> {
    const clause = input.all ? "" : input.provider && input.libraryId ? " WHERE provider = ? AND library_id = ?" : input.provider ? " WHERE provider = ?" : undefined;
    if (clause === undefined) return 0;
    const params = input.all ? [] : input.libraryId ? [input.provider, input.libraryId] : [input.provider];
    return this.writeTx((db) => {
      const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM external_docs_cache${clause}`).get(...params)?.count ?? 0);
      db.prepare(`DELETE FROM external_docs_cache${clause}`).run(...params);
      return count;
    });
  }

  close(): void {
    try { this.db?.close(); } finally {
      this.db = undefined;
      try { this.writerOwnership?.release(); } finally { this.writerOwnership = undefined; }
    }
  }
}
