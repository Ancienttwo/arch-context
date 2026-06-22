import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  addRepositoryToLandscape,
  bindRepository,
  computeReviewWorktreeDigest,
  computeWorktreeDigest,
  createLandscape,
  landscapeDigest,
  repositoryFingerprint,
  validateLandscape,
  type Landscape,
  type RepositoryRegistration
} from "@archcontext/core/architecture-domain";
import { ChangeSetEngine, type ChangeOperation, type ChangeSetDraft } from "@archcontext/core/changeset-engine";
import { prepareTask } from "@archcontext/core/application";
import { completeTaskGate, type CompleteTaskInput } from "@archcontext/core/review-engine";
import { CodeGraphAdapter, CodeGraphCliProvider, MultiRepoCodeGraphAdapter, type CodeGraphProvider } from "@archcontext/local-runtime/codegraph-adapter";
import { compileLandscapeTaskContext } from "@archcontext/core/context-compiler";
import { assertNoCallerProvidedAttestationFields, attestationV2Digest, canonicalAttestationV2, createAttestationV2, digestJson, LOCAL_RUNTIME_RPC_SCHEMA_VERSION, okEnvelope, productVersionManifest, type AttestationResult, type AttestationV2, type CodeFactsPort, type CodeFactsSnapshot, type DevicePrivateKeySignerPort, type ExplorerProjection, type ExplorerServiceContract, type Json, type JsonEnvelope, type ModelStorePort, type RepositorySnapshot, type ReviewChallengeV2, type WorkspaceRef } from "@archcontext/contracts";
import { findRepositoryRoot, prepareDetachedReviewWorktree, readHeadSha, readTrackedTreeEntries, removeDetachedReviewWorktree, verifyDetachedReviewWorktree, type DetachedReviewWorktree, type DetachedReviewWorktreePreparation } from "@archcontext/local-runtime/git-adapter";
import { defaultLocalStorePath, SqliteLocalStore, type RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import { initializeArchContextModel, rebuildGeneratedProjection, YamlModelStore } from "@archcontext/local-runtime/model-store-yaml";

export interface RuntimeStatus {
  running: boolean;
  sessions: number;
  repositories: string[];
}

export interface RepositorySession {
  workspace: WorkspaceRef;
  snapshot: RepositorySnapshot;
  codeFactsDigest?: string;
  modelDigest?: string;
  startedAt: string;
}

export interface DeveloperReviewDigestBundle {
  schemaVersion: "archcontext.developer-review-digest-bundle/v1";
  challengeId: string;
  repositoryId: number;
  headSha: string;
  headTreeOid: string;
  worktreeDigest: string;
  modelDigest: string;
  policyDigest: string;
  codeFactsDigest: string;
  runtime: AttestationV2["runtime"];
}

export interface DeveloperReviewSession {
  schemaVersion: "archcontext.developer-review-session/v1";
  challengeId: string;
  taskSessionId: string;
  reviewId: string;
  reviewDigest: string;
  reviewResult: "pass" | "pass_with_warnings" | "fail_action_required";
  attestationResult: AttestationResult;
  summary: {
    errors: number;
    warnings: number;
    notices: number;
  };
  digests: DeveloperReviewDigestBundle;
}

export interface RuntimeCompleteTaskInput {
  taskSessionId?: string;
  posture?: CompleteTaskInput["posture"];
  headSha?: string;
  compatibilityContract?: CompleteTaskInput["compatibilityContract"];
  compatibilityPathIntroduced?: boolean;
  cleanupRequired?: number;
  cleanupCompleted?: number;
}

export interface DeveloperReviewAttestation {
  schemaVersion: "archcontext.developer-review-attestation/v1";
  challengeId: string;
  reviewSession: DeveloperReviewSession;
  attestation: AttestationV2;
  attestationDigest: string;
  signingPayloadDigest: string;
}

export type DeveloperReviewRunStatus = "preparing" | "running";

export interface DeveloperReviewRunManifest {
  schemaVersion: "archcontext.developer-review-run/v1";
  runId: string;
  challengeId: string;
  repositoryId: number;
  sourceRoot: string;
  runRoot: string;
  worktreeTempRoot: string;
  manifestPath: string;
  lockPath: string;
  pid: number;
  createdAt: string;
  status: DeveloperReviewRunStatus;
  codeGraphTemporaryState: {
    root: string;
    cleanup: "remove-run-root";
  };
  worktree?: DetachedReviewWorktree;
}

export interface DeveloperReviewRun extends DeveloperReviewRunManifest {
  status: "running";
  worktree: DetachedReviewWorktree;
}

export interface DeveloperReviewRunPreparation extends DetachedReviewWorktreePreparation {
  run?: DeveloperReviewRun;
  cleanup?: DeveloperReviewRunCleanup;
}

export interface DeveloperReviewRunCleanup {
  schemaVersion: "archcontext.developer-review-run-cleanup/v1";
  runId: string;
  challengeId: string;
  cleaned: boolean;
  removed: Array<"worktree" | "run-root" | "manifest" | "lock">;
  errors: string[];
}

export interface DeveloperReviewRunRecovery {
  schemaVersion: "archcontext.developer-review-run-recovery/v1";
  sourceRoot: string;
  stateDir: string;
  recovered: DeveloperReviewRunCleanup[];
  removedLocks: string[];
  skippedActive: string[];
}

export interface RuntimeDeps {
  codeFacts?: CodeFactsPort;
  codeGraphProviderFactory?: (repository: RepositoryRegistration) => CodeGraphProvider;
  modelStore?: ModelStorePort;
  localStore?: RuntimeLocalStore;
  changeSetEngine?: ChangeSetEngine;
  devicePrivateKeySigner?: DevicePrivateKeySignerPort;
  localStorePath?: string;
  clock?: () => string;
  maxRepoSessions?: number;
}

export interface ProductionRuntimeOptions {
  root?: string;
  localStorePath?: string;
  maxRepoSessions?: number;
}

export type RuntimeCompositionMode = "production" | "embedded";

export interface RuntimeCompositionReport {
  mode: RuntimeCompositionMode;
  productionSafe: boolean;
  adapters: {
    codeFacts: "codegraph-cli" | "injected";
    codeGraphProviderFactory: "codegraph-cli" | "injected";
    modelStore: "yaml" | "injected";
    localStore: "sqlite" | "injected";
    changeSetEngine: "default" | "injected";
  };
  localStorePath?: string;
  blockedProductionInjections: string[];
}

interface RuntimeConstructionOptions {
  compositionMode?: RuntimeCompositionMode;
}

export interface ExplorerServerOptions {
  port?: number;
  tokenTtlSeconds?: number;
}

export interface ExplorerServerStatus {
  running: boolean;
  host: "127.0.0.1";
  port?: number;
  url?: string;
  tokenExpiresAt?: string;
  revoked: boolean;
  readOnly: true;
}

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
  reason: "rpc-version-mismatch";
  expected: typeof RUNTIME_RPC_VERSION;
  received: string;
  connectionPath: string;
  lockPath: string;
  pid?: number;
  pidAlive: boolean;
  upgradeCommand: "archctx daemon upgrade";
}

export type DaemonControlRecoveryReason =
  | "insecure-connection-file"
  | "invalid-connection-file"
  | "dead-connection-pid"
  | "unhealthy-connection-file"
  | "stale-lock-file";

export interface DaemonControlRecovery {
  connectionPath: string;
  lockPath: string;
  removed: DaemonControlRecoveryReason[];
}

export interface RuntimeRpcServerOptions {
  root?: string;
  port?: number;
  token?: string;
  lockPath?: string;
  connectionPath?: string;
  clock?: () => string;
  onStop?: () => void;
}

