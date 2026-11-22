import {
  architectureSemanticStateFromCapabilities,
  digestJson,
  type ArchitectureSemanticFacet,
  type ArchitectureSemanticStateV1,
  type Json
} from "@archcontext/contracts";
import type { NativeModel, NativeNode } from "@archcontext/core/architecture-domain";
import type { SemanticCapabilityDiagramCompilation } from "./semantic-diagrams";

export function compileArchitectureSemanticState(input: {
  model: NativeModel;
  compilations: SemanticCapabilityDiagramCompilation[];
}): ArchitectureSemanticStateV1 {
  const nodes = [...input.model.nodes].sort((left, right) => left.id.localeCompare(right.id));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const compilations = new Map(input.compilations.map((entry) => [entry.capabilityId, entry]));
  const capabilities = nodes.filter((node) => node.kind === "capability").map((capability) => {
    const memberNodes = nodes.filter((node) => node.id === capability.id || hasAncestor(node, capability.id, nodesById));
    const memberNodeIds = memberNodes.map((node) => node.id);
    const memberSet = new Set(memberNodeIds);
    const relations = (input.model.relations ?? [])
      .filter((relation) => memberSet.has(relation.source) || memberSet.has(relation.target))
      .sort((left, right) => left.id.localeCompare(right.id));
    const flows = (input.model.flows ?? [])
      .filter((flow) => flow.capabilityId === capability.id)
      .sort((left, right) => left.id.localeCompare(right.id));
    const compilation = compilations.get(capability.id);
    if (!compilation) throw new Error(`architecture-major-change-compilation-missing: ${capability.id}`);
    const facets: Record<ArchitectureSemanticFacet, string> = {
      constraints: facetDigest(memberNodes.map((node) => ({ id: node.id, constraints: canonicalUnorderedJson(recordField(node.extensions, "constraints")) }))),
      entrypoints: facetDigest(memberNodes.map((node) => ({ id: node.id, entrypoints: canonicalEntrypoints(recordField(node.source, "entrypoints")) }))),
      interfaces: facetDigest(memberNodes.map((node) => ({ id: node.id, interfaces: canonicalNamedSets(node.interfaces) }))),
      lifecycle: facetDigest(memberNodes.map((node) => ({ id: node.id, status: node.status ?? null, lifecycle: canonicalUnorderedJson(recordField(node.ownership, "lifecycle")) }))),
      names: facetDigest(memberNodes.map((node) => ({ id: node.id, name: node.name }))),
      ownership: facetDigest(memberNodes.map((node) => ({ id: node.id, ownership: canonicalNamedSets(node.ownership), sourceFootprint: sourceFootprint(node) }))),
      placement: facetDigest(memberNodes.map((node) => ({ id: node.id, parent: node.parent ?? null }))),
      relations: facetDigest(relations),
      responsibilities: facetDigest(memberNodes.map((node) => ({ id: node.id, summary: node.summary ?? null, responsibilities: canonicalUnorderedJson(node.responsibilities ?? []) }))),
      riskBoundaries: facetDigest(memberNodes.map((node) => ({ id: node.id, criticality: node.criticality ?? null, riskDomains: canonicalUnorderedJson(node.riskDomains ?? []) })))
    };
    const flowProofFingerprint = digestJson({
      proofDigest: compilation.proofDigest,
      p1: compilation.p1.status,
      p2: compilation.p2.status,
      flows
    } as unknown as Json);
    return {
      capabilityId: capability.id,
      memberNodeIds,
      semanticFingerprint: digestJson({ capabilityId: capability.id, memberNodeIds, facets, flows } as unknown as Json),
      flowProofFingerprint,
      proofStatus: { p1: compilation.p1.status, p2: compilation.p2.status },
      facets
    };
  });
  return architectureSemanticStateFromCapabilities(capabilities);
}

function hasAncestor(node: NativeNode, ancestorId: string, nodesById: Map<string, NativeNode>): boolean {
  const seen = new Set<string>();
  let parent = node.parent;
  while (parent) {
    if (parent === ancestorId) return true;
    if (seen.has(parent)) throw new Error(`architecture-major-change-parent-cycle: ${node.id}`);
    seen.add(parent);
    parent = nodesById.get(parent)?.parent;
  }
  return false;
}

function sourceFootprint(node: NativeNode): Json {
  const source = node.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const record = source as Record<string, Json>;
  return {
    include: canonicalUnorderedJson(record.include ?? []),
    exclude: canonicalUnorderedJson(record.exclude ?? [])
  };
}

function canonicalNamedSets(value: Json | undefined): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonicalUnorderedJson(entry)])) as Json;
}

function canonicalEntrypoints(value: Json): Json {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const record = entry as Record<string, Json>;
    const symbols = Array.isArray(record.symbols) ? record.symbols.map((symbol) => {
      if (!symbol || typeof symbol !== "object" || Array.isArray(symbol)) return symbol;
      const symbolRecord = symbol as Record<string, Json>;
      return {
        ...symbolRecord,
        sinks: canonicalObjectArray(symbolRecord.sinks, "id")
      } as Json;
    }).sort(compareJsonBy("name")) : record.symbols;
    return { ...record, symbols } as Json;
  }).sort(compareJsonBy("id"));
}

function canonicalObjectArray(value: Json | undefined, key: string): Json {
  if (!Array.isArray(value)) return value ?? null;
  return [...value].sort(compareJsonBy(key));
}

function compareJsonBy(key: string): (left: Json, right: Json) => number {
  return (left, right) => jsonField(left, key).localeCompare(jsonField(right, key));
}

function jsonField(value: Json, key: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const field = (value as Record<string, Json>)[key];
  return typeof field === "string" ? field : JSON.stringify(field);
}

function canonicalUnorderedJson(value: Json): Json {
  if (!Array.isArray(value)) return value;
  return [...value].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function recordField(value: Json | undefined, field: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return (value as Record<string, Json>)[field] ?? null;
}

function facetDigest(value: unknown): string {
  return digestJson(value as Json);
}
