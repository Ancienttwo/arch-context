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

/**
 * Every commit-shaped value any test in this file feeds the renderer. Since renderer v4 no document
 * body or marker may contain one: provenance lives only in the projection manifest.
 */
const EVERY_TEST_COMMIT = ["7415329", "0badc0de", "feedface", "cafe1234"];

function expectNoProvenanceInBody(body: string): void {
  expect(body).not.toContain("Verified against");
  expect(body).not.toContain("verifiedAgainst");
  for (const commit of EVERY_TEST_COMMIT) expect(body).not.toContain(commit);
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
    // The manifest keeps naming the commit the projection was actually verified against, not the
    // moved HEAD — and the document itself names no commit at all.
    expect(entityFile(moved, "capability.docs.projection").verifiedAgainst).toEqual(verifiedAgainst);
    expectNoProvenanceInBody(entityFile(moved, "capability.docs.projection").body);

    // And it keeps holding across a third commit, so the fixed point is not a one-shot.
    const movedAgain = render({
      existingFiles: [...moved.files.map(({ path, body }) => ({ path, body })), moved.manifest],
      verifiedAgainst: { branch: "main", commit: "feedface", committedAt: "2026-08-10T09:30:00+08:00" }
    });
    expect(movedAgain.drift.ok).toBe(true);
    expect(movedAgain.files.map((file) => file.body)).toEqual(moved.files.map((file) => file.body));
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
      worktreeDigest: `sha256:${"d".repeat(64)}`,
      sourceTreeDigest: `sha256:${"e".repeat(64)}`
    });
    const sourceDrift = render({ existingFiles, provenance: sourceChanged });
    expect(sourceDrift.drift.ok).toBe(false);
    expect(sourceDrift.provenance).toEqual(sourceChanged);

    const modelChanged = reproject(reindexed, {
      worktreeDigest: `sha256:${"f".repeat(64)}`,
      modelDigest: `sha256:${"0".repeat(64)}`
    });
    const modelDrift = render({ existingFiles, provenance: modelChanged });
    expect(modelDrift.drift.ok).toBe(false);
    expect(modelDrift.provenance).toEqual(modelChanged);
  });

  test("a covered source change re-stamps in the manifest and leaves the document byte-identical", () => {
    // The churn this split exists to kill. An edit inside the capability's footprint that changes
    // nothing the document asserts must still re-stamp: the stamp records that this render read the
    // current tree, and a stamp pinned to a commit the document was never re-verified against would
    // make the freshness gate impossible to clear by re-projecting. But that re-stamp must not
    // rewrite the document — for a capability covering `tests/**` that is a stamp-only commit every
    // time anyone touches a test. So the stamp advances in the manifest and the `.md` does not move.
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
    expect(reverified.notices).toEqual([]);
    // Byte-identical, marker attributes included: the stamp is not a body input at all.
    expect(after.body).toBe(before.body);
    expect(after.target.generatedRegion.startMarker).toBe(before.target.generatedRegion.startMarker);
    // The manifest is the one file that moved, and it moved because the stamp did.
    expect(reverified.manifest.body).not.toBe(first.manifest.body);
    expect(reverified.manifest.body).toContain("0badc0de");
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

  test("a re-stamp alone leaves every document clean and moves only the manifest", () => {
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
    // No document is stale and none is accused of a hand edit: none of them changed.
    expect(stamped.drift.diffs).toEqual([expect.objectContaining({
      path: "docs/architecture/.projection-manifest.json",
      reasonCode: "projection-manifest-stale"
    })]);
  });

  test("the first render stamps the caller's ref, and re-stamps once a render input actually changes", () => {
    const first = render();
    expect(entityFile(first, "capability.docs.projection").verifiedAgainst).toEqual(verifiedAgainst);
    // No marker carries the stamp any more — not on an entity target, not anywhere.
    for (const file of first.files) {
      expect(file.target.generatedRegion.startMarker).not.toContain("verifiedAgainst=");
    }
    // Non-entity targets carry no stamp at all: they assert nothing about a footprint.
    expect(first.files.find((file) => file.path === "docs/architecture/index.md")!.verifiedAgainst).toBeUndefined();

    const nextRef = { branch: "main", commit: "0badc0de", committedAt: "2026-08-09T09:30:00+08:00" };
    // The entity key is scoped to the node's own inputs, so a changed global tree digest alone no
    // longer re-stamps it; here the footprint grows across a bucket boundary (3 files → 6), which is
    // a rendered assertion moving, so the body genuinely changes and the node re-stamps with it.
    const changed = render({
      existingFiles: [...first.files.map(({ path, body }) => ({ path, body })), first.manifest],
      sourceScaleSignals: [{ ...scaleSignals[0], fileCount: 6 }],
      verifiedAgainst: nextRef
    });
    expect(entityFile(changed, "capability.docs.projection").verifiedAgainst).toEqual(nextRef);
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

  test("a malformed, absent, or unreadable manifest stamp re-stamps instead of trusting it", () => {
    const first = render();
    const seeded = entityFile(first, "capability.docs.projection");
    const nextRef = { branch: "main", commit: "0badc0de", committedAt: "2026-08-09T09:30:00+08:00" };
    const documents = first.files.map(({ path, body }) => ({ path, body }));

    const corruptions = [
      // A stamp that is not provenance at all, one with a placeholder commit, one absent.
      first.manifest.body.replaceAll(/"verifiedAgainst": \{[^}]*\}/g, '"verifiedAgainst": "not-a-stamp"'),
      first.manifest.body.replaceAll(`"commit": "${verifiedAgainst.commit}"`, '"commit": "unborn"'),
      first.manifest.body.replaceAll(/"verifiedAgainst": \{[^}]*\},?\n/g, ""),
      // A manifest that cannot be parsed at all must not deadlock the projection that replaces it.
      "{ not json",
      // And a manifest whose stamps outlive the documents they describe cannot launder one back on.
      first.manifest.body
    ];

    for (const [index, body] of corruptions.entries()) {
      const replan = render({
        // The last case drops the documents; every other case keeps them intact.
        existingFiles: [...(index === corruptions.length - 1 ? [] : documents), { path: first.manifest.path, body }],
        verifiedAgainst: nextRef
      });
      const reprojected = entityFile(replan, "capability.docs.projection");
      expect(reprojected.verifiedAgainst).toEqual(nextRef);
      expect(reprojected.body).toBe(seeded.body);
      expect(reprojected.body).not.toContain("not-a-stamp");
    }
  });

  test("a re-measured scale signal reports stale, never a manual edit; a hand-edited machine region still reports one", () => {
    const first = render();
    const existingFiles = [...first.files.map(({ path, body }) => ({ path, body })), first.manifest];

    // Same model, same Git ref, but the capability grew past its bucket: the digest inputs moved, so
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

  test("an unrelated commit and a sibling node's re-measurement leave the untouched node byte-identical and stamped", () => {
    const nodeA = "capability.docs.projection";
    const run1 = render({ model: twoFootprintModel, sourceScaleSignals: [...scaleSignals, scaleSignalB] });
    const existingFiles = [...run1.files.map(({ path, body }) => ({ path, body })), run1.manifest];
    const nextRef = { branch: "main", commit: "0badc0de", committedAt: "2026-08-09T09:30:00+08:00" };

    // An unrelated commit moved the whole tree (new global digest), and sibling B's footprint was
    // re-measured plus measured changed. Node A's own inputs are identical and measured unchanged.
    const run2 = render({
      model: twoFootprintModel,
      sourceDigest: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
      verifiedAgainst: nextRef,
      existingFiles,
      sourceScaleSignals: [...scaleSignals, { ...scaleSignalB, fileCount: 517 }],
      sourceChangesSinceStamp: [
        { nodeId: nodeA, commit: verifiedAgainst.commit, status: "unchanged" },
        { nodeId: nodeB, commit: verifiedAgainst.commit, status: "changed", changedPathCount: 2 }
      ]
    });

    // A is byte-identical and keeps the commit it was verified against.
    expect(entityFile(run2, nodeA).body).toBe(entityFile(run1, nodeA).body);
    expect(entityFile(run2, nodeA).verifiedAgainst).toEqual(verifiedAgainst);
    // B re-stamped with the current ref. Its footprint grew inside its bucket (515 → 517 files), so
    // the stamp is the only thing that moved and B's document is byte-identical too — the isolation
    // being asserted is per-node stamp lifetime, not per-node rewriting.
    expect(entityFile(run2, nodeB).verifiedAgainst).toEqual(nextRef);
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
    const nextRef = { branch: "main", commit: "0badc0de", committedAt: "2026-08-09T09:30:00+08:00" };

    const upgraded = render({ existingFiles: [...legacyFiles, current.manifest], verifiedAgainst: nextRef });

    expect(upgraded.files).toHaveLength(current.files.length);
    for (const file of upgraded.files) {
      expect(file.target.generatedRegion.startMarker).toContain('rendererVersion="archcontext.docs-renderer/v4"');
      expect(file.target.generatedRegion.startMarker).not.toContain("verifiedAgainst=");
      expect(file.body).not.toBe(legacyFiles.find((entry) => entry.path === file.path)!.body);
    }
    // Every legacy target is awaiting re-render — stale, never accused of a manual edit — and every
    // entity summary re-stamps with the current ref.
    expect(upgraded.drift.reasonCodes).toContain("projection-generated-region-stale");
    expect(upgraded.drift.reasonCodes).not.toContain("projection-generated-region-manually-edited");
    for (const file of current.files.filter((entry) => entry.target.type === "entity-summary")) {
      expect(upgraded.files.find((entry) => entry.path === file.path)?.verifiedAgainst).toEqual(nextRef);
    }
  });
});

describe("canonical body digest sticky key", () => {
  const nodeA = "capability.docs.projection";
  const nextRef = { branch: "main", commit: "0badc0de", committedAt: "2026-08-09T09:30:00+08:00" };

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

  test("a model-level status flip re-stamps even when every footprint measurement is unchanged", () => {
    const run1 = render();
    const existingFiles = [...run1.files.map(({ path, body }) => ({ path, body })), run1.manifest];

    // Only model-level fields outside any source footprint move: the node's status flips, its
    // summary is reworded, and a contract file is added. The global tree digest is unchanged and
    // the per-node measurement still reports nothing changed under the footprint — exactly the
    // edit a key over scale signal + proof digest alone would let slip through with a stale stamp.
    const run2 = render({ model: statusFlippedModel, verifiedAgainst: nextRef, existingFiles });

    // The rendered body moved, so the node re-stamps with the ref that rendered the new body;
    // reusing run 1's stamp would attribute the new prose to a commit that never rendered it.
    expect(entityFile(run2, nodeA).verifiedAgainst).toEqual(nextRef);
    expect(entityFile(run2, nodeA).body).toContain("> **狀態**:`deprecated`");
    expect(entityFile(run2, nodeA).body).toContain("packages/core/projection-engine/AGENTS.md");
    expectNoProvenanceInBody(entityFile(run2, nodeA).body);
  });

  test("once a status-flip re-render lands, the honest stamp holds as the new fixed point", () => {
    const run3Ref = { branch: "main", commit: "feedface", committedAt: "2026-08-10T09:30:00+08:00" };
    const reapply = (base: ArchitectureDocumentationProjectionPlan, verifiedAgainst: typeof nextRef) => render({
      model: statusFlippedModel,
      verifiedAgainst,
      // The measurement is keyed to the commit the on-disk document is actually stamped with.
      sourceChangesSinceStamp: [{ nodeId: nodeA, commit: nextRef.commit, status: "unchanged" }],
      existingFiles: [...base.files.map(({ path, body }) => ({ path, body })), base.manifest]
    });

    const run1 = render();
    const run2 = render({
      model: statusFlippedModel,
      verifiedAgainst: nextRef,
      existingFiles: [...run1.files.map(({ path, body }) => ({ path, body })), run1.manifest]
    });
    expect(entityFile(run2, nodeA).verifiedAgainst).toEqual(nextRef);

    // Run 2's output is what sits on disk after `docs apply`; HEAD has moved on again. This is
    // the state a false stamp used to hide in: once the marker's outputDigest matched the new
    // body, the stale stamp read clean. Now every document holds with run 2's stamp — never
    // run 1's. The manifest is the one file still stale: its receipt digests the major-change
    // classification, which settles only after the semantic delta has been consumed by the first
    // post-apply render — a property of the baseline machinery, identical with or without this
    // fix, and orthogonal to stamps.
    const run3 = reapply(run2, run3Ref);
    expect(run3.drift.diffs).toEqual([expect.objectContaining({
      path: "docs/architecture/.projection-manifest.json",
      reasonCode: "projection-manifest-stale"
    })]);
    expect(run3.notices).toEqual([]);
    for (const file of run2.files) {
      expect(run3.files.find((entry) => entry.path === file.path)?.body).toBe(file.body);
    }
    expect(entityFile(run3, nodeA).verifiedAgainst).toEqual(nextRef);
    // `module.no-source` declares no footprint, so nothing can change under it and its original
    // stamp is still the honest one; only nodeA's advanced.
    expect(entityFile(run3, "module.no-source").verifiedAgainst).toEqual(verifiedAgainst);
    expectNoProvenanceInBody(entityFile(run3, nodeA).body);

    // And the settle completes on the next apply: re-projecting run 3's output with identical
    // inputs is fully clean — documents and manifest — still carrying run 2's stamp.
    const run4 = reapply(run3, run3Ref);
    expect(run4.drift.ok).toBe(true);
    expect(run4.drift.diffs).toEqual([]);
    expect(run4.files.map((file) => file.body)).toEqual(run3.files.map((file) => file.body));
    expect(entityFile(run4, nodeA).verifiedAgainst).toEqual(nextRef);
  });
});
