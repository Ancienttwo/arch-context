import { digestJson, type ArchContextError, type Json } from "./schema";
import {
  BoundedStringSchema,
  Const,
  GitOidSchema,
  OneOf,
  RawEnum,
  Ref,
  SchemaDocument,
  Sha256DigestSchema,
  StrictObject,
  Type,
  TypedUnsafe,
  UniqueStringArray,
  type Static
} from "./schema-kit";

/** Measured architecture work, distinct from generated-file freshness and source byte stamps. */
export const ARCHITECTURE_DEBT_SCHEMA_VERSION = "archcontext.architecture-debt/v1" as const;
export const ARCHITECTURE_DEBT_KINDS = ["unowned-path", "ambiguous-owner", "undeclared-dependency", "flow-proof-failed", "stale-anchor", "practice-regression", "state-machine-rule", "state-machine-stale"] as const;
export type ArchitectureDebtKind = typeof ARCHITECTURE_DEBT_KINDS[number];
export const ARCHITECTURE_DEBT_CHECKS = ["ownership", "anchors", "dependencies", "flows", "state-machines", "practices"] as const;
export type ArchitectureDebtCheck = typeof ARCHITECTURE_DEBT_CHECKS[number];

const DEBT_SCHEMA_ID = "https://archctx.repoharness.com/schemas/runtime/architecture-debt.schema.json";

const DebtCoverageSchema = RawEnum(["complete", "partial", "unknown"] as const);

const DebtDetailValueSchema = OneOf([
  BoundedStringSchema,
  Type.Integer(),
  UniqueStringArray(BoundedStringSchema)
]);

export const ArchitectureDebtItemSchema = StrictObject({
  /** Content identity, independent of absolute root, branch, timestamps and source byte stamps. */
  id: Type.String({ pattern: "^debt\\.[a-f0-9]{64}$" }),
  kind: RawEnum(ARCHITECTURE_DEBT_KINDS),
  /** Canonical producer identities. Empty for a source path with no owner. */
  nodeIds: UniqueStringArray(BoundedStringSchema),
  capabilityIds: UniqueStringArray(BoundedStringSchema),
  paths: UniqueStringArray(BoundedStringSchema),
  reasonCode: BoundedStringSchema,
  action: BoundedStringSchema,
  /** Bounded metadata only; never source bodies or arbitrary provider output. */
  details: TypedUnsafe<Record<string, string | number | string[]>>({
    type: "object",
    maxProperties: 12,
    additionalProperties: DebtDetailValueSchema
  })
});

export const ArchitectureDebtCheckSchema = StrictObject({
  check: RawEnum(ARCHITECTURE_DEBT_CHECKS),
  coverage: DebtCoverageSchema,
  reasonCodes: UniqueStringArray(BoundedStringSchema)
});

export const ArchitectureDebtReportBodySchema = StrictObject({
  schemaVersion: Const(ARCHITECTURE_DEBT_SCHEMA_VERSION),
  scope: StrictObject({
    kind: RawEnum(["repository", "changed-paths"] as const),
    changedPaths: UniqueStringArray(BoundedStringSchema),
    capabilityIds: UniqueStringArray(BoundedStringSchema)
  }),
  /** A partial/unknown report with no items does not prove absence of debt. */
  coverage: DebtCoverageSchema,
  coverageReasonCodes: UniqueStringArray(BoundedStringSchema),
  checks: Type.Array(ArchitectureDebtCheckSchema, { minItems: 6, maxItems: 6 }),
  items: Type.Array(ArchitectureDebtItemSchema),
  actionsRequired: UniqueStringArray(BoundedStringSchema),
  /** Binds the entire debt report. Checkpoint's existing resultDigest binds practice guidance only. */
  digest: Sha256DigestSchema
});

export const ArchitectureDebtReportSchema = SchemaDocument({
  $id: DEBT_SCHEMA_ID,
  title: "ArchitectureDebtReportV1",
  schema: ArchitectureDebtReportBodySchema
});

