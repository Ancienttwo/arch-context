import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { CODEGRAPH_IMPORT_NODE_READ_LIMIT, repositoryImportPairs, type CodeGraphReadProvider } from "../src/index";
import { fakeReadProvider, type FakeIndexFacts } from "./read-provider-fixture";
import { indexCodeGraphFixture } from "./real-index";

const WORKTREE_DIGEST = `sha256:${"a".repeat(64)}`;

interface FakeImportIndex {
  /** Extra import nodes beyond the seven named ones. */
  generated?: number;
  /** Report a `startLine` on the nodes that name one. */
  withLines?: boolean;
  /** Return this many fewer nodes than the count reports, as an index that changed mid-read. */
  queryShortBy?: number;
  /** Report this many fewer nodes in the count than the read returns, as an index that grew mid-read. */
  countShortBy?: number;
  /** Readiness facts of the injected index (pending changes, a moving revision). */
  facts?: FakeIndexFacts;
}

/**
 * An injected read-only provider whose handle answers `getStats` and `getNodesByKind("import")`.
 * The nodes come back in reverse of their (filePath, name, startLine) order, so a prefix that does
 * not sort them is visible.
 */
function importProvider(root: string, index: FakeImportIndex = {}): CodeGraphReadProvider {
  const base = fakeReadProvider(root, index.facts ?? {});
  const named = [
    { name: "./render", filePath: "packages/docs/src/main.ts", startLine: 4 },
    { name: "./render", filePath: "packages/docs/src/main.ts", startLine: 2 },
    { name: "@archcontext/contracts", filePath: "packages/docs/src/main.ts" },
    { name: "node:fs", filePath: "packages/docs/src/main.ts" },
    { name: "./missing-target", filePath: "packages/docs/src/render.ts" },
    { name: "../../shared/util", filePath: "packages/docs/src/render.ts" },
    { name: "./helper", filePath: "packages/other/src/index.ts" }
  ];
  const generated = Array.from({ length: index.generated ?? 0 }, (_, i) => ({ name: `./generated-${i}`, filePath: `packages/generated/src/file-${i % 100}.ts` }));
  const nodes = [...named, ...generated].map((node) => ({
    id: `import:${node.filePath}:${node.name}`,
    kind: "import",
    name: node.name,
    filePath: node.filePath,
    ...(index.withLines && "startLine" in node ? { startLine: node.startLine } : {})
  }));
  return {
    ...base,
    openReadOnly: (openedRoot) => Object.assign(base.openReadOnly(openedRoot), {
      getStats: () => ({ nodesByKind: { file: 5, import: nodes.length - (index.countShortBy ?? 0) } }),
      getNodesByKind: (kind: string) => kind === "import" ? nodes.slice(0, nodes.length - (index.queryShortBy ?? 0)).reverse() : []
    })
  };
}

function seedWorkspace(index: FakeImportIndex = {}): { root: string; provider: CodeGraphReadProvider } {
  const root = mkdtempSync(join(tmpdir(), "archctx-module-import-pairs-"));
  // Import targets resolve against the Git-visible files, so the fixture is a checkout.
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  mkdirSync(join(root, "packages/docs/src"), { recursive: true });
  mkdirSync(join(root, "packages/shared"), { recursive: true });
  mkdirSync(join(root, "packages/other/src"), { recursive: true });
  writeFileSync(join(root, "packages/docs/src/main.ts"), "export const main = 1;\n");
  writeFileSync(join(root, "packages/docs/src/render.ts"), "export const render = 1;\n");
  writeFileSync(join(root, "packages/shared/util.ts"), "export const util = 1;\n");
  writeFileSync(join(root, "packages/other/src/helper.ts"), "export const helper = 1;\n");
  writeFileSync(join(root, "packages/other/src/index.ts"), "export const index = 1;\n");
  return { root, provider: importProvider(root, index) };
}

function pairsOf(root: string, provider: CodeGraphReadProvider, limit = 100) {
  return repositoryImportPairs(root, limit, WORKTREE_DIGEST, listGitVisibleFiles(root), { provider });
}

