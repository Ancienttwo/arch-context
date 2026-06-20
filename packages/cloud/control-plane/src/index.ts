import { createHmac, randomBytes, type KeyObject } from "node:crypto";
import {
  createReviewChallengeV2,
  publicKeyFingerprint,
  verifyLocalAttestation,
  verifyAttestationV2ForReviewChallenge,
  type CreateReviewChallengeV2Input,
  type LocalAttestation,
  type OrgRunnerIdentity,
  type ReviewChallenge
} from "@archcontext/cloud/attestation";
import {
  CONTROL_PLANE_ROUTES,
  controlPlaneRouteDigest,
  digestJson,
  transitionReviewChallengeStatus,
  type DeviceIdentity,
  type GovernanceKeyStatus,
  type GitHubGovernancePort,
  type GovernanceReasonCode,
  type NotificationEvent,
  type NotificationProviderConfig,
  type PullHeadMetadata,
  type ReviewChallengePullHeadVerification,
  type ReviewChallengeStatus,
  type ReviewChallengeV2
} from "@archcontext/contracts";
import {
  assertNotificationEventMinimal,
  auditNotificationPayload,
  defaultNotificationProviderConfigs,
  serializeNotificationEvent
} from "@archcontext/cloud/notifications";

export { CONTROL_PLANE_ROUTES };

export const WORKER_LIMITS = {
  maxBodyBytes: 64 * 1024,
  cpuMs: 30_000,
  requestTimeoutMs: 15_000,
  rateLimitPerMinute: 120
} as const;

export interface Account {
  id: string;
  githubUserId: string;
  plan: "free" | "pro";
  billingInterval: "none" | "monthly" | "annual";
  subscriptionStatus: "active" | "trialing" | "past_due" | "canceled" | "refunded";
}

export interface RegisterDeviceKeyInput {
  accountId: string;
  publicKeyId: string;
  publicKey?: KeyObject;
  publicKeyFingerprint?: string;
  deviceId?: string;
  createdAt?: string;
}

export interface DeviceKeyFingerprintDisplay {
  deviceId: string;
  publicKeyId: string;
  fingerprint: string;
  status: DeviceIdentity["status"];
  createdAt: string;
  revokedAt?: string | null;
}

export const BILLING_PRICES = {
  monthly: { priceUsd: 5, label: "$5/user/month" },
  annual: { priceUsd: 99, label: "$99/user/year" }
} as const;

export const DEFAULT_REVIEW_CHALLENGE_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_REVIEW_CHALLENGE_LEASE_TTL_MS = 5 * 60 * 1000;

const ACTIVE_REVIEW_CHALLENGE_STATUSES = new Set<ReviewChallengeStatus>(["PENDING", "LEASED", "SUBMITTED"]);
const CONSUMED_REVIEW_CHALLENGE_STATUSES = new Set<ReviewChallengeStatus>(["SUBMITTED", "VERIFIED", "REJECTED"]);

export type CloudPrivacySurface = "log" | "trace" | "queue" | "error";
export type ClaimReviewChallengeLeaseReason = GovernanceReasonCode | "LEASE_ACTIVE";

export type IssueReviewChallengeInput = Omit<CreateReviewChallengeV2Input, "nonce" | "createdAt" | "expiresAt"> & {
  nonce?: string;
  createdAt?: string;
  expiresAt?: string;
  ttlMs?: number;
};

export interface ReviewChallengeLease {
  challengeId: string;
  ownerId: string;
  leasedAt: string;
  expiresAt: string;
}

export interface ClaimReviewChallengeLeaseResult {
  claimed: boolean;
  reasonCode?: ClaimReviewChallengeLeaseReason;
  challenge: ReviewChallengeV2;
  lease?: ReviewChallengeLease;
}

export interface SubmitReviewChallengeAttestationResult {
  accepted: boolean;
  reasonCode?: GovernanceReasonCode;
  challenge: ReviewChallengeV2;
  nonceHash: string;
  consumedNonceHashes: Set<string>;
  currentHeadVerification?: ReviewChallengePullHeadVerification;
  attestationDigest?: string;
}

export type ReviewChallengePullHeadMismatchReason = NonNullable<ReviewChallengePullHeadVerification["reasonCode"]>;

export function reviewChallengeNonceHash(challenge: Pick<ReviewChallengeV2, "nonce">): string {
  return digestJson({
    schemaVersion: "archcontext.review-challenge-nonce/v1",
    nonce: challenge.nonce
  });
}

