import {
  ARCHITECTURE_MAJOR_CHANGE_REASON_CODES,
  RECOMMENDATION_SCHEMA_VERSION,
  RECOMMENDATION_V3_SCHEMA_VERSION,
  REFACTOR_OBSERVATION_KINDS,
  REFACTOR_PROPOSAL_AUTHOR_KINDS,
  REFACTOR_PROPOSAL_AUTHOR_PAIRS,
  REFACTOR_PROPOSAL_AUTHOR_SOURCES,
  REFACTOR_SCALES,
  REFACTOR_SCALE_REASON_CODES,
  digestJson,
  recommendationV3InvariantIssues,
  type ArchitectureEventV1,
  type ArchitectureRepositoryIdentityV1,
  type ArchitectureWorktreeIdentityV1,
  type EvidenceBindingV1,
  type EvidenceItemV2,
  type EvidenceLifecycleOperationV1,
  type EvidenceStateAtCursorV1,
  type Json,
  type ModuleStatisticsSnapshotV1,
  type RecommendationAuthorV1,
  type RecommendationV2,
  type RecommendationV3,
  type RefactorAssessmentV1,
  type RefactorProposalAuthorKind,
  type RefactorProposalAuthorSource,
  type RefactorProposalV1
} from "@archcontext/contracts";
import { architectureSubjectSelectorId } from "@archcontext/core/architecture-delta";
import {
  ARCHITECTURE_EVIDENCE_LIFECYCLE_PAYLOAD_VERSION,
  evidenceLifecycleValueDigest,
  type RecommendationLedgerRecordV1
} from "@archcontext/core/architecture-ledger";
import {
  planRefactorRecommendationRun,
  refactorRecommendationRunLedgerPayload,
  type PreviousRecommendationV3,
  type RefactorRecommendationRunPlan
} from "@archcontext/core/recommendation-engine";
import { deriveObservationOutcomes } from "@archcontext/core/refactor-assessment";

/**
 * A scan holds its measured snapshot and assessment in memory only. The cap keeps the daemon
 * from turning into an unbounded parallel store of measurements the ledger never accepted; an
 * evicted digest fails closed at `refactor record` and the caller re-runs the scan.
 */
export const REFACTOR_ASSESSMENT_REGISTRY_CAPACITY = 8;
export const REFACTOR_CLASSIFIER_RULESET_SCHEMA_VERSION = "archcontext.refactor-classifier-ruleset/v1" as const;
export const RECOMMENDATION_V3_MIGRATION_EVENT_TYPE = "architecture.recommendation.v3-migration" as const;
export const REFACTOR_SCAN_EVENT_TYPE = "architecture.refactor.scan" as const;

export interface RegisteredRefactorAssessmentV1 {
  snapshot: ModuleStatisticsSnapshotV1;
  assessment: RefactorAssessmentV1;
  /** The proposal returned by `assessRefactor`, carrying resolved `unresolvedTargets`. */
  proposal?: RefactorProposalV1;
  headSha: string;
  worktreeDigest: string;
}

/** Bounded LRU keyed by `assessmentDigest`. In-process only; never dispatched over RPC. */
export class RefactorAssessmentRegistry {
  private readonly entries = new Map<string, RegisteredRefactorAssessmentV1>();

  constructor(private readonly capacity: number = REFACTOR_ASSESSMENT_REGISTRY_CAPACITY) {}

  register(entry: RegisteredRefactorAssessmentV1): string {
    const key = entry.assessment.assessmentDigest;
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return key;
  }

