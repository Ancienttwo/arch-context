import { assertLocalEgressAllowed, localEgressMode } from "@archcontext/local-runtime/egress-admission";
import { CODE_FACTS_ISSUE_MESSAGES, FailureError } from "@archcontext/contracts";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, closeSync, constants as fsConstants, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, delimiter, dirname, isAbsolute, join, posix, resolve } from "node:path";
import type { Edge as CodeGraphEdge, Node as CodeGraphNode } from "@colbymchenry/codegraph";
import { buildArchitectureCandidateDelta, type ArchitectureDeltaDeclaredGraph, type ArchitectureDeltaGitChangeMetadata } from "@archcontext/core/architecture-delta";
import { parseJsonOrStableYaml, repoScopedArchitectureId, type CrossRepoRelation } from "@archcontext/core/architecture-domain";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import {
  ARCHITECTURE_DOCS_LAYOUT_VERSION,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  architectureDocumentationProjectionProvenance,
  architectureDocumentationProjectionWorktreeDigest,
  digestArchitectureDocumentationSourceTree,
  loadCapabilitySourceFootprints,
  nativeNodeSource,
  type ArchitectureSelectorEvidenceV1,
  type CapabilitySourceFootprint,
  type CapabilityImportEdge,
  type CapabilityImportGraph,
  type ArchitectureDocumentationProjectionRuntimeSnapshot,
  type NativeModel
} from "@archcontext/core/projection-engine";
import { digestJson, productVersionManifest, type ArchitectureCandidateDeltaV1, type ArchitectureDocumentationProjectionProvenanceV3, type ArchitectureRepositoryIdentityV1, type ArchitectureWorktreeIdentityV1, type CodeFactsPort, type CodeFactsSnapshot, type ImpactQuery, type Json, type NormalizedCodeContext, type NormalizedEdge, type NormalizedImpact, type NormalizedSymbol, type ObservedEvidence, type SourceSelector, type SymbolQuery, type WorkspaceRef } from "@archcontext/contracts";

export const REQUIRED_CODEGRAPH_PACKAGE = "@colbymchenry/codegraph";
export const REQUIRED_CODEGRAPH_VERSION: string = productVersionManifest().runtime.codeGraph.requiredVersion;
export const CODEGRAPH_TELEMETRY_ENV = "DO_NOT_TRACK";
export const CODEGRAPH_TELEMETRY_DISABLED_VALUE = "1";
const DEFAULT_CODEGRAPH_BINARY = "codegraph";
const requireFromAdapter = createRequire(import.meta.url);
// Keep the CommonJS SDK in its installed package so its platform/cache resolver stays relocatable.
type CodeGraphSdk = typeof import("@colbymchenry/codegraph");
let installedCodeGraphSdk: CodeGraphSdk | undefined;
function codeGraphSdk(): CodeGraphSdk {
  // Stateless native export shares the CLI entry but does not use code facts.
  // Resolve the installed SDK only when a CodeGraph operation actually needs it.
  return installedCodeGraphSdk ??= requireFromAdapter(REQUIRED_CODEGRAPH_PACKAGE) as CodeGraphSdk;
}

type MutableEnv = Record<string, string | undefined>;
const CODEGRAPH_OUTPUT_MAX_BYTES = 32 * 1024 * 1024;
const CODEGRAPH_QUERY_TIMEOUT_MS = 30_000;

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

export class CodeGraphCliProvider implements CodeGraphProvider {
  version: string = REQUIRED_CODEGRAPH_VERSION;
  capabilities = ["index", "context", "impact"];
  private workspaceRoot: string;

  constructor(workspaceRoot = process.cwd(), private readonly binary = DEFAULT_CODEGRAPH_BINARY) {
    this.workspaceRoot = workspaceRoot;
  }

  async indexAll(workspaceRoot: string): Promise<void> {
    this.workspaceRoot = workspaceRoot;
    this.assertCanSync(workspaceRoot);
    this.run(["sync", workspaceRoot]);
    this.assertReady(workspaceRoot);
  }

  assertReady(workspaceRoot: string): void {
    assertRepositoryCodeFactsReady(workspaceRoot, this.binary === DEFAULT_CODEGRAPH_BINARY ? {} : { binary: this.binary });
  }

