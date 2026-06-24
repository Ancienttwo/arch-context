import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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
import type { ExternalDocumentationCacheEntry, ExternalDocumentationProvider, LocalStorePort, RepositorySnapshot } from "@archcontext/contracts";

const runtimeRequire = createRequire(import.meta.url);
const SQLITE_SIDECAR_SUFFIXES = ["", "-wal", "-shm"] as const;
const LEGACY_MIGRATION_MARKER_FILE = "runtime.sqlite.migration.json";
const LEGACY_MIGRATION_LOCK_FILE = "runtime.sqlite.migration.lock";
const REQUIRED_LOCAL_STORE_TABLES = [
  "schema_migrations",
  "repository_sessions",
  "snapshots",
  "task_states",
  "observed_evidence",
  "review_results",
  "landscapes",
  "cross_repo_edges",
  "changeset_journal",
  "external_docs_cache"
] as const;

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
  },
  {
    id: "0005_external_docs_cache",
    statements: [
      `CREATE TABLE IF NOT EXISTS external_docs_cache (
        provider TEXT NOT NULL,
        library_id TEXT NOT NULL,
        version TEXT NOT NULL,
        query_digest TEXT NOT NULL,
        content_digest TEXT NOT NULL,
        resource_json TEXT NOT NULL,
        retrieved_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        PRIMARY KEY (provider, library_id, version, query_digest)
      )`,
      "CREATE INDEX IF NOT EXISTS idx_external_docs_cache_expires ON external_docs_cache(provider, expires_at)",
      "CREATE INDEX IF NOT EXISTS idx_external_docs_cache_library ON external_docs_cache(provider, library_id, version)"
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

export const ARCHCONTEXT_STATE_DIR_ENV = "ARCHCONTEXT_STATE_DIR";
export const ARCHCONTEXT_LOCAL_STORE_PATH_ENV = "ARCHCONTEXT_LOCAL_STORE_PATH";

export interface RuntimeStatePaths {
  schemaVersion: "archcontext.runtime-state-paths/v1";
  stateRoot: string;
  source: "os-user-data" | "environment";
  repositoryRoot: string;
  repositoryAnchor: string;
  workspaceAnchor: string;
  storageRepositoryId: string;
  storageWorkspaceId: string;
  /** @deprecated Use storageRepositoryId for runtime-state storage partition identity. */
  repositoryId: string;
  /** @deprecated Use storageWorkspaceId for runtime-state storage partition identity. */
  workspaceId: string;
  repositoryStateDir: string;
  workspaceStateDir: string;
  sharedCacheDir: string;
  localStorePath: string;
  daemonConnectionPath: string;
  daemonLockPath: string;
  daemonLogPath: string;
  developerReviewRunStateDir: string;
  legacyControlDir: string;
  legacyLocalStorePath: string;
}

export type LegacyLocalStoreMigrationStatus =
  | "explicit-local-store-override"
  | "legacy-missing"
  | "pending"
  | "legacy-invalid"
  | "target-current"
  | "target-incomplete"
  | "migrated"
  | "target-quarantined-and-migrated";

export interface LegacyLocalStoreMigration {
  schemaVersion: "archcontext.legacy-local-store-migration/v1";
  status: LegacyLocalStoreMigrationStatus;
  migrated: boolean;
  skippedReason?: "explicit-local-store-override" | "target-exists" | "legacy-missing";
  legacyLocalStorePath: string;
  targetLocalStorePath: string;
  markerPath: string;
  lockPath: string;
  integrityCheck: {
    legacy?: string;
    target?: string;
    staging?: string;
    error?: string;
  };
  copiedFiles: string[];
  quarantinedFiles: string[];
}

export function defaultArchContextStateRoot(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir()
): { path: string; source: "os-user-data" | "environment" } {
  const override = env[ARCHCONTEXT_STATE_DIR_ENV];
  if (override) return { path: resolve(override), source: "environment" };
  if (platform === "darwin") return { path: join(home, "Library", "Application Support", "ArchContext"), source: "os-user-data" };
  if (platform === "win32") return { path: join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "ArchContext"), source: "os-user-data" };
  return { path: join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "archcontext"), source: "os-user-data" };
}

