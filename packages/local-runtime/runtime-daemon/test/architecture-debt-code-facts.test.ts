import { afterEach, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { architectureDebtReportIssues } from "@archcontext/contracts";
import type { NativeModel } from "@archcontext/core/projection-engine";
import { evaluateArchitectureDebt } from "@archcontext/core/review-engine";
import { loadCapabilityCodeGraphProjectionInputs, REQUIRED_CODEGRAPH_VERSION, type CodeGraphSelectorIndex } from "@archcontext/local-runtime/codegraph-adapter";
import { readArchitectureDebtCodeFacts } from "../src/architecture-debt-code-facts";

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
  if (!options.missing) mkdirSync(join(root, ".codegraph"));
  const log = join(base, "calls.log");
  const stale = join(base, "stale");
  if (options.stale) writeFileSync(stale, "stale");
  const binary = join(base, "codegraph.cjs");
  writeFileSync(binary, `
const { appendFileSync, existsSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, args[0] + "=" + process.env.CODEGRAPH_NO_DOWNLOAD + "\\n");
if (process.env.CODEGRAPH_NO_DOWNLOAD !== "1") throw new Error("download guard missing");
if (args[0] === "--version") { console.log(${JSON.stringify(REQUIRED_CODEGRAPH_VERSION)}); process.exit(0); }
if (args[0] === "status") {
  console.log(JSON.stringify({ initialized: true, version: ${JSON.stringify(REQUIRED_CODEGRAPH_VERSION)}, projectPath: ${JSON.stringify(root)},
    worktreeMismatch: null, pendingChanges: { added: 0, modified: existsSync(${JSON.stringify(stale)}) ? 1 : 0, removed: 0 },
    index: { builtWithVersion: ${JSON.stringify(REQUIRED_CODEGRAPH_VERSION)}, builtWithExtractionVersion: 7,
      currentExtractionVersion: 7, reindexRecommended: false, state: "complete", pendingRefs: 0 } })); process.exit(0);
}
if (args[0] === "query") {
  if (${Boolean(options.queryFails)}) throw new Error("private raw producer error");
  if (${Boolean(options.queryMakesStale)}) writeFileSync(${JSON.stringify(stale)}, "stale");
  console.log(JSON.stringify([{ node: { id: "import:a", kind: "import", name: "./b", filePath: "src/a.ts" } }])); process.exit(0);
}
throw new Error("unexpected command " + args[0]);
`);
  return { root, binary, calls: () => readFileSync(log, "utf8") };
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

test("full debt reads S2 readiness, guards every shim spawn and closes the readonly selector", () => {
  const { root, binary, calls } = fixture();
  const index = selectorIndex();
  const close = spyOn(index, "close");
  const old = process.env.CODEGRAPH_NO_DOWNLOAD;
  process.env.CODEGRAPH_NO_DOWNLOAD = "0";
  try {
    const evidence = readArchitectureDebtCodeFacts(root, model, { binary, selectorIndexFactory: (path, options) => {
      expect(path).toBe(root);
      expect(options).toEqual({ readOnly: true });
      return index;
    } });
    expect(evidence.dependencies).toEqual({ coverage: "complete", coverageReasonCodes: [], items: [
      { reasonCode: "undeclared-dependency", fromCapabilityId: "capability.a", toCapabilityId: "capability.b", importEdgeCount: 1 }
    ] });
    expect(evidence.flows?.selectors[0]?.status).toBe("proven");
    expect(close).toHaveBeenCalledTimes(1);
    expect(calls()).toBe("--version=1\nstatus=1\nquery=1\n--version=1\nstatus=1\n");
    expect(process.env.CODEGRAPH_NO_DOWNLOAD).toBe("0");
  } finally {
    close.mockRestore();
    if (old === undefined) delete process.env.CODEGRAPH_NO_DOWNLOAD; else process.env.CODEGRAPH_NO_DOWNLOAD = old;
  }
});

for (const [name, options, reason, expectedCalls] of [
  ["missing index", { missing: true }, "index-missing", "--version=1\n"],
  ["stale index", { stale: true }, "pending-source-changes", "--version=1\nstatus=1\n"],
  ["query refusal", { queryFails: true }, "codegraph-read-failed", "--version=1\nstatus=1\nquery=1\n"],
  ["index becomes stale during query", { queryMakesStale: true }, "pending-source-changes", "--version=1\nstatus=1\nquery=1\n--version=1\nstatus=1\n"]
] as const) test(`${name} is unknown coverage without invented dependency/flow debt`, () => {
  const { root, binary, calls } = fixture(options);
  const evidence = readArchitectureDebtCodeFacts(root, model, { binary, selectorIndexFactory: () => {
    if (options.missing || options.stale || options.queryFails) throw new Error("selector must not open");
    return selectorIndex();
  } });
  expect(evidence).toEqual({ unavailable: { dependencies: [reason], flows: [reason] } });
  const report = evaluateArchitectureDebt({ scope: { kind: "repository", changedPaths: [], capabilityIds: [] }, ...evidence });
  expect(report.coverage).toBe("unknown");
  expect(report.items).toEqual([]);
  expect(architectureDebtReportIssues(report)).toEqual([]);
  expect(calls()).toBe(expectedCalls);
});

test("read-only selector refusal is reported without a writable retry", () => {
  const { root, binary } = fixture();
  let opens = 0;
  const result = readArchitectureDebtCodeFacts(root, model, { binary, selectorIndexFactory: (_path, options) => {
    opens++;
    expect(options.readOnly).toBe(true);
    throw new Error("readonly open refused");
  } });
  expect(opens).toBe(1);
  expect(result.unavailable?.flows).toEqual(["codegraph-read-failed"]);
});

test("source edits during selector reads invalidate otherwise ready facts and still close the index", () => {
  const { root, binary } = fixture();
  const index = selectorIndex();
  const close = spyOn(index, "close");
  try {
    const result = readArchitectureDebtCodeFacts(root, model, { binary, selectorIndexFactory: () => {
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
