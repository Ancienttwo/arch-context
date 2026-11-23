import {
  CAPABILITY_DEPENDENCIES_CALL_EDGE_LIMIT,
  CAPABILITY_DEPENDENCIES_CALL_LIMIT_REASON,
  parseRefactorKillListSymbolTarget,
  type EvidenceCoverageLevelV2
} from "@archcontext/contracts";
import type { Node as CodeGraphNode, NodeKind as CodeGraphNodeKind } from "@colbymchenry/codegraph";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  pinnedCodeGraphProvider,
  withCodeGraphReadSession,
  type CodeGraphReadProvider
} from "./read-session";

export interface RepositoryCallEdgeFactV1 {
  fromPath: string;
  toPath: string;
  fromSymbol: string;
  toSymbol: string;
  kind: "calls" | "references";
}

export interface FileTopLevelSymbolFactV1 {
  name: string;
  qualifiedName: string;
  kind: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
}

export interface FileSymbolStructureFactV1 {
  path: string;
  lineCount: number;
  topLevelSymbols: FileTopLevelSymbolFactV1[];
  intraFileEdges: { from: string; to: string }[];
}

export interface IndexedFileFactV1 {
  contentHash: string;
  nodeCount: number;
  errors: number;
}

export interface RepositoryStructuralFactsV1 {
  coverage: EvidenceCoverageLevelV2;
  reasonCodes: string[];
  callEdges: RepositoryCallEdgeFactV1[];
  callEdgeCount: number;
  callEdgeLimit: number;
  callEdgeLimitExceeded: boolean;
  fileStructures: FileSymbolStructureFactV1[];
  indexedFiles: Map<string, IndexedFileFactV1>;
}

export interface ReadRepositoryStructuralFactsOptions {
  callEdgeLimit?: number;
  readFileLineCount?: (repoPath: string) => number | null;
  provider?: CodeGraphReadProvider;
}

export interface SymbolKillListCheckV1 {
  target: string;
  status: "present" | "absent" | "unknown";
  reasonCode?: string;
}

export interface VerifySymbolKillListOptions {
  codeFactsReady: boolean;
  trackedFiles?: ReadonlySet<string>;
  caseInsensitive?: boolean;
  provider?: CodeGraphReadProvider;
}

const CHUNK_SIZE = 250;
const WRAPPER_NODE_KINDS = new Set<CodeGraphNodeKind>(["file", "module", "import", "export", "parameter"]);
const TOP_LEVEL_EXCLUDED_KINDS = new Set<CodeGraphNodeKind>([
  "file",
  "module",
  "import",
  "export",
  "parameter",
  "property",
  "field",
  "enum_member"
]);

