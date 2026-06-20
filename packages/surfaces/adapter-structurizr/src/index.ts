import { digestJson, type Json, type ModelExportResult } from "@archcontext/contracts";
import { stripAdapterProtectedNativeFields } from "@archcontext/core/architecture-domain";
import { normalizeNativeModel, type NativeModel, type NativeNode, type NativeRelation } from "@archcontext/surfaces/renderer";

export function exportStructurizrWorkspace(model: NativeModel, name = "ArchContext Export"): ModelExportResult {
  const normalized = normalizeNativeModel(model);
  const workspace = {
    schemaVersion: "archcontext.structurizr-export/v1",
    name,
    model: {
      elements: normalized.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        type: structurizrElementType(node.kind),
        tags: [node.kind],
        archcontextNative: node
      })),
      relationships: normalized.relations.map((relation) => ({
        id: relation.id,
        sourceId: relation.source,
        destinationId: relation.target,
        description: relation.kind,
        archcontextNative: relation
      }))
    },
    views: {
      systemLandscape: {
        key: "archcontext-landscape",
        include: normalized.nodes.map((node) => node.id)
      }
    }
  };
  const content = `${JSON.stringify(workspace, null, 2)}\n`;
  return {
    format: "structurizr",
    digest: digestJson(workspace as unknown as Json),
    files: [{ path: ".archcontext/generated/architecture.structurizr.json", content }]
  };
}

export function importStructurizrInitialModel(content: string): { nodes: NativeNode[]; relations: NativeRelation[]; warnings: string[] } {
  const workspace = JSON.parse(content);
  const nodes = ((workspace.model?.elements ?? []) as any[]).map((element) => stripAdapterProtectedNativeFields(element.archcontextNative ?? {
    id: element.id,
    kind: String(element.type ?? "component").toLowerCase(),
    name: element.name
  }).clean) as NativeNode[];
  const relations = ((workspace.model?.relationships ?? []) as any[]).map((relationship) => stripAdapterProtectedNativeFields(relationship.archcontextNative ?? {
    id: relationship.id,
    kind: relationship.description ?? "depends-on",
    source: relationship.sourceId,
    target: relationship.destinationId,
    intent: relationship.description ?? "Imported from Structurizr."
  }).clean) as NativeRelation[];
  return {
    nodes,
    relations,
    warnings: ["Structurizr import is initialization-only; Native ArchContext remains source of truth."]
  };
}

function structurizrElementType(kind: string): "Software System" | "Container" | "Component" | "Database" | "External System" {
  if (kind === "capability") return "Software System";
  if (kind === "module") return "Container";
  if (kind === "datastore") return "Database";
  if (kind === "external-system") return "External System";
  return "Component";
}
