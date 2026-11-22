import type {
  CoChangeDependencySummaryV1,
  GitCoChangeWindowV1,
  RefactorEvidenceCoChangePairV1,
  RefactorEvidenceImportEdgeV1,
  RefactorEvidenceLowCohesionClusterV1,
  RefactorEvidenceLowCohesionFileV1,
  RefactorEvidenceUnstableTargetV1
} from "@archcontext/contracts";
import { matchesGlob, nativeNodeSource, type NativeNode } from "@archcontext/core/architecture-domain";
import type { ModuleDependencyEdge, ModuleGraph } from "./graph";
import type { OwnershipIndex } from "./ownership";

export interface CoreCallEdgeFactV1 {
  fromPath: string;
  toPath: string;
  fromSymbol: string;
  toSymbol: string;
  kind: "calls" | "references";
}

export interface CoreFileTopLevelSymbolFactV1 {
  name: string;
  qualifiedName: string;
  kind: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
}

export interface CoreFileSymbolStructureFactV1 {
  path: string;
  lineCount: number;
  topLevelSymbols: CoreFileTopLevelSymbolFactV1[];
  intraFileEdges: { from: string; to: string }[];
}

export interface GitCoChangeCommitInputV1 {
  commitSha: string;
  paths: string[];
}

export interface GitCoChangeHistoryInputV1 {
  anchorHeadSha?: string;
  coverageStatus: "complete" | "shallow" | "insufficient-history" | "unavailable";
  windowLimit: number;
  minHistoryCommits: number;
  maxFilesPerCommit: number;
  observedCommitCount: number;
  skippedBulkCommitCount: number;
  commits: GitCoChangeCommitInputV1[];
}

export interface LowCohesionModuleFindingV1 {
  nodeId: string;
  measuredFileCount: number;
  files: RefactorEvidenceLowCohesionFileV1[];
}

export interface EntrypointBypassModuleFindingV1 {
  nodeId: string;
  declaredEntrypointPaths: string[];
  edges: RefactorEvidenceImportEdgeV1[];
}

export interface UnstableDependencyModuleFindingV1 {
  nodeId: string;
  sourceFanIn: number;
  sourceInstability: number;
  targets: RefactorEvidenceUnstableTargetV1[];
}

export interface CoChangeCouplingFindingV1 {
  memberNodeIds: [string, string];
  coverageStatus: "complete" | "shallow" | "insufficient-history" | "unavailable";
  windowLimit: number;
  observedCommitCount: number;
  pairs: RefactorEvidenceCoChangePairV1[];
}

export interface LowCohesionThresholds {
  minLines?: number;
  minTopLevelSymbols?: number;
  minDisconnectedClusters?: number;
  minSymbolsPerCluster?: number;
}

export interface CoChangeThresholds {
  minCoChangeCount?: number;
  minJaccard?: number;
}

const DEFAULT_LOW_COHESION_THRESHOLDS: Required<LowCohesionThresholds> = {
  minLines: 400,
  minTopLevelSymbols: 8,
  minDisconnectedClusters: 2,
  minSymbolsPerCluster: 2
};

const DEFAULT_UNSTABLE_DEPENDENCY = {
  minSourceFanIn: 3,
  maxSourceInstability: 0.35,
  minTargetInstability: 0.70,
  minDelta: 0.35
} as const;

