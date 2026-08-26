#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = join(repoRoot, "node_modules", ".cache");
mkdirSync(cacheRoot, { recursive: true });
const buildRoot = mkdtempSync(join(cacheRoot, "archctx-codegraph-selector-node-"));
const fixtureRoot = mkdtempSync(join(tmpdir(), "archctx-codegraph-selector-node-"));

try {
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

  const bundlePath = join(buildRoot, "codegraph-adapter.cjs");
  const built = spawnSync("bun", [
    "build",
    "packages/local-runtime/codegraph-adapter/src/index.ts",
    "--target=node",
    "--format=cjs",
    "--external",
    "@colbymchenry/codegraph",
    "--outfile",
    bundlePath
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.equal(built.status, 0, built.stderr || built.stdout || "failed to bundle the CodeGraph adapter");

  const imported = await import(pathToFileURL(bundlePath).href);
  const adapter = imported.default ?? imported;
  const invocation = adapter.codeGraphCliInvocation("codegraph", fixtureRoot);
  const indexed = spawnSync(invocation.command, [...invocation.argsPrefix, "init", fixtureRoot], {
    cwd: fixtureRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      [adapter.CODEGRAPH_TELEMETRY_ENV]: adapter.CODEGRAPH_TELEMETRY_DISABLED_VALUE
    },
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

  console.log(JSON.stringify({
    schemaVersion: "archcontext.codegraph-selector-node-integration/v1",
    status: "verified",
    nodeVersion: process.version,
    codeGraphVersion: adapter.REQUIRED_CODEGRAPH_VERSION,
    callSite: { path: "src/main.ts", line: 4 }
  }));
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(buildRoot, { recursive: true, force: true });
}
