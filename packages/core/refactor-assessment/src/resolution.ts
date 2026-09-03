import {
  REFACTOR_RESOLUTION_EVIDENCE_SCHEMA_VERSION,
  digestJson,
  refactorResolutionEvidenceDigest,
  refactorVerifyInvariantIssues,
  type Json,
  type ModuleStatisticsSnapshotV1,
  type RecommendationV3,
  type RefactorExecutionEvidenceRefV1,
  type RefactorKillListEntryV1,
  type RefactorObservationKind,
  type RefactorObservedOutcomeV1,
  type RefactorOutcomeDirection,
  type RefactorProposalPayloadV1,
  type RefactorResidualV1,
  type RefactorResolutionDisposition,
  type RefactorResolutionEvidenceV1,
  type RefactorTargetOutcomeV1,
  type StructuralObservationPayloadV1
} from "@archcontext/contracts";
import { resolveOwnership, type ModuleStatisticsTrackedFileV1 } from "../../module-statistics/src/index";
import type { NativeModel } from "../../projection-engine/src/index";

const DIGEST_PREFIX_LENGTH = "sha256:".length;
const OUTCOME_ID_LENGTH = 16;

/**
 * The closed vocabulary a resolution outcome may name. Every entry is a pure field path into a
 * `ModuleStatisticsSnapshotV1` (or, for `killList.*`, into the verified worktree); the subject is
 * carried by `nodeId`/`subjectSelectorId`, never spliced into the string. Embedding an id in the
 * metric name would fork one outcome's digest on every node rename.
 *
 * An outcome naming anything outside this list is rejected at ingress rather than measured: under
 * the `absent` operator an unreadable metric reads as *satisfied*, so silently tolerating an
 * unknown name would manufacture `resolved` out of a typo.
 */
export const REFACTOR_RESOLUTION_METRICS = [
  "killList.path.present",
  "killList.relation.present",
  "module.dependencyGraph.cycleCount",
  "module.dependencyGraph.directionViolationCount",
  "module.dependencyGraph.fanIn",
  "module.dependencyGraph.fanOut",
  "module.dependencyGraph.inboundModuleEdges",
  "module.dependencyGraph.instability",
  "module.dependencyGraph.internalEdgeCount",
  "module.dependencyGraph.outboundModuleEdges",
  "module.footprint.fileCount",
  "module.footprint.lineCount",
  "module.footprintDeclared",
  "module.tests.callerCoverage",
  "module.tests.observedTestEdges",
  "module.tests.testFileCount",
  "module.uncertainty.ambiguousOwnership",
  "module.uncertainty.unresolvedImports",
  "repositorySummary.crossModuleCycleCount",
  "repositorySummary.crossModuleEdgeCount",
  "repositorySummary.dynamicInvocationRiskCount",
  "repositorySummary.moduleCount",
  "repositorySummary.multiplyOwnedFileCount",
  "repositorySummary.ownedFileCount",
  "repositorySummary.stronglyConnectedComponentCount",
  "repositorySummary.undeclaredFootprintNodeCount",
  "repositorySummary.unownedFileCount",
  "repositorySummary.unresolvedImportCount"
] as const;

export type RefactorResolutionMetric = (typeof REFACTOR_RESOLUTION_METRICS)[number];

/** The residual codes RF4 can emit. Every non-`resolved` verdict names one of these. */
export const REFACTOR_RESOLUTION_RESIDUAL_CODES = [
  "after-coverage-incomplete",
  "after-index-stale",
  "after-model-mismatch",
  "after-tracked-files-mismatch",
  "baseline-digest-mismatch",
  "baseline-snapshot-unverifiable",
  "kill-list-symbol-unverifiable",
  "no-required-outcome",
  "outcome-subject-absent"
] as const;

export type RefactorResolutionResidualCode = (typeof REFACTOR_RESOLUTION_RESIDUAL_CODES)[number];

