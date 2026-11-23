import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  RECOMMENDATION_STATUSES,
  FailureError,
  isCanonicalRepoRelativePosixPath,
  isValidRefactorKillListSymbolTarget,
  type RecommendationV3,
  type RefactorDecisionKillTargetV1,
  type RefactorDecisionStatus,
  type RefactorDecisionV1,
  type RefactorScanFindingV2
} from "@archcontext/contracts";
import { deriveObservationOutcomes } from "@archcontext/core/refactor-assessment";
import { RECOMMENDATION_SCHEDULER_ENGINE_VERSION } from "@archcontext/core/recommendation-engine";
import { readHeadCommitterDate } from "@archcontext/local-runtime/git-adapter";
import { buildRefactorDecision, readRefactorDecisionSet, refactorDecisionWrite } from "./refactor-decisions";
import { refactorClassifierRulesetDigest } from "./refactor-recording";
import { runRefactorScan } from "./refactor-scan";
import { runScanV2 } from "./refactor-radar-v2";
import { pureGitScope, runVerifyV2 } from "./refactor-verify-v2";

export type V2DecideAction = "list" | "show" | "accept" | "defer" | "reject" | "waive" | "acknowledge" | "resolve";

export interface RunDecideV2Input {
  action: V2DecideAction;
  recommendationId?: string;
  status?: string;
  reason?: string;
  resolutionDigest?: string;
  importNodeLimit?: number;
  actorId?: string;
  killSymbols?: string[];
  killPaths?: string[];
  killRelations?: string[];
}

function parseExplicitKillList(input: RunDecideV2Input): RefactorDecisionKillTargetV1[] {
  const entries: RefactorDecisionKillTargetV1[] = [];
  for (const sym of input.killSymbols ?? []) {
    if (!isValidRefactorKillListSymbolTarget(sym)) {
      throw new FailureError("AC_SCHEMA_INVALID", "recommendations-input-invalid", {});
    }
    entries.push({ kind: "symbol", target: sym, required: true });
  }
  for (const path of input.killPaths ?? []) {
    if (!isCanonicalRepoRelativePosixPath(path)) {
      throw new FailureError("AC_SCHEMA_INVALID", "recommendations-input-invalid", {});
    }
    entries.push({ kind: "path", target: path, required: true });
  }
  for (const relation of input.killRelations ?? []) {
    if (relation.trim() === "") {
      throw new FailureError("AC_SCHEMA_INVALID", "recommendations-input-invalid", {});
    }
    entries.push({ kind: "relation", target: relation, required: true });
  }
  return entries;
}

let atomicDecisionWriteSeq = 0;

function writeAtomicDecision(root: string, decision: RefactorDecisionV1): { path: string; status: RefactorDecisionStatus } {
  const writePlan = refactorDecisionWrite(root, decision);
  const absPath = join(root, writePlan.path);
  mkdirSync(dirname(absPath), { recursive: true });
  const seq = atomicDecisionWriteSeq++;
  const tempPath = `${absPath}.archctx-tmp-${process.pid}-${Date.now() * 1000 + (seq % 1000)}`;
  try {
    writeFileSync(tempPath, writePlan.body, { encoding: "utf8", mode: 0o644, flag: "wx" });
    renameSync(tempPath, absPath);
  } catch (error) {
    try { unlinkSync(tempPath); } catch { /* ignore cleanup errors */ }
    throw error;
  }
  return { path: writePlan.path, status: decision.status };
}

