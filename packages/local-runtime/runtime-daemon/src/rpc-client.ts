import { RUNTIME_RPC_VERSION } from "./rpc-protocol";
import type { AgentJobV1, ExplorerDeltaQueryV2, ExplorerProjectionQueryV2, Json, JsonEnvelope, ProjectionApplyRecoveryIntentV1, ProjectionRequestV1, ReviewChallengeV2 } from "@archcontext/contracts";
import type { ArchitectureAuditRunV1 } from "@archcontext/core/architecture-ledger";
import type { DetachedReviewWorktree } from "@archcontext/local-runtime/git-adapter";
import type { DeveloperReviewAttestation, DeveloperReviewRunCleanup, DeveloperReviewRunCleanupRequest, DeveloperReviewRunPreparation, DeveloperReviewRunRecovery, ExplorerServerOptions, RuntimeAgentJobCancelRpcInput, RuntimeAgentJobClaimRpcInput, RuntimeAgentJobCompleteRpcInput, RuntimeAgentJobEnqueueGitInput, RuntimeAgentJobRetryRpcInput, RuntimeApplyUpdateInput, RuntimeAuditApproveInput, RuntimeAuditRunInput, RuntimeBookInput, RuntimeCheckpointInput, RuntimeCompleteTaskInput, RuntimeDocsInput, RuntimeLedgerMigrateInput, RuntimeLedgerProjectInput, RuntimeLedgerRebuildInput, RuntimeLedgerRollbackInput, RuntimeMcpApplyInput, RuntimeMcpApprovalInput, RuntimePlanUpdateInput, RuntimePracticeWaiverInput, RuntimeRecommendationInput, RuntimeRefactorRecordInput, RuntimeRefactorScanInput } from "./index";
import type { PracticeCatalogCommandInput } from "@archcontext/core/practice-catalog";
import type { RuntimeRefactorVerifyInput } from "./refactor-verify";
import type { RuntimeDaemonClient, RuntimeRpcConnection } from "./rpc-protocol";

export type RuntimeRpcTransportErrorCode = "RPC_TIMEOUT" | "RPC_ABORTED";

/**
 * Stable classification for a runtime RPC call that never produced a response. Carries the method
 * and its deadline so a caller can decide on retry/backoff, and deliberately carries neither the
 * bearer token nor the request body.
 */
export class RuntimeRpcTransportError extends Error {
  constructor(
    readonly code: RuntimeRpcTransportErrorCode,
    readonly method: string,
    readonly timeoutMs: number,
    readonly elapsedMs: number
  ) {
    super(code === "RPC_TIMEOUT"
      ? `runtime RPC timeout: ${method} exceeded ${timeoutMs}ms`
      : `runtime RPC cancelled: ${method} aborted after ${elapsedMs}ms`);
    this.name = "RuntimeRpcTransportError";
  }
}

export interface RuntimeRpcClientTimeoutPolicy {
  /** `GET /health` liveness probe. */
  health: number;
  /** Control and status reads that must not depend on repository work. */
  short: number;
  /** Default class for ordinary repository operations. */
  normal: number;
  /** Indexing, audit, and review methods that legitimately run for minutes. */
  long: number;
}

export interface RuntimeRpcClientOptions {
  timeouts?: Partial<RuntimeRpcClientTimeoutPolicy>;
  /** Caller-owned cancellation applied to every call this client makes. */
  signal?: AbortSignal;
}

export const RUNTIME_RPC_CLIENT_TIMEOUT_POLICY: RuntimeRpcClientTimeoutPolicy = {
  health: 5_000,
  short: 15_000,
  normal: 120_000,
  long: 900_000
};

const RUNTIME_RPC_SHORT_METHODS = new Set([
  "shutdown", "runtimeStatus", "landscapeStatus", "repoList", "explorerStatus", "explorerServiceContract",
  "jobsList", "jobsStats", "ledgerState", "ledgerDrift", "stopExplorer", "revokeExplorerToken"
]);