export interface RefactorResolutionInputV1 {
  /** The ledger-latest record being verified. `practice` carries no measurable outcome and throws. */
  recommendation: RecommendationV3;
  /** The baseline the caller resolved for this record; compared against the recorded payload. */
  beforeSnapshotDigest: string;
  /** The persisted baseline body, when one was found. Absent means every `direction` is `unknown`. */
  beforeSnapshot?: ModuleStatisticsSnapshotV1;
  /** Set when a baseline body was persisted but failed its own invariants and was dropped. */
  beforeSnapshotUnverifiable?: boolean;
  afterSnapshot: ModuleStatisticsSnapshotV1;
  /** The declared model at the verified HEAD; the only authority for a `relation` kill entry. */
  afterModel: NativeModel;
  /**
   * The tracked-file records read at the verified HEAD; the authority for a `path` kill entry.
   * Carries `lineCount` because the binding below recomputes the snapshot's footprint digests from
   * it: a file list that cannot reproduce them describes some other tree.
   */
  afterTrackedFiles: readonly ModuleStatisticsTrackedFileV1[];
  executionEvidenceRefs?: readonly RefactorExecutionEvidenceRefV1[];
  /** Caller-supplied clock. The evaluator reads none, so two evaluations agree on every digest. */
  verifiedAt: string;
}

export interface DeriveObservationOutcomesInputV1 {
  kind: RefactorObservationKind;
  /** The record's subject selector; copied onto every derived outcome. */
  subjectSelectorId: string;
  affectedNodeIds: readonly string[];
}

/**
 * The metric each observation kind is measured by, and whether the measurement is per affected
 * node or repository-wide.
 *
 * Every derived outcome uses `absent`/`present`, never `less_than 1`: `less_than` on a `null`
 * observation is unsatisfied, so dissolving the subject module — the strongest possible fix for a
 * module-scoped observation — would read as a failure to fix it.
 */
const OBSERVATION_OUTCOME_METRICS: Readonly<Record<RefactorObservationKind, {
  metric: RefactorResolutionMetric;
  operator: "absent" | "present";
  scope: "module" | "repository";
}>> = {
  "cycle": { metric: "module.dependencyGraph.cycleCount", operator: "absent", scope: "module" },
  "direction-violation": { metric: "module.dependencyGraph.directionViolationCount", operator: "absent", scope: "module" },
  "evidence-gap": { metric: "repositorySummary.unresolvedImportCount", operator: "absent", scope: "repository" },
  "ownership-ambiguous": { metric: "module.uncertainty.ambiguousOwnership", operator: "absent", scope: "module" },
  "undeclared-footprint": { metric: "module.footprintDeclared", operator: "present", scope: "module" },
  "unowned-paths": { metric: "repositorySummary.unownedFileCount", operator: "absent", scope: "repository" }
};

/** Lower is better under `absent`/`less_than`; higher is better under `present`/`greater_than`. */
const LOWER_IS_BETTER: ReadonlySet<string> = new Set(["absent", "less_than"]);
const HIGHER_IS_BETTER: ReadonlySet<string> = new Set(["present", "greater_than"]);

/**
 * The identity of one measurable outcome: what is measured, on which subject, against which
 * threshold. Derived, not authored, so two ArchContext-synthesized outcomes for the same subject
 * collide into one instead of double-counting the same requirement.
 */
export function refactorResolutionOutcomeId(outcome: Omit<RefactorTargetOutcomeV1, "outcomeId">): string {
  const digest = digestJson({
    metric: outcome.metric,
    subjectSelectorId: outcome.subjectSelectorId,
    nodeId: outcome.nodeId,
    operator: outcome.operator,
    value: outcome.value,
    required: outcome.required
  } as unknown as Json);
  return `outcome.${digest.slice(DIGEST_PREFIX_LENGTH, DIGEST_PREFIX_LENGTH + OUTCOME_ID_LENGTH)}`;
}

/**
 * Reads one snapshot-backed metric. `null` means "the snapshot cannot answer this", which under
 * `absent` is a satisfied outcome and under every comparison operator is an unsatisfied one — the
 * frozen `outcomeSatisfied` rule, not a local interpretation of missingness.
 *
 * `killList.*` metrics are not snapshot-backed and always read `null` here; `evaluateResolution`
 * routes them to the worktree and the declared model instead.
 */
