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

/** Whether the code index answered at all. Mirrors the index handshake's own two states. */
export type ModuleStatisticsIndexAvailability = "ready" | "unavailable";

export interface ModuleStatisticsTrackedFileV1 {
  /** Repo-relative POSIX path of a Git-tracked file. */
  path: string;
  lineCount: number;
}

export interface ModuleStatisticsImportEdgeV1 {
  from: string;
  /** The import specifier verbatim; two specifiers from one file are two observations. */
  specifier: string;
  /** Repo-relative target, or `null` when the producer could not resolve the specifier. */
  to: string | null;
}

export interface ModuleStatisticsWorkspacePackageV1 {
  name: string;
  /** Repo-relative package directory. */
  root: string;
  /** The manifest `exports` map: subpath (`"."`, `"./sub"`) -> package-relative target. */
  exports: Record<string, string>;
}

export interface ModuleStatisticsCodeFactsInputV1 {
  version: string;
  binaryDigest: string;
  /**
   * Both fields must come from `repositoryImportPairs(...)`, never from a caller's own belief: the
   * producer owns the freshness verdict because only it observed the index. `indexedWorktreeDigest`
   * equal to the measured `worktree.worktreeDigest` is what licenses a non-`unknown` coverage.
   */
  availability: ModuleStatisticsIndexAvailability;
  indexedWorktreeDigest: string | null;
}

/**
 * Everything `buildModuleStatisticsSnapshot` measures, already materialized.
 *
 * The builder is pure and synchronous by construction: `@archcontext/core` forbids I/O, clocks and
 * child processes, so Git and the code index are read by the local-runtime producers
 * (`readTrackedSourceFiles`, `readWorkspacePackages`, `repositoryImportPairs`) and handed over as
 * data. That also makes the snapshot exactly reproducible from a recorded input, which is what the
 * resolution ledger needs.
 */
export interface ModuleStatisticsInputV1 {
  model: NativeModel;
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  trackedFiles: ModuleStatisticsTrackedFileV1[];
  importEdges: ModuleStatisticsImportEdgeV1[];
  /** Workspace manifests, so bare `@scope/pkg/sub` specifiers resolve to real repository files. */
  workspacePackages: ModuleStatisticsWorkspacePackageV1[];
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

  const measurable = input.codeFacts.availability === "ready"
    && input.codeFacts.indexedWorktreeDigest !== null
    && input.codeFacts.indexedWorktreeDigest === input.worktree.worktreeDigest;
  const coverage: EvidenceCoverageLevelV2 = !measurable ? "unknown" : input.truncated ? "partial" : "complete";
  // An index that did not attest to this tree is not weaker evidence, it is no evidence: the edges
  // it produced describe some other tree, so they are dropped rather than reported as observations.
  const edges = measurable ? resolveEdges(input.importEdges, input.workspacePackages, trackedFiles) : [];

  const ownersByPath = new Map([...ownership.byPath].map(([path, resolution]) => [path, resolution.owners]));
  const graph = buildModuleGraph(
    nodes.map((node) => node.id),
    edges.flatMap((edge) => (edge.to === null ? [] : [{ from: edge.from, to: edge.to }])),
    ownersByPath
  );

  const modules = nodes.map((node) => buildModule({
    node,
    ownership,
    linesByPath,
    counts: graph.countsByNode.get(node.id)!,
    unresolvedImports: countUnresolvedImports(edges, ownership, node.id),
    graphMeasured: coverage !== "unknown"
  }));

  const codeFacts = {
    provider: "codegraph" as const,
    version: input.codeFacts.version,
    binaryDigest: input.codeFacts.binaryDigest,
    // Emitted only when the index attested to the tree that was measured; the frozen validator
    // additionally requires it to be present whenever coverage is not `unknown`.
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
    modelDigest: modelDigest(input.model),
    codeFacts,
    modules,
    repositorySummary: {
      moduleCount: modules.length,
      undeclaredFootprintNodeCount: modules.filter((module) => !module.footprintDeclared).length,
      ownedFileCount: ownership.ownedFileCount,
      unownedFileCount: ownership.unownedFileCount,
      multiplyOwnedFileCount: ownership.multiplyOwnedFileCount,
      crossModuleEdgeCount: graph.crossModuleEdgeCount,
      crossModuleCycleCount: graph.crossModuleCycleCount,
      stronglyConnectedComponentCount: graph.stronglyConnectedComponentCount,
      unresolvedImportCount: edges.filter((edge) => edge.to === null).length,
      // Every module carries dynamic-invocation risk in v1: import edges cannot observe reflective
      // or registry-mediated calls, so no module can be reported as free of it.
      dynamicInvocationRiskCount: modules.length
    },
    createdAt: input.createdAt,
    snapshotDigest: ""
  };
  return { ...draft, snapshotDigest: moduleStatisticsSnapshotDigest(draft) };
}

/** The whole model, sorted: a relation or flow change is a model change and must move the digest. */
function modelDigest(model: NativeModel): string {
  return digestJson({
    nodes: [...model.nodes].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    relations: [...model.relations].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    flows: [...(model.flows ?? [])].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  } as unknown as Json);
}

/**
 * Completes the producer's resolution: a bare workspace specifier is mapped through the owning
 * package's `exports` map, which is how this repository actually crosses module boundaries. The
 * adapter cannot do this (it has no manifest map) and dropping it would report `complete` coverage
 * over an edge set missing every cross-package import.
 */
function resolveEdges(
  importEdges: ModuleStatisticsImportEdgeV1[],
  workspacePackages: ModuleStatisticsWorkspacePackageV1[],
  trackedFiles: ModuleStatisticsTrackedFileV1[]
): ModuleStatisticsImportEdgeV1[] {
  const tracked = new Set(trackedFiles.map((file) => file.path));
  return importEdges
    .map((edge) => (edge.to !== null ? edge : { ...edge, to: resolveWorkspaceSpecifier(edge.specifier, workspacePackages, tracked) }))
    .sort((left, right) => (left.from < right.from ? -1 : left.from > right.from ? 1 : 0)
      || (left.specifier < right.specifier ? -1 : left.specifier > right.specifier ? 1 : 0));
}

/** `@scope/pkg/sub` -> that package's `exports["./sub"]`, as a repo-relative tracked path. */
function resolveWorkspaceSpecifier(
  specifier: string,
  workspacePackages: ModuleStatisticsWorkspacePackageV1[],
  tracked: Set<string>
): string | null {
  for (const workspacePackage of workspacePackages) {
    if (specifier !== workspacePackage.name && !specifier.startsWith(`${workspacePackage.name}/`)) continue;
    const subpath = specifier === workspacePackage.name ? "." : `.${specifier.slice(workspacePackage.name.length)}`;
    const target = workspacePackage.exports[subpath];
    if (target === undefined) return null;
    const path = `${workspacePackage.root}/${target.replace(/^\.\//, "")}`;
    // An export pointing at a file the commit does not carry is not evidence of an edge.
    return tracked.has(path) ? path : null;
  }
  return null;
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
