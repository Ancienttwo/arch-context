import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { runRefImpactCommand } from "../src/ref-impact";
import { runCli } from "../src/main";
import { createNativeFixture, commitFixture, writeFixtureFile } from "../../../local-runtime/model-store-yaml/test/fixtures/native-context/fixture";

describe("impact CLI", () => {
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
