import { execFileSync } from "node:child_process";
import { createPrivateKey, type KeyObject } from "node:crypto";
import {
  attestationV2Digest,
  signOrganizationAttestationV2
} from "@archcontext/cloud/attestation";
import {
  ARCHCONTEXT_PRODUCT_VERSION,
  assertNoLlmAdvisoryConclusionFields,
  digestJson,
  type AttestationResult,
  type AttestationV2,
  type Json,
  type ReviewChallengeV2,
  type RunnerIdentity
} from "@archcontext/contracts";
import { completeTaskGate, type CompleteTaskInput } from "@archcontext/core/review-engine";
import {
  findRepositoryRoot,
  verifyDetachedReviewWorktree,
  type DetachedReviewWorktreeReason
} from "@archcontext/local-runtime/git-adapter";

export const REVIEW_ACTION_NAME = "archcontext/review-action" as const;
export const REVIEW_ACTION_METADATA_PATH = "actions/review-action/action.yml" as const;
export const REVIEW_ACTION_GITHUB_HOSTED_WORKFLOW_TEMPLATE_PATH = "docs/examples/github-hosted-runner-workflow.yml" as const;
export const REVIEW_ACTION_REUSABLE_WORKFLOW_PATH = ".github/workflows/archcontext-organization-runner.yml" as const;
export const REVIEW_ACTION_REUSABLE_WORKFLOW_CALLER_TEMPLATE_PATH = "docs/examples/reusable-organization-runner-caller.yml" as const;
export const REVIEW_ACTION_DEFAULTS = {
  apiEndpoint: "https://archcontext.repoharness.com",
  challenge: "auto",
  failOn: "blocking",
  runtimeVersion: ARCHCONTEXT_PRODUCT_VERSION,
  trustLevel: "organization"
} as const;
export const REVIEW_ACTION_NO_LLM_MODEL_DIGEST = digestJson({
  schemaVersion: "archcontext.review-action-no-llm-provider/v1",
  mode: "deterministic-gate",
  provider: "none",
  runtimeVersion: ARCHCONTEXT_PRODUCT_VERSION
} as unknown as Json);

export const REVIEW_ACTION_MINIMUM_PERMISSIONS = {
  contents: "read",
  checks: "read",
  "pull-requests": "read"
} as const;

export type ReviewActionFailOn = "blocking" | "non-blocking";
export type ReviewActionTrustLevel = "organization";
export type ReviewActionLlmAdvisoryProvider = "local-provider";
export type ReviewActionLlmAdvisoryAllowedUse =
  | "architecture-thesis"
  | "refactor-explanation"
  | "proof-point-suggestions"
  | "human-readable-repair-steps";
export type ReviewActionWorkflowPermissionName = keyof typeof REVIEW_ACTION_MINIMUM_PERMISSIONS;
export type ReviewActionWorkflowPermissionLevel = "none" | "read" | "write";
export type ReviewActionWorkflowPermissions =
  | "read-all"
  | "write-all"
  | Record<string, ReviewActionWorkflowPermissionLevel>;
export type ReviewActionForkPullRequestMode = "unsupported" | "safe-no-secret";

export interface ReviewActionWorkflowTriggerPolicyInput {
  pullRequest?: boolean;
  pullRequestTarget?: boolean;
  workflowDispatch?: {
    protectedExactHead: boolean;
  };
}

export interface ReviewActionForkPolicyInput {
  eventName?: string;
  forkPullRequestMode?: ReviewActionForkPullRequestMode;
  pullRequestHeadFork?: boolean;
  pullRequestHeadRepository?: string;
  repository?: string;
  signingSecretConfigured?: boolean;
}

export interface ReviewActionLlmAdvisoryInput {
  advisory: unknown;
  deterministicGate: RunnerDeterministicGateProof;
  generatedAt: string;
  provider: ReviewActionLlmAdvisoryProvider;
}

