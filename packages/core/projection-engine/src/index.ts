import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  PROJECTION_TARGET_SCHEMA_VERSION,
  digestJson,
  stableId,
  type Json,
  type ModelExportResult,
  type ProjectionTargetV1
} from "@archcontext/contracts";

export interface NativeNode extends Record<string, Json | undefined> {
  id: string;
  kind: string;
  name: string;
  status?: string;
  summary?: string;
}

export interface NativeRelation extends Record<string, Json> {
  id: string;
  kind: string;
  source: string;
  target: string;
  intent: string;
}

export interface NativeModel {
  nodes: NativeNode[];
  relations: NativeRelation[];
}

export interface ArchitectureDecisionRecord {
  id: string;
  title: string;
  path: string;
  status?: string;
}

export interface ArchitectureDocumentationTimelineEntry {
  eventId: string;
  timestamp: string;
  title?: string;
  summary?: string;
  affectedSubjects?: string[];
}

export interface ArchitectureDocumentationExistingFile {
  path: string;
  body: string;
}

export interface ArchitectureDocumentationProjectionFile extends ArchitectureDocumentationExistingFile {
  target: ProjectionTargetV1;
  digest: string;
  generatedBodyDigest: string;
}

export type ArchitectureDocumentationDriftReason =
  | "projection-file-missing"
  | "projection-generated-region-missing"
  | "projection-generated-region-stale"
  | "projection-generated-region-manually-edited"
  | "projection-ambiguous-ownership"
  | "projection-orphaned";

export interface ArchitectureDocumentationProjectionDrift {
  path: string;
  targetId?: string;
  reasonCode: ArchitectureDocumentationDriftReason;
  expectedDigest?: string;
  actualDigest?: string;
}

export interface ArchitectureDocumentationProjectionPlan {
  schemaVersion: "archcontext.architecture-docs-projection-plan/v1";
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  sourceDigest: string;
  projectionDigest: string;
  targets: ProjectionTargetV1[];
  files: ArchitectureDocumentationProjectionFile[];
  drift: {
    ok: boolean;
    reasonCodes: ArchitectureDocumentationDriftReason[];
    diffs: ArchitectureDocumentationProjectionDrift[];
  };
  rejected: ArchitectureDocumentationProjectionDrift[];
}

export const ARCHITECTURE_DOCS_RENDERER_VERSION = "archcontext.docs-renderer/v1" as const;
export const ARCHITECTURE_DOCS_GENERATED_BEGIN_PREFIX = "<!-- BEGIN ARCHCONTEXT:generated";
export const ARCHITECTURE_DOCS_GENERATED_END_PREFIX = "<!-- END ARCHCONTEXT:generated";

