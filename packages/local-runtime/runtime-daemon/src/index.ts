import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
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
import {
  ARCHITECTURE_LEDGER_GIT_CURSOR_ID,
  architectureLedgerGitCursorFromPlan,
  architectureLedgerStateDigest,
  architectureLedgerProjectionDigest,
  compareArchitectureLedgerStateToYaml,
  planChangeSetApplyToArchitectureLedgerEvent,
  planExternalProjectionChangeToArchitectureLedgerEvent,
  planGitCursorRefreshToArchitectureLedgerEvent,
  planYamlToArchitectureLedgerImport,
  planYamlToArchitectureLedgerRebuild,
  projectArchitectureLedgerStateToYamlFiles,
  type ArchitectureLedgerAppendResult,
  type ArchitectureLedgerProjectionFile,
  type ArchitectureLedgerScope,
  type ArchitectureLedgerGraphState
} from "@archcontext/core/architecture-ledger";
import { checkpointTask, prepareTask } from "@archcontext/core/application";
import { loadPracticeCatalog, practiceCatalogEnvelope, type PracticeCatalogCommandInput } from "@archcontext/core/practice-catalog";
import { evaluatePracticeEnforcement, loadPracticeEnforcementPolicy, loadPracticeWaiverOwnerRegistry, loadPracticeWaivers, validatePracticeWaiver } from "@archcontext/core/practice-engine";
import { completeTaskGate, type CompleteTaskInput } from "@archcontext/core/review-engine";
import { CodeGraphAdapter, CodeGraphCliProvider, MultiRepoCodeGraphAdapter, type CodeGraphProvider } from "@archcontext/local-runtime/codegraph-adapter";
import { Context7ExternalDocumentationAdapter, assertContext7LibraryId, assertContext7Version, buildContext7Query } from "@archcontext/local-runtime/context7-adapter";
import { compileLandscapeTaskContext, compileTaskContext } from "@archcontext/core/context-compiler";
import { CONTEXT7_LOCKFILE_SCHEMA_VERSION, assertNoCallerProvidedAttestationFields, attestationV2Digest, canonicalAttestationV2, createAttestationV2, digestJson, errorEnvelope, LOCAL_RUNTIME_RPC_SCHEMA_VERSION, okEnvelope, productVersionManifest, type AttestationResult, type AttestationV2, type CodeFactsPort, type CodeFactsSnapshot, type Context7LibraryPinV1, type Context7LockfileV1, type DevicePrivateKeySignerPort, type ExternalDocumentationCacheEntry, type ExternalDocumentationFetchInput, type ExternalDocumentationPort, type ExternalDocumentationProvider, type ExternalDocumentationResourceV1, type ExplorerProjection, type ExplorerServiceContract, type Json, type JsonEnvelope, type ModelStorePort, type PracticeCheckpointEvent, type PracticeCheckpointSnapshotV1, type PracticeWaiverV1, type RepositorySnapshot, type ReviewChallengeV2, type WorkspaceRef } from "@archcontext/contracts";
import { findRepositoryRoot, prepareDetachedReviewWorktree, readHeadSha, readTrackedTreeEntries, removeDetachedReviewWorktree, removePathWithRetry, verifyDetachedReviewWorktree, type DetachedReviewWorktree, type DetachedReviewWorktreePreparation } from "@archcontext/local-runtime/git-adapter";
import { defaultLocalStorePath, migrateLegacyLocalStoreIfNeeded, runtimeStatePaths, SqliteLocalStore, type RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import { initializeArchContextModel, listModelFiles, rebuildGeneratedProjection, YamlModelStore, type ModelFile } from "@archcontext/local-runtime/model-store-yaml";

export interface RuntimeStatus {
  running: boolean;
  sessions: number;
  repositories: string[];
  architectureLedger: RuntimeArchitectureLedgerModes;
}

export interface RepositorySession {
  workspace: WorkspaceRef;
  snapshot: RepositorySnapshot;
  codeFactsDigest?: string;
  modelDigest?: string;
  startedAt: string;
}

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

export interface RuntimeResourceReadResult {
  schemaVersion: "archcontext.resource-read/v1";
  uri: string;
  dataClassification: "external-unverified-documentation";
  resource: ExternalDocumentationResourceV1;
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
  expiresAt: string;
  evidenceDigest: string;
  subjects?: string[];
  pathGlobs?: string[];
}

export interface RuntimeLedgerProjectInput {
  dryRun?: boolean;
  expectedWorktreeDigest?: string;
}

export interface RuntimeLedgerRebuildInput {
  fromGit?: boolean;
  expectedWorktreeDigest?: string;
  acceptExternalProjection?: boolean;
}

export interface RuntimeLedgerRollbackInput {
  toYaml?: boolean;
  dryRun?: boolean;
  expectedWorktreeDigest?: string;
}

export type RuntimeArchitectureLedgerRolloutMode = "yaml" | "dual" | "ledger-shadow" | "ledger-authoritative";
export type RuntimeArchitectureLedgerReadMode = "yaml" | "dual-compare" | "ledger-shadow" | "ledger";
export type RuntimeArchitectureLedgerWriteMode = "yaml" | "dual" | "ledger-with-projection";

export interface RuntimeArchitectureLedgerModes {
  schemaVersion: "archcontext.runtime-architecture-ledger-modes/v1";
  rolloutMode: RuntimeArchitectureLedgerRolloutMode;
  readMode: RuntimeArchitectureLedgerReadMode;
  writeMode: RuntimeArchitectureLedgerWriteMode;
  readAuthority: "yaml" | "ledger";
  writeAuthority: "yaml" | "dual" | "ledger-with-projection";
}

interface CheckpointCoalesceEntry {
  repositoryId: string;
  taskSessionId: string;
  data: Json;
  eventCount: number;
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
  task?: string;
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
  externalDocumentation?: ExternalDocumentationPort;
  devicePrivateKeySigner?: DevicePrivateKeySignerPort;
  architectureLedger?: Partial<Pick<RuntimeArchitectureLedgerModes, "rolloutMode" | "readMode" | "writeMode">>;
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
    externalDocumentation: "context7" | "injected";
  };
  architectureLedger: RuntimeArchitectureLedgerModes;
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
  prepare(root: string, task: string, maxBytes?: number, maxItems?: number, taskSessionId?: string): Promise<JsonEnvelope> | JsonEnvelope;
  checkpoint(root: string, input: RuntimeCheckpointInput): Promise<JsonEnvelope> | JsonEnvelope;
  docs(root: string, input: RuntimeDocsInput): Promise<JsonEnvelope> | JsonEnvelope;
  readResource(root: string, uri: string): Promise<JsonEnvelope> | JsonEnvelope;
  practices(root: string, input: PracticeCatalogCommandInput): Promise<JsonEnvelope> | JsonEnvelope;
  practiceWaivers(root: string): Promise<JsonEnvelope> | JsonEnvelope;
  planPracticeWaiver(root: string, input: RuntimePracticeWaiverInput): Promise<JsonEnvelope> | JsonEnvelope;
  planUpdate(root: string, input: { id: string; operations: ChangeOperation[]; reason?: { taskSessionId: string; interventionId?: string } }): Promise<JsonEnvelope> | JsonEnvelope;
  completeTask(root: string, input?: RuntimeCompleteTaskInput): Promise<JsonEnvelope> | JsonEnvelope;
  applyUpdate(root: string, input: { id: string; approved: boolean; expectedWorktreeDigest: string }): Promise<JsonEnvelope> | JsonEnvelope;
  ledgerState(root: string): Promise<JsonEnvelope> | JsonEnvelope;
  ledgerDrift(root: string): Promise<JsonEnvelope> | JsonEnvelope;
  ledgerProject(root: string, input?: RuntimeLedgerProjectInput): Promise<JsonEnvelope> | JsonEnvelope;
  ledgerRebuild(root: string, input?: RuntimeLedgerRebuildInput): Promise<JsonEnvelope> | JsonEnvelope;
  ledgerRollback(root: string, input?: RuntimeLedgerRollbackInput): Promise<JsonEnvelope> | JsonEnvelope;
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

interface ArchitectureLedgerReadModelValidation {
  valid: boolean;
  errors: string[];
  modelDigest: string;
  architectureLedger: RuntimeArchitectureLedgerModes & {
    graphDigest: string;
    entityCount: number;
    relationCount: number;
    constraintCount: number;
  };
}

interface ArchitectureLedgerReadModel {
  files: ModelFile[];
  state: ArchitectureLedgerGraphState;
  graphDigest: string;
}

class ArchitectureLedgerReadModelStore implements ModelStorePort {
  constructor(
    private readonly fallback: ModelStorePort,
    private readonly localStore: RuntimeLocalStore,
    private readonly architectureLedger: RuntimeArchitectureLedgerModes
  ) {}

  loadManifest(workspace: WorkspaceRef): Promise<unknown> {
    return this.fallback.loadManifest(workspace);
  }

  async loadModel(workspace: WorkspaceRef): Promise<unknown[]> {
    if (this.architectureLedger.readAuthority !== "ledger") return this.fallback.loadModel(workspace);
    return (await this.loadLedgerModel(workspace)).files;
  }

  async validateModel(workspace: WorkspaceRef): Promise<{ valid: boolean; errors: string[]; modelDigest: string }> {
    if (this.architectureLedger.readAuthority !== "ledger") return this.fallback.validateModel(workspace);
    const readback = await this.loadLedgerModel(workspace);
    const errors = validateModelFiles(readback.files);
    const result: ArchitectureLedgerReadModelValidation = {
      valid: errors.length === 0,
      errors,
      modelDigest: modelDigestForFiles(readback.files),
      architectureLedger: {
        ...this.architectureLedger,
        readAuthority: "ledger",
        graphDigest: readback.graphDigest,
        entityCount: readback.state.entities.length,
        relationCount: readback.state.relations.length,
        constraintCount: readback.state.constraints.length
      }
    };
    return result;
  }

  writeChangeSetPreview(changeSet: unknown): Promise<{ digest: string; summary: string }> {
    return this.fallback.writeChangeSetPreview(changeSet);
  }

  private async loadLedgerModel(workspace: WorkspaceRef): Promise<ArchitectureLedgerReadModel> {
    const state = await this.localStore.readArchitectureLedgerState(architectureLedgerScopeForWorkspace(workspace));
    const projectedFiles: ModelFile[] = projectArchitectureLedgerStateToYamlFiles(state).map((file) => ({
      path: file.path,
      body: file.body,
      schemaVersion: schemaVersionFromModelBody(file.body),
      digest: file.digest
    }));
    const fallbackFiles = (await this.fallback.loadModel(workspace))
      .filter(isModelFile)
      .filter((file) => !isArchitectureLedgerManagedModelPath(file.path));
    const files = [...fallbackFiles, ...projectedFiles].sort((left, right) => left.path.localeCompare(right.path));
    return {
      files,
      state,
      graphDigest: architectureLedgerStateDigest(state)
    };
  }
}

interface PersistedPracticeCheckpointBaseline {
  schemaVersion: "archcontext.practice-checkpoint-baseline/v1";
  repositoryId: string;
  taskSessionId: string;
  snapshot: PracticeCheckpointSnapshotV1;
  updatedAt: string;
}

const CONTEXT7_LOCKFILE = ".archcontext/integrations/context7.lock.yaml";

type PreparedTaskContext = Awaited<ReturnType<typeof prepareTask>>["context"];

interface PrepareUnknownsCandidate {
  packageName: string;
  libraryId: string;
  version: string;
  intent: string;
}

const CONTEXT7_PREPARE_FRAMEWORKS = [
  {
    packageName: "react",
    libraryId: "/facebook/react",
    scopePattern: /\b(react|jsx|hook|hooks|usestate|useeffect|component|suspense)\b/i,
    intentPattern: /\b(hook|hooks|usestate|useeffect|state|component|suspense|jsx)\b/i,
    intent: "state hooks"
  },
  {
    packageName: "next",
    libraryId: "/vercel/next.js",
    scopePattern: /\b(next(?:\.js)?|app router|route handler|middleware|server component)\b/i,
    intentPattern: /\b(app router|route handler|middleware|server component|routing|cache)\b/i,
    intent: "app router"
  },
  {
    packageName: "express",
    libraryId: "/expressjs/express",
    scopePattern: /\b(express|middleware|route handler)\b/i,
    intentPattern: /\b(middleware|route|handler|request|response)\b/i,
    intent: "middleware routing"
  }
] as const;

const EXTERNAL_DOCUMENTATION_RESOURCE_URI_PATTERN = /^archcontext:\/\/external-docs\/context7\/(sha256:[0-9a-f]{64})$/;

function parseExternalDocumentationResourceUri(uri: string): {
  provider: ExternalDocumentationProvider;
  contentDigest: string;
} | undefined {
  const match = EXTERNAL_DOCUMENTATION_RESOURCE_URI_PATTERN.exec(uri);
  if (!match) return undefined;
  return { provider: "context7", contentDigest: match[1] };
}

export class ArchctxDaemon {
  private readonly codeFacts: CodeFactsPort;
  private readonly codeGraphProviderFactory: (repository: RepositoryRegistration) => CodeGraphProvider;
  private readonly modelStore: ModelStorePort;
  private readonly readModelStore: ModelStorePort;
  private readonly localStore: RuntimeLocalStore;
  private readonly changeSetEngine: ChangeSetEngine;
  private readonly externalDocumentation: ExternalDocumentationPort;
  private readonly externalDocumentationInjected: boolean;
  private readonly devicePrivateKeySigner?: DevicePrivateKeySignerPort;
  private readonly architectureLedger: RuntimeArchitectureLedgerModes;
  private readonly clock: () => string;
  private readonly maxRepoSessions: number;
  private readonly composition: RuntimeCompositionReport;
  private readonly sessions = new Map<string, RepositorySession>();
  private readonly checkpointBaselines = new Map<string, PracticeCheckpointSnapshotV1>();
  private readonly checkpointCoalesced = new Map<string, CheckpointCoalesceEntry>();
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
    this.architectureLedger = runtimeArchitectureLedgerModes(deps.architectureLedger);
    this.readModelStore = new ArchitectureLedgerReadModelStore(this.modelStore, this.localStore, this.architectureLedger);
    this.changeSetEngine = deps.changeSetEngine ?? new ChangeSetEngine({
      modelStore: this.modelStore,
      projection: { rebuildGeneratedProjection },
      journal: this.localStore
    });
    this.devicePrivateKeySigner = deps.devicePrivateKeySigner;
    this.clock = deps.clock ?? (() => new Date(0).toISOString());
    this.externalDocumentation = deps.externalDocumentation ?? new Context7ExternalDocumentationAdapter({
      enabled: process.env.ARCHCONTEXT_CONTEXT7_ENABLED === "1",
      mode: process.env.ARCHCONTEXT_CONTEXT7_MODE === "prepare-unknowns" ? "prepare-unknowns" : "manual",
      clock: this.clock
    });
    this.externalDocumentationInjected = deps.externalDocumentation !== undefined;
    this.maxRepoSessions = deps.maxRepoSessions ?? 8;
    this.composition = runtimeCompositionReport(deps, options.compositionMode ?? "embedded", this.architectureLedger);
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
    this.checkpointBaselines.clear();
    this.checkpointCoalesced.clear();
    this.localStore.close();
    this.running = false;
  }

  status(): RuntimeStatus {
    return {
      running: this.running,
      sessions: this.sessions.size,
      repositories: [...this.sessions.keys()].sort(),
      architectureLedger: this.architectureLedger
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
    const result = await this.readModelStore.validateModel(session.workspace);
    session.modelDigest = result.modelDigest;
    return okEnvelope("validate", result as unknown as Json);
  }

  async context(root: string, task: string, maxSymbols = 12): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const context = await compileTaskContext({
      workspace: session.workspace,
      task,
      codeFacts: this.codeFacts,
      modelStore: this.readModelStore,
      budget: { maxBytes: 12_288, maxItems: maxSymbols }
    });
    return okEnvelope("context", context as unknown as Json);
  }

  async prepare(root: string, task: string, maxBytes = 12_288, maxItems = 12, taskSessionId = "task_runtime"): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const result = await prepareTask({
      workspace: session.workspace,
      task,
      codeFacts: this.codeFacts,
      modelStore: this.readModelStore,
      budget: { maxBytes, maxItems }
    });
    const context = await this.augmentPrepareContextWithExternalDocs(session, task, result.context, maxBytes);
    const augmentedResult = context === result.context ? result : { ...result, context };
    await this.savePracticeCheckpointBaseline(session.workspace.repositoryId, taskSessionId, {
      schemaVersion: "archcontext.practice-checkpoint-snapshot/v1",
      task,
      headSha: session.workspace.headSha,
      worktreeDigest: session.snapshot.worktreeDigest,
      contextDigest: augmentedResult.context.extensions.digest,
      practiceGuidanceDigest: augmentedResult.context.extensions.practiceGuidanceDigest,
      catalogDigest: augmentedResult.context.practiceGuidance.catalogDigest,
      matches: augmentedResult.context.practiceGuidance.matches
    });
    this.clearPracticeCheckpointCoalesced(session.workspace.repositoryId, taskSessionId);
    return okEnvelope("prepare", augmentedResult as unknown as Json);
  }

  async checkpoint(root: string, input: RuntimeCheckpointInput): Promise<JsonEnvelope> {
    this.assertRunning();
    const started = Date.now();
    const session = await this.openSession(root);
    const taskSessionId = input.taskSessionId ?? "task_runtime";
    const baseline = await this.readPracticeCheckpointBaseline(session.workspace.repositoryId, taskSessionId);
    const task = input.task ?? baseline?.task ?? "checkpoint";
    const coalesceKey = this.practiceCheckpointCoalesceKey(session, taskSessionId, task, input, baseline);
    const coalesced = this.checkpointCoalesced.get(coalesceKey);
    if (coalesced) {
      coalesced.eventCount += 1;
      const cached = coalesced.data as Record<string, any>;
      return okEnvelope("checkpoint", {
        ...cached,
        hook: {
          ...cached.hook,
          coalesced: true,
          skippedAnalysis: true,
          coalescedEventCount: coalesced.eventCount,
          elapsedMs: Date.now() - started
        }
      } as Json);
    }
    const result = await checkpointTask({
      workspace: session.workspace,
      taskSessionId,
      task,
      event: input.event ?? "manual",
      changedPaths: input.changedPaths ?? [],
      toolCallId: input.toolCallId,
      expectedHeadSha: input.expectedHeadSha,
      expectedWorktreeDigest: input.expectedWorktreeDigest,
      previous: baseline,
      codeFacts: this.codeFacts,
      modelStore: this.readModelStore,
      budget: { maxBytes: input.maxBytes ?? 12_288, maxItems: input.maxItems ?? 12 }
    });
    await this.savePracticeCheckpointBaseline(session.workspace.repositoryId, taskSessionId, result.nextSnapshot);
    const data = {
      ...result,
      hook: {
        ...result.hook,
        coalesced: false,
        skippedAnalysis: false,
        coalescedEventCount: 1,
        coalesceKey,
        elapsedMs: Date.now() - started
      }
    } as unknown as Json;
    this.checkpointCoalesced.set(coalesceKey, {
      repositoryId: session.workspace.repositoryId,
      taskSessionId,
      data,
      eventCount: 1
    });
    this.pruneCheckpointCoalesced();
    return okEnvelope("checkpoint", data);
  }

  practices(root: string, input: PracticeCatalogCommandInput): JsonEnvelope {
    this.assertRunning();
    return practiceCatalogEnvelope(root, input);
  }

  practiceWaivers(root: string): JsonEnvelope {
    this.assertRunning();
    try {
      const ownerRegistry = loadPracticeWaiverOwnerRegistry(root);
      const waivers = loadPracticeWaivers(root);
      return okEnvelope("practices.waivers", {
        schemaVersion: "archcontext.practice-waiver-list/v1",
        ownerRegistry,
        count: waivers.length,
        waivers: waivers.map((waiver) => ({
          ...waiver,
          waiverDigest: digestJson(waiver as unknown as Json)
        }))
      } as unknown as Json);
    } catch (error) {
      return errorEnvelope("practices.waivers", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
    }
  }

  async planPracticeWaiver(root: string, input: RuntimePracticeWaiverInput): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const model = await this.readModelStore.validateModel(session.workspace);
    let ownerRegistry: ReturnType<typeof loadPracticeWaiverOwnerRegistry>;
    try {
      ownerRegistry = loadPracticeWaiverOwnerRegistry(session.workspace.root);
    } catch (error) {
      return errorEnvelope("practices.waive", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
    }
    const waiver: PracticeWaiverV1 = {
      schemaVersion: "archcontext.practice-waiver/v1",
      practiceId: input.practiceId,
      ...(input.checkId === undefined ? {} : { checkId: input.checkId }),
      scope: {
        ...(input.pathGlobs && input.pathGlobs.length > 0 ? { pathGlobs: input.pathGlobs } : {}),
        ...(input.subjects && input.subjects.length > 0 ? { subjects: input.subjects } : {})
      },
      owner: input.owner,
      reason: input.reason,
      createdAt: input.createdAt ?? this.clock(),
      expiresAt: input.expiresAt,
      evidenceDigest: input.evidenceDigest
    };
    let waiverId: string;
    try {
      validatePracticeWaiver(waiver, "practice waiver input", { allowedOwners: ownerRegistry.owners });
      waiverId = safePracticeWaiverId(input.waiverId, waiver);
    } catch (error) {
      return errorEnvelope("practices.waive", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
    }
    const path = `.archcontext/waivers/${waiverId}.json`;
    const absolute = resolve(session.workspace.root, path);
    const body = `${JSON.stringify(waiver, null, 2)}\n`;
    const expectedHash = existsSync(absolute) ? digestJson({ body: readFileSync(absolute, "utf8") }) : "missing";
    const draft = this.changeSetEngine.plan({
      id: input.id ?? `changeset.practice-waiver-${waiverId.replace(/[^A-Za-z0-9_-]/g, "-")}`,
      base: {
        headSha: session.workspace.headSha,
        worktreeDigest: session.snapshot.worktreeDigest,
        modelDigest: model.modelDigest
      },
      reason: { taskSessionId: input.taskSessionId ?? "task_runtime" },
      operations: [{ op: "write_waiver", path, expectedHash, body }]
    });
    this.changesets.set(draft.id, draft);
    return okEnvelope("practices.waive", {
      schemaVersion: "archcontext.practice-waiver-plan/v1",
      waiver,
      waiverDigest: digestJson(waiver as unknown as Json),
      ownerRegistry,
      path,
      draft,
      preview: this.changeSetEngine.preview(session.workspace.root, draft)
    } as unknown as Json);
  }

  async docs(root: string, input: RuntimeDocsInput): Promise<JsonEnvelope> {
    this.assertRunning();
    const provider = input.provider ?? "context7";
    if (provider !== "context7") return errorEnvelope("docs", "AC_SCHEMA_INVALID", "docs provider must be context7");
    const session = await this.openSession(root);
    try {
      if (input.command === "status") {
        const lock = readContext7Lockfile(session.workspace.root);
        const cached = await this.localStore.listExternalDocumentation("context7");
        return okEnvelope("docs.status", {
          schemaVersion: "archcontext.external-docs-status/v1",
          provider: "context7",
          health: await this.externalDocumentation.health(),
          lock,
          cacheEntries: cached.map((entry) => ({
            provider: entry.provider,
            libraryId: entry.libraryId,
            version: entry.version,
            queryDigest: entry.queryDigest,
            contentDigest: entry.contentDigest,
            retrievedAt: entry.retrievedAt,
            expiresAt: entry.expiresAt,
            stale: Date.parse(entry.expiresAt) <= Date.parse(this.clock())
          })),
          defaultPrepareEgress: "none"
        } as unknown as Json);
      }
      if (input.command === "pin") {
        if (!input.libraryId || !input.version) return errorEnvelope("docs.pin", "AC_SCHEMA_INVALID", "docs pin requires --library-id and --version");
        assertContext7LibraryId(input.libraryId);
        assertContext7Version(input.version);
        const lock = upsertContext7Pin(readContext7Lockfile(session.workspace.root), {
          libraryId: input.libraryId,
          version: input.version,
          pinnedAt: this.clock(),
          source: "manual"
        });
        if (!input.approved) {
          return okEnvelope("docs.pin", {
            schemaVersion: "archcontext.context7-pin-preview/v1",
            approved: false,
            path: CONTEXT7_LOCKFILE,
            lock
          } as unknown as Json);
        }
        writeContext7Lockfile(session.workspace.root, lock);
        return okEnvelope("docs.pin", {
          schemaVersion: "archcontext.context7-pin/v1",
          approved: true,
          path: CONTEXT7_LOCKFILE,
          lock
        } as unknown as Json);
      }
      if (input.command === "resolve") {
        if (!input.allowNetwork) return errorEnvelope("docs.resolve", "AC_SCHEMA_INVALID", "docs resolve requires --allow-network");
        if (!input.libraryName || !input.query) return errorEnvelope("docs.resolve", "AC_SCHEMA_INVALID", "docs resolve requires --library and --query");
        return okEnvelope("docs.resolve", await this.manualExternalDocumentation().resolve({
          provider: "context7",
          libraryName: input.libraryName,
          query: input.query,
          fast: true
        }) as unknown as Json);
      }
      if (input.command === "fetch") {
        if (!input.allowNetwork) return errorEnvelope("docs.fetch", "AC_SCHEMA_INVALID", "docs fetch requires --allow-network");
        if (!input.libraryId || !input.intent) return errorEnvelope("docs.fetch", "AC_SCHEMA_INVALID", "docs fetch requires --library-id and --intent");
        assertContext7LibraryId(input.libraryId);
        const lock = readContext7Lockfile(session.workspace.root);
        const pinned = lock.libraries.find((library) => library.libraryId === input.libraryId);
        if (!pinned) return errorEnvelope("docs.fetch", "AC_SCHEMA_INVALID", "docs fetch requires a pinned library in .archcontext/integrations/context7.lock.yaml");
        const query = buildContext7Query({ intent: input.intent, query: input.query });
        const queryDigest = digestJson({ provider: "context7", libraryId: input.libraryId, version: pinned.version, query });
        const cached = await this.localStore.readExternalDocumentation({
          provider: "context7",
          libraryId: input.libraryId,
          version: pinned.version,
          queryDigest
        });
        if (cached && !input.forceRefresh && Date.parse(cached.expiresAt) > Date.parse(this.clock())) {
          return okEnvelope("docs.fetch", {
            schemaVersion: "archcontext.external-docs-fetch/v1",
            provider: "context7",
            cacheStatus: "fresh",
            resource: { ...cached.resource, cacheStatus: "fresh" },
            request: { libraryId: input.libraryId, version: pinned.version, queryDigest, intent: input.intent }
          } as unknown as Json);
        }
        const result = await this.manualExternalDocumentation().fetch({
          provider: "context7",
          libraryId: input.libraryId,
          version: pinned.version,
          intent: input.intent,
          ...(input.query ? { query: input.query } : {}),
          forceRefresh: input.forceRefresh
        } satisfies ExternalDocumentationFetchInput);
        const resource = { ...result.resource, queryDigest, cacheStatus: "fresh" as const };
        await this.localStore.saveExternalDocumentation({
          provider: "context7",
          libraryId: input.libraryId,
          version: pinned.version,
          queryDigest,
          contentDigest: resource.contentDigest,
          resource,
          retrievedAt: resource.retrievedAt,
          expiresAt: resource.expiresAt
        } satisfies ExternalDocumentationCacheEntry);
        return okEnvelope("docs.fetch", {
          ...result,
          cacheStatus: "miss",
          request: { ...result.request, queryDigest },
          resource
        } as unknown as Json);
      }
      if (input.command === "purge") {
        const purged = await this.localStore.purgeExternalDocumentation({
          provider: "context7",
          ...(input.libraryId ? { libraryId: input.libraryId } : {}),
          all: input.all
        });
        return okEnvelope("docs.purge", {
          schemaVersion: "archcontext.external-docs-purge/v1",
          purged
        } as unknown as Json);
      }
      return errorEnvelope("docs", "AC_SCHEMA_INVALID", "docs requires status|resolve|pin|fetch|purge");
    } catch (error) {
      return errorEnvelope(`docs.${input.command}`, "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
    }
  }

  async readResource(root: string, uri: string): Promise<JsonEnvelope> {
    this.assertRunning();
    await this.openSession(root);
    const parsed = parseExternalDocumentationResourceUri(uri);
    if (!parsed) {
      return errorEnvelope("resource.read", "AC_SCHEMA_INVALID", "unsupported resource URI");
    }
    const cached = await this.localStore.readExternalDocumentationByContentDigest(parsed);
    if (!cached) {
      return errorEnvelope("resource.read", "AC_SCHEMA_INVALID", "external documentation resource is not present in the local daemon cache");
    }
    const cacheStatus = Date.parse(cached.expiresAt) > Date.parse(this.clock()) ? "fresh" : "stale";
    const resource: ExternalDocumentationResourceV1 = {
      ...cached.resource,
      uri,
      cacheStatus
    };
    const result: RuntimeResourceReadResult = {
      schemaVersion: "archcontext.resource-read/v1",
      uri,
      dataClassification: "external-unverified-documentation",
      resource
    };
    return okEnvelope("resource.read", result as unknown as Json);
  }

  async planUpdate(root: string, input: {
    id: string;
    operations: ChangeOperation[];
    reason?: { taskSessionId: string; interventionId?: string };
  }): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const model = await this.readModelStore.validateModel(session.workspace);
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
    const model = await this.readModelStore.validateModel(session.workspace);
    const codeFacts = await this.codeFacts.sync({ workspace: session.workspace });
    const taskSessionId = input.taskSessionId ?? "task_runtime";
    const baseline = await this.readPracticeCheckpointBaseline(session.workspace.repositoryId, taskSessionId);
    const practicePolicy = loadPracticeEnforcementPolicy(session.workspace.root);
    const practiceEnforcement = practicePolicy.mode === "active"
      ? evaluatePracticeEnforcement({
        catalog: loadPracticeCatalog({ root: session.workspace.root }),
        policy: practicePolicy,
        waivers: loadPracticeWaivers(session.workspace.root),
        matches: (await compileTaskContext({
          workspace: session.workspace,
          task: input.task ?? baseline?.task ?? taskSessionId,
          codeFacts: this.codeFacts,
          modelStore: this.readModelStore,
          budget: { maxBytes: 12_288, maxItems: 12 }
        })).practiceGuidance.matches,
        previousMatches: baseline?.matches,
        compatibilityContract: input.compatibilityContract,
        compatibilityPathIntroduced: input.compatibilityPathIntroduced,
        ownerRegistry: loadPracticeWaiverOwnerRegistry(session.workspace.root),
        now: this.clock()
      })
      : undefined;
    const reviewInput: CompleteTaskInput = {
      taskSessionId,
      posture: input.posture ?? "normal",
      headSha: input.headSha ?? currentHeadSha!,
      currentHeadSha: currentHeadSha!,
      worktreeDigest: computeWorktreeDigest(session.workspace.root),
      modelDigest: model.modelDigest,
      codeFactsDigest: codeFactsDigest(codeFacts),
      ...(input.compatibilityContract === undefined ? {} : { compatibilityContract: input.compatibilityContract }),
      ...(input.compatibilityPathIntroduced === undefined ? {} : { compatibilityPathIntroduced: input.compatibilityPathIntroduced }),
      ...(input.cleanupRequired === undefined ? {} : { cleanupRequired: input.cleanupRequired }),
      ...(input.cleanupCompleted === undefined ? {} : { cleanupCompleted: input.cleanupCompleted }),
      ...(practiceEnforcement === undefined ? {} : { practiceEnforcement })
    };
    const review = completeTaskGate(reviewInput);
    await this.localStore.saveReviewResult(review.reviewId, review);
    return okEnvelope("complete_task", review as unknown as Json);
  }

  private manualExternalDocumentation(): ExternalDocumentationPort {
    if (this.externalDocumentationInjected) return this.externalDocumentation;
    return new Context7ExternalDocumentationAdapter({
      enabled: true,
      mode: "manual",
      clock: this.clock
    });
  }

  private async augmentPrepareContextWithExternalDocs(
    session: RepositorySession,
    task: string,
    context: PreparedTaskContext,
    maxBytes: number
  ): Promise<PreparedTaskContext> {
    let health;
    try {
      health = await this.externalDocumentation.health();
    } catch {
      return context;
    }
    if (health.provider !== "context7" || !health.enabled || health.mode !== "prepare-unknowns") return context;
    const lock = readContext7Lockfile(session.workspace.root);
    const candidate = resolvePrepareUnknownsCandidate(session.workspace.root, task, context, lock);
    if (!candidate) return context;
    const resource = await this.readOrFetchPrepareExternalDocumentation(candidate);
    if (!resource) return context;
    return appendExternalDocumentationToContext(context, resource, candidate, maxBytes);
  }

  private async readOrFetchPrepareExternalDocumentation(candidate: PrepareUnknownsCandidate): Promise<ExternalDocumentationResourceV1 | undefined> {
    const query = buildContext7Query({ intent: candidate.intent });
    const queryDigest = digestJson({
      provider: "context7",
      libraryId: candidate.libraryId,
      version: candidate.version,
      query
    });
    const cached = await this.localStore.readExternalDocumentation({
      provider: "context7",
      libraryId: candidate.libraryId,
      version: candidate.version,
      queryDigest
    });
    if (cached && Date.parse(cached.expiresAt) > Date.parse(this.clock())) {
      return { ...cached.resource, queryDigest, cacheStatus: "fresh" };
    }
    try {
      const result = await this.externalDocumentation.fetch({
        provider: "context7",
        libraryId: candidate.libraryId,
        version: candidate.version,
        intent: candidate.intent
      });
      const resource = { ...result.resource, queryDigest, cacheStatus: "fresh" as const };
      await this.localStore.saveExternalDocumentation({
        provider: "context7",
        libraryId: candidate.libraryId,
        version: candidate.version,
        queryDigest,
        contentDigest: resource.contentDigest,
        resource,
        retrievedAt: resource.retrievedAt,
        expiresAt: resource.expiresAt
      });
      return resource;
    } catch {
      return cached ? { ...cached.resource, queryDigest, cacheStatus: "stale" } : undefined;
    }
  }

  async applyUpdate(root: string, input: {
    id: string;
    approved: boolean;
    expectedWorktreeDigest: string;
  }): Promise<JsonEnvelope> {
    this.assertRunning();
    return this.withWriter(async () => {
      if (!input.expectedWorktreeDigest) throw new Error("apply_update requires expectedWorktreeDigest");
      const current = computeWorktreeDigest(root);
      if (current !== input.expectedWorktreeDigest) throw new Error("Worktree digest changed before apply");
      const session = await this.openSession(root);
      const draft = this.changesets.get(input.id);
      if (!draft) throw new Error(`Unknown ChangeSet: ${input.id}`);
      const approved = input.approved ? this.changeSetEngine.approve(draft) : draft;
      let ledgerAppend: Json | undefined;
      const writesLedger = architectureLedgerWriteAppendsEvents(this.architectureLedger.writeMode);
      const result = await this.changeSetEngine.apply(root, approved, {
        approved: input.approved,
        afterModelValidatedBeforeCommit: writesLedger
          ? async ({ journalId }) => {
            const appended = await this.appendAppliedChangeSetToArchitectureLedger(root, session, approved, journalId);
            ledgerAppend = {
              status: "appended",
              appendedEventCount: appended.appendedEvents.length,
              duplicateEventCount: appended.duplicateEvents.length,
              graphDigest: appended.graphDigest,
              entityCount: appended.entityCount,
              relationCount: appended.relationCount,
              constraintCount: appended.constraintCount
            };
          }
          : undefined
      });
      return okEnvelope("apply_update", {
        ...result,
        architectureLedger: {
          ...this.architectureLedger,
          append: writesLedger ? ledgerAppend ?? { status: "not-appended" } : { status: "not-applicable" }
        }
      } as unknown as Json);
    });
  }

  private async appendAppliedChangeSetToArchitectureLedger(root: string, session: RepositorySession, draft: ChangeSetDraft, journalId?: string) {
    const paths = runtimeStatePaths(root);
    const plan = planChangeSetApplyToArchitectureLedgerEvent({
      repository: {
        repositoryId: session.workspace.repositoryId,
        storageRepositoryId: paths.storageRepositoryId
      },
      worktree: {
        workspaceId: paths.workspaceId,
        storageWorkspaceId: paths.storageWorkspaceId,
        branch: readCurrentBranch(root),
        headSha: session.workspace.headSha,
        worktreeDigest: computeWorktreeDigest(root)
      },
      draft,
      files: listModelFiles(root),
      createdAt: this.clock(),
      writeMode: this.architectureLedger.writeMode === "ledger-with-projection" ? "ledger-with-projection" : "dual",
      command: "archctx apply"
    });
    if (journalId) await this.localStore.recordChangeSetLedgerPlan(journalId, { event: plan.event });
    const result = await this.localStore.appendArchitectureEvents({
      writer: "runtime-daemon",
      events: [plan.event]
    });
    if (journalId) await this.localStore.recordChangeSetLedgerAppend(journalId, { result });
    return result;
  }

  async ledgerState(root: string): Promise<JsonEnvelope> {
    this.assertRunning();
    return okEnvelope("ledger.state", await this.architectureLedgerReadback(root) as unknown as Json);
  }

  async ledgerDrift(root: string): Promise<JsonEnvelope> {
    this.assertRunning();
    const readback = await this.architectureLedgerReadback(root);
    return okEnvelope("ledger.drift", {
      schemaVersion: "archcontext.runtime-architecture-ledger-drift/v1",
      architectureLedger: readback.architectureLedger,
      repository: readback.repository,
      worktree: readback.worktree,
      ledger: readback.ledger,
      yaml: readback.yaml,
      drift: readback.drift
    } as unknown as Json);
  }

  async ledgerProject(root: string, input: RuntimeLedgerProjectInput = { dryRun: true }): Promise<JsonEnvelope> {
    this.assertRunning();
    const writes = input.dryRun === false;
    const project = async () => {
      if (writes) this.assertFreshWorktree(root, input.expectedWorktreeDigest, "ledger project --to-git");
      const scope = await this.architectureLedgerScope(root);
      const state = await this.localStore.readArchitectureLedgerState(scope);
      const projectedFiles = projectArchitectureLedgerStateToYamlFiles(state);
      if (writes) writeArchitectureProjectionFiles(root, projectedFiles);
      const drift = compareArchitectureLedgerStateToYaml({
        state,
        files: listModelFiles(root),
        createdAt: this.clock(),
        command: "archctx ledger project --to-git"
      });
      return okEnvelope("ledger.project", {
        schemaVersion: "archcontext.runtime-architecture-ledger-project/v1",
        architectureLedger: this.architectureLedger,
        repository: scope.repository,
        worktree: scope.worktree,
        dryRun: !writes,
        writes: writes ? "git-projection" : "none",
        projectedFileCount: projectedFiles.length,
        projectionDigest: architectureLedgerProjectionDigest(projectedFiles),
        graphDigest: architectureLedgerStateDigest(state),
        writtenPaths: writes ? projectedFiles.map((file) => file.path) : [],
        projectedFiles: writes ? undefined : projectedFiles,
        drift
      } as unknown as Json);
    };
    return writes ? this.withWriter(project) : project();
  }

  async ledgerRollback(root: string, input: RuntimeLedgerRollbackInput = { dryRun: true }): Promise<JsonEnvelope> {
    this.assertRunning();
    if (!input.toYaml) return errorEnvelope("ledger.rollback", "AC_SCHEMA_INVALID", "ledger rollback currently requires --to-yaml");
    const writes = input.dryRun === false;
    const rollback = async () => {
      if (writes) this.assertFreshWorktree(root, input.expectedWorktreeDigest, "ledger rollback --to-yaml");
      const scope = await this.architectureLedgerScope(root);
      const state = await this.localStore.readArchitectureLedgerState(scope);
      const projectedFiles = projectArchitectureLedgerStateToYamlFiles(state);
      const currentManagedFiles = listModelFiles(root).filter((file) => isArchitectureLedgerManagedModelPath(file.path));
      const backupPlan = architectureProjectionRollbackBackup(currentManagedFiles);
      const writeResult = writes
        ? replaceArchitectureProjectionFilesForYamlRollback(root, projectedFiles, currentManagedFiles, this.clock())
        : { backup: backupPlan.backup, writtenPaths: [], removedPaths: [] };
      const drift = compareArchitectureLedgerStateToYaml({
        state,
        files: listModelFiles(root),
        createdAt: this.clock(),
        command: "archctx ledger rollback --to-yaml"
      });
      return okEnvelope("ledger.rollback", {
        schemaVersion: "archcontext.runtime-architecture-ledger-rollback/v1",
        architectureLedger: this.architectureLedger,
        repository: scope.repository,
        worktree: scope.worktree,
        sourceAuthority: "ledger",
        targetAuthority: "yaml",
        dryRun: !writes,
        writes: writes ? "git-projection" : "none",
        backup: writeResult.backup,
        projectedFileCount: projectedFiles.length,
        projectionDigest: architectureLedgerProjectionDigest(projectedFiles),
        graphDigest: architectureLedgerStateDigest(state),
        writtenPaths: writeResult.writtenPaths,
        removedPaths: writeResult.removedPaths,
        projectedFiles: writes ? undefined : projectedFiles,
        drift,
        recommendedEnvironment: {
          ARCHCONTEXT_LEDGER_MODE: "yaml"
        }
      } as unknown as Json);
    };
    return writes ? this.withWriter(rollback) : rollback();
  }

  async ledgerRebuild(root: string, input: RuntimeLedgerRebuildInput = {}): Promise<JsonEnvelope> {
    this.assertRunning();
    if (!input.fromGit) return errorEnvelope("ledger.rebuild", "AC_SCHEMA_INVALID", "ledger rebuild currently requires --from-git");
    return this.withWriter(async () => {
      this.assertFreshWorktree(root, input.expectedWorktreeDigest, "ledger rebuild --from-git");
      const scope = await this.architectureLedgerScope(root);
      const files = listModelFiles(root);
      const previousState = await this.localStore.readArchitectureLedgerState(scope);
      const previousGraphDigest = architectureLedgerStateDigest(previousState);
      const rebuildCommand = input.acceptExternalProjection
        ? "archctx ledger rebuild --from-git --accept-external-projection"
        : "archctx ledger rebuild --from-git";
      const plan = planYamlToArchitectureLedgerRebuild({
        ...scope,
        files,
        createdAt: this.clock(),
        command: rebuildCommand,
        previousState
      });
      if (plan.unsupportedFiles.length > 0) {
        return errorEnvelope("ledger.rebuild", "AC_SCHEMA_INVALID", "ledger rebuild requires supported YAML model files");
      }
      const cursor = architectureLedgerGitCursorFromPlan({ ...scope, plan });
      const previousCursor = await this.localStore.readArchitectureLedgerSourceCursor({
        ...scope,
        cursorId: ARCHITECTURE_LEDGER_GIT_CURSOR_ID
      });
      const cursorChanged = previousCursor?.cursorDigest !== cursor.cursorDigest;
      const previousStateEmpty = isEmptyArchitectureLedgerState(previousState);
      let append: ArchitectureLedgerAppendResult = {
        appendedEvents: [],
        duplicateEvents: [],
        graphDigest: previousGraphDigest,
        entityCount: previousState.entities.length,
        relationCount: previousState.relations.length,
        constraintCount: previousState.constraints.length
      };
      let rebuildStatus: "unchanged" | "cursor-refreshed" | "rebuilt" | "external-projection-proposed" | "external-projection-accepted" = "unchanged";
      let proposedExternalProjectionChange: Json | undefined;
      if (previousGraphDigest === plan.graphDigest) {
        if (cursorChanged) {
          const cursorPlan = planGitCursorRefreshToArchitectureLedgerEvent({
            ...scope,
            cursor,
            graphDigest: plan.graphDigest,
            createdAt: this.clock(),
            command: rebuildCommand
          });
          append = await this.localStore.appendArchitectureEvents({
            writer: "runtime-daemon",
            events: [cursorPlan.event]
          });
          rebuildStatus = "cursor-refreshed";
        }
      } else if (!previousStateEmpty && !input.acceptExternalProjection) {
        const proposal = planExternalProjectionChangeToArchitectureLedgerEvent({
          ...scope,
          files,
          createdAt: this.clock(),
          command: rebuildCommand,
          previousState
        });
        append = await this.localStore.appendArchitectureEvents({
          writer: "runtime-daemon",
          events: [proposal.event]
        });
        rebuildStatus = "external-projection-proposed";
        proposedExternalProjectionChange = {
          eventId: proposal.event.eventId,
          baseGraphDigest: proposal.baseGraphDigest,
          proposedGraphDigest: proposal.proposedGraphDigest,
          sourceDigest: proposal.sourceDigest,
          projectionDigest: proposal.projectionDigest,
          reasonCodes: proposal.drift.reasonCodes,
          reconcileCommand: "archctx ledger rebuild --from-git --accept-external-projection --expected-worktree-digest <current>"
        } as unknown as Json;
      } else {
        append = await this.localStore.appendArchitectureEvents({
          writer: "runtime-daemon",
          events: [plan.event]
        });
        rebuildStatus = previousStateEmpty ? "rebuilt" : "external-projection-accepted";
      }
      const replay = await this.localStore.rebuildArchitectureLedgerCurrentState(scope);
      return okEnvelope("ledger.rebuild", {
        schemaVersion: "archcontext.runtime-architecture-ledger-rebuild/v1",
        architectureLedger: this.architectureLedger,
        repository: scope.repository,
        worktree: scope.worktree,
        sourceMode: "git-yaml",
        status: rebuildStatus,
        reconcileRequired: rebuildStatus === "external-projection-proposed",
        appendedEventCount: append.appendedEvents.length,
        duplicateEventCount: append.duplicateEvents.length,
        replayedEventCount: replay.events.length,
        graphDigest: replay.graphDigest,
        previousGraphDigest,
        proposedGraphDigest: plan.graphDigest,
        cursor: {
          changed: cursorChanged,
          cursorDigest: cursor.cursorDigest,
          previousCursorDigest: typeof previousCursor?.cursorDigest === "string" ? previousCursor.cursorDigest : undefined,
          sourceDigest: cursor.sourceDigest,
          projectionDigest: cursor.projectionDigest,
          branch: cursor.branch,
          headSha: cursor.headSha,
          worktreeDigest: cursor.worktreeDigest
        },
        proposedExternalProjectionChange,
        imported: plan.imported,
        ignoredFiles: plan.ignoredFiles,
        unsupportedFiles: plan.unsupportedFiles,
        drift: compareArchitectureLedgerStateToYaml({
          state: replay.state,
          files: listModelFiles(root),
          createdAt: this.clock(),
          command: "archctx ledger rebuild --from-git"
        })
      } as unknown as Json);
    });
  }

  private async architectureLedgerReadback(root: string) {
    const scope = await this.architectureLedgerScope(root);
    const files = listModelFiles(root);
    const yamlPlan = planYamlToArchitectureLedgerImport({
      ...scope,
      files,
      createdAt: this.clock(),
      command: "archctx ledger state"
    });
    const ledgerState = await this.localStore.readArchitectureLedgerState(scope);
    const ledgerGraphDigest = architectureLedgerStateDigest(ledgerState);
    const drift = compareArchitectureLedgerStateToYaml({
      state: ledgerState,
      files,
      createdAt: this.clock(),
      command: "archctx ledger drift --json"
    });
    const readAuthority = this.architectureLedger.readMode === "ledger" ? "ledger" : "yaml";
    const state = readAuthority === "ledger" ? ledgerState : yamlPlan.state;
    const graphDigest = readAuthority === "ledger" ? ledgerGraphDigest : yamlPlan.graphDigest;
    return {
      schemaVersion: "archcontext.runtime-architecture-ledger-state/v1",
      architectureLedger: { ...this.architectureLedger, readAuthority },
      repository: scope.repository,
      worktree: scope.worktree,
      readAuthority,
      state,
      graphDigest,
      entityCount: state.entities.length,
      relationCount: state.relations.length,
      constraintCount: state.constraints.length,
      ledger: {
        graphDigest: ledgerGraphDigest,
        entityCount: ledgerState.entities.length,
        relationCount: ledgerState.relations.length,
        constraintCount: ledgerState.constraints.length
      },
      yaml: {
        graphDigest: yamlPlan.graphDigest,
        sourceDigest: yamlPlan.sourceDigest,
        importedCount: yamlPlan.imported.length,
        ignoredFileCount: yamlPlan.ignoredFiles.length,
        unsupportedFileCount: yamlPlan.unsupportedFiles.length
      },
      drift
    };
  }

  private async architectureLedgerScope(root: string): Promise<ArchitectureLedgerScope> {
    const session = await this.openSession(root);
    const paths = runtimeStatePaths(root);
    return {
      repository: {
        repositoryId: session.workspace.repositoryId,
        storageRepositoryId: paths.storageRepositoryId
      },
      worktree: {
        workspaceId: paths.workspaceId,
        storageWorkspaceId: paths.storageWorkspaceId,
        branch: readCurrentBranch(root),
        headSha: session.workspace.headSha,
        worktreeDigest: computeWorktreeDigest(root)
      }
    };
  }

  private assertFreshWorktree(root: string, expectedWorktreeDigest: string | undefined, command: string): void {
    if (!expectedWorktreeDigest) throw new Error(`${command} requires expectedWorktreeDigest`);
    const current = computeWorktreeDigest(root);
    if (current !== expectedWorktreeDigest) throw new Error(`Worktree digest changed before ${command}`);
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
      removePathWithRetry(paths.runRoot);
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
        removePathWithRetry(paths.runRoot);
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
        removePathWithRetry(path);
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
      modelStore: this.readModelStore,
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
      worktreeDigest: computeWorktreeDigest(root)
    } as unknown as Json);
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
    const validation = await this.readModelStore.validateModel(workspace).catch(() => undefined);
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

  private async savePracticeCheckpointBaseline(repositoryId: string, taskSessionId: string, snapshot: PracticeCheckpointSnapshotV1): Promise<void> {
    this.checkpointBaselines.set(this.practiceCheckpointKey(repositoryId, taskSessionId), snapshot);
    await this.localStore.saveTaskState(this.practiceCheckpointStateKey(repositoryId, taskSessionId), {
      schemaVersion: "archcontext.practice-checkpoint-baseline/v1",
      repositoryId,
      taskSessionId,
      snapshot,
      updatedAt: this.clock()
    } satisfies PersistedPracticeCheckpointBaseline);
  }

  private async readPracticeCheckpointBaseline(repositoryId: string, taskSessionId: string): Promise<PracticeCheckpointSnapshotV1 | undefined> {
    const key = this.practiceCheckpointKey(repositoryId, taskSessionId);
    const memory = this.checkpointBaselines.get(key);
    if (memory) return memory;
    const state = await this.localStore.readTaskState(this.practiceCheckpointStateKey(repositoryId, taskSessionId));
    const persisted = parsePracticeCheckpointBaselineState(state, repositoryId, taskSessionId);
    if (!persisted) return undefined;
    this.checkpointBaselines.set(key, persisted.snapshot);
    return persisted.snapshot;
  }

  private practiceCheckpointKey(repositoryId: string, taskSessionId: string): string {
    return `${repositoryId}:${taskSessionId}`;
  }

  private practiceCheckpointStateKey(repositoryId: string, taskSessionId: string): string {
    return `practice-checkpoint:${repositoryId}:${taskSessionId}`;
  }

  private practiceCheckpointCoalesceKey(session: RepositorySession, taskSessionId: string, task: string, input: RuntimeCheckpointInput, baseline?: PracticeCheckpointSnapshotV1): string {
    return digestJson({
      repositoryId: session.workspace.repositoryId,
      headSha: session.workspace.headSha,
      worktreeDigest: session.snapshot.worktreeDigest,
      taskSessionId,
      task,
      previousContextDigest: baseline?.contextDigest,
      previousPracticeGuidanceDigest: baseline?.practiceGuidanceDigest,
      event: input.event ?? "manual",
      changedPaths: normalizeCheckpointPaths(input.changedPaths ?? []),
      toolCallId: input.toolCallId,
      expectedHeadSha: input.expectedHeadSha,
      expectedWorktreeDigest: input.expectedWorktreeDigest,
      maxBytes: input.maxBytes ?? 12_288,
      maxItems: input.maxItems ?? 12
    } as Json);
  }

  private clearPracticeCheckpointCoalesced(repositoryId: string, taskSessionId: string): void {
    for (const [key, entry] of this.checkpointCoalesced) {
      if (entry.repositoryId === repositoryId && entry.taskSessionId === taskSessionId) this.checkpointCoalesced.delete(key);
    }
  }

  private pruneCheckpointCoalesced(): void {
    while (this.checkpointCoalesced.size > 128) {
      const oldest = this.checkpointCoalesced.keys().next().value;
      if (oldest === undefined) return;
      this.checkpointCoalesced.delete(oldest);
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
    const model = await this.readModelStore.validateModel(session.workspace).catch(() => undefined);
    const modelFiles = await this.readModelStore.loadModel(session.workspace).catch(() => []) as ModelFileSummary[];
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

  prepare(root: string, task: string, maxBytes = 12_288, maxItems = 12, taskSessionId?: string) {
    return this.call("prepare", [root, task, maxBytes, maxItems, taskSessionId]);
  }

  checkpoint(root: string, input: RuntimeCheckpointInput) {
    return this.call("checkpoint", [root, input]);
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

  planUpdate(root: string, input: { id: string; operations: ChangeOperation[]; reason?: { taskSessionId: string; interventionId?: string } }) {
    return this.call("planUpdate", [root, input]);
  }

  completeTask(root: string, input: RuntimeCompleteTaskInput = {}) {
    return this.call("completeTask", [root, input]);
  }

  applyUpdate(root: string, input: { id: string; approved: boolean; expectedWorktreeDigest: string }) {
    return this.call("applyUpdate", [root, input]);
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

  ledgerRebuild(root: string, input: RuntimeLedgerRebuildInput = {}) {
    return this.call("ledgerRebuild", [root, input]);
  }

  ledgerRollback(root: string, input: RuntimeLedgerRollbackInput = { dryRun: true }) {
    return this.call("ledgerRollback", [root, input]);
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
        return this.daemon.prepare(params[0] as string, params[1] as string, params[2] as number | undefined, params[3] as number | undefined, params[4] as string | undefined);
      case "checkpoint":
        return this.daemon.checkpoint(params[0] as string, params[1] as RuntimeCheckpointInput);
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
        return this.daemon.planUpdate(params[0] as string, params[1] as any);
      case "completeTask":
        return this.daemon.completeTask(params[0] as string, params[1] as RuntimeCompleteTaskInput | undefined);
      case "applyUpdate":
        return this.daemon.applyUpdate(params[0] as string, params[1] as any);
      case "ledgerState":
        return this.daemon.ledgerState(params[0] as string);
      case "ledgerDrift":
        return this.daemon.ledgerDrift(params[0] as string);
      case "ledgerProject":
        return this.daemon.ledgerProject(params[0] as string, params[1] as RuntimeLedgerProjectInput | undefined);
      case "ledgerRebuild":
        return this.daemon.ledgerRebuild(params[0] as string, params[1] as RuntimeLedgerRebuildInput | undefined);
      case "ledgerRollback":
        return this.daemon.ledgerRollback(params[0] as string, params[1] as RuntimeLedgerRollbackInput | undefined);
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
  return runtimeStatePaths(root).workspaceStateDir;
}

export function defaultDeveloperReviewRunStateDir(root = process.cwd()): string {
  return runtimeStatePaths(root).developerReviewRunStateDir;
}

export function defaultDaemonConnectionPath(root = process.cwd()): string {
  return runtimeStatePaths(root).daemonConnectionPath;
}

export function defaultDaemonLockPath(root = process.cwd()): string {
  return runtimeStatePaths(root).daemonLockPath;
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

function architectureLedgerScopeForWorkspace(workspace: WorkspaceRef): ArchitectureLedgerScope {
  const paths = runtimeStatePaths(workspace.root);
  return {
    repository: {
      repositoryId: workspace.repositoryId,
      storageRepositoryId: paths.storageRepositoryId
    },
    worktree: {
      workspaceId: paths.workspaceId,
      storageWorkspaceId: paths.storageWorkspaceId,
      branch: readCurrentBranch(workspace.root),
      headSha: workspace.headSha,
      worktreeDigest: computeWorktreeDigest(workspace.root)
    }
  };
}

function isEmptyArchitectureLedgerState(state: ArchitectureLedgerGraphState): boolean {
  return state.entities.length === 0 && state.relations.length === 0 && state.constraints.length === 0;
}

function validateModelFiles(files: ModelFile[]): string[] {
  const errors: string[] = [];
  const paths = new Set(files.map((file) => file.path));
  for (const required of [".archcontext/manifest.yaml", ".archcontext/product.yaml"]) {
    if (!paths.has(required)) errors.push(`missing ${required}`);
  }
  for (const file of files) {
    if (!file.schemaVersion.startsWith("archcontext.")) errors.push(`${file.path}: missing schemaVersion`);
  }
  return errors;
}

function modelDigestForFiles(files: ModelFile[]): string {
  return digestJson(files.map((file) => ({ path: file.path, digest: file.digest })) as unknown as Json);
}

function isModelFile(value: unknown): value is ModelFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const file = value as Partial<ModelFile>;
  return typeof file.path === "string"
    && typeof file.body === "string"
    && typeof file.schemaVersion === "string"
    && typeof file.digest === "string";
}

function isArchitectureLedgerManagedModelPath(path: string): boolean {
  return path.startsWith(".archcontext/model/nodes/")
    || path.startsWith(".archcontext/model/relations/")
    || path.startsWith(".archcontext/model/constraints/");
}

function schemaVersionFromModelBody(body: string): string {
  const match = body.match(/schemaVersion:\s*"?([^"\n]+)"?/);
  if (match) return match[1].trim();
  try {
    const parsed = JSON.parse(body) as { schemaVersion?: unknown };
    if (typeof parsed.schemaVersion === "string") return parsed.schemaVersion;
  } catch {
    // Stable YAML projection files are handled by the regex path above.
  }
  return "";
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

function safePracticeWaiverId(explicit: string | undefined, waiver: PracticeWaiverV1): string {
  const explicitTrimmed = explicit?.trim();
  if (explicitTrimmed && (explicitTrimmed === "." || explicitTrimmed === ".." || explicitTrimmed.includes("/") || explicitTrimmed.includes("\\"))) {
    throw new Error("practice-waiver-id-invalid");
  }
  const evidencePrefix = waiver.evidenceDigest.startsWith("sha256:")
    ? waiver.evidenceDigest.slice("sha256:".length, "sha256:".length + 12)
    : waiver.evidenceDigest.slice(0, 12);
  const candidate = (explicitTrimmed || [waiver.practiceId.replace(/\./g, "-"), waiver.checkId ?? "all", evidencePrefix].join("-"))
    .replace(/[^A-Za-z0-9_.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  if (!candidate || candidate === "." || candidate === ".." || candidate.includes("/") || candidate.includes("\\")) {
    throw new Error("practice-waiver-id-invalid");
  }
  return candidate;
}

function resolvePrepareUnknownsCandidate(root: string, task: string, context: PreparedTaskContext, lock: Context7LockfileV1): PrepareUnknownsCandidate | undefined {
  if (!prepareContextHasVersionRelatedUnknown(context)) return undefined;
  for (const framework of CONTEXT7_PREPARE_FRAMEWORKS) {
    if (!framework.scopePattern.test(task) || !framework.intentPattern.test(task)) continue;
    const pinned = lock.libraries.find((library) => library.libraryId === framework.libraryId);
    if (!pinned) continue;
    const exactVersion = readExactPackageVersion(root, framework.packageName);
    if (!exactVersion || exactVersion !== pinned.version) continue;
    return {
      packageName: framework.packageName,
      libraryId: framework.libraryId,
      version: exactVersion,
      intent: framework.intent
    };
  }
  return undefined;
}

function appendExternalDocumentationToContext(
  context: PreparedTaskContext,
  resource: ExternalDocumentationResourceV1,
  candidate: PrepareUnknownsCandidate,
  maxBytes: number
): PreparedTaskContext {
  const externalResource = {
    type: "external-docs",
    provider: resource.provider,
    uri: resource.uri,
    digest: resource.contentDigest,
    libraryId: candidate.libraryId,
    packageName: candidate.packageName,
    version: candidate.version,
    queryDigest: resource.queryDigest,
    trust: resource.trust,
    enforcement: resource.enforcement,
    cacheStatus: resource.cacheStatus,
    retrievedAt: resource.retrievedAt,
    expiresAt: resource.expiresAt
  } as Record<string, Json>;
  const resources = context.resources.some((entry) => entry.uri === resource.uri)
    ? context.resources
    : [...context.resources, externalResource as any];
  const unknown = `External documentation is advisory and untrusted for ${candidate.packageName}@${candidate.version}: ${candidate.intent}`;
  const unknowns = context.unknowns.includes(unknown) ? context.unknowns : [...context.unknowns, unknown];
  const extensionWithoutDigest = { ...context.extensions };
  delete (extensionWithoutDigest as { digest?: string }).digest;
  const withoutDigest = {
    ...context,
    unknowns,
    resources,
    recommendedTargetState: {
      ...context.recommendedTargetState,
      externalDocumentation: {
        provider: resource.provider,
        libraryId: candidate.libraryId,
        packageName: candidate.packageName,
        version: candidate.version,
        intent: candidate.intent,
        resourceUri: resource.uri,
        contentDigest: resource.contentDigest,
        trust: resource.trust,
        enforcement: resource.enforcement
      }
    },
    extensions: {
      ...extensionWithoutDigest,
      externalDocumentationDigest: digestJson({
        provider: resource.provider,
        libraryId: candidate.libraryId,
        version: candidate.version,
        queryDigest: resource.queryDigest,
        contentDigest: resource.contentDigest,
        cacheStatus: resource.cacheStatus
      } as unknown as Json)
    }
  };
  const byteLength = Buffer.byteLength(JSON.stringify(withoutDigest), "utf8");
  const withMetadata = {
    ...withoutDigest,
    extensions: {
      ...withoutDigest.extensions,
      byteLength,
      budgetExceeded: byteLength > maxBytes
    }
  };
  return {
    ...withMetadata,
    extensions: {
      ...withMetadata.extensions,
      digest: digestJson(withMetadata as unknown as Json)
    }
  };
}

function prepareContextHasVersionRelatedUnknown(context: PreparedTaskContext): boolean {
  const unknowns = context.unknowns.join(" ").toLowerCase();
  if (/\b(version|dependency|dependencies|package|lockfile|runtime dependency|pinned)\b/.test(unknowns)) return true;
  return context.architecturePressure.signals.includes("unpinned-runtime-dependency");
}

function readExactPackageVersion(root: string, packageName: string): string | undefined {
  const lockVersion = readPackageLockExactVersion(root, packageName);
  if (lockVersion) return lockVersion;
  for (const manifestPath of packageManifestPaths(root)) {
    const manifest = readJsonFile(manifestPath);
    const version = exactVersionFromManifest(manifest, packageName);
    if (version) return version;
  }
  return undefined;
}

function readPackageLockExactVersion(root: string, packageName: string): string | undefined {
  const lock = readJsonFile(resolve(root, "package-lock.json"));
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) return undefined;
  const packages = (lock as { packages?: Record<string, unknown> }).packages;
  if (packages && typeof packages === "object") {
    const entry = packages[`node_modules/${packageName}`] as { version?: unknown } | undefined;
    if (typeof entry?.version === "string" && isExactPackageVersion(entry.version)) return entry.version;
  }
  const dependencies = (lock as { dependencies?: Record<string, unknown> }).dependencies;
  if (dependencies && typeof dependencies === "object") {
    const entry = dependencies[packageName] as { version?: unknown } | undefined;
    if (typeof entry?.version === "string" && isExactPackageVersion(entry.version)) return entry.version;
  }
  return undefined;
}

function packageManifestPaths(root: string): string[] {
  const paths = [resolve(root, "package.json")];
  const rootManifest = readJsonFile(paths[0]);
  for (const pattern of workspacePatternsFromManifest(rootManifest)) {
    for (const path of expandWorkspacePackageJson(root, pattern)) paths.push(path);
  }
  return [...new Set(paths)];
}

function workspacePatternsFromManifest(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return [];
  const workspaces = (manifest as { workspaces?: unknown }).workspaces;
  if (Array.isArray(workspaces)) return workspaces.filter((item): item is string => typeof item === "string");
  if (workspaces && typeof workspaces === "object" && Array.isArray((workspaces as { packages?: unknown }).packages)) {
    return (workspaces as { packages: unknown[] }).packages.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function expandWorkspacePackageJson(root: string, pattern: string): string[] {
  if (pattern.includes("**") || pattern.startsWith("/") || pattern.includes("\\")) return [];
  if (!pattern.includes("*")) {
    const path = resolve(root, pattern, "package.json");
    return existsSync(path) ? [path] : [];
  }
  if (!pattern.endsWith("/*")) return [];
  const base = resolve(root, pattern.slice(0, -2));
  if (!existsSync(base) || !statSync(base).isDirectory()) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(base, entry.name, "package.json"))
    .filter((path) => existsSync(path));
}

function exactVersionFromManifest(manifest: unknown, packageName: string): string | undefined {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return undefined;
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    const dependencies = (manifest as Record<string, unknown>)[field];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;
    const value = (dependencies as Record<string, unknown>)[packageName];
    if (typeof value === "string" && isExactPackageVersion(value)) return value;
  }
  return undefined;
}

function readJsonFile(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function isExactPackageVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

function readContext7Lockfile(root: string): Context7LockfileV1 {
  const path = resolve(root, CONTEXT7_LOCKFILE);
  if (!existsSync(path)) {
    return {
      schemaVersion: CONTEXT7_LOCKFILE_SCHEMA_VERSION,
      provider: "context7",
      libraries: []
    };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Context7LockfileV1;
  if (parsed.schemaVersion !== CONTEXT7_LOCKFILE_SCHEMA_VERSION || parsed.provider !== "context7" || !Array.isArray(parsed.libraries)) {
    throw new Error("Invalid Context7 lockfile");
  }
  for (const library of parsed.libraries) {
    assertContext7LibraryId(library.libraryId);
    assertContext7Version(library.version);
  }
  return {
    ...parsed,
    libraries: [...parsed.libraries].sort((a, b) => a.libraryId.localeCompare(b.libraryId))
  };
}

function upsertContext7Pin(lock: Context7LockfileV1, pin: Context7LibraryPinV1): Context7LockfileV1 {
  return {
    schemaVersion: CONTEXT7_LOCKFILE_SCHEMA_VERSION,
    provider: "context7",
    libraries: [...lock.libraries.filter((library) => library.libraryId !== pin.libraryId), pin]
      .sort((a, b) => a.libraryId.localeCompare(b.libraryId))
  };
}

function writeContext7Lockfile(root: string, lock: Context7LockfileV1): void {
  writePrivateJson(resolve(root, CONTEXT7_LOCKFILE), lock);
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
  if (!options.localStorePath) migrateLegacyLocalStoreIfNeeded(options.root);
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

function runtimeCompositionReport(
  deps: RuntimeDeps,
  mode: RuntimeCompositionMode,
  architectureLedger: RuntimeArchitectureLedgerModes
): RuntimeCompositionReport {
  const blocked = blockedProductionInjections(deps);
  return {
    mode,
    productionSafe: blocked.length === 0,
    adapters: {
      codeFacts: deps.codeFacts ? "injected" : "codegraph-cli",
      codeGraphProviderFactory: deps.codeGraphProviderFactory ? "injected" : "codegraph-cli",
      modelStore: deps.modelStore ? "injected" : "yaml",
      localStore: deps.localStore ? "injected" : "sqlite",
      changeSetEngine: deps.changeSetEngine ? "injected" : "default",
      externalDocumentation: deps.externalDocumentation ? "injected" : "context7"
    },
    architectureLedger,
    localStorePath: deps.localStorePath,
    blockedProductionInjections: blocked
  };
}

function runtimeArchitectureLedgerModes(input: RuntimeDeps["architectureLedger"] = {}): RuntimeArchitectureLedgerModes {
  const rolloutMode = readRuntimeArchitectureLedgerRolloutMode(input.rolloutMode ?? process.env.ARCHCONTEXT_LEDGER_MODE ?? "yaml");
  const defaults = architectureLedgerDefaultsForRolloutMode(rolloutMode);
  const readMode = readRuntimeArchitectureLedgerReadMode(input.readMode ?? process.env.ARCHCONTEXT_LEDGER_READ_MODE ?? defaults.readMode);
  const writeMode = readRuntimeArchitectureLedgerWriteMode(input.writeMode ?? process.env.ARCHCONTEXT_LEDGER_WRITE_MODE ?? defaults.writeMode);
  return {
    schemaVersion: "archcontext.runtime-architecture-ledger-modes/v1",
    rolloutMode,
    readMode,
    writeMode,
    readAuthority: architectureLedgerReadAuthority(readMode),
    writeAuthority: writeMode
  };
}

function architectureLedgerDefaultsForRolloutMode(
  mode: RuntimeArchitectureLedgerRolloutMode
): Pick<RuntimeArchitectureLedgerModes, "readMode" | "writeMode"> {
  switch (mode) {
    case "yaml":
      return { readMode: "yaml", writeMode: "yaml" };
    case "dual":
      return { readMode: "dual-compare", writeMode: "dual" };
    case "ledger-shadow":
      return { readMode: "ledger-shadow", writeMode: "dual" };
    case "ledger-authoritative":
      return { readMode: "ledger", writeMode: "ledger-with-projection" };
  }
}

function readRuntimeArchitectureLedgerRolloutMode(value: string): RuntimeArchitectureLedgerRolloutMode {
  if (value === "yaml" || value === "dual" || value === "ledger-shadow" || value === "ledger-authoritative") return value;
  if (value === "ledger") return "ledger-authoritative";
  throw new Error(`invalid ARCHCONTEXT_LEDGER_MODE: ${value}`);
}

function readRuntimeArchitectureLedgerReadMode(value: string): RuntimeArchitectureLedgerReadMode {
  if (value === "yaml" || value === "dual-compare" || value === "ledger-shadow" || value === "ledger") return value;
  throw new Error(`invalid architecture ledger read mode: ${value}`);
}

function readRuntimeArchitectureLedgerWriteMode(value: string): RuntimeArchitectureLedgerWriteMode {
  if (value === "yaml" || value === "dual" || value === "ledger-with-projection") return value;
  throw new Error(`invalid architecture ledger write mode: ${value}`);
}

function architectureLedgerReadAuthority(mode: RuntimeArchitectureLedgerReadMode): RuntimeArchitectureLedgerModes["readAuthority"] {
  return mode === "ledger" ? "ledger" : "yaml";
}

function architectureLedgerWriteAppendsEvents(mode: RuntimeArchitectureLedgerWriteMode): boolean {
  return mode === "dual" || mode === "ledger-with-projection";
}

function readCurrentBranch(root: string): string {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return branch === "HEAD" ? "detached" : branch;
  } catch {
    return "unknown";
  }
}

interface ArchitectureProjectionRollbackWriteResult {
  backup: Json;
  writtenPaths: string[];
  removedPaths: string[];
}

function writeArchitectureProjectionFiles(root: string, files: ArchitectureLedgerProjectionFile[]): void {
  for (const file of files) {
    const absolute = resolve(root, file.path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, file.body.endsWith("\n") ? file.body : `${file.body}\n`, "utf8");
  }
}

function replaceArchitectureProjectionFilesForYamlRollback(
  root: string,
  projectedFiles: ArchitectureLedgerProjectionFile[],
  currentFiles: ModelFile[],
  createdAt: string
): ArchitectureProjectionRollbackWriteResult {
  const targetPaths = new Set(projectedFiles.map((file) => file.path));
  const backupBase = `.archcontext/backups/ledger-rollback/${safePathSegment(createdAt)}`;
  const backupRelativePath = uniqueBackupPath(root, backupBase);
  const manifestPath = `${backupRelativePath}/manifest.json`;
  const { backup, manifest } = architectureProjectionRollbackBackup(currentFiles, {
    createdAt,
    path: backupRelativePath,
    manifestPath
  });
  for (const file of currentFiles) {
    const backupPath = join(backupRelativePath, archContextRelativePath(file.path));
    const absolute = resolve(root, backupPath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, file.body, "utf8");
  }
  const manifestAbsolute = resolve(root, manifestPath);
  mkdirSync(dirname(manifestAbsolute), { recursive: true });
  writeFileSync(manifestAbsolute, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const removedPaths: string[] = [];
  for (const file of currentFiles) {
    if (targetPaths.has(file.path)) continue;
    rmSync(resolve(root, file.path), { force: true });
    removedPaths.push(file.path);
  }
  writeArchitectureProjectionFiles(root, projectedFiles);
  return {
    backup,
    writtenPaths: projectedFiles.map((file) => file.path),
    removedPaths
  };
}

function architectureProjectionRollbackBackup(
  files: ModelFile[],
  options: { createdAt?: string; path?: string; manifestPath?: string } = {}
): { backup: Json; manifest: Json } {
  const manifest = {
    schemaVersion: "archcontext.architecture-ledger-yaml-rollback-backup/v1",
    createdAt: options.createdAt,
    fileCount: files.length,
    files: files.map((file) => ({
      path: file.path,
      schemaVersion: file.schemaVersion,
      digest: file.digest
    }))
  } as unknown as Json;
  const backup = {
    schemaVersion: "archcontext.architecture-ledger-yaml-rollback-backup/v1",
    required: true,
    path: options.path,
    manifestPath: options.manifestPath,
    fileCount: files.length,
    paths: files.map((file) => file.path),
    digest: digestJson(manifest)
  } as unknown as Json;
  return { backup, manifest };
}

function uniqueBackupPath(root: string, backupBase: string): string {
  let candidate = backupBase;
  let suffix = 2;
  while (existsSync(resolve(root, candidate))) {
    candidate = `${backupBase}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-");
}

function archContextRelativePath(path: string): string {
  return path.startsWith(".archcontext/") ? path.slice(".archcontext/".length) : path;
}

function blockedProductionInjections(deps: RuntimeDeps): string[] {
  return [
    "codeFacts",
    "codeGraphProviderFactory",
    "modelStore",
    "localStore",
    "changeSetEngine",
    "externalDocumentation",
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

function normalizeCheckpointPaths(paths: string[]): string[] {
  return [...new Set(paths
    .map((path) => path.trim().replaceAll("\\", "/"))
    .filter((path) => path.length > 0 && !path.startsWith("/") && !path.includes(".."))
  )].sort();
}

function parsePracticeCheckpointBaselineState(
  state: unknown,
  repositoryId: string,
  taskSessionId: string
): PersistedPracticeCheckpointBaseline | undefined {
  if (!state || typeof state !== "object") return undefined;
  const record = state as Partial<PersistedPracticeCheckpointBaseline>;
  if (record.schemaVersion !== "archcontext.practice-checkpoint-baseline/v1") return undefined;
  if (record.repositoryId !== repositoryId || record.taskSessionId !== taskSessionId) return undefined;
  const snapshot = record.snapshot as Partial<PracticeCheckpointSnapshotV1> | undefined;
  if (!snapshot || snapshot.schemaVersion !== "archcontext.practice-checkpoint-snapshot/v1") return undefined;
  if (
    typeof snapshot.task !== "string" ||
    typeof snapshot.headSha !== "string" ||
    typeof snapshot.worktreeDigest !== "string" ||
    typeof snapshot.contextDigest !== "string" ||
    typeof snapshot.practiceGuidanceDigest !== "string" ||
    typeof snapshot.catalogDigest !== "string" ||
    !Array.isArray(snapshot.matches)
  ) {
    return undefined;
  }
  return record as PersistedPracticeCheckpointBaseline;
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