export interface ReviewActionRuntimePinInput {
  apiEndpoint?: string;
  challenge?: string;
  failOn?: ReviewActionFailOn;
  runtimeArtifactDigest: string;
  runtimeArtifactUrl: string;
  runtimeVersion: string;
  trustLevel?: ReviewActionTrustLevel;
}

export interface ReviewActionPreflightPlan {
  schemaVersion: "archcontext.review-action-plan/v1";
  actionName: typeof REVIEW_ACTION_NAME;
  apiEndpoint: string;
  challenge: string;
  failOn: ReviewActionFailOn;
  runtimeArtifactDigest: string;
  runtimeArtifactUrl: string;
  runtimeVersion: typeof ARCHCONTEXT_PRODUCT_VERSION;
  trustLevel: ReviewActionTrustLevel;
}

export type ReviewActionPinVerification =
  | { ok: true; plan: ReviewActionPreflightPlan }
  | { ok: false; reason: string };

export type ReviewActionCheckoutReason =
  | "CHECKOUT_UNAVAILABLE"
  | "REPOSITORY_MISMATCH"
  | DetachedReviewWorktreeReason;

export interface ReviewActionCheckoutInput {
  checkoutRoot: string;
  expectedHeadSha: string;
  expectedHeadTreeOid: string;
  expectedRepository: string;
  githubRepository?: string;
}

export type ReviewActionCheckoutVerification =
  | {
      ok: true;
      schemaVersion: "archcontext.review-action-checkout/v1";
      sourceRoot: string;
      expected: {
        repository: string;
        headSha: string;
        headTreeOid: string;
      };
      observed: {
        repository: string | null;
        githubRepository: string | null;
        headSha: string;
        headTreeOid: string;
        detached: true;
        clean: true;
      };
    }
  | {
      ok: false;
      schemaVersion: "archcontext.review-action-checkout/v1";
      reasonCode: ReviewActionCheckoutReason;
      expected: {
        repository: string;
        headSha: string;
        headTreeOid: string;
      };
      observed: {
        repository?: string | null;
        githubRepository?: string | null;
        headSha?: string;
        headTreeOid?: string;
        detached?: boolean;
        clean?: boolean;
      };
    };

export type ReviewActionWorkflowPermissionVerification =
  | {
      ok: true;
      schemaVersion: "archcontext.review-action-permissions/v1";
      permissions: typeof REVIEW_ACTION_MINIMUM_PERMISSIONS;
    }
  | {
      ok: false;
      schemaVersion: "archcontext.review-action-permissions/v1";
      reasonCode:
        | "WORKFLOW_PERMISSION_BROAD_TOKEN"
        | "WORKFLOW_PERMISSION_WRITE_FORBIDDEN"
        | "WORKFLOW_PERMISSION_MISSING"
        | "WORKFLOW_PERMISSION_EXTRA";
      permission?: string;
    };

export type ReviewActionWorkflowTriggerVerification =
  | {
      ok: true;
      schemaVersion: "archcontext.review-action-trigger-policy/v1";
      acceptedTrigger: "pull_request" | "protected_workflow_dispatch";
    }
  | {
      ok: false;
      schemaVersion: "archcontext.review-action-trigger-policy/v1";
      reasonCode: "PULL_REQUEST_TARGET_FORBIDDEN" | "TRUSTED_TRIGGER_MISSING" | "WORKFLOW_DISPATCH_EXACT_HEAD_REQUIRED";
    };

export type ReviewActionForkPolicyDecision =
  | {
      run: true;
      schemaVersion: "archcontext.review-action-fork-policy/v1";
      mode: "trusted" | "safe-no-secret";
      fork: boolean;
      repository: string | null;
      pullRequestHeadRepository: string | null;
      requiresSigningSecret: boolean;
      signingSecretConfigured: boolean;
    }
  | {
      run: false;
      schemaVersion: "archcontext.review-action-fork-policy/v1";
      mode: "unsupported";
      fork: true;
      repository: string | null;
      pullRequestHeadRepository: string | null;
      outputConclusion: "neutral";
      reasonCode: "FORK_PR_UNSUPPORTED" | "FORK_PR_SECRET_EXPOSURE_FORBIDDEN";
      requiresSigningSecret: false;
      signingSecretConfigured: boolean;
    };

