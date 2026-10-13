import { digestJson } from "@archcontext/contracts";

const DIGEST_PREFIX_LENGTH = "sha256:".length;
const COMPONENT_ID_LENGTH = 16;

export interface ModuleGraphEdgeCounts {
  internalEdgeCount: number;
  inboundModuleEdges: number;
  outboundModuleEdges: number;
  fanIn: number;
  fanOut: number;
  stronglyConnectedComponentId: string | null;
  cycleCount: number;
}

/** One ordered cross-module dependency: how many distinct file edges `from` has into `to`. */
export interface ModuleDependencyEdge {
  fromNodeId: string;
  toNodeId: string;
  distinctFileEdgeCount: number;
}

export interface ModuleGraph {
  countsByNode: Map<string, ModuleGraphEdgeCounts>;
  /**
   * Every ordered cross-module pair with at least one attributed file edge, sorted by
   * `(fromNodeId, toNodeId)`. Same attribution as the counts: a contested file speaks for each
   * claimant, and a same-owner edge is internal, never a dependency.
   */
  dependencies: ModuleDependencyEdge[];
  /** Distinct ordered module pairs `(from, to)` with `from !== to`. */
  crossModuleEdgeCount: number;
  /** Distinct ordered cross-module pairs whose endpoints share one strongly connected component. */
  crossModuleCycleCount: number;
  /** Components with more than one member, plus single members that carry a self-loop. */
  stronglyConnectedComponentCount: number;
}

/** `from` module -> `to` module -> number of distinct file edges attributed to that module pair. */
type PairCounts = Map<string, Map<string, number>>;

/**
 * Builds the module-level import graph from resolved file edges and runs Tarjan over it.
 *
 * A file edge is attributed to every `(owner(from), owner(to))` pair, so a contested file
 * contributes to each claimant instead of disappearing into one arbitrary winner.
 *
 * A same-owner file edge is counted in `internalEdgeCount` and is deliberately NOT a module-graph
 * edge. The module graph answers "which modules depend on which"; a module does not depend on
 * itself. So an intra-module file cycle, however real, is not a module cycle: it never creates a
 * one-member component, and an acyclic module with internal imports reports
 * `stronglyConnectedComponentId: null` and `cycleCount: 0`. Intra-module cycles are a
 * file-granularity concern that a module-granularity snapshot cannot honestly report.
 *
 * Everything is keyed through nested maps rather than joined strings: node ids and repo-relative
 * paths are free-form, and a delimiter collision would silently merge two distinct edges.
 */
export function buildModuleGraph(
  nodeIds: string[],
  fileEdges: { from: string; to: string }[],
  ownersByPath: Map<string, string[]>
): ModuleGraph {
  const known = new Set(nodeIds);
  const pairCounts: PairCounts = new Map();
  for (const [fromFile, toFiles] of distinctFileEdges(fileEdges)) {
    const fromOwners = (ownersByPath.get(fromFile) ?? []).filter((id) => known.has(id));
    if (fromOwners.length === 0) continue;
    for (const toFile of toFiles) {
      const toOwners = (ownersByPath.get(toFile) ?? []).filter((id) => known.has(id));
      for (const from of fromOwners) {
        for (const to of toOwners) increment(pairCounts, from, to);
      }
    }
  }

  const counts = new Map<string, ModuleGraphEdgeCounts>(nodeIds.map((id) => [id, {
    internalEdgeCount: 0,
    inboundModuleEdges: 0,
    outboundModuleEdges: 0,
    fanIn: 0,
    fanOut: 0,
    stronglyConnectedComponentId: null,
    cycleCount: 0
  }]));
  const successors = new Map<string, Set<string>>(nodeIds.map((id) => [id, new Set<string>()]));
  const dependencies: ModuleDependencyEdge[] = [];
  let crossModuleEdgeCount = 0;
  for (const [from, targets] of pairCounts) {
    for (const [to, edgeCount] of targets) {
      if (from === to) {
        counts.get(from)!.internalEdgeCount += edgeCount;
        continue;
      }
      dependencies.push({ fromNodeId: from, toNodeId: to, distinctFileEdgeCount: edgeCount });
      successors.get(from)!.add(to);
      counts.get(from)!.outboundModuleEdges += edgeCount;
      counts.get(from)!.fanOut += 1;
      counts.get(to)!.inboundModuleEdges += edgeCount;
      counts.get(to)!.fanIn += 1;
      crossModuleEdgeCount += 1;
    }
  }

  let stronglyConnectedComponentCount = 0;
  const componentByNode = new Map<string, string>();
  for (const members of tarjanComponents(nodeIds, successors)) {
    // The module graph carries no self-loops, so a one-member component is always trivial.
    if (members.length === 1) continue;
    stronglyConnectedComponentCount += 1;
    const componentId = stronglyConnectedComponentIdFor(members);
    for (const member of members) componentByNode.set(member, componentId);
  }
  for (const id of nodeIds) counts.get(id)!.stronglyConnectedComponentId = componentByNode.get(id) ?? null;

  // `cycleCount` is the module's own out-edges that stay inside its own component, i.e. how many
  // of its dependencies can reach it back. It is deliberately not the number of simple cycles
  // through the module: enumerating simple cycles is exponential in the component size, and a
  // repository-wide scan cannot afford an answer that may never terminate.
  let crossModuleCycleCount = 0;
  for (const [from, targets] of successors) {
    const component = componentByNode.get(from);
    if (component === undefined) continue;
    for (const to of targets) {
      if (componentByNode.get(to) !== component) continue;
      counts.get(from)!.cycleCount += 1;
      crossModuleCycleCount += 1;
    }
  }

  dependencies.sort(compareDependencies);
  return { countsByNode: counts, dependencies, crossModuleEdgeCount, crossModuleCycleCount, stronglyConnectedComponentCount };
}

