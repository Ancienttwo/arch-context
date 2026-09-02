import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryImportPairs } from "../src/index";

/**
 * Fake index CLI. It answers the one query shape this producer issues and fails loudly on
 * anything else, so an unexpected invocation surfaces as a failure rather than as an empty answer.
 */
function fakeCli(logPath: string): string {
  return `
import { appendFileSync } from "node:fs";
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(argv) + "\\n");
const importNodes = [
  { name: "./render", filePath: "packages/docs/src/main.ts" },
  { name: "./render", filePath: "packages/docs/src/main.ts" },
  { name: "@archcontext/contracts", filePath: "packages/docs/src/main.ts" },
  { name: "./missing-target", filePath: "packages/docs/src/render.ts" },
  { name: "../../shared/util", filePath: "packages/docs/src/render.ts" },
  { name: "./helper", filePath: "packages/other/src/index.ts" }
];
if (argv[0] === "query") {
  const limit = Number(argv[argv.indexOf("-l") + 1]);
  process.stdout.write(JSON.stringify(importNodes.slice(0, limit).map((node) => ({
    node: { id: "import:" + node.filePath + ":" + node.name, kind: "import", name: node.name, filePath: node.filePath }
  }))));
} else {
  process.stderr.write("unexpected codegraph invocation: " + JSON.stringify(argv));
  process.exit(1);
}
`;
}

function seedWorkspace(): { root: string; binary: string; log: string } {
  const root = mkdtempSync(join(tmpdir(), "archctx-module-import-pairs-"));
  mkdirSync(join(root, ".codegraph"));
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
  writeFileSync(binary, fakeCli(log));
  return { root, binary, log };
}

describe("repository-wide import pairs", () => {
  test("keeps unresolved specifiers as a null target instead of dropping the edge", () => {
    const { root, binary, log } = seedWorkspace();
    try {
      const result = repositoryImportPairs(root, binary, 100);

      expect(result.truncated).toBe(false);
      // A bare package specifier and a dangling relative specifier both resolve to nothing, but
      // the module snapshot has to report how much of its boundary is unresolved, so they stay as
      // `to: null` rather than silently disappearing. Repeated identical edges collapse to one.
      expect(result.pairs).toEqual([
        { from: "packages/docs/src/main.ts", to: null },
        { from: "packages/docs/src/main.ts", to: "packages/docs/src/render.ts" },
        { from: "packages/docs/src/render.ts", to: null },
        { from: "packages/docs/src/render.ts", to: "packages/shared/util.ts" },
        { from: "packages/other/src/index.ts", to: "packages/other/src/helper.ts" }
      ]);

      // Every file in the repository is measured: unlike the capability graphs there is no
      // footprint filter, so an edge outside any declared node is still reported.
      expect(result.pairs.some((pair) => pair.from.startsWith("packages/other/"))).toBe(true);

      const invocations = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
      expect(invocations).toHaveLength(1);
      expect(invocations[0].slice(0, 2)).toEqual(["query", "-p"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a saturated dump is reported as truncated, not as a complete edge set", () => {
    const { root, binary } = seedWorkspace();
    try {
      const result = repositoryImportPairs(root, binary, 3);
      expect(result.truncated).toBe(true);
      expect(result.pairs).toEqual([
        { from: "packages/docs/src/main.ts", to: null },
        { from: "packages/docs/src/main.ts", to: "packages/docs/src/render.ts" }
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("two runs over the same workspace return the same ordered pairs", () => {
    const { root, binary } = seedWorkspace();
    try {
      expect(JSON.stringify(repositoryImportPairs(root, binary, 100)))
        .toBe(JSON.stringify(repositoryImportPairs(root, binary, 100)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
