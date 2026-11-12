import { describe, expect, test } from "bun:test";
import { fixtureArchitectureHistory } from "./fixture-source-files";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  REPO_HARNESS_PROJECTION_PROFILE,
  architectureDocumentationProjectionProvenance,
  loadArchitectureDocumentationFiles,
  projectionOwnedWriteBody,
  renderArchitectureDocumentationProjection,
  type ArchitectureDocumentationExistingFile,
  type ArchitectureDocumentationProjectionPlan,
  type CapabilitySourceScaleSignal,
  type NativeModel,
  type NativeNode
} from "../src/index";

/**
 * #327 finding 4: the committed manifest must not be a merge hot spot. Two branches that change
 * different capabilities from the same base must rewrite disjoint, non-adjacent manifest lines, so
 * Git merges them without a conflict. The one intended shared line is the model anchor
 * `semanticBaseline.modelDigest`: two concurrent model changes conflict there.
 */

const modelDigest = `sha256:${"3".repeat(64)}`;
const provenance = (model = modelDigest) => architectureDocumentationProjectionProvenance({
  sourceTreeDigest: `sha256:${"2".repeat(64)}`,
  modelDigest: model,
  rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION,
  layoutVersion: ARCHITECTURE_DOCS_LAYOUT_VERSION,
  generatedFrom: { codeGraphPackage: "@colbymchenry/codegraph", codeGraphVersion: "1.6.2" }
});

function capability(domain: string, name: string): NativeNode {
  return {
    id: `capability.${domain}.${name}`,
    kind: "capability",
    name: `${domain} ${name}`,
    status: "active",
    summary: `The ${name} capability.`,
    source: { include: [`packages/${name}/**`] },
    extensions: { contractFiles: { agents: `packages/${name}/AGENTS.md`, claude: `packages/${name}/CLAUDE.md` } }
  };
}

function component(parent: NativeNode, name: string): NativeNode {
  return {
    id: `component.${parent.id.split(".").at(-1)}.${name}`,
    kind: "component",
    name,
    status: "active",
    parent: parent.id,
    summary: `The ${name} component.`,
    source: { include: [`${(parent.source as { include: string[] }).include[0]!.replace("/**", "")}/${name}/**`] }
  };
}

// Two capabilities whose target rows are adjacent in the manifest, the hard case for a merge.
const billing = capability("example", "billing");
const checkout = capability("example", "checkout");
const ledger = component(billing, "ledger");
const cart = component(checkout, "cart");
const model: NativeModel = {
  nodes: [billing, checkout, ledger, cart],
  relations: [{ id: "relation.cart-uses-ledger", kind: "uses", source: cart.id, target: ledger.id, intent: "settle a cart" }],
  flows: []
};

const stamp = (fill: string) => `sha256:${fill.repeat(64)}`;
const baseScale: Record<string, number> = { [billing.id]: 12, [checkout.id]: 30, [ledger.id]: 3, [cart.id]: 7 };

function render(input: {
  fileCounts?: Record<string, number>;
  model?: NativeModel;
  modelDigest?: string;
  existingFiles?: ArchitectureDocumentationExistingFile[];
  rebaselineSupersededManifest?: boolean;
}): ArchitectureDocumentationProjectionPlan {
  const fileCounts = input.fileCounts ?? baseScale;
  const nodes = (input.model ?? model).nodes;
  return renderArchitectureDocumentationProjection({
    model: input.model ?? model,
    profile: REPO_HARNESS_PROJECTION_PROFILE,
    sourceDigest: `sha256:${"1".repeat(64)}`,
    provenance: provenance(input.modelDigest),
    sourceScaleSignals: nodes.map((node): CapabilitySourceScaleSignal => ({
      nodeId: node.id,
      fileCount: fileCounts[node.id]!,
      lineCount: fileCounts[node.id]! * 40,
      includePatterns: [...(node.source as { include: string[] }).include],
      excludePatterns: []
    })),
    importGraphs: [],
    selectorEvidence: [],
    rebaselineSupersededManifest: input.rebaselineSupersededManifest,
    existingFiles: input.existingFiles ?? [],
    architectureHistory: fixtureArchitectureHistory
  });
}

/** The tree an apply of `plan` leaves behind, by path. */
function tree(plan: ArchitectureDocumentationProjectionPlan): Map<string, string> {
  return new Map([...plan.files, plan.manifest].map((file) => [file.path, file.body]));
}

