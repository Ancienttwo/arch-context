import { describe, expect, test } from "bun:test";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { createReviewChallenge, signLocalAttestation, signOrganizationAttestation } from "@archcontext/cloud/attestation";
import { DEVELOPER_REVIEW_CHECK_NAME, GITHUB_APP_PERMISSION_MANIFEST, ORGANIZATION_RUNNER_CHECK_NAME } from "@archcontext/contracts";
import { GITHUB_APP_PERMISSIONS, GitHubAppState, InMemoryWebhookDeliveryLedger, verifyGitHubWebhookSignature } from "../src/index";

describe("GitHub App", () => {
  test("uses no Contents permission and handles PR challenge/check lifecycle", () => {
    expect(GITHUB_APP_PERMISSIONS).toBe(GITHUB_APP_PERMISSION_MANIFEST.repositoryPermissions);
    expect(GITHUB_APP_PERMISSIONS).toEqual({
      metadata: "read",
      pull_requests: "read",
      checks: "write",
      contents: "none"
    });
    expect(GITHUB_APP_PERMISSIONS.contents).toBe("none");
    const state = new GitHubAppState();
    state.install(["ancienttwo/arch-context"]);
    expect(state.selectedRepositories.has("ancienttwo/arch-context")).toBe(true);
    const first = state.handlePullRequest({
      deliveryId: "d1",
      action: "opened",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 1, headSha: "abc123" }
    });
    expect(first.checkRun?.status).toBe("queued");
    expect(first.checkRun?.name).toBe(DEVELOPER_REVIEW_CHECK_NAME);
    expect(first.delivery.action).toBe("process");
    const duplicate = state.handlePullRequest({ deliveryId: "d1", action: "opened", repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" }, pullRequest: { number: 1, headSha: "abc123" } });
    expect(duplicate.idempotent).toBe(true);
    expect(duplicate.replayRejected).toBe(true);
    expect(duplicate.delivery.action).toBe("ignore-duplicate");
    expect(state.checks.size).toBe(1);
    expect(state.challenges.size).toBe(1);
    const second = state.handlePullRequest({
      deliveryId: "d2",
      action: "synchronize",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 1, headSha: "def456" }
    });
    expect(second.checkRun?.status).toBe("queued");
    expect(state.checks.get(first.checkRun!.id)?.conclusion).toBe("neutral");
  });

  test("delivery ledger rejects replayed delivery ids by provider", () => {
    const ledger = new InMemoryWebhookDeliveryLedger();
    const first = ledger.recordDelivery({ provider: "github", deliveryId: "delivery-1", receivedAt: "2026-06-20T00:00:00Z" });
    const replay = ledger.recordDelivery({ provider: "github", deliveryId: "delivery-1", receivedAt: "2026-06-20T00:01:00Z" });

    expect(first).toMatchObject({ replay: false, action: "process" });
    expect(replay).toMatchObject({ replay: true, action: "ignore-duplicate" });
    expect(replay.receivedAt).toBe(first.receivedAt);
  });

  test("validates webhook signature", () => {
    const rawBody = Buffer.from('{"ok": true, "nested": {"keep": "spacing"}}\n', "utf8");
    const signature256 = `sha256=${createHmac("sha256", "secret").update(rawBody).digest("hex")}`;
    const reparsedBody = Buffer.from(JSON.stringify(JSON.parse(rawBody.toString("utf8"))), "utf8");

    expect(verifyGitHubWebhookSignature({ secret: "secret", rawBody, signature256 })).toBe(true);
    expect(verifyGitHubWebhookSignature({ secret: "wrong-secret", rawBody, signature256 })).toBe(false);
    expect(verifyGitHubWebhookSignature({ secret: "secret", rawBody: reparsedBody, signature256 })).toBe(false);
    expect(verifyGitHubWebhookSignature({ secret: "secret", rawBody, signature256: signature256.replace("sha256=", "sha1=") })).toBe(false);
    expect(verifyGitHubWebhookSignature({ secret: "secret", rawBody, signature256: "sha256=bad" })).toBe(false);
  });

  test("check runs display trust level and can require organization attestation", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const repository = { provider: "github" as const, owner: "ancienttwo", name: "arch-context", visibility: "private" as const };
    const state = new GitHubAppState();
    state.install(["ancienttwo/arch-context"]);
    state.requireOrganizationAttestation("ancienttwo/arch-context");
    const checkRun = state.handlePullRequest({
      deliveryId: "d3",
      action: "opened",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 2, headSha: "abc123" }
    }).checkRun!;
    expect(checkRun.name).toBe(ORGANIZATION_RUNNER_CHECK_NAME);
    const developerChallenge = createReviewChallenge({ repository, headSha: "abc123", expiresAt: "2026-06-19T00:10:00Z" });
    const developer = signLocalAttestation({
      challenge: developerChallenge,
      worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      reviewDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      deviceId: "device_1",
      publicKeyId: "pk_1",
      privateKey,
      issuedAt: "2026-06-19T00:00:00Z"
    });
    const developerUpdated = state.updateCheckFromAttestation(checkRun.id, developer, true);
    expect(developerUpdated.conclusion).toBe("failure");
    expect(developerUpdated.output?.summary).toContain("## ArchContext / Organization Runner");
    expect(developerUpdated.output?.summary).toContain("Organization attestation required");

    const organizationChallenge = createReviewChallenge({ repository, headSha: "abc123", expiresAt: "2026-06-19T00:10:00Z" });
    const organization = signOrganizationAttestation({
      challenge: organizationChallenge,
      worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      reviewDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      runner: {
        schemaVersion: "archcontext.org-runner-identity/v1",
        runnerId: "runner_1",
        installationId: 123,
        publicKeyId: "org_pk_1",
        publicKeyFingerprint: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
        status: "active",
        createdAt: "2026-06-19T00:00:00Z"
      },
      privateKey,
      issuedAt: "2026-06-19T00:00:00Z"
    });
    const updated = state.updateCheckFromAttestation(checkRun.id, organization, true);
    expect(updated.conclusion).toBe("success");
    expect(updated.output?.title).toBe("Organization-attested");
    expect(updated.output?.summary).toContain("**Result: PASS**");
    expect(updated.output?.summary).toContain("No blocking findings.");
  });
});