/**
 * One pair of modules that depend on each other directly. `nodeIds` is the canonical (sorted)
 * order; `forward` counts `nodeIds[0] -> nodeIds[1]`, `backward` the reverse. The thin direction is
 * the smaller count, ties going to `forward`, so the choice is total and stable.
 */
export interface BidirectionalModulePair {
  nodeIds: [string, string];
  forwardEdgeCount: number;
  backwardEdgeCount: number;
  thinDirectionEdgeCount: number;
  totalEdgeCount: number;
  thinDirection: { fromNodeId: string; toNodeId: string };
}

/**
 * Every bidirectional module pair, ordered by `(thinDirectionEdgeCount, totalEdgeCount, A, B)`
 * ascending: the cheapest cut first.
 */
export function bidirectionalModulePairs(dependencies: readonly ModuleDependencyEdge[]): BidirectionalModulePair[] {
  const counts = dependencyCounts(dependencies);
  const pairs: BidirectionalModulePair[] = [];
  for (const [from, targets] of counts) {
    for (const [to, forward] of targets) {
      if (!(from < to)) continue;
      const backward = counts.get(to)?.get(from) ?? 0;
      if (forward <= 0 || backward <= 0) continue;
      const forwardIsThin = forward <= backward;
      pairs.push({
        nodeIds: [from, to],
        forwardEdgeCount: forward,
        backwardEdgeCount: backward,
        thinDirectionEdgeCount: Math.min(forward, backward),
        totalEdgeCount: forward + backward,
        thinDirection: forwardIsThin ? { fromNodeId: from, toNodeId: to } : { fromNodeId: to, toNodeId: from }
      });
    }
  }
  return pairs.sort((left, right) => left.thinDirectionEdgeCount - right.thinDirectionEdgeCount
    || left.totalEdgeCount - right.totalEdgeCount
    || compareText(left.nodeIds[0], right.nodeIds[0])
    || compareText(left.nodeIds[1], right.nodeIds[1]));
}

/** One strongly connected component that survives cutting the thin direction of every pair. */
export interface ResidualModuleCycle {
  /** Sorted members, at least three: a two-member component is always a bidirectional pair. */
  memberNodeIds: string[];
  /** The residual module edges that stay inside the component, sorted by `(from, to)`. */
  edges: ModuleDependencyEdge[];
}

/**
 * The cycles that remain after removing only the thin direction of every bidirectional pair from
 * a copy of the module graph. No edge is added, so every reported cycle exists in the measured
 * graph; removing only the thin direction (never both) keeps mixed cycles such as A<->B plus
 * A->C->B visible. This is a topology diagnostic, not a minimum cut: the pairs' thin cuts are cost
 * hints, and a residual says that applying all of them would still leave this cycle.
 */
