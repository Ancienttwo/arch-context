import { computeWorktreeDigest } from "@archcontext/architecture-domain";
import { ChangeSetEngine, type ChangeOperation } from "@archcontext/changeset-engine";
import { CodeGraphAdapter, MockCodeGraphProvider } from "@archcontext/codegraph-adapter";
import { errorEnvelope, okEnvelope, type Json } from "@archcontext/contracts";
import { rebuildGeneratedProjection, YamlModelStore } from "@archcontext/model-store-yaml";
import { checkpoint, completeTask, prepareTask } from "@archcontext/application";

export type ToolSafety = "read-only" | "idempotent" | "destructive";

export interface McpToolDefinition {
  name: string;
  description: string;
  annotations: {
    safety: ToolSafety;
    requiresConfirmation: boolean;
  };
}

export interface ToolCallResult {
  content: Json;
  resourceUri?: string;
  dataClassification: "local-architecture" | "local-metadata";
}

export const LOCAL_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "archcontext_prepare_task",
    description: "Call before coding starts. Compiles bounded architecture context and posture for the current task.",
    annotations: { safety: "read-only", requiresConfirmation: false }
  },
  {
    name: "archcontext_checkpoint",
    description: "Call after meaningful code or model changes. Verifies the task snapshot is still fresh.",
    annotations: { safety: "read-only", requiresConfirmation: false }
  },
  {
    name: "archcontext_plan_update",
    description: "Create a ChangeSet draft and preview for architecture model updates. Does not write files.",
    annotations: { safety: "idempotent", requiresConfirmation: false }
  },
  {
    name: "archcontext_apply_update",
    description: "Apply an approved ChangeSet. Requires explicit local approval and fresh worktree digest.",
    annotations: { safety: "destructive", requiresConfirmation: true }
  },
  {
    name: "archcontext_complete_task",
    description: "Call before final response. Runs completion gate and returns ReviewResult.",
    annotations: { safety: "read-only", requiresConfirmation: false }
  }
];

export class McpLocalServer {
  readonly resources = new Map<string, Json>();
  private readonly changesets = new Map<string, ReturnType<ChangeSetEngine["plan"]>>();
  private readonly changeSetEngine = new ChangeSetEngine({
    modelStore: new YamlModelStore(),
    projection: { rebuildGeneratedProjection }
  });

  listTools(): McpToolDefinition[] {
    return LOCAL_MCP_TOOLS;
  }

  listChatGptTools(writeEnabled = false): McpToolDefinition[] {
    const readOnly = LOCAL_MCP_TOOLS.filter((tool) => tool.name !== "archcontext_apply_update");
    return writeEnabled ? LOCAL_MCP_TOOLS : readOnly;
  }

  async callTool(name: string, args: Record<string, any>): Promise<ToolCallResult> {
    switch (name) {
      case "archcontext_prepare_task": {
        const result = await prepareTask({
          workspace: { root: args.root, repositoryId: args.repositoryId ?? "repo.local", headSha: args.headSha ?? "local" },
          task: args.task,
          codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
          modelStore: new YamlModelStore(),
          budget: { maxBytes: args.maxBytes ?? 12_288, maxItems: args.maxItems ?? 12 },
          callerCoverage: args.callerCoverage,
          testsAvailable: args.testsAvailable,
          rollbackAvailable: args.rollbackAvailable
        });
        return this.budgeted("prepare", result as unknown as Json, args.maxBytes ?? 12_288);
      }
      case "archcontext_checkpoint":
        return { content: okEnvelope("checkpoint", checkpoint({ root: args.root, expectedWorktreeDigest: args.expectedWorktreeDigest }) as unknown as Json) as unknown as Json, dataClassification: "local-metadata" };
      case "archcontext_plan_update": {
        const draft = this.changeSetEngine.plan({
          id: args.id,
          base: args.base ?? {
            headSha: args.headSha ?? "local",
            worktreeDigest: args.expectedWorktreeDigest ?? "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            modelDigest: args.modelDigest ?? "sha256:0000000000000000000000000000000000000000000000000000000000000000"
          },
          reason: args.reason ?? { taskSessionId: args.taskSessionId ?? "task_mcp" },
          operations: args.operations as ChangeOperation[]
        });
        this.changesets.set(draft.id, draft);
        return { content: okEnvelope("plan_update", this.changeSetEngine.preview(args.root, draft) as unknown as Json) as unknown as Json, dataClassification: "local-architecture" };
      }
      case "archcontext_apply_update": {
        if (!args.approved) return { content: errorEnvelope("apply_update", "AC_USER_CONFIRMATION_REQUIRED", "ChangeSet apply requires explicit local approval") as unknown as Json, dataClassification: "local-metadata" };
        const draft = this.changesets.get(args.id);
        if (!draft) return { content: errorEnvelope("apply_update", "AC_PRECONDITION_FAILED", `Unknown ChangeSet: ${args.id}`) as unknown as Json, dataClassification: "local-metadata" };
        const fresh = checkpoint({ root: args.root, expectedWorktreeDigest: args.expectedWorktreeDigest });
        if (!fresh.fresh) return { content: errorEnvelope("apply_update", "AC_CONTEXT_STALE", "Worktree digest changed before apply") as unknown as Json, dataClassification: "local-metadata" };
        const applied = await this.changeSetEngine.apply(args.root, this.changeSetEngine.approve(draft), { approved: true });
        return { content: okEnvelope("apply_update", applied as unknown as Json) as unknown as Json, dataClassification: "local-architecture" };
      }
      case "archcontext_complete_task":
        return { content: okEnvelope("complete_task", completeTask(args as any) as unknown as Json) as unknown as Json, dataClassification: "local-metadata" };
      default:
        return { content: errorEnvelope("mcp", "AC_SCHEMA_INVALID", `Unknown tool: ${name}`) as unknown as Json, dataClassification: "local-metadata" };
    }
  }

