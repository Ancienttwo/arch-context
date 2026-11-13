import { assertLocalEgressAllowed, localEgressMode } from "@archcontext/local-runtime/egress-admission";
import { execFileSync } from "node:child_process";
import { accessSync, closeSync, constants as fsConstants, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { codeGraphChildEnv } from "./child-env";
import { REQUIRED_CODEGRAPH_PACKAGE, REQUIRED_CODEGRAPH_VERSION, type CodeGraphReadProvider } from "./read-session";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { digestJson, type Json, type NormalizedCodeContext, type NormalizedEdge, type NormalizedImpact, type NormalizedSymbol, type SymbolQuery } from "@archcontext/contracts";
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

export class CodeGraphCliProvider implements CodeGraphProvider {
  version: string = REQUIRED_CODEGRAPH_VERSION;
  capabilities = ["index", "context", "impact"];
  private workspaceRoot: string;

  /**
   * `binary` builds the index (`sync`); reads never start it. `readProvider` is the read-only
   * provider readiness reads through, the pinned one unless a test injects one.
   */
  constructor(workspaceRoot = process.cwd(), private readonly binary = DEFAULT_CODEGRAPH_BINARY, private readonly readProvider?: CodeGraphReadProvider) {
    this.workspaceRoot = workspaceRoot;
  }

  async indexAll(workspaceRoot: string): Promise<void> {
    this.workspaceRoot = workspaceRoot;
    this.assertCanSync(workspaceRoot);
    this.run(["sync", workspaceRoot]);
    this.assertReady(workspaceRoot);
  }

  assertReady(workspaceRoot: string): void {
    assertRepositoryCodeFactsReady(workspaceRoot, this.readProvider ? { provider: this.readProvider } : {});
  }

  assertCanSync(workspaceRoot: string): void {
    this.assertReady(workspaceRoot);
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
    const edges = uniqueEdges(importEdgesFromQueryNodes(new Set(listGitVisibleFiles(this.workspaceRoot)), importNodes.length > 0 ? importNodes : queryNodes));
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
        env: codeGraphChildEnv(),
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

export function digestFile(path: string): string {
  try {
    return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
  } catch (error) {
    throw new Error(`CodeGraph binary is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function runCodeGraphCli(binary: string, workspaceRoot: string, args: string[], maxBuffer = CODEGRAPH_OUTPUT_MAX_BYTES, envOverrides?: Record<string, string>): string {
  disableCodeGraphTelemetryByDefault();
  const invocation = codeGraphCliInvocation(binary, workspaceRoot);
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
