import type { ProjectionArchitectureDebtCoverageReasonCode, ProjectionArchitectureDebtV1 } from "@archcontext/contracts";
import { measureCapabilityDependencies } from "@archcontext/core/module-statistics";
import type { NativeModel } from "@archcontext/core/projection-engine";
import { CODEGRAPH_IMPORT_NODE_READ_LIMIT, type ProjectionImportPopulationV1 } from "@archcontext/local-runtime/codegraph-adapter";
import { declaredWorkspacePackages } from "./refactor-scan";

/** What one projection run already read; the debt is computed from it with no CodeGraph call. */
export interface ProjectionImportEvidence {
  root: string;
  /** The Git-visible files the run measured footprints over. */
  sourceFiles: readonly string[];
  /** The run's import read. Absent when it did not run, which a ready index means: no node declares a footprint. */
  population: ProjectionImportPopulationV1 | undefined;
  /** The run's CodeGraph handshake verdict. */
  codeGraphStatus: "ready" | "unavailable";
  worktreeDigest: string;
}

/** No import read ran: with no declared footprint, no file has an owner, so no edge is attributable. */
const NO_IMPORT_READ: ProjectionImportPopulationV1 = {
  pairs: [],
  truncated: false,
  importNodeCount: null,
  importNodeLimit: CODEGRAPH_IMPORT_NODE_READ_LIMIT,
  importNodeLimitExceeded: false
};

/**
 * The architecture debt of a `check` or `plan` run: every cross-capability import pair that no
 * model relation declares, measured exactly like `archctx deps` (`measureCapabilityDependencies`)
 * over the files and the import read of this run. Pure apart from reading workspace manifests.
 *
 * A ready handshake is the producer's attestation that the index matches the measured tree (the
 * adapter refuses an index with pending changes and a tree that moved during the read), so it
 * licenses the same coverage `repositoryImportPairs` gives a clean index.
 */
export function projectionArchitectureDebt(model: NativeModel, evidence: ProjectionImportEvidence): ProjectionArchitectureDebtV1 {
  const workspaces = readWorkspaces(evidence.root);
  const population = evidence.population ?? NO_IMPORT_READ;
  const measured = measureCapabilityDependencies({
    nodes: model.nodes,
    relations: model.relations,
    worktreeDigest: evidence.worktreeDigest,
    files: [...evidence.sourceFiles],
    importEdges: population.pairs,
    workspacePackages: workspaces.packages,
    truncated: population.truncated,
    importNodeCount: population.importNodeCount,
    importNodeLimit: population.importNodeLimit,
    importNodeLimitExceeded: population.importNodeLimitExceeded,
    codeFacts: {
      availability: evidence.codeGraphStatus,
      indexedWorktreeDigest: evidence.codeGraphStatus === "ready" ? evidence.worktreeDigest : null
    },
    edgeLimit: 0
  });
  // The run's own attestation rules out `code-facts-stale`; the result invariant rejects any other code.
  const coverageReasonCodes = [...measured.imports.reasonCodes, ...(workspaces.resolved ? [] : ["workspace-resolution-failed"])]
    .sort() as ProjectionArchitectureDebtCoverageReasonCode[];
  const coverage = measured.imports.coverage === "complete" && !workspaces.resolved ? "partial" : measured.imports.coverage;
  return {
    coverage,
    coverageReasonCodes,
    items: measured.matrix
      .filter((cell) => cell.from !== cell.to && !cell.declared)
      .map((cell) => ({ reasonCode: "undeclared-dependency" as const, fromCapabilityId: cell.from, toCapabilityId: cell.to, importEdgeCount: cell.imports }))
  };
}

/**
 * The workspace map `archctx deps` reads. A workspace glob that reader does not support is a
 * coverage gap of a non-blocking report, not a failed run: no bare workspace specifier resolves,
 * and the debt says so. Every other error (an unreadable or malformed manifest) propagates.
 */
function readWorkspaces(root: string): { packages: ReturnType<typeof declaredWorkspacePackages>; resolved: boolean } {
  try {
    return { packages: declaredWorkspacePackages(root), resolved: true };
  } catch (error) {
    // `readWorkspacePackages` reports this input error by its reason-code prefix; it has no error class.
    if (error instanceof Error && error.message.startsWith("workspace-glob-unsupported:")) return { packages: [], resolved: false };
    throw error;
  }
}
