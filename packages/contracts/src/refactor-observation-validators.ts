import { ARCHITECTURE_MAJOR_CHANGE_REASON_CODES } from "./projection-constants";
import {
  REFACTOR_ASSESSMENT_SCHEMA_VERSION,
  REFACTOR_EVIDENCE_ID_LIST_LIMIT,
  REFACTOR_OBSERVATION_EVIDENCE_LIMIT
} from "./refactor-constants";
import type {
  RefactorAssessmentV1,
  RefactorEvidenceDirectionViolationV1,
  RefactorEvidenceImportEdgeV1,
  RefactorEvidencePairDirectionV1,
  RefactorEvidenceUnresolvedImportV1,
  RefactorObservationEvidenceV1,
  RefactorObservationV1
} from "./refactor-evidence-types";
import { refactorAssessmentDigest } from "./refactor-snapshot-validators";
import {
  compareLine,
  compareText,
  digestIssues,
  lineIssues,
  ratioIssues,
  repoPathIssues,
  sortedUniqueIssues,
  specifierIssues
} from "./refactor-validation-helpers";

/**
 * How a pair's evidence sample of `limit` entries is split: the thin direction first, but one slot
 * is kept for the thick direction whenever there are two or more slots, so both directions are
 * always shown. Taking the thin direction first is what keeps a single thin edge visible beside
 * any number of thick ones. Resampling a sample with a smaller limit gives exactly this split of
 * the population, so the planner's evidence cut stays on the same rule.
 */
export function refactorPairSampleAllocation(thinTotal: number, thickTotal: number, limit: number): { thin: number; thick: number } {
  const slots = Math.max(0, Math.min(limit, thinTotal + thickTotal));
  const reserve = thickTotal > 0 && slots >= 2 ? 1 : 0;
  const thin = Math.min(thinTotal, slots - reserve);
  return { thin, thick: Math.min(thickTotal, slots - thin) };
}

/**
 * Cuts a pair's evidence to `limit` entries under `refactorPairSampleAllocation`. `evidence.edges`
 * may be the whole population or an earlier sample of it: each direction keeps its first entries in
 * canonical order, and the result is re-sorted canonically.
 */
export function sampleRefactorPairEvidence(
  evidence: Extract<RefactorObservationEvidenceV1, { kind: "cycle" }>,
  limit: number
): Extract<RefactorObservationEvidenceV1, { kind: "cycle" }> {
  const [thin, thick] = evidence.directions as [RefactorEvidencePairDirectionV1, RefactorEvidencePairDirectionV1];
  const allocation = refactorPairSampleAllocation(thin.totalCount, thick.totalCount, Math.min(limit, REFACTOR_OBSERVATION_EVIDENCE_LIMIT));
  const sorted = [...evidence.edges].sort(compareRefactorEvidenceImportEdges);
  const inDirection = (direction: RefactorEvidencePairDirectionV1) => sorted.filter((edge) =>
    edge.fromNodeId === direction.fromNodeId && edge.toNodeId === direction.toNodeId);
  const thinEdges = inDirection(thin).slice(0, allocation.thin);
  const thickEdges = inDirection(thick).slice(0, allocation.thick);
  const edges = [...thinEdges, ...thickEdges].sort(compareRefactorEvidenceImportEdges);
  return {
    ...evidence,
    directions: [
      { ...thin, sampledCount: thinEdges.length },
      { ...thick, sampledCount: thickEdges.length }
    ],
    edges,
    truncated: evidence.totalCount > edges.length
  };
}

