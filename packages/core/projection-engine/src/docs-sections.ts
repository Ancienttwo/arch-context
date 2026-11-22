import { posix } from "node:path";
import type { ProjectionSliceEntrypointV1 } from "@archcontext/contracts";
import { nativeNodeSource, type NativeModel, type NativeNode, type NativeRelation } from "@archcontext/core/architecture-domain";
import type { SemanticCapabilityDiagramCompilation } from "./semantic-diagrams";
import type { ArchitectureCapabilityScaleV1, ArchitectureDecisionRecord } from "./docs-types";
import { scaleMagnitudeBucketLabel } from "./footprints";

/** Shared §1.2 rows for a module document and its pull request slice. */
export function renderProjectionEntrypoints(node: NativeNode, components: readonly NativeNode[]): {
  entrypoints: ProjectionSliceEntrypointV1[];
  lines: string[];
} {
  const entrypoints: ProjectionSliceEntrypointV1[] = [];
  const rows = (owner: NativeNode, component: boolean) => (nativeNodeSource(owner)?.entrypoints ?? []).flatMap((entry) =>
    entry.symbols.map((symbol) => {
      entrypoints.push({ nodeId: owner.id, entrypointId: entry.id, path: entry.path, symbol: symbol.name });
      const sinks = symbol.sinks.map((sink) => `\`${sink.id}\` → \`${sink.path}#${sink.symbol}\``).join("、");
      const ownerCell = component ? `\`${owner.id}\` | ` : "";
      return `| ${ownerCell}\`${entry.id}\` | \`${entry.path}#${symbol.name}\` | ${sinks} |`;
    })
  );
  const capabilityRows = rows(node, false);
  const componentRows = components.flatMap((component) => rows(component, true));
  const lines = capabilityRows.length > 0
    ? ["| 宣告入口 | 錨點 | 職責 |", "| --- | --- | --- |", ...capabilityRows]
    : ["- 未宣告 `source.entrypoints`,入口清單無法從架構模型推導。"];
  if (components.length > 0) lines.push(
    "",
    "組件入口:",
    "",
    ...(componentRows.length > 0
      ? ["| 組件 | 宣告入口 | 錨點 | 職責 |", "| --- | --- | --- | --- |", ...componentRows]
      : ["- 組件均未宣告 `source.entrypoints`。"])
  );
  return { entrypoints, lines };
}

/** §1.4 addition for a node with components: each component's outbound relations, grouped by component (#299). */
export function renderComponentOutboundRelations(components: readonly NativeNode[], relations: readonly NativeRelation[]): string[] {
  if (components.length === 0) return [];
  return [
    "",
    "組件出向關係:",
    "",
    ...components.flatMap((component) => {
      const outgoing = relations.filter((relation) => relation.source === component.id);
      return [
        `- \`${component.id}\`:`,
        ...(outgoing.length === 0 ? ["  - 無。"] : outgoing.map((relation) => `  - \`${relation.kind}\` → \`${relation.target}\` — ${relation.intent}`))
      ];
    })
  ];
}

/**
 * §1.5 for a node with components: id, name, the 1–2–5 scale buckets of the component's own
 * declared footprint (the same measurement and buckets as §1.3) and its entrypoint ids (#299).
 */
export function renderComponentTable(components: readonly NativeNode[], scaleByNodeId: ReadonlyMap<string, ArchitectureCapabilityScaleV1>): string[] {
  if (components.length === 0) return [];
  return [
    "",
    "### 1.5 組件結構",
    "",
    "| 組件 | 名稱 | 規模量級 | 宣告入口 |",
    "| --- | --- | --- | --- |",
    ...components.map((component) => {
      const source = nativeNodeSource(component);
      let scaleCell = "未宣告 `source.include`";
      if ((source?.include ?? []).length > 0) {
        const scale = scaleByNodeId.get(component.id);
        if (!scale) throw new Error(`architecture-docs-projection-scale-signal-missing: ${component.id}`);
        scaleCell = `\`${scaleMagnitudeBucketLabel(scale.fileCountBucket)}\` 個文件 / \`${scaleMagnitudeBucketLabel(scale.lineCountBucket)}\` 行`;
      }
      const entrypointIds = (source?.entrypoints ?? []).map((entry) => `\`${entry.id}\``);
      return `| \`${component.id}\` | ${component.name.replaceAll("|", "\\|")} | ${scaleCell} | ${entrypointIds.length > 0 ? entrypointIds.join("、") : "未宣告"} |`;
    })
  ];
}

export function renderSemanticP1Section(compilation: SemanticCapabilityDiagramCompilation): string[] {
  if (compilation.p1.status === "proven") {
    return [
      compilation.p1.mermaid!,
      "",
      `- Proof: \`proven\` (\`${compilation.proofDigest}\`).`,
      `- Semantic nodes: \`${compilation.p1.nodes.length}\`; declared relations: \`${compilation.p1.edges.length}\`.`
    ];
  }
  return [
    "> **human-action-required**: P1 semantic authority is unprovable; no diagram was generated.",
    ...compilation.p1.diagnostics.map((diagnostic) => `- \`${diagnostic.code}\`: ${renderDiagnosticDetail(diagnostic.detail)}`)
  ];
}

export function renderSemanticP2Section(compilation: SemanticCapabilityDiagramCompilation): string[] {
  if (compilation.p2.status === "proven") {
    return [
      `> **Proof**: \`proven\` (\`${compilation.proofDigest}\`); selectors \`${compilation.evidenceCoverage.provenSelectors}/${compilation.evidenceCoverage.requiredSelectors}\`.`,
      "",
      ...compilation.p2.mermaid.flatMap((diagram, index) => [
        ...(index === 0 ? [] : [""]),
        diagram
      ])
    ];
  }
  if (compilation.p2.status === "not-applicable") {
    return [`> **not-applicable**: ${compilation.p2.rationale}`];
  }
  return [
    "> **human-action-required**: P2 flow evidence is unprovable; no sequence diagram was generated.",
    ...compilation.p2.diagnostics.map((diagnostic) => `- \`${diagnostic.code}\`: ${renderDiagnosticDetail(diagnostic.detail)}`)
  ];
}

function renderDiagnosticDetail(detail: string): string {
  return detail.replaceAll("\0", " :: ");
}

export function renderRelationSummary(relation: NativeRelation, model: NativeModel): string {
  const source = model.nodes.find((node) => node.id === relation.source);
  const target = model.nodes.find((node) => node.id === relation.target);
  const lines = [
    `# ${relation.source} -> ${relation.target}`,
    "",
    `- ID: \`${relation.id}\``,
    `- Kind: \`${relation.kind}\``,
    `- Source: \`${relation.source}\`${source ? ` (${source.name})` : ""}`,
    `- Target: \`${relation.target}\`${target ? ` (${target.name})` : ""}`,
    `- Intent: ${relation.intent}`
  ];
  return `${lines.join("\n")}\n`;
}

export function renderDecisionIndex(decisions: ArchitectureDecisionRecord[], indexPath: string): string {
  const lines = [
    "# Architecture Decision Index",
    "",
    ...(decisions.length === 0
      ? ["- No ADRs selected for this projection."]
      : decisions.map((decision) => `- [${decision.title}](${posix.relative(posix.dirname(indexPath), decision.path)})${decision.status ? ` — ${decision.status}` : ""}`))
  ];
  return `${lines.join("\n")}\n`;
}
