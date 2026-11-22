import type {
  ArchitectureRepositoryIdentityV1,
  ArchitectureWorktreeIdentityV1,
  EvidenceCoverageLevelV2,
  RecommendationAuthorV1
} from "./ledger-records";
import type {
  MODULE_STATISTICS_SCHEMA_VERSION,
  ModuleDynamicInvocationLevel,
  ModuleTestsCoverageStatus,
  REFACTOR_PROPOSAL_SCHEMA_VERSION,
  REFACTOR_REQUEST_SCHEMA_VERSION,
  REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
  RefactorKillListKind,
  RefactorOutcomeDirection,
  RefactorOutcomeOperator,
  RefactorScaleReasonCode
} from "./refactor-constants";
import type { RefactorExecutionEvidenceRefV1 } from "./refactor-evidence-types";
import type { Json } from "./schema";

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
    entrypointBypassCount?: number;
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
    unstableDependencyCount?: number;
  } | null;
  cohesion?: {
    lowCohesionFileCount: number;
    measuredFileCount: number;
  };
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

export interface GitCoChangeWindowV1 {
  anchorHeadSha: string;
  windowLimit: number;
  observedCommitCount: number;
  eligibleCommitCount: number;
  maxFilesPerCommit: number;
  isShallow: boolean;
  reachedHistoryRoot: boolean;
  coverageStatus: "complete" | "shallow" | "insufficient-history" | "unavailable";
  reasonCodes: string[];
}

export interface CoChangeDependencySummaryV1 {
  fromNodeId: string;
  toNodeId: string;
  pairCount: number;
  maxCoChangeCount: number;
  maxJaccard: number;
}

export interface ModuleStatisticsSnapshotV1 {
  schemaVersion: typeof MODULE_STATISTICS_SCHEMA_VERSION;
  /** When present, counts describe the requested files and their direct import neighbors. */
  scope?: Exclude<RefactorScopeV1, { kind: "repository" }>;
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
  coChangeDependencies?: CoChangeDependencySummaryV1[];
  gitHistory?: GitCoChangeWindowV1;
  createdAt: string;
  snapshotDigest: string;
  extensions?: Record<string, Json>;
}
