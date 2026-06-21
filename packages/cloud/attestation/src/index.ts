import { createHash, sign, verify, type KeyObject } from "node:crypto";
import {
  canonicalize,
  digestJson,
  runnerIdentityMatchesScope,
  satisfiesRequiredTrust,
  type AttestationResult,
  type AttestationV2,
  type GovernanceReasonCode,
  type GovernanceKeyStatus,
  type Json,
  type RunnerIdentity,
  type RequiredTrust,
  type ReviewChallengeStatus,
  type ReviewChallengeV2
} from "@archcontext/contracts";

export type TrustLevel = "developer" | "organization";

export interface ReviewChallenge {
  challengeId: string;
  repository: { provider: "github"; owner: string; name: string; visibility: "public" | "private" };
  headSha: string;
  nonce: string;
  expiresAt: string;
  consumed: boolean;
}

export type CreateReviewChallengeV2Input = Omit<ReviewChallengeV2, "schemaVersion" | "challengeId" | "status"> & {
  challengeId?: string;
  status?: ReviewChallengeStatus;
};

export type CreateAttestationV2Input = Omit<AttestationV2, "schemaVersion" | "attestationId" | "signature"> & {
  attestationId?: string;
  signature?: AttestationV2["signature"];
};

export interface LegacyAttestationMigrationRecord {
  schemaVersion: "archcontext.attestation-migration/v1";
  sourceSchemaVersion: "archcontext.attestation/v1";
  targetSchemaVersion: "archcontext.attestation/v2";
  originalAttestationId: string;
  originalChallengeId: string;
  migrationStatus: "legacy-audit-only";
  requiredCheckEligible: false;
  rejectionReasonCode: Extract<GovernanceReasonCode, "ATTESTATION_SCHEMA_UNSUPPORTED">;
  headSha: string;
  worktreeDigest: string;
  reviewDigest: string;
  trustLevel: TrustLevel;
  principalId: string;
  publicKeyId: string;
  issuedAt: string;
  expiresAt: string;
  migratedAt: string;
}

export type AttestationChallengeEvaluation =
  | { accepted: true; attestation: AttestationV2 }
  | { accepted: false; reasonCode: GovernanceReasonCode };

export type AttestationV2ServerVerification =
  | { accepted: true; attestation: AttestationV2; attestationDigest: string }
  | { accepted: false; reasonCode: GovernanceReasonCode };

export interface LocalAttestation {
  schemaVersion: "archcontext.attestation/v1";
  attestationId: string;
  challengeId: string;
  repository: ReviewChallenge["repository"];
  headSha: string;
  worktreeDigest: string;
  reviewDigest: string;
  device: { deviceId: string; publicKeyId: string };
  issuedAt: string;
  expiresAt: string;
  trustLevel: TrustLevel;
  signature: { alg: "ed25519"; value: string };
  extensions?: Record<string, Json>;
}

export interface OrgRunnerIdentity {
  schemaVersion: "archcontext.org-runner-identity/v1";
  runnerId: string;
  installationId: number;
  repositoryNumericIds?: number[];
  publicKeyId: string;
  publicKeyFingerprint: string;
  status: "active" | "revoked";
  createdAt: string;
  rotatedAt?: string;
  revokedAt?: string;
  extensions?: Record<string, Json>;
}

export function publicKeyFingerprint(publicKey: KeyObject): string {
  if (publicKey.type !== "public") throw new Error("public-key-required");
  const der = publicKey.export({ format: "der", type: "spki" });
  return `sha256:${createHash("sha256").update(der).digest("hex")}`;
}

export function createReviewChallenge(input: Omit<ReviewChallenge, "challengeId" | "nonce" | "consumed">): ReviewChallenge {
  const nonce = digestJson({ repo: input.repository, headSha: input.headSha, expiresAt: input.expiresAt });
  return {
    ...input,
    challengeId: `challenge_${nonce.slice(-16)}`,
    nonce,
    consumed: false
  };
}

export function createReviewChallengeV2(input: CreateReviewChallengeV2Input): ReviewChallengeV2 {
  const challenge = {
    schemaVersion: "archcontext.review-challenge/v2",
    challengeId: input.challengeId ?? reviewChallengeV2Id(input),
    installationId: input.installationId,
    repositoryId: input.repositoryId,
    pullRequestNumber: input.pullRequestNumber,
    headSha: input.headSha,
    baseSha: input.baseSha,
    nonce: input.nonce,
    requiredTrust: input.requiredTrust,
    policyProfileId: input.policyProfileId,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    status: input.status ?? "PENDING"
  } satisfies ReviewChallengeV2;
  assertReviewChallengeV2(challenge);
  return challenge;
}

export function canonicalReviewChallengeV2(challenge: ReviewChallengeV2): string {
  assertReviewChallengeV2(challenge);
  return canonicalize(challenge as unknown as Json);
}

export function reviewChallengeV2Digest(challenge: ReviewChallengeV2): string {
  assertReviewChallengeV2(challenge);
  return digestJson(challenge as unknown as Json);
}

