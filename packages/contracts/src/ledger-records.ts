import type { Json } from "./schema";

export const ARCHITECTURE_EVENT_SCHEMA_VERSION = "archcontext.architecture-event/v1" as const;
export const ARCHITECTURE_SNAPSHOT_SCHEMA_VERSION = "archcontext.architecture-snapshot/v2" as const;
export const EVIDENCE_ITEM_SCHEMA_VERSION = "archcontext.evidence-item/v2" as const;
export const EVIDENCE_BINDING_SCHEMA_VERSION = "archcontext.evidence-binding/v1" as const;
export const RECOMMENDATION_RUN_SCHEMA_VERSION = "archcontext.recommendation-run/v1" as const;
export const RECOMMENDATION_SCHEMA_VERSION = "archcontext.recommendation/v2" as const;
export const RECOMMENDATION_V3_SCHEMA_VERSION = "archcontext.recommendation/v3" as const;
export const RECOMMENDATION_FEEDBACK_SCHEMA_VERSION = "archcontext.recommendation-feedback/v1" as const;
export const AGENT_JOB_SCHEMA_VERSION = "archcontext.agent-job/v1" as const;
export const ARCHITECTURE_SUBJECT_SELECTOR_SCHEMA_VERSION = "archcontext.architecture-subject-selector/v1" as const;
export const PROJECTION_TARGET_SCHEMA_VERSION = "archcontext.projection-target/v1" as const;

export const RECOMMENDATION_CATEGORIES = ["practice", "refactor_proposal", "structural_observation"] as const;

export type ArchitectureFactAuthority = "declared" | "observed" | "verified" | "proposed" | "projected";
export type ArchitectureLedgerMode = "yaml" | "dual" | "dual-compare" | "ledger-shadow" | "ledger" | "ledger-authoritative";
export type ArchitectureActorKind = "developer" | "daemon" | "hook" | "cli" | "mcp" | "subagent" | "migration" | "system";
export type ArchitectureActorSource = "cli" | "mcp" | "manual" | "daemon" | "system" | "subagent";
export type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number];
export const RECOMMENDATION_STATUSES = [
  "open",
  "acknowledged",
  "accepted",
  "rejected",
  "deferred",
  "waived",
  "resolved",
  "superseded",
  "expired"
] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];
export type ArchitectureEventSource =
  | "prepare_task"
  | "checkpoint"
  | "plan_update"
  | "apply_update"
  | "complete_task"
  | "git_hook"
  | "yaml_import"
  | "projection_reconcile"
  | "migration"
  | "manual"
  | "agent_audit"
  | "refactor_scan";

export type EvidenceStrengthV2 = "heuristic" | "declared" | "observed" | "verified";
export type EvidencePolarityV2 = "positive" | "absence" | "declaration";
export type EvidenceOriginV2 = "codegraph" | "model-store-yaml" | "checkpoint" | "runtime-daemon" | "user" | "subagent" | "external-doc";
export type EvidenceCoverageLevelV2 = "complete" | "partial" | "unknown";
export type EvidenceAuthorityEffect = "context-only" | "ranking" | "checkpoint-eligible" | "complete-eligible";
export type ArchitectureSubjectSelectorKind =
  | "repository"
  | "path"
  | "symbol"
  | "node"
  | "relation"
  | "api"
  | "datastore"
  | "external-contract";
export type ProjectionTargetType =
  | "architecture-index"
  | "entity-summary"
  | "relation-summary"
  | "decision-index"
  | "diagram-mermaid"
  | "diagram-structurizr"
  | "diagram-likec4"
  | "diagram-runtime-topology"
  | "runtime-topology-summary"
  | "architecture-history"
  | "agent-context";
export type ProjectionTargetScopeKind = "repository" | "entity" | "relation" | "decision" | "diagram";
export type ProjectionTargetOwnership = "generated" | "mixed";
export type ProjectionTargetFormat = "markdown" | "mermaid" | "structurizr-json" | "likec4";

export interface ArchitectureRepositoryIdentityV1 {
  repositoryId: string;
  storageRepositoryId: string;
}

export interface ArchitectureWorktreeIdentityV1 {
  workspaceId: string;
  storageWorkspaceId: string;
  branch: string;
  headSha: string;
  worktreeDigest: string;
}

export interface LedgerProvenanceV1 {
  producer: string;
  command: string;
  inputDigest: string;
  traceDigest?: string;
}

export interface RecommendationAuthorV1 {
  kind: ArchitectureActorKind;
  id: string;
  source: ArchitectureActorSource;
}

