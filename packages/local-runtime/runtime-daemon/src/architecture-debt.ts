import {
  architectureDebtReportIssues, errorEnvelope, isRepoRelativePosixPath, okEnvelope,
  type ArchitectureDebtReportV1, type Json, type JsonEnvelope
} from "@archcontext/contracts";
import { resolveOwnership } from "@archcontext/core/module-statistics";
import { ancestorChain, loadNativeModelFromArchContext, nativeNodeSource, type NativeModel } from "@archcontext/core/projection-engine";
import { evaluateArchitectureDebt, type ArchitectureDebtEvidence } from "@archcontext/core/review-engine";
import { findRepositoryRoot, GitVisibleFilesUnavailableError, listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
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
  const anchors = runDocsAnchorsCommand(root);
  if (!anchors.ok) throw new ArchitectureDebtReadError(anchors.error!.code, anchors.error!.message, anchors.error!.reasonCode ?? "anchors-unavailable");
  const report = evaluateArchitectureDebt({
    scope: { kind: repository ? "repository" : "changed-paths", changedPaths, capabilityIds },
    ownership, anchors: anchors.data as unknown as DocsAnchorsReportV1, scopedNodeIds, capabilityByNodeId,
    unavailable: { dependencies: ["deferred-to-complete"], flows: ["deferred-to-complete"], practices: ["deferred-to-complete"] }
  });
  const issues = architectureDebtReportIssues(report);
  if (issues.length > 0) throw new ArchitectureDebtReadError("AC_SCHEMA_INVALID", "Architecture debt evidence violates its contract", "debt-report-invalid");
  return report;
}

export function runArchitectureDebtCommand(cwd: string, input: ArchitectureDebtReadInput = {}): JsonEnvelope {
  let root: string;
  try { root = findRepositoryRoot(cwd); }
  catch { return errorEnvelope("debt", "AC_REPO_NOT_FOUND", "Architecture debt requires a Git worktree", "git-worktree-required", { checks: ["ownership", "anchors"] }); }
  try {
    return okEnvelope("debt", readArchitectureDebt(root, input) as unknown as Json);
  } catch (error) {
    if (error instanceof ArchitectureDebtReadError || error instanceof GitVisibleFilesUnavailableError) {
      return errorEnvelope("debt", error.code, error.message.slice(0, 1024), error.reasonCode ?? "git-files-unavailable", { checks: ["ownership", "anchors"] });
    }
    return errorEnvelope("debt", "AC_PRECONDITION_FAILED", (error instanceof Error ? error.message : String(error)).slice(0, 1024), "debt-input-unavailable", { checks: ["ownership", "anchors"] });
  }
}

function nodeCapabilities(model: NativeModel): Map<string, string> {
  const parents = new Map(model.nodes.map(node => [node.id, node.parent]));
  const capabilities = new Set(model.nodes.filter(node => node.kind === "capability").map(node => node.id));
  return new Map(model.nodes.flatMap(node => {
    const owner = [...ancestorChain(node.id, parents)].find(id => capabilities.has(id));
    return owner ? [[node.id, owner] as const] : [];
  }));
}

class ArchitectureDebtReadError extends Error {
  constructor(readonly code: import("@archcontext/contracts").ArchContextErrorCode, message: string, readonly reasonCode: string) { super(message); }
}
