import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  architectureDocumentationProjectionProvenance,
  architectureProofEvidenceDigests,
  loadCapabilitySourceFootprints,
  loadCapabilitySourceScaleSignals,
  renderArchitectureDocumentationProjection,
  type ArchitectureDocumentationProjectionPlan,
  type ArchitectureSelectorEvidenceV1,
  type CapabilityImportGraph,
  type CapabilitySourceFootprintDigest,
  type CapabilitySourceScaleSignal,
  type NativeModel
} from "../src/index";

const sourceDigest = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
/** The docs capability's footprint digest the seeded documents are stamped with, and a moved one. */
const stampDigest = `sha256:${"5".repeat(64)}`;
const movedStampDigest = `sha256:${"6".repeat(64)}`;
const generatedAt = "2026-08-08T00:00:00.000Z";
const provenance = architectureDocumentationProjectionProvenance({
  sourceTreeDigest: sourceDigest,
  modelDigest: sourceDigest, codeGraphDigest: sourceDigest, indexedWorktreeDigest: sourceDigest,
  rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION, layoutVersion: ARCHITECTURE_DOCS_LAYOUT_VERSION,
  generatedFrom: { codeGraphPackage: "@colbymchenry/codegraph", codeGraphVersion: "1.6.1", codeGraphBinaryDigest: sourceDigest, codeGraphStatus: "ready" }
});

const model: NativeModel = {
  nodes: [
    {
      id: "capability.docs.projection",
      kind: "capability",
      name: "Docs Projection",
      status: "active",
      summary: "Projects capability facts into module documentation.",
      source: {
        include: ["packages/core/projection-engine/**"],
        exclude: ["packages/core/projection-engine/test/**"],
        entrypoints: [{
          id: "entrypoint.docs.render",
          path: "packages/core/projection-engine/src/index.ts",
          symbols: [{
            name: "renderArchitectureDocumentationProjection",
            sinks: [{
              id: "sink.docs.normalize",
              path: "packages/core/projection-engine/src/index.ts",
              symbol: "normalizeNativeModel"
            }]
          }]
        }]
      },
      extensions: {
        localContracts: ["packages/core/projection-engine/CLAUDE.md"]
      }
    },
    {
      id: "module.no-source",
      kind: "module",
      name: "No Source Module",
      parent: "capability.docs.projection",
      summary: "A module with no declared source paths."
    }
  ],
  relations: [
    {
      id: "relation.projection-uses-no-source",
      kind: "calls",
      source: "capability.docs.projection",
      target: "module.no-source",
      intent: "read model nodes"
    }
  ],
  flows: [{
    schemaVersion: "archcontext.flow/v1",
    id: "flow.docs.projection.render",
    capabilityId: "capability.docs.projection",
    name: "Render architecture documentation",
    applicability: "required",
    participants: [
      { id: "renderer", nodeId: "capability.docs.projection" },
      { id: "model", nodeId: "module.no-source" }
    ],
    steps: [{
      id: "normalize",
      from: "renderer",
      to: "model",
      label: "Normalize accepted model",
      evidence: { entrypointId: "entrypoint.docs.render", sourceSymbol: "renderArchitectureDocumentationProjection", sinkId: "sink.docs.normalize" }
    }],
    outcomes: [
      {
        id: "rendered", kind: "success", label: "Model proven", steps: [{
          id: "write", from: "renderer", to: "model", label: "Render semantic projection",
          evidence: { entrypointId: "entrypoint.docs.render", sourceSymbol: "renderArchitectureDocumentationProjection", sinkId: "sink.docs.normalize" }
        }], terminal: { participant: "renderer", label: "Return projection plan" }
      },
      {
        id: "rejected", kind: "error", label: "Model unprovable", steps: [{
          id: "reject", from: "renderer", to: "model", label: "Report proof diagnostics",
          evidence: { entrypointId: "entrypoint.docs.render", sourceSymbol: "renderArchitectureDocumentationProjection", sinkId: "sink.docs.normalize" }
        }], terminal: { participant: "renderer", label: "Keep documentation unchanged" }
      }
    ]
  }]
};

const scaleSignals: CapabilitySourceScaleSignal[] = [
  {
    nodeId: "capability.docs.projection",
    fileCount: 3,
    lineCount: 1200,
    includePatterns: ["packages/core/projection-engine/**"],
    excludePatterns: ["packages/core/projection-engine/test/**"]
  }
];

// One same-directory edge (dropped by the directory aggregation) and two cross-directory edges
// leaving the capability footprint. Every drawn edge in the flowchart must trace back to one of
// these; nothing else may appear.
const importGraphs: CapabilityImportGraph[] = [
  {
    nodeId: "capability.docs.projection",
    files: [
      "packages/core/projection-engine/src/index.ts",
      "packages/core/projection-engine/src/mermaid.ts"
    ],
    edges: [
      { from: "packages/core/projection-engine/src/index.ts", to: "packages/core/projection-engine/src/mermaid.ts" },
      { from: "packages/core/projection-engine/src/index.ts", to: "packages/core/architecture-domain/src/index.ts" },
      { from: "packages/core/projection-engine/src/mermaid.ts", to: "packages/contracts/src/schema.ts" }
    ],
    truncated: false
  }
];

const selectorEvidence: ArchitectureSelectorEvidenceV1[] = [
  {
    nodeId: "capability.docs.projection",
    entrypointId: "entrypoint.docs.render",
    sourcePath: "packages/core/projection-engine/src/index.ts",
    sourceSymbol: "renderArchitectureDocumentationProjection",
    sinkId: "sink.docs.normalize",
    sinkPath: "packages/core/projection-engine/src/index.ts",
    sinkSymbol: "normalizeNativeModel",
    matched: true,
    truncated: false,
    callSites: [{ path: "packages/core/projection-engine/src/index.ts", line: 403 }]
  }
];

