#!/usr/bin/env bun
import { generateKeyPairSync, createPublicKey, type KeyObject } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createReviewChallengeV2,
  publicKeyFingerprint,
  verifyAttestationV2ForReviewChallenge
} from "@archcontext/cloud/attestation";
import {
  buildRunnerUploadPayload,
  createReviewActionAttestationRuntime,
  createReviewActionPreflightPlan,
  createRunnerPrivateKeySource,
  runnerPrivateKeySecretRef,
  runnerPrivacyAudit,
  runTrustedDeterministicGateWithoutLlm
} from "@archcontext/cloud/runner";
import {
  ARCHCONTEXT_PRODUCT_VERSION,
  digestJson,
  type GovernanceKeyStatus,
  type RunnerIdentity
} from "@archcontext/contracts";

if (import.meta.main) {
  const [command = "create", ...args] = process.argv.slice(2);
  if (command !== "create") {
    console.error("[fg4-github-hosted-runner-attestation] usage: create --out path");
    process.exit(2);
  }
  const result = await createFg4GithubHostedRunnerAttestation({
    env: process.env,
    outputPath: readFlag(args, "--out") ?? process.env.FG4_EG1_OUTPUT_PATH ?? "fg4-eg1-organization-attestation.json"
  });
  process.stdout.write(`${JSON.stringify({
    ok: result.ok,
    attestationDigest: result.evidence.attestationDigest,
    reviewDigest: result.evidence.deterministicGate.reviewDigest,
    llmProviderConfigured: result.evidence.deterministicGate.llmProviderConfigured
  }, null, 2)}\n`);
  if (!result.ok) process.exit(1);
}

