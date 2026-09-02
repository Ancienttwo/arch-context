import { RECOMMENDATION_CATEGORIES } from "./ledger";
import type {
  ArchitectureRepositoryIdentityV1,
  ArchitectureWorktreeIdentityV1,
  EvidenceCoverageLevelV2,
  PracticeRecommendationPayloadV1,
  RecommendationAuthorV1,
  RecommendationCategory,
  RecommendationPayloadV1,
  RecommendationV3,
  RefactorProposalPayloadV1,
  StructuralObservationPayloadV1
} from "./ledger";
import { ARCHITECTURE_MAJOR_CHANGE_REASON_CODES, type ArchitectureMajorChangeReasonCode } from "./projection";
import { digestJson, isRepoRelativePosixPath, type Json, type Severity } from "./schema";

const DIGEST_PREFIX_LENGTH = "sha256:".length;
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export const REFACTOR_REQUEST_SCHEMA_VERSION = "archcontext.refactor-request/v1" as const;
export const REFACTOR_PROPOSAL_SCHEMA_VERSION = "archcontext.refactor-proposal/v1" as const;
export const MODULE_STATISTICS_SCHEMA_VERSION = "archcontext.module-statistics/v1" as const;
export const REFACTOR_ASSESSMENT_SCHEMA_VERSION = "archcontext.refactor-assessment/v1" as const;
export const REFACTOR_RESOLUTION_EVIDENCE_SCHEMA_VERSION = "archcontext.refactor-resolution-evidence/v1" as const;

export const REFACTOR_SCALES = [
  "architecture",
  "cross_module",
  "insufficient_evidence",
  "model_adoption_required",
  "module"
] as const;
export const REFACTOR_SCALE_REASON_CODES = [
  "caller-coverage-unknown",
  "code-facts-missing",
  "code-facts-truncated",
  "major-change-detected",
  "multi-node-scope",
  "node-footprint-undeclared",
  "ownership-ambiguous",
  "single-node-scope",
  "target-unresolved",
  "unowned-paths"
] as const;
export const REFACTOR_OBSERVATION_KINDS = [
  "cycle",
  "direction-violation",
  "evidence-gap",
  "ownership-ambiguous",
  "undeclared-footprint",
  "unowned-paths"
] as const;
export const REFACTOR_RESOLUTION_DISPOSITIONS = [
  "not_improved",
  "partially_resolved",
  "regressed",
  "resolved",
  "stale"
] as const;
export const REFACTOR_OUTCOME_OPERATORS = ["absent", "equals", "greater_than", "less_than", "present"] as const;
export const REFACTOR_OUTCOME_DIRECTIONS = ["improved", "regressed", "unchanged", "unknown"] as const;
export const REFACTOR_KILL_LIST_KINDS = ["path", "relation", "symbol"] as const;
export const REFACTOR_EXECUTION_EVIDENCE_KINDS = [
  "acceptance_receipt",
  "cutover_closure",
  "merge_receipt",
  "task_contract"
] as const;
export const REFACTOR_PROPOSAL_AUTHOR_SOURCES = ["cli", "manual", "mcp", "subagent"] as const;
export const MODULE_DYNAMIC_INVOCATION_LEVELS = ["known", "none_observed", "possible", "unknown"] as const;
export const MODULE_TESTS_COVERAGE_STATUSES = ["measured", "partial", "unknown"] as const;

export type RefactorScale = (typeof REFACTOR_SCALES)[number];
export type RefactorScaleReasonCode = (typeof REFACTOR_SCALE_REASON_CODES)[number];
export type RefactorObservationKind = (typeof REFACTOR_OBSERVATION_KINDS)[number];
export type RefactorResolutionDisposition = (typeof REFACTOR_RESOLUTION_DISPOSITIONS)[number];
export type RefactorOutcomeOperator = (typeof REFACTOR_OUTCOME_OPERATORS)[number];
export type RefactorOutcomeDirection = (typeof REFACTOR_OUTCOME_DIRECTIONS)[number];
export type RefactorKillListKind = (typeof REFACTOR_KILL_LIST_KINDS)[number];
export type RefactorExecutionEvidenceKind = (typeof REFACTOR_EXECUTION_EVIDENCE_KINDS)[number];
export type RefactorProposalAuthorSource = (typeof REFACTOR_PROPOSAL_AUTHOR_SOURCES)[number];
export type ModuleDynamicInvocationLevel = (typeof MODULE_DYNAMIC_INVOCATION_LEVELS)[number];
export type ModuleTestsCoverageStatus = (typeof MODULE_TESTS_COVERAGE_STATUSES)[number];

