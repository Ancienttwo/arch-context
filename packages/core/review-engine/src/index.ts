import {
  CALLER_PROVIDED_ATTESTATION_FIELDS,
  digestJson,
  findCallerProvidedAttestationFields,
  type CallerProvidedAttestationField,
  type Json,
  type PracticeEnforcementEvaluationV1
} from "@archcontext/contracts";
import { validateLandscape, type CrossRepoRelation, type Landscape } from "@archcontext/core/architecture-domain";
import { detectCrossRepoPressure } from "@archcontext/core/pressure-engine";
import { validateCompatibilityContract, type CompatibilityContractInput, type PolicyFinding } from "@archcontext/core/policy-engine";
import type { ArchitecturePosture } from "@archcontext/core/architecture-domain";

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
  practiceEnforcement?: PracticeEnforcementEvaluationV1;
}

export type CallerProvidedReviewConclusionField = Exclude<CallerProvidedAttestationField, "modelDigest">;

export const CALLER_PROVIDED_REVIEW_CONCLUSION_FIELDS = CALLER_PROVIDED_ATTESTATION_FIELDS
  .filter((field): field is CallerProvidedReviewConclusionField => field !== "modelDigest");

export function assertNoCallerProvidedReviewConclusionFields(value: unknown): void {
  const fields = findCallerProvidedAttestationFields(withoutTrustedPracticeEnforcement(value))
    .filter((field): field is CallerProvidedReviewConclusionField => field !== "modelDigest");
  if (fields.length > 0) throw new Error(`review-conclusion-field-forbidden: ${fields.join(",")}`);
}

function withoutTrustedPracticeEnforcement(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { practiceEnforcement: _practiceEnforcement, ...rest } = value as Record<string, unknown>;
  return rest;
}

export function completeTaskGate(input: CompleteTaskInput) {
  assertNoCallerProvidedReviewConclusionFields(input);
  const findings: PolicyFinding[] = [];
  const staleContext = input.headSha !== input.currentHeadSha;
  if (staleContext) {
    findings.push({ id: "stale-context", type: "stale-context", severity: "error", message: "Task snapshot HEAD does not match current HEAD." });
  }
  if (input.compatibilityPathIntroduced) {
    findings.push(...validateCompatibilityContract(input.compatibilityContract));
  }
  if ((input.cleanupRequired ?? 0) > (input.cleanupCompleted ?? 0)) {
    findings.push({ id: "cleanup-incomplete", type: "incomplete-intervention", severity: "error", message: "Intervention cleanup is incomplete." });
  }
  const practiceViolations = staleContext ? [] : input.practiceEnforcement?.violations ?? [];
  const waiversApplied = staleContext ? [] : input.practiceEnforcement?.waiversApplied ?? [];
  const actionsRequired = staleContext ? [] : input.practiceEnforcement?.actionsRequired ?? [];
  const practiceFindings: PolicyFinding[] = practiceViolations.map((violation) => ({
    id: `practice:${violation.practiceId}:${violation.checkId}`,
    type: "practice-violation",
    severity: "error",
    message: violation.message
  }));
  findings.push(...practiceFindings);
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const outcome = errors > 0 ? ("fail_action_required" as const) : warnings > 0 ? ("pass_with_warnings" as const) : ("pass" as const);
  const result = {
    schemaVersion: "archcontext.review/v1",
    reviewId: `review_${digestJson(input as unknown as Json).slice(-12)}`,
    taskSessionId: input.taskSessionId,
    snapshot: {
      headSha: input.currentHeadSha,
      worktreeDigest: input.worktreeDigest,
      modelDigest: input.modelDigest,
      codeFactsDigest: input.codeFactsDigest,
      ...(input.practiceEnforcement === undefined ? {} : {
        practiceCatalogDigest: input.practiceEnforcement.catalogDigest,
        practicePolicyDigest: input.practiceEnforcement.policyDigest,
        practiceCheckResultDigest: input.practiceEnforcement.checkResultDigest
      })
    },
    posture: input.posture,
    result: outcome,
    summary: { errors, warnings, notices: waiversApplied.length },
    findings,
    practiceViolations,
    waiversApplied,
    actionsRequired,
    cleanup: {
      required: input.cleanupRequired ?? 0,
      completed: input.cleanupCompleted ?? 0
    }
  };
  return {
    ...result,
    extensions: {
      digest: digestJson(result as unknown as Json),
      ...(staleContext && input.practiceEnforcement !== undefined ? { practiceChecksSkipped: "stale-context" } : {})
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
