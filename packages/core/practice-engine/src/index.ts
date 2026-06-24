import { digestJson, type EffectivePracticeAssetV1, type NormalizedCodeContext, type PracticeEvidenceStrength, type PracticeEvidenceV1, type PracticeGuidanceResultV1, type PracticeMatchReason, type PracticeMatchV1, type PracticeProfileV1 } from "@archcontext/contracts";
import type { ArchitecturePressure } from "@archcontext/core/pressure-engine";
import { InMemoryLexicalRetriever, type RetrievalDocument } from "@archcontext/core/retrieval";
export * from "./check-registry";
export * from "./enforcement";

export interface PracticeEngineCatalog {
  catalogDigest: string;
  overlayDigest: string;
  effectiveAssets: EffectivePracticeAssetV1[];
  profiles?: PracticeProfileV1[];
}

export interface PracticeMatchInput {
  task: string;
  catalog: PracticeEngineCatalog;
  codeContext: NormalizedCodeContext;
  pressure: ArchitecturePressure;
  maxMatches?: number;
}

type PredicateMatcher = (input: PracticeMatchInput) => PracticeEvidenceV1[];

const EVIDENCE_ORDER: Record<PracticeEvidenceStrength, number> = {
  heuristic: 0,
  declared: 1,
  observed: 2,
  verified: 3
};

const SEMANTIC_BOUNDARY_PREDICATES = new Set([
  "declared-layer-violation-observed",
  "cross-boundary-import-added"
]);

const ABSENCE_PREDICATES = new Set([
  "telemetry-evidence-missing",
  "lockfile-not-updated"
]);

export const SUPPORTED_STRUCTURAL_PREDICATES: Record<string, PredicateMatcher> = {
  "compatibility-path-added": termPredicate(/legacy|fallback|adapter|v1|v2|compat/i, "symbol"),
  "parallel-public-api-observed": parallelVersionPredicate,
  "parallel-data-shape-observed": termPredicate(/dto|entity|schema|model|v1|v2/i, "symbol"),
  "mapper-symbol-added": termPredicate(/mapper|adapter|convert|transform/i, "symbol"),
  "new-import-cycle-observed": cyclePredicate,
  "new-package-cycle-observed": cyclePredicate,
  "declared-layer-violation-observed": explicitImportPredicate([
    "declared-layer-violation:",
    "declared-layer-violation-observed:",
    "dependency-direction-violation:",
    "layer-violation:"
  ]),
  "cross-boundary-import-added": explicitImportPredicate([
    "boundary-violation:",
    "cross-boundary-import:",
    "cross-boundary-import-added:"
  ]),
  "architecture-boundary-changed": termPredicate(/architecture|boundary|module|domain|service/i, "symbol"),
  "policy-or-contract-changed": termPredicate(/policy|contract|schema|api|event/i, "path"),
  "governed-element-created": termPredicate(/module|service|component|capability/i, "symbol"),
  "ownership-spread-observed": termPredicate(/owner|team|lifecycle/i, "symbol"),
  "cleanup-contract-missing": termPredicate(/temporary|cleanup|fallback|legacy/i, "symbol"),
  "public-api-changed": termPredicate(/api|route|controller|handler|public|schema|event/i, "symbol"),
  "schema-contract-missing": termPredicate(/schema|contract|openapi|asyncapi|event/i, "path"),
  "old-and-new-path-coexist": parallelVersionPredicate,
  "migration-cleanup-missing": termPredicate(/migration|cleanup|temporary|legacy/i, "symbol"),
  "runtime-boundary-added": termPredicate(/queue|worker|client|server|route|external/i, "symbol"),
  "telemetry-evidence-missing": missingTermPredicate(/telemetry|trace|metric|log/i),
  "new-credential-scope-observed": termPredicate(/token|credential|secret|key|permission|scope/i, "symbol"),
  "permission-expanded": termPredicate(/permission|scope|admin|write|readwrite/i, "symbol"),
  "runtime-dependency-added": termPredicate(/package|dependency|runtime|node_modules/i, "path"),
  "lockfile-not-updated": missingTermPredicate(/lockfile|bun.lock|package-lock|pnpm-lock|yarn.lock/i)
};

