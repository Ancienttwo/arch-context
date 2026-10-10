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
  rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION,
  layoutVersion: ARCHITECTURE_DOCS_LAYOUT_VERSION,
  generatedFrom: { codeGraphPackage: "@colbymchenry/codegraph", codeGraphVersion: "1.6.1" }
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

test("an untouched renderer-written document of a removed node is deletable; one human line in a skeleton section needs review (#276)", () => {
  const withBilling: NativeModel = { ...model, nodes: [...model.nodes, { id: "module.billing", kind: "module", name: "Billing" }] };
  const written = renderArchitectureDocumentationProjection({
    model: withBilling,
    provenance,
    sourceDigest,
    sourceFootprints: [],
    sourceScaleSignals: [],
    importGraphs: [],
    selectorEvidence: [],
    generatedAt: "2026-06-26T00:00:00.000Z",
    existingFiles: []
  });
  const existing = [...written.files.map(({ path, body }) => ({ path, body })), written.manifest];
  const billing = written.files.find((file) => file.target.scope.id === "module.billing")!;
  // The renderer writes a skeleton outside the region: the title and empty §3/§4/Backlog headings.
  expect(billing.body).toStartWith("# module/billing 架構文檔\n\n<!-- BEGIN ARCHCONTEXT:generated");
  expect(billing.body).toContain("## 3. P3:設計決策與不變量");

  const untouched = render(existing);
  expect(untouched.orphans.map((orphan) => [orphan.path, orphan.disposition])).toEqual([[billing.path, "delete"]]);

  const section3 = "## 3. P3:設計決策與不變量\n";
  const annotated = billing.body.replace(section3, `${section3}Billing retries are idempotent.\n`);
  const retitled = billing.body.replace("# module/billing 架構文檔", "# Billing 架構文檔");
  const review = render(existing.map((file) => file.path === billing.path ? { ...file, body: annotated } : file));
  expect(review.orphans.map((orphan) => [orphan.path, orphan.disposition])).toEqual([[billing.path, "human-review"]]);
  expect(render(existing.map((file) => file.path === billing.path ? { ...file, body: retitled } : file)).orphans
    .map((orphan) => orphan.disposition)).toEqual(["human-review"]);

  // The skeleton is the committed manifest's record of that path; without it only whitespace may surround the region.
  const withoutManifest = render(existing.filter((file) => file.path !== written.manifest.path));
  expect(withoutManifest.orphans.map((orphan) => [orphan.path, orphan.disposition])).toEqual([[billing.path, "human-review"]]);
});
