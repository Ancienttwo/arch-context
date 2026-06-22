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
  DEFAULT_GOVERNANCE_FEATURE_FLAGS,
  GOVERNANCE_REASON_CATALOG,
  assertGovernanceFeatureFlagsAllow,
  controlPlaneRouteDigest,
  canTransitionCheckDelivery,
  createRunnerIdentity,
  digestJson,
  evaluateGovernanceFeatureFlags as evaluateGovernanceFeatureFlagsContract,
  normalizeGovernanceFeatureFlags,
  requiredTrustForCheckName,
  runnerIdentityEffectiveScope,
  runnerIdentityKeyStatus,
  runnerIdentityMatchesScope,
  transitionRunnerIdentityStatus,
  transitionReviewChallengeStatus,
  checkNameForRequiredTrust,
  type AttestationV2,
  type CheckDelivery,
  type CheckDeliveryStatus,
  type CreateRunnerIdentityInput,
  type DeviceIdentity,
  type GovernanceCheckName,
  type GovernanceFeatureFlagDecision,
  type GovernanceFeatureFlags,
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
import {
  checkDeliveryIdempotencyKey,
  persistAcceptedAttestationSubmission,
  type AcceptedAttestationPersistenceRow,
  type PendingCheckDeliveryPersistenceRow,
  type TransactionalSqlDatabase
} from "@archcontext/cloud/cloud-db";

export { CONTROL_PLANE_ROUTES };

