import { isRepoRelativePosixPath } from "./schema";

export const ARCHITECTURE_HISTORY_SCHEMA_VERSION = "archcontext.architecture-history/v1" as const;
export const ARCHITECTURE_HISTORY_MERMAID_SCHEMA_VERSION = "archcontext.architecture-history-mermaid/v1" as const;
export const ARCHITECTURE_HISTORY_DERIVATION_VERSION = "v3" as const;

export type HistoryErrorCode = "history-model-layout-unsupported" | "history-model-missing" | "history-model-invalid" | "history-model-too-large";
export interface HistoryNode { id: string; name: string; domain: string | null }
export interface HistoryEdge { source: string; target: string }
export interface HistoryStructureNode { id: string; kind: "capability" | "module" | "component"; name: string; capability: string | null }
export interface HistoryDelta {
  baseRev: string | null;
  added: Array<Pick<HistoryStructureNode, "id" | "kind" | "capability">>;
  removed: Array<Pick<HistoryStructureNode, "id" | "kind" | "capability">>;
  renamed: Array<Pick<HistoryStructureNode, "id" | "kind" | "capability"> & { from: string; to: string }>;
  edgesChanged: { added: HistoryEdge[]; removed: HistoryEdge[] };
}
export type HistoryState = { nodes: HistoryNode[]; edges: HistoryEdge[]; structure: HistoryStructureNode[]; error?: never } | { nodes: null; edges: null; structure: null; error: { code: HistoryErrorCode; path?: string } };
export type HistoryMilestone = { rev: string; date: string; subject: string } & ({ nodes: HistoryNode[]; edges: HistoryEdge[]; delta: HistoryDelta; error?: never } | { nodes: null; edges: null; delta: null; error: { code: HistoryErrorCode; path?: string } });
export interface ArchitectureHistory { schemaVersion: typeof ARCHITECTURE_HISTORY_SCHEMA_VERSION; head: string; total: number; offset: number; limit: number; milestones: HistoryMilestone[] }

const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const string = (v: unknown): v is string => typeof v === "string";
const edge = (v: unknown) => object(v) && string(v.source) && string(v.target);
const kind = (v: unknown) => v === "capability" || v === "module" || v === "component";
const item = (v: unknown) => object(v) && string(v.id) && kind(v.kind) && (v.capability === null || string(v.capability)) && (v.kind !== "capability" || v.capability === v.id);
const structure = (v: unknown) => item(v) && object(v) && string(v.name);
const node = (v: unknown) => object(v) && string(v.id) && string(v.name) && (v.domain === null || string(v.domain));
const errors: readonly string[] = ["history-model-layout-unsupported", "history-model-missing", "history-model-invalid", "history-model-too-large"];
const sha = (v: unknown) => string(v) && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v);
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const error = (v: unknown) => object(v) && string(v.code) && errors.includes(v.code) && (v.path === undefined || (string(v.path) && isRepoRelativePosixPath(v.path)));
const list = (v: unknown, check: (item: unknown) => unknown) => Array.isArray(v) && v.every(check);

/** Cache entries are untrusted and never authority for malformed data. */
export function decodeArchitectureHistoryState(value: unknown): HistoryState | undefined {
  if (!object(value)) return undefined;
  if (value.nodes === null && value.edges === null && value.structure === null && error(value.error)) return value as unknown as HistoryState;
  if (value.error === undefined && list(value.nodes, node) && list(value.edges, edge) && list(value.structure, structure)) return value as unknown as HistoryState;
  return undefined;
}

export function architectureHistoryIssues(value: unknown): string[] {
  if (!object(value) || value.schemaVersion !== ARCHITECTURE_HISTORY_SCHEMA_VERSION || !sha(value.head) || !count(value.total) || !count(value.offset) || !count(value.limit) || value.limit > 1000 || !Array.isArray(value.milestones) || value.milestones.length > value.limit || value.milestones.length > Math.max(0, value.total - value.offset)) return ["invalid history envelope"];
  let previousValid: string | null = null;
  const valid = value.milestones.every((m: unknown) => {
    if (!object(m) || !sha(m.rev) || !string(m.date) || !string(m.subject)) return false;
    if (m.nodes === null && m.edges === null && m.delta === null) return error(m.error);
    if (m.error !== undefined || !list(m.nodes, node) || !list(m.edges, edge) || !object(m.delta) || (m.delta.baseRev !== null && !sha(m.delta.baseRev)) || (previousValid !== null && m.delta.baseRev !== previousValid) || (previousValid === null && value.offset === 0 && m.delta.baseRev !== null)) return false;
    previousValid = m.rev as string;
    const renamed = (v: unknown) => item(v) && object(v) && string(v.from) && string(v.to);
    return list(m.delta.added, item) && list(m.delta.removed, item) && list(m.delta.renamed, renamed) && object(m.delta.edgesChanged) && list(m.delta.edgesChanged.added, edge) && list(m.delta.edgesChanged.removed, edge);
  });
  return valid ? [] : ["invalid history milestones"];
}
export function decodeArchitectureHistory(value: unknown): ArchitectureHistory | undefined {
  return architectureHistoryIssues(value).length === 0 ? value as ArchitectureHistory : undefined;
}
