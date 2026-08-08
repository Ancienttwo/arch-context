import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  architectureDocumentationSourceTreeDigest,
  architectureDocumentationProjectionProvenance,
  evaluateArchitectureProjectionFreshness,
  evaluateArchitectureProjectionSnapshotFreshness,
  loadArchitectureProjectionManifestVerifiedAgainst,
  renderArchitectureDocumentationProjection,
  type ArchitectureProjectionManifestVerifiedAgainstReadback,
  type CapabilitySourceChangeSetForCommit,
  type NativeModel
} from "../src/index";

const sourceDigest = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
const verifiedAgainst = { branch: "main", commit: "7415329", committedAt: "2026-08-08T09:30:00+08:00" };
const olderVerifiedAgainst = { branch: "main", commit: "0badc0de", committedAt: "2026-08-01T09:30:00+08:00" };
const provenance = architectureDocumentationProjectionProvenance({
  baseHeadSha: "a".repeat(40), worktreeDigest: sourceDigest, sourceTreeDigest: sourceDigest,
  modelDigest: sourceDigest, codeGraphDigest: sourceDigest, indexedWorktreeDigest: sourceDigest,
  rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION, layoutVersion: ARCHITECTURE_DOCS_LAYOUT_VERSION,
  generatedFrom: { codeGraphPackage: "@colbymchenry/codegraph", codeGraphVersion: "1.5.0", codeGraphBinaryDigest: sourceDigest, codeGraphStatus: "ready" }
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

/** Every declared node stamped with the same commit — the common single-projection case. */
function stampedAt(stamp: unknown): ArchitectureProjectionManifestVerifiedAgainstReadback {
  return {
    status: "present",
    nodes: model.nodes.map((node) => ({ nodeId: node.id, verifiedAgainst: stamp }))
  };
}

function measuredAt(commit: string, ...paths: string[]): CapabilitySourceChangeSetForCommit {
  return { commit, changeSet: { status: "measured", paths } };
}

describe("architecture projection freshness", () => {
  test("source snapshot hashes uncommitted declared bytes and ignores projection-owned docs", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-source-tree-digest-"));
    const sourcePath = join(root, "packages", "docs-runtime", "src", "index.ts");
    const docsPath = join(root, "docs", "architecture", "index.md");
    const sourceModel: NativeModel = {
      nodes: [{
        id: "capability.docs.runtime",
        kind: "capability",
        name: "Docs Runtime",
        source: { include: ["packages/docs-runtime/**"] }
      }],
      relations: []
    };
    try {
      mkdirSync(join(root, "packages", "docs-runtime", "src"), { recursive: true });
      mkdirSync(join(root, "docs", "architecture"), { recursive: true });
      writeFileSync(sourcePath, "export const version = 1;\n");
      writeFileSync(docsPath, "# First projection\n");
      const initial = architectureDocumentationSourceTreeDigest(root, sourceModel);
      writeFileSync(docsPath, "# Edited projection\n");
      expect(architectureDocumentationSourceTreeDigest(root, sourceModel)).toBe(initial);
      writeFileSync(sourcePath, "export const version = 2;\n");
      expect(architectureDocumentationSourceTreeDigest(root, sourceModel)).not.toBe(initial);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("dirty source is stale even when HEAD is unchanged, while docs-only bytes keep the same snapshot fresh", () => {
    const manifest = { ...stampedAt(verifiedAgainst), provenance } as const;
    const docsOnly = evaluateArchitectureProjectionSnapshotFreshness({
      model,
      manifest,
      changeSets: [measuredAt(verifiedAgainst.commit, "docs/architecture/index.md")],
      currentSourceTreeDigest: provenance.sourceTreeDigest
    });
    expect(docsOnly.ok).toBe(true);

    const dirtySource = evaluateArchitectureProjectionSnapshotFreshness({
      model,
      manifest,
      changeSets: [measuredAt(verifiedAgainst.commit)],
      currentSourceTreeDigest: `sha256:${"9".repeat(64)}`
    });
    expect(dirtySource.ok).toBe(false);
    expect(dirtySource.reasonCodes).toEqual(["projection-source-tree-digest-mismatch"]);
  });

  test("changed paths inside a declared source footprint report the node as stale", () => {
    const evaluation = evaluateArchitectureProjectionFreshness({
      model,
      manifest: stampedAt(verifiedAgainst),
      changeSets: [measuredAt(
        "7415329",
        "packages/core/projection-engine/src/index.ts",
        "packages/core/review-engine/src/index.ts",
        "README.md"
      )]
    });

    expect(evaluation.schemaVersion).toBe("archcontext.projection-freshness/v1");
    expect(evaluation.ok).toBe(false);
    expect(evaluation.reasonCodes).toEqual(["projection-source-changed-since-verified-commit"]);
    expect(evaluation.changedPathCount).toBe(3);
    expect(evaluation.staleNodes.map((node) => node.nodeId)).toEqual([
      "capability.docs.projection",
      "capability.review.gate"
    ]);
    expect(evaluation.staleNodes[0]).toEqual({
      nodeId: "capability.docs.projection",
      verifiedAgainst,
      changedPathCount: 1,
      changedPaths: ["packages/core/projection-engine/src/index.ts"],
      changedPathsTruncated: false
    });
    expect(evaluation.detail).toContain("7415329");
    expect(evaluation.detail).toContain("capability.docs.projection(1@7415329)");
  });

  test("changes outside every declared footprint leave the projection fresh", () => {
    const evaluation = evaluateArchitectureProjectionFreshness({
      model,
      manifest: stampedAt(verifiedAgainst),
      changeSets: [measuredAt("7415329", "README.md", "docs/spec.md", "packages/surfaces/cli/src/main.ts")]
    });

    expect(evaluation.ok).toBe(true);
    expect(evaluation.reasonCodes).toEqual([]);
    expect(evaluation.staleNodes).toEqual([]);
    expect(evaluation.changedPathCount).toBe(3);
    expect(evaluation.detail).toContain("no declared capability source changed");
  });

  test("a node's own source.exclude keeps excluded changes out of the stale set", () => {
    const evaluation = evaluateArchitectureProjectionFreshness({
      model,
      manifest: stampedAt(verifiedAgainst),
      changeSets: [measuredAt("7415329", "packages/core/projection-engine/test/entity-summary.test.ts")]
    });

    expect(evaluation.ok).toBe(true);
    expect(evaluation.staleNodes).toEqual([]);
  });

  test("an empty change set against a valid manifest is fresh", () => {
    const evaluation = evaluateArchitectureProjectionFreshness({
      model,
      manifest: stampedAt(verifiedAgainst),
      changeSets: [measuredAt("7415329")]
    });

    expect(evaluation.ok).toBe(true);
    expect(evaluation.changedPathCount).toBe(0);
  });

  test("overlapping footprints both report stale; ownership ambiguity never drops the signal", () => {
    const overlapping: NativeModel = {
      nodes: [
        ...model.nodes,
        {
          id: "capability.core.everything",
          kind: "capability",
          name: "All Core",
          source: { include: ["packages/core/**"] }
        }
      ],
      relations: []
    };
    const evaluation = evaluateArchitectureProjectionFreshness({
      model: overlapping,
      manifest: {
        status: "present",
        nodes: overlapping.nodes.map((node) => ({ nodeId: node.id, verifiedAgainst }))
      },
      changeSets: [measuredAt("7415329", "packages/core/projection-engine/src/index.ts")]
    });

    expect(evaluation.staleNodes.map((node) => node.nodeId)).toEqual([
      "capability.core.everything",
      "capability.docs.projection"
    ]);
  });

  test("the changed-path sample is bounded and reports its own truncation", () => {
    const paths = Array.from({ length: 14 }, (_, index) => `packages/core/review-engine/src/file-${index}.ts`);
    const evaluation = evaluateArchitectureProjectionFreshness({
      model,
      manifest: stampedAt(verifiedAgainst),
      changeSets: [measuredAt("7415329", ...paths)]
    });

    const stale = evaluation.staleNodes.find((node) => node.nodeId === "capability.review.gate")!;
    expect(stale.changedPathCount).toBe(14);
    expect(stale.changedPaths).toHaveLength(10);
    expect(stale.changedPathsTruncated).toBe(true);
  });

  test("an unmeasurable change set fails closed instead of reading as no change", () => {
    const evaluation = evaluateArchitectureProjectionFreshness({
      model,
      manifest: stampedAt(verifiedAgainst),
      changeSets: [{ commit: "7415329", changeSet: { status: "unavailable", reason: "fatal: bad object 7415329" } }]
    });

    expect(evaluation.ok).toBe(false);
    expect(evaluation.reasonCodes).toEqual(["projection-change-set-unavailable"]);
    expect(evaluation.detail).toContain("fatal: bad object 7415329");
    expect(evaluation.staleNodes).toEqual([]);
  });

  test("a stamped commit with no measured change set fails closed", () => {
    const evaluation = evaluateArchitectureProjectionFreshness({
      model,
      manifest: stampedAt(verifiedAgainst),
      changeSets: []
    });

    expect(evaluation.ok).toBe(false);
    expect(evaluation.reasonCodes).toEqual(["projection-change-set-unavailable"]);
    expect(evaluation.detail).toContain("7415329");
  });

  test("a missing or unusable verifiedAgainst entry fails closed", () => {
    const missing = evaluateArchitectureProjectionFreshness({
      model,
      manifest: stampedAt(undefined),
      changeSets: []
    });
    expect(missing.ok).toBe(false);
    expect(missing.reasonCodes).toEqual(["projection-verified-against-missing"]);
    expect(missing.detail).toContain("capability.docs.projection");

    const invalid = evaluateArchitectureProjectionFreshness({
      model,
      manifest: stampedAt({ branch: "main", commit: "unknown", committedAt: "2026-08-08T09:30:00+08:00" }),
      changeSets: []
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.reasonCodes).toEqual(["projection-verified-against-invalid"]);
    expect(invalid.detail).toContain("architecture-docs-projection-verified-against-invalid-commit");

    // A node the manifest never recorded at all is fail-closed too, not silently skipped.
    const partial = evaluateArchitectureProjectionFreshness({
      model,
      manifest: { status: "present", nodes: [{ nodeId: "capability.docs.projection", verifiedAgainst }] },
      changeSets: [measuredAt("7415329")]
    });
    expect(partial.ok).toBe(false);
    expect(partial.reasonCodes).toEqual(["projection-verified-against-missing"]);
    expect(partial.detail).toContain("capability.review.gate");

    const unreadable = evaluateArchitectureProjectionFreshness({
      model,
      manifest: { status: "manifest-unreadable", reason: "Unexpected end of JSON input" },
      changeSets: []
    });
    expect(unreadable.ok).toBe(false);
    expect(unreadable.reasonCodes).toEqual(["projection-manifest-unreadable"]);

    const absent = evaluateArchitectureProjectionFreshness({
      model,
      manifest: { status: "manifest-missing" },
      changeSets: []
    });
    expect(absent.ok).toBe(false);
    expect(absent.reasonCodes).toEqual(["projection-manifest-missing"]);
  });

  test("each node is judged against its own stamp, not one repository-wide baseline", () => {
    // The review gate was re-verified at 7415329; the docs projection still carries the older
    // stamp. A change that only lands in the review gate's footprint after the *older* commit must
    // not be attributed to the node that was already re-verified past it.
    const evaluation = evaluateArchitectureProjectionFreshness({
      model,
      manifest: {
        status: "present",
        nodes: [
          { nodeId: "capability.docs.projection", verifiedAgainst: olderVerifiedAgainst },
          { nodeId: "capability.review.gate", verifiedAgainst },
          { nodeId: "module.no-source", verifiedAgainst }
        ]
      },
      changeSets: [
        measuredAt("0badc0de", "packages/core/projection-engine/src/index.ts", "packages/core/review-engine/src/index.ts"),
        measuredAt("7415329")
      ]
    });

    expect(evaluation.staleNodes.map((node) => node.nodeId)).toEqual(["capability.docs.projection"]);
    expect(evaluation.staleNodes[0].verifiedAgainst).toEqual(olderVerifiedAgainst);
  });

  test("the projection's own output is never counted as capability source", () => {
    // Both of these live inside `capability.docs.projection`'s declared footprint or the docs tree.
    // Counting them would make every projection commit demand another projection.
    const evaluation = evaluateArchitectureProjectionFreshness({
      model,
      manifest: stampedAt(verifiedAgainst),
      changeSets: [measuredAt(
        "7415329",
        "docs/architecture/modules/capability-docs-projection.md",
        "docs/architecture/.projection-manifest.json",
        "packages/core/projection-engine/CLAUDE.md",
        "packages/core/projection-engine/AGENTS.md"
      )]
    });

    expect(evaluation.ok).toBe(true);
    expect(evaluation.staleNodes).toEqual([]);
    expect(evaluation.changedPathCount).toBe(0);
  });
});

describe("projection manifest verifiedAgainst readback", () => {
  test("the rendered manifest carries a machine-readable stamp per entity-summary target", () => {
    const plan = renderArchitectureDocumentationProjection({
      model,
      sourceDigest,
      provenance,
      verifiedAgainst,
      sourceChangesSinceStamp: [],
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
      entrypointCallGraphs: []
    });

    const manifest = JSON.parse(plan.manifest.body);
    // No manifest-wide stamp: a copy of the current HEAD here would drift on every commit.
    expect(manifest.verifiedAgainst).toBeUndefined();
    const entityTargets = manifest.targets.filter((target: { type: string }) => target.type === "entity-summary");
    expect(entityTargets).toHaveLength(3);
    for (const target of entityTargets) expect(target.verifiedAgainst).toEqual(verifiedAgainst);
    expect(manifest.targets.filter((target: { type: string }) => target.type !== "entity-summary")
      .every((target: { verifiedAgainst?: unknown }) => target.verifiedAgainst === undefined)).toBe(true);
  });

  test("readback round-trips the manifest and separates missing from unreadable", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-freshness-"));
    try {
      expect(loadArchitectureProjectionManifestVerifiedAgainst(root)).toEqual({ status: "manifest-missing" });

      mkdirSync(join(root, "docs/architecture"), { recursive: true });
      writeFileSync(join(root, "docs/architecture/.projection-manifest.json"), "{ not json");
      const unreadable = loadArchitectureProjectionManifestVerifiedAgainst(root);
      expect(unreadable.status).toBe("manifest-unreadable");

      writeFileSync(
        join(root, "docs/architecture/.projection-manifest.json"),
        `${JSON.stringify({
          schemaVersion: "archcontext.architecture-docs-projection-manifest/v1",
          targets: [
            { targetId: "t.entity", type: "entity-summary", scope: { kind: "entity", id: "capability.docs.projection" }, verifiedAgainst },
            { targetId: "t.index", type: "architecture-index", scope: { kind: "repository" } }
          ]
        }, null, 2)}\n`
      );
      expect(loadArchitectureProjectionManifestVerifiedAgainst(root)).toEqual({
        status: "present",
        nodes: [{ nodeId: "capability.docs.projection", verifiedAgainst }]
      });

      writeFileSync(join(root, "docs/architecture/.projection-manifest.json"), `${JSON.stringify({ schemaVersion: "x" })}\n`);
      expect(loadArchitectureProjectionManifestVerifiedAgainst(root)).toEqual({ status: "present", nodes: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