export const WORKER_LIMITS = {
  maxBodyBytes: 64 * 1024,
  cpuMs: 30_000,
  requestTimeoutMs: 15_000,
  rateLimitPerMinute: 120,
  maxClockSkewMs: 5 * 60 * 1000
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

export const CONTROL_PLANE_AUDIT_EVENT_FIELDS = [
  "schemaVersion",
  "eventId",
  "action",
  "actor",
  "occurredAt",
  "resource",
  "reason",
  "metadataDigest"
] as const;

const CONTROL_PLANE_AUDIT_ACTOR_FIELDS = ["id"] as const;
const CONTROL_PLANE_AUDIT_RESOURCE_FIELDS = ["kind", "id", "installationId", "scopeKind", "repositoryIds", "relatedResourceId"] as const;

export const FORBIDDEN_CONTROL_PLANE_AUDIT_FIELDS = [
  "actorLogin",
  "workflowRef",
  "publicKeyId",
  "publicKeyFingerprint",
  "source",
  ["source", "Code"].join(""),
  "diff",
  ["diff", "Body"].join(""),
  "patch",
  "finding",
  "findings",
  "findingBody",
  "findingDetail",
  "reviewDetail",
  "body",
  "files"
] as const;

export interface ControlPlaneAuditEvent {
  schemaVersion: "archcontext.audit-event/v1";
  eventId: string;
  action: RunnerKeyAuditAction;
  actor: {
    id: string;
  };
  occurredAt: string;
  resource: {
    kind: "runner-key";
    id: string;
    installationId: number;
    scopeKind: RunnerIdentityScope["kind"];
    repositoryIds: number[];
    relatedResourceId?: string;
  };
  reason: string;
  metadataDigest: string;
}

export interface ApiIdempotencyRecord {
  schemaVersion: "archcontext.api-idempotency-record/v1";
  routeId: string;
  keyDigest: string;
  requestDigest: string;
  resourceKind: "review-challenge";
  resourceId: string;
  createdAt: string;
}

export interface ApiRateLimitWindow {
  schemaVersion: "archcontext.api-rate-limit-window/v1";
  keyDigest: string;
  routeId: string;
  clientIdDigest: string;
  windowStartedAt: string;
  count: number;
}

export type ControlPlaneMetricName =
  | "challenge_create_latency_ms"
  | "challenge_age_ms"
  | "verify_latency_ms"
  | "check_delivery_lag_ms"
  | "check_delivery_retry_total"
  | "reject_reason_total";

export type ControlPlaneMetricUnit = "milliseconds" | "count";

export interface ControlPlaneMetricSample {
  schemaVersion: "archcontext.control-plane-metric/v1";
  name: ControlPlaneMetricName;
  value: number;
  unit: ControlPlaneMetricUnit;
  recordedAt: string;
  labels: Record<string, string>;
  metadataDigest: string;
}

export type ControlPlaneAlertKind =
  | "webhook-backlog"
  | "verify-failure"
  | "check-dlq"
  | "github-api-failure"
  | "signature-spike"
  | "key-revoke";
export type ControlPlaneAlertSeverity = "warning" | "critical";

export const CONTROL_PLANE_ALERT_RUNBOOK_PATH = "docs/runbooks/control-plane-incidents.md";

export const DEFAULT_CONTROL_PLANE_ALERT_THRESHOLDS = {
  webhookBacklogCount: 100,
  webhookBacklogOldestAgeMs: 5 * 60 * 1000,
  checkDlqCount: 1,
  verifyFailureCount: 1,
  githubApiFailureCount: 1,
  githubApiFailureWindowMs: 5 * 60 * 1000,
  signatureFailureCount: 10,
  signatureFailureWindowMs: 5 * 60 * 1000,
  keyRevocationCount: 1,
  keyRevocationWindowMs: 15 * 60 * 1000
} as const;

export interface ControlPlaneAlertThresholds {
  webhookBacklogCount: number;
  webhookBacklogOldestAgeMs: number;
  checkDlqCount: number;
  verifyFailureCount: number;
  githubApiFailureCount: number;
  githubApiFailureWindowMs: number;
  signatureFailureCount: number;
  signatureFailureWindowMs: number;
  keyRevocationCount: number;
  keyRevocationWindowMs: number;
}

export interface WebhookBacklogAlertInput {
  pendingCount: number;
  oldestReceivedAt?: string;
}

export interface SignatureFailureAlertInput {
  failureCount: number;
  windowStartedAt: string;
}

export interface VerifyFailureAlertInput {
  failureCount: number;
  reasonCode: GovernanceReasonCode;
}

export interface GitHubApiFailureAlertInput {
  failureCount: number;
  statusCode: number;
  retryable: boolean;
  windowStartedAt: string;
}

export interface ControlPlaneAlertEvaluationInput {
  now: string;
  webhookBacklog?: WebhookBacklogAlertInput;
  verifyFailures?: VerifyFailureAlertInput;
  checkDeliveries?: readonly CheckDelivery[];
  githubApiFailures?: GitHubApiFailureAlertInput;
  signatureFailures?: SignatureFailureAlertInput;
  auditEvents?: readonly ControlPlaneAuditEvent[];
  thresholds?: Partial<ControlPlaneAlertThresholds>;
}

export interface ControlPlaneAlert {
  schemaVersion: "archcontext.control-plane-alert/v1";
  alertId: string;
  kind: ControlPlaneAlertKind;
  severity: ControlPlaneAlertSeverity;
  status: "firing";
  firedAt: string;
  summary: string;
  labels: Record<string, string>;
  metrics: Record<string, number>;
  runbook: {
    path: typeof CONTROL_PLANE_ALERT_RUNBOOK_PATH;
    section: ControlPlaneAlertKind;
  };
  metadataDigest: string;
}

export interface ApiRequestLimitValidationResult {
  schemaVersion: "archcontext.api-request-limit-validation/v1";
  accepted: true;
  routeId: string;
  clientIdDigest: string;
  bodyBytes: number;
  observedSkewMs: number;
  rateLimit: {
    limit: number;
    remaining: number;
    windowStartedAt: string;
    resetAt: string;
  };
  metadataDigest: string;
}

export interface ReviewChallengeExpiryLimitResult {
  schemaVersion: "archcontext.review-challenge-expiry-limit/v1";
  accepted: true;
  createdAt: string;
  expiresAt: string;
  ttlMs: number;
  maxTtlMs: number;
}

export const BILLING_PRICES = {
  monthly: { priceUsd: 5, label: "$5/user/month" },
  annual: { priceUsd: 99, label: "$99/user/year" }
} as const;

export const DEFAULT_REVIEW_CHALLENGE_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_REVIEW_CHALLENGE_LEASE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_RUNNER_KEY_ROTATION_OVERLAP_MS = 15 * 60 * 1000;
export const MAX_REVIEW_CHALLENGE_TTL_MS = DEFAULT_REVIEW_CHALLENGE_TTL_MS;

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

export const CHECK_DELIVERY_QUEUE_MESSAGE_SCHEMA_VERSION = "archcontext.check-delivery-queue-message/v1" as const;

export interface CheckDeliveryQueueMessage {
  schemaVersion: typeof CHECK_DELIVERY_QUEUE_MESSAGE_SCHEMA_VERSION;
  kind: "github.check-delivery";
  id: string;
  deliveryId: string;
  challengeId: string;
  checkName: GovernanceCheckName;
  headSha: string;
  status: Extract<CheckDeliveryStatus, "PENDING" | "RETRYING">;
  attempt: number;
  payloadDigest: string;
}

export interface CheckDeliveryQueueSendOptions {
  delaySeconds?: number;
}

export interface CheckDeliveryQueuePort {
  send(message: CheckDeliveryQueueMessage, options?: CheckDeliveryQueueSendOptions): Promise<unknown> | unknown;
}

export interface CheckDeliveryQueueBinding {
  send(message: CheckDeliveryQueueMessage, options?: CheckDeliveryQueueSendOptions): Promise<unknown>;
}

export class CloudflareCheckDeliveryQueuePort implements CheckDeliveryQueuePort {
  constructor(private readonly queue: CheckDeliveryQueueBinding) {}

  send(message: CheckDeliveryQueueMessage, options?: CheckDeliveryQueueSendOptions): Promise<unknown> {
    return this.queue.send(message, options);
  }
}

export interface CheckDeliveryQueueEnqueueResult {
  queued: true;
  deliveryId: string;
  queueMessage: CheckDeliveryQueueMessage;
  messageDigest: string;
  delaySeconds?: number;
}

export const DEFAULT_CHECK_DELIVERY_RETRY_POLICY = {
  maxAttempts: 5,
  baseDelaySeconds: 30,
  maxDelaySeconds: 15 * 60,
  jitterRatio: 0.2
} as const;

const MAX_QUEUE_DELAY_SECONDS = 24 * 60 * 60;

export interface CheckDeliveryRetryPolicy {
  maxAttempts: number;
  baseDelaySeconds: number;
  maxDelaySeconds: number;
  jitterRatio: number;
}

export type CheckDeliveryRetryDecisionReason =
  | "retry-scheduled"
  | "check-delivery-terminal-status"
  | "check-delivery-max-attempts-reached";

export interface CheckDeliveryRetryPlan {
  retry: boolean;
  reason: CheckDeliveryRetryDecisionReason;
  checkDelivery: CheckDelivery;
  attemptCount: number;
  maxAttempts: number;
  delaySeconds?: number;
  nextAttemptAt?: string | null;
  retryAfterDelaySeconds?: number;
}

export type CheckDeliveryReplaySource = "manual-ops" | "github-check-rerequest" | "test-fixture";

export interface CheckDeliveryReplayAuthorization {
  actorId: string;
  permissionSource: CheckDeliveryReplaySource;
  verifiedAt: string;
  reason: string;
}

export interface CheckDeliveryReplayResult {
  replayed: true;
  source: CheckDeliveryReplaySource;
  checkDelivery: CheckDelivery;
  replayDigest: string;
}

export type CheckDeliveryPublicationDecisionReason =
  | "published"
  | "check-delivery-terminal-status"
  | "check-delivery-challenge-mismatch"
  | "check-delivery-head-mismatch"
  | "check-delivery-name-mismatch"
  | "challenge-not-submitted"
  | "challenge-superseded"
  | "challenge-not-current";

export interface CheckDeliveryPublicationResult {
  schemaVersion: "archcontext.check-delivery-publication/v1";
  published: boolean;
  reason: CheckDeliveryPublicationDecisionReason;
  checkDelivery: CheckDelivery;
  challenge: ReviewChallengeV2;
  currentHeadVerification?: ReviewChallengePullHeadVerification;
  checkRunId?: string;
  reasonCode?: GovernanceReasonCode;
}

export const CHALLENGE_API_REQUEST_SCHEMA_VERSIONS = {
  create: "archcontext.challenge-create-request/v1",
  get: "archcontext.challenge-get-request/v1",
  list: "archcontext.challenge-list-request/v1",
  lease: "archcontext.challenge-lease-request/v1",
  submit: "archcontext.challenge-submit-request/v1",
  cancel: "archcontext.challenge-cancel-request/v1"
} as const;

export type ChallengeApiRequestSchemaVersion = typeof CHALLENGE_API_REQUEST_SCHEMA_VERSIONS[keyof typeof CHALLENGE_API_REQUEST_SCHEMA_VERSIONS];

export type CreateReviewChallengeApiRequest = IssueReviewChallengeInput & {
  schemaVersion: typeof CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.create;
  idempotencyKey: string;
};

export interface GetReviewChallengeApiRequest {
  schemaVersion: typeof CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.get;
  challengeId: string;
}

export interface ListReviewChallengesApiRequest {
  schemaVersion: typeof CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.list;
  repositoryId?: number;
  pullRequestNumber?: number;
  headSha?: string;
  requiredTrust?: ReviewChallengeV2["requiredTrust"];
}

export interface ClaimReviewChallengeApiRequest {
  schemaVersion: typeof CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.lease;
  challengeId: string;
  claimantId: string;
  now: string;
  ttlMs?: number;
}

export interface SubmitReviewChallengeApiRequest {
  schemaVersion: typeof CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.submit;
  challengeId: string;
  attestation: unknown;
  currentPullHead: PullHeadMetadata;
  publicKey: KeyObject;
  resourceAuthorization: ReviewChallengeResourceBindingAuthorization;
  deviceIdentity?: DeviceIdentity;
  runnerIdentity?: RunnerIdentity;
  signingKeyStatus?: GovernanceKeyStatus;
  now: string;
  verifyStartedAt?: string;
  expectedHeadTreeOid?: string;
}

export interface CancelReviewChallengeApiRequest {
  schemaVersion: typeof CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.cancel;
  challengeId: string;
  reason: string;
  now: string;
}

export const KEY_API_REQUEST_SCHEMA_VERSIONS = {
  deviceRegister: "archcontext.device-key-register-request/v1",
  deviceRevoke: "archcontext.device-key-revoke-request/v1",
  runnerRegister: "archcontext.runner-key-register-request/v1",
  runnerRotate: "archcontext.runner-key-rotate-request/v1",
  runnerRevoke: "archcontext.runner-key-revoke-request/v1"
} as const;

export type KeyApiRequestSchemaVersion = typeof KEY_API_REQUEST_SCHEMA_VERSIONS[keyof typeof KEY_API_REQUEST_SCHEMA_VERSIONS];

export interface DeviceKeyOwnerAuthorization {
  actorId: string;
  actorLogin?: string;
  accountId: string;
  permissionSource: "github-oauth" | "device-flow" | "manual-ops" | "test-fixture";
  verifiedAt: string;
  reason?: string;
}

export type ReviewChallengeResourceBindingPermissionSource =
  | "github-app"
  | "github-oauth"
  | "device-flow"
  | "manual-ops"
  | "test-fixture";

export type ReviewChallengeResourceBindingSubject = "device" | "runner";

export interface ReviewChallengeResourceBindingAuthorization {
  actorId: string;
  actorLogin?: string;
  installationId: number;
  repositoryId: number;
  pullRequestNumber: number;
  accountId?: string;
  deviceId?: string;
  runnerId?: string;
  workflowRef?: string;
  permissionSource: ReviewChallengeResourceBindingPermissionSource;
  verifiedAt: string;
  reason?: string;
}

export interface ReviewChallengeResourceBindingAuthorizationResult {
  schemaVersion: "archcontext.review-challenge-resource-binding/v1";
  authorized: true;
  subject: ReviewChallengeResourceBindingSubject;
  actorId: string;
  actorLogin?: string;
  challengeId: string;
  installationId: number;
  repositoryId: number;
  pullRequestNumber: number;
  accountId?: string;
  deviceId?: string;
  runnerId?: string;
  workflowRef?: string;
  permissionSource: ReviewChallengeResourceBindingPermissionSource;
  verifiedAt: string;
  metadataDigest: string;
}

export type RegisterDeviceKeyApiRequest = RegisterDeviceKeyInput & {
  schemaVersion: typeof KEY_API_REQUEST_SCHEMA_VERSIONS.deviceRegister;
  authorization: DeviceKeyOwnerAuthorization;
};

export interface RevokeDeviceKeyApiRequest {
  schemaVersion: typeof KEY_API_REQUEST_SCHEMA_VERSIONS.deviceRevoke;
  deviceId: string;
  revokedAt: string;
  authorization: DeviceKeyOwnerAuthorization;
}

export type RegisterRunnerKeyApiRequest = RegisterRunnerKeyInput & {
  schemaVersion: typeof KEY_API_REQUEST_SCHEMA_VERSIONS.runnerRegister;
};

export type RotateRunnerKeyApiRequest = RotateRunnerKeyInput & {
  schemaVersion: typeof KEY_API_REQUEST_SCHEMA_VERSIONS.runnerRotate;
};

export type RevokeRunnerKeyApiRequest = RevokeRunnerKeyInput & {
  schemaVersion: typeof KEY_API_REQUEST_SCHEMA_VERSIONS.runnerRevoke;
};

export type ReviewChallengePullHeadMismatchReason = NonNullable<ReviewChallengePullHeadVerification["reasonCode"]>;

export function reviewChallengeNonceHash(challenge: Pick<ReviewChallengeV2, "nonce">): string {
  return digestJson({
    schemaVersion: "archcontext.review-challenge-nonce/v1",
    nonce: challenge.nonce
  });
}

export function apiIdempotencyKeyDigest(routeId: string, idempotencyKey: string): string {
  return digestJson({
    schemaVersion: "archcontext.api-idempotency-key/v1",
    routeId: requireNonEmptyString(routeId, "api.routeId"),
    idempotencyKey: requireNonEmptyString(idempotencyKey, "api.idempotencyKey")
  });
}

export function reviewChallengeCreateRequestDigest(request: CreateReviewChallengeApiRequest): string {
  return digestJson({
    schemaVersion: "archcontext.challenge-create-request-digest/v1",
    installationId: request.installationId,
    repositoryId: request.repositoryId,
    pullRequestNumber: request.pullRequestNumber,
    headSha: request.headSha,
    baseSha: request.baseSha,
    requiredTrust: request.requiredTrust,
    policyProfileId: request.policyProfileId,
    challengeId: request.challengeId ?? null,
    nonce: request.nonce ?? null,
    createdAt: request.createdAt ?? null,
    expiresAt: request.expiresAt ?? null,
    ttlMs: request.ttlMs ?? null
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
  queue: new Set(["schemaVersion", "kind", "id", "accountId", "eventId", "deliveryId", "challengeId", "checkRunId", "checkName", "headSha", "status", "attempt", "attemptCount", "nextAttemptAt", "lastErrorCode", "payloadDigest"]),
  error: new Set(["errorCode", "reasonCode", "code", "status", "statusCode", "retryable", "requestId", "routeId"])
};

const CONTROL_PLANE_METRIC_LABEL_FIELDS = new Set([
  "action",
  "attempt",
  "challengeId",
  "checkName",
  "deliveryId",
  "reason",
  "reasonCode",
  "requiredTrust",
  "retry",
  "retryable",
  "status"
]);

const CONTROL_PLANE_ALERT_LABEL_FIELDS = new Set([
  "action",
  "checkName",
  "kind",
  "reasonCode",
  "retryable",
  "status",
  "surface"
]);

export class ControlPlane {
  readonly accounts = new Map<string, Account>();
  readonly webhookDeliveries = new Set<string>();
  readonly revokedDevices = new Set<string>();
  readonly reviewChallenges = new Map<string, ReviewChallengeV2>();
  readonly reviewChallengeLeases = new Map<string, ReviewChallengeLease>();
  readonly consumedReviewChallengeNonceHashes = new Set<string>();
  readonly apiIdempotencyRecords = new Map<string, ApiIdempotencyRecord>();
  readonly apiRateLimitWindows = new Map<string, ApiRateLimitWindow>();
  readonly deviceIdentities = new Map<string, DeviceIdentity>();
  readonly runnerIdentities = new Map<string, RunnerIdentity>();
  readonly runnerKeyRotationWindows = new Map<string, RunnerKeyRotationWindow>();
  readonly runnerKeyTerminationKinds = new Map<string, RunnerKeyTerminationKind>();
  readonly auditEvents: ControlPlaneAuditEvent[] = [];
  readonly metricSamples: ControlPlaneMetricSample[] = [];
  readonly orgRunners = new Map<string, OrgRunnerIdentity>();
  readonly notificationProviders = new Map<string, NotificationProviderConfig>();
  readonly notificationProviderScopes = new Map<string, { accountId?: string; installationId?: number }>();
  readonly notificationQueue: ReturnType<typeof serializeNotificationEvent>[] = [];
  readonly releaseRollbacks: string[] = [];
  private governanceFeatureFlags: GovernanceFeatureFlags = DEFAULT_GOVERNANCE_FEATURE_FLAGS;

  getGovernanceFeatureFlags(): GovernanceFeatureFlags {
    return { ...this.governanceFeatureFlags };
  }

  setGovernanceFeatureFlags(flags: Partial<GovernanceFeatureFlags>): GovernanceFeatureFlags {
    this.governanceFeatureFlags = normalizeGovernanceFeatureFlags(flags);
    return this.getGovernanceFeatureFlags();
  }

  evaluateGovernanceFeatureFlags(input: { requiredTrust: ReviewChallengeV2["requiredTrust"] }): GovernanceFeatureFlagDecision {
    return evaluateGovernanceFeatureFlagsContract({
      requiredTrust: input.requiredTrust,
      flags: this.governanceFeatureFlags
    });
  }

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

  validateApiRequestLimits(input: {
    routeId: string;
    clientId: string;
    bodyBytes: number;
    now: string;
    receivedAt?: string;
    maxBodyBytes?: number;
    rateLimitPerMinute?: number;
    maxClockSkewMs?: number;
  }): ApiRequestLimitValidationResult {
    const routeId = requireNonEmptyString(input.routeId, "api.routeId");
    const clientId = requireNonEmptyString(input.clientId, "api.clientId");
    if (!Number.isInteger(input.bodyBytes) || input.bodyBytes < 0) throw new Error("api-body-size-invalid");
    const maxBodyBytes = input.maxBodyBytes ?? WORKER_LIMITS.maxBodyBytes;
    if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1) throw new Error("api-max-body-size-invalid");
    if (input.bodyBytes > maxBodyBytes) throw new Error("api-body-too-large");
    const nowMs = requireFiniteTime(input.now, "api.now");
    const receivedAtMs = input.receivedAt === undefined ? nowMs : requireFiniteTime(input.receivedAt, "api.receivedAt");
    const observedSkewMs = Math.abs(nowMs - receivedAtMs);
    const maxClockSkewMs = input.maxClockSkewMs ?? WORKER_LIMITS.maxClockSkewMs;
    if (!Number.isFinite(maxClockSkewMs) || maxClockSkewMs < 0) throw new Error("api-max-clock-skew-invalid");
    if (observedSkewMs > maxClockSkewMs) throw new Error("api-clock-skew-too-large");

    const rateLimit = input.rateLimitPerMinute ?? WORKER_LIMITS.rateLimitPerMinute;
    if (!Number.isInteger(rateLimit) || rateLimit < 1) throw new Error("api-rate-limit-invalid");
    const windowMs = 60 * 1000;
    const clientIdDigest = digestJson({ schemaVersion: "archcontext.api-client/v1", clientId });
    const keyDigest = digestJson({ schemaVersion: "archcontext.api-rate-limit-key/v1", routeId, clientIdDigest });
    const existing = this.apiRateLimitWindows.get(keyDigest);
    const windowStartedAtMs = existing && nowMs - Date.parse(existing.windowStartedAt) < windowMs
      ? Date.parse(existing.windowStartedAt)
      : Math.floor(nowMs / windowMs) * windowMs;
    const existingCount = existing && Date.parse(existing.windowStartedAt) === windowStartedAtMs ? existing.count : 0;
    if (existingCount >= rateLimit) throw new Error("api-rate-limit-exceeded");
    const count = existingCount + 1;
    const windowStartedAt = new Date(windowStartedAtMs).toISOString();
    const resetAt = new Date(windowStartedAtMs + windowMs).toISOString();
    this.apiRateLimitWindows.set(keyDigest, {
      schemaVersion: "archcontext.api-rate-limit-window/v1",
      keyDigest,
      routeId,
      clientIdDigest,
      windowStartedAt,
      count
    });
    const result = {
      schemaVersion: "archcontext.api-request-limit-validation/v1" as const,
      accepted: true as const,
      routeId,
      clientIdDigest,
      bodyBytes: input.bodyBytes,
      observedSkewMs,
      rateLimit: {
        limit: rateLimit,
        remaining: rateLimit - count,
        windowStartedAt,
        resetAt
      }
    };
    return {
      ...result,
      metadataDigest: digestJson(result)
    };
  }

  validateReviewChallengeExpiryLimits(input: { createdAt: string; expiresAt: string; maxTtlMs?: number }): ReviewChallengeExpiryLimitResult {
    const createdAtMs = requireFiniteTime(input.createdAt, "challenge.createdAt");
    const expiresAtMs = requireFiniteTime(input.expiresAt, "challenge.expiresAt");
    if (expiresAtMs <= createdAtMs) throw new Error("review-challenge-expiry-invalid");
    const ttlMs = expiresAtMs - createdAtMs;
    const maxTtlMs = input.maxTtlMs ?? MAX_REVIEW_CHALLENGE_TTL_MS;
    if (!Number.isFinite(maxTtlMs) || maxTtlMs < 1) throw new Error("review-challenge-max-ttl-invalid");
    if (ttlMs > maxTtlMs) throw new Error("review-challenge-expiry-too-long");
    return {
      schemaVersion: "archcontext.review-challenge-expiry-limit/v1",
      accepted: true,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      ttlMs,
      maxTtlMs
    };
  }

  registerDeviceKeyApi(request: RegisterDeviceKeyApiRequest): DeviceIdentity {
    assertKeyApiRequestSchema(request, KEY_API_REQUEST_SCHEMA_VERSIONS.deviceRegister);
    requireDeviceKeyOwnerAuthorization(request.authorization, request.accountId);
    const { schemaVersion: _schemaVersion, authorization: _authorization, ...input } = request;
    return this.registerDeviceKey(input);
  }

  revokeDeviceKeyApi(request: RevokeDeviceKeyApiRequest): DeviceIdentity {
    assertKeyApiRequestSchema(request, KEY_API_REQUEST_SCHEMA_VERSIONS.deviceRevoke);
    const current = this.requireDeviceIdentity(request.deviceId);
    requireDeviceKeyOwnerAuthorization(request.authorization, current.accountId);
    return this.revokeDeviceKey(current.deviceId, request.revokedAt);
  }

  registerRunnerKeyApi(request: RegisterRunnerKeyApiRequest): RunnerIdentity {
    assertKeyApiRequestSchema(request, KEY_API_REQUEST_SCHEMA_VERSIONS.runnerRegister);
    const { schemaVersion: _schemaVersion, ...input } = request;
    return this.registerRunnerKey(input);
  }

  rotateRunnerKeyApi(request: RotateRunnerKeyApiRequest): { previous: RunnerIdentity; next: RunnerIdentity; rotationWindow: RunnerKeyRotationWindow } {
    assertKeyApiRequestSchema(request, KEY_API_REQUEST_SCHEMA_VERSIONS.runnerRotate);
    const { schemaVersion: _schemaVersion, ...input } = request;
    return this.rotateRunnerKey(input);
  }

  revokeRunnerKeyApi(request: RevokeRunnerKeyApiRequest): RunnerIdentity {
    assertKeyApiRequestSchema(request, KEY_API_REQUEST_SCHEMA_VERSIONS.runnerRevoke);
    const { schemaVersion: _schemaVersion, ...input } = request;
    return this.revokeRunnerKey(input);
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
      if (filter.actorId && event.actor.id !== filter.actorId) return false;
      if (filter.runnerId && event.resource.id !== filter.runnerId && event.resource.relatedResourceId !== filter.runnerId) return false;
      return true;
    });
  }

  listMetricSamples(filter: { name?: ControlPlaneMetricName; reasonCode?: GovernanceReasonCode; deliveryId?: string; challengeId?: string } = {}): ControlPlaneMetricSample[] {
    return this.metricSamples.filter((sample) => {
      if (filter.name && sample.name !== filter.name) return false;
      if (filter.reasonCode && sample.labels.reasonCode !== filter.reasonCode) return false;
      if (filter.deliveryId && sample.labels.deliveryId !== filter.deliveryId) return false;
      if (filter.challengeId && sample.labels.challengeId !== filter.challengeId) return false;
      return true;
    });
  }

  evaluateControlPlaneAlerts(input: ControlPlaneAlertEvaluationInput): ControlPlaneAlert[] {
    const nowMs = requireFiniteTime(input.now, "alerts.now");
    const firedAt = new Date(nowMs).toISOString();
    const thresholds = normalizeControlPlaneAlertThresholds(input.thresholds);
    const alerts: ControlPlaneAlert[] = [];

    if (input.webhookBacklog) {
      const pendingCount = requireNonNegativeInteger(input.webhookBacklog.pendingCount, "alerts.webhookBacklog.pendingCount");
      const oldestAgeMs = input.webhookBacklog.oldestReceivedAt === undefined
        ? 0
        : Math.max(0, nowMs - requireFiniteTime(input.webhookBacklog.oldestReceivedAt, "alerts.webhookBacklog.oldestReceivedAt"));
      if (pendingCount >= thresholds.webhookBacklogCount || oldestAgeMs >= thresholds.webhookBacklogOldestAgeMs) {
        alerts.push(createControlPlaneAlert({
          kind: "webhook-backlog",
          severity: oldestAgeMs >= thresholds.webhookBacklogOldestAgeMs * 2 ? "critical" : "warning",
          firedAt,
          summary: "Webhook backlog exceeds control-plane processing threshold",
          labels: { surface: "webhook", status: "backlog" },
          metrics: { pendingCount, oldestAgeMs, thresholdCount: thresholds.webhookBacklogCount, thresholdAgeMs: thresholds.webhookBacklogOldestAgeMs }
        }));
      }
    }

    if (input.verifyFailures) {
      const failureCount = requireNonNegativeInteger(input.verifyFailures.failureCount, "alerts.verifyFailures.failureCount");
      if (!isGovernanceReasonCode(input.verifyFailures.reasonCode)) throw new Error("alerts.verifyFailures.reasonCode-invalid");
      if (failureCount >= thresholds.verifyFailureCount) {
        alerts.push(createControlPlaneAlert({
          kind: "verify-failure",
          severity: failureCount > thresholds.verifyFailureCount ? "critical" : "warning",
          firedAt,
          summary: "Attestation verification failures require policy or identity triage",
          labels: {
            surface: "verify",
            status: "failed",
            reasonCode: input.verifyFailures.reasonCode
          },
          metrics: { failureCount, thresholdCount: thresholds.verifyFailureCount }
        }));
      }
    }

    const deadLetters = [...(input.checkDeliveries ?? [])].filter((delivery) => delivery.status === "DEAD_LETTER");
    if (deadLetters.length >= thresholds.checkDlqCount) {
      const oldestLagMs = Math.max(
        0,
        ...deadLetters.map((delivery) => nowMs - requireFiniteTime(delivery.updatedAt, "alerts.checkDelivery.updatedAt"))
      );
      const primaryReasonCode = deadLetters.find((delivery): delivery is CheckDelivery & { lastErrorCode: GovernanceReasonCode } => {
        return typeof delivery.lastErrorCode === "string" && isGovernanceReasonCode(delivery.lastErrorCode);
      })?.lastErrorCode;
      alerts.push(createControlPlaneAlert({
        kind: "check-dlq",
        severity: deadLetters.length > thresholds.checkDlqCount ? "critical" : "warning",
        firedAt,
        summary: "Check delivery dead-letter queue requires replay or operator review",
        labels: {
          surface: "queue",
          status: "DEAD_LETTER",
          checkName: deadLetters[0]?.checkName,
          ...(primaryReasonCode === undefined ? {} : { reasonCode: primaryReasonCode })
        },
        metrics: { deadLetterCount: deadLetters.length, oldestLagMs, thresholdCount: thresholds.checkDlqCount }
      }));
    }

    if (input.githubApiFailures) {
      const failureCount = requireNonNegativeInteger(input.githubApiFailures.failureCount, "alerts.githubApiFailures.failureCount");
      const statusCode = requireNonNegativeInteger(input.githubApiFailures.statusCode, "alerts.githubApiFailures.statusCode");
      const windowStartedAtMs = requireFiniteTime(input.githubApiFailures.windowStartedAt, "alerts.githubApiFailures.windowStartedAt");
      const windowAgeMs = Math.max(0, nowMs - windowStartedAtMs);
      if (failureCount >= thresholds.githubApiFailureCount && windowAgeMs <= thresholds.githubApiFailureWindowMs) {
        alerts.push(createControlPlaneAlert({
          kind: "github-api-failure",
          severity: failureCount > thresholds.githubApiFailureCount ? "critical" : "warning",
          firedAt,
          summary: "GitHub Check API failures exceed control-plane retry threshold",
          labels: {
            surface: "github-api",
            status: "failed",
            retryable: input.githubApiFailures.retryable
          },
          metrics: {
            failureCount,
            statusCode,
            retryable: input.githubApiFailures.retryable ? 1 : 0,
            windowAgeMs,
            thresholdCount: thresholds.githubApiFailureCount,
            thresholdWindowMs: thresholds.githubApiFailureWindowMs
          }
        }));
      }
    }

    if (input.signatureFailures) {
      const failureCount = requireNonNegativeInteger(input.signatureFailures.failureCount, "alerts.signatureFailures.failureCount");
      const windowStartedAtMs = requireFiniteTime(input.signatureFailures.windowStartedAt, "alerts.signatureFailures.windowStartedAt");
      const windowAgeMs = Math.max(0, nowMs - windowStartedAtMs);
      if (failureCount >= thresholds.signatureFailureCount && windowAgeMs <= thresholds.signatureFailureWindowMs) {
        alerts.push(createControlPlaneAlert({
          kind: "signature-spike",
          severity: failureCount >= thresholds.signatureFailureCount * 2 ? "critical" : "warning",
          firedAt,
          summary: "Webhook signature failures exceed spike threshold",
          labels: { surface: "webhook", status: "signature-failed" },
          metrics: { failureCount, windowAgeMs, thresholdCount: thresholds.signatureFailureCount, thresholdWindowMs: thresholds.signatureFailureWindowMs }
        }));
      }
    }

    const auditEvents = input.auditEvents ?? this.auditEvents;
    const keyRevocations = auditEvents.filter((event) => {
      if (event.action !== "runner_key.revoke" && event.action !== "runner_key.unregister") return false;
      const occurredAtMs = requireFiniteTime(event.occurredAt, "alerts.keyRevoke.occurredAt");
      return nowMs >= occurredAtMs && nowMs - occurredAtMs <= thresholds.keyRevocationWindowMs;
    });
    if (keyRevocations.length >= thresholds.keyRevocationCount) {
      alerts.push(createControlPlaneAlert({
        kind: "key-revoke",
        severity: keyRevocations.length > thresholds.keyRevocationCount ? "critical" : "warning",
        firedAt,
        summary: "Runner key revocation requires customer recovery confirmation",
        labels: { surface: "runner-key", action: "runner_key.revoke", status: "revoked" },
        metrics: { revocationCount: keyRevocations.length, thresholdCount: thresholds.keyRevocationCount, thresholdWindowMs: thresholds.keyRevocationWindowMs }
      }));
    }

    return alerts;
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

  createReviewChallengeApi(request: CreateReviewChallengeApiRequest): ReviewChallengeV2 {
    const startedAtMs = performance.now();
    assertChallengeApiRequestSchema(request, CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.create);
    requireNonEmptyString(request.idempotencyKey, "challenge.idempotencyKey");
    const keyDigest = apiIdempotencyKeyDigest("POST /v1/challenges", request.idempotencyKey);
    const requestDigest = reviewChallengeCreateRequestDigest(request);
    const existingRecord = this.apiIdempotencyRecords.get(keyDigest);
    if (existingRecord) {
      if (existingRecord.requestDigest !== requestDigest || existingRecord.resourceKind !== "review-challenge") {
        throw new Error("api-idempotency-key-conflict");
      }
      const existingChallenge = this.reviewChallenges.get(existingRecord.resourceId);
      if (!existingChallenge) throw new Error("api-idempotency-resource-missing");
      return existingChallenge;
    }
    this.assertGovernanceFeatureEnabled(request.requiredTrust);
    for (const existing of this.reviewChallenges.values()) {
      const sameIdentity = existing.installationId === request.installationId
        && existing.repositoryId === request.repositoryId
        && existing.pullRequestNumber === request.pullRequestNumber
        && existing.headSha === request.headSha
        && existing.requiredTrust === request.requiredTrust
        && ACTIVE_REVIEW_CHALLENGE_STATUSES.has(existing.status);
      if (sameIdentity) throw new Error("review-challenge-active-identity-conflict");
    }
    const { schemaVersion: _schemaVersion, idempotencyKey: _idempotencyKey, ...issueInput } = request;
    const challenge = this.issueReviewChallenge(issueInput);
    this.reviewChallenges.set(challenge.challengeId, challenge);
    this.apiIdempotencyRecords.set(keyDigest, {
      schemaVersion: "archcontext.api-idempotency-record/v1",
      routeId: "POST /v1/challenges",
      keyDigest,
      requestDigest,
      resourceKind: "review-challenge",
      resourceId: challenge.challengeId,
      createdAt: challenge.createdAt
    });
    this.recordChallengeCreateLatencyMetric(challenge, Math.max(0, performance.now() - startedAtMs));
    return challenge;
  }

  getReviewChallengeApi(request: GetReviewChallengeApiRequest): ReviewChallengeV2 {
    assertChallengeApiRequestSchema(request, CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.get);
    const challenge = this.reviewChallenges.get(requireNonEmptyString(request.challengeId, "challenge.challengeId"));
    if (!challenge) throw new Error("review-challenge-not-found");
    return challenge;
  }

  listReviewChallengesApi(request: ListReviewChallengesApiRequest): ReviewChallengeV2[] {
    assertChallengeApiRequestSchema(request, CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.list);
    return [...this.reviewChallenges.values()]
      .filter((challenge) => request.repositoryId === undefined || challenge.repositoryId === request.repositoryId)
      .filter((challenge) => request.pullRequestNumber === undefined || challenge.pullRequestNumber === request.pullRequestNumber)
      .filter((challenge) => request.headSha === undefined || challenge.headSha === request.headSha)
      .filter((challenge) => request.requiredTrust === undefined || challenge.requiredTrust === request.requiredTrust)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.challengeId.localeCompare(b.challengeId));
  }

  claimReviewChallengeApi(request: ClaimReviewChallengeApiRequest): ClaimReviewChallengeLeaseResult {
    assertChallengeApiRequestSchema(request, CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.lease);
    const challenge = this.getReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.get,
      challengeId: request.challengeId
    });
    const result = this.claimReviewChallengeLease({
      challenge,
      claimantId: request.claimantId,
      now: request.now,
      ttlMs: request.ttlMs,
      currentLease: this.reviewChallengeLeases.get(challenge.challengeId)
    });
    this.reviewChallenges.set(challenge.challengeId, result.challenge);
    if (result.claimed && result.lease) this.reviewChallengeLeases.set(challenge.challengeId, result.lease);
    return result;
  }

  authorizeReviewChallengeResourceBinding(input: {
    challenge: ReviewChallengeV2;
    authorization: ReviewChallengeResourceBindingAuthorization;
    deviceIdentity?: DeviceIdentity;
    runnerIdentity?: RunnerIdentity;
  }): ReviewChallengeResourceBindingAuthorizationResult {
    const authorization = requireReviewChallengeResourceBindingAuthorization(input.authorization);
    if (authorization.installationId !== input.challenge.installationId) throw new Error("review-challenge-installation-binding-mismatch");
    if (authorization.repositoryId !== input.challenge.repositoryId) throw new Error("review-challenge-repository-binding-mismatch");
    if (authorization.pullRequestNumber !== input.challenge.pullRequestNumber) throw new Error("review-challenge-pull-request-binding-mismatch");

    if (input.challenge.requiredTrust === "organization") {
      const runner = input.runnerIdentity;
      if (!runner || !authorization.runnerId) throw new Error("review-challenge-runner-binding-required");
      if (authorization.runnerId !== runner.runnerId) throw new Error("review-challenge-runner-binding-mismatch");
      if (runner.status === "revoked") throw new Error("review-challenge-runner-revoked");
      if (authorization.workflowRef !== undefined && authorization.workflowRef !== runner.workflowRef) {
        throw new Error("review-challenge-runner-workflow-mismatch");
      }
      if (!runnerIdentityMatchesScope(runner, {
        installationId: input.challenge.installationId,
        repositoryId: input.challenge.repositoryId,
        workflowRef: authorization.workflowRef
      })) {
        throw new Error("review-challenge-runner-scope-mismatch");
      }
      return reviewChallengeResourceBindingResult({
        authorization,
        challenge: input.challenge,
        subject: "runner",
        runnerId: runner.runnerId,
        workflowRef: runner.workflowRef
      });
    }

    const device = input.deviceIdentity;
    if (!device || !authorization.deviceId) throw new Error("review-challenge-device-binding-required");
    if (authorization.deviceId !== device.deviceId) throw new Error("review-challenge-device-binding-mismatch");
    if (device.status === "revoked") throw new Error("review-challenge-device-revoked");
    if (authorization.accountId !== undefined && authorization.accountId !== device.accountId) {
      throw new Error("review-challenge-device-account-mismatch");
    }
    return reviewChallengeResourceBindingResult({
      authorization,
      challenge: input.challenge,
      subject: "device",
      accountId: device.accountId,
      deviceId: device.deviceId
    });
  }

  submitReviewChallengeApi(request: SubmitReviewChallengeApiRequest): SubmitReviewChallengeAttestationResult {
    assertChallengeApiRequestSchema(request, CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.submit);
    const challenge = this.getReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.get,
      challengeId: request.challengeId
    });
    this.authorizeReviewChallengeResourceBinding({
      challenge,
      authorization: request.resourceAuthorization,
      deviceIdentity: request.deviceIdentity,
      runnerIdentity: request.runnerIdentity
    });
    const result = this.submitReviewChallengeAttestation({
      challenge,
      attestation: request.attestation,
      currentPullHead: request.currentPullHead,
      publicKey: request.publicKey,
      runnerIdentity: request.runnerIdentity,
      signingKeyStatus: request.signingKeyStatus,
      now: request.now,
      consumedNonceHashes: this.consumedReviewChallengeNonceHashes,
      expectedHeadTreeOid: request.expectedHeadTreeOid
    });
    this.reviewChallenges.set(challenge.challengeId, result.challenge);
    if (result.accepted) {
      this.consumedReviewChallengeNonceHashes.add(result.nonceHash);
      this.reviewChallengeLeases.delete(challenge.challengeId);
    }
    this.recordReviewChallengeSubmitMetrics({
      challenge,
      result,
      recordedAt: request.now,
      verifyStartedAt: request.verifyStartedAt ?? request.now
    });
    return result;
  }

  persistAcceptedReviewChallengeSubmission(input: {
    db: TransactionalSqlDatabase;
    challenge: ReviewChallengeV2;
    attestation: AttestationV2;
    submission: SubmitReviewChallengeAttestationResult;
    acceptedAt: string;
  }): CheckDelivery {
    if (!input.submission.accepted || !input.submission.attestationDigest) throw new Error("review-challenge-submit-not-accepted");
    if (input.attestation.challengeId !== input.challenge.challengeId) throw new Error("attestation-challenge-mismatch");
    requireFiniteTime(input.acceptedAt, "attestation.acceptedAt");
    const checkDelivery = acceptedCheckDeliveryForChallenge({
      challenge: input.challenge,
      payloadDigest: input.submission.attestationDigest,
      createdAt: input.acceptedAt
    });
    persistAcceptedAttestationSubmission(input.db, {
      challengeId: input.challenge.challengeId,
      nonceHash: input.submission.nonceHash,
      acceptedAt: input.acceptedAt,
      attestation: acceptedAttestationPersistenceRow(input.attestation, input.submission.attestationDigest, input.acceptedAt),
      checkDelivery: pendingCheckDeliveryPersistenceRow(checkDelivery)
    });
    return checkDelivery;
  }

  buildCheckDeliveryQueueMessage(input: { checkDelivery: CheckDelivery; payloadDigest: string }): CheckDeliveryQueueMessage {
    if (input.checkDelivery.status !== "PENDING" && input.checkDelivery.status !== "RETRYING") {
      throw new Error("check-delivery-not-queueable");
    }
    this.assertGovernanceFeatureEnabled(requiredTrustForCheckName(input.checkDelivery.checkName));
    const payloadDigest = requireDigest(input.payloadDigest, "checkDelivery.payloadDigest");
    const message = {
      schemaVersion: CHECK_DELIVERY_QUEUE_MESSAGE_SCHEMA_VERSION,
      kind: "github.check-delivery" as const,
      id: input.checkDelivery.deliveryId,
      deliveryId: input.checkDelivery.deliveryId,
      challengeId: input.checkDelivery.challengeId,
      checkName: input.checkDelivery.checkName,
      headSha: input.checkDelivery.headSha,
      status: input.checkDelivery.status,
      attempt: input.checkDelivery.attemptCount,
      payloadDigest
    };
    return projectCloudPrivacySurface("queue", message) as unknown as CheckDeliveryQueueMessage;
  }

  async enqueueCheckDelivery(input: { queue: CheckDeliveryQueuePort; checkDelivery: CheckDelivery; payloadDigest: string; delaySeconds?: number }): Promise<CheckDeliveryQueueEnqueueResult> {
    const queueMessage = this.buildCheckDeliveryQueueMessage({
      checkDelivery: input.checkDelivery,
      payloadDigest: input.payloadDigest
    });
    const delaySeconds = input.delaySeconds === undefined ? undefined : requireQueueDelaySeconds(input.delaySeconds, "checkDelivery.delaySeconds");
    await input.queue.send(queueMessage, delaySeconds === undefined ? undefined : { delaySeconds });
    return {
      queued: true,
      deliveryId: input.checkDelivery.deliveryId,
      queueMessage,
      messageDigest: digestJson(queueMessage as any),
      ...(delaySeconds === undefined ? {} : { delaySeconds })
    };
  }

  planCheckDeliveryRetry(input: {
    checkDelivery: CheckDelivery;
    now: string;
    errorCode: string;
    retryAfter?: string | number;
    policy?: Partial<CheckDeliveryRetryPolicy>;
  }): CheckDeliveryRetryPlan {
    const nowMs = requireFiniteTime(input.now, "checkDelivery.retry.now");
    const policy = normalizeCheckDeliveryRetryPolicy(input.policy);
    const attemptCount = input.checkDelivery.attemptCount + 1;
    if (input.checkDelivery.status !== "PENDING" && input.checkDelivery.status !== "RETRYING") {
      return {
        retry: false,
        reason: "check-delivery-terminal-status",
        checkDelivery: input.checkDelivery,
        attemptCount,
        maxAttempts: policy.maxAttempts,
        nextAttemptAt: input.checkDelivery.nextAttemptAt ?? null
      };
    }
    if (attemptCount >= policy.maxAttempts) {
      return {
        retry: false,
        reason: "check-delivery-max-attempts-reached",
        checkDelivery: input.checkDelivery,
        attemptCount,
        maxAttempts: policy.maxAttempts,
        nextAttemptAt: input.checkDelivery.nextAttemptAt ?? null
      };
    }
    if (input.checkDelivery.status !== "RETRYING" && !canTransitionCheckDelivery(input.checkDelivery.status, "RETRYING")) {
      throw new Error(`check-delivery-transition-invalid: ${input.checkDelivery.status}->RETRYING`);
    }
    const retryAfterDelaySeconds = parseRetryAfterDelaySeconds(input.retryAfter, nowMs);
    const backoffDelaySeconds = checkDeliveryBackoffDelaySeconds({
      deliveryId: input.checkDelivery.deliveryId,
      attemptCount,
      policy
    });
    const delaySeconds = Math.min(
      policy.maxDelaySeconds,
      Math.max(backoffDelaySeconds, retryAfterDelaySeconds ?? 1)
    );
    const nextAttemptAt = new Date(nowMs + delaySeconds * 1000).toISOString();
    const plan: CheckDeliveryRetryPlan = {
      retry: true,
      reason: "retry-scheduled",
      attemptCount,
      maxAttempts: policy.maxAttempts,
      delaySeconds,
      nextAttemptAt,
      retryAfterDelaySeconds,
      checkDelivery: {
        ...input.checkDelivery,
        status: "RETRYING",
        attemptCount,
        nextAttemptAt,
        updatedAt: input.now,
        lastErrorCode: isGovernanceReasonCode(input.errorCode) ? input.errorCode : input.checkDelivery.lastErrorCode ?? null
      }
    };
    this.recordCheckDeliveryLagMetric(plan.checkDelivery, input.now);
    this.recordCheckDeliveryRetryMetric(plan, input.now);
    return plan;
  }

  deadLetterCheckDelivery(input: { checkDelivery: CheckDelivery; now: string; errorCode: GovernanceReasonCode }): CheckDelivery {
    requireFiniteTime(input.now, "checkDelivery.deadLetter.now");
    if (!canTransitionCheckDelivery(input.checkDelivery.status, "DEAD_LETTER")) {
      throw new Error(`check-delivery-dead-letter-transition-invalid: ${input.checkDelivery.status}->DEAD_LETTER`);
    }
    const checkDelivery: CheckDelivery = {
      ...input.checkDelivery,
      status: "DEAD_LETTER",
      nextAttemptAt: null,
      lastErrorCode: input.errorCode,
      updatedAt: input.now
    };
    this.recordCheckDeliveryLagMetric(checkDelivery, input.now);
    this.recordRejectReasonMetric(input.errorCode, input.now, {
      deliveryId: checkDelivery.deliveryId,
      checkName: checkDelivery.checkName,
      status: checkDelivery.status
    });
    return checkDelivery;
  }

  replayDeadLetterCheckDelivery(input: {
    checkDelivery: CheckDelivery;
    now: string;
    authorization: CheckDeliveryReplayAuthorization;
  }): CheckDeliveryReplayResult {
    const authorization = requireCheckDeliveryReplayAuthorization(input.authorization);
    requireFiniteTime(input.now, "checkDelivery.replay.now");
    if (input.checkDelivery.status !== "DEAD_LETTER") throw new Error("check-delivery-not-dead-letter");
    if (!canTransitionCheckDelivery(input.checkDelivery.status, "PENDING")) {
      throw new Error(`check-delivery-replay-transition-invalid: ${input.checkDelivery.status}->PENDING`);
    }
    const checkDelivery: CheckDelivery = {
      ...input.checkDelivery,
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
      updatedAt: input.now
    };
    return {
      replayed: true,
      source: authorization.permissionSource,
      checkDelivery,
      replayDigest: digestJson({
        schemaVersion: "archcontext.check-delivery-replay/v1",
        deliveryId: checkDelivery.deliveryId,
        source: authorization.permissionSource,
        actorId: authorization.actorId,
        verifiedAt: authorization.verifiedAt,
        reason: authorization.reason
      })
    };
  }

  rerequestCheckDelivery(input: {
    checkDelivery: CheckDelivery;
    now: string;
    githubDeliveryId: string;
  }): CheckDeliveryReplayResult {
    const githubDeliveryId = requireNonEmptyString(input.githubDeliveryId, "checkDelivery.rerequest.githubDeliveryId");
    return this.replayDeadLetterCheckDelivery({
      checkDelivery: input.checkDelivery,
      now: input.now,
      authorization: {
        actorId: `github-check-rerequest:${githubDeliveryId}`,
        permissionSource: "github-check-rerequest",
        verifiedAt: input.now,
        reason: "github-check-rerequested"
      }
    });
  }

  publishCurrentCheckDeliverySuccess(input: {
    checkDelivery: CheckDelivery;
    challenge: ReviewChallengeV2;
    currentPullHead: PullHeadMetadata;
    checkRunId: string;
    publishedAt: string;
  }): CheckDeliveryPublicationResult {
    const checkRunId = requireNonEmptyString(input.checkRunId, "checkDelivery.checkRunId");
    requireFiniteTime(input.publishedAt, "checkDelivery.publishedAt");
    this.assertGovernanceFeatureEnabled(input.challenge.requiredTrust);
    const base = {
      schemaVersion: "archcontext.check-delivery-publication/v1" as const,
      checkDelivery: input.checkDelivery,
      challenge: input.challenge
    };
    if (input.checkDelivery.status !== "PENDING" && input.checkDelivery.status !== "RETRYING") {
      return {
        ...base,
        published: false,
        reason: "check-delivery-terminal-status"
      };
    }
    if (input.checkDelivery.challengeId !== input.challenge.challengeId) {
      return this.rejectCheckDeliveryPublication({
        ...base,
        reason: "check-delivery-challenge-mismatch",
        reasonCode: "CHALLENGE_NOT_FOUND",
        now: input.publishedAt
      });
    }
    if (input.checkDelivery.headSha !== input.challenge.headSha) {
      return this.rejectCheckDeliveryPublication({
        ...base,
        reason: "check-delivery-head-mismatch",
        reasonCode: "HEAD_SHA_MISMATCH",
        now: input.publishedAt
      });
    }
    if (input.checkDelivery.checkName !== checkNameForRequiredTrust(input.challenge.requiredTrust)) {
      return this.rejectCheckDeliveryPublication({
        ...base,
        reason: "check-delivery-name-mismatch",
        reasonCode: "TRUST_LEVEL_MISMATCH",
        now: input.publishedAt
      });
    }
    if (input.challenge.status === "SUPERSEDED") {
      return this.rejectCheckDeliveryPublication({
        ...base,
        reason: "challenge-superseded",
        reasonCode: "CHALLENGE_SUPERSEDED",
        now: input.publishedAt
      });
    }
    if (input.challenge.status !== "SUBMITTED") {
      return this.rejectCheckDeliveryPublication({
        ...base,
        reason: "challenge-not-submitted",
        reasonCode: input.challenge.status === "EXPIRED" ? "CHALLENGE_EXPIRED" : "CHALLENGE_NOT_FOUND",
        now: input.publishedAt
      });
    }
    const currentHeadVerification = this.verifyReviewChallengePullHead({
      challenge: input.challenge,
      pullHead: input.currentPullHead
    });
    if (!currentHeadVerification.accepted) {
      return this.rejectCheckDeliveryPublication({
        ...base,
        reason: "challenge-not-current",
        reasonCode: currentHeadVerification.reasonCode ?? "HEAD_SHA_MISMATCH",
        now: input.publishedAt,
        currentHeadVerification
      });
    }
    if (!canTransitionCheckDelivery(input.checkDelivery.status, "PUBLISHED")) {
      throw new Error(`check-delivery-publish-transition-invalid: ${input.checkDelivery.status}->PUBLISHED`);
    }
    const checkDelivery: CheckDelivery = {
      ...input.checkDelivery,
      status: "PUBLISHED",
      checkRunId,
      nextAttemptAt: null,
      lastErrorCode: null,
      updatedAt: input.publishedAt
    };
    const result: CheckDeliveryPublicationResult = {
      ...base,
      published: true,
      reason: "published",
      checkRunId,
      currentHeadVerification,
      checkDelivery,
      challenge: transitionReviewChallengeStatus(input.challenge, "VERIFIED")
    };
    this.recordCheckDeliveryLagMetric(checkDelivery, input.publishedAt);
    return result;
  }

  private rejectCheckDeliveryPublication(input: {
    schemaVersion: "archcontext.check-delivery-publication/v1";
    checkDelivery: CheckDelivery;
    challenge: ReviewChallengeV2;
    reason: Exclude<CheckDeliveryPublicationDecisionReason, "published" | "check-delivery-terminal-status">;
    reasonCode: GovernanceReasonCode;
    now: string;
    currentHeadVerification?: ReviewChallengePullHeadVerification;
  }): CheckDeliveryPublicationResult {
    if (!canTransitionCheckDelivery(input.checkDelivery.status, "DEAD_LETTER")) {
      throw new Error(`check-delivery-publication-reject-transition-invalid: ${input.checkDelivery.status}->DEAD_LETTER`);
    }
    const checkDelivery: CheckDelivery = {
      ...input.checkDelivery,
      status: "DEAD_LETTER",
      nextAttemptAt: null,
      lastErrorCode: input.reasonCode,
      updatedAt: input.now
    };
    const result: CheckDeliveryPublicationResult = {
      schemaVersion: input.schemaVersion,
      published: false,
      reason: input.reason,
      reasonCode: input.reasonCode,
      currentHeadVerification: input.currentHeadVerification,
      challenge: input.challenge,
      checkDelivery
    };
    this.recordCheckDeliveryLagMetric(checkDelivery, input.now);
    this.recordRejectReasonMetric(input.reasonCode, input.now, {
      deliveryId: checkDelivery.deliveryId,
      checkName: checkDelivery.checkName,
      status: checkDelivery.status
    });
    return result;
  }

  private assertGovernanceFeatureEnabled(requiredTrust: ReviewChallengeV2["requiredTrust"]): GovernanceFeatureFlagDecision {
    return assertGovernanceFeatureFlagsAllow({
      requiredTrust,
      flags: this.governanceFeatureFlags
    });
  }

  cancelReviewChallengeApi(request: CancelReviewChallengeApiRequest): ReviewChallengeV2 {
    assertChallengeApiRequestSchema(request, CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.cancel);
    requireNonEmptyString(request.reason, "challenge.cancelReason");
    requireFiniteTime(request.now, "challenge.cancelledAt");
    const challenge = this.getReviewChallengeApi({
      schemaVersion: CHALLENGE_API_REQUEST_SCHEMA_VERSIONS.get,
      challengeId: request.challengeId
    });
    const cancelled = transitionReviewChallengeStatus(challenge, "EXPIRED");
    this.reviewChallenges.set(cancelled.challengeId, cancelled);
    this.reviewChallengeLeases.delete(cancelled.challengeId);
    return cancelled;
  }

  issueReviewChallenge(input: IssueReviewChallengeInput): ReviewChallengeV2 {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const expiresAt = input.expiresAt ?? new Date(Date.parse(createdAt) + (input.ttlMs ?? DEFAULT_REVIEW_CHALLENGE_TTL_MS)).toISOString();
    this.validateReviewChallengeExpiryLimits({ createdAt, expiresAt });
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
    const deviceIds = [...this.deviceIdentities.values()]
      .filter((device) => device.accountId === accountId)
      .map((device) => device.deviceId);
    this.accounts.delete(accountId);
    for (const deviceId of deviceIds) {
      this.deviceIdentities.delete(deviceId);
      this.revokedDevices.delete(deviceId);
    }
    for (const [providerId, scope] of [...this.notificationProviderScopes.entries()]) {
      if (scope.accountId === accountId) {
        this.notificationProviderScopes.delete(providerId);
        this.notificationProviders.delete(providerId);
      }
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

  private recordReviewChallengeSubmitMetrics(input: {
    challenge: ReviewChallengeV2;
    result: SubmitReviewChallengeAttestationResult;
    recordedAt: string;
    verifyStartedAt: string;
  }): void {
    this.recordChallengeAgeMetric(input.challenge, input.recordedAt);
    this.recordVerifyLatencyMetric({
      challenge: input.challenge,
      result: input.result,
      startedAt: input.verifyStartedAt,
      finishedAt: input.recordedAt
    });
    const reasonCode = input.result.accepted ? undefined : input.result.reasonCode;
    if (reasonCode) {
      this.recordRejectReasonMetric(reasonCode, input.recordedAt, {
        challengeId: input.challenge.challengeId,
        requiredTrust: input.challenge.requiredTrust,
        status: input.challenge.status
      });
    }
  }

  private recordChallengeAgeMetric(challenge: ReviewChallengeV2, recordedAt: string): ControlPlaneMetricSample {
    const recordedAtMs = requireFiniteTime(recordedAt, "metrics.recordedAt");
    const createdAtMs = requireFiniteTime(challenge.createdAt, "metrics.challenge.createdAt");
    return this.recordControlPlaneMetric({
      name: "challenge_age_ms",
      value: Math.max(0, recordedAtMs - createdAtMs),
      unit: "milliseconds",
      recordedAt,
      labels: {
        challengeId: challenge.challengeId,
        requiredTrust: challenge.requiredTrust,
        status: challenge.status
      }
    });
  }

  private recordChallengeCreateLatencyMetric(challenge: ReviewChallengeV2, latencyMs: number): ControlPlaneMetricSample {
    return this.recordControlPlaneMetric({
      name: "challenge_create_latency_ms",
      value: Math.round(latencyMs),
      unit: "milliseconds",
      recordedAt: challenge.createdAt,
      labels: {
        challengeId: challenge.challengeId,
        requiredTrust: challenge.requiredTrust,
        status: challenge.status
      }
    });
  }

  private recordVerifyLatencyMetric(input: {
    challenge: ReviewChallengeV2;
    result: SubmitReviewChallengeAttestationResult;
    startedAt: string;
    finishedAt: string;
  }): ControlPlaneMetricSample {
    const startedAtMs = requireFiniteTime(input.startedAt, "metrics.verify.startedAt");
    const finishedAtMs = requireFiniteTime(input.finishedAt, "metrics.verify.finishedAt");
    if (finishedAtMs < startedAtMs) throw new Error("control-plane-metric-time-window-invalid");
    return this.recordControlPlaneMetric({
      name: "verify_latency_ms",
      value: finishedAtMs - startedAtMs,
      unit: "milliseconds",
      recordedAt: input.finishedAt,
      labels: {
        challengeId: input.challenge.challengeId,
        requiredTrust: input.challenge.requiredTrust,
        status: input.result.accepted ? "accepted" : "rejected",
        ...(input.result.accepted ? {} : { reasonCode: input.result.reasonCode })
      }
    });
  }

  private recordCheckDeliveryLagMetric(checkDelivery: CheckDelivery, recordedAt: string): ControlPlaneMetricSample {
    const recordedAtMs = requireFiniteTime(recordedAt, "metrics.recordedAt");
    const createdAtMs = requireFiniteTime(checkDelivery.createdAt, "metrics.checkDelivery.createdAt");
    return this.recordControlPlaneMetric({
      name: "check_delivery_lag_ms",
      value: Math.max(0, recordedAtMs - createdAtMs),
      unit: "milliseconds",
      recordedAt,
      labels: {
        deliveryId: checkDelivery.deliveryId,
        challengeId: checkDelivery.challengeId,
        checkName: checkDelivery.checkName,
        status: checkDelivery.status,
        attempt: String(checkDelivery.attemptCount)
      }
    });
  }

  private recordCheckDeliveryRetryMetric(plan: CheckDeliveryRetryPlan, recordedAt: string): ControlPlaneMetricSample {
    return this.recordControlPlaneMetric({
      name: "check_delivery_retry_total",
      value: 1,
      unit: "count",
      recordedAt,
      labels: {
        deliveryId: plan.checkDelivery.deliveryId,
        challengeId: plan.checkDelivery.challengeId,
        checkName: plan.checkDelivery.checkName,
        status: plan.checkDelivery.status,
        attempt: String(plan.attemptCount),
        reason: plan.reason,
        retry: String(plan.retry)
      }
    });
  }

  private recordRejectReasonMetric(
    reasonCode: GovernanceReasonCode,
    recordedAt: string,
    labels: Record<string, string | number | boolean | undefined> = {}
  ): ControlPlaneMetricSample {
    const reason = GOVERNANCE_REASON_CATALOG[reasonCode];
    return this.recordControlPlaneMetric({
      name: "reject_reason_total",
      value: 1,
      unit: "count",
      recordedAt,
      labels: {
        ...labels,
        reasonCode,
        retryable: String(reason.retryable),
        action: reason.action
      }
    });
  }

  private recordControlPlaneMetric(input: {
    name: ControlPlaneMetricName;
    value: number;
    unit: ControlPlaneMetricUnit;
    recordedAt: string;
    labels?: Record<string, string | number | boolean | undefined>;
  }): ControlPlaneMetricSample {
    if (!Number.isFinite(input.value) || input.value < 0) throw new Error("control-plane-metric-value-invalid");
    requireFiniteTime(input.recordedAt, "metrics.recordedAt");
    const labels = controlPlaneMetricLabels(input.labels ?? {});
    const core = {
      schemaVersion: "archcontext.control-plane-metric/v1" as const,
      name: input.name,
      value: input.value,
      unit: input.unit,
      recordedAt: new Date(Date.parse(input.recordedAt)).toISOString(),
      labels
    };
    const sample = {
      ...core,
      metadataDigest: digestJson(core as any)
    };
    this.metricSamples.push(sample);
    return sample;
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
      actor: { id: authorization.actorId },
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
    assertControlPlaneAuditEventMinimal(event);
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

export function auditControlPlaneAuditEvent(event: unknown): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return { ok: false, findings: ["audit event must be an object"] };
  }
  const record = event as Record<string, unknown>;
  const topLevelAllowed = new Set<string>(CONTROL_PLANE_AUDIT_EVENT_FIELDS);
  const actorAllowed = new Set<string>(CONTROL_PLANE_AUDIT_ACTOR_FIELDS);
  const resourceAllowed = new Set<string>(CONTROL_PLANE_AUDIT_RESOURCE_FIELDS);

  for (const key of Object.keys(record)) {
    if (!topLevelAllowed.has(key)) findings.push(`non-minimal audit field: ${key}`);
  }

  const actor = record.actor;
  if (!actor || typeof actor !== "object" || Array.isArray(actor)) {
    findings.push("actor must be an object");
  } else {
    for (const key of Object.keys(actor)) {
      if (!actorAllowed.has(key)) findings.push(`non-minimal audit actor field: ${key}`);
    }
  }

  const resource = record.resource;
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    findings.push("resource must be an object");
  } else {
    for (const key of Object.keys(resource)) {
      if (!resourceAllowed.has(key)) findings.push(`non-minimal audit resource field: ${key}`);
    }
  }

  collectForbiddenAuditFields(record, [], findings);
  if (containsPrivateContent(record)) findings.push("audit event contains private content");
  return { ok: findings.length === 0, findings };
}

