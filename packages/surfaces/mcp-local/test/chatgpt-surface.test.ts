import { describe, expect, test } from "bun:test";
import { LocalHttpMcpServer, McpLocalServer, SecureMcpTunnelManager } from "../src/index";

describe("ChatGPT local MCP surface", () => {
  test("HTTP MCP binds loopback and shares local tool core", async () => {
    const http = new LocalHttpMcpServer();
    expect(http.bindHost).toBe("127.0.0.1");
    expect((await http.handle({ method: "GET", path: "/mcp/tools", host: "127.0.0.1" })).status).toBe(200);
    expect((await http.handle({ method: "GET", path: "/mcp/tools", host: "0.0.0.0" })).status).toBe(403);
  });

  test("ChatGPT tool list is read-only unless write mode is enabled", () => {
    const server = new McpLocalServer();
    expect(server.listChatGptTools().map((tool) => tool.name)).not.toContain("archcontext_apply_update");
    expect(server.listChatGptTools(true).map((tool) => tool.name)).toContain("archcontext_apply_update");
  });

  test("Secure MCP tunnel is opt-in, scoped, short-lived, and revocable", () => {
    const tunnel = new SecureMcpTunnelManager();
    expect(tunnel.status().enabled).toBe(false);
    const session = tunnel.start({ scopes: ["context:read"], ttlSeconds: 60, now: new Date("2026-06-19T00:00:00Z") });
    expect(session.credential).toContain("local-");
    expect(tunnel.status().enabled).toBe(true);
    expect(() => tunnel.validateScope("context:read", new Date("2026-06-19T00:00:01Z"))).not.toThrow();
    expect(() => tunnel.validateScope("changeset:apply", new Date("2026-06-19T00:00:01Z"))).toThrow("scope");
    expect(() => tunnel.validateScope("context:read", new Date("2026-06-19T00:02:00Z"))).toThrow("expired");
    tunnel.revoke();
    expect(tunnel.status().enabled).toBe(false);
  });
});
