import {
  REFACTOR_OBSERVATION_EVIDENCE_LIMIT,
  REFACTOR_PROPOSAL_AUTHOR_KINDS,
  REFACTOR_PROPOSAL_AUTHOR_PAIRS,
  REFACTOR_PROPOSAL_AUTHOR_SOURCES,
  digestJson,
  type ArchitectureEventV1,
  type ArchitectureRepositoryIdentityV1,
  type ArchitectureWorktreeIdentityV1,
  type EvidenceBindingV1,
  type EvidenceItemV2,
  type EvidenceLifecycleOperationV1,
  type EvidenceStateAtCursorV1,
  type Json,
  type RecommendationAuthorV1,
  type RecommendationV3,
  type RefactorProposalAuthorKind,
  type RefactorProposalAuthorSource
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
import type { RegisteredRefactorAssessmentV1 } from "./refactor-assessment-registry";
import type { RefactorDecisionSetV1 } from "./refactor-decisions";

export * from "./refactor-assessment-registry";

export const REFACTOR_SCAN_EVENT_TYPE = "architecture.refactor.scan" as const;

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
  /** The decision set read under the same writer lock as the record; the human-status authority. */
  decisions: RefactorDecisionSetV1;
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

export function buildRefactorRecordEvent(input: RefactorRecordEventInput): RefactorRecordEventPlan {
  if (input.decisions.namespace !== input.registered.namespace) {
    throw new Error(`AC_REFACTOR_STALE: product.id changed from ${input.registered.namespace} to ${input.decisions.namespace} since the scan; run refactor scan again`);
  }
  const plan = planRefactorRun({
    repository: input.repository,
    worktree: input.worktree,
    snapshot: input.registered.snapshot,
    assessment: input.registered.assessment,
    ...(input.registered.proposal ? { proposal: input.registered.proposal } : {}),
    recommendationNamespace: input.registered.namespace,
    decisionSetDigest: input.decisions.digest,
    previousRecommendations: previousRecommendationsFromAuthority(input.previousRecommendations, input.decisions),
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

export interface RefactorRunRecordingV1 {
  recordable: boolean;
  reasonCode: typeof REFACTOR_RUN_PERSISTENCE_REASON_CODE | null;
  measuredBytes: number;
  limitBytes: number;
}

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

export function planRefactorRunWithRecording(
  input: PlanRefactorRecommendationRunInput
): { plan: RefactorRecommendationRunPlan; recording: RefactorRunRecordingV1 } {
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

export function planRefactorRun(input: PlanRefactorRecommendationRunInput): RefactorRecommendationRunPlan {
  const { plan, recording } = planRefactorRunWithRecording(input);
  if (!recording.recordable) throw new RefactorRunTooLargeError(recording);
  return plan;
}

export function previousRecommendationsFromAuthority(
  recommendations: readonly RecommendationLedgerRecordV1[],
  decisions: RefactorDecisionSetV1
): PreviousRecommendationV3[] {
  const fromLedger: PreviousRecommendationV3[] = recommendations.map((recommendation) => ({
    recommendationId: recommendation.recommendationId,
    fingerprint: recommendation.fingerprint,
    status: recommendation.status,
    updatedAt: recommendation.updatedAt,
    regressesFrom: ("relations" in recommendation ? recommendation.relations?.regressesFrom : undefined) ?? null,
    decisionAuthority: "ledger",
    observationMetrics: observationMetricsOf(recommendation)
  }));
  const fromGit: PreviousRecommendationV3[] = decisions.decisions.map((decision) => ({
    recommendationId: decision.recommendationId,
    fingerprint: decision.fingerprint,
    status: decision.status,
    updatedAt: decision.decidedAt,
    regressesFrom: decision.regressesFrom,
    decisionAuthority: "git",
    observationMetrics: decision.observationMetrics === null ? null : { ...decision.observationMetrics },
    observationScopeDigest: decision.observationScopeDigest
  }));
  return [...fromLedger, ...fromGit];
}

export function latestRecommendationsById(recommendations: readonly RecommendationLedgerRecordV1[]): RecommendationLedgerRecordV1[] {
  const latest = new Map<string, RecommendationLedgerRecordV1>();
  for (const recommendation of recommendations) {
    const current = latest.get(recommendation.recommendationId);
    if (!current || recommendation.updatedAt.localeCompare(current.updatedAt) >= 0) latest.set(recommendation.recommendationId, recommendation);
  }
  return [...latest.values()].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt) || left.recommendationId.localeCompare(right.recommendationId)
  );
}

function observationMetricsOf(recommendation: RecommendationLedgerRecordV1): Record<string, number | null> | null {
  if (!("category" in recommendation) || recommendation.category !== "structural_observation") return null;
  const metrics = (recommendation.payload as { metrics?: unknown }).metrics;
  return metrics !== null && typeof metrics === "object" && !Array.isArray(metrics)
    ? { ...(metrics as Record<string, number | null>) }
    : null;
}

export function evidenceLifecycleOperations(
  previous: EvidenceStateAtCursorV1,
  items: readonly EvidenceItemV2[],
  bindings: readonly EvidenceBindingV1[]
): EvidenceLifecycleOperationV1[] {
  const currentItems = new Map(previous.evidenceItems.map((item) => [item.evidenceId, item]));
  const currentBindings = new Map(previous.evidenceBindings.map((binding) => [binding.bindingId, binding]));
  const operations: EvidenceLifecycleOperationV1[] = [];
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
