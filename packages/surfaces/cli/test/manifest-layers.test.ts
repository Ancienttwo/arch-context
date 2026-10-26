import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import type { RuntimeDaemonClient } from "@archcontext/local-runtime/runtime-daemon";
import { runCli } from "../src/main";

test("manifest --layers uses only a mocked plan client and preserves current manifest", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-layer-cli-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    initializeArchContextModel(root, "Layers");
    const before = readFileSync(join(root, ".archcontext/manifest.yaml"), "utf8");
    let calls = 0;
    const runtimeClient = { planUpdate: async (_root: string, input: unknown) => { calls++; return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "mock", data: input }; } } as unknown as RuntimeDaemonClient;
    const result = await runCli("manifest", ["plan", "--id", "changeset.layers", "--layers", "cli,effects,core"], root, { runtimeClient });
    expect(result).toMatchObject({ ok: true, data: { operations: [{ fields: { "model.layers": ["cli", "effects", "core"] } }] } });
    expect(readFileSync(join(root, ".archcontext/manifest.yaml"), "utf8")).toBe(before);
    for (const layers of ["", "core,core", "Core", "core,"]) expect((await runCli("manifest", ["plan", "--id", "changeset.layers", "--layers", layers], root, { runtimeClient })).ok).toBe(false);
    expect(calls).toBe(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
