import { posix } from "node:path";
import {
  digestJson,
  isRuntimeTopologyNodeKind,
  RUNTIME_TOPOLOGY_NODE_KINDS,
  runtimeTopologyModelIssues,
  type Json,
  type ModelExportResult
} from "@archcontext/contracts";
import { nativeNodeSource, type NativeModel, type NativeNode, type NativeRelation } from "@archcontext/core/architecture-domain";
import { RUNTIME_TOPOLOGY_DIAGRAM_PATH } from "./layout";
import { compareStrings, escapeMermaid, mermaidId } from "./exports-dsl";

// --- Runtime topology view (ADR-0049) ---

/** Mirrors `namespace.type` in `schemas/repo/architecture-node.schema.json`. */
const RUNTIME_TOPOLOGY_NAMESPACE_TYPES = ["host", "container", "pod", "kubernetes", "pid", "mount", "net", "user"] as const;
export type RuntimeTopologyNamespaceType = (typeof RUNTIME_TOPOLOGY_NAMESPACE_TYPES)[number];
/** Mirrors `mount.target` in the node schema: an absolute path with no empty segment. */
const RUNTIME_TOPOLOGY_MOUNT_TARGET_PATTERN = /^\/([^/\u0000]+(\/[^/\u0000]+)*)?$/;

export interface RuntimeTopologyNamespace {
  node: NativeNode;
  type: RuntimeTopologyNamespaceType;
  /** The enclosing namespace (`parent`); validation guarantees it is a namespace. */
  parentId?: string;
  /** Directly nested namespaces, sorted by id. */
  namespaceIds: string[];
  /** Processes that `runs-in` this namespace, sorted by id. */
  processIds: string[];
}

export interface RuntimeTopologyProcess {
  node: NativeNode;
  /** The one namespace the process `runs-in`; absent for a process with none. */
  namespaceId?: string;
}

export interface RuntimeTopologyMount {
  node: NativeNode;
  source?: string;
  target: string;
  mode: "ro" | "rw";
  order: number;
}

export interface RuntimeTopologyMountStack {
  /** The process or namespace that `mounts` every mount of the stack. */
  mounterId: string;
  /** Sorted by `mount.order`, then by id. */
  mounts: RuntimeTopologyMount[];
}

/**
 * The one reading of the model both runtime topology renderers draw (ADR-0049), so the Mermaid
 * diagram and the summary page cannot disagree. Every list is sorted by id unless it says otherwise.
 */
export interface RuntimeTopologyView {
  nodesById: ReadonlyMap<string, NativeNode>;
  namespaces: RuntimeTopologyNamespace[];
  /** Namespaces without a parent. */
  rootNamespaceIds: string[];
  processes: RuntimeTopologyProcess[];
  /** One stack per mounting process or namespace, sorted by mounter id. */
  mountStacks: RuntimeTopologyMountStack[];
  /** Mounts no process or namespace mounts. */
  unmountedMounts: RuntimeTopologyMount[];
  spawns: NativeRelation[];
  mounts: NativeRelation[];
  /** `deployed-on` relations whose target is a topology node: the links to the capability view. */
  deployments: NativeRelation[];
  /** The non-topology sources of `deployments`, drawn so those links have both ends. */
  linkedNodes: NativeNode[];
}

/**
 * Reads the runtime topology of `model`. A model the shared cross-entity check
 * (`runtimeTopologyModelIssues`) reports on, or a topology node whose `namespace` or `mount` object
 * is malformed, fails closed instead of rendering a guessed placement.
 */