export type RefactorScopeV1 =
  | { kind: "repository" }
  | { kind: "node"; nodeId: string }
  | { kind: "paths"; paths: string[] };

export interface RefactorTargetOutcomeV1 {
  outcomeId: string;
  metric: string;
  subjectSelectorId: string;
  nodeId: string | null;
  operator: RefactorOutcomeOperator;
  value: number | null;
  required: boolean;
}

export interface RefactorObservedOutcomeV1 {
  outcomeId: string;
  observedValue: number | null;
  satisfied: boolean;
  direction: RefactorOutcomeDirection;
}

export interface RefactorKillListEntryV1 {
  kind: RefactorKillListKind;
  selectorId: string;
  required: boolean;
}

export interface ArchitectureTargetDeltaV1 {
  interventionId: string;
  trigger: string[];
  thesis: string;
  targetState: {
    owners: Record<string, string>;
    requiredRelations: string[];
    removedConcepts: string[];
  };
  migrationState: {
    active: boolean;
    compatibilityContracts: string[];
    cleanupBy?: string;
    temporaryRelations: string[];
  };
  completionCriteria: RefactorTargetOutcomeV1[];
  falsifiers: string[];
  benefitLedger: {
    benefits: string[];
    costs: string[];
    rollbackPoint: string;
  };
  unresolvedTargets: string[];
  extensions?: Record<string, Json>;
}

export interface RefactorProposalV1 {
  schemaVersion: typeof REFACTOR_PROPOSAL_SCHEMA_VERSION;
  authoredBy: RecommendationAuthorV1;
  intent: string;
  scopePaths: string[];
  targetDelta?: ArchitectureTargetDeltaV1;
  targetOutcomes: RefactorTargetOutcomeV1[];
  killList: RefactorKillListEntryV1[];
  proposalDigest: string;
  extensions?: Record<string, Json>;
}

export interface RefactorRequestV1 {
  schemaVersion: typeof REFACTOR_REQUEST_SCHEMA_VERSION;
  scope: RefactorScopeV1;
  proposal?: RefactorProposalV1;
  expectedHeadSha?: string;
  expectedWorktreeDigest?: string;
  task?: string;
}

export interface ModuleStatisticsV1 {
  nodeId: string;
  nodeDigest: string;
  parentNodeId: string | null;
  footprintDeclared: boolean;
  footprint: {
    fileCount: number;
    lineCount: number;
    sourceFilesDigest: string;
    includePatterns: string[];
    excludePatterns: string[];
  } | null;
  surfaces: {
    declaredEntrypoints: string[];
    observedEntrypoints: string[];
    lifecycleOwners: string[];
    datastoreSubjects: string[];
  };
  dependencyGraph: {
    internalEdgeCount: number;
    inboundModuleEdges: number;
    outboundModuleEdges: number;
    fanIn: number;
    fanOut: number;
    stronglyConnectedComponentId: string | null;
    cycleCount: number;
    instability: number | null;
    directionViolationCount: number | null;
  } | null;
  tests: {
    testFileCount: number | null;
    observedTestEdges: number | null;
    callerCoverage: number | null;
    coverageStatus: ModuleTestsCoverageStatus;
  };
  uncertainty: {
    unresolvedImports: number;
    dynamicInvocation: ModuleDynamicInvocationLevel;
    ambiguousOwnership: boolean;
  };
  moduleDigest: string;
  extensions?: Record<string, Json>;
}

export interface ModuleStatisticsSnapshotV1 {
  schemaVersion: typeof MODULE_STATISTICS_SCHEMA_VERSION;
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  modelDigest: string;
  codeFacts: {
    provider: "codegraph";
    version: string;
    binaryDigest: string;
    indexedWorktreeDigest: string | null;
    coverage: EvidenceCoverageLevelV2;
    truncated: boolean;
    edgeLimit: number | null;
    reasonCodes: RefactorScaleReasonCode[];
  };
  modules: ModuleStatisticsV1[];
  repositorySummary: {
    moduleCount: number;
    undeclaredFootprintNodeCount: number;
    ownedFileCount: number;
    unownedFileCount: number;
    multiplyOwnedFileCount: number;
    crossModuleEdgeCount: number;
    crossModuleCycleCount: number;
    stronglyConnectedComponentCount: number;
    unresolvedImportCount: number;
    dynamicInvocationRiskCount: number;
  };
  createdAt: string;
  snapshotDigest: string;
  extensions?: Record<string, Json>;
}