export function assertReviewChallengeV2(value: unknown): asserts value is ReviewChallengeV2 {
  const record = requireRecord(value, "review-challenge-v2");
  const keys = Object.keys(record).sort();
  const unexpected = keys.filter((key) => !REVIEW_CHALLENGE_V2_KEYS.has(key));
  if (unexpected.length > 0) {
    const privateKey = unexpected.find((key) => PRIVATE_CONTENT_KEYS.has(key));
    if (privateKey) throw new Error(`review-challenge-v2-private-content: ${privateKey}`);
    throw new Error(`review-challenge-v2-unknown-field: ${unexpected[0]}`);
  }
  for (const key of REVIEW_CHALLENGE_V2_KEYS) {
    if (!(key in record)) throw new Error(`review-challenge-v2-missing-field: ${key}`);
  }
  if (record.schemaVersion !== "archcontext.review-challenge/v2") throw new Error("review-challenge-v2-schema-version-invalid");
  requirePositiveInteger(record.installationId, "installationId");
  requirePositiveInteger(record.repositoryId, "repositoryId");
  requirePositiveInteger(record.pullRequestNumber, "pullRequestNumber");
  requireString(record.challengeId, "challengeId");
  requireHexOid(record.headSha, "headSha");
  requireHexOid(record.baseSha, "baseSha");
  requireString(record.nonce, "nonce");
  requireTrust(record.requiredTrust);
  requireString(record.policyProfileId, "policyProfileId");
  requireStatus(record.status);
  const createdAt = requireIsoInstant(record.createdAt, "createdAt");
  const expiresAt = requireIsoInstant(record.expiresAt, "expiresAt");
  if (expiresAt <= createdAt) throw new Error("review-challenge-v2-expiry-invalid");
}

export function createAttestationV2(input: CreateAttestationV2Input): AttestationV2 {
  const attestation = {
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
  } satisfies AttestationV2;
  assertAttestationV2(attestation);
  return attestation;
}