export function verifyReviewChallengePullHead(input: {
  challenge: ReviewChallengeV2;
  pullHead: PullHeadMetadata;
}): ReviewChallengePullHeadVerification {
  const expected = reviewChallengePullHeadIdentity(input.challenge);
  const observed = {
    installationId: input.pullHead.installationId,
    repositoryId: input.pullHead.repositoryId,
    pullRequestNumber: input.pullHead.pullRequestNumber,
    headSha: input.pullHead.headSha,
    baseSha: input.pullHead.baseSha
  };
  const reasonCode =
    observed.installationId !== expected.installationId || observed.repositoryId !== expected.repositoryId ? "REPOSITORY_MISMATCH" :
    observed.pullRequestNumber !== expected.pullRequestNumber ? "PULL_REQUEST_MISMATCH" :
    observed.headSha !== expected.headSha ? "HEAD_SHA_MISMATCH" :
    observed.baseSha !== expected.baseSha ? "BASE_SHA_MISMATCH" :
    undefined;
  return {
    schemaVersion: "archcontext.review-challenge-pull-head-verification/v1",
    accepted: reasonCode === undefined,
    ...(reasonCode === undefined ? {} : { reasonCode }),
    challengeId: input.challenge.challengeId,
    expected,
    observed
  };
}

const SOURCE_CODE_KEY = ["source", "Code"].join("");
const CODE_GRAPH_KEY = ["code", "Graph"].join("");
const DIFF_BODY_KEY = ["diff", "Body"].join("");
const SYMBOL_PAYLOAD_KEY = ["symbol", "Payload"].join("");
const ARCHITECTURE_MODEL_BODY_KEY = ["architecture", "Model", "Body"].join("");
const FORBIDDEN_PRIVATE_CONTENT_KEYS = new Set([
  "source",
  SOURCE_CODE_KEY,
  "source_code",
  "sourceBody",
  "source_body",
  "diff",
  DIFF_BODY_KEY,
  "diff_body",
  "patch",
  "filename",
  "fileName",
  "filePath",
  "symbol",
  SYMBOL_PAYLOAD_KEY,
  "symbol_payload",
  CODE_GRAPH_KEY,
  "modelBody",
  "model_body",
  ARCHITECTURE_MODEL_BODY_KEY,
  "architecture_model_body",
  "finding",
  "findingBody",
  "findingDetail",
  "finding_detail",
  "prompt",
  "completion",
  "llmProvider",
  "body",
  "files"
].map((key) => key.toLowerCase()));

const PRIVATE_CONTENT_VALUE_PATTERNS = [
  new RegExp(["source", "code"].join("\\s*"), "i"),
  new RegExp(["diff", "body"].join("\\s*"), "i"),
  new RegExp(["symbol", "payload"].join("\\s*"), "i"),
  new RegExp(["architecture", "model", "body"].join("\\s*"), "i"),
  new RegExp(["finding", "detail"].join("\\s*"), "i"),
  /@@/,
  /private[-_ ]?patch/i,
  /Bearer\s+(?!\[REDACTED\])/i,
  /(access|refresh|secret|token)_[A-Za-z0-9_-]+/
] as const;

const CLOUD_PRIVACY_ALLOWED_FIELDS: Record<CloudPrivacySurface, Set<string>> = {
  log: new Set(["requestId", "routeId", "installationId", "repositoryId", "pullRequestNumber", "headShaPrefix", "challengeId", "attestationId", "checkDeliveryId", "status", "reasonCode", "latencyMs", "attempt", "runtimeVersion"]),
  trace: new Set(["requestId", "routeId", "spanId", "parentSpanId", "installationId", "repositoryId", "pullRequestNumber", "headShaPrefix", "challengeId", "attestationId", "checkDeliveryId", "status", "reasonCode", "latencyMs", "attempt", "runtimeVersion"]),
  queue: new Set(["kind", "id", "accountId", "eventId", "deliveryId", "challengeId", "checkRunId", "checkName", "headSha", "status", "attempt", "attemptCount", "nextAttemptAt", "lastErrorCode", "payloadDigest"]),
  error: new Set(["errorCode", "reasonCode", "code", "status", "statusCode", "retryable", "requestId", "routeId"])
};