export interface TrustedRunnerReviewInput extends CompleteTaskInput {
  challenge: ReviewChallengeV2;
  runner: RunnerIdentity;
  privateKeySource: RunnerPrivateKeySource;
  secretStore: RunnerPrivateKeySecretStore;
  mergeBaseSha: string;
  headTreeOid: string;
  policyDigest: string;
  runtime: AttestationV2["runtime"];
  workflowRef: string;
  runId: string;
  runAttempt: number;
  startedAt: string;
  completedAt: string;
}

export type TrustedRunnerDeterministicGateInput = Omit<TrustedRunnerReviewInput, "modelDigest">;

export interface RunnerReviewResult {
  review: ReturnType<typeof completeTaskGate>;
  attestation: AttestationV2;
}

export interface RunnerDeterministicGateProof {
  schemaVersion: "archcontext.review-action-deterministic-gate/v1";
  llmProviderConfigured: false;
  modelDigest: string;
  result: RunnerReviewResult["review"]["result"];
  reviewDigest: string;
}

export interface RunnerDeterministicGateResult extends RunnerReviewResult {
  deterministicGate: RunnerDeterministicGateProof;
}

export interface RunnerPrivateKeySecretStore {
  readSecret(ref: string): string | undefined;
}

export interface RunnerPrivateKeySource {
  schemaVersion: "archcontext.runner-private-key-source/v1";
  keyRef: string;
  publicKeyId: string;
}

export interface ReviewActionLlmAdvisory {
  schemaVersion: "archcontext.review-action-llm-advisory/v1";
  advisoryDigest: string;
  allowedUses: ReviewActionLlmAdvisoryAllowedUse[];
  deterministicResult: RunnerReviewResult["review"]["result"];
  deterministicReviewDigest: string;
  generatedAt: string;
  influencesConclusion: false;
  persistedToCloud: false;
  provider: ReviewActionLlmAdvisoryProvider;
}

export function createReviewActionAttestationRuntime(input: {
  plan: ReviewActionPreflightPlan;
  codeGraphVersion: string;
  capabilitiesDigest: string;
}): AttestationV2["runtime"] {
  return {
    version: input.plan.runtimeVersion,
    buildDigest: input.plan.runtimeArtifactDigest,
    codeGraphVersion: input.codeGraphVersion,
    capabilitiesDigest: input.capabilitiesDigest
  };
}

export function createReviewActionPreflightPlan(input: ReviewActionRuntimePinInput): ReviewActionPinVerification {
  const apiEndpoint = input.apiEndpoint ?? REVIEW_ACTION_DEFAULTS.apiEndpoint;
  const challenge = input.challenge ?? REVIEW_ACTION_DEFAULTS.challenge;
  const failOn = input.failOn ?? REVIEW_ACTION_DEFAULTS.failOn;
  const trustLevel = input.trustLevel ?? REVIEW_ACTION_DEFAULTS.trustLevel;

  if (input.runtimeVersion !== ARCHCONTEXT_PRODUCT_VERSION) {
    return { ok: false, reason: "runtime-version-mismatch" };
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(input.runtimeArtifactDigest)) {
    return { ok: false, reason: "runtime-artifact-digest-invalid" };
  }
  if (!isHttpsUrl(input.runtimeArtifactUrl)) {
    return { ok: false, reason: "runtime-artifact-url-invalid" };
  }
  if (!isHttpUrl(apiEndpoint)) {
    return { ok: false, reason: "api-endpoint-invalid" };
  }
  if (trustLevel !== "organization") {
    return { ok: false, reason: "trust-level-mismatch" };
  }
  if (failOn !== "blocking" && failOn !== "non-blocking") {
    return { ok: false, reason: "fail-on-invalid" };
  }
  if (challenge.length === 0) {
    return { ok: false, reason: "challenge-invalid" };
  }

  return {
    ok: true,
    plan: {
      schemaVersion: "archcontext.review-action-plan/v1",
      actionName: REVIEW_ACTION_NAME,
      apiEndpoint,
      challenge,
      failOn,
      runtimeArtifactDigest: input.runtimeArtifactDigest,
      runtimeArtifactUrl: input.runtimeArtifactUrl,
      runtimeVersion: ARCHCONTEXT_PRODUCT_VERSION,
      trustLevel
    }
  };
}

