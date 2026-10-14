import {
  digestJson,
  type ArchitectureFlowEvidenceSelectorV1,
  type ArchitectureFlowSelectorCheckV1,
  type ArchitectureFlowSelectorProofStatus,
  type ArchitectureFlowStepV1,
  type ArchitectureFlowV1,
  type ArchitectureNodeSourceV2,
  type Json
} from "@archcontext/contracts";

export type SemanticProofStatus = "proven" | "not-applicable" | "unprovable";

export interface SemanticArchitectureNode {
  id: string;
  kind: string;
  name: string;
  parent?: string;
  source?: ArchitectureNodeSourceV2;
}

export interface SemanticArchitectureRelation {
  id: string;
  kind: string;
  source: string;
  target: string;
  intent: string;
}

export interface ArchitectureSelectorEvidenceV1 {
  nodeId: string;
  entrypointId: string;
  sourcePath: string;
  sourceSymbol: string;
  sinkId: string;
  sinkPath: string;
  sinkSymbol: string;
  matched: boolean;
  /** More than one indexed source or exact sink identity matched the selector. */
  ambiguous?: boolean;
  truncated: boolean;
  callSites: Array<{ path: string; line?: number }>;
  /**
   * `calls` edges to the exact sink that the producer rejected as false built-in edges: the sink
   * carries a runtime built-in name and the source file does not import the sink file. They never
   * prove the selector. Present only when a call was rejected.
   */
  rejectedBuiltinCallSites?: Array<{ path: string; line?: number }>;
  /**
   * `references` edges from the source to the exact sink (wiring by value). They never prove the
   * selector. Present only when no call proves it.
   */
  referenceSites?: Array<{ path: string; line?: number }>;
}

export interface SemanticProofDiagnostic {
  code:
    | "capability-node-missing"
    | "parent-node-missing"
    | "semantic-edge-missing"
    | "flow-missing"
    | "flow-capability-mismatch"
    | "participant-node-missing"
    | "participant-id-duplicate"
    | "participant-reference-missing"
    | "relation-binding-missing"
    | "selector-declaration-missing"
    | "selector-declaration-ambiguous"
    | "selector-evidence-missing"
    | "selector-evidence-ambiguous"
    | "selector-evidence-truncated"
    | "selector-evidence-unmatched"
    | "outcome-kind-missing"
    | "terminal-participant-missing";
  flowId?: string;
  stepId?: string;
  detail: string;
}

export interface SemanticP1NodeAst {
  id: string;
  label: string;
  kind: string;
}

