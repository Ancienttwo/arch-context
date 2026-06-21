import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import {
  assertReviewChallengeV2,
  assertAttestationV2,
  attestationLabel,
  attestationV2Digest,
  canonicalAttestationV2,
  canonicalReviewChallengeV2,
  createAttestationV2,
  createReviewChallenge,
  createReviewChallengeV2,
  deviceIntegritySignals,
  evaluateAttestationForReviewChallenge,
  migrateLocalAttestationV1ToAuditRecord,
  publicKeyFingerprint,
  reviewChallengeV2Digest,
  signLocalAttestation,
  signOrganizationAttestation,
  unsignedAttestationV2,
  verifyAttestationV2ForReviewChallenge,
  verifyLocalAttestation
} from "../src/index";

describe("local attestation", () => {
  test("derives stable display fingerprint from a public signing key", () => {
    const first = generateKeyPairSync("ed25519");
    const second = generateKeyPairSync("ed25519");

    expect(publicKeyFingerprint(first.publicKey)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(publicKeyFingerprint(first.publicKey)).toBe(publicKeyFingerprint(first.publicKey));
    expect(publicKeyFingerprint(first.publicKey)).not.toBe(publicKeyFingerprint(second.publicKey));
    expect(() => publicKeyFingerprint(first.privateKey)).toThrow("public-key-required");
  });

  test("creates ReviewChallenge v2 with stable canonical serialization", () => {
    const challenge = createReviewChallengeV2(reviewChallengeV2Input());

    expect(challenge.schemaVersion).toBe("archcontext.review-challenge/v2");
    expect(challenge.challengeId).toMatch(/^chal_[a-f0-9]{16}$/);
    expect(challenge.status).toBe("PENDING");
    expect(challenge.requiredTrust).toBe("developer");
    expect(JSON.parse(canonicalReviewChallengeV2(challenge))).toEqual(challenge);

    const reordered = {
      status: challenge.status,
      expiresAt: challenge.expiresAt,
      createdAt: challenge.createdAt,
      policyProfileId: challenge.policyProfileId,
      requiredTrust: challenge.requiredTrust,
      nonce: challenge.nonce,
      baseSha: challenge.baseSha,
      headSha: challenge.headSha,
      pullRequestNumber: challenge.pullRequestNumber,
      repositoryId: challenge.repositoryId,
      installationId: challenge.installationId,
      challengeId: challenge.challengeId,
      schemaVersion: challenge.schemaVersion
    };

    expect(canonicalReviewChallengeV2(reordered)).toBe(canonicalReviewChallengeV2(challenge));
    expect(reviewChallengeV2Digest(reordered)).toBe(reviewChallengeV2Digest(challenge));
  });

  test("accepts organization ReviewChallenge v2 and rejects private content fields", () => {
    const organization = createReviewChallengeV2({
      ...reviewChallengeV2Input(),
      nonce: "nonce_base64url_org",
      requiredTrust: "organization",
      policyProfileId: "policy.organization",
      status: "LEASED"
    });

    expect(organization.requiredTrust).toBe("organization");
    expect(organization.status).toBe("LEASED");
    expect(() => assertReviewChallengeV2({
      ...organization,
      filename: "src/private.ts"
    })).toThrow("review-challenge-v2-private-content: filename");
    expect(() => createReviewChallengeV2({
      ...reviewChallengeV2Input(),
      headSha: "not-a-sha"
    })).toThrow("review-challenge-v2-headSha-invalid");
    expect(() => createReviewChallengeV2({
      ...reviewChallengeV2Input(),
      expiresAt: "2026-06-20T08:59:00Z"
    })).toThrow("review-challenge-v2-expiry-invalid");
  });

  test("creates Attestation v2 with canonical payload excluding signature value", () => {
    const attestation = createAttestationV2(attestationV2Input());

    expect(attestation.schemaVersion).toBe("archcontext.attestation/v2");
    expect(attestation.attestationId).toMatch(/^att_[a-f0-9]{16}$/);
    expect(attestation.signature).toEqual({ algorithm: "ed25519", value: "" });
    expect(JSON.parse(canonicalAttestationV2(attestation))).toEqual(unsignedAttestationV2(attestation));

    const signedA = {
      ...attestation,
      signature: { algorithm: "ed25519" as const, value: "base64url_signature_a" }
    };
    const signedB = {
      ...attestation,
      signature: { algorithm: "ed25519" as const, value: "base64url_signature_b" }
    };
    const reordered = {
      signature: signedA.signature,
      expiresAt: signedA.expiresAt,
      completedAt: signedA.completedAt,
      startedAt: signedA.startedAt,
      nonce: signedA.nonce,
      runtime: {
        capabilitiesDigest: signedA.runtime.capabilitiesDigest,
        codeGraphVersion: signedA.runtime.codeGraphVersion,
        buildDigest: signedA.runtime.buildDigest,
        version: signedA.runtime.version
      },
      execution: {
        publicKeyId: signedA.execution.publicKeyId,
        principalId: signedA.execution.principalId,
        source: "clean-commit-worktree" as const,
        trustLevel: "developer" as const
      },
      result: signedA.result,
      reviewDigest: signedA.reviewDigest,
      codeFactsDigest: signedA.codeFactsDigest,
      policyDigest: signedA.policyDigest,
      modelDigest: signedA.modelDigest,
      worktreeDigest: signedA.worktreeDigest,
      headTreeOid: signedA.headTreeOid,
      mergeBaseSha: signedA.mergeBaseSha,
      baseSha: signedA.baseSha,
      headSha: signedA.headSha,
      pullRequestNumber: signedA.pullRequestNumber,
      repositoryId: signedA.repositoryId,
      installationId: signedA.installationId,
      challengeId: signedA.challengeId,
      attestationId: signedA.attestationId,
      schemaVersion: signedA.schemaVersion
    };

    expect(canonicalAttestationV2(signedA)).toBe(canonicalAttestationV2(signedB));
    expect(attestationV2Digest(signedA)).toBe(attestationV2Digest(signedB));
    expect(canonicalAttestationV2(reordered)).toBe(canonicalAttestationV2(signedA));
  });

  test("accepts Attestation v2 error result and rejects private content or invalid payloads", () => {
    const errorAttestation = createAttestationV2({
      ...attestationV2Input(),
      result: "error",
      errorCode: "CODEGRAPH_FAILED",
      execution: organizationAttestationExecution(),
      signature: { algorithm: "ed25519", value: "base64url_signature" }
    });

    expect(errorAttestation.result).toBe("error");
    expect(errorAttestation.errorCode).toBe("CODEGRAPH_FAILED");
    expect(() => assertAttestationV2({
      ...errorAttestation,
      finding: "private finding body"
    })).toThrow("attestation-v2-private-content: finding");
    expect(() => createAttestationV2({
      ...attestationV2Input(),
      result: "error"
    })).toThrow("attestation-v2-errorCode-invalid");
    expect(() => createAttestationV2({
      ...attestationV2Input(),
      errorCode: "CODEGRAPH_FAILED"
    })).toThrow("attestation-v2-errorCode-unexpected");
    expect(() => createAttestationV2({
      ...attestationV2Input(),
      worktreeDigest: "sha256:bad"
    })).toThrow("attestation-v2-worktreeDigest-invalid");
    expect(() => createAttestationV2({
      ...attestationV2Input(),
      completedAt: "2026-06-20T09:02:00Z"
    })).toThrow("attestation-v2-completedAt-invalid");
    expect(() => createAttestationV2({
      ...attestationV2Input(),
      execution: {
        trustLevel: "developer",
        source: "organization-runner-checkout",
        principalId: "device_0001",
        publicKeyId: "key_device_0001"
      } as any
    })).toThrow("attestation-v2-execution-source-trust-mismatch");
  });

  test("requires Organization Attestation v2 workflow run metadata in the signed payload", () => {
    const attestation = createAttestationV2({
      ...attestationV2Input(),
      execution: organizationAttestationExecution()
    });

    expect(attestation.execution).toMatchObject({
      trustLevel: "organization",
      source: "organization-runner-checkout",
      principalId: "runner_0001",
      publicKeyId: "key_runner_0001",
      runnerId: "runner_0001",
      workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
      runId: "1234567890",
      runAttempt: 1
    });
    expect(canonicalAttestationV2(attestation)).toContain("\"workflowRef\":\"owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main\"");
    const missingRunnerId = organizationAttestationExecution() as any;
    delete missingRunnerId.runnerId;
    expect(() => createAttestationV2({
      ...attestationV2Input(),
      execution: missingRunnerId
    })).toThrow("attestation-v2-execution-missing-field: runnerId");
    expect(() => createAttestationV2({
      ...attestationV2Input(),
      execution: organizationAttestationExecution({ principalId: "runner_other" })
    })).toThrow("attestation-v2-execution-runnerId-principalId-mismatch");
    expect(() => createAttestationV2({
      ...attestationV2Input(),
      execution: organizationAttestationExecution({ workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@main" })
    })).toThrow("attestation-v2-execution-workflowRef-invalid");
    expect(() => createAttestationV2({
      ...attestationV2Input(),
      execution: organizationAttestationExecution({ runId: "0" })
    })).toThrow("attestation-v2-execution-runId-invalid");
    expect(() => createAttestationV2({
      ...attestationV2Input(),
      execution: organizationAttestationExecution({ runAttempt: 0 })
    })).toThrow("attestation-v2-execution-runAttempt-invalid");
    expect(() => createAttestationV2({
      ...attestationV2Input(),
      execution: {
        ...attestationV2Input().execution,
        runnerId: "runner_0001"
      } as any
    })).toThrow("attestation-v2-execution-organization-field-unexpected: runnerId");
  });

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

  test("migrates Attestation v1 to an audit-only record that cannot satisfy v2 required checks", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const repository = { provider: "github" as const, owner: "ancienttwo", name: "arch-context", visibility: "private" as const };
    const legacyChallenge = createReviewChallenge({
      repository,
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expiresAt: "2026-06-20T09:15:00Z"
    });
    const legacyAttestation = signLocalAttestation({
      challenge: legacyChallenge,
      worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      reviewDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      deviceId: "device_legacy_1",
      publicKeyId: "key_legacy_1",
      privateKey,
      issuedAt: "2026-06-20T09:00:00Z"
    });
    const migrated = migrateLocalAttestationV1ToAuditRecord({
      attestation: legacyAttestation,
      migratedAt: "2026-06-20T09:20:00Z"
    });

    expect(migrated).toMatchObject({
      schemaVersion: "archcontext.attestation-migration/v1",
      sourceSchemaVersion: "archcontext.attestation/v1",
      targetSchemaVersion: "archcontext.attestation/v2",
      originalAttestationId: legacyAttestation.attestationId,
      originalChallengeId: legacyAttestation.challengeId,
      migrationStatus: "legacy-audit-only",
      requiredCheckEligible: false,
      rejectionReasonCode: "ATTESTATION_SCHEMA_UNSUPPORTED",
      principalId: "device_legacy_1",
      publicKeyId: "key_legacy_1"
    });
    expect(JSON.stringify(migrated)).not.toContain("ancienttwo");
    expect(JSON.stringify(migrated)).not.toContain("arch-context");

    const organizationChallenge = createReviewChallengeV2({
      ...reviewChallengeV2Input(),
      challengeId: legacyAttestation.challengeId,
      requiredTrust: "organization",
      status: "LEASED"
    });
    expect(evaluateAttestationForReviewChallenge({
      challenge: organizationChallenge,
      attestation: legacyAttestation
    })).toEqual({ accepted: false, reasonCode: "ATTESTATION_SCHEMA_UNSUPPORTED" });
  });

  test("evaluates only Attestation v2 payloads against ReviewChallenge v2 requiredTrust", () => {
    const organizationChallenge = createReviewChallengeV2({
      ...reviewChallengeV2Input(),
      challengeId: "chal_org_required",
      requiredTrust: "organization",
      nonce: "nonce_org_required",
      status: "LEASED"
    });
    const organizationAttestation = createAttestationV2({
      ...attestationV2Input(),
      challengeId: organizationChallenge.challengeId,
      nonce: organizationChallenge.nonce,
      execution: organizationAttestationExecution()
    });
    const developerAttestation = createAttestationV2({
      ...attestationV2Input(),
      challengeId: organizationChallenge.challengeId,
      nonce: organizationChallenge.nonce
    });

    expect(evaluateAttestationForReviewChallenge({
      challenge: organizationChallenge,
      attestation: organizationAttestation
    }).accepted).toBe(true);
    expect(evaluateAttestationForReviewChallenge({
      challenge: organizationChallenge,
      attestation: developerAttestation
    })).toEqual({ accepted: false, reasonCode: "TRUST_LEVEL_MISMATCH" });
    expect(evaluateAttestationForReviewChallenge({
      challenge: organizationChallenge,
      attestation: { ...organizationAttestation, filename: "private.ts" }
    })).toEqual({ accepted: false, reasonCode: "PAYLOAD_PRIVACY_VIOLATION" });
  });

  test("verifies signed Attestation v2 payloads and rejects tampered tree or digest fields", () => {
    const keyPair = generateKeyPairSync("ed25519");
    const wrongKeyPair = generateKeyPairSync("ed25519");
    const challenge = createReviewChallengeV2({
      ...reviewChallengeV2Input(),
      challengeId: "chal_signed_v2",
      status: "LEASED"
    });
    const signed = signedAttestationV2ForChallenge(challenge, keyPair.privateKey);
    const activeKeyStatus = {
      schemaVersion: "archcontext.governance-key-status/v1" as const,
      publicKeyId: signed.execution.publicKeyId,
      ownerKind: "device" as const,
      ownerId: signed.execution.principalId,
      fingerprint: publicKeyFingerprint(keyPair.publicKey),
      status: "active" as const,
      createdAt: "2026-06-20T09:00:00Z"
    };

    const accepted = verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: signed,
      publicKey: keyPair.publicKey,
      signingKeyStatus: activeKeyStatus,
      now: "2026-06-20T09:05:00Z",
      expectedHeadTreeOid: signed.headTreeOid
    });
    expect(accepted).toMatchObject({
      accepted: true,
      attestation: signed,
      attestationDigest: attestationV2Digest(signed)
    });
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: signed,
      publicKey: wrongKeyPair.publicKey,
      now: "2026-06-20T09:05:00Z"
    })).toEqual({ accepted: false, reasonCode: "SIGNATURE_INVALID" });
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: {
        ...signed,
        signature: {
          algorithm: "ed25519",
          value: Buffer.from("short").toString("base64")
        }
      },
      publicKey: keyPair.publicKey,
      now: "2026-06-20T09:05:00Z"
    })).toEqual({ accepted: false, reasonCode: "SIGNATURE_INVALID" });
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: signed,
      publicKey: keyPair.publicKey,
      signingKeyStatus: { ...activeKeyStatus, status: "revoked", revokedAt: "2026-06-20T09:01:00Z" },
      now: "2026-06-20T09:05:00Z"
    })).toEqual({ accepted: false, reasonCode: "DEVICE_REVOKED" });
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: signed,
      publicKey: keyPair.publicKey,
      signingKeyStatus: { ...activeKeyStatus, publicKeyId: "key_other" },
      now: "2026-06-20T09:05:00Z"
    })).toEqual({ accepted: false, reasonCode: "SIGNATURE_INVALID" });
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: signedAttestationV2ForChallenge(challenge, keyPair.privateKey, {
        worktreeDigest: `sha256:${"0".repeat(64)}`
      }),
      publicKey: keyPair.publicKey,
      signingKeyStatus: activeKeyStatus,
      now: "2026-06-20T09:05:00Z"
    })).toEqual({ accepted: false, reasonCode: "DIGEST_INVALID" });
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: signed,
      publicKey: keyPair.publicKey,
      now: "2026-06-20T09:16:00Z"
    })).toEqual({ accepted: false, reasonCode: "CHALLENGE_EXPIRED" });
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: signed,
      publicKey: keyPair.publicKey,
      now: "2026-06-20T09:15:00.000Z"
    })).toEqual({ accepted: false, reasonCode: "CHALLENGE_EXPIRED" });
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: { ...signed, headTreeOid: "tree_bbbbbbbb" },
      publicKey: keyPair.publicKey,
      now: "2026-06-20T09:05:00Z",
      expectedHeadTreeOid: signed.headTreeOid
    })).toEqual({ accepted: false, reasonCode: "TREE_OID_MISMATCH" });
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: { ...signed, headTreeOid: "tree_bbbbbbbb" },
      publicKey: keyPair.publicKey,
      now: "2026-06-20T09:05:00Z"
    })).toEqual({ accepted: false, reasonCode: "SIGNATURE_INVALID" });
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: { ...signed, nonce: "nonce_tampered" },
      publicKey: keyPair.publicKey,
      now: "2026-06-20T09:05:00Z"
    })).toEqual({ accepted: false, reasonCode: "NONCE_MISMATCH" });

    for (const field of ["worktreeDigest", "modelDigest", "policyDigest", "codeFactsDigest", "reviewDigest"] as const) {
      expect(verifyAttestationV2ForReviewChallenge({
        challenge,
        attestation: {
          ...signed,
          [field]: `sha256:${"9".repeat(64)}`
        },
        publicKey: keyPair.publicKey,
        now: "2026-06-20T09:05:00Z"
      }), field).toEqual({ accepted: false, reasonCode: "SIGNATURE_INVALID" });
    }
  });

  test("verifies organization Attestation v2 only with active scoped RunnerIdentity and runner key", () => {
    const keyPair = generateKeyPairSync("ed25519");
    const challenge = createReviewChallengeV2({
      ...reviewChallengeV2Input(),
      challengeId: "chal_org_runner_verify",
      nonce: "nonce_org_runner_verify",
      requiredTrust: "organization",
      status: "LEASED"
    });
    const runner = runnerIdentityForKey(keyPair.publicKey);
    const signed = signedAttestationV2ForChallenge(challenge, keyPair.privateKey, {
      execution: organizationAttestationExecution()
    });
    const runnerKeyStatus = {
      schemaVersion: "archcontext.governance-key-status/v1" as const,
      publicKeyId: runner.publicKeyId,
      ownerKind: "runner" as const,
      ownerId: runner.runnerId,
      fingerprint: runner.publicKeyFingerprint,
      status: "active" as const,
      createdAt: runner.createdAt,
      rotatedAt: null,
      revokedAt: null
    };

    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: signed,
      publicKey: keyPair.publicKey,
      runnerIdentity: runner,
      signingKeyStatus: runnerKeyStatus,
      now: "2026-06-20T09:05:00Z",
      expectedHeadTreeOid: signed.headTreeOid
    }).accepted).toBe(true);
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: signed,
      publicKey: keyPair.publicKey,
      signingKeyStatus: runnerKeyStatus,
      now: "2026-06-20T09:05:00Z"
    })).toEqual({ accepted: false, reasonCode: "RUNNER_NOT_FOUND" });
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: signed,
      publicKey: keyPair.publicKey,
      runnerIdentity: { ...runner, status: "revoked", revokedAt: "2026-06-20T09:01:00Z" },
      signingKeyStatus: runnerKeyStatus,
      now: "2026-06-20T09:05:00Z"
    })).toEqual({ accepted: false, reasonCode: "RUNNER_REVOKED" });
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: signed,
      publicKey: keyPair.publicKey,
      runnerIdentity: { ...runner, repositoryIds: [99999], scope: { kind: "repository", repositoryIds: [99999] } },
      signingKeyStatus: runnerKeyStatus,
      now: "2026-06-20T09:05:00Z"
    })).toEqual({ accepted: false, reasonCode: "RUNNER_SCOPE_MISMATCH" });
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: signed,
      publicKey: keyPair.publicKey,
      runnerIdentity: runner,
      signingKeyStatus: { ...runnerKeyStatus, ownerKind: "device", ownerId: "device_0001" },
      now: "2026-06-20T09:05:00Z"
    })).toEqual({ accepted: false, reasonCode: "SIGNATURE_INVALID" });
    expect(verifyAttestationV2ForReviewChallenge({
      challenge,
      attestation: signed,
      publicKey: keyPair.publicKey,
      runnerIdentity: runner,
      signingKeyStatus: { ...runnerKeyStatus, status: "revoked", revokedAt: "2026-06-20T09:01:00Z" },
      now: "2026-06-20T09:05:00Z"
    })).toEqual({ accepted: false, reasonCode: "RUNNER_REVOKED" });

    const developerRequiredChallenge = createReviewChallengeV2({
      ...reviewChallengeV2Input(),
      challengeId: "chal_org_runner_developer_required",
      nonce: "nonce_org_runner_developer_required",
      requiredTrust: "developer",
      status: "LEASED"
    });
    expect(verifyAttestationV2ForReviewChallenge({
      challenge: developerRequiredChallenge,
      attestation: signedAttestationV2ForChallenge(developerRequiredChallenge, keyPair.privateKey, {
        execution: organizationAttestationExecution()
      }),
      publicKey: keyPair.publicKey,
      runnerIdentity: runner,
      signingKeyStatus: runnerKeyStatus,
      now: "2026-06-20T09:05:00Z"
    })).toEqual({ accepted: false, reasonCode: "TRUST_LEVEL_MISMATCH" });
  });
});

