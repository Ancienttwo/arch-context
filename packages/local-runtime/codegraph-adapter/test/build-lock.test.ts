import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRepositoryCodeFacts, REQUIRED_CODEGRAPH_VERSION } from "../src/index";

/**
 * A CodeGraph build holds `.codegraph/codegraph.lock` for its whole run. `codegraph status` is not
 * a read there: the provider opens the live database writable and repairs the indexes a bulk build
 * dropped, which fails the build with `database is locked` (#426). These tests pin that the
 * readiness probe does not start a `status` process while the lock is held, and that it does once
 * the lock is stale.
 */
function fixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-codegraph-build-lock-")));
  mkdirSync(join(root, ".codegraph"));
  writeFileSync(join(root, ".codegraph", "codegraph.db"), "");
  const calls = join(root, "calls.log");
  const statusPath = join(root, "status.json");
  writeFileSync(statusPath, JSON.stringify({
    initialized: true,
    version: REQUIRED_CODEGRAPH_VERSION,
    projectPath: root,
    pendingChanges: { added: 0, modified: 0, removed: 0 },
    worktreeMismatch: null,
    index: {
      builtWithVersion: REQUIRED_CODEGRAPH_VERSION,
      builtWithExtractionVersion: 24,
      currentExtractionVersion: 24,
      reindexRecommended: false,
      state: "complete",
      pendingRefs: 0
    }
  }));
  const binary = join(root, "codegraph-fixture.cjs");
  writeFileSync(binary, `
const { appendFileSync, readFileSync } = require("node:fs");
const command = process.argv[2];
appendFileSync(${JSON.stringify(calls)}, command + "\\n");
if (command === "--version") console.log(${JSON.stringify(REQUIRED_CODEGRAPH_VERSION)});
else if (command === "status") process.stdout.write(readFileSync(${JSON.stringify(statusPath)}, "utf8"));
else process.exit(1);
`);
  const lock = (pid: number) => writeFileSync(join(root, ".codegraph", "codegraph.lock"), String(pid));
  return { root, calls, binary, lock, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function deadPid(): number {
  return spawnSync(process.execPath, ["-e", "0"]).pid ?? 0;
}

test("a live provider build lock suppresses the writable status probe", () => {
  const input = fixture();
  try {
    input.lock(process.pid);
    const facts = inspectRepositoryCodeFacts(input.root, { binary: input.binary });
    expect(facts).toMatchObject({
      state: "not-ready",
      indexPresent: true,
      indexBuiltWithVersion: null,
      indexState: null,
      reindexRecommended: null,
      pendingRefs: null,
      pendingChanges: null
    });
    expect("issues" in facts ? facts.issues.map(issue => issue.code) : []).toEqual(["index-incomplete"]);
    // Only the version probe ran: no process opened the live database.
    expect(readFileSync(input.calls, "utf8")).toBe("--version\n");
  } finally { input.cleanup(); }
});

test("a stale provider build lock does not suppress the status probe", () => {
  const input = fixture();
  try {
    input.lock(deadPid());
    const facts = inspectRepositoryCodeFacts(input.root, { binary: input.binary });
    expect(facts).toMatchObject({ state: "ready", indexState: "complete", pendingRefs: 0 });
    expect(readFileSync(input.calls, "utf8")).toBe("--version\nstatus\n");
  } finally { input.cleanup(); }
});

test("a malformed provider build lock does not suppress the status probe", () => {
  const input = fixture();
  try {
    writeFileSync(join(input.root, ".codegraph", "codegraph.lock"), "not-a-pid");
    const facts = inspectRepositoryCodeFacts(input.root, { binary: input.binary });
    expect(facts).toMatchObject({ state: "ready" });
    expect(readFileSync(input.calls, "utf8")).toBe("--version\nstatus\n");
  } finally { input.cleanup(); }
});
