import type { Node as CodeGraphNode, NodeKind as CodeGraphNodeKind } from "@colbymchenry/codegraph";
import { REQUIRED_CODEGRAPH_VERSION, openCodeGraphReadSession, type CodeGraphIndexHandle, type CodeGraphReadProvider, type CodeGraphReadSession, type CodeGraphReadSessionOpenV1 } from "./read-session";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { CODE_FACTS_ISSUE_MESSAGES, FailureError, digestJson, type Json, type NormalizedCodeContext, type NormalizedEdge, type NormalizedSymbol, type SymbolQuery } from "@archcontext/contracts";
import { DEFAULT_CODEGRAPH_BINARY, syncCodeGraphIndex } from "./cli-invocation";
import { importEdgesFromQueryNodes, importQuery, uniqueStrings } from "./import-population";
import { assertRepositoryCodeFactsReady, codeFactsUnavailableError } from "./repository-code-facts";

export interface CodeGraphProvider {
  version: string;
  capabilities: string[];
  assertReady?(workspaceRoot: string): void;
  assertCanSync?(workspaceRoot: string): void;
  indexAll(workspaceRoot: string): Promise<void>;
  buildContext(task: string, options: { maxSymbols: number; includeSource: boolean; changedPaths?: string[] }): Promise<NormalizedCodeContext>;
  findSymbols(query: SymbolQuery): Promise<NormalizedSymbol[]>;
}

/**
 * The CodeGraph provider: SDK reads through one read-only session per read, and the CLI's `sync` to
 * build the index (ADR-0058). A read starts no CodeGraph command and never opens the index writable.
 */
export class CodeGraphSdkProvider implements CodeGraphProvider {
  version: string = REQUIRED_CODEGRAPH_VERSION;
  capabilities = ["index", "context"];
  private workspaceRoot: string;

  /**
   * `binary` builds the index (`sync`); reads never start it. `readProvider` is the read-only
   * provider every read and readiness check opens the index through, the pinned one unless a test
   * injects one.
   */
  constructor(workspaceRoot = process.cwd(), private readonly binary = DEFAULT_CODEGRAPH_BINARY, private readonly readProvider?: CodeGraphReadProvider) {
    this.workspaceRoot = workspaceRoot;
  }

  async indexAll(workspaceRoot: string): Promise<void> {
    this.workspaceRoot = workspaceRoot;
    this.assertCanSync(workspaceRoot);
    syncCodeGraphIndex(workspaceRoot, this.binary);
    this.assertReady(workspaceRoot);
  }

  assertReady(workspaceRoot: string): void {
    assertRepositoryCodeFactsReady(workspaceRoot, this.readProvider ? { provider: this.readProvider } : {});
  }

  assertCanSync(workspaceRoot: string): void {
    this.assertReady(workspaceRoot);
  }

  /**
   * C6 (#574): the file set comes from `findRelevantContext(query)`, the query nodes from
   * `searchNodes`, both read in one session. Symbols are the query nodes, then the file nodes of the
   * relevant files in relevance order, capped at `maxSymbols`.
   */
  async buildContext(task: string, options: { maxSymbols: number; includeSource: boolean; changedPaths?: string[] }): Promise<NormalizedCodeContext> {
    const changedPaths = options.changedPaths ?? [];
    const query = scopedTaskQuery(task, changedPaths);
    const scopedImportQuery = importQuery(changedPaths);
    const read = await this.read(async (graph) => {
      const relevantFiles = relevantFilesOf(await graph.findRelevantContext(query)).slice(0, options.maxSymbols);
      return {
        relevantFiles,
        fileNodes: fileNodesOf(graph, relevantFiles),
        queryNodes: rankedSearch(graph, query, Math.max(options.maxSymbols * 4, 12)),
        importNodes: scopedImportQuery ? rankedSearch(graph, scopedImportQuery, Math.max(changedPaths.length * 8, 12), ["import"]) : []
      };
    });
    const symbols = uniqueSymbols([
      ...read.queryNodes.filter((node) => node.kind !== "import"),
      ...read.fileNodes
    ].map(normalizeNode)).slice(0, options.maxSymbols);
    const edges = uniqueEdges(importEdgesFromQueryNodes(new Set(listGitVisibleFiles(this.workspaceRoot)), read.importNodes.length > 0 ? read.importNodes : read.queryNodes));
    return {
      task,
      symbols,
      edges,
      evidence: symbols.map((symbol, index) => ({
        id: `evidence_${index + 1}`,
        selector: { path: symbol.path, symbolId: symbol.id, startLine: symbol.range?.startLine, endLine: symbol.range?.endLine },
        summary: `Observed by CodeGraph for task: ${task}`,
        confidence: "observed",
        snapshot: {
          repositoryId: "codegraph",
          headSha: "codegraph",
          worktreeDigest: digestJson({ task, path: symbol.path, relevantFiles: read.relevantFiles } as unknown as Json)
        }
      })),
      digest: digestJson({ task, symbols, edges, includeSource: options.includeSource, relevantFiles: read.relevantFiles } as unknown as Json)
    };
  }

