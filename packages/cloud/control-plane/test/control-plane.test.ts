import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { canonicalAttestationV2, createAttestationV2, createReviewChallenge, createReviewChallengeV2, publicKeyFingerprint, signLocalAttestation, signOrganizationAttestation } from "@archcontext/cloud/attestation";
import { apiIdempotencyKeyDigest, assertControlPlaneAuditEventMinimal, assertNoUploadRoutes, auditControlPlaneAuditEvent, BILLING_PRICES, CHALLENGE_API_REQUEST_SCHEMA_VERSIONS, CHECK_DELIVERY_QUEUE_MESSAGE_SCHEMA_VERSION, CloudflareCheckDeliveryQueuePort, ControlPlane, CONTROL_PLANE_ALERT_RUNBOOK_PATH, CONTROL_PLANE_ROUTES, DEFAULT_REVIEW_CHALLENGE_LEASE_TTL_MS, DEFAULT_REVIEW_CHALLENGE_TTL_MS, DEFAULT_RUNNER_KEY_ROTATION_OVERLAP_MS, KEY_API_REQUEST_SCHEMA_VERSIONS, reviewChallengeNonceHash, routeDigest, WORKER_LIMITS } from "../src/index";
import { createShortAccessToken, KeychainTokenStore } from "@archcontext/cloud/control-plane-client";
import { checkDeliveryIdempotencyKey, d1MigrationSql } from "@archcontext/cloud/cloud-db";
import type { CheckDelivery } from "@archcontext/contracts";

const CONTROL_PLANE_ATTESTATION_KEYPAIR = generateKeyPairSync("ed25519");

