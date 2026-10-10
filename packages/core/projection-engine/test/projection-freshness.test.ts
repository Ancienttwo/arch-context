import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  architectureDocumentationSourceTreeDigest,
  architectureDocumentationProjectionProvenance,
  evaluateArchitectureProjectionFreshness,
  evaluateArchitectureProjectionSnapshotFreshness,
  loadArchitectureProjectionManifestStamps,
  loadCapabilitySourceFootprintDigests,
  renderArchitectureDocumentationProjection,
  type ArchitectureProjectionManifestStampReadback,
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

  test("an unchanged footprint re-renders a byte-identical manifest; a moved one changes only its stamp", () => {
    const first = renderArchitectureDocumentationProjection({ ...renderInput, sourceFootprints: currentFootprints });
    const existingFiles = [...first.files.map((file) => ({ path: file.path, body: file.body })), first.manifest];
    const again = renderArchitectureDocumentationProjection({ ...renderInput, existingFiles, sourceFootprints: currentFootprints });
    expect(again.drift.ok).toBe(true);
    expect(again.manifest.body).toBe(first.manifest.body);

    const moved = renderArchitectureDocumentationProjection({
      ...renderInput,
      existingFiles,
      sourceFootprints: [currentFootprints[0]!, { ...currentFootprints[1]!, digest: movedDigest }]
    });
    expect(moved.drift.diffs.map((diff) => diff.path)).toEqual(["docs/architecture/.projection-manifest.json"]);
    expect(moved.files.map((file) => file.body)).toEqual(first.files.map((file) => file.body));
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
