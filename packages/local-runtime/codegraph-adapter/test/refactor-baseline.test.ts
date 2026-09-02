/**
 * RF0 characterization freeze for the CodeGraph import-measurement surface.
 *
 * Three behaviors RF1/RF2 ride on had no test at all: the import specifier resolver's candidate
 * order and its refusal classes, the outbound-only footprint filter in `capabilityImportGraphs`,
 * and the fact that one global `truncated` flag is copied into every capability graph. None of
 * them is exported, so all three are frozen through the two public entrypoints that reach them —
 * `loadCapabilityCodeGraphProjectionInputs` and `CodeGraphCliProvider.buildContext` — using the
 * written-to-disk fake CLI pattern this package already uses. No `export` was added.
 *
 * Machine-dependent values are dropped by an explicit allow-list, never by a wildcard: the
 * handshake fixture freezes the field list and the identity values and reduces every digest to
 * its shape, because those digests hash the absolute project path and the fake binary's bytes.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { digestJson, type Json } from "@archcontext/contracts";
import type { NativeModel } from "@archcontext/core/projection-engine";
import {
  CodeGraphCliProvider,
  loadCapabilityCodeGraphProjectionInputs,
  prepareProjectionCodeFacts,
  type CapabilityCodeGraphProjectionInputs,
  type CodeGraphProjectionHandshakeV1
} from "../src/index";

interface BaselineFixture<TInput> {
  id: string;
  description: string;
  input: TInput;
  expected: unknown;
  digest: string;
}

function loadFixtures<TInput>(name: string): BaselineFixture<TInput>[] {
  const path = new URL(`./fixtures/refactor-baseline/${name}.json`, import.meta.url);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as BaselineFixture<TInput>[];
  if (parsed.length === 0) throw new Error(`refactor-baseline fixture is empty: ${name}`);
  return parsed;
}

function expectFrozen(actual: Json, fixture: BaselineFixture<unknown>): void {
  expect(actual).toEqual(fixture.expected as Json);
  expect(digestJson(actual)).toBe(fixture.digest);
}

/**
 * Import nodes the fake index dumps. Between them they cover every resolver outcome: an exact
 * file that shadows a same-named directory, a directory reached through `index.ts`, the `.ts`
 * before `.js` extension order, an already-extensioned specifier, a dangling relative specifier,
 * two bare specifiers, a target outside the footprint, an escape above the workspace root, and
 * one import whose origin sits outside the footprint entirely.
 */
const importNodes = [
  { filePath: "packages/app/src/main.ts", name: "./exact" },
  { filePath: "packages/app/src/main.ts", name: "./dir" },
  { filePath: "packages/app/src/main.ts", name: "./dironly" },
  { filePath: "packages/app/src/main.ts", name: "./ext" },
  { filePath: "packages/app/src/main.ts", name: "./data.json" },
  { filePath: "packages/app/src/main.ts", name: "./missing" },
  { filePath: "packages/app/src/main.ts", name: "@archcontext/contracts" },
  { filePath: "packages/app/src/main.ts", name: "node:fs" },
  { filePath: "packages/app/src/main.ts", name: "../../lib/src/shared" },
  { filePath: "packages/app/src/main.ts", name: "../../../../outside" },
  { filePath: "packages/other/src/outside.ts", name: "../../app/src/main" }
];

const tree: Record<string, string> = {
  "packages/app/src/main.ts": "export const main = 1;\n",
  "packages/app/src/exact.ts": "export const exact = 1;\n",
  "packages/app/src/exact/index.ts": "export const shadowed = 1;\n",
  "packages/app/src/dir/index.ts": "export const viaIndex = 1;\n",
  "packages/app/src/dironly/notindex.ts": "export const notIndex = 1;\n",
  "packages/app/src/ext.ts": "export const preferred = 1;\n",
  "packages/app/src/ext.js": "module.exports = 1;\n",
  "packages/app/src/data.json": "{}\n",
  "packages/lib/src/shared.ts": "export const shared = 1;\n",
  "packages/other/src/outside.ts": "export const outside = 1;\n"
};

const model: NativeModel = {
  nodes: [
    { id: "capability.app", kind: "capability", name: "App", source: { include: ["packages/app/**"] } },
    { id: "capability.lib", kind: "capability", name: "Lib", source: { include: ["packages/lib/**"] } }
  ],
  relations: []
};

