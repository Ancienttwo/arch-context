import { canonicalize, digestJson, type Json } from "./schema";

export const DEVELOPER_REVIEW_CHECK_NAME = "ArchContext / Developer Review" as const;
export const ORGANIZATION_RUNNER_CHECK_NAME = "ArchContext / Organization Runner" as const;

export const GOVERNANCE_CHECK_NAMES = [
  DEVELOPER_REVIEW_CHECK_NAME,
  ORGANIZATION_RUNNER_CHECK_NAME
] as const;

export type GovernanceCheckName = (typeof GOVERNANCE_CHECK_NAMES)[number];
export type GovernanceTrustLevel = "developer" | "organization";
export type RequiredTrust = GovernanceTrustLevel;
export type ReviewChallengeStatus = "PENDING" | "LEASED" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "SUPERSEDED" | "EXPIRED";
export type CheckDeliveryStatus = "PENDING" | "PUBLISHED" | "RETRYING" | "DEAD_LETTER";
export type AttestationResult = "pass" | "fail" | "error";
export type GitHubAppPermissionLevel = "none" | "read" | "write";
export type CallerProvidedAttestationField = (typeof CALLER_PROVIDED_ATTESTATION_FIELDS)[number];
export type LlmAdvisoryForbiddenField = (typeof LLM_ADVISORY_FORBIDDEN_FIELDS)[number];
export type RunnerIdentityStatus = "active" | "rotating" | "revoked";
export type RunnerIdentityScope =
  | { kind: "repository"; repositoryIds: number[] }
  | { kind: "organization" };
export type CreateAttestationV2Input = Omit<AttestationV2, "schemaVersion" | "attestationId" | "signature"> & {
  attestationId?: string;
  signature?: AttestationV2["signature"];
};
export type CreateRunnerIdentityInput = Omit<RunnerIdentity, "schemaVersion" | "repositoryIds" | "scope" | "rotatedAt" | "revokedAt"> & {
  repositoryIds?: number[];
  scope?: RunnerIdentityScope;
  rotatedAt?: string | null;
  revokedAt?: string | null;
};

export interface DevicePrivateKeySignerPort {
  signWithDevicePrivateKey(input: { keyRef: string; payload: string | Uint8Array }): string;
}

export const CALLER_PROVIDED_ATTESTATION_FIELDS = [
  "result",
  "reviewDigest",
  "policyDigest",
  "modelDigest",
  "signature"
] as const;
export const LLM_ADVISORY_FORBIDDEN_FIELDS = [
  ...CALLER_PROVIDED_ATTESTATION_FIELDS,
  "conclusion",
  "checkConclusion",
  "attestationResult"
] as const;

export const GITHUB_APP_PERMISSION_MANIFEST = {
  schemaVersion: "archcontext.github-app-permission-manifest/v1",
  repositoryPermissions: {
    metadata: "read",
    pull_requests: "read",
    checks: "write",
    statuses: "write",
    contents: "none"
  },
  forbiddenByDefault: [
    "actions",
    "administration",
    "deployments",
    "issues",
    "members",
    "secrets",
    "workflows"
  ],
  conditionalPermissions: {
    commit_statuses: {
      default: "none",
      implemented: "write",
      decisionGate: "FG2-02 / FG2-EG6",
      reason: "GitHub ruleset expected-source App binding requires statuses:write; runtime still publishes Checks, not commit statuses."
    }
  },
  subscribedEvents: [
    "installation",
    "installation_repositories",
    "pull_request.opened",
    "pull_request.reopened",
    "pull_request.synchronize",
    "pull_request.closed",
    "check_run.rerequested"
  ]
} as const;

export const CHALLENGE_STATUS_TRANSITIONS: Record<ReviewChallengeStatus, readonly ReviewChallengeStatus[]> = {
  PENDING: ["LEASED", "SUPERSEDED", "EXPIRED"],
  LEASED: ["SUBMITTED", "SUPERSEDED", "EXPIRED"],
  SUBMITTED: ["VERIFIED", "REJECTED", "SUPERSEDED", "EXPIRED"],
  VERIFIED: [],
  REJECTED: [],
  SUPERSEDED: [],
  EXPIRED: []
} as const;

