import {
  CONTRACT_SCHEMA_REGISTRY,
  REFACTOR_SCAN_V2_SCHEMA_VERSION,
  FailureError,
  isRepoRelativePosixPath,
  validateJsonSchema,
  type Json,
  type RefactorObservationKind,
  type RefactorObservationV1,
  type RefactorScanFindingV2,
  type RefactorScanV2,
  type RefactorScopeV1,
  type RefactorSimulationRequestV1,
  type RefactorSimulationResultV1,
  type V2RefactorDetectorKind
} from "@archcontext/contracts";
import { ancestorChain, type NativeNode } from "@archcontext/core/architecture-domain";
import { observationSeverityWorsened, simulateRefactorPlan } from "@archcontext/core/refactor-assessment";
import { RECOMMENDATION_SCHEDULER_ENGINE_VERSION } from "@archcontext/core/recommendation-engine";
import { readRefactorDecisionSet, type RefactorDecisionSetV1 } from "./refactor-decisions";
import { refactorClassifierRulesetDigest } from "./refactor-recording";
import { measureRefactorSnapshot, runRefactorScan } from "./refactor-scan";
import { compareText, pureGitScope, runVerifyV2 } from "./refactor-verify-v2";

export { runDecideV2, type RunDecideV2Input, type V2DecideAction } from "./refactor-decide-v2";
export { runVerifyV2 };

export interface RunScanV2Options {
  scope?: RefactorScopeV1;
  importNodeLimit?: number;
}

const DETECTOR_BY_OBSERVATION_KIND: Partial<Record<RefactorObservationKind, {
  detector: V2RefactorDetectorKind;
  severity: "notice" | "warning" | "error" | "critical";
  blocking: boolean;
}>> = {
  "cycle": { detector: "component-cycle", severity: "error", blocking: true },
  "residual-cycle": { detector: "component-cycle", severity: "error", blocking: true },
  "direction-violation": { detector: "purity-violation", severity: "error", blocking: true },
  "entrypoint-bypass": { detector: "entrypoint-bypass", severity: "error", blocking: true },
  "low-cohesion-god-file": { detector: "low-cohesion-god-file", severity: "warning", blocking: true },
  "unstable-dependency": { detector: "unstable-dependency", severity: "warning", blocking: false },
  "co-change-coupling": { detector: "co-change-coupling", severity: "warning", blocking: false }
};

function capabilityForNodes(nodeIds: readonly string[], nodes: readonly NativeNode[]): string | null {
  if (nodeIds.length === 0) return null;
  const parents = new Map(nodes.map((node) => [node.id, node.parent]));
  const kinds = new Map(nodes.map((node) => [node.id, node.kind]));
  for (const id of nodeIds) {
    for (const ancestor of ancestorChain(id, parents)) {
      if (kinds.get(ancestor) === "capability") return ancestor;
    }
  }
  return null;
}

function evidencePaths(observation: RefactorObservationV1): string[] {
  const paths = new Set<string>();
  const ev = observation.evidence;
  switch (ev.kind) {
    case "cycle":
    case "residual-cycle":
    case "entrypoint-bypass":
      for (const edge of ev.edges) {
        paths.add(edge.fromPath);
        paths.add(edge.toPath);
      }
      break;
    case "direction-violation":
      for (const v of ev.violations) {
        paths.add(v.fromPath);
        paths.add(v.toPath);
      }
      break;
    case "low-cohesion-god-file":
      for (const file of ev.files) paths.add(file.path);
      break;
    case "co-change-coupling":
      for (const pair of ev.pairs) {
        paths.add(pair.pathA);
        paths.add(pair.pathB);
      }
      break;
    case "ownership-ambiguous":
    case "undeclared-footprint":
    case "unowned-paths":
      for (const entry of ev.paths) paths.add(entry.path);
      break;
    case "evidence-gap":
      for (const imp of ev.unresolvedImports) paths.add(imp.fromPath);
      break;
  }
  return [...paths].sort(compareText);
}

