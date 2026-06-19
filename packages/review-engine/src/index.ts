import { digestJson, type Json } from "../../contracts/src/index";
import { validateLandscape, type CrossRepoRelation, type Landscape } from "../../architecture-domain/src/index";
import { detectCrossRepoPressure } from "../../pressure-engine/src/index";
import { validateCompatibilityContract, type CompatibilityContractInput, type PolicyFinding } from "../../policy-engine/src/index";
import type { ArchitecturePosture } from "../../architecture-domain/src/index";

export interface CompleteTaskInput {
  taskSessionId: string;
  posture: ArchitecturePosture;
  headSha: string;
  currentHeadSha: string;
  worktreeDigest: string;
  modelDigest: string;
  codeFactsDigest: string;
  compatibilityContract?: CompatibilityContractInput;
  compatibilityPathIntroduced?: boolean;
  cleanupRequired?: number;
  cleanupCompleted?: number;
}

export function completeTaskGate(input: CompleteTaskInput) {
  const findings: PolicyFinding[] = [];
  if (input.headSha !== input.currentHeadSha) {
    findings.push({ id: "stale-context", type: "stale-context", severity: "error", message: "Task snapshot HEAD does not match current HEAD." });
  }
  if (input.compatibilityPathIntroduced) {
    findings.push(...validateCompatibilityContract(input.compatibilityContract));
  }
  if ((input.cleanupRequired ?? 0) > (input.cleanupCompleted ?? 0)) {
    findings.push({ id: "cleanup-incomplete", type: "incomplete-intervention", severity: "error", message: "Intervention cleanup is incomplete." });
  }
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const result = {
    schemaVersion: "archcontext.review/v1",
    reviewId: `review_${digestJson(input as unknown as Json).slice(-12)}`,
    taskSessionId: input.taskSessionId,
    snapshot: {
      headSha: input.currentHeadSha,
      worktreeDigest: input.worktreeDigest,
      modelDigest: input.modelDigest,
      codeFactsDigest: input.codeFactsDigest
    },
    posture: input.posture,
    result: errors > 0 ? "fail_action_required" : warnings > 0 ? "pass_with_warnings" : "pass",
    summary: { errors, warnings, notices: 0 },
    findings,
    cleanup: {
      required: input.cleanupRequired ?? 0,
      completed: input.cleanupCompleted ?? 0
    }
  };
  return {
    ...result,
    extensions: {
      digest: digestJson(result as unknown as Json)
    }
  };
}

export function reviewCrossRepoLandscape(input: { landscape: Landscape; relations: CrossRepoRelation[] }) {
  const validation = validateLandscape(input.landscape, input.relations);
  const pressure = detectCrossRepoPressure({ relations: input.relations });
  const findings: PolicyFinding[] = [
    ...validation.errors.map((error) => ({
      id: `landscape-${digestJson(error).slice(-8)}`,
      type: "landscape-invalid",
      severity: "error" as const,
      message: error
    })),
    ...pressure.signals.map((signal) => ({
      id: signal.type,
      type: signal.type,
      severity: signal.severity === "high" ? ("error" as const) : ("warning" as const),
      message: `Cross-repo pressure: ${signal.type}`
    }))
  ];
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const result = {
    schemaVersion: "archcontext.review/v1",
    reviewId: `review_${digestJson({ landscape: input.landscape.id, relations: input.relations.map((relation) => relation.id) }).slice(-12)}`,
    taskSessionId: "landscape.review",
    snapshot: {
      headSha: "landscape",
      worktreeDigest: `sha256:${"0".repeat(64)}`,
      modelDigest: digestJson(input.landscape as unknown as Json),
      codeFactsDigest: digestJson(input.relations as unknown as Json)
    },
    posture: errors > 0 ? "structural" : "normal",
    result: errors > 0 ? "fail_action_required" : "pass",
    summary: { errors, warnings: findings.length - errors, notices: 0 },
    findings
  };
  return { ...result, extensions: { digest: digestJson(result as unknown as Json) } };
}
