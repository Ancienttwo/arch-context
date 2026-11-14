import { REQUIRED_CODEGRAPH_PACKAGE, REQUIRED_CODEGRAPH_VERSION } from "./read-session";
import { buildArchitectureCandidateDelta, type ArchitectureDeltaDeclaredGraph, type ArchitectureDeltaGitChangeMetadata } from "@archcontext/core/architecture-delta";
import { repoScopedArchitectureId, type CrossRepoRelation } from "@archcontext/core/architecture-domain";
import { digestJson, type ArchitectureCandidateDeltaV1, type ArchitectureRepositoryIdentityV1, type ArchitectureWorktreeIdentityV1, type CodeFactsPort, type CodeFactsSnapshot, type ImpactQuery, type NormalizedCodeContext, type NormalizedEdge, type NormalizedImpact, type NormalizedSymbol, type ObservedEvidence, type SourceSelector, type SymbolQuery, type WorkspaceRef } from "@archcontext/contracts";
import { disableCodeGraphTelemetryByDefault, type CodeGraphProvider } from "./cli-provider";
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
  CodeGraphCliProvider,
  codeGraphCliInvocation,
  disableCodeGraphTelemetryByDefault,
  packagedCodeGraphCliInvocation,
  packagedCodeGraphRuntimeDigest,
  type CodeGraphCliInvocation,
  type CodeGraphProvider
} from "./cli-provider";
export {
  assertRepositoryCodeFactsReady,
  codeGraphIndexAvailable,
  inspectRepositoryCodeFacts,
  type RepositoryCodeFactsInspectionOptions,
  type RepositoryCodeFactsPendingChangesV1,
  type RepositoryCodeFactsV1
} from "./repository-code-facts";
export {
  ProjectionCodeFactsUnavailableError,
  assertProjectionCodeFactsAvailable,
  prepareArchitectureDocumentationProjectionSnapshot,
  prepareProjectionCodeFacts,
  projectionCodeFactsRequired,
  projectionCodeGraphStatusIssues,
  type CodeGraphProjectionHandshakeV1,
  type CodeGraphProjectionStatusV1,
  type PreparedArchitectureDocumentationProjectionSnapshot,
  type PreparedProjectionCodeFacts,
  type ProjectionCodeGraphStatusIssueCode,
  type ProjectionCodeGraphStatusIssueV1
} from "./projection-handshake";
export {
  CODEGRAPH_SNAPSHOT_MAX_BYTES,
  CODEGRAPH_SNAPSHOT_MAX_ENTRIES,
  codeGraphSnapshotQueries,
  codeGraphSnapshotRuntime,
  withExistingCodeGraphSnapshot
} from "./snapshot";
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

export class CodeGraphAdapter implements CodeFactsPort {
  #snapshot?: CodeFactsSnapshot;

  constructor(private readonly provider: CodeGraphProvider) {
    disableCodeGraphTelemetryByDefault();
  }

  assertCanSync(workspaceRoot: string): void {
    this.assertCompatible();
    this.provider.assertCanSync?.(workspaceRoot);
  }

  async ensureReady(workspace: WorkspaceRef): Promise<CodeFactsSnapshot> {
    this.assertCompatible();
    if (this.#snapshot) this.provider.assertReady?.(workspace.root);
    this.#snapshot ??= await this.sync({ workspace });
    return this.#snapshot;
  }

  async sync(input: { workspace: WorkspaceRef; changedPaths?: string[] }): Promise<CodeFactsSnapshot> {
    this.assertCompatible();
    await this.provider.indexAll(input.workspace.root);
    this.#snapshot = {
      provider: "codegraph",
      version: this.provider.version,
      schemaDigest: digestJson({ package: REQUIRED_CODEGRAPH_PACKAGE, version: this.provider.version, capabilities: this.provider.capabilities }),
      indexedAt: new Date(0).toISOString(),
      workspaceDigest: digestJson({ root: input.workspace.root, changedPaths: input.changedPaths ?? [] })
    };
    return this.#snapshot;
  }

  async buildTaskContext(input: { task: string; maxSymbols: number; includeSource: boolean; changedPaths?: string[] }): Promise<NormalizedCodeContext> {
    this.assertCompatible();
    return this.provider.buildContext(input.task, { ...input, changedPaths: normalizeChangedPaths(input.changedPaths ?? []) });
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

  async findSymbols(query: SymbolQuery): Promise<NormalizedSymbol[]> {
    this.assertCompatible();
    return this.provider.findSymbols(query);
  }

  async getImpact(input: ImpactQuery): Promise<NormalizedImpact> {
    this.assertCompatible();
    return this.provider.getImpactRadius(input.symbolId, input.depth);
  }

  async getCallers(symbolId: string): Promise<NormalizedEdge[]> {
    return (await this.getImpact({ symbolId, depth: 1 })).callers;
  }

  async getCallees(symbolId: string): Promise<NormalizedEdge[]> {
    return (await this.getImpact({ symbolId, depth: 1 })).callees;
  }

  async resolveEvidence(selectors: SourceSelector[]): Promise<ObservedEvidence[]> {
    const snapshot = this.#snapshot;
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
    for (const capability of ["index", "context", "impact"]) {
      if (!this.provider.capabilities.includes(capability)) {
        throw new Error(`CodeGraph capability missing: ${capability}`);
      }
    }
  }
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
