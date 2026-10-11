import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODEGRAPH_IMPORT_NODE_READ_LIMIT, repositoryImportPairs } from "../src/index";

const WORKTREE_DIGEST = `sha256:${"a".repeat(64)}`;

interface FakeIndexOptions {
  /** Extra import nodes beyond the seven named ones, to exceed one fixed-size read. */
  generated?: number;
  /** Report `nodesByKind.import` in the status, as CodeGraph 1.6.1 does. */
  reportCount?: boolean;
  /** Return this many fewer nodes than the status reports, as an index that changed mid-read. */
  queryShortBy?: number;
}

/**
 * Fake index CLI. It answers the two query shapes this producer issues and fails loudly on
 * anything else, so an unexpected invocation surfaces as a failure rather than as an empty answer.
 */
function fakeCli(logPath: string, pending: number, withLines = false, index: FakeIndexOptions = {}): string {
  return `
import { appendFileSync } from "node:fs";
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(argv) + "\\n");
const withLines = ${withLines};
const importNodes = [
  { name: "./render", filePath: "packages/docs/src/main.ts", startLine: 4 },
  { name: "./render", filePath: "packages/docs/src/main.ts", startLine: 2 },
  { name: "@archcontext/contracts", filePath: "packages/docs/src/main.ts" },
  { name: "node:fs", filePath: "packages/docs/src/main.ts" },
  { name: "./missing-target", filePath: "packages/docs/src/render.ts" },
  { name: "../../shared/util", filePath: "packages/docs/src/render.ts" },
  { name: "./helper", filePath: "packages/other/src/index.ts" }
];
for (let i = 0; i < ${index.generated ?? 0}; i += 1) {
  importNodes.push({ name: "./generated-" + i, filePath: "packages/generated/src/file-" + (i % 100) + ".ts" });
}
if (argv[0] === "query") {
  const limit = Number(argv[argv.indexOf("-l") + 1]);
  const available = importNodes.length - ${index.queryShortBy ?? 0};
  process.stdout.write(JSON.stringify(importNodes.slice(0, Math.min(limit, available)).map((node) => ({
    node: { id: "import:" + node.filePath + ":" + node.name, kind: "import", name: node.name, filePath: node.filePath, ...(withLines && node.startLine ? { startLine: node.startLine } : {}) }
  }))));
} else if (argv[0] === "status") {
  process.stdout.write(JSON.stringify({
    initialized: true,
    version: "1.6.1",
    projectPath: process.cwd(),
    lastIndexed: "2026-09-03T00:00:00Z",
    ...(${index.reportCount ?? false} ? { nodesByKind: { file: 5, import: importNodes.length } } : {}),
    pendingChanges: { added: ${pending}, modified: 0, removed: 0 }
  }));
} else {
  process.stderr.write("unexpected codegraph invocation: " + JSON.stringify(argv));
  process.exit(1);
}
`;
}

function seedWorkspace(options: { withIndex?: boolean; pending?: number; withLines?: boolean } & FakeIndexOptions = {}): { root: string; binary: string; log: string } {
  const root = mkdtempSync(join(tmpdir(), "archctx-module-import-pairs-"));
  if (options.withIndex !== false) mkdirSync(join(root, ".codegraph"));
  mkdirSync(join(root, "packages/docs/src"), { recursive: true });
  mkdirSync(join(root, "packages/shared"), { recursive: true });
  mkdirSync(join(root, "packages/other/src"), { recursive: true });
  writeFileSync(join(root, "packages/docs/src/main.ts"), "export const main = 1;\n");
  writeFileSync(join(root, "packages/docs/src/render.ts"), "export const render = 1;\n");
  writeFileSync(join(root, "packages/shared/util.ts"), "export const util = 1;\n");
  writeFileSync(join(root, "packages/other/src/helper.ts"), "export const helper = 1;\n");
  writeFileSync(join(root, "packages/other/src/index.ts"), "export const index = 1;\n");
  const log = join(root, "invocations.log");
  writeFileSync(log, "");
  const binary = join(root, "fake-codegraph.js");
  writeFileSync(binary, fakeCli(log, options.pending ?? 0, options.withLines ?? false, options));
  return { root, binary, log };
}

