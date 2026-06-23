import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { ArchctxRuntimeRpcServer, RUNTIME_RPC_VERSION, RuntimeRpcClient, createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { SqliteLocalStore, migrateLegacyLocalStoreIfNeeded, runtimeStatePaths } from "@archcontext/local-runtime/local-store-sqlite";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { DevicePrivateKeyStore, InMemoryCredentialSecretStore, KeychainTokenStore } from "@archcontext/cloud/control-plane-client";
import { createReviewChallengeV2 } from "@archcontext/cloud/attestation";
import { runCli } from "../src/main";

const CLI_ENTRY = join(process.cwd(), "packages/surfaces/cli/src/main.ts");
const CLI_PROCESS_TIMEOUT_MS = 30_000;
const DAEMON_TEST_TIMEOUT_MS = 30_000;

function runTestCli(command: string, args: string[], root: string) {
  const previousStateDir = process.env.ARCHCONTEXT_STATE_DIR;
  process.env.ARCHCONTEXT_STATE_DIR = testStateRoot(root);
  return runCli(command, args, root, {
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider()
  }).finally(() => {
    if (previousStateDir === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previousStateDir;
  });
}

function testStateRoot(root: string): string {
  return join(dirname(root), `.archctx-state-${basename(root)}`);
}

function testStateEnv(root: string): NodeJS.ProcessEnv {
  return { ...process.env, ARCHCONTEXT_STATE_DIR: testStateRoot(root) };
}

function testRuntimePaths(root: string) {
  return runtimeStatePaths(root, testStateEnv(root));
}

function removeTempRoot(root: string): void {
  try {
    rmSync(testStateRoot(root), { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
    rmSync(root, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
  } catch (error) {
    if (isIgnorableWindowsCleanupError(error)) return;
    throw error;
  }
}

function isIgnorableWindowsCleanupError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return process.platform === "win32" && (code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY");
}

function expectSameExistingPath(actual: string, expected: string): void {
  expect(normalizeExistingPath(actual)).toBe(normalizeExistingPath(expected));
}

function normalizeExistingPath(path: string): string {
  const normalized = realpathSync.native(resolve(path));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function createInitializedGitRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-review-"));
  writeFileSync(join(root, "README.md"), "# review fixture\n", "utf8");
  initializeArchContextModel(root, "Review App");
  git(root, "init");
  git(root, "add", ".");
  git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture");
  return root;
}

async function writeTaskState(databasePath: string, taskSessionId: string, state: unknown): Promise<void> {
  const store = new SqliteLocalStore(databasePath);
  await store.migrate();
  await store.saveTaskState(taskSessionId, state);
  store.close();
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function gitOut(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function readFileMode(path: string): number {
  return statSync(path).mode & 0o777;
}

async function withEnv<T>(patch: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key]);
    const value = patch[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function expectSafeGithubReviewOutput(data: unknown, challenge: { nonce: string }, signatureValue?: string): void {
  const serialized = JSON.stringify(data);
  expect(serialized).not.toContain(challenge.nonce);
  expect(serialized).not.toContain("keychain://");
  expect(serialized).not.toContain("PRIVATE KEY");
  expect(serialized).not.toContain("fixed-review-verifier");
  if (signatureValue) expect(serialized).not.toContain(signatureValue);
}

describe("archctx CLI", () => {
  test("CLI delegates init and context to the runtime", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const init = await runTestCli("init", ["--name", "CLI App"], root);
      expect(init.ok).toBe(true);

      const context = await runTestCli("context", ["--task", "add teams"], root);
      expect(context.ok).toBe(true);
      expect((context.data as any).task).toBe("add teams");

      const status = await runTestCli("status", [], root);
      expect(status.ok).toBe(true);
      expect((status.data as any).worktreeDigest).toMatch(/^sha256:/);

      const prepare = await runTestCli("prepare", ["--task", "remove legacy v1 wrapper", "--max-items", "1"], root);
      expect(prepare.ok).toBe(true);
      expect((prepare.data as any).posture).toBeTruthy();

      const practices = await runTestCli("practices", ["list", "--json"], root);
      expect(practices.ok).toBe(true);
      expect((practices.data as any).schemaVersion).toBe("archcontext.practice-list/v1");
      expect((practices.data as any).count).toBeGreaterThanOrEqual(12);
      expect((practices.data as any).catalogDigest).toMatch(/^sha256:/);

      const practice = await runTestCli("practices", ["show", "compatibility.single-owner"], root);
      expect(practice.ok).toBe(true);
      expect((practice.data as any).practice.id).toBe("compatibility.single-owner");

      const practiceValidation = await runTestCli("practices", ["validate", "--strict"], root);
      expect((practiceValidation.data as any).valid).toBe(true);

      const practiceSources = await runTestCli("practices", ["sources"], root);
      expect((practiceSources.data as any).sources.some((source: any) => source.id === "madr")).toBe(true);

      const checkpoint = await runTestCli("checkpoint", ["--expected-worktree-digest", (status.data as any).worktreeDigest], root);
      expect((checkpoint.data as any).fresh).toBe(true);

      const complete = await runTestCli("complete", [
        "--task-session-id", "task_cli",
        "--head-sha", "abc123"
      ], root);
      expect(complete.ok).toBe(true);
      expect((complete.data as any).schemaVersion).toBe("archcontext.review/v1");

      const review = await runTestCli("review", [
        "--task-session-id", "task_cli_review",
        "--head-sha", "abc123"
      ], root);
      expect(review.requestId).toBe("review");
      expect((review.data as any).schemaVersion).toBe("archcontext.review/v1");

      const forgedReview = await runTestCli("review", [
        "--task-session-id", "task_cli_forged",
        "--head-sha", "abc123",
        "--result", "pass"
      ], root);
      expect(forgedReview.ok).toBe(false);
      expect((forgedReview as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((forgedReview as any).error.message).toContain("--result");

      const forgedDigest = await runTestCli("complete", [
        "--task-session-id", "task_cli_forged_digest",
        "--head-sha", "abc123",
        "--model-digest", `sha256:${"a".repeat(64)}`
      ], root);
      expect(forgedDigest.ok).toBe(false);
      expect((forgedDigest as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((forgedDigest as any).error.message).toContain("--model-digest");

      const config = await runTestCli("config", [], root);
      expect((config.data as any).generic.transport).toBe("stdio");

      writeFileSync(join(root, "package.json"), JSON.stringify({ engines: { node: ">=24 <26" } }), "utf8");
      const install = await runTestCli("install", ["--host", "codex"], root);
      expect((install.data as any).marker).toContain("archcontext_prepare_task");
      mkdirSync(join(root, ".git"), { recursive: true });
      const doctor = await runTestCli("doctor", [], root);
      expect((doctor.data as any).version.rpcSchemaVersion).toBe(RUNTIME_RPC_VERSION);
      expect((doctor.data as any).daemon.running).toBe(false);
      expect((doctor.data as any).sqlite.path).toContain("runtime.sqlite");
      expect((doctor.data as any).git).toMatchObject({ ok: true, headSha: "unborn" });
      expectSameExistingPath((doctor.data as any).git.root, root);
      expect((doctor.data as any).permissions.workspace.writable).toBe(true);
      expect((doctor.data as any).codeGraph.requiredVersion).toBe("1.0.1");
      expect((doctor.data as any).update).toMatchObject({
        schemaVersion: "archcontext.update-check/v1",
        packageName: "archctx",
        currentVersion: "0.1.3",
        status: "not-checked",
        checkUpdates: false,
        updateAvailable: false
      });
      expect((doctor.data as any).egress).toMatchObject({
        ok: true,
        defaultOutbound: "local-only",
        cloudContentUpload: "deny",
        secureMcpTunnel: "disabled-by-default",
        thirdPartyTelemetry: "disabled",
        codeGraph: {
          telemetry: "disabled",
          envVar: "DO_NOT_TRACK",
          effectiveValue: "1"
        }
      });
      expect((doctor.data as any).hardening.privacyRouteDigest).toMatch(/^sha256:/);
      const paths = await runTestCli("paths", [], root);
      expect(paths.ok).toBe(true);
      expect((paths.data as any).repositoryTruthDir).toBe(join(realpathSync.native(root), ".archcontext"));
      expect((paths.data as any).codeGraphIndexDir).toBe(join(realpathSync.native(root), ".codegraph"));
      expect((paths.data as any).runtimeRepositoryId).toBe(repositoryFingerprint(root));
      expect((paths.data as any).storageRepositoryId).toMatch(/^repo\.[0-9a-f]{16}$/);
      expect((paths.data as any).storageWorkspaceId).toMatch(/^ws\.[0-9a-f]{16}$/);
      expect((paths.data as any).localStorePath).toContain("runtime.sqlite");
      expect((paths.data as any).localStorePath.startsWith(root)).toBe(false);
      expect((paths.data as any).npmGlobalInstallState).toBe("forbidden");
      const privacyAudit = await runTestCli("privacy-audit", [], root);
      expect((privacyAudit.data as any).dependencyAudit.ok).toBe(true);
    } finally {
      removeTempRoot(root);
    }
  });

  test("CLI update check is explicit and doctor can include the same advisory", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-update-check-"));
    writeFileSync(join(root, "README.md"), "# update check fixture\n", "utf8");
    try {
      await withEnv({
        ARCHCONTEXT_CHECK_UPDATES: undefined,
        ARCHCONTEXT_LATEST_VERSION: "99.0.0"
      }, async () => {
        const defaultDoctor = await runTestCli("doctor", [], root);
        expect((defaultDoctor.data as any).update).toMatchObject({
          status: "not-checked",
          checkUpdates: false,
          updateAvailable: false
        });

        const update = await runTestCli("update", ["--check"], root);
        expect(update.ok).toBe(true);
        expect((update.data as any)).toMatchObject({
          schemaVersion: "archcontext.update-check/v1",
          packageName: "archctx",
          currentVersion: "0.1.3",
          latestVersion: "99.0.0",
          source: "env",
          status: "update-available",
          checkUpdates: true,
          updateAvailable: true,
          installCommand: "npm install -g archctx@latest"
        });

        const checkedDoctor = await runTestCli("doctor", ["--check-updates"], root);
        expect((checkedDoctor.data as any).update).toMatchObject({
          latestVersion: "99.0.0",
          source: "env",
          status: "update-available",
          updateAvailable: true
        });

        const unsupported = await runTestCli("update", [], root);
        expect(unsupported.ok).toBe(false);
        expect((unsupported as any).error.code).toBe("AC_CAPABILITY_UNSUPPORTED");
      });
    } finally {
      removeTempRoot(root);
    }
  });

  test("CLI discovers a running daemon RPC connection before embedded fallback", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-rpc-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    const daemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: new TestLocalStore()
    });
    const rpc = new ArchctxRuntimeRpcServer(daemon, { root, port: 0, token: "cli-rpc-token" });
    let stopped = false;
    try {
      const connection = await rpc.start();
      const init = await runCli("init", ["--name", "CLI RPC App"], root, {
        runtimeClient: new RuntimeRpcClient(connection)
      });
      expect(init.ok).toBe(true);

      const status = await runCli("status", [], root);
      expect(status.ok).toBe(true);
      expect((status.data as any).sessions).toBe(1);

      const daemonStatus = await runCli("daemon", ["status"], root);
      expect((daemonStatus.data as any).running).toBe(true);
      expect(JSON.stringify(daemonStatus.data)).not.toContain("cli-rpc-token");

      await rpc.stop();
      stopped = true;
    } finally {
      if (!stopped) await rpc.stop().catch(() => undefined);
      removeTempRoot(root);
    }
  });

  test("CLI renders MCP install, status, and remove host configuration", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-mcp-host-"));
    try {
      const install = await runCli("mcp", ["install", "--host", "codex"], root);
      expect(install.ok).toBe(true);
      expect((install.data as any).host).toBe("codex");
      expect((install.data as any).config.mcpServers.archcontext).toEqual({
        command: "archctx",
        args: ["mcp"]
      });
      expect((install.data as any).marker).toContain("archcontext_prepare_task");

      const status = await runCli("mcp", ["status", "--host", "claude"], root);
      expect(status.ok).toBe(true);
      expect((status.data as any).host).toBe("claude");
      expect((status.data as any).installed).toBe("config-ready");
      expect((status.data as any).transport).toBe("stdio");

      const remove = await runCli("mcp", [
        "remove",
        "--host",
        "generic",
        "--content",
        "before\n<!-- BEGIN ARCHCONTEXT generic -->\nUse archcontext_prepare_task before coding.\n<!-- END ARCHCONTEXT generic -->\nafter"
      ], root);
      expect(remove.ok).toBe(true);
      expect((remove.data as any).removeConfig.remove).toBe(true);
      expect((remove.data as any).markerRemovedFrom).toBe("before\nafter");

      const invalid = await runCli("mcp", ["install", "--host", "unknown"], root);
      expect(invalid.ok).toBe(false);
    } finally {
      removeTempRoot(root);
    }
  });

  test("CLI paths and doctor expose structured legacy local store migration status", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-legacy-status-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const paths = testRuntimePaths(root);
      await writeTaskState(paths.legacyLocalStorePath, "task_cli_legacy", { source: "legacy" });

      const beforePaths = await runTestCli("paths", [], root);
      expect(beforePaths.ok).toBe(true);
      expect((beforePaths.data as any).legacyLocalStore).toMatchObject({
        status: "pending",
        legacyLocalStorePath: paths.legacyLocalStorePath,
        targetLocalStorePath: paths.localStorePath,
        integrityCheck: { legacy: "ok" }
      });

      const beforeDoctor = await runTestCli("doctor", [], root);
      expect((beforeDoctor.data as any).sqlite.legacyPath).toBe(paths.legacyLocalStorePath);
      expect((beforeDoctor.data as any).sqlite.legacyExists).toBe(true);
      expect((beforeDoctor.data as any).sqlite.legacyLocalStore.status).toBe("pending");

      const migration = migrateLegacyLocalStoreIfNeeded(root, testStateEnv(root));
      expect(migration.status).toBe("migrated");

      const afterPaths = await runTestCli("paths", [], root);
      expect((afterPaths.data as any).legacyLocalStore).toMatchObject({
        status: "target-current",
        skippedReason: "target-exists",
        integrityCheck: { target: "ok" }
      });
      expect(existsSync((afterPaths.data as any).legacyLocalStore.markerPath)).toBe(true);

      const afterDoctor = await runTestCli("doctor", [], root);
      expect((afterDoctor.data as any).sqlite.legacyLocalStore.status).toBe("target-current");
      expect(existsSync((afterDoctor.data as any).sqlite.legacyLocalStore.markerPath)).toBe(true);
    } finally {
      removeTempRoot(root);
    }
  });

  test("github connect, status, and disconnect use control-plane credential refs without gh", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-github-"));
    const credentials = new InMemoryCredentialSecretStore();
    const devicePrivateKeyStore = new DevicePrivateKeyStore(credentials);
    const tokenStore = new KeychainTokenStore();
    const previousStateDir = process.env.ARCHCONTEXT_STATE_DIR;
    process.env.ARCHCONTEXT_STATE_DIR = testStateRoot(root);
    try {
      const connect = await runCli("github", [
        "connect",
        "--account-id", "acct_42",
        "--github-user-id", "42",
        "--public-key-id", "key_device_0001",
        "--issuer", "https://archcontext.repoharness.com",
        "--verifier", "fixed-verifier",
        "--now", "2026-06-20T11:00:00Z"
      ], root, { devicePrivateKeyStore, tokenStore });
      expect(connect.ok).toBe(true);
      expect(connect.requestId).toBe("github.connect");
      expect((connect.data as any).connected).toBe(true);
      expect((connect.data as any).ghCli).toBe("not-used");
      expect((connect.data as any).authorizationUrl).toContain("code_challenge_method=S256");
      expect((connect.data as any).deviceKey.keyRef).toBe("keychain://archcontext/device/acct_42/key_device_0001");
      expect((connect.data as any).deviceKey.publicKeyFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);

      const connectionPath = join(testRuntimePaths(root).workspaceStateDir, "github-connection.json");
      expect(existsSync(connectionPath)).toBe(true);
      const persisted = readFileSync(connectionPath, "utf8");
      expect(persisted).toContain("keychain://archcontext/device/acct_42/key_device_0001");
      expect(persisted).not.toContain("fixed-verifier");
      expect(persisted).not.toContain("refresh_acct_42");
      expect(persisted).not.toContain("PRIVATE KEY");
      expect(persisted).not.toContain("BEGIN PUBLIC KEY");

      const status = await runCli("github", ["status"], root);
      expect(status.ok).toBe(true);
      expect((status.data as any).connected).toBe(true);
      expect((status.data as any).accountId).toBe("acct_42");
      expect(JSON.stringify(status.data)).not.toContain("fixed-verifier");
      expect(JSON.stringify(status.data)).not.toContain("PRIVATE KEY");

      const disconnect = await runCli("github", ["disconnect"], root, { devicePrivateKeyStore, tokenStore });
      expect(disconnect.ok).toBe(true);
      expect((disconnect.data as any).disconnected).toBe(true);
      expect(existsSync(connectionPath)).toBe(false);
      expect(() => devicePrivateKeyStore.readPrivateKey("keychain://archcontext/device/acct_42/key_device_0001")).toThrow("device-private-key-not-found");

      const disconnectedStatus = await runCli("github", ["status"], root);
      expect((disconnectedStatus.data as any).connected).toBe(false);

      const invalid = await runCli("github", ["review"], root);
      expect(invalid.ok).toBe(false);
    } finally {
      if (previousStateDir === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
      else process.env.ARCHCONTEXT_STATE_DIR = previousStateDir;
      removeTempRoot(root);
    }
  });

  test("github verify-head fetches typed pull head metadata and rejects mismatched Challenge identity without gh", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-github-head-"));
    const challenge = createReviewChallengeV2({
      challengeId: "chal_cli_verify_head",
      installationId: 10001,
      repositoryId: 20002,
      pullRequestNumber: 42,
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      nonce: "nonce_cli_verify_head_secret",
      requiredTrust: "developer",
      policyProfileId: "policy.default",
      createdAt: "2026-06-20T09:00:00Z",
      expiresAt: "2026-06-20T09:15:00Z"
    });
    const requests: unknown[] = [];
    try {
      const accepted = await runCli("github", [
        "verify-head",
        "--challenge-json", JSON.stringify(challenge)
      ], root, {
        githubGovernancePort: {
          async getPullHeadMetadata(input) {
            requests.push(input);
            return {
              ...input,
              headSha: challenge.headSha,
              baseSha: challenge.baseSha
            };
          }
        }
      });

      expect(accepted.ok).toBe(true);
      expect(accepted.requestId).toBe("github.verify-head");
      expect((accepted.data as any)).toMatchObject({
        accepted: true,
        challengeId: challenge.challengeId,
        ghCli: "not-used",
        expected: {
          installationId: challenge.installationId,
          repositoryId: challenge.repositoryId,
          pullRequestNumber: challenge.pullRequestNumber,
          headSha: challenge.headSha,
          baseSha: challenge.baseSha
        }
      });
      expect(requests).toEqual([{
        installationId: challenge.installationId,
        repositoryId: challenge.repositoryId,
        pullRequestNumber: challenge.pullRequestNumber
      }]);
      expect(JSON.stringify(accepted.data)).not.toContain(challenge.nonce);
      expect(JSON.stringify(accepted.data)).not.toContain("PRIVATE KEY");

      const rejected = await runCli("github", [
        "verify-head",
        "--challenge-json", JSON.stringify(challenge)
      ], root, {
        githubGovernancePort: {
          async getPullHeadMetadata(input) {
            return {
              ...input,
              headSha: "cccccccccccccccccccccccccccccccccccccccc",
              baseSha: challenge.baseSha
            };
          }
        }
      });
      expect(rejected.ok).toBe(true);
      expect((rejected.data as any)).toMatchObject({
        accepted: false,
        reasonCode: "HEAD_SHA_MISMATCH",
        ghCli: "not-used"
      });

      const noPort = await runCli("github", [
        "verify-head",
        "--challenge-json", JSON.stringify(challenge)
      ], root);
      expect(noPort.ok).toBe(false);
      expect((noPort as any).error?.code).toBe("AC_RUNTIME_UNAVAILABLE");

      const invalidChallenge = await runCli("github", [
        "verify-head",
        "--challenge-json", "{}"
      ], root, {
        githubGovernancePort: {
          async getPullHeadMetadata() {
            throw new Error("should-not-fetch-invalid-challenge");
          }
        }
      });
      expect(invalidChallenge.ok).toBe(false);
      expect((invalidChallenge as any).error?.code).toBe("AC_SCHEMA_INVALID");
    } finally {
      removeTempRoot(root);
    }
  });

  test("github review claim run submit status retry and cancel use daemon-owned signing without leaking secrets", async () => {
    const root = createInitializedGitRepo();
    const credentials = new InMemoryCredentialSecretStore();
    const devicePrivateKeyStore = new DevicePrivateKeyStore(credentials);
    const tokenStore = new KeychainTokenStore();
    const provider = new MockCodeGraphProvider();
    const headSha = gitOut(root, "rev-parse", "HEAD");
    const baseSha = headSha;
    const challenge = createReviewChallengeV2({
      challengeId: "chal_cli_developer_review",
      installationId: 10001,
      repositoryId: 20002,
      pullRequestNumber: 42,
      headSha,
      baseSha,
      nonce: "nonce_cli_developer_review_secret",
      requiredTrust: "developer",
      policyProfileId: "policy.default",
      createdAt: "2026-06-20T09:00:00Z",
      expiresAt: "2026-06-20T09:15:00Z"
    });
    const submissions: any[] = [];
    const deps = {
      codeFacts: new CodeGraphAdapter(provider),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      devicePrivateKeyStore,
      tokenStore,
      githubGovernancePort: {
        async getPullHeadMetadata(input: any) {
          return { ...input, headSha, baseSha };
        }
      },
      githubReviewSubmissionPort: {
        async submitDeveloperReview(input: any) {
          submissions.push(input);
          return {
            accepted: true,
            attestationDigest: input.attestationDigest,
            delivery: "metadata-only"
          };
        }
      }
    };
    const previousStateDir = process.env.ARCHCONTEXT_STATE_DIR;
    process.env.ARCHCONTEXT_STATE_DIR = testStateRoot(root);
    try {
      const connect = await runCli("github", [
        "connect",
        "--account-id", "acct_review",
        "--github-user-id", "42",
        "--public-key-id", "key_device_review",
        "--verifier", "fixed-review-verifier",
        "--now", "2026-06-20T08:59:00Z"
      ], root, deps);
      expect(connect.ok).toBe(true);

      const claim = await runCli("github", [
        "review",
        "claim",
        "--challenge-json", JSON.stringify(challenge),
        "--now", "2026-06-20T09:01:00Z"
      ], root, deps);
      expect(claim.ok).toBe(true);
      expect(claim.requestId).toBe("github.review.claim");
      expect((claim.data as any).status).toBe("claimed");
      expect((claim.data as any).challenge.status).toBe("LEASED");
      expectSafeGithubReviewOutput(claim.data, challenge);

      const statePath = join(testRuntimePaths(root).workspaceStateDir, "github-developer-review-pr-42.json");
      expect(existsSync(statePath)).toBe(true);
      if (process.platform !== "win32") expect(readFileMode(statePath) & 0o077).toBe(0);
      const persistedClaim = readFileSync(statePath, "utf8");
      expect(persistedClaim).not.toContain("fixed-review-verifier");
      expect(persistedClaim).not.toContain("PRIVATE KEY");
      expect(persistedClaim).not.toContain("keychain://archcontext/device/acct_review/key_device_review");

      const run = await runCli("github", [
        "review",
        "run",
        "--pr", "42",
        "--now", "2026-06-20T09:02:00Z",
        "--started-at", "2026-06-20T09:01:30Z",
        "--completed-at", "2026-06-20T09:02:00Z"
      ], root, deps);
      expect(run.ok).toBe(true);
      expect(run.requestId).toBe("github.review.run");
      expect((run.data as any).status).toBe("ran");
      expect((run.data as any).review.reviewDigest).toMatch(/^sha256:/);
      expect((run.data as any).attestationDigest).toMatch(/^sha256:/);
      expect((run.data as any).cleanup.cleaned).toBe(true);
      expect(provider.indexedRoots).toHaveLength(1);
      expect(existsSync(provider.indexedRoots[0])).toBe(false);
      expectSafeGithubReviewOutput(run.data, challenge);

      const status = await runCli("github", ["review", "status", "--pr", "42"], root, deps);
      expect(status.ok).toBe(true);
      expect((status.data as any).status).toBe("ran");
      expectSafeGithubReviewOutput(status.data, challenge);

      const submit = await runCli("github", ["review", "submit", "--pr", "42", "--now", "2026-06-20T09:03:00Z"], root, deps);
      expect(submit.ok).toBe(true);
      expect((submit.data as any).status).toBe("submitted");
      expect((submit.data as any).submission).toMatchObject({ accepted: true, delivery: "metadata-only" });
      expect(submissions).toHaveLength(1);
      expect(submissions[0].challenge.challengeId).toBe(challenge.challengeId);
      expect(submissions[0].attestation.nonce).toBe(challenge.nonce);
      expectSafeGithubReviewOutput(submit.data, challenge, submissions[0].attestation.signature.value);

      const cancel = await runCli("github", ["review", "cancel", "--pr", "42", "--now", "2026-06-20T09:04:00Z"], root, deps);
      expect(cancel.ok).toBe(true);
      expect((cancel.data as any).status).toBe("cancelled");
      expectSafeGithubReviewOutput(cancel.data, challenge, submissions[0].attestation.signature.value);

      const retryBlocked = await runCli("github", ["review", "retry", "--pr", "42", "--now", "2026-06-20T09:05:00Z"], root, deps);
      expect(retryBlocked.ok).toBe(false);
      expect((retryBlocked as any).error?.message).toContain("--force");

      const retry = await runCli("github", ["review", "retry", "--pr", "42", "--force", "--now", "2026-06-20T09:05:00Z"], root, deps);
      expect(retry.ok).toBe(true);
      expect(retry.requestId).toBe("github.review.submit");
      expect((retry.data as any).status).toBe("submitted");
      expect(submissions).toHaveLength(2);
      expectSafeGithubReviewOutput(retry.data, challenge, submissions[1].attestation.signature.value);
    } finally {
      if (previousStateDir === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
      else process.env.ARCHCONTEXT_STATE_DIR = previousStateDir;
      removeTempRoot(root);
    }
  });

  test("foreground daemon subprocess shares runtime state across independent CLI processes", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-foreground-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    const daemon = spawn(process.execPath, [CLI_ENTRY, "daemon", "start", "--foreground", "--port", "0"], {
      cwd: root,
      env: testStateEnv(root)
    });
    try {
      const started = await readJsonFromProcess(daemon);
      expect(started.ok).toBe(true);
      expect(started.data.running).toBe(true);
      expect(started.data.protocol).toBe("http-loopback");
      expect(String(started.data.url)).toMatch(/^http:\/\/127\.0\.0\.1:/);
      const paths = testRuntimePaths(root);
      expect(existsSync(paths.daemonConnectionPath)).toBe(true);
      expect(existsSync(paths.daemonLockPath)).toBe(true);
      const health = await fetch(`${started.data.url}health`);
      expect((await health.json() as any).composition).toMatchObject({
        mode: "production",
        productionSafe: true,
        adapters: {
          codeFacts: "codegraph-cli",
          localStore: "sqlite"
        }
      });

      const init = await runCliProcess(root, "init", "--name", "Foreground App");
      expect(init.ok).toBe(true);

      const status = await runCliProcess(root, "status");
      expect(status.ok).toBe(true);
      expect(status.data.sessions).toBe(1);
      expect(status.data.running).toBe(true);

      const daemonStatus = await runCliProcess(root, "daemon", "status");
      const connection = JSON.parse(readFileSync(paths.daemonConnectionPath, "utf8"));
      expect(daemonStatus.data.running).toBe(true);
      expect(daemonStatus.data.rpcVersionCompatible).toBe(true);
      expect(daemonStatus.data.product.schemaVersion).toBe("archcontext.product-version-manifest/v1");
      expect(daemonStatus.data.product.runtime.localRpc.schemaVersion).toBe(RUNTIME_RPC_VERSION);
      expect(JSON.stringify(daemonStatus.data)).toContain("stored-in-connection-file");
      expect(JSON.stringify(daemonStatus.data)).not.toContain(connection.token);

      const stopped = await runCliProcess(root, "daemon", "stop");
      expect(stopped.ok).toBe(true);
      await expectProcessExit(daemon);
      expect(existsSync(paths.daemonConnectionPath)).toBe(false);
      expect(existsSync(paths.daemonLockPath)).toBe(false);
    } finally {
      if (daemon.exitCode === null && !daemon.killed) daemon.kill("SIGTERM");
      await expectProcessExit(daemon).catch(() => undefined);
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("background daemon start returns after ready and survives the starter process", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-background-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    const connectionPath = testRuntimePaths(root).daemonConnectionPath;
    const lockPath = testRuntimePaths(root).daemonLockPath;
    try {
      const started = await runCliProcess(root, "daemon", "start");
      expect(started.ok).toBe(true);
      expect(started.data.running).toBe(true);
      expect(started.data.background).toBe(true);
      expect(String(started.data.url)).toMatch(/^http:\/\/127\.0\.0\.1:/);
      expect(String(started.data.logPath)).toContain("archctxd.log");
      expect(existsSync(connectionPath)).toBe(true);
      expect(existsSync(lockPath)).toBe(true);

      const init = await runCliProcess(root, "init", "--name", "Background App");
      expect(init.ok).toBe(true);

      const status = await runCliProcess(root, "status");
      expect(status.ok).toBe(true);
      expect(status.data.sessions).toBe(1);
      expect(status.data.running).toBe(true);

      const again = await runCliProcess(root, "daemon", "start");
      expect(again.ok).toBe(true);
      expect(again.data.alreadyRunning).toBe(true);
      expect(JSON.stringify(again.data)).toContain("stored-in-connection-file");

      const stopped = await runCliProcess(root, "daemon", "stop");
      expect(stopped.ok).toBe(true);
      await expectFileRemoved(connectionPath);
      await expectFileRemoved(lockPath);
    } finally {
      await stopDaemonAndWait(root);
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("CLI recovers stale daemon control files after a crash and reconnects", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-crash-recovery-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    const connectionPath = testRuntimePaths(root).daemonConnectionPath;
    const lockPath = testRuntimePaths(root).daemonLockPath;
    try {
      const started = await runCliProcess(root, "daemon", "start");
      expect(started.ok).toBe(true);
      expect(started.data.running).toBe(true);
      const firstConnection = JSON.parse(readFileSync(connectionPath, "utf8"));

      process.kill(firstConnection.pid, "SIGKILL");
      await expectPidGone(firstConnection.pid);
      expect(existsSync(connectionPath)).toBe(true);
      expect(existsSync(lockPath)).toBe(true);

      const restarted = await runCliProcess(root, "daemon", "start");
      expect(restarted.ok).toBe(true);
      expect(restarted.data.running).toBe(true);
      expect(restarted.data.recoveredStaleControlFiles).toEqual(expect.arrayContaining([
        "dead-connection-pid",
        "stale-lock-file"
      ]));
      const secondConnection = JSON.parse(readFileSync(connectionPath, "utf8"));
      expect(secondConnection.pid).not.toBe(firstConnection.pid);

      const status = await runCliProcess(root, "status");
      expect(status.ok).toBe(true);
      expect(status.data.running).toBe(true);
    } finally {
      await stopDaemonAndWait(root);
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("CLI downgrades stale daemon connection files instead of failing commands", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-stale-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    const previousStateDir = process.env.ARCHCONTEXT_STATE_DIR;
    process.env.ARCHCONTEXT_STATE_DIR = testStateRoot(root);
    try {
      const connectionPath = testRuntimePaths(root).daemonConnectionPath;
      const lockPath = testRuntimePaths(root).daemonLockPath;
      mkdirSync(testRuntimePaths(root).workspaceStateDir, { recursive: true });
      writeFileSync(connectionPath, JSON.stringify({
        schemaVersion: RUNTIME_RPC_VERSION,
        protocol: "http-loopback",
        version: 1,
        root,
        url: "http://127.0.0.1:1/",
        token: "dead-token",
        pid: 1,
        lockPath,
        connectionPath,
        startedAt: "2026-06-20T00:00:00.000Z"
      }, null, 2), { mode: 0o600 });
      if (process.platform !== "win32") chmodSync(connectionPath, 0o600);

      const daemonStatus = await runCli("daemon", ["status"], root);
      expect((daemonStatus.data as any).running).toBe(false);
      expect((daemonStatus.data as any).staleConnection).toBe(true);

      const status = await runCli("status", [], root);
      expect(status.ok).toBe(true);
      expect((status.data as any).running).toBe(true);
    } finally {
      await stopDaemonAndWait(root);
      if (previousStateDir === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
      else process.env.ARCHCONTEXT_STATE_DIR = previousStateDir;
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("CLI reports incompatible daemon versions and replaces them through daemon upgrade", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-upgrade-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    const connectionPath = testRuntimePaths(root).daemonConnectionPath;
    try {
      const started = await runCliProcess(root, "daemon", "start");
      expect(started.ok).toBe(true);
      const firstConnection = JSON.parse(readFileSync(connectionPath, "utf8"));
      writeFileSync(connectionPath, JSON.stringify({
        ...firstConnection,
        schemaVersion: "archcontext.runtime-rpc/v0"
      }, null, 2), { mode: 0o600 });
      if (process.platform !== "win32") chmodSync(connectionPath, 0o600);

      const daemonStatus = await runCliProcess(root, "daemon", "status");
      expect(daemonStatus.ok).toBe(true);
      expect(daemonStatus.data).toMatchObject({
        running: true,
        rpcVersionCompatible: false,
        versionUnsupported: {
          expected: RUNTIME_RPC_VERSION,
          received: "archcontext.runtime-rpc/v0",
          action: "upgrade-archctx-runtime",
          command: "archctx daemon upgrade"
        }
      });

      const ordinaryStatus = await runCliProcess(root, "status");
      expect(ordinaryStatus.ok).toBe(false);
      expect(ordinaryStatus.error).toMatchObject({
        code: "AC_RUNTIME_VERSION_UNSUPPORTED",
        action: "upgrade-archctx-runtime"
      });

      const startAgain = await runCliProcess(root, "daemon", "start");
      expect(startAgain.ok).toBe(false);
      expect(startAgain.error.code).toBe("AC_RUNTIME_VERSION_UNSUPPORTED");

      const upgraded = await runCliProcess(root, "daemon", "upgrade");
      expect(upgraded.ok).toBe(true);
      expect(upgraded.requestId).toBe("daemon.upgrade");
      expect(upgraded.data.upgraded).toBe(true);
      expect(upgraded.data.replacedRuntime).toMatchObject({
        previousRpcSchemaVersion: "archcontext.runtime-rpc/v0",
        expectedRpcSchemaVersion: RUNTIME_RPC_VERSION,
        previousPid: firstConnection.pid
      });
      await expectPidGone(firstConnection.pid);
      const secondConnection = JSON.parse(readFileSync(connectionPath, "utf8"));
      expect(secondConnection.pid).not.toBe(firstConnection.pid);
      expect(secondConnection.schemaVersion).toBe(RUNTIME_RPC_VERSION);

      const status = await runCliProcess(root, "status");
      expect(status.ok).toBe(true);
      expect(status.data.running).toBe(true);
    } finally {
      await stopDaemonAndWait(root);
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("CLI exposes repo and landscape commands without changing single-repo defaults", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-"));
    const otherRoot = mkdtempSync(join(tmpdir(), "archctx-cli-other-"));
    try {
      writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
      writeFileSync(join(otherRoot, "README.md"), "# other\n", "utf8");
      const added = await runTestCli("repo", ["add", "--name", "web"], root);
      expect(added.ok).toBe(true);
      expect((added.data as any).repository.name).toBe("web");
      const denied = await runTestCli("repo", ["add", "--root", otherRoot, "--name", "other"], root);
      expect(denied.ok).toBe(false);
      expect((denied as any).error?.code).toBe("AC_CAPABILITY_UNSUPPORTED");
      const landscape = await runTestCli("landscape", [], root);
      expect(landscape.ok).toBe(true);
      expect((landscape.data as any).schemaVersion).toBe("archcontext.landscape/v1");
      const context = await runTestCli("context", ["--landscape", "--task", "change local API", "--max-symbols", "2"], root);
      expect(context.ok).toBe(true);
      expect((context.data as any).extensions.landscapeDigest).toMatch(/^sha256:/);
      const explore = await runTestCli("explore", ["projection"], root);
      expect(explore.ok).toBe(true);
      expect((explore.data as any).schemaVersion).toBe("archcontext.explorer-projection/v1");
      const start = await runTestCli("explore", ["start"], root);
      expect((start.data as any).command).toBe("archctx explore start --foreground");
      expect((start.data as any).readOnly).toBe(true);
    } finally {
      removeTempRoot(root);
      removeTempRoot(otherRoot);
    }
  });

  test("CLI exports and imports interop projections without overwriting Native model", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-"));
    try {
      writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
      initializeArchContextModel(root, "CLI Export App");
      const likec4 = await runTestCli("export", ["likec4"], root);
      expect(likec4.ok).toBe(true);
      expect((likec4.data as any).format).toBe("likec4");
      const imported = await runTestCli("import", ["likec4", "--content", (likec4.data as any).files[0].content], root);
      expect(imported.ok).toBe(true);
      expect((imported.data as any).mode).toBe("initialization-only");
      const structurizr = await runTestCli("export", ["structurizr"], root);
      expect((structurizr.data as any).files[0].path).toContain("structurizr");
      const mermaid = await runTestCli("export", ["mermaid"], root);
      expect((mermaid.data as any).files[0].path).toContain("architecture.mmd");
      const tunnel = await runTestCli("tunnel", [], root);
      expect((tunnel.data as any).bindHost).toBe("127.0.0.1");
      expect((tunnel.data as any).writes).toContain("disabled-by-default");
    } finally {
      removeTempRoot(root);
    }
  });
});

async function runCliProcess(root: string, ...args: string[]): Promise<any> {
  const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
    cwd: root,
    env: testStateEnv(root)
  });
  const { stdout, stderr, code } = await collectProcess(child);
  if (code !== 0) throw new Error(`archctx ${args.join(" ")} failed (${code}): ${stderr || stdout}`);
  return JSON.parse(stdout);
}

async function stopDaemonAndWait(root: string): Promise<void> {
  await runCliProcess(root, "daemon", "stop").catch(() => undefined);
  await expectFileRemoved(testRuntimePaths(root).daemonConnectionPath).catch(() => undefined);
  await expectFileRemoved(testRuntimePaths(root).daemonLockPath).catch(() => undefined);
}

function readJsonFromProcess(child: ChildProcessWithoutNullStreams): Promise<any> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    const timeout = setTimeout(() => finish(() => reject(new Error(`Timed out waiting for daemon start: ${stderr || stdout}`))), CLI_PROCESS_TIMEOUT_MS);
    const finish = (callback: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      callback();
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      try {
        const parsed = JSON.parse(stdout);
        finish(() => resolve(parsed));
      } catch {
        // Wait for the pretty-printed JSON object to finish.
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("exit", (code) => {
      finish(() => reject(new Error(`daemon exited before ready (${code}): ${stderr || stdout}`)));
    });
  });
}

function collectProcess(child: ChildProcessWithoutNullStreams): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out waiting for process: ${stderr || stdout}`));
    }, CLI_PROCESS_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, code });
    });
  });
}

function expectProcessExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for daemon process exit")), 5000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function expectFileRemoved(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for file removal: ${path}`);
}

async function expectPidGone(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for process exit: ${pid}`);
}