export const CHECK_DELIVERY_STATUS_TRANSITIONS: Record<CheckDeliveryStatus, readonly CheckDeliveryStatus[]> = {
  PENDING: ["PUBLISHED", "RETRYING", "DEAD_LETTER"],
  RETRYING: ["PUBLISHED", "RETRYING", "DEAD_LETTER"],
  PUBLISHED: [],
  DEAD_LETTER: ["PENDING"]
} as const;

export const RUNNER_IDENTITY_STATUS_TRANSITIONS: Record<RunnerIdentityStatus, readonly RunnerIdentityStatus[]> = {
  active: ["rotating", "revoked"],
  rotating: ["active", "revoked"],
  revoked: []
} as const;

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

export function createAttestationV2(input: CreateAttestationV2Input): AttestationV2 {
  return {
    schemaVersion: "archcontext.attestation/v2",
    attestationId: input.attestationId ?? attestationV2Id(input),
    challengeId: input.challengeId,
    installationId: input.installationId,
    repositoryId: input.repositoryId,
    pullRequestNumber: input.pullRequestNumber,
    headSha: input.headSha,
    baseSha: input.baseSha,
    mergeBaseSha: input.mergeBaseSha,
    headTreeOid: input.headTreeOid,
    worktreeDigest: input.worktreeDigest,
    modelDigest: input.modelDigest,
    policyDigest: input.policyDigest,
    codeFactsDigest: input.codeFactsDigest,
    reviewDigest: input.reviewDigest,
    result: input.result,
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    execution: input.execution,
    runtime: input.runtime,
    nonce: input.nonce,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    expiresAt: input.expiresAt,
    signature: input.signature ?? { algorithm: "ed25519", value: "" }
  };
}

export function unsignedAttestationV2(attestation: AttestationV2): AttestationV2 {
  return {
    ...attestation,
    signature: {
      ...attestation.signature,
      value: ""
    }
  };
}

export function canonicalAttestationV2(attestation: AttestationV2): string {
  return canonicalize(unsignedAttestationV2(attestation) as unknown as Json);
}

export function attestationV2Digest(attestation: AttestationV2): string {
  return digestJson(unsignedAttestationV2(attestation) as unknown as Json);
}

function attestationV2Id(input: Omit<CreateAttestationV2Input, "attestationId">): string {
  const digest = digestJson({
    schemaVersion: "archcontext.attestation/v2",
    challengeId: input.challengeId,
    installationId: input.installationId,
    repositoryId: input.repositoryId,
    pullRequestNumber: input.pullRequestNumber,
    headSha: input.headSha,
    baseSha: input.baseSha,
    mergeBaseSha: input.mergeBaseSha,
    headTreeOid: input.headTreeOid,
    worktreeDigest: input.worktreeDigest,
    modelDigest: input.modelDigest,
    policyDigest: input.policyDigest,
    codeFactsDigest: input.codeFactsDigest,
    reviewDigest: input.reviewDigest,
    result: input.result,
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    execution: input.execution,
    runtime: input.runtime,
    nonce: input.nonce,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    expiresAt: input.expiresAt,
    signature: { algorithm: input.signature?.algorithm ?? "ed25519", value: "" }
  } as unknown as Json);
  return `att_${digest.slice("sha256:".length, "sha256:".length + 16)}`;
}

function collectCallerProvidedAttestationFields(value: unknown, found: Set<CallerProvidedAttestationField>): void {
  collectForbiddenFields(value, found, CALLER_PROVIDED_ATTESTATION_FIELDS);
}

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

export type GovernanceReasonCode =
  | "ATTESTATION_SCHEMA_UNSUPPORTED"
  | "CHALLENGE_NOT_FOUND"
  | "CHALLENGE_EXPIRED"
  | "CHALLENGE_SUPERSEDED"
  | "CHALLENGE_ALREADY_CONSUMED"
  | "NONCE_MISMATCH"
  | "REPOSITORY_MISMATCH"
  | "PULL_REQUEST_MISMATCH"
  | "HEAD_SHA_MISMATCH"
  | "BASE_SHA_MISMATCH"
  | "TREE_OID_MISMATCH"
  | "TRUST_LEVEL_MISMATCH"
  | "DIGEST_INVALID"
  | "RUNNER_NOT_FOUND"
  | "RUNNER_REVOKED"
  | "RUNNER_SCOPE_MISMATCH"
  | "WORKFLOW_REF_MISMATCH"
  | "DEVICE_REVOKED"
  | "RUNTIME_VERSION_UNSUPPORTED"
  | "SIGNATURE_INVALID"
  | "PAYLOAD_PRIVACY_VIOLATION"
  | "CHECK_DELIVERY_FAILED"
  | "CHECK_DELIVERY_MAX_ATTEMPTS";

