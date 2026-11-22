import type { RecommendationV3, RefactorProposalPayloadV1, StructuralObservationPayloadV1 } from "./ledger";
import { RECOMMENDATION_CATEGORIES, RECOMMENDATION_V3_SCHEMA_VERSION } from "./ledger-records";
import { REFACTOR_RESOLUTION_EVIDENCE_SCHEMA_VERSION } from "./refactor-constants";
import type { RefactorAssessmentV1, RefactorResolutionEvidenceV1 } from "./refactor-evidence-types";
import {
  refactorAssessmentInvariantIssues,
  refactorObservationEvidenceIssues
} from "./refactor-observation-validators";
import {
  moduleStatisticsSnapshotInvariantIssues,
  refactorProposalInvariantIssues,
  refactorResolutionEvidenceDigest
} from "./refactor-snapshot-validators";
import type { ModuleStatisticsSnapshotV1, RefactorProposalV1 } from "./refactor-types";
import {
  digestIssues,
  isPresent,
  isRefactorProposalAuthorSource,
  outcomeIssues as outcomeIssuesWithFallback,
  outcomeSatisfied,
  recommendationPayloadShapeIssues,
  refactorProposalAuthorIssues,
  sortedUniqueIssues
} from "./refactor-validation-helpers";
import { digestJson } from "./schema";

export function refactorResolutionEvidenceInvariantIssues(
  evidence: RefactorResolutionEvidenceV1,
  prefix = "resolutionEvidence"
): string[] {
  const issues = [
    ...digestIssues(`${prefix}.resolutionDigest`, evidence.resolutionDigest),
    ...digestIssues(`${prefix}.recommendationDigest`, evidence.recommendationDigest),
    ...digestIssues(`${prefix}.beforeSnapshotDigest`, evidence.beforeSnapshotDigest),
    ...digestIssues(`${prefix}.afterSnapshotDigest`, evidence.afterSnapshotDigest),
    ...outcomeIssuesWithFallback(`${prefix}.expectedOutcomes`, evidence.expectedOutcomes),
    ...sortedUniqueIssues(`${prefix}.observedOutcomes.outcomeId`, evidence.observedOutcomes.map((outcome) => outcome.outcomeId))
  ];
  if (evidence.schemaVersion !== REFACTOR_RESOLUTION_EVIDENCE_SCHEMA_VERSION) issues.push(`${prefix}.schemaVersion is invalid`);
  const observedById = new Map(evidence.observedOutcomes.map((outcome) => [outcome.outcomeId, outcome]));
  for (const expected of evidence.expectedOutcomes) {
    if (!observedById.has(expected.outcomeId)) issues.push(`${prefix}.observedOutcomes is missing outcome ${expected.outcomeId}`);
  }
  for (const ref of evidence.executionEvidenceRefs) {
    if (!/^[a-f0-9]{64}$/.test(ref.sha256)) issues.push(`${prefix}.executionEvidenceRefs.sha256 must be a bare SHA-256 hex digest`);
    if (ref.locator.trim() === "") issues.push(`${prefix}.executionEvidenceRefs.locator must not be empty`);
  }
  for (const expected of evidence.expectedOutcomes) {
    const observed = observedById.get(expected.outcomeId);
    if (!observed) continue;
    const recomputed = outcomeSatisfied(expected, observed.observedValue);
    if (observed.satisfied !== recomputed) {
      issues.push(
        `${prefix}.observedOutcomes ${expected.outcomeId} claims satisfied=${observed.satisfied} but ${expected.metric} ${expected.operator} ${expected.value} against ${observed.observedValue} is ${recomputed}`
      );
    }
  }
  if (evidence.disposition !== "stale") {
    const required = evidence.expectedOutcomes.filter((outcome) => outcome.required);
    const observedRequired = required
      .map((outcome) => {
        const observed = observedById.get(outcome.outcomeId);
        return observed ? { outcome, satisfied: outcomeSatisfied(outcome, observed.observedValue) } : undefined;
      })
      .filter(isPresent);
    const regressed = evidence.observedOutcomes.some((outcome) => outcome.direction === "regressed");
    const satisfiedCount = observedRequired.filter((entry) => entry.satisfied).length;
    if (regressed && evidence.disposition !== "regressed") {
      issues.push(`${prefix}.disposition must be regressed when any observed outcome regressed`);
    }
    if (!regressed && required.length > 0) {
      if (satisfiedCount === required.length && evidence.disposition !== "resolved") {
        issues.push(`${prefix}.disposition must be resolved when every required outcome is satisfied`);
      }
      if (satisfiedCount === 0 && evidence.disposition !== "not_improved") {
        issues.push(`${prefix}.disposition must be not_improved when no required outcome is satisfied`);
      }
      if (satisfiedCount > 0 && satisfiedCount < required.length && evidence.disposition !== "partially_resolved") {
        issues.push(`${prefix}.disposition must be partially_resolved when only some required outcomes are satisfied`);
      }
    }
  }
  if (refactorResolutionEvidenceDigest(evidence) !== evidence.resolutionDigest) {
    issues.push(`${prefix}.resolutionDigest must bind the verified payload`);
  }
  return issues;
}

