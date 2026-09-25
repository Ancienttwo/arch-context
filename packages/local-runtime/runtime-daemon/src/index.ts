import { isArchContextGeneratedProjectionPath } from "@archcontext/local-runtime/projection-paths";
import { LedgerAdminService } from "./ledger-admin";
import { AuditService, AUDIT_APPROVE_GH_TOKEN_ENV, type RuntimeAuditRunInput, type RuntimeAuditApproveInput } from "./audit";
export { AUDIT_RUN_DEFAULT_TIMEOUT_MS, AUDIT_APPROVE_GH_TOKEN_ENV, type RuntimeAuditRunInput, type RuntimeAuditApproveInput } from "./audit";
import { ProjectionApplyService } from "./projection-apply";
import { runArchitectureDocsProjectionCommand, runAgentContextProjectionCommand, runProjectionProtocolCommand, validateProjectionInvocation, projectionInvocationWrites, assertProjectionInvocationSnapshot, validateDocsProjectionInput, validateAgentContextProjectionInput, type RuntimeDocsProjectionInput, type RuntimeAgentContextProjectionInput, type RuntimeProjectionInvocation, type ProjectionServiceHost } from "./projection-service";
import { readCurrentBranch, readHeadCommittedAt } from "./projection-inputs";
export type { RuntimeDocsProjectionInput, RuntimeAgentContextProjectionInput, RuntimeProjectionInvocation } from "./projection-service";
import { DeveloperReviewRunService, type DeveloperReviewRunStatus, type DeveloperReviewRunManifest, type DeveloperReviewRun, type DeveloperReviewRunPreparation, type DeveloperReviewRunCleanup, type DeveloperReviewRunCleanupRequest, type DeveloperReviewRunRecovery } from "./developer-review-run";
export type { DeveloperReviewRunStatus, DeveloperReviewRunManifest, DeveloperReviewRun, DeveloperReviewRunPreparation, DeveloperReviewRunCleanup, DeveloperReviewRunCleanupRequest, DeveloperReviewRunRecovery } from "./developer-review-run";
import type { RuntimeDaemonClient } from "./rpc-protocol";
import { ChangeSetRecoveryUnresolvedError } from "./changeset-recovery-error";
import { isLoopbackRemote, writeJson } from "./loopback-http";
export { DEFAULT_DAEMON_IDLE_TIMEOUT_MS, RUNTIME_RPC_MAX_REQUEST_BODY_BYTES, RUNTIME_RPC_REQUEST_BODY_TIMEOUT_MS, type RuntimeRpcServerOptions, ArchctxRuntimeRpcServer } from "./rpc-server";
export { type DaemonControlRecoveryReason, type DaemonControlRecovery, defaultDaemonControlDir, defaultDeveloperReviewRunStateDir, defaultDaemonConnectionPath, defaultDaemonLockPath, readRuntimeRpcConnectionFile, runtimeRpcCompatibilityIssue, readRuntimeRpcConnection, createRuntimeRpcClientFromConnectionFile, recoverStaleDaemonControlFiles } from "./daemon-control";
export { ChangeSetRecoveryUnresolvedError } from "./changeset-recovery-error";
export * from "./rpc-client";
export * from "./rpc-protocol";
import { matchesLoopbackAuthority, matchesSecret } from "./loopback-auth";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import {
  addRepositoryToLandscape,
  bindRepository,
  canonicalRepositoryRoot,
  computeReviewWorktreeDigest,
  computeWorktreeDigest,
  createLandscape,
  landscapeDigest,
  readDependencyConstraints,
  readReviewPolicy,
  repositoryFingerprint,
  validateAdrAppliesTo,
  validateLandscape,
  type Landscape,
  type RepositoryRegistration
} from "@archcontext/core/architecture-domain";
import { assertPathHasNoSymlinkSegments, ChangeSetEngine, writeFileWithoutFollowingSymlinks, type ChangeOperation, type ChangeSetDraft } from "@archcontext/core/changeset-engine";
import {
  assertArchitectureLedgerPersistenceSafe,
  architectureLedgerBookSubjects,
  architectureLedgerPayload,
  architectureLedgerStateDigest,
  architectureLedgerProjectionDigest,
  compareArchitectureLedgerStateToYaml,
  diffArchitectureLedgerBookStates,
  emptyArchitectureLedgerState,
  planChangeSetApplyToArchitectureLedgerEvent,
  planYamlToArchitectureLedgerImport,
  projectArchitectureLedgerStateToYamlFiles,
  queryArchitectureLedgerBook,
  queryArchitectureLedgerBookEvidence,
  queryArchitectureLedgerBookNeighbors,
  queryArchitectureLedgerBookRecommendations,
  queryArchitectureLedgerBookTimeline,
  replayArchitectureLedgerEvidenceState,
  replayArchitectureLedgerEvents,
  showArchitectureLedgerBookSubject,
  type ArchitectureAuditRunV1,
  type ArchitectureLedgerAppendInput,
  type ArchitectureLedgerAppendResult,
  type ArchitectureLedgerReplayResult,
  type ArchitectureLedgerScope,
  type ArchitectureLedgerGraphState,
  type RecommendationLedgerRecordV1
} from "@archcontext/core/architecture-ledger";
import { compileArchitectureFactChanges, compileEvidenceStateChanges } from "@archcontext/core/architecture-delta";
import {
  RECOMMENDATION_SCHEDULER_ENGINE_VERSION,
  aggregateRecommendationLifecycleMetrics,
  createRecommendationFeedback,
  recommendationLifecycleLedgerPayload,
  transitionRecommendationLifecycle,
  type RecommendationFeedbackAction,
  type RecommendationFeedbackSource
} from "@archcontext/core/recommendation-engine";
import {
  RefactorAssessmentRegistry,
  buildRefactorRecordEvent,
  refactorClassifierRulesetDigest,
  refactorProposalAuthorPairIssues,
  type RegisteredRefactorAssessmentV1
} from "./refactor-recording";
import {
  REPOSITORY_REFACTOR_REQUEST,
  RefactorScanError,
  evaluateReviewDependencyConstraints,
  runRefactorScan,
  type RefactorScanResultV1
} from "./refactor-scan";
import {
  baselineSnapshotForRecommendation,
  findResolutionEvidence,
  refactorVerifyIngressIssues,
  resolutionEvidenceForRecommendation,
  runRefactorVerify,
  type RuntimeRefactorVerifyInput
} from "./refactor-verify";
import { checkpointTask, prepareTask } from "@archcontext/core/application";
import { buildInvestigationContextBundleFromLedgerQuery, createInvestigationAgentJob, investigationReportProposalValidationDigest, planRuntimeAgentQueueControls, type AgentInvestigationRunMetadata, type CommandInvestigationRunnerTransport, type InvestigationReportProposalPlan } from "@archcontext/core/agent-orchestrator";
import { loadPracticeCatalog, practiceCatalogEnvelope, type PracticeCatalogCommandInput } from "@archcontext/core/practice-catalog";
import { evaluatePracticeEnforcement, loadPracticeEnforcementPolicy, loadPracticeWaiverOwnerRegistry, loadPracticeWaivers, shouldEvaluatePracticeEnforcement, validatePracticeWaiver } from "@archcontext/core/practice-engine";
import { reconcileArchitectureLedgerDrift } from "@archcontext/core/reconcile-engine";
import { detectArchitecturePressure } from "@archcontext/core/pressure-engine";
import { agentContextProjectionTargetPaths, architectureDocumentationProjectionWorktreeDigest, architectureDocumentationSourceDigest, architectureDocumentationSourceTreeDigest, assertArchitectureProjectionVerifiedAgainst, capabilitySourceChangesSinceStamps, evaluateArchitectureProjectionSnapshotFreshness, loadArchitectureDocumentationInputs, loadArchitectureDocumentationProfile, loadArchitectureProjectionManifestVerifiedAgainst, loadCapabilitySourceScaleSignals, loadNativeModelFromArchContext, renderArchitectureDocumentationProjection, type ArchitectureProjectionManifestVerifiedAgainstReadback, type ArchitectureProjectionVerifiedAgainst, type CapabilitySourceChangeSet, type CapabilitySourceChangeSetForCommit, type CapabilitySourceChangeSinceStamp, type NativeModel } from "@archcontext/core/projection-engine";
import { renderExplorerHtml } from "@archcontext/local-runtime/explorer-html";
import { completeTaskGate, type CompleteTaskInput, type CompleteTaskProjectionDriftInput, type CompleteTaskProjectionFreshnessInput } from "@archcontext/core/review-engine";
import { CodeGraphAdapter, CodeGraphCliProvider, MultiRepoCodeGraphAdapter, prepareArchitectureDocumentationProjectionSnapshot, type CodeGraphProvider } from "@archcontext/local-runtime/codegraph-adapter";
import { CONTEXT7_ENABLED_ENV, CONTEXT7_MODE_ENV, Context7ExternalDocumentationAdapter, assertContext7LibraryId, assertContext7Version, buildContext7Query } from "@archcontext/local-runtime/context7-adapter";
import { compileLandscapeTaskContext, compileTaskContext, finalizeContextBudgetMetadata, type ArchitectureContextLedgerPort } from "@archcontext/core/context-compiler";
import { CONTEXT7_LOCKFILE_SCHEMA_VERSION, EXPLORER_VIEW_IDS, assertNoCallerProvidedAttestationFields, attestationV2Digest, baseModelBlockingErrors, canonicalAttestationV2, createAttestationV2, digestJson, errorEnvelope, okEnvelope, productVersionManifest, type AgentJobV1, type ArchitectureActorKind, type ArchitectureChangeFeedRecordV1, type ArchitectureEventBacklinkV1, type ArchitectureEventV1, type AttestationResult, type AttestationV2, type AuthorityCursorV1, type CodeFactsPort, type CodeFactsSnapshot, type Context7LibraryPinV1, type Context7LockfileV1, type DevicePrivateKeySignerPort, type EvidenceStateAtCursorV1, type ExplorerDeltaFailureReasonV2, type ExplorerDeltaQueryV2, type ExplorerProjectionDeltaV2, type ExplorerProjectionQueryV2, type ExplorerProjectionV2, type ExplorerServiceContract, type ExternalDocumentationCacheEntry, type ExternalDocumentationFetchInput, type ExternalDocumentationPort, type ExternalDocumentationProvider, type ExternalDocumentationResourceV1, type InvestigationContextRisk, type InvestigationContextUncertainty, type Json, type JsonEnvelope, type ModelStorePort, type ModelValidationResult, type NormalizedCodeContext, type PracticeCheckpointEvent, type PracticeCheckpointSnapshotV1, type PracticeWaiverV1, type ProjectionApplyReceiptV1, type RecommendationFeedbackV1, type RecommendationRunV1, type RepositorySnapshot, type ReviewChallengeV2, type WorkspaceRef } from "@archcontext/contracts";
import { type ProjectionRequestV1, type ProjectionApplyRecoveryIntentV1 } from "@archcontext/contracts";
import { RECOMMENDATION_V3_SCHEMA_VERSION, REFACTOR_EXECUTION_EVIDENCE_KINDS, REFACTOR_EXECUTION_EVIDENCE_LOCATOR_PATTERN, REFACTOR_EXECUTION_EVIDENCE_LOCATOR_RULE, REFACTOR_VERIFICATION_REQUEST_KEYS, REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION, refactorScanInvariantIssues, refactorVerificationRequestInvariantIssues, type RecommendationV3, type RefactorExecutionEvidenceRefV1, type RefactorProposalPayloadV1, type RefactorResolutionEvidenceV1, type RefactorRequestV1, type StructuralObservationPayloadV1 } from "@archcontext/contracts";
import { computeGitChangeFingerprint, findRepositoryRoot, readCommitChangeMetadata, readHeadSha, readStagedChangeMetadata, readTrackedSourceFiles, readTrackedTreeEntries, readWorktreeChangeMetadata, verifyDetachedReviewWorktree, type DetachedReviewWorktree, type DetachedReviewWorktreePreparation, type GitChangeMetadata, type GitChangeSource } from "@archcontext/local-runtime/git-adapter";
import { defaultLocalStorePath, migrateLegacyLocalStoreIfNeeded, runtimeStatePaths, SqliteLocalStore, type RuntimeAgentJobRecord, type RuntimeLocalStore, type UnresolvedChangeSetJournal } from "@archcontext/local-runtime/local-store-sqlite";
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

const RUNTIME_AGENT_HOOK_DEFAULT_MAX_QUEUED_JOBS = 32;
const RUNTIME_AGENT_HOOK_DEFAULT_PRIORITY = 0;
const RUNTIME_AGENT_JOB_DEFAULT_MAX_RUNNING_JOBS = 1;
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

export interface RuntimeBookInput {
  command?: "status" | "query" | "show" | "neighbors" | "timeline" | "diff" | "evidence" | "recommendations" | "export";
  id?: string;
  query?: string;
  task?: string;
  explain?: boolean;
  depth?: number;
  fromRef?: string;
  toRef?: string;
  sinceRef?: string;
  openOnly?: boolean;
  format?: "yaml" | "markdown" | "json";
  maxItems?: number;
  maxBytes?: number;
}

export interface RuntimeRecommendationInput {
  command: "metrics" | RecommendationFeedbackAction;
  recommendationId?: string;
  reason?: string;
  /**
   * `resolve` on a non-practice category requires resolution evidence: the gate looks the digest
   * up in the replayed evidence state and rejects it when unrecorded, verified at a different
   * HEAD, verified over a different worktree digest, or carrying a disposition other than
   * resolved. `refactor verify` writes those records.
   */
  evidenceDigest?: string;
  actor?: string;
  actorKind?: ArchitectureActorKind;
  source?: RecommendationFeedbackSource;
  expectedWorktreeDigest?: string;
  agentJobId?: string;
  now?: string;
}

