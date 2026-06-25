import {
  CALLER_PROVIDED_ATTESTATION_FIELDS,
  digestJson,
  findCallerProvidedAttestationFields,
  type CallerProvidedAttestationField,
  type Json,
  type PracticeEnforcementEvaluationV1
} from "@archcontext/contracts";
import { validateLandscape, type CrossRepoRelation, type Landscape } from "@archcontext/core/architecture-domain";
import type { ChangeOperation, ChangeSetDraft } from "@archcontext/core/changeset-engine";
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

export interface ReviewArchitectureCandidateChangeSetInput {
  taskSessionId: string;
  changeSet: ChangeSetDraft;
  headSha: string;
  currentHeadSha: string;
  worktreeDigest: string;
  modelDigest: string;
  codeFactsDigest: string;
}

interface CandidateChangeOperationMetadata extends ChangeOperation {
  candidateChangeId?: unknown;
  targetKind?: unknown;
  targetId?: unknown;
  targetParentId?: unknown;
  stateDimension?: unknown;
  changeKind?: unknown;
  confidence?: unknown;
  evidenceIds?: unknown;
  subjectSelectorIds?: unknown;
  mappingIds?: unknown;
  ambiguityIds?: unknown;
  changes?: unknown;
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
  const nonBlockingPracticeViolations = staleContext ? [] : input.practiceEnforcement?.nonBlockingViolations ?? [];
  const waiversApplied = staleContext ? [] : input.practiceEnforcement?.waiversApplied ?? [];
  const actionsRequired = staleContext ? [] : input.practiceEnforcement?.actionsRequired ?? [];
  const { practiceFindings, suppressedPracticeFindings } = dedupePracticeFindings(
    practiceViolations.map((violation) => ({
      violation,
      finding: {
        id: `practice:${violation.practiceId}:${violation.checkId}`,
        type: "practice-violation",
        severity: "error" as const,
        message: violation.message
      }
    })),
    findings
  );
  const advisoryPracticeFindings = nonBlockingPracticeViolations.map((violation) => ({
    id: `practice-advisory:${violation.practiceId}:${violation.checkId}`,
    type: "practice-advisory",
    severity: "warning" as const,
    message: violation.message
  }));
  findings.push(...practiceFindings, ...advisoryPracticeFindings);
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
      ...(staleContext && input.practiceEnforcement !== undefined ? { practiceChecksSkipped: "stale-context" } : {}),
      ...(nonBlockingPracticeViolations.length === 0 ? {} : { nonBlockingPracticeViolations }),
      ...(suppressedPracticeFindings.length === 0 ? {} : { suppressedPracticeFindings })
    }
  };
}

export function reviewArchitectureCandidateChangeSet(input: ReviewArchitectureCandidateChangeSetInput) {
  assertNoCallerProvidedReviewConclusionFields({
    taskSessionId: input.taskSessionId,
    headSha: input.headSha,
    currentHeadSha: input.currentHeadSha,
    worktreeDigest: input.worktreeDigest,
    modelDigest: input.modelDigest,
    codeFactsDigest: input.codeFactsDigest
  });
  const findings: PolicyFinding[] = [];
  const staleContext = input.headSha !== input.currentHeadSha;
  if (staleContext) {
    findings.push({ id: "stale-context", type: "stale-context", severity: "error", message: "Candidate ChangeSet HEAD does not match current HEAD." });
  }
  for (const [index, operation] of input.changeSet.operations.entries()) {
    findings.push(...reviewCandidateChangeOperation(operation, index));
  }
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const outcome = errors > 0 ? ("fail_action_required" as const) : warnings > 0 ? ("pass_with_warnings" as const) : ("pass" as const);
  const rejectedCandidateChangeIds = uniqueSorted(findings.map(candidateChangeIdFromFinding).filter((id): id is string => id !== undefined));
  const result = {
    schemaVersion: "archcontext.review/v1",
    reviewId: `review_${digestJson({
      kind: "architecture-candidate-changeset-review",
      taskSessionId: input.taskSessionId,
      changeSetId: input.changeSet.id,
      changeSetDigest: digestJson(input.changeSet as unknown as Json),
      headSha: input.currentHeadSha
    } as unknown as Json).slice(-12)}`,
    taskSessionId: input.taskSessionId,
    snapshot: {
      headSha: input.currentHeadSha,
      worktreeDigest: input.worktreeDigest,
      modelDigest: input.modelDigest,
      codeFactsDigest: input.codeFactsDigest
    },
    posture: errors > 0 ? ("proof-required" as const) : ("structural" as const),
    result: outcome,
    summary: { errors, warnings, notices: 0 },
    findings,
    actionsRequired: findings
      .filter((finding) => finding.severity === "error")
      .map((finding) => finding.id),
    cleanup: { required: 0, completed: 0 }
  };
  return {
    ...result,
    extensions: {
      digest: digestJson(result as unknown as Json),
      changeSetId: input.changeSet.id,
      changeSetDigest: digestJson(input.changeSet as unknown as Json),
      reviewMode: "architecture-candidate-changeset",
      rejectedCandidateChangeIds
    }
  };
}

