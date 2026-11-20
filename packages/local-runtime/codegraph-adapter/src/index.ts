import { REQUIRED_CODEGRAPH_PACKAGE, REQUIRED_CODEGRAPH_VERSION } from "./read-session";
import { buildArchitectureCandidateDelta, type ArchitectureDeltaDeclaredGraph, type ArchitectureDeltaGitChangeMetadata } from "@archcontext/core/architecture-delta";
import { repoScopedArchitectureId, type CrossRepoRelation } from "@archcontext/core/architecture-domain";
import { CODE_FACTS_ISSUE_MESSAGES, FailureError, digestJson, type ArchitectureCandidateDeltaV1, type ArchitectureRepositoryIdentityV1, type ArchitectureWorktreeIdentityV1, type CodeFactsPort, type CodeFactsSnapshot, type NormalizedCodeContext, type NormalizedEdge, type NormalizedSymbol, type ObservedEvidence, type SourceSelector, type SymbolQuery, type WorkspaceRef } from "@archcontext/contracts";
import { disableCodeGraphTelemetryByDefault } from "./cli-invocation";
import type { CodeGraphProvider } from "./sdk-provider";
import { normalizeChangedPaths, uniqueStrings } from "./import-population";

export {
  CODEGRAPH_PROVIDER_INTERNAL_EXPORTS,
  CodeGraphProviderUnavailableError,
  REQUIRED_CODEGRAPH_PACKAGE,
  REQUIRED_CODEGRAPH_VERSION,
  openCodeGraphReadSession,
  pinnedCodeGraphProvider,
  withCodeGraphReadSession,
  type CodeGraphIndexCompatibilityV1,
  type CodeGraphIndexFreshnessV1,
  type CodeGraphIndexRevisionV1,
  type CodeGraphReadProvider,
  type CodeGraphReadSession,
  type CodeGraphReadSessionOpenV1
} from "./read-session";
export {
  CODEGRAPH_TELEMETRY_DISABLED_VALUE,
  CODEGRAPH_TELEMETRY_ENV,
  codeGraphCliInvocation,
  disableCodeGraphTelemetryByDefault,
  packagedCodeGraphCliInvocation,
  packagedCodeGraphRuntimeDigest,
  type CodeGraphCliInvocation
} from "./cli-invocation";
export { CodeGraphSdkProvider, type CodeGraphProvider, type CodeGraphReadTarget } from "./sdk-provider";
export { assertReadyCodeGraphIndexWithoutWorktreeWrites } from "./ready-index-read";
export {
  CODEGRAPH_BASE_SCHEMA,
  codeGraphBaseDirectory,
  codeGraphRewritesGitignore,
  refreshCodeGraphBase,
  seedCodeGraphIndexFromBase,
  type CodeGraphBasePointerV1,
  type CodeGraphBaseRefreshOptions,
  type CodeGraphSeedOptions,
  type CodeGraphSeedOutcomeV1
} from "./index-base";
export {
  assertRepositoryCodeFactsReady,
  codeGraphIndexAvailable,
  inspectRepositoryCodeFacts,
  type RepositoryCodeFactsInspectionOptions,
  type RepositoryCodeFactsIssueV1,
  type RepositoryCodeFactsPendingChangesV1,
  type RepositoryCodeFactsV1
} from "./repository-code-facts";
export {
  ProjectionCodeFactsUnavailableError,
  assertProjectionCodeFactsAvailable,
  prepareArchitectureDocumentationProjectionSnapshot,
  prepareProjectionCodeFacts,
  projectionCodeFactsRequired,
  seedProjectionCodeGraphIndex,
  type CodeGraphProjectionHandshakeV1,
  type PreparedArchitectureDocumentationProjectionSnapshot,
  type PreparedProjectionCodeFacts
} from "./projection-handshake";
export {
  CODEGRAPH_IMPORT_NODE_READ_LIMIT,
  repositoryImportPairs,
  type ProjectionImportPopulationV1,
  type RepositoryImportPairV1,
  type RepositoryImportPairsV1
} from "./import-population";
export {
  RUNTIME_BUILTIN_CALL_NAMES,
  loadCapabilityCodeGraphProjectionInputs,
  memoizedSourceDeclarations,
  openCodeGraphSymbolReader,
  type CapabilityCodeGraphProjectionInputs,
  type CodeGraphCallee,
  type CodeGraphIndexedDeclaration,
  type CodeGraphSelectorIndex,
  type CodeGraphSymbolDeclaration,
  type CodeGraphSymbolReader,
  type CodeGraphSymbolReaderResult
} from "./selector-index";

