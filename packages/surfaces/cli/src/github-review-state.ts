import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { digestJson, validateJsonSchema, type Json, type ReviewChallengeV2 } from "@archcontext/contracts";
import { runtimeStatePaths } from "@archcontext/local-runtime/runtime-state-paths";

type GitHubDeveloperReviewStatus = "claimed" | "ran" | "ready_for_submit" | "submitted" | "cancelled" | "failed";

export interface GitHubDeveloperReviewState {
  schemaVersion: "archcontext.github-developer-review-state/v2";
  status: GitHubDeveloperReviewStatus;
  challenge: Omit<ReviewChallengeV2, "nonce">;
  challengeDigest: string;
  lease?: Json;
  review?: {
    reviewId: string;
    reviewDigest: string;
    result: string;
    attestationResult: string;
    worktreeDigest: string;
    modelDigest: string;
    codeFactsDigest: string;
  };
  attestationDigest?: string;
  /** Transient response for this invocation; only its digest is persisted. */
  submission?: Json;
  submissionDigest?: string;
  reasonCode?: string;
  updatedAt: string;
}

type StateMetadata = Omit<GitHubDeveloperReviewState, "submission">;
type Schema = Parameters<typeof validateJsonSchema>[0];
const text: Schema = { type: "string", minLength: 1 };
const digest: Schema = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const record = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: "object", additionalProperties: false, properties, required });
const stateSchema = record({
  schemaVersion: { const: "archcontext.github-developer-review-state/v2" },
  status: { enum: ["claimed", "ran", "ready_for_submit", "submitted", "cancelled", "failed"] },
  challenge: record({
    schemaVersion: { const: "archcontext.review-challenge/v2" },
    challengeId: text,
    installationId: { type: "integer", minimum: 1 },
    repositoryId: { type: "integer", minimum: 1 },
    pullRequestNumber: { type: "integer", minimum: 1 },
    headSha: text, baseSha: text, requiredTrust: text, policyProfileId: text,
    createdAt: text, expiresAt: text, status: text
  }),
  challengeDigest: digest,
  lease: record({ challengeId: text, ownerId: text, leasedAt: text, lastHeartbeatAt: text, expiresAt: text }, ["challengeId", "ownerId", "leasedAt", "expiresAt"]),
  review: record({ reviewId: text, reviewDigest: digest, result: text, attestationResult: text, worktreeDigest: digest, modelDigest: digest, codeFactsDigest: digest }),
  attestationDigest: digest,
  submissionDigest: digest,
  reasonCode: text,
  updatedAt: text
}, ["schemaVersion", "status", "challenge", "challengeDigest", "updatedAt"]);

export function defaultGithubDeveloperReviewStatePath(cwd: string, pullRequestNumber?: number): string {
  const suffix = pullRequestNumber ? `github-developer-review-pr-${pullRequestNumber}.json` : "github-developer-review.json";
  return join(runtimeStatePaths(cwd).workspaceStateDir, suffix);
}

function metadata(state: GitHubDeveloperReviewState): StateMetadata {
  const { submission, ...rest } = state;
  const challenge = state.challenge;
  return {
    ...rest,
    challenge: {
      schemaVersion: challenge.schemaVersion,
      challengeId: challenge.challengeId,
      installationId: challenge.installationId,
      repositoryId: challenge.repositoryId,
      pullRequestNumber: challenge.pullRequestNumber,
      headSha: challenge.headSha,
      baseSha: challenge.baseSha,
      requiredTrust: challenge.requiredTrust,
      policyProfileId: challenge.policyProfileId,
      createdAt: challenge.createdAt,
      expiresAt: challenge.expiresAt,
      status: challenge.status
    },
    ...(submission === undefined ? {} : { submissionDigest: digestJson(submission) })
  };
}

function assertMetadata(value: unknown): asserts value is StateMetadata {
  if (!validateJsonSchema(stateSchema, value as Json).valid) throw new Error("github-review-state-metadata-invalid");
  assertNoCliSecretMaterial(value);
}

function assertNoReviewSecrets(value: unknown, secrets: readonly string[], isKey = false): void {
  if (typeof value === "string") {
    // The challenge contract permits short nonces. They cannot identify arbitrary
    // substrings or field names reliably; still reject an exact echoed value.
    if (secrets.some(secret => secret.length >= 16 ? value.includes(secret) : !isKey && secret.length > 0 && value === secret)) throw new Error("github-review-secret-material-forbidden");
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (["nonce", "signature", "attestation"].includes(key)) throw new Error("github-review-secret-material-forbidden");
      assertNoReviewSecrets(key, secrets, true);
      assertNoReviewSecrets(child, secrets);
    }
  }
}

export async function writeGithubDeveloperReviewState(cwd: string, state: GitHubDeveloperReviewState, secrets: readonly string[] = []): Promise<{ state: GitHubDeveloperReviewState; path: string }> {
  const path = defaultGithubDeveloperReviewStatePath(cwd, state.challenge.pullRequestNumber);
  const persisted = metadata(state);
  const serialized = `${JSON.stringify(persisted, null, 2)}\n`;
  const validated: unknown = JSON.parse(serialized);
  assertMetadata(validated);
  assertNoReviewSecrets(validated, secrets);
  // A submission adapter may echo request material; reject it before either disk or output.
  if (state.submission !== undefined) {
    assertNoCliSecretMaterial(state.submission);
    assertNoReviewSecrets(state.submission, secrets);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serialized, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(path, 0o600);
  return { state: { ...validated, ...(state.submission === undefined ? {} : { submission: state.submission }) }, path };
}

export function readGithubDeveloperReviewState(path: string): StateMetadata | undefined {
  if (!existsSync(path)) return undefined;
  let parsed: any;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("github-review-state-metadata-invalid"); }
  if (parsed?.schemaVersion === "archcontext.github-developer-review-state/v1") {
    throw new Error("github-review-legacy-state-requires-discard: run archctx github review discard-legacy-state --pr <number>, then fetch a fresh challenge");
  }
  assertMetadata(parsed);
  return parsed;
}

export function discardLegacyGithubDeveloperReviewState(path: string): boolean {
  if (!existsSync(path)) return false;
  let parsed: any;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("github-review-state-metadata-invalid"); }
  if (parsed?.schemaVersion !== "archcontext.github-developer-review-state/v1") throw new Error("github-review-discard-requires-legacy-v1-state");
  rmSync(path);
  return true;
}

export function sanitizeGithubDeveloperReviewState(state: GitHubDeveloperReviewState, statePath: string) {
  const data = { ...state, statePath, ghCli: "not-used" };
  assertNoCliSecretMaterial(data);
  assertNoReviewSecrets(data, []);
  return data;
}
export function assertNoCliSecretMaterial(value: unknown): void {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (!serialized) return;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(serialized)) throw new Error("device-private-key-material-forbidden");
  if (/(^|["'\s])(?:file:\/\/|\/|\.\/|\.\.\/|~\/)[^"'\s]*(?:private|device|key)[^"'\s]*/i.test(serialized)) {
    throw new Error("device-private-key-file-ref-forbidden");
  }
  if (/(access|refresh|token)_[A-Za-z0-9_-]+/.test(serialized)) throw new Error("github-token-material-forbidden");
}
