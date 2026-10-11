import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { architectureDocsProjectionManifestIssues } from "@archcontext/contracts";
import {
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  REPO_HARNESS_PROJECTION_PROFILE,
  architectureDocumentationSourceTreeDigest,
  architectureDocumentationProjectionProvenance,
  architectureProjectionStampedNodeIds,
  evaluateArchitectureProjectionFreshness,
  evaluateArchitectureProjectionSnapshotFreshness,
  loadArchitectureProjectionManifestStamps,
  loadCapabilitySourceFootprintDigests,
  loadCapabilitySourceScaleSignals,
  renderArchitectureDocumentationProjection,
  type ArchitectureProjectionManifestStampReadback,
  type ArchitectureProjectionProfile,
  type CapabilitySourceFootprintDigest,
  type NativeModel
} from "../src/index";
import { fixtureSourceFiles } from "./fixture-source-files";

const sourceDigest = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
const docsDigest = `sha256:${"a".repeat(64)}`;
const reviewDigest = `sha256:${"b".repeat(64)}`;
const movedDigest = `sha256:${"c".repeat(64)}`;
const provenance = architectureDocumentationProjectionProvenance({
  sourceTreeDigest: sourceDigest,
  modelDigest: sourceDigest,
  rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION, layoutVersion: ARCHITECTURE_DOCS_LAYOUT_VERSION,
  generatedFrom: { codeGraphPackage: "@colbymchenry/codegraph", codeGraphVersion: "1.6.1" }
});

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

const currentFootprints: CapabilitySourceFootprintDigest[] = [
  { nodeId: "capability.docs.projection", digest: docsDigest, fileCount: 3 },
  { nodeId: "capability.review.gate", digest: reviewDigest, fileCount: 2 }
];

function stamped(stamps: Record<string, unknown>): ArchitectureProjectionManifestStampReadback {
  return {
    status: "present",
    nodes: model.nodes.map((node) => ({ nodeId: node.id, sourceFootprintDigest: stamps[node.id] }))
  };
}

