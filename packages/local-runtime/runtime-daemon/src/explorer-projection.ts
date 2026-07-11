import {
  type AuthorityCursorV1,
  digestJson,
  EXPLORER_VIEW_INPUT_REQUIREMENTS,
  type ArchitectureRepositoryIdentityV1,
  type ArchitectureWorktreeIdentityV1,
  type ExplorerBacklinksV2,
  type ExplorerDeltaChangeV2,
  type ExplorerOccurrenceV2,
  type ExplorerPressureEvaluationV2,
  type ExplorerProjectionQueryV2,
  type ExplorerProjectionV2,
  type ExplorerRelationOccurrenceV2,
  type ExplorerViewIdV2,
  type Json,
  type NormalizedCodeContext,
  type ProjectionInputDomainStateV1,
  type ProjectionInputDomainV1,
  type ProjectionInputManifestV1,
  type SourceSelector
} from "@archcontext/contracts";
import { architectureLedgerStateDigest, type ArchitectureLedgerGraphState } from "@archcontext/core/architecture-ledger";

export const EXPLORER_VIEW_COMPILER_VERSION = "archcontext.explorer-view-compiler/v1" as const;

const VIEW_DEFINITIONS: Record<ExplorerViewIdV2, { id: ExplorerViewIdV2; title: string; question: string }> = {
  "system-map": { id: "system-map", title: "System Map", question: "What accepted architecture entities exist and how do they relate?" },
  "task-impact": { id: "task-impact", title: "Task Impact", question: "What architecture subjects does this current task cross or constrain?" },
  "drift-pressure": { id: "drift-pressure", title: "Drift & Pressure", question: "Where do declared and observed facts disagree or accumulate pressure?" }
};

export const SYSTEM_MAP_VIEW_DEFINITION_DIGEST = explorerViewDefinitionDigest("system-map");

export interface ExplorerResolvedBindingV2 {
  bindingId: string;
  targetEntityId: string;
  observedSymbolId: string;
  verified: boolean;
}

export interface ExplorerPressureInputV2 {
  inputDigest: string;
  level: "low" | "medium" | "high";
  score: number;
  signals: Array<{ type: string; evidence: string[] }>;
}

export interface ExplorerTaskSessionInputV2 {
  taskSessionId: string;
  task: string;
  taskSessionDigest: string;
}

export interface ExplorerEventBacklinkInputV2 {
  eventId: string;
  subjectIds: string[];
  title?: string;
  rationale?: string;
}

export interface CompileExplorerProjectionInput {
  query: ExplorerProjectionQueryV2;
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  authoritySource: "git" | "ledger";
  authorityCursor: AuthorityCursorV1 | null;
  graph: ArchitectureLedgerGraphState;
  graphDigest: string;
  evidenceStateDigest: string;
  observed: NormalizedCodeContext;
  bindings?: ExplorerResolvedBindingV2[];
  pressure?: ExplorerPressureInputV2;
  drift?: { inputDigest: string; subjectIds: string[]; reasonCodes: string[] };
  taskSession?: ExplorerTaskSessionInputV2;
  eventBacklinks?: ExplorerEventBacklinkInputV2[];
  observedAvailability?: { status: "ready" | "unavailable"; reasonCode?: string };
  tokenRequired: boolean;
}

export type CompileSystemMapProjectionInput = CompileExplorerProjectionInput;

export class ExplorerProjectionCompileError extends Error {
  constructor(readonly reason: "invalid-query" | "precondition-failed" | "incompatible-delta", message: string) {
    super(message);
    this.name = "ExplorerProjectionCompileError";
  }
}

export function compileSystemMapProjection(input: CompileSystemMapProjectionInput): ExplorerProjectionV2 {
  return compileExplorerProjection({ ...input, query: { ...input.query, viewId: "system-map" } });
}

