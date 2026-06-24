import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { ArchctxRuntimeRpcServer, RuntimeRpcClient, createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { LOCAL_MCP_TOOLS, LocalHttpMcpServer, McpLocalServer, runStdioMcpLoop } from "../src/index";
import { runCli } from "@archcontext/surfaces/cli";

function tempModel(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-mcp-"));
  writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
  initializeArchContextModel(root, "MCP App");
  return root;
}

async function createTestServer(): Promise<McpLocalServer> {
  return new McpLocalServer(await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  }));
}

function externalDocsEntry() {
  const contentDigest = `sha256:${"7".repeat(64)}`;
  const queryDigest = `sha256:${"8".repeat(64)}`;
  return {
    provider: "context7" as const,
    libraryId: "/facebook/react",
    version: "18.2.0",
    queryDigest,
    contentDigest,
    retrievedAt: "2026-06-24T00:00:00.000Z",
    expiresAt: "2026-07-24T00:00:00.000Z",
    resource: {
      schemaVersion: "archcontext.external-document/v1" as const,
      provider: "context7" as const,
      libraryId: "/facebook/react",
      requestedVersion: "18.2.0",
      resolvedVersion: "18.2.0",
      queryDigest,
      contentDigest,
      retrievedAt: "2026-06-24T00:00:00.000Z",
      expiresAt: "2026-07-24T00:00:00.000Z",
      trust: "external-unverified" as const,
      enforcement: "advisory-only" as const,
      cacheStatus: "fresh" as const,
      uri: `archcontext://external-docs/context7/${contentDigest}`,
      byteCount: 42,
      snippets: [{
        title: "React useState",
        contentPreview: "External documentation data for useState.",
        contentDigest,
        sourceUri: "https://react.dev/reference/react/useState",
        byteCount: 42
      }],
      warning: "untrusted-documentation-data" as const
    }
  };
}