describe("control plane", () => {
  test("routes, worker limits, queue messages, logs, retention, and cost alerts are bounded", () => {
    expect(() => assertNoUploadRoutes()).not.toThrow();
    expect(WORKER_LIMITS.maxBodyBytes).toBeLessThanOrEqual(64 * 1024);
    expect(WORKER_LIMITS.maxClockSkewMs).toBe(5 * 60 * 1000);
    expect(routeDigest()).toMatch(/^sha256:/);
    expect(CONTROL_PLANE_ROUTES).toContain("POST /v1/challenges");
    expect(CONTROL_PLANE_ROUTES).toContain("POST /v1/challenges/:challenge/attestations");
    expect(CONTROL_PLANE_ROUTES).toContain("POST /v1/device-keys");
    expect(CONTROL_PLANE_ROUTES).toContain("POST /v1/runner-keys/:runner/rotate");
    const cp = new ControlPlane();
    expect(cp.buildQueueMessage({ kind: "github.pr", id: "d1" })).toEqual({ kind: "github.pr", id: "d1" });
    expect(cp.redactLog("token_secret123 access_secret456")).not.toContain("secret123");
    expect(cp.retentionCutoff("2026-06-19T00:00:00Z")).toBe("2026-03-21T00:00:00.000Z");
    expect(cp.costAlert({ monthlyRevenueUsd: 50, projectedCostUsd: 6 }).alert).toBe(true);
  });

  test("publishes Control Plane OpenAPI and compatibility policy for schema-versioned routes", () => {
    const openApi = readFileSync("docs/api/control-plane-openapi.yaml", "utf8");
    const policy = readFileSync("docs/api/control-plane-compatibility-policy.md", "utf8");
    const documentedRoutes = CONTROL_PLANE_ROUTES.filter((route) => route.startsWith("GET /v1/") || route.startsWith("POST /v1/") || route === "POST /github/webhook");
    for (const route of documentedRoutes) {
      const [method, routePath] = route.split(" ");
      expect(openApi).toContain(`${routePath.replace(/:([^/]+)/g, "{$1}")}:`);
      expect(openApi).toContain(`    ${method.toLowerCase()}:`);
    }
    for (const schemaVersion of Object.values(CHALLENGE_API_REQUEST_SCHEMA_VERSIONS)) {
      expect(openApi).toContain(schemaVersion);
      expect(policy).toContain(schemaVersion);
    }
    for (const schemaVersion of Object.values(KEY_API_REQUEST_SCHEMA_VERSIONS)) {
      expect(openApi).toContain(schemaVersion);
      expect(policy).toContain(schemaVersion);
    }
    for (const schemaPath of [
      "schemas/cloud/review-challenge-v2.schema.json",
      "schemas/cloud/attestation-v2.schema.json",
      "schemas/cloud/check-delivery.schema.json",
      "schemas/cloud/runner-identity.schema.json",
      "schemas/cloud/device-identity.schema.json"
    ]) {
      expect(policy).toContain(schemaPath);
    }
    expect(policy).toContain("Breaking Changes");
    expect(policy).toContain("Privacy Contract");
    expect(JSON.stringify([openApi, policy])).not.toMatch(/upload|blob|embedding|unredacted bearer token/i);
  });

  test("projects log trace queue and error surfaces before storage", () => {
    const cp = new ControlPlane();
    const contentKey = ["source", "Code"].join("");
    const graphKey = ["code", "Graph"].join("");
    const bait = {
      requestId: "req_1",
      routeId: "github.webhook",
      installationId: 123,
      repositoryId: 987,
      pullRequestNumber: 42,
      headSha: "abcdef1234567890",
      challengeId: "challenge_1",
      attestationId: "att_1",
      checkDeliveryId: "check_1",
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
      routeId: "github.webhook",
      installationId: 123,
      repositoryId: 987,
      pullRequestNumber: 42,
      headShaPrefix: "abcdef123456",
      challengeId: "challenge_1",
      attestationId: "att_1",
      checkDeliveryId: "check_1",
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

  test("raises metadata-only control-plane alerts with runbook guidance", () => {
    const cp = new ControlPlane();
    const runnerKeyPair = generateKeyPairSync("ed25519");
    const runnerAuthorization = {
      actorId: "github_user_alert_admin",
      actorLogin: "alert-admin",
      installationId: 10001,
      repositoryAdminIds: [20002],
      permissionSource: "test-fixture" as const,
      verifiedAt: "2026-06-20T09:02:00.000Z",
      reason: "alert-runbook-test"
    };
    const runner = cp.registerRunnerKey({
      installationId: 10001,
      scope: { kind: "repository", repositoryIds: [20002] },
      workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/tags/v1",
      publicKeyId: "key_alert_runner_0001",
      publicKey: runnerKeyPair.publicKey,
      createdAt: "2026-06-20T09:02:00.000Z",
      authorization: runnerAuthorization
    });
    cp.revokeRunnerKey({
      runnerId: runner.runnerId,
      revokedAt: "2026-06-20T09:08:00.000Z",
      authorization: runnerAuthorization
    });
    const deadLetter: CheckDelivery = {
      schemaVersion: "archcontext.check-delivery/v1",
      deliveryId: checkDeliveryIdempotencyKey({
        challengeId: "chal_alert_dlq",
        checkName: "ArchContext / Developer Review",
        headSha: "a".repeat(40)
      }),
      challengeId: "chal_alert_dlq",
      checkRunId: null,
      checkName: "ArchContext / Developer Review",
      headSha: "a".repeat(40),
      status: "DEAD_LETTER",
      attemptCount: 3,
      nextAttemptAt: null,
      lastErrorCode: "CHECK_DELIVERY_MAX_ATTEMPTS",
      createdAt: "2026-06-20T09:00:00.000Z",
      updatedAt: "2026-06-20T09:06:00.000Z"
    };

    const alerts = cp.evaluateControlPlaneAlerts({
      now: "2026-06-20T09:10:00.000Z",
      webhookBacklog: {
        pendingCount: 11,
        oldestReceivedAt: "2026-06-20T09:00:00.000Z"
      },
      verifyFailures: {
        failureCount: 2,
        reasonCode: "TRUST_LEVEL_MISMATCH"
      },
      checkDeliveries: [deadLetter],
      githubApiFailures: {
        failureCount: 3,
        statusCode: 503,
        retryable: true,
        windowStartedAt: "2026-06-20T09:08:30.000Z"
      },
      signatureFailures: {
        failureCount: 6,
        windowStartedAt: "2026-06-20T09:08:00.000Z"
      },
      thresholds: {
        webhookBacklogCount: 10,
        webhookBacklogOldestAgeMs: 5 * 60 * 1000,
        checkDlqCount: 1,
        verifyFailureCount: 1,
        githubApiFailureCount: 2,
        githubApiFailureWindowMs: 5 * 60 * 1000,
        signatureFailureCount: 5,
        signatureFailureWindowMs: 5 * 60 * 1000,
        keyRevocationCount: 1,
        keyRevocationWindowMs: 15 * 60 * 1000
      }
    });

    expect(alerts.map((alert) => alert.kind)).toEqual(["webhook-backlog", "verify-failure", "check-dlq", "github-api-failure", "signature-spike", "key-revoke"]);
    expect(alerts[0]).toMatchObject({
      schemaVersion: "archcontext.control-plane-alert/v1",
      severity: "critical",
      status: "firing",
      runbook: { path: CONTROL_PLANE_ALERT_RUNBOOK_PATH, section: "webhook-backlog" },
      metrics: { pendingCount: 11, oldestAgeMs: 600000 }
    });
    expect(alerts[1]).toMatchObject({
      labels: {
        kind: "verify-failure",
        reasonCode: "TRUST_LEVEL_MISMATCH",
        status: "failed",
        surface: "verify"
      },
      metrics: { failureCount: 2, thresholdCount: 1 }
    });
    expect(alerts[2]).toMatchObject({
      labels: {
        checkName: "ArchContext / Developer Review",
        kind: "check-dlq",
        reasonCode: "CHECK_DELIVERY_MAX_ATTEMPTS",
        status: "DEAD_LETTER",
        surface: "queue"
      }
    });
    expect(alerts[3]).toMatchObject({
      labels: {
        kind: "github-api-failure",
        retryable: "true",
        status: "failed",
        surface: "github-api"
      },
      metrics: { failureCount: 3, statusCode: 503, retryable: 1, windowAgeMs: 90000 }
    });
    expect(alerts[4].metrics).toMatchObject({ failureCount: 6, windowAgeMs: 120000 });
    expect(alerts[5].metrics).toMatchObject({ revocationCount: 1, thresholdWindowMs: 900000 });
    for (const alert of alerts) {
      expect(alert.alertId).toMatch(/^alert_[a-f0-9]{16}$/);
      expect(alert.metadataDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    }

    const runbook = readFileSync(CONTROL_PLANE_ALERT_RUNBOOK_PATH, "utf8");
    for (const kind of alerts.map((alert) => alert.kind)) {
      expect(runbook).toContain(`## ${kind}`);
    }
    const serialized = JSON.stringify(alerts);
    for (const rejected of ["alert-admin", "key_alert_runner_0001", "archcontext-review.yml", runnerKeyPair.privateKey.export({ format: "pem", type: "pkcs8" }).toString()]) {
      expect(serialized).not.toContain(rejected);
    }
  });

  test("enforces API body rate clock skew and Challenge expiry limits", () => {
    const cp = new ControlPlane();
    const first = cp.validateApiRequestLimits({
      routeId: "POST /v1/challenges",
      clientId: "acct_api_limits",
      bodyBytes: WORKER_LIMITS.maxBodyBytes,
      now: "2026-06-20T09:00:00.000Z",
      receivedAt: "2026-06-20T08:58:00.000Z",
      rateLimitPerMinute: 2
    });
    expect(first).toMatchObject({
      schemaVersion: "archcontext.api-request-limit-validation/v1",
      accepted: true,
      routeId: "POST /v1/challenges",
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
      routeId: "POST /v1/challenges",
      clientId: "acct_api_limits",
      bodyBytes: 1024,
      now: "2026-06-20T09:00:30.000Z",
      rateLimitPerMinute: 2
    });
    expect(second.rateLimit.remaining).toBe(0);
    expect(() => cp.validateApiRequestLimits({
      routeId: "POST /v1/challenges",
      clientId: "acct_api_limits",
      bodyBytes: 1,
      now: "2026-06-20T09:00:59.000Z",
      rateLimitPerMinute: 2
    })).toThrow("api-rate-limit-exceeded");
    expect(cp.validateApiRequestLimits({
      routeId: "POST /v1/challenges",
      clientId: "acct_api_limits",
      bodyBytes: 1,
      now: "2026-06-20T09:01:00.000Z",
      rateLimitPerMinute: 2
    }).rateLimit.remaining).toBe(1);
    expect(() => cp.validateApiRequestLimits({
      routeId: "POST /v1/challenges",
      clientId: "acct_large_body",
      bodyBytes: WORKER_LIMITS.maxBodyBytes + 1,
      now: "2026-06-20T09:02:00.000Z"
    })).toThrow("api-body-too-large");
    expect(() => cp.validateApiRequestLimits({
      routeId: "POST /v1/challenges",
      clientId: "acct_skew",
      bodyBytes: 1,
      now: "2026-06-20T09:02:00.000Z",
      receivedAt: "2026-06-20T08:56:59.999Z"
    })).toThrow("api-clock-skew-too-large");
    expect(() => cp.validateApiRequestLimits({
      routeId: "POST /v1/challenges",
      clientId: "acct_bad_body",
      bodyBytes: -1,
      now: "2026-06-20T09:02:00.000Z"
    })).toThrow("api-body-size-invalid");

    expect(cp.validateReviewChallengeExpiryLimits({
      createdAt: "2026-06-20T09:00:00.000Z",
      expiresAt: "2026-06-20T09:15:00.000Z"
    })).toMatchObject({
      accepted: true,
      ttlMs: DEFAULT_REVIEW_CHALLENGE_TTL_MS,
      maxTtlMs: DEFAULT_REVIEW_CHALLENGE_TTL_MS
    });
    expect(() => cp.issueReviewChallenge({
      ...reviewChallengeInput({ challengeId: "chal_api_limits_ttl", nonce: "nonce_api_limits_ttl" }),
      expiresAt: "2026-06-20T09:15:00.001Z"
    })).toThrow("review-challenge-expiry-too-long");
    expect(() => cp.issueReviewChallenge({
      ...reviewChallengeInput({ challengeId: "chal_api_limits_expiry", nonce: "nonce_api_limits_expiry" }),
      createdAt: "2026-06-20T09:00:00.000Z",
      expiresAt: "2026-06-20T08:59:59.000Z"
    })).toThrow("review-challenge-expiry-invalid");
  });

  test("gates governance feature flags across Challenge and Check delivery side effects", () => {
    const cp = new ControlPlane();
    expect(cp.getGovernanceFeatureFlags()).toEqual({
      schemaVersion: "archcontext.governance-feature-flags/v1",
      developerCheck: true,
      organizationCheck: true,
      requiredTrust: true
    });
    expect(cp.evaluateGovernanceFeatureFlags({ requiredTrust: "organization" })).toMatchObject({
      allowed: true,
      reason: "enabled",
      checkName: "ArchContext / Organization Runner"
    });

    cp.setGovernanceFeatureFlags({ requiredTrust: false });
    expect(() => cp.createReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.create,
      idempotencyKey: "feature-required-trust-off",
      ...reviewChallengeInput({
        challengeId: "chal_feature_required_trust_off",
        nonce: "nonce_feature_required_trust_off",
        requiredTrust: "organization"
      })
    })).toThrow("governance-feature-disabled: required-trust-disabled");

    cp.setGovernanceFeatureFlags({ organizationCheck: false });
    expect(() => cp.createReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.create,
      idempotencyKey: "feature-organization-check-off",
      ...reviewChallengeInput({
        challengeId: "chal_feature_organization_check_off",
        nonce: "nonce_feature_organization_check_off",
        requiredTrust: "organization"
      })
    })).toThrow("governance-feature-disabled: organization-check-disabled");

    cp.setGovernanceFeatureFlags({ developerCheck: false });
    expect(() => cp.createReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.create,
      idempotencyKey: "feature-developer-check-off",
      ...reviewChallengeInput({
        challengeId: "chal_feature_developer_check_off",
        nonce: "nonce_feature_developer_check_off",
        requiredTrust: "developer"
      })
    })).toThrow("governance-feature-disabled: developer-check-disabled");

    cp.setGovernanceFeatureFlags({ developerCheck: true, organizationCheck: true, requiredTrust: true });
    const challenge = cp.createReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.create,
      idempotencyKey: "feature-developer-check-on",
      ...reviewChallengeInput({
        challengeId: "chal_feature_developer_check_on",
        nonce: "nonce_feature_developer_check_on",
        requiredTrust: "developer"
      })
    });
    const checkDelivery: CheckDelivery = {
      schemaVersion: "archcontext.check-delivery/v1",
      deliveryId: checkDeliveryIdempotencyKey({
        challengeId: challenge.challengeId,
        checkName: "ArchContext / Developer Review",
        headSha: challenge.headSha
      }),
      challengeId: challenge.challengeId,
      checkRunId: null,
      checkName: "ArchContext / Developer Review",
      headSha: challenge.headSha,
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
      createdAt: "2026-06-20T09:05:00.000Z",
      updatedAt: "2026-06-20T09:05:00.000Z"
    };
    expect(cp.buildCheckDeliveryQueueMessage({
      checkDelivery,
      payloadDigest: "sha256:9999999999999999999999999999999999999999999999999999999999999999"
    }).checkName).toBe("ArchContext / Developer Review");
    cp.setGovernanceFeatureFlags({ developerCheck: false });
    expect(() => cp.buildCheckDeliveryQueueMessage({
      checkDelivery,
      payloadDigest: "sha256:9999999999999999999999999999999999999999999999999999999999999999"
    })).toThrow("governance-feature-disabled: developer-check-disabled");
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

  test("registers, displays, and revokes Device Keys as metadata-only governance status", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const cp = new ControlPlane();
    const account = cp.loginWithGitHub("43");

    const device = cp.registerDeviceKey({
      accountId: account.id,
      publicKeyId: "key_device_0001",
      publicKey,
      createdAt: "2026-06-20T10:00:00Z"
    });
    const fingerprint = publicKeyFingerprint(publicKey);

    expect(device).toEqual({
      schemaVersion: "archcontext.device-identity/v1",
      deviceId: device.deviceId,
      accountId: account.id,
      publicKeyId: "key_device_0001",
      publicKeyFingerprint: fingerprint,
      status: "active",
      createdAt: "2026-06-20T10:00:00Z"
    });
    expect(device.deviceId).toMatch(/^device_[a-f0-9]{16}$/);
    expect(cp.displayDeviceKeyFingerprint(device.deviceId)).toEqual({
      deviceId: device.deviceId,
      publicKeyId: "key_device_0001",
      fingerprint,
      status: "active",
      createdAt: "2026-06-20T10:00:00Z"
    });
    expect(cp.getDeviceKeyStatus(device.deviceId)).toEqual({
      schemaVersion: "archcontext.governance-key-status/v1",
      publicKeyId: "key_device_0001",
      ownerKind: "device",
      ownerId: device.deviceId,
      fingerprint,
      status: "active",
      createdAt: "2026-06-20T10:00:00Z"
    });
    expect(cp.listDeviceKeys(account.id)).toEqual([device]);
    expect(cp.exportAccount(account.id).devices).toEqual([device]);
    expect(JSON.stringify(device)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(device)).not.toContain(publicKey.export({ format: "pem", type: "spki" }).toString());
    expect(JSON.stringify(cp.exportAccount(account.id))).not.toContain(privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    expect(() => cp.registerDeviceKey({
      accountId: account.id,
      publicKeyId: "key_device_0001",
      publicKey: generateKeyPairSync("ed25519").publicKey,
      createdAt: "2026-06-20T10:01:00Z"
    })).toThrow("device-key-already-active");

    const revoked = cp.revokeDeviceKey(device.deviceId, "2026-06-20T10:05:00Z");
    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedAt).toBe("2026-06-20T10:05:00Z");
    expect(cp.revokedDevices.has(device.deviceId)).toBe(true);
    expect(cp.getDeviceKeyStatus(device.deviceId)).toMatchObject({
      publicKeyId: "key_device_0001",
      ownerKind: "device",
      ownerId: device.deviceId,
      fingerprint,
      status: "revoked",
      revokedAt: "2026-06-20T10:05:00Z"
    });
    expect(() => cp.registerDeviceKey({
      accountId: account.id,
      publicKeyId: "key_device_0002",
      publicKey,
      deviceId: device.deviceId,
      createdAt: "2026-06-20T10:06:00Z"
    })).toThrow("device-revoked");

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
    expect(cp.exportAccount(account.id).devices).toEqual([]);
    expect(cp.revokedDevices.has(device.deviceId)).toBe(false);
    expect(cp.listNotificationProviders({ accountId: account.id }).map((config) => config.id)).not.toContain("notification-provider.account-delete");
  });

  test("registers, rotates with overlap, and revokes Runner Keys as metadata-only governance status", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const rotatedKeyPair = generateKeyPairSync("ed25519");
    const duplicateKeyPair = generateKeyPairSync("ed25519");
    const cp = new ControlPlane();
    const repoAdminAuthorization = {
      actorId: "github_user_100",
      actorLogin: "octo-admin",
      installationId: 10001,
      repositoryAdminIds: [20002],
      permissionSource: "test-fixture" as const,
      verifiedAt: "2026-06-20T09:59:59Z",
      reason: "runner-key-lifecycle-test"
    };
    const orgAdminAuthorization = {
      actorId: "github_user_200",
      actorLogin: "org-admin",
      installationId: 10002,
      organizationAdmin: true,
      permissionSource: "test-fixture" as const,
      verifiedAt: "2026-06-20T10:06:59Z",
      reason: "org-runner-key-lifecycle-test"
    };

    expect(() => cp.registerRunnerKey({
      installationId: 10001,
      repositoryIds: [20002],
      workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
      publicKeyId: "key_runner_denied",
      publicKey: generateKeyPairSync("ed25519").publicKey,
      createdAt: "2026-06-20T09:59:00Z",
      authorization: { ...repoAdminAuthorization, repositoryAdminIds: [99999] }
    })).toThrow("runner-key-admin-repository-required");
    expect(cp.listAuditEvents()).toEqual([]);

    const runner = cp.registerRunnerKey({
      installationId: 10001,
      repositoryIds: [20002],
      workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
      publicKeyId: "key_runner_0001",
      publicKey,
      createdAt: "2026-06-20T10:00:00Z",
      authorization: repoAdminAuthorization
    });
    const fingerprint = publicKeyFingerprint(publicKey);

    expect(runner).toMatchObject({
      schemaVersion: "archcontext.runner-identity/v1",
      installationId: 10001,
      repositoryIds: [20002],
      scope: { kind: "repository", repositoryIds: [20002] },
      workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
      publicKeyId: "key_runner_0001",
      publicKeyFingerprint: fingerprint,
      status: "active",
      createdAt: "2026-06-20T10:00:00Z",
      rotatedAt: null,
      revokedAt: null
    });
    expect(runner.runnerId).toMatch(/^runner_[a-f0-9]{16}$/);
    expect(cp.displayRunnerKeyFingerprint(runner.runnerId)).toEqual({
      runnerId: runner.runnerId,
      installationId: 10001,
      repositoryIds: [20002],
      scope: { kind: "repository", repositoryIds: [20002] },
      workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
      publicKeyId: "key_runner_0001",
      fingerprint,
      status: "active",
      createdAt: "2026-06-20T10:00:00Z",
      rotatedAt: null,
      revokedAt: null
    });
    expect(cp.getRunnerKeyStatus(runner.runnerId)).toEqual({
      schemaVersion: "archcontext.governance-key-status/v1",
      publicKeyId: "key_runner_0001",
      ownerKind: "runner",
      ownerId: runner.runnerId,
      fingerprint,
      status: "active",
      createdAt: "2026-06-20T10:00:00Z",
      rotatedAt: null,
      revokedAt: null
    });
    expect(cp.listRunnerKeys(10001)).toEqual([runner]);
    expect(cp.isRunnerKeyAccepted({
      runnerId: runner.runnerId,
      installationId: 10001,
      repositoryId: 20002,
      workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
      now: "2026-06-20T10:01:00Z"
    })).toBe(true);
    expect(cp.isRunnerKeyAccepted({ runnerId: runner.runnerId, installationId: 10001, repositoryId: 99999, now: "2026-06-20T10:01:00Z" })).toBe(false);
    expect(JSON.stringify(runner)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(runner)).not.toContain(privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    expect(() => cp.registerRunnerKey({
      installationId: 10001,
      repositoryIds: [20002],
      workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
      publicKeyId: "key_runner_0001",
      publicKey: duplicateKeyPair.publicKey,
      createdAt: "2026-06-20T10:02:00Z",
      authorization: repoAdminAuthorization
    })).toThrow("runner-key-already-active");

    const rotation = cp.rotateRunnerKey({
      runnerId: runner.runnerId,
      publicKeyId: "key_runner_0002",
      publicKey: rotatedKeyPair.publicKey,
      rotatedAt: "2026-06-20T10:05:00Z",
      overlapMs: DEFAULT_RUNNER_KEY_ROTATION_OVERLAP_MS,
      authorization: repoAdminAuthorization
    });
    expect(rotation.previous.status).toBe("rotating");
    expect(rotation.previous.rotatedAt).toBe("2026-06-20T10:05:00Z");
    expect(rotation.next.status).toBe("active");
    expect(rotation.next.publicKeyId).toBe("key_runner_0002");
    expect(rotation.next.publicKeyFingerprint).toBe(publicKeyFingerprint(rotatedKeyPair.publicKey));
    expect(rotation.rotationWindow).toEqual({
      previousRunnerId: runner.runnerId,
      nextRunnerId: rotation.next.runnerId,
      rotatedAt: "2026-06-20T10:05:00Z",
      overlapUntil: "2026-06-20T10:20:00.000Z"
    });
    expect(cp.getRunnerKeyRotationWindow(runner.runnerId)).toEqual(rotation.rotationWindow);
    expect(cp.isRunnerKeyAccepted({ runnerId: runner.runnerId, installationId: 10001, repositoryId: 20002, now: "2026-06-20T10:10:00Z" })).toBe(true);
    expect(cp.isRunnerKeyAccepted({ runnerId: runner.runnerId, installationId: 10001, repositoryId: 20002, now: "2026-06-20T10:21:00Z" })).toBe(false);
    expect(cp.isRunnerKeyAccepted({ runnerId: rotation.next.runnerId, installationId: 10001, repositoryId: 20002, now: "2026-06-20T10:21:00Z" })).toBe(true);
    expect(() => cp.rotateRunnerKey({
      runnerId: runner.runnerId,
      publicKeyId: "key_runner_0003",
      publicKey: generateKeyPairSync("ed25519").publicKey,
      rotatedAt: "2026-06-20T10:06:00Z",
      authorization: repoAdminAuthorization
    })).toThrow("runner-key-rotation-not-active");

    expect(() => cp.registerRunnerKey({
      installationId: 10002,
      scope: { kind: "organization" },
      workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/tags/v1",
      publicKeyId: "key_runner_org_denied",
      publicKey: generateKeyPairSync("ed25519").publicKey,
      createdAt: "2026-06-20T10:06:30Z",
      authorization: { ...repoAdminAuthorization, installationId: 10002, repositoryAdminIds: [20002] }
    })).toThrow("runner-key-admin-organization-required");

    const orgRunner = cp.registerRunnerKey({
      installationId: 10002,
      scope: { kind: "organization" },
      workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/tags/v1",
      publicKeyId: "key_runner_org_0001",
      publicKey: generateKeyPairSync("ed25519").publicKey,
      createdAt: "2026-06-20T10:07:00Z",
      authorization: orgAdminAuthorization
    });
    expect(orgRunner.repositoryIds).toEqual([]);
    expect(cp.isRunnerKeyAccepted({ runnerId: orgRunner.runnerId, installationId: 10002, repositoryId: 99999, now: "2026-06-20T10:08:00Z" })).toBe(true);

    const revoked = cp.revokeRunnerKey({
      runnerId: rotation.next.runnerId,
      revokedAt: "2026-06-20T10:22:00Z",
      authorization: repoAdminAuthorization
    });
    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedAt).toBe("2026-06-20T10:22:00Z");
    expect(cp.isRunnerKeyAccepted({ runnerId: rotation.next.runnerId, installationId: 10001, repositoryId: 20002, now: "2026-06-20T10:22:01Z" })).toBe(false);
    expect(cp.getRunnerKeyStatus(rotation.next.runnerId)).toMatchObject({
      publicKeyId: "key_runner_0002",
      ownerKind: "runner",
      ownerId: rotation.next.runnerId,
      status: "revoked",
      revokedAt: "2026-06-20T10:22:00Z"
    });
    const auditEvents = cp.listAuditEvents();
    expect(auditEvents.map((event) => event.action)).toEqual([
      "runner_key.register",
      "runner_key.rotate",
      "runner_key.register",
      "runner_key.revoke"
    ]);
    expect(cp.listAuditEvents({ actorId: "github_user_100", runnerId: runner.runnerId }).map((event) => event.action)).toEqual([
      "runner_key.register",
      "runner_key.rotate"
    ]);
    expect(auditEvents[0]).toMatchObject({
      schemaVersion: "archcontext.audit-event/v1",
      actor: { id: "github_user_100" },
      resource: {
        kind: "runner-key",
        id: runner.runnerId,
        installationId: 10001,
        scopeKind: "repository",
        repositoryIds: [20002]
      },
      reason: "runner-key-lifecycle-test"
    });
    expect(auditEvents[1].resource.relatedResourceId).toBe(rotation.next.runnerId);
    expect(auditEvents[0].eventId).toMatch(/^audit_[a-f0-9]{16}$/);
    expect(auditEvents[0].metadataDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(auditControlPlaneAuditEvent(auditEvents[0] as unknown as Record<string, unknown>)).toEqual({ ok: true, findings: [] });
    const serializedAuditEvents = JSON.stringify(auditEvents);
    expect(serializedAuditEvents).not.toContain("octo-admin");
    expect(serializedAuditEvents).not.toContain("key_runner_0001");
    expect(serializedAuditEvents).not.toContain(fingerprint);
    expect(serializedAuditEvents).not.toContain("archcontext-review.yml");
    expect(serializedAuditEvents).not.toContain(privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    expect(auditControlPlaneAuditEvent({
      ...auditEvents[0],
      actorLogin: "octo-admin"
    } as unknown as Record<string, unknown>).findings).toContain("non-minimal audit field: actorLogin");
    expect(auditControlPlaneAuditEvent({
      ...auditEvents[0],
      resource: {
        ...auditEvents[0].resource,
        publicKeyFingerprint: fingerprint
      }
    } as unknown as Record<string, unknown>).findings).toContain("non-minimal audit resource field: publicKeyFingerprint");
    expect(() => assertControlPlaneAuditEventMinimal({
      ...auditEvents[0],
      resource: {
        ...auditEvents[0].resource,
        findingDetail: "Detailed finding with private patch"
      }
    } as unknown as Record<string, unknown>)).toThrow("control-plane-audit-event-non-minimal");
  });

  test("exposes schema-versioned Device and Runner Key APIs with scoped authorization", () => {
    const cp = new ControlPlane();
    const account = cp.loginWithGitHub("44");
    const deviceKeyPair = generateKeyPairSync("ed25519");
    const deviceAuthorization = {
      actorId: "github_user_44",
      actorLogin: "device-owner",
      accountId: account.id,
      permissionSource: "test-fixture" as const,
      verifiedAt: "2026-06-20T10:29:59Z",
      reason: "device-key-api-test"
    };
    const contentKey = ["source", "Code"].join("");

    const device = cp.registerDeviceKeyApi({
      schemaVersion: KEY_API_REQUEST_SCHEMA_VERSIONS.deviceRegister,
      accountId: account.id,
      publicKeyId: "key_device_api_0001",
      publicKey: deviceKeyPair.publicKey,
      createdAt: "2026-06-20T10:30:00Z",
      authorization: deviceAuthorization
    });
    expect(device).toMatchObject({
      accountId: account.id,
      publicKeyId: "key_device_api_0001",
      status: "active"
    });
    expect(() => cp.registerDeviceKeyApi({
      schemaVersion: KEY_API_REQUEST_SCHEMA_VERSIONS.deviceRegister,
      accountId: account.id,
      publicKeyId: "key_device_api_denied",
      publicKey: generateKeyPairSync("ed25519").publicKey,
      createdAt: "2026-06-20T10:30:30Z",
      authorization: { ...deviceAuthorization, accountId: "acct_other" }
    })).toThrow("device-key-owner-account-mismatch");
    expect(() => cp.registerDeviceKeyApi({
      schemaVersion: KEY_API_REQUEST_SCHEMA_VERSIONS.deviceRegister,
      accountId: account.id,
      publicKeyId: "key_device_api_private",
      publicKey: generateKeyPairSync("ed25519").publicKey,
      createdAt: "2026-06-20T10:30:45Z",
      authorization: deviceAuthorization,
      [contentKey]: "function private() {}"
    } as any)).toThrow("key-api-private-content-forbidden");

    const revokedDevice = cp.revokeDeviceKeyApi({
      schemaVersion: KEY_API_REQUEST_SCHEMA_VERSIONS.deviceRevoke,
      deviceId: device.deviceId,
      revokedAt: "2026-06-20T10:31:00Z",
      authorization: deviceAuthorization
    });
    expect(revokedDevice).toMatchObject({
      deviceId: device.deviceId,
      status: "revoked",
      revokedAt: "2026-06-20T10:31:00Z"
    });
    expect(() => cp.revokeDeviceKeyApi({
      schemaVersion: "archcontext.device-key-revoke-request/v0" as typeof KEY_API_REQUEST_SCHEMA_VERSIONS.deviceRevoke,
      deviceId: device.deviceId,
      revokedAt: "2026-06-20T10:31:30Z",
      authorization: deviceAuthorization
    })).toThrow("key-api-schemaVersion-invalid");

    const workflowRef = "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main";
    const repoAdminAuthorization = {
      actorId: "github_user_runner_api",
      actorLogin: "runner-admin-api",
      installationId: 10001,
      repositoryAdminIds: [20002],
      permissionSource: "test-fixture" as const,
      verifiedAt: "2026-06-20T10:31:59Z",
      reason: "runner-key-api-test"
    };
    const runnerKeyPair = generateKeyPairSync("ed25519");
    const rotatedRunnerKeyPair = generateKeyPairSync("ed25519");
    const runner = cp.registerRunnerKeyApi({
      schemaVersion: KEY_API_REQUEST_SCHEMA_VERSIONS.runnerRegister,
      installationId: 10001,
      repositoryIds: [20002],
      workflowRef,
      publicKeyId: "key_runner_api_0001",
      publicKey: runnerKeyPair.publicKey,
      createdAt: "2026-06-20T10:32:00Z",
      authorization: repoAdminAuthorization
    });
    expect(runner).toMatchObject({
      installationId: 10001,
      repositoryIds: [20002],
      publicKeyId: "key_runner_api_0001",
      status: "active"
    });
    expect(() => cp.registerRunnerKeyApi({
      schemaVersion: KEY_API_REQUEST_SCHEMA_VERSIONS.runnerRegister,
      installationId: 10001,
      repositoryIds: [20002],
      workflowRef,
      publicKeyId: "key_runner_api_denied",
      publicKey: generateKeyPairSync("ed25519").publicKey,
      createdAt: "2026-06-20T10:32:30Z",
      authorization: { ...repoAdminAuthorization, repositoryAdminIds: [99999] }
    })).toThrow("runner-key-admin-repository-required");

    const rotation = cp.rotateRunnerKeyApi({
      schemaVersion: KEY_API_REQUEST_SCHEMA_VERSIONS.runnerRotate,
      runnerId: runner.runnerId,
      publicKeyId: "key_runner_api_0002",
      publicKey: rotatedRunnerKeyPair.publicKey,
      rotatedAt: "2026-06-20T10:35:00Z",
      overlapMs: DEFAULT_RUNNER_KEY_ROTATION_OVERLAP_MS,
      authorization: repoAdminAuthorization
    });
    expect(rotation.previous).toMatchObject({ runnerId: runner.runnerId, status: "rotating" });
    expect(rotation.next).toMatchObject({
      publicKeyId: "key_runner_api_0002",
      status: "active"
    });
    expect(rotation.rotationWindow).toMatchObject({
      previousRunnerId: runner.runnerId,
      nextRunnerId: rotation.next.runnerId,
      overlapUntil: "2026-06-20T10:50:00.000Z"
    });

    const revokedRunner = cp.revokeRunnerKeyApi({
      schemaVersion: KEY_API_REQUEST_SCHEMA_VERSIONS.runnerRevoke,
      runnerId: rotation.next.runnerId,
      revokedAt: "2026-06-20T10:51:00Z",
      authorization: repoAdminAuthorization
    });
    expect(revokedRunner).toMatchObject({
      runnerId: rotation.next.runnerId,
      status: "revoked",
      revokedAt: "2026-06-20T10:51:00Z"
    });
    expect(cp.listAuditEvents({ actorId: "github_user_runner_api" }).map((event) => event.action)).toEqual([
      "runner_key.register",
      "runner_key.rotate",
      "runner_key.revoke"
    ]);
  });

  test("rejects revoked and unregistered Runner Keys immediately with recovery guidance", () => {
    const cp = new ControlPlane();
    const workflowRef = "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main";
    const challenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_runner_key_recovery",
      nonce: "nonce_runner_key_recovery",
      requiredTrust: "organization",
      status: "LEASED"
    }));
    const authorization = {
      actorId: "github_user_runner_recovery",
      actorLogin: "runner-admin",
      installationId: challenge.installationId,
      repositoryAdminIds: [challenge.repositoryId],
      permissionSource: "test-fixture" as const,
      verifiedAt: "2026-06-20T08:59:59Z",
      reason: "runner-key-recovery-test"
    };
    const missingRecovery = cp.describeRunnerKeyRecovery({
      runnerId: "runner_missing",
      installationId: challenge.installationId,
      repositoryId: challenge.repositoryId,
      workflowRef,
      now: "2026-06-20T09:00:00Z"
    });
    expect(missingRecovery).toMatchObject({
      schemaVersion: "archcontext.runner-key-recovery/v1",
      lifecycleState: "not_found",
      submitAllowed: false,
      immediateRejection: true,
      reasonCode: "RUNNER_NOT_FOUND",
      action: "register-runner-identity",
      replacementRequired: true
    });

    const revokedKeyPair = generateKeyPairSync("ed25519");
    const revokedRunner = cp.registerRunnerKey({
      runnerId: "runner_revoked_recovery",
      installationId: challenge.installationId,
      repositoryIds: [challenge.repositoryId],
      workflowRef,
      publicKeyId: "key_runner_revoked_recovery",
      publicKey: revokedKeyPair.publicKey,
      createdAt: "2026-06-20T09:01:00Z",
      authorization
    });
    const revokedAttestation = signedAttestationForChallenge(challenge, revokedKeyPair.privateKey, {
      execution: organizationExecutionForRunner(revokedRunner)
    });
    const revoked = cp.revokeRunnerKey({
      runnerId: revokedRunner.runnerId,
      revokedAt: "2026-06-20T09:02:00Z",
      authorization
    });
    const revokedRecovery = cp.describeRunnerKeyRecovery({
      runnerId: revoked.runnerId,
      installationId: challenge.installationId,
      repositoryId: challenge.repositoryId,
      workflowRef,
      now: "2026-06-20T09:02:01Z"
    });
    expect(revokedRecovery).toMatchObject({
      lifecycleState: "revoked",
      submitAllowed: false,
      immediateRejection: true,
      retryCurrentKey: false,
      replacementRequired: true,
      reasonCode: "RUNNER_REVOKED",
      action: "register-replacement-runner-key",
      publicKeyId: "key_runner_revoked_recovery",
      revokedAt: "2026-06-20T09:02:00Z"
    });
    expect(JSON.stringify(revokedRecovery)).not.toContain("PRIVATE KEY");
    const revokedSubmit = cp.submitReviewChallengeAttestation({
      challenge,
      attestation: revokedAttestation,
      currentPullHead: pullHeadForChallenge(challenge),
      publicKey: revokedKeyPair.publicKey,
      runnerIdentity: revoked,
      signingKeyStatus: cp.getRunnerKeyStatus(revoked.runnerId),
      now: "2026-06-20T09:02:02Z",
      consumedNonceHashes: new Set<string>(),
      expectedHeadTreeOid: revokedAttestation.headTreeOid
    });
    expect(revokedSubmit).toMatchObject({ accepted: false, reasonCode: "RUNNER_REVOKED" });
    expect(revokedSubmit.consumedNonceHashes.has(revokedSubmit.nonceHash)).toBe(false);

    const unregisterChallenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_runner_key_unregister",
      nonce: "nonce_runner_key_unregister",
      requiredTrust: "organization",
      status: "LEASED"
    }));
    const unregisteredKeyPair = generateKeyPairSync("ed25519");
    const unregisteredRunner = cp.registerRunnerKey({
      runnerId: "runner_unregistered_recovery",
      installationId: unregisterChallenge.installationId,
      repositoryIds: [unregisterChallenge.repositoryId],
      workflowRef,
      publicKeyId: "key_runner_unregistered_recovery",
      publicKey: unregisteredKeyPair.publicKey,
      createdAt: "2026-06-20T09:03:00Z",
      authorization
    });
    const unregisteredAttestation = signedAttestationForChallenge(unregisterChallenge, unregisteredKeyPair.privateKey, {
      execution: organizationExecutionForRunner(unregisteredRunner)
    });
    const unregistered = cp.unregisterRunnerKey({
      runnerId: unregisteredRunner.runnerId,
      revokedAt: "2026-06-20T09:04:00Z",
      authorization
    });
    const unregisteredRecovery = cp.describeRunnerKeyRecovery({
      runnerId: unregistered.runnerId,
      installationId: unregisterChallenge.installationId,
      repositoryId: unregisterChallenge.repositoryId,
      workflowRef,
      now: "2026-06-20T09:04:01Z"
    });
    expect(unregisteredRecovery).toMatchObject({
      lifecycleState: "unregistered",
      submitAllowed: false,
      immediateRejection: true,
      reasonCode: "RUNNER_REVOKED",
      action: "register-replacement-runner-key",
      replacementRequired: true
    });
    const unregisteredSubmit = cp.submitReviewChallengeAttestation({
      challenge: unregisterChallenge,
      attestation: unregisteredAttestation,
      currentPullHead: pullHeadForChallenge(unregisterChallenge),
      publicKey: unregisteredKeyPair.publicKey,
      runnerIdentity: unregistered,
      signingKeyStatus: cp.getRunnerKeyStatus(unregistered.runnerId),
      now: "2026-06-20T09:04:02Z",
      consumedNonceHashes: new Set<string>(),
      expectedHeadTreeOid: unregisteredAttestation.headTreeOid
    });
    expect(unregisteredSubmit).toMatchObject({ accepted: false, reasonCode: "RUNNER_REVOKED" });
    expect(unregisteredSubmit.consumedNonceHashes.has(unregisteredSubmit.nonceHash)).toBe(false);

    const replacementKeyPair = generateKeyPairSync("ed25519");
    const replacementRunner = cp.registerRunnerKey({
      runnerId: "runner_replacement_recovery",
      installationId: unregisterChallenge.installationId,
      repositoryIds: [unregisterChallenge.repositoryId],
      workflowRef,
      publicKeyId: "key_runner_replacement_recovery",
      publicKey: replacementKeyPair.publicKey,
      createdAt: "2026-06-20T09:05:00Z",
      authorization
    });
    const replacementRecovery = cp.describeRunnerKeyRecovery({
      runnerId: replacementRunner.runnerId,
      installationId: unregisterChallenge.installationId,
      repositoryId: unregisterChallenge.repositoryId,
      workflowRef,
      now: "2026-06-20T09:05:01Z"
    });
    expect(replacementRecovery).toMatchObject({
      lifecycleState: "active",
      submitAllowed: true,
      immediateRejection: false,
      retryCurrentKey: true,
      replacementRequired: false,
      action: "none"
    });
    const replacementAttestation = signedAttestationForChallenge(unregisterChallenge, replacementKeyPair.privateKey, {
      execution: organizationExecutionForRunner(replacementRunner)
    });
    const accepted = cp.submitReviewChallengeAttestation({
      challenge: unregisterChallenge,
      attestation: replacementAttestation,
      currentPullHead: pullHeadForChallenge(unregisterChallenge),
      publicKey: replacementKeyPair.publicKey,
      runnerIdentity: replacementRunner,
      signingKeyStatus: cp.getRunnerKeyStatus(replacementRunner.runnerId),
      now: "2026-06-20T09:05:02Z",
      consumedNonceHashes: unregisteredSubmit.consumedNonceHashes,
      expectedHeadTreeOid: replacementAttestation.headTreeOid
    });
    expect(accepted).toMatchObject({ accepted: true });
    expect(accepted.consumedNonceHashes.has(accepted.nonceHash)).toBe(true);
    expect(cp.listAuditEvents({ runnerId: unregistered.runnerId }).map((event) => event.action)).toEqual([
      "runner_key.register",
      "runner_key.unregister"
    ]);
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

  test("applies Challenge v2 status transitions through the contracts guard", () => {
    const cp = new ControlPlane();
    const challenge = createReviewChallengeV2({
      installationId: 10001,
      repositoryId: 20002,
      pullRequestNumber: 42,
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      nonce: "nonce_base64url_0001",
      requiredTrust: "developer",
      policyProfileId: "policy.default",
      createdAt: "2026-06-20T09:00:00Z",
      expiresAt: "2026-06-20T09:15:00Z"
    });

    const leased = cp.transitionReviewChallenge({ challenge, to: "LEASED" });
    expect(leased.status).toBe("LEASED");
    expect(challenge.status).toBe("PENDING");
    expect(cp.transitionReviewChallenge({ challenge: leased, to: "SUBMITTED" }).status).toBe("SUBMITTED");
    expect(() => cp.transitionReviewChallenge({ challenge: leased, to: "PENDING" })).toThrow("challenge-transition-invalid: LEASED->PENDING");
    expect(() => cp.transitionReviewChallenge({ challenge: { ...challenge, status: "VERIFIED" }, to: "REJECTED" })).toThrow("challenge-transition-invalid: VERIFIED->REJECTED");
  });

  test("supersedes old active Challenge v2 values when a new PR head arrives", () => {
    const cp = new ControlPlane();
    const olderPending = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_old_pending",
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nonce: "nonce_old_pending",
      status: "PENDING"
    }));
    const olderLeased = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_old_leased",
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nonce: "nonce_old_leased",
      requiredTrust: "organization",
      status: "LEASED"
    }));
    const olderSubmitted = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_old_submitted",
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nonce: "nonce_old_submitted",
      policyProfileId: "policy.strict",
      status: "SUBMITTED"
    }));
    const terminal = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_terminal",
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nonce: "nonce_terminal",
      status: "VERIFIED"
    }));
    const otherPr = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_other_pr",
      pullRequestNumber: 43,
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nonce: "nonce_other_pr"
    }));
    const nextChallenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_new_head",
      headSha: "dddddddddddddddddddddddddddddddddddddddd",
      nonce: "nonce_new_head"
    }));

    const input = [olderPending, olderLeased, olderSubmitted, terminal, otherPr, nextChallenge];
    const result = cp.supersedeActiveReviewChallenges({ challenges: input, nextChallenge });
    const byId = new Map(result.challenges.map((challenge) => [challenge.challengeId, challenge]));

    expect(result.supersededChallengeIds).toEqual(["chal_old_pending", "chal_old_leased", "chal_old_submitted"]);
    expect(byId.get("chal_old_pending")?.status).toBe("SUPERSEDED");
    expect(byId.get("chal_old_leased")?.status).toBe("SUPERSEDED");
    expect(byId.get("chal_old_submitted")?.status).toBe("SUPERSEDED");
    expect(byId.get("chal_terminal")?.status).toBe("VERIFIED");
    expect(byId.get("chal_other_pr")?.status).toBe("PENDING");
    expect(byId.get("chal_new_head")?.status).toBe("PENDING");
    expect(olderPending.status).toBe("PENDING");
    expect(olderLeased.status).toBe("LEASED");
    expect(olderSubmitted.status).toBe("SUBMITTED");
  });

  test("fetches exact PR head metadata and rejects Challenge identity mismatches without exposing nonce", async () => {
    const cp = new ControlPlane();
    const challenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_verify_pull_head",
      nonce: "nonce_verify_pull_head"
    }));
    const pullHead = {
      installationId: challenge.installationId,
      repositoryId: challenge.repositoryId,
      pullRequestNumber: challenge.pullRequestNumber,
      headSha: challenge.headSha,
      baseSha: challenge.baseSha
    };
    const requests: unknown[] = [];

    const accepted = await cp.fetchAndVerifyReviewChallengePullHead({
      challenge,
      github: {
        async getPullHeadMetadata(input) {
          requests.push(input);
          return pullHead;
        }
      }
    });

    expect(requests).toEqual([{
      installationId: challenge.installationId,
      repositoryId: challenge.repositoryId,
      pullRequestNumber: challenge.pullRequestNumber
    }]);
    expect(accepted).toEqual({
      schemaVersion: "archcontext.review-challenge-pull-head-verification/v1",
      accepted: true,
      challengeId: challenge.challengeId,
      expected: pullHead,
      observed: pullHead
    });
    expect(JSON.stringify(accepted)).not.toContain(challenge.nonce);

    const mismatches = [
      [{ installationId: 99999 }, "REPOSITORY_MISMATCH"],
      [{ repositoryId: 99999 }, "REPOSITORY_MISMATCH"],
      [{ pullRequestNumber: 99 }, "PULL_REQUEST_MISMATCH"],
      [{ headSha: "cccccccccccccccccccccccccccccccccccccccc" }, "HEAD_SHA_MISMATCH"],
      [{ baseSha: "dddddddddddddddddddddddddddddddddddddddd" }, "BASE_SHA_MISMATCH"]
    ] as const;
    for (const [override, reasonCode] of mismatches) {
      expect(cp.verifyReviewChallengePullHead({
        challenge,
        pullHead: { ...pullHead, ...override }
      })).toMatchObject({
        accepted: false,
        reasonCode,
        challengeId: challenge.challengeId
      });
    }
  });

  test("issues Challenge v2 values with random nonce and default expiry", () => {
    const cp = new ControlPlane();
    const challenge = cp.issueReviewChallenge({
      installationId: 10001,
      repositoryId: 20002,
      pullRequestNumber: 42,
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      requiredTrust: "developer",
      policyProfileId: "policy.default",
      createdAt: "2026-06-20T09:00:00Z"
    });

    expect(DEFAULT_REVIEW_CHALLENGE_TTL_MS).toBe(15 * 60 * 1000);
    expect(challenge.status).toBe("PENDING");
    expect(challenge.expiresAt).toBe("2026-06-20T09:15:00.000Z");
    expect(challenge.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(reviewChallengeNonceHash(challenge)).toMatch(/^sha256:/);
    expect(reviewChallengeNonceHash(challenge)).not.toContain(challenge.nonce);
  });

  test("exposes schema-versioned Challenge API for create, get, list, lease, submit, and cancel", () => {
    const cp = new ControlPlane();
    const challenge = cp.createReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.create,
      idempotencyKey: "idem_challenge_api_create",
      ...reviewChallengeInput({
        challengeId: "chal_api_create",
        nonce: "nonce_api_create"
      })
    });
    const replayedChallenge = cp.createReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.create,
      idempotencyKey: "idem_challenge_api_create",
      ...reviewChallengeInput({
        challengeId: "chal_api_create",
        nonce: "nonce_api_create"
      })
    });

    expect(challenge.status).toBe("PENDING");
    expect(replayedChallenge).toEqual(challenge);
    expect(cp.listMetricSamples({ name: "challenge_create_latency_ms", challengeId: challenge.challengeId })).toHaveLength(1);
    expect(cp.listMetricSamples({ name: "challenge_create_latency_ms", challengeId: challenge.challengeId })[0]).toMatchObject({
      unit: "milliseconds",
      labels: {
        challengeId: challenge.challengeId,
        requiredTrust: "developer",
        status: "PENDING"
      }
    });
    expect(cp.listMetricSamples({ name: "challenge_create_latency_ms", challengeId: challenge.challengeId })[0].value).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(cp.listMetricSamples({ name: "challenge_create_latency_ms", challengeId: challenge.challengeId }))).not.toContain("idem_challenge_api_create");
    expect(cp.apiIdempotencyRecords.get(apiIdempotencyKeyDigest("POST /v1/challenges", "idem_challenge_api_create"))).toMatchObject({
      schemaVersion: "archcontext.api-idempotency-record/v1",
      routeId: "POST /v1/challenges",
      resourceKind: "review-challenge",
      resourceId: challenge.challengeId
    });
    expect([...cp.apiIdempotencyRecords.keys()].join(" ")).not.toContain("idem_challenge_api_create");
    expect(() => cp.createReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.create,
      idempotencyKey: "idem_challenge_api_create",
      ...reviewChallengeInput({
        challengeId: "chal_api_create_conflict",
        nonce: "nonce_api_create_conflict",
        headSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      })
    })).toThrow("api-idempotency-key-conflict");
    expect(cp.getReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.get,
      challengeId: challenge.challengeId
    })).toEqual(challenge);
    expect(cp.listReviewChallengesApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.list,
      repositoryId: challenge.repositoryId,
      pullRequestNumber: challenge.pullRequestNumber,
      headSha: challenge.headSha,
      requiredTrust: "developer"
    })).toEqual([challenge]);
    expect(() => cp.createReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.create,
      idempotencyKey: "idem_challenge_api_duplicate",
      ...reviewChallengeInput({
        challengeId: "chal_api_duplicate",
        nonce: "nonce_api_duplicate"
      })
    })).toThrow("review-challenge-active-identity-conflict");

    const claim = cp.claimReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.lease,
      challengeId: challenge.challengeId,
      claimantId: "device_0001",
      now: "2026-06-20T09:01:00Z"
    });
    expect(claim.claimed).toBe(true);
    expect(cp.getReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.get,
      challengeId: challenge.challengeId
    }).status).toBe("LEASED");
    expect(cp.reviewChallengeLeases.get(challenge.challengeId)).toMatchObject({
      ownerId: "device_0001",
      expiresAt: "2026-06-20T09:06:00.000Z"
    });

    const leasedChallenge = claim.challenge;
    const attestation = signedAttestationForChallenge(leasedChallenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey);
    const submitDevice = cp.registerDeviceKey({
      accountId: "acct_submit_api",
      publicKeyId: "key_submit_api",
      publicKey: CONTROL_PLANE_ATTESTATION_KEYPAIR.publicKey,
      createdAt: "2026-06-20T09:04:00Z"
    });
    const submitAuthorization = {
      actorId: "github_user_submit_api",
      actorLogin: "submitter-api",
      installationId: leasedChallenge.installationId,
      repositoryId: leasedChallenge.repositoryId,
      pullRequestNumber: leasedChallenge.pullRequestNumber,
      accountId: submitDevice.accountId,
      deviceId: submitDevice.deviceId,
      permissionSource: "test-fixture" as const,
      verifiedAt: "2026-06-20T09:04:30Z",
      reason: "challenge-submit-api-test"
    };
    expect(() => cp.submitReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.submit,
      challengeId: leasedChallenge.challengeId,
      attestation,
      currentPullHead: pullHeadForChallenge(leasedChallenge),
      publicKey: CONTROL_PLANE_ATTESTATION_KEYPAIR.publicKey,
      now: "2026-06-20T09:04:45Z"
    } as any)).toThrow("review-challenge-resource-authorization-required");
    const submitted = cp.submitReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.submit,
      challengeId: leasedChallenge.challengeId,
      attestation,
      currentPullHead: pullHeadForChallenge(leasedChallenge),
      publicKey: CONTROL_PLANE_ATTESTATION_KEYPAIR.publicKey,
      resourceAuthorization: submitAuthorization,
      deviceIdentity: submitDevice,
      verifyStartedAt: "2026-06-20T09:04:59.500Z",
      now: "2026-06-20T09:05:00Z"
    });
    expect(submitted.accepted).toBe(true);
    expect(submitted.challenge.status).toBe("SUBMITTED");
    expect(cp.reviewChallengeLeases.has(challenge.challengeId)).toBe(false);
    expect(cp.submitReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.submit,
      challengeId: leasedChallenge.challengeId,
      attestation,
      currentPullHead: pullHeadForChallenge(leasedChallenge),
      publicKey: CONTROL_PLANE_ATTESTATION_KEYPAIR.publicKey,
      resourceAuthorization: submitAuthorization,
      deviceIdentity: submitDevice,
      now: "2026-06-20T09:05:30Z"
    })).toMatchObject({ accepted: false, reasonCode: "CHALLENGE_ALREADY_CONSUMED" });
    expect(cp.listMetricSamples({ name: "challenge_age_ms", challengeId: leasedChallenge.challengeId }).map((sample) => sample.value)).toEqual([300000, 330000]);
    expect(cp.listMetricSamples({ name: "verify_latency_ms", challengeId: leasedChallenge.challengeId }).map((sample) => sample.value)).toEqual([500, 0]);
    expect(cp.listMetricSamples({ name: "reject_reason_total", reasonCode: "CHALLENGE_ALREADY_CONSUMED" })).toHaveLength(1);
    expect(cp.listMetricSamples({ name: "reject_reason_total", reasonCode: "CHALLENGE_ALREADY_CONSUMED" })[0]).toMatchObject({
      unit: "count",
      value: 1,
      labels: {
        challengeId: leasedChallenge.challengeId,
        reasonCode: "CHALLENGE_ALREADY_CONSUMED",
        retryable: "false",
        status: "SUBMITTED"
      }
    });
    expect(cp.listMetricSamples()[0].metadataDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    const cancelChallenge = cp.createReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.create,
      idempotencyKey: "idem_challenge_api_cancel",
      ...reviewChallengeInput({
        challengeId: "chal_api_cancel",
        nonce: "nonce_api_cancel",
        headSha: "cccccccccccccccccccccccccccccccccccccccc"
      })
    });
    const cancelled = cp.cancelReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.cancel,
      challengeId: cancelChallenge.challengeId,
      reason: "superseded-by-user-request",
      now: "2026-06-20T09:06:00Z"
    });
    expect(cancelled.status).toBe("EXPIRED");
    expect(() => cp.cancelReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.cancel,
      challengeId: cancelled.challengeId,
      reason: "already-cancelled",
      now: "2026-06-20T09:06:30Z"
    })).toThrow("challenge-transition-invalid: EXPIRED->EXPIRED");

    expect(() => cp.getReviewChallengeApi({
      schemaVersion: "archcontext.challenge-get-request/v0" as typeof CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.get,
      challengeId: challenge.challengeId
    })).toThrow("challenge-api-schemaVersion-invalid");
    expect(() => cp.createReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.create,
      idempotencyKey: "idem_challenge_api_private",
      ...reviewChallengeInput({
        challengeId: "chal_api_private",
        nonce: "nonce_api_private",
        headSha: "dddddddddddddddddddddddddddddddddddddddd"
      }),
      diff: "@@ private"
    } as any)).toThrow("challenge-api-private-content-forbidden");
  });

  test("binds Challenge submit authorization to installation repository PR actor device and runner", () => {
    const cp = new ControlPlane();
    const challenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_resource_binding_device",
      nonce: "nonce_resource_binding_device",
      status: "LEASED"
    }));
    const device = cp.registerDeviceKey({
      accountId: "acct_resource_binding",
      publicKeyId: "key_resource_binding_device",
      publicKey: CONTROL_PLANE_ATTESTATION_KEYPAIR.publicKey,
      createdAt: "2026-06-20T09:00:00Z"
    });
    const deviceAuthorization = {
      actorId: "github_user_resource_binding",
      actorLogin: "device-reviewer",
      installationId: challenge.installationId,
      repositoryId: challenge.repositoryId,
      pullRequestNumber: challenge.pullRequestNumber,
      accountId: device.accountId,
      deviceId: device.deviceId,
      permissionSource: "test-fixture" as const,
      verifiedAt: "2026-06-20T09:01:00Z",
      reason: "device-submit-binding"
    };

    const deviceBinding = cp.authorizeReviewChallengeResourceBinding({
      challenge,
      authorization: deviceAuthorization,
      deviceIdentity: device
    });
    expect(deviceBinding).toMatchObject({
      schemaVersion: "archcontext.review-challenge-resource-binding/v1",
      authorized: true,
      subject: "device",
      actorId: "github_user_resource_binding",
      challengeId: challenge.challengeId,
      installationId: challenge.installationId,
      repositoryId: challenge.repositoryId,
      pullRequestNumber: challenge.pullRequestNumber,
      accountId: device.accountId,
      deviceId: device.deviceId,
      permissionSource: "test-fixture"
    });
    expect(deviceBinding.metadataDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(() => cp.authorizeReviewChallengeResourceBinding({
      challenge,
      authorization: { ...deviceAuthorization, repositoryId: 99999 },
      deviceIdentity: device
    })).toThrow("review-challenge-repository-binding-mismatch");
    expect(() => cp.authorizeReviewChallengeResourceBinding({
      challenge,
      authorization: { ...deviceAuthorization, deviceId: "device_wrong" },
      deviceIdentity: device
    })).toThrow("review-challenge-device-binding-mismatch");
    const revokedDevice = cp.revokeDeviceKey(device.deviceId, "2026-06-20T09:02:00Z");
    expect(() => cp.authorizeReviewChallengeResourceBinding({
      challenge,
      authorization: deviceAuthorization,
      deviceIdentity: revokedDevice
    })).toThrow("review-challenge-device-revoked");

    const workflowRef = "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main";
    const runnerAdminAuthorization = {
      actorId: "github_user_runner_binding_admin",
      actorLogin: "runner-binding-admin",
      installationId: challenge.installationId,
      repositoryAdminIds: [challenge.repositoryId],
      permissionSource: "test-fixture" as const,
      verifiedAt: "2026-06-20T09:03:00Z",
      reason: "runner-binding-admin"
    };
    const runner = cp.registerRunnerKey({
      installationId: challenge.installationId,
      repositoryIds: [challenge.repositoryId],
      workflowRef,
      publicKeyId: "key_resource_binding_runner",
      publicKey: generateKeyPairSync("ed25519").publicKey,
      createdAt: "2026-06-20T09:04:00Z",
      authorization: runnerAdminAuthorization
    });
    const organizationChallenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_resource_binding_runner",
      nonce: "nonce_resource_binding_runner",
      requiredTrust: "organization",
      status: "LEASED"
    }));
    const runnerAuthorization = {
      actorId: "github_actions_runner_1",
      actorLogin: "archcontext-runner",
      installationId: organizationChallenge.installationId,
      repositoryId: organizationChallenge.repositoryId,
      pullRequestNumber: organizationChallenge.pullRequestNumber,
      runnerId: runner.runnerId,
      workflowRef,
      permissionSource: "github-app" as const,
      verifiedAt: "2026-06-20T09:05:00Z",
      reason: "organization-runner-submit-binding"
    };
    const runnerBinding = cp.authorizeReviewChallengeResourceBinding({
      challenge: organizationChallenge,
      authorization: runnerAuthorization,
      runnerIdentity: runner
    });
    expect(runnerBinding).toMatchObject({
      authorized: true,
      subject: "runner",
      runnerId: runner.runnerId,
      workflowRef,
      installationId: organizationChallenge.installationId,
      repositoryId: organizationChallenge.repositoryId,
      pullRequestNumber: organizationChallenge.pullRequestNumber
    });
    expect(() => cp.authorizeReviewChallengeResourceBinding({
      challenge: organizationChallenge,
      authorization: runnerAuthorization
    })).toThrow("review-challenge-runner-binding-required");
    expect(() => cp.authorizeReviewChallengeResourceBinding({
      challenge: organizationChallenge,
      authorization: { ...runnerAuthorization, workflowRef: "owner/repo/.github/workflows/other.yml@refs/heads/main" },
      runnerIdentity: runner
    })).toThrow("review-challenge-runner-workflow-mismatch");
    const outOfScopeRunner = cp.registerRunnerKey({
      installationId: challenge.installationId,
      repositoryIds: [99999],
      workflowRef,
      publicKeyId: "key_resource_binding_runner_other_repo",
      publicKey: generateKeyPairSync("ed25519").publicKey,
      createdAt: "2026-06-20T09:06:00Z",
      authorization: { ...runnerAdminAuthorization, repositoryAdminIds: [99999] }
    });
    expect(() => cp.authorizeReviewChallengeResourceBinding({
      challenge: organizationChallenge,
      authorization: { ...runnerAuthorization, runnerId: outOfScopeRunner.runnerId },
      runnerIdentity: outOfScopeRunner
    })).toThrow("review-challenge-runner-scope-mismatch");
  });

  test("claims Challenge v2 leases with default TTL and caps at Challenge expiry", () => {
    const cp = new ControlPlane();
    const challenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_lease_claim",
      nonce: "nonce_lease_claim",
      status: "PENDING"
    }));

    const result = cp.claimReviewChallengeLease({
      challenge,
      claimantId: "device_0001",
      now: "2026-06-20T09:01:00Z"
    });

    expect(DEFAULT_REVIEW_CHALLENGE_LEASE_TTL_MS).toBe(5 * 60 * 1000);
    expect(result.claimed).toBe(true);
    expect(result.challenge.status).toBe("LEASED");
    expect(result.lease).toEqual({
      challengeId: "chal_lease_claim",
      ownerId: "device_0001",
      leasedAt: "2026-06-20T09:01:00.000Z",
      expiresAt: "2026-06-20T09:06:00.000Z"
    });
    expect(challenge.status).toBe("PENDING");

    const nearExpiry = cp.claimReviewChallengeLease({
      challenge,
      claimantId: "device_0001",
      now: "2026-06-20T09:13:00Z"
    });
    expect(nearExpiry.lease?.expiresAt).toBe("2026-06-20T09:15:00.000Z");
  });

  test("prevents duplicate Challenge lease owners while allowing renewal and expired-lease reclaim", () => {
    const cp = new ControlPlane();
    const leasedChallenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_lease_conflict",
      nonce: "nonce_lease_conflict",
      status: "LEASED"
    }));
    const activeLease = {
      challengeId: leasedChallenge.challengeId,
      ownerId: "device_0001",
      leasedAt: "2026-06-20T09:01:00.000Z",
      expiresAt: "2026-06-20T09:06:00.000Z"
    };

    const conflict = cp.claimReviewChallengeLease({
      challenge: leasedChallenge,
      claimantId: "device_0002",
      now: "2026-06-20T09:05:00Z",
      currentLease: activeLease
    });
    expect(conflict).toMatchObject({ claimed: false, reasonCode: "LEASE_ACTIVE" });
    expect(conflict.lease).toEqual(activeLease);

    const renewal = cp.claimReviewChallengeLease({
      challenge: leasedChallenge,
      claimantId: "device_0001",
      now: "2026-06-20T09:05:00Z",
      currentLease: activeLease
    });
    expect(renewal.claimed).toBe(true);
    expect(renewal.lease).toMatchObject({
      ownerId: "device_0001",
      leasedAt: "2026-06-20T09:05:00.000Z",
      expiresAt: "2026-06-20T09:10:00.000Z"
    });

    const reclaimed = cp.claimReviewChallengeLease({
      challenge: leasedChallenge,
      claimantId: "device_0002",
      now: "2026-06-20T09:06:00Z",
      currentLease: activeLease
    });
    expect(reclaimed.claimed).toBe(true);
    expect(reclaimed.lease).toMatchObject({
      ownerId: "device_0002",
      leasedAt: "2026-06-20T09:06:00.000Z",
      expiresAt: "2026-06-20T09:11:00.000Z"
    });
  });

  test("heartbeats Challenge leases and safely retries after lease timeout", () => {
    const cp = new ControlPlane();
    const leasedChallenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_lease_heartbeat",
      nonce: "nonce_lease_heartbeat",
      status: "LEASED"
    }));
    const activeLease = {
      challengeId: leasedChallenge.challengeId,
      ownerId: "runner_0001",
      leasedAt: "2026-06-20T09:01:00.000Z",
      expiresAt: "2026-06-20T09:06:00.000Z"
    };

    const heartbeat = cp.heartbeatReviewChallengeLease({
      challenge: leasedChallenge,
      lease: activeLease,
      ownerId: "runner_0001",
      now: "2026-06-20T09:04:00Z"
    });
    expect(heartbeat.claimed).toBe(true);
    expect(heartbeat.challenge.status).toBe("LEASED");
    expect(heartbeat.lease).toEqual({
      ...activeLease,
      lastHeartbeatAt: "2026-06-20T09:04:00.000Z",
      expiresAt: "2026-06-20T09:09:00.000Z"
    });

    const wrongOwnerHeartbeat = cp.heartbeatReviewChallengeLease({
      challenge: leasedChallenge,
      lease: activeLease,
      ownerId: "runner_0002",
      now: "2026-06-20T09:04:00Z"
    });
    expect(wrongOwnerHeartbeat).toMatchObject({ claimed: false, reasonCode: "LEASE_ACTIVE" });
    expect(wrongOwnerHeartbeat.lease).toEqual(activeLease);

    const timedOutHeartbeat = cp.heartbeatReviewChallengeLease({
      challenge: leasedChallenge,
      lease: activeLease,
      ownerId: "runner_0001",
      now: "2026-06-20T09:06:00Z"
    });
    expect(timedOutHeartbeat).toMatchObject({ claimed: false, reasonCode: "LEASE_EXPIRED" });
    expect(timedOutHeartbeat.lease).toEqual(activeLease);

    const sameOwnerRetry = cp.retryReviewChallengeLease({
      challenge: leasedChallenge,
      claimantId: "runner_0001",
      now: "2026-06-20T09:04:00Z",
      currentLease: activeLease
    });
    expect(sameOwnerRetry.lease).toMatchObject({
      ownerId: "runner_0001",
      leasedAt: "2026-06-20T09:01:00.000Z",
      lastHeartbeatAt: "2026-06-20T09:04:00.000Z",
      expiresAt: "2026-06-20T09:09:00.000Z"
    });

    const activeOtherOwnerRetry = cp.retryReviewChallengeLease({
      challenge: leasedChallenge,
      claimantId: "runner_0002",
      now: "2026-06-20T09:04:00Z",
      currentLease: activeLease
    });
    expect(activeOtherOwnerRetry).toMatchObject({ claimed: false, reasonCode: "LEASE_ACTIVE" });

    const timeoutRetry = cp.retryReviewChallengeLease({
      challenge: leasedChallenge,
      claimantId: "runner_0002",
      now: "2026-06-20T09:06:00Z",
      currentLease: activeLease
    });
    expect(timeoutRetry.claimed).toBe(true);
    expect(timeoutRetry.lease).toMatchObject({
      ownerId: "runner_0002",
      leasedAt: "2026-06-20T09:06:00.000Z",
      expiresAt: "2026-06-20T09:11:00.000Z"
    });

    const nearChallengeExpiry = cp.retryReviewChallengeLease({
      challenge: leasedChallenge,
      claimantId: "runner_0002",
      now: "2026-06-20T09:13:00Z",
      currentLease: activeLease
    });
    expect(nearChallengeExpiry.lease?.expiresAt).toBe("2026-06-20T09:15:00.000Z");
  });

  test("rejects Challenge lease claims for terminal or expired Challenges", () => {
    const cp = new ControlPlane();
    const expiredPending = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_lease_expired",
      nonce: "nonce_lease_expired",
      status: "PENDING",
      expiresAt: "2026-06-20T09:05:00Z"
    }));
    const expired = cp.claimReviewChallengeLease({
      challenge: expiredPending,
      claimantId: "device_0001",
      now: "2026-06-20T09:05:00Z"
    });
    expect(expired).toMatchObject({ claimed: false, reasonCode: "CHALLENGE_EXPIRED" });
    expect(expired.challenge.status).toBe("EXPIRED");
    expect(expiredPending.status).toBe("PENDING");

    const supersededChallenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_lease_superseded",
      nonce: "nonce_lease_superseded",
      status: "SUPERSEDED"
    }));
    expect(cp.claimReviewChallengeLease({
      challenge: supersededChallenge,
      claimantId: "device_0001",
      now: "2026-06-20T09:01:00Z"
    })).toMatchObject({ claimed: false, reasonCode: "CHALLENGE_SUPERSEDED" });

    const submittedChallenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_lease_submitted",
      nonce: "nonce_lease_submitted",
      status: "SUBMITTED"
    }));
    expect(cp.claimReviewChallengeLease({
      challenge: submittedChallenge,
      claimantId: "device_0001",
      now: "2026-06-20T09:01:00Z"
    })).toMatchObject({ claimed: false, reasonCode: "CHALLENGE_ALREADY_CONSUMED" });
  });

  test("atomically consumes a Challenge v2 nonce when submitting an Attestation v2", () => {
    const cp = new ControlPlane();
    const device = cp.registerDeviceKey({
      accountId: "acct_submit",
      publicKeyId: "key_device_0001",
      publicKey: CONTROL_PLANE_ATTESTATION_KEYPAIR.publicKey,
      createdAt: "2026-06-20T09:00:00Z"
    });
    const challenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_nonce_submit",
      nonce: "nonce_submit_once",
      status: "LEASED"
    }));
    const attestation = signedAttestationForChallenge(challenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey);
    const existingConsumed = new Set(["sha256:existing"]);
    const result = cp.submitReviewChallengeAttestation({
      challenge,
      attestation,
      currentPullHead: pullHeadForChallenge(challenge),
      publicKey: CONTROL_PLANE_ATTESTATION_KEYPAIR.publicKey,
      signingKeyStatus: cp.getDeviceKeyStatus(device.deviceId),
      now: "2026-06-20T09:05:00Z",
      consumedNonceHashes: existingConsumed
    });

    expect(result.accepted).toBe(true);
    expect(result.reasonCode).toBeUndefined();
    expect(result.currentHeadVerification).toMatchObject({ accepted: true, challengeId: challenge.challengeId });
    expect(result.attestationDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.challenge.status).toBe("SUBMITTED");
    expect(result.nonceHash).toBe(reviewChallengeNonceHash(challenge));
    expect(result.nonceHash).toMatch(/^sha256:/);
    expect(result.nonceHash).not.toContain(challenge.nonce);
    expect(result.consumedNonceHashes.has("sha256:existing")).toBe(true);
    expect(result.consumedNonceHashes.has(result.nonceHash)).toBe(true);
    expect(existingConsumed.has(result.nonceHash)).toBe(false);
    expect(challenge.status).toBe("LEASED");
  });

  test("persists accepted Attestation submit and queues Check delivery asynchronously", async () => {
    const cp = new ControlPlane();
    const db = new Database(":memory:");
    try {
      db.exec(d1MigrationSql());
      const challenge = createReviewChallengeV2(reviewChallengeInput({
        challengeId: "chal_control_plane_submit_tx",
        nonce: "nonce_control_plane_submit_tx",
        status: "LEASED"
      }));
      insertReviewChallengePersistenceRow(db, challenge, {
        leaseOwner: "device_0001",
        leaseExpiresAt: "2026-06-20T09:10:00.000Z"
      });
      const attestation = signedAttestationForChallenge(challenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey);
      const submission = cp.submitReviewChallengeAttestation({
        challenge,
        attestation,
        currentPullHead: pullHeadForChallenge(challenge),
        publicKey: CONTROL_PLANE_ATTESTATION_KEYPAIR.publicKey,
        now: "2026-06-20T09:05:00Z",
        consumedNonceHashes: new Set()
      });
      expect(submission.accepted).toBe(true);

      const checkDelivery = cp.persistAcceptedReviewChallengeSubmission({
        db,
        challenge,
        attestation,
        submission,
        acceptedAt: "2026-06-20T09:05:00.000Z"
      });

      const expectedDeliveryId = checkDeliveryIdempotencyKey({
        challengeId: challenge.challengeId,
        checkName: "ArchContext / Developer Review",
        headSha: challenge.headSha
      });
      expect(checkDelivery).toMatchObject({
        schemaVersion: "archcontext.check-delivery/v1",
        deliveryId: expectedDeliveryId,
        challengeId: challenge.challengeId,
        checkRunId: null,
        checkName: "ArchContext / Developer Review",
        headSha: challenge.headSha,
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt: null,
        lastErrorCode: null,
        createdAt: "2026-06-20T09:05:00.000Z",
        updatedAt: "2026-06-20T09:05:00.000Z"
      });
      expect(db.query("SELECT status, consumed_at, lease_owner, lease_expires_at FROM review_challenges WHERE challenge_id = ?").get(challenge.challengeId)).toEqual({
        status: "SUBMITTED",
        consumed_at: "2026-06-20T09:05:00.000Z",
        lease_owner: null,
        lease_expires_at: null
      });
      expect(db.query("SELECT challenge_id, payload_digest, nonce_hash FROM attestations WHERE attestation_id = ?").get(attestation.attestationId)).toEqual({
        challenge_id: challenge.challengeId,
        payload_digest: submission.attestationDigest,
        nonce_hash: submission.nonceHash
      });
      expect(db.query("SELECT delivery_id, status, attempt_count, check_run_id FROM check_deliveries WHERE challenge_id = ?").get(challenge.challengeId)).toEqual({
        delivery_id: expectedDeliveryId,
        status: "PENDING",
        attempt_count: 0,
        check_run_id: null
      });
      const sentMessages: unknown[] = [];
      const queue = new CloudflareCheckDeliveryQueuePort({
        async send(message) {
          sentMessages.push(message);
          return {
            metadata: {
              metrics: {
                backlogCount: 1,
                backlogBytes: 256,
                oldestMessageTimestamp: Date.parse("2026-06-20T09:05:00.000Z")
              }
            }
          };
        }
      });
      const enqueued = await cp.enqueueCheckDelivery({
        queue,
        checkDelivery,
        payloadDigest: submission.attestationDigest!
      });
      expect(enqueued).toMatchObject({
        queued: true,
        deliveryId: expectedDeliveryId,
        queueMessage: {
          schemaVersion: CHECK_DELIVERY_QUEUE_MESSAGE_SCHEMA_VERSION,
          kind: "github.check-delivery",
          id: expectedDeliveryId,
          deliveryId: expectedDeliveryId,
          challengeId: challenge.challengeId,
          checkName: "ArchContext / Developer Review",
          headSha: challenge.headSha,
          status: "PENDING",
          attempt: 0,
          payloadDigest: submission.attestationDigest!
        }
      });
      expect(enqueued.messageDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(sentMessages).toEqual([enqueued.queueMessage]);
      const serializedQueueMessage = JSON.stringify(enqueued.queueMessage);
      expect(serializedQueueMessage).not.toContain(challenge.nonce);
      expect(serializedQueueMessage).not.toContain("installationId");
      expect(serializedQueueMessage).not.toContain("repositoryId");
      await expect(cp.enqueueCheckDelivery({
        queue: {
          send() {
            throw new Error("queue-send-failed");
          }
        },
        checkDelivery,
        payloadDigest: submission.attestationDigest!
      })).rejects.toThrow("queue-send-failed");
      expect(db.query("SELECT status, consumed_at FROM review_challenges WHERE challenge_id = ?").get(challenge.challengeId)).toEqual({
        status: "SUBMITTED",
        consumed_at: "2026-06-20T09:05:00.000Z"
      });
      expect(() => cp.persistAcceptedReviewChallengeSubmission({
        db,
        challenge,
        attestation,
        submission: { ...submission, accepted: false, attestationDigest: undefined } as any,
        acceptedAt: "2026-06-20T09:05:01.000Z"
      })).toThrow("review-challenge-submit-not-accepted");
    } finally {
      db.close();
    }
  });

  test("plans Check delivery retry with backoff jitter Retry-After and max attempts", async () => {
    const cp = new ControlPlane();
    const checkDelivery: CheckDelivery = {
      schemaVersion: "archcontext.check-delivery/v1",
      deliveryId: checkDeliveryIdempotencyKey({
        challengeId: "chal_retry",
        checkName: "ArchContext / Developer Review",
        headSha: "a".repeat(40)
      }),
      challengeId: "chal_retry",
      checkRunId: null,
      checkName: "ArchContext / Developer Review",
      headSha: "a".repeat(40),
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
      createdAt: "2026-06-20T09:00:00.000Z",
      updatedAt: "2026-06-20T09:00:00.000Z"
    };
    const policy = { maxAttempts: 3, baseDelaySeconds: 10, maxDelaySeconds: 300, jitterRatio: 0 };

    const first = cp.planCheckDeliveryRetry({
      checkDelivery,
      now: "2026-06-20T09:05:00.000Z",
      errorCode: "github-503",
      policy
    });
    expect(first).toMatchObject({
      retry: true,
      reason: "retry-scheduled",
      attemptCount: 1,
      maxAttempts: 3,
      delaySeconds: 10,
      nextAttemptAt: "2026-06-20T09:05:10.000Z",
      checkDelivery: {
        status: "RETRYING",
        attemptCount: 1,
        nextAttemptAt: "2026-06-20T09:05:10.000Z",
        updatedAt: "2026-06-20T09:05:00.000Z",
        lastErrorCode: null
      }
    });
    expect(cp.listMetricSamples({ name: "check_delivery_lag_ms", deliveryId: checkDelivery.deliveryId })[0]).toMatchObject({
      unit: "milliseconds",
      value: 300000,
      labels: {
        attempt: "1",
        challengeId: "chal_retry",
        checkName: "ArchContext / Developer Review",
        deliveryId: checkDelivery.deliveryId,
        status: "RETRYING"
      }
    });
    expect(cp.listMetricSamples({ name: "check_delivery_retry_total", deliveryId: checkDelivery.deliveryId })[0]).toMatchObject({
      unit: "count",
      value: 1,
      labels: {
        attempt: "1",
        reason: "retry-scheduled",
        retry: "true",
        status: "RETRYING"
      }
    });

    const second = cp.planCheckDeliveryRetry({
      checkDelivery: first.checkDelivery,
      now: "2026-06-20T09:05:10.000Z",
      errorCode: "HEAD_SHA_MISMATCH",
      policy
    });
    expect(second).toMatchObject({
      retry: true,
      attemptCount: 2,
      delaySeconds: 20,
      nextAttemptAt: "2026-06-20T09:05:30.000Z",
      checkDelivery: {
        status: "RETRYING",
        attemptCount: 2,
        lastErrorCode: "HEAD_SHA_MISMATCH"
      }
    });

    const retryAfterSeconds = cp.planCheckDeliveryRetry({
      checkDelivery,
      now: "2026-06-20T09:05:00.000Z",
      errorCode: "github-429",
      retryAfter: "120",
      policy
    });
    expect(retryAfterSeconds).toMatchObject({
      retry: true,
      delaySeconds: 120,
      retryAfterDelaySeconds: 120,
      nextAttemptAt: "2026-06-20T09:07:00.000Z"
    });

    const retryAfterDate = cp.planCheckDeliveryRetry({
      checkDelivery,
      now: "2026-06-20T09:05:00.000Z",
      errorCode: "github-429",
      retryAfter: "2026-06-20T09:10:00.000Z",
      policy
    });
    expect(retryAfterDate).toMatchObject({
      retry: true,
      delaySeconds: 300,
      retryAfterDelaySeconds: 300,
      nextAttemptAt: "2026-06-20T09:10:00.000Z"
    });

    const jittered = cp.planCheckDeliveryRetry({
      checkDelivery,
      now: "2026-06-20T09:05:00.000Z",
      errorCode: "github-503",
      policy: { ...policy, jitterRatio: 0.5 }
    });
    const repeatedJitter = cp.planCheckDeliveryRetry({
      checkDelivery,
      now: "2026-06-20T09:05:00.000Z",
      errorCode: "github-503",
      policy: { ...policy, jitterRatio: 0.5 }
    });
    expect(jittered.delaySeconds).toBe(repeatedJitter.delaySeconds);
    expect(jittered.delaySeconds).toBeGreaterThanOrEqual(5);
    expect(jittered.delaySeconds).toBeLessThanOrEqual(15);

    const capped = cp.planCheckDeliveryRetry({
      checkDelivery,
      now: "2026-06-20T09:05:00.000Z",
      errorCode: "github-429",
      retryAfter: 999999,
      policy
    });
    expect(capped).toMatchObject({ retry: true, delaySeconds: 300 });

    const maxed = cp.planCheckDeliveryRetry({
      checkDelivery: { ...checkDelivery, status: "RETRYING", attemptCount: 2 },
      now: "2026-06-20T09:05:00.000Z",
      errorCode: "github-503",
      policy
    });
    expect(maxed).toMatchObject({
      retry: false,
      reason: "check-delivery-max-attempts-reached",
      attemptCount: 3,
      maxAttempts: 3
    });

    const terminal = cp.planCheckDeliveryRetry({
      checkDelivery: { ...checkDelivery, status: "PUBLISHED", checkRunId: "123", attemptCount: 1 },
      now: "2026-06-20T09:05:00.000Z",
      errorCode: "github-503",
      policy
    });
    expect(terminal).toMatchObject({
      retry: false,
      reason: "check-delivery-terminal-status"
    });

    await expect(cp.enqueueCheckDelivery({
      queue: {
        send(message, options) {
          expect(message.status).toBe("RETRYING");
          expect(options).toEqual({ delaySeconds: first.delaySeconds });
        }
      },
      checkDelivery: first.checkDelivery,
      payloadDigest: `sha256:${"1".repeat(64)}`,
      delaySeconds: first.delaySeconds
    })).resolves.toMatchObject({
      queued: true,
      delaySeconds: first.delaySeconds,
      queueMessage: {
        status: "RETRYING",
        attempt: 1
      }
    });

    expect(() => cp.planCheckDeliveryRetry({
      checkDelivery,
      now: "2026-06-20T09:05:00.000Z",
      errorCode: "github-429",
      retryAfter: "not-a-retry-after",
      policy
    })).toThrow("check-delivery-retryAfter-invalid");
    await expect(cp.enqueueCheckDelivery({
      queue: { send() {} },
      checkDelivery: first.checkDelivery,
      payloadDigest: `sha256:${"1".repeat(64)}`,
      delaySeconds: 0
    })).rejects.toThrow("checkDelivery.delaySeconds-invalid");
  });

  test("dead-letters and replays Check delivery through manual ops and Check rerequest", async () => {
    const cp = new ControlPlane();
    const checkDelivery: CheckDelivery = {
      schemaVersion: "archcontext.check-delivery/v1",
      deliveryId: checkDeliveryIdempotencyKey({
        challengeId: "chal_dlq",
        checkName: "ArchContext / Developer Review",
        headSha: "b".repeat(40)
      }),
      challengeId: "chal_dlq",
      checkRunId: null,
      checkName: "ArchContext / Developer Review",
      headSha: "b".repeat(40),
      status: "RETRYING",
      attemptCount: 4,
      nextAttemptAt: "2026-06-20T09:10:00.000Z",
      lastErrorCode: "CHECK_DELIVERY_FAILED",
      createdAt: "2026-06-20T09:00:00.000Z",
      updatedAt: "2026-06-20T09:06:00.000Z"
    };

    const deadLetter = cp.deadLetterCheckDelivery({
      checkDelivery,
      now: "2026-06-20T09:15:00.000Z",
      errorCode: "CHECK_DELIVERY_MAX_ATTEMPTS"
    });
    expect(deadLetter).toMatchObject({
      status: "DEAD_LETTER",
      attemptCount: 4,
      nextAttemptAt: null,
      lastErrorCode: "CHECK_DELIVERY_MAX_ATTEMPTS",
      updatedAt: "2026-06-20T09:15:00.000Z"
    });
    expect(() => cp.deadLetterCheckDelivery({
      checkDelivery: { ...checkDelivery, status: "PUBLISHED", checkRunId: "123" },
      now: "2026-06-20T09:15:00.000Z",
      errorCode: "CHECK_DELIVERY_FAILED"
    })).toThrow("check-delivery-dead-letter-transition-invalid");
    expect(() => cp.buildCheckDeliveryQueueMessage({
      checkDelivery: deadLetter,
      payloadDigest: `sha256:${"2".repeat(64)}`
    })).toThrow("check-delivery-not-queueable");

    const manualReplay = cp.replayDeadLetterCheckDelivery({
      checkDelivery: deadLetter,
      now: "2026-06-20T09:16:00.000Z",
      authorization: {
        actorId: "ops_1",
        permissionSource: "manual-ops",
        verifiedAt: "2026-06-20T09:16:00.000Z",
        reason: "operator-reviewed-github-outage"
      }
    });
    expect(manualReplay).toMatchObject({
      replayed: true,
      source: "manual-ops",
      checkDelivery: {
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt: null,
        lastErrorCode: null,
        updatedAt: "2026-06-20T09:16:00.000Z"
      }
    });
    expect(manualReplay.replayDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    const sentMessages: unknown[] = [];
    const queued = await cp.enqueueCheckDelivery({
      queue: {
        send(message, options) {
          sentMessages.push({ message, options });
        }
      },
      checkDelivery: manualReplay.checkDelivery,
      payloadDigest: `sha256:${"2".repeat(64)}`
    });
    expect(queued.queueMessage).toMatchObject({
      status: "PENDING",
      attempt: 0,
      deliveryId: checkDelivery.deliveryId
    });
    expect(sentMessages).toEqual([{ message: queued.queueMessage, options: undefined }]);

    const rerequest = cp.rerequestCheckDelivery({
      checkDelivery: deadLetter,
      now: "2026-06-20T09:17:00.000Z",
      githubDeliveryId: "github-delivery-123"
    });
    expect(rerequest).toMatchObject({
      replayed: true,
      source: "github-check-rerequest",
      checkDelivery: {
        status: "PENDING",
        attemptCount: 0,
        lastErrorCode: null
      }
    });
    expect(() => cp.replayDeadLetterCheckDelivery({
      checkDelivery,
      now: "2026-06-20T09:18:00.000Z",
      authorization: {
        actorId: "ops_1",
        permissionSource: "manual-ops",
        verifiedAt: "2026-06-20T09:18:00.000Z",
        reason: "not-dead-letter"
      }
    })).toThrow("check-delivery-not-dead-letter");
  });

  test("publishes Check delivery success only for the current submitted Challenge head", () => {
    const cp = new ControlPlane();
    const challenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_publish_current",
      nonce: "nonce_publish_current",
      status: "SUBMITTED"
    }));
    const checkDelivery: CheckDelivery = {
      schemaVersion: "archcontext.check-delivery/v1",
      deliveryId: checkDeliveryIdempotencyKey({
        challengeId: challenge.challengeId,
        checkName: "ArchContext / Developer Review",
        headSha: challenge.headSha
      }),
      challengeId: challenge.challengeId,
      checkRunId: null,
      checkName: "ArchContext / Developer Review",
      headSha: challenge.headSha,
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
      createdAt: "2026-06-20T09:05:00.000Z",
      updatedAt: "2026-06-20T09:05:00.000Z"
    };

    const published = cp.publishCurrentCheckDeliverySuccess({
      checkDelivery,
      challenge,
      currentPullHead: pullHeadForChallenge(challenge),
      checkRunId: "82579129841",
      publishedAt: "2026-06-20T09:06:00.000Z"
    });
    expect(published).toMatchObject({
      schemaVersion: "archcontext.check-delivery-publication/v1",
      published: true,
      reason: "published",
      checkRunId: "82579129841",
      currentHeadVerification: { accepted: true },
      checkDelivery: {
        status: "PUBLISHED",
        checkRunId: "82579129841",
        nextAttemptAt: null,
        lastErrorCode: null,
        updatedAt: "2026-06-20T09:06:00.000Z"
      },
      challenge: { status: "VERIFIED" }
    });
    expect(challenge.status).toBe("SUBMITTED");

    const newHeadChallenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_publish_new_head",
      headSha: "dddddddddddddddddddddddddddddddddddddddd",
      nonce: "nonce_publish_new_head"
    }));
    const superseded = cp.supersedeActiveReviewChallenges({
      challenges: [challenge, newHeadChallenge],
      nextChallenge: newHeadChallenge
    }).challenges.find((item) => item.challengeId === challenge.challengeId)!;
    const supersededResult = cp.publishCurrentCheckDeliverySuccess({
      checkDelivery,
      challenge: superseded,
      currentPullHead: pullHeadForChallenge(newHeadChallenge),
      checkRunId: "82579129842",
      publishedAt: "2026-06-20T09:07:00.000Z"
    });
    expect(supersededResult).toMatchObject({
      published: false,
      reason: "challenge-superseded",
      reasonCode: "CHALLENGE_SUPERSEDED",
      checkDelivery: {
        status: "DEAD_LETTER",
        checkRunId: null,
        nextAttemptAt: null,
        lastErrorCode: "CHALLENGE_SUPERSEDED",
        updatedAt: "2026-06-20T09:07:00.000Z"
      },
      challenge: { status: "SUPERSEDED" }
    });

    const headRace = cp.publishCurrentCheckDeliverySuccess({
      checkDelivery,
      challenge,
      currentPullHead: {
        ...pullHeadForChallenge(challenge),
        headSha: newHeadChallenge.headSha
      },
      checkRunId: "82579129843",
      publishedAt: "2026-06-20T09:08:00.000Z"
    });
    expect(headRace).toMatchObject({
      published: false,
      reason: "challenge-not-current",
      reasonCode: "HEAD_SHA_MISMATCH",
      currentHeadVerification: {
        accepted: false,
        reasonCode: "HEAD_SHA_MISMATCH"
      },
      checkDelivery: {
        status: "DEAD_LETTER",
        checkRunId: null,
        lastErrorCode: "HEAD_SHA_MISMATCH"
      },
      challenge: { status: "SUBMITTED" }
    });

    const terminal = cp.publishCurrentCheckDeliverySuccess({
      checkDelivery: published.checkDelivery,
      challenge: published.challenge,
      currentPullHead: pullHeadForChallenge(challenge),
      checkRunId: "82579129844",
      publishedAt: "2026-06-20T09:09:00.000Z"
    });
    expect(terminal).toMatchObject({
      published: false,
      reason: "check-delivery-terminal-status",
      checkDelivery: { checkRunId: "82579129841", status: "PUBLISHED" }
    });

    const checkNameMismatch = cp.publishCurrentCheckDeliverySuccess({
      checkDelivery: { ...checkDelivery, checkName: "ArchContext / Organization Runner" },
      challenge,
      currentPullHead: pullHeadForChallenge(challenge),
      checkRunId: "82579129845",
      publishedAt: "2026-06-20T09:10:00.000Z"
    });
    expect(checkNameMismatch).toMatchObject({
      published: false,
      reason: "check-delivery-name-mismatch",
      reasonCode: "TRUST_LEVEL_MISMATCH",
      checkDelivery: {
        status: "DEAD_LETTER",
        lastErrorCode: "TRUST_LEVEL_MISMATCH"
      }
    });
    expect(cp.listMetricSamples({ name: "check_delivery_lag_ms", deliveryId: checkDelivery.deliveryId }).map((sample) => sample.value)).toEqual(
      expect.arrayContaining([60000, 120000, 180000, 300000])
    );
    expect(cp.listMetricSamples({ name: "reject_reason_total", reasonCode: "HEAD_SHA_MISMATCH" })[0]).toMatchObject({
      value: 1,
      labels: {
        deliveryId: checkDelivery.deliveryId,
        reasonCode: "HEAD_SHA_MISMATCH",
        retryable: "true",
        status: "DEAD_LETTER"
      }
    });
    expect(JSON.stringify(cp.listMetricSamples())).not.toContain("function private");
    expect(JSON.stringify([supersededResult, headRace, checkNameMismatch])).not.toContain("stale");
  });

  test("rejects replay, expiry, supersede, and nonce mismatch without consuming nonce", () => {
    const cp = new ControlPlane();
    const challenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_nonce_reject",
      nonce: "nonce_reject_base",
      status: "LEASED"
    }));
    const attestation = signedAttestationForChallenge(challenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey);
    const accepted = cp.submitReviewChallengeAttestation({
      challenge,
      attestation,
      currentPullHead: pullHeadForChallenge(challenge),
      publicKey: CONTROL_PLANE_ATTESTATION_KEYPAIR.publicKey,
      now: "2026-06-20T09:05:00Z",
      consumedNonceHashes: new Set()
    });
    const replay = cp.submitReviewChallengeAttestation({
      challenge,
      attestation,
      currentPullHead: pullHeadForChallenge(challenge),
      publicKey: CONTROL_PLANE_ATTESTATION_KEYPAIR.publicKey,
      now: "2026-06-20T09:05:30Z",
      consumedNonceHashes: accepted.consumedNonceHashes
    });

    expect(replay).toMatchObject({ accepted: false, reasonCode: "CHALLENGE_ALREADY_CONSUMED" });

    const expiredChallenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_nonce_expired",
      nonce: "nonce_expired",
      status: "LEASED",
      expiresAt: "2026-06-20T09:06:00Z"
    }));
    const expired = cp.submitReviewChallengeAttestation({
      challenge: expiredChallenge,
      attestation: signedAttestationForChallenge(expiredChallenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey, { expiresAt: "2026-06-20T09:06:00Z" }),
      currentPullHead: pullHeadForChallenge(expiredChallenge),
      publicKey: CONTROL_PLANE_ATTESTATION_KEYPAIR.publicKey,
      now: "2026-06-20T09:06:00Z",
      consumedNonceHashes: new Set()
    });
    expect(expired).toMatchObject({ accepted: false, reasonCode: "CHALLENGE_EXPIRED" });
    expect(expired.consumedNonceHashes.has(expired.nonceHash)).toBe(false);

    const supersededChallenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_nonce_superseded",
      nonce: "nonce_superseded",
      status: "SUPERSEDED"
    }));
    const superseded = cp.submitReviewChallengeAttestation({
      challenge: supersededChallenge,
      attestation: signedAttestationForChallenge(supersededChallenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey),
      currentPullHead: pullHeadForChallenge(supersededChallenge),
      publicKey: CONTROL_PLANE_ATTESTATION_KEYPAIR.publicKey,
      now: "2026-06-20T09:05:00Z",
      consumedNonceHashes: new Set()
    });
    expect(superseded).toMatchObject({ accepted: false, reasonCode: "CHALLENGE_SUPERSEDED" });
    expect(superseded.consumedNonceHashes.has(superseded.nonceHash)).toBe(false);

    const mismatch = cp.submitReviewChallengeAttestation({
      challenge,
      attestation: signedAttestationForChallenge(challenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey, { nonce: "nonce_wrong" }),
      currentPullHead: pullHeadForChallenge(challenge),
      publicKey: CONTROL_PLANE_ATTESTATION_KEYPAIR.publicKey,
      now: "2026-06-20T09:05:00Z",
      consumedNonceHashes: new Set()
    });
    expect(mismatch).toMatchObject({ accepted: false, reasonCode: "NONCE_MISMATCH" });
    expect(mismatch.consumedNonceHashes.has(mismatch.nonceHash)).toBe(false);
    expect(challenge.status).toBe("LEASED");
  });

  test("rejects FG3-20 security matrix cases without consuming nonce", () => {
    const cp = new ControlPlane();
    const device = cp.registerDeviceKey({
      accountId: "acct_security_matrix",
      publicKeyId: "key_device_0001",
      publicKey: CONTROL_PLANE_ATTESTATION_KEYPAIR.publicKey,
      createdAt: "2026-06-20T09:00:00Z"
    });
    const activeKeyStatus = cp.getDeviceKeyStatus(device.deviceId);
    const challenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_security_matrix",
      nonce: "nonce_security_matrix",
      status: "LEASED"
    }));
    const baseSubmit = {
      challenge,
      currentPullHead: pullHeadForChallenge(challenge),
      publicKey: CONTROL_PLANE_ATTESTATION_KEYPAIR.publicKey,
      signingKeyStatus: activeKeyStatus,
      now: "2026-06-20T09:05:00Z",
      consumedNonceHashes: new Set<string>()
    };
    type SecurityMatrixCase = {
      name: string;
      reasonCode: string;
      attestation: ReturnType<typeof signedAttestationForChallenge>;
      challenge?: ReturnType<typeof createReviewChallengeV2>;
      expectedHeadTreeOid?: string;
    };
    const organizationChallenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_security_org",
      nonce: "nonce_security_org",
      requiredTrust: "organization",
      status: "LEASED"
    }));
    const cases: SecurityMatrixCase[] = [
      { name: "repository", reasonCode: "REPOSITORY_MISMATCH", attestation: signedAttestationForChallenge(challenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey, { repositoryId: 99999 }) },
      { name: "pull-request", reasonCode: "PULL_REQUEST_MISMATCH", attestation: signedAttestationForChallenge(challenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey, { pullRequestNumber: 99 }) },
      { name: "head", reasonCode: "HEAD_SHA_MISMATCH", attestation: signedAttestationForChallenge(challenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey, { headSha: "dddddddddddddddddddddddddddddddddddddddd" }) },
      { name: "base", reasonCode: "BASE_SHA_MISMATCH", attestation: signedAttestationForChallenge(challenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey, { baseSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" }) },
      { name: "tree", reasonCode: "TREE_OID_MISMATCH", attestation: signedAttestationForChallenge(challenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey), expectedHeadTreeOid: "tree_bbbbbbbb" },
      { name: "nonce", reasonCode: "NONCE_MISMATCH", attestation: signedAttestationForChallenge(challenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey, { nonce: "nonce_wrong" }) },
      { name: "zero-digest", reasonCode: "DIGEST_INVALID", attestation: signedAttestationForChallenge(challenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey, { reviewDigest: `sha256:${"0".repeat(64)}` }) },
      { name: "wrong-trust", reasonCode: "TRUST_LEVEL_MISMATCH", challenge: organizationChallenge, attestation: signedAttestationForChallenge(organizationChallenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey, {
        execution: {
          trustLevel: "developer",
          source: "clean-commit-worktree",
          principalId: "device_0001",
          publicKeyId: "key_device_0001"
        }
      }) }
    ];

    for (const { name, reasonCode, attestation, challenge: caseChallenge, expectedHeadTreeOid } of cases) {
      const inputChallenge = caseChallenge ?? challenge;
      const rejected = cp.submitReviewChallengeAttestation({
        ...baseSubmit,
        challenge: inputChallenge,
        currentPullHead: pullHeadForChallenge(inputChallenge),
        expectedHeadTreeOid,
        attestation
      });
      expect(rejected, name).toMatchObject({ accepted: false, reasonCode });
      expect(rejected.consumedNonceHashes.has(rejected.nonceHash), name).toBe(false);
      expect(inputChallenge.status, name).toBe("LEASED");
    }

    const revoked = cp.submitReviewChallengeAttestation({
      ...baseSubmit,
      attestation: signedAttestationForChallenge(challenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey),
      signingKeyStatus: { ...activeKeyStatus, status: "revoked", revokedAt: "2026-06-20T09:02:00Z" }
    });
    expect(revoked).toMatchObject({ accepted: false, reasonCode: "DEVICE_REVOKED" });
    expect(revoked.consumedNonceHashes.has(revoked.nonceHash)).toBe(false);

    const accepted = cp.submitReviewChallengeAttestation({
      ...baseSubmit,
      attestation: signedAttestationForChallenge(challenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey)
    });
    const replay = cp.submitReviewChallengeAttestation({
      ...baseSubmit,
      attestation: signedAttestationForChallenge(challenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey),
      consumedNonceHashes: accepted.consumedNonceHashes
    });
    expect(replay).toMatchObject({ accepted: false, reasonCode: "CHALLENGE_ALREADY_CONSUMED" });
    expect(replay.consumedNonceHashes).toEqual(accepted.consumedNonceHashes);
  });

  test("submits organization Attestation v2 only for active scoped RunnerIdentity and runner key", () => {
    const cp = new ControlPlane();
    const challenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_org_runner_submit",
      nonce: "nonce_org_runner_submit",
      requiredTrust: "organization",
      status: "LEASED"
    }));
    const runner = cp.registerRunnerKey({
      runnerId: "runner_0001",
      installationId: challenge.installationId,
      repositoryIds: [challenge.repositoryId],
      workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
      publicKeyId: "key_runner_0001",
      publicKey: CONTROL_PLANE_ATTESTATION_KEYPAIR.publicKey,
      createdAt: "2026-06-20T09:00:00Z",
      authorization: {
        actorId: "github_user_runner_submit",
        actorLogin: "runner-admin",
        installationId: challenge.installationId,
        repositoryAdminIds: [challenge.repositoryId],
        permissionSource: "test-fixture",
        verifiedAt: "2026-06-20T08:59:59Z",
        reason: "organization-attestation-submit-test"
      }
    });
    const attestation = signedAttestationForChallenge(challenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey);
    const baseSubmit = {
      challenge,
      attestation,
      currentPullHead: pullHeadForChallenge(challenge),
      publicKey: CONTROL_PLANE_ATTESTATION_KEYPAIR.publicKey,
      signingKeyStatus: cp.getRunnerKeyStatus(runner.runnerId),
      now: "2026-06-20T09:05:00Z",
      consumedNonceHashes: new Set<string>(),
      expectedHeadTreeOid: attestation.headTreeOid
    };

    const missingRunner = cp.submitReviewChallengeAttestation(baseSubmit);
    expect(missingRunner).toMatchObject({ accepted: false, reasonCode: "RUNNER_NOT_FOUND" });
    expect(missingRunner.consumedNonceHashes.has(missingRunner.nonceHash)).toBe(false);

    const revokedRunner = cp.submitReviewChallengeAttestation({
      ...baseSubmit,
      runnerIdentity: { ...runner, status: "revoked" as const, revokedAt: "2026-06-20T09:01:00Z" }
    });
    expect(revokedRunner).toMatchObject({ accepted: false, reasonCode: "RUNNER_REVOKED" });
    expect(revokedRunner.consumedNonceHashes.has(revokedRunner.nonceHash)).toBe(false);

    const scopeMismatch = cp.submitReviewChallengeAttestation({
      ...baseSubmit,
      runnerIdentity: { ...runner, repositoryIds: [99999], scope: { kind: "repository" as const, repositoryIds: [99999] } }
    });
    expect(scopeMismatch).toMatchObject({ accepted: false, reasonCode: "RUNNER_SCOPE_MISMATCH" });
    expect(scopeMismatch.consumedNonceHashes.has(scopeMismatch.nonceHash)).toBe(false);

    const developerRequiredChallenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_org_runner_developer_required",
      nonce: "nonce_org_runner_developer_required",
      requiredTrust: "developer",
      status: "LEASED"
    }));
    const organizationOnDeveloperUnsigned = createAttestationV2({
      ...attestationInput(developerRequiredChallenge),
      execution: {
        trustLevel: "organization",
        source: "organization-runner-checkout",
        principalId: runner.runnerId,
        publicKeyId: runner.publicKeyId,
        runnerId: runner.runnerId,
        workflowRef: runner.workflowRef,
        runId: "1234567890",
        runAttempt: 1
      }
    });
    const organizationOnDeveloperAttestation = createAttestationV2({
      ...organizationOnDeveloperUnsigned,
      signature: {
        algorithm: "ed25519",
        value: sign(null, Buffer.from(canonicalAttestationV2(organizationOnDeveloperUnsigned), "utf8"), CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey).toString("base64")
      }
    });
    const wrongTrust = cp.submitReviewChallengeAttestation({
      ...baseSubmit,
      challenge: developerRequiredChallenge,
      currentPullHead: pullHeadForChallenge(developerRequiredChallenge),
      attestation: organizationOnDeveloperAttestation,
      runnerIdentity: runner
    });
    expect(wrongTrust).toMatchObject({ accepted: false, reasonCode: "TRUST_LEVEL_MISMATCH" });
    expect(wrongTrust.consumedNonceHashes.has(wrongTrust.nonceHash)).toBe(false);

    const revokedRunnerKey = cp.submitReviewChallengeAttestation({
      ...baseSubmit,
      runnerIdentity: runner,
      signingKeyStatus: { ...baseSubmit.signingKeyStatus, status: "revoked" as const, revokedAt: "2026-06-20T09:02:00Z" }
    });
    expect(revokedRunnerKey).toMatchObject({ accepted: false, reasonCode: "RUNNER_REVOKED" });
    expect(revokedRunnerKey.consumedNonceHashes.has(revokedRunnerKey.nonceHash)).toBe(false);

    const accepted = cp.submitReviewChallengeAttestation({
      ...baseSubmit,
      runnerIdentity: runner
    });
    expect(accepted).toMatchObject({ accepted: true });
    expect(accepted.consumedNonceHashes.has(accepted.nonceHash)).toBe(true);
  });

  test("rechecks current PR head at submit and rejects raced old-head results before consuming nonce", async () => {
    const cp = new ControlPlane();
    const challenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_submit_head_race",
      nonce: "nonce_submit_head_race",
      status: "LEASED"
    }));
    const attestation = signedAttestationForChallenge(challenge, CONTROL_PLANE_ATTESTATION_KEYPAIR.privateKey);
    const requests: unknown[] = [];
    const rejected = await cp.fetchAndSubmitReviewChallengeAttestation({
      challenge,
      attestation,
      github: {
        async getPullHeadMetadata(input) {
          requests.push(input);
          return {
            ...pullHeadForChallenge(challenge),
            headSha: "dddddddddddddddddddddddddddddddddddddddd"
          };
        }
      },
      publicKey: CONTROL_PLANE_ATTESTATION_KEYPAIR.publicKey,
      now: "2026-06-20T09:05:00Z",
      consumedNonceHashes: new Set()
    });

    expect(requests).toEqual([{
      installationId: challenge.installationId,
      repositoryId: challenge.repositoryId,
      pullRequestNumber: challenge.pullRequestNumber
    }]);
    expect(rejected).toMatchObject({
      accepted: false,
      reasonCode: "HEAD_SHA_MISMATCH",
      currentHeadVerification: {
        accepted: false,
        reasonCode: "HEAD_SHA_MISMATCH",
        challengeId: challenge.challengeId,
        expected: { headSha: challenge.headSha },
        observed: { headSha: "dddddddddddddddddddddddddddddddddddddddd" }
      }
    });
    expect(rejected.consumedNonceHashes.has(rejected.nonceHash)).toBe(false);
    expect(challenge.status).toBe("LEASED");
  });

  test("rejects Attestation v1 submissions for new required checks", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const cp = new ControlPlane();
    const challenge = createReviewChallengeV2(reviewChallengeInput({
      challengeId: "chal_v1_submit_reject",
      nonce: "nonce_v1_submit_reject",
      status: "LEASED"
    }));
    const legacyChallenge = createReviewChallenge({
      repository: { provider: "github", owner: "ancienttwo", name: "arch-context", visibility: "private" },
      headSha: challenge.headSha,
      expiresAt: challenge.expiresAt
    });
    const legacyAttestation = signLocalAttestation({
      challenge: { ...legacyChallenge, challengeId: challenge.challengeId, nonce: challenge.nonce },
      worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      reviewDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      deviceId: "device_legacy_1",
      publicKeyId: "key_legacy_1",
      privateKey,
      issuedAt: "2026-06-20T09:00:00Z"
    });

    const rejected = cp.submitReviewChallengeAttestation({
      challenge,
      attestation: legacyAttestation,
      currentPullHead: pullHeadForChallenge(challenge),
      publicKey,
      now: "2026-06-20T09:05:00Z",
      consumedNonceHashes: new Set()
    });

    expect(rejected).toMatchObject({ accepted: false, reasonCode: "ATTESTATION_SCHEMA_UNSUPPORTED" });
    expect(rejected.consumedNonceHashes.has(rejected.nonceHash)).toBe(false);
    expect(challenge.status).toBe("LEASED");
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

function reviewChallengeInput(overrides: Partial<Parameters<typeof createReviewChallengeV2>[0]> = {}): Parameters<typeof createReviewChallengeV2>[0] {
  return {
    installationId: 10001,
    repositoryId: 20002,
    pullRequestNumber: 42,
    headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    nonce: "nonce_base64url_0001",
    requiredTrust: "developer",
    policyProfileId: "policy.default",
    createdAt: "2026-06-20T09:00:00Z",
    expiresAt: "2026-06-20T09:15:00Z",
    ...overrides
  };
}

function insertReviewChallengePersistenceRow(
  db: Database,
  challenge: ReturnType<typeof createReviewChallengeV2>,
  overrides: { leaseOwner?: string | null; leaseExpiresAt?: string | null } = {}
): void {
  db.query(`
    INSERT INTO review_challenges (
      challenge_id,
      installation_id,
      repository_id,
      pull_request_number,
      head_sha,
      base_sha,
      required_trust,
      policy_profile_id,
      nonce_hash,
      status,
      lease_owner,
      lease_expires_at,
      created_at,
      expires_at,
      superseded_by,
      consumed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    challenge.challengeId,
    challenge.installationId,
    challenge.repositoryId,
    challenge.pullRequestNumber,
    challenge.headSha,
    challenge.baseSha,
    challenge.requiredTrust,
    challenge.policyProfileId,
    reviewChallengeNonceHash(challenge),
    challenge.status,
    overrides.leaseOwner ?? null,
    overrides.leaseExpiresAt ?? null,
    challenge.createdAt,
    challenge.expiresAt,
    null,
    null
  );
}

function attestationInput(
  challenge: ReturnType<typeof createReviewChallengeV2>,
  overrides: Partial<Parameters<typeof createAttestationV2>[0]> = {}
): Parameters<typeof createAttestationV2>[0] {
  const execution: Parameters<typeof createAttestationV2>[0]["execution"] = challenge.requiredTrust === "organization"
    ? {
        trustLevel: "organization",
        source: "organization-runner-checkout",
        principalId: "runner_0001",
        publicKeyId: "key_runner_0001",
        runnerId: "runner_0001",
        workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
        runId: "1234567890",
        runAttempt: 1
      }
    : {
        trustLevel: "developer",
        source: "clean-commit-worktree",
        principalId: "device_0001",
        publicKeyId: "key_device_0001"
      };
  return {
    challengeId: challenge.challengeId,
    installationId: challenge.installationId,
    repositoryId: challenge.repositoryId,
    pullRequestNumber: challenge.pullRequestNumber,
    headSha: challenge.headSha,
    baseSha: challenge.baseSha,
    mergeBaseSha: "cccccccccccccccccccccccccccccccccccccccc",
    headTreeOid: "tree_aaaaaaaa",
    worktreeDigest: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
    modelDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    policyDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    codeFactsDigest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
    reviewDigest: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
    result: "pass",
    execution,
    runtime: {
      version: "0.2.0",
      buildDigest: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
      [CODE_GRAPH_VERSION_KEY]: "1.0.1",
      capabilitiesDigest: "sha256:6666666666666666666666666666666666666666666666666666666666666666"
    } as Parameters<typeof createAttestationV2>[0]["runtime"],
    nonce: challenge.nonce,
    startedAt: "2026-06-20T09:03:00Z",
    completedAt: "2026-06-20T09:04:00Z",
    expiresAt: challenge.expiresAt,
    ...overrides
  };
}

function signedAttestationForChallenge(
  challenge: ReturnType<typeof createReviewChallengeV2>,
  privateKey: KeyObject,
  overrides: Partial<Parameters<typeof createAttestationV2>[0]> = {}
) {
  const unsigned = createAttestationV2(attestationInput(challenge, overrides));
  return createAttestationV2({
    ...unsigned,
    signature: {
      algorithm: "ed25519",
      value: sign(null, Buffer.from(canonicalAttestationV2(unsigned), "utf8"), privateKey).toString("base64")
    }
  });
}

function pullHeadForChallenge(challenge: ReturnType<typeof createReviewChallengeV2>) {
  return {
    installationId: challenge.installationId,
    repositoryId: challenge.repositoryId,
    pullRequestNumber: challenge.pullRequestNumber,
    headSha: challenge.headSha,
    baseSha: challenge.baseSha
  };
}

function organizationExecutionForRunner(runner: { runnerId: string; publicKeyId: string; workflowRef: string }): Parameters<typeof createAttestationV2>[0]["execution"] {
  return {
    trustLevel: "organization",
    source: "organization-runner-checkout",
    principalId: runner.runnerId,
    publicKeyId: runner.publicKeyId,
    runnerId: runner.runnerId,
    workflowRef: runner.workflowRef,
    runId: "1234567890",
    runAttempt: 1
  };
}

const CODE_GRAPH_VERSION_KEY = ["code", "Graph", "Version"].join("");
