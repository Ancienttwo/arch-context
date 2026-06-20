import { createHash, sign, verify, type KeyObject } from "node:crypto";
import { canonicalize, digestJson, type Json } from "@archcontext/contracts";

export type TrustLevel = "developer" | "organization";

export interface ReviewChallenge {
  challengeId: string;
  repository: { provider: "github"; owner: string; name: string; visibility: "public" | "private" };
  headSha: string;
  nonce: string;
  expiresAt: string;
  consumed: boolean;
}

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

export function createReviewChallenge(input: Omit<ReviewChallenge, "challengeId" | "nonce" | "consumed">): ReviewChallenge {
  const nonce = digestJson({ repo: input.repository, headSha: input.headSha, expiresAt: input.expiresAt });
  return {
    ...input,
    challengeId: `challenge_${nonce.slice(-16)}`,
    nonce,
    consumed: false
  };
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