export interface RefactorObservationV1 {
  kind: RefactorObservationKind;
  subjectSelectorId: string;
  signalIds: string[];
  metrics: Record<string, number | null>;
}

export interface RefactorAssessmentV1 {
  schemaVersion: typeof REFACTOR_ASSESSMENT_SCHEMA_VERSION;
  requestId: string;
  statisticsSnapshotDigest: string;
  modelDigest: string;
  codeFactsDigest: string;
  requestedScope: RefactorScopeV1;
  proposalDigest: string | null;
  observations: RefactorObservationV1[];
  scale: RefactorScale | null;
  scaleReasonCodes: RefactorScaleReasonCode[];
  affectedNodeIds: string[];
  majorChangeReasons: ArchitectureMajorChangeReasonCode[];
  pressure: {
    level: "low" | "medium" | "high";
    score: number;
    signalIds: string[];
  };
  confidence: {
    level: "low" | "medium" | "high";
    callerCoverage: number | null;
    testsObserved: boolean | null;
    rollbackObserved: boolean | null;
    unresolvedEvidence: string[];
  };
  createdAt: string;
  assessmentDigest: string;
  extensions?: Record<string, Json>;
}

export interface RefactorResidualV1 {
  code: string;
  subject: string;
  severity: Severity;
}

export interface RefactorExecutionEvidenceRefV1 {
  kind: RefactorExecutionEvidenceKind;
  locator: string;
  sha256: string;
}

export interface RefactorResolutionEvidenceV1 {
  schemaVersion: typeof REFACTOR_RESOLUTION_EVIDENCE_SCHEMA_VERSION;
  recommendationId: string;
  recommendationDigest: string;
  beforeSnapshotDigest: string;
  afterSnapshotDigest: string;
  verifiedHeadSha: string;
  verifiedWorktreeDigest: string;
  expectedOutcomes: RefactorTargetOutcomeV1[];
  observedOutcomes: RefactorObservedOutcomeV1[];
  residuals: RefactorResidualV1[];
  executionEvidenceRefs: RefactorExecutionEvidenceRefV1[];
  disposition: RefactorResolutionDisposition;
  verifiedAt: string;
  resolutionDigest: string;
  extensions?: Record<string, Json>;
}

export interface RecommendationV3FingerprintInputV1 {
  category: RecommendationCategory;
  subjectSelectorId: string;
  practiceId: string | null;
  payload: Record<string, Json>;
}

/**
 * Digest exclusion rule for every helper below: drop the record's own digest
 * field, its top-level `extensions`, and its timestamps. Nested `extensions`
 * (for example `modules[i].extensions`) stay inside the hashed content, so a
 * nested annotation changes the digest. The single exception is the derived
 * `targetDelta` identity below: ArchContext fills `unresolvedTargets` after the
 * agent authored the proposal, so `refactorProposalDigest` hashes the delta
 * under the same exclusions as `architectureTargetDeltaInterventionId`
 * (`interventionId`, `unresolvedTargets`, `extensions`) and the agent-authored
 * identity survives assessment. `authoredBy` stays hashed at the top level:
 * the no-self-authored gate must be digest-bound.
 */
export function refactorProposalDigest(proposal: RefactorProposalV1): string {
  const { proposalDigest: _proposalDigest, extensions: _extensions, ...hashable } = proposal;
  return digestJson({
    ...hashable,
    ...(hashable.targetDelta ? { targetDelta: authoredTargetDelta(hashable.targetDelta) } : {})
  } as unknown as Json);
}

export function architectureTargetDeltaInterventionId(delta: ArchitectureTargetDeltaV1): string {
  const digest = digestJson(authoredTargetDelta(delta) as unknown as Json);
  return `intervention.${digest.slice(DIGEST_PREFIX_LENGTH, DIGEST_PREFIX_LENGTH + 16)}`;
}

export function moduleStatisticsDigest(module: ModuleStatisticsV1): string {
  const { moduleDigest: _moduleDigest, extensions: _extensions, ...hashable } = module;
  return digestJson(hashable as unknown as Json);
}

export function moduleStatisticsSnapshotDigest(snapshot: ModuleStatisticsSnapshotV1): string {
  const { snapshotDigest: _snapshotDigest, createdAt: _createdAt, extensions: _extensions, ...hashable } = snapshot;
  return digestJson(hashable as unknown as Json);
}

