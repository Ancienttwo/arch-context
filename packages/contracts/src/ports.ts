import { digestJson, type Json } from "./schema";
import type {
  AgentJobV1,
  ArchitectureEventSource,
  ArchitectureRepositoryIdentityV1,
  ArchitectureWorktreeIdentityV1,
  InvestigationReportV1
} from "./ledger";

export interface WorkspaceRef {
  root: string;
  repositoryId: string;
  headSha: string;
}

export interface RepositorySnapshot {
  repositoryId: string;
  headSha: string;
  worktreeDigest: string;
  modelDigest?: string;
}

export interface CodeFactsSnapshot {
  provider: "codegraph";
  version: string;
  schemaDigest: string;
  indexedAt: string;
  workspaceDigest: string;
}

export interface NormalizedSymbol {
  id: string;
  name: string;
  kind: string;
  path: string;
  range?: { startLine: number; endLine: number };
}

export interface NormalizedEdge {
  source: string;
  target: string;
  kind: "calls" | "imports" | "reads" | "writes" | "implements";
  confidence: "low" | "medium" | "high";
}

export type ObservedEvidencePolarity = "positive" | "absence" | "declaration";
export type ObservedEvidenceSupport = "recommendation" | "checkpoint" | "complete";

export interface ObservedEvidenceCoverage {
  level: PracticeEvidenceBindingCoverageLevel;
  scope: string;
}

export interface ObservedEvidence {
  id: string;
  selector: SourceSelector;
  summary: string;
  confidence: "heuristic" | "observed" | "verified";
  polarity?: ObservedEvidencePolarity;
  coverage?: ObservedEvidenceCoverage;
  supports?: ObservedEvidenceSupport[];
  snapshot: RepositorySnapshot;
  practiceBindings?: PracticeEvidenceBinding[];
}

export type PracticeEvidenceBindingProvenance =
  | "codegraph"
  | "model-store-yaml"
  | "checkpoint"
  | "runtime-daemon"
  | "user"
  | "subagent"
  | "external-doc";

export type PracticeEvidenceBindingCoverageLevel = "complete" | "partial" | "unknown";

export interface PracticeEvidenceBindingCoverage {
  level: PracticeEvidenceBindingCoverageLevel;
  scope: string;
}

export interface PracticeEvidenceBinding {
  practiceId: string;
  triggerId?: string;
  subject?: string;
  provenance: PracticeEvidenceBindingProvenance;
  coverage: PracticeEvidenceBindingCoverage;
}

export interface NormalizedCodeContext {
  task: string;
  symbols: NormalizedSymbol[];
  edges: NormalizedEdge[];
  evidence: ObservedEvidence[];
  digest: string;
}

export interface NormalizedImpact {
  symbolId: string;
  callers: NormalizedEdge[];
  callees: NormalizedEdge[];
  affectedPaths: string[];
}

export interface SymbolQuery {
  query: string;
  kinds?: string[];
  limit?: number;
}

export interface ImpactQuery {
  symbolId: string;
  depth: number;
}

export interface SourceSelector {
  path: string;
  symbolId?: string;
  startLine?: number;
  endLine?: number;
}

export interface CodeFactsPort {
  ensureReady(workspace: WorkspaceRef): Promise<CodeFactsSnapshot>;
  sync(input: { workspace: WorkspaceRef; changedPaths?: string[] }): Promise<CodeFactsSnapshot>;
  buildTaskContext(input: { task: string; maxSymbols: number; includeSource: boolean; changedPaths?: string[] }): Promise<NormalizedCodeContext>;
  findSymbols(query: SymbolQuery): Promise<NormalizedSymbol[]>;
  getImpact(input: ImpactQuery): Promise<NormalizedImpact>;
  getCallers(symbolId: string): Promise<NormalizedEdge[]>;
  getCallees(symbolId: string): Promise<NormalizedEdge[]>;
  resolveEvidence(selectors: SourceSelector[]): Promise<ObservedEvidence[]>;
}

export interface LocalStorePort {
  migrate(): Promise<void>;
  beginSnapshot(snapshot: RepositorySnapshot): Promise<string>;
  commitSnapshot(snapshotId: string): Promise<void>;
  saveTaskState(taskSessionId: string, state: unknown): Promise<void>;
  readTaskState(taskSessionId: string): Promise<unknown | undefined>;
  saveReviewResult(reviewId: string, result: unknown): Promise<void>;
}

