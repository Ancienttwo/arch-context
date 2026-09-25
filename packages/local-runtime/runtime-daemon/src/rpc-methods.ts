import type { RuntimeDocsProjectionInput, RuntimeAgentContextProjectionInput, RuntimeProjectionInvocation } from "./projection-service";
import type { AgentJobV1, ExplorerDeltaQueryV2, ExplorerProjectionQueryV2, Json, JsonEnvelope, ProjectionApplyRecoveryIntentV1, ProjectionRequestV1, ReviewChallengeV2 } from "@archcontext/contracts";
import type { ArchitectureAuditRunV1 } from "@archcontext/core/architecture-ledger";
import type { DetachedReviewWorktree } from "@archcontext/local-runtime/git-adapter";
import type { DeveloperReviewAttestation, DeveloperReviewRunCleanup, DeveloperReviewRunCleanupRequest, DeveloperReviewRunPreparation, DeveloperReviewRunRecovery, ExplorerServerOptions, RuntimeAgentJobCancelRpcInput, RuntimeAgentJobClaimRpcInput, RuntimeAgentJobCompleteRpcInput, RuntimeAgentJobEnqueueGitInput, RuntimeAgentJobRetryRpcInput, RuntimeApplyUpdateInput, RuntimeAuditApproveInput, RuntimeAuditRunInput, RuntimeBookInput, RuntimeCheckpointInput, RuntimeCompleteTaskInput, RuntimeDocsInput, RuntimeLedgerMigrateInput, RuntimeLedgerProjectInput, RuntimeLedgerRebuildInput, RuntimeLedgerRollbackInput, RuntimeMcpApplyInput, RuntimeMcpApprovalInput, RuntimePlanUpdateInput, RuntimePracticeWaiverInput, RuntimeRecommendationInput, RuntimeRefactorRecordInput, RuntimeRefactorScanInput } from "./index";
import type { PracticeCatalogCommandInput } from "@archcontext/core/practice-catalog";
import type { RuntimeRefactorVerifyInput } from "./refactor-verify";
import { okEnvelope } from "@archcontext/contracts";
import { decodeStartDeveloperReviewRunParams, decodeSignedDeveloperReviewAttestationParams, decodeDeveloperReviewRunCleanupRequest, decodeRecoverDeveloperReviewRunsParams } from "./developer-review-codec";

export type RuntimeRpcTimeoutClass = "short" | "normal" | "long";

export interface RuntimeRpcMethodDefinition<Args extends unknown[], Result> {
  timeout: RuntimeRpcTimeoutClass;
  encodeArgs: (...args: Args) => Readonly<NoInfer<Args>>;
  decodeArgs: (params: unknown[]) => Args;
  encodeResponse: (result: Result) => JsonEnvelope;
  decodeResponse: (result: JsonEnvelope) => Result;
}

function envelopeMethod<Args extends unknown[]>(
  timeout: RuntimeRpcTimeoutClass,
  encodeArgs: (...args: Args) => Readonly<NoInfer<Args>>
): RuntimeRpcMethodDefinition<Args, JsonEnvelope> {
  return {
    timeout,
    encodeArgs,
    decodeArgs: (params) => params as Args,
    encodeResponse: (result) => result,
    decodeResponse: (result) => result
  };
}

function dataMethod<Args extends unknown[], Result>(
  timeout: RuntimeRpcTimeoutClass,
  requestId: string,
  encodeArgs: (...args: Args) => Readonly<NoInfer<Args>>,
  decodeArgs: (params: unknown[]) => Args,
  decodeResponse: (result: JsonEnvelope) => Result
): RuntimeRpcMethodDefinition<Args, Result> {
  return {
    timeout,
    encodeArgs,
    decodeArgs,
    encodeResponse: (result) => okEnvelope(requestId, result as unknown as Json),
    decodeResponse
  };
}

function unwrapRpcData<Result>(result: JsonEnvelope): Result {
  if (!result.ok) throw new Error(result.error?.message ?? "runtime-rpc-call-failed");
  return result.data as unknown as Result;
}

function singleRpcArgument<T>(value: T): [T] {
  return [value];
}

