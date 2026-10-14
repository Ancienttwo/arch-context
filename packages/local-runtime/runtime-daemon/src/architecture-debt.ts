import {
  ARCHITECTURE_DEBT_CHECKS, architectureDebtReportIssues, FailureError, failureEnvelope, knownFailure, normalizeFailureResult, toEnvelope, isRepoRelativePosixPath, okEnvelope,
  type ArchContextErrorCode, type FailureStage, type StrictFailure,
  type ArchitectureDebtReportV1, type Json, type JsonEnvelope, type PracticeEnforcementEvaluationV1
} from "@archcontext/contracts";
import { resolveOwnership } from "@archcontext/core/module-statistics";
import { ancestorChain, loadNativeModelFromArchContext, nativeNodeSource, ProjectionPreconditionError, type NativeModel } from "@archcontext/core/projection-engine";
import { evaluateArchitectureDebt, type ArchitectureDebtEvidence } from "@archcontext/core/review-engine";
import { findRepositoryRoot, GitVisibleFilesUnavailableError, listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { ProjectionCodeFactsUnavailableError } from "@archcontext/local-runtime/codegraph-adapter";
import { readArchitectureDebtCodeFacts } from "./architecture-debt-code-facts";
import { runDocsAnchorsCommand } from "./docs-anchors";
import type { DocsAnchorsReportV1 } from "@archcontext/contracts";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface ArchitectureDebtReadInput { changedPaths?: string[] }

/**
 * Edit-time debt (#328's measured >3s falsifier): ownership and human citation checks only.
 * This function does not open a runtime session, sync CodeGraph, render or write any state.
 * Unmeasured dependency/flow/practice checks remain explicit gaps, never a clean full verdict.
 */
export function readArchitectureDebt(root: string, input: ArchitectureDebtReadInput = {}): ArchitectureDebtReportV1 {
  try {
    const { evidence } = readArchitectureDebtEvidence(root, input);
    return checkedDebt({ ...evidence,
      unavailable: { dependencies: ["deferred-to-complete"], flows: ["deferred-to-complete"], practices: ["deferred-to-complete"] }
    });
  } catch (error) { throw selectedProducerFailure(error, "debt"); }
}

/** Repository-wide completion measurement; practice evidence stays owned by the daemon. */
export function readCompleteTaskArchitectureDebt(root: string, practices?: PracticeEnforcementEvaluationV1): ArchitectureDebtReportV1 {
  try {
    if (!existsSync(join(root, ".archcontext/manifest.yaml"))) {
      return checkedDebt({ scope: { kind: "repository", changedPaths: [], capabilityIds: [] },
        unavailable: Object.fromEntries(ARCHITECTURE_DEBT_CHECKS.map(check => [check, ["model-not-adopted"]])) });
    }
    const { model, evidence } = readArchitectureDebtEvidence(root, {});
    const codeFacts = readArchitectureDebtCodeFacts(root, model);
    return checkedDebt({ ...evidence, ...codeFacts, practices,
      unavailable: { ...codeFacts.unavailable, ...(practices === undefined ? { practices: ["not-enabled"] } : {}) }
    });
  } catch (error) { throw selectedProducerFailure(error, "debt"); }
}

function checkedDebt(evidence: ArchitectureDebtEvidence): ArchitectureDebtReportV1 {
  const report = evaluateArchitectureDebt(evidence);
  if (architectureDebtReportIssues(report).length > 0) {
    throw new ArchitectureDebtReadError("AC_SCHEMA_INVALID", "Architecture debt evidence violates its contract", "debt-report-invalid");
  }
  return report;
}

function readArchitectureDebtEvidence(root: string, input: ArchitectureDebtReadInput): { model: NativeModel; evidence: ArchitectureDebtEvidence } {
  if (input.changedPaths !== undefined && (!Array.isArray(input.changedPaths) || input.changedPaths.some(path => typeof path !== "string"))) {
    throw new ArchitectureDebtReadError("AC_SCHEMA_INVALID", "changedPaths must be an array of paths", "changed-path-invalid");
  }
  const changedPaths = [...new Set(input.changedPaths ?? [])].sort();
  if (changedPaths.some(path => !isRepoRelativePosixPath(path))) throw new ArchitectureDebtReadError("AC_SCHEMA_INVALID", "changedPaths must contain repository-relative POSIX paths", "changed-path-invalid");
  if (!existsSync(join(root, ".archcontext/manifest.yaml"))) throw new ArchitectureDebtReadError("AC_MODEL_ADOPTION_REQUIRED", "Architecture debt requires an adopted architecture model", "model-missing");
  const model = loadNativeModelFromArchContext(root);
  const files = listGitVisibleFiles(root);
  const visible = new Set(files);
  // Model/policy edits can change any capability's obligations. Source and human-doc edits stay scoped.
  const repository = changedPaths.length === 0 || changedPaths.some(path => path.startsWith(".archcontext/"));
  const measuredPaths = repository ? files : changedPaths.filter(path => visible.has(path));
  const owners = resolveOwnership(model.nodes, measuredPaths);
  const capabilityByNodeId = nodeCapabilities(model);
  const touchedNodeIds = new Set<string>();
  for (const entry of owners.byPath.values()) for (const id of entry.owners) touchedNodeIds.add(id);
  for (const node of model.nodes) {
    const entrypoints = nativeNodeSource(node)?.entrypoints ?? [];
    if (entrypoints.some(entry => changedPaths.includes(entry.path)
      || entry.symbols.some(symbol => symbol.sinks.some(sink => changedPaths.includes(sink.path))))) touchedNodeIds.add(node.id);
  }
  const capabilityIds = [...new Set((repository ? model.nodes.map(node => node.id) : [...touchedNodeIds])
    .flatMap(id => capabilityByNodeId.has(id) ? [capabilityByNodeId.get(id)!] : []))].sort();
  const scopedNodeIds = model.nodes.filter(node => touchedNodeIds.has(node.id)
    || capabilityIds.includes(capabilityByNodeId.get(node.id) ?? "")).map(node => node.id);
  const unowned = new Set(owners.unownedPaths);
  const ownership: NonNullable<ArchitectureDebtEvidence["ownership"]> = [...owners.byPath].flatMap(([path, entry]) => {
    if (!entry.ambiguous && !unowned.has(path)) return [];
    return [{ path, nodeIds: entry.owners, capabilityIds: entry.owners.flatMap(id => capabilityByNodeId.has(id) ? [capabilityByNodeId.get(id)!] : []),
      status: entry.ambiguous ? "ambiguous" as const : "unowned" as const }];
  });
  // Ownership and citations use the same call-local model/file discovery. A new
  // invocation still reads both again, so edits and repairs are never cached.
  const anchors = runDocsAnchorsCommand(root, {}, { model, files });
  if (!anchors.ok) {
    const normalized = normalizeFailureResult(anchors, "debt", "docs.anchors") as JsonEnvelope;
    const failure = normalized.error!;
    throw new ArchitectureDebtReadError(failure.code, failure.message, failure.reasonCode!, failure.details, failure);
  }
  return { model, evidence: {
    scope: { kind: repository ? "repository" : "changed-paths", changedPaths, capabilityIds },
    ownership, anchors: anchors.data as unknown as DocsAnchorsReportV1, scopedNodeIds, capabilityByNodeId
  } };
}

export function runArchitectureDebtCommand(cwd: string, input: ArchitectureDebtReadInput = {}): JsonEnvelope {
  let root: string;
  try { root = findRepositoryRoot(cwd); }
  catch { return failureEnvelope("debt", knownFailure("AC_REPO_NOT_FOUND", "git-worktree-required", { checks: ["ownership", "anchors"] })); }
  try { return okEnvelope("debt", readArchitectureDebt(root, input) as unknown as Json); }
  catch (error) { return selectedProducerFailureEnvelope("debt", error, "debt"); }
}

function nodeCapabilities(model: NativeModel): Map<string, string> {
  const parents = new Map(model.nodes.map(node => [node.id, node.parent]));
  const capabilities = new Set(model.nodes.filter(node => node.kind === "capability").map(node => node.id));
  return new Map(model.nodes.flatMap(node => {
    const owner = [...ancestorChain(node.id, parents)].find(id => capabilities.has(id));
    return owner ? [[node.id, owner] as const] : [];
  }));
}

export class ArchitectureDebtReadError extends FailureError<ArchContextErrorCode> {
  constructor(code: ArchContextErrorCode, _message: string, reasonCode: string, details: unknown = { checks: ["ownership", "anchors"] }, attributes: Partial<StrictFailure> = {}) {
    super(code, reasonCode, details, attributes);
    this.name = "ArchitectureDebtReadError";
  }
}

/** Selected producer metadata must remain own data fields, even on a recognized error class. */
function selectedProducerData<T extends object, K extends keyof T>(error: T, key: K): T[K] {
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  if (!descriptor || !("value" in descriptor)) throw new Error("Invalid selected producer metadata");
  return descriptor.value as T[K];
}

/** Class identity or registered producer metadata classifies a failure; message/stack never do. */
export function selectedProducerFailure(error: unknown, stage: FailureStage): FailureError<ArchContextErrorCode> {
  try {
    if (error instanceof FailureError) {
      const failure = toEnvelope("failure", error, stage).error;
      if (failure.code !== "RPC_TIMEOUT" && failure.code !== "RPC_ABORTED") {
        return new FailureError(failure.code, failure.reasonCode, failure.details, failure);
      }
    }
    if (error instanceof GitVisibleFilesUnavailableError) return new FailureError(selectedProducerData(error, "code"), selectedProducerData(error, "reasonCode"), { checks: ["ownership", "anchors"] });
    if (error instanceof ProjectionPreconditionError) return new FailureError("AC_PRECONDITION_FAILED", selectedProducerData(error, "reasonCode"));
    if (error instanceof ProjectionCodeFactsUnavailableError) return new FailureError(selectedProducerData(error, "code"), selectedProducerData(error, "reasonCode"));
  } catch { return new FailureError("AC_UNCLASSIFIED_FAILURE", "failure-unclassified", { stage: "failure-metadata" }); }
  return new FailureError("AC_UNCLASSIFIED_FAILURE", "failure-unclassified", { stage });
}
export function selectedProducerFailureEnvelope(requestId: string, error: unknown, stage: FailureStage): JsonEnvelope {
  const failure = selectedProducerFailure(error, stage);
  return failureEnvelope(requestId, failure.failure);
}
