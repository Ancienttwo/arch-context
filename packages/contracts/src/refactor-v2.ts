import {
  REFACTOR_NAMESPACE_PATTERN,
  REFACTOR_OBSERVATION_KINDS,
  REFACTOR_DETECTOR_EXTRA_KINDS,
  REFACTOR_KILL_LIST_SYMBOL_TARGET_REGEX,
  formatRefactorKillListSymbolTarget,
  parseRefactorKillListSymbolTarget,
  isValidRefactorKillListSymbolTarget
} from "./refactor";
import type {
  RefactorEvidenceCoChangePairV1,
  RefactorEvidenceDirectionViolationV1,
  RefactorEvidenceImportEdgeV1,
  RefactorEvidenceLowCohesionClusterV1,
  RefactorEvidenceLowCohesionFileV1,
  RefactorEvidencePairDirectionV1,
  RefactorEvidencePathV1,
  RefactorEvidenceUnresolvedImportV1,
  RefactorEvidenceUnstableTargetV1,
  RefactorObservationEvidenceV1
} from "./refactor-evidence-types";
import {
  AnyOf,
  BoundedStringSchema,
  Const,
  CountSchema,
  GitCommitShaSchema,
  NonEmptyStringSchema,
  NullableType,
  OneOf,
  RawEnum,
  RecordOf,
  Ref,
  RepoPathSchema,
  SchemaDocument,
  Sha256DigestSchema,
  StrictObject,
  StringEnum,
  Type,
  UniqueStringArray,
  type Static
} from "./schema-kit";

export {
  REFACTOR_KILL_LIST_SYMBOL_TARGET_REGEX,
  formatRefactorKillListSymbolTarget,
  parseRefactorKillListSymbolTarget,
  isValidRefactorKillListSymbolTarget
};

export const REFACTOR_SCAN_V2_SCHEMA_VERSION = "archcontext.refactor-scan/v2" as const;
export const REFACTOR_VERIFY_V2_SCHEMA_VERSION = "archcontext.refactor-verify/v2" as const;
export const REFACTOR_SIMULATION_REQUEST_SCHEMA_VERSION = "archcontext.refactor-simulation-request/v1" as const;
export const REFACTOR_SIMULATE_V1_SCHEMA_VERSION = "archcontext.runtime-refactor-simulate/v1" as const;

export const V2_REFACTOR_DETECTOR_KINDS = [
  "file-cycle",
  "component-cycle",
  "god-file",
  "low-cohesion-god-file",
  "entrypoint-bypass",
  "undeclared-dependency",
  "purity-violation",
  "dead-public-export",
  "unstable-dependency",
  "shotgun-surgery-hotspot",
  "co-change-coupling"
] as const;
export type V2RefactorDetectorKind = (typeof V2_REFACTOR_DETECTOR_KINDS)[number];

export const ALL_REFACTOR_DECISION_KINDS = [
  ...REFACTOR_OBSERVATION_KINDS,
  ...REFACTOR_DETECTOR_EXTRA_KINDS
].sort() as readonly (
  | (typeof REFACTOR_OBSERVATION_KINDS)[number]
  | (typeof REFACTOR_DETECTOR_EXTRA_KINDS)[number]
)[];

const RefactorDecisionScopeSchema = OneOf([
  StrictObject({ kind: Const("repository") }),
  StrictObject({ kind: Const("node"), nodeId: NonEmptyStringSchema }),
  StrictObject({ kind: Const("paths"), paths: UniqueStringArray(RepoPathSchema, { minItems: 1 }) })
]);

const RefactorDecisionOutcomeSchema = StrictObject({
  outcomeId: NonEmptyStringSchema,
  metric: NonEmptyStringSchema,
  subjectSelectorId: NonEmptyStringSchema,
  nodeId: NullableType("string"),
  memberNodeIds: Type.Optional(UniqueStringArray(NonEmptyStringSchema, { minItems: 2 })),
  operator: StringEnum(["absent", "equals", "greater_than", "less_than", "present"] as const),
  value: AnyOf([Type.Number(), Type.Null()]),
  required: Type.Boolean()
});

export const ISO_TIMESTAMP_REGEX = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,9})?(Z|[+-]\\d{2}:\\d{2})$";
export const GRAPH_LINE_TEXT_REGEX = "^\\S(?:[^\\u0000-\\u001f\\u007f]*\\S)?$";

