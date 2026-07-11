import type {
  ExplorerOccurrenceV2,
  ExplorerProjectionV2,
  ExplorerRelationOccurrenceV2,
  ExplorerSubjectOccurrenceV2
} from "@archcontext/contracts";

export interface RenderExplorerTopologyInput {
  projection: ExplorerProjectionV2;
  focusSubjectId?: string | null;
}

export interface ExplorerTopologyNodePlan {
  occurrenceId: string;
  subjectId: string | null;
  name: string;
  kind: string;
  verificationStatus: string;
  authorityState: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visualRole: "group" | "subject";
}

export interface ExplorerTopologyEdgePlan {
  occurrenceId: string;
  sourceOccurrenceId: string;
  targetOccurrenceId: string;
  kind: string;
  verificationStatus: string;
  points: Array<{ x: number; y: number }>;
  selfLoop: boolean;
}

export interface ExplorerTopologyRenderPlan {
  mode: "overview-groups" | "context-bands" | "detail-focus";
  width: number;
  height: number;
  nodes: ExplorerTopologyNodePlan[];
  edges: ExplorerTopologyEdgePlan[];
  omitted: { nodes: number; relations: number };
  metrics: { indexedOccurrences: number; indexedRelations: number };
}

export interface ExplorerTopologyRenderResult {
  plan: ExplorerTopologyRenderPlan;
  svg: string;
}

const NODE_WIDTH = 188;
const NODE_HEIGHT = 68;
const GROUP_WIDTH = 210;
const GROUP_HEIGHT = 76;
const GAP_X = 56;
const GAP_Y = 54;
const PADDING = 38;

export function renderExplorerTopology(input: RenderExplorerTopologyInput): ExplorerTopologyRenderResult {
  const occurrences = canonicalize(input.projection.occurrences, compareOccurrence);
  const relations = canonicalize(input.projection.relations, (left, right) => left.occurrenceId.localeCompare(right.occurrenceId));
  const byOccurrence = new Map(occurrences.map((occurrence) => [occurrence.occurrenceId, occurrence] as const));
  const incoming = new Map<string, ExplorerRelationOccurrenceV2[]>();
  const outgoing = new Map<string, ExplorerRelationOccurrenceV2[]>();

  for (const relation of relations) {
    if (!byOccurrence.has(relation.sourceOccurrenceId) || !byOccurrence.has(relation.targetOccurrenceId)) {
      throw new Error(`explorer-topology-missing-endpoint:${relation.occurrenceId}`);
    }
    append(outgoing, relation.sourceOccurrenceId, relation);
    append(incoming, relation.targetOccurrenceId, relation);
  }

  const mode = topologyMode(input.projection.semanticLevel);
  const layout = mode === "overview-groups"
    ? layoutOverview(occurrences)
    : mode === "detail-focus"
      ? layoutDetail(occurrences, relations, byOccurrence, input.focusSubjectId)
      : layoutContext(occurrences);
  const nodesById = new Map(layout.nodes.map((node) => [node.occurrenceId, node] as const));
  const edges = layoutEdges(relations, nodesById);
  const indexedIncoming = [...incoming.values()].reduce((count, items) => count + items.length, 0);
  const indexedOutgoing = [...outgoing.values()].reduce((count, items) => count + items.length, 0);
  if (indexedIncoming !== indexedOutgoing) throw new Error("explorer-topology-adjacency-index-mismatch");
  const plan = freezePlan({
    mode,
    width: layout.width,
    height: layout.height,
    nodes: layout.nodes,
    edges,
    omitted: {
      nodes: input.projection.page.omittedNodeCount,
      relations: input.projection.page.omittedRelationCount
    },
    metrics: {
      indexedOccurrences: byOccurrence.size,
      indexedRelations: indexedIncoming
    }
  });
  return Object.freeze({ plan, svg: renderSvg(plan) });
}

function topologyMode(level: ExplorerProjectionV2["semanticLevel"]): ExplorerTopologyRenderPlan["mode"] {
  if (level === "overview") return "overview-groups";
  if (level === "detail") return "detail-focus";
  return "context-bands";
}