export function verifyReviewActionCheckout(input: ReviewActionCheckoutInput): ReviewActionCheckoutVerification {
  const expected = {
    repository: input.expectedRepository,
    headSha: input.expectedHeadSha,
    headTreeOid: input.expectedHeadTreeOid
  };
  let sourceRoot: string;
  try {
    sourceRoot = findRepositoryRoot(input.checkoutRoot);
  } catch {
    return {
      ok: false,
      schemaVersion: "archcontext.review-action-checkout/v1",
      reasonCode: "CHECKOUT_UNAVAILABLE",
      expected,
      observed: {
        githubRepository: input.githubRepository ?? null
      }
    };
  }

  const observedRepository = readGitHubOriginRepository(sourceRoot);
  const observedGitHubRepository = input.githubRepository ?? null;
  if (
    (observedGitHubRepository && observedGitHubRepository !== input.expectedRepository)
    || (observedRepository && observedRepository !== input.expectedRepository)
  ) {
    return {
      ok: false,
      schemaVersion: "archcontext.review-action-checkout/v1",
      reasonCode: "REPOSITORY_MISMATCH",
      expected,
      observed: {
        repository: observedRepository,
        githubRepository: observedGitHubRepository
      }
    };
  }

  const verification = verifyDetachedReviewWorktree({
    worktreeRoot: sourceRoot,
    expectedHeadSha: input.expectedHeadSha,
    expectedHeadTreeOid: input.expectedHeadTreeOid
  });
  if (!verification.accepted) {
    return {
      ok: false,
      schemaVersion: "archcontext.review-action-checkout/v1",
      reasonCode: verification.reasonCode ?? "CHECKOUT_UNAVAILABLE",
      expected,
      observed: {
        repository: observedRepository,
        githubRepository: observedGitHubRepository,
        ...verification.observed
      }
    };
  }

  const headSha = verification.observed.headSha;
  const headTreeOid = verification.observed.headTreeOid;
  if (!headSha || !headTreeOid) throw new Error("review-action-checkout-verification-invariant");
  return {
    ok: true,
    schemaVersion: "archcontext.review-action-checkout/v1",
    sourceRoot,
    expected,
    observed: {
      repository: observedRepository,
      githubRepository: observedGitHubRepository,
      headSha,
      headTreeOid,
      detached: true,
      clean: true
    }
  };
}

export function verifyReviewActionWorkflowPermissions(input: ReviewActionWorkflowPermissions): ReviewActionWorkflowPermissionVerification {
  if (input === "read-all" || input === "write-all") {
    return {
      ok: false,
      schemaVersion: "archcontext.review-action-permissions/v1",
      reasonCode: "WORKFLOW_PERMISSION_BROAD_TOKEN"
    };
  }

  for (const [permission, level] of Object.entries(input)) {
    if (level === "write") {
      return {
        ok: false,
        schemaVersion: "archcontext.review-action-permissions/v1",
        reasonCode: "WORKFLOW_PERMISSION_WRITE_FORBIDDEN",
        permission
      };
    }
  }

  for (const [permission, expected] of Object.entries(REVIEW_ACTION_MINIMUM_PERMISSIONS)) {
    if (input[permission] !== expected) {
      return {
        ok: false,
        schemaVersion: "archcontext.review-action-permissions/v1",
        reasonCode: "WORKFLOW_PERMISSION_MISSING",
        permission
      };
    }
  }

  for (const [permission, level] of Object.entries(input)) {
    if (!(permission in REVIEW_ACTION_MINIMUM_PERMISSIONS) && level !== "none") {
      return {
        ok: false,
        schemaVersion: "archcontext.review-action-permissions/v1",
        reasonCode: "WORKFLOW_PERMISSION_EXTRA",
        permission
      };
    }
  }

  return {
    ok: true,
    schemaVersion: "archcontext.review-action-permissions/v1",
    permissions: REVIEW_ACTION_MINIMUM_PERMISSIONS
  };
}

