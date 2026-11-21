import {
  bindRepository,
  computeWorktreeDigest,
  readReviewPolicy,
  repositoryFingerprint,
  type Landscape,
  type RepositoryRegistration
} from "@archcontext/core/architecture-domain";
import { type ArchitectureLedgerScope } from "@archcontext/core/architecture-ledger";
import { ChangeSetEngine } from "@archcontext/core/changeset-engine";
import { compileTaskContext } from "@archcontext/core/context-compiler";
import { REPO_HARNESS_PROJECTION_PROFILE, ProjectionPreconditionError, agentContextProjectionTargetPaths, architectureDocumentationSourceDigest, loadAgentContextProjectionFiles, loadArchitectureDocumentationInputs, loadArchitectureDocumentationProfile, loadNativeModelFromArchContext, measureCapabilitySourceScaleSignals, projectionOwnedWriteBody, renderAgentContextProjection, renderArchitectureDocumentationProjection } from "@archcontext/core/projection-engine";
import { loadPracticeCatalog, type PracticeCatalogCommandInput } from "@archcontext/core/practice-catalog";
import { loadPracticeEnforcementPolicy, evaluatePracticeEnforcement, loadPracticeWaiverOwnerRegistry, loadPracticeWaivers, shouldEvaluatePracticeEnforcement } from "@archcontext/core/practice-engine";
import { completeTaskGate, type CompleteTaskInput, type CompleteTaskProjectionDriftInput, type CompleteTaskProjectionFreshnessInput } from "@archcontext/core/review-engine";
import { loadStateMachinesFromArchContext } from "@archcontext/core/state-machine-engine";
import {
  FailureError,
  digestJson,
  okEnvelope,
  type CodeFactsPort,
  type CodeFactsSnapshot,
  type ExplorerDeltaQueryV2,
  type ExplorerProjectionQueryV2,
  type ExplorerServiceContract,
  type ExternalDocumentationPort,
  type IndexSeedResultV1,
  type Json,
  type JsonEnvelope,
  type ModelStorePort,
  type PracticeCheckpointSnapshotV1,
  type RepositorySnapshot,
  type WorkspaceRef
} from "@archcontext/contracts";
import {
  CodeGraphAdapter,
  CodeGraphSdkProvider,
  ProjectionCodeFactsUnavailableError,
  assertProjectionCodeFactsAvailable,
  prepareArchitectureDocumentationProjectionSnapshot,
  runCodeGraphIndexSeed,
  type CodeGraphIndexSeedOptions,
  type CodeGraphProvider
} from "@archcontext/local-runtime/codegraph-adapter";
import { Context7ExternalDocumentationAdapter } from "@archcontext/local-runtime/context7-adapter";
import { CONTEXT7_ENABLED_ENV, CONTEXT7_MODE_ENV } from "@archcontext/local-runtime/context7-adapter";
import { findRepositoryRoot, listGitVisibleFiles, readHeadSha } from "@archcontext/local-runtime/git-adapter";
import { SqliteLocalStore, defaultLocalStorePath, runtimeStatePaths, type RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import { ArchContextInitRefusedError, YamlModelStore, initializeArchContextModel, planGeneratedProjection, rebuildGeneratedProjection, type ModelFile } from "@archcontext/local-runtime/model-store-yaml";
import { defaultJiebaSearchTokenizer } from "@archcontext/local-runtime/search-tokenizer";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ArchitectureDebtReadError, readCompleteTaskArchitectureDebt, selectedProducerFailureEnvelope } from "./architecture-debt";
import { ChangeSetAuthorityService, runtimeWorktreeDigest } from "./changeset-authority";
import { localEgressStatus } from "./egress";
import { ExplorerProjectionService } from "./explorer-projection-service";
import { ExplorerServerService, type ExplorerServerOptions } from "./explorer-server";
import { ExternalDocumentationService, type RuntimeDocsInput } from "./external-documentation";
import { LandscapeService } from "./landscape";
import { PracticeCheckpointService } from "./practice-checkpoint";
import { readCurrentBranch } from "./projection-inputs";
import {
  architectureHistoryRenderInput,
  committedArchitectureDocsProfile,
  ignoredArchitectureModelPaths,
  runAgentContextProjectionCommand,
  runArchitectureDocsProjectionCommand,
  runProjectionProtocolCommand,
  validateAgentContextProjectionInput,
  validateDocsProjectionInput,
  validateProjectionInvocation,
  type ProjectionServiceHost,
  type RuntimeDocsProjectionCommandOptions
} from "./projection-service";
import { publicFailureEnvelope, publicOperationFailure, publicOperationResult } from "./public-operation-failure";
import { RecommendationsService, type RuntimeRecommendationInput, type RuntimeRefactorRecordInput, type RuntimeRefactorScanInput } from "./recommendations";
import { type RegisteredRefactorAssessmentV1 } from "./refactor-recording";
import { evaluateReviewDependencyConstraints, refactorWorktreeDigests } from "./refactor-scan";
import type {
  LocalRuntimeClient,
  RuntimeAgentContextProjectionInput,
  RuntimeApplyUpdateInput,
  RuntimeCompleteTaskInput,
  RuntimeDocsProjectionInput,
  RuntimePlanUpdateInput,
  RuntimePracticeCheckpointInput,
  RuntimePracticeWaiverInput,
  RuntimeProjectionInvocation,
  RuntimeRefactorVerifyInput
} from "./runtime-types";
import { modelValidationEnvelope } from "./verify";