export function runtimeTopologyView(model: NativeModel): RuntimeTopologyView {
  const issues = runtimeTopologyModelIssues(model);
  if (issues.length > 0) {
    throw new Error(`runtime-topology-model-invalid: ${issues.map((issue) => `${issue.entityId} ${issue.field} ${issue.invariant}`).join("; ")}`);
  }
  const byId = (left: { id: string }, right: { id: string }) => compareStrings(left.id, right.id);
  const nodes = [...model.nodes].sort(byId);
  const relations = [...model.relations].sort(byId);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const namespaces = nodes.filter((node) => node.kind === "namespace").map((node): RuntimeTopologyNamespace => ({
    node,
    type: runtimeTopologyNamespaceType(node),
    ...(typeof node.parent === "string" ? { parentId: node.parent } : {}),
    namespaceIds: [],
    processIds: []
  }));
  const namespaceById = new Map(namespaces.map((namespace) => [namespace.node.id, namespace]));
  for (const namespace of namespaces) {
    if (namespace.parentId !== undefined) namespaceById.get(namespace.parentId)!.namespaceIds.push(namespace.node.id);
  }
  const namespaceByProcessId = new Map(relations.filter((relation) => relation.kind === "runs-in").map((relation) => [relation.source, relation.target]));
  const processes = nodes.filter((node) => node.kind === "process").map((node): RuntimeTopologyProcess => {
    const namespaceId = namespaceByProcessId.get(node.id);
    return namespaceId === undefined ? { node } : { node, namespaceId };
  });
  for (const topologyProcess of processes) {
    if (topologyProcess.namespaceId !== undefined) namespaceById.get(topologyProcess.namespaceId)!.processIds.push(topologyProcess.node.id);
  }
  const mounts = nodes.filter((node) => node.kind === "mount").map(runtimeTopologyMount);
  const mounterByMountId = new Map(relations.filter((relation) => relation.kind === "mounts").map((relation) => [relation.target, relation.source]));
  const stacksByMounterId = new Map<string, RuntimeTopologyMount[]>();
  for (const mount of mounts) {
    const mounterId = mounterByMountId.get(mount.node.id);
    if (mounterId === undefined) continue;
    stacksByMounterId.set(mounterId, [...(stacksByMounterId.get(mounterId) ?? []), mount]);
  }
  const mountStacks = [...stacksByMounterId.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([mounterId, stack]) => ({
      mounterId,
      mounts: stack.sort((left, right) => left.order - right.order || compareStrings(left.node.id, right.node.id))
    }));
  const deployments = relations.filter((relation) => relation.kind === "deployed-on" && isRuntimeTopologyNodeKind(nodesById.get(relation.target)?.kind));
  const linkedNodeIds = new Set<string>();
  for (const relation of deployments) {
    const source = nodesById.get(relation.source);
    if (!source) throw new Error(`runtime-topology-relation-endpoint-missing: ${relation.id} (${relation.source})`);
    if (!isRuntimeTopologyNodeKind(source.kind)) linkedNodeIds.add(source.id);
  }
  return {
    nodesById,
    namespaces,
    rootNamespaceIds: namespaces.filter((namespace) => namespace.parentId === undefined).map((namespace) => namespace.node.id),
    processes,
    mountStacks,
    unmountedMounts: mounts.filter((mount) => !mounterByMountId.has(mount.node.id)),
    spawns: relations.filter((relation) => relation.kind === "spawns"),
    mounts: relations.filter((relation) => relation.kind === "mounts"),
    deployments,
    linkedNodes: nodes.filter((node) => linkedNodeIds.has(node.id))
  };
}

function runtimeTopologyNamespaceType(node: NativeNode): RuntimeTopologyNamespaceType {
  const value = node.namespace;
  const type = value !== null && typeof value === "object" && !Array.isArray(value) ? value.type : undefined;
  if (typeof type !== "string" || !(RUNTIME_TOPOLOGY_NAMESPACE_TYPES as readonly string[]).includes(type)) {
    throw new Error(`runtime-topology-namespace-invalid: ${node.id}`);
  }
  return type as RuntimeTopologyNamespaceType;
}

function runtimeTopologyMount(node: NativeNode): RuntimeTopologyMount {
  const value = node.mount;
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`runtime-topology-mount-invalid: ${node.id}`);
  const { source, target, mode, order } = value;
  if ((source !== undefined && (typeof source !== "string" || source === ""))
    || typeof target !== "string" || !RUNTIME_TOPOLOGY_MOUNT_TARGET_PATTERN.test(target)
    || (mode !== "ro" && mode !== "rw")
    || typeof order !== "number" || !Number.isInteger(order) || order < 0) {
    throw new Error(`runtime-topology-mount-invalid: ${node.id}`);
  }
  return { node, ...(source === undefined ? {} : { source: source as string }), target, mode, order };
}