export class ControlPlane {
  readonly accounts = new Map<string, Account>();
  readonly webhookDeliveries = new Set<string>();
  readonly revokedDevices = new Set<string>();
  readonly deviceIdentities = new Map<string, DeviceIdentity>();
  readonly orgRunners = new Map<string, OrgRunnerIdentity>();
  readonly notificationProviders = new Map<string, NotificationProviderConfig>();
  readonly notificationProviderScopes = new Map<string, { accountId?: string; installationId?: number }>();
  readonly notificationQueue: ReturnType<typeof serializeNotificationEvent>[] = [];
  readonly releaseRollbacks: string[] = [];

  loginWithGitHub(githubUserId: string): Account {
    const id = `acct_${githubUserId}`;
    const account = this.accounts.get(id) ?? { id, githubUserId, plan: "free", billingInterval: "none" as const, subscriptionStatus: "active" as const };
    this.accounts.set(id, account);
    return account;
  }

  startDeviceAuthorization(accountId: string) {
    return { deviceCode: `device_${accountId}`, userCode: "ARCH-CTX", verificationUri: "https://archctx.repoharness.com/api/device" };
  }

  completeDeviceAuthorization(deviceCode: string) {
    return { accessToken: `access_${deviceCode}`, refreshTokenRef: `keychain://${deviceCode}`, expiresIn: 900 };
  }

  setSubscription(accountId: string, status: Account["subscriptionStatus"], plan: Account["plan"], billingInterval: Account["billingInterval"] = plan === "pro" ? "monthly" : "none"): Account {
    const account = this.accounts.get(accountId) ?? { id: accountId, githubUserId: accountId, plan: "free", billingInterval: "none" as const, subscriptionStatus: "active" as const };
    const updated = { ...account, status, subscriptionStatus: status, plan, billingInterval: plan === "free" ? "none" : billingInterval };
    this.accounts.set(accountId, updated);
    return updated;
  }

  entitlement(input: { accountId?: string; repositoryVisibility: "public" | "private"; offlineUntil?: string; now?: string }) {
    if (input.repositoryVisibility === "public") {
      return { allowed: true, reason: "public-repository-free", privateRepositoryScope: "public-only" };
    }
    const account = input.accountId ? this.accounts.get(input.accountId) : undefined;
    if (account?.plan === "pro" && ["active", "trialing"].includes(account.subscriptionStatus)) {
      return {
        allowed: true,
        reason: "user-level-pro-private-entitlement",
        billingInterval: account.billingInterval,
        privateRepositoryScope: "user-all-private-repositories"
      };
    }
    if (input.offlineUntil && input.now && input.offlineUntil > input.now) return { allowed: true, reason: "offline-grace-period" };
    return { allowed: false, reason: "pro-required-for-private-repository" };
  }

