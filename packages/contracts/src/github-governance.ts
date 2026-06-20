export const DEVELOPER_REVIEW_CHECK_NAME = "ArchContext / Developer Review" as const;
export const ORGANIZATION_RUNNER_CHECK_NAME = "ArchContext / Organization Runner" as const;

export const GOVERNANCE_CHECK_NAMES = [
  DEVELOPER_REVIEW_CHECK_NAME,
  ORGANIZATION_RUNNER_CHECK_NAME
] as const;

export type GovernanceCheckName = (typeof GOVERNANCE_CHECK_NAMES)[number];
export type GovernanceTrustLevel = "developer" | "organization";
export type RequiredTrust = GovernanceTrustLevel;
export type ReviewChallengeStatus = "PENDING" | "LEASED" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "SUPERSEDED" | "EXPIRED";
export type CheckDeliveryStatus = "PENDING" | "PUBLISHED" | "RETRYING" | "DEAD_LETTER";
export type AttestationResult = "pass" | "fail" | "error";
export type GitHubAppPermissionLevel = "none" | "read" | "write";

export const GITHUB_APP_PERMISSION_MANIFEST = {
  schemaVersion: "archcontext.github-app-permission-manifest/v1",
  repositoryPermissions: {
    metadata: "read",
    pull_requests: "read",
    checks: "write",
    statuses: "write",
    contents: "none"
  },
  forbiddenByDefault: [
    "actions",
    "administration",
    "deployments",
    "issues",
    "members",
    "secrets",
    "workflows"
  ],
  conditionalPermissions: {
    commit_statuses: {
      default: "none",
      implemented: "write",
      decisionGate: "FG2-02 / FG2-EG6",
      reason: "GitHub ruleset expected-source App binding requires statuses:write; runtime still publishes Checks, not commit statuses."
    }
  },
  subscribedEvents: [
    "installation",
    "installation_repositories",
    "pull_request.opened",
    "pull_request.reopened",
    "pull_request.synchronize",
    "pull_request.closed",
    "check_run.rerequested"
  ]
} as const;

export const CHALLENGE_STATUS_TRANSITIONS: Record<ReviewChallengeStatus, readonly ReviewChallengeStatus[]> = {
  PENDING: ["LEASED", "SUPERSEDED", "EXPIRED"],
  LEASED: ["SUBMITTED", "SUPERSEDED", "EXPIRED"],
  SUBMITTED: ["VERIFIED", "REJECTED", "SUPERSEDED", "EXPIRED"],
  VERIFIED: [],
  REJECTED: [],
  SUPERSEDED: [],
  EXPIRED: []
} as const;

export const CHECK_DELIVERY_STATUS_TRANSITIONS: Record<CheckDeliveryStatus, readonly CheckDeliveryStatus[]> = {
  PENDING: ["PUBLISHED", "RETRYING", "DEAD_LETTER"],
  RETRYING: ["PUBLISHED", "RETRYING", "DEAD_LETTER"],
  PUBLISHED: [],
  DEAD_LETTER: []
} as const;

export type GovernanceReasonCode =
  | "CHALLENGE_NOT_FOUND"
  | "CHALLENGE_EXPIRED"
  | "CHALLENGE_SUPERSEDED"
  | "CHALLENGE_ALREADY_CONSUMED"
  | "NONCE_MISMATCH"
  | "REPOSITORY_MISMATCH"
  | "PULL_REQUEST_MISMATCH"
  | "HEAD_SHA_MISMATCH"
  | "BASE_SHA_MISMATCH"
  | "TREE_OID_MISMATCH"
  | "TRUST_LEVEL_MISMATCH"
  | "RUNNER_NOT_FOUND"
  | "RUNNER_REVOKED"
  | "RUNNER_SCOPE_MISMATCH"
  | "WORKFLOW_REF_MISMATCH"
  | "DEVICE_REVOKED"
  | "RUNTIME_VERSION_UNSUPPORTED"
  | "SIGNATURE_INVALID"
  | "PAYLOAD_PRIVACY_VIOLATION";

export const GOVERNANCE_REASON_CATALOG: Record<GovernanceReasonCode, { retryable: boolean; action: string }> = {
  CHALLENGE_NOT_FOUND: { retryable: false, action: "refresh-current-challenge" },
  CHALLENGE_EXPIRED: { retryable: true, action: "lease-new-challenge" },
  CHALLENGE_SUPERSEDED: { retryable: true, action: "review-latest-head" },
  CHALLENGE_ALREADY_CONSUMED: { retryable: false, action: "do-not-reuse-attestation" },
  NONCE_MISMATCH: { retryable: false, action: "restart-review-session" },
  REPOSITORY_MISMATCH: { retryable: false, action: "verify-repository-binding" },
  PULL_REQUEST_MISMATCH: { retryable: false, action: "verify-pull-request-binding" },
  HEAD_SHA_MISMATCH: { retryable: true, action: "fetch-current-head-and-rerun" },
  BASE_SHA_MISMATCH: { retryable: true, action: "refresh-pull-request-metadata" },
  TREE_OID_MISMATCH: { retryable: true, action: "recreate-clean-worktree" },
  TRUST_LEVEL_MISMATCH: { retryable: false, action: "use-required-review-mode" },
  RUNNER_NOT_FOUND: { retryable: false, action: "register-runner-identity" },
  RUNNER_REVOKED: { retryable: false, action: "rotate-runner-key" },
  RUNNER_SCOPE_MISMATCH: { retryable: false, action: "register-runner-for-repository" },
  WORKFLOW_REF_MISMATCH: { retryable: false, action: "use-approved-runner-workflow" },
  DEVICE_REVOKED: { retryable: false, action: "register-new-device-key" },
  RUNTIME_VERSION_UNSUPPORTED: { retryable: true, action: "upgrade-archctx-runtime" },
  SIGNATURE_INVALID: { retryable: false, action: "restart-review-session" },
  PAYLOAD_PRIVACY_VIOLATION: { retryable: false, action: "remove-private-content-from-payload" }
} as const;