export interface RuntimeDaemonClient {
  init(root: string, productName?: string): Promise<JsonEnvelope> | JsonEnvelope;
  sync(root: string, changedPaths?: string[]): Promise<JsonEnvelope> | JsonEnvelope;
  validate(root: string): Promise<JsonEnvelope> | JsonEnvelope;
  context(root: string, task: string, maxSymbols?: number): Promise<JsonEnvelope> | JsonEnvelope;
  prepare(root: string, task: string, maxBytes?: number, maxItems?: number): Promise<JsonEnvelope> | JsonEnvelope;
  planUpdate(root: string, input: { id: string; operations: ChangeOperation[]; reason?: { taskSessionId: string; interventionId?: string } }): Promise<JsonEnvelope> | JsonEnvelope;
  completeTask(root: string, input?: RuntimeCompleteTaskInput): Promise<JsonEnvelope> | JsonEnvelope;
  applyUpdate(root: string, input: { id: string; approved: boolean; expectedWorktreeDigest: string }): Promise<JsonEnvelope> | JsonEnvelope;
  repoAdd(root: string, name?: string): Promise<JsonEnvelope> | JsonEnvelope;
  repoList(): Promise<JsonEnvelope> | JsonEnvelope;
  repoRemove(repositoryId: string): Promise<JsonEnvelope> | JsonEnvelope;
  landscapeStatus(): Promise<JsonEnvelope> | JsonEnvelope;
  explorerServiceContract(tokenTtlSeconds?: number): Promise<JsonEnvelope> | JsonEnvelope;
  explorerProjection(root: string, query?: string): Promise<JsonEnvelope> | JsonEnvelope;
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
    tempRoot?: string;
    stateDir?: string;
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
  cleanupDeveloperReviewRun(run: DeveloperReviewRunManifest): Promise<DeveloperReviewRunCleanup> | DeveloperReviewRunCleanup;
  recoverDeveloperReviewRuns(input: {
    repositoryRoot: string;
    stateDir?: string;
    force?: boolean;
  }): Promise<DeveloperReviewRunRecovery> | DeveloperReviewRunRecovery;
}

interface ExplorerServerSession {
  server: Server;
  root: string;
  host: "127.0.0.1";
  port: number;
  token: string;
  expiresAt: number;
  revoked: boolean;
}

interface ModelFileSummary {
  path: string;
  schemaVersion: string;
  digest: string;
}

export class ArchctxDaemon {
  private readonly codeFacts: CodeFactsPort;
  private readonly codeGraphProviderFactory: (repository: RepositoryRegistration) => CodeGraphProvider;
  private readonly modelStore: ModelStorePort;
  private readonly localStore: RuntimeLocalStore;
  private readonly changeSetEngine: ChangeSetEngine;
  private readonly devicePrivateKeySigner?: DevicePrivateKeySignerPort;
  private readonly clock: () => string;
  private readonly maxRepoSessions: number;
  private readonly composition: RuntimeCompositionReport;
  private readonly sessions = new Map<string, RepositorySession>();
  private readonly changesets = new Map<string, ChangeSetDraft>();
  private landscape?: Landscape;
  private explorer?: ExplorerServerSession;
  private running = false;
  private writerLocked = false;

  constructor(deps: RuntimeDeps = {}, options: RuntimeConstructionOptions = {}) {
    if (options.compositionMode === "production") assertProductionRuntimeDeps(deps);
    this.codeFacts = deps.codeFacts ?? new CodeGraphAdapter(new CodeGraphCliProvider());
    this.codeGraphProviderFactory = deps.codeGraphProviderFactory ?? ((repository) => new CodeGraphCliProvider(repository.root ?? repository.repositoryId));
    this.modelStore = deps.modelStore ?? new YamlModelStore();
    this.localStore = deps.localStore ?? new SqliteLocalStore(deps.localStorePath ?? defaultLocalStorePath());
    this.changeSetEngine = deps.changeSetEngine ?? new ChangeSetEngine({
      modelStore: this.modelStore,
      projection: { rebuildGeneratedProjection },
      journal: this.localStore
    });
    this.devicePrivateKeySigner = deps.devicePrivateKeySigner;
    this.clock = deps.clock ?? (() => new Date(0).toISOString());
    this.maxRepoSessions = deps.maxRepoSessions ?? 8;
    this.composition = runtimeCompositionReport(deps, options.compositionMode ?? "embedded");
  }

  async start(): Promise<void> {
    await this.localStore.migrate();
    this.localStore.recoverPendingSnapshots();
    this.localStore.recoverPendingChangeSets();
    this.running = true;
    await this.restoreRepositorySessions();
  }

  async stop(): Promise<void> {
    await this.closeExplorer();
    this.sessions.clear();
    this.localStore.close();
    this.running = false;
  }

  status(): RuntimeStatus {
    return {
      running: this.running,
      sessions: this.sessions.size,
      repositories: [...this.sessions.keys()].sort()
    };
  }

  compositionReport(): RuntimeCompositionReport {
    return this.composition;
  }

  async init(root: string, productName?: string): Promise<JsonEnvelope> {
    this.assertRunning();
    return this.withWriter(async () => {
      initializeArchContextModel(root, productName);
      rebuildGeneratedProjection(root);
      const session = await this.openSession(root);
      return okEnvelope("init", {
        repositoryId: session.workspace.repositoryId,
        headSha: session.workspace.headSha,
        worktreeDigest: session.snapshot.worktreeDigest,
        modelDigest: session.modelDigest
      } as Json);
    });
  }