export interface RuntimeAgentJobEnqueueGitInput {
  source?: GitChangeSource;
  ref?: string;
  baseRef?: string;
  event?: string;
  taskSessionId?: string;
  analysisKind?: string;
  risk?: InvestigationContextRisk;
  uncertainty?: InvestigationContextUncertainty;
  policyRequestedInvestigation?: boolean;
  coalesceKey?: string;
  contextMaxItems?: number;
  cooldownMs?: number;
  debounceUntil?: string;
  maxAttempts?: number;
  priority?: number;
  maxQueuedJobs?: number;
  runnerPort?: AgentJobV1["runnerPort"];
  codeFactsDigest?: string;
  generatedProjection?: boolean;
  skipGeneratedProjection?: boolean;
}

export interface RuntimeAgentJobClaimRpcInput {
  workerId: string;
  leaseMs?: number;
  now?: string;
  maxRunningJobs?: number;
}

export interface RuntimeAgentJobCompleteRpcInput {
  jobId: string;
  status: Extract<AgentJobV1["status"], "succeeded" | "failed">;
  workerId?: string;
  outputDigest?: string;
  runMetadata?: AgentInvestigationRunMetadata;
  proposalPlan?: InvestigationReportProposalPlan;
  error?: string;
  now?: string;
}

export interface RuntimeAgentJobRetryRpcInput {
  jobId: string;
  reason?: string;
  now?: string;
}