/** One worktree's last verified index: the identity of its database then, and its snapshot. */
interface VerifiedCodeFacts {
  identity: string;
  snapshot: CodeFactsSnapshot;
}

export class CodeGraphAdapter implements CodeFactsPort {
  /** Per worktree root; a read is served only for a root listed here, at the identity listed. */
  readonly #verified = new Map<string, VerifiedCodeFacts>();
  /** The most recent successful sync, for `resolveEvidence`, which reads no index. */
  #latest?: CodeFactsSnapshot;

  constructor(private readonly provider: CodeGraphProvider) {
    disableCodeGraphTelemetryByDefault();
  }

  prepareSync(workspaceRoot: string): void {
    this.assertCompatible();
    this.provider.prepareSync?.(workspaceRoot);
  }

  /**
   * Never starts a writable sync on its own: an existing index is verified read-only, on a first
   * call and on every later one, and its database identity is recorded for the reads. Only a
   * command that owns a sync passes `syncOnMiss`, which syncs a workspace this adapter has not
   * verified yet. An index whose database identity archctx cannot verify is never served: the
   * cached entry is dropped and the call refuses as not ready (retryable).
   */
  async ensureReady(workspace: WorkspaceRef, options: { syncOnMiss?: boolean } = {}): Promise<CodeFactsSnapshot> {
    this.assertCompatible();
    const root = workspace.root;
    const verified = this.#verified.get(root);
    if (!verified && options.syncOnMiss) return this.sync({ workspace });
    this.#verified.delete(root);
    this.provider.assertReady?.(root);
    const identity = this.provider.indexIdentity(root);
    if (identity === undefined) throw codeFactsNotReady();
    const snapshot = verified?.snapshot ?? this.snapshotOf(root, []);
    this.#verified.set(root, { identity, snapshot });
    return snapshot;
  }

  /**
   * Syncs `input.workspace`. Only commands that own a sync call it. The workspace becomes readable
   * only when the provider-resolved database identity of the synced index can be verified.
   */
  async sync(input: { workspace: WorkspaceRef; changedPaths?: string[] }): Promise<CodeFactsSnapshot> {
    this.assertCompatible();
    const root = input.workspace.root;
    this.#verified.delete(root);
    this.#latest = undefined;
    const report = await this.provider.indexAll(root);
    const snapshot = this.snapshotOf(root, input.changedPaths ?? [], report ?? undefined);
    const identity = this.provider.indexIdentity(root);
    if (identity !== undefined) this.#verified.set(root, { identity, snapshot });
    this.#latest = snapshot;
    return snapshot;
  }

  private snapshotOf(root: string, changedPaths: string[], report?: Pick<CodeFactsSnapshot, "codeGraphBase" | "codeGraphKept">): CodeFactsSnapshot {
    return {
      provider: "codegraph",
      version: this.provider.version,
      schemaDigest: digestJson({ package: REQUIRED_CODEGRAPH_PACKAGE, version: this.provider.version, capabilities: this.provider.capabilities }),
      indexedAt: new Date(0).toISOString(),
      workspaceDigest: digestJson({ root, changedPaths }),
      ...(report?.codeGraphBase ? { codeGraphBase: report.codeGraphBase } : {}),
      ...(report?.codeGraphKept?.length ? { codeGraphKept: report.codeGraphKept } : {})
    };
  }

