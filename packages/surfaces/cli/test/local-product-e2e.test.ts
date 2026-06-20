import { describe, expect, test } from "bun:test";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";

const ROOT = process.cwd();
const SINGLE_REPO_FIXTURE_ROOT = join(ROOT, "packages/surfaces/cli/test/fixtures/single-repo-basic");
const MONOREPO_FIXTURE_ROOT = join(ROOT, "packages/surfaces/cli/test/fixtures/monorepo-basic");
const BIN_DIR = join(ROOT, "node_modules", ".bin");
const ARCHCTX_BIN = process.platform === "win32" ? join(BIN_DIR, "archctx.cmd") : join(BIN_DIR, "archctx");
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

describe("local product first-experience E2E", () => {
  test("installed archctx works against an ordinary single Git repository", async () => {
    await runFirstExperience(SINGLE_REPO_FIXTURE_ROOT, {
      tempPrefix: "archctx-single-repo-e2e-",
      productName: "Single Repo E2E",
      changedPath: "src/index.ts",
      task: "inspect greeting module",
      taskSessionId: "task_single_repo_e2e"
    });
  });

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
  });
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
    execFileSync("codegraph", ["init", repo], { cwd: repo, env: testEnv(), stdio: ["ignore", "pipe", "pipe"] });

    const doctor = await runArchctx(repo, "doctor");
    expect(doctor.ok).toBe(true);
    expect(doctor.data.git).toMatchObject({ ok: true, root: realpathSync(resolve(repo)), headSha });
    expect(doctor.data.codeGraph.requiredVersion).toBe("1.0.1");

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

    const checkpoint = await runArchctx(repo, "checkpoint", "--expected-worktree-digest", status.data.worktreeDigest);
    expect(checkpoint.ok).toBe(true);
    expect(checkpoint.data.fresh).toBe(true);

    const complete = await runArchctx(
      repo,
      "complete",
      "--task-session-id",
      input.taskSessionId,
      "--head-sha",
      headSha,
      "--model-digest",
      init.data.modelDigest ?? DIGEST_A,
      "--codefacts-digest",
      sync.data.codeFactsDigest ?? DIGEST_B
    );
    expect(complete.ok).toBe(true);
    expect(complete.data.schemaVersion).toBe("archcontext.review/v1");
  } finally {
    await runArchctx(repo, "daemon", "stop").catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true });
  }
}

function git(repo: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: repo, env: testEnv(), stdio: ["ignore", "pipe", "pipe"] });
}

function gitOut(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, env: testEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function runArchctx(cwd: string, ...args: string[]): Promise<any> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(ARCHCTX_BIN, args, {
      cwd,
      env: testEnv()
    });
    collectProcess(child)
      .then(({ stdout, stderr, code }) => {
        if (code !== 0) {
          rejectPromise(new Error(`archctx ${args.join(" ")} failed (${code}): ${stderr || stdout}`));
          return;
        }
        resolvePromise(JSON.parse(stdout));
      })
      .catch(rejectPromise);
  });
}

function collectProcess(child: ChildProcessWithoutNullStreams): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectPromise(new Error(`Timed out waiting for process: ${stderr || stdout}`));
    }, 15_000);
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
