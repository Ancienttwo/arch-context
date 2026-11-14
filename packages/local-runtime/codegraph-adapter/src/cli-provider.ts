import { assertLocalEgressAllowed, localEgressMode } from "@archcontext/local-runtime/egress-admission";
import { execFileSync } from "node:child_process";
import { accessSync, closeSync, constants as fsConstants, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import type { Edge as CodeGraphEdge, Node as CodeGraphNode, NodeKind as CodeGraphNodeKind } from "@colbymchenry/codegraph";
import { codeGraphChildEnv } from "./child-env";
import { REQUIRED_CODEGRAPH_PACKAGE, REQUIRED_CODEGRAPH_VERSION, openCodeGraphReadSession, type CodeGraphIndexHandle, type CodeGraphReadProvider, type CodeGraphReadSession, type CodeGraphReadSessionOpenV1 } from "./read-session";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { CODE_FACTS_ISSUE_MESSAGES, FailureError, digestJson, type Json, type NormalizedCodeContext, type NormalizedEdge, type NormalizedImpact, type NormalizedSymbol, type SymbolQuery } from "@archcontext/contracts";
import { importEdgesFromQueryNodes, importQuery, uniqueStrings } from "./import-population";
import { assertRepositoryCodeFactsReady } from "./repository-code-facts";

export const CODEGRAPH_TELEMETRY_ENV = "DO_NOT_TRACK";
export const CODEGRAPH_TELEMETRY_DISABLED_VALUE = "1";
export const DEFAULT_CODEGRAPH_BINARY = "codegraph";
const requireFromAdapter = createRequire(import.meta.url);

type MutableEnv = Record<string, string | undefined>;
export const CODEGRAPH_OUTPUT_MAX_BYTES = 32 * 1024 * 1024;
export const CODEGRAPH_QUERY_TIMEOUT_MS = 30_000;

export function disableCodeGraphTelemetryByDefault(env: MutableEnv = process.env): string {
  localEgressMode(env);
  if (env[CODEGRAPH_TELEMETRY_ENV] !== undefined && env[CODEGRAPH_TELEMETRY_ENV] !== CODEGRAPH_TELEMETRY_DISABLED_VALUE) assertLocalEgressAllowed("codegraph-telemetry", env);
  env[CODEGRAPH_TELEMETRY_ENV] ??= CODEGRAPH_TELEMETRY_DISABLED_VALUE;
  return env[CODEGRAPH_TELEMETRY_ENV] ?? CODEGRAPH_TELEMETRY_DISABLED_VALUE;
}

export interface CodeGraphProvider {
  version: string;
  capabilities: string[];
  assertReady?(workspaceRoot: string): void;
  assertCanSync?(workspaceRoot: string): void;
  indexAll(workspaceRoot: string): Promise<void>;
  buildContext(task: string, options: { maxSymbols: number; includeSource: boolean; changedPaths?: string[] }): Promise<NormalizedCodeContext>;
  findSymbols(query: SymbolQuery): Promise<NormalizedSymbol[]>;
  getImpactRadius(symbolId: string, depth: number): Promise<NormalizedImpact>;
}

/**
 * Builds the index with the CodeGraph CLI. `sync` is the only command it starts (ADR-0058 Decision
 * 2), under `codeGraphChildEnv`; no read goes through it.
 */
class CodeGraphCliIndexBuilder {
  constructor(private readonly binary: string) {}

  sync(workspaceRoot: string): void {
    const invocation = this.binary === DEFAULT_CODEGRAPH_BINARY ? packagedCodeGraphCliInvocation() : codeGraphCliInvocation(this.binary, workspaceRoot);
    runCodeGraphInvocation(invocation, workspaceRoot, ["sync", workspaceRoot], CODEGRAPH_OUTPUT_MAX_BYTES);
  }
}

/** Edge kinds that make a caller or a callee: a call, or a construction, which calls the constructor. */
const CALL_EDGE_KINDS: CodeGraphEdge["kind"][] = ["calls", "instantiates"];

/**
 * The CodeGraph provider: a CLI builder for the index and SDK reads through one read-only session
 * per read (ADR-0058). A read starts no CodeGraph command and never opens the index writable.
 */
export class CodeGraphCliProvider implements CodeGraphProvider {
  version: string = REQUIRED_CODEGRAPH_VERSION;
  capabilities = ["index", "context", "impact"];
  private workspaceRoot: string;
  private readonly builder: CodeGraphCliIndexBuilder;

  /**
   * `binary` builds the index (`sync`); reads never start it. `readProvider` is the read-only
   * provider every read and readiness check opens the index through, the pinned one unless a test
   * injects one.
   */
  constructor(workspaceRoot = process.cwd(), binary = DEFAULT_CODEGRAPH_BINARY, private readonly readProvider?: CodeGraphReadProvider) {
    this.workspaceRoot = workspaceRoot;
    this.builder = new CodeGraphCliIndexBuilder(binary);
  }

  async indexAll(workspaceRoot: string): Promise<void> {
    this.workspaceRoot = workspaceRoot;
    this.assertCanSync(workspaceRoot);
    this.builder.sync(workspaceRoot);
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
   * `symbolId` names a node id, else exact qualified names or names; every definition it names takes
   * part, so an ambiguous name gives the union over its definitions and an unknown one an empty
   * result. `affectedPaths` are the files of CodeGraph's impact radius at `depth`; callers and
   * callees are the direct `calls` and `instantiates` edges of the definitions. A type reference is
   * no call, so it reaches only `affectedPaths` (#574 design amendment).
   */
  async getImpactRadius(symbolId: string, depth: number): Promise<NormalizedImpact> {
    return this.read((graph) => impactOf(graph, symbolId, depth));
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
      throw codeGraphUnavailable();
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

/** The pinned provider could not load: the readiness gate's `codegraph-unavailable` refusal. */
function codeGraphUnavailable(): FailureError {
  return new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-unavailable", {}, { action: "inspect-diagnostics", retryable: false });
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

export interface CodeGraphCliInvocation {
  command: string;
  argsPrefix: string[];
}

/** Projection-runtime resolution is deliberately package-local; PATH is not an authority. */
export function packagedCodeGraphCliInvocation(): CodeGraphCliInvocation {
  const packagedShim = resolvePackagedCodeGraphShim();
  if (!packagedShim) {
    throw new Error(`CodeGraph package-local ${REQUIRED_CODEGRAPH_VERSION} binary is unavailable`);
  }
  return { command: process.execPath, argsPrefix: [packagedShim] };
}

export function codeGraphCliInvocation(binary: string, cwd: string, pathValue = process.env.PATH ?? ""): CodeGraphCliInvocation {
  const resolved = resolveExecutable(binary, cwd, pathValue);
  if (resolved && isNodeRuntimeScript(resolved)) {
    return { command: process.execPath, argsPrefix: [resolved] };
  }
  if (!resolved && binary === DEFAULT_CODEGRAPH_BINARY) {
    const packagedShim = resolvePackagedCodeGraphShim();
    if (packagedShim) return { command: process.execPath, argsPrefix: [packagedShim] };
  }
  return { command: binary, argsPrefix: [] };
}

function resolveExecutable(binary: string, cwd: string, pathValue: string): string | undefined {
  if (binary.includes("/") || binary.includes("\\")) {
    const path = isAbsolute(binary) ? binary : join(cwd, binary);
    return existsSync(path) ? realpathSync.native(path) : undefined;
  }
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    const path = join(dir, binary);
    if (isExecutablePath(path)) return realpathSync.native(path);
  }
  return undefined;
}

export function isExecutablePath(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform !== "win32") accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolvePackagedCodeGraphShim(): string | undefined {
  try {
    const manifestPath = requireFromAdapter.resolve(`${REQUIRED_CODEGRAPH_PACKAGE}/package.json`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      version?: string;
      bin?: Record<string, string>;
    };
    const relativeBin = manifest.bin?.codegraph;
    if (manifest.version !== REQUIRED_CODEGRAPH_VERSION || !relativeBin) return undefined;
    const shimPath = resolve(dirname(manifestPath), relativeBin);
    return existsSync(shimPath) ? realpathSync.native(shimPath) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Binds the projection receipt to the executable platform bundle, not only to the npm launcher.
 * CodeGraph's public package is a thin shim which execs a platform package containing its own
 * Node runtime and CLI entrypoint, so all of those executable layers are part of the authority.
 */
export function packagedCodeGraphRuntimeDigest(): string {
  try {
    const manifestPath = requireFromAdapter.resolve(`${REQUIRED_CODEGRAPH_PACKAGE}/package.json`);
    const packageRequire = createRequire(manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      version?: string;
      bin?: Record<string, string>;
    };
    if (manifest.version !== REQUIRED_CODEGRAPH_VERSION || !manifest.bin?.codegraph) {
      throw new Error(`package manifest is not exact ${REQUIRED_CODEGRAPH_VERSION}`);
    }
    const platformPackage = `${REQUIRED_CODEGRAPH_PACKAGE}-${process.platform}-${process.arch}`;
    const platformManifestPath = packageRequire.resolve(`${platformPackage}/package.json`);
    const platformManifest = JSON.parse(readFileSync(platformManifestPath, "utf8")) as { version?: string };
    if (platformManifest.version !== REQUIRED_CODEGRAPH_VERSION) {
      throw new Error(`platform bundle is not exact ${REQUIRED_CODEGRAPH_VERSION}`);
    }
    const packageRoot = dirname(manifestPath);
    const platformRoot = dirname(platformManifestPath);
    const runtimeFiles = process.platform === "win32"
      ? ["node.exe", "lib/dist/bin/codegraph.js"]
      : ["bin/codegraph", "node", "lib/dist/bin/codegraph.js"];
    return digestJson({
      packageName: REQUIRED_CODEGRAPH_PACKAGE,
      packageVersion: REQUIRED_CODEGRAPH_VERSION,
      packageManifestDigest: digestFile(manifestPath),
      launcherDigest: digestFile(resolve(packageRoot, manifest.bin.codegraph)),
      platformPackage,
      platformManifestDigest: digestFile(platformManifestPath),
      runtimeFileDigests: runtimeFiles.map((path) => ({ path, digest: digestFile(resolve(platformRoot, path)) }))
    } as unknown as Json);
  } catch (error) {
    throw new Error(`CodeGraph package-local runtime is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isNodeRuntimeScript(path: string): boolean {
  if (/\.[cm]?js$/i.test(path)) return true;
  const prefix = readFilePrefix(path, 256);
  return prefix.startsWith("#!/usr/bin/env node")
    || prefix.startsWith("#!/usr/bin/env bun")
    || prefix.startsWith("#!/usr/bin/node")
    || prefix.startsWith("#!/usr/local/bin/node");
}

function readFilePrefix(path: string, length: number): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(length);
    const bytes = readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, bytes).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export interface CodeGraphCliNode {
  id?: string;
  kind: string;
  name: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
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

/** The node with id `symbol`, else every node whose exact qualified name or name is `symbol`. */
function definitionsOf(graph: CodeGraphIndexHandle, symbol: string): CodeGraphNode[] {
  const node = graph.getNode(symbol);
  if (node) return [node];
  const definitions = new Map<string, CodeGraphNode>();
  for (const definition of [...graph.getNodesByQualifiedName(symbol), ...graph.getNodesByName(symbol)]) definitions.set(definition.id, definition);
  return [...definitions.values()];
}

function impactOf(graph: CodeGraphIndexHandle, symbolId: string, depth: number): NormalizedImpact {
  const definitions = definitionsOf(graph, symbolId);
  if (definitions.length === 0) return { symbolId, callers: [], callees: [], affectedPaths: [] };
  const ids = definitions.map((definition) => definition.id);
  const affected = new Set<string>();
  for (const id of ids) for (const node of graph.getImpactRadius(id, depth).nodes.values()) affected.add(node.filePath);
  return {
    symbolId,
    callers: callEdges(graph.getIncomingEdgesTo(ids, CALL_EDGE_KINDS)),
    callees: callEdges(graph.getOutgoingEdgesFrom(ids, CALL_EDGE_KINDS)),
    affectedPaths: [...affected].sort()
  };
}

function callEdges(edges: CodeGraphEdge[]): NormalizedEdge[] {
  return uniqueEdges(edges.map((edge) => ({ source: edge.source, target: edge.target, kind: "calls" as const, confidence: "high" as const })))
    .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
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

export function digestFile(path: string): string {
  try {
    return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
  } catch (error) {
    throw new Error(`CodeGraph binary is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function runCodeGraphCli(binary: string, workspaceRoot: string, args: string[], maxBuffer = CODEGRAPH_OUTPUT_MAX_BYTES, envOverrides?: Record<string, string>): string {
  return runCodeGraphInvocation(codeGraphCliInvocation(binary, workspaceRoot), workspaceRoot, args, maxBuffer, envOverrides);
}

function runCodeGraphInvocation(invocation: CodeGraphCliInvocation, workspaceRoot: string, args: string[], maxBuffer: number, envOverrides?: Record<string, string>): string {
  disableCodeGraphTelemetryByDefault();
  try {
    return execFileSync(invocation.command, [...invocation.argsPrefix, ...args], {
      cwd: workspaceRoot,
      env: codeGraphChildEnv(envOverrides),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer,
      timeout: CODEGRAPH_QUERY_TIMEOUT_MS
    });
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    const message = stderr.trim() || (error instanceof Error ? error.message : String(error));
    throw new Error(`CodeGraph CLI failed: ${message}`);
  }
}
