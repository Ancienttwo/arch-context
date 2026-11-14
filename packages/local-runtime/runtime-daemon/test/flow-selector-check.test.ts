import { expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { failureIssues } from "@archcontext/contracts";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { runFlowSelectorCheckCommand } from "../src/flow-selector-check";
import { gitCommandsOutsideCodeFactsRead, gitSpy } from "../../codegraph-adapter/test/git-spy";
import { incompleteCodeGraphFixture, indexCodeGraphFixture } from "../../codegraph-adapter/test/real-index";

function fixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-flows-readonly-")));
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "pipe" });
  // Auto-maintenance detaches after a commit and churns objects/maintenance.lock while snapshot() walks .git.
  for (const [key, value] of [["gc.auto", "0"], ["maintenance.auto", "false"]]) execFileSync("git", ["config", key, value!], { cwd: root, stdio: "pipe" });
  writeFileSync(join(root, ".gitignore"), ".codegraph/\n");
  initializeArchContextModel(root, "Read-only flows");
  writeFileSync(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"), JSON.stringify({
    schemaVersion: "archcontext.node/v2", id: "capability.architecture.context", kind: "capability", name: "Read-only flows", status: "active", summary: "Prove entry calls render.",
    source: { include: ["src/**"], entrypoints: [{ id: "entrypoint.main", path: "src/main.ts", symbols: [{
      name: "entry", sinks: [{ id: "sink.render", path: "src/render.ts", symbol: "render" }]
    }] }] }
  }));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/main.ts"), 'import { render } from "./render";\nexport function entry() { return render(); }\n');
  const commit = (message: string) => {
    execFileSync("git", ["add", "-A"], { cwd: root, stdio: "pipe" });
    execFileSync("git", ["-c", "user.name=Flows Test", "-c", "user.email=flows@example.test", "commit", "-qm", message], { cwd: root, stdio: "pipe" });
  };
  writeFileSync(join(root, "src/render.ts"), 'export function render() { return "draft"; }\n');
  commit("draft");
  writeFileSync(join(root, "src/render.ts"), 'export function render() { return "result"; }\n');
  commit("result");
  return root;
}

/**
 * ADR-0058 Decision 4: a read may add SQLite's shared-memory file and an empty WAL to `.codegraph/`,
 * and nothing else. Adding them changes only that directory's own stat.
 */
function snapshot(root: string): unknown[] {
  return readdirSync(root).sort().filter(name => {
    const path = join(root, name);
    return name !== "codegraph.db-shm" && !(name === "codegraph.db-wal" && statSync(path).size === 0);
  }).map(name => {
    const path = join(root, name);
    const stat = statSync(path, { bigint: true });
    if (name === ".codegraph" && stat.isDirectory()) return [name, snapshot(path)];
    return [name, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.isDirectory() ? snapshot(path) : readFileSync(path).toString("base64")];
  });
}

for (const state of ["missing", "incomplete", "ready", "stale", "foreign", "unopenable"] as const) {
  test(`no-sync preserves original checkout and index for ${state}`, async () => {
    const root = fixture();
    let other: string | undefined;
    try {
      if (state === "unopenable") {
        mkdirSync(join(root, ".codegraph"));
        writeFileSync(join(root, ".codegraph/codegraph.db"), "not a sqlite database\n");
      } else if (state !== "missing") {
        if (state === "incomplete") incompleteCodeGraphFixture(root);
        else indexCodeGraphFixture(root);
        Bun.gc(true);
      }
      if (state === "stale") writeFileSync(join(root, "src/render.ts"), 'export function render() { return "changed"; }\n');
      if (state === "foreign") {
        other = fixture();
        symlinkSync(join(root, ".codegraph"), join(other, ".codegraph"), process.platform === "win32" ? "junction" : "dir");
      }
      const target = other ?? root;
      const before = snapshot(target);
      const result = runFlowSelectorCheckCommand(target, { noSync: true });
      if (state === "ready") {
        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({ selectors: [{ status: "proven" }] });
        // The dev launcher, so the CLI process loads the same SQLite library as this one (#574).
        const cli = fileURLToPath(new URL("../../../surfaces/cli/bin/archctx", import.meta.url));
        const spy = process.platform === "win32" ? undefined : gitSpy();
        try {
          const output = execFileSync(process.execPath, [cli, "flows", "check", "--no-sync", "--json"], { cwd: target, encoding: "utf8", env: spy?.env ?? process.env });
          expect(JSON.parse(output)).toEqual(result);
          if (spy) {
            // No `status`, `diff`, `check-attr` or other `config`: the read runs no filter and refreshes no index.
            expect(spy.subcommands().some(command => command.startsWith("ls-files"))).toBe(true);
            expect(gitCommandsOutsideCodeFactsRead(spy.subcommands())).toEqual([]);
          }
        } finally { spy?.restore(); }
        expect(runFlowSelectorCheckCommand(target, { noSync: true })).toEqual(result);
      } else {
        expect(result).toMatchObject({ ok: false, error: { code: "AC_CODE_FACTS_UNAVAILABLE", reasonCode:
          state === "missing" ? "index-missing" : state === "foreign" || state === "unopenable" ? "index-open-failed" : "code-facts-read-not-ready"
        } });
        expect(failureIssues(result.error)).toEqual([]);
      }
      expect(snapshot(target)).toEqual(before);
    } finally {
      Bun.gc(true);
      if (other) rmSync(other, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
}

test("default flow check still syncs stale code facts", async () => {
  const root = fixture();
  try {
    indexCodeGraphFixture(root);
    Bun.gc(true);
    writeFileSync(join(root, "src/render.ts"), 'export function render() { return "changed"; }\n');
    expect(runFlowSelectorCheckCommand(root, { noSync: true }).ok).toBe(false);
    // A clean tracked file whose stat no longer matches the index: any git refresh rewrites .git/index.
    utimesSync(join(root, "src/main.ts"), 1_700_000_000, 1_700_000_000);
    const gitIndex = readFileSync(join(root, ".git/index")).toString("hex");
    // The dev launcher, so the CLI process can open the index read-only under Bun on darwin (#574).
    const cli = fileURLToPath(new URL("../../../surfaces/cli/bin/archctx", import.meta.url));
    const synced = JSON.parse(execFileSync(process.execPath, [cli, "flows", "check", "--json"], { cwd: root, encoding: "utf8" }));
    expect(synced.ok).toBe(true);
    expect(readFileSync(join(root, ".git/index")).toString("hex")).toBe(gitIndex);
    expect(runFlowSelectorCheckCommand(root, { noSync: true }).ok).toBe(true);
  } finally {
    Bun.gc(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

for (const mode of ["sync", "no-sync"] as const) test(`a source edit during the selector read refuses the ${mode} flow check`, () => {
  const root = fixture();
  const { CodeGraph } = createRequire(import.meta.url)("@colbymchenry/codegraph") as typeof import("@colbymchenry/codegraph");
  const read = CodeGraph.prototype.getNodesByName;
  let edited = false;
  const spy = spyOn(CodeGraph.prototype, "getNodesByName").mockImplementation(function (this: import("@colbymchenry/codegraph").CodeGraph, name: string) {
    if (!edited) { edited = true; writeFileSync(join(root, "src/render.ts"), 'export function render() { return "edited"; }\n'); }
    return read.call(this, name);
  });
  try {
    indexCodeGraphFixture(root);
    Bun.gc(true);
    const result = runFlowSelectorCheckCommand(root, { noSync: mode === "no-sync" });
    expect(edited).toBe(true);
    expect(result.ok).toBe(false);
  } finally {
    spy.mockRestore();
    Bun.gc(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