export function unsignedAttestationV2(attestation: AttestationV2): AttestationV2 {
  assertAttestationV2(attestation);
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

export function assertAttestationV2(value: unknown): asserts value is AttestationV2 {
  const record = requireRecord(value, "attestation-v2");
  assertKnownKeys(record, ATTESTATION_V2_KEYS, "attestation-v2");
  for (const key of ATTESTATION_V2_REQUIRED_KEYS) {
    if (!(key in record)) throw new Error(`attestation-v2-missing-field: ${key}`);
  }
  if (record.schemaVersion !== "archcontext.attestation/v2") throw new Error("attestation-v2-schema-version-invalid");
  requireString(record.attestationId, "attestationId", "attestation-v2");
  requireString(record.challengeId, "challengeId", "attestation-v2");
  requirePositiveInteger(record.installationId, "installationId", "attestation-v2");
  requirePositiveInteger(record.repositoryId, "repositoryId", "attestation-v2");
  requirePositiveInteger(record.pullRequestNumber, "pullRequestNumber", "attestation-v2");
  requireHexOid(record.headSha, "headSha", "attestation-v2");
  requireHexOid(record.baseSha, "baseSha", "attestation-v2");
  requireHexOid(record.mergeBaseSha, "mergeBaseSha", "attestation-v2");
  requireString(record.headTreeOid, "headTreeOid", "attestation-v2");
  requireDigest(record.worktreeDigest, "worktreeDigest");
  requireDigest(record.modelDigest, "modelDigest");
  requireDigest(record.policyDigest, "policyDigest");
  requireDigest(record.codeFactsDigest, "codeFactsDigest");
  requireDigest(record.reviewDigest, "reviewDigest");
  const result = requireAttestationResult(record.result);
  if (result === "error") {
    requireAttestationErrorCode(record.errorCode);
  } else if ("errorCode" in record) {
    throw new Error("attestation-v2-errorCode-unexpected");
  }
  const execution = requireAttestationV2Execution(record.execution);
  requireAttestationV2Runtime(record.runtime);
  requireString(record.nonce, "nonce", "attestation-v2");
  const startedAt = requireIsoInstant(record.startedAt, "startedAt", "attestation-v2");
  const completedAt = requireIsoInstant(record.completedAt, "completedAt", "attestation-v2");
  const expiresAt = requireIsoInstant(record.expiresAt, "expiresAt", "attestation-v2");
  if (completedAt < startedAt) throw new Error("attestation-v2-completedAt-invalid");
  if (expiresAt <= completedAt) throw new Error("attestation-v2-expiry-invalid");
  requireAttestationV2Signature(record.signature);
  if (
    (execution.trustLevel === "developer" && execution.source !== "clean-commit-worktree")
    || (execution.trustLevel === "organization" && execution.source !== "organization-runner-checkout")
  ) {
    throw new Error("attestation-v2-execution-source-trust-mismatch");
  }
}

export function isLocalAttestationV1(value: unknown): value is LocalAttestation {
  return typeof value === "object" && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === "archcontext.attestation/v1";
}

export function assertLocalAttestationV1(value: unknown): asserts value is LocalAttestation {
  const record = requireRecord(value, "attestation-v1");
  assertKnownKeys(record, LOCAL_ATTESTATION_V1_KEYS, "attestation-v1");
  for (const key of LOCAL_ATTESTATION_V1_REQUIRED_KEYS) {
    if (!(key in record)) throw new Error(`attestation-v1-missing-field: ${key}`);
  }
  if (record.schemaVersion !== "archcontext.attestation/v1") throw new Error("attestation-v1-schema-version-invalid");
  requireString(record.attestationId, "attestationId", "attestation-v1");
  requireString(record.challengeId, "challengeId", "attestation-v1");
  requireRepository(record.repository);
  requireString(record.headSha, "headSha", "attestation-v1");
  requireDigest(record.worktreeDigest, "worktreeDigest", "attestation-v1");
  requireDigest(record.reviewDigest, "reviewDigest", "attestation-v1");
  const device = requireRecord(record.device, "attestation-v1-device");
  requireString(device.deviceId, "deviceId", "attestation-v1-device");
  requireString(device.publicKeyId, "publicKeyId", "attestation-v1-device");
  const issuedAt = requireIsoInstant(record.issuedAt, "issuedAt", "attestation-v1");
  const expiresAt = requireIsoInstant(record.expiresAt, "expiresAt", "attestation-v1");
  if (expiresAt <= issuedAt) throw new Error("attestation-v1-expiry-invalid");
  requireTrust(record.trustLevel);
  const signature = requireRecord(record.signature, "attestation-v1-signature");
  if (signature.alg !== "ed25519") throw new Error("attestation-v1-signature-alg-invalid");
  requireString(signature.value, "value", "attestation-v1-signature");
}

export function migrateLocalAttestationV1ToAuditRecord(input: {
  attestation: LocalAttestation;
  migratedAt: string;
}): LegacyAttestationMigrationRecord {
  assertLocalAttestationV1(input.attestation);
  requireIsoInstant(input.migratedAt, "migratedAt", "attestation-migration");
  return {
    schemaVersion: "archcontext.attestation-migration/v1",
    sourceSchemaVersion: "archcontext.attestation/v1",
    targetSchemaVersion: "archcontext.attestation/v2",
    originalAttestationId: input.attestation.attestationId,
    originalChallengeId: input.attestation.challengeId,
    migrationStatus: "legacy-audit-only",
    requiredCheckEligible: false,
    rejectionReasonCode: "ATTESTATION_SCHEMA_UNSUPPORTED",
    headSha: input.attestation.headSha,
    worktreeDigest: input.attestation.worktreeDigest,
    reviewDigest: input.attestation.reviewDigest,
    trustLevel: input.attestation.trustLevel,
    principalId: input.attestation.device.deviceId,
    publicKeyId: input.attestation.device.publicKeyId,
    issuedAt: input.attestation.issuedAt,
    expiresAt: input.attestation.expiresAt,
    migratedAt: input.migratedAt
  };
}

export function evaluateAttestationForReviewChallenge(input: {
  attestation: unknown;
  challenge: ReviewChallengeV2;
}): AttestationChallengeEvaluation {
  assertReviewChallengeV2(input.challenge);
  if (isLocalAttestationV1(input.attestation)) return { accepted: false, reasonCode: "ATTESTATION_SCHEMA_UNSUPPORTED" };
  try {
    assertAttestationV2(input.attestation);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { accepted: false, reasonCode: message.includes("private-content") ? "PAYLOAD_PRIVACY_VIOLATION" : "ATTESTATION_SCHEMA_UNSUPPORTED" };
  }
  const attestation = input.attestation;
  if (attestation.challengeId !== input.challenge.challengeId) return { accepted: false, reasonCode: "CHALLENGE_NOT_FOUND" };
  if (attestation.installationId !== input.challenge.installationId) return { accepted: false, reasonCode: "REPOSITORY_MISMATCH" };
  if (attestation.repositoryId !== input.challenge.repositoryId) return { accepted: false, reasonCode: "REPOSITORY_MISMATCH" };
  if (attestation.pullRequestNumber !== input.challenge.pullRequestNumber) return { accepted: false, reasonCode: "PULL_REQUEST_MISMATCH" };
  if (attestation.headSha !== input.challenge.headSha) return { accepted: false, reasonCode: "HEAD_SHA_MISMATCH" };
  if (attestation.baseSha !== input.challenge.baseSha) return { accepted: false, reasonCode: "BASE_SHA_MISMATCH" };
  if (attestation.nonce !== input.challenge.nonce) return { accepted: false, reasonCode: "NONCE_MISMATCH" };
  if (!satisfiesRequiredTrust(attestation.execution.trustLevel, input.challenge.requiredTrust)) {
    return { accepted: false, reasonCode: "TRUST_LEVEL_MISMATCH" };
  }
  return { accepted: true, attestation };
}

export function verifyAttestationV2ForReviewChallenge(input: {
  attestation: unknown;
  challenge: ReviewChallengeV2;
  publicKey: KeyObject;
  now: string;
  runnerIdentity?: RunnerIdentity;
  signingKeyStatus?: GovernanceKeyStatus;
  expectedHeadTreeOid?: string;
}): AttestationV2ServerVerification {
  const evaluated = evaluateAttestationForReviewChallenge({
    challenge: input.challenge,
    attestation: input.attestation
  });
  if (!evaluated.accepted) return evaluated;
  const attestation = evaluated.attestation;
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) return { accepted: false, reasonCode: "ATTESTATION_SCHEMA_UNSUPPORTED" };
  const challengeExpiresAtMs = Date.parse(input.challenge.expiresAt);
  const attestationExpiresAtMs = Date.parse(attestation.expiresAt);
  const attestationCompletedAtMs = Date.parse(attestation.completedAt);
  if (
    input.challenge.status === "EXPIRED"
    || challengeExpiresAtMs <= nowMs
    || attestationExpiresAtMs <= nowMs
    || attestationCompletedAtMs > challengeExpiresAtMs
  ) {
    return { accepted: false, reasonCode: "CHALLENGE_EXPIRED" };
  }
  if (input.expectedHeadTreeOid && attestation.headTreeOid !== input.expectedHeadTreeOid) {
    return { accepted: false, reasonCode: "TREE_OID_MISMATCH" };
  }
  const runnerVerification = verifyOrganizationRunnerIdentityForAttestation({
    attestation,
    challenge: input.challenge,
    runnerIdentity: input.runnerIdentity,
    signingKeyStatus: input.signingKeyStatus
  });
  if (!runnerVerification.accepted) return runnerVerification;
  if (input.signingKeyStatus) {
    if (input.signingKeyStatus.status === "revoked") {
      return { accepted: false, reasonCode: input.signingKeyStatus.ownerKind === "runner" ? "RUNNER_REVOKED" : "DEVICE_REVOKED" };
    }
    if (input.signingKeyStatus.publicKeyId !== attestation.execution.publicKeyId) {
      return { accepted: false, reasonCode: "SIGNATURE_INVALID" };
    }
  }
  if (hasZeroDigest(attestation)) return { accepted: false, reasonCode: "DIGEST_INVALID" };
  if (input.publicKey.type !== "public") return { accepted: false, reasonCode: "SIGNATURE_INVALID" };
  let ok = false;
  try {
    ok = verify(
      null,
      Buffer.from(canonicalAttestationV2(attestation), "utf8"),
      input.publicKey,
      Buffer.from(attestation.signature.value, "base64")
    );
  } catch {
    return { accepted: false, reasonCode: "SIGNATURE_INVALID" };
  }
  if (!ok) return { accepted: false, reasonCode: "SIGNATURE_INVALID" };
  return {
    accepted: true,
    attestation,
    attestationDigest: attestationV2Digest(attestation)
  };
}

