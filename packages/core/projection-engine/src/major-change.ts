import {
  ARCHITECTURE_REFRESH_SIGNAL_SCHEMA_VERSION,
  digestJson,
  type AcceptedArchitectureChangeReferenceV1,
  type ArchitectureDigestSetV1,
  type ArchitectureMajorChangeReasonCode,
  type ArchitectureRefreshSignalV1,
  type Json,
  type Sha256Digest
} from "@archcontext/contracts";
import type { NativeModel, NativeNode } from "./index";
import type { SemanticCapabilityDiagramCompilation } from "./semantic-diagrams";

export const ARCHITECTURE_SEMANTIC_STATE_SCHEMA_VERSION = "archcontext.architecture-semantic-state/v1" as const;

const REFRESH_TARGETS = [
  "architecture-contract-context",
  "architecture-readiness",
  "architecture-request-index",
  "capability-context",
  "capability-index"
] as const;

type FacetName =
  | "constraints"
  | "entrypoints"
  | "interfaces"
  | "lifecycle"
  | "names"
  | "ownership"
  | "placement"
  | "relations"
  | "responsibilities"
  | "riskBoundaries";

export interface ArchitectureCapabilitySemanticStateV1 {
  capabilityId: string;
  memberNodeIds: string[];
  semanticFingerprint: string;
  flowProofFingerprint: string;
  proofStatus: { p1: "proven" | "unprovable"; p2: "not-applicable" | "proven" | "unprovable" };
  facets: Record<FacetName, string>;
}

export interface ArchitectureSemanticStateV1 {
  schemaVersion: typeof ARCHITECTURE_SEMANTIC_STATE_SCHEMA_VERSION;
  capabilities: ArchitectureCapabilitySemanticStateV1[];
  semanticFingerprint: string;
  flowProofFingerprint: string;
}

export interface ArchitectureMajorChangeClassificationV1 {
  schemaVersion: "archcontext.major-change-classification/v1";
  mode: "human-action-required" | "none" | "refresh-required";
  cause?: ArchitectureRefreshSignalV1["cause"];
  reasonCodes: ArchitectureMajorChangeReasonCode[];
  affectedNodeIds: string[];
  acceptedChange?: AcceptedArchitectureChangeReferenceV1;
}

export interface ArchitectureProjectionSemanticBaselineV1 {
  semanticState: ArchitectureSemanticStateV1;
  digests: ArchitectureDigestSetV1;
}

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
    const facets: Record<FacetName, string> = {
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
  return {
    schemaVersion: ARCHITECTURE_SEMANTIC_STATE_SCHEMA_VERSION,
    capabilities,
    semanticFingerprint: digestJson(capabilities.map(({ capabilityId, semanticFingerprint }) => ({ capabilityId, semanticFingerprint })) as unknown as Json),
    flowProofFingerprint: digestJson(capabilities.map(({ capabilityId, flowProofFingerprint }) => ({ capabilityId, flowProofFingerprint })) as unknown as Json)
  };
}

export function classifyArchitectureMajorChange(input: {
  base?: ArchitectureSemanticStateV1;
  resulting: ArchitectureSemanticStateV1;
  acceptedChange?: AcceptedArchitectureChangeReferenceV1;
}): ArchitectureMajorChangeClassificationV1 {
  assertSemanticState(input.resulting);
  if (input.base) assertSemanticState(input.base);
  if (input.acceptedChange) assertAcceptedChange(input.acceptedChange);

  const unresolved = input.resulting.capabilities
    .filter((entry) => entry.proofStatus.p1 === "unprovable" || entry.proofStatus.p2 === "unprovable")
    .map((entry) => entry.capabilityId)
    .sort();
  if (!input.base) {
    if (input.acceptedChange) throw new Error("architecture-major-change-accepted-reference-without-baseline");
    return unresolved.length === 0
      ? noMajorChange()
      : humanAction(["verified-flow-proof-changed"], unresolved);
  }

  const observed = observedMajorChange(input.base, input.resulting);
  if (observed.reasonCodes.length === 0) {
    if (input.acceptedChange) throw new Error("architecture-major-change-accepted-reference-without-semantic-delta");
    return unresolved.length === 0 ? noMajorChange() : humanAction(["verified-flow-proof-changed"], unresolved);
  }
  if (!input.acceptedChange || unresolved.length > 0) {
    return humanAction(observed.reasonCodes, [...new Set([...observed.affectedNodeIds, ...unresolved])].sort());
  }
  const observedReasons = new Set(observed.reasonCodes);
  const unsupportedAcceptedReason = input.acceptedChange.reasonCodes.find((reason) => !observedReasons.has(reason));
  if (unsupportedAcceptedReason) {
    throw new Error(`architecture-major-change-accepted-reason-not-observed: ${unsupportedAcceptedReason}`);
  }
  const changedCapabilities = new Set(observed.capabilityIds);
  if (!input.acceptedChange.affectedNodeIds.some((nodeId) => belongsToChangedCapability(nodeId, changedCapabilities, input.base!, input.resulting))) {
    throw new Error("architecture-major-change-accepted-reference-does-not-bind-observed-delta");
  }
  return {
    schemaVersion: "archcontext.major-change-classification/v1",
    mode: "refresh-required",
    cause: input.acceptedChange.reasonCodes.every((reason) => reason === "verified-flow-proof-changed")
      ? "verified-flow-proof-delta"
      : "accepted-semantic-delta",
    reasonCodes: [...input.acceptedChange.reasonCodes],
    affectedNodeIds: [...input.acceptedChange.affectedNodeIds],
    acceptedChange: input.acceptedChange
  };
}

