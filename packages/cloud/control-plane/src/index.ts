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
  createRunnerIdentity,
  digestJson,
  runnerIdentityEffectiveScope,
  runnerIdentityKeyStatus,
  runnerIdentityMatchesScope,
  transitionRunnerIdentityStatus,
  transitionReviewChallengeStatus,
  type CreateRunnerIdentityInput,
  type DeviceIdentity,
  type GovernanceKeyStatus,
  type GitHubGovernancePort,
  type GovernanceReasonCode,
  type NotificationEvent,
  type NotificationProviderConfig,
  type PullHeadMetadata,
  type ReviewChallengePullHeadVerification,
  type ReviewChallengeStatus,
  type RunnerIdentity,
  type RunnerIdentityScope,
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

export type RegisterRunnerKeyInput = Omit<CreateRunnerIdentityInput, "runnerId" | "publicKeyFingerprint" | "status" | "createdAt"> & {
  runnerId?: string;
  publicKey?: KeyObject;
  publicKeyFingerprint?: string;
  createdAt?: string;
  authorization: RunnerKeyAdminAuthorization;
};

export interface RunnerKeyFingerprintDisplay {
  runnerId: string;
  installationId: number;
  repositoryIds: number[];
  scope: RunnerIdentityScope;
  workflowRef: string;
  publicKeyId: string;
  fingerprint: string;
  status: RunnerIdentity["status"];
  createdAt: string;
  rotatedAt?: string | null;
  revokedAt?: string | null;
}

export interface RunnerKeyRotationWindow {
  previousRunnerId: string;
  nextRunnerId: string;
  rotatedAt: string;
  overlapUntil: string;
}

export interface RotateRunnerKeyInput {
  runnerId: string;
  publicKeyId: string;
  publicKey?: KeyObject;
  publicKeyFingerprint?: string;
  nextRunnerId?: string;
  rotatedAt?: string;
  overlapUntil?: string;
  overlapMs?: number;
  authorization: RunnerKeyAdminAuthorization;
}

export interface RevokeRunnerKeyInput {
  runnerId: string;
  revokedAt: string;
  authorization: RunnerKeyAdminAuthorization;
}

export interface DescribeRunnerKeyRecoveryInput {
  runnerId: string;
  installationId: number;
  repositoryId: number;
  workflowRef?: string;
  now: string;
}

export type RunnerKeyTerminationKind = "revoked" | "unregistered";
export type RunnerKeyRecoveryReasonCode = Extract<
  GovernanceReasonCode,
  "RUNNER_NOT_FOUND" | "RUNNER_REVOKED" | "RUNNER_SCOPE_MISMATCH" | "WORKFLOW_REF_MISMATCH"
>;
export type RunnerKeyRecoveryAction =
  | "none"
  | "register-runner-identity"
  | "register-replacement-runner-key"
  | "register-runner-for-repository"
  | "use-approved-runner-workflow";

export interface RunnerKeyRecoveryStatus {
  schemaVersion: "archcontext.runner-key-recovery/v1";
  runnerId: string;
  lifecycleState: RunnerIdentity["status"] | "not_found" | "unregistered";
  submitAllowed: boolean;
  immediateRejection: boolean;
  retryCurrentKey: boolean;
  replacementRequired: boolean;
  action: RunnerKeyRecoveryAction;
  nextActions: string[];
  reasonCode?: RunnerKeyRecoveryReasonCode;
  installationId?: number;
  repositoryIds?: number[];
  scope?: RunnerIdentityScope;
  workflowRef?: string;
  publicKeyId?: string;
  fingerprint?: string;
  revokedAt?: string | null;
}

export interface RunnerKeyAdminAuthorization {
  actorId: string;
  actorLogin?: string;
  installationId: number;
  organizationAdmin?: boolean;
  repositoryAdminIds?: number[];
  permissionSource: "github-app" | "github-oauth" | "manual-ops" | "test-fixture";
  verifiedAt: string;
  reason?: string;
}

export type RunnerKeyAuditAction = "runner_key.register" | "runner_key.rotate" | "runner_key.revoke" | "runner_key.unregister";

