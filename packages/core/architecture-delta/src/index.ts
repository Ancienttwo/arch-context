import {
  ARCHITECTURE_CANDIDATE_DELTA_SCHEMA_VERSION,
  ARCHITECTURE_SUBJECT_SELECTOR_SCHEMA_VERSION,
  EVIDENCE_BINDING_SCHEMA_VERSION,
  EVIDENCE_ITEM_SCHEMA_VERSION,
  architectureCandidateDeltaDigest,
  architectureSubjectSelectorDigest,
  digestJson,
  isRepoRelativePosixPath,
  type ArchitectureCandidateChangeKind,
  type ArchitectureCandidateChangeTargetKind,
  type ArchitectureCandidateChangeV1,
  type ArchitectureCandidateDeltaV1,
  type ArchitectureCodeChangeKind,
  type ArchitectureDeclaredTargetKind,
  type ArchitectureDeltaChangedSubjectV1,
  type ArchitectureDeltaInterpretationKind,
  type ArchitectureDeltaInterpretationV1,
  type ArchitectureDeltaMappingAmbiguityReason,
  type ArchitectureDeltaMappingAmbiguityV1,
  type ArchitectureDeltaDeclaredSubjectMappingV1,
  type ArchitectureDeltaMappingMatchReason,
  type ArchitectureDeltaRawFactKind,
  type ArchitectureDeltaRawFactV1,
  type ArchitectureRepositoryIdentityV1,
  type ArchitectureSubjectSelectorKind,
  type ArchitectureSubjectSelectorV1,
  type ArchitectureWorktreeIdentityV1,
  type EvidenceBindingV1,
  type EvidenceItemV2,
  type Json,
  type LedgerProvenanceV1,
  type NormalizedCodeContext,
  type NormalizedEdge,
  type NormalizedSymbol
} from "@archcontext/contracts";

export type ArchitectureDeltaGitChangeSource = "commit" | "staged" | "worktree";
export type ArchitectureDeltaGitPathStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechanged"
  | "unmerged"
  | "unknown";

export interface ArchitectureDeltaGitPathChange {
  path: string;
  previousPath?: string;
  status: ArchitectureDeltaGitPathStatus;
  rawStatus: string;
}

export interface ArchitectureDeltaGitChangeMetadata {
  schemaVersion: "archcontext.git-change-metadata/v1";
  source: ArchitectureDeltaGitChangeSource;
  baseSha?: string;
  headSha: string;
  paths: ArchitectureDeltaGitPathChange[];
  pathCount: number;
  metadataDigest: string;
}

export interface ArchitectureDeltaDeclaredEntity {
  entityId: string;
  kind: string;
  canonicalName: string;
  status: "active" | "deprecated" | "removed";
  path?: string;
  summary?: string;
  metadata?: Record<string, Json>;
}

export interface ArchitectureDeltaDeclaredRelation {
  relationId: string;
  kind: string;
  sourceEntityId: string;
  targetEntityId: string;
  status: "active" | "deprecated" | "removed";
  summary?: string;
  metadata?: Record<string, Json>;
}

export interface ArchitectureDeltaDeclaredConstraint {
  constraintId: string;
  kind: string;
  subjectId: string;
  status: "active" | "deprecated" | "removed";
  severity?: "notice" | "warning" | "error" | "critical";
  summary?: string;
  metadata?: Record<string, Json>;
}

export interface ArchitectureDeltaDeclaredGraph {
  entities: ArchitectureDeltaDeclaredEntity[];
  relations: ArchitectureDeltaDeclaredRelation[];
  constraints: ArchitectureDeltaDeclaredConstraint[];
}

export interface BuildArchitectureCandidateDeltaInput {
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  git: ArchitectureDeltaGitChangeMetadata;
  codeContext: NormalizedCodeContext;
  declaredGraph?: ArchitectureDeltaDeclaredGraph;
  codeFactsDigest?: string;
  createdAt?: string;
  provenance?: Partial<LedgerProvenanceV1>;
}

interface MutableBuildState {
  selectors: Map<string, ArchitectureSubjectSelectorV1>;
  rawFacts: Map<string, ArchitectureDeltaRawFactV1>;
  evidenceItems: Map<string, EvidenceItemV2>;
  evidenceBindings: Map<string, EvidenceBindingV1>;
  changedSubjects: Map<string, ArchitectureDeltaChangedSubjectV1>;
  interpretations: Map<string, ArchitectureDeltaInterpretationV1>;
  declaredSubjectMappings: Map<string, ArchitectureDeltaDeclaredSubjectMappingV1>;
  mappingAmbiguities: Map<string, ArchitectureDeltaMappingAmbiguityV1>;
  candidateChanges: Map<string, ArchitectureCandidateChangeV1>;
}

interface MappingCandidate {
  target: {
    kind: ArchitectureDeclaredTargetKind;
    id: string;
  };
  matchReason: ArchitectureDeltaMappingMatchReason;
  confidence: "low" | "medium" | "high";
  score: number;
}

const DEFAULT_CREATED_AT = "1970-01-01T00:00:00.000Z";

