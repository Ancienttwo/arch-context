import { publicFailureEnvelope, publicOperationErrorEnvelope, publicOperationFailure, publicOperationResult } from "./public-operation-failure";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findRepositoryRoot, readTrackedSourceFiles } from "@archcontext/local-runtime/git-adapter";
import { type RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import { loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import {
  architectureLedgerPayload,
  type ArchitectureLedgerAppendInput,
  type ArchitectureLedgerAppendResult,
  type ArchitectureLedgerScope,
  type RecommendationLedgerRecordV1
} from "@archcontext/core/architecture-ledger";
import {
  RECOMMENDATION_SCHEDULER_ENGINE_VERSION,
  aggregateRecommendationLifecycleMetrics,
  createRecommendationFeedback,
  recommendationLifecycleLedgerPayload,
  refactorRecommendationId,
  transitionRecommendationLifecycle,
  type RecommendationFeedbackAction
} from "@archcontext/core/recommendation-engine";
import {
  REFACTOR_RUN_PERSISTENCE_REASON_CODE,
  RefactorAssessmentRegistry,
  RefactorRunTooLargeError,
  buildRefactorRecordEvent,
  refactorClassifierRulesetDigest,
  refactorRunTooLargeMessage,
  refactorProposalAuthorPairIssues,
  type RegisteredRefactorAssessmentV1
} from "./refactor-recording";
import {
  REPOSITORY_REFACTOR_REQUEST,
  RefactorScanError,
  repositoryRefactorRequest,
  runRefactorScan,
  type RefactorScanResultV1
} from "./refactor-scan";
import {
  buildRefactorDecision,
  isRefactorRecommendation,
  readRefactorDecisionSet,
  refactorDecisionSetWithout,
  refactorDecisionWrite,
  refactorStatusView,
  type RefactorDecisionSetV1
} from "./refactor-decisions";
import {
  baselineImportNodeLimit,
  baselineSnapshotForRecommendation,
  findResolutionEvidence,
  refactorVerifyIngressIssues,
  resolutionEvidenceForRecommendation,
  runRefactorVerify,
  type RuntimeRefactorVerifyInput
} from "./refactor-verify";
import {
  digestJson,
  errorEnvelope,
  okEnvelope,
  type ArchContextErrorCode,
  type ArchitectureActorKind,
  type ArchitectureEventV1,
  type EvidenceBindingV1,
  type EvidenceItemV2,
  type EvidenceStateAtCursorV1,
  type Json,
  type JsonEnvelope,
  type ModuleStatisticsSnapshotV1,
  type RecommendationV2,
  type RecommendationFeedbackV1,
  type RecommendationRunV1
} from "@archcontext/contracts";
import {
  RECOMMENDATION_STATUSES,
  RECOMMENDATION_V3_SCHEMA_VERSION,
  REFACTOR_DECISION_DIRECTORY,
  isRefactorDecisionStatus,
  REFACTOR_EXECUTION_EVIDENCE_KINDS,
  REFACTOR_EXECUTION_EVIDENCE_LOCATOR_PATTERN,
  REFACTOR_EXECUTION_EVIDENCE_LOCATOR_RULE,
  REFACTOR_VERIFICATION_REQUEST_KEYS,
  REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
  refactorScanInvariantIssues,
  refactorVerificationRequestInvariantIssues,
  type RecommendationV3,
  type RefactorDecisionV1,
  type RefactorExecutionEvidenceRefV1,
  type RefactorStatusAuthority,
  type RefactorProposalPayloadV1,
  type RefactorRequestV1,
  type RefactorResolutionEvidenceV1,
  type StructuralObservationPayloadV1
} from "@archcontext/contracts";
import type { RuntimeRecommendationInput, RuntimeRefactorScanInput, RuntimeRefactorRecordInput } from "./rpc-types";
export type { RuntimeRecommendationInput, RuntimeRefactorScanInput, RuntimeRefactorRecordInput } from "./rpc-types";

interface RecommendationsContext {
  assertRunning(): void;
  withWriter<T>(run: () => Promise<T>): Promise<T>;
  clock(): string;
  architectureLedgerScope(root: string): Promise<ArchitectureLedgerScope>;
  architectureLedgerGitScope(root: string): Promise<ArchitectureLedgerScope>;
  assertFreshWorktree(root: string, expectedWorktreeDigest: string | undefined, command: string): void;
  shortDigest(digest: string): string;
  appendArchitectureEventsWithFeed(root: string, input: ArchitectureLedgerAppendInput): Promise<ArchitectureLedgerAppendResult>;
  /**
   * Writes refactor decision files and appends `events` in one ChangeSet journal boundary
   * (ADR-0046). Must be called inside `withWriter`; it never takes the lock itself.
   */
  applyRefactorDecision(
    root: string,
    input: { writes: { path: string; expectedHash: string; body: string }[]; events: ArchitectureEventV1[] }
  ): Promise<{ changeSetId: string; journalId: string; append: ArchitectureLedgerAppendResult }>;
  localStore: Pick<RuntimeLocalStore, "replayArchitectureLedger" | "resolveArchitectureLedgerScope">;
}

export class RecommendationsService {
  private readonly refactorAssessments = new RefactorAssessmentRegistry();

  constructor(private readonly context: RecommendationsContext) {}

  async recommendations(root: string, input: RuntimeRecommendationInput): Promise<JsonEnvelope> {
    try { return await this.recommendationsUnchecked(root, input); }
    catch (error) { throw publicOperationFailure(error); }
  }

  private async recommendationsUnchecked(root: string, input: RuntimeRecommendationInput): Promise<JsonEnvelope> {
    this.context.assertRunning();
    const repositoryRoot = findRepositoryRoot(root);
    const command = input.command;
    const readMetrics = async () => {
      const scope = await this.context.architectureLedgerScope(repositoryRoot);
      const replay = await this.context.localStore.replayArchitectureLedger({ ...scope, mode: "genesis" });
      const artifacts = recommendationArtifactsFromEvents(replay.events);
      return okEnvelope("recommendations.metrics", {
        ...aggregateRecommendationLifecycleMetrics({
          recommendationRuns: artifacts.recommendationRuns,
          recommendations: artifacts.recommendations,
          feedback: artifacts.feedback,
          generatedAt: input.now ?? this.context.clock()
        }),
        freshness: {
          schemaVersion: "archcontext.recommendation-lifecycle-freshness/v1",
          repository: scope.repository,
          worktree: scope.worktree,
          ledgerCursor: {
            eventCount: replay.cursor.eventCount,
            lastEventId: replay.cursor.lastEventId,
            lastEventHash: replay.cursor.lastEventHash
          },
          graphDigest: replay.graphDigest
        }
      } as unknown as Json);
    };
    // Checked for every command, so a bad value is refused even where no scan reads it.
    if (input.importNodeLimit !== undefined && !(Number.isInteger(input.importNodeLimit) && input.importNodeLimit >= 1)) {
      return publicFailureEnvelope(`recommendations.${command}`, "AC_SCHEMA_INVALID", "recommendations-input-invalid", {});
    }
    if (command === "metrics") return readMetrics();
    if (command === "list") return this.listRecommendations(repositoryRoot, input.status);
    if (command === "show") {
      if (!input.recommendationId) return publicFailureEnvelope("recommendations.show", "AC_SCHEMA_INVALID", "recommendations-input-invalid", {});
      return this.showRecommendation(repositoryRoot, input.recommendationId, input.importNodeLimit);
    }
    if (!isRecommendationLifecycleCliAction(command)) {
      return publicFailureEnvelope("recommendations", "AC_SCHEMA_INVALID", "recommendations-input-invalid", {});
    }
    if (!input.recommendationId) {
      return publicFailureEnvelope(`recommendations.${command}`, "AC_SCHEMA_INVALID", "recommendations-input-invalid", {});
    }
    if (!input.reason?.trim()) {
      return publicFailureEnvelope(`recommendations.${command}`, "AC_SCHEMA_INVALID", "recommendations-input-invalid", {});
    }

    return this.context.withWriter(async () => {
      if (input.expectedWorktreeDigest) {
        // A stale claim about the tree is the same case `refactor record` refuses, so it gets the
        // same typed envelope rather than escaping as an untyped throw.
        try {
          this.context.assertFreshWorktree(repositoryRoot, input.expectedWorktreeDigest, `recommendations ${command}`);
        } catch (error) {
          return errorEnvelope(`recommendations.${command}`, "AC_REFACTOR_STALE", error instanceof Error ? error.message : String(error));
        }
      }
      const now = input.now ?? this.context.clock();
      const scope = await this.context.architectureLedgerScope(repositoryRoot);
      const replay = await this.context.localStore.replayArchitectureLedger({ ...scope, mode: "genesis" });
      const artifacts = recommendationArtifactsFromEvents(replay.events);
      const ledgerCurrent = latestRecommendationById(artifacts.recommendations, input.recommendationId!);
      if (!ledgerCurrent) {
        // `resolve` closes a record against `refactor verify` evidence bound to that record, so an
        // id the ledger has never held has nothing to resolve; every other decision is an opinion
        // about one observation identity and may be taken on a current scan candidate directly.
        if (command === "resolve") {
          const gitOnly = this.readGitOnlyDecision(repositoryRoot, input.recommendationId!, `recommendations.${command}`);
          if (gitOnly) return "error" in gitOnly ? gitOnly.error : gitDecisionNotRecordedHere(`recommendations.${command}`, gitOnly.decision);
          return recommendationNotFound(command, input.recommendationId!, "recorded");
        }
        const unapproved = refactorDecisionApprovalError(command, input);
        if (unapproved) return unapproved;
        return this.decideScanCandidate(root, repositoryRoot, input, command, now);
      }
      // A refactor decision is a Git write: it needs the explicit approval, and it transitions from
      // the status the checkout states, not from whatever the ledger last recorded (ADR-0046).
      let decisions: RefactorDecisionSetV1 | undefined;
      if (isRefactorRecommendation(ledgerCurrent)) {
        const unapproved = refactorDecisionApprovalError(command, input);
        if (unapproved) return unapproved;
        try {
          decisions = readRefactorDecisionSet(repositoryRoot);
        } catch (error) {
          return refactorScanErrorEnvelope(`recommendations.${command}`, error);
        }
      }
      const view = refactorStatusView(ledgerCurrent, decisions);
      if (view.authority === "ledger-audit" && isRefactorRecommendation(ledgerCurrent)) {
        return ledgerAuditDecisionRefused(`recommendations.${command}`, ledgerCurrent, artifacts.recommendations, decisions!);
      }
      const current = view.record;
      let gatedWorktree: { headSha: string; worktreeDigest: string } | undefined;
      if (command === "resolve") {
        // The live HEAD, not the ledger scope's: the stored scope carries the identity of the last
        // appended event, and resolving is a claim about the tree that is here now.
        const liveScope = await this.context.architectureLedgerGitScope(repositoryRoot);
        gatedWorktree = liveScope.worktree;
        const gate = refactorResolveGate(current, input.evidenceDigest, replay.evidenceState, liveScope.worktree);
        if (gate) return publicFailureEnvelope(`recommendations.${command}`, gate.code, gate.reasonCode!, gate.details ?? {});
      }
      const decision = this.lifecycleDecision({ scope, graphDigest: replay.graphDigest, current, command, input, now });
      if ("error" in decision) return decision.error;
      const { next, feedback, event } = decision;
      // The gate read the tree before the transition and the event were built. Resolving binds a
      // verdict to a HEAD *and* a worktree digest, so the tree is re-read here, inside the writer,
      // and a move between the two reads closes the record against a state nobody verified.
      if (gatedWorktree) {
        const preAppendScope = await this.context.architectureLedgerGitScope(repositoryRoot);
        const moved = movedWorktreeIdentityFields(gatedWorktree, preAppendScope.worktree);
        if (moved.length > 0) {
          return publicFailureEnvelope(`recommendations.${command}`, "AC_REFACTOR_STALE", "evidence-head-drift", {recommendationId: current.recommendationId, evidenceDigest: input.evidenceDigest!, expectedHeadSha: gatedWorktree.headSha, actualHeadSha: preAppendScope.worktree.headSha, expectedWorktreeDigest: gatedWorktree.worktreeDigest, actualWorktreeDigest: preAppendScope.worktree.worktreeDigest, changedFields: moved, observation: "before-resolve-append"});
        }
      }
      let append: ArchitectureLedgerAppendResult;
      let decisionFile: string | null = null;
      if (decisions) {
        const written = await this.writeRefactorDecision(repositoryRoot, {
          namespace: decisions.namespace,
          next: next as RecommendationV3,
          command,
          input,
          now,
          headSha: (gatedWorktree ?? (await this.context.architectureLedgerGitScope(repositoryRoot)).worktree).headSha,
          events: [event]
        });
        if ("error" in written) return written.error;
        append = written.append;
        decisionFile = written.path;
      } else {
        append = await this.context.appendArchitectureEventsWithFeed(root, {
          writer: "runtime-daemon",
          events: [event]
        });
      }
      const metrics = aggregateRecommendationLifecycleMetrics({
        recommendationRuns: artifacts.recommendationRuns,
        recommendations: [...artifacts.recommendations, next],
        feedback: [...artifacts.feedback, feedback],
        generatedAt: now
      });
      return lifecycleEnvelope({ command, current, next, feedback, metrics, append, implicitRecord: null, decisionFile });
    });
  }

  /**
   * Decides an id the ledger does not hold yet: a candidate of the repository scan at the tree
   * that is here now.
   *
   * A decision is an opinion about one observation identity, and `recommendationId` is derived
   * from that identity alone (`fingerprint` plus `regressesFrom`), never from a worktree digest.
   * So the scan is re-run here under the writer instead of trusting an earlier caller's snapshot,
   * and the candidate is recorded through the same `buildRefactorRecordEvent` path `refactor
   * record` uses, then decided — both events in one append, one transaction. A later `refactor
   * record` of the same observation re-derives the same id and is suppressed as an active
   * duplicate, so nothing is recorded twice.
   *
   * Recording is the whole scan run, exactly as `refactor record` would write it: a run is the
   * unit the ledger's run identity, output digest and evidence bindings are computed over, and
   * recording a subset of it would persist a run whose digests describe records it never wrote.
   *
   * The scan reads at `input.importNodeLimit`, so a candidate from `refactor scan
   * --import-node-limit <n>` is found, and recorded under the same `requestId`, with the same limit.
   */
  private async decideScanCandidate(
    root: string,
    repositoryRoot: string,
    input: RuntimeRecommendationInput,
    command: Exclude<RecommendationFeedbackAction, "resolve">,
    now: string
  ): Promise<JsonEnvelope> {
    const surface = `recommendations.${command}`;
    const recommendationId = input.recommendationId!;
    const measured = await this.measureRepository(
      repositoryRoot,
      repositoryRefactorRequest(input.importNodeLimit),
      `recommendations ${command}`,
      recommendationId
    );
    if (!measured.ok) {
      return publicFailureEnvelope(surface, measured.code, measured.reasonCode!, measured.details ?? {}, measured);
    }
    const { gitScope, storageScope, replay, artifacts, decisions, planningDecisions, result } = measured;
    const gitDecision = decisions.byId.get(recommendationId);
    if (!result.proposedRecommendations.some((candidate) => candidate.recommendationId === recommendationId)) {
      if (gitDecision) {
        return publicFailureEnvelope(surface, "AC_REFACTOR_STALE", "git-decision-subject-not-observed", {recommendationId});
      }
      return recommendationNotFound(command, recommendationId, "recorded-or-scanned");
    }
    const registered: RegisteredRefactorAssessmentV1 = {
      snapshot: result.snapshot,
      assessment: result.assessment,
      namespace: result.namespace,
      headSha: gitScope.worktree.headSha,
      worktreeDigest: gitScope.worktree.worktreeDigest
    };
    const scanIssues = refactorScanInvariantIssues({ snapshot: registered.snapshot, assessment: registered.assessment });
    if (scanIssues.length > 0) return publicFailureEnvelope(surface, "AC_SCHEMA_INVALID", "recommendations-input-invalid", {});
    let built: ReturnType<typeof buildRefactorRecordEvent>;
    try {
      built = buildRefactorRecordEvent({
        repository: storageScope.repository,
        worktree: storageScope.worktree,
        registered,
        previousRecommendations: artifacts.recommendations,
        decisions: planningDecisions,
        evidenceState: replay.evidenceState,
        graphDigest: replay.graphDigest,
        catalogDigest: refactorClassifierRulesetDigest(RECOMMENDATION_SCHEDULER_ENGINE_VERSION),
        // One clock for the record and the decision: the decision must never sort before the
        // record it decides, and an equal `updatedAt` resolves to the later event.
        now
      });
    } catch (error) {
      return recordBuildErrorEnvelope(surface, error);
    }
    const recorded = built.plan.recommendations.find((recommendation) => recommendation.recommendationId === recommendationId);
    if (!recorded) {
      // The scan and the record plan read the same ledger, so this is the planner disagreeing
      // with itself; refusing is the only answer that does not decide something nobody saw.
      return publicFailureEnvelope(surface, "AC_REFACTOR_STALE", "scan-candidate-not-recorded", {recommendationId});
    }
    // A Git-only decision transitions from the status its file states, not from the `open` the
    // materialized record carries.
    const current = refactorStatusView(recorded as RecommendationLedgerRecordV1, decisions).record;
    const decision = this.lifecycleDecision({
      scope: storageScope,
      graphDigest: replay.graphDigest,
      current,
      command,
      input,
      now,
      allowSameStatus: gitDecision !== undefined
    });
    if ("error" in decision) return decision.error;
    const { next, feedback, event } = decision;
    // Same last look `refactor record` takes: the record binds the measurement to this tree.
    const preAppendScope = await this.context.architectureLedgerGitScope(repositoryRoot);
    const moved = movedWorktreeIdentityFields(gitScope.worktree, preAppendScope.worktree);
    if (moved.length > 0) {
      return publicFailureEnvelope(surface, "AC_REFACTOR_STALE", "recommendation-snapshot-changed", {recommendationId, changedFields: moved});
    }
    const written = await this.writeRefactorDecision(repositoryRoot, {
      namespace: decisions.namespace,
      next: next as RecommendationV3,
      command,
      input,
      now,
      headSha: gitScope.worktree.headSha,
      events: [built.event, event]
    });
    if ("error" in written) return written.error;
    const append = written.append;
    const metrics = aggregateRecommendationLifecycleMetrics({
      recommendationRuns: [...artifacts.recommendationRuns, built.plan.run],
      recommendations: [...artifacts.recommendations, ...built.plan.recommendations as RecommendationLedgerRecordV1[], next],
      feedback: [...artifacts.feedback, feedback],
      generatedAt: now
    });
    return lifecycleEnvelope({
      command,
      current,
      next,
      feedback,
      metrics,
      append,
      implicitRecord: {
        schemaVersion: "archcontext.runtime-recommendation-implicit-record/v1",
        assessmentDigest: result.assessment.assessmentDigest,
        runId: built.plan.run.runId,
        headSha: gitScope.worktree.headSha,
        worktreeDigest: gitScope.worktree.worktreeDigest,
        recommendationIds: built.plan.recommendations.map((recommendation) => recommendation.recommendationId),
        evidenceItemIds: built.plan.evidenceItems.map((item) => item.evidenceId),
        eventId: built.event.eventId
      },
      decisionFile: written.path
    });
  }

  /**
   * The Git half of one refactor decision: builds the decision file for `next` and hands it, with
   * the ledger `events`, to the daemon's ChangeSet authority as one journal boundary. Called inside
   * the decision verb's writer lock.
   */
  private async writeRefactorDecision(
    repositoryRoot: string,
    input: {
      namespace: string;
      next: RecommendationV3;
      command: RecommendationFeedbackAction;
      input: RuntimeRecommendationInput;
      now: string;
      headSha: string;
      events: ArchitectureEventV1[];
    }
  ): Promise<{ append: ArchitectureLedgerAppendResult; path: string } | { error: JsonEnvelope }> {
    const surface = `recommendations.${input.command}`;
    if (!isRefactorDecisionStatus(input.next.status)) {
      return { error: publicFailureEnvelope(surface, "AC_PRECONDITION_FAILED", "recommendation-decision-invalid", {}) };
    }
    let write: ReturnType<typeof refactorDecisionWrite>;
    try {
      const decision = buildRefactorDecision({
        namespace: input.namespace,
        record: input.next,
        status: input.next.status,
        reason: input.input.reason!,
        actor: { kind: recommendationActorKind(input.input), id: input.input.actor ?? "developer" },
        decidedAt: input.now,
        headSha: input.headSha
      });
      write = refactorDecisionWrite(repositoryRoot, decision);
    } catch (error) {
      return { error: refactorScanErrorEnvelope(surface, error) };
    }
    const applied = await this.context.applyRefactorDecision(repositoryRoot, { writes: [write], events: input.events });
    return { append: applied.append, path: write.path };
  }

  /**
   * One read that answers "why does this recommendation exist and what happened to it": the
   * record, the evidence items and bindings it resolves to, the measured statistics of the modules
   * it names, and every explicit decision. Read-only; nothing is appended or registered.
   *
   * A recorded id is answered from the ledger alone. An id the ledger does not hold is answered
   * from the repository scan at the tree that is here now, under the same identity a decision on
   * it would record, so a UI can show a candidate and then decide it by the same id. The scan reads
   * at `importNodeLimit`, the limit a decision on the candidate must also be given.
   *
   * An id this ledger never recorded but whose decision this checkout carries in Git (decided in
   * another worktree or branch) is answered from that decision file alone, marked
   * `source: "git-decision"` with no ledger record, evidence or baseline (ADR-0046).
   */
  private async showRecommendation(
    repositoryRoot: string,
    recommendationId: string,
    importNodeLimit: number | undefined
  ): Promise<JsonEnvelope> {
    const scope = await this.context.architectureLedgerScope(repositoryRoot);
    const replay = await this.context.localStore.replayArchitectureLedger({ ...scope, mode: "genesis" });
    const artifacts = recommendationArtifactsFromEvents(replay.events);
    const ledgerRecorded = latestRecommendationById(artifacts.recommendations, recommendationId);
    let decisions: RefactorDecisionSetV1 | undefined;
    if (ledgerRecorded && isRefactorRecommendation(ledgerRecorded)) {
      try {
        decisions = readRefactorDecisionSet(repositoryRoot);
      } catch (error) {
        return refactorScanErrorEnvelope("recommendations.show", error);
      }
    }
    const view = ledgerRecorded ? refactorStatusView(ledgerRecorded, decisions) : undefined;
    const recorded = view?.record;
    if (recorded) {
      const bindings = replay.evidenceState.evidenceBindings
        .filter((binding) => binding.target.kind === "recommendation" && binding.target.id === recommendationId)
        .sort((left, right) => left.bindingId.localeCompare(right.bindingId));
      const baseline = baselineSnapshotForRecommendation(replay.evidenceState, recommendationId);
      return recommendationShowEnvelope({
        source: "ledger",
        statusAuthority: view!.authority,
        gitDecision: decisions?.byId.get(recommendationId) ?? null,
        recommendation: recorded,
        bindings,
        items: evidenceItemsFor(replay.evidenceState.evidenceItems, bindings),
        baseline: baseline === undefined
          ? { status: "missing", snapshotDigest: null }
          : baseline.snapshot
            ? { status: "measured", snapshotDigest: baseline.snapshotDigest, snapshot: baseline.snapshot }
            : { status: "unverifiable", snapshotDigest: baseline.snapshotDigest },
        decisions: artifacts.feedback.filter((feedback) => feedback.recommendationId === recommendationId),
        worktree: null
      });
    }
    const gitOnly = this.readGitOnlyDecision(repositoryRoot, recommendationId, "recommendations.show");
    if (gitOnly) {
      if ("error" in gitOnly) return gitOnly.error;
      return recommendationShowEnvelope({
        source: "git-decision",
        statusAuthority: "git-decision",
        gitDecision: gitOnly.decision,
        recommendation: null,
        bindings: [],
        items: [],
        baseline: { status: "missing", snapshotDigest: null },
        decisions: [],
        worktree: null
      });
    }
    const measured = await this.measureRepository(repositoryRoot, repositoryRefactorRequest(importNodeLimit), "recommendations show");
    if (!measured.ok) {
      return publicFailureEnvelope("recommendations.show", measured.code, measured.reasonCode!, measured.details ?? {}, measured);
    }
    const candidate = measured.result.proposedRecommendations.find((entry) => entry.recommendationId === recommendationId);
    if (!candidate) return recommendationNotFound("show", recommendationId, "recorded-or-scanned");
    // A candidate is shown under the identity a decision on it would record; a run that cannot be
    // recorded cannot be decided, so its candidate is refused the way the decision would be.
    if (!measured.result.recording.recordable) {
      return refactorRunTooLargeEnvelope("recommendations.show", measured.result.recording);
    }
    const bindings = measured.result.evidenceBindings
      .filter((binding) => binding.target.kind === "recommendation" && binding.target.id === recommendationId)
      .sort((left, right) => left.bindingId.localeCompare(right.bindingId));
    return recommendationShowEnvelope({
      source: "scan-candidate",
      statusAuthority: "scan-candidate",
      gitDecision: null,
      recommendation: candidate as RecommendationLedgerRecordV1,
      bindings,
      items: evidenceItemsFor(measured.result.evidenceItems, bindings),
      baseline: { status: "measured", snapshotDigest: measured.result.snapshot.snapshotDigest, snapshot: measured.result.snapshot },
      decisions: [],
      worktree: { headSha: measured.gitScope.worktree.headSha, worktreeDigest: measured.gitScope.worktree.worktreeDigest }
    });
  }

  /**
   * Every recommendation whose latest record has `status`, read from the ledger alone. Unlike
   * `book recommendations` there is no item or byte budget: a consumer that reads decisions must
   * see all of them, so nothing is cut and `count` is the whole answer. Read-only.
   */
  private async listRecommendations(repositoryRoot: string, status: string | undefined): Promise<JsonEnvelope> {
    if (status === undefined || !(RECOMMENDATION_STATUSES as readonly string[]).includes(status)) {
      return publicFailureEnvelope("recommendations.list", "AC_SCHEMA_INVALID", "recommendations-input-invalid", {});
    }
    const scope = await this.context.architectureLedgerScope(repositoryRoot);
    const replay = await this.context.localStore.replayArchitectureLedger({ ...scope, mode: "genesis" });
    const latest = latestRecommendationsById(recommendationArtifactsFromEvents(replay.events).recommendations);
    let decisions: RefactorDecisionSetV1 | undefined;
    if (refactorDecisionsInPlay(repositoryRoot, latest)) {
      try {
        decisions = readRefactorDecisionSet(repositoryRoot);
      } catch (error) {
        return refactorScanErrorEnvelope("recommendations.list", error);
      }
    }
    // Refactor status is the checkout's (ADR-0046); practice status is the ledger's. A recorded
    // human status the checkout carries no Git file for is audit only: it is never listed as the
    // subject's status, only reported under `ledgerAudit` with the status the ledger recorded.
    const views = latest.map((recommendation) => refactorStatusView(recommendation, decisions));
    const recommendations = views
      .filter((view) => view.authority !== "ledger-audit" && view.record.status === status)
      .map((view) => view.record);
    const ledgerAudit = views
      .filter((view) => view.authority === "ledger-audit" && view.record.status === status)
      .map((view) => view.record);
    const recorded = new Set(latest.map((recommendation) => recommendation.recommendationId));
    // Decisions this checkout carries for ids this workspace's ledger never recorded (another
    // worktree or branch decided them and the decision came through Git).
    const gitOnlyDecisions = (decisions?.decisions ?? [])
      .filter((decision) => decision.status === status && !recorded.has(decision.recommendationId));
    return okEnvelope("recommendations.list", {
      schemaVersion: "archcontext.runtime-recommendation-list/v1",
      status,
      count: recommendations.length + gitOnlyDecisions.length,
      recommendations,
      decisions: gitOnlyDecisions,
      ledgerAudit,
      ledgerCursor: {
        eventCount: replay.cursor.eventCount,
        lastEventId: replay.cursor.lastEventId,
        lastEventHash: replay.cursor.lastEventHash
      },
      graphDigest: replay.graphDigest,
      privacy: {
        writes: "none",
        rawSourcePersisted: false,
        rawDiffPersisted: false,
        promptPersisted: false
      }
    } as unknown as Json);
  }

  /**
   * The Git decision for an id this ledger never recorded, when the checkout carries one. Read
   * only when the decision directory exists, so an unknown id in a repository without decisions
   * stays a plain not-found; a decision set that cannot be read fails closed.
   */
  private readGitOnlyDecision(
    repositoryRoot: string,
    recommendationId: string,
    surface: string
  ): { decision: RefactorDecisionV1 } | { error: JsonEnvelope } | undefined {
    if (!existsSync(join(repositoryRoot, REFACTOR_DECISION_DIRECTORY))) return undefined;
    let decisions: RefactorDecisionSetV1;
    try {
      decisions = readRefactorDecisionSet(repositoryRoot);
    } catch (error) {
      return { error: refactorScanErrorEnvelope(surface, error) };
    }
    const decision = decisions.byId.get(recommendationId);
    return decision ? { decision } : undefined;
  }

  /** The transition, its explicit feedback and the lifecycle event, shared by both decide paths. */
  private lifecycleDecision(input: {
    scope: ArchitectureLedgerScope;
    graphDigest: string;
    current: RecommendationLedgerRecordV1;
    command: RecommendationFeedbackAction;
    input: RuntimeRecommendationInput;
    now: string;
    /**
     * Recording a Git-only decision in this ledger with the verb of the status its file states is
     * a first record here, not a no-op, so the unchanged status is accepted on that path only.
     */
    allowSameStatus?: boolean;
  }): { next: RecommendationLedgerRecordV1; feedback: RecommendationFeedbackV1; event: ArchitectureEventV1 } | { error: JsonEnvelope } {
    const { scope, graphDigest, current, command, now } = input;
    const request = input.input;
    let next: RecommendationLedgerRecordV1;
    try {
      next = transitionRecommendationLifecycle(current, {
        action: command,
        now,
        actor: request.actor ?? "developer",
        reason: request.reason
      });
    } catch (error) {
      return {
        error: publicOperationErrorEnvelope(`recommendations.${command}`, error)
      };
    }
    if (next.status === current.status && !input.allowSameStatus) {
      return {
        error: publicFailureEnvelope(`recommendations.${command}`, "AC_PRECONDITION_FAILED", "recommendation-decision-invalid", {})
      };
    }
    const feedback = createRecommendationFeedback({
      repository: scope.repository,
      worktree: scope.worktree,
      previous: current,
      next,
      action: command,
      now,
      actorId: request.actor ?? "developer",
      actorKind: recommendationActorKind(request),
      source: request.source ?? "cli",
      reason: request.reason!.trim(),
      ...(request.agentJobId ? { agentJobId: request.agentJobId } : {})
    });
    const inputDigest = digestJson({
      schemaVersion: "archcontext.recommendation-lifecycle-event-input/v1",
      recommendationId: current.recommendationId,
      runId: current.runId,
      action: command,
      previousStatus: current.status,
      nextStatus: next.status,
      feedbackId: feedback.feedbackId,
      graphDigest
    } as unknown as Json);
    const event: ArchitectureEventV1 = {
      schemaVersion: "archcontext.architecture-event/v1",
      eventId: `architecture_event.recommendation_lifecycle.${this.context.shortDigest(inputDigest)}`,
      eventType: "architecture.recommendation.lifecycle",
      payloadVersion: "archcontext.recommendation-feedback/v1",
      repository: scope.repository,
      worktree: scope.worktree,
      baseDigest: graphDigest,
      resultingDigest: graphDigest,
      headSha: scope.worktree.headSha,
      actor: { kind: feedback.actor.kind, id: feedback.actor.id },
      source: "manual",
      timestamp: now,
      idempotencyKey: `architecture-ledger-recommendation-lifecycle:${feedback.feedbackId}:${current.status}:${next.status}`,
      provenance: {
        producer: "runtime-daemon",
        command: `archctx recommendations ${command}`,
        inputDigest
      },
      payload: {
        ...recommendationLifecycleLedgerPayload({ recommendation: next, feedback }),
        title: `Recommendation ${command}`,
        summary: `Recommendation ${current.recommendationId} transitioned from ${current.status} to ${next.status}.`,
        recommendationLifecycle: {
          schemaVersion: "archcontext.recommendation-lifecycle-transition/v1",
          recommendationId: current.recommendationId,
          runId: current.runId,
          action: command,
          previousStatus: current.status,
          nextStatus: next.status,
          feedbackId: feedback.feedbackId
        }
      } as unknown as Json
    };
    return { next, feedback, event };
  }

  /**
   * One repository measurement at the tree that is here now, shared by `refactor scan` and the
   * scan-candidate decision. Read-only: nothing is appended and nothing is registered here.
   *
   * Two different scopes, deliberately. `gitScope` is the tree as it is right now and is the only
   * identity `refactor record` will accept, because that is the authority its freshness check
   * reads. `storageScope` is where the ledger keeps this workspace's events, anchored to the last
   * event's identity, and is the only key a replay can find them under.
   */
  private async measureRepository(
    repositoryRoot: string,
    request: RefactorRequestV1,
    label: string,
    materializeRecommendationId?: string
  ): Promise<
    | {
      ok: true;
      gitScope: ArchitectureLedgerScope;
      storageScope: ArchitectureLedgerScope;
      replay: Awaited<ReturnType<RecommendationsContext["localStore"]["replayArchitectureLedger"]>>;
      artifacts: ReturnType<typeof recommendationArtifactsFromEvents>;
      decisions: RefactorDecisionSetV1;
      /**
       * The set the scan was planned with: `decisions`, or `decisions` without the one Git
       * decision being materialized, so that decided generation is planned as a record again.
       */
      planningDecisions: RefactorDecisionSetV1;
      result: RefactorScanResultV1;
    }
    | { ok: false; code: ArchContextErrorCode; message: string; reasonCode?: string; details?: Record<string, Json>; action?: string; severity?: "notice" | "warning" | "error" | "critical"; retryable?: boolean }
  > {
    const gitScope = await this.context.architectureLedgerGitScope(repositoryRoot);
    const storageScope = await this.context.localStore.resolveArchitectureLedgerScope(gitScope);
    const replay = await this.context.localStore.replayArchitectureLedger({ ...storageScope, mode: "genesis" });
    const artifacts = recommendationArtifactsFromEvents(replay.events);
    let result: RefactorScanResultV1;
    let decisions: RefactorDecisionSetV1;
    let planningDecisions: RefactorDecisionSetV1;
    try {
      decisions = readRefactorDecisionSet(repositoryRoot);
      // A decided generation this ledger never recorded is suppressed by its own Git decision.
      // Planning without that one decision materializes exactly that generation again: its id is
      // derived from fingerprint and `regressesFrom`, so the planned record is the same generation.
      planningDecisions = materializeRecommendationId !== undefined && decisions.byId.has(materializeRecommendationId)
        ? refactorDecisionSetWithout(decisions, materializeRecommendationId)
        : decisions;
      result = runRefactorScan({
        root: repositoryRoot,
        request,
        repository: gitScope.repository,
        worktree: gitScope.worktree,
        previousRecommendations: artifacts.recommendations,
        decisions: planningDecisions,
        catalogDigest: refactorClassifierRulesetDigest(RECOMMENDATION_SCHEDULER_ENGINE_VERSION)
      });
    } catch (error) {
      const failure = publicOperationFailure(error).failure;
      return {ok: false, ...failure, code: failure.code as ArchContextErrorCode};
    }
    // Every input above was read after `gitScope` was captured. If the tree moved while it was
    // being read, the measurement belongs to no single state, so nothing is published and
    // nothing is registered: `refactor record` must never be handed a mixed-state assessment.
    const liveScope = await this.context.architectureLedgerGitScope(repositoryRoot);
    const movedDuringScan = movedWorktreeIdentityFields(gitScope.worktree, liveScope.worktree);
    if (movedDuringScan.length > 0) {
      return {
        ok: false,
        code: "AC_REFACTOR_STALE",
        message: "The observed repository changed during measurement.",
        reasonCode: "refactor-measurement-changed",
        details: {changedFields: movedDuringScan}
      };
    }
    return { ok: true, gitScope, storageScope, replay, artifacts, decisions, planningDecisions, result };
  }

  /**
   * Measures the repository and classifies one refactor request against it, then registers the
   * pair so `refactorRecord` can append exactly what was measured here.
   *
   * Read-only and clock-free: no event is appended, and both `createdAt` fields come from the
   * HEAD committer date, so two scans at the same HEAD return byte-identical envelopes. The
   * proposed recommendations are a preview of what `refactor record` would write; `record`
   * re-plans under the daemon clock and persists them. A proposed `recommendationId` is the id
   * the record will carry, so `recommendations accept|defer|reject|acknowledge|waive --id` can
   * decide a candidate directly: the daemon re-scans, records and decides in one append.
   */
  async refactorScan(root: string, rawInput: RuntimeRefactorScanInput = {}): Promise<JsonEnvelope> {
    try { return publicOperationResult("refactorScan", await this.refactorScanUnchecked(root, rawInput)) as JsonEnvelope; }
    catch (error) { throw publicOperationFailure(error); }
  }

  private async refactorScanUnchecked(root: string, rawInput: RuntimeRefactorScanInput = {}): Promise<JsonEnvelope> {
    this.context.assertRunning();
    let input: RuntimeRefactorScanInput;
    try {
      input = decodeRuntimeRefactorScanInput(rawInput);
    } catch (error) {
      if (error instanceof RuntimeRefactorInputError) return publicFailureEnvelope("refactor.scan", "AC_SCHEMA_INVALID", "refactor-input-invalid", {});
      throw error;
    }
    const repositoryRoot = findRepositoryRoot(root);
    const request = input.request ?? REPOSITORY_REFACTOR_REQUEST;
    const measured = await this.measureRepository(repositoryRoot, request, "refactor scan");
    if (!measured.ok) return publicFailureEnvelope("refactor.scan", measured.code, measured.reasonCode!, measured.details ?? {}, measured);
    const { gitScope, result } = measured;
    this.registerRefactorAssessment({
      snapshot: result.snapshot,
      assessment: result.assessment,
      ...(result.proposal ? { proposal: result.proposal } : {}),
      namespace: result.namespace,
      headSha: gitScope.worktree.headSha,
      worktreeDigest: gitScope.worktree.worktreeDigest
    });
    return okEnvelope("refactor.scan", {
      schemaVersion: "archcontext.runtime-refactor-scan/v1",
      repository: gitScope.repository,
      worktree: gitScope.worktree,
      requestId: result.requestId,
      namespace: result.namespace,
      request,
      trackedFileCount: result.trackedFileCount,
      untrackedExcludedCount: result.untrackedExcludedCount,
      snapshot: result.snapshot,
      assessment: result.assessment,
      ...(result.proposal ? { proposal: result.proposal } : {}),
      proposedRecommendations: result.proposedRecommendations,
      // Every `evidenceBindingIds` entry a candidate carries resolves here, before any record.
      evidenceItems: result.evidenceItems,
      evidenceBindings: result.evidenceBindings,
      suppressed: result.suppressed,
      recording: result.recording,
      limits: result.limits,
      // Only a run `refactor record` can append gets a command to record it.
      ...(result.recording.recordable
        ? { recordCommand: `archctx refactor record --assessment-digest ${result.assessment.assessmentDigest} --expected-worktree-digest ${gitScope.worktree.worktreeDigest}` }
        : {}),
      privacy: {
        writes: "none",
        rawSourcePersisted: false,
        rawDiffPersisted: false,
        promptPersisted: false
      }
    } as unknown as Json);
  }

  /**
   * In-process only, never dispatched: a scan's measured snapshot and assessment stay inside the
   * daemon, so `refactorRecord` binds them to the HEAD they were measured at instead of trusting
   * an RPC caller to resubmit a measurement the daemon never made.
   */
  registerRefactorAssessment(input: RegisteredRefactorAssessmentV1): string {
    try { return this.registerRefactorAssessmentUnchecked(input); }
    catch (error) { throw publicOperationFailure(error); }
  }

  private registerRefactorAssessmentUnchecked(input: RegisteredRefactorAssessmentV1): string {
    this.context.assertRunning();
    return this.refactorAssessments.register(input);
  }

  async refactorRecord(root: string, rawInput: RuntimeRefactorRecordInput): Promise<JsonEnvelope> {
    try { return await this.refactorRecordUnchecked(root, rawInput); }
    catch (error) { throw publicOperationFailure(error); }
  }

  private async refactorRecordUnchecked(root: string, rawInput: RuntimeRefactorRecordInput): Promise<JsonEnvelope> {
    this.context.assertRunning();
    let input: RuntimeRefactorRecordInput;
    try {
      input = decodeRuntimeRefactorRecordInput(rawInput);
    } catch (error) {
      if (error instanceof RuntimeRefactorInputError) return publicFailureEnvelope("refactor.record", "AC_SCHEMA_INVALID", "refactor-input-invalid", {});
      throw error;
    }
    const repositoryRoot = findRepositoryRoot(root);
    return this.context.withWriter(async () => {
      const registered = this.refactorAssessments.get(input.assessmentDigest);
      if (!registered) {
        return publicFailureEnvelope("refactor.record", "AC_SCHEMA_INVALID", "refactor-assessment-missing", {assessmentDigest: input.assessmentDigest});
      }
      try {
        this.context.assertFreshWorktree(repositoryRoot, input.expectedWorktreeDigest, "refactor record");
      } catch (error) {
        return errorEnvelope("refactor.record", "AC_REFACTOR_STALE", error instanceof Error ? error.message : String(error));
      }
      // Same authority as `assertFreshWorktree` above: the measurement must belong to the tree
      // that is here now, not to whatever identity the last stored event happens to carry.
      const gitScope = await this.context.architectureLedgerGitScope(repositoryRoot);
      if (registered.headSha !== gitScope.worktree.headSha || registered.worktreeDigest !== gitScope.worktree.worktreeDigest) {
        return publicFailureEnvelope("refactor.record", "AC_REFACTOR_STALE", "refactor-assessment-stale", {assessmentDigest: input.assessmentDigest, expectedHeadSha: registered.headSha, actualHeadSha: gitScope.worktree.headSha, expectedWorktreeDigest: registered.worktreeDigest, actualWorktreeDigest: gitScope.worktree.worktreeDigest});
      }
      // The event still lands in the ledger scope the workspace's prior events live in, so the
      // chain and its replay stay one continuous log. Deferred to 0.6.0: decoupling that ledger
      // partition key from the identity the event itself carries.
      const scope = await this.context.localStore.resolveArchitectureLedgerScope(gitScope);
      if (registered.proposal) {
        const authorIssues = refactorProposalAuthorPairIssues(registered.proposal.authoredBy);
        if (authorIssues.length > 0) {
          return publicFailureEnvelope("refactor.record", "AC_REFACTOR_PROPOSAL_UNAUTHORED", "refactor-proposal-unauthored", {issueCount: authorIssues.length});
        }
      }
      const scanIssues = refactorScanInvariantIssues({
        snapshot: registered.snapshot,
        assessment: registered.assessment,
        ...(registered.proposal ? { proposal: registered.proposal } : {})
      });
      if (scanIssues.length > 0) return publicFailureEnvelope("refactor.record", "AC_SCHEMA_INVALID", "refactor-invariant-invalid", {issueCount: scanIssues.length});

      const replay = await this.context.localStore.replayArchitectureLedger({ ...scope, mode: "genesis" });
      const artifacts = recommendationArtifactsFromEvents(replay.events);
      // Re-read under the writer: a decision committed or checked out since the scan is the
      // authority the record must plan against, and the product id must still be the scanned one.
      let decisions: RefactorDecisionSetV1;
      try {
        decisions = readRefactorDecisionSet(repositoryRoot);
      } catch (error) {
        return refactorScanErrorEnvelope("refactor.record", error);
      }
      if (decisions.namespace !== registered.namespace) {
        return publicFailureEnvelope("refactor.record", "AC_REFACTOR_STALE", "refactor-namespace-changed", {assessmentDigest: input.assessmentDigest, expectedNamespace: registered.namespace, actualNamespace: decisions.namespace});
      }
      let built: ReturnType<typeof buildRefactorRecordEvent>;
      try {
        built = buildRefactorRecordEvent({
          repository: scope.repository,
          worktree: scope.worktree,
          registered,
          previousRecommendations: artifacts.recommendations,
          decisions,
          evidenceState: replay.evidenceState,
          graphDigest: replay.graphDigest,
          catalogDigest: refactorClassifierRulesetDigest(RECOMMENDATION_SCHEDULER_ENGINE_VERSION),
          now: this.context.clock()
        });
      } catch (error) {
        return recordBuildErrorEnvelope("refactor.record", error);
      }
      // The identity check above happened before the replay and the event build; the tree can
      // still move in between. Last look before anything is persisted, so a stale measurement
      // fails closed instead of being appended under an identity the repository no longer has.
      const preAppendScope = await this.context.architectureLedgerGitScope(repositoryRoot);
      const movedBeforeAppend = movedWorktreeIdentityFields(registered, preAppendScope.worktree);
      if (movedBeforeAppend.length > 0) {
        return publicFailureEnvelope("refactor.record", "AC_REFACTOR_STALE", "refactor-record-snapshot-changed", {assessmentDigest: input.assessmentDigest, changedFields: movedBeforeAppend});
      }
      const append = await this.context.appendArchitectureEventsWithFeed(root, {
        writer: "runtime-daemon",
        events: [built.event]
      });
      return okEnvelope("refactor.record", {
        schemaVersion: "archcontext.runtime-refactor-record/v1",
        repository: gitScope.repository,
        worktree: gitScope.worktree,
        assessmentDigest: registered.assessment.assessmentDigest,
        runId: built.plan.run.runId,
        catalogDigest: built.plan.run.catalogDigest,
        scale: registered.assessment.scale,
        recommendationIds: built.plan.recommendations.map((recommendation) => recommendation.recommendationId),
        recommendations: built.plan.recommendations,
        evidenceItemIds: built.plan.evidenceItems.map((item) => item.evidenceId),
        suppressed: built.plan.suppressed,
        append: {
          status: "appended",
          eventSource: built.event.source,
          appendedEventCount: append.appendedEvents.length,
          duplicateEventCount: append.duplicateEvents.length,
          graphDigest: append.graphDigest,
          entityCount: append.entityCount,
          relationCount: append.relationCount,
          constraintCount: append.constraintCount
        },
        privacy: {
          writes: "architecture-ledger-event-only",
          rawSourcePersisted: false,
          rawDiffPersisted: false,
          promptPersisted: false
        }
      } as unknown as Json);
    });
  }

  /**
   * Re-measures the repository at the current HEAD and records what that measurement says about
   * one already-recorded recommendation.
   *
   * The verdict is never this method's: `runRefactorVerify` evaluates it against the frozen
   * validator and throws rather than emit one the validator disagrees with. Everything here is
   * the surrounding fail-closed frame — freshness, migration state, ingress shape, and the
   * append — plus the two arms that record nothing at all: a recommendation already in a terminal
   * status, and a verdict identical to one the ledger already holds.
   */
  async refactorVerify(root: string, rawInput: RuntimeRefactorVerifyInput): Promise<JsonEnvelope> {
    try { return await this.refactorVerifyUnchecked(root, rawInput); }
    catch (error) { throw publicOperationFailure(error); }
  }

  private async refactorVerifyUnchecked(root: string, rawInput: RuntimeRefactorVerifyInput): Promise<JsonEnvelope> {
    this.context.assertRunning();
    let input: RuntimeRefactorVerifyInput;
    try {
      input = decodeRuntimeRefactorVerifyInput(rawInput);
    } catch (error) {
      if (error instanceof RuntimeRefactorInputError) return publicFailureEnvelope("refactor.verify", "AC_SCHEMA_INVALID", "refactor-input-invalid", {});
      throw error;
    }
    const repositoryRoot = findRepositoryRoot(root);
    return this.context.withWriter(async () => {
      // Optional, unlike `refactor record`: verify always measures what is at HEAD now, so an
      // absent claim is a verification of the current tree rather than a missing precondition.
      if (input.expectedWorktreeDigest) {
        try {
          this.context.assertFreshWorktree(repositoryRoot, input.expectedWorktreeDigest, "refactor verify");
        } catch (error) {
          return errorEnvelope("refactor.verify", "AC_REFACTOR_STALE", error instanceof Error ? error.message : String(error));
        }
      }
      const gitScope = await this.context.architectureLedgerGitScope(repositoryRoot);
      if (input.expectedHeadSha !== undefined && input.expectedHeadSha !== gitScope.worktree.headSha) {
        return publicFailureEnvelope("refactor.verify", "AC_REFACTOR_STALE", "refactor-head-mismatch", {recommendationId: input.recommendationId, expectedHeadSha: input.expectedHeadSha, actualHeadSha: gitScope.worktree.headSha});
      }
      // Ledger replay and append share the recorded partition; the response reports live Git identity.
      const scope = await this.context.localStore.resolveArchitectureLedgerScope(gitScope);
      const replay = await this.context.localStore.replayArchitectureLedger({ ...scope, mode: "genesis" });
      const artifacts = recommendationArtifactsFromEvents(replay.events);
      const ledgerCurrent = latestRecommendationById(artifacts.recommendations, input.recommendationId);
      if (!ledgerCurrent) {
        // A Git-only decision has no baseline in this ledger; nothing is synthesized or rebound.
        const gitOnly = this.readGitOnlyDecision(repositoryRoot, input.recommendationId, "refactor.verify");
        if (gitOnly) return "error" in gitOnly ? gitOnly.error : gitDecisionNotRecordedHere("refactor.verify", gitOnly.decision);
        return publicFailureEnvelope("refactor.verify", "AC_SCHEMA_INVALID", "refactor-recommendation-missing", {recommendationId: input.recommendationId});
      }
      let decisions: RefactorDecisionSetV1;
      try {
        decisions = readRefactorDecisionSet(repositoryRoot);
      } catch (error) {
        return refactorScanErrorEnvelope("refactor.verify", error);
      }
      // The terminal check below reads the status the checkout states (ADR-0046).
      const current = refactorStatusView(ledgerCurrent, decisions).record;
      if (current.schemaVersion !== RECOMMENDATION_V3_SCHEMA_VERSION) {
        return publicFailureEnvelope("refactor.verify", "AC_PRECONDITION_FAILED", "recommendation-v2-not-migrated", {recommendationId: current.recommendationId});
      }
      const recommendation = current as RecommendationV3;
      const ingressIssues = refactorVerifyIngressIssues(recommendation);
      if (ingressIssues.length > 0) return publicFailureEnvelope("refactor.verify", "AC_SCHEMA_INVALID", "refactor-invariant-invalid", {issueCount: ingressIssues.length});

      // A terminal record is not re-measured: its verdict is already in the ledger, and appending
      // a second one would let a later measurement rewrite a decision a human already acted on.
      if (current.status === "resolved" || current.status === "superseded") {
        const recorded = resolutionEvidenceForRecommendation(replay.evidenceState, recommendation.recommendationId);
        return this.refactorVerifyEnvelope({
          gitScope,
          recommendation,
          evidence: recorded[0],
          appendStatus: "not-appended",
          appendedEventCount: 0,
          graphDigest: replay.graphDigest
        });
      }

      const baseline = baselineSnapshotForRecommendation(replay.evidenceState, recommendation.recommendationId);
      // AFTER reads the import population BEFORE read, unless the caller names a limit.
      const importNodeLimit = input.importNodeLimit ?? baselineImportNodeLimit(baseline?.snapshot);
      let scan: RefactorScanResultV1;
      try {
        scan = runRefactorScan({
          root: repositoryRoot,
          request: repositoryRefactorRequest(importNodeLimit),
          repository: gitScope.repository,
          worktree: gitScope.worktree,
          previousRecommendations: artifacts.recommendations,
          decisions,
          catalogDigest: refactorClassifierRulesetDigest(RECOMMENDATION_SCHEDULER_ENGINE_VERSION)
        });
      } catch (error) {
        if (error instanceof RefactorScanError) return publicOperationErrorEnvelope("refactor.verify", error);
        return publicOperationErrorEnvelope("refactor.verify", error);
      }
      let plan: ReturnType<typeof runRefactorVerify>;
      try {
        plan = runRefactorVerify({
          recommendation,
          repository: scope.repository,
          worktree: scope.worktree,
          beforeSnapshotDigest: baseline?.snapshotDigest ?? recordedBaselineSnapshotDigest(recommendation),
          ...(baseline?.snapshot ? { beforeSnapshot: baseline.snapshot } : {}),
          ...(baseline?.unverifiable ? { beforeSnapshotUnverifiable: true } : {}),
          afterSnapshot: scan.snapshot,
          // A second read of the same HEAD, because `runRefactorScan` returns neither. It cannot
          // silently diverge from the scan: `evaluateResolution` binds both to the snapshot's
          // `modelDigest` and footprint digests and reports `stale` when they disagree.
          afterModel: loadNativeModelFromArchContext(repositoryRoot),
          afterTrackedFiles: readTrackedSourceFiles(repositoryRoot),
          ...(input.executionEvidenceRefs ? { executionEvidenceRefs: input.executionEvidenceRefs } : {}),
          evidenceState: replay.evidenceState,
          graphDigest: replay.graphDigest,
          verifiedAt: this.context.clock()
        });
      } catch (error) {
        return publicOperationErrorEnvelope("refactor.verify", error);
      }

      // `resolutionDigest` excludes the clock, so a second verify at the same HEAD recomputes the
      // same verdict. Returning the recorded one keeps the ledger at exactly one event per
      // measurement instead of one per invocation.
      const recorded = findResolutionEvidence(replay.evidenceState, plan.evidence.resolutionDigest);
      if (recorded) {
        return this.refactorVerifyEnvelope({
          gitScope,
          recommendation,
          evidence: recorded,
          appendStatus: "already-recorded",
          appendedEventCount: 0,
          graphDigest: replay.graphDigest
        });
      }

      // The identity check happened before the replay, the scan and the evaluation; the tree can
      // still move in between. Last look before anything is persisted.
      const preAppendScope = await this.context.architectureLedgerGitScope(repositoryRoot);
      const moved = movedWorktreeIdentityFields(gitScope.worktree, preAppendScope.worktree);
      if (moved.length > 0) {
        return publicFailureEnvelope("refactor.verify", "AC_REFACTOR_STALE", "refactor-verify-snapshot-changed", {recommendationId: input.recommendationId, changedFields: moved});
      }
      const append = await this.context.appendArchitectureEventsWithFeed(root, {
        writer: "runtime-daemon",
        events: [plan.event]
      });
      return this.refactorVerifyEnvelope({
        gitScope,
        recommendation,
        evidence: plan.evidence,
        appendStatus: "appended",
        appendedEventCount: append.appendedEvents.length,
        graphDigest: append.graphDigest,
        evidenceItemIds: [plan.resolutionItem.evidenceId, plan.afterSnapshotItem.evidenceId],
        evidenceBindingIds: [plan.binding.bindingId]
      });
    });
  }

  /** One envelope shape for all three verify outcomes, so a caller reads the same fields either way. */
  private refactorVerifyEnvelope(input: {
    gitScope: ArchitectureLedgerScope;
    recommendation: RecommendationV3;
    evidence: RefactorResolutionEvidenceV1 | undefined;
    appendStatus: "appended" | "already-recorded" | "not-appended";
    appendedEventCount: number;
    graphDigest: string;
    evidenceItemIds?: string[];
    evidenceBindingIds?: string[];
  }): JsonEnvelope {
    return okEnvelope("refactor.verify", {
      schemaVersion: "archcontext.runtime-refactor-verify/v1",
      repository: input.gitScope.repository,
      worktree: input.gitScope.worktree,
      recommendationId: input.recommendation.recommendationId,
      recommendationStatus: input.recommendation.status,
      disposition: input.evidence?.disposition ?? null,
      resolutionDigest: input.evidence?.resolutionDigest ?? null,
      evidence: (input.evidence ?? null) as unknown as Json,
      resolveCommand: input.evidence && input.evidence.disposition === "resolved"
        ? `archctx recommendations resolve --id ${input.recommendation.recommendationId} --evidence-digest ${input.evidence.resolutionDigest} --reason <why>`
        : null,
      evidenceItemIds: input.evidenceItemIds ?? [],
      evidenceBindingIds: input.evidenceBindingIds ?? [],
      append: {
        status: input.appendStatus,
        eventSource: "refactor_scan",
        appendedEventCount: input.appendedEventCount,
        graphDigest: input.graphDigest
      },
      privacy: {
        writes: "architecture-ledger-event-only",
        rawSourcePersisted: false,
        rawDiffPersisted: false,
        promptPersisted: false,
        implicitAcceptance: false
      }
    } as unknown as Json);
  }
}

class RuntimeRefactorInputError extends Error {}

/** `buildRefactorRecordEvent` failures: an oversize run is typed with its measured size, anything else is a defect. */
function recordBuildErrorEnvelope(surface: string, error: unknown): JsonEnvelope {
  if (error instanceof RefactorRunTooLargeError) return refactorRunTooLargeEnvelope(surface, error.recording);
  return publicOperationErrorEnvelope(surface, error);
}

function refactorRunTooLargeEnvelope(surface: string, recording: RefactorRunTooLargeError["recording"]): JsonEnvelope {
  return publicFailureEnvelope(surface, "AC_REFACTOR_RUN_TOO_LARGE", "refactor-run-exceeds-ledger-size-limit", {measuredBytes: recording.measuredBytes, limitBytes: recording.limitBytes});
}

/** Same shape check as `runtimeUpdateInputRecord`, reported under the refactor surface. */
function runtimeRefactorInputRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeRefactorInputError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * An RPC param is untyped JSON until something checks it, and the dispatch table only casts.
 * Only an absent `request` means "scan the repository": `null`, an array or a scalar is a caller
 * that meant something the daemon cannot honour, and answering it with the default scan would
 * report a measurement of a request nobody asked for.
 */
function decodeRuntimeRefactorScanInput(value: unknown): RuntimeRefactorScanInput {
  const input = runtimeRefactorInputRecord(value, "refactor scan input");
  if (input.request === undefined) return {};
  const request = runtimeRefactorInputRecord(input.request, "refactor scan request");
  return { request: request as unknown as RefactorRequestV1 };
}

function decodeRuntimeRefactorRecordInput(value: unknown): RuntimeRefactorRecordInput {
  const input = runtimeRefactorInputRecord(value, "refactor record input");
  if (typeof input.assessmentDigest !== "string" || input.assessmentDigest.length === 0) {
    throw new RuntimeRefactorInputError("refactor record assessmentDigest must be a non-empty string");
  }
  if (typeof input.expectedWorktreeDigest !== "string" || input.expectedWorktreeDigest.length === 0) {
    throw new RuntimeRefactorInputError("refactor record expectedWorktreeDigest must be a non-empty string");
  }
  // Nothing downstream reads a selection: recording replays every planned recommendation. Taking
  // one and ignoring it would report a subset the caller asked for and record the whole proposal.
  if (input.selection !== undefined) {
    throw new RuntimeRefactorInputError("refactor record does not support selection; every planned recommendation is recorded");
  }
  return {
    assessmentDigest: input.assessmentDigest,
    expectedWorktreeDigest: input.expectedWorktreeDigest
  };
}

/**
 * `recommendationId` is the only required subject: verify always measures whatever is at HEAD now.
 * `expectedHeadSha`/`expectedWorktreeDigest` are a caller's claim about the state it believes it
 * is verifying, and a claim that no longer holds must be refused rather than answered with fresh
 * numbers under the old identity.
 *
 * The per-field decoding stays here because it rebuilds the request from exactly the declared keys
 * and names the offending one; the frozen
 * `refactorVerificationRequestInvariantIssues` then re-proves the rebuilt request. Every ingress —
 * CLI `--request-json`, RPC dispatch, an in-process caller — therefore passes the same gate.
 */
function decodeRuntimeRefactorVerifyInput(value: unknown): RuntimeRefactorVerifyInput {
  const input = runtimeRefactorInputRecord(value, "refactor verify input");
  // The rebuild below reads only the declared keys, so an undeclared one would be dropped in
  // silence: `expectedWorktreeDigset` would remove the caller's freshness claim instead of
  // failing it. This is the last place the typo is still visible.
  const unknownKeys = Object.keys(input)
    .filter((key) => !(REFACTOR_VERIFICATION_REQUEST_KEYS as readonly string[]).includes(key))
    .sort();
  if (unknownKeys.length > 0) {
    throw new RuntimeRefactorInputError(`refactor verify input has unsupported key(s): ${unknownKeys.join(", ")}`);
  }
  if (typeof input.recommendationId !== "string" || input.recommendationId.trim() === "") {
    throw new RuntimeRefactorInputError("refactor verify recommendationId must be a non-empty string");
  }
  for (const field of ["expectedHeadSha", "expectedWorktreeDigest"] as const) {
    const claim = input[field];
    if (claim !== undefined && (typeof claim !== "string" || claim.length === 0)) {
      throw new RuntimeRefactorInputError(`refactor verify ${field} must be a non-empty string`);
    }
  }
  if (input.importNodeLimit !== undefined && typeof input.importNodeLimit !== "number") {
    throw new RuntimeRefactorInputError("refactor verify importNodeLimit must be a positive integer");
  }
  const request: RuntimeRefactorVerifyInput = {
    schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
    recommendationId: input.recommendationId,
    ...(typeof input.expectedHeadSha === "string" ? { expectedHeadSha: input.expectedHeadSha } : {}),
    ...(typeof input.expectedWorktreeDigest === "string" ? { expectedWorktreeDigest: input.expectedWorktreeDigest } : {}),
    ...(typeof input.importNodeLimit === "number" ? { importNodeLimit: input.importNodeLimit } : {}),
    ...(input.executionEvidenceRefs === undefined
      ? {}
      : { executionEvidenceRefs: decodeRuntimeExecutionEvidenceRefs(input.executionEvidenceRefs) })
  };
  if (input.schemaVersion !== REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION) {
    throw new RuntimeRefactorInputError(
      `refactor verify schemaVersion must be ${REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION}, received ${JSON.stringify(input.schemaVersion)}`
    );
  }
  const issues = refactorVerificationRequestInvariantIssues(request, "refactor verify request");
  if (issues.length > 0) throw new RuntimeRefactorInputError(issues.join("; "));
  return request;
}

/**
 * Verify evidence refs are digest-bound into the ledger, so the decoder rebuilds every element
 * from exactly the three declared fields. A caller key that rode through a cast (`rawDiff`,
 * `apiKey`) would be persisted under an envelope that promises `privacy.rawDiffPersisted: false`,
 * and the frozen invariant check only inspects `sha256` and `locator` — it would never see it.
 */
function decodeRuntimeExecutionEvidenceRefs(value: unknown): RefactorExecutionEvidenceRefV1[] {
  if (!Array.isArray(value)) {
    throw new RuntimeRefactorInputError("refactor verify executionEvidenceRefs must be an array");
  }
  return value.map((entry, index) => {
    const field = `refactor verify executionEvidenceRefs[${index}]`;
    const ref = runtimeRefactorInputRecord(entry, field);
    const extras = Object.keys(ref).filter((key) => key !== "kind" && key !== "locator" && key !== "sha256");
    if (extras.length > 0) {
      throw new RuntimeRefactorInputError(`${field} has unsupported key(s): ${[...extras].sort().join(", ")}`);
    }
    const { kind, locator, sha256 } = ref;
    if (typeof kind !== "string" || !(REFACTOR_EXECUTION_EVIDENCE_KINDS as readonly string[]).includes(kind)) {
      throw new RuntimeRefactorInputError(
        `${field}.kind must be one of ${REFACTOR_EXECUTION_EVIDENCE_KINDS.join(", ")}, received ${JSON.stringify(kind)}`
      );
    }
    if (typeof locator !== "string" || locator.trim() === "") {
      throw new RuntimeRefactorInputError(`${field}.locator must be a non-empty string`);
    }
    // A locator is a reference, not a body: unbounded, it is the one string field on a record
    // whose envelope promises `privacy.rawDiffPersisted: false`, so a raw diff or a credential
    // could be parked in it and every digest would still agree.
    if (!REFACTOR_EXECUTION_EVIDENCE_LOCATOR_PATTERN.test(locator)) {
      throw new RuntimeRefactorInputError(`${field}.locator ${REFACTOR_EXECUTION_EVIDENCE_LOCATOR_RULE}`);
    }
    if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new RuntimeRefactorInputError(`${field}.sha256 must be a bare SHA-256 hex digest`);
    }
    return { kind: kind as RefactorExecutionEvidenceRefV1["kind"], locator, sha256 };
  });
}

/**
 * The two fields `refactor record` binds a measurement to. A scan reads HEAD blobs, workspace
 * manifests and the code index after it captures the identity, and a record replays the ledger
 * after it validates one, so both have a window in which the tree can move underneath them.
 */
function movedWorktreeIdentityFields(
  captured: { headSha: string; worktreeDigest: string },
  live: { headSha: string; worktreeDigest: string }
): string[] {
  const moved: string[] = [];
  if (captured.headSha !== live.headSha) moved.push("headSha");
  if (captured.worktreeDigest !== live.worktreeDigest) moved.push("worktreeDigest");
  return moved;
}

export function recommendationArtifactsFromEvents(events: readonly ArchitectureEventV1[]): {
  recommendationRuns: RecommendationRunV1[];
  recommendations: RecommendationLedgerRecordV1[];
  feedback: RecommendationFeedbackV1[];
} {
  const recommendationRuns: RecommendationRunV1[] = [];
  const recommendations: RecommendationLedgerRecordV1[] = [];
  const feedback: RecommendationFeedbackV1[] = [];
  for (const event of events) {
    const payload = architectureLedgerPayload(event);
    recommendationRuns.push(...(payload.recommendationRuns ?? []) as unknown as RecommendationRunV1[]);
    recommendations.push(...(payload.recommendations ?? []) as unknown as RecommendationLedgerRecordV1[]);
    feedback.push(...(payload.feedback ?? []) as unknown as RecommendationFeedbackV1[]);
  }
  return { recommendationRuns, recommendations, feedback };
}

/**
 * The latest record for one id. `recommendations` arrive in ledger event order, and an equal
 * `updatedAt` resolves to the later event — the order the SQLite projection upserts in and the
 * order `aggregateRecommendationLifecycleMetrics` reads. A scan-candidate decision appends the
 * record and its decision under one clock, and the decision is the later event.
 */
function latestRecommendationById(
  recommendations: readonly RecommendationLedgerRecordV1[],
  recommendationId: string
): RecommendationLedgerRecordV1 | undefined {
  return latestRecommendationsById(recommendations.filter((recommendation) => recommendation.recommendationId === recommendationId))[0];
}

/** `latestRecommendationById` for every id: newest `updatedAt` first, then by id. */
function latestRecommendationsById(recommendations: readonly RecommendationLedgerRecordV1[]): RecommendationLedgerRecordV1[] {
  const latest = new Map<string, RecommendationLedgerRecordV1>();
  for (const recommendation of recommendations) {
    const current = latest.get(recommendation.recommendationId);
    if (!current || recommendation.updatedAt.localeCompare(current.updatedAt) >= 0) latest.set(recommendation.recommendationId, recommendation);
  }
  return [...latest.values()].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt) || left.recommendationId.localeCompare(right.recommendationId)
  );
}

