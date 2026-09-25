import { type DetachedReviewWorktree } from "@archcontext/local-runtime/git-adapter";
import { type DeveloperReviewRunCleanupRequest, type DeveloperReviewRunManifest } from "./index";
import { type ReviewChallengeV2 } from "@archcontext/contracts";

function rpcInputInvalid(context: string, detail: string): Error {
  return new Error(`runtime-rpc-input-invalid: ${context} ${detail}`);
}

function decodeRpcRecord(value: unknown, context: string, label: string, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw rpcInputInvalid(context, `${label} must be an object`);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) throw rpcInputInvalid(context, `${label} has unknown field ${key}`);
  }
  return record;
}

function rpcString(record: Record<string, unknown>, context: string, label: string): string {
  const value = record[label];
  if (typeof value !== "string" || value.length === 0) throw rpcInputInvalid(context, `${label} must be a non-empty string`);
  return value;
}

function rpcOptionalString(record: Record<string, unknown>, context: string, label: string): string | undefined {
  return record[label] === undefined ? undefined : rpcString(record, context, label);
}

function rpcNumber(record: Record<string, unknown>, context: string, label: string): number {
  const value = record[label];
  if (typeof value !== "number" || !Number.isFinite(value)) throw rpcInputInvalid(context, `${label} must be a number`);
  return value;
}

function rpcLiteral<T extends string>(record: Record<string, unknown>, context: string, label: string, allowed: readonly T[]): T {
  const value = record[label];
  if (typeof value !== "string" || !allowed.includes(value as T)) throw rpcInputInvalid(context, `${label} is not an accepted value`);
  return value as T;
}

function decodeRpcReviewChallengeV2(value: unknown, context: string): ReviewChallengeV2 {
  const record = decodeRpcRecord(value, context, "challenge", [
    "schemaVersion", "challengeId", "installationId", "repositoryId", "pullRequestNumber",
    "headSha", "baseSha", "nonce", "requiredTrust", "policyProfileId", "createdAt", "expiresAt", "status"
  ]);
  return {
    schemaVersion: rpcLiteral(record, context, "schemaVersion", ["archcontext.review-challenge/v2"] as const),
    challengeId: rpcString(record, context, "challengeId"),
    installationId: rpcNumber(record, context, "installationId"),
    repositoryId: rpcNumber(record, context, "repositoryId"),
    pullRequestNumber: rpcNumber(record, context, "pullRequestNumber"),
    headSha: rpcString(record, context, "headSha"),
    baseSha: rpcString(record, context, "baseSha"),
    nonce: rpcString(record, context, "nonce"),
    requiredTrust: rpcLiteral(record, context, "requiredTrust", ["developer", "organization"] as const),
    policyProfileId: rpcString(record, context, "policyProfileId"),
    createdAt: rpcString(record, context, "createdAt"),
    expiresAt: rpcString(record, context, "expiresAt"),
    status: rpcLiteral(record, context, "status", ["PENDING", "LEASED", "SUBMITTED", "VERIFIED", "REJECTED", "SUPERSEDED", "EXPIRED"] as const)
  };
}

function decodeRpcDetachedReviewWorktree(value: unknown, context: string, label = "worktree"): DetachedReviewWorktree {
  const record = decodeRpcRecord(value, context, label, [
    "schemaVersion", "sourceRoot", "worktreeRoot", "temporaryRoot", "headSha", "headTreeOid", "detached", "clean"
  ]);
  if (record.detached !== true) throw rpcInputInvalid(context, `${label}.detached must be true`);
  if (record.clean !== true) throw rpcInputInvalid(context, `${label}.clean must be true`);
  return {
    schemaVersion: rpcLiteral(record, context, "schemaVersion", ["archcontext.detached-review-worktree/v1"] as const),
    sourceRoot: rpcString(record, context, "sourceRoot"),
    worktreeRoot: rpcString(record, context, "worktreeRoot"),
    temporaryRoot: rpcString(record, context, "temporaryRoot"),
    headSha: rpcString(record, context, "headSha"),
    headTreeOid: rpcString(record, context, "headTreeOid"),
    detached: true,
    clean: true
  };
}