const ObservationMetricValueSchema = AnyOf([
  Type.Null(),
  Type.Number()
]);

export const RefactorKillListTargetV2Schema = OneOf([
  StrictObject({
    kind: Const("path"),
    target: RepoPathSchema,
    required: Type.Boolean()
  }),
  StrictObject({
    kind: Const("relation"),
    target: NonEmptyStringSchema,
    required: Type.Boolean()
  }),
  StrictObject({
    kind: Const("symbol"),
    target: Type.String({ pattern: REFACTOR_KILL_LIST_SYMBOL_TARGET_REGEX }),
    required: Type.Boolean()
  })
]);
export type RefactorKillListTargetV2 = Static<typeof RefactorKillListTargetV2Schema>;

export const RefactorDecisionFileBodySchema = StrictObject({
  schemaVersion: Const("archcontext.refactor-decision/v1"),
  namespace: Type.String({ pattern: REFACTOR_NAMESPACE_PATTERN.source }),
  recommendationId: Type.String({ pattern: "^recommendation\\.[a-f0-9]{16}$" }),
  fingerprint: Sha256DigestSchema,
  fingerprintSchemaVersion: Const("archcontext.recommendation-fingerprint/v3"),
  category: StringEnum(["refactor_proposal", "structural_observation"] as const),
  kind: AnyOf([
    Type.Null(),
    StringEnum(ALL_REFACTOR_DECISION_KINDS as unknown as readonly [string, ...string[]])
  ]),
  subject: StrictObject({
    selectorKind: StringEnum(["node", "repository"] as const),
    stableKey: Type.String({ minLength: 1, maxLength: 512, pattern: GRAPH_LINE_TEXT_REGEX }),
    subjectSelectorId: Type.String({ pattern: "^subject\\.(node|repository)\\.[a-f0-9]{16}$" })
  }),
  affectedNodeIds: UniqueStringArray(NonEmptyStringSchema, { maxItems: 32 }),
  affectedNodeCount: CountSchema,
  regressesFrom: AnyOf([
    Type.Null(),
    Type.String({ pattern: "^recommendation\\.[a-f0-9]{16}$" })
  ]),
  status: StringEnum([
    "acknowledged",
    "accepted",
    "deferred",
    "rejected",
    "resolved",
    "waived"
  ] as const),
  observationScopeDigest: Type.Optional(
    Type.String({
      pattern: "^sha256:[a-f0-9]{64}$",
      description: "Scope of the measured observation metrics. Absent for repository baselines."
    })
  ),
  observationMetrics: AnyOf([
    Type.Null(),
    Type.Unsafe<Record<string, number | null>>({
      type: "object",
      additionalProperties: ObservationMetricValueSchema
    })
  ]),
  reason: Type.String({ minLength: 1, maxLength: 1024, pattern: GRAPH_LINE_TEXT_REGEX }),
  actor: StrictObject({
    kind: StringEnum([
      "cli",
      "daemon",
      "developer",
      "hook",
      "mcp",
      "migration",
      "subagent",
      "system"
    ] as const),
    id: Type.String({ minLength: 1, maxLength: 128, pattern: GRAPH_LINE_TEXT_REGEX })
  }),
  decidedAt: Type.String({ pattern: ISO_TIMESTAMP_REGEX }),
  provenance: StrictObject({
    headSha: GitCommitShaSchema,
    assessmentDigest: Sha256DigestSchema,
    baselineSnapshotDigest: Sha256DigestSchema
  }),
  snapshotDigest: Type.Optional(Sha256DigestSchema),
  evidenceDigest: Type.Optional(Sha256DigestSchema),
  resolutionDigest: Type.Optional(Sha256DigestSchema),
  scope: Type.Optional(RefactorDecisionScopeSchema),
  importNodeLimit: Type.Optional(Type.Integer({ minimum: 1 })),
  targetOutcomes: Type.Optional(Type.Array(RefactorDecisionOutcomeSchema)),
  killList: Type.Optional(Type.Array(RefactorKillListTargetV2Schema))
});

export const RefactorDecisionFileSchema = SchemaDocument({
  $id: "https://archctx.repoharness.com/schemas/repo/refactor-decision.schema.json",
  title: "RefactorDecision",
  description:
    "The latest human decision for one refactor recommendation generation, stored at .archcontext/refactor-decisions/<recommendationId>.json (ADR-0046). Identity that needs the core hashers (recommendationId from fingerprint and regressesFrom, the namespace-scoped subject selector) is checked by the runtime reader.",
  schema: RefactorDecisionFileBodySchema
});
export type RefactorDecisionFileV1 = Static<typeof RefactorDecisionFileSchema>;