/**
 * Typed not-found for a decision. `AC_REFACTOR_STALE` rather than `AC_SCHEMA_INVALID`: the id is
 * well-formed, it just names neither a recorded recommendation nor a candidate of the scan at the
 * current tree, and the action that fixes it is a fresh `refactor scan`, not a model repair.
 */
function recommendationNotFound(
  command: RecommendationFeedbackAction | "show",
  recommendationId: string,
  searched: "recorded" | "recorded-or-scanned"
): JsonEnvelope {
  return publicFailureEnvelope(`recommendations.${command}`, "AC_REFACTOR_STALE", "recommendation-not-found", {recommendationId, searched});
}

function evidenceItemsFor(items: readonly EvidenceItemV2[], bindings: readonly EvidenceBindingV1[]): EvidenceItemV2[] {
  const evidenceIds = new Set(bindings.map((binding) => binding.evidenceId));
  return items.filter((item) => evidenceIds.has(item.evidenceId)).sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
}

function recommendationShowEnvelope(input: {
  source: "ledger" | "scan-candidate" | "git-decision";
  /** Who states `status`: see `refactorRecommendationStatusView`; `scan-candidate` for a candidate. */
  statusAuthority: RefactorStatusAuthority | "scan-candidate";
  /** The checkout's Git decision for this id, when it carries one. */
  gitDecision: RefactorDecisionV1 | null;
  /** `null` exactly for `source: "git-decision"`: this worktree's ledger holds no record of the id. */
  recommendation: RecommendationLedgerRecordV1 | null;
  bindings: EvidenceBindingV1[];
  items: EvidenceItemV2[];
  baseline:
    | { status: "measured"; snapshotDigest: string; snapshot: ModuleStatisticsSnapshotV1 }
    | { status: "unverifiable"; snapshotDigest: string }
    | { status: "missing"; snapshotDigest: null };
  decisions: RecommendationFeedbackV1[];
  /** The tree a scan candidate was measured at; `null` for a recorded recommendation. */
  worktree: { headSha: string; worktreeDigest: string } | null;
}): JsonEnvelope {
  const recommendation = input.recommendation as RecommendationV2 | RecommendationV3 | null;
  const affectedNodeIds = recommendation !== null && "category" in recommendation && recommendation.category !== "practice"
    ? new Set((recommendation.payload as StructuralObservationPayloadV1 | RefactorProposalPayloadV1).affectedNodeIds)
    : new Set<string>();
  // Statistics come only from a baseline body that still proves its own digest: an unverifiable
  // or missing baseline reports its status and names no module numbers at all.
  const affectedModules = input.baseline.status === "measured"
    ? input.baseline.snapshot.modules.filter((module) => affectedNodeIds.has(module.nodeId))
    : [];
  return okEnvelope("recommendations.show", {
    schemaVersion: "archcontext.runtime-recommendation-show/v1",
    recommendationId: input.recommendation?.recommendationId ?? input.gitDecision!.recommendationId,
    source: input.source,
    status: input.recommendation?.status ?? input.gitDecision!.status,
    statusAuthority: input.statusAuthority,
    ...(input.gitDecision ? { gitDecision: input.gitDecision } : {}),
    recommendation: input.recommendation,
    evidence: { items: input.items, bindings: input.bindings },
    baseline: { status: input.baseline.status, snapshotDigest: input.baseline.snapshotDigest },
    affectedModules,
    decisions: input.decisions,
    worktree: input.worktree,
    privacy: {
      writes: "none",
      rawSourcePersisted: false,
      rawDiffPersisted: false,
      promptPersisted: false
    }
  } as unknown as Json);
}

