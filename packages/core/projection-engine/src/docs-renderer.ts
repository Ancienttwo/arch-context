import { basename } from "node:path";
import {
  ARCHITECTURE_DOCS_PROJECTION_MANIFEST_SCHEMA_VERSION,
  PROJECTION_TARGET_SCHEMA_VERSION,
  type ProjectionTargetV1,
  type ArchitectureHistory,
  type StateMachineV1
} from "@archcontext/contracts";
import { ancestorChain, nativeNodeSource, nodeSubtreeIds, type NativeModel, type NativeNode } from "@archcontext/core/architecture-domain";
import { renderHistoryMarkdown } from "./architecture-history";
import {
  REPO_HARNESS_PROJECTION_PROFILE,
  RUNTIME_TOPOLOGY_DIAGRAM_PATH,
  contractFilesForNode,
  type ArchitectureDocumentationLayout,
  type ProjectionLayoutTargetDraft
} from "./layout";
import type { SemanticCapabilityDiagramCompilation } from "./semantic-diagrams";
import { renderStateMachineSection } from "./state-machine-diagrams";
import {
  renderComponentOutboundRelations,
  renderComponentTable,
  renderDecisionIndex,
  renderProjectionEntrypoints,
  renderRelationSummary,
  renderSemanticP1Section,
  renderSemanticP2Section
} from "./docs-sections";
import {
  ARCHITECTURE_DOCS_GENERATED_BEGIN_PREFIX,
  ARCHITECTURE_DOCS_GENERATED_END_PREFIX,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  type ArchitectureCapabilityScaleV1,
  type ArchitectureDecisionRecord,
  type ArchitectureDocsLanguage,
  type CapabilitySourceScaleSignal
} from "./docs-types";
import { exportDocumentationLikeC4Model, exportDocumentationStructurizrWorkspace, exportMermaidModel, pathSegment } from "./exports-dsl";
import { scaleMagnitudeBucketLabel } from "./footprints";
import { entitySummarySkeleton, generatedEndMarker, generatedStartMarker } from "./regions";
import { exportRuntimeTopologyMermaid, renderRuntimeTopologySummary } from "./runtime-topology";

export interface ProjectionTargetDraft extends ProjectionLayoutTargetDraft {
  /**
   * Human-owned scaffold written only when the target file does not exist yet. The projection
   * never rewrites it afterwards: the title and the §3/§4/Backlog headings live outside the
   * generated region, so every later projection splices the region and leaves them untouched.
   */
  skeleton?: { prefix: string; suffix: string };
}

export function architectureDocumentationTargetDrafts(
  model: NativeModel,
  layout: ArchitectureDocumentationLayout,
  docsLanguage: ArchitectureDocsLanguage | undefined
): ProjectionTargetDraft[] {
  return layout.targets.map((target) => target.type === "entity-summary"
    ? { ...target, skeleton: entitySummarySkeleton(model.nodes.find((node) => node.id === target.scope.id)!, docsLanguage) }
    : target);
}

export function projectionTarget(input: ProjectionTargetDraft & {
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  sourceDigest: string;
  outputDigest: string;
}): ProjectionTargetV1 {
  const common = {
    schemaVersion: PROJECTION_TARGET_SCHEMA_VERSION,
    targetId: input.targetId,
    type: input.type,
    scope: input.scope,
    path: input.path,
    rendererVersion: input.rendererVersion,
    format: input.format,
    sourceDigest: input.sourceDigest,
    outputDigest: input.outputDigest
  };
  if (input.ownership === "generated") return { ...common, ownership: "generated" };
  return {
    ...common,
    ownership: "mixed",
    generatedRegion: {
      startMarker: generatedStartMarker(input.targetId, input.rendererVersion, input.outputDigest),
      endMarker: generatedEndMarker(input.targetId)
    }
  };
}