function chunkArray<T>(items: readonly T[], size = CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function symbolKey(node: CodeGraphNode): string {
  return node.qualifiedName || node.name;
}

function enclosesStrictly(outer: CodeGraphNode, inner: CodeGraphNode): boolean {
  if (outer.id === inner.id) return false;
  if (outer.startLine > inner.startLine || outer.endLine < inner.endLine) return false;
  const outerLines = outer.endLine - outer.startLine;
  const innerLines = inner.endLine - inner.startLine;
  if (outerLines !== innerLines) return outerLines > innerLines;
  return outer.startColumn <= inner.startColumn && outer.endColumn >= inner.endColumn &&
    (outer.endColumn - outer.startColumn) > (inner.endColumn - inner.startColumn);
}

function resolveRootSymbolByNodeId(
  nodes: readonly CodeGraphNode[],
  containedChildToParent: ReadonlyMap<string, string>
): { topLevelNodes: CodeGraphNode[]; rootKeyByNodeId: Map<string, string> } {
  const defNodes = nodes.filter((node) => !TOP_LEVEL_EXCLUDED_KINDS.has(node.kind));
  const defById = new Map(defNodes.map((node) => [node.id, node]));
  const parentById = new Map<string, string>();

  for (const node of defNodes) {
    const containedParentId = containedChildToParent.get(node.id);
    if (containedParentId && defById.has(containedParentId) && containedParentId !== node.id) {
      parentById.set(node.id, containedParentId);
      continue;
    }
    let bestParent: CodeGraphNode | undefined;
    for (const candidate of defNodes) {
      if (!enclosesStrictly(candidate, node)) continue;
      if (
        !bestParent ||
        (candidate.endLine - candidate.startLine) < (bestParent.endLine - bestParent.startLine)
      ) {
        bestParent = candidate;
      }
    }
    if (bestParent) {
      parentById.set(node.id, bestParent.id);
    }
  }

  const rootNodeById = new Map<string, CodeGraphNode>();
  const resolveRoot = (node: CodeGraphNode): CodeGraphNode => {
    const visited = new Set<string>([node.id]);
    let current = node;
    while (true) {
      const parentId = parentById.get(current.id);
      if (!parentId || visited.has(parentId)) break;
      const parent = defById.get(parentId);
      if (!parent) break;
      visited.add(parent.id);
      current = parent;
    }
    return current;
  };

  for (const node of defNodes) {
    rootNodeById.set(node.id, resolveRoot(node));
  }

  const topLevelNodes = [...new Map(
    defNodes
      .filter((node) => !parentById.has(node.id))
      .map((node) => [node.id, node])
  ).values()].sort((left, right) =>
    (left.startLine - right.startLine) || compareText(symbolKey(left), symbolKey(right))
  );

  const rootKeyByNodeId = new Map<string, string>();
  for (const [id, rootNode] of rootNodeById) {
    rootKeyByNodeId.set(id, symbolKey(rootNode));
  }
  return { topLevelNodes, rootKeyByNodeId };
}

/**
 * Reads symbol definitions, intra-file symbol connectivity, and bounded cross-file `calls`/`references`
 * edges in one read-only CodeGraph session (ADR-0058).
 */
export function readRepositoryStructuralFacts(
  root: string,
  trackedPaths: readonly string[],
  options: ReadRepositoryStructuralFactsOptions = {}
): RepositoryStructuralFactsV1 {
  const callEdgeLimit = Math.max(1, Math.trunc(options.callEdgeLimit ?? CAPABILITY_DEPENDENCIES_CALL_EDGE_LIMIT));
  const sortedTracked = [...new Set(trackedPaths)].sort(compareText);

  return withCodeGraphReadSession(
    root,
    (opened) => {
      if (opened.state !== "open") {
        return {
          coverage: "unknown",
          reasonCodes: ["code-facts-unavailable"],
          callEdges: [],
          callEdgeCount: 0,
          callEdgeLimit,
          callEdgeLimitExceeded: false,
          fileStructures: [],
          indexedFiles: new Map()
        };
      }

      const graph = opened.session.graph;
      const fileRecords = graph.getFiles();
      const indexedFiles = new Map<string, IndexedFileFactV1>();
      for (const record of fileRecords) {
        const errors = (record as { errors?: number }).errors ?? 0;
        indexedFiles.set(record.path, {
          contentHash: record.contentHash,
          nodeCount: record.nodeCount,
          errors
        });
      }

      const queryPaths = sortedTracked.filter((path) => indexedFiles.has(path));
      const nodesByPath = new Map<string, CodeGraphNode[]>();
      const nodeById = new Map<string, CodeGraphNode>();
      const defNodeIds: string[] = [];

      for (const chunk of chunkArray(queryPaths)) {
        const chunkNodes = graph.getNodesInFiles(chunk);
        for (const node of chunkNodes) {
          nodeById.set(node.id, node);
          let list = nodesByPath.get(node.filePath);
          if (!list) {
            list = [];
            nodesByPath.set(node.filePath, list);
          }
          list.push(node);
          if (!TOP_LEVEL_EXCLUDED_KINDS.has(node.kind)) {
            defNodeIds.push(node.id);
          }
        }
      }

      const allOutgoingEdges = [];
      for (const chunk of chunkArray(defNodeIds)) {
        allOutgoingEdges.push(...graph.getOutgoingEdgesFrom(chunk, ["calls", "references", "contains"]));
      }

      const missingTargetIds = new Set<string>();
      for (const edge of allOutgoingEdges) {
        if ((edge.kind === "calls" || edge.kind === "references") && !nodeById.has(edge.target)) {
          missingTargetIds.add(edge.target);
        }
      }
      for (const chunk of chunkArray([...missingTargetIds])) {
        const fetched = graph.getNodesByIds(chunk);
        for (const [id, node] of fetched) {
          nodeById.set(id, node);
        }
      }

      const containedChildToParent = new Map<string, string>();
      for (const edge of allOutgoingEdges) {
        if (edge.kind !== "contains") continue;
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target || source.filePath !== target.filePath) continue;
        if (!TOP_LEVEL_EXCLUDED_KINDS.has(source.kind) && !TOP_LEVEL_EXCLUDED_KINDS.has(target.kind)) {
          containedChildToParent.set(target.id, source.id);
        }
      }

      const fileRootKeysByPath = new Map<string, Map<string, string>>();
      const fileTopSymbolsByPath = new Map<string, CodeGraphNode[]>();
      const intraEdgesByPath = new Map<string, Map<string, { from: string; to: string }>>();

      for (const path of queryPaths) {
        const nodes = nodesByPath.get(path) ?? [];
        const { topLevelNodes, rootKeyByNodeId } = resolveRootSymbolByNodeId(nodes, containedChildToParent);
        fileTopSymbolsByPath.set(path, topLevelNodes);
        fileRootKeysByPath.set(path, rootKeyByNodeId);
        intraEdgesByPath.set(path, new Map());
      }

      const rawCrossEdges: RepositoryCallEdgeFactV1[] = [];
      const seenCrossKeys = new Set<string>();

      for (const edge of allOutgoingEdges) {
        if (edge.kind !== "calls" && edge.kind !== "references") continue;
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) continue;
        if (WRAPPER_NODE_KINDS.has(source.kind) || WRAPPER_NODE_KINDS.has(target.kind)) continue;

        if (source.filePath === target.filePath) {
          const rootKeys = fileRootKeysByPath.get(source.filePath);
          const fromTop = rootKeys?.get(source.id);
          const toTop = rootKeys?.get(target.id);
          if (fromTop && toTop && fromTop !== toTop) {
            const left = compareText(fromTop, toTop) <= 0 ? fromTop : toTop;
            const right = left === fromTop ? toTop : fromTop;
            intraEdgesByPath.get(source.filePath)?.set(`${left}\0${right}`, { from: left, to: right });
          }
          continue;
        }

        const fromSymbol = symbolKey(source);
        const toSymbol = symbolKey(target);
        const edgeKind = edge.kind === "calls" ? "calls" : "references";
        const key = `${source.filePath}\0${target.filePath}\0${fromSymbol}\0${toSymbol}\0${edgeKind}`;
        if (!seenCrossKeys.has(key)) {
          seenCrossKeys.add(key);
          rawCrossEdges.push({
            fromPath: source.filePath,
            toPath: target.filePath,
            fromSymbol,
            toSymbol,
            kind: edgeKind
          });
        }
      }

      rawCrossEdges.sort((left, right) =>
        compareText(left.fromPath, right.fromPath) ||
        compareText(left.toPath, right.toPath) ||
        compareText(left.fromSymbol, right.fromSymbol) ||
        compareText(left.toSymbol, right.toSymbol) ||
        compareText(left.kind, right.kind)
      );

      const callEdgeLimitExceeded = rawCrossEdges.length > callEdgeLimit;
      const callEdges = callEdgeLimitExceeded ? rawCrossEdges.slice(0, callEdgeLimit) : rawCrossEdges;

      const fileStructures: FileSymbolStructureFactV1[] = queryPaths.map((path) => {
        const nodes = nodesByPath.get(path) ?? [];
        const fileNodeEndLine = nodes.find((node) => node.kind === "file")?.endLine ?? 0;
        const maxNodeEndLine = nodes.reduce((max, node) => Math.max(max, node.endLine), 0);
        const lineCount = Math.max(fileNodeEndLine, maxNodeEndLine, options.readFileLineCount?.(path) ?? 0);
        const topLevelNodes = fileTopSymbolsByPath.get(path) ?? [];
        const intraEdges = [...(intraEdgesByPath.get(path)?.values() ?? [])].sort(
          (left, right) => compareText(left.from, right.from) || compareText(left.to, right.to)
        );
        return {
          path,
          lineCount,
          topLevelSymbols: topLevelNodes.map((node) => ({
            name: node.name,
            qualifiedName: symbolKey(node),
            kind: node.kind,
            startLine: node.startLine,
            endLine: node.endLine,
            isExported: node.isExported === true
          })),
          intraFileEdges: intraEdges
        };
      });

      const reasonCodes: string[] = [];
      let coverage: EvidenceCoverageLevelV2 = "complete";
      if (callEdgeLimitExceeded) {
        coverage = "partial";
        reasonCodes.push(CAPABILITY_DEPENDENCIES_CALL_LIMIT_REASON);
      }
      if (!opened.session.unchangedSinceOpen()) {
        coverage = "partial";
        reasonCodes.push("code-facts-truncated");
      }

      return {
        coverage,
        reasonCodes: reasonCodes.sort(compareText),
        callEdges,
        callEdgeCount: callEdges.length,
        callEdgeLimit,
        callEdgeLimitExceeded,
        fileStructures,
        indexedFiles
      };
    },
    options.provider ? { provider: options.provider } : {}
  );
}