export interface SemanticP1EdgeAst {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface SemanticP1DiagramProof {
  status: Exclude<SemanticProofStatus, "not-applicable">;
  nodes: SemanticP1NodeAst[];
  edges: SemanticP1EdgeAst[];
  diagnostics: SemanticProofDiagnostic[];
  mermaid?: string;
}

export interface SemanticP2DiagramAst {
  flowId: string;
  name: string;
  participants: Array<{ id: string; label: string }>;
  steps: ArchitectureFlowStepV1[];
  outcomes: Array<{
    id: string;
    kind: "success" | "error";
    label: string;
    steps: ArchitectureFlowStepV1[];
    terminal: { participant: string; label: string };
  }>;
}

export interface SemanticP2DiagramProof {
  status: SemanticProofStatus;
  rationale?: string;
  diagrams: SemanticP2DiagramAst[];
  diagnostics: SemanticProofDiagnostic[];
  mermaid: string[];
}

export interface SemanticCapabilityDiagramCompilation {
  schemaVersion: "archcontext.semantic-diagram-compilation/v1";
  capabilityId: string;
  p1: SemanticP1DiagramProof;
  p2: SemanticP2DiagramProof;
  evidenceCoverage: {
    requiredSelectors: number;
    provenSelectors: number;
    unboundSelectors: string[];
  };
  proofDigest: string;
}

export function compileSemanticCapabilityDiagrams(input: {
  capabilityId: string;
  nodes: SemanticArchitectureNode[];
  relations: SemanticArchitectureRelation[];
  flows: ArchitectureFlowV1[];
  evidence: ArchitectureSelectorEvidenceV1[];
}): SemanticCapabilityDiagramCompilation {
  const nodesById = uniqueById(input.nodes, "architecture node");
  const capability = nodesById.get(input.capabilityId);
  const capabilityFlows = input.flows.filter((flow) => flow.capabilityId === input.capabilityId)
    .sort((left, right) => left.id.localeCompare(right.id));
  const foreignFlow = input.flows.find((flow) => flow.id.startsWith(`flow.${input.capabilityId.slice("capability.".length)}.`)
    && flow.capabilityId !== input.capabilityId);
  const p2Diagnostics: SemanticProofDiagnostic[] = [];
  if (foreignFlow) {
    p2Diagnostics.push({
      code: "flow-capability-mismatch",
      flowId: foreignFlow.id,
      detail: `${foreignFlow.id} names this capability but declares ${foreignFlow.capabilityId}`
    });
  }

  const requiredFlows = capabilityFlows.filter((flow) => flow.applicability === "required");
  const notApplicableFlows = capabilityFlows.filter((flow) => flow.applicability === "not-applicable");
  const requiredSelectorKeys: string[] = [];
  const provenSelectorKeys = new Set<string>();
  const diagrams: SemanticP2DiagramAst[] = [];
  const semanticNodeIds = new Set<string>(capability ? [capability.id] : []);

  if (!capability) {
    p2Diagnostics.push({ code: "capability-node-missing", detail: `missing ${input.capabilityId}` });
  }
  if (capabilityFlows.length === 0) {
    p2Diagnostics.push({ code: "flow-missing", detail: `no ArchitectureFlowV1 declares ${input.capabilityId}` });
  }

  for (const flow of requiredFlows) {
    const flowDiagnosticsStart = p2Diagnostics.length;
    const participantsById = new Map<string, { id: string; nodeId: string }>();
    for (const participant of flow.participants) {
      if (participantsById.has(participant.id)) {
        p2Diagnostics.push({ code: "participant-id-duplicate", flowId: flow.id, detail: `duplicate participant ${participant.id}` });
        continue;
      }
      participantsById.set(participant.id, participant);
      if (!nodesById.has(participant.nodeId)) {
        p2Diagnostics.push({ code: "participant-node-missing", flowId: flow.id, detail: `${participant.id} references ${participant.nodeId}` });
      } else {
        semanticNodeIds.add(participant.nodeId);
      }
    }

    const successCount = flow.outcomes.filter((outcome) => outcome.kind === "success").length;
    const errorCount = flow.outcomes.filter((outcome) => outcome.kind === "error").length;
    if (successCount === 0) p2Diagnostics.push({ code: "outcome-kind-missing", flowId: flow.id, detail: "success outcome missing" });
    if (errorCount === 0) p2Diagnostics.push({ code: "outcome-kind-missing", flowId: flow.id, detail: "error outcome missing" });

    const allSteps = [...flow.steps, ...flow.outcomes.flatMap((outcome) => outcome.steps)];
    for (const step of allSteps) {
      validateStep({
        flowId: flow.id,
        step,
        participantsById,
        nodesById,
        relations: input.relations,
        evidence: input.evidence,
        diagnostics: p2Diagnostics,
        requiredSelectorKeys,
        provenSelectorKeys
      });
    }
    for (const outcome of flow.outcomes) {
      if (!participantsById.has(outcome.terminal.participant)) {
        p2Diagnostics.push({
          code: "terminal-participant-missing",
          flowId: flow.id,
          detail: `${outcome.id} terminates at unknown participant ${outcome.terminal.participant}`
        });
      }
    }

    if (p2Diagnostics.length === flowDiagnosticsStart) {
      diagrams.push({
        flowId: flow.id,
        name: flow.name,
        participants: flow.participants.map((participant) => ({
          id: participant.id,
          label: nodesById.get(participant.nodeId)!.name
        })),
        steps: flow.steps,
        outcomes: flow.outcomes
      });
    }
  }

  const p2Status: SemanticProofStatus = p2Diagnostics.length > 0
    ? "unprovable"
    : requiredFlows.length > 0
      ? "proven"
      : notApplicableFlows.length > 0
        ? "not-applicable"
        : "unprovable";
  const p2: SemanticP2DiagramProof = {
    status: p2Status,
    ...(p2Status === "not-applicable" ? { rationale: notApplicableFlows.map((flow) => flow.rationale).join("; ") } : {}),
    diagrams: p2Status === "proven" ? diagrams : [],
    diagnostics: p2Diagnostics,
    mermaid: p2Status === "proven" ? diagrams.map(renderSemanticSequenceDiagram) : []
  };

  const scopedNodeIds = descendantNodeIds(input.capabilityId, input.nodes);
  for (const nodeId of semanticNodeIds) scopedNodeIds.add(nodeId);
  const p1Nodes = [...scopedNodeIds]
    .map((id) => nodesById.get(id))
    .filter((node): node is SemanticArchitectureNode => node !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node) => ({ id: node.id, label: node.name, kind: node.kind }));
  const p1Edges = input.relations
    .filter((relation) => scopedNodeIds.has(relation.source) && scopedNodeIds.has(relation.target))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((relation) => ({ id: relation.id, source: relation.source, target: relation.target, label: relation.intent }));
  const p1Diagnostics: SemanticProofDiagnostic[] = [];
  if (!capability) p1Diagnostics.push({ code: "capability-node-missing", detail: `missing ${input.capabilityId}` });
  for (const node of input.nodes.filter((entry) => entry.parent && !nodesById.has(entry.parent))) {
    p1Diagnostics.push({ code: "parent-node-missing", detail: `${node.id} references ${node.parent}` });
  }
  if (p1Edges.length === 0) {
    p1Diagnostics.push({ code: "semantic-edge-missing", detail: `${input.capabilityId} has no declared in-scope relation` });
  }
  const p1Status = p1Diagnostics.length === 0 ? "proven" : "unprovable";
  const p1: SemanticP1DiagramProof = {
    status: p1Status,
    nodes: p1Status === "proven" ? p1Nodes : [],
    edges: p1Status === "proven" ? p1Edges : [],
    diagnostics: p1Diagnostics,
    ...(p1Status === "proven" ? { mermaid: renderSemanticFlowchart(p1Nodes, p1Edges) } : {})
  };

