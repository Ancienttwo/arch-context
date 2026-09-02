import {
  REFACTOR_ASSESSMENT_SCHEMA_VERSION,
  digestJson,
  moduleStatisticsSnapshotInvariantIssues,
  refactorAssessmentDigest,
  refactorRequestInvariantIssues,
  type ArchitectureMajorChangeReasonCode,
  type EvidenceCoverageLevelV2,
  type Json,
  type ModuleStatisticsSnapshotV1,
  type ModuleStatisticsV1,
  type RefactorAssessmentV1,
  type RefactorObservationKind,
  type RefactorObservationV1,
  type RefactorProposalV1,
  type RefactorRequestV1,
  type RefactorScale,
  type RefactorScaleReasonCode
} from "@archcontext/contracts";
import { resolveOwnership } from "../../module-statistics/src/index";
import type { NativeModel } from "../../projection-engine/src/index";
import { deriveTargetDelta, withUnresolvedTargets, type TargetDeltaDerivationV1 } from "./target-delta";

export { deriveTargetDelta, withUnresolvedTargets, type TargetDeltaContextV1, type TargetDeltaDerivationV1 } from "./target-delta";

const DIGEST_PREFIX_LENGTH = "sha256:".length;
const SIGNAL_ID_LENGTH = 16;

/**
 * Pressure weights and thresholds are the pressure engine's own (high 25 / medium 15 / low 5,
 * capped at 100; `>= 60` high, `>= 30` medium). The engine itself is deliberately not called:
 * its observed predicates regex over file-path and symbol strings, and `multiple-lifecycle-owner`
 * folds the request's task text into an "observed" signal. RF2 admits nothing heuristic, so it
 * reuses the scoring and derives the signals from its own closed observation set instead.
 */
const PRESSURE_WEIGHTS: Readonly<Record<RefactorObservationKind, number>> = {
  cycle: 25,
  "direction-violation": 25,
  "ownership-ambiguous": 15,
  "unowned-paths": 15,
  "evidence-gap": 5,
  "undeclared-footprint": 5
};

export interface RefactorAssessmentInputV1 {
  snapshot: ModuleStatisticsSnapshotV1;
  /** The declared model the snapshot measured; bound to it through `snapshot.modelDigest`. */
  model: NativeModel;
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
  if (modelDigest(input.model) !== input.snapshot.modelDigest) {
    throw new Error("AC_SCHEMA_INVALID: model does not bind snapshot.modelDigest");
  }
  const declaredNodeIds = new Set(input.model.nodes.map((node) => node.id));
  if (input.request.scope.kind === "node" && !declaredNodeIds.has(input.request.scope.nodeId)) {
    throw new Error(`AC_SCHEMA_INVALID: request.scope.nodeId is not declared: ${input.request.scope.nodeId}`);
  }

  const observations = buildObservations(input.snapshot);
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
    pressure: derivePressure(observations),
    confidence: buildConfidence(input.snapshot, classification),
    createdAt: input.createdAt,
    assessmentDigest: ""
  };
  const assessment = { ...draft, assessmentDigest: refactorAssessmentDigest(draft) };
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
  metrics: Record<string, number | null>;
}

/**
 * The closed observation set, derived from the snapshot alone.
 *
 * `cycle` is emitted once per strongly connected component rather than once per member: the
 * component is the fact, and one record per member would report a single cycle N times and weight
 * the pressure score by component size.
 */
