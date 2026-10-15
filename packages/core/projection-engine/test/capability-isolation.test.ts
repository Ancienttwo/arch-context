import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH, digestJson, type Json } from "@archcontext/contracts";
import {
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  ProjectionManifestInvalidError,
  ProjectionManifestUpgradeRequiredError,
  REPO_HARNESS_PROJECTION_PROFILE,
  architectureDocumentationProjectionProvenance,
  loadArchitectureDocumentationFiles,
  projectionOwnedWriteBody,
  renderArchitectureDocumentationProjection,
  type ArchitectureDocumentationExistingFile,
  type ArchitectureDocumentationProjectionPlan,
  type ArchitectureProjectionProfile,
  type ArchitectureSelectorEvidenceV1,
  type NativeModel,
  type NativeNode
} from "../src/index";

/**
 * #327 finding 3, Phase 1: a capability blocked by its flow proof alone (unprovable, or a proof
 * change nobody accepted, with an unchanged semantic fingerprint) blocks only the targets that
 * depend on it. Every other target is applied; the blocked documents, manifest rows and baseline
 * capability entries are carried forward byte for byte.
 */

const MANIFEST = ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH;
const stamp = (fill: string) => `sha256:${fill.repeat(64)}`;

function capability(domain: string, name: string, extra: Partial<NativeNode> = {}): NativeNode {
  return {
    id: `capability.${domain}.${name}`,
    kind: "capability",
    name: `${domain} ${name}`,
    status: "active",
    summary: `The ${name} capability.`,
    source: { include: [`packages/${name}/**`] },
    extensions: { contractFiles: { agents: `packages/${name}/AGENTS.md`, claude: `packages/${name}/CLAUDE.md` } },
    ...extra
  };
}

/** A capability with one required flow whose single selector the evidence proves or not. */
function provedCapability(domain: string, name: string, extra: Partial<NativeNode> = {}): { nodes: NativeNode[]; relations: NativeModel["relations"]; flows: NonNullable<NativeModel["flows"]>; evidence: ArchitectureSelectorEvidenceV1 } {
  const id = `capability.${domain}.${name}`;
  const reader = `module.${name}.reader`;
  const entrypointId = `entrypoint.${name}.render`;
  const sinkId = `sink.${name}.read`;
  const evidence = { entrypointId, sourceSymbol: "render", sinkId };
  return {
    nodes: [
      capability(domain, name, {
        source: {
          include: [`packages/${name}/**`],
          entrypoints: [{ id: entrypointId, path: `packages/${name}/index.ts`, symbols: [{ name: "render", sinks: [{ id: sinkId, path: `packages/${name}/read.ts`, symbol: "read" }] }] }]
        },
        ...extra
      }),
      { id: reader, kind: "module", name: `${name} reader`, parent: id, summary: `Reads ${name} input.` }
    ],
    relations: [{ id: `relation.${name}-reads`, kind: "calls", source: id, target: reader, intent: `read ${name} input` }],
    flows: [{
      schemaVersion: "archcontext.flow/v1",
      id: `flow.${name}.render`,
      capabilityId: id,
      name: `Render ${name}`,
      applicability: "required",
      participants: [{ id: "renderer", nodeId: id }, { id: "reader", nodeId: reader }],
      steps: [{ id: "read", from: "renderer", to: "reader", label: "Read input", evidence }],
      outcomes: [
        { id: "ok", kind: "success", label: "Rendered", steps: [{ id: "write", from: "renderer", to: "reader", label: "Render", evidence }], terminal: { participant: "renderer", label: "Return" } },
        { id: "failed", kind: "error", label: "Failed", steps: [{ id: "report", from: "renderer", to: "reader", label: "Report", evidence }], terminal: { participant: "renderer", label: "Keep" } }
      ]
    }],
    evidence: {
      nodeId: id,
      entrypointId,
      sourcePath: `packages/${name}/index.ts`,
      sourceSymbol: "render",
      sinkId,
      sinkPath: `packages/${name}/read.ts`,
      sinkSymbol: "read",
      matched: true,
      truncated: false,
      callSites: [{ path: `packages/${name}/index.ts`, line: 3 }]
    }
  };
}

