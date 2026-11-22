import { isRepoRelativePosixPath, type Json } from "./schema";
import type { SourceSelector } from "./explorer-query-ports";

export * from "./explorer-query-ports";
export * from "./explorer-occurrence-ports";

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

/**
 * What a sync did to the repository's shared CodeGraph base index (#608). `published`: a new base
 * is current. `current`: the base already names this `HEAD`. `skipped-busy`: another refresh holds
 * the lock. `skipped-moved`: a build ran, the index revision moved or `HEAD` moved during the
 * snapshot. `skipped-unborn`: `HEAD` names no commit. `not-primary`: a linked worktree never
 * publishes. `skipped-unverifiable`: the SDK resolves another database than `.codegraph/codegraph.db`.
 * `skipped-unproven`: `current.json` has no creation record, or `refresh.lock` is stale; archctx
 * replaces or removes neither, and lists it in `codeGraphKept`. `failed`: the snapshot or the
 * publish failed; the sync itself still succeeded.
 */
/**
 * A path at a name the base index uses that archctx left in place, with how to clean it up by hand.
 * archctx removes only what it created in the same run, so leftovers of a crashed seed, old
 * unreferenced snapshots, a stale `refresh.lock` and an unproven `current.json` stay.
 */
export interface CodeGraphKeptPathV1 {
  path: string;
  kind: "abandoned-staging" | "staging-not-removed" | "unreferenced-snapshot" | "snapshot-not-removed" | "stale-refresh-lock" | "refresh-lock-not-removed" | "unproven-pointer" | "pointer-temp-not-removed";
  cleanup: string;
}

export type CodeGraphBaseRefreshV1 = "published" | "current" | "skipped-busy" | "skipped-moved" | "skipped-unborn" | "skipped-unverifiable" | "skipped-unproven" | "not-primary" | "failed";