export function buildArchitectureCandidateDelta(input: BuildArchitectureCandidateDeltaInput): ArchitectureCandidateDeltaV1 {
  const createdAt = input.createdAt ?? DEFAULT_CREATED_AT;
  const codeFactsDigest = input.codeFactsDigest ?? input.codeContext.digest;
  const inputDigest = digestJson({
    repository: input.repository,
    worktree: input.worktree,
    git: input.git,
    codeFactsDigest,
    codeContextDigest: input.codeContext.digest
  } as unknown as Json);
  const provenance: LedgerProvenanceV1 = {
    producer: input.provenance?.producer ?? "architecture-delta",
    command: input.provenance?.command ?? "buildArchitectureCandidateDelta",
    inputDigest,
    traceDigest: input.provenance?.traceDigest
  };
  const state: MutableBuildState = {
    selectors: new Map(),
    rawFacts: new Map(),
    evidenceItems: new Map(),
    evidenceBindings: new Map(),
    changedSubjects: new Map(),
    interpretations: new Map(),
    declaredSubjectMappings: new Map(),
    mappingAmbiguities: new Map(),
    candidateChanges: new Map()
  };
  const normalizedPathChanges = normalizePathChanges(input.git.paths);
  const changeByPath = new Map(normalizedPathChanges.map((change) => [change.path, change]));

  for (const change of normalizedPathChanges) {
    const selector = addPathSelector(state, input.repository.repositoryId, change.path);
    const previousSelector = change.previousPath ? addPathSelector(state, input.repository.repositoryId, change.previousPath) : undefined;
    addChangedSubjectWithEvidence({
      state,
      selector,
      previousSelector,
      changeKind: changeKindFromGitStatus(change),
      rawFactKind: "git-path-change",
      source: "git",
      summary: `Git reports ${changeKindFromGitStatus(change)} path ${change.path}.`,
      evidenceSummary: `Observed changed path ${change.path} without source body or diff body.`,
      evidenceOrigin: "runtime-daemon",
      createdAt,
      provenance,
      extensions: {
        gitStatus: change.status,
        rawStatus: change.rawStatus,
        previousPath: change.previousPath
      }
    });
  }

  for (const symbol of symbolsForChangedPaths(input.codeContext.symbols, changeByPath)) {
    const selector = addSymbolSelector(state, input.repository.repositoryId, symbol);
    const change = changeByPath.get(normalizeRepoPath(symbol.path));
    addChangedSubjectWithEvidence({
      state,
      selector,
      changeKind: change ? changeKindFromGitStatus(change) : "materially_changed",
      rawFactKind: "codegraph-symbol",
      source: "codegraph",
      summary: `CodeGraph reports changed symbol ${symbol.name} at ${symbol.path}.`,
      evidenceSummary: `Observed changed symbol ${symbol.name} at ${symbol.path} without source body or diff body.`,
      evidenceOrigin: "codegraph",
      createdAt,
      provenance,
      extensions: {
        symbolKind: symbol.kind,
        path: symbol.path,
        startLine: symbol.range?.startLine,
        endLine: symbol.range?.endLine
      }
    });
  }

  for (const edge of edgesForChangedPaths(input.codeContext.edges, changeByPath)) {
    const selector = addRelationSelector(state, input.repository.repositoryId, edge);
    addChangedSubjectWithEvidence({
      state,
      selector,
      changeKind: "materially_changed",
      rawFactKind: "codegraph-relation",
      source: "codegraph",
      summary: `CodeGraph reports ${edge.kind} relation ${edge.source} -> ${edge.target}.`,
      evidenceSummary: `Observed ${edge.kind} relation ${edge.source} -> ${edge.target} without source body or diff body.`,
      evidenceOrigin: "codegraph",
      createdAt,
      provenance,
      extensions: {
        confidence: edge.confidence
      }
    });
  }

  addDeclaredArchitectureMappings({
    state,
    declaredGraph: input.declaredGraph,
    createdAt,
    provenance
  });

  const deltaId = `delta.${shortDigest(inputDigest)}`;
  for (const evidence of state.evidenceItems.values()) {
    const binding = createEvidenceBinding({
      bindingId: `binding.${shortDigest(digestJson({ evidenceId: evidence.evidenceId, deltaId } as unknown as Json))}`,
      evidenceId: evidence.evidenceId,
      target: { kind: "candidate-delta", id: deltaId },
      bindingReason: "change-cursor",
      createdAt,
      provenance
    });
    state.evidenceBindings.set(binding.bindingId, binding);
  }

  const draft: ArchitectureCandidateDeltaV1 = {
    schemaVersion: ARCHITECTURE_CANDIDATE_DELTA_SCHEMA_VERSION,
    deltaId,
    repository: input.repository,
    worktree: input.worktree,
    changeCursor: {
      source: "git",
      changeSource: input.git.source,
      baseSha: input.git.baseSha,
      headSha: input.git.headSha,
      pathCount: normalizedPathChanges.length,
      metadataDigest: input.git.metadataDigest,
      codeFactsDigest
    },
    subjectSelectors: sortBy([...state.selectors.values()], (selector) => selector.selectorId),
    changedSubjects: sortBy([...state.changedSubjects.values()], (subject) => subject.subjectSelectorId),
    rawFacts: sortBy([...state.rawFacts.values()], (fact) => fact.factId),
    interpretations: sortBy([...state.interpretations.values()], (interpretation) => interpretation.interpretationId),
    declaredSubjectMappings: sortBy([...state.declaredSubjectMappings.values()], (mapping) => mapping.mappingId),
    mappingAmbiguities: sortBy([...state.mappingAmbiguities.values()], (ambiguity) => ambiguity.ambiguityId),
    candidateChanges: sortBy([...state.candidateChanges.values()], (change) => change.candidateChangeId),
    evidenceItems: sortBy([...state.evidenceItems.values()], (evidence) => evidence.evidenceId),
    evidenceBindings: sortBy([...state.evidenceBindings.values()], (binding) => binding.bindingId),
    summary: summarizeDelta(state),
    deltaDigest: ""
  };
  return {
    ...draft,
    deltaDigest: architectureCandidateDeltaDigest(draft)
  };
}