export function buildObservations(snapshot: ModuleStatisticsSnapshotV1): RefactorObservationV1[] {
  const repositorySubject = `repository:${snapshot.repository.repositoryId}`;
  const drafts: ObservationDraft[] = [];

  const componentMembers = new Map<string, ModuleStatisticsV1[]>();
  for (const module of snapshot.modules) {
    const componentId = module.dependencyGraph?.stronglyConnectedComponentId;
    if (!componentId) continue;
    const members = componentMembers.get(componentId);
    if (members) members.push(module);
    else componentMembers.set(componentId, [module]);
  }
  for (const [componentId, members] of componentMembers) {
    drafts.push({
      kind: "cycle",
      subjectSelectorId: `scc:${componentId}`,
      metrics: {
        memberCount: members.length,
        cycleEdgeCount: members.reduce((total, member) => total + (member.dependencyGraph?.cycleCount ?? 0), 0)
      }
    });
  }

  for (const module of snapshot.modules) {
    // The subject is the node, not the file: the model owner holding the glob is who can fix it.
    if (module.uncertainty.ambiguousOwnership) {
      drafts.push({
        kind: "ownership-ambiguous",
        subjectSelectorId: module.nodeId,
        metrics: { ownedFileCount: module.footprint?.fileCount ?? null }
      });
    }
    if (!module.footprintDeclared) {
      drafts.push({ kind: "undeclared-footprint", subjectSelectorId: module.nodeId, metrics: {} });
    }
    const violations = module.dependencyGraph?.directionViolationCount ?? null;
    if (violations !== null && violations > 0) {
      drafts.push({
        kind: "direction-violation",
        subjectSelectorId: module.nodeId,
        metrics: { directionViolationCount: violations }
      });
    }
  }

  // `RefactorObservationV1.metrics` is numeric, so the unowned paths themselves cannot be carried
  // here; the repository-scoped count is the whole observation.
  if (snapshot.repositorySummary.unownedFileCount > 0) {
    drafts.push({
      kind: "unowned-paths",
      subjectSelectorId: repositorySubject,
      metrics: { unownedFileCount: snapshot.repositorySummary.unownedFileCount }
    });
  }
  if (snapshot.codeFacts.coverage !== "complete") {
    drafts.push({
      kind: "evidence-gap",
      subjectSelectorId: repositorySubject,
      metrics: {
        unresolvedImportCount: snapshot.repositorySummary.unresolvedImportCount,
        edgeLimit: snapshot.codeFacts.edgeLimit
      }
    });
  }

  return drafts
    .map((draft) => ({ ...draft, signalIds: [signalIdFor(draft)] }))
    .sort((left, right) => compare(left.kind, right.kind) || compare(left.subjectSelectorId, right.subjectSelectorId));
}

interface ProposalClassification {
  scale: RefactorScale | null;
  reasonCodes: RefactorScaleReasonCode[];
  affectedNodeIds: string[];
  majorChangeReasons: ArchitectureMajorChangeReasonCode[];
  unresolvedTargets: string[];
  unresolvedEvidence: string[];
  coverage: EvidenceCoverageLevelV2;
}

function observationOnly(coverage: EvidenceCoverageLevelV2): ProposalClassification {
  return {
    scale: null,
    reasonCodes: [],
    affectedNodeIds: [],
    majorChangeReasons: [],
    unresolvedTargets: [],
    unresolvedEvidence: coverage === "complete" ? [] : [`coverage:${coverage}`],
    coverage
  };
}

function classifyProposal(context: {
  snapshot: ModuleStatisticsSnapshotV1;
  model: NativeModel;
  trackedFiles: readonly string[];
  scope: RefactorRequestV1["scope"];
  proposal: RefactorProposalV1;
}): ProposalClassification {
  const scopeOwnership = resolveScopePaths(context.model, context.trackedFiles, context.proposal.scopePaths);
  const derivation = deriveTargetDelta(context.proposal.targetDelta, {
    model: context.model,
    snapshot: context.snapshot,
    currentOwnerIds: scopeOwnership.owners
  });
  // Ancestors deliberately do not count: `resolveOwnership` already collapsed each file onto its
  // deepest owner, so two distinct owners mean two declared responsibility surfaces are touched.
  const affectedNodeIds = [...new Set([...scopeOwnership.owners, ...derivation.resolvedNodeIds])].sort();

  const relevantNodeIds = new Set(affectedNodeIds);
  if (context.scope.kind === "node") relevantNodeIds.add(context.scope.nodeId);
  const modulesById = new Map(context.snapshot.modules.map((module) => [module.nodeId, module]));
  const undeclared = [...relevantNodeIds].filter((id) => modulesById.get(id)?.footprintDeclared === false).sort();

  const coverage = context.snapshot.codeFacts.coverage;
  const codes = new Set<RefactorScaleReasonCode>(["caller-coverage-unknown"]);
  if (scopeOwnership.unowned.length > 0) codes.add("unowned-paths");
  if (undeclared.length > 0) codes.add("node-footprint-undeclared");
  if (coverage === "unknown") codes.add("code-facts-missing");
  if (coverage === "partial") codes.add("code-facts-truncated");
  if (scopeOwnership.contested.length > 0) codes.add("ownership-ambiguous");
  if (derivation.unresolvedTargets.length > 0) codes.add("target-unresolved");

  const scale = selectScale({
    unresolvedTargets: derivation.unresolvedTargets.length,
    unowned: scopeOwnership.unowned.length,
    undeclared: undeclared.length,
    contested: scopeOwnership.contested.length,
    coverage,
    majorChangeReasons: derivation.reasons.length,
    affectedNodeCount: affectedNodeIds.length
  });
  if (scale === "architecture") codes.add("major-change-detected");
  if (scale === "cross_module") codes.add("multi-node-scope");
  if (scale === "module") codes.add("single-node-scope");

  return {
    scale,
    reasonCodes: [...codes].sort(),
    affectedNodeIds,
    majorChangeReasons: derivation.reasons,
    unresolvedTargets: derivation.unresolvedTargets,
    unresolvedEvidence: buildUnresolvedEvidence({
      coverage,
      scopeOwnership,
      undeclared,
      derivation,
      affectedNodeIds,
      modulesById
    }),
    coverage
  };
}