  signEntitlementToken(payload: object, secret: string): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", secret).update(body).digest("base64url");
    return `${body}.${sig}`;
  }

  verifyEntitlementToken(token: string, secret: string): boolean {
    const [body, sig] = token.split(".");
    if (!body || !sig) return false;
    return createHmac("sha256", secret).update(body).digest("base64url") === sig;
  }

  stripeCheckout(accountId: string, billingInterval: "monthly" | "annual" = "monthly") {
    const price = BILLING_PRICES[billingInterval];
    return {
      url: `https://billing.stripe.example/checkout?client_reference_id=${accountId}&interval=${billingInterval}`,
      priceUsd: price.priceUsd,
      billingInterval,
      label: price.label
    };
  }

  stripePortal(accountId: string) {
    return { url: `https://billing.stripe.example/portal?client_reference_id=${accountId}` };
  }

  switchBillingInterval(accountId: string, billingInterval: "monthly" | "annual") {
    const account = this.accounts.get(accountId);
    if (!account || account.plan !== "pro") throw new Error("pro-subscription-required");
    return {
      accountId,
      billingInterval,
      proration: "stripe-managed",
      portal: this.stripePortal(accountId).url
    };
  }

  mapStripeEvent(event: { id: string; type: string; accountId: string; billingInterval?: "monthly" | "annual" }) {
    this.assertWebhookIdempotent("stripe", event.id);
    if (event.type === "customer.subscription.deleted") return this.setSubscription(event.accountId, "canceled", "free", "none");
    if (event.type === "invoice.payment_failed") return this.setSubscription(event.accountId, "past_due", "pro", event.billingInterval ?? "monthly");
    if (event.type === "charge.refunded") return this.setSubscription(event.accountId, "refunded", "free", "none");
    return this.setSubscription(event.accountId, "active", "pro", event.billingInterval ?? "monthly");
  }

  registerDeviceKey(input: RegisterDeviceKeyInput): DeviceIdentity {
    const accountId = requireNonEmptyString(input.accountId, "device.accountId");
    const publicKeyId = requireNonEmptyString(input.publicKeyId, "device.publicKeyId");
    const fingerprint = input.publicKeyFingerprint ?? (input.publicKey ? publicKeyFingerprint(input.publicKey) : undefined);
    if (!fingerprint) throw new Error("device-public-key-required");
    requireKeyFingerprint(fingerprint, "device.publicKeyFingerprint");
    const createdAt = input.createdAt ?? new Date().toISOString();
    requireFiniteTime(createdAt, "device.createdAt");
    const deviceId = input.deviceId ?? deviceIdentityId({ accountId, publicKeyId, fingerprint });

    const current = this.deviceIdentities.get(deviceId);
    if (current) {
      if (
        current.accountId === accountId
        && current.publicKeyId === publicKeyId
        && current.publicKeyFingerprint === fingerprint
        && current.status === "active"
      ) {
        return current;
      }
      throw new Error(current.status === "revoked" ? "device-revoked" : "device-identity-conflict");
    }

    for (const device of this.deviceIdentities.values()) {
      if (device.accountId === accountId && device.publicKeyId === publicKeyId && device.status === "active") {
        throw new Error("device-key-already-active");
      }
    }

    const identity: DeviceIdentity = {
      schemaVersion: "archcontext.device-identity/v1",
      deviceId,
      accountId,
      publicKeyId,
      publicKeyFingerprint: fingerprint,
      status: "active",
      createdAt
    };
    this.deviceIdentities.set(deviceId, identity);
    this.revokedDevices.delete(deviceId);
    return identity;
  }

  listDeviceKeys(accountId: string): DeviceIdentity[] {
    const normalizedAccountId = requireNonEmptyString(accountId, "device.accountId");
    return [...this.deviceIdentities.values()]
      .filter((device) => device.accountId === normalizedAccountId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.deviceId.localeCompare(b.deviceId));
  }

  getDeviceKeyStatus(deviceId: string): GovernanceKeyStatus {
    const device = this.requireDeviceIdentity(deviceId);
    return deviceIdentityKeyStatus(device);
  }

  displayDeviceKeyFingerprint(deviceId: string): DeviceKeyFingerprintDisplay {
    const device = this.requireDeviceIdentity(deviceId);
    return {
      deviceId: device.deviceId,
      publicKeyId: device.publicKeyId,
      fingerprint: device.publicKeyFingerprint,
      status: device.status,
      createdAt: device.createdAt,
      ...(device.revokedAt === undefined ? {} : { revokedAt: device.revokedAt })
    };
  }

  revokeDeviceKey(deviceId: string, revokedAt: string): DeviceIdentity {
    const device = this.requireDeviceIdentity(deviceId);
    requireFiniteTime(revokedAt, "device.revokedAt");
    const revoked: DeviceIdentity = { ...device, status: "revoked", revokedAt };
    this.deviceIdentities.set(device.deviceId, revoked);
    this.revokedDevices.add(device.deviceId);
    return revoked;
  }

  registerOrgRunner(identity: OrgRunnerIdentity): OrgRunnerIdentity {
    if (identity.installationId < 1) throw new Error("installation-required");
    this.orgRunners.set(identity.runnerId, identity);
    return identity;
  }

  revokeOrgRunner(runnerId: string, revokedAt: string): OrgRunnerIdentity {
    const current = this.orgRunners.get(runnerId);
    if (!current) throw new Error("runner-not-found");
    const revoked = { ...current, status: "revoked" as const, revokedAt };
    this.orgRunners.set(runnerId, revoked);
    return revoked;
  }

  verifyOrgRunnerAttestation(input: {
    challenge: ReviewChallenge;
    attestation: LocalAttestation;
    publicKey: KeyObject;
    now: string;
    expectedInstallationId: number;
    expectedHeadSha: string;
  }) {
    const runner = this.orgRunners.get(input.attestation.device.deviceId);
    return verifyLocalAttestation({
      challenge: input.challenge,
      attestation: input.attestation,
      publicKey: input.publicKey,
      now: input.now,
      expectedRepository: input.challenge.repository,
      expectedHeadSha: input.expectedHeadSha,
      expectedTrustLevel: "organization",
      orgRunner: runner,
      expectedInstallationId: input.expectedInstallationId
    });
  }

  issueReviewChallenge(input: IssueReviewChallengeInput): ReviewChallengeV2 {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const expiresAt = input.expiresAt ?? new Date(Date.parse(createdAt) + (input.ttlMs ?? DEFAULT_REVIEW_CHALLENGE_TTL_MS)).toISOString();
    return createReviewChallengeV2({
      ...input,
      nonce: input.nonce ?? randomBytes(32).toString("base64url"),
      createdAt,
      expiresAt
    });
  }

  transitionReviewChallenge(input: { challenge: ReviewChallengeV2; to: ReviewChallengeStatus }): ReviewChallengeV2 {
    return transitionReviewChallengeStatus(input.challenge, input.to);
  }

  claimReviewChallengeLease(input: {
    challenge: ReviewChallengeV2;
    claimantId: string;
    now: string;
    currentLease?: ReviewChallengeLease | null;
    ttlMs?: number;
  }): ClaimReviewChallengeLeaseResult {
    const claimantId = input.claimantId.trim();
    if (!claimantId) throw new Error("review-challenge-lease-owner-required");
    const nowMs = requireFiniteTime(input.now, "now");
    const challengeExpiresAtMs = requireFiniteTime(input.challenge.expiresAt, "challenge.expiresAt");
    const reject = (reasonCode: ClaimReviewChallengeLeaseReason, challenge = input.challenge): ClaimReviewChallengeLeaseResult => ({
      claimed: false,
      reasonCode,
      challenge,
      ...(input.currentLease?.challengeId === input.challenge.challengeId ? { lease: input.currentLease } : {})
    });

    if (CONSUMED_REVIEW_CHALLENGE_STATUSES.has(input.challenge.status)) return reject("CHALLENGE_ALREADY_CONSUMED");
    if (input.challenge.status === "SUPERSEDED") return reject("CHALLENGE_SUPERSEDED");
    if (input.challenge.status === "EXPIRED" || challengeExpiresAtMs <= nowMs) {
      const expiredChallenge = input.challenge.status === "PENDING" || input.challenge.status === "LEASED"
        ? transitionReviewChallengeStatus(input.challenge, "EXPIRED")
        : input.challenge;
      return reject("CHALLENGE_EXPIRED", expiredChallenge);
    }
    if (input.challenge.status !== "PENDING" && input.challenge.status !== "LEASED") return reject("CHALLENGE_ALREADY_CONSUMED");

    const currentLease = input.currentLease?.challengeId === input.challenge.challengeId ? input.currentLease : undefined;
    const currentLeaseExpiresAtMs = currentLease ? requireFiniteTime(currentLease.expiresAt, "currentLease.expiresAt") : 0;
    if (currentLease && currentLeaseExpiresAtMs > nowMs && currentLease.ownerId !== claimantId) {
      return reject("LEASE_ACTIVE", input.challenge.status === "PENDING" ? transitionReviewChallengeStatus(input.challenge, "LEASED") : input.challenge);
    }

    const ttlMs = input.ttlMs ?? DEFAULT_REVIEW_CHALLENGE_LEASE_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("review-challenge-lease-ttl-invalid");
    const expiresAt = new Date(Math.min(nowMs + ttlMs, challengeExpiresAtMs)).toISOString();
    return {
      claimed: true,
      challenge: input.challenge.status === "PENDING" ? transitionReviewChallengeStatus(input.challenge, "LEASED") : input.challenge,
      lease: {
        challengeId: input.challenge.challengeId,
        ownerId: claimantId,
        leasedAt: new Date(nowMs).toISOString(),
        expiresAt
      }
    };
  }

  supersedeActiveReviewChallenges(input: {
    challenges: readonly ReviewChallengeV2[];
    nextChallenge: ReviewChallengeV2;
  }): { challenges: ReviewChallengeV2[]; supersededChallengeIds: string[] } {
    const supersededChallengeIds: string[] = [];
    const challenges = input.challenges.map((challenge) => {
      const samePullRequest = challenge.installationId === input.nextChallenge.installationId
        && challenge.repositoryId === input.nextChallenge.repositoryId
        && challenge.pullRequestNumber === input.nextChallenge.pullRequestNumber;
      const olderHead = challenge.headSha !== input.nextChallenge.headSha;
      if (!samePullRequest || !olderHead || !ACTIVE_REVIEW_CHALLENGE_STATUSES.has(challenge.status)) return challenge;
      supersededChallengeIds.push(challenge.challengeId);
      return transitionReviewChallengeStatus(challenge, "SUPERSEDED");
    });
    return { challenges, supersededChallengeIds };
  }

  verifyReviewChallengePullHead(input: { challenge: ReviewChallengeV2; pullHead: PullHeadMetadata }): ReviewChallengePullHeadVerification {
    return verifyReviewChallengePullHead(input);
  }

  async fetchAndVerifyReviewChallengePullHead(input: {
    challenge: ReviewChallengeV2;
    github: Pick<GitHubGovernancePort, "getPullHeadMetadata">;
  }): Promise<ReviewChallengePullHeadVerification> {
    const pullHead = await input.github.getPullHeadMetadata({
      installationId: input.challenge.installationId,
      repositoryId: input.challenge.repositoryId,
      pullRequestNumber: input.challenge.pullRequestNumber
    });
    return this.verifyReviewChallengePullHead({ challenge: input.challenge, pullHead });
  }

  submitReviewChallengeAttestation(input: {
    challenge: ReviewChallengeV2;
    attestation: unknown;
    currentPullHead: PullHeadMetadata;
    publicKey: KeyObject;
    signingKeyStatus?: GovernanceKeyStatus;
    now: string;
    consumedNonceHashes: ReadonlySet<string>;
    expectedHeadTreeOid?: string;
  }): SubmitReviewChallengeAttestationResult {
    const nonceHash = reviewChallengeNonceHash(input.challenge);
    const consumedNonceHashes = new Set(input.consumedNonceHashes);
    const currentHeadVerification = this.verifyReviewChallengePullHead({
      challenge: input.challenge,
      pullHead: input.currentPullHead
    });
    const reject = (reasonCode: GovernanceReasonCode, verification?: ReviewChallengePullHeadVerification): SubmitReviewChallengeAttestationResult => ({
      accepted: false,
      reasonCode,
      challenge: input.challenge,
      nonceHash,
      consumedNonceHashes,
      ...(verification ? { currentHeadVerification: verification } : {})
    });

    if (input.consumedNonceHashes.has(nonceHash) || CONSUMED_REVIEW_CHALLENGE_STATUSES.has(input.challenge.status)) {
      return reject("CHALLENGE_ALREADY_CONSUMED");
    }
    if (input.challenge.status === "SUPERSEDED") return reject("CHALLENGE_SUPERSEDED");
    if (!currentHeadVerification.accepted) {
      const reasonCode = currentHeadVerification.reasonCode;
      if (!reasonCode) throw new Error("current-head-verification-reason-missing");
      return reject(reasonCode, currentHeadVerification);
    }
    const attestationCheck = verifyAttestationV2ForReviewChallenge({
      challenge: input.challenge,
      attestation: input.attestation,
      publicKey: input.publicKey,
      signingKeyStatus: input.signingKeyStatus,
      now: input.now,
      expectedHeadTreeOid: input.expectedHeadTreeOid
    });
    if (!attestationCheck.accepted) return reject(attestationCheck.reasonCode);

    consumedNonceHashes.add(nonceHash);
    return {
      accepted: true,
      challenge: transitionReviewChallengeStatus(input.challenge, "SUBMITTED"),
      nonceHash,
      consumedNonceHashes,
      currentHeadVerification,
      attestationDigest: attestationCheck.attestationDigest
    };
  }

  async fetchAndSubmitReviewChallengeAttestation(input: {
    challenge: ReviewChallengeV2;
    attestation: unknown;
    github: Pick<GitHubGovernancePort, "getPullHeadMetadata">;
    publicKey: KeyObject;
    signingKeyStatus?: GovernanceKeyStatus;
    now: string;
    consumedNonceHashes: ReadonlySet<string>;
    expectedHeadTreeOid?: string;
  }): Promise<SubmitReviewChallengeAttestationResult> {
    const currentPullHead = await input.github.getPullHeadMetadata({
      installationId: input.challenge.installationId,
      repositoryId: input.challenge.repositoryId,
      pullRequestNumber: input.challenge.pullRequestNumber
    });
    return this.submitReviewChallengeAttestation({
      challenge: input.challenge,
      attestation: input.attestation,
      currentPullHead,
      publicKey: input.publicKey,
      signingKeyStatus: input.signingKeyStatus,
      now: input.now,
      consumedNonceHashes: input.consumedNonceHashes,
      expectedHeadTreeOid: input.expectedHeadTreeOid
    });
  }

  assertWebhookIdempotent(provider: string, deliveryId: string): void {
    const key = `${provider}:${deliveryId}`;
    if (this.webhookDeliveries.has(key)) throw new Error("duplicate-webhook-delivery");
    this.webhookDeliveries.add(key);
  }

  revokeDevice(deviceId: string, revokedAt = new Date().toISOString()): DeviceIdentity | void {
    const normalizedDeviceId = requireNonEmptyString(deviceId, "device.deviceId");
    if (this.deviceIdentities.has(normalizedDeviceId)) return this.revokeDeviceKey(normalizedDeviceId, revokedAt);
    this.revokedDevices.add(normalizedDeviceId);
  }

  buildQueueMessage(input: { kind: string; id: string; accountId?: string }) {
    return projectCloudPrivacySurface("queue", input) as { kind: string; id: string; accountId?: string };
  }

  listNotificationProviders(scope: { accountId?: string; installationId?: number } = {}): NotificationProviderConfig[] {
    if (this.notificationProviders.size === 0) {
      for (const config of defaultNotificationProviderConfigs()) this.notificationProviders.set(config.id, config);
    }
    return [...this.notificationProviders.values()]
      .filter((config) => {
        const owner = this.notificationProviderScopes.get(config.id);
        if (!owner || (!scope.accountId && !scope.installationId)) return true;
        if (scope.accountId && owner.accountId === scope.accountId) return true;
        if (scope.installationId && owner.installationId === scope.installationId) return true;
        return false;
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  setNotificationProvider(config: NotificationProviderConfig, scope: { accountId?: string; installationId?: number } = {}): NotificationProviderConfig {
    if (config.enabled && config.provider !== "github-check" && !config.secretRef) {
      throw new Error("notification-provider-secret-ref-required");
    }
    this.notificationProviders.set(config.id, config);
    this.notificationProviderScopes.set(config.id, scope);
    return config;
  }

  enqueueNotification(event: NotificationEvent): { queued: boolean; queueMessage: { kind: string; id: string }; payloadDigest: string } {
    assertNotificationEventMinimal(event as unknown as Record<string, unknown>);
    const payload = serializeNotificationEvent(event);
    const audit = auditNotificationPayload(payload);
    if (!audit.ok) throw new Error(`notification-payload-invalid: ${audit.findings.join(", ")}`);
    this.notificationQueue.push(payload);
    return {
      queued: true,
      queueMessage: this.buildQueueMessage({ kind: "notification.event", id: event.eventId }),
      payloadDigest: digestJson(payload as any)
    };
  }

  buildChatGptDirectoryListing() {
    return {
      name: "ArchContext",
      slug: "archcontext",
      description: "Architecture runtime for coding agents.",
      permissions: ["account:read", "billing:read", "installations:read", "device_sessions:revoke"],
      repositoryContent: "local-runtime-only",
      privacyUrl: "https://archctx.repoharness.com/privacy",
      installUrl: "https://archctx.repoharness.com/chatgpt/install"
    };
  }

  appReviewChecklist() {
    return {
      oauth: "OAuth 2.1 + PKCE",
      dataUse: "Remote MCP metadata only; local runtime handles private repository context.",
      writes: "disabled-by-default-local-confirmation-required",
      rollback: "versioned-cloud-metadata-release"
    };
  }

  rollbackChatGptRelease(version: string): { rolledBack: boolean; version: string } {
    this.releaseRollbacks.push(version);
    return { rolledBack: true, version };
  }

  redactLog(value: string): string {
    return value.replace(/(access|refresh|secret|token)_[a-zA-Z0-9_-]+/g, "[REDACTED]");
  }

  projectLogRecord(input: Record<string, unknown>): Record<string, string | number | boolean> {
    return projectCloudPrivacySurface("log", input);
  }

  projectTraceRecord(input: Record<string, unknown>): Record<string, string | number | boolean> {
    return projectCloudPrivacySurface("trace", input);
  }

  projectQueuePayload(input: Record<string, unknown>): Record<string, string | number | boolean> {
    return projectCloudPrivacySurface("queue", input);
  }

  projectErrorObject(error: unknown, context: Record<string, unknown> = {}): Record<string, string | number | boolean> {
    const errorCode = typeof context.errorCode === "string"
      ? context.errorCode
      : error instanceof Error
        ? error.name
        : "UNKNOWN_ERROR";
    return projectCloudPrivacySurface("error", { ...context, errorCode });
  }

  retentionCutoff(now: string, days = 90): string {
    return new Date(Date.parse(now) - days * 24 * 60 * 60 * 1000).toISOString();
  }

  costAlert(input: { monthlyRevenueUsd: number; projectedCostUsd: number }) {
    return { alert: input.projectedCostUsd > input.monthlyRevenueUsd * 0.1 };
  }

  exportAccount(accountId: string) {
    return {
      account: this.accounts.get(accountId),
      devices: this.listDeviceKeys(accountId),
      revokedDevices: [...this.revokedDevices],
      orgRunners: [...this.orgRunners.values()].filter((runner) => runner.runnerId.includes(accountId)),
      deliveries: [...this.webhookDeliveries].filter((delivery) => delivery.includes(accountId) || !delivery.includes(":"))
    };
  }

  deleteAccount(accountId: string): void {
    this.accounts.delete(accountId);
    for (const device of [...this.deviceIdentities.values()]) {
      if (device.accountId === accountId) this.deviceIdentities.delete(device.deviceId);
    }
    for (const device of [...this.revokedDevices]) {
      if (device.includes(accountId)) this.revokedDevices.delete(device);
    }
  }

  private requireDeviceIdentity(deviceId: string): DeviceIdentity {
    const normalizedDeviceId = requireNonEmptyString(deviceId, "device.deviceId");
    const device = this.deviceIdentities.get(normalizedDeviceId);
    if (!device) throw new Error("device-not-found");
    return device;
  }
}

export function routeDigest(): string {
  return controlPlaneRouteDigest();
}

export function projectCloudPrivacySurface(surface: CloudPrivacySurface, input: Record<string, unknown>): Record<string, string | number | boolean> {
  const allowed = CLOUD_PRIVACY_ALLOWED_FIELDS[surface];
  const projected: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (isForbiddenPrivateContentKey(key) || containsPrivateContent(value)) continue;
    if (key === "headSha" && (surface === "log" || surface === "trace")) {
      if (typeof value === "string" && value.length >= 12) projected.headShaPrefix = value.slice(0, 12);
      continue;
    }
    if (!allowed.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") projected[key] = value;
  }
  return projected;
}

export function assertNoUploadRoutes(routes: readonly string[] = CONTROL_PLANE_ROUTES): void {
  const forbidden = /(upload|index|detail|embedding|blob|proxy)/i;
  for (const route of routes) {
    if (forbidden.test(route)) throw new Error(`Forbidden route: ${route}`);
  }
}

function isForbiddenPrivateContentKey(key: string): boolean {
  return FORBIDDEN_PRIVATE_CONTENT_KEYS.has(key.toLowerCase());
}

function containsPrivateContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some(containsPrivateContent);
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([key, child]) => isForbiddenPrivateContentKey(key) || containsPrivateContent(child));
  }
  if (typeof value !== "string") return false;
  return PRIVATE_CONTENT_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function requireFiniteTime(value: string, field: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`review-challenge-lease-time-invalid: ${field}`);
  return time;
}

