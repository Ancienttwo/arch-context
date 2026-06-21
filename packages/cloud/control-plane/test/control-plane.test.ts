import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { canonicalAttestationV2, createAttestationV2, createReviewChallenge, createReviewChallengeV2, publicKeyFingerprint, signLocalAttestation, signOrganizationAttestation } from "@archcontext/cloud/attestation";
import { assertNoUploadRoutes, BILLING_PRICES, ControlPlane, DEFAULT_REVIEW_CHALLENGE_LEASE_TTL_MS, DEFAULT_REVIEW_CHALLENGE_TTL_MS, DEFAULT_RUNNER_KEY_ROTATION_OVERLAP_MS, reviewChallengeNonceHash, routeDigest, WORKER_LIMITS } from "../src/index";
import { createShortAccessToken, KeychainTokenStore } from "@archcontext/cloud/control-plane-client";

const CONTROL_PLANE_ATTESTATION_KEYPAIR = generateKeyPairSync("ed25519");

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
      actorId: "github_user_100",
      actorLogin: "octo-admin",
      resource: {
        kind: "runner-key",
        runnerId: runner.runnerId,
        installationId: 10001,
        scopeKind: "repository",
        repositoryIds: [20002],
        publicKeyId: "key_runner_0001",
        publicKeyFingerprint: fingerprint
      },
      reason: "runner-key-lifecycle-test"
    });
    expect(auditEvents[0].eventId).toMatch(/^audit_[a-f0-9]{16}$/);
    expect(auditEvents[0].metadataDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(auditEvents)).not.toContain(privateKey.export({ format: "pem", type: "pkcs8" }).toString());
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
