import type { ChangeOperation } from "@archcontext/core/changeset-engine";
import { assertNoCallerProvidedAttestationFields, errorEnvelope, type Json } from "@archcontext/contracts";
import { createRuntimeRpcClientFromConnectionFile, type RuntimeBookInput, type RuntimeDaemonClient } from "@archcontext/local-runtime/runtime-daemon";

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

export interface McpResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType: "application/json";
  annotations: {
    safety: "read-only";
  };
}

export type McpRuntimeResolver = (root: string) => RuntimeDaemonClient | Promise<RuntimeDaemonClient>;

export interface McpLocalServerOptions {
  runtime?: RuntimeDaemonClient;
  runtimeResolver?: McpRuntimeResolver;
}

export const LOCAL_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "archcontext_prepare_task",
    description: "Call before coding starts. Compiles bounded architecture context and posture for the current task.",
    annotations: { safety: "read-only", requiresConfirmation: false }
  },
  {
    name: "archcontext_practices",
    description: "List, show, validate, or inspect source records for the effective static Practice Catalog.",
    annotations: { safety: "read-only", requiresConfirmation: false }
  },
  {
    name: "archcontext_checkpoint",
    description: "Call after meaningful code or model changes. Returns practice guidance deltas from the daemon checkpoint.",
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

const ARCHITECTURE_BOOK_RESOURCES: Array<McpResourceDefinition & { input: RuntimeBookInput }> = [
  {
    uri: "archcontext://book/status",
    name: "Architecture Book status",
    description: "Read Architecture Book freshness, drift, counts, and supported commands from the local daemon.",
    mimeType: "application/json",
    annotations: { safety: "read-only" },
    input: { command: "status" }
  },
  {
    uri: "archcontext://book/state",
    name: "Architecture Book state",
    description: "Read the current metadata-only Architecture Book state from the local daemon.",
    mimeType: "application/json",
    annotations: { safety: "read-only" },
    input: { command: "export", format: "json" }
  },
  {
    uri: "archcontext://book/timeline",
    name: "Architecture Book timeline",
    description: "Read recent Architecture Book events and freshness metadata from the local daemon.",
    mimeType: "application/json",
    annotations: { safety: "read-only" },
    input: { command: "timeline", maxItems: 100 }
  },
  {
    uri: "archcontext://book/diff",
    name: "Architecture Book diff",
    description: "Read the metadata-only diff from the empty ledger state to the current Architecture Book state.",
    mimeType: "application/json",
    annotations: { safety: "read-only" },
    input: { command: "diff", fromRef: "empty", toRef: "current", maxItems: 100 }
  },
  {
    uri: "archcontext://book/recommendations",
    name: "Architecture Book recommendations",
    description: "Read Architecture Book recommendations from the local daemon.",
    mimeType: "application/json",
    annotations: { safety: "read-only" },
    input: { command: "recommendations", maxItems: 100 }
  }
];

export class McpLocalServer {
  readonly resources = new Map<string, Json>();
  private runtimeInstance?: RuntimeDaemonClient;
  private runtimeResolver?: McpRuntimeResolver;

  constructor(runtimeOrOptions?: RuntimeDaemonClient | McpLocalServerOptions) {
    if (isMcpLocalServerOptions(runtimeOrOptions)) {
      this.runtimeInstance = runtimeOrOptions.runtime;
      this.runtimeResolver = runtimeOrOptions.runtimeResolver;
    } else {
      this.runtimeInstance = runtimeOrOptions;
    }
  }

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
        const root = requiredArg(args, "root");
        const task = requiredArg(args, "task");
        try {
          const result = await (await this.runtime(root)).prepare(root, task, args.maxBytes ?? 12_288, args.maxItems ?? 12, args.taskSessionId ?? "task_mcp");
          return this.budgeted("prepare", result as unknown as Json, args.maxBytes ?? 12_288);
        } catch (error) {
          return runtimeUnavailable("prepare", error);
        }
      }
      case "archcontext_practices": {
        const root = requiredArg(args, "root");
        try {
          const result = await (await this.runtime(root)).practices(root, {
            action: args.action ?? "list",
            id: args.id,
            category: args.category,
            source: args.source,
            strict: args.strict === true
          });
          return this.budgeted("practices", result as unknown as Json, args.maxBytes ?? 12_288);
        } catch (error) {
          return runtimeUnavailable("practices", error);
        }
      }
      case "archcontext_checkpoint": {
        const root = requiredArg(args, "root");
        try {
          const result = await (await this.runtime(root)).checkpoint(root, {
            taskSessionId: args.taskSessionId ?? "task_mcp",
            task: args.task,
            event: args.event ?? "manual",
            changedPaths: Array.isArray(args.changedPaths) ? args.changedPaths : [],
            toolCallId: args.toolCallId,
            expectedHeadSha: args.expectedHeadSha,
            expectedWorktreeDigest: args.expectedWorktreeDigest,
            maxBytes: args.maxBytes ?? 12_288,
            maxItems: args.maxItems ?? 12
          });
          return { content: result as unknown as Json, dataClassification: "local-metadata" };
        } catch (error) {
          return runtimeUnavailable("checkpoint", error);
        }
      }
      case "archcontext_plan_update": {
        const root = requiredArg(args, "root");
        try {
          const result = await (await this.runtime(root)).planUpdate(root, {
            id: requiredArg(args, "id"),
            reason: args.reason ?? { taskSessionId: args.taskSessionId ?? "task_mcp" },
            operations: args.operations as ChangeOperation[]
          });
          return { content: result as unknown as Json, dataClassification: "local-architecture" };
        } catch (error) {
          return runtimeUnavailable("plan_update", error);
        }
      }
      case "archcontext_apply_update": {
        if (!args.approved) return { content: errorEnvelope("apply_update", "AC_USER_CONFIRMATION_REQUIRED", "ChangeSet apply requires explicit local approval") as unknown as Json, dataClassification: "local-metadata" };
        try {
          const root = requiredArg(args, "root");
          const result = await (await this.runtime(root)).applyUpdate(root, {
            id: requiredArg(args, "id"),
            approved: true,
            expectedWorktreeDigest: requiredArg(args, "expectedWorktreeDigest")
          });
          return { content: result as unknown as Json, dataClassification: "local-architecture" };
        } catch (error) {
          return { content: errorEnvelope("apply_update", "AC_PRECONDITION_FAILED", error instanceof Error ? error.message : String(error)) as unknown as Json, dataClassification: "local-metadata" };
        }
      }
      case "archcontext_complete_task": {
        try {
          assertNoCallerProvidedAttestationFields(args, "complete-task");
        } catch (error) {
          return { content: errorEnvelope("complete_task", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error)) as unknown as Json, dataClassification: "local-metadata" };
        }
        try {
          const root = requiredArg(args, "root");
          const result = await (await this.runtime(root)).completeTask(root, {
            taskSessionId: args.taskSessionId,
            task: args.task,
            posture: args.posture,
            headSha: args.headSha,
            compatibilityContract: args.compatibilityContract,
            compatibilityPathIntroduced: args.compatibilityPathIntroduced,
            cleanupRequired: args.cleanupRequired,
            cleanupCompleted: args.cleanupCompleted
          });
          return { content: result as unknown as Json, dataClassification: "local-metadata" };
        } catch (error) {
          return runtimeUnavailable("complete_task", error);
        }
      }
      default:
        return { content: errorEnvelope("mcp", "AC_SCHEMA_INVALID", `Unknown tool: ${name}`) as unknown as Json, dataClassification: "local-metadata" };
    }
  }

  async listResources(root = process.cwd()): Promise<McpResourceDefinition[]> {
    const localResources: McpResourceDefinition[] = [
      ...ARCHITECTURE_BOOK_RESOURCES.map(({ input: _input, ...resource }) => resource),
      ...[...this.resources.keys()].map((uri) => ({
        uri,
        name: uri,
        description: "Daemon-budgeted local architecture result.",
        mimeType: "application/json" as const,
        annotations: { safety: "read-only" as const }
      }))
    ];
    try {
      const status = await (await this.runtime(root, { allowResolver: false })).docs(root, { command: "status", provider: "context7" });
      if (!status.ok) return localResources;
      const cacheEntries = ((status.data as any)?.cacheEntries ?? []) as Array<Record<string, unknown>>;
      return [
        ...localResources,
        ...cacheEntries
          .filter((entry) => typeof entry.contentDigest === "string" && /^sha256:[0-9a-f]{64}$/.test(entry.contentDigest))
          .map((entry) => {
            const library = typeof entry.libraryId === "string" ? entry.libraryId : "context7";
            const version = typeof entry.version === "string" ? entry.version : "unknown";
            return {
              uri: `archcontext://external-docs/context7/${entry.contentDigest}`,
              name: `Context7 ${library}@${version}`,
              description: "Read-only external documentation resource from the local daemon cache.",
              mimeType: "application/json" as const,
              annotations: { safety: "read-only" as const }
            };
          })
      ];
    } catch {
      return localResources;
    }
  }

  async readResource(uri: string, root = process.cwd()): Promise<Json | undefined> {
    const local = this.resources.get(uri);
    if (local) return local;
    const book = architectureBookResourceInput(uri);
    if (book) {
      try {
        return await (await this.runtime(root)).book(root, book) as unknown as Json;
      } catch (error) {
        return runtimeUnavailable("book.resource", error).content;
      }
    }
    if (!isExternalDocumentationResourceUri(uri)) return undefined;
    try {
      const result = await (await this.runtime(root)).readResource(root, uri);
      return result.ok ? result.data as Json : result as unknown as Json;
    } catch (error) {
      return runtimeUnavailable("resource.read", error).content;
    }
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

  private async runtime(root = process.cwd(), options: { allowResolver?: boolean } = { allowResolver: true }): Promise<RuntimeDaemonClient> {
    if (this.runtimeInstance) return this.runtimeInstance;
    const client = createRuntimeRpcClientFromConnectionFile(root);
    if (client) {
      const health = await client.health().catch(() => undefined);
      if ((health as any)?.ok === true) {
        this.runtimeInstance = client;
        return this.runtimeInstance;
      }
    }
    if (options.allowResolver !== false && this.runtimeResolver) {
      this.runtimeInstance = await this.runtimeResolver(root);
      return this.runtimeInstance;
    }
    throw new Error("archctxd RPC is unavailable; run `archctx daemon start` before using the local MCP surface");
  }
}