function addChangedSubjectWithEvidence(input: {
  state: MutableBuildState;
  selector: ArchitectureSubjectSelectorV1;
  previousSelector?: ArchitectureSubjectSelectorV1;
  changeKind: ArchitectureCodeChangeKind;
  rawFactKind: ArchitectureDeltaRawFactKind;
  source: "git" | "codegraph";
  summary: string;
  evidenceSummary: string;
  evidenceOrigin: EvidenceItemV2["origin"];
  createdAt: string;
  provenance: LedgerProvenanceV1;
  extensions?: Record<string, Json | undefined>;
}): void {
  const factId = `fact.${shortDigest(digestJson({ kind: input.rawFactKind, selectorId: input.selector.selectorId, source: input.source } as unknown as Json))}`;
  const evidenceId = `evidence.${shortDigest(digestJson({ factId, selectorId: input.selector.selectorId } as unknown as Json))}`;
  const rawFact = withDigest({
    factId,
    kind: input.rawFactKind,
    subjectSelectorId: input.selector.selectorId,
    source: input.source,
    summary: input.summary,
    evidenceIds: [evidenceId],
    digest: "",
    extensions: stripUndefined(input.extensions ?? {})
  } satisfies ArchitectureDeltaRawFactV1);
  input.state.rawFacts.set(rawFact.factId, rawFact);

  const evidence = createEvidenceItem({
    evidenceId,
    kind: input.rawFactKind,
    origin: input.evidenceOrigin,
    subject: input.selector.selectorId,
    selector: evidenceSelector(input.selector),
    summary: input.evidenceSummary,
    createdAt: input.createdAt,
    provenance: input.provenance
  });
  input.state.evidenceItems.set(evidence.evidenceId, evidence);

  const subjectKey = `${input.selector.selectorId}:${input.changeKind}`;
  const existing = input.state.changedSubjects.get(subjectKey);
  const changed = withChangedSubjectDigest({
    subjectSelectorId: input.selector.selectorId,
    changeKind: input.changeKind,
    previousSelectorId: input.previousSelector?.selectorId,
    rawFactIds: uniqueSorted([...(existing?.rawFactIds ?? []), rawFact.factId]),
    evidenceIds: uniqueSorted([...(existing?.evidenceIds ?? []), evidence.evidenceId]),
    digest: ""
  });
  input.state.changedSubjects.set(subjectKey, changed);

  const interpretation = createInterpretation({
    selectorId: input.selector.selectorId,
    changeKind: input.changeKind,
    evidenceIds: changed.evidenceIds,
    rawFactIds: changed.rawFactIds
  });
  input.state.interpretations.set(subjectKey, interpretation);

  const binding = createEvidenceBinding({
    bindingId: `binding.${shortDigest(digestJson({ evidenceId, selectorId: input.selector.selectorId } as unknown as Json))}`,
    evidenceId,
    target: { kind: "subject", id: input.selector.selectorId },
    bindingReason: "change-cursor",
    createdAt: input.createdAt,
    provenance: input.provenance
  });
  input.state.evidenceBindings.set(binding.bindingId, binding);
}

function addDeclaredArchitectureMappings(input: {
  state: MutableBuildState;
  declaredGraph: ArchitectureDeltaDeclaredGraph | undefined;
  createdAt: string;
  provenance: LedgerProvenanceV1;
}): void {
  const changedSubjects = sortBy([...input.state.changedSubjects.values()], (subject) => subject.subjectSelectorId);
  for (const changedSubject of changedSubjects) {
    const selector = input.state.selectors.get(changedSubject.subjectSelectorId);
    if (!selector) continue;
    if (!input.declaredGraph) {
      addMappingAmbiguity({
        state: input.state,
        selector,
        changedSubject,
        reasonCode: "declared-graph-unavailable",
        candidateTargets: [],
        summary: "Declared architecture graph was not provided, so code subject mapping is unresolved."
      });
      continue;
    }

    const candidates = bestMappingCandidates(mappingCandidatesForSelector(selector, input.declaredGraph));
    if (candidates.length === 0) {
      addMappingAmbiguity({
        state: input.state,
        selector,
        changedSubject,
        reasonCode: selector.kind === "relation" ? "relation-endpoint-unmapped" : "no-declared-target",
        candidateTargets: [],
        summary: "Changed code subject does not map to a declared architecture target."
      });
      continue;
    }
    if (candidates.length > 1) {
      addMappingAmbiguity({
        state: input.state,
        selector,
        changedSubject,
        reasonCode: "multiple-declared-targets",
        candidateTargets: candidates,
        summary: "Changed code subject maps to multiple declared architecture targets with equal confidence."
      });
      continue;
    }

    const mapping = addDeclaredSubjectMapping({
      state: input.state,
      selector,
      changedSubject,
      candidate: candidates[0]!,
      createdAt: input.createdAt,
      provenance: input.provenance
    });
    addCandidateChangesForMapping({
      state: input.state,
      graph: input.declaredGraph,
      changedSubject,
      mapping
    });
  }
}