function layoutOverview(occurrences: ExplorerOccurrenceV2[]): { nodes: ExplorerTopologyNodePlan[]; width: number; height: number } {
  const childrenByParent = new Map<string, ExplorerOccurrenceV2[]>();
  const groups: ExplorerOccurrenceV2[] = [];
  const groupIds = new Set<string>();
  const ungrouped: ExplorerOccurrenceV2[] = [];
  for (const occurrence of occurrences) {
    if (occurrence.role === "derived-group") {
      groups.push(occurrence);
      groupIds.add(occurrence.occurrenceId);
    }
    else if (occurrence.parentOccurrenceId) append(childrenByParent, occurrence.parentOccurrenceId, occurrence);
    else ungrouped.push(occurrence);
  }

  const nodes: ExplorerTopologyNodePlan[] = [];
  let y = PADDING;
  for (const group of groups) {
    const children = childrenByParent.get(group.occurrenceId) ?? [];
    const columns = Math.min(2, Math.max(1, children.length));
    const rows = Math.ceil(children.length / columns);
    const groupPlan = nodePlan(group, PADDING, y, true);
    groupPlan.width = children.length === 0 ? GROUP_WIDTH : 36 + columns * NODE_WIDTH + Math.max(0, columns - 1) * 18;
    groupPlan.height = children.length === 0 ? GROUP_HEIGHT : 70 + rows * NODE_HEIGHT + Math.max(0, rows - 1) * 18;
    nodes.push(groupPlan);
    children.forEach((child, index) => nodes.push(nodePlan(
      child,
      PADDING + 18 + (index % columns) * (NODE_WIDTH + 18),
      y + 52 + Math.floor(index / columns) * (NODE_HEIGHT + 18),
      false
    )));
    y += groupPlan.height + GAP_Y;
  }

  const orphanedChildren = [...childrenByParent.entries()]
    .filter(([parent]) => !groupIds.has(parent))
    .flatMap(([, children]) => children);
  const overflow = [...ungrouped, ...orphanedChildren].sort(compareOccurrence);
  overflow.forEach((occurrence, index) => nodes.push(nodePlan(
    occurrence,
    PADDING + (index % 4) * (NODE_WIDTH + GAP_X),
    y + Math.floor(index / 4) * (NODE_HEIGHT + GAP_Y),
    false
  )));
  return dimensions(nodes);
}

function layoutContext(occurrences: ExplorerOccurrenceV2[]): { nodes: ExplorerTopologyNodePlan[]; width: number; height: number } {
  const bandOrder = ["VERIFIED", "MATCHED", "DRIFT", "UNKNOWN", "DERIVED"];
  const grouped = new Map<string, ExplorerOccurrenceV2[]>();
  for (const occurrence of occurrences) {
    const key = occurrence.role === "derived-group" ? "DERIVED" : occurrence.verificationStatus;
    append(grouped, key, occurrence);
  }

  const nodes: ExplorerTopologyNodePlan[] = [];
  let y = PADDING + 24;
  let widest = 1;
  for (const status of bandOrder) {
    const items = grouped.get(status) ?? [];
    if (items.length === 0) continue;
    const columns = Math.min(8, items.length);
    widest = Math.max(widest, columns);
    for (let index = 0; index < items.length; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      nodes.push(nodePlan(items[index], PADDING + column * (NODE_WIDTH + GAP_X), y + row * (NODE_HEIGHT + GAP_Y), false));
    }
    y += Math.ceil(items.length / columns) * (NODE_HEIGHT + GAP_Y) + 42;
  }
  const result = dimensions(nodes);
  return { ...result, width: Math.max(result.width, PADDING * 2 + widest * NODE_WIDTH + Math.max(0, widest - 1) * GAP_X) };
}

function layoutDetail(
  occurrences: ExplorerOccurrenceV2[],
  relations: ExplorerRelationOccurrenceV2[],
  byOccurrence: Map<string, ExplorerOccurrenceV2>,
  focusSubjectId?: string | null
): { nodes: ExplorerTopologyNodePlan[]; width: number; height: number } {
  const subjects = occurrences.filter((occurrence): occurrence is ExplorerSubjectOccurrenceV2 => occurrence.role === "subject");
  const focus = subjects.find((subject) => subjectId(subject) === focusSubjectId) ?? subjects[0];
  if (!focus) return layoutOverview(occurrences);

  const upstreamIds = new Set(relations.filter((relation) => relation.targetOccurrenceId === focus.occurrenceId).map((relation) => relation.sourceOccurrenceId));
  const downstreamIds = new Set(relations.filter((relation) => relation.sourceOccurrenceId === focus.occurrenceId).map((relation) => relation.targetOccurrenceId));
  upstreamIds.delete(focus.occurrenceId);
  downstreamIds.delete(focus.occurrenceId);
  const upstream = [...upstreamIds].sort().map((id) => byOccurrence.get(id)!);
  const downstream = [...downstreamIds].sort().map((id) => byOccurrence.get(id)!);
  const placed = new Set([focus.occurrenceId, ...upstreamIds, ...downstreamIds]);
  const overflow = occurrences.filter((occurrence) => !placed.has(occurrence.occurrenceId));
  const rows = Math.max(1, upstream.length, downstream.length);
  const centerX = PADDING + NODE_WIDTH + 150;
  const centerY = PADDING + Math.floor(rows / 2) * (NODE_HEIGHT + GAP_Y);
  const nodes: ExplorerTopologyNodePlan[] = [nodePlan(focus, centerX, centerY, false)];

  upstream.forEach((occurrence, index) => nodes.push(nodePlan(occurrence, PADDING, PADDING + index * (NODE_HEIGHT + GAP_Y), false)));
  downstream.forEach((occurrence, index) => nodes.push(nodePlan(occurrence, centerX + NODE_WIDTH + 150, PADDING + index * (NODE_HEIGHT + GAP_Y), false)));
  const overflowY = PADDING + rows * (NODE_HEIGHT + GAP_Y) + 78;
  overflow.forEach((occurrence, index) => nodes.push(nodePlan(
    occurrence,
    PADDING + (index % 6) * (NODE_WIDTH + GAP_X),
    overflowY + Math.floor(index / 6) * (NODE_HEIGHT + GAP_Y),
    false
  )));
  return dimensions(nodes);
}

