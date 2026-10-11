import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeModel } from "@archcontext/core/projection-engine";
import { packagedCodeGraphCliInvocation, prepareProjectionCodeFacts } from "../src/index";

// 52 files x 100 imports: more import nodes than the former fixed 5000-node read.
const FILE_COUNT = 52;
const IMPORTS_PER_FILE = 100;
// Each file imports every other file, so the distinct edges are FILE_COUNT x (FILE_COUNT - 1).
const EDGE_COUNT = FILE_COUNT * (FILE_COUNT - 1);
const SOURCE_TREE_DIGEST = `sha256:${"2".repeat(64)}`;

const model: NativeModel = {
  nodes: [{ id: "capability.import-limit", kind: "capability", name: "Import Limit", source: { include: ["src/**"] } }],
  relations: []
};

let root = "";

/** A committed repository indexed by the packaged CodeGraph CLI, with 5200 import nodes. */
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "archctx-capability-import-limit-"));
  mkdirSync(join(root, "src"), { recursive: true });
  for (let file = 0; file < FILE_COUNT; file += 1) {
    const lines: string[] = [];
    for (let line = 0; line < IMPORTS_PER_FILE; line += 1) {
      const target = (file + 1 + (line % (FILE_COUNT - 1))) % FILE_COUNT;
      lines.push(`import { value${target} as imported${line} } from "./file-${target}";`);
    }
    lines.push(`export const value${file} = ${file};`);
    writeFileSync(join(root, `src/file-${file}.ts`), `${lines.join("\n")}\n`, "utf8");
  }
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "-c", "commit.gpgsign=false", ...args], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  const invocation = packagedCodeGraphCliInvocation();
  execFileSync(invocation.command, [...invocation.argsPrefix, "init", root], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}, 300_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("docs projection import graphs over an index with more than 5000 import nodes", () => {
  test("a complete index gives a complete import graph", () => {
    const prepared = prepareProjectionCodeFacts(root, model, { sourceTreeDigest: SOURCE_TREE_DIGEST });
    expect(prepared.handshake.availability).toBe("ready");
    expect(prepared.importGraphs).toHaveLength(1);
    const graph = prepared.importGraphs[0];
    expect(graph.truncated).toBe(false);
    expect(graph.importNodeLimitExceeded).toBeUndefined();
    expect(graph.edges).toHaveLength(EDGE_COUNT);
  }, 120_000);

  test("a limit below the import count is reported as the limit, not as truncation", () => {
    const prepared = prepareProjectionCodeFacts(root, model, { sourceTreeDigest: SOURCE_TREE_DIGEST, importNodeLimit: 1000 });
    const graph = prepared.importGraphs[0];
    expect(graph.importNodeLimitExceeded).toBe(true);
    expect(graph.truncated).toBe(false);
    expect(graph.edges.length).toBeLessThan(EDGE_COUNT);
  }, 120_000);
});