export function readSnapshotMetric(
  snapshot: ModuleStatisticsSnapshotV1,
  metric: RefactorResolutionMetric,
  nodeId: string | null
): number | null {
  if (metric.startsWith("killList.")) return null;
  if (metric.startsWith("repositorySummary.")) {
    const field = metric.slice("repositorySummary.".length) as keyof ModuleStatisticsSnapshotV1["repositorySummary"];
    return snapshot.repositorySummary[field];
  }
  if (nodeId === null) return null;
  const module = snapshot.modules.find((candidate) => candidate.nodeId === nodeId);
  if (!module) return null;
  switch (metric) {
    case "module.footprintDeclared":
      return module.footprintDeclared ? 1 : 0;
    case "module.footprint.fileCount":
      return module.footprint?.fileCount ?? null;
    case "module.footprint.lineCount":
      return module.footprint?.lineCount ?? null;
    case "module.dependencyGraph.internalEdgeCount":
      return module.dependencyGraph?.internalEdgeCount ?? null;
    case "module.dependencyGraph.inboundModuleEdges":
      return module.dependencyGraph?.inboundModuleEdges ?? null;
    case "module.dependencyGraph.outboundModuleEdges":
      return module.dependencyGraph?.outboundModuleEdges ?? null;
    case "module.dependencyGraph.fanIn":
      return module.dependencyGraph?.fanIn ?? null;
    case "module.dependencyGraph.fanOut":
      return module.dependencyGraph?.fanOut ?? null;
    case "module.dependencyGraph.cycleCount":
      return module.dependencyGraph?.cycleCount ?? null;
    case "module.dependencyGraph.instability":
      return module.dependencyGraph?.instability ?? null;
    case "module.dependencyGraph.directionViolationCount":
      return module.dependencyGraph?.directionViolationCount ?? null;
    case "module.tests.testFileCount":
      return module.tests.testFileCount;
    case "module.tests.observedTestEdges":
      return module.tests.observedTestEdges;
    case "module.tests.callerCoverage":
      return module.tests.callerCoverage;
    case "module.uncertainty.unresolvedImports":
      return module.uncertainty.unresolvedImports;
    case "module.uncertainty.ambiguousOwnership":
      return module.uncertainty.ambiguousOwnership ? 1 : 0;
    default:
      return null;
  }
}

/**
 * Checks a set of outcomes against the closed vocabulary and the subject shape each metric family
 * requires. `repositorySummary.*` and `killList.*` are repository-wide and must carry `nodeId:
 * null`; `module.*` measures one declared node and must name it. A `module.*` outcome with a null
 * `nodeId` would read every metric as `null`, and under `absent` that is a free `resolved`.
 */
export function refactorOutcomeVocabularyIssues(
  outcomes: readonly RefactorTargetOutcomeV1[],
  prefix = "expectedOutcomes"
): string[] {
  const known = new Set<string>(REFACTOR_RESOLUTION_METRICS);
  const issues: string[] = [];
  for (const [index, outcome] of outcomes.entries()) {
    const label = `${prefix}[${index}]`;
    if (!known.has(outcome.metric)) {
      issues.push(`${label}.metric is outside the resolution vocabulary: ${outcome.metric}`);
      continue;
    }
    const requiresNode = outcome.metric.startsWith("module.");
    if (requiresNode && (outcome.nodeId === null || outcome.nodeId.trim() === "")) {
      issues.push(`${label}.nodeId is required for metric ${outcome.metric}`);
    }
    if (!requiresNode && outcome.nodeId !== null) {
      issues.push(`${label}.nodeId must be null for metric ${outcome.metric}`);
    }
    if (outcome.subjectSelectorId.trim() === "") issues.push(`${label}.subjectSelectorId must not be empty`);
    // The id is the content, not a caller's label. Without this an authored outcome could carry a
    // synthesized kill-list outcome's id, and the first-write-wins dedupe below would drop the
    // kill-list requirement while `resolved` still claimed it was measured.
    if (outcome.outcomeId !== refactorResolutionOutcomeId(outcome)) {
      issues.push(`${label}.outcomeId ${outcome.outcomeId} is not derived from its own content`);
    }
  }
  return issues;
}

/**
 * Turns one structural observation into the acceptance test that would close it.
 *
 * ArchContext authors these because an observation is ArchContext's own measurement — unlike a
 * proposal's `targetOutcomes`, which are the agent's authored intent and are never re-derived.
 */
export function deriveObservationOutcomes(input: DeriveObservationOutcomesInputV1): RefactorTargetOutcomeV1[] {
  const spec = OBSERVATION_OUTCOME_METRICS[input.kind];
  const subjects: (string | null)[] = spec.scope === "repository"
    ? [null]
    : [...new Set(input.affectedNodeIds)].sort();
  const outcomes = subjects.map((nodeId) => sealOutcome({
    metric: spec.metric,
    subjectSelectorId: input.subjectSelectorId,
    nodeId,
    operator: spec.operator,
    value: null,
    required: true
  }));
  return sortOutcomes(dedupeOutcomes(outcomes));
}

