import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runRefImpactCommand } from "../src/ref-impact";
import { runCli } from "../src/main";
import { type RefImpactV1 } from "@archcontext/contracts";
import { createNativeFixture, commitFixture, writeFixtureFile } from "../../../local-runtime/model-store-yaml/test/fixtures/native-context/fixture";
import { packagedCodeGraphCliInvocation } from "../../../local-runtime/codegraph-adapter/src/index";

function indexBytes(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (path: string) => {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      const name = `${path}/${entry.name}`;
      if (entry.isDirectory()) visit(name);
      else files[name] = createHash("sha256").update(readFileSync(join(root, name))).digest("hex");
    }
  };
  visit(".codegraph");
  files[".git/index"] = createHash("sha256").update(readFileSync(join(root, ".git/index"))).digest("hex");
  files[".git/HEAD"] = readFileSync(join(root, ".git/HEAD"), "utf8");
  return files;
}

test("real CLI binds CodeGraph ranges to Git blobs without touching the source index", () => {
  const fixture = createNativeFixture();
  try {
    writeFixtureFile(fixture.root, ".gitignore", ".codegraph/\n");
    writeFixtureFile(fixture.root, "src/done.ts", "export function finish() { return 1; }\n");
    const before = "import { finish } from './done';\nexport function run() {\n  return finish();\n}\n";
    writeFixtureFile(fixture.root, "src/worker.ts", before);
    const base = commitFixture(fixture.root);
    const after = before.replace("  return", "  const touched = 1;\n  void touched;\n  return");
    writeFixtureFile(fixture.root, "src/worker.ts", after);
    const head = commitFixture(fixture.root);
    const provider = packagedCodeGraphCliInvocation();
    const providerEnv = { ...process.env, DO_NOT_TRACK: "1", CODEGRAPH_NO_DOWNLOAD: "1" };
    // Index initialization is confined to this disposable test fixture.
    execFileSync(provider.command, [...provider.argsPrefix, "init", fixture.root], { cwd: fixture.root, env: providerEnv, stdio: "pipe" });
    const frozen = indexBytes(fixture.root);
    const state = join(fixture.root, "runtime-state");
    const invoke = () => execFileSync(process.execPath, [fileURLToPath(new URL("../src/main.ts", import.meta.url)), "impact", "--base", base, "--head", head, "--json"], {
      cwd: fixture.root, encoding: "utf8", env: { ...providerEnv, ARCHCONTEXT_STATE_DIR: state }, stdio: ["ignore", "pipe", "inherit"]
    });
    const bytes = invoke();
    const result = JSON.parse(bytes);
    expect(result.ok).toBe(true);
    expect(result.data.touchedFlowSteps.status).toBe("known");
    expect(result.data.touchedFlowSteps.items).toContainEqual({ flowId: "flow.demo.primary", stepId: "request", outcomeId: null, reasonCodes: ["head-lines-changed"] });
    expect(invoke()).toBe(bytes);
    expect(indexBytes(fixture.root)).toEqual(frozen);
    expect(existsSync(state)).toBe(false);
    expect(readFileSync(join(fixture.root, "src/worker.ts"), "utf8")).toBe(after);
    writeFixtureFile(fixture.root, "src/worker.ts", after + "// unsynced\n");
    const stale = JSON.parse(invoke());
    expect(stale.data.touchedFlowSteps.status).toBe("unknown");
    expect(indexBytes(fixture.root)).toEqual(frozen);
  } finally { fixture.cleanup(); }
}, 120_000);

