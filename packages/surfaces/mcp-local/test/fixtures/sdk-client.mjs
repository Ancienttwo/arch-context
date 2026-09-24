import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EmptyResultSchema } from "@modelcontextprotocol/sdk/types.js";

const transport = new StdioClientTransport({
  command: process.argv[2],
  args: [fileURLToPath(new URL("./stdio-server.ts", import.meta.url))],
  stderr: "inherit"
});
const client = new Client({ name: "archctx-contract-test", version: "1" });
try {
  await client.connect(transport, { timeout: 10_000 });
  const { tools } = await client.listTools();
  assert.equal(tools.length, 6);
  for (const tool of tools) assert.equal(tool.inputSchema.type, "object");
  const result = await client.callTool({ name: "archcontext_practices", arguments: { root: "/fixture" } });
  assert.equal(result.isError, false);
  assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify({ ok: true, requestId: "practices", data: { practices: [] } }) }]);
  const denied = await client.callTool({ name: "archcontext_apply_update", arguments: { root: "/fixture", id: "test", expectedWorktreeDigest: "digest", approved: false } });
  assert.equal(denied.isError, true);
  await assert.rejects(client.callTool({ name: "archcontext_practices", arguments: { root: 42 } }), { code: -32602 });
  await assert.rejects(client.callTool({ name: "missing", arguments: {} }), { code: -32602 });
  await assert.rejects(client.request({ method: "unknown/method" }, EmptyResultSchema), { code: -32601 });
  assert.deepEqual(await client.ping(), {});
  process.stdout.write("SDK protocol assertions passed\n");
} finally {
  await client.close();
}