const DEFAULT_CO_CHANGE_THRESHOLDS: Required<CoChangeThresholds> = {
  minCoChangeCount: 4,
  minJaccard: 0.45
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Standard Martin instability metric: `fanOut / (fanIn + fanOut)`, or `null` for isolated modules. */
export function computeInstability(fanIn: number, fanOut: number): number | null {
  const total = fanIn + fanOut;
  if (total <= 0) return null;
  return Number((fanOut / total).toFixed(6));
}

export function isTestPath(path: string): boolean {
  return /(^|\/)(test|tests|__tests__|spec|specs)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(path);
}

/** Computes test file count, incoming test->prod edge count, and covered non-test file ratio for one module. */
export function measureModuleTestCoverage(
  ownedPaths: readonly string[],
  resolvedImportEdges: readonly { from: string; to: string | null }[],
  callEdges?: readonly { fromPath: string; toPath: string }[]
): {
  testFileCount: number;
  observedTestEdges: number;
  callerCoverage: number | null;
  coverageStatus: "measured" | "partial" | "unknown";
} {
  const testFileCount = ownedPaths.filter(isTestPath).length;
  const prodPaths = ownedPaths.filter((path) => !isTestPath(path));
  if (prodPaths.length === 0) {
    return {
      testFileCount,
      observedTestEdges: 0,
      callerCoverage: null,
      coverageStatus: "unknown"
    };
  }
  const prodSet = new Set(prodPaths);
  const coveredTargets = new Set<string>();
  let observedTestEdges = 0;

  for (const edge of resolvedImportEdges) {
    if (edge.to !== null && isTestPath(edge.from) && prodSet.has(edge.to)) {
      observedTestEdges += 1;
      coveredTargets.add(edge.to);
    }
  }
  if (callEdges) {
    for (const edge of callEdges) {
      if (isTestPath(edge.fromPath) && prodSet.has(edge.toPath)) {
        observedTestEdges += 1;
        coveredTargets.add(edge.toPath);
      }
    }
  }
  return {
    testFileCount,
    observedTestEdges,
    callerCoverage: Number((coveredTargets.size / prodPaths.length).toFixed(6)),
    coverageStatus: "measured"
  };
}

/**
 * Deterministic AST/symbol connected-component detector for oversized files with >= 2 disconnected
 * multi-symbol functional clusters (#637, zero regex heuristics).
 */
export function detectLowCohesionGodFiles(
  fileStructures: readonly CoreFileSymbolStructureFactV1[],
  ownership: OwnershipIndex,
  thresholds: LowCohesionThresholds = {}
): Map<string, LowCohesionModuleFindingV1> {
  const limits = { ...DEFAULT_LOW_COHESION_THRESHOLDS, ...thresholds };
  const structureByPath = new Map<string, CoreFileSymbolStructureFactV1>();
  for (const structure of fileStructures) {
    structureByPath.set(structure.path, structure);
  }

  const findings = new Map<string, LowCohesionModuleFindingV1>();
  const nodeIds = [...ownership.filesByNode.keys()].sort(compareText);
  for (const nodeId of nodeIds) {
    const ownedPaths = (ownership.filesByNode.get(nodeId) ?? []).filter((path) => !isTestPath(path));
    let measuredFileCount = 0;
    const flagged: RefactorEvidenceLowCohesionFileV1[] = [];

    for (const path of ownedPaths) {
      const structure = structureByPath.get(path);
      if (!structure) continue;
      measuredFileCount += 1;
      if (structure.lineCount < limits.minLines || structure.topLevelSymbols.length < limits.minTopLevelSymbols) {
        continue;
      }

      const symbolMeta = new Map(structure.topLevelSymbols.map((sym) => [sym.qualifiedName, sym]));
      const adjacency = new Map<string, Set<string>>();
      for (const sym of structure.topLevelSymbols) {
        adjacency.set(sym.qualifiedName, new Set());
      }
      for (const edge of structure.intraFileEdges) {
        if (!adjacency.has(edge.from) || !adjacency.has(edge.to) || edge.from === edge.to) continue;
        adjacency.get(edge.from)!.add(edge.to);
        adjacency.get(edge.to)!.add(edge.from);
      }

      const visited = new Set<string>();
      const clusters: RefactorEvidenceLowCohesionClusterV1[] = [];
      for (const sym of structure.topLevelSymbols) {
        if (visited.has(sym.qualifiedName)) continue;
        const queue = [sym.qualifiedName];
        const component: string[] = [];
        visited.add(sym.qualifiedName);
        while (queue.length > 0) {
          const current = queue.shift()!;
          component.push(current);
          for (const next of adjacency.get(current) ?? []) {
            if (!visited.has(next)) {
              visited.add(next);
              queue.push(next);
            }
          }
        }
        if (component.length < limits.minSymbolsPerCluster) continue;
        let intraPairs = 0;
        let startLine = Number.MAX_SAFE_INTEGER;
        let endLine = 1;
        const memberSet = new Set(component);
        for (const member of component) {
          const meta = symbolMeta.get(member)!;
          startLine = Math.min(startLine, meta.startLine);
          endLine = Math.max(endLine, meta.endLine);
          for (const neighbor of adjacency.get(member) ?? []) {
            if (memberSet.has(neighbor) && compareText(member, neighbor) < 0) {
              intraPairs += 1;
            }
          }
        }
        clusters.push({
          symbols: [...component].sort(compareText),
          startLine: Math.max(1, startLine),
          endLine: Math.max(Math.max(1, startLine), endLine),
          intraClusterEdges: intraPairs,
          crossClusterEdges: 0
        });
      }

      if (clusters.length < limits.minDisconnectedClusters) continue;
      clusters.sort((left, right) =>
        (left.startLine - right.startLine) || compareText(left.symbols[0]!, right.symbols[0]!)
      );
      flagged.push({
        path,
        lineCount: structure.lineCount,
        topLevelSymbolCount: structure.topLevelSymbols.length,
        clusterCount: clusters.length,
        clusters
      });
    }

    findings.set(nodeId, {
      nodeId,
      measuredFileCount,
      files: flagged.sort((left, right) => compareText(left.path, right.path))
    });
  }
  return findings;
}

/**
 * Flags external non-test imports reaching internal non-entrypoint files owned by a module that
 * explicitly declared `source.entrypoints` (#637).
 */
export function detectEntrypointBypasses(
  nodes: readonly NativeNode[],
  ownership: OwnershipIndex,
  resolvedImportEdges: readonly { from: string; to: string | null; line?: number; specifier: string }[]
): Map<string, EntrypointBypassModuleFindingV1> {
  const entrypointPatternsByNode = new Map<string, string[]>();
  const resolvedEntrypointPathsByNode = new Map<string, string[]>();

  for (const node of nodes) {
    const entrypoints = nativeNodeSource(node)?.entrypoints ?? [];
    if (entrypoints.length === 0) continue;
    const patterns = [...new Set(entrypoints.map((entry) => entry.path))].sort(compareText);
    entrypointPatternsByNode.set(node.id, patterns);
    const owned = ownership.filesByNode.get(node.id) ?? [];
    const matched = owned
      .filter((path) => patterns.some((pattern) => path === pattern || matchesGlob(path, pattern)))
      .sort(compareText);
    resolvedEntrypointPathsByNode.set(node.id, matched.length > 0 ? matched : patterns);
  }

  const bypasses = new Map<string, EntrypointBypassModuleFindingV1>();
  for (const [nodeId, declaredPaths] of resolvedEntrypointPathsByNode) {
    const patterns = entrypointPatternsByNode.get(nodeId)!;
    const edges: RefactorEvidenceImportEdgeV1[] = [];
    const seen = new Set<string>();

    for (const edge of resolvedImportEdges) {
      if (edge.to === null || isTestPath(edge.from) || isTestPath(edge.to)) continue;
      const toOwners = ownership.byPath.get(edge.to)?.owners ?? [];
      if (!toOwners.includes(nodeId)) continue;
      const fromOwners = ownership.byPath.get(edge.from)?.owners ?? [];
      if (fromOwners.includes(nodeId)) continue;
      const hitsEntrypoint = patterns.some((pattern) => edge.to === pattern || matchesGlob(edge.to!, pattern));
      if (hitsEntrypoint) continue;

      const fromNodeId = fromOwners[0] ?? "unowned";
      const key = JSON.stringify([edge.from, edge.line ?? null, edge.to, edge.specifier, fromNodeId]);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        fromPath: edge.from,
        fromLine: edge.line ?? null,
        toPath: edge.to,
        specifier: edge.specifier,
        fromNodeId,
        toNodeId: nodeId
      });
    }

    if (edges.length > 0) {
      bypasses.set(nodeId, {
        nodeId,
        declaredEntrypointPaths: declaredPaths,
        edges
      });
    }
  }
  return bypasses;
}

