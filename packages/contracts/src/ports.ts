import type { Json } from "./schema";

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

export interface ObservedEvidence {
  id: string;
  selector: SourceSelector;
  summary: string;
  confidence: "heuristic" | "observed" | "verified";
  snapshot: RepositorySnapshot;
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

export interface ExplorerNodeView {
  id: string;
  name: string;
  kind: string;
  repositoryId?: string;
  verificationStatus: ExplorerVerificationStatus;
  pressure: {
    level: ExplorerPressureLevel;
    score: number;
    signals: string[];
  };
  sourceSelectors: SourceSelector[];
}

export interface ExplorerRelationView {
  id: string;
  source: string;
  target: string;
  kind: string;
  verificationStatus: ExplorerVerificationStatus;
}

export interface ExplorerProjection {
  schemaVersion: "archcontext.explorer-projection/v1";
  generatedAt: string;
  repository: RepositorySnapshot;
  nodes: ExplorerNodeView[];
  relations: ExplorerRelationView[];
  landscape?: Json;
  verification: Json[];
  pressure: Json[];
  interventions: Json[];
  capabilities: {
    readOnly: true;
    mutationMode: "forbidden";
    egress: "none";
    tokenRequired: boolean;
  };
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
