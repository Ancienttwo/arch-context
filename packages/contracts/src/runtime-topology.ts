import type { Json } from "./schema";

/** The runtime topology node kinds (ADR-0049). Their kind-specific objects live in the node schema. */
export const RUNTIME_TOPOLOGY_NODE_KINDS = ["process", "namespace", "mount"] as const;
export type RuntimeTopologyNodeKind = (typeof RUNTIME_TOPOLOGY_NODE_KINDS)[number];

export function isRuntimeTopologyNodeKind(kind: unknown): kind is RuntimeTopologyNodeKind {
  return typeof kind === "string" && (RUNTIME_TOPOLOGY_NODE_KINDS as readonly string[]).includes(kind);
}

/** The node kinds each topology relation may connect. Every other relation kind is unconstrained here. */
export const RUNTIME_TOPOLOGY_RELATION_ENDPOINT_KINDS: Readonly<Record<"spawns" | "runs-in" | "mounts", { source: readonly RuntimeTopologyNodeKind[]; target: readonly RuntimeTopologyNodeKind[] }>> = {
  spawns: { source: ["process"], target: ["process"] },
  "runs-in": { source: ["process"], target: ["namespace"] },
  mounts: { source: ["process", "namespace"], target: ["mount"] }
};

export type RuntimeTopologyInvariant =
  | "topology-relation-endpoint-missing"
  | "topology-relation-source-kind-invalid"
  | "topology-relation-target-kind-invalid"
  | "topology-process-namespace-ambiguous"
  | "topology-mount-mounter-ambiguous"
  | "topology-namespace-parent-missing"
  | "topology-namespace-parent-kind-invalid"
  | "topology-namespace-parent-cycle";

export interface RuntimeTopologyIssue {
  /** The node or relation id that carries the problem. */
  entityId: string;
  field: string;
  invariant: RuntimeTopologyInvariant;
}

type TopologyRecord = Readonly<Record<string, Json | undefined>>;

/**
 * Cross-entity rules of the runtime topology (ADR-0049) that a per-file JSON schema cannot state.
 * Native-context validation and the YAML model store both call this one function, and the topology
 * renderer refuses a model it reports on, so `archctx check` and a projection cannot disagree.
 *
 * - `spawns` connects two processes, `runs-in` a process to a namespace, `mounts` a process or a
 *   namespace to a mount. A topology relation whose endpoint names no node is reported here too:
 *   the model store has no other relation reference check, so every caller fails closed.
 * - A process runs in at most one namespace: the innermost one. Outer namespaces come from the
 *   namespace `parent` chain.
 * - A mount is mounted by at most one process or namespace, because a mount node is one entry of
 *   one mount table.
 * - A namespace's `parent`, when present, is another namespace, and the chain has no cycle; it is
 *   the nesting the topology view draws.
 *
 * Records whose id is not a string are skipped: shape validation reports them. Issues come out
 * sorted by entity id, then field and invariant.
 */
export function runtimeTopologyModelIssues(model: { nodes: readonly TopologyRecord[]; relations: readonly TopologyRecord[] }): RuntimeTopologyIssue[] {
  const issues: RuntimeTopologyIssue[] = [];
  const nodesById = new Map<string, TopologyRecord>();
  for (const node of model.nodes) if (typeof node.id === "string") nodesById.set(node.id, node);
  const namespacesByProcess = new Map<string, string[]>();
  const mountersByMount = new Map<string, string[]>();
  for (const relation of model.relations) {
    if (typeof relation.id !== "string" || typeof relation.kind !== "string" || !Object.hasOwn(RUNTIME_TOPOLOGY_RELATION_ENDPOINT_KINDS, relation.kind)) continue;
    const rule = RUNTIME_TOPOLOGY_RELATION_ENDPOINT_KINDS[relation.kind as keyof typeof RUNTIME_TOPOLOGY_RELATION_ENDPOINT_KINDS];
    let endpointsValid = true;
    for (const field of ["source", "target"] as const) {
      const endpoint = relation[field];
      const node = typeof endpoint === "string" ? nodesById.get(endpoint) : undefined;
      if (!node) {
        issues.push({ entityId: relation.id, field, invariant: "topology-relation-endpoint-missing" });
        endpointsValid = false;
      } else if (!(rule[field] as readonly unknown[]).includes(node.kind)) {
        issues.push({ entityId: relation.id, field, invariant: field === "source" ? "topology-relation-source-kind-invalid" : "topology-relation-target-kind-invalid" });
        endpointsValid = false;
      }
    }
    if (!endpointsValid) continue;
    const source = relation.source as string;
    const target = relation.target as string;
    if (relation.kind === "runs-in") namespacesByProcess.set(source, [...(namespacesByProcess.get(source) ?? []), target]);
    if (relation.kind === "mounts") mountersByMount.set(target, [...(mountersByMount.get(target) ?? []), source]);
  }
  for (const [processId, namespaces] of namespacesByProcess) {
    if (new Set(namespaces).size > 1) issues.push({ entityId: processId, field: "runs-in", invariant: "topology-process-namespace-ambiguous" });
  }
  for (const [mountId, mounters] of mountersByMount) {
    if (new Set(mounters).size > 1) issues.push({ entityId: mountId, field: "mounts", invariant: "topology-mount-mounter-ambiguous" });
  }
  for (const [id, node] of nodesById) {
    if (node.kind !== "namespace" || node.parent === undefined) continue;
    const parent = typeof node.parent === "string" ? nodesById.get(node.parent) : undefined;
    if (!parent) {
      issues.push({ entityId: id, field: "parent", invariant: "topology-namespace-parent-missing" });
      continue;
    }
    if (parent.kind !== "namespace") {
      issues.push({ entityId: id, field: "parent", invariant: "topology-namespace-parent-kind-invalid" });
      continue;
    }
    const seen = new Set<string>([id]);
    let cursor: TopologyRecord | undefined = parent;
    while (cursor && cursor.kind === "namespace" && typeof cursor.id === "string") {
      if (seen.has(cursor.id)) {
        issues.push({ entityId: id, field: "parent", invariant: "topology-namespace-parent-cycle" });
        break;
      }
      seen.add(cursor.id);
      cursor = typeof cursor.parent === "string" ? nodesById.get(cursor.parent) : undefined;
    }
  }
  return issues.sort((left, right) => compare(left.entityId, right.entityId) || compare(left.field, right.field) || compare(left.invariant, right.invariant));
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