/**
 * The fixed ladder, first match wins.
 *
 * `target-unresolved` leads because the frozen `refactorScanInvariantIssues` makes it absolute: a
 * non-empty `targetDelta.unresolvedTargets` requires `insufficient_evidence`, so a proposal that
 * both names an unresolvable target and touches an unowned path cannot be reported as
 * `model_adoption_required` without emitting an invalid pair. Below it, the model gate precedes
 * the evidence gate: `model_adoption_required` is fixable by a ChangeSet, while
 * `insufficient_evidence` may clear on the next index run.
 */
function selectScale(gates: {
  unresolvedTargets: number;
  unowned: number;
  undeclared: number;
  contested: number;
  coverage: EvidenceCoverageLevelV2;
  majorChangeReasons: number;
  affectedNodeCount: number;
}): RefactorScale {
  if (gates.unresolvedTargets > 0) return "insufficient_evidence";
  if (gates.unowned > 0 || gates.undeclared > 0) return "model_adoption_required";
  if (gates.coverage !== "complete" || gates.contested > 0) return "insufficient_evidence";
  if (gates.majorChangeReasons > 0) return "architecture";
  return gates.affectedNodeCount > 1 ? "cross_module" : "module";
}

interface ScopeOwnership {
  owners: string[];
  unowned: string[];
  contested: string[];
}

/**
 * Resolves `scopePaths` through RF1b's ownership rule.
 *
 * `resolveArchitectureOwnerForPath` is deliberately not used: it implements the ADR-0043
 * longest-literal-prefix tie-break for `archctx resolve --path`, which is a different rule from the
 * structural ancestor collapse the snapshot was measured with, and forking the two would let a
 * proposal's owners disagree with the modules it was assessed against.
 */
function resolveScopePaths(model: NativeModel, trackedFiles: readonly string[], scopePaths: string[]): ScopeOwnership {
  // `scopePaths` are tracked file paths (PRD RF2). Membership in the snapshot's own tracked-file
  // set is the test: a glob, a directory, or a path the commit does not carry names no file the
  // instrument observed, so it can never resolve to one deepest owner and fails the model gate.
  // Both sides are already contract-constrained to repo-relative POSIX, so exact string equality
  // is the comparison; a second path dialect here would fork the ownership rule.
  const tracked = new Set(trackedFiles);
  const filePaths = scopePaths.filter((path) => isFilePath(path) && tracked.has(path));
  const unowned = scopePaths.filter((path) => !isFilePath(path) || !tracked.has(path));
  const index = resolveOwnership(model.nodes, filePaths);
  const owners = new Set<string>();
  const contested: string[] = [];
  for (const path of filePaths) {
    const resolution = index.byPath.get(path);
    if (!resolution || resolution.owners.length === 0) {
      unowned.push(path);
      continue;
    }
    for (const owner of resolution.owners) owners.add(owner);
    if (resolution.ambiguous) contested.push(path);
  }
  return { owners: [...owners].sort(), unowned: unowned.sort(), contested: contested.sort() };
}

