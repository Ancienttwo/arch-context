import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeModel } from "@archcontext/core/projection-engine";
import { digestJson } from "@archcontext/contracts";
import {
  CODEGRAPH_TELEMETRY_DISABLED_VALUE,
  CODEGRAPH_TELEMETRY_ENV,
  codeGraphCliInvocation,
  codeGraphIndexAvailable,
  loadCapabilityCodeGraphProjectionInputs,
  type CodeGraphSelectorIndex
} from "../src/index";

const model: NativeModel = {
  nodes: [
    {
      id: "capability.docs",
      kind: "capability",
      name: "Docs",
      source: {
        include: ["packages/docs/**"],
        exclude: ["packages/docs/test/**"],
        entrypoints: [{
          id: "entrypoint.docs.render",
          path: "packages/docs/src/main.ts",
          symbols: [{
            name: "renderMain",
            sinks: [{ id: "sink.docs.render-block", path: "packages/docs/src/render.ts", symbol: "renderBlock" }]
          }]
        }]
      }
    },
    { id: "module.undeclared", kind: "module", name: "Undeclared" }
  ],
  relations: []
};

/**
 * Fake CodeGraph CLI. Answers exactly the three shapes the capability projection loader asks for
 * and fails loudly on anything else, so an unexpected query surfaces as a test failure rather
 * than as a silently empty measurement.
 */
function fakeCli(logPath: string): string {
  return `
import { appendFileSync } from "node:fs";
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(argv) + "\\n");
const importNodes = [
  { name: "./render", filePath: "packages/docs/src/main.ts" },
  { name: "../../shared/util", filePath: "packages/docs/src/main.ts" },
  { name: "./helper", filePath: "packages/docs/src/render.ts" },
  { name: "@archcontext/contracts", filePath: "packages/docs/src/render.ts" },
  { name: "./missing-target", filePath: "packages/docs/src/render.ts" },
  { name: "./main", filePath: "packages/other/src/index.ts" }
];
if (argv[0] === "query") {
  process.stdout.write(JSON.stringify(importNodes.map((node) => ({
    node: { id: "import:" + node.filePath + ":" + node.name, kind: "import", name: node.name, filePath: node.filePath }
  }))));
} else if (argv.includes("--symbols-only")) {
  process.stdout.write([
    "**packages/docs/src/main.ts** — 5 symbols",
    "",
    "**Symbols**",
    "- \\\`MAIN_VERSION\\\` (constant) = \\"1\\" — :3",
    "- \\\`renderMain\\\` (function) (input: string): string — :9",
    "- \\\`DocsRunner\\\` (class) — :20",
    "- \\\`run\\\` (method) (): void — :24",
    "- \\\`helperLocal\\\` (function) (): void — :40",
    ""
  ].join("\\n"));
} else if (argv[0] === "node") {
  const symbol = argv[3];
  const trail = {
    renderMain: "**Calls →** renderBlock (packages/docs/src/render.ts:12), digestJson (packages/shared/util.ts:88), +3 more",
    run: "**Calls →** renderMain (packages/docs/src/main.ts:9)",
    helperLocal: ""
  }[symbol] ?? "";
  process.stdout.write(["**" + symbol + "** (function)", "", trail, ""].join("\\n"));
} else {
  process.stderr.write("unexpected codegraph invocation: " + JSON.stringify(argv));
  process.exit(1);
}
`;
}

function seedWorkspace(options: { withIndex: boolean }): { root: string; log: string; binary: string } {
  const root = mkdtempSync(join(tmpdir(), "archctx-capability-codegraph-"));
  if (options.withIndex) mkdirSync(join(root, ".codegraph"));
  mkdirSync(join(root, "packages/docs/src"), { recursive: true });
  mkdirSync(join(root, "packages/docs/test"), { recursive: true });
  mkdirSync(join(root, "packages/shared"), { recursive: true });
  mkdirSync(join(root, "packages/other/src"), { recursive: true });
  writeFileSync(join(root, "packages/docs/src/main.ts"), "export const MAIN_VERSION = \"1\";\n");
  writeFileSync(join(root, "packages/docs/src/render.ts"), "export function renderBlock() {}\n");
  writeFileSync(join(root, "packages/docs/src/helper.ts"), "export function helper() {}\n");
  writeFileSync(join(root, "packages/docs/test/main.test.ts"), "// excluded\n");
  writeFileSync(join(root, "packages/shared/util.ts"), "export const util = 1;\n");
  writeFileSync(join(root, "packages/other/src/index.ts"), "// outside the footprint\n");
  writeFileSync(join(root, "packages/other/src/main.ts"), "// resolvable, but outside the footprint\n");
  const log = join(root, "invocations.log");
  writeFileSync(log, "");
  const binary = join(root, "fake-codegraph.js");
  writeFileSync(binary, fakeCli(log));
  return { root, log, binary };
}