function findingEvidenceSummary(observation: RefactorObservationV1, summaryText: string): RefactorScanFindingV2["evidence"] {
  const ev = observation.evidence;
  const result: RefactorScanFindingV2["evidence"] = { summary: summaryText.slice(0, 250) };
  if (ev.kind === "cycle") {
    result.thinDirectionEdgeCount = observation.metrics.thinDirectionEdgeCount ?? 0;
  } else if (ev.kind === "residual-cycle") {
    result.sccSize = observation.metrics.memberCount ?? ev.memberNodeIds.length;
  } else if (ev.kind === "low-cohesion-god-file" && ev.files[0]) {
    result.splitClusterCount = ev.files[0].clusterCount;
    result.lcomScore = ev.files[0].clusterCount;
  } else if (ev.kind === "unstable-dependency") {
    result.instabilitySource = ev.sourceInstability;
    if (ev.targets[0]) result.instabilityTarget = ev.targets[0].targetInstability;
  } else if (ev.kind === "co-change-coupling" && ev.pairs[0]) {
    result.coChangeSupport = ev.pairs[0].coChangeCount;
    result.coChangeCoverageOk = ev.coverageStatus === "complete";
  }
  return result;
}

function buildScanFindings(
  scan: ReturnType<typeof runRefactorScan>,
  decisions: RefactorDecisionSetV1,
  nodes: readonly NativeNode[]
): { findings: RefactorScanFindingV2[]; suppressed: RefactorScanV2["suppressed"] } {
  const obsByKey = new Map<string, RefactorObservationV1>();
  for (const obs of scan.assessment.observations) {
    obsByKey.set(`${obs.kind}\0${obs.affectedNodeIds.join(",")}\0${obs.subjectSelectorId}`, obs);
  }
  const findings: RefactorScanFindingV2[] = [];
  const suppressed: RefactorScanV2["suppressed"] = [];

  for (const rec of scan.proposedRecommendations) {
    if (rec.category !== "structural_observation") continue;
    const mapping = DETECTOR_BY_OBSERVATION_KIND[rec.payload.kind];
    if (!mapping) continue;
    const obsKey = `${rec.payload.kind}\0${rec.payload.affectedNodeIds.join(",")}\0${rec.subject}`;
    const obs = obsByKey.get(obsKey) ?? scan.assessment.observations.find(
      (candidate) => candidate.kind === rec.payload.kind &&
        candidate.affectedNodeIds.join(",") === rec.payload.affectedNodeIds.join(",")
    );
    const existingDecision = decisions.byId.get(rec.recommendationId);
    const worsened = existingDecision?.observationMetrics &&
      (existingDecision.status === "rejected" || existingDecision.status === "waived") &&
      observationSeverityWorsened(rec.payload.kind, existingDecision.observationMetrics, rec.payload.metrics);
    if (existingDecision && (existingDecision.status === "deferred" || existingDecision.status === "rejected" || existingDecision.status === "waived") && !worsened) {
      suppressed.push({
        recommendationId: rec.recommendationId,
        detector: mapping.detector,
        decisionStatus: existingDecision.status,
        reason: existingDecision.reason
      });
      continue;
    }

    const summary = rec.explanation[0] ?? `${mapping.detector} detected on ${rec.subject}`;
    findings.push({
      recommendationId: rec.recommendationId,
      fingerprint: rec.fingerprint,
      detector: mapping.detector,
      severity: mapping.severity,
      blocking: mapping.blocking,
      capabilityId: capabilityForNodes(rec.payload.affectedNodeIds, nodes),
      affectedNodeIds: [...rec.payload.affectedNodeIds],
      affectedPaths: obs ? evidencePaths(obs) : [],
      killList: existingDecision?.killList ? [...existingDecision.killList] : [],
      metrics: { ...rec.payload.metrics },
      evidence: obs ? findingEvidenceSummary(obs, summary) : { summary: summary.slice(0, 250) }
    });
  }
  return { findings, suppressed };
}