  get(assessmentDigest: string): RegisteredRefactorAssessmentV1 | undefined {
    const entry = this.entries.get(assessmentDigest);
    if (!entry) return undefined;
    this.entries.delete(assessmentDigest);
    this.entries.set(assessmentDigest, entry);
    return entry;
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * `RecommendationRunV1.catalogDigest` has no practice catalog to bind for a refactor run, so it
 * binds the classifier ruleset instead: the closed enums plus the engine version that decided the
 * scale. A run replayed under a changed ruleset is visibly a different run.
 */
export function refactorClassifierRulesetDigest(engineVersion: string): string {
  return digestJson({
    schemaVersion: REFACTOR_CLASSIFIER_RULESET_SCHEMA_VERSION,
    engineVersion,
    scales: [...REFACTOR_SCALES],
    scaleReasonCodes: [...REFACTOR_SCALE_REASON_CODES],
    observationKinds: [...REFACTOR_OBSERVATION_KINDS],
    majorChangeReasonCodes: [...ARCHITECTURE_MAJOR_CHANGE_REASON_CODES]
  } as unknown as Json);
}

/**
 * The no-self-authored gate. `daemon`, `system`, `hook` and `migration` are ArchContext acting on
 * its own behalf and can never author a refactor proposal.
 */
export function refactorProposalAuthorPairIssues(author: RecommendationAuthorV1): string[] {
  const issues: string[] = [];
  const kindAllowed = (REFACTOR_PROPOSAL_AUTHOR_KINDS as readonly string[]).includes(author.kind);
  const sourceAllowed = (REFACTOR_PROPOSAL_AUTHOR_SOURCES as readonly string[]).includes(author.source);
  if (!kindAllowed) issues.push(`proposal.authoredBy.kind must not be ${author.kind}`);
  if (!sourceAllowed) issues.push(`proposal.authoredBy.source must not be ${author.source}`);
  if (author.id.trim() === "") issues.push("proposal.authoredBy.id must not be empty");
  if (kindAllowed && sourceAllowed) {
    const pairs = REFACTOR_PROPOSAL_AUTHOR_PAIRS[author.kind as RefactorProposalAuthorKind];
    if (!pairs.includes(author.source as RefactorProposalAuthorSource)) {
      issues.push(`proposal.authoredBy.kind ${author.kind} is not compatible with source ${author.source}`);
    }
  }
  return issues;
}

export interface RefactorRecordEventInput {
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  registered: RegisteredRefactorAssessmentV1;
  previousRecommendations: readonly RecommendationLedgerRecordV1[];
  evidenceState: EvidenceStateAtCursorV1;
  graphDigest: string;
  catalogDigest: string;
  now: string;
}

export interface RefactorRecordEventPlan {
  plan: RefactorRecommendationRunPlan;
  event: ArchitectureEventV1;
  evidenceOperations: EvidenceLifecycleOperationV1[];
}

/**
 * Builds the single event that records one refactor scan. `operations` is empty by construction:
 * a scan observes the graph, it never mutates it, which is exactly why `ledger rebuild` replays
 * to the same `graphDigest` with or without this event.
 */
export function buildRefactorRecordEvent(input: RefactorRecordEventInput): RefactorRecordEventPlan {
  const planned = planRefactorRecommendationRun({
    repository: input.repository,
    worktree: input.worktree,
    snapshot: input.registered.snapshot,
    assessment: input.registered.assessment,
    ...(input.registered.proposal ? { proposal: input.registered.proposal } : {}),
    previousRecommendations: previousRecommendationsV3(input.previousRecommendations),
    catalogDigest: input.catalogDigest,
    now: input.now
  });
  const plan = withDerivedObservationOutcomes(planned);
  const evidenceOperations = evidenceLifecycleOperations(input.evidenceState, plan.evidenceItems, plan.evidenceBindings);
  const inputDigest = digestJson({
    schemaVersion: "archcontext.refactor-record-event-input/v1",
    runId: plan.run.runId,
    assessmentDigest: input.registered.assessment.assessmentDigest,
    recommendationIds: plan.run.recommendationIds,
    evidenceItemIds: plan.evidenceItems.map((item) => item.evidenceId),
    evidenceBindingIds: plan.evidenceBindings.map((binding) => binding.bindingId),
    graphDigest: input.graphDigest
  } as unknown as Json);
  const event: ArchitectureEventV1 = {
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: `architecture_event.refactor_scan.${digestSuffix(inputDigest)}`,
    eventType: REFACTOR_SCAN_EVENT_TYPE,
    payloadVersion: evidenceOperations.length > 0
      ? ARCHITECTURE_EVIDENCE_LIFECYCLE_PAYLOAD_VERSION
      : "archcontext.recommendation-run/v1",
    repository: input.repository,
    worktree: input.worktree,
    baseDigest: input.graphDigest,
    resultingDigest: input.graphDigest,
    headSha: input.worktree.headSha,
    actor: { kind: "daemon", id: "archctxd" },
    source: "refactor_scan",
    timestamp: input.now,
    idempotencyKey: `architecture-ledger-refactor-record:${plan.run.runId}`,
    provenance: {
      producer: "runtime-daemon",
      command: "archctx refactor record",
      inputDigest
    },
    payload: {
      ...refactorRecommendationRunLedgerPayload(plan),
      operations: [],
      ...(evidenceOperations.length > 0 ? { evidenceOperations: evidenceOperations as unknown as Json } : {}),
      title: "Refactor scan recording",
      summary: `Recorded ${plan.recommendations.length} refactor recommendation(s) from assessment ${input.registered.assessment.assessmentDigest}.`
    } as unknown as Json
  };
  return { plan, event, evidenceOperations };
}

export interface RecommendationV3MigrationPlan {
  upgraded: RecommendationV3[];
  /** Absent when nothing needs upgrading; a second run therefore appends nothing. */
  event?: ArchitectureEventV1;
  inputDigest: string;
}

/**
 * Upcasts every v2 recommendation still latest for its id into v3 and appends the result as one
 * migration event. It never rewrites a row: the event stream is the authority, so an in-place
 * `UPDATE` would leave the log at v2. `operations` stays empty, so replay parity holds.
 */
export function planRecommendationV3Migration(input: {
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  recommendations: readonly RecommendationLedgerRecordV1[];
  graphDigest: string;
  now: string;
}): RecommendationV3MigrationPlan {
  const latest = latestRecommendationsById(input.recommendations);
  const upgraded = latest
    .filter((recommendation): recommendation is RecommendationV2 => recommendation.schemaVersion === RECOMMENDATION_SCHEMA_VERSION)
    .sort((left, right) => left.recommendationId.localeCompare(right.recommendationId))
    .map((recommendation) => upcastRecommendationToV3(recommendation, input.repository.repositoryId, input.now));
  const inputDigest = digestJson({
    schemaVersion: "archcontext.recommendation-v3-migration-input/v1",
    graphDigest: input.graphDigest,
    recommendationIds: upgraded.map((recommendation) => recommendation.recommendationId),
    fingerprints: upgraded.map((recommendation) => recommendation.fingerprint)
  } as unknown as Json);
  if (upgraded.length === 0) return { upgraded, inputDigest };
  const event: ArchitectureEventV1 = {
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: `architecture_event.recommendation_v3_migration.${digestSuffix(inputDigest)}`,
    eventType: RECOMMENDATION_V3_MIGRATION_EVENT_TYPE,
    payloadVersion: RECOMMENDATION_V3_SCHEMA_VERSION,
    repository: input.repository,
    worktree: input.worktree,
    baseDigest: input.graphDigest,
    resultingDigest: input.graphDigest,
    headSha: input.worktree.headSha,
    actor: { kind: "migration", id: "archctx-recommendation-v3-migration" },
    source: "migration",
    timestamp: input.now,
    idempotencyKey: `architecture-ledger-recommendation-v3-migration:${inputDigest}`,
    provenance: {
      producer: "runtime-daemon",
      command: "archctx ledger migrate --recommendation-v3",
      inputDigest
    },
    payload: {
      recommendationRuns: [],
      recommendations: upgraded as unknown as Json,
      feedback: [],
      waivers: [],
      operations: [],
      title: "Recommendation v2 to v3 migration",
      summary: `Upgraded ${upgraded.length} recommendation(s) to ${RECOMMENDATION_V3_SCHEMA_VERSION}.`
    } as unknown as Json
  };
  return { upgraded, event, inputDigest };
}

export function latestRecommendationsById(
  recommendations: readonly RecommendationLedgerRecordV1[]
): RecommendationLedgerRecordV1[] {
  const latest = new Map<string, { recommendation: RecommendationLedgerRecordV1; index: number }>();
  let index = 0;
  for (const recommendation of recommendations) {
    const current = latest.get(recommendation.recommendationId);
    if (
      !current
      || recommendation.updatedAt.localeCompare(current.recommendation.updatedAt) > 0
      || (recommendation.updatedAt === current.recommendation.updatedAt && index > current.index)
    ) {
      latest.set(recommendation.recommendationId, { recommendation, index });
    }
    index += 1;
  }
  return [...latest.values()].map((entry) => entry.recommendation);
}

/**
 * v2 carried no author, so the honest upcast names the daemon that wrote the record rather than
 * re-deriving a per-event actor the v2 row never bound. `practiceId` is never invented: a v2
 * practice recommendation without one is an unrepresentable record and fails closed.
 */
function upcastRecommendationToV3(recommendation: RecommendationV2, repositoryId: string, now: string): RecommendationV3 {
  if (!recommendation.practiceId) {
    throw new Error(`AC_SCHEMA_INVALID: recommendation ${recommendation.recommendationId} has no practiceId to upgrade`);
  }
  const baselineDigest = recommendation.extensions?.baselineDigest ?? null;
  if (baselineDigest !== null && typeof baselineDigest !== "string") {
    throw new Error(`AC_SCHEMA_INVALID: recommendation ${recommendation.recommendationId} has a non-string baselineDigest`);
  }
  const { extensions, ...base } = recommendation;
  const upgraded: RecommendationV3 = {
    ...base,
    schemaVersion: RECOMMENDATION_V3_SCHEMA_VERSION,
    practiceId: recommendation.practiceId,
    category: "practice",
    payload: { practiceId: recommendation.practiceId, baselineDigest },
    authoredBy: { kind: "daemon", id: "archctxd", source: "daemon" },
    subjectSelectorId: architectureSubjectSelectorId("node", repositoryId, `node:${recommendation.subject}`),
    relations: {},
    updatedAt: now,
    extensions: {
      ...(extensions ?? {}),
      recommendationV3Migration: {
        previousSchemaVersion: RECOMMENDATION_SCHEMA_VERSION,
        previousUpdatedAt: recommendation.updatedAt,
        migratedAt: now
      }
    }
  };
  const issues = recommendationV3InvariantIssues(upgraded);
  if (issues.length > 0) throw new Error(`AC_SCHEMA_INVALID: ${issues.join("; ")}`);
  return upgraded;
}

function previousRecommendationsV3(recommendations: readonly RecommendationLedgerRecordV1[]): PreviousRecommendationV3[] {
  return recommendations.map((recommendation) => ({
    recommendationId: recommendation.recommendationId,
    fingerprint: recommendation.fingerprint,
    status: recommendation.status,
    updatedAt: recommendation.updatedAt
  }));
}

/**
 * Incremental, unlike the full-state reconcile the YAML import path uses: a scan adds evidence
 * and must never emit a `remove` for an item some other producer owns. Shared with `refactor
 * verify`, which appends against the same evidence state and must not `create` an id a prior
 * scan already made live — the ledger throws on that, it does not overwrite.
 */
export function evidenceLifecycleOperations(
  previous: EvidenceStateAtCursorV1,
  items: readonly EvidenceItemV2[],
  bindings: readonly EvidenceBindingV1[]
): EvidenceLifecycleOperationV1[] {
  const currentItems = new Map(previous.evidenceItems.map((item) => [item.evidenceId, item]));
  const currentBindings = new Map(previous.evidenceBindings.map((binding) => [binding.bindingId, binding]));
  const operations: EvidenceLifecycleOperationV1[] = [];
  // Items first: a binding create requires its evidence item to already be live in this event.
  for (const item of [...items].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId))) {
    const existing = currentItems.get(item.evidenceId);
    if (!existing) {
      operations.push({ target: "item", action: "create", evidenceId: item.evidenceId, value: item });
      continue;
    }
    const previousDigest = evidenceLifecycleValueDigest(existing);
    if (previousDigest === evidenceLifecycleValueDigest(item)) continue;
    operations.push({ target: "item", action: "update", evidenceId: item.evidenceId, previousDigest, value: item });
  }
  for (const binding of [...bindings].sort((left, right) => left.bindingId.localeCompare(right.bindingId))) {
    const existing = currentBindings.get(binding.bindingId);
    if (!existing) {
      operations.push({ target: "binding", action: "create", bindingId: binding.bindingId, value: binding });
      continue;
    }
    const previousDigest = evidenceLifecycleValueDigest(existing);
    if (previousDigest === evidenceLifecycleValueDigest(binding)) continue;
    operations.push({ target: "binding", action: "update", bindingId: binding.bindingId, previousDigest, value: binding });
  }
  return operations;
}

