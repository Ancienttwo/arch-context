import { RECOMMENDATION_CATEGORIES, RECOMMENDATION_V3_SCHEMA_VERSION } from "./ledger";
import type {
  ArchitectureActorKind,
  ArchitectureSubjectSelectorKind,
  ArchitectureRepositoryIdentityV1,
  ArchitectureWorktreeIdentityV1,
  EvidenceCoverageLevelV2,
  PracticeRecommendationPayloadV1,
  RecommendationAuthorV1,
  RecommendationCategory,
  RecommendationPayloadV1,
  RecommendationStatus,
  RecommendationV3,
  RecommendationV3Base,
  RefactorProposalPayloadV1,
  StructuralObservationPayloadV1
} from "./ledger";
import { ARCHITECTURE_MAJOR_CHANGE_REASON_CODES, type ArchitectureMajorChangeReasonCode } from "./projection";
import { digestJson, isRepoRelativePosixPath, type Json, type Severity } from "./schema";

const DIGEST_PREFIX_LENGTH = "sha256:".length;
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const BARE_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_HEAD_SHA_PATTERN = /^[a-f0-9]{40}$/;

/**
 * The bounded grammar an execution evidence `locator` must fit: 1..256 characters drawn from the
 * unreserved plus sub-delims/gen-delims set that repo-relative paths and URLs already live in.
 *
 * A locator is a *reference*, not a body. Left unbounded it is a string field on a record whose
 * envelope promises `privacy.rawDiffPersisted: false`, so a caller could park a whole diff, a
 * credential, or a multi-line prompt in it and the digest check would still pass. Whitespace,
 * newlines and control characters are the shapes that only a body has, and the length ceiling is
 * what stops a single-line body from riding through anyway.
 */
