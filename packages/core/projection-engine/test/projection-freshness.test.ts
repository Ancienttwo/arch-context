import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  REPO_HARNESS_PROJECTION_PROFILE,
  architectureDocumentationSourceTreeDigest,
  architectureDocumentationProjectionProvenance,
  architectureProjectionFootprintOwners,
  architectureProjectionFreshnessWithoutBaseline,
  loadCapabilitySourceFootprintDigests,
  ProjectionFootprintUncoveredError,
  loadCapabilitySourceScaleSignals,
  readCommittedArchitectureDocsProjectionManifest,
  renderArchitectureDocumentationProjection,
  type ArchitectureDocumentationExistingFile,
  type ArchitectureProjectionProfile,
  type NativeModel
} from "../src/index";
import { fixtureSourceFiles } from "./fixture-source-files";

const sourceDigest = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
const provenance = provenanceFor(sourceDigest);

function provenanceFor(modelDigest: string) {
  return architectureDocumentationProjectionProvenance({
    sourceTreeDigest: sourceDigest,
    modelDigest,
    rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION, layoutVersion: ARCHITECTURE_DOCS_LAYOUT_VERSION,
    generatedFrom: { codeGraphPackage: "@colbymchenry/codegraph", codeGraphVersion: "1.6.2" }
  });
}

const model: NativeModel = {
  nodes: [
    {
      id: "capability.docs.projection",
      kind: "capability",
      name: "Docs Projection",
      status: "active",
      source: {
        include: ["packages/core/projection-engine/**"],
        exclude: ["packages/core/projection-engine/test/**"]
      }
    },
    {
      id: "capability.review.gate",
      kind: "capability",
      name: "Review Gate",
      status: "active",
      source: { include: ["packages/core/review-engine/**"] }
    },
    {
      id: "module.no-source",
      kind: "module",
      name: "No Source Module"
    }
  ],
  relations: []
};

function withRepository(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "archctx-source-footprint-"));
  try {
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), body);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function footprintDigest(root: string, nodeId: string): string {
  const entry = loadCapabilitySourceFootprintDigests(root, model, fixtureSourceFiles(root)).find((footprint) => footprint.nodeId === nodeId);
  if (!entry) throw new Error(`no footprint for ${nodeId}`);
  return entry.digest;
}

