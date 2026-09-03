import {
  EVIDENCE_BINDING_SCHEMA_VERSION,
  EVIDENCE_ITEM_SCHEMA_VERSION,
  REFACTOR_RESOLUTION_EVIDENCE_SCHEMA_VERSION,
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
  type RecommendationV3,
  type RefactorExecutionEvidenceRefV1,
  type RefactorResolutionEvidenceV1
} from "@archcontext/contracts";
import { ARCHITECTURE_EVIDENCE_LIFECYCLE_PAYLOAD_VERSION } from "@archcontext/core/architecture-ledger";
import type { NativeModel } from "@archcontext/core/projection-engine";
import { evaluateResolution, refactorOutcomeVocabularyIssues } from "@archcontext/core/refactor-assessment";
import { evidenceLifecycleOperations } from "./refactor-recording";

export const REFACTOR_RESOLUTION_EVENT_TYPE = "architecture.refactor.resolution" as const;
export const REFACTOR_RESOLUTION_EVIDENCE_KIND = "refactor-resolution-evidence" as const;
export const MODULE_STATISTICS_SNAPSHOT_EVIDENCE_KIND = "module-statistics-snapshot" as const;

/**
 * The daemon-local ingress for `refactor verify`, field-for-field what RF5b will freeze as
 * `RefactorVerificationRequestV1`. It stays here rather than in `packages/contracts` because no
 * external JSON ingress exists until the CLI gains `--request-json`, and a schema without an
 * ingress is a frozen surface nobody can exercise.
 */
export interface RuntimeRefactorVerifyInput {
  recommendationId: string;
  /** A caller's claim about the HEAD it measured. A claim that no longer holds is `AC_REFACTOR_STALE`. */
  expectedHeadSha?: string;
  expectedWorktreeDigest?: string;
  executionEvidenceRefs?: RefactorExecutionEvidenceRefV1[];
}

export interface RefactorVerifyInputV1 {
  recommendation: RecommendationV3;
  repository: ArchitectureRepositoryIdentityV1;
  worktree: ArchitectureWorktreeIdentityV1;
  /** The baseline resolved for this record; `evaluateResolution` compares it to the payload's. */
  beforeSnapshotDigest: string;
  beforeSnapshot?: ModuleStatisticsSnapshotV1;
  afterSnapshot: ModuleStatisticsSnapshotV1;
  afterModel: NativeModel;
  afterTrackedFiles: readonly string[];
  executionEvidenceRefs?: readonly RefactorExecutionEvidenceRefV1[];
  evidenceState: EvidenceStateAtCursorV1;
  graphDigest: string;
  verifiedAt: string;
}

export interface RefactorVerifyPlanV1 {
  evidence: RefactorResolutionEvidenceV1;
  resolutionItem: EvidenceItemV2;
  afterSnapshotItem: EvidenceItemV2;
  binding: EvidenceBindingV1;
  evidenceOperations: EvidenceLifecycleOperationV1[];
  event: ArchitectureEventV1;
}

/**
 * Plans the single event that records one verification.
 *
 * Pure and clock-free by construction: `verifiedAt` and every identity arrive as inputs, so the
 * daemon owns the clock and the filesystem while this owns the verdict. `operations` is empty —
 * a verification observes the graph and never mutates it, which is why `ledger rebuild` replays
 * to the same `graphDigest` with or without the event.
 */
export function runRefactorVerify(input: RefactorVerifyInputV1): RefactorVerifyPlanV1 {
  const evidence = evaluateResolution({
    recommendation: input.recommendation,
    beforeSnapshotDigest: input.beforeSnapshotDigest,
    ...(input.beforeSnapshot ? { beforeSnapshot: input.beforeSnapshot } : {}),
    afterSnapshot: input.afterSnapshot,
    afterModel: input.afterModel,
    afterTrackedFiles: input.afterTrackedFiles,
    ...(input.executionEvidenceRefs ? { executionEvidenceRefs: input.executionEvidenceRefs } : {}),
    verifiedAt: input.verifiedAt
  });
  const items = resolutionEvidenceItems({
    evidence,
    afterSnapshot: input.afterSnapshot,
    repository: input.repository,
    evidenceState: input.evidenceState
  });
  const evidenceOperations = evidenceLifecycleOperations(
    input.evidenceState,
    [items.resolutionItem, items.afterSnapshotItem],
    [items.binding]
  );
  const inputDigest = digestJson({
    schemaVersion: "archcontext.refactor-resolution-event-input/v1",
    recommendationId: evidence.recommendationId,
    resolutionDigest: evidence.resolutionDigest,
    graphDigest: input.graphDigest
  } as unknown as Json);
  const event: ArchitectureEventV1 = {
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: `architecture_event.refactor_resolution.${digestSuffix(inputDigest)}`,
    eventType: REFACTOR_RESOLUTION_EVENT_TYPE,
    payloadVersion: ARCHITECTURE_EVIDENCE_LIFECYCLE_PAYLOAD_VERSION,
    repository: input.repository,
    worktree: input.worktree,
    baseDigest: input.graphDigest,
    resultingDigest: input.graphDigest,
    headSha: input.worktree.headSha,
    actor: { kind: "daemon", id: "archctxd" },
    source: "refactor_scan",
    timestamp: input.verifiedAt,
    // `resolutionDigest` excludes `verifiedAt`, so re-verifying the same measurement at the same
    // HEAD lands on the same key instead of appending a second identical verdict.
    idempotencyKey: `refactor-resolution:${evidence.resolutionDigest}`,
    provenance: {
      producer: "runtime-daemon",
      command: "archctx refactor verify",
      inputDigest
    },
    payload: {
      recommendationRuns: [],
      recommendations: [],
      feedback: [],
      waivers: [],
      operations: [],
      evidenceOperations: evidenceOperations as unknown as Json,
      title: "Refactor resolution verification",
      summary: `Verified ${evidence.recommendationId} at ${evidence.verifiedHeadSha}: ${evidence.disposition}.`
    } as unknown as Json
  };
  return { evidence, ...items, evidenceOperations, event };
}

