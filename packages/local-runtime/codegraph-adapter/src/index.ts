import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, closeSync, constants as fsConstants, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, delimiter, dirname, isAbsolute, join, posix, resolve } from "node:path";
import { CodeGraph, type Edge as CodeGraphEdge, type Node as CodeGraphNode } from "@colbymchenry/codegraph";
import { buildArchitectureCandidateDelta, type ArchitectureDeltaDeclaredGraph, type ArchitectureDeltaGitChangeMetadata } from "@archcontext/core/architecture-delta";
import { repoScopedArchitectureId, type CrossRepoRelation } from "@archcontext/core/architecture-domain";
import {
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  architectureDocumentationProjectionProvenance,
  architectureDocumentationProjectionWorktreeDigest,
  architectureDocumentationSourceTreeDigest,
  loadCapabilitySourceFootprints,
  nativeNodeSource,
  type ArchitectureSelectorEvidenceV1,
  type CapabilityImportEdge,
  type CapabilityImportGraph,
  type ArchitectureDocumentationProjectionProvenanceV1,
  type NativeModel
} from "@archcontext/core/projection-engine";
import { digestJson, type ArchitectureCandidateDeltaV1, type ArchitectureRepositoryIdentityV1, type ArchitectureWorktreeIdentityV1, type CodeFactsPort, type CodeFactsSnapshot, type ImpactQuery, type Json, type NormalizedCodeContext, type NormalizedEdge, type NormalizedImpact, type NormalizedSymbol, type ObservedEvidence, type SourceSelector, type SymbolQuery, type WorkspaceRef } from "@archcontext/contracts";

export const REQUIRED_CODEGRAPH_PACKAGE = "@colbymchenry/codegraph";
export const REQUIRED_CODEGRAPH_VERSION = "1.5.0";
export const CODEGRAPH_TELEMETRY_ENV = "DO_NOT_TRACK";
export const CODEGRAPH_TELEMETRY_DISABLED_VALUE = "1";
const DEFAULT_CODEGRAPH_BINARY = "codegraph";
const requireFromAdapter = createRequire(import.meta.url);

type MutableEnv = Record<string, string | undefined>;
const CODEGRAPH_OUTPUT_MAX_BYTES = 32 * 1024 * 1024;
const CODEGRAPH_QUERY_TIMEOUT_MS = 30_000;

export function disableCodeGraphTelemetryByDefault(env: MutableEnv = process.env): string {
  env[CODEGRAPH_TELEMETRY_ENV] ??= CODEGRAPH_TELEMETRY_DISABLED_VALUE;
  return env[CODEGRAPH_TELEMETRY_ENV] ?? CODEGRAPH_TELEMETRY_DISABLED_VALUE;
}

export interface CodeGraphProvider {
  version: string;
  capabilities: string[];
  indexAll(workspaceRoot: string): Promise<void>;
  buildContext(task: string, options: { maxSymbols: number; includeSource: boolean; changedPaths?: string[] }): Promise<NormalizedCodeContext>;
  findSymbols(query: SymbolQuery): Promise<NormalizedSymbol[]>;
  getImpactRadius(symbolId: string, depth: number): Promise<NormalizedImpact>;
}

export class CodeGraphCliProvider implements CodeGraphProvider {
  version = REQUIRED_CODEGRAPH_VERSION;
  capabilities = ["index", "context", "impact"];
  private workspaceRoot: string;

  constructor(workspaceRoot = process.cwd(), private readonly binary = DEFAULT_CODEGRAPH_BINARY) {
    this.workspaceRoot = workspaceRoot;
  }

  async indexAll(workspaceRoot: string): Promise<void> {
    this.workspaceRoot = workspaceRoot;
    if (!existsSync(join(workspaceRoot, ".codegraph"))) {
      throw new Error(`CodeGraph index missing at ${workspaceRoot}; run codegraph init before using archctxd`);
    }
    this.run(["sync", workspaceRoot]);
  }

