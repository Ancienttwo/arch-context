import { digestJson, type Json } from "../../contracts/src/index";
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
  return { ...result, digest: digestJson(result as unknown as Json) };
}