function runTestCli(command: string, args: string[], root: string) {
  return runCli(command, args, root, {
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
}

describe("local MCP server", () => {
  test("exposes exactly six workflow tools with safety annotations", () => {
    expect(LOCAL_MCP_TOOLS.map((tool) => tool.name)).toEqual([
      "archcontext_prepare_task",
      "archcontext_practices",
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
      const server = await createTestServer();
      const result = await server.callTool("archcontext_prepare_task", {
        root,
        task: "remove legacy v1 wrapper fallback mapper with multiple lifecycle owner",
        maxBytes: 64,
        maxItems: 12
      });
      expect(result.resourceUri).toMatch(/^archcontext:\/\/resource\//);
      expect(await server.readResource(result.resourceUri!)).toBeTruthy();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("MCP reads Context7 external documentation resources only from the daemon cache", async () => {
    const root = tempModel();
    const store = new TestLocalStore();
    const entry = externalDocsEntry();
    await store.saveExternalDocumentation(entry);
    const daemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: store,
      clock: () => "2026-06-24T00:00:00.000Z"
    });
    try {
      await daemon.init(root, "MCP Docs App");
      const server = new McpLocalServer(daemon);
      const resources = await server.listResources(root);
      expect(resources).toContainEqual(expect.objectContaining({
        uri: entry.resource.uri,
        name: "Context7 /facebook/react@18.2.0",
        mimeType: "application/json",
        annotations: { safety: "read-only" }
      }));

      const resource = await server.readResource(entry.resource.uri, root);
      expect(resource).toMatchObject({
        schemaVersion: "archcontext.resource-read/v1",
        uri: entry.resource.uri,
        dataClassification: "external-unverified-documentation",
        resource: {
          provider: "context7",
          libraryId: "/facebook/react",
          trust: "external-unverified",
          enforcement: "advisory-only",
          cacheStatus: "fresh"
        }
      });
      expect(await server.readResource("https://example.test/context7", root)).toBeUndefined();
    } finally {
      await daemon.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("practices tool reads the daemon-resolved catalog", async () => {
    const root = tempModel();
    try {
      const server = await createTestServer();
      const result = await server.callTool("archcontext_practices", {
        root,
        action: "list",
        maxBytes: 12_288
      });
      const envelope = (result.content as any).ok === true
        ? result.content as any
        : await server.readResource((result.content as any).resourceUri, root) as any;
      if ((result.content as any).schemaVersion === "archcontext.resource-summary/v1") {
        expect((result.content as any).resourceUri).toBe(result.resourceUri);
      }
      expect(envelope.ok).toBe(true);
      expect(envelope.data.schemaVersion).toBe("archcontext.practice-list/v1");
      expect(envelope.data.practices.map((practice: any) => practice.id)).toContain("compatibility.single-owner");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("apply_update requires approval and fresh digest", async () => {
    const root = tempModel();
    try {
      const server = await createTestServer();
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

  test("complete_task rejects caller-provided review conclusion fields", async () => {
    const root = tempModel();
    const server = await createTestServer();
    try {
      const base = {
        root,
        taskSessionId: "task_mcp_review",
        posture: "normal",
        headSha: "abc123"
      };

      const accepted = await server.callTool("archcontext_complete_task", base);
      expect((accepted.content as any).ok).toBe(true);
      expect((accepted.content as any).data.schemaVersion).toBe("archcontext.review/v1");

      for (const field of ["result", "reviewDigest", "policyDigest", "modelDigest", "signature", "practiceViolations"]) {
        const result = await server.callTool("archcontext_complete_task", {
          ...base,
          [field]: field === "signature" ? { algorithm: "ed25519", value: "forged" } : "pass"
        });
        expect((result.content as any).ok, field).toBe(false);
        expect((result.content as any).error.code, field).toBe("AC_SCHEMA_INVALID");
        expect((result.content as any).error.message, field).toContain(field);
      }
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
    expect(JSON.parse(output[0]).result.tools.length).toBe(6);
    expect(logs).toEqual(["[archctx-mcp] started"]);
  });

  test("CLI and MCP keep prepare task posture semantics aligned", async () => {
    const root = tempModel();
    try {
      const cli = await runTestCli("prepare", ["--task", "remove legacy v1 wrapper", "--max-items", "2"], root);
      const server = await createTestServer();
      const mcp = await server.callTool("archcontext_prepare_task", {
        root,
        task: "remove legacy v1 wrapper",
        maxItems: 2,
        maxBytes: 12_288
      });
      expect((cli.data as any).posture).toBe((mcp.content as any).data.posture);
      expect((cli.data as any).context.practiceGuidance.catalogDigest).toBe((mcp.content as any).data.context.practiceGuidance.catalogDigest);
      expect((cli.data as any).context.practiceGuidance.matches.map((match: any) => match.practiceId)).toEqual(
        (mcp.content as any).data.context.practiceGuidance.matches.map((match: any) => match.practiceId)
      );
      const checkpoint = await server.callTool("archcontext_checkpoint", {
        root,
        taskSessionId: "task_mcp",
        event: "post-edit",
        changedPaths: ["src/example.ts"]
      });
      expect((checkpoint.content as any).ok).toBe(true);
      expect((checkpoint.content as any).data.schemaVersion).toBe("archcontext.practice-checkpoint/v1");
      expect((checkpoint.content as any).data.delta.unchanged.length).toBeGreaterThan(0);
      expect(JSON.stringify(mcp.content)).not.toContain("sourceCode");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("MCP discovers and reuses daemon RPC by repository root", async () => {
    const root = tempModel();
    const daemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: new TestLocalStore()
    });
    const rpc = new ArchctxRuntimeRpcServer(daemon, { root, port: 0, token: "mcp-rpc-token" });
    let stopped = false;
    try {
      const connection = await rpc.start();
      const server = new McpLocalServer();
      const result = await server.callTool("archcontext_prepare_task", {
        root,
        task: "remove legacy v1 wrapper",
        maxItems: 2,
        maxBytes: 12_288
      });
      expect((result.content as any).ok).toBe(true);
      const status = await new RuntimeRpcClient(connection).runtimeStatus(root);
      expect((status.data as any).sessions).toBe(1);
      expect(JSON.stringify(result.content)).not.toContain("sourceCode");
      await rpc.stop();
      stopped = true;
    } finally {
      if (!stopped) await rpc.stop().catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("HTTP MCP resources/read uses loopback daemon RPC for external docs", async () => {
    const root = tempModel();
    const store = new TestLocalStore();
    const entry = externalDocsEntry();
    await store.saveExternalDocumentation(entry);
    const daemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: store,
      clock: () => "2026-06-24T00:00:00.000Z"
    });
    const rpc = new ArchctxRuntimeRpcServer(daemon, { root, port: 0, token: "mcp-resource-token" });
    let stopped = false;
    try {
      await rpc.start();
      await daemon.init(root, "MCP Resource RPC App");
      const http = new LocalHttpMcpServer(new McpLocalServer());

      const listed = await http.handle({
        method: "GET",
        path: "/mcp/resources",
        host: "127.0.0.1",
        body: { root }
      });
      expect(listed.status).toBe(200);
      expect((listed.body as any).resources.map((resource: any) => resource.uri)).toContain(entry.resource.uri);

      const read = await http.handle({
        method: "POST",
        path: "/mcp/resources/read",
        host: "127.0.0.1",
        body: { root, uri: entry.resource.uri }
      });
      expect(read.status).toBe(200);
      expect((read.body as any).content.resource).toMatchObject({
        provider: "context7",
        libraryId: "/facebook/react",
        cacheStatus: "fresh",
        warning: "untrusted-documentation-data"
      });
      await rpc.stop();
      stopped = true;
    } finally {
      if (!stopped) await rpc.stop().catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("MCP does not create an independent runtime when daemon RPC is unavailable", async () => {
    const root = tempModel();
    try {
      const server = new McpLocalServer();
      const result = await server.callTool("archcontext_prepare_task", {
        root,
        task: "remove legacy v1 wrapper",
        maxItems: 2,
        maxBytes: 12_288
      });
      expect((result.content as any).ok).toBe(false);
      expect((result.content as any).error.code).toBe("AC_RUNTIME_UNAVAILABLE");
      expect(JSON.stringify(result.content)).toContain("archctx daemon start");
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