export function renderArchitectureDocumentationProjection(input: {
  model: NativeModel;
  sourceDigest: string;
  generatedAt?: string;
  decisions?: ArchitectureDecisionRecord[];
  timeline?: ArchitectureDocumentationTimelineEntry[];
  existingFiles?: ArchitectureDocumentationExistingFile[];
  rendererVersion?: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
}): ArchitectureDocumentationProjectionPlan {
  const rendererVersion = input.rendererVersion ?? ARCHITECTURE_DOCS_RENDERER_VERSION;
  const model = normalizeNativeModel(input.model);
  const existingByPath = new Map((input.existingFiles ?? []).map((file) => [file.path, file.body]));
  const generatedAt = input.generatedAt ?? "1970-01-01T00:00:00.000Z";
  const targetDrafts = architectureDocumentationTargetDrafts(model);
  const rendered = targetDrafts.map((draft) => {
    const generatedBody = renderTargetGeneratedBody(draft, model, {
      generatedAt,
      decisions: input.decisions ?? [],
      timeline: input.timeline ?? []
    });
    const generatedBodyDigest = digestJson({ targetId: draft.targetId, body: generatedBody } as unknown as Json);
    const target = projectionTarget({
      ...draft,
      rendererVersion,
      sourceDigest: input.sourceDigest,
      outputDigest: generatedBodyDigest
    });
    const wrapped = wrapGeneratedRegion(target, generatedBody);
    const existing = existingByPath.get(target.path);
    const body = mergeGeneratedRegion(target, wrapped, existing);
    return {
      path: target.path,
      body,
      target,
      digest: digestJson({ path: target.path, body } as unknown as Json),
      generatedBodyDigest
    };
  });
  const targets = rendered.map((file) => file.target);
  const expectedByPath = new Map(rendered.map((file) => [file.path, file]));
  const drift = architectureDocumentationProjectionDrift({
    targets,
    expectedFiles: rendered,
    existingFiles: input.existingFiles ?? []
  });
  const rejected = drift.diffs.filter((diff) => diff.reasonCode === "projection-ambiguous-ownership");
  const projectionDigest = digestJson({
    rendererVersion,
    sourceDigest: input.sourceDigest,
    files: rendered.map((file) => ({
      path: file.path,
      targetId: file.target.targetId,
      digest: file.digest,
      generatedBodyDigest: file.generatedBodyDigest
    })).sort((left, right) => left.path.localeCompare(right.path))
  } as unknown as Json);

  return {
    schemaVersion: "archcontext.architecture-docs-projection-plan/v1",
    rendererVersion,
    sourceDigest: input.sourceDigest,
    projectionDigest,
    targets,
    files: rendered.filter((file) => !rejected.some((diff) => diff.path === file.path && diff.targetId === file.target.targetId)),
    drift: {
      ...drift,
      diffs: drift.diffs.map((diff) => ({
        ...diff,
        expectedDigest: diff.expectedDigest ?? expectedByPath.get(diff.path)?.digest
      }))
    },
    rejected
  };
}

export function loadArchitectureDocumentationInputs(root: string): {
  model: NativeModel;
  decisions: ArchitectureDecisionRecord[];
  existingFiles: ArchitectureDocumentationExistingFile[];
} {
  return {
    model: loadNativeModelFromArchContext(root),
    decisions: loadArchitectureDecisionRecords(root),
    existingFiles: loadArchitectureDocumentationFiles(root)
  };
}

export function architectureDocumentationSourceDigest(input: {
  model: NativeModel;
  decisions: ArchitectureDecisionRecord[];
}): string {
  return digestJson({
    model: input.model,
    decisions: input.decisions.map((decision) => ({
      id: decision.id,
      path: decision.path,
      title: decision.title,
      status: decision.status
    }))
  } as unknown as Json);
}

export function loadArchitectureDecisionRecords(root: string): ArchitectureDecisionRecord[] {
  const dir = resolve(root, "docs/adr");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /^ADR-\d{4}-.+\.md$/.test(file))
    .sort()
    .map((file) => {
      const path = `docs/adr/${file}`;
      const body = readFileSync(resolve(root, path), "utf8");
      const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(file, ".md");
      const status = body.match(/^Status:\s*(.+)$/mi)?.[1]?.trim();
      return {
        id: basename(file, ".md"),
        title,
        path,
        ...(status ? { status } : {})
      };
    });
}

