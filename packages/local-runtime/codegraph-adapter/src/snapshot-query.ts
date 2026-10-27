import { spawnSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { FailureError } from "@archcontext/contracts";
import type { Node, Edge, CodeGraph } from "@colbymchenry/codegraph";

type FileRecord = ReturnType<CodeGraph["getFiles"]>[number];

export interface SnapshotQueryRequest {
  names: readonly string[];
  sources: readonly { name: string; path: string }[];
  includeFiles: boolean;
}

export interface SnapshotQueryReader {
  getNodesByName(name: string): Node[];
  getNodesInFile(path: string): Node[];
  /** Only the complete calls/references population is requested by this reader. */
  getOutgoingEdges(id: string): Edge[];
  getNode(id: string): Node | null;
  getFiles(): FileRecord[];
  getProjectRoot(): string;
}

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_KEYS = 10_000;
const MAX_ITEMS = 100_000;

// A literal script survives the CLI's ordinary bundle. Only this process opens SDK DB handles;
// process termination releases retained SQLite statements before the caller removes the mirror.
const QUERY_SCRIPT = String.raw`
"use strict";
const fs = require("node:fs");
const MAX_KEYS = 10000, MAX_ITEMS = 100000, MAX_BYTES = 32 * 1024 * 1024;
let items = 0;
function account(rows) {
  items += rows.length;
  if (items > MAX_ITEMS) throw new Error("query limit");
  return rows;
}
function keys(values) {
  const result = [...new Set(values)];
  if (result.length > MAX_KEYS) throw new Error("query key limit");
  return result;
}
try {
  const request = JSON.parse(fs.readFileSync(0, "utf8"));
  const sdk = require(process.argv[1]);
  const root = process.argv[2];
  let holder, graph, result;
  try {
    holder = sdk.CodeGraph.openSync(root);
    graph = sdk.CodeGraph.openSync(root, { readOnly: true });
    const names = request.names.map(name => [name, account(graph.getNodesByName(name))]);
    const byFile = new Map();
    function file(path) {
      if (!byFile.has(path)) {
        if (byFile.size >= MAX_KEYS) throw new Error("query key limit");
        byFile.set(path, account(graph.getNodesInFile(path)));
      }
      return byFile.get(path);
    }
    const sources = new Map();
    for (const selector of request.sources) {
      for (const node of file(selector.path)) {
        if (node.name === selector.name) sources.set(node.id, node);
      }
    }
    const ids = keys([...sources.keys()]);
    // Built-in correction queries the provider's own source.filePath, not the request spelling.
    for (const source of sources.values()) file(source.filePath);
    const outgoing = new Map(ids.map(id => [id, []]));
    const edges = account(ids.length ? graph.getOutgoingEdgesFrom(ids, ["calls", "references"]) : []);
    for (const edge of edges) {
      if (!outgoing.has(edge.source)) throw new Error("unexpected source");
      outgoing.get(edge.source).push(edge);
    }
    const targets = keys(edges.map(edge => edge.target));
    const nodes = targets.length ? graph.getNodesByIds(targets) : new Map();
    const targetRows = account(targets.map(id => [id, nodes.get(id) ?? null]));
    result = {
      version: 1, root: graph.getProjectRoot(), names,
      filesByPath: [...byFile], outgoing: [...outgoing], targets: targetRows,
      files: request.includeFiles ? account(graph.getFiles()) : null
    };
  } finally {
    try { if (graph) graph.close(); } finally { if (holder) holder.close(); }
  }
  const output = JSON.stringify(result);
  if (Buffer.byteLength(output) > MAX_BYTES) throw new Error("query byte limit");
  fs.writeFileSync(1, output);
} catch {
  // No source text, SDK diagnostics or partial result crosses the failure boundary.
  process.exitCode = 1;
}
`;

function unavailable(): never {
  throw new FailureError("AC_CODE_FACTS_UNAVAILABLE", "code-facts-unavailable");
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function node(value: unknown): value is Node {
  return record(value)
    && ["id", "kind", "name", "qualifiedName", "filePath", "language"].every(key => typeof value[key] === "string")
    && text(value.id)
    && ["startLine", "endLine", "startColumn", "endColumn", "updatedAt"].every(key => typeof value[key] === "number" && Number.isFinite(value[key]));
}

function edge(value: unknown): value is Edge {
  return record(value) && text(value.source) && text(value.target)
    && (value.kind === "calls" || value.kind === "references")
    && (value.line === undefined || (typeof value.line === "number" && Number.isFinite(value.line)))
    && (value.column === undefined || (typeof value.column === "number" && Number.isFinite(value.column)))
    && (value.metadata === undefined || record(value.metadata));
}

function fileRecord(value: unknown): value is FileRecord {
  return record(value) && text(value.path) && typeof value.contentHash === "string" && typeof value.language === "string"
    && ["size", "modifiedAt", "indexedAt", "nodeCount"].every(key => typeof value[key] === "number" && Number.isFinite(value[key]))
    && (value.errors === undefined || Array.isArray(value.errors));
}

function requested<T>(table: Map<string, T>, key: string): T {
  if (!table.has(key)) return unavailable();
  return table.get(key)!;
}

function sameKeys<T>(table: Map<string, T>, expected: Iterable<string>): void {
  const keys = new Set(expected);
  if (keys.size !== table.size || [...keys].some(key => !table.has(key))) unavailable();
}

function normalizedRequest(request: SnapshotQueryRequest): SnapshotQueryRequest {
  if (!record(request) || !Array.isArray(request.names) || !Array.isArray(request.sources)
    || typeof request.includeFiles !== "boolean" || request.names.length > MAX_KEYS || request.sources.length > MAX_KEYS
    || !request.names.every(text)
    || !request.sources.every(source => record(source) && text(source.name) && text(source.path))) unavailable();
  const names = [...new Set(request.names)];
  const requestedNames = new Set(names);
  const sources = [...new Map(request.sources.map(source => [JSON.stringify([source.name, source.path]), { name: source.name, path: source.path }])).values()];
  if (sources.some(source => !requestedNames.has(source.name))) unavailable();
  return { names, sources, includeFiles: request.includeFiles };
}

function decodeReader(output: string, root: string, request: SnapshotQueryRequest): SnapshotQueryReader {
  const wire: unknown = JSON.parse(output);
  if (!record(wire) || wire.version !== 1 || !text(wire.root) || !isAbsolute(wire.root) || resolve(wire.root) !== resolve(root)) unavailable();
  let items = 0;
  const rows = <T>(value: unknown, valid: (item: unknown) => item is T): T[] => {
    if (!Array.isArray(value) || (items += value.length) > MAX_ITEMS || !value.every(valid)) return unavailable();
    return value;
  };
  const table = <T>(value: unknown, decode: (value: unknown) => T): Map<string, T> => {
    if (!Array.isArray(value) || value.length > MAX_KEYS) return unavailable();
    const result = new Map<string, T>();
    for (const row of value) {
      if (!Array.isArray(row) || row.length !== 2 || !text(row[0]) || result.has(row[0])) unavailable();
      result.set(row[0], decode(row[1]));
    }
    return result;
  };
  const names = table(wire.names, value => rows(value, node));
  sameKeys(names, request.names);
  for (const [name, nodes] of names) if (nodes.some(item => item.name !== name)) unavailable();
  const filesByPath = table(wire.filesByPath, value => rows(value, node));
  const sources = new Map<string, Node>();
  const sourcePaths = new Set(request.sources.map(source => source.path));
  for (const source of request.sources) {
    for (const item of requested(filesByPath, source.path)) {
      if (item.name !== source.name) continue;
      if (!requested(names, source.name).some(named => named.id === item.id)) unavailable();
      sources.set(item.id, item);
      sourcePaths.add(item.filePath);
    }
  }
  sameKeys(filesByPath, sourcePaths);
  const outgoing = table(wire.outgoing, value => rows(value, edge));
  sameKeys(outgoing, sources.keys());
  const targetIds = new Set<string>();
  for (const [id, edges] of outgoing) for (const item of edges) {
    if (item.source !== id) unavailable();
    targetIds.add(item.target);
  }
  const targets = table(wire.targets, value => {
    if (++items > MAX_ITEMS || (value !== null && !node(value))) return unavailable();
    return value as Node | null;
  });
  sameKeys(targets, targetIds);
  for (const [id, item] of targets) if (item !== null && item.id !== id) unavailable();
  const files = request.includeFiles ? rows(wire.files, fileRecord) : null;
  if (!request.includeFiles && wire.files !== null) unavailable();
  if (files && new Set(files.map(file => file.path)).size !== files.length) unavailable();
  const projectRoot = wire.root;
  return {
    getNodesByName: name => requested(names, name),
    getNodesInFile: path => requested(filesByPath, path),
    getOutgoingEdges: id => requested(outgoing, id),
    getNode: id => requested(targets, id),
    getFiles: () => files ?? unavailable(),
    getProjectRoot: () => projectRoot
  };
}

/** The caller resolves the pinned provider runtime and owns removal of the private snapshot. */
export function readSnapshotQueries(
  runtime: { node: string; sdk: string }, root: string, request: SnapshotQueryRequest
): SnapshotQueryReader {
  try {
    if (!isAbsolute(runtime.node) || !isAbsolute(runtime.sdk) || !isAbsolute(root)) unavailable();
    const normalized = normalizedRequest(request);
    const input = JSON.stringify(normalized);
    if (Buffer.byteLength(input) > MAX_REQUEST_BYTES) unavailable();
    const env: NodeJS.ProcessEnv = { ...process.env, DO_NOT_TRACK: "1", CODEGRAPH_NO_DOWNLOAD: "1" };
    // A host's injected Node preload/options must not change the pinned query process.
    delete env.NODE_OPTIONS;
    const child = spawnSync(runtime.node, ["--input-type=commonjs", "-e", QUERY_SCRIPT, runtime.sdk, root], {
      cwd: root, input, encoding: "utf8", env, windowsHide: true,
      timeout: 30_000, killSignal: "SIGKILL", maxBuffer: MAX_OUTPUT_BYTES,
      stdio: ["pipe", "pipe", "pipe"]
    });
    if (child.error || child.signal || child.status !== 0 || Buffer.byteLength(child.stdout) > MAX_OUTPUT_BYTES) unavailable();
    return decodeReader(child.stdout, root, normalized);
  } catch {
    return unavailable();
  }
}