export function refactorAssessmentDigest(assessment: RefactorAssessmentV1): string {
  const {
    assessmentDigest: _assessmentDigest,
    requestId: _requestId,
    createdAt: _createdAt,
    extensions: _extensions,
    ...hashable
  } = assessment;
  return digestJson(hashable as unknown as Json);
}

export function refactorResolutionEvidenceDigest(evidence: RefactorResolutionEvidenceV1): string {
  const {
    resolutionDigest: _resolutionDigest,
    verifiedAt: _verifiedAt,
    extensions: _extensions,
    ...hashable
  } = evidence;
  return digestJson(hashable as unknown as Json);
}

/**
 * Canonical fingerprint input for a v3 recommendation. It deliberately drops
 * `assessmentDigest` and `baselineSnapshotDigest` so that re-detecting the same
 * structural fact at a new HEAD dedups against the previous recommendation and
 * drives `relations.regressesFrom` instead of creating an unrelated record.
 */
export function recommendationV3FingerprintInput(
  recommendation: Pick<RecommendationV3, "category" | "subjectSelectorId" | "practiceId" | "payload">
): RecommendationV3FingerprintInputV1 {
  return {
    category: recommendation.category,
    subjectSelectorId: recommendation.subjectSelectorId,
    practiceId: recommendation.practiceId ?? null,
    payload: fingerprintPayloadSubset(recommendation.category, recommendation.payload)
  };
}

export function refactorProposalInvariantIssues(proposal: RefactorProposalV1, prefix = "proposal"): string[] {
  const issues = [
    ...sortedUniqueIssues(`${prefix}.scopePaths`, proposal.scopePaths),
    ...digestIssues(`${prefix}.proposalDigest`, proposal.proposalDigest),
    ...outcomeIssues(`${prefix}.targetOutcomes`, proposal.targetOutcomes)
  ];
  if (proposal.schemaVersion !== REFACTOR_PROPOSAL_SCHEMA_VERSION) issues.push(`${prefix}.schemaVersion is invalid`);
  if (proposal.intent.trim() === "") issues.push(`${prefix}.intent must not be empty`);
  if (proposal.scopePaths.length === 0) issues.push(`${prefix}.scopePaths must contain at least one path`);
  for (const path of proposal.scopePaths) {
    if (!isRepoRelativePosixPath(path)) issues.push(`${prefix}.scopePaths must be repo-relative POSIX paths: ${path}`);
  }
  if (!isRefactorProposalAuthorSource(proposal.authoredBy.source)) {
    issues.push(`${prefix}.authoredBy.source must not be ${proposal.authoredBy.source}; refactor proposals are agent or human authored`);
  }
  if (proposal.authoredBy.id.trim() === "") issues.push(`${prefix}.authoredBy.id must not be empty`);
  issues.push(...sortedUniqueIssues(`${prefix}.killList.selectorId`, proposal.killList.map((entry) => entry.selectorId)));
  if (refactorProposalDigest(proposal) !== proposal.proposalDigest) {
    issues.push(`${prefix}.proposalDigest must bind the authored proposal payload`);
  }
  if (proposal.targetDelta) issues.push(...architectureTargetDeltaInvariantIssues(proposal.targetDelta, `${prefix}.targetDelta`));
  return issues;
}

export function architectureTargetDeltaInvariantIssues(delta: ArchitectureTargetDeltaV1, prefix = "targetDelta"): string[] {
  const issues = [
    ...sortedUniqueIssues(`${prefix}.unresolvedTargets`, delta.unresolvedTargets),
    ...outcomeIssues(`${prefix}.completionCriteria`, delta.completionCriteria)
  ];
  if (delta.thesis.trim() === "") issues.push(`${prefix}.thesis must not be empty`);
  if (delta.trigger.length === 0) issues.push(`${prefix}.trigger must state at least one trigger`);
  if (delta.falsifiers.length === 0) issues.push(`${prefix}.falsifiers must state at least one falsifier`);
  if (delta.completionCriteria.length === 0) issues.push(`${prefix}.completionCriteria must contain at least one outcome`);
  if (delta.benefitLedger.rollbackPoint.trim() === "") issues.push(`${prefix}.benefitLedger.rollbackPoint must not be empty`);
  if (architectureTargetDeltaInterventionId(delta) !== delta.interventionId) {
    issues.push(`${prefix}.interventionId must be derived from the authored delta`);
  }
  return issues;
}