function lifecycleEnvelope(input: {
  command: RecommendationFeedbackAction;
  current: RecommendationLedgerRecordV1;
  next: RecommendationLedgerRecordV1;
  feedback: RecommendationFeedbackV1;
  metrics: ReturnType<typeof aggregateRecommendationLifecycleMetrics>;
  append: ArchitectureLedgerAppendResult;
  /** Present exactly when the decided id was a scan candidate recorded in the same append. */
  implicitRecord: Record<string, Json> | null;
  /** The Git decision file a refactor decision wrote; `null` for a ledger-only practice decision. */
  decisionFile: string | null;
}): JsonEnvelope {
  return okEnvelope(`recommendations.${input.command}`, {
    schemaVersion: "archcontext.runtime-recommendation-lifecycle/v1",
    action: input.command,
    recommendationId: input.current.recommendationId,
    previousStatus: input.current.status,
    nextStatus: input.next.status,
    recommendation: input.next,
    feedback: input.feedback,
    metrics: input.metrics,
    implicitRecord: input.implicitRecord,
    decisionFile: input.decisionFile,
    append: {
      status: "appended",
      appendedEventCount: input.append.appendedEvents.length,
      duplicateEventCount: input.append.duplicateEvents.length,
      graphDigest: input.append.graphDigest,
      entityCount: input.append.entityCount,
      relationCount: input.append.relationCount,
      constraintCount: input.append.constraintCount
    },
    privacy: {
      writes: input.decisionFile === null ? "architecture-ledger-event-only" : "architecture-ledger-event-and-refactor-decision-file",
      rawSourcePersisted: false,
      rawDiffPersisted: false,
      promptPersisted: false,
      implicitAcceptance: false
    }
  } as unknown as Json);
}