  assertCanSync(workspaceRoot: string): void {
    assertRepositoryCodeFactsReady(workspaceRoot, { ...(this.binary === DEFAULT_CODEGRAPH_BINARY ? {} : { binary: this.binary }), allowPendingSourceChanges: true });
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
    disableCodeGraphTelemetryByDefault();
    const invocation = this.binary === DEFAULT_CODEGRAPH_BINARY ? packagedCodeGraphCliInvocation() : codeGraphCliInvocation(this.binary, this.workspaceRoot);
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

  assertCanSync(workspaceRoot: string): void {
    this.assertCompatible();
    this.provider.assertCanSync?.(workspaceRoot);
  }

  async ensureReady(workspace: WorkspaceRef): Promise<CodeFactsSnapshot> {
    this.assertCompatible();
    if (this.#snapshot) {
      try { this.provider.assertReady?.(workspace.root); }
      catch (error) {
        if (error instanceof FailureError && error.code === "AC_CODE_FACTS_NOT_READY" && error.action === "codegraph-sync") return this.sync({ workspace });
        throw error;
      }
    }
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

/**
 * Default cap on the import nodes `repositoryImportPairs` and the docs projection read. The read
 * is sized from the index's own import count, so this cap only bounds memory and time. One import
 * node costs about 0.7 KiB of CLI output, so the default is about 35 MiB.
 */
export const CODEGRAPH_IMPORT_NODE_READ_LIMIT = 50_000;
/** Output allowance per import node, so a large read is not cut by the CLI output buffer. */
const CODEGRAPH_IMPORT_NODE_OUTPUT_BYTES = 4 * 1024;
export interface CapabilityCodeGraphProjectionInputs {
  importGraphs: CapabilityImportGraph[];
  selectorEvidence: ArchitectureSelectorEvidenceV1[];
  /**
   * The repository import population the import-graph read returned, with unresolved specifiers
   * kept, exactly as `repositoryImportPairs` reports pairs. Present only when that read ran (an
   * index exists and a node declares a footprint). Freshness is the handshake's, so it carries no
   * availability of its own. Not part of `graphDigest`: it is the same read the graphs come from.
   */
  importPopulation?: ProjectionImportPopulationV1;
}

export type ProjectionImportPopulationV1 = Omit<RepositoryImportPairsV1, "availability" | "indexedWorktreeDigest">;

export interface CodeGraphSelectorIndex {
  getNodesByName(name: string): CodeGraphNode[];
  getOutgoingEdges(nodeId: string): CodeGraphEdge[];
  getNode(nodeId: string): CodeGraphNode | null;
  /** Read only for a call to a runtime built-in name, to find the source file's imports. */
  getNodesInFile(filePath: string): CodeGraphNode[];
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
  /**
   * Digest of the CodeGraph version and the code evidence this handshake read (import graphs,
   * selector evidence). It excludes the binary digest and the index status, which differ per
   * machine and per index build, so re-indexing an unchanged tree never moves it.
   */
  graphDigest: string;
}

export interface PreparedProjectionCodeFacts extends CapabilityCodeGraphProjectionInputs {
  handshake: CodeGraphProjectionHandshakeV1;
}

export interface PreparedArchitectureDocumentationProjectionSnapshot extends PreparedProjectionCodeFacts {
  provenance: ArchitectureDocumentationProjectionProvenanceV3;
  /** HEAD, worktree and CodeGraph state this snapshot read; runtime receipts only, never committed. */
  runtimeSnapshot: ArchitectureDocumentationProjectionRuntimeSnapshot;
  /**
   * The Git-visible files (`listGitVisibleFiles`) this snapshot measured footprints over.
   * Callers stamp footprints and scale signals from this same list, so every digest of one run
   * agrees on which files exist.
   */
  sourceFiles: string[];
  /**
   * `loadCapabilitySourceFootprints` over `sourceFiles`, resolved once for the whole snapshot. The
   * source tree digest and the import graphs read it, and callers stamp footprint digests and scale
   * signals from it, so one build matches the globs once (#324).
   */
  footprints: CapabilitySourceFootprint[];
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
  const sourceFiles = listGitVisibleFiles(root);
  const worktreeDigest = architectureDocumentationProjectionWorktreeDigest(root, model, sourceFiles);
  const footprints = loadCapabilitySourceFootprints(root, model, sourceFiles);
  const sourceTreeDigest = digestArchitectureDocumentationSourceTree(root, model, footprints);
  const modelDigest = digestJson(model as unknown as Json);
  const prepared = prepareProjectionCodeFacts(root, model, { ...options, sourceTreeDigest, footprints });
  if (architectureDocumentationProjectionWorktreeDigest(root, model, listGitVisibleFiles(root)) !== worktreeDigest) {
    throw new Error("architecture-docs-projection-worktree-changed-during-codegraph-sync");
  }
  const provenance = architectureDocumentationProjectionProvenance({
    sourceTreeDigest,
    modelDigest,
    rendererVersion: ARCHITECTURE_DOCS_RENDERER_VERSION,
    layoutVersion: ARCHITECTURE_DOCS_LAYOUT_VERSION,
    generatedFrom: {
      codeGraphPackage: prepared.handshake.packageName,
      codeGraphVersion: prepared.handshake.actualVersion
    }
  });
  return {
    ...prepared,
    provenance,
    runtimeSnapshot: {
      headSha: baseHeadSha,
      worktreeDigest,
      codeGraphDigest: prepared.handshake.graphDigest,
      indexedWorktreeDigest: prepared.handshake.indexedWorktreeDigest,
      codeGraphStatus: prepared.handshake.availability
    },
    sourceFiles,
    footprints
  };
}

/**
 * Thrown when `.archcontext/manifest.yaml` declares `codeFacts.required: true` and the projection
 * snapshot has no code facts. Without them every selector is unproven, so the major-change
 * classifier would report a flow-proof change for every capability; an environment failure must not
 * read as an architecture change. Surfaces map it to `AC_CODE_FACTS_UNAVAILABLE`.
 */
export class ProjectionCodeFactsUnavailableError extends Error {
  readonly code = "AC_CODE_FACTS_UNAVAILABLE" as const;
  constructor(readonly reasonCode: NonNullable<CodeGraphProjectionHandshakeV1["reasonCode"]>) {
    super(`code facts are required by .archcontext/manifest.yaml but unavailable (${reasonCode}); run \`codegraph init\` and retry`);
    this.name = "ProjectionCodeFactsUnavailableError";
  }
}

/** `codeFacts.required` from `.archcontext/manifest.yaml`; only an explicit `true` requires them. */
export function projectionCodeFactsRequired(root: string): boolean {
  const path = join(root, ".archcontext/manifest.yaml");
  if (!existsSync(path)) return false;
  let manifest: Json;
  try {
    manifest = parseJsonOrStableYaml(readFileSync(path, "utf8"), ".archcontext/manifest.yaml");
  } catch {
    // Manifest shape is validated by `archctx validate`; an unreadable file declares nothing here.
    return false;
  }
  const codeFacts = manifest && typeof manifest === "object" && !Array.isArray(manifest) ? manifest.codeFacts : undefined;
  return !!codeFacts && typeof codeFacts === "object" && !Array.isArray(codeFacts) && codeFacts.required === true;
}

/**
 * Projection gate for required code facts. Runs before the snapshot reaches the renderer, so a
 * missing index never classifies a major change, writes an acceptance candidate or emits a refresh
 * signal.
 */
export function assertProjectionCodeFactsAvailable(root: string, prepared: PreparedProjectionCodeFacts): void {
  if (prepared.handshake.availability === "ready" || !projectionCodeFactsRequired(root)) return;
  throw new ProjectionCodeFactsUnavailableError(prepared.handshake.reasonCode ?? "index-missing");
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
    /** Footprints resolved over the Git-visible files; resolved from `root` when omitted. */
    footprints?: readonly CapabilitySourceFootprint[];
    binary?: string;
    importNodeLimit?: number;
    timeouts?: { versionMs?: number; statusMs?: number; syncMs?: number };
    /** `false` reads selector evidence only (`flows check`); a projection always reads both. */
    importGraphs?: boolean;
  }
): PreparedProjectionCodeFacts {
  const invocation = options.binary
    ? codeGraphCliInvocation(options.binary, root, "")
    : packagedCodeGraphCliInvocation();
  const binaryPath = invocation.argsPrefix[0] ?? invocation.command;
  // `--version` starts the same launcher chain as `status`, so it gets the same stall budget. On
  // Windows CI it takes 94 ms (p50) and 2.4 s cold; a runner stall once pushed it past 5 s.
  const actualVersion = runProjectionCodeGraph(invocation, root, ["--version"], options.timeouts?.versionMs ?? 10_000).trim();
  if (actualVersion !== REQUIRED_CODEGRAPH_VERSION) {
    throw new Error(`CodeGraph ${REQUIRED_CODEGRAPH_VERSION} required, got actual binary ${actualVersion || "unknown"}`);
  }
  const binaryDigest = options.binary ? digestFile(binaryPath) : packagedCodeGraphRuntimeDigest();
  if (!codeGraphIndexAvailable(root)) {
    const graphDigest = digestJson({
      schemaVersion: "archcontext.codegraph-projection-handshake/v1",
      actualVersion,
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
    ...(options.footprints ? { footprints: options.footprints } : {}),
    binary: binaryPath,
    importNodeLimit: options.importNodeLimit,
    importNodeCount: statusImportNodeCount(postStatus),
    ...(options.importGraphs === false ? { importGraphs: false } : {})
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

function readProjectionCodeGraphStatus(
  invocation: CodeGraphCliInvocation,
  root: string,
  timeout: number,
  envOverrides?: Record<string, string>
): CodeGraphProjectionStatusV1 {
  const output = runProjectionCodeGraph(invocation, root, ["status", "-j", root], timeout, envOverrides);
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

export type ProjectionCodeGraphStatusIssueCode =
  | "not-initialized"
  | "version-mismatch"
  | "project-path-mismatch"
  | "index-incomplete"
  | "extraction-version-mismatch"
  | "worktree-mismatch"
  | "pending-source-changes";

export interface ProjectionCodeGraphStatusIssueV1 {
  code: ProjectionCodeGraphStatusIssueCode;
  /** The exact text `prepareProjectionCodeFacts` throws for this issue. */
  message: string;
}

/**
 * Pure evaluation of one `codegraph status -j` snapshot against the projection contract. It
 * returns every issue in evaluation order; an uninitialized index returns only that issue because
 * the remaining fields carry no meaning then.
 */
export function projectionCodeGraphStatusIssues(
  status: CodeGraphProjectionStatusV1,
  root: string,
  phase: string
): ProjectionCodeGraphStatusIssueV1[] {
  const issue = (code: ProjectionCodeGraphStatusIssueCode, text: string): ProjectionCodeGraphStatusIssueV1 => ({
    code,
    message: phase === "repository" ? CODE_FACTS_ISSUE_MESSAGES[code] : `CodeGraph ${phase} ${text}`
  });
  if (!status.initialized) return [issue("not-initialized", "status is not initialized")];
  const issues: ProjectionCodeGraphStatusIssueV1[] = [];
  if (status.version !== REQUIRED_CODEGRAPH_VERSION || status.index?.builtWithVersion !== REQUIRED_CODEGRAPH_VERSION) {
    issues.push(issue("version-mismatch", "status version mismatch"));
  }
  if (!sameRealPath(status.projectPath, root)) issues.push(issue("project-path-mismatch", "project path mismatch"));
  if (status.index?.state !== "complete" || status.index.reindexRecommended !== false || status.index.pendingRefs !== 0) {
    issues.push(issue("index-incomplete", "index is not complete and compatible"));
  } else if (status.index.builtWithExtractionVersion !== status.index.currentExtractionVersion) {
    issues.push(issue("extraction-version-mismatch", "extraction version mismatch"));
  }
  if (status.worktreeMismatch !== null) issues.push(issue("worktree-mismatch", "worktree mismatch"));
  return issues;
}

function sameRealPath(left: unknown, right: string): boolean {
  if (typeof left !== "string") return false;
  try {
    return realpathSync.native(left) === realpathSync.native(right);
  } catch {
    return false;
  }
}

function assertProjectionCodeGraphStatus(status: CodeGraphProjectionStatusV1, root: string, phase: string): void {
  const [first] = projectionCodeGraphStatusIssues(status, root, phase);
  if (first) throw new Error(first.message);
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
  timeout: number,
  envOverrides?: Record<string, string>
): string {
  disableCodeGraphTelemetryByDefault();
  const startedAt = performance.now();
  try {
    return execFileSync(invocation.command, [...invocation.argsPrefix, ...args], {
      cwd: root,
      ...(envOverrides ? { env: { ...process.env, ...envOverrides } } : {}),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: CODEGRAPH_OUTPUT_MAX_BYTES,
      timeout
    });
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    const message = stderr.trim() || (error instanceof Error ? error.message : String(error));
    const childError = error as { code?: string | number; status?: number | null; signal?: string | null } | null;
    // Only the fixed subcommand is recorded; arguments may contain repository paths.
    const diagnostics = {
      subcommand: args[0],
      deadlineMs: timeout,
      elapsedMs: Math.round(performance.now() - startedAt),
      code: childError?.code ?? null,
      exitCode: childError?.status ?? null,
      signal: childError?.signal ?? null
    };
    throw new Error(`CodeGraph projection handshake failed: ${message}\nCodeGraph handshake diagnostics: ${JSON.stringify(diagnostics)}`);
  }
}

function digestFile(path: string): string {
  try {
    return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
  } catch (error) {
    throw new Error(`CodeGraph binary is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface RepositoryCodeFactsInspectionOptions {
  binary?: string;
  timeouts?: { versionMs?: number; statusMs?: number };
}

export interface RepositoryCodeFactsPendingChangesV1 {
  added: number;
  modified: number;
  removed: number;
}

/**
 * Read-only state of this repository's CodeGraph index. `unavailable` means CodeGraph could not be
 * run or its output could not be read; no other field is then reported. `index-missing` means the
 * binary answered but the repository has no `.codegraph` index. `ready` and `not-ready` carry the
 * `codegraph status -j` values, and `issues` lists why `not-ready` is not ready.
 */
export type RepositoryCodeFactsV1 =
  | {
      schemaVersion: "archcontext.repository-code-facts/v1";
      state: "unavailable";
      requiredVersion: typeof REQUIRED_CODEGRAPH_VERSION;
      reasonCode: "codegraph-unavailable";
      message: string;
    }
  | {
      schemaVersion: "archcontext.repository-code-facts/v1";
      state: "index-missing";
      indexPresent: false;
      requiredVersion: typeof REQUIRED_CODEGRAPH_VERSION;
      codeGraphVersion: string;
      issues: ProjectionCodeGraphStatusIssueV1[];
    }
  | {
      schemaVersion: "archcontext.repository-code-facts/v1";
      state: "ready" | "not-ready";
      indexPresent: true;
      requiredVersion: typeof REQUIRED_CODEGRAPH_VERSION;
      codeGraphVersion: string;
      indexBuiltWithVersion: string | null;
      extractionVersion: { builtWith: number | null; current: number | null };
      indexState: string | null;
      reindexRecommended: boolean | null;
      pendingRefs: number | null;
      /** Source changes the index has not synced yet; `null` when `status` reported none. */
      pendingChanges: RepositoryCodeFactsPendingChangesV1 | null;
      issues: ProjectionCodeGraphStatusIssueV1[];
    };

/**
 * The packaged CodeGraph npm shim downloads its platform bundle from GitHub Releases when the
 * optional platform package is absent. `CODEGRAPH_NO_DOWNLOAD` (read by the shim's selfHealBundle)
 * turns that fetch off, so the read-only probe stays local whatever the egress mode is.
 */
const CODEGRAPH_NO_DOWNLOAD_ENV: Record<string, string> = { CODEGRAPH_NO_DOWNLOAD: "1" };

/**
 * Inspects the repository's code-facts state with `codegraph --version` and `codegraph status -j`
 * only. It never runs `sync`, never writes the index and never throws for an unavailable CodeGraph.
 */
export function inspectRepositoryCodeFacts(root: string, options: RepositoryCodeFactsInspectionOptions = {}): RepositoryCodeFactsV1 {
  const schemaVersion = "archcontext.repository-code-facts/v1" as const;
  let codeGraphVersion: string;
  let status: CodeGraphProjectionStatusV1 | undefined;
  const indexPresent = codeGraphIndexAvailable(root);
  try {
    const invocation = options.binary
      ? codeGraphCliInvocation(options.binary, root, "")
      : packagedCodeGraphCliInvocation();
    codeGraphVersion = runProjectionCodeGraph(invocation, root, ["--version"], options.timeouts?.versionMs ?? 10_000, CODEGRAPH_NO_DOWNLOAD_ENV).trim();
    if (indexPresent) status = readProjectionCodeGraphStatus(invocation, root, options.timeouts?.statusMs ?? 10_000, CODEGRAPH_NO_DOWNLOAD_ENV);
  } catch (error) {
    return {
      schemaVersion,
      state: "unavailable",
      requiredVersion: REQUIRED_CODEGRAPH_VERSION,
      reasonCode: "codegraph-unavailable",
      message: (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 400)
    };
  }
  const versionIssues: ProjectionCodeGraphStatusIssueV1[] = codeGraphVersion === REQUIRED_CODEGRAPH_VERSION
    ? []
    : [{ code: "version-mismatch", message: CODE_FACTS_ISSUE_MESSAGES["version-mismatch"] }];
  if (!indexPresent) {
    return { schemaVersion, state: "index-missing", indexPresent: false, requiredVersion: REQUIRED_CODEGRAPH_VERSION, codeGraphVersion, issues: versionIssues };
  }
  if (typeof status !== "object" || status === null || Array.isArray(status)) {
    return {
      schemaVersion,
      state: "unavailable",
      requiredVersion: REQUIRED_CODEGRAPH_VERSION,
      reasonCode: "codegraph-unavailable",
      message: "CodeGraph status JSON is not an object"
    };
  }
  const issues = [...versionIssues, ...projectionCodeGraphStatusIssues(status, root, "repository")];
  const pending = status.pendingChanges;
  // A projection runs `sync` first, so pending changes are not a projection-status issue; for a
  // read-only inspection they mean the index lags the worktree.
  if (!pending || pending.added !== 0 || pending.modified !== 0 || pending.removed !== 0) {
    issues.push({ code: "pending-source-changes", message: "CodeGraph repository index has pending or unreported source changes" });
  }
  return {
    schemaVersion,
    state: issues.length === 0 ? "ready" : "not-ready",
    indexPresent: true,
    requiredVersion: REQUIRED_CODEGRAPH_VERSION,
    codeGraphVersion,
    indexBuiltWithVersion: status.index?.builtWithVersion ?? null,
    extractionVersion: {
      builtWith: status.index?.builtWithExtractionVersion ?? null,
      current: status.index?.currentExtractionVersion ?? null
    },
    indexState: status.index?.state ?? null,
    reindexRecommended: issues.some(issue => issue.code !== "pending-source-changes"),
    pendingRefs: status.index?.pendingRefs ?? null,
    pendingChanges: pending ? { added: pending.added, modified: pending.modified, removed: pending.removed } : null,
    issues
  };
}

/** Read-only precondition shared by runtime consumers and the stateless checkpoint. */
export function assertRepositoryCodeFactsReady(root: string, options: RepositoryCodeFactsInspectionOptions & { allowPendingSourceChanges?: boolean } = {}): void {
  const facts = inspectRepositoryCodeFacts(root, options);
  if (facts.state === "index-missing") throw new ProjectionCodeFactsUnavailableError("index-missing");
  if (facts.state === "unavailable") throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-unavailable", {}, { action: "inspect-diagnostics", retryable: false });
  if (facts.state === "not-ready") {
    if (options.allowPendingSourceChanges && facts.issues.every(issue => issue.code === "pending-source-changes")) return;
    const action = facts.codeGraphVersion !== REQUIRED_CODEGRAPH_VERSION ? "install-compatible-codegraph"
      : facts.reindexRecommended ? "codegraph-index" : "codegraph-sync";
    throw new FailureError("AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", { issues: facts.issues }, { action });
  }
}

/** True when this workspace carries a CodeGraph index the CLI can be pointed at. */
export function codeGraphIndexAvailable(workspaceRoot: string): boolean {
  return existsSync(join(workspaceRoot, ".codegraph"));
}

export interface CodeGraphSymbolDeclaration {
  name: string;
  qualifiedName: string;
  startLine: number;
  endLine: number;
}

/** Read-only symbol lookups for `docs anchors` (#298). */
export interface CodeGraphSymbolReader {
  /** True when CodeGraph has a parser for this path's language. */
  supportsPath(path: string): boolean;
  /**
   * Every declaration parsed from `content` now; the index is not read, so it cannot be stale.
   * `undefined` when CodeGraph cannot parse the file.
   */
  declarationsInSource(path: string, content: string): CodeGraphSymbolDeclaration[] | undefined;
  /** Declarations named `name` in the CodeGraph index. */
  declarationsNamed(name: string): CodeGraphSymbolDeclaration[];
  close(): void;
}

export type CodeGraphSymbolReaderResult =
  | { availability: "ready"; reader: CodeGraphSymbolReader }
  | { availability: "unavailable"; reasonCode: "index-missing" | "index-open-failed" };

/** Kinds that name a reference or a scope, not a declaration a document can cite. */
const NON_DECLARATION_KINDS: ReadonlySet<string> = new Set(["file", "import", "export", "parameter"]);

/**
 * Opens the workspace CodeGraph index read-only for symbol lookups. It never opens the index
 * writable. When the read-only open fails, the result is `index-open-failed`. Whether a read-only
 * open works with no live holder depends on the SQLite build: Node's `node:sqlite` opens it and
 * creates the WAL files, and the macOS system SQLite that Bun uses there refuses it.
 */
export function openCodeGraphSymbolReader(
  workspaceRoot: string,
  openIndex: (root: string, options: { readOnly: true }) => ReturnType<CodeGraphSdk["CodeGraph"]["openSync"]> = (root, options) => codeGraphSdk().CodeGraph.openSync(root, options)
): CodeGraphSymbolReaderResult {
  if (!codeGraphIndexAvailable(workspaceRoot)) return { availability: "unavailable", reasonCode: "index-missing" };
  disableCodeGraphTelemetryByDefault();
  let graph: ReturnType<CodeGraphSdk["CodeGraph"]["openSync"]>;
  try {
    graph = openIndex(workspaceRoot, { readOnly: true });
  } catch {
    return { availability: "unavailable", reasonCode: "index-open-failed" };
  }
  const declarations = (nodes: CodeGraphNode[]): CodeGraphSymbolDeclaration[] => nodes
    .filter((node) => !NON_DECLARATION_KINDS.has(node.kind))
    .map((node) => ({ name: node.name, qualifiedName: node.qualifiedName, startLine: node.startLine, endLine: node.endLine }))
    .sort((left, right) => left.startLine - right.startLine || left.qualifiedName.localeCompare(right.qualifiedName));
  return {
    availability: "ready",
    reader: {
      supportsPath: (path) => codeGraphSdk().isLanguageSupported(codeGraphSdk().detectLanguage(path)),
      declarationsInSource: (path, content) => {
        try {
          return declarations(graph.extractFromSource(path, content).nodes);
        } catch {
          return undefined;
        }
      },
      declarationsNamed: (name) => declarations(graph.getNodesByName(name).filter((node) => node.name === name)),
      close: () => graph.close()
    }
  };
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
    /** Footprints resolved over the Git-visible files; resolved from `root` when omitted. */
    footprints?: readonly CapabilitySourceFootprint[];
    binary?: string;
    /** Safety cap on the import nodes read; `CODEGRAPH_IMPORT_NODE_READ_LIMIT` when omitted. */
    importNodeLimit?: number;
    /**
     * Import nodes in the index, from the `codegraph status` the caller asserted. The read is sized
     * from it. `null` or omitted is an unknown count: the read then asks for the limit.
     */
    importNodeCount?: number | null;
    selectorIndexFactory?: (root: string, options: { readOnly: boolean }) => CodeGraphSelectorIndex;
    /** Read consumers open selectors read-only and prohibit the import-query shim from downloading. */
    readOnly?: boolean;
    /** `false` skips the import-graph query; `flows check` reads selector evidence only. */
    importGraphs?: boolean;
  } = {}
): CapabilityCodeGraphProjectionInputs {
  const declaresFootprint = options.importGraphs !== false
    && model.nodes.some((node) => (nativeNodeSource(node)?.include ?? []).length > 0);
  const footprints = declaresFootprint
    ? options.footprints ?? loadCapabilitySourceFootprints(root, model, listGitVisibleFiles(root))
    : [];
  const entrypointNodes = model.nodes
    .map((node) => ({ nodeId: node.id, entrypoints: nativeNodeSource(node)?.entrypoints ?? [] }))
    .filter((entry) => entry.entrypoints.length > 0)
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  if (footprints.length === 0 && entrypointNodes.length === 0) return { importGraphs: [], selectorEvidence: [] };
  if (!codeGraphIndexAvailable(root)) return { importGraphs: [], selectorEvidence: [] };

  disableCodeGraphTelemetryByDefault();
  const binary = options.binary ?? DEFAULT_CODEGRAPH_BINARY;
  const imports = footprints.length > 0
    ? capabilityImportGraphs(root, binary, footprints, options.importNodeLimit ?? CODEGRAPH_IMPORT_NODE_READ_LIMIT, options.importNodeCount ?? null,
      options.readOnly ? CODEGRAPH_NO_DOWNLOAD_ENV : undefined)
    : undefined;
  const importGraphs = imports?.importGraphs ?? [];
  const selectorIndex = entrypointNodes.length > 0
    ? (options.selectorIndexFactory ?? ((path, openOptions) => codeGraphSdk().CodeGraph.openSync(path, openOptions)))(root, { readOnly: options.readOnly === true })
    : undefined;
  let selectorEvidence: ArchitectureSelectorEvidenceV1[];
  try {
    selectorEvidence = entrypointNodes.flatMap((entry) => entry.entrypoints.flatMap((entrypoint) =>
      entrypoint.symbols.flatMap((source) => source.sinks.map((sink) => exactSelectorEvidence(root, selectorIndex!, {
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
  return { importGraphs, selectorEvidence, ...(imports ? { importPopulation: imports.importPopulation } : {}) };
}

export interface RepositoryImportPairV1 {
  from: string;
  /** The specifier verbatim. Two different specifiers from one file are two observations. */
  specifier: string;
  /** Repo-relative target, or `null` when this producer could not resolve the specifier. */
  to: string | null;
  /** 1-based line of the first such import in `from`, when the index reported one. */
  line?: number;
}

export interface RepositoryImportPairsV1 {
  pairs: RepositoryImportPairV1[];
  /**
   * True when the pairs are not the whole population for a reason other than the limit: no
   * index answered, or the query returned a different number of import nodes than the index
   * reported (the index changed during the read).
   */
  truncated: boolean;
  /** `ready` only when an index exists and reports no pending source changes. */
  availability: "ready" | "unavailable";
  /** The worktree the index attests to, or `null` when it attests to nothing usable. */
  indexedWorktreeDigest: string | null;
  /**
   * Import nodes in the index, from `codegraph status` (`nodesByKind.import`). `null` when no
   * index answered, or when the status gave no count and the read stopped at the limit.
   */
  importNodeCount: number | null;
  /** The read limit this call applied. */
  importNodeLimit: number;
  /**
   * True when the index holds more import nodes than `importNodeLimit`. The pairs then come from
   * the first `importNodeLimit` nodes. This is a configured limit, not an incomplete index, so
   * `truncated` stays false.
   */
  importNodeLimitExceeded: boolean;
}

/**
 * Every import edge in the repository as repo-relative pairs, plus the identity of the index they
 * were read from. Unlike `capabilityImportGraphs` this keeps specifiers it could not resolve as
 * `to: null` with the specifier retained, because a module snapshot has to report how much of its
 * boundary is unresolved and a dropped edge is indistinguishable from an absent one. Bare
 * workspace specifiers are deliberately left unresolved here: mapping `@scope/pkg/sub` through a
 * package `exports` map is the builder's job, which keeps this adapter free of resolution rules
 * and keeps the resolution itself unit-testable without an index. The two producers share
 * `codeGraphImportPopulation` and `importPairsOf`; `capabilityImportGraphs` also returns these
 * pairs as `importPopulation`, and keeps its resolved-only graph edge set, which the capability
 * projection fixtures pin byte for byte.
 *
 * Freshness is producer-owned evidence, never a caller assertion: the returned
 * `indexedWorktreeDigest` binds the edges to `worktreeDigest` only when the index reports itself
 * clean, so a consumer cannot claim complete coverage over an index that never saw this tree.
 *
 * `limit` is a safety cap, not a page size. The read asks the index for its import count first
 * and then reads that whole population in one query, so a complete index gives complete pairs up
 * to `limit` import nodes. Above it, `importNodeLimitExceeded` is true and `truncated` stays false.
 */
export function repositoryImportPairs(
  root: string,
  binary: string,
  limit: number,
  worktreeDigest: string
): RepositoryImportPairsV1 {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`import node limit must be a positive integer, got ${limit}`);
  if (!codeGraphIndexAvailable(root)) {
    return {
      pairs: [],
      truncated: true,
      availability: "unavailable",
      indexedWorktreeDigest: null,
      importNodeCount: null,
      importNodeLimit: limit,
      importNodeLimitExceeded: false
    };
  }
  const status = readProjectionCodeGraphStatus(codeGraphCliInvocation(binary, root, ""), root, CODEGRAPH_QUERY_TIMEOUT_MS);
  const nodes = codeGraphImportPopulation(root, binary, limit, statusImportNodeCount(status));
  const pending = status.pendingChanges;
  const clean = status.initialized && pending !== undefined && pending.added === 0 && pending.modified === 0 && pending.removed === 0;
  return {
    pairs: importPairsOf(root, nodes.imports),
    truncated: nodes.truncated,
    availability: clean ? "ready" : "unavailable",
    indexedWorktreeDigest: clean ? worktreeDigest : null,
    importNodeCount: nodes.count,
    importNodeLimit: limit,
    importNodeLimitExceeded: nodes.limitExceeded
  };
}

/** Import nodes as repo-relative pairs, unresolved specifiers kept as `to: null`, sorted by file then specifier. */
function importPairsOf(root: string, imports: CodeGraphCliNode[]): RepositoryImportPairV1[] {
  const pairs = new Map<string, RepositoryImportPairV1>();
  for (const node of imports) {
    if (node.kind !== "import") continue;
    const to = resolveImportTarget(root, node.filePath, node.name) ?? null;
    // Keyed on (file, specifier) so three distinct unresolved specifiers stay three records. A
    // specifier imported twice from one file is one edge, located at its first import line.
    const key = JSON.stringify([node.filePath, node.name]);
    const line = Number.isInteger(node.startLine) && node.startLine! >= 1 ? node.startLine! : undefined;
    const previousLine = pairs.get(key)?.line;
    const firstLine = line === undefined ? previousLine : previousLine === undefined ? line : Math.min(line, previousLine);
    pairs.set(key, { from: node.filePath, specifier: node.name, to, ...(firstLine === undefined ? {} : { line: firstLine }) });
  }
  return [...pairs.keys()].sort().map((key) => pairs.get(key)!);
}

/**
 * The import population the index reports, or `null` when the status gives no `import` count.
 * A missing `import` kind is unknown, not zero: a CodeGraph that names the kind differently must
 * fall back to the limit-sized read, not to a one-node read that is always short.
 */
function statusImportNodeCount(status: CodeGraphProjectionStatusV1): number | null {
  if (!status.nodesByKind || typeof status.nodesByKind !== "object") return null;
  const count = status.nodesByKind.import;
  return Number.isInteger(count) && count! >= 0 ? count! : null;
}

/**
 * Reads the whole import population in one query. `codegraph query` has no offset, so the query
 * limit is the count the index reported, plus one: a reply longer or shorter than that count
 * means the index changed during the read, which is real truncation. Without a reported count,
 * the read asks for `limit + 1` and reports the reply size as the count.
 */
function codeGraphImportPopulation(
  root: string,
  binary: string,
  limit: number,
  reportedCount: number | null,
  envOverrides?: Record<string, string>
): { imports: CodeGraphCliNode[]; count: number | null; truncated: boolean; limitExceeded: boolean } {
  const queryLimit = Math.min(reportedCount ?? limit, limit) + 1;
  const output = runCodeGraphCli(
    binary,
    root,
    ["query", "-p", root, "-j", "-l", String(queryLimit), "-k", "import", "import"],
    Math.max(CODEGRAPH_OUTPUT_MAX_BYTES, queryLimit * CODEGRAPH_IMPORT_NODE_OUTPUT_BYTES),
    envOverrides
  );
  const imports = (JSON.parse(output) as { node: CodeGraphCliNode }[]).map(({ node }) => node);
  const limitExceeded = (reportedCount ?? imports.length) > limit;
  if (limitExceeded) {
    // The cap explains a reply of exactly `limit` nodes. A shorter reply means the index shrank
    // during the read, which is real truncation on top of the limit.
    return { imports: imports.slice(0, limit), count: reportedCount, truncated: imports.length < limit, limitExceeded };
  }
  return {
    imports,
    count: reportedCount ?? imports.length,
    truncated: reportedCount !== null && imports.length !== reportedCount,
    limitExceeded
  };
}


function capabilityImportGraphs(
  root: string,
  binary: string,
  footprints: readonly CapabilitySourceFootprint[],
  limit: number,
  reportedCount: number | null,
  envOverrides?: Record<string, string>
): { importGraphs: CapabilityImportGraph[]; importPopulation: ProjectionImportPopulationV1 } {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`import node limit must be a positive integer, got ${limit}`);
  const nodes = codeGraphImportPopulation(root, binary, limit, reportedCount, envOverrides);
  const population = importPairsOf(root, nodes.imports);
  // The graphs keep their resolved-only edge set, which the capability projection fixtures pin.
  const resolved = population.flatMap((pair) => pair.to === null ? [] : [{ from: pair.from, to: pair.to }]);
  const importGraphs = footprints.map((footprint) => {
    const scope = new Set(footprint.files);
    const edges = new Map<string, CapabilityImportEdge>();
    for (const pair of resolved) {
      if (!scope.has(pair.from)) continue;
      edges.set(`${pair.from} ${pair.to}`, pair);
    }
    return {
      nodeId: footprint.nodeId,
      files: footprint.files,
      edges: [...edges.values()].sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to)),
      truncated: nodes.truncated,
      ...(nodes.limitExceeded ? { importNodeLimitExceeded: true as const } : {})
    };
  });
  return {
    importGraphs,
    importPopulation: {
      pairs: population,
      truncated: nodes.truncated,
      importNodeCount: nodes.count,
      importNodeLimit: limit,
      importNodeLimitExceeded: nodes.limitExceeded
    }
  };
}

/**
 * Runtime built-in names a call can carry without any repository import: the named exports of
 * `node:path`, `node:fs`, `node:child_process`, `node:os`, `node:url` and `node:crypto` that code
 * imports by name, plus globals. CodeGraph resolves a call by name, so `resolve()` from
 * `node:path` can appear as a `calls` edge into a repository file that defines `resolve` (#300).
 * The list is explicit, not read from `node:module` at run time, so a proof does not change with
 * the Node or Bun version that computes it. Add a name only when it is such a built-in export.
 */
export const RUNTIME_BUILTIN_CALL_NAMES: ReadonlySet<string> = new Set([
  // node:path
  "basename", "dirname", "extname", "format", "isAbsolute", "join", "normalize", "parse", "relative", "resolve", "toNamespacedPath",
  // node:fs
  "access", "accessSync", "appendFile", "appendFileSync", "chmod", "chmodSync", "close", "closeSync", "copyFile", "copyFileSync",
  "cp", "cpSync", "createReadStream", "createWriteStream", "exists", "existsSync", "fsync", "fsyncSync", "lstat", "lstatSync",
  "mkdir", "mkdirSync", "mkdtemp", "mkdtempSync", "open", "openSync", "opendir", "opendirSync", "read", "readFile", "readFileSync",
  "readSync", "readdir", "readdirSync", "readlink", "readlinkSync", "realpath", "realpathSync", "rename", "renameSync", "rm",
  "rmSync", "rmdir", "rmdirSync", "stat", "statSync", "symlink", "symlinkSync", "unlink", "unlinkSync", "watch", "write",
  "writeFile", "writeFileSync", "writeSync",
  // node:child_process
  "exec", "execFile", "execFileSync", "execSync", "fork", "spawn", "spawnSync",
  // node:os, node:url, node:crypto
  "homedir", "hostname", "platform", "tmpdir", "fileURLToPath", "pathToFileURL", "createHash", "randomBytes", "randomUUID",
  // globals
  "clearInterval", "clearTimeout", "fetch", "queueMicrotask", "setInterval", "setTimeout", "structuredClone"
]);

function exactSelectorEvidence(
  root: string,
  index: CodeGraphSelectorIndex,
  selector: Omit<ArchitectureSelectorEvidenceV1, "matched" | "truncated" | "callSites">
): ArchitectureSelectorEvidenceV1 {
  const sources = indexedSymbolsAt(index, selector.sourceSymbol, selector.sourcePath);
  // A selector names one symbol. Two indexed declarations of the sink name in the sink file (for
  // example a function and a constant) make the sink ambiguous even when only one is called.
  const sinkDeclarations = indexedSymbolsAt(index, selector.sinkSymbol, selector.sinkPath);
  const exactEdges = sources.flatMap((source) => index.getOutgoingEdges(source.id)
    .filter((edge) => edge.kind === "calls" || edge.kind === "references")
    .flatMap((edge) => {
      const target = index.getNode(edge.target);
      return target
        && target.name === selector.sinkSymbol
        && normalizedIndexPath(target.filePath) === normalizedIndexPath(selector.sinkPath)
        ? [{ edge, target }]
        : [];
    }));
  const calls = exactEdges.filter(({ edge }) => edge.kind === "calls");
  const falseBuiltinCalls = calls.length > 0 && isFalseBuiltinCall(root, index, sources[0]!.filePath, selector);
  const exactCalls = falseBuiltinCalls ? [] : calls;
  const references = exactCalls.length === 0 ? exactEdges.filter(({ edge }) => edge.kind === "references") : [];
  const sinkIdentities = new Set(exactCalls.map(({ target }) => target.id));
  const ambiguous = sources.length > 1 || sinkDeclarations.length > 1 || sinkIdentities.size > 1;
  return {
    ...selector,
    matched: !ambiguous && sinkIdentities.size === 1,
    ambiguous,
    // The structured SDK queries above are uncapped index lookups (name index plus the full
    // outgoing-edge set of each source), so this producer enumerates the whole population and
    // can never drop a match; only the CLI-backed import query has a limit to report.
    truncated: false,
    callSites: edgeSites(selector.sourcePath, exactCalls),
    ...(falseBuiltinCalls ? { rejectedBuiltinCallSites: edgeSites(selector.sourcePath, calls) } : {}),
    ...(references.length > 0 ? { referenceSites: edgeSites(selector.sourcePath, references) } : {})
  };
}

function indexedSymbolsAt(index: CodeGraphSelectorIndex, name: string, path: string): CodeGraphNode[] {
  return index.getNodesByName(name).filter((node) => normalizedIndexPath(node.filePath) === normalizedIndexPath(path));
}

function edgeSites(sourcePath: string, edges: Array<{ edge: CodeGraphEdge }>): Array<{ path: string; line?: number }> {
  return [...new Map(edges.map(({ edge }) => {
    const site = { path: sourcePath, ...(edge.line === undefined ? {} : { line: edge.line }) };
    return [`${site.path}\0${site.line ?? ""}`, site] as const;
  })).values()].sort((left, right) => left.path.localeCompare(right.path) || (left.line ?? 0) - (right.line ?? 0));
}

/**
 * A call to a runtime built-in name proves nothing unless the source file imports the sink file:
 * otherwise CodeGraph may have matched a built-in (`resolve` from `node:path`) to a same-named
 * repository function. A call inside the sink file needs no import. Only relative specifiers are
 * resolved, so a call through a package alias or a re-exporting barrel is not proven this way.
 */
function isFalseBuiltinCall(
  root: string,
  index: CodeGraphSelectorIndex,
  indexedSourcePath: string,
  selector: { sourcePath: string; sinkPath: string; sinkSymbol: string }
): boolean {
  if (!RUNTIME_BUILTIN_CALL_NAMES.has(selector.sinkSymbol)) return false;
  const sourcePath = normalizedIndexPath(selector.sourcePath);
  const sinkPath = normalizedIndexPath(selector.sinkPath);
  if (sourcePath === sinkPath) return false;
  return !index.getNodesInFile(indexedSourcePath).some((node) => node.kind === "import"
    // A TypeScript ESM specifier names the emitted `.js` file; try the extensionless form too.
    && [node.name, node.name.replace(/\.[cm]?js$/, "")].some((specifier) => resolveImportTarget(root, sourcePath, specifier) === sinkPath));
}

function normalizedIndexPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function runCodeGraphCli(binary: string, workspaceRoot: string, args: string[], maxBuffer = CODEGRAPH_OUTPUT_MAX_BYTES, envOverrides?: Record<string, string>): string {
  disableCodeGraphTelemetryByDefault();
  const invocation = codeGraphCliInvocation(binary, workspaceRoot);
  try {
    return execFileSync(invocation.command, [...invocation.argsPrefix, ...args], {
      cwd: workspaceRoot,
      ...(envOverrides ? { env: { ...process.env, ...envOverrides } } : {}),
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
