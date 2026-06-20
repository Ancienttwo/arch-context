import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  addRepositoryToLandscape,
  bindRepository,
  computeWorktreeDigest,
  createLandscape,
  landscapeDigest,
  repositoryFingerprint,
  validateLandscape,
  type Landscape,
  type RepositoryRegistration
} from "../../architecture-domain/src/index";
import { CodeGraphAdapter, MockCodeGraphProvider, MultiRepoCodeGraphAdapter } from "../../codegraph-adapter/src/index";
import { compileLandscapeTaskContext } from "../../context-compiler/src/index";
import { filterExplorerProjection, renderExplorerHtml } from "../../explorer-ui/src/index";
import { okEnvelope, type CodeFactsPort, type ExplorerProjection, type ExplorerServiceContract, type Json, type JsonEnvelope, type ModelStorePort, type RepositorySnapshot, type WorkspaceRef } from "../../contracts/src/index";
import { readHeadSha } from "../../git-adapter/src/index";
import { InMemoryLocalStore } from "../../local-store-sqlite/src/index";
import { initializeArchContextModel, rebuildGeneratedProjection, YamlModelStore } from "../../model-store-yaml/src/index";

export interface RuntimeStatus {
  running: boolean;
  sessions: number;
  repositories: string[];
}

export interface RepositorySession {
  workspace: WorkspaceRef;
  snapshot: RepositorySnapshot;
  codeFactsDigest?: string;
  modelDigest?: string;
  startedAt: string;
}

export interface RuntimeDeps {
  codeFacts?: CodeFactsPort;
  modelStore?: ModelStorePort;
  localStore?: InMemoryLocalStore;
  clock?: () => string;
  maxRepoSessions?: number;
}

export interface ExplorerServerOptions {
  port?: number;
  tokenTtlSeconds?: number;
}

export interface ExplorerServerStatus {
  running: boolean;
  host: "127.0.0.1";
  port?: number;
  url?: string;
  tokenExpiresAt?: string;
  revoked: boolean;
  readOnly: true;
}

interface ExplorerServerSession {
  server: Server;
  root: string;
  host: "127.0.0.1";
  port: number;
  token: string;
  expiresAt: number;
  revoked: boolean;
}

interface ModelFileSummary {
  path: string;
  schemaVersion: string;
  digest: string;
}

export class ArchctxDaemon {
  private readonly codeFacts: CodeFactsPort;
  private readonly modelStore: ModelStorePort;
  private readonly localStore: InMemoryLocalStore;
  private readonly clock: () => string;
  private readonly maxRepoSessions: number;
  private readonly sessions = new Map<string, RepositorySession>();
  private landscape?: Landscape;
  private explorer?: ExplorerServerSession;
  private running = false;
  private writerLocked = false;

  constructor(deps: RuntimeDeps = {}) {
    this.codeFacts = deps.codeFacts ?? new CodeGraphAdapter(new MockCodeGraphProvider());
    this.modelStore = deps.modelStore ?? new YamlModelStore();
    this.localStore = deps.localStore ?? new InMemoryLocalStore();
    this.clock = deps.clock ?? (() => new Date(0).toISOString());
    this.maxRepoSessions = deps.maxRepoSessions ?? 8;
  }

  async start(): Promise<void> {
    await this.localStore.migrate();
    this.localStore.recoverPendingSnapshots();
    this.running = true;
  }

  async stop(): Promise<void> {
    await this.closeExplorer();
    this.sessions.clear();
    this.running = false;
  }

  status(): RuntimeStatus {
    return {
      running: this.running,
      sessions: this.sessions.size,
      repositories: [...this.sessions.keys()].sort()
    };
  }

  async init(root: string, productName?: string): Promise<JsonEnvelope> {
    this.assertRunning();
    return this.withWriter(async () => {
      initializeArchContextModel(root, productName);
      rebuildGeneratedProjection(root);
      const session = await this.openSession(root);
      return okEnvelope("init", {
        repositoryId: session.workspace.repositoryId,
        headSha: session.workspace.headSha,
        worktreeDigest: session.snapshot.worktreeDigest,
        modelDigest: session.modelDigest
      } as Json);
    });
  }

