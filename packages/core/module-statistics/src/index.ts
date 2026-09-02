import {
  MODULE_STATISTICS_SCHEMA_VERSION,
  digestJson,
  moduleStatisticsDigest,
  moduleStatisticsSnapshotDigest,
  type ArchitectureRepositoryIdentityV1,
  type ArchitectureWorktreeIdentityV1,
  type EvidenceCoverageLevelV2,
  type Json,
  type ModuleStatisticsSnapshotV1,
  type ModuleStatisticsV1,
  type RefactorScaleReasonCode
} from "@archcontext/contracts";
import { nativeNodeSource, type NativeModel, type NativeNode } from "../../projection-engine/src/index";
import { buildModuleGraph, type ModuleGraphEdgeCounts } from "./graph";
import { resolveOwnership, type OwnershipIndex } from "./ownership";

export { resolveOwnership, type OwnershipIndex, type OwnershipResolution } from "./ownership";
export { buildModuleGraph, type ModuleGraph, type ModuleGraphEdgeCounts } from "./graph";

/** Whether the code index answered at all. Mirrors the codegraph handshake's own two states. */
export type ModuleStatisticsIndexAvailability = "ready" | "unavailable";

export interface ModuleStatisticsTrackedFileV1 {
  /** Repo-relative POSIX path of a Git-tracked file. */
  path: string;
  lineCount: number;
}

export interface ModuleStatisticsImportEdgeV1 {
  from: string;
  /** `null` when the specifier did not resolve to a repository file. */
  to: string | null;
}

export interface ModuleStatisticsCodeFactsInputV1 {
  version: string;
  binaryDigest: string;
  availability: ModuleStatisticsIndexAvailability;
  /**
   * The worktree digest the index was built against. The builder emits
   * `codeFacts.indexedWorktreeDigest` only when this equals the measured `worktree.worktreeDigest`;
   * anything else means the index describes a different tree and coverage drops to `unknown`.
   */
  indexFreshForWorktreeDigest: string | null;
}

/**
 * Everything `buildModuleStatisticsSnapshot` measures, already materialized.
 *
 * The builder is pure and synchronous by construction: `@archcontext/core` forbids I/O, clocks and
 * child processes, so Git and CodeGraph are read by the local-runtime producers
 * (`readTrackedSourceFiles`, `repositoryImportPairs`) and handed over as data. That also makes the
 * snapshot exactly reproducible from a recorded input, which is what the resolution ledger needs.
 */
export interface ModuleStatisticsInputV1 {
  model: NativeModel;
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  trackedFiles: ModuleStatisticsTrackedFileV1[];
  importEdges: ModuleStatisticsImportEdgeV1[];
  /** True when the index dump saturated its limit, so the edge set is a prefix, not the population. */
  truncated: boolean;
  edgeLimit: number | null;
  codeFacts: ModuleStatisticsCodeFactsInputV1;
  /** Caller-supplied; excluded from every digest, so it never perturbs snapshot identity. */
  createdAt: string;
}

/**
 * Measures one `ModuleStatisticsSnapshotV1` from a materialized input.
 *
 * Two calls on the same input produce byte-identical JSON: every collection is sorted with the
 * default comparator, no ambient state is read, and the digests come from the frozen contract
 * helpers rather than being re-derived here.
 */
export function buildModuleStatisticsSnapshot(input: ModuleStatisticsInputV1): ModuleStatisticsSnapshotV1 {
  const nodes = [...input.model.nodes].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const trackedFiles = [...input.trackedFiles].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const linesByPath = new Map(trackedFiles.map((file) => [file.path, file.lineCount]));
  const ownership = resolveOwnership(nodes, trackedFiles.map((file) => file.path));

  const indexFresh = input.codeFacts.indexFreshForWorktreeDigest !== null
    && input.codeFacts.indexFreshForWorktreeDigest === input.worktree.worktreeDigest;
  const measurable = input.codeFacts.availability === "ready" && indexFresh;
  const coverage: EvidenceCoverageLevelV2 = !measurable ? "unknown" : input.truncated ? "partial" : "complete";

  const ownersByPath = new Map([...ownership.byPath].map(([path, resolution]) => [path, resolution.owners]));
  const resolvedEdges = input.importEdges.filter((edge): edge is { from: string; to: string } => edge.to !== null);
  const graph = buildModuleGraph(nodes.map((node) => node.id), resolvedEdges, ownersByPath);

  const modules = nodes.map((node) => buildModule({
    node,
    ownership,
    linesByPath,
    counts: graph.countsByNode.get(node.id)!,
    unresolvedImports: countUnresolvedImports(input.importEdges, ownership, node.id),
    graphMeasured: coverage !== "unknown"
  }));

  const codeFacts = {
    provider: "codegraph" as const,
    version: input.codeFacts.version,
    binaryDigest: input.codeFacts.binaryDigest,
    // Emitted only when the index was built against the tree that was measured; the frozen
    // validator additionally requires it to be present whenever coverage is not `unknown`.
    indexedWorktreeDigest: coverage === "unknown" ? null : input.worktree.worktreeDigest,
    coverage,
    // An unknown coverage is a truncated answer by definition: nothing was observed.
    truncated: coverage === "unknown" ? true : input.truncated,
    edgeLimit: input.edgeLimit,
    reasonCodes: reasonCodes({ coverage, truncated: input.truncated, measurable, modules, ownership })
  };

  const draft: ModuleStatisticsSnapshotV1 = {
    schemaVersion: MODULE_STATISTICS_SCHEMA_VERSION,
    repository: input.repository,
    worktree: input.worktree,
    modelDigest: digestJson(nodes as unknown as Json),
    codeFacts,
    modules,
    repositorySummary: {
      moduleCount: modules.length,
      undeclaredFootprintNodeCount: modules.filter((module) => !module.footprintDeclared).length,
      ownedFileCount: ownership.ownedFileCount,
      unownedFileCount: ownership.unownedFileCount,
      multiplyOwnedFileCount: ownership.multiplyOwnedFileCount,
      crossModuleEdgeCount: coverage === "unknown" ? 0 : graph.crossModuleEdgeCount,
      crossModuleCycleCount: coverage === "unknown" ? 0 : graph.crossModuleCycleCount,
      stronglyConnectedComponentCount: coverage === "unknown" ? 0 : graph.stronglyConnectedComponentCount,
      unresolvedImportCount: input.importEdges.filter((edge) => edge.to === null).length,
      // Every module carries dynamic-invocation risk in v1: import edges cannot observe reflective
      // or registry-mediated calls, so no module can be reported as free of it.
      dynamicInvocationRiskCount: modules.length
    },
    createdAt: input.createdAt,
    snapshotDigest: ""
  };
  return { ...draft, snapshotDigest: moduleStatisticsSnapshotDigest(draft) };
}

