import {
  digestJson,
  type ArchitectureDocsProjectionManifestV4,
  type Json,
  type ProjectionMixedTargetV1
} from "@archcontext/contracts";
import type { NativeNode } from "@archcontext/core/architecture-domain";
import { generatedMarkerAttributes, scanDocumentRegions } from "./document-regions";
import { RETIRED_ARCHITECTURE_CHANGELOG } from "./layout";
import {
  ARCHITECTURE_DOCS_GENERATED_BEGIN_PREFIX,
  ARCHITECTURE_DOCS_GENERATED_END_PREFIX,
  ARCHITECTURE_DOCS_LANGUAGES,
  type ArchitectureDocsLanguage
} from "./docs-types";

/**
 * Handoff title form `<domain>/<name>`: the node id with its `capability.` prefix dropped and the
 * remaining dotted segments joined by `/`. A single remaining segment is used on its own. The id is
 * used rather than `node.name` because the title is the document's stable address, and ids are the
 * only part of the model guaranteed to be unique and path-shaped.
 */
function entitySummaryTitle(node: Pick<NativeNode, "id">): string {
  const segments = node.id.replace(/^capability\./, "").split(".").filter((segment) => segment !== "");
  return segments.length > 0 ? segments.join("/") : node.id;
}

/**
 * Skeleton headings per `docs.language`. The `legacy` entry is the text every release before #302
 * wrote; a repository that sets no language keeps it byte for byte. `Optimization Backlog` stays
 * the same in every language because agents and tools find the section by that heading.
 */
const ENTITY_SUMMARY_SKELETON_TEXT: Record<ArchitectureDocsLanguage | "legacy", { titleSuffix: string; p3: string; history: string }> = {
  legacy: { titleSuffix: " 架構文檔", p3: "## 3. P3:設計決策與不變量", history: "## 4. 歷史決策記錄(append-only)" },
  "zh-Hant": { titleSuffix: " 架構文檔", p3: "## 3. P3：設計決策與不變量", history: "## 4. 歷史決策記錄（append-only）" },
  "zh-Hans": { titleSuffix: " 架构文档", p3: "## 3. P3：设计决策与不变量", history: "## 4. 历史决策记录（append-only）" },
  en: { titleSuffix: " Architecture", p3: "## 3. P3: Design Decisions and Invariants", history: "## 4. Decision History (append-only)" }
};

/**
 * The scaffold of a new module document. Only a file that does not exist yet gets it, so changing
 * `docs.language` never rewrites the headings of an existing document (#302).
 */
export function entitySummarySkeleton(node: Pick<NativeNode, "id">, docsLanguage: ArchitectureDocsLanguage | undefined): { prefix: string; suffix: string } {
  const text = ENTITY_SUMMARY_SKELETON_TEXT[docsLanguage ?? "legacy"];
  return {
    prefix: `# ${entitySummaryTitle(node)}${text.titleSuffix}\n\n`,
    suffix: [
      "",
      text.p3,
      "",
      text.history,
      "",
      "## Optimization Backlog",
      ""
    ].join("\n")
  };
}

/** Every skeleton the renderer can have written for one node, whatever `docs.language` was then. */
export function entitySummarySkeletonVariants(node: Pick<NativeNode, "id">): { prefix: string; suffix: string }[] {
  return [undefined, ...ARCHITECTURE_DOCS_LANGUAGES].map((language) => entitySummarySkeleton(node, language));
}

export function wrapGeneratedRegion(target: ProjectionMixedTargetV1, generatedBody: string): string {
  return [
    target.generatedRegion.startMarker,
    generatedBody.trimEnd(),
    target.generatedRegion.endMarker,
    ""
  ].join("\n");
}

export function mergeGeneratedRegion(
  target: ProjectionMixedTargetV1,
  wrapped: string,
  existing?: string,
  skeleton?: { prefix: string; suffix: string }
): string {
  if (!existing) return skeleton ? `${skeleton.prefix}${wrapped}${skeleton.suffix}` : wrapped;
  const region = findGeneratedRegion(existing, target.targetId);
  if (!region) return `${existing.trimEnd()}\n\n${wrapped}`;
  return `${existing.slice(0, region.start)}${wrapped}${existing.slice(region.end)}`;
}

/** The digest a manifest row records for a whole-file output: the same shape as a region's `outputDigest`. */
export function generatedOutputDigest(targetId: string, body: string): string {
  return digestJson({ targetId, body } as unknown as Json);
}

/**
 * The entity-summary targets the committed manifest records, by targetId: their path and the node
 * they document. A removed node is gone from the model, so this is where its skeleton is derived
 * from. No current-format manifest records none.
 */
export function committedEntitySummaryTargets(manifest: ArchitectureDocsProjectionManifestV4 | undefined): Map<string, { path: string; nodeId: string }> {
  const targets = new Map<string, { path: string; nodeId: string }>();
  for (const [targetId, row] of Object.entries(manifest?.targets ?? {})) {
    if (row.type === "entity-summary" && typeof row.scope.id === "string") targets.set(targetId, { path: row.path, nodeId: row.scope.id });
  }
  return targets;
}