export function produceArchitectureRefreshSignals(input: {
  classification: ArchitectureMajorChangeClassificationV1;
  repositoryId: string;
  workspaceId: string;
  headSha: string;
  worktreeDigest: string;
  expected?: { repositoryId: string; workspaceId: string; headSha: string; worktreeDigest: string };
  baseDigests: ArchitectureDigestSetV1;
  resultingDigests: ArchitectureDigestSetV1;
  projectionReceiptDigest: string;
}): ArchitectureRefreshSignalV1[] {
  if (input.classification.mode === "none") return [];
  if (input.expected && (
    input.expected.repositoryId !== input.repositoryId
    || input.expected.workspaceId !== input.workspaceId
    || input.expected.headSha !== input.headSha
    || input.expected.worktreeDigest !== input.worktreeDigest
  )) throw new Error("architecture-refresh-signal-stale-worktree");
  if (!/^[a-f0-9]{40}$/.test(input.headSha)) throw new Error("architecture-refresh-signal-head-sha-invalid");
  for (const [label, digest] of Object.entries({
    worktreeDigest: input.worktreeDigest,
    projectionReceiptDigest: input.projectionReceiptDigest,
    ...input.baseDigests,
    ...input.resultingDigests
  })) assertDigest(digest, label);

  const identityPayload = {
    schemaVersion: ARCHITECTURE_REFRESH_SIGNAL_SCHEMA_VERSION,
    mode: input.classification.mode,
    repository: { repositoryId: input.repositoryId },
    worktree: { workspaceId: input.workspaceId, headSha: input.headSha, worktreeDigest: input.worktreeDigest as Sha256Digest },
    cause: input.classification.cause!,
    ...(input.classification.acceptedChange ? { acceptedChange: input.classification.acceptedChange } : {}),
    reasonCodes: input.classification.reasonCodes,
    affectedNodeIds: input.classification.affectedNodeIds,
    refreshTargets: [...REFRESH_TARGETS],
    baseDigests: input.baseDigests,
    resultingDigests: input.resultingDigests
  };
  const signalId = digestJson(identityPayload as unknown as Json) as Sha256Digest;
  return [{
    ...identityPayload,
    signalId,
    idempotencyKey: signalId,
    projectionReceiptDigest: input.projectionReceiptDigest as Sha256Digest
  }];
}