export function runtimeStatePaths(root = process.cwd(), env: Record<string, string | undefined> = process.env): RuntimeStatePaths {
  const repositoryRoot = readGitPath(root, ["rev-parse", "--show-toplevel"]) ?? root;
  const canonicalRepositoryRoot = canonicalPath(repositoryRoot);
  const gitCommonDir = readGitPath(canonicalRepositoryRoot, ["rev-parse", "--git-common-dir"]);
  const repositoryAnchor = canonicalPath(gitCommonDir ? resolveMaybeRelative(canonicalRepositoryRoot, gitCommonDir) : canonicalRepositoryRoot);
  const workspaceAnchor = canonicalRepositoryRoot;
  const storageRepositoryId = stableStorageId("repo", repositoryAnchor);
  const storageWorkspaceId = stableStorageId("ws", workspaceAnchor);
  const stateRoot = defaultArchContextStateRoot(env);
  const repositoryStateDir = join(stateRoot.path, "repositories", storageRepositoryId);
  const workspaceStateDir = join(repositoryStateDir, "worktrees", storageWorkspaceId);
  const legacyControlDir = resolve(canonicalRepositoryRoot, ".archcontext", ".local");
  return {
    schemaVersion: "archcontext.runtime-state-paths/v1",
    stateRoot: stateRoot.path,
    source: stateRoot.source,
    repositoryRoot: canonicalRepositoryRoot,
    repositoryAnchor,
    workspaceAnchor,
    storageRepositoryId,
    storageWorkspaceId,
    repositoryId: storageRepositoryId,
    workspaceId: storageWorkspaceId,
    repositoryStateDir,
    workspaceStateDir,
    sharedCacheDir: join(repositoryStateDir, "shared", "cache"),
    localStorePath: env[ARCHCONTEXT_LOCAL_STORE_PATH_ENV] ?? join(workspaceStateDir, "runtime.sqlite"),
    daemonConnectionPath: join(workspaceStateDir, "archctxd.json"),
    daemonLockPath: join(workspaceStateDir, "archctxd.lock"),
    daemonLogPath: join(workspaceStateDir, "archctxd.log"),
    developerReviewRunStateDir: join(workspaceStateDir, "developer-review-runs"),
    legacyControlDir,
    legacyLocalStorePath: join(legacyControlDir, "runtime.sqlite")
  };
}

export function defaultLocalStorePath(root = process.cwd()): string {
  return runtimeStatePaths(root).localStorePath;
}

export function inspectLegacyLocalStoreMigration(root = process.cwd(), env: Record<string, string | undefined> = process.env): LegacyLocalStoreMigration {
  const paths = runtimeStatePaths(root, env);
  if (env[ARCHCONTEXT_LOCAL_STORE_PATH_ENV]) {
    return legacyMigrationResult(false, "explicit-local-store-override", paths, [], {
      status: "explicit-local-store-override"
    });
  }

  const legacyExists = existsSync(paths.legacyLocalStorePath);
  const targetExists = existsSync(paths.localStorePath);
  if (targetExists) {
    const target = safeCurrentLocalStoreCheck(paths.localStorePath);
    return legacyMigrationResult(false, "target-exists", paths, [], {
      status: target.ok ? "target-current" : "target-incomplete",
      integrityCheck: target.ok ? { target: target.result } : { target: "failed", error: target.error }
    });
  }
  if (!legacyExists) {
    return legacyMigrationResult(false, "legacy-missing", paths, [], {
      status: "legacy-missing"
    });
  }

  const source = safeTrustedLegacyLocalStoreSourceCheck(paths);
  if (!source.ok) {
    return legacyMigrationResult(false, undefined, paths, [], {
      status: "legacy-invalid",
      integrityCheck: { legacy: "failed", error: source.error }
    });
  }
  const legacy = safeSqliteIntegrityCheck(paths.legacyLocalStorePath);
  return legacyMigrationResult(false, undefined, paths, [], {
    status: legacy.ok ? "pending" : "legacy-invalid",
    integrityCheck: legacy.ok ? { legacy: legacy.result } : { legacy: "failed", error: legacy.error }
  });
}

