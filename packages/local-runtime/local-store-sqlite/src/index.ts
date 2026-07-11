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
  applyArchitectureLedgerEvidenceEvent,
  applyArchitectureLedgerGraphEvent,
  assertArchitectureLedgerPersistenceSafe,
  architectureLedgerPayload,
  architectureLedgerSnapshotFromState,
  architectureLedgerStateDigest,
  emptyArchitectureLedgerEvidenceState,
  emptyArchitectureLedgerState,
  normalizeArchitectureLedgerEvent,
  replayArchitectureLedgerEvidenceState,
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
  type ArchitectureLedgerSnapshotInput,
  type ArchitectureAuditRunV1,
  type ArchitectureBookFtsMatch,
  type ArchitectureBookFtsMatchKind
} from "@archcontext/core/architecture-ledger";
import type { ChangeSetDraft, ChangeSetJournalFile, ChangeSetJournalPort } from "@archcontext/core/changeset-engine";
import { architectureEventHash, architectureSnapshotDigest, canonicalProjectionReadPlanV1, digestJson, EXPLORER_VIEW_INPUT_REQUIREMENTS, validateJsonSchema, type AgentJobV1, type ArchitectureAffectedSubjectV1, type ArchitectureChangeFeedBatchV1, type ArchitectureChangeFeedRecordV1, type ArchitectureEventBacklinkV1, type ArchitectureEventV1, type ArchitectureSnapshotV2, type AuthorityCursorV1, type EvidenceBindingV1, type EvidenceItemV2, type EvidenceStateAtCursorV1, type ExplorerProjectionCachePolicyV1, type ExplorerProjectionQueryV2, type ExplorerProjectionV2, type ExternalDocumentationCacheEntry, type ExternalDocumentationProvider, type Json, type LocalStorePort, type ProjectionReadPlanV1, type ProjectionReadSetV1, type RepositorySnapshot } from "@archcontext/contracts";
import explorerProjectionV2Schema from "../../../../schemas/runtime/explorer-projection-v2.schema.json";

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
  "evidence_tombstones",
  "architecture_event_subjects",
  "architecture_change_feed",
  "architecture_change_feed_consumers",
  "architecture_change_feed_backfill_state",
  "recommendation_runs",
  "recommendations",
  "recommendation_feedback",
  "agent_jobs",
  "runtime_job_queue",
  "projection_state",
  "source_cursors",
  "waivers",
  "architecture_ledger_operations",
  "architecture_ledger_fts",
  "architecture_ledger_search_fts",
  "audit_runs",
  "explorer_projection_cache",
  "explorer_occurrence_dependencies",
  "explorer_runtime_metrics"
] as const;

