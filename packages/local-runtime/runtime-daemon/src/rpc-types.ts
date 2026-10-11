import type { AgentInvestigationRunMetadata, InvestigationReportProposalPlan } from "@archcontext/core/agent-orchestrator";
import type { ChangeOperation } from "@archcontext/core/changeset-engine";
import type { ArchitectureProjectionProfile } from "@archcontext/core/projection-engine";
import type { RecommendationFeedbackAction, RecommendationFeedbackSource } from "@archcontext/core/recommendation-engine";
import type { CompleteTaskInput } from "@archcontext/core/review-engine";
import type {
  AcceptedArchitectureChangeReferenceV1,
  AgentJobV1,
  ArchitectureActorKind,
  ExternalDocumentationProvider,
  InvestigationContextRisk,
  InvestigationContextUncertainty,
  PracticeCheckpointEvent,
  ProjectionApplyRecoveryIntentV1,
  ProjectionApplyReceiptV1,
  ProjectionRequestV1,
  RefactorRequestV1,
  RefactorVerificationRequestV1
} from "@archcontext/contracts";
import type { GitChangeSource } from "@archcontext/local-runtime/git-adapter";

export interface RuntimeCheckpointInput {
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

export interface RuntimeAgentJobEnqueueGitInput {
  source?: GitChangeSource;
  ref?: string;
  baseRef?: string;
  event?: string;
  taskSessionId?: string;
  analysisKind?: string;
  risk?: InvestigationContextRisk;
  uncertainty?: InvestigationContextUncertainty;
  policyRequestedInvestigation?: boolean;
  coalesceKey?: string;
  contextMaxItems?: number;
  cooldownMs?: number;
  debounceUntil?: string;
  maxAttempts?: number;
  priority?: number;
  maxQueuedJobs?: number;
  runnerPort?: AgentJobV1["runnerPort"];
  codeFactsDigest?: string;
  generatedProjection?: boolean;
  skipGeneratedProjection?: boolean;
}

export interface RuntimeAgentJobClaimRpcInput {
  workerId: string;
  leaseMs?: number;
  now?: string;
  maxRunningJobs?: number;
}

export interface RuntimeAgentJobCompleteRpcInput {
  jobId: string;
  status: Extract<AgentJobV1["status"], "succeeded" | "failed">;
  workerId?: string;
  outputDigest?: string;
  runMetadata?: AgentInvestigationRunMetadata;
  proposalPlan?: InvestigationReportProposalPlan;
  error?: string;
  now?: string;
}

export interface RuntimeAgentJobRetryRpcInput {
  jobId: string;
  reason?: string;
  now?: string;
}

export interface RuntimeAgentJobCancelRpcInput {
  jobId: string;
  status?: Extract<AgentJobV1["status"], "cancelled" | "superseded" | "expired">;
  reason?: string;
  supersededByJobId?: string;
  now?: string;
}

export interface RuntimeAuditRunInput {
  taskSessionId?: string;
  reason?: string;
  risk?: InvestigationContextRisk;
  uncertainty?: InvestigationContextUncertainty;
  contextMaxItems?: number;
  modelId?: string;
  timeoutMs?: number;
  /**
   * Defaults to false: `auditRun` enqueues and claims its job synchronously, then drives the
   * (multi-minute, real-claude-subprocess) investigation to completion in a detached background
   * task and returns `{status: "started", jobId}` immediately, so the RPC call itself never has to
   * stay open longer than a real HTTP client's default timeout. Pass `wait: true` to keep the
   * original fully-synchronous contract (the call does not resolve until the run reaches a
   * terminal "pending"/"failed" status) — used by callers that already run in a context with no
   * such timeout (tests, scripts that intentionally want to block).
   */
  wait?: boolean;
}

export interface RuntimeAuditApproveInput {
  runId: string;
  /**
   * Required once, verbatim, when the run's repository resolves to non-private visibility.
   * Expected shape: `public:<host>/<owner>/<repo>:<baseSha>:<runId>` (see `auditApprove`'s confirmation
   * gate) — a re-run instruction, not a secret, so it is safe to print in error messages.
   */
  confirmPublicToken?: string;
  /** Required to continue a run left in "issuing" status by a prior crashed/partial approve call. */
  resume?: boolean;
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
  generatedAt?: string;
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
  /** `show` is a read: one recommendation (recorded, or a current scan candidate) with its evidence. */
  command: "metrics" | "show" | RecommendationFeedbackAction;
  recommendationId?: string;
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