export function residualModuleCycles(
  nodeIds: readonly string[],
  dependencies: readonly ModuleDependencyEdge[]
): ResidualModuleCycle[] {
  const cut = new Set(bidirectionalModulePairs(dependencies)
    .map((pair) => JSON.stringify([pair.thinDirection.fromNodeId, pair.thinDirection.toNodeId])));
  const residual = dependencies.filter((edge) => !cut.has(JSON.stringify([edge.fromNodeId, edge.toNodeId])));
  const known = [...new Set([...nodeIds, ...residual.flatMap((edge) => [edge.fromNodeId, edge.toNodeId])])].sort(compareText);
  const successors = new Map<string, Set<string>>(known.map((id) => [id, new Set<string>()]));
  for (const edge of residual) successors.get(edge.fromNodeId)!.add(edge.toNodeId);
  const cycles: ResidualModuleCycle[] = [];
  for (const members of tarjanComponents(known, successors)) {
    if (members.length < 2) continue;
    const inside = new Set(members);
    cycles.push({
      memberNodeIds: [...members].sort(compareText),
      edges: residual.filter((edge) => inside.has(edge.fromNodeId) && inside.has(edge.toNodeId)).sort(compareDependencies)
    });
  }
  return cycles.sort((left, right) => compareText(JSON.stringify(left.memberNodeIds), JSON.stringify(right.memberNodeIds)));
}

/**
 * The members of `memberNodeIds` that still lie on a residual cycle among themselves: the residual
 * graph of `dependencies`, restricted to those members, then Tarjan. `0` means the recorded
 * residual cycle is gone.
 */
export function residualCycleMemberCount(
  memberNodeIds: readonly string[],
  dependencies: readonly ModuleDependencyEdge[]
): number {
  const members = new Set(memberNodeIds);
  const inside = dependencies.filter((edge) => members.has(edge.fromNodeId) && members.has(edge.toNodeId));
  return residualModuleCycles([...members], inside).reduce((total, cycle) => total + cycle.memberNodeIds.length, 0);
}

/** The id a strongly connected component is named by: a digest of its sorted members. */
export function moduleComponentId(members: readonly string[]): string {
  return stronglyConnectedComponentIdFor([...members]);
}

function dependencyCounts(dependencies: readonly ModuleDependencyEdge[]): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>();
  for (const edge of dependencies) {
    if (edge.fromNodeId === edge.toNodeId) continue;
    const targets = counts.get(edge.fromNodeId) ?? new Map<string, number>();
    targets.set(edge.toNodeId, (targets.get(edge.toNodeId) ?? 0) + edge.distinctFileEdgeCount);
    counts.set(edge.fromNodeId, targets);
  }
  return counts;
}

function compareDependencies(left: ModuleDependencyEdge, right: ModuleDependencyEdge): number {
  return compareText(left.fromNodeId, right.fromNodeId) || compareText(left.toNodeId, right.toNodeId);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Collapses repeated `(from, to)` file edges: two imports of the same target are one edge. */
function distinctFileEdges(fileEdges: { from: string; to: string }[]): Map<string, Set<string>> {
  const byFrom = new Map<string, Set<string>>();
  for (const edge of fileEdges) {
    const targets = byFrom.get(edge.from);
    if (targets) targets.add(edge.to);
    else byFrom.set(edge.from, new Set([edge.to]));
  }
  return byFrom;
}

function increment(pairCounts: PairCounts, from: string, to: string): void {
  const targets = pairCounts.get(from);
  if (!targets) {
    pairCounts.set(from, new Map([[to, 1]]));
    return;
  }
  targets.set(to, (targets.get(to) ?? 0) + 1);
}

function stronglyConnectedComponentIdFor(members: string[]): string {
  const digest = digestJson([...members].sort());
  return `scc.${digest.slice(DIGEST_PREFIX_LENGTH, DIGEST_PREFIX_LENGTH + COMPONENT_ID_LENGTH)}`;
}

/**
 * Iterative Tarjan. Recursion would blow the stack on a repository-sized component, and this
 * builder must not fail on a model that is merely large.
 */
function tarjanComponents(nodeIds: string[], successors: Map<string, Set<string>>): string[][] {
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const open = (node: string): { node: string; successors: string[]; cursor: number } => {
    index.set(node, counter);
    lowLink.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    return { node, successors: [...successors.get(node)!].sort(), cursor: 0 };
  };

  for (const root of nodeIds) {
    if (index.has(root)) continue;
    const frames = [open(root)];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame.cursor < frame.successors.length) {
        const next = frame.successors[frame.cursor];
        frame.cursor += 1;
        if (!index.has(next)) frames.push(open(next));
        else if (onStack.has(next)) lowLink.set(frame.node, Math.min(lowLink.get(frame.node)!, index.get(next)!));
        continue;
      }
      frames.pop();
      if (lowLink.get(frame.node)! === index.get(frame.node)!) {
        const members: string[] = [];
        for (;;) {
          const member = stack.pop()!;
          onStack.delete(member);
          members.push(member);
          if (member === frame.node) break;
        }
        components.push(members.sort());
      }
      const parent = frames[frames.length - 1];
      if (parent) lowLink.set(parent.node, Math.min(lowLink.get(parent.node)!, lowLink.get(frame.node)!));
    }
  }
  return components;
}
