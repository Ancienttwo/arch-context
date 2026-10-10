import type { AgentJobV1, ExplorerDeltaQueryV2, ExplorerProjectionQueryV2, Json, JsonEnvelope, ProjectionApplyRecoveryIntentV1, ProjectionRequestV1, ReviewChallengeV2 } from "@archcontext/contracts";
import type { ArchitectureAuditRunV1 } from "@archcontext/core/architecture-ledger";
import type { DetachedReviewWorktree } from "@archcontext/local-runtime/git-adapter";
import type { DeveloperReviewAttestation, DeveloperReviewRunCleanup, DeveloperReviewRunCleanupRequest, DeveloperReviewRunPreparation, DeveloperReviewRunRecovery } from "./developer-review-codec";
import type { ExplorerServerOptions, RuntimeAcceptCommittedChangeInput, RuntimeAgentContextProjectionInput, RuntimeAgentJobCancelRpcInput, RuntimeAgentJobClaimRpcInput, RuntimeAgentJobCompleteRpcInput, RuntimeAgentJobEnqueueGitInput, RuntimeAgentJobRetryRpcInput, RuntimeApplyUpdateInput, RuntimeAuditApproveInput, RuntimeAuditRunInput, RuntimeBookInput, RuntimeCheckpointInput, RuntimeCompleteTaskInput, RuntimeDocsInput, RuntimeDocsProjectionInput, RuntimeLedgerMigrateInput, RuntimeLedgerProjectInput, RuntimeLedgerRebuildInput, RuntimeLedgerRollbackInput, RuntimePlanUpdateInput, RuntimePracticeWaiverInput, RuntimeProjectionInvocation, RuntimeRecommendationInput, RuntimeRefactorRecordInput, RuntimeRefactorScanInput, RuntimeRefactorVerifyInput } from "./rpc-types";
import type { PracticeCatalogCommandInput } from "@archcontext/core/practice-catalog";
import { okEnvelope } from "@archcontext/contracts";
import { decodeStartDeveloperReviewRunParams, decodeSignedDeveloperReviewAttestationParams, decodeDeveloperReviewRunCleanupRequest, decodeRecoverDeveloperReviewRunsParams } from "./developer-review-codec";
import { rpcInputInvalid, rpcOptionalNumber, rpcOptionalObject, rpcOptionalString, rpcOptionalStringArray, rpcRequiredBoolean, rpcRequiredObject, rpcRequiredString } from "./rpc-argument-codec";

export type RuntimeRpcTimeoutClass = "short" | "normal" | "long";

export interface RuntimeRpcMethodDefinition<Args extends unknown[], Result> {
  timeout: RuntimeRpcTimeoutClass;
  encodeArgs: (...args: Args) => Readonly<NoInfer<Args>>;
  decodeArgs: (params: unknown[]) => Args;
  encodeResponse: (result: Result) => JsonEnvelope;
  decodeResponse: (result: JsonEnvelope) => Result;
}

/**
 * `decodeArgs` is mandatory (no blind `params as Args` fallback): every table entry supplies its
 * own runtime decoder for its positional params. See rpc-argument-codec.ts for the shared helpers;
 * invalid input throws `RuntimeRpcInputInvalidError`, which rpc-server.ts's dispatch catch maps to
 * a structured `AC_SCHEMA_INVALID` envelope.
 *
 * `name` gates the wire-level container shape before any of that per-slot decoding runs: `params`
 * itself must be an array. Without this, a non-array `params` (a string, or an object such as
 * `{"0": "..."}`) still supports numeric indexing in JS, so `rpcRequiredString(params, 0, ...)`
 * silently reads a plausible-looking value instead of failing — `"/tmp/x"[0]` is the character
 * `"/"`, not the first real argument. This has to live here (once per method, wrapping whatever
 * `decodeArgs` the entry provides) rather than in a shared helper each entry calls individually,
 * because by the time any individual `rpcRequiredString`/`rpcRequiredObject`/... call runs, it has
 * already indexed into `params` — the check must happen before the first one does.
 */
