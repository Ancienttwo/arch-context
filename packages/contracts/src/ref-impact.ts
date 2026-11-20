import type { NativeContextSnapshot } from "./native-context";
import { isRepoRelativePosixPath } from "./schema";

export const REF_IMPACT_BATCH_REQUEST_SCHEMA_VERSION = "archcontext.ref-impact-batch-request/v1" as const;
export const REF_IMPACT_BATCH_SCHEMA_VERSION = "archcontext.ref-impact-batch/v1" as const;

export interface RefImpactBatchRequestV1 {
  schemaVersion: typeof REF_IMPACT_BATCH_REQUEST_SCHEMA_VERSION;
  items: Array<{ id: string; paths: string[] }>;
}

export type RefImpactBatchItemV1 =
  | { id: string; impact: RefImpactV1 }
  | { id: string; status: "unavailable"; reasonCode: "batch-response-bytes" };

export interface RefImpactBatchV1 {
  schemaVersion: typeof REF_IMPACT_BATCH_SCHEMA_VERSION;
  items: RefImpactBatchItemV1[];
}

export function isRefImpactBatchRequest(value: unknown): value is RefImpactBatchRequestV1 {
  if (!isRecord(value) || Object.keys(value).length !== 2 || value.schemaVersion !== REF_IMPACT_BATCH_REQUEST_SCHEMA_VERSION || !Array.isArray(value.items)) return false;
  for (const item of value.items) {
    if (!isRecord(item) || Object.keys(item).length !== 2 || typeof item.id !== "string" || !Array.isArray(item.paths)) return false;
    for (const path of item.paths) {
      if (typeof path !== "string" || !isRepoRelativePosixPath(path) || path.includes("\0")) return false;
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export const REF_IMPACT_SCHEMA_VERSION = "archcontext.ref-impact/v1" as const;
export const REF_IMPACT_LIMITS = Object.freeze({ changedPaths: 1000, nodes: 1000, relations: 5000, flowSteps: 2000, dependents: 5000, modelChanges: 5000, depth: 10, diffLines: 100_000, diffWork: 2_000_000, diffBytes: 8 * 1024 * 1024, responseBytes: 8 * 1024 * 1024, codeFactFiles: 10_000, codeFactBytes: 8 * 1024 * 1024 });
export interface RefImpactModelChange { kind: string; id: string; change: "added" | "removed" | "changed"; fields: string[] }
/** Items also identify uncertain steps via selector-evidence-unavailable; inspect reasons before claiming a touch. */
export interface RefImpactFlowStep { flowId: string; stepId: string; outcomeId: string | null; reasonCodes: string[] }
/** No timestamps, workspace paths, source bodies or live session state. */
export interface RefImpactV1 {
  schemaVersion: typeof REF_IMPACT_SCHEMA_VERSION;
  base: NativeContextSnapshot | null;
  head: NativeContextSnapshot;
  depth: number;
  changedPaths: Array<{ path: string; added: number | null; deleted: number | null; baseOwners: string[]; headOwners: string[]; owners: string[]; reasonCodes: string[] }>;
  unownedPaths: string[];
  touchedNodes: Array<{ nodeId: string; pathCount: number }>;
  touchedFlowSteps: { status: "known" | "unknown"; reasonCodes: string[]; items: RefImpactFlowStep[] | null };
  dependents: Array<{ nodeId: string; touchedNodeId: string; relationIds: string[] }>;
  dependencyCoverage: { status: "complete" | "partial"; graph: "head"; pathSelection: "one-shortest-path-per-node-pair" };
  modelDelta: { status: "known"; changes: RefImpactModelChange[]; truncated: boolean } | { status: "unknown"; reasonCode: "paths-only"; changes: null; truncated: false };
  limits: typeof REF_IMPACT_LIMITS;
  truncated: { changedPaths: boolean; touchedNodes: boolean; relations: boolean; flowSteps: boolean; dependents: boolean; modelDelta: boolean };
}