  async buildContext(task: string, options: { maxSymbols: number; includeSource: boolean; changedPaths?: string[] }): Promise<NormalizedCodeContext> {
    const query = scopedTaskQuery(task, options.changedPaths ?? []);
    const output = this.run(["explore", "-p", this.workspaceRoot, "--max-files", String(options.maxSymbols), query]);
    const queryNodes = this.queryNodes(query, Math.max(options.maxSymbols * 4, 12));
    const importNodes = this.importNodesForChangedPaths(options.changedPaths ?? []);
    const symbols = uniqueSymbols([
      ...queryNodes.filter((node) => node.kind !== "import").map(normalizeCliNode),
      ...parseExploreSymbols(output, options.maxSymbols)
    ]).slice(0, options.maxSymbols);
    const fallback = symbols.length > 0 ? symbols : await this.findSymbols({ query, limit: options.maxSymbols });
    const edges = uniqueEdges(importEdgesFromQueryNodes(this.workspaceRoot, importNodes.length > 0 ? importNodes : queryNodes));
    return {
      task,
      symbols: fallback,
      edges,
      evidence: fallback.map((symbol, index) => ({
        id: `evidence_${index + 1}`,
        selector: { path: symbol.path, symbolId: symbol.id, startLine: symbol.range?.startLine, endLine: symbol.range?.endLine },
        summary: `Observed by codegraph explore for task: ${task}`,
        confidence: "observed",
        snapshot: {
          repositoryId: "codegraph",
          headSha: "codegraph",
          worktreeDigest: digestJson({ task, path: symbol.path, output } as unknown as Json)
        }
      })),
      digest: digestJson({ task, symbols: fallback, edges, includeSource: options.includeSource, outputDigest: digestJson(output as unknown as Json) } as unknown as Json)
    };
  }

  async findSymbols(query: SymbolQuery): Promise<NormalizedSymbol[]> {
    return this.queryNodes(query.query, query.limit ?? 10, query.kinds).map(normalizeCliNode);
  }

  private queryNodes(query: string, limit: number, kinds: string[] = []): CodeGraphCliNode[] {
    const args = ["query", "-p", this.workspaceRoot, "-j", "-l", String(limit)];
    for (const kind of kinds) args.push("-k", kind);
    args.push(query);
    const output = this.run(args);
    const parsed = JSON.parse(output) as { node: CodeGraphCliNode }[];
    return parsed.map(({ node }) => node);
  }

  private importNodesForChangedPaths(changedPaths: string[]): CodeGraphCliNode[] {
    const query = importQuery(changedPaths);
    if (!query) return [];
    return this.queryNodes(query, Math.max(changedPaths.length * 8, 12), ["import"]);
  }

  async getImpactRadius(symbolId: string, depth: number): Promise<NormalizedImpact> {
    const output = this.run(["impact", "-p", this.workspaceRoot, "-j", "-d", String(depth), symbolId]);
    const parsed = JSON.parse(output) as { affected?: CodeGraphCliNode[] };
    const affected = (parsed.affected ?? []).map(normalizeCliNode);
    const trail = parseNodeTrail(this.run(["node", symbolId, "-p", this.workspaceRoot]), symbolId);
    return {
      symbolId,
      callers: trail.callers,
      callees: trail.callees,
      affectedPaths: affected.map((symbol) => symbol.path)
    };
  }

