import type { RecommendationV3 } from "./ledger";
import {
  MODULE_STATISTICS_SCHEMA_VERSION,
  REFACTOR_EXECUTION_EVIDENCE_KINDS,
  REFACTOR_EXECUTION_EVIDENCE_LOCATOR_PATTERN,
  REFACTOR_EXECUTION_EVIDENCE_LOCATOR_RULE,
  REFACTOR_PROPOSAL_SCHEMA_VERSION,
  REFACTOR_REQUEST_SCHEMA_VERSION,
  REFACTOR_VERIFICATION_REQUEST_KEYS,
  REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION
} from "./refactor-constants";
import type {
  RecommendationV3FingerprintInputV1,
  RefactorAssessmentV1,
  RefactorResolutionEvidenceV1
} from "./refactor-evidence-types";
import type {
  ArchitectureTargetDeltaV1,
  ModuleDependencyV1,
  ModuleStatisticsSnapshotV1,
  ModuleStatisticsV1,
  RefactorProposalV1,
  RefactorRequestV1,
  RefactorVerificationRequestV1
} from "./refactor-types";
import {
  authoredTargetDelta,
  BARE_SHA256_PATTERN,
  compareText,
  DIGEST_PREFIX_LENGTH,
  digestIssues,
  fingerprintPayloadSubset,
  GIT_HEAD_SHA_PATTERN,
  nonNegativeIntegerIssues,
  outcomeIssues,
  ratioIssues,
  refactorProposalAuthorIssues,
  sortedUniqueIssues
} from "./refactor-validation-helpers";
import { digestJson, isRepoRelativePosixPath, type Json } from "./schema";

/**
 * Digest exclusion rule for every helper below: drop the record's own digest
 * field, its top-level `extensions`, and its timestamps. Nested `extensions`
 * (for example `modules[i].extensions`) stay inside the hashed content, so a
 * nested annotation changes the digest. The single exception is the derived
 * `targetDelta` identity below: ArchContext fills `unresolvedTargets` after the
 * agent authored the proposal, so `refactorProposalDigest` hashes the delta
 * under the same exclusions as `architectureTargetDeltaInterventionId`
 * (`interventionId`, `unresolvedTargets`, `extensions`) and the agent-authored
 * identity survives assessment. `authoredBy` stays hashed at the top level:
 * the no-self-authored gate must be digest-bound.
 */
export function refactorProposalDigest(proposal: RefactorProposalV1): string {
  const { proposalDigest: _proposalDigest, extensions: _extensions, ...hashable } = proposal;
  return digestJson({
    ...hashable,
    ...(hashable.targetDelta ? { targetDelta: authoredTargetDelta(hashable.targetDelta) } : {})
  } as unknown as Json);
}

export function architectureTargetDeltaInterventionId(delta: ArchitectureTargetDeltaV1): string {
  const digest = digestJson(authoredTargetDelta(delta) as unknown as Json);
  return `intervention.${digest.slice(DIGEST_PREFIX_LENGTH, DIGEST_PREFIX_LENGTH + 16)}`;
}

export function moduleStatisticsDigest(module: ModuleStatisticsV1): string {
  const { moduleDigest: _moduleDigest, extensions: _extensions, ...hashable } = module;
  return digestJson(hashable as unknown as Json);
}

export function moduleStatisticsSnapshotDigest(snapshot: ModuleStatisticsSnapshotV1): string {
  const { snapshotDigest: _snapshotDigest, createdAt: _createdAt, extensions: _extensions, ...hashable } = snapshot;
  return digestJson(hashable as unknown as Json);
}

/** Repository measurements have no scope digest. Scoped measurements can compare only to the same scope. */
export function refactorSnapshotScopeDigest(scope: ModuleStatisticsSnapshotV1["scope"]): string | undefined {
  return scope === undefined ? undefined : digestJson(scope);
}

export function refactorAssessmentDigest(assessment: RefactorAssessmentV1): string {
  const {
    assessmentDigest: _assessmentDigest,
    requestId: _requestId,
    createdAt: _createdAt,
    extensions: _extensions,
    ...hashable
  } = assessment;
  return digestJson(hashable as unknown as Json);
}

export function refactorResolutionEvidenceDigest(evidence: RefactorResolutionEvidenceV1): string {
  const {
    resolutionDigest: _resolutionDigest,
    verifiedAt: _verifiedAt,
    extensions: _extensions,
    ...hashable
  } = evidence;
  return digestJson(hashable as unknown as Json);
}

