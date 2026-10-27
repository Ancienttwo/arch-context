import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeModel } from "@archcontext/core/projection-engine";
import { digestJson } from "@archcontext/contracts";
import { ProjectionCodeFactsUnavailableError, RUNTIME_BUILTIN_CALL_NAMES, assertProjectionCodeFactsAvailable, codeGraphIndexAvailable, loadCapabilityCodeGraphProjectionInputs, projectionCodeFactsRequired, withExistingCodeGraphSnapshot, type CodeGraphSelectorIndex, type PreparedProjectionCodeFacts } from "../src/index";

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
  // Footprints are measured over Git-visible files; untracked files count, so no commit is needed.
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
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
    getNodesInFile: (filePath) => [...nodes.values()].filter((node) => node.filePath === filePath),
    close: () => undefined
  };
}

/**
 * A fake index for the #300 proof rules: `src/main.ts#entry` and its edges to symbols in
 * `src/util.ts`. `imports` are the import specifiers of `src/main.ts`.
 */
function builtinSelectorIndex(options: {
  sinkName: string;
  imports: string[];
  edges: Array<{ kind: "calls" | "references"; line: number }>;
  sinkDeclarations?: number;
}): CodeGraphSelectorIndex {
  const nodes = new Map<string, any>([
    ["entry", { id: "entry", kind: "function", name: "entry", filePath: "src/main.ts", startLine: 4 }],
    ...options.imports.map((specifier, index) => [
      `import-${index}`,
      { id: `import-${index}`, kind: "import", name: specifier, filePath: "src/main.ts", startLine: 1 + index }
    ] as const),
    ...Array.from({ length: options.sinkDeclarations ?? 1 }, (_, index) => [
      `sink-${index}`,
      { id: `sink-${index}`, kind: index === 0 ? "function" : "constant", name: options.sinkName, filePath: "src/util.ts", startLine: 1 + 10 * index }
    ] as const)
  ]);
  const edges = options.edges.map((edge) => ({ source: "entry", target: "sink-0", kind: edge.kind, line: edge.line }));
  return {
    getNodesByName: (name) => [...nodes.values()].filter((node) => node.name === name),
    getOutgoingEdges: (nodeId) => edges.filter((edge) => edge.source === nodeId) as any[],
    getNode: (nodeId) => nodes.get(nodeId) ?? null,
    getNodesInFile: (filePath) => [...nodes.values()].filter((node) => node.filePath === filePath),
    close: () => undefined
  };
}

function builtinSelectorModel(sinkName: string): NativeModel {
  return {
    nodes: [{
      id: "capability.builtin",
      kind: "capability",
      name: "Builtin",
      source: {
        entrypoints: [{
          id: "entrypoint.builtin.entry",
          path: "src/main.ts",
          symbols: [{ name: "entry", sinks: [{ id: "sink.builtin.util", path: "src/util.ts", symbol: sinkName }] }]
        }]
      }
    }],
    relations: []
  };
}