export function refactorAssessmentInvariantIssues(assessment: RefactorAssessmentV1, prefix = "assessment"): string[] {
  const issues = [
    ...digestIssues(`${prefix}.assessmentDigest`, assessment.assessmentDigest),
    ...digestIssues(`${prefix}.statisticsSnapshotDigest`, assessment.statisticsSnapshotDigest),
    ...digestIssues(`${prefix}.modelDigest`, assessment.modelDigest),
    ...digestIssues(`${prefix}.codeFactsDigest`, assessment.codeFactsDigest),
    ...sortedUniqueIssues(`${prefix}.affectedNodeIds`, assessment.affectedNodeIds),
    ...sortedUniqueIssues(`${prefix}.scaleReasonCodes`, assessment.scaleReasonCodes),
    ...sortedUniqueIssues(`${prefix}.majorChangeReasons`, assessment.majorChangeReasons)
  ];
  if (assessment.schemaVersion !== REFACTOR_ASSESSMENT_SCHEMA_VERSION) issues.push(`${prefix}.schemaVersion is invalid`);
  if (assessment.proposalDigest !== null) issues.push(...digestIssues(`${prefix}.proposalDigest`, assessment.proposalDigest));
  if ((assessment.scale === null) !== (assessment.proposalDigest === null)) {
    issues.push(`${prefix}.scale must be null exactly when proposalDigest is null`);
  }
  if (assessment.scale === "architecture" && assessment.majorChangeReasons.length === 0) {
    issues.push(`${prefix}.architecture scale requires at least one majorChangeReason`);
  }
  const allowedReasons = new Set<string>(ARCHITECTURE_MAJOR_CHANGE_REASON_CODES);
  for (const reason of assessment.majorChangeReasons) {
    if (!allowedReasons.has(reason)) issues.push(`${prefix}.majorChangeReasons contains unsupported reason: ${reason}`);
  }
  for (const [index, observation] of assessment.observations.entries()) {
    if (observation.subjectSelectorId.trim() === "") issues.push(`${prefix}.observations[${index}].subjectSelectorId must not be empty`);
    issues.push(...sortedUniqueIssues(`${prefix}.observations[${index}].signalIds`, observation.signalIds));
    issues.push(...(Array.isArray(observation.affectedNodeIds)
      ? sortedUniqueIssues(`${prefix}.observations[${index}].affectedNodeIds`, observation.affectedNodeIds)
      : [`${prefix}.observations[${index}].affectedNodeIds must be an array`]));
    issues.push(...refactorObservationEvidenceIssues(observation, `${prefix}.observations[${index}]`));
  }
  issues.push(...ratioIssues(`${prefix}.confidence.callerCoverage`, assessment.confidence.callerCoverage));
  if (!Number.isInteger(assessment.pressure.score) || assessment.pressure.score < 0 || assessment.pressure.score > 100) {
    issues.push(`${prefix}.pressure.score must be an integer between 0 and 100`);
  }
  issues.push(...sortedUniqueIssues(`${prefix}.pressure.signalIds`, assessment.pressure.signalIds));
  if (refactorAssessmentDigest(assessment) !== assessment.assessmentDigest) {
    issues.push(`${prefix}.assessmentDigest must bind the assessed payload`);
  }
  return issues;
}

/** The one ordering for evidence edges: path, line, target, specifier, then owners. */
export function compareRefactorEvidenceImportEdges(left: RefactorEvidenceImportEdgeV1, right: RefactorEvidenceImportEdgeV1): number {
  return compareText(left.fromPath, right.fromPath)
    || compareLine(left.fromLine, right.fromLine)
    || compareText(left.toPath, right.toPath)
    || compareText(left.specifier, right.specifier)
    || compareText(left.fromNodeId, right.fromNodeId)
    || compareText(left.toNodeId, right.toNodeId);
}

export function compareRefactorEvidenceDirectionViolations(
  left: RefactorEvidenceDirectionViolationV1,
  right: RefactorEvidenceDirectionViolationV1
): number {
  return compareText(left.constraintId, right.constraintId) || compareRefactorEvidenceImportEdges(left, right);
}

export function compareRefactorEvidenceUnresolvedImports(
  left: RefactorEvidenceUnresolvedImportV1,
  right: RefactorEvidenceUnresolvedImportV1
): number {
  return compareText(left.fromPath, right.fromPath)
    || compareLine(left.fromLine, right.fromLine)
    || compareText(left.specifier, right.specifier);
}

/**
 * Validates one observation's evidence against the observation it explains: matching kind, the
 * fixed sample and id-list bounds, an honest `truncated` flag and id-list counts, the canonical
 * order, repo-relative paths, positive lines and one-line bounded specifiers. Where a metric counts exactly the evidence population,
 * `totalCount` must equal it, so the sample can never describe a different measurement.
 */
