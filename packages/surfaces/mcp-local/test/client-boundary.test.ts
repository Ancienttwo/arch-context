import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("MCP and its RPC client exclude daemon and SQLite implementations from their runtime imports", async () => {
  const result = await Bun.build({
    entrypoints: [
      resolve(import.meta.dir, "../src/index.ts"),
      resolve(import.meta.dir, "../../../local-runtime/runtime-daemon/src/rpc-client-entry.ts")
    ],
    target: "bun",
    metafile: true
  });
  expect(result.success).toBe(true);
  expect(result.metafile).toBeDefined();
  const inputs = Object.keys(result.metafile!.inputs).map(path => path.replaceAll("\\", "/"));
  expect(inputs.some(path => path.endsWith("runtime-daemon/src/rpc-client.ts"))).toBe(true);
  expect(inputs.some(path => path.endsWith("runtime-state-paths/src/index.ts"))).toBe(true);
  expect(inputs.filter(path => path.includes("local-store-sqlite/") || path.endsWith("runtime-daemon/src/index.ts"))).toEqual([]);
});