export function assertControlPlaneAuditEventMinimal(event: unknown): asserts event is ControlPlaneAuditEvent {
  const audit = auditControlPlaneAuditEvent(event);
  if (!audit.ok) throw new Error(`control-plane-audit-event-non-minimal: ${audit.findings.join(", ")}`);
}

export function assertNoUploadRoutes(routes: readonly string[] = CONTROL_PLANE_ROUTES): void {
  const forbidden = /(upload|index|detail|embedding|blob|proxy)/i;
  for (const route of routes) {
    if (forbidden.test(route)) throw new Error(`Forbidden route: ${route}`);
  }
}

function collectForbiddenAuditFields(value: unknown, path: readonly string[], findings: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) collectForbiddenAuditFields(child, [...path, String(index)], findings);
    return;
  }
  const forbidden = new Set<string>(FORBIDDEN_CONTROL_PLANE_AUDIT_FIELDS.map((key) => key.toLowerCase()));
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = [...path, key];
    if (forbidden.has(key.toLowerCase())) findings.push(`forbidden audit field: ${childPath.join(".")}`);
    collectForbiddenAuditFields(child, childPath, findings);
  }
}

function controlPlaneMetricLabels(labels: Record<string, string | number | boolean | undefined>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (value === undefined) continue;
    if (!CONTROL_PLANE_METRIC_LABEL_FIELDS.has(key)) throw new Error(`control-plane-metric-label-forbidden: ${key}`);
    if (containsPrivateContent({ [key]: value })) throw new Error(`control-plane-metric-label-private-content: ${key}`);
    normalized[key] = String(value);
  }
  return Object.fromEntries(Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right)));
}