  const unboundSelectors = [...new Set(requiredSelectorKeys.filter((key) => !provenSelectorKeys.has(key)))].sort();
  const withoutDigest = {
    schemaVersion: "archcontext.semantic-diagram-compilation/v1" as const,
    capabilityId: input.capabilityId,
    p1,
    p2,
    evidenceCoverage: {
      requiredSelectors: new Set(requiredSelectorKeys).size,
      provenSelectors: provenSelectorKeys.size,
      unboundSelectors
    }
  };
  return {
    ...withoutDigest,
    proofDigest: digestJson(withoutDigest as unknown as Json)
  };
}

function validateStep(input: {
  flowId: string;
  step: ArchitectureFlowStepV1;
  participantsById: Map<string, { id: string; nodeId: string }>;
  nodesById: Map<string, SemanticArchitectureNode>;
  relations: SemanticArchitectureRelation[];
  evidence: ArchitectureSelectorEvidenceV1[];
  diagnostics: SemanticProofDiagnostic[];
  requiredSelectorKeys: string[];
  provenSelectorKeys: Set<string>;
}): void {
  const from = input.participantsById.get(input.step.from);
  const to = input.participantsById.get(input.step.to);
  if (!from || !to) {
    input.diagnostics.push({
      code: "participant-reference-missing",
      flowId: input.flowId,
      stepId: input.step.id,
      detail: `${input.step.from} -> ${input.step.to}`
    });
    return;
  }
  if (!input.relations.some((relation) => relation.source === from.nodeId && relation.target === to.nodeId)) {
    input.diagnostics.push({
      code: "relation-binding-missing",
      flowId: input.flowId,
      stepId: input.step.id,
      detail: `${from.nodeId} -> ${to.nodeId}`
    });
  }

  const selectorKey = evidenceSelectorKey(input.step.evidence);
  input.requiredSelectorKeys.push(selectorKey);
  const declarations = architectureSelectorDeclarations([...input.nodesById.values()])
    .filter((declaration) => declaration.key === selectorKey);
  if (declarations.length === 0) {
    input.diagnostics.push({ code: "selector-declaration-missing", flowId: input.flowId, stepId: input.step.id, detail: selectorKey });
    return;
  }
  if (declarations.length > 1) {
    input.diagnostics.push({ code: "selector-declaration-ambiguous", flowId: input.flowId, stepId: input.step.id, detail: selectorKey });
    return;
  }
  const status = architectureSelectorProofStatus(
    input.evidence.filter((entry) => evidenceSelectorKey(entry) === selectorKey && entry.nodeId === declarations[0].nodeId)
  );
  if (status !== "proven") {
    input.diagnostics.push({ code: SELECTOR_STATUS_DIAGNOSTICS[status], flowId: input.flowId, stepId: input.step.id, detail: selectorKey });
    return;
  }
  input.provenSelectorKeys.add(selectorKey);
}

