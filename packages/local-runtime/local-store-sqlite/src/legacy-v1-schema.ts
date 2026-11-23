/**
 * Exact closed-set SQLite DDL fingerprints for proven legacy ArchContext v1 stores
 * (v0.17.1 migrations 0001..0020 and standalone legacy architecture_debt_base_cache).
 */

export const LEGACY_V1_CORE_TABLE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  "observed_evidence": [
    "id|TEXT|0|1",
    "repository_id|TEXT|1|0",
    "head_sha|TEXT|1|0",
    "selector_json|TEXT|1|0",
    "summary|TEXT|1|0",
    "confidence|TEXT|1|0",
    "created_at|TEXT|1|0"
  ],
  "repository_sessions": [
    "repository_id|TEXT|0|1",
    "root|TEXT|1|0",
    "head_sha|TEXT|1|0",
    "worktree_digest|TEXT|1|0",
    "updated_at|TEXT|1|0"
  ],
  "review_results": [
    "review_id|TEXT|0|1",
    "task_session_id|TEXT|1|0",
    "payload_json|TEXT|1|0",
    "created_at|TEXT|1|0"
  ],
  "schema_migrations": [
    "id|TEXT|0|1",
    "applied_at|TEXT|1|0"
  ],
  "snapshots": [
    "id|TEXT|0|1",
    "repository_id|TEXT|1|0",
    "head_sha|TEXT|1|0",
    "worktree_digest|TEXT|1|0",
    "state|TEXT|1|0",
    "created_at|TEXT|1|0",
    "committed_at|TEXT|0|0"
  ],
  "task_states": [
    "task_session_id|TEXT|0|1",
    "payload_json|TEXT|1|0",
    "updated_at|TEXT|1|0"
  ]
};

export const LEGACY_V1_DEBT_CACHE_COLUMNS: readonly string[] = [
  "repository_id|TEXT|1|1",
  "base_sha|TEXT|1|2",
  "archcontext_tree_oid|TEXT|1|3",
  "codegraph_version|TEXT|1|4",
  "engine_version|TEXT|1|5",
  "measurement_profile|TEXT|1|6",
  "report_json|TEXT|1|0"
];

export const KNOWN_LEGACY_V1_MIGRATION_IDS: ReadonlySet<string> = new Set([
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
  "0017_explorer_cache_lifecycle",
  "0018_immutable_evidence_checkpoints",
  "0019_projection_apply_receipts",
  "0020_projection_apply_recovery_proof"
]);

