import { LOCAL_RUNTIME_RPC_SCHEMA_VERSION } from "@archcontext/contracts";
import type { AgentJobV1, ExplorerDeltaQueryV2, ExplorerProjectionQueryV2, JsonEnvelope, ProjectionApplyRecoveryIntentV1, ProjectionRequestV1, ReviewChallengeV2 } from "@archcontext/contracts";
import type { ArchitectureAuditRunV1 } from "@archcontext/core/architecture-ledger";
import type { DetachedReviewWorktree } from "@archcontext/local-runtime/git-adapter";
import type { DeveloperReviewAttestation, DeveloperReviewRunCleanup, DeveloperReviewRunCleanupRequest, DeveloperReviewRunPreparation, DeveloperReviewRunRecovery, ExplorerServerOptions, RuntimeAgentJobCancelRpcInput, RuntimeAgentJobClaimRpcInput, RuntimeAgentJobCompleteRpcInput, RuntimeAgentJobEnqueueGitInput, RuntimeAgentJobRetryRpcInput, RuntimeApplyUpdateInput, RuntimeAuditApproveInput, RuntimeAuditRunInput, RuntimeBookInput, RuntimeCheckpointInput, RuntimeCompleteTaskInput, RuntimeDocsInput, RuntimeLedgerMigrateInput, RuntimeLedgerProjectInput, RuntimeLedgerRebuildInput, RuntimeLedgerRollbackInput, RuntimeMcpApplyInput, RuntimeMcpApprovalInput, RuntimePlanUpdateInput, RuntimePracticeWaiverInput, RuntimeRecommendationInput, RuntimeRefactorRecordInput, RuntimeRefactorScanInput } from "./index";
import type { PracticeCatalogCommandInput } from "@archcontext/core/practice-catalog";
import type { RuntimeRefactorVerifyInput } from "./refactor-verify";

export const RUNTIME_RPC_VERSION = LOCAL_RUNTIME_RPC_SCHEMA_VERSION;

export interface RuntimeRpcConnection {
  schemaVersion: typeof RUNTIME_RPC_VERSION;
  protocol: "http-loopback";
  version: 1;
  root: string;
  url: string;
  token: string;
  pid: number;
  lockPath: string;
  connectionPath: string;
  startedAt: string;
}

export interface RuntimeRpcConnectionFile {
  schemaVersion?: string;
  protocol?: string;
  version?: number;
  root?: string;
  url?: string;
  token?: string;
  pid?: number;
  lockPath?: string;
  connectionPath?: string;
  startedAt?: string;
}

export interface RuntimeRpcCompatibilityIssue {
  reason: "rpc-version-mismatch" | "product-version-mismatch" | "stale-daemon-entry";
  expected: string;
  received: string;
  connectionPath: string;
  lockPath: string;
  pid?: number;
  pidAlive: boolean;
  upgradeCommand: "archctx daemon upgrade";
}

