import { createHash, sign, verify, type KeyObject } from "node:crypto";
import { canonicalize, digestJson, type Json } from "../../contracts/src/index";

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
  trustLevel: "developer" | "organization-runner";
  signature: { alg: "ed25519"; value: string };
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
  const unsigned = unsignedPayload({
    schemaVersion: "archcontext.attestation/v1",
    attestationId: `att_${createHash("sha256").update(input.challenge.challengeId + input.reviewDigest).digest("hex").slice(0, 16)}`,
    challengeId: input.challenge.challengeId,
    repository: input.challenge.repository,
    headSha: input.challenge.headSha,
    worktreeDigest: input.worktreeDigest,
    reviewDigest: input.reviewDigest,
    device: { deviceId: input.deviceId, publicKeyId: input.publicKeyId },
    issuedAt: input.issuedAt,
    expiresAt: input.challenge.expiresAt,
    trustLevel: "developer",
    signature: { alg: "ed25519", value: "" }
  });
  return {
    ...unsigned,
    signature: {
      alg: "ed25519",
      value: sign(null, Buffer.from(canonicalAttestation(unsigned), "utf8"), input.privateKey).toString("base64")
    }
  };
}

export function verifyLocalAttestation(input: {
  challenge: ReviewChallenge;
  attestation: LocalAttestation;
  publicKey: KeyObject;
  now: string;
  expectedRepository: ReviewChallenge["repository"];
  expectedHeadSha: string;
}): { accepted: boolean; reason?: string; challenge?: ReviewChallenge } {
  if (input.challenge.consumed) return { accepted: false, reason: "challenge-already-consumed" };
  if (input.challenge.expiresAt <= input.now || input.attestation.expiresAt <= input.now) return { accepted: false, reason: "attestation-expired" };
  if (input.attestation.challengeId !== input.challenge.challengeId) return { accepted: false, reason: "challenge-mismatch" };
  if (input.attestation.headSha !== input.expectedHeadSha || input.challenge.headSha !== input.expectedHeadSha) return { accepted: false, reason: "head-sha-mismatch" };
  if (JSON.stringify(input.attestation.repository) !== JSON.stringify(input.expectedRepository)) return { accepted: false, reason: "repository-mismatch" };
  const unsigned = unsignedPayload(input.attestation);
  const ok = verify(null, Buffer.from(canonicalAttestation(unsigned), "utf8"), input.publicKey, Buffer.from(input.attestation.signature.value, "base64"));
  if (!ok) return { accepted: false, reason: "signature-invalid" };
  return { accepted: true, challenge: { ...input.challenge, consumed: true } };
}

export function attestationDigest(attestation: LocalAttestation): string {
  return digestJson(unsignedPayload(attestation) as unknown as Json);
}

function unsignedPayload(attestation: LocalAttestation): LocalAttestation {
  return { ...attestation, signature: { alg: "ed25519", value: "" } };
}

function canonicalAttestation(attestation: LocalAttestation): string {
  return canonicalize(unsignedPayload(attestation) as unknown as Json);
}
