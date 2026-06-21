#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createReviewChallengeV2 } from "@archcontext/cloud/attestation";
import { DevicePrivateKeyStore, InMemoryCredentialSecretStore, KeychainTokenStore } from "@archcontext/cloud/control-plane-client";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { runCli } from "../packages/surfaces/cli/src/main";

const DEFAULT_OUTPUT = "docs/verification/fg3-developer-review-process-e2e.json";

if (import.meta.main) {
  const [command = "run", ...args] = process.argv.slice(2);
  if (command !== "run") {
    console.error("[fg3-developer-review-process-e2e] usage: run [--out path] [--json]");
    process.exit(2);
  }
  const config = buildFg3DeveloperReviewProcessE2EConfig(args);
  const result = await runFg3DeveloperReviewProcessE2E(config);
  process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
  if (!result.ok) process.exit(1);
}

export function buildFg3DeveloperReviewProcessE2EConfig(args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? process.cwd(),
    outputPath: readFlag(args, "--out") ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    now: () => new Date().toISOString()
  };
}

export async function runFg3DeveloperReviewProcessE2E(config: ReturnType<typeof buildFg3DeveloperReviewProcessE2EConfig>) {
  const failures: string[] = [];
  const generatedAt = config.now();
  const workspace = mkdtempSync(join(tmpdir(), "archctx-fg3-review-process-"));
  const repo = join(workspace, "repo");
  const provider = new MockCodeGraphProvider();
  const credentials = new InMemoryCredentialSecretStore();
  const devicePrivateKeyStore = new DevicePrivateKeyStore(credentials);
  const tokenStore = new KeychainTokenStore();
  const submissions: unknown[] = [];
  try {
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, "README.md"), "# FG3 process fixture\n", "utf8");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "index.ts"), "export const answer = 42;\n", "utf8");
    initializeArchContextModel(repo, "FG3 Process E2E");
    git(repo, "init");
    git(repo, "add", ".");
    git(repo, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture");
    const headSha = gitOut(repo, "rev-parse", "HEAD");
    const headTreeOid = gitOut(repo, "rev-parse", "HEAD^{tree}");
    writeFileSync(join(repo, "README.md"), "# FG3 process fixture dirty source checkout\n", "utf8");
    const sourceRootDirty = !gitSucceeds(repo, "diff", "--quiet", "--", "README.md");
    const challenge = createReviewChallengeV2({
      challengeId: "chal_fg3_process_e2e",
      installationId: 10001,
      repositoryId: 20002,
      pullRequestNumber: 42,
      headSha,
      baseSha: headSha,
      nonce: "nonce_fg3_process_e2e_secret",
      requiredTrust: "developer",
      policyProfileId: "policy.default",
      createdAt: "2026-06-20T09:00:00Z",
      expiresAt: "2026-06-20T09:15:00Z"
    });
    const deps = {
      codeFacts: new CodeGraphAdapter(provider),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      devicePrivateKeyStore,
      tokenStore,
      githubGovernancePort: {
        async getPullHeadMetadata(input: { installationId: number; repositoryId: number; pullRequestNumber: number }) {
          return { ...input, headSha, baseSha: headSha };
        }
      },
      githubReviewSubmissionPort: {
        async submitDeveloperReview(input: unknown) {
          submissions.push(input);
          const record = input as { attestationDigest?: string };
          return {
            accepted: true,
            delivery: "process-fixture",
            attestationDigest: String(record.attestationDigest ?? "")
          };
        }
      }
    };

    const connect = await runCli("github", [
      "connect",
      "--account-id", "acct_process",
      "--github-user-id", "process-user",
      "--public-key-id", "key_process",
      "--verifier", "fixed-process-verifier",
      "--now", "2026-06-20T08:59:00Z"
    ], repo, deps);
    if (!connect.ok) failures.push("github connect failed");

    const review = await runCli("github", [
      "review",
      "submit",
      "--challenge-json", JSON.stringify(challenge),
      "--now", "2026-06-20T09:02:00Z",
      "--started-at", "2026-06-20T09:01:00Z",
      "--completed-at", "2026-06-20T09:02:00Z"
    ], repo, deps);
    if (!review.ok) failures.push("github review submit failed");

    const reviewData = review.data as {
      status?: string;
      review?: {
        result?: string;
        attestationResult?: string;
        reviewDigest?: string;
        worktreeDigest?: string;
      };
      attestationDigest?: string;
      cleanup?: {
        cleaned?: boolean;
      };
      statePath?: string;
      submission?: {
        accepted?: boolean;
      };
    };
    const outputJson = JSON.stringify(review);
    const indexedRoot = provider.indexedRoots[0];
    const statePath = String(reviewData.statePath ?? "");
    const state = statePath ? JSON.parse(readFileSync(statePath, "utf8")) as {
      attestation?: {
        headSha?: string;
        headTreeOid?: string;
        signature?: { value?: string };
      };
    } : {};
    const signatureValue = state.attestation?.signature?.value ?? "";
    const stateJson = JSON.stringify(state);

    if (reviewData.status !== "submitted") failures.push("review status must be submitted");
    if (reviewData.review?.result !== "pass") failures.push("review result must be pass");
    if (reviewData.review?.attestationResult !== "pass") failures.push("attestation result must be pass");
    if (!reviewData.cleanup?.cleaned) failures.push("cleanup must be cleaned");
    if (submissions.length !== 1) failures.push("submission port must be called once");
    if (!sourceRootDirty) failures.push("source checkout must be dirty to prove detached worktree isolation");
    if (!indexedRoot) failures.push("CodeGraph provider must index a detached worktree");
    if (indexedRoot && resolve(indexedRoot) === resolve(repo)) failures.push("CodeGraph indexed source repo instead of temporary worktree");
    if (indexedRoot && existsSync(indexedRoot)) failures.push("temporary indexed worktree must be removed after cleanup");
    if (state.attestation?.headSha !== headSha) failures.push("attestation headSha must match exact git head");
    if (state.attestation?.headTreeOid !== headTreeOid) failures.push("attestation headTreeOid must match exact git tree");
    if (outputJson.includes(challenge.nonce)) failures.push("CLI output leaked Challenge nonce");
    if (signatureValue && outputJson.includes(signatureValue)) failures.push("CLI output leaked Attestation signature");
    if (outputJson.includes("keychain://")) failures.push("CLI output leaked keychain ref");
    if (outputJson.includes("fixed-process-verifier")) failures.push("CLI output leaked PKCE verifier");
    if (stateJson.includes("PRIVATE KEY")) failures.push("state leaked private key material");

    const result = {
      schemaVersion: "archcontext.fg3-developer-review-process-e2e/v1",
      environment: "process-fixture",
      status: failures.length === 0 ? "verified" : "failed",
      ok: failures.length === 0,
      generatedAt,
      evidence: {
        processLevelFixture: true,
        challengeId: challenge.challengeId,
        pullRequestNumber: challenge.pullRequestNumber,
        sourceRootDirty,
        observedHeadSha: headSha,
        observedHeadTreeOid: headTreeOid,
        attestationHeadMatches: state.attestation?.headSha === headSha,
        attestationTreeMatches: state.attestation?.headTreeOid === headTreeOid,
        reviewResult: reviewData.review?.result ?? "",
        attestationResult: reviewData.review?.attestationResult ?? "",
        reviewDigestPrefix: String(reviewData.review?.reviewDigest ?? "").slice(0, 19),
        worktreeDigestPrefix: String(reviewData.review?.worktreeDigest ?? "").slice(0, 19),
        attestationDigestPrefix: String(reviewData.attestationDigest ?? "").slice(0, 19),
        codeGraphIndexedTemporaryWorktree: Boolean(indexedRoot && resolve(indexedRoot) !== resolve(repo)),
        temporaryWorktreeRemovedAfterCleanup: Boolean(indexedRoot && !existsSync(indexedRoot)),
        cleanupCleaned: reviewData.cleanup?.cleaned === true,
        submissionAccepted: reviewData.submission?.accepted === true,
        outputNonceLeaks: outputJson.includes(challenge.nonce) ? 1 : 0,
        outputSignatureLeaks: signatureValue && outputJson.includes(signatureValue) ? 1 : 0,
        outputKeyRefLeaks: outputJson.includes("keychain://") ? 1 : 0,
        outputVerifierLeaks: outputJson.includes("fixed-process-verifier") ? 1 : 0,
        statePrivateMode: statePath && process.platform !== "win32" ? (statSync(statePath).mode & 0o777).toString(8) : "platform-default"
      },
      failures
    };
    inspectFg3DeveloperReviewProcessE2E(result).failures.forEach((failure) => failures.push(failure));
    result.status = failures.length === 0 ? "verified" : "failed";
    result.ok = failures.length === 0;
    result.failures = failures;
    await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
    await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    return result;
  } finally {
    rmSync(workspace, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
  }
}