/**
 * Evaluates one recorded recommendation against a re-measured snapshot.
 *
 * Pure: no clock, no filesystem, no network. Every identity — the verified HEAD, the worktree
 * digest, the baseline digest and `verifiedAt` — arrives as an input, so two evaluations of the
 * same inputs are byte-identical and `resolutionDigest` is a stable idempotency key.
 *
 * The disposition is the frozen validator's, not this function's opinion: the last thing it does
 * is re-run `refactorVerifyInvariantIssues`, which recomputes `satisfied` from
 * `(operator, value, observedValue)` and pins the disposition from the required-satisfied count.
 * A verdict this evaluator and the validator disagree on throws instead of being written.
 */
export function evaluateResolution(input: RefactorResolutionInputV1): RefactorResolutionEvidenceV1 {
  const recommendation = input.recommendation;
  if (recommendation.category === "practice") {
    throw new Error("AC_SCHEMA_INVALID: practice recommendations carry no measurable refactor outcome");
  }
  const authored = authoredOutcomes(recommendation);
  const vocabularyIssues = refactorOutcomeVocabularyIssues(authored, "recommendation.payload.outcomes");
  if (vocabularyIssues.length > 0) throw new Error(`AC_SCHEMA_INVALID: ${vocabularyIssues.join("; ")}`);

  const killList = recommendation.category === "refactor_proposal"
    ? (recommendation.payload as RefactorProposalPayloadV1).killList
    : [];
  const residuals: RefactorResidualV1[] = [];
  const expectedOutcomes = sortOutcomes(dedupeOutcomes([...authored, ...killListOutcomes(killList, residuals)]));

  const baselineDigestMismatch = input.beforeSnapshotDigest !== baselineSnapshotDigestOf(recommendation);
  if (baselineDigestMismatch) {
    residuals.push({
      code: "baseline-digest-mismatch",
      subject: recommendation.recommendationId,
      severity: "error"
    });
  }
  // The relation kill list is decided against `afterModel` and the path kill list against
  // `afterTrackedFiles`, but the measured metrics come from `afterSnapshot`. Two reads of the same
  // HEAD can diverge, so both are re-derived and compared to what the snapshot bound.
  const modelBound = nativeModelDigest(input.afterModel) === input.afterSnapshot.modelDigest;
  if (!modelBound) {
    residuals.push({ code: "after-model-mismatch", subject: input.afterSnapshot.modelDigest, severity: "error" });
  }
  const trackedFilesBound = modelBound && trackedFilesBindSnapshot(input);
  if (!trackedFilesBound) {
    residuals.push({ code: "after-tracked-files-mismatch", subject: input.afterSnapshot.snapshotDigest, severity: "error" });
  }
  if (input.beforeSnapshotUnverifiable) {
    residuals.push({
      code: "baseline-snapshot-unverifiable",
      subject: input.beforeSnapshotDigest,
      severity: "warning"
    });
  }
  const coverageIncomplete = input.afterSnapshot.codeFacts.coverage !== "complete";
  if (coverageIncomplete) {
    residuals.push({
      code: "after-coverage-incomplete",
      subject: input.afterSnapshot.snapshotDigest,
      severity: "error"
    });
  }
  const indexCoversWorktree = input.afterSnapshot.codeFacts.indexedWorktreeDigest !== null
    && input.afterSnapshot.codeFacts.indexedWorktreeDigest === input.afterSnapshot.worktree.worktreeDigest;
  if (!indexCoversWorktree) {
    residuals.push({
      code: "after-index-stale",
      subject: input.afterSnapshot.worktree.worktreeDigest,
      severity: "error"
    });
  }

  // A baseline body that does not bind the digest describes some other measurement, so it can
  // only produce a fictional direction; the honest answer is `unknown` on every outcome.
  const before = input.beforeSnapshot && input.beforeSnapshot.snapshotDigest === input.beforeSnapshotDigest
    ? input.beforeSnapshot
    : undefined;
  const observedOutcomes = expectedOutcomes.map((outcome) =>
    observeOutcome(outcome, input, before, residuals)
  );

  const requiredSymbolKill = killList.some((entry) => entry.kind === "symbol" && entry.required);
  const disposition = decideDisposition({
    stale: baselineDigestMismatch || coverageIncomplete || !indexCoversWorktree || requiredSymbolKill
      || !modelBound || !trackedFilesBound,
    expectedOutcomes,
    observedOutcomes,
    residuals
  });

  const draft: RefactorResolutionEvidenceV1 = {
    schemaVersion: REFACTOR_RESOLUTION_EVIDENCE_SCHEMA_VERSION,
    recommendationId: recommendation.recommendationId,
    recommendationDigest: refactorRecommendationDigest(recommendation),
    beforeSnapshotDigest: input.beforeSnapshotDigest,
    afterSnapshotDigest: input.afterSnapshot.snapshotDigest,
    verifiedHeadSha: input.afterSnapshot.worktree.headSha,
    verifiedWorktreeDigest: input.afterSnapshot.worktree.worktreeDigest,
    expectedOutcomes,
    observedOutcomes,
    residuals: sortResiduals(residuals),
    // Field-explicit, not a spread: these refs are digest-bound into the ledger, and a caller key
    // that survived the copy would be persisted under an envelope promising no raw diffs.
    executionEvidenceRefs: (input.executionEvidenceRefs ?? []).map((ref) => ({
      kind: ref.kind,
      locator: ref.locator,
      sha256: ref.sha256
    })),
    disposition,
    verifiedAt: input.verifiedAt,
    resolutionDigest: ""
  };
  const evidence: RefactorResolutionEvidenceV1 = {
    ...draft,
    resolutionDigest: refactorResolutionEvidenceDigest(draft)
  };
  const issues = refactorVerifyInvariantIssues(input.afterSnapshot, evidence);
  if (issues.length > 0) throw new Error(`AC_SCHEMA_INVALID: ${issues.join("; ")}`);
  return evidence;
}

