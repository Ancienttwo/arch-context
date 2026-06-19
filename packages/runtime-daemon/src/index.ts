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
import { okEnvelope, type CodeFactsPort, type Json, type JsonEnvelope, type ModelStorePort, type RepositorySnapshot, type WorkspaceRef } from "../../contracts/src/index";
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

export class ArchctxDaemon {
  private readonly codeFacts: CodeFactsPort;
  private readonly modelStore: ModelStorePort;
  private readonly localStore: InMemoryLocalStore;
  private readonly clock: () => string;
  private readonly maxRepoSessions: number;
  private readonly sessions = new Map<string, RepositorySession>();
  private landscape?: Landscape;
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
}

function numericRepositoryId(repositoryId: string): number {
  let hash = 0;
  for (const char of repositoryId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return Math.max(1, hash);
}

export async function createStartedDaemon(deps: RuntimeDeps = {}): Promise<ArchctxDaemon> {
  const daemon = new ArchctxDaemon(deps);
  await daemon.start();
  return daemon;
}
