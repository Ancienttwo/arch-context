import { createHash } from "node:crypto";
import type { Edge as CodeGraphEdge, Node as CodeGraphNode } from "@colbymchenry/codegraph";
import { codeGraphBundle, type CodeGraphSdk } from "./read-session";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import {
  loadCapabilitySourceFootprints,
  nativeNodeSource,
  type ArchitectureSelectorEvidenceV1,
  type CapabilitySourceFootprint,
  type CapabilityImportGraph,
  type NativeModel
} from "@archcontext/core/projection-engine";
import { DEFAULT_CODEGRAPH_BINARY, disableCodeGraphTelemetryByDefault } from "./cli-provider";
import { CODEGRAPH_IMPORT_NODE_READ_LIMIT, capabilityImportGraphs, resolveImportTarget, type ProjectionImportPopulationV1 } from "./import-population";
import { codeGraphIndexAvailable } from "./repository-code-facts";

// The SDK stays in its installed package so its platform/cache resolver stays relocatable. It is
// resolved only when a CodeGraph operation needs it; the stateless native export never loads it.
function codeGraphSdk(): CodeGraphSdk {
  return codeGraphBundle().sdk;
}

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

export interface CodeGraphSelectorIndex {
  getNodesByName(name: string): CodeGraphNode[];
  getOutgoingEdges(nodeId: string): CodeGraphEdge[];
  getNode(nodeId: string): CodeGraphNode | null;
  /** Read only for a call to a runtime built-in name, to find the source file's imports. */
  getNodesInFile(filePath: string): CodeGraphNode[];
  close(): void;
}

/**
 * The packaged CodeGraph npm shim downloads its platform bundle from GitHub Releases when the
 * optional platform package is absent. `CODEGRAPH_NO_DOWNLOAD` (read by the shim's selfHealBundle)
 * turns that fetch off, so the snapshot's CLI probe stays local whatever the egress mode is.
 */
const CODEGRAPH_NO_DOWNLOAD_ENV: Record<string, string> = { CODEGRAPH_NO_DOWNLOAD: "1" };

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
  /**
   * The declarations that the index holds for `path`, or `undefined` when the index does not hold
   * `bytes` as the file's content. The test is CodeGraph's own change test: the SHA-256 of the
   * UTF-8 text equals the recorded content hash.
   */
  indexedDeclarations(path: string, bytes: Uint8Array): CodeGraphIndexedDeclaration[] | undefined;
  /**
   * The resolved targets of the `calls` and `references` edges from each id, read in one batch and
   * keyed by source id. A reference that CodeGraph left unresolved has no target and is absent.
   */
  callees(ids: readonly string[]): Map<string, CodeGraphCallee[]>;
  /** The ids that each id contains, directly or nested, by the index's `contains` edges. */
  contained(ids: readonly string[]): Map<string, Set<string>>;
  close(): void;
}

/** A declaration as the CodeGraph index records it. */
export interface CodeGraphIndexedDeclaration extends CodeGraphSymbolDeclaration {
  id: string;
  kind: string;
  path: string;
}

export interface CodeGraphCallee extends CodeGraphIndexedDeclaration {
  /** The kinds of the declarations that contain this one, by `contains` edges. */
  containerKinds: string[];
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
      indexedDeclarations: (path, bytes) => {
        const record = graph.getFile(path);
        const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
        if (record === null || record.contentHash !== createHash("sha256").update(text).digest("hex")) return undefined;
        return graph.getNodesInFile(path).filter((node) => !NON_DECLARATION_KINDS.has(node.kind)).map(indexedDeclaration);
      },
      callees: (ids) => {
        const edges = graph.getOutgoingEdgesFrom(ids, ["calls", "references"]);
        const targetIds = [...new Set(edges.map((edge) => edge.target))];
        const targets = graph.getNodesByIds(targetIds);
        const containment = graph.getIncomingEdgesTo(targetIds, ["contains"]);
        const containers = graph.getNodesByIds([...new Set(containment.map((edge) => edge.source))]);
        const containerKinds = new Map<string, string[]>();
        for (const edge of containment) {
          const container = containers.get(edge.source);
          if (container !== undefined) containerKinds.set(edge.target, [...containerKinds.get(edge.target) ?? [], container.kind]);
        }
        const bySource = new Map<string, Map<string, CodeGraphCallee>>();
        for (const edge of edges) {
          const target = targets.get(edge.target);
          if (target === undefined) continue;
          let entries = bySource.get(edge.source);
          if (entries === undefined) bySource.set(edge.source, entries = new Map());
          entries.set(target.id, { ...indexedDeclaration(target), containerKinds: containerKinds.get(target.id) ?? [] });
        }
        return new Map([...bySource].map(([source, entries]) => [source, [...entries.values()]]));
      },
      contained: (ids) => {
        const result = new Map(ids.map((id) => [id, new Set<string>()]));
        // One edge read per nesting level, for all ids at once.
        let frontier = ids.map((id) => [id, id] as const);
        while (frontier.length > 0) {
          const roots = new Map<string, string[]>();
          for (const [root, node] of frontier) roots.set(node, [...roots.get(node) ?? [], root]);
          frontier = graph.getOutgoingEdgesFrom([...roots.keys()], ["contains"])
            .flatMap((edge) => roots.get(edge.source)!.map((root) => [root, edge.target] as const))
            .filter(([root, node]) => !result.get(root)!.has(node));
          for (const [root, node] of frontier) result.get(root)!.add(node);
        }
        return result;
      },
      close: () => graph.close()
    }
  };
}

