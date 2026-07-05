import { describe, expect, test } from "bun:test";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";

const ROOT = process.cwd();
const SINGLE_REPO_FIXTURE_ROOT = join(ROOT, "packages/surfaces/cli/test/fixtures/single-repo-basic");
const MONOREPO_FIXTURE_ROOT = join(ROOT, "packages/surfaces/cli/test/fixtures/monorepo-basic");
const BIN_DIR = join(ROOT, "node_modules", ".bin");
const ARCHCTX_BIN = resolveArchctxBin();
const CODEGRAPH_BIN = resolveCodeGraphBin();
const ARCHCTX_PROCESS_TIMEOUT_MS = process.platform === "win32" ? 90_000 : 15_000;
const LOCAL_PRODUCT_E2E_TIMEOUT_MS = process.platform === "win32" ? 210_000 : 30_000;

describe("local product first-experience E2E", () => {
  test("installed archctx works against an ordinary single Git repository", async () => {
    await runFirstExperience(SINGLE_REPO_FIXTURE_ROOT, {
      tempPrefix: "archctx-single-repo-e2e-",
      productName: "Single Repo E2E",
      changedPath: "src/index.ts",
      task: "inspect greeting module",
      taskSessionId: "task_single_repo_e2e"
    });
  }, LOCAL_PRODUCT_E2E_TIMEOUT_MS);

  test("installed archctx treats a workspace monorepo as one local repository", async () => {
    await runFirstExperience(MONOREPO_FIXTURE_ROOT, {
      tempPrefix: "archctx-monorepo-e2e-",
      productName: "Monorepo E2E",
      changedPath: "packages/web/src/page.ts",
      task: "inspect workspace page rendering",
      taskSessionId: "task_monorepo_e2e",
      afterStatus(repo, status) {
        expect(status.data.sessions).toBe(1);
        expect(existsSync(join(repo, "packages", "web", "package.json"))).toBe(true);
        expect(existsSync(join(repo, "packages", "lib", "package.json"))).toBe(true);
      }
    });
  }, LOCAL_PRODUCT_E2E_TIMEOUT_MS);

  test("installed archctx rejects sibling repository input before starting the daemon", async () => {
    expect(existsSync(ARCHCTX_BIN)).toBe(true);
    const workspace = mkdtempSync(join(tmpdir(), "archctx-multirepo-reject-e2e-"));
    const repo = join(workspace, "primary");
    const otherRepo = join(workspace, "other");
    cpSync(SINGLE_REPO_FIXTURE_ROOT, repo, { recursive: true });
    cpSync(SINGLE_REPO_FIXTURE_ROOT, otherRepo, { recursive: true });
    try {
      git(repo, "init");
      git(repo, "add", ".");
      git(repo, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "primary");
      git(otherRepo, "init");
      git(otherRepo, "add", ".");
      git(otherRepo, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "other");

      // `repo add` now exits non-zero on an ok:false envelope (verify's `&&` chains rely on
      // this), so this expected-failure path must use the non-throwing raw process helper.
      const deniedRaw = await runArchctxRaw(repo, "repo", "add", "--root", otherRepo, "--name", "other");
      expect(deniedRaw.code).not.toBe(0);
      const denied = JSON.parse(deniedRaw.stdout);
      expect(denied.ok).toBe(false);
      expect(denied.error.code).toBe("AC_CAPABILITY_UNSUPPORTED");
      expect(denied.error.action).toBe("stay-within-single-repository");

      const daemonStatus = await runArchctx(repo, "daemon", "status");
      expect(daemonStatus.ok).toBe(true);
      expect(daemonStatus.data.running).toBe(false);
    } finally {
      await stopDaemonAndWait(repo);
      removeTempRoot(workspace);
    }
  }, LOCAL_PRODUCT_E2E_TIMEOUT_MS);

  test("installed hook checkpoint updates and reverts practice deltas through the daemon", async () => {
    expect(existsSync(ARCHCTX_BIN)).toBe(true);
    const workspace = mkdtempSync(join(tmpdir(), "archctx-hook-delta-e2e-"));
    const repo = join(workspace, "single-repo-basic");
    const changedPath = "src/legacy-wrapper-v1.ts";
    cpSync(SINGLE_REPO_FIXTURE_ROOT, repo, { recursive: true });
    try {
      git(repo, "init");
      git(repo, "add", ".");
      git(repo, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture");
      runCodeGraph(repo, "init", repo);

      const init = await runArchctx(repo, "init", "--name", "Hook Delta E2E");
      expect(init.ok).toBe(true);

      const prepared = await runArchctx(
        repo,
        "prepare",
        "--task", "remove legacy compatibility wrapper",
        "--task-session-id", "task_hook_delta",
        "--max-items", "5"
      );
      expect(prepared.ok).toBe(true);
      expect(practiceIds(prepared.data.context.practiceGuidance.matches)).toContain("compatibility.single-owner");

      mkdirSync(join(repo, "src"), { recursive: true });
      writeFileSync(join(repo, changedPath), "export function legacyWrapperV1() { return \"legacy\"; }\n", "utf8");

      const edited = await runArchctx(
        repo,
        "hook", "checkpoint",
        "--event", "post-edit",
        "--path", changedPath,
        "--task-session-id", "task_hook_delta",
        "--tool-call-id", "edit",
        "--max-items", "5"
      );
      expect(edited.ok).toBe(true);
      expect(edited.requestId).toBe("hook.checkpoint");
      expect(practiceIds(edited.data.delta.upgraded)).toContain("compatibility.single-owner");
      expect(edited.data.hook.pathSummary).toMatchObject({
        schemaVersion: "archcontext.checkpoint-path-summary/v1",
        total: 1,
        source: 1,
        deleted: 0
      });
      expect(edited.data.hookLog).toMatchObject({
        schemaVersion: "archcontext.hook-log/v1",
        event: "post-edit",
        pathCount: 1,
        egress: "none",
        network: "forbidden"
      });
      expect(JSON.stringify(edited.data.hookLog)).not.toContain(changedPath);

      rmSync(join(repo, changedPath), { force: true });

      const reverted = await runArchctx(
        repo,
        "hook", "checkpoint",
        "--event", "post-edit",
        "--path", changedPath,
        "--task-session-id", "task_hook_delta",
        "--tool-call-id", "revert",
        "--max-items", "5"
      );
      expect(reverted.ok).toBe(true);
      expect(reverted.requestId).toBe("hook.checkpoint");
      expect(practiceIds(reverted.data.delta.downgraded)).toContain("compatibility.single-owner");
      expect(reverted.data.hook.pathSummary).toMatchObject({
        schemaVersion: "archcontext.checkpoint-path-summary/v1",
        total: 1,
        source: 0,
        deleted: 1
      });
    } finally {
      await stopDaemonAndWait(repo);
      removeTempRoot(workspace);
    }
  }, LOCAL_PRODUCT_E2E_TIMEOUT_MS);

  test("installed hook checkpoint keeps plain import edges advisory until a declared boundary violation exists", async () => {
    expect(existsSync(ARCHCTX_BIN)).toBe(true);
    const workspace = mkdtempSync(join(tmpdir(), "archctx-hook-import-edge-e2e-"));
    const repo = join(workspace, "single-repo-basic");
    const changedPath = "src/web/page.ts";
    cpSync(SINGLE_REPO_FIXTURE_ROOT, repo, { recursive: true });
    try {
      git(repo, "init");
      git(repo, "add", ".");
      git(repo, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture");
      runCodeGraph(repo, "init", repo);

      const init = await runArchctx(repo, "init", "--name", "Import Edge E2E");
      expect(init.ok).toBe(true);

      const prepared = await runArchctx(
        repo,
        "prepare",
        "--task", "review checkout page change",
        "--task-session-id", "task_import_edge",
        "--max-items", "5"
      );
      expect(prepared.ok).toBe(true);
      expect(practiceIds(prepared.data.context.practiceGuidance.matches)).not.toContain("modularity.respect-dependency-direction");

      mkdirSync(join(repo, "src", "domain"), { recursive: true });
      mkdirSync(join(repo, "src", "web"), { recursive: true });
      writeFileSync(join(repo, "src", "domain", "order-service.ts"), "export function placeOrder() { return \"ok\"; }\n", "utf8");
      writeFileSync(join(repo, changedPath), "import { placeOrder } from \"../domain/order-service\";\nexport function renderPage() { return placeOrder(); }\n", "utf8");

      const edited = await runArchctx(
        repo,
        "hook", "checkpoint",
        "--event", "post-edit",
        "--path", changedPath,
        "--task-session-id", "task_import_edge",
        "--tool-call-id", "edit",
        "--max-items", "5"
      );
      expect(edited.ok).toBe(true);
      expect(edited.requestId).toBe("hook.checkpoint");
      expect(practiceIds(edited.data.delta.added)).not.toContain("modularity.respect-dependency-direction");
      expect(edited.data.hook.pathSummary).toMatchObject({
        schemaVersion: "archcontext.checkpoint-path-summary/v1",
        total: 1,
        source: 1,
        deleted: 0
      });
    } finally {
      await stopDaemonAndWait(repo);
      removeTempRoot(workspace);
    }
  }, LOCAL_PRODUCT_E2E_TIMEOUT_MS);
});

async function runFirstExperience(
  fixtureRoot: string,
  input: {
    tempPrefix: string;
    productName: string;
    changedPath: string;
    task: string;
    taskSessionId: string;
    afterStatus?: (repo: string, status: any) => void;
  }
) {
  expect(existsSync(ARCHCTX_BIN)).toBe(true);
  const workspace = mkdtempSync(join(tmpdir(), input.tempPrefix));
  const repo = join(workspace, basename(fixtureRoot));
  cpSync(fixtureRoot, repo, { recursive: true });
  try {
    git(repo, "init");
    git(repo, "add", ".");
    git(repo, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture");
    const headSha = gitOut(repo, "rev-parse", "HEAD");
    runCodeGraph(repo, "init", repo);

    const doctor = await runArchctx(repo, "doctor");
    expect(doctor.ok).toBe(true);
    expect(doctor.data.git).toMatchObject({ ok: true, headSha });
    expectSameExistingPath(doctor.data.git.root, repo);
    expect(doctor.data.codeGraph.requiredVersion).toBe("1.0.1");
    expect(doctor.data.egress).toMatchObject({
      ok: true,
      defaultOutbound: "local-only",
      cloudContentUpload: "deny",
      secureMcpTunnel: "disabled-by-default",
      thirdPartyTelemetry: "disabled",
      codeGraph: {
        telemetry: "disabled",
        envVar: "DO_NOT_TRACK",
        configuredValue: "1",
        effectiveValue: "1",
        source: "environment"
      }
    });

    const mcpStatus = await runArchctx(repo, "mcp", "status", "--host", "codex");
    expect(mcpStatus.ok).toBe(true);
    expect(mcpStatus.data.config.mcpServers.archcontext).toEqual({ command: "archctx", args: ["mcp"] });

    const init = await runArchctx(repo, "init", "--name", input.productName);
    expect(init.ok).toBe(true);
    expect(existsSync(join(repo, ".archcontext", "model"))).toBe(true);

    const sync = await runArchctx(repo, "sync", "--changed", input.changedPath);
    expect(sync.ok).toBe(true);
    expect(sync.data.codeFactsDigest).toMatch(/^sha256:/);

    const prepared = await runArchctx(repo, "prepare", "--task", input.task, "--max-items", "2");
    expect(prepared.ok).toBe(true);
    expect(prepared.data.posture).toBeTruthy();

    const status = await runArchctx(repo, "status");
    expect(status.ok).toBe(true);
    expect(status.data.running).toBe(true);
    expect(status.data.sessions).toBe(1);
    expect(status.data.worktreeDigest).toMatch(/^sha256:/);
    input.afterStatus?.(repo, status);

    const checkpoint = await runArchctx(repo, "checkpoint", "--expected-worktree-digest", status.data.worktreeDigest, "--max-items", "2");
    expect(checkpoint.ok).toBe(true);
    expect(checkpoint.data.fresh).toBe(true);
    expect(checkpoint.data.schemaVersion).toBe("archcontext.practice-checkpoint/v1");
    expect(checkpoint.data.reasonCode).toBe("no-op");
    expect(checkpoint.data.hook.egress).toBe("none");

    const complete = await runArchctx(
      repo,
      "complete",
      "--task-session-id",
      input.taskSessionId,
      "--head-sha",
      headSha
    );
    expect(complete.ok).toBe(true);
    expect(complete.data.schemaVersion).toBe("archcontext.review/v1");
  } finally {
    await stopDaemonAndWait(repo);
    removeTempRoot(workspace);
  }
}

function git(repo: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: repo, env: testEnv(), stdio: ["ignore", "pipe", "pipe"] });
}

function gitOut(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, env: testEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function runCodeGraph(repo: string, ...args: string[]): void {
  execFileSync(CODEGRAPH_BIN, args, { cwd: repo, env: testEnv(), stdio: ["ignore", "pipe", "pipe"] });
}

function practiceIds(matches: any[]): string[] {
  return matches.map((match) => match.practiceId);
}

function runArchctx(cwd: string, ...args: string[]): Promise<any> {
  return new Promise((resolvePromise, rejectPromise) => {
    const label = `archctx ${args.join(" ")}`;
    const child = spawn(ARCHCTX_BIN, args, {
      cwd,
      env: testEnv()
    });
    collectProcess(child, label)
      .then(({ stdout, stderr, code }) => {
        if (code !== 0) {
          rejectPromise(new Error(`${label} failed (${code}): ${stderr || stdout}`));
          return;
        }
        resolvePromise(JSON.parse(stdout));
      })
      .catch(rejectPromise);
  });
}

function runArchctxRaw(cwd: string, ...args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const label = `archctx ${args.join(" ")}`;
  const child = spawn(ARCHCTX_BIN, args, {
    cwd,
    env: testEnv()
  });
  return collectProcess(child, label);
}

function collectProcess(child: ChildProcessWithoutNullStreams, label: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectPromise(new Error(`Timed out waiting for process: ${label}: ${stderr || stdout}`));
    }, ARCHCTX_PROCESS_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolvePromise({ stdout, stderr, code });
    });
  });
}