/**
 * Default footprint measurement: the docs capability's footprint digest the seeded documents are
 * stamped with. Tests that move the footprint pass their own.
 */
const sourceFootprints: CapabilitySourceFootprintDigest[] = [
  { nodeId: "capability.docs.projection", digest: stampDigest, fileCount: 1 }
];

function render(overrides: Partial<Parameters<typeof renderArchitectureDocumentationProjection>[0]> = {}): ArchitectureDocumentationProjectionPlan {
  return renderArchitectureDocumentationProjection({
    model,
    sourceDigest,
    provenance,
    sourceFootprints,
    sourceScaleSignals: scaleSignals,
    importGraphs,
    selectorEvidence,
    generatedAt,
    ...overrides
  });
}

/** Mermaid edge lines (`a --> b`) inside the rendered flowchart fence. */
function flowchartEdgeLines(body: string): string[] {
  const fence = body.slice(body.indexOf("```mermaid\nflowchart TD"));
  return fence.slice(0, fence.indexOf("\n```")).split("\n").filter((line) => line.includes(" --> "));
}

/** Maps a mermaid node id back to the directory label it declares in the same fence. */
function flowchartLabels(body: string): Map<string, string> {
  const fence = body.slice(body.indexOf("```mermaid\nflowchart TD"));
  const out = new Map<string, string>();
  for (const line of fence.slice(0, fence.indexOf("\n```")).split("\n")) {
    const match = /^\s*([A-Za-z][A-Za-z0-9_]*)(?:\["|\(\["|\[\[")(.*?)(?:"\]|"\]\)|"\]\])$/.exec(line);
    if (match) out.set(match[1], match[2]);
  }
  return out;
}

/** No document body or marker carries the stamp: it lives only in the projection manifest. */
function expectNoProvenanceInBody(body: string): void {
  expect(body).not.toContain("Verified against");
  expect(body).not.toContain("verifiedAgainst");
  expect(body).not.toContain("sourceFootprintDigest");
  for (const digest of [stampDigest, movedStampDigest]) expect(body).not.toContain(digest);
}

function entityFile(plan: ArchitectureDocumentationProjectionPlan, nodeId: string) {
  const file = plan.files.find((entry) => entry.target.type === "entity-summary" && entry.target.scope.id === nodeId);
  if (!file) throw new Error(`entity-summary file missing for ${nodeId}`);
  return file;
}