export function compileExplorerProjection(input: CompileExplorerProjectionInput): ExplorerProjectionV2 {
  const view = VIEW_DEFINITIONS[input.query.viewId];
  const semanticLevel = input.query.semanticLevel ?? "context";
  const inputManifest = compileProjectionInputManifest(input);
  const observedFactsDigest = inputManifest.observedFactsDigest;
  const cursor = {
    repository: input.repository,
    worktree: input.worktree,
    authoritySource: input.authoritySource,
    authorityCursor: input.authorityCursor,
    inputManifestDigest: inputManifest.manifestDigest,
    compatibilityDigest: inputManifest.compatibilityDigest,
    graphDigest: input.graphDigest,
    evidenceStateDigest: input.evidenceStateDigest,
    observedFactsDigest,
    viewDefinitionDigest: explorerViewDefinitionDigest(view.id),
    compilerVersion: EXPLORER_VIEW_COMPILER_VERSION,
    observedAvailability: input.observedAvailability ?? { status: "ready" as const },
    ...(inputManifest.taskSessionDigest ? { taskSessionDigest: inputManifest.taskSessionDigest } : {})
  } as const;
  assertExpectedCursor(input.query, cursor);

  const activeEntities = input.graph.entities.filter((entity) => entity.status !== "removed").sort((a, b) => a.entityId.localeCompare(b.entityId));
  const activeEntityIds = new Set(activeEntities.map((entity) => entity.entityId));
  const observedSymbols = [...input.observed.symbols].sort((a, b) => a.id.localeCompare(b.id));
  const observedById = new Map(observedSymbols.map((symbol) => [symbol.id, symbol]));
  const validBindings = (input.bindings ?? [])
    .filter((binding) => activeEntityIds.has(binding.targetEntityId) && observedById.has(binding.observedSymbolId))
    .sort((a, b) => a.bindingId.localeCompare(b.bindingId));
  const bindingsByEntity = groupBy(validBindings, (binding) => binding.targetEntityId);
  const boundSymbolIds = new Set(validBindings.map((binding) => binding.observedSymbolId));
  const constraintsBySubject = groupBy(
    input.graph.constraints.filter((constraint) => constraint.status !== "removed").sort((a, b) => a.constraintId.localeCompare(b.constraintId)),
    (constraint) => constraint.subjectId
  );
  const eventsBySubject = new Map<string, ExplorerEventBacklinkInputV2[]>();
  for (const event of [...(input.eventBacklinks ?? [])].sort((a, b) => a.eventId.localeCompare(b.eventId))) {
    for (const subjectId of event.subjectIds) eventsBySubject.set(subjectId, [...(eventsBySubject.get(subjectId) ?? []), event]);
  }
  const driftSubjects = new Set(input.drift?.subjectIds ?? []);
  const occurrenceByEntity = new Map<string, string>();
  const occurrenceBySymbol = new Map<string, string>();

  const subjectOccurrences: ExplorerOccurrenceV2[] = activeEntities.map((entity) => {
    const occurrenceId = subjectOccurrenceId(view.id, "entity", entity.entityId);
    occurrenceByEntity.set(entity.entityId, occurrenceId);
    const entityBindings = bindingsByEntity.get(entity.entityId) ?? [];
    const symbolIds = uniqueSorted(entityBindings.map((binding) => binding.observedSymbolId));
    for (const symbolId of symbolIds) occurrenceBySymbol.set(symbolId, occurrenceId);
    const selectors = uniqueSelectors([...declaredEntitySelectors(entity), ...symbolIds.map((id) => symbolSelector(observedById.get(id)!))]);
    const pressure = pressureForOccurrence(input.pressure, [entity.entityId, ...symbolIds], selectors);
    const events = eventsBySubject.get(entity.entityId) ?? [];
    const constraints = constraintsBySubject.get(entity.entityId) ?? [];
    const authorityState = entityBindings.length > 0 ? "BOUND" as const : "DECLARED_UNOBSERVED" as const;
    const verificationStatus = driftSubjects.has(entity.entityId)
      ? "DRIFT" as const
      : entityBindings.some((binding) => binding.verified)
        ? "VERIFIED" as const
        : entityBindings.length > 0 ? "MATCHED" as const : "UNKNOWN" as const;
    return {
      occurrenceId,
      role: "subject" as const,
      subjectRefs: [{ kind: "architecture-entity" as const, id: entity.entityId }, ...symbolIds.map((id) => ({ kind: "code-symbol" as const, id }))],
      name: entity.canonicalName,
      kind: entity.kind,
      childrenCount: 0,
      expandable: false,
      verificationStatus,
      authorityState,
      pressure,
      sourceSelectors: selectors,
      provenance: { declaredEntityIds: [entity.entityId], observedSymbolIds: symbolIds, evidenceBindingIds: entityBindings.map((binding) => binding.bindingId) },
      inspector: {
        ...(entity.summary ? { summary: entity.summary } : {}),
        ...(typeof entity.metadata?.responsibility === "string" ? { responsibility: entity.metadata.responsibility } : {}),
        constraints: constraints.map((constraint) => ({ id: constraint.constraintId, kind: constraint.kind, ...(constraint.severity ? { severity: constraint.severity } : {}), ...(constraint.summary ? { summary: constraint.summary } : {}) })),
        decisions: events.filter((event) => event.rationale || event.title).map((event) => ({ eventId: event.eventId, ...(event.title ? { title: event.title } : {}), ...(event.rationale ? { rationale: event.rationale } : {}) })),
        sourceSelectors: selectors,
        evidenceBindingIds: entityBindings.map((binding) => binding.bindingId)
      },
      backlinks: emptyBacklinks({
        views: viewsForSubject(authorityState, verificationStatus, pressure, Boolean(input.taskSession && symbolIds.length > 0)),
        taskSessionIds: input.taskSession && symbolIds.length > 0 ? [input.taskSession.taskSessionId] : [],
        constraints: constraints.map((constraint) => constraint.constraintId),
        bindings: entityBindings.map((binding) => binding.bindingId),
        events: events.map((event) => event.eventId),
        decisions: events.filter((event) => event.rationale || event.title).map((event) => event.eventId)
      })
    };
  });

  for (const symbol of observedSymbols) {
    if (boundSymbolIds.has(symbol.id)) continue;
    const occurrenceId = subjectOccurrenceId(view.id, "symbol", symbol.id);
    occurrenceBySymbol.set(symbol.id, occurrenceId);
    const selectors = [symbolSelector(symbol)];
    const pressure = pressureForOccurrence(input.pressure, [symbol.id], selectors);
    subjectOccurrences.push({
      occurrenceId,
      role: "subject",
      subjectRefs: [{ kind: "code-symbol", id: symbol.id }],
      name: symbol.name,
      kind: symbol.kind,
      childrenCount: 0,
      expandable: false,
      verificationStatus: "UNKNOWN",
      authorityState: "UNBOUND_OBSERVED",
      pressure,
      sourceSelectors: selectors,
      provenance: { declaredEntityIds: [], observedSymbolIds: [symbol.id], evidenceBindingIds: [] },
      inspector: { constraints: [], decisions: [], sourceSelectors: selectors, evidenceBindingIds: [] },
      backlinks: emptyBacklinks({
        views: viewsForSubject("UNBOUND_OBSERVED", "UNKNOWN", pressure, Boolean(input.taskSession)),
        taskSessionIds: input.taskSession ? [input.taskSession.taskSessionId] : []
      })
    });
  }
  subjectOccurrences.sort((a, b) => a.occurrenceId.localeCompare(b.occurrenceId));

  const relations = buildRelations(input, occurrenceByEntity, occurrenceBySymbol);
  attachRelationBacklinks(subjectOccurrences, relations);
  const viewSubjects = filterSubjectsForView(subjectOccurrences, input.query.viewId);
  const viewSubjectIds = new Set(viewSubjects.map((occurrence) => occurrence.occurrenceId));
  const viewRelations = relations.filter((relation) => viewSubjectIds.has(relation.sourceOccurrenceId) && viewSubjectIds.has(relation.targetOccurrenceId));
  const withGroups = semanticLevel === "overview" ? overviewGroups(view.id, viewSubjects, input.query.expandedOccurrenceIds ?? []) : viewSubjects;
  const scopedOccurrenceIds = selectScopedOccurrenceIds(withGroups, viewRelations, input.query);
  const scopedOccurrences = withGroups.filter((occurrence) => scopedOccurrenceIds.has(occurrence.occurrenceId));
  const returnedOccurrences = scopedOccurrences.slice(0, input.query.budget.maxNodes);
  const returnedOccurrenceIds = new Set(returnedOccurrences.map((occurrence) => occurrence.occurrenceId));
  const scopedRelations = viewRelations.filter((relation) => scopedOccurrenceIds.has(relation.sourceOccurrenceId) && scopedOccurrenceIds.has(relation.targetOccurrenceId));
  const returnedRelations = scopedRelations
    .filter((relation) => returnedOccurrenceIds.has(relation.sourceOccurrenceId) && returnedOccurrenceIds.has(relation.targetOccurrenceId))
    .slice(0, input.query.budget.maxRelations);
  const focus = input.query.focus ? returnedOccurrences.find((occurrence) => occurrence.role === "subject" && occurrence.subjectRefs.some((ref) => ref.id === input.query.focus!.subjectId)) : undefined;
  const page = {
    budget: { ...input.query.budget },
    totalNodes: scopedOccurrences.length,
    totalRelations: scopedRelations.length,
    returnedNodes: returnedOccurrences.length,
    returnedRelations: returnedRelations.length,
    truncated: returnedOccurrences.length < scopedOccurrences.length || returnedRelations.length < scopedRelations.length,
    omittedNodeCount: scopedOccurrences.length - returnedOccurrences.length,
    omittedRelationCount: scopedRelations.length - returnedRelations.length
  };
  const projectionWithoutDigest = {
    schemaVersion: "archcontext.explorer-projection/v2" as const,
    view,
    availableViews: availableViews(input),
    semanticLevel,
    breadcrumbs: focus ? [...(focus.parentOccurrenceId ? [{ occurrenceId: focus.parentOccurrenceId, label: "Overview" }] : []), { occurrenceId: focus.occurrenceId, label: focus.name }] : [],
    cursor,
    inputManifest,
    occurrences: returnedOccurrences,
    relations: returnedRelations,
    page,
    capabilities: { readOnly: true as const, mutationMode: "forbidden" as const, egress: "none" as const, tokenRequired: input.tokenRequired }
  };
  return { ...projectionWithoutDigest, projectionDigest: digestJson(projectionWithoutDigest as unknown as Json) };
}

