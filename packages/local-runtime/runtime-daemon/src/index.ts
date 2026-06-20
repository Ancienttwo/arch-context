import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
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
} from "@archcontext/core/architecture-domain";
import { ChangeSetEngine, type ChangeOperation, type ChangeSetDraft } from "@archcontext/core/changeset-engine";
import { prepareTask } from "@archcontext/core/application";
import { CodeGraphAdapter, CodeGraphCliProvider, MultiRepoCodeGraphAdapter, type CodeGraphProvider } from "@archcontext/local-runtime/codegraph-adapter";
import { compileLandscapeTaskContext } from "@archcontext/core/context-compiler";
import { LOCAL_RUNTIME_RPC_SCHEMA_VERSION, okEnvelope, productVersionManifest, type CodeFactsPort, type ExplorerProjection, type ExplorerServiceContract, type Json, type JsonEnvelope, type ModelStorePort, type RepositorySnapshot, type WorkspaceRef } from "@archcontext/contracts";
import { readHeadSha } from "@archcontext/local-runtime/git-adapter";
import { defaultLocalStorePath, SqliteLocalStore, type RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import { initializeArchContextModel, rebuildGeneratedProjection, YamlModelStore } from "@archcontext/local-runtime/model-store-yaml";

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
  codeGraphProviderFactory?: (repository: RepositoryRegistration) => CodeGraphProvider;
  modelStore?: ModelStorePort;
  localStore?: RuntimeLocalStore;
  changeSetEngine?: ChangeSetEngine;
  localStorePath?: string;
  clock?: () => string;
  maxRepoSessions?: number;
}

export interface ProductionRuntimeOptions {
  root?: string;
  localStorePath?: string;
  maxRepoSessions?: number;
}

export type RuntimeCompositionMode = "production" | "embedded";

export interface RuntimeCompositionReport {
  mode: RuntimeCompositionMode;
  productionSafe: boolean;
  adapters: {
    codeFacts: "codegraph-cli" | "injected";
    codeGraphProviderFactory: "codegraph-cli" | "injected";
    modelStore: "yaml" | "injected";
    localStore: "sqlite" | "injected";
    changeSetEngine: "default" | "injected";
  };
  localStorePath?: string;
  blockedProductionInjections: string[];
}

interface RuntimeConstructionOptions {
  compositionMode?: RuntimeCompositionMode;
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

export const RUNTIME_RPC_VERSION = LOCAL_RUNTIME_RPC_SCHEMA_VERSION;

export interface RuntimeRpcConnection {
  schemaVersion: typeof RUNTIME_RPC_VERSION;
  protocol: "http-loopback";
  version: 1;
  root: string;
  url: string;
  token: string;
  pid: number;
  lockPath: string;
  connectionPath: string;
  startedAt: string;
}

export interface RuntimeRpcServerOptions {
  root?: string;
  port?: number;
  token?: string;
  lockPath?: string;
  connectionPath?: string;
  clock?: () => string;
  onStop?: () => void;
}

export interface RuntimeDaemonClient {
  init(root: string, productName?: string): Promise<JsonEnvelope> | JsonEnvelope;
  sync(root: string, changedPaths?: string[]): Promise<JsonEnvelope> | JsonEnvelope;
  validate(root: string): Promise<JsonEnvelope> | JsonEnvelope;
  context(root: string, task: string, maxSymbols?: number): Promise<JsonEnvelope> | JsonEnvelope;
  prepare(root: string, task: string, maxBytes?: number, maxItems?: number): Promise<JsonEnvelope> | JsonEnvelope;
  planUpdate(root: string, input: { id: string; operations: ChangeOperation[]; reason?: { taskSessionId: string; interventionId?: string } }): Promise<JsonEnvelope> | JsonEnvelope;
  applyUpdate(root: string, input: { id: string; approved: boolean; expectedWorktreeDigest: string }): Promise<JsonEnvelope> | JsonEnvelope;
  repoAdd(root: string, name?: string): Promise<JsonEnvelope> | JsonEnvelope;
  repoList(): Promise<JsonEnvelope> | JsonEnvelope;
  repoRemove(repositoryId: string): Promise<JsonEnvelope> | JsonEnvelope;
  landscapeStatus(): Promise<JsonEnvelope> | JsonEnvelope;
  explorerServiceContract(tokenTtlSeconds?: number): Promise<JsonEnvelope> | JsonEnvelope;
  explorerProjection(root: string, query?: string): Promise<JsonEnvelope> | JsonEnvelope;
  startExplorer(root: string, options?: ExplorerServerOptions): Promise<JsonEnvelope> | JsonEnvelope;
  stopExplorer(): Promise<JsonEnvelope> | JsonEnvelope;
  revokeExplorerToken(): Promise<JsonEnvelope> | JsonEnvelope;
  explorerStatus(): Promise<JsonEnvelope> | JsonEnvelope;
  contextLandscape(task: string, maxSymbols?: number): Promise<JsonEnvelope> | JsonEnvelope;
  runtimeStatus(root?: string): Promise<JsonEnvelope> | JsonEnvelope;
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
  private readonly codeGraphProviderFactory: (repository: RepositoryRegistration) => CodeGraphProvider;
  private readonly modelStore: ModelStorePort;
  private readonly localStore: RuntimeLocalStore;
  private readonly changeSetEngine: ChangeSetEngine;
  private readonly clock: () => string;
  private readonly maxRepoSessions: number;
  private readonly composition: RuntimeCompositionReport;
  private readonly sessions = new Map<string, RepositorySession>();
  private readonly changesets = new Map<string, ChangeSetDraft>();
  private landscape?: Landscape;
  private explorer?: ExplorerServerSession;
  private running = false;
  private writerLocked = false;

