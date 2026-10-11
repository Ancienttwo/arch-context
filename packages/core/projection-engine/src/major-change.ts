import {
  ARCHITECTURE_REFRESH_SIGNAL_SCHEMA_VERSION,
  ARCHITECTURE_SEMANTIC_STATE_SCHEMA_VERSION,
  digestJson,
  type AcceptedArchitectureChangeReferenceV1,
  type ArchitectureCapabilityChangeV1,
  type ArchitectureCapabilitySemanticStateV1,
  type ArchitectureDigestSetV1,
  type ArchitectureMajorChangeReasonCode,
  type ArchitectureProofEvidenceDigestsV1,
  type ArchitectureRefreshSignalV1,
  type ArchitectureSemanticFacet,
  type ArchitectureSemanticStateV1,
  type Json,
  type Sha256Digest
} from "@archcontext/contracts";
import type { NativeModel, NativeNode } from "./index";
import { proofRelevantSelectorEvidence, type ArchitectureSelectorEvidenceV1, type SemanticCapabilityDiagramCompilation } from "./semantic-diagrams";

const REFRESH_TARGETS = [
  "architecture-contract-context",
  "architecture-readiness",
  "architecture-request-index",
  "capability-context",
  "capability-index"
] as const;

/** Each facet in the order its reason is checked, with the reason a moved digest raises. */
const FACET_REASONS: ReadonlyArray<readonly [ArchitectureSemanticFacet, ArchitectureMajorChangeReasonCode]> = [
  ["placement", "node-moved"],
  ["names", "node-renamed"],
  ["responsibilities", "responsibility-changed"],
  ["entrypoints", "entrypoint-changed"],
  ["interfaces", "interface-changed"],
  ["relations", "relation-changed"],
  ["constraints", "constraint-changed"],
  ["ownership", "ownership-changed"],
  ["lifecycle", "lifecycle-changed"],
  ["riskBoundaries", "risk-boundary-changed"]
];

export interface ArchitectureMajorChangeClassificationV1 {
  schemaVersion: "archcontext.major-change-classification/v1";
  mode: "human-action-required" | "none" | "refresh-required";
  cause?: ArchitectureRefreshSignalV1["cause"];
  reasonCodes: ArchitectureMajorChangeReasonCode[];
  affectedNodeIds: string[];
  /** Per-capability breakdown of `reasonCodes`, sorted by capabilityId; empty when mode is none (#264). */
  capabilities: ArchitectureCapabilityChangeV1[];
  acceptedChange?: AcceptedArchitectureChangeReferenceV1;
}

export function architectureProofEvidenceDigests(input: {
  sourceTreeDigest: string;
  selectorEvidence: readonly ArchitectureSelectorEvidenceV1[];
  rendererVersion: string;
}): ArchitectureProofEvidenceDigestsV1 {
  return {
    sourceTreeDigest: input.sourceTreeDigest,
    selectorEvidenceDigest: digestJson(proofRelevantSelectorEvidence(input.selectorEvidence) as unknown as Json),
    rendererVersion: input.rendererVersion
  };
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
  // Unresolved capabilities without an observed semantic delta carry the reason the top-level
  // classification attributes to them: a verified-flow-proof change nobody can vouch for.
  const unresolvedOnly = (reasonCodes: ArchitectureMajorChangeReasonCode[]) =>
    unresolvedCapabilityChanges(unresolved, input.base, input.resulting, reasonCodes);
  if (!input.base) {
    if (input.acceptedChange) throw new Error("architecture-major-change-accepted-reference-without-baseline");
    return unresolved.length === 0
      ? noMajorChange()
      : humanAction(["verified-flow-proof-changed"], unresolved, unresolvedOnly(["verified-flow-proof-changed"]));
  }

  const observed = observedMajorChange(input.base, input.resulting);
  if (observed.reasonCodes.length === 0) {
    if (input.acceptedChange) throw new Error("architecture-major-change-accepted-reference-without-semantic-delta");
    return unresolved.length === 0
      ? noMajorChange()
      : humanAction(["verified-flow-proof-changed"], unresolved, unresolvedOnly(["verified-flow-proof-changed"]));
  }
  if (!input.acceptedChange || unresolved.length > 0) {
    // An unresolved capability the observed delta did not touch is listed without reason codes:
    // it is here because its proof is unprovable, which its proof statuses show.
    const observedIds = new Set(observed.capabilities.map((entry) => entry.capabilityId));
    const capabilities = [
      ...observed.capabilities,
      ...unresolvedOnly([]).filter((entry) => !observedIds.has(entry.capabilityId))
    ].sort((left, right) => left.capabilityId < right.capabilityId ? -1 : left.capabilityId > right.capabilityId ? 1 : 0);
    return humanAction(observed.reasonCodes, [...new Set([...observed.affectedNodeIds, ...unresolved])].sort(), capabilities);
  }
  const observedReasons = new Set(observed.reasonCodes);
  const unsupportedAcceptedReason = input.acceptedChange.reasonCodes.find((reason) => !observedReasons.has(reason));
  if (unsupportedAcceptedReason) {
    throw new Error(`architecture-major-change-accepted-reason-not-observed: ${unsupportedAcceptedReason}`);
  }
  const changedCapabilities = new Set(observed.capabilities.map((entry) => entry.capabilityId));
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
    capabilities: observed.capabilities,
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
    capabilities: input.classification.capabilities,
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
  /** Every capability whose semantic or flow-proof fingerprint moved, sorted by capabilityId. */
  capabilities: ArchitectureCapabilityChangeV1[];
} {
  const baseById = new Map(base.capabilities.map((entry) => [entry.capabilityId, entry]));
  const resultingById = new Map(resulting.capabilities.map((entry) => [entry.capabilityId, entry]));
  const capabilityIds = [...new Set([...baseById.keys(), ...resultingById.keys()])].sort();
  const reasons = new Set<ArchitectureMajorChangeReasonCode>();
  const affected = new Set<string>();
  const capabilities: ArchitectureCapabilityChangeV1[] = [];
  for (const capabilityId of capabilityIds) {
    const before = baseById.get(capabilityId);
    const after = resultingById.get(capabilityId);
    if (!before || !after) {
      const reason = before ? "node-removed" : "node-added";
      reasons.add(reason);
      affected.add(capabilityId);
      capabilities.push(capabilityChange(capabilityId, [reason], [], before, after));
      continue;
    }
    const capabilityReasons = new Set<ArchitectureMajorChangeReasonCode>();
    const added = after.memberNodeIds.filter((id) => !before.memberNodeIds.includes(id));
    const removed = before.memberNodeIds.filter((id) => !after.memberNodeIds.includes(id));
    if (added.length > 0) capabilityReasons.add("node-added");
    if (removed.length > 0) capabilityReasons.add("node-removed");
    for (const id of [...added, ...removed]) affected.add(id);
    const changedFacets = changedSemanticFacets(before, after);
    for (const [facet, reason] of FACET_REASONS) if (changedFacets.includes(facet)) capabilityReasons.add(reason);
    if (before.flowProofFingerprint !== after.flowProofFingerprint) capabilityReasons.add("verified-flow-proof-changed");
    for (const reason of capabilityReasons) reasons.add(reason);
    if (before.semanticFingerprint !== after.semanticFingerprint || before.flowProofFingerprint !== after.flowProofFingerprint) {
      affected.add(capabilityId);
      capabilities.push(capabilityChange(capabilityId, [...capabilityReasons], changedFacets, before, after));
    }
  }
  return {
    reasonCodes: [...reasons].sort(),
    affectedNodeIds: [...affected].sort(),
    capabilities
  };
}