function existing(plan: ArchitectureDocumentationProjectionPlan): ArchitectureDocumentationExistingFile[] {
  return [...tree(plan)].map(([path, body]) => ({ path, body }));
}

test("compatible manifest floors survive rendering without changing no-floor output", () => {
  const baseline = render({});
  const unchanged = render({ existingFiles: existing(baseline) });
  expect(unchanged.manifest.body).toBe(baseline.manifest.body);
  const manifest = JSON.parse(baseline.manifest.body);
  manifest.minimumRendererVersion = "archcontext.docs-renderer/v6";
  manifest.minimumProtocolVersion = "archcontext.projection-request/v1";
  const inputs = existing(baseline).map(file => file.path === baseline.manifest.path ? { ...file, body: JSON.stringify(manifest) } : file);
  const next = render({ existingFiles: inputs });
  expect(JSON.parse(next.manifest.body)).toMatchObject({ minimumRendererVersion: manifest.minimumRendererVersion, minimumProtocolVersion: manifest.minimumProtocolVersion });
});

test("future manifests are refused instead of being treated as absent", () => {
  const baseline = render({});
  const manifest = JSON.parse(baseline.manifest.body);
  manifest.schemaVersion = "archcontext.architecture-docs-projection-manifest/v5";
  for (const rebaselineSupersededManifest of [false, true]) expect(() => render({ rebaselineSupersededManifest, existingFiles: existing(baseline).map(file => file.path === baseline.manifest.path ? { ...file, body: JSON.stringify(manifest) } : file) })).toThrow("Projection manifest incompatible.");
});