function selectorIndex(options: { exactTargets?: number; unrelatedCalls?: number } = {}): CodeGraphSelectorIndex {
  const exactTargets = options.exactTargets ?? 1;
  const nodes = new Map<string, any>([
    ["source", { id: "source", name: "renderMain", filePath: "packages/docs/src/main.ts", startLine: 9 }],
    ...Array.from({ length: exactTargets }, (_, index) => [
      `sink-${index}`,
      { id: `sink-${index}`, name: "renderBlock", filePath: "packages/docs/src/render.ts", startLine: 1 + index }
    ] as const),
    ...Array.from({ length: options.unrelatedCalls ?? 0 }, (_, index) => [
      `unrelated-${index}`,
      { id: `unrelated-${index}`, name: `unrelated${index}`, filePath: "packages/shared/util.ts", startLine: 100 + index }
    ] as const)
  ]);
  const edges = [
    ...Array.from({ length: exactTargets }, (_, index) => ({ source: "source", target: `sink-${index}`, kind: "calls", line: 12 + index })),
    ...Array.from({ length: options.unrelatedCalls ?? 0 }, (_, index) => ({ source: "source", target: `unrelated-${index}`, kind: "calls", line: 100 + index }))
  ] as any[];
  return {
    getNodesByName: (name) => [...nodes.values()].filter((node) => node.name === name),
    getOutgoingEdges: (nodeId) => edges.filter((edge) => edge.source === nodeId),
    getNode: (nodeId) => nodes.get(nodeId) ?? null,
    close: () => undefined
  };
}

