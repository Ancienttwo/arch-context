import {
  ARCHITECTURE_DEBT_SCHEMA_VERSION,
  digestJson,
  type ArchitectureDebtCheckV1,
  type ArchitectureDebtItemV1,
  type ArchitectureDebtReportV1,
  type ArchitectureFlowSelectorCheckV1,
  type CapabilityDependenciesV1,
  type DocsAnchorsReportV1,
  type Json,
  type PracticeEnforcementEvaluationV1,
  type ProjectionArchitectureDebtCoverageReasonCode,
  type ProjectionArchitectureDebtV1
} from "@archcontext/contracts";

/** The one undeclared-dependency classification, shared by projection and task debt. */
export function dependencyDebtFromMeasurement(
  measured: CapabilityDependenciesV1,
  extraReasons: ProjectionArchitectureDebtCoverageReasonCode[] = []
): ProjectionArchitectureDebtV1 {
  const coverageReasonCodes = unique([...measured.imports.reasonCodes, ...extraReasons]) as ProjectionArchitectureDebtCoverageReasonCode[];
  return {
    coverage: measured.imports.coverage === "complete" && extraReasons.length > 0 ? "partial" : measured.imports.coverage,
    coverageReasonCodes,
    items: measured.matrix.filter(cell => cell.from !== cell.to && !cell.declared)
      .map(cell => ({ reasonCode: "undeclared-dependency", fromCapabilityId: cell.from, toCapabilityId: cell.to, importEdgeCount: cell.imports }))
  };
}

export interface ArchitectureDebtEvidence {
  scope: ArchitectureDebtReportV1["scope"];
  /** Parent-chain ownership measurement; non-source and explicitly excluded paths are omitted. */
  ownership?: { path: string; nodeIds: string[]; capabilityIds: string[]; status: "unowned" | "ambiguous" }[];
  anchors?: DocsAnchorsReportV1;
  dependencies?: ProjectionArchitectureDebtV1;
  flows?: ArchitectureFlowSelectorCheckV1;
  practices?: PracticeEnforcementEvaluationV1;
  /** Producer failures name why a measurement is unavailable; never replace it with empty data. */
  unavailable?: Partial<Record<ArchitectureDebtCheckV1["check"], string[]>>;
  /** Node ids in the selected capabilities; used only to restrict an already-measured report. */
  scopedNodeIds?: string[];
  capabilityByNodeId?: ReadonlyMap<string, string>;
}

