import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createReviewChallenge, signOrganizationAttestation } from "../../../packages/attestation/src/index";
import { assertNoUploadRoutes, BILLING_PRICES, ControlPlane, routeDigest, WORKER_LIMITS } from "../src/index";
import { createShortAccessToken, KeychainTokenStore } from "../../../packages/control-plane-client/src/index";

describe("control plane", () => {
  test("routes, worker limits, queue messages, logs, retention, and cost alerts are bounded", () => {
    expect(() => assertNoUploadRoutes()).not.toThrow();
    expect(WORKER_LIMITS.maxBodyBytes).toBeLessThanOrEqual(64 * 1024);
    expect(routeDigest()).toMatch(/^sha256:/);
    const cp = new ControlPlane();
    expect(cp.buildQueueMessage({ kind: "github.pr", id: "d1" })).toEqual({ kind: "github.pr", id: "d1" });
    expect(cp.redactLog("token_secret123 access_secret456")).not.toContain("secret123");
    expect(cp.retentionCutoff("2026-06-19T00:00:00Z")).toBe("2026-03-21T00:00:00.000Z");
    expect(cp.costAlert({ monthlyRevenueUsd: 50, projectedCostUsd: 6 }).alert).toBe(true);
  });

  test("GitHub login, device auth, keychain store, entitlement, and Stripe subscription state work", () => {
    const cp = new ControlPlane();
    const account = cp.loginWithGitHub("42");
    expect(account.id).toBe("acct_42");
    const device = cp.startDeviceAuthorization(account.id);
    expect(cp.completeDeviceAuthorization(device.deviceCode).refreshTokenRef).toMatch(/^keychain:/);
    const keychain = new KeychainTokenStore();
    const ref = keychain.saveRefreshToken(account.id, "refresh_secret");
    expect(keychain.readRefreshToken(ref)).toBe("refresh_secret");
    expect(createShortAccessToken(account.id, 1).claims.exp).toBe(901);
    expect(cp.entitlement({ repositoryVisibility: "public" }).allowed).toBe(true);
    expect(cp.entitlement({ accountId: account.id, repositoryVisibility: "private" }).allowed).toBe(false);
    cp.setSubscription(account.id, "active", "pro");
    expect(cp.entitlement({ accountId: account.id, repositoryVisibility: "private" }).reason).toBe("user-level-pro-private-entitlement");
    expect(cp.stripeCheckout(account.id).priceUsd).toBe(5);
    cp.mapStripeEvent({ id: "evt_1", type: "invoice.payment_failed", accountId: account.id });
    expect(cp.accounts.get(account.id)?.subscriptionStatus).toBe("past_due");
    expect(() => cp.mapStripeEvent({ id: "evt_1", type: "invoice.payment_failed", accountId: account.id })).toThrow("duplicate");
    cp.revokeDevice("device_1");
    expect(cp.revokedDevices.has("device_1")).toBe(true);
  });

  test("annual billing remains per-person and covers all private repositories", () => {
    const cp = new ControlPlane();
    const account = cp.loginWithGitHub("99");
    expect(BILLING_PRICES.annual.priceUsd).toBe(99);
    expect(cp.stripeCheckout(account.id, "annual")).toMatchObject({ priceUsd: 99, billingInterval: "annual" });
    cp.mapStripeEvent({ id: "evt_annual", type: "customer.subscription.created", accountId: account.id, billingInterval: "annual" });
    expect(cp.accounts.get(account.id)?.billingInterval).toBe("annual");
    expect(cp.entitlement({ accountId: account.id, repositoryVisibility: "private" })).toMatchObject({
      allowed: true,
      billingInterval: "annual",
      privateRepositoryScope: "user-all-private-repositories"
    });
    expect(cp.switchBillingInterval(account.id, "monthly")).toMatchObject({ proration: "stripe-managed" });
  });

  test("verifies organization runner attestations without accepting runner revocation", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const cp = new ControlPlane();
    const runner = cp.registerOrgRunner({
      schemaVersion: "archcontext.org-runner-identity/v1",
      runnerId: "runner_acct_42",
      installationId: 12345,
      repositoryNumericIds: [1001],
      publicKeyId: "org_pk_1",
      publicKeyFingerprint: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      status: "active",
      createdAt: "2026-06-19T00:00:00Z"
    });
    const challenge = createReviewChallenge({
      repository: { provider: "github", owner: "ancienttwo", name: "arch-context", visibility: "private" },
      headSha: "abc",
      expiresAt: "2026-06-19T00:10:00Z"
    });
    const attestation = signOrganizationAttestation({
      challenge,
      worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      reviewDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      runner,
      privateKey,
      issuedAt: "2026-06-19T00:00:00Z",
      repositoryNumericId: 1001
    });

    expect(
      cp.verifyOrgRunnerAttestation({
        challenge,
        attestation,
        publicKey,
        now: "2026-06-19T00:01:00Z",
        expectedInstallationId: 12345,
        expectedHeadSha: "abc"
      }).accepted
    ).toBe(true);
    cp.revokeOrgRunner(runner.runnerId, "2026-06-19T00:02:00Z");
    expect(
      cp.verifyOrgRunnerAttestation({
        challenge,
        attestation,
        publicKey,
        now: "2026-06-19T00:01:00Z",
        expectedInstallationId: 12345,
        expectedHeadSha: "abc"
      }).reason
    ).toBe("org-runner-revoked");
  });
});