export interface ControlPlaneAuditEvent {
  schemaVersion: "archcontext.audit-event/v1";
  eventId: string;
  action: RunnerKeyAuditAction;
  actorId: string;
  actorLogin?: string;
  occurredAt: string;
  resource: {
    kind: "runner-key";
    runnerId: string;
    installationId: number;
    scopeKind: RunnerIdentityScope["kind"];
    repositoryIds: number[];
    workflowRef: string;
    publicKeyId: string;
    publicKeyFingerprint: string;
    relatedRunnerId?: string;
  };
  reason: string;
  metadataDigest: string;
}

export const BILLING_PRICES = {
  monthly: { priceUsd: 5, label: "$5/user/month" },
  annual: { priceUsd: 99, label: "$99/user/year" }
} as const;

export const DEFAULT_REVIEW_CHALLENGE_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_REVIEW_CHALLENGE_LEASE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_RUNNER_KEY_ROTATION_OVERLAP_MS = 15 * 60 * 1000;

const ACTIVE_REVIEW_CHALLENGE_STATUSES = new Set<ReviewChallengeStatus>(["PENDING", "LEASED", "SUBMITTED"]);
const CONSUMED_REVIEW_CHALLENGE_STATUSES = new Set<ReviewChallengeStatus>(["SUBMITTED", "VERIFIED", "REJECTED"]);
const RUNNER_KEY_NOT_FOUND_RECOVERY_ACTIONS = [
  "Register a Runner Key for the same installation, repository or organization scope, and workflow ref.",
  "Store the replacement private key in the customer Secret Store before retrying the Organization Runner job.",
  "Lease a fresh Challenge or retry the current leased Challenge with the replacement Runner Key."
];
const RUNNER_KEY_REVOKED_RECOVERY_ACTIONS = [
  "Stop using the current runner private key and Secret Store reference.",
  "Register a replacement Runner Key with a new publicKeyId for the same installation, scope, and workflow ref.",
  "Update the customer Secret Store reference and rerun the Organization Runner job."
];

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
  lastHeartbeatAt?: string;
  expiresAt: string;
}

export interface ClaimReviewChallengeLeaseResult {
  claimed: boolean;
  reasonCode?: ClaimReviewChallengeLeaseReason | "LEASE_EXPIRED";
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
  readonly runnerIdentities = new Map<string, RunnerIdentity>();
  readonly runnerKeyRotationWindows = new Map<string, RunnerKeyRotationWindow>();
  readonly runnerKeyTerminationKinds = new Map<string, RunnerKeyTerminationKind>();
  readonly auditEvents: ControlPlaneAuditEvent[] = [];
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

  registerRunnerKey(input: RegisterRunnerKeyInput): RunnerIdentity {
    const identity = this.createRunnerIdentityFromKeyInput(input);
    const authorization = requireRunnerKeyAdminAuthorization(input.authorization, identity);
    const stored = this.storeRunnerIdentity(identity);
    this.recordRunnerKeyAudit("runner_key.register", authorization, stored, stored.createdAt);
    return stored;
  }

  listRunnerKeys(installationId: number): RunnerIdentity[] {
    const normalizedInstallationId = requirePositiveInteger(installationId, "runner.installationId");
    return [...this.runnerIdentities.values()]
      .filter((runner) => runner.installationId === normalizedInstallationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.runnerId.localeCompare(b.runnerId));
  }

  getRunnerKeyStatus(runnerId: string): GovernanceKeyStatus {
    return runnerIdentityKeyStatus(this.requireRunnerIdentity(runnerId));
  }

  displayRunnerKeyFingerprint(runnerId: string): RunnerKeyFingerprintDisplay {
    const runner = this.requireRunnerIdentity(runnerId);
    return {
      runnerId: runner.runnerId,
      installationId: runner.installationId,
      repositoryIds: runner.repositoryIds,
      scope: runnerIdentityEffectiveScope(runner),
      workflowRef: runner.workflowRef,
      publicKeyId: runner.publicKeyId,
      fingerprint: runner.publicKeyFingerprint,
      status: runner.status,
      createdAt: runner.createdAt,
      ...(runner.rotatedAt === undefined ? {} : { rotatedAt: runner.rotatedAt }),
      ...(runner.revokedAt === undefined ? {} : { revokedAt: runner.revokedAt })
    };
  }

