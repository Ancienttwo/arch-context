import { type AddressInfo } from "node:net";
import { type AgentJobV1, type ExplorerDeltaQueryV2, type ExplorerProjectionQueryV2, type Json, type JsonEnvelope, type ProductVersionManifest, type ProjectionApplyRecoveryIntentV1, type ProjectionRequestV1, errorEnvelope, okEnvelope, productVersionManifest } from "@archcontext/contracts";
import { type ArchctxDaemon, type ExplorerServerOptions, type RuntimeAgentJobCancelRpcInput, type RuntimeAgentJobClaimRpcInput, type RuntimeAgentJobCompleteRpcInput, type RuntimeAgentJobEnqueueGitInput, type RuntimeAgentJobRetryRpcInput, type RuntimeApplyUpdateInput, type RuntimeAuditApproveInput, type RuntimeAuditRunInput, type RuntimeBookInput, type RuntimeCheckpointInput, type RuntimeCompleteTaskInput, type RuntimeDocsInput, type RuntimeLedgerMigrateInput, type RuntimeLedgerProjectInput, type RuntimeLedgerRebuildInput, type RuntimeLedgerRollbackInput, type RuntimeMcpApplyInput, type RuntimeMcpApprovalInput, type RuntimePlanUpdateInput, type RuntimePracticeWaiverInput, type RuntimeRecommendationInput, type RuntimeRefactorRecordInput, type RuntimeRefactorScanInput } from "./index";
import { type ArchitectureAuditRunV1 } from "@archcontext/core/architecture-ledger";
import { ChangeSetRecoveryUnresolvedError } from "./changeset-recovery-error";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { type PracticeCatalogCommandInput } from "@archcontext/core/practice-catalog";
import { RUNTIME_RPC_VERSION, type RuntimeRpcConnection } from "./rpc-protocol";
import { type RuntimeRefactorVerifyInput } from "./refactor-verify";
import { acquireDaemonLock, defaultDaemonConnectionPath, defaultDaemonLockPath } from "./daemon-control";
import { chmodSync, closeSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { decodeDeveloperReviewRunCleanupRequest, decodeRecoverDeveloperReviewRunsParams, decodeSignedDeveloperReviewAttestationParams, decodeStartDeveloperReviewRunParams } from "./developer-review-codec";
import { dirname } from "node:path";
import { isLoopbackRemote, writeJson } from "./loopback-http";
import { matchesLoopbackAuthority, matchesSecret } from "./loopback-auth";
import { randomBytes } from "node:crypto";
import type { RuntimeDaemonClient } from "./rpc-protocol";

// Only the daemon operations used by this transport; no runtime import of the facade.
type RuntimeRpcServerTarget = Pick<ArchctxDaemon, keyof RuntimeDaemonClient | "start" | "stop" | "status" | "hasActiveBackgroundWork" | "compositionReport" | "egressReport">;

// `archctxd` is spawned `detached`+`unref()`'d (see `startBackgroundDaemon` in the CLI) with no
// other exit signal, so left alone it runs forever, accumulating cross-day zombie processes (see
// F5 in tasks/reviews/audit-approve-gh-publishing.review.md). This is the default idle window
// `ArchctxRuntimeRpcServer` waits, counted from its last completed RPC request (or from `start()`
// if none happened yet), before checking whether it is safe to exit on its own. Exported so the
// CLI can pass it through unchanged and tests can assert against it without duplicating the
// literal. `0` disables idle exit (the daemon runs until explicitly stopped).
export const DEFAULT_DAEMON_IDLE_TIMEOUT_MS = 30 * 60_000;

const DAEMON_IDLE_TIMEOUT_ENV = "ARCHCONTEXT_DAEMON_IDLE_TIMEOUT_MS";

/** Flag (`explicit`, already parsed by the CLI) wins over the env var, which wins over the
 * default. A non-finite or negative env value is treated as unset rather than thrown, matching
 * this file's existing tolerant `process.env` parsing (see `runtimeArchitectureLedgerModes`). */
function resolveDaemonIdleTimeoutMs(explicit: number | undefined): number {
  if (explicit !== undefined && Number.isFinite(explicit)) return Math.max(0, Math.trunc(explicit));
  const envValue = process.env[DAEMON_IDLE_TIMEOUT_ENV];
  if (envValue !== undefined) {
    const parsed = Number(envValue);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.trunc(parsed);
  }
  return DEFAULT_DAEMON_IDLE_TIMEOUT_MS;
}

/**
 * Largest accepted `POST /rpc` body. The biggest legitimate method is a ChangeSet apply carrying
 * rendered projection documents, which stays far below this; anything larger is a malfunctioning
 * or hostile local client rather than a real request.
 */
export const RUNTIME_RPC_MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024;

/** Deadline for reading an accepted request body, measured from the end of authorization. */
export const RUNTIME_RPC_REQUEST_BODY_TIMEOUT_MS = 30_000;

export interface RuntimeRpcServerOptions {
  root?: string;
  port?: number;
  token?: string;
  lockPath?: string;
  connectionPath?: string;
  clock?: () => string;
  /** Defaults to `RUNTIME_RPC_MAX_REQUEST_BODY_BYTES`. */
  maxRequestBodyBytes?: number;
  /** Defaults to `RUNTIME_RPC_REQUEST_BODY_TIMEOUT_MS`. */
  requestBodyTimeoutMs?: number;
  /** `undefined` resolves to the `ARCHCONTEXT_DAEMON_IDLE_TIMEOUT_MS` env var, then
   * `DEFAULT_DAEMON_IDLE_TIMEOUT_MS`. `0` disables idle exit. */
  idleTimeoutMs?: number;
  onStop?: () => void;
  /** Injectable for tests only: called instead of `process.exit` when the idle timer decides to
   * exit, so an in-process test can observe the call without terminating the test runner. */
  exit?: (code: number) => void;
  /** Test-only health manifest override. Production always advertises productVersionManifest(). */
  productManifest?: () => ProductVersionManifest;
}

export class ArchctxRuntimeRpcServer {
  private server?: Server;
  private connection?: RuntimeRpcConnection;
  private lockFd?: number;
  private readonly idleTimeoutMs: number;
  private idleTimer?: NodeJS.Timeout;
  private inFlightRpcRequests = 0;

  constructor(private readonly daemon: RuntimeRpcServerTarget, private readonly options: RuntimeRpcServerOptions = {}) {
    this.idleTimeoutMs = resolveDaemonIdleTimeoutMs(options.idleTimeoutMs);
  }

  async start(): Promise<RuntimeRpcConnection> {
    if (this.server) return this.connection!;
    const startedDaemon = !this.daemon.status().running;
    if (startedDaemon) await this.daemon.start();
    try {
      return await this.listenAndPublish();
    } catch (error) {
      // Undo everything this call acquired, so a retry is not refused by our own leaked store
      // ownership (#160) or daemon lock.
      await this.releaseFailedStart(startedDaemon);
      throw error;
    }
  }

  private async releaseFailedStart(startedDaemon: boolean): Promise<void> {
    const server = this.server;
    const connection = this.connection;
    this.server = undefined;
    this.connection = undefined;
    if (server) await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    if (connection) rmSync(connection.connectionPath, { force: true });
    if (this.lockFd !== undefined) {
      closeSync(this.lockFd);
      this.lockFd = undefined;
      rmSync(this.options.lockPath ?? defaultDaemonLockPath(this.options.root ?? process.cwd()), { force: true });
    }
    if (startedDaemon) await this.daemon.stop().catch(() => undefined);
  }

  private async listenAndPublish(): Promise<RuntimeRpcConnection> {
    const root = this.options.root ?? process.cwd();
    const connectionPath = this.options.connectionPath ?? defaultDaemonConnectionPath(root);
    const lockPath = this.options.lockPath ?? defaultDaemonLockPath(root);
    mkdirSync(dirname(connectionPath), { recursive: true });
    mkdirSync(dirname(lockPath), { recursive: true });
    this.lockFd = acquireDaemonLock(lockPath, root);
    const token = this.options.token ?? randomBytes(18).toString("base64url");
    const server = createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        writeJson(response, 500, { schemaVersion: RUNTIME_RPC_VERSION, ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(this.options.port ?? 0, "127.0.0.1", () => {
        server.off("error", rejectListen);
        resolveListen();
      });
    });
    this.server = server;
    const port = (server.address() as AddressInfo).port;
    this.connection = {
      schemaVersion: RUNTIME_RPC_VERSION,
      protocol: "http-loopback",
      version: 1,
      root,
      url: `http://127.0.0.1:${port}/`,
      token,
      pid: process.pid,
      lockPath,
      connectionPath,
      startedAt: (this.options.clock ?? (() => new Date().toISOString()))()
    };
    writeFileSync(connectionPath, JSON.stringify(this.connection, null, 2), { mode: 0o600 });
    chmodSync(connectionPath, 0o600);
    this.armIdleTimer();
    return this.connection;
  }

  async stop(): Promise<void> {
    this.clearIdleTimer();
    const server = this.server;
    this.server = undefined;
    const connection = this.connection;
    this.connection = undefined;
    if (server) {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
    await this.daemon.stop();
    if (connection) rmSync(connection.connectionPath, { force: true });
    if (this.lockFd !== undefined) closeSync(this.lockFd);
    this.lockFd = undefined;
    if (connection) rmSync(connection.lockPath, { force: true });
    this.options.onStop?.();
  }

  private armIdleTimer(): void {
    if (this.idleTimeoutMs <= 0 || !this.server) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.checkIdleAndMaybeExit(), this.idleTimeoutMs);
    this.idleTimer.unref();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  /**
   * Fires once `idleTimeoutMs` elapses since the last completed RPC request (or since `start()`
   * if none happened yet — see `armIdleTimer` calls). `archctxd` is spawned `detached`+`unref()`'d
   * with no other exit signal (F5, tasks/reviews/audit-approve-gh-publishing.review.md), so
   * without this it runs forever, accumulating cross-day zombie processes. Exits only when
   * genuinely idle: no in-flight RPC request, no queued/running `runtime_job_queue` entry in any
   * open session's scope, and no in-flight audit investigation
   * (`ArchctxDaemon.hasActiveBackgroundWork`). Any one of those being non-idle just reschedules
   * the same full timeout rather than exiting or busy-polling — this is a single-machine,
   * low-frequency background daemon, not a service under concurrent load, so the worst case of a
   * missed exit is one more idle period, and the worst case of losing the final race against a
   * brand-new request is one CLI retry against a freshly spawned daemon.
   */
  private async checkIdleAndMaybeExit(): Promise<void> {
    if (!this.server || !this.connection) return;
    if (this.inFlightRpcRequests > 0) {
      this.armIdleTimer();
      return;
    }
    // Fail-closed: if the activity check itself throws (e.g. the local store hiccups), treat the
    // daemon as busy rather than risk exiting mid-work.
    const hasActiveWork = await this.daemon.hasActiveBackgroundWork().catch(() => true);
    if (hasActiveWork || this.inFlightRpcRequests > 0 || !this.connection) {
      this.armIdleTimer();
      return;
    }
    // Remove the connection file before tearing anything else down: a CLI invocation that finds
    // no connection file spawns a fresh daemon immediately (`createOrStartRuntimeRpcClient`)
    // instead of racing this exiting process's own control files or a server about to stop
    // accepting connections.
    rmSync(this.connection.connectionPath, { force: true });
    try {
      await this.stop();
    } finally {
      // exit must be unconditional: a stop() failure here would otherwise leave the process
      // resident with its connection file already removed — the exact zombie shape this idle
      // exit path exists to eliminate.
      (this.options.exit ?? process.exit)(0);
    }
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("Cache-Control", "no-store");
    if (!isLoopbackRemote(request.socket.remoteAddress)) {
      writeJson(response, 403, { schemaVersion: RUNTIME_RPC_VERSION, ok: false, error: "runtime RPC only accepts loopback clients" });
      return;
    }
    if (!this.connection || !matchesLoopbackAuthority(request, this.connection.url)) {
      writeJson(response, 403, { schemaVersion: RUNTIME_RPC_VERSION, ok: false, error: "runtime RPC request authority rejected" });
      return;
    }
    if (!isRpcVersionHeaderCompatible(request)) {
      writeJson(response, 426, {
        schemaVersion: RUNTIME_RPC_VERSION,
        ok: false,
        error: "runtime RPC version mismatch",
        expected: RUNTIME_RPC_VERSION,
        received: requestRpcVersionHeader(request)
      });
      return;
    }
    const url = new URL(request.url ?? "/", this.connection?.url ?? "http://127.0.0.1/");
    if (request.method === "GET" && url.pathname === "/health") {
      if (!this.isAuthorized(request)) {
        writeJson(response, 401, { schemaVersion: RUNTIME_RPC_VERSION, ok: false, error: "runtime RPC token required" });
        return;
      }
      const changeSetRecovery = this.daemon.status().changeSetRecovery;
      writeJson(response, 200, {
        schemaVersion: RUNTIME_RPC_VERSION,
        ok: true,
        pid: process.pid,
        protocol: "http-loopback",
        version: 1,
        product: this.options.productManifest?.() ?? productVersionManifest(),
        composition: this.daemon.compositionReport(),
        // Startup and idle liveness probes must not spawn Git processes to inspect egress policy.
        ...(url.searchParams.get("egress") === "1"
          ? { egress: await this.daemon.egressReport(this.options.root ?? process.cwd()) }
          : {}),
        // Alive but write-gated (#172): readers still work, so `ok` stays true, but callers must see it.
        ...(changeSetRecovery ? { changeSetRecovery } : {})
      });
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/rpc") {
      writeJson(response, 404, { schemaVersion: RUNTIME_RPC_VERSION, ok: false, error: "unknown runtime RPC route" });
      return;
    }
    if (!this.isAuthorized(request)) {
      writeJson(response, 401, { schemaVersion: RUNTIME_RPC_VERSION, ok: false, error: "runtime RPC token required" });
      return;
    }
    // An accepted request counts as in-flight from here, before its body is read: the idle-exit
    // path must never classify an authorized upload as an idle daemon.
    this.inFlightRpcRequests += 1;
    try {
      const read = await readRpcRequestBody(request, {
        maxBytes: this.options.maxRequestBodyBytes ?? RUNTIME_RPC_MAX_REQUEST_BODY_BYTES,
        timeoutMs: this.options.requestBodyTimeoutMs ?? RUNTIME_RPC_REQUEST_BODY_TIMEOUT_MS
      });
      if (!read.ok) {
        // A disconnected client has no response to receive; anything else gets a bounded envelope.
        if (read.kind === "rejected") writeJson(response, read.status, { schemaVersion: RUNTIME_RPC_VERSION, ok: false, error: read.error });
        return;
      }
      if (!read.value || typeof read.value !== "object" || Array.isArray(read.value)) {
        writeJson(response, 400, { schemaVersion: RUNTIME_RPC_VERSION, ok: false, error: "runtime RPC request body must be an object" });
        return;
      }
      const body = read.value as { schemaVersion?: string; method?: string; params?: unknown[] };
      if (body.schemaVersion !== RUNTIME_RPC_VERSION) {
        writeJson(response, 400, { schemaVersion: RUNTIME_RPC_VERSION, ok: false, error: "runtime RPC version mismatch" });
        return;
      }
      const result = await this.dispatch(body.method ?? "", body.params ?? []).catch((error: unknown) => {
        // A write refused by the #172 recovery gate is a typed precondition failure, not a 500.
        if (error instanceof ChangeSetRecoveryUnresolvedError) return errorEnvelope(body.method ?? "rpc", "AC_PRECONDITION_FAILED", error.message);
        throw error;
      });
      writeJson(response, 200, result);
      if (body.method === "shutdown") setTimeout(() => void this.stop(), 0);
    } finally {
      this.inFlightRpcRequests -= 1;
      this.armIdleTimer();
    }
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const authorization = request.headers.authorization ?? "";
    const bearer = Array.isArray(authorization) ? authorization[0] : authorization;
    return !!this.connection && matchesSecret(bearer, `Bearer ${this.connection.token}`);
  }

  private async dispatch(method: string, params: unknown[]): Promise<JsonEnvelope> {
    switch (method) {
      case "init":
        return this.daemon.init(params[0] as string, params[1] as string | undefined);
      case "sync":
        return this.daemon.sync(params[0] as string, params[1] as string[] | undefined);
      case "validate":
        return this.daemon.validate(params[0] as string);
      case "context":
        return this.daemon.context(params[0] as string, params[1] as string, params[2] as number | undefined);
      case "prepare":
        return this.daemon.prepare(params[0] as string, params[1] as string, params[2] as number | undefined, params[3] as number | undefined, params[4] as string | undefined);
      case "checkpoint":
        return this.daemon.checkpoint(params[0] as string, params[1] as RuntimeCheckpointInput);
      case "jobsEnqueueGitHook":
        return this.daemon.jobsEnqueueGitHook(params[0] as string, params[1] as RuntimeAgentJobEnqueueGitInput | undefined);
      case "jobsList":
        return this.daemon.jobsList(params[0] as string, params[1] as { statuses?: AgentJobV1["status"][] } | undefined);
      case "jobsStats":
        return this.daemon.jobsStats(params[0] as string, params[1] as { now?: string } | undefined);
      case "jobsClaim":
        return this.daemon.jobsClaim(params[0] as string, params[1] as RuntimeAgentJobClaimRpcInput);
      case "jobsComplete":
        return this.daemon.jobsComplete(params[0] as string, params[1] as RuntimeAgentJobCompleteRpcInput);
      case "jobsRetry":
        return this.daemon.jobsRetry(params[0] as string, params[1] as RuntimeAgentJobRetryRpcInput);
      case "jobsCancel":
        return this.daemon.jobsCancel(params[0] as string, params[1] as RuntimeAgentJobCancelRpcInput);
      case "auditRun":
        return this.daemon.auditRun(params[0] as string, params[1] as RuntimeAuditRunInput | undefined);
      case "auditList":
        return this.daemon.auditList(params[0] as string, params[1] as { statuses?: ArchitectureAuditRunV1["status"][] } | undefined);
      case "auditShow":
        return this.daemon.auditShow(params[0] as string, params[1] as string);
      case "auditApprove":
        return this.daemon.auditApprove(params[0] as string, params[1] as RuntimeAuditApproveInput);
      case "docs":
        return this.daemon.docs(params[0] as string, params[1] as RuntimeDocsInput);
      case "readResource":
        return this.daemon.readResource(params[0] as string, params[1] as string);
      case "practices":
        return this.daemon.practices(params[0] as string, params[1] as PracticeCatalogCommandInput);
      case "practiceWaivers":
        return this.daemon.practiceWaivers(params[0] as string);
      case "planPracticeWaiver":
        return this.daemon.planPracticeWaiver(params[0] as string, params[1] as RuntimePracticeWaiverInput);
      case "planUpdate":
        return this.daemon.planUpdate(params[0] as string, params[1] as RuntimePlanUpdateInput);
      case "completeTask":
        return this.daemon.completeTask(params[0] as string, params[1] as RuntimeCompleteTaskInput | undefined);
      case "applyUpdate":
        return this.daemon.applyUpdate(params[0] as string, params[1] as RuntimeApplyUpdateInput);
      case "approveMcpUpdate":
        return this.daemon.approveMcpUpdate(params[0] as string, params[1] as RuntimeMcpApprovalInput);
      case "applyMcpUpdate":
        return this.daemon.applyMcpUpdate(params[0] as string, params[1] as RuntimeMcpApplyInput);
      case "inspectProjectionApplyReceipt":
        return this.daemon.inspectProjectionApplyReceipt(params[0] as string, params[1] as string);
      case "listProjectionPriorCommittedApplies":
        return this.daemon.listProjectionPriorCommittedApplies(params[0] as string, params[1] as string);
      case "readbackProjectionApply":
        return this.daemon.readbackProjectionApply(params[0] as string, params[1] as ProjectionRequestV1);
      case "recoverProjectionApply":
        return this.daemon.recoverProjectionApply(params[0] as string, params[1] as ProjectionApplyRecoveryIntentV1);
      case "ledgerState":
        return this.daemon.ledgerState(params[0] as string);
      case "ledgerDrift":
        return this.daemon.ledgerDrift(params[0] as string);
      case "ledgerProject":
        return this.daemon.ledgerProject(params[0] as string, params[1] as RuntimeLedgerProjectInput | undefined);
      case "ledgerMigrate":
        return this.daemon.ledgerMigrate(params[0] as string, params[1] as RuntimeLedgerMigrateInput | undefined);
      case "ledgerRebuild":
        return this.daemon.ledgerRebuild(params[0] as string, params[1] as RuntimeLedgerRebuildInput | undefined);
      case "ledgerRollback":
        return this.daemon.ledgerRollback(params[0] as string, params[1] as RuntimeLedgerRollbackInput | undefined);
      case "book":
        return this.daemon.book(params[0] as string, params[1] as RuntimeBookInput | undefined);
      case "recommendations":
        return this.daemon.recommendations(params[0] as string, params[1] as RuntimeRecommendationInput);
      case "refactorScan":
        return this.daemon.refactorScan(params[0] as string, params[1] as RuntimeRefactorScanInput | undefined);
      case "refactorRecord":
        return this.daemon.refactorRecord(params[0] as string, params[1] as RuntimeRefactorRecordInput);
      case "refactorVerify":
        return this.daemon.refactorVerify(params[0] as string, params[1] as RuntimeRefactorVerifyInput);
      case "repoAdd":
        return this.daemon.repoAdd(params[0] as string, params[1] as string | undefined);
      case "repoList":
        return this.daemon.repoList();
      case "repoRemove":
        return this.daemon.repoRemove(params[0] as string);
      case "landscapeStatus":
        return this.daemon.landscapeStatus();
      case "explorerServiceContract":
        return this.daemon.explorerServiceContract(params[0] as number | undefined);
      case "explorerProjectionV2":
        return this.daemon.explorerProjectionV2(params[0] as string, params[1] as ExplorerProjectionQueryV2);
      case "explorerProjectionDelta":
        return this.daemon.explorerProjectionDelta(params[0] as string, params[1] as ExplorerDeltaQueryV2);
      case "startExplorer":
        return this.daemon.startExplorer(params[0] as string, params[1] as ExplorerServerOptions | undefined);
      case "stopExplorer":
        return this.daemon.stopExplorer();
      case "revokeExplorerToken":
        return this.daemon.revokeExplorerToken();
      case "explorerStatus":
        return this.daemon.explorerStatus();
      case "contextLandscape":
        return this.daemon.contextLandscape(params[0] as string, params[1] as number | undefined);
      case "runtimeStatus":
        return this.daemon.runtimeStatus(params[0] as string | undefined);
      // Developer-review inputs are decoded strictly at the boundary: they carry filesystem paths
      // and the cleanup/recovery pair deletes real directories, so an unknown field (including the
      // in-process-only `tempRoot`/`stateDir` overrides) is rejected rather than ignored.
      case "startDeveloperReviewRun":
        return okEnvelope("developerReview.startRun", this.daemon.startDeveloperReviewRun(decodeStartDeveloperReviewRunParams(params)) as unknown as Json);
      case "runSignedDeveloperReviewAttestation":
        return okEnvelope("developerReview.attestation", await this.daemon.runSignedDeveloperReviewAttestation(decodeSignedDeveloperReviewAttestationParams(params)) as unknown as Json);
      case "cleanupDeveloperReviewRun":
        return okEnvelope("developerReview.cleanupRun", this.daemon.cleanupDeveloperReviewRun(decodeDeveloperReviewRunCleanupRequest(params[0])) as unknown as Json);
      case "recoverDeveloperReviewRuns":
        return okEnvelope("developerReview.recoverRuns", this.daemon.recoverDeveloperReviewRuns(decodeRecoverDeveloperReviewRunsParams(params)) as unknown as Json);
      case "shutdown":
        return okEnvelope("daemon.stop", { stopping: true } as Json);
      default:
        return {
          schemaVersion: "archcontext.envelope/v1",
          ok: false,
          requestId: "runtime-rpc",
          error: {
            code: "AC_SCHEMA_INVALID",
            message: `Unknown runtime RPC method: ${method}`,
            severity: "error",
            retryable: false,
            action: "upgrade-client"
          }
        };
    }
  }
}

function requestRpcVersionHeader(request: IncomingMessage): string | undefined {
  const header = request.headers["x-archcontext-rpc-version"];
  return Array.isArray(header) ? header[0] : header;
}

function isRpcVersionHeaderCompatible(request: IncomingMessage): boolean {
  const header = requestRpcVersionHeader(request);
  return header === undefined || header === RUNTIME_RPC_VERSION;
}

type RuntimeRpcRequestBody =
  | { ok: true; value: unknown }
  | { ok: false; kind: "aborted" }
  | { ok: false; kind: "rejected"; status: number; error: string };

/**
 * Reads an authenticated RPC body under an explicit resource contract: a declared `Content-Length`
 * over the limit is refused before a byte is read, a chunked upload is counted while streaming and
 * cut off the moment it crosses the limit, and a stalled upload dies on the read deadline. Every
 * exit path drops the accumulated chunks, so a client that disconnects mid-upload releases its
 * buffers immediately. The stream is only paused on rejection — Node destroys the socket itself
 * once the response finishes on an unfinished request, which keeps the rejection response
 * deliverable instead of racing a manual destroy.
 */
async function readRpcRequestBody(request: IncomingMessage, limits: { maxBytes: number; timeoutMs: number }): Promise<RuntimeRpcRequestBody> {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > limits.maxBytes) {
    request.pause();
    return { ok: false, kind: "rejected", status: 413, error: "runtime RPC request body exceeds the configured limit" };
  }
  return await new Promise<RuntimeRpcRequestBody>((resolveBody) => {
    let chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => {
      settle({ ok: false, kind: "rejected", status: 408, error: "runtime RPC request body read timeout" });
    }, limits.timeoutMs);

    const settle = (result: RuntimeRpcRequestBody): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chunks = [];
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("aborted", onAborted);
      request.off("error", onAborted);
      request.off("close", onClose);
      if (!result.ok) request.pause();
      resolveBody(result);
    };
    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > limits.maxBytes) {
        settle({ ok: false, kind: "rejected", status: 413, error: "runtime RPC request body exceeds the configured limit" });
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = (): void => {
      if (size === 0) {
        settle({ ok: true, value: {} });
        return;
      }
      const body = Buffer.concat(chunks).toString("utf8");
      try {
        settle({ ok: true, value: JSON.parse(body) });
      } catch {
        settle({ ok: false, kind: "rejected", status: 400, error: "runtime RPC request body is not valid JSON" });
      }
    };
    const onAborted = (): void => settle({ ok: false, kind: "aborted" });
    const onClose = (): void => settle({ ok: false, kind: "aborted" });

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("aborted", onAborted);
    request.on("error", onAborted);
    request.on("close", onClose);
  });
}