function addDeclaredSubjectMapping(input: {
  state: MutableBuildState;
  selector: ArchitectureSubjectSelectorV1;
  changedSubject: ArchitectureDeltaChangedSubjectV1;
  candidate: MappingCandidate;
  createdAt: string;
  provenance: LedgerProvenanceV1;
}): ArchitectureDeltaDeclaredSubjectMappingV1 {
  const mappingId = `mapping.${shortDigest(digestJson({
    subjectSelectorId: input.selector.selectorId,
    target: input.candidate.target,
    matchReason: input.candidate.matchReason
  } as unknown as Json))}`;
  const draft: ArchitectureDeltaDeclaredSubjectMappingV1 = {
    mappingId,
    subjectSelectorId: input.selector.selectorId,
    target: input.candidate.target,
    matchReason: input.candidate.matchReason,
    confidence: input.candidate.confidence,
    evidenceIds: uniqueSorted(input.changedSubject.evidenceIds),
    digest: ""
  };
  const mapping = {
    ...draft,
    digest: declaredSubjectMappingDigest(draft)
  };
  input.state.declaredSubjectMappings.set(mapping.mappingId, mapping);

  for (const evidenceId of mapping.evidenceIds) {
    const binding = createEvidenceBinding({
      bindingId: `binding.${shortDigest(digestJson({ evidenceId, mappingId, target: mapping.target } as unknown as Json))}`,
      evidenceId,
      target: mapping.target,
      bindingReason: "deterministic-check",
      createdAt: input.createdAt,
      provenance: input.provenance
    });
    input.state.evidenceBindings.set(binding.bindingId, binding);
  }

  return mapping;
}

function addMappingAmbiguity(input: {
  state: MutableBuildState;
  selector: ArchitectureSubjectSelectorV1;
  changedSubject: ArchitectureDeltaChangedSubjectV1;
  reasonCode: ArchitectureDeltaMappingAmbiguityReason;
  candidateTargets: MappingCandidate[];
  summary: string;
}): ArchitectureDeltaMappingAmbiguityV1 {
  const ambiguityId = `ambiguity.${shortDigest(digestJson({
    subjectSelectorId: input.selector.selectorId,
    reasonCode: input.reasonCode,
    candidateTargets: input.candidateTargets.map(mappingCandidateDigestInput)
  } as unknown as Json))}`;
  const draft: ArchitectureDeltaMappingAmbiguityV1 = {
    ambiguityId,
    subjectSelectorId: input.selector.selectorId,
    reasonCode: input.reasonCode,
    candidateTargets: input.candidateTargets.map((candidate) => ({
      target: candidate.target,
      matchReason: candidate.matchReason,
      confidence: candidate.confidence
    })),
    evidenceIds: uniqueSorted(input.changedSubject.evidenceIds),
    summary: input.summary,
    digest: ""
  };
  const ambiguity = {
    ...draft,
    digest: mappingAmbiguityDigest(draft)
  };
  input.state.mappingAmbiguities.set(ambiguity.ambiguityId, ambiguity);
  return ambiguity;
}

function addCandidateChangesForMapping(input: {
  state: MutableBuildState;
  graph: ArchitectureDeltaDeclaredGraph;
  changedSubject: ArchitectureDeltaChangedSubjectV1;
  mapping: ArchitectureDeltaDeclaredSubjectMappingV1;
}): void {
  if (input.mapping.target.kind === "entity") {
    const entity = input.graph.entities.find((candidate) => candidate.entityId === input.mapping.target.id);
    addCandidateChange({
      state: input.state,
      targetKind: "node",
      targetId: input.mapping.target.id,
      changeKind: input.changedSubject.changeKind,
      changedSubject: input.changedSubject,
      mapping: input.mapping,
      summary: `Declared architecture node ${input.mapping.target.id} may be ${candidateChangeVerb(input.changedSubject.changeKind)} by changed code.`
    });
    for (const constraint of constraintsForSubject(input.graph, input.mapping.target.id)) {
      addCandidateChange({
        state: input.state,
        targetKind: "constraint",
        targetId: constraint.constraintId,
        parentId: input.mapping.target.id,
        changeKind: input.changedSubject.changeKind,
        changedSubject: input.changedSubject,
        mapping: input.mapping,
        summary: `Declared constraint ${constraint.constraintId} is attached to changed architecture node ${input.mapping.target.id}.`
      });
    }
    if (entity && hasOwnerDimension(entity, input.graph)) {
      addCandidateChange({
        state: input.state,
        targetKind: "owner",
        targetId: `${input.mapping.target.id}:owner`,
        parentId: input.mapping.target.id,
        changeKind: input.changedSubject.changeKind,
        changedSubject: input.changedSubject,
        mapping: input.mapping,
        summary: `Ownership metadata for ${input.mapping.target.id} may need review after the code change.`
      });
    }
    if (entity && hasLifecycleDimension(entity, input.changedSubject.changeKind)) {
      addCandidateChange({
        state: input.state,
        targetKind: "lifecycle",
        targetId: `${input.mapping.target.id}:lifecycle`,
        parentId: input.mapping.target.id,
        changeKind: input.changedSubject.changeKind,
        changedSubject: input.changedSubject,
        mapping: input.mapping,
        summary: `Lifecycle state for ${input.mapping.target.id} may need review after the code change.`
      });
    }
    if (entity && hasMigrationStateDimension(entity, input.graph)) {
      addCandidateChange({
        state: input.state,
        targetKind: "migration-state",
        targetId: `${input.mapping.target.id}:migration-state`,
        parentId: input.mapping.target.id,
        changeKind: input.changedSubject.changeKind,
        changedSubject: input.changedSubject,
        mapping: input.mapping,
        summary: `Migration state for ${input.mapping.target.id} may need review after the code change.`
      });
    }
    return;
  }

  addCandidateChange({
    state: input.state,
    targetKind: input.mapping.target.kind,
    targetId: input.mapping.target.id,
    changeKind: input.changedSubject.changeKind,
    changedSubject: input.changedSubject,
    mapping: input.mapping,
    summary: `Declared architecture ${input.mapping.target.kind} ${input.mapping.target.id} may be ${candidateChangeVerb(input.changedSubject.changeKind)} by changed code.`
  });
}

