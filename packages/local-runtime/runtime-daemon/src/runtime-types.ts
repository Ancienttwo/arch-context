import type { ChangeOperation } from "@archcontext/core/changeset-engine";
import type { PracticeCatalogCommandInput } from "@archcontext/core/practice-catalog";
import type { ArchitectureProjectionProfile } from "@archcontext/core/projection-engine";
import type { RecommendationFeedbackAction, RecommendationFeedbackSource, RecommendationStatus } from "@archcontext/core/recommendation-engine";
import type { CompleteTaskInput } from "@archcontext/core/review-engine";
import type {
  AcceptedArchitectureChangeReferenceV1,
  ArchitectureActorKind,
  ExternalDocumentationProvider,
  JsonEnvelope,
  PracticeCheckpointEvent,
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

export type RuntimeProjectionInvocation = { action: "run"; request: ProjectionRequestV1 };

export interface RuntimeRecommendationInput {
  command: "metrics" | "show" | "list" | RecommendationFeedbackAction;
  recommendationId?: string;
  status?: RecommendationStatus;
  reason?: string;
  evidenceDigest?: string;
  actor?: string;
  actorKind?: ArchitectureActorKind;
  source?: RecommendationFeedbackSource;
  expectedWorktreeDigest?: string;
  importNodeLimit?: number;
  snapshotDigest?: string;
  approved?: boolean;
  agentJobId?: string;
  now?: string;
}

export interface RuntimeRefactorScanInput {
  request?: RefactorRequestV1;
}

export interface RuntimeRefactorRecordInput {
  assessmentDigest: string;
  expectedWorktreeDigest: string;
}

export type RuntimeRefactorVerifyInput = RefactorVerificationRequestV1;

export interface LocalRuntimeClient {
  init(root: string, productName?: string): Promise<JsonEnvelope>;
  sync(root: string, changedPaths?: string[]): Promise<JsonEnvelope>;
  validate(root: string): Promise<JsonEnvelope>;
  context(root: string, task: string, maxSymbols?: number): Promise<JsonEnvelope>;
  prepare(root: string, task: string, maxBytes?: number, maxItems?: number, taskSessionId?: string): Promise<JsonEnvelope>;
  practiceCheckpoint(root: string, input: RuntimePracticeCheckpointInput): Promise<JsonEnvelope>;
  planPracticeWaiver(root: string, input: RuntimePracticeWaiverInput): Promise<JsonEnvelope>;
  practices(root: string, input: PracticeCatalogCommandInput): JsonEnvelope;
  practiceWaivers(root: string): JsonEnvelope;
  docs(root: string, input: RuntimeDocsInput): Promise<JsonEnvelope>;
  readResource(root: string, uri: string): Promise<JsonEnvelope>;
  planUpdate(root: string, input: RuntimePlanUpdateInput): Promise<JsonEnvelope>;
  applyUpdate(root: string, input: RuntimeApplyUpdateInput): Promise<JsonEnvelope>;
  docsProjection(root: string, input: RuntimeDocsProjectionInput): Promise<JsonEnvelope>;
  agentContextProjection(root: string, input: RuntimeAgentContextProjectionInput): Promise<JsonEnvelope>;
  projection(root: string, input: RuntimeProjectionInvocation): Promise<JsonEnvelope>;
  recommendations(root: string, input: RuntimeRecommendationInput): Promise<JsonEnvelope>;
  refactorScan(root: string, input?: RuntimeRefactorScanInput): Promise<JsonEnvelope>;
  refactorRecord(root: string, input: RuntimeRefactorRecordInput): Promise<JsonEnvelope>;
  refactorVerify(root: string, input: RuntimeRefactorVerifyInput): Promise<JsonEnvelope>;
  completeTask(root: string, input?: RuntimeCompleteTaskInput): Promise<JsonEnvelope>;
  reviewTask(root: string, input?: { taskSessionId?: string; task?: string; posture?: CompleteTaskInput["posture"]; headSha?: string; changedPaths?: string[]; changeSource?: GitChangeSource; cleanupRequired?: number; cleanupCompleted?: number }): Promise<JsonEnvelope>;
  repoAdd(root: string, name?: string): Promise<JsonEnvelope>;
  repoList(): Promise<JsonEnvelope>;
  repoRemove(repositoryId: string): Promise<JsonEnvelope>;
  landscapeStatus(): Promise<JsonEnvelope>;
  contextLandscape(task: string, maxSymbols?: number): Promise<JsonEnvelope>;
  explorerProjectionV2(root: string, query: import("@archcontext/contracts").ExplorerProjectionQueryV2): Promise<JsonEnvelope>;
  explorerProjectionDelta(root: string, query: import("@archcontext/contracts").ExplorerDeltaQueryV2): Promise<JsonEnvelope>;
  explorerStatus(): JsonEnvelope;
  explorerServiceContract(tokenTtlSeconds?: number): JsonEnvelope;
  startExplorer(root: string, options?: ExplorerServerOptions): Promise<JsonEnvelope>;
  stopExplorer(): Promise<JsonEnvelope>;
  revokeExplorerToken(): Promise<JsonEnvelope>;
  runtimeStatus(root?: string): Promise<JsonEnvelope>;
  egressReport(root: string): Promise<unknown>;
  stop(): Promise<void>;
}

/** @deprecated Alias kept during Stage 3–4 daemonless migration. */
export type RuntimeDaemonClient = LocalRuntimeClient;