function createControlPlaneAlert(input: {
  kind: ControlPlaneAlertKind;
  severity: ControlPlaneAlertSeverity;
  firedAt: string;
  summary: string;
  labels: Record<string, string | number | boolean | undefined>;
  metrics: Record<string, number>;
}): ControlPlaneAlert {
  const firedAt = new Date(requireFiniteTime(input.firedAt, "alerts.firedAt")).toISOString();
  const labels = controlPlaneAlertLabels({
    ...input.labels,
    kind: input.kind
  });
  const metrics = controlPlaneAlertMetrics(input.metrics);
  const core = {
    schemaVersion: "archcontext.control-plane-alert/v1" as const,
    kind: input.kind,
    severity: input.severity,
    status: "firing" as const,
    firedAt,
    summary: requireNonEmptyString(input.summary, "alerts.summary"),
    labels,
    metrics,
    runbook: {
      path: CONTROL_PLANE_ALERT_RUNBOOK_PATH as typeof CONTROL_PLANE_ALERT_RUNBOOK_PATH,
      section: input.kind
    }
  };
  const metadataDigest = digestJson(core as any);
  return {
    ...core,
    alertId: `alert_${metadataDigest.slice("sha256:".length, "sha256:".length + 16)}`,
    metadataDigest
  };
}

