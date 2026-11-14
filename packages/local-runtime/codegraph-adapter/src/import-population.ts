import { posix } from "node:path";
import type { CapabilitySourceFootprint, CapabilityImportEdge, CapabilityImportGraph } from "@archcontext/core/projection-engine";
import type { NormalizedEdge } from "@archcontext/contracts";
import type { CodeGraphCliNode } from "./cli-provider";
import { withCodeGraphReadSession, type CodeGraphReadProvider, type CodeGraphReadSession } from "./read-session";

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
 * Default cap on the import nodes `repositoryImportPairs` and the docs projection keep. The read
 * loads the index's whole import population in process (`getNodesByKind("import")` has no limit),
 * so the cap bounds the coverage a consumer is given, not the memory of the read. 64 000 is about
 * 10x repo-harness's 6 420 import nodes; at 64 000 nodes the read measured 0.6 s and 340 MiB peak
 * RSS under Node, within 7 % of a 50 000 cap on the same index (#585).
 */
export const CODEGRAPH_IMPORT_NODE_READ_LIMIT = 64_000;

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
   * index answered, or the index changed during the read (its import count or its revision moved).
   */
  truncated: boolean;
  /** `ready` only when an index answered, reports no pending source changes and did not move during the read. */
  availability: "ready" | "unavailable";
  /** The worktree the index attests to, or `null` when it attests to nothing usable. */
  indexedWorktreeDigest: string | null;
  /** Import nodes in the index (`getStats().nodesByKind.import`). `null` when no index answered. */
  importNodeCount: number | null;
  /** The read limit this call applied. */
  importNodeLimit: number;
  /**
   * True when the index holds more import nodes than `importNodeLimit`. The pairs then come from
   * the first `importNodeLimit` nodes in (filePath, name, startLine) order. This is a configured
   * limit, not an incomplete index, so `truncated` stays false.
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
 * One read-only session answers everything (ADR-0058): no CodeGraph command, no `git status` or
 * `git diff`. Freshness is producer-owned evidence, never a caller assertion: the returned
 * `indexedWorktreeDigest` binds the edges to `worktreeDigest` only when CodeGraph's own change
 * test finds no pending source change and the index did not move during the read, so a consumer
 * cannot claim complete coverage over an index that never saw this tree. An index that is
 * missing, mid-build or cannot be opened is `unavailable`.
 *
 * `limit` is a safety cap, not a page size. Above it, `importNodeLimitExceeded` is true and
 * `truncated` stays false.
 */
export function repositoryImportPairs(
  root: string,
  limit: number,
  worktreeDigest: string,
  /** The Git-visible files (`listGitVisibleFiles`) that `worktreeDigest` was computed over. */
  sourceFiles: readonly string[],
  options: { provider?: CodeGraphReadProvider } = {}
): RepositoryImportPairsV1 {
  assertImportNodeLimit(limit);
  return withCodeGraphReadSession(root, (opened): RepositoryImportPairsV1 => {
    if (opened.state !== "open") {
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
    const { session } = opened;
    const nodes = codeGraphImportPopulation(session, limit);
    const pending = session.freshness();
    // Facts read across a sync are not one index state (design G4).
    const unchanged = session.unchangedSinceOpen();
    const clean = unchanged && pending.added === 0 && pending.modified === 0 && pending.removed === 0;
    return {
      pairs: importPairsOf(new Set(sourceFiles), nodes.imports),
      truncated: nodes.truncated || !unchanged,
      availability: clean ? "ready" : "unavailable",
      indexedWorktreeDigest: clean ? worktreeDigest : null,
      importNodeCount: nodes.count,
      importNodeLimit: limit,
      importNodeLimitExceeded: nodes.limitExceeded
    };
  }, options);
}

function assertImportNodeLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`import node limit must be a positive integer, got ${limit}`);
}

/** The fields of an import node this producer reads; the SDK node and the CLI node both carry them. */
type ImportNode = Pick<CodeGraphCliNode, "kind" | "name" | "filePath" | "startLine">;

/** Import nodes as repo-relative pairs, unresolved specifiers kept as `to: null`, sorted by file then specifier. */
function importPairsOf(gitVisibleFiles: ReadonlySet<string>, imports: readonly ImportNode[]): RepositoryImportPairV1[] {
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
 * Reads the whole import population from the session's handle. The count comes first
 * (`getStats`), then the nodes; each is one statement, so a node list longer or shorter than the
 * count means the index changed between them, which is real truncation. Above `limit` the kept
 * prefix is the first `limit` nodes in (filePath, name, startLine) order, so the cut does not
 * depend on the order the index stores them in. `getStats` counts kinds with a `GROUP BY`, so an
 * absent `import` key is zero import nodes.
 */
function codeGraphImportPopulation(
  session: CodeGraphReadSession,
  limit: number
): { imports: ImportNode[]; count: number; truncated: boolean; limitExceeded: boolean } {
  const count = session.graph.getStats().nodesByKind.import ?? 0;
  const imports: ImportNode[] = session.graph.getNodesByKind("import").sort(compareImportNodes);
  const limitExceeded = count > limit;
  return {
    imports: limitExceeded ? imports.slice(0, limit) : imports,
    count,
    truncated: imports.length !== count,
    limitExceeded
  };
}

function compareImportNodes(left: ImportNode, right: ImportNode): number {
  return compareStrings(left.filePath, right.filePath) || compareStrings(left.name, right.name) || (left.startLine ?? 0) - (right.startLine ?? 0);
}

/** Code-unit order, independent of the process locale. */
function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Per-capability import graphs over the session's import population. A session that the caller
 * opened for several reads gives them one index state.
 */
export function capabilityImportGraphs(
  session: CodeGraphReadSession,
  gitVisibleFiles: ReadonlySet<string>,
  footprints: readonly CapabilitySourceFootprint[],
  limit: number
): { importGraphs: CapabilityImportGraph[]; importPopulation: ProjectionImportPopulationV1 } {
  assertImportNodeLimit(limit);
  const nodes = codeGraphImportPopulation(session, limit);
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