export interface ModelStorePort {
  loadManifest(workspace: WorkspaceRef): Promise<unknown>;
  loadModel(workspace: WorkspaceRef): Promise<unknown[]>;
  validateModel(workspace: WorkspaceRef): Promise<{ valid: boolean; errors: string[]; modelDigest: string }>;
  writeChangeSetPreview(changeSet: unknown): Promise<{ digest: string; summary: string }>;
}

export interface PolicyPort {
  evaluateChangeSet(changeSet: unknown): Promise<{ allowed: boolean; violations: string[] }>;
  evaluateReview(input: unknown): Promise<{ result: "pass" | "fail"; findings: unknown[] }>;
}

export type InvestigationContextRisk = "low" | "medium" | "high";
export type InvestigationContextUncertainty = "low" | "medium" | "high";

export interface InvestigationContextBundle {
  schemaVersion: "archcontext.investigation-context-bundle/v1";
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  taskSessionId: string;
  fingerprint: string;
  trigger: {
    source: ArchitectureEventSource;
    reason: string;
  };
  risk: InvestigationContextRisk;
  uncertainty: InvestigationContextUncertainty;
  summary: string;
  evidenceBindingIds: string[];
  candidateChangeIds: string[];
  inputDigest: string;
  extensions?: Record<string, Json>;
}

