import type { RuntimeCheckpointInput, RuntimePracticeWaiverInput, RuntimeLedgerProjectInput, RuntimeAcceptCommittedChangeInput, RuntimeLedgerRebuildInput, RuntimeLedgerMigrateInput, RuntimeLedgerRollbackInput, RuntimeCompleteTaskInput, RuntimeWorktreeDigestProfile, RuntimePlanUpdateInput, RuntimeMcpApprovalInput, RuntimeMcpApplyInput, RuntimeApplyUpdateInput } from "./rpc-types";
export type { RuntimeCheckpointInput, RuntimePracticeWaiverInput, RuntimeLedgerProjectInput, RuntimeAcceptCommittedChangeInput, RuntimeLedgerRebuildInput, RuntimeLedgerMigrateInput, RuntimeLedgerRollbackInput, RuntimeCompleteTaskInput, RuntimeWorktreeDigestProfile, RuntimePlanUpdateInput, RuntimeMcpApprovalInput, RuntimeMcpApplyInput, RuntimeApplyUpdateInput } from "./rpc-types";
import { AgentJobService, runtimeAgentJobId, runtimeInvestigationRisk, runtimeInvestigationUncertainty, validateRuntimeAgentProposalPlan, type RuntimeAgentJobEnqueueGitInput, type RuntimeAgentJobClaimRpcInput, type RuntimeAgentJobCompleteRpcInput, type RuntimeAgentJobRetryRpcInput, type RuntimeAgentJobCancelRpcInput } from "./agent-jobs";
export type { RuntimeAgentJobEnqueueGitInput, RuntimeAgentJobClaimRpcInput, RuntimeAgentJobCompleteRpcInput, RuntimeAgentJobRetryRpcInput, RuntimeAgentJobCancelRpcInput } from "./agent-jobs";
import { ExternalDocumentationService, type RuntimeDocsInput } from "./external-documentation";
import { PracticeCheckpointService } from "./practice-checkpoint";
export type { RuntimeDocsInput, RuntimeResourceReadResult } from "./external-documentation";
import { DeveloperReviewSessionService, type DeveloperReviewDigestBundle, type DeveloperReviewSession, type DeveloperReviewAttestation } from "./developer-review-run";
export type { DeveloperReviewDigestBundle, DeveloperReviewSession, DeveloperReviewAttestation } from "./developer-review-run";
import { ExplorerServerService, type ExplorerServerOptions } from "./explorer-server";
export type { ExplorerServerOptions, ExplorerServerStatus } from "./explorer-server";
import { LedgerAdminService, type RuntimeArchitectureLedgerRolloutMode, type RuntimeArchitectureLedgerReadMode, type RuntimeArchitectureLedgerWriteMode, type RuntimeArchitectureLedgerModes, type RuntimeArchitectureLedgerPhaseFlags } from "./ledger-admin";
export type { RuntimeArchitectureLedgerRolloutMode, RuntimeArchitectureLedgerReadMode, RuntimeArchitectureLedgerWriteMode, RuntimeArchitectureLedgerModes, RuntimeArchitectureLedgerPhaseFlags } from "./ledger-admin";
import { ArchitectureBookService, type RuntimeBookInput } from "./architecture-book";
import { LandscapeService } from "./landscape";
export type { RuntimeBookInput } from "./architecture-book";
import { AuditService, AUDIT_APPROVE_GH_TOKEN_ENV, type RuntimeAuditRunInput, type RuntimeAuditApproveInput } from "./audit";
export { AUDIT_RUN_DEFAULT_TIMEOUT_MS, AUDIT_APPROVE_GH_TOKEN_ENV, type RuntimeAuditRunInput, type RuntimeAuditApproveInput } from "./audit";
import { ProjectionApplyService } from "./projection-apply";
import { buildArchitectureDocsProjection, runArchitectureDocsProjectionCommand, runAgentContextProjectionCommand, runProjectionProtocolCommand, validateProjectionInvocation, projectionInvocationWrites, assertProjectionInvocationSnapshot, validateDocsProjectionInput, validateAgentContextProjectionInput, type RuntimeDocsProjectionInput, type RuntimeAgentContextProjectionInput, type RuntimeProjectionInvocation, type ProjectionServiceHost } from "./projection-service";
import { projectionWorkspaceId, readCurrentBranch, readHeadCommittedAt } from "./projection-inputs";
export type { RuntimeDocsProjectionInput, RuntimeAgentContextProjectionInput, RuntimeProjectionInvocation } from "./projection-service";
import { DeveloperReviewRunService, type DeveloperReviewRunStatus, type DeveloperReviewRunManifest, type DeveloperReviewRun, type DeveloperReviewRunPreparation, type DeveloperReviewRunCleanup, type DeveloperReviewRunCleanupRequest, type DeveloperReviewRunRecovery } from "./developer-review-run";
export type { DeveloperReviewRunStatus, DeveloperReviewRunManifest, DeveloperReviewRun, DeveloperReviewRunPreparation, DeveloperReviewRunCleanup, DeveloperReviewRunCleanupRequest, DeveloperReviewRunRecovery } from "./developer-review-run";
import { RecommendationsService, recommendationArtifactsFromEvents, type RuntimeRecommendationInput, type RuntimeRefactorScanInput, type RuntimeRefactorRecordInput } from "./recommendations";
export type { RuntimeRecommendationInput, RuntimeRefactorScanInput, RuntimeRefactorRecordInput } from "./recommendations";
import type { RuntimeDaemonClient } from "./rpc-protocol";
import { ChangeSetRecoveryUnresolvedError } from "./changeset-recovery-error";
export { DEFAULT_DAEMON_IDLE_TIMEOUT_MS, RUNTIME_RPC_MAX_REQUEST_BODY_BYTES, RUNTIME_RPC_REQUEST_BODY_TIMEOUT_MS, type RuntimeRpcServerOptions, ArchctxRuntimeRpcServer } from "./rpc-server";
export { type DaemonControlRecoveryReason, type DaemonControlRecovery, defaultDaemonControlDir, defaultDeveloperReviewRunStateDir, defaultDaemonConnectionPath, defaultDaemonLockPath, readRuntimeRpcConnectionFile, runtimeRpcCompatibilityIssue, readRuntimeRpcConnection, createRuntimeRpcClientFromConnectionFile, recoverStaleDaemonControlFiles } from "./daemon-control";
export { ChangeSetRecoveryUnresolvedError } from "./changeset-recovery-error";
export * from "./rpc-client";
export * from "./rpc-protocol";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  bindRepository,
  canonicalRepositoryRoot,
  computeWorktreeDigest,
  readDependencyConstraints,
  readReviewPolicy,
  repositoryFingerprint,
  validateAdrAppliesTo,
  type Landscape,
  type RepositoryRegistration
} from "@archcontext/core/architecture-domain";
import { ChangeSetEngine, assertPathHasNoSymlinkSegments, type ChangeOperation, type ChangeSetDraft } from "@archcontext/core/changeset-engine";
import {
  architectureLedgerStateDigest,
  compareArchitectureLedgerStateToYaml,
  diffArchitectureLedgerBookStates,
  emptyArchitectureLedgerState,
  planChangeSetApplyToArchitectureLedgerEvent,
  planYamlToArchitectureLedgerImport,
  projectArchitectureLedgerStateToYamlFiles,
  queryArchitectureLedgerBookNeighbors,
  replayArchitectureLedgerEvidenceState,
  type ArchitectureAuditRunV1,
  type ArchitectureLedgerAppendInput,
  type ArchitectureLedgerAppendResult,
  type ArchitectureLedgerReplayResult,
  type ArchitectureLedgerScope,
  type ArchitectureLedgerGraphState
} from "@archcontext/core/architecture-ledger";
import { compileArchitectureFactChanges, compileEvidenceStateChanges } from "@archcontext/core/architecture-delta";
import { type RegisteredRefactorAssessmentV1 } from "./refactor-recording";
import { evaluateReviewDependencyConstraints } from "./refactor-scan";
import { type RuntimeRefactorVerifyInput } from "./refactor-verify";
import { type CommandInvestigationRunnerTransport } from "@archcontext/core/agent-orchestrator";
import { loadPracticeCatalog, type PracticeCatalogCommandInput } from "@archcontext/core/practice-catalog";
import { evaluatePracticeEnforcement, loadPracticeEnforcementPolicy, loadPracticeWaiverOwnerRegistry, loadPracticeWaivers, shouldEvaluatePracticeEnforcement, validatePracticeWaiver } from "@archcontext/core/practice-engine";
import { reconcileArchitectureLedgerDrift } from "@archcontext/core/reconcile-engine";
import { detectArchitecturePressure } from "@archcontext/core/pressure-engine";
import { renderAgentContextProjection, loadAgentContextProjectionFiles, agentContextProjectionTargetPaths, architectureDocumentationProjectionWorktreeDigest, architectureDocumentationSourceDigest, architectureDocumentationSourceTreeDigest, assertArchitectureProjectionVerifiedAgainst, capabilitySourceChangesSinceStamps, evaluateArchitectureProjectionSnapshotFreshness, loadArchitectureDocumentationInputs, loadArchitectureDocumentationProfile, loadArchitectureProjectionManifestVerifiedAgainst, loadCapabilitySourceScaleSignals, loadNativeModelFromArchContext, renderArchitectureDocumentationProjection, type ArchitectureProjectionManifestVerifiedAgainstReadback, type ArchitectureProjectionVerifiedAgainst, type CapabilitySourceChangeSet, type CapabilitySourceChangeSetForCommit, type CapabilitySourceChangeSinceStamp, type NativeModel } from "@archcontext/core/projection-engine";
import { completeTaskGate, type CompleteTaskInput, type CompleteTaskProjectionDriftInput, type CompleteTaskProjectionFreshnessInput } from "@archcontext/core/review-engine";
import { CodeGraphAdapter, CodeGraphCliProvider, prepareArchitectureDocumentationProjectionSnapshot, type CodeGraphProvider } from "@archcontext/local-runtime/codegraph-adapter";
import { CONTEXT7_ENABLED_ENV, CONTEXT7_MODE_ENV, Context7ExternalDocumentationAdapter } from "@archcontext/local-runtime/context7-adapter";
import { compileTaskContext, type ArchitectureContextLedgerPort } from "@archcontext/core/context-compiler";
import { assertNoCallerProvidedAttestationFields, baseModelBlockingErrors, digestJson, errorEnvelope, okEnvelope, type AcceptedArchitectureChangeReferenceV1, type AgentJobV1, type ArchitectureChangeFeedRecordV1, type ArchitectureEventBacklinkV1, type ArchitectureEventV1, type AuthorityCursorV1, type CodeFactsPort, type CodeFactsSnapshot, type DevicePrivateKeySignerPort, type ExplorerDeltaFailureReasonV2, type ExplorerDeltaQueryV2, type ExplorerProjectionDeltaV2, type ExplorerProjectionQueryV2, type ExplorerProjectionV2, type ExplorerServiceContract, type ExternalDocumentationPort, type Json, type JsonEnvelope, type ModelStorePort, type ModelValidationResult, type NormalizedCodeContext, type PracticeCheckpointSnapshotV1, type PracticeWaiverV1, type ProjectionApplyReceiptV1, type RepositorySnapshot, type ReviewChallengeV2, type WorkspaceRef } from "@archcontext/contracts";
import { type ProjectionRequestV1, type ProjectionApplyRecoveryIntentV1 } from "@archcontext/contracts";
import { readHeadSha, type DetachedReviewWorktree, type DetachedReviewWorktreePreparation } from "@archcontext/local-runtime/git-adapter";
import { defaultLocalStorePath, migrateLegacyLocalStoreIfNeeded, runtimeStatePaths, SqliteLocalStore, type CommittedChangeSetForTaskSession, type RuntimeLocalStore, type UnresolvedChangeSetJournal } from "@archcontext/local-runtime/local-store-sqlite";
import { ArchContextInitRefusedError, initializeArchContextModel, listModelFiles, planGeneratedProjection, rebuildGeneratedProjection, YamlModelStore, type ModelFile } from "@archcontext/local-runtime/model-store-yaml";
import { createNodeInvestigationTransport } from "./investigation-transport";
import { auditConsentRequiredEnvelope, readAuditConsent } from "./audit-consent";
import { localEgressStatus } from "./egress";
import {
  createNodeGithubIssueExecutor,
  type GithubIssueExecutorPort
} from "./github-issue-executor";
import {
  ExplorerProjectionCompileError,
  compileExplorerProjection,
  compileExplorerProjectionChanges,
  compileProjectionInputManifest,
  planProjectionRead,
  projectionReadSetFromGraph,
  selectProjectionGraphFromAuthority,
  type ExplorerResolvedBindingV2
} from "./explorer-projection";

export interface RuntimeStatus {
  running: boolean;
  sessions: number;
  repositories: string[];
  architectureLedger: RuntimeArchitectureLedgerModes;
  architectureChangeFeed: {
    deferredScopeCount: number;
    failureDigests: string[];
  };
  /** Present only when startup recovery left ChangeSet journals unresolved; writes are refused. */
  changeSetRecovery?: {
    writable: false;
    unresolvedJournals: UnresolvedChangeSetJournal[];
  };
}

export interface RepositorySession {
  workspace: WorkspaceRef;
  snapshot: RepositorySnapshot;
  codeFactsDigest?: string;
  modelDigest?: string;
  startedAt: string;
}