function isMcpLocalServerOptions(value: RuntimeDaemonClient | McpLocalServerOptions | undefined): value is McpLocalServerOptions {
  return Boolean(value && typeof value === "object" && ("runtime" in value || "runtimeResolver" in value));
}

function requiredArg(args: Record<string, any>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} is required`);
  return value;
}

function runtimeUnavailable(requestId: string, error: unknown): ToolCallResult {
  return {
    content: errorEnvelope(
      requestId,
      "AC_RUNTIME_UNAVAILABLE",
      error instanceof Error ? error.message : String(error)
    ) as unknown as Json,
    dataClassification: "local-metadata"
  };
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
    if (request.method === "GET" && request.path === "/mcp/resources") {
      return { status: 200, body: { resources: await this.localMcp.listResources(request.body?.root) } };
    }
    if (request.method === "POST" && request.path === "/mcp/call") {
      const body = request.body ?? {};
      return { status: 200, body: await this.localMcp.callTool(body.name, body.arguments ?? {}) };
    }
    if (request.method === "POST" && request.path === "/mcp/resources/read") {
      const body = request.body ?? {};
      const uri = requiredArg(body, "uri");
      const content = await this.localMcp.readResource(uri, body.root);
      if (content === undefined) {
        return { status: 404, body: errorEnvelope("http-mcp-resource", "AC_SCHEMA_INVALID", "Resource not found") };
      }
      return { status: 200, body: { content } };
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

export async function runStdioMcpLoop(
  input: AsyncIterable<string>,
  output: (line: string) => void,
  log: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
  options: McpLocalServerOptions = {}
): Promise<void> {
  const server = new McpLocalServer(options);
  log("[archctx-mcp] started");
  for await (const line of input) {
    const message = JSON.parse(line);
    let result;
    if (message.method === "tools/list") {
      result = { tools: server.listTools() };
    } else if (message.method === "resources/list") {
      result = { resources: await server.listResources(message.params?.root) };
    } else if (message.method === "resources/read") {
      const uri = message.params?.uri;
      const content = typeof uri === "string" ? await server.readResource(uri, message.params?.root) : undefined;
      result = {
        contents: content === undefined
          ? []
          : [{ uri, mimeType: "application/json", text: JSON.stringify(content) }]
      };
    } else {
      result = await server.callTool(message.params?.name, message.params?.arguments ?? {});
    }
    output(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  }
}

function isExternalDocumentationResourceUri(uri: string): boolean {
  return /^archcontext:\/\/external-docs\/context7\/sha256:[0-9a-f]{64}$/.test(uri);
}

function architectureBookResourceInput(uri: string): RuntimeBookInput | undefined {
  return ARCHITECTURE_BOOK_RESOURCES.find((resource) => resource.uri === uri)?.input;
}
