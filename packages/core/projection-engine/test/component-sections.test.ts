import { describe, expect, test } from "bun:test";
import {
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  REPO_HARNESS_PROJECTION_PROFILE,
  architectureDocumentationProjectionProvenance,
  renderArchitectureDocumentationProjection,
  type ArchitectureDocumentationProjectionPlan,
  type CapabilitySourceScaleSignal,
  type NativeModel,
  type NativeNode,
  type NativeRelation
} from "../src/index";

const sourceDigest = `sha256:${"4".repeat(64)}`;
const provenance = architectureDocumentationProjectionProvenance({
  sourceTreeDigest: sourceDigest,
  modelDigest: sourceDigest,
  rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION,
  layoutVersion: ARCHITECTURE_DOCS_LAYOUT_VERSION,
  generatedFrom: { codeGraphPackage: "@colbymchenry/codegraph", codeGraphVersion: "1.6.1" }
});

const capabilityId = "capability.runtime.reconciliation";
const capability: NativeNode = {
  id: capabilityId,
  kind: "capability",
  name: "Global Runtime Reconciliation",
  status: "active",
  summary: "Reconciles the global runtime.",
  extensions: {
    contractFiles: { agents: "src/runtime/AGENTS.md", claude: "src/runtime/CLAUDE.md" }
  }
};
const cliRoot: NativeNode = {
  id: "component.reconciliation.cli-root",
  kind: "component",
  name: "CLI | Root",
  status: "active",
  parent: capabilityId,
  summary: "Composition root.",
  source: {
    include: ["src/runtime/cli/**"],
    entrypoints: [{
      id: "entrypoint.reconciliation.cli",
      path: "src/runtime/cli/main.ts",
      symbols: [{ name: "main", sinks: [{ id: "sink.reconciliation.install", path: "src/runtime/cli/install.ts", symbol: "install" }] }]
    }]
  }
};
const journal: NativeNode = {
  id: "component.reconciliation.journal",
  kind: "component",
  name: "Journal",
  status: "active",
  parent: capabilityId,
  summary: "Event journal."
};
const helper: NativeNode = {
  id: "module.reconciliation.helper",
  kind: "module",
  name: "Helper",
  status: "active",
  parent: capabilityId,
  summary: "Not a component."
};
const other: NativeNode = {
  id: "capability.runtime.operator",
  kind: "capability",
  name: "Operator",
  status: "active",
  summary: "Operator surface.",
  extensions: {
    contractFiles: { agents: "src/operator/AGENTS.md", claude: "src/operator/CLAUDE.md" }
  }
};
const relations: NativeRelation[] = [
  { id: "relation.cli-calls-operator", kind: "calls", source: cliRoot.id, target: other.id, intent: "start, stop; restart #1" },
  { id: "relation.cli-writes-journal", kind: "writes", source: cliRoot.id, target: journal.id, intent: "append reconcile events" },
  { id: "relation.capability-uses-operator", kind: "uses", source: capabilityId, target: other.id, intent: "read operator state" }
];
const model: NativeModel = { nodes: [capability, cliRoot, journal, helper, other], relations };

const scaleSignals: CapabilitySourceScaleSignal[] = [
  { nodeId: cliRoot.id, fileCount: 7, lineCount: 1500, includePatterns: ["src/runtime/cli/**"], excludePatterns: [] }
];

function render(overrides: Partial<Parameters<typeof renderArchitectureDocumentationProjection>[0]> = {}): ArchitectureDocumentationProjectionPlan {
  return renderArchitectureDocumentationProjection({
    model,
    profile: REPO_HARNESS_PROJECTION_PROFILE,
    provenance,
    sourceDigest,
    sourceFootprints: [],
    sourceScaleSignals: scaleSignals,
    importGraphs: [],
    selectorEvidence: [],
    generatedAt: "2026-10-11T00:00:00.000Z",
    ...overrides
  });
}

function body(plan: ArchitectureDocumentationProjectionPlan, nodeId: string): string {
  const file = plan.files.find((entry) => entry.target.type === "entity-summary" && entry.target.scope.id === nodeId);
  if (!file) throw new Error(`entity-summary file missing for ${nodeId}`);
  return file.body;
}

/** The text of one section after its heading line, up to the blank line before the next `##`/`###` heading. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`${heading}\n`);
  if (start < 0) throw new Error(`section missing: ${heading}`);
  const rest = text.slice(start + heading.length + 1);
  const next = rest.search(/^#{2,3} /m);
  return next < 0 ? rest : rest.slice(0, next).replace(/\n$/, "");
}

function entityTargetId(plan: ArchitectureDocumentationProjectionPlan, nodeId: string): string {
  return plan.targets.find((target) => target.type === "entity-summary" && target.scope.id === nodeId)!.targetId;
}

/** The same model with every component turned into a module: no node has components then. */
const modelWithoutComponents: NativeModel = {
  ...model,
  nodes: model.nodes.map((node) => node.kind === "component" ? { ...node, kind: "module" } : node)
};