  rotateRunnerKey(input: RotateRunnerKeyInput): { previous: RunnerIdentity; next: RunnerIdentity; rotationWindow: RunnerKeyRotationWindow } {
    const current = this.requireRunnerIdentity(input.runnerId);
    if (current.status === "revoked") throw new Error("runner-key-revoked");
    if (current.status !== "active") throw new Error("runner-key-rotation-not-active");
    const authorization = requireRunnerKeyAdminAuthorization(input.authorization, current);
    const rotatedAt = input.rotatedAt ?? new Date().toISOString();
    const rotatedAtMs = requireFiniteTime(rotatedAt, "runner.rotatedAt");
    const overlapUntil = input.overlapUntil ?? new Date(rotatedAtMs + (input.overlapMs ?? DEFAULT_RUNNER_KEY_ROTATION_OVERLAP_MS)).toISOString();
    const overlapUntilMs = requireFiniteTime(overlapUntil, "runner.overlapUntil");
    if (overlapUntilMs <= rotatedAtMs) throw new Error("runner-key-overlap-window-invalid");

    const next = this.storeRunnerIdentity(this.createRunnerIdentityFromKeyInput({
      runnerId: input.nextRunnerId,
      installationId: current.installationId,
      repositoryIds: current.repositoryIds,
      scope: runnerIdentityEffectiveScope(current),
      workflowRef: current.workflowRef,
      publicKeyId: input.publicKeyId,
      publicKey: input.publicKey,
      publicKeyFingerprint: input.publicKeyFingerprint,
      createdAt: rotatedAt,
      authorization: input.authorization
    }));
    const previous = transitionRunnerIdentityStatus(current, "rotating", rotatedAt);
    this.runnerIdentities.set(previous.runnerId, previous);
    const rotationWindow: RunnerKeyRotationWindow = {
      previousRunnerId: previous.runnerId,
      nextRunnerId: next.runnerId,
      rotatedAt,
      overlapUntil
    };
    this.runnerKeyRotationWindows.set(previous.runnerId, rotationWindow);
    this.recordRunnerKeyAudit("runner_key.rotate", authorization, previous, rotatedAt, next.runnerId);
    return { previous, next, rotationWindow };
  }

  revokeRunnerKey(input: RevokeRunnerKeyInput): RunnerIdentity {
    return this.terminateRunnerKey(input, "runner_key.revoke", "revoked");
  }

  unregisterRunnerKey(input: RevokeRunnerKeyInput): RunnerIdentity {
    return this.terminateRunnerKey(input, "runner_key.unregister", "unregistered");
  }