/** Mermaid id of a mount stack subgraph. `mermaidId` output never contains `__`, so it cannot collide with a node id. */
function runtimeTopologyMountStackId(mounterId: string): string {
  return `mounts__${mermaidId(mounterId)}`;
}

/** No leading `<n>.`: Mermaid reads a label that starts like a numbered list as unsupported Markdown. */
function runtimeTopologyMountLabel(mount: RuntimeTopologyMount): string {
  return `${mount.node.name} (${mount.target}, ${mount.mode}, order ${mount.order})`;
}

/**
 * The runtime topology diagram (ADR-0049): a `flowchart` whose namespaces are nested subgraphs
 * holding the processes that run in them, with one ordered stack subgraph per mounting process or
 * namespace, then `spawns`, `mounts` and topology `deployed-on` edges. Invisible links keep each
 * stack in mount order. The same model always renders the same bytes.
 */
export function exportRuntimeTopologyMermaid(model: NativeModel): ModelExportResult {
  const view = runtimeTopologyView(model);
  const namespaceById = new Map(view.namespaces.map((namespace) => [namespace.node.id, namespace]));
  const nodeLine = (indent: string, node: NativeNode, label: string = node.name) => `${indent}${mermaidId(node.id)}["${escapeMermaid(label)}"]`;
  const lines = ["%% Generated by ArchContext. Native model remains source of truth.", "flowchart TB"];
  const pushNamespace = (namespaceId: string, depth: number) => {
    const namespace = namespaceById.get(namespaceId)!;
    const indent = "  ".repeat(depth);
    lines.push(`${indent}subgraph ${mermaidId(namespaceId)}["${escapeMermaid(`${namespace.node.name} (${namespace.type})`)}"]`);
    for (const processId of namespace.processIds) lines.push(nodeLine(`${indent}  `, view.nodesById.get(processId)!));
    for (const childId of namespace.namespaceIds) pushNamespace(childId, depth + 1);
    lines.push(`${indent}end`);
  };
  for (const namespaceId of view.rootNamespaceIds) pushNamespace(namespaceId, 1);
  for (const topologyProcess of view.processes) if (topologyProcess.namespaceId === undefined) lines.push(nodeLine("  ", topologyProcess.node));
  for (const stack of view.mountStacks) {
    const mounter = view.nodesById.get(stack.mounterId)!;
    lines.push(`  subgraph ${runtimeTopologyMountStackId(stack.mounterId)}["${escapeMermaid(`Mounts: ${mounter.name}`)}"]`, "    direction TB");
    for (const mount of stack.mounts) lines.push(nodeLine("    ", mount.node, runtimeTopologyMountLabel(mount)));
    for (let index = 1; index < stack.mounts.length; index += 1) {
      lines.push(`    ${mermaidId(stack.mounts[index - 1]!.node.id)} ~~~ ${mermaidId(stack.mounts[index]!.node.id)}`);
    }
    lines.push("  end");
  }
  for (const mount of view.unmountedMounts) lines.push(nodeLine("  ", mount.node, runtimeTopologyMountLabel(mount)));
  for (const node of view.linkedNodes) lines.push(nodeLine("  ", node));
  for (const relation of [...view.spawns, ...view.mounts, ...view.deployments].sort((left, right) => compareStrings(left.id, right.id))) {
    lines.push(`  ${mermaidId(relation.source)} -->|"${escapeMermaid(relation.kind)}"| ${mermaidId(relation.target)}`);
  }
  const content = `${lines.join("\n")}\n`;
  return {
    format: "mermaid",
    digest: digestJson({ format: "mermaid", content } as unknown as Json),
    files: [{ path: RUNTIME_TOPOLOGY_DIAGRAM_PATH, content }]
  };
}

/**
 * The runtime topology summary page (ADR-0049): namespaces with their type, the processes in each,
 * every mount stack in order, the `spawns` and `deployed-on` links, and each topology node's source
 * anchors (the `source.include` patterns a reader checks by hand; no command reports a change to
 * those files, because topology rows carry no source digest, ADR-0056 §7). It links the
 * diagram the way the architecture index links the other diagrams.
 */