export const SQLITE_PRAGMAS = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA synchronous = FULL",
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
  },
  {
    id: "0009_architecture_ledger_search_fts",
    statements: [
      `CREATE VIRTUAL TABLE IF NOT EXISTS architecture_ledger_search_fts USING fts5(
        doc_id UNINDEXED,
        storage_repository_id UNINDEXED,
        storage_workspace_id UNINDEXED,
        target_kind UNINDEXED,
        target_id UNINDEXED,
        subject_id UNINDEXED,
        title,
        summary,
        rationale,
        evidence_summary
      )`
    ]
  },
  {
    id: "0010_audit_runs",
    statements: [
      `CREATE TABLE IF NOT EXISTS audit_runs (
        run_id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        storage_repository_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        report_id TEXT NOT NULL,
        status TEXT NOT NULL,
        repo_name_with_owner TEXT NOT NULL,
        repo_visibility TEXT NOT NULL,
        base_sha TEXT NOT NULL,
        input_digest TEXT NOT NULL,
        output_digest TEXT NOT NULL,
        run_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(event_id) REFERENCES architecture_events(event_id) ON DELETE RESTRICT
      )`,
      "CREATE INDEX IF NOT EXISTS idx_audit_runs_status ON audit_runs(storage_repository_id, storage_workspace_id, status)"
    ]
  },
  {
    id: "0011_changeset_cleanup_cursor",
    statements: [
      "ALTER TABLE changeset_journal ADD COLUMN cleanup_completed_at TEXT",
      "CREATE INDEX IF NOT EXISTS idx_changeset_journal_cleanup_pending ON changeset_journal(status, cleanup_completed_at, updated_at)"
    ]
  },
  {
    id: "0012_explorer_projection_index",
    statements: [
      `CREATE TABLE IF NOT EXISTS explorer_projection_cache (
        projection_digest TEXT PRIMARY KEY,
        storage_repository_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        view_id TEXT NOT NULL,
        graph_digest TEXT NOT NULL,
        observed_facts_digest TEXT NOT NULL,
        view_definition_digest TEXT NOT NULL,
        compiler_version TEXT NOT NULL,
        projection_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS idx_explorer_projection_scope ON explorer_projection_cache(storage_repository_id, storage_workspace_id, view_id, created_at)",
      `CREATE TABLE IF NOT EXISTS explorer_occurrence_dependencies (
        storage_repository_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        projection_digest TEXT NOT NULL,
        occurrence_id TEXT NOT NULL,
        dependency_key TEXT NOT NULL,
        PRIMARY KEY(storage_repository_id, storage_workspace_id, projection_digest, occurrence_id, dependency_key),
        FOREIGN KEY(projection_digest) REFERENCES explorer_projection_cache(projection_digest) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS idx_explorer_dependency_key ON explorer_occurrence_dependencies(storage_repository_id, storage_workspace_id, dependency_key)"
    ]
  },
  {
    id: "0013_evidence_lifecycle",
    statements: [
      `CREATE TABLE IF NOT EXISTS evidence_tombstones (
        storage_repository_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        previous_digest TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        removed_by_event_id TEXT NOT NULL,
        removed_at TEXT NOT NULL,
        PRIMARY KEY(storage_repository_id, storage_workspace_id, target_kind, target_id),
        FOREIGN KEY(removed_by_event_id) REFERENCES architecture_events(event_id) ON DELETE RESTRICT
      )`,
      "CREATE INDEX IF NOT EXISTS idx_evidence_tombstones_scope ON evidence_tombstones(storage_repository_id, storage_workspace_id, target_kind, target_id)",
      "DELETE FROM explorer_occurrence_dependencies",
      "DELETE FROM explorer_projection_cache"
    ]
  },
  {
    id: "0014_architecture_change_feed",
    statements: [
      "ALTER TABLE explorer_projection_cache ADD COLUMN invalidated_at TEXT",
      "CREATE INDEX IF NOT EXISTS idx_explorer_projection_valid_scope ON explorer_projection_cache(storage_repository_id, storage_workspace_id, view_id, invalidated_at, created_at)",
      `CREATE TABLE IF NOT EXISTS architecture_event_subjects (
        storage_repository_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        event_sequence INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        logical_event_id TEXT NOT NULL,
        authority_class TEXT NOT NULL CHECK(authority_class IN ('architecture-fact', 'evidence')),
        subject_kind TEXT NOT NULL CHECK(subject_kind IN ('entity', 'relation', 'constraint', 'evidence-item', 'evidence-binding', 'subject')),
        subject_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK(operation IN ('create', 'update', 'remove', 'upsert', 'delete', 'reference')),
        created_at TEXT NOT NULL,
        PRIMARY KEY(storage_repository_id, storage_workspace_id, event_sequence, authority_class, subject_kind, subject_id, operation),
        FOREIGN KEY(event_id) REFERENCES architecture_events(event_id) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS idx_architecture_event_subjects_event ON architecture_event_subjects(storage_repository_id, storage_workspace_id, event_sequence, event_id)",
      "CREATE INDEX IF NOT EXISTS idx_architecture_event_subjects_subject ON architecture_event_subjects(storage_repository_id, storage_workspace_id, subject_kind, subject_id, event_sequence DESC)",
      `CREATE TABLE IF NOT EXISTS architecture_change_feed (
        feed_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        storage_repository_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        event_sequence INTEGER NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        logical_event_id TEXT NOT NULL,
        event_hash TEXT NOT NULL,
        title TEXT,
        rationale TEXT,
        subjects_digest TEXT NOT NULL,
        graph_before_digest TEXT NOT NULL,
        graph_after_digest TEXT NOT NULL,
        evidence_before_digest TEXT NOT NULL,
        evidence_after_digest TEXT NOT NULL,
        committed_at TEXT NOT NULL,
        FOREIGN KEY(event_id) REFERENCES architecture_events(event_id) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS idx_architecture_change_feed_scope ON architecture_change_feed(storage_repository_id, storage_workspace_id, feed_sequence)",
      `CREATE TABLE IF NOT EXISTS architecture_change_feed_consumers (
        consumer_id TEXT NOT NULL,
        storage_repository_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        feed_sequence INTEGER NOT NULL CHECK(feed_sequence >= 0),
        delivered_sequence INTEGER NOT NULL CHECK(delivered_sequence >= feed_sequence),
        updated_at TEXT NOT NULL,
        PRIMARY KEY(consumer_id, storage_repository_id, storage_workspace_id)
      )`,
      `CREATE TABLE IF NOT EXISTS architecture_change_feed_backfill_state (
        state_id TEXT PRIMARY KEY CHECK(state_id = 'v1'),
        event_count INTEGER NOT NULL CHECK(event_count >= 0),
        last_event_sequence INTEGER NOT NULL CHECK(last_event_sequence >= 0),
        last_event_hash TEXT,
        completed_at TEXT NOT NULL
      )`
    ]
  },
  {
    id: "0015_snapshot_anchor_v2",
    statements: [
      "ALTER TABLE architecture_snapshots ADD COLUMN snapshot_schema_version TEXT",
      "ALTER TABLE architecture_snapshots ADD COLUMN last_event_sequence INTEGER",
      "ALTER TABLE architecture_snapshots ADD COLUMN evidence_digest TEXT",
      "ALTER TABLE architecture_snapshots ADD COLUMN state_digest TEXT",
      "ALTER TABLE architecture_events ADD COLUMN source_storage_workspace_id TEXT",
      "ALTER TABLE architecture_events ADD COLUMN scope_event_count INTEGER",
      "DELETE FROM architecture_snapshots",
      "CREATE INDEX IF NOT EXISTS idx_architecture_snapshots_scope_sequence ON architecture_snapshots(storage_repository_id, storage_workspace_id, last_event_sequence DESC)",
      "CREATE INDEX IF NOT EXISTS idx_architecture_change_feed_scope_logical_event ON architecture_change_feed(storage_repository_id, storage_workspace_id, logical_event_id)",
      "CREATE INDEX IF NOT EXISTS idx_architecture_events_direct_scope ON architecture_events(storage_repository_id, source_storage_workspace_id, workspace_id, branch, event_sequence DESC)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_architecture_events_scope_count ON architecture_events(storage_repository_id, storage_workspace_id, scope_event_count)",
      `CREATE TRIGGER IF NOT EXISTS architecture_events_immutable_delete
        BEFORE DELETE ON architecture_events
        BEGIN
          SELECT RAISE(ABORT, 'architecture-events-immutable');
        END`,
      `CREATE TRIGGER IF NOT EXISTS architecture_events_immutable_update
        BEFORE UPDATE OF event_sequence, event_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id,
          branch, head_sha, worktree_digest, event_type, payload_version, source, actor_kind, actor_id,
          base_digest, resulting_digest, previous_event_hash, event_hash, idempotency_key, payload_json,
          provenance_json, event_json, created_at ON architecture_events
        BEGIN
          SELECT RAISE(ABORT, 'architecture-events-immutable');
        END`,
      `CREATE TRIGGER IF NOT EXISTS architecture_events_scope_backfill_only
        BEFORE UPDATE OF source_storage_workspace_id, scope_event_count ON architecture_events
        WHEN NOT (
          OLD.source_storage_workspace_id IS NULL
          AND OLD.scope_event_count IS NULL
          AND NEW.source_storage_workspace_id IS NOT NULL
          AND NEW.scope_event_count IS NOT NULL
        )
        BEGIN
          SELECT RAISE(ABORT, 'architecture-events-immutable');
        END`
    ]
  },
  {
    id: "0016_manifest_addressed_projection_cache",
    statements: [
      "ALTER TABLE explorer_projection_cache ADD COLUMN manifest_digest TEXT",
      "DELETE FROM explorer_occurrence_dependencies",
      "DELETE FROM explorer_projection_cache",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_explorer_projection_scope_manifest ON explorer_projection_cache(storage_repository_id, storage_workspace_id, manifest_digest)"
    ]
  },
  {
    id: "0017_explorer_cache_lifecycle",
    statements: [
      "ALTER TABLE explorer_projection_cache ADD COLUMN body_bytes INTEGER NOT NULL DEFAULT 0 CHECK(body_bytes >= 0)",
      "ALTER TABLE explorer_projection_cache ADD COLUMN last_accessed_at TEXT",
      "ALTER TABLE explorer_projection_cache ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0 CHECK(access_count >= 0)",
      "ALTER TABLE explorer_projection_cache ADD COLUMN pinned_until TEXT",
      "ALTER TABLE explorer_projection_cache ADD COLUMN pin_reason TEXT CHECK(pin_reason IN ('delta-base', 'delta-head'))",
      "UPDATE explorer_projection_cache SET body_bytes = length(CAST(projection_json AS BLOB)), last_accessed_at = created_at",
      "CREATE INDEX IF NOT EXISTS idx_explorer_projection_gc ON explorer_projection_cache(storage_repository_id, storage_workspace_id, pinned_until, invalidated_at, last_accessed_at, created_at, projection_digest)",
      `CREATE TABLE IF NOT EXISTS explorer_runtime_metrics (
        storage_repository_id TEXT NOT NULL,
        storage_workspace_id TEXT NOT NULL,
        metric_name TEXT NOT NULL CHECK(metric_name IN ('feed-lag', 'replay-tail-length', 'plan-rows-read', 'compile-time-ms', 'cache-hit', 'cache-miss', 'cache-eviction', 'cache-rebuild')),
        reason_code TEXT NOT NULL CHECK(reason_code IN ('none', 'digest-read', 'manifest-read', 'latest-read', 'manifest-miss', 'invalidated', 'expired', 'count-pressure', 'byte-pressure', 'startup-retention', 'explicit-collection', 'projection-compile', 'change-feed', 'anchored-replay', 'bounded-read-plan')),
        sample_count INTEGER NOT NULL CHECK(sample_count >= 0 AND sample_count <= 9007199254740991),
        total_value REAL NOT NULL CHECK(total_value >= 0 AND total_value <= 9007199254740991),
        max_value REAL NOT NULL CHECK(max_value >= 0 AND max_value <= 9007199254740991),
        last_value REAL NOT NULL CHECK(last_value >= 0 AND last_value <= 9007199254740991),
        updated_at TEXT NOT NULL,
        PRIMARY KEY(storage_repository_id, storage_workspace_id, metric_name, reason_code)
      )`
    ]
  }
] as const;

const CHANGESET_STARTUP_CLEANUP_LIMIT = 100;

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
  | "target-upgraded"
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
        return upgradeExistingLocalStoreTarget(paths, integrityCheck);
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

function upgradeExistingLocalStoreTarget(
  paths: RuntimeStatePaths,
  integrityCheck: LegacyLocalStoreMigration["integrityCheck"]
): LegacyLocalStoreMigration {
  const lock = acquireLegacyMigrationLock(paths);
  try {
    assertUpgradeableLocalStoreTarget(paths.localStorePath);
    integrityCheck.target = assertSqliteIntegrity(paths.localStorePath);
    migrateSqliteDatabaseSync(paths.localStorePath);
    compactSqliteDatabase(paths.localStorePath);
    integrityCheck.target = assertCurrentLocalStore(paths.localStorePath);
    delete integrityCheck.error;
    const markerPath = writeLegacyMigrationMarker(paths, integrityCheck, []);
    return legacyMigrationResult(true, undefined, paths, [paths.localStorePath], {
      status: "target-upgraded",
      integrityCheck,
      markerPath,
      quarantinedFiles: []
    });
  } catch (error) {
    throw new Error(`ArchContext runtime state target is not a valid SQLite database and no legacy store is available: ${paths.localStorePath}; target upgrade failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
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
  /**
   * When set, claim only this exact job (still subject to the usual queued/expired-lease
   * eligibility and attempt-count checks) instead of the highest-priority/oldest eligible job in
   * the repository/workspace scope. Callers that synchronously enqueue-then-claim a job they just
   * created (e.g. `ArchctxDaemon.auditRun`) must pass this so a concurrently queued, unrelated job
   * in the same scope can never be claimed and lease-stolen in their place.
   */
  jobId?: string;
}

export interface RuntimeAgentJobCompleteInput {
  jobId: string;
  status: Extract<RuntimeAgentJobStatus, "succeeded" | "failed">;
  now: string;
  workerId?: string;
  outputDigest?: string;
  runMetadata?: Json;
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
  appendArchitectureEventsAndCommitChangeSet(
    journalId: string,
    input: ArchitectureLedgerAppendInput
  ): Promise<ArchitectureLedgerAppendResult>;
  resolveArchitectureLedgerScope(input: ArchitectureLedgerScope): Promise<ArchitectureLedgerScope>;
  resolveLatestArchitectureLedgerScope(input: ArchitectureLedgerScope): Promise<ArchitectureLedgerScope>;
  listAuditRuns(input: ArchitectureLedgerScope & { statuses?: ArchitectureAuditRunV1["status"][] }): Promise<ArchitectureAuditRunV1[]>;
  getAuditRun(input: ArchitectureLedgerScope & { runId: string }): Promise<ArchitectureAuditRunV1 | undefined>;
  readArchitectureLedgerSourceCursor(input: ArchitectureLedgerScope & { cursorId: string }): Promise<Record<string, Json> | undefined>;
  createArchitectureLedgerSnapshot(input: ArchitectureLedgerSnapshotInput): Promise<ArchitectureSnapshotV2>;
  readArchitectureLedgerState(input: ArchitectureLedgerScope): Promise<ArchitectureLedgerGraphState>;
  readArchitectureLedgerNeighborhood(input: ArchitectureLedgerScope & { id: string; depth: number }): Promise<ArchitectureLedgerGraphState>;
  readExplorerProjectionAuthority(input: ArchitectureLedgerScope): Promise<ExplorerProjectionAuthorityResult | undefined>;
  readExplorerProjectionInputs(input: ArchitectureLedgerScope & { query: ExplorerProjectionQueryV2; plan: ProjectionReadPlanV1; authorityCursor: AuthorityCursorV1 }): Promise<ExplorerProjectionReadResult>;
  readExplorerProjectionMetadata(input: ArchitectureLedgerScope & { query: ExplorerProjectionQueryV2; plan: ProjectionReadPlanV1; authorityCursor: AuthorityCursorV1; entityIds: string[]; subjectIds: string[] }): Promise<ExplorerProjectionMetadataResult>;
  queryArchitectureLedgerFts(input: ArchitectureLedgerScope & { query: string; maxItems?: number }): Promise<ArchitectureBookFtsMatch[]>;
  replayArchitectureLedger(input: ArchitectureLedgerReplayInput): Promise<ArchitectureLedgerReplayResult>;
  replayArchitectureLedgerEvidence(input: ArchitectureLedgerReplayInput): Promise<EvidenceStateAtCursorV1>;
  listArchitectureChangeFeed(input: ArchitectureLedgerScope & { consumerId: string; limit?: number }): Promise<ArchitectureChangeFeedBatchV1>;
  acknowledgeArchitectureChangeFeed(input: ArchitectureLedgerScope & { consumerId: string; feedSequence: number }): Promise<number>;
  listArchitectureEventBacklinks(input: ArchitectureLedgerScope): Promise<ArchitectureEventBacklinkV1[]>;
  verifyArchitectureLedgerReplay(input: ArchitectureLedgerReplayInput): Promise<ArchitectureLedgerReplayVerification>;
  rebuildArchitectureLedgerCurrentState(input: ArchitectureLedgerScope): Promise<ArchitectureLedgerReplayResult>;
  compactArchitectureLedger(input: ArchitectureLedgerScope & { beforeSnapshotId: string }): Promise<{ snapshotId: string; compactedEventCount: number }>;
  checkArchitectureLedgerIntegrity(input: ArchitectureLedgerScope): Promise<ArchitectureLedgerIntegrityResult>;
  backupArchitectureLedger(input: { backupPath: string }): Promise<{ backupPath: string; integrity: string }>;
  saveExplorerProjection(input: ArchitectureLedgerScope & { projection: ExplorerProjectionV2; dependencies: Array<{ occurrenceId: string; dependencyKeys: string[] }> }): Promise<void>;
  readExplorerProjection(input: ArchitectureLedgerScope & { projectionDigest: string }): Promise<ExplorerProjectionV2 | undefined>;
  readExplorerProjectionByManifest(input: ArchitectureLedgerScope & { manifestDigest: string }): Promise<ExplorerProjectionV2 | undefined>;
  readLatestExplorerProjection(input: ArchitectureLedgerScope & { viewId: string }): Promise<ExplorerProjectionV2 | undefined>;
  pinExplorerProjections(input: ArchitectureLedgerScope & { projectionDigests: string[]; reason: ExplorerProjectionPinReason; expiresAt: string }): Promise<number>;
  collectExplorerProjectionCache(input: ArchitectureLedgerScope & { policy?: ExplorerProjectionCachePolicyV1 }): Promise<ExplorerProjectionCacheCollectionResultV1>;
  readExplorerProjectionCacheStats(input: ArchitectureLedgerScope): Promise<ExplorerProjectionCacheStatsV1>;
  recordExplorerRuntimeMetric(input: ArchitectureLedgerScope & ExplorerRuntimeMetricSampleV1): Promise<void>;
  listAffectedExplorerOccurrences(input: ArchitectureLedgerScope & { dependencyKeys: string[] }): Promise<string[]>;
  invalidateExplorerOccurrences(input: ArchitectureLedgerScope & { occurrenceIds: string[] }): Promise<number>;
  clearExplorerDerivedState(input?: ArchitectureLedgerScope): Promise<number>;
  clearDerivedLandscapeState(): void;
  rebuildDerivedLandscapeState(input: LandscapeRebuildInput): Promise<LandscapeRebuildResult>;
  close(): void;
}

export type ExplorerProjectionPinReason = "delta-base" | "delta-head";

export type ExplorerRuntimeMetricName =
  | "feed-lag"
  | "replay-tail-length"
  | "plan-rows-read"
  | "compile-time-ms"
  | "cache-hit"
  | "cache-miss"
  | "cache-eviction"
  | "cache-rebuild";

export type ExplorerRuntimeMetricReason =
  | "none"
  | "digest-read"
  | "manifest-read"
  | "latest-read"
  | "manifest-miss"
  | "invalidated"
  | "expired"
  | "count-pressure"
  | "byte-pressure"
  | "startup-retention"
  | "explicit-collection"
  | "projection-compile"
  | "change-feed"
  | "anchored-replay"
  | "bounded-read-plan";

export interface ExplorerRuntimeMetricSampleV1 {
  metricName: ExplorerRuntimeMetricName;
  reasonCode: ExplorerRuntimeMetricReason;
  value: number;
  recordedAt?: string;
}

export const DEFAULT_EXPLORER_PROJECTION_CACHE_POLICY: ExplorerProjectionCachePolicyV1 = Object.freeze({
  schemaVersion: "archcontext.explorer-cache-policy/v1",
  maxEntriesPerScope: 128,
  maxBytesPerScope: 64 * 1024 * 1024,
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  maxPinnedEntriesPerScope: 8,
  maxPinTtlMs: 15 * 60 * 1000
});

export interface ExplorerProjectionCacheStatsV1 {
  schemaVersion: "archcontext.explorer-cache-stats/v1";
  storageRepositoryId: string;
  storageWorkspaceId: string;
  entryCount: number;
  bodyBytes: number;
  pinnedEntryCount: number;
  invalidatedEntryCount: number;
  metrics: Array<ExplorerRuntimeMetricSampleV1 & { sampleCount: number; totalValue: number; maxValue: number; recordedAt: string }>;
}

export interface ExplorerProjectionCacheCollectionResultV1 {
  schemaVersion: "archcontext.explorer-cache-collection/v1";
  reasonCode: "startup-retention" | "explicit-collection";
  before: Pick<ExplorerProjectionCacheStatsV1, "entryCount" | "bodyBytes" | "pinnedEntryCount" | "invalidatedEntryCount">;
  after: Pick<ExplorerProjectionCacheStatsV1, "entryCount" | "bodyBytes" | "pinnedEntryCount" | "invalidatedEntryCount">;
  evictedProjectionDigests: string[];
  orphanDependencyCount: number;
  limitsSatisfied: boolean;
}

export interface ExplorerProjectionReadResult {
  graph: ArchitectureLedgerGraphState;
  bindings: Array<{ bindingId: string; targetEntityId: string; observedSymbolId: string; verified: boolean }>;
  eventBacklinks: ArchitectureEventBacklinkV1[];
  readSet: ProjectionReadSetV1;
}

export interface ExplorerProjectionAuthorityResult {
  authorityCursor: AuthorityCursorV1;
  evidenceStateDigest: string;
}

export interface ExplorerProjectionMetadataResult {
  bindings: ExplorerProjectionReadResult["bindings"];
  eventBacklinks: ArchitectureEventBacklinkV1[];
  rowsRead: { bindings: number; backlinks: number };
  truncated: boolean;
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
  private readonly explorerCachePolicy: ExplorerProjectionCachePolicyV1;

  constructor(
    private readonly databasePath = defaultLocalStorePath(),
    explorerCachePolicy: ExplorerProjectionCachePolicyV1 = DEFAULT_EXPLORER_PROJECTION_CACHE_POLICY,
    private readonly clock: () => string = nowIso
  ) {
    assertExplorerProjectionCachePolicy(explorerCachePolicy);
    this.explorerCachePolicy = Object.freeze({ ...explorerCachePolicy });
  }

  async migrate(): Promise<void> {
    const db = await this.database();
    applyLocalSqliteMigrations(db);
    backfillArchitectureEventDirectScope(db);
    backfillArchitectureChangeFeed(db);
    collectExplorerProjectionCacheFromDb(db, undefined, this.explorerCachePolicy, canonicalLifecycleTime(this.clock()), "startup-retention");
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
            ${input.jobId === undefined ? "" : "AND job_id = ?"}
            AND (
              (status = 'queued' AND (debounce_until IS NULL OR debounce_until <= ?))
              OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
            )
          ORDER BY priority DESC, queued_at ASC, job_id ASC
          LIMIT 1`
      ).get(
        input.repository.storageRepositoryId,
        input.worktree.storageWorkspaceId,
        ...(input.jobId === undefined ? [] : [input.jobId]),
        input.now,
        input.now
      );
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
    if (record.job.status !== "running") throw new Error(`runtime-agent-job-complete-requires-running: ${input.jobId}`);
    if (input.workerId && record.leaseOwner && record.leaseOwner !== input.workerId) {
      throw new Error(`runtime-agent-job-lease-owner-mismatch: ${input.jobId}`);
    }
    const deadLetteredAt = input.status === "failed" && record.attemptCount >= record.maxAttempts ? input.now : undefined;
    const job = runtimeAgentJobWithPatch(record.job, {
      status: input.status,
      updatedAt: input.now,
      outputDigest: input.outputDigest,
      runMetadata: input.runMetadata
    });
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

  async completeChangeSetCleanup(journalId: string): Promise<void> {
    const db = await this.database();
    const completedAt = nowIso();
    db.prepare("UPDATE changeset_journal SET cleanup_completed_at = ?, updated_at = ? WHERE journal_id = ? AND status = ?")
      .run(completedAt, completedAt, journalId, "committed");
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
    const committed = db.prepare(
      `SELECT journal_id, files_json FROM changeset_journal
        WHERE status = ? AND cleanup_completed_at IS NULL
        ORDER BY updated_at, journal_id
        LIMIT ?`
    ).all("committed", CHANGESET_STARTUP_CLEANUP_LIMIT);
    for (const row of committed) {
      try {
        cleanupCommittedJournalFiles(JSON.parse(String(row.files_json)) as ChangeSetJournalFile[]);
        const completedAt = nowIso();
        db.prepare("UPDATE changeset_journal SET cleanup_completed_at = ?, updated_at = ? WHERE journal_id = ?")
          .run(completedAt, completedAt, String(row.journal_id));
      } catch {
        // Leave cleanup_completed_at NULL so a later startup can retry this journal.
      }
    }
    const rows = db.prepare("SELECT journal_id, root, files_json, metadata_json FROM changeset_journal WHERE status = ?").all("pending");
    let recovered = 0;
    for (const row of rows) {
      let metadata: Record<string, unknown> = {};
      try {
        const files = JSON.parse(String(row.files_json)) as ChangeSetJournalFile[];
        metadata = JSON.parse(String(row.metadata_json)) as Record<string, unknown>;
        const plannedLedgerEvent = changeSetJournalPlannedLedgerEvent(metadata);
        const existingLedgerEvent = plannedLedgerEvent ? architectureEventByIdempotency(db, plannedLedgerEvent) : undefined;
        if (plannedLedgerEvent && existingLedgerEvent) {
          const expectedEventHash = normalizeArchitectureLedgerEvent(plannedLedgerEvent, existingLedgerEvent.previousEventHash).eventHash;
          if (expectedEventHash !== existingLedgerEvent.event.eventHash) {
            throw new Error(`changeset-ledger-recovery-idempotency-conflict: ${plannedLedgerEvent.idempotencyKey}`);
          }
          cleanupCommittedJournalFiles(files);
          const completedAt = nowIso();
          db.prepare("UPDATE changeset_journal SET status = ?, metadata_json = ?, updated_at = ?, completed_at = ?, cleanup_completed_at = ? WHERE journal_id = ?")
            .run("committed", stableJson(withChangeSetJournalArchitectureLedger(metadata, {
              recovery: {
                schemaVersion: "archcontext.changeset-ledger-recovery/v1",
                status: "ledger-append-detected",
                eventId: existingLedgerEvent.event.eventId,
                eventHash: existingLedgerEvent.event.eventHash ?? "",
                recoveredAt: completedAt
              } as unknown as Json
            })), completedAt, completedAt, completedAt, String(row.journal_id));
          recovered += 1;
          continue;
        }
        recoverJournalFiles(String(row.root), files);
        const completedAt = nowIso();
        db.prepare("UPDATE changeset_journal SET status = ?, updated_at = ?, completed_at = ?, cleanup_completed_at = ? WHERE journal_id = ?")
          .run("recovered", completedAt, completedAt, completedAt, String(row.journal_id));
        recovered += 1;
      } catch (error) {
        db.prepare("UPDATE changeset_journal SET metadata_json = ?, updated_at = ? WHERE journal_id = ?")
          .run(stableJson({
            ...metadata,
            recoveryError: {
              schemaVersion: "archcontext.changeset-recovery-error/v1",
              message: error instanceof Error ? error.message : String(error),
              failedAt: nowIso()
            }
          }), nowIso(), String(row.journal_id));
      }
    }
    return recovered;
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
    for (const event of input.events) {
      validateArchitectureLedgerEvent(event);
      assertNoNewLegacyEvidencePayload(event);
    }
    const db = await this.database();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = appendArchitectureEventsInOpenTransaction(db, input);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async appendArchitectureEventsAndCommitChangeSet(
    journalId: string,
    input: ArchitectureLedgerAppendInput
  ): Promise<ArchitectureLedgerAppendResult> {
    if (input.writer !== "runtime-daemon") throw new Error("architecture-ledger-writer-must-be-runtime-daemon");
    for (const event of input.events) {
      validateArchitectureLedgerEvent(event);
      assertNoNewLegacyEvidencePayload(event);
    }
    const db = await this.database();
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT status, metadata_json FROM changeset_journal WHERE journal_id = ?").get(journalId);
      if (!row) throw new Error(`ChangeSet journal not found: ${journalId}`);
      if (String(row.status) !== "pending") throw new Error(`ChangeSet journal is not pending: ${journalId}`);
      const metadata = JSON.parse(String(row.metadata_json)) as Record<string, unknown>;
      const result = appendArchitectureEventsInOpenTransaction(db, input);
      const completedAt = nowIso();
      db.prepare(
        "UPDATE changeset_journal SET status = ?, metadata_json = ?, updated_at = ?, completed_at = ? WHERE journal_id = ?"
      ).run(
        "committed",
        stableJson(withChangeSetJournalArchitectureLedger(metadata, {
          append: changeSetLedgerAppendSummary(result) as unknown as Json,
          appendedAt: completedAt
        })),
        completedAt,
        completedAt,
        journalId
      );
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async listAuditRuns(input: ArchitectureLedgerScope & { statuses?: ArchitectureAuditRunV1["status"][] }): Promise<ArchitectureAuditRunV1[]> {
    const db = await this.database();
    const statuses = input.statuses ?? [];
    const statusClause = statuses.length > 0 ? `AND status IN (${statuses.map(() => "?").join(", ")})` : "";
    return db.prepare(
      `SELECT run_json FROM audit_runs
        WHERE storage_repository_id = ?
          AND storage_workspace_id = ?
          ${statusClause}
        ORDER BY created_at DESC, run_id ASC`
    ).all(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), ...statuses)
      .map((row) => JSON.parse(String(row.run_json)) as ArchitectureAuditRunV1);
  }

  async resolveArchitectureLedgerScope(input: ArchitectureLedgerScope): Promise<ArchitectureLedgerScope> {
    const db = await this.database();
    const row = db.prepare(
      `SELECT *
        FROM architecture_events
        WHERE storage_repository_id = ? AND source_storage_workspace_id = ? AND workspace_id = ? AND branch = ?
        ORDER BY event_sequence DESC LIMIT 1`
    ).get(input.repository.storageRepositoryId, input.worktree.storageWorkspaceId, input.worktree.workspaceId, input.worktree.branch);
    if (!row) return input;
    const event = architectureLedgerEventFromStoredRow(row);
    if (
      event.repository.storageRepositoryId !== input.repository.storageRepositoryId
      || event.worktree.storageWorkspaceId !== input.worktree.storageWorkspaceId
      || event.worktree.workspaceId !== input.worktree.workspaceId
      || event.worktree.branch !== input.worktree.branch
    ) {
      throw new Error("architecture-ledger-direct-scope-authority-mismatch");
    }
    return { repository: event.repository, worktree: event.worktree };
  }

  async resolveLatestArchitectureLedgerScope(input: ArchitectureLedgerScope): Promise<ArchitectureLedgerScope> {
    const db = await this.database();
    const row = db.prepare(
      `SELECT *
        FROM architecture_events
        WHERE storage_repository_id = ? AND source_storage_workspace_id = ? AND workspace_id = ?
        ORDER BY event_sequence DESC LIMIT 1`
    ).get(input.repository.storageRepositoryId, input.worktree.storageWorkspaceId, input.worktree.workspaceId);
    if (!row) return input;
    const event = architectureLedgerEventFromStoredRow(row);
    if (
      event.repository.storageRepositoryId !== input.repository.storageRepositoryId
      || event.worktree.storageWorkspaceId !== input.worktree.storageWorkspaceId
      || event.worktree.workspaceId !== input.worktree.workspaceId
    ) {
      throw new Error("architecture-ledger-direct-scope-authority-mismatch");
    }
    return { repository: event.repository, worktree: event.worktree };
  }

  async getAuditRun(input: ArchitectureLedgerScope & { runId: string }): Promise<ArchitectureAuditRunV1 | undefined> {
    const db = await this.database();
    const row = db.prepare(
      `SELECT run_json FROM audit_runs
        WHERE storage_repository_id = ? AND storage_workspace_id = ? AND run_id = ?`
    ).get(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), architectureLedgerStorageId(input.worktree, input.runId));
    return row ? (JSON.parse(String(row.run_json)) as ArchitectureAuditRunV1) : undefined;
  }

  async readArchitectureLedgerSourceCursor(input: ArchitectureLedgerScope & { cursorId: string }): Promise<Record<string, Json> | undefined> {
    const db = await this.database();
    const row = db.prepare(
      `SELECT cursor_json FROM source_cursors
        WHERE storage_repository_id = ? AND storage_workspace_id = ? AND cursor_id = ?`
    ).get(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), architectureLedgerStorageId(input.worktree, input.cursorId));
    return row ? JSON.parse(String(row.cursor_json)) as Record<string, Json> : undefined;
  }

  async createArchitectureLedgerSnapshot(input: ArchitectureLedgerSnapshotInput): Promise<ArchitectureSnapshotV2> {
    const db = await this.database();
    const startedAt = Date.now();
    db.exec("BEGIN IMMEDIATE");
    try {
      const replay = replayArchitectureLedgerFromDb(db, { ...input, mode: "genesis" });
      if (replay.cursor.eventCount === 0 || !replay.cursor.lastEventId || !replay.cursor.lastEventHash) {
        throw new Error("architecture-ledger-snapshot-requires-event");
      }
      const materializedState = readArchitectureLedgerStateFromDb(db, input);
      const materializedEvidenceState = readArchitectureLedgerEvidenceStateFromDb(db, input);
      if (
        stableJson(materializedState) !== stableJson(replay.state)
        || stableJson(materializedEvidenceState) !== stableJson(replay.evidenceState)
      ) {
        throw new Error("architecture-ledger-snapshot-materialized-state-mismatch");
      }
      assertArchitectureLedgerPersistenceSafe(replay.state as unknown as Json, "architecture-snapshot.state.graph");
      assertArchitectureLedgerPersistenceSafe(replay.evidenceState as unknown as Json, "architecture-snapshot.state.evidence");
      const snapshot = architectureLedgerSnapshotFromState({
        ...input,
        eventCount: replay.cursor.eventCount,
        lastEventSequence: replay.cursor.lastEventSequence,
        lastEventId: replay.cursor.lastEventId,
        lastEventHash: replay.cursor.lastEventHash,
        state: replay.state,
        evidenceState: replay.evidenceState
      });
      db.prepare(
        `INSERT INTO architecture_snapshots
          (snapshot_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, branch, head_sha, worktree_digest,
            source_mode, last_event_id, last_event_hash, graph_digest, projection_digest, entity_count, relation_count,
            constraint_count, input_digests_json, snapshot_json, created_at, snapshot_schema_version,
            last_event_sequence, evidence_digest, state_digest)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        snapshot.snapshotId,
        snapshot.repository.repositoryId,
        snapshot.repository.storageRepositoryId,
        snapshot.worktree.workspaceId,
        architectureLedgerWorkspaceKey(snapshot.worktree),
        snapshot.worktree.branch,
        snapshot.worktree.headSha,
        snapshot.worktree.worktreeDigest,
        snapshot.sourceMode,
        architectureLedgerStorageId(snapshot.worktree, snapshot.eventCursor.lastEventId),
        snapshot.eventCursor.lastEventHash,
        snapshot.graphDigest,
        snapshot.projectionDigest,
        snapshot.entityCount,
        snapshot.relationCount,
        snapshot.constraintCount,
        stableJson(snapshot.inputDigests),
        stableJson(snapshot),
        snapshot.createdAt,
        snapshot.schemaVersion,
        snapshot.eventCursor.lastEventSequence,
        snapshot.evidenceDigest,
        snapshot.stateDigest
      );
      recordArchitectureLedgerOperation(db, {
        scope: input,
        operationKind: "create_snapshot",
        durationMs: Date.now() - startedAt,
        rowCount: 1,
        rebuildReason: null
      });
      db.exec("COMMIT");
      return snapshot;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async readArchitectureLedgerState(input: ArchitectureLedgerScope): Promise<ArchitectureLedgerGraphState> {
    const db = await this.database();
    return readArchitectureLedgerStateFromDb(db, input);
  }

  async readArchitectureLedgerNeighborhood(input: ArchitectureLedgerScope & { id: string; depth: number }): Promise<ArchitectureLedgerGraphState> {
    const db = await this.database();
    return readArchitectureLedgerNeighborhoodFromDb(db, input);
  }

  async readExplorerProjectionAuthority(input: ArchitectureLedgerScope): Promise<ExplorerProjectionAuthorityResult | undefined> {
    const db = await this.database();
    return readExplorerProjectionAuthorityFromDb(db, input);
  }

  async readExplorerProjectionInputs(input: ArchitectureLedgerScope & { query: ExplorerProjectionQueryV2; plan: ProjectionReadPlanV1; authorityCursor: AuthorityCursorV1 }): Promise<ExplorerProjectionReadResult> {
    if (input.plan.source !== "verified-ledger-current") {
      throw new Error("explorer-projection-read-plan-source-invalid");
    }
    const db = await this.database();
    db.exec("BEGIN");
    try {
      const result = readExplorerProjectionInputsFromDb(db, input);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async readExplorerProjectionMetadata(input: ArchitectureLedgerScope & { query: ExplorerProjectionQueryV2; plan: ProjectionReadPlanV1; authorityCursor: AuthorityCursorV1; entityIds: string[]; subjectIds: string[] }): Promise<ExplorerProjectionMetadataResult> {
    const db = await this.database();
    db.exec("BEGIN");
    try {
      const result = readExplorerProjectionMetadataFromDb(db, input);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async queryArchitectureLedgerFts(input: ArchitectureLedgerScope & { query: string; maxItems?: number }): Promise<ArchitectureBookFtsMatch[]> {
    const db = await this.database();
    return queryArchitectureLedgerSearchFts(db, input);
  }

  async replayArchitectureLedger(input: ArchitectureLedgerReplayInput): Promise<ArchitectureLedgerReplayResult> {
    const db = await this.database();
    const result = replayArchitectureLedgerFromDb(db, input);
    recordExplorerRuntimeMetricInDb(db, input, {
      metricName: "replay-tail-length",
      reasonCode: "anchored-replay",
      value: result.replay.tailEventCount
    });
    return result;
  }

  async replayArchitectureLedgerEvidence(input: ArchitectureLedgerReplayInput): Promise<EvidenceStateAtCursorV1> {
    return (await this.replayArchitectureLedger(input)).evidenceState;
  }

  async listArchitectureChangeFeed(input: ArchitectureLedgerScope & { consumerId: string; limit?: number }): Promise<ArchitectureChangeFeedBatchV1> {
    const db = await this.database();
    const consumerId = requireChangeFeedConsumerId(input.consumerId);
    const workspaceKey = architectureLedgerWorkspaceKey(input.worktree);
    const limit = Math.max(1, Math.min(500, Math.trunc(input.limit ?? 100)));
    const consumer = db.prepare(
      `SELECT feed_sequence, delivered_sequence FROM architecture_change_feed_consumers
        WHERE consumer_id = ? AND storage_repository_id = ? AND storage_workspace_id = ?`
    ).get(consumerId, input.repository.storageRepositoryId, workspaceKey);
    const { checkpoint, deliveredSequence: currentDeliveredSequence } = validateArchitectureChangeFeedConsumerState(
      db,
      input.repository.storageRepositoryId,
      workspaceKey,
      consumer
    );
    const rows = db.prepare(
      `SELECT architecture_change_feed.*,
          architecture_events.event_sequence AS authority_event_sequence,
          architecture_events.event_hash AS authority_event_hash,
          architecture_events.storage_repository_id AS authority_storage_repository_id,
          architecture_events.storage_workspace_id AS authority_storage_workspace_id
        FROM architecture_change_feed
        JOIN architecture_events ON architecture_events.event_id = architecture_change_feed.event_id
        WHERE architecture_change_feed.storage_repository_id = ?
          AND architecture_change_feed.storage_workspace_id = ?
          AND architecture_change_feed.feed_sequence > ?
        ORDER BY feed_sequence ASC LIMIT ?`
    ).all(input.repository.storageRepositoryId, workspaceKey, checkpoint, limit + 1);
    const selected = rows.slice(0, limit);
    const records = selected.map((row) => architectureChangeFeedRecordFromRow(db, input, row));
    if (records.length > 0) {
      const deliveredSequence = Math.max(currentDeliveredSequence, records.at(-1)!.feedSequence);
      db.prepare(
        `INSERT INTO architecture_change_feed_consumers
          (consumer_id, storage_repository_id, storage_workspace_id, feed_sequence, delivered_sequence, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(consumer_id, storage_repository_id, storage_workspace_id) DO UPDATE SET
            delivered_sequence = MAX(architecture_change_feed_consumers.delivered_sequence, excluded.delivered_sequence),
            updated_at = excluded.updated_at`
      ).run(consumerId, input.repository.storageRepositoryId, workspaceKey, checkpoint, deliveredSequence, nowIso());
    }
    return {
      schemaVersion: "archcontext.architecture-change-feed-batch/v1",
      consumerId,
      checkpoint,
      records,
      hasMore: rows.length > limit
    };
  }

  async acknowledgeArchitectureChangeFeed(input: ArchitectureLedgerScope & { consumerId: string; feedSequence: number }): Promise<number> {
    const db = await this.database();
    const consumerId = requireChangeFeedConsumerId(input.consumerId);
    const feedSequence = Math.trunc(input.feedSequence);
    if (!Number.isSafeInteger(feedSequence) || feedSequence < 0) throw new Error("architecture-change-feed-sequence-invalid");
    const workspaceKey = architectureLedgerWorkspaceKey(input.worktree);
    const consumer = db.prepare(
      `SELECT feed_sequence, delivered_sequence FROM architecture_change_feed_consumers
        WHERE consumer_id = ? AND storage_repository_id = ? AND storage_workspace_id = ?`
    ).get(consumerId, input.repository.storageRepositoryId, workspaceKey);
    const { checkpoint, deliveredSequence } = validateArchitectureChangeFeedConsumerState(
      db,
      input.repository.storageRepositoryId,
      workspaceKey,
      consumer
    );
    if (feedSequence <= checkpoint) return checkpoint;
    if (feedSequence > deliveredSequence) throw new Error("architecture-change-feed-ack-requires-delivered-sequence");
    const feed = db.prepare(
      `SELECT feed_sequence FROM architecture_change_feed
        WHERE storage_repository_id = ? AND storage_workspace_id = ? AND feed_sequence = ?`
    ).get(input.repository.storageRepositoryId, workspaceKey, feedSequence);
    if (!feed) throw new Error("architecture-change-feed-ack-scope-mismatch");
    db.prepare(
      `UPDATE architecture_change_feed_consumers SET feed_sequence = ?, updated_at = ?
        WHERE consumer_id = ? AND storage_repository_id = ? AND storage_workspace_id = ?`
    ).run(feedSequence, nowIso(), consumerId, input.repository.storageRepositoryId, workspaceKey);
    return feedSequence;
  }

  async listArchitectureEventBacklinks(input: ArchitectureLedgerScope): Promise<ArchitectureEventBacklinkV1[]> {
    const db = await this.database();
    const rows = db.prepare(
      `SELECT architecture_event_subjects.logical_event_id AS indexed_logical_event_id,
          architecture_event_subjects.authority_class, architecture_event_subjects.subject_kind,
          architecture_event_subjects.subject_id, architecture_event_subjects.operation,
          architecture_change_feed.logical_event_id, architecture_change_feed.subjects_digest,
          architecture_change_feed.title, architecture_change_feed.rationale
        FROM architecture_event_subjects
        JOIN architecture_change_feed
          ON architecture_change_feed.event_id = architecture_event_subjects.event_id
        WHERE architecture_event_subjects.storage_repository_id = ?
          AND architecture_event_subjects.storage_workspace_id = ?
        ORDER BY architecture_event_subjects.event_sequence ASC, architecture_event_subjects.subject_id ASC`
    ).all(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree));
    const byEvent = new Map<string, { subjects: ArchitectureAffectedSubjectV1[]; title?: string; rationale?: string; subjectsDigest: string }>();
    for (const row of rows) {
      const eventId = String(row.logical_event_id);
      if (String(row.indexed_logical_event_id) !== eventId) throw new Error(`architecture-event-backlink-logical-id-mismatch: ${eventId}`);
      const entry = byEvent.get(eventId) ?? {
        subjects: [],
        subjectsDigest: String(row.subjects_digest),
        ...(row.title === null || row.title === undefined ? {} : { title: String(row.title) }),
        ...(row.rationale === null || row.rationale === undefined ? {} : { rationale: String(row.rationale) })
      };
      entry.subjects.push(architectureAffectedSubjectFromRow(row));
      byEvent.set(eventId, entry);
    }
    return [...byEvent.entries()].map(([eventId, entry]) => {
      const subjects = entry.subjects.sort((left, right) =>
        `${left.authorityClass}:${left.subjectKind}:${left.subjectId}:${left.operation}`
          .localeCompare(`${right.authorityClass}:${right.subjectKind}:${right.subjectId}:${right.operation}`));
      if (architectureChangeFeedSubjectsDigest(eventId, subjects) !== entry.subjectsDigest) {
        throw new Error(`architecture-event-backlink-subjects-digest-mismatch: ${eventId}`);
      }
      return {
        eventId,
        subjectIds: [...new Set(subjects.map((subject) => subject.subjectId))].sort(),
        ...(entry.title ? { title: entry.title } : {}),
        ...(entry.rationale ? { rationale: entry.rationale } : {})
      };
    });
  }

  async verifyArchitectureLedgerReplay(input: ArchitectureLedgerReplayInput): Promise<ArchitectureLedgerReplayVerification> {
    const materialized = await this.readArchitectureLedgerState(input);
    const materializedEvidence = readArchitectureLedgerEvidenceStateFromDb(await this.database(), input);
    const [replayed, anchored] = await Promise.all([
      this.replayArchitectureLedger({ ...input, mode: "genesis" }),
      this.replayArchitectureLedger({ ...input, mode: "anchored" })
    ]);
    const materializedDigest = architectureLedgerStateDigest(materialized);
    const mismatches: string[] = [];
    if (materializedDigest !== replayed.graphDigest || stableJson(materialized) !== stableJson(replayed.state)) {
      mismatches.push("materialized-current-state-does-not-match-replay");
    }
    if (materializedEvidence.stateDigest !== replayed.evidenceState.stateDigest || stableJson(materializedEvidence) !== stableJson(replayed.evidenceState)) {
      mismatches.push("materialized-evidence-state-does-not-match-replay");
    }
    if (anchored.graphDigest !== replayed.graphDigest || stableJson(anchored.state) !== stableJson(replayed.state)) {
      mismatches.push("anchored-graph-state-does-not-match-genesis-replay");
    }
    if (anchored.evidenceState.stateDigest !== replayed.evidenceState.stateDigest || stableJson(anchored.evidenceState) !== stableJson(replayed.evidenceState)) {
      mismatches.push("anchored-evidence-state-does-not-match-genesis-replay");
    }
    return {
      ok: mismatches.length === 0,
      materializedDigest,
      replayedDigest: replayed.graphDigest,
      materializedEvidenceDigest: materializedEvidence.stateDigest,
      replayedEvidenceDigest: replayed.evidenceState.stateDigest,
      anchoredTailEventCount: anchored.replay.tailEventCount,
      eventCount: replayed.cursor.eventCount,
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
      const replay = replayArchitectureLedgerFromDb(db, { ...input, mode: "genesis" });
      recordArchitectureLedgerOperation(db, {
        scope: input,
        operationKind: "rebuild_current_state",
        durationMs: Date.now() - startedAt,
        rowCount: events.length,
        rebuildReason: "manual-current-state-rebuild"
      });
      db.exec("COMMIT");
      return replay;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async compactArchitectureLedger(input: ArchitectureLedgerScope & { beforeSnapshotId: string }): Promise<{ snapshotId: string; compactedEventCount: number }> {
    const db = await this.database();
    const startedAt = Date.now();
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare(
        `SELECT * FROM architecture_snapshots
          WHERE snapshot_id = ? AND storage_repository_id = ? AND storage_workspace_id = ?`
      ).get(input.beforeSnapshotId, input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree));
      if (!row) throw new Error(`architecture-ledger-snapshot-not-found: ${input.beforeSnapshotId}`);
      const { snapshot } = verifyArchitectureLedgerSnapshotRow(db, input, row);
      const cursorSequence = snapshot.eventCursor.lastEventSequence;
      const before = Number(db.prepare(
        `SELECT COUNT(*) AS count FROM architecture_events
          WHERE storage_repository_id = ? AND storage_workspace_id = ? AND event_sequence <= ? AND compacted_by_snapshot_id IS NULL`
      ).get(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), cursorSequence)?.count ?? 0);
      db.prepare(
        `UPDATE architecture_events SET compacted_by_snapshot_id = ?
          WHERE storage_repository_id = ? AND storage_workspace_id = ? AND event_sequence <= ? AND compacted_by_snapshot_id IS NULL`
      ).run(input.beforeSnapshotId, input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), cursorSequence);
      recordArchitectureLedgerOperation(db, {
        scope: input,
        operationKind: "compact_events",
        durationMs: Date.now() - startedAt,
        rowCount: before,
        rebuildReason: null
      });
      db.exec("COMMIT");
      return { snapshotId: input.beforeSnapshotId, compactedEventCount: before };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
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
    ).get(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree))?.count ?? 0);
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

  async saveExplorerProjection(input: ArchitectureLedgerScope & { projection: ExplorerProjectionV2; dependencies: Array<{ occurrenceId: string; dependencyKeys: string[] }> }): Promise<void> {
    const db = await this.database();
    const storageWorkspaceId = architectureLedgerWorkspaceKey(input.worktree);
    const operationNow = canonicalLifecycleTime(this.clock());
    assertExplorerProjectionCacheIntegrity(input.projection, input);
    assertArchitectureLedgerPersistenceSafe(input.projection as unknown as Json, "explorer-projection-cache");
    db.exec("BEGIN IMMEDIATE");
    try {
      const existingManifest = db.prepare(
        `SELECT projection_digest FROM explorer_projection_cache
          WHERE storage_repository_id = ? AND storage_workspace_id = ? AND manifest_digest = ?`
      ).get(input.repository.storageRepositoryId, storageWorkspaceId, input.projection.inputManifest.manifestDigest);
      if (existingManifest && String(existingManifest.projection_digest) !== input.projection.projectionDigest) {
        throw new Error("explorer-projection-cache-manifest-conflict");
      }
      const projectionJson = stableJson(input.projection);
      db.prepare(
        `INSERT INTO explorer_projection_cache
          (projection_digest, manifest_digest, storage_repository_id, storage_workspace_id, view_id, graph_digest, observed_facts_digest, view_definition_digest, compiler_version,
            projection_json, body_bytes, created_at, last_accessed_at, access_count, pinned_until, pin_reason, invalidated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL)
          ON CONFLICT(projection_digest) DO UPDATE SET
            projection_json = excluded.projection_json,
            body_bytes = excluded.body_bytes`
      ).run(
        input.projection.projectionDigest,
        input.projection.inputManifest.manifestDigest,
        input.repository.storageRepositoryId,
        storageWorkspaceId,
        input.projection.view.id,
        input.projection.cursor.graphDigest,
        input.projection.cursor.observedFactsDigest,
        input.projection.cursor.viewDefinitionDigest,
        input.projection.cursor.compilerVersion,
        projectionJson,
        utf8ByteLength(projectionJson),
        operationNow,
        operationNow
      );
      db.prepare(
        "DELETE FROM explorer_occurrence_dependencies WHERE storage_repository_id = ? AND storage_workspace_id = ? AND projection_digest = ?"
      ).run(input.repository.storageRepositoryId, storageWorkspaceId, input.projection.projectionDigest);
      const insert = db.prepare(
        `INSERT OR IGNORE INTO explorer_occurrence_dependencies
          (storage_repository_id, storage_workspace_id, projection_digest, occurrence_id, dependency_key)
          VALUES (?, ?, ?, ?, ?)`
      );
      for (const entry of input.dependencies) for (const dependencyKey of [...new Set(entry.dependencyKeys)].sort()) {
        insert.run(input.repository.storageRepositoryId, storageWorkspaceId, input.projection.projectionDigest, entry.occurrenceId, dependencyKey);
      }
      const collection = collectExplorerProjectionCacheFromDb(
        db,
        input,
        this.explorerCachePolicy,
        operationNow,
        "explicit-collection",
        { transaction: "existing", cleanupOrphans: false }
      );
      if (!collection.limitsSatisfied) throw new Error("explorer-cache-retention-limits-unsatisfied");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async readExplorerProjection(input: ArchitectureLedgerScope & { projectionDigest: string }): Promise<ExplorerProjectionV2 | undefined> {
    const db = await this.database();
    const row = db.prepare(
      `SELECT * FROM explorer_projection_cache
        WHERE projection_digest = ? AND storage_repository_id = ? AND storage_workspace_id = ?`
    ).get(input.projectionDigest, input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree));
    if (!row) {
      recordExplorerRuntimeMetricInDb(db, input, { metricName: "cache-miss", reasonCode: "digest-read", value: 1 });
      return undefined;
    }
    const projection = explorerProjectionFromCacheRow(row, input);
    touchExplorerProjectionCacheRow(db, row, canonicalLifecycleTime(this.clock()));
    recordExplorerRuntimeMetricInDb(db, input, { metricName: "cache-hit", reasonCode: "digest-read", value: 1 });
    return projection;
  }

  async readExplorerProjectionByManifest(input: ArchitectureLedgerScope & { manifestDigest: string }): Promise<ExplorerProjectionV2 | undefined> {
    const db = await this.database();
    const row = db.prepare(
      `SELECT * FROM explorer_projection_cache
        WHERE manifest_digest = ? AND storage_repository_id = ? AND storage_workspace_id = ?
          AND invalidated_at IS NULL`
    ).get(input.manifestDigest, input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree));
    if (!row) {
      recordExplorerRuntimeMetricInDb(db, input, { metricName: "cache-miss", reasonCode: "manifest-read", value: 1 });
      return undefined;
    }
    const projection = explorerProjectionFromCacheRow(row, input);
    touchExplorerProjectionCacheRow(db, row, canonicalLifecycleTime(this.clock()));
    recordExplorerRuntimeMetricInDb(db, input, { metricName: "cache-hit", reasonCode: "manifest-read", value: 1 });
    return projection;
  }

  async readLatestExplorerProjection(input: ArchitectureLedgerScope & { viewId: string }): Promise<ExplorerProjectionV2 | undefined> {
    const db = await this.database();
    const row = db.prepare(
      `SELECT * FROM explorer_projection_cache
        WHERE storage_repository_id = ? AND storage_workspace_id = ? AND view_id = ?
          AND invalidated_at IS NULL
        ORDER BY created_at DESC, rowid DESC LIMIT 1`
    ).get(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), input.viewId);
    if (!row) return undefined;
    const projection = explorerProjectionFromCacheRow(row, input);
    touchExplorerProjectionCacheRow(db, row, canonicalLifecycleTime(this.clock()));
    return projection;
  }

  async pinExplorerProjections(input: ArchitectureLedgerScope & { projectionDigests: string[]; reason: ExplorerProjectionPinReason; expiresAt: string }): Promise<number> {
    const now = canonicalLifecycleTime(this.clock());
    const nowMs = Date.parse(now);
    const expiresAtMs = Date.parse(input.expiresAt);
    if (!Number.isFinite(nowMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs || expiresAtMs - nowMs > this.explorerCachePolicy.maxPinTtlMs) {
      throw new Error("explorer-projection-pin-expiry-invalid");
    }
    const expiresAt = new Date(expiresAtMs).toISOString();
    const digests = [...new Set(input.projectionDigests)].sort();
    if (digests.length === 0) return 0;
    if (digests.length > this.explorerCachePolicy.maxPinnedEntriesPerScope) throw new Error("explorer-projection-pin-limit-exceeded");
    const db = await this.database();
    const workspace = architectureLedgerWorkspaceKey(input.worktree);
    let pinned = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      const existingPinned = Number(db.prepare(
        `SELECT COUNT(*) AS count FROM explorer_projection_cache
          WHERE storage_repository_id = ? AND storage_workspace_id = ? AND pinned_until > ?
            AND projection_digest NOT IN (${digests.map(() => "?").join(", ")})`
      ).get(input.repository.storageRepositoryId, workspace, now, ...digests)?.count ?? 0);
      const requestedExisting = Number(db.prepare(
        `SELECT COUNT(*) AS count FROM explorer_projection_cache
          WHERE storage_repository_id = ? AND storage_workspace_id = ?
            AND projection_digest IN (${digests.map(() => "?").join(", ")})`
      ).get(input.repository.storageRepositoryId, workspace, ...digests)?.count ?? 0);
      if (existingPinned + requestedExisting > this.explorerCachePolicy.maxPinnedEntriesPerScope) {
        throw new Error("explorer-projection-pin-limit-exceeded");
      }
      const update = db.prepare(
        `UPDATE explorer_projection_cache SET pinned_until = ?, pin_reason = ?
          WHERE storage_repository_id = ? AND storage_workspace_id = ? AND projection_digest = ?`
      );
      for (const digest of digests) {
        const result = update.run(expiresAt, input.reason, input.repository.storageRepositoryId, workspace, digest) as { changes?: number };
        pinned += Number(result.changes ?? 0);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return pinned;
  }

  async collectExplorerProjectionCache(input: ArchitectureLedgerScope & { policy?: ExplorerProjectionCachePolicyV1 }): Promise<ExplorerProjectionCacheCollectionResultV1> {
    const db = await this.database();
    const policy = input.policy ?? this.explorerCachePolicy;
    assertExplorerProjectionCachePolicyNarrowing(this.explorerCachePolicy, policy);
    return collectExplorerProjectionCacheFromDb(db, input, policy, canonicalLifecycleTime(this.clock()), "explicit-collection");
  }

  async readExplorerProjectionCacheStats(input: ArchitectureLedgerScope): Promise<ExplorerProjectionCacheStatsV1> {
    const db = await this.database();
    return explorerProjectionCacheStatsFromDb(db, input, canonicalLifecycleTime(this.clock()));
  }

  async recordExplorerRuntimeMetric(input: ArchitectureLedgerScope & ExplorerRuntimeMetricSampleV1): Promise<void> {
    const db = await this.database();
    recordExplorerRuntimeMetricInDb(db, input, input);
  }

  async listAffectedExplorerOccurrences(input: ArchitectureLedgerScope & { dependencyKeys: string[] }): Promise<string[]> {
    if (input.dependencyKeys.length === 0) return [];
    const db = await this.database();
    const placeholders = input.dependencyKeys.map(() => "?").join(", ");
    return db.prepare(
      `SELECT DISTINCT occurrence_id FROM explorer_occurrence_dependencies
        WHERE storage_repository_id = ? AND storage_workspace_id = ? AND dependency_key IN (${placeholders})
        ORDER BY occurrence_id ASC`
    ).all(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), ...input.dependencyKeys).map((row) => String(row.occurrence_id));
  }

  async invalidateExplorerOccurrences(input: ArchitectureLedgerScope & { occurrenceIds: string[] }): Promise<number> {
    if (input.occurrenceIds.length === 0) return 0;
    const db = await this.database();
    const placeholders = input.occurrenceIds.map(() => "?").join(", ");
    const count = Number(db.prepare(
      `SELECT COUNT(*) AS count FROM explorer_occurrence_dependencies
        WHERE storage_repository_id = ? AND storage_workspace_id = ? AND occurrence_id IN (${placeholders})`
    ).get(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), ...input.occurrenceIds)?.count ?? 0);
    const projectionDigests = db.prepare(
      `SELECT DISTINCT projection_digest FROM explorer_occurrence_dependencies
        WHERE storage_repository_id = ? AND storage_workspace_id = ? AND occurrence_id IN (${placeholders})`
    ).all(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), ...input.occurrenceIds)
      .map((row) => String(row.projection_digest));
    const invalidateProjection = db.prepare(
      "UPDATE explorer_projection_cache SET invalidated_at = ? WHERE projection_digest = ? AND storage_repository_id = ? AND storage_workspace_id = ?"
    );
    for (const projectionDigest of projectionDigests) {
      invalidateProjection.run(nowIso(), projectionDigest, input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree));
    }
    db.prepare(
      `DELETE FROM explorer_occurrence_dependencies
        WHERE storage_repository_id = ? AND storage_workspace_id = ? AND occurrence_id IN (${placeholders})`
    ).run(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), ...input.occurrenceIds);
    return count;
  }

  async clearExplorerDerivedState(input?: ArchitectureLedgerScope): Promise<number> {
    const db = await this.database();
    const count = input
      ? Number(db.prepare("SELECT COUNT(*) AS count FROM explorer_projection_cache WHERE storage_repository_id = ? AND storage_workspace_id = ?").get(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree))?.count ?? 0)
      : Number(db.prepare("SELECT COUNT(*) AS count FROM explorer_projection_cache").get()?.count ?? 0);
    if (input) db.prepare("DELETE FROM explorer_projection_cache WHERE storage_repository_id = ? AND storage_workspace_id = ?").run(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree));
    else db.prepare("DELETE FROM explorer_projection_cache").run();
    return count;
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

const EXPLORER_RUNTIME_METRIC_NAMES = new Set<ExplorerRuntimeMetricName>([
  "feed-lag", "replay-tail-length", "plan-rows-read", "compile-time-ms",
  "cache-hit", "cache-miss", "cache-eviction", "cache-rebuild"
]);
const EXPLORER_RUNTIME_METRIC_REASONS = new Set<ExplorerRuntimeMetricReason>([
  "none", "digest-read", "manifest-read", "latest-read", "manifest-miss",
  "invalidated", "expired", "count-pressure", "byte-pressure", "startup-retention",
  "explicit-collection", "projection-compile", "change-feed", "anchored-replay",
  "bounded-read-plan"
]);

function assertExplorerProjectionCachePolicy(policy: ExplorerProjectionCachePolicyV1): void {
  if (policy.schemaVersion !== "archcontext.explorer-cache-policy/v1") throw new Error("explorer-cache-policy-schema-invalid");
  for (const [name, value] of Object.entries(policy)) {
    if (name === "schemaVersion") continue;
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`explorer-cache-policy-${name}-invalid`);
  }
  if (policy.maxPinnedEntriesPerScope > policy.maxEntriesPerScope) throw new Error("explorer-cache-policy-pins-exceed-entry-limit");
}

function canonicalLifecycleTime(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("explorer-cache-lifecycle-time-invalid");
  return new Date(parsed).toISOString();
}

function assertExplorerProjectionCachePolicyNarrowing(
  configured: ExplorerProjectionCachePolicyV1,
  requested: ExplorerProjectionCachePolicyV1
): void {
  assertExplorerProjectionCachePolicy(requested);
  if (
    requested.maxEntriesPerScope > configured.maxEntriesPerScope
    || requested.maxBytesPerScope > configured.maxBytesPerScope
    || requested.maxAgeMs > configured.maxAgeMs
    || requested.maxPinnedEntriesPerScope > configured.maxPinnedEntriesPerScope
    || requested.maxPinTtlMs > configured.maxPinTtlMs
  ) {
    throw new Error("explorer-cache-policy-cannot-widen-configured-limits");
  }
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function touchExplorerProjectionCacheRow(db: SqliteDatabase, row: Record<string, unknown>, now: string): void {
  db.prepare(
    `UPDATE explorer_projection_cache SET last_accessed_at = ?, access_count = access_count + 1
      WHERE projection_digest = ? AND storage_repository_id = ? AND storage_workspace_id = ?`
  ).run(now, String(row.projection_digest), String(row.storage_repository_id), String(row.storage_workspace_id));
}

function recordExplorerRuntimeMetricInDb(
  db: SqliteDatabase,
  scope: ArchitectureLedgerScope,
  sample: ExplorerRuntimeMetricSampleV1
): void {
  if (!EXPLORER_RUNTIME_METRIC_NAMES.has(sample.metricName)) throw new Error("explorer-runtime-metric-name-invalid");
  if (!EXPLORER_RUNTIME_METRIC_REASONS.has(sample.reasonCode)) throw new Error("explorer-runtime-metric-reason-invalid");
  if (!Number.isSafeInteger(sample.value) || sample.value < 0) throw new Error("explorer-runtime-metric-value-invalid");
  const value = sample.value;
  let recordedAt: string;
  try {
    recordedAt = canonicalLifecycleTime(sample.recordedAt ?? nowIso());
  } catch {
    throw new Error("explorer-runtime-metric-time-invalid");
  }
  const existing = db.prepare(
    `SELECT sample_count, total_value FROM explorer_runtime_metrics
      WHERE storage_repository_id = ? AND storage_workspace_id = ? AND metric_name = ? AND reason_code = ?`
  ).get(
    scope.repository.storageRepositoryId,
    architectureLedgerWorkspaceKey(scope.worktree),
    sample.metricName,
    sample.reasonCode
  );
  if (
    existing
    && (!Number.isSafeInteger(Number(existing.sample_count))
      || !Number.isSafeInteger(Number(existing.total_value))
      || Number(existing.sample_count) + 1 > Number.MAX_SAFE_INTEGER
      || Number(existing.total_value) + value > Number.MAX_SAFE_INTEGER)
  ) throw new Error("explorer-runtime-metric-aggregate-overflow");
  db.prepare(
    `INSERT INTO explorer_runtime_metrics
      (storage_repository_id, storage_workspace_id, metric_name, reason_code, sample_count, total_value, max_value, last_value, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(storage_repository_id, storage_workspace_id, metric_name, reason_code) DO UPDATE SET
        sample_count = sample_count + 1,
        total_value = total_value + excluded.last_value,
        max_value = MAX(max_value, excluded.last_value),
        last_value = excluded.last_value,
        updated_at = excluded.updated_at`
  ).run(
    scope.repository.storageRepositoryId,
    architectureLedgerWorkspaceKey(scope.worktree),
    sample.metricName,
    sample.reasonCode,
    value,
    value,
    value,
    recordedAt
  );
}

function explorerProjectionCacheCountsFromDb(
  db: SqliteDatabase,
  repositoryId: string,
  workspaceId: string,
  now: string
): Pick<ExplorerProjectionCacheStatsV1, "entryCount" | "bodyBytes" | "pinnedEntryCount" | "invalidatedEntryCount"> {
  const row = db.prepare(
    `SELECT COUNT(*) AS entry_count, COALESCE(SUM(length(CAST(projection_json AS BLOB))), 0) AS body_bytes,
        COALESCE(SUM(CASE WHEN pinned_until > ? THEN 1 ELSE 0 END), 0) AS pinned_count,
        COALESCE(SUM(CASE WHEN invalidated_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS invalidated_count
      FROM explorer_projection_cache WHERE storage_repository_id = ? AND storage_workspace_id = ?`
  ).get(now, repositoryId, workspaceId);
  return {
    entryCount: Number(row?.entry_count ?? 0),
    bodyBytes: Number(row?.body_bytes ?? 0),
    pinnedEntryCount: Number(row?.pinned_count ?? 0),
    invalidatedEntryCount: Number(row?.invalidated_count ?? 0)
  };
}

function explorerProjectionCacheStatsFromDb(db: SqliteDatabase, scope: ArchitectureLedgerScope, now: string): ExplorerProjectionCacheStatsV1 {
  const repositoryId = scope.repository.storageRepositoryId;
  const workspaceId = architectureLedgerWorkspaceKey(scope.worktree);
  const counts = explorerProjectionCacheCountsFromDb(db, repositoryId, workspaceId, now);
  const metrics = db.prepare(
    `SELECT metric_name, reason_code, sample_count, total_value, max_value, last_value, updated_at
      FROM explorer_runtime_metrics WHERE storage_repository_id = ? AND storage_workspace_id = ?
      ORDER BY metric_name, reason_code`
  ).all(repositoryId, workspaceId).map((row) => {
    const metricName = String(row.metric_name) as ExplorerRuntimeMetricName;
    const reasonCode = String(row.reason_code) as ExplorerRuntimeMetricReason;
    const value = Number(row.last_value);
    const sampleCount = Number(row.sample_count);
    const totalValue = Number(row.total_value);
    const maxValue = Number(row.max_value);
    if (
      !EXPLORER_RUNTIME_METRIC_NAMES.has(metricName)
      || !EXPLORER_RUNTIME_METRIC_REASONS.has(reasonCode)
      || ![value, sampleCount, totalValue, maxValue].every((item) => Number.isSafeInteger(item) && item >= 0)
    ) throw new Error("explorer-runtime-metric-row-invalid");
    return { metricName, reasonCode, value, sampleCount, totalValue, maxValue, recordedAt: canonicalLifecycleTime(String(row.updated_at)) };
  });
  return {
    schemaVersion: "archcontext.explorer-cache-stats/v1",
    storageRepositoryId: repositoryId,
    storageWorkspaceId: workspaceId,
    ...counts,
    metrics
  };
}

function collectExplorerProjectionCacheFromDb(
  db: SqliteDatabase,
  scope: ArchitectureLedgerScope | undefined,
  policy: ExplorerProjectionCachePolicyV1,
  now: string,
  reasonCode: "startup-retention" | "explicit-collection",
  options: { transaction: "own" | "existing"; cleanupOrphans: boolean } = { transaction: "own", cleanupOrphans: true }
): ExplorerProjectionCacheCollectionResultV1 {
  assertExplorerProjectionCachePolicy(policy);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("explorer-cache-collection-time-invalid");
  if (options.transaction === "own") db.exec("BEGIN IMMEDIATE");
  try {
    const orphanDependencyCount = options.cleanupOrphans ? Number(db.prepare(
      `SELECT COUNT(*) AS count FROM explorer_occurrence_dependencies AS dependency
        WHERE NOT EXISTS (SELECT 1 FROM explorer_projection_cache AS cache
          WHERE cache.projection_digest = dependency.projection_digest
            AND cache.storage_repository_id = dependency.storage_repository_id
            AND cache.storage_workspace_id = dependency.storage_workspace_id)`
    ).get()?.count ?? 0) : 0;
    if (options.cleanupOrphans) {
      db.prepare(
        `DELETE FROM explorer_occurrence_dependencies
          WHERE NOT EXISTS (SELECT 1 FROM explorer_projection_cache AS cache
            WHERE cache.projection_digest = explorer_occurrence_dependencies.projection_digest
              AND cache.storage_repository_id = explorer_occurrence_dependencies.storage_repository_id
              AND cache.storage_workspace_id = explorer_occurrence_dependencies.storage_workspace_id)`
      ).run();
    }
    const scopes = scope ? [{ repositoryId: scope.repository.storageRepositoryId, workspaceId: architectureLedgerWorkspaceKey(scope.worktree), authorityScope: scope }] : db.prepare(
      `SELECT DISTINCT storage_repository_id, storage_workspace_id FROM explorer_projection_cache
        ORDER BY storage_repository_id, storage_workspace_id`
    ).all().map((row) => ({
      repositoryId: String(row.storage_repository_id),
      workspaceId: String(row.storage_workspace_id),
      authorityScope: undefined
    }));
    let combinedBefore = { entryCount: 0, bodyBytes: 0, pinnedEntryCount: 0, invalidatedEntryCount: 0 };
    let combinedAfter = { entryCount: 0, bodyBytes: 0, pinnedEntryCount: 0, invalidatedEntryCount: 0 };
    const evictedProjectionDigests: string[] = [];
    let limitsSatisfied = true;
    for (const selected of scopes) {
      db.prepare(
        `UPDATE explorer_projection_cache SET body_bytes = length(CAST(projection_json AS BLOB))
          WHERE storage_repository_id = ? AND storage_workspace_id = ?
            AND body_bytes != length(CAST(projection_json AS BLOB))`
      ).run(selected.repositoryId, selected.workspaceId);
      db.prepare(
        `UPDATE explorer_projection_cache SET pinned_until = NULL, pin_reason = NULL
          WHERE storage_repository_id = ? AND storage_workspace_id = ? AND pinned_until IS NOT NULL AND pinned_until <= ?`
      ).run(selected.repositoryId, selected.workspaceId, now);
      const before = explorerProjectionCacheCountsFromDb(db, selected.repositoryId, selected.workspaceId, now);
      combinedBefore = sumExplorerCacheCounts(combinedBefore, before);
      const lifecycleRows = db.prepare(
        `SELECT projection_digest, created_at, last_accessed_at, pinned_until, pin_reason
          FROM explorer_projection_cache
          WHERE storage_repository_id = ? AND storage_workspace_id = ?
          ORDER BY projection_digest`
      ).all(selected.repositoryId, selected.workspaceId);
      for (const row of lifecycleRows) {
        const digest = String(row.projection_digest);
        const createdAt = canonicalStoredLifecycleTime(row.created_at, nowMs, policy.maxPinTtlMs);
        if (!createdAt) {
          db.prepare(
            `DELETE FROM explorer_projection_cache
              WHERE storage_repository_id = ? AND storage_workspace_id = ? AND projection_digest = ?`
          ).run(selected.repositoryId, selected.workspaceId, digest);
          evictedProjectionDigests.push(digest);
          if (selected.authorityScope) recordExplorerRuntimeMetricInDb(db, selected.authorityScope, {
            metricName: "cache-eviction", reasonCode: "invalidated", value: 1, recordedAt: now
          });
          continue;
        }
        const lastAccessedAt = canonicalStoredLifecycleTime(row.last_accessed_at ?? row.created_at, nowMs, policy.maxPinTtlMs);
        if (!lastAccessedAt) {
          db.prepare(
            `UPDATE explorer_projection_cache SET last_accessed_at = ?
              WHERE storage_repository_id = ? AND storage_workspace_id = ? AND projection_digest = ?`
          ).run(createdAt, selected.repositoryId, selected.workspaceId, digest);
        }
        if (row.pinned_until !== null && row.pinned_until !== undefined) {
          const pinnedUntil = canonicalStoredLifecycleTime(row.pinned_until, nowMs, policy.maxPinTtlMs);
          if (!pinnedUntil || !["delta-base", "delta-head"].includes(String(row.pin_reason ?? ""))) {
            db.prepare(
              `UPDATE explorer_projection_cache SET pinned_until = NULL, pin_reason = NULL
                WHERE storage_repository_id = ? AND storage_workspace_id = ? AND projection_digest = ?`
            ).run(selected.repositoryId, selected.workspaceId, digest);
          }
        }
      }
      const retained = explorerProjectionCacheCountsFromDb(db, selected.repositoryId, selected.workspaceId, now);
      let remainingEntries = retained.entryCount;
      let remainingBytes = retained.bodyBytes;
      const cutoff = new Date(nowMs - policy.maxAgeMs).toISOString();
      const rows = db.prepare(
        `SELECT projection_digest, length(CAST(projection_json AS BLOB)) AS body_bytes, invalidated_at, created_at, COALESCE(last_accessed_at, created_at) AS last_accessed_at
          FROM explorer_projection_cache
          WHERE storage_repository_id = ? AND storage_workspace_id = ?
            AND (pinned_until IS NULL OR pinned_until <= ?)
          ORDER BY
            CASE WHEN invalidated_at IS NOT NULL THEN 0 WHEN created_at <= ? THEN 1 ELSE 2 END,
            COALESCE(last_accessed_at, created_at), created_at, projection_digest`
      ).all(selected.repositoryId, selected.workspaceId, now, cutoff);
      for (const row of rows) {
        const mandatory = row.invalidated_at !== null && row.invalidated_at !== undefined || String(row.created_at) <= cutoff;
        const countPressure = remainingEntries > policy.maxEntriesPerScope;
        const bytePressure = remainingBytes > policy.maxBytesPerScope;
        if (!mandatory && !countPressure && !bytePressure) break;
        db.prepare(
          `DELETE FROM explorer_projection_cache
            WHERE storage_repository_id = ? AND storage_workspace_id = ? AND projection_digest = ?`
        ).run(selected.repositoryId, selected.workspaceId, String(row.projection_digest));
        remainingEntries -= 1;
        remainingBytes -= Number(row.body_bytes ?? 0);
        evictedProjectionDigests.push(String(row.projection_digest));
        if (selected.authorityScope) {
          recordExplorerRuntimeMetricInDb(db, selected.authorityScope, {
            metricName: "cache-eviction",
            reasonCode: row.invalidated_at ? "invalidated" : String(row.created_at) <= cutoff ? "expired" : bytePressure ? "byte-pressure" : "count-pressure",
            value: 1,
            recordedAt: now
          });
        }
      }
      const after = explorerProjectionCacheCountsFromDb(db, selected.repositoryId, selected.workspaceId, now);
      combinedAfter = sumExplorerCacheCounts(combinedAfter, after);
      limitsSatisfied &&= after.entryCount <= policy.maxEntriesPerScope && after.bodyBytes <= policy.maxBytesPerScope;
    }
    if (options.transaction === "own") db.exec("COMMIT");
    return {
      schemaVersion: "archcontext.explorer-cache-collection/v1",
      reasonCode,
      before: combinedBefore,
      after: combinedAfter,
      evictedProjectionDigests: evictedProjectionDigests.sort(),
      orphanDependencyCount,
      limitsSatisfied
    };
  } catch (error) {
    if (options.transaction === "own") db.exec("ROLLBACK");
    throw error;
  }
}

function canonicalStoredLifecycleTime(value: unknown, nowMs: number, maxFutureMs: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > nowMs + maxFutureMs) return undefined;
  const canonical = new Date(parsed).toISOString();
  return value === canonical ? canonical : undefined;
}

function sumExplorerCacheCounts(
  left: Pick<ExplorerProjectionCacheStatsV1, "entryCount" | "bodyBytes" | "pinnedEntryCount" | "invalidatedEntryCount">,
  right: Pick<ExplorerProjectionCacheStatsV1, "entryCount" | "bodyBytes" | "pinnedEntryCount" | "invalidatedEntryCount">
) {
  return {
    entryCount: left.entryCount + right.entryCount,
    bodyBytes: left.bodyBytes + right.bodyBytes,
    pinnedEntryCount: left.pinnedEntryCount + right.pinnedEntryCount,
    invalidatedEntryCount: left.invalidatedEntryCount + right.invalidatedEntryCount
  };
}

function explorerProjectionFromCacheRow(
  row: Record<string, unknown>,
  input: ArchitectureLedgerScope & { projectionDigest?: string; manifestDigest?: string }
): ExplorerProjectionV2 {
  try {
    const projection = JSON.parse(String(row.projection_json)) as ExplorerProjectionV2;
    assertExplorerProjectionCacheIntegrity(projection, input);
    if (
      String(row.projection_digest) !== projection.projectionDigest
      || String(row.manifest_digest) !== projection.inputManifest.manifestDigest
      || String(row.storage_repository_id) !== input.repository.storageRepositoryId
      || String(row.storage_workspace_id) !== architectureLedgerWorkspaceKey(input.worktree)
      || String(row.view_id) !== projection.view.id
      || String(row.graph_digest) !== projection.cursor.graphDigest
      || String(row.observed_facts_digest) !== projection.cursor.observedFactsDigest
      || String(row.view_definition_digest) !== projection.cursor.viewDefinitionDigest
      || String(row.compiler_version) !== projection.cursor.compilerVersion
      || (input.projectionDigest !== undefined && projection.projectionDigest !== input.projectionDigest)
      || (input.manifestDigest !== undefined && projection.inputManifest.manifestDigest !== input.manifestDigest)
    ) {
      throw new Error("explorer-projection-cache-row-mismatch");
    }
    return projection;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("explorer-projection-cache-")) throw error;
    throw new Error("explorer-projection-cache-json-invalid");
  }
}

export function assertExplorerProjectionCacheIntegrity(projection: ExplorerProjectionV2, scope: ArchitectureLedgerScope): void {
  const schemaResult = validateJsonSchema(
    explorerProjectionV2Schema as unknown as Parameters<typeof validateJsonSchema>[0],
    projection as unknown as Json
  );
  if (!schemaResult.valid) throw new Error("explorer-projection-cache-schema-invalid");
  try {
    assertArchitectureLedgerPersistenceSafe(projection as unknown as Json, "explorer-projection-cache-read");
  } catch {
    throw new Error("explorer-projection-cache-privacy-invalid");
  }
  if (
    projection.schemaVersion !== "archcontext.explorer-projection/v2"
    || !projection.cursor
    || !projection.inputManifest
    || !projection.view
    || !Array.isArray(projection.occurrences)
    || !Array.isArray(projection.relations)
  ) {
    throw new Error("explorer-projection-cache-shape-invalid");
  }
  const { manifestDigest, ...manifestWithoutDigest } = projection.inputManifest;
  const { projectionDigest, ...projectionWithoutDigest } = projection;
  const { planDigest, ...planWithoutDigest } = projection.inputManifest.readPlan;
  const { readSetDigest, ...readSetWithoutDigest } = projection.inputManifest.readSet;
  const planLimits = projection.inputManifest.readPlan.limits;
  const rowsRead = projection.inputManifest.readSet.rowsRead;
  if (
    digestJson(manifestWithoutDigest as unknown as Json) !== manifestDigest
    || digestJson(projectionWithoutDigest as unknown as Json) !== projectionDigest
    || projection.cursor.inputManifestDigest !== manifestDigest
    || projection.cursor.compatibilityDigest !== projection.inputManifest.compatibilityDigest
    || projection.cursor.authoritySource !== projection.inputManifest.authoritySource
    || stableJson(projection.cursor.authorityCursor) !== stableJson(projection.inputManifest.authorityCursor)
    || stableJson(projection.cursor.evidenceAuthorityCursor) !== stableJson(projection.inputManifest.evidenceAuthorityCursor)
    || projection.cursor.evidenceStateDigest !== projection.inputManifest.evidenceStateDigest
    || projection.cursor.graphDigest !== projection.inputManifest.graphDigest
    || projection.cursor.observedFactsDigest !== projection.inputManifest.observedFactsDigest
    || projection.cursor.viewDefinitionDigest !== projection.inputManifest.viewDefinitionDigest
    || projection.cursor.compilerVersion !== projection.inputManifest.compilerVersion
    || stableJson(projection.cursor.observedAvailability) !== stableJson(projection.inputManifest.observedAvailability)
    || projection.inputManifest.observedAvailability.status !== "ready"
    || projection.capabilities.tokenRequired !== projection.inputManifest.tokenRequired
    || digestJson(planWithoutDigest as unknown as Json) !== planDigest
    || digestJson(readSetWithoutDigest as unknown as Json) !== readSetDigest
    || projection.inputManifest.readPlan.queryDigest !== projection.inputManifest.queryDigest
    || projection.inputManifest.readSet.planDigest !== planDigest
    || projection.inputManifest.readPlan.source !== (projection.inputManifest.authoritySource === "ledger" ? "verified-ledger-current" : "git-authority")
    || rowsRead.entities > planLimits.maxEntities
    || rowsRead.relations > planLimits.maxRelations
    || rowsRead.constraints > planLimits.maxConstraints
    || rowsRead.bindings > planLimits.maxBindings
    || rowsRead.backlinks > planLimits.maxBacklinks
    || rowsRead.entities + rowsRead.relations + rowsRead.constraints > planLimits.maxGraphRows
    || stableJson(projection.cursor.repository) !== stableJson(scope.repository)
    || stableJson(projection.cursor.worktree) !== stableJson(scope.worktree)
    || stableJson(projection.inputManifest.repository) !== stableJson(scope.repository)
    || stableJson(projection.inputManifest.worktree) !== stableJson(scope.worktree)
    || projection.inputManifest.inputDomains.authority.status !== "ready"
    || projection.inputManifest.inputDomains.evidence.status !== "ready"
    || projection.inputManifest.inputDomains.evidence.digest !== projection.inputManifest.evidenceStateDigest
    || projection.inputManifest.inputDomains.graph.status !== "ready"
    || projection.inputManifest.inputDomains.graph.digest !== projection.inputManifest.graphDigest
    || projection.inputManifest.inputDomains.observed.status !== "ready"
    || projection.inputManifest.inputDomains.observed.digest !== projection.inputManifest.observedFactsDigest
    || projection.inputManifest.inputDomains.bindings.status !== "ready"
    || projection.inputManifest.inputDomains.bindings.digest !== projection.inputManifest.bindingsDigest
    || (projection.inputManifest.inputDomains["event-backlinks"].status === "ready"
      && projection.inputManifest.inputDomains["event-backlinks"].digest !== projection.inputManifest.eventBacklinksDigest)
    || projection.inputManifest.inputDomains.drift.digest !== projection.inputManifest.driftDigest
    || projection.inputManifest.inputDomains.pressure.digest !== projection.inputManifest.pressureDigest
    || projection.inputManifest.inputDomains["task-session"].digest !== projection.inputManifest.taskSessionDigest
    || (projection.cursor.taskSessionDigest ?? null) !== projection.inputManifest.taskSessionDigest
  ) {
    throw new Error("explorer-projection-cache-integrity-mismatch");
  }
  const expectedAuthorityDigest = digestJson({
    source: projection.inputManifest.authoritySource,
    repository: projection.inputManifest.repository,
    worktree: projection.inputManifest.worktree,
    cursor: projection.inputManifest.authorityCursor,
    evidenceCursor: projection.inputManifest.evidenceAuthorityCursor,
    graphDigest: projection.inputManifest.graphDigest,
    evidenceStateDigest: projection.inputManifest.evidenceStateDigest
  } as unknown as Json);
  if (projection.inputManifest.inputDomains.authority.digest !== expectedAuthorityDigest) {
    throw new Error("explorer-projection-cache-authority-domain-invalid");
  }
  if (projection.inputManifest.authoritySource === "git" && projection.inputManifest.authorityCursor !== null) {
    throw new Error("explorer-projection-cache-authority-binding-invalid");
  }
  if (projection.inputManifest.authoritySource === "ledger") {
    const cursor = projection.inputManifest.authorityCursor;
    if (
      cursor === null
      || stableJson(cursor) !== stableJson(projection.inputManifest.evidenceAuthorityCursor)
      || stableJson(cursor.repository) !== stableJson(scope.repository)
      || stableJson(cursor.worktree) !== stableJson(scope.worktree)
      || cursor.graphDigest !== projection.inputManifest.graphDigest
      || cursor.evidenceStateDigest !== projection.inputManifest.evidenceStateDigest
    ) throw new Error("explorer-projection-cache-authority-binding-invalid");
  }
  if (projection.inputManifest.authoritySource === "git" && projection.inputManifest.evidenceAuthorityCursor) {
    const evidenceCursor = projection.inputManifest.evidenceAuthorityCursor;
    if (
      evidenceCursor.repository.storageRepositoryId !== scope.repository.storageRepositoryId
      || evidenceCursor.worktree.storageWorkspaceId !== scope.worktree.storageWorkspaceId
      || evidenceCursor.worktree.branch !== scope.worktree.branch
      || evidenceCursor.evidenceStateDigest !== projection.inputManifest.evidenceStateDigest
    ) throw new Error("explorer-projection-cache-evidence-authority-binding-invalid");
  }
  const expectedRequirements = EXPLORER_VIEW_INPUT_REQUIREMENTS[projection.view.id];
  for (const [domain, state] of Object.entries(projection.inputManifest.inputDomains)) {
    const expectedRequirement: string = expectedRequirements[domain as keyof typeof expectedRequirements];
    if (state.requirement !== expectedRequirement) {
      throw new Error("explorer-projection-cache-domain-policy-invalid");
    }
    if (state.requirement === "required" && (state.status !== "ready" || state.digest === null)) {
      throw new Error("explorer-projection-cache-required-domain-invalid");
    }
    if (state.requirement === "not-used" && (state.status !== "not-used" || state.digest !== null)) {
      throw new Error("explorer-projection-cache-domain-contract-invalid");
    }
  }
}

function assertNoNewLegacyEvidencePayload(event: ArchitectureEventV1): void {
  const payload = architectureLedgerPayload(event);
  if (payload.evidenceItems !== undefined || payload.evidenceBindings !== undefined) {
    throw new Error(`architecture-ledger-new-legacy-evidence-forbidden: ${event.eventId}`);
  }
}

function architectureLedgerWorkspaceKey(worktree: ArchitectureEventV1["worktree"]): string {
  return `ledger-scope:${digestJson({
    storageWorkspaceId: worktree.storageWorkspaceId,
    branch: worktree.branch,
    headSha: worktree.headSha,
    worktreeDigest: worktree.worktreeDigest
  } as unknown as Json).slice("sha256:".length)}`;
}

function architectureLedgerStorageId(worktree: ArchitectureEventV1["worktree"], logicalId: string): string {
  return `${architectureLedgerWorkspaceKey(worktree)}:${logicalId}`;
}

function appendArchitectureEventsInOpenTransaction(
  db: SqliteDatabase,
  input: ArchitectureLedgerAppendInput
): ArchitectureLedgerAppendResult {
  const startedAt = Date.now();
  const appendedEvents: ArchitectureEventV1[] = [];
  const duplicateEvents: ArchitectureEventV1[] = [];
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
    const previousEventHash = latestArchitectureEventHash(
      db,
      event.repository.storageRepositoryId,
      architectureLedgerWorkspaceKey(event.worktree)
    );
    const normalized = normalizeArchitectureLedgerEvent(event, previousEventHash);
    const payload = architectureLedgerPayload(normalized);
    const operations = payload.operations ?? [];
    const scope = architectureScopeFromEvent(normalized)!;
    const beforeGraph = readArchitectureLedgerStateFromDb(db, scope);
    const graphBeforeDigest = architectureLedgerStateDigest(beforeGraph);
    const evidenceBefore = readArchitectureLedgerEvidenceStateFromDb(db, scope);
    const evidenceAfter = applyArchitectureLedgerEvidenceEvent(evidenceBefore, normalized);
    if (operations.length > 0) {
      if (normalized.baseDigest !== graphBeforeDigest) {
        throw new Error(`architecture-ledger-base-digest-conflict: expected ${graphBeforeDigest}, received ${normalized.baseDigest}`);
      }
    }
    const eventSequence = insertArchitectureEvent(db, normalized);
    persistArchitectureLedgerArtifacts(db, normalized);
    materializeArchitectureLedgerEvent(db, normalized);
    const afterGraph = readArchitectureLedgerStateFromDb(db, scope);
    const graphAfterDigest = architectureLedgerStateDigest(afterGraph);
    if (operations.length > 0) {
      if (normalized.resultingDigest !== graphAfterDigest) {
        throw new Error(`architecture-ledger-resulting-digest-conflict: expected ${graphAfterDigest}, received ${normalized.resultingDigest}`);
      }
    }
    const affectedSubjects = architectureAffectedSubjects(normalized, beforeGraph, evidenceBefore, evidenceAfter);
    appendArchitectureChangeFeed(db, {
      event: normalized,
      eventSequence,
      affectedSubjects,
      graphBeforeDigest,
      graphAfterDigest,
      evidenceBeforeDigest: evidenceBefore.stateDigest,
      evidenceAfterDigest: evidenceAfter.stateDigest
    });
    appendedEvents.push(normalized);
    processed += 1;
    if (input.faultAfterEvents !== undefined && processed >= input.faultAfterEvents) {
      throw new Error("architecture-ledger-fault-injection");
    }
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
  return {
    appendedEvents,
    duplicateEvents,
    graphDigest: architectureLedgerStateDigest(state),
    entityCount: state.entities.length,
    relationCount: state.relations.length,
    constraintCount: state.constraints.length
  };
}

function architectureEventByIdempotency(db: SqliteDatabase, event: ArchitectureEventV1): { event: ArchitectureEventV1; previousEventHash: string | null } | undefined {
  const row = db.prepare(
    `SELECT event_json, previous_event_hash FROM architecture_events
      WHERE storage_repository_id = ? AND storage_workspace_id = ? AND idempotency_key = ?`
  ).get(event.repository.storageRepositoryId, architectureLedgerWorkspaceKey(event.worktree), event.idempotencyKey);
  return row ? {
    event: JSON.parse(String(row.event_json)) as ArchitectureEventV1,
    previousEventHash: row.previous_event_hash === null || row.previous_event_hash === undefined ? null : String(row.previous_event_hash)
  } : undefined;
}

function latestArchitectureEventHash(db: SqliteDatabase, storageRepositoryId: string, storageWorkspaceId: string): string | null {
  return latestArchitectureEvent(db, storageRepositoryId, storageWorkspaceId)?.eventHash ?? null;
}

function latestArchitectureEvent(db: SqliteDatabase, storageRepositoryId: string, storageWorkspaceId: string): { event: ArchitectureEventV1; eventHash: string; eventSequence: number } | undefined {
  const row = db.prepare(
    `SELECT event_sequence, event_json, event_hash FROM architecture_events
      WHERE storage_repository_id = ? AND storage_workspace_id = ?
      ORDER BY event_sequence DESC LIMIT 1`
  ).get(storageRepositoryId, storageWorkspaceId);
  return row ? {
    event: JSON.parse(String(row.event_json)) as ArchitectureEventV1,
    eventHash: String(row.event_hash),
    eventSequence: Number(row.event_sequence)
  } : undefined;
}

function nextArchitectureScopeEventCount(db: SqliteDatabase, storageRepositoryId: string, storageWorkspaceId: string): number {
  const current = Number(db.prepare(
    `SELECT COALESCE(MAX(scope_event_count), 0) AS event_count FROM architecture_events
      WHERE storage_repository_id = ? AND storage_workspace_id = ?`
  ).get(storageRepositoryId, storageWorkspaceId)?.event_count ?? 0);
  if (!Number.isSafeInteger(current) || current < 0) throw new Error("architecture-ledger-scope-event-count-invalid");
  return current + 1;
}

function insertArchitectureEvent(db: SqliteDatabase, event: ArchitectureEventV1): number {
  const workspaceKey = architectureLedgerWorkspaceKey(event.worktree);
  db.prepare(
    `INSERT INTO architecture_events
      (event_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, source_storage_workspace_id, scope_event_count, branch, head_sha, worktree_digest,
        event_type, payload_version, source, actor_kind, actor_id, base_digest, resulting_digest, previous_event_hash,
        event_hash, idempotency_key, payload_json, provenance_json, event_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    architectureLedgerStorageId(event.worktree, event.eventId),
    event.repository.repositoryId,
    event.repository.storageRepositoryId,
    event.worktree.workspaceId,
    workspaceKey,
    event.worktree.storageWorkspaceId,
    nextArchitectureScopeEventCount(db, event.repository.storageRepositoryId, workspaceKey),
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
  const payload = architectureLedgerPayload(event);
  insertArchitectureLedgerSearchDoc(db, event, {
    docId: `event:${event.eventId}`,
    targetKind: "event",
    targetId: event.eventId,
    title: payload.title,
    summary: payload.summary,
    rationale: payload.rationale
  });
  const row = db.prepare("SELECT event_sequence FROM architecture_events WHERE event_id = ?")
    .get(architectureLedgerStorageId(event.worktree, event.eventId));
  const eventSequence = Number(row?.event_sequence ?? 0);
  if (!Number.isSafeInteger(eventSequence) || eventSequence < 1) throw new Error(`architecture-ledger-event-sequence-missing: ${event.eventId}`);
  return eventSequence;
}

export function architectureAffectedSubjects(
  event: ArchitectureEventV1,
  beforeGraph: ArchitectureLedgerGraphState,
  evidenceBefore: EvidenceStateAtCursorV1,
  evidenceAfter: EvidenceStateAtCursorV1
): ArchitectureAffectedSubjectV1[] {
  const subjects = new Map<string, ArchitectureAffectedSubjectV1>();
  const add = (subject: ArchitectureAffectedSubjectV1) => {
    if (!subject.subjectId) return;
    subjects.set(`${subject.authorityClass}:${subject.subjectKind}:${subject.subjectId}:${subject.operation}`, subject);
  };
  const payload = architectureLedgerPayload(event);
  const currentRelations = new Map(beforeGraph.relations.map((relation) => [relation.relationId, relation]));
  const currentConstraints = new Map(beforeGraph.constraints.map((constraint) => [constraint.constraintId, constraint]));
  for (const operation of payload.operations ?? []) {
    const operationName: string = operation.op;
    if (operation.op === "upsert_entity") {
      add({ authorityClass: "architecture-fact", subjectKind: "entity", subjectId: operation.entity.entityId, operation: "upsert" });
    } else if (operation.op === "delete_entity") {
      add({ authorityClass: "architecture-fact", subjectKind: "entity", subjectId: operation.entityId, operation: "delete" });
      for (const [relationId, relation] of currentRelations) {
        if (relation.sourceEntityId !== operation.entityId && relation.targetEntityId !== operation.entityId) continue;
        add({ authorityClass: "architecture-fact", subjectKind: "relation", subjectId: relationId, operation: "delete" });
        add({ authorityClass: "architecture-fact", subjectKind: "entity", subjectId: relation.sourceEntityId, operation: "reference" });
        add({ authorityClass: "architecture-fact", subjectKind: "entity", subjectId: relation.targetEntityId, operation: "reference" });
        currentRelations.delete(relationId);
      }
    } else if (operation.op === "upsert_relation") {
      add({ authorityClass: "architecture-fact", subjectKind: "relation", subjectId: operation.relation.relationId, operation: "upsert" });
      const previousRelation = currentRelations.get(operation.relation.relationId);
      if (previousRelation) {
        add({ authorityClass: "architecture-fact", subjectKind: "entity", subjectId: previousRelation.sourceEntityId, operation: "reference" });
        add({ authorityClass: "architecture-fact", subjectKind: "entity", subjectId: previousRelation.targetEntityId, operation: "reference" });
      }
      add({ authorityClass: "architecture-fact", subjectKind: "entity", subjectId: operation.relation.sourceEntityId, operation: "reference" });
      add({ authorityClass: "architecture-fact", subjectKind: "entity", subjectId: operation.relation.targetEntityId, operation: "reference" });
      currentRelations.set(operation.relation.relationId, operation.relation);
    } else if (operation.op === "delete_relation") {
      add({ authorityClass: "architecture-fact", subjectKind: "relation", subjectId: operation.relationId, operation: "delete" });
      const relation = currentRelations.get(operation.relationId);
      if (relation) {
        add({ authorityClass: "architecture-fact", subjectKind: "entity", subjectId: relation.sourceEntityId, operation: "reference" });
        add({ authorityClass: "architecture-fact", subjectKind: "entity", subjectId: relation.targetEntityId, operation: "reference" });
      }
      currentRelations.delete(operation.relationId);
    } else if (operation.op === "upsert_constraint") {
      add({ authorityClass: "architecture-fact", subjectKind: "constraint", subjectId: operation.constraint.constraintId, operation: "upsert" });
      const previousConstraint = currentConstraints.get(operation.constraint.constraintId);
      if (previousConstraint) add({ authorityClass: "architecture-fact", subjectKind: "subject", subjectId: previousConstraint.subjectId, operation: "reference" });
      add({ authorityClass: "architecture-fact", subjectKind: "subject", subjectId: operation.constraint.subjectId, operation: "reference" });
      currentConstraints.set(operation.constraint.constraintId, operation.constraint);
    } else if (operation.op === "delete_constraint") {
      add({ authorityClass: "architecture-fact", subjectKind: "constraint", subjectId: operation.constraintId, operation: "delete" });
      const constraint = currentConstraints.get(operation.constraintId);
      if (constraint) add({ authorityClass: "architecture-fact", subjectKind: "subject", subjectId: constraint.subjectId, operation: "reference" });
      currentConstraints.delete(operation.constraintId);
    } else {
      throw new Error(`architecture-change-feed-operation-unsupported: ${operationName}`);
    }
  }
  const beforeItems = new Map(evidenceBefore.evidenceItems.map((item) => [item.evidenceId, item]));
  const afterItems = new Map(evidenceAfter.evidenceItems.map((item) => [item.evidenceId, item]));
  const beforeBindings = new Map(evidenceBefore.evidenceBindings.map((binding) => [binding.bindingId, binding]));
  const afterBindings = new Map(evidenceAfter.evidenceBindings.map((binding) => [binding.bindingId, binding]));
  for (const item of payload.evidenceItems ?? []) {
    add({ authorityClass: "evidence", subjectKind: "evidence-item", subjectId: item.evidenceId, operation: "create" });
    add({ authorityClass: "evidence", subjectKind: "subject", subjectId: item.subject, operation: "reference" });
    add({ authorityClass: "evidence", subjectKind: "subject", subjectId: item.selector.id, operation: "reference" });
  }
  for (const binding of payload.evidenceBindings ?? []) {
    add({ authorityClass: "evidence", subjectKind: "evidence-binding", subjectId: binding.bindingId, operation: "create" });
    add({ authorityClass: "evidence", subjectKind: "evidence-item", subjectId: binding.evidenceId, operation: "reference" });
    addArchitectureBindingTargetSubject(add, binding, "reference");
  }
  for (const operation of payload.evidenceOperations ?? []) {
    if (operation.target === "item") {
      add({ authorityClass: "evidence", subjectKind: "evidence-item", subjectId: operation.evidenceId, operation: operation.action });
      for (const item of [beforeItems.get(operation.evidenceId), afterItems.get(operation.evidenceId)]) {
        if (!item) continue;
        add({ authorityClass: "evidence", subjectKind: "subject", subjectId: item.subject, operation: "reference" });
        add({ authorityClass: "evidence", subjectKind: "subject", subjectId: item.selector.id, operation: "reference" });
      }
      const liveBindings = [...evidenceBefore.evidenceBindings, ...evidenceAfter.evidenceBindings]
        .filter((candidate) => candidate.evidenceId === operation.evidenceId);
      for (const binding of liveBindings) {
        add({ authorityClass: "evidence", subjectKind: "evidence-binding", subjectId: binding.bindingId, operation: "reference" });
        addArchitectureBindingTargetSubject(add, binding, "reference");
      }
    } else {
      add({ authorityClass: "evidence", subjectKind: "evidence-binding", subjectId: operation.bindingId, operation: operation.action });
      for (const binding of [beforeBindings.get(operation.bindingId), afterBindings.get(operation.bindingId)]) {
        if (!binding) continue;
        add({ authorityClass: "evidence", subjectKind: "evidence-item", subjectId: binding.evidenceId, operation: "reference" });
        addArchitectureBindingTargetSubject(add, binding, "reference");
      }
    }
  }
  return [...subjects.values()].sort((left, right) =>
    `${left.authorityClass}:${left.subjectKind}:${left.subjectId}:${left.operation}`
      .localeCompare(`${right.authorityClass}:${right.subjectKind}:${right.subjectId}:${right.operation}`));
}

function addArchitectureBindingTargetSubject(
  add: (subject: ArchitectureAffectedSubjectV1) => void,
  binding: EvidenceBindingV1,
  operation: "reference"
): void {
  const subjectKind = binding.target.kind === "entity" || binding.target.kind === "relation" || binding.target.kind === "constraint"
    ? binding.target.kind
    : "subject";
  add({ authorityClass: "evidence", subjectKind, subjectId: binding.target.id, operation });
}

function appendArchitectureChangeFeed(db: SqliteDatabase, input: {
  event: ArchitectureEventV1;
  eventSequence: number;
  affectedSubjects: ArchitectureAffectedSubjectV1[];
  graphBeforeDigest: string;
  graphAfterDigest: string;
  evidenceBeforeDigest: string;
  evidenceAfterDigest: string;
}): void {
  const workspaceKey = architectureLedgerWorkspaceKey(input.event.worktree);
  const storageEventId = architectureLedgerStorageId(input.event.worktree, input.event.eventId);
  const insertSubject = db.prepare(
    `INSERT INTO architecture_event_subjects
      (storage_repository_id, storage_workspace_id, event_sequence, event_id, logical_event_id, authority_class,
        subject_kind, subject_id, operation, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const subject of input.affectedSubjects) {
    insertSubject.run(
      input.event.repository.storageRepositoryId,
      workspaceKey,
      input.eventSequence,
      storageEventId,
      input.event.eventId,
      subject.authorityClass,
      subject.subjectKind,
      subject.subjectId,
      subject.operation,
      input.event.timestamp
    );
  }
  const subjectsDigest = architectureChangeFeedSubjectsDigest(input.event.eventId, input.affectedSubjects);
  const payload = architectureLedgerPayload(input.event);
  db.prepare(
    `INSERT INTO architecture_change_feed
      (storage_repository_id, storage_workspace_id, event_sequence, event_id, logical_event_id, event_hash, title, rationale, subjects_digest,
        graph_before_digest, graph_after_digest, evidence_before_digest, evidence_after_digest, committed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.event.repository.storageRepositoryId,
    workspaceKey,
    input.eventSequence,
    storageEventId,
    input.event.eventId,
    input.event.eventHash,
    payload.title ?? null,
    payload.rationale ?? null,
    subjectsDigest,
    input.graphBeforeDigest,
    input.graphAfterDigest,
    input.evidenceBeforeDigest,
    input.evidenceAfterDigest,
    input.event.timestamp
  );
}

function architectureChangeFeedRecordFromRow(
  db: SqliteDatabase,
  scope: ArchitectureLedgerScope,
  row: Record<string, unknown>
): ArchitectureChangeFeedRecordV1 {
  const eventSequence = Number(row.event_sequence);
  const feedSequence = Number(row.feed_sequence);
  if (!Number.isSafeInteger(feedSequence) || feedSequence < 1) throw new Error("architecture-change-feed-sequence-invalid");
  if (!Number.isSafeInteger(eventSequence) || eventSequence < 1) throw new Error("architecture-change-feed-event-sequence-invalid");
  if (
    eventSequence !== Number(row.authority_event_sequence)
    || String(row.event_hash) !== String(row.authority_event_hash)
    || String(row.storage_repository_id) !== String(row.authority_storage_repository_id)
    || String(row.storage_workspace_id) !== String(row.authority_storage_workspace_id)
  ) {
    throw new Error(`architecture-change-feed-authority-mismatch: ${String(row.logical_event_id)}`);
  }
  const affectedSubjects = db.prepare(
    `SELECT authority_class, subject_kind, subject_id, operation FROM architecture_event_subjects
      WHERE storage_repository_id = ? AND storage_workspace_id = ? AND event_sequence = ?
      ORDER BY authority_class, subject_kind, subject_id, operation`
  ).all(scope.repository.storageRepositoryId, architectureLedgerWorkspaceKey(scope.worktree), eventSequence)
    .map((subject) => architectureAffectedSubjectFromRow(subject));
  const subjectsDigest = architectureChangeFeedSubjectsDigest(String(row.logical_event_id), affectedSubjects);
  if (subjectsDigest !== String(row.subjects_digest)) throw new Error(`architecture-change-feed-subjects-digest-mismatch: ${String(row.logical_event_id)}`);
  return {
    schemaVersion: "archcontext.architecture-change-feed-record/v1",
    feedSequence,
    repository: scope.repository,
    worktree: scope.worktree,
    eventSequence,
    eventId: String(row.logical_event_id),
    eventHash: String(row.event_hash),
    ...(row.title === null || row.title === undefined ? {} : { title: String(row.title) }),
    ...(row.rationale === null || row.rationale === undefined ? {} : { rationale: String(row.rationale) }),
    affectedSubjects,
    subjectsDigest,
    changedInputDigests: {
      graphBefore: String(row.graph_before_digest),
      graphAfter: String(row.graph_after_digest),
      evidenceBefore: String(row.evidence_before_digest),
      evidenceAfter: String(row.evidence_after_digest)
    },
    committedAt: String(row.committed_at)
  };
}

function architectureChangeFeedSubjectsDigest(eventId: string, subjects: ArchitectureAffectedSubjectV1[]): string {
  return digestJson({ eventId, subjects } as unknown as Json);
}

function architectureAffectedSubjectFromRow(row: Record<string, unknown>): ArchitectureAffectedSubjectV1 {
  const authorityClass = String(row.authority_class);
  const subjectKind = String(row.subject_kind);
  const subjectId = String(row.subject_id);
  const operation = String(row.operation);
  if (authorityClass !== "architecture-fact" && authorityClass !== "evidence") throw new Error("architecture-change-feed-authority-class-invalid");
  if (!["entity", "relation", "constraint", "evidence-item", "evidence-binding", "subject"].includes(subjectKind)) {
    throw new Error("architecture-change-feed-subject-kind-invalid");
  }
  if (!["create", "update", "remove", "upsert", "delete", "reference"].includes(operation)) {
    throw new Error("architecture-change-feed-operation-invalid");
  }
  if (!subjectId) throw new Error("architecture-change-feed-subject-id-invalid");
  return {
    authorityClass,
    subjectKind: subjectKind as ArchitectureAffectedSubjectV1["subjectKind"],
    subjectId,
    operation: operation as ArchitectureAffectedSubjectV1["operation"]
  };
}

function requireChangeFeedConsumerId(value: string): string {
  const consumerId = value.trim();
  if (!consumerId || consumerId.length > 128 || !/^[a-zA-Z0-9._-]+$/.test(consumerId)) {
    throw new Error("architecture-change-feed-consumer-id-invalid");
  }
  return consumerId;
}

function validateArchitectureChangeFeedConsumerState(
  db: SqliteDatabase,
  storageRepositoryId: string,
  storageWorkspaceId: string,
  row: Record<string, unknown> | null | undefined
): { checkpoint: number; deliveredSequence: number } {
  const checkpoint = Number(row?.feed_sequence ?? 0);
  const deliveredSequence = Number(row?.delivered_sequence ?? 0);
  if (
    !Number.isSafeInteger(checkpoint)
    || !Number.isSafeInteger(deliveredSequence)
    || checkpoint < 0
    || deliveredSequence < checkpoint
  ) {
    throw new Error("architecture-change-feed-consumer-state-invalid");
  }
  for (const [label, sequence] of [["checkpoint", checkpoint], ["delivered", deliveredSequence]] as const) {
    if (sequence === 0) continue;
    const exists = db.prepare(
      `SELECT 1 AS present FROM architecture_change_feed
        WHERE storage_repository_id = ? AND storage_workspace_id = ? AND feed_sequence = ?`
    ).get(storageRepositoryId, storageWorkspaceId, sequence);
    if (!exists) throw new Error(`architecture-change-feed-consumer-${label}-missing`);
  }
  return { checkpoint, deliveredSequence };
}

function persistArchitectureLedgerArtifacts(db: SqliteDatabase, event: ArchitectureEventV1): void {
  const payload = architectureLedgerPayload(event);
  for (const evidence of payload.evidenceItems ?? []) persistEvidenceItem(db, event, evidence);
  for (const binding of payload.evidenceBindings ?? []) persistEvidenceBinding(db, event, binding);
  for (const operation of payload.evidenceOperations ?? []) {
    if (operation.target === "item") {
      if (operation.action === "create" || operation.action === "update") persistEvidenceItem(db, event, operation.value);
      else removeEvidenceItem(db, event, operation.evidenceId, operation.previousDigest, operation.reasonCode);
    } else if (operation.action === "create" || operation.action === "update") {
      persistEvidenceBinding(db, event, operation.value);
    } else {
      removeEvidenceBinding(db, event, operation.bindingId, operation.previousDigest, operation.reasonCode);
    }
  }
  for (const run of payload.recommendationRuns ?? []) persistRecommendationRun(db, event, run);
  for (const recommendation of payload.recommendations ?? []) persistRecommendation(db, event, recommendation);
  for (const job of payload.agentJobs ?? []) persistAgentJob(db, event, job);
  for (const run of payload.auditRuns ?? []) persistAuditRun(db, event, run);
  for (const feedback of payload.feedback ?? []) persistGenericLedgerJson(db, event, "recommendation_feedback", "feedback_id", "feedback_json", feedback, "feedback");
  for (const waiver of payload.waivers ?? []) persistGenericLedgerJson(db, event, "waivers", "waiver_id", "waiver_json", waiver, "waiver");
  for (const cursor of payload.sourceCursors ?? []) persistSourceCursor(db, event, cursor);
  if (payload.projectionState) persistProjectionState(db, event, payload.projectionState);
}

function persistEvidenceItem(db: SqliteDatabase, event: ArchitectureEventV1, evidence: EvidenceItemV2): void {
  const workspaceKey = architectureLedgerWorkspaceKey(event.worktree);
  db.prepare(
    `INSERT INTO evidence_items
      (evidence_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, event_id, kind, strength,
        polarity, origin, subject, selector_json, summary, coverage_json, supports_json, provenance_json, evidence_json, digest, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(evidence_id) DO UPDATE SET
        repository_id = excluded.repository_id,
        storage_repository_id = excluded.storage_repository_id,
        workspace_id = excluded.workspace_id,
        storage_workspace_id = excluded.storage_workspace_id,
        event_id = excluded.event_id,
        kind = excluded.kind,
        strength = excluded.strength,
        polarity = excluded.polarity,
        origin = excluded.origin,
        subject = excluded.subject,
        selector_json = excluded.selector_json,
        summary = excluded.summary,
        coverage_json = excluded.coverage_json,
        supports_json = excluded.supports_json,
        provenance_json = excluded.provenance_json,
        evidence_json = excluded.evidence_json,
        digest = excluded.digest,
        created_at = excluded.created_at`
  ).run(
    architectureLedgerStorageId(event.worktree, evidence.evidenceId),
    event.repository.repositoryId,
    event.repository.storageRepositoryId,
    event.worktree.workspaceId,
    workspaceKey,
    architectureLedgerStorageId(event.worktree, event.eventId),
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
  insertArchitectureLedgerSearchDoc(db, event, {
    docId: `evidence:${evidence.evidenceId}`,
    targetKind: "evidence",
    targetId: evidence.evidenceId,
    subjectId: evidence.subject,
    summary: evidence.summary,
    evidenceSummary: evidence.summary
  });
}

function persistEvidenceBinding(db: SqliteDatabase, event: ArchitectureEventV1, binding: EvidenceBindingV1): void {
  db.prepare(
    `INSERT INTO evidence_bindings
      (binding_id, evidence_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, event_id,
        target_kind, target_id, binding_reason, authority_effect, provenance_json, binding_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(binding_id) DO UPDATE SET
        evidence_id = excluded.evidence_id,
        repository_id = excluded.repository_id,
        storage_repository_id = excluded.storage_repository_id,
        workspace_id = excluded.workspace_id,
        storage_workspace_id = excluded.storage_workspace_id,
        event_id = excluded.event_id,
        target_kind = excluded.target_kind,
        target_id = excluded.target_id,
        binding_reason = excluded.binding_reason,
        authority_effect = excluded.authority_effect,
        provenance_json = excluded.provenance_json,
        binding_json = excluded.binding_json,
        created_at = excluded.created_at`
  ).run(
    architectureLedgerStorageId(event.worktree, binding.bindingId),
    architectureLedgerStorageId(event.worktree, binding.evidenceId),
    event.repository.repositoryId,
    event.repository.storageRepositoryId,
    event.worktree.workspaceId,
    architectureLedgerWorkspaceKey(event.worktree),
    architectureLedgerStorageId(event.worktree, event.eventId),
    binding.target.kind,
    binding.target.id,
    binding.bindingReason,
    binding.authorityEffect,
    stableJson(binding.provenance),
    stableJson(binding),
    binding.createdAt
  );
}

function removeEvidenceItem(db: SqliteDatabase, event: ArchitectureEventV1, evidenceId: string, previousDigest: string, reasonCode: string): void {
  const workspaceKey = architectureLedgerWorkspaceKey(event.worktree);
  deleteArchitectureLedgerSearchDocs(db, { repository: event.repository, worktree: event.worktree }, [evidenceId]);
  db.prepare("DELETE FROM evidence_items WHERE evidence_id = ? AND storage_repository_id = ? AND storage_workspace_id = ?")
    .run(architectureLedgerStorageId(event.worktree, evidenceId), event.repository.storageRepositoryId, workspaceKey);
  persistEvidenceTombstone(db, event, "item", evidenceId, previousDigest, reasonCode);
}

function removeEvidenceBinding(db: SqliteDatabase, event: ArchitectureEventV1, bindingId: string, previousDigest: string, reasonCode: string): void {
  const workspaceKey = architectureLedgerWorkspaceKey(event.worktree);
  db.prepare("DELETE FROM evidence_bindings WHERE binding_id = ? AND storage_repository_id = ? AND storage_workspace_id = ?")
    .run(architectureLedgerStorageId(event.worktree, bindingId), event.repository.storageRepositoryId, workspaceKey);
  persistEvidenceTombstone(db, event, "binding", bindingId, previousDigest, reasonCode);
}

function persistEvidenceTombstone(
  db: SqliteDatabase,
  event: ArchitectureEventV1,
  targetKind: "item" | "binding",
  targetId: string,
  previousDigest: string,
  reasonCode: string
): void {
  db.prepare(
    `INSERT INTO evidence_tombstones
      (storage_repository_id, storage_workspace_id, target_kind, target_id, previous_digest, reason_code, removed_by_event_id, removed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.repository.storageRepositoryId,
    architectureLedgerWorkspaceKey(event.worktree),
    targetKind,
    targetId,
    previousDigest,
    reasonCode,
    architectureLedgerStorageId(event.worktree, event.eventId),
    event.timestamp
  );
}

function persistRecommendationRun(db: SqliteDatabase, event: ArchitectureEventV1, run: NonNullable<ArchitectureLedgerEventPayload["recommendationRuns"]>[number]): void {
  const workspaceKey = architectureLedgerWorkspaceKey(event.worktree);
  db.prepare(
    `INSERT OR REPLACE INTO recommendation_runs
      (run_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, event_id, status, catalog_digest,
        input_digest, output_digest, metrics_json, run_json, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    architectureLedgerStorageId(event.worktree, run.runId),
    event.repository.repositoryId,
    event.repository.storageRepositoryId,
    event.worktree.workspaceId,
    workspaceKey,
    architectureLedgerStorageId(event.worktree, event.eventId),
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
  const workspaceKey = architectureLedgerWorkspaceKey(event.worktree);
  db.prepare(
    `INSERT OR REPLACE INTO recommendations
      (recommendation_id, run_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, event_id, fingerprint,
        subject, practice_id, status, confidence, enforcement, risk, uncertainty, evidence_binding_ids_json, explanation_json,
        recommendation_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    architectureLedgerStorageId(event.worktree, recommendation.recommendationId),
    architectureLedgerStorageId(event.worktree, recommendation.runId),
    event.repository.repositoryId,
    event.repository.storageRepositoryId,
    event.worktree.workspaceId,
    workspaceKey,
    architectureLedgerStorageId(event.worktree, event.eventId),
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
  insertArchitectureLedgerSearchDoc(db, event, {
    docId: `recommendation:${recommendation.recommendationId}`,
    targetKind: "recommendation",
    targetId: recommendation.recommendationId,
    subjectId: recommendation.subject,
    title: recommendation.subject,
    summary: recommendation.explanation.join("\n"),
    evidenceSummary: recommendation.evidenceBindingIds.join("\n")
  });
}

function persistAgentJob(db: SqliteDatabase, event: ArchitectureEventV1, job: NonNullable<ArchitectureLedgerEventPayload["agentJobs"]>[number]): void {
  const workspaceKey = architectureLedgerWorkspaceKey(event.worktree);
  db.prepare(
    `INSERT OR REPLACE INTO agent_jobs
      (job_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, event_id, status, runner_port,
        fingerprint, input_digest, output_digest, stale_policy, job_json, queued_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    architectureLedgerStorageId(event.worktree, job.jobId),
    event.repository.repositoryId,
    event.repository.storageRepositoryId,
    event.worktree.workspaceId,
    workspaceKey,
    architectureLedgerStorageId(event.worktree, event.eventId),
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

function persistAuditRun(db: SqliteDatabase, event: ArchitectureEventV1, run: NonNullable<ArchitectureLedgerEventPayload["auditRuns"]>[number]): void {
  const workspaceKey = architectureLedgerWorkspaceKey(event.worktree);
  db.prepare(
    `INSERT OR REPLACE INTO audit_runs
      (run_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, event_id, job_id, report_id, status,
        repo_name_with_owner, repo_visibility, base_sha, input_digest, output_digest, run_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    architectureLedgerStorageId(event.worktree, run.runId),
    event.repository.repositoryId,
    event.repository.storageRepositoryId,
    event.worktree.workspaceId,
    workspaceKey,
    architectureLedgerStorageId(event.worktree, event.eventId),
    run.jobId,
    run.reportId,
    run.status,
    run.repoNameWithOwner,
    run.repoVisibility,
    run.baseSha,
    run.inputDigest,
    run.outputDigest,
    stableJson(run),
    run.createdAt
  );
}

function persistProjectionState(db: SqliteDatabase, event: ArchitectureEventV1, state: Record<string, Json>): void {
  const path = String(state.path ?? "projection");
  const projectionDigest = typeof state.projectionDigest === "string" ? state.projectionDigest : digestJson(state);
  const workspaceKey = architectureLedgerWorkspaceKey(event.worktree);
  db.prepare(
    `INSERT OR REPLACE INTO projection_state
      (projection_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, event_id, path, projection_digest, state_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    architectureLedgerStorageId(event.worktree, String(state.projectionId ?? stableLedgerId("projection", event.eventId, path))),
    event.repository.repositoryId,
    event.repository.storageRepositoryId,
    event.worktree.workspaceId,
    workspaceKey,
    architectureLedgerStorageId(event.worktree, event.eventId),
    path,
    projectionDigest,
    stableJson(state),
    event.timestamp
  );
}

function persistSourceCursor(db: SqliteDatabase, event: ArchitectureEventV1, cursor: Record<string, Json>): void {
  const source = String(cursor.source ?? event.source);
  const workspaceKey = architectureLedgerWorkspaceKey(event.worktree);
  db.prepare(
    `INSERT OR REPLACE INTO source_cursors
      (cursor_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, source, cursor_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    architectureLedgerStorageId(event.worktree, String(cursor.cursorId ?? stableLedgerId("cursor", event.eventId, source))),
    event.repository.repositoryId,
    event.repository.storageRepositoryId,
    event.worktree.workspaceId,
    workspaceKey,
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
  const storageId = architectureLedgerStorageId(event.worktree, id);
  const workspaceKey = architectureLedgerWorkspaceKey(event.worktree);
  if (table === "recommendation_feedback") {
    db.prepare(
      `INSERT OR REPLACE INTO recommendation_feedback
        (feedback_id, recommendation_id, repository_id, storage_repository_id, workspace_id, storage_workspace_id, event_id, feedback_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      storageId,
      architectureLedgerStorageId(event.worktree, String(value.recommendationId ?? value.recommendation_id ?? "unknown")),
      event.repository.repositoryId,
      event.repository.storageRepositoryId,
      event.worktree.workspaceId,
      workspaceKey,
      architectureLedgerStorageId(event.worktree, event.eventId),
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
    storageId,
    event.repository.repositoryId,
    event.repository.storageRepositoryId,
    event.worktree.workspaceId,
    workspaceKey,
    architectureLedgerStorageId(event.worktree, event.eventId),
    String(value.targetKind ?? value.target_kind ?? "unknown"),
    String(value.targetId ?? value.target_id ?? "unknown"),
    stableJson(value),
    String(value.createdAt ?? event.timestamp),
    value.expiresAt ? String(value.expiresAt) : null
  );
}

function materializeArchitectureLedgerEvent(db: SqliteDatabase, event: ArchitectureEventV1): void {
  const payload = architectureLedgerPayload(event);
  const workspaceKey = architectureLedgerWorkspaceKey(event.worktree);
  for (const operation of payload.operations ?? []) {
    switch (operation.op) {
      case "upsert_entity":
        upsertArchitectureEntity(db, event, operation.entity);
        break;
      case "delete_entity":
        deleteArchitectureLedgerSearchDocs(db, { repository: event.repository, worktree: event.worktree }, [operation.entityId]);
        db.prepare("DELETE FROM architecture_entities_current WHERE storage_repository_id = ? AND storage_workspace_id = ? AND entity_id = ?")
          .run(event.repository.storageRepositoryId, workspaceKey, operation.entityId);
        db.prepare("DELETE FROM architecture_relations_current WHERE storage_repository_id = ? AND storage_workspace_id = ? AND (source_entity_id = ? OR target_entity_id = ?)")
          .run(event.repository.storageRepositoryId, workspaceKey, operation.entityId, operation.entityId);
        break;
      case "upsert_relation":
        upsertArchitectureRelation(db, event, operation.relation);
        break;
      case "delete_relation":
        deleteArchitectureLedgerSearchDocs(db, { repository: event.repository, worktree: event.worktree }, [operation.relationId]);
        db.prepare("DELETE FROM architecture_relations_current WHERE storage_repository_id = ? AND storage_workspace_id = ? AND relation_id = ?")
          .run(event.repository.storageRepositoryId, workspaceKey, operation.relationId);
        break;
      case "upsert_constraint":
        upsertArchitectureConstraint(db, event, operation.constraint);
        break;
      case "delete_constraint":
        deleteArchitectureLedgerSearchDocs(db, { repository: event.repository, worktree: event.worktree }, [operation.constraintId]);
        db.prepare("DELETE FROM architecture_constraints_current WHERE storage_repository_id = ? AND storage_workspace_id = ? AND constraint_id = ?")
          .run(event.repository.storageRepositoryId, workspaceKey, operation.constraintId);
        break;
    }
  }
}

function upsertArchitectureEntity(db: SqliteDatabase, event: ArchitectureEventV1, entity: ArchitectureLedgerEntityRecord): void {
  const workspaceKey = architectureLedgerWorkspaceKey(event.worktree);
  db.prepare(
    `INSERT OR REPLACE INTO architecture_entities_current
      (storage_repository_id, storage_workspace_id, entity_id, repository_id, workspace_id, branch, head_sha, worktree_digest,
        kind, canonical_name, status, path, summary, metadata_json, last_event_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.repository.storageRepositoryId,
    workspaceKey,
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
    architectureLedgerStorageId(event.worktree, event.eventId),
    event.timestamp
  );
  insertArchitectureLedgerFts(db, "entity", entity.summary ?? "", "", entity.canonicalName, "");
  insertArchitectureLedgerSearchDoc(db, event, {
    docId: `entity:${entity.entityId}`,
    targetKind: "entity",
    targetId: entity.entityId,
    subjectId: entity.entityId,
    title: entity.canonicalName,
    summary: entity.summary ?? "",
    rationale: String(entity.metadata?.rationale ?? "")
  });
}

function upsertArchitectureRelation(db: SqliteDatabase, event: ArchitectureEventV1, relation: ArchitectureLedgerRelationRecord): void {
  const workspaceKey = architectureLedgerWorkspaceKey(event.worktree);
  db.prepare(
    `INSERT OR REPLACE INTO architecture_relations_current
      (storage_repository_id, storage_workspace_id, relation_id, repository_id, workspace_id, branch, head_sha, worktree_digest,
        kind, source_entity_id, target_entity_id, status, summary, metadata_json, last_event_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.repository.storageRepositoryId,
    workspaceKey,
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
    architectureLedgerStorageId(event.worktree, event.eventId),
    event.timestamp
  );
  insertArchitectureLedgerFts(db, "relation", relation.summary ?? "", "", relation.relationId, "");
  insertArchitectureLedgerSearchDoc(db, event, {
    docId: `relation:${relation.relationId}`,
    targetKind: "relation",
    targetId: relation.relationId,
    subjectId: relation.relationId,
    title: relation.relationId,
    summary: relation.summary ?? "",
    rationale: String(relation.metadata?.rationale ?? "")
  });
}

function upsertArchitectureConstraint(db: SqliteDatabase, event: ArchitectureEventV1, constraint: ArchitectureLedgerConstraintRecord): void {
  const workspaceKey = architectureLedgerWorkspaceKey(event.worktree);
  db.prepare(
    `INSERT OR REPLACE INTO architecture_constraints_current
      (storage_repository_id, storage_workspace_id, constraint_id, repository_id, workspace_id, branch, head_sha, worktree_digest,
        kind, subject_id, status, severity, summary, metadata_json, last_event_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.repository.storageRepositoryId,
    workspaceKey,
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
    architectureLedgerStorageId(event.worktree, event.eventId),
    event.timestamp
  );
  insertArchitectureLedgerFts(db, "constraint", constraint.summary ?? "", "", constraint.constraintId, "");
  insertArchitectureLedgerSearchDoc(db, event, {
    docId: `constraint:${constraint.constraintId}`,
    targetKind: "constraint",
    targetId: constraint.constraintId,
    subjectId: constraint.constraintId,
    title: constraint.constraintId,
    summary: constraint.summary ?? "",
    rationale: String(constraint.metadata?.rationale ?? "")
  });
}

function readArchitectureLedgerStateFromDb(db: SqliteDatabase, scope: ArchitectureLedgerScope): ArchitectureLedgerGraphState {
  const scopeParams = [scope.repository.storageRepositoryId, architectureLedgerWorkspaceKey(scope.worktree)];
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

function readArchitectureLedgerEvidenceStateFromDb(db: SqliteDatabase, scope: ArchitectureLedgerScope): EvidenceStateAtCursorV1 {
  const scopeParams = [scope.repository.storageRepositoryId, architectureLedgerWorkspaceKey(scope.worktree)];
  const evidenceItems = db.prepare(
    `SELECT evidence_json FROM evidence_items
      WHERE storage_repository_id = ? AND storage_workspace_id = ?
      ORDER BY evidence_id`
  ).all(...scopeParams).map((row) => JSON.parse(String(row.evidence_json)) as EvidenceItemV2);
  const evidenceBindings = db.prepare(
    `SELECT binding_json FROM evidence_bindings
      WHERE storage_repository_id = ? AND storage_workspace_id = ?
      ORDER BY binding_id`
  ).all(...scopeParams).map((row) => JSON.parse(String(row.binding_json)) as EvidenceBindingV1);
  const tombstones = db.prepare(
    `SELECT evidence_tombstones.target_kind, evidence_tombstones.target_id, evidence_tombstones.previous_digest,
        evidence_tombstones.reason_code, architecture_change_feed.logical_event_id
      FROM evidence_tombstones
      JOIN architecture_change_feed ON architecture_change_feed.event_id = evidence_tombstones.removed_by_event_id
      WHERE evidence_tombstones.storage_repository_id = ? AND evidence_tombstones.storage_workspace_id = ?
      ORDER BY evidence_tombstones.target_kind, evidence_tombstones.target_id`
  ).all(...scopeParams).map((row) => ({
    target: String(row.target_kind) as "item" | "binding",
    id: String(row.target_id),
    previousDigest: String(row.previous_digest),
    reasonCode: String(row.reason_code),
    removedByEventId: String(row.logical_event_id)
  }));
  const withoutDigest = {
    schemaVersion: "archcontext.evidence-state-at-cursor/v1" as const,
    evidenceItems,
    evidenceBindings,
    tombstones
  };
  return { ...withoutDigest, stateDigest: digestJson(withoutDigest as unknown as Json) };
}

function readArchitectureLedgerNeighborhoodFromDb(
  db: SqliteDatabase,
  input: ArchitectureLedgerScope & { id: string; depth: number; limits?: { entities: number; relations: number; constraints: number } }
): ArchitectureLedgerGraphState {
  const depth = Math.max(0, Math.floor(input.depth));
  const scopeParams = [input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree)];
  const entityIds = [...new Set(db.prepare(
    `WITH RECURSIVE seed(entity_id) AS (
        SELECT entity_id FROM architecture_entities_current
          WHERE storage_repository_id = ? AND storage_workspace_id = ? AND entity_id = ?
        UNION
        SELECT source_entity_id FROM architecture_relations_current
          WHERE storage_repository_id = ? AND storage_workspace_id = ? AND relation_id = ?
        UNION
        SELECT target_entity_id FROM architecture_relations_current
          WHERE storage_repository_id = ? AND storage_workspace_id = ? AND relation_id = ?
        UNION
        SELECT subject_id FROM architecture_constraints_current
          WHERE storage_repository_id = ? AND storage_workspace_id = ? AND constraint_id = ?
      ),
      frontier(entity_id, distance) AS (
        SELECT entity_id, 0 FROM seed
        UNION
        SELECT CASE
            WHEN relation.source_entity_id = frontier.entity_id THEN relation.target_entity_id
            ELSE relation.source_entity_id
          END AS entity_id,
          frontier.distance + 1 AS distance
        FROM frontier
        JOIN architecture_relations_current relation
          ON relation.storage_repository_id = ? AND relation.storage_workspace_id = ?
          AND relation.status != 'removed'
          AND (relation.source_entity_id = frontier.entity_id OR relation.target_entity_id = frontier.entity_id)
        WHERE frontier.distance < ?
      )
      SELECT DISTINCT entity_id FROM frontier ORDER BY entity_id LIMIT ?`
  ).all(
    ...scopeParams, input.id,
    ...scopeParams, input.id,
    ...scopeParams, input.id,
    ...scopeParams, input.id,
    ...scopeParams, depth, input.limits?.entities ?? -1
  ).map((row) => String(row.entity_id)))].sort();
  if (entityIds.length === 0) return emptyArchitectureLedgerState();
  const placeholders = entityIds.map(() => "?").join(", ");
  const entities = db.prepare(
    `SELECT entity_id, kind, canonical_name, status, path, summary, metadata_json
      FROM architecture_entities_current
      WHERE storage_repository_id = ? AND storage_workspace_id = ? AND entity_id IN (${placeholders})
      ORDER BY entity_id`
  ).all(...scopeParams, ...entityIds).map((row) => ({
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
        AND (relation_id = ? OR source_entity_id IN (${placeholders}) OR target_entity_id IN (${placeholders}))
      ORDER BY relation_id LIMIT ?`
  ).all(...scopeParams, input.id, ...entityIds, ...entityIds, input.limits?.relations ?? -1).map((row) => ({
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
        AND (constraint_id = ? OR subject_id IN (${placeholders}))
      ORDER BY constraint_id LIMIT ?`
  ).all(...scopeParams, input.id, ...entityIds, input.limits?.constraints ?? -1).map((row) => ({
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

function readExplorerProjectionAuthorityFromDb(
  db: SqliteDatabase,
  input: ArchitectureLedgerScope
): ExplorerProjectionAuthorityResult | undefined {
  const target = architectureLedgerReplayTarget(db, input);
  if (!target) return undefined;
  const authorityRow = db.prepare(
    `SELECT architecture_events.scope_event_count, architecture_change_feed.evidence_after_digest,
        architecture_change_feed.event_hash AS feed_event_hash, architecture_change_feed.event_sequence AS feed_event_sequence
      FROM architecture_events JOIN architecture_change_feed
        ON architecture_change_feed.event_id = architecture_events.event_id
      WHERE architecture_events.storage_repository_id = ? AND architecture_events.storage_workspace_id = ?
        AND architecture_events.event_sequence = ?
      LIMIT 1`
  ).get(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), target.eventSequence);
  const scopeEventCount = Number(authorityRow?.scope_event_count);
  if (!Number.isSafeInteger(scopeEventCount) || scopeEventCount < 1) {
    throw new Error(`explorer-projection-authority-event-count-invalid:${target.event.eventId}`);
  }
  if (Number(authorityRow?.feed_event_sequence) !== target.eventSequence || String(authorityRow?.feed_event_hash) !== target.eventHash) {
    throw new Error(`explorer-projection-authority-feed-mismatch:${target.event.eventId}`);
  }
  const evidenceStateDigest = String(authorityRow?.evidence_after_digest);
  if (!/^sha256:[a-f0-9]{64}$/.test(evidenceStateDigest)) {
    throw new Error(`explorer-projection-authority-evidence-digest-invalid:${target.event.eventId}`);
  }
  return {
    authorityCursor: {
      schemaVersion: "archcontext.authority-cursor/v1",
      repository: input.repository,
      worktree: input.worktree,
      eventSequence: scopeEventCount,
      eventId: target.event.eventId,
      eventHash: target.eventHash,
      graphDigest: target.event.resultingDigest,
      evidenceStateDigest
    },
    evidenceStateDigest
  };
}

function readExplorerProjectionInputsFromDb(
  db: SqliteDatabase,
  input: ArchitectureLedgerScope & { query: ExplorerProjectionQueryV2; plan: ProjectionReadPlanV1; authorityCursor: AuthorityCursorV1 }
): ExplorerProjectionReadResult {
  const { planDigest, ...planWithoutDigest } = input.plan;
  if (digestJson(planWithoutDigest as unknown as Json) !== planDigest) {
    throw new Error("explorer-projection-read-plan-digest-mismatch");
  }
  if (digestJson(input.plan as unknown as Json) !== digestJson(canonicalProjectionReadPlanV1(input.query, "verified-ledger-current") as unknown as Json)) {
    throw new Error("explorer-projection-read-plan-noncanonical");
  }
  assertExplorerProjectionAuthorityCursor(db, input);
  const scopeParams = [input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree)];
  const fullTotals = {
    entities: Number(db.prepare("SELECT COUNT(*) AS count FROM architecture_entities_current WHERE storage_repository_id = ? AND storage_workspace_id = ? AND status != 'removed'").get(...scopeParams)?.count ?? 0),
    relations: Number(db.prepare("SELECT COUNT(*) AS count FROM architecture_relations_current WHERE storage_repository_id = ? AND storage_workspace_id = ? AND status != 'removed'").get(...scopeParams)?.count ?? 0),
    constraints: Number(db.prepare("SELECT COUNT(*) AS count FROM architecture_constraints_current WHERE storage_repository_id = ? AND storage_workspace_id = ? AND status != 'removed'").get(...scopeParams)?.count ?? 0)
  };
  const entityKindTotals = db.prepare(
    `SELECT kind, COUNT(*) AS count FROM architecture_entities_current
      WHERE storage_repository_id = ? AND storage_workspace_id = ? AND status != 'removed'
      GROUP BY kind ORDER BY kind LIMIT ?`
  ).all(...scopeParams, input.plan.limits.maxEntities).map((row) => ({ kind: String(row.kind), count: Number(row.count) }));
  let graph: ArchitectureLedgerGraphState;
  let authoritativeTotals = fullTotals;
  if (input.plan.kind === "focused-neighborhood") {
    if (!input.plan.focusSubjectId) throw new Error("explorer-projection-read-plan-focus-required");
    authoritativeTotals = readExplorerFocusedNeighborhoodTotalsFromDb(db, input, input.plan.focusSubjectId);
    graph = readExplorerFocusedNeighborhoodGraphFromDb(db, input, input.plan.focusSubjectId);
  } else {
    graph = readExplorerProjectionCanonicalGraphFromDb(db, input);
  }
  const selectedSubjectIds = [...new Set([
    ...graph.entities.map((entity) => entity.entityId),
    ...graph.relations.map((relation) => relation.relationId),
    ...graph.constraints.map((constraint) => constraint.constraintId)
  ])].sort();
  const bindingRead = readExplorerProjectionBindingsFromDb(db, input, graph.entities.map((entity) => entity.entityId));
  const backlinkRead = readExplorerProjectionBacklinksFromDb(db, input, selectedSubjectIds);
  const rowsRead = {
    entities: graph.entities.length,
    relations: graph.relations.length,
    constraints: graph.constraints.length,
    bindings: bindingRead.rowsRead,
    backlinks: backlinkRead.rowsRead
  };
  const readSetWithoutDigest = {
    schemaVersion: "archcontext.projection-read-set/v1" as const,
    planDigest,
    selectedGraphDigest: architectureLedgerStateDigest(graph),
    authoritativeTotals,
    entityKindTotals,
    rowsRead,
    truncated: bindingRead.truncated
      || backlinkRead.truncated
      || graph.entities.length < authoritativeTotals.entities
      || graph.relations.length < authoritativeTotals.relations
      || graph.constraints.length < authoritativeTotals.constraints
  };
  return {
    graph,
    bindings: bindingRead.items,
    eventBacklinks: backlinkRead.items,
    readSet: { ...readSetWithoutDigest, readSetDigest: digestJson(readSetWithoutDigest as unknown as Json) }
  };
}

function explorerFocusedNeighborhoodCte(): string {
  return `WITH RECURSIVE seed(entity_id, distance) AS (
      SELECT entity_id, 0 FROM architecture_entities_current
        WHERE storage_repository_id = ? AND storage_workspace_id = ? AND status != 'removed' AND entity_id = ?
      UNION
      SELECT source_entity_id, MIN(?, 1) FROM architecture_relations_current
        WHERE storage_repository_id = ? AND storage_workspace_id = ? AND status != 'removed' AND relation_id = ?
      UNION
      SELECT target_entity_id, MIN(?, 1) FROM architecture_relations_current
        WHERE storage_repository_id = ? AND storage_workspace_id = ? AND status != 'removed' AND relation_id = ?
      UNION
      SELECT subject_id, MIN(?, 1) FROM architecture_constraints_current
        WHERE storage_repository_id = ? AND storage_workspace_id = ? AND status != 'removed' AND constraint_id = ?
    ), frontier(entity_id, distance) AS (
      SELECT entity_id, distance FROM seed
      UNION
      SELECT CASE WHEN relation.source_entity_id = frontier.entity_id THEN relation.target_entity_id ELSE relation.source_entity_id END,
        frontier.distance + 1
      FROM frontier JOIN architecture_relations_current relation
        ON relation.storage_repository_id = ? AND relation.storage_workspace_id = ? AND relation.status != 'removed'
        AND (relation.source_entity_id = frontier.entity_id OR relation.target_entity_id = frontier.entity_id)
      WHERE frontier.distance < ?
      LIMIT ?
    ), nodes(entity_id, distance) AS (
      SELECT entity_id, MIN(distance) FROM frontier GROUP BY entity_id
    )`;
}

function explorerFocusedNeighborhoodCteParams(
  input: ArchitectureLedgerScope & { plan: ProjectionReadPlanV1 },
  focusSubjectId: string
): unknown[] {
  const scopeParams = [input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree)];
  return [
    ...scopeParams, focusSubjectId,
    input.plan.depth, ...scopeParams, focusSubjectId,
    input.plan.depth, ...scopeParams, focusSubjectId,
    input.plan.depth, ...scopeParams, focusSubjectId,
    ...scopeParams, input.plan.depth, input.plan.limits.maxEntities + 1
  ];
}

function readExplorerFocusedNeighborhoodGraphFromDb(
  db: SqliteDatabase,
  input: ArchitectureLedgerScope & { plan: ProjectionReadPlanV1 },
  focusSubjectId: string
): ArchitectureLedgerGraphState {
  const cte = explorerFocusedNeighborhoodCte();
  const params = explorerFocusedNeighborhoodCteParams(input, focusSubjectId);
  const scopeParams = [input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree)];
  const proofEvents = new Map<string, ArchitectureEventV1>();
  const entities = db.prepare(`${cte}
    SELECT entity_row.*
    FROM nodes JOIN architecture_entities_current entity_row ON entity_row.entity_id = nodes.entity_id
    WHERE entity_row.storage_repository_id = ? AND entity_row.storage_workspace_id = ? AND entity_row.status != 'removed'
    ORDER BY entity_row.entity_id LIMIT ?`
  ).all(...params, ...scopeParams, input.plan.limits.maxEntities)
    .map((row) => verifiedArchitectureEntityFromCurrentRow(db, input, row, proofEvents));
  const relations = db.prepare(`${cte}
    SELECT relation.*
    FROM architecture_relations_current relation
    WHERE relation.storage_repository_id = ? AND relation.storage_workspace_id = ? AND relation.status != 'removed'
      AND (relation.relation_id = ? OR EXISTS (
        SELECT 1 FROM nodes WHERE nodes.distance < ?
          AND (relation.source_entity_id = nodes.entity_id OR relation.target_entity_id = nodes.entity_id)
      ))
    ORDER BY relation.relation_id LIMIT ?`
  ).all(...params, ...scopeParams, focusSubjectId, input.plan.depth, input.plan.limits.maxRelations)
    .map((row) => verifiedArchitectureRelationFromCurrentRow(db, input, row, proofEvents));
  const constraints = db.prepare(`${cte}
    SELECT constraint_row.*
    FROM architecture_constraints_current constraint_row
    WHERE constraint_row.storage_repository_id = ? AND constraint_row.storage_workspace_id = ? AND constraint_row.status != 'removed'
      AND (constraint_row.constraint_id = ? OR EXISTS (
        SELECT 1 FROM nodes WHERE nodes.distance < ? AND constraint_row.subject_id = nodes.entity_id
      ))
    ORDER BY constraint_row.constraint_id LIMIT ?`
  ).all(...params, ...scopeParams, focusSubjectId, input.plan.depth, input.plan.limits.maxConstraints)
    .map((row) => verifiedArchitectureConstraintFromCurrentRow(db, input, row, proofEvents));
  return { entities, relations, constraints };
}

function readExplorerFocusedNeighborhoodTotalsFromDb(
  db: SqliteDatabase,
  input: ArchitectureLedgerScope & { plan: ProjectionReadPlanV1 },
  focusSubjectId: string
): ProjectionReadSetV1["authoritativeTotals"] {
  const scopeParams = [input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree)];
  const cte = explorerFocusedNeighborhoodCte();
  const params = explorerFocusedNeighborhoodCteParams(input, focusSubjectId);
  const count = (suffix: string, suffixParams: unknown[] = []) => Number(db.prepare(`${cte} ${suffix}`).get(...params, ...suffixParams)?.count ?? 0);
  const totals = {
    entities: count("SELECT COUNT(*) AS count FROM nodes"),
    relations: count(`SELECT COUNT(*) AS count FROM (SELECT 1 FROM architecture_relations_current relation
      WHERE relation.storage_repository_id = ?
        AND relation.storage_workspace_id = ?
        AND relation.status != 'removed'
        AND (relation.relation_id = ? OR EXISTS (
          SELECT 1 FROM nodes WHERE nodes.distance < ?
            AND (relation.source_entity_id = nodes.entity_id OR relation.target_entity_id = nodes.entity_id)
        )) LIMIT ?)`, [...scopeParams, focusSubjectId, input.plan.depth, input.plan.limits.maxRelations + 1]),
    constraints: count(`SELECT COUNT(*) AS count FROM (SELECT 1 FROM architecture_constraints_current constraint_row
      WHERE constraint_row.storage_repository_id = ?
        AND constraint_row.storage_workspace_id = ?
        AND constraint_row.status != 'removed'
        AND (constraint_row.constraint_id = ? OR EXISTS (
          SELECT 1 FROM nodes WHERE nodes.distance < ? AND constraint_row.subject_id = nodes.entity_id
        )) LIMIT ?)`, [...scopeParams, focusSubjectId, input.plan.depth, input.plan.limits.maxConstraints + 1])
  };
  if (
    totals.entities > input.plan.limits.maxEntities
    || totals.relations > input.plan.limits.maxRelations
    || totals.constraints > input.plan.limits.maxConstraints
  ) {
    throw new Error("explorer-projection-neighborhood-budget-exceeded");
  }
  return totals;
}

function readExplorerProjectionMetadataFromDb(
  db: SqliteDatabase,
  input: ArchitectureLedgerScope & { query: ExplorerProjectionQueryV2; plan: ProjectionReadPlanV1; authorityCursor: AuthorityCursorV1; entityIds: string[]; subjectIds: string[] }
): ExplorerProjectionMetadataResult {
  const { planDigest, ...planWithoutDigest } = input.plan;
  if (input.plan.source !== "git-authority" || digestJson(planWithoutDigest as unknown as Json) !== planDigest) {
    throw new Error("explorer-projection-metadata-plan-invalid");
  }
  if (digestJson(input.plan as unknown as Json) !== digestJson(canonicalProjectionReadPlanV1(input.query, "git-authority") as unknown as Json)) {
    throw new Error("explorer-projection-metadata-plan-noncanonical");
  }
  const entityIds = [...new Set(input.entityIds)].sort();
  const subjectIds = [...new Set(input.subjectIds)].sort();
  if (entityIds.length > input.plan.limits.maxEntities || subjectIds.length > input.plan.limits.maxGraphRows) {
    throw new Error("explorer-projection-metadata-subject-budget-exceeded");
  }
  assertExplorerProjectionAuthorityCursor(db, input);
  const bindingRead = readExplorerProjectionBindingsFromDb(db, input, entityIds);
  const backlinkRead = readExplorerProjectionBacklinksFromDb(db, input, subjectIds);
  return {
    bindings: bindingRead.items,
    eventBacklinks: backlinkRead.items,
    rowsRead: { bindings: bindingRead.rowsRead, backlinks: backlinkRead.rowsRead },
    truncated: bindingRead.truncated || backlinkRead.truncated
  };
}

function assertExplorerProjectionAuthorityCursor(
  db: SqliteDatabase,
  input: ArchitectureLedgerScope & { authorityCursor: AuthorityCursorV1 }
): void {
  const currentAuthority = readExplorerProjectionAuthorityFromDb(db, input);
  if (!currentAuthority || digestJson(currentAuthority.authorityCursor as unknown as Json) !== digestJson(input.authorityCursor as unknown as Json)) {
    throw new Error("explorer-projection-authority-cursor-mismatch");
  }
}

function readExplorerProjectionCanonicalGraphFromDb(
  db: SqliteDatabase,
  input: ArchitectureLedgerScope & { plan: ProjectionReadPlanV1 }
): ArchitectureLedgerGraphState {
  const scopeParams = [input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree)];
  const kindFilter = input.plan.kind === "overview-aggregate" && input.plan.expandedKinds.length > 0;
  if (input.plan.kind === "overview-aggregate" && !kindFilter) return emptyArchitectureLedgerState();
  const kindPlaceholders = input.plan.expandedKinds.map(() => "?").join(", ");
  const proofEvents = new Map<string, ArchitectureEventV1>();
  const entities = db.prepare(
    `SELECT *
      FROM architecture_entities_current
      WHERE storage_repository_id = ? AND storage_workspace_id = ? AND status != 'removed'
        ${kindFilter ? `AND kind IN (${kindPlaceholders})` : ""}
      ORDER BY entity_id LIMIT ?`
  ).all(...scopeParams, ...(kindFilter ? input.plan.expandedKinds : []), input.plan.limits.maxEntities)
    .map((row) => verifiedArchitectureEntityFromCurrentRow(db, input, row, proofEvents));
  const entityIds = entities.map((entity) => entity.entityId);
  if (entityIds.length === 0) return { entities, relations: [], constraints: [] };
  const placeholders = entityIds.map(() => "?").join(", ");
  const relations = db.prepare(
    `SELECT *
      FROM architecture_relations_current
      WHERE storage_repository_id = ? AND storage_workspace_id = ? AND status != 'removed'
        AND source_entity_id IN (${placeholders}) AND target_entity_id IN (${placeholders})
      ORDER BY relation_id LIMIT ?`
  ).all(...scopeParams, ...entityIds, ...entityIds, input.plan.limits.maxRelations)
    .map((row) => verifiedArchitectureRelationFromCurrentRow(db, input, row, proofEvents));
  const constraints = db.prepare(
    `SELECT *
      FROM architecture_constraints_current
      WHERE storage_repository_id = ? AND storage_workspace_id = ? AND status != 'removed'
        AND subject_id IN (${placeholders})
      ORDER BY constraint_id LIMIT ?`
  ).all(...scopeParams, ...entityIds, input.plan.limits.maxConstraints)
    .map((row) => verifiedArchitectureConstraintFromCurrentRow(db, input, row, proofEvents));
  return { entities, relations, constraints };
}

function readExplorerProjectionBindingsFromDb(
  db: SqliteDatabase,
  input: ArchitectureLedgerScope & { plan: ProjectionReadPlanV1 },
  entityIds: string[]
): { items: ExplorerProjectionReadResult["bindings"]; rowsRead: number; truncated: boolean } {
  if (entityIds.length === 0) return { items: [], rowsRead: 0, truncated: false };
  const placeholders = entityIds.map(() => "?").join(", ");
  const params = [input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), ...entityIds];
  const total = Number(db.prepare(
    `SELECT COUNT(*) AS count
      FROM evidence_bindings JOIN evidence_items ON evidence_items.evidence_id = evidence_bindings.evidence_id
      WHERE evidence_bindings.storage_repository_id = ? AND evidence_bindings.storage_workspace_id = ?
        AND evidence_bindings.target_kind = 'entity' AND evidence_bindings.target_id IN (${placeholders})`
  ).get(...params)?.count ?? 0);
  const rows = db.prepare(
    `SELECT evidence_bindings.*,
        evidence_items.evidence_json,
        evidence_items.digest AS evidence_digest,
        evidence_items.event_id AS evidence_event_id,
        evidence_items.repository_id AS evidence_repository_id,
        evidence_items.storage_repository_id AS evidence_storage_repository_id,
        evidence_items.workspace_id AS evidence_workspace_id,
        evidence_items.storage_workspace_id AS evidence_storage_workspace_id
      FROM evidence_bindings JOIN evidence_items ON evidence_items.evidence_id = evidence_bindings.evidence_id
      WHERE evidence_bindings.storage_repository_id = ? AND evidence_bindings.storage_workspace_id = ?
        AND evidence_bindings.target_kind = 'entity' AND evidence_bindings.target_id IN (${placeholders})
      ORDER BY evidence_bindings.binding_id LIMIT ?`
  ).all(...params, input.plan.limits.maxBindings);
  const proofEvents = new Map<string, ArchitectureEventV1>();
  const items = rows.flatMap((row) => {
    const binding = JSON.parse(String(row.binding_json)) as EvidenceBindingV1;
    const evidence = JSON.parse(String(row.evidence_json)) as EvidenceItemV2;
    const bindingEvent = verifiedMaterializingEventForCurrentRow(db, input, row, proofEvents);
    const evidenceEvent = verifiedMaterializingEventForCurrentRow(db, input, {
      event_id: row.evidence_event_id,
      repository_id: row.evidence_repository_id,
      storage_repository_id: row.evidence_storage_repository_id,
      workspace_id: row.evidence_workspace_id,
      storage_workspace_id: row.evidence_storage_workspace_id
    }, proofEvents);
    const bindingPayload = architectureLedgerPayload(bindingEvent);
    const evidencePayload = architectureLedgerPayload(evidenceEvent);
    const expectedBinding = [
      ...(bindingPayload.evidenceBindings ?? []),
      ...(bindingPayload.evidenceOperations ?? []).flatMap((operation) => operation.target === "binding" && operation.action !== "remove" ? [operation.value] : [])
    ].find((candidate) => candidate.bindingId === binding.bindingId);
    const expectedEvidence = [
      ...(evidencePayload.evidenceItems ?? []),
      ...(evidencePayload.evidenceOperations ?? []).flatMap((operation) => operation.target === "item" && operation.action !== "remove" ? [operation.value] : [])
    ].find((candidate) => candidate.evidenceId === evidence.evidenceId);
    if (
      binding.evidenceId !== evidence.evidenceId
      || binding.target.kind !== "entity"
      || !expectedBinding
      || !expectedEvidence
      || stableJson(expectedBinding) !== stableJson(binding)
      || stableJson(expectedEvidence) !== stableJson(evidence)
      || String(row.evidence_digest) !== evidence.digest
      || String(row.binding_id) !== architectureLedgerStorageId(bindingEvent.worktree, binding.bindingId)
      || String(row.evidence_id) !== architectureLedgerStorageId(bindingEvent.worktree, binding.evidenceId)
      || String(row.target_kind) !== binding.target.kind
      || String(row.target_id) !== binding.target.id
      || String(row.authority_effect) !== binding.authorityEffect
    ) {
      throw new Error("explorer-projection-binding-row-mismatch");
    }
    assertLatestMaterializedSubject(db, input, "evidence-binding", binding.bindingId, String(row.event_id));
    assertLatestMaterializedSubject(db, input, "evidence-item", evidence.evidenceId, String(row.evidence_event_id));
    const observedSymbolId = evidence.selector.symbolId;
    return observedSymbolId ? [{
      bindingId: binding.bindingId,
      targetEntityId: binding.target.id,
      observedSymbolId,
      verified: evidence.strength === "verified" && binding.authorityEffect !== "context-only"
    }] : [];
  });
  return { items, rowsRead: rows.length, truncated: rows.length < total };
}

function readExplorerProjectionBacklinksFromDb(
  db: SqliteDatabase,
  input: ArchitectureLedgerScope & { plan: ProjectionReadPlanV1 },
  subjectIds: string[]
): { items: ArchitectureEventBacklinkV1[]; rowsRead: number; truncated: boolean } {
  if (subjectIds.length === 0) return { items: [], rowsRead: 0, truncated: false };
  const placeholders = subjectIds.map(() => "?").join(", ");
  const params = [input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), ...subjectIds];
  const total = Number(db.prepare(
    `SELECT COUNT(*) AS count FROM architecture_event_subjects
      WHERE storage_repository_id = ? AND storage_workspace_id = ? AND subject_id IN (${placeholders})`
  ).get(...params)?.count ?? 0);
  const rows = db.prepare(
    `SELECT architecture_event_subjects.logical_event_id, architecture_event_subjects.subject_id,
        architecture_event_subjects.event_id AS storage_event_id,
        architecture_change_feed.*,
        architecture_events.event_sequence AS authority_event_sequence,
        architecture_events.event_hash AS authority_event_hash,
        architecture_events.storage_repository_id AS authority_storage_repository_id,
        architecture_events.storage_workspace_id AS authority_storage_workspace_id
      FROM architecture_event_subjects JOIN architecture_change_feed
        ON architecture_change_feed.event_id = architecture_event_subjects.event_id
      JOIN architecture_events ON architecture_events.event_id = architecture_event_subjects.event_id
      WHERE architecture_event_subjects.storage_repository_id = ?
        AND architecture_event_subjects.storage_workspace_id = ?
        AND architecture_event_subjects.subject_id IN (${placeholders})
      ORDER BY architecture_event_subjects.event_sequence, architecture_event_subjects.subject_id
      LIMIT ?`
  ).all(...params, input.plan.limits.maxBacklinks);
  const byEvent = new Map<string, ArchitectureEventBacklinkV1>();
  const verifiedRecords = new Map<string, { record: ArchitectureChangeFeedRecordV1; event: ArchitectureEventV1; directSubjectIds: Set<string> }>();
  for (const row of rows) {
    const eventId = String(row.logical_event_id);
    let verified = verifiedRecords.get(eventId);
    if (!verified) {
      const record = architectureChangeFeedRecordFromRow(db, input, row);
      const eventRow = db.prepare(
        `SELECT * FROM architecture_events
          WHERE storage_repository_id = ? AND storage_workspace_id = ? AND event_id = ?
          LIMIT 1`
      ).get(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), String(row.storage_event_id));
      if (!eventRow) throw new Error(`explorer-projection-backlink-event-missing:${eventId}`);
      const event = architectureLedgerEventFromAuthorityRow(input, eventRow);
      const payload = architectureLedgerPayload(event);
      if (
        record.eventId !== event.eventId
        || record.eventHash !== event.eventHash
        || (record.title ?? null) !== (payload.title ?? null)
        || (record.rationale ?? null) !== (payload.rationale ?? null)
      ) {
        throw new Error(`explorer-projection-backlink-authority-mismatch:${eventId}`);
      }
      verified = { record, event, directSubjectIds: architectureEventDirectBacklinkSubjectIds(event) };
      verifiedRecords.set(eventId, verified);
    }
    if (!verified.record.affectedSubjects.some((subject) => subject.subjectId === String(row.subject_id))) {
      throw new Error(`explorer-projection-backlink-subject-mismatch:${eventId}`);
    }
    if (!verified.directSubjectIds.has(String(row.subject_id))) continue;
    const payload = architectureLedgerPayload(verified.event);
    const current = byEvent.get(eventId) ?? {
      eventId,
      subjectIds: [],
      ...(payload.title ? { title: payload.title } : {}),
      ...(payload.rationale ? { rationale: payload.rationale } : {})
    };
    current.subjectIds.push(String(row.subject_id));
    byEvent.set(eventId, current);
  }
  return {
    items: [...byEvent.values()].map((entry) => ({ ...entry, subjectIds: [...new Set(entry.subjectIds)].sort() })),
    rowsRead: rows.length,
    truncated: rows.length < total
  };
}

function architectureEventDirectBacklinkSubjectIds(event: ArchitectureEventV1): Set<string> {
  const ids = new Set<string>();
  const add = (value: string | undefined) => { if (value) ids.add(value); };
  const payload = architectureLedgerPayload(event);
  for (const operation of payload.operations ?? []) {
    if (operation.op === "upsert_entity") add(operation.entity.entityId);
    else if (operation.op === "delete_entity") add(operation.entityId);
    else if (operation.op === "upsert_relation") {
      add(operation.relation.relationId);
      add(operation.relation.sourceEntityId);
      add(operation.relation.targetEntityId);
    } else if (operation.op === "delete_relation") add(operation.relationId);
    else if (operation.op === "upsert_constraint") {
      add(operation.constraint.constraintId);
      add(operation.constraint.subjectId);
    } else add(operation.constraintId);
  }
  for (const item of payload.evidenceItems ?? []) {
    add(item.evidenceId);
    add(item.subject);
    add(item.selector.id);
  }
  for (const binding of payload.evidenceBindings ?? []) {
    add(binding.bindingId);
    add(binding.evidenceId);
    add(binding.target.id);
  }
  for (const operation of payload.evidenceOperations ?? []) {
    if (operation.target === "item") {
      add(operation.evidenceId);
      if (operation.action !== "remove") {
        add(operation.value.subject);
        add(operation.value.selector.id);
      }
    } else {
      add(operation.bindingId);
      if (operation.action !== "remove") {
        add(operation.value.evidenceId);
        add(operation.value.target.id);
      }
    }
  }
  return ids;
}

function architectureLedgerEntityFromCurrentRow(row: Record<string, unknown>): ArchitectureLedgerEntityRecord {
  return { entityId: String(row.entity_id), kind: String(row.kind), canonicalName: String(row.canonical_name), status: row.status as ArchitectureLedgerEntityRecord["status"], ...(row.path ? { path: String(row.path) } : {}), ...(row.summary ? { summary: String(row.summary) } : {}), ...optionalJsonMetadata(row.metadata_json) };
}

function architectureLedgerRelationFromCurrentRow(row: Record<string, unknown>): ArchitectureLedgerRelationRecord {
  return { relationId: String(row.relation_id), kind: String(row.kind), sourceEntityId: String(row.source_entity_id), targetEntityId: String(row.target_entity_id), status: row.status as ArchitectureLedgerRelationRecord["status"], ...(row.summary ? { summary: String(row.summary) } : {}), ...optionalJsonMetadata(row.metadata_json) };
}

function architectureLedgerConstraintFromCurrentRow(row: Record<string, unknown>): ArchitectureLedgerConstraintRecord {
  return { constraintId: String(row.constraint_id), kind: String(row.kind), subjectId: String(row.subject_id), status: row.status as ArchitectureLedgerConstraintRecord["status"], ...(row.severity ? { severity: row.severity as ArchitectureLedgerConstraintRecord["severity"] } : {}), ...(row.summary ? { summary: String(row.summary) } : {}), ...optionalJsonMetadata(row.metadata_json) };
}

function verifiedArchitectureEntityFromCurrentRow(
  db: SqliteDatabase,
  scope: ArchitectureLedgerScope,
  row: Record<string, unknown>,
  cache: Map<string, ArchitectureEventV1>
): ArchitectureLedgerEntityRecord {
  const record = architectureLedgerEntityFromCurrentRow(row);
  const event = verifiedMaterializingEventForCurrentRow(db, scope, row, cache);
  const expected = (architectureLedgerPayload(event).operations ?? [])
    .find((operation) => operation.op === "upsert_entity" && operation.entity.entityId === record.entityId);
  if (!expected || expected.op !== "upsert_entity" || stableJson(expected.entity) !== stableJson(record)) {
    throw new Error(`explorer-projection-materialized-entity-proof-mismatch:${record.entityId}`);
  }
  assertLatestMaterializedSubject(db, scope, "entity", record.entityId, String(row.last_event_id));
  return record;
}

function verifiedArchitectureRelationFromCurrentRow(
  db: SqliteDatabase,
  scope: ArchitectureLedgerScope,
  row: Record<string, unknown>,
  cache: Map<string, ArchitectureEventV1>
): ArchitectureLedgerRelationRecord {
  const record = architectureLedgerRelationFromCurrentRow(row);
  const event = verifiedMaterializingEventForCurrentRow(db, scope, row, cache);
  const expected = (architectureLedgerPayload(event).operations ?? [])
    .find((operation) => operation.op === "upsert_relation" && operation.relation.relationId === record.relationId);
  if (!expected || expected.op !== "upsert_relation" || stableJson(expected.relation) !== stableJson(record)) {
    throw new Error(`explorer-projection-materialized-relation-proof-mismatch:${record.relationId}`);
  }
  assertLatestMaterializedSubject(db, scope, "relation", record.relationId, String(row.last_event_id));
  return record;
}

function verifiedArchitectureConstraintFromCurrentRow(
  db: SqliteDatabase,
  scope: ArchitectureLedgerScope,
  row: Record<string, unknown>,
  cache: Map<string, ArchitectureEventV1>
): ArchitectureLedgerConstraintRecord {
  const record = architectureLedgerConstraintFromCurrentRow(row);
  const event = verifiedMaterializingEventForCurrentRow(db, scope, row, cache);
  const expected = (architectureLedgerPayload(event).operations ?? [])
    .find((operation) => operation.op === "upsert_constraint" && operation.constraint.constraintId === record.constraintId);
  if (!expected || expected.op !== "upsert_constraint" || stableJson(expected.constraint) !== stableJson(record)) {
    throw new Error(`explorer-projection-materialized-constraint-proof-mismatch:${record.constraintId}`);
  }
  assertLatestMaterializedSubject(db, scope, "constraint", record.constraintId, String(row.last_event_id));
  return record;
}

function verifiedMaterializingEventForCurrentRow(
  db: SqliteDatabase,
  scope: ArchitectureLedgerScope,
  row: Record<string, unknown>,
  cache: Map<string, ArchitectureEventV1>
): ArchitectureEventV1 {
  const storageEventId = String(row.last_event_id ?? row.event_id);
  let event = cache.get(storageEventId);
  if (!event) {
    const eventRow = db.prepare(
      `SELECT * FROM architecture_events
        WHERE storage_repository_id = ? AND storage_workspace_id = ? AND event_id = ?
        LIMIT 1`
    ).get(scope.repository.storageRepositoryId, architectureLedgerWorkspaceKey(scope.worktree), storageEventId);
    if (!eventRow) throw new Error(`explorer-projection-materializing-event-missing:${storageEventId}`);
    event = architectureLedgerEventFromStoredRow(eventRow);
    if (
      event.repository.storageRepositoryId !== scope.repository.storageRepositoryId
      || architectureLedgerWorkspaceKey(event.worktree) !== architectureLedgerWorkspaceKey(scope.worktree)
      || event.worktree.branch !== scope.worktree.branch
    ) {
      throw new Error(`explorer-projection-materializing-event-scope-mismatch:${event.eventId}`);
    }
    cache.set(storageEventId, event);
  }
  if (
    String(row.repository_id) !== event.repository.repositoryId
    || String(row.storage_repository_id) !== event.repository.storageRepositoryId
    || String(row.workspace_id) !== event.worktree.workspaceId
    || String(row.storage_workspace_id) !== architectureLedgerWorkspaceKey(event.worktree)
  ) {
    throw new Error(`explorer-projection-materialized-row-scope-mismatch:${event.eventId}`);
  }
  if (row.branch !== undefined && (
    String(row.branch) !== event.worktree.branch
    || String(row.head_sha) !== event.worktree.headSha
    || String(row.worktree_digest) !== event.worktree.worktreeDigest
  )) {
    throw new Error(`explorer-projection-materialized-row-cursor-mismatch:${event.eventId}`);
  }
  return event;
}

function assertLatestMaterializedSubject(
  db: SqliteDatabase,
  scope: ArchitectureLedgerScope,
  subjectKind: "entity" | "relation" | "constraint" | "evidence-item" | "evidence-binding",
  subjectId: string,
  storageEventId: string
): void {
  const latest = db.prepare(
    `SELECT event_id FROM architecture_event_subjects
      WHERE storage_repository_id = ? AND storage_workspace_id = ?
        AND subject_kind = ? AND subject_id = ? AND operation != 'reference'
      ORDER BY event_sequence DESC LIMIT 1`
  ).get(scope.repository.storageRepositoryId, architectureLedgerWorkspaceKey(scope.worktree), subjectKind, subjectId);
  if (!latest || String(latest.event_id) !== storageEventId) {
    throw new Error(`explorer-projection-materialized-subject-currentness-mismatch:${subjectKind}:${subjectId}`);
  }
}

function optionalJsonMetadata(value: unknown): { metadata?: Record<string, Json> } {
  const metadata = JSON.parse(String(value)) as Record<string, Json>;
  return Object.keys(metadata).length > 0 ? { metadata } : {};
}

type ArchitectureLedgerEventCursorRow = Record<string, unknown> & {
  event_sequence: number;
  event_id: string;
  event_hash: string;
  event_json: string;
};

function replayArchitectureLedgerFromDb(db: SqliteDatabase, input: ArchitectureLedgerReplayInput): ArchitectureLedgerReplayResult {
  const explicitSnapshotRow = input.snapshotId
    ? architectureLedgerReplayAnchorRow(db, input, Number.MAX_SAFE_INTEGER)
    : undefined;
  if (input.snapshotId && !explicitSnapshotRow) throw new Error(`architecture-ledger-snapshot-not-found: ${input.snapshotId}`);
  const explicitSnapshot = explicitSnapshotRow ? verifyArchitectureLedgerSnapshotRow(db, input, explicitSnapshotRow) : undefined;
  const target = architectureLedgerReplayTarget(db, input, explicitSnapshot);
  if (!target) {
    const state = emptyArchitectureLedgerState();
    return {
      events: [],
      state,
      evidenceState: emptyArchitectureLedgerEvidenceState(),
      graphDigest: architectureLedgerStateDigest(state),
      cursor: { eventCount: 0, lastEventSequence: 0 },
      replay: { mode: input.mode ?? "anchored", anchorEventSequence: 0, tailEventCount: 0 }
    };
  }
  const mode = input.mode ?? "anchored";
  const snapshotRow = mode === "anchored" && !explicitSnapshot
    ? architectureLedgerReplayAnchorRow(db, input, target.eventSequence)
    : undefined;
  const anchor = mode === "anchored"
    ? explicitSnapshot ?? (snapshotRow ? verifyArchitectureLedgerSnapshotRow(db, input, snapshotRow) : undefined)
    : undefined;
  if (explicitSnapshot && explicitSnapshot.snapshot.eventCursor.lastEventSequence > target.eventSequence) {
    throw new Error("architecture-ledger-snapshot-after-target");
  }
  let state = anchor?.graphState ?? emptyArchitectureLedgerState();
  let evidenceState = anchor?.snapshot.state.evidence ?? emptyArchitectureLedgerEvidenceState();
  const anchorSequence = anchor?.snapshot.eventCursor.lastEventSequence ?? 0;
  const tailRows = db.prepare(
    `SELECT * FROM architecture_events
      WHERE storage_repository_id = ? AND storage_workspace_id = ?
        AND event_sequence > ? AND event_sequence <= ?
      ORDER BY event_sequence ASC`
  ).all(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), anchorSequence, target.eventSequence);
  const events = architectureLedgerEventsFromAuthorityRows(
    input,
    tailRows,
    anchor?.snapshot.eventCursor.lastEventHash ?? null,
    anchor?.snapshot.eventCursor.eventCount ?? 0
  );
  for (const event of events) {
    state = applyArchitectureLedgerGraphEvent(state, event);
    evidenceState = applyArchitectureLedgerEvidenceEvent(evidenceState, event);
  }
  const lastEvent = events.at(-1);
  const lastEventId = lastEvent?.eventId ?? anchor?.snapshot.eventCursor.lastEventId;
  const lastEventHash = lastEvent?.eventHash ?? anchor?.snapshot.eventCursor.lastEventHash;
  if (lastEventId !== target.event.eventId || lastEventHash !== target.eventHash) {
    throw new Error("architecture-ledger-replay-target-cursor-mismatch");
  }
  const eventCount = (anchor?.snapshot.eventCursor.eventCount ?? 0) + events.length;
  return {
    events,
    state,
    evidenceState,
    graphDigest: architectureLedgerStateDigest(state),
    cursor: {
      eventCount,
      lastEventSequence: target.eventSequence,
      lastEventId: target.event.eventId,
      lastEventHash: target.eventHash
    },
    replay: {
      mode,
      ...(anchor ? { anchorSnapshotId: anchor.snapshot.snapshotId } : {}),
      anchorEventSequence: anchorSequence,
      tailEventCount: events.length
    }
  };
}

function architectureLedgerReplayTarget(
  db: SqliteDatabase,
  input: ArchitectureLedgerReplayInput,
  explicitSnapshot?: ReturnType<typeof verifyArchitectureLedgerSnapshotRow>
): { eventSequence: number; event: ArchitectureEventV1; eventHash: string } | undefined {
  const workspaceKey = architectureLedgerWorkspaceKey(input.worktree);
  let row: Record<string, unknown> | undefined;
  if (input.untilEventId) {
    row = db.prepare(
      `SELECT architecture_events.* FROM architecture_change_feed
        JOIN architecture_events ON architecture_events.event_id = architecture_change_feed.event_id
        WHERE architecture_change_feed.storage_repository_id = ?
          AND architecture_change_feed.storage_workspace_id = ?
          AND architecture_change_feed.logical_event_id = ?
        LIMIT 1`
    ).get(input.repository.storageRepositoryId, workspaceKey, input.untilEventId);
    if (!row) throw new Error(`architecture-ledger-event-not-found: ${input.untilEventId}`);
  } else if (input.snapshotId) {
    if (!explicitSnapshot) throw new Error(`architecture-ledger-snapshot-not-found: ${input.snapshotId}`);
    return {
      eventSequence: explicitSnapshot.snapshot.eventCursor.lastEventSequence,
      event: explicitSnapshot.cursorEvent,
      eventHash: explicitSnapshot.snapshot.eventCursor.lastEventHash
    };
  } else {
    row = db.prepare(
      `SELECT * FROM architecture_events
        WHERE storage_repository_id = ? AND storage_workspace_id = ?
        ORDER BY event_sequence DESC LIMIT 1`
    ).get(input.repository.storageRepositoryId, workspaceKey);
  }
  if (!row) return undefined;
  const event = architectureLedgerEventFromAuthorityRow(input, row);
  if (input.untilEventId && event.eventId !== input.untilEventId) {
    throw new Error(`architecture-ledger-event-authority-mismatch: ${input.untilEventId}`);
  }
  return { eventSequence: Number(row.event_sequence), event, eventHash: String(row.event_hash) };
}

function architectureLedgerReplayAnchorRow(
  db: SqliteDatabase,
  input: ArchitectureLedgerReplayInput,
  targetEventSequence: number
): Record<string, unknown> | undefined {
  if (input.snapshotId) {
    return db.prepare(
      `SELECT * FROM architecture_snapshots
        WHERE snapshot_id = ? AND storage_repository_id = ? AND storage_workspace_id = ?`
    ).get(input.snapshotId, input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree));
  }
  return db.prepare(
    `SELECT * FROM architecture_snapshots
      WHERE storage_repository_id = ? AND storage_workspace_id = ? AND last_event_sequence <= ?
      ORDER BY last_event_sequence DESC, created_at DESC LIMIT 1`
  ).get(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), targetEventSequence);
}

function verifyArchitectureLedgerSnapshotRow(
  db: SqliteDatabase,
  input: ArchitectureLedgerScope,
  row: Record<string, unknown>
): { snapshot: ArchitectureSnapshotV2; graphState: ArchitectureLedgerGraphState; cursorEvent: ArchitectureEventV1 } {
  const snapshot = JSON.parse(String(row.snapshot_json)) as ArchitectureSnapshotV2;
  if (snapshot.schemaVersion !== "archcontext.architecture-snapshot/v2" || String(row.snapshot_schema_version) !== snapshot.schemaVersion) {
    throw new Error("architecture-ledger-snapshot-schema-invalid");
  }
  if (stableJson(snapshot.repository) !== stableJson(input.repository) || stableJson(snapshot.worktree) !== stableJson(input.worktree)) {
    throw new Error("architecture-ledger-snapshot-scope-mismatch");
  }
  const graphState = snapshot.state?.graph as unknown as ArchitectureLedgerGraphState;
  const graphDigest = architectureLedgerStateDigest(graphState);
  const evidence = snapshot.state?.evidence;
  if (!evidence || evidence.schemaVersion !== "archcontext.evidence-state-at-cursor/v1") throw new Error("architecture-ledger-snapshot-evidence-invalid");
  const evidenceWithoutDigest = {
    schemaVersion: evidence.schemaVersion,
    evidenceItems: evidence.evidenceItems,
    evidenceBindings: evidence.evidenceBindings,
    tombstones: evidence.tombstones
  };
  const evidenceDigest = digestJson(evidenceWithoutDigest as unknown as Json);
  const stateDigest = digestJson(snapshot.state as unknown as Json);
  if (
    graphDigest !== snapshot.graphDigest
    || evidenceDigest !== evidence.stateDigest
    || evidenceDigest !== snapshot.evidenceDigest
    || stateDigest !== snapshot.stateDigest
    || !Number.isSafeInteger(snapshot.eventCursor.eventCount)
    || snapshot.eventCursor.eventCount < 1
    || snapshot.eventCursor.eventCount > snapshot.eventCursor.lastEventSequence
    || Number(row.last_event_sequence) !== snapshot.eventCursor.lastEventSequence
    || String(row.last_event_hash) !== snapshot.eventCursor.lastEventHash
    || String(row.graph_digest) !== snapshot.graphDigest
    || String(row.evidence_digest) !== snapshot.evidenceDigest
    || String(row.state_digest) !== snapshot.stateDigest
    || Number(row.entity_count) !== graphState.entities.length
    || Number(row.relation_count) !== graphState.relations.length
    || Number(row.constraint_count) !== graphState.constraints.length
    || stableJson(JSON.parse(String(row.input_digests_json))) !== stableJson(snapshot.inputDigests)
    || String(row.snapshot_id) !== snapshot.snapshotId
    || String(row.repository_id) !== snapshot.repository.repositoryId
    || String(row.storage_repository_id) !== snapshot.repository.storageRepositoryId
    || String(row.workspace_id) !== snapshot.worktree.workspaceId
    || String(row.storage_workspace_id) !== architectureLedgerWorkspaceKey(snapshot.worktree)
    || String(row.branch) !== snapshot.worktree.branch
    || String(row.head_sha) !== snapshot.worktree.headSha
    || String(row.worktree_digest) !== snapshot.worktree.worktreeDigest
    || String(row.source_mode) !== snapshot.sourceMode
    || String(row.projection_digest) !== snapshot.projectionDigest
    || String(row.created_at) !== snapshot.createdAt
    || architectureSnapshotDigest(snapshot) !== snapshot.extensions?.digest
  ) {
    throw new Error(`architecture-ledger-snapshot-integrity-mismatch: ${snapshot.snapshotId}`);
  }
  const cursorRow = db.prepare(
    `SELECT * FROM architecture_events
      WHERE storage_repository_id = ? AND storage_workspace_id = ? AND event_sequence = ?`
  ).get(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), snapshot.eventCursor.lastEventSequence);
  if (!cursorRow) throw new Error(`architecture-ledger-snapshot-cursor-not-found: ${snapshot.eventCursor.lastEventId}`);
  const cursorEvent = architectureLedgerEventFromAuthorityRow(input, cursorRow);
  if (
    cursorEvent.eventId !== snapshot.eventCursor.lastEventId
    || cursorEvent.eventHash !== snapshot.eventCursor.lastEventHash
    || Number(cursorRow.scope_event_count) !== snapshot.eventCursor.eventCount
    || String(row.last_event_id) !== architectureLedgerStorageId(input.worktree, cursorEvent.eventId)
  ) {
    throw new Error(`architecture-ledger-snapshot-cursor-mismatch: ${snapshot.snapshotId}`);
  }
  return { snapshot, graphState, cursorEvent };
}

function architectureLedgerEventsFromAuthorityRows(
  scope: ArchitectureLedgerScope,
  rows: Array<Record<string, unknown>>,
  initialPreviousEventHash: string | null,
  initialEventCount = 0
): ArchitectureEventV1[] {
  const events: ArchitectureEventV1[] = [];
  let previousEventHash = initialPreviousEventHash;
  let previousEventSequence = 0;
  for (const row of rows) {
    const event = architectureLedgerEventFromAuthorityRow(scope, row);
    const eventSequence = Number(row.event_sequence);
    if (!Number.isSafeInteger(eventSequence) || eventSequence < 1 || eventSequence <= previousEventSequence) {
      throw new Error(`architecture-ledger-event-sequence-invalid: ${event.eventId}`);
    }
    if (Number(row.scope_event_count) !== initialEventCount + events.length + 1) {
      throw new Error(`architecture-ledger-scope-event-count-mismatch: ${event.eventId}`);
    }
    if ((event.previousEventHash ?? null) !== previousEventHash || (row.previous_event_hash ?? null) !== previousEventHash) {
      throw new Error(`architecture-ledger-event-chain-mismatch: ${event.eventId}`);
    }
    previousEventSequence = eventSequence;
    previousEventHash = event.eventHash!;
    events.push(event);
  }
  return events;
}

function architectureLedgerEventFromAuthorityRow(scope: ArchitectureLedgerScope, row: Record<string, unknown>): ArchitectureEventV1 {
  const event = architectureLedgerEventFromStoredRow(row);
  if (
    stableJson(event.repository) !== stableJson(scope.repository)
    || stableJson(event.worktree) !== stableJson(scope.worktree)
  ) {
    throw new Error(`architecture-ledger-event-authority-mismatch: ${event.eventId}`);
  }
  return event;
}

function architectureLedgerEventFromStoredRow(row: Record<string, unknown>): ArchitectureEventV1 {
  const event = JSON.parse(String(row.event_json)) as ArchitectureEventV1;
  validateArchitectureLedgerEvent(event);
  const previousEventHash = row.previous_event_hash === null || row.previous_event_hash === undefined
    ? null
    : String(row.previous_event_hash);
  if (
    String(row.event_id) !== architectureLedgerStorageId(event.worktree, event.eventId)
    || String(row.repository_id) !== event.repository.repositoryId
    || String(row.storage_repository_id) !== event.repository.storageRepositoryId
    || String(row.workspace_id) !== event.worktree.workspaceId
    || String(row.storage_workspace_id) !== architectureLedgerWorkspaceKey(event.worktree)
    || String(row.source_storage_workspace_id) !== event.worktree.storageWorkspaceId
    || String(row.branch) !== event.worktree.branch
    || String(row.head_sha) !== event.worktree.headSha
    || String(row.worktree_digest) !== event.worktree.worktreeDigest
    || String(row.event_type) !== event.eventType
    || String(row.payload_version) !== event.payloadVersion
    || String(row.source) !== event.source
    || String(row.actor_kind) !== event.actor.kind
    || String(row.actor_id) !== event.actor.id
    || String(row.base_digest) !== event.baseDigest
    || String(row.resulting_digest) !== event.resultingDigest
    || previousEventHash !== (event.previousEventHash ?? null)
    || String(row.idempotency_key) !== event.idempotencyKey
    || String(row.payload_json) !== stableJson(event.payload)
    || String(row.provenance_json) !== stableJson(event.provenance)
    || String(row.created_at) !== event.timestamp
    || event.headSha !== event.worktree.headSha
    || !event.eventHash
    || architectureEventHash(event) !== event.eventHash
    || String(row.event_hash) !== event.eventHash
  ) {
    throw new Error(`architecture-ledger-event-authority-mismatch: ${event.eventId}`);
  }
  return event;
}

function architectureEventsForReplay(db: SqliteDatabase, input: ArchitectureLedgerReplayInput): ArchitectureEventV1[] {
  const target = architectureLedgerReplayTarget(db, input);
  if (!target) return [];
  const rows = db.prepare(
    `SELECT * FROM architecture_events
      WHERE storage_repository_id = ? AND storage_workspace_id = ? AND event_sequence <= ?
      ORDER BY event_sequence ASC`
  ).all(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), target.eventSequence);
  return architectureLedgerEventsFromAuthorityRows(input, rows, null);
}

function deleteArchitectureCurrentState(db: SqliteDatabase, scope: ArchitectureLedgerScope): void {
  for (const table of ["architecture_entities_current", "architecture_relations_current", "architecture_constraints_current"]) {
    db.prepare(`DELETE FROM ${table} WHERE storage_repository_id = ? AND storage_workspace_id = ?`)
      .run(scope.repository.storageRepositoryId, architectureLedgerWorkspaceKey(scope.worktree));
  }
}

function insertArchitectureLedgerFts(db: SqliteDatabase, kind: string, summary: string, rationale: string, title: string, evidenceSummary: string): void {
  db.prepare(
    "INSERT INTO architecture_ledger_fts(kind, summary, rationale, title, evidence_summary) VALUES (?, ?, ?, ?, ?)"
  ).run(kind, summary, rationale, title, evidenceSummary);
}

function insertArchitectureLedgerSearchDoc(db: SqliteDatabase, event: ArchitectureEventV1, doc: {
  docId: string;
  targetKind: ArchitectureBookFtsMatch["targetKind"];
  targetId: string;
  subjectId?: string;
  title?: string;
  summary?: string;
  rationale?: string;
  evidenceSummary?: string;
}): void {
  const workspaceKey = architectureLedgerWorkspaceKey(event.worktree);
  db.prepare(
    `DELETE FROM architecture_ledger_search_fts
      WHERE storage_repository_id = ? AND storage_workspace_id = ? AND doc_id = ?`
  ).run(event.repository.storageRepositoryId, workspaceKey, doc.docId);
  db.prepare(
    `INSERT INTO architecture_ledger_search_fts
      (doc_id, storage_repository_id, storage_workspace_id, target_kind, target_id, subject_id, title, summary, rationale, evidence_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    doc.docId,
    event.repository.storageRepositoryId,
    workspaceKey,
    doc.targetKind,
    doc.targetId,
    doc.subjectId ?? null,
    doc.title ?? "",
    doc.summary ?? "",
    doc.rationale ?? "",
    doc.evidenceSummary ?? ""
  );
}

function deleteArchitectureLedgerSearchDocs(db: SqliteDatabase, scope: ArchitectureLedgerScope, ids: string[]): void {
  for (const id of ids) {
    db.prepare(
      `DELETE FROM architecture_ledger_search_fts
        WHERE storage_repository_id = ? AND storage_workspace_id = ? AND (target_id = ? OR subject_id = ?)`
    ).run(scope.repository.storageRepositoryId, architectureLedgerWorkspaceKey(scope.worktree), id, id);
  }
}

function queryArchitectureLedgerSearchFts(db: SqliteDatabase, input: ArchitectureLedgerScope & { query: string; maxItems?: number }): ArchitectureBookFtsMatch[] {
  const matchQuery = sqliteFtsQuery(input.query);
  if (!matchQuery) return [];
  const limit = Math.max(1, Math.min(50, Math.floor(input.maxItems ?? 12)));
  const rows = db.prepare(
    `SELECT target_kind, target_id, subject_id, title, summary, rationale, evidence_summary,
        bm25(architecture_ledger_search_fts) AS rank
      FROM architecture_ledger_search_fts
      WHERE storage_repository_id = ? AND storage_workspace_id = ?
        AND architecture_ledger_search_fts MATCH ?
      ORDER BY rank, target_kind, target_id
      LIMIT ?`
  ).all(input.repository.storageRepositoryId, architectureLedgerWorkspaceKey(input.worktree), matchQuery, limit);
  return rows.map((row): ArchitectureBookFtsMatch => {
    const title = String(row.title ?? "");
    const summary = String(row.summary ?? "");
    const rationale = String(row.rationale ?? "");
    const evidenceSummary = String(row.evidence_summary ?? "");
    return {
      targetKind: String(row.target_kind) as ArchitectureBookFtsMatch["targetKind"],
      targetId: String(row.target_id),
      ...(row.subject_id ? { subjectId: String(row.subject_id) } : {}),
      ...(title ? { title } : {}),
      ...(summary ? { summary } : {}),
      matchKind: ftsMatchKind(input.query, { title, summary, rationale, evidenceSummary }),
      score: ftsRankScore(Number(row.rank ?? 0)),
      reasonCodes: ["sqlite-fts-match"]
    };
  });
}

function sqliteFtsQuery(query: string): string {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 8)
    .map((token) => `"${token.replaceAll("\"", "\"\"")}"`)
    .join(" OR ");
}

function ftsRankScore(rank: number): number {
  if (!Number.isFinite(rank)) return 1;
  return Math.max(1, Math.min(10, Math.round(10 - Math.min(Math.abs(rank), 9))));
}

function ftsMatchKind(query: string, doc: { title: string; summary: string; rationale: string; evidenceSummary: string }): ArchitectureBookFtsMatchKind {
  const tokens = sqliteFtsQuery(query).replaceAll("\"", "").split(/\s+OR\s+/).filter(Boolean);
  const matches = new Set<ArchitectureBookFtsMatchKind>();
  for (const token of tokens) {
    if (doc.title.toLowerCase().includes(token)) matches.add("title");
    if (doc.summary.toLowerCase().includes(token)) matches.add("summary");
    if (doc.rationale.toLowerCase().includes(token)) matches.add("rationale");
    if (doc.evidenceSummary.toLowerCase().includes(token)) matches.add("evidence-summary");
  }
  return matches.size === 1 ? [...matches][0]! : "mixed";
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
    architectureLedgerWorkspaceKey(input.scope.worktree),
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
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of migration.statements) db.exec(statement);
      db.prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, nowIso());
      db.exec("COMMIT");
      applied.add(migration.id);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

function backfillArchitectureEventDirectScope(db: SqliteDatabase): void {
  const columns = new Set(db.prepare("PRAGMA table_info(architecture_events)").all().map((row) => String(row.name)));
  if (!columns.has("source_storage_workspace_id") || !columns.has("scope_event_count")) return;
  const missing = db.prepare(
    "SELECT 1 AS missing FROM architecture_events WHERE source_storage_workspace_id IS NULL OR scope_event_count IS NULL LIMIT 1"
  ).get();
  if (!missing) return;
  const rows = db.prepare("SELECT * FROM architecture_events ORDER BY event_sequence ASC").all();
  const countsByScope = new Map<string, number>();
  let transactionOpen = false;
  let pending = 0;
  try {
    for (const row of rows) {
      const event = JSON.parse(String(row.event_json)) as ArchitectureEventV1;
      validateArchitectureLedgerEvent(event);
      if (
        !event.eventHash
        || architectureEventHash(event) !== event.eventHash
        || String(row.event_hash) !== event.eventHash
        || String(row.event_id) !== architectureLedgerStorageId(event.worktree, event.eventId)
        || String(row.storage_repository_id) !== event.repository.storageRepositoryId
        || String(row.workspace_id) !== event.worktree.workspaceId
        || String(row.storage_workspace_id) !== architectureLedgerWorkspaceKey(event.worktree)
      ) {
        throw new Error(`architecture-event-direct-scope-backfill-authority-mismatch: ${event.eventId}`);
      }
      const scopeKey = `${event.repository.storageRepositoryId}\0${architectureLedgerWorkspaceKey(event.worktree)}`;
      const scopeEventCount = (countsByScope.get(scopeKey) ?? 0) + 1;
      countsByScope.set(scopeKey, scopeEventCount);
      if (
        String(row.source_storage_workspace_id ?? "") === event.worktree.storageWorkspaceId
        && Number(row.scope_event_count) === scopeEventCount
      ) continue;
      if (!transactionOpen) {
        db.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
      }
      db.prepare("UPDATE architecture_events SET source_storage_workspace_id = ?, scope_event_count = ? WHERE event_sequence = ?")
        .run(event.worktree.storageWorkspaceId, scopeEventCount, Number(row.event_sequence));
      pending += 1;
      if (pending >= 500) {
        db.exec("COMMIT");
        transactionOpen = false;
        pending = 0;
      }
    }
    if (transactionOpen) db.exec("COMMIT");
  } catch (error) {
    if (transactionOpen) db.exec("ROLLBACK");
    throw error;
  }
}

function backfillArchitectureChangeFeed(db: SqliteDatabase): void {
  const required = ["architecture_events", "architecture_event_subjects", "architecture_change_feed", "architecture_change_feed_backfill_state"];
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row.name)));
  if (!required.every((table) => tables.has(table))) return;
  const missingCount = Number(db.prepare(
    `SELECT COUNT(*) AS count FROM architecture_events
      LEFT JOIN architecture_change_feed ON architecture_change_feed.event_id = architecture_events.event_id
      WHERE architecture_change_feed.event_id IS NULL`
  ).get()?.count ?? 0);
  const marker = db.prepare("SELECT * FROM architecture_change_feed_backfill_state WHERE state_id = 'v1'").get();
  if (missingCount === 0 && marker && architectureChangeFeedBackfillMarkerMatches(db, marker)) return;
  const rows = db.prepare("SELECT * FROM architecture_events ORDER BY event_sequence ASC").all();
  if (rows.length === 0) {
    persistArchitectureChangeFeedBackfillMarker(db, []);
    return;
  }
  const states = new Map<string, {
    scope: ArchitectureLedgerScope;
    graphDigest: string;
    relations: Map<string, ArchitectureLedgerRelationRecord>;
    constraints: Map<string, ArchitectureLedgerConstraintRecord>;
    evidence: EvidenceStateAtCursorV1;
    previousEventHash: string | null;
  }>();
  let transactionOpen = false;
  let pendingInBatch = 0;
  let previousGlobalSequence = 0;
  try {
    for (const row of rows) {
      const event = JSON.parse(String(row.event_json)) as ArchitectureEventV1;
      validateArchitectureLedgerEvent(event);
      const scopeKey = `${event.repository.storageRepositoryId}:${architectureLedgerWorkspaceKey(event.worktree)}`;
      const state = states.get(scopeKey) ?? {
        scope: { repository: event.repository, worktree: event.worktree },
        graphDigest: architectureLedgerStateDigest(emptyArchitectureLedgerState()),
        relations: new Map<string, ArchitectureLedgerRelationRecord>(),
        constraints: new Map<string, ArchitectureLedgerConstraintRecord>(),
        evidence: emptyArchitectureLedgerEvidenceState(),
        previousEventHash: null
      };
      const eventSequence = assertArchitectureChangeFeedBackfillEventRow(row, event, state.previousEventHash, previousGlobalSequence);
      previousGlobalSequence = eventSequence;
      const payload = architectureLedgerPayload(event);
      const beforeGraph = architectureChangeFeedBackfillReferenceState(state, payload);
      const evidenceBefore = state.evidence;
      const evidenceAfter = applyArchitectureLedgerEvidenceEvent(evidenceBefore, event);
      const graphBeforeDigest = state.graphDigest;
      let graphAfterDigest = graphBeforeDigest;
      if ((payload.operations?.length ?? 0) > 0) {
        if (event.baseDigest !== graphBeforeDigest) {
          throw new Error(`architecture-change-feed-backfill-base-digest-mismatch: ${event.eventId}`);
        }
        graphAfterDigest = event.resultingDigest;
      }
      const existing = db.prepare("SELECT feed_sequence FROM architecture_change_feed WHERE event_id = ?")
        .get(architectureLedgerStorageId(event.worktree, event.eventId));
      if (!existing) {
        if (!transactionOpen) {
          db.exec("BEGIN IMMEDIATE");
          transactionOpen = true;
        }
        appendArchitectureChangeFeed(db, {
          event,
          eventSequence,
          affectedSubjects: architectureAffectedSubjects(event, beforeGraph, evidenceBefore, evidenceAfter),
          graphBeforeDigest,
          graphAfterDigest,
          evidenceBeforeDigest: evidenceBefore.stateDigest,
          evidenceAfterDigest: evidenceAfter.stateDigest
        });
        pendingInBatch += 1;
        if (pendingInBatch >= 500) {
          db.exec("COMMIT");
          transactionOpen = false;
          pendingInBatch = 0;
        }
      }
      applyArchitectureChangeFeedBackfillGraphReferences(state, payload);
      state.graphDigest = graphAfterDigest;
      state.evidence = evidenceAfter;
      state.previousEventHash = event.eventHash!;
      states.set(scopeKey, state);
    }
    if (transactionOpen) {
      db.exec("COMMIT");
      transactionOpen = false;
    }
    for (const state of states.values()) {
      const materializedGraphDigest = architectureLedgerStateDigest(readArchitectureLedgerStateFromDb(db, state.scope));
      if (materializedGraphDigest !== state.graphDigest) throw new Error("architecture-change-feed-backfill-materialized-graph-mismatch");
      const materializedEvidenceDigest = readArchitectureLedgerEvidenceStateFromDb(db, state.scope).stateDigest;
      if (materializedEvidenceDigest !== state.evidence.stateDigest) throw new Error("architecture-change-feed-backfill-materialized-evidence-mismatch");
    }
    persistArchitectureChangeFeedBackfillMarker(db, rows);
  } catch (error) {
    if (transactionOpen) db.exec("ROLLBACK");
    throw error;
  }
}

function architectureChangeFeedBackfillMarkerMatches(db: SqliteDatabase, marker: Record<string, unknown>): boolean {
  const eventCount = Number(marker.event_count);
  const lastEventSequence = Number(marker.last_event_sequence);
  if (!Number.isSafeInteger(eventCount) || !Number.isSafeInteger(lastEventSequence) || eventCount < 0 || lastEventSequence < 0) return false;
  const current = db.prepare("SELECT COUNT(*) AS count, COALESCE(MAX(event_sequence), 0) AS last_event_sequence FROM architecture_events").get();
  const currentCount = Number(current?.count ?? 0);
  const currentLastSequence = Number(current?.last_event_sequence ?? 0);
  if (eventCount > currentCount || lastEventSequence > currentLastSequence) return false;
  if (lastEventSequence === 0) return eventCount === 0 && marker.last_event_hash === null;
  const event = db.prepare("SELECT event_hash FROM architecture_events WHERE event_sequence = ?").get(lastEventSequence);
  return Boolean(event) && String(event!.event_hash) === String(marker.last_event_hash);
}

function persistArchitectureChangeFeedBackfillMarker(db: SqliteDatabase, rows: Array<Record<string, unknown>>): void {
  const last = rows.at(-1);
  db.prepare(
    `INSERT OR REPLACE INTO architecture_change_feed_backfill_state
      (state_id, event_count, last_event_sequence, last_event_hash, completed_at)
      VALUES ('v1', ?, ?, ?, ?)`
  ).run(rows.length, Number(last?.event_sequence ?? 0), last ? String(last.event_hash) : null, nowIso());
}

function assertArchitectureChangeFeedBackfillEventRow(
  row: Record<string, unknown>,
  event: ArchitectureEventV1,
  expectedPreviousEventHash: string | null,
  previousGlobalSequence: number
): number {
  const eventSequence = Number(row.event_sequence);
  if (!Number.isSafeInteger(eventSequence) || eventSequence <= previousGlobalSequence) throw new Error("architecture-change-feed-backfill-sequence-invalid");
  const expectedStorageEventId = architectureLedgerStorageId(event.worktree, event.eventId);
  const pairs: Array<[unknown, unknown, string]> = [
    [row.event_id, expectedStorageEventId, "event-id"],
    [row.repository_id, event.repository.repositoryId, "repository-id"],
    [row.storage_repository_id, event.repository.storageRepositoryId, "storage-repository-id"],
    [row.workspace_id, event.worktree.workspaceId, "workspace-id"],
    [row.storage_workspace_id, architectureLedgerWorkspaceKey(event.worktree), "storage-workspace-id"],
    [row.branch, event.worktree.branch, "branch"],
    [row.head_sha, event.worktree.headSha, "head-sha"],
    [row.worktree_digest, event.worktree.worktreeDigest, "worktree-digest"],
    [row.event_type, event.eventType, "event-type"],
    [row.payload_version, event.payloadVersion, "payload-version"],
    [row.source, event.source, "source"],
    [row.actor_kind, event.actor.kind, "actor-kind"],
    [row.actor_id, event.actor.id, "actor-id"],
    [row.base_digest, event.baseDigest, "base-digest"],
    [row.resulting_digest, event.resultingDigest, "resulting-digest"],
    [row.previous_event_hash ?? null, expectedPreviousEventHash, "previous-event-hash"],
    [event.previousEventHash ?? null, expectedPreviousEventHash, "embedded-previous-event-hash"],
    [row.event_hash, event.eventHash, "event-hash"],
    [row.idempotency_key, event.idempotencyKey, "idempotency-key"],
    [row.created_at, event.timestamp, "created-at"],
    [String(row.payload_json), stableJson(event.payload), "payload-json"],
    [String(row.provenance_json), stableJson(event.provenance), "provenance-json"]
  ];
  for (const [actual, expected, label] of pairs) {
    if (actual !== expected) throw new Error(`architecture-change-feed-backfill-${label}-mismatch: ${event.eventId}`);
  }
  if (!event.eventHash || architectureEventHash(event) !== event.eventHash) {
    throw new Error(`architecture-change-feed-backfill-event-hash-invalid: ${event.eventId}`);
  }
  return eventSequence;
}

function architectureChangeFeedBackfillReferenceState(
  state: { relations: Map<string, ArchitectureLedgerRelationRecord>; constraints: Map<string, ArchitectureLedgerConstraintRecord> },
  payload: ArchitectureLedgerEventPayload
): ArchitectureLedgerGraphState {
  const relationIds = new Set<string>();
  const constraintIds = new Set<string>();
  for (const operation of payload.operations ?? []) {
    if (operation.op === "upsert_relation") relationIds.add(operation.relation.relationId);
    if (operation.op === "delete_relation") relationIds.add(operation.relationId);
    if (operation.op === "upsert_constraint") constraintIds.add(operation.constraint.constraintId);
    if (operation.op === "delete_constraint") constraintIds.add(operation.constraintId);
    if (operation.op === "delete_entity") {
      for (const relation of state.relations.values()) {
        if (relation.sourceEntityId === operation.entityId || relation.targetEntityId === operation.entityId) relationIds.add(relation.relationId);
      }
    }
  }
  return {
    entities: [],
    relations: [...relationIds].flatMap((id) => state.relations.get(id) ? [state.relations.get(id)!] : []),
    constraints: [...constraintIds].flatMap((id) => state.constraints.get(id) ? [state.constraints.get(id)!] : [])
  };
}

function applyArchitectureChangeFeedBackfillGraphReferences(
  state: { relations: Map<string, ArchitectureLedgerRelationRecord>; constraints: Map<string, ArchitectureLedgerConstraintRecord> },
  payload: ArchitectureLedgerEventPayload
): void {
  for (const operation of payload.operations ?? []) {
    if (operation.op === "upsert_relation") state.relations.set(operation.relation.relationId, operation.relation);
    else if (operation.op === "delete_relation") state.relations.delete(operation.relationId);
    else if (operation.op === "upsert_constraint") state.constraints.set(operation.constraint.constraintId, operation.constraint);
    else if (operation.op === "delete_constraint") state.constraints.delete(operation.constraintId);
    else if (operation.op === "delete_entity") {
      for (const [relationId, relation] of state.relations) {
        if (relation.sourceEntityId === operation.entityId || relation.targetEntityId === operation.entityId) state.relations.delete(relationId);
      }
    }
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

function assertUpgradeableLocalStoreTarget(path: string): void {
  const db = openSqliteDatabaseSync(path);
  try {
    const integrity = sqliteIntegrityCheckOpenDatabase(db, path);
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row.name)));
    const hasArchContextMarker = ["schema_migrations", "task_states", "repository_sessions", "snapshots"].some((table) => tables.has(table));
    if (!hasArchContextMarker) {
      throw new Error(`SQLite target is not an ArchContext local store candidate: ${path}`);
    }
    if (integrity !== "ok") throw new Error(`SQLite integrity_check failed for ${path}: ${integrity}`);
  } finally {
    db.close();
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
    backfillArchitectureEventDirectScope(db);
    backfillArchitectureChangeFeed(db);
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
  runMetadata?: Json;
}): AgentJobV1 {
  const next: AgentJobV1 = {
    ...job,
    status: patch.status,
    updatedAt: patch.updatedAt
  };
  if (patch.outputDigest) next.outputDigest = patch.outputDigest;
  if (patch.runMetadata) {
    next.extensions = {
      ...(next.extensions ?? {}),
      agentRun: patch.runMetadata
    };
  }
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
  if (architectureLedger === undefined) return undefined;
  if (!isJsonRecord(architectureLedger)) throw new Error("changeset-ledger-recovery-metadata-malformed");
  const plannedEvent = architectureLedger.plannedEvent;
  if (plannedEvent === undefined) return undefined;
  if (!isJsonRecord(plannedEvent)) throw new Error("changeset-ledger-recovery-planned-event-malformed");
  const event = plannedEvent as unknown as ArchitectureEventV1;
  try {
    validateArchitectureLedgerEvent(event);
  } catch (error) {
    throw new Error(`changeset-ledger-recovery-planned-event-invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  return event;
}

function isJsonRecord(value: unknown): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recoverJournalFiles(root: string, files: ChangeSetJournalFile[]): void {
  for (const file of [...files].reverse()) {
    const absolute = resolve(root, file.path);
    if (file.tempPath) rmSync(file.tempPath, { recursive: true, force: true });
    if (file.existed) {
      if (file.backupPath && existsSync(file.backupPath)) {
        rmSync(absolute, { recursive: true, force: true });
        renameSync(file.backupPath, absolute);
      }
    } else {
      rmSync(absolute, { recursive: true, force: true });
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