function verifyOrganizationRunnerIdentityForAttestation(input: {
  attestation: AttestationV2;
  challenge: ReviewChallengeV2;
  runnerIdentity?: RunnerIdentity;
  signingKeyStatus?: GovernanceKeyStatus;
}): { accepted: true } | { accepted: false; reasonCode: GovernanceReasonCode } {
  if (input.attestation.execution.trustLevel !== "organization") return { accepted: true };
  if (input.challenge.requiredTrust !== "organization") return { accepted: false, reasonCode: "TRUST_LEVEL_MISMATCH" };
  if (!input.runnerIdentity) return { accepted: false, reasonCode: "RUNNER_NOT_FOUND" };
  const execution = input.attestation.execution;
  if (input.runnerIdentity.runnerId !== execution.runnerId) return { accepted: false, reasonCode: "RUNNER_NOT_FOUND" };
  if (input.runnerIdentity.publicKeyId !== execution.publicKeyId) return { accepted: false, reasonCode: "SIGNATURE_INVALID" };
  if (input.runnerIdentity.status !== "active") return { accepted: false, reasonCode: "RUNNER_REVOKED" };
  if (!runnerIdentityMatchesScope(input.runnerIdentity, {
    installationId: input.challenge.installationId,
    repositoryId: input.challenge.repositoryId,
    workflowRef: execution.workflowRef
  })) {
    return { accepted: false, reasonCode: "RUNNER_SCOPE_MISMATCH" };
  }
  if (!input.signingKeyStatus) return { accepted: false, reasonCode: "RUNNER_NOT_FOUND" };
  if (input.signingKeyStatus.ownerKind !== "runner" || input.signingKeyStatus.ownerId !== execution.runnerId) {
    return { accepted: false, reasonCode: "SIGNATURE_INVALID" };
  }
  return { accepted: true };
}

export function signLocalAttestation(input: {
  challenge: ReviewChallenge;
  worktreeDigest: string;
  reviewDigest: string;
  deviceId: string;
  publicKeyId: string;
  privateKey: KeyObject;
  issuedAt: string;
}): LocalAttestation {
  return signAttestation({
    challenge: input.challenge,
    worktreeDigest: input.worktreeDigest,
    reviewDigest: input.reviewDigest,
    deviceId: input.deviceId,
    publicKeyId: input.publicKeyId,
    privateKey: input.privateKey,
    issuedAt: input.issuedAt,
    trustLevel: "developer"
  });
}

