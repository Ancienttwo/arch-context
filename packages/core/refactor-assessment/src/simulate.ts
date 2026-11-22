import {
  REFACTOR_SIMULATE_V1_SCHEMA_VERSION,
  digestJson,
  type ArchitectureRepositoryIdentityV1,
  type ArchitectureWorktreeIdentityV1,
  type DependencyConstraintV1,
  type Json,
  type ModuleStatisticsSnapshotV1,
  type RefactorSimulationMoveV1,
  type RefactorSimulationResultV1
} from "@archcontext/contracts";
import { nativeNodeSource, type NativeModel, type NativeNode } from "@archcontext/core/architecture-domain";
import {
  bidirectionalModulePairs,
  measureModuleStatistics,
  residualModuleCycles,
  type ModuleStatisticsCodeFactsInputV1,
  type ModuleStatisticsImportEdgeV1,
  type ModuleStatisticsTrackedFileV1,
  type ModuleStatisticsWorkspacePackageV1,
  type ModuleStructureV1
} from "@archcontext/core/module-statistics";

export interface SimulateRefactorPlanInputV1 {
  snapshot: ModuleStatisticsSnapshotV1;
  structure: ModuleStructureV1;
  model: NativeModel;
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  trackedFiles: ModuleStatisticsTrackedFileV1[];
  importEdges: ModuleStatisticsImportEdgeV1[];
  workspacePackages: ModuleStatisticsWorkspacePackageV1[];
  truncated: boolean;
  edgeLimit: number | null;
  importNodeCount?: number | null;
  importNodeLimitExceeded?: boolean;
  codeFacts: ModuleStatisticsCodeFactsInputV1;
  constraints?: DependencyConstraintV1[];
  createdAt: string;
  moves?: RefactorSimulationMoveV1[];
  targetSubject?: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pairId(nodeIds: readonly [string, string]): string {
  return `${nodeIds[0]}<->${nodeIds[1]}`;
}

function parseTargetPair(targetSubject: string | undefined): [string, string] | undefined {
  if (!targetSubject) return undefined;
  if (targetSubject.startsWith("pair:")) {
    const parts = targetSubject.slice("pair:".length).split("|");
    if (parts.length === 2 && parts[0] && parts[1]) {
      return compareText(parts[0], parts[1]) <= 0 ? [parts[0], parts[1]] : [parts[1], parts[0]];
    }
  }
  const arrowParts = targetSubject.split("<->");
  if (arrowParts.length === 2 && arrowParts[0] && arrowParts[1]) {
    return compareText(arrowParts[0], arrowParts[1]) <= 0
      ? [arrowParts[0], arrowParts[1]]
      : [arrowParts[1], arrowParts[0]];
  }
  return undefined;
}

function pairThinCount(snapshot: ModuleStatisticsSnapshotV1, pair: readonly [string, string] | undefined): number {
  if (!pair) return 0;
  const found = bidirectionalModulePairs(snapshot.moduleDependencies).find(
    (entry) => entry.nodeIds[0] === pair[0] && entry.nodeIds[1] === pair[1]
  );
  return found?.thinDirectionEdgeCount ?? 0;
}

function snapshotMetrics(
  snapshot: ModuleStatisticsSnapshotV1,
  structure: ModuleStructureV1,
  targetPair: readonly [string, string] | undefined
) {
  return {
    pairThinDirectionEdgeCount: pairThinCount(snapshot, targetPair),
    crossModuleEdgeCount: snapshot.repositorySummary.crossModuleEdgeCount,
    crossModuleCycleCount: snapshot.repositorySummary.crossModuleCycleCount,
    residualCycleCount: residualModuleCycles(
      snapshot.modules.map((m) => m.nodeId),
      snapshot.moduleDependencies
    ).length,
    directionViolationCount: structure.directionViolations.length
  };
}

function applyVirtualMoves(model: NativeModel, moves: readonly RefactorSimulationMoveV1[]): NativeModel {
  const knownIds = new Set(model.nodes.map((node) => node.id));
  for (const move of moves) {
    if (!knownIds.has(move.toNodeId)) {
      throw new Error(`AC_SCHEMA_INVALID: unknown simulation destination node ${move.toNodeId}`);
    }
  }
  const clonedNodes: NativeNode[] = model.nodes.map((node) => structuredClone(node));
  const nodeMap = new Map(clonedNodes.map((node) => [node.id, node]));

  for (const move of moves) {
    for (const node of clonedNodes) {
      const source = nativeNodeSource(node);
      if (!source) continue;
      if (node.id === move.toNodeId) {
        const nextInclude = [...new Set([...(source.include ?? []), move.path])];
        const nextExclude = (source.exclude ?? []).filter((pattern) => pattern !== move.path);
        node.source = { ...source, include: nextInclude, exclude: nextExclude } as unknown as Json;
      } else {
        const nextInclude = (source.include ?? []).filter((pattern) => pattern !== move.path);
        const nextExclude = [...new Set([...(source.exclude ?? []), move.path])];
        node.source = { ...source, include: nextInclude, exclude: nextExclude } as unknown as Json;
      }
    }
    const targetNode = nodeMap.get(move.toNodeId)!;
    if (!nativeNodeSource(targetNode)) {
      targetNode.source = { include: [move.path], exclude: [] };
    }
  }
  return { ...model, nodes: clonedNodes };
}

function measureVirtualMoves(
  input: SimulateRefactorPlanInputV1,
  moves: readonly RefactorSimulationMoveV1[],
  targetPair: readonly [string, string] | undefined
) {
  const virtualModel = applyVirtualMoves(input.model, moves);
  const afterMeasurement = measureModuleStatistics({
    model: virtualModel,
    repository: input.repository,
    worktree: input.worktree,
    trackedFiles: input.trackedFiles,
    importEdges: input.importEdges,
    workspacePackages: input.workspacePackages,
    truncated: input.truncated,
    edgeLimit: input.edgeLimit,
    importNodeCount: input.importNodeCount,
    importNodeLimitExceeded: input.importNodeLimitExceeded,
    codeFacts: input.codeFacts,
    constraints: input.constraints,
    createdAt: input.createdAt
  });
  const afterMetrics = snapshotMetrics(afterMeasurement.snapshot, afterMeasurement.structure, targetPair);
  return { afterMeasurement, afterMetrics };
}

/**
 * Pure read-only move & cut simulator (#638, P2 Invariant #3).
 * Computes real metric deltas only for whole-file moves; reports explicit `unmeasured` state
 * without fabricating numbers whenever a move names `symbols` or a cut strategy requires
 * virtual module/interface synthesis.
 */
export function simulateRefactorPlan(input: SimulateRefactorPlanInputV1): RefactorSimulationResultV1 {
  const moves = input.moves ?? [];
  const targetPair = parseTargetPair(input.targetSubject);
  const beforePairs = bidirectionalModulePairs(input.snapshot.moduleDependencies);
  const focusPair = targetPair
    ? beforePairs.find((pair) => pair.nodeIds[0] === targetPair[0] && pair.nodeIds[1] === targetPair[1])
    : beforePairs[0];
  const activePair = focusPair?.nodeIds ?? targetPair;
  const beforeMetrics = snapshotMetrics(input.snapshot, input.structure, activePair);

  const cutCandidates: RefactorSimulationResultV1["cutCandidates"] = [];
  if (focusPair) {
    const thinEdges = input.structure.importEdges
      .filter((edge) => edge.to !== null)
      .filter((edge) => {
        const fromOwners = input.structure.ownership.byPath.get(edge.from)?.owners ?? [];
        const toOwners = input.structure.ownership.byPath.get(edge.to!)?.owners ?? [];
        return fromOwners.includes(focusPair.thinDirection.fromNodeId) &&
          toOwners.includes(focusPair.thinDirection.toNodeId);
      })
      .sort((left, right) => compareText(left.from, right.from) || compareText(left.to!, right.to!));

    const firstEdge = thinEdges[0];
    if (firstEdge) {
      for (const candidateDef of [
        {
          strategy: "move-source-file" as const,
          move: { path: firstEdge.from, toNodeId: focusPair.thinDirection.toNodeId },
          summary: `Move ${firstEdge.from} into ${focusPair.thinDirection.toNodeId} to evaluate cycle closure.`
        },
        {
          strategy: "move-target-file" as const,
          move: { path: firstEdge.to!, toNodeId: focusPair.thinDirection.fromNodeId },
          summary: `Move ${firstEdge.to!} into ${focusPair.thinDirection.fromNodeId} to evaluate cycle closure.`
        }
      ]) {
        const simulated = measureVirtualMoves(input, [candidateDef.move], focusPair.nodeIds);
        const beforeViolKeys = new Set(input.structure.directionViolations.map((v) => `${v.constraintId}\0${v.fromPath}\0${v.toPath}`));
        const newViolCount = simulated.afterMeasurement.structure.directionViolations
          .filter((v) => !beforeViolKeys.has(`${v.constraintId}\0${v.fromPath}\0${v.toPath}`)).length;
        cutCandidates.push({
          strategy: candidateDef.strategy,
          measured: true,
          measurementStatus: "measured",
          summary: candidateDef.summary,
          moves: [candidateDef.move],
          thinDirectionEdgeDelta: simulated.afterMetrics.pairThinDirectionEdgeCount - beforeMetrics.pairThinDirectionEdgeCount,
          crossModuleCycleDelta: simulated.afterMetrics.crossModuleCycleCount - beforeMetrics.crossModuleCycleCount,
          directionViolationDelta: simulated.afterMetrics.directionViolationCount - beforeMetrics.directionViolationCount,
          newlyIntroducedViolationCount: newViolCount,
          breaksPair: simulated.afterMetrics.pairThinDirectionEdgeCount === 0,
          caveats: ["Simulates whole-file ownership reassignment only; relative specifiers remain unchanged."]
        });
      }
    }

    cutCandidates.push(
      {
        strategy: "extract-shared-leaf",
        measured: false,
        measurementStatus: "unmeasured",
        summary: `Extract shared types/helpers from ${focusPair.nodeIds[0]} and ${focusPair.nodeIds[1]} into a leaf module.`,
        moves: [],
        thinDirectionEdgeDelta: null,
        crossModuleCycleDelta: null,
        directionViolationDelta: null,
        newlyIntroducedViolationCount: null,
        breaksPair: null,
        caveats: ["Virtual module creation and AST import rewriting are unmodeled in static simulation."]
      },
      {
        strategy: "invert-interface",
        measured: false,
        measurementStatus: "unmeasured",
        summary: `Invert the thin direction (${focusPair.thinDirection.fromNodeId} -> ${focusPair.thinDirection.toNodeId}) behind an interface.`,
        moves: [],
        thinDirectionEdgeDelta: null,
        crossModuleCycleDelta: null,
        directionViolationDelta: null,
        newlyIntroducedViolationCount: null,
        breaksPair: null,
        caveats: ["Interface synthesis and dependency inversion rewrites are unmodeled in static simulation."]
      }
    );
  }

  const hasSymbolSubsetMove = moves.some((move) => (move.symbols?.length ?? 0) > 0);
  let measurementStatus: "measured" | "unmeasured" = "measured";
  let unmeasuredReasons: string[] = [];
  let afterMetrics: typeof beforeMetrics | null = beforeMetrics;
  let deltaMetrics: RefactorSimulationResultV1["metricsDelta"]["delta"] = {
    pairThinDirectionEdgeCount: 0,
    crossModuleEdgeCount: 0,
    crossModuleCycleCount: 0,
    residualCycleCount: 0,
    directionViolationCount: 0
  };
  let newlyIntroducedCycles: string[] = [];
  let resolvedCycles: string[] = [];
  let newlyIntroducedViolations: RefactorSimulationResultV1["newlyIntroducedViolations"] = [];

  if (hasSymbolSubsetMove) {
    measurementStatus = "unmeasured";
    unmeasuredReasons = ["symbol-subset-rewrite-unmodeled"];
    afterMetrics = null;
    deltaMetrics = null;
  } else if (moves.length > 0) {
    const simulated = measureVirtualMoves(input, moves, activePair);
    afterMetrics = simulated.afterMetrics;
    deltaMetrics = {
      pairThinDirectionEdgeCount: afterMetrics.pairThinDirectionEdgeCount - beforeMetrics.pairThinDirectionEdgeCount,
      crossModuleEdgeCount: afterMetrics.crossModuleEdgeCount - beforeMetrics.crossModuleEdgeCount,
      crossModuleCycleCount: afterMetrics.crossModuleCycleCount - beforeMetrics.crossModuleCycleCount,
      residualCycleCount: afterMetrics.residualCycleCount - beforeMetrics.residualCycleCount,
      directionViolationCount: afterMetrics.directionViolationCount - beforeMetrics.directionViolationCount
    };

    const beforePairIds = new Set(beforePairs.map((pair) => pairId(pair.nodeIds)));
    const afterPairs = bidirectionalModulePairs(simulated.afterMeasurement.snapshot.moduleDependencies);
    const afterPairIds = new Set(afterPairs.map((pair) => pairId(pair.nodeIds)));
    newlyIntroducedCycles = [...afterPairIds].filter((id) => !beforePairIds.has(id)).sort(compareText);
    resolvedCycles = [...beforePairIds].filter((id) => !afterPairIds.has(id)).sort(compareText);

    const beforeViolKeys = new Set(
      input.structure.directionViolations.map((v) => `${v.constraintId}\0${v.fromPath}\0${v.toPath}`)
    );
    newlyIntroducedViolations = simulated.afterMeasurement.structure.directionViolations
      .filter((v) => !beforeViolKeys.has(`${v.constraintId}\0${v.fromPath}\0${v.toPath}`))
      .map((v) => ({
        constraintId: v.constraintId,
        fromPath: v.fromPath,
        toPath: v.toPath,
        fromNode: v.fromNode,
        toNode: v.toNode,
        severity: v.severity
      }));
  }

  const bodyWithoutDigest = {
    schemaVersion: REFACTOR_SIMULATE_V1_SCHEMA_VERSION,
    beforeSnapshotDigest: input.snapshot.snapshotDigest,
    modelDigest: input.snapshot.modelDigest,
    codeFactsCoverage: input.snapshot.codeFacts.coverage,
    moves: [...moves],
    targetSubject: input.targetSubject ?? null,
    measurementStatus,
    unmeasuredReasons,
    metricsDelta: {
      before: beforeMetrics,
      after: afterMetrics,
      delta: deltaMetrics
    },
    newlyIntroducedCycles,
    resolvedCycles,
    newlyIntroducedViolations,
    cutCandidates,
    privacy: {
      writes: "none" as const,
      rawSourcePersisted: false as const,
      rawDiffPersisted: false as const,
      promptPersisted: false as const
    }
  };
  return {
    ...bodyWithoutDigest,
    simulationDigest: digestJson(bodyWithoutDigest as unknown as Json)
  };
}
