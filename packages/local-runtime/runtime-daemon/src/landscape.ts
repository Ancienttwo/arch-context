import {
  addRepositoryToLandscape,
  createLandscape,
  landscapeDigest,
  validateLandscape,
  type Landscape,
  type RepositoryRegistration
} from "@archcontext/core/architecture-domain";
import { compileLandscapeTaskContext } from "@archcontext/core/context-compiler";
import { errorEnvelope, okEnvelope, type Json, type JsonEnvelope, type ModelStorePort, type WorkspaceRef } from "@archcontext/contracts";
import { MultiRepoCodeGraphAdapter, type CodeGraphProvider } from "@archcontext/local-runtime/codegraph-adapter";
import type { RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";

interface LandscapeContext {
  assertRunning(): void;
  localStore: Pick<RuntimeLocalStore, "saveLandscape" | "readLandscape" | "listRepositorySessions" | "listCrossRepoRelations" | "commitRepositoryRemoval">;
  /** The daemon's open repository sessions; the landscape only checks, drops and lists them. */
  sessions: Pick<Map<string, unknown>, "has" | "delete" | "keys">;
  openSession(root: string): Promise<{ workspace: WorkspaceRef }>;
  codeGraphProviderFactory: (repository: RepositoryRegistration) => CodeGraphProvider;
  readModelStore: ModelStorePort;
}

/** Owns the local multi-repository landscape: registration, removal, persistence and landscape context. */
export class LandscapeService {
  private landscape?: Landscape;

  constructor(private readonly context: LandscapeContext) {}

  async repoAdd(root: string, name?: string): Promise<JsonEnvelope> {
    this.context.assertRunning();
    const session = await this.context.openSession(root);
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
    await this.context.localStore.saveLandscape(this.landscape);
    return okEnvelope("repo.add", { repository, landscapeDigest: landscapeDigest(this.landscape) } as unknown as Json);
  }

  async repoList(): Promise<JsonEnvelope> {
    this.context.assertRunning();
    return okEnvelope("repo.list", {
      repositories: this.landscape?.repositories ?? [],
      activeSessions: [...this.context.sessions.keys()].sort()
    } as unknown as Json);
  }

  /**
   * Removal is durable and leaves the saved landscape self-consistent. The persisted
   * `repository_sessions` row is deleted (otherwise `restoreRepositorySessions` resurrects the
   * repository on the next daemon start), the repository is dropped from `scope`'s default active
   * set, and every stored cross-repo relation touching it is detached from `landscape.relations`.
   * The `cross_repo_edges` rows themselves are kept: they are architectural history, and
   * `listCrossRepoRelations(landscape)` already filters to the active landscape's relation IDs, so
   * detaching is enough to keep them out of live context. Relation IDs that resolve to no stored
   * relation are left alone — there is nothing to check them against.
   *
   * Every rejection is decided before the first write. The post-removal landscape can be invalid
   * for reasons that have nothing to do with this repository (a relation pointing at an
   * unregistered endpoint, say), and a removal that answers with an error must leave the in-memory
   * session map, the persisted session row, and the saved landscape exactly as it found them —
   * otherwise the daemon reports failure while already having dropped the session.
   */
  async repoRemove(repositoryId: string): Promise<JsonEnvelope> {
    this.context.assertRunning();
    const hadOpenSession = this.context.sessions.has(repositoryId);
    const hadPersistedSession = (await this.context.localStore.listRepositorySessions())
      .some((session) => session.repositoryId === repositoryId);
    const registered = this.landscape?.repositories.some((repo) => repo.repositoryId === repositoryId) ?? false;
    if (!registered && !hadOpenSession && !hadPersistedSession) {
      return errorEnvelope("repo.remove", "AC_REPO_NOT_FOUND", `repository is not registered: ${repositoryId}`);
    }
    let detachedRelationIds: string[] = [];
    let nextLandscape: Landscape | undefined;
    if (this.landscape) {
      detachedRelationIds = (await this.context.localStore.listCrossRepoRelations(this.landscape))
        .filter((relation) => relation.source.repositoryId === repositoryId || relation.target.repositoryId === repositoryId)
        .map((relation) => relation.id)
        .sort();
      const detached = new Set(detachedRelationIds);
      const next: Landscape = {
        ...this.landscape,
        repositories: this.landscape.repositories.filter((repo) => repo.repositoryId !== repositoryId),
        relations: this.landscape.relations.filter((relationId) => !detached.has(relationId)),
        ...(this.landscape.scope === undefined ? {} : {
          scope: {
            ...this.landscape.scope,
            defaultActiveRepositories: (this.landscape.scope.defaultActiveRepositories ?? [])
              .filter((activeId) => activeId !== repositoryId)
          }
        })
      };
      const validation = validateLandscape(next, await this.context.localStore.listCrossRepoRelations(next));
      if (!validation.valid) {
        return errorEnvelope("repo.remove", "AC_SCHEMA_INVALID", validation.errors.join("; "));
      }
      nextLandscape = next;
    }
    await this.context.localStore.commitRepositoryRemoval(repositoryId, nextLandscape);
    this.context.sessions.delete(repositoryId);
    if (nextLandscape) this.landscape = nextLandscape;
    return okEnvelope("repo.remove", {
      repositoryId,
      removed: true,
      sessionRemoved: hadOpenSession || hadPersistedSession,
      detachedRelationIds
    } as unknown as Json);
  }

  async loadLandscape(landscape: Landscape): Promise<JsonEnvelope> {
    this.context.assertRunning();
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
    await this.context.localStore.saveLandscape(landscape);
    return okEnvelope("landscape", { id: landscape.id, repositories: landscape.repositories.length, digest: landscapeDigest(landscape) } as Json);
  }

  async landscapeStatus(): Promise<JsonEnvelope> {
    this.context.assertRunning();
    const landscape = this.landscape ?? createLandscape({ id: "local", name: "Local Landscape", repositories: [] });
    return okEnvelope("landscape", {
      ...landscape,
      digest: landscapeDigest(landscape)
    } as unknown as Json);
  }

  async contextLandscape(task: string, maxSymbols = 12): Promise<JsonEnvelope> {
    this.context.assertRunning();
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
        const session = repo.root ? await this.context.openSession(repo.root) : undefined;
        return session?.workspace ?? { root: repo.root ?? repo.repositoryId, repositoryId: repo.repositoryId, headSha: "unknown" };
      })
    );
    const context = await compileLandscapeTaskContext({
      landscape: this.landscape,
      relations: await this.context.localStore.listCrossRepoRelations(this.landscape),
      workspaces,
      task,
      codeFacts: new MultiRepoCodeGraphAdapter(this.createLandscapeCodeGraphProviders()),
      modelStore: this.context.readModelStore,
      budget: { maxBytes: 12_288, maxItems: maxSymbols }
    });
    return okEnvelope("context", context as unknown as Json);
  }

  /** Loads the persisted landscape. The daemon's `start()` calls this before it restores sessions. */
  async restore(): Promise<void> {
    const landscape = await this.context.localStore.readLandscape("landscape.local");
    if (!landscape) return;
    const validation = validateLandscape(landscape);
    if (!validation.valid) {
      throw new Error(`persisted-landscape-invalid: ${validation.errors.join("; ")}`);
    }
    this.landscape = landscape;
  }

  private createLandscapeCodeGraphProviders() {
    if (!this.landscape) return {};
    return Object.fromEntries(
      this.landscape.repositories.map((repo) => [
        repo.repositoryId,
        this.context.codeGraphProviderFactory(repo)
      ])
    );
  }
}

function numericRepositoryId(repositoryId: string): number {
  let hash = 0;
  for (const char of repositoryId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return Math.max(1, hash);
}