export type { RuntimeRefactorVerifyInput } from "./refactor-verify";
export {
  AUDIT_CONSENT_GRANT_COMMAND,
  AUDIT_CONSENT_REQUIRED_REASON_CODE,
  AUDIT_EGRESS_POLICY,
  auditConsentRequiredEnvelope,
  grantAuditConsent,
  readAuditConsent,
  revokeAuditConsent,
  type AuditConsentRecordV1,
  type AuditConsentStatus
} from "./audit-consent";

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
  investigationTransport?: CommandInvestigationRunnerTransport;
  githubIssueExecutor?: GithubIssueExecutorPort;
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
  /**
   * Repository root whose legacy local store `start()` migrates into the default store path. It runs
   * after writer ownership is claimed: the migration can upgrade an existing target in place, which
   * must never race the live owner's own migrations (#160).
   */
  legacyLocalStoreMigrationRoot?: string;
}

class RuntimeUpdateInputError extends Error {}

function decodeRuntimeWorktreeDigestProfile(value: unknown, field: string): RuntimeWorktreeDigestProfile {
  switch (value) {
    case "repository":
    case "architecture-documentation-projection":
      return value;
    default:
      throw new RuntimeUpdateInputError(`${field} must be repository or architecture-documentation-projection`);
  }
}

function decodeRuntimePlanUpdateInput(value: unknown): RuntimePlanUpdateInput {
  const input = runtimeUpdateInputRecord(value, "plan_update input");
  if (typeof input.id !== "string" || input.id.length === 0) {
    throw new RuntimeUpdateInputError("plan_update id must be a non-empty string");
  }
  if (!Array.isArray(input.operations)) {
    throw new RuntimeUpdateInputError("plan_update operations must be an array");
  }
  if (input.approvalChannel !== undefined && input.approvalChannel !== "mcp") {
    throw new RuntimeUpdateInputError("plan_update approvalChannel must be mcp");
  }
  let worktreeDigestPrecondition: RuntimePlanUpdateInput["worktreeDigestPrecondition"];
  if (input.worktreeDigestPrecondition !== undefined) {
    const precondition = runtimeUpdateInputRecord(
      input.worktreeDigestPrecondition,
      "plan_update worktreeDigestPrecondition"
    );
    const profile = decodeRuntimeWorktreeDigestProfile(
      precondition.profile,
      "plan_update worktreeDigestPrecondition.profile"
    );
    if (profile !== "architecture-documentation-projection") {
      throw new RuntimeUpdateInputError(
        "plan_update worktreeDigestPrecondition.profile must be architecture-documentation-projection"
      );
    }
    if (typeof precondition.expectedDigest !== "string" || precondition.expectedDigest.length === 0) {
      throw new RuntimeUpdateInputError(
        "plan_update worktreeDigestPrecondition.expectedDigest must be a non-empty string"
      );
    }
    worktreeDigestPrecondition = { profile, expectedDigest: precondition.expectedDigest };
  }
  return {
    id: input.id,
    operations: input.operations as ChangeOperation[],
    ...(input.approvalChannel === "mcp" ? { approvalChannel: "mcp" as const } : {}),
    ...(input.reason === undefined
      ? {}
      : { reason: input.reason as RuntimePlanUpdateInput["reason"] }),
    ...(worktreeDigestPrecondition === undefined ? {} : { worktreeDigestPrecondition })
  };
}

function decodeRuntimeApplyUpdateInput(value: unknown): RuntimeApplyUpdateInput {
  const input = runtimeUpdateInputRecord(value, "apply_update input");
  if (typeof input.id !== "string" || input.id.length === 0) {
    throw new RuntimeUpdateInputError("apply_update id must be a non-empty string");
  }
  if (typeof input.approved !== "boolean") {
    throw new RuntimeUpdateInputError("apply_update approved must be a boolean");
  }
  if (typeof input.expectedWorktreeDigest !== "string" || input.expectedWorktreeDigest.length === 0) {
    throw new RuntimeUpdateInputError("apply_update expectedWorktreeDigest must be a non-empty string");
  }
  const worktreeDigestProfile = input.worktreeDigestProfile === undefined
    ? undefined
    : decodeRuntimeWorktreeDigestProfile(input.worktreeDigestProfile, "apply_update worktreeDigestProfile");
  return {
    id: input.id,
    approved: input.approved,
    expectedWorktreeDigest: input.expectedWorktreeDigest,
    ...(worktreeDigestProfile === undefined ? {} : { worktreeDigestProfile }),
    ...(input.projectionApplyReceipt === undefined
      ? {}
      : { projectionApplyReceipt: input.projectionApplyReceipt as ProjectionApplyReceiptV1 })
  };
}

function runtimeUpdateInputRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeUpdateInputError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

interface ArchitectureLedgerReadModelValidation extends ModelValidationResult {
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