/**
 * Canonical fingerprint input for a v3 recommendation. It deliberately drops
 * `assessmentDigest` and `baselineSnapshotDigest` so that re-detecting the same
 * structural fact at a new HEAD dedups against the previous recommendation and
 * drives `relations.regressesFrom` instead of creating an unrelated record.
 */
export function recommendationV3FingerprintInput(
  recommendation: Pick<RecommendationV3, "category" | "subjectSelectorId" | "practiceId" | "payload">
): RecommendationV3FingerprintInputV1 {
  return {
    category: recommendation.category,
    subjectSelectorId: recommendation.subjectSelectorId,
    practiceId: recommendation.practiceId ?? null,
    payload: fingerprintPayloadSubset(recommendation.category, recommendation.payload)
  };
}

export function refactorProposalInvariantIssues(proposal: RefactorProposalV1, prefix = "proposal"): string[] {
  const issues = [
    ...sortedUniqueIssues(`${prefix}.scopePaths`, proposal.scopePaths),
    ...digestIssues(`${prefix}.proposalDigest`, proposal.proposalDigest),
    ...outcomeIssues(`${prefix}.targetOutcomes`, proposal.targetOutcomes)
  ];
  if (proposal.schemaVersion !== REFACTOR_PROPOSAL_SCHEMA_VERSION) issues.push(`${prefix}.schemaVersion is invalid`);
  if (proposal.intent.trim() === "") issues.push(`${prefix}.intent must not be empty`);
  if (proposal.scopePaths.length === 0) issues.push(`${prefix}.scopePaths must contain at least one path`);
  for (const path of proposal.scopePaths) {
    if (!isRepoRelativePosixPath(path)) issues.push(`${prefix}.scopePaths must be repo-relative POSIX paths: ${path}`);
  }
  issues.push(...refactorProposalAuthorIssues(proposal.authoredBy, prefix));
  issues.push(...sortedUniqueIssues(`${prefix}.killList.selectorId`, proposal.killList.map((entry) => entry.selectorId)));
  if (refactorProposalDigest(proposal) !== proposal.proposalDigest) {
    issues.push(`${prefix}.proposalDigest must bind the authored proposal payload`);
  }
  if (proposal.targetDelta) issues.push(...architectureTargetDeltaInvariantIssues(proposal.targetDelta, `${prefix}.targetDelta`));
  return issues;
}

export function architectureTargetDeltaInvariantIssues(delta: ArchitectureTargetDeltaV1, prefix = "targetDelta"): string[] {
  const issues = [
    ...sortedUniqueIssues(`${prefix}.unresolvedTargets`, delta.unresolvedTargets),
    ...outcomeIssues(`${prefix}.completionCriteria`, delta.completionCriteria)
  ];
  if (delta.thesis.trim() === "") issues.push(`${prefix}.thesis must not be empty`);
  if (delta.trigger.length === 0) issues.push(`${prefix}.trigger must state at least one trigger`);
  if (delta.falsifiers.length === 0) issues.push(`${prefix}.falsifiers must state at least one falsifier`);
  if (delta.completionCriteria.length === 0) issues.push(`${prefix}.completionCriteria must contain at least one outcome`);
  if (delta.benefitLedger.rollbackPoint.trim() === "") issues.push(`${prefix}.benefitLedger.rollbackPoint must not be empty`);
  const temporaryRelations = new Set(delta.migrationState.temporaryRelations);
  for (const relation of delta.targetState.requiredRelations) {
    if (temporaryRelations.has(relation)) {
      issues.push(`${prefix}.targetState.requiredRelations must not contain migration-only relation: ${relation}`);
    }
  }
  if (architectureTargetDeltaInterventionId(delta) !== delta.interventionId) {
    issues.push(`${prefix}.interventionId must be derived from the authored delta`);
  }
  return issues;
}