/**
 * Binds the record content a verdict was measured against, deliberately excluding `status` and
 * `updatedAt`: acknowledging a recommendation between two verifies must not fork the resolution
 * digest, or the idempotency key would change without a single measurement changing.
 */
function refactorRecommendationDigest(recommendation: RecommendationV3): string {
  return digestJson({
    schemaVersion: "archcontext.refactor-resolution-recommendation-identity/v1",
    recommendationId: recommendation.recommendationId,
    fingerprint: recommendation.fingerprint,
    category: recommendation.category,
    subjectSelectorId: recommendation.subjectSelectorId,
    payload: recommendation.payload
  } as unknown as Json);
}

/**
 * The agent's authored acceptance test for a proposal, or ArchContext's own for an observation.
 * Neither is re-derived here: a proposal's `targetOutcomes` are digest-bound into
 * `proposalDigest`, and an observation's `derivedOutcomes` are whatever the record site wrote.
 */
function authoredOutcomes(recommendation: RecommendationV3): RefactorTargetOutcomeV1[] {
  return recommendation.category === "refactor_proposal"
    ? [...(recommendation.payload as RefactorProposalPayloadV1).targetOutcomes]
    : [...(recommendation.payload as StructuralObservationPayloadV1).derivedOutcomes];
}

function baselineSnapshotDigestOf(recommendation: RecommendationV3): string {
  return recommendation.category === "refactor_proposal"
    ? (recommendation.payload as RefactorProposalPayloadV1).baselineSnapshotDigest
    : (recommendation.payload as StructuralObservationPayloadV1).baselineSnapshotDigest;
}

/**
 * A kill entry says "this must be gone". `path` is decided against the tracked-file set and
 * `relation` against the declared model; both are exact, decidable membership questions.
 *
 * `symbol` is not decidable from a `ModuleStatisticsSnapshotV1`: the snapshot carries declared and
 * observed entrypoints, and absence from an entrypoint list is not absence from the repository.
 * A required symbol entry therefore forces `stale` rather than a guess, and a non-required one is
 * reported as an unverified residual.
 */
function killListOutcomes(
  killList: readonly RefactorKillListEntryV1[],
  residuals: RefactorResidualV1[]
): RefactorTargetOutcomeV1[] {
  const outcomes: RefactorTargetOutcomeV1[] = [];
  for (const entry of killList) {
    if (entry.kind === "symbol") {
      residuals.push({
        code: "kill-list-symbol-unverifiable",
        subject: entry.selectorId,
        severity: entry.required ? "error" : "warning"
      });
      continue;
    }
    outcomes.push(sealOutcome({
      metric: entry.kind === "path" ? "killList.path.present" : "killList.relation.present",
      subjectSelectorId: entry.selectorId,
      nodeId: null,
      operator: "absent",
      value: null,
      required: entry.required
    }));
  }
  return outcomes;
}