  readResource(uri: string): Json | undefined {
    return this.resources.get(uri);
  }

  recoverSession(taskSessionId: string): Json {
    return { taskSessionId, recovered: true, tools: LOCAL_MCP_TOOLS.map((tool) => tool.name) };
  }

  private budgeted(prefix: string, content: Json, maxBytes: number): ToolCallResult {
    const encoded = JSON.stringify(content);
    if (Buffer.byteLength(encoded, "utf8") <= maxBytes) {
      return { content, dataClassification: "local-architecture" };
    }
    const uri = `archcontext://resource/${prefix}/${this.resources.size + 1}`;
    this.resources.set(uri, content);
    return {
      content: {
        schemaVersion: "archcontext.resource-summary/v1",
        summary: "Result exceeded budget; load resource URI for details.",
        resourceUri: uri
      },
      resourceUri: uri,
      dataClassification: "local-architecture"
    };
  }
}

export interface LocalHttpMcpRequest {
  method: string;
  path: string;
  body?: Record<string, any>;
  host?: string;
}

export class LocalHttpMcpServer {
  readonly bindHost = "127.0.0.1";

  constructor(private readonly localMcp = new McpLocalServer()) {}

  async handle(request: LocalHttpMcpRequest) {
    if (request.host && !["127.0.0.1", "localhost", this.bindHost].includes(request.host)) {
      return { status: 403, body: errorEnvelope("http-mcp", "AC_TUNNEL_SCOPE_DENIED", "Local HTTP MCP only binds loopback") };
    }
    if (request.method === "GET" && request.path === "/mcp/tools") {
      return { status: 200, body: { tools: this.localMcp.listTools() } };
    }
    if (request.method === "POST" && request.path === "/mcp/call") {
      const body = request.body ?? {};
      return { status: 200, body: await this.localMcp.callTool(body.name, body.arguments ?? {}) };
    }
    return { status: 404, body: errorEnvelope("http-mcp", "AC_SCHEMA_INVALID", "Unknown local MCP route") };
  }
}

export interface TunnelSession {
  id: string;
  enabled: boolean;
  scopes: string[];
  credential: string;
  expiresAt: string;
  revoked: boolean;
}

export class SecureMcpTunnelManager {
  private current?: TunnelSession;

  status(): { enabled: boolean; session?: Omit<TunnelSession, "credential"> } {
    if (!this.current || this.current.revoked) return { enabled: false };
    const { credential: _credential, ...session } = this.current;
    return { enabled: this.current.enabled, session };
  }

  start(input: { scopes: string[]; ttlSeconds?: number; now?: Date }): TunnelSession {
    const now = input.now ?? new Date(0);
    const ttlSeconds = input.ttlSeconds ?? 600;
    this.current = {
      id: `tunnel_${now.getTime()}`,
      enabled: true,
      scopes: input.scopes,
      credential: `local-${now.getTime()}-${ttlSeconds}`,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      revoked: false
    };
    return this.current;
  }

  stop(): void {
    if (this.current) this.current.enabled = false;
  }

  revoke(): void {
    if (this.current) {
      this.current.enabled = false;
      this.current.revoked = true;
    }
  }

  validateScope(scope: string, now: Date = new Date(0)): void {
    if (!this.current || !this.current.enabled || this.current.revoked) throw new Error("Tunnel is not active");
    if (this.current.expiresAt <= now.toISOString()) throw new Error("Tunnel credential expired");
    if (!this.current.scopes.includes(scope)) throw new Error(`Tunnel scope denied: ${scope}`);
  }
}

export async function runStdioMcpLoop(input: AsyncIterable<string>, output: (line: string) => void, log: (line: string) => void = (line) => process.stderr.write(`${line}\n`)): Promise<void> {
  const server = new McpLocalServer();
  log("[archctx-mcp] started");
  for await (const line of input) {
    const message = JSON.parse(line);
    const result = message.method === "tools/list"
      ? { tools: server.listTools() }
      : await server.callTool(message.params?.name, message.params?.arguments ?? {});
    output(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  }
}
