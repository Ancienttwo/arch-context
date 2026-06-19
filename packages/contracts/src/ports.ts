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
  buildTaskContext(input: { task: string; maxSymbols: number; includeSource: boolean }): Promise<NormalizedCodeContext>;
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