export function refactorObservationEvidenceIssues(observation: RefactorObservationV1, prefix = "observation"): string[] {
  const evidence = observation.evidence as RefactorObservationEvidenceV1 | undefined;
  const label = `${prefix}.evidence`;
  if (!evidence || typeof evidence !== "object") return [`${label} is required`];
  if (evidence.kind !== observation.kind) return [`${label}.kind must equal the observation kind ${observation.kind}`];
  const issues: string[] = [];
  const sample = (entries: readonly unknown[], field: string): void => {
    if (entries.length > REFACTOR_OBSERVATION_EVIDENCE_LIMIT) {
      issues.push(`${label}.${field} must hold at most ${REFACTOR_OBSERVATION_EVIDENCE_LIMIT} entries`);
    }
    if (!Number.isInteger(evidence.totalCount) || evidence.totalCount < entries.length) {
      issues.push(`${label}.totalCount must be an integer no smaller than the ${field} length`);
    }
    if (evidence.truncated !== evidence.totalCount > entries.length) {
      issues.push(`${label}.truncated must be true exactly when totalCount exceeds the ${field} length`);
    }
  };
  const ordered = <T>(entries: readonly T[], field: string, compare: (left: T, right: T) => number): void => {
    for (let index = 1; index < entries.length; index += 1) {
      if (compare(entries[index - 1]!, entries[index]!) >= 0) {
        issues.push(`${label}.${field} must be sorted and unique`);
        return;
      }
    }
  };
  const edgeIssues = (edge: RefactorEvidenceImportEdgeV1, field: string): void => {
    issues.push(...repoPathIssues(`${label}.${field}.fromPath`, edge.fromPath), ...repoPathIssues(`${label}.${field}.toPath`, edge.toPath));
    issues.push(...lineIssues(`${label}.${field}.fromLine`, edge.fromLine), ...specifierIssues(`${label}.${field}.specifier`, edge.specifier));
    if (edge.fromNodeId.trim() === "" || edge.toNodeId.trim() === "") issues.push(`${label}.${field} node ids must not be empty`);
  };
  // An id list is the sorted prefix of a population of `count`: exactly min(count, limit) long.
  const idList = (ids: readonly string[], count: unknown, field: string, countField: string): void => {
    issues.push(...sortedUniqueIssues(`${label}.${field}`, ids));
    if (!Number.isInteger(count) || (count as number) < 0) {
      issues.push(`${label}.${countField} must be a non-negative integer`);
    } else if (ids.length !== Math.min(count as number, REFACTOR_EVIDENCE_ID_LIST_LIMIT)) {
      issues.push(`${label}.${field} must hold min(${countField}, ${REFACTOR_EVIDENCE_ID_LIST_LIMIT}) entries`);
    }
  };
  switch (evidence.kind) {
    case "cycle": {
      sample(evidence.edges, "edges");
      ordered(evidence.edges, "edges", compareRefactorEvidenceImportEdges);
      issues.push(...pairEvidenceIssues(observation, evidence, label));
      for (const edge of evidence.edges) edgeIssues(edge, "edges");
      break;
    }
    case "residual-cycle": {
      sample(evidence.edges, "edges");
      ordered(evidence.edges, "edges", compareRefactorEvidenceImportEdges);
      idList(evidence.memberNodeIds, observation.metrics.memberCount, "memberNodeIds", "metrics.memberCount");
      // Membership is checkable only against the complete member list.
      const complete = evidence.memberNodeIds.length === observation.metrics.memberCount;
      for (const edge of evidence.edges) {
        edgeIssues(edge, "edges");
        if (complete && (!evidence.memberNodeIds.includes(edge.fromNodeId) || !evidence.memberNodeIds.includes(edge.toNodeId))) {
          issues.push(`${label}.edges must stay inside the component's member nodes`);
        }
      }
      break;
    }
    case "direction-violation":
      sample(evidence.violations, "violations");
      ordered(evidence.violations, "violations", compareRefactorEvidenceDirectionViolations);
      idList(evidence.constraintIds, evidence.constraintCount, "constraintIds", "constraintCount");
      for (const violation of evidence.violations) {
        edgeIssues(violation, "violations");
        if (!evidence.constraintIds.includes(violation.constraintId)) issues.push(`${label}.violations must name a listed constraintId`);
      }
      if (evidence.totalCount !== observation.metrics.directionViolationCount) {
        issues.push(`${label}.totalCount must equal metrics.directionViolationCount`);
      }
      break;
    case "ownership-ambiguous":
    case "undeclared-footprint":
    case "unowned-paths":
      sample(evidence.paths, "paths");
      ordered(evidence.paths, "paths", (left, right) => compareText(left.path, right.path));
      for (const entry of evidence.paths) {
        issues.push(...repoPathIssues(`${label}.paths.path`, entry.path));
        idList(entry.candidateOwnerNodeIds, entry.candidateOwnerCount, "paths.candidateOwnerNodeIds", "paths.candidateOwnerCount");
      }
      if (evidence.kind === "unowned-paths" && evidence.totalCount !== observation.metrics.unownedFileCount) {
        issues.push(`${label}.totalCount must equal metrics.unownedFileCount`);
      }
      break;
    case "evidence-gap":
      sample(evidence.unresolvedImports, "unresolvedImports");
      ordered(evidence.unresolvedImports, "unresolvedImports", compareRefactorEvidenceUnresolvedImports);
      issues.push(...sortedUniqueIssues(`${label}.reasonCodes`, evidence.reasonCodes));
      for (const entry of evidence.unresolvedImports) {
        issues.push(...repoPathIssues(`${label}.unresolvedImports.fromPath`, entry.fromPath));
        issues.push(...lineIssues(`${label}.unresolvedImports.fromLine`, entry.fromLine));
        issues.push(...specifierIssues(`${label}.unresolvedImports.specifier`, entry.specifier));
      }
      if (evidence.totalCount !== observation.metrics.unresolvedImportCount) {
        issues.push(`${label}.totalCount must equal metrics.unresolvedImportCount`);
      }
      break;
    case "low-cohesion-god-file":
      sample(evidence.files, "files");
      ordered(evidence.files, "files", (left, right) => compareText(left.path, right.path));
      for (const entry of evidence.files) {
        issues.push(...repoPathIssues(`${label}.files.path`, entry.path));
        if (!Number.isInteger(entry.lineCount) || entry.lineCount < 0) issues.push(`${label}.files.lineCount must be a non-negative integer`);
        if (!Number.isInteger(entry.topLevelSymbolCount) || entry.topLevelSymbolCount < 0) issues.push(`${label}.files.topLevelSymbolCount must be a non-negative integer`);
        if (!Number.isInteger(entry.clusterCount) || entry.clusterCount < 0) issues.push(`${label}.files.clusterCount must be a non-negative integer`);
        for (const cluster of entry.clusters) {
          issues.push(...sortedUniqueIssues(`${label}.files.clusters.symbols`, cluster.symbols));
          if (!Number.isInteger(cluster.startLine) || cluster.startLine < 1 || !Number.isInteger(cluster.endLine) || cluster.endLine < cluster.startLine) {
            issues.push(`${label}.files.clusters line range is invalid`);
          }
          if (!Number.isInteger(cluster.intraClusterEdges) || cluster.intraClusterEdges < 0 || !Number.isInteger(cluster.crossClusterEdges) || cluster.crossClusterEdges < 0) {
            issues.push(`${label}.files.clusters edge counts must be non-negative integers`);
          }
        }
      }
      break;
    case "entrypoint-bypass":
      issues.push(...sortedUniqueIssues(`${label}.declaredEntrypointPaths`, evidence.declaredEntrypointPaths));
      for (const path of evidence.declaredEntrypointPaths) issues.push(...repoPathIssues(`${label}.declaredEntrypointPaths`, path));
      sample(evidence.edges, "edges");
      ordered(evidence.edges, "edges", compareRefactorEvidenceImportEdges);
      for (const edge of evidence.edges) edgeIssues(edge, "edges");
      break;
    case "unstable-dependency":
      if (!Number.isInteger(evidence.sourceFanIn) || evidence.sourceFanIn < 0) issues.push(`${label}.sourceFanIn must be a non-negative integer`);
      issues.push(...ratioIssues(`${label}.sourceInstability`, evidence.sourceInstability));
      sample(evidence.targets, "targets");
      ordered(evidence.targets, "targets", (left, right) => compareText(left.targetNodeId, right.targetNodeId));
      for (const target of evidence.targets) {
        if (target.targetNodeId.trim() === "") issues.push(`${label}.targets.targetNodeId must not be empty`);
        issues.push(...ratioIssues(`${label}.targets.targetInstability`, target.targetInstability));
        if (!Number.isFinite(target.delta) || target.delta < -1 || target.delta > 1) issues.push(`${label}.targets.delta must be between -1 and 1`);
        if (!Number.isInteger(target.edgeCount) || target.edgeCount < 1) issues.push(`${label}.targets.edgeCount must be a positive integer`);
      }
      break;
    case "co-change-coupling":
      idList(evidence.memberNodeIds, evidence.memberNodeIds.length, "memberNodeIds", "memberNodeCount");
      if (!["complete", "shallow", "insufficient-history", "unavailable"].includes(evidence.coverageStatus)) {
        issues.push(`${label}.coverageStatus is invalid`);
      }
      if (!Number.isInteger(evidence.windowLimit) || evidence.windowLimit < 1) issues.push(`${label}.windowLimit must be a positive integer`);
      if (!Number.isInteger(evidence.observedCommitCount) || evidence.observedCommitCount < 0) issues.push(`${label}.observedCommitCount must be a non-negative integer`);
      sample(evidence.pairs, "pairs");
      ordered(evidence.pairs, "pairs", (left, right) => compareText(left.pathA, right.pathA) || compareText(left.pathB, right.pathB));
      for (const pair of evidence.pairs) {
        issues.push(...repoPathIssues(`${label}.pairs.pathA`, pair.pathA), ...repoPathIssues(`${label}.pairs.pathB`, pair.pathB));
        if (!Number.isInteger(pair.coChangeCount) || pair.coChangeCount < 1) issues.push(`${label}.pairs.coChangeCount must be a positive integer`);
        issues.push(...ratioIssues(`${label}.pairs.jaccard`, pair.jaccard));
      }
      break;
    default:
      issues.push(`${label}.kind is unsupported`);
  }
  return [...new Set(issues)];
}

