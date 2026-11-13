import { posix } from "node:path";
import type { CapabilitySourceFootprint, CapabilityImportEdge, CapabilityImportGraph } from "@archcontext/core/projection-engine";
import type { NormalizedEdge } from "@archcontext/contracts";
import { CODEGRAPH_OUTPUT_MAX_BYTES, CODEGRAPH_QUERY_TIMEOUT_MS, codeGraphCliInvocation, runCodeGraphCli, type CodeGraphCliNode } from "./cli-provider";
import { readProjectionCodeGraphStatus, type CodeGraphProjectionStatusV1 } from "./projection-handshake";
import { codeGraphIndexAvailable } from "./repository-code-facts";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];

export function importQuery(changedPaths: string[]): string | undefined {
  const scoped = normalizeChangedPaths(changedPaths);
  if (scoped.length === 0) return undefined;
  return uniqueStrings(["import", ...scoped]).join(" ");
}

export function importEdgesFromQueryNodes(gitVisibleFiles: ReadonlySet<string>, nodes: CodeGraphCliNode[]): NormalizedEdge[] {
  return resolvedImportPairs(gitVisibleFiles, nodes).map((pair) => ({
    source: fileSymbolId(pair.from),
    target: fileSymbolId(pair.to),
    kind: "imports" as const,
    confidence: "high" as const
  }));
}

/**
 * Import nodes whose specifier resolved to a Git-visible file. A specifier the resolver cannot pin
 * to such a file (bare package name, workspace alias, missing or ignored target) yields no pair:
 * the caller gets fewer edges, never a guessed one.
 */
function resolvedImportPairs(gitVisibleFiles: ReadonlySet<string>, nodes: CodeGraphCliNode[]): { from: string; to: string }[] {
  return nodes
    .filter((node) => node.kind === "import")
    .flatMap((node) => {
      const target = resolveImportTarget(gitVisibleFiles, node.filePath, node.name);
      return target ? [{ from: node.filePath, to: target }] : [];
    });
}

/**
 * Resolves a relative specifier against the Git-visible files (`listGitVisibleFiles`), never the
 * working tree, so an untracked-but-ignored file cannot change a result between two checkouts of
 * one commit.
 */
export function resolveImportTarget(gitVisibleFiles: ReadonlySet<string>, fromPath: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  if (base === "." || base.startsWith("../") || posix.isAbsolute(base)) return undefined;
  return importTargetCandidates(base).find((candidate) => gitVisibleFiles.has(candidate));
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

export function normalizeChangedPaths(paths: string[]): string[] {
  return uniqueStrings(paths
    .map((path) => path.trim().replaceAll("\\", "/"))
    .filter((path) => path.length > 0 && !path.startsWith("/") && !path.includes(".."))
  ).sort();
}

export function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)];
}

/**
 * Default cap on the import nodes `repositoryImportPairs` and the docs projection read. The read
 * is sized from the index's own import count, so this cap only bounds memory and time. One import
 * node costs about 0.7 KiB of CLI output, so the default is about 35 MiB.
 */
export const CODEGRAPH_IMPORT_NODE_READ_LIMIT = 50_000;
/** Output allowance per import node, so a large read is not cut by the CLI output buffer. */
const CODEGRAPH_IMPORT_NODE_OUTPUT_BYTES = 4 * 1024;

export type ProjectionImportPopulationV1 = Omit<RepositoryImportPairsV1, "availability" | "indexedWorktreeDigest">;

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
  worktreeDigest: string,
  /** The Git-visible files (`listGitVisibleFiles`) that `worktreeDigest` was computed over. */
  sourceFiles: readonly string[]
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
    pairs: importPairsOf(new Set(sourceFiles), nodes.imports),
    truncated: nodes.truncated,
    availability: clean ? "ready" : "unavailable",
    indexedWorktreeDigest: clean ? worktreeDigest : null,
    importNodeCount: nodes.count,
    importNodeLimit: limit,
    importNodeLimitExceeded: nodes.limitExceeded
  };
}

/** Import nodes as repo-relative pairs, unresolved specifiers kept as `to: null`, sorted by file then specifier. */
function importPairsOf(gitVisibleFiles: ReadonlySet<string>, imports: CodeGraphCliNode[]): RepositoryImportPairV1[] {
  const pairs = new Map<string, RepositoryImportPairV1>();
  for (const node of imports) {
    if (node.kind !== "import") continue;
    const to = resolveImportTarget(gitVisibleFiles, node.filePath, node.name) ?? null;
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
export function statusImportNodeCount(status: CodeGraphProjectionStatusV1): number | null {
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


export function capabilityImportGraphs(
  root: string,
  binary: string,
  gitVisibleFiles: ReadonlySet<string>,
  footprints: readonly CapabilitySourceFootprint[],
  limit: number,
  reportedCount: number | null,
  envOverrides?: Record<string, string>
): { importGraphs: CapabilityImportGraph[]; importPopulation: ProjectionImportPopulationV1 } {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`import node limit must be a positive integer, got ${limit}`);
  const nodes = codeGraphImportPopulation(root, binary, limit, reportedCount, envOverrides);
  const population = importPairsOf(gitVisibleFiles, nodes.imports);
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