function envelopeMethod<Args extends unknown[]>(
  name: string,
  timeout: RuntimeRpcTimeoutClass,
  encodeArgs: (...args: Args) => Readonly<NoInfer<Args>>,
  // `NoInfer` here keeps `Args` inferred solely from `encodeArgs` (as before this table had a
  // `decodeArgs` parameter at all), which is what keeps defaulted/optional client-facing
  // parameters (e.g. `auditRun(root, input = {})`) optional in `RuntimeDaemonClient`/
  // `RuntimeRpcClientMethods`. Without it, TypeScript unifies `Args` across both parameters and
  // widens optional trailing members to required ones, which is exactly the public-type drift
  // rpc-methods.types.ts guards against.
  decodeArgs: (params: unknown[]) => NoInfer<Args>
): RuntimeRpcMethodDefinition<Args, JsonEnvelope> {
  return {
    timeout,
    encodeArgs,
    decodeArgs: (params) => {
      if (!Array.isArray(params)) throw rpcInputInvalid(name, "params must be an array");
      return decodeArgs(params);
    },
    encodeResponse: (result) => result,
    decodeResponse: (result) => result
  };
}

function dataMethod<Args extends unknown[], Result>(
  timeout: RuntimeRpcTimeoutClass,
  requestId: string,
  encodeArgs: (...args: Args) => Readonly<NoInfer<Args>>,
  // See the matching `NoInfer` note on `envelopeMethod`'s `decodeArgs` parameter.
  decodeArgs: (params: unknown[]) => NoInfer<Args>,
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

/**
 * Rest-tuple identity, the multi-argument sibling of `singleRpcArgument`: a plain array literal
 * (`[a, b]`) returned from a function whose declared return type is a generic `Args extends
 * unknown[]` widens to `(A | B)[]`, which then fails to satisfy the exact positional tuple
 * `decodeArgs: (params: unknown[]) => Args` expects. A generic rest parameter is inferred
 * positionally instead, so wrapping the same call-site arguments here (`rpcArgs(a, b)`) keeps the
 * tuple shape.
 */
function rpcArgs<Args extends unknown[]>(...args: Args): Args {
  return args;
}

// Public argument types/defaults and the wire boundary are owned by each entry together.
export const RUNTIME_RPC_METHODS = {
  init: envelopeMethod("init", "long", (root: string, productName?: string) => [root, productName] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "init", "root"),
    rpcOptionalString(params, 1, "init", "productName")
  )),
  sync: envelopeMethod("sync", "long", (root: string, changedPaths: string[] = []) => [root, changedPaths] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "sync", "root"),
    rpcOptionalStringArray(params, 1, "sync", "changedPaths")
  )),
  validate: envelopeMethod("validate", "normal", (root: string) => [root] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "validate", "root")
  )),
  context: envelopeMethod("context", "long", (root: string, task: string, maxSymbols: number = 12) => [root, task, maxSymbols] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "context", "root"),
    rpcRequiredString(params, 1, "context", "task"),
    rpcOptionalNumber(params, 2, "context", "maxSymbols")
  )),
  prepare: envelopeMethod("prepare", "long", (root: string, task: string, maxBytes: number = 12_288, maxItems: number = 12, taskSessionId?: string) => [root, task, maxBytes, maxItems, taskSessionId] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "prepare", "root"),
    rpcRequiredString(params, 1, "prepare", "task"),
    rpcOptionalNumber(params, 2, "prepare", "maxBytes"),
    rpcOptionalNumber(params, 3, "prepare", "maxItems"),
    rpcOptionalString(params, 4, "prepare", "taskSessionId")
  )),
  checkpoint: envelopeMethod("checkpoint", "long", (root: string, input: RuntimeCheckpointInput) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "checkpoint", "root"),
    rpcRequiredObject<RuntimeCheckpointInput>(params, 1, "checkpoint", "input")
  )),
  jobsEnqueueGitHook: envelopeMethod("jobsEnqueueGitHook", "normal", (root: string, input: RuntimeAgentJobEnqueueGitInput = {}) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "jobsEnqueueGitHook", "root"),
    rpcOptionalObject<RuntimeAgentJobEnqueueGitInput>(params, 1, "jobsEnqueueGitHook", "input")
  )),
  jobsList: envelopeMethod("jobsList", "short", (root: string, input: { statuses?: AgentJobV1["status"][] } = {}) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "jobsList", "root"),
    rpcOptionalObject<{ statuses?: AgentJobV1["status"][] }>(params, 1, "jobsList", "input")
  )),
  jobsStats: envelopeMethod("jobsStats", "short", (root: string, input: { now?: string } = {}) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "jobsStats", "root"),
    rpcOptionalObject<{ now?: string }>(params, 1, "jobsStats", "input")
  )),
  jobsClaim: envelopeMethod("jobsClaim", "normal", (root: string, input: RuntimeAgentJobClaimRpcInput) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "jobsClaim", "root"),
    rpcRequiredObject<RuntimeAgentJobClaimRpcInput>(params, 1, "jobsClaim", "input")
  )),
  jobsComplete: envelopeMethod("jobsComplete", "normal", (root: string, input: RuntimeAgentJobCompleteRpcInput) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "jobsComplete", "root"),
    rpcRequiredObject<RuntimeAgentJobCompleteRpcInput>(params, 1, "jobsComplete", "input")
  )),
  jobsRetry: envelopeMethod("jobsRetry", "normal", (root: string, input: RuntimeAgentJobRetryRpcInput) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "jobsRetry", "root"),
    rpcRequiredObject<RuntimeAgentJobRetryRpcInput>(params, 1, "jobsRetry", "input")
  )),
  jobsCancel: envelopeMethod("jobsCancel", "normal", (root: string, input: RuntimeAgentJobCancelRpcInput) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "jobsCancel", "root"),
    rpcRequiredObject<RuntimeAgentJobCancelRpcInput>(params, 1, "jobsCancel", "input")
  )),
  auditRun: envelopeMethod("auditRun", "long", (root: string, input: RuntimeAuditRunInput = {}) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "auditRun", "root"),
    rpcOptionalObject<RuntimeAuditRunInput>(params, 1, "auditRun", "input")
  )),
  auditList: envelopeMethod("auditList", "normal", (root: string, input: { statuses?: ArchitectureAuditRunV1["status"][] } = {}) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "auditList", "root"),
    rpcOptionalObject<{ statuses?: ArchitectureAuditRunV1["status"][] }>(params, 1, "auditList", "input")
  )),
  auditShow: envelopeMethod("auditShow", "normal", (root: string, runId: string) => [root, runId] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "auditShow", "root"),
    rpcRequiredString(params, 1, "auditShow", "runId")
  )),
  auditApprove: envelopeMethod("auditApprove", "long", (root: string, input: RuntimeAuditApproveInput) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "auditApprove", "root"),
    rpcRequiredObject<RuntimeAuditApproveInput>(params, 1, "auditApprove", "input")
  )),
  docsProjection: envelopeMethod("docsProjection", "long", (root: string, input: RuntimeDocsProjectionInput) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "docsProjection", "root"),
    rpcRequiredObject<RuntimeDocsProjectionInput>(params, 1, "docsProjection", "input")
  )),
  agentContextProjection: envelopeMethod("agentContextProjection", "long", (root: string, input: RuntimeAgentContextProjectionInput) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "agentContextProjection", "root"),
    rpcRequiredObject<RuntimeAgentContextProjectionInput>(params, 1, "agentContextProjection", "input")
  )),
  projection: envelopeMethod("projection", "long", (root: string, input: RuntimeProjectionInvocation) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "projection", "root"),
    rpcRequiredObject<RuntimeProjectionInvocation>(params, 1, "projection", "input")
  )),
  mcpProjection: envelopeMethod("mcpProjection", "long", (root: string, input: RuntimeProjectionInvocation, approved: boolean) => [root, input, approved] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "mcpProjection", "root"),
    rpcRequiredObject<RuntimeProjectionInvocation>(params, 1, "mcpProjection", "input"),
    rpcRequiredBoolean(params, 2, "mcpProjection", "approved")
  )),
  docs: envelopeMethod("docs", "normal", (root: string, input: RuntimeDocsInput) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "docs", "root"),
    rpcRequiredObject<RuntimeDocsInput>(params, 1, "docs", "input")
  )),
  readResource: envelopeMethod("readResource", "normal", (root: string, uri: string) => [root, uri] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "readResource", "root"),
    rpcRequiredString(params, 1, "readResource", "uri")
  )),
  practices: envelopeMethod("practices", "normal", (root: string, input: PracticeCatalogCommandInput) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "practices", "root"),
    rpcRequiredObject<PracticeCatalogCommandInput>(params, 1, "practices", "input")
  )),
  practiceWaivers: envelopeMethod("practiceWaivers", "normal", (root: string) => [root] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "practiceWaivers", "root")
  )),
  planPracticeWaiver: envelopeMethod("planPracticeWaiver", "normal", (root: string, input: RuntimePracticeWaiverInput) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "planPracticeWaiver", "root"),
    rpcRequiredObject<RuntimePracticeWaiverInput>(params, 1, "planPracticeWaiver", "input")
  )),
  planUpdate: envelopeMethod("planUpdate", "normal", (root: string, input: RuntimePlanUpdateInput) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "planUpdate", "root"),
    rpcRequiredObject<RuntimePlanUpdateInput>(params, 1, "planUpdate", "input")
  )),
  completeTask: envelopeMethod("completeTask", "normal", (root: string, input: RuntimeCompleteTaskInput = {}) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "completeTask", "root"),
    rpcOptionalObject<RuntimeCompleteTaskInput>(params, 1, "completeTask", "input")
  )),
  applyUpdate: envelopeMethod("applyUpdate", "normal", (root: string, input: RuntimeApplyUpdateInput) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "applyUpdate", "root"),
    rpcRequiredObject<RuntimeApplyUpdateInput>(params, 1, "applyUpdate", "input")
  )),
  inspectProjectionApplyReceipt: envelopeMethod("inspectProjectionApplyReceipt", "normal", (root: string, lookupKey: string) => [root, lookupKey] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "inspectProjectionApplyReceipt", "root"),
    rpcRequiredString(params, 1, "inspectProjectionApplyReceipt", "lookupKey")
  )),
  listProjectionPriorCommittedApplies: envelopeMethod("listProjectionPriorCommittedApplies", "normal", (root: string, requestId: string) => [root, requestId] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "listProjectionPriorCommittedApplies", "root"),
    rpcRequiredString(params, 1, "listProjectionPriorCommittedApplies", "requestId")
  )),
  recoverProjectionApply: envelopeMethod("recoverProjectionApply", "normal", (root: string, intent: ProjectionApplyRecoveryIntentV1) => [root, intent] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "recoverProjectionApply", "root"),
    rpcRequiredObject<ProjectionApplyRecoveryIntentV1>(params, 1, "recoverProjectionApply", "intent")
  )),
  readbackProjectionApply: envelopeMethod("readbackProjectionApply", "normal", (root: string, request: ProjectionRequestV1) => [root, request] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "readbackProjectionApply", "root"),
    rpcRequiredObject<ProjectionRequestV1>(params, 1, "readbackProjectionApply", "request")
  )),
  ledgerState: envelopeMethod("ledgerState", "short", (root: string) => [root] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "ledgerState", "root")
  )),
  ledgerDrift: envelopeMethod("ledgerDrift", "short", (root: string) => [root] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "ledgerDrift", "root")
  )),
  acceptCommittedChange: envelopeMethod("acceptCommittedChange", "long", (root: string, input: RuntimeAcceptCommittedChangeInput) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "acceptCommittedChange", "root"),
    rpcRequiredObject<RuntimeAcceptCommittedChangeInput>(params, 1, "acceptCommittedChange", "input")
  )),
  ledgerProject: envelopeMethod("ledgerProject", "normal", (root: string, input: RuntimeLedgerProjectInput = { dryRun: true }) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "ledgerProject", "root"),
    rpcOptionalObject<RuntimeLedgerProjectInput>(params, 1, "ledgerProject", "input")
  )),
  ledgerMigrate: envelopeMethod("ledgerMigrate", "long", (root: string, input: RuntimeLedgerMigrateInput = { dryRun: true }) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "ledgerMigrate", "root"),
    rpcOptionalObject<RuntimeLedgerMigrateInput>(params, 1, "ledgerMigrate", "input")
  )),
  ledgerRebuild: envelopeMethod("ledgerRebuild", "long", (root: string, input: RuntimeLedgerRebuildInput = {}) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "ledgerRebuild", "root"),
    rpcOptionalObject<RuntimeLedgerRebuildInput>(params, 1, "ledgerRebuild", "input")
  )),
  ledgerRollback: envelopeMethod("ledgerRollback", "normal", (root: string, input: RuntimeLedgerRollbackInput = { dryRun: true }) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "ledgerRollback", "root"),
    rpcOptionalObject<RuntimeLedgerRollbackInput>(params, 1, "ledgerRollback", "input")
  )),
  book: envelopeMethod("book", "long", (root: string, input: RuntimeBookInput = {}) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "book", "root"),
    rpcOptionalObject<RuntimeBookInput>(params, 1, "book", "input")
  )),
  recommendations: envelopeMethod("recommendations", "long", (root: string, input: RuntimeRecommendationInput) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "recommendations", "root"),
    rpcRequiredObject<RuntimeRecommendationInput>(params, 1, "recommendations", "input")
  )),
  refactorScan: envelopeMethod("refactorScan", "long", (root: string, input: RuntimeRefactorScanInput = {}) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "refactorScan", "root"),
    rpcOptionalObject<RuntimeRefactorScanInput>(params, 1, "refactorScan", "input")
  )),
  refactorRecord: envelopeMethod("refactorRecord", "normal", (root: string, input: RuntimeRefactorRecordInput) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "refactorRecord", "root"),
    rpcRequiredObject<RuntimeRefactorRecordInput>(params, 1, "refactorRecord", "input")
  )),
  refactorVerify: envelopeMethod("refactorVerify", "long", (root: string, input: RuntimeRefactorVerifyInput) => [root, input] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "refactorVerify", "root"),
    rpcRequiredObject<RuntimeRefactorVerifyInput>(params, 1, "refactorVerify", "input")
  )),
  repoAdd: envelopeMethod("repoAdd", "normal", (root: string, name?: string) => [root, name] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "repoAdd", "root"),
    rpcOptionalString(params, 1, "repoAdd", "name")
  )),
  repoList: envelopeMethod("repoList", "short", () => [] as const, () => rpcArgs()),
  repoRemove: envelopeMethod("repoRemove", "normal", (repositoryId: string) => [repositoryId] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "repoRemove", "repositoryId")
  )),
  landscapeStatus: envelopeMethod("landscapeStatus", "short", () => [] as const, () => rpcArgs()),
  explorerServiceContract: envelopeMethod("explorerServiceContract", "short", (tokenTtlSeconds: number = 900) => [tokenTtlSeconds] as const, (params) => rpcArgs(
    rpcOptionalNumber(params, 0, "explorerServiceContract", "tokenTtlSeconds")
  )),
  explorerProjectionV2: envelopeMethod("explorerProjectionV2", "normal", (root: string, query: ExplorerProjectionQueryV2) => [root, query] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "explorerProjectionV2", "root"),
    rpcRequiredObject<ExplorerProjectionQueryV2>(params, 1, "explorerProjectionV2", "query")
  )),
  explorerProjectionDelta: envelopeMethod("explorerProjectionDelta", "normal", (root: string, query: ExplorerDeltaQueryV2) => [root, query] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "explorerProjectionDelta", "root"),
    rpcRequiredObject<ExplorerDeltaQueryV2>(params, 1, "explorerProjectionDelta", "query")
  )),
  startExplorer: envelopeMethod("startExplorer", "normal", (root: string, options: ExplorerServerOptions = {}) => [root, options] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "startExplorer", "root"),
    rpcOptionalObject<ExplorerServerOptions>(params, 1, "startExplorer", "options")
  )),
  stopExplorer: envelopeMethod("stopExplorer", "short", () => [] as const, () => rpcArgs()),
  revokeExplorerToken: envelopeMethod("revokeExplorerToken", "short", () => [] as const, () => rpcArgs()),
  explorerStatus: envelopeMethod("explorerStatus", "short", () => [] as const, () => rpcArgs()),
  contextLandscape: envelopeMethod("contextLandscape", "normal", (task: string, maxSymbols: number = 12) => [task, maxSymbols] as const, (params) => rpcArgs(
    rpcRequiredString(params, 0, "contextLandscape", "task"),
    rpcOptionalNumber(params, 1, "contextLandscape", "maxSymbols")
  )),
  runtimeStatus: envelopeMethod("runtimeStatus", "short", (root?: string) => [root] as const, (params) => rpcArgs(
    rpcOptionalString(params, 0, "runtimeStatus", "root")
  )),
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