export function loadArchitectureDocumentationFiles(root: string): ArchitectureDocumentationExistingFile[] {
  const files: ArchitectureDocumentationExistingFile[] = [];
  for (const entry of [
    "docs/architecture/index.md",
    "docs/architecture/changelog.md",
    "docs/architecture/decisions/index.md",
    "docs/architecture/diagrams/architecture.mmd",
    "docs/architecture/diagrams/architecture.likec4",
    "docs/architecture/diagrams/architecture.structurizr.json",
    "docs/architecture/.projection-manifest.json"
  ]) {
    const absolute = resolve(root, entry);
    if (existsSync(absolute)) files.push({ path: entry, body: readFileSync(absolute, "utf8") });
  }
  for (const dir of ["docs/architecture/modules", "docs/architecture/relations"]) {
    const absoluteDir = resolve(root, dir);
    if (!existsSync(absoluteDir)) continue;
    for (const file of readdirSync(absoluteDir).filter((name) => name.endsWith(".md")).sort()) {
      const path = `${dir}/${file}`;
      files.push({ path, body: readFileSync(resolve(root, path), "utf8") });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function normalizeNativeModel(model: NativeModel): NativeModel {
  return {
    nodes: [...model.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    relations: [...model.relations].sort((a, b) => a.id.localeCompare(b.id))
  };
}

export function exportMermaidModel(model: NativeModel): ModelExportResult {
  const normalized = normalizeNativeModel(model);
  const lines = ["%% Generated by ArchContext. Native model remains source of truth.", "flowchart LR"];
  for (const node of normalized.nodes) {
    lines.push(`  ${mermaidId(node.id)}["${escapeMermaid(node.name)}"]`);
  }
  for (const relation of normalized.relations) {
    lines.push(`  ${mermaidId(relation.source)} -->|"${escapeMermaid(relation.kind)}"| ${mermaidId(relation.target)}`);
  }
  const content = `${lines.join("\n")}\n`;
  return {
    format: "mermaid",
    digest: digestJson({ format: "mermaid", content } as unknown as Json),
    files: [{ path: ".archcontext/generated/architecture.mmd", content }]
  };
}

export function exportDocumentationLikeC4Model(model: NativeModel): ModelExportResult {
  const normalized = normalizeNativeModel(model);
  const lines = [
    "// Generated by ArchContext. Native model remains source of truth.",
    "specification {",
    "  element capability",
    "  element module",
    "  element component",
    "  element interface",
    "  element datastore",
    "  element external_system",
    "}",
    "",
    "model {"
  ];
  for (const node of normalized.nodes) lines.push(`  ${mermaidId(node.id)} = ${documentationLikeC4Kind(node.kind)} "${escapeDsl(node.name)}"`);
  for (const relation of normalized.relations) lines.push(`  ${mermaidId(relation.source)} -> ${mermaidId(relation.target)} "${escapeDsl(relation.kind)}"`);
  lines.push("}", "", "views {", "  view index {", "    include *", "    autoLayout TopBottom", "  }", "}");
  const content = `${lines.join("\n")}\n`;
  return {
    format: "likec4",
    digest: digestJson({ format: "likec4", content } as unknown as Json),
    files: [{ path: "docs/architecture/diagrams/architecture.likec4", content }]
  };
}

export function exportDocumentationStructurizrWorkspace(model: NativeModel): ModelExportResult {
  const normalized = normalizeNativeModel(model);
  const workspace = {
    schemaVersion: "archcontext.structurizr-export/v1",
    name: "ArchContext Architecture",
    model: {
      elements: normalized.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        type: documentationStructurizrElementType(node.kind),
        tags: [node.kind]
      })),
      relationships: normalized.relations.map((relation) => ({
        id: relation.id,
        sourceId: relation.source,
        destinationId: relation.target,
        description: relation.kind
      }))
    },
    views: {
      systemLandscape: {
        key: "archcontext-landscape",
        include: normalized.nodes.map((node) => node.id)
      }
    }
  };
  const content = `${JSON.stringify(workspace, null, 2)}\n`;
  return {
    format: "structurizr",
    digest: digestJson(workspace as unknown as Json),
    files: [{ path: "docs/architecture/diagrams/architecture.structurizr.json", content }]
  };
}

export function loadNativeModelFromArchContext(root: string): NativeModel {
  return {
    nodes: readYamlObjects(resolve(root, ".archcontext/model/nodes")) as NativeNode[],
    relations: readYamlObjects(resolve(root, ".archcontext/model/relations")) as NativeRelation[]
  };
}

export function mermaidId(id: string): string {
  return stableId(id).replace(/-/g, "_").replace(/\./g, "_");
}

function readYamlObjects(dir: string): Record<string, Json>[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort()
    .map((file) => parseFlatYaml(readFileSync(resolve(dir, file), "utf8")));
}

function parseFlatYaml(body: string): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (raw.startsWith("\"") && raw.endsWith("\"")) out[key] = JSON.parse(raw);
    else if (raw === "true" || raw === "false") out[key] = raw === "true";
    else out[key] = raw;
  }
  return out;
}