export function renderTargetGeneratedBody(
  target: ProjectionTargetDraft,
  model: NativeModel,
  input: {
    scaleSignalsByNodeId: Map<string, CapabilitySourceScaleSignal>;
    scaleByNodeId: Map<string, ArchitectureCapabilityScaleV1>;
    semanticCompilationsByNodeId: Map<string, SemanticCapabilityDiagramCompilation>;
    stateMachines: readonly StateMachineV1[];
    decisions: ArchitectureDecisionRecord[];
    architectureHistory: ArchitectureHistory | undefined;
    layout: ArchitectureDocumentationLayout;
  }
): string {
  if (target.type === "architecture-index") return renderArchitectureIndex(model, input.layout);
  if (target.type === "entity-summary") {
    const node = model.nodes.find((entry) => entry.id === target.scope.id)!;
    return renderEntitySummary(node, model, {
      scaleSignal: input.scaleSignalsByNodeId.get(node.id),
      scale: input.scaleByNodeId.get(node.id),
      scaleByNodeId: input.scaleByNodeId,
      semanticCompilation: input.semanticCompilationsByNodeId.get(node.id)!,
      stateMachines: input.stateMachines.filter((machine) => machine.capabilityId === node.id)
    });
  }
  if (target.type === "relation-summary") return renderRelationSummary(model.relations.find((relation) => relation.id === target.scope.id)!, model);
  if (target.type === "decision-index") return renderDecisionIndex(input.decisions, target.path);
  if (target.type === "diagram-mermaid") return exportMermaidModel(model).files[0].content;
  if (target.type === "diagram-structurizr") return exportDocumentationStructurizrWorkspace(model).files[0].content;
  if (target.type === "diagram-likec4") return exportDocumentationLikeC4Model(model).files[0].content;
  if (target.type === "diagram-runtime-topology") return exportRuntimeTopologyMermaid(model).files[0].content;
  if (target.type === "runtime-topology-summary") return renderRuntimeTopologySummary(model, target.path);
  if (target.type === "architecture-history") return renderHistoryMarkdown(input.architectureHistory!);
  return "";
}

