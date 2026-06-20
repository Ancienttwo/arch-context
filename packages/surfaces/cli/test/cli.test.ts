import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { ArchctxRuntimeRpcServer, RUNTIME_RPC_VERSION, RuntimeRpcClient, createStartedDaemon, defaultDaemonConnectionPath, defaultDaemonLockPath } from "@archcontext/local-runtime/runtime-daemon";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { runCli } from "../src/main";

const CLI_ENTRY = join(process.cwd(), "packages/surfaces/cli/src/main.ts");

function runTestCli(command: string, args: string[], root: string) {
  return runCli(command, args, root, {
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider()
  });
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

      const checkpoint = await runTestCli("checkpoint", ["--expected-worktree-digest", (status.data as any).worktreeDigest], root);
      expect((checkpoint.data as any).fresh).toBe(true);

      const complete = await runTestCli("complete", [
        "--task-session-id", "task_cli",
        "--head-sha", "abc123",
        "--model-digest", `sha256:${"a".repeat(64)}`,
        "--codefacts-digest", `sha256:${"b".repeat(64)}`
      ], root);
      expect(complete.ok).toBe(true);
      expect((complete.data as any).schemaVersion).toBe("archcontext.review/v1");

      const config = await runTestCli("config", [], root);
      expect((config.data as any).generic.transport).toBe("stdio");

      writeFileSync(join(root, "package.json"), JSON.stringify({ engines: { node: ">=24 <26" } }), "utf8");
      const install = await runTestCli("install", ["--host", "codex"], root);
      expect((install.data as any).marker).toContain("archcontext_prepare_task");
      const doctor = await runTestCli("doctor", [], root);
      expect((doctor.data as any).privacyRouteDigest).toMatch(/^sha256:/);
      const privacyAudit = await runTestCli("privacy-audit", [], root);
      expect((privacyAudit.data as any).dependencyAudit.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
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
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("foreground daemon subprocess shares runtime state across independent CLI processes", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-foreground-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    const daemon = spawn(process.execPath, [CLI_ENTRY, "daemon", "start", "--foreground", "--port", "0"], {
      cwd: root,
      env: process.env
    });
    try {
      const started = await readJsonFromProcess(daemon);
      expect(started.ok).toBe(true);
      expect(started.data.running).toBe(true);
      expect(started.data.protocol).toBe("http-loopback");
      expect(String(started.data.url)).toMatch(/^http:\/\/127\.0\.0\.1:/);
      expect(existsSync(join(root, ".archcontext/.local/archctxd.json"))).toBe(true);
      expect(existsSync(join(root, ".archcontext/.local/archctxd.lock"))).toBe(true);
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
      const connection = JSON.parse(readFileSync(join(root, ".archcontext/.local/archctxd.json"), "utf8"));
      expect(daemonStatus.data.running).toBe(true);
      expect(daemonStatus.data.rpcVersionCompatible).toBe(true);
      expect(daemonStatus.data.product.schemaVersion).toBe("archcontext.product-version-manifest/v1");
      expect(daemonStatus.data.product.runtime.localRpc.schemaVersion).toBe(RUNTIME_RPC_VERSION);
      expect(JSON.stringify(daemonStatus.data)).toContain("stored-in-connection-file");
      expect(JSON.stringify(daemonStatus.data)).not.toContain(connection.token);

      const stopped = await runCliProcess(root, "daemon", "stop");
      expect(stopped.ok).toBe(true);
      await expectProcessExit(daemon);
      expect(existsSync(join(root, ".archcontext/.local/archctxd.json"))).toBe(false);
      expect(existsSync(join(root, ".archcontext/.local/archctxd.lock"))).toBe(false);
    } finally {
      if (daemon.exitCode === null && !daemon.killed) daemon.kill("SIGTERM");
      await expectProcessExit(daemon).catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("background daemon start returns after ready and survives the starter process", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-background-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    const connectionPath = join(root, ".archcontext/.local/archctxd.json");
    const lockPath = join(root, ".archcontext/.local/archctxd.lock");
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
      await runCliProcess(root, "daemon", "stop").catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("CLI recovers stale daemon control files after a crash and reconnects", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-crash-recovery-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    const connectionPath = defaultDaemonConnectionPath(root);
    const lockPath = defaultDaemonLockPath(root);
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
      await runCliProcess(root, "daemon", "stop").catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("CLI downgrades stale daemon connection files instead of failing commands", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-stale-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const connectionPath = defaultDaemonConnectionPath(root);
      const lockPath = defaultDaemonLockPath(root);
      mkdirSync(join(root, ".archcontext/.local"), { recursive: true });
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
      await runCliProcess(root, "daemon", "stop").catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("CLI exposes repo and landscape commands without changing single-repo defaults", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-"));
    try {
      writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
      const added = await runTestCli("repo", ["add", "--name", "web"], root);
      expect(added.ok).toBe(true);
      expect((added.data as any).repository.name).toBe("web");
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
      rmSync(root, { recursive: true, force: true });
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
      rmSync(root, { recursive: true, force: true });
    }
  });
});

async function runCliProcess(root: string, ...args: string[]): Promise<any> {
  const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
    cwd: root,
    env: process.env
  });
  const { stdout, stderr, code } = await collectProcess(child);
  if (code !== 0) throw new Error(`archctx ${args.join(" ")} failed (${code}): ${stderr || stdout}`);
  return JSON.parse(stdout);
}

function readJsonFromProcess(child: ChildProcessWithoutNullStreams): Promise<any> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    const timeout = setTimeout(() => finish(() => reject(new Error(`Timed out waiting for daemon start: ${stderr || stdout}`))), 5000);
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
    }, 5000);
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
