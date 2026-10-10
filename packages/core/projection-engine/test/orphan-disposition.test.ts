import { expect, test } from "bun:test";
import { digestJson, type Json } from "@archcontext/contracts";
import {
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  architectureDocumentationProjectionProvenance,
  renderArchitectureDocumentationProjection,
  type NativeModel
} from "../src/index";

const sourceDigest = `sha256:${"2".repeat(64)}`;
const provenance = architectureDocumentationProjectionProvenance({
  sourceTreeDigest: sourceDigest,
  modelDigest: sourceDigest,
  codeGraphDigest: sourceDigest,
  indexedWorktreeDigest: null,
  rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION,
  layoutVersion: ARCHITECTURE_DOCS_LAYOUT_VERSION,
  generatedFrom: { codeGraphPackage: "@colbymchenry/codegraph", codeGraphVersion: "1.6.1", codeGraphStatus: "unavailable" }
});
const model: NativeModel = { nodes: [{ id: "module.payment", kind: "module", name: "Payment" }], relations: [] };

function render(existingFiles: { path: string; body: string }[]) {
  return renderArchitectureDocumentationProjection({
    model,
    provenance,
    sourceDigest,
    sourceFootprints: [],
    sourceScaleSignals: [],
    importGraphs: [],
    selectorEvidence: [],
    generatedAt: "2026-06-26T00:00:00.000Z",
    existingFiles
  });
}

/** A generated region exactly as the renderer writes it, with a marker that matches its body. */
function orphanRegion(targetId: string, body: string, outputDigest = digestJson({ targetId, body } as unknown as Json)): string {
  return [
    `<!-- BEGIN ARCHCONTEXT:generated target="${targetId}" sourceDigest="${sourceDigest}" rendererVersion="${ARCHITECTURE_DOCS_RENDERER_VERSION}" outputDigest="${outputDigest}" -->`,
    body.trimEnd(),
    `<!-- END ARCHCONTEXT:generated target="${targetId}" -->`,
    ""
  ].join("\n");
}

test("orphaned documents are deletable only when they hold nothing but an intact generated region (#268)", () => {
  const clean = render([]);
  const existing = [...clean.files.map(({ path, body }) => ({ path, body })), clean.manifest];
  const intact = orphanRegion("projection_target.entity.intact", "# Intact\n");
  const orphans = render([
    ...existing,
    { path: "docs/architecture/modules/intact.md", body: intact },
    { path: "docs/architecture/modules/annotated.md", body: `# Human title\n\n${orphanRegion("projection_target.entity.annotated", "# Annotated\n")}\n## Notes\nkeep me\n` },
    { path: "docs/architecture/modules/edited.md", body: orphanRegion("projection_target.entity.edited", "# Edited by hand\n", `sha256:${"b".repeat(64)}`) },
    { path: "docs/architecture/modules/unterminated.md", body: intact.replace(/<!-- END[^>]*-->\n/, "") }
  ]);
  expect(orphans.orphans.map((orphan) => [orphan.path, orphan.disposition])).toEqual([
    ["docs/architecture/modules/annotated.md", "human-review"],
    ["docs/architecture/modules/edited.md", "human-review"],
    ["docs/architecture/modules/intact.md", "delete"],
    ["docs/architecture/modules/unterminated.md", "human-review"]
  ]);
  // Every orphan is still drift; the disposition only says who may remove it.
  expect(orphans.drift.diffs.filter((diff) => diff.reasonCode === "projection-orphaned").map((diff) => diff.path))
    .toEqual(orphans.orphans.map((orphan) => orphan.path));
  expect(orphans.orphans.find((orphan) => orphan.path.endsWith("intact.md"))!.actualDigest)
    .toBe(digestJson({ path: "docs/architecture/modules/intact.md", body: intact } as unknown as Json));
  expect(render(existing).orphans).toEqual([]);
});