export function renderRuntimeTopologySummary(model: NativeModel, summaryPath: string): string {
  const view = runtimeTopologyView(model);
  const cell = (value: string) => value.replaceAll("|", "\\|");
  const named = (id: string) => {
    const node = view.nodesById.get(id);
    return `\`${id}\`${node ? ` ${cell(node.name)}` : ""}`;
  };
  const list = (ids: readonly string[]) => ids.length === 0 ? "none" : ids.map((id) => `\`${id}\``).join(", ");
  const lines = [
    "# Runtime Topology",
    "",
    "The architecture model declares this topology. No code facts verify it: archctx never reads the configuration it describes. Each node lists its `source.include` patterns for a reader to check; no command reports a change to those files.",
    "",
    `- Diagram: [Mermaid](${posix.relative(posix.dirname(summaryPath), RUNTIME_TOPOLOGY_DIAGRAM_PATH)})`,
    "",
    "## Namespaces",
    ""
  ];
  if (view.namespaces.length === 0) lines.push("- No namespaces recorded.");
  else {
    lines.push("| Namespace | Type | Parent | Namespaces | Processes |", "| --- | --- | --- | --- | --- |");
    for (const namespace of view.namespaces) {
      lines.push(`| ${named(namespace.node.id)} | ${namespace.type} | ${namespace.parentId === undefined ? "none" : `\`${namespace.parentId}\``} | ${list(namespace.namespaceIds)} | ${list(namespace.processIds)} |`);
    }
  }
  lines.push("", "## Processes", "");
  if (view.processes.length === 0) lines.push("- No processes recorded.");
  else {
    lines.push("| Process | Namespace | Spawns | Deployed here |", "| --- | --- | --- | --- |");
    for (const topologyProcess of view.processes) {
      const id = topologyProcess.node.id;
      const spawned = view.spawns.filter((relation) => relation.source === id).map((relation) => relation.target);
      const deployed = view.deployments.filter((relation) => relation.target === id).map((relation) => relation.source);
      lines.push(`| ${named(id)} | ${topologyProcess.namespaceId === undefined ? "none" : `\`${topologyProcess.namespaceId}\``} | ${list([...new Set(spawned)].sort(compareStrings))} | ${list([...new Set(deployed)].sort(compareStrings))} |`);
    }
  }
  lines.push("", "## Mount Stacks", "");
  const mountRows = (stack: readonly RuntimeTopologyMount[]) => [
    "| Order | Mount | Source | Target | Mode |",
    "| --- | --- | --- | --- | --- |",
    ...stack.map((mount) => `| ${mount.order} | ${named(mount.node.id)} | ${mount.source === undefined ? "none" : `\`${cell(mount.source)}\``} | \`${cell(mount.target)}\` | ${mount.mode} |`)
  ];
  if (view.mountStacks.length === 0 && view.unmountedMounts.length === 0) lines.push("- No mounts recorded.");
  for (const [index, stack] of view.mountStacks.entries()) {
    if (index > 0) lines.push("");
    lines.push(`### ${named(stack.mounterId)}`, "", ...mountRows(stack.mounts));
  }
  if (view.unmountedMounts.length > 0) {
    if (view.mountStacks.length > 0) lines.push("");
    lines.push("### Not mounted", "", ...mountRows(view.unmountedMounts));
  }
  const otherDeployments = view.deployments.filter((relation) => view.nodesById.get(relation.target)?.kind !== "process");
  if (otherDeployments.length > 0) {
    lines.push("", "## Other Deployments", "");
    for (const relation of otherDeployments) lines.push(`- \`${relation.source}\` -> \`${relation.target}\` — ${relation.intent}`);
  }
  lines.push("", "## Source Anchors", "", "| Node | Source |", "| --- | --- |");
  for (const node of [...view.nodesById.values()].filter((entry) => isRuntimeTopologyNodeKind(entry.kind)).sort((left, right) => compareStrings(left.id, right.id))) {
    const include = nativeNodeSource(node)?.include ?? [];
    lines.push(`| ${named(node.id)} | ${include.length === 0 ? "model-authored, no source anchor" : include.map((pattern) => `\`${cell(pattern)}\``).join(", ")} |`);
  }
  return `${lines.join("\n")}\n`;
}
