import { isRepoRelativePosixPath, type Json } from "./schema";
import {
  Const,
  CountSchema,
  GitOidSchema,
  Nullable,
  OneOf,
  RawEnum,
  SchemaDocument,
  StrictObject,
  Type,
  TypedUnsafe,
  type Static
} from "./schema-kit";
import { validateJsonSchema } from "./validator";

export const ARCHITECTURE_HISTORY_SCHEMA_VERSION = "archcontext.architecture-history/v1" as const;
export const ARCHITECTURE_HISTORY_MERMAID_SCHEMA_VERSION = "archcontext.architecture-history-mermaid/v1" as const;
export const ARCHITECTURE_HISTORY_DERIVATION_VERSION = "v3" as const;

/**
 * Why a projection render reads the architecture history (ADR-0056 §8): the request names the
 * `architecture-history` target, or the committed row cannot be carried forward because there is
 * none, its file is missing, or its file does not digest to the row.
 */
export const ARCHITECTURE_HISTORY_READ_REASONS = ["target-named", "history-row-missing", "history-file-missing", "history-file-mismatch"] as const;
export type ArchitectureHistoryReadReason = (typeof ARCHITECTURE_HISTORY_READ_REASONS)[number];

export const HISTORY_ERROR_CODES = [
  "history-model-layout-unsupported",
  "history-model-missing",
  "history-model-invalid",
  "history-model-too-large"
] as const;

export const HistoryErrorCodeSchema = RawEnum(HISTORY_ERROR_CODES);
export type HistoryErrorCode = Static<typeof HistoryErrorCodeSchema>;

export const HistoryNodeSchema = StrictObject({
  id: Type.String(),
  name: Type.String(),
  domain: Nullable(Type.String())
});
export type HistoryNode = Static<typeof HistoryNodeSchema>;

export const HistoryEdgeSchema = StrictObject({
  source: Type.String(),
  target: Type.String()
});
export type HistoryEdge = Static<typeof HistoryEdgeSchema>;

export const HistoryStructureNodeSchema = StrictObject({
  id: Type.String(),
  kind: RawEnum(["capability", "module", "component"] as const),
  name: Type.String(),
  capability: Nullable(Type.String())
});
export type HistoryStructureNode = Static<typeof HistoryStructureNodeSchema>;

const HistoryDeltaItemSchema = StrictObject({
  id: Type.String(),
  kind: RawEnum(["capability", "module", "component"] as const),
  capability: Nullable(Type.String())
});

const HistoryRenamedDeltaItemSchema = StrictObject({
  id: Type.String(),
  kind: RawEnum(["capability", "module", "component"] as const),
  capability: Nullable(Type.String()),
  from: Type.String(),
  to: Type.String()
});

export const HistoryDeltaSchema = StrictObject({
  baseRev: Nullable(GitOidSchema),
  added: Type.Array(HistoryDeltaItemSchema),
  removed: Type.Array(HistoryDeltaItemSchema),
  renamed: Type.Array(HistoryRenamedDeltaItemSchema),
  edgesChanged: StrictObject({
    added: Type.Array(HistoryEdgeSchema),
    removed: Type.Array(HistoryEdgeSchema)
  })
});
export type HistoryDelta = Static<typeof HistoryDeltaSchema>;

const HistoryErrorRecordSchema = StrictObject({
  code: HistoryErrorCodeSchema,
  path: Type.Optional(Type.String({ minLength: 1 }))
});

export const HistoryStateSchema = OneOf([
  StrictObject({
    nodes: Type.Array(HistoryNodeSchema),
    edges: Type.Array(HistoryEdgeSchema),
    structure: Type.Array(HistoryStructureNodeSchema)
  }),
  StrictObject({
    nodes: Type.Null(),
    edges: Type.Null(),
    structure: Type.Null(),
    error: HistoryErrorRecordSchema
  })
]);
export type HistoryState =
  | { nodes: HistoryNode[]; edges: HistoryEdge[]; structure: HistoryStructureNode[]; error?: never }
  | { nodes: null; edges: null; structure: null; error: { code: HistoryErrorCode; path?: string } };