export function inspectFg3DeveloperReviewProcessE2E(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const root = readRecord(recording);
  const evidence = readRecord(root.evidence);
  if (root.schemaVersion !== "archcontext.fg3-developer-review-process-e2e/v1") failures.push("schemaVersion mismatch");
  if (root.environment !== "process-fixture") failures.push("environment must be process-fixture");
  if (root.status !== "verified" || root.ok !== true) failures.push("status must be verified ok");
  if (evidence.processLevelFixture !== true) failures.push("evidence.processLevelFixture must be true");
  if (evidence.sourceRootDirty !== true) failures.push("evidence.sourceRootDirty must be true");
  if (evidence.attestationHeadMatches !== true) failures.push("evidence.attestationHeadMatches must be true");
  if (evidence.attestationTreeMatches !== true) failures.push("evidence.attestationTreeMatches must be true");
  if (evidence.reviewResult !== "pass") failures.push("evidence.reviewResult must be pass");
  if (evidence.attestationResult !== "pass") failures.push("evidence.attestationResult must be pass");
  if (evidence.codeGraphIndexedTemporaryWorktree !== true) failures.push("CodeGraph must index temporary worktree");
  if (evidence.temporaryWorktreeRemovedAfterCleanup !== true) failures.push("temporary worktree must be removed after cleanup");
  if (evidence.cleanupCleaned !== true) failures.push("cleanupCleaned must be true");
  if (evidence.submissionAccepted !== true) failures.push("submissionAccepted must be true");
  for (const key of ["outputNonceLeaks", "outputSignatureLeaks", "outputKeyRefLeaks", "outputVerifierLeaks"]) {
    if (Number(evidence[key] ?? 0) !== 0) failures.push(`${key} must be 0`);
  }
  if (typeof evidence.reviewDigestPrefix !== "string" || !evidence.reviewDigestPrefix.startsWith("sha256:")) failures.push("reviewDigestPrefix must be sha256");
  if (typeof evidence.worktreeDigestPrefix !== "string" || !evidence.worktreeDigestPrefix.startsWith("sha256:")) failures.push("worktreeDigestPrefix must be sha256");
  if (typeof evidence.attestationDigestPrefix !== "string" || !evidence.attestationDigestPrefix.startsWith("sha256:")) failures.push("attestationDigestPrefix must be sha256");
  if (process.platform !== "win32" && evidence.statePrivateMode !== "600") failures.push("statePrivateMode must be 600");
  const serialized = JSON.stringify(recording);
  if (/nonce_[A-Za-z0-9_-]*secret/i.test(serialized)) failures.push("recording contains forbidden nonce marker");
  if (/keychain:\/\//i.test(serialized)) failures.push("recording contains forbidden keychain ref");
  if (/fixed-process-verifier/i.test(serialized)) failures.push("recording contains forbidden verifier");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(serialized)) failures.push("recording contains private key material");
  return { ok: failures.length === 0, failures };
}

function git(repo: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
}

function gitOut(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitSucceeds(repo: string, ...args: string[]): boolean {
  try {
    git(repo, ...args);
    return true;
  } catch {
    return false;
  }
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function renderHuman(result: Awaited<ReturnType<typeof runFg3DeveloperReviewProcessE2E>>): string {
  return result.ok
    ? `[fg3-developer-review-process-e2e] OK ${result.evidence.reviewDigestPrefix}`
    : `[fg3-developer-review-process-e2e] FAILED ${result.failures.join("; ")}`;
}
