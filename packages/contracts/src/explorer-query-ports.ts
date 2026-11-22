import { digestJson, type Json } from "./schema";
import type {
  ArchitectureRepositoryIdentityV1,
  ArchitectureWorktreeIdentityV1
} from "./ledger-records";

export type ExplorerVerificationStatus = "MATCHED" | "DRIFT" | "UNKNOWN" | "VERIFIED";
export type ExplorerPressureLevel = "low" | "medium" | "high";

export interface SourceSelector {
  path: string;
  symbolId?: string;
  startLine?: number;
  endLine?: number;
}

export interface ExplorerServiceContract {
  schemaVersion: "archcontext.explorer-service/v1";
  bindHost: "127.0.0.1";
  protocol: "http-loopback";
  optIn: true;
  defaultEnabled: false;
  tokenTtlSeconds: number;
  readOnly: true;
  allowedMethods: ["GET"];
  egress: "none";
}

export const EXPLORER_VIEW_IDS = ["system-map", "task-impact", "drift-pressure", "data-flow", "external-integrations"] as const;
export type ExplorerViewIdV2 = typeof EXPLORER_VIEW_IDS[number];
export type ExplorerSemanticLevelV2 = "overview" | "context" | "detail";
export type ExplorerOccurrenceRoleV2 = "subject" | "derived-group";
export type ExplorerSubjectRefKindV2 =
  | "architecture-entity"
  | "architecture-relation"
  | "architecture-constraint"
  | "code-symbol";

export interface AuthorityCursorV1 {
  schemaVersion: "archcontext.authority-cursor/v1";
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  eventSequence: number;
  eventId: string;
  eventHash: string;
  graphDigest: string;
  evidenceStateDigest: string;
}

export interface ExplorerExpectedCursorV2 {
  headSha: string;
  worktreeDigest: string;
  graphDigest: string;
  observedFactsDigest?: string;
}

export interface ExplorerProjectionQueryV2 {
  schemaVersion: "archcontext.explorer-projection-query/v2";
  viewId: ExplorerViewIdV2;
  semanticLevel?: ExplorerSemanticLevelV2;
  taskSessionId?: string;
  expectedCursor?: ExplorerExpectedCursorV2;
  focus?: { subjectId: string };
  expandedOccurrenceIds?: string[];
  depth: 0 | 1 | 2;
  budget: {
    maxNodes: number;
    maxRelations: number;
  };
}

export interface ExplorerProjectionCursorV2 {
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  authoritySource: "git" | "ledger";
  authorityCursor: AuthorityCursorV1 | null;
  evidenceAuthorityCursor: AuthorityCursorV1 | null;
  inputManifestDigest: string;
  compatibilityDigest: string;
  graphDigest: string;
  evidenceStateDigest: string;
  observedFactsDigest: string;
  viewDefinitionDigest: string;
  compilerVersion: "archcontext.explorer-view-compiler/v1";
  taskSessionDigest?: string;
  observedAvailability: { status: "ready" | "unavailable"; reasonCode?: string };
}

export interface ProjectionInputManifestV1 {
  schemaVersion: "archcontext.projection-input-manifest/v1";
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  authoritySource: "git" | "ledger";
  authorityCursor: AuthorityCursorV1 | null;
  evidenceAuthorityCursor: AuthorityCursorV1 | null;
  queryDigest: string;
  graphDigest: string;
  evidenceStateDigest: string;
  observedFactsDigest: string;
  observedAvailability: { status: "ready" | "unavailable"; reasonCode?: string };
  bindingsDigest: string;
  eventBacklinksDigest: string;
  driftDigest: string | null;
  pressureDigest: string | null;
  taskSessionDigest: string | null;
  readPlan: ProjectionReadPlanV1;
  readSet: ProjectionReadSetV1;
  inputDomains: Record<ProjectionInputDomainV1, ProjectionInputDomainStateV1>;
  viewDefinitionDigest: string;
  compilerVersion: "archcontext.explorer-view-compiler/v1";
  tokenRequired: boolean;
  compatibilityDigest: string;
  manifestDigest: string;
}

export type ProjectionInputDomainV1 =
  | "authority"
  | "graph"
  | "evidence"
  | "observed"
  | "bindings"
  | "event-backlinks"
  | "drift"
  | "pressure"
  | "task-session";

export type ProjectionInputDomainStateV1 =
  | { requirement: "required"; status: "ready"; digest: string }
  | { requirement: "optional"; status: "ready"; digest: string }
  | { requirement: "optional"; status: "unavailable"; digest: null; reasonCode: string }
  | { requirement: "not-used"; status: "not-used"; digest: null };

export const EXPLORER_VIEW_INPUT_REQUIREMENTS = {
  "system-map": {
    authority: "required", graph: "required", evidence: "required", observed: "required", bindings: "required",
    "event-backlinks": "optional", drift: "optional", pressure: "optional", "task-session": "optional"
  },
  "task-impact": {
    authority: "required", graph: "required", evidence: "required", observed: "required", bindings: "required",
    "event-backlinks": "optional", drift: "optional", pressure: "optional", "task-session": "required"
  },
  "drift-pressure": {
    authority: "required", graph: "required", evidence: "required", observed: "required", bindings: "required",
    "event-backlinks": "optional", drift: "required", pressure: "required", "task-session": "optional"
  },
  "data-flow": {
    authority: "required", graph: "required", evidence: "required", observed: "required", bindings: "required",
    "event-backlinks": "optional", drift: "optional", pressure: "optional", "task-session": "optional"
  },
  "external-integrations": {
    authority: "required", graph: "required", evidence: "required", observed: "required", bindings: "required",
    "event-backlinks": "optional", drift: "optional", pressure: "optional", "task-session": "optional"
  }
} as const satisfies Record<ExplorerViewIdV2, Record<ProjectionInputDomainV1, ProjectionInputDomainStateV1["requirement"]>>;