export type ArchitectureDebtItemV1 = Static<typeof ArchitectureDebtItemSchema>;
export type ArchitectureDebtCheckV1 = Static<typeof ArchitectureDebtCheckSchema>;
export type ArchitectureDebtReportV1 = Static<typeof ArchitectureDebtReportSchema>;

export const ARCHITECTURE_DEBT_DELTA_SCHEMA_VERSION = "archcontext.architecture-debt-delta/v1" as const;

export const ArchitectureDebtDeltaReportBodySchema = StrictObject({
  schemaVersion: Const(ARCHITECTURE_DEBT_DELTA_SCHEMA_VERSION),
  /** The current working tree, anchored to its checked-out commit. */
  head: StrictObject({
    sha: Ref<string>("#/$defs/commitSha"),
    debt: Ref<ArchitectureDebtReportV1>("architecture-debt.schema.json")
  }),
  base: StrictObject({
    ref: Type.String({ minLength: 1 }),
    sha: Ref<string>("#/$defs/commitSha"),
    debtDigest: Ref<string>("architecture-debt.schema.json#/properties/digest"),
    coverage: Ref<ArchitectureDebtReportV1["coverage"]>("architecture-debt.schema.json#/properties/coverage"),
    coverageReasonCodes: Ref<string[]>("architecture-debt.schema.json#/properties/coverageReasonCodes")
  }),
  /** Ordered by item ID. An absence requires complete coverage from the opposing check. */
  introduced: Type.Array(Ref<ArchitectureDebtItemV1>("architecture-debt.schema.json#/properties/items/items"), {
    description: "Items ordered by item ID.",
    uniqueItems: true
  }),
  resolvedIds: Type.Array(Ref<string>("architecture-debt.schema.json#/properties/items/items/properties/id"), {
    description: "Resolved item IDs in ascending order.",
    uniqueItems: true
  })
});

export const ArchitectureDebtDeltaReportSchema = SchemaDocument({
  $id: "https://archctx.repoharness.com/schemas/runtime/architecture-debt-delta.schema.json",
  title: "ArchitectureDebtDeltaReportV1",
  schema: ArchitectureDebtDeltaReportBodySchema,
  $defs: {
    commitSha: GitOidSchema
  }
});

export type ArchitectureDebtDeltaReportV1 = Static<typeof ArchitectureDebtDeltaReportSchema>;

export const ArchitectureDebtHookLogSchema = StrictObject({
  schemaVersion: Const("archcontext.hook-log/v1"),
  event: Type.String({ minLength: 1 }),
  elapsedMs: Type.Number({ minimum: 0 }),
  pathCount: Type.Integer({ minimum: 0 }),
  changedPathDigest: Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }),
  reasonCode: Type.String({ minLength: 1 }),
  failOpen: Const(false),
  egress: Const("none"),
  network: Const("forbidden")
});

export const ArchitectureDebtHookCheckpointBodySchema = StrictObject({
  schemaVersion: Const("archcontext.hook-debt-checkpoint/v1"),
  debt: Ref<typeof ArchitectureDebtReportSchema>("architecture-debt.schema.json"),
  hookLog: ArchitectureDebtHookLogSchema
});

export const ArchitectureDebtHookCheckpointSchema = SchemaDocument({
  $id: "https://archctx.repoharness.com/schemas/runtime/hook-debt-checkpoint.schema.json",
  title: "ArchitectureDebtHookCheckpointV1",
  schema: ArchitectureDebtHookCheckpointBodySchema
});

export interface ArchitectureDebtHookLogV1 {
  schemaVersion: "archcontext.hook-log/v1";
  event: string;
  elapsedMs: number;
  pathCount: number;
  changedPathDigest: string;
  reasonCode: string;
  failOpen: boolean;
  egress: "none";
  network: "forbidden";
}