export function compileExplorerProjectionChanges(base: ExplorerProjectionV2, head: ExplorerProjectionV2): ExplorerDeltaChangeV2[] {
  assertDeltaCompatible(base, head);
  const changes: ExplorerDeltaChangeV2[] = [];
  const baseSubjects = subjectStateByCanonicalId(base);
  const headSubjects = subjectStateByCanonicalId(head);
  for (const id of uniqueSorted([...baseSubjects.keys(), ...headSubjects.keys()])) {
    const before = baseSubjects.get(id);
    const after = headSubjects.get(id);
    if (!before || !after) {
      changes.push({ deltaClass: "projection", subjectId: id, change: before ? "removed" : "added", fields: ["subject"] });
      continue;
    }
    const projectionFields = changedFields(
      { fact: before.fact, evidence: before.evidence, projection: before.projection } as unknown as Json,
      { fact: after.fact, evidence: after.evidence, projection: after.projection } as unknown as Json
    );
    if (projectionFields.length > 0) changes.push({ deltaClass: "projection", subjectId: id, change: "changed", fields: projectionFields });
  }
  const baseRelations = relationStateByCanonicalId(base);
  const headRelations = relationStateByCanonicalId(head);
  for (const id of uniqueSorted([...baseRelations.keys(), ...headRelations.keys()])) {
    const before = baseRelations.get(id);
    const after = headRelations.get(id);
    if (!before || !after) {
      changes.push({ deltaClass: "projection", subjectId: id, change: before ? "removed" : "added", fields: ["relation"] });
      continue;
    }
    const projectionFields = changedFields(
      { fact: before.fact, evidence: before.evidence, projection: before.projection } as unknown as Json,
      { fact: after.fact, evidence: after.evidence, projection: after.projection } as unknown as Json
    );
    if (projectionFields.length > 0) changes.push({ deltaClass: "projection", subjectId: id, change: "changed", fields: projectionFields });
  }
  if (base.semanticLevel !== head.semanticLevel) changes.push({ deltaClass: "projection", subjectId: "projection", change: "changed", fields: ["semanticLevel"] });
  changes.sort((a, b) => `${a.deltaClass}:${a.subjectId}`.localeCompare(`${b.deltaClass}:${b.subjectId}`));
  return changes;
}

