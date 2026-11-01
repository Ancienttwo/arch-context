import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ARCHITECTURE_HISTORY_DERIVATION_VERSION, ARCHITECTURE_HISTORY_SCHEMA_VERSION, FailureError, NativeContextError, decodeArchitectureHistoryState, nativeByteCompare, validateJsonSchema, type ArchitectureHistory, type HistoryDelta, type HistoryEdge, type HistoryMilestone, type HistoryState, type HistoryStructureNode, type Json } from "@archcontext/contracts";
import { parseJsonOrStableYaml } from "@archcontext/core/architecture-domain";
import { runtimeStatePaths } from "@archcontext/local-runtime/runtime-state-paths";
import { decodeUtf8, readGitBlobTree, readGitBlobs, readNativeGitRoot, readOnlyGit, resolveNativeGitSnapshot, type GitBlobTreeEntry } from "../../git-adapter/src/blob-reader";
import nodeSchema from "../../../../schemas/repo/architecture-node.schema.json";
import relationSchema from "../../../../schemas/repo/architecture-relation.schema.json";

const compare = nativeByteCompare;
const modelRoot = ".archcontext/model";
type RecordNode = { id: string; kind: string; name: string; parent?: string };
type RecordRelation = { source: string; target: string };
const failed = (code: "history-model-layout-unsupported" | "history-model-missing" | "history-model-invalid" | "history-model-too-large", path?: string): HistoryState => ({ nodes: null, edges: null, structure: null, error: { code, ...(path ? { path } : {}) } });
const edgeKey = (e: HistoryEdge) => JSON.stringify([e.source, e.target]);