describe("component sections on a module document (#299)", () => {
  test("§1.5 lists each direct component with id, name, size buckets and entrypoints", () => {
    const table = section(body(render(), capabilityId), "### 1.5 組件結構");
    expect(table).toBe([
      "",
      "| 組件 | 名稱 | 規模量級 | 宣告入口 |",
      "| --- | --- | --- | --- |",
      "| `component.reconciliation.cli-root` | CLI \\| Root | `5–10` 個文件 / `1000–2000` 行 | `entrypoint.reconciliation.cli` |",
      "| `component.reconciliation.journal` | Journal | 未宣告 `source.include` | 未宣告 |",
      ""
    ].join("\n"));
    // Only `component` children are components; a child module is not listed.
    expect(table).not.toContain(helper.id);
  });

  test("§1.2 shows the entrypoints of the components", () => {
    const entrypoints = section(body(render(), capabilityId), "### 1.2 模組職責表");
    expect(entrypoints).toBe([
      "",
      "- 未宣告 `source.entrypoints`,入口清單無法從架構模型推導。",
      "",
      "組件入口:",
      "",
      "| 組件 | 宣告入口 | 錨點 | 職責 |",
      "| --- | --- | --- | --- |",
      "| `component.reconciliation.cli-root` | `entrypoint.reconciliation.cli` | `src/runtime/cli/main.ts#main` | `sink.reconciliation.install` → `src/runtime/cli/install.ts#install` |",
      ""
    ].join("\n"));
  });

  test("§1.4 lists the outbound relations of each component, grouped by component", () => {
    const dependencies = section(body(render(), capabilityId), "### 1.4 依賴邊界");
    expect(dependencies).toBe([
      "",
      "出向關係:",
      "",
      "- `uses` → `capability.runtime.operator` — read operator state",
      "",
      "入向關係:",
      "",
      "- 無。",
      "",
      "組件出向關係:",
      "",
      "- `component.reconciliation.cli-root`:",
      "  - `calls` → `capability.runtime.operator` — start, stop; restart #1",
      "  - `writes` → `component.reconciliation.journal` — append reconcile events",
      "- `component.reconciliation.journal`:",
      "  - 無。",
      ""
    ].join("\n"));
  });

  test("components without entrypoints say so in §1.2", () => {
    const withoutEntrypoints: NativeModel = {
      ...model,
      nodes: model.nodes.map((node) => node.id === cliRoot.id ? { ...node, source: { include: ["src/runtime/cli/**"] } } : node)
    };
    expect(section(body(render({ model: withoutEntrypoints }), capabilityId), "### 1.2 模組職責表"))
      .toContain("組件入口:\n\n- 組件均未宣告 `source.entrypoints`。\n");
  });

  test("a component that declares source.include without a measured scale fails closed", () => {
    expect(() => render({ sourceScaleSignals: [] })).toThrow(`architecture-docs-projection-scale-signal-missing: ${cliRoot.id}`);
  });

  test("a node without components renders no component section, and components do not reach other pages", () => {
    const plain = render({ model: modelWithoutComponents });
    for (const nodeId of [capabilityId, other.id]) {
      expect(body(plain, nodeId)).not.toContain("組件");
      expect(body(plain, nodeId)).not.toContain("### 1.5");
    }
    // The other capability's page is the same with or without components elsewhere in the model.
    expect(body(render(), other.id)).toBe(body(plain, other.id));
  });

  test("a component size bucket that moves restales only the page that prints it", () => {
    const first = render();
    const existingFiles = [...first.files.map(({ path, body: text }) => ({ path, body: text })), first.manifest];
    const moved = render({ existingFiles, sourceScaleSignals: [{ ...scaleSignals[0]!, lineCount: 2500 }] });
    expect(moved.drift.diffs.filter((diff) => diff.reasonCode === "projection-generated-region-stale").map((diff) => diff.targetId))
      .toEqual([entityTargetId(first, capabilityId)]);
    expect(section(body(moved, capabilityId), "### 1.5 組件結構")).toContain("`2000–5000` 行");
    // An unmoved bucket is a fixed point.
    const unmoved = render({ existingFiles, sourceScaleSignals: [{ ...scaleSignals[0]!, lineCount: 1999 }] });
    expect(unmoved.drift.diffs.filter((diff) => diff.reasonCode === "projection-generated-region-stale")).toEqual([]);
  });
});