function observedMajorChange(base: ArchitectureSemanticStateV1, resulting: ArchitectureSemanticStateV1): {
  reasonCodes: ArchitectureMajorChangeReasonCode[];
  affectedNodeIds: string[];
  capabilityIds: string[];
} {
  const baseById = new Map(base.capabilities.map((entry) => [entry.capabilityId, entry]));
  const resultingById = new Map(resulting.capabilities.map((entry) => [entry.capabilityId, entry]));
  const capabilityIds = [...new Set([...baseById.keys(), ...resultingById.keys()])].sort();
  const reasons = new Set<ArchitectureMajorChangeReasonCode>();
  const affected = new Set<string>();
  const changedCapabilities = new Set<string>();
  for (const capabilityId of capabilityIds) {
    const before = baseById.get(capabilityId);
    const after = resultingById.get(capabilityId);
    if (!before) {
      reasons.add("node-added");
      affected.add(capabilityId);
      changedCapabilities.add(capabilityId);
      continue;
    }
    if (!after) {
      reasons.add("node-removed");
      affected.add(capabilityId);
      changedCapabilities.add(capabilityId);
      continue;
    }
    const added = after.memberNodeIds.filter((id) => !before.memberNodeIds.includes(id));
    const removed = before.memberNodeIds.filter((id) => !after.memberNodeIds.includes(id));
    if (added.length > 0) reasons.add("node-added");
    if (removed.length > 0) reasons.add("node-removed");
    for (const id of [...added, ...removed]) affected.add(id);
    compareFacet(before, after, "placement", "node-moved", reasons);
    compareFacet(before, after, "names", "node-renamed", reasons);
    compareFacet(before, after, "responsibilities", "responsibility-changed", reasons);
    compareFacet(before, after, "entrypoints", "entrypoint-changed", reasons);
    compareFacet(before, after, "interfaces", "interface-changed", reasons);
    compareFacet(before, after, "relations", "relation-changed", reasons);
    compareFacet(before, after, "constraints", "constraint-changed", reasons);
    compareFacet(before, after, "ownership", "ownership-changed", reasons);
    compareFacet(before, after, "lifecycle", "lifecycle-changed", reasons);
    compareFacet(before, after, "riskBoundaries", "risk-boundary-changed", reasons);
    if (before.flowProofFingerprint !== after.flowProofFingerprint) reasons.add("verified-flow-proof-changed");
    if (before.semanticFingerprint !== after.semanticFingerprint || before.flowProofFingerprint !== after.flowProofFingerprint) {
      affected.add(capabilityId);
      changedCapabilities.add(capabilityId);
    }
  }
  return {
    reasonCodes: [...reasons].sort(),
    affectedNodeIds: [...affected].sort(),
    capabilityIds: [...changedCapabilities].sort()
  };
}

function compareFacet(
  before: ArchitectureCapabilitySemanticStateV1,
  after: ArchitectureCapabilitySemanticStateV1,
  facet: FacetName,
  reason: ArchitectureMajorChangeReasonCode,
  reasons: Set<ArchitectureMajorChangeReasonCode>
): void {
  if (before.facets[facet] !== after.facets[facet]) reasons.add(reason);
}

function belongsToChangedCapability(
  nodeId: string,
  changedCapabilities: Set<string>,
  base: ArchitectureSemanticStateV1,
  resulting: ArchitectureSemanticStateV1
): boolean {
  if (changedCapabilities.has(nodeId)) return true;
  return [...base.capabilities, ...resulting.capabilities]
    .some((entry) => changedCapabilities.has(entry.capabilityId) && entry.memberNodeIds.includes(nodeId));
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

function noMajorChange(): ArchitectureMajorChangeClassificationV1 {
  return {
    schemaVersion: "archcontext.major-change-classification/v1",
    mode: "none",
    reasonCodes: [],
    affectedNodeIds: []
  };
}

function humanAction(reasonCodes: ArchitectureMajorChangeReasonCode[], affectedNodeIds: string[]): ArchitectureMajorChangeClassificationV1 {
  return {
    schemaVersion: "archcontext.major-change-classification/v1",
    mode: "human-action-required",
    cause: "unresolved-major-candidate",
    reasonCodes: [...new Set(reasonCodes)].sort(),
    affectedNodeIds: [...new Set(affectedNodeIds)].sort()
  };
}

function assertSemanticState(value: ArchitectureSemanticStateV1): void {
  if (value.schemaVersion !== ARCHITECTURE_SEMANTIC_STATE_SCHEMA_VERSION) throw new Error("architecture-major-change-semantic-state-schema-invalid");
  if (!isSortedUnique(value.capabilities.map((entry) => entry.capabilityId))) throw new Error("architecture-major-change-capabilities-not-sorted-unique");
  for (const capability of value.capabilities) {
    if (!isSortedUnique(capability.memberNodeIds)) throw new Error(`architecture-major-change-member-nodes-not-sorted-unique: ${capability.capabilityId}`);
  }
}

function assertAcceptedChange(value: AcceptedArchitectureChangeReferenceV1): void {
  if (value.changeSetId.trim() === "" || value.eventId.trim() === "") throw new Error("architecture-major-change-accepted-reference-invalid");
  if (value.reasonCodes.length === 0 || !isSortedUnique(value.reasonCodes)) throw new Error("architecture-major-change-accepted-reasons-not-sorted-unique");
  if (value.affectedNodeIds.length === 0 || !isSortedUnique(value.affectedNodeIds)) throw new Error("architecture-major-change-accepted-nodes-not-sorted-unique");
}

function assertDigest(value: string, label: string): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error(`architecture-refresh-signal-${label}-digest-invalid`);
}

function isSortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1] < value);
}