export interface ReviewChallengeV2 {
  schemaVersion: "archcontext.review-challenge/v2";
  challengeId: string;
  installationId: number;
  repositoryId: number;
  pullRequestNumber: number;
  headSha: string;
  baseSha: string;
  nonce: string;
  requiredTrust: RequiredTrust;
  policyProfileId: string;
  createdAt: string;
  expiresAt: string;
  status: ReviewChallengeStatus;
}

export interface AttestationV2 {
  schemaVersion: "archcontext.attestation/v2";
  attestationId: string;
  challengeId: string;
  installationId: number;
  repositoryId: number;
  pullRequestNumber: number;
  headSha: string;
  baseSha: string;
  mergeBaseSha: string;
  headTreeOid: string;
  worktreeDigest: string;
  modelDigest: string;
  policyDigest: string;
  codeFactsDigest: string;
  reviewDigest: string;
  result: AttestationResult;
  errorCode?: string;
  execution: {
    trustLevel: GovernanceTrustLevel;
    source: "clean-commit-worktree" | "organization-runner-checkout";
    principalId: string;
    publicKeyId: string;
  };
  runtime: {
    version: string;
    buildDigest: string;
    codeGraphVersion: string;
    capabilitiesDigest: string;
  };
  nonce: string;
  startedAt: string;
  completedAt: string;
  expiresAt: string;
  signature: {
    algorithm: "ed25519";
    value: string;
  };
}

export interface DeviceIdentity {
  schemaVersion: "archcontext.device-identity/v1";
  deviceId: string;
  accountId: string;
  publicKeyId: string;
  publicKeyFingerprint: string;
  status: "active" | "revoked";
  createdAt: string;
  revokedAt?: string | null;
}

export interface RunnerIdentity {
  schemaVersion: "archcontext.runner-identity/v1";
  runnerId: string;
  installationId: number;
  repositoryIds: number[];
  workflowRef: string;
  publicKeyId: string;
  publicKeyFingerprint: string;
  status: "active" | "rotating" | "revoked";
  createdAt: string;
  rotatedAt?: string | null;
  revokedAt?: string | null;
}

export interface GovernanceKeyStatus {
  schemaVersion: "archcontext.governance-key-status/v1";
  publicKeyId: string;
  ownerKind: "device" | "runner";
  ownerId: string;
  fingerprint: string;
  status: "active" | "rotating" | "revoked";
  createdAt: string;
  rotatedAt?: string | null;
  revokedAt?: string | null;
}

export interface CheckDelivery {
  schemaVersion: "archcontext.check-delivery/v1";
  deliveryId: string;
  challengeId: string;
  checkRunId?: string | null;
  checkName: GovernanceCheckName;
  headSha: string;
  status: CheckDeliveryStatus;
  attemptCount: number;
  nextAttemptAt?: string | null;
  lastErrorCode?: GovernanceReasonCode | null;
  createdAt: string;
  updatedAt: string;
}

export interface CloudEgressEnvelope {
  schemaVersion: "archcontext.cloud-egress/v1";
  requestId: string;
  category: "github.metadata" | "github.pull-head" | "github.check-create" | "github.check-update";
  method: "GET" | "POST" | "PATCH";
  host: "api.github.com";
  pathTemplate: string;
  statusCode: number;
  latencyMs: number;
  recordedAt: string;
}

export interface RepositoryMetadata {
  installationId: number;
  repositoryId: number;
  owner: string;
  name: string;
  visibility: "public" | "private";
}

export interface PullHeadMetadata {
  installationId: number;
  repositoryId: number;
  pullRequestNumber: number;
  headSha: string;
  baseSha: string;
}

export interface CreateGovernanceCheckInput {
  installationId: number;
  repositoryId: number;
  pullRequestNumber: number;
  headSha: string;
  name: GovernanceCheckName;
  status: "queued" | "in_progress" | "completed";
}

export interface UpdateGovernanceCheckInput {
  installationId: number;
  repositoryId: number;
  checkRunId: string;
  name: GovernanceCheckName;
  status: "queued" | "in_progress" | "completed";
  conclusion?: "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required";
  output: {
    title: string;
    summary: string;
  };
}

export interface CheckReference {
  checkRunId: string;
  htmlUrl?: string;
}

export interface GitHubGovernancePort {
  getRepositoryMetadata(input: { installationId: number; repositoryId: number }): Promise<RepositoryMetadata>;
  getPullHeadMetadata(input: {
    installationId: number;
    repositoryId: number;
    pullRequestNumber: number;
  }): Promise<PullHeadMetadata>;
  createCheckRun(input: CreateGovernanceCheckInput): Promise<CheckReference>;
  updateCheckRun(input: UpdateGovernanceCheckInput): Promise<void>;
}

export function canTransitionChallenge(from: ReviewChallengeStatus, to: ReviewChallengeStatus): boolean {
  return CHALLENGE_STATUS_TRANSITIONS[from].includes(to);
}

export function canTransitionCheckDelivery(from: CheckDeliveryStatus, to: CheckDeliveryStatus): boolean {
  return CHECK_DELIVERY_STATUS_TRANSITIONS[from].includes(to);
}

export function satisfiesRequiredTrust(attestationTrustLevel: GovernanceTrustLevel, requiredTrust: RequiredTrust): boolean {
  if (requiredTrust === "organization") return attestationTrustLevel === "organization";
  return attestationTrustLevel === "developer" || attestationTrustLevel === "organization";
}