export function matchPracticesForTask(input: PracticeMatchInput): PracticeGuidanceResultV1 {
  validatePracticeEngineCatalog(input.catalog.effectiveAssets);
  const profileScope = resolveProfileScope(input);
  const scopedAssets = input.catalog.effectiveAssets
    .filter((asset) => asset.asset.status === "active")
    .filter((asset) => scopeAllows(asset, input, profileScope));
  const documents = scopedAssets
    .map(toRetrievalDocument);
  const assetById = new Map(scopedAssets.map((asset) => [asset.asset.id, asset]));
  const query = buildQuery(input);
  const retrievalHits = new InMemoryLexicalRetriever().search(query, documents, Math.max(12, input.maxMatches ?? 5));
  const hitScore = new Map(retrievalHits.map((hit) => [hit.id, hit.score]));
  const retrievalIds = new Set(retrievalHits.map((hit) => hit.id));
  const exactAssets = scopedAssets.filter((asset) => boundPracticeEvidence(asset.asset.id, input).length > 0);
  for (const asset of exactAssets) {
    if (!hitScore.has(asset.asset.id)) hitScore.set(asset.asset.id, 10);
  }
  const pressureTypes = new Set(input.pressure.signals.map((signal) => signal.type));
  const candidateAssets = [
    ...retrievalHits.map((hit) => assetById.get(hit.id)).filter((asset): asset is EffectivePracticeAssetV1 => Boolean(asset)),
    ...exactAssets.filter((asset) => !retrievalIds.has(asset.asset.id))
  ];
  const matches = candidateAssets
    .filter((asset): asset is EffectivePracticeAssetV1 => Boolean(asset))
    .map((asset) => scoreAsset(asset, input, hitScore.get(asset.asset.id) ?? 0, pressureTypes))
    .filter((match): match is PracticeMatchV1 => Boolean(match))
    .sort((left, right) => right.score - left.score || left.practiceId.localeCompare(right.practiceId));
  const trimmed = trimMatches(matches, input.maxMatches ?? 5);
  return {
    schemaVersion: "archcontext.practice-guidance/v1",
    catalogDigest: input.catalog.catalogDigest,
    overlayDigest: input.catalog.overlayDigest,
    matches: trimmed,
    constraints: unique(trimmed.flatMap((match) => match.explanation.slice(0, 1))),
    decisions: unique(trimmed.filter((match) => match.category === "decisions").map((match) => `Record decision for ${match.practiceId}`)),
    realConstraints: unique(trimmed.flatMap((match) => match.evidence.filter((evidence) => evidence.strength !== "heuristic").map((evidence) => `${match.practiceId}:${evidence.subject}`))).slice(0, 8),
    unknowns: unique(trimmed.filter((match) => match.confidence !== "high").map((match) => `Confirm applicability for ${match.practiceId}`)),
    requiredCheckpoints: unique(trimmed.filter((match) => match.enforcement !== "advisory").map((match) => `practice:${match.practiceId}@${match.assetRevision}`)),
    resources: trimmed.map((match) => ({
      type: "practice",
      uri: `archcontext://practice/${match.practiceId}@${match.assetRevision}`,
      digest: match.assetDigest
    }))
  };
}

export function validatePracticeEngineCatalog(assets: EffectivePracticeAssetV1[]): void {
  const supported = new Set(Object.keys(SUPPORTED_STRUCTURAL_PREDICATES));
  const unknown = assets.flatMap((entry) =>
    entry.asset.triggers.structuralPredicates
      .filter((predicate) => !supported.has(predicate))
      .map((predicate) => `${entry.asset.id}:${predicate}`)
  );
  if (unknown.length > 0) throw new Error(`unknown practice structural predicate(s): ${unknown.join(", ")}`);
}