export interface CodeFactsSnapshot {
  provider: "codegraph";
  version: string;
  schemaDigest: string;
  indexedAt: string;
  workspaceDigest: string;
  /** Set by a provider that refreshes the base index after its sync. */
  codeGraphBase?: CodeGraphBaseRefreshV1;
  /** Paths at names the base index uses that archctx left in place for hand cleanup. */
  codeGraphKept?: CodeGraphKeptPathV1[];
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

export interface SymbolQuery {
  query: string;
  kinds?: string[];
  limit?: number;
}

export interface CodeFactsPort {
  /**
   * Runs before a command's incremental sync: seeds a missing index from the repository's base
   * index (#608), then refuses an incompatible one. No retry or rebuild.
   */
  prepareSync?(workspaceRoot: string): void;
  /**
   * Makes `workspace`'s facts readable. An existing index is verified read-only, on the first call
   * and every later one. Only a command that owns a sync passes `syncOnMiss`, which syncs the
   * workspace once when this port has not verified it yet.
   */
  ensureReady(workspace: WorkspaceRef, options?: { syncOnMiss?: boolean }): Promise<CodeFactsSnapshot>;
  sync(input: { workspace: WorkspaceRef; changedPaths?: string[] }): Promise<CodeFactsSnapshot>;
  /**
   * Reads facts of `workspace`'s own index only, after `ensureReady` or `sync` of that workspace;
   * a workspace with no successful sync, or whose index changed since it was verified, is refused.
   */
  buildTaskContext(input: { workspace: WorkspaceRef; task: string; maxSymbols: number; includeSource: boolean; changedPaths?: string[] }): Promise<NormalizedCodeContext>;
  findSymbols(query: SymbolQuery, workspace: WorkspaceRef): Promise<NormalizedSymbol[]>;
  /**
   * Resolves evidence against the verified snapshot of `workspace`, or the most recently verified
   * workspace on this port when `workspace` is omitted.
   */
  resolveEvidence(selectors: SourceSelector[], workspace?: WorkspaceRef): Promise<ObservedEvidence[]>;
}

export interface LocalStorePort {
  migrate(): Promise<void>;
  saveTaskState(taskSessionId: string, state: unknown): Promise<void>;
  readTaskState(taskSessionId: string): Promise<unknown | undefined>;
  saveReviewResult(reviewId: string, result: unknown): Promise<void>;
}

export const MODEL_VALIDATION_DIAGNOSTIC_CODES = ["missing-file", "schema-version-missing", "node-schema-invalid"] as const;
export interface ModelValidationDiagnostic {
  path: string;
  code: typeof MODEL_VALIDATION_DIAGNOSTIC_CODES[number];
  /** Validation-owned error identity; never emitted in the public failure projection. */
  error: string;
}

export interface ModelValidationResult {
  valid: boolean;
  errors: string[];
  diagnostics?: ModelValidationDiagnostic[];
  /**
   * The subset of `errors` that are cross-file references resolving to nothing, such as an ADR
   * `appliesTo` id with no node. Omitted when empty.
   */
  referenceErrors?: string[];
  /** Node schema errors with their file paths. Only a write to that node can repair them. */
  nodeSchemaErrors?: { path: string; error: string }[];
  /** Errors specifically repairable by replacing manifest model.layers; after validation remains strict. */
  layerOrderErrors?: string[];
  /** Constraint declaration errors specific to `rule.allowedTargets`. */
  allowedTargetErrors?: string[];
  /** Problems that do not invalidate the model, such as an ignored legacy setting. Omitted when empty. */
  warnings?: string[];
  modelDigest: string;
}

/** Projects only authority-supplied locations, never text parsed from validation errors. */
export function modelValidationFailureDetails(result: ModelValidationResult, blockingErrors: readonly string[]) {
  const blocking = new Set(blockingErrors);
  const records = [...result.diagnostics ?? [], ...(result.nodeSchemaErrors ?? []).map(issue => ({ ...issue, code: "node-schema-invalid" as const }))];
  const diagnostics = records.filter(issue => blocking.has(issue.error) && isRepoRelativePosixPath(issue.path) && new TextEncoder().encode(JSON.stringify(issue.path)).length <= 256)
    .slice(0, Math.min(8, blockingErrors.length)).map(({ path, code }) => ({ path, code }));
  return { issueCount: blockingErrors.length, diagnostics, omittedIssueCount: blockingErrors.length - diagnostics.length };
}

export interface ModelStorePort {
  loadManifest(workspace: WorkspaceRef): Promise<unknown>;
  loadModel(workspace: WorkspaceRef): Promise<unknown[]>;
  validateModel(workspace: WorkspaceRef): Promise<ModelValidationResult>;
  writeChangeSetPreview(changeSet: unknown): Promise<{ digest: string; summary: string }>;
}

/**
 * Errors that make a model unusable as the base of a write. Dangling references are excluded so
 * that a change repairing them (for example restoring a deleted node) is not blocked; the
 * after-apply model is still validated in full.
 */
export function baseModelBlockingErrors(result: ModelValidationResult): string[] {
  if (result.valid) return [];
  if (result.errors.length === 0) return ["unknown validation error"];
  const references = new Set(result.referenceErrors ?? []);
  return result.errors.filter((error) => !references.has(error));
}

export interface PolicyPort {
  evaluateChangeSet(changeSet: unknown): Promise<{ allowed: boolean; violations: string[] }>;
  evaluateReview(input: unknown): Promise<{ result: "pass" | "fail"; findings: unknown[] }>;
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

export interface NonLocalEgressChannel {
  channel: "context7" | "npm-update-check" | "projection-publishing" | "codegraph-telemetry";
  destination: string;
  trigger: string;
  data: string;
  status: "enabled" | "declared-awaiting-user-consent" | "blocked-by-policy";
}

export interface LocalEgressReport {
  ok: boolean;
  policyMode: "configured" | "local-only";
  enforcement: "application-admission";
  defaultOutbound: "local-only";
  effectiveOutbound: "local-only" | "non-local";
  nonLocalEgress: NonLocalEgressChannel[];
  cloudContentUpload: "deny";
  secureMcpTunnel: "disabled-by-default";
  thirdPartyTelemetry: "disabled" | "not-disabled-by-env";
  codeGraph: {
    provider: "codegraph";
    telemetry: "disabled" | "not-disabled-by-env";
    envVar: string;
    configuredValue: string | null;
    effectiveValue: string;
    source: "archcontext-default" | "environment";
  };
  warnings: string[];
}