/** P1 needs one declared in-scope relation; a capability that only journals to itself has one. */
function selfRelation(node: NativeNode): NativeModel["relations"][number] {
  return { id: `relation.${node.id}.journal`, kind: "writes", source: node.id, target: node.id, intent: "journal its own events" };
}

function notApplicableFlow(capabilityId: string, name: string): NonNullable<NativeModel["flows"]>[number] {
  return { schemaVersion: "archcontext.flow/v1", id: `flow.${name}.none`, capabilityId, name: `${name} has no runtime flow`, applicability: "not-applicable", rationale: "Static catalog." };
}

// Repo-harness profile: one module document per capability.
const renderer = provedCapability("docs", "renderer");
const catalog = capability("docs", "catalog");
const RENDERER = renderer.nodes[0]!.id;
const CATALOG = catalog.id;
const model: NativeModel = {
  nodes: [...renderer.nodes, catalog],
  relations: [...renderer.relations, selfRelation(catalog)],
  flows: [...renderer.flows, notApplicableFlow(CATALOG, "catalog")]
};
const proven = [renderer.evidence];
const unproven = [{ ...renderer.evidence, matched: false, callSites: [] }];
const baseFootprints = { [RENDERER]: stamp("a"), [CATALOG]: stamp("b") };
const baseCounts = { [RENDERER]: 12, [CATALOG]: 30 };

interface RenderInput {
  model?: NativeModel;
  profile?: ArchitectureProjectionProfile;
  evidence?: ArchitectureSelectorEvidenceV1[];
  footprints?: Record<string, string>;
  counts?: Record<string, number>;
  existing?: Map<string, string> | ArchitectureDocumentationExistingFile[];
  isolate?: boolean;
}

function render(input: RenderInput = {}): ArchitectureDocumentationProjectionPlan {
  const current = input.model ?? model;
  const footprints = input.footprints ?? baseFootprints;
  const counts = input.counts ?? baseCounts;
  const declared = current.nodes.filter((node) => ((node.source as { include?: string[] } | undefined)?.include ?? []).length > 0);
  const existing = input.existing instanceof Map ? [...input.existing].map(([path, body]) => ({ path, body })) : input.existing ?? [];
  return renderArchitectureDocumentationProjection({
    model: current,
    profile: input.profile ?? REPO_HARNESS_PROJECTION_PROFILE,
    sourceDigest: stamp("1"),
    provenance: architectureDocumentationProjectionProvenance({
      sourceTreeDigest: stamp("2"),
      modelDigest: digestJson(current as unknown as Json),
      rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION,
      layoutVersion: ARCHITECTURE_DOCS_LAYOUT_VERSION,
      generatedFrom: { codeGraphPackage: "@colbymchenry/codegraph", codeGraphVersion: "1.6.2" }
    }),
    sourceFootprints: declared.map((node) => ({ nodeId: node.id, digest: footprints[node.id]!, fileCount: counts[node.id]! })),
    sourceScaleSignals: declared.map((node) => ({
      nodeId: node.id,
      fileCount: counts[node.id]!,
      lineCount: counts[node.id]! * 40,
      includePatterns: [...(node.source as { include: string[] }).include],
      excludePatterns: []
    })),
    importGraphs: [],
    selectorEvidence: input.evidence ?? proven,
    existingFiles: existing,
    refreshContext: { repositoryId: "repo.example", workspaceId: "ws.example", headSha: "a".repeat(40), worktreeDigest: stamp("9") },
    ...(input.isolate ? { isolateBlockedCapabilities: true } : {})
  });
}