export type {
  ExplorerServerOptions,
  ExplorerServerStatus
} from "./explorer-server";
export type { RuntimeDocsInput, RuntimeResourceReadResult } from "./external-documentation";
export type { RuntimeRefactorVerifyInput } from "./refactor-verify";
export type { RuntimeRecommendationInput, RuntimeRefactorRecordInput, RuntimeRefactorScanInput } from "./recommendations";
export type {
  LocalRuntimeClient,
  RuntimeAgentContextProjectionInput,
  RuntimeApplyUpdateInput,
  RuntimeCompleteTaskInput,
  RuntimeDaemonClient,
  RuntimeDocsProjectionInput,
  RuntimePlanUpdateInput,
  RuntimePracticeCheckpointInput,
  RuntimePracticeWaiverInput,
  RuntimeProjectionInvocation,
  RuntimeWorktreeDigestProfile
} from "./runtime-types";
export { runProjectionCheckInvocation, runProjectionFreshnessCommand, runProjectionSliceCommand, runProjectionSnapshotCommand } from "./projection-service";
export { PROJECTION_PR_BODY_MARKER, PROJECTION_WRITER_DEFAULT_BASE, PROJECTION_WRITER_DEFAULT_REMOTE, createCommandProjectionPublisher, createGhProjectionPublisher, createNoneProjectionPublisher, projectionPublishBody, projectionPublishTitle, projectionWriterPaths, runProjectionPublishCommand, runProjectionPublishFollow, runProjectionPublishStatusCommand, runProjectionVerifyPrCommand, type ProjectionPublishOptions, type ProjectionPublisherExec, type ProjectionPublisherInput, type ProjectionPublisherPort, type ProjectionVerifyPrCheckPort, type ProjectionWriterApplyPort } from "./projection-writer";
export { runDocsAnchorsCommand } from "./docs-anchors";
export { runRuntimeVerifyCommand } from "./verify";
export { CapabilityDependenciesError, readCapabilityDependencies, type CapabilityDependenciesRequestV1, type CapabilityDependenciesResultV1 } from "./capability-dependencies";
export { runConstraintCheckCommand } from "./constraints-check";
export { runFlowSelectorCheckCommand } from "./flow-selector-check";
export { runStateMachineCheckCommand } from "./state-machine-check";
export { runCodeGraphIndexSeed } from "@archcontext/local-runtime/codegraph-adapter";

export interface RuntimeStatus {
  running: boolean;
  mode: "in-process";
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

export interface RuntimeDeps {
  codeFacts?: CodeFactsPort;
  codeGraphProviderFactory?: (repository: RepositoryRegistration) => CodeGraphProvider;
  modelStore?: ModelStorePort;
  localStore?: RuntimeLocalStore;
  changeSetEngine?: ChangeSetEngine;
  externalDocumentation?: ExternalDocumentationPort;
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
  localStorePath?: string;
  blockedProductionInjections: string[];
}

interface RuntimeConstructionOptions {
  compositionMode?: RuntimeCompositionMode;
}

/**
 * In-process daemonless runtime host for all archctx operations. Preserves the
 * `ArchctxDaemon` / `createStartedDaemon` / `createStartedProductionDaemon` symbols while executing
 * strictly in-process with a discardable SQLite cache and Git-visible YAML authority.
 */
export class ArchctxDaemon implements LocalRuntimeClient {
  private readonly codeFacts: CodeFactsPort;
  private readonly codeGraphProviderFactory: (repository: RepositoryRegistration) => CodeGraphProvider;
  private readonly modelStore: ModelStorePort;
  private readonly localStore: RuntimeLocalStore;
  private readonly changeSetEngine: ChangeSetEngine;
  private readonly externalDocumentationService: ExternalDocumentationService;
  private readonly practiceCheckpoints: PracticeCheckpointService;
  private readonly externalDocumentation: ExternalDocumentationPort;
  private readonly externalDocumentationInjected: boolean;
  private readonly clock: () => string;
  private readonly recommendationsService: RecommendationsService;
  private readonly landscapes: LandscapeService;
  private readonly explorerServer: ExplorerServerService;
  private readonly explorerProjections: ExplorerProjectionService;
  private readonly changeSetAuthority: ChangeSetAuthorityService;
  private readonly maxRepoSessions: number;
  private readonly composition: RuntimeCompositionReport;
  private readonly sessions = new Map<string, RepositorySession>();
  private running = false;
  private writerLocked = false;