export interface EvidenceItemV2 {
  schemaVersion: typeof EVIDENCE_ITEM_SCHEMA_VERSION;
  evidenceId: string;
  kind: string;
  strength: EvidenceStrengthV2;
  polarity: EvidencePolarityV2;
  origin: EvidenceOriginV2;
  subject: string;
  selector: {
    kind: "repository" | "path" | "symbol" | "relation" | "constraint" | "practice" | "event" | "snapshot";
    id: string;
    path?: string;
    symbolId?: string;
    startLine?: number;
    endLine?: number;
  };
  summary: string;
  coverage: {
    level: EvidenceCoverageLevelV2;
    scope: string;
  };
  supports: ("recommendation" | "checkpoint" | "complete")[];
  provenance: LedgerProvenanceV1;
  createdAt: string;
  digest: string;
  extensions?: Record<string, Json>;
}

export interface EvidenceBindingV1 {
  schemaVersion: typeof EVIDENCE_BINDING_SCHEMA_VERSION;
  bindingId: string;
  evidenceId: string;
  target: {
    kind: "entity" | "relation" | "constraint" | "recommendation" | "practice" | "event" | "snapshot" | "subject";
    id: string;
  };
  bindingReason: "direct-selector" | "predicate-subject" | "change-cursor" | "human-attestation" | "deterministic-check" | "subagent-proposal";
  authorityEffect: EvidenceAuthorityEffect;
  createdAt: string;
  provenance: LedgerProvenanceV1;
  extensions?: Record<string, Json>;
}

export type EvidenceLifecycleTargetV1 = "item" | "binding";
export type EvidenceLifecycleActionV1 = "create" | "update" | "remove";

export type EvidenceLifecycleOperationV1 =
  | {
      target: "item";
      action: "create";
      evidenceId: string;
      value: EvidenceItemV2;
    }
  | {
      target: "item";
      action: "update";
      evidenceId: string;
      previousDigest: string;
      value: EvidenceItemV2;
    }
  | {
      target: "item";
      action: "remove";
      evidenceId: string;
      previousDigest: string;
      reasonCode: string;
    }
  | {
      target: "binding";
      action: "create";
      bindingId: string;
      value: EvidenceBindingV1;
    }
  | {
      target: "binding";
      action: "update";
      bindingId: string;
      previousDigest: string;
      value: EvidenceBindingV1;
    }
  | {
      target: "binding";
      action: "remove";
      bindingId: string;
      previousDigest: string;
      reasonCode: string;
    };

export interface EvidenceLifecycleTombstoneV1 {
  target: EvidenceLifecycleTargetV1;
  id: string;
  previousDigest: string;
  reasonCode: string;
  removedByEventId: string;
}

export interface EvidenceStateAtCursorV1 {
  schemaVersion: "archcontext.evidence-state-at-cursor/v1";
  evidenceItems: EvidenceItemV2[];
  evidenceBindings: EvidenceBindingV1[];
  tombstones: EvidenceLifecycleTombstoneV1[];
  stateDigest: string;
}

export interface ArchitectureSubjectSelectorV1 {
  schemaVersion: typeof ARCHITECTURE_SUBJECT_SELECTOR_SCHEMA_VERSION;
  selectorId: string;
  kind: ArchitectureSubjectSelectorKind;
  repositoryId: string;
  stableKey: string;
  path?: string;
  symbolId?: string;
  name?: string;
  relation?: {
    source: string;
    target: string;
    kind: string;
  };
  externalId?: string;
  digest: string;
  extensions?: Record<string, Json>;
}

export interface ProjectionTargetGeneratedRegionV1 {
  startMarker: string;
  endMarker: string;
}

export interface ProjectionTargetScopeV1 {
  kind: ProjectionTargetScopeKind;
  id?: string;
  entityKind?: string;
}

interface ProjectionTargetBaseV1 {
  schemaVersion: typeof PROJECTION_TARGET_SCHEMA_VERSION;
  targetId: string;
  type: ProjectionTargetType;
  scope: ProjectionTargetScopeV1;
  path: string;
  rendererVersion: string;
  format: ProjectionTargetFormat;
  sourceDigest: string;
  outputDigest: string;
  extensions?: Record<string, Json>;
}

/**
 * A `mixed` target owns one marked region inside a human-owned document, so it carries the region
 * markers. A `generated` target owns its whole file and carries no marker: the projection manifest
 * row's `outputDigest` is what proves the file is projection output.
 */
export type ProjectionTargetV1 = ProjectionTargetBaseV1 & (
  | { ownership: Extract<ProjectionTargetOwnership, "mixed">; generatedRegion: ProjectionTargetGeneratedRegionV1 }
  | { ownership: Extract<ProjectionTargetOwnership, "generated">; generatedRegion?: never }
);

/** A target that owns one marked region inside a document. */
export type ProjectionMixedTargetV1 = Extract<ProjectionTargetV1, { ownership: "mixed" }>;
