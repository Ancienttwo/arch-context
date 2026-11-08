import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { assertNoUploadRoutes, BILLING_PRICES, ControlPlane, CONTROL_PLANE_ROUTES, routeDigest, WORKER_LIMITS } from "../src/index";
import { createShortAccessToken, KeychainTokenStore } from "@archcontext/cloud/control-plane-client";

describe("control plane", () => {
  test("routes, worker limits, queue messages, logs, retention, and cost alerts are bounded", () => {
    expect(() => assertNoUploadRoutes()).not.toThrow();
    expect(WORKER_LIMITS.maxBodyBytes).toBeLessThanOrEqual(64 * 1024);
    expect(WORKER_LIMITS.maxClockSkewMs).toBe(5 * 60 * 1000);
    expect(routeDigest()).toMatch(/^sha256:/);
    expect(CONTROL_PLANE_ROUTES.filter((route) => /^[A-Z]+ \/(v1|github|attestations|org-runners)\//.test(route))).toEqual([]);
    expect(CONTROL_PLANE_ROUTES).toContain("GET /oauth/github/start");
    expect(CONTROL_PLANE_ROUTES).toContain("POST /stripe/webhook");
    const cp = new ControlPlane();
    expect(cp.buildQueueMessage({ kind: "github.pr", id: "d1" })).toEqual({ kind: "github.pr", id: "d1" });
    expect(cp.redactLog("token_secret123 access_secret456")).not.toContain("secret123");
    expect(cp.retentionCutoff("2026-06-19T00:00:00Z")).toBe("2026-03-21T00:00:00.000Z");
    expect(cp.costAlert({ monthlyRevenueUsd: 50, projectedCostUsd: 6 }).alert).toBe(true);
  });

  test("publishes the Control Plane compatibility policy against the served route table", () => {
    const policy = readFileSync("docs/api/control-plane-compatibility-policy.md", "utf8");
    expect(policy).toContain("`CONTROL_PLANE_ROUTES` in `packages/cloud/control-plane/src/routes.ts`");
    expect(policy).toContain("schemas/cloud/cloud-egress-envelope.schema.json");
    expect(policy).toContain("Breaking Changes");
    expect(policy).toContain("Privacy Contract");
    expect(policy).not.toMatch(/upload|blob|embedding|unredacted bearer token/i);
  });

  test("projects log trace queue and error surfaces before storage", () => {
    const cp = new ControlPlane();
    const contentKey = ["source", "Code"].join("");
    const graphKey = ["code", "Graph"].join("");
    const bait = {
      requestId: "req_1",
      routeId: "stripe.webhook",
      installationId: 123,
      repositoryId: 987,
      pullRequestNumber: 42,
      headSha: "abcdef1234567890",
      status: "failed",
      reasonCode: "PAYLOAD_PRIVACY_VIOLATION",
      latencyMs: 12,
      attempt: 2,
      runtimeVersion: "archctx/1.1.0",
      [contentKey]: "function private() {}",
      diff: "@@ private",
      patch: "private-patch",
      filename: "private.ts",
      finding: "leaked detail",
      prompt: "hidden prompt",
      completion: "hidden completion",
      nested: { [graphKey]: "private graph" },
      message: "token_secret123"
    };

    const log = cp.projectLogRecord(bait);
    expect(log).toEqual({
      requestId: "req_1",
      routeId: "stripe.webhook",
      installationId: 123,
      repositoryId: 987,
      status: "failed",
      reasonCode: "PAYLOAD_PRIVACY_VIOLATION",
      latencyMs: 12,
      attempt: 2,
      runtimeVersion: "archctx/1.1.0"
    });

    const trace = cp.projectTraceRecord({ ...bait, spanId: "span_1", parentSpanId: "span_0" });
    expect(trace.spanId).toBe("span_1");
    expect(trace.parentSpanId).toBe("span_0");

    const queue = cp.buildQueueMessage({
      kind: "notification.event",
      id: "evt_1",
      accountId: "acct_1",
      [contentKey]: "function private() {}",
      patch: "private-patch"
    } as any);
    expect(queue).toEqual({ kind: "notification.event", id: "evt_1", accountId: "acct_1" });

    const error = cp.projectErrorObject(new Error("token_secret123 private-patch"), {
      errorCode: "PAYLOAD_PRIVACY_VIOLATION",
      requestId: "req_1",
      statusCode: 400,
      [contentKey]: "function private() {}",
      message: "token_secret123"
    });
    expect(error).toEqual({ errorCode: "PAYLOAD_PRIVACY_VIOLATION", requestId: "req_1", statusCode: 400 });

    const serialized = JSON.stringify([log, trace, queue, error]);
    for (const rejected of ["function private", "@@ private", "private-patch", "private.ts", "hidden prompt", "hidden completion", "token_secret123", "abcdef1234567890"]) {
      expect(serialized).not.toContain(rejected);
    }
  });

  test("enforces API body rate and clock skew limits", () => {
    const cp = new ControlPlane();
    const first = cp.validateApiRequestLimits({
      routeId: "POST /device/authorize",
      clientId: "acct_api_limits",
      bodyBytes: WORKER_LIMITS.maxBodyBytes,
      now: "2026-06-20T09:00:00.000Z",
      receivedAt: "2026-06-20T08:58:00.000Z",
      rateLimitPerMinute: 2
    });
    expect(first).toMatchObject({
      schemaVersion: "archcontext.api-request-limit-validation/v1",
      accepted: true,
      routeId: "POST /device/authorize",
      bodyBytes: WORKER_LIMITS.maxBodyBytes,
      observedSkewMs: 120_000,
      rateLimit: {
        limit: 2,
        remaining: 1,
        windowStartedAt: "2026-06-20T09:00:00.000Z",
        resetAt: "2026-06-20T09:01:00.000Z"
      }
    });
    expect(first.clientIdDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.metadataDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain("acct_api_limits");

    const second = cp.validateApiRequestLimits({
      routeId: "POST /device/authorize",
      clientId: "acct_api_limits",
      bodyBytes: 1024,
      now: "2026-06-20T09:00:30.000Z",
      rateLimitPerMinute: 2
    });
    expect(second.rateLimit.remaining).toBe(0);
    expect(() => cp.validateApiRequestLimits({
      routeId: "POST /device/authorize",
      clientId: "acct_api_limits",
      bodyBytes: 1,
      now: "2026-06-20T09:00:59.000Z",
      rateLimitPerMinute: 2
    })).toThrow("api-rate-limit-exceeded");
    expect(cp.validateApiRequestLimits({
      routeId: "POST /device/authorize",
      clientId: "acct_api_limits",
      bodyBytes: 1,
      now: "2026-06-20T09:01:00.000Z",
      rateLimitPerMinute: 2
    }).rateLimit.remaining).toBe(1);
    expect(() => cp.validateApiRequestLimits({
      routeId: "POST /device/authorize",
      clientId: "acct_large_body",
      bodyBytes: WORKER_LIMITS.maxBodyBytes + 1,
      now: "2026-06-20T09:02:00.000Z"
    })).toThrow("api-body-too-large");
    expect(() => cp.validateApiRequestLimits({
      routeId: "POST /device/authorize",
      clientId: "acct_skew",
      bodyBytes: 1,
      now: "2026-06-20T09:02:00.000Z",
      receivedAt: "2026-06-20T08:56:59.999Z"
    })).toThrow("api-clock-skew-too-large");
    expect(() => cp.validateApiRequestLimits({
      routeId: "POST /device/authorize",
      clientId: "acct_bad_body",
      bodyBytes: -1,
      now: "2026-06-20T09:02:00.000Z"
    })).toThrow("api-body-size-invalid");
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
    cp.setNotificationProvider({
      schemaVersion: "archcontext.notification-provider/v1",
      id: "notification-provider.account-delete",
      provider: "webhook",
      enabled: true,
      target: "https://notify.example",
      secretRef: "secret://account-delete",
      retry: { maxAttempts: 3, backoffSeconds: 30 }
    }, { accountId: account.id });
    expect(cp.listNotificationProviders({ accountId: account.id }).map((config) => config.id)).toContain("notification-provider.account-delete");
    cp.deleteAccount(account.id);
    expect(cp.exportAccount(account.id).account).toBeUndefined();
    expect(cp.listNotificationProviders({ accountId: account.id }).map((config) => config.id)).not.toContain("notification-provider.account-delete");
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

  test("stores opt-in notification providers and queues minimal notification events only", () => {
    const cp = new ControlPlane();
    expect(cp.listNotificationProviders().filter((config) => config.enabled).map((config) => config.provider)).toEqual(["github-check"]);
    cp.setNotificationProvider({
      schemaVersion: "archcontext.notification-provider/v1",
      id: "notification-provider.webhook",
      provider: "webhook",
      enabled: true,
      target: "https://notify.example",
      secretRef: "secret://notify",
      retry: { maxAttempts: 3, backoffSeconds: 30 }
    }, { accountId: "acct_42", installationId: 123 });
    expect(cp.listNotificationProviders({ accountId: "acct_42" }).map((config) => config.id)).toContain("notification-provider.webhook");
    expect(cp.listNotificationProviders({ accountId: "acct_other" }).map((config) => config.id)).not.toContain("notification-provider.webhook");
    const queued = cp.enqueueNotification({
      schemaVersion: "archcontext.notification-event/v1",
      eventId: "notification.review-complete",
      prUrl: "https://github.com/ancienttwo/arch-context/pull/12",
      result: "pass",
      riskLevel: "low",
      commitSha: "abc1234",
      runtimeVersion: "archctx/1.1.0",
      occurredAt: "2026-06-19T00:00:00Z"
    });
    expect(queued.queueMessage.kind).toBe("notification.event");
    expect(queued.payloadDigest).toMatch(/^sha256:/);
    expect(cp.notificationQueue).toHaveLength(1);
    expect(cp.notificationQueue[0]).not.toHaveProperty("findings");
    expect(() => cp.enqueueNotification({
      schemaVersion: "archcontext.notification-event/v1",
      eventId: "notification.review-private",
      prUrl: "https://github.com/ancienttwo/arch-context/pull/12",
      result: "pass",
      riskLevel: "low",
      commitSha: "abc1234",
      runtimeVersion: "archctx/1.1.0",
      occurredAt: "2026-06-19T00:00:00Z",
      findings: [{ message: "private" }]
    } as any)).toThrow("non-minimal");
    expect(() => cp.setNotificationProvider({ schemaVersion: "archcontext.notification-provider/v1", id: "notification-provider.slack", provider: "slack", enabled: true, target: "slack", retry: { maxAttempts: 1, backoffSeconds: 1 } })).toThrow("secret-ref");
  });

  test("publishes ChatGPT Directory metadata and rollback strategy without repository content", () => {
    const cp = new ControlPlane();
    const listing = cp.buildChatGptDirectoryListing();
    expect(listing.slug).toBe("archcontext");
    expect(listing.repositoryContent).toBe("local-runtime-only");
    expect(cp.appReviewChecklist().writes).toBe("disabled-by-default-local-confirmation-required");
    expect(cp.rollbackChatGptRelease("1.1.0")).toEqual({ rolledBack: true, version: "1.1.0" });
  });
});