  async sync(root: string, changedPaths: string[] = []): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const codeFacts = await this.codeFacts.sync({ workspace: session.workspace, changedPaths });
    session.codeFactsDigest = codeFacts.schemaDigest;
    return okEnvelope("sync", { codeFactsDigest: codeFacts.schemaDigest, indexedAt: codeFacts.indexedAt } as Json);
  }

  async validate(root: string): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const result = await this.modelStore.validateModel(session.workspace);
    session.modelDigest = result.modelDigest;
    return okEnvelope("validate", result as unknown as Json);
  }

  async context(root: string, task: string, maxSymbols = 12): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const codeFacts = await this.codeFacts.ensureReady(session.workspace);
    const model = await this.modelStore.validateModel(session.workspace);
    const codeContext = await this.codeFacts.buildTaskContext({ task, maxSymbols, includeSource: false });
    return okEnvelope("context", {
      schemaVersion: "archcontext.task-context/v1",
      task,
      posture: "normal",
      architecturePressure: { level: "low", score: 0, signals: [] },
      refactorConfidence: { level: "high", score: 80, coverage: ["codegraph-ready"] },
      relevantNodes: [],
      constraints: [],
      decisions: [],
      realConstraints: [],
      unknowns: [],
      recommendedTargetState: {},
      requiredCheckpoints: ["before-task-complete"],
      resources: [{ type: "codefacts", digest: codeFacts.schemaDigest }, { type: "model", digest: model.modelDigest }, { type: "code-context", digest: codeContext.digest }]
    } as Json);
  }

  async prepare(root: string, task: string, maxBytes = 12_288, maxItems = 12): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const result = await prepareTask({
      workspace: session.workspace,
      task,
      codeFacts: this.codeFacts,
      modelStore: this.modelStore,
      budget: { maxBytes, maxItems }
    });
    return okEnvelope("prepare", result as unknown as Json);
  }

  async planUpdate(root: string, input: {
    id: string;
    operations: ChangeOperation[];
    reason?: { taskSessionId: string; interventionId?: string };
  }): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const model = await this.modelStore.validateModel(session.workspace);
    const draft = this.changeSetEngine.plan({
      id: input.id,
      base: {
        headSha: session.workspace.headSha,
        worktreeDigest: session.snapshot.worktreeDigest,
        modelDigest: model.modelDigest
      },
      reason: input.reason ?? { taskSessionId: "task_runtime" },
      operations: input.operations
    });
    this.changesets.set(draft.id, draft);
    return okEnvelope("plan_update", {
      draft,
      preview: this.changeSetEngine.preview(root, draft)
    } as unknown as Json);
  }

  async completeTask(root: string, input: RuntimeCompleteTaskInput = {}): Promise<JsonEnvelope> {
    this.assertRunning();
    assertNoCallerProvidedAttestationFields(input, "complete-task");
    const session = await this.openSession(root);
    let currentHeadSha = input.headSha;
    try {
      currentHeadSha = readHeadSha(session.workspace.root);
    } catch (error) {
      if (!currentHeadSha) throw error;
    }
    const model = await this.modelStore.validateModel(session.workspace);
    const codeFacts = await this.codeFacts.sync({ workspace: session.workspace });
    const reviewInput: CompleteTaskInput = {
      taskSessionId: input.taskSessionId ?? "task_runtime",
      posture: input.posture ?? "normal",
      headSha: input.headSha ?? currentHeadSha!,
      currentHeadSha: currentHeadSha!,
      worktreeDigest: computeWorktreeDigest(session.workspace.root),
      modelDigest: model.modelDigest,
      codeFactsDigest: codeFactsDigest(codeFacts),
      ...(input.compatibilityContract === undefined ? {} : { compatibilityContract: input.compatibilityContract }),
      ...(input.compatibilityPathIntroduced === undefined ? {} : { compatibilityPathIntroduced: input.compatibilityPathIntroduced }),
      ...(input.cleanupRequired === undefined ? {} : { cleanupRequired: input.cleanupRequired }),
      ...(input.cleanupCompleted === undefined ? {} : { cleanupCompleted: input.cleanupCompleted })
    };
    const review = completeTaskGate(reviewInput);
    await this.localStore.saveReviewResult(review.reviewId, review);
    return okEnvelope("complete_task", review as unknown as Json);
  }

  async applyUpdate(root: string, input: {
    id: string;
    approved: boolean;
    expectedWorktreeDigest: string;
  }): Promise<JsonEnvelope> {
    this.assertRunning();
    if (!input.expectedWorktreeDigest) throw new Error("apply_update requires expectedWorktreeDigest");
    const current = computeWorktreeDigest(root);
    if (current !== input.expectedWorktreeDigest) throw new Error("Worktree digest changed before apply");
    const draft = this.changesets.get(input.id);
    if (!draft) throw new Error(`Unknown ChangeSet: ${input.id}`);
    const approved = input.approved ? this.changeSetEngine.approve(draft) : draft;
    const result = await this.changeSetEngine.apply(root, approved, { approved: input.approved });
    return okEnvelope("apply_update", result as unknown as Json);
  }

  prepareDeveloperReviewWorktree(input: {
    repositoryRoot: string;
    challenge: ReviewChallengeV2;
    expectedHeadTreeOid?: string;
    tempRoot?: string;
  }): DetachedReviewWorktreePreparation {
    this.assertRunning();
    return prepareDetachedReviewWorktree({
      sourceRoot: input.repositoryRoot,
      headSha: input.challenge.headSha,
      expectedHeadTreeOid: input.expectedHeadTreeOid,
      tempRoot: input.tempRoot
    });
  }

  startDeveloperReviewRun(input: {
    repositoryRoot: string;
    challenge: ReviewChallengeV2;
    expectedHeadTreeOid?: string;
    tempRoot?: string;
    stateDir?: string;
  }): DeveloperReviewRunPreparation {
    this.assertRunning();
    const sourceRoot = findRepositoryRoot(input.repositoryRoot);
    const paths = createDeveloperReviewRunPaths({
      sourceRoot,
      challengeId: input.challenge.challengeId,
      tempRoot: input.tempRoot,
      stateDir: input.stateDir
    });
    mkdirSync(paths.stateDir, { recursive: true });
    mkdirSync(paths.runRoot, { recursive: true });
    mkdirSync(paths.worktreeTempRoot, { recursive: true });
    const preparing: DeveloperReviewRunManifest = {
      schemaVersion: "archcontext.developer-review-run/v1",
      runId: paths.runId,
      challengeId: input.challenge.challengeId,
      repositoryId: input.challenge.repositoryId,
      sourceRoot,
      runRoot: paths.runRoot,
      worktreeTempRoot: paths.worktreeTempRoot,
      manifestPath: paths.manifestPath,
      lockPath: paths.lockPath,
      pid: process.pid,
      createdAt: this.clock(),
      status: "preparing",
      codeGraphTemporaryState: {
        root: paths.runRoot,
        cleanup: "remove-run-root"
      }
    };
    if (existsSync(paths.lockPath) || existsSync(paths.manifestPath)) {
      rmSync(paths.runRoot, { recursive: true, force: true });
      throw new Error(`developer-review-run-already-active: ${input.challenge.challengeId}`);
    }
    let lockAcquired = false;
    try {
      writePrivateJson(paths.lockPath, {
        schemaVersion: "archcontext.developer-review-run-lock/v1",
        runId: paths.runId,
        challengeId: input.challenge.challengeId,
        pid: process.pid,
        createdAt: preparing.createdAt
      }, "wx");
      lockAcquired = true;
      writeDeveloperReviewRunManifest(preparing);
      const prepared = prepareDetachedReviewWorktree({
        sourceRoot,
        headSha: input.challenge.headSha,
        expectedHeadTreeOid: input.expectedHeadTreeOid,
        tempRoot: paths.worktreeTempRoot
      });
      if (!prepared.accepted || !prepared.worktree) {
        const cleanup = this.cleanupDeveloperReviewRun(preparing);
        return { ...prepared, cleanup };
      }
      const run: DeveloperReviewRun = {
        ...preparing,
        status: "running",
        worktree: prepared.worktree
      };
      writeDeveloperReviewRunManifest(run);
      return { ...prepared, run };
    } catch (error) {
      if (lockAcquired) {
        this.cleanupDeveloperReviewRun(preparing);
      } else {
        rmSync(paths.runRoot, { recursive: true, force: true });
      }
      throw error;
    }
  }

  async withDeveloperReviewRun<T>(input: {
    repositoryRoot: string;
    challenge: ReviewChallengeV2;
    expectedHeadTreeOid?: string;
    tempRoot?: string;
    stateDir?: string;
  }, run: (developerReviewRun: DeveloperReviewRun) => Promise<T> | T): Promise<T> {
    const prepared = this.startDeveloperReviewRun(input);
    if (!prepared.accepted || !prepared.run) {
      throw new Error(`developer-review-run-prepare-failed: ${prepared.reasonCode ?? "UNKNOWN"}`);
    }
    try {
      return await run(prepared.run);
    } finally {
      this.cleanupDeveloperReviewRun(prepared.run);
    }
  }

  cleanupDeveloperReviewRun(run: DeveloperReviewRunManifest): DeveloperReviewRunCleanup {
    const removed: DeveloperReviewRunCleanup["removed"] = [];
    const errors: string[] = [];
    if (run.worktree) {
      try {
        const hadWorktree = existsSync(run.worktree.worktreeRoot);
        removeDetachedReviewWorktree(run.worktree);
        if (hadWorktree) removed.push("worktree");
      } catch (error) {
        errors.push(cleanupErrorMessage("worktree", error));
      }
    }
    for (const [kind, path] of [
      ["run-root", run.runRoot],
      ["manifest", run.manifestPath],
      ["lock", run.lockPath]
    ] as const) {
      try {
        const existed = existsSync(path);
        rmSync(path, { recursive: true, force: true });
        if (existed) removed.push(kind);
      } catch (error) {
        errors.push(cleanupErrorMessage(kind, error));
      }
    }
    return {
      schemaVersion: "archcontext.developer-review-run-cleanup/v1",
      runId: run.runId,
      challengeId: run.challengeId,
      cleaned: errors.length === 0,
      removed,
      errors
    };
  }

  recoverDeveloperReviewRuns(input: {
    repositoryRoot: string;
    stateDir?: string;
    force?: boolean;
  }): DeveloperReviewRunRecovery {
    this.assertRunning();
    const sourceRoot = findRepositoryRoot(input.repositoryRoot);
    const stateDir = input.stateDir ? resolve(input.stateDir) : defaultDeveloperReviewRunStateDir(sourceRoot);
    const recovery: DeveloperReviewRunRecovery = {
      schemaVersion: "archcontext.developer-review-run-recovery/v1",
      sourceRoot,
      stateDir,
      recovered: [],
      removedLocks: [],
      skippedActive: []
    };
    if (!existsSync(stateDir)) return recovery;

    for (const entry of readdirSync(stateDir).sort()) {
      if (!entry.endsWith(".json")) continue;
      const manifestPath = join(stateDir, entry);
      const manifest = readDeveloperReviewRunManifest(manifestPath);
      if (!manifest) {
        rmSync(manifestPath, { force: true });
        continue;
      }
      if (!input.force && isDeveloperReviewPidAlive(manifest.pid)) {
        recovery.skippedActive.push(manifest.runId);
        continue;
      }
      recovery.recovered.push(this.cleanupDeveloperReviewRun(manifest));
    }

    for (const entry of readdirSync(stateDir).sort()) {
      if (!entry.endsWith(".lock")) continue;
      const lockPath = join(stateDir, entry);
      const lock = readJsonObject(lockPath);
      const pid = typeof lock?.pid === "number" ? lock.pid : undefined;
      const runId = typeof lock?.runId === "string" ? lock.runId : entry;
      if (!input.force && pid !== undefined && isDeveloperReviewPidAlive(pid)) {
        recovery.skippedActive.push(runId);
        continue;
      }
      rmSync(lockPath, { force: true });
      recovery.removedLocks.push(lockPath);
    }
    return recovery;
  }

  async computeDeveloperReviewDigestBundle(input: {
    challenge: ReviewChallengeV2;
    worktree: DetachedReviewWorktree;
    codeFactsSnapshot?: CodeFactsSnapshot;
    sparseScope?: string[];
  }): Promise<DeveloperReviewDigestBundle> {
    this.assertRunning();
    const verification = verifyDetachedReviewWorktree({
      worktreeRoot: input.worktree.worktreeRoot,
      expectedHeadSha: input.challenge.headSha,
      expectedHeadTreeOid: input.worktree.headTreeOid
    });
    if (!verification.accepted) throw new Error(`developer-review-worktree-invalid: ${verification.reasonCode ?? "UNKNOWN"}`);

    const workspace: WorkspaceRef = {
      root: input.worktree.worktreeRoot,
      repositoryId: `github.repository.${input.challenge.repositoryId}`,
      headSha: input.challenge.headSha
    };
    const model = await this.modelStore.validateModel(workspace);
    const modelFiles = await this.modelStore.loadModel(workspace);
    const codeFacts = input.codeFactsSnapshot ?? await this.codeFacts.sync({ workspace });
    return {
      schemaVersion: "archcontext.developer-review-digest-bundle/v1",
      challengeId: input.challenge.challengeId,
      repositoryId: input.challenge.repositoryId,
      headSha: input.challenge.headSha,
      headTreeOid: input.worktree.headTreeOid,
      worktreeDigest: computeReviewWorktreeDigest({
        repositoryNumericId: input.challenge.repositoryId,
        headSha: input.challenge.headSha,
        headTreeOid: input.worktree.headTreeOid,
        trackedTree: readTrackedTreeEntries(input.worktree.worktreeRoot),
        sparseScope: input.sparseScope
      }),
      modelDigest: model.modelDigest,
      policyDigest: policyDigestForModelFiles(modelFiles, input.challenge.policyProfileId),
      codeFactsDigest: codeFactsDigest(codeFacts),
      runtime: runtimeAttestationIdentity(codeFacts, this.composition)
    };
  }

  async runDeveloperReviewSession(input: {
    challenge: ReviewChallengeV2;
    worktree: DetachedReviewWorktree;
    taskSessionId?: string;
    posture?: CompleteTaskInput["posture"];
    compatibilityContract?: CompleteTaskInput["compatibilityContract"];
    compatibilityPathIntroduced?: boolean;
    cleanupRequired?: number;
    cleanupCompleted?: number;
  }): Promise<DeveloperReviewSession> {
    this.assertRunning();
    const digests = await this.computeDeveloperReviewDigestBundle({
      challenge: input.challenge,
      worktree: input.worktree
    });
    const review = completeTaskGate({
      taskSessionId: input.taskSessionId ?? `developer_review_${input.challenge.challengeId}`,
      posture: input.posture ?? "normal",
      headSha: input.challenge.headSha,
      currentHeadSha: input.challenge.headSha,
      worktreeDigest: digests.worktreeDigest,
      modelDigest: digests.modelDigest,
      codeFactsDigest: digests.codeFactsDigest,
      compatibilityContract: input.compatibilityContract,
      compatibilityPathIntroduced: input.compatibilityPathIntroduced,
      cleanupRequired: input.cleanupRequired,
      cleanupCompleted: input.cleanupCompleted
    });
    await this.localStore.saveReviewResult(review.reviewId, review);
    return {
      schemaVersion: "archcontext.developer-review-session/v1",
      challengeId: input.challenge.challengeId,
      taskSessionId: review.taskSessionId,
      reviewId: review.reviewId,
      reviewDigest: review.extensions.digest,
      reviewResult: review.result,
      attestationResult: review.result === "fail_action_required" ? "fail" : "pass",
      summary: review.summary,
      digests
    };
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
    this.assertRunning();
    assertNoCallerProvidedAttestationFields(input, "developer-review-attestation");
    if (!this.devicePrivateKeySigner) throw new Error("device-private-key-signer-unavailable");
    const startedAt = input.startedAt ?? this.clock();
    const reviewSession = await this.runDeveloperReviewSession({
      challenge: input.challenge,
      worktree: input.worktree,
      taskSessionId: input.taskSessionId
    });
    const completedAt = input.completedAt ?? this.clock();
    const unsigned = createAttestationV2({
      challengeId: input.challenge.challengeId,
      installationId: input.challenge.installationId,
      repositoryId: input.challenge.repositoryId,
      pullRequestNumber: input.challenge.pullRequestNumber,
      headSha: input.challenge.headSha,
      baseSha: input.challenge.baseSha,
      mergeBaseSha: input.mergeBaseSha ?? input.challenge.baseSha,
      headTreeOid: reviewSession.digests.headTreeOid,
      worktreeDigest: reviewSession.digests.worktreeDigest,
      modelDigest: reviewSession.digests.modelDigest,
      policyDigest: reviewSession.digests.policyDigest,
      codeFactsDigest: reviewSession.digests.codeFactsDigest,
      reviewDigest: reviewSession.reviewDigest,
      result: reviewSession.attestationResult,
      execution: {
        trustLevel: "developer",
        source: "clean-commit-worktree",
        principalId: input.principalId,
        publicKeyId: input.publicKeyId
      },
      runtime: reviewSession.digests.runtime,
      nonce: input.challenge.nonce,
      startedAt,
      completedAt,
      expiresAt: input.challenge.expiresAt
    });
    const signingPayload = canonicalAttestationV2(unsigned);
    const signature = this.devicePrivateKeySigner.signWithDevicePrivateKey({
      keyRef: input.keyRef,
      payload: signingPayload
    });
    const attestation = createAttestationV2({
      ...unsigned,
      signature: { algorithm: "ed25519", value: signature }
    });
    return {
      schemaVersion: "archcontext.developer-review-attestation/v1",
      challengeId: input.challenge.challengeId,
      reviewSession,
      attestation,
      attestationDigest: attestationV2Digest(attestation),
      signingPayloadDigest: digestJson(signingPayload)
    };
  }

  async repoAdd(root: string, name?: string): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const repository: RepositoryRegistration = {
      repositoryId: session.workspace.repositoryId,
      numericRepositoryId: numericRepositoryId(session.workspace.repositoryId),
      name: name ?? session.workspace.repositoryId,
      role: "application",
      root: session.workspace.root,
      defaultBranch: "main"
    };
    this.landscape = this.landscape
      ? addRepositoryToLandscape(this.landscape, repository)
      : createLandscape({ id: "local", name: "Local Landscape", repositories: [repository] });
    await this.localStore.saveLandscape(this.landscape);
    return okEnvelope("repo.add", { repository, landscapeDigest: landscapeDigest(this.landscape) } as unknown as Json);
  }

  async repoList(): Promise<JsonEnvelope> {
    this.assertRunning();
    return okEnvelope("repo.list", {
      repositories: this.landscape?.repositories ?? [],
      activeSessions: [...this.sessions.keys()].sort()
    } as unknown as Json);
  }

  async repoRemove(repositoryId: string): Promise<JsonEnvelope> {
    this.assertRunning();
    this.sessions.delete(repositoryId);
    if (this.landscape) {
      this.landscape = {
        ...this.landscape,
        repositories: this.landscape.repositories.filter((repo) => repo.repositoryId !== repositoryId),
        relations: this.landscape.relations
      };
      await this.localStore.saveLandscape(this.landscape);
    }
    return okEnvelope("repo.remove", { repositoryId, removed: true } as Json);
  }

  async loadLandscape(landscape: Landscape): Promise<JsonEnvelope> {
    this.assertRunning();
    const validation = validateLandscape(landscape);
    if (!validation.valid) {
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: false,
        requestId: "landscape",
        error: {
          code: "AC_SCHEMA_INVALID",
          message: validation.errors.join("; "),
          severity: "error",
          retryable: false,
          action: "repair-model"
        }
      };
    }
    this.landscape = landscape;
    await this.localStore.saveLandscape(landscape);
    return okEnvelope("landscape", { id: landscape.id, repositories: landscape.repositories.length, digest: landscapeDigest(landscape) } as Json);
  }

  async landscapeStatus(): Promise<JsonEnvelope> {
    this.assertRunning();
    const landscape = this.landscape ?? createLandscape({ id: "local", name: "Local Landscape", repositories: [] });
    return okEnvelope("landscape", {
      ...landscape,
      digest: landscapeDigest(landscape)
    } as unknown as Json);
  }

  explorerServiceContract(tokenTtlSeconds = 900): JsonEnvelope {
    const contract: ExplorerServiceContract = {
      schemaVersion: "archcontext.explorer-service/v1",
      bindHost: "127.0.0.1",
      protocol: "http-loopback",
      optIn: true,
      defaultEnabled: false,
      tokenTtlSeconds,
      readOnly: true,
      allowedMethods: ["GET"],
      egress: "none"
    };
    return okEnvelope("explorer.contract", contract as unknown as Json);
  }

  async explorerProjection(root: string, query?: string): Promise<JsonEnvelope> {
    this.assertRunning();
    const projection = await this.buildExplorerProjection(root, query);
    return okEnvelope("explorer.projection", projection as unknown as Json);
  }

  async startExplorer(root: string, options: ExplorerServerOptions = {}): Promise<JsonEnvelope> {
    this.assertRunning();
    await this.closeExplorer();
    const ttlSeconds = options.tokenTtlSeconds ?? 900;
    const token = randomBytes(18).toString("base64url");
    const expiresAt = Date.parse(this.clock()) + ttlSeconds * 1000;
    const holder = {} as ExplorerServerSession;
    const server = createServer((request, response) => {
      void this.handleExplorerRequest(request, response, holder).catch((error) => {
        writeJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    });
    Object.assign(holder, {
      server,
      root,
      host: "127.0.0.1",
      port: 0,
      token,
      expiresAt,
      revoked: false
    });
    await new Promise<void>((resolveListen) => server.listen(options.port ?? 0, "127.0.0.1", resolveListen));
    holder.port = (server.address() as AddressInfo).port;
    this.explorer = holder;
    return okEnvelope("explorer.start", {
      ...this.explorerStatusData(),
      token,
      tokenTtlSeconds: ttlSeconds
    } as Json);
  }

  async stopExplorer(): Promise<JsonEnvelope> {
    this.assertRunning();
    await this.closeExplorer();
    return okEnvelope("explorer.stop", this.explorerStatusData() as unknown as Json);
  }

  async revokeExplorerToken(): Promise<JsonEnvelope> {
    this.assertRunning();
    if (this.explorer) this.explorer.revoked = true;
    return okEnvelope("explorer.revoke", this.explorerStatusData() as unknown as Json);
  }

  explorerStatus(): JsonEnvelope {
    this.assertRunning();
    return okEnvelope("explorer.status", this.explorerStatusData() as unknown as Json);
  }

  async contextLandscape(task: string, maxSymbols = 12): Promise<JsonEnvelope> {
    this.assertRunning();
    if (!this.landscape || this.landscape.repositories.length === 0) {
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: false,
        requestId: "context",
        error: {
          code: "AC_PRECONDITION_FAILED",
          message: "landscape context requires registered repositories",
          severity: "warning",
          retryable: true,
          action: "archctx repo add"
        }
      };
    }
    const workspaces = await Promise.all(
      this.landscape.repositories.map(async (repo) => {
        const session = repo.root ? await this.openSession(repo.root) : undefined;
        return session?.workspace ?? { root: repo.root ?? repo.repositoryId, repositoryId: repo.repositoryId, headSha: "unknown" };
      })
    );
    const context = await compileLandscapeTaskContext({
      landscape: this.landscape,
      relations: await this.localStore.listCrossRepoRelations(this.landscape),
      workspaces,
      task,
      codeFacts: new MultiRepoCodeGraphAdapter(this.createLandscapeCodeGraphProviders()),
      modelStore: this.modelStore,
      budget: { maxBytes: 12_288, maxItems: maxSymbols }
    });
    return okEnvelope("context", context as unknown as Json);
  }

  async runtimeStatus(root?: string): Promise<JsonEnvelope> {
    const status = this.status();
    if (!root) return okEnvelope("status", status as unknown as Json);
    const repositoryId = repositoryFingerprint(root);
    const session = this.sessions.get(repositoryId);
    return okEnvelope("status", {
      ...status,
      repositoryId,
      headSha: session?.workspace.headSha ?? readHeadSha(root),
      worktreeDigest: session?.snapshot.worktreeDigest ?? computeWorktreeDigest(root)
    } as Json);
  }

  async openSession(root: string): Promise<RepositorySession> {
    this.assertRunning();
    const headSha = readHeadSha(root);
    const binding = bindRepository(root, headSha);
    const workspace: WorkspaceRef = {
      root: binding.root,
      repositoryId: binding.repositoryId,
      headSha
    };
    const snapshot: RepositorySnapshot = {
      repositoryId: binding.repositoryId,
      headSha,
      worktreeDigest: binding.worktreeDigest
    };
    const snapshotId = await this.localStore.beginSnapshot(snapshot);
    await this.localStore.commitSnapshot(snapshotId);
    await this.localStore.saveRepositorySession({
      repositoryId: binding.repositoryId,
      root: binding.root,
      headSha,
      worktreeDigest: binding.worktreeDigest,
      updatedAt: this.clock()
    });
    const validation = await this.modelStore.validateModel(workspace).catch(() => undefined);
    const session: RepositorySession = {
      workspace,
      snapshot,
      modelDigest: validation?.modelDigest,
      startedAt: this.clock()
    };
    this.sessions.set(binding.repositoryId, session);
    this.evictOldSessions();
    return session;
  }

  private async restoreRepositorySessions(): Promise<void> {
    for (const record of await this.localStore.listRepositorySessions()) {
      if (!record.root || !existsSync(record.root)) continue;
      if (repositoryFingerprint(record.root) !== record.repositoryId) continue;
      this.sessions.set(record.repositoryId, {
        workspace: {
          root: record.root,
          repositoryId: record.repositoryId,
          headSha: record.headSha
        },
        snapshot: {
          repositoryId: record.repositoryId,
          headSha: record.headSha,
          worktreeDigest: record.worktreeDigest
        },
        startedAt: record.updatedAt
      });
      this.evictOldSessions();
    }
  }

  private evictOldSessions(): void {
    while (this.sessions.size > this.maxRepoSessions) {
      const oldest = this.sessions.keys().next().value;
      if (!oldest) return;
      this.sessions.delete(oldest);
    }
  }

  private assertRunning(): void {
    if (!this.running) throw new Error("archctxd is not running");
  }

  private async withWriter<T>(fn: () => Promise<T>): Promise<T> {
    if (this.writerLocked) throw new Error("runtime writer is locked");
    this.writerLocked = true;
    try {
      return await fn();
    } finally {
      this.writerLocked = false;
    }
  }

  private async buildExplorerProjection(root: string, query?: string): Promise<ExplorerProjection> {
    const session = await this.openSession(root);
    await this.codeFacts.ensureReady(session.workspace);
    const model = await this.modelStore.validateModel(session.workspace).catch(() => undefined);
    const modelFiles = await this.modelStore.loadModel(session.workspace).catch(() => []) as ModelFileSummary[];
    const codeContext = await this.codeFacts.buildTaskContext({ task: "architecture explorer", maxSymbols: 80, includeSource: false });
    const modelNodes = modelFiles.map((file) => ({
      id: file.path,
      name: file.path.split("/").at(-1) ?? file.path,
      kind: schemaVersionKind(file.schemaVersion),
      verificationStatus: "MATCHED" as const,
      pressure: { level: "low" as const, score: 0, signals: [] },
      sourceSelectors: [{ path: file.path }]
    }));
    const codeNodes = codeContext.symbols.map((symbol) => ({
      id: symbol.id,
      name: symbol.name,
      kind: symbol.kind,
      verificationStatus: codeContext.evidence.some((evidence) => evidence.selector.symbolId === symbol.id && evidence.confidence === "verified")
        ? "VERIFIED" as const
        : "MATCHED" as const,
      pressure: { level: "low" as const, score: 0, signals: [] },
      sourceSelectors: [{ path: symbol.path, symbolId: symbol.id, startLine: symbol.range?.startLine, endLine: symbol.range?.endLine }]
    }));
    const projection: ExplorerProjection = {
      schemaVersion: "archcontext.explorer-projection/v1",
      generatedAt: this.clock(),
      repository: {
        ...session.snapshot,
        modelDigest: model?.modelDigest
      },
      nodes: dedupeExplorerNodes([...modelNodes, ...codeNodes]),
      relations: codeContext.edges.map((edge, index) => ({
        id: `relation.${index + 1}`,
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        verificationStatus: edge.confidence === "high" ? "MATCHED" : "UNKNOWN"
      })),
      landscape: this.landscape ? {
        ...this.landscape,
        crossRepoRelations: await this.localStore.listCrossRepoRelations(this.landscape)
      } as unknown as Json : undefined,
      verification: [
        ...modelFiles.map((file) => ({ path: file.path, schemaVersion: file.schemaVersion, digest: file.digest, confidence: "declared" })),
        ...codeContext.evidence.map((evidence) => evidence as unknown as Json)
      ] as unknown as Json[],
      pressure: codeContext.symbols.map((symbol) => ({ symbolId: symbol.id, level: "low", score: 0 })) as unknown as Json[],
      interventions: modelFiles
        .filter((file) => file.schemaVersion === "archcontext.intervention/v1")
        .map((file) => ({ path: file.path, digest: file.digest })) as unknown as Json[],
      capabilities: {
        readOnly: true,
        mutationMode: "forbidden",
        egress: "none",
        tokenRequired: true
      }
    };
    return filterExplorerProjection(projection, query);
  }

  private async handleExplorerRequest(request: IncomingMessage, response: ServerResponse, session: ExplorerServerSession): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${session.host}:${session.port}`);
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET") {
      writeJson(response, 405, { ok: false, error: "explorer is read-only" });
      return;
    }
    if (url.pathname === "/health") {
      writeJson(response, 200, { ok: true, running: true, readOnly: true, host: session.host });
      return;
    }
    if (!this.isExplorerAuthorized(request, url, session)) {
      writeJson(response, 401, { ok: false, error: "explorer token required" });
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const projection = await this.buildExplorerProjection(session.root, url.searchParams.get("q") ?? undefined);
      writeJson(response, 200, okEnvelope("explorer.projection", projection as unknown as Json));
      return;
    }
    if (url.pathname === "/projection" || url.pathname === "/search") {
      const projection = await this.buildExplorerProjection(session.root, url.searchParams.get("q") ?? undefined);
      writeJson(response, 200, okEnvelope("explorer.projection", projection as unknown as Json));
      return;
    }
    writeJson(response, 404, { ok: false, error: "not found" });
  }

  private isExplorerAuthorized(request: IncomingMessage, url: URL, session: ExplorerServerSession): boolean {
    if (session.revoked || Date.parse(this.clock()) >= session.expiresAt) return false;
    const authorization = request.headers.authorization ?? "";
    const bearer = Array.isArray(authorization) ? authorization[0] : authorization;
    return bearer === `Bearer ${session.token}` || url.searchParams.get("token") === session.token;
  }

  private explorerStatusData(): ExplorerServerStatus {
    if (!this.explorer) return { running: false, host: "127.0.0.1", revoked: true, readOnly: true };
    return {
      running: true,
      host: this.explorer.host,
      port: this.explorer.port,
      url: `http://${this.explorer.host}:${this.explorer.port}/`,
      tokenExpiresAt: new Date(this.explorer.expiresAt).toISOString(),
      revoked: this.explorer.revoked,
      readOnly: true
    };
  }

  private createLandscapeCodeGraphProviders() {
    if (!this.landscape) return {};
    return Object.fromEntries(
      this.landscape.repositories.map((repo) => [
        repo.repositoryId,
        this.codeGraphProviderFactory(repo)
      ])
    );
  }

  private async closeExplorer(): Promise<void> {
    const current = this.explorer;
    if (!current) return;
    this.explorer = undefined;
    await new Promise<void>((resolveClose, rejectClose) => {
      current.server.close((error) => error ? rejectClose(error) : resolveClose());
    });
  }
}