  async validateModel(workspace: WorkspaceRef): Promise<ModelValidationResult> {
    if (this.architectureLedger.readAuthority !== "ledger") return this.fallback.validateModel(workspace);
    const readback = await this.loadLedgerModel(workspace);
    const { errors, referenceErrors, warnings } = validateModelFiles(readback.files);
    const result: ArchitectureLedgerReadModelValidation = {
      valid: errors.length === 0,
      errors,
      ...(referenceErrors.length > 0 ? { referenceErrors } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
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
    const scope = await this.localStore.resolveArchitectureLedgerScope(architectureLedgerScopeForWorkspace(workspace));
    const state = await this.localStore.readArchitectureLedgerState(scope);
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

export class ArchctxDaemon implements RuntimeDaemonClient {
  private readonly codeFacts: CodeFactsPort;
  private readonly codeGraphProviderFactory: (repository: RepositoryRegistration) => CodeGraphProvider;
  private readonly modelStore: ModelStorePort;
  private readonly readModelStore: ModelStorePort;
  private readonly localStore: RuntimeLocalStore;
  private readonly changeSetEngine: ChangeSetEngine;
  private readonly externalDocumentationService: ExternalDocumentationService;
  private readonly practiceCheckpoints: PracticeCheckpointService;
  private readonly externalDocumentation: ExternalDocumentationPort;
  private readonly externalDocumentationInjected: boolean;
  private readonly devicePrivateKeySigner?: DevicePrivateKeySignerPort;
  private readonly architectureLedger: RuntimeArchitectureLedgerModes;
  private readonly investigationTransport: CommandInvestigationRunnerTransport;
  private readonly githubIssueExecutor: GithubIssueExecutorPort;
  private readonly clock: () => string;
  private readonly ledgerAdmin: LedgerAdminService;
  private readonly recommendationsService: RecommendationsService;
  private readonly architectureBook: ArchitectureBookService;
  private readonly agentJobs: AgentJobService;
  private readonly auditService: AuditService;
  private readonly projectionApplies: ProjectionApplyService;
  private readonly developerReviewSessions: DeveloperReviewSessionService;
  private readonly developerReviewRuns: DeveloperReviewRunService;
  private readonly maxRepoSessions: number;
  private readonly composition: RuntimeCompositionReport;
  private readonly sessions = new Map<string, RepositorySession>();
  private readonly changesets = new Map<string, ChangeSetDraft>();
  private readonly changeSetRoots = new Map<string, string>();
  private readonly mcpChangeSets = new Set<string>();
  private readonly mcpApprovals = new Map<string, { scope: "changeset"; root: string; id: string; draftDigest: string; worktreeDigest: string; expiresAt: number } | { scope: "projection"; root: string; invocationDigest: string; expiresAt: number }>();
  private readonly changeSetWorktreeDigestProfiles = new Map<string, RuntimeWorktreeDigestProfile>();
  private readonly deferredArchitectureChangeFeedFailures = new Map<string, string>();
  // Tracks the AbortController for every audit job's in-flight (foreground or detached
  // background) investigation, keyed by jobId, so `stop()` can abort real `claude` subprocesses
  // rather than leaving them running orphaned past the daemon's own lifetime.
  private readonly auditRunAbortControllers = new Map<string, AbortController>();
  private readonly landscapes: LandscapeService;
  private readonly explorerServer: ExplorerServerService;
  private running = false;
  private writerLocked = false;
  private unresolvedChangeSetJournals: UnresolvedChangeSetJournal[] = [];
  private readonly legacyLocalStoreMigrationRoot?: string;

  constructor(deps: RuntimeDeps = {}, options: RuntimeConstructionOptions = {}) {
    if (options.compositionMode === "production") assertProductionRuntimeDeps(deps);
    this.legacyLocalStoreMigrationRoot = options.legacyLocalStoreMigrationRoot;
    this.codeFacts = deps.codeFacts ?? new CodeGraphAdapter(new CodeGraphCliProvider());
    this.codeGraphProviderFactory = deps.codeGraphProviderFactory ?? ((repository) => new CodeGraphCliProvider(repository.root ?? repository.repositoryId));
    this.modelStore = deps.modelStore ?? new YamlModelStore();
    this.localStore = deps.localStore ?? new SqliteLocalStore(deps.localStorePath ?? defaultLocalStorePath());
    this.architectureLedger = runtimeArchitectureLedgerModes(deps.architectureLedger);
    this.readModelStore = new ArchitectureLedgerReadModelStore(this.modelStore, this.localStore, this.architectureLedger);
    this.changeSetEngine = deps.changeSetEngine ?? new ChangeSetEngine({
      modelStore: this.modelStore,
      projection: { planGeneratedProjection },
      journal: this.localStore,
      // The ChangeSet write scope for `render_agent_context` is derived from the model on disk at
      // preview/apply time, never carried in the draft: the renderer and the write allowlist read
      // the same single derivation, so a ChangeSet can only ever touch the contract files the
      // current model actually designates.
      agentContextScope: {
        derive: (root) => new Set(
          agentContextProjectionTargetPaths(loadNativeModelFromArchContext(root)).map((target) => target.path)
        ),
        validateRootWrite: (root, file) => {
          const model = loadNativeModelFromArchContext(root);
          const canonical = renderAgentContextProjection({ model, sourceDigest: digestJson({ model } as unknown as Json), existingFiles: loadAgentContextProjectionFiles(root, model) });
          if (canonical.files.find(candidate => candidate.path === file.path)?.body !== file.body) {
            throw new Error(`Root contract requires canonical marker-only content: ${file.path}`);
          }
        }
      }
    });
    this.devicePrivateKeySigner = deps.devicePrivateKeySigner;
    this.investigationTransport = deps.investigationTransport ?? createNodeInvestigationTransport();
    this.githubIssueExecutor = deps.githubIssueExecutor ?? createNodeGithubIssueExecutor();
    this.clock = deps.clock ?? runtimeDefaultClock(options.compositionMode ?? "embedded");
    this.explorerServer = new ExplorerServerService({
      assertRunning: () => this.assertRunning(),
      clock: this.clock,
      explorerProjectionV2: (root, input) => this.explorerProjectionV2(root, input),
      explorerProjectionDelta: (root, input) => this.explorerProjectionDelta(root, input)
    });
    this.landscapes = new LandscapeService({
      assertRunning: () => this.assertRunning(),
      localStore: this.localStore,
      sessions: this.sessions,
      openSession: (root) => this.openSession(root),
      codeGraphProviderFactory: this.codeGraphProviderFactory,
      readModelStore: this.readModelStore
    });
    this.ledgerAdmin = new LedgerAdminService({
      assertRunning: () => this.assertRunning(),
      withWriter: (run) => this.withWriter(run),
      clock: this.clock,
      architectureLedger: this.architectureLedger,
      architectureLedgerScope: (root) => this.architectureLedgerScope(root),
      architectureLedgerGitScope: (root) => this.architectureLedgerGitScope(root),
      assertFreshWorktree: (root, digest, command) => this.assertFreshWorktree(root, digest, command),
      appendArchitectureEventsWithFeed: (root, input) => this.appendArchitectureEventsWithFeed(root, input),
      localStore: this.localStore,
      openSession: (root) => this.openSession(root),
      modelStore: this.modelStore,
      changeSetEngine: this.changeSetEngine,
      recommendationArtifacts: recommendationArtifactsFromEvents,
      managedModelPath: isArchitectureLedgerManagedModelPath,
      shortDigest
    });
    this.recommendationsService = new RecommendationsService({
      assertRunning: () => this.assertRunning(),
      withWriter: (run) => this.withWriter(run),
      clock: this.clock,
      architectureLedgerScope: (root) => this.architectureLedgerScope(root),
      architectureLedgerGitScope: (root) => this.architectureLedgerGitScope(root),
      assertFreshWorktree: (root, digest, command) => this.assertFreshWorktree(root, digest, command),
      shortDigest,
      appendArchitectureEventsWithFeed: (root, input) => this.appendArchitectureEventsWithFeed(root, input),
      localStore: this.localStore
    });
    this.architectureBook = new ArchitectureBookService({
      assertRunning: () => this.assertRunning(),
      clock: this.clock,
      architectureLedgerGitScope: (root) => this.architectureLedgerGitScope(root),
      architectureLedgerReadback: (root) => this.architectureLedgerReadback(root),
      localStore: this.localStore
    });
    this.agentJobs = new AgentJobService({
      assertRunning: () => this.assertRunning(),
      openSession: (root) => this.openSession(root),
      architectureLedgerScope: (root) => this.architectureLedgerScope(root),
      clock: this.clock,
      localStore: this.localStore
    });
    this.auditService = new AuditService({
      assertRunning: () => this.assertRunning(),
      openSession: (root) => this.openSession(root),
      withWriter: (run) => this.withWriter(run),
      architectureLedgerScope: (root) => this.architectureLedgerScope(root),
      localStore: this.localStore,
      modelStore: this.modelStore,
      clock: this.clock,
      investigationTransport: this.investigationTransport,
      githubIssueExecutor: this.githubIssueExecutor,
      auditRunAbortControllers: this.auditRunAbortControllers,
      jobsComplete: (root, input) => this.jobsComplete(root, input),
      appendArchitectureEventsWithFeed: (root, input) => this.appendArchitectureEventsWithFeed(root, input),
      jobId: runtimeAgentJobId,
      risk: runtimeInvestigationRisk,
      uncertainty: runtimeInvestigationUncertainty,
      validateProposal: validateRuntimeAgentProposalPlan
    });
    this.projectionApplies = new ProjectionApplyService({
      assertRunning: () => this.assertRunning(),
      openSession: (root) => this.openSession(root),
      withWriter: (run) => this.withWriter(run),
      localStore: this.localStore,
      worktreeDigest: runtimeWorktreeDigest,
      loadSourceChanges: loadCapabilitySourceChangesSinceStamps
    });
    this.developerReviewRuns = new DeveloperReviewRunService(() => this.assertRunning(), this.clock);
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
      readModelStore: this.readModelStore,
      localStore: this.localStore,
      externalDocumentationService: this.externalDocumentationService,
      runtimeArchitectureLedgerContextPort: (root) => this.runtimeArchitectureLedgerContextPort(root)
    });
    this.composition = runtimeCompositionReport(deps, options.compositionMode ?? "embedded", this.architectureLedger);
    this.developerReviewSessions = new DeveloperReviewSessionService({
      assertRunning: () => this.assertRunning(),
      clock: this.clock,
      modelStore: this.modelStore,
      codeFacts: this.codeFacts,
      localStore: this.localStore,
      devicePrivateKeySigner: this.devicePrivateKeySigner,
      composition: this.composition,
      codeFactsDigest,
      computeDeveloperReviewDigestBundle: (input) => this.computeDeveloperReviewDigestBundle(input),
      runDeveloperReviewSession: (input) => this.runDeveloperReviewSession(input)
    });
  }

  async start(): Promise<void> {
    // Ownership first (#160): migrations and crash recovery rewrite state, and recovery cannot tell a
    // crashed writer's pending journal from a live one's, so no other process may be writing.
    this.localStore.acquireWriterOwnership?.();
    try {
      if (this.legacyLocalStoreMigrationRoot !== undefined) migrateLegacyLocalStoreIfNeeded(this.legacyLocalStoreMigrationRoot);
      await this.localStore.migrate();
      this.localStore.recoverPendingSnapshots();
      this.localStore.recoverPendingChangeSets();
      // Recovery gate (#172): a journal still pending here failed to recover. Its backups are kept
      // for the next start's retry, and nothing may write over them in the meantime.
      this.unresolvedChangeSetJournals = this.localStore.listUnresolvedChangeSetJournals();
      await this.landscapes.restore();
      await this.restoreRepositorySessions();
    } catch (error) {
      this.localStore.close();
      throw error;
    }
    this.running = true;
  }

  async stop(): Promise<void> {
    try {
      await this.closeExplorer();
    } finally {
      // Store writer ownership (#160) must be released even if the explorer fails to close.
      this.stopAfterExplorerClosed();
    }
  }

  private stopAfterExplorerClosed(): void {
    // Abort every in-flight audit investigation: this reliably kills its real `claude` subprocess
    // via the transport's signal handling (child.kill("SIGKILL") on the 'abort' event), so nothing
    // is ever left running orphaned past this daemon's lifetime — that guarantee holds
    // unconditionally. What is best-effort, not guaranteed: runAndCompleteAuditJob's own
    // subsequent failed-run bookkeeping (jobsComplete + appendAuditRunToArchitectureLedger) races
    // against `this.running` flipping false and `this.localStore.close()` a few lines below, both
    // of which happen synchronously right after this loop while the aborted investigation's
    // rejection is still propagating through several microtask hops. If that bookkeeping loses the
    // race, the job simply stays "running" in the queue with a lease that will expire on its own
    // (recoverable via the existing claim/dead-letter path) rather than a clean "failed" run
    // record — never a crash or a silently corrupted state, just a missed observability record.
    try {
      for (const controller of this.auditRunAbortControllers.values()) controller.abort();
      this.mcpApprovals.clear();
      this.sessions.clear();
      this.practiceCheckpoints.clear();
      this.deferredArchitectureChangeFeedFailures.clear();
    } finally {
      this.running = false;
      this.localStore.close();
    }
  }

  status(): RuntimeStatus {
    return {
      running: this.running,
      sessions: this.sessions.size,
      repositories: [...this.sessions.keys()].sort(),
      architectureLedger: this.architectureLedger,
      architectureChangeFeed: {
        deferredScopeCount: this.deferredArchitectureChangeFeedFailures.size,
        failureDigests: [...this.deferredArchitectureChangeFeedFailures.values()].sort()
      },
      ...(this.unresolvedChangeSetJournals.length === 0
        ? {}
        : { changeSetRecovery: { writable: false, unresolvedJournals: this.unresolvedChangeSetJournals.map((journal) => ({ ...journal })) } })
    };
  }

  compositionReport(): RuntimeCompositionReport {
    return this.composition;
  }

  async egressReport(root: string) {
    const repositoryRoot = runtimeStatePaths(root).repositoryRoot;
    const workspace = { root: repositoryRoot, repositoryId: repositoryFingerprint(repositoryRoot), headSha: readHeadSha(repositoryRoot) };
    const documentation = await this.externalDocumentation.health();
    return {
      ...localEgressStatus({
        ...process.env,
        [CONTEXT7_ENABLED_ENV]: documentation.enabled ? "1" : "0",
        [CONTEXT7_MODE_ENV]: documentation.mode
      }, {
        auditEnabled: await this.auditService.auditGithubIssuesEnabled(workspace),
        auditUserConsent: readAuditConsent(repositoryRoot).granted,
        githubIssuesTokenEnv: AUDIT_APPROVE_GH_TOKEN_ENV
      }),
      source: "daemon" as const
    };
  }

  /**
   * Whether the daemon currently has real background work that must not be interrupted: a
   * queued or running `runtime_job_queue` entry in any currently open repository session's
   * scope, or an audit investigation this daemon is actively driving
   * (`auditRunAbortControllers`). Used by `ArchctxRuntimeRpcServer`'s idle-exit timer to decide
   * whether it is safe to shut the process down even when no RPC request happens to be in
   * flight at the moment the timer fires — `auditRun`'s synchronous claim already marks its job
   * "running" in the queue for the investigation's entire multi-minute lifetime, independent of
   * whether the RPC call that started it is still open (see `auditRun`). Scoped to sessions this
   * daemon currently has open rather than every scope ever persisted to the local store: the
   * daemon only drives work for repositories it has a live session for, so this is the most
   * direct existing signal without scanning storage for repositories nothing is tracking.
   */
  async hasActiveBackgroundWork(): Promise<boolean> {
    if (this.auditRunAbortControllers.size > 0) return true;
    for (const session of this.sessions.values()) {
      const scope = architectureLedgerScopeForWorkspace(session.workspace);
      const stats = await this.localStore.queueStatsRuntimeAgentJobs(scope);
      if (stats.queuedDepth > 0 || stats.runningDepth > 0) return true;
    }
    return false;
  }

  async init(root: string, productName?: string): Promise<JsonEnvelope> {
    this.assertRunning();
    return this.withWriter(async () => {
      try {
        initializeArchContextModel(root, productName);
      } catch (error) {
        if (error instanceof ArchContextInitRefusedError) {
          return errorEnvelope("init", "AC_PRECONDITION_FAILED", error.message, "init-would-overwrite-existing-model");
        }
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
      architectureLedger: this.runtimeArchitectureLedgerContextPort(root),
      budget: { maxBytes: 12_288, maxItems: maxSymbols }
    });
    return okEnvelope("context", context as unknown as Json);
  }

  async prepare(root: string, task: string, maxBytes = 12_288, maxItems = 12, taskSessionId = "task_runtime"): Promise<JsonEnvelope> {
    return this.practiceCheckpoints.prepare(root, task, maxBytes, maxItems, taskSessionId);
  }

  async checkpoint(root: string, input: RuntimeCheckpointInput): Promise<JsonEnvelope> {
    return this.practiceCheckpoints.checkpoint(root, input);
  }

  async jobsEnqueueGitHook(root: string, input: RuntimeAgentJobEnqueueGitInput = {}): Promise<JsonEnvelope> {
    return this.agentJobs.jobsEnqueueGitHook(root, input);
  }

  async jobsList(root: string, input: { statuses?: AgentJobV1["status"][] } = {}): Promise<JsonEnvelope> {
    return this.agentJobs.jobsList(root, input);
  }

  async jobsStats(root: string, input: { now?: string } = {}): Promise<JsonEnvelope> {
    return this.agentJobs.jobsStats(root, input);
  }

  async jobsClaim(root: string, input: RuntimeAgentJobClaimRpcInput): Promise<JsonEnvelope> {
    return this.agentJobs.jobsClaim(root, input);
  }

  async jobsComplete(root: string, input: RuntimeAgentJobCompleteRpcInput): Promise<JsonEnvelope> {
    return this.agentJobs.jobsComplete(root, input);
  }

  async jobsRetry(root: string, input: RuntimeAgentJobRetryRpcInput): Promise<JsonEnvelope> {
    return this.agentJobs.jobsRetry(root, input);
  }

  async jobsCancel(root: string, input: RuntimeAgentJobCancelRpcInput): Promise<JsonEnvelope> {
    return this.agentJobs.jobsCancel(root, input);
  }

  async auditRun(root: string, input: RuntimeAuditRunInput = {}): Promise<JsonEnvelope> {
    return this.auditService.auditRun(root, input);
  }

  async auditList(root: string, input: { statuses?: ArchitectureAuditRunV1["status"][] } = {}): Promise<JsonEnvelope> {
    return this.auditService.auditList(root, input);
  }

  async auditShow(root: string, runId: string): Promise<JsonEnvelope> {
    return this.auditService.auditShow(root, runId);
  }

  async auditApprove(root: string, input: RuntimeAuditApproveInput): Promise<JsonEnvelope> {
    return this.auditService.auditApprove(root, input);
  }

  practices(root: string, input: PracticeCatalogCommandInput): JsonEnvelope {
    return this.practiceCheckpoints.practices(root, input);
  }

  practiceWaivers(root: string): JsonEnvelope {
    return this.practiceCheckpoints.practiceWaivers(root);
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
      reviewAt: input.reviewAt,
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
    this.changeSetRoots.set(draft.id, canonicalRepositoryRoot(root));
    this.changeSetWorktreeDigestProfiles.set(draft.id, "repository");
    this.mcpChangeSets.delete(draft.id);
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
    return this.externalDocumentationService.docs(root, input);
  }

  async readResource(root: string, uri: string): Promise<JsonEnvelope> {
    return this.externalDocumentationService.readResource(root, uri);
  }

  async planUpdate(root: string, rawInput: RuntimePlanUpdateInput): Promise<JsonEnvelope> {
    this.assertRunning();
    let input: RuntimePlanUpdateInput;
    try {
      input = decodeRuntimePlanUpdateInput(rawInput);
    } catch (error) {
      if (error instanceof RuntimeUpdateInputError) {
        return errorEnvelope("plan_update", "AC_SCHEMA_INVALID", error.message);
      }
      throw error;
    }
    const session = await this.openSession(root);
    const model = await this.readModelStore.validateModel(session.workspace);
    const worktreeDigestProfile: RuntimeWorktreeDigestProfile = input.worktreeDigestPrecondition?.profile ?? "repository";
    const worktreeDigest = runtimeWorktreeDigest(root, worktreeDigestProfile);
    if (input.worktreeDigestPrecondition && input.worktreeDigestPrecondition.expectedDigest !== worktreeDigest) {
      throw new Error("Worktree digest changed before plan");
    }
    const draft = this.changeSetEngine.plan({
      id: input.id,
      base: {
        headSha: session.workspace.headSha,
        worktreeDigest,
        modelDigest: model.modelDigest
      },
      reason: input.reason ?? { taskSessionId: "task_runtime" },
      operations: input.operations
    });
    this.changesets.set(draft.id, draft);
    this.changeSetRoots.set(draft.id, canonicalRepositoryRoot(root));
    this.changeSetWorktreeDigestProfiles.set(draft.id, worktreeDigestProfile);
    if (input.approvalChannel === "mcp") this.mcpChangeSets.add(draft.id);
    else this.mcpChangeSets.delete(draft.id);
    return okEnvelope("plan_update", {
      draft,
      changeSetDigest: digestJson(draft as unknown as Json),
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
    const practiceEnforcement = shouldEvaluatePracticeEnforcement(practicePolicy)
      ? evaluatePracticeEnforcement({
        catalog: loadPracticeCatalog({ root: session.workspace.root }),
        policy: practicePolicy,
        waivers: loadPracticeWaivers(session.workspace.root),
        matches: (await compileTaskContext({
          workspace: session.workspace,
          task: input.task ?? baseline?.task ?? taskSessionId,
          codeFacts: this.codeFacts,
          modelStore: this.readModelStore,
          architectureLedger: this.runtimeArchitectureLedgerContextPort(root),
          budget: { maxBytes: 12_288, maxItems: 12 }
        })).practiceGuidance.matches,
        previousMatches: baseline?.matches,
        compatibilityContract: input.compatibilityContract,
        compatibilityPathIntroduced: input.compatibilityPathIntroduced,
        ownerRegistry: loadPracticeWaiverOwnerRegistry(session.workspace.root),
        now: this.clock()
      })
      : undefined;
    const projectionDrift = completeTaskProjectionDrift(session.workspace.root);
    const projectionFreshness = completeTaskProjectionFreshness(session.workspace.root);
    const worktreeDigest = computeWorktreeDigest(session.workspace.root);
    // Constraints and the review policy are read through the model store port, so the ledger read
    // mode sees the same model `validate` does.
    const modelFiles = (await this.readModelStore.loadModel(session.workspace)).filter(isModelFile);
    const dependencyConstraints = evaluateReviewDependencyConstraints({ root: session.workspace.root, worktreeDigest, modelFiles });
    const reviewInput: CompleteTaskInput = {
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

  private projectionHost(): ProjectionServiceHost {
    return {
      planUpdate: (...args) => this.planUpdate(...args),
      applyUpdate: (...args) => this.applyUpdate(...args),
      listProjectionPriorCommittedApplies: (...args) => this.listProjectionPriorCommittedApplies(...args),
      inspectProjectionApplyReceipt: (...args) => this.inspectProjectionApplyReceipt(...args),
      readbackProjectionApply: (...args) => this.readbackProjectionApply(...args),
      recoverProjectionApply: (...args) => this.recoverProjectionApply(...args),
      loadCapabilitySourceChangesSinceStamps
    };
  }

  async docsProjection(root: string, input: RuntimeDocsProjectionInput): Promise<JsonEnvelope> {
    this.assertRunning();
    try { validateDocsProjectionInput(input); }
    catch (error) { return errorEnvelope("docs", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error)); }
    return runArchitectureDocsProjectionCommand(input, root, this.projectionHost());
  }

  async agentContextProjection(root: string, input: RuntimeAgentContextProjectionInput): Promise<JsonEnvelope> {
    this.assertRunning();
    try { validateAgentContextProjectionInput(input); }
    catch (error) { return errorEnvelope("agent-context", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error)); }
    return runAgentContextProjectionCommand(input, root, this.projectionHost());
  }

  async projection(root: string, input: RuntimeProjectionInvocation): Promise<JsonEnvelope> {
    this.assertRunning();
    try { validateProjectionInvocation(input); }
    catch (error) { return errorEnvelope(`projection.${input?.action ?? "run"}`, "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error)); }
    return runProjectionProtocolCommand(input, root, this.projectionHost());
  }

  async approveMcpProjection(root: string, input: RuntimeProjectionInvocation): Promise<JsonEnvelope> {
    this.assertRunning();
    try {
      validateProjectionInvocation(input);
      if (!projectionInvocationWrites(input)) throw new Error("Projection approval requires an apply, adopt or recover invocation");
      assertProjectionInvocationSnapshot(root, input);
    } catch (error) { return errorEnvelope("projection.approve", "AC_PRECONDITION_FAILED", error instanceof Error ? error.message : String(error)); }
    const now = Date.parse(this.clock());
    if (!Number.isFinite(now)) return errorEnvelope("projection.approve", "AC_PRECONDITION_FAILED", "Approval clock is invalid");
    for (const [key, grant] of this.mcpApprovals) if (grant.expiresAt <= now) this.mcpApprovals.delete(key);
    if (this.mcpApprovals.size >= 256) return errorEnvelope("projection.approve", "AC_PRECONDITION_FAILED", "Too many outstanding approvals; consume an approval or wait for expiry");
    const approvalToken = randomBytes(32).toString("hex");
    const expiresAt = now + 5 * 60_000;
    this.mcpApprovals.set(digestJson(approvalToken), { scope: "projection", root: canonicalRepositoryRoot(root), invocationDigest: digestJson(input as unknown as Json), expiresAt });
    return okEnvelope("projection.approve", { approvalToken, expiresAt: new Date(expiresAt).toISOString() });
  }

  async mcpProjection(root: string, input: RuntimeProjectionInvocation, approvalToken?: string): Promise<JsonEnvelope> {
    this.assertRunning();
    try { validateProjectionInvocation(input); }
    catch (error) { return errorEnvelope("projection", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error)); }
    if (projectionInvocationWrites(input)) {
      const denied = () => errorEnvelope("projection", "AC_USER_CONFIRMATION_REQUIRED", "A fresh one-time token from archctx projection approve is required");
      if (typeof approvalToken !== "string" || !/^[a-f0-9]{64}$/.test(approvalToken)) return denied();
      const key = digestJson(approvalToken);
      const grant = this.mcpApprovals.get(key);
      this.mcpApprovals.delete(key);
      const now = Date.parse(this.clock());
      if (!grant || grant.scope !== "projection" || !Number.isFinite(now) || grant.expiresAt <= now ||
          grant.root !== canonicalRepositoryRoot(root) || grant.invocationDigest !== digestJson(input as unknown as Json)) return denied();
    }
    return this.projection(root, input);
  }

  async approveMcpUpdate(root: string, input: RuntimeMcpApprovalInput): Promise<JsonEnvelope> {
    this.assertRunning();
    const draft = this.changesets.get(input?.id);
    const canonicalRoot = canonicalRepositoryRoot(root);
    const now = Date.parse(this.clock());
    if (!draft || this.changeSetRoots.get(input.id) !== canonicalRoot ||
        this.changeSetWorktreeDigestProfiles.get(input.id) !== "repository" ||
        input.expectedChangeSetDigest !== digestJson(draft as unknown as Json) ||
        input.expectedWorktreeDigest !== draft.base.worktreeDigest ||
        input.expectedWorktreeDigest !== runtimeWorktreeDigest(root, "repository") || !Number.isFinite(now)) {
      return errorEnvelope("approve_mcp_update", "AC_PRECONDITION_FAILED", "Approval must match the current ChangeSet preview and repository");
    }
    for (const [key, grant] of this.mcpApprovals) if (grant.expiresAt <= now) this.mcpApprovals.delete(key);
    if (this.mcpApprovals.size >= 256) return errorEnvelope("approve_mcp_update", "AC_PRECONDITION_FAILED", "Too many outstanding approvals; consume an approval or wait for expiry");
    const approvalToken = randomBytes(32).toString("hex");
    const expiresAt = now + 5 * 60_000;
    this.mcpApprovals.set(digestJson(approvalToken), {
      scope: "changeset", root: canonicalRoot, id: input.id, draftDigest: input.expectedChangeSetDigest,
      worktreeDigest: input.expectedWorktreeDigest, expiresAt
    });
    return okEnvelope("approve_mcp_update", { approvalToken, expiresAt: new Date(expiresAt).toISOString() });
  }

  async applyMcpUpdate(root: string, input: RuntimeMcpApplyInput): Promise<JsonEnvelope> {
    this.assertRunning();
    const denied = () => errorEnvelope("apply_update", "AC_USER_CONFIRMATION_REQUIRED", "A fresh one-time token from archctx approve is required");
    if (typeof input?.approvalToken !== "string" || !/^[a-f0-9]{64}$/.test(input.approvalToken)) return denied();
    const key = digestJson(input.approvalToken);
    const grant = this.mcpApprovals.get(key);
    if (!grant) return denied();
    // Consume before any asynchronous work: racing calls can never spend the same grant twice.
    this.mcpApprovals.delete(key);
    const draft = this.changesets.get(input.id);
    const now = Date.parse(this.clock());
    if (grant.scope !== "changeset" || !Number.isFinite(now) || grant.expiresAt <= now || grant.root !== canonicalRepositoryRoot(root) ||
        grant.id !== input.id || grant.worktreeDigest !== input.expectedWorktreeDigest ||
        !draft || grant.draftDigest !== digestJson(draft as unknown as Json)) return denied();
    return this.applyAuthorizedUpdate(root, { id: input.id, expectedWorktreeDigest: input.expectedWorktreeDigest, approved: true });
  }

  async applyUpdate(root: string, rawInput: RuntimeApplyUpdateInput): Promise<JsonEnvelope> {
    this.assertRunning();
    if (this.mcpChangeSets.has(rawInput?.id)) {
      return errorEnvelope("apply_update", "AC_USER_CONFIRMATION_REQUIRED", "MCP ChangeSets require a one-time approval token through applyMcpUpdate");
    }
    return this.applyAuthorizedUpdate(root, rawInput);
  }

  private async applyAuthorizedUpdate(root: string, rawInput: RuntimeApplyUpdateInput): Promise<JsonEnvelope> {
    this.assertRunning();
    let input: RuntimeApplyUpdateInput;
    try {
      input = decodeRuntimeApplyUpdateInput(rawInput);
    } catch (error) {
      if (error instanceof RuntimeUpdateInputError) {
        return errorEnvelope("apply_update", "AC_SCHEMA_INVALID", error.message);
      }
      throw error;
    }
    return this.withWriter(async () => {
      const draft = this.changesets.get(input.id);
      if (!draft) throw new Error(`Unknown ChangeSet: ${input.id}`);
      const plannedProfile = this.changeSetWorktreeDigestProfiles.get(input.id);
      if (!plannedProfile) throw new Error("ChangeSet worktree digest profile missing before apply");
      const requestedProfile = input.worktreeDigestProfile ?? "repository";
      if (requestedProfile !== plannedProfile) throw new Error("ChangeSet worktree digest profile changed before apply");
      const current = runtimeWorktreeDigest(root, plannedProfile);
      if (current !== input.expectedWorktreeDigest) throw new Error("Worktree digest changed before apply");
      const session = await this.openSession(root);
      if (draft.base.headSha !== session.workspace.headSha) throw new Error("ChangeSet HEAD changed before apply");
      if (draft.base.worktreeDigest !== current) throw new Error("ChangeSet worktree digest changed before apply");
      const currentModel = await this.readModelStore.validateModel(session.workspace);
      const baseErrors = baseModelBlockingErrors(currentModel);
      if (baseErrors.length > 0) {
        throw new Error(`ChangeSet base model is invalid: ${baseErrors.join("; ")}`);
      }
      if (draft.base.modelDigest !== currentModel.modelDigest) throw new Error("ChangeSet model digest changed before apply");
      if (input.projectionApplyReceipt && await this.localStore.inspectProjectionApplyReceipt(input.projectionApplyReceipt.identity.lookupKey)) {
        return errorEnvelope("apply_update", "AC_PRECONDITION_FAILED", "committed projection receipt requires explicit projection recover");
      }
      const approved = input.approved ? this.changeSetEngine.approve(draft) : draft;
      let ledgerAppend: Json | undefined;
      const writesLedger = architectureLedgerWriteAppendsEvents(this.architectureLedger.writeMode);
      const result = await this.changeSetEngine.apply(root, approved, {
        approved: input.approved,
        afterModelValidatedBeforeCommit: writesLedger || input.projectionApplyReceipt
          ? async ({ journalId }) => {
            if (input.projectionApplyReceipt) {
              if (!journalId) throw new Error("projection apply receipt requires a durable ChangeSet journal");
              await this.localStore.recordProjectionApplyReceipt(journalId, input.projectionApplyReceipt);
            }
            if (writesLedger) {
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
            return { journalCommitted: writesLedger && Boolean(journalId) };
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

  async inspectProjectionApplyReceipt(root: string, lookupKey: string): Promise<JsonEnvelope> {
    return this.projectionApplies.inspectProjectionApplyReceipt(root, lookupKey);
  }

  async listProjectionPriorCommittedApplies(root: string, requestId: string): Promise<JsonEnvelope> {
    return this.projectionApplies.listProjectionPriorCommittedApplies(root, requestId);
  }

  async readbackProjectionApply(root: string, request: ProjectionRequestV1): Promise<JsonEnvelope> {
    return this.projectionApplies.readbackProjectionApply(root, request);
  }

  async recoverProjectionApply(root: string, intent: ProjectionApplyRecoveryIntentV1): Promise<JsonEnvelope> {
    return this.projectionApplies.recoverProjectionApply(root, intent);
  }

  private async appendAppliedChangeSetToArchitectureLedger(root: string, session: RepositorySession, draft: ChangeSetDraft, journalId?: string) {
    const paths = runtimeStatePaths(root);
    const scope = {
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
    const plan = planChangeSetApplyToArchitectureLedgerEvent({
      ...scope,
      draft,
      files: listModelFiles(root),
      previousEvidenceState: await this.localStore.replayArchitectureLedgerEvidence(scope),
      createdAt: this.clock(),
      writeMode: this.architectureLedger.writeMode === "ledger-with-projection" ? "ledger-with-projection" : "dual",
      command: "archctx apply"
    });
    if (journalId) await this.localStore.recordChangeSetLedgerPlan(journalId, { event: plan.event });
    const appendInput = { writer: "runtime-daemon" as const, events: [plan.event] };
    const result = await this.appendArchitectureEventsWithFeed(root, appendInput, journalId);
    return result;
  }

  /** Records an operator's acceptance of an already committed YAML ChangeSet, without promoting ledger graph authority. */
  async acceptCommittedChange(root: string, input: RuntimeAcceptCommittedChangeInput): Promise<JsonEnvelope> {
    this.assertRunning();
    if (!input || Object.keys(input).sort().join(",") !== "approved,changeSetId,expectedWorktreeDigest,journalId"
      || input.approved !== true || typeof input.journalId !== "string" || !input.journalId
      || typeof input.changeSetId !== "string" || !input.changeSetId
      || typeof input.expectedWorktreeDigest !== "string") {
      return errorEnvelope("ledger.accept-committed", "AC_SCHEMA_INVALID", "journalId, changeSetId, approved: true and expectedWorktreeDigest are required");
    }
    if (this.architectureLedger.readMode !== "yaml" || this.architectureLedger.writeMode !== "yaml") {
      return errorEnvelope("ledger.accept-committed", "AC_PRECONDITION_FAILED", "committed YAML acceptance requires YAML read and write authority");
    }
    return this.withWriter(async () => {
      try {
        const canonicalRoot = canonicalRepositoryRoot(root);
        const journal = await this.localStore.readCommittedChangeSet(canonicalRoot, input.journalId);
        if (!journal || journal.changeSetId !== input.changeSetId) throw new Error("committed ChangeSet journal missing or mismatched");
        const binding = acceptedCommittedChangeBinding(canonicalRoot, journal);
        const model = loadNativeModelFromArchContext(canonicalRoot);
        const worktreeDigest = architectureDocumentationProjectionWorktreeDigest(canonicalRoot, model);
        if (input.expectedWorktreeDigest !== worktreeDigest) throw new Error("accepted ChangeSet expected worktree digest mismatch");
        const projection = buildArchitectureDocsProjection(this.projectionHost(), canonicalRoot, new Date(0).toISOString(), "repo-harness/v1");
        const major = projection.plan.majorChange;
        if (major.mode !== "human-action-required"
          || major.reasonCodes.join(",") !== "node-added,node-removed"
          || major.affectedNodeIds.length !== 2
          || projection.plan.rejected.length > 0) {
          throw new Error("accepted ChangeSet requires one unresolved node rename without projection conflicts");
        }
        for (const nodeId of major.affectedNodeIds) {
          const path = `.archcontext/model/nodes/${nodeId}.yaml`;
          const file = journal.files.find((entry) => entry.path === path);
          if (!file || file.operation !== (model.nodes.some((node) => node.id === nodeId) ? "write" : "delete")) {
            throw new Error(`accepted ChangeSet journal does not bind affected node: ${nodeId}`);
          }
        }
        const scope = acceptedCommittedChangeScope(canonicalRoot, worktreeDigest);
        const modelDigest = digestJson(model as unknown as Json);
        const acceptedChange: AcceptedArchitectureChangeReferenceV1 = {
          changeSetId: journal.changeSetId,
          eventId: `architecture_event.changeset_accepted.${digestJson({ journalId: journal.journalId } as unknown as Json).slice(7, 31)}`,
          reasonCodes: major.reasonCodes,
          affectedNodeIds: major.affectedNodeIds
        };
        const existing = await this.localStore.readArchitectureEvent({ ...scope, eventId: acceptedChange.eventId });
        if (existing) throw new Error(`committed ChangeSet already has an acceptance event at this snapshot: ${existing.eventId}`);
        const ledgerGraphDigest = architectureLedgerStateDigest(await this.localStore.readArchitectureLedgerState(scope));
        const inputDigest = digestJson({
          journalId: journal.journalId, changeSetId: journal.changeSetId, fileSetDigest: binding.fileSetDigest,
          modelDigest, acceptedChange, repository: scope.repository, worktree: scope.worktree
        } as unknown as Json);
        const event: ArchitectureEventV1 = {
          schemaVersion: "archcontext.architecture-event/v1",
          eventId: acceptedChange.eventId,
          eventType: "architecture.changeset.accepted",
          payloadVersion: "archcontext.accepted-committed-change/v1",
          repository: scope.repository,
          worktree: scope.worktree,
          baseDigest: ledgerGraphDigest,
          resultingDigest: ledgerGraphDigest,
          headSha: scope.worktree.headSha,
          actor: { kind: "daemon", id: "archctxd" },
          source: "manual",
          timestamp: this.clock(),
          idempotencyKey: `architecture-ledger-accepted-committed:${journal.journalId}`,
          provenance: { producer: "runtime-daemon", command: "archctx ledger accept-committed", inputDigest },
          payload: {
            operations: [],
            acceptedCommittedChange: {
              schemaVersion: "archcontext.accepted-committed-change/v1",
              journalId: journal.journalId,
              changeSetId: journal.changeSetId,
              fileSetDigest: binding.fileSetDigest,
              modelDigest,
              reasonCodes: acceptedChange.reasonCodes,
              affectedNodeIds: acceptedChange.affectedNodeIds,
              authority: "yaml"
            }
          } as unknown as Json
        };
        const appended = await this.appendArchitectureEventsWithFeed(canonicalRoot, { writer: "runtime-daemon", events: [event] });
        if (appended.appendedEvents.length !== 1) throw new Error("committed ChangeSet acceptance event was not appended");
        const readback = await this.localStore.readArchitectureEvent({ ...scope, eventId: event.eventId });
        if (!readback?.eventHash || readback.eventType !== event.eventType) throw new Error("committed ChangeSet acceptance readback failed");
        return okEnvelope("ledger.accept-committed", { acceptedChange, journalId: journal.journalId, eventHash: readback.eventHash, fileSetDigest: binding.fileSetDigest } as unknown as Json);
      } catch (error) {
        return errorEnvelope("ledger.accept-committed", "AC_PRECONDITION_FAILED", error instanceof Error ? error.message : String(error));
      }
    });
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
      drift: readback.drift,
      reconcile: readback.reconcile
    } as unknown as Json);
  }

  async book(root: string, input: RuntimeBookInput = {}): Promise<JsonEnvelope> {
    return this.architectureBook.book(root, input);
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

  async ledgerProject(root: string, input: RuntimeLedgerProjectInput = { dryRun: true }): Promise<JsonEnvelope> {
    return this.ledgerAdmin.ledgerProject(root, input);
  }

  async ledgerMigrate(root: string, input: RuntimeLedgerMigrateInput = { dryRun: true }): Promise<JsonEnvelope> {
    return this.ledgerAdmin.ledgerMigrate(root, input);
  }

  async ledgerRollback(root: string, input: RuntimeLedgerRollbackInput = { dryRun: true }): Promise<JsonEnvelope> {
    return this.ledgerAdmin.ledgerRollback(root, input);
  }

  async ledgerRebuild(root: string, input: RuntimeLedgerRebuildInput = {}): Promise<JsonEnvelope> {
    return this.ledgerAdmin.ledgerRebuild(root, input);
  }

  private async architectureLedgerReadback(root: string) {
    const scope = await this.architectureLedgerScope(root);
    const files = listModelFiles(root);
    const previousEvidenceState = await this.localStore.replayArchitectureLedgerEvidence(scope);
    const yamlPlan = planYamlToArchitectureLedgerImport({
      ...scope,
      files,
      previousEvidenceState,
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
    const reconcile = reconcileArchitectureLedgerDrift({ drift });
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
      drift,
      reconcile
    };
  }

  private runtimeArchitectureLedgerContextPort(root: string): ArchitectureContextLedgerPort | undefined {
    return this.running ? this.architectureBook.contextPort(root) : undefined;
  }

  private async architectureLedgerScope(root: string): Promise<ArchitectureLedgerScope> {
    return this.localStore.resolveArchitectureLedgerScope(await this.architectureLedgerGitScope(root));
  }

  private architectureLedgerProjectionGitScope(root: string): ArchitectureLedgerScope {
    const headSha = readHeadSha(root);
    const binding = bindRepository(root, headSha);
    const paths = runtimeStatePaths(root);
    return {
      repository: {
        repositoryId: binding.repositoryId,
        storageRepositoryId: paths.storageRepositoryId
      },
      worktree: {
        workspaceId: paths.workspaceId,
        storageWorkspaceId: paths.storageWorkspaceId,
        branch: readCurrentBranch(root),
        headSha,
        worktreeDigest: binding.worktreeDigest
      }
    };
  }

  private async architectureLedgerGitScope(root: string): Promise<ArchitectureLedgerScope> {
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
    return this.developerReviewRuns.prepareDeveloperReviewWorktree(input);
  }

  startDeveloperReviewRun(input: {
    repositoryRoot: string;
    challenge: ReviewChallengeV2;
    expectedHeadTreeOid?: string;
    /** In-process callers only; the production RPC contract does not accept a temp root. */
    tempRoot?: string;
  }): DeveloperReviewRunPreparation {
    return this.developerReviewRuns.startDeveloperReviewRun(input);
  }

  async withDeveloperReviewRun<T>(input: {
    repositoryRoot: string;
    challenge: ReviewChallengeV2;
    expectedHeadTreeOid?: string;
    /** In-process callers only; the production RPC contract does not accept a temp root. */
    tempRoot?: string;
  }, run: (developerReviewRun: DeveloperReviewRun) => Promise<T> | T): Promise<T> {
    return this.developerReviewRuns.withDeveloperReviewRun(input, run);
  }

  cleanupOwnedDeveloperReviewRun(run: DeveloperReviewRunManifest): DeveloperReviewRunCleanup {
    return this.developerReviewRuns.cleanupOwnedDeveloperReviewRun(run);
  }

  cleanupDeveloperReviewRun(input: DeveloperReviewRunCleanupRequest): DeveloperReviewRunCleanup {
    return this.developerReviewRuns.cleanupDeveloperReviewRun(input);
  }

  recoverDeveloperReviewRuns(input: {
    repositoryRoot: string;
    force?: boolean;
  }): DeveloperReviewRunRecovery {
    return this.developerReviewRuns.recoverDeveloperReviewRuns(input);
  }

  async computeDeveloperReviewDigestBundle(input: {
    challenge: ReviewChallengeV2;
    worktree: DetachedReviewWorktree;
    codeFactsSnapshot?: CodeFactsSnapshot;
    sparseScope?: string[];
  }): Promise<DeveloperReviewDigestBundle> {
    return this.developerReviewSessions.computeDeveloperReviewDigestBundle(input);
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
    return this.developerReviewSessions.runDeveloperReviewSession(input);
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
    return this.developerReviewSessions.runSignedDeveloperReviewAttestation(input);
  }

  async repoAdd(root: string, name?: string): Promise<JsonEnvelope> {
    return this.landscapes.repoAdd(root, name);
  }

  async repoList(): Promise<JsonEnvelope> {
    return this.landscapes.repoList();
  }

  async repoRemove(repositoryId: string): Promise<JsonEnvelope> {
    return this.landscapes.repoRemove(repositoryId);
  }

  async loadLandscape(landscape: Landscape): Promise<JsonEnvelope> {
    return this.landscapes.loadLandscape(landscape);
  }

  async landscapeStatus(): Promise<JsonEnvelope> {
    return this.landscapes.landscapeStatus();
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

  async explorerProjectionV2(root: string, query: ExplorerProjectionQueryV2): Promise<JsonEnvelope> {
    this.assertRunning();
    try {
      const projection = await this.buildExplorerProjectionV2(root, query);
      return okEnvelope("explorer.projection.v2", projection as unknown as Json);
    } catch (error) {
      if (error instanceof ExplorerProjectionCompileError) {
        return errorEnvelope(
          "explorer.projection.v2",
          error.reason === "precondition-failed" ? "AC_PRECONDITION_FAILED" : "AC_SCHEMA_INVALID",
          error.message
        );
      }
      throw error;
    }
  }

  async explorerProjectionDelta(root: string, query: ExplorerDeltaQueryV2): Promise<JsonEnvelope> {
    this.assertRunning();
    const queryFailure = validateExplorerDeltaQueryV2(query);
    if (queryFailure) {
      return errorEnvelope("explorer.delta", "AC_SCHEMA_INVALID", queryFailure, "invalid-delta-query");
    }
    const readback = await this.architectureLedgerReadback(root);
    const scope = { repository: readback.repository, worktree: readback.worktree };
    const [base, head] = await Promise.all([
      this.localStore.readExplorerProjection({ ...scope, projectionDigest: query.base.projectionDigest }),
      this.localStore.readExplorerProjection({ ...scope, projectionDigest: query.head.projectionDigest })
    ]);
    if (!base || !head) {
      return errorEnvelope(
        "explorer.delta",
        "AC_PRECONDITION_FAILED",
        "both digest-addressed Explorer projections must exist in the daemon cache",
        "projection-cache-miss"
      );
    }
    const pinExpiresAt = new Date(Date.parse(this.clock()) + 10 * 60 * 1000).toISOString();
    await this.localStore.pinExplorerProjections({ ...scope, projectionDigests: [base.projectionDigest], reason: "delta-base", expiresAt: pinExpiresAt });
    await this.localStore.pinExplorerProjections({ ...scope, projectionDigests: [head.projectionDigest], reason: "delta-head", expiresAt: pinExpiresAt });
    try {
      let baseReplay: ArchitectureLedgerReplayResult;
      let headReplay: ArchitectureLedgerReplayResult;
      try {
        [baseReplay, headReplay] = await Promise.all([
          this.localStore.replayArchitectureLedger({ ...scope, untilEventId: query.base.eventId }),
          this.localStore.replayArchitectureLedger({ ...scope, untilEventId: query.head.eventId })
        ]);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("architecture-ledger-event-not-found:")) {
          throw new ExplorerDeltaPreconditionError("authority-event-missing", "both authority cursor events must exist in the selected repository/worktree scope");
        }
        throw error;
      }
      if (baseReplay.cursor.lastEventSequence > headReplay.cursor.lastEventSequence) {
        throw new ExplorerDeltaPreconditionError("authority-cursor-reversed", "Explorer delta requires base event at or before head event");
      }
      const baseGraph = baseReplay.state;
      const headGraph = headReplay.state;
      const baseEvidence = baseReplay.evidenceState;
      const headEvidence = headReplay.evidenceState;
      const baseCursor = explorerAuthorityCursorFromReplay(scope, baseReplay);
      const headCursor = explorerAuthorityCursorFromReplay(scope, headReplay);
      if (!sameExplorerAuthorityCursor(base.cursor.authorityCursor, baseCursor) || !sameExplorerAuthorityCursor(head.cursor.authorityCursor, headCursor)) {
        throw new ExplorerDeltaPreconditionError("projection-authority-mismatch", "Explorer projection authority cursor does not match the requested event state");
      }
      const projectionChanges = compileExplorerProjectionChanges(base, head);
      const factChanges = compileArchitectureFactChanges(baseGraph, headGraph);
      const evidenceChanges = compileEvidenceStateChanges(baseEvidence, headEvidence);
      const withoutDigest = {
        schemaVersion: "archcontext.explorer-projection-delta/v2" as const,
        base: { ...baseCursor, projectionDigest: base.projectionDigest, inputManifestDigest: base.inputManifest.manifestDigest },
        head: { ...headCursor, projectionDigest: head.projectionDigest, inputManifestDigest: head.inputManifest.manifestDigest },
        factChanges,
        evidenceChanges,
        projectionChanges,
        counts: {
          "architecture-fact": factChanges.length,
          evidence: evidenceChanges.length,
          projection: projectionChanges.length
        }
      };
      const delta: ExplorerProjectionDeltaV2 = { ...withoutDigest, deltaDigest: digestJson(withoutDigest as unknown as Json) };
      return okEnvelope("explorer.delta", delta as unknown as Json);
    } catch (error) {
      if (error instanceof ExplorerDeltaPreconditionError) {
        return errorEnvelope("explorer.delta", "AC_PRECONDITION_FAILED", error.message, error.reasonCode);
      }
      if (error instanceof ExplorerProjectionCompileError) {
        return errorEnvelope("explorer.delta", "AC_PRECONDITION_FAILED", error.message, "projection-manifest-incompatible");
      }
      throw error;
    }
  }

  private async buildExplorerProjectionV2(root: string, query: ExplorerProjectionQueryV2): Promise<ExplorerProjectionV2> {
    void planProjectionRead(query, "git-authority");
    const gitScope = this.architectureLedgerProjectionGitScope(root);
    const ledgerScope = await this.localStore.resolveArchitectureLedgerScope(gitScope);
    const ledgerAuthority = await this.localStore.readExplorerProjectionAuthority(ledgerScope);
    if (this.architectureLedger.readMode === "ledger" && !ledgerAuthority) {
      throw new ExplorerProjectionCompileError("precondition-failed", "required-input-unavailable:architecture-ledger:no-current-event");
    }
    const emptyEvidenceState = replayArchitectureLedgerEvidenceState([]);
    const needsGitPlan = this.architectureLedger.readMode !== "ledger" || query.viewId === "drift-pressure";
    const yamlPlan = needsGitPlan ? planYamlToArchitectureLedgerImport({
      ...gitScope,
      files: listModelFiles(root),
      previousEvidenceState: emptyEvidenceState,
      createdAt: this.clock(),
      command: "archctx explorer projection"
    }) : undefined;
    if (yamlPlan && (readHeadSha(root) !== gitScope.worktree.headSha || computeWorktreeDigest(root) !== gitScope.worktree.worktreeDigest)) {
      throw new ExplorerProjectionCompileError("precondition-failed", "Explorer authority input changed during projection planning");
    }
    const ledgerMatchesGit = yamlPlan !== undefined && ledgerAuthority?.authorityCursor.graphDigest === yamlPlan.graphDigest;
    const ledgerMatchesGitScope = ledgerAuthority !== undefined
      && digestJson(ledgerAuthority.authorityCursor.repository as unknown as Json) === digestJson(gitScope.repository as unknown as Json)
      && digestJson(ledgerAuthority.authorityCursor.worktree as unknown as Json) === digestJson(gitScope.worktree as unknown as Json);
    const authoritySource = ledgerAuthority && (this.architectureLedger.readMode === "ledger" || (ledgerMatchesGit && ledgerMatchesGitScope)) ? "ledger" as const : "git" as const;
    const scope = authoritySource === "ledger" ? ledgerScope : gitScope;
    const authorityCursor: AuthorityCursorV1 | null = authoritySource === "ledger" ? ledgerAuthority!.authorityCursor : null;
    if (authoritySource === "git" && !yamlPlan) throw new ExplorerProjectionCompileError("precondition-failed", "Git authority plan is required");
    const graphDigest = authoritySource === "ledger" ? ledgerAuthority!.authorityCursor.graphDigest : yamlPlan!.graphDigest;
    const gitEvidenceState = yamlPlan ? replayArchitectureLedgerEvidenceState([yamlPlan.event]) : emptyEvidenceState;
    const evidenceAuthorityCursor = ledgerAuthority?.authorityCursor ?? null;
    const evidenceStateDigest = ledgerAuthority?.evidenceStateDigest ?? gitEvidenceState.stateDigest;
    const workspace = { root, repositoryId: scope.repository.repositoryId, headSha: scope.worktree.headSha };
    let taskSession: { taskSessionId: string; task: string; taskSessionDigest: string } | undefined;
    if (query.taskSessionId) {
      const snapshot = await this.readPracticeCheckpointBaseline(scope.repository.repositoryId, query.taskSessionId);
      if (!snapshot) {
        if (query.viewId === "task-impact") throw new ExplorerProjectionCompileError("precondition-failed", `task session not found: ${query.taskSessionId}`);
      } else if (snapshot.headSha !== scope.worktree.headSha || snapshot.worktreeDigest !== scope.worktree.worktreeDigest) {
        if (query.viewId === "task-impact") throw new ExplorerProjectionCompileError("precondition-failed", `task session is stale: ${query.taskSessionId}`);
      } else {
        taskSession = {
          taskSessionId: query.taskSessionId,
          task: snapshot.task,
          taskSessionDigest: digestJson({ taskSessionId: query.taskSessionId, snapshot } as unknown as Json)
        };
      }
    }
    const task = query.viewId === "task-impact" && taskSession ? taskSession.task : `architecture explorer ${query.viewId}`;
    let observed: NormalizedCodeContext;
    let observedAvailability: { status: "ready" | "unavailable"; reasonCode?: string } = { status: "ready" };
    try {
      await this.codeFacts.ensureReady(workspace);
      observed = await this.codeFacts.buildTaskContext({
        task,
        maxSymbols: Math.min(1000, Math.max(query.budget.maxNodes, query.budget.maxNodes * 4)),
        includeSource: false
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reasonCode = message.includes("CodeGraph index missing") ? "codegraph-index-missing" : "codegraph-unavailable";
      throw new ExplorerProjectionCompileError("precondition-failed", `required-input-unavailable:observed:${reasonCode}`);
    }
    await this.processArchitectureChangeFeed(root, scope);
    const pressureResult = observedAvailability.status === "ready" ? detectArchitecturePressure({
      task,
      symbols: observed.symbols.map((symbol) => symbol.id),
      files: observed.symbols.map((symbol) => symbol.path),
      edges: observed.edges,
      observedEvidence: observed.evidence
    }) : undefined;
    const pressure = pressureResult ? {
      inputDigest: digestJson({ task, observedFactsDigest: observed.digest, pressure: pressureResult } as unknown as Json),
      level: pressureResult.level,
      score: pressureResult.score,
      signals: pressureResult.signals.map((signal) => ({ type: signal.type, evidence: signal.evidence }))
    } : undefined;
    const readPlan = planProjectionRead(query, authoritySource === "ledger" ? "verified-ledger-current" : "git-authority");
    let plannedGraph: ArchitectureLedgerGraphState;
    let plannedBindings: ExplorerResolvedBindingV2[];
    let eventBacklinks: ArchitectureEventBacklinkV1[];
    let readSet: ExplorerProjectionV2["inputManifest"]["readSet"];
    if (authoritySource === "ledger") {
      if (!authorityCursor) throw new ExplorerProjectionCompileError("precondition-failed", "verified ledger authority cursor is required");
      const planned = await this.localStore.readExplorerProjectionInputs({ ...scope, query, plan: readPlan, authorityCursor });
      plannedGraph = planned.graph;
      plannedBindings = planned.bindings;
      eventBacklinks = planned.eventBacklinks;
      readSet = planned.readSet;
    } else {
      plannedGraph = selectProjectionGraphFromAuthority(readPlan, yamlPlan!.state);
      const selectedEntityIds = new Set(plannedGraph.entities.map((item) => item.entityId));
      const selectedSubjectIds = [
        ...plannedGraph.entities.map((item) => item.entityId),
        ...plannedGraph.relations.map((item) => item.relationId),
        ...plannedGraph.constraints.map((item) => item.constraintId)
      ];
      let metadata: { rowsRead: { bindings: number; backlinks: number }; truncated: boolean };
      if (ledgerAuthority) {
        const ledgerMetadata = await this.localStore.readExplorerProjectionMetadata({
          ...ledgerScope,
          query,
          plan: readPlan,
          authorityCursor: ledgerAuthority.authorityCursor,
          entityIds: [...selectedEntityIds],
          subjectIds: selectedSubjectIds
        });
        plannedBindings = ledgerMetadata.bindings;
        eventBacklinks = ledgerMetadata.eventBacklinks;
        metadata = ledgerMetadata;
      } else {
        const evidenceById = new Map(gitEvidenceState.evidenceItems.map((item) => [item.evidenceId, item]));
        const bindingRows = gitEvidenceState.evidenceBindings
          .filter((binding) => binding.target.kind === "entity" && selectedEntityIds.has(binding.target.id));
        plannedBindings = bindingRows.slice(0, readPlan.limits.maxBindings).flatMap((binding) => {
          const evidence = evidenceById.get(binding.evidenceId);
          return evidence?.selector.symbolId ? [{
            bindingId: binding.bindingId,
            targetEntityId: binding.target.id,
            observedSymbolId: evidence.selector.symbolId,
            verified: evidence.strength === "verified" && binding.authorityEffect !== "context-only"
          }] : [];
        });
        eventBacklinks = [];
        metadata = {
          rowsRead: { bindings: Math.min(bindingRows.length, readPlan.limits.maxBindings), backlinks: 0 },
          truncated: bindingRows.length > readPlan.limits.maxBindings
        };
      }
      const activeState = {
        entities: yamlPlan!.state.entities.filter((item) => item.status !== "removed"),
        relations: yamlPlan!.state.relations.filter((item) => item.status !== "removed"),
        constraints: yamlPlan!.state.constraints.filter((item) => item.status !== "removed")
      };
      const focusedTotals = readPlan.kind === "focused-neighborhood" && readPlan.focusSubjectId
        ? (() => {
            const neighbors = queryArchitectureLedgerBookNeighbors({
              state: yamlPlan!.state,
              id: readPlan.focusSubjectId!,
              depth: readPlan.depth,
              maxItems: activeState.entities.length + activeState.relations.length + activeState.constraints.length + 1,
              maxBytes: 100_000_000
            });
            return { entities: neighbors.nodes.length, relations: neighbors.relations.length, constraints: neighbors.constraints.length };
          })()
        : undefined;
      readSet = projectionReadSetFromGraph(readPlan, plannedGraph, {
        entities: focusedTotals?.entities ?? activeState.entities.length,
        relations: focusedTotals?.relations ?? activeState.relations.length,
        constraints: focusedTotals?.constraints ?? activeState.constraints.length
      }, {
        bindings: metadata.rowsRead.bindings,
        backlinks: metadata.rowsRead.backlinks
      }, [...activeState.entities.reduce((counts, entity) => counts.set(entity.kind, (counts.get(entity.kind) ?? 0) + 1), new Map<string, number>()).entries()]
        .map(([kind, count]) => ({ kind, count })).sort((a, b) => a.kind.localeCompare(b.kind)), metadata.truncated);
    }
    await this.localStore.recordExplorerRuntimeMetric({
      ...scope,
      metricName: "plan-rows-read",
      reasonCode: "bounded-read-plan",
      value: Object.values(readSet.rowsRead).reduce((sum, value) => sum + value, 0)
    });
    let drift: { inputDigest: string; subjectIds: string[]; reasonCodes: string[] } | undefined;
    if (yamlPlan) {
      let ledgerComparisonGraph = emptyArchitectureLedgerState();
      if (authoritySource === "ledger") {
        ledgerComparisonGraph = plannedGraph;
      } else if (ledgerAuthority) {
        const ledgerComparisonPlan = planProjectionRead(query, "verified-ledger-current");
        ledgerComparisonGraph = (await this.localStore.readExplorerProjectionInputs({
          ...ledgerScope,
          query,
          plan: ledgerComparisonPlan,
          authorityCursor: ledgerAuthority.authorityCursor
        })).graph;
      }
      const gitComparisonPlan = planProjectionRead(query, "git-authority");
      const gitComparisonGraph = selectProjectionGraphFromAuthority(gitComparisonPlan, yamlPlan.state);
      const boundedDrift = diffArchitectureLedgerBookStates({
        previousState: ledgerComparisonGraph,
        nextState: gitComparisonGraph,
        fromRef: "ledger-current",
        toRef: "git-authority",
        maxItems: readPlan.limits.maxGraphRows,
        maxBytes: 10_000_000
      });
      drift = {
        inputDigest: digestJson(boundedDrift as unknown as Json),
        subjectIds: uniqueStrings(boundedDrift.changes.map((change) => change.id)),
        reasonCodes: uniqueStrings([
          ...boundedDrift.reasonCodes,
          ...(ledgerAuthority && ledgerAuthority.authorityCursor.graphDigest !== yamlPlan.graphDigest ? ["graph-digest-mismatch"] : []),
          ...(!ledgerAuthority && yamlPlan.state.entities.length + yamlPlan.state.relations.length + yamlPlan.state.constraints.length > 0 ? ["ledger-authority-unavailable"] : [])
        ])
      };
    }
    if (yamlPlan && (readHeadSha(root) !== gitScope.worktree.headSha || computeWorktreeDigest(root) !== gitScope.worktree.worktreeDigest)) {
      throw new ExplorerProjectionCompileError("precondition-failed", "Explorer authority input changed before projection compilation");
    }
    const projectionInput = {
      query,
      repository: scope.repository,
      worktree: scope.worktree,
      authoritySource,
      authorityCursor,
      evidenceAuthorityCursor,
      graph: plannedGraph,
      graphDigest,
      evidenceStateDigest,
      readPlan,
      readSet,
      observed,
      bindings: plannedBindings,
      pressure,
      drift,
      taskSession,
      eventBacklinks,
      observedAvailability,
      tokenRequired: true
    };
    const inputManifest = compileProjectionInputManifest(projectionInput);
    let cached: ExplorerProjectionV2 | undefined;
    try {
      cached = await this.localStore.readExplorerProjectionByManifest({
        ...scope,
        manifestDigest: inputManifest.manifestDigest
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("explorer-projection-cache-")) {
        throw new ExplorerProjectionCompileError("precondition-failed", error.message);
      }
      throw error;
    }
    if (cached) return cached;
    await this.localStore.recordExplorerRuntimeMetric({ ...scope, metricName: "cache-rebuild", reasonCode: "manifest-miss", value: 1 });
    const compileStartedAt = Date.now();
    const projection = compileExplorerProjection(projectionInput);
    await this.localStore.recordExplorerRuntimeMetric({ ...scope, metricName: "compile-time-ms", reasonCode: "projection-compile", value: Date.now() - compileStartedAt });
    const previous = await this.localStore.readLatestExplorerProjection({ ...scope, viewId: projection.view.id });
    const changedDependencyKeys = previous ? explorerChangedDependencyKeys(previous, projection) : [];
    const affectedOccurrenceIds = await this.localStore.listAffectedExplorerOccurrences({ ...scope, dependencyKeys: changedDependencyKeys });
    await this.localStore.invalidateExplorerOccurrences({ ...scope, occurrenceIds: affectedOccurrenceIds });
    await this.localStore.saveExplorerProjection({
      repository: scope.repository,
      worktree: scope.worktree,
      projection,
      dependencies: explorerProjectionDependencies(projection)
    });
    this.notifyExplorerInvalidation(projection, affectedOccurrenceIds);
    return projection;
  }

  async startExplorer(root: string, options: ExplorerServerOptions = {}): Promise<JsonEnvelope> {
    return this.explorerServer.startExplorer(root, options);
  }

  async stopExplorer(): Promise<JsonEnvelope> {
    return this.explorerServer.stopExplorer();
  }

  async revokeExplorerToken(): Promise<JsonEnvelope> {
    return this.explorerServer.revokeExplorerToken();
  }

  explorerStatus(): JsonEnvelope {
    return this.explorerServer.explorerStatus();
  }

  private async closeExplorer(): Promise<void> {
    return this.explorerServer.closeExplorer();
  }

  private notifyExplorerInvalidation(projection: ExplorerProjectionV2, affectedOccurrenceIds: string[]): void {
    this.explorerServer.notifyExplorerInvalidation(projection, affectedOccurrenceIds);
  }

  private notifyExplorerAuthorityInvalidation(root: string, record: ArchitectureChangeFeedRecordV1, occurrenceIds: string[]): void {
    this.explorerServer.notifyExplorerAuthorityInvalidation(root, record, occurrenceIds);
  }

  async contextLandscape(task: string, maxSymbols = 12): Promise<JsonEnvelope> {
    return this.landscapes.contextLandscape(task, maxSymbols);
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

  private async readPracticeCheckpointBaseline(repositoryId: string, taskSessionId: string): Promise<PracticeCheckpointSnapshotV1 | undefined> {
    return this.practiceCheckpoints.readPracticeCheckpointBaseline(repositoryId, taskSessionId);
  }

  private assertRunning(): void {
    if (!this.running) throw new Error("archctxd is not running");
  }

  private async withWriter<T>(fn: () => Promise<T>): Promise<T> {
    if (this.unresolvedChangeSetJournals.length > 0) throw new ChangeSetRecoveryUnresolvedError(this.unresolvedChangeSetJournals);
    if (this.writerLocked) throw new Error("runtime writer is locked");
    this.writerLocked = true;
    try {
      return await fn();
    } finally {
      this.writerLocked = false;
    }
  }

  private async appendArchitectureEventsWithFeed(
    root: string,
    input: ArchitectureLedgerAppendInput,
    journalId?: string
  ): Promise<ArchitectureLedgerAppendResult> {
    const result = journalId
      ? await this.localStore.appendArchitectureEventsAndCommitChangeSet(journalId, input)
      : await this.localStore.appendArchitectureEvents(input);
    const scopes = new Map<string, ArchitectureLedgerScope>();
    for (const event of [...result.appendedEvents, ...result.duplicateEvents]) {
      const scope = { repository: event.repository, worktree: event.worktree };
      scopes.set(`${event.repository.storageRepositoryId}:${event.worktree.storageWorkspaceId}:${event.worktree.branch}:${event.worktree.headSha}:${event.worktree.worktreeDigest}`, scope);
    }
    for (const scope of scopes.values()) await this.processArchitectureChangeFeedAfterCommit(root, scope);
    return result;
  }

  private async processArchitectureChangeFeedAfterCommit(root: string, scope: ArchitectureLedgerScope): Promise<void> {
    const scopeDigest = digestJson(scope as unknown as Json);
    try {
      await this.processArchitectureChangeFeed(root, scope);
      this.deferredArchitectureChangeFeedFailures.delete(scopeDigest);
    } catch (error) {
      this.deferredArchitectureChangeFeedFailures.set(scopeDigest, digestJson({
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error)
      } as unknown as Json));
    }
  }

  private async processArchitectureChangeFeed(root: string, scope: ArchitectureLedgerScope): Promise<number> {
    const consumerId = "runtime-daemon.explorer-cache.v1";
    const scopeDigest = digestJson(scope as unknown as Json);
    let processed = 0;
    for (let page = 0; page < 1_000; page += 1) {
      const batch = await this.localStore.listArchitectureChangeFeed({ ...scope, consumerId, limit: 100 });
      if (batch.records.length === 0) {
        this.deferredArchitectureChangeFeedFailures.delete(scopeDigest);
        return processed;
      }
      await this.localStore.recordExplorerRuntimeMetric({
        ...scope,
        metricName: "feed-lag",
        reasonCode: "change-feed",
        value: Math.max(0, Date.parse(this.clock()) - Date.parse(batch.records[0]!.committedAt))
      });
      for (const record of batch.records) {
        const dependencyKeys = architectureChangeFeedDependencyKeys(record);
        const occurrenceIds = await this.localStore.listAffectedExplorerOccurrences({ ...scope, dependencyKeys });
        await this.localStore.invalidateExplorerOccurrences({ ...scope, occurrenceIds });
        this.notifyExplorerAuthorityInvalidation(root, record, occurrenceIds);
        processed += 1;
      }
      await this.localStore.acknowledgeArchitectureChangeFeed({
        ...scope,
        consumerId,
        feedSequence: batch.records.at(-1)!.feedSequence
      });
      if (!batch.hasMore) {
        this.deferredArchitectureChangeFeedFailures.delete(scopeDigest);
        return processed;
      }
    }
    throw new Error("architecture-change-feed-page-limit-exceeded");
  }


}

function shortDigest(digest: string): string {
  return digest.replace(/^sha256:/, "").slice(0, 16);
}

function runtimeWorktreeDigest(root: string, profile: RuntimeWorktreeDigestProfile): string {
  switch (profile) {
    case "repository":
      return computeWorktreeDigest(root);
    case "architecture-documentation-projection":
      return architectureDocumentationProjectionWorktreeDigest(root, loadNativeModelFromArchContext(root));
    default:
      throw new RuntimeUpdateInputError(`unsupported worktree digest profile: ${String(profile)}`);
  }
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

function acceptedCommittedChangeScope(root: string, worktreeDigest: string): ArchitectureLedgerScope {
  const paths = runtimeStatePaths(root);
  const headSha = readHeadSha(root);
  return {
    repository: { repositoryId: repositoryFingerprint(root), storageRepositoryId: paths.storageRepositoryId },
    worktree: {
      workspaceId: projectionWorkspaceId(root),
      storageWorkspaceId: paths.storageWorkspaceId,
      branch: readCurrentBranch(root),
      headSha,
      worktreeDigest
    }
  };
}

function acceptedCommittedChangeBinding(root: string, journal: CommittedChangeSetForTaskSession): { fileSetDigest: string } {
  if (journal.files.length === 0) throw new Error("accepted ChangeSet journal has no files");
  for (const file of journal.files) {
    const absolute = assertPathHasNoSymlinkSegments(root, file.path);
    if (file.operation === "delete") {
      if (existsSync(absolute) || file.hash !== "missing") throw new Error(`accepted ChangeSet deletion mismatch: ${file.path}`);
    } else {
      if (!existsSync(absolute) || !lstatSync(absolute).isFile()
        || digestJson({ body: readFileSync(absolute, "utf8") } as unknown as Json) !== file.hash) {
        throw new Error(`accepted ChangeSet file hash mismatch: ${file.path}`);
      }
    }
  }
  return { fileSetDigest: digestJson(journal.files as unknown as Json) };
}

class ExplorerDeltaPreconditionError extends Error {
  constructor(readonly reasonCode: ExplorerDeltaFailureReasonV2, message: string) {
    super(message);
    this.name = "ExplorerDeltaPreconditionError";
  }
}

function validateExplorerDeltaQueryV2(query: unknown): string | undefined {
  if (!query || typeof query !== "object" || Array.isArray(query)) return "Explorer delta query must be an object";
  const value = query as Record<string, unknown>;
  if (value.schemaVersion !== "archcontext.explorer-delta-query/v2") return `unsupported Explorer delta schema: ${String(value.schemaVersion)}`;
  for (const side of ["base", "head"] as const) {
    const ref = value[side];
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) return `Explorer delta ${side} cursor reference is required`;
    const record = ref as Record<string, unknown>;
    if (typeof record.eventId !== "string" || record.eventId.length === 0) return `Explorer delta ${side}.eventId is required`;
    if (typeof record.projectionDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.projectionDigest)) {
      return `Explorer delta ${side}.projectionDigest must be a sha256 digest`;
    }
  }
  return undefined;
}

function sameExplorerAuthorityCursor(actual: AuthorityCursorV1 | null, expected: AuthorityCursorV1): boolean {
  return actual !== null && digestJson(actual as unknown as Json) === digestJson(expected as unknown as Json);
}

function explorerAuthorityCursorFromReplay(
  scope: ArchitectureLedgerScope,
  replay: ArchitectureLedgerReplayResult
): AuthorityCursorV1 {
  if (!replay.cursor.lastEventId || !replay.cursor.lastEventHash) {
    throw new ExplorerProjectionCompileError("precondition-failed", "authority cursor requires a replayed event");
  }
  return {
    schemaVersion: "archcontext.authority-cursor/v1",
    repository: scope.repository,
    worktree: scope.worktree,
    eventSequence: replay.cursor.eventCount,
    eventId: replay.cursor.lastEventId,
    eventHash: replay.cursor.lastEventHash,
    graphDigest: replay.graphDigest,
    evidenceStateDigest: replay.evidenceState.stateDigest
  };
}

function validateModelFiles(files: ModelFile[]): { errors: string[]; referenceErrors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const paths = new Set(files.map((file) => file.path));
  for (const required of [".archcontext/manifest.yaml", ".archcontext/product.yaml"]) {
    if (!paths.has(required)) errors.push(`missing ${required}`);
  }
  for (const file of files) {
    if (!file.schemaVersion.startsWith("archcontext.")) errors.push(`${file.path}: missing schemaVersion`);
  }
  const adr = validateAdrAppliesTo(files);
  const constraints = readDependencyConstraints(files);
  const reviewPolicy = readReviewPolicy(files);
  errors.push(...adr.errors, ...constraints.errors, ...reviewPolicy.errors);
  return {
    errors,
    referenceErrors: [...adr.referenceErrors, ...constraints.referenceErrors],
    warnings: [...constraints.warnings, ...reviewPolicy.warnings]
  };
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

function explorerProjectionDependencies(projection: ExplorerProjectionV2): Array<{ occurrenceId: string; dependencyKeys: string[] }> {
  return projection.occurrences.map((occurrence) => ({
    occurrenceId: occurrence.occurrenceId,
    dependencyKeys: uniqueStrings([
      `graph:${projection.cursor.graphDigest}`,
      `observed:${projection.cursor.observedFactsDigest}`,
      `view:${projection.cursor.viewDefinitionDigest}`,
      ...occurrence.provenance.declaredEntityIds.map((id) => `entity:${id}`),
      ...occurrence.provenance.observedSymbolIds.map((id) => `symbol:${id}`),
      ...occurrence.provenance.evidenceBindingIds.map((id) => `binding:${id}`),
      ...occurrence.sourceSelectors.map((selector) => `path:${selector.path}`),
      ...projection.relations.filter((relation) => relation.sourceOccurrenceId === occurrence.occurrenceId || relation.targetOccurrenceId === occurrence.occurrenceId).flatMap((relation) => [
        ...relation.provenance.declaredRelationIds.map((id) => `relation:${id}`),
        ...relation.provenance.observedEdgeIds.map((id) => `edge:${id}`)
      ])
    ])
  }));
}

function architectureChangeFeedDependencyKeys(record: ArchitectureChangeFeedRecordV1): string[] {
  const keys = record.changedInputDigests.graphBefore === record.changedInputDigests.graphAfter
    ? []
    : [`graph:${record.changedInputDigests.graphBefore}`];
  for (const subject of record.affectedSubjects) {
    if (subject.subjectKind === "entity") keys.push(`entity:${subject.subjectId}`);
    else if (subject.subjectKind === "relation") keys.push(`relation:${subject.subjectId}`);
    else if (subject.subjectKind === "constraint") keys.push(`constraint:${subject.subjectId}`);
    else if (subject.subjectKind === "evidence-binding") keys.push(`binding:${subject.subjectId}`);
    else if (subject.subjectKind === "subject") {
      keys.push(`entity:${subject.subjectId}`, `relation:${subject.subjectId}`, `constraint:${subject.subjectId}`);
    }
  }
  return uniqueStrings(keys);
}

function explorerChangedDependencyKeys(base: ExplorerProjectionV2, head: ExplorerProjectionV2): string[] {
  const baseById = new Map(base.occurrences.map((occurrence) => [occurrence.occurrenceId, occurrence]));
  const headById = new Map(head.occurrences.map((occurrence) => [occurrence.occurrenceId, occurrence]));
  const keys: string[] = [];
  for (const occurrenceId of uniqueStrings([...baseById.keys(), ...headById.keys()])) {
    const before = baseById.get(occurrenceId);
    const after = headById.get(occurrenceId);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    for (const occurrence of [before, after]) {
      if (!occurrence) continue;
      keys.push(...occurrence.provenance.declaredEntityIds.map((id) => `entity:${id}`));
      keys.push(...occurrence.provenance.observedSymbolIds.map((id) => `symbol:${id}`));
      keys.push(...occurrence.provenance.evidenceBindingIds.map((id) => `binding:${id}`));
      keys.push(...occurrence.sourceSelectors.map((selector) => `path:${selector.path}`));
    }
  }
  const baseRelations = new Map(base.relations.map((relation) => [relation.occurrenceId, relation]));
  const headRelations = new Map(head.relations.map((relation) => [relation.occurrenceId, relation]));
  for (const relationId of uniqueStrings([...baseRelations.keys(), ...headRelations.keys()])) {
    const before = baseRelations.get(relationId);
    const after = headRelations.get(relationId);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    for (const relation of [before, after]) {
      if (!relation) continue;
      keys.push(...relation.provenance.declaredRelationIds.map((id) => `relation:${id}`));
      keys.push(...relation.provenance.observedEdgeIds.map((id) => `edge:${id}`));
    }
  }
  return uniqueStrings(keys);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
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
  return new ArchctxDaemon(deps, {
    compositionMode: "production",
    // Deferred into `start()`, behind store writer ownership (#160).
    ...(options.localStorePath ? {} : { legacyLocalStoreMigrationRoot: options.root ?? process.cwd() })
  });
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

/**
 * Default `clock` used when a caller does not inject one via `RuntimeDeps.clock` (an explicit
 * `clock` injection is itself one of the `blockedProductionInjections` in production mode, so this
 * default — not an injected override — is what production actually runs on). Embedded/test
 * composition keeps the historical frozen-epoch default so the hundreds of existing tests that
 * construct a daemon without overriding `clock` stay deterministic; production composition (the
 * real `archctxd` process started by `createProductionDaemon`/`archctx daemon start`) gets a real
 * wall clock instead. Before this branch existed, production always fell through to the frozen
 * epoch default too, which is why real audit runs recorded `createdAt`/`startedAt`/`completedAt`/
 * `issuedAt` as `1970-01-01T00:00:00.000Z` with `durationMs: 0` — every `this.clock()` call
 * returned the exact same constant, not just a shared placeholder value.
 */
export function runtimeDefaultClock(compositionMode: RuntimeCompositionMode): () => string {
  return compositionMode === "production" ? () => new Date().toISOString() : () => new Date(0).toISOString();
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
    writeAuthority: writeMode,
    phaseFlags: runtimeArchitectureLedgerPhaseFlags(rolloutMode, readMode, writeMode)
  };
}

function runtimeArchitectureLedgerPhaseFlags(
  rolloutMode: RuntimeArchitectureLedgerRolloutMode,
  readMode: RuntimeArchitectureLedgerReadMode,
  writeMode: RuntimeArchitectureLedgerWriteMode
): RuntimeArchitectureLedgerPhaseFlags {
  const supportedPhases: RuntimeArchitectureLedgerRolloutMode[] = ["yaml", "dual", "ledger-shadow", "ledger-authoritative"];
  const activeIndex = supportedPhases.indexOf(rolloutMode);
  return {
    schemaVersion: "archcontext.runtime-architecture-ledger-phase-flags/v1",
    activePhase: rolloutMode,
    supportedPhases,
    environment: {
      ARCHCONTEXT_LEDGER_MODE: rolloutMode,
      ARCHCONTEXT_LEDGER_READ_MODE: readMode,
      ARCHCONTEXT_LEDGER_WRITE_MODE: writeMode
    },
    safeDowngrade: {
      to: "yaml",
      environment: {
        ARCHCONTEXT_LEDGER_MODE: "yaml",
        ARCHCONTEXT_LEDGER_READ_MODE: "yaml",
        ARCHCONTEXT_LEDGER_WRITE_MODE: "yaml"
      },
      command: "archctx ledger rollback --to-yaml --write --expected-worktree-digest <current>"
    },
    promotionPath: activeIndex < 0 ? supportedPhases : supportedPhases.slice(activeIndex),
    downgradePath: activeIndex < 0 ? ["yaml"] : supportedPhases.slice(0, activeIndex + 1).reverse()
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

/** Same shape `assertArchitectureProjectionVerifiedAgainst` accepts for a stamp commit. */
const GIT_OBJECT_NAME_PATTERN = /^[0-9a-f]{7,64}$/;

/**
 * Repo-relative paths that changed between `commit` and HEAD. Fails closed: a shallow clone, an
 * unknown commit, or a missing Git binary returns `unavailable` with the Git error, so the
 * freshness gate reports "could not measure" instead of reading an unmeasurable range as "nothing
 * changed". Only committed history is compared — an uncommitted edit is work in progress, not a
 * projection that fell behind a commit.
 *
 * `commit` comes from the committed projection manifest, i.e. repository content: anything that is
 * not a hex object name is refused before Git runs, and `--end-of-options` keeps Git from ever
 * reading it as an option (`--output=…` would otherwise write through a committed symlink). Paths
 * are read NUL-framed so non-ASCII, newline, and whitespace-bearing names come back verbatim
 * instead of C-quoted or trimmed.
 */
function readChangedPathsSince(root: string, commit: string): CapabilitySourceChangeSet {
  if (!GIT_OBJECT_NAME_PATTERN.test(commit)) {
    return { status: "unavailable", reason: `refusing to measure changes since a non-hex commit: ${JSON.stringify(commit)}` };
  }
  try {
    const output = execFileSync("git", ["diff", "--name-only", "-z", "--end-of-options", `${commit}..HEAD`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return {
      status: "measured",
      paths: output.split("\0").filter((path) => path.length > 0)
    };
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    const reason = (typeof stderr === "string" ? stderr : stderr?.toString("utf8"))?.trim();
    return {
      status: "unavailable",
      reason: reason && reason.length > 0 ? reason : error instanceof Error ? error.message : String(error)
    };
  }
}


function blockedProductionInjections(deps: RuntimeDeps): string[] {
  return [
    "codeFacts",
    "codeGraphProviderFactory",
    "modelStore",
    "localStore",
    "changeSetEngine",
    "externalDocumentation",
    "clock",
    "investigationTransport",
    "githubIssueExecutor"
  ].filter((key) => key in deps);
}

function completeTaskProjectionDrift(root: string): CompleteTaskProjectionDriftInput | undefined {
  if (!existsSync(resolve(root, "docs/architecture/.projection-manifest.json"))) return undefined;
  const profile = loadArchitectureDocumentationProfile(root);
  const loaded = loadArchitectureDocumentationInputs(root, profile);
  const sourceDigest = architectureDocumentationSourceDigest({
    model: loaded.model,
    profile,
    decisions: loaded.decisions
  });
  const codeGraphInputs = prepareArchitectureDocumentationProjectionSnapshot(root, loaded.model);
  const provenance = codeGraphInputs.provenance;
  const plan = renderArchitectureDocumentationProjection({
    model: loaded.model,
    profile,
    decisions: loaded.decisions,
    existingFiles: loaded.existingFiles,
    verifiedAgainst: assertArchitectureProjectionVerifiedAgainst({
      branch: readCurrentBranch(root),
      commit: readHeadSha(root),
      committedAt: readHeadCommittedAt(root)
    }),
    sourceChangesSinceStamp: loadCapabilitySourceChangesSinceStamps(root, loaded.model),
    sourceScaleSignals: loadCapabilitySourceScaleSignals(root, loaded.model),
    importGraphs: codeGraphInputs.importGraphs,
    selectorEvidence: codeGraphInputs.selectorEvidence,
    provenance,
    sourceDigest
  });
  return {
    schemaVersion: "archcontext.complete-task-projection-drift/v1",
    ok: plan.drift.ok && plan.rejected.length === 0,
    sourceDigest: plan.sourceDigest,
    projectionDigest: plan.projectionDigest,
    rendererVersion: plan.rendererVersion,
    targetCount: plan.targets.length,
    fileCount: plan.files.length,
    driftCount: plan.drift.diffs.length,
    rejectedCount: plan.rejected.length,
    reasonCodes: [...new Set([...plan.drift.reasonCodes, ...plan.rejected.map((diff) => diff.reasonCode)])].sort()
  };
}

/**
 * Freshness half of the projection gate: the drift check above asks whether the rendered files
 * still match the model, this one asks whether the code those files describe moved after the commit
 * the projection recorded. A repository with no projection manifest has no projection to keep
 * fresh, which is why the missing-manifest case returns `undefined` here — the same short-circuit
 * `completeTaskProjectionDrift` uses — rather than a blocking finding.
 */
function completeTaskProjectionFreshness(root: string): CompleteTaskProjectionFreshnessInput | undefined {
  const manifest = loadArchitectureProjectionManifestVerifiedAgainst(root);
  if (manifest.status === "manifest-missing") return undefined;
  const model = loadNativeModelFromArchContext(root);
  return evaluateArchitectureProjectionSnapshotFreshness({
    model,
    manifest,
    changeSets: measureChangeSetsForManifestStamps(root, manifest),
    currentSourceTreeDigest: architectureDocumentationSourceTreeDigest(root, model)
  });
}

/**
 * Documents are stamped per target, so the diff baseline is per stamped commit: one
 * `git diff <commit>..HEAD` per distinct commit recorded in the manifest, never a single
 * repository-wide baseline that would judge a freshly re-verified document against an old one.
 */
function measureChangeSetsForManifestStamps(
  root: string,
  manifest: ArchitectureProjectionManifestVerifiedAgainstReadback
): CapabilitySourceChangeSetForCommit[] {
  if (manifest.status !== "present") return [];
  // Only stamps that pass the same validation the probe applies are measured; an invalid one is
  // reported by the probe as unusable provenance and must never reach Git.
  return [...new Set(manifest.nodes
    .map((entry) => validManifestStampCommit(entry.verifiedAgainst))
    .filter((commit): commit is string => commit !== undefined))]
    .sort((left, right) => left.localeCompare(right))
    .map((commit) => ({ commit, changeSet: readChangedPathsSince(root, commit) }));
}

function validManifestStampCommit(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  try {
    return assertArchitectureProjectionVerifiedAgainst(raw as ArchitectureProjectionVerifiedAgainst).commit;
  } catch {
    return undefined;
  }
}

/**
 * Stamp-lifecycle input for `renderArchitectureDocumentationProjection`: per node, did its declared
 * source change after the commit its projected document is stamped with? The renderer keeps a stamp
 * only where this says `unchanged`, so a covered source edit that happens to leave every rendered
 * assertion identical still re-verifies the document instead of pinning it to a commit it was never
 * checked against — which is what the freshness gate would otherwise be unable to clear.
 *
 * The Git read lives here because `@archcontext/core` does not spawn processes; every caller that
 * renders the documentation projection (daemon drift gate, CLI `docs`, readback scripts) goes
 * through this one function so the measurement can never differ between them.
 */
export function loadCapabilitySourceChangesSinceStamps(root: string, model: NativeModel): CapabilitySourceChangeSinceStamp[] {
  const manifest = loadArchitectureProjectionManifestVerifiedAgainst(root);
  return capabilitySourceChangesSinceStamps({
    model,
    manifest,
    changeSets: measureChangeSetsForManifestStamps(root, manifest)
  });
}