function scoreAsset(
  entry: EffectivePracticeAssetV1,
  input: PracticeMatchInput,
  retrievalScore: number,
  pressureTypes: Set<string>
): PracticeMatchV1 | undefined {
  const asset = entry.asset;
  const scopedInput = inputForEligibleSubjects(asset, input);
  if (!scoringScopeMatches(asset, input, scopedInput)) return undefined;

  const matchedBy = new Set<PracticeMatchReason>(["retrieval", "scope"]);
  const evidence: PracticeEvidenceV1[] = [practiceEvidence("task-text", "heuristic", input.task)];
  const matchingSignals = asset.triggers.pressureSignals.filter((signal) => pressureTypes.has(signal));
  const predicateEvidence = asset.triggers.structuralPredicates.flatMap((predicate) => SUPPORTED_STRUCTURAL_PREDICATES[predicate](scopedInput));
  const exactEvidence = boundPracticeEvidence(asset.id, scopedInput);
  const signalEvidence = matchingSignalEvidence(asset, input, matchingSignals, predicateEvidence, exactEvidence);
  if (matchingSignals.length > 0) {
    matchedBy.add("signal");
    evidence.push(...signalEvidence);
  }
  if (predicateEvidence.length > 0) {
    matchedBy.add("predicate");
    evidence.push(...predicateEvidence);
  }
  if (exactEvidence.length > 0) {
    matchedBy.add("predicate");
    evidence.push(...exactEvidence);
  }
  const dedupedEvidence = uniqueEvidence(evidence);
  const bestStrength = maxStrength(dedupedEvidence);
  if (EVIDENCE_ORDER[bestStrength] < EVIDENCE_ORDER[asset.evidencePolicy.minimumStrengthForRecommendation]) return undefined;
  const enforcementStrength = cappedEnforcementStrength(asset, bestStrength, dedupedEvidence);
  const observedBonus = enforcementStrength === "verified" ? 25 : enforcementStrength === "observed" ? 18 : enforcementStrength === "declared" ? 10 : 0;
  const signalBonus = matchingSignals.length * 18;
  const predicateBonus = predicateEvidence.length > 0 ? 24 : 0;
  const exactEvidenceBonus = exactEvidence.length > 0 ? 48 : 0;
  const scopeBonus = scoringScopeMatches(asset, input, scopedInput) ? 12 : 0;
  const score = Math.min(100, retrievalScore * 10 + signalBonus + predicateBonus + exactEvidenceBonus + observedBonus + scopeBonus);
  if (score <= 0) return undefined;
  const enforcement = enforcementFor(asset, enforcementStrength);
  return {
    schemaVersion: "archcontext.practice-match/v1",
    practiceId: asset.id,
    assetRevision: asset.revision,
    assetDigest: entry.assetDigest,
    title: asset.title,
    category: asset.category,
    score,
    confidence: score >= 70 ? "high" : score >= 40 ? "medium" : "low",
    enforcement,
    matchedBy: [...matchedBy].sort() as PracticeMatchReason[],
    evidence: dedupedEvidence.sort(compareEvidence),
    explanation: [
      `${asset.id}: ${asset.summary}`,
      ...asset.guidance.preferred.slice(0, 2)
    ],
    sourceTrust: entry.sourceTrust
  };
}

function toRetrievalDocument(entry: EffectivePracticeAssetV1): RetrievalDocument {
  const asset = entry.asset;
  return {
    id: asset.id,
    text: [
      asset.title,
      asset.summary,
      asset.category,
      ...asset.tags,
      ...asset.triggers.candidateTerms,
      ...asset.triggers.pressureSignals,
      ...asset.triggers.structuralPredicates,
      ...asset.appliesTo.repositoryKinds,
      ...asset.appliesTo.languages,
      ...asset.appliesTo.frameworks,
      ...asset.appliesTo.nodeKinds,
      ...asset.guidance.questions,
      ...asset.guidance.preferred,
      ...asset.guidance.avoid
    ].join(" "),
    constraintIds: [asset.id]
  };
}

function buildQuery(input: PracticeMatchInput): string {
  return [
    input.task,
    ...input.codeContext.symbols.flatMap((symbol) => [symbol.name, symbol.kind, symbol.path]),
    ...input.codeContext.edges.flatMap((edge) => [edge.kind, edge.source, edge.target]),
    ...input.pressure.signals.map((signal) => signal.type)
  ].join(" ");
}

function trimMatches(matches: PracticeMatchV1[], maxMatches: number): PracticeMatchV1[] {
  const categoryCounts = new Map<string, number>();
  const selected: PracticeMatchV1[] = [];
  for (const match of matches) {
    const count = categoryCounts.get(match.category) ?? 0;
    if (count >= 2) continue;
    selected.push(match);
    categoryCounts.set(match.category, count + 1);
    if (selected.length >= maxMatches) break;
  }
  return selected;
}