export const PROJECTION_READ_PLANNER_VERSION = "archcontext.projection-read-planner/v1" as const;
export const EXPLORER_PROJECTION_CACHE_POLICY_SCHEMA_VERSION = "archcontext.explorer-cache-policy/v1" as const;

export interface ExplorerProjectionCachePolicyV1 {
  schemaVersion: typeof EXPLORER_PROJECTION_CACHE_POLICY_SCHEMA_VERSION;
  maxEntriesPerScope: number;
  maxBytesPerScope: number;
  maxAgeMs: number;
  maxPinnedEntriesPerScope: number;
  maxPinTtlMs: number;
}

export interface ProjectionReadPlanV1 {
  schemaVersion: "archcontext.projection-read-plan/v1";
  plannerVersion: typeof PROJECTION_READ_PLANNER_VERSION;
  kind: "overview-aggregate" | "bounded-context" | "focused-neighborhood";
  source: "git-authority" | "verified-ledger-current";
  queryDigest: string;
  semanticLevel: ExplorerSemanticLevelV2;
  focusSubjectId: string | null;
  expandedKinds: string[];
  depth: 0 | 1 | 2;
  limits: {
    maxEntities: number;
    maxRelations: number;
    maxConstraints: number;
    maxBindings: number;
    maxBacklinks: number;
    maxGraphRows: number;
  };
  requiredDomains: ProjectionInputDomainV1[];
  ordering: "canonical-id-asc";
  truncation: "hard-limit-with-authoritative-totals";
  planDigest: string;
}

export interface ProjectionReadSetV1 {
  schemaVersion: "archcontext.projection-read-set/v1";
  planDigest: string;
  selectedGraphDigest: string;
  authoritativeTotals: { entities: number; relations: number; constraints: number };
  entityKindTotals: Array<{ kind: string; count: number }>;
  rowsRead: { entities: number; relations: number; constraints: number; bindings: number; backlinks: number };
  truncated: boolean;
  readSetDigest: string;
}

export function explorerProjectionQueryDigestV2(query: ExplorerProjectionQueryV2): string {
  return digestJson({
    schemaVersion: query.schemaVersion,
    viewId: query.viewId,
    semanticLevel: query.semanticLevel ?? "context",
    taskSessionId: query.taskSessionId ?? null,
    focus: query.focus ?? null,
    expandedOccurrenceIds: [...new Set(query.expandedOccurrenceIds ?? [])].sort(),
    depth: query.depth,
    budget: query.budget
  } as unknown as Json);
}

export function canonicalProjectionReadPlanV1(
  query: ExplorerProjectionQueryV2,
  source: ProjectionReadPlanV1["source"]
): ProjectionReadPlanV1 {
  if (
    query.schemaVersion !== "archcontext.explorer-projection-query/v2"
    || !(EXPLORER_VIEW_IDS as readonly string[]).includes(query.viewId)
    || !Number.isInteger(query.depth) || query.depth < 0 || query.depth > 2
    || !Number.isInteger(query.budget.maxNodes) || query.budget.maxNodes < 1 || query.budget.maxNodes > 1_000
    || !Number.isInteger(query.budget.maxRelations) || query.budget.maxRelations < 0 || query.budget.maxRelations > 5_000
  ) {
    throw new Error("explorer-projection-query-invalid");
  }
  const semanticLevel = query.semanticLevel ?? "context";
  const kind: ProjectionReadPlanV1["kind"] = semanticLevel === "overview"
    ? "overview-aggregate"
    : query.focus
      ? "focused-neighborhood"
      : "bounded-context";
  const maxEntities = query.budget.maxNodes;
  const maxRelations = query.budget.maxRelations;
  const maxConstraints = Math.max(1, Math.min(2_000, maxEntities * 2));
  const maxBindings = Math.max(1, Math.min(4_000, maxEntities * 4));
  const maxBacklinks = Math.max(1, Math.min(8_000, maxEntities * 8));
  const requirements = EXPLORER_VIEW_INPUT_REQUIREMENTS[query.viewId];
  const withoutDigest = {
    schemaVersion: "archcontext.projection-read-plan/v1" as const,
    plannerVersion: PROJECTION_READ_PLANNER_VERSION,
    kind,
    source,
    queryDigest: explorerProjectionQueryDigestV2(query),
    semanticLevel,
    focusSubjectId: query.focus?.subjectId ?? null,
    expandedKinds: [...new Set((query.expandedOccurrenceIds ?? []).flatMap((id) => {
      const prefix = `occurrence.${query.viewId}.group.kind.`;
      return id.startsWith(prefix) ? [id.slice(prefix.length)] : [];
    }))].sort(),
    depth: query.depth,
    limits: {
      maxEntities,
      maxRelations,
      maxConstraints,
      maxBindings,
      maxBacklinks,
      maxGraphRows: maxEntities + maxRelations + maxConstraints
    },
    requiredDomains: (Object.entries(requirements) as Array<[ProjectionInputDomainV1, ProjectionInputDomainStateV1["requirement"]]>)
      .filter(([, requirement]) => requirement === "required")
      .map(([domain]) => domain)
      .sort(),
    ordering: "canonical-id-asc" as const,
    truncation: "hard-limit-with-authoritative-totals" as const
  };
  return { ...withoutDigest, planDigest: digestJson(withoutDigest as unknown as Json) };
}
