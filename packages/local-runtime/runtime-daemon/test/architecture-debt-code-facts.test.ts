import { afterEach, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { architectureDebtReportIssues } from "@archcontext/contracts";
import type { NativeModel } from "@archcontext/core/projection-engine";
import { evaluateArchitectureDebt } from "@archcontext/core/review-engine";
import { loadCapabilityCodeGraphProjectionInputs, REQUIRED_CODEGRAPH_VERSION, type CodeGraphReadProvider, type CodeGraphSelectorIndex } from "@archcontext/local-runtime/codegraph-adapter";
import { readArchitectureDebtCodeFacts } from "../src/architecture-debt-code-facts";
import { fakeReadProvider } from "../../codegraph-adapter/test/read-provider-fixture";

const roots: string[] = [];
afterEach(() => {
  // CodeGraph.close() leaves Bun's native SQLite finalizers for GC, including on Windows.
  Bun.gc(true);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const model: NativeModel = {
  nodes: [
    { id: "capability.a", kind: "capability", name: "A", source: {
      include: ["src/a.ts"], entrypoints: [{ id: "entrypoint.a", path: "src/a.ts", symbols: [{ name: "entry", sinks: [{ id: "sink.b", path: "src/b.ts", symbol: "sink" }] }] }]
    } },
    { id: "capability.b", kind: "capability", name: "B", source: { include: ["src/b.ts"] } }
  ], relations: []
};

function fixture(options: { missing?: boolean; stale?: boolean; queryFails?: boolean; queryMakesStale?: boolean } = {}) {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-debt-facts-"))); roots.push(base);
  const root = join(base, "repo"); mkdirSync(root);
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "pipe" });
  writeFileSync(join(root, ".gitignore"), ".codegraph/\n");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/a.ts"), 'import { sink } from "./b";\nexport function entry() { return sink(); }\n');
  writeFileSync(join(root, "src/b.ts"), "export function sink() { return 1; }\n");
  const stale = join(base, "stale");
  if (options.stale) writeFileSync(stale, "stale");
  // Readiness and the import population both read the index through the read-only provider
  // (ADR-0058); `stale` is its change test. Nothing starts CodeGraph.
  const readiness = fakeReadProvider(root, () => ({ pending: { added: 0, modified: existsSync(stale) ? 1 : 0, removed: 0 } }));
  const importReads = { count: 0 };
  const provider: CodeGraphReadProvider = {
    ...readiness,
    openReadOnly: (openedRoot) => Object.assign(readiness.openReadOnly(openedRoot), {
      getStats: () => ({ nodesByKind: { import: 1 } }),
      getNodesByKind: (kind: string) => {
        importReads.count++;
        if (options.queryFails) throw new Error("private raw producer error");
        if (options.queryMakesStale) writeFileSync(stale, "stale");
        return kind === "import" ? [{ id: "import:a", kind: "import", name: "./b", filePath: "src/a.ts" }] : [];
      }
    })
  };
  if (options.missing) rmSync(join(root, ".codegraph"), { recursive: true, force: true });
  return { root, provider, opens: readiness.calls, importReads: () => importReads.count };
}

function selectorIndex(): CodeGraphSelectorIndex {
  const nodes = [
    { id: "entry", kind: "function", name: "entry", filePath: "src/a.ts", startLine: 2 },
    { id: "sink", kind: "function", name: "sink", filePath: "src/b.ts", startLine: 1 }
  ] as any[];
  return {
    getNodesByName: name => nodes.filter(node => node.name === name),
    getOutgoingEdges: id => id === "entry" ? [{ source: "entry", target: "sink", kind: "calls", line: 2 } as any] : [],
    getNode: id => nodes.find(node => node.id === id) ?? null,
    getNodesInFile: path => nodes.filter(node => node.filePath === path),
    close: () => undefined
  };
}

test("full debt reads readiness and imports read-only, starts no process and closes the readonly selector", () => {
  const { root, provider, opens, importReads } = fixture();
  const index = selectorIndex();
  const close = spyOn(index, "close");
  try {
    const evidence = readArchitectureDebtCodeFacts(root, model, { provider, selectorIndexFactory: (path, options) => {
      expect(path).toBe(root);
      expect(options).toEqual({ readOnly: true });
      return index;
    } });
    expect(evidence.dependencies).toEqual({ coverage: "complete", coverageReasonCodes: [], items: [
      { reasonCode: "undeclared-dependency", fromCapabilityId: "capability.a", toCapabilityId: "capability.b", importEdgeCount: 1 }
    ] });
    expect(evidence.flows?.selectors[0]?.status).toBe("proven");
    expect(close).toHaveBeenCalledTimes(1);
    // Readiness opened the index read-only twice, around the reads, and the import read once.
    expect(opens).toMatchObject({ open: 3, close: 3 });
    expect(importReads()).toBe(1);
  } finally {
    close.mockRestore();
  }
});

for (const [name, options, reason, expectedImportReads] of [
  ["missing index", { missing: true }, "index-missing", 0],
  ["stale index", { stale: true }, "pending-source-changes", 0],
  ["query refusal", { queryFails: true }, "codegraph-read-failed", 1],
  ["index becomes stale during query", { queryMakesStale: true }, "pending-source-changes", 1]
] as const) test(`${name} is unknown coverage without invented dependency/flow debt`, () => {
  const { root, provider, importReads } = fixture(options);
  const evidence = readArchitectureDebtCodeFacts(root, model, { provider, selectorIndexFactory: () => {
    if (options.missing || options.stale || options.queryFails) throw new Error("selector must not open");
    return selectorIndex();
  } });
  expect(evidence).toEqual({ unavailable: { dependencies: [reason], flows: [reason] } });
  const report = evaluateArchitectureDebt({ scope: { kind: "repository", changedPaths: [], capabilityIds: [] }, ...evidence });
  expect(report.coverage).toBe("unknown");
  expect(report.items).toEqual([]);
  expect(architectureDebtReportIssues(report)).toEqual([]);
  expect(importReads()).toBe(expectedImportReads);
});

test("read-only selector refusal is reported without a writable retry", () => {
  const { root, provider } = fixture();
  let opens = 0;
  const result = readArchitectureDebtCodeFacts(root, model, { provider, selectorIndexFactory: (_path, options) => {
    opens++;
    expect(options.readOnly).toBe(true);
    throw new Error("readonly open refused");
  } });
  expect(opens).toBe(1);
  expect(result.unavailable?.flows).toEqual(["codegraph-read-failed"]);
});

test("source edits during selector reads invalidate otherwise ready facts and still close the index", () => {
  const { root, provider } = fixture();
  const index = selectorIndex();
  const close = spyOn(index, "close");
  try {
    const result = readArchitectureDebtCodeFacts(root, model, { provider, selectorIndexFactory: () => {
      writeFileSync(join(root, "src/b.ts"), "export function sink() { return 2; }\n");
      return index;
    } });
    expect(result.unavailable?.dependencies).toEqual(["worktree-changed-during-read"]);
    expect(close).toHaveBeenCalledTimes(1);
  } finally { close.mockRestore(); }
});

test("default SDK selector opener receives readOnly and leaves database and WAL bytes unchanged", () => {
  const { root } = fixture({ missing: true });
  const { CodeGraph } = createRequire(import.meta.url)("@colbymchenry/codegraph") as typeof import("@colbymchenry/codegraph");
  let holder: ReturnType<typeof CodeGraph.initSync> | undefined = CodeGraph.initSync(root);
  const open = spyOn(CodeGraph, "openSync");
  const durableBytes = () => readdirSync(join(root, ".codegraph")).filter(name => name !== "codegraph.db-shm").sort()
    .map(name => [name, readFileSync(join(root, ".codegraph", name)).toString("base64")]);
  try {
    // The live holder matches daemon/watcher use; SHM lock/read marks are not durable index content.
    const before = durableBytes();
    const evidence = loadCapabilityCodeGraphProjectionInputs(root, model, { readOnly: true, importGraphs: false });
    expect(open).toHaveBeenCalledWith(root, { readOnly: true });
    expect(evidence.selectorEvidence).toHaveLength(1);
    expect(durableBytes()).toEqual(before);
  } finally {
    open.mockRestore();
    holder.close(); holder = undefined;
    Bun.gc(true);
  }
});
