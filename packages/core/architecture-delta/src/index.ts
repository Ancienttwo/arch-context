import {
  ARCHITECTURE_CANDIDATE_DELTA_SCHEMA_VERSION,
  ARCHITECTURE_SUBJECT_SELECTOR_SCHEMA_VERSION,
  EVIDENCE_BINDING_SCHEMA_VERSION,
  EVIDENCE_ITEM_SCHEMA_VERSION,
  architectureCandidateDeltaDigest,
  architectureSubjectSelectorDigest,
  digestJson,
  isRepoRelativePosixPath,
  type ArchitectureCandidateDeltaV1,
  type ArchitectureCodeChangeKind,
  type ArchitectureDeltaChangedSubjectV1,
  type ArchitectureDeltaInterpretationKind,
  type ArchitectureDeltaInterpretationV1,
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

export interface BuildArchitectureCandidateDeltaInput {
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  git: ArchitectureDeltaGitChangeMetadata;
  codeContext: NormalizedCodeContext;
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
    interpretations: new Map()
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

  const deltaId = `delta.${shortDigest(inputDigest)}`;
  for (const evidence of state.evidenceItems.values()) {
    const binding = createEvidenceBinding({
      bindingId: `binding.${shortDigest(digestJson({ evidenceId: evidence.evidenceId, deltaId } as unknown as Json))}`,
      evidenceId: evidence.evidenceId,
      target: { kind: "candidate-delta", id: deltaId },
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
    evidenceItems: sortBy([...state.evidenceItems.values()], (evidence) => evidence.evidenceId),
    evidenceBindings: sortBy([...state.evidenceBindings.values()], (binding) => binding.bindingId),
    summary: summarizeChangedSubjects([...state.changedSubjects.values()]),
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
    createdAt: input.createdAt,
    provenance: input.provenance
  });
  input.state.evidenceBindings.set(binding.bindingId, binding);
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
  createdAt: string;
  provenance: LedgerProvenanceV1;
}): EvidenceBindingV1 {
  return {
    schemaVersion: EVIDENCE_BINDING_SCHEMA_VERSION,
    bindingId: input.bindingId,
    evidenceId: input.evidenceId,
    target: input.target,
    bindingReason: "change-cursor",
    authorityEffect: "context-only",
    createdAt: input.createdAt,
    provenance: input.provenance
  };
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

function summarizeChangedSubjects(subjects: ArchitectureDeltaChangedSubjectV1[]): ArchitectureCandidateDeltaV1["summary"] {
  return {
    added: subjects.filter((subject) => subject.changeKind === "added").length,
    removed: subjects.filter((subject) => subject.changeKind === "removed").length,
    moved: subjects.filter((subject) => subject.changeKind === "moved").length,
    renamed: subjects.filter((subject) => subject.changeKind === "renamed").length,
    materiallyChanged: subjects.filter((subject) => subject.changeKind === "materially_changed").length,
    unresolved: subjects.filter((subject) => subject.evidenceIds.length === 0).length
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

function shortDigest(digest: string): string {
  return digest.replace(/^sha256:/, "").slice(0, 16);
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
