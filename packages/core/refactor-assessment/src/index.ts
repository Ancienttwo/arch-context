import {
  REFACTOR_ASSESSMENT_SCHEMA_VERSION,
  digestJson,
  moduleStatisticsSnapshotInvariantIssues,
  refactorAssessmentDigest,
  refactorAssessmentInvariantIssues,
  refactorRequestInvariantIssues,
  type DependencyConstraintV1,
  type Json,
  type ModuleStatisticsSnapshotV1,
  type ModuleStatisticsV1,
  type RefactorAssessmentV1,
  type RefactorObservationEvidenceV1,
  type RefactorObservationKind,
  type RefactorObservationV1,
  type RefactorProposalV1,
  type RefactorRequestV1
} from "@archcontext/contracts";
import {
  bidirectionalModulePairs,
  moduleComponentId,
  residualModuleCycles,
  type ModuleStructureV1
} from "@archcontext/core/module-statistics";
import type { NativeModel } from "@archcontext/core/architecture-domain";
import { ObservationEvidenceBuilder } from "./evidence";
import { withUnresolvedTargets } from "./target-delta";
import {
  REFACTOR_OBSERVATION_SEVERITY_METRICS,
  buildConfidence,
  classifyProposal,
  compare,
  derivePressure,
  modelDigest,
  observationOnly,
  observationSeverityWorsened,
  scopeObservations
} from "./classification";

export { REFACTOR_OBSERVATION_SEVERITY_METRICS, observationSeverityWorsened };

export { deriveTargetDelta, withUnresolvedTargets, type TargetDeltaContextV1, type TargetDeltaDerivationV1 } from "./target-delta";
export {
  REFACTOR_RESOLUTION_METRICS,
  REFACTOR_RESOLUTION_RESIDUAL_CODES,
  deriveObservationOutcomes,
  evaluateResolution,
  readSnapshotMetric,
  refactorOutcomeVocabularyIssues,
  refactorResolutionOutcomeId,
  type DeriveObservationOutcomesInputV1,
  type RefactorResolutionInputV1,
  type RefactorResolutionMetric,
  type RefactorResolutionResidualCode,
  type SymbolKillListResolutionFactV1
} from "./resolution";
export { simulateRefactorPlan, type SimulateRefactorPlanInputV1 } from "./simulate";

const DIGEST_PREFIX_LENGTH = "sha256:".length;
const SIGNAL_ID_LENGTH = 16;

export interface RefactorAssessmentInputV1 {
  snapshot: ModuleStatisticsSnapshotV1;
  /**
   * The structure the snapshot counted (`measureModuleStatistics`), bound to it by
   * `snapshotDigest`. Observation evidence is drawn from it and from nothing else.
   */
  structure: ModuleStructureV1;
  /** The declared model the snapshot measured; bound to it through `snapshot.modelDigest`. */
  model: NativeModel;
  /** The constraints the snapshot evaluated; part of the same `snapshot.modelDigest` binding. */
  constraints?: DependencyConstraintV1[];
  /**
   * Repo-relative POSIX paths of the Git-tracked files the snapshot was measured over. A
   * `scopePath` outside this set names no file the instrument observed, so it cannot be owned.
   */
  trackedFiles: readonly string[];
  request: RefactorRequestV1;
  /** Caller-supplied identity and clock; both are excluded from `assessmentDigest`. */
  requestId: string;
  createdAt: string;
}

export interface RefactorAssessmentResultV1 {
  assessment: RefactorAssessmentV1;
  /**
   * The submitted proposal with `targetDelta.unresolvedTargets` filled. Present exactly when the
   * request carried one, so the caller can hand the pair straight to `refactorScanInvariantIssues`.
   */
  proposal?: RefactorProposalV1;
}

/**
 * Assesses one refactor request against a measured module-statistics snapshot.
 *
 * Pure and synchronous: no clock, no I/O, no randomness. `request.task` is accepted and never
 * read — the same request assessed with and without task text yields the same `assessmentDigest`.
 */