export function refactorRequestInvariantIssues(request: RefactorRequestV1, prefix = "request"): string[] {
  const issues: string[] = [];
  if (request.schemaVersion !== REFACTOR_REQUEST_SCHEMA_VERSION) issues.push(`${prefix}.schemaVersion is invalid`);
  if (request.scope.kind === "node" && request.scope.nodeId.trim() === "") issues.push(`${prefix}.scope.nodeId must not be empty`);
  if (request.scope.kind === "paths") {
    issues.push(...sortedUniqueIssues(`${prefix}.scope.paths`, request.scope.paths));
    if (request.scope.paths.length === 0) issues.push(`${prefix}.scope.paths must contain at least one path`);
    for (const path of request.scope.paths) {
      if (!isRepoRelativePosixPath(path)) issues.push(`${prefix}.scope.paths must be repo-relative POSIX paths: ${path}`);
    }
  }
  if (request.proposal) issues.push(...refactorProposalInvariantIssues(request.proposal, `${prefix}.proposal`));
  return issues;
}

export function moduleStatisticsInvariantIssues(module: ModuleStatisticsV1, prefix = "module"): string[] {
  const issues = [...digestIssues(`${prefix}.moduleDigest`, module.moduleDigest), ...digestIssues(`${prefix}.nodeDigest`, module.nodeDigest)];
  if (module.nodeId.trim() === "") issues.push(`${prefix}.nodeId must not be empty`);
  if (module.footprintDeclared === (module.footprint === null)) {
    issues.push(`${prefix}.footprint must be present exactly when footprintDeclared is true`);
  }
  if (module.footprint) {
    issues.push(...digestIssues(`${prefix}.footprint.sourceFilesDigest`, module.footprint.sourceFilesDigest));
    if (module.footprint.fileCount < 0 || module.footprint.lineCount < 0) {
      issues.push(`${prefix}.footprint counts must not be negative`);
    }
  }
  if (module.tests.coverageStatus === "unknown" && module.tests.callerCoverage !== null) {
    issues.push(`${prefix}.tests.callerCoverage must be null when coverageStatus is unknown`);
  }
  if (moduleStatisticsDigest(module) !== module.moduleDigest) {
    issues.push(`${prefix}.moduleDigest must bind the measured module payload`);
  }
  return issues;
}

export function moduleStatisticsSnapshotInvariantIssues(snapshot: ModuleStatisticsSnapshotV1, prefix = "snapshot"): string[] {
  const issues = [
    ...digestIssues(`${prefix}.snapshotDigest`, snapshot.snapshotDigest),
    ...digestIssues(`${prefix}.modelDigest`, snapshot.modelDigest),
    ...sortedUniqueIssues(`${prefix}.codeFacts.reasonCodes`, snapshot.codeFacts.reasonCodes),
    ...sortedUniqueIssues(`${prefix}.modules.nodeId`, snapshot.modules.map((module) => module.nodeId)),
    ...snapshot.modules.flatMap((module, index) => moduleStatisticsInvariantIssues(module, `${prefix}.modules[${index}]`))
  ];
  if (snapshot.schemaVersion !== MODULE_STATISTICS_SCHEMA_VERSION) issues.push(`${prefix}.schemaVersion is invalid`);
  if (snapshot.codeFacts.coverage === "unknown") {
    if (!snapshot.codeFacts.truncated) issues.push(`${prefix}.codeFacts.truncated must be true when coverage is unknown`);
    for (const [index, module] of snapshot.modules.entries()) {
      if (module.dependencyGraph !== null) {
        issues.push(`${prefix}.modules[${index}].dependencyGraph must be null when codeFacts.coverage is unknown`);
      }
    }
  }
  if (snapshot.repositorySummary.moduleCount !== snapshot.modules.length) {
    issues.push(`${prefix}.repositorySummary.moduleCount must equal the module count`);
  }
  const undeclared = snapshot.modules.filter((module) => !module.footprintDeclared).length;
  if (snapshot.repositorySummary.undeclaredFootprintNodeCount !== undeclared) {
    issues.push(`${prefix}.repositorySummary.undeclaredFootprintNodeCount must equal the undeclared footprint module count`);
  }
  if (moduleStatisticsSnapshotDigest(snapshot) !== snapshot.snapshotDigest) {
    issues.push(`${prefix}.snapshotDigest must bind the measured snapshot payload`);
  }
  return issues;
}