  constructor(deps: RuntimeDeps = {}, options: RuntimeConstructionOptions = {}) {
    try {
      if (options.compositionMode === "production") assertProductionRuntimeDeps(deps);
      this.codeFacts = deps.codeFacts ?? new CodeGraphAdapter(new CodeGraphSdkProvider());
      this.codeGraphProviderFactory = deps.codeGraphProviderFactory ?? (() => new CodeGraphSdkProvider());
      this.modelStore = deps.modelStore ?? new YamlModelStore();
      this.localStore = deps.localStore ?? new SqliteLocalStore(deps.localStorePath ?? defaultLocalStorePath());
      this.changeSetEngine = deps.changeSetEngine ?? new ChangeSetEngine({
        modelStore: this.modelStore,
        projection: { planGeneratedProjection },
        agentContextScope: {
          derive: (root) => new Set(agentContextProjectionTargetPaths(loadNativeModelFromArchContext(root)).map((t) => t.path)),
          validateRootWrite: (root, file) => {
            if (committedArchitectureDocsProfile(root) === REPO_HARNESS_PROJECTION_PROFILE) {
              throw new Error(`Root contract has no agent-context region under ${REPO_HARNESS_PROJECTION_PROFILE}: ${file.path}`);
            }
            const model = loadNativeModelFromArchContext(root);
            const canonical = renderAgentContextProjection({ model, existingFiles: loadAgentContextProjectionFiles(root, model) });
            const canonicalBody = canonical.files.find((c) => c.path === file.path)?.body;
            if (canonicalBody === undefined || projectionOwnedWriteBody(canonicalBody, readFileSync(resolve(root, file.path), "utf8")) !== file.body) {
              throw new Error(`Root contract requires canonical marker-only content: ${file.path}`);
            }
          }
        }
      });
      this.clock = deps.clock ?? runtimeDefaultClock(options.compositionMode ?? "embedded");
      this.explorerServer = new ExplorerServerService({
        assertRunning: () => this.assertRunning(),
        clock: this.clock,
        explorerProjectionV2: (root, input) => this.explorerProjectionV2(root, input),
        explorerProjectionDelta: (root, input) => this.explorerProjectionDelta(root, input)
      });
      this.explorerProjections = new ExplorerProjectionService({
        assertRunning: () => this.assertRunning(),
        clock: this.clock,
        localStore: this.localStore,
        codeFacts: this.codeFacts,
        architectureLedgerProjectionGitScope: (root) => this.architectureLedgerProjectionGitScope(root),
        readPracticeCheckpointBaseline: (repoId, taskSessionId) => this.readPracticeCheckpointBaseline(repoId, taskSessionId),
        notifyExplorerInvalidation: (projection, affectedIds) => this.explorerServer.notifyExplorerInvalidation(projection, affectedIds)
      });
      this.landscapes = new LandscapeService({
        assertRunning: () => this.assertRunning(),
        localStore: this.localStore,
        sessions: this.sessions,
        openSession: (root) => this.openSession(root),
        codeGraphProviderFactory: this.codeGraphProviderFactory,
        readModelStore: this.modelStore
      });
      this.recommendationsService = new RecommendationsService({
        assertRunning: () => this.assertRunning(),
        withWriter: (run) => this.withWriter(run),
        clock: this.clock,
        architectureLedgerScope: (root) => this.architectureLedgerGitScope(root),
        architectureLedgerGitScope: (root) => this.architectureLedgerGitScope(root),
        refactorScanGitScope: (root, includeStructuralDigest) => this.architectureLedgerGitScopeWithFiles(root, includeStructuralDigest),
        assertFreshWorktree: (root, digest, command) => this.assertFreshWorktree(root, digest, command),
        shortDigest,
        applyRefactorDecision: (root, writes, afterValidated) => this.changeSetAuthority.applyRefactorDecisionWithinWriter(root, writes, afterValidated),
        localStore: this.localStore
      });
      this.changeSetAuthority = new ChangeSetAuthorityService({
        assertRunning: () => this.assertRunning(),
        clock: this.clock,
        openSession: (root) => this.openSession(root),
        withWriter: (run) => this.withWriter(run),
        assertWriterHeld: () => {
          if (!this.writerLocked) throw new Error("refactor decision apply requires the runtime writer lock");
        },
        projection: (root, input) => this.projection(root, input),
        readModelStore: this.modelStore,
        changeSetEngine: this.changeSetEngine,
        localStore: this.localStore
      });
      this.externalDocumentation = deps.externalDocumentation ?? new Context7ExternalDocumentationAdapter({
        enabled: process.env[CONTEXT7_ENABLED_ENV] === "1",
        mode: process.env[CONTEXT7_MODE_ENV] === "prepare-unknowns" ? "prepare-unknowns" : "manual",
        clock: this.clock
      });
      this.externalDocumentationInjected = deps.externalDocumentation !== undefined;
      this.maxRepoSessions = deps.maxRepoSessions ?? 8;
      this.externalDocumentationService = new ExternalDocumentationService({
        assertRunning: () => this.assertRunning(),
        openSession: (root) => this.openSession(root),
        withWriter: (fn) => this.withWriter(fn),
        clock: this.clock,
        externalDocumentation: this.externalDocumentation,
        externalDocumentationInjected: this.externalDocumentationInjected,
        localStore: this.localStore
      });
      this.practiceCheckpoints = new PracticeCheckpointService({
        assertRunning: () => this.assertRunning(),
        clock: this.clock,
        openSession: (root) => this.openSession(root),
        codeFacts: this.codeFacts,
        readModelStore: this.modelStore,
        localStore: this.localStore,
        externalDocumentationService: this.externalDocumentationService,
        runtimeArchitectureLedgerContextPort: () => undefined
      });
      this.composition = runtimeCompositionReport(deps, options.compositionMode ?? "embedded");
    } catch (error) { throw publicOperationFailure(error); }
  }

  async start(): Promise<void> {
    try {
      this.localStore.acquireWriterOwnership?.();
      try {
        await this.localStore.migrate();
        await this.landscapes.restore();
        await this.restoreRepositorySessions();
      } catch (error) {
        this.localStore.close();
        throw error;
      }
      this.running = true;
    } catch (error) { throw publicOperationFailure(error); }
  }

  async stop(): Promise<void> {
    try {
      try {
        await this.closeExplorer();
      } finally {
        this.sessions.clear();
        this.practiceCheckpoints.clear();
        this.explorerProjections.clearDeferredChangeFeedFailures();
        this.running = false;
        this.localStore.close();
      }
    } catch (error) { throw publicOperationFailure(error); }
  }