export function assessRefactor(input: RefactorAssessmentInputV1): RefactorAssessmentResultV1 {
  // The snapshot is the only evidence this classifier has. Reading one whose digests no longer
  // bind its payload would launder a tampered or half-built measurement into a signed assessment.
  const snapshotIssues = moduleStatisticsSnapshotInvariantIssues(input.snapshot);
  if (snapshotIssues.length > 0) throw new Error(`AC_SCHEMA_INVALID: ${snapshotIssues.join("; ")}`);
  const requestIssues = refactorRequestInvariantIssues(input.request);
  if (requestIssues.length > 0) throw new Error(`AC_SCHEMA_INVALID: ${requestIssues.join("; ")}`);
  // Without this binding the classifier would resolve ownership against a model the snapshot never
  // measured, and every derived node id would describe a different repository state.
  if (modelDigest(input.model, input.constraints ?? []) !== input.snapshot.modelDigest) {
    throw new Error("AC_SCHEMA_INVALID: model does not bind snapshot.modelDigest");
  }
  // Evidence read from a structure some other measurement produced would explain numbers it
  // never counted.
  if (input.structure.snapshotDigest !== input.snapshot.snapshotDigest) {
    throw new Error("AC_SCHEMA_INVALID: structure does not bind snapshot.snapshotDigest");
  }
  const declaredNodeIds = new Set(input.model.nodes.map((node) => node.id));
  if (input.request.scope.kind === "node" && !declaredNodeIds.has(input.request.scope.nodeId)) {
    throw new Error(`AC_SCHEMA_INVALID: request.scope.nodeId is not declared: ${input.request.scope.nodeId}`);
  }

  // The snapshot may include import neighbors for context. Report the observations that
  // involve the requested subjects.
  const observations = scopeObservations(
    buildObservations(input.snapshot, input.structure, input.model),
    input.request.scope,
    input.model,
    input.trackedFiles
  );
  const proposal = input.request.proposal;
  const classification = proposal
    ? classifyProposal({
      snapshot: input.snapshot,
      model: input.model,
      trackedFiles: input.trackedFiles,
      scope: input.request.scope,
      proposal
    })
    : observationOnly(input.snapshot.codeFacts.coverage);

  const draft: RefactorAssessmentV1 = {
    schemaVersion: REFACTOR_ASSESSMENT_SCHEMA_VERSION,
    requestId: input.requestId,
    statisticsSnapshotDigest: input.snapshot.snapshotDigest,
    modelDigest: input.snapshot.modelDigest,
    codeFactsDigest: digestJson(input.snapshot.codeFacts as unknown as Json),
    requestedScope: input.request.scope,
    proposalDigest: proposal ? proposal.proposalDigest : null,
    observations,
    scale: classification.scale,
    scaleReasonCodes: classification.reasonCodes,
    affectedNodeIds: classification.affectedNodeIds,
    majorChangeReasons: classification.majorChangeReasons,
    pressure: derivePressure(observations, input.snapshot),
    confidence: buildConfidence(input.snapshot, classification),
    createdAt: input.createdAt,
    assessmentDigest: ""
  };
  const assessment = { ...draft, assessmentDigest: refactorAssessmentDigest(draft) };
  // The assessment is digest-signed and handed to the recorder as-is: an observation whose
  // evidence breaks the contract (an over-long or multi-line specifier, say) fails here, typed,
  // rather than being rewritten into something the code index never reported.
  const assessmentIssues = refactorAssessmentInvariantIssues(assessment);
  if (assessmentIssues.length > 0) throw new Error(`AC_SCHEMA_INVALID: ${assessmentIssues.join("; ")}`);
  if (!proposal) return { assessment };
  return {
    assessment,
    proposal: proposal.targetDelta
      ? { ...proposal, targetDelta: withUnresolvedTargets(proposal.targetDelta, classification.unresolvedTargets) }
      : proposal
  };
}

