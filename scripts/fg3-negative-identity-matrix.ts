#!/usr/bin/env bun
import { generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createReviewChallengeV2 } from "@archcontext/cloud/attestation";
import { DevicePrivateKeyStore, InMemoryCredentialSecretStore, KeychainTokenStore } from "@archcontext/cloud/control-plane-client";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { ArchctxDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { runCli } from "../packages/surfaces/cli/src/main";

const DEFAULT_OUTPUT = "docs/verification/fg3-negative-identity-matrix.json";

type CliClaimCase = {
  name: string;
  expectedReasonCode: string;
  observedReasonCode: string;
  rejected: boolean;
};

if (import.meta.main) {
  const [command = "run", ...args] = process.argv.slice(2);
  if (command !== "run") {
    console.error("[fg3-negative-identity-matrix] usage: run [--out path] [--json]");
    process.exit(2);
  }
  const config = buildFg3NegativeIdentityMatrixConfig(args);
  const result = await runFg3NegativeIdentityMatrix(config);
  process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
  if (!result.ok) process.exit(1);
}

export function buildFg3NegativeIdentityMatrixConfig(args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? process.cwd(),
    outputPath: readFlag(args, "--out") ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    now: () => new Date().toISOString()
  };
}

export async function runFg3NegativeIdentityMatrix(config: ReturnType<typeof buildFg3NegativeIdentityMatrixConfig>) {
  const failures: string[] = [];
  const generatedAt = config.now();
  const workspace = mkdtempSync(join(tmpdir(), "archctx-fg3-negative-identity-"));
  const repo = join(workspace, "repo");
  const cliProvider = new MockCodeGraphProvider();
  const runtimeProvider = new MockCodeGraphProvider();
  const credentials = new InMemoryCredentialSecretStore();
  const devicePrivateKeyStore = new DevicePrivateKeyStore(credentials);
  const tokenStore = new KeychainTokenStore();
  const keyPair = generateKeyPairSync("ed25519");
  let daemon: ArchctxDaemon | undefined;
  try {
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, "README.md"), "# FG3 negative identity matrix\n", "utf8");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "index.ts"), "export const identity = 'clean';\n", "utf8");
    initializeArchContextModel(repo, "FG3 Negative Identity Matrix");
    git(repo, "init");
    git(repo, "add", ".");
    git(repo, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture");
    const headSha = gitOut(repo, "rev-parse", "HEAD");
    const headTreeOid = gitOut(repo, "rev-parse", "HEAD^{tree}");
    writeFileSync(join(repo, "README.md"), "# FG3 negative identity matrix dirty source checkout\n", "utf8");
    const sourceRootDirty = !gitSucceeds(repo, "diff", "--quiet", "--", "README.md");
    const challenge = createReviewChallengeV2({
      challengeId: "chal_fg3_negative_identity",
      installationId: 10001,
      repositoryId: 20002,
      pullRequestNumber: 42,
      headSha,
      baseSha: headSha,
      nonce: "nonce_fg3_negative_identity_secret",
      requiredTrust: "developer",
      policyProfileId: "policy.default",
      createdAt: "2026-06-20T09:00:00Z",
      expiresAt: "2026-06-20T09:15:00Z"
    });
    const leasedChallenge = createReviewChallengeV2({ ...challenge, status: "LEASED" });
    const deps = {
      codeFacts: new CodeGraphAdapter(cliProvider),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      devicePrivateKeyStore,
      tokenStore,
      githubGovernancePort: {
        async getPullHeadMetadata(input: { installationId: number; repositoryId: number; pullRequestNumber: number }) {
          return { ...input, headSha, baseSha: headSha };
        }
      }
    };
    const connect = await runCli("github", [
      "connect",
      "--account-id", "acct_negative_identity",
      "--github-user-id", "negative-identity-user",
      "--public-key-id", "key_negative_identity",
      "--verifier", "fixed-negative-identity-verifier",
      "--now", "2026-06-20T08:59:00Z"
    ], repo, deps);
    if (!connect.ok) failures.push("github connect failed");

    const cliClaimCases: CliClaimCase[] = [];
    const rawCliOutputs: string[] = [];
    async function runClaimCase(input: {
      name: string;
      expectedReasonCode: string;
      pullHead: {
        installationId: number;
        repositoryId: number;
        pullRequestNumber: number;
        headSha: string;
        baseSha: string;
      };
    }) {
      const result = await runCli("github", [
        "review",
        "claim",
        "--challenge-json", JSON.stringify(challenge),
        "--now", "2026-06-20T09:01:00Z"
      ], repo, {
        ...deps,
        githubGovernancePort: {
          async getPullHeadMetadata() {
            return input.pullHead;
          }
        }
      });
      rawCliOutputs.push(JSON.stringify(result));
      const observedReasonCode = String((result.data as { reasonCode?: unknown } | undefined)?.reasonCode ?? "");
      const rejected = result.ok === true && (result.data as { status?: unknown } | undefined)?.status === "failed" && observedReasonCode === input.expectedReasonCode;
      cliClaimCases.push({
        name: input.name,
        expectedReasonCode: input.expectedReasonCode,
        observedReasonCode,
        rejected
      });
      if (!rejected) failures.push(`${input.name} claim did not reject with ${input.expectedReasonCode}`);
    }

    await runClaimCase({
      name: "wrong-repository",
      expectedReasonCode: "REPOSITORY_MISMATCH",
      pullHead: {
        installationId: challenge.installationId,
        repositoryId: challenge.repositoryId + 1,
        pullRequestNumber: challenge.pullRequestNumber,
        headSha,
        baseSha: headSha
      }
    });
    await runClaimCase({
      name: "wrong-head",
      expectedReasonCode: "HEAD_SHA_MISMATCH",
      pullHead: {
        installationId: challenge.installationId,
        repositoryId: challenge.repositoryId,
        pullRequestNumber: challenge.pullRequestNumber,
        headSha: "c".repeat(40),
        baseSha: headSha
      }
    });
    await runClaimCase({
      name: "wrong-base",
      expectedReasonCode: "BASE_SHA_MISMATCH",
      pullHead: {
        installationId: challenge.installationId,
        repositoryId: challenge.repositoryId,
        pullRequestNumber: challenge.pullRequestNumber,
        headSha,
        baseSha: "d".repeat(40)
      }
    });

    daemon = new ArchctxDaemon({
      codeFacts: new CodeGraphAdapter(runtimeProvider),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      devicePrivateKeySigner: {
        signWithDevicePrivateKey(input) {
          const payload = typeof input.payload === "string" ? input.payload : Buffer.from(input.payload).toString("utf8");
          return sign(null, Buffer.from(payload, "utf8"), keyPair.privateKey).toString("base64");
        }
      },
      clock: () => "2026-06-20T09:02:00.000Z"
    });
    await daemon.start();

    const wrongTree = daemon.startDeveloperReviewRun({
      repositoryRoot: repo,
      challenge: leasedChallenge,
      expectedHeadTreeOid: "0".repeat(40)
    });
    const wrongTreeRejected = wrongTree.accepted === false
      && wrongTree.reasonCode === "TREE_OID_MISMATCH"
      && wrongTree.run === undefined
      && wrongTree.cleanup?.cleaned === true;
    if (!wrongTreeRejected) failures.push("wrong-tree run did not reject with TREE_OID_MISMATCH");

    const dirtyRun = daemon.startDeveloperReviewRun({
      repositoryRoot: repo,
      challenge: leasedChallenge,
      expectedHeadTreeOid: headTreeOid
    });
    let dirtyReasonCode = "";
    let dirtyRejected = false;
    let dirtyCleanupCleaned = false;
    let dirtyWorktreeRemovedAfterCleanup = false;
    if (!dirtyRun.accepted || !dirtyRun.run) {
      failures.push("dirty-worktree setup failed before mutation");
    } else {
      writeFileSync(join(dirtyRun.run.worktree.worktreeRoot, "README.md"), "# dirty detached worktree\n", "utf8");
      try {
        await daemon.runSignedDeveloperReviewAttestation({
          challenge: leasedChallenge,
          worktree: dirtyRun.run.worktree,
          keyRef: "keychain://archcontext/device/acct_negative_identity/key_negative_identity",
          principalId: "negative-identity-user",
          publicKeyId: "key_negative_identity",
          taskSessionId: "task_fg3_negative_identity",
          startedAt: "2026-06-20T09:01:00Z",
          completedAt: "2026-06-20T09:02:00Z"
        });
        failures.push("dirty detached worktree was accepted");
      } catch (error) {
        dirtyReasonCode = reasonCodeFromError(error);
        dirtyRejected = dirtyReasonCode === "WORKTREE_NOT_CLEAN";
        if (!dirtyRejected) failures.push(`dirty detached worktree rejected with unexpected reason: ${dirtyReasonCode}`);
      } finally {
        const worktreeRoot = dirtyRun.run.worktree.worktreeRoot;
        const cleanup = daemon.cleanupDeveloperReviewRun(dirtyRun.run);
        dirtyCleanupCleaned = cleanup.cleaned;
        dirtyWorktreeRemovedAfterCleanup = !existsSync(worktreeRoot);
      }
    }
    if (!dirtyCleanupCleaned) failures.push("dirty-worktree cleanup was not clean");
    if (!dirtyWorktreeRemovedAfterCleanup) failures.push("dirty-worktree cleanup did not remove worktree");

    const serializedCliOutputs = rawCliOutputs.join("\n");
    const result = {
      schemaVersion: "archcontext.fg3-negative-identity-matrix/v1",
      environment: "process-fixture",
      status: failures.length === 0 ? "verified" : "failed",
      ok: failures.length === 0,
      generatedAt,
      evidence: {
        processLevelFixture: true,
        challengeId: challenge.challengeId,
        pullRequestNumber: challenge.pullRequestNumber,
        sourceRootDirty,
        cliClaimCases,
        cliClaimRuntimeNotStarted: cliProvider.indexedRoots.length === 0,
        wrongTree: {
          rejected: wrongTreeRejected,
          reasonCode: wrongTree.reasonCode ?? "",
          runStarted: Boolean(wrongTree.run),
          cleanupCleaned: wrongTree.cleanup?.cleaned === true
        },
        dirtyDetachedWorktree: {
          rejected: dirtyRejected,
          reasonCode: dirtyReasonCode,
          cleanupCleaned: dirtyCleanupCleaned,
          worktreeRemovedAfterCleanup: dirtyWorktreeRemovedAfterCleanup
        },
        allRejected: cliClaimCases.every((entry) => entry.rejected) && wrongTreeRejected && dirtyRejected,
        outputNonceLeaks: serializedCliOutputs.includes(challenge.nonce) ? 1 : 0,
        outputKeyRefLeaks: serializedCliOutputs.includes("keychain://") ? 1 : 0,
        outputVerifierLeaks: serializedCliOutputs.includes("fixed-negative-identity-verifier") ? 1 : 0
      },
      failures
    };
    inspectFg3NegativeIdentityMatrix(result).failures.forEach((failure) => failures.push(failure));
    result.status = failures.length === 0 ? "verified" : "failed";
    result.ok = failures.length === 0;
    result.failures = failures;
    await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
    await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    return result;
  } finally {
    await daemon?.stop().catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
  }
}