export const GOVERNANCE_REASON_CATALOG: Record<GovernanceReasonCode, { retryable: boolean; action: string }> = {
  ATTESTATION_SCHEMA_UNSUPPORTED: { retryable: true, action: "rerun-with-attestation-v2" },
  CHALLENGE_NOT_FOUND: { retryable: false, action: "refresh-current-challenge" },
  CHALLENGE_EXPIRED: { retryable: true, action: "lease-new-challenge" },
  CHALLENGE_SUPERSEDED: { retryable: true, action: "review-latest-head" },
  CHALLENGE_ALREADY_CONSUMED: { retryable: false, action: "do-not-reuse-attestation" },
  NONCE_MISMATCH: { retryable: false, action: "restart-review-session" },
  REPOSITORY_MISMATCH: { retryable: false, action: "verify-repository-binding" },
  PULL_REQUEST_MISMATCH: { retryable: false, action: "verify-pull-request-binding" },
  HEAD_SHA_MISMATCH: { retryable: true, action: "fetch-current-head-and-rerun" },
  BASE_SHA_MISMATCH: { retryable: true, action: "refresh-pull-request-metadata" },
  TREE_OID_MISMATCH: { retryable: true, action: "recreate-clean-worktree" },
  TRUST_LEVEL_MISMATCH: { retryable: false, action: "use-required-review-mode" },
  DIGEST_INVALID: { retryable: false, action: "rerun-review-session" },
  RUNNER_NOT_FOUND: { retryable: false, action: "register-runner-identity" },
  RUNNER_REVOKED: { retryable: false, action: "register-replacement-runner-key" },
  RUNNER_SCOPE_MISMATCH: { retryable: false, action: "register-runner-for-repository" },
  WORKFLOW_REF_MISMATCH: { retryable: false, action: "use-approved-runner-workflow" },
  DEVICE_REVOKED: { retryable: false, action: "register-new-device-key" },
  RUNTIME_VERSION_UNSUPPORTED: { retryable: true, action: "upgrade-archctx-runtime" },
  SIGNATURE_INVALID: { retryable: false, action: "restart-review-session" },
  PAYLOAD_PRIVACY_VIOLATION: { retryable: false, action: "remove-private-content-from-payload" },
  CHECK_DELIVERY_FAILED: { retryable: true, action: "retry-check-delivery" },
  CHECK_DELIVERY_MAX_ATTEMPTS: { retryable: false, action: "manual-replay-or-rerequest-check" }
} as const;

export interface ReviewChallengeV2 {
  schemaVersion: "archcontext.review-challenge/v2";
  challengeId: string;
  installationId: number;
  repositoryId: number;
  pullRequestNumber: number;
  headSha: string;
  baseSha: string;
  nonce: string;
  requiredTrust: RequiredTrust;
  policyProfileId: string;
  createdAt: string;
  expiresAt: string;
  status: ReviewChallengeStatus;
}

export interface AttestationV2 {
  schemaVersion: "archcontext.attestation/v2";
  attestationId: string;
  challengeId: string;
  installationId: number;
  repositoryId: number;
  pullRequestNumber: number;
  headSha: string;
  baseSha: string;
  mergeBaseSha: string;
  headTreeOid: string;
  worktreeDigest: string;
  modelDigest: string;
  policyDigest: string;
  codeFactsDigest: string;
  reviewDigest: string;
  result: AttestationResult;
  errorCode?: string;
  execution:
    | {
        trustLevel: "developer";
        source: "clean-commit-worktree";
        principalId: string;
        publicKeyId: string;
      }
    | {
        trustLevel: "organization";
        source: "organization-runner-checkout";
        principalId: string;
        publicKeyId: string;
        runnerId: string;
        workflowRef: string;
        runId: string;
        runAttempt: number;
      };
  runtime: {
    version: string;
    buildDigest: string;
    codeGraphVersion: string;
    capabilitiesDigest: string;
  };
  nonce: string;
  startedAt: string;
  completedAt: string;
  expiresAt: string;
  signature: {
    algorithm: "ed25519";
    value: string;
  };
}