  status(): RuntimeStatus {
    try {
      return { running: this.running, mode: "in-process", sessions: this.sessions.size, repositories: [...this.sessions.keys()].sort() };
    } catch (error) { throw publicOperationFailure(error); }
  }

  compositionReport(): RuntimeCompositionReport {
    try { return this.composition; }
    catch (error) { throw publicOperationFailure(error); }
  }

  async egressReport(_root: string) {
    try {
      const documentation = await this.externalDocumentation.health();
      return {
        ...localEgressStatus({ ...process.env, [CONTEXT7_ENABLED_ENV]: documentation.enabled ? "1" : "0", [CONTEXT7_MODE_ENV]: documentation.mode }, {}),
        source: "in-process" as const
      };
    } catch (error) { throw publicOperationFailure(error); }
  }

  async hasActiveBackgroundWork(): Promise<boolean> { return false; }

  async init(root: string, productName?: string): Promise<JsonEnvelope> {
    try {
      this.assertRunning();
      return await this.withWriter(async () => {
        listGitVisibleFiles(root);
        try { initializeArchContextModel(root, productName); }
        catch (error) {
          if (error instanceof ArchContextInitRefusedError) return publicFailureEnvelope("init", "AC_PRECONDITION_FAILED", "init-would-overwrite-existing-model");
          throw error;
        }
        rebuildGeneratedProjection(root);
        const session = await this.openSession(root);
        return okEnvelope("init", {
          repositoryId: session.workspace.repositoryId,
          headSha: session.workspace.headSha,
          worktreeDigest: session.snapshot.worktreeDigest,
          modelDigest: session.modelDigest
        } as Json);
      });
    } catch (error) { throw publicOperationFailure(error); }
  }

  /**
   * Idempotent, atomic architecture documentation projection (#641): separated from CodeGraph
   * shared-base seeding (`archctx index seed`). Does not create or mutate `.codegraph/`.
   */
  async sync(root: string, _changedPaths: string[] = []): Promise<JsonEnvelope> {
    try { return publicOperationResult("sync", await this.syncUnchecked(root)) as JsonEnvelope; }
    catch (error) { throw publicOperationFailure(error); }
  }

  private async syncUnchecked(root: string): Promise<JsonEnvelope> {
    this.assertRunning();
    return await this.withWriter(async () => {
      const session = await this.openSession(root);
      const validation = await this.modelStore.validateModel(session.workspace);
      session.modelDigest = validation.modelDigest;
      if (!validation.valid) return modelValidationEnvelope(validation);
      rebuildGeneratedProjection(root);
      const profile = committedArchitectureDocsProfile(session.workspace.root);
      let projectionData: Json | undefined;
      if (profile === REPO_HARNESS_PROJECTION_PROFILE) {
        const applied = await this.docsProjection(session.workspace.root, {
          action: "apply",
          profile,
          approved: true,
          expectedWorktreeDigest: runtimeWorktreeDigest(session.workspace.root, "architecture-documentation-projection"),
          indexSynced: true
        } as RuntimeDocsProjectionCommandOptions);
        if (!applied.ok) return applied;
        projectionData = applied.data;
      }
      return okEnvelope("sync", {
        schemaVersion: "archcontext.sync/v2",
        profile,
        repositoryId: session.workspace.repositoryId,
        headSha: session.workspace.headSha,
        worktreeDigest: computeWorktreeDigest(session.workspace.root, listGitVisibleFiles(session.workspace.root)),
        modelDigest: validation.modelDigest,
        ...(projectionData ? { projection: projectionData } : { generatedPath: ".archcontext/generated/ARCHITECTURE.md" })
      } as unknown as Json);
    });
  }

  async indexSeed(root: string, options: CodeGraphIndexSeedOptions = {}): Promise<JsonEnvelope> {
    try {
      const result: IndexSeedResultV1 = await runCodeGraphIndexSeed(root, options);
      return okEnvelope("index.seed", result as unknown as Json);
    } catch (error) { throw publicOperationFailure(error); }
  }

  async validate(root: string): Promise<JsonEnvelope> {
    try { return publicOperationResult("validate", await this.validateUnchecked(root)) as JsonEnvelope; }
    catch (error) { throw publicOperationFailure(error); }
  }

  private async validateUnchecked(root: string): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const result = await this.modelStore.validateModel(session.workspace);
    session.modelDigest = result.modelDigest;
    return modelValidationEnvelope(result);
  }

  async context(root: string, task: string, maxSymbols = 12): Promise<JsonEnvelope> {
    try { return publicOperationResult("context", await this.contextUnchecked(root, task, maxSymbols)) as JsonEnvelope; }
    catch (error) { throw publicOperationFailure(error); }
  }