export async function createFg4GithubHostedRunnerAttestation(input: { env: NodeJS.ProcessEnv; outputPath: string }) {
  const generatedAt = input.env.FG4_EG1_GENERATED_AT ?? new Date().toISOString();
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const installationId = parsePositiveInteger(readEnv(input.env, "FG4_EG1_INSTALLATION_ID"), "installationId");
  const repositoryId = parsePositiveInteger(readEnv(input.env, "FG4_EG1_REPOSITORY_ID"), "repositoryId");
  const pullRequestNumber = parsePositiveInteger(readEnv(input.env, "FG4_EG1_PULL_REQUEST_NUMBER"), "pullRequestNumber");
  const headSha = readEnv(input.env, "FG4_EG1_HEAD_SHA");
  const baseSha = readEnv(input.env, "FG4_EG1_BASE_SHA");
  const headTreeOid = readEnv(input.env, "FG4_EG1_HEAD_TREE_OID");
  const workflowRef = readEnv(input.env, "FG4_EG1_WORKFLOW_REF");
  const runId = readEnv(input.env, "GITHUB_RUN_ID");
  const runAttempt = parsePositiveInteger(input.env.GITHUB_RUN_ATTEMPT ?? "1", "runAttempt");
  const runtimeArtifactUrl = input.env.FG4_EG1_RUNTIME_ARTIFACT_URL ?? "https://archcontext.repoharness.com/releases/archctx-0.1.0.tgz";
  const runtimeArtifactDigest = readEnv(input.env, "FG4_EG1_RUNTIME_ARTIFACT_DIGEST");
  const challenge = createReviewChallengeV2({
    challengeId: `chal_fg4_eg1_${runId}_${runAttempt}`,
    installationId,
    repositoryId,
    pullRequestNumber,
    headSha,
    baseSha,
    nonce: `nonce_fg4_eg1_${runId}_${runAttempt}`,
    requiredTrust: "organization",
    policyProfileId: "fg4-eg1-github-hosted-runner",
    createdAt: generatedAt,
    expiresAt: new Date(Date.parse(generatedAt) + 10 * 60 * 1000).toISOString(),
    status: "LEASED"
  });
  const publicKeyId = `fg4_eg1_${runId}_${runAttempt}`;
  const runner: RunnerIdentity = {
    schemaVersion: "archcontext.runner-identity/v1",
    runnerId: `runner_fg4_eg1_${runId}_${runAttempt}`,
    installationId,
    repositoryIds: [repositoryId],
    scope: { kind: "repository", repositoryIds: [repositoryId] },
    workflowRef,
    publicKeyId,
    publicKeyFingerprint: publicKeyFingerprint(publicKey),
    status: "active",
    createdAt: generatedAt,
    rotatedAt: null,
    revokedAt: null
  };
  const keyRef = runnerPrivateKeySecretRef({ installationId, publicKeyId });
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const privateKeySource = createRunnerPrivateKeySource({ keyRef, publicKeyId });
  const secretStore = new InMemoryRunnerSecretStore([[keyRef, privateKeyPem]]);
  const pin = createReviewActionPreflightPlan({
    runtimeVersion: ARCHCONTEXT_PRODUCT_VERSION,
    runtimeArtifactDigest,
    runtimeArtifactUrl
  });
  if (!pin.ok) throw new Error(`runtime-pin-invalid: ${pin.reason}`);
  const runtime = createReviewActionAttestationRuntime({
    plan: pin.plan,
    codeGraphVersion: "1.0.1",
    capabilitiesDigest: digestJson({ schemaVersion: "archcontext.fg4-eg1-capabilities/v1", workflowRef })
  });
  const metadataDigest = digestJson({
    schemaVersion: "archcontext.fg4-eg1-worktree-metadata/v1",
    repositoryId,
    pullRequestNumber,
    headSha,
    baseSha,
    headTreeOid,
    runId,
    runAttempt
  });
  const result = runTrustedDeterministicGateWithoutLlm({
    taskSessionId: `fg4-eg1-pr-${pullRequestNumber}`,
    posture: "normal",
    headSha,
    currentHeadSha: headSha,
    worktreeDigest: metadataDigest,
    codeFactsDigest: digestJson({ schemaVersion: "archcontext.fg4-eg1-codefacts/v1", headSha, headTreeOid }),
    policyDigest: digestJson({ schemaVersion: "archcontext.fg4-eg1-policy/v1", requiredTrust: "organization" }),
    challenge,
    runner,
    privateKeySource,
    secretStore,
    mergeBaseSha: baseSha,
    headTreeOid,
    runtime,
    workflowRef,
    runId,
    runAttempt,
    startedAt: generatedAt,
    completedAt: generatedAt
  });
  const runnerKeyStatus = runnerIdentityKeyStatus(runner);
  const verification = verifyAttestationV2ForReviewChallenge({
    challenge,
    attestation: result.attestation,
    publicKey,
    runnerIdentity: runner,
    signingKeyStatus: runnerKeyStatus,
    now: generatedAt,
    expectedHeadTreeOid: headTreeOid
  });
  const uploadPayload = buildRunnerUploadPayload(result.attestation);
  const privacyAudit = runnerPrivacyAudit(uploadPayload);
  const artifact = {
    schemaVersion: "archcontext.fg4-github-hosted-runner-attestation/v1",
    environment: "github-actions",
    status: verification.accepted && privacyAudit.ok ? "verified" : "failed",
    ok: verification.accepted && privacyAudit.ok,
    generatedAt,
    workflow: {
      repository: input.env.GITHUB_REPOSITORY ?? "",
      workflow: input.env.GITHUB_WORKFLOW ?? "",
      workflowRef,
      runId,
      runAttempt,
      runnerOs: input.env.RUNNER_OS ?? "",
      runnerName: input.env.RUNNER_NAME ?? ""
    },
    evidence: {
      challenge,
      runnerIdentity: runner,
      runnerKeyStatus,
      publicKeyJwk: publicKey.export({ format: "jwk" }),
      deterministicGate: result.deterministicGate,
      attestation: result.attestation,
      attestationDigest: uploadPayload.digest,
      uploadPayload,
      privacyAudit,
      verification
    }
  };
  assertNoPrivateKeyLeak(artifact);
  await mkdir(dirname(resolve(input.outputPath)), { recursive: true });
  await writeFile(resolve(input.outputPath), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

export function publicKeyFromJwk(jwk: JsonWebKey): KeyObject {
  return createPublicKey({ key: jwk, format: "jwk" });
}

function runnerIdentityKeyStatus(runner: RunnerIdentity): GovernanceKeyStatus {
  return {
    schemaVersion: "archcontext.governance-key-status/v1",
    publicKeyId: runner.publicKeyId,
    ownerKind: "runner",
    ownerId: runner.runnerId,
    fingerprint: runner.publicKeyFingerprint,
    status: runner.status,
    createdAt: runner.createdAt,
    rotatedAt: runner.rotatedAt ?? null,
    revokedAt: runner.revokedAt ?? null
  };
}

class InMemoryRunnerSecretStore {
  private readonly secrets: Map<string, string>;

  constructor(entries: [string, string][]) {
    this.secrets = new Map(entries);
  }

  readSecret(ref: string): string | undefined {
    return this.secrets.get(ref);
  }
}

function assertNoPrivateKeyLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (/-----BEGIN/i.test(serialized) || /private[_-]?key/i.test(serialized) || /secretStore/i.test(serialized) || /keychain:\/\//i.test(serialized)) {
    throw new Error("fg4-eg1-attestation-private-key-leak");
  }
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key}-required`);
  return value;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label}-invalid`);
  return parsed;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
