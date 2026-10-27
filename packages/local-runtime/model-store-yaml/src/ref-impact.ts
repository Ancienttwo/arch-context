import { canonicalize, isRepoRelativePosixPath, nativeByteCompare, NativeContextError, type Json, type NativeContextModel, type NativeContextSnapshot, type NativeModelRecord, type RefImpactV1 } from "@archcontext/contracts";
import { resolveArchitectureOwnersForPaths, type NativeNode, type ResolveArchitectureOwnerResult } from "@archcontext/core/projection-engine";
import { decodeUtf8, readGitBlobTree, readGitBlobs, readNativeGitRoot, resolveNativeGitSnapshot, type GitBlobTreeEntry } from "../../git-adapter/src/blob-reader";
import { exportNativeContext } from "./native-context";
import { readRefImpactFacts } from "../../codegraph-adapter/src/ref-impact-facts";

import { REF_IMPACT_LIMITS as IMPACT_LIMITS } from "@archcontext/contracts";
export { IMPACT_LIMITS };
export interface ImpactHunk { baseStart: number; baseCount: number; headStart: number; headCount: number }
export interface ImpactChange { path: string; added: number | null; deleted: number | null; hunks: ImpactHunk[]; reasonCode?: "binary-diff" | "paths-only" | "diff-limit-exceeded" | "non-blob-entry" }
interface Selector { entrypointId: string; sourceSymbol: string; sinkId: string }
/** Adapter boundary: evidence must be captured for these exact immutable objects, never the live index. */
export interface RefImpactFacts {
  commitSha: string;
  treeOid: string;
  selectors: Array<Selector & ({ status: "resolved"; ranges: Array<{ path: string; startLine: number; endLine: number }> } | { status: "unresolved" | "unknown" })>;
}
interface ModelSnapshot { model: NativeContextModel; snapshot: NativeContextSnapshot }
const order = nativeByteCompare;
const unique = (values: string[]) => [...new Set(values)].sort(order);
const key = (selector: Selector) => JSON.stringify([selector.entrypointId, selector.sourceSymbol, selector.sinkId]);
const invalid = (category: string): never => { throw new NativeContextError("native-context-arguments-invalid", { category }); };

/** Minimal insert/delete distance, independent of Git attributes, external drivers and worktree state. */
export function countImpactLines(before: Buffer, after: Buffer, budget: { remaining: number } = { remaining: IMPACT_LIMITS.diffWork }): Pick<ImpactChange, "added" | "deleted" | "reasonCode"> {
  const { hunks: _, ...counts } = diffImpactLines(before, after, budget);
  return counts;
}

