import type { KeyObject } from "node:crypto";
import {
  signOrganizationAttestation,
  type LocalAttestation,
  type OrgRunnerIdentity,
  type ReviewChallenge
} from "../../attestation/src/index";
import { digestJson, type Json } from "../../contracts/src/index";
import { completeTaskGate, type CompleteTaskInput } from "../../review-engine/src/index";

export interface TrustedRunnerReviewInput extends CompleteTaskInput {
  challenge: ReviewChallenge;
  runner: OrgRunnerIdentity;
  privateKey: KeyObject;
  issuedAt: string;
  repositoryNumericId?: number;
}

export interface RunnerReviewResult {
  review: ReturnType<typeof completeTaskGate>;
  attestation: LocalAttestation;
}

export function runTrustedReview(input: TrustedRunnerReviewInput): RunnerReviewResult {
  const review = completeTaskGate(input);
  const attestation = signOrganizationAttestation({
    challenge: input.challenge,
    worktreeDigest: input.worktreeDigest,
    reviewDigest: review.extensions.digest,
    runner: input.runner,
    privateKey: input.privateKey,
    issuedAt: input.issuedAt,
    repositoryNumericId: input.repositoryNumericId
  });
  return { review, attestation };
}

export function buildRunnerUploadPayload(attestation: LocalAttestation) {
  return {
    attestationId: attestation.attestationId,
    challengeId: attestation.challengeId,
    headSha: attestation.headSha,
    worktreeDigest: attestation.worktreeDigest,
    reviewDigest: attestation.reviewDigest,
    trustLevel: attestation.trustLevel,
    device: attestation.device,
    signature: attestation.signature,
    extensions: attestation.extensions,
    digest: digestJson({
      attestationId: attestation.attestationId,
      challengeId: attestation.challengeId,
      headSha: attestation.headSha,
      worktreeDigest: attestation.worktreeDigest,
      reviewDigest: attestation.reviewDigest,
      trustLevel: attestation.trustLevel,
      device: attestation.device,
      signature: attestation.signature,
      extensions: attestation.extensions
    } as unknown as Json)
  };
}

export function runnerPrivacyAudit(payload: unknown): { ok: boolean; forbiddenKeys: string[] } {
  const forbidden = new Set(["findings", "review", "patch", "fileBody", "modelBody"]);
  const keys = collectKeys(payload);
  const forbiddenKeys = keys.filter((key) => forbidden.has(key));
  return { ok: forbiddenKeys.length === 0, forbiddenKeys };
}

function collectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [key, ...collectKeys(child)]);
}