/** Hook-only observation; it never advances the practice baseline. */
export interface ArchitectureDebtHookCheckpointV1 {
  schemaVersion: "archcontext.hook-debt-checkpoint/v1";
  debt: ArchitectureDebtReportV1;
  hookLog: ArchitectureDebtHookLogV1;
}

/** Unavailable observation, never a clean debt report. Invalid arguments remain errors. */
export interface ArchitectureDebtHookFailureV1 {
  schemaVersion: "archcontext.hook-checkpoint-fail-open/v1";
  accepted: false;
  failOpen: true;
  coverage: "unknown";
  reasonCode: string;
  error: ArchContextError;
  event: string;
  pathCount: number;
  egress: "none";
  network: "forbidden";
  hookLog: ArchitectureDebtHookLogV1;
}

export function architectureDebtReportIssues(report: ArchitectureDebtReportV1): string[] {
  const issues: string[] = [];
  const sorted = (name: string, values: string[]) => {
    if (values.some((v, i) => i > 0 && v <= values[i - 1]!)) issues.push(`${name} must be sorted and unique`);
  };
  if (report.schemaVersion !== ARCHITECTURE_DEBT_SCHEMA_VERSION) issues.push("unsupported schemaVersion");
  const { digest, ...body } = report;
  if (digest !== digestJson(body as unknown as Json)) issues.push("digest must bind the debt report");
  sorted("items", report.items.map(item => item.id));
  sorted("actionsRequired", report.actionsRequired);
  sorted("coverageReasonCodes", report.coverageReasonCodes);
  sorted("scope.changedPaths", report.scope.changedPaths);
  sorted("scope.capabilityIds", report.scope.capabilityIds);
  if (report.checks.length !== ARCHITECTURE_DEBT_CHECKS.length || ARCHITECTURE_DEBT_CHECKS.some((check, i) => report.checks[i]?.check !== check)) issues.push("checks must enumerate every producer in contract order");
  const coverage = report.checks.every(check => check.coverage === "complete") ? "complete"
    : report.checks.every(check => check.coverage === "unknown") ? "unknown" : "partial";
  if (report.coverage !== coverage) issues.push("coverage must describe all checks");
  const reasons = [...new Set(report.checks.flatMap(check => check.reasonCodes.map(reason => `${check.check}:${reason}`)))].sort();
  if (JSON.stringify(reasons) !== JSON.stringify(report.coverageReasonCodes)) issues.push("coverageReasonCodes must describe check gaps");
  for (const check of report.checks) {
    sorted(`${check.check}.reasonCodes`, check.reasonCodes);
    if ((check.coverage === "complete") !== (check.reasonCodes.length === 0)) issues.push(`${check.check} must name every coverage gap`);
  }
  if (report.coverage === "unknown" && report.items.length > 0) issues.push("unknown coverage cannot contain measured items");
  const actions = [...new Set(report.items.map(item => item.action))].sort();
  if (JSON.stringify(actions) !== JSON.stringify(report.actionsRequired)) issues.push("actionsRequired must name the measured debt actions");
  for (const item of report.items) {
    if (!ARCHITECTURE_DEBT_KINDS.includes(item.kind)) issues.push("unsupported debt kind");
    if (!item.action || !item.reasonCode) issues.push("every item needs a reason and action");
    sorted(`${item.id}.nodeIds`, item.nodeIds);
    sorted(`${item.id}.capabilityIds`, item.capabilityIds);
    sorted(`${item.id}.paths`, item.paths);
    const strings = [item.action, item.reasonCode, ...item.nodeIds, ...item.capabilityIds, ...item.paths,
      ...Object.values(item.details).flatMap(value => typeof value === "string" ? [value] : Array.isArray(value) ? value : [])];
    if (strings.some(value => value.length === 0 || value.length > 1024)) issues.push(`${item.id} contains invalid metadata strings`);
    if (new TextEncoder().encode(JSON.stringify(item.details)).byteLength > 4096) issues.push(`${item.id}.details exceeds metadata budget`);
  }
  return issues;
}