function normalizeControlPlaneAlertThresholds(input: Partial<ControlPlaneAlertThresholds> = {}): ControlPlaneAlertThresholds {
  return {
    webhookBacklogCount: requirePositiveInteger(input.webhookBacklogCount ?? DEFAULT_CONTROL_PLANE_ALERT_THRESHOLDS.webhookBacklogCount, "alerts.thresholds.webhookBacklogCount"),
    webhookBacklogOldestAgeMs: requirePositiveInteger(input.webhookBacklogOldestAgeMs ?? DEFAULT_CONTROL_PLANE_ALERT_THRESHOLDS.webhookBacklogOldestAgeMs, "alerts.thresholds.webhookBacklogOldestAgeMs"),
    checkDlqCount: requirePositiveInteger(input.checkDlqCount ?? DEFAULT_CONTROL_PLANE_ALERT_THRESHOLDS.checkDlqCount, "alerts.thresholds.checkDlqCount"),
    verifyFailureCount: requirePositiveInteger(input.verifyFailureCount ?? DEFAULT_CONTROL_PLANE_ALERT_THRESHOLDS.verifyFailureCount, "alerts.thresholds.verifyFailureCount"),
    githubApiFailureCount: requirePositiveInteger(input.githubApiFailureCount ?? DEFAULT_CONTROL_PLANE_ALERT_THRESHOLDS.githubApiFailureCount, "alerts.thresholds.githubApiFailureCount"),
    githubApiFailureWindowMs: requirePositiveInteger(input.githubApiFailureWindowMs ?? DEFAULT_CONTROL_PLANE_ALERT_THRESHOLDS.githubApiFailureWindowMs, "alerts.thresholds.githubApiFailureWindowMs"),
    signatureFailureCount: requirePositiveInteger(input.signatureFailureCount ?? DEFAULT_CONTROL_PLANE_ALERT_THRESHOLDS.signatureFailureCount, "alerts.thresholds.signatureFailureCount"),
    signatureFailureWindowMs: requirePositiveInteger(input.signatureFailureWindowMs ?? DEFAULT_CONTROL_PLANE_ALERT_THRESHOLDS.signatureFailureWindowMs, "alerts.thresholds.signatureFailureWindowMs"),
    keyRevocationCount: requirePositiveInteger(input.keyRevocationCount ?? DEFAULT_CONTROL_PLANE_ALERT_THRESHOLDS.keyRevocationCount, "alerts.thresholds.keyRevocationCount"),
    keyRevocationWindowMs: requirePositiveInteger(input.keyRevocationWindowMs ?? DEFAULT_CONTROL_PLANE_ALERT_THRESHOLDS.keyRevocationWindowMs, "alerts.thresholds.keyRevocationWindowMs")
  };
}