export const KNOWN_LEGACY_V1_TABLE_COLUMNS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  "agent_jobs": [
    [
      "job_id|TEXT|0|1",
      "repository_id|TEXT|1|0",
      "storage_repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "event_id|TEXT|1|0",
      "status|TEXT|1|0",
      "runner_port|TEXT|1|0",
      "fingerprint|TEXT|1|0",
      "input_digest|TEXT|1|0",
      "output_digest|TEXT|0|0",
      "stale_policy|TEXT|1|0",
      "job_json|TEXT|1|0",
      "queued_at|TEXT|1|0",
      "updated_at|TEXT|1|0"
    ]
  ],
  "architecture_change_feed": [
    [
      "feed_sequence|INTEGER|0|1",
      "storage_repository_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "event_sequence|INTEGER|1|0",
      "event_id|TEXT|1|0",
      "logical_event_id|TEXT|1|0",
      "event_hash|TEXT|1|0",
      "title|TEXT|0|0",
      "rationale|TEXT|0|0",
      "subjects_digest|TEXT|1|0",
      "graph_before_digest|TEXT|1|0",
      "graph_after_digest|TEXT|1|0",
      "evidence_before_digest|TEXT|1|0",
      "evidence_after_digest|TEXT|1|0",
      "committed_at|TEXT|1|0"
    ]
  ],
  "architecture_change_feed_backfill_state": [
    [
      "state_id|TEXT|0|1",
      "event_count|INTEGER|1|0",
      "last_event_sequence|INTEGER|1|0",
      "last_event_hash|TEXT|0|0",
      "completed_at|TEXT|1|0"
    ]
  ],
  "architecture_change_feed_consumers": [
    [
      "consumer_id|TEXT|1|1",
      "storage_repository_id|TEXT|1|2",
      "storage_workspace_id|TEXT|1|3",
      "feed_sequence|INTEGER|1|0",
      "delivered_sequence|INTEGER|1|0",
      "updated_at|TEXT|1|0"
    ]
  ],
  "architecture_constraints_current": [
    [
      "storage_repository_id|TEXT|1|1",
      "storage_workspace_id|TEXT|1|2",
      "constraint_id|TEXT|1|3",
      "repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "branch|TEXT|1|0",
      "head_sha|TEXT|1|0",
      "worktree_digest|TEXT|1|0",
      "kind|TEXT|1|0",
      "subject_id|TEXT|1|0",
      "status|TEXT|1|0",
      "severity|TEXT|0|0",
      "summary|TEXT|0|0",
      "metadata_json|TEXT|1|0",
      "last_event_id|TEXT|1|0",
      "updated_at|TEXT|1|0"
    ]
  ],
  "architecture_debt_base_cache": [
    [
      "repository_id|TEXT|1|1",
      "base_sha|TEXT|1|2",
      "archcontext_tree_oid|TEXT|1|3",
      "codegraph_version|TEXT|1|4",
      "engine_version|TEXT|1|5",
      "measurement_profile|TEXT|1|6",
      "report_json|TEXT|1|0"
    ]
  ],
  "architecture_entities_current": [
    [
      "storage_repository_id|TEXT|1|1",
      "storage_workspace_id|TEXT|1|2",
      "entity_id|TEXT|1|3",
      "repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "branch|TEXT|1|0",
      "head_sha|TEXT|1|0",
      "worktree_digest|TEXT|1|0",
      "kind|TEXT|1|0",
      "canonical_name|TEXT|1|0",
      "status|TEXT|1|0",
      "path|TEXT|0|0",
      "summary|TEXT|0|0",
      "metadata_json|TEXT|1|0",
      "last_event_id|TEXT|1|0",
      "updated_at|TEXT|1|0"
    ]
  ],
  "architecture_event_subjects": [
    [
      "storage_repository_id|TEXT|1|1",
      "storage_workspace_id|TEXT|1|2",
      "event_sequence|INTEGER|1|3",
      "event_id|TEXT|1|0",
      "logical_event_id|TEXT|1|0",
      "authority_class|TEXT|1|4",
      "subject_kind|TEXT|1|5",
      "subject_id|TEXT|1|6",
      "operation|TEXT|1|7",
      "created_at|TEXT|1|0"
    ]
  ],
  "architecture_events": [
    [
      "event_sequence|INTEGER|0|1",
      "event_id|TEXT|1|0",
      "repository_id|TEXT|1|0",
      "storage_repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "branch|TEXT|1|0",
      "head_sha|TEXT|1|0",
      "worktree_digest|TEXT|1|0",
      "event_type|TEXT|1|0",
      "payload_version|TEXT|1|0",
      "source|TEXT|1|0",
      "actor_kind|TEXT|1|0",
      "actor_id|TEXT|1|0",
      "base_digest|TEXT|1|0",
      "resulting_digest|TEXT|1|0",
      "previous_event_hash|TEXT|0|0",
      "event_hash|TEXT|1|0",
      "idempotency_key|TEXT|1|0",
      "payload_json|TEXT|1|0",
      "provenance_json|TEXT|1|0",
      "event_json|TEXT|1|0",
      "created_at|TEXT|1|0",
      "compacted_by_snapshot_id|TEXT|0|0"
    ],
    [
      "event_sequence|INTEGER|0|1",
      "event_id|TEXT|1|0",
      "repository_id|TEXT|1|0",
      "storage_repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "branch|TEXT|1|0",
      "head_sha|TEXT|1|0",
      "worktree_digest|TEXT|1|0",
      "event_type|TEXT|1|0",
      "payload_version|TEXT|1|0",
      "source|TEXT|1|0",
      "actor_kind|TEXT|1|0",
      "actor_id|TEXT|1|0",
      "base_digest|TEXT|1|0",
      "resulting_digest|TEXT|1|0",
      "previous_event_hash|TEXT|0|0",
      "event_hash|TEXT|1|0",
      "idempotency_key|TEXT|1|0",
      "payload_json|TEXT|1|0",
      "provenance_json|TEXT|1|0",
      "event_json|TEXT|1|0",
      "created_at|TEXT|1|0",
      "compacted_by_snapshot_id|TEXT|0|0",
      "source_storage_workspace_id|TEXT|0|0",
      "scope_event_count|INTEGER|0|0"
    ]
  ],
  "architecture_evidence_state_checkpoints": [
    [
      "storage_repository_id|TEXT|1|1",
      "storage_workspace_id|TEXT|1|2",
      "event_id|TEXT|1|0",
      "event_hash|TEXT|1|0",
      "evidence_state_digest|TEXT|1|0",
      "updated_at|TEXT|1|0"
    ],
    [
      "storage_repository_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "event_id|TEXT|0|1",
      "event_sequence|INTEGER|1|0",
      "scope_event_count|INTEGER|1|0",
      "event_hash|TEXT|1|0",
      "evidence_state_digest|TEXT|1|0",
      "updated_at|TEXT|1|0"
    ]
  ],
  "architecture_ledger_fts": [
    [
      "kind||0|0",
      "summary||0|0",
      "rationale||0|0",
      "title||0|0",
      "evidence_summary||0|0"
    ]
  ],
  "architecture_ledger_fts_config": [
    [
      "k||1|1",
      "v||0|0"
    ]
  ],
  "architecture_ledger_fts_data": [
    [
      "id|INTEGER|0|1",
      "block|BLOB|0|0"
    ]
  ],
  "architecture_ledger_fts_docsize": [
    [
      "id|INTEGER|0|1",
      "sz|BLOB|0|0"
    ]
  ],
  "architecture_ledger_fts_idx": [
    [
      "segid||1|1",
      "term||1|2",
      "pgno||0|0"
    ]
  ],
  "architecture_ledger_operations": [
    [
      "operation_id|TEXT|0|1",
      "storage_repository_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "operation_kind|TEXT|1|0",
      "duration_ms|INTEGER|1|0",
      "row_count|INTEGER|1|0",
      "rebuild_reason|TEXT|0|0",
      "created_at|TEXT|1|0"
    ]
  ],
  "architecture_ledger_search_fts": [
    [
      "doc_id||0|0",
      "storage_repository_id||0|0",
      "storage_workspace_id||0|0",
      "target_kind||0|0",
      "target_id||0|0",
      "subject_id||0|0",
      "title||0|0",
      "summary||0|0",
      "rationale||0|0",
      "evidence_summary||0|0"
    ]
  ],
  "architecture_ledger_search_fts_config": [
    [
      "k||1|1",
      "v||0|0"
    ]
  ],
  "architecture_ledger_search_fts_content": [
    [
      "id|INTEGER|0|1",
      "c0||0|0",
      "c1||0|0",
      "c2||0|0",
      "c3||0|0",
      "c4||0|0",
      "c5||0|0",
      "c6||0|0",
      "c7||0|0",
      "c8||0|0",
      "c9||0|0"
    ]
  ],
  "architecture_ledger_search_fts_data": [
    [
      "id|INTEGER|0|1",
      "block|BLOB|0|0"
    ]
  ],
  "architecture_ledger_search_fts_docsize": [
    [
      "id|INTEGER|0|1",
      "sz|BLOB|0|0"
    ]
  ],
  "architecture_ledger_search_fts_idx": [
    [
      "segid||1|1",
      "term||1|2",
      "pgno||0|0"
    ]
  ],
  "architecture_relations_current": [
    [
      "storage_repository_id|TEXT|1|1",
      "storage_workspace_id|TEXT|1|2",
      "relation_id|TEXT|1|3",
      "repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "branch|TEXT|1|0",
      "head_sha|TEXT|1|0",
      "worktree_digest|TEXT|1|0",
      "kind|TEXT|1|0",
      "source_entity_id|TEXT|1|0",
      "target_entity_id|TEXT|1|0",
      "status|TEXT|1|0",
      "summary|TEXT|0|0",
      "metadata_json|TEXT|1|0",
      "last_event_id|TEXT|1|0",
      "updated_at|TEXT|1|0"
    ]
  ],
  "architecture_snapshots": [
    [
      "snapshot_id|TEXT|0|1",
      "repository_id|TEXT|1|0",
      "storage_repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "branch|TEXT|1|0",
      "head_sha|TEXT|1|0",
      "worktree_digest|TEXT|1|0",
      "source_mode|TEXT|1|0",
      "last_event_id|TEXT|1|0",
      "last_event_hash|TEXT|1|0",
      "graph_digest|TEXT|1|0",
      "projection_digest|TEXT|1|0",
      "entity_count|INTEGER|1|0",
      "relation_count|INTEGER|1|0",
      "constraint_count|INTEGER|1|0",
      "input_digests_json|TEXT|1|0",
      "snapshot_json|TEXT|1|0",
      "created_at|TEXT|1|0"
    ],
    [
      "snapshot_id|TEXT|0|1",
      "repository_id|TEXT|1|0",
      "storage_repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "branch|TEXT|1|0",
      "head_sha|TEXT|1|0",
      "worktree_digest|TEXT|1|0",
      "source_mode|TEXT|1|0",
      "last_event_id|TEXT|1|0",
      "last_event_hash|TEXT|1|0",
      "graph_digest|TEXT|1|0",
      "projection_digest|TEXT|1|0",
      "entity_count|INTEGER|1|0",
      "relation_count|INTEGER|1|0",
      "constraint_count|INTEGER|1|0",
      "input_digests_json|TEXT|1|0",
      "snapshot_json|TEXT|1|0",
      "created_at|TEXT|1|0",
      "snapshot_schema_version|TEXT|0|0",
      "last_event_sequence|INTEGER|0|0",
      "evidence_digest|TEXT|0|0",
      "state_digest|TEXT|0|0"
    ]
  ],
  "audit_runs": [
    [
      "run_id|TEXT|0|1",
      "repository_id|TEXT|1|0",
      "storage_repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "event_id|TEXT|1|0",
      "job_id|TEXT|1|0",
      "report_id|TEXT|1|0",
      "status|TEXT|1|0",
      "repo_name_with_owner|TEXT|1|0",
      "repo_visibility|TEXT|1|0",
      "base_sha|TEXT|1|0",
      "input_digest|TEXT|1|0",
      "output_digest|TEXT|1|0",
      "run_json|TEXT|1|0",
      "created_at|TEXT|1|0"
    ]
  ],
  "changeset_journal": [
    [
      "journal_id|TEXT|0|1",
      "changeset_id|TEXT|1|0",
      "root|TEXT|1|0",
      "status|TEXT|1|0",
      "metadata_json|TEXT|1|0",
      "files_json|TEXT|1|0",
      "created_at|TEXT|1|0",
      "updated_at|TEXT|1|0",
      "completed_at|TEXT|0|0"
    ],
    [
      "journal_id|TEXT|0|1",
      "changeset_id|TEXT|1|0",
      "root|TEXT|1|0",
      "status|TEXT|1|0",
      "metadata_json|TEXT|1|0",
      "files_json|TEXT|1|0",
      "created_at|TEXT|1|0",
      "updated_at|TEXT|1|0",
      "completed_at|TEXT|0|0",
      "cleanup_completed_at|TEXT|0|0"
    ]
  ],
  "cross_repo_edges": [
    [
      "id|TEXT|0|1",
      "landscape_id|TEXT|1|0",
      "from_repository_id|TEXT|1|0",
      "from_node_id|TEXT|1|0",
      "to_repository_id|TEXT|1|0",
      "to_node_id|TEXT|1|0",
      "via_kind|TEXT|1|0",
      "via_id|TEXT|1|0",
      "metadata_json|TEXT|1|0",
      "updated_at|TEXT|1|0"
    ]
  ],
  "evidence_bindings": [
    [
      "binding_id|TEXT|0|1",
      "evidence_id|TEXT|1|0",
      "repository_id|TEXT|1|0",
      "storage_repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "event_id|TEXT|1|0",
      "target_kind|TEXT|1|0",
      "target_id|TEXT|1|0",
      "binding_reason|TEXT|1|0",
      "authority_effect|TEXT|1|0",
      "provenance_json|TEXT|1|0",
      "binding_json|TEXT|1|0",
      "created_at|TEXT|1|0"
    ]
  ],
  "evidence_items": [
    [
      "evidence_id|TEXT|0|1",
      "repository_id|TEXT|1|0",
      "storage_repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "event_id|TEXT|1|0",
      "kind|TEXT|1|0",
      "strength|TEXT|1|0",
      "polarity|TEXT|1|0",
      "origin|TEXT|1|0",
      "subject|TEXT|1|0",
      "selector_json|TEXT|1|0",
      "summary|TEXT|1|0",
      "coverage_json|TEXT|1|0",
      "supports_json|TEXT|1|0",
      "provenance_json|TEXT|1|0",
      "evidence_json|TEXT|1|0",
      "digest|TEXT|1|0",
      "created_at|TEXT|1|0"
    ]
  ],
  "evidence_tombstones": [
    [
      "storage_repository_id|TEXT|1|1",
      "storage_workspace_id|TEXT|1|2",
      "target_kind|TEXT|1|3",
      "target_id|TEXT|1|4",
      "previous_digest|TEXT|1|0",
      "reason_code|TEXT|1|0",
      "removed_by_event_id|TEXT|1|0",
      "removed_at|TEXT|1|0"
    ]
  ],
  "explorer_occurrence_dependencies": [
    [
      "storage_repository_id|TEXT|1|1",
      "storage_workspace_id|TEXT|1|2",
      "projection_digest|TEXT|1|3",
      "occurrence_id|TEXT|1|4",
      "dependency_key|TEXT|1|5"
    ]
  ],
  "explorer_projection_cache": [
    [
      "projection_digest|TEXT|0|1",
      "storage_repository_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "view_id|TEXT|1|0",
      "graph_digest|TEXT|1|0",
      "observed_facts_digest|TEXT|1|0",
      "view_definition_digest|TEXT|1|0",
      "compiler_version|TEXT|1|0",
      "projection_json|TEXT|1|0",
      "created_at|TEXT|1|0"
    ],
    [
      "projection_digest|TEXT|0|1",
      "storage_repository_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "view_id|TEXT|1|0",
      "graph_digest|TEXT|1|0",
      "observed_facts_digest|TEXT|1|0",
      "view_definition_digest|TEXT|1|0",
      "compiler_version|TEXT|1|0",
      "projection_json|TEXT|1|0",
      "created_at|TEXT|1|0",
      "invalidated_at|TEXT|0|0"
    ],
    [
      "projection_digest|TEXT|0|1",
      "storage_repository_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "view_id|TEXT|1|0",
      "graph_digest|TEXT|1|0",
      "observed_facts_digest|TEXT|1|0",
      "view_definition_digest|TEXT|1|0",
      "compiler_version|TEXT|1|0",
      "projection_json|TEXT|1|0",
      "created_at|TEXT|1|0",
      "invalidated_at|TEXT|0|0",
      "manifest_digest|TEXT|0|0"
    ],
    [
      "projection_digest|TEXT|0|1",
      "storage_repository_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "view_id|TEXT|1|0",
      "graph_digest|TEXT|1|0",
      "observed_facts_digest|TEXT|1|0",
      "view_definition_digest|TEXT|1|0",
      "compiler_version|TEXT|1|0",
      "projection_json|TEXT|1|0",
      "created_at|TEXT|1|0",
      "invalidated_at|TEXT|0|0",
      "manifest_digest|TEXT|0|0",
      "body_bytes|INTEGER|1|0",
      "last_accessed_at|TEXT|0|0",
      "access_count|INTEGER|1|0",
      "pinned_until|TEXT|0|0",
      "pin_reason|TEXT|0|0"
    ]
  ],
  "explorer_runtime_metrics": [
    [
      "storage_repository_id|TEXT|1|1",
      "storage_workspace_id|TEXT|1|2",
      "metric_name|TEXT|1|3",
      "reason_code|TEXT|1|4",
      "sample_count|INTEGER|1|0",
      "total_value|REAL|1|0",
      "max_value|REAL|1|0",
      "last_value|REAL|1|0",
      "updated_at|TEXT|1|0"
    ]
  ],
  "external_docs_cache": [
    [
      "provider|TEXT|1|1",
      "library_id|TEXT|1|2",
      "version|TEXT|1|3",
      "query_digest|TEXT|1|4",
      "content_digest|TEXT|1|0",
      "resource_json|TEXT|1|0",
      "retrieved_at|TEXT|1|0",
      "expires_at|TEXT|1|0"
    ]
  ],
  "landscapes": [
    [
      "id|TEXT|0|1",
      "digest|TEXT|1|0",
      "metadata_json|TEXT|1|0",
      "updated_at|TEXT|1|0"
    ]
  ],
  "observed_evidence": [
    [
      "id|TEXT|0|1",
      "repository_id|TEXT|1|0",
      "head_sha|TEXT|1|0",
      "selector_json|TEXT|1|0",
      "summary|TEXT|1|0",
      "confidence|TEXT|1|0",
      "created_at|TEXT|1|0"
    ]
  ],
  "projection_apply_receipts": [
    [
      "lookup_key|TEXT|0|1",
      "apply_id|TEXT|1|0",
      "journal_id|TEXT|1|0",
      "receipt_json|TEXT|1|0",
      "refresh_consumed_at|TEXT|0|0",
      "created_at|TEXT|1|0",
      "updated_at|TEXT|1|0"
    ],
    [
      "lookup_key|TEXT|0|1",
      "apply_id|TEXT|1|0",
      "journal_id|TEXT|1|0",
      "receipt_json|TEXT|1|0",
      "refresh_consumed_at|TEXT|0|0",
      "created_at|TEXT|1|0",
      "updated_at|TEXT|1|0",
      "recovery_proof_json|TEXT|0|0"
    ]
  ],
  "projection_state": [
    [
      "projection_id|TEXT|0|1",
      "repository_id|TEXT|1|0",
      "storage_repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "event_id|TEXT|1|0",
      "path|TEXT|1|0",
      "projection_digest|TEXT|1|0",
      "state_json|TEXT|1|0",
      "updated_at|TEXT|1|0"
    ]
  ],
  "recommendation_feedback": [
    [
      "feedback_id|TEXT|0|1",
      "recommendation_id|TEXT|1|0",
      "repository_id|TEXT|1|0",
      "storage_repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "event_id|TEXT|1|0",
      "feedback_json|TEXT|1|0",
      "created_at|TEXT|1|0"
    ]
  ],
  "recommendation_runs": [
    [
      "run_id|TEXT|0|1",
      "repository_id|TEXT|1|0",
      "storage_repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "event_id|TEXT|1|0",
      "status|TEXT|1|0",
      "catalog_digest|TEXT|1|0",
      "input_digest|TEXT|1|0",
      "output_digest|TEXT|1|0",
      "metrics_json|TEXT|1|0",
      "run_json|TEXT|1|0",
      "started_at|TEXT|1|0",
      "completed_at|TEXT|0|0"
    ]
  ],
  "recommendations": [
    [
      "recommendation_id|TEXT|0|1",
      "run_id|TEXT|1|0",
      "repository_id|TEXT|1|0",
      "storage_repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "event_id|TEXT|1|0",
      "fingerprint|TEXT|1|0",
      "subject|TEXT|1|0",
      "practice_id|TEXT|0|0",
      "status|TEXT|1|0",
      "confidence|TEXT|1|0",
      "enforcement|TEXT|1|0",
      "risk|TEXT|1|0",
      "uncertainty|TEXT|1|0",
      "evidence_binding_ids_json|TEXT|1|0",
      "explanation_json|TEXT|1|0",
      "recommendation_json|TEXT|1|0",
      "created_at|TEXT|1|0",
      "updated_at|TEXT|1|0"
    ]
  ],
  "repository_sessions": [
    [
      "repository_id|TEXT|0|1",
      "root|TEXT|1|0",
      "head_sha|TEXT|1|0",
      "worktree_digest|TEXT|1|0",
      "updated_at|TEXT|1|0"
    ]
  ],
  "review_results": [
    [
      "review_id|TEXT|0|1",
      "task_session_id|TEXT|1|0",
      "payload_json|TEXT|1|0",
      "created_at|TEXT|1|0"
    ]
  ],
  "runtime_job_queue": [
    [
      "job_id|TEXT|0|1",
      "repository_id|TEXT|1|0",
      "storage_repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "analysis_kind|TEXT|1|0",
      "coalesce_key|TEXT|1|0",
      "status|TEXT|1|0",
      "runner_port|TEXT|1|0",
      "fingerprint|TEXT|1|0",
      "input_digest|TEXT|1|0",
      "prompt_template_digest|TEXT|1|0",
      "output_digest|TEXT|0|0",
      "stale_policy|TEXT|1|0",
      "job_json|TEXT|1|0",
      "queued_at|TEXT|1|0",
      "updated_at|TEXT|1|0",
      "attempt_count|INTEGER|1|0",
      "max_attempts|INTEGER|1|0",
      "lease_owner|TEXT|0|0",
      "leased_at|TEXT|0|0",
      "lease_expires_at|TEXT|0|0",
      "last_error|TEXT|0|0",
      "dead_lettered_at|TEXT|0|0",
      "debounce_until|TEXT|0|0",
      "superseded_by_job_id|TEXT|0|0"
    ],
    [
      "job_id|TEXT|0|1",
      "repository_id|TEXT|1|0",
      "storage_repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "analysis_kind|TEXT|1|0",
      "coalesce_key|TEXT|1|0",
      "status|TEXT|1|0",
      "runner_port|TEXT|1|0",
      "fingerprint|TEXT|1|0",
      "input_digest|TEXT|1|0",
      "prompt_template_digest|TEXT|1|0",
      "output_digest|TEXT|0|0",
      "stale_policy|TEXT|1|0",
      "job_json|TEXT|1|0",
      "queued_at|TEXT|1|0",
      "updated_at|TEXT|1|0",
      "attempt_count|INTEGER|1|0",
      "max_attempts|INTEGER|1|0",
      "lease_owner|TEXT|0|0",
      "leased_at|TEXT|0|0",
      "lease_expires_at|TEXT|0|0",
      "last_error|TEXT|0|0",
      "dead_lettered_at|TEXT|0|0",
      "debounce_until|TEXT|0|0",
      "superseded_by_job_id|TEXT|0|0",
      "priority|INTEGER|1|0"
    ]
  ],
  "schema_migrations": [
    [
      "id|TEXT|0|1",
      "applied_at|TEXT|1|0"
    ]
  ],
  "snapshots": [
    [
      "id|TEXT|0|1",
      "repository_id|TEXT|1|0",
      "head_sha|TEXT|1|0",
      "worktree_digest|TEXT|1|0",
      "state|TEXT|1|0",
      "created_at|TEXT|1|0",
      "committed_at|TEXT|0|0"
    ]
  ],
  "source_cursors": [
    [
      "cursor_id|TEXT|0|1",
      "repository_id|TEXT|1|0",
      "storage_repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "source|TEXT|1|0",
      "cursor_json|TEXT|1|0",
      "updated_at|TEXT|1|0"
    ]
  ],
  "task_states": [
    [
      "task_session_id|TEXT|0|1",
      "payload_json|TEXT|1|0",
      "updated_at|TEXT|1|0"
    ]
  ],
  "waivers": [
    [
      "waiver_id|TEXT|0|1",
      "repository_id|TEXT|1|0",
      "storage_repository_id|TEXT|1|0",
      "workspace_id|TEXT|1|0",
      "storage_workspace_id|TEXT|1|0",
      "event_id|TEXT|1|0",
      "target_kind|TEXT|1|0",
      "target_id|TEXT|1|0",
      "waiver_json|TEXT|1|0",
      "created_at|TEXT|1|0",
      "expires_at|TEXT|0|0"
    ]
  ]
};