function assertQuery(input: CompileExplorerProjectionInput): void {
  const query = input.query;
  if (query.schemaVersion !== "archcontext.explorer-projection-query/v2" || !VIEW_DEFINITIONS[query.viewId]) throw new ExplorerProjectionCompileError("invalid-query", `unsupported Explorer view: ${query.viewId}`);
  if (!Number.isInteger(query.depth) || query.depth < 0 || query.depth > 2) throw new ExplorerProjectionCompileError("invalid-query", "Explorer depth must be an integer from 0 to 2");
  if (!Number.isInteger(query.budget.maxNodes) || query.budget.maxNodes < 1 || query.budget.maxNodes > 1000) throw new ExplorerProjectionCompileError("invalid-query", "Explorer maxNodes must be an integer from 1 to 1000");
  if (!Number.isInteger(query.budget.maxRelations) || query.budget.maxRelations < 0 || query.budget.maxRelations > 5000) throw new ExplorerProjectionCompileError("invalid-query", "Explorer maxRelations must be an integer from 0 to 5000");
  if (query.viewId === "task-impact" && !query.taskSessionId) {
    throw new ExplorerProjectionCompileError("precondition-failed", "required-input-unavailable:task-session:task-session-id-missing");
  }
  if (query.viewId === "task-impact" && input.taskSession && query.taskSessionId !== input.taskSession.taskSessionId) {
    throw new ExplorerProjectionCompileError("precondition-failed", "required-input-mismatch:task-session");
  }
}

function assertExpectedCursor(query: ExplorerProjectionQueryV2, actual: Pick<ExplorerProjectionV2["cursor"], "worktree" | "graphDigest" | "observedFactsDigest">): void {
  const expected = query.expectedCursor;
  if (!expected) return;
  const mismatches = [
    expected.headSha !== actual.worktree.headSha ? "headSha" : "",
    expected.worktreeDigest !== actual.worktree.worktreeDigest ? "worktreeDigest" : "",
    expected.graphDigest !== actual.graphDigest ? "graphDigest" : "",
    expected.observedFactsDigest !== undefined && expected.observedFactsDigest !== actual.observedFactsDigest ? "observedFactsDigest" : ""
  ].filter(Boolean);
  if (mismatches.length > 0) throw new ExplorerProjectionCompileError("precondition-failed", `Explorer cursor changed: ${mismatches.join(", ")}`);
}

function assertDeltaCompatible(base: ExplorerProjectionV2, head: ExplorerProjectionV2): void {
  const incompatible = [
    base.cursor.repository.storageRepositoryId !== head.cursor.repository.storageRepositoryId ? "repository" : "",
    base.cursor.worktree.storageWorkspaceId !== head.cursor.worktree.storageWorkspaceId ? "worktree" : "",
    base.cursor.compatibilityDigest !== head.cursor.compatibilityDigest ? "manifest" : "",
    base.cursor.compilerVersion !== head.cursor.compilerVersion ? "compilerVersion" : "",
    base.cursor.viewDefinitionDigest !== head.cursor.viewDefinitionDigest ? "viewDefinition" : "",
    base.view.id !== head.view.id ? "view" : ""
  ].filter(Boolean);
  if (incompatible.length > 0) throw new ExplorerProjectionCompileError("incompatible-delta", `incompatible Explorer delta: ${incompatible.join(", ")}`);
}

function explorerProjectionQueryDigest(query: ExplorerProjectionQueryV2): string {
  return digestJson({
    schemaVersion: query.schemaVersion,
    viewId: query.viewId,
    semanticLevel: query.semanticLevel ?? "context",
    taskSessionId: query.taskSessionId ?? null,
    focus: query.focus ?? null,
    expandedOccurrenceIds: uniqueSorted(query.expandedOccurrenceIds ?? []),
    depth: query.depth,
    budget: query.budget
  } as unknown as Json);
}