const SELECTOR_STATUS_DIAGNOSTICS: Record<Exclude<ArchitectureFlowSelectorProofStatus, "proven">, SemanticProofDiagnostic["code"]> = {
  "ambiguous-symbol": "selector-evidence-ambiguous",
  "evidence-missing": "selector-evidence-missing",
  "evidence-truncated": "selector-evidence-truncated",
  "false-builtin-call": "selector-evidence-unmatched",
  "no-direct-call": "selector-evidence-unmatched",
  "only-references": "selector-evidence-unmatched"
};

/**
 * The single selector proof rule. `evidence` holds every entry measured for one selector of one
 * declaring node. The P2 flow proof and `archctx flows check` both read a selector through this
 * function, so the check can never disagree with a projection. Only `proven` binds a flow step.
 */
export function architectureSelectorProofStatus(evidence: readonly ArchitectureSelectorEvidenceV1[]): ArchitectureFlowSelectorProofStatus {
  if (evidence.length === 0) return "evidence-missing";
  if (evidence.length > 1 || evidence[0].ambiguous) return "ambiguous-symbol";
  if (evidence[0].truncated) return "evidence-truncated";
  if (evidence[0].matched && evidence[0].callSites.length > 0) return "proven";
  if ((evidence[0].rejectedBuiltinCallSites ?? []).length > 0) return "false-builtin-call";
  if ((evidence[0].referenceSites ?? []).length > 0) return "only-references";
  return "no-direct-call";
}

/**
 * Every declared selector with its proof status and the required-flow steps that use it, plus the
 * P2 proof of every capability that declares a flow, compiled exactly as a projection compiles it.
 * Nothing is rendered; the result is a pure function of the model and the evidence.
 */