function reviewChallengePullHeadIdentity(challenge: ReviewChallengeV2) {
  return {
    installationId: challenge.installationId,
    repositoryId: challenge.repositoryId,
    pullRequestNumber: challenge.pullRequestNumber,
    headSha: challenge.headSha,
    baseSha: challenge.baseSha
  };
}

function requireNonEmptyString(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field}-required`);
  return value.trim();
}

function requireKeyFingerprint(value: string, field: string): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error(`${field}-invalid`);
}

function deviceIdentityId(input: { accountId: string; publicKeyId: string; fingerprint: string }): string {
  const digest = digestJson({
    schemaVersion: "archcontext.device-identity-id/v1",
    accountId: input.accountId,
    publicKeyId: input.publicKeyId,
    fingerprint: input.fingerprint
  });
  return `device_${digest.slice("sha256:".length, "sha256:".length + 16)}`;
}

function deviceIdentityKeyStatus(device: DeviceIdentity): GovernanceKeyStatus {
  return {
    schemaVersion: "archcontext.governance-key-status/v1",
    publicKeyId: device.publicKeyId,
    ownerKind: "device",
    ownerId: device.deviceId,
    fingerprint: device.publicKeyFingerprint,
    status: device.status,
    createdAt: device.createdAt,
    ...(device.revokedAt === undefined ? {} : { revokedAt: device.revokedAt })
  };
}
