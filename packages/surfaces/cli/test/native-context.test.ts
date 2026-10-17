import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { NATIVE_CONTEXT_LIMITS, NativeContextError } from "@archcontext/contracts";
import { runCli } from "../src/main";
import { runNativeContextCommand } from "../src/native-context";
import { commitFixture, createNativeFixture, fixtureModel, writeFixtureFile } from "../../../local-runtime/model-store-yaml/test/fixtures/native-context/fixture";
const forbiddenReader = () => { throw new Error("argument preflight performed a read"); };
describe("native export CLI", () => {
  test.each(["ref", "worktree"])("%s schema failures print the parsed source path through the real CLI", source => {
    const fixture = createNativeFixture();
    try {
      const path = ".archcontext/model/flows/flow.demo.primary.yaml";
      writeFixtureFile(fixture.root, path, JSON.stringify({ ...fixtureModel().flows[0]!, id: "flow.Module.primary" }));
      const ref = commitFixture(fixture.root);
      const selector = source === "ref" ? ["--ref", ref] : ["--worktree"];
      let caught: any;
      try { execFileSync(process.execPath, [join(import.meta.dir, "../src/main.ts"), "export", "native", ...selector, "--json"], { cwd: fixture.root, encoding: "utf8", stdio: "pipe" }); }
      catch (error) { caught = error; }
      expect(caught?.status).toBe(1);
      const result = JSON.parse(String(caught.stdout));
      expect(result.error).toMatchObject({ code: "AC_SCHEMA_INVALID", reasonCode: "native-context-model-invalid", details: { path, issues: [{ entityId: "flow.Module.primary", field: "$.id", path }] } });
      expect(String(caught.stdout)).not.toContain(fixture.root);
    } finally { fixture.cleanup(); }
  });
  test("failure diagnostics cannot amplify a long identifier past the rendered response limit", () => {
    const entityId = `module.demo.${"a".repeat(2_100_000)}`;
    const result = runNativeContextCommand(["--worktree"], "/missing/repo", () => { throw new NativeContextError("native-context-model-invalid", { issues: Array.from({ length: 32 }, (_, index) => ({ entityId, field: `unknown${index}`, invariant: "unknown-property" })) }); });
    expect(result.ok).toBe(false); expect(result.error!.reasonCode).toBe("native-context-model-invalid");
    expect(result.error!.details!.omittedDiagnosticCharacters).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(result, null, 2) + "\n")).toBeLessThan(NATIVE_CONTEXT_LIMITS.responseBytes);
  });
  test.each([
    [], ["--json"], ["--worktree", "--ref", "HEAD"], ["--worktree", "--worktree"], ["--ref", "HEAD", "--ref", "HEAD"],
    ["--ref"], ["--profile"], ["--format"], ["--worktree", "--profile", "other/v1"], ["--worktree", "--format", "yaml"],
    ["--worktree", "--unknown"], ["--worktree", "extra"], ["--worktree", "--json", "--json"], ["--ref", "bad ref"],
    ["--ref", "HEAD", "--format", "json", "--format", "json"]
  ].map(args => [args] as const))("invalid args %j are typed and read-free", args => {
    const result = runNativeContextCommand(args, "/missing/repo", forbiddenReader);
    expect(result.ok).toBe(false); expect(result.requestId).toBe("export.native");
    expect(result.error!.reasonCode).not.toBe("native-context-input-unreadable");
    expect(result.error!.retryable).toBe(false);
  });
  test("help is read-free even outside a repository", async () => {
    expect(runNativeContextCommand(["--help"], "/missing/repo", forbiddenReader).ok).toBe(true);
    expect((await runCli("export", ["native", "--help"], "/missing/repo")).ok).toBe(true);
  });
  test("json aliases and default repo-harness profile return identical envelopes", () => {
    const fixture = createNativeFixture();
    try {
      const plain = runNativeContextCommand(["--ref", "HEAD"], fixture.root);
      expect(plain.ok).toBe(true);
      expect(runNativeContextCommand(["--ref", "HEAD", "--json"], fixture.root)).toEqual(plain);
      expect(runNativeContextCommand(["--ref", "HEAD", "--profile", "repo-harness/v1", "--format", "json"], fixture.root)).toEqual(plain);
    } finally { fixture.cleanup(); }
  });
  test("native bypasses throwing runtime and CodeGraph dependencies", async () => {
    const fixture = createNativeFixture();
    const deps = new Proxy({}, { get: () => { throw new Error("native accessed a runtime dependency"); } });
    try { expect((await runCli("export", ["native", "--worktree"], fixture.root, deps)).ok).toBe(true); }
    finally { fixture.cleanup(); }
  });
  test("legacy diagram command keeps its dispatch and selector-free behavior", async () => {
    const fixture = createNativeFixture();
    try { const result = await runCli("export", ["mermaid"], fixture.root); expect(result.requestId).toBe("export"); expect(result.ok).toBe(true); }
    finally { fixture.cleanup(); }
  });
  test("invalid --format still emits a JSON error through the real CLI process", () => {
    const bin = join(import.meta.dir, "../src/main.ts");
    const result = execFileSync(process.execPath, [bin, "export", "native", "--help"], { cwd: import.meta.dir, encoding: "utf8" });
    expect(JSON.parse(result).ok).toBe(true);
    try { execFileSync(process.execPath, [bin, "export", "native", "--worktree", "--format", "yaml"], { cwd: import.meta.dir, encoding: "utf8" }); throw new Error("expected exit 1"); }
    catch (error) { const result = JSON.parse(String((error as any).stdout)); expect(result.ok).toBe(false); expect(result.requestId).toBe("export.native"); expect((error as any).status).toBe(1); }
  });
});