const RUNTIME_RPC_LONG_METHODS = new Set([
  "init", "sync", "prepare", "context", "checkpoint", "auditRun", "auditApprove", "recommendations", "book",
  "ledgerRebuild", "ledgerMigrate", "refactorScan", "refactorVerify", "startDeveloperReviewRun", "runSignedDeveloperReviewAttestation"
]);

function runtimeRpcMethodTimeout(method: string, policy: RuntimeRpcClientTimeoutPolicy): number {
  if (RUNTIME_RPC_SHORT_METHODS.has(method)) return policy.short;
  if (RUNTIME_RPC_LONG_METHODS.has(method)) return policy.long;
  return policy.normal;
}

export class RuntimeRpcClient implements RuntimeDaemonClient {
  private readonly timeouts: RuntimeRpcClientTimeoutPolicy;

  constructor(private readonly connection: RuntimeRpcConnection, private readonly options: RuntimeRpcClientOptions = {}) {
    this.timeouts = { ...RUNTIME_RPC_CLIENT_TIMEOUT_POLICY, ...options.timeouts };
  }

  async health(options: { includeEgress?: boolean } = {}): Promise<Json> {
    const suffix = options.includeEgress ? "?egress=1" : "";
    return await this.request("health", options.includeEgress ? this.timeouts.normal : this.timeouts.health, `${this.connection.url}health${suffix}`, {
      headers: { "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION, Authorization: `Bearer ${this.connection.token}` }
    }) as Json;
  }

  async shutdown(): Promise<JsonEnvelope> {
    return this.call("shutdown", []);
  }

  connectionInfo(): Omit<RuntimeRpcConnection, "token"> {
    const { token: _token, ...safe } = this.connection;
    return safe;
  }

  init(root: string, productName?: string) {
    return this.call("init", [root, productName]);
  }

  sync(root: string, changedPaths: string[] = []) {
    return this.call("sync", [root, changedPaths]);
  }

  validate(root: string) {
    return this.call("validate", [root]);
  }

  context(root: string, task: string, maxSymbols = 12) {
    return this.call("context", [root, task, maxSymbols]);
  }

  prepare(root: string, task: string, maxBytes = 12_288, maxItems = 12, taskSessionId?: string) {
    return this.call("prepare", [root, task, maxBytes, maxItems, taskSessionId]);
  }

  checkpoint(root: string, input: RuntimeCheckpointInput) {
    return this.call("checkpoint", [root, input]);
  }

  jobsEnqueueGitHook(root: string, input: RuntimeAgentJobEnqueueGitInput = {}) {
    return this.call("jobsEnqueueGitHook", [root, input]);
  }

  jobsList(root: string, input: { statuses?: AgentJobV1["status"][] } = {}) {
    return this.call("jobsList", [root, input]);
  }

  jobsStats(root: string, input: { now?: string } = {}) {
    return this.call("jobsStats", [root, input]);
  }

  jobsClaim(root: string, input: RuntimeAgentJobClaimRpcInput) {
    return this.call("jobsClaim", [root, input]);
  }

  jobsComplete(root: string, input: RuntimeAgentJobCompleteRpcInput) {
    return this.call("jobsComplete", [root, input]);
  }

  jobsRetry(root: string, input: RuntimeAgentJobRetryRpcInput) {
    return this.call("jobsRetry", [root, input]);
  }

  jobsCancel(root: string, input: RuntimeAgentJobCancelRpcInput) {
    return this.call("jobsCancel", [root, input]);
  }

  auditRun(root: string, input: RuntimeAuditRunInput = {}) {
    return this.call("auditRun", [root, input]);
  }

  auditList(root: string, input: { statuses?: ArchitectureAuditRunV1["status"][] } = {}) {
    return this.call("auditList", [root, input]);
  }

  auditShow(root: string, runId: string) {
    return this.call("auditShow", [root, runId]);
  }

  auditApprove(root: string, input: RuntimeAuditApproveInput) {
    return this.call("auditApprove", [root, input]);
  }

  docs(root: string, input: RuntimeDocsInput) {
    return this.call("docs", [root, input]);
  }

  readResource(root: string, uri: string) {
    return this.call("readResource", [root, uri]);
  }

  practices(root: string, input: PracticeCatalogCommandInput) {
    return this.call("practices", [root, input]);
  }

  practiceWaivers(root: string) {
    return this.call("practiceWaivers", [root]);
  }

  planPracticeWaiver(root: string, input: RuntimePracticeWaiverInput) {
    return this.call("planPracticeWaiver", [root, input]);
  }

  planUpdate(root: string, input: RuntimePlanUpdateInput) {
    return this.call("planUpdate", [root, input]);
  }

  completeTask(root: string, input: RuntimeCompleteTaskInput = {}) {
    return this.call("completeTask", [root, input]);
  }

  applyUpdate(root: string, input: RuntimeApplyUpdateInput) {
    return this.call("applyUpdate", [root, input]);
  }

  approveMcpUpdate(root: string, input: RuntimeMcpApprovalInput) {
    return this.call("approveMcpUpdate", [root, input]);
  }

  applyMcpUpdate(root: string, input: RuntimeMcpApplyInput) {
    return this.call("applyMcpUpdate", [root, input]);
  }

  inspectProjectionApplyReceipt(root: string, lookupKey: string) {
    return this.call("inspectProjectionApplyReceipt", [root, lookupKey]);
  }

  listProjectionPriorCommittedApplies(root: string, requestId: string) {
    return this.call("listProjectionPriorCommittedApplies", [root, requestId]);
  }

  readbackProjectionApply(root: string, request: ProjectionRequestV1) {
    return this.call("readbackProjectionApply", [root, request]);
  }

  recoverProjectionApply(root: string, intent: ProjectionApplyRecoveryIntentV1) {
    return this.call("recoverProjectionApply", [root, intent]);
  }

  ledgerState(root: string) {
    return this.call("ledgerState", [root]);
  }

  ledgerDrift(root: string) {
    return this.call("ledgerDrift", [root]);
  }

  ledgerProject(root: string, input: RuntimeLedgerProjectInput = { dryRun: true }) {
    return this.call("ledgerProject", [root, input]);
  }

  ledgerMigrate(root: string, input: RuntimeLedgerMigrateInput = { dryRun: true }) {
    return this.call("ledgerMigrate", [root, input]);
  }

  ledgerRebuild(root: string, input: RuntimeLedgerRebuildInput = {}) {
    return this.call("ledgerRebuild", [root, input]);
  }

  ledgerRollback(root: string, input: RuntimeLedgerRollbackInput = { dryRun: true }) {
    return this.call("ledgerRollback", [root, input]);
  }

  book(root: string, input: RuntimeBookInput = {}) {
    return this.call("book", [root, input]);
  }

  recommendations(root: string, input: RuntimeRecommendationInput) {
    return this.call("recommendations", [root, input]);
  }

  refactorScan(root: string, input: RuntimeRefactorScanInput = {}) {
    return this.call("refactorScan", [root, input]);
  }

  refactorRecord(root: string, input: RuntimeRefactorRecordInput) {
    return this.call("refactorRecord", [root, input]);
  }

  refactorVerify(root: string, input: RuntimeRefactorVerifyInput) {
    return this.call("refactorVerify", [root, input]);
  }

  repoAdd(root: string, name?: string) {
    return this.call("repoAdd", [root, name]);
  }

  repoList() {
    return this.call("repoList", []);
  }

  repoRemove(repositoryId: string) {
    return this.call("repoRemove", [repositoryId]);
  }

  landscapeStatus() {
    return this.call("landscapeStatus", []);
  }

  explorerServiceContract(tokenTtlSeconds = 900) {
    return this.call("explorerServiceContract", [tokenTtlSeconds]);
  }

  explorerProjectionV2(root: string, query: ExplorerProjectionQueryV2) {
    return this.call("explorerProjectionV2", [root, query]);
  }

  explorerProjectionDelta(root: string, query: ExplorerDeltaQueryV2) {
    return this.call("explorerProjectionDelta", [root, query]);
  }

  startExplorer(root: string, options: ExplorerServerOptions = {}) {
    return this.call("startExplorer", [root, options]);
  }

  stopExplorer() {
    return this.call("stopExplorer", []);
  }

  revokeExplorerToken() {
    return this.call("revokeExplorerToken", []);
  }

  explorerStatus() {
    return this.call("explorerStatus", []);
  }

  contextLandscape(task: string, maxSymbols = 12) {
    return this.call("contextLandscape", [task, maxSymbols]);
  }

  runtimeStatus(root?: string) {
    return this.call("runtimeStatus", [root]);
  }

  async startDeveloperReviewRun(input: {
    repositoryRoot: string;
    challenge: ReviewChallengeV2;
    expectedHeadTreeOid?: string;
  }): Promise<DeveloperReviewRunPreparation> {
    return unwrapRpcData(await this.call("startDeveloperReviewRun", [input])) as unknown as DeveloperReviewRunPreparation;
  }

  async runSignedDeveloperReviewAttestation(input: {
    challenge: ReviewChallengeV2;
    worktree: DetachedReviewWorktree;
    keyRef: string;
    principalId: string;
    publicKeyId: string;
    taskSessionId?: string;
    mergeBaseSha?: string;
    startedAt?: string;
    completedAt?: string;
  }): Promise<DeveloperReviewAttestation> {
    return unwrapRpcData(await this.call("runSignedDeveloperReviewAttestation", [input])) as unknown as DeveloperReviewAttestation;
  }

  async cleanupDeveloperReviewRun(input: DeveloperReviewRunCleanupRequest): Promise<DeveloperReviewRunCleanup> {
    return unwrapRpcData(await this.call("cleanupDeveloperReviewRun", [input])) as unknown as DeveloperReviewRunCleanup;
  }

  async recoverDeveloperReviewRuns(input: {
    repositoryRoot: string;
    force?: boolean;
  }): Promise<DeveloperReviewRunRecovery> {
    return unwrapRpcData(await this.call("recoverDeveloperReviewRuns", [input])) as unknown as DeveloperReviewRunRecovery;
  }

  private async call(method: string, params: unknown[]): Promise<JsonEnvelope> {
    return await this.request(method, runtimeRpcMethodTimeout(method, this.timeouts), `${this.connection.url}rpc`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.connection.token}`,
        "Content-Type": "application/json",
        "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION
      },
      body: JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method, params })
    }) as JsonEnvelope;
  }

  /**
   * Single transport path for health and every RPC method. The deadline covers response headers
   * *and* body, so a daemon that starts a response and stalls still fails. A timed-out call is
   * never replayed here: the daemon may have already committed a mutation whose response was lost,
   * so reconciliation is the caller's decision, not a silent retry.
   *
   * Every request also opts out of HTTP keep-alive (`Connection: close`, #178). The daemon closes an
   * idle kept-alive socket on its own keep-alive timer; when a synchronous RPC such as `planUpdate`
   * blocks the daemon's event loop past that deadline, the close fires right after the response,
   * while the client (whose keep-alive clock also stalls during synchronous CLI work) is reusing the
   * same pooled socket for the next call. That next call, e.g. `applyUpdate`, then dies with
   * `fetch failed` before the daemon reads it. A fresh loopback connection per call costs far less
   * than any retry, and a retry is not an option here for the same reason as above.
   */
  private async request(method: string, timeoutMs: number, url: string, init: { method?: string; headers: Record<string, string>; body?: string }): Promise<unknown> {
    const controller = new AbortController();
    const startedAt = Date.now();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const callerSignal = this.options.signal;
    const onCallerAbort = (): void => controller.abort();
    if (callerSignal?.aborted) controller.abort();
    else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    try {
      const response = await fetch(url, { ...init, headers: { ...init.headers, "Connection": "close" }, signal: controller.signal });
      return await response.json();
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      if (timedOut) throw new RuntimeRpcTransportError("RPC_TIMEOUT", method, timeoutMs, elapsedMs);
      if (callerSignal?.aborted) throw new RuntimeRpcTransportError("RPC_ABORTED", method, timeoutMs, elapsedMs);
      throw error;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  }
}

function unwrapRpcData(result: JsonEnvelope): Json {
  if (!result.ok) throw new Error(result.error?.message ?? "runtime-rpc-call-failed");
  return result.data as Json;
}
