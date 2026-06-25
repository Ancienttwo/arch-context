import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, isAbsolute, join, posix } from "node:path";
import { buildArchitectureCandidateDelta, type ArchitectureDeltaGitChangeMetadata } from "@archcontext/core/architecture-delta";
import { repoScopedArchitectureId, type CrossRepoRelation } from "@archcontext/core/architecture-domain";
import { digestJson, type ArchitectureCandidateDeltaV1, type ArchitectureRepositoryIdentityV1, type ArchitectureWorktreeIdentityV1, type CodeFactsPort, type CodeFactsSnapshot, type ImpactQuery, type Json, type NormalizedCodeContext, type NormalizedEdge, type NormalizedImpact, type NormalizedSymbol, type ObservedEvidence, type SourceSelector, type SymbolQuery, type WorkspaceRef } from "@archcontext/contracts";

export const REQUIRED_CODEGRAPH_PACKAGE = "@colbymchenry/codegraph";
export const REQUIRED_CODEGRAPH_VERSION = "1.0.1";
export const CODEGRAPH_TELEMETRY_ENV = "DO_NOT_TRACK";
export const CODEGRAPH_TELEMETRY_DISABLED_VALUE = "1";

type MutableEnv = Record<string, string | undefined>;

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

  constructor(workspaceRoot = process.cwd(), private readonly binary = "codegraph") {
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
    return {
      symbolId,
      callers: [],
      callees: [],
      affectedPaths: affected.map((symbol) => symbol.path)
    };
  }

  private run(args: string[]): string {
    const invocation = codeGraphCliInvocation(this.binary, this.workspaceRoot);
    try {
      return execFileSync(invocation.command, [...invocation.argsPrefix, ...args], {
        cwd: this.workspaceRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
      const message = stderr.trim() || (error instanceof Error ? error.message : String(error));
      throw new Error(`CodeGraph CLI failed: ${message}`);
    }
  }
}

interface CodeGraphCliInvocation {
  command: string;
  argsPrefix: string[];
}

function codeGraphCliInvocation(binary: string, cwd: string): CodeGraphCliInvocation {
  const resolved = resolveExecutable(binary, cwd);
  if (resolved && isNodeRuntimeScript(resolved)) {
    return { command: process.execPath, argsPrefix: [resolved] };
  }
  return { command: binary, argsPrefix: [] };
}

function resolveExecutable(binary: string, cwd: string): string | undefined {
  if (binary.includes("/") || binary.includes("\\")) {
    const path = isAbsolute(binary) ? binary : join(cwd, binary);
    return existsSync(path) ? realpathSync.native(path) : undefined;
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const path = join(dir, binary);
    if (existsSync(path)) return realpathSync.native(path);
  }
  return undefined;
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

function normalizeCliNode(node: CodeGraphCliNode): NormalizedSymbol {
  return {
    id: node.id ?? `codegraph.${digestJson({ name: node.name, path: node.filePath } as unknown as Json).slice(7, 19)}`,
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
  return nodes
    .filter((node) => node.kind === "import")
    .flatMap((node) => {
      const target = resolveImportTarget(workspaceRoot, node.filePath, node.name);
      if (!target) return [];
      return [{
        source: fileSymbolId(node.filePath),
        target: fileSymbolId(target),
        kind: "imports" as const,
        confidence: "high" as const
      }];
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