export function signOrganizationAttestation(input: {
  challenge: ReviewChallenge;
  worktreeDigest: string;
  reviewDigest: string;
  runner: OrgRunnerIdentity;
  privateKey: KeyObject;
  issuedAt: string;
  repositoryNumericId?: number;
}): LocalAttestation {
  return signAttestation({
    challenge: input.challenge,
    worktreeDigest: input.worktreeDigest,
    reviewDigest: input.reviewDigest,
    deviceId: input.runner.runnerId,
    publicKeyId: input.runner.publicKeyId,
    privateKey: input.privateKey,
    issuedAt: input.issuedAt,
    trustLevel: "organization",
    extensions: {
      runnerId: input.runner.runnerId,
      installationId: input.runner.installationId,
      repositoryNumericId: input.repositoryNumericId ?? null
    }
  });
}

export function signOrganizationAttestationV2(input: {
  challenge: ReviewChallengeV2;
  runner: RunnerIdentity;
  privateKey: KeyObject;
  mergeBaseSha: string;
  headTreeOid: string;
  worktreeDigest: string;
  modelDigest: string;
  policyDigest: string;
  codeFactsDigest: string;
  reviewDigest: string;
  result: AttestationResult;
  runtime: AttestationV2["runtime"];
  workflowRef: string;
  runId: string;
  runAttempt: number;
  startedAt: string;
  completedAt: string;
}): AttestationV2 {
  if (input.challenge.requiredTrust !== "organization") throw new Error("organization-attestation-v2-requiredTrust-required");
  if (input.runner.installationId !== input.challenge.installationId) throw new Error("organization-attestation-v2-installation-mismatch");
  if (input.runner.workflowRef !== input.workflowRef) throw new Error("organization-attestation-v2-workflowRef-mismatch");
  const unsigned = createAttestationV2({
    challengeId: input.challenge.challengeId,
    installationId: input.challenge.installationId,
    repositoryId: input.challenge.repositoryId,
    pullRequestNumber: input.challenge.pullRequestNumber,
    headSha: input.challenge.headSha,
    baseSha: input.challenge.baseSha,
    mergeBaseSha: input.mergeBaseSha,
    headTreeOid: input.headTreeOid,
    worktreeDigest: input.worktreeDigest,
    modelDigest: input.modelDigest,
    policyDigest: input.policyDigest,
    codeFactsDigest: input.codeFactsDigest,
    reviewDigest: input.reviewDigest,
    result: input.result,
    execution: {
      trustLevel: "organization",
      source: "organization-runner-checkout",
      principalId: input.runner.runnerId,
      publicKeyId: input.runner.publicKeyId,
      runnerId: input.runner.runnerId,
      workflowRef: input.workflowRef,
      runId: input.runId,
      runAttempt: input.runAttempt
    },
    runtime: input.runtime,
    nonce: input.challenge.nonce,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    expiresAt: input.challenge.expiresAt
  });
  return createAttestationV2({
    ...unsigned,
    signature: {
      algorithm: "ed25519",
      value: sign(null, Buffer.from(canonicalAttestationV2(unsigned), "utf8"), input.privateKey).toString("base64")
    }
  });
}

export function verifyLocalAttestation(input: {
  challenge: ReviewChallenge;
  attestation: LocalAttestation;
  publicKey: KeyObject;
  now: string;
  expectedRepository: ReviewChallenge["repository"];
  expectedHeadSha: string;
  expectedTrustLevel?: TrustLevel;
  orgRunner?: OrgRunnerIdentity;
  expectedInstallationId?: number;
}): { accepted: boolean; reason?: string; challenge?: ReviewChallenge } {
  if (input.challenge.consumed) return { accepted: false, reason: "challenge-already-consumed" };
  if (input.challenge.expiresAt <= input.now || input.attestation.expiresAt <= input.now) return { accepted: false, reason: "attestation-expired" };
  if (input.attestation.challengeId !== input.challenge.challengeId) return { accepted: false, reason: "challenge-mismatch" };
  if (input.attestation.headSha !== input.expectedHeadSha || input.challenge.headSha !== input.expectedHeadSha) return { accepted: false, reason: "head-sha-mismatch" };
  if (input.expectedTrustLevel && input.attestation.trustLevel !== input.expectedTrustLevel) return { accepted: false, reason: "trust-level-mismatch" };
  if (JSON.stringify(input.attestation.repository) !== JSON.stringify(input.expectedRepository)) return { accepted: false, reason: "repository-mismatch" };
  const orgCheck = verifyOrganizationRunnerBinding(input.attestation, input.orgRunner, input.expectedInstallationId);
  if (!orgCheck.accepted) return orgCheck;
  const unsigned = unsignedPayload(input.attestation);
  const ok = verify(null, Buffer.from(canonicalAttestation(unsigned), "utf8"), input.publicKey, Buffer.from(input.attestation.signature.value, "base64"));
  if (!ok) return { accepted: false, reason: "signature-invalid" };
  return { accepted: true, challenge: { ...input.challenge, consumed: true } };
}

export function attestationDigest(attestation: LocalAttestation): string {
  return digestJson(unsignedPayload(attestation) as unknown as Json);
}

export function attestationLabel(trustLevel: TrustLevel): "Developer-attested" | "Organization-attested" {
  return trustLevel === "organization" ? "Organization-attested" : "Developer-attested";
}