  private async contextUnchecked(root: string, task: string, maxSymbols = 12): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const context = await compileTaskContext({
      workspace: session.workspace,
      task,
      codeFacts: this.codeFacts,
      modelStore: this.modelStore,
      tokenizer: defaultJiebaSearchTokenizer(),
      budget: { maxBytes: 12_288, maxItems: maxSymbols }
    });
    return okEnvelope("context", context as unknown as Json);
  }

  async prepare(root: string, task: string, maxBytes = 12_288, maxItems = 12, taskSessionId = "task_runtime"): Promise<JsonEnvelope> {
    return this.practiceCheckpoints.prepare(root, task, maxBytes, maxItems, taskSessionId);
  }

  async practiceCheckpoint(root: string, input: RuntimePracticeCheckpointInput): Promise<JsonEnvelope> {
    return this.practiceCheckpoints.practiceCheckpoint(root, input);
  }

  practices(root: string, input: PracticeCatalogCommandInput): JsonEnvelope {
    return this.practiceCheckpoints.practices(root, input);
  }

  practiceWaivers(root: string): JsonEnvelope {
    try { return this.practiceCheckpoints.practiceWaivers(root); }
    catch (error) { throw publicOperationFailure(error); }
  }

  async planPracticeWaiver(root: string, input: RuntimePracticeWaiverInput): Promise<JsonEnvelope> {
    return this.changeSetAuthority.planPracticeWaiver(root, input);
  }

  async docs(root: string, input: RuntimeDocsInput): Promise<JsonEnvelope> {
    return this.externalDocumentationService.docs(root, input);
  }

  async readResource(root: string, uri: string): Promise<JsonEnvelope> {
    return this.externalDocumentationService.readResource(root, uri);
  }

  async planUpdate(root: string, rawInput: RuntimePlanUpdateInput): Promise<JsonEnvelope> {
    return this.changeSetAuthority.planUpdate(root, rawInput);
  }

  async completeTask(root: string, input: RuntimeCompleteTaskInput = {}): Promise<JsonEnvelope> {
    try { assertNoCallerProvidedAttestationFields(input, "complete-task"); }
    catch { return publicFailureEnvelope("complete_task", "AC_SCHEMA_INVALID", "complete-input-invalid"); }
    try { return await this.completeTaskUnchecked(root, input); }
    catch (error) { return selectedProducerFailureEnvelope("complete_task", error, "complete"); }
  }

  async reviewTask(root: string, input: Parameters<LocalRuntimeClient["reviewTask"]>[1] = {}): Promise<JsonEnvelope> {
    return this.completeTask(root, input);
  }

  private async completeTaskUnchecked(root: string, input: RuntimeCompleteTaskInput): Promise<JsonEnvelope> {
    this.assertRunning();
    assertNoCallerProvidedAttestationFields(input, "complete-task");
    if (this.codeFacts.prepareSync) {
      root = findRepositoryRoot(root);
      this.codeFacts.prepareSync(root);
    }
    const session = await this.openSession(root);
    let currentHeadSha = input.headSha;
    try { currentHeadSha = readHeadSha(session.workspace.root); }
    catch (error) { if (!currentHeadSha) throw error; }
    const model = await this.modelStore.validateModel(session.workspace);
    const codeFacts = await this.codeFacts.sync({ workspace: session.workspace });
    const taskSessionId = input.taskSessionId ?? "task_runtime";
    const baseline = await this.readPracticeCheckpointBaseline(session.workspace.repositoryId, taskSessionId);
    const practicePolicy = loadPracticeEnforcementPolicySafe(session.workspace.root);
    const practiceEnforcement = shouldEvaluatePracticeEnforcement(practicePolicy)
      ? evaluatePracticeEnforcement({
        catalog: loadPracticeCatalog({ root: session.workspace.root }),
        policy: practicePolicy,
        waivers: loadPracticeWaivers(session.workspace.root),
        matches: (await compileTaskContext({
          workspace: session.workspace,
          task: input.task ?? baseline?.task ?? taskSessionId,
          codeFacts: this.codeFacts,
          modelStore: this.modelStore,
          tokenizer: defaultJiebaSearchTokenizer(),
          budget: { maxBytes: 12_288, maxItems: 12 }
        })).practiceGuidance.matches,
        previousMatches: baseline?.matches,
        compatibilityContract: input.compatibilityContract,
        compatibilityPathIntroduced: input.compatibilityPathIntroduced,
        ownerRegistry: loadPracticeWaiverOwnerRegistry(session.workspace.root),
        now: this.clock()
      })
      : undefined;
    let projectionDrift: CompleteTaskProjectionDriftInput | undefined;
    let projectionFreshness: CompleteTaskProjectionFreshnessInput | undefined;
    let architectureDebt: CompleteTaskInput["architectureDebt"];
    try {
      ({ projectionDrift, projectionFreshness } = completeTaskProjectionDrift(session.workspace.root));
      if (model.valid || !existsSync(resolve(session.workspace.root, ".archcontext/manifest.yaml"))) {
        architectureDebt = readCompleteTaskArchitectureDebt(session.workspace.root, practiceEnforcement);
      }
    } catch (error) {
      if (error instanceof ArchitectureDebtReadError || error instanceof ProjectionCodeFactsUnavailableError || error instanceof ProjectionPreconditionError) {
        return selectedProducerFailureEnvelope("complete_task", error, "complete");
      }
      throw error;
    }
    const sourceFiles = listGitVisibleFiles(session.workspace.root);
    const worktreeDigest = computeWorktreeDigest(session.workspace.root, sourceFiles);
    const modelFiles = (await this.modelStore.loadModel(session.workspace)).filter(isModelFile);
    const dependencyConstraints = evaluateReviewDependencyConstraints({ root: session.workspace.root, worktreeDigest, sourceFiles, modelFiles });
    const review = completeTaskGate({
      taskSessionId,
      posture: input.posture ?? "normal",
      headSha: input.headSha ?? currentHeadSha!,
      currentHeadSha: currentHeadSha!,
      worktreeDigest,
      modelDigest: model.modelDigest,
      codeFactsDigest: codeFactsDigest(codeFacts),
      ...(model.valid ? {} : { modelValidationErrors: model.errors }),
      dependencyConstraints,
      reviewPolicy: readReviewPolicy(modelFiles).policy,
      ...(projectionDrift === undefined ? {} : { projectionDrift }),
      ...(projectionFreshness === undefined ? {} : { projectionFreshness }),
      ...(architectureDebt === undefined ? {} : { architectureDebt }),
      ...(input.compatibilityContract === undefined ? {} : { compatibilityContract: input.compatibilityContract }),
      ...(input.compatibilityPathIntroduced === undefined ? {} : { compatibilityPathIntroduced: input.compatibilityPathIntroduced }),
      ...(input.cleanupRequired === undefined ? {} : { cleanupRequired: input.cleanupRequired }),
      ...(input.cleanupCompleted === undefined ? {} : { cleanupCompleted: input.cleanupCompleted }),
      ...(practiceEnforcement === undefined ? {} : { practiceEnforcement })
    });
    await this.localStore.saveReviewResult(review.reviewId, review);
    return okEnvelope("complete_task", review as unknown as Json);
  }

  private projectionHost(): ProjectionServiceHost {
    return { planUpdate: (...args) => this.planUpdate(...args), applyUpdate: (...args) => this.applyUpdate(...args) };
  }

  async docsProjection(root: string, input: RuntimeDocsProjectionCommandOptions): Promise<JsonEnvelope> {
    try {
      this.assertRunning();
      const { indexSynced, ...validationInput } = input;
      try { validateDocsProjectionInput(validationInput); }
      catch { return publicFailureEnvelope("docs", "AC_SCHEMA_INVALID", "projection-input-invalid"); }
      return await runArchitectureDocsProjectionCommand({ ...validationInput, ...(indexSynced ? { indexSynced } : {}) }, root, this.projectionHost());
    } catch (error) { throw publicOperationFailure(error); }
  }

  async agentContextProjection(root: string, input: RuntimeAgentContextProjectionInput): Promise<JsonEnvelope> {
    try {
      this.assertRunning();
      try { validateAgentContextProjectionInput(input); }
      catch { return publicFailureEnvelope("agent-context", "AC_SCHEMA_INVALID", "projection-input-invalid"); }
      return await runAgentContextProjectionCommand(input, root, this.projectionHost());
    } catch (error) { throw publicOperationFailure(error); }
  }

  async projection(root: string, input: RuntimeProjectionInvocation): Promise<JsonEnvelope> {
    try {
      this.assertRunning();
      try { validateProjectionInvocation(input); }
      catch { return publicFailureEnvelope("projection", "AC_SCHEMA_INVALID", "projection-input-invalid"); }
      return await runProjectionProtocolCommand(input, root, this.projectionHost());
    } catch (error) { throw publicOperationFailure(error); }
  }

  async mcpProjection(root: string, input: RuntimeProjectionInvocation, approved: boolean): Promise<JsonEnvelope> {
    return this.changeSetAuthority.mcpProjection(root, input, approved);
  }

  async applyUpdate(root: string, rawInput: RuntimeApplyUpdateInput): Promise<JsonEnvelope> {
    return this.changeSetAuthority.applyUpdate(root, rawInput);
  }

  async recommendations(root: string, input: RuntimeRecommendationInput): Promise<JsonEnvelope> {
    return this.recommendationsService.recommendations(root, input);
  }

  async refactorScan(root: string, rawInput: RuntimeRefactorScanInput = {}): Promise<JsonEnvelope> {
    return this.recommendationsService.refactorScan(root, rawInput);
  }

  registerRefactorAssessment(input: RegisteredRefactorAssessmentV1): string {
    return this.recommendationsService.registerRefactorAssessment(input);
  }

  async refactorRecord(root: string, rawInput: RuntimeRefactorRecordInput): Promise<JsonEnvelope> {
    return this.recommendationsService.refactorRecord(root, rawInput);
  }

  async refactorVerify(root: string, rawInput: RuntimeRefactorVerifyInput): Promise<JsonEnvelope> {
    return this.recommendationsService.refactorVerify(root, rawInput);
  }

  private architectureLedgerProjectionGitScope(root: string): ArchitectureLedgerScope {
    const headSha = readHeadSha(root);
    const binding = bindRepository(root, headSha, listGitVisibleFiles(root));
    const paths = runtimeStatePaths(root);
    return {
      repository: { repositoryId: binding.repositoryId, storageRepositoryId: paths.storageRepositoryId },
      worktree: { workspaceId: paths.workspaceId, storageWorkspaceId: paths.storageWorkspaceId, branch: readCurrentBranch(root), headSha, worktreeDigest: binding.worktreeDigest }
    };
  }

  private async architectureLedgerGitScope(root: string): Promise<ArchitectureLedgerScope> {
    return (await this.architectureLedgerGitScopeWithFiles(root)).scope;
  }

  private async architectureLedgerGitScopeWithFiles(root: string, includeStructuralDigest = false): Promise<{
    scope: ArchitectureLedgerScope; sourceFiles: string[]; structuralWorktreeDigest?: string;
  }> {
    const session = await this.openSession(root);
    const paths = runtimeStatePaths(root);
    const sourceFiles = listGitVisibleFiles(root);
    const [worktreeDigest, structuralWorktreeDigest] = includeStructuralDigest
      ? refactorWorktreeDigests(root, sourceFiles)
      : [computeWorktreeDigest(root, sourceFiles)];
    const scope: ArchitectureLedgerScope = {
      repository: { repositoryId: session.workspace.repositoryId, storageRepositoryId: paths.storageRepositoryId },
      worktree: { workspaceId: paths.workspaceId, storageWorkspaceId: paths.storageWorkspaceId, branch: readCurrentBranch(root), headSha: session.workspace.headSha, worktreeDigest }
    };
    return { scope, sourceFiles, structuralWorktreeDigest };
  }

  private assertFreshWorktree(root: string, expectedWorktreeDigest: string | undefined, _command?: string): void {
    if (!expectedWorktreeDigest) throw new FailureError("AC_REFACTOR_STALE", "worktree-claim-required");
    const current = computeWorktreeDigest(root, listGitVisibleFiles(root));
    if (current !== expectedWorktreeDigest) throw new FailureError("AC_REFACTOR_STALE", "worktree-claim-changed", { expectedWorktreeDigest, actualWorktreeDigest: current });
  }

  async repoAdd(root: string, name?: string): Promise<JsonEnvelope> { return this.landscapes.repoAdd(root, name); }
  async repoList(): Promise<JsonEnvelope> { return this.landscapes.repoList(); }
  async repoRemove(repositoryId: string): Promise<JsonEnvelope> { return this.landscapes.repoRemove(repositoryId); }
  async loadLandscape(landscape: Landscape): Promise<JsonEnvelope> { return this.landscapes.loadLandscape(landscape); }
  async landscapeStatus(): Promise<JsonEnvelope> { return this.landscapes.landscapeStatus(); }
  async contextLandscape(task: string, maxSymbols = 12): Promise<JsonEnvelope> { return this.landscapes.contextLandscape(task, maxSymbols); }

  explorerServiceContract(tokenTtlSeconds = 900): JsonEnvelope {
    try {
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
    } catch (error) { throw publicOperationFailure(error); }
  }

  async explorerProjectionV2(root: string, query: ExplorerProjectionQueryV2): Promise<JsonEnvelope> { return this.explorerProjections.explorerProjectionV2(root, query); }
  async explorerProjectionDelta(root: string, query: ExplorerDeltaQueryV2): Promise<JsonEnvelope> { return this.explorerProjections.explorerProjectionDelta(root, query); }
  async startExplorer(root: string, options: ExplorerServerOptions = {}): Promise<JsonEnvelope> { return this.explorerServer.startExplorer(root, options); }
  async stopExplorer(): Promise<JsonEnvelope> { return this.explorerServer.stopExplorer(); }
  async revokeExplorerToken(): Promise<JsonEnvelope> { return this.explorerServer.revokeExplorerToken(); }
  explorerStatus(): JsonEnvelope { return this.explorerServer.explorerStatus(); }
  private async closeExplorer(): Promise<void> { return this.explorerServer.closeExplorer(); }

  async runtimeStatus(root?: string): Promise<JsonEnvelope> {
    try {
      const status = this.status();
      if (!root) return okEnvelope("status", status as unknown as Json);
      const repositoryId = repositoryFingerprint(root);
      const session = this.sessions.get(repositoryId);
      const ignoredModelPaths = ignoredArchitectureModelPaths(root);
      return okEnvelope("status", {
        ...status,
        repositoryId,
        headSha: session?.workspace.headSha ?? readHeadSha(root),
        worktreeDigest: computeWorktreeDigest(root, listGitVisibleFiles(root)),
        ...(ignoredModelPaths.length === 0 ? {} : { architectureModelIgnoredPaths: ignoredModelPaths })
      } as unknown as Json);
    } catch (error) { throw publicOperationFailure(error); }
  }

  async openSession(root: string): Promise<RepositorySession> {
    try {
      this.assertRunning();
      const headSha = readHeadSha(root);
      const binding = bindRepository(root, headSha, listGitVisibleFiles(root));
      const workspace: WorkspaceRef = { root: binding.root, repositoryId: binding.repositoryId, headSha };
      const snapshot: RepositorySnapshot = { repositoryId: binding.repositoryId, headSha, worktreeDigest: binding.worktreeDigest };
      await this.localStore.saveRepositorySession({
        repositoryId: binding.repositoryId,
        root: binding.root,
        headSha,
        worktreeDigest: binding.worktreeDigest,
        updatedAt: this.clock()
      });
      const validation = await this.modelStore.validateModel(workspace).catch(() => undefined);
      const session: RepositorySession = { workspace, snapshot, modelDigest: validation?.modelDigest, startedAt: this.clock() };
      this.sessions.set(binding.repositoryId, session);
      this.evictOldSessions();
      return session;
    } catch (error) { throw publicOperationFailure(error); }
  }

  private async restoreRepositorySessions(): Promise<void> {
    for (const record of await this.localStore.listRepositorySessions()) {
      if (!record.root || !existsSync(record.root)) continue;
      if (repositoryFingerprint(record.root) !== record.repositoryId) continue;
      this.sessions.set(record.repositoryId, {
        workspace: { root: record.root, repositoryId: record.repositoryId, headSha: record.headSha },
        snapshot: { repositoryId: record.repositoryId, headSha: record.headSha, worktreeDigest: record.worktreeDigest },
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

  private readPracticeCheckpointBaseline(repositoryId: string, taskSessionId: string): Promise<PracticeCheckpointSnapshotV1 | undefined> {
    return this.practiceCheckpoints.readPracticeCheckpointBaseline(repositoryId, taskSessionId);
  }

  private assertRunning(): void {
    if (!this.running) throw new FailureError("AC_PRECONDITION_FAILED", "runtime-not-running");
  }

  private async withWriter<T>(fn: () => Promise<T>): Promise<T> {
    if (this.writerLocked) throw new FailureError("AC_PRECONDITION_FAILED", "runtime-writer-locked");
    this.writerLocked = true;
    try { return await fn(); }
    finally { this.writerLocked = false; }
  }
}

function loadPracticeEnforcementPolicySafe(root: string) {
  return loadPracticeEnforcementPolicy(root);
}

function assertNoCallerProvidedAttestationFields(input: RuntimeCompleteTaskInput, label: string): void {
  const candidate = input as Record<string, unknown>;
  for (const key of ["headSha", "currentHeadSha", "worktreeDigest", "modelDigest", "codeFactsDigest", "reviewId", "result", "findings", "architectureDebt", "projectionDrift", "projectionFreshness", "practiceEnforcement", "dependencyConstraints"]) {
    if (key in candidate && candidate[key] !== undefined && !(key === "headSha" && label === "complete-task")) {
      throw new Error(`caller-provided attestation field ${key} is forbidden`);
    }
  }
}

function shortDigest(digest: string): string {
  return digest.replace(/^sha256:/, "").slice(0, 16);
}

function codeFactsDigest(snapshot: CodeFactsSnapshot): string {
  return digestJson({ schemaVersion: "archcontext.code-facts-digest/v1", provider: snapshot.provider, version: snapshot.version, schemaDigest: snapshot.schemaDigest, workspaceDigest: snapshot.workspaceDigest } as unknown as Json);
}

function isModelFile(value: unknown): value is ModelFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const file = value as Partial<ModelFile>;
  return typeof file.path === "string" && typeof file.body === "string" && typeof file.schemaVersion === "string" && typeof file.digest === "string";
}

export async function createStartedDaemon(deps: RuntimeDeps = {}): Promise<ArchctxDaemon> {
  try {
    const daemon = new ArchctxDaemon(deps);
    await daemon.start();
    return daemon;
  } catch (error) { throw publicOperationFailure(error); }
}

export function createProductionDaemon(options: ProductionRuntimeOptions = {}): ArchctxDaemon {
  try {
    const deps: RuntimeDeps = { localStorePath: options.localStorePath ?? defaultLocalStorePath(options.root), maxRepoSessions: options.maxRepoSessions };
    assertProductionRuntimeDeps(deps);
    return new ArchctxDaemon(deps, { compositionMode: "production" });
  } catch (error) { throw publicOperationFailure(error); }
}

export async function createStartedProductionDaemon(options: ProductionRuntimeOptions = {}): Promise<ArchctxDaemon> {
  try {
    const daemon = createProductionDaemon(options);
    await daemon.start();
    return daemon;
  } catch (error) { throw publicOperationFailure(error); }
}

export function assertProductionRuntimeDeps(deps: RuntimeDeps): void {
  const blocked = blockedProductionInjections(deps);
  if (blocked.length > 0) throw new FailureError("AC_SCHEMA_INVALID", "production-injections-refused", { issueCount: blocked.length });
}

export function runtimeDefaultClock(compositionMode: RuntimeCompositionMode): () => string {
  return compositionMode === "production" ? () => new Date().toISOString() : () => new Date(0).toISOString();
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
      changeSetEngine: deps.changeSetEngine ? "injected" : "default",
      externalDocumentation: deps.externalDocumentation ? "injected" : "context7"
    },
    localStorePath: deps.localStorePath,
    blockedProductionInjections: blocked
  };
}