export function inspectFg3NegativeIdentityMatrix(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const root = readRecord(recording);
  const evidence = readRecord(root.evidence);
  if (root.schemaVersion !== "archcontext.fg3-negative-identity-matrix/v1") failures.push("schemaVersion mismatch");
  if (root.environment !== "process-fixture") failures.push("environment must be process-fixture");
  if (root.status !== "verified" || root.ok !== true) failures.push("status must be verified ok");
  if (evidence.processLevelFixture !== true) failures.push("evidence.processLevelFixture must be true");
  if (evidence.sourceRootDirty !== true) failures.push("evidence.sourceRootDirty must be true");
  const claimCases = Array.isArray(evidence.cliClaimCases) ? evidence.cliClaimCases.map(readRecord) : [];
  const byName = new Map(claimCases.map((entry) => [String(entry.name), entry]));
  for (const [name, reasonCode] of [
    ["wrong-repository", "REPOSITORY_MISMATCH"],
    ["wrong-head", "HEAD_SHA_MISMATCH"],
    ["wrong-base", "BASE_SHA_MISMATCH"]
  ] as const) {
    const entry = byName.get(name);
    if (!entry) {
      failures.push(`missing claim case: ${name}`);
      continue;
    }
    if (entry.rejected !== true) failures.push(`${name} must be rejected`);
    if (entry.expectedReasonCode !== reasonCode || entry.observedReasonCode !== reasonCode) {
      failures.push(`${name} must reject with ${reasonCode}`);
    }
  }
  if (evidence.cliClaimRuntimeNotStarted !== true) failures.push("CLI claim mismatch cases must not start runtime review");
  const wrongTree = readRecord(evidence.wrongTree);
  if (wrongTree.rejected !== true) failures.push("wrongTree must be rejected");
  if (wrongTree.reasonCode !== "TREE_OID_MISMATCH") failures.push("wrongTree must reject with TREE_OID_MISMATCH");
  if (wrongTree.runStarted !== false) failures.push("wrongTree must not start a review run");
  if (wrongTree.cleanupCleaned !== true) failures.push("wrongTree cleanupCleaned must be true");
  const dirty = readRecord(evidence.dirtyDetachedWorktree);
  if (dirty.rejected !== true) failures.push("dirtyDetachedWorktree must be rejected");
  if (dirty.reasonCode !== "WORKTREE_NOT_CLEAN") failures.push("dirtyDetachedWorktree must reject with WORKTREE_NOT_CLEAN");
  if (dirty.cleanupCleaned !== true) failures.push("dirtyDetachedWorktree cleanupCleaned must be true");
  if (dirty.worktreeRemovedAfterCleanup !== true) failures.push("dirtyDetachedWorktree worktree must be removed");
  if (evidence.allRejected !== true) failures.push("evidence.allRejected must be true");
  for (const key of ["outputNonceLeaks", "outputKeyRefLeaks", "outputVerifierLeaks"]) {
    if (Number(evidence[key] ?? 0) !== 0) failures.push(`${key} must be 0`);
  }
  const serialized = JSON.stringify(recording);
  if (/nonce_[A-Za-z0-9_-]*secret/i.test(serialized)) failures.push("recording contains forbidden nonce marker");
  if (/keychain:\/\//i.test(serialized)) failures.push("recording contains forbidden keychain ref");
  if (/fixed-negative-identity-verifier/i.test(serialized)) failures.push("recording contains forbidden verifier");
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

function reasonCodeFromError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/(HEAD_UNAVAILABLE|HEAD_SHA_MISMATCH|TREE_OID_MISMATCH|WORKTREE_NOT_DETACHED|WORKTREE_NOT_CLEAN)/);
  return match?.[1] ?? message;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function readRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function renderHuman(result: { ok: boolean; evidence?: { allRejected?: boolean }; failures?: string[] }) {
  return result.ok
    ? `[fg3-negative-identity-matrix] verified allRejected=${result.evidence?.allRejected === true}`
    : `[fg3-negative-identity-matrix] failed\n${(result.failures ?? []).map((failure) => `- ${failure}`).join("\n")}`;
}