function dedupePracticeFindings(
  candidates: { violation: PracticeEnforcementEvaluationV1["violations"][number]; finding: PolicyFinding }[],
  existingFindings: PolicyFinding[]
): { practiceFindings: PolicyFinding[]; suppressedPracticeFindings: Json[] } {
  const compatibilityFindingIds = new Set(existingFindings.filter(isCompatibilityFinding).map((finding) => finding.id));
  const practiceFindings: PolicyFinding[] = [];
  const suppressedPracticeFindings: Json[] = [];
  for (const candidate of candidates) {
    const duplicateCompatibilityIds = candidate.violation.checkId === "compatibility-contract-required"
      ? candidate.violation.subjects.filter((subject) => compatibilityFindingIds.has(subject)).sort()
      : [];
    if (duplicateCompatibilityIds.length > 0) {
      suppressedPracticeFindings.push({
        id: candidate.finding.id,
        reason: "duplicates-compatibility-contract-finding",
        duplicateFindingIds: duplicateCompatibilityIds
      } as unknown as Json);
      continue;
    }
    practiceFindings.push(candidate.finding);
  }
  return { practiceFindings, suppressedPracticeFindings };
}

function isCompatibilityFinding(finding: PolicyFinding): boolean {
  return finding.type === "unjustified-compatibility-path" || finding.type === "invalid-compatibility-contract";
}

function reviewCandidateChangeOperation(operation: ChangeOperation, index: number): PolicyFinding[] {
  const metadata = operation as CandidateChangeOperationMetadata;
  const candidateChangeId = stringField(metadata.candidateChangeId) ?? `operation-${index}`;
  const targetKind = stringField(metadata.targetKind);
  const changeKind = stringField(metadata.changeKind);
  const targetId = stringField(metadata.targetId) ?? metadata.entityId ?? candidateChangeId;
  const findings: PolicyFinding[] = [];
  if (isUnsupportedEntityDeletion(operation, targetKind, changeKind)) {
    findings.push(candidateFinding({
      candidateChangeId,
      reason: "unsupported-entity-deletion",
      targetId,
      message: `Unsupported architecture candidate deletion for ${targetId}; deletion requires explicit human review and a supported migration path.`
    }));
  }
  if (targetKind === "owner") {
    findings.push(candidateFinding({
      candidateChangeId,
      reason: "unsupported-owner-change",
      targetId,
      message: `Unsupported architecture owner change for ${targetId}; ownership authority changes require explicit human approval.`
    }));
  }
  if (isBoundaryRelaxation(metadata, targetKind, changeKind)) {
    findings.push(candidateFinding({
      candidateChangeId,
      reason: "unsupported-boundary-relaxation",
      targetId,
      message: `Unsupported architecture boundary relaxation for ${targetId}; constraint weakening requires proof and a durable compatibility contract.`
    }));
  }
  if (containsExternalContractClaim(metadata)) {
    findings.push(candidateFinding({
      candidateChangeId,
      reason: "unsupported-external-contract-claim",
      targetId,
      message: `Unsupported external contract claim for ${targetId}; external contracts require declared evidence and human review.`
    }));
  }
  return dedupeFindings(findings);
}

function candidateFinding(input: { candidateChangeId: string; reason: string; targetId: string; message: string }): PolicyFinding {
  return {
    id: `architecture-candidate:${input.candidateChangeId}:${input.reason}`,
    type: input.reason,
    severity: "error",
    message: input.message
  };
}

function isUnsupportedEntityDeletion(operation: ChangeOperation, targetKind: string | undefined, changeKind: string | undefined): boolean {
  if (operation.op !== "delete_entity" && changeKind !== "removed") return false;
  return targetKind === undefined || targetKind === "node" || targetKind === "relation" || targetKind === "constraint";
}

function isBoundaryRelaxation(operation: CandidateChangeOperationMetadata, targetKind: string | undefined, changeKind: string | undefined): boolean {
  if (targetKind !== "constraint") return false;
  if (changeKind === "added") return false;
  return changeKind === "removed" || changeKind === "moved" || changeKind === "renamed" || changeKind === "materially_changed" || metadataContainsToken(operation, "boundary-relaxation") || metadataContainsToken(operation, "boundary relaxation");
}

function containsExternalContractClaim(operation: CandidateChangeOperationMetadata): boolean {
  return metadataContainsToken(operation, "external-contract") || metadataContainsToken(operation, "external contract");
}

function metadataContainsToken(operation: CandidateChangeOperationMetadata, token: string): boolean {
  const { body: _body, ...metadataOnly } = operation as unknown as Record<string, unknown>;
  return JSON.stringify(metadataOnly).toLowerCase().includes(token);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function dedupeFindings(findings: PolicyFinding[]): PolicyFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    if (seen.has(finding.id)) return false;
    seen.add(finding.id);
    return true;
  });
}

function candidateChangeIdFromFinding(finding: PolicyFinding): string | undefined {
  const match = /^architecture-candidate:([^:]+):/.exec(finding.id);
  return match?.[1];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
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