export function compileProjectionInputManifest(input: CompileExplorerProjectionInput): ProjectionInputManifestV1 {
  assertQuery(input);
  assertAuthorityBinding(input);
  if (input.observedAvailability?.status === "unavailable") {
    throw new ExplorerProjectionCompileError(
      "precondition-failed",
      `required-input-unavailable:observed:${input.observedAvailability.reasonCode ?? "unavailable"}`
    );
  }
  const actualGraphDigest = architectureLedgerStateDigest(input.graph);
  if (actualGraphDigest !== input.graphDigest) {
    throw new ExplorerProjectionCompileError("precondition-failed", "required-input-digest-mismatch:graph");
  }
  const observedFactsDigest = canonicalObservedFactsDigest(input.observed);
  const queryDigest = explorerProjectionQueryDigest(input.query);
  const viewDigest = explorerViewDefinitionDigest(input.query.viewId);
  const bindingsDigest = input.bindings === undefined ? null : digestJson([...input.bindings].sort((a, b) => a.bindingId.localeCompare(b.bindingId)) as unknown as Json);
  const eventBacklinksDigest = input.eventBacklinks === undefined ? null : digestJson([...input.eventBacklinks]
    .map((event) => ({ ...event, subjectIds: uniqueSorted(event.subjectIds) }))
    .sort((a, b) => a.eventId.localeCompare(b.eventId)) as unknown as Json);
  const driftDigest = input.drift ? digestJson(input.drift as unknown as Json) : null;
  const pressureDigest = input.pressure ? digestJson(input.pressure as unknown as Json) : null;
  const taskSessionDigest = input.taskSession ? digestJson(input.taskSession as unknown as Json) : null;
  const requirements = EXPLORER_VIEW_INPUT_REQUIREMENTS[input.query.viewId];
  const authorityDigest = digestJson({
    source: input.authoritySource,
    repository: input.repository,
    worktree: input.worktree,
    cursor: input.authorityCursor,
    graphDigest: input.graphDigest,
    evidenceStateDigest: input.evidenceStateDigest
  } as unknown as Json);
  const inputDomains: ProjectionInputManifestV1["inputDomains"] = {
    authority: projectionInputDomain("authority", requirements.authority, authorityDigest),
    graph: projectionInputDomain("graph", requirements.graph, actualGraphDigest),
    evidence: projectionInputDomain("evidence", requirements.evidence, input.evidenceStateDigest),
    observed: projectionInputDomain("observed", requirements.observed, observedFactsDigest),
    bindings: projectionInputDomain("bindings", requirements.bindings, bindingsDigest),
    "event-backlinks": projectionInputDomain("event-backlinks", requirements["event-backlinks"], eventBacklinksDigest),
    drift: projectionInputDomain("drift", requirements.drift, driftDigest),
    pressure: projectionInputDomain("pressure", requirements.pressure, pressureDigest),
    "task-session": projectionInputDomain("task-session", requirements["task-session"], taskSessionDigest)
  };
  const compatibilityDigest = digestJson({
    repository: input.repository.storageRepositoryId,
    worktree: input.worktree.storageWorkspaceId,
    queryDigest,
    viewDefinitionDigest: viewDigest,
    compilerVersion: EXPLORER_VIEW_COMPILER_VERSION
  } as unknown as Json);
  const manifestWithoutDigest = {
    schemaVersion: "archcontext.projection-input-manifest/v1" as const,
    repository: input.repository,
    worktree: input.worktree,
    authoritySource: input.authoritySource,
    authorityCursor: input.authorityCursor,
    queryDigest,
    graphDigest: input.graphDigest,
    evidenceStateDigest: input.evidenceStateDigest,
    observedFactsDigest,
    observedAvailability: input.observedAvailability ?? { status: "ready" as const },
    bindingsDigest: bindingsDigest!,
    eventBacklinksDigest: eventBacklinksDigest ?? digestJson([] as unknown as Json),
    driftDigest,
    pressureDigest,
    taskSessionDigest,
    inputDomains,
    viewDefinitionDigest: viewDigest,
    compilerVersion: EXPLORER_VIEW_COMPILER_VERSION,
    tokenRequired: input.tokenRequired,
    compatibilityDigest
  };
  const manifest = {
    ...manifestWithoutDigest,
    manifestDigest: digestJson(manifestWithoutDigest as unknown as Json)
  };
  assertExpectedCursor(input.query, {
    worktree: input.worktree,
    graphDigest: input.graphDigest,
    observedFactsDigest
  });
  return manifest;
}

function assertAuthorityBinding(input: CompileExplorerProjectionInput): void {
  if (input.authoritySource === "git") {
    if (input.authorityCursor !== null) {
      throw new ExplorerProjectionCompileError("precondition-failed", "authority-source-cursor-mismatch:git");
    }
    return;
  }
  const cursor = input.authorityCursor;
  if (cursor === null) {
    throw new ExplorerProjectionCompileError("precondition-failed", "required-input-unavailable:authority:ledger-cursor-not-provided");
  }
  if (
    digestJson(cursor.repository as unknown as Json) !== digestJson(input.repository as unknown as Json)
    || digestJson(cursor.worktree as unknown as Json) !== digestJson(input.worktree as unknown as Json)
    || cursor.graphDigest !== input.graphDigest
    || cursor.evidenceStateDigest !== input.evidenceStateDigest
  ) {
    throw new ExplorerProjectionCompileError("precondition-failed", "required-input-digest-mismatch:authority");
  }
}