function testEnv() {
  return {
    ...process.env,
    DO_NOT_TRACK: "1",
    PATH: `${BIN_DIR}${delimiter}${process.env.PATH ?? ""}`
  };
}

function resolveArchctxBin(): string {
  const candidates = process.platform === "win32"
    ? [join(BIN_DIR, "archctx.cmd"), join(BIN_DIR, "archctx.exe"), join(BIN_DIR, "archctx")]
    : [join(BIN_DIR, "archctx")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function resolveCodeGraphBin(): string {
  const candidates = process.platform === "win32"
    ? [join(BIN_DIR, "codegraph.cmd"), join(BIN_DIR, "codegraph.exe"), join(BIN_DIR, "codegraph")]
    : [join(BIN_DIR, "codegraph")];
  return candidates.find((candidate) => existsSync(candidate)) ?? "codegraph";
}

async function stopDaemonAndWait(root: string): Promise<void> {
  await runArchctx(root, "daemon", "stop").catch(() => undefined);
  await expectFileRemoved(join(root, ".archcontext", ".local", "archctxd.json")).catch(() => undefined);
  await expectFileRemoved(join(root, ".archcontext", ".local", "archctxd.lock")).catch(() => undefined);
}

async function expectFileRemoved(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!existsSync(path)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`Timed out waiting for file removal: ${path}`);
}

function removeTempRoot(root: string): void {
  try {
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