export function migrateLegacyLocalStoreIfNeeded(root = process.cwd(), env: Record<string, string | undefined> = process.env): LegacyLocalStoreMigration {
  const paths = runtimeStatePaths(root, env);
  if (env[ARCHCONTEXT_LOCAL_STORE_PATH_ENV]) {
    return legacyMigrationResult(false, "explicit-local-store-override", paths, [], {
      status: "explicit-local-store-override"
    });
  }

  ensurePrivateDir(dirname(paths.localStorePath));
  const legacyExists = existsSync(paths.legacyLocalStorePath);
  const integrityCheck: LegacyLocalStoreMigration["integrityCheck"] = {};
  const quarantinedFiles: string[] = [];
  const targetExists = existsSync(paths.localStorePath);

  if (targetExists) {
    try {
      integrityCheck.target = assertCurrentLocalStore(paths.localStorePath);
      return legacyMigrationResult(false, "target-exists", paths, [], {
        status: "target-current",
        integrityCheck
      });
    } catch (error) {
      integrityCheck.target = "failed";
      integrityCheck.error = error instanceof Error ? error.message : String(error);
      if (!legacyExists) {
        throw new Error(`ArchContext runtime state target is not a valid SQLite database and no legacy store is available: ${paths.localStorePath}`);
      }
    }
  }
  if (!legacyExists) {
    return legacyMigrationResult(false, "legacy-missing", paths, [], {
      status: "legacy-missing",
      integrityCheck
    });
  }
  assertTrustedLegacyLocalStoreSource(paths);

  const lock = acquireLegacyMigrationLock(paths);
  const stagingDir = join(paths.workspaceStateDir, `.runtime.sqlite.migration-${process.pid}-${randomUUID()}`);
  const stagingPath = join(stagingDir, "runtime.sqlite");
  try {
    if (targetExists) quarantinedFiles.push(...quarantineExistingLocalStore(paths));
    ensurePrivateDir(stagingDir);
    integrityCheck.legacy = vacuumLegacySqliteInto(paths.legacyLocalStorePath, stagingPath);
    makePrivateFile(stagingPath);
    migrateSqliteDatabaseSync(stagingPath);
    compactSqliteDatabase(stagingPath);
    integrityCheck.staging = assertCurrentLocalStore(stagingPath);
    publishStagedLocalStore(stagingPath, paths.localStorePath);
    integrityCheck.target = assertCurrentLocalStore(paths.localStorePath);
    const markerPath = writeLegacyMigrationMarker(paths, integrityCheck, quarantinedFiles);
    return legacyMigrationResult(true, undefined, paths, [paths.localStorePath], {
      status: quarantinedFiles.length > 0 ? "target-quarantined-and-migrated" : "migrated",
      integrityCheck,
      markerPath,
      quarantinedFiles
    });
  } catch (error) {
    throw new Error(`ArchContext legacy SQLite migration failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
    releaseLegacyMigrationLock(lock);
  }
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
  saveRepositorySession(session: PersistedRepositorySession): Promise<void>;
  listRepositorySessions(): Promise<PersistedRepositorySession[]>;
  saveLandscape(landscape: Landscape): Promise<void>;
  readLandscape(landscapeId: string): Promise<Landscape | undefined>;
  saveCrossRepoRelation(relation: CrossRepoRelation): Promise<void>;
  listCrossRepoRelations(landscape?: Landscape): Promise<CrossRepoRelation[]>;
  saveExternalDocumentation(entry: ExternalDocumentationCacheEntry): Promise<void>;
  readExternalDocumentation(input: {
    provider: ExternalDocumentationProvider;
    libraryId: string;
    version: string;
    queryDigest: string;
  }): Promise<ExternalDocumentationCacheEntry | undefined>;
  readExternalDocumentationByContentDigest(input: {
    provider: ExternalDocumentationProvider;
    contentDigest: string;
  }): Promise<ExternalDocumentationCacheEntry | undefined>;
  listExternalDocumentation(provider?: ExternalDocumentationProvider): Promise<ExternalDocumentationCacheEntry[]>;
  purgeExternalDocumentation(input: { provider?: ExternalDocumentationProvider; libraryId?: string; all?: boolean }): Promise<number>;
  clearDerivedLandscapeState(): void;
  rebuildDerivedLandscapeState(input: LandscapeRebuildInput): Promise<LandscapeRebuildResult>;
  close(): void;
}

export interface PersistedRepositorySession {
  repositoryId: string;
  root: string;
  headSha: string;
  worktreeDigest: string;
  updatedAt: string;
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

  async saveRepositorySession(session: PersistedRepositorySession): Promise<void> {
    const db = await this.database();
    db.prepare(
      `INSERT OR REPLACE INTO repository_sessions
        (repository_id, root, head_sha, worktree_digest, updated_at)
        VALUES (?, ?, ?, ?, ?)`
    ).run(session.repositoryId, session.root, session.headSha, session.worktreeDigest, session.updatedAt);
  }

  async listRepositorySessions(): Promise<PersistedRepositorySession[]> {
    const db = await this.database();
    return db.prepare(
      `SELECT repository_id, root, head_sha, worktree_digest, updated_at
        FROM repository_sessions
        ORDER BY updated_at ASC, repository_id ASC`
    ).all().map((row) => ({
      repositoryId: String(row.repository_id),
      root: String(row.root),
      headSha: String(row.head_sha),
      worktreeDigest: String(row.worktree_digest),
      updatedAt: String(row.updated_at)
    }));
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

  async saveExternalDocumentation(entry: ExternalDocumentationCacheEntry): Promise<void> {
    const db = await this.database();
    db.prepare(
      `INSERT OR REPLACE INTO external_docs_cache
        (provider, library_id, version, query_digest, content_digest, resource_json, retrieved_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.provider,
      entry.libraryId,
      entry.version,
      entry.queryDigest,
      entry.contentDigest,
      stableJson(entry.resource),
      entry.retrievedAt,
      entry.expiresAt
    );
  }

  async readExternalDocumentation(input: {
    provider: ExternalDocumentationProvider;
    libraryId: string;
    version: string;
    queryDigest: string;
  }): Promise<ExternalDocumentationCacheEntry | undefined> {
    const db = await this.database();
    const row = db.prepare(
      `SELECT provider, library_id, version, query_digest, content_digest, resource_json, retrieved_at, expires_at
        FROM external_docs_cache
        WHERE provider = ? AND library_id = ? AND version = ? AND query_digest = ?`
    ).get(input.provider, input.libraryId, input.version, input.queryDigest);
    return row ? externalDocumentationEntryFromRow(row) : undefined;
  }

  async readExternalDocumentationByContentDigest(input: {
    provider: ExternalDocumentationProvider;
    contentDigest: string;
  }): Promise<ExternalDocumentationCacheEntry | undefined> {
    const db = await this.database();
    const row = db.prepare(
      `SELECT provider, library_id, version, query_digest, content_digest, resource_json, retrieved_at, expires_at
        FROM external_docs_cache
        WHERE provider = ? AND content_digest = ?
        ORDER BY retrieved_at DESC, library_id ASC, version ASC, query_digest ASC
        LIMIT 1`
    ).get(input.provider, input.contentDigest);
    return row ? externalDocumentationEntryFromRow(row) : undefined;
  }

  async listExternalDocumentation(provider?: ExternalDocumentationProvider): Promise<ExternalDocumentationCacheEntry[]> {
    const db = await this.database();
    const rows = provider
      ? db.prepare(
        `SELECT provider, library_id, version, query_digest, content_digest, resource_json, retrieved_at, expires_at
          FROM external_docs_cache
          WHERE provider = ?
          ORDER BY retrieved_at DESC, library_id ASC, version ASC, query_digest ASC`
      ).all(provider)
      : db.prepare(
        `SELECT provider, library_id, version, query_digest, content_digest, resource_json, retrieved_at, expires_at
          FROM external_docs_cache
          ORDER BY retrieved_at DESC, provider ASC, library_id ASC, version ASC, query_digest ASC`
      ).all();
    return rows.map(externalDocumentationEntryFromRow);
  }

  async purgeExternalDocumentation(input: { provider?: ExternalDocumentationProvider; libraryId?: string; all?: boolean }): Promise<number> {
    const db = await this.database();
    if (input.all) {
      const rows = db.prepare("SELECT COUNT(*) AS count FROM external_docs_cache").get();
      db.prepare("DELETE FROM external_docs_cache").run();
      return Number(rows?.count ?? 0);
    }
    if (input.provider && input.libraryId) {
      const rows = db.prepare("SELECT COUNT(*) AS count FROM external_docs_cache WHERE provider = ? AND library_id = ?").get(input.provider, input.libraryId);
      db.prepare("DELETE FROM external_docs_cache WHERE provider = ? AND library_id = ?").run(input.provider, input.libraryId);
      return Number(rows?.count ?? 0);
    }
    if (input.provider) {
      const rows = db.prepare("SELECT COUNT(*) AS count FROM external_docs_cache WHERE provider = ?").get(input.provider);
      db.prepare("DELETE FROM external_docs_cache WHERE provider = ?").run(input.provider);
      return Number(rows?.count ?? 0);
    }
    return 0;
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

function externalDocumentationEntryFromRow(row: Record<string, unknown>): ExternalDocumentationCacheEntry {
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
  if (databasePath !== ":memory:") ensurePrivateDir(dirname(databasePath));
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

function openSqliteDatabaseSync(databasePath: string): SqliteDatabase {
  if (databasePath !== ":memory:") ensurePrivateDir(dirname(databasePath));
  try {
    const nodeSqlite = runtimeRequire("node:sqlite") as any;
    const db = new (nodeSqlite as any).DatabaseSync(databasePath);
    return {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => db.prepare(sql),
      close: () => db.close()
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ERR_UNKNOWN_BUILTIN_MODULE" && (error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") {
      throw error;
    }
  }
  const bunSqlite = runtimeRequire("bun:sqlite");
  const db = new (bunSqlite as any).Database(databasePath);
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => db.query(sql),
    close: () => db.close()
  };
}

function legacyMigrationResult(
  migrated: boolean,
  skippedReason: LegacyLocalStoreMigration["skippedReason"],
  paths: RuntimeStatePaths,
  copiedFiles: string[],
  details: {
    status: LegacyLocalStoreMigrationStatus;
    markerPath?: string;
    integrityCheck?: LegacyLocalStoreMigration["integrityCheck"];
    quarantinedFiles?: string[];
  }
): LegacyLocalStoreMigration {
  return {
    schemaVersion: "archcontext.legacy-local-store-migration/v1",
    status: details.status,
    migrated,
    skippedReason,
    legacyLocalStorePath: paths.legacyLocalStorePath,
    targetLocalStorePath: paths.localStorePath,
    markerPath: details.markerPath ?? legacyMigrationMarkerPath(paths),
    lockPath: legacyMigrationLockPath(paths),
    integrityCheck: details.integrityCheck ?? {},
    copiedFiles,
    quarantinedFiles: details.quarantinedFiles ?? []
  };
}

function safeSqliteIntegrityCheck(path: string): { ok: true; result: string } | { ok: false; error: string } {
  try {
    return { ok: true, result: assertSqliteIntegrity(path) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function safeCurrentLocalStoreCheck(path: string): { ok: true; result: string } | { ok: false; error: string } {
  try {
    return { ok: true, result: assertCurrentLocalStore(path) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function safeTrustedLegacyLocalStoreSourceCheck(paths: RuntimeStatePaths): { ok: true } | { ok: false; error: string } {
  try {
    assertTrustedLegacyLocalStoreSource(paths);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function assertSqliteIntegrity(path: string): string {
  const db = openSqliteDatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const row = db.prepare("PRAGMA integrity_check").get();
    const result = firstSqliteColumn(row);
    if (result !== "ok") throw new Error(`SQLite integrity_check failed for ${path}: ${result}`);
    return result;
  } finally {
    db.close();
  }
}

function assertCurrentLocalStore(path: string): string {
  const db = openSqliteDatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const integrity = sqliteIntegrityCheckOpenDatabase(db, path);
    assertCurrentLocalStoreSchema(db, path);
    return integrity;
  } finally {
    db.close();
  }
}

function assertCurrentLocalStoreSchema(db: SqliteDatabase, path: string): void {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row.name)));
  const missingTables = REQUIRED_LOCAL_STORE_TABLES.filter((table) => !tables.has(table));
  if (missingTables.length > 0) {
    throw new Error(`SQLite local store schema incomplete for ${path}: missing tables ${missingTables.join(", ")}`);
  }

  const migrations = new Set(db.prepare("SELECT id FROM schema_migrations").all().map((row) => String(row.id)));
  const missingMigrations = LOCAL_SQLITE_MIGRATIONS.map((migration) => migration.id).filter((id) => !migrations.has(id));
  if (missingMigrations.length > 0) {
    throw new Error(`SQLite local store schema incomplete for ${path}: missing migrations ${missingMigrations.join(", ")}`);
  }
}

function assertTrustedLegacyLocalStoreSource(paths: RuntimeStatePaths): void {
  const stat = lstatSync(paths.legacyLocalStorePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Legacy SQLite source must not be a symbolic link: ${paths.legacyLocalStorePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Legacy SQLite source must be a regular file: ${paths.legacyLocalStorePath}`);
  }
  const sourceRealPath = realpathSync.native(paths.legacyLocalStorePath);
  if (!isPathInsideOrSame(sourceRealPath, paths.repositoryRoot)) {
    throw new Error(`Legacy SQLite source must stay inside the repository root: ${paths.legacyLocalStorePath}`);
  }
}

function vacuumLegacySqliteInto(sourcePath: string, targetPath: string): string {
  const db = openSqliteDatabaseSync(sourcePath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const integrity = sqliteIntegrityCheckOpenDatabase(db, sourcePath);
    db.exec(`VACUUM INTO ${sqliteStringLiteral(targetPath)}`);
    return integrity;
  } finally {
    db.close();
  }
}

function migrateSqliteDatabaseSync(databasePath: string): void {
  const db = openSqliteDatabaseSync(databasePath);
  try {
    for (const pragma of SQLITE_PRAGMAS) db.exec(pragma);
    for (const migration of LOCAL_SQLITE_MIGRATIONS) {
      for (const statement of migration.statements) db.exec(statement);
      db.prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, nowIso());
    }
  } finally {
    db.close();
  }
}

function compactSqliteDatabase(databasePath: string): void {
  const db = openSqliteDatabaseSync(databasePath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.exec("PRAGMA journal_mode = DELETE");
  } finally {
    db.close();
  }
  for (const suffix of ["-wal", "-shm"] as const) rmSync(`${databasePath}${suffix}`, { force: true });
}

function sqliteIntegrityCheckOpenDatabase(db: SqliteDatabase, path: string): string {
  const row = db.prepare("PRAGMA integrity_check").get();
  const result = firstSqliteColumn(row);
  if (result !== "ok") throw new Error(`SQLite integrity_check failed for ${path}: ${result}`);
  return result;
}

function firstSqliteColumn(row: Record<string, unknown> | undefined): string {
  const value = row ? Object.values(row)[0] : undefined;
  return typeof value === "string" ? value : String(value ?? "");
}

function sqliteStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function publishStagedLocalStore(stagingPath: string, targetPath: string): void {
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const path = `${targetPath}${suffix}`;
    if (existsSync(path)) throw new Error(`Cannot publish migrated SQLite over existing target file: ${path}`);
  }
  renameSync(stagingPath, targetPath);
  makePrivateFile(targetPath);
  fsyncDirectory(dirname(targetPath));
}

function writeLegacyMigrationMarker(
  paths: RuntimeStatePaths,
  integrityCheck: LegacyLocalStoreMigration["integrityCheck"],
  quarantinedFiles: string[]
): string {
  const markerPath = legacyMigrationMarkerPath(paths);
  writePrivateJson(markerPath, {
    schemaVersion: "archcontext.legacy-local-store-migration-marker/v1",
    migratedAt: nowIso(),
    legacyLocalStorePath: paths.legacyLocalStorePath,
    targetLocalStorePath: paths.localStorePath,
    integrityCheck,
    quarantinedFiles
  });
  return markerPath;
}

function acquireLegacyMigrationLock(paths: RuntimeStatePaths): { fd: number; path: string } {
  const lockPath = legacyMigrationLockPath(paths);
  ensurePrivateDir(dirname(lockPath));
  try {
    const fd = openSync(lockPath, "wx", 0o600);
    writeFileSync(fd, JSON.stringify({
      schemaVersion: "archcontext.legacy-local-store-migration-lock/v1",
      pid: process.pid,
      root: paths.repositoryRoot,
      targetLocalStorePath: paths.localStorePath,
      startedAt: nowIso()
    }, null, 2), "utf8");
    fsyncSync(fd);
    return { fd, path: lockPath };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" && isStaleMigrationLock(lockPath)) {
      rmSync(lockPath, { force: true });
      return acquireLegacyMigrationLock(paths);
    }
    if (code === "EEXIST") throw new Error(`Legacy SQLite migration already in progress; lock=${lockPath}`);
    throw error;
  }
}

function releaseLegacyMigrationLock(lock: { fd: number; path: string }): void {
  closeSync(lock.fd);
  rmSync(lock.path, { force: true });
}

function isStaleMigrationLock(lockPath: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number };
    if (typeof parsed.pid !== "number" || parsed.pid <= 0) return true;
    return !isProcessAlive(parsed.pid);
  } catch {
    return true;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function quarantineExistingLocalStore(paths: RuntimeStatePaths): string[] {
  const quarantineDir = join(paths.workspaceStateDir, "quarantine", `runtime.sqlite-${Date.now()}-${randomUUID()}`);
  ensurePrivateDir(quarantineDir);
  const quarantinedFiles: string[] = [];
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const source = `${paths.localStorePath}${suffix}`;
    if (!existsSync(source)) continue;
    const target = join(quarantineDir, `runtime.sqlite${suffix}`);
    renameSync(source, target);
    quarantinedFiles.push(target);
  }
  const markerPath = legacyMigrationMarkerPath(paths);
  if (existsSync(markerPath)) {
    const target = join(quarantineDir, LEGACY_MIGRATION_MARKER_FILE);
    renameSync(markerPath, target);
    quarantinedFiles.push(target);
  }
  fsyncDirectory(quarantineDir);
  fsyncDirectory(dirname(paths.localStorePath));
  return quarantinedFiles;
}

function legacyMigrationMarkerPath(paths: RuntimeStatePaths): string {
  return join(paths.workspaceStateDir, LEGACY_MIGRATION_MARKER_FILE);
}

function legacyMigrationLockPath(paths: RuntimeStatePaths): string {
  return join(paths.workspaceStateDir, LEGACY_MIGRATION_LOCK_FILE);
}

function writePrivateJson(path: string, value: unknown): void {
  ensurePrivateDir(dirname(path));
  const fd = openSync(path, "w", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2), "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  makePrivateFile(path);
  fsyncDirectory(dirname(path));
}

function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    try {
      chmodSync(path, 0o700);
    } catch {
      // Best-effort hardening; permission diagnostics report the final state.
    }
  }
}

function makePrivateFile(path: string): void {
  if (process.platform !== "win32") {
    try {
      chmodSync(path, 0o600);
    } catch {
      // Best-effort hardening; permission diagnostics report the final state.
    }
  }
}

function readGitPath(root: string, args: string[]): string | undefined {
  try {
    const value = execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function resolveMaybeRelative(base: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(base, path);
}

function canonicalPath(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function isPathInsideOrSame(path: string, parent: string): boolean {
  const child = resolve(path);
  const base = resolve(parent);
  const fromBase = relative(base, child);
  return fromBase === "" || (!!fromBase && !fromBase.startsWith("..") && !isAbsolute(fromBase));
}

function stableStorageId(prefix: "repo" | "ws", value: string): string {
  return `${prefix}.${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
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
