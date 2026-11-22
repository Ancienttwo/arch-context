import type {
  ArchitectureActorKind,
  ArchitectureSubjectSelectorKind,
  EvidenceCoverageLevelV2,
  RecommendationCategory
} from "./ledger-records";
import type { ArchitectureMajorChangeReasonCode } from "./projection-constants";
import type {
  REFACTOR_ASSESSMENT_SCHEMA_VERSION,
  REFACTOR_DECISION_SCHEMA_VERSION,
  REFACTOR_DETECTOR_EXTRA_KINDS,
  REFACTOR_RECOMMENDATION_FINGERPRINT_SCHEMA_VERSION,
  REFACTOR_RESOLUTION_EVIDENCE_SCHEMA_VERSION,
  RefactorDecisionStatus,
  RefactorExecutionEvidenceKind,
  RefactorKillListKind,
  RefactorObservationKind,
  RefactorResolutionDisposition,
  RefactorScale,
  RefactorScaleReasonCode
} from "./refactor-constants";
import type {
  RefactorObservedOutcomeV1,
  RefactorScopeV1,
  RefactorTargetOutcomeV1
} from "./refactor-types";
import type { Json, Severity } from "./schema";

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

export interface RefactorEvidenceLowCohesionClusterV1 {
  symbols: string[];
  startLine: number;
  endLine: number;
  intraClusterEdges: number;
  crossClusterEdges: number;
}

export interface RefactorEvidenceLowCohesionFileV1 {
  path: string;
  lineCount: number;
  topLevelSymbolCount: number;
  clusterCount: number;
  clusters: RefactorEvidenceLowCohesionClusterV1[];
}

export interface RefactorEvidenceUnstableTargetV1 {
  targetNodeId: string;
  targetInstability: number;
  delta: number;
  edgeCount: number;
}

export interface RefactorEvidenceCoChangePairV1 {
  pathA: string;
  pathB: string;
  coChangeCount: number;
  jaccard: number;
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
  } & RefactorEvidenceSampleV1)
  | ({ kind: "low-cohesion-god-file"; files: RefactorEvidenceLowCohesionFileV1[] } & RefactorEvidenceSampleV1)
  | ({ kind: "entrypoint-bypass"; declaredEntrypointPaths: string[]; edges: RefactorEvidenceImportEdgeV1[] } & RefactorEvidenceSampleV1)
  | ({
    kind: "unstable-dependency";
    sourceFanIn: number;
    sourceInstability: number;
    targets: RefactorEvidenceUnstableTargetV1[];
  } & RefactorEvidenceSampleV1)
  | ({
    kind: "co-change-coupling";
    memberNodeIds: string[];
    coverageStatus: "complete" | "shallow" | "insufficient-history" | "unavailable";
    windowLimit: number;
    observedCommitCount: number;
    pairs: RefactorEvidenceCoChangePairV1[];
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
 * The latest human decision for one refactor recommendation generation, stored in Git at
 * `.archcontext/refactor-decisions/<recommendationId>.json` (ADR-0046). It carries identity and the
 * decided measurement only: no absolute path, storage id, source, diff or evidence body.
 */
export interface RefactorDecisionKillTargetV1 {
  kind: RefactorKillListKind;
  target: string;
  required: boolean;
}

export interface RefactorDecisionV1 {
  schemaVersion: typeof REFACTOR_DECISION_SCHEMA_VERSION;
  /** The manifest `product.id` the subject selector is scoped by. */
  namespace: string;
  recommendationId: string;
  fingerprint: string;
  fingerprintSchemaVersion: typeof REFACTOR_RECOMMENDATION_FINGERPRINT_SCHEMA_VERSION;
  category: "refactor_proposal" | "structural_observation";
  /** The observation or v2 detector kind; `null` for a refactor proposal. */
  kind: RefactorObservationKind | (typeof REFACTOR_DETECTOR_EXTRA_KINDS)[number] | null;
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
  /** Scope of the measured observation metrics. Absent for repository baselines. */
  observationScopeDigest?: string;
  reason: string;
  actor: { kind: ArchitectureActorKind; id: string };
  decidedAt: string;
  provenance: {
    headSha: string;
    assessmentDigest: string;
    baselineSnapshotDigest: string;
  };
  snapshotDigest?: string;
  evidenceDigest?: string;
  resolutionDigest?: string;
  scope?: RefactorScopeV1;
  importNodeLimit?: number;
  targetOutcomes?: RefactorTargetOutcomeV1[];
  killList?: RefactorDecisionKillTargetV1[];
}