/** Fake CLI that answers the import dump, one symbol query, and `explore`; anything else fails loudly. */
const IMPORT_DUMP_CLI = `
const argv = process.argv.slice(2);
const importNodes = ${JSON.stringify(importNodes)};
if (argv[0] === "query" && argv.includes("-k") && argv[argv.indexOf("-k") + 1] === "import") {
  const limit = Number(argv[argv.indexOf("-l") + 1]);
  process.stdout.write(JSON.stringify(importNodes.slice(0, limit).map((node) => ({
    node: { id: "import:" + node.filePath + ":" + node.name, kind: "import", name: node.name, filePath: node.filePath }
  }))));
  process.exit(0);
}
if (argv[0] === "query") {
  process.stdout.write(JSON.stringify([
    { node: { id: "sym:main", kind: "function", name: "main", filePath: "packages/app/src/main.ts", startLine: 1, endLine: 1 } }
  ]));
  process.exit(0);
}
if (argv[0] === "explore") { process.stdout.write(""); process.exit(0); }
process.stderr.write("unexpected codegraph invocation: " + JSON.stringify(argv));
process.exit(1);
`;

function seedWorkspace(): { root: string; binary: string } {
  const root = mkdtempSync(join(tmpdir(), "archctx-rf0-codegraph-"));
  mkdirSync(join(root, ".codegraph"));
  for (const [path, content] of Object.entries(tree)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }
  const binary = join(root, "fake-codegraph.js");
  writeFileSync(binary, IMPORT_DUMP_CLI, "utf8");
  return { root, binary };
}

const graphFixtures = loadFixtures<{ importNodeLimit?: number }>("capability-import-graphs");