function blockedProductionInjections(deps: RuntimeDeps): string[] {
  return ["codeFacts", "codeGraphProviderFactory", "modelStore", "localStore", "changeSetEngine", "externalDocumentation", "clock"].filter((key) => key in deps);
}

function completeTaskProjectionDrift(root: string): { projectionDrift?: CompleteTaskProjectionDriftInput; projectionFreshness?: CompleteTaskProjectionFreshnessInput } {
  if (!existsSync(resolve(root, "docs/architecture/.projection-manifest.json"))) return {};
  const profile = loadArchitectureDocumentationProfile(root);
  const loaded = loadArchitectureDocumentationInputs(root, profile);
  const sourceDigest = architectureDocumentationSourceDigest({ model: loaded.model, profile, decisions: loaded.decisions });
  const codeGraphInputs = prepareArchitectureDocumentationProjectionSnapshot(root, loaded.model, { indexSynced: true });
  assertProjectionCodeFactsAvailable(root, codeGraphInputs);
  const plan = renderArchitectureDocumentationProjection({
    model: loaded.model,
    stateMachines: loadStateMachinesFromArchContext(root, loaded.model.nodes),
    profile,
    decisions: loaded.decisions,
    existingFiles: loaded.existingFiles,
    docsLanguage: loaded.docsLanguage,
    sourceScaleSignals: measureCapabilitySourceScaleSignals(root, loaded.model, codeGraphInputs.footprints),
    importGraphs: codeGraphInputs.importGraphs,
    selectorEvidence: codeGraphInputs.selectorEvidence,
    provenance: codeGraphInputs.provenance,
    sourceDigest,
    ...architectureHistoryRenderInput(root, profile, loaded.existingFiles, false)
  });
  return {
    projectionDrift: {
      schemaVersion: "archcontext.complete-task-projection-drift/v1",
      ok: plan.drift.ok && plan.rejected.length === 0,
      sourceDigest: plan.sourceDigest,
      projectionDigest: plan.projectionDigest,
      rendererVersion: plan.rendererVersion,
      targetCount: plan.targets.length,
      fileCount: plan.files.length,
      driftCount: plan.drift.diffs.length,
      rejectedCount: plan.rejected.length,
      reasonCodes: [...new Set([...plan.drift.reasonCodes, ...plan.rejected.map((d) => d.reasonCode)])].sort()
    },
    projectionFreshness: plan.freshness
  };
}
