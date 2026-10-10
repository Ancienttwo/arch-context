import {
  ARCHITECTURE_MAJOR_CHANGE_REASON_CODES,
  REFACTOR_OBSERVATION_EVIDENCE_LIMIT,
  REFACTOR_OBSERVATION_KINDS,
  REFACTOR_PROPOSAL_AUTHOR_KINDS,
  REFACTOR_PROPOSAL_AUTHOR_PAIRS,
  REFACTOR_PROPOSAL_AUTHOR_SOURCES,
  REFACTOR_SCALES,
  REFACTOR_SCALE_REASON_CODES,
  digestJson,
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
  type RecommendationV3,
  type RefactorAssessmentV1,
  type RefactorProposalAuthorKind,
  type RefactorProposalAuthorSource,
  type RefactorProposalV1
} from "@archcontext/contracts";
import {
  ARCHITECTURE_EVIDENCE_LIFECYCLE_PAYLOAD_VERSION,
  ARCHITECTURE_LEDGER_MAX_PERSISTED_JSON_BYTES,
  architectureLedgerPersistedJsonBytes,
  evidenceLifecycleValueDigest,
  type RecommendationLedgerRecordV1
} from "@archcontext/core/architecture-ledger";
import {
  planRefactorRecommendationRun,
  refactorRecommendationRunLedgerPayload,
  type PlanRefactorRecommendationRunInput,
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
  const plan = planRefactorRun({
    repository: input.repository,
    worktree: input.worktree,
    snapshot: input.registered.snapshot,
    assessment: input.registered.assessment,
    ...(input.registered.proposal ? { proposal: input.registered.proposal } : {}),
    previousRecommendations: previousRecommendationsV3(input.previousRecommendations),
    catalogDigest: input.catalogDigest,
    now: input.now
  });
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
    payload: refactorRecordEventPayload(plan, evidenceOperations, input.registered.assessment.assessmentDigest)
  };
  return { plan, event, evidenceOperations };
}

/** The persisted payload of a refactor recording event; `planRefactorRun` sizes exactly this. */
function refactorRecordEventPayload(
  plan: RefactorRecommendationRunPlan,
  evidenceOperations: readonly EvidenceLifecycleOperationV1[],
  assessmentDigest: string
): Json {
  return {
    ...refactorRecommendationRunLedgerPayload(plan),
    operations: [],
    ...(evidenceOperations.length > 0 ? { evidenceOperations: evidenceOperations as unknown as Json } : {}),
    title: "Refactor scan recording",
    summary: `Recorded ${plan.recommendations.length} refactor recommendation(s) from assessment ${assessmentDigest}.`
  } as unknown as Json;
}

/**
 * The largest payload `buildRefactorRecordEvent` can persist for `plan` under any ledger evidence
 * state: every item and binding written as an `update`, the largest operation shape (a `create`
 * is the same op without `previousDigest`; an unchanged one is omitted). Sizing this instead of
 * the state at hand keeps a scan preview and the record it previews on the same evidence cut.
 */
function worstCaseRecordEventPayload(plan: RefactorRecommendationRunPlan, assessmentDigest: string): Json {
  const operations: EvidenceLifecycleOperationV1[] = [
    ...plan.evidenceItems.map((item): EvidenceLifecycleOperationV1 => ({
      target: "item",
      action: "update",
      evidenceId: item.evidenceId,
      previousDigest: evidenceLifecycleValueDigest(item),
      value: item
    })),
    ...plan.evidenceBindings.map((binding): EvidenceLifecycleOperationV1 => ({
      target: "binding",
      action: "update",
      bindingId: binding.bindingId,
      previousDigest: evidenceLifecycleValueDigest(binding),
      value: binding
    }))
  ];
  return refactorRecordEventPayload(plan, operations, assessmentDigest);
}

export const REFACTOR_RUN_PERSISTENCE_REASON_CODE = "refactor-run-exceeds-ledger-size-limit" as const;

/**
 * Whether the planned run fits one ledger event. `measuredBytes` is the worst-case persisted size
 * of the recording event at the plan's evidence cut; when nothing fits, it is the size with every
 * evidence sample empty, the smallest event the run can have.
 */
export interface RefactorRunRecordingV1 {
  recordable: boolean;
  reasonCode: typeof REFACTOR_RUN_PERSISTENCE_REASON_CODE | null;
  measuredBytes: number;
  limitBytes: number;
}