export function verifyReviewActionWorkflowTriggerPolicy(input: ReviewActionWorkflowTriggerPolicyInput): ReviewActionWorkflowTriggerVerification {
  if (input.pullRequestTarget === true) {
    return {
      ok: false,
      schemaVersion: "archcontext.review-action-trigger-policy/v1",
      reasonCode: "PULL_REQUEST_TARGET_FORBIDDEN"
    };
  }
  if (input.pullRequest === true) {
    return {
      ok: true,
      schemaVersion: "archcontext.review-action-trigger-policy/v1",
      acceptedTrigger: "pull_request"
    };
  }
  if (input.workflowDispatch) {
    if (!input.workflowDispatch.protectedExactHead) {
      return {
        ok: false,
        schemaVersion: "archcontext.review-action-trigger-policy/v1",
        reasonCode: "WORKFLOW_DISPATCH_EXACT_HEAD_REQUIRED"
      };
    }
    return {
      ok: true,
      schemaVersion: "archcontext.review-action-trigger-policy/v1",
      acceptedTrigger: "protected_workflow_dispatch"
    };
  }
  return {
    ok: false,
    schemaVersion: "archcontext.review-action-trigger-policy/v1",
    reasonCode: "TRUSTED_TRIGGER_MISSING"
  };
}

export function evaluateReviewActionForkPolicy(input: ReviewActionForkPolicyInput): ReviewActionForkPolicyDecision {
  const repository = normalizeRepository(input.repository);
  const pullRequestHeadRepository = normalizeRepository(input.pullRequestHeadRepository);
  const fork = input.eventName === "pull_request" && (
    input.pullRequestHeadFork === true
    || (repository !== null && pullRequestHeadRepository !== null && repository !== pullRequestHeadRepository)
  );
  const signingSecretConfigured = input.signingSecretConfigured === true;

  if (!fork) {
    return {
      run: true,
      schemaVersion: "archcontext.review-action-fork-policy/v1",
      mode: "trusted",
      fork: false,
      repository,
      pullRequestHeadRepository,
      requiresSigningSecret: true,
      signingSecretConfigured
    };
  }

  if (signingSecretConfigured) {
    return {
      run: false,
      schemaVersion: "archcontext.review-action-fork-policy/v1",
      mode: "unsupported",
      fork: true,
      repository,
      pullRequestHeadRepository,
      outputConclusion: "neutral",
      reasonCode: "FORK_PR_SECRET_EXPOSURE_FORBIDDEN",
      requiresSigningSecret: false,
      signingSecretConfigured
    };
  }

  if (input.forkPullRequestMode === "safe-no-secret") {
    return {
      run: true,
      schemaVersion: "archcontext.review-action-fork-policy/v1",
      mode: "safe-no-secret",
      fork: true,
      repository,
      pullRequestHeadRepository,
      requiresSigningSecret: false,
      signingSecretConfigured: false
    };
  }

  return {
    run: false,
    schemaVersion: "archcontext.review-action-fork-policy/v1",
    mode: "unsupported",
    fork: true,
    repository,
    pullRequestHeadRepository,
    outputConclusion: "neutral",
    reasonCode: "FORK_PR_UNSUPPORTED",
    requiresSigningSecret: false,
    signingSecretConfigured: false
  };
}

