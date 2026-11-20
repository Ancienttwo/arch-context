import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProjectionSliceV1 } from "@archcontext/contracts";
import { indexCodeGraphFixture } from "../../codegraph-adapter/test/real-index";
import { runProjectionSliceCommand } from "../src/projection-service";

const componentPath = ".archcontext/model/nodes/component.worker.yaml";
const sourcePath = "src/worker.ts";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "archctx-projection-slice-"));
  roots.push(root);
  const git = (...args: string[]) => execFileSync("git", [
    "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "-c", "commit.gpgsign=false", ...args
  ], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const put = (path: string, body: object | string) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
  };
  const commit = (message: string) => {
    git("add", ".");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  const component = { schemaVersion: "archcontext.node/v2", id: "component.worker", name: "Worker", kind: "component", parent: "capability.example" };
  const withEntrypoint = () => put(componentPath, { ...component, source: { entrypoints: [{
    id: "entrypoint.work", path: sourcePath, symbols: [{ name: "work", sinks: [{ id: "sink.finish", path: sourcePath, symbol: "finish" }] }]
  }] } });
  git("init", "-q");
  put(".gitignore", ".codegraph/\n");
  put(".archcontext/model/nodes/capability.example.yaml", {
    schemaVersion: "archcontext.node/v2", id: "capability.example", name: "Example", kind: "capability", source: { include: ["src/**"] }
  });
  put(componentPath, component);
  put(".archcontext/model/relations/relation.dispatch.yaml", {
    id: "relation.dispatch", kind: "uses", source: "capability.example", target: "component.worker", intent: "dispatches"
  });
  put(sourcePath, "export function finish() { return 1; }\nexport function work() { return finish(); }\n");
  const mergeBase = commit("baseline");
  return { root, git, put, commit, mergeBase, withEntrypoint };
}

/** Include ignored files and Git metadata so a cache, an index refresh, or an output write is visible. */
function snapshot(root: string) {
  return (readdirSync(root, { recursive: true }) as string[]).sort().map((path) => {
    const file = join(root, path);
    const stat = statSync(file);
    const digest = stat.isFile() ? createHash("sha256").update(readFileSync(file)).digest("hex") : null;
    return { path, mtime: stat.mtimeMs, digest };
  });
}

test("uses the merge base for both changed paths and render equivalence on a diverged branch", () => {
  const { root, git, put, commit, mergeBase, withEntrypoint } = fixture();
  git("checkout", "-qb", "base-tip");
  withEntrypoint();
  put("base-only.txt", "base only\n");
  const baseSha = commit("base independently adds the entrypoint");
  git("checkout", "-qb", "pr-head", mergeBase);
  withEntrypoint();
  const headSha = commit("PR adds the same entrypoint");
  indexCodeGraphFixture(root);
  const before = snapshot(root);

  const result = runProjectionSliceCommand({ cwd: root, base: "base-tip", changedPaths: [sourcePath, sourcePath] });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const data = result.data as unknown as ProjectionSliceV1;
  expect(data).toMatchObject({ baseSha, mergeBase, headSha, changed: true, changedPaths: [componentPath, sourcePath] });
  expect(data.affectedCapabilities).toHaveLength(1);
  expect(data.affectedCapabilities[0]).toMatchObject({ capabilityId: "capability.example", entrypoints: [{ nodeId: "component.worker", entrypointId: "entrypoint.work", path: sourcePath, symbol: "work" }] });
  expect(data.affectedCapabilities[0]?.diagramMermaid).toMatch(/class p1_component_worker_[a-f0-9]{8} target/);
  expect(snapshot(root)).toEqual(before);
}, 90_000);

test("a source change and untracked model file leave the committed slice equivalent", () => {
  const { root, put, commit, mergeBase } = fixture();
  put(sourcePath, "export function work() { return 2; }\n");
  const headSha = commit("edit implementation inside the capability footprint");
  const untracked = ".archcontext/model/nodes/component.untracked.yaml";
  put(untracked, { schemaVersion: "archcontext.node/v2", id: "component.untracked", name: "Untracked", kind: "component", parent: "capability.example" });
  indexCodeGraphFixture(root);
  const before = snapshot(root);
  const result = runProjectionSliceCommand({ cwd: root, base: mergeBase, changedPaths: [untracked] });
  expect(result).toMatchObject({ ok: true, data: { headSha, mergeBase, changed: false, changedPaths: [untracked, sourcePath], affectedCapabilities: [], markdown: "## Architecture slice\n\nArchitecture slice unchanged\n" } });
  expect(snapshot(root)).toEqual(before);
}, 90_000);

test("rejects unstaged and staged tracked model changes even with a path override", () => {
  const { root, git, mergeBase, withEntrypoint } = fixture();
  withEntrypoint();
  const input = { cwd: root, base: mergeBase, changedPaths: [sourcePath] };
  const expected = { ok: false, error: { code: "AC_PRECONDITION_FAILED", reasonCode: "projection-slice-worktree-dirty" } };
  expect(runProjectionSliceCommand(input)).toMatchObject(expected);
  git("add", componentPath);
  expect(runProjectionSliceCommand(input)).toMatchObject(expected);
}, 30_000);

test("fails closed for missing and stale CodeGraph facts in a clean tracked worktree", () => {
  const { root, put, commit, mergeBase } = fixture();
  const input = { cwd: root, base: mergeBase, changedPaths: [] };
  const absent = snapshot(root);
  expect(runProjectionSliceCommand(input)).toMatchObject({ ok: false, error: { code: "AC_CODE_FACTS_UNAVAILABLE", reasonCode: "index-missing" } });
  expect(snapshot(root)).toEqual(absent);

  indexCodeGraphFixture(root);
  put(sourcePath, "export function work() { return 2; }\n");
  commit("move beyond the indexed contents");
  const stale = snapshot(root);
  expect(runProjectionSliceCommand(input)).toMatchObject({ ok: false, error: {
    code: "AC_CODE_FACTS_UNAVAILABLE", reasonCode: "code-facts-read-not-ready", details: { issues: [expect.objectContaining({ code: "pending-source-changes" })] }
  } });
  expect(snapshot(root)).toEqual(stale);
}, 90_000);
