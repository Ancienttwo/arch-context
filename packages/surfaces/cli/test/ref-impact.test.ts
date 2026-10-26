import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runRefImpactCommand } from "../src/ref-impact";
import { runCli } from "../src/main";
import { type RefImpactV1 } from "@archcontext/contracts";
import { createNativeFixture, commitFixture, writeFixtureFile } from "../../../local-runtime/model-store-yaml/test/fixtures/native-context/fixture";

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