export function checkSemanticFlowSelectors(input: {
  nodes: SemanticArchitectureNode[];
  relations: SemanticArchitectureRelation[];
  flows: ArchitectureFlowV1[];
  evidence: ArchitectureSelectorEvidenceV1[];
}): Pick<ArchitectureFlowSelectorCheckV1, "ok" | "summary" | "selectors" | "capabilities"> {
  const stepsByKey = new Map<string, Array<{ flowId: string; stepId: string }>>();
  for (const flow of [...input.flows].sort((left, right) => left.id.localeCompare(right.id))) {
    if (flow.applicability !== "required") continue;
    for (const step of [...flow.steps, ...flow.outcomes.flatMap((outcome) => outcome.steps)]) {
      const key = evidenceSelectorKey(step.evidence);
      stepsByKey.set(key, [...stepsByKey.get(key) ?? [], { flowId: flow.id, stepId: step.id }]);
    }
  }
  const selectors = input.nodes.flatMap((node) => (node.source?.entrypoints ?? []).flatMap((entrypoint) =>
    entrypoint.symbols.flatMap((source) => source.sinks.map((sink) => {
      const key = evidenceSelectorKey({ entrypointId: entrypoint.id, sourceSymbol: source.name, sinkId: sink.id });
      const evidence = input.evidence.filter((entry) => evidenceSelectorKey(entry) === key && entry.nodeId === node.id);
      const single = evidence.length === 1 ? evidence[0] : undefined;
      return {
        nodeId: node.id,
        entrypointId: entrypoint.id,
        sourcePath: entrypoint.path,
        sourceSymbol: source.name,
        sinkId: sink.id,
        sinkPath: sink.path,
        sinkSymbol: sink.symbol,
        status: architectureSelectorProofStatus(evidence),
        callSites: single?.callSites ?? [],
        referenceSites: single?.referenceSites ?? [],
        rejectedBuiltinCallSites: single?.rejectedBuiltinCallSites ?? [],
        flowSteps: stepsByKey.get(key) ?? []
      };
    }))))
    .sort((left, right) => compareStrings(left.nodeId, right.nodeId)
      || compareStrings(left.entrypointId, right.entrypointId)
      || compareStrings(left.sourceSymbol, right.sourceSymbol)
      || compareStrings(left.sinkId, right.sinkId));
  const capabilityIds = [...new Set(input.flows.map((flow) => flow.capabilityId))].sort(compareStrings);
  const capabilities = capabilityIds.map((capabilityId) => {
    const { p2 } = compileSemanticCapabilityDiagrams({ capabilityId, nodes: input.nodes, relations: input.relations, flows: input.flows, evidence: input.evidence });
    return { capabilityId, p2Status: p2.status, diagnostics: p2.diagnostics };
  });
  const unproven = selectors.filter((selector) => selector.status !== "proven");
  return {
    ok: capabilities.every((capability) => capability.p2Status !== "unprovable"),
    summary: {
      selectors: selectors.length,
      proven: selectors.length - unproven.length,
      unproven: unproven.length,
      usedUnproven: unproven.filter((selector) => selector.flowSteps.length > 0).length
    },
    selectors,
    capabilities
  };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Exactly the per-entry facts `validateStep` reads from selector evidence: identity (node, selector
 * key parts), the truthiness of `matched`/`ambiguous`/`truncated`, and whether any call site exists.
 * Call-site paths and lines never reach a proof, so they are excluded. `referenceSites` and
 * `rejectedBuiltinCallSites` only choose between unproven statuses that map to the same
 * `selector-evidence-unmatched` diagnostic, so they are excluded too. Entries are sorted, and
 * duplicates are kept because `validateStep` treats more than one matching entry as ambiguous.
 * Keep this next to `validateStep`: a proof input added there must be added here.
 */
export function proofRelevantSelectorEvidence(evidence: readonly ArchitectureSelectorEvidenceV1[]): Json[] {
  return evidence
    .map((entry) => ({
      nodeId: entry.nodeId,
      entrypointId: entry.entrypointId,
      sourceSymbol: entry.sourceSymbol,
      sinkId: entry.sinkId,
      matched: Boolean(entry.matched),
      ambiguous: Boolean(entry.ambiguous),
      truncated: Boolean(entry.truncated),
      hasCallSites: entry.callSites.length > 0
    }))
    .map((entry) => ({ entry, key: JSON.stringify(entry) }))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
    .map(({ entry }) => entry as unknown as Json);
}

/**
 * `proofRelevantSelectorEvidence` for one capability: the entries of the selectors its flows cite
 * in a step, which are the only selector evidence its P2 proof reads (`validateStep`). Per-capability
 * proof acceptance compares the digest of this value, so a selector change in one capability never
 * stands in for an evidence change of another.
 */
export function capabilityProofRelevantSelectorEvidence(input: {
  capabilityId: string;
  flows: readonly ArchitectureFlowV1[];
  evidence: readonly ArchitectureSelectorEvidenceV1[];
}): Json[] {
  const cited = new Set(input.flows
    .filter((flow) => flow.capabilityId === input.capabilityId)
    .flatMap((flow) => flow.applicability === "required" ? [...flow.steps, ...flow.outcomes.flatMap((outcome) => outcome.steps)] : [])
    .map((step) => evidenceSelectorKey(step.evidence)));
  return proofRelevantSelectorEvidence(input.evidence.filter((entry) => cited.has(evidenceSelectorKey(entry))));
}

function architectureSelectorDeclarations(nodes: SemanticArchitectureNode[]): Array<{ key: string; nodeId: string }> {
  return nodes.flatMap((node) => (node.source?.entrypoints ?? []).flatMap((entrypoint) =>
    entrypoint.symbols.flatMap((source) => source.sinks.map((sink) => ({
      key: evidenceSelectorKey({ entrypointId: entrypoint.id, sourceSymbol: source.name, sinkId: sink.id }),
      nodeId: node.id
    })))));
}

function evidenceSelectorKey(selector: ArchitectureFlowEvidenceSelectorV1): string {
  return `${selector.entrypointId}\0${selector.sourceSymbol}\0${selector.sinkId}`;
}

function descendantNodeIds(capabilityId: string, nodes: SemanticArchitectureNode[]): Set<string> {
  const out = new Set<string>([capabilityId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parent && out.has(node.parent) && !out.has(node.id)) {
        out.add(node.id);
        changed = true;
      }
    }
  }
  return out;
}

function uniqueById<T extends { id: string }>(values: T[], kind: string): Map<string, T> {
  const out = new Map<string, T>();
  for (const value of values) {
    if (out.has(value.id)) throw new Error(`semantic-diagram-${kind.replace(/ /g, "-")}-duplicate: ${value.id}`);
    out.set(value.id, value);
  }
  return out;
}

