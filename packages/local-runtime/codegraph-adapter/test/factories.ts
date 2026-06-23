import { digestJson, type Json, type NormalizedCodeContext, type NormalizedImpact, type NormalizedSymbol, type SymbolQuery } from "@archcontext/contracts";
import { type CodeGraphProvider, REQUIRED_CODEGRAPH_VERSION } from "../src/index";

export class MockCodeGraphProvider implements CodeGraphProvider {
  version = REQUIRED_CODEGRAPH_VERSION;
  capabilities = ["index", "context", "impact"];
  indexedRoots: string[] = [];

  async indexAll(workspaceRoot: string): Promise<void> {
    this.indexedRoots.push(workspaceRoot);
  }

  async buildContext(task: string, options: { maxSymbols: number; includeSource: boolean; changedPaths?: string[] }): Promise<NormalizedCodeContext> {
    const symbols: NormalizedSymbol[] = [
      { id: "symbol.prepareTask", name: "prepareTask", kind: "function", path: "packages/core/application/src/index.ts" }
    ].slice(0, options.maxSymbols);
    return {
      task,
      symbols,
      edges: [],
      evidence: [],
      digest: digestJson({ task, symbols, includeSource: options.includeSource } as unknown as Json)
    };
  }

  async findSymbols(query: SymbolQuery): Promise<NormalizedSymbol[]> {
    return [{ id: `symbol.${query.query}`, name: query.query, kind: query.kinds?.[0] ?? "symbol", path: "src/index.ts" }];
  }

  async getImpactRadius(symbolId: string, _depth: number): Promise<NormalizedImpact> {
    return { symbolId, callers: [], callees: [], affectedPaths: [] };
  }
}