export const KNOWN_LEGACY_V1_VIRTUAL_TABLE_SQL: Readonly<Record<string, string>> = {
  "architecture_ledger_fts": "CREATE VIRTUAL TABLE architecture_ledger_fts USING fts5(kind,summary,rationale,title,evidence_summary,content='')",
  "architecture_ledger_search_fts": "CREATE VIRTUAL TABLE architecture_ledger_search_fts USING fts5(doc_id UNINDEXED,storage_repository_id UNINDEXED,storage_workspace_id UNINDEXED,target_kind UNINDEXED,target_id UNINDEXED,subject_id UNINDEXED,title,summary,rationale,evidence_summary)"
};

export const LEGACY_V1_FTS_SHADOW_PARENTS: Readonly<Record<string, string>> = {
  "architecture_ledger_fts_config": "architecture_ledger_fts",
  "architecture_ledger_fts_data": "architecture_ledger_fts",
  "architecture_ledger_fts_docsize": "architecture_ledger_fts",
  "architecture_ledger_fts_idx": "architecture_ledger_fts",
  "architecture_ledger_search_fts_config": "architecture_ledger_search_fts",
  "architecture_ledger_search_fts_content": "architecture_ledger_search_fts",
  "architecture_ledger_search_fts_data": "architecture_ledger_search_fts",
  "architecture_ledger_search_fts_docsize": "architecture_ledger_search_fts",
  "architecture_ledger_search_fts_idx": "architecture_ledger_search_fts"
};