/** Myers edit script over raw line tokens; trace storage and work share the advertised budget. */
export function diffImpactLines(before: Buffer, after: Buffer, budget: { remaining: number } = { remaining: IMPACT_LIMITS.diffWork }): Omit<ImpactChange, "path"> {
  if (before.subarray(0, 8000).includes(0) || after.subarray(0, 8000).includes(0)) return { added: null, deleted: null, hunks: [], reasonCode: "binary-diff" };
  if (before.equals(after)) return { added: 0, deleted: 0, hunks: [] };
  const lines = (bytes: Buffer): string[] | undefined => {
    let count = bytes.length ? 1 : 0;
    for (let index = 0; index < bytes.length; index++) if (bytes[index] === 10 && index < bytes.length - 1 && ++count > IMPACT_LIMITS.diffLines) return undefined;
    if (!bytes.length) return [];
    // Preserve final-newline differences in the line token itself.
    return bytes.toString("latin1").match(/[^\n]*\n|[^\n]+$/g) ?? [];
  };
  const a = lines(before), b = lines(after);
  const limited = () => ({ added: null, deleted: null, hunks: [], reasonCode: "diff-limit-exceeded" as const });
  if (!a || !b) return limited();
  if (!a.length || !b.length) return { added: b.length, deleted: a.length, hunks: [{ baseStart: a.length ? 1 : 0, baseCount: a.length, headStart: b.length ? 1 : 0, headCount: b.length }] };
  const trace: Int32Array[] = [];
  const at = (d: number, k: number) => d < 0 ? (k === 1 ? 0 : -1) : trace[d]![k + d] ?? -1;
  for (let distance = 0; distance <= a.length + b.length; distance++) {
    // Charge every allocated cell as well as comparisons: at most diffWork Int32 cells.
    budget.remaining -= 2 * distance + 1;
    if (budget.remaining < 0) return limited();
    const frontier = new Int32Array(2 * distance + 1).fill(-1);
    trace.push(frontier);
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      if (--budget.remaining < 0) return limited();
      const down = at(distance - 1, diagonal + 1), right = at(distance - 1, diagonal - 1);
      let x = diagonal === -distance || (diagonal !== distance && right < down) ? down : right + 1;
      let y = x - diagonal;
      while (x < a.length && y < b.length && a[x] === b[y]) {
        if (--budget.remaining < 0) return limited();
        x++; y++;
      }
      frontier[diagonal + distance] = x;
      if (x >= a.length && y >= b.length) {
        const edits: Array<{ x: number; y: number; insertion: boolean }> = [];
        for (let d = distance; d > 0; d--) {
          const k = x - y;
          const insertion = k === -d || (k !== d && at(d - 1, k - 1) < at(d - 1, k + 1));
          const px = at(d - 1, k + (insertion ? 1 : -1));
          const py = px - k - (insertion ? 1 : -1);
          edits.push({ x: px, y: py, insertion });
          x = px; y = py;
        }
        const hunks: ImpactHunk[] = [];
        let previous: { x: number; y: number } | undefined;
        for (const edit of edits.reverse()) {
          let hunk = hunks.at(-1);
          if (!hunk || !previous || previous.x !== edit.x || previous.y !== edit.y) {
            hunk = { baseStart: edit.x + 1, baseCount: 0, headStart: edit.y + 1, headCount: 0 };
            hunks.push(hunk);
          }
          if (edit.insertion) hunk.headCount++; else hunk.baseCount++;
          previous = { x: edit.x + (edit.insertion ? 0 : 1), y: edit.y + (edit.insertion ? 1 : 0) };
        }
        for (const hunk of hunks) {
          if (!hunk.baseCount) hunk.baseStart--;
          if (!hunk.headCount) hunk.headStart--;
        }
        return { added: (distance + b.length - a.length) / 2, deleted: (distance + a.length - b.length) / 2, hunks };
      }
    }
  }
  return limited();
}

