import type { ArchitectureMajorChangeReasonCode } from "./projection-constants";
import type { RefactorObservationKind, RefactorScale } from "./refactor-constants";
import type { ArchitectureTargetDeltaV1, RefactorKillListEntryV1, RefactorTargetOutcomeV1 } from "./refactor-types";
import type { RefactorObservationEvidenceV1 } from "./refactor-evidence-types";
import { digestJson, type Json } from "./schema";
import {
  AGENT_JOB_SCHEMA_VERSION,
  ARCHITECTURE_EVENT_SCHEMA_VERSION,
  ARCHITECTURE_SNAPSHOT_SCHEMA_VERSION,
  RECOMMENDATION_FEEDBACK_SCHEMA_VERSION,
  RECOMMENDATION_RUN_SCHEMA_VERSION,
  RECOMMENDATION_SCHEMA_VERSION,
  RECOMMENDATION_V3_SCHEMA_VERSION,
  type ArchitectureActorKind,
  type ArchitectureActorSource,
  type ArchitectureEventSource,
  type ArchitectureFactAuthority,
  type ArchitectureLedgerMode,
  type ArchitectureRepositoryIdentityV1,
  type ArchitectureSubjectSelectorV1,
  type ArchitectureWorktreeIdentityV1,
  type EvidenceStateAtCursorV1,
  type LedgerProvenanceV1,
  type RecommendationAuthorV1,
  type RecommendationStatus
} from "./ledger-records";

export * from "./ledger-records";

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