/**
 * The skeletons the renderer can have written around an orphan's region, when the manifest records
 * it as that path's entity summary: one per `docs.language`, because the document may predate a
 * change of the setting.
 */
export function orphanSkeletons(
  committedEntityTargets: Map<string, { path: string; nodeId: string }>,
  path: string,
  targetId: string
): { prefix: string; suffix: string }[] {
  const committed = committedEntityTargets.get(targetId);
  return committed && committed.path === path ? entitySummarySkeletonVariants({ id: committed.nodeId }) : [];
}

/**
 * True only when deleting the orphan cannot lose human text: everything outside its one generated
 * region is whitespace or exactly one of the renderer's own skeletons for that target (title and
 * empty §3/§4/Backlog headings, #276), and the region still digests to the output its own marker
 * records (an edited region is human content). Anything else, including a missing end marker or
 * one human line in a skeleton section, is human review.
 */
export function orphanHoldsOnlyIntactGeneratedRegion(body: string, targetId: string, skeletons: { prefix: string; suffix: string }[]): boolean {
  const region = findGeneratedRegion(body, targetId);
  if (!region) return false;
  const before = body.slice(0, region.start);
  const after = body.slice(region.end);
  const generatedOnly = `${before}${after}`.trim() === ""
    || skeletons.some((skeleton) => before === skeleton.prefix && after === skeleton.suffix);
  if (!generatedOnly) return false;
  const metadata = parseGeneratedRegionMetadata(region.startMarker);
  return metadata.outputDigest !== undefined
    && digestJson({ targetId, body: `${region.body.trimEnd()}\n` } as unknown as Json) === metadata.outputDigest;
}

/**
 * True only for a retired changelog that is its one intact generated region holding the empty-state
 * line. Human text, a missing or unusable marker, or any timeline entry is left for a human.
 */
export function retiredChangelogHoldsOnlyPlaceholder(body: string): boolean {
  const { targetId, placeholderBody } = RETIRED_ARCHITECTURE_CHANGELOG;
  const region = findGeneratedRegion(body, targetId);
  return region !== undefined && `${region.body.trimEnd()}\n` === placeholderBody && orphanHoldsOnlyIntactGeneratedRegion(body, targetId, []);
}

export function findGeneratedRegion(body: string, targetId: string): { start: number; end: number; startMarker: string; body: string } | undefined {
  const region = scanDocumentRegions(body, { generatedBodyLiterals: false }).generatedRegions.find(region => region.targetId === targetId && region.closed);
  if (!region) return undefined;
  const endMarker = generatedEndMarker(targetId);
  const endIndex = region.bodyEnd;
  if (!body.startsWith(endMarker, endIndex)) return undefined;
  const regionStart = region.start;
  const regionEnd = endIndex + endMarker.length + (body[endIndex + endMarker.length] === "\n" ? 1 : 0);
  const generatedBody = body.slice(region.bodyStart, endIndex).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  return { start: regionStart, end: regionEnd, startMarker: region.startMarker, body: generatedBody };
}

export function findAnyGeneratedRegion(body: string): { targetId: string } | undefined {
  const region = scanDocumentRegions(body, { generatedBodyLiterals: false }).generatedRegions.find(region => region.targetId !== undefined);
  return region ? { targetId: region.targetId! } : undefined;
}

export function parseGeneratedRegionMetadata(marker: string): { outputDigest?: string } {
  return { outputDigest: generatedMarkerAttributes(marker).attributes.outputDigest };
}

/**
 * Marker attributes are limited to what identifies the region and what a reader can verify against
 * the body in front of them: the target, the renderer version and the digest of the region body.
 * No source digest enters it. The model-wide digest would rewrite every repository-wide document on
 * each model change although its output did not change, and a source-footprint digest would
 * rewrite a module document every time the code under the node's footprint moved.
 */
export function generatedStartMarker(
  targetId: string,
  rendererVersion: string,
  outputDigest: string
): string {
  return `${ARCHITECTURE_DOCS_GENERATED_BEGIN_PREFIX} target="${targetId}" rendererVersion="${rendererVersion}" outputDigest="${outputDigest}" -->`;
}

export function generatedEndMarker(targetId: string): string {
  return `${ARCHITECTURE_DOCS_GENERATED_END_PREFIX} target="${targetId}" -->`;
}

/** The Markdown documents a `mixed` target can own a marked region in; only these are scanned for markers. */
export function isManagedArchitectureDocumentationMarkdownPath(path: string): boolean {
  return /^docs\/architecture\/(modules|relations)\/.+\.md$/.test(path)
    || path === "docs/architecture/index.md"
    || path === "docs/architecture/decisions/index.md";
}