/** The tree an apply of `plan` leaves behind: `plan.files` and its manifest written over `before`. */
function apply(before: Map<string, string>, plan: ArchitectureDocumentationProjectionPlan): Map<string, string> {
  const after = new Map(before);
  for (const file of [...plan.files, plan.manifest]) after.set(file.path, file.body);
  return after;
}

function targetOf(plan: ArchitectureDocumentationProjectionPlan, nodeId: string) {
  const target = plan.targets.find((entry) => entry.type === "entity-summary" && entry.scope.id === nodeId);
  if (!target) throw new Error(`no entity-summary target for ${nodeId}`);
  return target;
}

/** The two manifest lines a target row owns: its key and its one-line record. */
function rowLines(manifest: string, targetId: string): string[] {
  const lines = manifest.split("\n");
  const index = lines.indexOf(`    ${JSON.stringify(targetId)}:`);
  if (index < 0) throw new Error(`manifest has no row for ${targetId}`);
  return lines.slice(index, index + 2);
}

/** Every line of one capability's baseline entry, from its opening brace to its closing one. */
function capabilityLines(manifest: string, capabilityId: string): string[] {
  const lines = manifest.split("\n");
  const index = lines.indexOf(`        "capabilityId": ${JSON.stringify(capabilityId)},`);
  if (index < 0) throw new Error(`manifest has no baseline entry for ${capabilityId}`);
  const end = lines.findIndex((line, at) => at > index && /^ {6}\},?$/.test(line));
  return lines.slice(index - 1, end + 1);
}

const base = render();
const baseTree = apply(new Map(), base);
const baseManifest = baseTree.get(MANIFEST)!;
const rendererTarget = targetOf(base, RENDERER);
const catalogTarget = targetOf(base, CATALOG);