/**
 * The two items and the one binding a verification persists: the verdict, the AFTER measurement it
 * was read from, and the link that makes `book evidence <recommendationId>` find both.
 *
 * The snapshot item is identified by the snapshot digest, so when `refactor record` already
 * persisted this exact measurement the live item is reused verbatim rather than rewritten: the
 * evidence is the same measurement, and re-stamping its provenance would record a change that did
 * not happen.
 */
export function resolutionEvidenceItems(input: {
  evidence: RefactorResolutionEvidenceV1;
  afterSnapshot: ModuleStatisticsSnapshotV1;
  repository: ArchitectureRepositoryIdentityV1;
  evidenceState: EvidenceStateAtCursorV1;
}): { resolutionItem: EvidenceItemV2; afterSnapshotItem: EvidenceItemV2; binding: EvidenceBindingV1 } {
  const resolutionItem = sealEvidenceItem({
    schemaVersion: EVIDENCE_ITEM_SCHEMA_VERSION,
    evidenceId: `evidence.refactor_resolution.${digestSuffix(input.evidence.resolutionDigest)}`,
    kind: REFACTOR_RESOLUTION_EVIDENCE_KIND,
    strength: "verified",
    polarity: "positive",
    origin: "runtime-daemon",
    // The recommendation itself, so `book evidence <recommendationId>` returns the verdict and not
    // only the binding that points at it.
    subject: input.evidence.recommendationId,
    selector: { kind: "repository", id: input.repository.repositoryId },
    summary: `Refactor resolution ${input.evidence.disposition} for ${input.evidence.recommendationId}.`,
    coverage: { level: input.afterSnapshot.codeFacts.coverage, scope: "refactor-resolution-evidence" },
    supports: ["recommendation", "complete"],
    provenance: {
      producer: "runtime-daemon",
      command: "archctx refactor verify",
      inputDigest: input.evidence.resolutionDigest
    },
    // Dated by the measurement, not by the daemon clock, so the item digest is a function of what
    // was measured; `verifiedAt` rides in the excluded `extensions`.
    createdAt: input.afterSnapshot.createdAt,
    digest: "",
    extensions: { refactorResolution: input.evidence as unknown as Json }
  });
  const afterSnapshotEvidenceId = `evidence.module_statistics_snapshot.${digestSuffix(input.afterSnapshot.snapshotDigest)}`;
  const live = input.evidenceState.evidenceItems.find((item) => item.evidenceId === afterSnapshotEvidenceId);
  const afterSnapshotItem = live ?? sealEvidenceItem({
    schemaVersion: EVIDENCE_ITEM_SCHEMA_VERSION,
    evidenceId: afterSnapshotEvidenceId,
    kind: MODULE_STATISTICS_SNAPSHOT_EVIDENCE_KIND,
    strength: "observed",
    polarity: "positive",
    origin: "runtime-daemon",
    subject: `repository:${input.repository.repositoryId}`,
    selector: { kind: "snapshot", id: input.afterSnapshot.snapshotDigest },
    summary: `Module statistics after-state for ${input.afterSnapshot.repositorySummary.moduleCount} declared module(s).`,
    coverage: { level: input.afterSnapshot.codeFacts.coverage, scope: "module-statistics-snapshot" },
    supports: ["recommendation"],
    provenance: {
      producer: "runtime-daemon",
      command: "archctx refactor verify",
      inputDigest: input.afterSnapshot.snapshotDigest
    },
    createdAt: input.afterSnapshot.createdAt,
    digest: "",
    extensions: { moduleStatisticsSnapshot: input.afterSnapshot as unknown as Json }
  });
  const binding: EvidenceBindingV1 = {
    schemaVersion: EVIDENCE_BINDING_SCHEMA_VERSION,
    bindingId: `binding.${digestSuffix(digestJson({
      evidenceId: resolutionItem.evidenceId,
      recommendationId: input.evidence.recommendationId
    } as unknown as Json))}`,
    evidenceId: resolutionItem.evidenceId,
    target: { kind: "recommendation", id: input.evidence.recommendationId },
    bindingReason: "deterministic-check",
    // The only authority effect that can close a recommendation; the gate still requires the
    // disposition itself to be `resolved`.
    authorityEffect: "complete-eligible",
    createdAt: input.afterSnapshot.createdAt,
    provenance: {
      producer: "runtime-daemon",
      command: "archctx refactor verify",
      inputDigest: resolutionItem.evidenceId
    }
  };
  return { resolutionItem, afterSnapshotItem, binding };
}

