import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createReviewChallenge, verifyLocalAttestation } from "../../attestation/src/index";
import { buildRunnerUploadPayload, runTrustedReview, runnerPrivacyAudit } from "../src/index";

const digest = `sha256:${"1".repeat(64)}`;

describe("@archcontext/runner", () => {
  test("runs organization-attested review and uploads only attestation metadata", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const repository = { provider: "github" as const, owner: "ancienttwo", name: "arch-context", visibility: "private" as const };
    const runner = {
      schemaVersion: "archcontext.org-runner-identity/v1" as const,
      runnerId: "runner_1",
      installationId: 12345,
      repositoryNumericIds: [1001],
      publicKeyId: "org_pk_1",
      publicKeyFingerprint: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      status: "active" as const,
      createdAt: "2026-06-19T00:00:00Z"
    };
    const challenge = createReviewChallenge({ repository, headSha: "abc", expiresAt: "2026-06-19T00:10:00Z" });
    const result = runTrustedReview({
      taskSessionId: "task.runner",
      posture: "normal",
      headSha: "abc",
      currentHeadSha: "abc",
      worktreeDigest: digest,
      modelDigest: digest,
      codeFactsDigest: digest,
      challenge,
      runner,
      privateKey,
      issuedAt: "2026-06-19T00:00:00Z",
      repositoryNumericId: 1001
    });
    expect(result.review.result).toBe("pass");
    expect(result.attestation.trustLevel).toBe("organization");
    expect(
      verifyLocalAttestation({
        challenge,
        attestation: result.attestation,
        publicKey,
        now: "2026-06-19T00:01:00Z",
        expectedRepository: repository,
        expectedHeadSha: "abc",
        expectedTrustLevel: "organization",
        orgRunner: runner,
        expectedInstallationId: 12345
      }).accepted
    ).toBe(true);

    const payload = buildRunnerUploadPayload(result.attestation);
    expect(runnerPrivacyAudit(payload)).toEqual({ ok: true, forbiddenKeys: [] });
    expect(JSON.stringify(payload)).not.toContain("findings");
    expect(JSON.stringify(payload)).not.toContain("pass_with_warnings");
  });
});