export function refactorAssessmentInvariantIssues(assessment: RefactorAssessmentV1, prefix = "assessment"): string[] {
  const issues = [
    ...digestIssues(`${prefix}.assessmentDigest`, assessment.assessmentDigest),
    ...digestIssues(`${prefix}.statisticsSnapshotDigest`, assessment.statisticsSnapshotDigest),
    ...digestIssues(`${prefix}.modelDigest`, assessment.modelDigest),
    ...digestIssues(`${prefix}.codeFactsDigest`, assessment.codeFactsDigest),
    ...sortedUniqueIssues(`${prefix}.affectedNodeIds`, assessment.affectedNodeIds),
    ...sortedUniqueIssues(`${prefix}.scaleReasonCodes`, assessment.scaleReasonCodes),
    ...sortedUniqueIssues(`${prefix}.majorChangeReasons`, assessment.majorChangeReasons)
  ];
  if (assessment.schemaVersion !== REFACTOR_ASSESSMENT_SCHEMA_VERSION) issues.push(`${prefix}.schemaVersion is invalid`);
  if (assessment.proposalDigest !== null) issues.push(...digestIssues(`${prefix}.proposalDigest`, assessment.proposalDigest));
  if ((assessment.scale === null) !== (assessment.proposalDigest === null)) {
    issues.push(`${prefix}.scale must be null exactly when proposalDigest is null`);
  }
  if (assessment.scale === "architecture" && assessment.majorChangeReasons.length === 0) {
    issues.push(`${prefix}.architecture scale requires at least one majorChangeReason`);
  }
  const allowedReasons = new Set<string>(ARCHITECTURE_MAJOR_CHANGE_REASON_CODES);
  for (const reason of assessment.majorChangeReasons) {
    if (!allowedReasons.has(reason)) issues.push(`${prefix}.majorChangeReasons contains unsupported reason: ${reason}`);
  }
  for (const [index, observation] of assessment.observations.entries()) {
    if (observation.subjectSelectorId.trim() === "") issues.push(`${prefix}.observations[${index}].subjectSelectorId must not be empty`);
    issues.push(...sortedUniqueIssues(`${prefix}.observations[${index}].signalIds`, observation.signalIds));
  }
  if (assessment.confidence.callerCoverage !== null && (assessment.confidence.callerCoverage < 0 || assessment.confidence.callerCoverage > 1)) {
    issues.push(`${prefix}.confidence.callerCoverage must be a ratio between 0 and 1`);
  }
  if (refactorAssessmentDigest(assessment) !== assessment.assessmentDigest) {
    issues.push(`${prefix}.assessmentDigest must bind the assessed payload`);
  }
  return issues;
}

export function refactorResolutionEvidenceInvariantIssues(
  evidence: RefactorResolutionEvidenceV1,
  prefix = "resolutionEvidence"
): string[] {
  const issues = [
    ...digestIssues(`${prefix}.resolutionDigest`, evidence.resolutionDigest),
    ...digestIssues(`${prefix}.recommendationDigest`, evidence.recommendationDigest),
    ...digestIssues(`${prefix}.beforeSnapshotDigest`, evidence.beforeSnapshotDigest),
    ...digestIssues(`${prefix}.afterSnapshotDigest`, evidence.afterSnapshotDigest),
    ...outcomeIssues(`${prefix}.expectedOutcomes`, evidence.expectedOutcomes),
    ...sortedUniqueIssues(`${prefix}.observedOutcomes.outcomeId`, evidence.observedOutcomes.map((outcome) => outcome.outcomeId))
  ];
  if (evidence.schemaVersion !== REFACTOR_RESOLUTION_EVIDENCE_SCHEMA_VERSION) issues.push(`${prefix}.schemaVersion is invalid`);
  const observedById = new Map(evidence.observedOutcomes.map((outcome) => [outcome.outcomeId, outcome]));
  for (const expected of evidence.expectedOutcomes) {
    if (!observedById.has(expected.outcomeId)) issues.push(`${prefix}.observedOutcomes is missing outcome ${expected.outcomeId}`);
  }
  for (const ref of evidence.executionEvidenceRefs) {
    if (!/^[a-f0-9]{64}$/.test(ref.sha256)) issues.push(`${prefix}.executionEvidenceRefs.sha256 must be a bare SHA-256 hex digest`);
    if (ref.locator.trim() === "") issues.push(`${prefix}.executionEvidenceRefs.locator must not be empty`);
  }
  if (evidence.disposition !== "stale") {
    const required = evidence.expectedOutcomes.filter((outcome) => outcome.required);
    const observedRequired = required.map((outcome) => observedById.get(outcome.outcomeId)).filter(isPresent);
    const regressed = evidence.observedOutcomes.some((outcome) => outcome.direction === "regressed");
    const satisfiedCount = observedRequired.filter((outcome) => outcome.satisfied).length;
    if (regressed && evidence.disposition !== "regressed") {
      issues.push(`${prefix}.disposition must be regressed when any observed outcome regressed`);
    }
    if (!regressed && required.length > 0) {
      if (satisfiedCount === required.length && evidence.disposition !== "resolved") {
        issues.push(`${prefix}.disposition must be resolved when every required outcome is satisfied`);
      }
      if (satisfiedCount === 0 && evidence.disposition !== "not_improved") {
        issues.push(`${prefix}.disposition must be not_improved when no required outcome is satisfied`);
      }
      if (satisfiedCount > 0 && satisfiedCount < required.length && evidence.disposition !== "partially_resolved") {
        issues.push(`${prefix}.disposition must be partially_resolved when only some required outcomes are satisfied`);
      }
    }
  }
  if (refactorResolutionEvidenceDigest(evidence) !== evidence.resolutionDigest) {
    issues.push(`${prefix}.resolutionDigest must bind the verified payload`);
  }
  return issues;
}

