import { ARCHITECTURE_HISTORY_MERMAID_SCHEMA_VERSION, type ArchitectureHistory, type HistoryMilestone, type HistoryNode } from "@archcontext/contracts";

export const ARCHITECTURE_HISTORY_PATH = "docs/architecture/history.md";
export const HISTORY_DETAIL_EDGE_LIMIT = 20;
/** The number of most recent milestones `history.md` shows. */
export const ARCHITECTURE_HISTORY_WINDOW = 20;
const capabilityDomain = (id: string | null) => id === null ? null : /^capability\.([a-z0-9]+(?:-[a-z0-9]+)*)\.([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(id)?.[1] ?? null;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function renderHistoryMermaid(milestone: HistoryMilestone, mode: "full" | "changes" = "full"): string | null {
  if (!milestone.nodes) return null;
  const removed = mode === "changes" ? milestone.delta.removed.filter(node => node.kind === "capability") : [];
  const nodes = mode === "changes" ? [...milestone.nodes, ...removed.map(node => ({
    id: node.id,
    name: node.id,
    domain: capabilityDomain(node.id)
  }))].sort((a, b) => compare(a.id, b.id)) : milestone.nodes;
  const keys = new Map(nodes.map((node, index) => [node.id, `n${index}`]));
  const label = (node: HistoryNode) => `  ${keys.get(node.id)}["${node.name.replaceAll('"', "#quot;")}"]`;
  const domains = [...new Set(nodes.flatMap(node => node.domain === null ? [] : [node.domain]))].sort();
  const lines = ["flowchart LR"];
  for (const domain of domains) {
    lines.push(`  subgraph ${JSON.stringify(domain)}`);
    lines.push(...nodes.filter(node => node.domain === domain).map(node => `  ${label(node)}`));
    lines.push("  end");
  }
  lines.push(...nodes.filter(node => node.domain === null).map(label));
  const added = mode === "changes" ? milestone.delta.edgesChanged.added : milestone.edges;
  lines.push(...added.map(edge => `  ${keys.get(edge.source)} --> ${keys.get(edge.target)}`));
  if (mode === "changes") lines.push(...milestone.delta.edgesChanged.removed.map(edge => `  ${keys.get(edge.source)} -.-> ${keys.get(edge.target)}`));
  if (removed.length) {
    lines.push(...removed.map(node => `  class ${keys.get(node.id)} removed`));
    lines.push("  classDef removed stroke-dasharray: 4 4");
  }
  return lines.join("\n");
}

export function renderHistoryDomainOverview(milestone: HistoryMilestone): { mermaid: string; pairCount: number } | null {
  if (!milestone.nodes) return null;
  const counts = new Map<string, number>();
  const ensure = (domain: string) => { if (!counts.has(domain)) counts.set(domain, 0); };
  for (const node of milestone.nodes) {
    const domain = node.domain ?? "ungrouped";
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  const changed = new Set<string>();
  for (const item of [...milestone.delta.added, ...milestone.delta.removed, ...milestone.delta.renamed]) {
    const domain = capabilityDomain(item.capability) ?? "ungrouped";
    ensure(domain); changed.add(domain);
  }
  const pairs = new Map<string, { source: string; target: string; added: number; removed: number }>();
  for (const [kind, edges] of [["added", milestone.delta.edgesChanged.added], ["removed", milestone.delta.edgesChanged.removed]] as const) {
    for (const edge of edges) {
      const source = capabilityDomain(edge.source) ?? "ungrouped", target = capabilityDomain(edge.target) ?? "ungrouped";
      ensure(source); ensure(target); changed.add(source); changed.add(target);
      if (source === target) continue;
      const key = JSON.stringify([source, target]);
      const pair = pairs.get(key) ?? { source, target, added: 0, removed: 0 };
      pair[kind]++; pairs.set(key, pair);
    }
  }
  const domains = [...counts.keys()].sort();
  const keys = new Map(domains.map((domain, index) => [domain, `d${index}`]));
  const lines = ["flowchart LR", ...domains.map(domain => `  ${keys.get(domain)}["${domain} (${counts.get(domain)})"]`)];
  for (const pair of [...pairs.values()].sort((a, b) => compare(a.source, b.source) || compare(a.target, b.target))) {
    const arrow = pair.added === 0 ? "-.->" : "-->";
    lines.push(`  ${keys.get(pair.source)} ${arrow}|+${pair.added} −${pair.removed}| ${keys.get(pair.target)}`);
  }
  if (changed.size) {
    lines.push(...domains.filter(domain => changed.has(domain)).map(domain => `  class ${keys.get(domain)} changed`));
    lines.push("  classDef changed stroke-width:3px");
  }
  return { mermaid: lines.join("\n"), pairCount: pairs.size };
}

export function projectHistoryMermaid(history: ArchitectureHistory) {
  return { schemaVersion: ARCHITECTURE_HISTORY_MERMAID_SCHEMA_VERSION, head: history.head, total: history.total, offset: history.offset, limit: history.limit, diagrams: history.milestones.map(milestone => ({ rev: milestone.rev, mermaid: renderHistoryMermaid(milestone) })) };
}

/** The milestones `history.md` shows: the last `ARCHITECTURE_HISTORY_WINDOW` of a complete history (offset 0, every milestone read). */
export function architectureHistoryWindow(history: ArchitectureHistory): HistoryMilestone[] {
  return history.milestones.slice(-ARCHITECTURE_HISTORY_WINDOW);
}

/** The body of the `architecture-history` target, rendered from a complete history. */
export function renderHistoryMarkdown(history: ArchitectureHistory): string {
  const lines = ["<!-- Generated by ArchContext (archctx history). Do not edit by hand. -->", "", `Architecture history contains ${history.total} milestones. Run \`archctx history\` for the full list.`, ""];
  for (const milestone of architectureHistoryWindow(history).reverse()) {
    lines.push(`## ${milestone.date.slice(0, 10)} · ${milestone.rev.slice(0, 12)}`, "", milestone.subject, "");
    if (milestone.error) lines.push(milestone.error.code, "");
    else {
      const delta = milestone.delta;
      const overview = renderHistoryDomainOverview(milestone)!;
      const edgeCount = delta.edgesChanged.added.length + delta.edgesChanged.removed.length;
      lines.push(`Added ${delta.added.length} · Removed ${delta.removed.length} · Renamed ${delta.renamed.length} · Edges +${delta.edgesChanged.added.length} −${delta.edgesChanged.removed.length}`, "", "```mermaid", overview.mermaid, "```", "");
      if (edgeCount <= HISTORY_DETAIL_EDGE_LIMIT) lines.push("```mermaid", renderHistoryMermaid(milestone, "changes")!, "```", "");
      else lines.push(`${edgeCount} changed edges across ${overview.pairCount} domain pairs; run archctx history --ref ${milestone.rev.slice(0, 12)} --format mermaid for the full shape.`, "");
    }
  }
  return `${lines.join("\n")}\n`;
}