/**
 * A pair's evidence explains exactly that pair: its two ends are the observation's affected nodes,
 * every edge runs between them in one of the two listed directions, the thin direction (by the
 * observation's own distinct-file-edge counts, ties to the forward direction) comes first, each
 * direction's `sampledCount` is the number of its edges in the sample, and the split is the one
 * `refactorPairSampleAllocation` prescribes for the sample size.
 */
function pairEvidenceIssues(
  observation: RefactorObservationV1,
  evidence: Extract<RefactorObservationEvidenceV1, { kind: "cycle" }>,
  label: string
): string[] {
  const issues: string[] = [];
  const members = evidence.memberNodeIds;
  if (!Array.isArray(members) || members.length !== 2 || !(members[0]! < members[1]!)) {
    return [`${label}.memberNodeIds must be the two pair ends, sorted`];
  }
  const [first, second] = members as [string, string];
  if (Array.isArray(observation.affectedNodeIds) && (observation.affectedNodeIds.length !== 2
    || observation.affectedNodeIds[0] !== first || observation.affectedNodeIds[1] !== second)) {
    issues.push(`${label}.memberNodeIds must equal the observation affectedNodeIds`);
  }
  const forward = observation.metrics.forwardEdgeCount;
  const backward = observation.metrics.backwardEdgeCount;
  if (!Number.isInteger(forward) || !Number.isInteger(backward) || (forward as number) < 1 || (backward as number) < 1) {
    issues.push(`${label} requires positive integer metrics.forwardEdgeCount and metrics.backwardEdgeCount`);
    return issues;
  }
  if (observation.metrics.thinDirectionEdgeCount !== Math.min(forward as number, backward as number)) {
    issues.push(`${label} requires metrics.thinDirectionEdgeCount = min(forwardEdgeCount, backwardEdgeCount)`);
  }
  if (observation.metrics.totalEdgeCount !== (forward as number) + (backward as number)) {
    issues.push(`${label} requires metrics.totalEdgeCount = forwardEdgeCount + backwardEdgeCount`);
  }
  const directions = evidence.directions;
  if (!Array.isArray(directions) || directions.length !== 2) return [...issues, `${label}.directions must list the thin then the thick direction`];
  const [thin, thick] = directions as [RefactorEvidencePairDirectionV1, RefactorEvidencePairDirectionV1];
  const forwardIsThin = (forward as number) <= (backward as number);
  const expectedThin = forwardIsThin ? [first, second] : [second, first];
  if (thin.fromNodeId !== expectedThin[0] || thin.toNodeId !== expectedThin[1]
    || thick.fromNodeId !== expectedThin[1] || thick.toNodeId !== expectedThin[0]) {
    issues.push(`${label}.directions must be [thin, thick] by the pair's distinct file edge counts`);
  }
  for (const direction of directions) {
    if (!Number.isInteger(direction.totalCount) || direction.totalCount < 1) issues.push(`${label}.directions totalCount must be a positive integer`);
    const sampled = evidence.edges.filter((edge) => edge.fromNodeId === direction.fromNodeId && edge.toNodeId === direction.toNodeId).length;
    if (direction.sampledCount !== sampled) issues.push(`${label}.directions sampledCount must count the sampled edges of that direction`);
    if (sampled > direction.totalCount) issues.push(`${label}.directions sample must not exceed the direction population`);
  }
  if (thin.totalCount + thick.totalCount !== evidence.totalCount) issues.push(`${label}.totalCount must be the sum of both directions`);
  if (evidence.edges.some((edge) => !((edge.fromNodeId === first && edge.toNodeId === second) || (edge.fromNodeId === second && edge.toNodeId === first)))) {
    issues.push(`${label}.edges must run between the pair's two ends`);
  }
  const allocation = refactorPairSampleAllocation(thin.totalCount, thick.totalCount, evidence.edges.length);
  if (thin.sampledCount !== allocation.thin || thick.sampledCount !== allocation.thick) {
    issues.push(`${label}.edges must sample the thin direction first and keep one slot for the thick direction`);
  }
  return issues;
}