function observeOutcome(
  outcome: RefactorTargetOutcomeV1,
  input: RefactorResolutionInputV1,
  before: ModuleStatisticsSnapshotV1 | undefined,
  residuals: RefactorResidualV1[]
): RefactorObservedOutcomeV1 {
  const metric = outcome.metric as RefactorResolutionMetric;
  if (metric === "killList.path.present" || metric === "killList.relation.present") {
    const present = metric === "killList.path.present"
      ? input.afterTrackedFiles.some((file) => file.path === outcome.subjectSelectorId)
      : input.afterModel.relations.some((relation) => relation.id === outcome.subjectSelectorId);
    return {
      outcomeId: outcome.outcomeId,
      observedValue: present ? 1 : 0,
      satisfied: outcomeSatisfied(outcome, present ? 1 : 0),
      // A snapshot carries `sourceFilesDigest`, not a file list, so no before-value for a kill
      // entry exists to compare against.
      direction: "unknown"
    };
  }
  if (outcome.nodeId !== null && !input.afterSnapshot.modules.some((module) => module.nodeId === outcome.nodeId)) {
    // A module that no longer exists is a measurement outcome, not an error: the subject was
    // dissolved. `absent` reads that as satisfied, and the residual keeps the reason visible.
    residuals.push({ code: "outcome-subject-absent", subject: outcome.nodeId, severity: "warning" });
  }
  const observedValue = readSnapshotMetric(input.afterSnapshot, metric, outcome.nodeId);
  return {
    outcomeId: outcome.outcomeId,
    observedValue,
    satisfied: outcomeSatisfied(outcome, observedValue),
    direction: outcomeDirection(outcome, observedValue, before)
  };
}

function outcomeDirection(
  outcome: RefactorTargetOutcomeV1,
  observedValue: number | null,
  before: ModuleStatisticsSnapshotV1 | undefined
): RefactorOutcomeDirection {
  if (!before) return "unknown";
  const beforeValue = readSnapshotMetric(before, outcome.metric as RefactorResolutionMetric, outcome.nodeId);
  if (beforeValue === null || observedValue === null) return "unknown";
  if (beforeValue === observedValue) return "unchanged";
  if (LOWER_IS_BETTER.has(outcome.operator)) return observedValue < beforeValue ? "improved" : "regressed";
  if (HIGHER_IS_BETTER.has(outcome.operator)) return observedValue > beforeValue ? "improved" : "regressed";
  if (outcome.value === null) return "unknown";
  const beforeDistance = Math.abs(beforeValue - outcome.value);
  const afterDistance = Math.abs(observedValue - outcome.value);
  if (afterDistance === beforeDistance) return "unchanged";
  return afterDistance < beforeDistance ? "improved" : "regressed";
}

/**
 * The six-step ladder. `stale` is the single "cannot decide" arm and bypasses everything below it,
 * which is why verify on an unindexed or dirty worktree can never return `resolved`: the frozen
 * validator forbids `resolved` under incomplete coverage, so the only honest answer left is that
 * this measurement decides nothing.
 */
function decideDisposition(input: {
  stale: boolean;
  expectedOutcomes: readonly RefactorTargetOutcomeV1[];
  observedOutcomes: readonly RefactorObservedOutcomeV1[];
  residuals: RefactorResidualV1[];
}): RefactorResolutionDisposition {
  if (input.stale) return "stale";
  if (input.observedOutcomes.some((outcome) => outcome.direction === "regressed")) return "regressed";
  const required = input.expectedOutcomes.filter((outcome) => outcome.required);
  if (required.length === 0) {
    input.residuals.push({ code: "no-required-outcome", subject: "expectedOutcomes", severity: "warning" });
    return "not_improved";
  }
  const observedById = new Map(input.observedOutcomes.map((outcome) => [outcome.outcomeId, outcome]));
  const satisfied = required.filter((outcome) => observedById.get(outcome.outcomeId)?.satisfied === true).length;
  if (satisfied === required.length) return "resolved";
  return satisfied === 0 ? "not_improved" : "partially_resolved";
}

/**
 * The frozen `outcomeSatisfied` rule from `packages/contracts`, which does not export it. The
 * authority stays there: `refactorVerifyInvariantIssues` recomputes every `satisfied` flag and
 * `evaluateResolution` throws on any disagreement, so a drift between the two fails closed rather
 * than shipping a verdict this file invented.
 */