function reviewChallengeV2Input() {
  return {
    installationId: 10001,
    repositoryId: 20002,
    pullRequestNumber: 42,
    headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    nonce: "nonce_base64url_0001",
    requiredTrust: "developer" as const,
    policyProfileId: "policy.default",
    createdAt: "2026-06-20T09:00:00Z",
    expiresAt: "2026-06-20T09:15:00Z"
  };
}

function attestationV2Input(): Parameters<typeof createAttestationV2>[0] {
  return {
    challengeId: "chal_20260620_0001",
    installationId: 10001,
    repositoryId: 20002,
    pullRequestNumber: 42,
    headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    mergeBaseSha: "cccccccccccccccccccccccccccccccccccccccc",
    headTreeOid: "tree_aaaaaaaa",
    worktreeDigest: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
    modelDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    policyDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    codeFactsDigest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
    reviewDigest: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
    result: "pass" as const,
    execution: {
      trustLevel: "developer" as const,
      source: "clean-commit-worktree" as const,
      principalId: "device_0001",
      publicKeyId: "key_device_0001"
    },
    runtime: {
      version: "0.2.0",
      buildDigest: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
      codeGraphVersion: "1.0.1",
      capabilitiesDigest: "sha256:6666666666666666666666666666666666666666666666666666666666666666"
    },
    nonce: "nonce_base64url_0001",
    startedAt: "2026-06-20T09:03:00Z",
    completedAt: "2026-06-20T09:04:00Z",
    expiresAt: "2026-06-20T09:15:00Z"
  };
}

