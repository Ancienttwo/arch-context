#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The adapter imports core native dependencies; keep the Node fixture under their owning workspace.
const cacheRoot = join(repoRoot, "packages", "core", "node_modules", ".cache");
mkdirSync(cacheRoot, { recursive: true });
const buildRoot = mkdtempSync(join(cacheRoot, "archctx-codegraph-selector-node-"));
const fixtureRoot = mkdtempSync(join(tmpdir(), "archctx-codegraph-selector-node-"));

try {
  const initialized = spawnSync("git", ["init", "-q"], { cwd: fixtureRoot, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  writeFileSync(join(fixtureRoot, ".gitignore"), ".codegraph/\n");
  mkdirSync(join(fixtureRoot, "src"), { recursive: true });
  writeFileSync(join(fixtureRoot, "src", "render.ts"), [
    "export function renderBlock(): string {",
    "  return \"block\";",
    "}",
    ""
  ].join("\n"));
  writeFileSync(join(fixtureRoot, "src", "main.ts"), [
    "import { renderBlock } from \"./render\";",
    "",
    "export function renderMain(): string {",
    "  return renderBlock();",
    "}",
    ""
  ].join("\n"));
  // #300: a repository function that shares a Node built-in name, a file that calls the built-in,
  // a file that calls the repository function through an import, value wiring, and a duplicate.
  writeFileSync(join(fixtureRoot, "src", "util.ts"), [
    "export function resolve(value: string): string {",
    "  return value;",
    "}",
    "",
    "export function existsSync(path: string): boolean {",
    "  return path.length > 0;",
    "}",
    ""
  ].join("\n"));
  writeFileSync(join(fixtureRoot, "src", "builtin.ts"), [
    "import { resolve } from \"node:path\";",
    "import { existsSync } from \"node:fs\";",
    "",
    "export function usesBuiltins(): boolean {",
    "  return existsSync(resolve(\"a\"));",
    "}",
    ""
  ].join("\n"));
  writeFileSync(join(fixtureRoot, "src", "imported.ts"), [
    "import { existsSync } from \"./util\";",
    "",
    "export function usesUtil(): boolean {",
    "  return existsSync(\"a\");",
    "}",
    ""
  ].join("\n"));
  writeFileSync(join(fixtureRoot, "src", "wiring.ts"), [
    "import { renderBlock } from \"./render\";",
    "",
    "function run(step: () => string): string {",
    "  return step();",
    "}",
    "",
    "export function wireRender(): string {",
    "  return run(renderBlock);",
    "}",
    "",
    "export const helper = (): string => renderBlock();",
    "",
    "export function outer(): string {",
    "  function helper(): string {",
    "    return renderBlock();",
    "  }",
    "  return helper();",
    "}",
    ""
  ].join("\n"));

  const bundlePath = join(buildRoot, "codegraph-adapter.mjs");
  const built = spawnSync("bun", [
    "build",
    "packages/local-runtime/codegraph-adapter/src/index.ts",
    "--target=node",
    "--format=esm",
    "--external",
    "@colbymchenry/codegraph",
    "--external=koffi",
    "--outfile",
    bundlePath
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.equal(built.status, 0, built.stderr || built.stdout || "failed to bundle the CodeGraph adapter");

  assert.equal(readFileSync(bundlePath, "utf8").includes(repoRoot), false, "Node adapter bundle must not embed the build root");
  const imported = await import(pathToFileURL(bundlePath).href);
  const adapter = imported.default ?? imported;
  const invocation = adapter.codeGraphCliInvocation("codegraph", fixtureRoot);
  const cliEnv = {
    ...process.env,
    [adapter.CODEGRAPH_TELEMETRY_ENV]: adapter.CODEGRAPH_TELEMETRY_DISABLED_VALUE
  };
  const version = spawnSync(invocation.command, [...invocation.argsPrefix, "--version"], {
    cwd: fixtureRoot, encoding: "utf8", env: cliEnv, stdio: ["ignore", "pipe", "pipe"]
  });
  assert.deepEqual(
    { status: version.status, stdout: version.stdout?.trim(), stderr: version.stderr },
    { status: 0, stdout: adapter.REQUIRED_CODEGRAPH_VERSION, stderr: "" },
    "selector fixture must index with the exact installed CodeGraph version"
  );
  const indexed = spawnSync(invocation.command, [...invocation.argsPrefix, "init", fixtureRoot], {
    cwd: fixtureRoot,
    encoding: "utf8",
    env: cliEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.deepEqual(
    { status: indexed.status, stderr: indexed.stderr },
    { status: 0, stderr: "" },
    indexed.stderr || indexed.stdout || "failed to index the selector fixture"
  );
  assert.equal(adapter.codeGraphIndexAvailable(fixtureRoot), true);

  const model = {
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
  assert.deepEqual(adapter.loadCapabilityCodeGraphProjectionInputs(fixtureRoot, model), {
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

  const selector = (sourcePath, sourceSymbol, sinkId, sinkPath, sinkSymbol) => ({
    id: `entrypoint.proof.${sinkId}`,
    path: sourcePath,
    symbols: [{ name: sourceSymbol, sinks: [{ id: `sink.proof.${sinkId}`, path: sinkPath, symbol: sinkSymbol }] }]
  });
  const proofModel = {
    nodes: [{
      id: "capability.proof",
      kind: "capability",
      name: "Proof",
      source: {
        entrypoints: [
          selector("src/builtin.ts", "usesBuiltins", "false-resolve", "src/util.ts", "resolve"),
          selector("src/builtin.ts", "usesBuiltins", "false-exists", "src/util.ts", "existsSync"),
          selector("src/imported.ts", "usesUtil", "imported-exists", "src/util.ts", "existsSync"),
          selector("src/wiring.ts", "wireRender", "by-value", "src/render.ts", "renderBlock"),
          selector("src/wiring.ts", "helper", "duplicate", "src/render.ts", "renderBlock")
        ]
      }
    }],
    relations: []
  };
  const proof = Object.fromEntries(adapter.loadCapabilityCodeGraphProjectionInputs(fixtureRoot, proofModel).selectorEvidence
    .map((entry) => [entry.sinkId.slice("sink.proof.".length), entry]));
  // CodeGraph 1.6.2 no longer reports the two built-in calls as calls to repository functions.
  // The source imports only node:path and node:fs; neither call may prove the selector.
  for (const name of ["false-resolve", "false-exists"]) {
    assert.equal(proof[name].matched, false, name);
    assert.deepEqual(proof[name].callSites, [], name);
    assert.equal(proof[name].rejectedBuiltinCallSites, undefined, name);
  }
  assert.equal(proof["imported-exists"].matched, true);
  assert.deepEqual(proof["imported-exists"].callSites, [{ path: "src/imported.ts", line: 4 }]);
  assert.equal(proof["imported-exists"].rejectedBuiltinCallSites, undefined);
  assert.equal(proof["by-value"].matched, false);
  assert.deepEqual(proof["by-value"].referenceSites, [{ path: "src/wiring.ts", line: 8 }]);
  assert.equal(proof.duplicate.ambiguous, true);
  assert.equal(proof.duplicate.matched, false);

  const indexFiles = (directory = join(fixtureRoot, ".codegraph")) => readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? [entry.name, indexFiles(path)] : [entry.name, readFileSync(path).toString("base64"), statSync(path).mtimeMs];
  });
  const { CodeGraph } = createRequire(import.meta.url)("@colbymchenry/codegraph");
  for (const liveWal of [false, true]) {
    const holder = liveWal ? CodeGraph.openSync(fixtureRoot) : undefined;
    try {
      const before = indexFiles();
      assert.equal(adapter.withExistingCodeGraphSnapshot(fixtureRoot, { names: ["renderMain"], sources: [], includeFiles: false }, graph => graph.getNodesByName("renderMain").length), 1);
      assert.deepEqual(indexFiles(), before, `private Node snapshot must preserve original DB and sidecars, liveWal=${liveWal}`);
    } finally { holder?.close(); }
  }
  const beforeStale = indexFiles();
  writeFileSync(join(fixtureRoot, "src/render.ts"), 'export function renderBlock() { return "changed"; }\n');
  assert.throws(() => adapter.withExistingCodeGraphSnapshot(fixtureRoot, { names: [], sources: [], includeFiles: false }, () => true), error => error.reasonCode === "code-facts-read-not-ready");
  assert.deepEqual(indexFiles(), beforeStale, "stale Node snapshot must not sync the original index");

  console.log(JSON.stringify({
    schemaVersion: "archcontext.codegraph-selector-node-integration/v1",
    status: "verified",
    nodeVersion: process.version,
    codeGraphVersion: adapter.REQUIRED_CODEGRAPH_VERSION,
    privateSnapshots: "closed-and-live-wal-preserved; stale-refused",
    callSite: { path: "src/main.ts", line: 4 }
  }));
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(buildRoot, { recursive: true, force: true });
}
