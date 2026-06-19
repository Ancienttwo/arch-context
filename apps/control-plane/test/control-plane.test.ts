import { describe, expect, test } from "bun:test";
import { assertNoUploadRoutes, ControlPlane, routeDigest, WORKER_LIMITS } from "../src/index";
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
});