/** Detects stable modules (`fanIn >= 3`, `I <= 0.35`) depending on unstable modules (`I >= 0.70`, `delta >= 0.35`). */
export function detectUnstableDependencies(
  nodeInstabilities: ReadonlyMap<string, { fanIn: number; instability: number | null }>,
  dependencies: readonly ModuleDependencyEdge[]
): Map<string, UnstableDependencyModuleFindingV1> {
  const bySource = new Map<string, UnstableDependencyModuleFindingV1>();
  for (const edge of dependencies) {
    const sourceStats = nodeInstabilities.get(edge.fromNodeId);
    const targetStats = nodeInstabilities.get(edge.toNodeId);
    if (!sourceStats || !targetStats) continue;
    if (sourceStats.instability === null || targetStats.instability === null) continue;
    if (sourceStats.fanIn < DEFAULT_UNSTABLE_DEPENDENCY.minSourceFanIn) continue;
    if (sourceStats.instability > DEFAULT_UNSTABLE_DEPENDENCY.maxSourceInstability) continue;
    if (targetStats.instability < DEFAULT_UNSTABLE_DEPENDENCY.minTargetInstability) continue;
    const delta = Number((targetStats.instability - sourceStats.instability).toFixed(6));
    if (delta < DEFAULT_UNSTABLE_DEPENDENCY.minDelta) continue;

    let entry = bySource.get(edge.fromNodeId);
    if (!entry) {
      entry = {
        nodeId: edge.fromNodeId,
        sourceFanIn: sourceStats.fanIn,
        sourceInstability: sourceStats.instability,
        targets: []
      };
      bySource.set(edge.fromNodeId, entry);
    }
    entry.targets.push({
      targetNodeId: edge.toNodeId,
      targetInstability: targetStats.instability,
      delta,
      edgeCount: edge.distinctFileEdgeCount
    });
  }
  for (const entry of bySource.values()) {
    entry.targets.sort((left, right) => compareText(left.targetNodeId, right.targetNodeId));
  }
  return bySource;
}