/** Pure aggregation of producer evidence. No filesystem, code parser, daemon or source stamps. */
export function evaluateArchitectureDebt(input: ArchitectureDebtEvidence): ArchitectureDebtReportV1 {
  const scope = { ...input.scope, changedPaths: unique(input.scope.changedPaths), capabilityIds: unique(input.scope.capabilityIds) };
  const repository = scope.kind === "repository";
  const paths = new Set(scope.changedPaths);
  const nodes = new Set(input.scopedNodeIds ?? []);
  const capabilities = new Set(scope.capabilityIds);
  const relevantCapability = (id: string) => repository || capabilities.has(id);
  const items = new Map<string, ArchitectureDebtItemV1>();
  const checks: ArchitectureDebtCheckV1[] = [];
  const check = (name: ArchitectureDebtCheckV1["check"], available: boolean, reasons: string[] = []) => {
    const allReasons = unique([...(input.unavailable?.[name] ?? []), ...reasons, ...(available ? [] : ["not-evaluated"])]);
    checks.push({ check: name, coverage: !available ? "unknown" : allReasons.length > 0 ? "partial" : "complete", reasonCodes: allReasons });
  };
  const add = (item: Omit<ArchitectureDebtItemV1, "id">) => {
    const normalized = { ...item, nodeIds: unique(item.nodeIds), capabilityIds: unique(item.capabilityIds), paths: unique(item.paths) };
    // Identity includes the precise subject metadata, not mutable observations such as edge count.
    const { importEdgeCount: _count, lineCount: _lines, ...identityDetails } = item.details;
    const id = `debt.${digestJson({ ...normalized, details: identityDetails } as unknown as Json).slice(7)}`;
    items.set(id, { id, ...normalized });
  };
  const capabilityIdsFor = (id: string): string[] => {
    const capability = input.capabilityByNodeId?.get(id);
    return capability === undefined ? [] : [capability];
  };

  check("ownership", input.ownership !== undefined);
  for (const owner of input.ownership ?? []) {
    if (!repository && !paths.has(owner.path)) continue;
    add({ kind: owner.status === "unowned" ? "unowned-path" : "ambiguous-owner", nodeIds: owner.nodeIds,
      capabilityIds: owner.capabilityIds, paths: [owner.path], reasonCode: owner.status === "unowned" ? "source-owner-missing" : "source-owner-contested",
      action: "archctx plan --id changeset.<id> --operations-file <ownership-operations.json>",
      details: { modelField: "source.include/source.exclude/parent", ownershipRule: "parent-chain" } });
  }

  const anchorNodes = input.anchors?.nodes.filter(node => repository || nodes.has(node.nodeId)
    || (node.documentPath !== undefined && paths.has(node.documentPath))
    || [...node.findings, ...node.unchecked].some(entry => paths.has(entry.citation.resolvedPath ?? entry.citation.path ?? ""))) ?? [];
  check("anchors", input.anchors !== undefined, anchorNodes.flatMap(node => node.unchecked.map(entry => entry.reasonCode)));
  for (const node of anchorNodes) for (const finding of node.findings) {
    const citationPath = finding.citation.resolvedPath ?? finding.citation.path;
    // An unrelated finding in the same document is not a finding for a changed cited path.
    if (!repository && !nodes.has(node.nodeId) && !paths.has(node.documentPath ?? "") && !paths.has(citationPath ?? "")) continue;
    add({ kind: "stale-anchor", nodeIds: [node.nodeId], capabilityIds: capabilityIdsFor(node.nodeId),
      paths: unique([...(citationPath ? [citationPath] : []), ...(node.documentPath ? [node.documentPath] : [])]),
      reasonCode: finding.kind, action: "archctx docs anchors --json",
      details: { origin: finding.origin.kind,
        ...(finding.origin.kind === "document" ? { documentLine: finding.origin.line } : {}),
        ...(finding.origin.kind === "node-responsibility" ? { responsibilityIndex: finding.origin.index } : {}),
        ...(finding.citation.symbol ? { symbol: finding.citation.symbol } : {}),
        ...(finding.citation.line === undefined ? {} : { citedLine: finding.citation.line }),
        ...(finding.lineCount === undefined ? {} : { lineCount: finding.lineCount }) } });
  }

  check("dependencies", input.dependencies !== undefined && input.dependencies.coverage !== "unknown", input.dependencies?.coverageReasonCodes);
  for (const dependency of input.dependencies?.coverage === "unknown" ? [] : input.dependencies?.items ?? []) {
    if (!relevantCapability(dependency.fromCapabilityId) && !relevantCapability(dependency.toCapabilityId)) continue;
    add({ kind: "undeclared-dependency", nodeIds: [], capabilityIds: [dependency.fromCapabilityId, dependency.toCapabilityId], paths: [],
      reasonCode: dependency.reasonCode, action: "archctx plan --id changeset.<id> --operations-file <relation-operations.json>",
      details: { modelField: "relations.source/target/kind", fromCapabilityId: dependency.fromCapabilityId,
        toCapabilityId: dependency.toCapabilityId, importEdgeCount: dependency.importEdgeCount } });
  }

  const flowsReady = input.flows?.codeGraph.availability === "ready";
  check("flows", flowsReady, input.flows && !flowsReady ? ["code-facts-unavailable"] : []);
  if (flowsReady) {
    for (const capability of input.flows!.capabilities) {
      if (!relevantCapability(capability.capabilityId) || capability.p2Status !== "unprovable") continue;
      if (capability.diagnostics.length === 0) throw new Error("unprovable flow evidence must include a diagnostic");
      for (const diagnostic of capability.diagnostics) add({ kind: "flow-proof-failed", nodeIds: [capability.capabilityId], capabilityIds: [capability.capabilityId], paths: [],
        reasonCode: diagnostic.code, action: "archctx flows check --json",
        details: { modelField: "flows.steps.evidence", ...(diagnostic.flowId ? { flowId: diagnostic.flowId } : {}), ...(diagnostic.stepId ? { stepId: diagnostic.stepId } : {}) } });
    }
    for (const selector of input.flows!.selectors) {
      if (selector.status === "proven") continue;
      if (!repository && !nodes.has(selector.nodeId) && !paths.has(selector.sourcePath) && !paths.has(selector.sinkPath)) continue;
      add({ kind: "flow-proof-failed", nodeIds: [selector.nodeId], capabilityIds: capabilityIdsFor(selector.nodeId), paths: [selector.sourcePath, selector.sinkPath],
        reasonCode: selector.status, action: "archctx flows check --json",
        details: { modelField: "source.entrypoints.symbols.sinks", entrypointId: selector.entrypointId, sinkId: selector.sinkId,
          sourceSymbol: selector.sourceSymbol, sinkSymbol: selector.sinkSymbol } });
    }
  }

  check("practices", input.practices !== undefined);
  for (const violation of input.practices?.violations ?? []) add({ kind: "practice-regression", nodeIds: [], capabilityIds: [], paths: [],
    reasonCode: violation.reasonCode, action: violation.remediation.action === "none" ? `archctx practices show --id ${violation.practiceId}` : violation.remediation.action,
    details: { practiceId: violation.practiceId, checkId: violation.checkId } });

  const sortedItems = [...items.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const report: Omit<ArchitectureDebtReportV1, "digest"> = { schemaVersion: ARCHITECTURE_DEBT_SCHEMA_VERSION, scope,
    coverage: checks.every(entry => entry.coverage === "complete") ? "complete" : checks.every(entry => entry.coverage === "unknown") ? "unknown" : "partial",
    coverageReasonCodes: unique(checks.flatMap(entry => entry.reasonCodes.map(reason => `${entry.check}:${reason}`))), checks, items: sortedItems,
    actionsRequired: unique(sortedItems.map(item => item.action)) };
  return { ...report, digest: digestJson(report as unknown as Json) };
}

function unique(values: readonly string[]): string[] { return [...new Set(values)].sort(); }