function symbolMatchesTarget(node: CodeGraphNode, symbol: string): boolean {
  if (WRAPPER_NODE_KINDS.has(node.kind)) return false;
  if (node.name === symbol || node.qualifiedName === symbol) return true;
  if (node.qualifiedName.replaceAll("::", ".") === symbol) return true;
  if (node.qualifiedName.endsWith(`::${symbol}`)) return true;
  if (node.qualifiedName.endsWith(`.${symbol}`)) return true;
  return false;
}

/**
 * 3-state fail-closed verification for `kind: "symbol"` kill-list targets (#636 P2 Invariant #1).
 * Never collapses bare/ambiguous names, unindexed files, parse errors, stale file digests, or
 * unavailable indexes to `"absent"`.
 */
export function verifySymbolKillList(
  root: string,
  targets: readonly string[],
  options: VerifySymbolKillListOptions
): SymbolKillListCheckV1[] {
  if (targets.length === 0) return [];
  if (!options.codeFactsReady) {
    return targets.map((target) => ({ target, status: "unknown", reasonCode: "code-facts-unavailable" }));
  }

  return withCodeGraphReadSession(
    root,
    (opened) => {
      if (opened.state !== "open") {
        return targets.map((target) => ({ target, status: "unknown", reasonCode: "code-facts-unavailable" }));
      }
      const graph = opened.session.graph;
      const provider = options.provider ?? pinnedCodeGraphProvider();
      const trackedByLower = new Map<string, string[]>();
      if (options.caseInsensitive && options.trackedFiles) {
        for (const trackedPath of options.trackedFiles) {
          const key = trackedPath.toLowerCase();
          const group = trackedByLower.get(key);
          if (group) group.push(trackedPath);
          else trackedByLower.set(key, [trackedPath]);
        }
      }

      return targets.map((target): SymbolKillListCheckV1 => {
        const parsed = parseRefactorKillListSymbolTarget(target);
        if (!parsed) {
          return { target, status: "unknown", reasonCode: "kill-list-symbol-ambiguous" };
        }
        const matchedTracked = options.trackedFiles === undefined
          ? []
          : options.trackedFiles.has(parsed.path)
            ? [parsed.path]
            : options.caseInsensitive
              ? (trackedByLower.get(parsed.path.toLowerCase()) ?? [])
              : [];
        const onDiskRequested = existsSync(join(root, parsed.path));
        if (options.trackedFiles !== undefined && matchedTracked.length === 0 && !onDiskRequested) {
          return { target, status: "absent" };
        }
        if (options.trackedFiles === undefined && !onDiskRequested) {
          return { target, status: "absent" };
        }

        const candidatePaths = matchedTracked.length > 0 ? matchedTracked : [parsed.path];
        let firstUnknownReason: string | undefined;
        for (const candidatePath of candidatePaths) {
          const diskPath = join(root, candidatePath);
          const onDisk = existsSync(diskPath);
          const fileRecord = graph.getFile(candidatePath);
          if (!fileRecord) {
            firstUnknownReason ??= "code-facts-file-unindexed";
            continue;
          }
          if (((fileRecord as { errors?: number }).errors ?? 0) > 0) {
            firstUnknownReason ??= "code-facts-parse-errors";
            continue;
          }
          if (onDisk) {
            let currentHash: string | undefined;
            try {
              currentHash = provider.changeHash(diskPath);
            } catch {
              currentHash = undefined;
            }
            if (currentHash === undefined || currentHash !== fileRecord.contentHash) {
              firstUnknownReason ??= "code-facts-digest-mismatch";
              continue;
            }
          }

          const nodes = graph.getNodesInFile(candidatePath);
          if (nodes.some((node) => symbolMatchesTarget(node, parsed.symbol))) {
            return { target, status: "present" };
          }
        }
        if (firstUnknownReason !== undefined) {
          return { target, status: "unknown", reasonCode: firstUnknownReason };
        }
        return { target, status: "absent" };
      });
    },
    options.provider ? { provider: options.provider } : {}
  );
}