function nodePlan(occurrence: ExplorerOccurrenceV2, x: number, y: number, overview: boolean): ExplorerTopologyNodePlan {
  const group = occurrence.role === "derived-group";
  return {
    occurrenceId: occurrence.occurrenceId,
    subjectId: group ? null : subjectId(occurrence),
    name: occurrence.name,
    kind: occurrence.kind,
    verificationStatus: occurrence.verificationStatus,
    authorityState: occurrence.authorityState,
    x: Math.round(x),
    y: Math.round(y),
    width: overview || group ? GROUP_WIDTH : NODE_WIDTH,
    height: overview || group ? GROUP_HEIGHT : NODE_HEIGHT,
    visualRole: group ? "group" : "subject"
  };
}

function dimensions(nodes: ExplorerTopologyNodePlan[]): { nodes: ExplorerTopologyNodePlan[]; width: number; height: number } {
  const width = nodes.length === 0 ? 640 : Math.max(...nodes.map((node) => node.x + node.width)) + PADDING;
  const height = nodes.length === 0 ? 220 : Math.max(...nodes.map((node) => node.y + node.height)) + PADDING;
  return { nodes, width: Math.max(640, width), height: Math.max(220, height) };
}

function layoutEdges(
  relations: ExplorerRelationOccurrenceV2[],
  nodesById: Map<string, ExplorerTopologyNodePlan>
): ExplorerTopologyEdgePlan[] {
  const parallelIndex = new Map<string, number>();
  return relations.map((relation) => {
    const source = nodesById.get(relation.sourceOccurrenceId);
    const target = nodesById.get(relation.targetOccurrenceId);
    if (!source || !target) throw new Error(`explorer-topology-unplaced-endpoint:${relation.occurrenceId}`);
    const key = `${relation.sourceOccurrenceId}\u0000${relation.targetOccurrenceId}`;
    const parallel = parallelIndex.get(key) ?? 0;
    parallelIndex.set(key, parallel + 1);
    const offset = parallel === 0 ? 0 : Math.ceil(parallel / 2) * (parallel % 2 === 0 ? -12 : 12);
    const sourceCenter = center(source);
    const targetCenter = center(target);
    const selfLoop = source.occurrenceId === target.occurrenceId;
    const points = selfLoop
      ? [
          { x: source.x + source.width, y: source.y + Math.round(source.height / 2) },
          { x: source.x + source.width + 34 + Math.abs(offset), y: source.y - 24 - Math.abs(offset) },
          { x: source.x + Math.round(source.width / 2), y: source.y - 34 - Math.abs(offset) },
          { x: source.x + Math.round(source.width / 2), y: source.y }
        ]
      : [
          sourceCenter,
          { x: Math.round((sourceCenter.x + targetCenter.x) / 2), y: Math.round((sourceCenter.y + targetCenter.y) / 2) + offset },
          targetCenter
        ];
    return {
      occurrenceId: relation.occurrenceId,
      sourceOccurrenceId: relation.sourceOccurrenceId,
      targetOccurrenceId: relation.targetOccurrenceId,
      kind: relation.kind,
      verificationStatus: relation.verificationStatus,
      points,
      selfLoop
    };
  });
}