export function parseImpactNumstat(bytes: Buffer): ImpactChange[] {
  if (bytes.length && bytes[bytes.length - 1] !== 0) throw new NativeContextError("native-context-git-read-failed", { operation: "diff", category: "missing-terminator" });
  const rows = decodeUtf8(bytes).split("\0").filter(Boolean).map(row => {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(row);
    if (!match || !isRepoRelativePosixPath(match[3]!)) throw new NativeContextError("native-context-path-unsafe", { category: "diff-path" });
    const binary = match[1] === "-" || match[2] === "-";
    const added = binary ? null : Number(match[1]);
    const deleted = binary ? null : Number(match[2]);
    if ((!binary && (!Number.isSafeInteger(added) || !Number.isSafeInteger(deleted)))) invalid("diff-count");
    return { path: match[3]!, added, deleted, hunks: [], ...(binary ? { reasonCode: "binary-diff" as const } : {}) };
  });
  if (new Set(rows.map(row => row.path)).size !== rows.length) invalid("duplicate-diff-path");
  return rows.sort((a, b) => order(a.path, b.path));
}
export function parseImpactHunks(bytes: Buffer): ImpactHunk[] {
  // Patch contents may be non-UTF8 even when Git treats the blob as text. Only ASCII headers matter.
  return [...bytes.toString("latin1").matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map(match => ({
    baseStart: Number(match[1]), baseCount: Number(match[2] ?? 1), headStart: Number(match[3]), headCount: Number(match[4] ?? 1)
  }));
}
function owners(result: ResolveArchitectureOwnerResult): string[] {
  return result.status === "matched" ? [result.node.id] : result.status === "ambiguous" ? unique(result.candidates.map(node => node.id)) : [];
}
function delta(base: NativeContextModel | undefined, head: NativeContextModel): RefImpactV1["modelDelta"] {
  if (!base) return { status: "unknown" as const, reasonCode: "paths-only", changes: null, truncated: false };
  const changes: Array<{ kind: string; id: string; change: "added" | "removed" | "changed"; fields: string[] }> = [];
  for (const kind of ["nodes", "relations", "flows"] as const) {
    const before = new Map(base[kind].map(row => [row.id as string, row]));
    const after = new Map(head[kind].map(row => [row.id as string, row]));
    for (const id of unique([...before.keys(), ...after.keys()])) {
      const a = before.get(id), b = after.get(id);
      const fields = unique([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]).filter(field => canonicalize(a?.[field] ?? null) !== canonicalize(b?.[field] ?? null) || (a && field in a) !== (b && field in b));
      if (fields.length) changes.push({ kind, id, change: !a ? "added" : !b ? "removed" : "changed", fields });
    }
  }
  return { status: "known" as const, changes: changes.slice(0, IMPACT_LIMITS.modelChanges), truncated: changes.length > IMPACT_LIMITS.modelChanges };
}
function flowSteps(flows: NativeModelRecord[]) {
  return flows.flatMap(flow => {
    const outcomes = (flow.outcomes ?? []) as unknown as Array<{ id: string; steps: Array<{ id: string; evidence: Selector }> }>;
    return [...((flow.steps ?? []) as unknown as Array<{ id: string; evidence: Selector }>).map(step => ({ flowId: flow.id as string, outcomeId: null as string | null, ...step })), ...outcomes.flatMap(outcome => outcome.steps.map(step => ({ flowId: flow.id as string, outcomeId: outcome.id as string | null, ...step })))];
  }).sort((a, b) => order(a.flowId, b.flowId) || order(a.outcomeId ?? "", b.outcomeId ?? "") || order(a.id, b.id));
}
function selectorKnown(value: RefImpactFacts["selectors"][number] | undefined): boolean {
  return !!value && value.status !== "unknown" && (value.status !== "resolved" || (value.ranges.length > 0 && value.ranges.every(range => isRepoRelativePosixPath(range.path) && Number.isSafeInteger(range.startLine) && Number.isSafeInteger(range.endLine) && range.startLine >= 1 && range.endLine >= range.startLine)));
}
function matchingFacts(snapshot: NativeContextSnapshot, facts?: RefImpactFacts): RefImpactFacts | undefined {
  return snapshot.source === "ref" && facts?.commitSha === snapshot.commitSha && facts?.treeOid === snapshot.treeOid ? facts : undefined;
}

/** Pure analysis; callers supply already validated models and immutable-ref facts, if available. */
export function computeRefImpact(input: { base?: ModelSnapshot; head: ModelSnapshot; changes: ImpactChange[]; depth?: number; headFacts?: RefImpactFacts; baseFacts?: RefImpactFacts }): RefImpactV1 {
  const depth = input.depth ?? 1;
  if (!Number.isSafeInteger(depth) || depth < 0 || depth > IMPACT_LIMITS.depth) invalid("impact-depth-must-be-0-to-10");
  const allChanges = [...input.changes].sort((a, b) => order(a.path, b.path));
  const changes = allChanges.slice(0, IMPACT_LIMITS.changedPaths);
  const baseOwners = resolveArchitectureOwnersForPaths((input.base?.model.nodes ?? []) as unknown as NativeNode[], changes.map(row => row.path));
  const headOwners = resolveArchitectureOwnersForPaths(input.head.model.nodes as unknown as NativeNode[], changes.map(row => row.path));
  const changedPaths = changes.map((change, index) => {
    const before = owners(baseOwners[index]!); const after = owners(headOwners[index]!);
    const reasonCodes = unique([...(baseOwners[index]!.status === "ambiguous" || headOwners[index]!.status === "ambiguous" ? ["ambiguous-owner"] : []), ...(change.reasonCode ? [change.reasonCode] : [])]);
    return { path: change.path, added: change.added, deleted: change.deleted, baseOwners: before, headOwners: after, owners: unique([...before, ...after]), reasonCodes };
  });
  const counts = new Map<string, number>();
  for (const row of changedPaths) for (const id of row.owners) counts.set(id, (counts.get(id) ?? 0) + 1);
  const touchedNodes = [...counts].sort(([a], [b]) => order(a, b)).map(([nodeId, pathCount]) => ({ nodeId, pathCount }));
  const allRelations = input.head.model.relations.filter(row => row.kind === "calls" || row.kind === "depends-on").sort((a, b) => order(a.id as string, b.id as string));
  const relations = allRelations.slice(0, IMPACT_LIMITS.relations);
  const incoming = new Map<string, NativeModelRecord[]>();
  for (const row of relations) incoming.set(row.target as string, [...incoming.get(row.target as string) ?? [], row]);
  const dependents: Array<{ nodeId: string; touchedNodeId: string; relationIds: string[] }> = [];
  let dependentTruncated = false;
  // One shortest path per (dependent, touched node), lexicographic relation order breaks ties.
  outer: for (const target of unique([...counts.keys()])) {
    const seen = new Set([target]);
    const queue = [{ id: target, relationIds: [] as string[] }];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor]!;
      if (current.relationIds.length >= depth) continue;
      for (const relation of incoming.get(current.id) ?? []) {
        const id = relation.source as string;
        if (seen.has(id)) continue;
        seen.add(id);
        const relationIds = [relation.id as string, ...current.relationIds];
        if (dependents.length >= IMPACT_LIMITS.dependents) { dependentTruncated = true; break outer; }
        dependents.push({ nodeId: id, touchedNodeId: target, relationIds }); queue.push({ id, relationIds });
      }
    }
  }
  dependents.sort((a, b) => order(a.nodeId, b.nodeId) || order(a.touchedNodeId, b.touchedNodeId));
  const headFacts = matchingFacts(input.head.snapshot, input.headFacts);
  const baseFacts = input.base && matchingFacts(input.base.snapshot, input.baseFacts);
  const steps = flowSteps(input.head.model.flows);
  const touched: Array<{ flowId: string; stepId: string; outcomeId: string | null; reasonCodes: string[] }> = [];
  let unresolvedCoverage = false;
  if (headFacts) for (const step of steps.slice(0, IMPACT_LIMITS.flowSteps)) {
    const found = headFacts.selectors.filter(row => key(row) === key(step.evidence));
    const current = found.length === 1 ? found[0] : undefined;
    if (!current || !selectorKnown(current)) {
      unresolvedCoverage = true;
      touched.push({ flowId: step.flowId, stepId: step.id, outcomeId: step.outcomeId, reasonCodes: ["selector-evidence-unavailable"] });
      continue;
    }
    const reasons: string[] = [];
    if (current.status === "unresolved") reasons.push("selector-unresolved-at-head");
    if (current.status === "resolved" && current.ranges.some(range => changes.some(change => change.path === range.path && change.hunks.some(hunk => hunk.headCount > 0 && hunk.headStart <= range.endLine && hunk.headStart + hunk.headCount - 1 >= range.startLine)))) reasons.push("head-lines-changed");
    const old = baseFacts?.selectors.filter(row => key(row) === key(step.evidence));
    if (baseFacts && changes.some(row => (row.deleted ?? 0) > 0) && (old?.length !== 1 || !selectorKnown(old[0]))) unresolvedCoverage = true;
    if (old?.length === 1 && selectorKnown(old[0]) && old[0]!.status === "resolved" && old[0]!.ranges.some(range => changes.some(change => change.path === range.path && change.hunks.some(hunk => hunk.baseCount > 0 && hunk.baseStart <= range.endLine && hunk.baseStart + hunk.baseCount - 1 >= range.startLine)))) reasons.push("base-lines-deleted");
    if (reasons.length) touched.push({ flowId: step.flowId, stepId: step.id, outcomeId: step.outcomeId, reasonCodes: reasons });
  }
  const coverageReasons = unique([
    ...(!headFacts ? ["ref-code-facts-unavailable"] : []),
    ...(headFacts && input.base && !baseFacts && changes.some(row => (row.deleted ?? 0) > 0) ? ["base-code-facts-unavailable"] : []),
    ...(unresolvedCoverage ? ["selector-evidence-unavailable"] : []),
    ...(changes.some(row => row.reasonCode || ((row.added ?? 0) + (row.deleted ?? 0) > 0 && row.hunks.length === 0)) ? ["line-impact-unavailable"] : []),
    ...(steps.length > IMPACT_LIMITS.flowSteps || changes.length < allChanges.length ? ["impact-truncated"] : [])
  ]);
  const modelDelta = delta(input.base?.model, input.head.model);
  return {
    schemaVersion: "archcontext.ref-impact/v1", base: input.base?.snapshot ?? null, head: input.head.snapshot, depth,
    changedPaths, unownedPaths: changedPaths.filter(row => row.owners.length === 0).map(row => row.path),
    touchedNodes: touchedNodes.slice(0, IMPACT_LIMITS.nodes),
    touchedFlowSteps: { status: coverageReasons.length ? "unknown" : "known", reasonCodes: coverageReasons, items: headFacts ? touched : null },
    dependents, dependencyCoverage: { status: allRelations.length > relations.length || dependentTruncated || changes.length < allChanges.length ? "partial" : "complete", graph: "head", pathSelection: "one-shortest-path-per-node-pair" },
    modelDelta, limits: IMPACT_LIMITS,
    truncated: { changedPaths: changes.length < allChanges.length, touchedNodes: touchedNodes.length > IMPACT_LIMITS.nodes, relations: allRelations.length > relations.length, flowSteps: steps.length > IMPACT_LIMITS.flowSteps, dependents: dependentTruncated, modelDelta: modelDelta.truncated }
  };
}