// Public argument types/defaults and the wire boundary are owned by each entry together.
export const RUNTIME_RPC_METHODS = {
  init: envelopeMethod("long", (root: string, productName?: string) => [root, productName] as const),
  sync: envelopeMethod("long", (root: string, changedPaths: string[] = []) => [root, changedPaths] as const),
  validate: envelopeMethod("normal", (root: string) => [root] as const),
  context: envelopeMethod("long", (root: string, task: string, maxSymbols: number = 12) => [root, task, maxSymbols] as const),
  prepare: envelopeMethod("long", (root: string, task: string, maxBytes: number = 12_288, maxItems: number = 12, taskSessionId?: string) => [root, task, maxBytes, maxItems, taskSessionId] as const),
  checkpoint: envelopeMethod("long", (root: string, input: RuntimeCheckpointInput) => [root, input] as const),
  jobsEnqueueGitHook: envelopeMethod("normal", (root: string, input: RuntimeAgentJobEnqueueGitInput = {}) => [root, input] as const),
  jobsList: envelopeMethod("short", (root: string, input: { statuses?: AgentJobV1["status"][] } = {}) => [root, input] as const),
  jobsStats: envelopeMethod("short", (root: string, input: { now?: string } = {}) => [root, input] as const),
  jobsClaim: envelopeMethod("normal", (root: string, input: RuntimeAgentJobClaimRpcInput) => [root, input] as const),
  jobsComplete: envelopeMethod("normal", (root: string, input: RuntimeAgentJobCompleteRpcInput) => [root, input] as const),
  jobsRetry: envelopeMethod("normal", (root: string, input: RuntimeAgentJobRetryRpcInput) => [root, input] as const),
  jobsCancel: envelopeMethod("normal", (root: string, input: RuntimeAgentJobCancelRpcInput) => [root, input] as const),
  auditRun: envelopeMethod("long", (root: string, input: RuntimeAuditRunInput = {}) => [root, input] as const),
  auditList: envelopeMethod("normal", (root: string, input: { statuses?: ArchitectureAuditRunV1["status"][] } = {}) => [root, input] as const),
  auditShow: envelopeMethod("normal", (root: string, runId: string) => [root, runId] as const),
  auditApprove: envelopeMethod("long", (root: string, input: RuntimeAuditApproveInput) => [root, input] as const),
  docsProjection: envelopeMethod("long", (root: string, input: RuntimeDocsProjectionInput) => [root, input] as const),
  agentContextProjection: envelopeMethod("long", (root: string, input: RuntimeAgentContextProjectionInput) => [root, input] as const),
  projection: envelopeMethod("long", (root: string, input: RuntimeProjectionInvocation) => [root, input] as const),
  approveMcpProjection: envelopeMethod("normal", (root: string, input: RuntimeProjectionInvocation) => [root, input] as const),
  mcpProjection: envelopeMethod("long", (root: string, input: RuntimeProjectionInvocation, approvalToken?: string) => [root, input, approvalToken] as const),
  docs: envelopeMethod("normal", (root: string, input: RuntimeDocsInput) => [root, input] as const),
  readResource: envelopeMethod("normal", (root: string, uri: string) => [root, uri] as const),
  practices: envelopeMethod("normal", (root: string, input: PracticeCatalogCommandInput) => [root, input] as const),
  practiceWaivers: envelopeMethod("normal", (root: string) => [root] as const),
  planPracticeWaiver: envelopeMethod("normal", (root: string, input: RuntimePracticeWaiverInput) => [root, input] as const),
  planUpdate: envelopeMethod("normal", (root: string, input: RuntimePlanUpdateInput) => [root, input] as const),
  completeTask: envelopeMethod("normal", (root: string, input: RuntimeCompleteTaskInput = {}) => [root, input] as const),
  applyUpdate: envelopeMethod("normal", (root: string, input: RuntimeApplyUpdateInput) => [root, input] as const),
  approveMcpUpdate: envelopeMethod("normal", (root: string, input: RuntimeMcpApprovalInput) => [root, input] as const),
  applyMcpUpdate: envelopeMethod("normal", (root: string, input: RuntimeMcpApplyInput) => [root, input] as const),
  inspectProjectionApplyReceipt: envelopeMethod("normal", (root: string, lookupKey: string) => [root, lookupKey] as const),
  listProjectionPriorCommittedApplies: envelopeMethod("normal", (root: string, requestId: string) => [root, requestId] as const),
  recoverProjectionApply: envelopeMethod("normal", (root: string, intent: ProjectionApplyRecoveryIntentV1) => [root, intent] as const),
  readbackProjectionApply: envelopeMethod("normal", (root: string, request: ProjectionRequestV1) => [root, request] as const),
  ledgerState: envelopeMethod("short", (root: string) => [root] as const),
  ledgerDrift: envelopeMethod("short", (root: string) => [root] as const),
  ledgerProject: envelopeMethod("normal", (root: string, input: RuntimeLedgerProjectInput = { dryRun: true }) => [root, input] as const),
  ledgerMigrate: envelopeMethod("long", (root: string, input: RuntimeLedgerMigrateInput = { dryRun: true }) => [root, input] as const),
  ledgerRebuild: envelopeMethod("long", (root: string, input: RuntimeLedgerRebuildInput = {}) => [root, input] as const),
  ledgerRollback: envelopeMethod("normal", (root: string, input: RuntimeLedgerRollbackInput = { dryRun: true }) => [root, input] as const),
  book: envelopeMethod("long", (root: string, input: RuntimeBookInput = {}) => [root, input] as const),
  recommendations: envelopeMethod("long", (root: string, input: RuntimeRecommendationInput) => [root, input] as const),
  refactorScan: envelopeMethod("long", (root: string, input: RuntimeRefactorScanInput = {}) => [root, input] as const),
  refactorRecord: envelopeMethod("normal", (root: string, input: RuntimeRefactorRecordInput) => [root, input] as const),
  refactorVerify: envelopeMethod("long", (root: string, input: RuntimeRefactorVerifyInput) => [root, input] as const),
  repoAdd: envelopeMethod("normal", (root: string, name?: string) => [root, name] as const),
  repoList: envelopeMethod("short", () => [] as const),
  repoRemove: envelopeMethod("normal", (repositoryId: string) => [repositoryId] as const),
  landscapeStatus: envelopeMethod("short", () => [] as const),
  explorerServiceContract: envelopeMethod("short", (tokenTtlSeconds: number = 900) => [tokenTtlSeconds] as const),
  explorerProjectionV2: envelopeMethod("normal", (root: string, query: ExplorerProjectionQueryV2) => [root, query] as const),
  explorerProjectionDelta: envelopeMethod("normal", (root: string, query: ExplorerDeltaQueryV2) => [root, query] as const),
  startExplorer: envelopeMethod("normal", (root: string, options: ExplorerServerOptions = {}) => [root, options] as const),
  stopExplorer: envelopeMethod("short", () => [] as const),
  revokeExplorerToken: envelopeMethod("short", () => [] as const),
  explorerStatus: envelopeMethod("short", () => [] as const),
  contextLandscape: envelopeMethod("normal", (task: string, maxSymbols: number = 12) => [task, maxSymbols] as const),
  runtimeStatus: envelopeMethod("short", (root?: string) => [root] as const),
  // These inputs authorize filesystem operations. Keep strict decoders, including unknown-field rejection.
  startDeveloperReviewRun: dataMethod("long", "developerReview.startRun", (input: {
    repositoryRoot: string;
    challenge: ReviewChallengeV2;
    expectedHeadTreeOid?: string;
  }) => [input] as const, (params) => singleRpcArgument(decodeStartDeveloperReviewRunParams(params)), unwrapRpcData<DeveloperReviewRunPreparation>),
  runSignedDeveloperReviewAttestation: dataMethod("long", "developerReview.attestation", (input: {
    challenge: ReviewChallengeV2;
    worktree: DetachedReviewWorktree;
    keyRef: string;
    principalId: string;
    publicKeyId: string;
    taskSessionId?: string;
    mergeBaseSha?: string;
    startedAt?: string;
    completedAt?: string;
  }) => [input] as const, (params) => singleRpcArgument(decodeSignedDeveloperReviewAttestationParams(params)), unwrapRpcData<DeveloperReviewAttestation>),
  cleanupDeveloperReviewRun: dataMethod("normal", "developerReview.cleanupRun", (input: DeveloperReviewRunCleanupRequest) => [input] as const, (params) => singleRpcArgument(decodeDeveloperReviewRunCleanupRequest(params[0])), unwrapRpcData<DeveloperReviewRunCleanup>),
  recoverDeveloperReviewRuns: dataMethod("normal", "developerReview.recoverRuns", (input: {
    repositoryRoot: string;
    force?: boolean;
  }) => [input] as const, (params) => singleRpcArgument(decodeRecoverDeveloperReviewRunsParams(params)), unwrapRpcData<DeveloperReviewRunRecovery>)
};

export type RuntimeRpcMethodName = keyof typeof RUNTIME_RPC_METHODS;
export type RuntimeRpcParameters<Method extends RuntimeRpcMethodName> = Parameters<(typeof RUNTIME_RPC_METHODS)[Method]["encodeArgs"]>;
export type RuntimeRpcResult<Method extends RuntimeRpcMethodName> = ReturnType<(typeof RUNTIME_RPC_METHODS)[Method]["decodeResponse"]>;

export type RuntimeDaemonMethods = {
  [Method in RuntimeRpcMethodName]: (...args: RuntimeRpcParameters<Method>) => RuntimeRpcResult<Method> | Promise<RuntimeRpcResult<Method>>;
};

export type RuntimeRpcClientMethods = {
  [Method in RuntimeRpcMethodName]: (...args: RuntimeRpcParameters<Method>) => Promise<RuntimeRpcResult<Method>>;
};

// Reflection erases individual tuples only after the method name is checked against this table.
export function runtimeRpcMethod(method: string): RuntimeRpcMethodDefinition<any[], any> | undefined {
  return Object.hasOwn(RUNTIME_RPC_METHODS, method) ? RUNTIME_RPC_METHODS[method as RuntimeRpcMethodName] : undefined;
}