  async buildTaskContext(input: { workspace: WorkspaceRef; task: string; maxSymbols: number; includeSource: boolean; changedPaths?: string[] }): Promise<NormalizedCodeContext> {
    this.assertCompatible();
    return this.provider.buildContext(this.readTarget(input.workspace), input.task, {
      maxSymbols: input.maxSymbols,
      includeSource: input.includeSource,
      changedPaths: normalizeChangedPaths(input.changedPaths ?? [])
    });
  }

  async analyzeChangedSubjects(input: {
    workspace: WorkspaceRef;
    repository: ArchitectureRepositoryIdentityV1;
    worktree: ArchitectureWorktreeIdentityV1;
    git: ArchitectureDeltaGitChangeMetadata;
    declaredGraph?: ArchitectureDeltaDeclaredGraph;
    maxSymbols?: number;
    createdAt?: string;
  }): Promise<ArchitectureCandidateDeltaV1> {
    this.assertCompatible();
    const changedPaths = normalizeChangedPaths(input.git.paths.flatMap((change) => [change.path, change.previousPath ?? ""]));
    await this.sync({ workspace: input.workspace, changedPaths });
    const codeContext = await this.buildTaskContext({
      workspace: input.workspace,
      task: architectureDeltaTask(input.git),
      maxSymbols: input.maxSymbols ?? Math.max(8, changedPaths.length * 4),
      includeSource: false,
      changedPaths
    });
    return buildArchitectureCandidateDelta({
      repository: input.repository,
      worktree: input.worktree,
      git: input.git,
      codeContext,
      declaredGraph: input.declaredGraph,
      codeFactsDigest: codeContext.digest,
      createdAt: input.createdAt,
      provenance: {
        producer: "codegraph-adapter",
        command: "CodeGraphAdapter.analyzeChangedSubjects"
      }
    });
  }

  async findSymbols(query: SymbolQuery, workspace: WorkspaceRef): Promise<NormalizedSymbol[]> {
    this.assertCompatible();
    return this.provider.findSymbols(this.readTarget(workspace), query);
  }

  /**
   * The read target of `workspace`: its root and verified identity. A worktree that has no
   * successful sync in this adapter is not read at all, so a failed sync of another worktree can
   * never redirect a read.
   */
  private readTarget(workspace: WorkspaceRef): { root: string; identity?: string } {
    const verified = this.#verified.get(workspace.root);
    if (!verified) throw codeFactsNotReady();
    return { root: workspace.root, identity: verified.identity };
  }

  async resolveEvidence(selectors: SourceSelector[]): Promise<ObservedEvidence[]> {
    const snapshot = this.#latest;
    if (!snapshot) throw new Error("CodeGraph snapshot unavailable; call ensureReady first");
    return selectors.map((selector, index) => ({
      id: `evidence_${index + 1}`,
      selector,
      summary: `Resolved ${selector.symbolId ?? selector.path} via CodeGraph adapter`,
      confidence: "observed",
      snapshot: {
        repositoryId: "unknown",
        headSha: "unknown",
        worktreeDigest: snapshot.workspaceDigest
      }
    }));
  }

  private assertCompatible(): void {
    disableCodeGraphTelemetryByDefault();
    if (this.provider.version !== REQUIRED_CODEGRAPH_VERSION) {
      throw new Error(`CodeGraph ${REQUIRED_CODEGRAPH_VERSION} required, got ${this.provider.version}`);
    }
    for (const capability of ["index", "context"]) {
      if (!this.provider.capabilities.includes(capability)) {
        throw new Error(`CodeGraph capability missing: ${capability}`);
      }
    }
  }
}

/** Retryable not-ready: the worktree has no verified sync in this adapter that a read may use. */
function codeFactsNotReady(): FailureError {
  return new FailureError("AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", {
    issues: [{ code: "index-incomplete", message: CODE_FACTS_ISSUE_MESSAGES["index-incomplete"] }]
  }, { action: "codegraph-index", retryable: true });
}