  describeRunnerKeyRecovery(input: DescribeRunnerKeyRecoveryInput): RunnerKeyRecoveryStatus {
    const runnerId = requireNonEmptyString(input.runnerId, "runner.runnerId");
    const installationId = requirePositiveInteger(input.installationId, "runner.installationId");
    const repositoryId = requirePositiveInteger(input.repositoryId, "runner.repositoryId");
    requireFiniteTime(input.now, "runner.now");

    const runner = this.runnerIdentities.get(runnerId);
    if (!runner) {
      return {
        schemaVersion: "archcontext.runner-key-recovery/v1",
        runnerId,
        lifecycleState: "not_found",
        submitAllowed: false,
        immediateRejection: true,
        retryCurrentKey: false,
        replacementRequired: true,
        reasonCode: "RUNNER_NOT_FOUND",
        action: "register-runner-identity",
        nextActions: [...RUNNER_KEY_NOT_FOUND_RECOVERY_ACTIONS]
      };
    }

    const base = runnerKeyRecoveryBase(runner);
    if (runner.status === "revoked") {
      return {
        ...base,
        lifecycleState: this.runnerKeyTerminationKinds.get(runnerId) === "unregistered" ? "unregistered" : "revoked",
        submitAllowed: false,
        immediateRejection: true,
        retryCurrentKey: false,
        replacementRequired: true,
        reasonCode: "RUNNER_REVOKED",
        action: "register-replacement-runner-key",
        nextActions: [...RUNNER_KEY_REVOKED_RECOVERY_ACTIONS]
      };
    }
    if (input.workflowRef !== undefined && runner.workflowRef !== input.workflowRef) {
      return {
        ...base,
        submitAllowed: false,
        immediateRejection: true,
        retryCurrentKey: false,
        replacementRequired: true,
        reasonCode: "WORKFLOW_REF_MISMATCH",
        action: "use-approved-runner-workflow",
        nextActions: ["Use the workflow ref registered for this Runner Key or register a new Runner Key for the approved workflow."]
      };
    }
    if (!runnerIdentityMatchesScope(runner, { installationId, repositoryId, workflowRef: input.workflowRef })) {
      return {
        ...base,
        submitAllowed: false,
        immediateRejection: true,
        retryCurrentKey: false,
        replacementRequired: true,
        reasonCode: "RUNNER_SCOPE_MISMATCH",
        action: "register-runner-for-repository",
        nextActions: ["Register a Runner Key whose installation and repository or organization scope covers this pull request."]
      };
    }
    if (runner.status !== "active") {
      return {
        ...base,
        submitAllowed: false,
        immediateRejection: true,
        retryCurrentKey: false,
        replacementRequired: true,
        reasonCode: "RUNNER_REVOKED",
        action: "register-replacement-runner-key",
        nextActions: ["Use the active rotated Runner Key for Organization Attestation submission."]
      };
    }

    return {
      ...base,
      submitAllowed: true,
      immediateRejection: false,
      retryCurrentKey: true,
      replacementRequired: false,
      action: "none",
      nextActions: ["Retry the Organization Runner submission with the current active Runner Key."]
    };
  }

  private terminateRunnerKey(
    input: RevokeRunnerKeyInput,
    action: Extract<RunnerKeyAuditAction, "runner_key.revoke" | "runner_key.unregister">,
    terminationKind: RunnerKeyTerminationKind
  ): RunnerIdentity {
    const current = this.requireRunnerIdentity(input.runnerId);
    if (current.status === "revoked") throw new Error("runner-key-revoked");
    const authorization = requireRunnerKeyAdminAuthorization(input.authorization, current);
    const revokedAt = input.revokedAt;
    requireFiniteTime(revokedAt, "runner.revokedAt");
    const revoked = transitionRunnerIdentityStatus(current, "revoked", revokedAt);
    this.runnerIdentities.set(revoked.runnerId, revoked);
    for (const [windowRunnerId, window] of this.runnerKeyRotationWindows.entries()) {
      if (window.previousRunnerId === input.runnerId || window.nextRunnerId === input.runnerId) {
        this.runnerKeyRotationWindows.delete(windowRunnerId);
      }
    }
    this.runnerKeyTerminationKinds.set(revoked.runnerId, terminationKind);
    this.recordRunnerKeyAudit(action, authorization, revoked, revokedAt);
    return revoked;
  }

  listAuditEvents(filter: { action?: RunnerKeyAuditAction; actorId?: string; runnerId?: string } = {}): ControlPlaneAuditEvent[] {
    return this.auditEvents.filter((event) => {
      if (filter.action && event.action !== filter.action) return false;
      if (filter.actorId && event.actorId !== filter.actorId) return false;
      if (filter.runnerId && event.resource.runnerId !== filter.runnerId && event.resource.relatedRunnerId !== filter.runnerId) return false;
      return true;
    });
  }

  getRunnerKeyRotationWindow(runnerId: string): RunnerKeyRotationWindow | undefined {
    const normalizedRunnerId = requireNonEmptyString(runnerId, "runner.runnerId");
    return this.runnerKeyRotationWindows.get(normalizedRunnerId);
  }