export function runTrustedReview(input: TrustedRunnerReviewInput): RunnerReviewResult {
  const privateKey = readRunnerPrivateKeyFromSecretStore(input.privateKeySource, input.secretStore);
  const review = completeTaskGate(completeTaskInput(input));
  const attestation = signOrganizationAttestationV2({
    challenge: input.challenge,
    worktreeDigest: input.worktreeDigest,
    modelDigest: input.modelDigest,
    policyDigest: input.policyDigest,
    codeFactsDigest: input.codeFactsDigest,
    reviewDigest: review.extensions.digest,
    runner: input.runner,
    privateKey,
    mergeBaseSha: input.mergeBaseSha,
    headTreeOid: input.headTreeOid,
    result: attestationResultFromReviewResult(review.result),
    runtime: input.runtime,
    workflowRef: input.workflowRef,
    runId: input.runId,
    runAttempt: input.runAttempt,
    startedAt: input.startedAt,
    completedAt: input.completedAt
  });
  return { review, attestation };
}

export function runTrustedDeterministicGateWithoutLlm(input: TrustedRunnerDeterministicGateInput): RunnerDeterministicGateResult {
  const result = runTrustedReview({
    ...input,
    modelDigest: REVIEW_ACTION_NO_LLM_MODEL_DIGEST
  });
  return {
    ...result,
    deterministicGate: {
      schemaVersion: "archcontext.review-action-deterministic-gate/v1",
      llmProviderConfigured: false,
      modelDigest: REVIEW_ACTION_NO_LLM_MODEL_DIGEST,
      result: result.review.result,
      reviewDigest: result.review.extensions.digest
    }
  };
}

export function createReviewActionLlmAdvisory(input: ReviewActionLlmAdvisoryInput): ReviewActionLlmAdvisory {
  assertNoLlmAdvisoryConclusionFields(input.advisory);
  return {
    schemaVersion: "archcontext.review-action-llm-advisory/v1",
    advisoryDigest: digestJson({
      schemaVersion: "archcontext.review-action-llm-advisory-material/v1",
      provider: input.provider,
      generatedAt: input.generatedAt,
      deterministicReviewDigest: input.deterministicGate.reviewDigest,
      advisory: input.advisory
    } as unknown as Json),
    allowedUses: [
      "architecture-thesis",
      "refactor-explanation",
      "proof-point-suggestions",
      "human-readable-repair-steps"
    ],
    deterministicResult: input.deterministicGate.result,
    deterministicReviewDigest: input.deterministicGate.reviewDigest,
    generatedAt: input.generatedAt,
    influencesConclusion: false,
    persistedToCloud: false,
    provider: input.provider
  };
}

export function runnerPrivateKeySecretRef(input: { installationId: number; publicKeyId: string }): string {
  const installationId = requirePositiveInteger(input.installationId, "installationId");
  const publicKeyId = requireCredentialSegment(input.publicKeyId, "publicKeyId");
  return `keychain://archcontext/runner/${installationId}/${publicKeyId}`;
}

export function createRunnerPrivateKeySource(input: { keyRef: string; publicKeyId: string }): RunnerPrivateKeySource {
  assertRunnerPrivateKeySecretRef(input.keyRef);
  return {
    schemaVersion: "archcontext.runner-private-key-source/v1",
    keyRef: input.keyRef,
    publicKeyId: requireCredentialSegment(input.publicKeyId, "publicKeyId")
  };
}

export function assertRunnerPrivateKeySecretRef(ref: string): void {
  if (!/^keychain:\/\/archcontext\/runner\/[1-9]\d*\/[A-Za-z0-9._-]+$/.test(ref)) {
    throw new Error("runner-private-key-secret-ref-required");
  }
}

export function assertNoRunnerPrivateKeyMaterial(value: unknown): void {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (!serialized) return;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(serialized)) throw new Error("runner-private-key-material-forbidden");
  if (/(^|["'\s])(?:file:\/\/|\/|\.\/|\.\.\/|~\/)[^"'\s]*(?:private|runner|key)[^"'\s]*/i.test(serialized)) {
    throw new Error("runner-private-key-file-ref-forbidden");
  }
  const forbiddenKey = collectKeys(value).find((key) => RUNNER_PRIVATE_KEY_FORBIDDEN_SURFACE_KEYS.has(key));
  if (forbiddenKey) throw new Error(`runner-private-key-surface-field-forbidden: ${forbiddenKey}`);
}

