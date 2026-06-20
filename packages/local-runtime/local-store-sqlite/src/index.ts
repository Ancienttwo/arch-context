import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  LANDSCAPE_FILE,
  landscapeDigest,
  parseCrossRepoRelationFile,
  parseLandscapeFile,
  validateLandscape,
  type CrossRepoRelation,
  type Landscape,
  type RepositoryRegistration
} from "@archcontext/core/architecture-domain";
import type { ChangeSetDraft, ChangeSetJournalFile, ChangeSetJournalPort } from "@archcontext/core/changeset-engine";
import type { LocalStorePort, RepositorySnapshot } from "@archcontext/contracts";

export const SQLITE_PRAGMAS = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA foreign_keys = ON",
  "PRAGMA busy_timeout = 5000"
] as const;

export const LOCAL_SQLITE_MIGRATIONS = [
  {
    id: "0001_runtime_state",
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS repository_sessions (
        repository_id TEXT PRIMARY KEY,
        root TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        worktree_digest TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        worktree_digest TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        committed_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS task_states (
        task_session_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS observed_evidence (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        selector_json TEXT NOT NULL,
        summary TEXT NOT NULL,
        confidence TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS review_results (
        review_id TEXT PRIMARY KEY,
        task_session_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`
    ]
  },
  {
    id: "0002_indexes",
    statements: [
      "CREATE INDEX IF NOT EXISTS idx_snapshots_repository ON snapshots(repository_id, head_sha)",
      "CREATE INDEX IF NOT EXISTS idx_evidence_repository ON observed_evidence(repository_id, head_sha)",
      "CREATE INDEX IF NOT EXISTS idx_reviews_task ON review_results(task_session_id)"
    ]
  },
  {
    id: "0003_landscape_state",
    statements: [
      `CREATE TABLE IF NOT EXISTS landscapes (
        id TEXT PRIMARY KEY,
        digest TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS cross_repo_edges (
        id TEXT PRIMARY KEY,
        landscape_id TEXT NOT NULL,
        from_repository_id TEXT NOT NULL,
        from_node_id TEXT NOT NULL,
        to_repository_id TEXT NOT NULL,
        to_node_id TEXT NOT NULL,
        via_kind TEXT NOT NULL,
        via_id TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS idx_cross_repo_edges_from ON cross_repo_edges(from_repository_id, from_node_id)",
      "CREATE INDEX IF NOT EXISTS idx_cross_repo_edges_to ON cross_repo_edges(to_repository_id, to_node_id)"
    ]
  },
  {
    id: "0004_changeset_journal",
    statements: [
      `CREATE TABLE IF NOT EXISTS changeset_journal (
        journal_id TEXT PRIMARY KEY,
        changeset_id TEXT NOT NULL,
        root TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        files_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      )`,
      "CREATE INDEX IF NOT EXISTS idx_changeset_journal_status ON changeset_journal(status)"
    ]
  }
] as const;

export function migrationSql(): string[] {
  return [...SQLITE_PRAGMAS, ...LOCAL_SQLITE_MIGRATIONS.flatMap((migration) => migration.statements)];
}

export function assertNoSourceStorageSchema(sql: string[]): void {
  const joined = sql.join("\n").toLowerCase();
  for (const forbidden of ["source_code", "source_body", "diff_body", "symbol_payload", "codegraph_db"]) {
    if (joined.includes(forbidden)) throw new Error(`SQLite schema contains forbidden storage column: ${forbidden}`);
  }
}

export function defaultLocalStorePath(root = process.cwd()): string {
  return process.env.ARCHCONTEXT_LOCAL_STORE_PATH ?? resolve(root, ".archcontext/.local/runtime.sqlite");
}

export interface LandscapeRebuildInput {
  root: string;
  landscapePath?: string;
  relationsDir?: string;
  indexRepository?: (repository: RepositoryRegistration) => Promise<void>;
}

export interface LandscapeRebuildResult {
  landscape: Landscape;
  relations: CrossRepoRelation[];
  indexedRepositories: string[];
  digest: string;
}

export interface RuntimeLocalStore extends LocalStorePort, ChangeSetJournalPort {
  recoverPendingSnapshots(): number;
  saveLandscape(landscape: Landscape): Promise<void>;
  readLandscape(landscapeId: string): Promise<Landscape | undefined>;
  saveCrossRepoRelation(relation: CrossRepoRelation): Promise<void>;
  listCrossRepoRelations(landscape?: Landscape): Promise<CrossRepoRelation[]>;
  clearDerivedLandscapeState(): void;
  rebuildDerivedLandscapeState(input: LandscapeRebuildInput): Promise<LandscapeRebuildResult>;
  close(): void;
}

type SqliteStatement = {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  all: (...params: unknown[]) => Record<string, unknown>[];
};

type SqliteDatabase = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
};

export class SqliteLocalStore implements RuntimeLocalStore {
  private db?: SqliteDatabase;

  constructor(private readonly databasePath = defaultLocalStorePath()) {}

  async migrate(): Promise<void> {
    const db = await this.database();
    for (const pragma of SQLITE_PRAGMAS) db.exec(pragma);
    for (const migration of LOCAL_SQLITE_MIGRATIONS) {
      for (const statement of migration.statements) db.exec(statement);
      db.prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, nowIso());
    }
  }

  async beginSnapshot(snapshot: RepositorySnapshot): Promise<string> {
    const db = await this.database();
    const snapshotId = `snapshot_${randomUUID()}`;
    db.prepare(
      `INSERT OR REPLACE INTO repository_sessions
        (repository_id, root, head_sha, worktree_digest, updated_at)
        VALUES (?, ?, ?, ?, ?)`
    ).run(snapshot.repositoryId, snapshot.repositoryId, snapshot.headSha, snapshot.worktreeDigest, nowIso());
    db.prepare(
      `INSERT INTO snapshots
        (id, repository_id, head_sha, worktree_digest, state, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`
    ).run(snapshotId, snapshot.repositoryId, snapshot.headSha, snapshot.worktreeDigest, "pending", nowIso());
    return snapshotId;
  }

  async commitSnapshot(snapshotId: string): Promise<void> {
    const db = await this.database();
    const existing = db.prepare("SELECT id FROM snapshots WHERE id = ?").get(snapshotId);
    if (!existing) throw new Error(`Snapshot not found: ${snapshotId}`);
    db.prepare("UPDATE snapshots SET state = ?, committed_at = ? WHERE id = ?").run("committed", nowIso(), snapshotId);
  }

  recoverPendingSnapshots(): number {
    const db = this.requireOpenDatabase();
    const pending = db.prepare("SELECT id FROM snapshots WHERE state = ?").all("pending");
    db.prepare("DELETE FROM snapshots WHERE state = ?").run("pending");
    return pending.length;
  }

  async beginChangeSet(root: string, draft: ChangeSetDraft): Promise<string> {
    const db = await this.database();
    const journalId = `changeset_${randomUUID()}`;
    db.prepare(
      `INSERT INTO changeset_journal
        (journal_id, changeset_id, root, status, metadata_json, files_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(journalId, draft.id, root, "pending", stableJson(changeSetMetadata(draft)), "[]", nowIso(), nowIso());
    return journalId;
  }

  async recordChangeSetFile(journalId: string, file: ChangeSetJournalFile): Promise<void> {
    const db = await this.database();
    const row = db.prepare("SELECT files_json FROM changeset_journal WHERE journal_id = ?").get(journalId);
    if (!row) throw new Error(`ChangeSet journal not found: ${journalId}`);
    const files = JSON.parse(String(row.files_json)) as ChangeSetJournalFile[];
    files.push(file);
    db.prepare("UPDATE changeset_journal SET files_json = ?, updated_at = ? WHERE journal_id = ?").run(stableJson(files), nowIso(), journalId);
  }

  async commitChangeSet(journalId: string): Promise<void> {
    const db = await this.database();
    const existing = db.prepare("SELECT journal_id FROM changeset_journal WHERE journal_id = ?").get(journalId);
    if (!existing) throw new Error(`ChangeSet journal not found: ${journalId}`);
    db.prepare("UPDATE changeset_journal SET status = ?, updated_at = ?, completed_at = ? WHERE journal_id = ?")
      .run("committed", nowIso(), nowIso(), journalId);
  }

  async abortChangeSet(journalId: string, reason: string): Promise<void> {
    const db = await this.database();
    const row = db.prepare("SELECT metadata_json FROM changeset_journal WHERE journal_id = ?").get(journalId);
    if (!row) throw new Error(`ChangeSet journal not found: ${journalId}`);
    const metadata = JSON.parse(String(row.metadata_json)) as Record<string, unknown>;
    db.prepare("UPDATE changeset_journal SET status = ?, metadata_json = ?, updated_at = ?, completed_at = ? WHERE journal_id = ?")
      .run("aborted", stableJson({ ...metadata, abortReason: reason }), nowIso(), nowIso(), journalId);
  }

  recoverPendingChangeSets(): number {
    const db = this.requireOpenDatabase();
    const committed = db.prepare("SELECT files_json FROM changeset_journal WHERE status = ?").all("committed");
    for (const row of committed) {
      cleanupCommittedJournalFiles(JSON.parse(String(row.files_json)) as ChangeSetJournalFile[]);
    }
    const rows = db.prepare("SELECT journal_id, root, files_json FROM changeset_journal WHERE status = ?").all("pending");
    for (const row of rows) {
      const files = JSON.parse(String(row.files_json)) as ChangeSetJournalFile[];
      recoverJournalFiles(String(row.root), files);
      db.prepare("UPDATE changeset_journal SET status = ?, updated_at = ?, completed_at = ? WHERE journal_id = ?")
        .run("recovered", nowIso(), nowIso(), String(row.journal_id));
    }
    return rows.length;
  }

  async saveTaskState(taskSessionId: string, state: unknown): Promise<void> {
    const db = await this.database();
    db.prepare(
      `INSERT OR REPLACE INTO task_states
        (task_session_id, payload_json, updated_at)
        VALUES (?, ?, ?)`
    ).run(taskSessionId, stableJson(state), nowIso());
  }

  async readTaskState(taskSessionId: string): Promise<unknown | undefined> {
    const db = await this.database();
    const row = db.prepare("SELECT payload_json FROM task_states WHERE task_session_id = ?").get(taskSessionId);
    return row ? JSON.parse(String(row.payload_json)) : undefined;
  }

  async saveReviewResult(reviewId: string, result: unknown): Promise<void> {
    const db = await this.database();
    db.prepare(
      `INSERT OR REPLACE INTO review_results
        (review_id, task_session_id, payload_json, created_at)
        VALUES (?, ?, ?, ?)`
    ).run(reviewId, reviewTaskSessionId(result) ?? reviewId, stableJson(result), nowIso());
  }

  async saveLandscape(landscape: Landscape): Promise<void> {
    const db = await this.database();
    db.prepare(
      `INSERT OR REPLACE INTO landscapes
        (id, digest, metadata_json, updated_at)
        VALUES (?, ?, ?, ?)`
    ).run(landscape.id, landscapeDigest(landscape), stableJson(landscape), nowIso());
  }

  async readLandscape(landscapeId: string): Promise<Landscape | undefined> {
    const db = await this.database();
    const row = db.prepare("SELECT metadata_json FROM landscapes WHERE id = ?").get(landscapeId);
    return row ? JSON.parse(String(row.metadata_json)) as Landscape : undefined;
  }

  async saveCrossRepoRelation(relation: CrossRepoRelation): Promise<void> {
    const db = await this.database();
    db.prepare(
      `INSERT OR REPLACE INTO cross_repo_edges
        (id, landscape_id, from_repository_id, from_node_id, to_repository_id, to_node_id, via_kind, via_id, metadata_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      relation.id,
      "unscoped",
      relation.source.repositoryId,
      relation.source.nodeId,
      relation.target.repositoryId,
      relation.target.nodeId,
      relation.via.kind,
      relation.via.id,
      stableJson(relation),
      nowIso()
    );
  }

  async listCrossRepoRelations(landscape?: Landscape): Promise<CrossRepoRelation[]> {
    const db = await this.database();
    const ids = new Set(landscape?.relations);
    return db.prepare("SELECT metadata_json FROM cross_repo_edges ORDER BY id").all()
      .map((row) => JSON.parse(String(row.metadata_json)) as CrossRepoRelation)
      .filter((relation) => !landscape || ids.has(relation.id));
  }

  clearDerivedLandscapeState(): void {
    const db = this.requireOpenDatabase();
    db.prepare("DELETE FROM landscapes").run();
    db.prepare("DELETE FROM cross_repo_edges").run();
  }

  async rebuildDerivedLandscapeState(input: LandscapeRebuildInput): Promise<LandscapeRebuildResult> {
    return rebuildDerivedLandscapeState(this, input);
  }

  close(): void {
    this.db?.close();
    this.db = undefined;
  }

  private async database(): Promise<SqliteDatabase> {
    if (!this.db) this.db = await openSqliteDatabase(this.databasePath);
    return this.db;
  }

  private requireOpenDatabase(): SqliteDatabase {
    if (!this.db) throw new Error("SQLite local store has not been migrated");
    return this.db;
  }
}

export async function rebuildDerivedLandscapeState(store: RuntimeLocalStore, input: LandscapeRebuildInput): Promise<LandscapeRebuildResult> {
  const landscapePath = input.landscapePath ?? LANDSCAPE_FILE;
  const relationsDir = input.relationsDir ?? ".archcontext/relations";
  const landscape = parseLandscapeFile(await readFile(resolve(input.root, landscapePath), "utf8"), landscapePath);
  const relations = await readRelationFiles(input.root, relationsDir);
  const scopedRelations = relations.filter((relation) => landscape.relations.includes(relation.id));
  const relationIds = new Set(relations.map((relation) => relation.id));
  const missingRelations = landscape.relations.filter((relationId) => !relationIds.has(relationId));
  if (missingRelations.length > 0) throw new Error(`Invalid landscape rebuild source: missing relations ${missingRelations.join(", ")}`);
  const validation = validateLandscape(landscape, scopedRelations);
  if (!validation.valid) throw new Error(`Invalid landscape rebuild source: ${validation.errors.join("; ")}`);

  const indexedRepositories: string[] = [];
  for (const repository of landscape.repositories) {
    await input.indexRepository?.(repository);
    indexedRepositories.push(repository.repositoryId);
  }

  await store.saveLandscape(landscape);
  for (const relation of scopedRelations) await store.saveCrossRepoRelation(relation);
  return {
    landscape,
    relations: scopedRelations,
    indexedRepositories,
    digest: landscapeDigest(landscape, scopedRelations)
  };
}

async function openSqliteDatabase(databasePath: string): Promise<SqliteDatabase> {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  try {
    const nodeSqlite = await import("node:sqlite");
    const db = new (nodeSqlite as any).DatabaseSync(databasePath);
    return {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => db.prepare(sql),
      close: () => db.close()
    };
  } catch {
    const bunSqlite = await import("bun:sqlite");
    const db = new (bunSqlite as any).Database(databasePath);
    return {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => db.query(sql),
      close: () => db.close()
    };
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function changeSetMetadata(draft: ChangeSetDraft): Record<string, unknown> {
  return {
    schemaVersion: draft.schemaVersion,
    changesetId: draft.id,
    base: draft.base,
    reason: draft.reason,
    operations: draft.operations.map((operation) => ({
      op: operation.op,
      path: operation.path,
      entityId: operation.entityId,
      expectedHash: operation.expectedHash
    })),
    preconditions: draft.preconditions,
    postconditions: draft.postconditions,
    requiresConfirmation: draft.requiresConfirmation,
    idempotencyKey: draft.idempotencyKey
  };
}

function recoverJournalFiles(root: string, files: ChangeSetJournalFile[]): void {
  for (const file of [...files].reverse()) {
    const absolute = resolve(root, file.path);
    if (file.tempPath) rmSync(file.tempPath, { recursive: true, force: true });
    rmSync(absolute, { recursive: true, force: true });
    if (file.existed && file.backupPath && existsSync(file.backupPath)) {
      renameSync(file.backupPath, absolute);
    }
    fsyncDirectory(dirname(absolute));
  }
}

function cleanupCommittedJournalFiles(files: ChangeSetJournalFile[]): void {
  for (const file of files) {
    if (file.tempPath) rmSync(file.tempPath, { recursive: true, force: true });
    if (file.backupPath) rmSync(file.backupPath, { recursive: true, force: true });
  }
}

function fsyncDirectory(path: string): void {
  try {
    const fd = openSync(path, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if (!isIgnorableDirectoryFsyncError(error)) throw error;
  }
}

function isIgnorableDirectoryFsyncError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "EINVAL" || code === "EISDIR" || (process.platform === "win32" && code === "EPERM");
}

function reviewTaskSessionId(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const maybe = (result as { taskSessionId?: unknown }).taskSessionId;
  return typeof maybe === "string" ? maybe : undefined;
}

async function readRelationFiles(root: string, relationsDir: string): Promise<CrossRepoRelation[]> {
  let entries;
  try {
    entries = await readdir(resolve(root, relationsDir), { withFileTypes: true });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  const relations: CrossRepoRelation[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(json|ya?ml)$/.test(entry.name)) continue;
    const relativePath = join(relationsDir, entry.name).split("\\").join("/");
    relations.push(parseCrossRepoRelationFile(await readFile(resolve(root, relativePath), "utf8"), relativePath));
  }
  return relations.sort((a, b) => a.id.localeCompare(b.id));
}
