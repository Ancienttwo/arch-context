import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readArchitectureHistory } from "../src/architecture-history";
import { projectHistoryMermaid, renderHistoryMarkdown } from "@archcontext/core/projection-engine";
import { ARCHITECTURE_HISTORY_DERIVATION_VERSION, architectureHistoryIssues, decodeArchitectureHistory } from "@archcontext/contracts";
import { runtimeStatePaths } from "@archcontext/local-runtime/runtime-state-paths";

test("history derives valid states around errors and keeps the preceding milestone as baseRev", () => {
  const root = mkdtempSync(join(tmpdir(), "architecture-history-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const node = (id: string, kind: string, name: string, parent?: string) => JSON.stringify({ schemaVersion: "archcontext.node/v2", id, kind, name, status: "active", summary: "test", ...(parent ? { parent } : {}) });
  const write = (path: string, body: string) => writeFileSync(join(root, ".archcontext/model", path), body);
  const commit = (subject: string) => { git("add", ".archcontext"); git("commit", "-qm", subject); return git("rev-parse", "HEAD"); };
  try {
    git("init", "-q"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.test");
    mkdirSync(join(root, ".archcontext/model/nodes"), { recursive: true });
    mkdirSync(join(root, ".archcontext/model/relations"), { recursive: true });
    write("nodes/a.yaml", node("capability.one.a", "capability", "A"));
    write("nodes/b.yaml", node("capability.two.b", "capability", "B"));
    const first = commit("first");
    write("nodes/a.yaml", "invalid: ["); const invalid = commit("broken");
    write("nodes/a.yaml", "invalid: {"); commit("still broken");
    write("nodes/a.yaml", node("capability.one.a", "capability", "Renamed"));
    write("nodes/c.yaml", node("component.one.c", "component", "C", "capability.one.a"));
    write("relations/ab.yaml", JSON.stringify({ schemaVersion: "archcontext.relation/v1", id: "relation.one.ab", kind: "calls", source: "component.one.c", target: "capability.two.b", intent: "test" }));
    const changed = commit("changed");
    rmSync(join(root, ".archcontext/model/nodes/c.yaml"));
    rmSync(join(root, ".archcontext/model/relations/ab.yaml"));
    const removed = commit("removed");
    const env = { ARCHCONTEXT_STATE_DIR: join(root, "state") };
    const history = readArchitectureHistory(root, { env });
    expect(history.milestones.map(row => row.rev)).toEqual([first, invalid, changed, removed]);
    expect(history.milestones[1]).toMatchObject({ nodes: null, delta: null, error: { code: "history-model-invalid" } });
    expect(history.milestones[0]!.delta?.baseRev).toBeNull();
    expect(history.milestones[2]).toMatchObject({ delta: { baseRev: first, added: [{ id: "component.one.c", kind: "component" }], renamed: [{ id: "capability.one.a", from: "A", to: "Renamed" }], edgesChanged: { added: [{ source: "capability.one.a", target: "capability.two.b" }] } } });
    expect(history.milestones[3]).toMatchObject({ delta: { removed: [{ id: "component.one.c", kind: "component" }], edgesChanged: { removed: [{ source: "capability.one.a", target: "capability.two.b" }] } } });
    const cache = join(runtimeStatePaths(root, env).sharedCacheDir, "architecture-history", ARCHITECTURE_HISTORY_DERIVATION_VERSION, `${first}.json`);
    writeFileSync(cache, "{broken");
    expect(JSON.stringify(readArchitectureHistory(root, { env }))).toBe(JSON.stringify(history));
    const oid = git("rev-parse", `${first}:.archcontext/model/nodes/a.yaml`);
    rmSync(join(root, ".git/objects", oid.slice(0, 2), oid.slice(2)));
    expect(JSON.stringify(readArchitectureHistory(root, { env }))).toBe(JSON.stringify(history));
    expect(decodeArchitectureHistory(history)).toEqual(history);
    expect(architectureHistoryIssues({ ...history, milestones: [null] }).length).toBeGreaterThan(0);
    expect(projectHistoryMermaid(history).diagrams[1]!.mermaid).toBeNull();
    expect(renderHistoryMarkdown(history)).toContain("```mermaid\nflowchart LR");
    expect(readArchitectureHistory(root, { env, offset: 1, limit: 1 }).milestones[0]!.rev).toBe(invalid);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI --ref reproduces the bytes emitted when the selected commit was HEAD", () => {
  const root = mkdtempSync(join(tmpdir(), "history-ref-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const cli = (args: string[]) => execFileSync("bun", [join(import.meta.dir, "../../../surfaces/cli/src/main.ts"), "history", ...args, "--json"], { cwd: root, env: { ...process.env, ARCHCONTEXT_STATE_DIR: join(root, "state") }, encoding: "utf8" });
  try {
    git("init", "-q"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.test");
    mkdirSync(join(root, ".archcontext/model/nodes"), { recursive: true });
    const path = join(root, ".archcontext/model/nodes/a.yaml");
    const node = { schemaVersion: "archcontext.node/v2", id: "capability.one.a", kind: "capability", name: "A", status: "active", summary: "test" };
    writeFileSync(path, JSON.stringify(node));
    git("add", ".archcontext"); git("commit", "-qm", "first");
    const first = git("rev-parse", "HEAD"), output = cli([]);
    writeFileSync(path, JSON.stringify({ ...node, name: "Renamed" }));
    git("add", ".archcontext"); git("commit", "-qm", "next");
    expect(cli(["--ref", first])).toBe(output);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("unsupported layouts, missing nodes and shallow repositories fail with their declared reasons", () => {
  const root = mkdtempSync(join(tmpdir(), "history-errors-"));
  const repo = join(root, "repo"), clone = join(root, "clone");
  mkdirSync(join(repo, ".archcontext/model/nodes"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  try {
    git("init", "-q"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.test");
    writeFileSync(join(repo, ".archcontext/model/nodes/a.yaml"), JSON.stringify({ schemaVersion: "archcontext.node/v2", id: "capability.one.a", kind: "capability", name: "A", status: "active", summary: "test" }));
    writeFileSync(join(repo, ".archcontext/manifest.yaml"), "invalid: true\n");
    git("add", ".archcontext"); git("commit", "-qm", "unsupported");
    rmSync(join(repo, ".archcontext/model/nodes/a.yaml"));
    writeFileSync(join(repo, ".archcontext/manifest.yaml"), JSON.stringify({ schemaVersion: "archcontext.manifest/v1", model: { layout: "split", root: ".archcontext/model" } }));
    git("add", "-A"); git("commit", "-qm", "missing");
    rmSync(join(repo, ".archcontext/manifest.yaml"));
    git("add", "-A"); git("commit", "-qm", "remove context");
    const env = { ARCHCONTEXT_STATE_DIR: join(root, "state") };
    expect(readArchitectureHistory(repo, { env }).milestones.map(row => row.error?.code)).toEqual(["history-model-layout-unsupported", "history-model-missing"]);
    execFileSync("git", ["clone", "-q", "--depth=1", pathToFileURL(repo).href, clone]);
    expect(() => readArchitectureHistory(clone, { env })).toThrow("complete Git repository");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