export interface InvestigationRunnerInput {
  job: AgentJobV1;
  context: InvestigationContextBundle;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export interface InvestigationRunnerPort {
  readonly runnerId: string;
  readonly capabilities: {
    provider: string;
    supportsCancellation: boolean;
    canReadRepositoryText: boolean;
    canMutateRepository: false;
  };
  runInvestigation(input: InvestigationRunnerInput): Promise<InvestigationReportV1>;
}

export interface RendererPort {
  renderProjection(input: { modelDigest: string; model: unknown[] }): Promise<{ path: string; content: string }[]>;
}

export interface CloudMetadataPort {
  verifyEntitlement(input: { repositoryVisibility: "public" | "private"; accountId?: string }): Promise<{ allowed: boolean; reason?: string }>;
  submitAttestation(input: unknown): Promise<{ accepted: boolean; checkRunId?: string; reason?: string }>;
}

export type NotificationResult = "pass" | "pass_with_warnings" | "fail_action_required";
export type NotificationRiskLevel = "low" | "medium" | "high" | "critical";
export type NotificationProviderKind = "github-check" | "slack" | "webhook" | "email";

export interface NotificationEvent {
  schemaVersion: "archcontext.notification-event/v1";
  eventId: string;
  prUrl: string;
  result: NotificationResult;
  riskLevel: NotificationRiskLevel;
  commitSha: string;
  runtimeVersion: string;
  occurredAt: string;
}

export interface NotificationProviderConfig {
  schemaVersion: "archcontext.notification-provider/v1";
  id: string;
  provider: NotificationProviderKind;
  enabled: boolean;
  target: string;
  secretRef?: string;
  unsubscribeUrl?: string;
  retry: {
    maxAttempts: number;
    backoffSeconds: number;
  };
}

export interface NotificationDeliveryResult {
  providerId: string;
  delivered: boolean;
  idempotencyKey: string;
  attempt: number;
  statusCode?: number;
  deadLettered?: boolean;
  reason?: string;
}

export interface NotificationPublisher {
  publish(event: NotificationEvent): Promise<NotificationDeliveryResult[]>;
}

export interface ModelProjectionFile {
  path: string;
  content: string;
}

export interface ModelExportResult {
  format: "likec4" | "structurizr" | "mermaid";
  digest: string;
  files: ModelProjectionFile[];
}

export interface ModelInteropExporter {
  exportModel(input: { nodes: Json[]; relations: Json[] }): Promise<ModelExportResult>;
}

export interface ModelInteropImporter {
  importInitialModel(input: { content: string; source: "likec4" | "structurizr" }): Promise<{ nodes: Json[]; relations: Json[]; warnings: string[] }>;
}

export type ExplorerVerificationStatus = "MATCHED" | "DRIFT" | "UNKNOWN" | "VERIFIED";
export type ExplorerPressureLevel = "low" | "medium" | "high";

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

export type ExplorerViewIdV2 = "system-map" | "task-impact" | "drift-pressure";
export type ExplorerSemanticLevelV2 = "overview" | "context" | "detail";
export type ExplorerOccurrenceRoleV2 = "subject" | "derived-group";
export type ExplorerSubjectRefKindV2 =
  | "architecture-entity"
  | "architecture-relation"
  | "architecture-constraint"
  | "code-symbol";

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
    || !["system-map", "task-impact", "drift-pressure"].includes(query.viewId)
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

export interface ExplorerSubjectRefV2 {
  kind: ExplorerSubjectRefKindV2;
  id: string;
}

export interface ExplorerOccurrenceProvenanceV2 {
  declaredEntityIds: string[];
  observedSymbolIds: string[];
  evidenceBindingIds: string[];
}

export type ExplorerAuthorityStateV2 = "BOUND" | "UNBOUND_OBSERVED" | "DECLARED_UNOBSERVED" | "DERIVED";

export interface ExplorerPressureEvaluationV2 {
  evaluated: boolean;
  level?: ExplorerPressureLevel;
  score?: number;
  signals: string[];
  inputDigest?: string;
}

export interface ExplorerInspectorV2 {
  summary?: string;
  responsibility?: string;
  constraints: Array<{ id: string; kind: string; severity?: string; summary?: string }>;
  decisions: Array<{ eventId: string; title?: string; rationale?: string }>;
  historyEvents: Array<{ eventId: string; title?: string; rationale?: string }>;
  sourceSelectors: SourceSelector[];
  evidenceBindingIds: string[];
}

export interface ExplorerBacklinksV2 {
  appearsInViews: ExplorerViewIdV2[];
  affectedByTaskSessionIds: string[];
  constrainedByIds: string[];
  evidencedByBindingIds: string[];
  changedByEventIds: string[];
  decidedByEventIds: string[];
  incomingRelationIds: string[];
  outgoingRelationIds: string[];
}

export interface ExplorerSubjectOccurrenceV2 {
  occurrenceId: string;
  role: "subject";
  parentOccurrenceId?: string;
  subjectRefs: ExplorerSubjectRefV2[];
  name: string;
  kind: string;
  childrenCount: number;
  expandable: boolean;
  verificationStatus: ExplorerVerificationStatus;
  authorityState: ExplorerAuthorityStateV2;
  pressure: ExplorerPressureEvaluationV2;
  sourceSelectors: SourceSelector[];
  provenance: ExplorerOccurrenceProvenanceV2;
  inspector: ExplorerInspectorV2;
  backlinks: ExplorerBacklinksV2;
}

export interface ExplorerDerivedGroupOccurrenceV2 {
  occurrenceId: string;
  role: "derived-group";
  parentOccurrenceId?: string;
  subjectRefs: [];
  name: string;
  kind: string;
  childrenCount: number;
  expandable: boolean;
  verificationStatus: "UNKNOWN";
  authorityState: "DERIVED";
  pressure: ExplorerPressureEvaluationV2;
  sourceSelectors: [];
  provenance: ExplorerOccurrenceProvenanceV2;
  derivation: {
    ruleId: string;
    inputDigest: string;
    compilerVersion: "archcontext.explorer-view-compiler/v1";
  };
}

export type ExplorerOccurrenceV2 = ExplorerSubjectOccurrenceV2 | ExplorerDerivedGroupOccurrenceV2;

export interface ExplorerRelationOccurrenceV2 {
  occurrenceId: string;
  sourceOccurrenceId: string;
  targetOccurrenceId: string;
  kind: string;
  verificationStatus: ExplorerVerificationStatus;
  provenance: {
    declaredRelationIds: string[];
    observedEdgeIds: string[];
    evidenceBindingIds: string[];
  };
}

export interface ExplorerProjectionV2 {
  schemaVersion: "archcontext.explorer-projection/v2";
  view: {
    id: ExplorerViewIdV2;
    title: string;
    question: string;
  };
  availableViews: Array<{ id: ExplorerViewIdV2; enabled: boolean; reason?: string }>;
  semanticLevel: ExplorerSemanticLevelV2;
  breadcrumbs: Array<{ occurrenceId: string; label: string }>;
  cursor: ExplorerProjectionCursorV2;
  inputManifest: ProjectionInputManifestV1;
  occurrences: ExplorerOccurrenceV2[];
  relations: ExplorerRelationOccurrenceV2[];
  page: {
    budget: { maxNodes: number; maxRelations: number };
    totalNodes: number;
    totalRelations: number;
    returnedNodes: number;
    returnedRelations: number;
    truncated: boolean;
    omittedNodeCount: number;
    omittedRelationCount: number;
  };
  projectionDigest: string;
  capabilities: {
    readOnly: true;
    mutationMode: "forbidden";
    egress: "none";
    tokenRequired: boolean;
  };
}

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

export type ExplorerDeltaClassV2 = "architecture-fact" | "evidence" | "projection";

export type ExplorerDeltaFailureReasonV2 =
  | "invalid-delta-query"
  | "projection-cache-miss"
  | "authority-event-missing"
  | "authority-cursor-reversed"
  | "projection-authority-mismatch"
  | "projection-manifest-incompatible";

export interface ExplorerDeltaQueryV2 {
  schemaVersion: "archcontext.explorer-delta-query/v2";
  base: { eventId: string; projectionDigest: string };
  head: { eventId: string; projectionDigest: string };
}

export interface ExplorerDeltaChangeV2 {
  deltaClass: ExplorerDeltaClassV2;
  subjectId: string;
  change: "added" | "removed" | "changed";
  fields: string[];
  verificationTransition?: { from: ExplorerVerificationStatus; to: ExplorerVerificationStatus };
}

export interface ExplorerProjectionDeltaV2 {
  schemaVersion: "archcontext.explorer-projection-delta/v2";
  base: AuthorityCursorV1 & { projectionDigest: string; inputManifestDigest: string };
  head: AuthorityCursorV1 & { projectionDigest: string; inputManifestDigest: string };
  factChanges: ExplorerDeltaChangeV2[];
  evidenceChanges: ExplorerDeltaChangeV2[];
  projectionChanges: ExplorerDeltaChangeV2[];
  counts: Record<ExplorerDeltaClassV2, number>;
  deltaDigest: string;
}

export interface RetrievalConfig {
  schemaVersion: "archcontext.retrieval-config/v1";
  defaultMode: "lexical";
  lexical: {
    enabled: true;
    tokenizer: "english-normalized+jieba-search";
  };
  embedding: {
    enabled: boolean;
    provider: "local-deterministic" | "local-provider";
    dimensions: number;
    indexPath?: string;
    egress: "forbidden";
  };
  decisionGate: RetrievalDecisionThresholds;
}

export interface RetrievalEvalQuery {
  id: string;
  text: string;
  expectedContextIds: string[];
  expectedConstraintIds: string[];
  prohibitedContextIds: string[];
}

export interface RetrievalEvalSet {
  schemaVersion: "archcontext.retrieval-eval/v1";
  id: string;
  seed: number;
  queries: RetrievalEvalQuery[];
}

export interface RetrievalScore {
  contextRecall: number;
  constraintRecall: number;
  irrelevantRatio: number;
  toolCalls: number;
}

export interface RetrievalDecisionThresholds {
  minContextRecallLift: number;
  minConstraintRecallLift: number;
  maxIrrelevantRatio: number;
  maxToolCallIncrease: number;
}

export interface RetrievalDecisionRecord {
  schemaVersion: "archcontext.retrieval-decision/v1";
  decidedAt: string;
  baseline: RetrievalScore & { mode: "lexical" };
  candidate: RetrievalScore & { mode: "embedding" };
  thresholds: RetrievalDecisionThresholds;
  decision: "enable-embedding" | "keep-lexical";
  evidenceDigest: string;
}

export interface ChatGptGaToolContract {
  schemaVersion: "archcontext.chatgpt-ga-tool/v1";
  toolName: string;
  surface: "cloud-metadata" | "local-runtime";
  readOnlyByDefault: boolean;
  dataClassification: "cloud-metadata" | "local-metadata" | "local-architecture";
  requiresLocalConfirmationForWrite: boolean;
  disclosure: string;
}