  async sync(root: string, changedPaths: string[] = []): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const codeFacts = await this.codeFacts.sync({ workspace: session.workspace, changedPaths });
    session.codeFactsDigest = codeFacts.schemaDigest;
    return okEnvelope("sync", { codeFactsDigest: codeFacts.schemaDigest, indexedAt: codeFacts.indexedAt } as Json);
  }

  async validate(root: string): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const result = await this.modelStore.validateModel(session.workspace);
    session.modelDigest = result.modelDigest;
    return okEnvelope("validate", result as unknown as Json);
  }

  async context(root: string, task: string, maxSymbols = 12): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const codeFacts = await this.codeFacts.ensureReady(session.workspace);
    const model = await this.modelStore.validateModel(session.workspace);
    const codeContext = await this.codeFacts.buildTaskContext({ task, maxSymbols, includeSource: false });
    return okEnvelope("context", {
      schemaVersion: "archcontext.task-context/v1",
      task,
      posture: "normal",
      architecturePressure: { level: "low", score: 0, signals: [] },
      refactorConfidence: { level: "high", score: 80, coverage: ["codegraph-ready"] },
      relevantNodes: [],
      constraints: [],
      decisions: [],
      realConstraints: [],
      unknowns: [],
      recommendedTargetState: {},
      requiredCheckpoints: ["before-task-complete"],
      resources: [{ type: "codefacts", digest: codeFacts.schemaDigest }, { type: "model", digest: model.modelDigest }, { type: "code-context", digest: codeContext.digest }]
    } as Json);
  }

  async repoAdd(root: string, name?: string): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const repository: RepositoryRegistration = {
      repositoryId: session.workspace.repositoryId,
      numericRepositoryId: numericRepositoryId(session.workspace.repositoryId),
      name: name ?? session.workspace.repositoryId,
      role: "application",
      root: session.workspace.root,
      defaultBranch: "main"
    };
    this.landscape = this.landscape
      ? addRepositoryToLandscape(this.landscape, repository)
      : createLandscape({ id: "local", name: "Local Landscape", repositories: [repository] });
    await this.localStore.saveLandscape(this.landscape);
    return okEnvelope("repo.add", { repository, landscapeDigest: landscapeDigest(this.landscape) } as unknown as Json);
  }

  async repoList(): Promise<JsonEnvelope> {
    this.assertRunning();
    return okEnvelope("repo.list", {
      repositories: this.landscape?.repositories ?? [],
      activeSessions: [...this.sessions.keys()].sort()
    } as unknown as Json);
  }

  async repoRemove(repositoryId: string): Promise<JsonEnvelope> {
    this.assertRunning();
    this.sessions.delete(repositoryId);
    if (this.landscape) {
      this.landscape = {
        ...this.landscape,
        repositories: this.landscape.repositories.filter((repo) => repo.repositoryId !== repositoryId),
        relations: this.landscape.relations
      };
      await this.localStore.saveLandscape(this.landscape);
    }
    return okEnvelope("repo.remove", { repositoryId, removed: true } as Json);
  }

  async loadLandscape(landscape: Landscape): Promise<JsonEnvelope> {
    this.assertRunning();
    const validation = validateLandscape(landscape);
    if (!validation.valid) {
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: false,
        requestId: "landscape",
        error: {
          code: "AC_SCHEMA_INVALID",
          message: validation.errors.join("; "),
          severity: "error",
          retryable: false,
          action: "repair-model"
        }
      };
    }
    this.landscape = landscape;
    await this.localStore.saveLandscape(landscape);
    return okEnvelope("landscape", { id: landscape.id, repositories: landscape.repositories.length, digest: landscapeDigest(landscape) } as Json);
  }

  async landscapeStatus(): Promise<JsonEnvelope> {
    this.assertRunning();
    const landscape = this.landscape ?? createLandscape({ id: "local", name: "Local Landscape", repositories: [] });
    return okEnvelope("landscape", {
      ...landscape,
      digest: landscapeDigest(landscape)
    } as unknown as Json);
  }

  explorerServiceContract(tokenTtlSeconds = 900): JsonEnvelope {
    const contract: ExplorerServiceContract = {
      schemaVersion: "archcontext.explorer-service/v1",
      bindHost: "127.0.0.1",
      protocol: "http-loopback",
      optIn: true,
      defaultEnabled: false,
      tokenTtlSeconds,
      readOnly: true,
      allowedMethods: ["GET"],
      egress: "none"
    };
    return okEnvelope("explorer.contract", contract as unknown as Json);
  }

  async explorerProjection(root: string, query?: string): Promise<JsonEnvelope> {
    this.assertRunning();
    const projection = await this.buildExplorerProjection(root, query);
    return okEnvelope("explorer.projection", projection as unknown as Json);
  }

  async startExplorer(root: string, options: ExplorerServerOptions = {}): Promise<JsonEnvelope> {
    this.assertRunning();
    await this.closeExplorer();
    const ttlSeconds = options.tokenTtlSeconds ?? 900;
    const token = randomBytes(18).toString("base64url");
    const expiresAt = Date.parse(this.clock()) + ttlSeconds * 1000;
    const holder = {} as ExplorerServerSession;
    const server = createServer((request, response) => {
      void this.handleExplorerRequest(request, response, holder).catch((error) => {
        writeJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    });
    Object.assign(holder, {
      server,
      root,
      host: "127.0.0.1",
      port: 0,
      token,
      expiresAt,
      revoked: false
    });
    await new Promise<void>((resolveListen) => server.listen(options.port ?? 0, "127.0.0.1", resolveListen));
    holder.port = (server.address() as AddressInfo).port;
    this.explorer = holder;
    return okEnvelope("explorer.start", {
      ...this.explorerStatusData(),
      token,
      tokenTtlSeconds: ttlSeconds
    } as Json);
  }

  async stopExplorer(): Promise<JsonEnvelope> {
    this.assertRunning();
    await this.closeExplorer();
    return okEnvelope("explorer.stop", this.explorerStatusData() as unknown as Json);
  }

  async revokeExplorerToken(): Promise<JsonEnvelope> {
    this.assertRunning();
    if (this.explorer) this.explorer.revoked = true;
    return okEnvelope("explorer.revoke", this.explorerStatusData() as unknown as Json);
  }

  explorerStatus(): JsonEnvelope {
    this.assertRunning();
    return okEnvelope("explorer.status", this.explorerStatusData() as unknown as Json);
  }

  async contextLandscape(task: string, maxSymbols = 12): Promise<JsonEnvelope> {
    this.assertRunning();
    if (!this.landscape || this.landscape.repositories.length === 0) {
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: false,
        requestId: "context",
        error: {
          code: "AC_PRECONDITION_FAILED",
          message: "landscape context requires registered repositories",
          severity: "warning",
          retryable: true,
          action: "archctx repo add"
        }
      };
    }
    const workspaces = await Promise.all(
      this.landscape.repositories.map(async (repo) => {
        const session = repo.root ? await this.openSession(repo.root) : undefined;
        return session?.workspace ?? { root: repo.root ?? repo.repositoryId, repositoryId: repo.repositoryId, headSha: "unknown" };
      })
    );
    const context = await compileLandscapeTaskContext({
      landscape: this.landscape,
      relations: await this.localStore.listCrossRepoRelations(this.landscape),
      workspaces,
      task,
      codeFacts: new MultiRepoCodeGraphAdapter(Object.fromEntries(this.landscape.repositories.map((repo) => [repo.repositoryId, new MockCodeGraphProvider()]))),
      modelStore: this.modelStore,
      budget: { maxBytes: 12_288, maxItems: maxSymbols }
    });
    return okEnvelope("context", context as unknown as Json);
  }

  async runtimeStatus(root?: string): Promise<JsonEnvelope> {
    const status = this.status();
    if (!root) return okEnvelope("status", status as unknown as Json);
    const repositoryId = repositoryFingerprint(root);
    const session = this.sessions.get(repositoryId);
    return okEnvelope("status", {
      ...status,
      repositoryId,
      headSha: session?.workspace.headSha ?? readHeadSha(root),
      worktreeDigest: session?.snapshot.worktreeDigest ?? computeWorktreeDigest(root)
    } as Json);
  }

  async openSession(root: string): Promise<RepositorySession> {
    this.assertRunning();
    const headSha = readHeadSha(root);
    const binding = bindRepository(root, headSha);
    const workspace: WorkspaceRef = {
      root: binding.root,
      repositoryId: binding.repositoryId,
      headSha
    };
    const snapshot: RepositorySnapshot = {
      repositoryId: binding.repositoryId,
      headSha,
      worktreeDigest: binding.worktreeDigest
    };
    const snapshotId = await this.localStore.beginSnapshot(snapshot);
    await this.localStore.commitSnapshot(snapshotId);
    const validation = await this.modelStore.validateModel(workspace).catch(() => undefined);
    const session: RepositorySession = {
      workspace,
      snapshot,
      modelDigest: validation?.modelDigest,
      startedAt: this.clock()
    };
    this.sessions.set(binding.repositoryId, session);
    this.evictOldSessions();
    return session;
  }

  private evictOldSessions(): void {
    while (this.sessions.size > this.maxRepoSessions) {
      const oldest = this.sessions.keys().next().value;
      if (!oldest) return;
      this.sessions.delete(oldest);
    }
  }

  private assertRunning(): void {
    if (!this.running) throw new Error("archctxd is not running");
  }

  private async withWriter<T>(fn: () => Promise<T>): Promise<T> {
    if (this.writerLocked) throw new Error("runtime writer is locked");
    this.writerLocked = true;
    try {
      return await fn();
    } finally {
      this.writerLocked = false;
    }
  }

  private async buildExplorerProjection(root: string, query?: string): Promise<ExplorerProjection> {
    const session = await this.openSession(root);
    await this.codeFacts.ensureReady(session.workspace);
    const model = await this.modelStore.validateModel(session.workspace).catch(() => undefined);
    const modelFiles = await this.modelStore.loadModel(session.workspace).catch(() => []) as ModelFileSummary[];
    const codeContext = await this.codeFacts.buildTaskContext({ task: "architecture explorer", maxSymbols: 80, includeSource: false });
    const modelNodes = modelFiles.map((file) => ({
      id: file.path,
      name: file.path.split("/").at(-1) ?? file.path,
      kind: schemaVersionKind(file.schemaVersion),
      verificationStatus: "MATCHED" as const,
      pressure: { level: "low" as const, score: 0, signals: [] },
      sourceSelectors: [{ path: file.path }]
    }));
    const codeNodes = codeContext.symbols.map((symbol) => ({
      id: symbol.id,
      name: symbol.name,
      kind: symbol.kind,
      verificationStatus: codeContext.evidence.some((evidence) => evidence.selector.symbolId === symbol.id && evidence.confidence === "verified")
        ? "VERIFIED" as const
        : "MATCHED" as const,
      pressure: { level: "low" as const, score: 0, signals: [] },
      sourceSelectors: [{ path: symbol.path, symbolId: symbol.id, startLine: symbol.range?.startLine, endLine: symbol.range?.endLine }]
    }));
    const projection: ExplorerProjection = {
      schemaVersion: "archcontext.explorer-projection/v1",
      generatedAt: this.clock(),
      repository: {
        ...session.snapshot,
        modelDigest: model?.modelDigest
      },
      nodes: dedupeExplorerNodes([...modelNodes, ...codeNodes]),
      relations: codeContext.edges.map((edge, index) => ({
        id: `relation.${index + 1}`,
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        verificationStatus: edge.confidence === "high" ? "MATCHED" : "UNKNOWN"
      })),
      landscape: this.landscape ? {
        ...this.landscape,
        crossRepoRelations: await this.localStore.listCrossRepoRelations(this.landscape)
      } as unknown as Json : undefined,
      verification: [
        ...modelFiles.map((file) => ({ path: file.path, schemaVersion: file.schemaVersion, digest: file.digest, confidence: "declared" })),
        ...codeContext.evidence.map((evidence) => evidence as unknown as Json)
      ] as unknown as Json[],
      pressure: codeContext.symbols.map((symbol) => ({ symbolId: symbol.id, level: "low", score: 0 })) as unknown as Json[],
      interventions: modelFiles
        .filter((file) => file.schemaVersion === "archcontext.intervention/v1")
        .map((file) => ({ path: file.path, digest: file.digest })) as unknown as Json[],
      capabilities: {
        readOnly: true,
        mutationMode: "forbidden",
        egress: "none",
        tokenRequired: true
      }
    };
    return filterExplorerProjection(projection, query);
  }

  private async handleExplorerRequest(request: IncomingMessage, response: ServerResponse, session: ExplorerServerSession): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${session.host}:${session.port}`);
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET") {
      writeJson(response, 405, { ok: false, error: "explorer is read-only" });
      return;
    }
    if (url.pathname === "/health") {
      writeJson(response, 200, { ok: true, running: true, readOnly: true, host: session.host });
      return;
    }
    if (!this.isExplorerAuthorized(request, url, session)) {
      writeJson(response, 401, { ok: false, error: "explorer token required" });
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const projection = await this.buildExplorerProjection(session.root, url.searchParams.get("q") ?? undefined);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(renderExplorerHtml(projection, { focusId: url.searchParams.get("focus") }));
      return;
    }
    if (url.pathname === "/projection" || url.pathname === "/search") {
      const projection = await this.buildExplorerProjection(session.root, url.searchParams.get("q") ?? undefined);
      writeJson(response, 200, okEnvelope("explorer.projection", projection as unknown as Json));
      return;
    }
    writeJson(response, 404, { ok: false, error: "not found" });
  }

  private isExplorerAuthorized(request: IncomingMessage, url: URL, session: ExplorerServerSession): boolean {
    if (session.revoked || Date.parse(this.clock()) >= session.expiresAt) return false;
    const authorization = request.headers.authorization ?? "";
    const bearer = Array.isArray(authorization) ? authorization[0] : authorization;
    return bearer === `Bearer ${session.token}` || url.searchParams.get("token") === session.token;
  }

  private explorerStatusData(): ExplorerServerStatus {
    if (!this.explorer) return { running: false, host: "127.0.0.1", revoked: true, readOnly: true };
    return {
      running: true,
      host: this.explorer.host,
      port: this.explorer.port,
      url: `http://${this.explorer.host}:${this.explorer.port}/`,
      tokenExpiresAt: new Date(this.explorer.expiresAt).toISOString(),
      revoked: this.explorer.revoked,
      readOnly: true
    };
  }

  private async closeExplorer(): Promise<void> {
    const current = this.explorer;
    if (!current) return;
    this.explorer = undefined;
    await new Promise<void>((resolveClose, rejectClose) => {
      current.server.close((error) => error ? rejectClose(error) : resolveClose());
    });
  }
}

function numericRepositoryId(repositoryId: string): number {
  let hash = 0;
  for (const char of repositoryId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return Math.max(1, hash);
}

function dedupeExplorerNodes(nodes: ExplorerProjection["nodes"]): ExplorerProjection["nodes"] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()].sort((a, b) => a.id.localeCompare(b.id));
}

function schemaVersionKind(schemaVersion: string): string {
  const match = schemaVersion.match(/^archcontext\.([a-z-]+)\/v\d+$/);
  return match?.[1] ?? "architecture-file";
}

export async function createStartedDaemon(deps: RuntimeDeps = {}): Promise<ArchctxDaemon> {
  const daemon = new ArchctxDaemon(deps);
  await daemon.start();
  return daemon;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}
