import { isRepoRelativePosixPath } from "./schema";
import {
  ArchContextErrorSchema,
  Const,
  GitOidSchema,
  NullableType,
  OneOf,
  RawEnum,
  Ref,
  SchemaDocument,
  StrictObject,
  Type,
  TypedUnsafe,
  type Static
} from "./schema-kit";

export const REF_IMPACT_BATCH_REQUEST_SCHEMA_VERSION = "archcontext.ref-impact-batch-request/v1" as const;
export const REF_IMPACT_BATCH_SCHEMA_VERSION = "archcontext.ref-impact-batch/v1" as const;
export const REF_IMPACT_SCHEMA_VERSION = "archcontext.ref-impact/v1" as const;

export const REF_IMPACT_LIMITS = Object.freeze({
  changedPaths: 1000,
  nodes: 1000,
  relations: 5000,
  flowSteps: 2000,
  dependents: 5000,
  modelChanges: 5000,
  depth: 10,
  diffLines: 100_000,
  diffWork: 2_000_000,
  diffBytes: 8 * 1024 * 1024,
  responseBytes: 8 * 1024 * 1024,
  codeFactFiles: 10_000,
  codeFactBytes: 8 * 1024 * 1024
});

export const NativeContextSnapshotSchema = OneOf([
  StrictObject({
    source: Const("ref"),
    commitSha: GitOidSchema,
    treeOid: GitOidSchema,
    validation: Const("immutable-tree")
  }),
  StrictObject({
    source: Const("worktree"),
    headSha: GitOidSchema,
    headTreeOid: GitOidSchema,
    validation: Const("stable-read")
  })
]);

const RefImpactFlowStepSchema = StrictObject({
  flowId: Type.String(),
  stepId: Type.String(),
  outcomeId: NullableType("string"),
  reasonCodes: Type.Array(Type.String())
});
/** Items also identify uncertain steps via selector-evidence-unavailable; inspect reasons before claiming a touch. */
export type RefImpactFlowStep = Static<typeof RefImpactFlowStepSchema>;

const RefImpactModelChangeSchema = StrictObject({
  kind: RawEnum(["nodes", "relations", "flows"] as const),
  id: Type.String(),
  change: RawEnum(["added", "removed", "changed"] as const),
  fields: Type.Array(Type.String())
});
export type RefImpactModelChange = { kind: string; id: string; change: "added" | "removed" | "changed"; fields: string[] };

const touchedFlowStepsSchema = OneOf([
  StrictObject({
    status: Const("known"),
    reasonCodes: Type.Array(Type.String(), { maxItems: 0 }),
    items: Type.Array(RefImpactFlowStepSchema, { maxItems: REF_IMPACT_LIMITS.flowSteps })
  }),
  StrictObject({
    status: Const("unknown"),
    reasonCodes: Type.Array(Type.String(), { minItems: 1 }),
    items: OneOf([
      Type.Null(),
      Type.Array(RefImpactFlowStepSchema, { maxItems: REF_IMPACT_LIMITS.flowSteps })
    ])
  })
]);

const modelDeltaSchema = OneOf([
  StrictObject({
    status: Const("known"),
    changes: Type.Array(RefImpactModelChangeSchema, { maxItems: REF_IMPACT_LIMITS.modelChanges }),
    truncated: Type.Boolean()
  }),
  StrictObject({
    status: Const("unknown"),
    reasonCode: Const("paths-only"),
    changes: Type.Null(),
    truncated: Const(false)
  })
]);

const RefImpactBodySchema = StrictObject({
  schemaVersion: Const(REF_IMPACT_SCHEMA_VERSION),
  base: OneOf([Type.Null(), NativeContextSnapshotSchema]),
  head: NativeContextSnapshotSchema,
  depth: Type.Integer({ minimum: 0, maximum: REF_IMPACT_LIMITS.depth }),
  changedPaths: Type.Array(
    StrictObject({
      path: Type.String(),
      added: NullableType("integer", { minimum: 0 }),
      deleted: NullableType("integer", { minimum: 0 }),
      baseOwners: Type.Array(Type.String()),
      headOwners: Type.Array(Type.String()),
      owners: Type.Array(Type.String()),
      reasonCodes: Type.Array(Type.String())
    }),
    { maxItems: REF_IMPACT_LIMITS.changedPaths }
  ),
  unownedPaths: Type.Array(Type.String()),
  touchedNodes: Type.Array(
    StrictObject({
      nodeId: Type.String(),
      pathCount: Type.Integer({ minimum: 0 })
    }),
    { maxItems: REF_IMPACT_LIMITS.nodes }
  ),
  touchedFlowSteps: TypedUnsafe<{ status: "known" | "unknown"; reasonCodes: string[]; items: RefImpactFlowStep[] | null }>(touchedFlowStepsSchema),
  dependents: Type.Array(
    StrictObject({
      nodeId: Type.String(),
      touchedNodeId: Type.String(),
      relationIds: Type.Array(Type.String())
    }),
    { maxItems: REF_IMPACT_LIMITS.dependents }
  ),
  dependencyCoverage: StrictObject({
    status: RawEnum(["complete", "partial"] as const),
    graph: Const("head"),
    pathSelection: Const("one-shortest-path-per-node-pair")
  }),
  modelDelta: TypedUnsafe<
    | { status: "known"; changes: RefImpactModelChange[]; truncated: boolean }
    | { status: "unknown"; reasonCode: "paths-only"; changes: null; truncated: false }
  >(modelDeltaSchema),
  limits: StrictObject({
    codeFactFiles: Const(REF_IMPACT_LIMITS.codeFactFiles),
    codeFactBytes: Const(REF_IMPACT_LIMITS.codeFactBytes),
    changedPaths: Const(REF_IMPACT_LIMITS.changedPaths),
    nodes: Const(REF_IMPACT_LIMITS.nodes),
    relations: Const(REF_IMPACT_LIMITS.relations),
    flowSteps: Const(REF_IMPACT_LIMITS.flowSteps),
    dependents: Const(REF_IMPACT_LIMITS.dependents),
    modelChanges: Const(REF_IMPACT_LIMITS.modelChanges),
    depth: Const(REF_IMPACT_LIMITS.depth),
    diffBytes: Const(REF_IMPACT_LIMITS.diffBytes),
    responseBytes: Const(REF_IMPACT_LIMITS.responseBytes),
    diffLines: Const(REF_IMPACT_LIMITS.diffLines),
    diffWork: Const(REF_IMPACT_LIMITS.diffWork)
  }),
  truncated: StrictObject({
    changedPaths: Type.Boolean(),
    touchedNodes: Type.Boolean(),
    relations: Type.Boolean(),
    flowSteps: Type.Boolean(),
    dependents: Type.Boolean(),
    modelDelta: Type.Boolean()
  })
});