function stateForRevision(root: string, rev: string, parsed: Map<string, unknown>): HistoryState {
  try {
    let context: GitBlobTreeEntry[];
    try { context = readGitBlobTree(root, `${rev}:.archcontext`, { sizes: false }); }
    catch (error) {
      if (!(error instanceof NativeContextError) || error.reasonCode !== "native-context-git-read-failed") throw error;
      if (readGitBlobTree(root, rev, { sizes: false }).some(entry => entry.path === ".archcontext" && entry.type === "tree")) throw error;
      return failed("history-model-missing");
    }
    const manifest = context.find(entry => entry.path === "manifest.yaml");
    if (manifest && manifest.type !== "blob") return failed("history-model-layout-unsupported");
    const read = (entry: GitBlobTreeEntry): unknown => {
      if (!parsed.has(entry.objectId)) {
        const body = readGitBlobs(root, [entry])[0]!;
        try { parsed.set(entry.objectId, { value: parseJsonOrStableYaml(decodeUtf8(body), entry.path) }); }
        catch { parsed.set(entry.objectId, { invalid: true }); }
      }
      return parsed.get(entry.objectId);
    };
    if (manifest) {
      const data = read(manifest) as { value?: { schemaVersion?: unknown; model?: { layout?: unknown; root?: unknown } } };
      if (data.value?.schemaVersion !== "archcontext.manifest/v1" || data.value.model?.layout !== "split" || data.value.model.root !== modelRoot) return failed("history-model-layout-unsupported");
    }
    if (!context.some(entry => entry.path === "model" && entry.type === "tree")) return failed("history-model-missing");
    const all = readGitBlobTree(root, `${rev}:${modelRoot}`, { sizes: false }).map(entry => ({ ...entry, path: `${modelRoot}/${entry.path}` }));
    const nodesDir = all.find(entry => entry.path === `${modelRoot}/nodes` && entry.type === "tree");
    if (!nodesDir) return failed("history-model-missing");
    const files = all.filter(entry => entry.type === "blob" && (entry.path.startsWith(`${modelRoot}/nodes/`) || entry.path.startsWith(`${modelRoot}/relations/`)) && /\.ya?ml$/.test(entry.path)).sort((a, b) => compare(a.path, b.path));
    const missing = [...new Map(files.filter(file => !parsed.has(file.objectId)).map(file => [file.objectId, file])).values()];
    const blobs = readGitBlobs(root, missing);
    missing.forEach((file, index) => {
      try { parsed.set(file.objectId, { value: parseJsonOrStableYaml(decodeUtf8(blobs[index]!), file.path) }); }
      catch { parsed.set(file.objectId, { invalid: true }); }
    });
    const nodes: RecordNode[] = [], relations: RecordRelation[] = [];
    const paths = new Map<string, string>();
    for (const file of files) {
      const result = read(file) as { value?: Json; invalid?: boolean };
      const isNode = file.path.startsWith(`${modelRoot}/nodes/`);
      if (result.invalid || result.value === undefined || !validateJsonSchema(isNode ? nodeSchema : relationSchema, result.value).valid) return failed("history-model-invalid", file.path);
      if (isNode) {
        const value = result.value as unknown as RecordNode;
        if (paths.has(value.id)) return failed("history-model-invalid", file.path);
        paths.set(value.id, file.path); nodes.push(value);
      } else relations.push(result.value as unknown as RecordRelation);
    }
    const byId = new Map(nodes.map(node => [node.id, node]));
    for (const node of nodes) {
      const visited = new Set<string>(); let cursor: RecordNode | undefined = node;
      while (cursor) {
        if (visited.has(cursor.id)) return failed("history-model-invalid", paths.get(node.id));
        visited.add(cursor.id); cursor = cursor.parent ? byId.get(cursor.parent) : undefined;
      }
    }
    const nearest = (id: string): string | undefined => {
      let node = byId.get(id);
      while (node) { if (node.kind === "capability") return node.id; node = node.parent ? byId.get(node.parent) : undefined; }
      return undefined;
    };
    const edges = new Map<string, HistoryEdge>();
    for (const relation of relations) {
      const source = nearest(relation.source), target = nearest(relation.target);
      if (source && target && source !== target) { const edge = { source, target }; edges.set(edgeKey(edge), edge); }
    }
    return {
      nodes: nodes.filter(node => node.kind === "capability").map(node => ({ id: node.id, name: node.name, domain: /^capability\.([a-z0-9]+(?:-[a-z0-9]+)*)\.([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(node.id)?.[1] ?? null })).sort((a, b) => compare(a.id, b.id)),
      edges: [...edges.values()].sort((a, b) => compare(a.source, b.source) || compare(a.target, b.target)),
      structure: nodes.filter(node => ["capability", "module", "component"].includes(node.kind)).map(node => ({ id: node.id, kind: node.kind as HistoryStructureNode["kind"], name: node.name, capability: nearest(node.id) ?? null })).sort((a, b) => compare(a.id, b.id))
    };
  } catch (error) {
    if (error instanceof NativeContextError && error.reasonCode === "native-context-limit-exceeded") return failed("history-model-too-large");
    throw error;
  }
}

function difference(before: HistoryState & { structure: HistoryStructureNode[]; edges: HistoryEdge[] }, after: HistoryState & { structure: HistoryStructureNode[]; edges: HistoryEdge[] }, baseRev: string | null): HistoryDelta {
  const a = new Map(before.structure.map(node => [node.id, node])), b = new Map(after.structure.map(node => [node.id, node]));
  const ae = new Map(before.edges.map(edge => [edgeKey(edge), edge])), be = new Map(after.edges.map(edge => [edgeKey(edge), edge]));
  return {
    baseRev,
    added: after.structure.filter(node => !a.has(node.id)).map(({ id, kind, capability }) => ({ id, kind, capability })),
    removed: before.structure.filter(node => !b.has(node.id)).map(({ id, kind, capability }) => ({ id, kind, capability })),
    renamed: after.structure.flatMap(node => { const old = a.get(node.id); return old && old.name !== node.name ? [{ id: node.id, kind: node.kind, capability: node.capability, from: old.name, to: node.name }] : []; }),
    edgesChanged: { added: after.edges.filter(edge => !ae.has(edgeKey(edge))), removed: before.edges.filter(edge => !be.has(edgeKey(edge))) }
  };
}

export function readArchitectureHistory(cwd: string, options: { ref?: string; offset?: number; limit?: number; env?: Record<string, string | undefined> } = {}): ArchitectureHistory {
  const root = readNativeGitRoot(cwd);
  if (decodeUtf8(readOnlyGit(root, "rev-parse", ["--is-shallow-repository"])).trim() === "true") throw new FailureError("AC_PRECONDITION_FAILED", "history-shallow-repository");
  const head = resolveNativeGitSnapshot(root, options.ref ?? "HEAD").commitSha;
  const output = decodeUtf8(readOnlyGit(root, "log", ["--first-parent", "--reverse", "-z", "--format=%H%x00%cI%x00%s", head, "--", modelRoot, ".archcontext/manifest.yaml"]));
  const fields = output ? output.split("\0") : [];
  if (fields.length && fields.pop() !== "") throw new NativeContextError("native-context-git-read-failed", { operation: "log", category: "malformed-record" });
  if (fields.length % 3 !== 0) throw new NativeContextError("native-context-git-read-failed", { operation: "log", category: "malformed-record" });
  for (let i = 0; i < fields.length; i += 3) if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(fields[i]!)) throw new NativeContextError("native-context-git-read-failed", { operation: "log", category: "malformed-record" });
  const parsed = new Map<string, unknown>(); const milestones: HistoryMilestone[] = [];
  let previous: Extract<HistoryState, { nodes: unknown[] }> = { nodes: [], edges: [], structure: [] };
  let havePrevious = false, priorError: string | undefined, previousMilestone: string | null = null;
  const cacheDir = join(runtimeStatePaths(root, options.env).sharedCacheDir, "architecture-history", ARCHITECTURE_HISTORY_DERIVATION_VERSION);
  for (let i = 0; i < fields.length; i += 3) {
    const [rev, date, subject] = fields.slice(i, i + 3) as [string, string, string];
    const cache = join(cacheDir, `${rev}.json`);
    let state: HistoryState | undefined;
    try { state = decodeArchitectureHistoryState(JSON.parse(readFileSync(cache, "utf8"))); } catch { /* derive absent or invalid cache */ }
    if (!state) {
      state = stateForRevision(root, rev, parsed);
      mkdirSync(cacheDir, { recursive: true });
      const temporary = `${cache}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify(state)); renameSync(temporary, cache);
    }
    if (state.error) {
      if (priorError !== state.error.code) milestones.push({ rev, date, subject, nodes: null, edges: null, delta: null, error: state.error });
      priorError = state.error.code; continue;
    }
    const recovered = priorError !== undefined;
    priorError = undefined;
    const delta = difference(previous, state, previousMilestone);
    if (!havePrevious || recovered || delta.added.length || delta.removed.length || delta.renamed.length || delta.edgesChanged.added.length || delta.edgesChanged.removed.length) {
      milestones.push({ rev, date, subject, nodes: state.nodes, edges: state.edges, delta });
      previousMilestone = rev;
      previous = state; havePrevious = true;
    }
  }
  const offset = options.offset ?? 0, limit = options.limit ?? 200;
  return { schemaVersion: ARCHITECTURE_HISTORY_SCHEMA_VERSION, head, total: milestones.length, offset, limit, milestones: milestones.slice(offset, offset + limit) };
}