function escapeMermaid(value: string): string {
  return value.replace(/"/g, "'");
}

interface ProjectionTargetDraft {
  targetId: string;
  type: ProjectionTargetV1["type"];
  scope: ProjectionTargetV1["scope"];
  path: string;
  ownership: ProjectionTargetV1["ownership"];
  format: ProjectionTargetV1["format"];
}

function architectureDocumentationTargetDrafts(model: NativeModel): ProjectionTargetDraft[] {
  const entityTargets = model.nodes.map((node) => ({
    targetId: `projection_target.entity.${stableId(node.id)}`,
    type: "entity-summary" as const,
    scope: { kind: "entity" as const, id: node.id, entityKind: node.kind },
    path: `docs/architecture/modules/${pathSegment(node.id)}.md`,
    ownership: "mixed" as const,
    format: "markdown" as const
  }));
  const relationTargets = model.relations.map((relation) => ({
    targetId: `projection_target.relation.${stableId(relation.id)}`,
    type: "relation-summary" as const,
    scope: { kind: "relation" as const, id: relation.id },
    path: `docs/architecture/relations/${pathSegment(relation.id)}.md`,
    ownership: "mixed" as const,
    format: "markdown" as const
  }));
  return [
    {
      targetId: "projection_target.architecture.index",
      type: "architecture-index",
      scope: { kind: "repository" },
      path: "docs/architecture/index.md",
      ownership: "mixed",
      format: "markdown"
    },
    ...entityTargets,
    ...relationTargets,
    {
      targetId: "projection_target.decision.index",
      type: "decision-index",
      scope: { kind: "decision" },
      path: "docs/architecture/decisions/index.md",
      ownership: "mixed",
      format: "markdown"
    },
    {
      targetId: "projection_target.architecture.changelog",
      type: "architecture-changelog",
      scope: { kind: "changelog" },
      path: "docs/architecture/changelog.md",
      ownership: "mixed",
      format: "markdown"
    },
    {
      targetId: "projection_target.diagram.mermaid",
      type: "diagram-mermaid",
      scope: { kind: "diagram", id: "architecture" },
      path: "docs/architecture/diagrams/architecture.mmd",
      ownership: "generated",
      format: "mermaid"
    },
    {
      targetId: "projection_target.diagram.structurizr",
      type: "diagram-structurizr",
      scope: { kind: "diagram", id: "architecture" },
      path: "docs/architecture/diagrams/architecture.structurizr.json",
      ownership: "generated",
      format: "structurizr-json"
    },
    {
      targetId: "projection_target.diagram.likec4",
      type: "diagram-likec4",
      scope: { kind: "diagram", id: "architecture" },
      path: "docs/architecture/diagrams/architecture.likec4",
      ownership: "generated",
      format: "likec4"
    }
  ];
}

function projectionTarget(input: ProjectionTargetDraft & {
  rendererVersion: typeof ARCHITECTURE_DOCS_RENDERER_VERSION;
  sourceDigest: string;
  outputDigest: string;
}): ProjectionTargetV1 {
  return {
    schemaVersion: PROJECTION_TARGET_SCHEMA_VERSION,
    targetId: input.targetId,
    type: input.type,
    scope: input.scope,
    path: input.path,
    ownership: input.ownership,
    generatedRegion: {
      startMarker: generatedStartMarker(input.targetId, input.sourceDigest, input.rendererVersion, input.outputDigest),
      endMarker: generatedEndMarker(input.targetId)
    },
    rendererVersion: input.rendererVersion,
    format: input.format,
    sourceDigest: input.sourceDigest,
    outputDigest: input.outputDigest
  };
}

function renderTargetGeneratedBody(
  target: ProjectionTargetDraft,
  model: NativeModel,
  input: {
    generatedAt: string;
    decisions: ArchitectureDecisionRecord[];
    timeline: ArchitectureDocumentationTimelineEntry[];
  }
): string {
  if (target.type === "architecture-index") return renderArchitectureIndex(model, input.generatedAt);
  if (target.type === "entity-summary") return renderEntitySummary(model.nodes.find((node) => node.id === target.scope.id)!, model);
  if (target.type === "relation-summary") return renderRelationSummary(model.relations.find((relation) => relation.id === target.scope.id)!, model);
  if (target.type === "decision-index") return renderDecisionIndex(input.decisions);
  if (target.type === "architecture-changelog") return renderArchitectureChangelog(input.timeline);
  if (target.type === "diagram-mermaid") return exportMermaidModel(model).files[0].content;
  if (target.type === "diagram-structurizr") return exportDocumentationStructurizrWorkspace(model).files[0].content;
  if (target.type === "diagram-likec4") return exportDocumentationLikeC4Model(model).files[0].content;
  return "";
}

function renderArchitectureIndex(model: NativeModel, generatedAt: string): string {
  const lines = [
    "# Architecture Index",
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Entities",
    "",
    ...model.nodes.map((node) => `- [${node.name}](modules/${pathSegment(node.id)}.md) — ${node.kind}${node.status ? ` / ${node.status}` : ""}`),
    ...(model.nodes.length === 0 ? ["- No architecture entities recorded."] : []),
    "",
    "## Relations",
    "",
    ...model.relations.map((relation) => `- [${relation.source} -> ${relation.target}](relations/${pathSegment(relation.id)}.md) — ${relation.kind}`),
    ...(model.relations.length === 0 ? ["- No architecture relations recorded."] : []),
    "",
    "## Projections",
    "",
    "- [Mermaid](diagrams/architecture.mmd)",
    "- [Structurizr JSON](diagrams/architecture.structurizr.json)",
    "- [LikeC4](diagrams/architecture.likec4)",
    "- [Decision index](decisions/index.md)",
    "- [Architecture changelog](changelog.md)"
  ];
  return `${lines.join("\n")}\n`;
}

function renderEntitySummary(node: NativeNode, model: NativeModel): string {
  const incoming = model.relations.filter((relation) => relation.target === node.id);
  const outgoing = model.relations.filter((relation) => relation.source === node.id);
  const lines = [
    `# ${node.name}`,
    "",
    `- ID: \`${node.id}\``,
    `- Kind: \`${node.kind}\``,
    ...(node.status ? [`- Status: \`${node.status}\``] : []),
    ...(node.summary ? ["", node.summary] : []),
    "",
    "## Outgoing Relations",
    "",
    ...(outgoing.length === 0 ? ["- None."] : outgoing.map((relation) => `- \`${relation.kind}\` to \`${relation.target}\` — ${relation.intent}`)),
    "",
    "## Incoming Relations",
    "",
    ...(incoming.length === 0 ? ["- None."] : incoming.map((relation) => `- \`${relation.kind}\` from \`${relation.source}\` — ${relation.intent}`))
  ];
  return `${lines.join("\n")}\n`;
}

function renderRelationSummary(relation: NativeRelation, model: NativeModel): string {
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

function renderDecisionIndex(decisions: ArchitectureDecisionRecord[]): string {
  const lines = [
    "# Architecture Decision Index",
    "",
    ...(decisions.length === 0
      ? ["- No ADRs selected for this projection."]
      : decisions.map((decision) => `- [${decision.title}](../../${decision.path})${decision.status ? ` — ${decision.status}` : ""}`))
  ];
  return `${lines.join("\n")}\n`;
}

function renderArchitectureChangelog(timeline: ArchitectureDocumentationTimelineEntry[]): string {
  const lines = [
    "# Architecture Changelog",
    "",
    ...(timeline.length === 0
      ? ["- No accepted architecture ledger events selected for this projection."]
      : timeline.map((entry) => {
        const affected = entry.affectedSubjects && entry.affectedSubjects.length > 0 ? ` (${entry.affectedSubjects.join(", ")})` : "";
        return `- ${entry.timestamp} — ${entry.title ?? entry.eventId}${affected}${entry.summary ? `: ${entry.summary}` : ""}`;
      }))
  ];
  return `${lines.join("\n")}\n`;
}

function wrapGeneratedRegion(target: ProjectionTargetV1, generatedBody: string): string {
  return [
    target.generatedRegion.startMarker,
    generatedBody.trimEnd(),
    target.generatedRegion.endMarker,
    ""
  ].join("\n");
}

function mergeGeneratedRegion(target: ProjectionTargetV1, wrapped: string, existing?: string): string {
  if (!existing) return wrapped;
  const region = findGeneratedRegion(existing, target.targetId);
  if (!region) {
    if (target.ownership === "mixed") {
      return `${existing.trimEnd()}\n\n${wrapped}`;
    }
    return wrapped;
  }
  return `${existing.slice(0, region.start)}${wrapped}${existing.slice(region.end)}`;
}

function architectureDocumentationProjectionDrift(input: {
  targets: ProjectionTargetV1[];
  expectedFiles: ArchitectureDocumentationProjectionFile[];
  existingFiles: ArchitectureDocumentationExistingFile[];
}): { ok: boolean; reasonCodes: ArchitectureDocumentationDriftReason[]; diffs: ArchitectureDocumentationProjectionDrift[] } {
  const existingByPath = new Map(input.existingFiles.map((file) => [file.path, file]));
  const expectedByPath = new Map(input.expectedFiles.map((file) => [file.path, file]));
  const targetIds = new Set(input.targets.map((target) => target.targetId));
  const diffs: ArchitectureDocumentationProjectionDrift[] = [];

  for (const expected of input.expectedFiles) {
    const existing = existingByPath.get(expected.path);
    if (!existing) {
      diffs.push({ path: expected.path, targetId: expected.target.targetId, reasonCode: "projection-file-missing", expectedDigest: expected.digest });
      continue;
    }
    const region = findGeneratedRegion(existing.body, expected.target.targetId);
    if (!region) {
      diffs.push({
        path: expected.path,
        targetId: expected.target.targetId,
        reasonCode: expected.target.ownership === "generated" ? "projection-ambiguous-ownership" : "projection-generated-region-missing",
        expectedDigest: expected.digest,
        actualDigest: digestJson({ path: existing.path, body: existing.body } as unknown as Json)
      });
      continue;
    }
    const metadata = parseGeneratedRegionMetadata(region.startMarker);
    if (metadata.sourceDigest !== expected.target.sourceDigest || metadata.rendererVersion !== expected.target.rendererVersion) {
      diffs.push({ path: expected.path, targetId: expected.target.targetId, reasonCode: "projection-generated-region-stale", expectedDigest: expected.digest, actualDigest: digestJson({ path: existing.path, body: existing.body } as unknown as Json) });
      continue;
    }
    const actualGeneratedBodyDigest = digestJson({
      targetId: expected.target.targetId,
      body: `${region.body.trimEnd()}\n`
    } as unknown as Json);
    if (metadata.outputDigest !== expected.generatedBodyDigest || actualGeneratedBodyDigest !== expected.generatedBodyDigest) {
      diffs.push({
        path: expected.path,
        targetId: expected.target.targetId,
        reasonCode: "projection-generated-region-manually-edited",
        expectedDigest: expected.generatedBodyDigest,
        actualDigest: actualGeneratedBodyDigest
      });
    }
  }

  for (const existing of input.existingFiles) {
    if (!isManagedArchitectureDocumentationPath(existing.path) || expectedByPath.has(existing.path)) continue;
    const region = findAnyGeneratedRegion(existing.body);
    if (region && !targetIds.has(region.targetId)) {
      diffs.push({
        path: existing.path,
        targetId: region.targetId,
        reasonCode: "projection-orphaned",
        actualDigest: digestJson({ path: existing.path, body: existing.body } as unknown as Json)
      });
    }
  }

  const reasonCodes = [...new Set(diffs.map((diff) => diff.reasonCode))].sort() as ArchitectureDocumentationDriftReason[];
  return { ok: diffs.length === 0, reasonCodes, diffs: diffs.sort((left, right) => left.path.localeCompare(right.path) || (left.targetId ?? "").localeCompare(right.targetId ?? "")) };
}

function findGeneratedRegion(body: string, targetId: string): { start: number; end: number; startMarker: string; body: string } | undefined {
  const startPattern = new RegExp(`<!-- BEGIN ARCHCONTEXT:generated target="${escapeRegExp(targetId)}"[^>]*-->`);
  const startMatch = startPattern.exec(body);
  if (!startMatch || startMatch.index === undefined) return undefined;
  const endMarker = generatedEndMarker(targetId);
  const endIndex = body.indexOf(endMarker, startMatch.index + startMatch[0].length);
  if (endIndex < 0) return undefined;
  const regionStart = startMatch.index;
  const regionEnd = endIndex + endMarker.length + (body[endIndex + endMarker.length] === "\n" ? 1 : 0);
  const generatedBody = body.slice(startMatch.index + startMatch[0].length, endIndex).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  return { start: regionStart, end: regionEnd, startMarker: startMatch[0], body: generatedBody };
}

function findAnyGeneratedRegion(body: string): { targetId: string } | undefined {
  const match = body.match(/<!-- BEGIN ARCHCONTEXT:generated target="([^"]+)"/);
  return match ? { targetId: match[1] } : undefined;
}

function parseGeneratedRegionMetadata(marker: string): { sourceDigest?: string; rendererVersion?: string; outputDigest?: string } {
  return {
    sourceDigest: marker.match(/sourceDigest="([^"]+)"/)?.[1],
    rendererVersion: marker.match(/rendererVersion="([^"]+)"/)?.[1],
    outputDigest: marker.match(/outputDigest="([^"]+)"/)?.[1]
  };
}