function buildModule(context: {
  node: NativeNode;
  ownership: OwnershipIndex;
  linesByPath: Map<string, number>;
  counts: ModuleGraphEdgeCounts;
  unresolvedImports: number;
  graphMeasured: boolean;
}): ModuleStatisticsV1 {
  const { node, ownership, linesByPath, counts, graphMeasured } = context;
  const source = nativeNodeSource(node);
  const include = source?.include ?? [];
  const footprintDeclared = include.length > 0;
  const files = (ownership.filesByNode.get(node.id) ?? []).map((path) => ({ path, lineCount: linesByPath.get(path) ?? 0 }));
  const ambiguousOwnership = files.some((file) => ownership.byPath.get(file.path)?.ambiguous === true);

  const draft: ModuleStatisticsV1 = {
    nodeId: node.id,
    nodeDigest: digestJson(node as unknown as Json),
    parentNodeId: node.parent ?? null,
    footprintDeclared,
    footprint: footprintDeclared
      ? {
        fileCount: files.length,
        lineCount: files.reduce((total, file) => total + file.lineCount, 0),
        sourceFilesDigest: digestJson(files as unknown as Json),
        includePatterns: include,
        excludePatterns: source?.exclude ?? []
      }
      : null,
    surfaces: {
      declaredEntrypoints: (source?.entrypoints ?? []).map((entrypoint) => entrypoint.id).sort(),
      // Observed surfaces need runtime or call-graph evidence the import graph does not carry.
      observedEntrypoints: [],
      lifecycleOwners: [],
      datastoreSubjects: []
    },
    // A node that declared no footprint owns no files, so its graph was never measured; reporting
    // a zero-filled graph would claim an observation that did not happen.
    dependencyGraph: graphMeasured && footprintDeclared
      ? { ...counts, instability: null, directionViolationCount: null }
      : null,
    // v1 observes no test evidence at all: the node schema has no `source.tests`, so there is no
    // declared test footprint to measure, and `callerCoverage` stays null because import edges
    // cannot see dynamic invocation (see the package notes on decision (e)).
    tests: { testFileCount: null, observedTestEdges: null, callerCoverage: null, coverageStatus: "unknown" },
    uncertainty: {
      unresolvedImports: context.unresolvedImports,
      dynamicInvocation: "unknown",
      ambiguousOwnership
    },
    moduleDigest: ""
  };
  return { ...draft, moduleDigest: moduleStatisticsDigest(draft) };
}

/** Unresolved specifiers whose source file this node owns. A contested file counts for each claimant. */
function countUnresolvedImports(
  importEdges: ModuleStatisticsImportEdgeV1[],
  ownership: OwnershipIndex,
  nodeId: string
): number {
  return importEdges.filter((edge) => edge.to === null && (ownership.byPath.get(edge.from)?.owners ?? []).includes(nodeId)).length;
}

function reasonCodes(context: {
  coverage: EvidenceCoverageLevelV2;
  truncated: boolean;
  measurable: boolean;
  modules: ModuleStatisticsV1[];
  ownership: OwnershipIndex;
}): RefactorScaleReasonCode[] {
  const codes = new Set<RefactorScaleReasonCode>(["caller-coverage-unknown"]);
  if (!context.measurable) codes.add("code-facts-missing");
  if (context.truncated || context.coverage === "unknown") codes.add("code-facts-truncated");
  if (context.modules.some((module) => !module.footprintDeclared)) codes.add("node-footprint-undeclared");
  if (context.ownership.multiplyOwnedFileCount > 0) codes.add("ownership-ambiguous");
  if (context.ownership.unownedFileCount > 0) codes.add("unowned-paths");
  return [...codes].sort();
}