/** A link from `docs/architecture/index.md` to another file under `docs/architecture/`. */
function architectureIndexLink(path: string): string {
  return path.replace(/^docs\/architecture\//, "");
}

function renderArchitectureIndex(model: NativeModel, layout: ArchitectureDocumentationLayout): string {
  const lines = [
    "# Architecture Index",
    "",
    "## Entities",
    "",
    ...model.nodes.filter((node) => layout.entityPathByNodeId.has(node.id)).map((node) => {
      const path = layout.entityPathByNodeId.get(node.id);
      if (!path) throw new Error(`projection-layout-entity-target-missing: ${node.id}`);
      return `- [${node.name}](${path.replace(/^docs\/architecture\//, "")}) — ${node.kind}${node.status ? ` / ${node.status}` : ""}`;
    }),
    ...(layout.entityPathByNodeId.size === 0 ? ["- No architecture entities recorded."] : []),
    "",
    "## Relations",
    "",
    ...model.relations.map((relation) => layout.profile === REPO_HARNESS_PROJECTION_PROFILE
      ? `- ${relation.source} -> ${relation.target} — ${relation.kind}`
      : `- [${relation.source} -> ${relation.target}](relations/${pathSegment(relation.id)}.md) — ${relation.kind}`),
    ...(model.relations.length === 0 ? ["- No architecture relations recorded."] : []),
    "",
    "## Projections",
    "",
    "- [Mermaid](diagrams/architecture.mmd)",
    "- [Structurizr JSON](diagrams/architecture.structurizr.json)",
    "- [LikeC4](diagrams/architecture.likec4)",
    // Only a layout with topology targets links them, so every other index keeps its bytes (ADR-0049).
    ...layout.targets.flatMap((target) => target.type === "diagram-runtime-topology"
      ? [`- [Runtime topology Mermaid](${architectureIndexLink(target.path)})`]
      : target.type === "runtime-topology-summary" ? [`- [Runtime topology](${architectureIndexLink(target.path)})`] : []),
    "- [Decision index](decisions/index.md)"
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Machine-owned region of a capability module document: the intro block plus `## 1` and the
 * `## 2` structural slot. Everything the renderer cannot derive from the model or the measured
 * scale signal is printed as an explicit "not derivable" note — never as an empty diagram fence, a
 * synthesised edge, or an invented line anchor.
 *
 * Nothing here is a function of the repository ref. Every value printed is derived from the
 * architecture model or from a measurement bucketed coarsely enough that ordinary edits under the
 * node's footprint do not move it, so a diff on this document means an architecture assertion
 * changed.
 */
function renderEntitySummary(
  node: NativeNode,
  model: NativeModel,
  input: {
    scaleSignal?: CapabilitySourceScaleSignal;
    /** `architectureCapabilityScale(scaleSignal)`, the buckets the document prints for this node. */
    scale?: ArchitectureCapabilityScaleV1;
    /** The measured scale of every node that declares `source.include`; components read theirs here. */
    scaleByNodeId: ReadonlyMap<string, ArchitectureCapabilityScaleV1>;
    semanticCompilation: SemanticCapabilityDiagramCompilation;
    stateMachines: readonly StateMachineV1[];
  }
): string {
  const source = nativeNodeSource(node);
  const include = source?.include ?? [];
  if (include.length > 0 && (!input.scaleSignal || !input.scale)) {
    throw new Error(`architecture-docs-projection-scale-signal-missing: ${node.id}`);
  }
  const incoming = model.relations.filter((relation) => relation.target === node.id);
  const outgoing = model.relations.filter((relation) => relation.source === node.id);
  const localContracts = contractFilesForNode(node);
  // Direct `component` children (#299). A node without them renders exactly as before.
  const components = model.nodes.filter((entry) => entry.parent === node.id && entry.kind === "component");
  const lines = [
    `> **狀態**:${node.status ? `\`${node.status}\`` : "未宣告(`status` 缺失)"}`,
    `> **Capability ID**:\`${node.id}\`(kind \`${node.kind}\`)`,
    `> **Matched Prefixes**:${include.length > 0 ? include.map((pattern) => `\`${pattern}\``).join("、") : "未宣告(`source.include` 缺失)"}`,
    `> **Local Contracts**:${localContracts.length > 0 ? localContracts.map((entry) => `\`${entry}\``).join("、") : "未宣告(`extensions.localContracts` 缺失)"}`,
    "> **事實優先級**:倉庫當前狀態 > 本文檔機器區 > 本文檔人工區。機器區(引言、§1、§2)由 ArchContext 從架構模型與源碼度量投影生成,手改會在下次投影被覆蓋。本文檔不記錄出處;本次投影所驗證的 commit 見 `docs/architecture/.projection-manifest.json`。",
    ...(node.summary ? ["", node.summary] : []),
    "",
    "## 1. P1:能力架構地圖",
    "",
    "### 1.1 架構圖",
    "",
    ...renderSemanticP1Section(input.semanticCompilation),
    "",
    "### 1.2 模組職責表",
    "",
    ...renderProjectionEntrypoints(node, components).lines,
    "",
    "### 1.3 規模信號",
    "",
    ...(input.scaleSignal && input.scale
      ? [
        `- 規模量級:\`${scaleMagnitudeBucketLabel(input.scale.fileCountBucket)}\` 個文件 / \`${scaleMagnitudeBucketLabel(input.scale.lineCountBucket)}\` 行`,
        `- 匹配前綴:${input.scaleSignal.includePatterns.map((pattern) => `\`${pattern}\``).join("、")}`,
        ...(input.scaleSignal.excludePatterns.length > 0
          ? [`- 排除前綴:${input.scaleSignal.excludePatterns.map((pattern) => `\`${pattern}\``).join("、")}`]
          : []),
        "- 推導:掃描 `source.include` 減 `source.exclude`,跳過 `.git/` 與 `node_modules/`,再按 1–2–5 階梯分桶。精確計數不入本文檔:量級足以回答「這個能力有多大」,而逐行計數會讓覆蓋範圍內任何一次源碼改動都改寫本文檔。"
      ]
      : ["- 未宣告 `source.include`,規模信號無法推導。"]),
    "",
    "### 1.4 依賴邊界",
    "",
    "出向關係:",
    "",
    ...(outgoing.length === 0 ? ["- 無。"] : outgoing.map((relation) => `- \`${relation.kind}\` → \`${relation.target}\` — ${relation.intent}`)),
    "",
    "入向關係:",
    "",
    ...(incoming.length === 0 ? ["- 無。"] : incoming.map((relation) => `- \`${relation.kind}\` ← \`${relation.source}\` — ${relation.intent}`)),
    ...renderComponentOutboundRelations(components, model.relations),
    ...renderComponentTable(components, input.scaleByNodeId),
    "",
    "## 2. P2:端到端數據流",
    "",
    ...renderSemanticP2Section(input.semanticCompilation),
    ...renderStateMachineSection(input.stateMachines)
  ];
  return `${lines.join("\n")}\n`;
}
