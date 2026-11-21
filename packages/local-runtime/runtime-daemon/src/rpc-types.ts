import type { ChangeOperation } from "@archcontext/core/changeset-engine";
import type { ArchitectureProjectionProfile } from "@archcontext/core/projection-engine";
import type { RecommendationFeedbackAction, RecommendationFeedbackSource, RecommendationStatus } from "@archcontext/core/recommendation-engine";
import type { CompleteTaskInput } from "@archcontext/core/review-engine";
import type {
  AcceptedArchitectureChangeReferenceV1,
  ArchitectureActorKind,
  ExternalDocumentationProvider,
  PracticeCheckpointEvent,
  ProjectionApplyRecoveryIntentV1,
  ProjectionApplyReceiptV1,
  ProjectionRequestV1,
  RefactorRequestV1,
  RefactorVerificationRequestV1
} from "@archcontext/contracts";
import type { GitChangeSource } from "@archcontext/local-runtime/git-adapter";

export interface RuntimePracticeCheckpointInput {
  taskSessionId?: string;
  task?: string;
  event?: PracticeCheckpointEvent;
  changedPaths?: string[];
  toolCallId?: string;
  expectedHeadSha?: string;
  expectedWorktreeDigest?: string;
  maxBytes?: number;
  maxItems?: number;
}

export interface RuntimePracticeWaiverInput {
  id?: string;
  waiverId?: string;
  taskSessionId?: string;
  practiceId: string;
  checkId?: string;
  owner: string;
  reason: string;
  createdAt?: string;
  reviewAt: string;
  expiresAt: string;
  evidenceDigest: string;
  subjects?: string[];
  pathGlobs?: string[];
}

export interface RuntimeLedgerProjectInput {
  dryRun?: boolean;
  expectedWorktreeDigest?: string;
}

/**
 * Ordered 1-32 committed journals forming one model-transition chain. Without `approved` the daemon
 * returns a preview; approval must echo the previewed `acceptancePlanId` and worktree digest.
 */
export interface RuntimeAcceptCommittedChangeInput {
  journals: { journalId: string; changeSetId: string }[];
  approved?: boolean;
  expectedWorktreeDigest?: string;
  acceptancePlanId?: string;
}

export interface RuntimeLedgerRebuildInput {
  fromGit?: boolean;
  expectedWorktreeDigest?: string;
  acceptExternalProjection?: boolean;
}

export interface RuntimeLedgerMigrateInput {
  fromYaml?: boolean;
  recommendationV3?: boolean;
  dryRun?: boolean;
  expectedWorktreeDigest?: string;
}

export interface RuntimeLedgerRollbackInput {
  toYaml?: boolean;
  dryRun?: boolean;
  expectedWorktreeDigest?: string;
}

export interface RuntimeCompleteTaskInput {
  taskSessionId?: string;
  task?: string;
  posture?: CompleteTaskInput["posture"];
  headSha?: string;
  compatibilityContract?: CompleteTaskInput["compatibilityContract"];
  compatibilityPathIntroduced?: boolean;
  cleanupRequired?: number;
  cleanupCompleted?: number;
}

export type RuntimeWorktreeDigestProfile = "repository" | "architecture-documentation-projection";

export interface RuntimePlanUpdateInput {
  id: string;
  operations: ChangeOperation[];
  reason?: { taskSessionId: string; interventionId?: string };
  worktreeDigestPrecondition?: {
    profile: "architecture-documentation-projection";
    expectedDigest: string;
  };
}

export interface RuntimeApplyUpdateInput {
  id: string;
  approved: boolean;
  expectedWorktreeDigest: string;
  worktreeDigestProfile?: RuntimeWorktreeDigestProfile;
  projectionApplyReceipt?: ProjectionApplyReceiptV1;
}