const EvidenceImportEdgeSchema = StrictObject({
  fromPath: RepoPathSchema,
  fromLine: NullableType("integer", { minimum: 1 }),
  toPath: RepoPathSchema,
  specifier: NonEmptyStringSchema,
  fromNodeId: NonEmptyStringSchema,
  toNodeId: NonEmptyStringSchema
});

const EvidencePairDirectionSchema = StrictObject({
  fromNodeId: NonEmptyStringSchema,
  toNodeId: NonEmptyStringSchema,
  totalCount: CountSchema,
  sampledCount: CountSchema
});

const EvidenceDirectionViolationSchema = StrictObject({
  constraintId: NonEmptyStringSchema,
  fromPath: RepoPathSchema,
  fromLine: NullableType("integer", { minimum: 1 }),
  toPath: RepoPathSchema,
  specifier: NonEmptyStringSchema,
  fromNodeId: NonEmptyStringSchema,
  toNodeId: NonEmptyStringSchema
});

const EvidencePathEntrySchema = StrictObject({
  path: RepoPathSchema,
  candidateOwnerNodeIds: UniqueStringArray(NonEmptyStringSchema),
  candidateOwnerCount: CountSchema
});

const EvidenceUnresolvedImportSchema = StrictObject({
  fromPath: RepoPathSchema,
  fromLine: NullableType("integer", { minimum: 1 }),
  specifier: NonEmptyStringSchema
});

const EvidenceLowCohesionClusterSchema = StrictObject({
  symbols: UniqueStringArray(NonEmptyStringSchema),
  startLine: Type.Integer({ minimum: 1 }),
  endLine: Type.Integer({ minimum: 1 }),
  intraClusterEdges: CountSchema,
  crossClusterEdges: CountSchema
});

const EvidenceLowCohesionFileSchema = StrictObject({
  path: RepoPathSchema,
  lineCount: CountSchema,
  topLevelSymbolCount: CountSchema,
  clusterCount: CountSchema,
  clusters: Type.Array(Ref<RefactorEvidenceLowCohesionClusterV1>("#/$defs/evidenceLowCohesionCluster"))
});

const EvidenceUnstableTargetSchema = StrictObject({
  targetNodeId: NonEmptyStringSchema,
  targetInstability: Type.Number({ minimum: 0, maximum: 1 }),
  delta: Type.Number({ minimum: -1, maximum: 1 }),
  edgeCount: Type.Integer({ minimum: 1 })
});

const EvidenceCoChangePairSchema = StrictObject({
  pathA: RepoPathSchema,
  pathB: RepoPathSchema,
  coChangeCount: Type.Integer({ minimum: 1 }),
  jaccard: Type.Number({ minimum: 0, maximum: 1 })
});

