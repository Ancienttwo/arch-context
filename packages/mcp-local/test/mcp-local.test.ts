import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeWorktreeDigest } from "@archcontext/architecture-domain";
import { initializeArchContextModel } from "@archcontext/model-store-yaml";
import { LOCAL_MCP_TOOLS, McpLocalServer, runStdioMcpLoop } from "../src/index";
import { runCli } from "@archcontext/cli";

function tempModel(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-mcp-"));
  writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
  initializeArchContextModel(root, "MCP App");
  return root;
}

describe("local MCP server", () => {
  test("exposes exactly five workflow tools with safety annotations", () => {
    expect(LOCAL_MCP_TOOLS.map((tool) => tool.name)).toEqual([
      "archcontext_prepare_task",
      "archcontext_checkpoint",
      "archcontext_plan_update",
      "archcontext_apply_update",
      "archcontext_complete_task"
    ]);
    expect(LOCAL_MCP_TOOLS.every((tool) => tool.description.length > 20)).toBe(true);
    expect(LOCAL_MCP_TOOLS.find((tool) => tool.name === "archcontext_apply_update")?.annotations).toEqual({
      safety: "destructive",
      requiresConfirmation: true
    });
  });

  test("large prepare output is returned as summary plus Resource URI", async () => {
    const root = tempModel();
    try {
      const server = new McpLocalServer();
      const result = await server.callTool("archcontext_prepare_task", {
        root,
        task: "remove legacy v1 wrapper fallback mapper with multiple lifecycle owner",
        maxBytes: 64,
        maxItems: 12
      });
      expect(result.resourceUri).toMatch(/^archcontext:\/\/resource\//);
      expect(server.readResource(result.resourceUri!)).toBeTruthy();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("apply_update requires approval and fresh digest", async () => {
    const root = tempModel();
    try {
      const server = new McpLocalServer();
      const expectedWorktreeDigest = computeWorktreeDigest(root);
      await server.callTool("archcontext_plan_update", {
        root,
        id: "changeset.mcp",
        operations: [
          {
            op: "create_entity",
            path: ".archcontext/model/nodes/module.mcp.yaml",
            expectedHash: "missing",
            body: "schemaVersion: archcontext.node/v1\nid: module.mcp\nkind: module\nname: MCP\nstatus: active\nsummary: MCP\nresponsibilities:\n- mcp\n"
          }
        ]
      });
      const denied = await server.callTool("archcontext_apply_update", { root, id: "changeset.mcp", expectedWorktreeDigest });
      expect((denied.content as any).error.code).toBe("AC_USER_CONFIRMATION_REQUIRED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("stdio loop writes protocol output and logs separately", async () => {
    const output: string[] = [];
    const logs: string[] = [];
    async function* input() {
      yield JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    }
    await runStdioMcpLoop(input(), (line) => output.push(line), (line) => logs.push(line));
    expect(output.length).toBe(1);
    expect(JSON.parse(output[0]).result.tools.length).toBe(5);
    expect(logs).toEqual(["[archctx-mcp] started"]);
  });

  test("CLI and MCP keep prepare task posture semantics aligned", async () => {
    const root = tempModel();
    try {
      const cli = await runCli("prepare", ["--task", "remove legacy v1 wrapper", "--max-items", "2"], root);
      const mcp = await new McpLocalServer().callTool("archcontext_prepare_task", {
        root,
        task: "remove legacy v1 wrapper",
        maxItems: 2,
        maxBytes: 12_288
      });
      expect((cli.data as any).posture).toBe((mcp.content as any).posture);
      expect(JSON.stringify(mcp.content)).not.toContain("sourceCode");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("session recovery and first-party skills remain SOP-only", () => {
    const recovered = new McpLocalServer().recoverSession("task_123");
    expect((recovered as any).recovered).toBe(true);
    for (const skill of ["bootstrap", "develop", "intervene", "review"]) {
      const body = readFileSync(`skills/archcontext-${skill}/SKILL.md`, "utf8");
      expect(body).toContain("SOP");
      expect(body).not.toContain("function ");
      expect(body).not.toContain("class ");
    }
  });
});