  constructor(deps: RuntimeDeps = {}, options: RuntimeConstructionOptions = {}) {
    if (options.compositionMode === "production") assertProductionRuntimeDeps(deps);
    this.codeFacts = deps.codeFacts ?? new CodeGraphAdapter(new CodeGraphCliProvider());
    this.codeGraphProviderFactory = deps.codeGraphProviderFactory ?? ((repository) => new CodeGraphCliProvider(repository.root ?? repository.repositoryId));
    this.modelStore = deps.modelStore ?? new YamlModelStore();
    this.localStore = deps.localStore ?? new SqliteLocalStore(deps.localStorePath ?? defaultLocalStorePath());
    this.changeSetEngine = deps.changeSetEngine ?? new ChangeSetEngine({
      modelStore: this.modelStore,
      projection: { rebuildGeneratedProjection },
      journal: this.localStore
    });
    this.clock = deps.clock ?? (() => new Date(0).toISOString());
    this.maxRepoSessions = deps.maxRepoSessions ?? 8;
    this.composition = runtimeCompositionReport(deps, options.compositionMode ?? "embedded");
  }

  async start(): Promise<void> {
    await this.localStore.migrate();
    this.localStore.recoverPendingSnapshots();
    this.localStore.recoverPendingChangeSets();
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

  compositionReport(): RuntimeCompositionReport {
    return this.composition;
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

  async prepare(root: string, task: string, maxBytes = 12_288, maxItems = 12): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const result = await prepareTask({
      workspace: session.workspace,
      task,
      codeFacts: this.codeFacts,
      modelStore: this.modelStore,
      budget: { maxBytes, maxItems }
    });
    return okEnvelope("prepare", result as unknown as Json);
  }

  async planUpdate(root: string, input: {
    id: string;
    operations: ChangeOperation[];
    reason?: { taskSessionId: string; interventionId?: string };
  }): Promise<JsonEnvelope> {
    this.assertRunning();
    const session = await this.openSession(root);
    const model = await this.modelStore.validateModel(session.workspace);
    const draft = this.changeSetEngine.plan({
      id: input.id,
      base: {
        headSha: session.workspace.headSha,
        worktreeDigest: session.snapshot.worktreeDigest,
        modelDigest: model.modelDigest
      },
      reason: input.reason ?? { taskSessionId: "task_runtime" },
      operations: input.operations
    });
    this.changesets.set(draft.id, draft);
    return okEnvelope("plan_update", {
      draft,
      preview: this.changeSetEngine.preview(root, draft)
    } as unknown as Json);
  }

  async applyUpdate(root: string, input: {
    id: string;
    approved: boolean;
    expectedWorktreeDigest: string;
  }): Promise<JsonEnvelope> {
    this.assertRunning();
    if (!input.expectedWorktreeDigest) throw new Error("apply_update requires expectedWorktreeDigest");
    const current = computeWorktreeDigest(root);
    if (current !== input.expectedWorktreeDigest) throw new Error("Worktree digest changed before apply");
    const draft = this.changesets.get(input.id);
    if (!draft) throw new Error(`Unknown ChangeSet: ${input.id}`);
    const approved = input.approved ? this.changeSetEngine.approve(draft) : draft;
    const result = await this.changeSetEngine.apply(root, approved, { approved: input.approved });
    return okEnvelope("apply_update", result as unknown as Json);
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
      codeFacts: new MultiRepoCodeGraphAdapter(this.createLandscapeCodeGraphProviders()),
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
      writeJson(response, 200, okEnvelope("explorer.projection", projection as unknown as Json));
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

  private createLandscapeCodeGraphProviders() {
    if (!this.landscape) return {};
    return Object.fromEntries(
      this.landscape.repositories.map((repo) => [
        repo.repositoryId,
        this.codeGraphProviderFactory(repo)
      ])
    );
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

export class RuntimeRpcClient implements RuntimeDaemonClient {
  constructor(private readonly connection: RuntimeRpcConnection) {}

  async health(): Promise<Json> {
    const response = await fetch(`${this.connection.url}health`, {
      headers: { "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION }
    });
    return await response.json() as Json;
  }

  async shutdown(): Promise<JsonEnvelope> {
    return this.call("shutdown", []);
  }

  connectionInfo(): Omit<RuntimeRpcConnection, "token"> {
    const { token: _token, ...safe } = this.connection;
    return safe;
  }

  init(root: string, productName?: string) {
    return this.call("init", [root, productName]);
  }

  sync(root: string, changedPaths: string[] = []) {
    return this.call("sync", [root, changedPaths]);
  }

  validate(root: string) {
    return this.call("validate", [root]);
  }

  context(root: string, task: string, maxSymbols = 12) {
    return this.call("context", [root, task, maxSymbols]);
  }

  prepare(root: string, task: string, maxBytes = 12_288, maxItems = 12) {
    return this.call("prepare", [root, task, maxBytes, maxItems]);
  }

  planUpdate(root: string, input: { id: string; operations: ChangeOperation[]; reason?: { taskSessionId: string; interventionId?: string } }) {
    return this.call("planUpdate", [root, input]);
  }

  applyUpdate(root: string, input: { id: string; approved: boolean; expectedWorktreeDigest: string }) {
    return this.call("applyUpdate", [root, input]);
  }

  repoAdd(root: string, name?: string) {
    return this.call("repoAdd", [root, name]);
  }

  repoList() {
    return this.call("repoList", []);
  }

  repoRemove(repositoryId: string) {
    return this.call("repoRemove", [repositoryId]);
  }

  landscapeStatus() {
    return this.call("landscapeStatus", []);
  }

  explorerServiceContract(tokenTtlSeconds = 900) {
    return this.call("explorerServiceContract", [tokenTtlSeconds]);
  }

  explorerProjection(root: string, query?: string) {
    return this.call("explorerProjection", [root, query]);
  }

  startExplorer(root: string, options: ExplorerServerOptions = {}) {
    return this.call("startExplorer", [root, options]);
  }

  stopExplorer() {
    return this.call("stopExplorer", []);
  }

  revokeExplorerToken() {
    return this.call("revokeExplorerToken", []);
  }

  explorerStatus() {
    return this.call("explorerStatus", []);
  }

  contextLandscape(task: string, maxSymbols = 12) {
    return this.call("contextLandscape", [task, maxSymbols]);
  }

  runtimeStatus(root?: string) {
    return this.call("runtimeStatus", [root]);
  }

  private async call(method: string, params: unknown[]): Promise<JsonEnvelope> {
    const response = await fetch(`${this.connection.url}rpc`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.connection.token}`,
        "Content-Type": "application/json",
        "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION
      },
      body: JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method, params })
    });
    return await response.json() as JsonEnvelope;
  }
}

export class ArchctxRuntimeRpcServer {
  private server?: Server;
  private connection?: RuntimeRpcConnection;
  private lockFd?: number;

  constructor(private readonly daemon: ArchctxDaemon, private readonly options: RuntimeRpcServerOptions = {}) {}

  async start(): Promise<RuntimeRpcConnection> {
    if (this.server) return this.connection!;
    if (!this.daemon.status().running) await this.daemon.start();
    const root = this.options.root ?? process.cwd();
    const connectionPath = this.options.connectionPath ?? defaultDaemonConnectionPath(root);
    const lockPath = this.options.lockPath ?? defaultDaemonLockPath(root);
    mkdirSync(dirname(connectionPath), { recursive: true });
    mkdirSync(dirname(lockPath), { recursive: true });
    this.lockFd = acquireDaemonLock(lockPath, root);
    const token = this.options.token ?? randomBytes(18).toString("base64url");
    const server = createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        writeJson(response, 500, { schemaVersion: RUNTIME_RPC_VERSION, ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    });
    await new Promise<void>((resolveListen) => server.listen(this.options.port ?? 0, "127.0.0.1", resolveListen));
    this.server = server;
    const port = (server.address() as AddressInfo).port;
    this.connection = {
      schemaVersion: RUNTIME_RPC_VERSION,
      protocol: "http-loopback",
      version: 1,
      root,
      url: `http://127.0.0.1:${port}/`,
      token,
      pid: process.pid,
      lockPath,
      connectionPath,
      startedAt: (this.options.clock ?? (() => new Date().toISOString()))()
    };
    writeFileSync(connectionPath, JSON.stringify(this.connection, null, 2), { mode: 0o600 });
    chmodSync(connectionPath, 0o600);
    return this.connection;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    const connection = this.connection;
    this.connection = undefined;
    if (server) {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
    await this.daemon.stop();
    if (connection) rmSync(connection.connectionPath, { force: true });
    if (this.lockFd !== undefined) closeSync(this.lockFd);
    this.lockFd = undefined;
    if (connection) rmSync(connection.lockPath, { force: true });
    this.options.onStop?.();
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("Cache-Control", "no-store");
    if (!isLoopbackRemote(request.socket.remoteAddress)) {
      writeJson(response, 403, { schemaVersion: RUNTIME_RPC_VERSION, ok: false, error: "runtime RPC only accepts loopback clients" });
      return;
    }
    const url = new URL(request.url ?? "/", this.connection?.url ?? "http://127.0.0.1/");
    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, {
        schemaVersion: RUNTIME_RPC_VERSION,
        ok: true,
        pid: process.pid,
        protocol: "http-loopback",
        version: 1,
        product: productVersionManifest(),
        composition: this.daemon.compositionReport()
      });
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/rpc") {
      writeJson(response, 404, { schemaVersion: RUNTIME_RPC_VERSION, ok: false, error: "unknown runtime RPC route" });
      return;
    }
    if (!this.isAuthorized(request)) {
      writeJson(response, 401, { schemaVersion: RUNTIME_RPC_VERSION, ok: false, error: "runtime RPC token required" });
      return;
    }
    const body = await readRequestJson(request) as { schemaVersion?: string; method?: string; params?: unknown[] };
    if (body.schemaVersion !== RUNTIME_RPC_VERSION) {
      writeJson(response, 400, { schemaVersion: RUNTIME_RPC_VERSION, ok: false, error: "runtime RPC version mismatch" });
      return;
    }
    const result = await this.dispatch(body.method ?? "", body.params ?? []);
    writeJson(response, 200, result);
    if (body.method === "shutdown") setTimeout(() => void this.stop(), 0);
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const authorization = request.headers.authorization ?? "";
    const bearer = Array.isArray(authorization) ? authorization[0] : authorization;
    return bearer === `Bearer ${this.connection?.token}`;
  }

  private async dispatch(method: string, params: unknown[]): Promise<JsonEnvelope> {
    switch (method) {
      case "init":
        return this.daemon.init(params[0] as string, params[1] as string | undefined);
      case "sync":
        return this.daemon.sync(params[0] as string, params[1] as string[] | undefined);
      case "validate":
        return this.daemon.validate(params[0] as string);
      case "context":
        return this.daemon.context(params[0] as string, params[1] as string, params[2] as number | undefined);
      case "prepare":
        return this.daemon.prepare(params[0] as string, params[1] as string, params[2] as number | undefined, params[3] as number | undefined);
      case "planUpdate":
        return this.daemon.planUpdate(params[0] as string, params[1] as any);
      case "applyUpdate":
        return this.daemon.applyUpdate(params[0] as string, params[1] as any);
      case "repoAdd":
        return this.daemon.repoAdd(params[0] as string, params[1] as string | undefined);
      case "repoList":
        return this.daemon.repoList();
      case "repoRemove":
        return this.daemon.repoRemove(params[0] as string);
      case "landscapeStatus":
        return this.daemon.landscapeStatus();
      case "explorerServiceContract":
        return this.daemon.explorerServiceContract(params[0] as number | undefined);
      case "explorerProjection":
        return this.daemon.explorerProjection(params[0] as string, params[1] as string | undefined);
      case "startExplorer":
        return this.daemon.startExplorer(params[0] as string, params[1] as ExplorerServerOptions | undefined);
      case "stopExplorer":
        return this.daemon.stopExplorer();
      case "revokeExplorerToken":
        return this.daemon.revokeExplorerToken();
      case "explorerStatus":
        return this.daemon.explorerStatus();
      case "contextLandscape":
        return this.daemon.contextLandscape(params[0] as string, params[1] as number | undefined);
      case "runtimeStatus":
        return this.daemon.runtimeStatus(params[0] as string | undefined);
      case "shutdown":
        return okEnvelope("daemon.stop", { stopping: true } as Json);
      default:
        return {
          schemaVersion: "archcontext.envelope/v1",
          ok: false,
          requestId: "runtime-rpc",
          error: {
            code: "AC_SCHEMA_INVALID",
            message: `Unknown runtime RPC method: ${method}`,
            severity: "error",
            retryable: false,
            action: "upgrade-client"
          }
        };
    }
  }
}

export function defaultDaemonControlDir(root = process.cwd()): string {
  return join(root, ".archcontext", ".local");
}

export function defaultDaemonConnectionPath(root = process.cwd()): string {
  return join(defaultDaemonControlDir(root), "archctxd.json");
}

export function defaultDaemonLockPath(root = process.cwd()): string {
  return join(defaultDaemonControlDir(root), "archctxd.lock");
}

export function readRuntimeRpcConnection(root = process.cwd()): RuntimeRpcConnection | undefined {
  const path = defaultDaemonConnectionPath(root);
  try {
    if (!isPrivateControlFile(path)) return undefined;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as RuntimeRpcConnection;
    return isValidRuntimeRpcConnection(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function createRuntimeRpcClientFromConnectionFile(root = process.cwd()): RuntimeRpcClient | undefined {
  const connection = readRuntimeRpcConnection(root);
  return connection ? new RuntimeRpcClient(connection) : undefined;
}

function numericRepositoryId(repositoryId: string): number {
  let hash = 0;
  for (const char of repositoryId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return Math.max(1, hash);
}

function dedupeExplorerNodes(nodes: ExplorerProjection["nodes"]): ExplorerProjection["nodes"] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()].sort((a, b) => a.id.localeCompare(b.id));
}

function filterExplorerProjection(projection: ExplorerProjection, query = ""): ExplorerProjection {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return projection;
  const nodes = projection.nodes.filter((node) =>
    [node.id, node.name, node.kind, node.repositoryId ?? "", node.verificationStatus, ...node.pressure.signals]
      .join(" ")
      .toLowerCase()
      .includes(normalized)
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    ...projection,
    nodes,
    relations: projection.relations.filter((relation) => nodeIds.has(relation.source) || nodeIds.has(relation.target))
  };
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

export function createProductionDaemon(options: ProductionRuntimeOptions = {}): ArchctxDaemon {
  const deps: RuntimeDeps = {
    localStorePath: options.localStorePath ?? defaultLocalStorePath(options.root),
    maxRepoSessions: options.maxRepoSessions
  };
  assertProductionRuntimeDeps(deps);
  return new ArchctxDaemon(deps, { compositionMode: "production" });
}

export async function createStartedProductionDaemon(options: ProductionRuntimeOptions = {}): Promise<ArchctxDaemon> {
  const daemon = createProductionDaemon(options);
  await daemon.start();
  return daemon;
}

export function assertProductionRuntimeDeps(deps: RuntimeDeps): void {
  const blocked = blockedProductionInjections(deps);
  if (blocked.length > 0) {
    throw new Error(`Production archctxd cannot inject runtime test doubles: ${blocked.join(", ")}`);
  }
}

function runtimeCompositionReport(deps: RuntimeDeps, mode: RuntimeCompositionMode): RuntimeCompositionReport {
  const blocked = blockedProductionInjections(deps);
  return {
    mode,
    productionSafe: blocked.length === 0,
    adapters: {
      codeFacts: deps.codeFacts ? "injected" : "codegraph-cli",
      codeGraphProviderFactory: deps.codeGraphProviderFactory ? "injected" : "codegraph-cli",
      modelStore: deps.modelStore ? "injected" : "yaml",
      localStore: deps.localStore ? "injected" : "sqlite",
      changeSetEngine: deps.changeSetEngine ? "injected" : "default"
    },
    localStorePath: deps.localStorePath,
    blockedProductionInjections: blocked
  };
}

function blockedProductionInjections(deps: RuntimeDeps): string[] {
  return [
    "codeFacts",
    "codeGraphProviderFactory",
    "modelStore",
    "localStore",
    "changeSetEngine",
    "clock"
  ].filter((key) => key in deps);
}

function acquireDaemonLock(lockPath: string, root: string): number {
  try {
    const fd = openSync(lockPath, "wx", 0o600);
    writeFileSync(fd, JSON.stringify({ pid: process.pid, root, startedAt: new Date().toISOString() }, null, 2), "utf8");
    return fd;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    if (isStaleLock(lockPath)) {
      rmSync(lockPath, { force: true });
      return acquireDaemonLock(lockPath, root);
    }
    throw new Error(`archctxd already running for ${root}; lock=${lockPath}`);
  }
}

function isValidRuntimeRpcConnection(value: RuntimeRpcConnection): value is RuntimeRpcConnection {
  return value.schemaVersion === RUNTIME_RPC_VERSION
    && value.protocol === "http-loopback"
    && value.version === 1
    && typeof value.url === "string"
    && value.url.startsWith("http://127.0.0.1:")
    && typeof value.token === "string"
    && value.token.length > 0
    && typeof value.pid === "number"
    && typeof value.connectionPath === "string"
    && typeof value.lockPath === "string";
}

function isPrivateControlFile(path: string): boolean {
  if (process.platform === "win32") return true;
  const mode = statSync(path).mode & 0o777;
  return (mode & 0o077) === 0;
}

function isStaleLock(lockPath: string): boolean {
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number };
    if (typeof lock.pid !== "number" || lock.pid <= 0) return true;
    return !isProcessAlive(lock.pid);
  } catch {
    return true;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function isLoopbackRemote(remoteAddress = ""): boolean {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress);
}

async function readRequestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}