function generatedStartMarker(targetId: string, sourceDigest: string, rendererVersion: string, outputDigest: string): string {
  return `${ARCHITECTURE_DOCS_GENERATED_BEGIN_PREFIX} target="${targetId}" sourceDigest="${sourceDigest}" rendererVersion="${rendererVersion}" outputDigest="${outputDigest}" -->`;
}

function generatedEndMarker(targetId: string): string {
  return `${ARCHITECTURE_DOCS_GENERATED_END_PREFIX} target="${targetId}" -->`;
}

function isManagedArchitectureDocumentationPath(path: string): boolean {
  return /^docs\/architecture\/(modules|relations)\/.+\.md$/.test(path)
    || /^docs\/architecture\/diagrams\/architecture\.(mmd|likec4|structurizr\.json)$/.test(path)
    || path === "docs/architecture/index.md"
    || path === "docs/architecture/changelog.md"
    || path === "docs/architecture/decisions/index.md";
}

function pathSegment(id: string): string {
  return stableId(id).replace(/\./g, "-");
}

function documentationLikeC4Kind(kind: string): string {
  if (kind === "external-system") return "external_system";
  if (kind === "datastore") return "datastore";
  if (["capability", "module", "component", "interface"].includes(kind)) return kind;
  return "component";
}

function documentationStructurizrElementType(kind: string): "Software System" | "Container" | "Component" | "Database" | "External System" {
  if (kind === "capability") return "Software System";
  if (kind === "module") return "Container";
  if (kind === "datastore") return "Database";
  if (kind === "external-system") return "External System";
  return "Component";
}

function escapeDsl(value: string): string {
  return value.replace(/"/g, "'");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
