import { digestJson, FailureError, type ArchitectureDebtReportV1, type ExternalDocumentationCacheEntry, type ExternalDocumentationProvider, type Json, type LocalStorePort } from "@archcontext/contracts";
import type { CrossRepoRelation, Landscape } from "@archcontext/core/architecture-domain";
import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants as fsConstants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, statSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ARCHCONTEXT_LOCAL_STORE_PATH_ENV, runtimeStatePaths } from "../../runtime-state-paths/src/index";
export { ARCHCONTEXT_STATE_DIR_ENV, ARCHCONTEXT_LOCAL_STORE_PATH_ENV, defaultArchContextStateRoot, runtimeStatePaths, type RuntimeStatePaths } from "../../runtime-state-paths/src/index";

const runtimeRequire = createRequire(import.meta.url);
const LOCAL_CACHE_SCHEMA_VERSION = 200;
const ARCHCONTEXT_SQLITE_APPLICATION_ID = 0x41435458; // "ACTX"
const LOCK_ATTEMPTS = 6;
const LOCK_RETRY_MS = 20;
const SQLITE_MAGIC_HEADER = "SQLite format 3\0";

const V2_CACHE_TABLE_COLUMNS: Record<string, readonly string[]> = {
  architecture_debt_base_cache: ["cache_key|TEXT|0|1|0", "report_json|TEXT|1|0|0", "updated_at|TEXT|1|0|0"],
  external_docs_cache: [
    "provider|TEXT|1|1|0",
    "library_id|TEXT|1|2|0",
    "version|TEXT|1|3|0",
    "query_digest|TEXT|1|4|0",
    "content_digest|TEXT|1|0|0",
    "resource_json|TEXT|1|0|0",
    "retrieved_at|TEXT|1|0|0",
    "expires_at|TEXT|1|0|0"
  ],
  kv_cache: ["namespace|TEXT|1|1|0", "cache_key|TEXT|1|2|0", "value_json|TEXT|1|0|0", "updated_at|TEXT|1|0|0"]
};

const V2_CACHE_TABLE_SQL: Readonly<Record<string, string>> = {
  architecture_debt_base_cache:
    "CREATE TABLE architecture_debt_base_cache(cache_key TEXT PRIMARY KEY,report_json TEXT NOT NULL,updated_at TEXT NOT NULL)",
  external_docs_cache:
    "CREATE TABLE external_docs_cache(provider TEXT NOT NULL,library_id TEXT NOT NULL,version TEXT NOT NULL,query_digest TEXT NOT NULL,content_digest TEXT NOT NULL,resource_json TEXT NOT NULL,retrieved_at TEXT NOT NULL,expires_at TEXT NOT NULL,PRIMARY KEY(provider,library_id,version,query_digest))",
  kv_cache:
    "CREATE TABLE kv_cache(namespace TEXT NOT NULL,cache_key TEXT NOT NULL,value_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(namespace,cache_key))"
};

const V2_CACHE_TABLES = new Set(Object.keys(V2_CACHE_TABLE_COLUMNS));

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

type LocalStoreProbeKind = "empty" | "proven-v2" | "unproven";

function quoteSqlIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function ownEntry<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function normalizeSqliteDdl(sql: unknown): string {
  return String(sql ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();
}

function isVirtualTableSql(sql: unknown): boolean {
  return typeof sql === "string" && /^\s*CREATE\s+VIRTUAL\s+TABLE\b/i.test(sql);
}

function tableMatchesColumns(db: SqliteDatabase, tableName: string, expectedColumns: readonly string[]): boolean {
  const columns = db.prepare(`PRAGMA table_xinfo(${quoteSqlIdentifier(tableName)})`).all();
  if (columns.length !== expectedColumns.length) return false;
  return columns.every((col, index) => {
    const signature = `${String(col.name)}|${String(col.type)}|${Number(col.notnull)}|${Number(col.pk)}|${Number(col.hidden)}`;
    return signature === expectedColumns[index];
  });
}

function classifyLocalStoreDatabase(db: SqliteDatabase): {
  kind: LocalStoreProbeKind;
  applicationId: number;
} {
  const appRow = db.prepare("PRAGMA application_id").get();
  const applicationId = Number(appRow?.application_id ?? 0);
  const versionRow = db.prepare("PRAGMA user_version").get();
  const userVersion = Number(versionRow?.user_version ?? 0);
  const masterRows = db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'view', 'trigger', 'index') AND name NOT LIKE 'sqlite_%' AND (type != 'index' OR sql IS NOT NULL)"
    )
    .all();

  if (masterRows.length === 0) {
    return {
      kind: userVersion === 0 && applicationId === 0 ? "empty" : "unproven",
      applicationId
    };
  }

  const validHeader = userVersion === LOCAL_CACHE_SCHEMA_VERSION
    && (applicationId === 0 || applicationId === ARCHCONTEXT_SQLITE_APPLICATION_ID);
  if (!validHeader || masterRows.length !== V2_CACHE_TABLES.size) {
    return { kind: "unproven", applicationId };
  }

  const seenTables = new Set<string>();
  for (const row of masterRows) {
    if (String(row.type) !== "table" || isVirtualTableSql(row.sql)) {
      return { kind: "unproven", applicationId };
    }
    const name = String(row.name);
    if (!V2_CACHE_TABLES.has(name) || seenTables.has(name)) {
      return { kind: "unproven", applicationId };
    }
    seenTables.add(name);
    const expectedSql = ownEntry(V2_CACHE_TABLE_SQL, name);
    const expectedCols = ownEntry(V2_CACHE_TABLE_COLUMNS, name);
    if (
      expectedSql === undefined
      || expectedCols === undefined
      || normalizeSqliteDdl(row.sql) !== expectedSql
      || !tableMatchesColumns(db, name, expectedCols)
    ) {
      return { kind: "unproven", applicationId };
    }
  }

  return { kind: "proven-v2", applicationId };
}

function assertAbsentSidecars(databasePath: string): void {
  for (const suffix of ["-wal", "-shm", "-journal"] as const) {
    try {
      lstatSync(`${databasePath}${suffix}`);
      throw new FailureError("AC_PRECONDITION_FAILED", "local-store-unproven-file");
    } catch (error) {
      if (error instanceof FailureError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new FailureError("AC_PRECONDITION_FAILED", "local-store-unproven-file");
      }
    }
  }
}