export function deviceIntegritySignals(input: { trustLevel: TrustLevel; runnerControlled?: boolean; deviceRevoked?: boolean }) {
  return {
    bestEffort: true,
    signals: [
      input.trustLevel === "organization" && input.runnerControlled ? "customer-controlled-runner" : "developer-device",
      input.deviceRevoked ? "device-revoked" : "device-not-revoked"
    ],
    limitation: "organization attestation raises provenance but does not prove an untampered environment"
  };
}

function signAttestation(input: {
  challenge: ReviewChallenge;
  worktreeDigest: string;
  reviewDigest: string;
  deviceId: string;
  publicKeyId: string;
  privateKey: KeyObject;
  issuedAt: string;
  trustLevel: TrustLevel;
  extensions?: Record<string, Json>;
}): LocalAttestation {
  const unsigned = unsignedPayload({
    schemaVersion: "archcontext.attestation/v1",
    attestationId: `att_${createHash("sha256")
      .update(input.challenge.challengeId + input.reviewDigest + input.trustLevel)
      .digest("hex")
      .slice(0, 16)}`,
    challengeId: input.challenge.challengeId,
    repository: input.challenge.repository,
    headSha: input.challenge.headSha,
    worktreeDigest: input.worktreeDigest,
    reviewDigest: input.reviewDigest,
    device: { deviceId: input.deviceId, publicKeyId: input.publicKeyId },
    issuedAt: input.issuedAt,
    expiresAt: input.challenge.expiresAt,
    trustLevel: input.trustLevel,
    signature: { alg: "ed25519", value: "" },
    extensions: input.extensions
  });
  return {
    ...unsigned,
    signature: {
      alg: "ed25519",
      value: sign(null, Buffer.from(canonicalAttestation(unsigned), "utf8"), input.privateKey).toString("base64")
    }
  };
}

function unsignedPayload(attestation: LocalAttestation): LocalAttestation {
  return { ...attestation, signature: { alg: "ed25519", value: "" } };
}

function canonicalAttestation(attestation: LocalAttestation): string {
  return canonicalize(unsignedPayload(attestation) as unknown as Json);
}

function verifyOrganizationRunnerBinding(
  attestation: LocalAttestation,
  orgRunner?: OrgRunnerIdentity,
  expectedInstallationId?: number
): { accepted: boolean; reason?: string } {
  if (attestation.trustLevel !== "organization") return { accepted: true };
  if (!orgRunner) return { accepted: false, reason: "org-runner-required" };
  if (orgRunner.status !== "active") return { accepted: false, reason: "org-runner-revoked" };
  if (attestation.device.deviceId !== orgRunner.runnerId || attestation.device.publicKeyId !== orgRunner.publicKeyId) {
    return { accepted: false, reason: "org-runner-key-mismatch" };
  }
  if (expectedInstallationId && orgRunner.installationId !== expectedInstallationId) return { accepted: false, reason: "installation-mismatch" };
  if (expectedInstallationId && attestation.extensions?.installationId !== expectedInstallationId) {
    return { accepted: false, reason: "installation-mismatch" };
  }
  return { accepted: true };
}

const REVIEW_CHALLENGE_V2_KEYS = new Set([
  "schemaVersion",
  "challengeId",
  "installationId",
  "repositoryId",
  "pullRequestNumber",
  "headSha",
  "baseSha",
  "nonce",
  "requiredTrust",
  "policyProfileId",
  "createdAt",
  "expiresAt",
  "status"
]);

const REVIEW_CHALLENGE_STATUSES = new Set<ReviewChallengeStatus>([
  "PENDING",
  "LEASED",
  "SUBMITTED",
  "VERIFIED",
  "REJECTED",
  "SUPERSEDED",
  "EXPIRED"
]);

const TRUST_LEVELS = new Set<RequiredTrust>(["developer", "organization"]);

const LOCAL_ATTESTATION_V1_REQUIRED_KEYS = new Set([
  "schemaVersion",
  "attestationId",
  "challengeId",
  "repository",
  "headSha",
  "worktreeDigest",
  "reviewDigest",
  "device",
  "issuedAt",
  "expiresAt",
  "trustLevel",
  "signature"
]);

const LOCAL_ATTESTATION_V1_KEYS = new Set([...LOCAL_ATTESTATION_V1_REQUIRED_KEYS, "extensions"]);

const ATTESTATION_V2_REQUIRED_KEYS = new Set([
  "schemaVersion",
  "attestationId",
  "challengeId",
  "installationId",
  "repositoryId",
  "pullRequestNumber",
  "headSha",
  "baseSha",
  "mergeBaseSha",
  "headTreeOid",
  "worktreeDigest",
  "modelDigest",
  "policyDigest",
  "codeFactsDigest",
  "reviewDigest",
  "result",
  "execution",
  "runtime",
  "nonce",
  "startedAt",
  "completedAt",
  "expiresAt",
  "signature"
]);

const ATTESTATION_V2_KEYS = new Set([...ATTESTATION_V2_REQUIRED_KEYS, "errorCode"]);

const ATTESTATION_RESULTS = new Set<AttestationResult>(["pass", "fail", "error"]);

const ATTESTATION_ERROR_CODES = new Set([
  "RUNTIME_VERSION_UNSUPPORTED",
  "HEAD_UNAVAILABLE",
  "WORKTREE_NOT_CLEAN",
  "CODEGRAPH_FAILED",
  "POLICY_INVALID",
  "REVIEW_INCOMPLETE"
]);