export interface LandscapeContextInput {
  task: string;
  workspaces: WorkspaceRef[];
  maxSymbols: number;
  includeSource: boolean;
  activeRepositoryIds?: string[];
}

export class MultiRepoCodeGraphAdapter {
  private readonly adapters = new Map<string, CodeGraphAdapter>();

  constructor(private readonly providers: Record<string, CodeGraphProvider>) {
    disableCodeGraphTelemetryByDefault();
  }

  async syncRepositories(workspaces: WorkspaceRef[]): Promise<CodeFactsSnapshot[]> {
    const snapshots: CodeFactsSnapshot[] = [];
    for (const workspace of workspaces) {
      snapshots.push(await this.adapterFor(workspace.repositoryId).sync({ workspace }));
    }
    return snapshots;
  }

  async buildLandscapeTaskContext(input: LandscapeContextInput): Promise<NormalizedCodeContext> {
    const active = new Set(input.activeRepositoryIds ?? input.workspaces.map((workspace) => workspace.repositoryId));
    const selected = input.workspaces.filter((workspace) => active.has(workspace.repositoryId));
    const perRepoMax = Math.max(1, Math.ceil(input.maxSymbols / Math.max(1, selected.length)));
    const contexts: { workspace: WorkspaceRef; context: NormalizedCodeContext }[] = [];
    for (const workspace of selected) {
      const adapter = this.adapterFor(workspace.repositoryId);
      await adapter.ensureReady(workspace);
      contexts.push({
        workspace,
        context: await adapter.buildTaskContext({
          workspace,
          task: input.task,
          maxSymbols: perRepoMax,
          includeSource: input.includeSource
        })
      });
    }
    const symbols = contexts.flatMap(({ workspace, context }) =>
      context.symbols.map((symbol) => ({
        ...symbol,
        id: repoScopedArchitectureId(workspace.repositoryId, symbol.id),
        path: `${workspace.repositoryId}:${symbol.path}`
      }))
    );
    const edges = contexts.flatMap(({ workspace, context }) =>
      context.edges.map((edge) => ({
        ...edge,
        source: repoScopedArchitectureId(workspace.repositoryId, edge.source),
        target: repoScopedArchitectureId(workspace.repositoryId, edge.target)
      }))
    );
    const evidence = contexts.flatMap(({ workspace, context }) =>
      context.evidence.map((item) => ({
        ...item,
        snapshot: {
          ...item.snapshot,
          repositoryId: workspace.repositoryId,
          headSha: workspace.headSha
        }
      }))
    );
    return {
      task: input.task,
      symbols: symbols.slice(0, input.maxSymbols),
      edges,
      evidence,
      digest: digestJson({
        task: input.task,
        repositories: selected.map((workspace) => workspace.repositoryId),
        symbols,
        edges,
        includeSource: input.includeSource
      })
    };
  }

  crossRepoImpact(relations: CrossRepoRelation[], repositoryId: string): CrossRepoRelation[] {
    return relations
      .filter((relation) => relation.source.repositoryId === repositoryId || relation.target.repositoryId === repositoryId)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private adapterFor(repositoryId: string): CodeGraphAdapter {
    let adapter = this.adapters.get(repositoryId);
    if (!adapter) {
      const provider = this.providers[repositoryId];
      if (!provider) throw new Error(`CodeGraph provider missing for repository: ${repositoryId}`);
      adapter = new CodeGraphAdapter(provider);
      this.adapters.set(repositoryId, adapter);
    }
    return adapter;
  }
}

export function assertNoCodeGraphInternalPathAccess(path: string): void {
  if (path.includes(".codegraph/") || path.endsWith(".codegraph") || path.includes("codegraph.sqlite")) {
    throw new Error("ArchContext must not read CodeGraph internal storage");
  }
}

function architectureDeltaTask(git: ArchitectureDeltaGitChangeMetadata): string {
  return uniqueStrings([
    "architecture delta",
    git.source,
    ...git.paths.flatMap((change) => [change.path, change.previousPath ?? ""])
  ].filter(Boolean)).join(" ");
}
