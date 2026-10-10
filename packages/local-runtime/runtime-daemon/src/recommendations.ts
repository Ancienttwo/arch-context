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
  transitionRecommendationLifecycle,
  type RecommendationFeedbackAction
} from "@archcontext/core/recommendation-engine";
import {
  RefactorAssessmentRegistry,
  RefactorRunPersistenceError,
  buildRefactorRecordEvent,
  refactorClassifierRulesetDigest,
  refactorProposalAuthorPairIssues,
  type RegisteredRefactorAssessmentV1
} from "./refactor-recording";
import {
  REPOSITORY_REFACTOR_REQUEST,
  RefactorScanError,
  runRefactorScan,
  type RefactorScanResultV1
} from "./refactor-scan";
import {
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
  RECOMMENDATION_V3_SCHEMA_VERSION,
  REFACTOR_EXECUTION_EVIDENCE_KINDS,
  REFACTOR_EXECUTION_EVIDENCE_LOCATOR_PATTERN,
  REFACTOR_EXECUTION_EVIDENCE_LOCATOR_RULE,
  REFACTOR_VERIFICATION_REQUEST_KEYS,
  REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
  refactorScanInvariantIssues,
  refactorVerificationRequestInvariantIssues,
  type RecommendationV3,
  type RefactorExecutionEvidenceRefV1,
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
  localStore: Pick<RuntimeLocalStore, "replayArchitectureLedger" | "resolveArchitectureLedgerScope">;
}

export class RecommendationsService {
  private readonly refactorAssessments = new RefactorAssessmentRegistry();

  constructor(private readonly context: RecommendationsContext) {}