test("real CodeGraph distinguishes ambiguous declarations from a renamed selector", () => {
  const fixture = createNativeFixture();
  try {
    writeFixtureFile(fixture.root, ".gitignore", ".codegraph/\n");
    writeFixtureFile(fixture.root, "src/done.ts", "export function finish() { return 1; }\n");
    writeFixtureFile(fixture.root, "src/worker.ts", "import { finish } from './done';\nexport function run() {\n  function run() { return finish(); }\n  return run();\n}\n");
    const head = commitFixture(fixture.root);
    const provider = packagedCodeGraphCliInvocation();
    const env = { ...process.env, DO_NOT_TRACK: "1", CODEGRAPH_NO_DOWNLOAD: "1" };
    execFileSync(provider.command, [...provider.argsPrefix, "init", fixture.root], { cwd: fixture.root, env, stdio: "pipe" });
    const frozen = indexBytes(fixture.root);
    const invoke = (ref: string, base = ref) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("../src/main.ts", import.meta.url)), "impact", "--base", base, "--head", ref, "--json"], { cwd: fixture.root, env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
    const ambiguous = invoke(head);
    expect(ambiguous.ok).toBe(true);
    expect(ambiguous.data.touchedFlowSteps).toMatchObject({ status: "unknown", reasonCodes: ["selector-evidence-unavailable"] });
    expect(ambiguous.data.touchedFlowSteps.items).toContainEqual({ flowId: "flow.demo.primary", stepId: "request", outcomeId: null, reasonCodes: ["selector-evidence-unavailable"] });
    expect(indexBytes(fixture.root)).toEqual(frozen);
    writeFixtureFile(fixture.root, "src/worker.ts", "export function other() { return 1; }\n");
    const missingHead = commitFixture(fixture.root);
    execFileSync(provider.command, [...provider.argsPrefix, "sync", fixture.root, "--quiet"], { cwd: fixture.root, env, stdio: "pipe" });
    const frozenMissing = indexBytes(fixture.root);
    const renamed = invoke(missingHead, head);
    expect(renamed.data.touchedFlowSteps.items).toContainEqual({ flowId: "flow.demo.primary", stepId: "request", outcomeId: null, reasonCodes: ["selector-unresolved-at-head"] });
    // This index cannot attest the deleted base lines, even though the head lookup is complete.
    expect(renamed.data.touchedFlowSteps).toMatchObject({ status: "unknown", reasonCodes: ["base-code-facts-unavailable"] });
    expect(invoke(missingHead).data.touchedFlowSteps.status).toBe("known");
    expect(indexBytes(fixture.root)).toEqual(frozenMissing);
    rmSync(join(fixture.root, "src/worker.ts"));
    const deletedHead = commitFixture(fixture.root);
    execFileSync(provider.command, [...provider.argsPrefix, "sync", fixture.root, "--quiet"], { cwd: fixture.root, env, stdio: "pipe" });
    const frozenDeleted = indexBytes(fixture.root);
    const deleted = invoke(deletedHead, missingHead);
    expect(deleted.data.touchedFlowSteps.status).toBe("unknown");
    expect(deleted.data.touchedFlowSteps.items).toContainEqual({ flowId: "flow.demo.primary", stepId: "request", outcomeId: null, reasonCodes: ["selector-evidence-unavailable"] });
    expect(indexBytes(fixture.root)).toEqual(frozenDeleted);
  } finally { fixture.cleanup(); }
}, 120_000);

describe("impact CLI", () => {
  test.each(["\n", "\r\n"])("file and stdin preserve path whitespace with %j delimiters", newline => {
    const fixture = createNativeFixture();
    try {
      const paths = ["src/worker.ts", "src/worker.ts ", " src/worker.ts", "   "];
      const text = paths.join(newline) + newline + newline;
      writeFixtureFile(fixture.root, "paths.txt", text);
      const state = join(fixture.root, "runtime-state");
      const invoke = (source: string): RefImpactV1 => JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("../src/main.ts", import.meta.url)), "impact", "--paths-from", source, "--json"], { cwd: fixture.root, encoding: "utf8", input: text, env: { ...process.env, ARCHCONTEXT_STATE_DIR: state } })).data;
      for (const source of ["paths.txt", "-"]) {
        const data = invoke(source);
        expect(data.changedPaths.map(row => row.path).sort()).toEqual([...paths].sort());
        expect(data.changedPaths.find(row => row.path === "src/worker.ts")?.owners).toEqual(["component.demo.worker"]);
        expect(data.changedPaths.find(row => row.path === " src/worker.ts")?.owners).toEqual(["capability.demo.feature"]);
        for (const path of ["src/worker.ts ", "   "]) expect(data.changedPaths.find(row => row.path === path)?.owners).toEqual([]);
        expect(data.touchedFlowSteps.status).toBe("unknown");
        expect(existsSync(state)).toBe(false);
      }
    } finally { fixture.cleanup(); }
  });
  test.each([["--base", "HEAD"], ["--head", "HEAD"], ["--base", "HEAD", "--head", "HEAD", "--depth", "11"], ["--paths-from", "x", "--base", "HEAD"], ["--base", "HEAD", "--head", "HEAD", "--bogus"], ["--base", "HEAD", "--head", "HEAD", "--head", "HEAD"]].map(args => ({ args })))("rejects invalid selectors without reads: %j", ({ args }) => {
    let calls = 0;
    const result = runRefImpactCommand(args, "/absent", () => { calls++; throw new Error("must not read"); });
    expect(result.ok).toBe(false); expect(calls).toBe(0);
  });
  test("runCli routes impact before any runtime or daemon", async () => {
    const fixture = createNativeFixture();
    try {
      writeFixtureFile(fixture.root, "src/worker.ts", "export const worker = true;\n");
      const head = commitFixture(fixture.root);
      const result = await runCli("impact", ["--base", fixture.commit, "--head", head, "--json"], fixture.root, { runtimeFactory: () => { throw new Error("must not start runtime"); } } as any);
      expect(result.ok).toBe(true);
      expect((result as any).data.touchedNodes).toEqual([{ nodeId: "component.demo.worker", pathCount: 1 }]);
      expect((result as any).data.touchedFlowSteps.status).toBe("unknown");
      const bytes = execFileSync(process.execPath, [fileURLToPath(new URL("../src/main.ts", import.meta.url)), "impact", "--base", fixture.commit, "--head", head, "--json"], { cwd: fixture.root, encoding: "utf8" });
      const processResult = JSON.parse(bytes);
      expect(processResult).toEqual(result);
      const help = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("../src/main.ts", import.meta.url)), "impact", "--help", "--json"], { cwd: fixture.root, encoding: "utf8" }));
      expect(help.data.command).toBe("impact");
    } finally { fixture.cleanup(); }
  });
});
