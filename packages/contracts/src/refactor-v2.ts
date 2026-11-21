import { REFACTOR_NAMESPACE_PATTERN } from "./refactor";
import { isRepoRelativePosixPath } from "./schema";
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
  RepoPathSchema,
  SchemaDocument,
  Sha256DigestSchema,
  StrictObject,
  StringEnum,
  Type,
  UniqueStringArray,
  type Static
} from "./schema-kit";

export const REFACTOR_SCAN_V2_SCHEMA_VERSION = "archcontext.refactor-scan/v2" as const;
export const REFACTOR_VERIFY_V2_SCHEMA_VERSION = "archcontext.refactor-verify/v2" as const;
export const REFACTOR_SIMULATE_V1_SCHEMA_VERSION = "archcontext.refactor-simulate/v1" as const;

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
  "cycle",
  "direction-violation",
  "evidence-gap",
  "ownership-ambiguous",
  "residual-cycle",
  "undeclared-footprint",
  "unowned-paths",
  ...V2_REFACTOR_DETECTOR_KINDS
] as const;

export const ISO_TIMESTAMP_REGEX = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,9})?(Z|[+-]\\d{2}:\\d{2})$";
export const GRAPH_LINE_TEXT_REGEX = "^\\S(?:[^\\u0000-\\u001f\\u007f]*\\S)?$";

/**
 * #636 / #643: Symbolic kill-list targets use `path#symbol`, where `path` is a safe repo-relative
 * POSIX path and `symbol` is a non-empty identifier without whitespace or control characters.
 */
export const REFACTOR_KILL_LIST_SYMBOL_TARGET_REGEX = "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[^#\\s\\\\\\u0000-\\u001f\\u007f]+#[^\\s\\u0000-\\u001f\\u007f]+$";

export function formatRefactorKillListSymbolTarget(path: string, symbol: string): string {
  return `${path}#${symbol}`;
}

export function parseRefactorKillListSymbolTarget(target: string): { path: string; symbol: string } | undefined {
  const hashIndex = target.indexOf("#");
  if (hashIndex <= 0 || hashIndex === target.length - 1) return undefined;
  if (target.indexOf("#", hashIndex + 1) !== -1) return undefined;
  const path = target.slice(0, hashIndex);
  const symbol = target.slice(hashIndex + 1);
  if (!isRepoRelativePosixPath(path) || /[\s\u0000-\u001f\u007f]/.test(path)) return undefined;
  if (/[\s\u0000-\u001f\u007f]/.test(symbol) || symbol.length === 0) return undefined;
  return { path, symbol };
}

export function isValidRefactorKillListSymbolTarget(target: string): boolean {
  return parseRefactorKillListSymbolTarget(target) !== undefined;
}

const ObservationMetricValueSchema = AnyOf([
  Type.Null(),
  Type.Number()
]);

export const RefactorDecisionFileBodySchema = StrictObject({
  schemaVersion: Const("archcontext.refactor-decision/v1"),
  namespace: Type.String({ pattern: REFACTOR_NAMESPACE_PATTERN.source }),
  recommendationId: Type.String({ pattern: "^recommendation\\.[a-f0-9]{16}$" }),
  fingerprint: Sha256DigestSchema,
  fingerprintSchemaVersion: Const("archcontext.recommendation-fingerprint/v3"),
  category: StringEnum(["refactor_proposal", "structural_observation"] as const),
  kind: AnyOf([
    Type.Null(),
    StringEnum(ALL_REFACTOR_DECISION_KINDS)
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
  resolutionDigest: Type.Optional(Sha256DigestSchema)
});

export const RefactorDecisionFileSchema = SchemaDocument({
  $id: "https://archctx.repoharness.com/schemas/repo/refactor-decision.schema.json",
  title: "RefactorDecision",
  description:
    "The latest human decision for one refactor recommendation generation, stored at .archcontext/refactor-decisions/<recommendationId>.json (ADR-0046). Identity that needs the core hashers (recommendationId from fingerprint and regressesFrom, the namespace-scoped subject selector) is checked by the runtime reader.",
  schema: RefactorDecisionFileBodySchema
});
export type RefactorDecisionFileV1 = Static<typeof RefactorDecisionFileSchema>;

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
    splitClusterCount: Type.Optional(Type.Integer({ minimum: 0 }))
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
  schema: RefactorScanV2BodySchema
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
  blockingReasons: UniqueStringArray(BoundedStringSchema)
});

export const RefactorVerifyV2Schema = SchemaDocument({
  $id: "https://archcontext.dev/schemas/runtime/refactor-verify-v2.schema.json",
  title: "RefactorVerifyV2",
  description: "v2 Stage 5 attested resolution verification output for `archctx verify <id> --json` (#643).",
  schema: RefactorVerifyV2BodySchema
});
export type RefactorVerifyV2 = Static<typeof RefactorVerifyV2Schema>;

export const RefactorSimulateV1BodySchema = StrictObject({
  schemaVersion: Const(REFACTOR_SIMULATE_V1_SCHEMA_VERSION),
  headSha: GitCommitShaSchema,
  operation: OneOf([
    StrictObject({ kind: Const("cut-edge"), from: RepoPathSchema, to: RepoPathSchema }),
    StrictObject({ kind: Const("move-path"), from: RepoPathSchema, targetNodeId: NonEmptyStringSchema })
  ]),
  before: StrictObject({
    cycleCount: CountSchema,
    undeclaredEdgeCount: CountSchema
  }),
  after: StrictObject({
    cycleCount: NullableType("integer", { minimum: 0 }),
    undeclaredEdgeCount: NullableType("integer", { minimum: 0 })
  }),
  coverage: StringEnum(["static-graph-only", "partial", "unavailable"] as const),
  caveats: UniqueStringArray(BoundedStringSchema),
  readOnly: Const(true)
});

export const RefactorSimulateV1Schema = SchemaDocument({
  $id: "https://archcontext.dev/schemas/runtime/refactor-simulate.schema.json",
  title: "RefactorSimulateV1",
  description: "Read-only move/cut impact simulation preview (#638, #643 Phase 2).",
  schema: RefactorSimulateV1BodySchema
});
export type RefactorSimulateV1 = Static<typeof RefactorSimulateV1Schema>;
