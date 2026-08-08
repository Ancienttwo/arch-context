import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  architectureDocumentationProjectionProvenance,
  assertArchitectureProjectionVerifiedAgainst,
  loadCapabilitySourceFootprints,
  loadCapabilitySourceScaleSignals,
  renderArchitectureDocumentationProjection,
  type ArchitectureDocumentationProjectionPlan,
  type ArchitectureSelectorEvidenceV1,
  type CapabilityImportGraph,
  type CapabilitySourceChangeSinceStamp,
  type CapabilitySourceScaleSignal,
  type NativeModel
} from "../src/index";

const sourceDigest = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
const verifiedAgainst = { branch: "main", commit: "7415329", committedAt: "2026-08-08T09:30:00+08:00" };
const generatedAt = "2026-08-08T00:00:00.000Z";
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
 * Default stamp-lifecycle measurement: nothing under the capability's footprint changed since the
 * commit the seeded documents are stamped with. Tests that need the opposite pass their own.
 */
const sourceChangesSinceStamp: CapabilitySourceChangeSinceStamp[] = [
  { nodeId: "capability.docs.projection", commit: verifiedAgainst.commit, status: "unchanged" }
];

function render(overrides: Partial<Parameters<typeof renderArchitectureDocumentationProjection>[0]> = {}): ArchitectureDocumentationProjectionPlan {
  return renderArchitectureDocumentationProjection({
    model,
    sourceDigest,
    provenance,
    verifiedAgainst,
    sourceChangesSinceStamp,
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

/** Blanks the two places a stamp shows up (marker attributes, intro line) for byte comparison. */
function stripStampLines(body: string): string {
  return body
    .replace(/<!-- BEGIN ARCHCONTEXT:generated[^\n]*-->/, "<!-- BEGIN -->")
    .replace(/^> \*\*Verified against\*\*.*$/m, "> **Verified against**");
}

function entityFile(plan: ArchitectureDocumentationProjectionPlan, nodeId: string) {
  const file = plan.files.find((entry) => entry.target.type === "entity-summary" && entry.target.scope.id === nodeId);
  if (!file) throw new Error(`entity-summary file missing for ${nodeId}`);
  return file;
}

describe("entity-summary capability documentation projection", () => {
  test("renders the handoff intro block and the §1 machine sections from model + Git ref", () => {
    const body = entityFile(render(), "capability.docs.projection").body;

    expect(body).toContain("# docs/projection 架構文檔");
    expect(body).toContain("> **狀態**:`active`");
    expect(body).toContain("> **Verified against**:`main@7415329`(2026-08-08)");
    expect(body).toContain("> **Capability ID**:`capability.docs.projection`(kind `capability`)");
    expect(body).toContain("> **Matched Prefixes**:`packages/core/projection-engine/**`");
    expect(body).toContain("> **Local Contracts**:`packages/core/projection-engine/CLAUDE.md`");
    expect(body).toContain("> **事實優先級**:倉庫當前狀態 > 本文檔機器區");

    expect(body).toContain("## 1. P1:能力架構地圖");
    expect(body).toContain("| `entrypoint.docs.render` | `packages/core/projection-engine/src/index.ts#renderArchitectureDocumentationProjection`");
    expect(body).toContain("- 文件數:`3`");
    expect(body).toContain("- 總行數:`1200`");
    expect(body).toContain("- 排除前綴:`packages/core/projection-engine/test/**`");
    expect(body).toContain("- 復算:`archctx docs plan --json`");
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
    expect(body).not.toContain("文件數:`0`");
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

  test("moving HEAD with unchanged inputs is a fixed point: the stamp sticks and drift stays clean", () => {
    const first = render();
    const existingFiles = [...first.files.map(({ path, body }) => ({ path, body })), first.manifest];
    // The commit the projection was applied on has since been committed and HEAD has moved on.
    const moved = render({ existingFiles, verifiedAgainst: { branch: "main", commit: "0badc0de", committedAt: "2026-08-09T09:30:00+08:00" } });

    expect(moved.drift.ok).toBe(true);
    expect(moved.drift.diffs).toEqual([]);
    expect(moved.projectionDigest).toBe(first.projectionDigest);
    for (const file of first.files) {
      expect(moved.files.find((entry) => entry.path === file.path)?.body).toBe(file.body);
    }
    expect(moved.manifest.body).toBe(first.manifest.body);
    // The document keeps naming the commit it was actually verified against, not the moved HEAD.
    expect(entityFile(moved, "capability.docs.projection").body).toContain("> **Verified against**:`main@7415329`");
    expect(entityFile(moved, "capability.docs.projection").body).not.toContain("0badc0de");

    // And it keeps holding across a third commit, so the fixed point is not a one-shot.
    const movedAgain = render({
      existingFiles: [...moved.files.map(({ path, body }) => ({ path, body })), moved.manifest],
      verifiedAgainst: { branch: "main", commit: "feedface", committedAt: "2026-08-10T09:30:00+08:00" }
    });
    expect(movedAgain.drift.ok).toBe(true);
    expect(movedAgain.files.map((file) => file.body)).toEqual(moved.files.map((file) => file.body));
  });

  test("a covered source change re-stamps even when it moves no rendered assertion", () => {
    // The narrow deadlock this input exists to close: an edit inside the capability's footprint that
    // changes nothing the document asserts (same files, same line count, same import edges, same call
    // trail) leaves every digest identical. Stickiness driven by digests alone would pin the stamp to
    // a commit the document was never re-verified against, and the freshness gate would then be
    // impossible to clear by re-projecting.
    const first = render();
    const existingFiles = [...first.files.map(({ path, body }) => ({ path, body })), first.manifest];
    const nextRef = { branch: "main", commit: "0badc0de", committedAt: "2026-08-09T09:30:00+08:00" };
    const reverified = render({
      existingFiles,
      verifiedAgainst: nextRef,
      sourceChangesSinceStamp: [{
        nodeId: "capability.docs.projection",
        commit: verifiedAgainst.commit,
        status: "changed",
        changedPathCount: 1
      }]
    });

    const before = entityFile(first, "capability.docs.projection");
    const after = entityFile(reverified, "capability.docs.projection");
    expect(after.verifiedAgainst).toEqual(nextRef);
    expect(after.body).toContain("> **Verified against**:`main@0badc0de`(2026-08-09)");
    expect(reverified.notices).toEqual([]);
    // Nothing else in the document moved: only the stamp line and the marker attributes it feeds.
    expect(stripStampLines(after.body)).toBe(stripStampLines(before.body));
    // The node that declares no source keeps its stamp: nothing can change under it.
    expect(entityFile(reverified, "module.no-source").verifiedAgainst).toEqual(verifiedAgainst);
  });

  test("an unmeasurable or mismatched change set re-stamps with a notice instead of failing", () => {
    const first = render();
    const existingFiles = [...first.files.map(({ path, body }) => ({ path, body })), first.manifest];
    const nextRef = { branch: "main", commit: "0badc0de", committedAt: "2026-08-09T09:30:00+08:00" };

    // The stamped commit is not in this repository any more (rebase, shallow clone). Failing closed
    // here would make the projection permanently unapplyable, so it re-stamps and says so.
    const unmeasurable = render({
      existingFiles,
      verifiedAgainst: nextRef,
      sourceChangesSinceStamp: [{
        nodeId: "capability.docs.projection",
        commit: verifiedAgainst.commit,
        status: "unmeasurable",
        reason: "fatal: bad object 7415329"
      }]
    });
    expect(entityFile(unmeasurable, "capability.docs.projection").verifiedAgainst).toEqual(nextRef);
    expect(unmeasurable.notices).toEqual([{
      code: "projection-stamp-change-set-unmeasurable",
      nodeId: "capability.docs.projection",
      targetId: entityFile(first, "capability.docs.projection").target.targetId,
      path: entityFile(first, "capability.docs.projection").path,
      stampedCommit: "7415329",
      detail: expect.stringContaining("fatal: bad object 7415329")
    }]);

    // A measurement taken against some other commit says nothing about this document's baseline.
    const mismatched = render({
      existingFiles,
      verifiedAgainst: nextRef,
      sourceChangesSinceStamp: [{ nodeId: "capability.docs.projection", commit: "cafe1234", status: "unchanged" }]
    });
    expect(entityFile(mismatched, "capability.docs.projection").verifiedAgainst).toEqual(nextRef);
    expect(mismatched.notices).toHaveLength(1);
    expect(mismatched.notices[0].detail).toContain("cafe1234");

    // And a node whose stamp the caller never measured at all is re-stamped, not trusted.
    const unmeasured = render({ existingFiles, verifiedAgainst: nextRef, sourceChangesSinceStamp: [] });
    expect(entityFile(unmeasured, "capability.docs.projection").verifiedAgainst).toEqual(nextRef);
    expect(unmeasured.notices).toHaveLength(1);
  });

  test("a stamp-only re-render reports stale, not a manual edit", () => {
    const first = render();
    const stamped = render({
      existingFiles: [...first.files.map(({ path, body }) => ({ path, body })), first.manifest],
      verifiedAgainst: { branch: "main", commit: "0badc0de", committedAt: "2026-08-09T09:30:00+08:00" },
      sourceChangesSinceStamp: [{
        nodeId: "capability.docs.projection",
        commit: verifiedAgainst.commit,
        status: "changed",
        changedPathCount: 1
      }]
    });
    const diff = stamped.drift.diffs.find((entry) => entry.path === entityFile(first, "capability.docs.projection").path);
    expect(diff?.reasonCode).toBe("projection-generated-region-stale");
  });

  test("the first render stamps the caller's ref, and re-stamps once a render input actually changes", () => {
    const first = render();
    expect(entityFile(first, "capability.docs.projection").verifiedAgainst).toEqual(verifiedAgainst);
    expect(entityFile(first, "capability.docs.projection").target.generatedRegion.startMarker)
      .toContain('verifiedAgainst="main@7415329@2026-08-08T09:30:00+08:00"');
    // Non-entity targets carry no stamp: they print no Git ref, so they have nothing to stick to.
    const index = first.files.find((file) => file.path === "docs/architecture/index.md")!;
    expect(index.verifiedAgainst).toBeUndefined();
    expect(index.target.generatedRegion.startMarker).not.toContain("verifiedAgainst=");

    const nextRef = { branch: "main", commit: "0badc0de", committedAt: "2026-08-09T09:30:00+08:00" };
    const changed = render({
      existingFiles: [...first.files.map(({ path, body }) => ({ path, body })), first.manifest],
      sourceDigest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      verifiedAgainst: nextRef
    });
    expect(entityFile(changed, "capability.docs.projection").verifiedAgainst).toEqual(nextRef);
    expect(entityFile(changed, "capability.docs.projection").body).toContain("> **Verified against**:`main@0badc0de`(2026-08-09)");
  });

  test("a malformed or absent marker stamp re-stamps instead of leaking a bad value into the prose", () => {
    const first = render();
    const seeded = entityFile(first, "capability.docs.projection");
    const nextRef = { branch: "main", commit: "0badc0de", committedAt: "2026-08-09T09:30:00+08:00" };

    for (const corruption of ['verifiedAgainst="not-a-stamp"', 'verifiedAgainst="main@zzzz@nope"', ""]) {
      const corrupted = seeded.body.replace(/ verifiedAgainst="[^"]*"/, corruption === "" ? "" : ` ${corruption}`);
      const replan = render({
        existingFiles: [{ path: seeded.path, body: corrupted }],
        verifiedAgainst: nextRef
      });
      const reprojected = entityFile(replan, "capability.docs.projection");
      expect(reprojected.verifiedAgainst).toEqual(nextRef);
      expect(reprojected.body).toContain("> **Verified against**:`main@0badc0de`(2026-08-09)");
      expect(reprojected.body).not.toContain("not-a-stamp");
      expect(reprojected.body).not.toContain("zzzz");
    }
  });

  test("a re-measured scale signal reports stale, never a manual edit; a hand-edited machine region still reports one", () => {
    const first = render();
    const existingFiles = [...first.files.map(({ path, body }) => ({ path, body })), first.manifest];

    // Same model, same Git ref, but the capability grew: the digest inputs moved, so the region is
    // stale — reporting it as a manual edit would accuse a human of an edit the measurement made.
    const grown = render({
      existingFiles,
      sourceScaleSignals: [{ ...scaleSignals[0], fileCount: 4, lineCount: 1500 }]
    });
    expect(grown.drift.reasonCodes).toContain("projection-generated-region-stale");
    expect(grown.drift.reasonCodes).not.toContain("projection-generated-region-manually-edited");

    // A genuine hand edit inside the machine region is still caught.
    const seeded = entityFile(first, "capability.docs.projection");
    const tampered = seeded.body.replace("- 文件數:`3`", "- 文件數:`999`");
    expect(tampered).not.toBe(seeded.body);
    const edited = render({ existingFiles: [{ path: seeded.path, body: tampered }] });
    expect(edited.drift.diffs.some((diff) =>
      diff.path === seeded.path && diff.reasonCode === "projection-generated-region-manually-edited"
    )).toBe(true);
  });

  test("fails closed when the Git ref is missing, placeholder, or malformed", () => {
    expect(() => render({ verifiedAgainst: undefined as never })).toThrow("architecture-docs-projection-verified-against-missing");
    expect(() => render({ verifiedAgainst: { branch: "unknown", commit: "7415329", committedAt: "2026-08-08T00:00:00Z" } }))
      .toThrow("architecture-docs-projection-verified-against-invalid-branch");
    expect(() => render({ verifiedAgainst: { branch: "main", commit: "unborn", committedAt: "2026-08-08T00:00:00Z" } }))
      .toThrow("architecture-docs-projection-verified-against-invalid-commit");
    expect(() => render({ verifiedAgainst: { branch: "main", commit: "", committedAt: "2026-08-08T00:00:00Z" } }))
      .toThrow("architecture-docs-projection-verified-against-invalid-commit");
    expect(() => render({ verifiedAgainst: { branch: "  ", commit: "7415329", committedAt: "2026-08-08T00:00:00Z" } }))
      .toThrow("architecture-docs-projection-verified-against-invalid-branch");
    expect(() => render({ verifiedAgainst: { branch: "main", commit: "7415329", committedAt: "" } }))
      .toThrow("architecture-docs-projection-verified-against-invalid-committed-at");
    expect(assertArchitectureProjectionVerifiedAgainst({ branch: " main ", commit: " 7415329 ", committedAt: " 2026-08-08T09:30:00+08:00 " }))
      .toEqual({ branch: "main", commit: "7415329", committedAt: "2026-08-08T09:30:00+08:00" });
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