/** Defense in depth behind the tracked-file test: these shapes name a set, never one file. */
function isFilePath(path: string): boolean {
  return !/[*?[\]{}()!]/.test(path) && !path.endsWith("/");
}

function buildUnresolvedEvidence(context: {
  coverage: EvidenceCoverageLevelV2;
  scopeOwnership: ScopeOwnership;
  undeclared: string[];
  derivation: TargetDeltaDerivationV1;
  affectedNodeIds: string[];
  modulesById: Map<string, ModuleStatisticsV1>;
}): string[] {
  const evidence = new Set<string>();
  if (context.coverage !== "complete") evidence.add(`coverage:${context.coverage}`);
  for (const path of context.scopeOwnership.unowned) evidence.add(`unowned-path:${path}`);
  for (const path of context.scopeOwnership.contested) evidence.add(`ownership-ambiguous:${path}`);
  for (const nodeId of context.undeclared) evidence.add(`undeclared-footprint:${nodeId}`);
  for (const entry of context.derivation.unresolvedTargets) evidence.add(`target-unresolved:${entry}`);
  for (const nodeId of context.affectedNodeIds) {
    const module = context.modulesById.get(nodeId);
    if (!module) continue;
    if (module.tests.callerCoverage === null) evidence.add(`caller-coverage:${nodeId}`);
    if (module.tests.coverageStatus === "unknown") evidence.add(`tests:${nodeId}`);
  }
  // `benefitLedger.rollbackPoint` is agent prose; reading a non-empty string as an observed
  // rollback would invent evidence the instrument never measured.
  evidence.add("rollback:proposal");
  return [...evidence].sort();
}

function buildConfidence(
  snapshot: ModuleStatisticsSnapshotV1,
  classification: ProposalClassification
): RefactorAssessmentV1["confidence"] {
  const modulesById = new Map(snapshot.modules.map((module) => [module.nodeId, module]));
  const affected = classification.affectedNodeIds.map((id) => modulesById.get(id)).filter(isPresent);
  const coverages = affected.map((module) => module.tests.callerCoverage);
  const callerCoverage = affected.length > 0 && coverages.every(isNumber) ? Math.min(...coverages) : null;
  const testsObserved = affected.length === 0 || affected.some((module) => module.tests.coverageStatus === "unknown")
    ? null
    : affected.reduce((total, module) => total + (module.tests.observedTestEdges ?? 0), 0) > 0;
  const blocked = classification.scale === "insufficient_evidence" || classification.scale === "model_adoption_required";
  const level = blocked || classification.coverage === "unknown"
    ? "low"
    : classification.coverage === "complete" && classification.unresolvedEvidence.length === 0
      ? "high"
      : "medium";
  return {
    level,
    callerCoverage,
    testsObserved,
    // Rollback is never observed in v1: nothing in the snapshot records a revertable point.
    rollbackObserved: null,
    unresolvedEvidence: classification.unresolvedEvidence
  };
}

function derivePressure(observations: RefactorObservationV1[]): RefactorAssessmentV1["pressure"] {
  const score = Math.min(100, observations.reduce((total, observation) => total + PRESSURE_WEIGHTS[observation.kind], 0));
  return {
    level: score >= 60 ? "high" : score >= 30 ? "medium" : "low",
    score,
    signalIds: [...new Set(observations.flatMap((observation) => observation.signalIds))].sort()
  };
}

function signalIdFor(draft: ObservationDraft): string {
  const digest = digestJson(draft as unknown as Json);
  return `signal.${draft.kind}.${digest.slice(DIGEST_PREFIX_LENGTH, DIGEST_PREFIX_LENGTH + SIGNAL_ID_LENGTH)}`;
}

/** Mirrors the snapshot builder's model digest; it is the only way to bind a model to a snapshot. */
function modelDigest(model: NativeModel): string {
  return digestJson({
    nodes: [...model.nodes].sort((left, right) => compare(left.id, right.id)),
    relations: [...model.relations].sort((left, right) => compare(left.id, right.id)),
    flows: [...(model.flows ?? [])].sort((left, right) => compare(left.id, right.id))
  } as unknown as Json);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isNumber(value: number | null): value is number {
  return value !== null;
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