export interface DeviceIdentity {
  schemaVersion: "archcontext.device-identity/v1";
  deviceId: string;
  accountId: string;
  publicKeyId: string;
  publicKeyFingerprint: string;
  status: "active" | "revoked";
  createdAt: string;
  revokedAt?: string | null;
}

export interface RunnerIdentity {
  schemaVersion: "archcontext.runner-identity/v1";
  runnerId: string;
  installationId: number;
  repositoryIds: number[];
  scope?: RunnerIdentityScope;
  workflowRef: string;
  publicKeyId: string;
  publicKeyFingerprint: string;
  status: RunnerIdentityStatus;
  createdAt: string;
  rotatedAt?: string | null;
  revokedAt?: string | null;
}

export interface GovernanceKeyStatus {
  schemaVersion: "archcontext.governance-key-status/v1";
  publicKeyId: string;
  ownerKind: "device" | "runner";
  ownerId: string;
  fingerprint: string;
  status: "active" | "rotating" | "revoked";
  createdAt: string;
  rotatedAt?: string | null;
  revokedAt?: string | null;
}

export interface CheckDelivery {
  schemaVersion: "archcontext.check-delivery/v1";
  deliveryId: string;
  challengeId: string;
  checkRunId?: string | null;
  checkName: GovernanceCheckName;
  headSha: string;
  status: CheckDeliveryStatus;
  attemptCount: number;
  nextAttemptAt?: string | null;
  lastErrorCode?: GovernanceReasonCode | null;
  createdAt: string;
  updatedAt: string;
}

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

export interface RepositoryMetadata {
  installationId: number;
  repositoryId: number;
  owner: string;
  name: string;
  visibility: "public" | "private";
}

export interface PullHeadMetadata {
  installationId: number;
  repositoryId: number;
  pullRequestNumber: number;
  headSha: string;
  baseSha: string;
}

export interface ReviewChallengePullHeadIdentity {
  installationId: number;
  repositoryId: number;
  pullRequestNumber: number;
  headSha: string;
  baseSha: string;
}

export interface ReviewChallengePullHeadVerification {
  schemaVersion: "archcontext.review-challenge-pull-head-verification/v1";
  accepted: boolean;
  reasonCode?: Extract<GovernanceReasonCode, "REPOSITORY_MISMATCH" | "PULL_REQUEST_MISMATCH" | "HEAD_SHA_MISMATCH" | "BASE_SHA_MISMATCH">;
  challengeId: string;
  expected: ReviewChallengePullHeadIdentity;
  observed: PullHeadMetadata;
}

export interface CreateGovernanceCheckInput {
  installationId: number;
  repositoryId: number;
  pullRequestNumber: number;
  headSha: string;
  name: GovernanceCheckName;
  status: "queued" | "in_progress" | "completed";
  externalId?: string;
}

export interface UpdateGovernanceCheckInput {
  installationId: number;
  repositoryId: number;
  checkRunId: string;
  name: GovernanceCheckName;
  status: "queued" | "in_progress" | "completed";
  conclusion?: "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required";
  output: {
    title: string;
    summary: string;
  };
}

export interface CheckReference {
  checkRunId: string;
  htmlUrl?: string;
}

export interface CheckRunReference extends CheckReference {
  name: GovernanceCheckName;
  headSha: string;
  status: CreateGovernanceCheckInput["status"];
  conclusion?: NonNullable<UpdateGovernanceCheckInput["conclusion"]> | null;
  output?: {
    title?: string | null;
    summary?: string | null;
  };
}

