import type {
  ArchitectureFlowV1,
  ArchitectureNodeSourceV2,
  Json
} from "@archcontext/contracts";

export type NativeNodeSource = ArchitectureNodeSourceV2;

export interface NativeNode extends Record<string, Json | undefined> {
  schemaVersion?: "archcontext.node/v2";
  id: string;
  kind: string;
  name: string;
  parent?: string;
  /** Optional layer slug (ADR-0049); the only authority the layered diagram views group by. */
  layer?: string;
  status?: string;
  summary?: string;
  // Typed as Json (not NativeNodeSource) so this interface still satisfies its own
  // Record<string, Json | undefined> index signature; use nativeNodeSource(node) to read
  // this field with the NativeNodeSource shape.
  source?: Json;
  extensions?: Record<string, Json>;
}

/** Reads `node.source` (ADR-0043 `source.include`/`source.exclude`/`entrypoints`) as NativeNodeSource. */
export function nativeNodeSource(node: NativeNode): NativeNodeSource | undefined {
  const value = node.source;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as unknown as NativeNodeSource;
}

/**
 * The ids a `<id>#symbol` selector may name in `model`: node ids, the entrypoint ids and sink ids
 * under `source.entrypoints`, and flow ids.
 */
export function modelSelectorIds(model: { nodes: readonly NativeNode[]; flows?: readonly { id: string }[] }): string[] {
  const ids = new Set<string>();
  for (const node of model.nodes) {
    ids.add(node.id);
    for (const entrypoint of nativeNodeSource(node)?.entrypoints ?? []) {
      ids.add(entrypoint.id);
      for (const symbol of entrypoint.symbols) for (const sink of symbol.sinks) ids.add(sink.id);
    }
  }
  for (const flow of model.flows ?? []) ids.add(flow.id);
  return [...ids].sort();
}

export interface NativeRelation extends Record<string, Json> {
  id: string;
  kind: string;
  source: string;
  target: string;
  intent: string;
}

export interface NativeModel {
  layers?: string[];
  nodes: NativeNode[];
  relations: NativeRelation[];
  flows?: ArchitectureFlowV1[];
}