function addCandidateChange(input: {
  state: MutableBuildState;
  targetKind: ArchitectureCandidateChangeTargetKind;
  targetId: string;
  parentId?: string;
  changeKind: ArchitectureCodeChangeKind;
  changedSubject: ArchitectureDeltaChangedSubjectV1;
  mapping: ArchitectureDeltaDeclaredSubjectMappingV1;
  summary: string;
}): void {
  const candidateChangeId = `candidate_change.${shortDigest(digestJson({
    targetKind: input.targetKind,
    targetId: input.targetId,
    changeKind: input.changeKind,
    mappingId: input.mapping.mappingId
  } as unknown as Json))}`;
  const existing = input.state.candidateChanges.get(candidateChangeId);
  const draft: ArchitectureCandidateChangeV1 = {
    candidateChangeId,
    kind: candidateChangeKind(input.targetKind, input.changeKind),
    target: {
      kind: input.targetKind,
      id: input.targetId,
      ...(input.parentId ? { parentId: input.parentId } : {})
    },
    stateDimension: candidateStateDimension(input.targetKind),
    changeKind: input.changeKind,
    subjectSelectorIds: uniqueSorted([...(existing?.subjectSelectorIds ?? []), input.changedSubject.subjectSelectorId]),
    mappingIds: uniqueSorted([...(existing?.mappingIds ?? []), input.mapping.mappingId]),
    ambiguityIds: existing?.ambiguityIds ?? [],
    evidenceIds: uniqueSorted([...(existing?.evidenceIds ?? []), ...input.changedSubject.evidenceIds]),
    confidence: input.mapping.confidence,
    heuristic: true,
    summary: input.summary,
    digest: ""
  };
  input.state.candidateChanges.set(candidateChangeId, {
    ...draft,
    digest: candidateChangeDigest(draft)
  });
}

function addPathSelector(state: MutableBuildState, repositoryId: string, path: string): ArchitectureSubjectSelectorV1 {
  return addSelector(state, {
    kind: "path",
    repositoryId,
    stableKey: `path:${normalizeRepoPath(path)}`,
    path: normalizeRepoPath(path)
  });
}

function addSymbolSelector(state: MutableBuildState, repositoryId: string, symbol: NormalizedSymbol): ArchitectureSubjectSelectorV1 {
  return addSelector(state, {
    kind: "symbol",
    repositoryId,
    stableKey: `symbol:${symbol.id}:${normalizeRepoPath(symbol.path)}`,
    path: normalizeRepoPath(symbol.path),
    symbolId: symbol.id,
    name: symbol.name,
    extensions: stripUndefined({
      symbolKind: symbol.kind,
      startLine: symbol.range?.startLine,
      endLine: symbol.range?.endLine
    })
  });
}

function addRelationSelector(state: MutableBuildState, repositoryId: string, edge: NormalizedEdge): ArchitectureSubjectSelectorV1 {
  return addSelector(state, {
    kind: "relation",
    repositoryId,
    stableKey: `relation:${edge.kind}:${edge.source}->${edge.target}`,
    relation: {
      source: edge.source,
      target: edge.target,
      kind: edge.kind
    },
    extensions: {
      confidence: edge.confidence
    }
  });
}

function addSelector(
  state: MutableBuildState,
  input: Omit<ArchitectureSubjectSelectorV1, "schemaVersion" | "selectorId" | "digest">
): ArchitectureSubjectSelectorV1 {
  const selectorId = selectorIdFor(input.kind, input.repositoryId, input.stableKey);
  const existing = state.selectors.get(selectorId);
  if (existing) return existing;
  const draft: ArchitectureSubjectSelectorV1 = {
    schemaVersion: ARCHITECTURE_SUBJECT_SELECTOR_SCHEMA_VERSION,
    selectorId,
    ...input,
    digest: ""
  };
  const selector = {
    ...draft,
    digest: architectureSubjectSelectorDigest(draft)
  };
  state.selectors.set(selector.selectorId, selector);
  return selector;
}

function createEvidenceItem(input: {
  evidenceId: string;
  kind: string;
  origin: EvidenceItemV2["origin"];
  subject: string;
  selector: EvidenceItemV2["selector"];
  summary: string;
  createdAt: string;
  provenance: LedgerProvenanceV1;
}): EvidenceItemV2 {
  const draft: EvidenceItemV2 = {
    schemaVersion: EVIDENCE_ITEM_SCHEMA_VERSION,
    evidenceId: input.evidenceId,
    kind: input.kind,
    strength: "observed",
    polarity: "positive",
    origin: input.origin,
    subject: input.subject,
    selector: input.selector,
    summary: input.summary,
    coverage: {
      level: "partial",
      scope: "code-change"
    },
    supports: ["recommendation", "checkpoint"],
    provenance: input.provenance,
    createdAt: input.createdAt,
    digest: ""
  };
  return {
    ...draft,
    digest: evidenceItemDigest(draft)
  };
}