export function renderSemanticFlowchart(nodes: SemanticP1NodeAst[], edges: SemanticP1EdgeAst[]): string {
  const ids = new Map(nodes.map((node) => [node.id, mermaidStableId("p1", node.id)]));
  return [
    "```mermaid",
    "flowchart LR",
    ...nodes.map((node) => `  ${ids.get(node.id)}[\"${escapeMermaidLabel(node.label)}\"]:::${mermaidClass(node.kind)}`),
    ...edges.map((edge) => `  ${ids.get(edge.source)} -->|\"${escapeMermaidLabel(edge.label)}\"| ${ids.get(edge.target)}`),
    "  classDef actor fill:#111827,color:#ffffff,stroke:#f9fafb,stroke-width:2px",
    "  classDef component fill:#075985,color:#ffffff,stroke:#bae6fd,stroke-width:2px",
    "  classDef datastore fill:#3f6212,color:#ffffff,stroke:#d9f99d,stroke-width:2px",
    "  classDef external fill:#7c2d12,color:#ffffff,stroke:#fed7aa,stroke-width:2px",
    "```"
  ].join("\n");
}

export function renderSemanticSequenceDiagram(diagram: SemanticP2DiagramAst): string {
  const ids = new Map(diagram.participants.map((participant) => [participant.id, mermaidStableId("p2", participant.id)]));
  const success = diagram.outcomes.filter((outcome) => outcome.kind === "success");
  const errors = diagram.outcomes.filter((outcome) => outcome.kind === "error");
  const lines = [
    "```mermaid",
    "%%{init: {\"theme\":\"base\",\"themeVariables\":{\"background\":\"#0d1117\",\"actorBkg\":\"#312e81\",\"actorBorder\":\"#c4b5fd\",\"actorTextColor\":\"#ffffff\",\"signalColor\":\"#e5e7eb\",\"signalTextColor\":\"#e5e7eb\",\"labelBoxBkgColor\":\"#4c1d95\",\"labelBoxBorderColor\":\"#c4b5fd\",\"labelTextColor\":\"#ffffff\",\"noteBkgColor\":\"#78350f\",\"noteBorderColor\":\"#fcd34d\",\"noteTextColor\":\"#ffffff\",\"sequenceNumberColor\":\"#ffffff\"}}}%%",
    "sequenceDiagram",
    "  autonumber",
    ...diagram.participants.map((participant) => `  participant ${ids.get(participant.id)} as ${escapeMermaidLabel(participant.label)}`),
    ...diagram.steps.map((step) => sequenceStep(step, ids))
  ];
  const branches = [...success, ...errors];
  branches.forEach((outcome, index) => {
    lines.push(`  ${index === 0 ? "alt" : "else"} ${escapeMermaidLabel(outcome.label)}`);
    lines.push(...outcome.steps.map((step) => sequenceStep(step, ids)));
    lines.push(`    Note over ${ids.get(outcome.terminal.participant)}: ${escapeMermaidLabel(outcome.terminal.label)}`);
  });
  if (branches.length > 0) lines.push("  end");
  lines.push("```");
  return lines.join("\n");
}

function sequenceStep(step: ArchitectureFlowStepV1, ids: Map<string, string>): string {
  return `  ${ids.get(step.from)}->>${ids.get(step.to)}: ${escapeMermaidLabel(step.label)}`;
}

function mermaidClass(kind: string): "actor" | "component" | "datastore" | "external" {
  if (kind === "datastore") return "datastore";
  if (kind === "external-system") return "external";
  if (kind === "actor") return "actor";
  return "component";
}

function mermaidStableId(prefix: string, value: string): string {
  const slug = value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "node";
  return `${prefix}_${slug}_${digestJson(value as unknown as Json).slice(7, 15)}`;
}

/**
 * Mermaid entity codes keep `"`, `#`, `;` and `,` as the model wrote them in the rendered diagram
 * (#302). One pass replaces each character once, so the `#` of an emitted code is never escaped
 * again, and a literal `#44;` in a label renders as written.
 */
function escapeMermaidLabel(value: string): string {
  return value.replace(/["#;,]/g, (character) => ({ '"': "#quot;", "#": "#35;", ";": "#59;", ",": "#44;" })[character]!);
}