/**
 * The run cannot be recorded in one ledger event even with every evidence sample empty: what is
 * left (the baseline snapshot, the records' ids, affected nodes and outcomes) is itself over the
 * ceiling. Typed so the record, the one-step decision and a candidate `show` all refuse the same
 * way; the read-only scan reports it as `recording.recordable: false` instead.
 */
export class RefactorRunTooLargeError extends Error {
  readonly code = "AC_REFACTOR_RUN_TOO_LARGE" as const;
  readonly reasonCode = REFACTOR_RUN_PERSISTENCE_REASON_CODE;

  constructor(readonly recording: RefactorRunRecordingV1) {
    super(refactorRunTooLargeMessage(recording));
    this.name = "RefactorRunTooLargeError";
  }
}

export function refactorRunTooLargeMessage(recording: RefactorRunRecordingV1): string {
  return `the refactor run event needs ${recording.measuredBytes} bytes with every evidence sample empty, over the ledger's ${recording.limitBytes}-byte persisted-JSON limit`;
}

/**
 * The one planning path a scan preview and a record share: the recommendation engine's plan with
 * every structural observation's acceptance test filled. A scan candidate therefore shows exactly
 * the `derivedOutcomes` its record will carry.
 *
 * Never throws for size: a run that no evidence cut can fit is returned at the empty cut with
 * `recording.recordable: false`, so a read-only scan still answers. `planRefactorRun` is the
 * recording entry point and refuses it.
 */
export function planRefactorRunWithRecording(
  input: PlanRefactorRecommendationRunInput
): { plan: RefactorRecommendationRunPlan; recording: RefactorRunRecordingV1 } {
  // The per-run evidence byte budget is whatever the ledger ceiling leaves after the rest of the
  // run. Evidence is the only part that can be cut without changing a fact, so every sample is
  // cut to one shared limit, largest first, until the worst-case event fits. The plan is a pure
  // function of its input, so the same input always lands on the same limit.
  for (let limit = REFACTOR_OBSERVATION_EVIDENCE_LIMIT; ; limit -= 1) {
    const plan = withDerivedObservationOutcomes(planRefactorRecommendationRun({ ...input, evidenceSampleLimit: limit }));
    const measuredBytes = architectureLedgerPersistedJsonBytes(worstCaseRecordEventPayload(plan, input.assessment.assessmentDigest));
    const recordable = measuredBytes <= ARCHITECTURE_LEDGER_MAX_PERSISTED_JSON_BYTES;
    if (recordable || limit === 0) {
      return {
        plan,
        recording: {
          recordable,
          reasonCode: recordable ? null : REFACTOR_RUN_PERSISTENCE_REASON_CODE,
          measuredBytes,
          limitBytes: ARCHITECTURE_LEDGER_MAX_PERSISTED_JSON_BYTES
        }
      };
    }
  }
}

/** The recording plan: `planRefactorRunWithRecording`, refusing a run no evidence cut can fit. */
export function planRefactorRun(input: PlanRefactorRecommendationRunInput): RefactorRecommendationRunPlan {
  const { plan, recording } = planRefactorRunWithRecording(input);
  if (!recording.recordable) throw new RefactorRunTooLargeError(recording);
  return plan;
}

/** The planner's view of ledger records; shared by the scan preview and the record. */
export function previousRecommendationsV3(recommendations: readonly RecommendationLedgerRecordV1[]): PreviousRecommendationV3[] {
  return recommendations.map((recommendation) => ({
    recommendationId: recommendation.recommendationId,
    fingerprint: recommendation.fingerprint,
    status: recommendation.status,
    updatedAt: recommendation.updatedAt,
    observationMetrics: observationMetricsOf(recommendation)
  }));
}

/**
 * The decided measurement a structural observation carries. A record written before observation
 * payloads carried `metrics` has none, and is reported as `null` rather than filled in.
 */
function observationMetricsOf(recommendation: RecommendationLedgerRecordV1): Record<string, number | null> | null {
  if (!("category" in recommendation) || recommendation.category !== "structural_observation") return null;
  const metrics = (recommendation.payload as { metrics?: unknown }).metrics;
  return metrics !== null && typeof metrics === "object" && !Array.isArray(metrics)
    ? { ...(metrics as Record<string, number | null>) }
    : null;
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