function createEvidenceBinding(input: {
  bindingId: string;
  evidenceId: string;
  target: EvidenceBindingV1["target"];
  bindingReason: EvidenceBindingV1["bindingReason"];
  createdAt: string;
  provenance: LedgerProvenanceV1;
}): EvidenceBindingV1 {
  return {
    schemaVersion: EVIDENCE_BINDING_SCHEMA_VERSION,
    bindingId: input.bindingId,
    evidenceId: input.evidenceId,
    target: input.target,
    bindingReason: input.bindingReason,
    authorityEffect: "context-only",
    createdAt: input.createdAt,
    provenance: input.provenance
  };
}

function mappingCandidatesForSelector(selector: ArchitectureSubjectSelectorV1, graph: ArchitectureDeltaDeclaredGraph): MappingCandidate[] {
  if (selector.kind === "path" || selector.kind === "symbol") return entityMappingCandidates(selector, graph);
  if (selector.kind === "relation" && selector.relation) return relationMappingCandidates(selector.relation, graph);
  if (selector.kind === "node") return directTargetCandidates(selector, graph.entities.map((entity) => ({ kind: "entity" as const, id: entity.entityId })));
  return [];
}

function entityMappingCandidates(selector: ArchitectureSubjectSelectorV1, graph: ArchitectureDeltaDeclaredGraph): MappingCandidate[] {
  const path = selector.path ? normalizeRepoPath(selector.path) : undefined;
  const candidates: MappingCandidate[] = [];
  for (const entity of graph.entities.filter((candidate) => candidate.status !== "removed")) {
    const entityPath = entity.path ? normalizeRepoPath(entity.path) : undefined;
    if (path && entityPath && path === entityPath) {
      candidates.push(entityCandidate(entity, "declared-path-exact", "high", 100));
      continue;
    }
    if (path && entityPath && pathIsWithin(path, entityPath)) {
      candidates.push(entityCandidate(entity, "declared-path-prefix", "medium", 80 + segmentCount(entityPath)));
      continue;
    }
    if (selector.kind === "symbol" && selector.name && declaredNameMatches(selector.name, entity)) {
      candidates.push(entityCandidate(entity, "declared-name-match", "medium", 70));
    }
  }
  return candidates;
}

function relationMappingCandidates(relation: NonNullable<ArchitectureSubjectSelectorV1["relation"]>, graph: ArchitectureDeltaDeclaredGraph): MappingCandidate[] {
  const source = endpointEntityCandidates(relation.source, graph);
  const target = endpointEntityCandidates(relation.target, graph);
  if (source.length !== 1 || target.length !== 1) return [];
  const sourceId = source[0]!.target.id;
  const targetId = target[0]!.target.id;
  return graph.relations
    .filter((candidate) => candidate.status !== "removed")
    .filter((candidate) => candidate.sourceEntityId === sourceId && candidate.targetEntityId === targetId)
    .filter((candidate) => relationKindCompatible(relation.kind, candidate.kind))
    .map((candidate) => ({
      target: { kind: "relation" as const, id: candidate.relationId },
      matchReason: "declared-relation-endpoints" as const,
      confidence: relation.kind === candidate.kind ? "high" as const : "medium" as const,
      score: relation.kind === candidate.kind ? 100 : 85
    }));
}

function endpointEntityCandidates(endpoint: string, graph: ArchitectureDeltaDeclaredGraph): MappingCandidate[] {
  const endpointPath = endpoint.startsWith("file:") ? normalizeRepoPath(endpoint.slice("file:".length)) : undefined;
  if (!endpointPath) return graph.entities
    .filter((entity) => endpoint === entity.entityId)
    .map((entity) => entityCandidate(entity, "declared-name-match", "high", 95));
  return bestMappingCandidates(entityMappingCandidates({
    schemaVersion: ARCHITECTURE_SUBJECT_SELECTOR_SCHEMA_VERSION,
    selectorId: `endpoint.${shortDigest(digestJson({ endpoint } as unknown as Json))}`,
    kind: "path",
    repositoryId: "endpoint",
    stableKey: `path:${endpointPath}`,
    path: endpointPath,
    digest: ""
  }, graph));
}

function directTargetCandidates(
  selector: ArchitectureSubjectSelectorV1,
  targets: { kind: ArchitectureDeclaredTargetKind; id: string }[]
): MappingCandidate[] {
  return targets
    .filter((target) => selector.externalId === target.id || selector.name === target.id)
    .map((target) => ({ target, matchReason: "declared-name-match", confidence: "high", score: 100 }));
}

function entityCandidate(
  entity: ArchitectureDeltaDeclaredEntity,
  matchReason: ArchitectureDeltaMappingMatchReason,
  confidence: "low" | "medium" | "high",
  score: number
): MappingCandidate {
  return {
    target: { kind: "entity", id: entity.entityId },
    matchReason,
    confidence,
    score
  };
}

function bestMappingCandidates(candidates: MappingCandidate[]): MappingCandidate[] {
  if (candidates.length === 0) return [];
  const sorted = sortBy(candidates, (candidate) =>
    `${String(1000 - candidate.score).padStart(4, "0")}:${candidate.target.kind}:${candidate.target.id}:${candidate.matchReason}`
  );
  const bestScore = sorted[0]!.score;
  return sorted.filter((candidate) => candidate.score === bestScore);
}

function constraintsForSubject(graph: ArchitectureDeltaDeclaredGraph, subjectId: string): ArchitectureDeltaDeclaredConstraint[] {
  return graph.constraints
    .filter((constraint) => constraint.status !== "removed")
    .filter((constraint) => constraint.subjectId === subjectId)
    .sort((left, right) => left.constraintId.localeCompare(right.constraintId));
}