describe("repository-wide import pairs", () => {
  test("locates a repeated specifier at its first reported import line, and omits an unreported one", () => {
    const { root, provider } = seedWorkspace({ withLines: true });
    try {
      const result = pairsOf(root, provider);
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
    const { root, provider } = seedWorkspace();
    try {
      const result = pairsOf(root, provider);

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
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("binds the edges to the measured worktree only when the index has no pending change", () => {
    const clean = seedWorkspace();
    try {
      expect(pairsOf(clean.root, clean.provider)).toMatchObject({
        availability: "ready",
        indexedWorktreeDigest: WORKTREE_DIGEST
      });
    } finally {
      rmSync(clean.root, { recursive: true, force: true });
    }

    // An index with pending source changes describes some other tree; it attests to nothing.
    const stale = seedWorkspace({ facts: { pending: { added: 3, modified: 0, removed: 0 } } });
    try {
      expect(pairsOf(stale.root, stale.provider)).toMatchObject({
        availability: "unavailable",
        indexedWorktreeDigest: null
      });
    } finally {
      rmSync(stale.root, { recursive: true, force: true });
    }
  });

  test("an index that moves during the read attests to nothing and is truncated", () => {
    const { root, provider } = seedWorkspace({ facts: { revisionMoves: true } });
    try {
      expect(pairsOf(root, provider)).toMatchObject({
        truncated: true,
        availability: "unavailable",
        indexedWorktreeDigest: null,
        importNodeCount: 7
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("no index at all is an explicit unavailable state, not an empty measurement", () => {
    const { root, provider } = seedWorkspace();
    try {
      rmSync(join(root, ".codegraph"), { recursive: true, force: true });
      expect(pairsOf(root, provider)).toEqual({
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

  test("an index larger than the limit keeps the (filePath, name, startLine) prefix and reports the limit, not truncation", () => {
    const { root, provider } = seedWorkspace();
    try {
      const result = pairsOf(root, provider, 3);
      expect(result.importNodeLimitExceeded).toBe(true);
      // The index is complete; only the configured limit cut the read.
      expect(result.truncated).toBe(false);
      expect(result.importNodeLimit).toBe(3);
      expect(result.importNodeCount).toBe(7);
      // The index returns the nodes reversed; the prefix is still the first three in sort order.
      expect(result.pairs).toEqual([
        { from: "packages/docs/src/main.ts", specifier: "./render", to: "packages/docs/src/render.ts" },
        { from: "packages/docs/src/main.ts", specifier: "@archcontext/contracts", to: null }
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a complete index larger than one fixed-size read gives every pair, not a truncated prefix", () => {
    // 5007 import nodes: more than the former fixed 5000-node read.
    const { root, provider } = seedWorkspace({ generated: 5000 });
    try {
      const result = pairsOf(root, provider, CODEGRAPH_IMPORT_NODE_READ_LIMIT);
      expect(result.truncated).toBe(false);
      expect(result.importNodeLimitExceeded).toBe(false);
      expect(result.importNodeCount).toBe(5007);
      expect(result.pairs).toHaveLength(5006);
      expect(result.pairs.filter((pair) => pair.specifier.startsWith("./generated-"))).toHaveLength(5000);
      expect(result.availability).toBe("ready");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a read shorter than the reported population is real truncation, not a limit", () => {
    const { root, provider } = seedWorkspace({ queryShortBy: 2 });
    try {
      const result = pairsOf(root, provider);
      expect(result.truncated).toBe(true);
      expect(result.importNodeLimitExceeded).toBe(false);
      expect(result.importNodeCount).toBe(7);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an index that shrinks below the limit during a limit-exceeded read is also truncated", () => {
    // The count reports 7 import nodes, the cap is 3, and the read returns only 2 nodes.
    const { root, provider } = seedWorkspace({ queryShortBy: 5 });
    try {
      const result = pairsOf(root, provider, 3);
      expect(result.importNodeLimitExceeded).toBe(true);
      expect(result.truncated).toBe(true);
      expect(result.importNodeCount).toBe(7);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // The kept prefix is the first `limit` sorted nodes whatever the count said, and a count that
  // disagrees with the read stays truncated. Seven nodes are returned unless the read is short.
  for (const row of [
    { name: "grows from below the cap across it", index: { countShortBy: 5 }, limit: 3, count: 2 },
    { name: "grows from the cap across it", index: { countShortBy: 4 }, limit: 3, count: 3 },
    { name: "grows while above the cap", index: { countShortBy: 2 }, limit: 3, count: 5 },
    { name: "shrinks while above the cap", index: { queryShortBy: 2 }, limit: 3, count: 7 }
  ]) test(`an index that ${row.name} during the read keeps a capped prefix and is truncated`, () => {
    const { root, provider } = seedWorkspace(row.index);
    try {
      const result = pairsOf(root, provider, row.limit);
      expect(result).toMatchObject({ truncated: true, importNodeCount: row.count, importNodeLimit: row.limit, importNodeLimitExceeded: true });
      expect(result.pairs).toEqual([
        { from: "packages/docs/src/main.ts", specifier: "./render", to: "packages/docs/src/render.ts" },
        { from: "packages/docs/src/main.ts", specifier: "@archcontext/contracts", to: null }
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a limit that is not a positive integer", () => {
    const { root, provider } = seedWorkspace();
    try {
      expect(() => pairsOf(root, provider, 0)).toThrow("positive integer");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("two runs over the same workspace return the same ordered pairs", () => {
    const { root, provider } = seedWorkspace();
    try {
      expect(JSON.stringify(pairsOf(root, provider))).toBe(JSON.stringify(pairsOf(root, provider)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("repository-wide import pairs from a real index", () => {
  let root = "";
  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-module-import-pairs-real-")));
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(join(root, ".gitignore"), ".codegraph/\n");
    mkdirSync(join(root, "src/c"), { recursive: true });
    writeFileSync(join(root, "src/a.ts"), 'import { b } from "./b";\nimport { join } from "node:path";\nimport { gone } from "./gone";\nexport const a = b + join("x") + gone;\n');
    writeFileSync(join(root, "src/b.ts"), "export const b = 1;\n");
    writeFileSync(join(root, "src/c/index.ts"), "export const c = 1;\n");
    writeFileSync(join(root, "src/d.ts"), 'import { c } from "./c";\nimport { z } from "@scope/pkg";\nexport const d = c + z;\n');
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", `core.hooksPath=${join(root, ".git/no-hooks")}`, "commit", "-qm", "fixture"], { cwd: root });
    indexCodeGraphFixture(root);
  }, 120_000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test("gives the pinned pairs, resolved and unresolved, and runs no git status or diff and no CodeGraph command", () => {
    const sourceFiles = listGitVisibleFiles(root);
    const spy = process.platform === "win32" ? undefined : commandSpy();
    let result: ReturnType<typeof repositoryImportPairs>;
    let commands: string[] = [];
    try {
      result = repositoryImportPairs(root, CODEGRAPH_IMPORT_NODE_READ_LIMIT, WORKTREE_DIGEST, sourceFiles);
      commands = spy?.commands() ?? [];
    } finally { spy?.restore(); }
    expect(result).toEqual({
      pairs: [
        { from: "src/a.ts", specifier: "./b", to: "src/b.ts", line: 1 },
        { from: "src/a.ts", specifier: "./gone", to: null, line: 3 },
        { from: "src/a.ts", specifier: "node:path", to: null, line: 2 },
        { from: "src/d.ts", specifier: "./c", to: "src/c/index.ts", line: 1 },
        { from: "src/d.ts", specifier: "@scope/pkg", to: null, line: 2 }
      ],
      truncated: false,
      availability: "ready",
      indexedWorktreeDigest: WORKTREE_DIGEST,
      importNodeCount: 5,
      importNodeLimit: CODEGRAPH_IMPORT_NODE_READ_LIMIT,
      importNodeLimitExceeded: false
    });
    if (spy) {
      // The spy saw the provider enumeration, so an absent status, diff or CodeGraph run is a real absence.
      expect(commands.some((command) => command.startsWith("git ls-files"))).toBe(true);
      expect(commands.filter((command) => /^git (status|diff)\b/.test(command) || command.startsWith("codegraph"))).toEqual([]);
    }
  });
});

/**
 * A `git` first on PATH that logs each command and runs the real one, and a `codegraph` that logs
 * and fails, so any CodeGraph command a read starts is both visible and refused. POSIX only.
 */
function commandSpy(): { commands(): string[]; restore(): void } {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-command-spy-")));
  const log = join(dir, "commands.log");
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  writeFileSync(log, "");
  writeFileSync(join(dir, "git"), `#!/bin/sh\nprintf 'git %s\\n' "$*" >> '${log}'\nexec '${real}' "$@"\n`);
  writeFileSync(join(dir, "codegraph"), `#!/bin/sh\nprintf 'codegraph %s\\n' "$*" >> '${log}'\nexit 1\n`);
  chmodSync(join(dir, "git"), 0o755);
  chmodSync(join(dir, "codegraph"), 0o755);
  const previous = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${previous ?? ""}`;
  return {
    // `-C <dir>` is a location, not the command.
    commands: () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => line.replace(/^git -C \S+ /, "git ")),
    restore: () => {
      process.env.PATH = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