const ObservationEvidenceSchema = OneOf([
  StrictObject({
    kind: Const("cycle"),
    memberNodeIds: UniqueStringArray(NonEmptyStringSchema),
    directions: Type.Array(Ref<RefactorEvidencePairDirectionV1>("#/$defs/evidencePairDirection")),
    edges: Type.Array(Ref<RefactorEvidenceImportEdgeV1>("#/$defs/evidenceImportEdge")),
    totalCount: CountSchema,
    truncated: Type.Boolean()
  }),
  StrictObject({
    kind: Const("residual-cycle"),
    memberNodeIds: UniqueStringArray(NonEmptyStringSchema),
    edges: Type.Array(Ref<RefactorEvidenceImportEdgeV1>("#/$defs/evidenceImportEdge")),
    totalCount: CountSchema,
    truncated: Type.Boolean()
  }),
  StrictObject({
    kind: Const("direction-violation"),
    constraintIds: UniqueStringArray(NonEmptyStringSchema),
    constraintCount: CountSchema,
    violations: Type.Array(Ref<RefactorEvidenceDirectionViolationV1>("#/$defs/evidenceDirectionViolation")),
    totalCount: CountSchema,
    truncated: Type.Boolean()
  }),
  StrictObject({
    kind: StringEnum(["ownership-ambiguous", "undeclared-footprint", "unowned-paths"] as const),
    paths: Type.Array(Ref<RefactorEvidencePathV1>("#/$defs/evidencePathEntry")),
    totalCount: CountSchema,
    truncated: Type.Boolean()
  }),
  StrictObject({
    kind: Const("evidence-gap"),
    coverage: StringEnum(["complete", "partial", "unknown"] as const),
    reasonCodes: UniqueStringArray(BoundedStringSchema),
    unresolvedImports: Type.Array(Ref<RefactorEvidenceUnresolvedImportV1>("#/$defs/evidenceUnresolvedImport")),
    totalCount: CountSchema,
    truncated: Type.Boolean()
  }),
  StrictObject({
    kind: Const("low-cohesion-god-file"),
    files: Type.Array(Ref<RefactorEvidenceLowCohesionFileV1>("#/$defs/evidenceLowCohesionFile")),
    totalCount: CountSchema,
    truncated: Type.Boolean()
  }),
  StrictObject({
    kind: Const("entrypoint-bypass"),
    declaredEntrypointPaths: UniqueStringArray(RepoPathSchema),
    edges: Type.Array(Ref<RefactorEvidenceImportEdgeV1>("#/$defs/evidenceImportEdge")),
    totalCount: CountSchema,
    truncated: Type.Boolean()
  }),
  StrictObject({
    kind: Const("unstable-dependency"),
    sourceFanIn: CountSchema,
    sourceInstability: Type.Number({ minimum: 0, maximum: 1 }),
    targets: Type.Array(Ref<RefactorEvidenceUnstableTargetV1>("#/$defs/evidenceUnstableTarget")),
    totalCount: CountSchema,
    truncated: Type.Boolean()
  }),
  StrictObject({
    kind: Const("co-change-coupling"),
    memberNodeIds: UniqueStringArray(NonEmptyStringSchema),
    coverageStatus: StringEnum(["complete", "shallow", "insufficient-history", "unavailable"] as const),
    windowLimit: Type.Integer({ minimum: 1 }),
    observedCommitCount: CountSchema,
    pairs: Type.Array(Ref<RefactorEvidenceCoChangePairV1>("#/$defs/evidenceCoChangePair")),
    totalCount: CountSchema,
    truncated: Type.Boolean()
  })
]);

export const RefactorScanFindingV2Schema = StrictObject({
  recommendationId: Type.String({ pattern: "^recommendation\\.[a-f0-9]{16}$" }),
  fingerprint: Sha256DigestSchema,
  detector: StringEnum(V2_REFACTOR_DETECTOR_KINDS),
  severity: RawEnum(["notice", "warning", "error", "critical"] as const),
  blocking: Type.Boolean(),
  capabilityId: NullableType("string", { minLength: 1 }),
  affectedNodeIds: UniqueStringArray(NonEmptyStringSchema),
  affectedPaths: UniqueStringArray(RepoPathSchema),
  killList: Type.Array(RefactorKillListTargetV2Schema),
  metrics: RecordOf(AnyOf([Type.Number(), Type.Null(), Type.Boolean()])),
  evidence: StrictObject({
    summary: BoundedStringSchema,
    coChangeSupport: Type.Optional(Type.Integer({ minimum: 0 })),
    coChangeCoverageOk: Type.Optional(Type.Boolean()),
    thinDirectionEdgeCount: Type.Optional(Type.Integer({ minimum: 0 })),
    sccSize: Type.Optional(Type.Integer({ minimum: 0 })),
    instabilitySource: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    instabilityTarget: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    testCallerCoverage: Type.Optional(NullableType("number", { minimum: 0, maximum: 1 })),
    lcomScore: Type.Optional(Type.Number({ minimum: 0 })),
    splitClusterCount: Type.Optional(Type.Integer({ minimum: 0 })),
    observation: Type.Optional(Ref<RefactorObservationEvidenceV1>("#/$defs/observationEvidence"))
  })
});
export type RefactorScanFindingV2 = Static<typeof RefactorScanFindingV2Schema>;

