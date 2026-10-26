import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseJsonOrStableYaml } from "@archcontext/core/architecture-domain";
import { stableYaml } from "@archcontext/contracts";
import { codeGraphCliInvocation } from "@archcontext/local-runtime/codegraph-adapter";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";

const cli = resolve(import.meta.dir, "../src/main.ts");
const root = mkdtempSync(join(tmpdir(), "archctx-constraints-cli-"));
const state = mkdtempSync(join(tmpdir(), "archctx-constraints-state-"));
const constraintPath = ".archcontext/model/constraints/constraint.layers.yaml";
const constraint = { schemaVersion: "archcontext.constraint/v1", id: "constraint.layers", severity: "error", scope: {}, rule: { type: "layer-direction" } };
const env = { ...process.env, ARCHCONTEXT_STATE_DIR: state, CODEGRAPH_TELEMETRY: "0" };
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" });
function codegraph(...args: string[]): void {
  const invocation = codeGraphCliInvocation("codegraph", root);
  execFileSync(invocation.command, [...invocation.argsPrefix, ...args], { cwd: root, env, stdio: "pipe" });
}
function write(path: string, body: string): void {
  mkdirSync(resolve(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), body);
}
function snapshot(): string {
  const files = git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean).sort();
  return JSON.stringify({ head: git("rev-parse", "HEAD"), index: readFileSync(join(root, ".git/index")).toString("hex"), files: files.map(path => [path, readFileSync(join(root, path), "utf8")]), state: readdirSync(state) });
}
function run(args = ["check", "--json"]) {
  const before = snapshot();
  const result = spawnSync("bun", [cli, "constraints", ...args], { cwd: root, env, encoding: "utf8", timeout: 60_000 });
  expect(result.error).toBeUndefined();
  expect(snapshot()).toBe(before);
  expect(readdirSync(state)).toEqual([]);
  return { status: result.status, envelope: JSON.parse(result.stdout) };
}

beforeAll(() => {
  initializeArchContextModel(root, "Constraint CLI fixture");
  const manifestPath = join(root, ".archcontext/manifest.yaml");
  const manifest = parseJsonOrStableYaml(readFileSync(manifestPath, "utf8"), ".archcontext/manifest.yaml") as { model: { layers?: string[] } };
  manifest.model.layers = ["effects", "core"];
  write(".archcontext/manifest.yaml", stableYaml(manifest));
  for (const layer of ["effects", "core"]) {
    write(`.archcontext/model/nodes/module.${layer}.yaml`, stableYaml({ schemaVersion: "archcontext.node/v2", id: `module.${layer}`, kind: "module", name: layer, status: "active", summary: layer, layer, source: { include: [`src/${layer}/**`] } }));
  }
  write(constraintPath, stableYaml(constraint));
  write("src/core/a.ts", 'import { b } from "../effects/b";\nexport const a = b;\n');
  write("src/effects/b.ts", "export const b = 1;\n");
  write(".gitignore", ".codegraph/\n");
  git("init", "-q"); git("add", "-A"); git("commit", "-qm", "fixture");
  codegraph("init", root);
}, 60_000);
afterAll(() => {
  for (const directory of [root, state]) rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("real CLI reports a layer violation and creates no runtime state", () => {
  const { status, envelope } = run();
  expect(status, JSON.stringify(envelope)).toBe(0);
  expect(envelope).toMatchObject({ ok: true, requestId: "constraints.check", data: { status: "violated", violations: [{ constraintId: "constraint.layers", fromNode: "module.core", toNode: "module.effects", fromLayer: "core", toLayer: "effects" }] } });
}, 60_000);

test("reversing the declared order passes using the same actual imports", () => {
  const path = join(root, ".archcontext/manifest.yaml");
  const before = readFileSync(path, "utf8");
  try {
    const manifest = parseJsonOrStableYaml(before, ".archcontext/manifest.yaml") as { model: { layers?: string[] } };
    manifest.model.layers = ["core", "effects"];
    writeFileSync(path, stableYaml(manifest));
    expect(run().envelope).toMatchObject({ ok: true, data: { status: "undetermined", reasonCodes: ["code-facts-unavailable"] } });
    codegraph("sync");
    const { status, envelope } = run();
    expect(status, JSON.stringify(envelope)).toBe(0);
    expect(envelope).toMatchObject({ ok: true, data: { status: "pass", violations: [] } });
  } finally { writeFileSync(path, before); }
}, 60_000);

test("invalid declarations fail closed instead of becoming no constraints", () => {
  write(constraintPath, stableYaml({ ...constraint, scope: { nodes: ["module.core"] } }));
  try {
    const { status, envelope } = run();
    expect(status).toBe(1);
    expect(envelope).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID", reasonCode: "constraint-model-invalid" } });
  } finally { write(constraintPath, stableYaml(constraint)); }
});

test("missing CodeGraph evidence remains undetermined through the actual CLI", () => {
  rmSync(join(root, ".codegraph"), { recursive: true, force: true, maxRetries: 5 });
  const { status, envelope } = run();
  expect(status, JSON.stringify(envelope)).toBe(0);
  expect(envelope).toMatchObject({ ok: true, data: { status: "undetermined", coverage: "unknown", reasonCodes: ["code-facts-unavailable"], violations: [] } });
}, 60_000);

test("help is read-only and unsupported arguments fail before evaluation", () => {
  expect(run(["--help"]).envelope.data.command).toContain("constraints check");
  expect(run(["repair"]).envelope).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
  expect(run(["check", "--bogus"]).status).toBe(1);
});