function organizationAttestationExecution(overrides: Record<string, unknown> = {}) {
  return {
    trustLevel: "organization" as const,
    source: "organization-runner-checkout" as const,
    principalId: "runner_0001",
    publicKeyId: "key_runner_0001",
    runnerId: "runner_0001",
    workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
    runId: "1234567890",
    runAttempt: 1,
    ...overrides
  };
}

function runnerIdentityForKey(publicKey: KeyObject) {
  return {
    schemaVersion: "archcontext.runner-identity/v1" as const,
    runnerId: "runner_0001",
    installationId: 10001,
    repositoryIds: [20002],
    scope: { kind: "repository" as const, repositoryIds: [20002] },
    workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
    publicKeyId: "key_runner_0001",
    publicKeyFingerprint: publicKeyFingerprint(publicKey),
    status: "active" as const,
    createdAt: "2026-06-20T09:00:00Z",
    rotatedAt: null,
    revokedAt: null
  };
}

function signedAttestationV2ForChallenge(
  challenge: ReturnType<typeof createReviewChallengeV2>,
  privateKey: KeyObject,
  overrides: Partial<ReturnType<typeof attestationV2Input>> = {}
) {
  const unsigned = createAttestationV2({
    ...attestationV2Input(),
    challengeId: challenge.challengeId,
    installationId: challenge.installationId,
    repositoryId: challenge.repositoryId,
    pullRequestNumber: challenge.pullRequestNumber,
    headSha: challenge.headSha,
    baseSha: challenge.baseSha,
    nonce: challenge.nonce,
    expiresAt: challenge.expiresAt,
    ...overrides
  });
  return createAttestationV2({
    ...unsigned,
    signature: {
      algorithm: "ed25519",
      value: sign(null, Buffer.from(canonicalAttestationV2(unsigned), "utf8"), privateKey).toString("base64")
    }
  });
}
