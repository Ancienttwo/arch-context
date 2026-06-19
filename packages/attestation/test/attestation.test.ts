import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
  attestationLabel,
  createReviewChallenge,
  deviceIntegritySignals,
  signLocalAttestation,
  signOrganizationAttestation,
  verifyLocalAttestation
} from "../src/index";

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

  test("accepts organization attestation only when runner binding and installation match", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const repository = { provider: "github" as const, owner: "ancienttwo", name: "arch-context", visibility: "private" as const };
    const runner = {
      schemaVersion: "archcontext.org-runner-identity/v1" as const,
      runnerId: "runner_acme_prod_1",
      installationId: 12345,
      repositoryNumericIds: [1001],
      publicKeyId: "org_pk_1",
      publicKeyFingerprint: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      status: "active" as const,
      createdAt: "2026-06-19T00:00:00Z"
    };
    const challenge = createReviewChallenge({ repository, headSha: "abc", expiresAt: "2026-06-19T00:10:00Z" });
    const attestation = signOrganizationAttestation({
      challenge,
      worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      reviewDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      runner,
      privateKey,
      issuedAt: "2026-06-19T00:00:00Z",
      repositoryNumericId: 1001
    });

    expect(attestation.trustLevel).toBe("organization");
    expect(attestationLabel(attestation.trustLevel)).toBe("Organization-attested");
    expect(
      verifyLocalAttestation({
        challenge,
        attestation,
        publicKey,
        now: "2026-06-19T00:01:00Z",
        expectedRepository: repository,
        expectedHeadSha: "abc",
        expectedTrustLevel: "organization",
        orgRunner: runner,
        expectedInstallationId: 12345
      }).accepted
    ).toBe(true);
    expect(
      verifyLocalAttestation({
        challenge,
        attestation,
        publicKey,
        now: "2026-06-19T00:01:00Z",
        expectedRepository: repository,
        expectedHeadSha: "abc",
        expectedTrustLevel: "organization",
        orgRunner: { ...runner, status: "revoked" },
        expectedInstallationId: 12345
      }).reason
    ).toBe("org-runner-revoked");
    expect(
      verifyLocalAttestation({
        challenge,
        attestation,
        publicKey,
        now: "2026-06-19T00:01:00Z",
        expectedRepository: repository,
        expectedHeadSha: "abc",
        expectedTrustLevel: "organization",
        orgRunner: runner,
        expectedInstallationId: 999
      }).reason
    ).toBe("installation-mismatch");
    expect(deviceIntegritySignals({ trustLevel: "organization", runnerControlled: true }).limitation).toContain("does not prove");
  });
});
