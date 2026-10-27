import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failureIssues } from "@archcontext/contracts";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { runFlowSelectorCheckCommand } from "../src/flow-selector-check";

const { CodeGraph } = createRequire(import.meta.url)("@colbymchenry/codegraph") as typeof import("@colbymchenry/codegraph");

function fixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-flows-readonly-")));
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "pipe" });
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
  writeFileSync(join(root, "src/render.ts"), 'export function render() { return "result"; }\n');
  return root;
}

function snapshot(root: string): unknown[] {
  return readdirSync(root).sort().map(name => {
    const path = join(root, name);
    const stat = statSync(path);
    return [name, stat.mtimeMs, stat.isDirectory() ? snapshot(path) : readFileSync(path).toString("base64")];
  });
}

for (const state of ["missing", "incomplete", "ready", "stale", "foreign"] as const) {
  test(`no-sync preserves original checkout and index for ${state}`, async () => {
    const root = fixture();
    let other: string | undefined;
    try {
      if (state !== "missing") {
        const graph = CodeGraph.initSync(root);
        try { if (state !== "incomplete") await graph.indexAll(); } finally { graph.close(); }
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
        expect(runFlowSelectorCheckCommand(target, { noSync: true })).toEqual(result);
      } else {
        expect(result).toMatchObject({ ok: false, error: { code: "AC_CODE_FACTS_UNAVAILABLE", reasonCode:
          state === "missing" ? "index-missing" : state === "foreign" ? "code-facts-snapshot-layout-unsupported" : "code-facts-read-not-ready"
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
    const graph = CodeGraph.initSync(root);
    try { await graph.indexAll(); } finally { graph.close(); }
    Bun.gc(true);
    writeFileSync(join(root, "src/render.ts"), 'export function render() { return "changed"; }\n');
    expect(runFlowSelectorCheckCommand(root, { noSync: true }).ok).toBe(false);
    expect(runFlowSelectorCheckCommand(root).ok).toBe(true);
    expect(runFlowSelectorCheckCommand(root, { noSync: true }).ok).toBe(true);
  } finally {
    Bun.gc(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