export const REFACTOR_EXECUTION_EVIDENCE_LOCATOR_PATTERN = /^[A-Za-z0-9._~:\/?#@!$&'()*+,;=%-]{1,256}$/;

/** The single sentence every ingress uses to name the locator rule, so they cannot drift apart. */
export const REFACTOR_EXECUTION_EVIDENCE_LOCATOR_RULE =
  "must be a bounded reference: 1-256 characters from [A-Za-z0-9._~:/?#@!$&'()*+,;=%-], no whitespace or control characters";

/** The only top-level keys a verification request may carry; anything else is a caller typo. */
export const REFACTOR_VERIFICATION_REQUEST_KEYS = [
  "executionEvidenceRefs",
  "expectedHeadSha",
  "expectedWorktreeDigest",
  "importNodeLimit",
  "recommendationId",
  "schemaVersion"
] as const;

/**
 * The grammar of the refactor identity namespace: the manifest `product.id`, which scopes every
 * refactor subject selector so one subject has one recommendation id in every worktree, branch and
 * clone (ADR-0046). It is the declared-id grammar node ids use, without the cross-repo prefix.
 */
export const REFACTOR_NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/;

/** Issues with a refactor namespace value; empty when it is a well-formed `product.id`. */
export function refactorNamespaceIssues(value: unknown, label = "product.id"): string[] {
  if (typeof value !== "string") return [`${label} must be a string`];
  if (value.trim() === "") return [`${label} must not be blank`];
  return REFACTOR_NAMESPACE_PATTERN.test(value)
    ? []
    : [`${label} must match ${REFACTOR_NAMESPACE_PATTERN.source}`];
}

export const REFACTOR_REQUEST_SCHEMA_VERSION = "archcontext.refactor-request/v1" as const;
export const REFACTOR_PROPOSAL_SCHEMA_VERSION = "archcontext.refactor-proposal/v1" as const;
export const MODULE_STATISTICS_SCHEMA_VERSION = "archcontext.module-statistics/v1" as const;
export const REFACTOR_ASSESSMENT_SCHEMA_VERSION = "archcontext.refactor-assessment/v1" as const;
export const REFACTOR_RESOLUTION_EVIDENCE_SCHEMA_VERSION = "archcontext.refactor-resolution-evidence/v1" as const;
export const REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION = "archcontext.refactor-verification-request/v1" as const;

export const REFACTOR_SCALES = [
  "architecture",
  "cross_module",
  "insufficient_evidence",
  "model_adoption_required",
  "module"
] as const;
export const REFACTOR_SCALE_REASON_CODES = [
  "caller-coverage-unknown",
  "code-facts-import-limit",
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
/**
 * `cycle` is one bidirectional module pair; `residual-cycle` is a strongly connected component that
 * survives cutting the thin direction of every pair (ADR-0046).
 */
export const REFACTOR_OBSERVATION_KINDS = [
  "cycle",
  "direction-violation",
  "evidence-gap",
  "ownership-ambiguous",
  "residual-cycle",
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
export const REFACTOR_PROPOSAL_AUTHOR_KINDS = ["cli", "developer", "mcp", "subagent"] as const;
/**
 * A refactor proposal is authored by an agent surface acting for itself, or by
 * a human acting manually. `daemon`, `system`, `hook`, and `migration` kinds
 * are ArchContext acting on its own behalf and can never author a proposal.
 */
export const REFACTOR_PROPOSAL_AUTHOR_PAIRS: Readonly<Record<RefactorProposalAuthorKind, readonly RefactorProposalAuthorSource[]>> = {
  cli: ["cli"],
  developer: ["manual"],
  mcp: ["mcp"],
  subagent: ["subagent"]
};
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
export type RefactorProposalAuthorKind = (typeof REFACTOR_PROPOSAL_AUTHOR_KINDS)[number];
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
  /**
   * The module set a `moduleDependencies.*` metric is measured over: the two ends of a pair, or the
   * members of a residual cycle. Present exactly for that metric family, sorted and unique.
   */
  memberNodeIds?: string[];
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
  /**
   * The most CodeGraph import nodes the scan reads. Omitted means the runtime default. A larger
   * index gives partial coverage with `code-facts-import-limit`, never `code-facts-truncated`.
   */
  importNodeLimit?: number;
}

/**
 * The JSON ingress for `refactor verify`. `recommendationId` is the whole subject: a verification
 * always re-measures whatever is at HEAD now, so there is no caller-supplied AFTER state and no
 * outcome override — the recorded recommendation already carries the acceptance test, and letting
 * a caller restate it would let the requester steer its own verdict.
 *
 * `expectedHeadSha` and `expectedWorktreeDigest` are claims about the state the caller believes it
 * is verifying. A claim that no longer holds is refused rather than answered with fresh numbers
 * under the old identity.
 */
export interface RefactorVerificationRequestV1 {
  schemaVersion: typeof REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION;
  recommendationId: string;
  expectedHeadSha?: string;
  expectedWorktreeDigest?: string;
  executionEvidenceRefs?: RefactorExecutionEvidenceRefV1[];
  /**
   * The most CodeGraph import nodes the re-measure reads. Omitted means the limit the recorded
   * baseline snapshot was measured with, so BEFORE and AFTER read the same import population.
   */
  importNodeLimit?: number;
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
  /**
   * `callerCoverage` is a graph-boundary resolution ratio (the share of the
   * module's inbound call boundary the index could resolve), not a test
   * measurement, so it is independent of `coverageStatus`: a producer may know
   * the boundary ratio while observing no test evidence at all, and it may know
   * test files while the boundary stays unresolved. Only the 0-1 ratio bound is
   * enforced; the two fields are never coupled (PRD 0.3-16).
   */
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

/**
 * One ordered cross-module dependency of the measured graph: `distinctFileEdgeCount` distinct
 * file-to-file import edges whose source file `fromNodeId` owns and whose target `toNodeId` owns.
 * A contested file is attributed to each claimant, exactly as the module counts are.
 */
export interface ModuleDependencyV1 {
  fromNodeId: string;
  toNodeId: string;
  distinctFileEdgeCount: number;
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
    /**
     * True only when the read is shorter than the population the index reported. A read cut by
     * `edgeLimit` is not truncated: it reports `code-facts-import-limit` instead.
     */
    truncated: boolean;
    /** The import-node read limit the scan applied. */
    edgeLimit: number | null;
    /**
     * Import nodes the index reported, or `null` when no index gave a count. Absent on snapshots
     * recorded before the field existed.
     */
    importNodeCount?: number | null;
    reasonCodes: RefactorScaleReasonCode[];
  };
  modules: ModuleStatisticsV1[];
  /**
   * The module dependency table the graph counts were measured from, sorted by
   * `(fromNodeId, toNodeId)`; one entry per `repositorySummary.crossModuleEdgeCount`. Empty when the
   * graph was not measured (`codeFacts.coverage: unknown`).
   */
  moduleDependencies: ModuleDependencyV1[];
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

/**
 * The fixed per-observation bound on sampled evidence entries (edges, violations, paths,
 * unresolved imports). It bounds entry *count* only: a path or a specifier has no fixed byte
 * size, so this bound alone does not keep a recording event under the ledger's persisted-JSON
 * ceiling. The recording planner enforces that separately, by measuring the event it would
 * persist and shrinking every sample to one shared smaller limit until the event fits.
 */
export const REFACTOR_OBSERVATION_EVIDENCE_LIMIT = 20;
/**
 * The fixed bound on every id list inside evidence (`memberNodeIds`, `constraintIds`,
 * `candidateOwnerNodeIds`). Each list is the sorted prefix of its population and carries the true
 * size beside it (`metrics.memberCount`, `constraintCount`, `candidateOwnerCount`). It is no
 * smaller than `REFACTOR_OBSERVATION_EVIDENCE_LIMIT`, so the constraints named by a violation
 * sample — the smallest ids, since violations sort by constraint first — are always listed.
 */
export const REFACTOR_EVIDENCE_ID_LIST_LIMIT = 32;
/** An import specifier is a module reference, not code: one line, bounded like a locator. */
export const REFACTOR_EVIDENCE_SPECIFIER_MAX_LENGTH = 512;

/**
 * One observed file-level import edge, as bounded metadata only: two repo-relative paths, the
 * line the import sits on, the specifier verbatim and the owning nodes. Never a source body.
 * `toPath` carries no line: an import names a module, not a position inside it.
 */
export interface RefactorEvidenceImportEdgeV1 {
  fromPath: string;
  /** 1-based line of the import statement in `fromPath`; `null` when the code index reported none. */
  fromLine: number | null;
  toPath: string;
  specifier: string;
  fromNodeId: string;
  toNodeId: string;
}

export interface RefactorEvidenceDirectionViolationV1 extends RefactorEvidenceImportEdgeV1 {
  constraintId: string;
}

export interface RefactorEvidencePathV1 {
  path: string;
  /**
   * Declared nodes that bear on this path, per kind: for `ownership-ambiguous` every node that
   * claims it; for `unowned-paths` the nodes that own another tracked file in the same directory;
   * for `undeclared-footprint` the nodes that currently own the entrypoint path the node declares.
   */
  candidateOwnerNodeIds: string[];
  /** How many candidate owners exist; `candidateOwnerNodeIds` is its sorted, bounded prefix. */
  candidateOwnerCount: number;
}

export interface RefactorEvidenceUnresolvedImportV1 {
  fromPath: string;
  fromLine: number | null;
  specifier: string;
}

/** A bounded sample: `totalCount` is the population, `truncated` says the list is a prefix of it. */
interface RefactorEvidenceSampleV1 {
  totalCount: number;
  truncated: boolean;
}

/**
 * Typed evidence per observation kind: the concrete items behind the observation's metrics, so a
 * reader can see *why* it exists without re-running the measurement. Samples are sorted, bounded
 * by `REFACTOR_OBSERVATION_EVIDENCE_LIMIT`, and derived from the same measurement as the snapshot;
 * id lists are sorted prefixes bounded by `REFACTOR_EVIDENCE_ID_LIST_LIMIT`.
 *
 * `memberNodeIds` is the prefix of the component's members; its population is the observation's
 * `metrics.memberCount`.
 */
/**
 * One direction of a bidirectional pair: its import-edge population and how many of the sampled
 * `edges` it holds. The thin direction (fewer distinct file edges, ties to the canonical forward
 * direction) is listed first and is sampled first.
 */
export interface RefactorEvidencePairDirectionV1 {
  fromNodeId: string;
  toNodeId: string;
  totalCount: number;
  sampledCount: number;
}

export type RefactorObservationEvidenceV1 =
  | ({
    kind: "cycle";
    /** The pair, sorted: `[A, B]`. */
    memberNodeIds: string[];
    /** `[thin, thick]`; `totalCount` is their sum. */
    directions: RefactorEvidencePairDirectionV1[];
    edges: RefactorEvidenceImportEdgeV1[];
  } & RefactorEvidenceSampleV1)
  | ({ kind: "residual-cycle"; memberNodeIds: string[]; edges: RefactorEvidenceImportEdgeV1[] } & RefactorEvidenceSampleV1)
  | ({
    kind: "direction-violation";
    constraintIds: string[];
    /** How many distinct constraints the module violates; `constraintIds` is its bounded prefix. */
    constraintCount: number;
    violations: RefactorEvidenceDirectionViolationV1[];
  } & RefactorEvidenceSampleV1)
  | ({ kind: "ownership-ambiguous" | "undeclared-footprint" | "unowned-paths"; paths: RefactorEvidencePathV1[] } & RefactorEvidenceSampleV1)
  | ({
    kind: "evidence-gap";
    coverage: EvidenceCoverageLevelV2;
    reasonCodes: RefactorScaleReasonCode[];
    unresolvedImports: RefactorEvidenceUnresolvedImportV1[];
  } & RefactorEvidenceSampleV1);

export interface RefactorObservationV1 {
  kind: RefactorObservationKind;
  subjectSelectorId: string;
  /**
   * The declared nodes this observation is about, sorted and unique, authored by the producer that
   * measured it: a node subject is `[nodeId]`, a pair its two ends, a residual cycle its members, a
   * repository-wide fact `[]`. Scopes filter on it and the planner copies it; nothing re-derives it.
   */
  affectedNodeIds: string[];
  signalIds: string[];
  metrics: Record<string, number | null>;
  evidence: RefactorObservationEvidenceV1;
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
  issues.push(...refactorProposalAuthorIssues(proposal.authoredBy, prefix));
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
  const temporaryRelations = new Set(delta.migrationState.temporaryRelations);
  for (const relation of delta.targetState.requiredRelations) {
    if (temporaryRelations.has(relation)) {
      issues.push(`${prefix}.targetState.requiredRelations must not contain migration-only relation: ${relation}`);
    }
  }
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
  if (request.importNodeLimit !== undefined && !(Number.isInteger(request.importNodeLimit) && request.importNodeLimit >= 1)) {
    issues.push(`${prefix}.importNodeLimit must be a positive integer`);
  }
  return issues;
}

/**
 * Validates a `refactor verify` request before anything measures on its behalf.
 *
 * Top-level keys are closed to `REFACTOR_VERIFICATION_REQUEST_KEYS`. Every ingress rebuilds the
 * request from the declared fields, so a typo (`expectedWorktreeDigset`) would otherwise be
 * dropped in silence and the caller's freshness claim would simply cease to exist — the request
 * would be answered under a weaker precondition than the one it stated.
 *
 * `executionEvidenceRefs` are checked under exactly the rules that bind them into the ledger:
 * three declared keys and nothing else, a kind from the frozen vocabulary, and a bare SHA-256.
 * An extra key would ride a cast into a record whose envelope promises no raw bodies, and the
 * resolution-evidence validator only ever inspects `locator` and `sha256`, so it would never see
 * it. Refusing here is the only place that key is still visible.
 */
export function refactorVerificationRequestInvariantIssues(
  request: RefactorVerificationRequestV1,
  prefix = "request"
): string[] {
  const issues: string[] = [];
  const unknownKeys = Object.keys(request as unknown as Record<string, unknown>)
    .filter((key) => !(REFACTOR_VERIFICATION_REQUEST_KEYS as readonly string[]).includes(key))
    .sort();
  if (unknownKeys.length > 0) issues.push(`${prefix} has unsupported key(s): ${unknownKeys.join(", ")}`);
  if (request.schemaVersion !== REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION) issues.push(`${prefix}.schemaVersion is invalid`);
  if (typeof request.recommendationId !== "string" || request.recommendationId.trim() === "") {
    issues.push(`${prefix}.recommendationId must be a non-empty string`);
  }
  if (request.expectedHeadSha !== undefined && !GIT_HEAD_SHA_PATTERN.test(request.expectedHeadSha)) {
    issues.push(`${prefix}.expectedHeadSha must be a 40-hex Git commit sha`);
  }
  if (request.expectedWorktreeDigest !== undefined) {
    issues.push(...digestIssues(`${prefix}.expectedWorktreeDigest`, request.expectedWorktreeDigest));
  }
  if (request.importNodeLimit !== undefined && !(Number.isInteger(request.importNodeLimit) && request.importNodeLimit >= 1)) {
    issues.push(`${prefix}.importNodeLimit must be a positive integer`);
  }
  if (request.executionEvidenceRefs !== undefined) {
    if (!Array.isArray(request.executionEvidenceRefs)) {
      issues.push(`${prefix}.executionEvidenceRefs must be an array`);
      return issues;
    }
    request.executionEvidenceRefs.forEach((ref, index) => {
      const label = `${prefix}.executionEvidenceRefs[${index}]`;
      if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
        issues.push(`${label} must be an object`);
        return;
      }
      const extras = Object.keys(ref).filter((key) => key !== "kind" && key !== "locator" && key !== "sha256");
      if (extras.length > 0) issues.push(`${label} has unsupported key(s): ${[...extras].sort().join(", ")}`);
      if (!(REFACTOR_EXECUTION_EVIDENCE_KINDS as readonly string[]).includes(ref.kind)) {
        issues.push(`${label}.kind must be one of ${REFACTOR_EXECUTION_EVIDENCE_KINDS.join(", ")}`);
      }
      if (typeof ref.locator !== "string" || ref.locator.trim() === "") {
        issues.push(`${label}.locator must be a non-empty string`);
      } else if (!REFACTOR_EXECUTION_EVIDENCE_LOCATOR_PATTERN.test(ref.locator)) {
        issues.push(`${label}.locator ${REFACTOR_EXECUTION_EVIDENCE_LOCATOR_RULE}`);
      }
      if (typeof ref.sha256 !== "string" || !BARE_SHA256_PATTERN.test(ref.sha256)) {
        issues.push(`${label}.sha256 must be a bare SHA-256 hex digest`);
      }
    });
  }
  return issues;
}

export function moduleStatisticsInvariantIssues(module: ModuleStatisticsV1, prefix = "module"): string[] {
  const issues = [...digestIssues(`${prefix}.moduleDigest`, module.moduleDigest), ...digestIssues(`${prefix}.nodeDigest`, module.nodeDigest)];
  if (module.nodeId.trim() === "") issues.push(`${prefix}.nodeId must not be empty`);
  if (module.footprintDeclared === (module.footprint === null)) {
    issues.push(`${prefix}.footprint must be present exactly when footprintDeclared is true`);
  }
  if (module.footprint) {
    issues.push(
      ...digestIssues(`${prefix}.footprint.sourceFilesDigest`, module.footprint.sourceFilesDigest),
      ...nonNegativeIntegerIssues(`${prefix}.footprint.fileCount`, module.footprint.fileCount),
      ...nonNegativeIntegerIssues(`${prefix}.footprint.lineCount`, module.footprint.lineCount)
    );
  }
  if (module.dependencyGraph) {
    const graph = module.dependencyGraph;
    issues.push(
      ...nonNegativeIntegerIssues(`${prefix}.dependencyGraph.internalEdgeCount`, graph.internalEdgeCount),
      ...nonNegativeIntegerIssues(`${prefix}.dependencyGraph.inboundModuleEdges`, graph.inboundModuleEdges),
      ...nonNegativeIntegerIssues(`${prefix}.dependencyGraph.outboundModuleEdges`, graph.outboundModuleEdges),
      ...nonNegativeIntegerIssues(`${prefix}.dependencyGraph.fanIn`, graph.fanIn),
      ...nonNegativeIntegerIssues(`${prefix}.dependencyGraph.fanOut`, graph.fanOut),
      ...nonNegativeIntegerIssues(`${prefix}.dependencyGraph.cycleCount`, graph.cycleCount),
      ...nonNegativeIntegerIssues(`${prefix}.dependencyGraph.directionViolationCount`, graph.directionViolationCount),
      ...ratioIssues(`${prefix}.dependencyGraph.instability`, graph.instability)
    );
  }
  issues.push(
    ...nonNegativeIntegerIssues(`${prefix}.tests.testFileCount`, module.tests.testFileCount),
    ...nonNegativeIntegerIssues(`${prefix}.tests.observedTestEdges`, module.tests.observedTestEdges),
    ...ratioIssues(`${prefix}.tests.callerCoverage`, module.tests.callerCoverage),
    ...nonNegativeIntegerIssues(`${prefix}.uncertainty.unresolvedImports`, module.uncertainty.unresolvedImports)
  );
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
  if (snapshot.codeFacts.coverage !== "unknown") {
    if (snapshot.codeFacts.indexedWorktreeDigest === null) {
      issues.push(`${prefix}.codeFacts.indexedWorktreeDigest must be present when coverage is ${snapshot.codeFacts.coverage}`);
    } else if (snapshot.codeFacts.indexedWorktreeDigest !== snapshot.worktree.worktreeDigest) {
      issues.push(`${prefix}.codeFacts.indexedWorktreeDigest must match the measured worktreeDigest`);
    }
  }
  issues.push(...nonNegativeIntegerIssues(`${prefix}.codeFacts.edgeLimit`, snapshot.codeFacts.edgeLimit));
  const importNodeCount = snapshot.codeFacts.importNodeCount ?? null;
  issues.push(...nonNegativeIntegerIssues(`${prefix}.codeFacts.importNodeCount`, importNodeCount));
  if (snapshot.codeFacts.reasonCodes.includes("code-facts-import-limit")) {
    const { edgeLimit } = snapshot.codeFacts;
    if (snapshot.codeFacts.coverage !== "partial") issues.push(`${prefix}.codeFacts.coverage must be partial when the import limit was reached`);
    if (edgeLimit === null || (importNodeCount !== null && importNodeCount <= edgeLimit)) {
      issues.push(`${prefix}.codeFacts.importNodeCount must exceed edgeLimit when the import limit was reached`);
    }
  }
  for (const [field, value] of Object.entries(snapshot.repositorySummary)) {
    issues.push(...nonNegativeIntegerIssues(`${prefix}.repositorySummary.${field}`, value));
  }
  issues.push(...moduleDependencyIssues(snapshot, prefix));
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

/**
 * The dependency table binds the graph counts it was measured with: sorted and unique by
 * `(fromNodeId, toNodeId)`, positive counts, no self edge, both ends measured modules, one entry per
 * counted cross-module edge, and nothing at all when the graph was not measured.
 */
function moduleDependencyIssues(snapshot: ModuleStatisticsSnapshotV1, prefix: string): string[] {
  const label = `${prefix}.moduleDependencies`;
  const dependencies = (snapshot as { moduleDependencies?: unknown }).moduleDependencies;
  if (!Array.isArray(dependencies)) return [`${label} must be an array`];
  const issues: string[] = [];
  const modules = new Set(snapshot.modules.map((module) => module.nodeId));
  for (const [index, entry] of (dependencies as ModuleDependencyV1[]).entries()) {
    if (!entry || typeof entry !== "object") {
      issues.push(`${label}[${index}] must be an object`);
      continue;
    }
    if (!modules.has(entry.fromNodeId) || !modules.has(entry.toNodeId)) issues.push(`${label}[${index}] must name measured modules`);
    if (entry.fromNodeId === entry.toNodeId) issues.push(`${label}[${index}] must not be a self dependency`);
    if (!Number.isInteger(entry.distinctFileEdgeCount) || entry.distinctFileEdgeCount < 1) {
      issues.push(`${label}[${index}].distinctFileEdgeCount must be a positive integer`);
    }
    const previous = (dependencies as ModuleDependencyV1[])[index - 1];
    if (previous && (compareText(previous.fromNodeId, entry.fromNodeId) || compareText(previous.toNodeId, entry.toNodeId)) >= 0) {
      issues.push(`${label} must be sorted and unique by (fromNodeId, toNodeId)`);
    }
  }
  if (dependencies.length !== snapshot.repositorySummary.crossModuleEdgeCount) {
    issues.push(`${label} must hold one entry per repositorySummary.crossModuleEdgeCount`);
  }
  if (snapshot.codeFacts.coverage === "unknown" && dependencies.length > 0) {
    issues.push(`${label} must be empty when codeFacts.coverage is unknown`);
  }
  return [...new Set(issues)];
}

/**
 * How a pair's evidence sample of `limit` entries is split: the thin direction first, but one slot
 * is kept for the thick direction whenever there are two or more slots, so both directions are
 * always shown. Taking the thin direction first is what keeps a single thin edge visible beside
 * any number of thick ones. Resampling a sample with a smaller limit gives exactly this split of
 * the population, so the planner's evidence cut stays on the same rule.
 */
export function refactorPairSampleAllocation(thinTotal: number, thickTotal: number, limit: number): { thin: number; thick: number } {
  const slots = Math.max(0, Math.min(limit, thinTotal + thickTotal));
  const reserve = thickTotal > 0 && slots >= 2 ? 1 : 0;
  const thin = Math.min(thinTotal, slots - reserve);
  return { thin, thick: Math.min(thickTotal, slots - thin) };
}

/**
 * Cuts a pair's evidence to `limit` entries under `refactorPairSampleAllocation`. `evidence.edges`
 * may be the whole population or an earlier sample of it: each direction keeps its first entries in
 * canonical order, and the result is re-sorted canonically.
 */
export function sampleRefactorPairEvidence(
  evidence: Extract<RefactorObservationEvidenceV1, { kind: "cycle" }>,
  limit: number
): Extract<RefactorObservationEvidenceV1, { kind: "cycle" }> {
  const [thin, thick] = evidence.directions as [RefactorEvidencePairDirectionV1, RefactorEvidencePairDirectionV1];
  const allocation = refactorPairSampleAllocation(thin.totalCount, thick.totalCount, Math.min(limit, REFACTOR_OBSERVATION_EVIDENCE_LIMIT));
  const sorted = [...evidence.edges].sort(compareRefactorEvidenceImportEdges);
  const inDirection = (direction: RefactorEvidencePairDirectionV1) => sorted.filter((edge) =>
    edge.fromNodeId === direction.fromNodeId && edge.toNodeId === direction.toNodeId);
  const thinEdges = inDirection(thin).slice(0, allocation.thin);
  const thickEdges = inDirection(thick).slice(0, allocation.thick);
  const edges = [...thinEdges, ...thickEdges].sort(compareRefactorEvidenceImportEdges);
  return {
    ...evidence,
    directions: [
      { ...thin, sampledCount: thinEdges.length },
      { ...thick, sampledCount: thickEdges.length }
    ],
    edges,
    truncated: evidence.totalCount > edges.length
  };
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
    issues.push(...(Array.isArray(observation.affectedNodeIds)
      ? sortedUniqueIssues(`${prefix}.observations[${index}].affectedNodeIds`, observation.affectedNodeIds)
      : [`${prefix}.observations[${index}].affectedNodeIds must be an array`]));
    issues.push(...refactorObservationEvidenceIssues(observation, `${prefix}.observations[${index}]`));
  }
  issues.push(...ratioIssues(`${prefix}.confidence.callerCoverage`, assessment.confidence.callerCoverage));
  if (!Number.isInteger(assessment.pressure.score) || assessment.pressure.score < 0 || assessment.pressure.score > 100) {
    issues.push(`${prefix}.pressure.score must be an integer between 0 and 100`);
  }
  issues.push(...sortedUniqueIssues(`${prefix}.pressure.signalIds`, assessment.pressure.signalIds));
  if (refactorAssessmentDigest(assessment) !== assessment.assessmentDigest) {
    issues.push(`${prefix}.assessmentDigest must bind the assessed payload`);
  }
  return issues;
}

/** The one ordering for evidence edges: path, line, target, specifier, then owners. */
export function compareRefactorEvidenceImportEdges(left: RefactorEvidenceImportEdgeV1, right: RefactorEvidenceImportEdgeV1): number {
  return compareText(left.fromPath, right.fromPath)
    || compareLine(left.fromLine, right.fromLine)
    || compareText(left.toPath, right.toPath)
    || compareText(left.specifier, right.specifier)
    || compareText(left.fromNodeId, right.fromNodeId)
    || compareText(left.toNodeId, right.toNodeId);
}

export function compareRefactorEvidenceDirectionViolations(
  left: RefactorEvidenceDirectionViolationV1,
  right: RefactorEvidenceDirectionViolationV1
): number {
  return compareText(left.constraintId, right.constraintId) || compareRefactorEvidenceImportEdges(left, right);
}

export function compareRefactorEvidenceUnresolvedImports(
  left: RefactorEvidenceUnresolvedImportV1,
  right: RefactorEvidenceUnresolvedImportV1
): number {
  return compareText(left.fromPath, right.fromPath)
    || compareLine(left.fromLine, right.fromLine)
    || compareText(left.specifier, right.specifier);
}

/**
 * Validates one observation's evidence against the observation it explains: matching kind, the
 * fixed sample and id-list bounds, an honest `truncated` flag and id-list counts, the canonical
 * order, repo-relative paths, positive lines and one-line bounded specifiers. Where a metric counts exactly the evidence population,
 * `totalCount` must equal it, so the sample can never describe a different measurement.
 */
export function refactorObservationEvidenceIssues(observation: RefactorObservationV1, prefix = "observation"): string[] {
  const evidence = observation.evidence as RefactorObservationEvidenceV1 | undefined;
  const label = `${prefix}.evidence`;
  if (!evidence || typeof evidence !== "object") return [`${label} is required`];
  if (evidence.kind !== observation.kind) return [`${label}.kind must equal the observation kind ${observation.kind}`];
  const issues: string[] = [];
  const sample = (entries: readonly unknown[], field: string): void => {
    if (entries.length > REFACTOR_OBSERVATION_EVIDENCE_LIMIT) {
      issues.push(`${label}.${field} must hold at most ${REFACTOR_OBSERVATION_EVIDENCE_LIMIT} entries`);
    }
    if (!Number.isInteger(evidence.totalCount) || evidence.totalCount < entries.length) {
      issues.push(`${label}.totalCount must be an integer no smaller than the ${field} length`);
    }
    if (evidence.truncated !== evidence.totalCount > entries.length) {
      issues.push(`${label}.truncated must be true exactly when totalCount exceeds the ${field} length`);
    }
  };
  const ordered = <T>(entries: readonly T[], field: string, compare: (left: T, right: T) => number): void => {
    for (let index = 1; index < entries.length; index += 1) {
      if (compare(entries[index - 1]!, entries[index]!) >= 0) {
        issues.push(`${label}.${field} must be sorted and unique`);
        return;
      }
    }
  };
  const edgeIssues = (edge: RefactorEvidenceImportEdgeV1, field: string): void => {
    issues.push(...repoPathIssues(`${label}.${field}.fromPath`, edge.fromPath), ...repoPathIssues(`${label}.${field}.toPath`, edge.toPath));
    issues.push(...lineIssues(`${label}.${field}.fromLine`, edge.fromLine), ...specifierIssues(`${label}.${field}.specifier`, edge.specifier));
    if (edge.fromNodeId.trim() === "" || edge.toNodeId.trim() === "") issues.push(`${label}.${field} node ids must not be empty`);
  };
  // An id list is the sorted prefix of a population of `count`: exactly min(count, limit) long.
  const idList = (ids: readonly string[], count: unknown, field: string, countField: string): void => {
    issues.push(...sortedUniqueIssues(`${label}.${field}`, ids));
    if (!Number.isInteger(count) || (count as number) < 0) {
      issues.push(`${label}.${countField} must be a non-negative integer`);
    } else if (ids.length !== Math.min(count as number, REFACTOR_EVIDENCE_ID_LIST_LIMIT)) {
      issues.push(`${label}.${field} must hold min(${countField}, ${REFACTOR_EVIDENCE_ID_LIST_LIMIT}) entries`);
    }
  };
  switch (evidence.kind) {
    case "cycle": {
      sample(evidence.edges, "edges");
      ordered(evidence.edges, "edges", compareRefactorEvidenceImportEdges);
      issues.push(...pairEvidenceIssues(observation, evidence, label));
      for (const edge of evidence.edges) edgeIssues(edge, "edges");
      break;
    }
    case "residual-cycle": {
      sample(evidence.edges, "edges");
      ordered(evidence.edges, "edges", compareRefactorEvidenceImportEdges);
      idList(evidence.memberNodeIds, observation.metrics.memberCount, "memberNodeIds", "metrics.memberCount");
      // Membership is checkable only against the complete member list.
      const complete = evidence.memberNodeIds.length === observation.metrics.memberCount;
      for (const edge of evidence.edges) {
        edgeIssues(edge, "edges");
        if (complete && (!evidence.memberNodeIds.includes(edge.fromNodeId) || !evidence.memberNodeIds.includes(edge.toNodeId))) {
          issues.push(`${label}.edges must stay inside the component's member nodes`);
        }
      }
      break;
    }
    case "direction-violation":
      sample(evidence.violations, "violations");
      ordered(evidence.violations, "violations", compareRefactorEvidenceDirectionViolations);
      idList(evidence.constraintIds, evidence.constraintCount, "constraintIds", "constraintCount");
      for (const violation of evidence.violations) {
        edgeIssues(violation, "violations");
        if (!evidence.constraintIds.includes(violation.constraintId)) issues.push(`${label}.violations must name a listed constraintId`);
      }
      if (evidence.totalCount !== observation.metrics.directionViolationCount) {
        issues.push(`${label}.totalCount must equal metrics.directionViolationCount`);
      }
      break;
    case "ownership-ambiguous":
    case "undeclared-footprint":
    case "unowned-paths":
      sample(evidence.paths, "paths");
      ordered(evidence.paths, "paths", (left, right) => compareText(left.path, right.path));
      for (const entry of evidence.paths) {
        issues.push(...repoPathIssues(`${label}.paths.path`, entry.path));
        idList(entry.candidateOwnerNodeIds, entry.candidateOwnerCount, "paths.candidateOwnerNodeIds", "paths.candidateOwnerCount");
      }
      if (evidence.kind === "unowned-paths" && evidence.totalCount !== observation.metrics.unownedFileCount) {
        issues.push(`${label}.totalCount must equal metrics.unownedFileCount`);
      }
      break;
    case "evidence-gap":
      sample(evidence.unresolvedImports, "unresolvedImports");
      ordered(evidence.unresolvedImports, "unresolvedImports", compareRefactorEvidenceUnresolvedImports);
      issues.push(...sortedUniqueIssues(`${label}.reasonCodes`, evidence.reasonCodes));
      for (const entry of evidence.unresolvedImports) {
        issues.push(...repoPathIssues(`${label}.unresolvedImports.fromPath`, entry.fromPath));
        issues.push(...lineIssues(`${label}.unresolvedImports.fromLine`, entry.fromLine));
        issues.push(...specifierIssues(`${label}.unresolvedImports.specifier`, entry.specifier));
      }
      if (evidence.totalCount !== observation.metrics.unresolvedImportCount) {
        issues.push(`${label}.totalCount must equal metrics.unresolvedImportCount`);
      }
      break;
    default:
      issues.push(`${label}.kind is unsupported`);
  }
  return [...new Set(issues)];
}

/**
 * A pair's evidence explains exactly that pair: its two ends are the observation's affected nodes,
 * every edge runs between them in one of the two listed directions, the thin direction (by the
 * observation's own distinct-file-edge counts, ties to the forward direction) comes first, each
 * direction's `sampledCount` is the number of its edges in the sample, and the split is the one
 * `refactorPairSampleAllocation` prescribes for the sample size.
 */
function pairEvidenceIssues(
  observation: RefactorObservationV1,
  evidence: Extract<RefactorObservationEvidenceV1, { kind: "cycle" }>,
  label: string
): string[] {
  const issues: string[] = [];
  const members = evidence.memberNodeIds;
  if (!Array.isArray(members) || members.length !== 2 || !(members[0]! < members[1]!)) {
    return [`${label}.memberNodeIds must be the two pair ends, sorted`];
  }
  const [first, second] = members as [string, string];
  if (Array.isArray(observation.affectedNodeIds) && (observation.affectedNodeIds.length !== 2
    || observation.affectedNodeIds[0] !== first || observation.affectedNodeIds[1] !== second)) {
    issues.push(`${label}.memberNodeIds must equal the observation affectedNodeIds`);
  }
  const forward = observation.metrics.forwardEdgeCount;
  const backward = observation.metrics.backwardEdgeCount;
  if (!Number.isInteger(forward) || !Number.isInteger(backward) || (forward as number) < 1 || (backward as number) < 1) {
    issues.push(`${label} requires positive integer metrics.forwardEdgeCount and metrics.backwardEdgeCount`);
    return issues;
  }
  if (observation.metrics.thinDirectionEdgeCount !== Math.min(forward as number, backward as number)) {
    issues.push(`${label} requires metrics.thinDirectionEdgeCount = min(forwardEdgeCount, backwardEdgeCount)`);
  }
  if (observation.metrics.totalEdgeCount !== (forward as number) + (backward as number)) {
    issues.push(`${label} requires metrics.totalEdgeCount = forwardEdgeCount + backwardEdgeCount`);
  }
  const directions = evidence.directions;
  if (!Array.isArray(directions) || directions.length !== 2) return [...issues, `${label}.directions must list the thin then the thick direction`];
  const [thin, thick] = directions as [RefactorEvidencePairDirectionV1, RefactorEvidencePairDirectionV1];
  const forwardIsThin = (forward as number) <= (backward as number);
  const expectedThin = forwardIsThin ? [first, second] : [second, first];
  if (thin.fromNodeId !== expectedThin[0] || thin.toNodeId !== expectedThin[1]
    || thick.fromNodeId !== expectedThin[1] || thick.toNodeId !== expectedThin[0]) {
    issues.push(`${label}.directions must be [thin, thick] by the pair's distinct file edge counts`);
  }
  for (const direction of directions) {
    if (!Number.isInteger(direction.totalCount) || direction.totalCount < 1) issues.push(`${label}.directions totalCount must be a positive integer`);
    const sampled = evidence.edges.filter((edge) => edge.fromNodeId === direction.fromNodeId && edge.toNodeId === direction.toNodeId).length;
    if (direction.sampledCount !== sampled) issues.push(`${label}.directions sampledCount must count the sampled edges of that direction`);
    if (sampled > direction.totalCount) issues.push(`${label}.directions sample must not exceed the direction population`);
  }
  if (thin.totalCount + thick.totalCount !== evidence.totalCount) issues.push(`${label}.totalCount must be the sum of both directions`);
  if (evidence.edges.some((edge) => !((edge.fromNodeId === first && edge.toNodeId === second) || (edge.fromNodeId === second && edge.toNodeId === first)))) {
    issues.push(`${label}.edges must run between the pair's two ends`);
  }
  const allocation = refactorPairSampleAllocation(thin.totalCount, thick.totalCount, evidence.edges.length);
  if (thin.sampledCount !== allocation.thin || thick.sampledCount !== allocation.thick) {
    issues.push(`${label}.edges must sample the thin direction first and keep one slot for the thick direction`);
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
  for (const expected of evidence.expectedOutcomes) {
    const observed = observedById.get(expected.outcomeId);
    if (!observed) continue;
    const recomputed = outcomeSatisfied(expected, observed.observedValue);
    if (observed.satisfied !== recomputed) {
      issues.push(
        `${prefix}.observedOutcomes ${expected.outcomeId} claims satisfied=${observed.satisfied} but ${expected.metric} ${expected.operator} ${expected.value} against ${observed.observedValue} is ${recomputed}`
      );
    }
  }
  if (evidence.disposition !== "stale") {
    const required = evidence.expectedOutcomes.filter((outcome) => outcome.required);
    const observedRequired = required
      .map((outcome) => {
        const observed = observedById.get(outcome.outcomeId);
        return observed ? { outcome, satisfied: outcomeSatisfied(outcome, observed.observedValue) } : undefined;
      })
      .filter(isPresent);
    const regressed = evidence.observedOutcomes.some((outcome) => outcome.direction === "regressed");
    const satisfiedCount = observedRequired.filter((entry) => entry.satisfied).length;
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

/**
 * Guards the one invariant the `RecommendationV3` union cannot enforce at
 * runtime: that `payload` matches `category`. A non-object or mismatched
 * payload yields issues instead of throwing. Every other field is trusted to
 * match its declared type; structural validation of untrusted ingress is the
 * job of the JSON Schemas, not of this validator.
 *
 * The fingerprint hash itself stays owned by `recommendationFingerprint()` in
 * `packages/core/recommendation-engine`: contracts must not import core, and
 * re-deriving the hash here would fork it into two definitions. This validator
 * therefore checks the fingerprint's shape, not its value.
 */
export function recommendationV3InvariantIssues(recommendation: RecommendationV3, prefix = "recommendation"): string[] {
  const issues = [
    ...sortedUniqueIssues(`${prefix}.evidenceBindingIds`, recommendation.evidenceBindingIds),
    ...digestIssues(`${prefix}.fingerprint`, recommendation.fingerprint)
  ];
  if (recommendation.schemaVersion !== RECOMMENDATION_V3_SCHEMA_VERSION) issues.push(`${prefix}.schemaVersion is invalid`);
  if (!(RECOMMENDATION_CATEGORIES as readonly string[]).includes(recommendation.category)) {
    issues.push(`${prefix}.category is unsupported: ${recommendation.category}`);
    return issues;
  }
  if (recommendation.subjectSelectorId.trim() === "") issues.push(`${prefix}.subjectSelectorId must not be empty`);
  if (recommendation.authoredBy.id.trim() === "") issues.push(`${prefix}.authoredBy.id must not be empty`);
  const shapeIssues = recommendationPayloadShapeIssues(recommendation.category, recommendation.payload, prefix);
  issues.push(...shapeIssues);
  if (recommendation.category === "practice" && !recommendation.practiceId) {
    issues.push(`${prefix}.practiceId is required for practice recommendations`);
  }
  if (recommendation.category === "structural_observation") {
    if (recommendation.authoredBy.source !== "daemon") {
      issues.push(`${prefix}.structural_observation must be authored by the daemon`);
    }
    if (recommendation.authoredBy.kind !== "daemon") {
      issues.push(`${prefix}.structural_observation must be authored by the daemon actor kind`);
    }
    if (recommendation.enforcement !== "advisory") {
      issues.push(`${prefix}.structural_observation enforcement must be advisory`);
    }
    if (shapeIssues.length === 0) {
      // The payload is self-contained: the observation's metrics, signals and evidence travel with
      // it, so the same evidence rules bind a recorded record and a fresh assessment.
      const payload = recommendation.payload as StructuralObservationPayloadV1;
      issues.push(
        ...sortedUniqueIssues(`${prefix}.payload.signalIds`, payload.signalIds),
        ...refactorObservationEvidenceIssues(
          {
            kind: payload.kind,
            subjectSelectorId: recommendation.subject,
            affectedNodeIds: payload.affectedNodeIds,
            signalIds: payload.signalIds,
            metrics: payload.metrics,
            evidence: payload.evidence
          },
          `${prefix}.payload`
        )
      );
    }
  }
  if (recommendation.category === "refactor_proposal") {
    if (!isRefactorProposalAuthorSource(recommendation.authoredBy.source)) {
      issues.push(`${prefix}.refactor_proposal must not be authored by ${recommendation.authoredBy.source}`);
    }
    issues.push(...refactorProposalAuthorIssues(recommendation.authoredBy, prefix));
    if (shapeIssues.length === 0) {
      const payload = recommendation.payload as RefactorProposalPayloadV1;
      const expected = payload.scale === "architecture" ? "complete" : "checkpoint";
      if (recommendation.enforcement !== expected) {
        issues.push(`${prefix}.refactor_proposal with scale ${payload.scale} requires ${expected} enforcement`);
      }
      issues.push(
        ...digestIssues(`${prefix}.payload.proposalDigest`, payload.proposalDigest),
        ...sortedUniqueIssues(`${prefix}.payload.affectedNodeIds`, payload.affectedNodeIds),
        ...sortedUniqueIssues(`${prefix}.payload.majorChangeReasons`, payload.majorChangeReasons)
      );
    }
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
  const indexCoversWorktree =
    afterSnapshot.codeFacts.indexedWorktreeDigest !== null
    && afterSnapshot.codeFacts.indexedWorktreeDigest === afterSnapshot.worktree.worktreeDigest;
  if (!indexCoversWorktree && evidence.disposition === "resolved") {
    issues.push("resolutionEvidence.disposition must not be resolved while the after-snapshot index does not cover the verified worktree");
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

function isRefactorProposalAuthorKind(kind: string): kind is RefactorProposalAuthorKind {
  return (REFACTOR_PROPOSAL_AUTHOR_KINDS as readonly string[]).includes(kind);
}

function refactorProposalAuthorIssues(author: RecommendationAuthorV1, prefix: string): string[] {
  const issues: string[] = [];
  if (author.id.trim() === "") issues.push(`${prefix}.authoredBy.id must not be empty`);
  if (!isRefactorProposalAuthorSource(author.source)) {
    issues.push(`${prefix}.authoredBy.source must not be ${author.source}; refactor proposals are agent or human authored`);
  }
  if (!isRefactorProposalAuthorKind(author.kind)) {
    issues.push(`${prefix}.authoredBy.kind must not be ${author.kind}; refactor proposals are agent or human authored`);
    return issues;
  }
  if (isRefactorProposalAuthorSource(author.source) && !REFACTOR_PROPOSAL_AUTHOR_PAIRS[author.kind].includes(author.source)) {
    issues.push(`${prefix}.authoredBy.kind ${author.kind} is not compatible with source ${author.source}`);
  }
  return issues;
}

function outcomeSatisfied(expected: RefactorTargetOutcomeV1, observedValue: number | null): boolean {
  switch (expected.operator) {
    case "absent":
      return observedValue === null || observedValue === 0;
    case "present":
      return observedValue !== null && observedValue !== 0;
    case "equals":
      return observedValue !== null && expected.value !== null && observedValue === expected.value;
    case "greater_than":
      return observedValue !== null && expected.value !== null && observedValue > expected.value;
    case "less_than":
      return observedValue !== null && expected.value !== null && observedValue < expected.value;
  }
}

function recommendationPayloadShapeIssues(
  category: RecommendationCategory,
  payload: RecommendationPayloadV1,
  prefix: string
): string[] {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return [`${prefix}.payload must be an object for category ${category}`];
  }
  const record = payload as unknown as Record<string, unknown>;
  const required = REQUIRED_PAYLOAD_FIELDS[category];
  const missing = required.filter((field) => !(field in record));
  return missing.length === 0 ? [] : [`${prefix}.payload does not match category ${category}; missing ${missing.sort().join(", ")}`];
}

function nonNegativeIntegerIssues(label: string, value: number | null): string[] {
  if (value === null) return [];
  return Number.isInteger(value) && value >= 0 ? [] : [`${label} must be a non-negative integer`];
}

function ratioIssues(label: string, value: number | null): string[] {
  if (value === null) return [];
  return Number.isFinite(value) && value >= 0 && value <= 1 ? [] : [`${label} must be a ratio between 0 and 1`];
}

const REQUIRED_PAYLOAD_FIELDS: Readonly<Record<RecommendationCategory, readonly string[]>> = {
  practice: ["baselineDigest", "practiceId"],
  refactor_proposal: [
    "affectedNodeIds",
    "assessmentDigest",
    "baselineSnapshotDigest",
    "killList",
    "majorChangeReasons",
    "proposalDigest",
    "scale",
    "targetOutcomes"
  ],
  structural_observation: [
    "affectedNodeIds",
    "assessmentDigest",
    "baselineSnapshotDigest",
    "derivedOutcomes",
    "evidence",
    "kind",
    "metrics",
    "signalIds"
  ]
};

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
    if (outcome.memberNodeIds !== undefined) {
      if (!Array.isArray(outcome.memberNodeIds) || outcome.memberNodeIds.length < 2) {
        issues.push(`${label} memberNodeIds must list at least two modules`);
      } else {
        issues.push(...sortedUniqueIssues(`${label}.memberNodeIds`, outcome.memberNodeIds));
      }
    }
    const valueless = outcome.operator === "absent" || outcome.operator === "present";
    if (valueless && outcome.value !== null) issues.push(`${label} operator ${outcome.operator} must not carry a value`);
    if (!valueless && outcome.value === null) issues.push(`${label} operator ${outcome.operator} requires a value`);
    if (outcome.metric.trim() === "") issues.push(`${label} metric must not be empty`);
  }
  return issues;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** An unknown line sorts before every known one, so the order is total. */
function compareLine(left: number | null, right: number | null): number {
  return (left ?? 0) - (right ?? 0);
}

function repoPathIssues(label: string, path: string): string[] {
  return typeof path === "string" && isRepoRelativePosixPath(path) ? [] : [`${label} must be a repo-relative POSIX path`];
}

function lineIssues(label: string, line: number | null): string[] {
  return line === null || (Number.isInteger(line) && line >= 1) ? [] : [`${label} must be null or a positive integer`];
}

function specifierIssues(label: string, specifier: string): string[] {
  return typeof specifier === "string"
    && specifier.length > 0
    && specifier.length <= REFACTOR_EVIDENCE_SPECIFIER_MAX_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(specifier)
    ? []
    : [`${label} must be a single-line specifier of 1-${REFACTOR_EVIDENCE_SPECIFIER_MAX_LENGTH} characters`];
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

/**
 * The fingerprint schema every refactor recommendation id is derived under. v3 is the first whose
 * subject selector is scoped by the product namespace instead of the worktree path (ADR-0046).
 * Owned here so the planner and the Git decision contract can never name two different versions.
 */
export const REFACTOR_RECOMMENDATION_FINGERPRINT_SCHEMA_VERSION = "archcontext.recommendation-fingerprint/v3" as const;

export const REFACTOR_DECISION_SCHEMA_VERSION = "archcontext.refactor-decision/v1" as const;
/** Git-visible home of human refactor decisions; outside `listModelFiles`, so never in `modelDigest`. */
export const REFACTOR_DECISION_DIRECTORY = ".archcontext/refactor-decisions" as const;
export const REFACTOR_DECISION_FILE_PATTERN = /^\.archcontext\/refactor-decisions\/(recommendation\.[a-f0-9]{16})\.json$/;
export const REFACTOR_RECOMMENDATION_ID_PATTERN = /^recommendation\.[a-f0-9]{16}$/;
/** The six human statuses. `open` is a machine status and is never a decision. */
export const REFACTOR_DECISION_STATUSES = ["acknowledged", "accepted", "deferred", "rejected", "resolved", "waived"] as const;
export const REFACTOR_DECISION_REASON_MAX_LENGTH = 1024;
export const REFACTOR_DECISION_ACTOR_ID_MAX_LENGTH = 128;
export const REFACTOR_DECISION_STABLE_KEY_MAX_LENGTH = 512;
const REFACTOR_DECISION_ACTOR_KINDS: readonly ArchitectureActorKind[] = ["cli", "daemon", "developer", "hook", "mcp", "migration", "subagent", "system"];
const REFACTOR_DECISION_SELECTOR_KINDS: readonly ArchitectureSubjectSelectorKind[] = ["node", "repository"];
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const GIT_CONFLICT_MARKER_PATTERN = /^(<{7}|={7}|>{7}|\|{7})( |$)/m;

export type RefactorDecisionStatus = (typeof REFACTOR_DECISION_STATUSES)[number];

/**
 * The latest human decision for one refactor recommendation generation, stored in Git at
 * `.archcontext/refactor-decisions/<recommendationId>.json` (ADR-0046). It carries identity and the
 * decided measurement only: no absolute path, storage id, source, diff or evidence body.
 */
export interface RefactorDecisionV1 {
  schemaVersion: typeof REFACTOR_DECISION_SCHEMA_VERSION;
  /** The manifest `product.id` the subject selector is scoped by. */
  namespace: string;
  recommendationId: string;
  fingerprint: string;
  fingerprintSchemaVersion: typeof REFACTOR_RECOMMENDATION_FINGERPRINT_SCHEMA_VERSION;
  category: "refactor_proposal" | "structural_observation";
  /** The observation kind; `null` for a refactor proposal. */
  kind: RefactorObservationKind | null;
  subject: {
    selectorKind: ArchitectureSubjectSelectorKind;
    stableKey: string;
    subjectSelectorId: string;
  };
  /** Sorted prefix of the affected nodes, bounded by `REFACTOR_EVIDENCE_ID_LIST_LIMIT`. */
  affectedNodeIds: string[];
  affectedNodeCount: number;
  regressesFrom: string | null;
  status: RefactorDecisionStatus;
  /** The measurement the decision was taken against; `null` when the record carries none. */
  observationMetrics: Record<string, number | null> | null;
  reason: string;
  actor: { kind: ArchitectureActorKind; id: string };
  decidedAt: string;
  provenance: {
    headSha: string;
    assessmentDigest: string;
    baselineSnapshotDigest: string;
  };
}

const REFACTOR_DECISION_KEYS = [
  "actor",
  "affectedNodeCount",
  "affectedNodeIds",
  "category",
  "decidedAt",
  "fingerprint",
  "fingerprintSchemaVersion",
  "kind",
  "namespace",
  "observationMetrics",
  "provenance",
  "reason",
  "recommendationId",
  "regressesFrom",
  "schemaVersion",
  "status",
  "subject"
] as const;

export function isRefactorDecisionStatus(status: RecommendationStatus | string): status is RefactorDecisionStatus {
  return (REFACTOR_DECISION_STATUSES as readonly string[]).includes(status);
}

/**
 * Who states a refactor recommendation's status (ADR-0046): its Git decision file
 * (`git-decision`), a machine status the ledger holds (`ledger`), or nobody — a human status the
 * ledger recorded whose Git file this checkout does not carry is audit only (`ledger-audit`): it
 * keeps its recorded status as history, is never reported as the current status of the subject,
 * and never appears in an open or status listing.
 */
export type RefactorStatusAuthority = "git-decision" | "ledger" | "ledger-audit";

/** The one status rule every reader shares. */
export function refactorRecommendationStatusView(
  ledgerStatus: RecommendationStatus,
  decided: RefactorDecisionStatus | undefined
): { status: RecommendationStatus; authority: RefactorStatusAuthority } {
  if (decided !== undefined) return { status: decided, authority: "git-decision" };
  return { status: ledgerStatus, authority: isRefactorDecisionStatus(ledgerStatus) ? "ledger-audit" : "ledger" };
}

/** The repository path of the decision file for one recommendation id. */
export function refactorDecisionPath(recommendationId: string): string {
  return `${REFACTOR_DECISION_DIRECTORY}/${recommendationId}.json`;
}

/**
 * The one serialization the daemon writes: two-space JSON, LF line endings, keys in declaration
 * order at every level (`observationMetrics` keys sorted), final newline. It does not depend on the
 * key order of the value it is given, so a parsed file serializes back to its own bytes only when
 * it is already canonical.
 */
export function serializeRefactorDecision(decision: RefactorDecisionV1): string {
  const canonical: RefactorDecisionV1 = {
    schemaVersion: decision.schemaVersion,
    namespace: decision.namespace,
    recommendationId: decision.recommendationId,
    fingerprint: decision.fingerprint,
    fingerprintSchemaVersion: decision.fingerprintSchemaVersion,
    category: decision.category,
    kind: decision.kind,
    subject: {
      selectorKind: decision.subject.selectorKind,
      stableKey: decision.subject.stableKey,
      subjectSelectorId: decision.subject.subjectSelectorId
    },
    affectedNodeIds: decision.affectedNodeIds,
    affectedNodeCount: decision.affectedNodeCount,
    regressesFrom: decision.regressesFrom,
    status: decision.status,
    observationMetrics: decision.observationMetrics === null
      ? null
      : Object.fromEntries(Object.entries(decision.observationMetrics).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))),
    reason: decision.reason,
    actor: { kind: decision.actor.kind, id: decision.actor.id },
    decidedAt: decision.decidedAt,
    provenance: {
      headSha: decision.provenance.headSha,
      assessmentDigest: decision.provenance.assessmentDigest,
      baselineSnapshotDigest: decision.provenance.baselineSnapshotDigest
    }
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

/**
 * Validates a decision value: closed key sets at every level, the frozen vocabularies, bounded
 * one-line strings and sorted bounded id lists. Identity that needs the core hashers (the
 * recommendation id from fingerprint and `regressesFrom`, the namespace-scoped selector) is checked
 * by the reader that has them.
 */
export function refactorDecisionInvariantIssues(value: unknown, prefix = "refactorDecision"): string[] {
  if (!isPlainObject(value)) return [`${prefix} must be an object`];
  const issues: string[] = [];
  const unknownKeys = Object.keys(value).filter((key) => !(REFACTOR_DECISION_KEYS as readonly string[]).includes(key)).sort();
  if (unknownKeys.length > 0) issues.push(`${prefix} has unsupported key(s): ${unknownKeys.join(", ")}`);
  const missing = REFACTOR_DECISION_KEYS.filter((key) => !(key in value));
  if (missing.length > 0) issues.push(`${prefix} is missing key(s): ${missing.join(", ")}`);
  if (issues.length > 0) return issues;
  const decision = value as unknown as RefactorDecisionV1;
  if (decision.schemaVersion !== REFACTOR_DECISION_SCHEMA_VERSION) issues.push(`${prefix}.schemaVersion must be ${REFACTOR_DECISION_SCHEMA_VERSION}`);
  issues.push(...refactorNamespaceIssues(decision.namespace, `${prefix}.namespace`));
  if (typeof decision.recommendationId !== "string" || !REFACTOR_RECOMMENDATION_ID_PATTERN.test(decision.recommendationId)) {
    issues.push(`${prefix}.recommendationId must match ${REFACTOR_RECOMMENDATION_ID_PATTERN.source}`);
  }
  if (typeof decision.fingerprint !== "string") issues.push(`${prefix}.fingerprint must be a sha256:<64-hex> digest`);
  else issues.push(...digestIssues(`${prefix}.fingerprint`, decision.fingerprint));
  if (decision.fingerprintSchemaVersion !== REFACTOR_RECOMMENDATION_FINGERPRINT_SCHEMA_VERSION) {
    issues.push(`${prefix}.fingerprintSchemaVersion must be ${REFACTOR_RECOMMENDATION_FINGERPRINT_SCHEMA_VERSION}`);
  }
  if (decision.category !== "structural_observation" && decision.category !== "refactor_proposal") {
    issues.push(`${prefix}.category must be structural_observation or refactor_proposal`);
  } else if (decision.category === "structural_observation"
    ? !(REFACTOR_OBSERVATION_KINDS as readonly unknown[]).includes(decision.kind)
    : decision.kind !== null) {
    issues.push(`${prefix}.kind must be an observation kind for structural_observation and null for refactor_proposal`);
  }
  issues.push(...decisionSubjectIssues(decision.subject, `${prefix}.subject`));
  if (!Array.isArray(decision.affectedNodeIds) || decision.affectedNodeIds.some((id) => typeof id !== "string" || id.trim() === "")) {
    issues.push(`${prefix}.affectedNodeIds must be an array of node ids`);
  } else {
    issues.push(...sortedUniqueIssues(`${prefix}.affectedNodeIds`, decision.affectedNodeIds));
    if (!Number.isInteger(decision.affectedNodeCount) || decision.affectedNodeCount < 0) {
      issues.push(`${prefix}.affectedNodeCount must be a non-negative integer`);
    } else if (decision.affectedNodeIds.length !== Math.min(decision.affectedNodeCount, REFACTOR_EVIDENCE_ID_LIST_LIMIT)) {
      issues.push(`${prefix}.affectedNodeIds must hold min(affectedNodeCount, ${REFACTOR_EVIDENCE_ID_LIST_LIMIT}) entries`);
    }
  }
  if (decision.regressesFrom !== null
    && (typeof decision.regressesFrom !== "string" || !REFACTOR_RECOMMENDATION_ID_PATTERN.test(decision.regressesFrom))) {
    issues.push(`${prefix}.regressesFrom must be null or a recommendation id`);
  }
  if (!isRefactorDecisionStatus(String(decision.status))) {
    issues.push(`${prefix}.status must be one of ${REFACTOR_DECISION_STATUSES.join(", ")}`);
  }
  if (decision.observationMetrics !== null) {
    if (!isPlainObject(decision.observationMetrics)
      || Object.entries(decision.observationMetrics).some(([key, metric]) =>
        key.trim() === "" || !(metric === null || (typeof metric === "number" && Number.isFinite(metric))))) {
      issues.push(`${prefix}.observationMetrics must be null or a map of finite numbers and nulls`);
    }
  }
  issues.push(...boundedLineIssues(`${prefix}.reason`, decision.reason, REFACTOR_DECISION_REASON_MAX_LENGTH));
  if (!isPlainObject(decision.actor) || Object.keys(decision.actor).sort().join(",") !== "id,kind") {
    issues.push(`${prefix}.actor must carry exactly kind and id`);
  } else {
    if (!REFACTOR_DECISION_ACTOR_KINDS.includes(decision.actor.kind)) issues.push(`${prefix}.actor.kind is unsupported`);
    issues.push(...boundedLineIssues(`${prefix}.actor.id`, decision.actor.id, REFACTOR_DECISION_ACTOR_ID_MAX_LENGTH));
  }
  if (typeof decision.decidedAt !== "string" || !ISO_TIMESTAMP_PATTERN.test(decision.decidedAt)) {
    issues.push(`${prefix}.decidedAt must be an ISO-8601 timestamp`);
  }
  if (!isPlainObject(decision.provenance)
    || Object.keys(decision.provenance).sort().join(",") !== "assessmentDigest,baselineSnapshotDigest,headSha") {
    issues.push(`${prefix}.provenance must carry exactly headSha, assessmentDigest and baselineSnapshotDigest`);
  } else {
    if (typeof decision.provenance.headSha !== "string" || !GIT_HEAD_SHA_PATTERN.test(decision.provenance.headSha)) {
      issues.push(`${prefix}.provenance.headSha must be a 40-hex Git commit sha`);
    }
    for (const field of ["assessmentDigest", "baselineSnapshotDigest"] as const) {
      const digest = decision.provenance[field];
      issues.push(...(typeof digest === "string" ? digestIssues(`${prefix}.provenance.${field}`, digest) : [`${prefix}.provenance.${field} must be a digest`]));
    }
  }
  return issues;
}

/**
 * Parses one decision file exactly as it sits in the checkout. A file with an unresolved merge
 * conflict, a body that is not one JSON object, a value that breaks the contract, a basename that
 * is not its own recommendation id, or bytes that are not the canonical serialization is refused
 * with every reason; nothing is repaired.
 *
 * The one tolerated difference is CRLF line endings: a checkout with `core.autocrlf` (Windows)
 * turns every LF of a committed canonical file into CRLF, so the body is compared after rewriting
 * only `\r\n` pairs to `\n` — the projection digest's rule. A lone CR, or any other byte that
 * differs from the canonical serialization, still fails closed.
 */
export function parseRefactorDecisionFile(path: string, body: string): RefactorDecisionV1 {
  const match = REFACTOR_DECISION_FILE_PATTERN.exec(path);
  if (!match) throw new Error(`refactor-decision-path-invalid: ${path} must be ${REFACTOR_DECISION_DIRECTORY}/recommendation.<16-hex>.json`);
  const normalized = body.replaceAll("\r\n", "\n");
  if (GIT_CONFLICT_MARKER_PATTERN.test(normalized)) throw new Error(`refactor-decision-conflicted: ${path} carries Git conflict markers; resolve the merge first`);
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch (error) {
    throw new Error(`refactor-decision-malformed: ${path} is not JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  const issues = refactorDecisionInvariantIssues(value, path);
  if (issues.length > 0) throw new Error(`refactor-decision-invalid: ${issues.join("; ")}`);
  const decision = value as RefactorDecisionV1;
  if (decision.recommendationId !== match[1]) {
    throw new Error(`refactor-decision-invalid: ${path} must be named after its recommendationId ${decision.recommendationId}`);
  }
  if (serializeRefactorDecision(decision) !== normalized) {
    throw new Error(`refactor-decision-noncanonical: ${path} is not the canonical serialization the daemon writes; decision files are written only by archctx recommendations <verb>`);
  }
  return decision;
}

function decisionSubjectIssues(subject: unknown, label: string): string[] {
  if (!isPlainObject(subject) || Object.keys(subject).sort().join(",") !== "selectorKind,stableKey,subjectSelectorId") {
    return [`${label} must carry exactly selectorKind, stableKey and subjectSelectorId`];
  }
  const issues: string[] = [];
  if (!REFACTOR_DECISION_SELECTOR_KINDS.includes(subject.selectorKind as ArchitectureSubjectSelectorKind)) {
    issues.push(`${label}.selectorKind must be node or repository`);
  }
  issues.push(...boundedLineIssues(`${label}.stableKey`, subject.stableKey, REFACTOR_DECISION_STABLE_KEY_MAX_LENGTH));
  if (typeof subject.subjectSelectorId !== "string" || !/^subject\.(node|repository)\.[a-f0-9]{16}$/.test(subject.subjectSelectorId)) {
    issues.push(`${label}.subjectSelectorId must be a refactor subject selector id`);
  }
  return issues;
}

function boundedLineIssues(label: string, value: unknown, maxLength: number): string[] {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
    return [`${label} must be a non-empty string without leading or trailing whitespace`];
  }
  if (value.length > maxLength) return [`${label} must be at most ${maxLength} characters`];
  return /[\u0000-\u001f\u007f]/.test(value) ? [`${label} must be one line without control characters`] : [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
