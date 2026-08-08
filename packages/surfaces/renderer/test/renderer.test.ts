import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import {
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  exportMermaidModel,
  loadArchitectureDocumentationInputs,
  loadNativeModelFromArchContext,
  normalizeNativeModel,
  renderArchitectureDocumentationProjection,
  type NativeModel
} from "../src/index";

const model: NativeModel = {
  nodes: [
    { id: "module.payment", kind: "module", name: "Payment" },
    { id: "module.subscription", kind: "module", name: "Subscription" }
  ],
  relations: [
    { id: "relation.subscription-calls-payment", kind: "calls", source: "module.subscription", target: "module.payment", intent: "charge" }
  ]
};

// Fail-closed Git provenance required by renderArchitectureDocumentationProjection.
const verifiedAgainst = { branch: "main", commit: "7415329", committedAt: "2026-08-08T00:00:00Z" };
const sourceScaleSignals: never[] = [];
// No node in this fixture declares source.include/entrypoints, so the P1/P2 diagram inputs are
// empty measurements rather than missing ones.
const importGraphs: never[] = [];
const entrypointCallGraphs: never[] = [];
// No node declares source.include either, so no covered source change is possible and the stamp
// lifecycle needs no measurement.
const sourceChangesSinceStamp: never[] = [];

describe("@archcontext/surfaces/renderer", () => {
  test("normalizes model and exports deterministic Mermaid projection", () => {
    const first = exportMermaidModel(model);
    const second = exportMermaidModel({ nodes: [...model.nodes].reverse(), relations: [...model.relations] });
    expect(first.files[0].content).toBe(second.files[0].content);
    expect(first.files[0].content).toContain("module_subscription");
    expect(first.digest).toBe(second.digest);
    expect(normalizeNativeModel(model).nodes.map((node) => node.id)).toEqual(["module.payment", "module.subscription"]);
  });

  test("loads native model from initialized ArchContext files", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-renderer-"));
    try {
      writeFileSync(join(root, "README.md"), "# tmp\n");
      initializeArchContextModel(root, "Renderer App");
      const loaded = loadNativeModelFromArchContext(root);
      expect(loaded.nodes.map((node) => node.id)).toContain("capability.architecture-context");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("exports a larger model deterministically without dropping relations", () => {
    const nodes = Array.from({ length: 250 }, (_, index) => ({
      id: `module.service-${index.toString().padStart(3, "0")}`,
      kind: "module",
      name: `Service ${index}`
    }));
    const relations = nodes.slice(1).map((node, index) => ({
      id: `relation.service-${index.toString().padStart(3, "0")}`,
      kind: "calls",
      source: nodes[index].id,
      target: node.id,
      intent: "large model regression"
    }));
    const first = exportMermaidModel({ nodes, relations });
    const second = exportMermaidModel({ nodes: [...nodes].reverse(), relations: [...relations].reverse() });
    expect(first.digest).toBe(second.digest);
    expect(first.files[0].content.match(/-->/g)?.length).toBe(249);
  });

  test("renders deterministic architecture documentation projection targets", () => {
    const sourceDigest = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
    const first = renderArchitectureDocumentationProjection({
      verifiedAgainst,
      sourceChangesSinceStamp,
      sourceScaleSignals,
      importGraphs,
      entrypointCallGraphs,
      model,
      sourceDigest,
      generatedAt: "2026-06-26T00:00:00.000Z",
      decisions: [{ id: "ADR-0001-test", title: "Use Local Runtime", path: "docs/adr/ADR-0001-test.md", status: "Accepted" }],
      timeline: [{ eventId: "architecture_event.test", timestamp: "2026-06-26T00:00:00.000Z", title: "Added payment module", affectedSubjects: ["module.payment"] }]
    });
    const second = renderArchitectureDocumentationProjection({
      verifiedAgainst,
      sourceChangesSinceStamp,
      sourceScaleSignals,
      importGraphs,
      entrypointCallGraphs,
      model: { nodes: [...model.nodes].reverse(), relations: [...model.relations].reverse() },
      sourceDigest,
      generatedAt: "2026-06-26T00:00:00.000Z",
      decisions: [{ id: "ADR-0001-test", title: "Use Local Runtime", path: "docs/adr/ADR-0001-test.md", status: "Accepted" }],
      timeline: [{ eventId: "architecture_event.test", timestamp: "2026-06-26T00:00:00.000Z", title: "Added payment module", affectedSubjects: ["module.payment"] }]
    });

    expect(first.projectionDigest).toBe(second.projectionDigest);
    expect(first.rendererVersion).toBe(ARCHITECTURE_DOCS_RENDERER_VERSION);
    expect(first.targets.map((target) => target.type).sort()).toEqual([
      "architecture-changelog",
      "architecture-index",
      "decision-index",
      "diagram-likec4",
      "diagram-mermaid",
      "diagram-structurizr",
      "entity-summary",
      "entity-summary",
      "relation-summary"
    ]);
    expect(first.files.find((file) => file.path === "docs/architecture/index.md")?.body).toContain("BEGIN ARCHCONTEXT:generated");
    expect(first.files.find((file) => file.path.endsWith("architecture.structurizr.json"))?.body).toContain("archcontext.structurizr-export/v1");
    expect(first.files.find((file) => file.path.endsWith("architecture.likec4"))?.body).toContain("specification");
    expect(first.files.find((file) => file.path.endsWith("module-payment.md"))?.body).toContain("### 1.4 依賴邊界");
  });

  test("preserves human-authored regions and detects projection drift classes", () => {
    const sourceDigest = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
    const markerFree = renderArchitectureDocumentationProjection({
      verifiedAgainst,
      sourceChangesSinceStamp,
      sourceScaleSignals,
      importGraphs,
      entrypointCallGraphs,
      model,
      sourceDigest,
      generatedAt: "2026-06-26T00:00:00.000Z",
      existingFiles: [{ path: "docs/architecture/index.md", body: "# Architecture Index\n\nHuman note.\n" }]
    });
    const candidate = markerFree.adoptionCandidates.find((file) => file.path === "docs/architecture/index.md")!;
    expect(markerFree.files.some((file) => file.path === "docs/architecture/index.md")).toBe(false);
    expect(candidate.body).toContain("Human note.");
    expect(candidate.body).toContain("BEGIN ARCHCONTEXT:generated");
    expect(markerFree.drift.reasonCodes).toContain("projection-adoption-required");

    const seeded = renderArchitectureDocumentationProjection({
      verifiedAgainst,
      sourceChangesSinceStamp,
      sourceScaleSignals,
      importGraphs,
      entrypointCallGraphs,
      model,
      sourceDigest,
      generatedAt: "2026-06-26T00:00:00.000Z"
    });
    const preserved = renderArchitectureDocumentationProjection({
      verifiedAgainst,
      sourceChangesSinceStamp,
      sourceScaleSignals,
      importGraphs,
      entrypointCallGraphs,
      model,
      sourceDigest,
      generatedAt: "2026-06-26T00:00:00.000Z",
      existingFiles: [
        ...seeded.files.map(({ path, body }) => ({
          path,
          body: path === "docs/architecture/index.md" ? `Human note.\n\n${body}` : body
        })),
        seeded.manifest
      ]
    });
    expect(preserved.files.find((file) => file.path === "docs/architecture/index.md")?.body).toStartWith("Human note.\n\n");

    const clean = renderArchitectureDocumentationProjection({
      verifiedAgainst,
      sourceChangesSinceStamp,
      sourceScaleSignals,
      importGraphs,
      entrypointCallGraphs,
      model,
      sourceDigest,
      generatedAt: "2026-06-26T00:00:00.000Z",
      existingFiles: [...preserved.files.map(({ path, body }) => ({ path, body })), preserved.manifest]
    });
    expect(clean.drift.ok).toBe(true);

    const stale = renderArchitectureDocumentationProjection({
      verifiedAgainst,
      sourceChangesSinceStamp,
      sourceScaleSignals,
      importGraphs,
      entrypointCallGraphs,
      model,
      sourceDigest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      generatedAt: "2026-06-26T00:00:00.000Z",
      existingFiles: [...clean.files.map(({ path, body }) => ({ path, body })), clean.manifest]
    });
    expect(stale.drift.reasonCodes).toContain("projection-generated-region-stale");

    const edited = renderArchitectureDocumentationProjection({
      verifiedAgainst,
      sourceChangesSinceStamp,
      sourceScaleSignals,
      importGraphs,
      entrypointCallGraphs,
      model,
      sourceDigest,
      generatedAt: "2026-06-26T00:00:00.000Z",
      existingFiles: [
        ...clean.files.map(({ path, body }) => ({
          path,
          body: path === "docs/architecture/index.md" ? body.replace("Payment", "Manual Payment Edit") : body
        })),
        clean.manifest
      ]
    });
    expect(edited.drift.reasonCodes).toContain("projection-generated-region-manually-edited");

    const orphaned = renderArchitectureDocumentationProjection({
      verifiedAgainst,
      sourceChangesSinceStamp,
      sourceScaleSignals,
      importGraphs,
      entrypointCallGraphs,
      model,
      sourceDigest,
      generatedAt: "2026-06-26T00:00:00.000Z",
      existingFiles: [
        ...clean.files.map(({ path, body }) => ({ path, body })),
        clean.manifest,
        {
          path: "docs/architecture/modules/obsolete.md",
          body: [
            "<!-- BEGIN ARCHCONTEXT:generated target=\"projection_target.entity.obsolete\" sourceDigest=\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\" rendererVersion=\"archcontext.docs-renderer/v1\" outputDigest=\"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\" -->",
            "# Obsolete",
            "<!-- END ARCHCONTEXT:generated target=\"projection_target.entity.obsolete\" -->",
            ""
          ].join("\n")
        }
      ]
    });
    expect(orphaned.drift.reasonCodes).toContain("projection-orphaned");
  });

  test("loads documentation inputs from repo files including ADRs and existing docs", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-docs-renderer-"));
    try {
      writeFileSync(join(root, "README.md"), "# tmp\n");
      initializeArchContextModel(root, "Docs Projection App");
      mkdirSync(join(root, "docs/adr"), { recursive: true });
      writeFileSync(join(root, "docs/adr/ADR-0001-test.md"), "# ADR 0001: Test Decision\n\nStatus: Accepted\n", "utf8");
      const loaded = loadArchitectureDocumentationInputs(root);
      expect(loaded.model.nodes.map((node) => node.id)).toContain("capability.architecture-context");
      expect(loaded.decisions).toContainEqual(expect.objectContaining({ id: "ADR-0001-test", title: "ADR 0001: Test Decision", status: "Accepted" }));
      expect(loaded.existingFiles.some((file) => file.path === "docs/architecture/index.md")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