export const RefactorScanV2BodySchema = StrictObject({
  schemaVersion: Const(REFACTOR_SCAN_V2_SCHEMA_VERSION),
  scope: OneOf([
    StrictObject({ kind: Const("repository") }),
    StrictObject({ kind: Const("node"), nodeId: NonEmptyStringSchema }),
    StrictObject({ kind: Const("paths"), paths: UniqueStringArray(RepoPathSchema, { minItems: 1 }) })
  ]),
  headSha: GitCommitShaSchema,
  snapshotDigest: Sha256DigestSchema,
  importNodeLimit: Type.Optional(Type.Integer({ minimum: 1 })),
  coverage: StrictObject({
    imports: StringEnum(["complete", "partial", "unavailable"] as const),
    gitHistory: StringEnum(["complete", "shallow", "unavailable"] as const),
    reasonCodes: UniqueStringArray(BoundedStringSchema)
  }),
  findings: Type.Array(RefactorScanFindingV2Schema),
  suppressed: Type.Array(
    StrictObject({
      recommendationId: Type.String({ pattern: "^recommendation\\.[a-f0-9]{16}$" }),
      detector: StringEnum(V2_REFACTOR_DETECTOR_KINDS),
      decisionStatus: StringEnum(["deferred", "rejected", "waived", "resolved"] as const),
      reason: BoundedStringSchema
    })
  )
});

export const RefactorScanV2Schema = SchemaDocument({
  $id: "https://archcontext.dev/schemas/runtime/refactor-scan-v2.schema.json",
  title: "RefactorScanV2",
  description: "v2 Stage 5 deterministic refactor radar output for `archctx scan --json` (#643).",
  schema: RefactorScanV2BodySchema,
  $defs: {
    evidenceImportEdge: EvidenceImportEdgeSchema,
    evidencePairDirection: EvidencePairDirectionSchema,
    evidenceDirectionViolation: EvidenceDirectionViolationSchema,
    evidencePathEntry: EvidencePathEntrySchema,
    evidenceUnresolvedImport: EvidenceUnresolvedImportSchema,
    evidenceLowCohesionCluster: EvidenceLowCohesionClusterSchema,
    evidenceLowCohesionFile: EvidenceLowCohesionFileSchema,
    evidenceUnstableTarget: EvidenceUnstableTargetSchema,
    evidenceCoChangePair: EvidenceCoChangePairSchema,
    observationEvidence: ObservationEvidenceSchema
  }
});
export type RefactorScanV2 = Static<typeof RefactorScanV2Schema>;

export const RefactorVerifyV2BodySchema = StrictObject({
  schemaVersion: Const(REFACTOR_VERIFY_V2_SCHEMA_VERSION),
  recommendationId: Type.String({ pattern: "^recommendation\\.[a-f0-9]{16}$" }),
  headSha: GitCommitShaSchema,
  snapshotDigest: Sha256DigestSchema,
  disposition: StringEnum([
    "resolved",
    "partially_resolved",
    "unresolved",
    "regressed",
    "stale"
  ] as const),
  resolutionDigest: Sha256DigestSchema,
  killListChecks: Type.Array(
    StrictObject({
      kind: StringEnum(["path", "relation", "symbol"] as const),
      target: NonEmptyStringSchema,
      required: Type.Boolean(),
      status: StringEnum(["removed", "still-present", "uncheckable"] as const)
    })
  ),
  metricChecks: Type.Array(
    StrictObject({
      metric: NonEmptyStringSchema,
      before: AnyOf([Type.Number(), Type.Null()]),
      after: AnyOf([Type.Number(), Type.Null()]),
      satisfied: Type.Boolean()
    })
  ),
  blockingReasons: UniqueStringArray(BoundedStringSchema),
  historicalReceipt: Type.Optional(
    StrictObject({
      status: StringEnum(["acknowledged", "accepted", "deferred", "rejected", "resolved", "waived"] as const),
      headSha: GitCommitShaSchema,
      resolutionDigest: NullableType("string", { pattern: "^sha256:[a-f0-9]{64}$" })
    })
  )
});

export const RefactorVerifyV2Schema = SchemaDocument({
  $id: "https://archcontext.dev/schemas/runtime/refactor-verify-v2.schema.json",
  title: "RefactorVerifyV2",
  description: "v2 Stage 5 attested resolution verification output for `archctx verify <id> --json` (#643).",
  schema: RefactorVerifyV2BodySchema
});
export type RefactorVerifyV2 = Static<typeof RefactorVerifyV2Schema>;

export const RefactorSimulationMoveSchema = StrictObject({
  path: RepoPathSchema,
  toNodeId: NonEmptyStringSchema,
  symbols: Type.Optional(UniqueStringArray(NonEmptyStringSchema, { minItems: 1 }))
});
export type RefactorSimulationMoveV1 = Static<typeof RefactorSimulationMoveSchema>;