export function refactorRequestInvariantIssues(request: RefactorRequestV1, prefix = "request"): string[] {
  const issues: string[] = [];
  if (request.schemaVersion !== REFACTOR_REQUEST_SCHEMA_VERSION) issues.push(`${prefix}.schemaVersion is invalid`);
  if (request.scope.kind === "node" && request.scope.nodeId.trim() === "") issues.push(`${prefix}.scope.nodeId must not be empty`);
  if (request.scope.kind === "paths") {
    issues.push(...sortedUniqueIssues(`${prefix}.scope.paths`, request.scope.paths));
    if (request.scope.paths.length === 0) issues.push(`${prefix}.scope.paths must contain at least one path`);
    for (const path of request.scope.paths) {
      if (!isRepoRelativePosixPath(path)) issues.push(`${prefix}.scope.paths must be repo-relative POSIX paths: ${path}`);
    }
  }
  if (request.proposal) issues.push(...refactorProposalInvariantIssues(request.proposal, `${prefix}.proposal`));
  if (request.importNodeLimit !== undefined && !(Number.isInteger(request.importNodeLimit) && request.importNodeLimit >= 1)) {
    issues.push(`${prefix}.importNodeLimit must be a positive integer`);
  }
  return issues;
}

/**
 * Validates a `refactor verify` request before anything measures on its behalf.
 *
 * Top-level keys are closed to `REFACTOR_VERIFICATION_REQUEST_KEYS`. Every ingress rebuilds the
 * request from the declared fields, so a typo (`expectedWorktreeDigset`) would otherwise be
 * dropped in silence and the caller's freshness claim would simply cease to exist — the request
 * would be answered under a weaker precondition than the one it stated.
 *
 * `executionEvidenceRefs` are checked under exactly the rules that bind them into the ledger:
 * three declared keys and nothing else, a kind from the frozen vocabulary, and a bare SHA-256.
 * An extra key would ride a cast into a record whose envelope promises no raw bodies, and the
 * resolution-evidence validator only ever inspects `locator` and `sha256`, so it would never see
 * it. Refusing here is the only place that key is still visible.
 */
export function refactorVerificationRequestInvariantIssues(
  request: RefactorVerificationRequestV1,
  prefix = "request"
): string[] {
  const issues: string[] = [];
  const unknownKeys = Object.keys(request as unknown as Record<string, unknown>)
    .filter((key) => !(REFACTOR_VERIFICATION_REQUEST_KEYS as readonly string[]).includes(key))
    .sort();
  if (unknownKeys.length > 0) issues.push(`${prefix} has unsupported key(s): ${unknownKeys.join(", ")}`);
  if (request.schemaVersion !== REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION) issues.push(`${prefix}.schemaVersion is invalid`);
  if (typeof request.recommendationId !== "string" || request.recommendationId.trim() === "") {
    issues.push(`${prefix}.recommendationId must be a non-empty string`);
  }
  if (request.expectedHeadSha !== undefined && !GIT_HEAD_SHA_PATTERN.test(request.expectedHeadSha)) {
    issues.push(`${prefix}.expectedHeadSha must be a 40-hex Git commit sha`);
  }
  if (request.expectedWorktreeDigest !== undefined) {
    issues.push(...digestIssues(`${prefix}.expectedWorktreeDigest`, request.expectedWorktreeDigest));
  }
  if (request.importNodeLimit !== undefined && !(Number.isInteger(request.importNodeLimit) && request.importNodeLimit >= 1)) {
    issues.push(`${prefix}.importNodeLimit must be a positive integer`);
  }
  if (request.executionEvidenceRefs !== undefined) {
    if (!Array.isArray(request.executionEvidenceRefs)) {
      issues.push(`${prefix}.executionEvidenceRefs must be an array`);
      return issues;
    }
    request.executionEvidenceRefs.forEach((ref, index) => {
      const label = `${prefix}.executionEvidenceRefs[${index}]`;
      if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
        issues.push(`${label} must be an object`);
        return;
      }
      const extras = Object.keys(ref).filter((key) => key !== "kind" && key !== "locator" && key !== "sha256");
      if (extras.length > 0) issues.push(`${label} has unsupported key(s): ${[...extras].sort().join(", ")}`);
      if (!(REFACTOR_EXECUTION_EVIDENCE_KINDS as readonly string[]).includes(ref.kind)) {
        issues.push(`${label}.kind must be one of ${REFACTOR_EXECUTION_EVIDENCE_KINDS.join(", ")}`);
      }
      if (typeof ref.locator !== "string" || ref.locator.trim() === "") {
        issues.push(`${label}.locator must be a non-empty string`);
      } else if (!REFACTOR_EXECUTION_EVIDENCE_LOCATOR_PATTERN.test(ref.locator)) {
        issues.push(`${label}.locator ${REFACTOR_EXECUTION_EVIDENCE_LOCATOR_RULE}`);
      }
      if (typeof ref.sha256 !== "string" || !BARE_SHA256_PATTERN.test(ref.sha256)) {
        issues.push(`${label}.sha256 must be a bare SHA-256 hex digest`);
      }
    });
  }
  return issues;
}