export interface ArchitectureSnapshotV2 {
  schemaVersion: typeof ARCHITECTURE_SNAPSHOT_SCHEMA_VERSION;
  snapshotId: string;
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  sourceMode: ArchitectureLedgerMode;
  eventCursor: {
    eventCount: number;
    lastEventSequence: number;
    lastEventId: string;
    lastEventHash: string;
  };
  graphDigest: string;
  evidenceDigest: string;
  stateDigest: string;
  state: {
    graph: Json;
    evidence: EvidenceStateAtCursorV1;
  };
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

export type ArchitectureAffectedSubjectAuthorityClassV1 = "architecture-fact" | "evidence";
export type ArchitectureAffectedSubjectKindV1 =
  | "entity"
  | "relation"
  | "constraint"
  | "evidence-item"
  | "evidence-binding"
  | "subject";
export type ArchitectureAffectedSubjectOperationV1 = "create" | "update" | "remove" | "upsert" | "delete" | "reference";

export interface ArchitectureAffectedSubjectV1 {
  authorityClass: ArchitectureAffectedSubjectAuthorityClassV1;
  subjectKind: ArchitectureAffectedSubjectKindV1;
  subjectId: string;
  operation: ArchitectureAffectedSubjectOperationV1;
}

export interface ArchitectureChangeFeedRecordV1 {
  schemaVersion: "archcontext.architecture-change-feed-record/v1";
  feedSequence: number;
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  eventSequence: number;
  eventId: string;
  eventHash: string;
  title?: string;
  rationale?: string;
  affectedSubjects: ArchitectureAffectedSubjectV1[];
  subjectsDigest: string;
  changedInputDigests: {
    graphBefore: string;
    graphAfter: string;
    evidenceBefore: string;
    evidenceAfter: string;
  };
  committedAt: string;
}

export interface ArchitectureChangeFeedBatchV1 {
  schemaVersion: "archcontext.architecture-change-feed-batch/v1";
  consumerId: string;
  checkpoint: number;
  records: ArchitectureChangeFeedRecordV1[];
  hasMore: boolean;
}

export interface ArchitectureEventBacklinkV1 {
  eventId: string;
  subjectIds: string[];
  title?: string;
  rationale?: string;
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
  status: RecommendationStatus;
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

export interface RecommendationFeedbackV1 {
  schemaVersion: typeof RECOMMENDATION_FEEDBACK_SCHEMA_VERSION;
  feedbackId: string;
  recommendationId: string;
  runId: string;
  action: "acknowledge" | "accept" | "reject" | "defer" | "waive" | "resolve";
  previousStatus: RecommendationStatus;
  nextStatus: RecommendationStatus;
  actor: {
    kind: ArchitectureActorKind;
    id: string;
    source: ArchitectureActorSource;
  };
  reason: string;
  explicit: true;
  implicitAcceptance: false;
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  createdAt: string;
  extensions?: Record<string, Json>;
}

export interface RecommendationRelationsV1 {
  supersedes?: string;
  regressesFrom?: string;
}

export interface PracticeRecommendationPayloadV1 {
  practiceId: string;
  baselineDigest: string | null;
}

/**
 * Self-contained: `metrics`, `signalIds` and `evidence` are copied verbatim from the assessed
 * `RefactorObservationV1`, so a reader never has to join a recorded record back to an in-memory
 * assessment by kind and subject. None of them is part of the fingerprint.
 *
 * A record written by archctx 0.6.3 or earlier (before #262) has none of the three, and the ledger
 * keeps it as written, so `recommendations show` and `list` can return it. A reader detects such a
 * record by the absence of `evidence`. It does not validate against
 * `schemas/runtime/recommendation-v3.schema.json`, which describes the record 0.7.0 writes.
 */
export interface StructuralObservationPayloadV1 {
  assessmentDigest: string;
  kind: RefactorObservationKind;
  affectedNodeIds: string[];
  baselineSnapshotDigest: string;
  derivedOutcomes: RefactorTargetOutcomeV1[];
  metrics: Record<string, number | null>;
  signalIds: string[];
  evidence: RefactorObservationEvidenceV1;
}

export interface RefactorProposalPayloadV1 {
  assessmentDigest: string;
  proposalDigest: string;
  scale: RefactorScale;
  affectedNodeIds: string[];
  majorChangeReasons: ArchitectureMajorChangeReasonCode[];
  baselineSnapshotDigest: string;
  targetDelta?: ArchitectureTargetDeltaV1;
  targetOutcomes: RefactorTargetOutcomeV1[];
  killList: RefactorKillListEntryV1[];
}

export type RecommendationPayloadV1 =
  | PracticeRecommendationPayloadV1
  | StructuralObservationPayloadV1
  | RefactorProposalPayloadV1;

/** Strict superset of RecommendationV2: every v2 field is kept verbatim. */
export interface RecommendationV3Base {
  schemaVersion: typeof RECOMMENDATION_V3_SCHEMA_VERSION;
  recommendationId: string;
  runId: string;
  fingerprint: string;
  subject: string;
  practiceId?: string;
  status: RecommendationStatus;
  confidence: "low" | "medium" | "high";
  enforcement: "advisory" | "checkpoint" | "complete";
  risk: "low" | "medium" | "high";
  uncertainty: "low" | "medium" | "high";
  evidenceBindingIds: string[];
  explanation: string[];
  authoredBy: RecommendationAuthorV1;
  subjectSelectorId: string;
  relations: RecommendationRelationsV1;
  createdAt: string;
  updatedAt: string;
  extensions?: Record<string, Json>;
}

/** `category` discriminates `payload`; no other combination is representable. */
export type RecommendationV3CategoryPayloadV1 =
  | { category: "practice"; payload: PracticeRecommendationPayloadV1 }
  | { category: "structural_observation"; payload: StructuralObservationPayloadV1 }
  | { category: "refactor_proposal"; payload: RefactorProposalPayloadV1 };

export type RecommendationV3 = RecommendationV3Base & RecommendationV3CategoryPayloadV1;

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
    maxRunsPerDay?: number;
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

export function architectureSnapshotDigest(snapshot: ArchitectureSnapshotV2): string {
  const { snapshotId: _snapshotId, createdAt: _createdAt, extensions: _extensions, ...hashable } = snapshot;
  return digestJson(hashable as unknown as Json);
}

export function architectureSubjectSelectorDigest(selector: ArchitectureSubjectSelectorV1): string {
  const { digest: _digest, extensions: _extensions, ...hashable } = selector;
  return digestJson(hashable as unknown as Json);
}