  /** `searchNodes`, restricted to `query.kinds` when given, ranked deterministically. */
  async findSymbols(query: SymbolQuery): Promise<NormalizedSymbol[]> {
    const nodes = await this.read((graph) => rankedSearch(graph, query.query, query.limit ?? 10, query.kinds));
    return nodes.map(normalizeNode);
  }

  /**
   * Runs `read` against one read-only session that is closed when it settles. Every failure leaves
   * as a `FailureError` without provider text, and the read is never retried, never with a writable
   * open:
   * - the pinned provider cannot load: `code-facts-unavailable`, as the readiness gate maps it;
   * - the session does not open: its state's refusal;
   * - the index moved during the read, whether the read then threw or not: retryable not-ready,
   *   because facts read across a build or a sync are not one index state (design G4);
   * - any other throw inside the read, including a write the read-only handle refuses:
   *   `index-open-failed`.
   * A failing `close()` never replaces the read's own error; after a good read it is `index-open-failed`.
   */
  private async read<T>(read: (graph: CodeGraphIndexHandle) => T | Promise<T>): Promise<T> {
    let opened: CodeGraphReadSessionOpenV1;
    try {
      opened = openCodeGraphReadSession(this.workspaceRoot, this.readProvider ? { provider: this.readProvider } : {});
    } catch {
      throw codeFactsUnavailableError();
    }
    if (opened.state !== "open") throw readRefusal(opened.state);
    const { session } = opened;
    let outcome: { value: T } | { error: FailureError };
    try {
      const value = await read(session.graph);
      outcome = session.unchangedSinceOpen() ? { value } : { error: readRefusal("build-in-progress") };
    } catch {
      outcome = { error: readRefusal(indexMoved(session) ? "build-in-progress" : "index-open-failed") };
    }
    try {
      session.close();
    } catch {
      if ("value" in outcome) outcome = { error: readRefusal("index-open-failed") };
    }
    if ("error" in outcome) throw outcome.error;
    return outcome.value;
  }
}

/** True only when the session can still tell that the index moved; a failing check proves nothing. */
function indexMoved(session: CodeGraphReadSession): boolean {
  try {
    return !session.unchangedSinceOpen();
  } catch {
    return false;
  }
}

function readRefusal(state: Exclude<CodeGraphReadSessionOpenV1["state"], "open">): FailureError {
  switch (state) {
    case "index-missing":
      return new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-missing");
    case "index-open-failed":
      return new FailureError("AC_CODE_FACTS_UNAVAILABLE", "index-open-failed");
    case "build-in-progress":
      return new FailureError("AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", {
        issues: [{ code: "index-incomplete", message: CODE_FACTS_ISSUE_MESSAGES["index-incomplete"] }]
      }, { action: "codegraph-index", retryable: true });
  }
}

function normalizeNode(node: CodeGraphNode): NormalizedSymbol {
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    path: node.filePath,
    range: { startLine: node.startLine, endLine: node.endLine }
  };
}

function scopedTaskQuery(task: string, changedPaths: string[]): string {
  return uniqueStrings([task, ...changedPaths]).join(" ");
}

function compareNodes(a: CodeGraphNode, b: CodeGraphNode): number {
  return a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine || a.id.localeCompare(b.id);
}

/**
 * `searchNodes` in a total order: hand-written before generated files, as the CodeGraph CLI ranks
 * (`generatedFilePredicate`), then by score, then by location, so equal scores never reorder.
 */
function rankedSearch(graph: CodeGraphIndexHandle, query: string, limit: number, kinds: string[] = []): CodeGraphNode[] {
  const results = graph.searchNodes(query, { limit, ...(kinds.length > 0 ? { kinds: kinds as CodeGraphNodeKind[] } : {}) });
  const generated = graph.generatedFilePredicate(results.map((result) => result.node.filePath));
  return results
    .map((result) => ({ result, generated: generated(result.node.filePath) ? 1 : 0 }))
    .sort((a, b) => a.generated - b.generated || b.result.score - a.result.score || compareNodes(a.result.node, b.result.node))
    .map(({ result }) => result.node);
}

/** The files of a relevant-context subgraph: its entry points' files first, then in node order. */
function relevantFilesOf(subgraph: { nodes: Map<string, CodeGraphNode>; roots: string[] }): string[] {
  const roots = subgraph.roots.flatMap((id) => subgraph.nodes.get(id) ?? []);
  return uniqueStrings([...roots, ...subgraph.nodes.values()].map((node) => node.filePath));
}

/** The index's file node of each path, in the order of `paths`. */
function fileNodesOf(graph: CodeGraphIndexHandle, paths: string[]): CodeGraphNode[] {
  if (paths.length === 0) return [];
  const byPath = new Map(graph.getNodesInFiles(paths).filter((node) => node.kind === "file").map((node) => [node.filePath, node] as const));
  return paths.flatMap((path) => byPath.get(path) ?? []);
}

function uniqueSymbols(symbols: NormalizedSymbol[]): NormalizedSymbol[] {
  const seen = new Set<string>();
  return symbols.filter((symbol) => {
    const key = `${symbol.id}:${symbol.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueEdges(edges: NormalizedEdge[]): NormalizedEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.kind}:${edge.source}:${edge.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