interface ObservationDraft {
  kind: RefactorObservationKind;
  subjectSelectorId: string;
  affectedNodeIds: string[];
  metrics: Record<string, number | null>;
  evidence: RefactorObservationEvidenceV1;
}

/** The subject of a bidirectional pair; node ids carry no `|`, so the pair is unambiguous. */
export function refactorPairSubject(nodeIds: readonly [string, string]): string {
  return `pair:${nodeIds[0]}|${nodeIds[1]}`;
}

/**
 * The closed observation set, derived from the snapshot alone.
 *
 * Cycles are reported per bidirectional module pair, not per strongly connected component: a pair
 * is an actionable cut whose identity does not move when an unrelated module joins the component.
 * `cycle` is one pair `{A, B}`; its metrics are the pair's own distinct file edge counts from
 * `snapshot.moduleDependencies`. `residual-cycle` is each component that survives cutting the thin
 * direction of every pair, so a cycle with no bidirectional pair (A -> B -> C -> A) is never lost.
 */
export function buildObservations(
  snapshot: ModuleStatisticsSnapshotV1,
  structure: ModuleStructureV1,
  model: NativeModel
): RefactorObservationV1[] {
  const repositorySubject = `repository:${snapshot.repository.repositoryId}`;
  const evidence = new ObservationEvidenceBuilder(snapshot, structure, model);
  const drafts: ObservationDraft[] = [];

  for (const pair of bidirectionalModulePairs(snapshot.moduleDependencies)) {
    drafts.push({
      kind: "cycle",
      subjectSelectorId: refactorPairSubject(pair.nodeIds),
      affectedNodeIds: [...pair.nodeIds],
      metrics: {
        forwardEdgeCount: pair.forwardEdgeCount,
        backwardEdgeCount: pair.backwardEdgeCount,
        thinDirectionEdgeCount: pair.thinDirectionEdgeCount,
        totalEdgeCount: pair.totalEdgeCount
      },
      evidence: evidence.pair(pair.nodeIds, pair.thinDirection)
    });
  }
  for (const cycle of residualModuleCycles(snapshot.modules.map((module) => module.nodeId), snapshot.moduleDependencies)) {
    drafts.push({
      kind: "residual-cycle",
      subjectSelectorId: `cycle:${moduleComponentId(cycle.memberNodeIds)}`,
      affectedNodeIds: [...cycle.memberNodeIds],
      metrics: { memberCount: cycle.memberNodeIds.length, cycleEdgeCount: cycle.edges.length },
      evidence: evidence.residualCycle(cycle.memberNodeIds, cycle.edges)
    });
  }

  for (const module of snapshot.modules) {
    // The subject is the node, not the file: the model owner holding the glob is who can fix it.
    if (module.uncertainty.ambiguousOwnership) {
      drafts.push({
        kind: "ownership-ambiguous",
        subjectSelectorId: module.nodeId,
        affectedNodeIds: [module.nodeId],
        metrics: { ownedFileCount: module.footprint?.fileCount ?? null },
        evidence: evidence.ownershipAmbiguous(module.nodeId)
      });
    }
    if (!module.footprintDeclared) {
      drafts.push({
        kind: "undeclared-footprint",
        subjectSelectorId: module.nodeId,
        affectedNodeIds: [module.nodeId],
        metrics: {},
        evidence: evidence.undeclaredFootprint(module.nodeId)
      });
    }
    const violations = module.dependencyGraph?.directionViolationCount ?? null;
    if (violations !== null && violations > 0) {
      drafts.push({
        kind: "direction-violation",
        subjectSelectorId: module.nodeId,
        affectedNodeIds: [module.nodeId],
        metrics: { directionViolationCount: violations },
        evidence: evidence.directionViolation(module.nodeId)
      });
    }
    if ((module.cohesion?.lowCohesionFileCount ?? 0) > 0) {
      drafts.push({
        kind: "low-cohesion-god-file",
        subjectSelectorId: module.nodeId,
        affectedNodeIds: [module.nodeId],
        metrics: { flaggedFileCount: module.cohesion!.lowCohesionFileCount },
        evidence: evidence.lowCohesionGodFile(module.nodeId)
      });
    }
    if ((module.surfaces.entrypointBypassCount ?? 0) > 0) {
      drafts.push({
        kind: "entrypoint-bypass",
        subjectSelectorId: module.nodeId,
        affectedNodeIds: [module.nodeId],
        metrics: { entrypointBypassCount: module.surfaces.entrypointBypassCount! },
        evidence: evidence.entrypointBypass(module.nodeId)
      });
    }
    if ((module.dependencyGraph?.unstableDependencyCount ?? 0) > 0) {
      drafts.push({
        kind: "unstable-dependency",
        subjectSelectorId: module.nodeId,
        affectedNodeIds: [module.nodeId],
        metrics: { unstableDependencyCount: module.dependencyGraph!.unstableDependencyCount! },
        evidence: evidence.unstableDependency(module.nodeId)
      });
    }
  }
  for (const finding of structure.coChangeCouplings ?? []) {
    drafts.push({
      kind: "co-change-coupling",
      subjectSelectorId: refactorPairSubject(finding.memberNodeIds),
      affectedNodeIds: [...finding.memberNodeIds],
      metrics: { coChangePairCount: finding.pairs.length },
      evidence: evidence.coChangeCoupling(finding)
    });
  }

  // The metric is the repository-scoped count; the paths themselves ride in the bounded evidence.
  if (snapshot.repositorySummary.unownedFileCount > 0) {
    drafts.push({
      kind: "unowned-paths",
      subjectSelectorId: repositorySubject,
      affectedNodeIds: [],
      metrics: { unownedFileCount: snapshot.repositorySummary.unownedFileCount },
      evidence: evidence.unownedPaths()
    });
  }
  if (snapshot.codeFacts.coverage !== "complete") {
    drafts.push({
      kind: "evidence-gap",
      subjectSelectorId: repositorySubject,
      affectedNodeIds: [],
      metrics: {
        unresolvedImportCount: snapshot.repositorySummary.unresolvedImportCount,
        edgeLimit: snapshot.codeFacts.edgeLimit,
        ...(snapshot.codeFacts.importNodeCount === undefined ? {} : { importNodeCount: snapshot.codeFacts.importNodeCount })
      },
      evidence: evidence.evidenceGap()
    });
  }

  // Pairs keep the cheapest-cut order `bidirectionalModulePairs` produced; every other kind is
  // ordered by subject. The planner's cap reads candidates in this order within one score.
  return drafts
    .map((draft, index) => ({ draft, order: draft.kind === "cycle" ? index : 0 }))
    .sort((left, right) => compare(left.draft.kind, right.draft.kind)
      || left.order - right.order
      || compare(left.draft.subjectSelectorId, right.draft.subjectSelectorId))
    .map(({ draft }) => ({
      kind: draft.kind,
      subjectSelectorId: draft.subjectSelectorId,
      affectedNodeIds: draft.affectedNodeIds,
      signalIds: [signalIdFor(draft)],
      metrics: draft.metrics,
      evidence: draft.evidence
    }));
}

/** The signal names the measured fact (kind, subject, metrics); its evidence sample is not part of it. */
function signalIdFor(draft: ObservationDraft): string {
  // The signal names the measured fact: kind, subject, affected nodes and metrics.
  const { evidence: _evidence, ...fact } = draft;
  const digest = digestJson(fact as unknown as Json);
  return `signal.${draft.kind}.${digest.slice(DIGEST_PREFIX_LENGTH, DIGEST_PREFIX_LENGTH + SIGNAL_ID_LENGTH)}`;
}