export function readRunnerPrivateKeyFromSecretStore(source: RunnerPrivateKeySource, secretStore: RunnerPrivateKeySecretStore): KeyObject {
  assertNoRunnerPrivateKeyMaterial(source);
  assertRunnerPrivateKeySecretRef(source.keyRef);
  const pem = secretStore.readSecret(source.keyRef);
  if (!pem) throw new Error("runner-private-key-not-found");
  assertNoRunnerPrivateKeyMaterial({ keyRef: source.keyRef });
  const privateKey = createPrivateKey(pem);
  if (privateKey.type !== "private") throw new Error("runner-private-key-private-key-required");
  return privateKey;
}

export function buildRunnerUploadPayload(attestation: AttestationV2) {
  return {
    schemaVersion: attestation.schemaVersion,
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
    ...("errorCode" in attestation ? { errorCode: attestation.errorCode } : {}),
    execution: attestation.execution,
    runtime: attestation.runtime,
    nonce: attestation.nonce,
    startedAt: attestation.startedAt,
    completedAt: attestation.completedAt,
    expiresAt: attestation.expiresAt,
    signature: attestation.signature,
    digest: attestationV2Digest(attestation)
  };
}

export function runnerPrivacyAudit(payload: unknown): { ok: boolean; forbiddenKeys: string[] } {
  const forbidden = new Set(["findings", "review", "patch", "fileBody", "modelBody"]);
  const keys = collectKeys(payload);
  const forbiddenKeys = keys.filter((key) => forbidden.has(key));
  return { ok: forbiddenKeys.length === 0, forbiddenKeys };
}

function collectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [key, ...collectKeys(child)]);
}

const RUNNER_PRIVATE_KEY_FORBIDDEN_SURFACE_KEYS = new Set([
  "privateKey",
  "privateKeyPem",
  "privateKeyPath",
  "keyPem",
  "keyPath",
  "pem",
  "secretValue"
]);

function requirePositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new Error(`runner-private-key-input-invalid: ${path}`);
  return value;
}

function requireCredentialSegment(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]+$/.test(value)) throw new Error(`runner-private-key-input-invalid: ${path}`);
  return value;
}

function completeTaskInput(input: TrustedRunnerReviewInput): CompleteTaskInput {
  return {
    taskSessionId: input.taskSessionId,
    posture: input.posture,
    headSha: input.headSha,
    currentHeadSha: input.currentHeadSha,
    worktreeDigest: input.worktreeDigest,
    modelDigest: input.modelDigest,
    codeFactsDigest: input.codeFactsDigest,
    ...(input.compatibilityContract === undefined ? {} : { compatibilityContract: input.compatibilityContract }),
    ...(input.compatibilityPathIntroduced === undefined ? {} : { compatibilityPathIntroduced: input.compatibilityPathIntroduced }),
    ...(input.cleanupRequired === undefined ? {} : { cleanupRequired: input.cleanupRequired }),
    ...(input.cleanupCompleted === undefined ? {} : { cleanupCompleted: input.cleanupCompleted })
  };
}

function attestationResultFromReviewResult(result: ReturnType<typeof completeTaskGate>["result"]): AttestationResult {
  return result === "fail_action_required" ? "fail" : "pass";
}

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function readGitHubOriginRepository(root: string): string | null {
  try {
    const remote = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return parseGitHubRepository(remote);
  } catch {
    return null;
  }
}

function parseGitHubRepository(remote: string): string | null {
  const normalized = remote.replace(/\.git$/, "");
  const https = normalized.match(/^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)$/);
  if (https) return https[1];
  const ssh = normalized.match(/^git@github\.com:([^/\s]+\/[^/\s]+)$/);
  if (ssh) return ssh[1];
  return null;
}

function normalizeRepository(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.toLowerCase();
}
