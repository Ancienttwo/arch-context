import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProjectionSliceV1 } from "@archcontext/contracts";
import { publishedSchemaIssues } from "../../../contracts/test/published-schemas";
import { indexCodeGraphFixture } from "../../../local-runtime/codegraph-adapter/test/real-index";
import { runCli } from "../src/main";

let root: string;
let base: string;
let head: string;
const componentPath = ".archcontext/model/nodes/component.worker.yaml";
const cli = join(import.meta.dir, "../bin/archctx");

function git(...args: string[]): string {
  return execFileSync("git", [
    "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "-c", "commit.gpgsign=false", ...args
  ], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function put(path: string, body: object | string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "archctx-cli-projection-slice-"));
  const capabilityId = "capability.example";
  const component = { schemaVersion: "archcontext.node/v2", id: "component.worker", kind: "component", name: "Worker", parent: capabilityId };
  git("init", "-q");
  put(".gitignore", ".codegraph/\n");
  put(".archcontext/model/nodes/capability.example.yaml", { schemaVersion: "archcontext.node/v2", id: capabilityId, kind: "capability", name: "Example" });
  put(componentPath, component);
  put(".archcontext/model/relations/relation.work.yaml", { id: "relation.work", kind: "uses", source: capabilityId, target: component.id, intent: "dispatches" });
  put("src/worker.ts", "export function finish() { return 1; }\nexport function work() { return finish(); }\n");
  git("add", ".");
  git("commit", "-qm", "baseline");
  base = git("rev-parse", "HEAD");
  put(componentPath, { ...component, source: { entrypoints: [{
    id: "entrypoint.work", path: "src/worker.ts", symbols: [{ name: "work", sinks: [{ id: "sink.finish", path: "src/worker.ts", symbol: "finish" }] }]
  }] } });
  git("add", ".");
  git("commit", "-qm", "declare worker entrypoint");
  head = git("rev-parse", "HEAD");
  indexCodeGraphFixture(root);
}, 90_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function slice(...args: string[]): ProjectionSliceV1 {
  const result = spawnSync(process.execPath, [cli, "projection", "slice", ...args], { cwd: root, encoding: "utf8", timeout: 30_000 });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const envelope = JSON.parse(result.stdout);
  expect(envelope.ok).toBe(true);
  expect(publishedSchemaIssues("runtime/projection-slice.schema.json", envelope.data)).toEqual([]);
  return envelope.data;
}

test("projection slice emits a schema-valid JSON envelope and prints the same excerpt in markdown mode", () => {
  const data = slice("--base", base);
  expect(data).toEqual(slice("--base", base, "--format", "json", "--json"));
  expect(data).toMatchObject({ baseSha: base, mergeBase: base, headSha: head, changed: true, changedPaths: [componentPath] });
  expect(data.affectedCapabilities).toHaveLength(1);
  const capability = data.affectedCapabilities[0]!;
  expect(capability.diagramMermaid).toContain("classDef target fill:#FFF4D6,stroke:#B42318,stroke-width:2px,color:#5C3D0A");
  expect(capability.markdown).toContain("`entrypoint.work` | `src/worker.ts#work`");
  const markdown = spawnSync(process.execPath, [cli, "projection", "slice", "--base", base, "--format", "markdown"], { cwd: root, encoding: "utf8", timeout: 30_000 });
  expect(markdown.status, markdown.stderr).toBe(0);
  expect(markdown.stdout).toBe(data.markdown);
  expect(slice("--base", head)).toMatchObject({ changed: false, affectedCapabilities: [], changedPaths: [] });
}, 90_000);

test("projection slice refuses invalid options and preserves JSON errors in markdown mode", async () => {
  for (const args of [["--format", "human"], ["--base", base], ["--changed-path", "../outside"], ["unexpected"]]) {
    expect(await runCli("projection", ["slice", "--base", base, ...args], root)).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
  }
  const invalid = spawnSync(process.execPath, [cli, "projection", "slice", "--base", "missing-base", "--format", "markdown"], { cwd: root, encoding: "utf8", timeout: 30_000 });
  expect(invalid.status).toBe(1);
  expect(JSON.parse(invalid.stdout)).toMatchObject({ ok: false, error: { code: "AC_PRECONDITION_FAILED", reasonCode: "projection-slice-base-unresolved" } });
}, 90_000);
