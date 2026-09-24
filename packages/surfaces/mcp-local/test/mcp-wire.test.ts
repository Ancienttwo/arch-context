import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { runStdioMcpLoop } from "../src/index";

test("issue #174: official MCP SDK negotiates, lists schemas, calls tools and receives protocol errors", () => {
  const output = execFileSync("node", [
    fileURLToPath(new URL("./fixtures/sdk-client.mjs", import.meta.url)), process.execPath
  ], { encoding: "utf8", timeout: 30_000 });
  expect(output.trim()).toBe("SDK protocol assertions passed");
}, 35_000);

test("issue #174: malformed lines, invalid requests and invalid params leave stdio usable", async () => {
  const output: any[] = [];
  async function* input() {
    yield "{";
    yield "null";
    yield JSON.stringify({ jsonrpc: "1.0", id: 0, method: "ping" });
    yield JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    yield JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
    yield JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "archcontext_practices", arguments: [] } });
    yield JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" });
  }
  await runStdioMcpLoop(input(), (line) => output.push(JSON.parse(line)), () => {});
  expect(output.map((item) => item.error?.code ?? item.result?.protocolVersion ?? "ok")).toEqual([-32700, -32600, -32600, "2025-03-26", -32602, "ok"]);
  expect(output[0].id).toBeNull();
  expect(output.at(-1)).toEqual({ jsonrpc: "2.0", id: 3, result: {} });
});