/**
 * Guards the one invariant the `RecommendationV3` union cannot enforce at
 * runtime: that `payload` matches `category`. A non-object or mismatched
 * payload yields issues instead of throwing. Every other field is trusted to
 * match its declared type; structural validation of untrusted ingress is the
 * job of the JSON Schemas, not of this validator.
 *
 * The fingerprint hash itself stays owned by `recommendationFingerprint()` in
 * `packages/core/recommendation-engine`: contracts must not import core, and
 * re-deriving the hash here would fork it into two definitions. This validator
 * therefore checks the fingerprint's shape, not its value.
 */
export function recommendationV3InvariantIssues(recommendation: RecommendationV3, prefix = "recommendation"): string[] {
  const issues = [
    ...sortedUniqueIssues(`${prefix}.evidenceBindingIds`, recommendation.evidenceBindingIds),
    ...digestIssues(`${prefix}.fingerprint`, recommendation.fingerprint)
  ];
  if (recommendation.schemaVersion !== RECOMMENDATION_V3_SCHEMA_VERSION) issues.push(`${prefix}.schemaVersion is invalid`);
  if (!(RECOMMENDATION_CATEGORIES as readonly string[]).includes(recommendation.category)) {
    issues.push(`${prefix}.category is unsupported: ${recommendation.category}`);
    return issues;
  }
  if (recommendation.subjectSelectorId.trim() === "") issues.push(`${prefix}.subjectSelectorId must not be empty`);
  if (recommendation.authoredBy.id.trim() === "") issues.push(`${prefix}.authoredBy.id must not be empty`);
  const shapeIssues = recommendationPayloadShapeIssues(recommendation.category, recommendation.payload, prefix);
  issues.push(...shapeIssues);
  if (recommendation.category === "practice" && !recommendation.practiceId) {
    issues.push(`${prefix}.practiceId is required for practice recommendations`);
  }
  if (recommendation.category === "structural_observation") {
    if (recommendation.authoredBy.source !== "daemon") {
      issues.push(`${prefix}.structural_observation must be authored by the daemon`);
    }
    if (recommendation.authoredBy.kind !== "daemon") {
      issues.push(`${prefix}.structural_observation must be authored by the daemon actor kind`);
    }
    if (recommendation.enforcement !== "advisory") {
      issues.push(`${prefix}.structural_observation enforcement must be advisory`);
    }
    if (shapeIssues.length === 0) {
      // The payload is self-contained: the observation's metrics, signals and evidence travel with
      // it, so the same evidence rules bind a recorded record and a fresh assessment.
      const payload = recommendation.payload as StructuralObservationPayloadV1;
      issues.push(
        ...sortedUniqueIssues(`${prefix}.payload.signalIds`, payload.signalIds),
        ...refactorObservationEvidenceIssues(
          {
            kind: payload.kind,
            subjectSelectorId: recommendation.subject,
            affectedNodeIds: payload.affectedNodeIds,
            signalIds: payload.signalIds,
            metrics: payload.metrics,
            evidence: payload.evidence
          },
          `${prefix}.payload`
        )
      );
    }
  }
  if (recommendation.category === "refactor_proposal") {
    if (!isRefactorProposalAuthorSource(recommendation.authoredBy.source)) {
      issues.push(`${prefix}.refactor_proposal must not be authored by ${recommendation.authoredBy.source}`);
    }
    issues.push(...refactorProposalAuthorIssues(recommendation.authoredBy, prefix));
    if (shapeIssues.length === 0) {
      const payload = recommendation.payload as RefactorProposalPayloadV1;
      const expected = payload.scale === "architecture" ? "complete" : "checkpoint";
      if (recommendation.enforcement !== expected) {
        issues.push(`${prefix}.refactor_proposal with scale ${payload.scale} requires ${expected} enforcement`);
      }
      issues.push(
        ...digestIssues(`${prefix}.payload.proposalDigest`, payload.proposalDigest),
        ...sortedUniqueIssues(`${prefix}.payload.affectedNodeIds`, payload.affectedNodeIds),
        ...sortedUniqueIssues(`${prefix}.payload.majorChangeReasons`, payload.majorChangeReasons)
      );
    }
  }
  return issues;
}

