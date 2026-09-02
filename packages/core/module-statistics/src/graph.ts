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

export interface ModuleGraph {
  countsByNode: Map<string, ModuleGraphEdgeCounts>;
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
 * contributes to each claimant instead of disappearing into one arbitrary winner. Self edges are
 * kept: a module importing across two of its own files is an internal edge, and a module whose own
 * files close an import cycle is a one-member component that is not trivial.
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
  let crossModuleEdgeCount = 0;
  for (const [from, targets] of pairCounts) {
    for (const [to, edgeCount] of targets) {
      successors.get(from)!.add(to);
      if (from === to) {
        counts.get(from)!.internalEdgeCount += edgeCount;
        continue;
      }
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
    const selfLooping = members.length === 1 && successors.get(members[0])!.has(members[0]);
    if (members.length === 1 && !selfLooping) continue;
    stronglyConnectedComponentCount += 1;
    const componentId = stronglyConnectedComponentIdFor(members);
    for (const member of members) componentByNode.set(member, componentId);
  }
  for (const id of nodeIds) counts.get(id)!.stronglyConnectedComponentId = componentByNode.get(id) ?? null;

  // `cycleCount` is the module's own out-edges (self-loop included) that stay inside its own
  // component, i.e. how many of its dependencies can reach it back. It is deliberately not the
  // number of simple cycles through the module: enumerating simple cycles is exponential in the
  // component size, and a repository-wide scan cannot afford an answer that may never terminate.
  let crossModuleCycleCount = 0;
  for (const [from, targets] of pairCounts) {
    const component = componentByNode.get(from);
    if (component === undefined) continue;
    for (const to of targets.keys()) {
      if (componentByNode.get(to) !== component) continue;
      counts.get(from)!.cycleCount += 1;
      if (from !== to) crossModuleCycleCount += 1;
    }
  }

  return { countsByNode: counts, crossModuleEdgeCount, crossModuleCycleCount, stronglyConnectedComponentCount };
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
