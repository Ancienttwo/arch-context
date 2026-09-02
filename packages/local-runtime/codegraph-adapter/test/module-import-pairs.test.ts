import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryImportPairs } from "../src/index";

const WORKTREE_DIGEST = `sha256:${"a".repeat(64)}`;

/**
 * Fake index CLI. It answers the two query shapes this producer issues and fails loudly on
 * anything else, so an unexpected invocation surfaces as a failure rather than as an empty answer.
 */
function fakeCli(logPath: string, pending: number): string {
  return `
import { appendFileSync } from "node:fs";
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(argv) + "\\n");
const importNodes = [
  { name: "./render", filePath: "packages/docs/src/main.ts" },
  { name: "./render", filePath: "packages/docs/src/main.ts" },
  { name: "@archcontext/contracts", filePath: "packages/docs/src/main.ts" },
  { name: "node:fs", filePath: "packages/docs/src/main.ts" },
  { name: "./missing-target", filePath: "packages/docs/src/render.ts" },
  { name: "../../shared/util", filePath: "packages/docs/src/render.ts" },
  { name: "./helper", filePath: "packages/other/src/index.ts" }
];
if (argv[0] === "query") {
  const limit = Number(argv[argv.indexOf("-l") + 1]);
  process.stdout.write(JSON.stringify(importNodes.slice(0, limit).map((node) => ({
    node: { id: "import:" + node.filePath + ":" + node.name, kind: "import", name: node.name, filePath: node.filePath }
  }))));
} else if (argv[0] === "status") {
  process.stdout.write(JSON.stringify({
    initialized: true,
    version: "1.5.0",
    projectPath: process.cwd(),
    lastIndexed: "2026-09-03T00:00:00Z",
    pendingChanges: { added: ${pending}, modified: 0, removed: 0 }
  }));
} else {
  process.stderr.write("unexpected codegraph invocation: " + JSON.stringify(argv));
  process.exit(1);
}
`;
}

function seedWorkspace(options: { withIndex?: boolean; pending?: number } = {}): { root: string; binary: string; log: string } {
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
  writeFileSync(binary, fakeCli(log, options.pending ?? 0));
  return { root, binary, log };
}

describe("repository-wide import pairs", () => {
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
      expect(invocations.map((argv) => argv[0])).toEqual(["query", "status"]);
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
        indexedWorktreeDigest: null
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a saturated dump is reported as truncated, not as a complete edge set", () => {
    const { root, binary } = seedWorkspace();
    try {
      const result = repositoryImportPairs(root, binary, 3, WORKTREE_DIGEST);
      expect(result.truncated).toBe(true);
      expect(result.pairs).toEqual([
        { from: "packages/docs/src/main.ts", specifier: "./render", to: "packages/docs/src/render.ts" },
        { from: "packages/docs/src/main.ts", specifier: "@archcontext/contracts", to: null }
      ]);
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