/**
 * Fills the acceptance test for every recorded structural observation.
 *
 * The recommendation engine records the observed fact and deliberately leaves `derivedOutcomes`
 * empty rather than fork a second kind-to-outcome definition; `refactor-assessment` owns that one.
 * Recording the fact without the test it closes on would make the record permanently
 * unverifiable — `refactor verify` would answer `not_improved` with `no-required-outcome` forever.
 *
 * Safe to fill after planning: `recommendationV3FingerprintInput` hashes only `kind` and
 * `affectedNodeIds` for this category, so the fingerprint, `recommendationId` and every dedup
 * decision above are untouched.
 */
function withDerivedObservationOutcomes(plan: RefactorRecommendationRunPlan): RefactorRecommendationRunPlan {
  const recommendations = plan.recommendations.map((recommendation) => {
    if (recommendation.category !== "structural_observation") return recommendation;
    const payload = recommendation.payload;
    return {
      ...recommendation,
      payload: {
        ...payload,
        derivedOutcomes: deriveObservationOutcomes({
          kind: payload.kind,
          subjectSelectorId: recommendation.subjectSelectorId,
          affectedNodeIds: payload.affectedNodeIds
        })
      }
    } as RecommendationV3;
  });
  return { ...plan, recommendations };
}

function digestSuffix(digest: string): string {
  return digest.replace(/^sha256:/, "").slice(0, 16);
}
