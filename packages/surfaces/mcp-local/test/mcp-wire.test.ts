import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EmptyResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { runStdioMcpLoop } from "../src/index";

test("issue #174: official MCP SDK negotiates, lists schemas, calls tools and receives protocol errors", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("./fixtures/stdio-server.ts", import.meta.url))], stderr: "pipe" });
  const client = new Client({ name: "archctx-contract-test", version: "1" });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  let stage = "initialize";
  try {
    await client.connect(transport, { timeout: 10_000 });
    stage = "list tools";
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(6);
    for (const tool of tools) expect(tool.inputSchema.type).toBe("object");
    stage = "call tools";
    const result = await client.callTool({ name: "archcontext_practices", arguments: { root: "/fixture" } });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ ok: true, requestId: "practices", data: { practices: [] } }) }]);
    const denied = await client.callTool({ name: "archcontext_apply_update", arguments: { root: "/fixture", id: "test", expectedWorktreeDigest: "digest", approved: false } });
    expect(denied.isError).toBe(true);
    await expect(client.callTool({ name: "archcontext_practices", arguments: { root: 42 } })).rejects.toMatchObject({ code: -32602 });
    await expect(client.callTool({ name: "missing", arguments: {} })).rejects.toMatchObject({ code: -32602 });
    await expect(client.request({ method: "unknown/method" }, EmptyResultSchema)).rejects.toMatchObject({ code: -32601 });
    stage = "ping";
    expect(await client.ping()).toEqual({});
  } catch (error) {
    throw new Error(`MCP SDK ${stage} failed: ${String(error)}; server stderr: ${stderr}`);
  } finally {
    await client.close();
  }
}, process.platform === "win32" ? 60_000 : 15_000);

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