function projectionInputDomain(
  domain: ProjectionInputDomainV1,
  requirement: ProjectionInputDomainStateV1["requirement"],
  digest: string | null
): ProjectionInputDomainStateV1 {
  if (requirement === "not-used") return { requirement, status: "not-used", digest: null };
  if (digest === null) {
    if (requirement === "required") {
      throw new ExplorerProjectionCompileError("precondition-failed", `required-input-unavailable:${domain}:not-provided`);
    }
    return { requirement, status: "unavailable", digest: null, reasonCode: "not-provided" };
  }
  return { requirement, status: "ready", digest };
}

function buildRelations(input: CompileExplorerProjectionInput, byEntity: Map<string, string>, bySymbol: Map<string, string>): ExplorerRelationOccurrenceV2[] {
  const relations: ExplorerRelationOccurrenceV2[] = [];
  for (const relation of input.graph.relations.filter((item) => item.status !== "removed").sort((a, b) => a.relationId.localeCompare(b.relationId))) {
    const source = byEntity.get(relation.sourceEntityId);
    const target = byEntity.get(relation.targetEntityId);
    if (!source || !target) continue;
    relations.push({ occurrenceId: relationOccurrenceId(input.query.viewId, "declared", relation.relationId), sourceOccurrenceId: source, targetOccurrenceId: target, kind: relation.kind, verificationStatus: "UNKNOWN", provenance: { declaredRelationIds: [relation.relationId], observedEdgeIds: [], evidenceBindingIds: [] } });
  }
  for (const edge of [...input.observed.edges].sort(compareObservedEdges)) {
    const source = bySymbol.get(edge.source);
    const target = bySymbol.get(edge.target);
    if (!source || !target) continue;
    const edgeId = `observed-edge.${digestJson(edge as unknown as Json).slice(-16)}`;
    relations.push({ occurrenceId: relationOccurrenceId(input.query.viewId, "observed", edgeId), sourceOccurrenceId: source, targetOccurrenceId: target, kind: edge.kind, verificationStatus: "UNKNOWN", provenance: { declaredRelationIds: [], observedEdgeIds: [edgeId], evidenceBindingIds: [] } });
  }
  return relations.sort((a, b) => a.occurrenceId.localeCompare(b.occurrenceId));
}

function attachRelationBacklinks(occurrences: ExplorerOccurrenceV2[], relations: ExplorerRelationOccurrenceV2[]): void {
  const byId = new Map(occurrences.filter((item) => item.role === "subject").map((item) => [item.occurrenceId, item]));
  for (const relation of relations) {
    const source = byId.get(relation.sourceOccurrenceId);
    const target = byId.get(relation.targetOccurrenceId);
    if (source?.role === "subject") source.backlinks.outgoingRelationIds.push(...relation.provenance.declaredRelationIds, ...relation.provenance.observedEdgeIds);
    if (target?.role === "subject") target.backlinks.incomingRelationIds.push(...relation.provenance.declaredRelationIds, ...relation.provenance.observedEdgeIds);
  }
  for (const occurrence of byId.values()) {
    occurrence.backlinks.incomingRelationIds = uniqueSorted(occurrence.backlinks.incomingRelationIds);
    occurrence.backlinks.outgoingRelationIds = uniqueSorted(occurrence.backlinks.outgoingRelationIds);
  }
}

function filterSubjectsForView(occurrences: ExplorerOccurrenceV2[], view: ExplorerViewIdV2): ExplorerOccurrenceV2[] {
  if (view === "system-map") return occurrences;
  if (view === "task-impact") return occurrences.filter((item) => item.role === "subject" && item.backlinks.affectedByTaskSessionIds.length > 0);
  return occurrences.filter((item) => item.role === "subject" && (item.verificationStatus === "DRIFT" || item.pressure.score! > 0 || item.authorityState !== "BOUND"));
}

function overviewGroups(view: ExplorerViewIdV2, subjects: ExplorerOccurrenceV2[], expanded: string[]): ExplorerOccurrenceV2[] {
  const groups = groupBy(subjects.filter((item) => item.role === "subject"), (item) => item.kind);
  const output: ExplorerOccurrenceV2[] = [];
  for (const [kind, children] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const occurrenceId = `occurrence.${view}.group.kind.${kind}`;
    output.push({ occurrenceId, role: "derived-group", subjectRefs: [], name: kind, kind: "derived-group", childrenCount: children.length, expandable: children.length > 0, verificationStatus: "UNKNOWN", authorityState: "DERIVED", pressure: { evaluated: false, signals: [] }, sourceSelectors: [], provenance: { declaredEntityIds: [], observedSymbolIds: [], evidenceBindingIds: [] }, derivation: { ruleId: "group-by-kind", inputDigest: digestJson(children.map((child) => child.occurrenceId) as unknown as Json), compilerVersion: EXPLORER_VIEW_COMPILER_VERSION } });
    if (expanded.includes(occurrenceId)) output.push(...children.map((child) => ({ ...child, parentOccurrenceId: occurrenceId })));
  }
  return output;
}