/**
 * Whether a read must consult the decision set: a refactor record is in the answer, or the
 * checkout carries decisions. A repository with neither has no refactor status to state.
 */
function refactorDecisionsInPlay(repositoryRoot: string, records: readonly RecommendationLedgerRecordV1[]): boolean {
  return records.some(isRefactorRecommendation) || existsSync(join(repositoryRoot, REFACTOR_DECISION_DIRECTORY));
}

/**
 * Deciding a `ledger-audit` id would write a Git decision for a generation the planner no longer
 * holds as current: its human status lives only in this ledger, so the planner emits (or already
 * emitted) a newer generation of the same fingerprint that regresses from it. The refusal names
 * that generation. Each generation's id is derived from its fingerprint and the id it regresses
 * from, so the chain is walked forward from this id through every generation this ledger or this
 * checkout holds; when the last one held is itself ledger audit, the current generation is the
 * next id, which the scan emits and records.
 */
function ledgerAuditDecisionRefused(
  surface: string,
  record: RecommendationV3,
  recommendations: readonly RecommendationLedgerRecordV1[],
  decisions: RefactorDecisionSetV1
): JsonEnvelope {
  let head = record.recommendationId;
  let headIsAudit = true;
  for (;;) {
    const successor = refactorRecommendationId(record.fingerprint, head);
    const recorded = latestRecommendationById(recommendations, successor);
    if (!recorded && !decisions.byId.has(successor)) break;
    head = successor;
    headIsAudit = recorded !== undefined && refactorStatusView(recorded, decisions).authority === "ledger-audit";
  }
  const currentRecommendationId = headIsAudit ? refactorRecommendationId(record.fingerprint, head) : head;
  const currentRecorded = !headIsAudit && latestRecommendationById(recommendations, currentRecommendationId) !== undefined;
  return publicFailureEnvelope(surface, "AC_REFACTOR_STALE", "ledger-audit-generation", {currentRecommendationId, currentRecorded});
}

