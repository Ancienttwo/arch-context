import { matchesGlob, nativeNodeSource, type NativeNode } from "../../projection-engine/src/index";

export interface OwnershipResolution {
  /** Node ids that own this file. More than one id means the claim is contested. */
  owners: string[];
  /** True when the candidates did not collapse to a single `parent` chain. */
  ambiguous: boolean;
}

export interface OwnershipIndex {
  /** Resolution per tracked file path. */
  byPath: Map<string, OwnershipResolution>;
  /** Sorted owned file paths per node id; a node that owns nothing is absent. */
  filesByNode: Map<string, string[]>;
  ownedFileCount: number;
  unownedFileCount: number;
  multiplyOwnedFileCount: number;
}

/**
 * Resolves tracked files to owning nodes under the PRD ancestor rule.
 *
 * This is deliberately not `resolveArchitectureOwnerForPath`. That resolver implements the
 * ADR-0043 tie-break for `archctx resolve --path`: the longest literal glob prefix wins and an
 * equal-specificity tie is rejected. The PRD needs the *structural* rule instead — a file claimed
 * by both `packages/core/**` and `packages/core/pressure-engine/**` belongs to the component,
 * because the component is a descendant of the module in the model, regardless of which glob
 * happens to carry the longer literal prefix. Claimants that do not sit on one `parent` chain are
 * a real modeling conflict, so all of them keep the file and all of them report ambiguity rather
 * than letting one silently win.
 */
export function resolveOwnership(nodes: NativeNode[], paths: string[]): OwnershipIndex {
  const declaring = nodes.filter((node) => (nativeNodeSource(node)?.include ?? []).length > 0);
  const parents = new Map<string, string | undefined>(nodes.map((node) => [node.id, node.parent]));
  const depths = new Map(nodes.map((node) => [node.id, depthOf(node.id, parents)]));
  const byPath = new Map<string, OwnershipResolution>();
  const filesByNode = new Map<string, string[]>();
  let ownedFileCount = 0;
  let unownedFileCount = 0;
  let multiplyOwnedFileCount = 0;

  for (const path of paths) {
    const candidates = declaring.filter((node) => claims(node, path));
    if (candidates.length === 0) {
      unownedFileCount += 1;
      byPath.set(path, { owners: [], ambiguous: false });
      continue;
    }
    const resolution = resolveCandidates(candidates, parents, depths);
    ownedFileCount += 1;
    if (resolution.ambiguous) multiplyOwnedFileCount += 1;
    byPath.set(path, resolution);
    for (const owner of resolution.owners) {
      const files = filesByNode.get(owner);
      if (files) files.push(path);
      else filesByNode.set(owner, [path]);
    }
  }
  for (const files of filesByNode.values()) files.sort();
  return { byPath, filesByNode, ownedFileCount, unownedFileCount, multiplyOwnedFileCount };
}

/** `source.exclude` is applied before `source.include`: an excluded path is never a candidate. */
function claims(node: NativeNode, path: string): boolean {
  const source = nativeNodeSource(node);
  const include = source?.include ?? [];
  if (include.length === 0) return false;
  if ((source?.exclude ?? []).some((pattern) => matchesGlob(path, pattern))) return false;
  return include.some((pattern) => matchesGlob(path, pattern));
}

function resolveCandidates(
  candidates: NativeNode[],
  parents: Map<string, string | undefined>,
  depths: Map<string, number>
): OwnershipResolution {
  if (candidates.length === 1) return { owners: [candidates[0].id], ambiguous: false };
  const deepest = candidates.reduce((best, node) => {
    const bestDepth = depths.get(best.id) ?? 0;
    const nodeDepth = depths.get(node.id) ?? 0;
    if (nodeDepth !== bestDepth) return nodeDepth > bestDepth ? node : best;
    return node.id < best.id ? node : best;
  });
  // Two distinct nodes at the same depth can never both sit on one chain, so the ancestor-set
  // test below already covers the depth-tie case; it needs no separate branch.
  const chain = ancestorChain(deepest.id, parents);
  if (candidates.every((node) => chain.has(node.id))) return { owners: [deepest.id], ambiguous: false };
  return { owners: candidates.map((node) => node.id).sort(), ambiguous: true };
}

/** The node plus every ancestor reachable through `parent`. A cycle or dangling parent ends the walk. */
function ancestorChain(id: string, parents: Map<string, string | undefined>): Set<string> {
  const chain = new Set<string>();
  let current: string | undefined = id;
  while (current !== undefined && parents.has(current) && !chain.has(current)) {
    chain.add(current);
    current = parents.get(current);
  }
  return chain;
}

function depthOf(id: string, parents: Map<string, string | undefined>): number {
  return ancestorChain(id, parents).size - 1;
}