function enforcementFor(asset: EffectivePracticeAssetV1["asset"], strength: PracticeEvidenceStrength): PracticeMatchV1["enforcement"] {
  if (strength === "heuristic") return asset.evidencePolicy.maxEnforcementWhenOnlyHeuristic;
  if (EVIDENCE_ORDER[strength] < EVIDENCE_ORDER[asset.evidencePolicy.minimumStrengthForCheckpoint]) return "advisory";
  if (asset.enforcement.promotableTo === "advisory") return "advisory";
  return "checkpoint";
}

function termPredicate(pattern: RegExp, kind: PracticeEvidenceV1["kind"]): PredicateMatcher {
  return (input) => input.codeContext.symbols
    .filter((symbol) => pattern.test(`${symbol.id} ${symbol.name} ${symbol.kind} ${symbol.path}`) && !isBenignPath(symbol.path))
    .map((symbol) => practiceEvidence(kind, "observed", symbol.id));
}

function missingTermPredicate(pattern: RegExp): PredicateMatcher {
  return (input) => {
    const haystack = [
      input.task,
      ...input.codeContext.symbols.flatMap((symbol) => [symbol.name, symbol.path]),
      ...input.codeContext.evidence.map((evidence) => evidence.summary)
    ].join(" ");
    return pattern.test(haystack) ? [] : [practiceEvidence("runtime-check", "heuristic", `unproven-absence:${pattern.source}`)];
  };
}

function explicitImportPredicate(prefixes: string[]): PredicateMatcher {
  return (input) => {
    const edgeEvidence = input.codeContext.edges
      .map((edge) => `${edge.source}->${edge.target}`)
      .filter((subject) => prefixes.some((prefix) => subject.startsWith(prefix)))
      .map((subject) => practiceEvidence("import-edge", "observed", subject));
    const boundEvidence = input.codeContext.evidence.flatMap((item) =>
      (item.practiceBindings ?? [])
        .filter((binding) => binding.subject && prefixes.some((prefix) => binding.subject!.startsWith(prefix)))
        .map((binding) => practiceEvidence("architecture-model", item.confidence, binding.subject!))
    );
    return [...edgeEvidence, ...boundEvidence];
  };
}

function boundPracticeEvidence(practiceId: string, input: PracticeMatchInput): PracticeEvidenceV1[] {
  return input.codeContext.evidence.flatMap((item) =>
    (item.practiceBindings ?? [])
      .filter((binding) => binding.practiceId === practiceId)
      .map((binding) => practiceEvidence(evidenceKindForBinding(binding, item.selector), item.confidence, evidenceSubjectForBinding(binding, item.selector)))
  );
}

function cyclePredicate(input: PracticeMatchInput): PracticeEvidenceV1[] {
  return importCycleSubjects(input.codeContext.edges.filter((edge) => edge.kind === "imports").map((edge) => `${edge.source}->${edge.target}`))
    .map((subject) => practiceEvidence("import-edge", "observed", subject));
}

function parallelVersionPredicate(input: PracticeMatchInput): PracticeEvidenceV1[] {
  const matches = input.codeContext.symbols.filter((symbol) => /v1|v2|legacy|deprecated/i.test(`${symbol.id} ${symbol.name} ${symbol.path}`) && !isBenignPath(symbol.path));
  return matches.length >= 2 ? matches.map((symbol) => practiceEvidence("symbol", "observed", symbol.id)) : [];
}

function scopeMatches(globs: string[], input: PracticeMatchInput): boolean {
  const subjects = scopeSubjectPaths(input);
  if (globs.length === 0 || globs.includes("**/*")) return subjects.length > 0;
  return subjects.some((path) => globs.some((glob) => globMatches(glob, path)));
}

function scopeAllowsDiscovery(asset: EffectivePracticeAssetV1["asset"], input: PracticeMatchInput): boolean {
  if (scopeMatches(asset.appliesTo.pathGlobs, input)) return true;
  const hasSubjects = scopeSubjectPaths(input).length > 0;
  return !hasSubjects && (asset.appliesTo.pathGlobs.length === 0 || asset.appliesTo.pathGlobs.includes("**/*"));
}