export const HistoryMilestoneSchema = OneOf([
  StrictObject({
    rev: GitOidSchema,
    date: Type.String(),
    subject: Type.String(),
    nodes: Type.Array(HistoryNodeSchema),
    edges: Type.Array(HistoryEdgeSchema),
    delta: HistoryDeltaSchema
  }),
  StrictObject({
    rev: GitOidSchema,
    date: Type.String(),
    subject: Type.String(),
    nodes: Type.Null(),
    edges: Type.Null(),
    delta: Type.Null(),
    error: HistoryErrorRecordSchema
  })
]);
export type HistoryMilestone = { rev: string; date: string; subject: string } & (
  | { nodes: HistoryNode[]; edges: HistoryEdge[]; delta: HistoryDelta; error?: never }
  | { nodes: null; edges: null; delta: null; error: { code: HistoryErrorCode; path?: string } }
);

export const ArchitectureHistoryBodySchema = StrictObject({
  schemaVersion: Const(ARCHITECTURE_HISTORY_SCHEMA_VERSION),
  head: GitOidSchema,
  total: CountSchema,
  offset: CountSchema,
  limit: Type.Integer({ minimum: 0, maximum: 1000 }),
  milestones: Type.Array(TypedUnsafe<HistoryMilestone>(HistoryMilestoneSchema))
});

export const ArchitectureHistorySchema = SchemaDocument({
  $id: "https://archcontext.dev/schemas/runtime/architecture-history.schema.json",
  title: "ArchitectureHistory",
  schema: ArchitectureHistoryBodySchema
});
export type ArchitectureHistory = Static<typeof ArchitectureHistorySchema>;

function isValidDeltaItem(item: { id: string; kind: "capability" | "module" | "component"; capability: string | null }): boolean {
  return item.kind !== "capability" || item.capability === item.id;
}

/** Cache entries are untrusted and never authority for malformed data. */
export function decodeArchitectureHistoryState(value: unknown): HistoryState | undefined {
  if (!validateJsonSchema(TypedUnsafe<Json>(HistoryStateSchema), value as Json).valid) return undefined;
  const typed = value as HistoryState;
  if ("error" in typed && typed.error?.path !== undefined && !isRepoRelativePosixPath(typed.error.path)) return undefined;
  if ("structure" in typed && Array.isArray(typed.structure) && !typed.structure.every(isValidDeltaItem)) return undefined;
  return typed;
}

export function architectureHistoryIssues(value: unknown): string[] {
  const schemaCheck = validateJsonSchema(TypedUnsafe<Json>(ArchitectureHistorySchema), value as Json);
  if (!schemaCheck.valid) return ["invalid history envelope"];
  const typed = value as ArchitectureHistory;
  if (
    !Number.isSafeInteger(typed.total) ||
    !Number.isSafeInteger(typed.offset) ||
    !Number.isSafeInteger(typed.limit) ||
    typed.milestones.length > typed.limit ||
    typed.milestones.length > Math.max(0, typed.total - typed.offset)
  ) {
    return ["invalid history envelope"];
  }
  let previousValid: string | null = null;
  for (const milestone of typed.milestones) {
    if (milestone.delta === null) {
      if (milestone.error.path !== undefined && !isRepoRelativePosixPath(milestone.error.path)) return ["invalid history milestones"];
      continue;
    }
    if (previousValid !== null && milestone.delta.baseRev !== previousValid) return ["invalid history milestones"];
    if (previousValid === null && typed.offset === 0 && milestone.delta.baseRev !== null) return ["invalid history milestones"];
    if (!milestone.delta.added.every(isValidDeltaItem) || !milestone.delta.removed.every(isValidDeltaItem) || !milestone.delta.renamed.every(isValidDeltaItem)) {
      return ["invalid history milestones"];
    }
    previousValid = milestone.rev;
  }
  return [];
}

export function decodeArchitectureHistory(value: unknown): ArchitectureHistory | undefined {
  return architectureHistoryIssues(value).length === 0 ? (value as ArchitectureHistory) : undefined;
}
