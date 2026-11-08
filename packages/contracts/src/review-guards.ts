/**
 * Guards that keep a caller from forging a review conclusion, and the envelope shape the remaining
 * Cloud surfaces still record.
 *
 * These live here, not with the rest of the retired governance surface, because they survive ADR-0053:
 * the runtime daemon's `completeTask` and the mcp-local `complete-task` tool use the attestation-field
 * guards for local review, and `schemas/cloud/cloud-egress-envelope.schema.json` plus the ADR-0035
 * privacy rule keep `CloudEgressEnvelope`. Keeping them in `github-governance.ts` would have made that
 * file undeletable without breaking local review.
 */

export const CALLER_PROVIDED_ATTESTATION_FIELDS = [
  "result",
  "reviewDigest",
  "policyDigest",
  "modelDigest",
  "signature",
  "practiceEnforcement",
  "practiceViolations",
  "waiversApplied",
  "actionsRequired",
  "practiceCatalogDigest",
  "practicePolicyDigest",
  "practiceCheckResultDigest"
] as const;
export type CallerProvidedAttestationField = (typeof CALLER_PROVIDED_ATTESTATION_FIELDS)[number];

export const LLM_ADVISORY_FORBIDDEN_FIELDS = [
  ...CALLER_PROVIDED_ATTESTATION_FIELDS,
  "conclusion",
  "checkConclusion",
  "attestationResult"
] as const;
export type LlmAdvisoryForbiddenField = (typeof LLM_ADVISORY_FORBIDDEN_FIELDS)[number];

function collectForbiddenFields<T extends string>(value: unknown, found: Set<T>, forbiddenFields: readonly T[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectForbiddenFields(item, found, forbiddenFields);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((forbiddenFields as readonly string[]).includes(key)) {
      found.add(key as T);
    }
    collectForbiddenFields(child, found, forbiddenFields);
  }
}

function collectCallerProvidedAttestationFields(value: unknown, found: Set<CallerProvidedAttestationField>): void {
  collectForbiddenFields(value, found, CALLER_PROVIDED_ATTESTATION_FIELDS);
}

export function findCallerProvidedAttestationFields(value: unknown): CallerProvidedAttestationField[] {
  const found = new Set<CallerProvidedAttestationField>();
  collectCallerProvidedAttestationFields(value, found);
  return CALLER_PROVIDED_ATTESTATION_FIELDS.filter((field) => found.has(field));
}

export function assertNoCallerProvidedAttestationFields(value: unknown, boundary = "review request"): void {
  const fields = findCallerProvidedAttestationFields(value);
  if (fields.length > 0) throw new Error(`${boundary}-caller-provided-attestation-field-forbidden: ${fields.join(",")}`);
}

export function findLlmAdvisoryForbiddenFields(value: unknown): LlmAdvisoryForbiddenField[] {
  const found = new Set<LlmAdvisoryForbiddenField>();
  collectForbiddenFields(value, found, LLM_ADVISORY_FORBIDDEN_FIELDS);
  return LLM_ADVISORY_FORBIDDEN_FIELDS.filter((field) => found.has(field));
}

export function assertNoLlmAdvisoryConclusionFields(value: unknown): void {
  const fields = findLlmAdvisoryForbiddenFields(value);
  if (fields.length > 0) throw new Error(`llm-advisory-conclusion-field-forbidden: ${fields.join(",")}`);
}

/**
 * What a remaining Cloud surface records when it calls the GitHub API. ADR-0035's privacy rule and
 * `schemas/cloud/cloud-egress-envelope.schema.json` both depend on this shape.
 */
export interface CloudEgressEnvelope {
  schemaVersion: "archcontext.cloud-egress/v1";
  requestId: string;
  category: "github.metadata" | "github.pull-head" | "github.check-list-for-ref" | "github.check-create" | "github.check-update";
  method: "GET" | "POST" | "PATCH";
  host: "api.github.com";
  pathTemplate: string;
  statusCode: number;
  latencyMs: number;
  recordedAt: string;
}