function scoringScopeMatches(
  asset: EffectivePracticeAssetV1["asset"],
  input: PracticeMatchInput,
  scopedInput: PracticeMatchInput
): boolean {
  if (scopeMatches(asset.appliesTo.pathGlobs, scopedInput)) return true;
  const hadSubjects = scopeSubjectPaths(input).length > 0;
  return !hadSubjects && (asset.appliesTo.pathGlobs.length === 0 || asset.appliesTo.pathGlobs.includes("**/*"));
}

interface ResolvedProfileScope {
  includePracticeIds: Set<string>;
  excludePracticeIds: Set<string>;
}

function resolveProfileScope(input: PracticeMatchInput): ResolvedProfileScope {
  const includePracticeIds = new Set<string>();
  const excludePracticeIds = new Set<string>();
  for (const profile of input.catalog.profiles ?? []) {
    if (profile.status !== "active" || !profileMatches(profile, input)) continue;
    for (const id of profile.includePracticeIds) includePracticeIds.add(id);
    for (const id of profile.excludePracticeIds) excludePracticeIds.add(id);
  }
  return { includePracticeIds, excludePracticeIds };
}

function profileMatches(profile: PracticeProfileV1, input: PracticeMatchInput): boolean {
  return dimensionMatches(profile.repositoryKinds, contextRepositoryKinds(input)) &&
    dimensionMatches(profile.languages, contextLanguages(input)) &&
    dimensionMatches(profile.frameworks, contextFrameworks(input));
}

function scopeAllows(entry: EffectivePracticeAssetV1, input: PracticeMatchInput, profileScope: ResolvedProfileScope): boolean {
  const asset = entry.asset;
  if (profileScope.excludePracticeIds.has(asset.id)) return false;
  if (boundPracticeEvidence(asset.id, input).length > 0) return true;
  if (!dimensionMatches(asset.appliesTo.repositoryKinds, contextRepositoryKinds(input))) return false;
  if (!dimensionMatches(asset.appliesTo.languages, contextLanguages(input))) return false;
  if (!dimensionMatches(asset.appliesTo.frameworks, contextFrameworks(input))) return false;
  if (!nodeKindMatches(asset.appliesTo.nodeKinds, contextNodeKinds(input))) return false;
  return profileScope.includePracticeIds.has(asset.id) || scopeAllowsDiscovery(asset, input);
}

function dimensionMatches(required: string[], observed: Set<string>): boolean {
  if (required.length === 0 || observed.size === 0) return true;
  return required.some((item) => observed.has(item.toLowerCase()));
}

function contextRepositoryKinds(input: PracticeMatchInput): Set<string> {
  const haystack = contextText(input);
  const kinds = new Set<string>();
  if (/\b(library|sdk|package)\b/i.test(haystack)) kinds.add("library");
  if (/\b(service|api|server|worker|controller|route|endpoint)\b/i.test(haystack)) {
    kinds.add("service");
    kinds.add("application");
  }
  if (/\b(monorepo|workspace|workspaces|packages\/)\b/i.test(haystack)) kinds.add("monorepo");
  if (/\b(application|app)\b/i.test(haystack)) kinds.add("application");
  return kinds;
}

function contextLanguages(input: PracticeMatchInput): Set<string> {
  const languages = new Set<string>();
  for (const symbol of input.codeContext.symbols) {
    if (/\.(ts|tsx|mts|cts)$/.test(symbol.path)) languages.add("typescript");
    if (/\.(js|jsx|mjs|cjs)$/.test(symbol.path)) languages.add("javascript");
    if (/\.java$/.test(symbol.path)) languages.add("java");
    if (/\.kt$/.test(symbol.path)) languages.add("kotlin");
    if (/\.go$/.test(symbol.path)) languages.add("go");
    if (/\.rs$/.test(symbol.path)) languages.add("rust");
    if (/\.py$/.test(symbol.path)) languages.add("python");
  }
  return languages;
}

function contextFrameworks(input: PracticeMatchInput): Set<string> {
  const haystack = contextText(input).toLowerCase();
  const frameworks = new Set<string>();
  for (const framework of ["kubernetes", "opentelemetry", "backstage", "archunit", "structurizr", "asyncapi", "openapi"]) {
    if (haystack.includes(framework)) frameworks.add(framework);
  }
  if (/\b(k8s|helm|deployment|serviceaccount|pod|clusterrole)\b/i.test(haystack)) frameworks.add("kubernetes");
  return frameworks;
}