export function decodeDeveloperReviewRunManifest(value: unknown, context: string): DeveloperReviewRunManifest {
  const record = decodeRpcRecord(value, context, "run", [
    "schemaVersion", "runId", "challengeId", "repositoryId", "sourceRoot", "runRoot", "worktreeTempRoot",
    "manifestPath", "lockPath", "pid", "createdAt", "status", "codeGraphTemporaryState", "worktree"
  ]);
  const codeGraphTemporaryState = decodeRpcRecord(record.codeGraphTemporaryState, context, "run.codeGraphTemporaryState", ["root", "cleanup"]);
  return {
    schemaVersion: rpcLiteral(record, context, "schemaVersion", ["archcontext.developer-review-run/v1"] as const),
    runId: rpcString(record, context, "runId"),
    challengeId: rpcString(record, context, "challengeId"),
    repositoryId: rpcNumber(record, context, "repositoryId"),
    sourceRoot: rpcString(record, context, "sourceRoot"),
    runRoot: rpcString(record, context, "runRoot"),
    worktreeTempRoot: rpcString(record, context, "worktreeTempRoot"),
    manifestPath: rpcString(record, context, "manifestPath"),
    lockPath: rpcString(record, context, "lockPath"),
    pid: rpcNumber(record, context, "pid"),
    createdAt: rpcString(record, context, "createdAt"),
    status: rpcLiteral(record, context, "status", ["preparing", "running"] as const),
    codeGraphTemporaryState: {
      root: rpcString(codeGraphTemporaryState, context, "root"),
      cleanup: rpcLiteral(codeGraphTemporaryState, context, "cleanup", ["remove-run-root"] as const)
    },
    ...(record.worktree === undefined ? {} : { worktree: decodeRpcDetachedReviewWorktree(record.worktree, context, "run.worktree") })
  };
}

export function decodeDeveloperReviewRunCleanupRequest(value: unknown): DeveloperReviewRunCleanupRequest {
  const context = "cleanupDeveloperReviewRun";
  const record = decodeRpcRecord(value, context, "params[0]", ["repositoryRoot", "challengeId", "runId"]);
  return {
    repositoryRoot: rpcString(record, context, "repositoryRoot"),
    challengeId: rpcString(record, context, "challengeId"),
    runId: rpcString(record, context, "runId")
  };
}

export function decodeStartDeveloperReviewRunParams(params: unknown[]): {
  repositoryRoot: string;
  challenge: ReviewChallengeV2;
  expectedHeadTreeOid?: string;
} {
  const context = "startDeveloperReviewRun";
  const record = decodeRpcRecord(params[0], context, "params[0]", ["repositoryRoot", "challenge", "expectedHeadTreeOid"]);
  const expectedHeadTreeOid = rpcOptionalString(record, context, "expectedHeadTreeOid");
  return {
    repositoryRoot: rpcString(record, context, "repositoryRoot"),
    challenge: decodeRpcReviewChallengeV2(record.challenge, context),
    ...(expectedHeadTreeOid === undefined ? {} : { expectedHeadTreeOid })
  };
}

export function decodeSignedDeveloperReviewAttestationParams(params: unknown[]): {
  challenge: ReviewChallengeV2;
  worktree: DetachedReviewWorktree;
  keyRef: string;
  principalId: string;
  publicKeyId: string;
  taskSessionId?: string;
  mergeBaseSha?: string;
  startedAt?: string;
  completedAt?: string;
} {
  const context = "runSignedDeveloperReviewAttestation";
  const record = decodeRpcRecord(params[0], context, "params[0]", [
    "challenge", "worktree", "keyRef", "principalId", "publicKeyId", "taskSessionId", "mergeBaseSha", "startedAt", "completedAt"
  ]);
  const optional = {
    taskSessionId: rpcOptionalString(record, context, "taskSessionId"),
    mergeBaseSha: rpcOptionalString(record, context, "mergeBaseSha"),
    startedAt: rpcOptionalString(record, context, "startedAt"),
    completedAt: rpcOptionalString(record, context, "completedAt")
  };
  return {
    challenge: decodeRpcReviewChallengeV2(record.challenge, context),
    worktree: decodeRpcDetachedReviewWorktree(record.worktree, context),
    keyRef: rpcString(record, context, "keyRef"),
    principalId: rpcString(record, context, "principalId"),
    publicKeyId: rpcString(record, context, "publicKeyId"),
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined))
  };
}

export function decodeRecoverDeveloperReviewRunsParams(params: unknown[]): { repositoryRoot: string; force?: boolean } {
  const context = "recoverDeveloperReviewRuns";
  const record = decodeRpcRecord(params[0], context, "params[0]", ["repositoryRoot", "force"]);
  if (record.force !== undefined && typeof record.force !== "boolean") throw rpcInputInvalid(context, "force must be a boolean");
  return {
    repositoryRoot: rpcString(record, context, "repositoryRoot"),
    ...(record.force === undefined ? {} : { force: record.force })
  };
}