export interface RuntimeDaemonClient {
  init(root: string, productName?: string): Promise<JsonEnvelope> | JsonEnvelope;
  sync(root: string, changedPaths?: string[]): Promise<JsonEnvelope> | JsonEnvelope;
  validate(root: string): Promise<JsonEnvelope> | JsonEnvelope;
  context(root: string, task: string, maxSymbols?: number): Promise<JsonEnvelope> | JsonEnvelope;
  prepare(root: string, task: string, maxBytes?: number, maxItems?: number, taskSessionId?: string): Promise<JsonEnvelope> | JsonEnvelope;
  checkpoint(root: string, input: RuntimeCheckpointInput): Promise<JsonEnvelope> | JsonEnvelope;
  jobsEnqueueGitHook(root: string, input?: RuntimeAgentJobEnqueueGitInput): Promise<JsonEnvelope> | JsonEnvelope;
  jobsList(root: string, input?: { statuses?: AgentJobV1["status"][] }): Promise<JsonEnvelope> | JsonEnvelope;
  jobsStats(root: string, input?: { now?: string }): Promise<JsonEnvelope> | JsonEnvelope;
  jobsClaim(root: string, input: RuntimeAgentJobClaimRpcInput): Promise<JsonEnvelope> | JsonEnvelope;
  jobsComplete(root: string, input: RuntimeAgentJobCompleteRpcInput): Promise<JsonEnvelope> | JsonEnvelope;
  jobsRetry(root: string, input: RuntimeAgentJobRetryRpcInput): Promise<JsonEnvelope> | JsonEnvelope;
  jobsCancel(root: string, input: RuntimeAgentJobCancelRpcInput): Promise<JsonEnvelope> | JsonEnvelope;
  auditRun(root: string, input?: RuntimeAuditRunInput): Promise<JsonEnvelope> | JsonEnvelope;
  auditList(root: string, input?: { statuses?: ArchitectureAuditRunV1["status"][] }): Promise<JsonEnvelope> | JsonEnvelope;
  auditShow(root: string, runId: string): Promise<JsonEnvelope> | JsonEnvelope;
  auditApprove(root: string, input: RuntimeAuditApproveInput): Promise<JsonEnvelope> | JsonEnvelope;
  docs(root: string, input: RuntimeDocsInput): Promise<JsonEnvelope> | JsonEnvelope;
  readResource(root: string, uri: string): Promise<JsonEnvelope> | JsonEnvelope;
  practices(root: string, input: PracticeCatalogCommandInput): Promise<JsonEnvelope> | JsonEnvelope;
  practiceWaivers(root: string): Promise<JsonEnvelope> | JsonEnvelope;
  planPracticeWaiver(root: string, input: RuntimePracticeWaiverInput): Promise<JsonEnvelope> | JsonEnvelope;
  planUpdate(root: string, input: RuntimePlanUpdateInput): Promise<JsonEnvelope> | JsonEnvelope;
  completeTask(root: string, input?: RuntimeCompleteTaskInput): Promise<JsonEnvelope> | JsonEnvelope;
  applyUpdate(root: string, input: RuntimeApplyUpdateInput): Promise<JsonEnvelope> | JsonEnvelope;
  approveMcpUpdate(root: string, input: RuntimeMcpApprovalInput): Promise<JsonEnvelope> | JsonEnvelope;
  applyMcpUpdate(root: string, input: RuntimeMcpApplyInput): Promise<JsonEnvelope> | JsonEnvelope;
  inspectProjectionApplyReceipt(root: string, lookupKey: string): Promise<JsonEnvelope> | JsonEnvelope;
  listProjectionPriorCommittedApplies(root: string, requestId: string): Promise<JsonEnvelope> | JsonEnvelope;
  recoverProjectionApply(root: string, intent: ProjectionApplyRecoveryIntentV1): Promise<JsonEnvelope> | JsonEnvelope;
  readbackProjectionApply(root: string, request: ProjectionRequestV1): Promise<JsonEnvelope> | JsonEnvelope;
  ledgerState(root: string): Promise<JsonEnvelope> | JsonEnvelope;
  ledgerDrift(root: string): Promise<JsonEnvelope> | JsonEnvelope;
  ledgerProject(root: string, input?: RuntimeLedgerProjectInput): Promise<JsonEnvelope> | JsonEnvelope;
  ledgerMigrate(root: string, input?: RuntimeLedgerMigrateInput): Promise<JsonEnvelope> | JsonEnvelope;
  ledgerRebuild(root: string, input?: RuntimeLedgerRebuildInput): Promise<JsonEnvelope> | JsonEnvelope;
  ledgerRollback(root: string, input?: RuntimeLedgerRollbackInput): Promise<JsonEnvelope> | JsonEnvelope;
  book(root: string, input?: RuntimeBookInput): Promise<JsonEnvelope> | JsonEnvelope;
  recommendations(root: string, input: RuntimeRecommendationInput): Promise<JsonEnvelope> | JsonEnvelope;
  refactorScan(root: string, input?: RuntimeRefactorScanInput): Promise<JsonEnvelope> | JsonEnvelope;
  refactorRecord(root: string, input: RuntimeRefactorRecordInput): Promise<JsonEnvelope> | JsonEnvelope;
  refactorVerify(root: string, input: RuntimeRefactorVerifyInput): Promise<JsonEnvelope> | JsonEnvelope;
  repoAdd(root: string, name?: string): Promise<JsonEnvelope> | JsonEnvelope;
  repoList(): Promise<JsonEnvelope> | JsonEnvelope;
  repoRemove(repositoryId: string): Promise<JsonEnvelope> | JsonEnvelope;
  landscapeStatus(): Promise<JsonEnvelope> | JsonEnvelope;
  explorerServiceContract(tokenTtlSeconds?: number): Promise<JsonEnvelope> | JsonEnvelope;
  explorerProjectionV2(root: string, query: ExplorerProjectionQueryV2): Promise<JsonEnvelope> | JsonEnvelope;
  explorerProjectionDelta(root: string, query: ExplorerDeltaQueryV2): Promise<JsonEnvelope> | JsonEnvelope;
  startExplorer(root: string, options?: ExplorerServerOptions): Promise<JsonEnvelope> | JsonEnvelope;
  stopExplorer(): Promise<JsonEnvelope> | JsonEnvelope;
  revokeExplorerToken(): Promise<JsonEnvelope> | JsonEnvelope;
  explorerStatus(): Promise<JsonEnvelope> | JsonEnvelope;
  contextLandscape(task: string, maxSymbols?: number): Promise<JsonEnvelope> | JsonEnvelope;
  runtimeStatus(root?: string): Promise<JsonEnvelope> | JsonEnvelope;
  startDeveloperReviewRun(input: {
    repositoryRoot: string;
    challenge: ReviewChallengeV2;
    expectedHeadTreeOid?: string;
  }): Promise<DeveloperReviewRunPreparation> | DeveloperReviewRunPreparation;
  runSignedDeveloperReviewAttestation(input: {
    challenge: ReviewChallengeV2;
    worktree: DetachedReviewWorktree;
    keyRef: string;
    principalId: string;
    publicKeyId: string;
    taskSessionId?: string;
    mergeBaseSha?: string;
    startedAt?: string;
    completedAt?: string;
  }): Promise<DeveloperReviewAttestation> | DeveloperReviewAttestation;
  cleanupDeveloperReviewRun(input: DeveloperReviewRunCleanupRequest): Promise<DeveloperReviewRunCleanup> | DeveloperReviewRunCleanup;
  recoverDeveloperReviewRuns(input: {
    repositoryRoot: string;
    force?: boolean;
  }): Promise<DeveloperReviewRunRecovery> | DeveloperReviewRunRecovery;
}