function contextNodeKinds(input: PracticeMatchInput): Set<string> {
  const kinds = new Set<string>();
  for (const symbol of input.codeContext.symbols) {
    const kind = symbol.kind.toLowerCase();
    if (["module", "service", "public-api", "component", "resource", "package"].includes(kind)) {
      kinds.add(kind);
    }
    if (["route", "controller", "handler", "endpoint"].includes(kind)) {
      kinds.add("public-api");
    }
  }
  return kinds;
}

function nodeKindMatches(required: string[], observed: Set<string>): boolean {
  if (required.length === 0 || observed.size === 0) return true;
  return required.some((item) => observed.has(item.toLowerCase()));
}

function contextText(input: PracticeMatchInput): string {
  return [
    input.task,
    ...input.codeContext.symbols.flatMap((symbol) => [symbol.id, symbol.name, symbol.kind, symbol.path]),
    ...input.codeContext.edges.flatMap((edge) => [edge.kind, edge.source, edge.target]),
    ...input.codeContext.evidence.flatMap((evidence) => [evidence.summary, evidence.selector.path, evidence.selector.symbolId ?? ""])
  ].join(" ");
}

function inputForEligibleSubjects(asset: EffectivePracticeAssetV1["asset"], input: PracticeMatchInput): PracticeMatchInput {
  const negativePathGlobs = asset.appliesTo.negativePathGlobs ?? [];
  if (negativePathGlobs.length === 0) return input;
  const excludedSymbols = new Set(
    input.codeContext.symbols
      .filter((symbol) => negativePathGlobs.some((glob) => globMatches(glob, symbol.path)))
      .map((symbol) => symbol.id)
  );
  return {
    ...input,
    codeContext: {
      ...input.codeContext,
      symbols: input.codeContext.symbols.filter((symbol) => !excludedSymbols.has(symbol.id)),
      edges: input.codeContext.edges.filter((edge) => !excludedSymbols.has(edge.source) && !excludedSymbols.has(edge.target)),
      evidence: input.codeContext.evidence.filter((evidence) =>
        !excludedSymbols.has(evidence.selector.symbolId ?? "") &&
        !negativePathGlobs.some((glob) => globMatches(glob, evidence.selector.path))
      )
    }
  };
}

function scopeSubjectPaths(input: PracticeMatchInput): string[] {
  return unique([
    ...input.codeContext.symbols.map((symbol) => symbol.path),
    ...input.codeContext.evidence.map((evidence) => evidence.selector.path)
  ].filter(Boolean));
}

function matchingSignalEvidence(
  asset: EffectivePracticeAssetV1["asset"],
  input: PracticeMatchInput,
  matchingSignals: string[],
  predicateEvidence: PracticeEvidenceV1[],
  exactEvidence: PracticeEvidenceV1[]
): PracticeEvidenceV1[] {
  const evidence = input.pressure.signals
    .filter((signal) => matchingSignals.includes(signal.type))
    .flatMap((signal) => signal.evidenceDetails);
  if (!requiresSemanticBoundaryEvidence(asset) || predicateEvidence.length > 0 || exactEvidence.length > 0) return evidence;
  return evidence.map((item) => practiceEvidence(item.kind, "heuristic", item.subject));
}

function requiresSemanticBoundaryEvidence(asset: EffectivePracticeAssetV1["asset"]): boolean {
  return asset.triggers.structuralPredicates.some((predicate) => SEMANTIC_BOUNDARY_PREDICATES.has(predicate));
}

function cappedEnforcementStrength(
  asset: EffectivePracticeAssetV1["asset"],
  bestStrength: PracticeEvidenceStrength,
  evidence: PracticeEvidenceV1[]
): PracticeEvidenceStrength {
  if (!asset.triggers.structuralPredicates.some((predicate) => ABSENCE_PREDICATES.has(predicate))) return bestStrength;
  return evidence.some((item) => item.subject.startsWith("unproven-absence:")) ? minStrength(bestStrength, "declared") : bestStrength;
}