/**
 * Computes bounded cross-module evolutionary co-change pairs only when Git history is complete
 * (`coverageStatus === "complete"`, P2 Invariant #2).
 */
export function detectCoChangeCoupling(
  gitHistory: GitCoChangeHistoryInputV1 | undefined,
  ownership: OwnershipIndex,
  thresholds: CoChangeThresholds = {}
): {
  window?: GitCoChangeWindowV1;
  summaries: CoChangeDependencySummaryV1[];
  findings: CoChangeCouplingFindingV1[];
} {
  if (!gitHistory) {
    return { summaries: [], findings: [] };
  }
  const reasonCodes = gitHistory.coverageStatus === "complete"
    ? []
    : gitHistory.coverageStatus === "shallow"
      ? ["git-history-shallow"]
      : gitHistory.coverageStatus === "insufficient-history"
        ? ["git-history-insufficient"]
        : ["git-history-unavailable"];

  const window: GitCoChangeWindowV1 = {
    anchorHeadSha: gitHistory.anchorHeadSha ?? "0".repeat(40),
    windowLimit: gitHistory.windowLimit,
    observedCommitCount: gitHistory.observedCommitCount,
    eligibleCommitCount: gitHistory.commits.length,
    maxFilesPerCommit: gitHistory.maxFilesPerCommit,
    isShallow: gitHistory.coverageStatus === "shallow",
    reachedHistoryRoot: gitHistory.coverageStatus === "insufficient-history",
    coverageStatus: gitHistory.coverageStatus,
    reasonCodes
  };

  if (gitHistory.coverageStatus !== "complete") {
    return { window, summaries: [], findings: [] };
  }

  const limits = { ...DEFAULT_CO_CHANGE_THRESHOLDS, ...thresholds };
  const commitCountsByFile = new Map<string, number>();
  const pairCounts = new Map<string, { pathA: string; pathB: string; count: number }>();

  for (const commit of gitHistory.commits) {
    const prodPaths = [...new Set(commit.paths)].filter((path) => !isTestPath(path)).sort(compareText);
    for (const path of prodPaths) {
      commitCountsByFile.set(path, (commitCountsByFile.get(path) ?? 0) + 1);
    }
    for (let leftIndex = 0; leftIndex < prodPaths.length; leftIndex += 1) {
      const pathA = prodPaths[leftIndex]!;
      const ownersA = ownership.byPath.get(pathA)?.owners ?? [];
      if (ownersA.length === 0) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < prodPaths.length; rightIndex += 1) {
        const pathB = prodPaths[rightIndex]!;
        const ownersB = ownership.byPath.get(pathB)?.owners ?? [];
        if (ownersB.length === 0) continue;
        if (ownersA.some((owner) => ownersB.includes(owner))) continue;
        const key = `${pathA}\0${pathB}`;
        const existing = pairCounts.get(key);
        if (existing) existing.count += 1;
        else pairCounts.set(key, { pathA, pathB, count: 1 });
      }
    }
  }

  const groupedByModules = new Map<string, CoChangeCouplingFindingV1>();
  for (const entry of pairCounts.values()) {
    if (entry.count < limits.minCoChangeCount) continue;
    const countA = commitCountsByFile.get(entry.pathA) ?? entry.count;
    const countB = commitCountsByFile.get(entry.pathB) ?? entry.count;
    const union = countA + countB - entry.count;
    if (union <= 0) continue;
    const jaccard = Number((entry.count / union).toFixed(6));
    if (jaccard < limits.minJaccard) continue;

    const ownersA = ownership.byPath.get(entry.pathA)?.owners ?? [];
    const ownersB = ownership.byPath.get(entry.pathB)?.owners ?? [];
    for (const ownerA of ownersA) {
      for (const ownerB of ownersB) {
        if (ownerA === ownerB) continue;
        const memberNodeIds: [string, string] =
          compareText(ownerA, ownerB) <= 0 ? [ownerA, ownerB] : [ownerB, ownerA];
        const modKey = `${memberNodeIds[0]}\0${memberNodeIds[1]}`;
        let group = groupedByModules.get(modKey);
        if (!group) {
          group = {
            memberNodeIds,
            coverageStatus: gitHistory.coverageStatus,
            windowLimit: gitHistory.windowLimit,
            observedCommitCount: gitHistory.observedCommitCount,
            pairs: []
          };
          groupedByModules.set(modKey, group);
        }
        group.pairs.push({
          pathA: entry.pathA,
          pathB: entry.pathB,
          coChangeCount: entry.count,
          jaccard
        });
      }
    }
  }

  const findings = [...groupedByModules.values()]
    .map((finding) => ({
      ...finding,
      pairs: finding.pairs
        .filter((pair, index, list) =>
          index === list.findIndex((other) => other.pathA === pair.pathA && other.pathB === pair.pathB))
        .sort((left, right) => compareText(left.pathA, right.pathA) || compareText(left.pathB, right.pathB))
    }))
    .sort((left, right) =>
      compareText(left.memberNodeIds[0], right.memberNodeIds[0]) ||
      compareText(left.memberNodeIds[1], right.memberNodeIds[1])
    );

  const summaries: CoChangeDependencySummaryV1[] = findings.map((finding) => ({
    fromNodeId: finding.memberNodeIds[0],
    toNodeId: finding.memberNodeIds[1],
    pairCount: finding.pairs.length,
    maxCoChangeCount: finding.pairs.reduce((max, pair) => Math.max(max, pair.coChangeCount), 0),
    maxJaccard: finding.pairs.reduce((max, pair) => Math.max(max, pair.jaccard), 0)
  }));

  return { window, summaries, findings };
}
