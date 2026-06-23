import { digestJson, type EffectivePracticeAssetV1, type NormalizedCodeContext, type PracticeEvidenceStrength, type PracticeEvidenceV1, type PracticeGuidanceResultV1, type PracticeMatchReason, type PracticeMatchV1 } from "@archcontext/contracts";
import type { ArchitecturePressure } from "@archcontext/core/pressure-engine";
import { InMemoryLexicalRetriever, type RetrievalDocument } from "@archcontext/core/retrieval";
export * from "./check-registry";
export * from "./enforcement";

export interface PracticeEngineCatalog {
  catalogDigest: string;
  overlayDigest: string;
  effectiveAssets: EffectivePracticeAssetV1[];
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

export const SUPPORTED_STRUCTURAL_PREDICATES: Record<string, PredicateMatcher> = {
  "compatibility-path-added": termPredicate(/legacy|fallback|adapter|v1|v2|compat/i, "symbol"),
  "parallel-public-api-observed": parallelVersionPredicate,
  "parallel-data-shape-observed": termPredicate(/dto|entity|schema|model|v1|v2/i, "symbol"),
  "mapper-symbol-added": termPredicate(/mapper|adapter|convert|transform/i, "symbol"),
  "new-import-cycle-observed": cyclePredicate,
  "new-package-cycle-observed": cyclePredicate,
  "declared-layer-violation-observed": edgePredicate("imports"),
  "cross-boundary-import-added": edgePredicate("imports"),
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
  const documents = input.catalog.effectiveAssets
    .filter((asset) => asset.asset.status === "active")
    .map(toRetrievalDocument);
  const query = buildQuery(input);
  const retrievalHits = new InMemoryLexicalRetriever().search(query, documents, Math.max(12, input.maxMatches ?? 5));
  const hitScore = new Map(retrievalHits.map((hit) => [hit.id, hit.score]));
  const pressureTypes = new Set(input.pressure.signals.map((signal) => signal.type));
  const matches = retrievalHits
    .map((hit) => input.catalog.effectiveAssets.find((asset) => asset.asset.id === hit.id))
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
  const negativeEvidence = negativeScopeEvidence(asset.appliesTo.negativePathGlobs ?? [], input);
  if (negativeEvidence.length > 0) return undefined;

  const matchedBy = new Set<PracticeMatchReason>(["retrieval", "scope"]);
  const evidence: PracticeEvidenceV1[] = [practiceEvidence("task-text", "heuristic", input.task)];
  const matchingSignals = asset.triggers.pressureSignals.filter((signal) => pressureTypes.has(signal));
  if (matchingSignals.length > 0) {
    matchedBy.add("signal");
    evidence.push(...input.pressure.signals.filter((signal) => matchingSignals.includes(signal.type)).flatMap((signal) => signal.evidenceDetails));
  }
  const predicateEvidence = asset.triggers.structuralPredicates.flatMap((predicate) => SUPPORTED_STRUCTURAL_PREDICATES[predicate](input));
  if (predicateEvidence.length > 0) {
    matchedBy.add("predicate");
    evidence.push(...predicateEvidence);
  }
  const sourceEvidence = input.codeContext.evidence.map((item) =>
    practiceEvidence(item.selector.symbolId ? "symbol" : "path", item.confidence, item.selector.symbolId ?? item.selector.path)
  );
  evidence.push(...sourceEvidence);
  const dedupedEvidence = uniqueEvidence(evidence);
  const bestStrength = maxStrength(dedupedEvidence);
  if (EVIDENCE_ORDER[bestStrength] < EVIDENCE_ORDER[asset.evidencePolicy.minimumStrengthForRecommendation]) return undefined;
  const observedBonus = bestStrength === "verified" ? 25 : bestStrength === "observed" ? 18 : bestStrength === "declared" ? 10 : 0;
  const signalBonus = matchingSignals.length * 18;
  const predicateBonus = predicateEvidence.length > 0 ? 24 : 0;
  const scopeBonus = scopeMatches(asset.appliesTo.pathGlobs, input) ? 12 : 0;
  const score = Math.min(100, retrievalScore * 10 + signalBonus + predicateBonus + observedBonus + scopeBonus);
  if (score <= 0) return undefined;
  const enforcement = enforcementFor(asset, bestStrength);
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
    return pattern.test(haystack) ? [] : [practiceEvidence("runtime-check", "observed", `missing:${pattern.source}`)];
  };
}

function edgePredicate(kind: "imports" | "calls" | "reads" | "writes" | "implements"): PredicateMatcher {
  return (input) => input.codeContext.edges
    .filter((edge) => edge.kind === kind)
    .map((edge) => practiceEvidence(kind === "imports" ? "import-edge" : kind === "calls" ? "call-edge" : "data-edge", "observed", `${edge.source}->${edge.target}`));
}

function cyclePredicate(input: PracticeMatchInput): PracticeEvidenceV1[] {
  const imports = new Set(input.codeContext.edges.filter((edge) => edge.kind === "imports").map((edge) => `${edge.source}->${edge.target}`));
  return [...imports].flatMap((edge) => {
    const [source, target] = edge.split("->");
    return imports.has(`${target}->${source}`) ? [practiceEvidence("import-edge", "observed", edge)] : [];
  });
}

function parallelVersionPredicate(input: PracticeMatchInput): PracticeEvidenceV1[] {
  const matches = input.codeContext.symbols.filter((symbol) => /v1|v2|legacy|deprecated/i.test(`${symbol.id} ${symbol.name} ${symbol.path}`) && !isBenignPath(symbol.path));
  return matches.length >= 2 ? matches.map((symbol) => practiceEvidence("symbol", "observed", symbol.id)) : [];
}

function scopeMatches(globs: string[], input: PracticeMatchInput): boolean {
  if (globs.length === 0 || globs.includes("**/*")) return true;
  return input.codeContext.symbols.some((symbol) => globs.some((glob) => globMatches(glob, symbol.path)));
}

function negativeScopeEvidence(globs: string[], input: PracticeMatchInput): PracticeEvidenceV1[] {
  return input.codeContext.symbols
    .filter((symbol) => globs.some((glob) => globMatches(glob, symbol.path)))
    .map((symbol) => practiceEvidence("path", "observed", symbol.path));
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