export const RefImpactSchema = SchemaDocument({
  $id: "https://archctx.repoharness.com/schemas/runtime/ref-impact.schema.json",
  title: "RefImpactV1",
  schema: RefImpactBodySchema
});

/** No timestamps, workspace paths, source bodies or live session state. */
export type RefImpactV1 = Static<typeof RefImpactSchema>;

const BATCH_REPO_PATH_PATTERN = "^(?!/)(?![\\s\\S]*(?:^|/)\\.\\.(?:/|(?![\\s\\S])))[^\\\\\u0000]+$";

export const RefImpactBatchRequestBodySchema = StrictObject({
  schemaVersion: Const(REF_IMPACT_BATCH_REQUEST_SCHEMA_VERSION),
  items: Type.Array(
    StrictObject({
      id: Type.String(),
      paths: Type.Array(Type.String({ pattern: BATCH_REPO_PATH_PATTERN }))
    })
  )
});

export const RefImpactBatchRequestSchema = SchemaDocument({
  $id: "https://archcontext.dev/schemas/runtime/ref-impact-batch-request.schema.json",
  title: "RefImpactBatchRequestV1",
  schema: RefImpactBatchRequestBodySchema
});
export type RefImpactBatchRequestV1 = Static<typeof RefImpactBatchRequestSchema>;

export const REF_IMPACT_BATCH_UNAVAILABLE_REASONS = [
  "batch-response-bytes",
  "head-ref-unavailable",
  "base-ref-unavailable",
  "diff-limit-exceeded",
  "model-invalid",
  "path-invalid",
  "worktree-error"
] as const;
export type RefImpactBatchUnavailableReason = (typeof REF_IMPACT_BATCH_UNAVAILABLE_REASONS)[number];

export const RefImpactBatchItemSchema = OneOf([
  StrictObject({
    id: Type.String(),
    impact: Ref<RefImpactV1>("https://archctx.repoharness.com/schemas/runtime/ref-impact.schema.json")
  }),
  StrictObject({
    id: Type.String(),
    status: Const("unavailable"),
    reasonCode: RawEnum(REF_IMPACT_BATCH_UNAVAILABLE_REASONS),
    error: Type.Optional(ArchContextErrorSchema)
  })
]);
export type RefImpactBatchItemV1 = Static<typeof RefImpactBatchItemSchema>;

export const RefImpactBatchBodySchema = StrictObject({
  schemaVersion: Const(REF_IMPACT_BATCH_SCHEMA_VERSION),
  items: Type.Array(RefImpactBatchItemSchema, {
    description: "One impact or typed refusal/response-limit status per request item, in request order."
  })
});

export const RefImpactBatchSchema = SchemaDocument({
  $id: "https://archcontext.dev/schemas/runtime/ref-impact-batch.schema.json",
  title: "RefImpactBatchV1",
  schema: RefImpactBatchBodySchema
});
export type RefImpactBatchV1 = Static<typeof RefImpactBatchSchema>;

export function isRefImpactBatchRequest(value: unknown): value is RefImpactBatchRequestV1 {
  if (!isRecord(value) || Object.keys(value).length !== 2 || value.schemaVersion !== REF_IMPACT_BATCH_REQUEST_SCHEMA_VERSION || !Array.isArray(value.items)) return false;
  for (const item of value.items) {
    if (!isRecord(item) || Object.keys(item).length !== 2 || typeof item.id !== "string" || !Array.isArray(item.paths)) return false;
    for (const path of item.paths) {
      if (typeof path !== "string" || !isRepoRelativePosixPath(path) || path.includes("\0")) return false;
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