// The loader shells out once per index query, so the happy path is measured with a single load
// shared by the import-graph and exact-selector assertions: spawning it per assertion made the
// neighbouring adapter suite time out under parallel test execution.
describe("capability documentation projection inputs from the code index", () => {
  test("measures import edges and exact node-v2 selector evidence in one index pass", () => {
    const { root, binary, log } = seedWorkspace({ withIndex: true });
    try {
      const inputs = loadCapabilityCodeGraphProjectionInputs(root, model, { binary, selectorIndexFactory: () => selectorIndex({ unrelatedCalls: 50 }) });

      expect(inputs.importGraphs).toHaveLength(1);
      const graph = inputs.importGraphs[0];
      expect(graph.nodeId).toBe("capability.docs");
      // `source.exclude` removes the test file; nothing outside `source.include` is measured.
      expect(graph.files).toEqual([
        "packages/docs/src/helper.ts",
        "packages/docs/src/main.ts",
        "packages/docs/src/render.ts"
      ]);
      // Only specifiers that resolve to an existing file become edges: the bare package
      // specifier and the dangling relative specifier produce none, and the import that
      // originates outside the footprint is not attributed to this capability.
      expect(graph.edges).toEqual([
        { from: "packages/docs/src/main.ts", to: "packages/docs/src/render.ts" },
        { from: "packages/docs/src/main.ts", to: "packages/shared/util.ts" },
        { from: "packages/docs/src/render.ts", to: "packages/docs/src/helper.ts" }
      ]);
      expect(graph.truncated).toBe(false);

      expect(inputs.selectorEvidence).toEqual([
        {
          nodeId: "capability.docs",
          entrypointId: "entrypoint.docs.render",
          sourcePath: "packages/docs/src/main.ts",
          sourceSymbol: "renderMain",
          sinkId: "sink.docs.render-block",
          sinkPath: "packages/docs/src/render.ts",
          sinkSymbol: "renderBlock",
          matched: true,
          ambiguous: false,
          truncated: false,
          // A call site is source-file semantics: the fake's source file, sink file, source
          // definition line (9), sink definition line (1) and call-edge line (12) are all
          // distinct, so this pins the emitted pair to the source path plus the edge line.
          callSites: [{ path: "packages/docs/src/main.ts", line: 12 }]
        }
      ]);

      // Import diagnostics still use the CLI. Exact selectors use the uncapped structured SDK.
      const invocations = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
      expect(invocations).toHaveLength(1);
      expect(invocations[0].slice(0, 2)).toEqual(["query", "-p"]);
      expect(invocations.flat()).not.toContain("--symbols-only");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("selector proof is stable under unrelated fanout and fails closed for missing or ambiguous identities", () => {
    const { root, binary } = seedWorkspace({ withIndex: true });
    try {
      const evidence = (index: CodeGraphSelectorIndex) => loadCapabilityCodeGraphProjectionInputs(root, model, {
        binary,
        selectorIndexFactory: () => index
      }).selectorEvidence[0];
      const unique = evidence(selectorIndex({ unrelatedCalls: 5 }));
      const saturated = evidence(selectorIndex({ unrelatedCalls: 500 }));
      expect(unique).toEqual(saturated);
      expect(digestJson(unique as any)).toBe(digestJson(saturated as any));
      expect(unique).toMatchObject({ matched: true, ambiguous: false, truncated: false });

      expect(evidence(selectorIndex({ exactTargets: 0, unrelatedCalls: 500 })))
        .toMatchObject({ matched: false, ambiguous: false, truncated: false, callSites: [] });
      expect(evidence(selectorIndex({ exactTargets: 2, unrelatedCalls: 500 })))
        .toMatchObject({ matched: false, ambiguous: true, truncated: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports a saturated index dump as truncated instead of as a complete edge set", () => {
    const { root, binary } = seedWorkspace({ withIndex: true });
    const footprintOnly = { nodes: [{ ...model.nodes[0], source: { include: ["packages/docs/**"] } }], relations: [] };
    try {
      const inputs = loadCapabilityCodeGraphProjectionInputs(root, footprintOnly, { binary, importNodeLimit: 6 });
      expect(inputs.importGraphs[0].truncated).toBe(true);
      expect(inputs.selectorEvidence).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns empty measurements when the workspace carries no index", () => {
    const { root, binary } = seedWorkspace({ withIndex: false });
    try {
      expect(codeGraphIndexAvailable(root)).toBe(false);
      expect(loadCapabilityCodeGraphProjectionInputs(root, model, { binary })).toEqual({
        importGraphs: [],
        selectorEvidence: []
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("never shells out for a model that declares no footprint and no entrypoints", () => {
    const { root, log } = seedWorkspace({ withIndex: true });
    try {
      const inputs = loadCapabilityCodeGraphProjectionInputs(
        root,
        { nodes: [{ id: "module.undeclared", kind: "module", name: "Undeclared" }], relations: [] },
        { binary: join(root, "does-not-exist.js") }
      );
      expect(inputs).toEqual({ importGraphs: [], selectorEvidence: [] });
      expect(statSync(log).size).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails loudly when the index CLI errors instead of returning an empty measurement", () => {
    const { root } = seedWorkspace({ withIndex: true });
    const broken = join(root, "broken-codegraph.js");
    writeFileSync(broken, "process.stderr.write('index corrupted'); process.exit(2);\n");
    try {
      expect(() => loadCapabilityCodeGraphProjectionInputs(root, model, { binary: broken }))
        .toThrow("CodeGraph CLI failed: index corrupted");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Every other case injects `selectorIndexFactory`, so the production selector path
  // (`CodeGraph.openSync`) would never execute. This case indexes a real fixture repo with the
  // pinned CodeGraph package and runs the loader with no factory at all: the model declares
  // entrypoints and no `source.include`, so no import graph is requested and the only CodeGraph
  // work is the structured selector lookup under test.
  test("proves an exact selector against a really indexed repository with no injected index", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-capability-codegraph-real-"));
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/render.ts"), [
        "export function renderBlock(): string {",
        "  return \"block\";",
        "}",
        ""
      ].join("\n"));
      // The call lives on line 4 of the source file, while `renderMain` is defined on line 3 and
      // `renderBlock` on line 1 of the other file: source path, sink path, source definition
      // line, sink definition line and call-edge line are all distinct, so the asserted call site
      // can only be produced by pairing the source path with the call-edge line.
      writeFileSync(join(root, "src/main.ts"), [
        "import { renderBlock } from \"./render\";",
        "",
        "export function renderMain(): string {",
        "  return renderBlock();",
        "}",
        ""
      ].join("\n"));

      const invocation = codeGraphCliInvocation("codegraph", root);
      const indexed = spawnSync(invocation.command, [...invocation.argsPrefix, "init", root], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, [CODEGRAPH_TELEMETRY_ENV]: CODEGRAPH_TELEMETRY_DISABLED_VALUE },
        stdio: ["ignore", "pipe", "pipe"]
      });
      expect({ status: indexed.status, stderr: indexed.stderr }).toEqual({ status: 0, stderr: "" });
      expect(codeGraphIndexAvailable(root)).toBe(true);

      const realModel: NativeModel = {
        nodes: [{
          id: "capability.real",
          kind: "capability",
          name: "Real",
          source: {
            entrypoints: [{
              id: "entrypoint.real.render",
              path: "src/main.ts",
              symbols: [{
                name: "renderMain",
                sinks: [{ id: "sink.real.render-block", path: "src/render.ts", symbol: "renderBlock" }]
              }]
            }]
          }
        }],
        relations: []
      };

      expect(loadCapabilityCodeGraphProjectionInputs(root, realModel)).toEqual({
        importGraphs: [],
        selectorEvidence: [{
          nodeId: "capability.real",
          entrypointId: "entrypoint.real.render",
          sourcePath: "src/main.ts",
          sourceSymbol: "renderMain",
          sinkId: "sink.real.render-block",
          sinkPath: "src/render.ts",
          sinkSymbol: "renderBlock",
          matched: true,
          ambiguous: false,
          truncated: false,
          callSites: [{ path: "src/main.ts", line: 4 }]
        }]
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