export interface GitHubGovernancePort {
  getRepositoryMetadata(input: { installationId: number; repositoryId: number }): Promise<RepositoryMetadata>;
  getPullHeadMetadata(input: {
    installationId: number;
    repositoryId: number;
    pullRequestNumber: number;
  }): Promise<PullHeadMetadata>;
  listCheckRunsForRef(input: {
    installationId: number;
    repositoryId: number;
    ref: string;
    name: GovernanceCheckName;
  }): Promise<CheckRunReference[]>;
  createCheckRun(input: CreateGovernanceCheckInput): Promise<CheckReference>;
  updateCheckRun(input: UpdateGovernanceCheckInput): Promise<void>;
}

export function canTransitionChallenge(from: ReviewChallengeStatus, to: ReviewChallengeStatus): boolean {
  if (!isReviewChallengeStatus(from) || !isReviewChallengeStatus(to)) return false;
  return CHALLENGE_STATUS_TRANSITIONS[from].includes(to);
}

export function assertCanTransitionChallenge(from: ReviewChallengeStatus, to: ReviewChallengeStatus): void {
  if (!isReviewChallengeStatus(from)) throw new Error(`challenge-status-invalid: ${String(from)}`);
  if (!isReviewChallengeStatus(to)) throw new Error(`challenge-status-invalid: ${String(to)}`);
  if (!canTransitionChallenge(from, to)) throw new Error(`challenge-transition-invalid: ${from}->${to}`);
}

export function transitionReviewChallengeStatus(challenge: ReviewChallengeV2, to: ReviewChallengeStatus): ReviewChallengeV2 {
  assertCanTransitionChallenge(challenge.status, to);
  return { ...challenge, status: to };
}

export function canTransitionCheckDelivery(from: CheckDeliveryStatus, to: CheckDeliveryStatus): boolean {
  return CHECK_DELIVERY_STATUS_TRANSITIONS[from].includes(to);
}

export function createRunnerIdentity(input: CreateRunnerIdentityInput): RunnerIdentity {
  const scope = normalizeRunnerIdentityScope(input.scope ?? { kind: "repository", repositoryIds: input.repositoryIds ?? [] });
  const repositoryIds = scope.kind === "organization" ? [] : scope.repositoryIds;
  const identity: RunnerIdentity = {
    schemaVersion: "archcontext.runner-identity/v1",
    runnerId: input.runnerId,
    installationId: input.installationId,
    repositoryIds,
    scope,
    workflowRef: input.workflowRef,
    publicKeyId: input.publicKeyId,
    publicKeyFingerprint: input.publicKeyFingerprint,
    status: input.status,
    createdAt: input.createdAt,
    rotatedAt: input.rotatedAt ?? null,
    revokedAt: input.revokedAt ?? null
  };
  assertRunnerIdentity(identity);
  return identity;
}

export function assertRunnerIdentity(value: unknown): asserts value is RunnerIdentity {
  const record = requireRecord(value, "runner-identity");
  assertKnownRunnerIdentityKeys(record);
  if (record.schemaVersion !== "archcontext.runner-identity/v1") throw new Error("runner-identity-schemaVersion-invalid");
  const runnerId = requireRunnerId(record.runnerId);
  const installationId = requirePositiveInteger(record.installationId, "installationId", "runner-identity");
  const repositoryIds = normalizeRepositoryIds(readRepositoryIds(record.repositoryIds, "repositoryIds"));
  const scope = normalizeRunnerIdentityScope(record.scope === undefined ? { kind: "repository", repositoryIds } : record.scope);
  if (scope.kind === "repository" && repositoryIds.length === 0) throw new Error("runner-identity-repositoryIds-empty");
  if (scope.kind === "repository" && !sameNumberSet(repositoryIds, scope.repositoryIds)) {
    throw new Error("runner-identity-scope-repositoryIds-mismatch");
  }
  if (scope.kind === "organization" && repositoryIds.length !== 0) {
    throw new Error("runner-identity-organization-scope-repositoryIds-must-be-empty");
  }
  requireWorkflowRef(record.workflowRef);
  requireNonEmptyString(record.publicKeyId, "publicKeyId", "runner-identity");
  requireSha256Digest(record.publicKeyFingerprint, "publicKeyFingerprint", "runner-identity");
  const status = requireRunnerIdentityStatus(record.status);
  requireIsoTimestamp(record.createdAt, "createdAt", "runner-identity");
  const rotatedAt = readNullableIsoTimestamp(record.rotatedAt, "rotatedAt", "runner-identity");
  const revokedAt = readNullableIsoTimestamp(record.revokedAt, "revokedAt", "runner-identity");
  if (status === "rotating" && !rotatedAt) throw new Error("runner-identity-rotating-requires-rotatedAt");
  if (status === "revoked" && !revokedAt) throw new Error("runner-identity-revoked-requires-revokedAt");
  if (status !== "revoked" && revokedAt) throw new Error("runner-identity-active-revokedAt-invalid");
  if (!runnerId || installationId <= 0) throw new Error("runner-identity-invalid");
}