/**
 * The decision verb that records the generation a Git decision names in a worktree whose ledger
 * does not hold it, keeping the status the file states. `resolved` has none: it is terminal and is
 * reached only through `refactor verify` evidence in the worktree that holds the baseline.
 */
const GIT_DECISION_RECORD_VERB: Record<Exclude<RefactorDecisionV1["status"], "resolved">, Exclude<RecommendationFeedbackAction, "resolve">> = {
  acknowledged: "acknowledge",
  accepted: "accept",
  deferred: "defer",
  rejected: "reject",
  waived: "waive"
};

/**
 * `refactor verify` and `resolve` on an id that is decided in Git but was never recorded in this
 * worktree's ledger: there is no baseline here to verify against, and none is synthesized or
 * borrowed. The suggested command is the verb of the status the file states, so following it
 * records the current scan's generation here without changing the Git decision; verification can
 * follow that. A `resolved` file suggests no command: it is already closed.
 */
function gitDecisionNotRecordedHere(surface: string, decision: RefactorDecisionV1): JsonEnvelope {
  const recommendationId = decision.recommendationId;
  if (decision.status === "resolved") {
    return publicFailureEnvelope(surface, "AC_REFACTOR_EVIDENCE_REQUIRED", "git-decision-not-recorded", {recommendationId, decisionStatus: decision.status, recordCommand: null, verifyCommand: null});
  }
  const verb = GIT_DECISION_RECORD_VERB[decision.status];
  const recordCommand = `archctx recommendations ${verb} --id ${recommendationId} --reason <why>`;
  const verifyCommand = `archctx refactor verify --request-json '{"schemaVersion":"${REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION}","recommendationId":"${recommendationId}"}'`;
  return publicFailureEnvelope(surface, "AC_REFACTOR_EVIDENCE_REQUIRED", "git-decision-not-recorded", {recommendationId, decisionStatus: decision.status, recordCommand, verifyCommand});
}