export function refactorScanInvariantIssues(input: {
  snapshot: ModuleStatisticsSnapshotV1;
  assessment: RefactorAssessmentV1;
  proposal?: RefactorProposalV1;
}): string[] {
  const issues = [
    ...moduleStatisticsSnapshotInvariantIssues(input.snapshot),
    ...refactorAssessmentInvariantIssues(input.assessment),
    ...(input.proposal ? refactorProposalInvariantIssues(input.proposal) : [])
  ];
  if (input.assessment.statisticsSnapshotDigest !== input.snapshot.snapshotDigest) {
    issues.push("assessment.statisticsSnapshotDigest must reference the measured snapshot");
  }
  if (input.snapshot.scope !== undefined && digestJson(input.snapshot.scope) !== digestJson(input.assessment.requestedScope)) {
    issues.push("assessment.requestedScope must match the measured snapshot scope");
  }
  if (input.assessment.modelDigest !== input.snapshot.modelDigest) {
    issues.push("assessment.modelDigest must match the snapshot modelDigest");
  }
  const proposalDigest = input.proposal ? input.proposal.proposalDigest : null;
  if (input.assessment.proposalDigest !== proposalDigest) {
    issues.push("assessment.proposalDigest must reference the submitted proposal");
  }
  const unresolved = input.proposal?.targetDelta?.unresolvedTargets ?? [];
  if (unresolved.length > 0 && input.assessment.scale !== "insufficient_evidence") {
    issues.push("assessment.scale must be insufficient_evidence while targetDelta.unresolvedTargets is non-empty");
  }
  if (unresolved.length > 0 && !input.assessment.scaleReasonCodes.includes("target-unresolved")) {
    issues.push("assessment.scaleReasonCodes must include target-unresolved while targets stay unresolved");
  }
  return issues;
}

export function refactorVerifyInvariantIssues(
  afterSnapshot: ModuleStatisticsSnapshotV1,
  evidence: RefactorResolutionEvidenceV1
): string[] {
  const issues = [
    ...moduleStatisticsSnapshotInvariantIssues(afterSnapshot, "afterSnapshot"),
    ...refactorResolutionEvidenceInvariantIssues(evidence)
  ];
  if (evidence.afterSnapshotDigest !== afterSnapshot.snapshotDigest) {
    issues.push("resolutionEvidence.afterSnapshotDigest must reference the re-measured snapshot");
  }
  if (evidence.verifiedHeadSha !== afterSnapshot.worktree.headSha) {
    issues.push("resolutionEvidence.verifiedHeadSha must match the re-measured worktree HEAD");
  }
  if (evidence.verifiedWorktreeDigest !== afterSnapshot.worktree.worktreeDigest) {
    issues.push("resolutionEvidence.verifiedWorktreeDigest must match the re-measured worktree digest");
  }
  if (afterSnapshot.codeFacts.coverage !== "complete" && evidence.disposition === "resolved") {
    issues.push("resolutionEvidence.disposition must not be resolved while after-snapshot coverage is incomplete");
  }
  const indexCoversWorktree =
    afterSnapshot.codeFacts.indexedWorktreeDigest !== null
    && afterSnapshot.codeFacts.indexedWorktreeDigest === afterSnapshot.worktree.worktreeDigest;
  if (!indexCoversWorktree && evidence.disposition === "resolved") {
    issues.push("resolutionEvidence.disposition must not be resolved while the after-snapshot index does not cover the verified worktree");
  }
  return issues;
}
