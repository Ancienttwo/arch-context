import type { NativeContextSnapshot } from "./native-context";
export const REF_IMPACT_SCHEMA_VERSION = "archcontext.ref-impact/v1" as const;
export const REF_IMPACT_LIMITS = Object.freeze({ changedPaths: 1000, nodes: 1000, relations: 5000, flowSteps: 2000, dependents: 5000, modelChanges: 5000, depth: 10, diffLines: 100_000, diffWork: 2_000_000, diffBytes: 8 * 1024 * 1024, responseBytes: 8 * 1024 * 1024 });
export interface RefImpactModelChange { kind: string; id: string; change: "added" | "removed" | "changed"; fields: string[] }
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