function indexedDeclaration(node: CodeGraphNode): CodeGraphIndexedDeclaration {
  return { id: node.id, kind: node.kind, path: node.filePath, name: node.name, qualifiedName: node.qualifiedName, startLine: node.startLine, endLine: node.endLine };
}

/**
 * `reader.declarationsInSource` over the content that `contents` returns, each path parsed at most
 * once. `undefined` for a path whose language CodeGraph has no parser for, or that it cannot parse.
 */
export function memoizedSourceDeclarations(reader: CodeGraphSymbolReader, contents: (path: string) => string): (path: string) => CodeGraphSymbolDeclaration[] | undefined {
  const parsed = new Map<string, CodeGraphSymbolDeclaration[] | undefined>();
  return (path) => {
    if (!parsed.has(path)) parsed.set(path, reader.supportsPath(path) ? reader.declarationsInSource(path, contents(path)) : undefined);
    return parsed.get(path);
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
    /** The Git-visible files (`listGitVisibleFiles`); read once from `root` when omitted. */
    sourceFiles?: readonly string[];
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
  let visibleFiles: readonly string[] | undefined = options.sourceFiles;
  const sourceFiles = () => visibleFiles ??= listGitVisibleFiles(root);
  const declaresFootprint = options.importGraphs !== false
    && model.nodes.some((node) => (nativeNodeSource(node)?.include ?? []).length > 0);
  const footprints = declaresFootprint
    ? options.footprints ?? loadCapabilitySourceFootprints(root, model, sourceFiles())
    : [];
  const entrypointNodes = model.nodes
    .map((node) => ({ nodeId: node.id, entrypoints: nativeNodeSource(node)?.entrypoints ?? [] }))
    .filter((entry) => entry.entrypoints.length > 0)
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  if (footprints.length === 0 && entrypointNodes.length === 0) return { importGraphs: [], selectorEvidence: [] };
  if (!codeGraphIndexAvailable(root)) return { importGraphs: [], selectorEvidence: [] };

  disableCodeGraphTelemetryByDefault();
  const binary = options.binary ?? DEFAULT_CODEGRAPH_BINARY;
  const importTargets = new Set(sourceFiles());
  const imports = footprints.length > 0
    ? capabilityImportGraphs(root, binary, importTargets, footprints, options.importNodeLimit ?? CODEGRAPH_IMPORT_NODE_READ_LIMIT, options.importNodeCount ?? null,
      options.readOnly ? CODEGRAPH_NO_DOWNLOAD_ENV : undefined)
    : undefined;
  const importGraphs = imports?.importGraphs ?? [];
  const selectorIndex = entrypointNodes.length > 0
    ? (options.selectorIndexFactory ?? ((path, openOptions) => codeGraphSdk().CodeGraph.openSync(path, openOptions)))(root, { readOnly: options.readOnly === true })
    : undefined;
  let selectorEvidence: ArchitectureSelectorEvidenceV1[];
  try {
    selectorEvidence = entrypointNodes.flatMap((entry) => entry.entrypoints.flatMap((entrypoint) =>
      entrypoint.symbols.flatMap((source) => source.sinks.map((sink) => exactSelectorEvidence(importTargets, selectorIndex!, {
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
  gitVisibleFiles: ReadonlySet<string>,
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
  const falseBuiltinCalls = calls.length > 0 && isFalseBuiltinCall(gitVisibleFiles, index, sources[0]!.filePath, selector);
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
  gitVisibleFiles: ReadonlySet<string>,
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
    && [node.name, node.name.replace(/\.[cm]?js$/, "")].some((specifier) => resolveImportTarget(gitVisibleFiles, sourcePath, specifier) === sinkPath));
}

export function normalizedIndexPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}