export interface RuntimeBookInput {
  command?: "status" | "query" | "show" | "neighbors" | "timeline" | "diff" | "evidence" | "recommendations" | "export";
  id?: string;
  query?: string;
  task?: string;
  explain?: boolean;
  depth?: number;
  fromRef?: string;
  toRef?: string;
  sinceRef?: string;
  openOnly?: boolean;
  format?: "yaml" | "markdown" | "json";
  maxItems?: number;
  maxBytes?: number;
}

export interface RuntimeDocsInput {
  command: "status" | "resolve" | "pin" | "fetch" | "purge";
  provider?: ExternalDocumentationProvider;
  libraryName?: string;
  libraryId?: string;
  version?: string;
  query?: string;
  intent?: string;
  approved?: boolean;
  allowNetwork?: boolean;
  forceRefresh?: boolean;
  all?: boolean;
}

export interface ExplorerServerOptions {
  port?: number;
  tokenTtlSeconds?: number;
}

export interface RuntimeDocsProjectionInput {
  action: "plan" | "apply" | "adopt" | "drift" | "clean";
  profile?: ArchitectureProjectionProfile;
  acceptedChange?: AcceptedArchitectureChangeReferenceV1;
  id?: string;
  taskSessionId?: string;
  approved?: boolean;
  expectedWorktreeDigest?: string;
  adoptionPlanId?: string;
}
export interface RuntimeAgentContextProjectionInput {
  action: "plan" | "preview" | "apply";
  id?: string;
  taskSessionId?: string;
  approved?: boolean;
  expectedWorktreeDigest?: string;
}
export type RuntimeProjectionInvocation =
  | { action: "run" | "readback"; request: ProjectionRequestV1 }
  | { action: "recover"; request: ProjectionApplyRecoveryIntentV1 };

export interface RuntimeRecommendationInput {
  /**
   * `show` is a read: one recommendation (recorded, or a current scan candidate) with its evidence.
   * `list` is a read: the latest record of every recorded recommendation in `status`, unbudgeted.
   */
  command: "metrics" | "show" | "list" | RecommendationFeedbackAction;
  recommendationId?: string;
  /** Required by `list`; one of `RECOMMENDATION_STATUSES`. */
  status?: RecommendationStatus;
  reason?: string;
  /**
   * `resolve` on a non-practice category requires resolution evidence: the gate looks the digest
   * up in the replayed evidence state and rejects it when unrecorded, verified at a different
   * HEAD, verified over a different worktree digest, or carrying a disposition other than
   * resolved. `refactor verify` writes those records.
   */
  evidenceDigest?: string;
  actor?: string;
  actorKind?: ArchitectureActorKind;
  source?: RecommendationFeedbackSource;
  expectedWorktreeDigest?: string;
  /**
   * `show` and the decisions on a scan candidate: the import-node read limit of the scan that
   * finds the candidate. Give the limit the `refactor scan --import-node-limit <n>` had; a
   * recorded recommendation is read from the ledger and needs none.
   */
  importNodeLimit?: number;
  /** The scan response's top-level digest for accept, defer or reject. */
  snapshotDigest?: string;
  /**
   * The explicit approval of one refactor decision write (ADR-0046). A decision on a
   * `refactor_proposal` or `structural_observation` writes its Git decision file through a
   * ChangeSet, so it requires `approved: true`; the one-shot CLI verbs pass it, every other ingress
   * must pass it itself. Practice decisions stay ledger-only and do not read it.
   */
  approved?: boolean;
  agentJobId?: string;
  now?: string;
}

export interface RuntimeRefactorScanInput {
  /** Absent means the default repository-scope request; the daemon never invents a proposal. */
  request?: RefactorRequestV1;
}

export interface RuntimeRefactorRecordInput {
  assessmentDigest: string;
  expectedWorktreeDigest: string;
}

/**
 * The daemon's `refactor verify` ingress is the frozen contract type itself. RF5b gave the CLI a
 * `--request-json` flag, so the shape a caller sends over JSON and the shape the daemon accepts
 * over RPC are one declaration; a daemon-local twin would let the two drift while both claim to
 * describe the same request.
 */
export type RuntimeRefactorVerifyInput = RefactorVerificationRequestV1;