/** The facets whose digest differs between the two states of one capability. */
function changedSemanticFacets(before: ArchitectureCapabilitySemanticStateV1, after: ArchitectureCapabilitySemanticStateV1): ArchitectureSemanticFacet[] {
  return FACET_REASONS.filter(([facet]) => before.facets[facet] !== after.facets[facet]).map(([facet]) => facet);
}

function capabilityChange(
  capabilityId: string,
  reasonCodes: ArchitectureMajorChangeReasonCode[],
  changedFacets: ArchitectureSemanticFacet[],
  before: ArchitectureCapabilitySemanticStateV1 | undefined,
  after: ArchitectureCapabilitySemanticStateV1 | undefined
): ArchitectureCapabilityChangeV1 {
  return {
    capabilityId,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    changedFacets: [...new Set(changedFacets)].sort(),
    proofStatusBefore: before ? { p1: before.proofStatus.p1, p2: before.proofStatus.p2 } : null,
    proofStatusAfter: after ? { p1: after.proofStatus.p1, p2: after.proofStatus.p2 } : null
  };
}

/**
 * Capabilities whose current proof is unprovable and whose semantic facets did not move (a moved
 * one is an observed change instead), with the reason codes the caller attributes to them.
 */
function unresolvedCapabilityChanges(
  unresolved: readonly string[],
  base: ArchitectureSemanticStateV1 | undefined,
  resulting: ArchitectureSemanticStateV1,
  reasonCodes: ArchitectureMajorChangeReasonCode[]
): ArchitectureCapabilityChangeV1[] {
  const baseById = new Map((base?.capabilities ?? []).map((entry) => [entry.capabilityId, entry]));
  const resultingById = new Map(resulting.capabilities.map((entry) => [entry.capabilityId, entry]));
  return unresolved.map((capabilityId) => capabilityChange(capabilityId, reasonCodes, [], baseById.get(capabilityId), resultingById.get(capabilityId)));
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
    affectedNodeIds: [],
    capabilities: []
  };
}

function humanAction(
  reasonCodes: ArchitectureMajorChangeReasonCode[],
  affectedNodeIds: string[],
  capabilities: ArchitectureCapabilityChangeV1[]
): ArchitectureMajorChangeClassificationV1 {
  return {
    schemaVersion: "archcontext.major-change-classification/v1",
    mode: "human-action-required",
    cause: "unresolved-major-candidate",
    reasonCodes: [...new Set(reasonCodes)].sort(),
    affectedNodeIds: [...new Set(affectedNodeIds)].sort(),
    capabilities
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