function assertProvenOrAbsentLocalStore(databasePath: string): "absent" | "proven-v2" {
  let stat;
  try {
    stat = lstatSync(databasePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      assertAbsentSidecars(databasePath);
      return "absent";
    }
    throw new FailureError("AC_PRECONDITION_FAILED", "local-store-unproven-file");
  }
  if (!stat.isFile() || stat.size < SQLITE_MAGIC_HEADER.length) {
    throw new FailureError("AC_PRECONDITION_FAILED", "local-store-unproven-file");
  }
  const header = Buffer.alloc(SQLITE_MAGIC_HEADER.length);
  let fd: number | undefined;
  try {
    fd = openSync(databasePath, "r");
    const bytesRead = readSync(fd, header, 0, header.length, 0);
    if (bytesRead < header.length || header.toString("ascii") !== SQLITE_MAGIC_HEADER) {
      throw new FailureError("AC_PRECONDITION_FAILED", "local-store-unproven-file");
    }
  } catch (error) {
    if (error instanceof FailureError) throw error;
    throw new FailureError("AC_PRECONDITION_FAILED", "local-store-unproven-file");
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }
  }

  try {
    lstatSync(`${databasePath}-journal`);
    throw new FailureError("AC_PRECONDITION_FAILED", "local-store-unproven-file");
  } catch (error) {
    if (error instanceof FailureError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new FailureError("AC_PRECONDITION_FAILED", "local-store-unproven-file");
    }
  }

  const walPath = `${databasePath}-wal`;
  const shmPath = `${databasePath}-shm`;
  let hasWal = false;
  for (const [sidecarPath, isWal] of [[walPath, true], [shmPath, false]] as const) {
    try {
      const sidecarStat = lstatSync(sidecarPath);
      if (!sidecarStat.isFile()) {
        throw new FailureError("AC_PRECONDITION_FAILED", "local-store-unproven-file");
      }
      if (isWal) hasWal = true;
    } catch (error) {
      if (error instanceof FailureError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new FailureError("AC_PRECONDITION_FAILED", "local-store-unproven-file");
      }
    }
  }

  let scratch: string | undefined;
  let probeDb: SqliteDatabase | undefined;
  try {
    scratch = mkdtempSync(join(realpathSync(tmpdir()), "archctx-store-probe-"));
    const stagedDb = join(scratch, "store.sqlite");
    copyFileSync(databasePath, stagedDb, fsConstants.COPYFILE_FICLONE);
    if (hasWal) copyFileSync(walPath, `${stagedDb}-wal`, fsConstants.COPYFILE_FICLONE);
    probeDb = openSqliteDatabaseSync(stagedDb);
    probeDb.exec("PRAGMA query_only = ON;");
    const classified = classifyLocalStoreDatabase(probeDb);
    if (classified.kind !== "proven-v2") {
      throw new FailureError("AC_PRECONDITION_FAILED", "local-store-unproven-file");
    }
    return "proven-v2";
  } catch (error) {
    if (error instanceof FailureError) throw error;
    throw new FailureError("AC_PRECONDITION_FAILED", "local-store-unproven-file");
  } finally {
    try { probeDb?.close(); } catch {}
    if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
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
    const probeState = this.databasePath === ":memory:" ? "absent" : assertProvenOrAbsentLocalStore(this.databasePath);
    const allowEmpty = this.databasePath === ":memory:" || probeState === "absent";
    const db = openSqliteDatabaseSync(this.databasePath);
    try {
      this.initSchema(db, allowEmpty);
    } catch (error) {
      try { db.close(); } catch {}
      throw error;
    }
    if (this.databasePath !== ":memory:" && process.platform !== "win32" && existsSync(this.databasePath)) {
      try { chmodSync(this.databasePath, 0o600); } catch {}
    }
    this.db = db;
    return db;
  }

  private initSchema(db: SqliteDatabase, allowEmpty: boolean): void {
    db.exec("PRAGMA busy_timeout = 5000;");
    const initial = classifyLocalStoreDatabase(db);
    if (initial.kind === "unproven" || (initial.kind === "empty" && !allowEmpty)) {
      throw new FailureError("AC_PRECONDITION_FAILED", "local-store-unproven-file");
    }
    for (const pragma of SQLITE_PRAGMAS) db.exec(pragma);
    if (initial.kind === "proven-v2" && initial.applicationId === ARCHCONTEXT_SQLITE_APPLICATION_ID) {
      return;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = classifyLocalStoreDatabase(db);
      if (current.kind === "unproven" || (current.kind === "empty" && !allowEmpty)) {
        throw new FailureError("AC_PRECONDITION_FAILED", "local-store-unproven-file");
      }
      if (current.kind === "proven-v2") {
        if (current.applicationId !== ARCHCONTEXT_SQLITE_APPLICATION_ID) {
          db.exec(`PRAGMA application_id = ${ARCHCONTEXT_SQLITE_APPLICATION_ID};`);
        }
        db.exec("COMMIT");
        return;
      }
      db.exec(`
        ${Object.values(V2_CACHE_TABLE_SQL).join(";\n        ")};
        PRAGMA application_id = ${ARCHCONTEXT_SQLITE_APPLICATION_ID};
        PRAGMA user_version = ${LOCAL_CACHE_SCHEMA_VERSION};
      `);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
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
