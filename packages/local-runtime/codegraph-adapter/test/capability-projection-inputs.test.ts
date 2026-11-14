import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeModel } from "@archcontext/core/projection-engine";
import { digestJson } from "@archcontext/contracts";
import { fakeReadProvider, type FakeReadProvider } from "./read-provider-fixture";
import { ProjectionCodeFactsUnavailableError, RUNTIME_BUILTIN_CALL_NAMES, assertProjectionCodeFactsAvailable, codeGraphIndexAvailable, loadCapabilityCodeGraphProjectionInputs, projectionCodeFactsRequired, type CodeGraphSelectorIndex, type PreparedProjectionCodeFacts } from "../src/index";

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

const IMPORT_NODES = [
  { name: "./render", filePath: "packages/docs/src/main.ts" },
  { name: "../../shared/util", filePath: "packages/docs/src/main.ts" },
  { name: "./helper", filePath: "packages/docs/src/render.ts" },
  { name: "@archcontext/contracts", filePath: "packages/docs/src/render.ts" },
  { name: "./missing-target", filePath: "packages/docs/src/render.ts" },
  { name: "./main", filePath: "packages/other/src/index.ts" }
].map((node) => ({ id: `import:${node.filePath}:${node.name}`, kind: "import", ...node }));

/**
 * An injected read-only provider whose handle answers the import read: `getStats` reports `count`
 * import nodes (the six nodes when omitted) and `getNodesByKind("import")` returns `returned` nodes
 * (the six, then unresolved extras from `main.ts`), or throws `failure`. `revisionMoves` moves the
 * index revision after the open; `writerStartsDuringRead` takes the provider writer lock inside
 * the node read. `importReads` counts the node reads.
 */
function importIndex(
  root: string,
  options: { count?: number; returned?: number; failure?: string; revisionMoves?: boolean; writerStartsDuringRead?: boolean } = {}
): FakeReadProvider & { importReads(): number } {
  const base = fakeReadProvider(root, { revisionMoves: options.revisionMoves ?? false });
  const returned = options.returned ?? IMPORT_NODES.length;
  const extras = Array.from({ length: Math.max(0, returned - IMPORT_NODES.length) }, (_, i) =>
    ({ id: `import:packages/docs/src/main.ts:./extra-${i}`, kind: "import", name: `./extra-${i}`, filePath: "packages/docs/src/main.ts" }));
  const nodes = [...IMPORT_NODES, ...extras].slice(0, returned);
  let reads = 0;
  return {
    ...base,
    calls: base.calls,
    importReads: () => reads,
    openReadOnly: (openedRoot) => Object.assign(base.openReadOnly(openedRoot), {
      getStats: () => ({ nodesByKind: { import: options.count ?? IMPORT_NODES.length } }),
      getNodesByKind: (kind: string) => {
        reads++;
        if (options.failure) throw new Error(options.failure);
        if (options.writerStartsDuringRead) writeFileSync(join(root, ".codegraph", "codegraph.lock"), String(process.pid));
        return kind === "import" ? nodes : [];
      }
    })
  };
}