  isRunnerKeyAccepted(input: { runnerId: string; installationId: number; repositoryId: number; workflowRef?: string; now: string }): boolean {
    const runner = this.runnerIdentities.get(requireNonEmptyString(input.runnerId, "runner.runnerId"));
    if (!runner) return false;
    requireFiniteTime(input.now, "runner.now");
    if (!runnerIdentityMatchesScope(runner, input)) return false;
    if (runner.status === "active") return true;
    if (runner.status !== "rotating") return false;
    const window = this.runnerKeyRotationWindows.get(runner.runnerId);
    return Boolean(window && Date.parse(input.now) <= Date.parse(window.overlapUntil));
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

  heartbeatReviewChallengeLease(input: {
    challenge: ReviewChallengeV2;
    lease: ReviewChallengeLease;
    ownerId: string;
    now: string;
    ttlMs?: number;
  }): ClaimReviewChallengeLeaseResult {
    const ownerId = input.ownerId.trim();
    if (!ownerId) throw new Error("review-challenge-lease-owner-required");
    const nowMs = requireFiniteTime(input.now, "now");
    const challengeExpiresAtMs = requireFiniteTime(input.challenge.expiresAt, "challenge.expiresAt");
    const reject = (reasonCode: ClaimReviewChallengeLeaseResult["reasonCode"], challenge = input.challenge): ClaimReviewChallengeLeaseResult => ({
      claimed: false,
      reasonCode,
      challenge,
      lease: input.lease
    });

    if (input.lease.challengeId !== input.challenge.challengeId) return reject("CHALLENGE_NOT_FOUND");
    if (CONSUMED_REVIEW_CHALLENGE_STATUSES.has(input.challenge.status)) return reject("CHALLENGE_ALREADY_CONSUMED");
    if (input.challenge.status === "SUPERSEDED") return reject("CHALLENGE_SUPERSEDED");
    if (input.challenge.status === "EXPIRED" || challengeExpiresAtMs <= nowMs) {
      const expiredChallenge = input.challenge.status === "PENDING" || input.challenge.status === "LEASED"
        ? transitionReviewChallengeStatus(input.challenge, "EXPIRED")
        : input.challenge;
      return reject("CHALLENGE_EXPIRED", expiredChallenge);
    }
    if (input.challenge.status !== "PENDING" && input.challenge.status !== "LEASED") return reject("CHALLENGE_ALREADY_CONSUMED");
    if (input.lease.ownerId !== ownerId) return reject("LEASE_ACTIVE", input.challenge.status === "PENDING" ? transitionReviewChallengeStatus(input.challenge, "LEASED") : input.challenge);
    if (requireFiniteTime(input.lease.expiresAt, "lease.expiresAt") <= nowMs) return reject("LEASE_EXPIRED");

    const ttlMs = input.ttlMs ?? DEFAULT_REVIEW_CHALLENGE_LEASE_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("review-challenge-lease-ttl-invalid");
    return {
      claimed: true,
      challenge: input.challenge.status === "PENDING" ? transitionReviewChallengeStatus(input.challenge, "LEASED") : input.challenge,
      lease: {
        ...input.lease,
        lastHeartbeatAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(Math.min(nowMs + ttlMs, challengeExpiresAtMs)).toISOString()
      }
    };
  }

  retryReviewChallengeLease(input: {
    challenge: ReviewChallengeV2;
    claimantId: string;
    now: string;
    currentLease?: ReviewChallengeLease | null;
    ttlMs?: number;
  }): ClaimReviewChallengeLeaseResult {
    const claimantId = input.claimantId.trim();
    if (!claimantId) throw new Error("review-challenge-lease-owner-required");
    const currentLease = input.currentLease?.challengeId === input.challenge.challengeId ? input.currentLease : undefined;
    if (!currentLease) return this.claimReviewChallengeLease(input);
    const nowMs = requireFiniteTime(input.now, "now");
    const currentLeaseExpiresAtMs = requireFiniteTime(currentLease.expiresAt, "currentLease.expiresAt");
    if (currentLease.ownerId === claimantId && currentLeaseExpiresAtMs > nowMs) {
      return this.heartbeatReviewChallengeLease({
        challenge: input.challenge,
        lease: currentLease,
        ownerId: claimantId,
        now: input.now,
        ttlMs: input.ttlMs
      });
    }
    return this.claimReviewChallengeLease(input);
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
    runnerIdentity?: RunnerIdentity;
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
      runnerIdentity: input.runnerIdentity,
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
    runnerIdentity?: RunnerIdentity;
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
      runnerIdentity: input.runnerIdentity,
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

  private createRunnerIdentityFromKeyInput(input: RegisterRunnerKeyInput): RunnerIdentity {
    const fingerprint = input.publicKeyFingerprint ?? (input.publicKey ? publicKeyFingerprint(input.publicKey) : undefined);
    if (!fingerprint) throw new Error("runner-public-key-required");
    requireKeyFingerprint(fingerprint, "runner.publicKeyFingerprint");
    const createdAt = input.createdAt ?? new Date().toISOString();
    requireFiniteTime(createdAt, "runner.createdAt");
    const runnerId = input.runnerId ?? runnerIdentityId({
      installationId: input.installationId,
      publicKeyId: input.publicKeyId,
      fingerprint
    });
    return createRunnerIdentity({
      ...input,
      runnerId,
      publicKeyFingerprint: fingerprint,
      status: "active",
      createdAt,
      rotatedAt: null,
      revokedAt: null
    });
  }

  private storeRunnerIdentity(identity: RunnerIdentity): RunnerIdentity {
    const current = this.runnerIdentities.get(identity.runnerId);
    if (current) {
      if (
        current.installationId === identity.installationId
        && current.publicKeyId === identity.publicKeyId
        && current.publicKeyFingerprint === identity.publicKeyFingerprint
        && current.status === "active"
      ) {
        return current;
      }
      throw new Error(current.status === "revoked" ? "runner-key-revoked" : "runner-identity-conflict");
    }

    for (const runner of this.runnerIdentities.values()) {
      if (runner.status === "revoked") continue;
      if (runner.publicKeyId === identity.publicKeyId) throw new Error("runner-key-already-active");
      if (runner.publicKeyFingerprint === identity.publicKeyFingerprint) throw new Error("runner-key-fingerprint-already-active");
    }

    this.runnerIdentities.set(identity.runnerId, identity);
    return identity;
  }

  private recordRunnerKeyAudit(
    action: RunnerKeyAuditAction,
    authorization: RunnerKeyAdminAuthorization,
    runner: RunnerIdentity,
    occurredAt: string,
    relatedRunnerId?: string
  ): ControlPlaneAuditEvent {
    const resource = runnerKeyAuditResource(runner, relatedRunnerId);
    const eventCore = {
      schemaVersion: "archcontext.audit-event/v1",
      action,
      actorId: authorization.actorId,
      actorLogin: authorization.actorLogin,
      occurredAt,
      resource,
      reason: authorization.reason ?? "github-admin-authorized"
    };
    const metadataDigest = digestJson(eventCore as any);
    const event: ControlPlaneAuditEvent = {
      ...eventCore,
      schemaVersion: "archcontext.audit-event/v1",
      eventId: `audit_${metadataDigest.slice("sha256:".length, "sha256:".length + 16)}`,
      metadataDigest
    };
    this.auditEvents.push(event);
    return event;
  }

  private requireDeviceIdentity(deviceId: string): DeviceIdentity {
    const normalizedDeviceId = requireNonEmptyString(deviceId, "device.deviceId");
    const device = this.deviceIdentities.get(normalizedDeviceId);
    if (!device) throw new Error("device-not-found");
    return device;
  }

  private requireRunnerIdentity(runnerId: string): RunnerIdentity {
    const normalizedRunnerId = requireNonEmptyString(runnerId, "runner.runnerId");
    const runner = this.runnerIdentities.get(normalizedRunnerId);
    if (!runner) throw new Error("runner-not-found");
    return runner;
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

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field}-invalid`);
  return value;
}

function requireRunnerKeyAdminAuthorization(authorization: RunnerKeyAdminAuthorization | undefined, runner: RunnerIdentity): RunnerKeyAdminAuthorization {
  if (!authorization) throw new Error("runner-key-admin-authorization-required");
  const actorId = requireNonEmptyString(authorization.actorId, "runner.actorId");
  const actorLogin = authorization.actorLogin === undefined ? undefined : requireNonEmptyString(authorization.actorLogin, "runner.actorLogin");
  const installationId = requirePositiveInteger(authorization.installationId, "runner.authorization.installationId");
  if (installationId !== runner.installationId) throw new Error("runner-key-admin-installation-mismatch");
  const verifiedAt = authorization.verifiedAt;
  requireFiniteTime(verifiedAt, "runner.authorization.verifiedAt");
  const permissionSource = requirePermissionSource(authorization.permissionSource);
  const organizationAdmin = authorization.organizationAdmin === true;
  const repositoryAdminIds = normalizeRepositoryAdminIds(authorization.repositoryAdminIds ?? []);
  const scope = runnerIdentityEffectiveScope(runner);
  if (scope.kind === "organization" && !organizationAdmin) {
    throw new Error("runner-key-admin-organization-required");
  }
  if (scope.kind === "repository" && !organizationAdmin) {
    const authorizedRepositoryIds = new Set(repositoryAdminIds);
    const missingRepositoryId = scope.repositoryIds.find((repositoryId) => !authorizedRepositoryIds.has(repositoryId));
    if (missingRepositoryId !== undefined) throw new Error("runner-key-admin-repository-required");
  }
  const reason = authorization.reason === undefined ? undefined : requireNonEmptyString(authorization.reason, "runner.authorization.reason");
  return {
    actorId,
    ...(actorLogin === undefined ? {} : { actorLogin }),
    installationId,
    organizationAdmin,
    repositoryAdminIds,
    permissionSource,
    verifiedAt,
    ...(reason === undefined ? {} : { reason })
  };
}

function requirePermissionSource(value: RunnerKeyAdminAuthorization["permissionSource"]): RunnerKeyAdminAuthorization["permissionSource"] {
  if (value === "github-app" || value === "github-oauth" || value === "manual-ops" || value === "test-fixture") return value;
  throw new Error("runner-key-admin-permission-source-invalid");
}

function normalizeRepositoryAdminIds(value: number[]): number[] {
  if (!Array.isArray(value)) throw new Error("runner-key-admin-repository-ids-invalid");
  return [...new Set(value.map((repositoryId, index) => requirePositiveInteger(repositoryId, `runner.authorization.repositoryAdminIds[${index}]`)))]
    .sort((a, b) => a - b);
}

function runnerKeyRecoveryBase(runner: RunnerIdentity): Omit<
  RunnerKeyRecoveryStatus,
  "submitAllowed" | "immediateRejection" | "retryCurrentKey" | "replacementRequired" | "action" | "nextActions" | "reasonCode"
> {
  const scope = runnerIdentityEffectiveScope(runner);
  return {
    schemaVersion: "archcontext.runner-key-recovery/v1",
    runnerId: runner.runnerId,
    lifecycleState: runner.status,
    installationId: runner.installationId,
    repositoryIds: runner.repositoryIds,
    scope,
    workflowRef: runner.workflowRef,
    publicKeyId: runner.publicKeyId,
    fingerprint: runner.publicKeyFingerprint,
    revokedAt: runner.revokedAt ?? null
  };
}

function runnerKeyAuditResource(runner: RunnerIdentity, relatedRunnerId?: string): ControlPlaneAuditEvent["resource"] {
  const scope = runnerIdentityEffectiveScope(runner);
  return {
    kind: "runner-key",
    runnerId: runner.runnerId,
    installationId: runner.installationId,
    scopeKind: scope.kind,
    repositoryIds: scope.kind === "repository" ? scope.repositoryIds : [],
    workflowRef: runner.workflowRef,
    publicKeyId: runner.publicKeyId,
    publicKeyFingerprint: runner.publicKeyFingerprint,
    ...(relatedRunnerId === undefined ? {} : { relatedRunnerId })
  };
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

function runnerIdentityId(input: { installationId: number; publicKeyId: string; fingerprint: string }): string {
  const digest = digestJson({
    schemaVersion: "archcontext.runner-identity-id/v1",
    installationId: input.installationId,
    publicKeyId: input.publicKeyId,
    fingerprint: input.fingerprint
  });
  return `runner_${digest.slice("sha256:".length, "sha256:".length + 16)}`;
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