/**
 * A refactor decision writes a Git file, so it needs the explicit approval: the CLI verb passes it,
 * every other ingress must pass `approved: true` itself (ADR-0046).
 */
function refactorDecisionApprovalError(command: RecommendationFeedbackAction, input: RuntimeRecommendationInput): JsonEnvelope | undefined {
  if (input.approved === true) return undefined;
  return publicFailureEnvelope(`recommendations.${command}`, "AC_USER_CONFIRMATION_REQUIRED", "refactor-decision-approval-required", {recommendationId: input.recommendationId});
}

/** A typed failure from the decision set or scan inputs keeps its code; anything else is a defect. */
function refactorScanErrorEnvelope(surface: string, error: unknown): JsonEnvelope {
  if (error instanceof RefactorScanError) return publicOperationErrorEnvelope(surface, error);
  return publicOperationErrorEnvelope(surface, error);
}

/**
 * The only door from a non-practice recommendation to `resolved`: a `refactor verify` verdict that
 * names this record, was measured at the *tree* being resolved against, and says `resolved`.
 *
 * Both halves of the identity are checked. HEAD drift is refused because a verdict measured at an
 * earlier commit describes a tree that no longer exists. Worktree drift is refused for the case
 * HEAD alone cannot see: uncommitted edits re-introduce the very cycle the verdict says is gone,
 * at the same commit, and a HEAD-only gate would resolve the record against a tree nobody
 * measured. The cost is a re-verify after any edit, which is the correct trade for a fail-closed
 * completion gate. `practice` recommendations keep their pre-RF4 behaviour: they carry no
 * measurable outcome and pass straight through.
 */