  private run(args: string[]): string {
    const invocation = codeGraphCliInvocation(this.binary, this.workspaceRoot);
    try {
      return execFileSync(invocation.command, [...invocation.argsPrefix, ...args], {
        cwd: this.workspaceRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: CODEGRAPH_OUTPUT_MAX_BYTES,
        timeout: CODEGRAPH_QUERY_TIMEOUT_MS
      });
    } catch (error) {
      const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
      const message = stderr.trim() || (error instanceof Error ? error.message : String(error));
      throw new Error(`CodeGraph CLI failed: ${message}`);
    }
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

function isExecutablePath(path: string): boolean {
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
function packagedCodeGraphRuntimeDigest(): string {
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

export class CodeGraphAdapter implements CodeFactsPort {
  #snapshot?: CodeFactsSnapshot;

  constructor(private readonly provider: CodeGraphProvider) {
    disableCodeGraphTelemetryByDefault();
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

interface CodeGraphCliNode {
  id?: string;
  kind: string;
  name: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];

function syntheticSymbolId(name: string, path: string): string {
  return `codegraph.${digestJson({ name, path } as unknown as Json).slice(7, 19)}`;
}

function normalizeCliNode(node: CodeGraphCliNode): NormalizedSymbol {
  return {
    id: node.id ?? syntheticSymbolId(node.name, node.filePath),
    name: node.name,
    kind: node.kind,
    path: node.filePath,
    range: node.startLine ? { startLine: node.startLine, endLine: node.endLine ?? node.startLine } : undefined
  };
}

function scopedTaskQuery(task: string, changedPaths: string[]): string {
  return uniqueStrings([task, ...changedPaths]).join(" ");
}

function importQuery(changedPaths: string[]): string | undefined {
  const scoped = normalizeChangedPaths(changedPaths);
  if (scoped.length === 0) return undefined;
  return uniqueStrings(["import", ...scoped]).join(" ");
}

function importEdgesFromQueryNodes(workspaceRoot: string, nodes: CodeGraphCliNode[]): NormalizedEdge[] {
  return resolvedImportPairs(workspaceRoot, nodes).map((pair) => ({
    source: fileSymbolId(pair.from),
    target: fileSymbolId(pair.to),
    kind: "imports" as const,
    confidence: "high" as const
  }));
}

/**
 * Import nodes whose specifier resolved to a file that exists on disk. A specifier the resolver
 * cannot pin to a real file (bare package name, workspace alias, missing target) yields no pair:
 * the caller gets fewer edges, never a guessed one.
 */
function resolvedImportPairs(workspaceRoot: string, nodes: CodeGraphCliNode[]): { from: string; to: string }[] {
  return nodes
    .filter((node) => node.kind === "import")
    .flatMap((node) => {
      const target = resolveImportTarget(workspaceRoot, node.filePath, node.name);
      return target ? [{ from: node.filePath, to: target }] : [];
    });
}

function resolveImportTarget(workspaceRoot: string, fromPath: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  if (base === "." || base.startsWith("../") || posix.isAbsolute(base)) return undefined;
  for (const candidate of importTargetCandidates(base)) {
    const filePath = join(workspaceRoot, ...candidate.split("/"));
    if (!existsSync(filePath)) continue;
    try {
      if (statSync(filePath).isFile()) return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

function importTargetCandidates(base: string): string[] {
  return [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => posix.join(base, `index${extension}`))
  ];
}

function fileSymbolId(path: string): string {
  return `file:${path}`;
}

// The "Calls →" trail mixes real call sites with type references (parameter/return
// annotations), so every entry is a best-effort "calls" edge, not a verified runtime call.
function parseNodeTrail(output: string, symbolId: string): { callers: NormalizedEdge[]; callees: NormalizedEdge[] } {
  const callees = trailEntries(output, "**Calls →**").map((entry) => ({
    source: symbolId,
    target: syntheticSymbolId(entry.name, entry.path),
    kind: "calls" as const,
    confidence: "high" as const
  }));
  const callers = trailEntries(output, "**Called by ←**").map((entry) => ({
    source: syntheticSymbolId(entry.name, entry.path),
    target: symbolId,
    kind: "calls" as const,
    confidence: "high" as const
  }));
  return { callers: uniqueEdges(callers), callees: uniqueEdges(callees) };
}

function trailEntries(output: string, marker: string): { name: string; path: string; line: number }[] {
  const line = output.split("\n").find((candidate) => candidate.includes(marker));
  if (!line) return [];
  const rest = line.slice(line.indexOf(marker) + marker.length);
  return rest.split(",")
    .map((entry) => entry.trim())
    .flatMap((entry) => {
      const match = entry.match(/^(.+)\s\(([^()]+):(\d+)\)$/);
      if (!match) return [];
      return [{ name: match[1].trim(), path: match[2].trim(), line: Number(match[3]) }];
    });
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

function normalizeChangedPaths(paths: string[]): string[] {
  return uniqueStrings(paths
    .map((path) => path.trim().replaceAll("\\", "/"))
    .filter((path) => path.length > 0 && !path.startsWith("/") && !path.includes(".."))
  ).sort();
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)];
}

function architectureDeltaTask(git: ArchitectureDeltaGitChangeMetadata): string {
  return uniqueStrings([
    "architecture delta",
    git.source,
    ...git.paths.flatMap((change) => [change.path, change.previousPath ?? ""])
  ].filter(Boolean)).join(" ");
}

// --- Capability documentation projection measurements and exact semantic bindings ---
//
// A thin read-only query surface over the same CodeGraph CLI the provider uses. It exists so the
// documentation projection stays a pure function in @archcontext/core: the child process lives
// here, the renderer only receives measured facts. Import graphs remain diagnostic measurements;
// exact node-v2 selectors are the only CodeGraph facts that can bind a semantic flow step.

/** Import-node dump budget for one repository. Hitting it marks the graph `truncated`. */
export const CODEGRAPH_IMPORT_NODE_QUERY_LIMIT = 5000;
export interface CapabilityCodeGraphProjectionInputs {
  importGraphs: CapabilityImportGraph[];
  selectorEvidence: ArchitectureSelectorEvidenceV1[];
}

export interface CodeGraphSelectorIndex {
  getNodesByName(name: string): CodeGraphNode[];
  getOutgoingEdges(nodeId: string): CodeGraphEdge[];
  getNode(nodeId: string): CodeGraphNode | null;
  close(): void;
}

export interface CodeGraphProjectionStatusV1 {
  initialized: boolean;
  version: string;
  projectPath: string;
  lastIndexed: string | null;
  fileCount?: number;
  nodeCount?: number;
  edgeCount?: number;
  nodesByKind?: Record<string, number>;
  languages?: string[];
  pendingChanges?: { added: number; modified: number; removed: number };
  worktreeMismatch?: unknown;
  index?: {
    builtWithVersion?: string;
    builtWithExtractionVersion?: number;
    currentExtractionVersion?: number;
    reindexRecommended?: boolean;
    state?: string;
    pendingRefs?: number;
  };
}

export interface CodeGraphProjectionHandshakeV1 {
  schemaVersion: "archcontext.codegraph-projection-handshake/v1";
  packageName: typeof REQUIRED_CODEGRAPH_PACKAGE;
  requiredVersion: typeof REQUIRED_CODEGRAPH_VERSION;
  actualVersion: string;
  binaryDigest: string;
  availability: "ready" | "unavailable";
  reasonCode?: "index-missing";
  preSyncStatusDigest: string | null;
  postSyncStatusDigest: string | null;
  syncDigest: string | null;
  indexedWorktreeDigest: string | null;
  graphDigest: string;
}

export interface PreparedProjectionCodeFacts extends CapabilityCodeGraphProjectionInputs {
  handshake: CodeGraphProjectionHandshakeV1;
}

export interface PreparedArchitectureDocumentationProjectionSnapshot extends PreparedProjectionCodeFacts {
  provenance: ArchitectureDocumentationProjectionProvenanceV1;
}

/** Single snapshot assembly shared by CLI, daemon completion gates, and verification tests. */
export function prepareArchitectureDocumentationProjectionSnapshot(
  root: string,
  model: NativeModel,
  options: {
    binary?: string;
    importNodeLimit?: number;
    timeouts?: { versionMs?: number; statusMs?: number; syncMs?: number };
  } = {}
): PreparedArchitectureDocumentationProjectionSnapshot {
  const baseHeadSha = readProjectionHeadSha(root);
  const worktreeDigest = architectureDocumentationProjectionWorktreeDigest(root, model);
  const sourceTreeDigest = architectureDocumentationSourceTreeDigest(root, model);
  const modelDigest = digestJson(model as unknown as Json);
  const prepared = prepareProjectionCodeFacts(root, model, { ...options, sourceTreeDigest });
  if (architectureDocumentationProjectionWorktreeDigest(root, model) !== worktreeDigest) {
    throw new Error("architecture-docs-projection-worktree-changed-during-codegraph-sync");
  }
  const provenance = architectureDocumentationProjectionProvenance({
    baseHeadSha,
    worktreeDigest,
    sourceTreeDigest,
    modelDigest,
    codeGraphDigest: prepared.handshake.graphDigest,
    indexedWorktreeDigest: prepared.handshake.indexedWorktreeDigest,
    rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION,
    layoutVersion: ARCHITECTURE_DOCS_LAYOUT_VERSION,
    generatedFrom: {
      codeGraphPackage: prepared.handshake.packageName,
      codeGraphVersion: prepared.handshake.actualVersion,
      codeGraphBinaryDigest: prepared.handshake.binaryDigest,
      codeGraphStatus: prepared.handshake.availability
    }
  });
  return { ...prepared, provenance };
}

/**
 * Freezes the public CodeGraph proof used by one docs projection. The adapter never reads the
 * `.codegraph` database: actual binary/version and both status snapshots come from the package-local
 * CLI. A missing index is an explicit unavailable state; an existing but stale/incompatible index
 * is an error and cannot produce verified facts.
 */
export function prepareProjectionCodeFacts(
  root: string,
  model: NativeModel,
  options: {
    sourceTreeDigest: string;
    binary?: string;
    importNodeLimit?: number;
    timeouts?: { versionMs?: number; statusMs?: number; syncMs?: number };
  }
): PreparedProjectionCodeFacts {
  const invocation = options.binary
    ? codeGraphCliInvocation(options.binary, root, "")
    : packagedCodeGraphCliInvocation();
  const binaryPath = invocation.argsPrefix[0] ?? invocation.command;
  const actualVersion = runProjectionCodeGraph(invocation, root, ["--version"], options.timeouts?.versionMs ?? 5_000).trim();
  if (actualVersion !== REQUIRED_CODEGRAPH_VERSION) {
    throw new Error(`CodeGraph ${REQUIRED_CODEGRAPH_VERSION} required, got actual binary ${actualVersion || "unknown"}`);
  }
  const binaryDigest = options.binary ? digestFile(binaryPath) : packagedCodeGraphRuntimeDigest();
  if (!codeGraphIndexAvailable(root)) {
    const graphDigest = digestJson({
      schemaVersion: "archcontext.codegraph-projection-handshake/v1",
      actualVersion,
      binaryDigest,
      availability: "unavailable",
      reasonCode: "index-missing"
    } as unknown as Json);
    return {
      importGraphs: [],
      selectorEvidence: [],
      handshake: {
        schemaVersion: "archcontext.codegraph-projection-handshake/v1",
        packageName: REQUIRED_CODEGRAPH_PACKAGE,
        requiredVersion: REQUIRED_CODEGRAPH_VERSION,
        actualVersion,
        binaryDigest,
        availability: "unavailable",
        reasonCode: "index-missing",
        preSyncStatusDigest: null,
        postSyncStatusDigest: null,
        syncDigest: null,
        indexedWorktreeDigest: null,
        graphDigest
      }
    };
  }

  const statusTimeout = options.timeouts?.statusMs ?? 10_000;
  const preStatus = readProjectionCodeGraphStatus(invocation, root, statusTimeout);
  assertProjectionCodeGraphStatus(preStatus, root, "pre-sync");
  runProjectionCodeGraph(invocation, root, ["sync", root, "--quiet"], options.timeouts?.syncMs ?? 120_000);
  const postStatus = readProjectionCodeGraphStatus(invocation, root, statusTimeout);
  assertProjectionCodeGraphStatus(postStatus, root, "post-sync");
  assertProjectionCodeGraphClean(postStatus, "post-sync");
  const inputs = loadCapabilityCodeGraphProjectionInputs(root, model, {
    binary: binaryPath,
    importNodeLimit: options.importNodeLimit
  });
  const finalStatus = readProjectionCodeGraphStatus(invocation, root, statusTimeout);
  assertProjectionCodeGraphStatus(finalStatus, root, "post-query");
  assertProjectionCodeGraphClean(finalStatus, "post-query");
  const postDigest = projectionCodeGraphStatusDigest(postStatus);
  const finalDigest = projectionCodeGraphStatusDigest(finalStatus);
  if (postDigest !== finalDigest) throw new Error("CodeGraph indexed snapshot changed during projection queries");
  const preDigest = projectionCodeGraphStatusDigest(preStatus);
  const indexedWorktreeDigest = digestJson({
    sourceTreeDigest: options.sourceTreeDigest,
    statusDigest: postDigest
  } as unknown as Json);
  const graphDigest = digestJson({
    actualVersion,
    binaryDigest,
    indexedWorktreeDigest,
    importGraphs: inputs.importGraphs,
    selectorEvidence: inputs.selectorEvidence
  } as unknown as Json);
  return {
    ...inputs,
    handshake: {
      schemaVersion: "archcontext.codegraph-projection-handshake/v1",
      packageName: REQUIRED_CODEGRAPH_PACKAGE,
      requiredVersion: REQUIRED_CODEGRAPH_VERSION,
      actualVersion,
      binaryDigest,
      availability: "ready",
      preSyncStatusDigest: preDigest,
      postSyncStatusDigest: postDigest,
      syncDigest: digestJson({ preSyncStatusDigest: preDigest, postSyncStatusDigest: postDigest } as unknown as Json),
      indexedWorktreeDigest,
      graphDigest
    }
  };
}

function readProjectionCodeGraphStatus(invocation: CodeGraphCliInvocation, root: string, timeout: number): CodeGraphProjectionStatusV1 {
  const output = runProjectionCodeGraph(invocation, root, ["status", "-j", root], timeout);
  try {
    return JSON.parse(output) as CodeGraphProjectionStatusV1;
  } catch (error) {
    throw new Error(`CodeGraph status JSON invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readProjectionHeadSha(root: string): string {
  try {
    const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000
    }).trim();
    if (!/^[a-f0-9]{40}$/.test(headSha)) throw new Error("HEAD is not a full commit SHA");
    return headSha;
  } catch (error) {
    throw new Error(`Architecture projection HEAD is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertProjectionCodeGraphStatus(status: CodeGraphProjectionStatusV1, root: string, phase: string): void {
  if (!status.initialized) throw new Error(`CodeGraph ${phase} status is not initialized`);
  if (status.version !== REQUIRED_CODEGRAPH_VERSION || status.index?.builtWithVersion !== REQUIRED_CODEGRAPH_VERSION) {
    throw new Error(`CodeGraph ${phase} status version mismatch`);
  }
  if (realpathSync.native(status.projectPath) !== realpathSync.native(root)) {
    throw new Error(`CodeGraph ${phase} project path mismatch`);
  }
  if (status.index?.state !== "complete" || status.index.reindexRecommended !== false || status.index.pendingRefs !== 0) {
    throw new Error(`CodeGraph ${phase} index is not complete and compatible`);
  }
  if (status.index.builtWithExtractionVersion !== status.index.currentExtractionVersion) {
    throw new Error(`CodeGraph ${phase} extraction version mismatch`);
  }
  if (status.worktreeMismatch !== null) throw new Error(`CodeGraph ${phase} worktree mismatch`);
}

function assertProjectionCodeGraphClean(status: CodeGraphProjectionStatusV1, phase: string): void {
  const pending = status.pendingChanges;
  if (!pending || pending.added !== 0 || pending.modified !== 0 || pending.removed !== 0) {
    throw new Error(`CodeGraph ${phase} index still has pending source changes`);
  }
}

function projectionCodeGraphStatusDigest(status: CodeGraphProjectionStatusV1): string {
  return digestJson({
    version: status.version,
    projectPathDigest: digestJson(realpathSync.native(status.projectPath) as unknown as Json),
    lastIndexed: status.lastIndexed,
    fileCount: status.fileCount,
    nodeCount: status.nodeCount,
    edgeCount: status.edgeCount,
    nodesByKind: status.nodesByKind,
    languages: [...(status.languages ?? [])].sort(),
    pendingChanges: status.pendingChanges,
    worktreeMismatch: status.worktreeMismatch,
    index: status.index
  } as unknown as Json);
}

function runProjectionCodeGraph(
  invocation: CodeGraphCliInvocation,
  root: string,
  args: string[],
  timeout: number
): string {
  disableCodeGraphTelemetryByDefault();
  try {
    return execFileSync(invocation.command, [...invocation.argsPrefix, ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: CODEGRAPH_OUTPUT_MAX_BYTES,
      timeout
    });
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    const message = stderr.trim() || (error instanceof Error ? error.message : String(error));
    throw new Error(`CodeGraph projection handshake failed: ${message}`);
  }
}

function digestFile(path: string): string {
  try {
    return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
  } catch (error) {
    throw new Error(`CodeGraph binary is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** True when this workspace carries a CodeGraph index the CLI can be pointed at. */
export function codeGraphIndexAvailable(workspaceRoot: string): boolean {
  return existsSync(join(workspaceRoot, ".codegraph"));
}

/**
 * Measures import facts and exact node-v2 entrypoint→sink selectors. CodeGraph proves only the
 * declared binding: it never chooses seed symbols, labels, order, branches or outcomes.
 *
 * With no index present this returns empty evidence. The semantic compiler then reports
 * `unprovable`; it never degrades into a path-based diagram.
 */
export function loadCapabilityCodeGraphProjectionInputs(
  root: string,
  model: NativeModel,
  options: {
    binary?: string;
    importNodeLimit?: number;
    selectorIndexFactory?: (root: string) => CodeGraphSelectorIndex;
  } = {}
): CapabilityCodeGraphProjectionInputs {
  const footprints = loadCapabilitySourceFootprints(root, model);
  const entrypointNodes = model.nodes
    .map((node) => ({ nodeId: node.id, entrypoints: nativeNodeSource(node)?.entrypoints ?? [] }))
    .filter((entry) => entry.entrypoints.length > 0)
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  if (footprints.length === 0 && entrypointNodes.length === 0) return { importGraphs: [], selectorEvidence: [] };
  if (!codeGraphIndexAvailable(root)) return { importGraphs: [], selectorEvidence: [] };

  disableCodeGraphTelemetryByDefault();
  const binary = options.binary ?? DEFAULT_CODEGRAPH_BINARY;
  const importGraphs = footprints.length > 0
    ? capabilityImportGraphs(root, binary, footprints, options.importNodeLimit ?? CODEGRAPH_IMPORT_NODE_QUERY_LIMIT)
    : [];
  const selectorIndex = entrypointNodes.length > 0
    ? options.selectorIndexFactory?.(root) ?? CodeGraph.openSync(root)
    : undefined;
  let selectorEvidence: ArchitectureSelectorEvidenceV1[];
  try {
    selectorEvidence = entrypointNodes.flatMap((entry) => entry.entrypoints.flatMap((entrypoint) =>
      entrypoint.symbols.flatMap((source) => source.sinks.map((sink) => exactSelectorEvidence(selectorIndex!, {
        nodeId: entry.nodeId,
        entrypointId: entrypoint.id,
        sourcePath: entrypoint.path,
        sourceSymbol: source.name,
        sinkId: sink.id,
        sinkPath: sink.path,
        sinkSymbol: sink.symbol
      })))));
  } finally {
    selectorIndex?.close();
  }
  return { importGraphs, selectorEvidence };
}

export interface RepositoryImportPairV1 {
  from: string;
  /** The specifier verbatim. Two different specifiers from one file are two observations. */
  specifier: string;
  /** Repo-relative target, or `null` when this producer could not resolve the specifier. */
  to: string | null;
}

export interface RepositoryImportPairsV1 {
  pairs: RepositoryImportPairV1[];
  truncated: boolean;
  /** `ready` only when an index exists and reports no pending source changes. */
  availability: "ready" | "unavailable";
  /** The worktree the index attests to, or `null` when it attests to nothing usable. */
  indexedWorktreeDigest: string | null;
}

/**
 * Every import edge in the repository as repo-relative pairs, plus the identity of the index they
 * were read from. Unlike `capabilityImportGraphs` this keeps specifiers it could not resolve as
 * `to: null` with the specifier retained, because a module snapshot has to report how much of its
 * boundary is unresolved and a dropped edge is indistinguishable from an absent one. Bare
 * workspace specifiers are deliberately left unresolved here: mapping `@scope/pkg/sub` through a
 * package `exports` map is the builder's job, which keeps this adapter free of resolution rules
 * and keeps the resolution itself unit-testable without an index. The two producers share only
 * `codeGraphImportNodes`; `capabilityImportGraphs` keeps its resolved-only edge set, which the
 * capability projection fixtures pin byte for byte.
 *
 * Freshness is producer-owned evidence, never a caller assertion: the returned
 * `indexedWorktreeDigest` binds the edges to `worktreeDigest` only when the index reports itself
 * clean, so a consumer cannot claim complete coverage over an index that never saw this tree.
 */
export function repositoryImportPairs(
  root: string,
  binary: string,
  limit: number,
  worktreeDigest: string
): RepositoryImportPairsV1 {
  if (!codeGraphIndexAvailable(root)) {
    return { pairs: [], truncated: true, availability: "unavailable", indexedWorktreeDigest: null };
  }
  const nodes = codeGraphImportNodes(root, binary, limit);
  const pairs = new Map<string, RepositoryImportPairV1>();
  for (const node of nodes.imports) {
    if (node.kind !== "import") continue;
    const to = resolveImportTarget(root, node.filePath, node.name) ?? null;
    // Keyed on (file, specifier) so three distinct unresolved specifiers stay three records.
    pairs.set(JSON.stringify([node.filePath, node.name]), { from: node.filePath, specifier: node.name, to });
  }
  const status = readProjectionCodeGraphStatus(codeGraphCliInvocation(binary, root, ""), root, CODEGRAPH_QUERY_TIMEOUT_MS);
  const pending = status.pendingChanges;
  const clean = status.initialized && pending !== undefined && pending.added === 0 && pending.modified === 0 && pending.removed === 0;
  return {
    pairs: [...pairs.keys()].sort().map((key) => pairs.get(key)!),
    truncated: nodes.truncated,
    availability: clean ? "ready" : "unavailable",
    indexedWorktreeDigest: clean ? worktreeDigest : null
  };
}


function capabilityImportGraphs(
  root: string,
  binary: string,
  footprints: { nodeId: string; files: string[] }[],
  limit: number
): CapabilityImportGraph[] {
  const nodes = codeGraphImportNodes(root, binary, limit);
  const pairs = resolvedImportPairs(root, nodes.imports);
  return footprints.map((footprint) => {
    const scope = new Set(footprint.files);
    const edges = new Map<string, CapabilityImportEdge>();
    for (const pair of pairs) {
      if (!scope.has(pair.from)) continue;
      edges.set(`${pair.from} ${pair.to}`, pair);
    }
    return {
      nodeId: footprint.nodeId,
      files: footprint.files,
      edges: [...edges.values()].sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to)),
      truncated: nodes.truncated
    };
  });
}

/**
 * Dumps the repository's import nodes. `-k import` restricts the kind and every import node's
 * text carries the `import` token, so one query enumerates the population; reaching the limit is
 * reported rather than silently accepted as a complete answer.
 */
function codeGraphImportNodes(root: string, binary: string, limit: number): { imports: CodeGraphCliNode[]; truncated: boolean } {
  const output = runCodeGraphCli(binary, root, ["query", "-p", root, "-j", "-l", String(limit), "-k", "import", "import"]);
  const parsed = JSON.parse(output) as { node: CodeGraphCliNode }[];
  return { imports: parsed.map(({ node }) => node), truncated: parsed.length >= limit };
}

function exactSelectorEvidence(
  index: CodeGraphSelectorIndex,
  selector: Omit<ArchitectureSelectorEvidenceV1, "matched" | "truncated" | "callSites">
): ArchitectureSelectorEvidenceV1 {
  const sources = index.getNodesByName(selector.sourceSymbol)
    .filter((node) => normalizedIndexPath(node.filePath) === normalizedIndexPath(selector.sourcePath));
  const exactCalls = sources.flatMap((source) => index.getOutgoingEdges(source.id)
    .filter((edge) => edge.kind === "calls")
    .flatMap((edge) => {
      const target = index.getNode(edge.target);
      return target
        && target.name === selector.sinkSymbol
        && normalizedIndexPath(target.filePath) === normalizedIndexPath(selector.sinkPath)
        ? [{ edge, target }]
        : [];
    }));
  const sinkIdentities = new Set(exactCalls.map(({ target }) => target.id));
  const ambiguous = sources.length > 1 || sinkIdentities.size > 1;
  const callSites = [...new Map(exactCalls.map(({ edge }) => {
    const callSite = { path: selector.sourcePath, ...(edge.line === undefined ? {} : { line: edge.line }) };
    return [`${callSite.path}\0${callSite.line ?? ""}`, callSite] as const;
  })).values()].sort((left, right) => left.path.localeCompare(right.path) || (left.line ?? 0) - (right.line ?? 0));
  return {
    ...selector,
    matched: !ambiguous && sinkIdentities.size === 1,
    ambiguous,
    // The structured SDK queries above are uncapped index lookups (name index plus the full
    // outgoing-edge set of each source), so this producer enumerates the whole population and
    // can never drop a match; only the CLI-backed import query has a limit to report.
    truncated: false,
    callSites
  };
}

function normalizedIndexPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function runCodeGraphCli(binary: string, workspaceRoot: string, args: string[]): string {
  const invocation = codeGraphCliInvocation(binary, workspaceRoot);
  try {
    return execFileSync(invocation.command, [...invocation.argsPrefix, ...args], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: CODEGRAPH_OUTPUT_MAX_BYTES,
      timeout: CODEGRAPH_QUERY_TIMEOUT_MS
    });
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    const message = stderr.trim() || (error instanceof Error ? error.message : String(error));
    throw new Error(`CodeGraph CLI failed: ${message}`);
  }
}

function parseExploreSymbols(output: string, maxSymbols: number): NormalizedSymbol[] {
  return [...output.matchAll(/^####\s+(.+?)\s+—/gm)]
    .slice(0, maxSymbols)
    .map((match, index) => {
      const path = match[1].trim();
      return {
        id: `codegraph.explore.${index + 1}.${digestJson(path as unknown as Json).slice(7, 15)}`,
        name: basename(path),
        kind: "file",
        path
      };
    });
}