export interface RuntimeAgentJobCancelRpcInput {
  jobId: string;
  status?: Extract<AgentJobV1["status"], "cancelled" | "superseded" | "expired">;
  reason?: string;
  supersededByJobId?: string;
  now?: string;
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
  reviewAt: string;
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

export interface RuntimeLedgerMigrateInput {
  fromYaml?: boolean;
  recommendationV3?: boolean;
  dryRun?: boolean;
  expectedWorktreeDigest?: string;
}

export interface RuntimeRefactorScanInput {
  /** Absent means the default repository-scope request; the daemon never invents a proposal. */
  request?: RefactorRequestV1;
}

export interface RuntimeRefactorRecordInput {
  assessmentDigest: string;
  expectedWorktreeDigest: string;
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
  phaseFlags: RuntimeArchitectureLedgerPhaseFlags;
}

export interface RuntimeArchitectureLedgerPhaseFlags {
  schemaVersion: "archcontext.runtime-architecture-ledger-phase-flags/v1";
  activePhase: RuntimeArchitectureLedgerRolloutMode;
  supportedPhases: RuntimeArchitectureLedgerRolloutMode[];
  environment: {
    ARCHCONTEXT_LEDGER_MODE: RuntimeArchitectureLedgerRolloutMode;
    ARCHCONTEXT_LEDGER_READ_MODE: RuntimeArchitectureLedgerReadMode;
    ARCHCONTEXT_LEDGER_WRITE_MODE: RuntimeArchitectureLedgerWriteMode;
  };
  safeDowngrade: {
    to: "yaml";
    environment: {
      ARCHCONTEXT_LEDGER_MODE: "yaml";
      ARCHCONTEXT_LEDGER_READ_MODE: "yaml";
      ARCHCONTEXT_LEDGER_WRITE_MODE: "yaml";
    };
    command: "archctx ledger rollback --to-yaml --write --expected-worktree-digest <current>";
  };
  promotionPath: RuntimeArchitectureLedgerRolloutMode[];
  downgradePath: RuntimeArchitectureLedgerRolloutMode[];
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

export type RuntimeWorktreeDigestProfile = "repository" | "architecture-documentation-projection";

export interface RuntimePlanUpdateInput {
  id: string;
  approvalChannel?: "mcp";
  operations: ChangeOperation[];
  reason?: { taskSessionId: string; interventionId?: string };
  worktreeDigestPrecondition?: {
    profile: "architecture-documentation-projection";
    expectedDigest: string;
  };
}

/** Issued only by the explicit local CLI approval flow, never by an MCP tool. */
export interface RuntimeMcpApprovalInput {
  id: string;
  expectedWorktreeDigest: string;
  expectedChangeSetDigest: string;
}

export interface RuntimeMcpApplyInput {
  id: string;
  expectedWorktreeDigest: string;
  approvalToken: string;
}

export interface RuntimeApplyUpdateInput {
  id: string;
  approved: boolean;
  expectedWorktreeDigest: string;
  worktreeDigestProfile?: RuntimeWorktreeDigestProfile;
  projectionApplyReceipt?: ProjectionApplyReceiptV1;
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

class RuntimeRefactorInputError extends Error {}

/** Same shape check as `runtimeUpdateInputRecord`, reported under the refactor surface. */
function runtimeRefactorInputRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeRefactorInputError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * An RPC param is untyped JSON until something checks it, and the dispatch table only casts.
 * Only an absent `request` means "scan the repository": `null`, an array or a scalar is a caller
 * that meant something the daemon cannot honour, and answering it with the default scan would
 * report a measurement of a request nobody asked for.
 */
function decodeRuntimeRefactorScanInput(value: unknown): RuntimeRefactorScanInput {
  const input = runtimeRefactorInputRecord(value, "refactor scan input");
  if (input.request === undefined) return {};
  const request = runtimeRefactorInputRecord(input.request, "refactor scan request");
  return { request: request as unknown as RefactorRequestV1 };
}

function decodeRuntimeRefactorRecordInput(value: unknown): RuntimeRefactorRecordInput {
  const input = runtimeRefactorInputRecord(value, "refactor record input");
  if (typeof input.assessmentDigest !== "string" || input.assessmentDigest.length === 0) {
    throw new RuntimeRefactorInputError("refactor record assessmentDigest must be a non-empty string");
  }
  if (typeof input.expectedWorktreeDigest !== "string" || input.expectedWorktreeDigest.length === 0) {
    throw new RuntimeRefactorInputError("refactor record expectedWorktreeDigest must be a non-empty string");
  }
  // Nothing downstream reads a selection: recording replays every planned recommendation. Taking
  // one and ignoring it would report a subset the caller asked for and record the whole proposal.
  if (input.selection !== undefined) {
    throw new RuntimeRefactorInputError("refactor record does not support selection; every planned recommendation is recorded");
  }
  return {
    assessmentDigest: input.assessmentDigest,
    expectedWorktreeDigest: input.expectedWorktreeDigest
  };
}

/**
 * `recommendationId` is the only required subject: verify always measures whatever is at HEAD now.
 * `expectedHeadSha`/`expectedWorktreeDigest` are a caller's claim about the state it believes it
 * is verifying, and a claim that no longer holds must be refused rather than answered with fresh
 * numbers under the old identity.
 *
 * The per-field decoding stays here because it rebuilds the request from exactly the declared keys
 * and names the offending one; the frozen
 * `refactorVerificationRequestInvariantIssues` then re-proves the rebuilt request. Every ingress —
 * CLI `--request-json`, RPC dispatch, an in-process caller — therefore passes the same gate.
 */
function decodeRuntimeRefactorVerifyInput(value: unknown): RuntimeRefactorVerifyInput {
  const input = runtimeRefactorInputRecord(value, "refactor verify input");
  // The rebuild below reads only the declared keys, so an undeclared one would be dropped in
  // silence: `expectedWorktreeDigset` would remove the caller's freshness claim instead of
  // failing it. This is the last place the typo is still visible.
  const unknownKeys = Object.keys(input)
    .filter((key) => !(REFACTOR_VERIFICATION_REQUEST_KEYS as readonly string[]).includes(key))
    .sort();
  if (unknownKeys.length > 0) {
    throw new RuntimeRefactorInputError(`refactor verify input has unsupported key(s): ${unknownKeys.join(", ")}`);
  }
  if (typeof input.recommendationId !== "string" || input.recommendationId.trim() === "") {
    throw new RuntimeRefactorInputError("refactor verify recommendationId must be a non-empty string");
  }
  for (const field of ["expectedHeadSha", "expectedWorktreeDigest"] as const) {
    const claim = input[field];
    if (claim !== undefined && (typeof claim !== "string" || claim.length === 0)) {
      throw new RuntimeRefactorInputError(`refactor verify ${field} must be a non-empty string`);
    }
  }
  const request: RuntimeRefactorVerifyInput = {
    schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
    recommendationId: input.recommendationId,
    ...(typeof input.expectedHeadSha === "string" ? { expectedHeadSha: input.expectedHeadSha } : {}),
    ...(typeof input.expectedWorktreeDigest === "string" ? { expectedWorktreeDigest: input.expectedWorktreeDigest } : {}),
    ...(input.executionEvidenceRefs === undefined
      ? {}
      : { executionEvidenceRefs: decodeRuntimeExecutionEvidenceRefs(input.executionEvidenceRefs) })
  };
  if (input.schemaVersion !== REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION) {
    throw new RuntimeRefactorInputError(
      `refactor verify schemaVersion must be ${REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION}, received ${JSON.stringify(input.schemaVersion)}`
    );
  }
  const issues = refactorVerificationRequestInvariantIssues(request, "refactor verify request");
  if (issues.length > 0) throw new RuntimeRefactorInputError(issues.join("; "));
  return request;
}

/**
 * Verify evidence refs are digest-bound into the ledger, so the decoder rebuilds every element
 * from exactly the three declared fields. A caller key that rode through a cast (`rawDiff`,
 * `apiKey`) would be persisted under an envelope that promises `privacy.rawDiffPersisted: false`,
 * and the frozen invariant check only inspects `sha256` and `locator` — it would never see it.
 */
function decodeRuntimeExecutionEvidenceRefs(value: unknown): RefactorExecutionEvidenceRefV1[] {
  if (!Array.isArray(value)) {
    throw new RuntimeRefactorInputError("refactor verify executionEvidenceRefs must be an array");
  }
  return value.map((entry, index) => {
    const field = `refactor verify executionEvidenceRefs[${index}]`;
    const ref = runtimeRefactorInputRecord(entry, field);
    const extras = Object.keys(ref).filter((key) => key !== "kind" && key !== "locator" && key !== "sha256");
    if (extras.length > 0) {
      throw new RuntimeRefactorInputError(`${field} has unsupported key(s): ${[...extras].sort().join(", ")}`);
    }
    const { kind, locator, sha256 } = ref;
    if (typeof kind !== "string" || !(REFACTOR_EXECUTION_EVIDENCE_KINDS as readonly string[]).includes(kind)) {
      throw new RuntimeRefactorInputError(
        `${field}.kind must be one of ${REFACTOR_EXECUTION_EVIDENCE_KINDS.join(", ")}, received ${JSON.stringify(kind)}`
      );
    }
    if (typeof locator !== "string" || locator.trim() === "") {
      throw new RuntimeRefactorInputError(`${field}.locator must be a non-empty string`);
    }
    // A locator is a reference, not a body: unbounded, it is the one string field on a record
    // whose envelope promises `privacy.rawDiffPersisted: false`, so a raw diff or a credential
    // could be parked in it and every digest would still agree.
    if (!REFACTOR_EXECUTION_EVIDENCE_LOCATOR_PATTERN.test(locator)) {
      throw new RuntimeRefactorInputError(`${field}.locator ${REFACTOR_EXECUTION_EVIDENCE_LOCATOR_RULE}`);
    }
    if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new RuntimeRefactorInputError(`${field}.sha256 must be a bare SHA-256 hex digest`);
    }
    return { kind: kind as RefactorExecutionEvidenceRefV1["kind"], locator, sha256 };
  });
}

/**
 * The two fields `refactor record` binds a measurement to. A scan reads HEAD blobs, workspace
 * manifests and the code index after it captures the identity, and a record replays the ledger
 * after it validates one, so both have a window in which the tree can move underneath them.
 */
function movedWorktreeIdentityFields(
  captured: { headSha: string; worktreeDigest: string },
  live: { headSha: string; worktreeDigest: string }
): string[] {
  const moved: string[] = [];
  if (captured.headSha !== live.headSha) moved.push("headSha");
  if (captured.worktreeDigest !== live.worktreeDigest) moved.push("worktreeDigest");
  return moved;
}

interface ExplorerServerSession {
  server: Server;
  root: string;
  host: "127.0.0.1";
  port: number;
  token: string;
  expiresAt: number;
  revoked: boolean;
  sseClients: Set<ServerResponse>;
  expiryTimer?: ReturnType<typeof setTimeout>;
  lastProjectionDigest?: string;
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

export class ArchctxDaemon implements RuntimeDaemonClient {
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
  private readonly investigationTransport: CommandInvestigationRunnerTransport;
  private readonly githubIssueExecutor: GithubIssueExecutorPort;
  private readonly clock: () => string;
  private readonly ledgerAdmin: LedgerAdminService;
  private readonly auditService: AuditService;
  private readonly projectionApplies: ProjectionApplyService;
  private readonly developerReviewRuns: DeveloperReviewRunService;
  private readonly maxRepoSessions: number;
  private readonly composition: RuntimeCompositionReport;
  private readonly sessions = new Map<string, RepositorySession>();
  private readonly checkpointBaselines = new Map<string, PracticeCheckpointSnapshotV1>();
  private readonly checkpointCoalesced = new Map<string, CheckpointCoalesceEntry>();
  private readonly changesets = new Map<string, ChangeSetDraft>();
  private readonly changeSetRoots = new Map<string, string>();
  private readonly mcpChangeSets = new Set<string>();
  private readonly mcpApprovals = new Map<string, { scope: "changeset"; root: string; id: string; draftDigest: string; worktreeDigest: string; expiresAt: number } | { scope: "projection"; root: string; invocationDigest: string; expiresAt: number }>();
  private readonly changeSetWorktreeDigestProfiles = new Map<string, RuntimeWorktreeDigestProfile>();
  private readonly deferredArchitectureChangeFeedFailures = new Map<string, string>();
  private readonly refactorAssessments = new RefactorAssessmentRegistry();
  // Tracks the AbortController for every audit job's in-flight (foreground or detached
  // background) investigation, keyed by jobId, so `stop()` can abort real `claude` subprocesses
  // rather than leaving them running orphaned past the daemon's own lifetime.
  private readonly auditRunAbortControllers = new Map<string, AbortController>();
  private landscape?: Landscape;
  private explorer?: ExplorerServerSession;
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
        )
      }
    });
    this.devicePrivateKeySigner = deps.devicePrivateKeySigner;
    this.investigationTransport = deps.investigationTransport ?? createNodeInvestigationTransport();
    this.githubIssueExecutor = deps.githubIssueExecutor ?? createNodeGithubIssueExecutor();
    this.clock = deps.clock ?? runtimeDefaultClock(options.compositionMode ?? "embedded");
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
    this.composition = runtimeCompositionReport(deps, options.compositionMode ?? "embedded", this.architectureLedger);
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
      await this.restoreLandscape();
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
      this.checkpointBaselines.clear();
      this.checkpointCoalesced.clear();
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
    this.assertRunning();
    const session = await this.openSession(root);
    const result = await prepareTask({
      workspace: session.workspace,
      task,
      codeFacts: this.codeFacts,
      modelStore: this.readModelStore,
      architectureLedger: this.runtimeArchitectureLedgerContextPort(root),
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
      architectureLedger: this.runtimeArchitectureLedgerContextPort(root),
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

  async jobsEnqueueGitHook(root: string, input: RuntimeAgentJobEnqueueGitInput = {}): Promise<JsonEnvelope> {
    this.assertRunning();
    const repositoryRoot = findRepositoryRoot(root);
    const session = await this.openSession(repositoryRoot);
    const scope = await this.architectureLedgerScope(repositoryRoot);
    const source = input.source ?? "worktree";
    const metadata = readGitChangeMetadata(repositoryRoot, source, input);
    const analysisKind = input.analysisKind ?? "architecture-delta";
    if (shouldSkipGeneratedProjectionJob(metadata, input)) {
      return okEnvelope("jobs.enqueueGitHook", {
        schemaVersion: "archcontext.runtime-agent-job-skip/v1",
        skipped: true,
        enqueued: false,
        reasonCode: "archcontext-generated-projection",
        event: input.event ?? source,
        source,
        change: metadata,
        analysisKind,
        expiredJobIds: [],
        hook: {
          failOpen: false,
          egress: "none",
          network: "forbidden"
        }
      } as unknown as Json);
    }
    if (metadata.paths.length === 0) {
      return okEnvelope("jobs.enqueueGitHook", {
        schemaVersion: "archcontext.runtime-agent-job-skip/v1",
        skipped: true,
        enqueued: false,
        reasonCode: "no-changed-paths",
        event: input.event ?? source,
        source,
        change: metadata,
        analysisKind,
        expiredJobIds: [],
        hook: {
          failOpen: false,
          egress: "none",
          network: "forbidden"
        }
      } as unknown as Json);
    }
    const now = this.clock();
    const codeFactsDigestValue = input.codeFactsDigest
      ?? session.codeFactsDigest
      ?? digestJson({
        schemaVersion: "archcontext.git-hook-codefacts-fallback/v1",
        source,
        headSha: metadata.headSha,
        metadataDigest: metadata.metadataDigest
      } as unknown as Json);
    const fingerprint = computeGitChangeFingerprint({
      repositoryId: scope.repository.storageRepositoryId,
      baseSha: metadata.baseSha ?? scope.worktree.headSha,
      headSha: metadata.headSha,
      paths: metadata.paths,
      codeFactsDigest: codeFactsDigestValue,
      analysisKind
    });
    const jobWorktree = {
      ...scope.worktree,
      headSha: metadata.headSha
    };
    const ledgerState = await this.localStore.readArchitectureLedgerState(scope);
    const taskSessionId = input.taskSessionId ?? "task_runtime_agent";
    const trigger = { source: "git_hook" as const, reason: input.event ?? source };
    const risk = runtimeInvestigationRisk(input.risk ?? (metadata.paths.length > 0 ? "medium" : "low"));
    const uncertainty = runtimeInvestigationUncertainty(input.uncertainty ?? "high");
    const context = buildInvestigationContextBundleFromLedgerQuery({
      repository: scope.repository,
      worktree: jobWorktree,
      taskSessionId,
      fingerprint,
      trigger,
      risk,
      uncertainty,
      summary: `${analysisKind} investigation for ${metadata.paths.length} changed path(s).`,
      ledger: {
        graphDigest: architectureLedgerStateDigest(ledgerState),
        entities: ledgerState.entities,
        relations: ledgerState.relations,
        constraints: ledgerState.constraints,
        evidenceBindings: [],
        candidateChanges: [],
        maxItems: input.contextMaxItems ?? 12
      },
      extensions: {
        gitChange: {
          source,
          event: input.event ?? source,
          metadataDigest: metadata.metadataDigest,
          pathCount: metadata.paths.length,
          changedPaths: metadata.paths
            .slice(0, input.contextMaxItems ?? 12)
            .map((path) => ({ path: path.path, status: path.status, rawStatus: path.rawStatus })),
          omittedPathCount: Math.max(0, metadata.paths.length - (input.contextMaxItems ?? 12))
        },
        codeFactsDigest: codeFactsDigestValue,
        analysisKind
      } as Record<string, Json>
    });
    const promptTemplateDigest = digestJson({
        schemaVersion: "archcontext.runtime-agent-job-prompt-template/v1",
        analysisKind
      } as unknown as Json);
    const job = createInvestigationAgentJob({
      repository: scope.repository,
      worktree: jobWorktree,
      taskSessionId,
      fingerprint,
      trigger,
      risk,
      uncertainty,
      deterministicAnalysisFound: metadata.paths.length > 0,
      policyRequestedInvestigation: input.policyRequestedInvestigation === true,
      documentationSynthesisUseful: true,
      budgetUsage: { taskRuns: 0, repositoryRunsToday: 0, totalRunsToday: 0 },
      now,
      policy: {
        adapterEnabled: true,
        maxRunsPerTask: 1,
        maxRunsPerRepositoryPerDay: 4,
        cooldownMs: input.cooldownMs ?? 0
      },
      jobId: runtimeAgentJobId(fingerprint, context.inputDigest, now),
      runnerPort: input.runnerPort ?? "codex",
      inputDigest: context.inputDigest,
      promptTemplateDigest
    });
    const queuePlan = planRuntimeAgentQueueControls({
      job,
      analysisKind,
      now,
      coalesceKey: input.coalesceKey,
      cooldownMs: input.cooldownMs,
      maxQueuedJobs: input.maxQueuedJobs ?? RUNTIME_AGENT_HOOK_DEFAULT_MAX_QUEUED_JOBS,
      priority: input.priority ?? RUNTIME_AGENT_HOOK_DEFAULT_PRIORITY
    });
    const jobWithContext: AgentJobV1 = {
      ...job,
      extensions: {
        ...(job.extensions ?? {}),
        investigationContext: context as unknown as Json,
        queuePlanDigest: digestJson(queuePlan as unknown as Json)
      }
    };
    const expired = await this.localStore.cancelStaleRuntimeAgentJobs({
      ...scope,
      headSha: scope.worktree.headSha,
      worktreeDigest: scope.worktree.worktreeDigest,
      now,
      reason: "enqueue-newer-git-hook-job"
    });
    const enqueue = await this.localStore.enqueueRuntimeAgentJob({
      job: jobWithContext,
      analysisKind: queuePlan.enqueue.analysisKind,
      coalesceKey: queuePlan.enqueue.coalesceKey,
      maxAttempts: input.maxAttempts,
      debounceUntil: input.debounceUntil ?? queuePlan.enqueue.debounceUntil,
      priority: queuePlan.enqueue.priority,
      maxQueuedJobs: queuePlan.enqueue.maxQueuedJobs
    });
    return okEnvelope("jobs.enqueueGitHook", {
      ...enqueue,
      change: metadata,
      codeFactsDigest: codeFactsDigestValue,
      analysisKind,
      expiredJobIds: expired.map((record) => record.job.jobId)
    } as unknown as Json);
  }

  async jobsList(root: string, input: { statuses?: AgentJobV1["status"][] } = {}): Promise<JsonEnvelope> {
    this.assertRunning();
    const scope = await this.architectureLedgerScope(findRepositoryRoot(root));
    const jobs = await this.localStore.listRuntimeAgentJobs({ ...scope, statuses: input.statuses });
    return okEnvelope("jobs.list", { jobs, count: jobs.length } as unknown as Json);
  }

  async jobsStats(root: string, input: { now?: string } = {}): Promise<JsonEnvelope> {
    this.assertRunning();
    const scope = await this.architectureLedgerScope(findRepositoryRoot(root));
    const stats = await this.localStore.queueStatsRuntimeAgentJobs({ ...scope, now: input.now ?? this.clock() });
    return okEnvelope("jobs.stats", stats as unknown as Json);
  }

  async jobsClaim(root: string, input: RuntimeAgentJobClaimRpcInput): Promise<JsonEnvelope> {
    this.assertRunning();
    if (!input.workerId) return errorEnvelope("jobs.claim", "AC_SCHEMA_INVALID", "jobs.claim requires workerId");
    const scope = await this.architectureLedgerScope(findRepositoryRoot(root));
    const job = await this.localStore.claimRuntimeAgentJob({
      ...scope,
      workerId: input.workerId,
      leaseMs: input.leaseMs ?? 60_000,
      now: input.now ?? this.clock(),
      maxRunningJobs: input.maxRunningJobs ?? RUNTIME_AGENT_JOB_DEFAULT_MAX_RUNNING_JOBS
    });
    return okEnvelope("jobs.claim", { job } as unknown as Json);
  }

  async jobsComplete(root: string, input: RuntimeAgentJobCompleteRpcInput): Promise<JsonEnvelope> {
    this.assertRunning();
    try {
      assertArchitectureLedgerPersistenceSafe({
        ...(input.runMetadata === undefined ? {} : { runMetadata: input.runMetadata }),
        ...(input.error === undefined ? {} : { error: input.error }),
        ...(input.proposalPlan === undefined ? {} : { proposalPlan: input.proposalPlan })
      } as unknown as Json, "jobs.complete");
    } catch (error) {
      return errorEnvelope("jobs.complete", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : "Unsafe job completion payload");
    }
    const repositoryRoot = findRepositoryRoot(root);
    const scope = await this.architectureLedgerScope(repositoryRoot);
    const jobs = await this.localStore.listRuntimeAgentJobs(scope);
    const record = jobs.find((candidate) => candidate.job.jobId === input.jobId);
    if (!record) return runtimeAgentJobOutOfScopeEnvelope("jobs.complete", input.jobId);
    if (record.job.status !== "running") {
      return errorEnvelope(
        "jobs.complete",
        "AC_PRECONDITION_FAILED",
        `runtime agent job completion requires a running job: ${input.jobId}`
      );
    }
    if (input.status === "succeeded") {
      // Mirrors cancelStaleRuntimeAgentJobs's own stalePolicy gate: a job that opted into
      // "advisory-only-on-stale" (e.g. archctx audit run's multi-minute investigation, which can
      // legitimately outlive a worktree digest shift from something as small as an untracked
      // .archcontext/ directory changing) must not be silently self-cancelled here either — this
      // check is a second, independent staleness enforcement point from that sweep, and both must
      // agree on the same policy or a stalePolicy override is only half-honored.
      if (record.job.stalePolicy === "cancel-on-head-change" && isRuntimeAgentJobCursorStale(record.job, scope)) {
        await this.localStore.cancelRuntimeAgentJob({
          ...scope,
          jobId: input.jobId,
          status: "expired",
          now: input.now ?? this.clock(),
          reason: "stale-head-or-worktree"
        });
        return errorEnvelope(
          "jobs.complete",
          "AC_CONTEXT_STALE",
          `runtime agent job is stale for current HEAD/worktree: ${input.jobId}`
        );
      }
    }
    if (input.proposalPlan) {
      const validation = validateRuntimeAgentProposalPlan({
        proposalPlan: input.proposalPlan,
        job: record.job,
        jobId: input.jobId,
        outputDigest: input.outputDigest
      });
      if (!validation.ok) return errorEnvelope("jobs.complete", "AC_SCHEMA_INVALID", validation.reason);
    }
    const runMetadata = input.proposalPlan
      ? {
        ...(input.runMetadata ?? {}),
        proposalPlan: input.proposalPlan
      } as unknown as Json
      : input.runMetadata as unknown as Json | undefined;
    const job = await this.localStore.completeRuntimeAgentJob({
      ...scope,
      jobId: input.jobId,
      status: input.status,
      workerId: input.workerId,
      outputDigest: input.outputDigest,
      runMetadata,
      error: input.error,
      now: input.now ?? this.clock()
    });
    return okEnvelope("jobs.complete", { job } as unknown as Json);
  }

  async jobsRetry(root: string, input: RuntimeAgentJobRetryRpcInput): Promise<JsonEnvelope> {
    this.assertRunning();
    const scope = await this.architectureLedgerScope(findRepositoryRoot(root));
    if (!(await this.runtimeAgentJobInScope(scope, input.jobId))) {
      return runtimeAgentJobOutOfScopeEnvelope("jobs.retry", input.jobId);
    }
    const job = await this.localStore.retryRuntimeAgentJob({
      ...scope,
      jobId: input.jobId,
      reason: input.reason,
      now: input.now ?? this.clock()
    });
    return okEnvelope("jobs.retry", { job } as unknown as Json);
  }

  async jobsCancel(root: string, input: RuntimeAgentJobCancelRpcInput): Promise<JsonEnvelope> {
    this.assertRunning();
    const scope = await this.architectureLedgerScope(findRepositoryRoot(root));
    if (!(await this.runtimeAgentJobInScope(scope, input.jobId))) {
      return runtimeAgentJobOutOfScopeEnvelope("jobs.cancel", input.jobId);
    }
    const job = await this.localStore.cancelRuntimeAgentJob({
      ...scope,
      jobId: input.jobId,
      status: input.status ?? "cancelled",
      reason: input.reason,
      supersededByJobId: input.supersededByJobId,
      now: input.now ?? this.clock()
    });
    return okEnvelope("jobs.cancel", { job } as unknown as Json);
  }

  /**
   * Resolves `jobId` inside the caller's own repository/worktree scope. The store rejects
   * out-of-scope mutations by throwing; resolving first lets the RPC surface answer with an error
   * envelope instead of an exception, and keeps a cross-repository job ID indistinguishable from an
   * unknown one.
   */
  private async runtimeAgentJobInScope(scope: ArchitectureLedgerScope, jobId: string): Promise<RuntimeAgentJobRecord | undefined> {
    const jobs = await this.localStore.listRuntimeAgentJobs(scope);
    return jobs.find((candidate) => candidate.job.jobId === jobId);
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
        const pin = {
          libraryId: input.libraryId,
          version: input.version,
          pinnedAt: this.clock(),
          source: "manual" as const
        };
        if (!input.approved) {
          return okEnvelope("docs.pin", {
            schemaVersion: "archcontext.context7-pin-preview/v1",
            approved: false,
            path: CONTEXT7_LOCKFILE,
            lock: upsertContext7Pin(readContext7LockfileState(session.workspace.root).lock, pin)
          } as unknown as Json);
        }
        // The approved pin writes a tracked `.archcontext/` file, so it is a writer like any other
        // (#172: refused while ChangeSet recovery is unresolved).
        return await this.withWriter(async () => {
          const current = readContext7LockfileState(session.workspace.root);
          const lock = upsertContext7Pin(current.lock, pin);
          writeContext7Lockfile(session.workspace.root, lock, current.expectedHash);
          return okEnvelope("docs.pin", {
            schemaVersion: "archcontext.context7-pin/v1",
            approved: true,
            path: CONTEXT7_LOCKFILE,
            lock
          } as unknown as Json);
        });
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
      const code = error instanceof ChangeSetRecoveryUnresolvedError ? "AC_PRECONDITION_FAILED" : "AC_SCHEMA_INVALID";
      return errorEnvelope(`docs.${input.command}`, code, error instanceof Error ? error.message : String(error));
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
    this.assertRunning();
    const command = input.command ?? "status";
    const readback = await this.architectureLedgerReadback(root);
    const scope = { repository: readback.repository, worktree: readback.worktree };
    const replayMode = ["query", "timeline", "diff", "evidence", "recommendations"].includes(command) ? "genesis" as const : "anchored" as const;
    const replay = await this.localStore.replayArchitectureLedger({ ...scope, mode: replayMode });
    const state = readback.state;
    const projectedFiles = projectArchitectureLedgerStateToYamlFiles(state);
    const freshness = {
      schemaVersion: "archcontext.book-freshness/v1",
      generatedAt: this.clock(),
      repository: readback.repository,
      worktree: readback.worktree,
      readAuthority: readback.readAuthority,
      headSha: readback.worktree.headSha,
      worktreeDigest: readback.worktree.worktreeDigest,
      graphDigest: readback.graphDigest,
      projectionDigest: architectureLedgerProjectionDigest(projectedFiles),
      ledgerCursor: {
        eventCount: replay.cursor.eventCount,
        lastEventId: replay.cursor.lastEventId,
        lastEventHash: replay.cursor.lastEventHash
      }
    };
    const provenance = {
      schemaVersion: "archcontext.book-provenance/v1",
      source: "architecture-ledger",
      producer: "runtime-daemon",
      readAuthority: freshness.readAuthority,
      repositoryId: readback.repository.repositoryId,
      storageRepositoryId: readback.repository.storageRepositoryId,
      workspaceId: readback.worktree.workspaceId,
      storageWorkspaceId: readback.worktree.storageWorkspaceId,
      branch: readback.worktree.branch,
      headSha: freshness.headSha,
      worktreeDigest: freshness.worktreeDigest,
      graphDigest: freshness.graphDigest,
      projectionDigest: freshness.projectionDigest,
      ledgerCursor: freshness.ledgerCursor,
      generatedAt: freshness.generatedAt
    };
    const budget = {
      maxItems: input.maxItems,
      maxBytes: input.maxBytes
    };
    if (command === "status") {
      return okEnvelope("book.status", {
        schemaVersion: "archcontext.book-status/v1",
        freshness,
        provenance,
        architectureLedger: readback.architectureLedger,
        counts: {
          entities: state.entities.length,
          relations: state.relations.length,
          constraints: state.constraints.length,
          events: replay.cursor.eventCount
        },
        drift: {
          ok: readback.drift.ok,
          reasonCodes: readback.drift.reasonCodes,
          reconcileRequired: !readback.reconcile.ok
        },
        commands: ["status", "query", "show", "neighbors", "timeline", "diff", "evidence", "recommendations", "export"]
      } as unknown as Json);
    }
    if (command === "query") {
      const query = input.task ?? input.query;
      const ftsMatches = query ? await this.localStore.queryArchitectureLedgerFts({
        ...scope,
        query,
        maxItems: input.maxItems
      }) : [];
      return okEnvelope("book.query", {
        ...queryArchitectureLedgerBook({ state, events: replay.events, query, ftsMatches, explain: input.explain, ...budget }),
        freshness,
        provenance
      } as unknown as Json);
    }
    if (command === "show") {
      if (!input.id) return errorEnvelope("book.show", "AC_SCHEMA_INVALID", "book show requires <entity-id> or --id");
      const result = showArchitectureLedgerBookSubject(state, input.id);
      if (!result.found) return errorEnvelope("book.show", "AC_SCHEMA_INVALID", `Book subject not found: ${input.id}`);
      return okEnvelope("book.show", { ...result, freshness, provenance } as unknown as Json);
    }
    if (command === "neighbors") {
      if (!input.id) return errorEnvelope("book.neighbors", "AC_SCHEMA_INVALID", "book neighbors requires <entity-id> or --id");
      const depth = input.depth ?? 1;
      const neighborhoodState = await this.localStore.readArchitectureLedgerNeighborhood({ ...scope, id: input.id, depth });
      return okEnvelope("book.neighbors", {
        ...queryArchitectureLedgerBookNeighbors({ state: neighborhoodState, id: input.id, depth, ...budget }),
        freshness,
        provenance
      } as unknown as Json);
    }
    if (command === "timeline") {
      const sinceRef = input.sinceRef ? await architectureBookResolveTimelineSinceRef(this.localStore, scope, replay.events, input.sinceRef) : undefined;
      if (input.sinceRef && !sinceRef) return errorEnvelope("book.timeline", "AC_SCHEMA_INVALID", `Book timeline --since ref not found: ${input.sinceRef}`);
      return okEnvelope("book.timeline", {
        ...queryArchitectureLedgerBookTimeline({
          events: replay.events,
          ...(input.id ? { subjectId: input.id } : {}),
          ...(sinceRef ? { sinceEventId: sinceRef.sinceEventId } : {}),
          ...budget
        }),
        freshness,
        provenance
      } as unknown as Json);
    }
    if (command === "diff") {
      const fromRef = input.fromRef ?? "empty";
      const toRef = input.toRef ?? "current";
      const fromResolved = await architectureBookResolveRef(this.localStore, scope, replay.events, fromRef);
      const toResolved = await architectureBookResolveRef(this.localStore, scope, replay.events, toRef);
      if (!fromResolved) return errorEnvelope("book.diff", "AC_SCHEMA_INVALID", `Book diff --from ref not found: ${fromRef}`);
      if (!toResolved) return errorEnvelope("book.diff", "AC_SCHEMA_INVALID", `Book diff --to ref not found: ${toRef}`);
      return okEnvelope("book.diff", {
        ...diffArchitectureLedgerBookStates({
          previousState: fromResolved.state,
          nextState: toResolved.state,
          fromRef,
          toRef,
          events: toResolved.events,
          ...budget
        }),
        freshness,
        provenance
      } as unknown as Json);
    }
    if (command === "evidence") {
      if (!input.id) return errorEnvelope("book.evidence", "AC_SCHEMA_INVALID", "book evidence requires <finding-or-entity-id> or --id");
      return okEnvelope("book.evidence", {
        ...queryArchitectureLedgerBookEvidence({ events: replay.events, id: input.id, ...budget }),
        freshness,
        provenance
      } as unknown as Json);
    }
    if (command === "recommendations") {
      // Lifecycle readback describes the current checkout; provenance retains the ledger scope.
      const gitScope = await this.architectureLedgerGitScope(root);
      return okEnvelope("book.recommendations", {
        ...queryArchitectureLedgerBookRecommendations({ events: replay.events, openOnly: input.openOnly, explain: input.explain, ...budget }),
        freshness: {
          ...freshness,
          repository: gitScope.repository,
          worktree: gitScope.worktree,
          headSha: gitScope.worktree.headSha,
          worktreeDigest: gitScope.worktree.worktreeDigest
        },
        provenance
      } as unknown as Json);
    }
    if (command === "export") {
      const format = input.format ?? "json";
      if (!["json", "yaml", "markdown"].includes(format)) return errorEnvelope("book.export", "AC_SCHEMA_INVALID", "book export --format must be json, yaml, or markdown");
      return okEnvelope("book.export", {
        schemaVersion: "archcontext.book-export/v1",
        format,
        freshness,
        provenance,
        ...(format === "json" ? { state } : {}),
        ...(format === "yaml" ? { projectedFiles } : {}),
        ...(format === "markdown" ? { markdown: architectureBookMarkdown(state) } : {})
      } as unknown as Json);
    }
    return errorEnvelope("book", "AC_SCHEMA_INVALID", "book requires status|query|show|neighbors|timeline|diff|evidence|recommendations|export");
  }

  async recommendations(root: string, input: RuntimeRecommendationInput): Promise<JsonEnvelope> {
    this.assertRunning();
    const repositoryRoot = findRepositoryRoot(root);
    const command = input.command;
    const readMetrics = async () => {
      const scope = await this.architectureLedgerScope(repositoryRoot);
      const replay = await this.localStore.replayArchitectureLedger({ ...scope, mode: "genesis" });
      const artifacts = recommendationArtifactsFromEvents(replay.events);
      return okEnvelope("recommendations.metrics", {
        ...aggregateRecommendationLifecycleMetrics({
          recommendationRuns: artifacts.recommendationRuns,
          recommendations: artifacts.recommendations,
          feedback: artifacts.feedback,
          generatedAt: input.now ?? this.clock()
        }),
        freshness: {
          schemaVersion: "archcontext.recommendation-lifecycle-freshness/v1",
          repository: scope.repository,
          worktree: scope.worktree,
          ledgerCursor: {
            eventCount: replay.cursor.eventCount,
            lastEventId: replay.cursor.lastEventId,
            lastEventHash: replay.cursor.lastEventHash
          },
          graphDigest: replay.graphDigest
        }
      } as unknown as Json);
    };
    if (command === "metrics") return readMetrics();
    if (!isRecommendationLifecycleCliAction(command)) {
      return errorEnvelope("recommendations", "AC_SCHEMA_INVALID", "recommendations requires acknowledge|accept|reject|defer|waive|resolve|metrics");
    }
    if (!input.recommendationId) {
      return errorEnvelope(`recommendations.${command}`, "AC_SCHEMA_INVALID", `recommendations ${command} requires --id`);
    }
    if (!input.reason?.trim()) {
      return errorEnvelope(`recommendations.${command}`, "AC_SCHEMA_INVALID", `recommendations ${command} requires --reason`);
    }

    return this.withWriter(async () => {
      if (input.expectedWorktreeDigest) {
        this.assertFreshWorktree(repositoryRoot, input.expectedWorktreeDigest, `recommendations ${command}`);
      }
      const now = input.now ?? this.clock();
      const scope = await this.architectureLedgerScope(repositoryRoot);
      const replay = await this.localStore.replayArchitectureLedger({ ...scope, mode: "genesis" });
      const artifacts = recommendationArtifactsFromEvents(replay.events);
      const current = latestRecommendationById(artifacts.recommendations, input.recommendationId!);
      if (!current) {
        return errorEnvelope(`recommendations.${command}`, "AC_SCHEMA_INVALID", `recommendation not found: ${input.recommendationId}`);
      }
      let gatedWorktree: { headSha: string; worktreeDigest: string } | undefined;
      if (command === "resolve") {
        // The live HEAD, not the ledger scope's: the stored scope carries the identity of the last
        // appended event, and resolving is a claim about the tree that is here now.
        const liveScope = await this.architectureLedgerGitScope(repositoryRoot);
        gatedWorktree = liveScope.worktree;
        const gate = refactorResolveGate(current, input.evidenceDigest, replay.evidenceState, liveScope.worktree);
        if (gate) return errorEnvelope(`recommendations.${command}`, gate.code, gate.message, gate.reasonCode);
      }
      let next: RecommendationLedgerRecordV1;
      try {
        next = transitionRecommendationLifecycle(current, {
          action: command,
          now,
          actor: input.actor ?? "developer",
          reason: input.reason
        });
      } catch (error) {
        return errorEnvelope(
          `recommendations.${command}`,
          "AC_PRECONDITION_FAILED",
          error instanceof Error ? error.message : String(error)
        );
      }
      if (next.status === current.status) {
        return errorEnvelope(
          `recommendations.${command}`,
          "AC_PRECONDITION_FAILED",
          `recommendation lifecycle no-op: ${current.status}->${next.status}`
        );
      }
      const feedback = createRecommendationFeedback({
        repository: scope.repository,
        worktree: scope.worktree,
        previous: current,
        next,
        action: command,
        now,
        actorId: input.actor ?? "developer",
        actorKind: recommendationActorKind(input),
        source: input.source ?? "cli",
        reason: input.reason!.trim(),
        ...(input.agentJobId ? { agentJobId: input.agentJobId } : {})
      });
      const inputDigest = digestJson({
        schemaVersion: "archcontext.recommendation-lifecycle-event-input/v1",
        recommendationId: current.recommendationId,
        runId: current.runId,
        action: command,
        previousStatus: current.status,
        nextStatus: next.status,
        feedbackId: feedback.feedbackId,
        graphDigest: replay.graphDigest
      } as unknown as Json);
      const event: ArchitectureEventV1 = {
        schemaVersion: "archcontext.architecture-event/v1",
        eventId: `architecture_event.recommendation_lifecycle.${shortDigest(inputDigest)}`,
        eventType: "architecture.recommendation.lifecycle",
        payloadVersion: "archcontext.recommendation-feedback/v1",
        repository: scope.repository,
        worktree: scope.worktree,
        baseDigest: replay.graphDigest,
        resultingDigest: replay.graphDigest,
        headSha: scope.worktree.headSha,
        actor: { kind: feedback.actor.kind, id: feedback.actor.id },
        source: "manual",
        timestamp: now,
        idempotencyKey: `architecture-ledger-recommendation-lifecycle:${feedback.feedbackId}:${current.status}:${next.status}`,
        provenance: {
          producer: "runtime-daemon",
          command: `archctx recommendations ${command}`,
          inputDigest
        },
        payload: {
          ...recommendationLifecycleLedgerPayload({ recommendation: next, feedback }),
          title: `Recommendation ${command}`,
          summary: `Recommendation ${current.recommendationId} transitioned from ${current.status} to ${next.status}.`,
          recommendationLifecycle: {
            schemaVersion: "archcontext.recommendation-lifecycle-transition/v1",
            recommendationId: current.recommendationId,
            runId: current.runId,
            action: command,
            previousStatus: current.status,
            nextStatus: next.status,
            feedbackId: feedback.feedbackId
          }
        } as unknown as Json
      };
      // The gate read the tree before the transition and the event were built. Resolving binds a
      // verdict to a HEAD *and* a worktree digest, so the tree is re-read here, inside the writer,
      // and a move between the two reads closes the record against a state nobody verified.
      if (gatedWorktree) {
        const preAppendScope = await this.architectureLedgerGitScope(repositoryRoot);
        const moved = movedWorktreeIdentityFields(gatedWorktree, preAppendScope.worktree);
        if (moved.length > 0) {
          return errorEnvelope(
            `recommendations.${command}`,
            "AC_REFACTOR_STALE",
            `worktree ${moved.join(" and ")} changed before the recommendations resolve append; run archctx refactor verify again`,
            "evidence-head-drift"
          );
        }
      }
      const append = await this.appendArchitectureEventsWithFeed(root, {
        writer: "runtime-daemon",
        events: [event]
      });
      const metrics = aggregateRecommendationLifecycleMetrics({
        recommendationRuns: artifacts.recommendationRuns,
        recommendations: [...artifacts.recommendations, next],
        feedback: [...artifacts.feedback, feedback],
        generatedAt: now
      });
      return okEnvelope(`recommendations.${command}`, {
        schemaVersion: "archcontext.runtime-recommendation-lifecycle/v1",
        action: command,
        recommendationId: current.recommendationId,
        previousStatus: current.status,
        nextStatus: next.status,
        recommendation: next,
        feedback,
        metrics,
        append: {
          status: "appended",
          appendedEventCount: append.appendedEvents.length,
          duplicateEventCount: append.duplicateEvents.length,
          graphDigest: append.graphDigest,
          entityCount: append.entityCount,
          relationCount: append.relationCount,
          constraintCount: append.constraintCount
        },
        privacy: {
          writes: "architecture-ledger-event-only",
          rawSourcePersisted: false,
          rawDiffPersisted: false,
          promptPersisted: false,
          implicitAcceptance: false
        }
      } as unknown as Json);
    });
  }

  /**
   * Measures the repository and classifies one refactor request against it, then registers the
   * pair so `refactorRecord` can append exactly what was measured here.
   *
   * Read-only and clock-free: no event is appended, and both `createdAt` fields come from the
   * HEAD committer date, so two scans at the same HEAD return byte-identical envelopes. The
   * proposed recommendations are a preview of what `refactor record` would write; `record`
   * re-plans under the daemon clock and is the only path that persists anything.
   */
  async refactorScan(root: string, rawInput: RuntimeRefactorScanInput = {}): Promise<JsonEnvelope> {
    this.assertRunning();
    let input: RuntimeRefactorScanInput;
    try {
      input = decodeRuntimeRefactorScanInput(rawInput);
    } catch (error) {
      if (error instanceof RuntimeRefactorInputError) return errorEnvelope("refactor.scan", "AC_SCHEMA_INVALID", error.message);
      throw error;
    }
    const repositoryRoot = findRepositoryRoot(root);
    const request = input.request ?? REPOSITORY_REFACTOR_REQUEST;
    // Two different scopes, deliberately. `gitScope` is the tree as it is right now and is the
    // only identity `refactor record` will accept, because that is the authority its freshness
    // check reads. `storageScope` is where the ledger keeps this workspace's events, anchored to
    // the last event's identity, and is the only key a replay can find them under.
    const gitScope = await this.architectureLedgerGitScope(repositoryRoot);
    const storageScope = await this.localStore.resolveArchitectureLedgerScope(gitScope);
    const replay = await this.localStore.replayArchitectureLedger({ ...storageScope, mode: "genesis" });
    const artifacts = recommendationArtifactsFromEvents(replay.events);
    let result: RefactorScanResultV1;
    try {
      result = runRefactorScan({
        root: repositoryRoot,
        request,
        repository: gitScope.repository,
        worktree: gitScope.worktree,
        previousRecommendations: artifacts.recommendations,
        catalogDigest: refactorClassifierRulesetDigest(RECOMMENDATION_SCHEDULER_ENGINE_VERSION)
      });
    } catch (error) {
      if (error instanceof RefactorScanError) return errorEnvelope("refactor.scan", error.code, error.message);
      return errorEnvelope("refactor.scan", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
    }
    // Every input above was read after `gitScope` was captured. If the tree moved while it was
    // being read, the measurement belongs to no single state, so nothing is published and
    // nothing is registered: `refactor record` must never be handed a mixed-state assessment.
    const liveScope = await this.architectureLedgerGitScope(repositoryRoot);
    const movedDuringScan = movedWorktreeIdentityFields(gitScope.worktree, liveScope.worktree);
    if (movedDuringScan.length > 0) {
      return errorEnvelope(
        "refactor.scan",
        "AC_REFACTOR_STALE",
        `worktree ${movedDuringScan.join(" and ")} changed while refactor scan was reading the repository; run refactor scan again`
      );
    }
    this.registerRefactorAssessment({
      snapshot: result.snapshot,
      assessment: result.assessment,
      ...(result.proposal ? { proposal: result.proposal } : {}),
      headSha: gitScope.worktree.headSha,
      worktreeDigest: gitScope.worktree.worktreeDigest
    });
    return okEnvelope("refactor.scan", {
      schemaVersion: "archcontext.runtime-refactor-scan/v1",
      repository: gitScope.repository,
      worktree: gitScope.worktree,
      requestId: result.requestId,
      request,
      trackedFileCount: result.trackedFileCount,
      snapshot: result.snapshot,
      assessment: result.assessment,
      ...(result.proposal ? { proposal: result.proposal } : {}),
      proposedRecommendations: result.proposedRecommendations,
      suppressed: result.suppressed,
      recordCommand: `archctx refactor record --assessment-digest ${result.assessment.assessmentDigest} --expected-worktree-digest ${gitScope.worktree.worktreeDigest}`,
      privacy: {
        writes: "none",
        rawSourcePersisted: false,
        rawDiffPersisted: false,
        promptPersisted: false
      }
    } as unknown as Json);
  }

  /**
   * In-process only, never dispatched: a scan's measured snapshot and assessment stay inside the
   * daemon, so `refactorRecord` binds them to the HEAD they were measured at instead of trusting
   * an RPC caller to resubmit a measurement the daemon never made.
   */
  registerRefactorAssessment(input: RegisteredRefactorAssessmentV1): string {
    this.assertRunning();
    return this.refactorAssessments.register(input);
  }

  async refactorRecord(root: string, rawInput: RuntimeRefactorRecordInput): Promise<JsonEnvelope> {
    this.assertRunning();
    let input: RuntimeRefactorRecordInput;
    try {
      input = decodeRuntimeRefactorRecordInput(rawInput);
    } catch (error) {
      if (error instanceof RuntimeRefactorInputError) return errorEnvelope("refactor.record", "AC_SCHEMA_INVALID", error.message);
      throw error;
    }
    const repositoryRoot = findRepositoryRoot(root);
    return this.withWriter(async () => {
      const registered = this.refactorAssessments.get(input.assessmentDigest);
      if (!registered) {
        return errorEnvelope(
          "refactor.record",
          "AC_SCHEMA_INVALID",
          `refactor assessment not found: ${input.assessmentDigest}; run refactor scan again`
        );
      }
      try {
        this.assertFreshWorktree(repositoryRoot, input.expectedWorktreeDigest, "refactor record");
      } catch (error) {
        return errorEnvelope("refactor.record", "AC_REFACTOR_STALE", error instanceof Error ? error.message : String(error));
      }
      // Same authority as `assertFreshWorktree` above: the measurement must belong to the tree
      // that is here now, not to whatever identity the last stored event happens to carry.
      const gitScope = await this.architectureLedgerGitScope(repositoryRoot);
      if (registered.headSha !== gitScope.worktree.headSha || registered.worktreeDigest !== gitScope.worktree.worktreeDigest) {
        return errorEnvelope(
          "refactor.record",
          "AC_REFACTOR_STALE",
          `refactor assessment ${input.assessmentDigest} was measured at a different worktree state; run refactor scan again`
        );
      }
      // The event still lands in the ledger scope the workspace's prior events live in, so the
      // chain and its replay stay one continuous log. Deferred to 0.6.0: decoupling that ledger
      // partition key from the identity the event itself carries.
      const scope = await this.localStore.resolveArchitectureLedgerScope(gitScope);
      if (registered.proposal) {
        const authorIssues = refactorProposalAuthorPairIssues(registered.proposal.authoredBy);
        if (authorIssues.length > 0) {
          return errorEnvelope("refactor.record", "AC_REFACTOR_PROPOSAL_UNAUTHORED", authorIssues.join("; "));
        }
      }
      const scanIssues = refactorScanInvariantIssues({
        snapshot: registered.snapshot,
        assessment: registered.assessment,
        ...(registered.proposal ? { proposal: registered.proposal } : {})
      });
      if (scanIssues.length > 0) return errorEnvelope("refactor.record", "AC_SCHEMA_INVALID", scanIssues.join("; "));

      const replay = await this.localStore.replayArchitectureLedger({ ...scope, mode: "genesis" });
      const artifacts = recommendationArtifactsFromEvents(replay.events);
      let built: ReturnType<typeof buildRefactorRecordEvent>;
      try {
        built = buildRefactorRecordEvent({
          repository: scope.repository,
          worktree: scope.worktree,
          registered,
          previousRecommendations: artifacts.recommendations,
          evidenceState: replay.evidenceState,
          graphDigest: replay.graphDigest,
          catalogDigest: refactorClassifierRulesetDigest(RECOMMENDATION_SCHEDULER_ENGINE_VERSION),
          now: this.clock()
        });
      } catch (error) {
        return errorEnvelope("refactor.record", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
      }
      // The identity check above happened before the replay and the event build; the tree can
      // still move in between. Last look before anything is persisted, so a stale measurement
      // fails closed instead of being appended under an identity the repository no longer has.
      const preAppendScope = await this.architectureLedgerGitScope(repositoryRoot);
      const movedBeforeAppend = movedWorktreeIdentityFields(registered, preAppendScope.worktree);
      if (movedBeforeAppend.length > 0) {
        return errorEnvelope(
          "refactor.record",
          "AC_REFACTOR_STALE",
          `worktree ${movedBeforeAppend.join(" and ")} changed before the refactor record append; run refactor scan again`
        );
      }
      const append = await this.appendArchitectureEventsWithFeed(root, {
        writer: "runtime-daemon",
        events: [built.event]
      });
      return okEnvelope("refactor.record", {
        schemaVersion: "archcontext.runtime-refactor-record/v1",
        repository: gitScope.repository,
        worktree: gitScope.worktree,
        assessmentDigest: registered.assessment.assessmentDigest,
        runId: built.plan.run.runId,
        catalogDigest: built.plan.run.catalogDigest,
        scale: registered.assessment.scale,
        recommendationIds: built.plan.recommendations.map((recommendation) => recommendation.recommendationId),
        recommendations: built.plan.recommendations,
        evidenceItemIds: built.plan.evidenceItems.map((item) => item.evidenceId),
        suppressed: built.plan.suppressed,
        append: {
          status: "appended",
          eventSource: built.event.source,
          appendedEventCount: append.appendedEvents.length,
          duplicateEventCount: append.duplicateEvents.length,
          graphDigest: append.graphDigest,
          entityCount: append.entityCount,
          relationCount: append.relationCount,
          constraintCount: append.constraintCount
        },
        privacy: {
          writes: "architecture-ledger-event-only",
          rawSourcePersisted: false,
          rawDiffPersisted: false,
          promptPersisted: false
        }
      } as unknown as Json);
    });
  }

  /**
   * Re-measures the repository at the current HEAD and records what that measurement says about
   * one already-recorded recommendation.
   *
   * The verdict is never this method's: `runRefactorVerify` evaluates it against the frozen
   * validator and throws rather than emit one the validator disagrees with. Everything here is
   * the surrounding fail-closed frame — freshness, migration state, ingress shape, and the
   * append — plus the two arms that record nothing at all: a recommendation already in a terminal
   * status, and a verdict identical to one the ledger already holds.
   */
  async refactorVerify(root: string, rawInput: RuntimeRefactorVerifyInput): Promise<JsonEnvelope> {
    this.assertRunning();
    let input: RuntimeRefactorVerifyInput;
    try {
      input = decodeRuntimeRefactorVerifyInput(rawInput);
    } catch (error) {
      if (error instanceof RuntimeRefactorInputError) return errorEnvelope("refactor.verify", "AC_SCHEMA_INVALID", error.message);
      throw error;
    }
    const repositoryRoot = findRepositoryRoot(root);
    return this.withWriter(async () => {
      // Optional, unlike `refactor record`: verify always measures what is at HEAD now, so an
      // absent claim is a verification of the current tree rather than a missing precondition.
      if (input.expectedWorktreeDigest) {
        try {
          this.assertFreshWorktree(repositoryRoot, input.expectedWorktreeDigest, "refactor verify");
        } catch (error) {
          return errorEnvelope("refactor.verify", "AC_REFACTOR_STALE", error instanceof Error ? error.message : String(error));
        }
      }
      const gitScope = await this.architectureLedgerGitScope(repositoryRoot);
      if (input.expectedHeadSha !== undefined && input.expectedHeadSha !== gitScope.worktree.headSha) {
        return errorEnvelope(
          "refactor.verify",
          "AC_REFACTOR_STALE",
          `refactor verify expected HEAD ${input.expectedHeadSha}, current ${gitScope.worktree.headSha}`
        );
      }
      // Ledger replay and append share the recorded partition; the response reports live Git identity.
      const scope = await this.localStore.resolveArchitectureLedgerScope(gitScope);
      const replay = await this.localStore.replayArchitectureLedger({ ...scope, mode: "genesis" });
      const artifacts = recommendationArtifactsFromEvents(replay.events);
      const current = latestRecommendationById(artifacts.recommendations, input.recommendationId);
      if (!current) {
        return errorEnvelope("refactor.verify", "AC_SCHEMA_INVALID", `recommendation not found: ${input.recommendationId}`);
      }
      if (current.schemaVersion !== RECOMMENDATION_V3_SCHEMA_VERSION) {
        return errorEnvelope(
          "refactor.verify",
          "AC_PRECONDITION_FAILED",
          `recommendation ${current.recommendationId} is still ${current.schemaVersion}; run archctx ledger migrate --recommendation-v3 --write before verifying`,
          "recommendation-v2-not-migrated"
        );
      }
      const recommendation = current as RecommendationV3;
      const ingressIssues = refactorVerifyIngressIssues(recommendation);
      if (ingressIssues.length > 0) return errorEnvelope("refactor.verify", "AC_SCHEMA_INVALID", ingressIssues.join("; "));

      // A terminal record is not re-measured: its verdict is already in the ledger, and appending
      // a second one would let a later measurement rewrite a decision a human already acted on.
      if (current.status === "resolved" || current.status === "superseded") {
        const recorded = resolutionEvidenceForRecommendation(replay.evidenceState, recommendation.recommendationId);
        return this.refactorVerifyEnvelope({
          gitScope,
          recommendation,
          evidence: recorded[0],
          appendStatus: "not-appended",
          appendedEventCount: 0,
          graphDigest: replay.graphDigest
        });
      }

      let scan: RefactorScanResultV1;
      try {
        scan = runRefactorScan({
          root: repositoryRoot,
          request: REPOSITORY_REFACTOR_REQUEST,
          repository: gitScope.repository,
          worktree: gitScope.worktree,
          previousRecommendations: artifacts.recommendations,
          catalogDigest: refactorClassifierRulesetDigest(RECOMMENDATION_SCHEDULER_ENGINE_VERSION)
        });
      } catch (error) {
        if (error instanceof RefactorScanError) return errorEnvelope("refactor.verify", error.code, error.message);
        return errorEnvelope("refactor.verify", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
      }
      const baseline = baselineSnapshotForRecommendation(replay.evidenceState, recommendation.recommendationId);
      let plan: ReturnType<typeof runRefactorVerify>;
      try {
        plan = runRefactorVerify({
          recommendation,
          repository: scope.repository,
          worktree: scope.worktree,
          beforeSnapshotDigest: baseline?.snapshotDigest ?? recordedBaselineSnapshotDigest(recommendation),
          ...(baseline?.snapshot ? { beforeSnapshot: baseline.snapshot } : {}),
          ...(baseline?.unverifiable ? { beforeSnapshotUnverifiable: true } : {}),
          afterSnapshot: scan.snapshot,
          // A second read of the same HEAD, because `runRefactorScan` returns neither. It cannot
          // silently diverge from the scan: `evaluateResolution` binds both to the snapshot's
          // `modelDigest` and footprint digests and reports `stale` when they disagree.
          afterModel: loadNativeModelFromArchContext(repositoryRoot),
          afterTrackedFiles: readTrackedSourceFiles(repositoryRoot),
          ...(input.executionEvidenceRefs ? { executionEvidenceRefs: input.executionEvidenceRefs } : {}),
          evidenceState: replay.evidenceState,
          graphDigest: replay.graphDigest,
          verifiedAt: this.clock()
        });
      } catch (error) {
        return errorEnvelope("refactor.verify", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
      }

      // `resolutionDigest` excludes the clock, so a second verify at the same HEAD recomputes the
      // same verdict. Returning the recorded one keeps the ledger at exactly one event per
      // measurement instead of one per invocation.
      const recorded = findResolutionEvidence(replay.evidenceState, plan.evidence.resolutionDigest);
      if (recorded) {
        return this.refactorVerifyEnvelope({
          gitScope,
          recommendation,
          evidence: recorded,
          appendStatus: "already-recorded",
          appendedEventCount: 0,
          graphDigest: replay.graphDigest
        });
      }

      // The identity check happened before the replay, the scan and the evaluation; the tree can
      // still move in between. Last look before anything is persisted.
      const preAppendScope = await this.architectureLedgerGitScope(repositoryRoot);
      const moved = movedWorktreeIdentityFields(gitScope.worktree, preAppendScope.worktree);
      if (moved.length > 0) {
        return errorEnvelope(
          "refactor.verify",
          "AC_REFACTOR_STALE",
          `worktree ${moved.join(" and ")} changed before the refactor verify append; run refactor verify again`
        );
      }
      const append = await this.appendArchitectureEventsWithFeed(root, {
        writer: "runtime-daemon",
        events: [plan.event]
      });
      return this.refactorVerifyEnvelope({
        gitScope,
        recommendation,
        evidence: plan.evidence,
        appendStatus: "appended",
        appendedEventCount: append.appendedEvents.length,
        graphDigest: append.graphDigest,
        evidenceItemIds: [plan.resolutionItem.evidenceId, plan.afterSnapshotItem.evidenceId],
        evidenceBindingIds: [plan.binding.bindingId]
      });
    });
  }

  /** One envelope shape for all three verify outcomes, so a caller reads the same fields either way. */
  private refactorVerifyEnvelope(input: {
    gitScope: ArchitectureLedgerScope;
    recommendation: RecommendationV3;
    evidence: RefactorResolutionEvidenceV1 | undefined;
    appendStatus: "appended" | "already-recorded" | "not-appended";
    appendedEventCount: number;
    graphDigest: string;
    evidenceItemIds?: string[];
    evidenceBindingIds?: string[];
  }): JsonEnvelope {
    return okEnvelope("refactor.verify", {
      schemaVersion: "archcontext.runtime-refactor-verify/v1",
      repository: input.gitScope.repository,
      worktree: input.gitScope.worktree,
      recommendationId: input.recommendation.recommendationId,
      recommendationStatus: input.recommendation.status,
      disposition: input.evidence?.disposition ?? null,
      resolutionDigest: input.evidence?.resolutionDigest ?? null,
      evidence: (input.evidence ?? null) as unknown as Json,
      resolveCommand: input.evidence && input.evidence.disposition === "resolved"
        ? `archctx recommendations resolve --id ${input.recommendation.recommendationId} --evidence-digest ${input.evidence.resolutionDigest} --reason <why>`
        : null,
      evidenceItemIds: input.evidenceItemIds ?? [],
      evidenceBindingIds: input.evidenceBindingIds ?? [],
      append: {
        status: input.appendStatus,
        eventSource: "refactor_scan",
        appendedEventCount: input.appendedEventCount,
        graphDigest: input.graphDigest
      },
      privacy: {
        writes: "architecture-ledger-event-only",
        rawSourcePersisted: false,
        rawDiffPersisted: false,
        promptPersisted: false,
        implicitAcceptance: false
      }
    } as unknown as Json);
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

  private architectureLedgerContextPort(root: string): ArchitectureContextLedgerPort {
    return {
      queryForTask: async ({ task, maxItems, maxBytes }) => {
        const readback = await this.architectureLedgerReadback(root);
        const scope = { repository: readback.repository, worktree: readback.worktree };
        const replay = await this.localStore.replayArchitectureLedger({ ...scope, mode: "genesis" });
        const ftsMatches = await this.localStore.queryArchitectureLedgerFts({
          ...scope,
          query: task,
          maxItems
        });
        const result = queryArchitectureLedgerBook({
          state: readback.state,
          events: replay.events,
          query: task,
          ftsMatches,
          maxItems,
          maxBytes
        });
        const projectedFiles = projectArchitectureLedgerStateToYamlFiles(readback.state);
        const freshness = {
          schemaVersion: "archcontext.book-freshness/v1",
          generatedAt: this.clock(),
          repository: readback.repository,
          worktree: readback.worktree,
          readAuthority: readback.readAuthority,
          headSha: readback.worktree.headSha,
          worktreeDigest: readback.worktree.worktreeDigest,
          graphDigest: readback.graphDigest,
          projectionDigest: architectureLedgerProjectionDigest(projectedFiles),
          ledgerCursor: {
            eventCount: replay.cursor.eventCount,
            lastEventId: replay.cursor.lastEventId,
            lastEventHash: replay.cursor.lastEventHash
          }
        };
        return {
          schemaVersion: "archcontext.context-ledger-readback/v1",
          query: result.query,
          graphDigest: result.graphDigest,
          subjects: result.results,
          budget: result.budget,
          freshness: freshness as unknown as Json,
          resource: {
            type: "architecture-book",
            uri: `archcontext://book/query/${result.graphDigest}`,
            digest: result.graphDigest
          }
        };
      }
    };
  }

  private runtimeArchitectureLedgerContextPort(root: string): ArchitectureContextLedgerPort | undefined {
    return this.running ? this.architectureLedgerContextPort(root) : undefined;
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

  /**
   * Removal is durable and leaves the saved landscape self-consistent. The persisted
   * `repository_sessions` row is deleted (otherwise `restoreRepositorySessions` resurrects the
   * repository on the next daemon start), the repository is dropped from `scope`'s default active
   * set, and every stored cross-repo relation touching it is detached from `landscape.relations`.
   * The `cross_repo_edges` rows themselves are kept: they are architectural history, and
   * `listCrossRepoRelations(landscape)` already filters to the active landscape's relation IDs, so
   * detaching is enough to keep them out of live context. Relation IDs that resolve to no stored
   * relation are left alone — there is nothing to check them against.
   *
   * Every rejection is decided before the first write. The post-removal landscape can be invalid
   * for reasons that have nothing to do with this repository (a relation pointing at an
   * unregistered endpoint, say), and a removal that answers with an error must leave the in-memory
   * session map, the persisted session row, and the saved landscape exactly as it found them —
   * otherwise the daemon reports failure while already having dropped the session.
   */
  async repoRemove(repositoryId: string): Promise<JsonEnvelope> {
    this.assertRunning();
    const hadOpenSession = this.sessions.has(repositoryId);
    const hadPersistedSession = (await this.localStore.listRepositorySessions())
      .some((session) => session.repositoryId === repositoryId);
    const registered = this.landscape?.repositories.some((repo) => repo.repositoryId === repositoryId) ?? false;
    if (!registered && !hadOpenSession && !hadPersistedSession) {
      return errorEnvelope("repo.remove", "AC_REPO_NOT_FOUND", `repository is not registered: ${repositoryId}`);
    }
    let detachedRelationIds: string[] = [];
    let nextLandscape: Landscape | undefined;
    if (this.landscape) {
      detachedRelationIds = (await this.localStore.listCrossRepoRelations(this.landscape))
        .filter((relation) => relation.source.repositoryId === repositoryId || relation.target.repositoryId === repositoryId)
        .map((relation) => relation.id)
        .sort();
      const detached = new Set(detachedRelationIds);
      const next: Landscape = {
        ...this.landscape,
        repositories: this.landscape.repositories.filter((repo) => repo.repositoryId !== repositoryId),
        relations: this.landscape.relations.filter((relationId) => !detached.has(relationId)),
        ...(this.landscape.scope === undefined ? {} : {
          scope: {
            ...this.landscape.scope,
            defaultActiveRepositories: (this.landscape.scope.defaultActiveRepositories ?? [])
              .filter((activeId) => activeId !== repositoryId)
          }
        })
      };
      const validation = validateLandscape(next, await this.localStore.listCrossRepoRelations(next));
      if (!validation.valid) {
        return errorEnvelope("repo.remove", "AC_SCHEMA_INVALID", validation.errors.join("; "));
      }
      nextLandscape = next;
    }
    await this.localStore.commitRepositoryRemoval(repositoryId, nextLandscape);
    this.sessions.delete(repositoryId);
    if (nextLandscape) this.landscape = nextLandscape;
    return okEnvelope("repo.remove", {
      repositoryId,
      removed: true,
      sessionRemoved: hadOpenSession || hadPersistedSession,
      detachedRelationIds
    } as unknown as Json);
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

  private notifyExplorerInvalidation(projection: ExplorerProjectionV2, affectedOccurrenceIds: string[]): void {
    const explorer = this.explorer;
    if (!explorer || explorer.lastProjectionDigest === projection.projectionDigest) return;
    if (explorer.revoked || Date.parse(this.clock()) >= explorer.expiresAt) {
      for (const client of explorer.sseClients) client.end();
      explorer.sseClients.clear();
      return;
    }
    explorer.lastProjectionDigest = projection.projectionDigest;
    const payload = JSON.stringify({
      schemaVersion: "archcontext.explorer-invalidation/v1",
      projectionDigest: projection.projectionDigest,
      graphDigest: projection.cursor.graphDigest,
      observedFactsDigest: projection.cursor.observedFactsDigest,
      viewDefinitionDigest: projection.cursor.viewDefinitionDigest,
      affectedOccurrencesDigest: digestJson(affectedOccurrenceIds as unknown as Json)
    });
    for (const client of explorer.sseClients) client.write(`event: projection-invalidated\ndata: ${payload}\n\n`);
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
      revoked: false,
      sseClients: new Set<ServerResponse>()
    });
    await new Promise<void>((resolveListen) => server.listen(options.port ?? 0, "127.0.0.1", resolveListen));
    holder.port = (server.address() as AddressInfo).port;
    holder.expiryTimer = setTimeout(
      () => this.expireExplorerSession(holder),
      Math.max(0, expiresAt - Date.parse(this.clock()))
    );
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
    if (this.explorer) {
      if (this.explorer.expiryTimer) clearTimeout(this.explorer.expiryTimer);
      this.explorer.expiryTimer = undefined;
      this.explorer.revoked = true;
      for (const client of this.explorer.sseClients) client.end();
      this.explorer.sseClients.clear();
    }
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

  private async restoreLandscape(): Promise<void> {
    const landscape = await this.localStore.readLandscape("landscape.local");
    if (!landscape) return;
    const validation = validateLandscape(landscape);
    if (!validation.valid) {
      throw new Error(`persisted-landscape-invalid: ${validation.errors.join("; ")}`);
    }
    this.landscape = landscape;
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

  private notifyExplorerAuthorityInvalidation(root: string, record: ArchitectureChangeFeedRecordV1, occurrenceIds: string[]): void {
    const explorer = this.explorer;
    if (!explorer || explorer.root !== root) return;
    if (explorer.revoked || Date.parse(this.clock()) >= explorer.expiresAt) {
      for (const client of explorer.sseClients) client.end();
      explorer.sseClients.clear();
      return;
    }
    const payload = JSON.stringify({
      schemaVersion: "archcontext.explorer-authority-invalidation/v1",
      feedSequence: record.feedSequence,
      eventId: record.eventId,
      eventHash: record.eventHash,
      subjectsDigest: record.subjectsDigest,
      changedInputDigestsDigest: digestJson(record.changedInputDigests as unknown as Json),
      affectedOccurrencesDigest: digestJson(occurrenceIds as unknown as Json)
    });
    for (const client of explorer.sseClients) client.write(`event: authority-changed\ndata: ${payload}\n\n`);
  }

  private async handleExplorerRequest(request: IncomingMessage, response: ServerResponse, session: ExplorerServerSession): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${session.host}:${session.port}`);
    response.setHeader("Cache-Control", "no-store");
    if (!isLoopbackRemote(request.socket.remoteAddress) || !matchesLoopbackAuthority(request, `http://${session.host}:${session.port}`)) {
      writeJson(response, 403, { ok: false, error: "explorer request authority rejected" });
      return;
    }
    if (request.method !== "GET") {
      writeJson(response, 405, { ok: false, error: "explorer is read-only" });
      return;
    }
    if (!this.isExplorerAuthorized(request, url, session)) {
      writeJson(response, 401, { ok: false, error: "explorer token required" });
      return;
    }
    if (url.pathname === "/health") {
      writeJson(response, 200, { ok: true, running: true, readOnly: true, host: session.host });
      return;
    }
    if (url.pathname === "/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      });
      response.write(": archcontext explorer digest invalidation\n\n");
      session.sseClients.add(response);
      request.on("close", () => session.sseClients.delete(response));
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      let query: ExplorerProjectionQueryV2;
      try {
        query = explorerProjectionQueryV2FromUrl(url);
      } catch (error) {
        writeJson(response, 400, errorEnvelope("explorer.projection.v2", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error)));
        return;
      }
      const result = await this.explorerProjectionV2(session.root, query);
      if (!result.ok) {
        writeJson(response, result.error?.code === "AC_PRECONDITION_FAILED" ? 409 : 400, result);
        return;
      }
      const projection = result.data as unknown as ExplorerProjectionV2;
      writeHtml(response, 200, renderExplorerHtml(projection, { focusSubjectId: query.focus?.subjectId }));
      return;
    }
    if (url.pathname === "/projection/v2") {
      let query: ExplorerProjectionQueryV2;
      try {
        query = explorerProjectionQueryV2FromUrl(url);
      } catch (error) {
        writeJson(response, 400, errorEnvelope(
          "explorer.projection.v2",
          "AC_SCHEMA_INVALID",
          error instanceof Error ? error.message : String(error)
        ));
        return;
      }
      const result = await this.explorerProjectionV2(session.root, query);
      writeJson(response, result.ok ? 200 : result.error?.code === "AC_PRECONDITION_FAILED" ? 409 : 400, result);
      return;
    }
    if (url.pathname === "/delta") {
      const baseEventId = url.searchParams.get("baseEventId");
      const headEventId = url.searchParams.get("headEventId");
      const baseProjectionDigest = url.searchParams.get("baseProjectionDigest");
      const headProjectionDigest = url.searchParams.get("headProjectionDigest");
      if (!baseEventId || !headEventId || !baseProjectionDigest || !headProjectionDigest) {
        writeJson(response, 400, errorEnvelope("explorer.delta", "AC_SCHEMA_INVALID", "baseEventId, headEventId, baseProjectionDigest and headProjectionDigest are required"));
        return;
      }
      const result = await this.explorerProjectionDelta(session.root, {
        schemaVersion: "archcontext.explorer-delta-query/v2",
        base: { eventId: baseEventId, projectionDigest: baseProjectionDigest },
        head: { eventId: headEventId, projectionDigest: headProjectionDigest }
      });
      writeJson(response, result.ok ? 200 : 409, result);
      return;
    }
    writeJson(response, 404, { ok: false, error: "not found" });
  }

  private isExplorerAuthorized(request: IncomingMessage, url: URL, session: ExplorerServerSession): boolean {
    if (session.revoked || Date.parse(this.clock()) >= session.expiresAt) return false;
    const authorization = request.headers.authorization ?? "";
    const bearer = Array.isArray(authorization) ? authorization[0] : authorization;
    return matchesSecret(bearer, `Bearer ${session.token}`) || matchesSecret(url.searchParams.get("token"), session.token);
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
    if (current.expiryTimer) clearTimeout(current.expiryTimer);
    current.expiryTimer = undefined;
    for (const client of current.sseClients) client.end();
    current.sseClients.clear();
    await new Promise<void>((resolveClose, rejectClose) => {
      current.server.close((error) => error ? rejectClose(error) : resolveClose());
    });
  }

  private expireExplorerSession(session: ExplorerServerSession): void {
    if (this.explorer !== session || session.revoked) return;
    session.expiryTimer = undefined;
    session.revoked = true;
    for (const client of session.sseClients) client.end();
    session.sseClients.clear();
  }
}

function recommendationArtifactsFromEvents(events: readonly ArchitectureEventV1[]): {
  recommendationRuns: RecommendationRunV1[];
  recommendations: RecommendationLedgerRecordV1[];
  feedback: RecommendationFeedbackV1[];
} {
  const recommendationRuns: RecommendationRunV1[] = [];
  const recommendations: RecommendationLedgerRecordV1[] = [];
  const feedback: RecommendationFeedbackV1[] = [];
  for (const event of events) {
    const payload = architectureLedgerPayload(event);
    recommendationRuns.push(...(payload.recommendationRuns ?? []) as unknown as RecommendationRunV1[]);
    recommendations.push(...(payload.recommendations ?? []) as unknown as RecommendationLedgerRecordV1[]);
    feedback.push(...(payload.feedback ?? []) as unknown as RecommendationFeedbackV1[]);
  }
  return { recommendationRuns, recommendations, feedback };
}

function latestRecommendationById(
  recommendations: readonly RecommendationLedgerRecordV1[],
  recommendationId: string
): RecommendationLedgerRecordV1 | undefined {
  return recommendations
    .filter((recommendation) => recommendation.recommendationId === recommendationId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

/**
 * The only door from a non-practice recommendation to `resolved`: a `refactor verify` verdict that
 * names this record, was measured at the *tree* being resolved against, and says `resolved`.
 *
 * Both halves of the identity are checked. HEAD drift is refused because a verdict measured at an
 * earlier commit describes a tree that no longer exists. Worktree drift is refused for the case
 * HEAD alone cannot see: uncommitted edits re-introduce the very cycle the verdict says is gone,
 * at the same commit, and a HEAD-only gate would resolve the record against a tree nobody
 * measured. The cost is a re-verify after any edit, which is the correct trade for a fail-closed
 * completion gate. `practice` recommendations keep their pre-RF4 behaviour: they carry no
 * measurable outcome and pass straight through.
 */
function refactorResolveGate(
  recommendation: RecommendationLedgerRecordV1,
  evidenceDigest: string | undefined,
  evidenceState: EvidenceStateAtCursorV1,
  worktree: { headSha: string; worktreeDigest: string }
): {
  code: "AC_PRECONDITION_FAILED" | "AC_REFACTOR_EVIDENCE_REQUIRED" | "AC_REFACTOR_STALE";
  message: string;
  reasonCode?: string;
} | undefined {
  if (recommendation.schemaVersion !== RECOMMENDATION_V3_SCHEMA_VERSION) {
    return {
      code: "AC_PRECONDITION_FAILED",
      message: `recommendation ${recommendation.recommendationId} is still ${recommendation.schemaVersion}; run archctx ledger migrate --recommendation-v3 --write before resolving`,
      reasonCode: "recommendation-v2-not-migrated"
    };
  }
  if (recommendation.category === "practice") return undefined;
  if (!evidenceDigest) {
    return {
      code: "AC_REFACTOR_EVIDENCE_REQUIRED",
      message: `recommendations resolve on category ${recommendation.category} requires --evidence-digest`,
      reasonCode: "evidence-digest-missing"
    };
  }
  const evidence = findResolutionEvidence(evidenceState, evidenceDigest);
  if (!evidence || evidence.recommendationId !== recommendation.recommendationId) {
    return {
      code: "AC_REFACTOR_EVIDENCE_REQUIRED",
      message: `no refactor resolution evidence ${evidenceDigest} is recorded for ${recommendation.recommendationId}; run archctx refactor verify`,
      reasonCode: "evidence-unknown"
    };
  }
  if (evidence.verifiedHeadSha !== worktree.headSha) {
    return {
      code: "AC_REFACTOR_STALE",
      message: `refactor resolution evidence ${evidenceDigest} was verified at ${evidence.verifiedHeadSha}, current HEAD is ${worktree.headSha}; run archctx refactor verify again`,
      reasonCode: "evidence-head-drift"
    };
  }
  if (evidence.verifiedWorktreeDigest !== worktree.worktreeDigest) {
    return {
      code: "AC_REFACTOR_STALE",
      message: `refactor resolution evidence ${evidenceDigest} was verified over worktree ${evidence.verifiedWorktreeDigest}, current worktree is ${worktree.worktreeDigest}; run archctx refactor verify again`,
      reasonCode: "evidence-worktree-drift"
    };
  }
  if (evidence.disposition !== "resolved") {
    return {
      code: "AC_REFACTOR_EVIDENCE_REQUIRED",
      message: `refactor resolution evidence ${evidenceDigest} reports ${evidence.disposition}, not resolved`,
      reasonCode: "evidence-not-resolved"
    };
  }
  return undefined;
}

/** The baseline a record names. Both non-practice payloads carry it; `practice` never reaches here. */
function recordedBaselineSnapshotDigest(recommendation: RecommendationV3): string {
  return recommendation.category === "refactor_proposal"
    ? (recommendation.payload as RefactorProposalPayloadV1).baselineSnapshotDigest
    : (recommendation.payload as StructuralObservationPayloadV1).baselineSnapshotDigest;
}

function isRecommendationLifecycleCliAction(command: string): command is RecommendationFeedbackAction {
  return ["acknowledge", "accept", "reject", "defer", "waive", "resolve"].includes(command);
}

function recommendationActorKind(input: RuntimeRecommendationInput): ArchitectureActorKind {
  if (input.actorKind) return input.actorKind;
  if (input.source === "mcp") return "mcp";
  if (input.source === "daemon") return "daemon";
  if (input.source === "system") return "system";
  if (input.source === "subagent") return "subagent";
  return "cli";
}

function shortDigest(digest: string): string {
  return digest.replace(/^sha256:/, "").slice(0, 16);
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

function readGitChangeMetadata(root: string, source: GitChangeSource, input: RuntimeAgentJobEnqueueGitInput): GitChangeMetadata {
  const repositoryRoot = findRepositoryRoot(root);
  if (source === "commit") return readCommitChangeMetadata(repositoryRoot, input.ref ?? "HEAD");
  if (source === "staged") return readStagedChangeMetadata(repositoryRoot, input.baseRef ?? "HEAD");
  return readWorktreeChangeMetadata(repositoryRoot);
}

function shouldSkipGeneratedProjectionJob(metadata: GitChangeMetadata, input: RuntimeAgentJobEnqueueGitInput): boolean {
  if (input.skipGeneratedProjection === false) return false;
  if (input.generatedProjection === true) return true;
  return metadata.paths.length > 0 && metadata.paths.every((path) => isArchContextGeneratedProjectionPath(path.path));
}

function isRuntimeAgentJobCursorStale(job: AgentJobV1, scope: ArchitectureLedgerScope): boolean {
  return job.worktree.headSha !== scope.worktree.headSha
    || job.worktree.worktreeDigest !== scope.worktree.worktreeDigest;
}

/**
 * One reply for "this job ID is not yours" and "this job ID does not exist". Job IDs are unique
 * across every repository sharing one local store, so a stale, copied, or misrouted ID from another
 * repository or worktree must not be able to mutate — or even confirm the existence of — that
 * repository's queue state.
 */
function runtimeAgentJobOutOfScopeEnvelope(requestId: string, jobId: string): JsonEnvelope {
  return errorEnvelope(
    requestId,
    "AC_PRECONDITION_FAILED",
    `runtime agent job does not belong to this repository/worktree: ${jobId}`,
    "runtime-agent-job-out-of-scope"
  );
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

function runtimeAgentJobId(fingerprint: string, inputDigest: string, queuedAt: string): string {
  return `agent_job.${digestJson({
    schemaVersion: "archcontext.runtime-agent-job-id/v1",
    fingerprint,
    inputDigest,
    queuedAt,
    nonce: randomBytes(6).toString("hex")
  } as unknown as Json).replace(/^sha256:/, "").slice(0, 32)}`;
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

interface ArchitectureBookResolvedRef {
  events: ArchitectureEventV1[];
  state: ArchitectureLedgerGraphState;
  lastEventId?: string;
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

async function architectureBookResolveRef(
  store: RuntimeLocalStore,
  scope: ArchitectureLedgerScope,
  events: ArchitectureEventV1[],
  ref: string
): Promise<ArchitectureBookResolvedRef | undefined> {
  const trimmed = ref.trim();
  if (trimmed === "empty" || trimmed === "zero") {
    return { events: [], state: replayArchitectureLedgerEvents([]) };
  }
  if (trimmed === "current" || trimmed === "head") {
    return { events, state: replayArchitectureLedgerEvents(events), lastEventId: events.at(-1)?.eventId };
  }
  const snapshotId = trimmed.startsWith("snapshot:") ? trimmed.slice("snapshot:".length) : undefined;
  if (snapshotId) {
    try {
      const replay = await store.replayArchitectureLedger({ ...scope, snapshotId, mode: "genesis" });
      return { events: replay.events, state: replay.state, lastEventId: replay.cursor.lastEventId };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("architecture-ledger-snapshot-not-found:")) return undefined;
      throw error;
    }
  }
  const eventId = trimmed.startsWith("event:") ? trimmed.slice("event:".length) : trimmed;
  const eventIndex = events.findIndex((event) => event.eventId === eventId);
  if (eventIndex >= 0) {
    const selected = events.slice(0, eventIndex + 1);
    return { events: selected, state: replayArchitectureLedgerEvents(selected), lastEventId: selected.at(-1)?.eventId };
  }
  const commitRef = trimmed.startsWith("commit:") ? trimmed.slice("commit:".length) : trimmed.startsWith("sha:") ? trimmed.slice("sha:".length) : undefined;
  const commitIndex = architectureBookLastIndex(events, (event) => commitRef ? event.headSha === commitRef || event.headSha.startsWith(commitRef) : event.headSha === trimmed);
  if (commitIndex >= 0) {
    const selected = events.slice(0, commitIndex + 1);
    return { events: selected, state: replayArchitectureLedgerEvents(selected), lastEventId: selected.at(-1)?.eventId };
  }
  const timestamp = architectureBookTimestampRef(trimmed);
  if (timestamp !== undefined) {
    const timestampIndex = architectureBookLastIndex(events, (event) => Date.parse(event.timestamp) <= timestamp);
    if (timestampIndex < 0) return { events: [], state: replayArchitectureLedgerEvents([]) };
    const selected = events.slice(0, timestampIndex + 1);
    return { events: selected, state: replayArchitectureLedgerEvents(selected), lastEventId: selected.at(-1)?.eventId };
  }
  return undefined;
}

async function architectureBookResolveTimelineSinceRef(
  store: RuntimeLocalStore,
  scope: ArchitectureLedgerScope,
  events: ArchitectureEventV1[],
  ref: string
): Promise<{ sinceEventId?: string } | undefined> {
  const resolved = await architectureBookResolveRef(store, scope, events, ref);
  if (!resolved) return undefined;
  return { sinceEventId: resolved.lastEventId };
}

function architectureBookLastIndex(events: ArchitectureEventV1[], predicate: (event: ArchitectureEventV1) => boolean): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return index;
  }
  return -1;
}

function architectureBookTimestampRef(ref: string): number | undefined {
  const value = ref.startsWith("timestamp:") ? ref.slice("timestamp:".length) : ref.startsWith("time:") ? ref.slice("time:".length) : ref;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function architectureBookMarkdown(state: ArchitectureLedgerGraphState): string {
  const subjects = architectureLedgerBookSubjects(state);
  const lines = [
    "# Architecture Book",
    "",
    "## Entities",
    ...subjects
      .filter((subject) => subject.kind === "entity")
      .map((subject) => `- ${subject.id} (${subject.status}): ${subject.summary ?? subject.label}`),
    "",
    "## Relations",
    ...subjects
      .filter((subject) => subject.kind === "relation")
      .map((subject) => `- ${subject.id} (${subject.status}): ${subject.relation?.sourceEntityId} -> ${subject.relation?.targetEntityId}`),
    "",
    "## Constraints",
    ...subjects
      .filter((subject) => subject.kind === "constraint")
      .map((subject) => `- ${subject.id} (${subject.status}): ${subject.summary ?? subject.constraint?.subjectId ?? subject.label}`)
  ];
  return `${lines.join("\n")}\n`;
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

function explorerProjectionQueryV2FromUrl(url: URL): ExplorerProjectionQueryV2 {
  const expectedValues = {
    headSha: url.searchParams.get("expectedHeadSha") ?? undefined,
    worktreeDigest: url.searchParams.get("expectedWorktreeDigest") ?? undefined,
    graphDigest: url.searchParams.get("expectedGraphDigest") ?? undefined,
    observedFactsDigest: url.searchParams.get("expectedObservedFactsDigest") ?? undefined
  };
  const expectedRequired = [expectedValues.headSha, expectedValues.worktreeDigest, expectedValues.graphDigest];
  if (expectedRequired.some(Boolean) && !expectedRequired.every(Boolean)) {
    throw new Error("expectedHeadSha, expectedWorktreeDigest, and expectedGraphDigest must be provided together");
  }
  const maxNodes = parseExplorerInteger(url.searchParams.get("maxNodes"), 80, "maxNodes");
  const maxRelations = parseExplorerInteger(url.searchParams.get("maxRelations"), 160, "maxRelations");
  const depth = parseExplorerInteger(url.searchParams.get("depth"), 1, "depth") as 0 | 1 | 2;
  const viewId = url.searchParams.get("view") ?? "system-map";
  if (!(EXPLORER_VIEW_IDS as readonly string[]).includes(viewId)) throw new Error(`unsupported Explorer view: ${viewId}`);
  const semanticLevel = url.searchParams.get("level") ?? "context";
  if (!(["overview", "context", "detail"] as string[]).includes(semanticLevel)) throw new Error(`unsupported Explorer semantic level: ${semanticLevel}`);
  return {
    schemaVersion: "archcontext.explorer-projection-query/v2",
    viewId: viewId as ExplorerProjectionQueryV2["viewId"],
    semanticLevel: semanticLevel as NonNullable<ExplorerProjectionQueryV2["semanticLevel"]>,
    ...(url.searchParams.get("taskSessionId") ? { taskSessionId: url.searchParams.get("taskSessionId")! } : {}),
    ...(expectedRequired.every(Boolean) ? {
      expectedCursor: {
        headSha: expectedValues.headSha!,
        worktreeDigest: expectedValues.worktreeDigest!,
        graphDigest: expectedValues.graphDigest!,
        ...(expectedValues.observedFactsDigest ? { observedFactsDigest: expectedValues.observedFactsDigest } : {})
      }
    } : {}),
    ...(url.searchParams.get("focus") ? { focus: { subjectId: url.searchParams.get("focus")! } } : {}),
    expandedOccurrenceIds: url.searchParams.getAll("expand"),
    depth,
    budget: { maxNodes, maxRelations }
  };
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

function parseExplorerInteger(value: string | null, fallback: number, field: string): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${field} must be an integer`);
  return parsed;
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

function runtimeInvestigationRisk(value: unknown): InvestigationContextRisk {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error("runtime-agent-risk-invalid");
}

function runtimeInvestigationUncertainty(value: unknown): InvestigationContextUncertainty {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error("runtime-agent-uncertainty-invalid");
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
  const augmented = {
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
      ...context.extensions,
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
  return finalizeContextBudgetMetadata(augmented, maxBytes);
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
  return readContext7LockfileState(root).lock;
}

/**
 * The lockfile plus the hash of the exact bytes the lock was parsed from, so an approved pin can
 * carry that hash into the write as an optimistic-concurrency precondition. Reading once is what
 * makes the precondition meaningful: hashing a second read would only prove the file was stable
 * between two reads, not that the pin is being applied to the state it was computed from.
 */
function readContext7LockfileState(root: string): { lock: Context7LockfileV1; expectedHash: string } {
  const path = assertPathHasNoSymlinkSegments(root, CONTEXT7_LOCKFILE);
  if (!existsSync(path)) {
    return {
      lock: {
        schemaVersion: CONTEXT7_LOCKFILE_SCHEMA_VERSION,
        provider: "context7",
        libraries: []
      },
      expectedHash: "missing"
    };
  }
  const body = readFileSync(path, "utf8");
  const parsed = JSON.parse(body) as Context7LockfileV1;
  if (parsed.schemaVersion !== CONTEXT7_LOCKFILE_SCHEMA_VERSION || parsed.provider !== "context7" || !Array.isArray(parsed.libraries)) {
    throw new Error("Invalid Context7 lockfile");
  }
  for (const library of parsed.libraries) {
    assertContext7LibraryId(library.libraryId);
    assertContext7Version(library.version);
  }
  return {
    lock: {
      ...parsed,
      libraries: [...parsed.libraries].sort((a, b) => a.libraryId.localeCompare(b.libraryId))
    },
    expectedHash: digestJson({ body } as unknown as Json)
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

function writeContext7Lockfile(root: string, lock: Context7LockfileV1, expectedHash: string): void {
  writeFileWithoutFollowingSymlinks({
    root,
    path: CONTEXT7_LOCKFILE,
    body: JSON.stringify(lock, null, 2),
    mode: 0o600,
    expectedHash
  });
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

function validateRuntimeAgentProposalPlan(input: {
  proposalPlan: InvestigationReportProposalPlan;
  job?: AgentJobV1;
  jobId: string;
  outputDigest?: string;
}): { ok: true } | { ok: false; reason: string } {
  const plan = input.proposalPlan;
  if (plan.schemaVersion !== "archcontext.investigation-report-proposal-plan/v1") {
    return { ok: false, reason: "proposalPlan schemaVersion mismatch" };
  }
  if (plan.jobId !== input.jobId) return { ok: false, reason: "proposalPlan jobId must match completed job" };
  if (input.job && plan.inputDigest !== input.job.inputDigest) {
    return { ok: false, reason: "proposalPlan inputDigest must match completed job" };
  }
  if (input.outputDigest && plan.outputDigest !== input.outputDigest) {
    return { ok: false, reason: "proposalPlan outputDigest must match completed job outputDigest" };
  }
  if (plan.directMutationAllowed !== false || plan.authority !== "advisory-only") {
    return { ok: false, reason: "proposalPlan must remain advisory-only and directMutationAllowed=false" };
  }
  const selectedDeltaDigests = new Set(plan.proposedDeltaDigests);
  for (const draft of plan.documentationDrafts ?? []) {
    if (draft.jobId !== plan.jobId) return { ok: false, reason: `documentation draft jobId mismatch: ${draft.draftId}` };
    if (draft.reportId !== plan.reportId) return { ok: false, reason: `documentation draft reportId mismatch: ${draft.draftId}` };
    if (draft.inputDigest !== plan.inputDigest) return { ok: false, reason: `documentation draft inputDigest mismatch: ${draft.draftId}` };
    if (draft.outputDigest !== plan.outputDigest) return { ok: false, reason: `documentation draft outputDigest mismatch: ${draft.draftId}` };
    if (draft.acceptedProjection !== false || draft.authority !== "advisory-only") {
      return { ok: false, reason: `documentation draft must not be an accepted projection: ${draft.draftId}` };
    }
    if (digestJson({ prose: draft.prose } as unknown as Json) !== draft.proseDigest) {
      return { ok: false, reason: `documentation draft proseDigest mismatch: ${draft.draftId}` };
    }
    if (draft.proposedDeltaDigests.length === 0 || draft.proposedDeltaDigests.some((digest) => !selectedDeltaDigests.has(digest))) {
      return { ok: false, reason: `documentation draft must reference selected deterministic deltas: ${draft.draftId}` };
    }
  }
  for (const draft of plan.githubIssueDrafts ?? []) {
    if (draft.jobId !== plan.jobId) return { ok: false, reason: `github issue draft jobId mismatch: ${draft.draftId}` };
    if (draft.reportId !== plan.reportId) return { ok: false, reason: `github issue draft reportId mismatch: ${draft.draftId}` };
    if (draft.inputDigest !== plan.inputDigest) return { ok: false, reason: `github issue draft inputDigest mismatch: ${draft.draftId}` };
    if (draft.outputDigest !== plan.outputDigest) return { ok: false, reason: `github issue draft outputDigest mismatch: ${draft.draftId}` };
    if (draft.authority !== "advisory-only") return { ok: false, reason: `github issue draft must be advisory-only: ${draft.draftId}` };
    if (digestJson({ bodyMarkdown: draft.bodyMarkdown } as unknown as Json) !== draft.bodyDigest) {
      return { ok: false, reason: `github issue draft bodyDigest mismatch: ${draft.draftId}` };
    }
    const { draftDigest, ...draftInput } = draft;
    if (digestJson(draftInput as unknown as Json) !== draftDigest) {
      return { ok: false, reason: `github issue draft draftDigest mismatch: ${draft.draftId}` };
    }
  }
  // plan.githubIssueDraftDigests (not plan.githubIssueDrafts) is what gets written to the
  // architecture ledger (see appendAuditRunToArchitectureLedger's issueDraftDigests), so it must be
  // exactly the digests of the accompanying drafts — otherwise the two could be tampered
  // independently and the ledger's audit trail would no longer reflect the actual draft content.
  const expectedGithubIssueDraftDigests = (plan.githubIssueDrafts ?? []).map((draft) => draft.draftDigest).sort();
  const actualGithubIssueDraftDigests = [...(plan.githubIssueDraftDigests ?? [])].sort();
  if (JSON.stringify(expectedGithubIssueDraftDigests) !== JSON.stringify(actualGithubIssueDraftDigests)) {
    return { ok: false, reason: "proposalPlan githubIssueDraftDigests must match the digests of githubIssueDrafts" };
  }
  // validationDigest and proposalDigest are claimed integrity digests over the plan; recompute
  // both rather than trust the claim. Checked last so a tampered plan that also fails one of the
  // more specific structural checks above still reports that more actionable reason first.
  const expectedValidationDigest = investigationReportProposalValidationDigest({
    jobId: plan.jobId,
    reportId: plan.reportId,
    inputDigest: plan.inputDigest,
    outputDigest: plan.outputDigest,
    proposedDeltaDigests: plan.proposedDeltaDigests,
    documentationDraftDigests: plan.documentationDraftDigests,
    githubIssueDraftDigests: plan.githubIssueDraftDigests ?? []
  });
  if (plan.validationDigest !== expectedValidationDigest) {
    return { ok: false, reason: "proposalPlan validationDigest mismatch" };
  }
  const { proposalDigest, ...proposalPlanWithoutDigest } = plan;
  if (digestJson(proposalPlanWithoutDigest as unknown as Json) !== proposalDigest) {
    return { ok: false, reason: "proposalPlan proposalDigest mismatch" };
  }
  return { ok: true };
}

function writeHtml(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  });
  response.end(body);
}