/**
 * The resolve gate's lookup: the verdict a caller named by `--evidence-digest`, or nothing.
 * Reading the replayed evidence state rather than re-scanning events keeps one definition of
 * which items are live after tombstones.
 */
export function findResolutionEvidence(
  evidenceState: EvidenceStateAtCursorV1,
  resolutionDigest: string
): RefactorResolutionEvidenceV1 | undefined {
  return resolutionEvidenceRecords(evidenceState)
    .find((evidence) => evidence.resolutionDigest === resolutionDigest);
}

/** Every verdict recorded against one recommendation, newest `verifiedAt` first. */
export function resolutionEvidenceForRecommendation(
  evidenceState: EvidenceStateAtCursorV1,
  recommendationId: string
): RefactorResolutionEvidenceV1[] {
  return resolutionEvidenceRecords(evidenceState)
    .filter((evidence) => evidence.recommendationId === recommendationId)
    .sort((left, right) => right.verifiedAt.localeCompare(left.verifiedAt)
      || right.resolutionDigest.localeCompare(left.resolutionDigest));
}

/**
 * The persisted BEFORE state for one recommendation: the snapshot item bound to it by the run that
 * raised it. The digest is reported as it is *bound*, not as the record's payload claims it, so a
 * record bound to a snapshot other than the baseline it names fails the ladder's first rung as
 * `stale` instead of being measured against the wrong before-state.
 *
 * Absent means no baseline body was ever persisted; the caller then falls back to the recorded
 * digest and every `direction` the evaluator reports is honestly `unknown`.
 */
export function baselineSnapshotForRecommendation(
  evidenceState: EvidenceStateAtCursorV1,
  recommendationId: string
): { snapshotDigest: string; snapshot: ModuleStatisticsSnapshotV1 } | undefined {
  const boundEvidenceIds = new Set(
    evidenceState.evidenceBindings
      .filter((binding) => binding.target.kind === "recommendation" && binding.target.id === recommendationId)
      .map((binding) => binding.evidenceId)
  );
  const items = evidenceState.evidenceItems
    .filter((candidate) => boundEvidenceIds.has(candidate.evidenceId) && candidate.kind === MODULE_STATISTICS_SNAPSHOT_EVIDENCE_KIND)
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  for (const item of items) {
    const snapshot = snapshotBody(item);
    if (snapshot && snapshot.snapshotDigest === item.selector.id) {
      return { snapshotDigest: snapshot.snapshotDigest, snapshot };
    }
  }
  return undefined;
}

/**
 * Guards the one shape the evaluator cannot decide by itself: whether the recorded outcomes are
 * even measurable. Reported at ingress so an unknown metric fails with `AC_SCHEMA_INVALID` and no
 * evidence is written, instead of reading as satisfied under `absent`.
 */
export function refactorVerifyIngressIssues(recommendation: RecommendationV3): string[] {
  if (recommendation.category === "practice") {
    return [`recommendation ${recommendation.recommendationId} is a practice recommendation and carries no refactor outcome`];
  }
  const payload = recommendation.payload as { targetOutcomes?: unknown; derivedOutcomes?: unknown };
  const outcomes = recommendation.category === "refactor_proposal" ? payload.targetOutcomes : payload.derivedOutcomes;
  if (!Array.isArray(outcomes)) return [`recommendation ${recommendation.recommendationId} carries no outcome array`];
  return refactorOutcomeVocabularyIssues(outcomes, `recommendation.payload.outcomes`);
}

function resolutionEvidenceRecords(evidenceState: EvidenceStateAtCursorV1): RefactorResolutionEvidenceV1[] {
  const records: RefactorResolutionEvidenceV1[] = [];
  for (const item of evidenceState.evidenceItems) {
    if (item.kind !== REFACTOR_RESOLUTION_EVIDENCE_KIND) continue;
    const body = item.extensions?.refactorResolution;
    if (!body || typeof body !== "object" || Array.isArray(body)) continue;
    const evidence = body as unknown as RefactorResolutionEvidenceV1;
    if (evidence.schemaVersion !== REFACTOR_RESOLUTION_EVIDENCE_SCHEMA_VERSION) continue;
    records.push(evidence);
  }
  return records;
}

function snapshotBody(item: EvidenceItemV2 | undefined): ModuleStatisticsSnapshotV1 | undefined {
  const body = item?.extensions?.moduleStatisticsSnapshot;
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  return body as unknown as ModuleStatisticsSnapshotV1;
}

function sealEvidenceItem(draft: EvidenceItemV2): EvidenceItemV2 {
  const { digest: _digest, extensions: _extensions, ...hashable } = draft;
  return { ...draft, digest: digestJson(hashable as unknown as Json) };
}

function digestSuffix(digest: string): string {
  return digest.replace(/^sha256:/, "").slice(0, 16);
}
