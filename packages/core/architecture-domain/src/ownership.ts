import { nativeNodeSource, type NativeNode } from "./native-model";
import { globLiteralPrefixLength, globToRegExp } from "./source-globs";

// Path ownership rules (ADR-0043):
// 1. A node is in play iff one of its `source.include` globs matches and none of its `exclude`
//    globs match. The winning match sets its literal-prefix length.
// 2. If all matching nodes lie on one `parent` chain, the deepest on that chain owns the path.
// 3. Otherwise, only nodes with no descendant in the candidate set compete; a single longest
//    literal prefix wins, and ties stay ambiguous (never fall back to node order).
// 4. Parentless/unreadable models or equal-specificity overlaps fail closed rather than guessing.
// `archctx resolve --path` and `archctx resolve --paths-from` (packages/surfaces/cli/src/main.ts)
// call this; a repo-harness adapter is expected to call the CLI rather than re-deriving it.

export type ResolveArchitectureOwnerResult =
  | { status: "matched"; node: NativeNode; owningCapabilityId: string | null }
  | { status: "no-match"; owningCapabilityId: null }
  | { status: "ambiguous"; candidates: NativeNode[]; owningCapabilityId: string | null };

export function resolveArchitectureOwnerForPath(nodes: NativeNode[], path: string): ResolveArchitectureOwnerResult {
  return resolveArchitectureOwnersForPaths(nodes, [path])[0];
}

/**
 * Resolves many paths against one node set, in input order. The globs are compiled once, so a
 * batch costs one model load instead of one process per path.
 *
 * `owningCapabilityId` is the nearest `kind: capability` node on the owner's parent chain (the
 * owner itself when it is a capability). For an ambiguous path it is set only when every
 * candidate has the same owning capability; otherwise it is `null`.
 */
export function resolveArchitectureOwnersForPaths(nodes: NativeNode[], paths: readonly string[]): ResolveArchitectureOwnerResult[] {
  const declaring = nodes.flatMap((node) => {
    const source = nativeNodeSource(node);
    const include = source?.include ?? [];
    if (include.length === 0) return [];
    return [{
      node,
      include: include.map((pattern) => ({ regex: globToRegExp(pattern), specificity: globLiteralPrefixLength(pattern) })),
      exclude: (source?.exclude ?? []).map(globToRegExp)
    }];
  });
  const parents = new Map<string, string | undefined>(nodes.map((node) => [node.id, node.parent]));
  const kinds = new Map(nodes.map((node) => [node.id, node.kind]));
  const owningCapabilityOf = (id: string): string | null => {
    for (const ancestor of ancestorChain(id, parents)) if (kinds.get(ancestor) === "capability") return ancestor;
    return null;
  };

  return paths.map((path): ResolveArchitectureOwnerResult => {
    const candidates: { node: NativeNode; specificity: number }[] = [];
    for (const entry of declaring) {
      if (entry.exclude.some((regex) => regex.test(path))) continue;
      const specificity = entry.include
        .filter((pattern) => pattern.regex.test(path))
        .reduce((max, pattern) => Math.max(max, pattern.specificity), -1);
      if (specificity >= 0) candidates.push({ node: entry.node, specificity });
    }
    if (candidates.length === 0) return { status: "no-match", owningCapabilityId: null };

    const chainOwner = deepestOnOneParentChain(candidates.map((candidate) => candidate.node.id), parents);
    if (chainOwner !== undefined) {
      const node = candidates.find((candidate) => candidate.node.id === chainOwner)!.node;
      return { status: "matched", node, owningCapabilityId: owningCapabilityOf(node.id) };
    }

    const chains = new Map(candidates.map((candidate) => [candidate.node.id, ancestorChain(candidate.node.id, parents)]));
    const isStrictAncestorOf = (ancestor: string, descendant: string): boolean =>
      ancestor !== descendant && chains.get(descendant)!.has(ancestor) && !chains.get(ancestor)!.has(descendant);
    const leaves = candidates.filter((candidate) => !candidates.some((other) => isStrictAncestorOf(candidate.node.id, other.node.id)));
    // Only a `parent` cycle (which `validate` reports) can leave no leaf; then every candidate competes.
    const contenders = leaves.length > 0 ? leaves : candidates;
    const maxSpecificity = contenders.reduce((max, candidate) => Math.max(max, candidate.specificity), -1);
    const winners = contenders.filter((candidate) => candidate.specificity === maxSpecificity).map((candidate) => candidate.node);
    if (winners.length === 1) return { status: "matched", node: winners[0], owningCapabilityId: owningCapabilityOf(winners[0].id) };
    const capabilities = new Set(winners.map((node) => owningCapabilityOf(node.id)));
    return { status: "ambiguous", candidates: winners, owningCapabilityId: capabilities.size === 1 ? [...capabilities][0] : null };
  });
}

/**
 * The parent-chain ownership rule, shared by `resolveArchitectureOwnersForPaths` and the
 * module-statistics ownership index behind `refactor scan`: when every candidate lies on one
 * `parent` chain, the deepest candidate (lowest id on a depth tie) owns the path. Returns
 * `undefined` when the candidates sit on more than one chain.
 */
export function deepestOnOneParentChain(candidateIds: readonly string[], parents: ReadonlyMap<string, string | undefined>): string | undefined {
  if (candidateIds.length === 0) return undefined;
  const depthOf = (id: string): number => ancestorChain(id, parents).size - 1;
  const deepest = candidateIds.reduce((best, id) => {
    const bestDepth = depthOf(best);
    const depth = depthOf(id);
    if (depth !== bestDepth) return depth > bestDepth ? id : best;
    return id < best ? id : best;
  });
  // Two distinct nodes at the same depth can never both sit on one chain, so the ancestor-set
  // test below already covers the depth-tie case; it needs no separate branch.
  const chain = ancestorChain(deepest, parents);
  return candidateIds.every((id) => chain.has(id)) ? deepest : undefined;
}

/** The node plus every ancestor reachable through `parent`, nearest first. A cycle or dangling parent ends the walk. */
export function ancestorChain(id: string, parents: ReadonlyMap<string, string | undefined>): Set<string> {
  const chain = new Set<string>();
  let current: string | undefined = id;
  while (current !== undefined && parents.has(current) && !chain.has(current)) {
    chain.add(current);
    current = parents.get(current);
  }
  return chain;
}

/** The selected node and its descendants under the declared parent relation. */
export function nodeSubtreeIds(nodes: readonly NativeNode[], nodeId: string): Set<string> {
  const parents = new Map(nodes.map((node) => [node.id, node.parent]));
  return new Set(nodes.filter((node) => ancestorChain(node.id, parents).has(nodeId)).map((node) => node.id));
}