function seedWorkspace(options: { withIndex: boolean }): { root: string } {
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
  // Footprints are measured over Git-visible files; untracked files count, so no commit is needed.
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  // Tests that commit later must not start detached auto-maintenance that writes into .git while it is copied or listed.
  for (const [key, value] of [["gc.auto", "0"], ["maintenance.auto", "false"]]) execFileSync("git", ["config", key, value!], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  return { root };
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
  test("measures import edges and exact node-v2 selector evidence in one index pass", () => {
    const { root } = seedWorkspace({ withIndex: true });
    const provider = importIndex(root);
    try {
      const inputs = loadCapabilityCodeGraphProjectionInputs(root, model, { provider, selectorIndexFactory: () => selectorIndex({ unrelatedCalls: 50 }) });

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

      // Imports come from one read-only session and one node read; selectors from the structured index.
      expect(provider.calls).toMatchObject({ open: 1, close: 1 });
      expect(provider.importReads()).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("selector proof is stable under unrelated fanout and fails closed for missing or ambiguous identities", () => {
    const { root } = seedWorkspace({ withIndex: true });
    const provider = importIndex(root);
    try {
      const evidence = (index: CodeGraphSelectorIndex) => loadCapabilityCodeGraphProjectionInputs(root, model, {
        provider,
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
    function evidenceFor(sinkName: string, index: CodeGraphSelectorIndex, ignoredFile?: string) {
      const root = mkdtempSync(join(tmpdir(), "archctx-selector-builtin-"));
      try {
        // Import targets resolve against the Git-visible files, so the fixture is a checkout.
        execFileSync("git", ["init", "-q"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
        mkdirSync(join(root, ".codegraph"));
        mkdirSync(join(root, "src"));
        writeFileSync(join(root, "src/util.ts"), `export function ${sinkName}() {}\n`);
        writeFileSync(join(root, "src/main.ts"), "// fixture\n");
        if (ignoredFile) {
          writeFileSync(join(root, ".gitignore"), `.codegraph/\n${ignoredFile}\n`);
          writeFileSync(join(root, ignoredFile), "// generated\n");
        }
        // No footprint is declared, so only the structured selector index is read: no import read.
        const inputs = loadCapabilityCodeGraphProjectionInputs(root, builtinSelectorModel(sinkName), {
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

    test("ignores a gitignored file at an import candidate path (#548)", () => {
      // `./util` tries `src/util` before `src/util.ts`; an ignored file there must not shadow the sink.
      const evidence = evidenceFor("existsSync", builtinSelectorIndex({
        sinkName: "existsSync",
        imports: ["node:fs", "./util"],
        edges: [{ kind: "calls", line: 6 }]
      }), "src/util");
      expect(evidence).toMatchObject({ matched: true, callSites: [{ path: "src/main.ts", line: 6 }] });
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

  const footprintOnly = { nodes: [{ ...model.nodes[0], source: { include: ["packages/docs/**"] } }], relations: [] };

  test("reads the whole import population when the limit equals the import count", () => {
    const { root } = seedWorkspace({ withIndex: true });
    const provider = importIndex(root);
    try {
      const inputs = loadCapabilityCodeGraphProjectionInputs(root, footprintOnly, { provider, importNodeLimit: 6 });
      expect(provider.importReads()).toBe(1);
      expect(inputs.importGraphs[0].truncated).toBe(false);
      expect(inputs.importGraphs[0].importNodeLimitExceeded).toBeUndefined();
      expect(inputs.importGraphs[0].edges).toHaveLength(3);
      expect(inputs.selectorEvidence).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports a read shorter than the index import count as truncated", () => {
    const { root } = seedWorkspace({ withIndex: true });
    try {
      const inputs = loadCapabilityCodeGraphProjectionInputs(root, footprintOnly, { provider: importIndex(root, { count: 8 }) });
      expect(inputs.importGraphs[0].truncated).toBe(true);
      expect(inputs.importGraphs[0].importNodeLimitExceeded).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports a limit below the import count apart from truncation", () => {
    const { root } = seedWorkspace({ withIndex: true });
    try {
      const inputs = loadCapabilityCodeGraphProjectionInputs(root, footprintOnly, { provider: importIndex(root), importNodeLimit: 5 });
      expect(inputs.importGraphs[0].importNodeLimitExceeded).toBe(true);
      expect(inputs.importGraphs[0].truncated).toBe(false);
      expect(inputs.importPopulation).toMatchObject({ importNodeCount: 6, importNodeLimit: 5, importNodeLimitExceeded: true, truncated: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // An index that moves during the read, or a population that disagrees with its count, is
  // truncated in the population and in every graph; the kept prefix never exceeds the limit.
  for (const row of [
    { name: "same-count revision movement", index: { revisionMoves: true }, limit: 100, exceeded: false },
    { name: "a writer starting during the read below the cap", index: { writerStartsDuringRead: true }, limit: 7, exceeded: false },
    { name: "a writer starting during the read at the cap", index: { writerStartsDuringRead: true }, limit: 6, exceeded: false },
    { name: "a writer starting during the read above the cap", index: { writerStartsDuringRead: true }, limit: 5, exceeded: true },
    { name: "count growth across the cap", index: { count: 6, returned: 8 }, limit: 6, exceeded: true },
    { name: "growth while above the cap", index: { count: 7, returned: 8 }, limit: 5, exceeded: true },
    { name: "shrink while above the cap", index: { count: 8, returned: 7 }, limit: 5, exceeded: true }
  ]) test(`marks the import read truncated on ${row.name}`, () => {
    const { root } = seedWorkspace({ withIndex: true });
    try {
      const capabilities = { nodes: [footprintOnly.nodes[0], { ...model.nodes[1], source: { include: ["packages/other/**"] } }], relations: [] };
      const inputs = loadCapabilityCodeGraphProjectionInputs(root, capabilities, { provider: importIndex(root, row.index), importNodeLimit: row.limit });
      const returned = row.index.returned ?? IMPORT_NODES.length;
      expect(inputs.importPopulation).toMatchObject({ truncated: true, importNodeLimit: row.limit, importNodeLimitExceeded: row.exceeded });
      expect(inputs.importPopulation!.pairs).toHaveLength(Math.min(returned, row.limit));
      expect(inputs.importGraphs).toHaveLength(2);
      for (const graph of inputs.importGraphs) {
        expect(graph.truncated).toBe(true);
        expect(graph.importNodeLimitExceeded).toBe(row.exceeded ? true : undefined);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses an import node limit that is not a positive integer", () => {
    const { root } = seedWorkspace({ withIndex: true });
    try {
      expect(() => loadCapabilityCodeGraphProjectionInputs(root, footprintOnly, { provider: importIndex(root), importNodeLimit: 0 }))
        .toThrow("import node limit must be a positive integer, got 0");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns empty measurements when the workspace carries no index", () => {
    const { root } = seedWorkspace({ withIndex: false });
    try {
      expect(codeGraphIndexAvailable(root)).toBe(false);
      expect(loadCapabilityCodeGraphProjectionInputs(root, model)).toEqual({
        importGraphs: [],
        selectorEvidence: []
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("never opens the index for a model that declares no footprint and no entrypoints", () => {
    const { root } = seedWorkspace({ withIndex: true });
    const provider = importIndex(root);
    try {
      const inputs = loadCapabilityCodeGraphProjectionInputs(
        root,
        { nodes: [{ id: "module.undeclared", kind: "module", name: "Undeclared" }], relations: [] },
        { provider }
      );
      expect(inputs).toEqual({ importGraphs: [], selectorEvidence: [] });
      expect(provider.calls.open).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails loudly when the index read errors or the index cannot be opened, instead of returning an empty measurement", () => {
    const { root } = seedWorkspace({ withIndex: true });
    try {
      const failing = importIndex(root, { failure: "index corrupted" });
      expect(() => loadCapabilityCodeGraphProjectionInputs(root, model, { provider: failing })).toThrow("index corrupted");
      // The session is closed even when the read throws.
      expect(failing.calls).toMatchObject({ open: 1, close: 1 });
      // A `.codegraph` without a database is no index the session can open.
      rmSync(join(root, ".codegraph", "codegraph.db"));
      expect(() => loadCapabilityCodeGraphProjectionInputs(root, model, { provider: failing })).toThrow("CodeGraph index could not be read: index-missing");
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