function outcomeSatisfied(outcome: RefactorTargetOutcomeV1, observedValue: number | null): boolean {
  switch (outcome.operator) {
    case "absent":
      return observedValue === null || observedValue === 0;
    case "present":
      return observedValue !== null && observedValue !== 0;
    case "equals":
      return observedValue !== null && outcome.value !== null && observedValue === outcome.value;
    case "greater_than":
      return observedValue !== null && outcome.value !== null && observedValue > outcome.value;
    case "less_than":
      return observedValue !== null && outcome.value !== null && observedValue < outcome.value;
  }
}

function sealOutcome(outcome: Omit<RefactorTargetOutcomeV1, "outcomeId">): RefactorTargetOutcomeV1 {
  return { ...outcome, outcomeId: refactorResolutionOutcomeId(outcome) };
}

/**
 * Two outcomes with the same id are the same requirement; keeping both would double-count it.
 * Two that disagree on content are not, and silently keeping the first would erase the second.
 */
function dedupeOutcomes(outcomes: readonly RefactorTargetOutcomeV1[]): RefactorTargetOutcomeV1[] {
  const byId = new Map<string, RefactorTargetOutcomeV1>();
  for (const outcome of outcomes) {
    const seen = byId.get(outcome.outcomeId);
    if (!seen) byId.set(outcome.outcomeId, outcome);
    else if (digestJson(seen as unknown as Json) !== digestJson(outcome as unknown as Json)) {
      throw new Error(`AC_SCHEMA_INVALID: outcomeId ${outcome.outcomeId} names two different outcomes`);
    }
  }
  return [...byId.values()];
}

/** Ordered by id, exactly as the snapshot builder orders every model collection before digesting. */
function byDeclaredId(left: { id: string }, right: { id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * The snapshot builder's `modelDigest`, recomputed. `@archcontext/core/module-statistics` exports
 * no helper for it, so this is `digestJson` over the same canonical input the builder digests; a
 * drift between the two reads as an unbound model and forces `stale` rather than a silent pass.
 */
function nativeModelDigest(model: NativeModel): string {
  return digestJson({
    nodes: [...model.nodes].sort(byDeclaredId),
    relations: [...model.relations].sort(byDeclaredId),
    flows: [...(model.flows ?? [])].sort(byDeclaredId)
  } as unknown as Json);
}

/**
 * Whether the tracked-file set could have produced this snapshot.
 *
 * A snapshot carries no repository-wide file-list digest, so the binding is the strongest one the
 * frozen shape allows: ownership resolved over these paths must reproduce every declared module's
 * `footprint.sourceFilesDigest` and the three ownership counts. A file that no declared module
 * claims is bound only by `unownedFileCount`.
 */
function trackedFilesBindSnapshot(input: RefactorResolutionInputV1): boolean {
  const files = [...input.afterTrackedFiles].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const lineCounts = new Map(files.map((file) => [file.path, file.lineCount]));
  const ownership = resolveOwnership([...input.afterModel.nodes].sort(byDeclaredId), files.map((file) => file.path));
  const summary = input.afterSnapshot.repositorySummary;
  if (ownership.ownedFileCount !== summary.ownedFileCount) return false;
  if (ownership.unownedFileCount !== summary.unownedFileCount) return false;
  if (ownership.multiplyOwnedFileCount !== summary.multiplyOwnedFileCount) return false;
  return input.afterSnapshot.modules.every((module) => module.footprint === null
    || digestJson((ownership.filesByNode.get(module.nodeId) ?? [])
      .map((path) => ({ path, lineCount: lineCounts.get(path) ?? 0 })) as unknown as Json) === module.footprint.sourceFilesDigest);
}

/** `sortedUniqueIssues` in the frozen validator checks order, not just uniqueness. */
function sortOutcomes(outcomes: readonly RefactorTargetOutcomeV1[]): RefactorTargetOutcomeV1[] {
  return [...outcomes].sort((left, right) => left.outcomeId.localeCompare(right.outcomeId));
}

function sortResiduals(residuals: readonly RefactorResidualV1[]): RefactorResidualV1[] {
  const byKey = new Map<string, RefactorResidualV1>();
  for (const residual of residuals) byKey.set(`${residual.code}:${residual.subject}`, residual);
  return [...byKey.keys()].sort().map((key) => byKey.get(key)!) as RefactorResidualV1[];
}