const ATTESTATION_EXECUTION_REQUIRED_KEYS = new Set([
  "trustLevel",
  "source",
  "principalId",
  "publicKeyId"
]);

const ATTESTATION_ORGANIZATION_EXECUTION_KEYS = new Set([
  "runnerId",
  "workflowRef",
  "runId",
  "runAttempt"
]);

const ATTESTATION_EXECUTION_KEYS = new Set([
  ...ATTESTATION_EXECUTION_REQUIRED_KEYS,
  ...ATTESTATION_ORGANIZATION_EXECUTION_KEYS
]);

const ATTESTATION_EXECUTION_SOURCES = new Set([
  "clean-commit-worktree",
  "organization-runner-checkout"
]);

const ATTESTATION_RUNTIME_KEYS = new Set([
  "version",
  "buildDigest",
  "codeGraphVersion",
  "capabilitiesDigest"
]);

const ATTESTATION_SIGNATURE_KEYS = new Set([
  "algorithm",
  "value"
]);

const PRIVATE_CONTENT_KEYS = new Set([
  "source",
  "sourceCode",
  "diff",
  "patch",
  "filename",
  "fileName",
  "filePath",
  "commitMessage",
  "pullRequestBody",
  "architectureModel",
  "finding",
  "symbol",
  "rawBody",
  "requestBody",
  "responseBody"
]);

function reviewChallengeV2Id(input: Omit<CreateReviewChallengeV2Input, "challengeId" | "status">): string {
  const digest = digestJson({
    schemaVersion: "archcontext.review-challenge/v2",
    installationId: input.installationId,
    repositoryId: input.repositoryId,
    pullRequestNumber: input.pullRequestNumber,
    headSha: input.headSha,
    baseSha: input.baseSha,
    nonce: input.nonce,
    requiredTrust: input.requiredTrust,
    policyProfileId: input.policyProfileId,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt
  });
  return `chal_${digest.slice("sha256:".length, "sha256:".length + 16)}`;
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

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}-invalid`);
  return value as Record<string, unknown>;
}

function assertKnownKeys(record: Record<string, unknown>, allowed: Set<string>, prefix: string): void {
  const unexpected = Object.keys(record).sort().filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    const privateKey = unexpected.find((key) => PRIVATE_CONTENT_KEYS.has(key));
    if (privateKey) throw new Error(`${prefix}-private-content: ${privateKey}`);
    throw new Error(`${prefix}-unknown-field: ${unexpected[0]}`);
  }
}

function requirePositiveInteger(value: unknown, label: string, prefix = "review-challenge-v2"): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${prefix}-${label}-invalid`);
  }
  return value;
}