describe("Phase 1 capability isolation (#327 finding 3)", () => {
  test("the fixture baseline is a clean fixed point with both proofs holding", () => {
    const again = render({ existing: baseTree, isolate: true });
    expect(again.drift.ok).toBe(true);
    expect(again.majorChange.mode).toBe("none");
    expect(again.isolation).toBeUndefined();
    expect(again.semanticState.capabilities.map((entry) => [entry.capabilityId, entry.proofStatus])).toEqual([
      [CATALOG, { p1: "proven", p2: "not-applicable" }],
      [RENDERER, { p1: "proven", p2: "proven" }]
    ]);
  });

  test("one unprovable capability blocks only its own targets; an unrelated stale capability is applied", () => {
    const moved = { evidence: unproven, footprints: { [RENDERER]: stamp("c"), [CATALOG]: stamp("d") }, counts: { ...baseCounts, [CATALOG]: 60 }, existing: baseTree };
    const partial = render({ ...moved, isolate: true });
    expect(partial.majorChange).toMatchObject({ mode: "human-action-required", reasonCodes: ["verified-flow-proof-changed"], affectedNodeIds: [RENDERER] });
    expect(partial.isolation).toEqual({
      blockedCapabilityIds: [RENDERER],
      blockedTargets: [{ targetId: rendererTarget.targetId, path: rendererTarget.path, capabilityIds: [RENDERER], reasonCodes: ["unprovable-required-flow", "verified-flow-proof-changed"] }],
      appliedTargetIds: base.targets.map((target) => target.targetId).filter((targetId) => targetId !== rendererTarget.targetId).sort()
    });
    // A partial plan signals no refresh and writes neither the blocked document nor anything human.
    expect(partial.refreshSignals).toEqual([]);
    expect(partial.rejected).toEqual([]);
    expect(partial.files.map((file) => file.path)).not.toContain(rendererTarget.path);
    expect(partial.drift.diffs.map((diff) => diff.path).sort()).toEqual([catalogTarget.path, MANIFEST].sort());

    // The blocked capability's row and baseline entry keep their committed bytes; the applied
    // capability's row carries its new stamp and scale.
    expect(rowLines(partial.manifest.body, rendererTarget.targetId)).toEqual(rowLines(baseManifest, rendererTarget.targetId));
    expect(capabilityLines(partial.manifest.body, RENDERER)).toEqual(capabilityLines(baseManifest, RENDERER));
    expect(rowLines(partial.manifest.body, catalogTarget.targetId)[1]).toContain(stamp("d"));
    expect(rowLines(partial.manifest.body, catalogTarget.targetId)).not.toEqual(rowLines(baseManifest, catalogTarget.targetId));
    // Deterministic: the same inputs render the same partial manifest and outputs.
    const again = render({ ...moved, isolate: true });
    expect(again.manifest.body).toBe(partial.manifest.body);
    expect(again.files.map((file) => [file.path, file.body])).toEqual(partial.files.map((file) => [file.path, file.body]));

    // Without the request the same state blocks the whole run, as before.
    const complete = render(moved);
    expect(complete.isolation).toBeUndefined();
    expect(complete.refreshSignals.map((signal) => signal.mode)).toEqual(["human-action-required"]);
    expect(complete.files.find((file) => file.path === rendererTarget.path)!.body).not.toBe(baseTree.get(rendererTarget.path));

    // After the partial apply the blocked document is byte-identical, and nothing else is left to
    // write: the run is the blocked capability alone, a human action, and the complete render the
    // `complete` gate reads still reports its document and manifest as drift. Partial is never acceptance.
    const afterTree = apply(baseTree, partial);
    expect(afterTree.get(rendererTarget.path)).toBe(baseTree.get(rendererTarget.path)!);
    const after = render({ ...moved, existing: afterTree, isolate: true });
    expect(after.isolation).toBeUndefined();
    expect(after.majorChange.mode).toBe("human-action-required");
    expect(after.refreshSignals.map((signal) => signal.mode)).toEqual(["human-action-required"]);
    expect(after.drift.diffs.map((diff) => diff.path).sort()).toEqual([rendererTarget.path, MANIFEST].sort());

    // Fixing the flow leaves only the blocked capability's carried stamp to refresh: no major change.
    const fixed = render({ ...moved, evidence: proven, existing: afterTree, isolate: true });
    expect(fixed.isolation).toBeUndefined();
    expect(fixed.majorChange.mode).toBe("none");
    expect(fixed.drift.diffs.map((diff) => diff.path)).toEqual([MANIFEST]);
    expect(rowLines(fixed.manifest.body, rendererTarget.targetId)[1]).toContain(stamp("c"));
  });

  test("a flow proof that moved without an accepted change is carried forward the same way, even when it now holds", () => {
    // The baseline was written while the flow was unprovable; the flow now holds, which is a proof
    // change nobody accepted yet.
    const unprovenTree = apply(new Map(), render({ evidence: unproven }));
    const plan = render({ evidence: proven, counts: { ...baseCounts, [CATALOG]: 60 }, footprints: { ...baseFootprints, [CATALOG]: stamp("d") }, existing: unprovenTree, isolate: true });
    expect(plan.majorChange).toMatchObject({ mode: "human-action-required", reasonCodes: ["verified-flow-proof-changed"] });
    expect(plan.isolation?.blockedTargets).toEqual([
      { targetId: rendererTarget.targetId, path: rendererTarget.path, capabilityIds: [RENDERER], reasonCodes: ["verified-flow-proof-changed"] }
    ]);
    expect(capabilityLines(plan.manifest.body, RENDERER)).toEqual(capabilityLines(unprovenTree.get(MANIFEST)!, RENDERER));
  });

  test("a blocked capability whose semantic fingerprint changed blocks the whole run", () => {
    const edited: NativeModel = { ...model, nodes: model.nodes.map((node) => node.id === RENDERER ? { ...node, summary: "Renders and validates." } : node) };
    const plan = render({ model: edited, evidence: unproven, counts: { ...baseCounts, [CATALOG]: 60 }, footprints: { ...baseFootprints, [CATALOG]: stamp("d") }, existing: baseTree, isolate: true });
    expect(plan.majorChange.mode).toBe("human-action-required");
    expect(plan.majorChange.reasonCodes).toContain("responsibility-changed");
    expect(plan.isolation).toBeUndefined();
    expect(plan.refreshSignals.map((signal) => signal.mode)).toEqual(["human-action-required"]);
    expect(plan.files.map((file) => file.path)).toContain(rendererTarget.path);
  });

  test("global failures and documents that cannot be carried forward block the whole run", () => {
    const stale = { evidence: unproven, counts: { ...baseCounts, [CATALOG]: 60 }, footprints: { ...baseFootprints, [CATALOG]: stamp("d") }, isolate: true };
    const withFile = (path: string, body: string) => new Map([...baseTree, [path, body]]);

    // A superseded or invalid committed manifest is refused before any classification.
    expect(() => render({ ...stale, existing: withFile(MANIFEST, JSON.stringify({ schemaVersion: "archcontext.architecture-docs-projection-manifest/v2" })) }))
      .toThrow(ProjectionManifestUpgradeRequiredError);
    const invalid = JSON.parse(baseManifest);
    invalid.semanticBaseline.capabilities[0].selectorEvidenceDigest = "not-a-digest";
    expect(() => render({ ...stale, existing: withFile(MANIFEST, JSON.stringify(invalid)) })).toThrow(ProjectionManifestInvalidError);

    // A blocked document whose machine region was edited by hand is not the output its row records.
    const edited = baseTree.get(rendererTarget.path)!.replace("## 1. P1", "## 1. P1 (edited)");
    expect(edited).not.toBe(baseTree.get(rendererTarget.path));
    const handEdited = render({ ...stale, existing: withFile(rendererTarget.path, edited) });
    expect(handEdited.isolation).toBeUndefined();
    expect(handEdited.refreshSignals.map((signal) => signal.mode)).toEqual(["human-action-required"]);

    // A missing blocked document has nothing to carry forward.
    const missing = new Map(baseTree);
    missing.delete(rendererTarget.path);
    expect(render({ ...stale, existing: missing }).isolation).toBeUndefined();

    // An adoption or ownership rejection elsewhere stops everything, as before.
    const unmarked = render({ ...stale, existing: withFile(catalogTarget.path, "# Catalog\n\nHand-written.\n") });
    expect(unmarked.rejected.map((diff) => diff.reasonCode)).toEqual(["projection-adoption-required"]);
    expect(unmarked.isolation).toBeUndefined();

    // A manifest another renderer wrote is an upgrade, not a partial apply.
    const otherRenderer = baseManifest.replace(`"rendererVersion": "${ARCHITECTURE_DOCS_RENDERER_VERSION}"`, "\"rendererVersion\": \"archcontext.docs-renderer/v5\"");
    expect(otherRenderer).not.toBe(baseManifest);
    expect(render({ ...stale, existing: withFile(MANIFEST, otherRenderer) }).isolation).toBeUndefined();

    // No committed baseline: nothing to carry forward.
    const noManifest = new Map(baseTree);
    noManifest.delete(MANIFEST);
    expect(render({ ...stale, existing: noManifest }).isolation).toBeUndefined();
  });

  test("a target that depends on a blocked and on a clean capability is blocked", () => {
    // Default profile: every node has a document. The inner capability is nested in the outer
    // one, so its document depends on both; only the outer capability's proof fails.
    const outer = provedCapability("nest", "outer");
    const OUTER = outer.nodes[0]!.id;
    const inner = capability("nest", "inner", { parent: OUTER, source: { include: ["packages/outer/inner/**"] } });
    const clean = capability("nest", "clean");
    const nested: NativeModel = {
      nodes: [...outer.nodes, inner, clean],
      relations: [...outer.relations, selfRelation(inner), selfRelation(clean)],
      flows: [...outer.flows, notApplicableFlow(inner.id, "inner"), notApplicableFlow(clean.id, "clean")]
    };
    const footprints = { [OUTER]: stamp("a"), [inner.id]: stamp("b"), [clean.id]: stamp("e") };
    const counts = { [OUTER]: 12, [inner.id]: 4, [clean.id]: 30 };
    const first = render({ model: nested, profile: "default", evidence: [outer.evidence], footprints, counts });
    const firstTree = apply(new Map(), first);
    const settled = render({ model: nested, profile: "default", evidence: [outer.evidence], footprints, counts, existing: firstTree });
    expect(settled.drift.ok).toBe(true);
    expect(settled.majorChange.mode).toBe("none");

    const partial = render({
      model: nested,
      profile: "default",
      evidence: [{ ...outer.evidence, matched: false, callSites: [] }],
      footprints: { ...footprints, [clean.id]: stamp("f") },
      counts: { ...counts, [clean.id]: 60 },
      existing: firstTree,
      isolate: true
    });
    expect(partial.isolation?.blockedCapabilityIds).toEqual([OUTER]);
    const blocked = new Map(partial.isolation!.blockedTargets.map((target) => [target.path, target.capabilityIds]));
    const innerPath = targetOf(first, inner.id).path;
    expect(blocked.get(targetOf(first, OUTER).path)).toEqual([OUTER]);
    expect(blocked.get(targetOf(first, outer.nodes[1]!.id).path)).toEqual([OUTER]);
    expect(blocked.get(innerPath)).toEqual([OUTER]);
    expect(blocked.has(targetOf(first, clean.id).path)).toBe(false);
    expect(partial.files.map((file) => file.path)).not.toContain(innerPath);
    expect(partial.drift.diffs.map((diff) => diff.path).sort()).toEqual([targetOf(first, clean.id).path, MANIFEST].sort());
    const innerRow = partial.isolation!.blockedTargets.find((target) => target.path === innerPath)!.targetId;
    expect(rowLines(partial.manifest.body, innerRow)).toEqual(rowLines(firstTree.get(MANIFEST)!, innerRow));
  });

  test("a CRLF checkout carries the blocked document forward and rewrites the rest in CRLF", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-isolation-crlf-"));
    try {
      for (const [path, body] of baseTree) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), body.replaceAll("\n", "\r\n"));
      }
      const loaded = loadArchitectureDocumentationFiles(root, model, REPO_HARNESS_PROJECTION_PROFILE);
      const lf = render({ evidence: unproven, counts: { ...baseCounts, [CATALOG]: 60 }, footprints: { ...baseFootprints, [CATALOG]: stamp("d") }, existing: baseTree, isolate: true });
      const crlf = render({ evidence: unproven, counts: { ...baseCounts, [CATALOG]: 60 }, footprints: { ...baseFootprints, [CATALOG]: stamp("d") }, existing: loaded, isolate: true });
      expect(crlf.isolation).toEqual(lf.isolation!);
      expect(crlf.manifest.body).toBe(lf.manifest.body);
      expect(crlf.files.map((file) => [file.path, file.body])).toEqual(lf.files.map((file) => [file.path, file.body]));
      // The write keeps the checkout's line endings; the carried rows keep their bytes in CRLF.
      const onDisk = readFileSync(join(root, MANIFEST), "utf8");
      const written = projectionOwnedWriteBody(crlf.manifest.body, onDisk);
      expect(written).toContain("\r\n");
      for (const line of [...rowLines(baseManifest, rendererTarget.targetId), ...capabilityLines(baseManifest, RENDERER)]) {
        expect(onDisk).toContain(`${line}\r\n`);
        expect(written).toContain(`${line}\r\n`);
      }
      expect(crlf.files.map((file) => file.path)).not.toContain(rendererTarget.path);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