/** Pure-Git Stage 5 refactor radar scan (`archctx scan --json`, #643). */
export function runScanV2(root: string, options: RunScanV2Options = {}): RefactorScanV2 {
  const scope = options.scope ?? { kind: "repository" };
  const gitScope = pureGitScope(root, scope);
  const decisions = readRefactorDecisionSet(root);
  const request = {
    schemaVersion: "archcontext.refactor-request/v1" as const,
    scope,
    ...(options.importNodeLimit !== undefined ? { importNodeLimit: options.importNodeLimit } : {})
  };
  const scan = runRefactorScan({
    root,
    request,
    repository: gitScope.repository,
    worktree: gitScope.worktree,
    sourceFiles: gitScope.sourceFiles,
    previousRecommendations: [],
    decisions,
    catalogDigest: refactorClassifierRulesetDigest(RECOMMENDATION_SCHEDULER_ENGINE_VERSION)
  });
  const { findings, suppressed } = buildScanFindings(scan, decisions, scan.modelNodes);
  const importsCoverage = scan.snapshot.codeFacts.coverage === "unknown" ? "unavailable" : scan.snapshot.codeFacts.coverage;
  const gitHistoryStatus = scan.snapshot.gitHistory?.coverageStatus === "complete"
    ? "complete"
    : scan.snapshot.gitHistory?.coverageStatus === "shallow"
      ? "shallow"
      : "unavailable";
  const reasonCodes = [...new Set([
    ...scan.snapshot.codeFacts.reasonCodes,
    ...(scan.snapshot.gitHistory?.reasonCodes ?? [])
  ])].sort(compareText);

  const output: RefactorScanV2 = {
    schemaVersion: REFACTOR_SCAN_V2_SCHEMA_VERSION,
    scope,
    headSha: gitScope.worktree.headSha,
    snapshotDigest: scan.snapshot.snapshotDigest,
    ...(options.importNodeLimit !== undefined ? { importNodeLimit: options.importNodeLimit } : {}),
    coverage: { imports: importsCoverage, gitHistory: gitHistoryStatus, reasonCodes },
    findings,
    suppressed
  };
  const checked = validateJsonSchema(CONTRACT_SCHEMA_REGISTRY["schemas/runtime/refactor-scan-v2.schema.json"] as any, output as unknown as Json);
  if (!checked.valid) {
    throw new FailureError("AC_SCHEMA_INVALID", "refactor-scan-invalid", {});
  }
  return output;
}

/** Read-only move/cut impact simulation (`archctx refactor simulate --json`, #638). */
export function runRefactorSimulate(root: string, request: RefactorSimulationRequestV1): RefactorSimulationResultV1 {
  const moves = request.moves ?? [];
  for (const move of moves) {
    if (!move || typeof move.path !== "string" || !isRepoRelativePosixPath(move.path) || typeof move.toNodeId !== "string" || move.toNodeId.trim() === "") {
      throw new FailureError("AC_SCHEMA_INVALID", "refactor-simulate-input-invalid", {});
    }
    if (move.symbols !== undefined && (!Array.isArray(move.symbols) || move.symbols.length === 0 || move.symbols.some((s) => typeof s !== "string" || s.trim() === ""))) {
      throw new FailureError("AC_SCHEMA_INVALID", "refactor-simulate-input-invalid", {});
    }
  }
  const gitScope = pureGitScope(root);
  if (request.expectedHeadSha !== undefined && request.expectedHeadSha !== gitScope.worktree.headSha) {
    throw new FailureError("AC_REFACTOR_STALE", "refactor-request-head-changed", {
      expectedHeadSha: request.expectedHeadSha,
      actualHeadSha: gitScope.worktree.headSha
    });
  }
  if (request.expectedWorktreeDigest !== undefined && request.expectedWorktreeDigest !== gitScope.worktree.worktreeDigest) {
    throw new FailureError("AC_REFACTOR_STALE", "refactor-request-worktree-changed", {
      expectedWorktreeDigest: request.expectedWorktreeDigest,
      actualWorktreeDigest: gitScope.worktree.worktreeDigest
    });
  }

  const measured = measureRefactorSnapshot({
    root,
    repository: gitScope.repository,
    worktree: gitScope.worktree,
    sourceFiles: gitScope.sourceFiles,
    edgeLimit: request.importNodeLimit
  });

  return simulateRefactorPlan({
    snapshot: measured.snapshot,
    structure: measured.structure,
    model: measured.model,
    repository: gitScope.repository,
    worktree: gitScope.worktree,
    trackedFiles: measured.trackedFiles,
    importEdges: measured.codeFacts.pairs,
    workspacePackages: measured.workspacePackages,
    truncated: measured.codeFacts.truncated,
    edgeLimit: measured.edgeLimit,
    importNodeCount: measured.codeFacts.importNodeCount,
    importNodeLimitExceeded: measured.codeFacts.importNodeLimitExceeded,
    codeFacts: {
      version: measured.codeFacts.version,
      binaryDigest: measured.codeFacts.binaryDigest,
      availability: measured.codeFacts.availability,
      indexedWorktreeDigest: measured.codeFacts.indexedWorktreeDigest
    },
    constraints: measured.constraints,
    createdAt: measured.createdAt,
    moves,
    ...(request.targetSubject !== undefined ? { targetSubject: request.targetSubject } : {})
  });
}