describe("RF0 baseline: capability import graphs", () => {
  for (const fixture of graphFixtures) {
    test(`${fixture.id} — ${fixture.description}`, () => {
      const { root, binary } = seedWorkspace();
      try {
        const inputs = loadCapabilityCodeGraphProjectionInputs(root, model, {
          binary,
          ...(fixture.input.importNodeLimit === undefined ? {} : { importNodeLimit: fixture.input.importNodeLimit })
        });
        expectFrozen({ importGraphs: inputs.importGraphs, selectorEvidence: inputs.selectorEvidence } as unknown as Json, fixture);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

describe("RF0 baseline: resolver and scope behavior restated from the frozen table", () => {
  function expectedInputs(id: string): CapabilityCodeGraphProjectionInputs {
    const fixture = graphFixtures.find((entry) => entry.id === id);
    if (!fixture) throw new Error(`missing refactor-baseline fixture: ${id}`);
    return fixture.expected as CapabilityCodeGraphProjectionInputs;
  }

  const appEdges = () => expectedInputs("resolution-refusals-and-outbound-only-scope").importGraphs[0].edges;

  test("candidate order prefers the exact file, then the extension ladder, then index", () => {
    const targets = appEdges().map((edge) => edge.to);
    // `./exact` sees both `exact.ts` and `exact/index.ts`; the bare base wins.
    expect(targets).toContain("packages/app/src/exact.ts");
    expect(targets).not.toContain("packages/app/src/exact/index.ts");
    // `./ext` sees both `ext.ts` and `ext.js`; `.ts` comes first in the extension list.
    expect(targets).toContain("packages/app/src/ext.ts");
    expect(targets).not.toContain("packages/app/src/ext.js");
    // `./dir` has no file candidate, so the `index` candidates resolve it.
    expect(targets).toContain("packages/app/src/dir/index.ts");
    // An already-extensioned specifier resolves on the bare base.
    expect(targets).toContain("packages/app/src/data.json");
  });

  test("every refusal class yields no edge rather than a guessed one", () => {
    const targets = appEdges().map((edge) => edge.to);
    // Bare package specifier, Node builtin, dangling relative target, directory without an
    // index file, and a specifier that escapes above the workspace root.
    expect(targets).not.toContain("packages/app/src/missing.ts");
    expect(targets.some((target) => target.includes("contracts"))).toBe(false);
    expect(targets.some((target) => target.includes("node:"))).toBe(false);
    expect(targets.some((target) => target.startsWith("packages/app/src/dironly"))).toBe(false);
    expect(targets.some((target) => target.includes(".."))).toBe(false);
    expect(appEdges()).toHaveLength(5);
  });

  test("the footprint filter is outbound-only: `from` must be inside, `to` need not be", () => {
    const inputs = expectedInputs("resolution-refusals-and-outbound-only-scope");
    const app = inputs.importGraphs[0];
    expect(app.nodeId).toBe("capability.app");
    // Every edge originates inside the declared footprint.
    expect(app.edges.every((edge) => app.files.includes(edge.from))).toBe(true);
    // One edge legitimately leaves it.
    expect(app.edges.map((edge) => edge.to)).toContain("packages/lib/src/shared.ts");
    // The import whose origin sits outside the footprint is not attributed to this capability,
    // even though its target is inside it.
    expect(app.edges.map((edge) => edge.from)).not.toContain("packages/other/src/outside.ts");
    expect(inputs.importGraphs[1]).toMatchObject({ nodeId: "capability.lib", edges: [] });
  });

  /**
   * `truncated` is a property of the single repository-wide import dump, and today it is copied
   * verbatim into every capability graph. `capability.lib` has no edges at all, yet it is still
   * marked truncated when the dump saturates. Frozen as observed; RF2 owns whether to change it.
   */
  test("the dump-wide truncated flag is copied into every capability graph", () => {
    const saturated = expectedInputs("saturated-dump-copies-truncated-into-every-graph").importGraphs;
    const headroom = expectedInputs("limit-above-population-is-not-truncated").importGraphs;
    expect(saturated.map((graph) => [graph.nodeId, graph.truncated, graph.edges.length]))
      .toEqual([["capability.app", true, 5], ["capability.lib", true, 0]]);
    expect(headroom.every((graph) => graph.truncated === false)).toBe(true);
    expect(headroom.map((graph) => graph.edges.length)).toEqual([5, 0]);
  });
});

describe("RF0 baseline: normalized task-context import edges", () => {
  for (const fixture of loadFixtures<{ task: string; maxSymbols: number; includeSource: boolean; changedPaths: string[] }>("normalized-import-edges")) {
    test(`${fixture.id} — ${fixture.description}`, async () => {
      const { root, binary } = seedWorkspace();
      try {
        const provider = new CodeGraphCliProvider(root, binary);
        const context = await provider.buildContext(fixture.input.task, {
          maxSymbols: fixture.input.maxSymbols,
          includeSource: fixture.input.includeSource,
          changedPaths: fixture.input.changedPaths
        });
        expectFrozen({ edges: context.edges } as unknown as Json, fixture);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

// --- projection handshake ---

const HANDSHAKE_CLI = `
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const argv = process.argv.slice(2);
const marker = join(process.cwd(), ".rf0-synced");
if (argv[0] === "--version") { process.stdout.write("1.5.0\\n"); process.exit(0); }
if (argv[0] === "sync") { writeFileSync(marker, "ok"); process.exit(0); }
if (argv[0] === "status") {
  const clean = existsSync(marker);
  process.stdout.write(JSON.stringify({
    initialized: true,
    version: "1.5.0",
    projectPath: process.cwd(),
    lastIndexed: clean ? "2026-08-08T09:00:00.000Z" : "2026-08-08T08:00:00.000Z",
    fileCount: 2,
    nodeCount: 4,
    edgeCount: 3,
    nodesByKind: { file: 2, function: 2 },
    languages: ["typescript"],
    pendingChanges: { added: 0, modified: clean ? 0 : 1, removed: 0 },
    worktreeMismatch: null,
    index: { builtWithVersion: "1.5.0", builtWithExtractionVersion: 24, currentExtractionVersion: 24, reindexRecommended: false, state: "complete", pendingRefs: 0 }
  }));
  process.exit(0);
}
process.stderr.write("unexpected invocation " + JSON.stringify(argv));
process.exit(2);
`;

/** Reduces a digest to its shape; the value itself hashes the absolute path and the fake binary. */
function shape(value: string | null): string | null {
  if (value === null) return null;
  return /^sha256:[0-9a-f]{64}$/.test(value) ? "sha256" : `unexpected:${value}`;
}

/** Explicit allow-list: field list plus identity values; digests only as shapes. */
function normalizeHandshake(handshake: CodeGraphProjectionHandshakeV1): Json {
  return {
    fieldsPresent: Object.keys(handshake).sort(),
    schemaVersion: handshake.schemaVersion,
    packageName: handshake.packageName,
    requiredVersion: handshake.requiredVersion,
    actualVersion: handshake.actualVersion,
    availability: handshake.availability,
    reasonCode: handshake.reasonCode ?? null,
    digestShapes: {
      binaryDigest: shape(handshake.binaryDigest),
      preSyncStatusDigest: shape(handshake.preSyncStatusDigest),
      postSyncStatusDigest: shape(handshake.postSyncStatusDigest),
      syncDigest: shape(handshake.syncDigest),
      indexedWorktreeDigest: shape(handshake.indexedWorktreeDigest),
      graphDigest: shape(handshake.graphDigest)
    }
  } as unknown as Json;
}

describe("RF0 baseline: projection handshake field list", () => {
  for (const fixture of loadFixtures<{ withIndex: boolean }>("projection-handshake")) {
    test(`${fixture.id} — ${fixture.description}`, () => {
      const root = mkdtempSync(join(tmpdir(), "archctx-rf0-handshake-"));
      try {
        if (fixture.input.withIndex) mkdirSync(join(root, ".codegraph"));
        const binary = join(root, "fake-codegraph.js");
        writeFileSync(binary, HANDSHAKE_CLI, "utf8");
        const prepared = prepareProjectionCodeFacts(root, { nodes: [], relations: [] }, {
          binary,
          sourceTreeDigest: `sha256:${"9".repeat(64)}`
        });
        expectFrozen(normalizeHandshake(prepared.handshake), fixture);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