function selectScopedOccurrenceIds(occurrences: ExplorerOccurrenceV2[], relations: ExplorerRelationOccurrenceV2[], query: ExplorerProjectionQueryV2): Set<string> {
  const byId = new Map(occurrences.map((occurrence) => [occurrence.occurrenceId, occurrence]));
  const seeds = new Set<string>();
  if (query.focus) {
    const match = occurrences.find((occurrence) => occurrence.role === "subject" && occurrence.subjectRefs.some((subject) => subject.id === query.focus!.subjectId));
    if (!match) throw new ExplorerProjectionCompileError("invalid-query", `Explorer focus subject not found: ${query.focus.subjectId}`);
    seeds.add(match.occurrenceId);
  }
  for (const id of query.expandedOccurrenceIds ?? []) {
    if (!byId.has(id)) throw new ExplorerProjectionCompileError("invalid-query", `Explorer occurrence not found: ${id}`);
  }
  if (seeds.size === 0) return new Set(byId.keys());
  const selected = new Set(seeds);
  let frontier = [...seeds].sort();
  for (let depth = 0; depth < query.depth; depth += 1) {
    const next = new Set<string>();
    for (const id of frontier) for (const relation of relations) {
      if (relation.sourceOccurrenceId === id && !selected.has(relation.targetOccurrenceId)) next.add(relation.targetOccurrenceId);
      if (relation.targetOccurrenceId === id && !selected.has(relation.sourceOccurrenceId)) next.add(relation.sourceOccurrenceId);
    }
    frontier = [...next].sort();
    for (const id of frontier) selected.add(id);
  }
  return selected;
}

function availableViews(input: CompileExplorerProjectionInput): ExplorerProjectionV2["availableViews"] {
  return [
    { id: "system-map", enabled: true },
    input.taskSession && input.observedAvailability?.status !== "unavailable" ? { id: "task-impact", enabled: true } : { id: "task-impact", enabled: false, reason: "current task session and observed facts required" },
    input.pressure && input.drift ? { id: "drift-pressure", enabled: true } : { id: "drift-pressure", enabled: false, reason: "evaluated drift and pressure inputs required" }
  ];
}

function viewsForSubject(authorityState: "BOUND" | "UNBOUND_OBSERVED" | "DECLARED_UNOBSERVED", verificationStatus: "MATCHED" | "DRIFT" | "UNKNOWN" | "VERIFIED", pressure: ExplorerPressureEvaluationV2, taskAffected: boolean): ExplorerViewIdV2[] {
  return ["system-map", ...(taskAffected ? ["task-impact" as const] : []), ...(verificationStatus === "DRIFT" || (pressure.score ?? 0) > 0 || authorityState !== "BOUND" ? ["drift-pressure" as const] : [])];
}

function emptyBacklinks(input: { views?: ExplorerViewIdV2[]; taskSessionIds?: string[]; constraints?: string[]; bindings?: string[]; events?: string[]; decisions?: string[] } = {}): ExplorerBacklinksV2 {
  return { appearsInViews: input.views ?? ["system-map"], affectedByTaskSessionIds: input.taskSessionIds ?? [], constrainedByIds: input.constraints ?? [], evidencedByBindingIds: input.bindings ?? [], changedByEventIds: input.events ?? [], decidedByEventIds: input.decisions ?? [], incomingRelationIds: [], outgoingRelationIds: [] };
}

function pressureForOccurrence(pressure: ExplorerPressureInputV2 | undefined, subjects: string[], selectors: SourceSelector[]): ExplorerPressureEvaluationV2 {
  if (!pressure) return { evaluated: false, signals: [] };
  const keys = new Set([...subjects, ...selectors.map((selector) => selector.path)]);
  const signals = pressure.signals.filter((signal) => signal.evidence.some((item) => keys.has(item)));
  const score = signals.length === 0 ? 0 : Math.min(100, signals.length * 25);
  const level = score >= 60 ? "high" : score >= 30 ? "medium" : "low";
  return { evaluated: true, level, score, signals: signals.map((signal) => signal.type).sort(), inputDigest: pressure.inputDigest };
}

function subjectStateByCanonicalId(projection: ExplorerProjectionV2) {
  const result = new Map<string, { fact: Json; evidence: Json; projection: Json; verificationStatus: "MATCHED" | "DRIFT" | "UNKNOWN" | "VERIFIED" }>();
  for (const occurrence of projection.occurrences) {
    if (occurrence.role !== "subject") continue;
    const canonical = occurrence.subjectRefs.find((ref) => ref.kind === "architecture-entity") ?? occurrence.subjectRefs[0];
    if (!canonical) continue;
    result.set(`${canonical.kind}:${canonical.id}`, {
      fact: { subjectRefs: occurrence.subjectRefs.filter((ref) => ref.kind.startsWith("architecture-")), name: occurrence.name, kind: occurrence.kind, summary: occurrence.inspector.summary ?? null, responsibility: occurrence.inspector.responsibility ?? null, constraints: occurrence.inspector.constraints } as unknown as Json,
      evidence: { observedSymbolIds: occurrence.provenance.observedSymbolIds, evidenceBindingIds: occurrence.provenance.evidenceBindingIds, authorityState: occurrence.authorityState, verificationStatus: occurrence.verificationStatus, pressure: occurrence.pressure } as unknown as Json,
      projection: { occurrenceId: occurrence.occurrenceId, parentOccurrenceId: occurrence.parentOccurrenceId ?? null } as unknown as Json,
      verificationStatus: occurrence.verificationStatus
    });
  }
  return result;
}

