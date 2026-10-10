import { digestJson, type Json, type NormalizedCodeContext, type NormalizedImpact, type NormalizedSymbol, type SymbolQuery } from "@archcontext/contracts";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CodeGraphProvider, REQUIRED_CODEGRAPH_VERSION } from "../src/index";

/**
 * Projection fixtures that run without a CodeGraph index declare code facts optional; with the
 * default `codeFacts.required: true` the projection refuses with `AC_CODE_FACTS_UNAVAILABLE`.
 */
export function declareOptionalCodeFacts(root: string): void {
  const manifestPath = join(root, ".archcontext/manifest.yaml");
  const manifest = readFileSync(manifestPath, "utf8");
  const optional = manifest.replace(/^(codeFacts:\n(?: {2}.*\n)*? {2}required: )true$/m, "$1false");
  if (optional === manifest) throw new Error("fixture manifest does not declare codeFacts.required: true");
  writeFileSync(manifestPath, optional, "utf8");
}

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