function requireString(value: unknown, label: string, prefix = "review-challenge-v2"): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${prefix}-${label}-invalid`);
  }
  return value;
}

function requireRepository(value: unknown): ReviewChallenge["repository"] {
  const record = requireRecord(value, "attestation-v1-repository");
  if (record.provider !== "github") throw new Error("attestation-v1-repository-provider-invalid");
  requireString(record.owner, "owner", "attestation-v1-repository");
  requireString(record.name, "name", "attestation-v1-repository");
  if (record.visibility !== "public" && record.visibility !== "private") throw new Error("attestation-v1-repository-visibility-invalid");
  return record as unknown as ReviewChallenge["repository"];
}

function requireHexOid(value: unknown, label: string, prefix = "review-challenge-v2"): string {
  const text = requireString(value, label, prefix);
  if (!/^[a-f0-9]{40,64}$/.test(text)) throw new Error(`${prefix}-${label}-invalid`);
  return text;
}

function requireTrust(value: unknown, label = "requiredTrust", prefix = "review-challenge-v2"): RequiredTrust {
  const text = requireString(value, label, prefix);
  if (!TRUST_LEVELS.has(text as RequiredTrust)) throw new Error(`${prefix}-${label}-invalid`);
  return text as RequiredTrust;
}

function requireRunnerId(value: unknown): string {
  const text = requireString(value, "runnerId", "attestation-v2-execution");
  if (!/^runner_[A-Za-z0-9_.-]+$/.test(text)) throw new Error("attestation-v2-execution-runnerId-invalid");
  return text;
}

function requireWorkflowRef(value: unknown): string {
  const text = requireString(value, "workflowRef", "attestation-v2-execution");
  if (!/^[^/\s]+\/[^/\s]+\/\.github\/workflows\/[^@\s]+@refs\/(heads|tags)\/[^@\s]+$/.test(text) && !/^[^/\s]+\/[^/\s]+\/\.github\/workflows\/[^@\s]+@[a-f0-9]{40}$/i.test(text)) {
    throw new Error("attestation-v2-execution-workflowRef-invalid");
  }
  return text;
}

function requireRunId(value: unknown): string {
  const text = requireString(value, "runId", "attestation-v2-execution");
  if (!/^[1-9][0-9]*$/.test(text)) throw new Error("attestation-v2-execution-runId-invalid");
  return text;
}

function requireStatus(value: unknown): ReviewChallengeStatus {
  const text = requireString(value, "status");
  if (!REVIEW_CHALLENGE_STATUSES.has(text as ReviewChallengeStatus)) throw new Error("review-challenge-v2-status-invalid");
  return text as ReviewChallengeStatus;
}

function requireDigest(value: unknown, label: string, prefix = "attestation-v2"): string {
  const text = requireString(value, label, prefix);
  if (!/^sha256:[a-f0-9]{64}$/.test(text)) throw new Error(`${prefix}-${label}-invalid`);
  return text;
}

function hasZeroDigest(attestation: AttestationV2): boolean {
  const zero = `sha256:${"0".repeat(64)}`;
  return [
    attestation.worktreeDigest,
    attestation.modelDigest,
    attestation.policyDigest,
    attestation.codeFactsDigest,
    attestation.reviewDigest,
    attestation.runtime.buildDigest,
    attestation.runtime.capabilitiesDigest
  ].some((digest) => digest === zero);
}

function requireAttestationResult(value: unknown): AttestationResult {
  const text = requireString(value, "result", "attestation-v2");
  if (!ATTESTATION_RESULTS.has(text as AttestationResult)) throw new Error("attestation-v2-result-invalid");
  return text as AttestationResult;
}

function requireAttestationErrorCode(value: unknown): string {
  const text = requireString(value, "errorCode", "attestation-v2");
  if (!ATTESTATION_ERROR_CODES.has(text)) throw new Error("attestation-v2-errorCode-invalid");
  return text;
}

function requireAttestationV2Execution(value: unknown): AttestationV2["execution"] {
  const record = requireRecord(value, "attestation-v2-execution");
  assertKnownKeys(record, ATTESTATION_EXECUTION_KEYS, "attestation-v2-execution");
  for (const key of ATTESTATION_EXECUTION_REQUIRED_KEYS) {
    if (!(key in record)) throw new Error(`attestation-v2-execution-missing-field: ${key}`);
  }
  const trustLevel = requireTrust(record.trustLevel, "trustLevel", "attestation-v2-execution");
  const source = requireString(record.source, "source", "attestation-v2-execution");
  if (!ATTESTATION_EXECUTION_SOURCES.has(source)) throw new Error("attestation-v2-execution-source-invalid");
  const principalId = requireString(record.principalId, "principalId", "attestation-v2-execution");
  const publicKeyId = requireString(record.publicKeyId, "publicKeyId", "attestation-v2-execution");

  if (trustLevel === "organization") {
    for (const key of ATTESTATION_ORGANIZATION_EXECUTION_KEYS) {
      if (!(key in record)) throw new Error(`attestation-v2-execution-missing-field: ${key}`);
    }
    const runnerId = requireRunnerId(record.runnerId);
    if (principalId !== runnerId) throw new Error("attestation-v2-execution-runnerId-principalId-mismatch");
    return {
      trustLevel,
      source: source as "organization-runner-checkout",
      principalId,
      publicKeyId,
      runnerId,
      workflowRef: requireWorkflowRef(record.workflowRef),
      runId: requireRunId(record.runId),
      runAttempt: requirePositiveInteger(record.runAttempt, "runAttempt", "attestation-v2-execution")
    };
  }

  for (const key of ATTESTATION_ORGANIZATION_EXECUTION_KEYS) {
    if (key in record) throw new Error(`attestation-v2-execution-organization-field-unexpected: ${key}`);
  }
  return {
    trustLevel,
    source: source as "clean-commit-worktree",
    principalId,
    publicKeyId
  };
}

function requireAttestationV2Runtime(value: unknown): AttestationV2["runtime"] {
  const record = requireRecord(value, "attestation-v2-runtime");
  assertKnownKeys(record, ATTESTATION_RUNTIME_KEYS, "attestation-v2-runtime");
  for (const key of ATTESTATION_RUNTIME_KEYS) {
    if (!(key in record)) throw new Error(`attestation-v2-runtime-missing-field: ${key}`);
  }
  return {
    version: requireString(record.version, "version", "attestation-v2-runtime"),
    buildDigest: requireDigest(record.buildDigest, "runtime-buildDigest"),
    codeGraphVersion: requireString(record.codeGraphVersion, "codeGraphVersion", "attestation-v2-runtime"),
    capabilitiesDigest: requireDigest(record.capabilitiesDigest, "runtime-capabilitiesDigest")
  };
}

function requireAttestationV2Signature(value: unknown): AttestationV2["signature"] {
  const record = requireRecord(value, "attestation-v2-signature");
  assertKnownKeys(record, ATTESTATION_SIGNATURE_KEYS, "attestation-v2-signature");
  for (const key of ATTESTATION_SIGNATURE_KEYS) {
    if (!(key in record)) throw new Error(`attestation-v2-signature-missing-field: ${key}`);
  }
  if (record.algorithm !== "ed25519") throw new Error("attestation-v2-signature-algorithm-invalid");
  if (typeof record.value !== "string") throw new Error("attestation-v2-signature-value-invalid");
  return {
    algorithm: "ed25519",
    value: record.value
  };
}

function requireIsoInstant(value: unknown, label: string, prefix = "review-challenge-v2"): number {
  const text = requireString(value, label, prefix);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${prefix}-${label}-invalid`);
  }
  return parsed;
}
