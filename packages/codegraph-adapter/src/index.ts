import { digestJson, type CodeFactsPort, type CodeFactsSnapshot, type ImpactQuery, type NormalizedCodeContext, type NormalizedEdge, type NormalizedImpact, type NormalizedSymbol, type ObservedEvidence, type SourceSelector, type SymbolQuery, type WorkspaceRef } from "../../contracts/src/index";

export const REQUIRED_CODEGRAPH_PACKAGE = "@colbymchenry/codegraph";
export const REQUIRED_CODEGRAPH_VERSION = "1.0.1";

export interface CodeGraphProvider {
  version: string;
  capabilities: string[];
  indexAll(workspaceRoot: string): Promise<void>;
  buildContext(task: string, options: { maxSymbols: number; includeSource: boolean }): Promise<NormalizedCodeContext>;
  findSymbols(query: SymbolQuery): Promise<NormalizedSymbol[]>;
  getImpactRadius(symbolId: string, depth: number): Promise<NormalizedImpact>;
}

export class CodeGraphAdapter implements CodeFactsPort {
  #snapshot?: CodeFactsSnapshot;

  constructor(private readonly provider: CodeGraphProvider) {
    process.env.DO_NOT_TRACK ??= "1";
  }

  async ensureReady(workspace: WorkspaceRef): Promise<CodeFactsSnapshot> {
    this.assertCompatible();
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

  async buildTaskContext(input: { task: string; maxSymbols: number; includeSource: boolean }): Promise<NormalizedCodeContext> {
    this.assertCompatible();
    return this.provider.buildContext(input.task, input);
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

export class MockCodeGraphProvider implements CodeGraphProvider {
  version = REQUIRED_CODEGRAPH_VERSION;
  capabilities = ["index", "context", "impact"];
  indexedRoots: string[] = [];

  async indexAll(workspaceRoot: string): Promise<void> {
    this.indexedRoots.push(workspaceRoot);
  }

  async buildContext(task: string, options: { maxSymbols: number; includeSource: boolean }): Promise<NormalizedCodeContext> {
    const symbols: NormalizedSymbol[] = [
      { id: "symbol.prepareTask", name: "prepareTask", kind: "function", path: "packages/application/src/index.ts" }
    ].slice(0, options.maxSymbols);
    return {
      task,
      symbols,
      edges: [],
      evidence: [],
      digest: digestJson({ task, symbols, includeSource: options.includeSource })
    };
  }

  async findSymbols(query: SymbolQuery): Promise<NormalizedSymbol[]> {
    return [{ id: `symbol.${query.query}`, name: query.query, kind: query.kinds?.[0] ?? "symbol", path: "src/index.ts" }];
  }

  async getImpactRadius(symbolId: string, _depth: number): Promise<NormalizedImpact> {
    return { symbolId, callers: [], callees: [], affectedPaths: [] };
  }
}

export function assertNoCodeGraphInternalPathAccess(path: string): void {
  if (path.includes(".codegraph/") || path.endsWith(".codegraph") || path.includes("codegraph.sqlite")) {
    throw new Error("ArchContext must not read CodeGraph internal storage");
  }
}