function renderSvg(plan: ExplorerTopologyRenderPlan): string {
  const bands = renderBands(plan);
  const edges = plan.edges.map((edge) => {
    const points = edge.points.map((point) => `${point.x},${point.y}`).join(" ");
    const labelPoint = edge.points[Math.floor(edge.points.length / 2)];
    const dash = edge.verificationStatus === "DRIFT" ? ` stroke-dasharray="6 4"` : "";
    return `<g class="topology-edge" data-relation-occurrence="${escapeXml(edge.occurrenceId)}"><title>${escapeXml(`${edge.kind}: ${edge.sourceOccurrenceId} -> ${edge.targetOccurrenceId}`)}</title><polyline points="${points}" fill="none" marker-end="url(#topology-arrow)"${dash}/><text x="${labelPoint.x}" y="${labelPoint.y - 7}" text-anchor="middle">${escapeXml(edge.kind)}</text></g>`;
  }).join("");
  const nodes = plan.nodes.map((node) => {
    const label = truncateLabel(node.name, 26);
    const focus = node.subjectId ? ` data-focus="${escapeXml(node.subjectId)}" tabindex="0"` : "";
    const role = node.visualRole === "group" ? "group" : `status-${node.verificationStatus.toLowerCase()}`;
    return `<g class="topology-node ${role}" data-occurrence="${escapeXml(node.occurrenceId)}"${focus} aria-label="${escapeXml(`${node.name}, ${node.kind}, ${node.verificationStatus}, ${node.authorityState}`)}"><title>${escapeXml(node.name)}</title><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="9"/><text class="topology-name" x="${node.x + 14}" y="${node.y + 27}">${escapeXml(label)}</text><text class="topology-meta" x="${node.x + 14}" y="${node.y + 48}">${escapeXml(`${node.kind} · ${node.authorityState}`)}</text></g>`;
  }).join("");
  const empty = plan.nodes.length === 0 ? `<text class="topology-empty" x="${Math.round(plan.width / 2)}" y="${Math.round(plan.height / 2)}" text-anchor="middle">No occurrences in this bounded projection.</text>` : "";
  return `<div class="topology" data-topology-mode="${plan.mode}"><svg class="topology-svg" viewBox="0 0 ${plan.width} ${plan.height}" width="100%" role="img" aria-label="Bounded architecture topology"><defs><marker id="topology-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z"/></marker></defs><g data-topology-viewport transform="translate(0 0) scale(1)"><g class="topology-bands">${bands}</g><g class="topology-edges">${edges}</g><g class="topology-nodes">${nodes}</g>${empty}</g></svg></div>`;
}

function renderBands(plan: ExplorerTopologyRenderPlan): string {
  if (plan.mode !== "context-bands") return "";
  const groups = new Map<string, ExplorerTopologyNodePlan[]>();
  for (const node of plan.nodes) append(groups, node.visualRole === "group" ? "DERIVED" : node.verificationStatus, node);
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([status, nodes]) => {
    const top = Math.min(...nodes.map((node) => node.y)) - 24;
    const bottom = Math.max(...nodes.map((node) => node.y + node.height)) + 18;
    return `<g class="topology-band status-${status.toLowerCase()}" data-topology-band="${escapeXml(status)}"><rect x="16" y="${top}" width="${Math.max(0, plan.width - 32)}" height="${bottom - top}" rx="10"/><text x="26" y="${top + 17}">${escapeXml(status)}</text></g>`;
  }).join("");
}

function subjectId(subject: ExplorerSubjectOccurrenceV2): string | null {
  return subject.subjectRefs.find((ref) => ref.kind === "architecture-entity")?.id ?? subject.subjectRefs[0]?.id ?? null;
}

function center(node: ExplorerTopologyNodePlan): { x: number; y: number } {
  return { x: node.x + Math.round(node.width / 2), y: node.y + Math.round(node.height / 2) };
}

function compareOccurrence(left: ExplorerOccurrenceV2, right: ExplorerOccurrenceV2): number {
  return left.occurrenceId.localeCompare(right.occurrenceId);
}

function canonicalize<T>(items: T[], compare: (left: T, right: T) => number): T[] {
  for (let index = 1; index < items.length; index += 1) {
    if (compare(items[index - 1], items[index]) > 0) return [...items].sort(compare);
  }
  return [...items];
}

function append<T>(map: Map<string, T[]>, key: string, item: T): void {
  const current = map.get(key);
  if (current) current.push(item);
  else map.set(key, [item]);
}

function truncateLabel(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function freezePlan(plan: ExplorerTopologyRenderPlan): ExplorerTopologyRenderPlan {
  for (const node of plan.nodes) Object.freeze(node);
  for (const edge of plan.edges) {
    for (const point of edge.points) Object.freeze(point);
    Object.freeze(edge.points);
    Object.freeze(edge);
  }
  Object.freeze(plan.nodes);
  Object.freeze(plan.edges);
  Object.freeze(plan.omitted);
  Object.freeze(plan.metrics);
  return Object.freeze(plan);
}