export function moduleStatisticsInvariantIssues(module: ModuleStatisticsV1, prefix = "module"): string[] {
  const issues = [...digestIssues(`${prefix}.moduleDigest`, module.moduleDigest), ...digestIssues(`${prefix}.nodeDigest`, module.nodeDigest)];
  if (module.nodeId.trim() === "") issues.push(`${prefix}.nodeId must not be empty`);
  if (module.footprintDeclared === (module.footprint === null)) {
    issues.push(`${prefix}.footprint must be present exactly when footprintDeclared is true`);
  }
  if (module.footprint) {
    issues.push(
      ...digestIssues(`${prefix}.footprint.sourceFilesDigest`, module.footprint.sourceFilesDigest),
      ...nonNegativeIntegerIssues(`${prefix}.footprint.fileCount`, module.footprint.fileCount),
      ...nonNegativeIntegerIssues(`${prefix}.footprint.lineCount`, module.footprint.lineCount)
    );
  }
  if (module.dependencyGraph) {
    const graph = module.dependencyGraph;
    issues.push(
      ...nonNegativeIntegerIssues(`${prefix}.dependencyGraph.internalEdgeCount`, graph.internalEdgeCount),
      ...nonNegativeIntegerIssues(`${prefix}.dependencyGraph.inboundModuleEdges`, graph.inboundModuleEdges),
      ...nonNegativeIntegerIssues(`${prefix}.dependencyGraph.outboundModuleEdges`, graph.outboundModuleEdges),
      ...nonNegativeIntegerIssues(`${prefix}.dependencyGraph.fanIn`, graph.fanIn),
      ...nonNegativeIntegerIssues(`${prefix}.dependencyGraph.fanOut`, graph.fanOut),
      ...nonNegativeIntegerIssues(`${prefix}.dependencyGraph.cycleCount`, graph.cycleCount),
      ...nonNegativeIntegerIssues(`${prefix}.dependencyGraph.directionViolationCount`, graph.directionViolationCount),
      ...ratioIssues(`${prefix}.dependencyGraph.instability`, graph.instability)
    );
  }
  issues.push(
    ...nonNegativeIntegerIssues(`${prefix}.tests.testFileCount`, module.tests.testFileCount),
    ...nonNegativeIntegerIssues(`${prefix}.tests.observedTestEdges`, module.tests.observedTestEdges),
    ...ratioIssues(`${prefix}.tests.callerCoverage`, module.tests.callerCoverage),
    ...nonNegativeIntegerIssues(`${prefix}.uncertainty.unresolvedImports`, module.uncertainty.unresolvedImports)
  );
  if (moduleStatisticsDigest(module) !== module.moduleDigest) {
    issues.push(`${prefix}.moduleDigest must bind the measured module payload`);
  }
  return issues;
}

