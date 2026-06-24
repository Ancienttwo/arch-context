import { digestJson, type Json } from "./schema";

export const ARCHITECTURE_EVENT_SCHEMA_VERSION = "archcontext.architecture-event/v1" as const;
export const ARCHITECTURE_SNAPSHOT_SCHEMA_VERSION = "archcontext.architecture-snapshot/v1" as const;
export const EVIDENCE_ITEM_SCHEMA_VERSION = "archcontext.evidence-item/v2" as const;
export const EVIDENCE_BINDING_SCHEMA_VERSION = "archcontext.evidence-binding/v1" as const;
export const RECOMMENDATION_RUN_SCHEMA_VERSION = "archcontext.recommendation-run/v1" as const;
export const RECOMMENDATION_SCHEMA_VERSION = "archcontext.recommendation/v2" as const;
export const AGENT_JOB_SCHEMA_VERSION = "archcontext.agent-job/v1" as const;
export const INVESTIGATION_REPORT_SCHEMA_VERSION = "archcontext.investigation-report/v1" as const;

export type ArchitectureFactAuthority = "declared" | "observed" | "verified" | "proposed" | "projected";
export type ArchitectureLedgerMode = "yaml" | "dual" | "dual-compare" | "ledger-shadow" | "ledger" | "ledger-authoritative";
export type ArchitectureActorKind = "developer" | "daemon" | "hook" | "cli" | "mcp" | "subagent" | "migration" | "system";
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
  | "manual";

export type EvidenceStrengthV2 = "heuristic" | "declared" | "observed" | "verified";
export type EvidencePolarityV2 = "positive" | "absence" | "declaration";
export type EvidenceOriginV2 = "codegraph" | "model-store-yaml" | "checkpoint" | "runtime-daemon" | "user" | "subagent" | "external-doc";
export type EvidenceCoverageLevelV2 = "complete" | "partial" | "unknown";
export type EvidenceAuthorityEffect = "context-only" | "ranking" | "checkpoint-eligible" | "complete-eligible";

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

export interface ArchitectureEventV1 {
  schemaVersion: typeof ARCHITECTURE_EVENT_SCHEMA_VERSION;
  eventId: string;
  eventType: string;
  payloadVersion: string;
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  baseDigest: string;
  resultingDigest: string;
  headSha: string;
  actor: {
    kind: ArchitectureActorKind;
    id: string;
  };
  source: ArchitectureEventSource;
  timestamp: string;
  idempotencyKey: string;
  provenance: LedgerProvenanceV1;
  payload: Json;
  previousEventHash?: string | null;
  eventHash?: string;
  extensions?: Record<string, Json>;
}

export interface ArchitectureSnapshotV1 {
  schemaVersion: typeof ARCHITECTURE_SNAPSHOT_SCHEMA_VERSION;
  snapshotId: string;
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  sourceMode: ArchitectureLedgerMode;
  eventCursor: {
    lastEventId: string;
    lastEventHash: string;
  };
  graphDigest: string;
  projectionDigest: string;
  entityCount: number;
  relationCount: number;
  constraintCount: number;
  inputDigests: {
    modelDigest: string;
    codeFactsDigest?: string;
    policyDigest?: string;
    catalogDigest?: string;
  };
  createdAt: string;
  extensions?: Record<string, Json>;
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
    kind: "entity" | "relation" | "constraint" | "recommendation" | "practice" | "event" | "snapshot";
    id: string;
  };
  bindingReason: "direct-selector" | "predicate-subject" | "change-cursor" | "human-attestation" | "deterministic-check" | "subagent-proposal";
  authorityEffect: EvidenceAuthorityEffect;
  createdAt: string;
  provenance: LedgerProvenanceV1;
  extensions?: Record<string, Json>;
}

export interface RecommendationRunV1 {
  schemaVersion: typeof RECOMMENDATION_RUN_SCHEMA_VERSION;
  runId: string;
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  trigger: {
    level: "L0" | "L1" | "L2" | "L3" | "L4";
    source: ArchitectureEventSource;
  };
  engineVersion: string;
  catalogDigest: string;
  inputDigest: string;
  outputDigest: string;
  policyMode: "advisory" | "checkpoint" | "complete";
  status: "queued" | "running" | "succeeded" | "failed" | "superseded";
  startedAt: string;
  completedAt?: string;
  recommendationIds: string[];
  metrics: {
    matchCount: number;
    evidenceBindingCount: number;
    unboundEvidenceCount: number;
  };
  extensions?: Record<string, Json>;
}