export function canTransitionRunnerIdentityStatus(from: RunnerIdentityStatus, to: RunnerIdentityStatus): boolean {
  return isRunnerIdentityStatus(from) && isRunnerIdentityStatus(to) && RUNNER_IDENTITY_STATUS_TRANSITIONS[from].includes(to);
}

export function assertCanTransitionRunnerIdentityStatus(from: RunnerIdentityStatus, to: RunnerIdentityStatus): void {
  if (!isRunnerIdentityStatus(from)) throw new Error(`runner-identity-status-invalid: ${String(from)}`);
  if (!isRunnerIdentityStatus(to)) throw new Error(`runner-identity-status-invalid: ${String(to)}`);
  if (!canTransitionRunnerIdentityStatus(from, to)) throw new Error(`runner-identity-transition-invalid: ${from}->${to}`);
}

export function transitionRunnerIdentityStatus(identity: RunnerIdentity, to: RunnerIdentityStatus, changedAt: string): RunnerIdentity {
  assertRunnerIdentity(identity);
  assertCanTransitionRunnerIdentityStatus(identity.status, to);
  requireIsoTimestamp(changedAt, "changedAt", "runner-identity");
  const next: RunnerIdentity = {
    ...identity,
    status: to,
    rotatedAt: to === "rotating" || (identity.status === "rotating" && to === "active") ? changedAt : identity.rotatedAt ?? null,
    revokedAt: to === "revoked" ? changedAt : null
  };
  assertRunnerIdentity(next);
  return next;
}

export function runnerIdentityMatchesScope(identity: RunnerIdentity, input: { installationId: number; repositoryId: number; workflowRef?: string }): boolean {
  assertRunnerIdentity(identity);
  const installationId = requirePositiveInteger(input.installationId, "installationId", "runner-identity-scope");
  const repositoryId = requirePositiveInteger(input.repositoryId, "repositoryId", "runner-identity-scope");
  if (identity.installationId !== installationId) return false;
  if (input.workflowRef !== undefined && identity.workflowRef !== input.workflowRef) return false;
  const scope = runnerIdentityEffectiveScope(identity);
  return scope.kind === "organization" || scope.repositoryIds.includes(repositoryId);
}

export function runnerIdentityEffectiveScope(identity: RunnerIdentity): RunnerIdentityScope {
  assertRunnerIdentity(identity);
  return identity.scope ?? { kind: "repository", repositoryIds: normalizeRepositoryIds(identity.repositoryIds) };
}

export function runnerIdentityKeyStatus(identity: RunnerIdentity): GovernanceKeyStatus {
  assertRunnerIdentity(identity);
  return {
    schemaVersion: "archcontext.governance-key-status/v1",
    publicKeyId: identity.publicKeyId,
    ownerKind: "runner",
    ownerId: identity.runnerId,
    fingerprint: identity.publicKeyFingerprint,
    status: identity.status,
    createdAt: identity.createdAt,
    rotatedAt: identity.rotatedAt ?? null,
    revokedAt: identity.revokedAt ?? null
  };
}

export function satisfiesRequiredTrust(attestationTrustLevel: GovernanceTrustLevel, requiredTrust: RequiredTrust): boolean {
  if (requiredTrust === "organization") return attestationTrustLevel === "organization";
  return attestationTrustLevel === "developer" || attestationTrustLevel === "organization";
}

function isReviewChallengeStatus(value: unknown): value is ReviewChallengeStatus {
  return typeof value === "string" && value in CHALLENGE_STATUS_TRANSITIONS;
}

