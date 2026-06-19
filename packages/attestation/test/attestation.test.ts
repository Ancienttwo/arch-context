import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createReviewChallenge, signLocalAttestation, verifyLocalAttestation } from "../src/index";

describe("local attestation", () => {
  test("accepts valid developer attestation and rejects replay, wrong SHA, wrong repo, and expiry", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const repository = { provider: "github" as const, owner: "ancienttwo", name: "arch-context", visibility: "private" as const };
    const challenge = createReviewChallenge({ repository, headSha: "abc", expiresAt: "2026-06-19T00:10:00Z" });
    const attestation = signLocalAttestation({
      challenge,
      worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      reviewDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      deviceId: "device_1",
      publicKeyId: "pk_1",
      privateKey,
      issuedAt: "2026-06-19T00:00:00Z"
    });
    const accepted = verifyLocalAttestation({ challenge, attestation, publicKey, now: "2026-06-19T00:01:00Z", expectedRepository: repository, expectedHeadSha: "abc" });
    expect(accepted.accepted).toBe(true);
    expect(verifyLocalAttestation({ challenge: accepted.challenge!, attestation, publicKey, now: "2026-06-19T00:02:00Z", expectedRepository: repository, expectedHeadSha: "abc" }).reason).toBe("challenge-already-consumed");
    expect(verifyLocalAttestation({ challenge, attestation, publicKey, now: "2026-06-19T00:01:00Z", expectedRepository: repository, expectedHeadSha: "def" }).reason).toBe("head-sha-mismatch");
    expect(verifyLocalAttestation({ challenge, attestation, publicKey, now: "2026-06-19T00:01:00Z", expectedRepository: { ...repository, name: "other" }, expectedHeadSha: "abc" }).reason).toBe("repository-mismatch");
    expect(verifyLocalAttestation({ challenge, attestation, publicKey, now: "2026-06-19T00:11:00Z", expectedRepository: repository, expectedHeadSha: "abc" }).reason).toBe("attestation-expired");

    const tamperedRepository = { ...repository, name: "other" };
    expect(
      verifyLocalAttestation({
        challenge,
        attestation: { ...attestation, repository: tamperedRepository },
        publicKey,
        now: "2026-06-19T00:01:00Z",
        expectedRepository: tamperedRepository,
        expectedHeadSha: "abc"
      }).reason
    ).toBe("signature-invalid");
  });
});
