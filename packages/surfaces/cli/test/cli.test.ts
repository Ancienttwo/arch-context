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
import { runFastHookEnqueue } from "../src/hook-fast";
import { runCli } from "../src/main";

const CLI_ENTRY = join(process.cwd(), "packages/surfaces/cli/src/main.ts");
const CLI_PROCESS_TIMEOUT_MS = process.platform === "win32" ? 180_000 : 30_000;
const CLI_DOCS_TEST_TIMEOUT_MS = 15_000;
const DAEMON_TEST_TIMEOUT_MS = process.platform === "win32" ? 240_000 : 30_000;
const GITHUB_REVIEW_TEST_TIMEOUT_MS = 15_000;

function runTestCli(command: string, args: string[], root: string, stateRoot = testStateRoot(root)) {
  const previousStateDir = process.env.ARCHCONTEXT_STATE_DIR;
  process.env.ARCHCONTEXT_STATE_DIR = stateRoot;
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

async function removeRuntimeSqliteFiles(localStorePath: string): Promise<void> {
  for (const path of [localStorePath, `${localStorePath}-wal`, `${localStorePath}-shm`]) {
    await removeFileWithTransientWindowsRetry(path);
  }
}

async function removeFileWithTransientWindowsRetry(path: string): Promise<void> {
  const deadline = Date.now() + (process.platform === "win32" ? 30_000 : 0);
  while (true) {
    try {
      rmSync(path, { force: true });
      return;
    } catch (error) {
      if (!isIgnorableWindowsCleanupError(error) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
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
  configureGitFixtureIdentity(root);
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

function gitExitCode(root: string, ...args: string[]): number {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

function configureGitFixtureIdentity(root: string): void {
  git(root, "config", "user.name", "ArchContext Test");
  git(root, "config", "user.email", "archcontext@example.test");
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
      writeFileSync(join(root, ".archcontext/model/nodes/module.waiver-owner.yaml"), [
        "schemaVersion: archcontext.node/v1",
        "id: module.waiver-owner",
        "kind: module",
        "name: Waiver Owner",
        "status: active",
        "summary: Owns waiver governance fixtures.",
        "ownership:",
        "  lifecycle: [\"team-architecture\"]",
        ""
      ].join("\n"), "utf8");

      const context = await runTestCli("context", ["--task", "add teams"], root);
      expect(context.ok).toBe(true);
      expect((context.data as any).task).toBe("add teams");
      expect((context.data as any).practiceGuidance.schemaVersion).toBe("archcontext.practice-guidance/v1");
      expect((context.data as any).practiceGuidance.catalogDigest).toMatch(/^sha256:/);

      const status = await runTestCli("status", [], root);
      expect(status.ok).toBe(true);
      expect((status.data as any).worktreeDigest).toMatch(/^sha256:/);

      const prepare = await runTestCli("prepare", ["--task", "remove legacy v1 wrapper", "--max-items", "1"], root);
      expect(prepare.ok).toBe(true);
      expect((prepare.data as any).posture).toBeTruthy();
      expect((prepare.data as any).context.practiceGuidance.matches.length).toBeGreaterThan(0);

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

      const waiverPlan = await runTestCli("practices", [
        "waive",
        "--practice-id", "modularity.no-new-cycle",
        "--check-id", "no-new-cycle",
        "--waiver-id", "cycle-waiver",
        "--owner", "team-architecture",
        "--reason", "External migration window requires keeping this edge until the upstream cutover is complete.",
        "--review-at", "2026-07-10T00:00:00.000Z",
        "--expires-at", "2026-07-24T00:00:00.000Z",
        "--evidence-digest", `sha256:${"1".repeat(64)}`,
        "--subject", "module.a->module.b"
      ], root);
      expect(waiverPlan.ok).toBe(true);
      expect((waiverPlan.data as any).draft.operations[0]).toMatchObject({
        op: "write_waiver",
        path: ".archcontext/waivers/cycle-waiver.json"
      });
      expect((waiverPlan.data as any).preview.allowed).toBe(true);

      const waiverList = await runTestCli("practices", ["waivers"], root);
      expect(waiverList.ok).toBe(true);
      expect((waiverList.data as any).count).toBe(0);
      expect((waiverList.data as any).ownerRegistry.owners).toContain("team-architecture");

      const unknownWaiverOwner = await runTestCli("practices", [
        "waive",
        "--practice-id", "modularity.no-new-cycle",
        "--owner", "unknown-team",
        "--reason", "External migration window requires keeping this edge until the upstream cutover is complete.",
        "--review-at", "2026-07-10T00:00:00.000Z",
        "--expires-at", "2026-07-24T00:00:00.000Z",
        "--evidence-digest", `sha256:${"1".repeat(64)}`,
        "--subject", "module.a->module.b"
      ], root);
      expect(unknownWaiverOwner.ok).toBe(false);
      expect((unknownWaiverOwner as any).error.code).toBe("AC_SCHEMA_INVALID");

      const checkpoint = await runTestCli("checkpoint", ["--expected-worktree-digest", (status.data as any).worktreeDigest], root);
      expect((checkpoint.data as any).schemaVersion).toBe("archcontext.practice-checkpoint/v1");
      expect((checkpoint.data as any).fresh).toBe(true);
      expect(["fresh", "no-op", "no-baseline"]).toContain((checkpoint.data as any).reasonCode);
      expect((checkpoint.data as any).hook.egress).toBe("none");
      if ((checkpoint.data as any).reasonCode === "fresh") {
        expect((checkpoint.data as any).previousPracticeGuidanceDigest).toMatch(/^sha256:/);
      }

      const hookCheckpoint = await runTestCli("hook", ["checkpoint", "--event", "post-edit", "--path", "src/example.ts"], root);
      expect(hookCheckpoint.requestId).toBe("hook.checkpoint");
      expect((hookCheckpoint.data as any).schemaVersion).toBe("archcontext.practice-checkpoint/v1");
      expect((hookCheckpoint.data as any).hookLog).toMatchObject({
        schemaVersion: "archcontext.hook-log/v1",
        event: "post-edit",
        pathCount: 1,
        egress: "none",
        network: "forbidden"
      });
      expect((hookCheckpoint.data as any).hookLog.changedPathDigest).toMatch(/^sha256:/);
      expect(JSON.stringify((hookCheckpoint.data as any).hookLog)).not.toContain("src/example.ts");

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

      const forgedPractice = await runTestCli("complete", [
        "--task-session-id", "task_cli_forged_practice",
        "--head-sha", "abc123",
        "--practice-violations", "[]"
      ], root);
      expect(forgedPractice.ok).toBe(false);
      expect((forgedPractice as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((forgedPractice as any).error.message).toContain("--practice-violations");

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
  }, CLI_PROCESS_TIMEOUT_MS);

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

  test("hook checkpoint fails open when runtime checkpoint is unavailable", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-hook-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const result = await runCli("hook", ["checkpoint", "--event", "post-edit", "--path", "src/app.ts"], root, {
        runtimeClient: {
          checkpoint() {
            throw new Error("runtime offline");
          }
        } as any
      });
      expect(result.ok).toBe(true);
      expect(result.requestId).toBe("hook.checkpoint");
      expect((result.data as any).schemaVersion).toBe("archcontext.hook-checkpoint-fail-open/v1");
      expect((result.data as any).failOpen).toBe(true);
      expect((result.data as any).egress).toBe("none");
      expect((result.data as any).network).toBe("forbidden");
      expect((result.data as any).hookLog).toMatchObject({
        schemaVersion: "archcontext.hook-log/v1",
        event: "post-edit",
        pathCount: 1,
        reasonCode: "runtime-unavailable",
        failOpen: true,
        egress: "none",
        network: "forbidden"
      });
      expect(JSON.stringify((result.data as any).hookLog)).not.toContain("src/app.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("hook enqueue uses the runtime job queue with fail-open and generated projection guards", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-hook-enqueue-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const calls: any[] = [];
      const queued = await runCli("hook", [
        "enqueue",
        "--event", "post-commit",
        "--path", "src/app.ts",
        "--coalesce-key", "hook.post-commit",
        "--max-attempts", "2",
        "--max-queued-jobs", "7",
        "--priority", "3",
        "--risk", "high",
        "--uncertainty", "high"
      ], root, {
        runtimeClient: {
          jobsEnqueueGitHook(runtimeRoot: string, input: any) {
            calls.push({ runtimeRoot, input });
            return {
              schemaVersion: "archcontext.envelope/v1",
              ok: true,
              requestId: "jobs.enqueueGitHook",
              data: {
                enqueued: true,
                deduplicated: false,
                record: { job: { jobId: "agent_job.hook_test", status: "queued" } }
              }
            };
          }
        } as any
      });
      expect(queued.ok).toBe(true);
      expect(queued.requestId).toBe("hook.enqueue");
      expect((queued.data as any).enqueued).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].runtimeRoot).toBe(root);
      expect(calls[0].input).toMatchObject({
        source: "commit",
        event: "post-commit",
        analysisKind: "architecture-delta",
        coalesceKey: "hook.post-commit",
        maxAttempts: 2,
        maxQueuedJobs: 7,
        priority: 3,
        risk: "high",
        uncertainty: "high",
        generatedProjection: false,
        skipGeneratedProjection: true
      });
      expect((queued.data as any).hookLog).toMatchObject({
        schemaVersion: "archcontext.hook-log/v1",
        event: "post-commit",
        pathCount: 1,
        reasonCode: "enqueued",
        failOpen: false,
        egress: "none",
        network: "forbidden"
      });
      expect(JSON.stringify((queued.data as any).hookLog)).not.toContain("src/app.ts");

      const failOpen = await runCli("hook", ["enqueue", "--event", "post-edit", "--path", "src/offline.ts"], root, {
        runtimeClient: {
          jobsEnqueueGitHook() {
            throw new Error("runtime offline");
          }
        } as any
      });
      expect(failOpen.ok).toBe(true);
      expect(failOpen.requestId).toBe("hook.enqueue");
      expect((failOpen.data as any)).toMatchObject({
        schemaVersion: "archcontext.hook-enqueue-fail-open/v1",
        failOpen: true,
        reasonCode: "runtime-unavailable",
        egress: "none",
        network: "forbidden"
      });
      expect(JSON.stringify((failOpen.data as any).hookLog)).not.toContain("src/offline.ts");

      let generatedProjectionCalled = false;
      const skipped = await runCli("hook", [
        "enqueue",
        "--event", "post-write",
        "--path", ".archcontext/generated/ARCHITECTURE.md"
      ], root, {
        runtimeClient: {
          jobsEnqueueGitHook() {
            generatedProjectionCalled = true;
            throw new Error("guard should skip before runtime");
          }
        } as any
      });
      expect(skipped.ok).toBe(true);
      expect(generatedProjectionCalled).toBe(false);
      expect((skipped.data as any)).toMatchObject({
        schemaVersion: "archcontext.hook-enqueue-skipped/v1",
        skipped: true,
        enqueued: false,
        reasonCode: "archcontext-generated-projection",
        egress: "none",
        network: "forbidden"
      });
      expect(JSON.stringify((skipped.data as any).hookLog)).not.toContain(".archcontext/generated/ARCHITECTURE.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fast hook enqueue dispatch preserves fail-open and generated projection guards", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-fast-hook-enqueue-"));
    const stateRoot = mkdtempSync(join(tmpdir(), "archctx-fast-hook-state-"));
    const previousStateDir = process.env.ARCHCONTEXT_STATE_DIR;
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    try {
      process.env.ARCHCONTEXT_STATE_DIR = stateRoot;
      const failOpen = await runFastHookEnqueue([
        "hook",
        "enqueue",
        "--event", "post-edit",
        "--path", "src/offline.ts"
      ], root);
      expect(failOpen.handled).toBe(true);
      expect((failOpen.envelope as any)).toMatchObject({
        ok: true,
        requestId: "hook.enqueue",
        data: {
          schemaVersion: "archcontext.hook-enqueue-fail-open/v1",
          failOpen: true,
          reasonCode: "runtime-unavailable",
          egress: "none",
          network: "forbidden",
          hookLog: {
            schemaVersion: "archcontext.hook-log/v1",
            egress: "none",
            network: "forbidden"
          }
        }
      });
      expect(JSON.stringify((failOpen.envelope as any).data.hookLog)).not.toContain("src/offline.ts");

      const skipped = await runFastHookEnqueue([
        "hook",
        "enqueue",
        "--event", "post-write",
        "--path", ".archcontext/generated/ARCHITECTURE.md"
      ], root);
      expect(skipped.handled).toBe(true);
      expect((skipped.envelope as any).data).toMatchObject({
        schemaVersion: "archcontext.hook-enqueue-skipped/v1",
        skipped: true,
        enqueued: false,
        reasonCode: "archcontext-generated-projection",
        egress: "none",
        network: "forbidden"
      });
      expect(JSON.stringify((skipped.envelope as any).data.hookLog)).not.toContain(".archcontext/generated/ARCHITECTURE.md");
    } finally {
      if (previousStateDir === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
      else process.env.ARCHCONTEXT_STATE_DIR = previousStateDir;
      rmSync(root, { recursive: true, force: true });
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  test("CLI renders central hook adapter install status and remove configuration", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-hooks-host-"));
    try {
      const install = await runCli("hooks", ["install", "--host", "codex"], root);
      expect(install.ok).toBe(true);
      expect(install.requestId).toBe("hooks.install");
      expect((install.data as any)).toMatchObject({
        schemaVersion: "archcontext.hook-adapter/v1",
        host: "codex",
        adapterName: "repo-harness-hook",
        ownership: "central-first",
        repoLocalRuntime: "not-vendored",
        writes: "manual-host-config",
        installed: true
      });
      expect((install.data as any).entrypoint).toMatchObject({
        command: "archctx",
        args: ["hook", "enqueue"],
        failOpen: true,
        egress: "none",
        network: "forbidden"
      });
      expect((install.data as any).configExample).toMatchObject({
        configPath: "~/.codex/hooks.json",
        adapter: { command: "repo-harness-hook" },
        centralFirst: true,
        repoHookSourceRequired: false
      });
      expect((install.data as any).logContract.allowedFields).toEqual([
        "schemaVersion",
        "event",
        "elapsedMs",
        "pathCount",
        "changedPathDigest",
        "reasonCode",
        "failOpen",
        "egress",
        "network"
      ]);
      expect(JSON.stringify(install.data)).not.toContain("hook_source");
      expect(JSON.stringify(install.data)).not.toContain("sourceBody");

      const status = await runCli("hooks", ["status", "--host", "claude"], root);
      expect(status.ok).toBe(true);
      expect((status.data as any)).toMatchObject({
        host: "claude",
        installed: "config-ready",
        adapterName: "repo-harness-hook",
        writes: "manual-host-config"
      });
      expect((status.data as any).configExample.configPath).toBe("~/.claude/settings.json");

      const remove = await runCli("hooks", ["remove", "--host", "generic"], root);
      expect(remove.ok).toBe(true);
      expect((remove.data as any).removeConfig).toMatchObject({
        removeAdapter: "repo-harness-hook",
        removeEntrypoint: "archctx hook enqueue",
        compatibilityEntrypoint: "archctx hook checkpoint",
        repoHookSourceRequired: false
      });

      const uninstall = await runCli("hooks", ["uninstall", "--host", "generic"], root);
      expect(uninstall.ok).toBe(true);
      expect(uninstall.requestId).toBe("hooks.uninstall");
      expect((uninstall.data as any).removeConfig.removeEntrypoint).toBe("archctx hook enqueue");

      const doctor = await runCli("hooks", ["doctor", "--host", "codex"], root);
      expect(doctor.ok).toBe(true);
      expect(doctor.requestId).toBe("hooks.doctor");
      expect((doctor.data as any).checks).toContainEqual(expect.objectContaining({
        id: "entrypoint",
        status: "pass",
        command: "archctx hook enqueue"
      }));

      const invalid = await runCli("hooks", ["install", "--host", "unknown"], root);
      expect(invalid.ok).toBe(false);
      expect((invalid as any).error.code).toBe("AC_SCHEMA_INVALID");
    } finally {
      removeTempRoot(root);
    }
  });

  test("CLI exposes runtime agent jobs list show cancel and retry operations", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-jobs-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const calls: any[] = [];
      const queuedJob = {
        job: { jobId: "agent_job.cli_test", status: "queued" },
        attemptCount: 0
      };
      const runtimeClient = {
        jobsEnqueueGitHook(_root: string, input: any) {
          calls.push({ method: "enqueue", input });
          return {
            schemaVersion: "archcontext.envelope/v1",
            ok: true,
            requestId: "jobs.enqueueGitHook",
            data: {
              enqueued: true,
              deduplicated: false,
              record: {
                ...queuedJob,
                job: {
                  ...queuedJob.job,
                  runnerPort: input.runnerPort ?? "codex"
                }
              }
            }
          };
        },
        jobsList(_root: string, input: any) {
          calls.push({ method: "list", input });
          return {
            schemaVersion: "archcontext.envelope/v1",
            ok: true,
            requestId: "jobs.list",
            data: { jobs: [queuedJob], count: 1 }
          };
        },
        jobsStats(_root: string, input: any) {
          calls.push({ method: "stats", input });
          return {
            schemaVersion: "archcontext.envelope/v1",
            ok: true,
            requestId: "jobs.stats",
            data: { schemaVersion: "archcontext.runtime-agent-job-queue-stats/v1", queuedDepth: 1, runningDepth: 0 }
          };
        },
        jobsCancel(_root: string, input: any) {
          calls.push({ method: "cancel", input });
          return {
            schemaVersion: "archcontext.envelope/v1",
            ok: true,
            requestId: "jobs.cancel",
            data: { job: { ...queuedJob, job: { ...queuedJob.job, status: input.status ?? "cancelled" } } }
          };
        },
        jobsRetry(_root: string, input: any) {
          calls.push({ method: "retry", input });
          return {
            schemaVersion: "archcontext.envelope/v1",
            ok: true,
            requestId: "jobs.retry",
            data: { job: queuedJob }
          };
        }
      };

      const list = await runCli("jobs", ["list", "--status", "queued,failed"], root, { runtimeClient: runtimeClient as any });
      expect(list.ok).toBe(true);
      expect(list.requestId).toBe("jobs.list");
      expect(calls[0]).toEqual({ method: "list", input: { statuses: ["queued", "failed"] } });

      const stats = await runCli("jobs", ["stats", "--now", "2026-06-25T02:00:00.000Z"], root, { runtimeClient: runtimeClient as any });
      expect(stats.ok).toBe(true);
      expect(stats.requestId).toBe("jobs.stats");
      expect(calls.find((call) => call.method === "stats").input).toEqual({ now: "2026-06-25T02:00:00.000Z" });

      const show = await runCli("jobs", ["show", "agent_job.cli_test"], root, { runtimeClient: runtimeClient as any });
      expect(show.ok).toBe(true);
      expect(show.requestId).toBe("jobs.show");
      expect((show.data as any).job.job.jobId).toBe("agent_job.cli_test");

      const cancel = await runCli("jobs", ["cancel", "agent_job.cli_test", "--reason", "manual"], root, { runtimeClient: runtimeClient as any });
      expect(cancel.ok).toBe(true);
      expect(cancel.requestId).toBe("jobs.cancel");
      expect(calls.find((call) => call.method === "cancel").input).toMatchObject({
        jobId: "agent_job.cli_test",
        reason: "manual"
      });

      const retry = await runCli("jobs", ["retry", "agent_job.cli_test", "--reason", "transient"], root, { runtimeClient: runtimeClient as any });
      expect(retry.ok).toBe(true);
      expect(retry.requestId).toBe("jobs.retry");
      expect(calls.find((call) => call.method === "retry").input).toMatchObject({
        jobId: "agent_job.cli_test",
        reason: "transient"
      });

      const investigate = await runCli("investigate", [
        "--runner-port",
        "claude",
        "--source",
        "staged",
        "--event",
        "manual-investigation",
        "--analysis-kind",
        "architecture-delta",
        "--task-session-id",
        "task_cli_agents",
        "--max-attempts",
        "2",
        "--max-queued-jobs",
        "4",
        "--context-max-items",
        "3",
        "--priority",
        "9",
        "--risk",
        "high",
        "--uncertainty",
        "high",
        "--cooldown-ms",
        "1000",
        "--coalesce-key",
        "coalesce.cli-agents"
      ], root, { runtimeClient: runtimeClient as any });
      expect(investigate.ok).toBe(true);
      expect(investigate.requestId).toBe("investigate");
      expect((investigate.data as any)).toMatchObject({
        schemaVersion: "archcontext.investigate-enqueue/v1",
        enqueued: true,
        runnerPort: "claude-code",
        source: "staged",
        event: "manual-investigation",
        analysisKind: "architecture-delta"
      });
      expect(calls.find((call) => call.method === "enqueue").input).toMatchObject({
        source: "staged",
        event: "manual-investigation",
        runnerPort: "claude-code",
        taskSessionId: "task_cli_agents",
        maxAttempts: 2,
        maxQueuedJobs: 4,
        contextMaxItems: 3,
        priority: 9,
        risk: "high",
        uncertainty: "high",
        policyRequestedInvestigation: true,
        cooldownMs: 1000,
        coalesceKey: "coalesce.cli-agents"
      });

      const agentsStatus = await runCli("agents", ["status", "--status", "queued,running", "--now", "2026-06-25T02:00:00.000Z"], root, { runtimeClient: runtimeClient as any });
      expect(agentsStatus.ok).toBe(true);
      expect(agentsStatus.requestId).toBe("agents.status");
      expect((agentsStatus.data as any)).toMatchObject({
        schemaVersion: "archcontext.agent-status/v1",
        statuses: ["queued", "running"],
        count: 1
      });
      expect(calls.filter((call) => call.method === "stats").at(-1).input).toEqual({ now: "2026-06-25T02:00:00.000Z" });
      expect(calls.filter((call) => call.method === "list").at(-1).input).toEqual({ statuses: ["queued", "running"] });

      const agentsBudget = await runCli("agents", ["budget"], root, { runtimeClient: runtimeClient as any });
      expect(agentsBudget.ok).toBe(true);
      expect(agentsBudget.requestId).toBe("agents.budget");
      expect((agentsBudget.data as any)).toMatchObject({
        schemaVersion: "archcontext.agent-budget/v1",
        spawnPolicy: {
          maxRunsPerTask: 1,
          maxRunsPerRepositoryPerDay: 4,
          maxAutomaticRunsForLowRisk: 0,
          adapterEnabledByRuntimeEnqueue: true
        },
        queuePolicy: {
          maxQueuedJobs: 32,
          maxRunningJobsPerRepository: 1
        },
        authority: "local-runtime-daemon"
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("CLI exposes recommendation lifecycle and metrics commands", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-recommendations-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const calls: any[] = [];
      const runtimeClient = {
        recommendations(_root: string, input: any) {
          calls.push(input);
          return {
            schemaVersion: "archcontext.envelope/v1",
            ok: true,
            requestId: `recommendations.${input.command}`,
            data: {
              schemaVersion: input.command === "metrics"
                ? "archcontext.recommendation-lifecycle-metrics/v1"
                : "archcontext.runtime-recommendation-lifecycle/v1",
              input
            }
          };
        }
      };

      const accepted = await runCli("recommendations", [
        "accept",
        "--id", "recommendation.cli_test",
        "--reason", "accepted after local readback",
        "--actor", "developer.al8",
        "--expected-worktree-digest", `sha256:${"1".repeat(64)}`,
        "--agent-job-id", "agent_job.cli"
      ], root, { runtimeClient: runtimeClient as any });
      expect(accepted.ok).toBe(true);
      expect(calls[0]).toMatchObject({
        command: "accept",
        recommendationId: "recommendation.cli_test",
        reason: "accepted after local readback",
        actor: "developer.al8",
        expectedWorktreeDigest: `sha256:${"1".repeat(64)}`,
        agentJobId: "agent_job.cli"
      });

      const metrics = await runCli("recommendations", ["metrics", "--now", "2026-06-26T12:00:00.000Z"], root, { runtimeClient: runtimeClient as any });
      expect(metrics.ok).toBe(true);
      expect(calls[1]).toEqual({ command: "metrics", now: "2026-06-26T12:00:00.000Z" });

      const missingReason = await runCli("recommendations", ["reject", "--id", "recommendation.cli_test"], root, { runtimeClient: runtimeClient as any });
      expect(missingReason.ok).toBe(false);
      expect((missingReason as any).error.code).toBe("AC_SCHEMA_INVALID");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("CLI docs commands keep Context7 manual and lockfile explicit", async () => {
    const root = createInitializedGitRepo();
    try {
      const status = await runTestCli("docs", ["status"], root);
      expect(status.ok).toBe(true);
      expect((status.data as any)).toMatchObject({
        schemaVersion: "archcontext.external-docs-status/v1",
        provider: "context7",
        defaultPrepareEgress: "none"
      });
      expect((status.data as any).health).toMatchObject({
        enabled: false,
        egress: "none"
      });

      const blockedResolve = await runTestCli("docs", ["resolve", "--library", "React", "--query", "state hooks"], root);
      expect(blockedResolve.ok).toBe(false);
      expect((blockedResolve as any).error.message).toContain("--allow-network");

      const pinPreview = await runTestCli("docs", ["pin", "--library-id", "/facebook/react", "--version", "18.2.0"], root);
      expect(pinPreview.ok).toBe(true);
      expect((pinPreview.data as any).approved).toBe(false);
      expect(existsSync(join(root, ".archcontext", "integrations", "context7.lock.yaml"))).toBe(false);

      const pin = await runTestCli("docs", ["pin", "--library-id", "/facebook/react", "--version", "18.2.0", "--approved"], root);
      expect(pin.ok).toBe(true);
      expect((pin.data as any).approved).toBe(true);
      const lockPath = join(root, ".archcontext", "integrations", "context7.lock.yaml");
      expect(JSON.parse(readFileSync(lockPath, "utf8"))).toMatchObject({
        schemaVersion: "archcontext.context7-lock/v1",
        provider: "context7",
        libraries: [{ libraryId: "/facebook/react", version: "18.2.0" }]
      });

      const blockedFetch = await runTestCli("docs", ["fetch", "--library-id", "/facebook/react", "--intent", "state hooks"], root);
      expect(blockedFetch.ok).toBe(false);
      expect((blockedFetch as any).error.message).toContain("--allow-network");
    } finally {
      removeTempRoot(root);
    }
  }, CLI_DOCS_TEST_TIMEOUT_MS);

  test("first-party skills keep checkpoint SOP separate from practice logic", () => {
    const skillFiles = [
      "skills/archcontext-bootstrap/SKILL.md",
      "skills/archcontext-develop/SKILL.md",
      "skills/archcontext-intervene/SKILL.md",
      "skills/archcontext-review/SKILL.md"
    ];
    const forbidden = [
      "compatibility.single-owner",
      "modularity.no-new-cycle",
      "required-test-evidence",
      "candidateTerms",
      "structuralPredicates",
      "matchPracticesForTask"
    ];
    for (const file of skillFiles) {
      const body = readFileSync(join(process.cwd(), file), "utf8");
      expect(body).toContain("SOP");
      for (const token of forbidden) expect(body).not.toContain(token);
    }
    const develop = readFileSync(join(process.cwd(), "skills/archcontext-develop/SKILL.md"), "utf8");
    expect(develop).toContain("archcontext_checkpoint");
    expect(develop).toContain("added/upgraded");
    expect(develop).toContain("removed/downgraded");
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
  }, 15_000);

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
  }, GITHUB_REVIEW_TEST_TIMEOUT_MS);

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
  }, DAEMON_TEST_TIMEOUT_MS);

  test("CLI plans YAML to ledger migration as a read-only dry-run", async () => {
    const root = createInitializedGitRepo();
    try {
      const result = await runTestCli("ledger", ["migrate", "--from-yaml", "--dry-run"], root);
      expect(result.ok).toBe(true);
      expect((result.data as any).schemaVersion).toBe("archcontext.runtime-architecture-ledger-migrate/v1");
      expect((result.data as any).status).toBe("planned");
      expect((result.data as any).sourceMode).toBe("git-yaml");
      expect((result.data as any).dryRun).toBe(true);
      expect((result.data as any).append).toMatchObject({ status: "not-applied" });
      expect((result.data as any).writes).toBe("none");
      expect((result.data as any).backup).toMatchObject({ status: "not-created", reason: "dry-run" });
      expect((result.data as any).verification).toMatchObject({ status: "not-run", reason: "dry-run" });
      expect((result.data as any).graphDigest).toMatch(/^sha256:/);
      expect((result.data as any).drift).toMatchObject({ ok: true, semanticDrift: false });
      expect((result.data as any).ignoredFiles).toContainEqual({
        path: ".archcontext/generated/ARCHITECTURE.md",
        reasonCode: "generated-projection"
      });
      const state = await runTestCli("ledger", ["state"], root);
      expect((state.data as any).ledger.entityCount).toBe(0);
    } finally {
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("CLI rebuilds ledger from Git, reports drift, and projects back to Git", async () => {
    const root = createInitializedGitRepo();
    const projectionPath = ".archcontext/model/nodes/capability.architecture-context.yaml";
    try {
      let status = await runTestCli("status", [], root);
      const rebuild = await runTestCli("ledger", [
        "rebuild",
        "--from-git",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], root);
      expect(rebuild.ok).toBe(true);
      expect((rebuild.data as any).schemaVersion).toBe("archcontext.runtime-architecture-ledger-rebuild/v1");
      expect((rebuild.data as any).appendedEventCount).toBe(1);
      expect((rebuild.data as any).graphDigest).toMatch(/^sha256:/);

      rmSync(join(root, projectionPath), { force: true });
      const drift = await runTestCli("ledger", ["drift", "--json"], root);
      expect(drift.ok).toBe(true);
      expect((drift.data as any).drift.reasonCodes).toContain("projection-file-missing");
      expect((drift.data as any).reconcile.schemaVersion).toBe("archcontext.architecture-ledger-reconcile/v1");
      expect((drift.data as any).reconcile.ledgerToGit.reasonCodes).toContain("projection-file-missing");
      expect((drift.data as any).reconcile.gitToLedger.reasonCodes).toContain("semantic-drift");
      expect((drift.data as any).reconcile.reconcileActions.map((action: any) => action.authority)).toContain("ledger");

      status = await runTestCli("status", [], root);
      const project = await runTestCli("ledger", [
        "project",
        "--to-git",
        "--write",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], root);
      expect(project.ok).toBe(true);
      expect((project.data as any).writes).toBe("git-projection");
      expect((project.data as any).writtenPaths).toContain(projectionPath);
      expect((project.data as any).reconcile.ok).toBe(true);
      expect(readFileSync(join(root, projectionPath), "utf8")).toContain("capability.architecture-context");

      const clean = await runTestCli("ledger", ["drift", "--json"], root);
      expect((clean.data as any).drift.ok).toBe(true);
      expect((clean.data as any).reconcile.ok).toBe(true);
    } finally {
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("CLI Book commands read ledger state, timeline, diff, evidence and exports with freshness", async () => {
    const root = createInitializedGitRepo();
    try {
      let status = await runTestCli("status", [], root);
      const rebuild = await runTestCli("ledger", [
        "rebuild",
        "--from-git",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], root);
      expect(rebuild.ok).toBe(true);

      const bookStatus = await runTestCli("book", ["status"], root);
      expect(bookStatus.ok).toBe(true);
      expect((bookStatus.data as any).schemaVersion).toBe("archcontext.book-status/v1");
      expect((bookStatus.data as any).freshness.graphDigest).toBe((rebuild.data as any).graphDigest);
      expect((bookStatus.data as any).freshness.ledgerCursor.eventCount).toBeGreaterThan(0);
      expect((bookStatus.data as any).counts.entities).toBeGreaterThan(0);

      const query = await runTestCli("book", ["query", "--task", "architecture context", "--max-items", "2", "--explain"], root);
      expect(query.ok).toBe(true);
      expect((query.data as any).schemaVersion).toBe("archcontext.architecture-book-query/v1");
      expect((query.data as any).results.map((result: any) => result.id)).toContain("capability.architecture-context");
      expect((query.data as any).results[0].scoreBreakdown.graphDistance).toBeGreaterThan(0);
      expect((query.data as any).results[0].scoreBreakdown.recency).toBeGreaterThan(0);
      expect((query.data as any).results[0].explanation.schemaVersion).toBe("archcontext.architecture-book-selection-explanation/v1");
      expect((query.data as any).results[0].explanation.reasonCodes.length).toBeGreaterThan(0);
      expect((query.data as any).freshness.worktreeDigest).toBeTruthy();

      const show = await runTestCli("book", ["show", "capability.architecture-context"], root);
      expect(show.ok).toBe(true);
      expect((show.data as any).subject.summary).toContain("architecture intent");

      const neighbors = await runTestCli("book", ["neighbors", "capability.architecture-context", "--depth", "1"], root);
      expect(neighbors.ok).toBe(true);
      expect((neighbors.data as any).nodes.map((node: any) => node.id)).toContain("capability.architecture-context");

      const timeline = await runTestCli("book", ["timeline", "capability.architecture-context"], root);
      expect(timeline.ok).toBe(true);
      expect((timeline.data as any).events[0].affectedSubjects).toContain("capability.architecture-context");
      const allTimeline = await runTestCli("book", ["timeline"], root);
      expect(allTimeline.ok).toBe(true);
      const firstTimestamp = (allTimeline.data as any).events[0].timestamp;
      expect(Date.parse(firstTimestamp)).not.toBeNaN();

      const diff = await runTestCli("book", ["diff", "--from", "empty", "--to", "current"], root);
      expect(diff.ok).toBe(true);
      expect((diff.data as any).summary.added).toBeGreaterThan(0);
      expect((diff.data as any).changes[0]).toHaveProperty("evidenceIds");
      expect((diff.data as any).changes[0]).toHaveProperty("evidenceBindingIds");
      const headSha = (bookStatus.data as any).freshness.headSha;
      const commitDiff = await runTestCli("book", ["diff", "--from", "empty", "--to", `commit:${headSha}`], root);
      expect(commitDiff.ok).toBe(true);
      expect((commitDiff.data as any).toGraphDigest).toBe((diff.data as any).toGraphDigest);
      const timestampDiff = await runTestCli("book", ["diff", "--from", "empty", "--to", `timestamp:${firstTimestamp}`], root);
      expect(timestampDiff.ok).toBe(true);
      expect((timestampDiff.data as any).summary.added).toBeGreaterThan(0);
      const snapshotStore = new SqliteLocalStore(testRuntimePaths(root).localStorePath);
      const snapshot = await snapshotStore.createArchitectureLedgerSnapshot({
        repository: (bookStatus.data as any).freshness.repository,
        worktree: (bookStatus.data as any).freshness.worktree,
        sourceMode: "ledger-shadow",
        projectionDigest: (bookStatus.data as any).freshness.projectionDigest,
        inputDigests: { modelDigest: (bookStatus.data as any).freshness.graphDigest },
        createdAt: "2026-06-26T00:00:00.000Z"
      });
      snapshotStore.close();
      const snapshotDiff = await runTestCli("book", ["diff", "--from", "empty", "--to", `snapshot:${snapshot.snapshotId}`], root);
      expect(snapshotDiff.ok).toBe(true);
      expect((snapshotDiff.data as any).toGraphDigest).toBe((diff.data as any).toGraphDigest);

      const evidence = await runTestCli("book", ["evidence", "product.review-app"], root);
      expect(evidence.ok).toBe(true);
      expect((evidence.data as any).evidenceItems.length).toBeGreaterThan(0);
      expect(JSON.stringify(evidence.data)).not.toContain("README");

      const recommendations = await runTestCli("book", ["recommendations", "--open", "--explain"], root);
      expect(recommendations.ok).toBe(true);
      expect((recommendations.data as any).schemaVersion).toBe("archcontext.architecture-book-recommendations/v1");
      expect((recommendations.data as any).recommendations).toEqual([]);
      expect((recommendations.data as any).explanations).toEqual([]);

      const exported = await runTestCli("book", ["export", "--format", "markdown"], root);
      expect(exported.ok).toBe(true);
      expect((exported.data as any).markdown).toContain("# Architecture Book");
      expect((exported.data as any).freshness.projectionDigest).toMatch(/^sha256:/);

      for (const response of [bookStatus, query, show, neighbors, timeline, allTimeline, diff, evidence, recommendations, exported]) {
        const data = response.data as any;
        expect(data.freshness.schemaVersion).toBe("archcontext.book-freshness/v1");
        expect(data.provenance.schemaVersion).toBe("archcontext.book-provenance/v1");
        expect(data.provenance.graphDigest).toBe(data.freshness.graphDigest);
        expect(data.provenance.projectionDigest).toBe(data.freshness.projectionDigest);
        expect(data.provenance.ledgerCursor.eventCount).toBe(data.freshness.ledgerCursor.eventCount);
      }

      status = await runTestCli("status", [], root);
      expect((status.data as any).running).toBe(true);
    } finally {
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("CLI rollback restores YAML authority projection with backup", async () => {
    const root = createInitializedGitRepo();
    const projectionPath = ".archcontext/model/nodes/capability.architecture-context.yaml";
    const stalePath = ".archcontext/model/nodes/module.cli-rollback-stale.yaml";
    try {
      let status = await runTestCli("status", [], root);
      const rebuild = await runTestCli("ledger", [
        "rebuild",
        "--from-git",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], root);
      expect(rebuild.ok).toBe(true);
      const canonicalProjection = readFileSync(join(root, projectionPath), "utf8");
      writeFileSync(join(root, projectionPath), canonicalProjection.replace("Keeps product and architecture intent available to coding agents.", "CLI rollback corrupted projection."), "utf8");
      writeFileSync(join(root, stalePath), "schemaVersion: archcontext.node/v1\nid: module.cli-rollback-stale\nkind: module\nname: CLI Rollback Stale\nstatus: active\nsummary: CLI rollback stale projection\n", "utf8");

      const dryRun = await runTestCli("ledger", ["rollback", "--to-yaml", "--dry-run"], root);
      expect(dryRun.ok).toBe(true);
      expect((dryRun.data as any).dryRun).toBe(true);
      expect((dryRun.data as any).drift.ok).toBe(false);
      expect(existsSync(join(root, stalePath))).toBe(true);

      status = await runTestCli("status", [], root);
      const rollback = await runTestCli("ledger", [
        "rollback",
        "--to-yaml",
        "--write",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], root);
      expect(rollback.ok).toBe(true);
      expect((rollback.data as any).schemaVersion).toBe("archcontext.runtime-architecture-ledger-rollback/v1");
      expect((rollback.data as any).targetAuthority).toBe("yaml");
      expect((rollback.data as any).removedPaths).toContain(stalePath);
      expect((rollback.data as any).writtenPaths).toContain(projectionPath);
      expect((rollback.data as any).drift.ok).toBe(true);
      const backup = (rollback.data as any).backup;
      expect(existsSync(join(root, backup.manifestPath))).toBe(true);
      expect(readFileSync(join(root, backup.path, "model/nodes/capability.architecture-context.yaml"), "utf8")).toContain("CLI rollback corrupted projection.");
      expect(existsSync(join(root, stalePath))).toBe(false);
      expect(readFileSync(join(root, projectionPath), "utf8")).toBe(canonicalProjection);
      expect((await runTestCli("validate", [], root)).ok).toBe(true);
    } finally {
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("CLI migrate writes through daemon-owned backup and verification workflow", async () => {
    const root = createInitializedGitRepo();
    try {
      const dryRun = await runTestCli("ledger", ["migrate", "--from-yaml", "--dry-run"], root);
      expect(dryRun.ok).toBe(true);
      expect((dryRun.data as any)).toMatchObject({
        schemaVersion: "archcontext.runtime-architecture-ledger-migrate/v1",
        status: "planned",
        dryRun: true,
        writes: "none",
        backup: { status: "not-created" },
        append: { status: "not-applied" }
      });
      expect((dryRun.data as any).architectureLedger.phaseFlags).toMatchObject({
        activePhase: "yaml",
        safeDowngrade: {
          to: "yaml"
        }
      });

      const missingDigest = await runTestCli("ledger", ["migrate", "--from-yaml", "--write"], root);
      expect(missingDigest.ok).toBe(false);
      expect((missingDigest as any).error.code).toBe("AC_SCHEMA_INVALID");

      const status = await runTestCli("status", [], root);
      const migrated = await runTestCli("ledger", [
        "migrate",
        "--from-yaml",
        "--write",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], root);

      expect(migrated.ok).toBe(true);
      expect((migrated.data as any)).toMatchObject({
        schemaVersion: "archcontext.runtime-architecture-ledger-migrate/v1",
        status: "verified",
        dryRun: false,
        writes: "architecture-ledger",
        backup: {
          schemaVersion: "archcontext.runtime-architecture-ledger-sqlite-backup/v1",
          status: "created",
          integrity: "ok"
        },
        verification: {
          ok: true,
          driftOk: true,
          reconcileOk: true
        },
        recommendedEnvironment: {
          ARCHCONTEXT_LEDGER_MODE: "dual"
        }
      });
      expect(existsSync((migrated.data as any).backup.backupPath)).toBe(true);
      expect(JSON.stringify(migrated.data)).not.toContain("schemaVersion: archcontext.node/v1");
      const state = await runTestCli("ledger", ["state"], root);
      expect((state.data as any).ledger.entityCount).toBeGreaterThan(0);
      expect((state.data as any).drift.ok).toBe(true);
    } finally {
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("CLI rebuild reproduces graph after SQLite deletion and project restores deleted YAML", async () => {
    const root = createInitializedGitRepo();
    const projectionPath = ".archcontext/model/nodes/capability.architecture-context.yaml";
    try {
      mkdirSync(join(root, "docs/adr"), { recursive: true });
      writeFileSync(join(root, "docs/adr/ADR-0099-cli-ledger-import.md"), [
        "---",
        "schemaVersion: archcontext.adr/v1",
        "id: adr.0099.cli-ledger-import",
        "title: CLI Ledger Import",
        "status: accepted",
        "decidedAt: 2026-06-25",
        "appliesTo:",
        "  - package.surfaces-cli",
        "supersedes: []",
        "---",
        "",
        "# CLI Ledger Import",
        ""
      ].join("\n"), "utf8");
      git(root, "add", "docs/adr/ADR-0099-cli-ledger-import.md");
      git(root, "commit", "-m", "add cli ledger import adr");

      let status = await runTestCli("status", [], root);
      const first = await runTestCli("ledger", [
        "rebuild",
        "--from-git",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], root);
      expect(first.ok).toBe(true);
      expect((first.data as any).imported).toContainEqual(expect.objectContaining({
        path: "docs/adr/ADR-0099-cli-ledger-import.md",
        targetKind: "evidence",
        targetId: "adr.0099.cli-ledger-import"
      }));
      const firstGraphDigest = (first.data as any).graphDigest;
      const originalProjection = readFileSync(join(root, projectionPath), "utf8");

      const paths = testRuntimePaths(root);
      await removeRuntimeSqliteFiles(paths.localStorePath);
      status = await runTestCli("status", [], root);
      const rebuilt = await runTestCli("ledger", [
        "rebuild",
        "--from-git",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], root);
      expect(rebuilt.ok).toBe(true);
      expect((rebuilt.data as any).graphDigest).toBe(firstGraphDigest);

      rmSync(join(root, projectionPath), { force: true });
      status = await runTestCli("status", [], root);
      const project = await runTestCli("ledger", [
        "project",
        "--to-git",
        "--write",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], root);
      expect(project.ok).toBe(true);
      expect((project.data as any).writtenPaths).toContain(projectionPath);
      expect(readFileSync(join(root, projectionPath), "utf8")).toBe(originalProjection);
      expect(((await runTestCli("ledger", ["drift", "--json"], root)).data as any).drift.ok).toBe(true);
    } finally {
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("CLI refreshes ledger cursor across branch, reset, rebase, and worktree changes", async () => {
    const root = createInitializedGitRepo();
    try {
      let status = await runTestCli("status", [], root);
      const initial = await runTestCli("ledger", [
        "rebuild",
        "--from-git",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], root);
      expect(initial.ok).toBe(true);
      expect((initial.data as any).status).toBe("rebuilt");
      const initialGraphDigest = (initial.data as any).graphDigest;
      const initialBranch = gitOut(root, "rev-parse", "--abbrev-ref", "HEAD");

      git(root, "checkout", "-b", "feature/cursor-refresh");
      writeFileSync(join(root, "README.md"), "# cursor refresh\n", "utf8");
      git(root, "add", "README.md");
      git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "cursor refresh");
      status = await runTestCli("status", [], root);
      const branchRefresh = await runTestCli("ledger", [
        "rebuild",
        "--from-git",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], root);
      expect(branchRefresh.ok).toBe(true);
      expect((branchRefresh.data as any).status).toBe("cursor-refreshed");
      expect((branchRefresh.data as any).graphDigest).toBe(initialGraphDigest);
      expect((branchRefresh.data as any).cursor).toMatchObject({
        changed: true,
        branch: "feature/cursor-refresh",
        headSha: gitOut(root, "rev-parse", "HEAD")
      });

      git(root, "reset", "--hard", "HEAD~1");
      status = await runTestCli("status", [], root);
      const resetRefresh = await runTestCli("ledger", [
        "rebuild",
        "--from-git",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], root);
      expect(resetRefresh.ok).toBe(true);
      expect((resetRefresh.data as any).status).toBe("cursor-refreshed");
      expect((resetRefresh.data as any).graphDigest).toBe(initialGraphDigest);

      git(root, "checkout", initialBranch);
      writeFileSync(join(root, "BASE.md"), "# base cursor refresh\n", "utf8");
      git(root, "add", "BASE.md");
      git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "base cursor refresh");
      git(root, "checkout", "feature/cursor-refresh");
      writeFileSync(join(root, "FEATURE.md"), "# feature cursor refresh\n", "utf8");
      git(root, "add", "FEATURE.md");
      git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "feature cursor refresh");
      git(root, "rebase", initialBranch);
      status = await runTestCli("status", [], root);
      const rebaseRefresh = await runTestCli("ledger", [
        "rebuild",
        "--from-git",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], root);
      expect(rebaseRefresh.ok).toBe(true);
      expect((rebaseRefresh.data as any).status).toBe("cursor-refreshed");
      expect((rebaseRefresh.data as any).graphDigest).toBe(initialGraphDigest);

      writeFileSync(join(root, "README.md"), "# dirty cursor refresh\n", "utf8");
      status = await runTestCli("status", [], root);
      const dirtyRefresh = await runTestCli("ledger", [
        "rebuild",
        "--from-git",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], root);
      expect(dirtyRefresh.ok).toBe(true);
      expect((dirtyRefresh.data as any).status).toBe("cursor-refreshed");
      expect((dirtyRefresh.data as any).graphDigest).toBe(initialGraphDigest);
      expect((dirtyRefresh.data as any).cursor.worktreeDigest).toBe((status.data as any).worktreeDigest);
    } finally {
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("CLI keeps ledger cursor scoped across detached HEAD and simultaneous worktrees", async () => {
    const root = createInitializedGitRepo();
    const sharedStateRoot = testStateRoot(root);
    const linkedParent = mkdtempSync(join(tmpdir(), "archctx-cli-worktree-parent-"));
    const linkedRoot = join(linkedParent, "linked");
    try {
      let status = await runTestCli("status", [], root, sharedStateRoot);
      const initial = await runTestCli("ledger", [
        "rebuild",
        "--from-git",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], root, sharedStateRoot);
      expect(initial.ok).toBe(true);
      const initialGraphDigest = (initial.data as any).graphDigest;
      const initialBranch = gitOut(root, "rev-parse", "--abbrev-ref", "HEAD");
      const initialWorkspaceId = (initial.data as any).worktree.storageWorkspaceId;

      git(root, "checkout", "--detach", "HEAD");
      status = await runTestCli("status", [], root, sharedStateRoot);
      const detached = await runTestCli("ledger", [
        "rebuild",
        "--from-git",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], root, sharedStateRoot);
      expect(detached.ok).toBe(true);
      expect((detached.data as any).status).toBe("cursor-refreshed");
      expect((detached.data as any).graphDigest).toBe(initialGraphDigest);
      expect((detached.data as any).cursor.branch).toBe("detached");

      git(root, "checkout", initialBranch);
      git(root, "worktree", "add", "-b", "feature/two-worktree", linkedRoot, initialBranch);
      status = await runTestCli("status", [], linkedRoot, sharedStateRoot);
      const linked = await runTestCli("ledger", [
        "rebuild",
        "--from-git",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], linkedRoot, sharedStateRoot);
      expect(linked.ok).toBe(true);
      expect((linked.data as any).graphDigest).toBe(initialGraphDigest);
      expect((linked.data as any).worktree.storageWorkspaceId).not.toBe(initialWorkspaceId);
      expect((linked.data as any).worktree.branch).toBe("feature/two-worktree");

      const rootState = await runTestCli("ledger", ["state"], root, sharedStateRoot);
      const linkedState = await runTestCli("ledger", ["state"], linkedRoot, sharedStateRoot);
      expect((rootState.data as any).worktree.storageWorkspaceId).not.toBe((linkedState.data as any).worktree.storageWorkspaceId);
      expect((rootState.data as any).repository.storageRepositoryId).toBe((linkedState.data as any).repository.storageRepositoryId);
    } finally {
      gitExitCode(root, "worktree", "remove", "--force", linkedRoot);
      removeTempRoot(root);
      rmSync(linkedParent, { recursive: true, force: true });
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("CLI rebuild rejects merge-conflict YAML projection without mutating ledger state", async () => {
    const root = createInitializedGitRepo();
    const projectionPath = ".archcontext/model/nodes/capability.architecture-context.yaml";
    try {
      let status = await runTestCli("status", [], root);
      const initial = await runTestCli("ledger", [
        "rebuild",
        "--from-git",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], root);
      expect(initial.ok).toBe(true);
      const initialGraphDigest = (initial.data as any).graphDigest;
      const initialBranch = gitOut(root, "rev-parse", "--abbrev-ref", "HEAD");

      git(root, "checkout", "-b", "feature/ledger-merge-conflict");
      writeFileSync(join(root, projectionPath), readFileSync(join(root, projectionPath), "utf8").replace("Keeps product and architecture intent available to coding agents.", "Feature branch projection conflict."), "utf8");
      git(root, "add", projectionPath);
      git(root, "commit", "-m", "feature projection conflict");
      git(root, "checkout", initialBranch);
      writeFileSync(join(root, projectionPath), readFileSync(join(root, projectionPath), "utf8").replace("Keeps product and architecture intent available to coding agents.", "Base branch projection conflict."), "utf8");
      git(root, "add", projectionPath);
      git(root, "commit", "-m", "base projection conflict");

      expect(gitExitCode(root, "merge", "feature/ledger-merge-conflict")).not.toBe(0);
      status = await runTestCli("status", [], root);
      const rejected = await runTestCli("ledger", [
        "rebuild",
        "--from-git",
        "--expected-worktree-digest",
        (status.data as any).worktreeDigest
      ], root);
      expect(rejected.ok).toBe(false);
      expect((rejected as any).error.code).toBe("AC_SCHEMA_INVALID");

      git(root, "merge", "--abort");
      const state = await runTestCli("ledger", ["state"], root);
      expect((state.data as any).ledger.graphDigest).toBe(initialGraphDigest);
    } finally {
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

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