/** `git merge-file -p ours base theirs`: the merged text and the number of conflicts. */
function mergeFile(ours: string, base: string, theirs: string): { merged: string; conflicts: number } {
  const dir = mkdtempSync(join(tmpdir(), "archctx-manifest-merge-"));
  try {
    writeFileSync(join(dir, "ours"), ours);
    writeFileSync(join(dir, "base"), base);
    writeFileSync(join(dir, "theirs"), theirs);
    try {
      return { merged: execFileSync("git", ["merge-file", "-p", "ours", "base", "theirs"], { cwd: dir, encoding: "utf8" }), conflicts: 0 };
    } catch (error) {
      const failed = error as { status?: number; stdout?: string };
      if (typeof failed.status !== "number" || failed.status <= 0 || failed.status >= 127) throw error;
      return { merged: String(failed.stdout), conflicts: failed.status };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function changedLineNumbers(before: string, after: string): number[] {
  const left = before.split("\n");
  const right = after.split("\n");
  expect(right).toHaveLength(left.length);
  return right.flatMap((line, index) => line === left[index] ? [] : [index]);
}

describe("manifest v4 merges (#327 finding 4)", () => {
  const base = render({});
  const baseTree = tree(base);
  const baseManifest = base.manifest.body;

  test("output changes in two capabilities rewrite disjoint, separated manifest lines and merge cleanly", () => {
    // Branch A: billing's component crosses a scale bucket. Branch B: checkout itself does.
    const branchA = render({ fileCounts: { ...baseScale, [ledger.id]: 6 }, existingFiles: existing(base) });
    const branchB = render({ fileCounts: { ...baseScale, [checkout.id]: 60 }, existingFiles: existing(base) });
    const linesA = changedLineNumbers(baseManifest, branchA.manifest.body);
    const linesB = changedLineNumbers(baseManifest, branchB.manifest.body);
    expect(linesA).toHaveLength(1);
    expect(linesB).toHaveLength(1);
    expect(branchA.manifest.body.split("\n")[linesA[0]!]).toContain("docs/architecture/modules/example/billing.md");
    expect(branchB.manifest.body.split("\n")[linesB[0]!]).toContain("docs/architecture/modules/example/checkout.md");
    // The rows are adjacent records, yet an unchanged line (the next row's key) separates them.
    expect(Math.abs(linesA[0]! - linesB[0]!)).toBe(2);

    const { merged, conflicts } = mergeFile(branchA.manifest.body, baseManifest, branchB.manifest.body);
    expect(conflicts).toBe(0);
    // The merge is exactly what a projection of the merged tree writes, so it is already fresh.
    const both = render({ fileCounts: { ...baseScale, [ledger.id]: 6, [checkout.id]: 60 }, existingFiles: existing(base) });
    expect(merged).toBe(both.manifest.body);
  });

  test("a source change that renders no differently leaves the manifest and every document byte-identical (ADR-0056)", () => {
    // 12 -> 11 files (480 -> 440 lines) stays inside billing's buckets, so no document prints anything new.
    const edited = render({ fileCounts: { ...baseScale, [billing.id]: 11 }, existingFiles: existing(base) });
    expect(edited.drift).toMatchObject({ ok: true, diffs: [] });
    expect(edited.freshness).toMatchObject({ ok: true, reasonCodes: [], staleTargets: [] });
    expect(tree(edited)).toEqual(baseTree);
  });

  test("a footprint that crosses a scale bucket in each capability rewrites only that capability's document and row", () => {
    const branchA = render({ fileCounts: { ...baseScale, [billing.id]: 25 }, existingFiles: existing(base) });
    const branchB = render({ fileCounts: { ...baseScale, [cart.id]: 60 }, existingFiles: existing(base) });
    const both = render({ fileCounts: { ...baseScale, [billing.id]: 25, [cart.id]: 60 }, existingFiles: existing(base) });
    const treeA = tree(branchA);
    const treeB = tree(branchB);
    for (const [path, baseBody] of baseTree) {
      const { merged, conflicts } = mergeFile(treeA.get(path)!, baseBody, treeB.get(path)!);
      expect(conflicts, path).toBe(0);
      expect(merged, path).toBe(tree(both).get(path)!);
    }
    // Each branch moved its own module document and nothing else besides the manifest.
    expect(branchA.drift.diffs.map((diff) => diff.path).sort()).toEqual([base.manifest.path, "docs/architecture/modules/example/billing.md"]);
    expect(branchB.drift.diffs.map((diff) => diff.path).sort()).toEqual([base.manifest.path, "docs/architecture/modules/example/checkout.md"]);
  });

  test("two model changes in different capabilities conflict only on the model anchor line", () => {
    const withResponsibility = (nodeId: string, responsibility: string): NativeModel => ({
      ...model,
      nodes: model.nodes.map((node) => node.id === nodeId ? { ...node, responsibilities: [responsibility] } : node)
    });
    const branchA = render({ model: withResponsibility(ledger.id, "Settles payments."), modelDigest: stamp("7"), existingFiles: existing(base) });
    const branchB = render({ model: withResponsibility(cart.id, "Holds line items."), modelDigest: stamp("8"), existingFiles: existing(base) });
    const { merged, conflicts } = mergeFile(branchA.manifest.body, baseManifest, branchB.manifest.body);
    expect(conflicts).toBe(1);
    const conflict = merged.slice(merged.indexOf("<<<<<<<"), merged.indexOf(">>>>>>>"));
    const conflicted = conflict.split("\n").slice(1).filter((line) => line !== "=======" && line.trim() !== "");
    expect(conflicted).toEqual([`    "modelDigest": "${stamp("7")}",`, `    "modelDigest": "${stamp("8")}",`]);
  });

  test("a CRLF checkout of the v4 manifest reads and re-renders as the LF manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-manifest-crlf-"));
    try {
      for (const [path, body] of baseTree) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), body.replaceAll("\n", "\r\n"));
      }
      const loaded = loadArchitectureDocumentationFiles(root, model, REPO_HARNESS_PROJECTION_PROFILE);
      const manifest = loaded.find((file) => file.path === base.manifest.path)!;
      expect(manifest.onDisk).toContain("\r\n");
      expect(manifest.body).toBe(baseManifest);
      const reprojected = render({ existingFiles: loaded });
      expect(reprojected.drift).toMatchObject({ ok: true, reasonCodes: [], diffs: [] });
      expect(reprojected.manifest.body).toBe(baseManifest);
      // An apply on this checkout rewrites CRLF bytes, so Git sees no line-ending churn.
      expect(projectionOwnedWriteBody(reprojected.manifest.body, manifest.onDisk)).toBe(readFileSync(join(root, base.manifest.path), "utf8"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});


test("render entry refuses each unsupported floor even when a plan requests rebaselining", () => {
  const baseline = render({});
  for (const floors of [{ minimumRendererVersion: "archcontext.docs-renderer/v7" }, { minimumProtocolVersion: "archcontext.projection-request/v2" }]) {
    const manifest = { ...JSON.parse(baseline.manifest.body), ...floors };
    expect(() => render({ rebaselineSupersededManifest: true, existingFiles: existing(baseline).map(file => file.path === baseline.manifest.path ? { ...file, body: JSON.stringify(manifest) } : file) })).toThrow("Projection manifest incompatible.");
  }
});