function hasOwnerDimension(entity: ArchitectureDeltaDeclaredEntity, graph: ArchitectureDeltaDeclaredGraph): boolean {
  return hasMetadataKey(entity.metadata, ["owner", "ownerId", "owners"]) ||
    constraintsForSubject(graph, entity.entityId).some((constraint) => constraint.kind.includes("owner"));
}

function hasLifecycleDimension(entity: ArchitectureDeltaDeclaredEntity, changeKind: ArchitectureCodeChangeKind): boolean {
  return entity.status !== "active" ||
    changeKind === "added" ||
    changeKind === "removed" ||
    hasMetadataKey(entity.metadata, ["lifecycle", "lifecycleState", "stage"]);
}

function hasMigrationStateDimension(entity: ArchitectureDeltaDeclaredEntity, graph: ArchitectureDeltaDeclaredGraph): boolean {
  return hasMetadataKey(entity.metadata, ["migration", "migrationState", "migrationPhase"]) ||
    constraintsForSubject(graph, entity.entityId).some((constraint) => constraint.kind.includes("migration"));
}

function hasMetadataKey(metadata: Record<string, Json> | undefined, keys: string[]): boolean {
  if (!metadata) return false;
  return keys.some((key) => metadata[key] !== undefined);
}

function relationKindCompatible(observed: string, declared: string): boolean {
  if (observed === declared) return true;
  if (observed === "imports") return ["depends_on", "depends-on", "calls", "uses", "imports"].includes(declared);
  return false;
}

function createInterpretation(input: {
  selectorId: string;
  changeKind: ArchitectureCodeChangeKind;
  evidenceIds: string[];
  rawFactIds: string[];
}): ArchitectureDeltaInterpretationV1 {
  const kind = interpretationKind(input.changeKind);
  const interpretationId = `interpretation.${shortDigest(digestJson({
    kind,
    subjectSelectorId: input.selectorId,
    evidenceIds: input.evidenceIds
  } as unknown as Json))}`;
  const draft: ArchitectureDeltaInterpretationV1 = {
    interpretationId,
    kind,
    subjectSelectorId: input.selectorId,
    evidenceIds: uniqueSorted(input.evidenceIds),
    confidence: "medium",
    coverage: "partial",
    heuristic: true,
    summary: "Code subject changed; architecture mapping is not yet asserted.",
    digest: "",
    extensions: {
      rawFactIds: uniqueSorted(input.rawFactIds)
    }
  };
  return {
    ...draft,
    digest: interpretationDigest(draft)
  };
}

function normalizePathChanges(changes: ArchitectureDeltaGitPathChange[]): ArchitectureDeltaGitPathChange[] {
  return sortBy(changes
    .map((change) => ({
      ...change,
      path: normalizeRepoPath(change.path),
      previousPath: change.previousPath ? normalizeRepoPath(change.previousPath) : undefined
    }))
    .filter((change) => isRepoRelativePosixPath(change.path)), (change) =>
      `${change.path}:${change.previousPath ?? ""}:${change.rawStatus}`
  );
}

function normalizeRepoPath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function symbolsForChangedPaths(symbols: NormalizedSymbol[], changes: Map<string, ArchitectureDeltaGitPathChange>): NormalizedSymbol[] {
  return sortBy(symbols
    .filter((symbol) => changes.has(normalizeRepoPath(symbol.path)))
    .filter((symbol, index, selected) =>
      selected.findIndex((candidate) => candidate.id === symbol.id && normalizeRepoPath(candidate.path) === normalizeRepoPath(symbol.path)) === index
    ), (symbol) => `${normalizeRepoPath(symbol.path)}:${symbol.id}`);
}

function edgesForChangedPaths(edges: NormalizedEdge[], changes: Map<string, ArchitectureDeltaGitPathChange>): NormalizedEdge[] {
  const paths = new Set(changes.keys());
  return sortBy(edges.filter((edge) =>
    endpointTouchesPath(edge.source, paths) || endpointTouchesPath(edge.target, paths)
  ), (edge) => `${edge.kind}:${edge.source}->${edge.target}`);
}

function endpointTouchesPath(endpoint: string, paths: Set<string>): boolean {
  const filePath = endpoint.startsWith("file:") ? endpoint.slice("file:".length) : endpoint;
  return paths.has(normalizeRepoPath(filePath));
}

function changeKindFromGitStatus(change: ArchitectureDeltaGitPathChange): ArchitectureCodeChangeKind {
  if (change.status === "added" || change.status === "copied") return "added";
  if (change.status === "deleted") return "removed";
  if (change.status === "renamed" && change.previousPath) {
    return basename(change.previousPath) === basename(change.path) ? "moved" : "renamed";
  }
  return "materially_changed";
}

function interpretationKind(changeKind: ArchitectureCodeChangeKind): ArchitectureDeltaInterpretationKind {
  if (changeKind === "added") return "code-subject-added";
  if (changeKind === "removed") return "code-subject-removed";
  if (changeKind === "moved") return "code-subject-moved";
  if (changeKind === "renamed") return "code-subject-renamed";
  return "code-subject-materially-changed";
}

function candidateChangeKind(
  targetKind: ArchitectureCandidateChangeTargetKind,
  changeKind: ArchitectureCodeChangeKind
): ArchitectureCandidateChangeKind {
  const suffix = changeKind.replace("_", "-");
  return `${targetKind}-${suffix}` as ArchitectureCandidateChangeKind;
}