export const KNOWN_LEGACY_V1_VIEW_SQL: Readonly<Record<string, string>> = {
  "architecture_current_graph_view": "CREATE VIEW architecture_current_graph_view AS SELECT storage_repository_id,storage_workspace_id,entity_id AS graph_id,'entity' AS graph_kind,kind,canonical_name AS label,status,path,summary,last_event_id,updated_at FROM architecture_entities_current UNION ALL SELECT storage_repository_id,storage_workspace_id,relation_id AS graph_id,'relation' AS graph_kind,kind,source_entity_id || ' -> ' || target_entity_id AS label,status,NULL AS path,summary,last_event_id,updated_at FROM architecture_relations_current UNION ALL SELECT storage_repository_id,storage_workspace_id,constraint_id AS graph_id,'constraint' AS graph_kind,kind,subject_id AS label,status,NULL AS path,summary,last_event_id,updated_at FROM architecture_constraints_current",
  "open_recommendations_view": "CREATE VIEW open_recommendations_view AS SELECT recommendation_id,run_id,storage_repository_id,storage_workspace_id,subject,practice_id,status,confidence,enforcement,risk,uncertainty,updated_at FROM recommendations WHERE status IN('open','acknowledged','accepted','deferred')",
  "recent_architecture_changes_view": "CREATE VIEW recent_architecture_changes_view AS SELECT event_sequence,event_id,storage_repository_id,storage_workspace_id,branch,head_sha,event_type,source,actor_kind,actor_id,previous_event_hash,event_hash,created_at FROM architecture_events ORDER BY event_sequence DESC",
  "unresolved_evidence_view": "CREATE VIEW unresolved_evidence_view AS SELECT evidence_items.evidence_id,evidence_items.storage_repository_id,evidence_items.storage_workspace_id,evidence_items.kind,evidence_items.strength,evidence_items.polarity,evidence_items.origin,evidence_items.subject,evidence_items.summary,evidence_items.created_at FROM evidence_items LEFT JOIN evidence_bindings ON evidence_bindings.evidence_id = evidence_items.evidence_id WHERE evidence_bindings.binding_id IS NULL"
};