export function recommendationV3InvariantIssues(recommendation: RecommendationV3, prefix = "recommendation"): string[] {
  const issues = [...sortedUniqueIssues(`${prefix}.evidenceBindingIds`, recommendation.evidenceBindingIds)];
  if (!(RECOMMENDATION_CATEGORIES as readonly string[]).includes(recommendation.category)) {
    issues.push(`${prefix}.category is unsupported: ${recommendation.category}`);
  }
  if (recommendation.subjectSelectorId.trim() === "") issues.push(`${prefix}.subjectSelectorId must not be empty`);
  if (recommendation.authoredBy.id.trim() === "") issues.push(`${prefix}.authoredBy.id must not be empty`);
  if (recommendation.category === "practice" && !recommendation.practiceId) {
    issues.push(`${prefix}.practiceId is required for practice recommendations`);
  }
  if (recommendation.category === "structural_observation") {
    if (recommendation.authoredBy.source !== "daemon") {
      issues.push(`${prefix}.structural_observation must be authored by the daemon`);
    }
    if (recommendation.enforcement !== "advisory") {
      issues.push(`${prefix}.structural_observation enforcement must be advisory`);
    }
  }
  if (recommendation.category === "refactor_proposal") {
    if (!isRefactorProposalAuthorSource(recommendation.authoredBy.source)) {
      issues.push(`${prefix}.refactor_proposal must not be authored by ${recommendation.authoredBy.source}`);
    }
    const payload = recommendation.payload as RefactorProposalPayloadV1;
    const expected = payload.scale === "architecture" ? "complete" : "checkpoint";
    if (recommendation.enforcement !== expected) {
      issues.push(`${prefix}.refactor_proposal with scale ${payload.scale} requires ${expected} enforcement`);
    }
    issues.push(...digestIssues(`${prefix}.payload.proposalDigest`, payload.proposalDigest));
    issues.push(...sortedUniqueIssues(`${prefix}.payload.affectedNodeIds`, payload.affectedNodeIds));
    issues.push(...sortedUniqueIssues(`${prefix}.payload.majorChangeReasons`, payload.majorChangeReasons));
  }
  return issues;
}

export function refactorScanInvariantIssues(input: {
  snapshot: ModuleStatisticsSnapshotV1;
  assessment: RefactorAssessmentV1;
  proposal?: RefactorProposalV1;
}): string[] {
  const issues = [
    ...moduleStatisticsSnapshotInvariantIssues(input.snapshot),
    ...refactorAssessmentInvariantIssues(input.assessment),
    ...(input.proposal ? refactorProposalInvariantIssues(input.proposal) : [])
  ];
  if (input.assessment.statisticsSnapshotDigest !== input.snapshot.snapshotDigest) {
    issues.push("assessment.statisticsSnapshotDigest must reference the measured snapshot");
  }
  if (input.assessment.modelDigest !== input.snapshot.modelDigest) {
    issues.push("assessment.modelDigest must match the snapshot modelDigest");
  }
  const proposalDigest = input.proposal ? input.proposal.proposalDigest : null;
  if (input.assessment.proposalDigest !== proposalDigest) {
    issues.push("assessment.proposalDigest must reference the submitted proposal");
  }
  const unresolved = input.proposal?.targetDelta?.unresolvedTargets ?? [];
  if (unresolved.length > 0 && input.assessment.scale !== "insufficient_evidence") {
    issues.push("assessment.scale must be insufficient_evidence while targetDelta.unresolvedTargets is non-empty");
  }
  if (unresolved.length > 0 && !input.assessment.scaleReasonCodes.includes("target-unresolved")) {
    issues.push("assessment.scaleReasonCodes must include target-unresolved while targets stay unresolved");
  }
  return issues;
}