// The loader shells out once per index query, so the happy path is measured with a single load
// shared by the import-graph and exact-selector assertions: spawning it per assertion made the
// neighbouring adapter suite time out under parallel test execution.
describe("capability documentation projection inputs from the code index", () => {
  test.each(["unspecified", "unset"])("private snapshots refuse the literal filter driver %s before execution", async (driver) => {
    const { root } = seedWorkspace({ withIndex: false });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    const { CodeGraph } = createRequire(import.meta.url)("@colbymchenry/codegraph") as typeof import("@colbymchenry/codegraph");
    try {
      writeFileSync(join(root, ".gitignore"), ".codegraph/\n");
      git("add", "packages");
      git("-c", "user.name=Snapshot Test", "-c", "user.email=snapshot@example.test", "commit", "-qm", "fixture");
      const graph = CodeGraph.initSync(root);
      try { await graph.indexAll(); } finally { graph.close(); }
      Bun.gc(true);
      const marker = join(root, "filter-executed");
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
      const script = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed"); process.stdin.pipe(process.stdout);`;
      git("config", `filter.${driver}.clean`, `${quote(process.execPath.replaceAll("\\", "/"))} -e ${quote(script)}`);
      writeFileSync(join(root, ".gitattributes"), `*.ts filter=${driver}\n`);
      let failure: unknown;
      try { withExistingCodeGraphSnapshot(root, () => true); } catch (error) { failure = error; }
      expect(existsSync(marker)).toBe(false);
      expect(failure).toMatchObject({ reasonCode: "code-facts-snapshot-layout-unsupported" });
    } finally { Bun.gc(true); rmSync(root, { recursive: true, force: true }); }
  }, 60_000);

  test("private snapshots allow inert filter configuration and reject effective filters", async () => {
    const { root } = seedWorkspace({ withIndex: false });
    writeFileSync(join(root, ".gitignore"), ".codegraph/\n");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    const { CodeGraph } = createRequire(import.meta.url)("@colbymchenry/codegraph") as typeof import("@colbymchenry/codegraph");
    try {
      writeFileSync(join(root, "notes.txt"), "not a CodeGraph source\n");
      git("add", "packages", "notes.txt");
      git("-c", "user.name=Snapshot Test", "-c", "user.email=snapshot@example.test", "commit", "-qm", "fixture");
      git("config", "filter.lfs.clean", "git-lfs clean -- %f");
      git("config", "filter.lfs.process", "git-lfs filter-process");
      git("config", "diff.external.command", "exit 99");
      const graph = CodeGraph.initSync(root);
      try { await graph.indexAll(); } finally { graph.close(); }
      Bun.gc(true);
      const indexBefore = readFileSync(join(root, ".git/index"));
      expect(withExistingCodeGraphSnapshot(root, snapshot => snapshot.getNodesByName("MAIN_VERSION").length)).toBe(1);
      expect(readFileSync(join(root, ".git/index"))).toEqual(indexBefore);
      for (const pattern of ["*.ts", "notes.txt"]) {
        writeFileSync(join(root, ".gitattributes"), `${pattern} filter=lfs\n`);
        expect(() => withExistingCodeGraphSnapshot(root, () => true)).toThrow("safely isolated");
      }
      expect(readFileSync(join(root, ".git/index"))).toEqual(indexBefore);
    } finally { Bun.gc(true); rmSync(root, { recursive: true, force: true }); }
  }, 60_000);

  for (const liveWal of [false, true]) test(`private snapshot reads real facts without changing original SQLite sidecars (live WAL: ${liveWal})`, async () => {
    const { root } = seedWorkspace({ withIndex: false });
    writeFileSync(join(root, ".gitignore"), ".codegraph/\nnode_modules/\n");
    mkdirSync(join(root, "node_modules"));
    symlinkSync(join(root, "packages/docs"), join(root, "node_modules/docs"), process.platform === "win32" ? "junction" : "dir");
    const { CodeGraph } = createRequire(import.meta.url)("@colbymchenry/codegraph") as typeof import("@colbymchenry/codegraph");
    let holder: ReturnType<typeof CodeGraph.initSync> | undefined = CodeGraph.initSync(root);
    const indexState = () => readdirSync(join(root, ".codegraph")).sort().map(name => {
      const path = join(root, ".codegraph", name);
      return [name, statSync(path).mtimeMs, readFileSync(path).toString("base64")];
    });
    try {
      await holder.indexAll();
      if (!liveWal) { holder.close(); holder = undefined; Bun.gc(true); }
      const before = indexState();
      const names = withExistingCodeGraphSnapshot(root, graph => {
        expect(graph.getProjectRoot()).not.toBe(root);
        return graph.getNodesByName("MAIN_VERSION").map(node => node.name);
      });
      expect(names).toContain("MAIN_VERSION");
      expect(indexState()).toEqual(before);
      expect(() => withExistingCodeGraphSnapshot(root, () => {
        writeFileSync(join(root, "packages/docs/src/main.ts"), "export const MAIN_VERSION = 2;\n");
      })).toThrow();
      expect(indexState()).toEqual(before);
    } finally {
      holder?.close();
      Bun.gc(true);
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  test("private source mirror preserves provider includeIgnored, include and extension overrides", async () => {
    const { root } = seedWorkspace({ withIndex: false });
    writeFileSync(join(root, ".gitignore"), ".codegraph/\nexternal-projects/\nprivate-src/\n");
    mkdirSync(join(root, "external-projects/embedded"), { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: join(root, "external-projects/embedded"), stdio: "pipe" });
    writeFileSync(join(root, "external-projects/embedded/library.ts"), "export function optedInLibrary() { return 1; }\n");
    mkdirSync(join(root, "private-src"));
    writeFileSync(join(root, "private-src/source.fixture"), "export function customExtension() { return 1; }\n");
    writeFileSync(join(root, "codegraph.json"), JSON.stringify({
      includeIgnored: ["external-projects/"], include: ["private-src/**"], extensions: { ".fixture": "typescript" }
    }));
    const { CodeGraph } = createRequire(import.meta.url)("@colbymchenry/codegraph") as typeof import("@colbymchenry/codegraph");
    try {
      const graph = CodeGraph.initSync(root);
      try {
        await graph.indexAll();
        expect(graph.getNodesByName("optedInLibrary").length).toBe(1);
        expect(graph.getNodesByName("customExtension").length).toBe(1);
      } finally { graph.close(); }
      Bun.gc(true);
      expect(withExistingCodeGraphSnapshot(root, snapshot => [
        snapshot.getNodesByName("optedInLibrary").length,
        snapshot.getNodesByName("customExtension").length
      ])).toEqual([1, 1]);
      writeFileSync(join(root, "external-projects/embedded/new.ts"), "export const newIgnoredSource = 1;\n");
      expect(() => withExistingCodeGraphSnapshot(root, () => true)).toThrow();
      const embedded = join(root, "external-projects/embedded");
      execFileSync("git", ["add", "library.ts"], { cwd: embedded, stdio: "pipe" });
      execFileSync("git", ["config", "filter.selected.clean", "exit 99"], { cwd: embedded, stdio: "pipe" });
      writeFileSync(join(embedded, ".gitattributes"), "*.ts filter=selected\n");
      expect(() => withExistingCodeGraphSnapshot(root, () => true)).toThrow("safely isolated");
    } finally {
      Bun.gc(true);
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

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

  describe("selector proof rules for false built-in edges, references and duplicate symbols (#300)", () => {
    function evidenceFor(sinkName: string, index: CodeGraphSelectorIndex) {
      const root = mkdtempSync(join(tmpdir(), "archctx-selector-builtin-"));
      try {
        mkdirSync(join(root, ".codegraph"));
        mkdirSync(join(root, "src"));
        writeFileSync(join(root, "src/util.ts"), `export function ${sinkName}() {}\n`);
        writeFileSync(join(root, "src/main.ts"), "// fixture\n");
        // No footprint is declared, so only the structured selector index is read: no CLI call.
        const inputs = loadCapabilityCodeGraphProjectionInputs(root, builtinSelectorModel(sinkName), {
          binary: join(root, "does-not-exist.js"),
          selectorIndexFactory: () => index
        });
        expect(inputs.selectorEvidence).toHaveLength(1);
        return inputs.selectorEvidence[0]!;
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }

    test("rejects a call to a runtime built-in name when the source file does not import the sink file", () => {
      expect(RUNTIME_BUILTIN_CALL_NAMES.has("resolve")).toBe(true);
      const evidence = evidenceFor("resolve", builtinSelectorIndex({
        sinkName: "resolve",
        imports: ["node:path"],
        edges: [{ kind: "calls", line: 5 }]
      }));
      expect(evidence).toMatchObject({ matched: false, ambiguous: false, truncated: false, callSites: [] });
      expect(evidence.rejectedBuiltinCallSites).toEqual([{ path: "src/main.ts", line: 5 }]);
      expect(evidence.referenceSites).toBeUndefined();
    });

    test("accepts the same built-in-named call when the source file imports the sink file", () => {
      for (const specifier of ["./util", "./util.js"]) {
        const evidence = evidenceFor("existsSync", builtinSelectorIndex({
          sinkName: "existsSync",
          imports: ["node:fs", specifier],
          edges: [{ kind: "calls", line: 6 }]
        }));
        expect(evidence, specifier).toEqual({
          nodeId: "capability.builtin",
          entrypointId: "entrypoint.builtin.entry",
          sourcePath: "src/main.ts",
          sourceSymbol: "entry",
          sinkId: "sink.builtin.util",
          sinkPath: "src/util.ts",
          sinkSymbol: "existsSync",
          matched: true,
          ambiguous: false,
          truncated: false,
          callSites: [{ path: "src/main.ts", line: 6 }]
        });
      }
    });

    test("keeps a call to a name that is not a runtime built-in without an import check", () => {
      expect(RUNTIME_BUILTIN_CALL_NAMES.has("renderBlock")).toBe(false);
      const evidence = evidenceFor("renderBlock", builtinSelectorIndex({
        sinkName: "renderBlock",
        imports: [],
        edges: [{ kind: "calls", line: 7 }]
      }));
      expect(evidence).toMatchObject({ matched: true, callSites: [{ path: "src/main.ts", line: 7 }] });
      expect(evidence.rejectedBuiltinCallSites).toBeUndefined();
    });

    test("reports a references-only edge as reference sites that do not prove the selector", () => {
      const evidence = evidenceFor("collectOffers", builtinSelectorIndex({
        sinkName: "collectOffers",
        imports: ["./util"],
        edges: [{ kind: "references", line: 8 }]
      }));
      expect(evidence).toMatchObject({ matched: false, ambiguous: false, callSites: [] });
      expect(evidence.referenceSites).toEqual([{ path: "src/main.ts", line: 8 }]);
    });

    test("marks a sink declared twice in its file as ambiguous even when one declaration is called", () => {
      const evidence = evidenceFor("readBinding", builtinSelectorIndex({
        sinkName: "readBinding",
        imports: ["./util"],
        edges: [{ kind: "calls", line: 9 }],
        sinkDeclarations: 2
      }));
      expect(evidence).toMatchObject({ matched: false, ambiguous: true });
    });
  });

  // The fake index always replies with its 6 import nodes, whatever `-l` asks for.
  const footprintOnly = { nodes: [{ ...model.nodes[0], source: { include: ["packages/docs/**"] } }], relations: [] };
  const importQueryLimits = (log: string) => readFileSync(log, "utf8").trim().split("\n")
    .map((line) => JSON.parse(line) as string[])
    .filter((argv) => argv[0] === "query")
    .map((argv) => argv[argv.indexOf("-l") + 1]);

  test("reads the whole import population when the limit equals the import count", () => {
    const { root, binary, log } = seedWorkspace({ withIndex: true });
    try {
      const inputs = loadCapabilityCodeGraphProjectionInputs(root, footprintOnly, { binary, importNodeLimit: 6, importNodeCount: 6 });
      expect(importQueryLimits(log)).toEqual(["7"]);
      expect(inputs.importGraphs[0].truncated).toBe(false);
      expect(inputs.importGraphs[0].importNodeLimitExceeded).toBeUndefined();
      expect(inputs.importGraphs[0].edges).toHaveLength(3);
      expect(inputs.selectorEvidence).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports a reply shorter than the index import count as truncated", () => {
    const { root, binary, log } = seedWorkspace({ withIndex: true });
    try {
      const inputs = loadCapabilityCodeGraphProjectionInputs(root, footprintOnly, { binary, importNodeCount: 8 });
      expect(importQueryLimits(log)).toEqual(["9"]);
      expect(inputs.importGraphs[0].truncated).toBe(true);
      expect(inputs.importGraphs[0].importNodeLimitExceeded).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports a limit below the import count apart from truncation", () => {
    for (const importNodeCount of [6, null]) {
      const { root, binary, log } = seedWorkspace({ withIndex: true });
      try {
        const inputs = loadCapabilityCodeGraphProjectionInputs(root, footprintOnly, { binary, importNodeLimit: 5, importNodeCount });
        expect(importQueryLimits(log)).toEqual(["6"]);
        expect(inputs.importGraphs[0].importNodeLimitExceeded).toBe(true);
        expect(inputs.importGraphs[0].truncated).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test("refuses an import node limit that is not a positive integer", () => {
    const { root, binary } = seedWorkspace({ withIndex: true });
    try {
      expect(() => loadCapabilityCodeGraphProjectionInputs(root, footprintOnly, { binary, importNodeLimit: 0 }))
        .toThrow("import node limit must be a positive integer, got 0");
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

});

describe("required projection code facts", () => {
  function workspaceWithManifest(manifest: string | undefined): string {
    const root = mkdtempSync(join(tmpdir(), "archctx-code-facts-required-"));
    if (manifest !== undefined) {
      mkdirSync(join(root, ".archcontext"), { recursive: true });
      writeFileSync(join(root, ".archcontext/manifest.yaml"), manifest, "utf8");
    }
    return root;
  }

  function prepared(availability: "ready" | "unavailable"): PreparedProjectionCodeFacts {
    return {
      importGraphs: [],
      selectorEvidence: [],
      handshake: {
        availability,
        ...(availability === "unavailable" ? { reasonCode: "index-missing" as const } : {})
      }
    } as unknown as PreparedProjectionCodeFacts;
  }

  test("only an explicit codeFacts.required: true requires code facts", () => {
    const cases: Array<[string | undefined, boolean]> = [
      ["codeFacts:\n  mode: \"embedded\"\n  provider: \"codegraph\"\n  required: true\n", true],
      ["codeFacts:\n  provider: \"codegraph\"\n  required: false\n", false],
      ["codeFacts:\n  provider: \"codegraph\"\n", false],
      ["product:\n  id: \"product.x\"\n", false],
      [undefined, false]
    ];
    for (const [manifest, required] of cases) {
      const root = workspaceWithManifest(manifest);
      try {
        expect(projectionCodeFactsRequired(root), String(manifest)).toBe(required);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test("an unavailable index fails a projection that requires code facts with a typed error", () => {
    const required = workspaceWithManifest("codeFacts:\n  required: true\n");
    const optional = workspaceWithManifest("codeFacts:\n  required: false\n");
    try {
      let thrown: unknown;
      try {
        assertProjectionCodeFactsAvailable(required, prepared("unavailable"));
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ProjectionCodeFactsUnavailableError);
      expect((thrown as ProjectionCodeFactsUnavailableError).code).toBe("AC_CODE_FACTS_UNAVAILABLE");
      expect((thrown as ProjectionCodeFactsUnavailableError).reasonCode).toBe("index-missing");
      expect(() => assertProjectionCodeFactsAvailable(required, prepared("ready"))).not.toThrow();
      expect(() => assertProjectionCodeFactsAvailable(optional, prepared("unavailable"))).not.toThrow();
    } finally {
      rmSync(required, { recursive: true, force: true });
      rmSync(optional, { recursive: true, force: true });
    }
  });
});