const freshStamps = { "capability.docs.projection": docsDigest, "capability.review.gate": reviewDigest };

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

  test("a stamp is one content digest per declared node and moves only with covered bytes or paths", () => {
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

      // Bytes, additions and renames inside the footprint each move it — and only this node's stamp.
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
  // `core.autocrlf` checkouts (Windows) must not make a node look stale against an LF stamp.
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

describe("architecture projection freshness", () => {
  test("stamps that match the current footprints are fresh", () => {
    const evaluation = evaluateArchitectureProjectionFreshness({ model, manifest: stamped(freshStamps), sourceFootprints: currentFootprints });
    expect(evaluation).toEqual({
      schemaVersion: "archcontext.projection-freshness/v2",
      ok: true,
      reasonCodes: [],
      detail: "no declared capability source changed since its documentation was verified",
      staleNodes: []
    });
  });

  test("a node whose footprint digest moved is stale, with both digests reported", () => {
    const evaluation = evaluateArchitectureProjectionFreshness({
      model,
      manifest: stamped(freshStamps),
      sourceFootprints: [currentFootprints[0]!, { ...currentFootprints[1]!, digest: movedDigest }]
    });
    expect(evaluation.ok).toBe(false);
    expect(evaluation.reasonCodes).toEqual(["projection-source-changed-since-stamp"]);
    expect(evaluation.staleNodes).toEqual([{
      nodeId: "capability.review.gate",
      stampedDigest: reviewDigest,
      currentDigest: movedDigest
    }]);
    expect(evaluation.detail).toContain("capability.review.gate");
  });

  test("overlapping footprints both report stale; ownership ambiguity never drops the signal", () => {
    const evaluation = evaluateArchitectureProjectionFreshness({
      model,
      manifest: stamped(freshStamps),
      sourceFootprints: currentFootprints.map((entry) => ({ ...entry, digest: movedDigest }))
    });
    expect(evaluation.staleNodes.map((node) => node.nodeId)).toEqual(["capability.docs.projection", "capability.review.gate"]);
  });

  test("a missing, legacy commit, or malformed stamp fails closed", () => {
    const missing = evaluateArchitectureProjectionFreshness({
      model,
      manifest: stamped({ "capability.review.gate": reviewDigest }),
      sourceFootprints: currentFootprints
    });
    expect(missing.ok).toBe(false);
    expect(missing.reasonCodes).toEqual(["projection-source-stamp-missing"]);
    expect(missing.detail).toContain("capability.docs.projection");

    // A pre-content-stamp manifest carried `verifiedAgainst` commits; they are never read, so the
    // node has no stamp until it is re-projected once.
    const legacy = evaluateArchitectureProjectionFreshness({
      model,
      manifest: {
        status: "present",
        nodes: model.nodes.map((node) => ({ nodeId: node.id, sourceFootprintDigest: undefined }))
      },
      sourceFootprints: currentFootprints
    });
    expect(legacy.reasonCodes).toEqual(["projection-source-stamp-missing"]);

    for (const hostile of ["--output=output", "7415329", { commit: "7415329" }, `sha256:${"A".repeat(64)}`]) {
      const invalid = evaluateArchitectureProjectionFreshness({
        model,
        manifest: stamped({ ...freshStamps, "capability.docs.projection": hostile }),
        sourceFootprints: currentFootprints
      });
      expect(invalid.ok, JSON.stringify(hostile)).toBe(false);
      expect(invalid.reasonCodes).toEqual(["projection-source-stamp-invalid"]);
    }
  });

  test("a missing or unreadable manifest is reported, never treated as fresh", () => {
    expect(evaluateArchitectureProjectionFreshness({ model, manifest: { status: "manifest-missing" }, sourceFootprints: currentFootprints }).reasonCodes)
      .toEqual(["projection-manifest-missing"]);
    expect(evaluateArchitectureProjectionFreshness({ model, manifest: { status: "manifest-unreadable", reason: "bad" }, sourceFootprints: currentFootprints }).reasonCodes)
      .toEqual(["projection-manifest-unreadable"]);
  });

  test("an unmeasured declared node is a caller error, not a fresh result", () => {
    expect(() => evaluateArchitectureProjectionFreshness({ model, manifest: stamped(freshStamps), sourceFootprints: [currentFootprints[0]!] }))
      .toThrow("architecture-projection-freshness-footprint-unmeasured: capability.review.gate");
  });

  test("dirty source is stale through the snapshot digest, while docs-only bytes keep the snapshot fresh", () => {
    const manifest = { ...stamped(freshStamps), provenance } as const;
    const fresh = evaluateArchitectureProjectionSnapshotFreshness({
      model,
      manifest,
      sourceFootprints: currentFootprints,
      currentSourceTreeDigest: provenance.sourceTreeDigest
    });
    expect(fresh.ok).toBe(true);

    const dirtySource = evaluateArchitectureProjectionSnapshotFreshness({
      model,
      manifest,
      sourceFootprints: currentFootprints,
      currentSourceTreeDigest: `sha256:${"9".repeat(64)}`
    });
    expect(dirtySource.ok).toBe(false);
    expect(dirtySource.reasonCodes).toEqual(["projection-source-tree-digest-mismatch"]);

    const noProvenance = evaluateArchitectureProjectionSnapshotFreshness({
      model,
      manifest: stamped(freshStamps),
      sourceFootprints: currentFootprints,
      currentSourceTreeDigest: provenance.sourceTreeDigest
    });
    expect(noProvenance.reasonCodes).toEqual(["projection-snapshot-provenance-missing"]);
  });

  test("a v2 manifest provenance is never read as v3, even when its sourceTreeDigest matches (#277)", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-freshness-provenance-v2-"));
    try {
      const writeManifest = (value: unknown) => {
        mkdirSync(join(root, "docs/architecture"), { recursive: true });
        writeFileSync(join(root, "docs/architecture/.projection-manifest.json"), `${JSON.stringify(value, null, 2)}\n`);
      };
      const targets = Object.entries(freshStamps).map(([nodeId, sourceFootprintDigest]) => ({ type: "entity-summary", scope: { id: nodeId }, sourceFootprintDigest }));
      const evaluate = () => evaluateArchitectureProjectionSnapshotFreshness({
        model,
        manifest: loadArchitectureProjectionManifestStamps(root),
        sourceFootprints: currentFootprints,
        currentSourceTreeDigest: provenance.sourceTreeDigest
      });

      writeManifest({ targets, provenance });
      expect(evaluate().ok).toBe(true);

      writeManifest({
        targets,
        provenance: {
          ...provenance,
          schemaVersion: "archcontext.architecture-docs-projection-provenance/v2",
          codeGraphDigest: sourceDigest,
          indexedWorktreeDigest: sourceDigest,
          generatedFrom: { ...provenance.generatedFrom, codeGraphStatus: "ready" }
        }
      });
      const v2 = loadArchitectureProjectionManifestStamps(root);
      expect(v2.status).toBe("present");
      expect(v2).not.toHaveProperty("provenance");
      const evaluation = evaluate();
      expect(evaluation.ok).toBe(false);
      expect(evaluation.reasonCodes).toEqual(["projection-snapshot-provenance-missing"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("projection manifest source-footprint stamps", () => {
  const renderInput = {
    model,
    sourceDigest,
    provenance,
    sourceScaleSignals: [
      {
        nodeId: "capability.docs.projection",
        fileCount: 1,
        lineCount: 10,
        includePatterns: ["packages/core/projection-engine/**"],
        excludePatterns: ["packages/core/projection-engine/test/**"]
      },
      {
        nodeId: "capability.review.gate",
        fileCount: 1,
        lineCount: 10,
        includePatterns: ["packages/core/review-engine/**"],
        excludePatterns: []
      }
    ],
    importGraphs: [],
    selectorEvidence: []
  };

  test("the rendered manifest stamps each declared node's footprint and records no commit", () => {
    const plan = renderArchitectureDocumentationProjection({ ...renderInput, sourceFootprints: currentFootprints });
    const manifest = JSON.parse(plan.manifest.body);
    expect(manifest.provenance.schemaVersion).toBe("archcontext.architecture-docs-projection-provenance/v3");
    for (const field of ["baseHeadSha", "worktreeDigest"]) expect(manifest.provenance).not.toHaveProperty(field);
    expect(plan.manifest.body).not.toContain("verifiedAgainst");
    const stamps = Object.fromEntries(manifest.targets
      .filter((target: { type: string }) => target.type === "entity-summary")
      .map((target: { scope: { id: string }; sourceFootprintDigest?: string }) => [target.scope.id, target.sourceFootprintDigest]));
    expect(stamps).toEqual({
      "capability.docs.projection": docsDigest,
      "capability.review.gate": reviewDigest,
      "module.no-source": undefined
    });
    expect(manifest.targets.filter((target: { type: string }) => target.type !== "entity-summary")
      .every((target: { sourceFootprintDigest?: unknown }) => target.sourceFootprintDigest === undefined)).toBe(true);
  });

  test("the manifest publishes the scale buckets each module document prints, under the contract (#264)", () => {
    const plan = renderArchitectureDocumentationProjection({
      ...renderInput,
      sourceScaleSignals: [{ ...renderInput.sourceScaleSignals[0]!, fileCount: 0, lineCount: 537 }, { ...renderInput.sourceScaleSignals[1]!, fileCount: 12, lineCount: 172_275 }],
      sourceFootprints: currentFootprints
    });
    const manifest = JSON.parse(plan.manifest.body);
    expect(architectureDocsProjectionManifestIssues(manifest)).toEqual([]);
    const scales = Object.fromEntries(manifest.targets
      .filter((target: { type: string }) => target.type === "entity-summary")
      .map((target: { scope: { id: string }; scale?: unknown }) => [target.scope.id, target.scale]));
    expect(scales).toEqual({
      "capability.docs.projection": { fileCountBucket: { lower: 0, upper: 1 }, lineCountBucket: { lower: 500, upper: 1000 } },
      "capability.review.gate": { fileCountBucket: { lower: 10, upper: 20 }, lineCountBucket: { lower: 100_000, upper: 200_000 } },
      "module.no-source": undefined
    });
    // The rendered Markdown prints the same buckets.
    const body = (nodeId: string) => plan.files.find((file) => file.target.type === "entity-summary" && file.target.scope.id === nodeId)!.body;
    expect(body("capability.docs.projection")).toContain("- 規模量級:`0` 個文件 / `500–1000` 行");
    expect(body("capability.review.gate")).toContain("- 規模量級:`10–20` 個文件 / `100k–200k` 行");
  });

  test("an unchanged footprint re-renders a byte-identical manifest; a moved one changes only its stamp", () => {
    const first = renderArchitectureDocumentationProjection({ ...renderInput, sourceFootprints: currentFootprints });
    const existingFiles = [...first.files.map((file) => ({ path: file.path, body: file.body })), first.manifest];
    const again = renderArchitectureDocumentationProjection({ ...renderInput, existingFiles, sourceFootprints: currentFootprints });
    expect(again.drift.diffs).toEqual([]);
    expect(again.manifest.body).toBe(first.manifest.body);

    const moved = renderArchitectureDocumentationProjection({
      ...renderInput,
      existingFiles,
      sourceFootprints: [currentFootprints[0]!, { ...currentFootprints[1]!, digest: movedDigest }]
    });
    expect(moved.drift.diffs.map((diff) => diff.path)).toEqual(["docs/architecture/.projection-manifest.json"]);
    expect(moved.files.map((file) => file.body)).toEqual(first.files.map((file) => file.body));
  });

  test("a committed v1 manifest from renderer v4 keeps its semantic baseline, and the plan rewrites every document and the manifest (0.7.0 upgrade)", () => {
    const current = renderArchitectureDocumentationProjection({ ...renderInput, sourceFootprints: currentFootprints });
    const manifestPath = current.manifest.path;
    const v4Renderer = "archcontext.docs-renderer/v4";
    const currentManifest = JSON.parse(current.manifest.body);
    // The shape a 0.6.3 install committed: manifest v1, renderer v4, provenance v1 and commit stamps.
    const v1Manifest = {
      ...currentManifest,
      schemaVersion: "archcontext.architecture-docs-projection-manifest/v1",
      rendererVersion: v4Renderer,
      provenance: {
        ...currentManifest.provenance,
        schemaVersion: "archcontext.architecture-docs-projection-provenance/v1",
        baseHeadSha: "a".repeat(40),
        worktreeDigest: sourceDigest,
        codeGraphDigest: sourceDigest,
        indexedWorktreeDigest: sourceDigest,
        rendererVersion: v4Renderer,
        generatedFrom: { ...currentManifest.provenance.generatedFrom, codeGraphBinaryDigest: sourceDigest, codeGraphStatus: "ready" }
      },
      targets: currentManifest.targets.map(({ sourceFootprintDigest: _stamp, scale: _scale, ...target }: Record<string, unknown>) => ({
        ...target,
        rendererVersion: v4Renderer,
        ...(target.type === "entity-summary" ? { verifiedAgainst: { branch: "main", commit: "7415329", committedAt: "2026-10-05T00:00:00+08:00" } } : {})
      }))
    };
    expect(architectureDocsProjectionManifestIssues(v1Manifest)).toContain("manifest.schemaVersion is unsupported");
    const v4Documents = current.files.map((file) => ({ path: file.path, body: file.body.replaceAll(ARCHITECTURE_DOCS_RENDERER_VERSION, v4Renderer) }));
    const upgradeFrom = (manifest: unknown) => renderArchitectureDocumentationProjection({
      ...renderInput,
      sourceFootprints: currentFootprints,
      existingFiles: [...v4Documents, { path: manifestPath, body: `${JSON.stringify(manifest, null, 2)}\n` }]
    });

    // Classified exactly as against the same baseline in a v2 manifest.
    const sameBaselineV2 = renderArchitectureDocumentationProjection({
      ...renderInput,
      sourceFootprints: currentFootprints,
      existingFiles: [...current.files.map((file) => ({ path: file.path, body: file.body })), current.manifest]
    });
    const upgraded = upgradeFrom(v1Manifest);
    expect(upgraded.majorChange).toEqual(sameBaselineV2.majorChange);
    expect(upgraded.majorChange.reasonCodes).not.toContain("node-renamed");
    expect([...new Set(upgraded.drift.diffs.map((diff) => diff.path))].sort())
      .toEqual([...current.files.map((file) => file.path), manifestPath].sort());
    expect(JSON.parse(upgraded.manifest.body).schemaVersion).toBe("archcontext.architecture-docs-projection-manifest/v2");
    expect(upgraded.manifest.body).toBe(current.manifest.body);

    // The v1 baseline is read, not dropped: a node renamed since that baseline is a major change.
    const renamedBaseline = structuredClone(v1Manifest);
    renamedBaseline.semanticBaseline.semanticState.capabilities[0].facets.names = movedDigest;
    const renamed = upgradeFrom(renamedBaseline);
    expect(renamed.majorChange.mode).toBe("human-action-required");
    expect(renamed.majorChange.reasonCodes).toContain("node-renamed");
  });

  test("a declared node without a measured footprint is refused, never stamped with a guess", () => {
    expect(() => renderArchitectureDocumentationProjection({ ...renderInput, sourceFootprints: [currentFootprints[0]!] }))
      .toThrow("architecture-docs-projection-source-footprint-missing: capability.review.gate");
  });

  test("readback round-trips the manifest and separates missing from unreadable", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-freshness-"));
    try {
      expect(loadArchitectureProjectionManifestStamps(root)).toEqual({ status: "manifest-missing" });

      mkdirSync(join(root, "docs/architecture"), { recursive: true });
      writeFileSync(join(root, "docs/architecture/.projection-manifest.json"), "{ not json");
      expect(loadArchitectureProjectionManifestStamps(root).status).toBe("manifest-unreadable");

      writeFileSync(
        join(root, "docs/architecture/.projection-manifest.json"),
        `${JSON.stringify({
          schemaVersion: "archcontext.architecture-docs-projection-manifest/v1",
          targets: [
            { targetId: "t.entity", type: "entity-summary", scope: { kind: "entity", id: "capability.docs.projection" }, sourceFootprintDigest: docsDigest },
            { targetId: "t.legacy", type: "entity-summary", scope: { kind: "entity", id: "capability.review.gate" }, verifiedAgainst: { branch: "main", commit: "7415329", committedAt: "2026-08-08T09:30:00+08:00" } },
            { targetId: "t.index", type: "architecture-index", scope: { kind: "repository" } }
          ]
        }, null, 2)}\n`
      );
      expect(loadArchitectureProjectionManifestStamps(root)).toEqual({
        status: "present",
        nodes: [
          { nodeId: "capability.docs.projection", sourceFootprintDigest: docsDigest },
          { nodeId: "capability.review.gate", sourceFootprintDigest: undefined }
        ]
      });

      writeFileSync(join(root, "docs/architecture/.projection-manifest.json"), `${JSON.stringify({ schemaVersion: "x" })}\n`);
      expect(loadArchitectureProjectionManifestStamps(root)).toEqual({ status: "present", nodes: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("profile-scoped freshness (#290)", () => {
  // One capability with two members that declare their own footprint. The component's footprint
  // is inside the capability's footprint; the tooling module's footprint is outside it.
  const capabilityId = "capability.app.core";
  const componentId = "component.app.core.engine";
  const toolingId = "module.app.tooling";
  const memberModel: NativeModel = {
    nodes: [
      {
        id: capabilityId,
        kind: "capability",
        name: "App Core",
        status: "active",
        source: { include: ["packages/app/**/src/**"] },
        extensions: { contractFiles: { agents: "packages/app/AGENTS.md", claude: "packages/app/CLAUDE.md" } }
      },
      {
        id: componentId,
        kind: "component",
        name: "Engine",
        status: "active",
        parent: capabilityId,
        source: { include: ["packages/app/engine/src/**"] }
      },
      {
        id: toolingId,
        kind: "module",
        name: "Tooling",
        status: "active",
        parent: capabilityId,
        source: { include: ["scripts/**"] }
      }
    ],
    relations: []
  };
  const memberFiles = {
    "packages/app/api/src/index.ts": "export const api = 1;\n",
    "packages/app/engine/src/index.ts": "export const engine = 1;\n",
    "scripts/release.ts": "export const release = 1;\n"
  };

  /** Renders the projection from the current tree and writes it, as `docs apply` does. */
  function applyProjection(root: string, profile: ArchitectureProjectionProfile) {
    const sourceFiles = fixtureSourceFiles(root);
    const plan = renderArchitectureDocumentationProjection({
      model: memberModel,
      profile,
      sourceDigest,
      provenance: architectureDocumentationProjectionProvenance({
        sourceTreeDigest: architectureDocumentationSourceTreeDigest(root, memberModel, sourceFiles),
        modelDigest: sourceDigest,
        rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION, layoutVersion: ARCHITECTURE_DOCS_LAYOUT_VERSION,
        generatedFrom: { codeGraphPackage: "@colbymchenry/codegraph", codeGraphVersion: "1.6.1" }
      }),
      sourceFootprints: loadCapabilitySourceFootprintDigests(root, memberModel, sourceFiles),
      sourceScaleSignals: loadCapabilitySourceScaleSignals(root, memberModel, sourceFiles),
      importGraphs: [],
      selectorEvidence: []
    });
    for (const file of [...plan.files, plan.manifest]) {
      mkdirSync(dirname(join(root, file.path)), { recursive: true });
      writeFileSync(join(root, file.path), file.body);
    }
    return plan;
  }

  /** The `check` answer: committed stamps and provenance against the tree measured now. */
  function checkFreshness(root: string, profile?: ArchitectureProjectionProfile) {
    const sourceFiles = fixtureSourceFiles(root);
    return evaluateArchitectureProjectionSnapshotFreshness({
      model: memberModel,
      ...(profile ? { profile } : {}),
      manifest: loadArchitectureProjectionManifestStamps(root),
      sourceFootprints: loadCapabilitySourceFootprintDigests(root, memberModel, sourceFiles),
      currentSourceTreeDigest: architectureDocumentationSourceTreeDigest(root, memberModel, sourceFiles)
    });
  }

  function manifestStamps(plan: ReturnType<typeof applyProjection>): Record<string, unknown> {
    return Object.fromEntries(JSON.parse(plan.manifest.body).targets
      .filter((target: { type: string }) => target.type === "entity-summary")
      .map((target: { scope: { id: string }; sourceFootprintDigest?: string }) => [target.scope.id, target.sourceFootprintDigest]));
  }

  test("the stamped node set is the profile's entity-summary nodes that declare a footprint", () => {
    expect(architectureProjectionStampedNodeIds(memberModel)).toEqual([capabilityId, componentId, toolingId]);
    expect(architectureProjectionStampedNodeIds(memberModel, "default")).toEqual([capabilityId, componentId, toolingId]);
    expect(architectureProjectionStampedNodeIds(memberModel, REPO_HARNESS_PROJECTION_PROFILE)).toEqual([capabilityId]);
    // The no-source module of the default fixture has a document but no footprint, so no stamp.
    expect(architectureProjectionStampedNodeIds(model)).toEqual(["capability.docs.projection", "capability.review.gate"]);
  });

  test("repo-harness/v1: fresh right after apply, although members declare footprints without a document", () => {
    withRepository(memberFiles, (root) => {
      const plan = applyProjection(root, REPO_HARNESS_PROJECTION_PROFILE);
      // The renderer stamps exactly the set the freshness check probes.
      const stamps = manifestStamps(plan);
      expect(Object.keys(stamps)).toEqual(architectureProjectionStampedNodeIds(memberModel, REPO_HARNESS_PROJECTION_PROFILE));
      expect(stamps[capabilityId]).toMatch(/^sha256:[a-f0-9]{64}$/);

      expect(checkFreshness(root, REPO_HARNESS_PROJECTION_PROFILE)).toEqual({
        schemaVersion: "archcontext.projection-freshness/v2",
        ok: true,
        reasonCodes: [],
        detail: "no declared capability source changed since its documentation was verified",
        staleNodes: []
      });
      // Evaluated under a profile that the manifest was not rendered with, the members have no
      // stamp, and the check fails closed instead of reading as fresh.
      const wrongProfile = checkFreshness(root);
      expect(wrongProfile.ok).toBe(false);
      expect(wrongProfile.reasonCodes).toEqual(["projection-source-stamp-missing"]);
      expect(wrongProfile.detail).toContain(componentId);
      expect(wrongProfile.detail).toContain(toolingId);
    });
  });

  test("repo-harness/v1: a change in the stamped capability's footprint names the capability stale", () => {
    withRepository(memberFiles, (root) => {
      applyProjection(root, REPO_HARNESS_PROJECTION_PROFILE);
      writeFileSync(join(root, "packages/app/api/src/index.ts"), "export const api = 2;\n");
      const stale = checkFreshness(root, REPO_HARNESS_PROJECTION_PROFILE);
      expect(stale.ok).toBe(false);
      expect(stale.reasonCodes).toEqual(["projection-source-changed-since-stamp", "projection-source-tree-digest-mismatch"]);
      expect(stale.staleNodes.map((node) => node.nodeId)).toEqual([capabilityId]);
    });
  });

  test("repo-harness/v1: a change in a member footprint inside the capability footprint names the capability stale", () => {
    withRepository(memberFiles, (root) => {
      applyProjection(root, REPO_HARNESS_PROJECTION_PROFILE);
      writeFileSync(join(root, "packages/app/engine/src/index.ts"), "export const engine = 2;\n");
      const stale = checkFreshness(root, REPO_HARNESS_PROJECTION_PROFILE);
      expect(stale.ok).toBe(false);
      expect(stale.reasonCodes).toEqual(["projection-source-changed-since-stamp", "projection-source-tree-digest-mismatch"]);
      expect(stale.staleNodes.map((node) => node.nodeId)).toEqual([capabilityId]);
    });
  });

  test("repo-harness/v1: a change in a member footprint outside every stamped footprint is still stale", () => {
    withRepository(memberFiles, (root) => {
      applyProjection(root, REPO_HARNESS_PROJECTION_PROFILE);
      writeFileSync(join(root, "scripts/release.ts"), "export const release = 2;\n");
      // No stamp covers the file, so no node is named. The declared source tree digest covers
      // every declared footprint, so the projection is not fresh.
      const stale = checkFreshness(root, REPO_HARNESS_PROJECTION_PROFILE);
      expect(stale.ok).toBe(false);
      expect(stale.reasonCodes).toEqual(["projection-source-tree-digest-mismatch"]);
      expect(stale.staleNodes).toEqual([]);

      // Re-projecting re-verifies the tree.
      applyProjection(root, REPO_HARNESS_PROJECTION_PROFILE);
      expect(checkFreshness(root, REPO_HARNESS_PROJECTION_PROFILE).ok).toBe(true);
    });
  });

  test("default profile: every node that declares a footprint is stamped and probed, as before", () => {
    withRepository(memberFiles, (root) => {
      const plan = applyProjection(root, "default");
      const stamps = manifestStamps(plan);
      expect(Object.keys(stamps).sort()).toEqual([capabilityId, componentId, toolingId]);
      for (const nodeId of [capabilityId, componentId, toolingId]) expect(stamps[nodeId]).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(checkFreshness(root, "default").ok).toBe(true);
      // An omitted profile is the default profile.
      expect(checkFreshness(root).ok).toBe(true);

      writeFileSync(join(root, "scripts/release.ts"), "export const release = 2;\n");
      const stale = checkFreshness(root);
      expect(stale.reasonCodes).toEqual(["projection-source-changed-since-stamp", "projection-source-tree-digest-mismatch"]);
      expect(stale.staleNodes.map((node) => node.nodeId)).toEqual([toolingId]);
    });
  });
});