function controlPlaneAlertLabels(labels: Record<string, string | number | boolean | undefined>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (value === undefined) continue;
    if (!CONTROL_PLANE_ALERT_LABEL_FIELDS.has(key)) throw new Error(`control-plane-alert-label-forbidden: ${key}`);
    if (containsPrivateContent({ [key]: value })) throw new Error(`control-plane-alert-label-private-content: ${key}`);
    normalized[key] = String(value);
  }
  return Object.fromEntries(Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right)));
}

function controlPlaneAlertMetrics(metrics: Record<string, number>): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) throw new Error(`control-plane-alert-metric-key-invalid: ${key}`);
    if (!Number.isFinite(value) || value < 0) throw new Error(`control-plane-alert-metric-value-invalid: ${key}`);
    normalized[key] = value;
  }
  return Object.fromEntries(Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right)));
}

function isForbiddenPrivateContentKey(key: string): boolean {
  return FORBIDDEN_PRIVATE_CONTENT_KEYS.has(key.toLowerCase());
}

function acceptedAttestationPersistenceRow(attestation: AttestationV2, payloadDigest: string, acceptedAt: string): AcceptedAttestationPersistenceRow {
  return {
    attestationId: attestation.attestationId,
    challengeId: attestation.challengeId,
    installationId: attestation.installationId,
    repositoryId: attestation.repositoryId,
    pullRequestNumber: attestation.pullRequestNumber,
    headSha: attestation.headSha,
    baseSha: attestation.baseSha,
    mergeBaseSha: attestation.mergeBaseSha,
    headTreeOid: attestation.headTreeOid,
    worktreeDigest: attestation.worktreeDigest,
    modelDigest: attestation.modelDigest,
    policyDigest: attestation.policyDigest,
    codeFactsDigest: attestation.codeFactsDigest,
    reviewDigest: attestation.reviewDigest,
    result: attestation.result,
    errorCode: attestation.errorCode ?? null,
    executionTrustLevel: attestation.execution.trustLevel,
    executionOrigin: attestation.execution.source,
    principalId: attestation.execution.principalId,
    publicKeyId: attestation.execution.publicKeyId,
    runtimeVersion: attestation.runtime.version,
    runtimeBuildDigest: attestation.runtime.buildDigest,
    runtimeGraphVersion: String((attestation.runtime as Record<string, unknown>)[["code", "Graph", "Version"].join("")]),
    runtimeCapabilitiesDigest: attestation.runtime.capabilitiesDigest,
    nonceHash: reviewChallengeNonceHash({ nonce: attestation.nonce }),
    signaturePresent: Boolean(attestation.signature?.value),
    startedAt: attestation.startedAt,
    completedAt: attestation.completedAt,
    expiresAt: attestation.expiresAt,
    acceptedAt,
    payloadDigest
  };
}