describe("entity-summary capability documentation projection", () => {
  test("renders the handoff intro block and the §1 machine sections from model + measured footprint", () => {
    const body = entityFile(render(), "capability.docs.projection").body;

    expect(body).toContain("# docs/projection 架構文檔");
    expect(body).toContain("> **狀態**:`active`");
    expect(body).toContain("> **Capability ID**:`capability.docs.projection`(kind `capability`)");
    expect(body).toContain("> **Matched Prefixes**:`packages/core/projection-engine/**`");
    expect(body).toContain("> **Local Contracts**:`packages/core/projection-engine/CLAUDE.md`");
    expect(body).toContain("> **事實優先級**:倉庫當前狀態 > 本文檔機器區");
    // The body is not a function of the repository ref; the manifest is where provenance lives.
    expectNoProvenanceInBody(body);
    expect(body).toContain("`docs/architecture/.projection-manifest.json`");

    expect(body).toContain("## 1. P1:能力架構地圖");
    expect(body).toContain("| `entrypoint.docs.render` | `packages/core/projection-engine/src/index.ts#renderArchitectureDocumentationProjection`");
    // 3 files / 1200 lines, printed as the 1–2–5 buckets that contain them.
    expect(body).toContain("- 規模量級:`2–5` 個文件 / `1000–2000` 行");
    expect(body).toContain("- 排除前綴:`packages/core/projection-engine/test/**`");
    expect(body).toContain("- 推導:掃描 `source.include` 減 `source.exclude`");
    expect(body).toContain("- `calls` → `module.no-source` — read model nodes");
    expect(body).toContain("## 2. P2:端到端數據流");

    // Diagram slots carry accepted semantic authority and exact selector proof.
    expect(body).toContain("### 1.1 架構圖");
    expect(body).toContain("```mermaid\nflowchart LR");
    expect(body).toMatch(/```mermaid\n%%\{init: .*\nsequenceDiagram/);
    expect(body).toContain("- Proof: `proven`");
    expect(body).toContain("> **Proof**: `proven`");
    expect(body).toContain("alt Model proven");
    expect(body).toContain("else Model unprovable");
    expect(body).not.toContain("半自動生成的候選圖");

    // Human-owned sections exist as empty headings in the generated skeleton.
    expect(body).toContain("## 3. P3:設計決策與不變量");
    expect(body).toContain("## 4. 歷史決策記錄(append-only)");
    expect(body).toContain("## Optimization Backlog");
  });

  test("annotates a node without source.include instead of inventing scale signals", () => {
    const body = entityFile(render(), "module.no-source").body;

    expect(body).toContain("> **Matched Prefixes**:未宣告(`source.include` 缺失)");
    expect(body).toContain("> **狀態**:未宣告(`status` 缺失)");
    expect(body).toContain("> **Local Contracts**:未宣告(`extensions.localContracts` 缺失)");
    expect(body).toContain("- 未宣告 `source.entrypoints`,入口清單無法從架構模型推導。");
    expect(body).toContain("- 未宣告 `source.include`,規模信號無法推導。");
    expect(body).toContain("human-action-required");
    expect(body).toContain("`semantic-edge-missing`");
    expect(body).toContain("`flow-missing`");
    expect(body).not.toContain("規模量級:`0`");
    expect(body).not.toContain("```mermaid");
  });

  test("keeps the title and the human sections outside the generated region", () => {
    const file = entityFile(render(), "capability.docs.projection");
    const startMarker = file.target.generatedRegion.startMarker;
    const endMarker = file.target.generatedRegion.endMarker;

    expect(file.body.indexOf("# docs/projection 架構文檔")).toBeLessThan(file.body.indexOf(startMarker));
    expect(file.body.indexOf("## 3. P3:設計決策與不變量")).toBeGreaterThan(file.body.indexOf(endMarker));
    expect(file.body.indexOf("## 1. P1:能力架構地圖")).toBeGreaterThan(file.body.indexOf(startMarker));
    expect(file.body.indexOf("## 1. P1:能力架構地圖")).toBeLessThan(file.body.indexOf(endMarker));
  });

  test("is idempotent: re-projecting its own output produces a byte-identical file and clean drift", () => {
    const first = render();
    const existingFiles = [...first.files.map(({ path, body }) => ({ path, body })), first.manifest];
    const second = render({ existingFiles });

    expect(second.projectionDigest).toBe(first.projectionDigest);
    expect(second.drift.ok).toBe(true);
    expect(second.drift.diffs).toEqual([]);
    for (const file of first.files) {
      const reprojected = second.files.find((entry) => entry.path === file.path);
      expect(reprojected?.body).toBe(file.body);
    }

    const third = render({ existingFiles: [...second.files.map(({ path, body }) => ({ path, body })), second.manifest] });
    expect(third.files.map((file) => file.body)).toEqual(second.files.map((file) => file.body));
  });

  test("preserves every byte outside the marker region, including dated §4 entries", () => {
    const seeded = entityFile(render(), "capability.docs.projection");
    const prefix = seeded.body.slice(0, seeded.body.indexOf(seeded.target.generatedRegion.startMarker));
    const humanSuffix = [
      "",
      "## 3. P3:設計決策與不變量",
      "",
      "- 不變量:marker 外內容永不被投影覆寫。",
      "- 10x 失效點:單倉庫文件掃描。",
      "",
      "## 4. 歷史決策記錄(append-only)",
      "",
      "### 2026-08-08 — 接管 capability 文檔投影",
      "",
      "人工撰寫的歷史記錄,含  雙空格、tab\t與尾隨空白 ",
      "",
      "## Optimization Backlog",
      "",
      "- [ ] 補 P1 flowchart",
      ""
    ].join("\n");
    const existingBody = `${prefix}${seeded.body.slice(seeded.body.indexOf(seeded.target.generatedRegion.startMarker), seeded.body.indexOf(seeded.target.generatedRegion.endMarker) + seeded.target.generatedRegion.endMarker.length)}\n${humanSuffix}`;

    // Re-project with a changed model so the generated region genuinely has to be rewritten.
    const mutated: NativeModel = {
      nodes: model.nodes.map((node) => (node.id === "capability.docs.projection" ? { ...node, status: "deprecated" } : node)),
      relations: model.relations
    };
    const plan = render({
      model: mutated,
      sourceDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      existingFiles: [{ path: seeded.path, body: existingBody }]
    });
    const reprojected = entityFile(plan, "capability.docs.projection");

    expect(reprojected.body).not.toBe(existingBody);
    expect(reprojected.body).toContain("> **狀態**:`deprecated`");
    expect(reprojected.body.startsWith(prefix)).toBe(true);
    expect(reprojected.body.endsWith(humanSuffix)).toBe(true);
    expect(Buffer.from(reprojected.body.slice(reprojected.body.indexOf(reprojected.target.generatedRegion.endMarker) + reprojected.target.generatedRegion.endMarker.length)))
      .toEqual(Buffer.from(`\n${humanSuffix}`));
    expect(Buffer.from(reprojected.body.slice(0, reprojected.body.indexOf(reprojected.target.generatedRegion.startMarker))))
      .toEqual(Buffer.from(prefix));
  });

  test("rejects an existing marker-free mixed document and exposes an adoption candidate", () => {
    const existingBody = "# Hand written doc\n\nHuman prose that predates the projection.\n";
    const path = entityFile(render(), "capability.docs.projection").path;
    const plan = render({ existingFiles: [{ path, body: existingBody }] });
    const candidate = plan.adoptionCandidates.find((entry) => entry.path === path)!;

    expect(plan.files.some((entry) => entry.path === path)).toBe(false);
    expect(candidate.body.startsWith(existingBody.trimEnd())).toBe(true);
    expect(plan.drift.reasonCodes).toContain("projection-adoption-required");
    expect(plan.rejected).toContainEqual(expect.objectContaining({ path, reasonCode: "projection-adoption-required" }));
  });

  test("re-rendering with an unchanged footprint is a fixed point: the stamp holds and drift stays clean", () => {
    const first = render();
    const existingFiles = [...first.files.map(({ path, body }) => ({ path, body })), first.manifest];
    // HEAD is not a render input at all; only the footprint content is, and it did not move.
    const again = render({ existingFiles });

    expect(again.drift.ok).toBe(true);
    expect(again.drift.diffs).toEqual([]);
    expect(again.projectionDigest).toBe(first.projectionDigest);
    for (const file of first.files) {
      expect(again.files.find((entry) => entry.path === file.path)?.body).toBe(file.body);
    }
    expect(again.manifest.body).toBe(first.manifest.body);
    // The manifest names the footprint the document was verified against — and the document itself
    // names nothing.
    expect(entityFile(again, "capability.docs.projection").sourceFootprintDigest).toBe(stampDigest);
    expectNoProvenanceInBody(entityFile(again, "capability.docs.projection").body);
  });

  test("projection-owned CodeGraph reindex churn sticks, while source and model authority changes do not", () => {
    const first = render();
    const existingFiles = [...first.files.map(({ path, body }) => ({ path, body })), first.manifest];
    const reproject = (base: typeof provenance, overrides: Partial<typeof provenance>) => {
      const { schemaVersion: _schemaVersion, projectionInputDigest: _projectionInputDigest, ...payload } = base;
      return architectureDocumentationProjectionProvenance({ ...payload, ...overrides });
    };
    const reindexed = reproject(provenance, {
      codeGraphDigest: `sha256:${"b".repeat(64)}`,
      indexedWorktreeDigest: `sha256:${"c".repeat(64)}`
    });
    const projectionOwnedChurn = render({ existingFiles, provenance: reindexed });
    expect(projectionOwnedChurn.drift.ok).toBe(true);
    expect(projectionOwnedChurn.provenance).toEqual(first.provenance);
    expect(projectionOwnedChurn.projectionDigest).toBe(first.projectionDigest);

    const sourceChanged = reproject(reindexed, {
      sourceTreeDigest: `sha256:${"e".repeat(64)}`
    });
    const sourceDrift = render({ existingFiles, provenance: sourceChanged });
    expect(sourceDrift.drift.ok).toBe(false);
    expect(sourceDrift.provenance).toEqual(sourceChanged);

    const modelChanged = reproject(reindexed, {
      modelDigest: `sha256:${"0".repeat(64)}`
    });
    const modelDrift = render({ existingFiles, provenance: modelChanged });
    expect(modelDrift.drift.ok).toBe(false);
    expect(modelDrift.provenance).toEqual(modelChanged);
  });

  test("the semantic baseline records the evidence it was rendered from even when top-level provenance stays sticky", () => {
    // Codex R2 P1: the sticky provenance reuse key excludes CodeGraph evidence, so it cannot
    // attest what a re-baselined semantic state was compiled from; the baseline records that itself.
    const e0 = render({ selectorEvidence: [] });
    const reindexed = architectureDocumentationProjectionProvenance({
      ...(({ schemaVersion: _schemaVersion, projectionInputDigest: _projectionInputDigest, ...payload }) => payload)(provenance),
      codeGraphDigest: `sha256:${"b".repeat(64)}`
    });
    const e1 = render({ existingFiles: [...e0.files.map(({ path, body }) => ({ path, body })), e0.manifest], provenance: reindexed, selectorEvidence });
    const manifest = (plan: ArchitectureDocumentationProjectionPlan) => JSON.parse(plan.manifest.body);
    expect(manifest(e1).provenance).toEqual(manifest(e0).provenance);
    expect(manifest(e0).semanticBaseline.evidence).toEqual(architectureProofEvidenceDigests({ sourceTreeDigest: provenance.sourceTreeDigest, selectorEvidence: [], rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION }));
    expect(manifest(e1).semanticBaseline.evidence).toEqual(architectureProofEvidenceDigests({ sourceTreeDigest: provenance.sourceTreeDigest, selectorEvidence, rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION }));
    expect(manifest(e1).semanticBaseline.evidence).not.toEqual(manifest(e0).semanticBaseline.evidence);
  });

  test("a call-site line shift leaves the recorded evidence and the projection drift unchanged", () => {
    // Round-3 F1: the baseline evidence digest must cover only what the proof compiler reads.
    const first = render();
    const existingFiles = [...first.files.map(({ path, body }) => ({ path, body })), first.manifest];
    const shifted = selectorEvidence.map((entry) => ({ ...entry, callSites: entry.callSites.map((site) => ({ ...site, line: (site.line ?? 0) + 7 })) }));
    const next = render({ existingFiles, selectorEvidence: shifted });
    expect(next.semanticState.flowProofFingerprint).toBe(first.semanticState.flowProofFingerprint);
    expect(JSON.parse(next.manifest.body).semanticBaseline.evidence).toEqual(JSON.parse(first.manifest.body).semanticBaseline.evidence);
    expect(next.drift.ok, JSON.stringify(next.drift.reasonCodes)).toBe(true);
  });

  describe("a manifest from a renderer that predates semanticBaseline.evidence", () => {
    const first = render();
    const reproject = (mutate: (manifest: Record<string, any>) => void) => {
      const manifest = JSON.parse(first.manifest.body);
      mutate(manifest);
      return render({ existingFiles: [...first.files.map(({ path, body }) => ({ path, body })), { path: first.manifest.path, body: `${JSON.stringify(manifest, null, 2)}\n` }] });
    };
    const staleManifest = [expect.objectContaining({ path: "docs/architecture/.projection-manifest.json", reasonCode: "projection-manifest-stale" })];

    test("reads clean when the evidence key is absent and everything else matches", () => {
      const legacy = reproject((manifest) => { delete manifest.semanticBaseline.evidence; });
      expect(legacy.drift.ok, JSON.stringify(legacy.drift.reasonCodes)).toBe(true);
      expect(legacy.drift.diffs).toEqual([]);
      // Tolerated only when read: the renderer still writes the evidence.
      expect(JSON.parse(legacy.manifest.body).semanticBaseline.evidence).toEqual(JSON.parse(first.manifest.body).semanticBaseline.evidence);
    });

    test("stays stale when evidence is present but any digest differs", () => {
      const altered = reproject((manifest) => { manifest.semanticBaseline.evidence.selectorEvidenceDigest = `sha256:${"e".repeat(64)}`; });
      expect(altered.drift.ok).toBe(false);
      expect(altered.drift.diffs).toEqual(staleManifest);
      const nulled = reproject((manifest) => { manifest.semanticBaseline.evidence = null; });
      expect(nulled.drift.diffs).toEqual(staleManifest);
    });

    test("stays stale when evidence is absent and any other field is missing or altered", () => {
      const withoutEvidence = (mutate: (manifest: Record<string, any>) => void) => reproject((manifest) => {
        delete manifest.semanticBaseline.evidence;
        mutate(manifest);
      });
      expect(withoutEvidence((manifest) => { delete manifest.receiptDigest; }).drift.diffs).toEqual(staleManifest);
      expect(withoutEvidence((manifest) => { delete manifest.fileCount; }).drift.diffs).toEqual(staleManifest);
      expect(withoutEvidence((manifest) => { manifest.semanticBaseline.digests.flowProofDigest = `sha256:${"f".repeat(64)}`; }).drift.diffs).toEqual(staleManifest);
      expect(withoutEvidence((manifest) => { manifest.targetCount += 1; }).drift.diffs).toEqual(staleManifest);
      expect(reproject((manifest) => { delete manifest.semanticBaseline; }).drift.diffs).toEqual(staleManifest);
    });
  });

  test("every selector-evidence fact the proof compiler reads moves the evidence digest", () => {
    const entry: ArchitectureSelectorEvidenceV1 = {
      nodeId: "capability.docs.projection", entrypointId: "entrypoint.a", sourcePath: "src/a.ts", sourceSymbol: "run",
      sinkId: "sink.a", sinkPath: "src/b.ts", sinkSymbol: "write", matched: true, truncated: false, callSites: [{ path: "src/a.ts", line: 3 }]
    };
    const digestOf = (evidence: ArchitectureSelectorEvidenceV1[]) =>
      architectureProofEvidenceDigests({ sourceTreeDigest: sourceDigest, selectorEvidence: evidence, rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION }).selectorEvidenceDigest;
    const baseline = digestOf([entry]);
    const consumed: Partial<ArchitectureSelectorEvidenceV1>[] = [
      { nodeId: "module.other" }, { entrypointId: "entrypoint.b" }, { sourceSymbol: "other" }, { sinkId: "sink.b" },
      { matched: false }, { ambiguous: true }, { truncated: true }, { callSites: [] }
    ];
    for (const change of consumed) expect(digestOf([{ ...entry, ...change }]), JSON.stringify(change)).not.toBe(baseline);
    // Not read by the compiler: call-site paths and lines, source/sink paths and sink symbol.
    for (const change of [
      { callSites: [{ path: "src/other.ts", line: 99 }, { path: "src/a.ts" }] }, { sourcePath: "src/moved.ts" }, { sinkPath: "src/moved.ts" }, { sinkSymbol: "renamed" }
    ] as Partial<ArchitectureSelectorEvidenceV1>[]) expect(digestOf([{ ...entry, ...change }]), JSON.stringify(change)).toBe(baseline);
    // Order-insensitive, but a duplicate entry (which the compiler reads as ambiguous) counts.
    const other = { ...entry, sinkId: "sink.b" };
    expect(digestOf([entry, other])).toBe(digestOf([other, entry]));
    expect(digestOf([entry, entry])).not.toBe(baseline);
    expect(architectureProofEvidenceDigests({ sourceTreeDigest: sourceDigest, selectorEvidence: [entry], rendererVersion: "other-renderer" }))
      .not.toEqual(architectureProofEvidenceDigests({ sourceTreeDigest: sourceDigest, selectorEvidence: [entry], rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION }));
  });

  test("a covered source change re-stamps in the manifest and leaves the document byte-identical", () => {
    // An edit inside the capability's footprint that changes nothing the document asserts still
    // moves the footprint digest, so the re-render re-stamps: the stamp records that this render read
    // the current footprint. That re-stamp must not rewrite the document — for a capability covering
    // `tests/**` that would be a stamp-only commit every time anyone touches a test. So the stamp
    // advances in the manifest and the `.md` does not move.
    const first = render();
    const existingFiles = [...first.files.map(({ path, body }) => ({ path, body })), first.manifest];
    const reverified = render({
      existingFiles,
      sourceFootprints: [{ nodeId: "capability.docs.projection", digest: movedStampDigest, fileCount: 1 }]
    });

    const before = entityFile(first, "capability.docs.projection");
    const after = entityFile(reverified, "capability.docs.projection");
    expect(after.sourceFootprintDigest).toBe(movedStampDigest);
    // Byte-identical, marker attributes included: the stamp is not a body input at all.
    expect(after.body).toBe(before.body);
    expect(after.target.generatedRegion.startMarker).toBe(before.target.generatedRegion.startMarker);
    // The manifest is the one file that moved, and it moved because the stamp did.
    expect(reverified.drift.diffs).toEqual([expect.objectContaining({
      path: "docs/architecture/.projection-manifest.json",
      reasonCode: "projection-manifest-stale"
    })]);
    expect(reverified.manifest.body).toContain(movedStampDigest);
    // The node that declares no source carries no stamp: nothing can change under it.
    expect(entityFile(reverified, "module.no-source").sourceFootprintDigest).toBeUndefined();
  });

  test("the first render stamps the measured footprint, and a footprint that changes the body re-renders it", () => {
    const first = render();
    expect(entityFile(first, "capability.docs.projection").sourceFootprintDigest).toBe(stampDigest);
    // No marker carries the stamp — not on an entity target, not anywhere.
    for (const file of first.files) {
      expect(file.target.generatedRegion.startMarker).not.toContain("verifiedAgainst=");
      expect(file.target.generatedRegion.startMarker).not.toContain(stampDigest);
    }
    // Non-entity targets carry no stamp at all: they assert nothing about a footprint.
    expect(first.files.find((file) => file.path === "docs/architecture/index.md")!.sourceFootprintDigest).toBeUndefined();

    // Here the footprint grows across a bucket boundary (3 files → 6), which is a rendered assertion
    // moving, so the body genuinely changes and the node re-stamps with it.
    const changed = render({
      existingFiles: [...first.files.map(({ path, body }) => ({ path, body })), first.manifest],
      sourceScaleSignals: [{ ...scaleSignals[0], fileCount: 6 }],
      sourceFootprints: [{ nodeId: "capability.docs.projection", digest: movedStampDigest, fileCount: 6 }]
    });
    expect(entityFile(changed, "capability.docs.projection").sourceFootprintDigest).toBe(movedStampDigest);
    expect(entityFile(changed, "capability.docs.projection").body).toContain("- 規模量級:`5–10` 個文件");
  });

  test("a footprint that grows within its bucket moves nothing a reader or a diff can see", () => {
    // The other half of the churn fix: a precise count in the body rewrote the document on every
    // edit under the footprint. Buckets hold, so only a change of magnitude reaches the document.
    const first = render();
    const existingFiles = [...first.files.map(({ path, body }) => ({ path, body })), first.manifest];
    const withinBucket = render({
      existingFiles,
      sourceScaleSignals: [{ ...scaleSignals[0], fileCount: 4, lineCount: 1999 }]
    });

    expect(entityFile(withinBucket, "capability.docs.projection").body).toBe(entityFile(first, "capability.docs.projection").body);
    expect(withinBucket.drift.ok).toBe(true);
    expect(withinBucket.drift.diffs).toEqual([]);
  });

  test("scale buckets label the 1–2–5 range that contains the count, in one unit", () => {
    const label = (fileCount: number, lineCount: number) => {
      const body = entityFile(render({ sourceScaleSignals: [{ ...scaleSignals[0], fileCount, lineCount }] }), "capability.docs.projection").body;
      return body.split("\n").find((line) => line.startsWith("- 規模量級:"))!;
    };

    expect(label(1, 1)).toBe("- 規模量級:`1–2` 個文件 / `1–2` 行");
    expect(label(3, 537)).toBe("- 規模量級:`2–5` 個文件 / `500–1000` 行");
    expect(label(5, 5000)).toBe("- 規模量級:`5–10` 個文件 / `5000–10000` 行");
    // The two counts that produced six stamp-only commits in one day now land in the same bucket.
    expect(label(537, 172275)).toBe(label(538, 172396));
    expect(label(537, 172275)).toBe("- 規模量級:`500–1000` 個文件 / `100k–200k` 行");
    expect(label(2_500_000, 3_000_000)).toBe("- 規模量級:`2M–5M` 個文件 / `2M–5M` 行");
    // A footprint that resolves to no files is reported as measured-zero, never bucketed.
    expect(label(0, 0)).toBe("- 規模量級:`0` 個文件 / `0` 行");
    expect(() => label(-1, 0)).toThrow("architecture-docs-projection-scale-signal-not-a-count");
    expect(() => label(1.5, 0)).toThrow("architecture-docs-projection-scale-signal-not-a-count");
  });

  test("a malformed, legacy, or unreadable prior manifest never reaches the new stamp", () => {
    // The stamp is measured, never read back from the previous manifest, so nothing a prior manifest
    // carries — a commit stamp, garbage, or an unparseable body — can launder into the next one.
    const first = render();
    const seeded = entityFile(first, "capability.docs.projection");
    const documents = first.files.map(({ path, body }) => ({ path, body }));
    const corruptions = [
      first.manifest.body.replaceAll(`"sourceFootprintDigest": "${stampDigest}"`, '"sourceFootprintDigest": "not-a-stamp"'),
      first.manifest.body.replaceAll(`"sourceFootprintDigest": "${stampDigest}"`, '"verifiedAgainst": { "branch": "main", "commit": "7415329", "committedAt": "2026-08-08T09:30:00+08:00" }'),
      "{ not json"
    ];
    for (const body of corruptions) {
      const replan = render({ existingFiles: [...documents, { path: first.manifest.path, body }] });
      const reprojected = entityFile(replan, "capability.docs.projection");
      expect(reprojected.sourceFootprintDigest).toBe(stampDigest);
      expect(reprojected.body).toBe(seeded.body);
      expect(replan.manifest.body).toBe(first.manifest.body);
    }
  });

  test("a re-measured scale signal reports stale, never a manual edit; a hand-edited machine region still reports one", () => {
    const first = render();
    const existingFiles = [...first.files.map(({ path, body }) => ({ path, body })), first.manifest];

    // Same model, but the capability grew past its bucket: the digest inputs moved, so
    // the region is stale — reporting it as a manual edit would accuse a human of an edit the
    // measurement made.
    const grown = render({
      existingFiles,
      sourceScaleSignals: [{ ...scaleSignals[0], fileCount: 6, lineCount: 3000 }]
    });
    expect(grown.drift.reasonCodes).toContain("projection-generated-region-stale");
    expect(grown.drift.reasonCodes).not.toContain("projection-generated-region-manually-edited");

    // A genuine hand edit inside the machine region is still caught.
    const seeded = entityFile(first, "capability.docs.projection");
    const tampered = seeded.body.replace("- 規模量級:`2–5` 個文件", "- 規模量級:`999–1000` 個文件");
    expect(tampered).not.toBe(seeded.body);
    const edited = render({ existingFiles: [{ path: seeded.path, body: tampered }] });
    expect(edited.drift.diffs.some((diff) =>
      diff.path === seeded.path && diff.reasonCode === "projection-generated-region-manually-edited"
    )).toBe(true);
  });

  test("fails closed when a node declares source.include but carries no footprint digest", () => {
    expect(() => render({ sourceFootprints: [] })).toThrow("architecture-docs-projection-source-footprint-missing: capability.docs.projection");
    expect(() => render({ sourceFootprints: [{ nodeId: "capability.docs.projection", digest: "7415329", fileCount: 1 }] }))
      .toThrow("architecture-docs-projection-source-footprint-missing: capability.docs.projection");
  });

  test("fails closed when a node declares source.include but carries no measured scale signal", () => {
    expect(() => render({ sourceScaleSignals: [] })).toThrow("architecture-docs-projection-scale-signal-missing: capability.docs.projection");
  });

  test("loadCapabilitySourceScaleSignals measures declared includes minus excludes", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-scale-"));
    try {
      mkdirSync(join(root, "packages/core/projection-engine/src"), { recursive: true });
      mkdirSync(join(root, "packages/core/projection-engine/test"), { recursive: true });
      mkdirSync(join(root, "node_modules/noise"), { recursive: true });
      writeFileSync(join(root, "packages/core/projection-engine/src/index.ts"), "a\nb\nc\n");
      writeFileSync(join(root, "packages/core/projection-engine/src/other.ts"), "a\nb\n");
      writeFileSync(join(root, "packages/core/projection-engine/test/index.test.ts"), "x\ny\nz\nw\n");
      writeFileSync(join(root, "node_modules/noise/index.ts"), "should not be counted\n");

      const signals = loadCapabilitySourceScaleSignals(root, model);
      expect(signals).toHaveLength(1);
      expect(signals[0]).toEqual({
        nodeId: "capability.docs.projection",
        fileCount: 2,
        lineCount: 5,
        includePatterns: ["packages/core/projection-engine/**"],
        excludePatterns: ["packages/core/projection-engine/test/**"]
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("loadCapabilitySourceFootprints resolves the same files the scale signal counts", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-footprint-"));
    try {
      mkdirSync(join(root, "packages/core/projection-engine/src"), { recursive: true });
      mkdirSync(join(root, "packages/core/projection-engine/test"), { recursive: true });
      writeFileSync(join(root, "packages/core/projection-engine/src/index.ts"), "a\n");
      writeFileSync(join(root, "packages/core/projection-engine/src/other.ts"), "a\n");
      writeFileSync(join(root, "packages/core/projection-engine/test/index.test.ts"), "a\n");

      expect(loadCapabilitySourceFootprints(root, model)).toEqual([
        {
          nodeId: "capability.docs.projection",
          files: [
            "packages/core/projection-engine/src/index.ts",
            "packages/core/projection-engine/src/other.ts"
          ],
          includePatterns: ["packages/core/projection-engine/**"],
          excludePatterns: ["packages/core/projection-engine/test/**"]
        }
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("semantic P1/P2 entity integration", () => {
  test("raw import graphs do not affect the verified semantic diagram", () => {
    const baseline = entityFile(render(), "capability.docs.projection").body;
    const changedRawGraph = entityFile(render({
      importGraphs: [{
        nodeId: "capability.docs.projection",
        files: ["invented/path.ts"],
        edges: [{ from: "invented/path.ts", to: "invented/other.ts" }],
        truncated: true
      }]
    }), "capability.docs.projection").body;
    expect(changedRawGraph).toBe(baseline);
    expect(changedRawGraph).not.toContain("invented/path.ts");
  });

  test("missing exact selector evidence is human-action-required and emits no P2 fence", () => {
    const body = entityFile(render({ selectorEvidence: [] }), "capability.docs.projection").body;
    expect(body).toContain("human-action-required");
    expect(body).toContain("`selector-evidence-missing`");
    expect(body).not.toContain("sequenceDiagram");
  });

  test("truncated selector evidence cannot be upgraded to proven", () => {
    const body = entityFile(render({
      selectorEvidence: selectorEvidence.map((entry) => ({ ...entry, truncated: true }))
    }), "capability.docs.projection").body;
    expect(body).toContain("`selector-evidence-truncated`");
    expect(body).not.toContain("> **Proof**: `proven`");
  });
});

describe("node-scoped sticky key", () => {
  const nodeB = "capability.docs.qa";

  /** The default model plus a second capability with its own declared `source.include` footprint. */
  const twoFootprintModel: NativeModel = {
    nodes: [
      ...model.nodes,
      {
        id: nodeB,
        kind: "capability",
        name: "Docs QA",
        status: "active",
        summary: "Checks projected documentation.",
        source: { include: ["packages/core/docs-qa/**"] }
      }
    ],
    relations: model.relations,
    flows: model.flows
  };

  const scaleSignalB = {
    nodeId: nodeB,
    fileCount: 515,
    lineCount: 9000,
    includePatterns: ["packages/core/docs-qa/**"],
    excludePatterns: []
  } satisfies CapabilitySourceScaleSignal;

  const footprintB = `sha256:${"7".repeat(64)}`;
  const twoFootprints: CapabilitySourceFootprintDigest[] = [...sourceFootprints, { nodeId: nodeB, digest: footprintB, fileCount: 515 }];

  test("an unrelated commit and a sibling node's re-measurement leave the untouched node byte-identical and stamped", () => {
    const nodeA = "capability.docs.projection";
    const run1 = render({ model: twoFootprintModel, sourceScaleSignals: [...scaleSignals, scaleSignalB], sourceFootprints: twoFootprints });
    const existingFiles = [...run1.files.map(({ path, body }) => ({ path, body })), run1.manifest];

    // An unrelated commit moved the whole tree (new global digest), and sibling B's footprint
    // changed. Node A's own footprint digest is identical.
    const movedB = `sha256:${"8".repeat(64)}`;
    const run2 = render({
      model: twoFootprintModel,
      sourceDigest: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
      existingFiles,
      sourceScaleSignals: [...scaleSignals, { ...scaleSignalB, fileCount: 517 }],
      sourceFootprints: [sourceFootprints[0]!, { nodeId: nodeB, digest: movedB, fileCount: 517 }]
    });

    // A is byte-identical and keeps the footprint it was verified against.
    expect(entityFile(run2, nodeA).body).toBe(entityFile(run1, nodeA).body);
    expect(entityFile(run2, nodeA).sourceFootprintDigest).toBe(stampDigest);
    // B re-stamped with its new footprint. It grew inside its bucket (515 → 517 files), so the stamp
    // is the only thing that moved and B's document is byte-identical too — the isolation being
    // asserted is per-node stamp lifetime, not per-node rewriting.
    expect(entityFile(run2, nodeB).sourceFootprintDigest).toBe(movedB);
    expect(entityFile(run2, nodeB).body).toBe(entityFile(run1, nodeB).body);
    expect(entityFile(run2, nodeB).body).toContain("- 規模量級:`500–1000` 個文件");
    expectNoProvenanceInBody(entityFile(run2, nodeB).body);
  });

  test("documents carrying pre-v4 markers and the old digest shape re-render wholesale under v4", () => {
    const current = render();
    // Simulate files left behind by the previous renderer: v3 marker attributes (including the
    // provenance attribute v4 drops) and the old plan-wide digest shape. The one-time full re-render
    // is the accepted migration cost of moving the stamp out of every document.
    const legacyFiles = current.files.map(({ path, body }) => ({
      path,
      body: body
        .replaceAll('rendererVersion="archcontext.docs-renderer/v4"', 'rendererVersion="archcontext.docs-renderer/v3" verifiedAgainst="main@7415329@2026-08-08T09:30:00+08:00"')
        .replace(/sourceDigest="sha256:[a-f0-9]+"/g, 'sourceDigest="sha256:0000000000000000000000000000000000000000000000000000000000000000"')
    }));
    const upgraded = render({ existingFiles: [...legacyFiles, current.manifest] });

    expect(upgraded.files).toHaveLength(current.files.length);
    for (const file of upgraded.files) {
      expect(file.target.generatedRegion.startMarker).toContain('rendererVersion="archcontext.docs-renderer/v4"');
      expect(file.target.generatedRegion.startMarker).not.toContain("verifiedAgainst=");
      expect(file.body).not.toBe(legacyFiles.find((entry) => entry.path === file.path)!.body);
    }
    // Every legacy target is awaiting re-render — stale, never accused of a manual edit — and every
    // entity summary with a footprint is stamped with its current digest.
    expect(upgraded.drift.reasonCodes).toContain("projection-generated-region-stale");
    expect(upgraded.drift.reasonCodes).not.toContain("projection-generated-region-manually-edited");
    for (const file of current.files.filter((entry) => entry.target.type === "entity-summary")) {
      expect(upgraded.files.find((entry) => entry.path === file.path)?.sourceFootprintDigest)
        .toBe(file.target.scope.id === "capability.docs.projection" ? stampDigest : undefined);
    }
  });
});

describe("canonical body digest sticky key", () => {
  const nodeA = "capability.docs.projection";

  /** The default model with only model-level fields flipped: status, summary, local contracts. */
  const statusFlippedModel: NativeModel = {
    nodes: model.nodes.map((node) => node.id === nodeA ? {
      ...node,
      status: "deprecated",
      summary: "Projects capability facts into module documentation. Superseded by the ledger.",
      extensions: {
        localContracts: ["packages/core/projection-engine/CLAUDE.md", "packages/core/projection-engine/AGENTS.md"]
      }
    } : node),
    relations: model.relations,
    flows: model.flows
  };

  test("a model-level status flip re-renders the body while the footprint stamp stays put", () => {
    const run1 = render();
    const existingFiles = [...run1.files.map(({ path, body }) => ({ path, body })), run1.manifest];

    // Only model-level fields outside any source footprint move: the node's status flips, its
    // summary is reworded, and a contract file is added. The footprint is unchanged.
    const run2 = render({ model: statusFlippedModel, existingFiles });

    // The rendered body moved; the stamp still names the footprint this render read, which is the
    // same content run 1 read.
    expect(entityFile(run2, nodeA).sourceFootprintDigest).toBe(stampDigest);
    expect(entityFile(run2, nodeA).body).toContain("> **狀態**:`deprecated`");
    expect(entityFile(run2, nodeA).body).toContain("packages/core/projection-engine/AGENTS.md");
    expectNoProvenanceInBody(entityFile(run2, nodeA).body);
  });

  test("once a status-flip re-render lands, the projection settles to a new fixed point", () => {
    const reapply = (base: ArchitectureDocumentationProjectionPlan) => render({
      model: statusFlippedModel,
      existingFiles: [...base.files.map(({ path, body }) => ({ path, body })), base.manifest]
    });

    const run1 = render();
    const run2 = reapply(run1);

    // Run 2's output is what sits on disk after `docs apply`. Every document holds; the manifest is
    // the one file still stale: its receipt digests the major-change classification, which settles
    // only after the semantic delta has been consumed by the first post-apply render — a property of
    // the baseline machinery, orthogonal to stamps.
    const run3 = reapply(run2);
    expect(run3.drift.diffs).toEqual([expect.objectContaining({
      path: "docs/architecture/.projection-manifest.json",
      reasonCode: "projection-manifest-stale"
    })]);
    for (const file of run2.files) {
      expect(run3.files.find((entry) => entry.path === file.path)?.body).toBe(file.body);
    }
    expect(entityFile(run3, nodeA).sourceFootprintDigest).toBe(stampDigest);
    expect(entityFile(run3, "module.no-source").sourceFootprintDigest).toBeUndefined();
    expectNoProvenanceInBody(entityFile(run3, nodeA).body);

    // And the settle completes on the next apply: re-projecting run 3's output with identical
    // inputs is fully clean — documents and manifest.
    const run4 = reapply(run3);
    expect(run4.drift.ok).toBe(true);
    expect(run4.drift.diffs).toEqual([]);
    expect(run4.files.map((file) => file.body)).toEqual(run3.files.map((file) => file.body));
    expect(run4.manifest.body).toBe(run3.manifest.body);
  });
});