function refactorResolveGate(
  recommendation: RecommendationLedgerRecordV1,
  evidenceDigest: string | undefined,
  evidenceState: EvidenceStateAtCursorV1,
  worktree: { headSha: string; worktreeDigest: string }
): {
  code: "AC_PRECONDITION_FAILED" | "AC_REFACTOR_EVIDENCE_REQUIRED" | "AC_REFACTOR_STALE";
  message: string;
  reasonCode?: string;
  details?: Record<string, Json>;
} | undefined {
  if (recommendation.schemaVersion !== RECOMMENDATION_V3_SCHEMA_VERSION) {
    return {
      code: "AC_PRECONDITION_FAILED",
      message: `recommendation ${recommendation.recommendationId} is still ${recommendation.schemaVersion}; run archctx ledger migrate --recommendation-v3 --write before resolving`,
      reasonCode: "recommendation-v2-not-migrated",
      details: {recommendationId: recommendation.recommendationId}
    };
  }
  if (recommendation.category === "practice") return undefined;
  if (!evidenceDigest) {
    return {
      code: "AC_REFACTOR_EVIDENCE_REQUIRED",
      message: `recommendations resolve on category ${recommendation.category} requires --evidence-digest`,
      reasonCode: "evidence-digest-missing",
      details: {recommendationId: recommendation.recommendationId}
    };
  }
  const evidence = findResolutionEvidence(evidenceState, evidenceDigest);
  if (!evidence || evidence.recommendationId !== recommendation.recommendationId) {
    return {
      code: "AC_REFACTOR_EVIDENCE_REQUIRED",
      message: `no refactor resolution evidence ${evidenceDigest} is recorded for ${recommendation.recommendationId}; run archctx refactor verify`,
      reasonCode: "evidence-unknown",
      details: {recommendationId: recommendation.recommendationId, evidenceDigest}
    };
  }
  if (evidence.verifiedHeadSha !== worktree.headSha) {
    return {
      code: "AC_REFACTOR_STALE",
      message: `refactor resolution evidence ${evidenceDigest} was verified at ${evidence.verifiedHeadSha}, current HEAD is ${worktree.headSha}; run archctx refactor verify again`,
      reasonCode: "evidence-head-drift",
      details: {recommendationId: recommendation.recommendationId, evidenceDigest, expectedHeadSha: evidence.verifiedHeadSha, actualHeadSha: worktree.headSha}
    };
  }
  if (evidence.verifiedWorktreeDigest !== worktree.worktreeDigest) {
    return {
      code: "AC_REFACTOR_STALE",
      message: `refactor resolution evidence ${evidenceDigest} was verified over worktree ${evidence.verifiedWorktreeDigest}, current worktree is ${worktree.worktreeDigest}; run archctx refactor verify again`,
      reasonCode: "evidence-worktree-drift",
      details: {recommendationId: recommendation.recommendationId, evidenceDigest, expectedWorktreeDigest: evidence.verifiedWorktreeDigest, actualWorktreeDigest: worktree.worktreeDigest}
    };
  }
  if (evidence.disposition !== "resolved") {
    return {
      code: "AC_REFACTOR_EVIDENCE_REQUIRED",
      message: `refactor resolution evidence ${evidenceDigest} reports ${evidence.disposition}, not resolved`,
      reasonCode: "evidence-not-resolved",
      details: {recommendationId: recommendation.recommendationId, evidenceDigest, disposition: evidence.disposition}
    };
  }
  return undefined;
}

/** The baseline a record names. Both non-practice payloads carry it; `practice` never reaches here. */
function recordedBaselineSnapshotDigest(recommendation: RecommendationV3): string {
  return recommendation.category === "refactor_proposal"
    ? (recommendation.payload as RefactorProposalPayloadV1).baselineSnapshotDigest
    : (recommendation.payload as StructuralObservationPayloadV1).baselineSnapshotDigest;
}

function isRecommendationLifecycleCliAction(command: string): command is RecommendationFeedbackAction {
  return ["acknowledge", "accept", "reject", "defer", "waive", "resolve"].includes(command);
}

function recommendationActorKind(input: RuntimeRecommendationInput): ArchitectureActorKind {
  if (input.actorKind) return input.actorKind;
  if (input.source === "mcp") return "mcp";
  if (input.source === "daemon") return "daemon";
  if (input.source === "system") return "system";
  if (input.source === "subagent") return "subagent";
  return "cli";
}