describe("repository-wide import pairs", () => {
  test("locates a repeated specifier at its first reported import line, and omits an unreported one", () => {
    const { root, binary } = seedWorkspace({ withLines: true });
    try {
      const result = repositoryImportPairs(root, binary, 100, WORKTREE_DIGEST);
      expect(result.pairs.find((pair) => pair.specifier === "./render")).toEqual({
        from: "packages/docs/src/main.ts",
        specifier: "./render",
        to: "packages/docs/src/render.ts",
        line: 2
      });
      expect("line" in result.pairs.find((pair) => pair.specifier === "node:fs")!).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("keeps every unresolved specifier as its own record with the specifier retained", () => {
    const { root, binary, log } = seedWorkspace();
    try {
      const result = repositoryImportPairs(root, binary, 100, WORKTREE_DIGEST);

      expect(result.truncated).toBe(false);
      // Bare and dangling specifiers stay as `to: null` because a module snapshot has to report
      // how much of its boundary is unresolved. They are keyed by (file, specifier), so the three
      // distinct unresolved specifiers from main.ts and render.ts stay three separate records
      // instead of collapsing into one. Repeated identical specifiers still collapse.
      expect(result.pairs).toEqual([
        { from: "packages/docs/src/main.ts", specifier: "./render", to: "packages/docs/src/render.ts" },
        { from: "packages/docs/src/main.ts", specifier: "@archcontext/contracts", to: null },
        { from: "packages/docs/src/main.ts", specifier: "node:fs", to: null },
        { from: "packages/docs/src/render.ts", specifier: "../../shared/util", to: "packages/shared/util.ts" },
        { from: "packages/docs/src/render.ts", specifier: "./missing-target", to: null },
        { from: "packages/other/src/index.ts", specifier: "./helper", to: "packages/other/src/helper.ts" }
      ]);
      expect(result.pairs.filter((pair) => pair.from === "packages/docs/src/main.ts" && pair.to === null)).toHaveLength(2);

      const invocations = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
      // The read is sized from the index's own import count, so the status is read first.
      expect(invocations.map((argv) => argv[0])).toEqual(["status", "query"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("binds the edges to the measured worktree only when the index reports itself clean", () => {
    const clean = seedWorkspace();
    try {
      expect(repositoryImportPairs(clean.root, clean.binary, 100, WORKTREE_DIGEST)).toMatchObject({
        availability: "ready",
        indexedWorktreeDigest: WORKTREE_DIGEST
      });
    } finally {
      rmSync(clean.root, { recursive: true, force: true });
    }

    // An index with pending source changes describes some other tree; it attests to nothing.
    const stale = seedWorkspace({ pending: 3 });
    try {
      expect(repositoryImportPairs(stale.root, stale.binary, 100, WORKTREE_DIGEST)).toMatchObject({
        availability: "unavailable",
        indexedWorktreeDigest: null
      });
    } finally {
      rmSync(stale.root, { recursive: true, force: true });
    }
  });

  test("no index at all is an explicit unavailable state, not an empty measurement", () => {
    const { root, binary } = seedWorkspace();
    try {
      rmdirSync(join(root, ".codegraph"));
      expect(repositoryImportPairs(root, binary, 100, WORKTREE_DIGEST)).toEqual({
        pairs: [],
        truncated: true,
        availability: "unavailable",
        indexedWorktreeDigest: null,
        importNodeCount: null,
        importNodeLimit: 100,
        importNodeLimitExceeded: false
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an index larger than the limit is reported as limit exceeded with its count, not as a complete edge set", () => {
    for (const reportCount of [true, false]) {
      const { root, binary } = seedWorkspace({ reportCount });
      try {
        const result = repositoryImportPairs(root, binary, 3, WORKTREE_DIGEST);
        expect(result.importNodeLimitExceeded).toBe(true);
        // The index is complete; only the configured limit cut the read.
        expect(result.truncated).toBe(false);
        expect(result.importNodeLimit).toBe(3);
        // Without a status count the reply only proves "more than the limit".
        expect(result.importNodeCount).toBe(reportCount ? 7 : null);
        expect(result.pairs).toEqual([
          { from: "packages/docs/src/main.ts", specifier: "./render", to: "packages/docs/src/render.ts" },
          { from: "packages/docs/src/main.ts", specifier: "@archcontext/contracts", to: null }
        ]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test("a complete index larger than one fixed-size read gives every pair, not a truncated prefix", () => {
    // 5007 import nodes: more than the former fixed 5000-node read.
    const { root, binary, log } = seedWorkspace({ reportCount: true, generated: 5000 });
    try {
      const result = repositoryImportPairs(root, binary, CODEGRAPH_IMPORT_NODE_READ_LIMIT, WORKTREE_DIGEST);
      expect(result.truncated).toBe(false);
      expect(result.importNodeLimitExceeded).toBe(false);
      expect(result.importNodeCount).toBe(5007);
      expect(result.pairs).toHaveLength(5006);
      expect(result.pairs.filter((pair) => pair.specifier.startsWith("./generated-"))).toHaveLength(5000);
      expect(result.availability).toBe("ready");
      // One query sized from the reported count, plus one node to detect an index that grew.
      const query = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]).find((argv) => argv[0] === "query")!;
      expect(query[query.indexOf("-l") + 1]).toBe("5008");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a read shorter than the reported population is real truncation, not a limit", () => {
    const { root, binary } = seedWorkspace({ reportCount: true, queryShortBy: 2 });
    try {
      const result = repositoryImportPairs(root, binary, 100, WORKTREE_DIGEST);
      expect(result.truncated).toBe(true);
      expect(result.importNodeLimitExceeded).toBe(false);
      expect(result.importNodeCount).toBe(7);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a limit that is not a positive integer", () => {
    const { root, binary } = seedWorkspace();
    try {
      expect(() => repositoryImportPairs(root, binary, 0, WORKTREE_DIGEST)).toThrow("positive integer");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("two runs over the same workspace return the same ordered pairs", () => {
    const { root, binary } = seedWorkspace();
    try {
      expect(JSON.stringify(repositoryImportPairs(root, binary, 100, WORKTREE_DIGEST)))
        .toBe(JSON.stringify(repositoryImportPairs(root, binary, 100, WORKTREE_DIGEST)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