export function refactorVerifyInvariantIssues(
  afterSnapshot: ModuleStatisticsSnapshotV1,
  evidence: RefactorResolutionEvidenceV1
): string[] {
  const issues = [
    ...moduleStatisticsSnapshotInvariantIssues(afterSnapshot, "afterSnapshot"),
    ...refactorResolutionEvidenceInvariantIssues(evidence)
  ];
  if (evidence.afterSnapshotDigest !== afterSnapshot.snapshotDigest) {
    issues.push("resolutionEvidence.afterSnapshotDigest must reference the re-measured snapshot");
  }
  if (evidence.verifiedHeadSha !== afterSnapshot.worktree.headSha) {
    issues.push("resolutionEvidence.verifiedHeadSha must match the re-measured worktree HEAD");
  }
  if (evidence.verifiedWorktreeDigest !== afterSnapshot.worktree.worktreeDigest) {
    issues.push("resolutionEvidence.verifiedWorktreeDigest must match the re-measured worktree digest");
  }
  if (afterSnapshot.codeFacts.coverage !== "complete" && evidence.disposition === "resolved") {
    issues.push("resolutionEvidence.disposition must not be resolved while after-snapshot coverage is incomplete");
  }
  return issues;
}

function authoredTargetDelta(delta: ArchitectureTargetDeltaV1): Omit<ArchitectureTargetDeltaV1, "interventionId" | "unresolvedTargets" | "extensions"> {
  const {
    interventionId: _interventionId,
    unresolvedTargets: _unresolvedTargets,
    extensions: _extensions,
    ...authored
  } = delta;
  return authored;
}

function isRefactorProposalAuthorSource(source: string): source is RefactorProposalAuthorSource {
  return (REFACTOR_PROPOSAL_AUTHOR_SOURCES as readonly string[]).includes(source);
}

function fingerprintPayloadSubset(category: RecommendationCategory, payload: RecommendationPayloadV1): Record<string, Json> {
  if (category === "practice") {
    return { baselineDigest: (payload as PracticeRecommendationPayloadV1).baselineDigest };
  }
  if (category === "structural_observation") {
    const observation = payload as StructuralObservationPayloadV1;
    return { kind: observation.kind, affectedNodeIds: [...observation.affectedNodeIds].sort() };
  }
  const proposal = payload as RefactorProposalPayloadV1;
  return {
    proposalDigest: proposal.proposalDigest,
    scale: proposal.scale,
    affectedNodeIds: [...proposal.affectedNodeIds].sort(),
    majorChangeReasons: [...proposal.majorChangeReasons].sort()
  };
}

function outcomeIssues(label: string, outcomes: readonly RefactorTargetOutcomeV1[]): string[] {
  const issues = sortedUniqueIssues(`${label}.outcomeId`, outcomes.map((outcome) => outcome.outcomeId));
  for (const outcome of outcomes) {
    const valueless = outcome.operator === "absent" || outcome.operator === "present";
    if (valueless && outcome.value !== null) issues.push(`${label} operator ${outcome.operator} must not carry a value`);
    if (!valueless && outcome.value === null) issues.push(`${label} operator ${outcome.operator} requires a value`);
    if (outcome.metric.trim() === "") issues.push(`${label} metric must not be empty`);
  }
  return issues;
}

function digestIssues(label: string, value: string): string[] {
  return SHA256_DIGEST_PATTERN.test(value) ? [] : [`${label} must be a sha256:<64-hex> digest`];
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function sortedUniqueIssues(label: string, values: readonly string[]): string[] {
  const expected = [...new Set(values)].sort();
  return expected.length === values.length && expected.every((value, index) => value === values[index])
    ? []
    : [`${label} must be sorted and unique`];
}