  async recommendations(root: string, input: RuntimeRecommendationInput): Promise<JsonEnvelope> {
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
    if (command === "metrics") return readMetrics();
    if (command === "show") {
      if (!input.recommendationId) return errorEnvelope("recommendations.show", "AC_SCHEMA_INVALID", "recommendations show requires --id");
      return this.showRecommendation(repositoryRoot, input.recommendationId);
    }
    if (!isRecommendationLifecycleCliAction(command)) {
      return errorEnvelope("recommendations", "AC_SCHEMA_INVALID", "recommendations requires acknowledge|accept|reject|defer|waive|resolve|metrics|show");
    }
    if (!input.recommendationId) {
      return errorEnvelope(`recommendations.${command}`, "AC_SCHEMA_INVALID", `recommendations ${command} requires --id`);
    }
    if (!input.reason?.trim()) {
      return errorEnvelope(`recommendations.${command}`, "AC_SCHEMA_INVALID", `recommendations ${command} requires --reason`);
    }

    return this.context.withWriter(async () => {
      if (input.expectedWorktreeDigest) {
        this.context.assertFreshWorktree(repositoryRoot, input.expectedWorktreeDigest, `recommendations ${command}`);
      }
      const now = input.now ?? this.context.clock();
      const scope = await this.context.architectureLedgerScope(repositoryRoot);
      const replay = await this.context.localStore.replayArchitectureLedger({ ...scope, mode: "genesis" });
      const artifacts = recommendationArtifactsFromEvents(replay.events);
      const current = latestRecommendationById(artifacts.recommendations, input.recommendationId!);
      if (!current) {
        // `resolve` closes a record against `refactor verify` evidence bound to that record, so an
        // id the ledger has never held has nothing to resolve; every other decision is an opinion
        // about one observation identity and may be taken on a current scan candidate directly.
        if (command === "resolve") return recommendationNotFound(command, input.recommendationId!, "recorded");
        return this.decideScanCandidate(root, repositoryRoot, input, command, now);
      }
      let gatedWorktree: { headSha: string; worktreeDigest: string } | undefined;
      if (command === "resolve") {
        // The live HEAD, not the ledger scope's: the stored scope carries the identity of the last
        // appended event, and resolving is a claim about the tree that is here now.
        const liveScope = await this.context.architectureLedgerGitScope(repositoryRoot);
        gatedWorktree = liveScope.worktree;
        const gate = refactorResolveGate(current, input.evidenceDigest, replay.evidenceState, liveScope.worktree);
        if (gate) return errorEnvelope(`recommendations.${command}`, gate.code, gate.message, gate.reasonCode);
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
          return errorEnvelope(
            `recommendations.${command}`,
            "AC_REFACTOR_STALE",
            `worktree ${moved.join(" and ")} changed before the recommendations resolve append; run archctx refactor verify again`,
            "evidence-head-drift"
          );
        }
      }
      const append = await this.context.appendArchitectureEventsWithFeed(root, {
        writer: "runtime-daemon",
        events: [event]
      });
      const metrics = aggregateRecommendationLifecycleMetrics({
        recommendationRuns: artifacts.recommendationRuns,
        recommendations: [...artifacts.recommendations, next],
        feedback: [...artifacts.feedback, feedback],
        generatedAt: now
      });
      return lifecycleEnvelope({ command, current, next, feedback, metrics, append, implicitRecord: null });
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
    const measured = await this.measureRepository(repositoryRoot, REPOSITORY_REFACTOR_REQUEST, `recommendations ${command}`);
    if (!measured.ok) {
      return errorEnvelope(
        surface,
        measured.code,
        `recommendation ${recommendationId} is not recorded and the current refactor scan could not run: ${measured.message}`,
        measured.reasonCode
      );
    }
    const { gitScope, storageScope, replay, artifacts, result } = measured;
    if (!result.proposedRecommendations.some((candidate) => candidate.recommendationId === recommendationId)) {
      return recommendationNotFound(command, recommendationId, "recorded-or-scanned");
    }
    const registered: RegisteredRefactorAssessmentV1 = {
      snapshot: result.snapshot,
      assessment: result.assessment,
      headSha: gitScope.worktree.headSha,
      worktreeDigest: gitScope.worktree.worktreeDigest
    };
    const scanIssues = refactorScanInvariantIssues({ snapshot: registered.snapshot, assessment: registered.assessment });
    if (scanIssues.length > 0) return errorEnvelope(surface, "AC_SCHEMA_INVALID", scanIssues.join("; "));
    let built: ReturnType<typeof buildRefactorRecordEvent>;
    try {
      built = buildRefactorRecordEvent({
        repository: storageScope.repository,
        worktree: storageScope.worktree,
        registered,
        previousRecommendations: artifacts.recommendations,
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
      return errorEnvelope(
        surface,
        "AC_REFACTOR_STALE",
        `recommendation ${recommendationId} was a scan candidate but the record plan did not produce it; run refactor scan again`,
        "scan-candidate-not-recorded"
      );
    }
    const decision = this.lifecycleDecision({
      scope: storageScope,
      graphDigest: replay.graphDigest,
      current: recorded as RecommendationLedgerRecordV1,
      command,
      input,
      now
    });
    if ("error" in decision) return decision.error;
    const { next, feedback, event } = decision;
    // Same last look `refactor record` takes: the record binds the measurement to this tree.
    const preAppendScope = await this.context.architectureLedgerGitScope(repositoryRoot);
    const moved = movedWorktreeIdentityFields(gitScope.worktree, preAppendScope.worktree);
    if (moved.length > 0) {
      return errorEnvelope(
        surface,
        "AC_REFACTOR_STALE",
        `worktree ${moved.join(" and ")} changed before the recommendations ${command} append; run it again`
      );
    }
    const append = await this.context.appendArchitectureEventsWithFeed(root, {
      writer: "runtime-daemon",
      events: [built.event, event]
    });
    const metrics = aggregateRecommendationLifecycleMetrics({
      recommendationRuns: [...artifacts.recommendationRuns, built.plan.run],
      recommendations: [...artifacts.recommendations, ...built.plan.recommendations as RecommendationLedgerRecordV1[], next],
      feedback: [...artifacts.feedback, feedback],
      generatedAt: now
    });
    return lifecycleEnvelope({
      command,
      current: recorded as RecommendationLedgerRecordV1,
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
      }
    });
  }

  /**
   * One read that answers "why does this recommendation exist and what happened to it": the
   * record, the evidence items and bindings it resolves to, the measured statistics of the modules
   * it names, and every explicit decision. Read-only; nothing is appended or registered.
   *
   * A recorded id is answered from the ledger alone. An id the ledger does not hold is answered
   * from the repository scan at the tree that is here now, under the same identity a decision on
   * it would record, so a UI can show a candidate and then decide it by the same id.
   */
  private async showRecommendation(repositoryRoot: string, recommendationId: string): Promise<JsonEnvelope> {
    const scope = await this.context.architectureLedgerScope(repositoryRoot);
    const replay = await this.context.localStore.replayArchitectureLedger({ ...scope, mode: "genesis" });
    const artifacts = recommendationArtifactsFromEvents(replay.events);
    const recorded = latestRecommendationById(artifacts.recommendations, recommendationId);
    if (recorded) {
      const bindings = replay.evidenceState.evidenceBindings
        .filter((binding) => binding.target.kind === "recommendation" && binding.target.id === recommendationId)
        .sort((left, right) => left.bindingId.localeCompare(right.bindingId));
      const baseline = baselineSnapshotForRecommendation(replay.evidenceState, recommendationId);
      return recommendationShowEnvelope({
        source: "ledger",
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
    const measured = await this.measureRepository(repositoryRoot, REPOSITORY_REFACTOR_REQUEST, "recommendations show");
    if (!measured.ok) {
      return errorEnvelope(
        "recommendations.show",
        measured.code,
        `recommendation ${recommendationId} is not recorded and the current refactor scan could not run: ${measured.message}`,
        measured.reasonCode
      );
    }
    const candidate = measured.result.proposedRecommendations.find((entry) => entry.recommendationId === recommendationId);
    if (!candidate) return recommendationNotFound("show", recommendationId, "recorded-or-scanned");
    const bindings = measured.result.evidenceBindings
      .filter((binding) => binding.target.kind === "recommendation" && binding.target.id === recommendationId)
      .sort((left, right) => left.bindingId.localeCompare(right.bindingId));
    return recommendationShowEnvelope({
      source: "scan-candidate",
      recommendation: candidate as RecommendationLedgerRecordV1,
      bindings,
      items: evidenceItemsFor(measured.result.evidenceItems, bindings),
      baseline: { status: "measured", snapshotDigest: measured.result.snapshot.snapshotDigest, snapshot: measured.result.snapshot },
      decisions: [],
      worktree: { headSha: measured.gitScope.worktree.headSha, worktreeDigest: measured.gitScope.worktree.worktreeDigest }
    });
  }

  /** The transition, its explicit feedback and the lifecycle event, shared by both decide paths. */
  private lifecycleDecision(input: {
    scope: ArchitectureLedgerScope;
    graphDigest: string;
    current: RecommendationLedgerRecordV1;
    command: RecommendationFeedbackAction;
    input: RuntimeRecommendationInput;
    now: string;
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
        error: errorEnvelope(
          `recommendations.${command}`,
          "AC_PRECONDITION_FAILED",
          error instanceof Error ? error.message : String(error)
        )
      };
    }
    if (next.status === current.status) {
      return {
        error: errorEnvelope(
          `recommendations.${command}`,
          "AC_PRECONDITION_FAILED",
          `recommendation lifecycle no-op: ${current.status}->${next.status}`
        )
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
    label: string
  ): Promise<
    | {
      ok: true;
      gitScope: ArchitectureLedgerScope;
      storageScope: ArchitectureLedgerScope;
      replay: Awaited<ReturnType<RecommendationsContext["localStore"]["replayArchitectureLedger"]>>;
      artifacts: ReturnType<typeof recommendationArtifactsFromEvents>;
      result: RefactorScanResultV1;
    }
    | { ok: false; code: ArchContextErrorCode; message: string; reasonCode?: string }
  > {
    const gitScope = await this.context.architectureLedgerGitScope(repositoryRoot);
    const storageScope = await this.context.localStore.resolveArchitectureLedgerScope(gitScope);
    const replay = await this.context.localStore.replayArchitectureLedger({ ...storageScope, mode: "genesis" });
    const artifacts = recommendationArtifactsFromEvents(replay.events);
    let result: RefactorScanResultV1;
    try {
      result = runRefactorScan({
        root: repositoryRoot,
        request,
        repository: gitScope.repository,
        worktree: gitScope.worktree,
        previousRecommendations: artifacts.recommendations,
        catalogDigest: refactorClassifierRulesetDigest(RECOMMENDATION_SCHEDULER_ENGINE_VERSION)
      });
    } catch (error) {
      if (error instanceof RefactorScanError) {
        return { ok: false, code: error.code, message: error.message, ...(error.reasonCode ? { reasonCode: error.reasonCode } : {}) };
      }
      return { ok: false, code: "AC_SCHEMA_INVALID", message: error instanceof Error ? error.message : String(error) };
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
        message: `worktree ${movedDuringScan.join(" and ")} changed while ${label} was reading the repository; run ${label} again`
      };
    }
    return { ok: true, gitScope, storageScope, replay, artifacts, result };
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
    this.context.assertRunning();
    let input: RuntimeRefactorScanInput;
    try {
      input = decodeRuntimeRefactorScanInput(rawInput);
    } catch (error) {
      if (error instanceof RuntimeRefactorInputError) return errorEnvelope("refactor.scan", "AC_SCHEMA_INVALID", error.message);
      throw error;
    }
    const repositoryRoot = findRepositoryRoot(root);
    const request = input.request ?? REPOSITORY_REFACTOR_REQUEST;
    const measured = await this.measureRepository(repositoryRoot, request, "refactor scan");
    if (!measured.ok) return errorEnvelope("refactor.scan", measured.code, measured.message, measured.reasonCode);
    const { gitScope, result } = measured;
    this.registerRefactorAssessment({
      snapshot: result.snapshot,
      assessment: result.assessment,
      ...(result.proposal ? { proposal: result.proposal } : {}),
      headSha: gitScope.worktree.headSha,
      worktreeDigest: gitScope.worktree.worktreeDigest
    });
    return okEnvelope("refactor.scan", {
      schemaVersion: "archcontext.runtime-refactor-scan/v1",
      repository: gitScope.repository,
      worktree: gitScope.worktree,
      requestId: result.requestId,
      request,
      trackedFileCount: result.trackedFileCount,
      snapshot: result.snapshot,
      assessment: result.assessment,
      ...(result.proposal ? { proposal: result.proposal } : {}),
      proposedRecommendations: result.proposedRecommendations,
      // Every `evidenceBindingIds` entry a candidate carries resolves here, before any record.
      evidenceItems: result.evidenceItems,
      evidenceBindings: result.evidenceBindings,
      suppressed: result.suppressed,
      recordCommand: `archctx refactor record --assessment-digest ${result.assessment.assessmentDigest} --expected-worktree-digest ${gitScope.worktree.worktreeDigest}`,
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
    this.context.assertRunning();
    return this.refactorAssessments.register(input);
  }

  async refactorRecord(root: string, rawInput: RuntimeRefactorRecordInput): Promise<JsonEnvelope> {
    this.context.assertRunning();
    let input: RuntimeRefactorRecordInput;
    try {
      input = decodeRuntimeRefactorRecordInput(rawInput);
    } catch (error) {
      if (error instanceof RuntimeRefactorInputError) return errorEnvelope("refactor.record", "AC_SCHEMA_INVALID", error.message);
      throw error;
    }
    const repositoryRoot = findRepositoryRoot(root);
    return this.context.withWriter(async () => {
      const registered = this.refactorAssessments.get(input.assessmentDigest);
      if (!registered) {
        return errorEnvelope(
          "refactor.record",
          "AC_SCHEMA_INVALID",
          `refactor assessment not found: ${input.assessmentDigest}; run refactor scan again`
        );
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
        return errorEnvelope(
          "refactor.record",
          "AC_REFACTOR_STALE",
          `refactor assessment ${input.assessmentDigest} was measured at a different worktree state; run refactor scan again`
        );
      }
      // The event still lands in the ledger scope the workspace's prior events live in, so the
      // chain and its replay stay one continuous log. Deferred to 0.6.0: decoupling that ledger
      // partition key from the identity the event itself carries.
      const scope = await this.context.localStore.resolveArchitectureLedgerScope(gitScope);
      if (registered.proposal) {
        const authorIssues = refactorProposalAuthorPairIssues(registered.proposal.authoredBy);
        if (authorIssues.length > 0) {
          return errorEnvelope("refactor.record", "AC_REFACTOR_PROPOSAL_UNAUTHORED", authorIssues.join("; "));
        }
      }
      const scanIssues = refactorScanInvariantIssues({
        snapshot: registered.snapshot,
        assessment: registered.assessment,
        ...(registered.proposal ? { proposal: registered.proposal } : {})
      });
      if (scanIssues.length > 0) return errorEnvelope("refactor.record", "AC_SCHEMA_INVALID", scanIssues.join("; "));

      const replay = await this.context.localStore.replayArchitectureLedger({ ...scope, mode: "genesis" });
      const artifacts = recommendationArtifactsFromEvents(replay.events);
      let built: ReturnType<typeof buildRefactorRecordEvent>;
      try {
        built = buildRefactorRecordEvent({
          repository: scope.repository,
          worktree: scope.worktree,
          registered,
          previousRecommendations: artifacts.recommendations,
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
        return errorEnvelope(
          "refactor.record",
          "AC_REFACTOR_STALE",
          `worktree ${movedBeforeAppend.join(" and ")} changed before the refactor record append; run refactor scan again`
        );
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
    this.context.assertRunning();
    let input: RuntimeRefactorVerifyInput;
    try {
      input = decodeRuntimeRefactorVerifyInput(rawInput);
    } catch (error) {
      if (error instanceof RuntimeRefactorInputError) return errorEnvelope("refactor.verify", "AC_SCHEMA_INVALID", error.message);
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
        return errorEnvelope(
          "refactor.verify",
          "AC_REFACTOR_STALE",
          `refactor verify expected HEAD ${input.expectedHeadSha}, current ${gitScope.worktree.headSha}`
        );
      }
      // Ledger replay and append share the recorded partition; the response reports live Git identity.
      const scope = await this.context.localStore.resolveArchitectureLedgerScope(gitScope);
      const replay = await this.context.localStore.replayArchitectureLedger({ ...scope, mode: "genesis" });
      const artifacts = recommendationArtifactsFromEvents(replay.events);
      const current = latestRecommendationById(artifacts.recommendations, input.recommendationId);
      if (!current) {
        return errorEnvelope("refactor.verify", "AC_SCHEMA_INVALID", `recommendation not found: ${input.recommendationId}`);
      }
      if (current.schemaVersion !== RECOMMENDATION_V3_SCHEMA_VERSION) {
        return errorEnvelope(
          "refactor.verify",
          "AC_PRECONDITION_FAILED",
          `recommendation ${current.recommendationId} is still ${current.schemaVersion}; run archctx ledger migrate --recommendation-v3 --write before verifying`,
          "recommendation-v2-not-migrated"
        );
      }
      const recommendation = current as RecommendationV3;
      const ingressIssues = refactorVerifyIngressIssues(recommendation);
      if (ingressIssues.length > 0) return errorEnvelope("refactor.verify", "AC_SCHEMA_INVALID", ingressIssues.join("; "));

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

      let scan: RefactorScanResultV1;
      try {
        scan = runRefactorScan({
          root: repositoryRoot,
          request: REPOSITORY_REFACTOR_REQUEST,
          repository: gitScope.repository,
          worktree: gitScope.worktree,
          previousRecommendations: artifacts.recommendations,
          catalogDigest: refactorClassifierRulesetDigest(RECOMMENDATION_SCHEDULER_ENGINE_VERSION)
        });
      } catch (error) {
        if (error instanceof RefactorScanError) return errorEnvelope("refactor.verify", error.code, error.message, error.reasonCode);
        return errorEnvelope("refactor.verify", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
      }
      const baseline = baselineSnapshotForRecommendation(replay.evidenceState, recommendation.recommendationId);
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
        return errorEnvelope("refactor.verify", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
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
        return errorEnvelope(
          "refactor.verify",
          "AC_REFACTOR_STALE",
          `worktree ${moved.join(" and ")} changed before the refactor verify append; run refactor verify again`
        );
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

/** `buildRefactorRecordEvent` failures: an oversize run keeps its reason code, anything else is a defect. */
function recordBuildErrorEnvelope(surface: string, error: unknown): JsonEnvelope {
  if (error instanceof RefactorRunPersistenceError) return errorEnvelope(surface, error.code, error.message, error.reasonCode);
  return errorEnvelope(surface, "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
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
  const request: RuntimeRefactorVerifyInput = {
    schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
    recommendationId: input.recommendationId,
    ...(typeof input.expectedHeadSha === "string" ? { expectedHeadSha: input.expectedHeadSha } : {}),
    ...(typeof input.expectedWorktreeDigest === "string" ? { expectedWorktreeDigest: input.expectedWorktreeDigest } : {}),
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
  let latest: RecommendationLedgerRecordV1 | undefined;
  for (const recommendation of recommendations) {
    if (recommendation.recommendationId !== recommendationId) continue;
    if (!latest || recommendation.updatedAt.localeCompare(latest.updatedAt) >= 0) latest = recommendation;
  }
  return latest;
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
  return errorEnvelope(
    `recommendations.${command}`,
    "AC_REFACTOR_STALE",
    searched === "recorded"
      ? `recommendation not found: ${recommendationId} is not recorded; recommendations ${command} applies only to recorded recommendations`
      : `recommendation not found: ${recommendationId} is neither recorded nor a candidate of the current refactor scan; run refactor scan again`,
    "recommendation-not-found"
  );
}

function evidenceItemsFor(items: readonly EvidenceItemV2[], bindings: readonly EvidenceBindingV1[]): EvidenceItemV2[] {
  const evidenceIds = new Set(bindings.map((binding) => binding.evidenceId));
  return items.filter((item) => evidenceIds.has(item.evidenceId)).sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
}

function recommendationShowEnvelope(input: {
  source: "ledger" | "scan-candidate";
  recommendation: RecommendationLedgerRecordV1;
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
  const recommendation = input.recommendation as RecommendationV2 | RecommendationV3;
  const affectedNodeIds = "category" in recommendation && recommendation.category !== "practice"
    ? new Set((recommendation.payload as StructuralObservationPayloadV1 | RefactorProposalPayloadV1).affectedNodeIds)
    : new Set<string>();
  // Statistics come only from a baseline body that still proves its own digest: an unverifiable
  // or missing baseline reports its status and names no module numbers at all.
  const affectedModules = input.baseline.status === "measured"
    ? input.baseline.snapshot.modules.filter((module) => affectedNodeIds.has(module.nodeId))
    : [];
  return okEnvelope("recommendations.show", {
    schemaVersion: "archcontext.runtime-recommendation-show/v1",
    recommendationId: input.recommendation.recommendationId,
    source: input.source,
    status: input.recommendation.status,
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
      writes: "architecture-ledger-event-only",
      rawSourcePersisted: false,
      rawDiffPersisted: false,
      promptPersisted: false,
      implicitAcceptance: false
    }
  } as unknown as Json);
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
} | undefined {
  if (recommendation.schemaVersion !== RECOMMENDATION_V3_SCHEMA_VERSION) {
    return {
      code: "AC_PRECONDITION_FAILED",
      message: `recommendation ${recommendation.recommendationId} is still ${recommendation.schemaVersion}; run archctx ledger migrate --recommendation-v3 --write before resolving`,
      reasonCode: "recommendation-v2-not-migrated"
    };
  }
  if (recommendation.category === "practice") return undefined;
  if (!evidenceDigest) {
    return {
      code: "AC_REFACTOR_EVIDENCE_REQUIRED",
      message: `recommendations resolve on category ${recommendation.category} requires --evidence-digest`,
      reasonCode: "evidence-digest-missing"
    };
  }
  const evidence = findResolutionEvidence(evidenceState, evidenceDigest);
  if (!evidence || evidence.recommendationId !== recommendation.recommendationId) {
    return {
      code: "AC_REFACTOR_EVIDENCE_REQUIRED",
      message: `no refactor resolution evidence ${evidenceDigest} is recorded for ${recommendation.recommendationId}; run archctx refactor verify`,
      reasonCode: "evidence-unknown"
    };
  }
  if (evidence.verifiedHeadSha !== worktree.headSha) {
    return {
      code: "AC_REFACTOR_STALE",
      message: `refactor resolution evidence ${evidenceDigest} was verified at ${evidence.verifiedHeadSha}, current HEAD is ${worktree.headSha}; run archctx refactor verify again`,
      reasonCode: "evidence-head-drift"
    };
  }
  if (evidence.verifiedWorktreeDigest !== worktree.worktreeDigest) {
    return {
      code: "AC_REFACTOR_STALE",
      message: `refactor resolution evidence ${evidenceDigest} was verified over worktree ${evidence.verifiedWorktreeDigest}, current worktree is ${worktree.worktreeDigest}; run archctx refactor verify again`,
      reasonCode: "evidence-worktree-drift"
    };
  }
  if (evidence.disposition !== "resolved") {
    return {
      code: "AC_REFACTOR_EVIDENCE_REQUIRED",
      message: `refactor resolution evidence ${evidenceDigest} reports ${evidence.disposition}, not resolved`,
      reasonCode: "evidence-not-resolved"
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
