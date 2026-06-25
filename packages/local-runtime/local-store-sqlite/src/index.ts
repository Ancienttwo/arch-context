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
import {
  architectureLedgerPayload,
  architectureLedgerSnapshotFromState,
  architectureLedgerStateDigest,
  emptyArchitectureLedgerState,
  normalizeArchitectureLedgerEvent,
  replayArchitectureLedgerEvents,
  validateArchitectureLedgerEvent,
  type ArchitectureLedgerAppendInput,
  type ArchitectureLedgerAppendResult,
  type ArchitectureLedgerConstraintRecord,
  type ArchitectureLedgerEntityRecord,
  type ArchitectureLedgerEventPayload,
  type ArchitectureLedgerGraphState,
  type ArchitectureLedgerIntegrityResult,
  type ArchitectureLedgerRelationRecord,
  type ArchitectureLedgerReplayInput,
  type ArchitectureLedgerReplayResult,
  type ArchitectureLedgerReplayVerification,
  type ArchitectureLedgerScope,
  type ArchitectureLedgerSnapshotInput
} from "@archcontext/core/architecture-ledger";
import type { ChangeSetDraft, ChangeSetJournalFile, ChangeSetJournalPort } from "@archcontext/core/changeset-engine";
import { digestJson, type AgentJobV1, type ArchitectureEventV1, type ArchitectureSnapshotV1, type ExternalDocumentationCacheEntry, type ExternalDocumentationProvider, type Json, type LocalStorePort, type RepositorySnapshot } from "@archcontext/contracts";

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
  "external_docs_cache",
  "architecture_events",
  "architecture_snapshots",
  "architecture_entities_current",
  "architecture_relations_current",
  "architecture_constraints_current",
  "evidence_items",
  "evidence_bindings",
  "recommendation_runs",
  "recommendations",
  "recommendation_feedback",
  "agent_jobs",
  "runtime_job_queue",
  "projection_state",
  "source_cursors",
  "waivers",
  "architecture_ledger_operations",
  "architecture_ledger_fts"
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
  },
  {
    id: "0006_architecture_ledger",
    statements: [
      `CREATE TABLE IF NOT EXISTS architecture_events (
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
        compacted_by_snapshot_id TEXT,
        UNIQUE(storage_repository_id, storage_workspace_id, idempotency_key)
      )`,
      `CREATE TABLE IF NOT EXISTS architecture_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        storage_repository_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        worktree_digest TEXT NOT NULL,
        source_mode TEXT NOT NULL,
        last_event_id TEXT NOT NULL,
        last_event_hash TEXT NOT NULL,
        graph_digest TEXT NOT NULL,
        projection_digest TEXT NOT NULL,
        entity_count INTEGER NOT NULL,
        relation_count INTEGER NOT NULL,
        constraint_count INTEGER NOT NULL,
        input_digests_json TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS architecture_entities_current (
        storage_repository_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        repository_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        worktree_digest TEXT NOT NULL,
        kind TEXT NOT NULL,
        canonical_name TEXT NOT NULL,
        status TEXT NOT NULL,
        path TEXT,
        summary TEXT,
        metadata_json TEXT NOT NULL,
        last_event_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(storage_repository_id, storage_workspace_id, entity_id)
      )`,
      `CREATE TABLE IF NOT EXISTS architecture_relations_current (
        storage_repository_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        relation_id TEXT NOT NULL,
        repository_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        worktree_digest TEXT NOT NULL,
        kind TEXT NOT NULL,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT,
        metadata_json TEXT NOT NULL,
        last_event_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(storage_repository_id, storage_workspace_id, relation_id)
      )`,
      `CREATE TABLE IF NOT EXISTS architecture_constraints_current (
        storage_repository_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        constraint_id TEXT NOT NULL,
        repository_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        worktree_digest TEXT NOT NULL,
        kind TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        status TEXT NOT NULL,
        severity TEXT,
        summary TEXT,
        metadata_json TEXT NOT NULL,
        last_event_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(storage_repository_id, storage_workspace_id, constraint_id)
      )`,
      `CREATE TABLE IF NOT EXISTS evidence_items (
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
      )`,
      `CREATE TABLE IF NOT EXISTS evidence_bindings (
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
      )`,
      `CREATE TABLE IF NOT EXISTS recommendation_runs (
        run_id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        storage_repository_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        status TEXT NOT NULL,
        catalog_digest TEXT NOT NULL,
        input_digest TEXT NOT NULL,
        output_digest TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        run_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY(event_id) REFERENCES architecture_events(event_id) ON DELETE RESTRICT
      )`,
      `CREATE TABLE IF NOT EXISTS recommendations (
        recommendation_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        repository_id TEXT NOT NULL,
        storage_repository_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        subject TEXT NOT NULL,
        practice_id TEXT,
        status TEXT NOT NULL,
        confidence TEXT NOT NULL,
        enforcement TEXT NOT NULL,
        risk TEXT NOT NULL,
        uncertainty TEXT NOT NULL,
        evidence_binding_ids_json TEXT NOT NULL,
        explanation_json TEXT NOT NULL,
        recommendation_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(event_id) REFERENCES architecture_events(event_id) ON DELETE RESTRICT,
        FOREIGN KEY(run_id) REFERENCES recommendation_runs(run_id) ON DELETE RESTRICT
      )`,
      `CREATE TABLE IF NOT EXISTS recommendation_feedback (
        feedback_id TEXT PRIMARY KEY,
        recommendation_id TEXT NOT NULL,
        repository_id TEXT NOT NULL,
        storage_repository_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        feedback_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(event_id) REFERENCES architecture_events(event_id) ON DELETE RESTRICT,
        FOREIGN KEY(recommendation_id) REFERENCES recommendations(recommendation_id) ON DELETE RESTRICT
      )`,
      `CREATE TABLE IF NOT EXISTS agent_jobs (
        job_id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        storage_repository_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        status TEXT NOT NULL,
        runner_port TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        input_digest TEXT NOT NULL,
        output_digest TEXT,
        stale_policy TEXT NOT NULL,
        job_json TEXT NOT NULL,
        queued_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(event_id) REFERENCES architecture_events(event_id) ON DELETE RESTRICT
      )`,
      `CREATE TABLE IF NOT EXISTS projection_state (
        projection_id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        storage_repository_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        path TEXT NOT NULL,
        projection_digest TEXT NOT NULL,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(event_id) REFERENCES architecture_events(event_id) ON DELETE RESTRICT
      )`,
      `CREATE TABLE IF NOT EXISTS source_cursors (
        cursor_id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        storage_repository_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        source TEXT NOT NULL,
        cursor_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS waivers (
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
        expires_at TEXT,
        FOREIGN KEY(event_id) REFERENCES architecture_events(event_id) ON DELETE RESTRICT
      )`,
      `CREATE TABLE IF NOT EXISTS architecture_ledger_operations (
        operation_id TEXT PRIMARY KEY,
        storage_repository_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        operation_kind TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        row_count INTEGER NOT NULL,
        rebuild_reason TEXT,
        created_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS idx_architecture_events_scope_sequence ON architecture_events(storage_repository_id, storage_workspace_id, event_sequence)",
      "CREATE INDEX IF NOT EXISTS idx_architecture_events_head ON architecture_events(storage_repository_id, storage_workspace_id, head_sha)",
      "CREATE INDEX IF NOT EXISTS idx_architecture_snapshots_scope_created ON architecture_snapshots(storage_repository_id, storage_workspace_id, created_at)",
      "CREATE INDEX IF NOT EXISTS idx_architecture_entities_kind ON architecture_entities_current(storage_repository_id, storage_workspace_id, kind)",
      "CREATE INDEX IF NOT EXISTS idx_architecture_relations_source ON architecture_relations_current(storage_repository_id, storage_workspace_id, source_entity_id)",
      "CREATE INDEX IF NOT EXISTS idx_architecture_relations_target ON architecture_relations_current(storage_repository_id, storage_workspace_id, target_entity_id)",
      "CREATE INDEX IF NOT EXISTS idx_architecture_constraints_subject ON architecture_constraints_current(storage_repository_id, storage_workspace_id, subject_id)",
      "CREATE INDEX IF NOT EXISTS idx_evidence_items_subject ON evidence_items(storage_repository_id, storage_workspace_id, subject)",
      "CREATE INDEX IF NOT EXISTS idx_evidence_bindings_target ON evidence_bindings(storage_repository_id, storage_workspace_id, target_kind, target_id)",
      "CREATE INDEX IF NOT EXISTS idx_recommendations_status ON recommendations(storage_repository_id, storage_workspace_id, status)",
      "CREATE INDEX IF NOT EXISTS idx_agent_jobs_status ON agent_jobs(storage_repository_id, storage_workspace_id, status)",
      "CREATE INDEX IF NOT EXISTS idx_architecture_ledger_operations_scope_created ON architecture_ledger_operations(storage_repository_id, storage_workspace_id, created_at)",
      `CREATE VIRTUAL TABLE IF NOT EXISTS architecture_ledger_fts USING fts5(
        kind,
        summary,
        rationale,
        title,
        evidence_summary,
        content=''
      )`,
      `CREATE VIEW IF NOT EXISTS architecture_current_graph_view AS
        SELECT storage_repository_id, storage_workspace_id, entity_id AS graph_id, 'entity' AS graph_kind,
          kind, canonical_name AS label, status, path, summary, last_event_id, updated_at
        FROM architecture_entities_current
        UNION ALL
        SELECT storage_repository_id, storage_workspace_id, relation_id AS graph_id, 'relation' AS graph_kind,
          kind, source_entity_id || ' -> ' || target_entity_id AS label, status, NULL AS path, summary, last_event_id, updated_at
        FROM architecture_relations_current
        UNION ALL
        SELECT storage_repository_id, storage_workspace_id, constraint_id AS graph_id, 'constraint' AS graph_kind,
          kind, subject_id AS label, status, NULL AS path, summary, last_event_id, updated_at
        FROM architecture_constraints_current`,
      `CREATE VIEW IF NOT EXISTS open_recommendations_view AS
        SELECT recommendation_id, run_id, storage_repository_id, storage_workspace_id, subject, practice_id, status,
          confidence, enforcement, risk, uncertainty, updated_at
        FROM recommendations
        WHERE status IN ('open', 'acknowledged', 'accepted', 'deferred')`,
      `CREATE VIEW IF NOT EXISTS recent_architecture_changes_view AS
        SELECT event_sequence, event_id, storage_repository_id, storage_workspace_id, branch, head_sha, event_type,
          source, actor_kind, actor_id, previous_event_hash, event_hash, created_at
        FROM architecture_events
        ORDER BY event_sequence DESC`,
      `CREATE VIEW IF NOT EXISTS unresolved_evidence_view AS
        SELECT evidence_items.evidence_id, evidence_items.storage_repository_id, evidence_items.storage_workspace_id,
          evidence_items.kind, evidence_items.strength, evidence_items.polarity, evidence_items.origin,
          evidence_items.subject, evidence_items.summary, evidence_items.created_at
        FROM evidence_items
        LEFT JOIN evidence_bindings ON evidence_bindings.evidence_id = evidence_items.evidence_id
        WHERE evidence_bindings.binding_id IS NULL`
    ]
  },
  {
    id: "0007_runtime_job_queue",
    statements: [
      `CREATE TABLE IF NOT EXISTS runtime_job_queue (
        job_id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        storage_repository_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        analysis_kind TEXT NOT NULL,
        coalesce_key TEXT NOT NULL,
        status TEXT NOT NULL,
        runner_port TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        input_digest TEXT NOT NULL,
        prompt_template_digest TEXT NOT NULL,
        output_digest TEXT,
        stale_policy TEXT NOT NULL,
        job_json TEXT NOT NULL,
        queued_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        attempt_count INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        lease_owner TEXT,
        leased_at TEXT,
        lease_expires_at TEXT,
        last_error TEXT,
        dead_lettered_at TEXT,
        debounce_until TEXT,
        superseded_by_job_id TEXT
      )`,
      "CREATE INDEX IF NOT EXISTS idx_runtime_job_queue_scope_status ON runtime_job_queue(storage_repository_id, storage_workspace_id, status, queued_at)",
      "CREATE INDEX IF NOT EXISTS idx_runtime_job_queue_coalesce ON runtime_job_queue(storage_repository_id, storage_workspace_id, analysis_kind, coalesce_key)",
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_job_queue_active_fingerprint
        ON runtime_job_queue(storage_repository_id, storage_workspace_id, analysis_kind, fingerprint)
        WHERE status IN ('queued', 'running')`
    ]
  },
  {
    id: "0008_runtime_job_queue_hardening",
    statements: [
      "ALTER TABLE runtime_job_queue ADD COLUMN priority INTEGER NOT NULL DEFAULT 0",
      "CREATE INDEX IF NOT EXISTS idx_runtime_job_queue_claim_priority ON runtime_job_queue(storage_repository_id, storage_workspace_id, status, priority DESC, queued_at, job_id)"
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

export type RuntimeAgentJobStatus = AgentJobV1["status"];
export type RuntimeAgentJobTerminalStatus = Extract<RuntimeAgentJobStatus, "succeeded" | "failed" | "cancelled" | "superseded" | "expired">;
export const RUNTIME_AGENT_JOB_STATUSES: RuntimeAgentJobStatus[] = ["queued", "running", "succeeded", "failed", "cancelled", "superseded", "expired"];

export interface RuntimeAgentJobRecord {
  job: AgentJobV1;
  analysisKind: string;
  coalesceKey: string;
  priority: number;
  attemptCount: number;
  maxAttempts: number;
  leaseOwner?: string;
  leasedAt?: string;
  leaseExpiresAt?: string;
  lastError?: string;
  deadLetteredAt?: string;
  debounceUntil?: string;
  supersededByJobId?: string;
}

export interface RuntimeAgentJobEnqueueInput {
  job: AgentJobV1;
  analysisKind: string;
  coalesceKey?: string;
  maxAttempts?: number;
  debounceUntil?: string;
  priority?: number;
  maxQueuedJobs?: number;
}

export interface RuntimeAgentJobBackpressureDecision {
  schemaVersion: "archcontext.runtime-agent-job-backpressure/v1";
  accepted: boolean;
  reasonCode?: "backpressure-queue-cap";
  priority: number;
  queuedDepthBefore: number;
  queuedDepthAfter: number;
  runningDepth: number;
  maxQueuedJobs?: number;
  evictedJobIds: string[];
}

export interface RuntimeAgentJobEnqueueResult {
  record?: RuntimeAgentJobRecord;
  enqueued: boolean;
  deduplicated: boolean;
  supersededJobIds: string[];
  evictedJobIds?: string[];
  rejected?: boolean;
  reasonCode?: "backpressure-queue-cap";
  backpressure?: RuntimeAgentJobBackpressureDecision;
}

export interface RuntimeAgentJobClaimInput extends ArchitectureLedgerScope {
  workerId: string;
  leaseMs: number;
  now: string;
  maxRunningJobs?: number;
}

export interface RuntimeAgentJobCompleteInput {
  jobId: string;
  status: Extract<RuntimeAgentJobStatus, "succeeded" | "failed">;
  now: string;
  workerId?: string;
  outputDigest?: string;
  error?: string;
}

export interface RuntimeAgentJobRetryInput {
  jobId: string;
  now: string;
  reason?: string;
}

export interface RuntimeAgentJobCancelInput {
  jobId: string;
  status: Extract<RuntimeAgentJobStatus, "cancelled" | "superseded" | "expired">;
  now: string;
  reason?: string;
  supersededByJobId?: string;
}

export interface RuntimeAgentJobStaleCancellationInput extends ArchitectureLedgerScope {
  headSha: string;
  worktreeDigest: string;
  now: string;
  reason?: string;
}

export interface RuntimeAgentJobQueueStats {
  schemaVersion: "archcontext.runtime-agent-job-queue-stats/v1";
  generatedAt: string;
  storageRepositoryId: string;
  storageWorkspaceId: string;
  countsByStatus: Record<RuntimeAgentJobStatus, number>;
  queuedDepth: number;
  runningDepth: number;
  activeDepth: number;
  terminalDepth: number;
  totalJobCount: number;
  oldestQueuedAt?: string;
  oldestQueuedAgeMs?: number;
  coalescedJobCount: number;
  coalescingRatio: number;
  lastFailureReason?: string;
  lastFailureJobId?: string;
}

export interface RuntimeLocalStore extends LocalStorePort, ChangeSetJournalPort {
  recoverPendingSnapshots(): number;
  saveRepositorySession(session: PersistedRepositorySession): Promise<void>;
  listRepositorySessions(): Promise<PersistedRepositorySession[]>;
  enqueueRuntimeAgentJob(input: RuntimeAgentJobEnqueueInput): Promise<RuntimeAgentJobEnqueueResult>;
  listRuntimeAgentJobs(input: ArchitectureLedgerScope & { statuses?: RuntimeAgentJobStatus[] }): Promise<RuntimeAgentJobRecord[]>;
  queueStatsRuntimeAgentJobs(input: ArchitectureLedgerScope & { now?: string }): Promise<RuntimeAgentJobQueueStats>;
  claimRuntimeAgentJob(input: RuntimeAgentJobClaimInput): Promise<RuntimeAgentJobRecord | undefined>;
  completeRuntimeAgentJob(input: RuntimeAgentJobCompleteInput): Promise<RuntimeAgentJobRecord>;
  retryRuntimeAgentJob(input: RuntimeAgentJobRetryInput): Promise<RuntimeAgentJobRecord>;
  cancelRuntimeAgentJob(input: RuntimeAgentJobCancelInput): Promise<RuntimeAgentJobRecord>;
  cancelStaleRuntimeAgentJobs(input: RuntimeAgentJobStaleCancellationInput): Promise<RuntimeAgentJobRecord[]>;
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
  recordChangeSetLedgerPlan(journalId: string, input: { event: ArchitectureEventV1 }): Promise<void>;
  recordChangeSetLedgerAppend(journalId: string, input: { result: ArchitectureLedgerAppendResult }): Promise<void>;
  appendArchitectureEvents(input: ArchitectureLedgerAppendInput): Promise<ArchitectureLedgerAppendResult>;
  readArchitectureLedgerSourceCursor(input: ArchitectureLedgerScope & { cursorId: string }): Promise<Record<string, Json> | undefined>;
  createArchitectureLedgerSnapshot(input: ArchitectureLedgerSnapshotInput): Promise<ArchitectureSnapshotV1>;
  readArchitectureLedgerState(input: ArchitectureLedgerScope): Promise<ArchitectureLedgerGraphState>;
  replayArchitectureLedger(input: ArchitectureLedgerReplayInput): Promise<ArchitectureLedgerReplayResult>;
  verifyArchitectureLedgerReplay(input: ArchitectureLedgerReplayInput): Promise<ArchitectureLedgerReplayVerification>;
  rebuildArchitectureLedgerCurrentState(input: ArchitectureLedgerScope): Promise<ArchitectureLedgerReplayResult>;
  compactArchitectureLedger(input: ArchitectureLedgerScope & { beforeSnapshotId: string }): Promise<{ snapshotId: string; compactedEventCount: number }>;
  checkArchitectureLedgerIntegrity(input: ArchitectureLedgerScope): Promise<ArchitectureLedgerIntegrityResult>;
  backupArchitectureLedger(input: { backupPath: string }): Promise<{ backupPath: string; integrity: string }>;
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
    applyLocalSqliteMigrations(db);
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

  async enqueueRuntimeAgentJob(input: RuntimeAgentJobEnqueueInput): Promise<RuntimeAgentJobEnqueueResult> {
    if (input.job.status !== "queued") throw new Error("runtime-agent-job-enqueue-requires-queued-status");
    if (input.job.directMutationAllowed !== false) throw new Error("runtime-agent-job-direct-mutation-forbidden");
    const db = await this.database();
    const coalesceKey = input.coalesceKey ?? runtimeAgentJobDefaultCoalesceKey(input.job, input.analysisKind);
    const maxAttempts = Math.max(1, Math.trunc(input.maxAttempts ?? 3));
    const priority = normalizeRuntimeAgentJobPriority(input.priority);
    const maxQueuedJobs = normalizeOptionalPositiveInteger(input.maxQueuedJobs, "runtime-agent-job-max-queued-jobs-invalid");
    db.exec("BEGIN IMMEDIATE");
    try {
      const duplicate = db.prepare(
        `SELECT * FROM runtime_job_queue
          WHERE storage_repository_id = ?
            AND storage_workspace_id = ?
            AND analysis_kind = ?
            AND fingerprint = ?
            AND status IN ('queued', 'running')
          ORDER BY queued_at ASC, job_id ASC
          LIMIT 1`
      ).get(
        input.job.repository.storageRepositoryId,
        input.job.worktree.storageWorkspaceId,
        input.analysisKind,
        input.job.fingerprint
      );
      if (duplicate) {
        const duplicateRecord = runtimeAgentJobRecordFromRow(duplicate);
        const duplicateBackpressure = runtimeAgentJobBackpressureDecision(db, input.job, {
          accepted: true,
          priority: duplicateRecord.priority,
          maxQueuedJobs,
          evictedJobIds: []
        });
        db.exec("COMMIT");
        return {
          record: duplicateRecord,
          enqueued: false,
          deduplicated: true,
          supersededJobIds: [],
          evictedJobIds: [],
          ...(maxQueuedJobs === undefined ? {} : { backpressure: duplicateBackpressure })
        };
      }

      const supersededRows = db.prepare(
        `SELECT * FROM runtime_job_queue
          WHERE storage_repository_id = ?
            AND storage_workspace_id = ?
            AND analysis_kind = ?
            AND coalesce_key = ?
            AND status = 'queued'
          ORDER BY queued_at ASC, job_id ASC`
      ).all(
        input.job.repository.storageRepositoryId,
        input.job.worktree.storageWorkspaceId,
        input.analysisKind,
        coalesceKey
      );
      const supersededJobIds = supersededRows.map((row) => String(row.job_id));
      const queuedDepthBefore = Number(db.prepare(
        `SELECT COUNT(*) AS count FROM runtime_job_queue
          WHERE storage_repository_id = ?
            AND storage_workspace_id = ?
            AND status = 'queued'`
      ).get(input.job.repository.storageRepositoryId, input.job.worktree.storageWorkspaceId)?.count ?? 0);
      const runningDepth = Number(db.prepare(
        `SELECT COUNT(*) AS count FROM runtime_job_queue
          WHERE storage_repository_id = ?
            AND storage_workspace_id = ?
            AND status = 'running'`
      ).get(input.job.repository.storageRepositoryId, input.job.worktree.storageWorkspaceId)?.count ?? 0);
      const reservedQueuedDepth = Math.max(0, queuedDepthBefore - supersededRows.length);
      const requiredEvictions = maxQueuedJobs === undefined ? 0 : Math.max(0, reservedQueuedDepth - maxQueuedJobs + 1);
      const evictableRows = requiredEvictions === 0 ? [] : db.prepare(
        `SELECT * FROM runtime_job_queue
          WHERE storage_repository_id = ?
            AND storage_workspace_id = ?
            AND status = 'queued'
            AND priority <= ?
            ${supersededJobIds.length === 0 ? "" : `AND job_id NOT IN (${supersededJobIds.map(() => "?").join(", ")})`}
          ORDER BY priority ASC, queued_at ASC, job_id ASC
          LIMIT ?`
      ).all(
        input.job.repository.storageRepositoryId,
        input.job.worktree.storageWorkspaceId,
        priority,
        ...supersededJobIds,
        requiredEvictions
      );
      if (evictableRows.length < requiredEvictions) {
        const backpressure = {
          schemaVersion: "archcontext.runtime-agent-job-backpressure/v1",
          accepted: false,
          reasonCode: "backpressure-queue-cap",
          priority,
          queuedDepthBefore,
          queuedDepthAfter: queuedDepthBefore,
          runningDepth,
          maxQueuedJobs,
          evictedJobIds: []
        } satisfies RuntimeAgentJobBackpressureDecision;
        db.exec("COMMIT");
        return {
          enqueued: false,
          deduplicated: false,
          supersededJobIds: [],
          evictedJobIds: [],
          rejected: true,
          reasonCode: "backpressure-queue-cap",
          backpressure
        };
      }
      const evictedJobIds = evictableRows.map((row) => String(row.job_id));
      for (const row of evictableRows) {
        const record = runtimeAgentJobRecordFromRow(row);
        const job = runtimeAgentJobWithPatch(record.job, { status: "expired", updatedAt: input.job.queuedAt });
        db.prepare(
          `UPDATE runtime_job_queue
            SET status = ?, job_json = ?, updated_at = ?, last_error = ?
            WHERE job_id = ?`
        ).run("expired", stableJson(job), input.job.queuedAt, "backpressure-queue-cap", record.job.jobId);
      }
      for (const row of supersededRows) {
        const record = runtimeAgentJobRecordFromRow(row);
        const job = runtimeAgentJobWithPatch(record.job, { status: "superseded", updatedAt: input.job.queuedAt });
        db.prepare(
          `UPDATE runtime_job_queue
            SET status = ?, job_json = ?, updated_at = ?, last_error = ?, superseded_by_job_id = ?
            WHERE job_id = ?`
        ).run("superseded", stableJson(job), input.job.queuedAt, "coalesced-by-newer-job", input.job.jobId, record.job.jobId);
      }

      insertRuntimeAgentJob(db, {
        job: input.job,
        analysisKind: input.analysisKind,
        coalesceKey,
        priority,
        maxAttempts,
        debounceUntil: input.debounceUntil
      });
      const inserted = runtimeAgentJobById(db, input.job.jobId);
      if (!inserted) throw new Error(`runtime-agent-job-insert-failed: ${input.job.jobId}`);
      const backpressure = maxQueuedJobs === undefined ? undefined : {
        schemaVersion: "archcontext.runtime-agent-job-backpressure/v1",
        accepted: true,
        priority,
        queuedDepthBefore,
        queuedDepthAfter: Math.max(0, queuedDepthBefore - supersededRows.length - evictedJobIds.length) + 1,
        runningDepth,
        maxQueuedJobs,
        evictedJobIds
      } satisfies RuntimeAgentJobBackpressureDecision;
      db.exec("COMMIT");
      return {
        record: inserted,
        enqueued: true,
        deduplicated: false,
        supersededJobIds,
        evictedJobIds,
        ...(backpressure === undefined ? {} : { backpressure })
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async listRuntimeAgentJobs(input: ArchitectureLedgerScope & { statuses?: RuntimeAgentJobStatus[] }): Promise<RuntimeAgentJobRecord[]> {
    const db = await this.database();
    const statuses = input.statuses ?? [];
    const statusClause = statuses.length > 0 ? `AND status IN (${statuses.map(() => "?").join(", ")})` : "";
    return db.prepare(
      `SELECT * FROM runtime_job_queue
        WHERE storage_repository_id = ?
          AND storage_workspace_id = ?
          ${statusClause}
        ORDER BY priority DESC, queued_at ASC, job_id ASC`
    ).all(input.repository.storageRepositoryId, input.worktree.storageWorkspaceId, ...statuses)
      .map(runtimeAgentJobRecordFromRow);
  }

  async queueStatsRuntimeAgentJobs(input: ArchitectureLedgerScope & { now?: string }): Promise<RuntimeAgentJobQueueStats> {
    const db = await this.database();
    const now = input.now ?? nowIso();
    const records = db.prepare(
      `SELECT * FROM runtime_job_queue
        WHERE storage_repository_id = ?
          AND storage_workspace_id = ?
        ORDER BY updated_at ASC, job_id ASC`
    ).all(input.repository.storageRepositoryId, input.worktree.storageWorkspaceId)
      .map(runtimeAgentJobRecordFromRow);
    return runtimeAgentJobQueueStatsFromRecords(records, {
      now,
      storageRepositoryId: input.repository.storageRepositoryId,
      storageWorkspaceId: input.worktree.storageWorkspaceId
    });
  }

  async claimRuntimeAgentJob(input: RuntimeAgentJobClaimInput): Promise<RuntimeAgentJobRecord | undefined> {
    const db = await this.database();
    const leaseExpiresAt = new Date(Date.parse(input.now) + input.leaseMs).toISOString();
    const maxRunningJobs = normalizeOptionalPositiveInteger(input.maxRunningJobs, "runtime-agent-job-max-running-jobs-invalid");
    db.exec("BEGIN IMMEDIATE");
    try {
      if (maxRunningJobs !== undefined) {
        const runningDepth = Number(db.prepare(
          `SELECT COUNT(*) AS count FROM runtime_job_queue
            WHERE storage_repository_id = ?
              AND status = 'running'
              AND (lease_expires_at IS NULL OR lease_expires_at > ?)`
        ).get(input.repository.storageRepositoryId, input.now)?.count ?? 0);
        if (runningDepth >= maxRunningJobs) {
          db.exec("COMMIT");
          return undefined;
        }
      }
      const row = db.prepare(
        `SELECT * FROM runtime_job_queue
          WHERE storage_repository_id = ?
            AND storage_workspace_id = ?
            AND (
              (status = 'queued' AND (debounce_until IS NULL OR debounce_until <= ?))
              OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
            )
          ORDER BY priority DESC, queued_at ASC, job_id ASC
          LIMIT 1`
      ).get(input.repository.storageRepositoryId, input.worktree.storageWorkspaceId, input.now, input.now);
      if (!row) {
        db.exec("COMMIT");
        return undefined;
      }
      const record = runtimeAgentJobRecordFromRow(row);
      const nextAttempt = record.attemptCount + 1;
      if (nextAttempt > record.maxAttempts) {
        const failed = runtimeAgentJobWithPatch(record.job, { status: "failed", updatedAt: input.now });
        db.prepare(
          `UPDATE runtime_job_queue
            SET status = ?, job_json = ?, updated_at = ?, attempt_count = ?, lease_owner = NULL,
              leased_at = NULL, lease_expires_at = NULL, last_error = ?, dead_lettered_at = ?
            WHERE job_id = ?`
        ).run("failed", stableJson(failed), input.now, nextAttempt, "max-attempts-exhausted", input.now, record.job.jobId);
        db.exec("COMMIT");
        return undefined;
      }

      const running = runtimeAgentJobWithPatch(record.job, { status: "running", updatedAt: input.now });
      db.prepare(
        `UPDATE runtime_job_queue
          SET status = ?, job_json = ?, updated_at = ?, attempt_count = ?, lease_owner = ?,
            leased_at = ?, lease_expires_at = ?, last_error = NULL
          WHERE job_id = ?`
      ).run("running", stableJson(running), input.now, nextAttempt, input.workerId, input.now, leaseExpiresAt, record.job.jobId);
      const claimed = runtimeAgentJobById(db, record.job.jobId);
      if (!claimed) throw new Error(`runtime-agent-job-not-found: ${record.job.jobId}`);
      db.exec("COMMIT");
      return claimed;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async completeRuntimeAgentJob(input: RuntimeAgentJobCompleteInput): Promise<RuntimeAgentJobRecord> {
    const db = await this.database();
    const record = runtimeAgentJobById(db, input.jobId);
    if (!record) throw new Error(`runtime-agent-job-not-found: ${input.jobId}`);
    if (input.workerId && record.leaseOwner && record.leaseOwner !== input.workerId) {
      throw new Error(`runtime-agent-job-lease-owner-mismatch: ${input.jobId}`);
    }
    const deadLetteredAt = input.status === "failed" && record.attemptCount >= record.maxAttempts ? input.now : undefined;
    const job = runtimeAgentJobWithPatch(record.job, { status: input.status, updatedAt: input.now, outputDigest: input.outputDigest });
    db.prepare(
      `UPDATE runtime_job_queue
        SET status = ?, job_json = ?, updated_at = ?, output_digest = ?, lease_owner = NULL,
          leased_at = NULL, lease_expires_at = NULL, last_error = ?, dead_lettered_at = COALESCE(?, dead_lettered_at)
        WHERE job_id = ?`
    ).run(input.status, stableJson(job), input.now, input.outputDigest ?? record.job.outputDigest ?? null, input.error ?? null, deadLetteredAt ?? null, input.jobId);
    const updated = runtimeAgentJobById(db, input.jobId);
    if (!updated) throw new Error(`runtime-agent-job-not-found: ${input.jobId}`);
    return updated;
  }

  async retryRuntimeAgentJob(input: RuntimeAgentJobRetryInput): Promise<RuntimeAgentJobRecord> {
    const db = await this.database();
    const record = runtimeAgentJobById(db, input.jobId);
    if (!record) throw new Error(`runtime-agent-job-not-found: ${input.jobId}`);
    if (record.attemptCount >= record.maxAttempts) {
      const failed = runtimeAgentJobWithPatch(record.job, { status: "failed", updatedAt: input.now });
      db.prepare(
        `UPDATE runtime_job_queue
          SET status = ?, job_json = ?, updated_at = ?, lease_owner = NULL,
            leased_at = NULL, lease_expires_at = NULL, last_error = ?, dead_lettered_at = ?
          WHERE job_id = ?`
      ).run("failed", stableJson(failed), input.now, input.reason ?? "max-attempts-exhausted", input.now, input.jobId);
    } else {
      const queued = runtimeAgentJobWithPatch(record.job, { status: "queued", updatedAt: input.now });
      db.prepare(
        `UPDATE runtime_job_queue
          SET status = ?, job_json = ?, updated_at = ?, lease_owner = NULL,
            leased_at = NULL, lease_expires_at = NULL, last_error = ?, dead_lettered_at = NULL
          WHERE job_id = ?`
      ).run("queued", stableJson(queued), input.now, input.reason ?? null, input.jobId);
    }
    const updated = runtimeAgentJobById(db, input.jobId);
    if (!updated) throw new Error(`runtime-agent-job-not-found: ${input.jobId}`);
    return updated;
  }

  async cancelRuntimeAgentJob(input: RuntimeAgentJobCancelInput): Promise<RuntimeAgentJobRecord> {
    const db = await this.database();
    const record = runtimeAgentJobById(db, input.jobId);
    if (!record) throw new Error(`runtime-agent-job-not-found: ${input.jobId}`);
    const job = runtimeAgentJobWithPatch(record.job, { status: input.status, updatedAt: input.now });
    db.prepare(
      `UPDATE runtime_job_queue
        SET status = ?, job_json = ?, updated_at = ?, lease_owner = NULL,
          leased_at = NULL, lease_expires_at = NULL, last_error = ?, superseded_by_job_id = COALESCE(?, superseded_by_job_id)
        WHERE job_id = ?`
    ).run(input.status, stableJson(job), input.now, input.reason ?? null, input.supersededByJobId ?? null, input.jobId);
    const updated = runtimeAgentJobById(db, input.jobId);
    if (!updated) throw new Error(`runtime-agent-job-not-found: ${input.jobId}`);
    return updated;
  }

  async cancelStaleRuntimeAgentJobs(input: RuntimeAgentJobStaleCancellationInput): Promise<RuntimeAgentJobRecord[]> {
    const db = await this.database();
    const staleRows = db.prepare(
      `SELECT * FROM runtime_job_queue
        WHERE storage_repository_id = ?
          AND storage_workspace_id = ?
          AND status IN ('queued', 'running')
          AND stale_policy = 'cancel-on-head-change'
        ORDER BY queued_at ASC, job_id ASC`
    ).all(input.repository.storageRepositoryId, input.worktree.storageWorkspaceId)
      .map(runtimeAgentJobRecordFromRow)
      .filter((record) =>
        record.job.worktree.headSha !== input.headSha
        || record.job.worktree.worktreeDigest !== input.worktreeDigest);
    const cancelled: RuntimeAgentJobRecord[] = [];
    for (const record of staleRows) {
      cancelled.push(await this.cancelRuntimeAgentJob({
        jobId: record.job.jobId,
        status: "expired",
        now: input.now,
        reason: input.reason ?? "stale-head-or-worktree"
      }));
    }
    return cancelled;
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

  async recordChangeSetLedgerPlan(journalId: string, input: { event: ArchitectureEventV1 }): Promise<void> {
    validateArchitectureLedgerEvent(input.event);
    const db = await this.database();
    const metadata = readChangeSetJournalMetadata(db, journalId);
    db.prepare("UPDATE changeset_journal SET metadata_json = ?, updated_at = ? WHERE journal_id = ?")
      .run(stableJson(withChangeSetJournalArchitectureLedger(metadata, {
        plannedEvent: input.event as unknown as Json,
        plannedAt: nowIso()
      })), nowIso(), journalId);
  }

  async recordChangeSetLedgerAppend(journalId: string, input: { result: ArchitectureLedgerAppendResult }): Promise<void> {
    const db = await this.database();
    const metadata = readChangeSetJournalMetadata(db, journalId);
    db.prepare("UPDATE changeset_journal SET metadata_json = ?, updated_at = ? WHERE journal_id = ?")
      .run(stableJson(withChangeSetJournalArchitectureLedger(metadata, {
        append: changeSetLedgerAppendSummary(input.result) as unknown as Json,
        appendedAt: nowIso()
      })), nowIso(), journalId);
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
    const rows = db.prepare("SELECT journal_id, root, files_json, metadata_json FROM changeset_journal WHERE status = ?").all("pending");
    for (const row of rows) {
      const files = JSON.parse(String(row.files_json)) as ChangeSetJournalFile[];
      const metadata = JSON.parse(String(row.metadata_json)) as Record<string, unknown>;
      const plannedLedgerEvent = changeSetJournalPlannedLedgerEvent(metadata);
      const existingLedgerEvent = plannedLedgerEvent ? architectureEventByIdempotency(db, plannedLedgerEvent) : undefined;
      if (plannedLedgerEvent && existingLedgerEvent) {
        const expectedEventHash = normalizeArchitectureLedgerEvent(plannedLedgerEvent, existingLedgerEvent.previousEventHash).eventHash;
        if (expectedEventHash !== existingLedgerEvent.event.eventHash) {
          throw new Error(`changeset-ledger-recovery-idempotency-conflict: ${plannedLedgerEvent.idempotencyKey}`);
        }
        cleanupCommittedJournalFiles(files);
        db.prepare("UPDATE changeset_journal SET status = ?, metadata_json = ?, updated_at = ?, completed_at = ? WHERE journal_id = ?")
          .run("committed", stableJson(withChangeSetJournalArchitectureLedger(metadata, {
            recovery: {
              schemaVersion: "archcontext.changeset-ledger-recovery/v1",
              status: "ledger-append-detected",
              eventId: existingLedgerEvent.event.eventId,
              eventHash: existingLedgerEvent.event.eventHash ?? "",
              recoveredAt: nowIso()
            } as unknown as Json
          })), nowIso(), nowIso(), String(row.journal_id));
        continue;
      }
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

  async appendArchitectureEvents(input: ArchitectureLedgerAppendInput): Promise<ArchitectureLedgerAppendResult> {
    if (input.writer !== "runtime-daemon") throw new Error("architecture-ledger-writer-must-be-runtime-daemon");
    for (const event of input.events) validateArchitectureLedgerEvent(event);
    const db = await this.database();
    const startedAt = Date.now();
    const appendedEvents: ArchitectureEventV1[] = [];
    const duplicateEvents: ArchitectureEventV1[] = [];
    db.exec("BEGIN IMMEDIATE");
    try {
      let processed = 0;
      for (const event of input.events) {
        const duplicate = architectureEventByIdempotency(db, event);
        if (duplicate) {
          const expectedDuplicateHash = normalizeArchitectureLedgerEvent(event, duplicate.previousEventHash).eventHash;
          if (expectedDuplicateHash !== duplicate.event.eventHash) {
            throw new Error(`architecture-ledger-idempotency-conflict: ${event.idempotencyKey}`);
          }
          duplicateEvents.push(duplicate.event);
          continue;
        }
        const previousEventHash = latestArchitectureEventHash(db, event.repository.storageRepositoryId, event.worktree.storageWorkspaceId);
        const normalized = normalizeArchitectureLedgerEvent(event, previousEventHash);
        insertArchitectureEvent(db, normalized);
        persistArchitectureLedgerArtifacts(db, normalized);
        materializeArchitectureLedgerEvent(db, normalized);
        appendedEvents.push(normalized);
        processed += 1;
        if (input.faultAfterEvents !== undefined && processed >= input.faultAfterEvents) throw new Error("architecture-ledger-fault-injection");
      }
      const scope = architectureScopeFromEvent(input.events[0] ?? duplicateEvents[0]);
      const state = scope ? readArchitectureLedgerStateFromDb(db, scope) : emptyArchitectureLedgerState();
      if (scope) {
        recordArchitectureLedgerOperation(db, {
          scope,
          operationKind: "append_events",
          durationMs: Date.now() - startedAt,
          rowCount: appendedEvents.length,
          rebuildReason: null
        });
      }
      db.exec("COMMIT");
      return {
        appendedEvents,
        duplicateEvents,
        graphDigest: architectureLedgerStateDigest(state),
        entityCount: state.entities.length,
        relationCount: state.relations.length,
        constraintCount: state.constraints.length
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async readArchitectureLedgerSourceCursor(input: ArchitectureLedgerScope & { cursorId: string }): Promise<Record<string, Json> | undefined> {
    const db = await this.database();
    const row = db.prepare(
      `SELECT cursor_json FROM source_cursors
        WHERE storage_repository_id = ? AND storage_workspace_id = ? AND cursor_id = ?`
    ).get(input.repository.storageRepositoryId, input.worktree.storageWorkspaceId, input.cursorId);
    return row ? JSON.parse(String(row.cursor_json)) as Record<string, Json> : undefined;
  }

  async createArchitectureLedgerSnapshot(input: ArchitectureLedgerSnapshotInput): Promise<ArchitectureSnapshotV1> {
    const db = await this.database();
    const startedAt = Date.now();
    const latest = latestArchitectureEvent(db, input.repository.storageRepositoryId, input.worktree.storageWorkspaceId);
    if (!latest) throw new Error("architecture-ledger-snapshot-requires-event");
    const state = readArchitectureLedgerStateFromDb(db, input);
    const snapshot = architectureLedgerSnapshotFromState({
      ...input,
      lastEventId: latest.event.eventId,
      lastEventHash: latest.event.eventHash ?? latest.eventHash,
      state
    });
    db.prepare(
      `INSERT INTO architecture_snapshots
        (snapshot_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, branch, head_sha, worktree_digest,
          source_mode, last_event_id, last_event_hash, graph_digest, projection_digest, entity_count, relation_count,
          constraint_count, input_digests_json, snapshot_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      snapshot.snapshotId,
      snapshot.repository.repositoryId,
      snapshot.repository.storageRepositoryId,
      snapshot.worktree.workspaceId,
      snapshot.worktree.storageWorkspaceId,
      snapshot.worktree.branch,
      snapshot.worktree.headSha,
      snapshot.worktree.worktreeDigest,
      snapshot.sourceMode,
      snapshot.eventCursor.lastEventId,
      snapshot.eventCursor.lastEventHash,
      snapshot.graphDigest,
      snapshot.projectionDigest,
      snapshot.entityCount,
      snapshot.relationCount,
      snapshot.constraintCount,
      stableJson(snapshot.inputDigests),
      stableJson(snapshot),
      snapshot.createdAt
    );
    recordArchitectureLedgerOperation(db, {
      scope: input,
      operationKind: "create_snapshot",
      durationMs: Date.now() - startedAt,
      rowCount: 1,
      rebuildReason: null
    });
    return snapshot;
  }

  async readArchitectureLedgerState(input: ArchitectureLedgerScope): Promise<ArchitectureLedgerGraphState> {
    const db = await this.database();
    return readArchitectureLedgerStateFromDb(db, input);
  }

  async replayArchitectureLedger(input: ArchitectureLedgerReplayInput): Promise<ArchitectureLedgerReplayResult> {
    const db = await this.database();
    const events = architectureEventsForReplay(db, input);
    const state = replayArchitectureLedgerEvents(events);
    return { events, state, graphDigest: architectureLedgerStateDigest(state) };
  }

  async verifyArchitectureLedgerReplay(input: ArchitectureLedgerReplayInput): Promise<ArchitectureLedgerReplayVerification> {
    const materialized = await this.readArchitectureLedgerState(input);
    const replayed = await this.replayArchitectureLedger(input);
    const materializedDigest = architectureLedgerStateDigest(materialized);
    const mismatches = materializedDigest === replayed.graphDigest && stableJson(materialized) === stableJson(replayed.state)
      ? []
      : ["materialized-current-state-does-not-match-replay"];
    return {
      ok: mismatches.length === 0,
      materializedDigest,
      replayedDigest: replayed.graphDigest,
      eventCount: replayed.events.length,
      mismatches
    };
  }

  async rebuildArchitectureLedgerCurrentState(input: ArchitectureLedgerScope): Promise<ArchitectureLedgerReplayResult> {
    const db = await this.database();
    const startedAt = Date.now();
    db.exec("BEGIN IMMEDIATE");
    try {
      deleteArchitectureCurrentState(db, input);
      const events = architectureEventsForReplay(db, input);
      for (const event of events) materializeArchitectureLedgerEvent(db, event);
      const state = readArchitectureLedgerStateFromDb(db, input);
      recordArchitectureLedgerOperation(db, {
        scope: input,
        operationKind: "rebuild_current_state",
        durationMs: Date.now() - startedAt,
        rowCount: events.length,
        rebuildReason: "manual-current-state-rebuild"
      });
      db.exec("COMMIT");
      return { events, state, graphDigest: architectureLedgerStateDigest(state) };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async compactArchitectureLedger(input: ArchitectureLedgerScope & { beforeSnapshotId: string }): Promise<{ snapshotId: string; compactedEventCount: number }> {
    const db = await this.database();
    const startedAt = Date.now();
    const snapshot = db.prepare(
      `SELECT last_event_id FROM architecture_snapshots
        WHERE snapshot_id = ? AND storage_repository_id = ? AND storage_workspace_id = ?`
    ).get(input.beforeSnapshotId, input.repository.storageRepositoryId, input.worktree.storageWorkspaceId);
    if (!snapshot) throw new Error(`architecture-ledger-snapshot-not-found: ${input.beforeSnapshotId}`);
    const cursor = db.prepare("SELECT event_sequence FROM architecture_events WHERE event_id = ?").get(String(snapshot.last_event_id));
    if (!cursor) throw new Error(`architecture-ledger-snapshot-cursor-not-found: ${String(snapshot.last_event_id)}`);
    const before = Number(db.prepare(
      `SELECT COUNT(*) AS count FROM architecture_events
        WHERE storage_repository_id = ? AND storage_workspace_id = ? AND event_sequence <= ? AND compacted_by_snapshot_id IS NULL`
    ).get(input.repository.storageRepositoryId, input.worktree.storageWorkspaceId, Number(cursor.event_sequence))?.count ?? 0);
    db.prepare(
      `UPDATE architecture_events SET compacted_by_snapshot_id = ?
        WHERE storage_repository_id = ? AND storage_workspace_id = ? AND event_sequence <= ? AND compacted_by_snapshot_id IS NULL`
    ).run(input.beforeSnapshotId, input.repository.storageRepositoryId, input.worktree.storageWorkspaceId, Number(cursor.event_sequence));
    recordArchitectureLedgerOperation(db, {
      scope: input,
      operationKind: "compact_events",
      durationMs: Date.now() - startedAt,
      rowCount: before,
      rebuildReason: null
    });
    return { snapshotId: input.beforeSnapshotId, compactedEventCount: before };
  }

  async checkArchitectureLedgerIntegrity(input: ArchitectureLedgerScope): Promise<ArchitectureLedgerIntegrityResult> {
    const db = await this.database();
    const startedAt = Date.now();
    const failures: string[] = [];
    const integrity = sqliteIntegrityCheckOpenDatabase(db, this.databasePath);
    if (integrity !== "ok") failures.push(`sqlite-integrity:${integrity}`);
    const replay = await this.verifyArchitectureLedgerReplay(input);
    if (!replay.ok) failures.push(...replay.mismatches);
    const snapshotCount = Number(db.prepare(
      "SELECT COUNT(*) AS count FROM architecture_snapshots WHERE storage_repository_id = ? AND storage_workspace_id = ?"
    ).get(input.repository.storageRepositoryId, input.worktree.storageWorkspaceId)?.count ?? 0);
    const result = {
      ok: failures.length === 0,
      graphDigest: replay.materializedDigest,
      eventCount: replay.eventCount,
      snapshotCount,
      failures
    };
    recordArchitectureLedgerOperation(db, {
      scope: input,
      operationKind: "integrity_check",
      durationMs: Date.now() - startedAt,
      rowCount: replay.eventCount,
      rebuildReason: null
    });
    return result;
  }

  async backupArchitectureLedger(input: { backupPath: string }): Promise<{ backupPath: string; integrity: string }> {
    const db = await this.database();
    ensurePrivateDir(dirname(input.backupPath));
    if (existsSync(input.backupPath)) rmSync(input.backupPath, { force: true });
    db.exec(`VACUUM INTO ${sqliteStringLiteral(input.backupPath)}`);
    return { backupPath: input.backupPath, integrity: assertSqliteIntegrity(input.backupPath) };
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

function architectureScopeFromEvent(event: ArchitectureEventV1 | undefined): ArchitectureLedgerScope | undefined {
  return event ? { repository: event.repository, worktree: event.worktree } : undefined;
}

function architectureEventByIdempotency(db: SqliteDatabase, event: ArchitectureEventV1): { event: ArchitectureEventV1; previousEventHash: string | null } | undefined {
  const row = db.prepare(
    `SELECT event_json, previous_event_hash FROM architecture_events
      WHERE storage_repository_id = ? AND storage_workspace_id = ? AND idempotency_key = ?`
  ).get(event.repository.storageRepositoryId, event.worktree.storageWorkspaceId, event.idempotencyKey);
  return row ? {
    event: JSON.parse(String(row.event_json)) as ArchitectureEventV1,
    previousEventHash: row.previous_event_hash === null || row.previous_event_hash === undefined ? null : String(row.previous_event_hash)
  } : undefined;
}

function latestArchitectureEventHash(db: SqliteDatabase, storageRepositoryId: string, storageWorkspaceId: string): string | null {
  return latestArchitectureEvent(db, storageRepositoryId, storageWorkspaceId)?.eventHash ?? null;
}

function latestArchitectureEvent(db: SqliteDatabase, storageRepositoryId: string, storageWorkspaceId: string): { event: ArchitectureEventV1; eventHash: string } | undefined {
  const row = db.prepare(
    `SELECT event_json, event_hash FROM architecture_events
      WHERE storage_repository_id = ? AND storage_workspace_id = ?
      ORDER BY event_sequence DESC LIMIT 1`
  ).get(storageRepositoryId, storageWorkspaceId);
  return row ? { event: JSON.parse(String(row.event_json)) as ArchitectureEventV1, eventHash: String(row.event_hash) } : undefined;
}

function insertArchitectureEvent(db: SqliteDatabase, event: ArchitectureEventV1): void {
  db.prepare(
    `INSERT INTO architecture_events
      (event_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, branch, head_sha, worktree_digest,
        event_type, payload_version, source, actor_kind, actor_id, base_digest, resulting_digest, previous_event_hash,
        event_hash, idempotency_key, payload_json, provenance_json, event_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.eventId,
    event.repository.repositoryId,
    event.repository.storageRepositoryId,
    event.worktree.workspaceId,
    event.worktree.storageWorkspaceId,
    event.worktree.branch,
    event.worktree.headSha,
    event.worktree.worktreeDigest,
    event.eventType,
    event.payloadVersion,
    event.source,
    event.actor.kind,
    event.actor.id,
    event.baseDigest,
    event.resultingDigest,
    event.previousEventHash ?? null,
    event.eventHash,
    event.idempotencyKey,
    stableJson(event.payload),
    stableJson(event.provenance),
    stableJson(event),
    event.timestamp
  );
  insertArchitectureLedgerFts(db, "event", architectureLedgerPayload(event).summary ?? "", architectureLedgerPayload(event).rationale ?? "", architectureLedgerPayload(event).title ?? "", "");
}

function persistArchitectureLedgerArtifacts(db: SqliteDatabase, event: ArchitectureEventV1): void {
  const payload = architectureLedgerPayload(event);
  for (const evidence of payload.evidenceItems ?? []) {
    db.prepare(
      `INSERT OR REPLACE INTO evidence_items
        (evidence_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, event_id, kind, strength,
          polarity, origin, subject, selector_json, summary, coverage_json, supports_json, provenance_json, evidence_json, digest, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      evidence.evidenceId,
      event.repository.repositoryId,
      event.repository.storageRepositoryId,
      event.worktree.workspaceId,
      event.worktree.storageWorkspaceId,
      event.eventId,
      evidence.kind,
      evidence.strength,
      evidence.polarity,
      evidence.origin,
      evidence.subject,
      stableJson(evidence.selector),
      evidence.summary,
      stableJson(evidence.coverage),
      stableJson(evidence.supports),
      stableJson(evidence.provenance),
      stableJson(evidence),
      evidence.digest,
      evidence.createdAt
    );
    insertArchitectureLedgerFts(db, "evidence", evidence.summary, "", "", evidence.summary);
  }
  for (const binding of payload.evidenceBindings ?? []) {
    db.prepare(
      `INSERT OR REPLACE INTO evidence_bindings
        (binding_id, evidence_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, event_id,
          target_kind, target_id, binding_reason, authority_effect, provenance_json, binding_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      binding.bindingId,
      binding.evidenceId,
      event.repository.repositoryId,
      event.repository.storageRepositoryId,
      event.worktree.workspaceId,
      event.worktree.storageWorkspaceId,
      event.eventId,
      binding.target.kind,
      binding.target.id,
      binding.bindingReason,
      binding.authorityEffect,
      stableJson(binding.provenance),
      stableJson(binding),
      binding.createdAt
    );
  }
  for (const run of payload.recommendationRuns ?? []) persistRecommendationRun(db, event, run);
  for (const recommendation of payload.recommendations ?? []) persistRecommendation(db, event, recommendation);
  for (const job of payload.agentJobs ?? []) persistAgentJob(db, event, job);
  for (const feedback of payload.feedback ?? []) persistGenericLedgerJson(db, event, "recommendation_feedback", "feedback_id", "feedback_json", feedback, "feedback");
  for (const waiver of payload.waivers ?? []) persistGenericLedgerJson(db, event, "waivers", "waiver_id", "waiver_json", waiver, "waiver");
  for (const cursor of payload.sourceCursors ?? []) persistSourceCursor(db, event, cursor);
  if (payload.projectionState) persistProjectionState(db, event, payload.projectionState);
}

function persistRecommendationRun(db: SqliteDatabase, event: ArchitectureEventV1, run: NonNullable<ArchitectureLedgerEventPayload["recommendationRuns"]>[number]): void {
  db.prepare(
    `INSERT OR REPLACE INTO recommendation_runs
      (run_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, event_id, status, catalog_digest,
        input_digest, output_digest, metrics_json, run_json, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    run.runId,
    event.repository.repositoryId,
    event.repository.storageRepositoryId,
    event.worktree.workspaceId,
    event.worktree.storageWorkspaceId,
    event.eventId,
    run.status,
    run.catalogDigest,
    run.inputDigest,
    run.outputDigest,
    stableJson(run.metrics),
    stableJson(run),
    run.startedAt,
    run.completedAt ?? null
  );
}

function persistRecommendation(db: SqliteDatabase, event: ArchitectureEventV1, recommendation: NonNullable<ArchitectureLedgerEventPayload["recommendations"]>[number]): void {
  db.prepare(
    `INSERT OR REPLACE INTO recommendations
      (recommendation_id, run_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, event_id, fingerprint,
        subject, practice_id, status, confidence, enforcement, risk, uncertainty, evidence_binding_ids_json, explanation_json,
        recommendation_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    recommendation.recommendationId,
    recommendation.runId,
    event.repository.repositoryId,
    event.repository.storageRepositoryId,
    event.worktree.workspaceId,
    event.worktree.storageWorkspaceId,
    event.eventId,
    recommendation.fingerprint,
    recommendation.subject,
    recommendation.practiceId ?? null,
    recommendation.status,
    recommendation.confidence,
    recommendation.enforcement,
    recommendation.risk,
    recommendation.uncertainty,
    stableJson(recommendation.evidenceBindingIds),
    stableJson(recommendation.explanation),
    stableJson(recommendation),
    recommendation.createdAt,
    recommendation.updatedAt
  );
  insertArchitectureLedgerFts(db, "recommendation", recommendation.explanation.join("\n"), "", recommendation.subject, recommendation.explanation.join("\n"));
}

function persistAgentJob(db: SqliteDatabase, event: ArchitectureEventV1, job: NonNullable<ArchitectureLedgerEventPayload["agentJobs"]>[number]): void {
  db.prepare(
    `INSERT OR REPLACE INTO agent_jobs
      (job_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, event_id, status, runner_port,
        fingerprint, input_digest, output_digest, stale_policy, job_json, queued_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    job.jobId,
    event.repository.repositoryId,
    event.repository.storageRepositoryId,
    event.worktree.workspaceId,
    event.worktree.storageWorkspaceId,
    event.eventId,
    job.status,
    job.runnerPort,
    job.fingerprint,
    job.inputDigest,
    job.outputDigest ?? null,
    job.stalePolicy,
    stableJson(job),
    job.queuedAt,
    job.updatedAt
  );
}

function persistProjectionState(db: SqliteDatabase, event: ArchitectureEventV1, state: Record<string, Json>): void {
  const path = String(state.path ?? "projection");
  const projectionDigest = typeof state.projectionDigest === "string" ? state.projectionDigest : digestJson(state);
  db.prepare(
    `INSERT OR REPLACE INTO projection_state
      (projection_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, event_id, path, projection_digest, state_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(state.projectionId ?? stableLedgerId("projection", event.eventId, path)),
    event.repository.repositoryId,
    event.repository.storageRepositoryId,
    event.worktree.workspaceId,
    event.worktree.storageWorkspaceId,
    event.eventId,
    path,
    projectionDigest,
    stableJson(state),
    event.timestamp
  );
}

function persistSourceCursor(db: SqliteDatabase, event: ArchitectureEventV1, cursor: Record<string, Json>): void {
  const source = String(cursor.source ?? event.source);
  db.prepare(
    `INSERT OR REPLACE INTO source_cursors
      (cursor_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, source, cursor_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(cursor.cursorId ?? stableLedgerId("cursor", event.eventId, source)),
    event.repository.repositoryId,
    event.repository.storageRepositoryId,
    event.worktree.workspaceId,
    event.worktree.storageWorkspaceId,
    source,
    stableJson(cursor),
    event.timestamp
  );
}

function persistGenericLedgerJson(
  db: SqliteDatabase,
  event: ArchitectureEventV1,
  table: "recommendation_feedback" | "waivers",
  idColumn: "feedback_id" | "waiver_id",
  jsonColumn: "feedback_json" | "waiver_json",
  value: Record<string, Json>,
  prefix: string
): void {
  const id = String(value[idColumn] ?? value.id ?? stableLedgerId(prefix, event.eventId, stableJson(value)));
  if (table === "recommendation_feedback") {
    db.prepare(
      `INSERT OR REPLACE INTO recommendation_feedback
        (feedback_id, recommendation_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, event_id, feedback_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      String(value.recommendationId ?? value.recommendation_id ?? "unknown"),
      event.repository.repositoryId,
      event.repository.storageRepositoryId,
      event.worktree.workspaceId,
      event.worktree.storageWorkspaceId,
      event.eventId,
      stableJson(value),
      String(value.createdAt ?? event.timestamp)
    );
    return;
  }
  db.prepare(
    `INSERT OR REPLACE INTO waivers
      (waiver_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, event_id, target_kind, target_id, waiver_json, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    event.repository.repositoryId,
    event.repository.storageRepositoryId,
    event.worktree.workspaceId,
    event.worktree.storageWorkspaceId,
    event.eventId,
    String(value.targetKind ?? value.target_kind ?? "unknown"),
    String(value.targetId ?? value.target_id ?? "unknown"),
    stableJson(value),
    String(value.createdAt ?? event.timestamp),
    value.expiresAt ? String(value.expiresAt) : null
  );
}

function materializeArchitectureLedgerEvent(db: SqliteDatabase, event: ArchitectureEventV1): void {
  const payload = architectureLedgerPayload(event);
  for (const operation of payload.operations ?? []) {
    switch (operation.op) {
      case "upsert_entity":
        upsertArchitectureEntity(db, event, operation.entity);
        break;
      case "delete_entity":
        db.prepare("DELETE FROM architecture_entities_current WHERE storage_repository_id = ? AND storage_workspace_id = ? AND entity_id = ?")
          .run(event.repository.storageRepositoryId, event.worktree.storageWorkspaceId, operation.entityId);
        db.prepare("DELETE FROM architecture_relations_current WHERE storage_repository_id = ? AND storage_workspace_id = ? AND (source_entity_id = ? OR target_entity_id = ?)")
          .run(event.repository.storageRepositoryId, event.worktree.storageWorkspaceId, operation.entityId, operation.entityId);
        break;
      case "upsert_relation":
        upsertArchitectureRelation(db, event, operation.relation);
        break;
      case "delete_relation":
        db.prepare("DELETE FROM architecture_relations_current WHERE storage_repository_id = ? AND storage_workspace_id = ? AND relation_id = ?")
          .run(event.repository.storageRepositoryId, event.worktree.storageWorkspaceId, operation.relationId);
        break;
      case "upsert_constraint":
        upsertArchitectureConstraint(db, event, operation.constraint);
        break;
      case "delete_constraint":
        db.prepare("DELETE FROM architecture_constraints_current WHERE storage_repository_id = ? AND storage_workspace_id = ? AND constraint_id = ?")
          .run(event.repository.storageRepositoryId, event.worktree.storageWorkspaceId, operation.constraintId);
        break;
    }
  }
}

function upsertArchitectureEntity(db: SqliteDatabase, event: ArchitectureEventV1, entity: ArchitectureLedgerEntityRecord): void {
  db.prepare(
    `INSERT OR REPLACE INTO architecture_entities_current
      (storage_repository_id, storage_workspace_id, entity_id, repository_id, workspace_id, branch, head_sha, worktree_digest,
        kind, canonical_name, status, path, summary, metadata_json, last_event_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.repository.storageRepositoryId,
    event.worktree.storageWorkspaceId,
    entity.entityId,
    event.repository.repositoryId,
    event.worktree.workspaceId,
    event.worktree.branch,
    event.worktree.headSha,
    event.worktree.worktreeDigest,
    entity.kind,
    entity.canonicalName,
    entity.status,
    entity.path ?? null,
    entity.summary ?? null,
    stableJson(entity.metadata ?? {}),
    event.eventId,
    event.timestamp
  );
  insertArchitectureLedgerFts(db, "entity", entity.summary ?? "", "", entity.canonicalName, "");
}

function upsertArchitectureRelation(db: SqliteDatabase, event: ArchitectureEventV1, relation: ArchitectureLedgerRelationRecord): void {
  db.prepare(
    `INSERT OR REPLACE INTO architecture_relations_current
      (storage_repository_id, storage_workspace_id, relation_id, repository_id, workspace_id, branch, head_sha, worktree_digest,
        kind, source_entity_id, target_entity_id, status, summary, metadata_json, last_event_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.repository.storageRepositoryId,
    event.worktree.storageWorkspaceId,
    relation.relationId,
    event.repository.repositoryId,
    event.worktree.workspaceId,
    event.worktree.branch,
    event.worktree.headSha,
    event.worktree.worktreeDigest,
    relation.kind,
    relation.sourceEntityId,
    relation.targetEntityId,
    relation.status,
    relation.summary ?? null,
    stableJson(relation.metadata ?? {}),
    event.eventId,
    event.timestamp
  );
  insertArchitectureLedgerFts(db, "relation", relation.summary ?? "", "", relation.relationId, "");
}

function upsertArchitectureConstraint(db: SqliteDatabase, event: ArchitectureEventV1, constraint: ArchitectureLedgerConstraintRecord): void {
  db.prepare(
    `INSERT OR REPLACE INTO architecture_constraints_current
      (storage_repository_id, storage_workspace_id, constraint_id, repository_id, workspace_id, branch, head_sha, worktree_digest,
        kind, subject_id, status, severity, summary, metadata_json, last_event_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.repository.storageRepositoryId,
    event.worktree.storageWorkspaceId,
    constraint.constraintId,
    event.repository.repositoryId,
    event.worktree.workspaceId,
    event.worktree.branch,
    event.worktree.headSha,
    event.worktree.worktreeDigest,
    constraint.kind,
    constraint.subjectId,
    constraint.status,
    constraint.severity ?? null,
    constraint.summary ?? null,
    stableJson(constraint.metadata ?? {}),
    event.eventId,
    event.timestamp
  );
  insertArchitectureLedgerFts(db, "constraint", constraint.summary ?? "", "", constraint.constraintId, "");
}

function readArchitectureLedgerStateFromDb(db: SqliteDatabase, scope: ArchitectureLedgerScope): ArchitectureLedgerGraphState {
  const scopeParams = [scope.repository.storageRepositoryId, scope.worktree.storageWorkspaceId];
  const entities = db.prepare(
    `SELECT entity_id, kind, canonical_name, status, path, summary, metadata_json
      FROM architecture_entities_current
      WHERE storage_repository_id = ? AND storage_workspace_id = ?
      ORDER BY entity_id`
  ).all(...scopeParams).map((row) => ({
    entityId: String(row.entity_id),
    kind: String(row.kind),
    canonicalName: String(row.canonical_name),
    status: row.status as ArchitectureLedgerEntityRecord["status"],
    ...(row.path ? { path: String(row.path) } : {}),
    ...(row.summary ? { summary: String(row.summary) } : {}),
    ...optionalJsonMetadata(row.metadata_json)
  }));
  const relations = db.prepare(
    `SELECT relation_id, kind, source_entity_id, target_entity_id, status, summary, metadata_json
      FROM architecture_relations_current
      WHERE storage_repository_id = ? AND storage_workspace_id = ?
      ORDER BY relation_id`
  ).all(...scopeParams).map((row) => ({
    relationId: String(row.relation_id),
    kind: String(row.kind),
    sourceEntityId: String(row.source_entity_id),
    targetEntityId: String(row.target_entity_id),
    status: row.status as ArchitectureLedgerRelationRecord["status"],
    ...(row.summary ? { summary: String(row.summary) } : {}),
    ...optionalJsonMetadata(row.metadata_json)
  }));
  const constraints = db.prepare(
    `SELECT constraint_id, kind, subject_id, status, severity, summary, metadata_json
      FROM architecture_constraints_current
      WHERE storage_repository_id = ? AND storage_workspace_id = ?
      ORDER BY constraint_id`
  ).all(...scopeParams).map((row) => ({
    constraintId: String(row.constraint_id),
    kind: String(row.kind),
    subjectId: String(row.subject_id),
    status: row.status as ArchitectureLedgerConstraintRecord["status"],
    ...(row.severity ? { severity: row.severity as ArchitectureLedgerConstraintRecord["severity"] } : {}),
    ...(row.summary ? { summary: String(row.summary) } : {}),
    ...optionalJsonMetadata(row.metadata_json)
  }));
  return { entities, relations, constraints };
}

function optionalJsonMetadata(value: unknown): { metadata?: Record<string, Json> } {
  const metadata = JSON.parse(String(value)) as Record<string, Json>;
  return Object.keys(metadata).length > 0 ? { metadata } : {};
}

function architectureEventsForReplay(db: SqliteDatabase, input: ArchitectureLedgerReplayInput): ArchitectureEventV1[] {
  let untilEventId = input.untilEventId;
  if (input.snapshotId) {
    const snapshot = db.prepare(
      `SELECT last_event_id FROM architecture_snapshots
        WHERE snapshot_id = ? AND storage_repository_id = ? AND storage_workspace_id = ?`
    ).get(input.snapshotId, input.repository.storageRepositoryId, input.worktree.storageWorkspaceId);
    if (!snapshot) throw new Error(`architecture-ledger-snapshot-not-found: ${input.snapshotId}`);
    untilEventId = String(snapshot.last_event_id);
  }
  const rows = db.prepare(
    `SELECT event_id, event_json FROM architecture_events
      WHERE storage_repository_id = ? AND storage_workspace_id = ?
      ORDER BY event_sequence`
  ).all(input.repository.storageRepositoryId, input.worktree.storageWorkspaceId);
  const events: ArchitectureEventV1[] = [];
  for (const row of rows) {
    const event = JSON.parse(String(row.event_json)) as ArchitectureEventV1;
    events.push(event);
    if (untilEventId && String(row.event_id) === untilEventId) break;
  }
  return events;
}

function deleteArchitectureCurrentState(db: SqliteDatabase, scope: ArchitectureLedgerScope): void {
  for (const table of ["architecture_entities_current", "architecture_relations_current", "architecture_constraints_current"]) {
    db.prepare(`DELETE FROM ${table} WHERE storage_repository_id = ? AND storage_workspace_id = ?`)
      .run(scope.repository.storageRepositoryId, scope.worktree.storageWorkspaceId);
  }
}

function insertArchitectureLedgerFts(db: SqliteDatabase, kind: string, summary: string, rationale: string, title: string, evidenceSummary: string): void {
  db.prepare(
    "INSERT INTO architecture_ledger_fts(kind, summary, rationale, title, evidence_summary) VALUES (?, ?, ?, ?, ?)"
  ).run(kind, summary, rationale, title, evidenceSummary);
}

function recordArchitectureLedgerOperation(db: SqliteDatabase, input: {
  scope: ArchitectureLedgerScope;
  operationKind: string;
  durationMs: number;
  rowCount: number;
  rebuildReason: string | null;
}): void {
  db.prepare(
    `INSERT INTO architecture_ledger_operations
      (operation_id, storage_repository_id, storage_workspace_id, operation_kind, duration_ms, row_count, rebuild_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `ledger_operation_${randomUUID()}`,
    input.scope.repository.storageRepositoryId,
    input.scope.worktree.storageWorkspaceId,
    input.operationKind,
    Math.max(0, Math.trunc(input.durationMs)),
    input.rowCount,
    input.rebuildReason,
    nowIso()
  );
}

function stableLedgerId(prefix: string, ...parts: string[]): string {
  return `${prefix}.${createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 24)}`;
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

function applyLocalSqliteMigrations(db: SqliteDatabase): void {
  for (const pragma of SQLITE_PRAGMAS) db.exec(pragma);
  const applied = readAppliedLocalSqliteMigrations(db);
  for (const migration of LOCAL_SQLITE_MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    for (const statement of migration.statements) db.exec(statement);
    db.prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, nowIso());
    applied.add(migration.id);
  }
}

function readAppliedLocalSqliteMigrations(db: SqliteDatabase): Set<string> {
  const schemaTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!schemaTable) return new Set();
  return new Set(db.prepare("SELECT id FROM schema_migrations").all().map((row) => String(row.id)));
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
    applyLocalSqliteMigrations(db);
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

function normalizeRuntimeAgentJobPriority(priority: number | undefined): number {
  if (priority === undefined) return 0;
  if (!Number.isFinite(priority)) throw new Error("runtime-agent-job-priority-invalid");
  return Math.trunc(priority);
}

function normalizeOptionalPositiveInteger(value: number | undefined, errorCode: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1) throw new Error(errorCode);
  return value;
}

function runtimeAgentJobDefaultCoalesceKey(job: AgentJobV1, analysisKind: string): string {
  return digestJson({
    schemaVersion: "archcontext.runtime-agent-job-coalesce-key/v1",
    repositoryId: job.repository.storageRepositoryId,
    workspaceId: job.worktree.storageWorkspaceId,
    analysisKind,
    trigger: job.trigger,
    stalePolicy: job.stalePolicy
  } as unknown as Json);
}

function runtimeAgentJobBackpressureDecision(db: SqliteDatabase, job: AgentJobV1, input: {
  accepted: boolean;
  reasonCode?: "backpressure-queue-cap";
  priority: number;
  maxQueuedJobs?: number;
  evictedJobIds: string[];
}): RuntimeAgentJobBackpressureDecision {
  const queuedDepth = Number(db.prepare(
    `SELECT COUNT(*) AS count FROM runtime_job_queue
      WHERE storage_repository_id = ?
        AND storage_workspace_id = ?
        AND status = 'queued'`
  ).get(job.repository.storageRepositoryId, job.worktree.storageWorkspaceId)?.count ?? 0);
  const runningDepth = Number(db.prepare(
    `SELECT COUNT(*) AS count FROM runtime_job_queue
      WHERE storage_repository_id = ?
        AND storage_workspace_id = ?
        AND status = 'running'`
  ).get(job.repository.storageRepositoryId, job.worktree.storageWorkspaceId)?.count ?? 0);
  return {
    schemaVersion: "archcontext.runtime-agent-job-backpressure/v1",
    accepted: input.accepted,
    ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
    priority: input.priority,
    queuedDepthBefore: queuedDepth,
    queuedDepthAfter: queuedDepth,
    runningDepth,
    maxQueuedJobs: input.maxQueuedJobs,
    evictedJobIds: input.evictedJobIds
  };
}

function runtimeAgentJobQueueStatsFromRecords(records: RuntimeAgentJobRecord[], input: {
  now: string;
  storageRepositoryId: string;
  storageWorkspaceId: string;
}): RuntimeAgentJobQueueStats {
  const countsByStatus = Object.fromEntries(RUNTIME_AGENT_JOB_STATUSES.map((status) => [status, 0])) as Record<RuntimeAgentJobStatus, number>;
  for (const record of records) countsByStatus[record.job.status] += 1;
  const queued = records.filter((record) => record.job.status === "queued");
  const runningDepth = countsByStatus.running;
  const terminalDepth = RUNTIME_AGENT_JOB_STATUSES
    .filter((status) => status !== "queued" && status !== "running")
    .reduce((sum, status) => sum + countsByStatus[status], 0);
  const oldestQueuedAt = queued
    .map((record) => record.job.queuedAt)
    .sort((left, right) => left.localeCompare(right))[0];
  const oldestQueuedAgeMs = oldestQueuedAt === undefined
    ? undefined
    : Math.max(0, Date.parse(input.now) - Date.parse(oldestQueuedAt));
  const coalescedJobCount = records.filter((record) =>
    record.job.status === "superseded"
    && record.lastError === "coalesced-by-newer-job"
    && record.supersededByJobId
  ).length;
  const lastFailure = records
    .filter((record) => record.lastError && record.job.status !== "superseded")
    .sort((left, right) =>
      left.job.updatedAt.localeCompare(right.job.updatedAt)
      || left.job.jobId.localeCompare(right.job.jobId)
    ).at(-1);
  return {
    schemaVersion: "archcontext.runtime-agent-job-queue-stats/v1",
    generatedAt: input.now,
    storageRepositoryId: input.storageRepositoryId,
    storageWorkspaceId: input.storageWorkspaceId,
    countsByStatus,
    queuedDepth: countsByStatus.queued,
    runningDepth,
    activeDepth: countsByStatus.queued + runningDepth,
    terminalDepth,
    totalJobCount: records.length,
    ...(oldestQueuedAt === undefined ? {} : { oldestQueuedAt, oldestQueuedAgeMs }),
    coalescedJobCount,
    coalescingRatio: records.length === 0 ? 0 : coalescedJobCount / records.length,
    ...(lastFailure?.lastError === undefined ? {} : {
      lastFailureReason: lastFailure.lastError,
      lastFailureJobId: lastFailure.job.jobId
    })
  };
}

function insertRuntimeAgentJob(db: SqliteDatabase, input: {
  job: AgentJobV1;
  analysisKind: string;
  coalesceKey: string;
  priority: number;
  maxAttempts: number;
  debounceUntil?: string;
}): void {
  db.prepare(
    `INSERT INTO runtime_job_queue
      (job_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, analysis_kind,
        coalesce_key, priority, status, runner_port, fingerprint, input_digest, prompt_template_digest, output_digest,
        stale_policy, job_json, queued_at, updated_at, attempt_count, max_attempts, lease_owner, leased_at,
        lease_expires_at, last_error, dead_lettered_at, debounce_until, superseded_by_job_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, NULL)`
  ).run(
    input.job.jobId,
    input.job.repository.repositoryId,
    input.job.repository.storageRepositoryId,
    input.job.worktree.workspaceId,
    input.job.worktree.storageWorkspaceId,
    input.analysisKind,
    input.coalesceKey,
    input.priority,
    input.job.status,
    input.job.runnerPort,
    input.job.fingerprint,
    input.job.inputDigest,
    input.job.promptTemplateDigest,
    input.job.outputDigest ?? null,
    input.job.stalePolicy,
    stableJson(input.job),
    input.job.queuedAt,
    input.job.updatedAt,
    0,
    input.maxAttempts,
    input.debounceUntil ?? null
  );
}

function runtimeAgentJobById(db: SqliteDatabase, jobId: string): RuntimeAgentJobRecord | undefined {
  const row = db.prepare("SELECT * FROM runtime_job_queue WHERE job_id = ?").get(jobId);
  return row ? runtimeAgentJobRecordFromRow(row) : undefined;
}

function runtimeAgentJobRecordFromRow(row: Record<string, unknown>): RuntimeAgentJobRecord {
  return {
    job: JSON.parse(String(row.job_json)) as AgentJobV1,
    analysisKind: String(row.analysis_kind),
    coalesceKey: String(row.coalesce_key),
    priority: Number(row.priority ?? 0),
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    leaseOwner: nullableString(row.lease_owner),
    leasedAt: nullableString(row.leased_at),
    leaseExpiresAt: nullableString(row.lease_expires_at),
    lastError: nullableString(row.last_error),
    deadLetteredAt: nullableString(row.dead_lettered_at),
    debounceUntil: nullableString(row.debounce_until),
    supersededByJobId: nullableString(row.superseded_by_job_id)
  };
}

function runtimeAgentJobWithPatch(job: AgentJobV1, patch: {
  status: RuntimeAgentJobStatus;
  updatedAt: string;
  outputDigest?: string;
}): AgentJobV1 {
  const next: AgentJobV1 = {
    ...job,
    status: patch.status,
    updatedAt: patch.updatedAt
  };
  if (patch.outputDigest) next.outputDigest = patch.outputDigest;
  return next;
}

function nullableString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

function readChangeSetJournalMetadata(db: SqliteDatabase, journalId: string): Record<string, unknown> {
  const row = db.prepare("SELECT metadata_json FROM changeset_journal WHERE journal_id = ?").get(journalId);
  if (!row) throw new Error(`ChangeSet journal not found: ${journalId}`);
  return JSON.parse(String(row.metadata_json)) as Record<string, unknown>;
}

function withChangeSetJournalArchitectureLedger(metadata: Record<string, unknown>, patch: Record<string, Json>): Record<string, unknown> {
  const existing = metadata.architectureLedger;
  const architectureLedger = isJsonRecord(existing)
    ? { ...existing, ...patch }
    : {
      schemaVersion: "archcontext.changeset-ledger-recovery/v1",
      ...patch
    };
  return { ...metadata, architectureLedger };
}

function changeSetLedgerAppendSummary(result: ArchitectureLedgerAppendResult): Record<string, Json> {
  return {
    schemaVersion: "archcontext.changeset-ledger-append/v1",
    status: "appended",
    appendedEventIds: result.appendedEvents.map((event) => event.eventId),
    duplicateEventIds: result.duplicateEvents.map((event) => event.eventId),
    graphDigest: result.graphDigest,
    entityCount: result.entityCount,
    relationCount: result.relationCount,
    constraintCount: result.constraintCount
  };
}

function changeSetJournalPlannedLedgerEvent(metadata: Record<string, unknown>): ArchitectureEventV1 | undefined {
  const architectureLedger = metadata.architectureLedger;
  if (!isJsonRecord(architectureLedger)) return undefined;
  const plannedEvent = architectureLedger.plannedEvent;
  if (!isJsonRecord(plannedEvent)) return undefined;
  try {
    const event = plannedEvent as unknown as ArchitectureEventV1;
    validateArchitectureLedgerEvent(event);
    return event;
  } catch {
    return undefined;
  }
}

function isJsonRecord(value: unknown): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