export interface RefactorSimulationRequestV1 {
  schemaVersion?: typeof REFACTOR_SIMULATION_REQUEST_SCHEMA_VERSION;
  moves?: RefactorSimulationMoveV1[];
  targetSubject?: string;
  expectedHeadSha?: string;
  expectedWorktreeDigest?: string;
  importNodeLimit?: number;
}

const RefactorSimulationMetricsSnapshotSchema = StrictObject({
  pairThinDirectionEdgeCount: CountSchema,
  crossModuleEdgeCount: CountSchema,
  crossModuleCycleCount: CountSchema,
  residualCycleCount: CountSchema,
  directionViolationCount: CountSchema
});

const RefactorSimulationMetricsDeltaValuesSchema = StrictObject({
  pairThinDirectionEdgeCount: Type.Integer(),
  crossModuleEdgeCount: Type.Integer(),
  crossModuleCycleCount: Type.Integer(),
  residualCycleCount: Type.Integer(),
  directionViolationCount: Type.Integer()
});

const RefactorSimulationViolationSchema = StrictObject({
  constraintId: NonEmptyStringSchema,
  fromPath: RepoPathSchema,
  toPath: RepoPathSchema,
  fromNode: NonEmptyStringSchema,
  toNode: NonEmptyStringSchema,
  severity: RawEnum(["notice", "warning", "error", "critical"] as const),
  fromLayer: Type.Optional(NonEmptyStringSchema),
  toLayer: Type.Optional(NonEmptyStringSchema)
});

const RefactorSimulationCutCandidateSchema = StrictObject({
  strategy: StringEnum(["move-source-file", "move-target-file", "extract-shared-leaf", "invert-interface"] as const),
  measured: Type.Boolean(),
  measurementStatus: StringEnum(["measured", "unmeasured"] as const),
  summary: BoundedStringSchema,
  moves: Type.Array(RefactorSimulationMoveSchema),
  thinDirectionEdgeDelta: AnyOf([Type.Integer(), Type.Null()]),
  crossModuleCycleDelta: AnyOf([Type.Integer(), Type.Null()]),
  directionViolationDelta: AnyOf([Type.Integer(), Type.Null()]),
  newlyIntroducedViolationCount: AnyOf([CountSchema, Type.Null()]),
  breaksPair: AnyOf([Type.Boolean(), Type.Null()]),
  caveats: UniqueStringArray(BoundedStringSchema)
});

export const RefactorSimulateV1BodySchema = StrictObject({
  schemaVersion: Const(REFACTOR_SIMULATE_V1_SCHEMA_VERSION),
  beforeSnapshotDigest: Sha256DigestSchema,
  modelDigest: Sha256DigestSchema,
  codeFactsCoverage: StringEnum(["complete", "partial", "unknown"] as const),
  moves: Type.Array(RefactorSimulationMoveSchema),
  targetSubject: AnyOf([Type.String({ minLength: 1 }), Type.Null()]),
  measurementStatus: StringEnum(["measured", "unmeasured"] as const),
  unmeasuredReasons: UniqueStringArray(BoundedStringSchema),
  metricsDelta: StrictObject({
    before: RefactorSimulationMetricsSnapshotSchema,
    after: AnyOf([RefactorSimulationMetricsSnapshotSchema, Type.Null()]),
    delta: AnyOf([RefactorSimulationMetricsDeltaValuesSchema, Type.Null()])
  }),
  newlyIntroducedCycles: Type.Array(NonEmptyStringSchema),
  resolvedCycles: Type.Array(NonEmptyStringSchema),
  newlyIntroducedViolations: Type.Array(RefactorSimulationViolationSchema),
  cutCandidates: Type.Array(RefactorSimulationCutCandidateSchema),
  simulationDigest: Sha256DigestSchema,
  privacy: StrictObject({
    writes: Const("none"),
    rawSourcePersisted: Const(false),
    rawDiffPersisted: Const(false),
    promptPersisted: Const(false)
  })
});

export const RefactorSimulateV1Schema = SchemaDocument({
  $id: "https://archcontext.dev/schemas/runtime/refactor-simulate.schema.json",
  title: "RefactorSimulateV1",
  description: "Read-only move/cut impact simulation preview (#638, #643 Phase 2).",
  schema: RefactorSimulateV1BodySchema
});
export type RefactorSimulateV1 = Static<typeof RefactorSimulateV1Schema>;
export type RefactorSimulationResultV1 = RefactorSimulateV1;
