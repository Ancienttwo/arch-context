import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeModel } from "@archcontext/core/projection-engine";
import {
  CODEGRAPH_ENTRYPOINT_CALL_BUDGET,
  CODEGRAPH_ENTRYPOINT_SEED_BUDGET,
  codeGraphIndexAvailable,
  loadCapabilityCodeGraphProjectionInputs
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
        entrypoints: ["packages/docs/src/main.ts"]
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

// The loader shells out once per index query, so the happy path is measured with a single load
// shared by the import-graph and call-graph assertions: spawning it per assertion made the
// neighbouring adapter suite time out under parallel test execution.
describe("capability documentation projection inputs from the code index", () => {
  test("measures import edges and entrypoint call trails in one index pass", () => {
    const { root, binary, log } = seedWorkspace({ withIndex: true });
    try {
      const inputs = loadCapabilityCodeGraphProjectionInputs(root, model, { binary });

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

      expect(inputs.entrypointCallGraphs).toEqual([
        {
          nodeId: "capability.docs",
          entrypoints: [
            {
              path: "packages/docs/src/main.ts",
              seedsTruncated: false,
              seeds: [
                {
                  symbol: "renderMain",
                  line: 9,
                  calls: [
                    { symbol: "renderBlock", path: "packages/docs/src/render.ts", line: 12 },
                    { symbol: "digestJson", path: "packages/shared/util.ts", line: 88 }
                  ],
                  callsTruncated: true
                },
                { symbol: "run", line: 24, calls: [{ symbol: "renderMain", path: "packages/docs/src/main.ts", line: 9 }], callsTruncated: false },
                { symbol: "helperLocal", line: 40, calls: [], callsTruncated: false }
              ]
            }
          ]
        }
      ]);

      // One import dump, one symbol map, one trail per seed — constants and classes are not
      // seeded, so the loader stays inside its documented budget.
      const invocations = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
      expect(invocations).toHaveLength(5);
      expect(invocations[0].slice(0, 2)).toEqual(["query", "-p"]);
      expect(invocations[1]).toContain("--symbols-only");
      expect(invocations.slice(2).map((argv) => argv[3])).toEqual(["renderMain", "run", "helperLocal"]);
      expect(CODEGRAPH_ENTRYPOINT_SEED_BUDGET).toBe(5);
      expect(CODEGRAPH_ENTRYPOINT_CALL_BUDGET).toBe(8);
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
      expect(inputs.entrypointCallGraphs).toEqual([]);
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
        entrypointCallGraphs: []
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
      expect(inputs).toEqual({ importGraphs: [], entrypointCallGraphs: [] });
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
});