/** Pure-Git human decision management (`archctx decide`, #643 Comments 2–5). */
export function runDecideV2(root: string, input: RunDecideV2Input) {
  const decisions = readRefactorDecisionSet(root);
  if (input.action === "list") {
    if (input.status !== undefined && !(RECOMMENDATION_STATUSES as readonly string[]).includes(input.status)) {
      throw new FailureError("AC_SCHEMA_INVALID", "recommendations-input-invalid", {});
    }
    const filteredDecisions = decisions.decisions.filter(
      (entry) => input.status === undefined || entry.status === input.status
    );
    let openFindings: RefactorScanFindingV2[] = [];
    if (input.status === undefined || input.status === "open") {
      try {
        const scan = runScanV2(root, { importNodeLimit: input.importNodeLimit });
        openFindings = scan.findings.filter((finding) => !decisions.byId.has(finding.recommendationId));
      } catch {
        openFindings = [];
      }
    }
    return {
      schemaVersion: "archcontext.refactor-decide-list/v1" as const,
      status: input.status ?? "all",
      count: filteredDecisions.length + openFindings.length,
      decisions: filteredDecisions,
      openFindings
    };
  }

  const recommendationId = input.recommendationId?.trim();
  if (!recommendationId) {
    throw new FailureError("AC_SCHEMA_INVALID", "recommendations-input-invalid", {});
  }

  if (input.action === "show") {
    const decision = decisions.byId.get(recommendationId) ?? null;
    let finding: RefactorScanFindingV2 | null = null;
    try {
      finding = runScanV2(root, { importNodeLimit: input.importNodeLimit }).findings
        .find((entry) => entry.recommendationId === recommendationId) ?? null;
    } catch {
      finding = null;
    }
    if (!decision && !finding) {
      throw new FailureError("AC_REFACTOR_STALE", "recommendation-not-found", {
        recommendationId,
        searched: "recorded-or-scanned"
      });
    }
    return {
      schemaVersion: "archcontext.refactor-decide-show/v1" as const,
      recommendationId,
      decision,
      finding
    };
  }

  const reason = input.reason?.trim() ?? "";
  if (reason.length === 0) {
    throw new FailureError("AC_SCHEMA_INVALID", "recommendations-input-invalid", {});
  }
  const actorId = input.actorId?.trim() || "cli-user";

  if (input.action === "resolve") {
    const existing = decisions.byId.get(recommendationId);
    if (!existing) {
      throw new FailureError("AC_REFACTOR_STALE", "recommendation-not-found", {
        recommendationId,
        searched: "recorded"
      });
    }
    const verified = runVerifyV2(root, recommendationId, { importNodeLimit: input.importNodeLimit });
    if (input.resolutionDigest !== undefined && input.resolutionDigest !== verified.resolutionDigest) {
      throw new FailureError("AC_REFACTOR_STALE", "refactor-measurement-changed", {
        changedFields: ["headSha"]
      });
    }
    if (verified.disposition !== "resolved") {
      const mapped = verified.disposition === "unresolved" ? "not_improved" : verified.disposition;
      throw new FailureError("AC_REFACTOR_EVIDENCE_REQUIRED", "evidence-not-resolved", {
        recommendationId,
        evidenceDigest: verified.resolutionDigest,
        disposition: mapped
      });
    }
    const nextDecision: RefactorDecisionV1 = {
      ...existing,
      status: "resolved",
      reason,
      actor: { kind: "cli", id: actorId },
      decidedAt: readHeadCommitterDate(root),
      resolutionDigest: verified.resolutionDigest
    };
    const written = writeAtomicDecision(root, nextDecision);
    return {
      schemaVersion: "archcontext.refactor-decide-write/v1" as const,
      decision: nextDecision,
      filePath: written.path,
      verification: verified
    };
  }

  const targetStatus = (
    input.action === "accept"
      ? "accepted"
      : input.action === "defer"
        ? "deferred"
        : input.action === "reject"
          ? "rejected"
          : input.action === "waive"
            ? "waived"
            : "acknowledged"
  ) as RefactorDecisionStatus;

  const explicitKillList = parseExplicitKillList(input);
  const existing = decisions.byId.get(recommendationId);
  if (existing) {
    const mergedKillList = explicitKillList.length > 0 ? explicitKillList : existing.killList;
    const nextDecision: RefactorDecisionV1 = {
      ...existing,
      status: targetStatus,
      reason,
      actor: { kind: "cli", id: actorId },
      decidedAt: readHeadCommitterDate(root),
      ...(mergedKillList !== undefined ? { killList: mergedKillList } : {})
    };
    const written = writeAtomicDecision(root, nextDecision);
    return { schemaVersion: "archcontext.refactor-decide-write/v1" as const, decision: nextDecision, filePath: written.path };
  }

  const gitScope = pureGitScope(root);
  const scan = runRefactorScan({
    root,
    request: {
      schemaVersion: "archcontext.refactor-request/v1",
      scope: { kind: "repository" },
      ...(input.importNodeLimit !== undefined ? { importNodeLimit: input.importNodeLimit } : {})
    },
    repository: gitScope.repository,
    worktree: gitScope.worktree,
    sourceFiles: gitScope.sourceFiles,
    previousRecommendations: [],
    decisions,
    catalogDigest: refactorClassifierRulesetDigest(RECOMMENDATION_SCHEDULER_ENGINE_VERSION)
  });
  const candidate = scan.proposedRecommendations.find((rec) => rec.recommendationId === recommendationId);
  if (!candidate || candidate.category !== "structural_observation") {
    throw new FailureError("AC_REFACTOR_STALE", "recommendation-not-found", {
      recommendationId,
      searched: "recorded-or-scanned"
    });
  }

  const targetOutcomes = deriveObservationOutcomes({
    kind: candidate.payload.kind,
    subjectSelectorId: candidate.subjectSelectorId,
    affectedNodeIds: candidate.payload.affectedNodeIds
  });
  let enrichedRecord: RecommendationV3 = candidate;
  if (candidate.payload.kind === "co-change-coupling") {
    const members = new Set(candidate.payload.affectedNodeIds);
    const modulePairEdgeCount = scan.snapshot.moduleDependencies
      .filter((edge) => members.has(edge.fromNodeId) && members.has(edge.toNodeId))
      .reduce((sum, edge) => sum + edge.distinctFileEdgeCount, 0);
    enrichedRecord = {
      ...candidate,
      payload: {
        ...candidate.payload,
        metrics: { ...candidate.payload.metrics, modulePairEdgeCount }
      }
    };
  }

  const decision = buildRefactorDecision({
    record: enrichedRecord,
    namespace: decisions.namespace,
    status: targetStatus,
    reason,
    actor: { kind: "cli", id: actorId },
    decidedAt: scan.snapshot.createdAt,
    headSha: gitScope.worktree.headSha,
    snapshotDigest: scan.snapshot.snapshotDigest,
    evidenceDigest: scan.assessment.assessmentDigest,
    scope: { kind: "repository" },
    ...(input.importNodeLimit !== undefined ? { importNodeLimit: input.importNodeLimit } : {}),
    targetOutcomes,
    ...(explicitKillList.length > 0 ? { killList: explicitKillList } : {})
  });
  const written = writeAtomicDecision(root, decision);
  return { schemaVersion: "archcontext.refactor-decide-write/v1" as const, decision, filePath: written.path };
}