function isRunnerIdentityStatus(value: unknown): value is RunnerIdentityStatus {
  return typeof value === "string" && value in RUNNER_IDENTITY_STATUS_TRANSITIONS;
}

function normalizeRunnerIdentityScope(value: unknown): RunnerIdentityScope {
  const record = requireRecord(value, "runner-identity-scope");
  const kind = requireNonEmptyString(record.kind, "kind", "runner-identity-scope");
  if (kind === "organization") {
    assertKnownKeys(record, new Set(["kind"]), "runner-identity-scope");
    return { kind: "organization" };
  }
  if (kind === "repository") {
    assertKnownKeys(record, new Set(["kind", "repositoryIds"]), "runner-identity-scope");
    const repositoryIds = normalizeRepositoryIds(readRepositoryIds(record.repositoryIds, "scope.repositoryIds"));
    if (repositoryIds.length === 0) throw new Error("runner-identity-scope-repositoryIds-empty");
    return { kind: "repository", repositoryIds };
  }
  throw new Error("runner-identity-scope-kind-invalid");
}

function normalizeRepositoryIds(value: number[]): number[] {
  const ids = [...new Set(value)].sort((a, b) => a - b);
  return ids;
}

function readRepositoryIds(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) throw new Error(`runner-identity-${label}-invalid`);
  return value.map((item, index) => requirePositiveInteger(item, `${label}[${index}]`, "runner-identity"));
}

function sameNumberSet(a: number[], b: number[]): boolean {
  const left = normalizeRepositoryIds(a);
  const right = normalizeRepositoryIds(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertKnownRunnerIdentityKeys(record: Record<string, unknown>): void {
  assertKnownKeys(record, new Set([
    "schemaVersion",
    "runnerId",
    "installationId",
    "repositoryIds",
    "scope",
    "workflowRef",
    "publicKeyId",
    "publicKeyFingerprint",
    "status",
    "createdAt",
    "rotatedAt",
    "revokedAt"
  ]), "runner-identity");
}

function assertKnownKeys(record: Record<string, unknown>, allowed: Set<string>, prefix: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`${prefix}-unknown-field: ${key}`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}-invalid`);
  return value as Record<string, unknown>;
}

function requireRunnerId(value: unknown): string {
  const text = requireNonEmptyString(value, "runnerId", "runner-identity");
  if (!/^runner_[A-Za-z0-9_.-]+$/.test(text)) throw new Error("runner-identity-runnerId-invalid");
  return text;
}

function requireWorkflowRef(value: unknown): string {
  const text = requireNonEmptyString(value, "workflowRef", "runner-identity");
  if (!/^[^/\s]+\/[^/\s]+\/\.github\/workflows\/[^@\s]+@refs\/(heads|tags)\/[^@\s]+$/.test(text) && !/^[^/\s]+\/[^/\s]+\/\.github\/workflows\/[^@\s]+@[a-f0-9]{40}$/i.test(text)) {
    throw new Error("runner-identity-workflowRef-invalid");
  }
  return text;
}

function requirePositiveInteger(value: unknown, label: string, prefix: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${prefix}-${label}-invalid`);
  return Number(value);
}

function requireNonEmptyString(value: unknown, label: string, prefix: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${prefix}-${label}-invalid`);
  return value;
}

function requireSha256Digest(value: unknown, label: string, prefix: string): string {
  const text = requireNonEmptyString(value, label, prefix);
  if (!/^sha256:[a-f0-9]{64}$/.test(text)) throw new Error(`${prefix}-${label}-invalid`);
  return text;
}

function requireRunnerIdentityStatus(value: unknown): RunnerIdentityStatus {
  if (!isRunnerIdentityStatus(value)) throw new Error("runner-identity-status-invalid");
  return value;
}

function requireIsoTimestamp(value: unknown, label: string, prefix: string): string {
  const text = requireNonEmptyString(value, label, prefix);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${prefix}-${label}-invalid`);
  return text;
}

function readNullableIsoTimestamp(value: unknown, label: string, prefix: string): string | null {
  if (value === undefined || value === null) return null;
  return requireIsoTimestamp(value, label, prefix);
}