export function moduleStatisticsSnapshotInvariantIssues(snapshot: ModuleStatisticsSnapshotV1, prefix = "snapshot"): string[] {
  const issues = [
    ...digestIssues(`${prefix}.snapshotDigest`, snapshot.snapshotDigest),
    ...digestIssues(`${prefix}.modelDigest`, snapshot.modelDigest),
    ...sortedUniqueIssues(`${prefix}.codeFacts.reasonCodes`, snapshot.codeFacts.reasonCodes),
    ...sortedUniqueIssues(`${prefix}.modules.nodeId`, snapshot.modules.map((module) => module.nodeId)),
    ...snapshot.modules.flatMap((module, index) => moduleStatisticsInvariantIssues(module, `${prefix}.modules[${index}]`))
  ];
  if (snapshot.schemaVersion !== MODULE_STATISTICS_SCHEMA_VERSION) issues.push(`${prefix}.schemaVersion is invalid`);
  if (snapshot.codeFacts.coverage === "unknown") {
    if (!snapshot.codeFacts.truncated) issues.push(`${prefix}.codeFacts.truncated must be true when coverage is unknown`);
    for (const [index, module] of snapshot.modules.entries()) {
      if (module.dependencyGraph !== null) {
        issues.push(`${prefix}.modules[${index}].dependencyGraph must be null when codeFacts.coverage is unknown`);
      }
    }
  }
  if (snapshot.codeFacts.coverage !== "unknown") {
    if (snapshot.codeFacts.indexedWorktreeDigest === null) {
      issues.push(`${prefix}.codeFacts.indexedWorktreeDigest must be present when coverage is ${snapshot.codeFacts.coverage}`);
    } else if (snapshot.codeFacts.indexedWorktreeDigest !== snapshot.worktree.worktreeDigest) {
      issues.push(`${prefix}.codeFacts.indexedWorktreeDigest must match the measured worktreeDigest`);
    }
  }
  issues.push(...nonNegativeIntegerIssues(`${prefix}.codeFacts.edgeLimit`, snapshot.codeFacts.edgeLimit));
  const importNodeCount = snapshot.codeFacts.importNodeCount ?? null;
  issues.push(...nonNegativeIntegerIssues(`${prefix}.codeFacts.importNodeCount`, importNodeCount));
  if (snapshot.codeFacts.reasonCodes.includes("code-facts-import-limit")) {
    const { edgeLimit } = snapshot.codeFacts;
    if (snapshot.codeFacts.coverage !== "partial") issues.push(`${prefix}.codeFacts.coverage must be partial when the import limit was reached`);
    if (edgeLimit === null || (importNodeCount !== null && importNodeCount <= edgeLimit)) {
      issues.push(`${prefix}.codeFacts.importNodeCount must exceed edgeLimit when the import limit was reached`);
    }
  }
  for (const [field, value] of Object.entries(snapshot.repositorySummary)) {
    issues.push(...nonNegativeIntegerIssues(`${prefix}.repositorySummary.${field}`, value));
  }
  issues.push(...moduleDependencyIssues(snapshot, prefix));
  if (snapshot.repositorySummary.moduleCount !== snapshot.modules.length) {
    issues.push(`${prefix}.repositorySummary.moduleCount must equal the module count`);
  }
  const undeclared = snapshot.modules.filter((module) => !module.footprintDeclared).length;
  if (snapshot.repositorySummary.undeclaredFootprintNodeCount !== undeclared) {
    issues.push(`${prefix}.repositorySummary.undeclaredFootprintNodeCount must equal the undeclared footprint module count`);
  }
  if (moduleStatisticsSnapshotDigest(snapshot) !== snapshot.snapshotDigest) {
    issues.push(`${prefix}.snapshotDigest must bind the measured snapshot payload`);
  }
  return issues;
}

/**
 * The dependency table binds the graph counts it was measured with: sorted and unique by
 * `(fromNodeId, toNodeId)`, positive counts, no self edge, both ends measured modules, one entry per
 * counted cross-module edge, and nothing at all when the graph was not measured.
 */
function moduleDependencyIssues(snapshot: ModuleStatisticsSnapshotV1, prefix: string): string[] {
  const label = `${prefix}.moduleDependencies`;
  const dependencies = (snapshot as { moduleDependencies?: unknown }).moduleDependencies;
  if (!Array.isArray(dependencies)) return [`${label} must be an array`];
  const issues: string[] = [];
  const modules = new Set(snapshot.modules.map((module) => module.nodeId));
  for (const [index, entry] of (dependencies as ModuleDependencyV1[]).entries()) {
    if (!entry || typeof entry !== "object") {
      issues.push(`${label}[${index}] must be an object`);
      continue;
    }
    if (!modules.has(entry.fromNodeId) || !modules.has(entry.toNodeId)) issues.push(`${label}[${index}] must name measured modules`);
    if (entry.fromNodeId === entry.toNodeId) issues.push(`${label}[${index}] must not be a self dependency`);
    if (!Number.isInteger(entry.distinctFileEdgeCount) || entry.distinctFileEdgeCount < 1) {
      issues.push(`${label}[${index}].distinctFileEdgeCount must be a positive integer`);
    }
    const previous = (dependencies as ModuleDependencyV1[])[index - 1];
    if (previous && (compareText(previous.fromNodeId, entry.fromNodeId) || compareText(previous.toNodeId, entry.toNodeId)) >= 0) {
      issues.push(`${label} must be sorted and unique by (fromNodeId, toNodeId)`);
    }
  }
  if (dependencies.length !== snapshot.repositorySummary.crossModuleEdgeCount) {
    issues.push(`${label} must hold one entry per repositorySummary.crossModuleEdgeCount`);
  }
  if (snapshot.codeFacts.coverage === "unknown" && dependencies.length > 0) {
    issues.push(`${label} must be empty when codeFacts.coverage is unknown`);
  }
  return [...new Set(issues)];
}