function acceptedCheckDeliveryForChallenge(input: {
  challenge: ReviewChallengeV2;
  payloadDigest: string;
  createdAt: string;
}): CheckDelivery {
  requireDigest(input.payloadDigest, "checkDelivery.payloadDigest");
  requireFiniteTime(input.createdAt, "checkDelivery.createdAt");
  const checkName = checkNameForRequiredTrust(input.challenge.requiredTrust);
  const deliveryId = checkDeliveryIdempotencyKey({
    challengeId: input.challenge.challengeId,
    checkName,
    headSha: input.challenge.headSha
  });
  return {
    schemaVersion: "archcontext.check-delivery/v1",
    deliveryId,
    challengeId: input.challenge.challengeId,
    checkRunId: null,
    checkName,
    headSha: input.challenge.headSha,
    status: "PENDING",
    attemptCount: 0,
    nextAttemptAt: null,
    lastErrorCode: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  };
}

function pendingCheckDeliveryPersistenceRow(checkDelivery: CheckDelivery): PendingCheckDeliveryPersistenceRow {
  if (checkDelivery.status !== "PENDING") throw new Error("check-delivery-not-pending");
  return {
    deliveryId: checkDelivery.deliveryId,
    challengeId: checkDelivery.challengeId,
    checkName: checkDelivery.checkName,
    headSha: checkDelivery.headSha,
    createdAt: checkDelivery.createdAt,
    updatedAt: checkDelivery.updatedAt
  };
}

function normalizeCheckDeliveryRetryPolicy(policy: Partial<CheckDeliveryRetryPolicy> | undefined): CheckDeliveryRetryPolicy {
  const normalized = {
    maxAttempts: policy?.maxAttempts ?? DEFAULT_CHECK_DELIVERY_RETRY_POLICY.maxAttempts,
    baseDelaySeconds: policy?.baseDelaySeconds ?? DEFAULT_CHECK_DELIVERY_RETRY_POLICY.baseDelaySeconds,
    maxDelaySeconds: policy?.maxDelaySeconds ?? DEFAULT_CHECK_DELIVERY_RETRY_POLICY.maxDelaySeconds,
    jitterRatio: policy?.jitterRatio ?? DEFAULT_CHECK_DELIVERY_RETRY_POLICY.jitterRatio
  };
  if (!Number.isInteger(normalized.maxAttempts) || normalized.maxAttempts < 1) throw new Error("check-delivery-retry-maxAttempts-invalid");
  requireQueueDelaySeconds(normalized.baseDelaySeconds, "checkDelivery.retry.baseDelaySeconds");
  requireQueueDelaySeconds(normalized.maxDelaySeconds, "checkDelivery.retry.maxDelaySeconds");
  if (normalized.maxDelaySeconds < normalized.baseDelaySeconds) throw new Error("check-delivery-retry-maxDelay-invalid");
  if (!Number.isFinite(normalized.jitterRatio) || normalized.jitterRatio < 0 || normalized.jitterRatio > 1) {
    throw new Error("check-delivery-retry-jitter-invalid");
  }
  return normalized;
}