function candidateStateDimension(targetKind: ArchitectureCandidateChangeTargetKind): "target-state" | "migration-state" {
  return targetKind === "migration-state" ? "migration-state" : "target-state";
}

function candidateChangeVerb(changeKind: ArchitectureCodeChangeKind): string {
  if (changeKind === "materially_changed") return "materially changed";
  return changeKind;
}

function evidenceSelector(selector: ArchitectureSubjectSelectorV1): EvidenceItemV2["selector"] {
  if (selector.kind === "symbol") {
    return {
      kind: "symbol",
      id: selector.selectorId,
      path: selector.path,
      symbolId: selector.symbolId,
      startLine: numberExtension(selector.extensions?.startLine),
      endLine: numberExtension(selector.extensions?.endLine)
    };
  }
  if (selector.kind === "relation") return { kind: "relation", id: selector.selectorId };
  return { kind: selector.kind === "path" ? "path" : "event", id: selector.selectorId, path: selector.path };
}

function summarizeDelta(state: MutableBuildState): ArchitectureCandidateDeltaV1["summary"] {
  const subjects = [...state.changedSubjects.values()];
  const candidateChanges = [...state.candidateChanges.values()];
  return {
    added: subjects.filter((subject) => subject.changeKind === "added").length,
    removed: subjects.filter((subject) => subject.changeKind === "removed").length,
    moved: subjects.filter((subject) => subject.changeKind === "moved").length,
    renamed: subjects.filter((subject) => subject.changeKind === "renamed").length,
    materiallyChanged: subjects.filter((subject) => subject.changeKind === "materially_changed").length,
    unresolved: state.mappingAmbiguities.size,
    mapped: state.declaredSubjectMappings.size,
    ambiguous: state.mappingAmbiguities.size,
    candidateChanges: state.candidateChanges.size,
    targetStateChanges: candidateChanges.filter((change) => change.stateDimension === "target-state").length,
    migrationStateProgress: candidateChanges.filter((change) => change.stateDimension === "migration-state").length
  };
}

function selectorIdFor(kind: ArchitectureSubjectSelectorKind, repositoryId: string, stableKey: string): string {
  return `subject.${kind}.${shortDigest(digestJson({ repositoryId, stableKey } as unknown as Json))}`;
}

function withDigest(fact: ArchitectureDeltaRawFactV1): ArchitectureDeltaRawFactV1 {
  return {
    ...fact,
    digest: rawFactDigest(fact)
  };
}

function withChangedSubjectDigest(subject: ArchitectureDeltaChangedSubjectV1): ArchitectureDeltaChangedSubjectV1 {
  return {
    ...subject,
    digest: changedSubjectDigest(subject)
  };
}

function rawFactDigest(fact: ArchitectureDeltaRawFactV1): string {
  const { digest: _digest, extensions: _extensions, ...hashable } = fact;
  return digestJson(hashable as unknown as Json);
}

function evidenceItemDigest(evidence: EvidenceItemV2): string {
  const { digest: _digest, extensions: _extensions, ...hashable } = evidence;
  return digestJson(hashable as unknown as Json);
}

function changedSubjectDigest(subject: ArchitectureDeltaChangedSubjectV1): string {
  const { digest: _digest, ...hashable } = subject;
  return digestJson(hashable as unknown as Json);
}

function interpretationDigest(interpretation: ArchitectureDeltaInterpretationV1): string {
  const { digest: _digest, extensions: _extensions, ...hashable } = interpretation;
  return digestJson(hashable as unknown as Json);
}

function declaredSubjectMappingDigest(mapping: ArchitectureDeltaDeclaredSubjectMappingV1): string {
  const { digest: _digest, extensions: _extensions, ...hashable } = mapping;
  return digestJson(hashable as unknown as Json);
}

function mappingAmbiguityDigest(ambiguity: ArchitectureDeltaMappingAmbiguityV1): string {
  const { digest: _digest, extensions: _extensions, ...hashable } = ambiguity;
  return digestJson(hashable as unknown as Json);
}

function candidateChangeDigest(change: ArchitectureCandidateChangeV1): string {
  const { digest: _digest, extensions: _extensions, ...hashable } = change;
  return digestJson(hashable as unknown as Json);
}

function mappingCandidateDigestInput(candidate: MappingCandidate): Json {
  return {
    target: candidate.target,
    matchReason: candidate.matchReason,
    confidence: candidate.confidence
  } as unknown as Json;
}

function shortDigest(digest: string): string {
  return digest.replace(/^sha256:/, "").slice(0, 16);
}

function pathIsWithin(path: string, declaredPath: string): boolean {
  return path === declaredPath || path.startsWith(`${declaredPath.replace(/\/+$/, "")}/`);
}

function segmentCount(path: string): number {
  return normalizeRepoPath(path).split("/").filter(Boolean).length;
}

function declaredNameMatches(symbolName: string, entity: ArchitectureDeltaDeclaredEntity): boolean {
  const symbol = stableName(symbolName);
  if (!symbol) return false;
  return [entity.entityId, entity.canonicalName, entity.kind]
    .map(stableName)
    .filter(Boolean)
    .some((candidate) => symbol === candidate || symbol.endsWith(candidate));
}

function stableName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function basename(path: string): string {
  const parts = normalizeRepoPath(path).split("/");
  return parts.at(-1) ?? path;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function sortBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((left, right) => key(left).localeCompare(key(right)));
}

function stripUndefined<T extends Record<string, Json | undefined>>(value: T): Record<string, Json> {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as Record<string, Json>;
}

function numberExtension(value: Json | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}