function minStrength(left: PracticeEvidenceStrength, right: PracticeEvidenceStrength): PracticeEvidenceStrength {
  return EVIDENCE_ORDER[left] <= EVIDENCE_ORDER[right] ? left : right;
}

function evidenceSubjectForBinding(binding: { subject?: string }, selector: { path: string; symbolId?: string }): string {
  return binding.subject ?? selector.symbolId ?? selector.path;
}

function evidenceKindForBinding(
  binding: { triggerId?: string; subject?: string },
  selector: { path: string; symbolId?: string }
): PracticeEvidenceV1["kind"] {
  const subject = evidenceSubjectForBinding(binding, selector);
  if (/^(boundary-violation|cross-boundary-import|cross-boundary-import-added|declared-layer-violation|declared-layer-violation-observed|dependency-direction-violation|layer-violation):/.test(subject)) {
    return "architecture-model";
  }
  if (subject.includes("->") || binding.triggerId?.includes("import") || binding.triggerId?.includes("cycle")) return "import-edge";
  return selector.symbolId ? "symbol" : "path";
}

function importCycleSubjects(edges: string[]): string[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const [source, target] = edge.split("->");
    if (!source || !target) continue;
    adjacency.set(source, [...(adjacency.get(source) ?? []), target].sort());
    if (!adjacency.has(target)) adjacency.set(target, []);
  }
  const cycles = new Set<string>();
  const nodes = [...adjacency.keys()].sort();
  for (const start of nodes) findCycles(start, start, adjacency, [], new Set(), cycles);
  return [...cycles].sort();
}

function findCycles(
  start: string,
  current: string,
  adjacency: Map<string, string[]>,
  path: string[],
  seen: Set<string>,
  cycles: Set<string>
): void {
  if (seen.has(current)) return;
  const nextPath = [...path, current];
  const nextSeen = new Set(seen).add(current);
  for (const next of adjacency.get(current) ?? []) {
    if (next === start) {
      cycles.add(`cycle:${canonicalCycle([...nextPath, start])}`);
      continue;
    }
    findCycles(start, next, adjacency, nextPath, nextSeen, cycles);
  }
}

function canonicalCycle(path: string[]): string {
  const cycle = path.slice(0, -1);
  if (cycle.length === 0) return path.join("->");
  const rotations = cycle.map((_, index) => {
    const rotated = [...cycle.slice(index), ...cycle.slice(0, index)];
    return [...rotated, rotated[0]].join("->");
  });
  return rotations.sort()[0];
}

function globMatches(glob: string, path: string): boolean {
  if (glob === "**/*") return true;
  if (glob.endsWith("/**")) return path.startsWith(glob.slice(0, -3));
  if (glob.startsWith("**/*")) return path.endsWith(glob.slice(4));
  if (glob.includes("*")) {
    const escaped = glob
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "\0")
      .replace(/\*/g, "[^/]*")
      .replace(/\0/g, ".*");
    return new RegExp(`^${escaped}$`).test(path);
  }
  return path === glob || path.startsWith(`${glob}/`);
}

function practiceEvidence(kind: PracticeEvidenceV1["kind"], strength: PracticeEvidenceStrength, subject: string): PracticeEvidenceV1 {
  return {
    kind,
    strength,
    subject,
    digest: digestJson({ kind, strength, subject }),
    observedAt: "1970-01-01T00:00:00.000Z"
  };
}

function maxStrength(evidence: PracticeEvidenceV1[]): PracticeEvidenceStrength {
  return evidence.reduce<PracticeEvidenceStrength>((max, item) => EVIDENCE_ORDER[item.strength] > EVIDENCE_ORDER[max] ? item.strength : max, "heuristic");
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function uniqueEvidence(evidence: PracticeEvidenceV1[]): PracticeEvidenceV1[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.kind}:${item.strength}:${item.subject}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareEvidence(left: PracticeEvidenceV1, right: PracticeEvidenceV1): number {
  return EVIDENCE_ORDER[right.strength] - EVIDENCE_ORDER[left.strength] || left.kind.localeCompare(right.kind) || left.subject.localeCompare(right.subject);
}

function isBenignPath(path: string): boolean {
  return /(^|\/)(readme|docs?|test|tests|fixtures?)($|\/|\.)/i.test(path);
}