function checkDeliveryBackoffDelaySeconds(input: {
  deliveryId: string;
  attemptCount: number;
  policy: CheckDeliveryRetryPolicy;
}): number {
  const exponential = Math.min(
    input.policy.maxDelaySeconds,
    input.policy.baseDelaySeconds * 2 ** Math.max(0, input.attemptCount - 1)
  );
  const jitter = deterministicJitterSeconds({
    deliveryId: input.deliveryId,
    attemptCount: input.attemptCount,
    baseDelaySeconds: exponential,
    jitterRatio: input.policy.jitterRatio
  });
  return Math.min(input.policy.maxDelaySeconds, Math.max(1, Math.round(exponential + jitter)));
}

function deterministicJitterSeconds(input: {
  deliveryId: string;
  attemptCount: number;
  baseDelaySeconds: number;
  jitterRatio: number;
}): number {
  if (input.jitterRatio === 0) return 0;
  const amplitude = Math.max(1, Math.round(input.baseDelaySeconds * input.jitterRatio));
  const digest = digestJson({
    schemaVersion: "archcontext.check-delivery-retry-jitter/v1",
    deliveryId: input.deliveryId,
    attemptCount: input.attemptCount
  });
  const numeric = Number.parseInt(digest.slice("sha256:".length, "sha256:".length + 8), 16) / 0xffffffff;
  return Math.round((numeric * 2 - 1) * amplitude);
}

function parseRetryAfterDelaySeconds(value: string | number | undefined, nowMs: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return clampRetryAfterDelaySeconds(Math.ceil(value), "checkDelivery.retryAfter");
  const trimmed = value.trim();
  if (!trimmed) throw new Error("check-delivery-retryAfter-invalid");
  if (/^\d+$/.test(trimmed)) return clampRetryAfterDelaySeconds(Number(trimmed), "checkDelivery.retryAfter");
  const retryAtMs = Date.parse(trimmed);
  if (!Number.isFinite(retryAtMs)) throw new Error("check-delivery-retryAfter-invalid");
  return clampRetryAfterDelaySeconds(Math.max(1, Math.ceil((retryAtMs - nowMs) / 1000)), "checkDelivery.retryAfter");
}

function isGovernanceReasonCode(value: string): value is GovernanceReasonCode {
  return Object.prototype.hasOwnProperty.call(GOVERNANCE_REASON_CATALOG, value);
}

function requireCheckDeliveryReplayAuthorization(authorization: CheckDeliveryReplayAuthorization | undefined): CheckDeliveryReplayAuthorization {
  if (!authorization) throw new Error("check-delivery-replay-authorization-required");
  const actorId = requireNonEmptyString(authorization.actorId, "checkDelivery.replay.actorId");
  if (!["manual-ops", "github-check-rerequest", "test-fixture"].includes(authorization.permissionSource)) {
    throw new Error("check-delivery-replay-permissionSource-invalid");
  }
  requireFiniteTime(authorization.verifiedAt, "checkDelivery.replay.verifiedAt");
  const reason = requireNonEmptyString(authorization.reason, "checkDelivery.replay.reason");
  return {
    actorId,
    permissionSource: authorization.permissionSource,
    verifiedAt: authorization.verifiedAt,
    reason
  };
}

function isAllowedPublicAttestationKey(path: readonly string[]): boolean {
  return path.join(".") === "attestation.execution.source";
}

function containsPrivateContent(value: unknown, path: readonly string[] = []): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((child, index) => containsPrivateContent(child, [...path, String(index)]));
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
      const childPath = [...path, key];
      const forbiddenKey = isForbiddenPrivateContentKey(key) && !isAllowedPublicAttestationKey(childPath);
      return forbiddenKey || containsPrivateContent(child, childPath);
    });
  }
  if (typeof value !== "string") return false;
  return PRIVATE_CONTENT_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function assertChallengeApiRequestSchema(value: unknown, schemaVersion: ChallengeApiRequestSchemaVersion): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("challenge-api-request-invalid");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== schemaVersion) throw new Error(`challenge-api-schemaVersion-invalid: ${String(record.schemaVersion)}`);
  for (const [key, child] of Object.entries(record)) {
    if (key === "publicKey") continue;
    if (isForbiddenPrivateContentKey(key) || containsPrivateContent(child, [key])) throw new Error("challenge-api-private-content-forbidden");
  }
}

function assertKeyApiRequestSchema(value: unknown, schemaVersion: KeyApiRequestSchemaVersion): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("key-api-request-invalid");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== schemaVersion) throw new Error(`key-api-schemaVersion-invalid: ${String(record.schemaVersion)}`);
  for (const [key, child] of Object.entries(record)) {
    if (key === "publicKey") continue;
    if (isForbiddenPrivateContentKey(key) || containsPrivateContent(child, [key])) throw new Error("key-api-private-content-forbidden");
  }
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

function requireDigest(value: string, field: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error(`${field}-invalid`);
  return value;
}

function requireQueueDelaySeconds(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_QUEUE_DELAY_SECONDS) throw new Error(`${field}-invalid`);
  return value;
}

function clampRetryAfterDelaySeconds(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field}-invalid`);
  return Math.min(Math.max(1, value), MAX_QUEUE_DELAY_SECONDS);
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field}-invalid`);
  return value;
}

function requireNonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field}-invalid`);
  return value;
}

function requireDeviceKeyOwnerAuthorization(authorization: DeviceKeyOwnerAuthorization | undefined, accountId: string): DeviceKeyOwnerAuthorization {
  if (!authorization) throw new Error("device-key-owner-authorization-required");
  const normalizedAccountId = requireNonEmptyString(accountId, "device.accountId");
  const actorId = requireNonEmptyString(authorization.actorId, "device.actorId");
  const actorLogin = authorization.actorLogin === undefined ? undefined : requireNonEmptyString(authorization.actorLogin, "device.actorLogin");
  const authorizedAccountId = requireNonEmptyString(authorization.accountId, "device.authorization.accountId");
  if (authorizedAccountId !== normalizedAccountId) throw new Error("device-key-owner-account-mismatch");
  requireDeviceKeyPermissionSource(authorization.permissionSource);
  requireFiniteTime(authorization.verifiedAt, "device.authorization.verifiedAt");
  const reason = authorization.reason === undefined ? undefined : requireNonEmptyString(authorization.reason, "device.authorization.reason");
  return {
    actorId,
    ...(actorLogin === undefined ? {} : { actorLogin }),
    accountId: authorizedAccountId,
    permissionSource: authorization.permissionSource,
    verifiedAt: authorization.verifiedAt,
    ...(reason === undefined ? {} : { reason })
  };
}

function requireDeviceKeyPermissionSource(value: DeviceKeyOwnerAuthorization["permissionSource"]): DeviceKeyOwnerAuthorization["permissionSource"] {
  if (value === "github-oauth" || value === "device-flow" || value === "manual-ops" || value === "test-fixture") return value;
  throw new Error("device-key-owner-permission-source-invalid");
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

function requireReviewChallengeResourceBindingAuthorization(authorization: ReviewChallengeResourceBindingAuthorization | undefined): ReviewChallengeResourceBindingAuthorization {
  if (!authorization) throw new Error("review-challenge-resource-authorization-required");
  const actorId = requireNonEmptyString(authorization.actorId, "challenge.authorization.actorId");
  const actorLogin = authorization.actorLogin === undefined ? undefined : requireNonEmptyString(authorization.actorLogin, "challenge.authorization.actorLogin");
  const installationId = requirePositiveInteger(authorization.installationId, "challenge.authorization.installationId");
  const repositoryId = requirePositiveInteger(authorization.repositoryId, "challenge.authorization.repositoryId");
  const pullRequestNumber = requirePositiveInteger(authorization.pullRequestNumber, "challenge.authorization.pullRequestNumber");
  const accountId = authorization.accountId === undefined ? undefined : requireNonEmptyString(authorization.accountId, "challenge.authorization.accountId");
  const deviceId = authorization.deviceId === undefined ? undefined : requireNonEmptyString(authorization.deviceId, "challenge.authorization.deviceId");
  const runnerId = authorization.runnerId === undefined ? undefined : requireNonEmptyString(authorization.runnerId, "challenge.authorization.runnerId");
  const workflowRef = authorization.workflowRef === undefined ? undefined : requireNonEmptyString(authorization.workflowRef, "challenge.authorization.workflowRef");
  const permissionSource = requireReviewChallengeResourceBindingPermissionSource(authorization.permissionSource);
  requireFiniteTime(authorization.verifiedAt, "challenge.authorization.verifiedAt");
  const reason = authorization.reason === undefined ? undefined : requireNonEmptyString(authorization.reason, "challenge.authorization.reason");
  return {
    actorId,
    ...(actorLogin === undefined ? {} : { actorLogin }),
    installationId,
    repositoryId,
    pullRequestNumber,
    ...(accountId === undefined ? {} : { accountId }),
    ...(deviceId === undefined ? {} : { deviceId }),
    ...(runnerId === undefined ? {} : { runnerId }),
    ...(workflowRef === undefined ? {} : { workflowRef }),
    permissionSource,
    verifiedAt: authorization.verifiedAt,
    ...(reason === undefined ? {} : { reason })
  };
}

function requireReviewChallengeResourceBindingPermissionSource(value: ReviewChallengeResourceBindingPermissionSource): ReviewChallengeResourceBindingPermissionSource {
  if (value === "github-app" || value === "github-oauth" || value === "device-flow" || value === "manual-ops" || value === "test-fixture") return value;
  throw new Error("review-challenge-resource-permission-source-invalid");
}

function reviewChallengeResourceBindingResult(input: {
  authorization: ReviewChallengeResourceBindingAuthorization;
  challenge: ReviewChallengeV2;
  subject: ReviewChallengeResourceBindingSubject;
  accountId?: string;
  deviceId?: string;
  runnerId?: string;
  workflowRef?: string;
}): ReviewChallengeResourceBindingAuthorizationResult {
  const result = {
    schemaVersion: "archcontext.review-challenge-resource-binding/v1" as const,
    authorized: true as const,
    subject: input.subject,
    actorId: input.authorization.actorId,
    ...(input.authorization.actorLogin === undefined ? {} : { actorLogin: input.authorization.actorLogin }),
    challengeId: input.challenge.challengeId,
    installationId: input.challenge.installationId,
    repositoryId: input.challenge.repositoryId,
    pullRequestNumber: input.challenge.pullRequestNumber,
    ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
    ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
    ...(input.runnerId === undefined ? {} : { runnerId: input.runnerId }),
    ...(input.workflowRef === undefined ? {} : { workflowRef: input.workflowRef }),
    permissionSource: input.authorization.permissionSource,
    verifiedAt: input.authorization.verifiedAt
  };
  return {
    ...result,
    metadataDigest: digestJson({
      schemaVersion: "archcontext.review-challenge-resource-binding-digest/v1",
      subject: result.subject,
      actorId: result.actorId,
      challengeId: result.challengeId,
      installationId: result.installationId,
      repositoryId: result.repositoryId,
      pullRequestNumber: result.pullRequestNumber,
      accountId: result.accountId ?? null,
      deviceId: result.deviceId ?? null,
      runnerId: result.runnerId ?? null,
      workflowRef: result.workflowRef ?? null,
      permissionSource: result.permissionSource,
      verifiedAt: result.verifiedAt
    })
  };
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
    id: runner.runnerId,
    installationId: runner.installationId,
    scopeKind: scope.kind,
    repositoryIds: scope.kind === "repository" ? scope.repositoryIds : [],
    ...(relatedRunnerId === undefined ? {} : { relatedResourceId: relatedRunnerId })
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