export interface RecommendationV2 {
  schemaVersion: typeof RECOMMENDATION_SCHEMA_VERSION;
  recommendationId: string;
  runId: string;
  fingerprint: string;
  subject: string;
  practiceId?: string;
  status: "open" | "acknowledged" | "accepted" | "rejected" | "deferred" | "waived" | "resolved" | "superseded" | "expired";
  confidence: "low" | "medium" | "high";
  enforcement: "advisory" | "checkpoint" | "complete";
  risk: "low" | "medium" | "high";
  uncertainty: "low" | "medium" | "high";
  evidenceBindingIds: string[];
  explanation: string[];
  createdAt: string;
  updatedAt: string;
  extensions?: Record<string, Json>;
}

export interface AgentJobV1 {
  schemaVersion: typeof AGENT_JOB_SCHEMA_VERSION;
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "superseded" | "expired";
  runnerPort: "claude-code" | "codex" | "fake-provider";
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  fingerprint: string;
  trigger: {
    source: ArchitectureEventSource;
    reason: string;
  };
  budget: {
    maxRunsPerTask: number;
    maxRunsPerRepositoryPerDay: number;
  };
  inputDigest: string;
  promptTemplateDigest: string;
  outputDigest?: string;
  stalePolicy: "cancel-on-head-change" | "advisory-only-on-stale";
  directMutationAllowed: false;
  queuedAt: string;
  updatedAt: string;
  extensions?: Record<string, Json>;
}

export interface InvestigationReportV1 {
  schemaVersion: typeof INVESTIGATION_REPORT_SCHEMA_VERSION;
  reportId: string;
  jobId: string;
  status: "succeeded" | "failed" | "partial";
  findings: {
    findingId: string;
    hypothesis: string;
    evidenceBindingIds: string[];
    unknowns: string[];
    falsifier: string;
    proposedDeltaDigest?: string;
    confidence: "low" | "medium" | "high";
  }[];
  outputDigest: string;
  createdAt: string;
  directMutationAllowed: false;
  extensions?: Record<string, Json>;
}

export const LEDGER_AUTHORITY_MATRIX: Record<ArchitectureFactAuthority, {
  writer: string;
  canonicalIdRule: string;
  conflictPolicy: string;
}> = {
  declared: {
    writer: "ChangeSet-approved Git projection in .archcontext/",
    canonicalIdRule: "stable declared architecture ID from repo model",
    conflictPolicy: "Git conflict or projection drift blocks promotion until reconciled"
  },
  observed: {
    writer: "CodeGraph adapter and deterministic runtime probes",
    canonicalIdRule: "selector digest scoped by repository and worktree identity",
    conflictPolicy: "Observed facts can support evidence but cannot overwrite declared facts"
  },
  verified: {
    writer: "Deterministic checks, test/readback artifacts, and accepted attestations",
    canonicalIdRule: "verification subject plus evidence digest",
    conflictPolicy: "New verification supersedes older verification only at the same HEAD/worktree cursor"
  },
  proposed: {
    writer: "ChangeSet drafts and subagent investigation proposals",
    canonicalIdRule: "proposal ID plus idempotency key",
    conflictPolicy: "Proposal remains non-authoritative until validated and approved"
  },
  projected: {
    writer: "Renderer from accepted architecture state",
    canonicalIdRule: "projection target path plus source snapshot digest",
    conflictPolicy: "Human edits outside generated regions become drift requiring explicit reconcile"
  }
};

export function architectureEventHash(event: ArchitectureEventV1): string {
  const { eventHash: _eventHash, extensions: _extensions, ...hashable } = event;
  return digestJson(hashable as unknown as Json);
}

export function architectureSnapshotDigest(snapshot: ArchitectureSnapshotV1): string {
  const { snapshotId: _snapshotId, createdAt: _createdAt, extensions: _extensions, ...hashable } = snapshot;
  return digestJson(hashable as unknown as Json);
}