export class RuntimeRpcClient implements RuntimeDaemonClient {
  constructor(private readonly connection: RuntimeRpcConnection) {}

  async health(): Promise<Json> {
    const response = await fetch(`${this.connection.url}health`, {
      headers: { "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION }
    });
    return await response.json() as Json;
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

  prepare(root: string, task: string, maxBytes = 12_288, maxItems = 12) {
    return this.call("prepare", [root, task, maxBytes, maxItems]);
  }

  planUpdate(root: string, input: { id: string; operations: ChangeOperation[]; reason?: { taskSessionId: string; interventionId?: string } }) {
    return this.call("planUpdate", [root, input]);
  }

  completeTask(root: string, input: RuntimeCompleteTaskInput = {}) {
    return this.call("completeTask", [root, input]);
  }

  applyUpdate(root: string, input: { id: string; approved: boolean; expectedWorktreeDigest: string }) {
    return this.call("applyUpdate", [root, input]);
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

  explorerProjection(root: string, query?: string) {
    return this.call("explorerProjection", [root, query]);
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
    tempRoot?: string;
    stateDir?: string;
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

  async cleanupDeveloperReviewRun(run: DeveloperReviewRunManifest): Promise<DeveloperReviewRunCleanup> {
    return unwrapRpcData(await this.call("cleanupDeveloperReviewRun", [run])) as unknown as DeveloperReviewRunCleanup;
  }

  async recoverDeveloperReviewRuns(input: {
    repositoryRoot: string;
    stateDir?: string;
    force?: boolean;
  }): Promise<DeveloperReviewRunRecovery> {
    return unwrapRpcData(await this.call("recoverDeveloperReviewRuns", [input])) as unknown as DeveloperReviewRunRecovery;
  }

  private async call(method: string, params: unknown[]): Promise<JsonEnvelope> {
    const response = await fetch(`${this.connection.url}rpc`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.connection.token}`,
        "Content-Type": "application/json",
        "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION
      },
      body: JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method, params })
    });
    return await response.json() as JsonEnvelope;
  }
}

export class ArchctxRuntimeRpcServer {
  private server?: Server;
  private connection?: RuntimeRpcConnection;
  private lockFd?: number;

  constructor(private readonly daemon: ArchctxDaemon, private readonly options: RuntimeRpcServerOptions = {}) {}

  async start(): Promise<RuntimeRpcConnection> {
    if (this.server) return this.connection!;
    if (!this.daemon.status().running) await this.daemon.start();
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
    await new Promise<void>((resolveListen) => server.listen(this.options.port ?? 0, "127.0.0.1", resolveListen));
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
    return this.connection;
  }

  async stop(): Promise<void> {
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

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("Cache-Control", "no-store");
    if (!isLoopbackRemote(request.socket.remoteAddress)) {
      writeJson(response, 403, { schemaVersion: RUNTIME_RPC_VERSION, ok: false, error: "runtime RPC only accepts loopback clients" });
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
      writeJson(response, 200, {
        schemaVersion: RUNTIME_RPC_VERSION,
        ok: true,
        pid: process.pid,
        protocol: "http-loopback",
        version: 1,
        product: productVersionManifest(),
        composition: this.daemon.compositionReport()
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
    const body = await readRequestJson(request) as { schemaVersion?: string; method?: string; params?: unknown[] };
    if (body.schemaVersion !== RUNTIME_RPC_VERSION) {
      writeJson(response, 400, { schemaVersion: RUNTIME_RPC_VERSION, ok: false, error: "runtime RPC version mismatch" });
      return;
    }
    const result = await this.dispatch(body.method ?? "", body.params ?? []);
    writeJson(response, 200, result);
    if (body.method === "shutdown") setTimeout(() => void this.stop(), 0);
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const authorization = request.headers.authorization ?? "";
    const bearer = Array.isArray(authorization) ? authorization[0] : authorization;
    return bearer === `Bearer ${this.connection?.token}`;
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
        return this.daemon.prepare(params[0] as string, params[1] as string, params[2] as number | undefined, params[3] as number | undefined);
      case "planUpdate":
        return this.daemon.planUpdate(params[0] as string, params[1] as any);
      case "completeTask":
        return this.daemon.completeTask(params[0] as string, params[1] as RuntimeCompleteTaskInput | undefined);
      case "applyUpdate":
        return this.daemon.applyUpdate(params[0] as string, params[1] as any);
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
      case "explorerProjection":
        return this.daemon.explorerProjection(params[0] as string, params[1] as string | undefined);
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
      case "startDeveloperReviewRun":
        return okEnvelope("developerReview.startRun", this.daemon.startDeveloperReviewRun(params[0] as any) as unknown as Json);
      case "runSignedDeveloperReviewAttestation":
        return okEnvelope("developerReview.attestation", await this.daemon.runSignedDeveloperReviewAttestation(params[0] as any) as unknown as Json);
      case "cleanupDeveloperReviewRun":
        return okEnvelope("developerReview.cleanupRun", this.daemon.cleanupDeveloperReviewRun(params[0] as DeveloperReviewRunManifest) as unknown as Json);
      case "recoverDeveloperReviewRuns":
        return okEnvelope("developerReview.recoverRuns", this.daemon.recoverDeveloperReviewRuns(params[0] as any) as unknown as Json);
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

export function defaultDaemonControlDir(root = process.cwd()): string {
  return join(root, ".archcontext", ".local");
}

export function defaultDeveloperReviewRunStateDir(root = process.cwd()): string {
  return join(defaultDaemonControlDir(root), "developer-review-runs");
}

export function defaultDaemonConnectionPath(root = process.cwd()): string {
  return join(defaultDaemonControlDir(root), "archctxd.json");
}

export function defaultDaemonLockPath(root = process.cwd()): string {
  return join(defaultDaemonControlDir(root), "archctxd.lock");
}

export function readRuntimeRpcConnectionFile(root = process.cwd()): RuntimeRpcConnectionFile | undefined {
  const path = defaultDaemonConnectionPath(root);
  try {
    if (!isPrivateControlFile(path)) return undefined;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as RuntimeRpcConnectionFile;
    if (!parsed || typeof parsed !== "object") return undefined;
    return {
      ...parsed,
      connectionPath: typeof parsed.connectionPath === "string" ? parsed.connectionPath : path,
      lockPath: typeof parsed.lockPath === "string" ? parsed.lockPath : defaultDaemonLockPath(root)
    };
  } catch {
    return undefined;
  }
}

function unwrapRpcData(result: JsonEnvelope): Json {
  if (!result.ok) throw new Error(result.error?.message ?? "runtime-rpc-call-failed");
  return result.data as Json;
}

export function runtimeRpcCompatibilityIssue(root = process.cwd()): RuntimeRpcCompatibilityIssue | undefined {
  const connection = readRuntimeRpcConnectionFile(root);
  if (!connection) return undefined;
  const received = typeof connection.schemaVersion === "string" ? connection.schemaVersion : "unknown";
  if (received === RUNTIME_RPC_VERSION) return undefined;
  const pid = typeof connection.pid === "number" ? connection.pid : undefined;
  return {
    reason: "rpc-version-mismatch",
    expected: RUNTIME_RPC_VERSION,
    received,
    connectionPath: connection.connectionPath ?? defaultDaemonConnectionPath(root),
    lockPath: connection.lockPath ?? defaultDaemonLockPath(root),
    pid,
    pidAlive: pid !== undefined ? isProcessAlive(pid) : false,
    upgradeCommand: "archctx daemon upgrade"
  };
}

export function readRuntimeRpcConnection(root = process.cwd()): RuntimeRpcConnection | undefined {
  const path = defaultDaemonConnectionPath(root);
  try {
    if (!isPrivateControlFile(path)) return undefined;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as RuntimeRpcConnection;
    return isValidRuntimeRpcConnection(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function createRuntimeRpcClientFromConnectionFile(root = process.cwd()): RuntimeRpcClient | undefined {
  const connection = readRuntimeRpcConnection(root);
  return connection ? new RuntimeRpcClient(connection) : undefined;
}

export function recoverStaleDaemonControlFiles(
  root = process.cwd(),
  options: { removeUnhealthyConnection?: boolean } = {}
): DaemonControlRecovery {
  const connectionPath = defaultDaemonConnectionPath(root);
  const lockPath = defaultDaemonLockPath(root);
  const removed: DaemonControlRecoveryReason[] = [];
  const connectionReason = staleConnectionFileReason(connectionPath, options.removeUnhealthyConnection ?? false);
  if (connectionReason) {
    rmSync(connectionPath, { force: true });
    removed.push(connectionReason);
  }
  if (existsSync(lockPath) && isStaleLock(lockPath)) {
    rmSync(lockPath, { force: true });
    removed.push("stale-lock-file");
  }
  return { connectionPath, lockPath, removed };
}

function numericRepositoryId(repositoryId: string): number {
  let hash = 0;
  for (const char of repositoryId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return Math.max(1, hash);
}

function policyDigestForModelFiles(modelFiles: unknown[], policyProfileId: string): string {
  const policyFiles = modelFiles
    .map(modelFileDigestSummary)
    .filter((file): file is { path: string; digest: string } => Boolean(file?.path.startsWith(".archcontext/policies/")))
    .sort((a, b) => a.path.localeCompare(b.path));
  const payload: Record<string, Json> = {
    schemaVersion: "archcontext.policy-digest/v1",
    policyProfileId
  };
  if (policyFiles.length > 0) {
    payload.files = policyFiles;
  } else {
    payload.fallbackDigest = digestJson(modelFiles as unknown as Json);
  }
  return digestJson(payload);
}

function modelFileDigestSummary(value: unknown): { path: string; digest: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as { path?: unknown; digest?: unknown };
  if (typeof record.path !== "string" || typeof record.digest !== "string") return undefined;
  return { path: record.path, digest: record.digest };
}

function codeFactsDigest(snapshot: CodeFactsSnapshot): string {
  return digestJson({
    schemaVersion: "archcontext.code-facts-digest/v1",
    provider: snapshot.provider,
    version: snapshot.version,
    schemaDigest: snapshot.schemaDigest,
    workspaceDigest: snapshot.workspaceDigest
  } as unknown as Json);
}

function runtimeAttestationIdentity(snapshot: CodeFactsSnapshot, composition: RuntimeCompositionReport): AttestationV2["runtime"] {
  const product = productVersionManifest();
  return {
    version: product.product.version,
    buildDigest: digestJson({
      schemaVersion: "archcontext.runtime-build/v1",
      product: product.product,
      packageManager: product.packageManager,
      engines: product.engines,
      schemas: product.schemas,
      runtime: product.runtime
    } as unknown as Json),
    codeGraphVersion: snapshot.version,
    capabilitiesDigest: digestJson({
      schemaVersion: "archcontext.runtime-capabilities/v1",
      adapters: composition.adapters,
      codeFacts: {
        provider: snapshot.provider,
        version: snapshot.version
      },
      capabilities: [
        "detached-review-worktree",
        "tracked-worktree-digest",
        "model-digest",
        "policy-digest",
        "code-facts-digest",
        "deterministic-review-session"
      ]
    } as unknown as Json)
  };
}

function dedupeExplorerNodes(nodes: ExplorerProjection["nodes"]): ExplorerProjection["nodes"] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()].sort((a, b) => a.id.localeCompare(b.id));
}

function filterExplorerProjection(projection: ExplorerProjection, query = ""): ExplorerProjection {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return projection;
  const nodes = projection.nodes.filter((node) =>
    [node.id, node.name, node.kind, node.repositoryId ?? "", node.verificationStatus, ...node.pressure.signals]
      .join(" ")
      .toLowerCase()
      .includes(normalized)
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    ...projection,
    nodes,
    relations: projection.relations.filter((relation) => nodeIds.has(relation.source) || nodeIds.has(relation.target))
  };
}

function schemaVersionKind(schemaVersion: string): string {
  const match = schemaVersion.match(/^archcontext\.([a-z-]+)\/v\d+$/);
  return match?.[1] ?? "architecture-file";
}

function createDeveloperReviewRunPaths(input: {
  sourceRoot: string;
  challengeId: string;
  tempRoot?: string;
  stateDir?: string;
}): {
  runId: string;
  stateDir: string;
  runRoot: string;
  worktreeTempRoot: string;
  manifestPath: string;
  lockPath: string;
} {
  const safeChallengeId = safeControlFileSegment(input.challengeId);
  const runId = `${safeChallengeId}-${randomBytes(6).toString("hex")}`;
  const stateDir = input.stateDir ? resolve(input.stateDir) : defaultDeveloperReviewRunStateDir(input.sourceRoot);
  const tempParent = input.tempRoot ? resolve(input.tempRoot) : tmpdir();
  mkdirSync(tempParent, { recursive: true });
  const runRoot = mkdtempSync(join(tempParent, `archctx-developer-review-${safeChallengeId.slice(0, 32)}-`));
  return {
    runId,
    stateDir,
    runRoot,
    worktreeTempRoot: join(runRoot, "worktrees"),
    manifestPath: join(stateDir, `${safeChallengeId}.json`),
    lockPath: join(stateDir, `${safeChallengeId}.lock`)
  };
}

function safeControlFileSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
  return sanitized.length > 0 ? sanitized : "developer-review";
}

function writeDeveloperReviewRunManifest(manifest: DeveloperReviewRunManifest): void {
  writePrivateJson(manifest.manifestPath, manifest);
}

function writePrivateJson(path: string, value: unknown, flag: "w" | "wx" = "w"): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600, flag });
  chmodSync(path, 0o600);
}

function readDeveloperReviewRunManifest(path: string): DeveloperReviewRunManifest | undefined {
  const parsed = readJsonObject(path);
  if (!parsed || parsed.schemaVersion !== "archcontext.developer-review-run/v1") return undefined;
  if (typeof parsed.runId !== "string" || typeof parsed.challengeId !== "string") return undefined;
  if (typeof parsed.repositoryId !== "number" || typeof parsed.sourceRoot !== "string") return undefined;
  if (typeof parsed.runRoot !== "string" || typeof parsed.worktreeTempRoot !== "string") return undefined;
  if (typeof parsed.manifestPath !== "string" || typeof parsed.lockPath !== "string") return undefined;
  if (typeof parsed.pid !== "number" || typeof parsed.createdAt !== "string") return undefined;
  if (parsed.status !== "preparing" && parsed.status !== "running") return undefined;
  return parsed as unknown as DeveloperReviewRunManifest;
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function isDeveloperReviewPidAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false;
  return isProcessAlive(pid);
}

function cleanupErrorMessage(kind: string, error: unknown): string {
  return `${kind}: ${error instanceof Error ? error.message : String(error)}`;
}

export async function createStartedDaemon(deps: RuntimeDeps = {}): Promise<ArchctxDaemon> {
  const daemon = new ArchctxDaemon(deps);
  await daemon.start();
  return daemon;
}

export function createProductionDaemon(options: ProductionRuntimeOptions = {}): ArchctxDaemon {
  const deps: RuntimeDeps = {
    localStorePath: options.localStorePath ?? defaultLocalStorePath(options.root),
    maxRepoSessions: options.maxRepoSessions
  };
  assertProductionRuntimeDeps(deps);
  return new ArchctxDaemon(deps, { compositionMode: "production" });
}

export async function createStartedProductionDaemon(options: ProductionRuntimeOptions = {}): Promise<ArchctxDaemon> {
  const daemon = createProductionDaemon(options);
  await daemon.start();
  return daemon;
}

export function assertProductionRuntimeDeps(deps: RuntimeDeps): void {
  const blocked = blockedProductionInjections(deps);
  if (blocked.length > 0) {
    throw new Error(`Production archctxd cannot inject runtime test doubles: ${blocked.join(", ")}`);
  }
}

function runtimeCompositionReport(deps: RuntimeDeps, mode: RuntimeCompositionMode): RuntimeCompositionReport {
  const blocked = blockedProductionInjections(deps);
  return {
    mode,
    productionSafe: blocked.length === 0,
    adapters: {
      codeFacts: deps.codeFacts ? "injected" : "codegraph-cli",
      codeGraphProviderFactory: deps.codeGraphProviderFactory ? "injected" : "codegraph-cli",
      modelStore: deps.modelStore ? "injected" : "yaml",
      localStore: deps.localStore ? "injected" : "sqlite",
      changeSetEngine: deps.changeSetEngine ? "injected" : "default"
    },
    localStorePath: deps.localStorePath,
    blockedProductionInjections: blocked
  };
}

function blockedProductionInjections(deps: RuntimeDeps): string[] {
  return [
    "codeFacts",
    "codeGraphProviderFactory",
    "modelStore",
    "localStore",
    "changeSetEngine",
    "clock"
  ].filter((key) => key in deps);
}

function acquireDaemonLock(lockPath: string, root: string): number {
  try {
    const fd = openSync(lockPath, "wx", 0o600);
    writeFileSync(fd, JSON.stringify({ pid: process.pid, root, startedAt: new Date().toISOString() }, null, 2), "utf8");
    return fd;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    if (isStaleLock(lockPath)) {
      rmSync(lockPath, { force: true });
      return acquireDaemonLock(lockPath, root);
    }
    throw new Error(`archctxd already running for ${root}; lock=${lockPath}`);
  }
}

function isValidRuntimeRpcConnection(value: RuntimeRpcConnection): value is RuntimeRpcConnection {
  return value.schemaVersion === RUNTIME_RPC_VERSION
    && value.protocol === "http-loopback"
    && value.version === 1
    && typeof value.url === "string"
    && value.url.startsWith("http://127.0.0.1:")
    && typeof value.token === "string"
    && value.token.length > 0
    && typeof value.pid === "number"
    && typeof value.connectionPath === "string"
    && typeof value.lockPath === "string";
}

function staleConnectionFileReason(path: string, removeUnhealthyConnection: boolean): DaemonControlRecoveryReason | undefined {
  if (!existsSync(path)) return undefined;
  try {
    if (!isPrivateControlFile(path)) return "insecure-connection-file";
    const parsed = JSON.parse(readFileSync(path, "utf8")) as RuntimeRpcConnection;
    if (!isValidRuntimeRpcConnection(parsed)) return "invalid-connection-file";
    if (!isProcessAlive(parsed.pid)) return "dead-connection-pid";
    return removeUnhealthyConnection ? "unhealthy-connection-file" : undefined;
  } catch {
    return "invalid-connection-file";
  }
}

function isPrivateControlFile(path: string): boolean {
  if (process.platform === "win32") return true;
  const mode = statSync(path).mode & 0o777;
  return (mode & 0o077) === 0;
}

function isStaleLock(lockPath: string): boolean {
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number };
    if (typeof lock.pid !== "number" || lock.pid <= 0) return true;
    return !isProcessAlive(lock.pid);
  } catch {
    return true;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function isLoopbackRemote(remoteAddress = ""): boolean {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress);
}

function requestRpcVersionHeader(request: IncomingMessage): string | undefined {
  const header = request.headers["x-archcontext-rpc-version"];
  return Array.isArray(header) ? header[0] : header;
}

function isRpcVersionHeaderCompatible(request: IncomingMessage): boolean {
  const header = requestRpcVersionHeader(request);
  return header === undefined || header === RUNTIME_RPC_VERSION;
}

async function readRequestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}