function relationStateByCanonicalId(projection: ExplorerProjectionV2) {
  const result = new Map<string, { fact: Json; evidence: Json; projection: Json }>();
  for (const relation of projection.relations) {
    const declaredId = relation.provenance.declaredRelationIds[0];
    const observedId = relation.provenance.observedEdgeIds[0];
    const id = declaredId ? `architecture-relation:${declaredId}` : observedId ? `observed-edge:${observedId}` : `projection-relation:${relation.occurrenceId}`;
    result.set(id, {
      fact: { kind: relation.kind, sourceOccurrenceId: relation.sourceOccurrenceId, targetOccurrenceId: relation.targetOccurrenceId, declaredRelationIds: relation.provenance.declaredRelationIds } as unknown as Json,
      evidence: { kind: relation.kind, sourceOccurrenceId: relation.sourceOccurrenceId, targetOccurrenceId: relation.targetOccurrenceId, observedEdgeIds: relation.provenance.observedEdgeIds, evidenceBindingIds: relation.provenance.evidenceBindingIds, verificationStatus: relation.verificationStatus } as unknown as Json,
      projection: { occurrenceId: relation.occurrenceId } as unknown as Json
    });
  }
  return result;
}

function changedFields(before: Json, after: Json): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (!isRecord(before) || !isRecord(after)) return ["value"];
  return uniqueSorted([...Object.keys(before), ...Object.keys(after)].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])));
}

function canonicalObservedFactsDigest(observed: NormalizedCodeContext): string {
  return digestJson({ digest: observed.digest, symbols: [...observed.symbols].sort((a, b) => a.id.localeCompare(b.id)), edges: [...observed.edges].sort(compareObservedEdges), evidence: observed.evidence.map((item) => ({ id: item.id, selector: item.selector, confidence: item.confidence, snapshot: item.snapshot })).sort((a, b) => a.id.localeCompare(b.id)) } as unknown as Json);
}

export function explorerViewDefinitionDigest(
  viewId: ExplorerViewIdV2,
  requirements: Record<ProjectionInputDomainV1, ProjectionInputDomainStateV1["requirement"]> = EXPLORER_VIEW_INPUT_REQUIREMENTS[viewId]
): string {
  return digestJson({ ...VIEW_DEFINITIONS[viewId], requirements, compilerVersion: EXPLORER_VIEW_COMPILER_VERSION, grouping: "kind-at-overview", authority: "daemon-selected-read-model", reconciliation: "accepted-evidence-binding-only" } as unknown as Json);
}

function declaredEntitySelectors(entity: ArchitectureLedgerGraphState["entities"][number]): SourceSelector[] {
  const selectors: SourceSelector[] = [];
  if (entity.path) selectors.push({ path: entity.path });
  const declared = entity.metadata?.declared;
  if (!declared || typeof declared !== "object" || Array.isArray(declared)) return selectors;
  const source = (declared as Record<string, Json>).source;
  if (!source || typeof source !== "object" || Array.isArray(source)) return selectors;
  const include = (source as Record<string, Json>).include;
  if (Array.isArray(include)) for (const path of include) if (typeof path === "string") selectors.push({ path });
  return selectors;
}

function symbolSelector(symbol: NormalizedCodeContext["symbols"][number]): SourceSelector {
  return { path: symbol.path, symbolId: symbol.id, ...(symbol.range ? { startLine: symbol.range.startLine, endLine: symbol.range.endLine } : {}) };
}

function uniqueSelectors(selectors: SourceSelector[]): SourceSelector[] {
  const byKey = new Map(selectors.map((selector) => [JSON.stringify(selector), selector]));
  return [...byKey.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function subjectOccurrenceId(view: ExplorerViewIdV2, authority: "entity" | "symbol", id: string): string { return `occurrence.${view}.${authority}.${id}`; }
function relationOccurrenceId(view: ExplorerViewIdV2, authority: "declared" | "observed", id: string): string { return `occurrence.${view}.relation.${authority}.${id}`; }
function compareObservedEdges(a: NormalizedCodeContext["edges"][number], b: NormalizedCodeContext["edges"][number]): number { return `${a.source}:${a.kind}:${a.target}:${a.confidence}`.localeCompare(`${b.source}:${b.kind}:${b.target}:${b.confidence}`); }
function uniqueSorted(values: Iterable<string>): string[] { return [...new Set(values)].sort(); }
function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> { const result = new Map<string, T[]>(); for (const item of items) result.set(key(item), [...(result.get(key(item)) ?? []), item]); return result; }
function isRecord(value: Json): value is Record<string, Json> { return value !== null && typeof value === "object" && !Array.isArray(value); }