export const KNOWN_LEGACY_V1_TRIGGER_SQL: Readonly<Record<string, string>> = {
  "architecture_events_immutable_delete": "CREATE TRIGGER architecture_events_immutable_delete BEFORE DELETE ON architecture_events BEGIN SELECT RAISE(ABORT,'architecture-events-immutable'); END",
  "architecture_events_immutable_update": "CREATE TRIGGER architecture_events_immutable_update BEFORE UPDATE OF event_sequence,event_id,repository_id,storage_repository_id,workspace_id,storage_workspace_id,branch,head_sha,worktree_digest,event_type,payload_version,source,actor_kind,actor_id,base_digest,resulting_digest,previous_event_hash,event_hash,idempotency_key,payload_json,provenance_json,event_json,created_at ON architecture_events BEGIN SELECT RAISE(ABORT,'architecture-events-immutable'); END",
  "architecture_events_scope_backfill_only": "CREATE TRIGGER architecture_events_scope_backfill_only BEFORE UPDATE OF source_storage_workspace_id,scope_event_count ON architecture_events WHEN NOT(OLD.source_storage_workspace_id IS NULL AND OLD.scope_event_count IS NULL AND NEW.source_storage_workspace_id IS NOT NULL AND NEW.scope_event_count IS NOT NULL)BEGIN SELECT RAISE(ABORT,'architecture-events-immutable'); END",
  "architecture_evidence_state_checkpoints_immutable_delete": "CREATE TRIGGER architecture_evidence_state_checkpoints_immutable_delete BEFORE DELETE ON architecture_evidence_state_checkpoints BEGIN SELECT RAISE(ABORT,'architecture-evidence-state-checkpoints-immutable'); END",
  "architecture_evidence_state_checkpoints_immutable_update": "CREATE TRIGGER architecture_evidence_state_checkpoints_immutable_update BEFORE UPDATE ON architecture_evidence_state_checkpoints BEGIN SELECT RAISE(ABORT,'architecture-evidence-state-checkpoints-immutable'); END"
};