describe("capability source footprint digests", () => {
  test("source snapshot hashes uncommitted declared bytes and ignores projection-owned docs", () => {
    const sourceModel: NativeModel = {
      nodes: [{
        id: "capability.docs.runtime",
        kind: "capability",
        name: "Docs Runtime",
        source: { include: ["packages/docs-runtime/**", "docs/architecture/**"] }
      }],
      relations: []
    };
    withRepository({
      "packages/docs-runtime/src/index.ts": "export const version = 1;\n",
      "docs/architecture/index.md": "# First projection\n"
    }, (root) => {
      const initial = architectureDocumentationSourceTreeDigest(root, sourceModel, fixtureSourceFiles(root));
      writeFileSync(join(root, "docs/architecture/index.md"), "# Edited projection\n");
      expect(architectureDocumentationSourceTreeDigest(root, sourceModel, fixtureSourceFiles(root))).toBe(initial);
      writeFileSync(join(root, "packages/docs-runtime/src/index.ts"), "export const version = 2;\n");
      expect(architectureDocumentationSourceTreeDigest(root, sourceModel, fixtureSourceFiles(root))).not.toBe(initial);
    });
  });

  test("a footprint digest is one content digest per declared node and moves only with covered bytes or paths", () => {
    withRepository({
      "packages/core/projection-engine/src/index.ts": "export const engine = 1;\n",
      "packages/core/projection-engine/test/engine.test.ts": "test('engine');\n",
      "packages/core/review-engine/src/index.ts": "export const review = 1;\n",
      "README.md": "# repository\n"
    }, (root) => {
      const footprints = loadCapabilitySourceFootprintDigests(root, model, fixtureSourceFiles(root));
      expect(footprints.map((entry) => [entry.nodeId, entry.fileCount])).toEqual([
        ["capability.docs.projection", 1],
        ["capability.review.gate", 1]
      ]);
      for (const entry of footprints) expect(entry.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      const initial = footprintDigest(root, "capability.docs.projection");
      const review = footprintDigest(root, "capability.review.gate");

      // Outside the footprint, excluded by the node itself, or written by the projection: no move.
      writeFileSync(join(root, "README.md"), "# edited\n");
      writeFileSync(join(root, "packages/core/projection-engine/test/engine.test.ts"), "test('edited');\n");
      mkdirSync(join(root, "docs/architecture"), { recursive: true });
      writeFileSync(join(root, "docs/architecture/index.md"), "# projection\n");
      writeFileSync(join(root, "packages/core/projection-engine/AGENTS.md"), "# agent context\n");
      writeFileSync(join(root, "packages/core/projection-engine/CLAUDE.md"), "# agent context\n");
      expect(footprintDigest(root, "capability.docs.projection")).toBe(initial);

      // Bytes, additions and renames inside the footprint each move it — and only this node's digest.
      writeFileSync(join(root, "packages/core/projection-engine/src/index.ts"), "export const engine = 2;\n");
      const edited = footprintDigest(root, "capability.docs.projection");
      expect(edited).not.toBe(initial);
      writeFileSync(join(root, "packages/core/projection-engine/src/extra.ts"), "export const extra = 1;\n");
      const added = footprintDigest(root, "capability.docs.projection");
      expect(added).not.toBe(edited);
      renameSync(join(root, "packages/core/projection-engine/src/extra.ts"), join(root, "packages/core/projection-engine/src/renamed.ts"));
      expect(footprintDigest(root, "capability.docs.projection")).not.toBe(added);
      expect(footprintDigest(root, "capability.review.gate")).toBe(review);
    });
  });
});

test("a CRLF checkout measures the same footprint as an LF one", () => {
  // `core.autocrlf` checkouts (Windows) must measure the runtime source tree digest an LF clone measures.
  withRepository({ "packages/core/review-engine/src/index.ts": "export const review = 1;\nexport const gate = 2;\n" }, (lf) => {
    withRepository({ "packages/core/review-engine/src/index.ts": "export const review = 1;\r\nexport const gate = 2;\r\n" }, (crlf) => {
      expect(footprintDigest(crlf, "capability.review.gate")).toBe(footprintDigest(lf, "capability.review.gate"));
      expect(architectureDocumentationSourceTreeDigest(crlf, model, fixtureSourceFiles(crlf))).toBe(architectureDocumentationSourceTreeDigest(lf, model, fixtureSourceFiles(lf)));
      // A lone CR is content, not a line ending, and still moves the digest.
      writeFileSync(join(crlf, "packages/core/review-engine/src/index.ts"), "export const review = 1;\rexport const gate = 2;\n");
      expect(footprintDigest(crlf, "capability.review.gate")).not.toBe(footprintDigest(lf, "capability.review.gate"));
    });
  });
});

test("scale signals subtract projection-owned paths, so an apply cannot move its own scale (ADR-0056 §6)", () => {
  const sourceModel: NativeModel = {
    nodes: [{ id: "capability.docs.runtime", kind: "capability", name: "Docs Runtime", source: { include: ["packages/docs-runtime/**", "docs/architecture/**"] } }],
    relations: []
  };
  withRepository({ "packages/docs-runtime/src/index.ts": "export const version = 1;\n", "docs/architecture/index.md": "# projection\n\nbody\n" }, (root) => {
    expect(loadCapabilitySourceScaleSignals(root, sourceModel, fixtureSourceFiles(root)).map(({ nodeId, fileCount, lineCount }) => ({ nodeId, fileCount, lineCount })))
      .toEqual([{ nodeId: "capability.docs.runtime", fileCount: 1, lineCount: 1 }]);
  });
});

describe("render-equivalent projection freshness (ADR-0056 §1)", () => {
  // One capability with two members that declare their own footprint; under repo-harness/v1 only the
  // capability has a document, and it prints every footprint's scale.
  const capabilityId = "capability.app.core";
  const componentId = "component.app.core.engine";
  const toolingId = "module.app.tooling";
  const memberModel: NativeModel = {
    nodes: [
      { id: capabilityId, kind: "capability", name: "App Core", status: "active", source: { include: ["packages/app/**/src/**"] }, extensions: { contractFiles: { agents: "packages/app/AGENTS.md", claude: "packages/app/CLAUDE.md" } } },
      { id: componentId, kind: "component", name: "Engine", status: "active", parent: capabilityId, source: { include: ["packages/app/engine/src/**"] } },
      { id: toolingId, kind: "module", name: "Tooling", status: "active", parent: capabilityId, source: { include: ["scripts/**"] } }
    ],
    relations: []
  };
  const memberFiles = {
    "packages/app/api/src/index.ts": "export const api = 1;\n",
    "packages/app/engine/src/index.ts": "export const engine = 1;\n",
    "scripts/release.ts": "export const release = 1;\n"
  };

  function render(root: string, options: { profile?: ArchitectureProjectionProfile; model?: NativeModel; modelDigest?: string; existingFiles?: ArchitectureDocumentationExistingFile[] } = {}) {
    const renderedModel = options.model ?? memberModel;
    return renderArchitectureDocumentationProjection({
      model: renderedModel,
      profile: options.profile ?? REPO_HARNESS_PROJECTION_PROFILE,
      sourceDigest,
      provenance: provenanceFor(options.modelDigest ?? sourceDigest),
      sourceScaleSignals: loadCapabilitySourceScaleSignals(root, renderedModel, fixtureSourceFiles(root)),
      importGraphs: [],
      selectorEvidence: [],
      ...(options.existingFiles ? { existingFiles: options.existingFiles } : {})
    });
  }

  function committed(plan: ReturnType<typeof render>): ArchitectureDocumentationExistingFile[] {
    return [...plan.files, plan.manifest].map(({ path, body }) => ({ path, body }));
  }

  test("a source edit that renders nothing new is fresh and leaves the manifest and every document byte-identical", () => {
    withRepository(memberFiles, (root) => {
      const applied = render(root);
      writeFileSync(join(root, "scripts/release.ts"), "export const release = 2;\n");
      const next = render(root, { existingFiles: committed(applied) });
      expect(next.freshness).toEqual({
        schemaVersion: "archcontext.projection-freshness/v3",
        ok: true,
        reasonCodes: [],
        detail: "every target renders the output its committed row records",
        staleTargets: []
      });
      expect(next.drift.ok).toBe(true);
      expect(committed(next)).toEqual(committed(applied));
    });
  });

  test("a target that renders another output is stale, with both digests", () => {
    withRepository(memberFiles, (root) => {
      const applied = render(root);
      // Two more engine files move the component into the next file bucket, which the capability's component table prints.
      writeFileSync(join(root, "packages/app/engine/src/a.ts"), "export const a = 1;\n");
      writeFileSync(join(root, "packages/app/engine/src/b.ts"), "export const b = 1;\n");
      const next = render(root, { existingFiles: committed(applied) });
      const targetId = "projection_target.entity.capability-app-core";
      expect(next.freshness.reasonCodes).toEqual(["projection-output-changed"]);
      expect<unknown>(next.freshness.staleTargets).toEqual([{
        targetId,
        path: applied.renderedTargets[targetId]!.path,
        committedOutputDigest: applied.renderedTargets[targetId]!.outputDigest,
        renderedOutputDigest: next.renderedTargets[targetId]!.outputDigest
      }]);
      // Freshness that is not ok implies drift that is not ok.
      expect(next.drift.ok).toBe(false);
    });
  });

  test("a target on one side only is stale with a null digest on the other", () => {
    withRepository(memberFiles, (root) => {
      const applied = render(root, { profile: "default" });
      const withoutTooling: NativeModel = { ...memberModel, nodes: memberModel.nodes.filter((node) => node.id !== toolingId) };
      const next = render(root, { profile: "default", model: withoutTooling, existingFiles: committed(applied) });
      const removed = next.freshness.staleTargets.find((target) => target.targetId === "projection_target.entity.module-app-tooling");
      expect<unknown>(removed).toEqual({
        targetId: "projection_target.entity.module-app-tooling",
        path: applied.renderedTargets["projection_target.entity.module-app-tooling"]!.path,
        committedOutputDigest: applied.renderedTargets["projection_target.entity.module-app-tooling"]!.outputDigest,
        renderedOutputDigest: null
      });
    });
  });

  test("equal outputs under a manifest the render would write differently report projection-manifest-changed", () => {
    withRepository(memberFiles, (root) => {
      const applied = render(root);
      // A model edit no document prints moves only semanticBaseline.modelDigest.
      const next = render(root, { modelDigest: `sha256:${"9".repeat(64)}`, existingFiles: committed(applied) });
      expect(next.freshness).toMatchObject({ ok: false, reasonCodes: ["projection-manifest-changed"], staleTargets: [] });
    });
  });

  test("without a current-format manifest, freshness says why and compares nothing", () => {
    expect(architectureProjectionFreshnessWithoutBaseline(undefined)).toMatchObject({ ok: false, reasonCodes: ["projection-manifest-missing"], staleTargets: [] });
    expect(architectureProjectionFreshnessWithoutBaseline("{ not json")).toMatchObject({ ok: false, reasonCodes: ["projection-manifest-unreadable"], staleTargets: [] });
    withRepository(memberFiles, (root) => {
      expect(render(root).freshness.reasonCodes).toEqual(["projection-manifest-missing"]);
      expect(readCommittedArchitectureDocsProjectionManifest("{ not json")).toBeUndefined();
    });
  });

  test("a superseded manifest is read for its schemaVersion only and refused (#327, ADR-0056 §11)", () => {
    for (const version of ["v1", "v2", "v3"]) {
      const schemaVersion = `archcontext.architecture-docs-projection-manifest/${version}`;
      expect(() => readCommittedArchitectureDocsProjectionManifest(`${JSON.stringify({ schemaVersion, targets: {} }, null, 2)}\n`))
        .toThrow(`projection-manifest-upgrade-required: docs/architecture/.projection-manifest.json is ${schemaVersion}`);
    }
  });

  test("a committed v3 manifest is refused, and the docs apply re-baseline writes v4 as a first projection would (ADR-0056 §11)", () => {
    withRepository(memberFiles, (root) => {
      const current = render(root);
      const v3Manifest = { ...JSON.parse(current.manifest.body), schemaVersion: "archcontext.architecture-docs-projection-manifest/v3" };
      const documents = current.files.map(({ path, body }) => ({ path, body }));
      const existingFiles = [...documents, { path: current.manifest.path, body: `${JSON.stringify(v3Manifest, null, 2)}\n` }];
      expect(() => render(root, { existingFiles })).toThrow("projection-manifest-upgrade-required");
      const upgraded = renderArchitectureDocumentationProjection({
        model: memberModel,
        profile: REPO_HARNESS_PROJECTION_PROFILE,
        sourceDigest,
        provenance,
        sourceScaleSignals: loadCapabilitySourceScaleSignals(root, memberModel, fixtureSourceFiles(root)),
        importGraphs: [],
        selectorEvidence: [],
        existingFiles,
        rebaselineSupersededManifest: true
      });
      expect(JSON.parse(upgraded.manifest.body).schemaVersion).toBe("archcontext.architecture-docs-projection-manifest/v4");
      expect(upgraded.manifest.body).toBe(current.manifest.body);
      expect(upgraded.drift.diffs.map((diff) => diff.path)).toEqual([current.manifest.path]);
    });
  });

  test("a declared footprint that no entity-summary target documents is refused with projection-footprint-uncovered (#327)", () => {
    // Under repo-harness/v1 only capabilities have a document, so a tooling module outside the
    // capability has no node or ancestor to document its footprint.
    const orphanModel: NativeModel = {
      ...memberModel,
      nodes: memberModel.nodes.map((node) => node.id === toolingId ? { ...node, parent: undefined } : node)
    };
    expect(() => architectureProjectionFootprintOwners(orphanModel, REPO_HARNESS_PROJECTION_PROFILE))
      .toThrow(`projection-footprint-uncovered: ${toolingId} declare source.include, but neither the node nor an ancestor has an entity-summary target under profile repo-harness/v1`);
    withRepository(memberFiles, (root) => {
      let thrown: unknown;
      try {
        render(root, { model: orphanModel });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ProjectionFootprintUncoveredError);
      expect((thrown as ProjectionFootprintUncoveredError).nodeIds).toEqual([toolingId]);
    });
    // Under the default profile every node has a document, so the same model is covered.
    expect([...architectureProjectionFootprintOwners(orphanModel, "default").keys()]).toEqual([capabilityId, componentId, toolingId]);
  });
});