export type RefImpactOptions = { base: string; head: string; depth?: number } | { paths: string[]; depth?: number };
/** Read-only object reader: no checkout, index refresh, daemon, provider process or network. */
export function readRefImpact(start: string, options: RefImpactOptions) {
  if ("paths" in options) {
    const paths = unique(options.paths);
    if (paths.some(path => !isRepoRelativePosixPath(path))) invalid("impact-path-invalid");
    const head = exportNativeContext(start, { source: "worktree" });
    return computeRefImpact({ head, changes: paths.map(path => ({ path, added: null, deleted: null, hunks: [], reasonCode: "paths-only" })), depth: options.depth });
  }
  const root = readNativeGitRoot(start);
  const baseRef = resolveNativeGitSnapshot(root, options.base), headRef = resolveNativeGitSnapshot(root, options.head);
  const base = exportNativeContext(root, { source: "ref", ref: baseRef.commitSha });
  const head = exportNativeContext(root, { source: "ref", ref: headRef.commitSha });
  const trees = [baseRef.treeOid, headRef.treeOid].map(treeOid => {
    const entries = readGitBlobTree(root, treeOid, { sizes: false, trees: false });
    if (entries.some(entry => !entry.utf8Valid)) throw new NativeContextError("native-context-path-unsafe", { category: "impact-tree-path-encoding" });
    return new Map(entries.map(entry => [entry.path, entry]));
  });
  const [before, after] = trees;
  const paths = unique([...before!.keys(), ...after!.keys()]).filter(path => before!.get(path)?.objectId !== after!.get(path)?.objectId || before!.get(path)?.mode !== after!.get(path)?.mode);
  const selected = paths.slice(0, IMPACT_LIMITS.changedPaths);
  const entries = selected.flatMap(path => [before!.get(path), after!.get(path)]).filter((entry): entry is GitBlobTreeEntry => entry?.type === "blob");
  const blobs = readGitBlobs(root, entries);
  const bodies = new Map(entries.map((entry, index) => [entry.objectId, blobs[index]!]));
  const diffBudget = { remaining: IMPACT_LIMITS.diffWork };
  const changes: ImpactChange[] = paths.map((path, index) => {
    if (!isRepoRelativePosixPath(path)) throw new NativeContextError("native-context-path-unsafe", { category: "diff-path" });
    if (index >= IMPACT_LIMITS.changedPaths) return { path, added: null, deleted: null, hunks: [] };
    const a = before!.get(path), b = after!.get(path);
    if ([a, b].some(entry => entry && (entry.type !== "blob" || !entry.utf8Valid))) return { path, added: null, deleted: null, hunks: [], reasonCode: "non-blob-entry" };
    return { path, ...diffImpactLines(a ? bodies.get(a.objectId)! : Buffer.alloc(0), b ? bodies.get(b.objectId)! : Buffer.alloc(0), diffBudget) };
  });
  return computeRefImpact({ base, head, changes, depth: options.depth, ...readRefImpactFacts(root, base, head) });
}
