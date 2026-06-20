#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const root = process.cwd();
const binDir = resolve(root, "node_modules", ".bin");
const archctxBin = resolveArchctxBin();
const PROCESS_TIMEOUT_MS = 10_000;

if (!existsSync(archctxBin)) {
  const entries = existsSync(binDir) ? readdirSync(binDir).join(", ") : "<missing .bin directory>";
  fail(`missing packaged archctx bin; checked ${archctxBin}; .bin entries: ${entries}; run bun install first`);
}

const repo = mkdtempSync(join(tmpdir(), "archctx-packaged-cli-"));
const connectionPath = join(repo, ".archcontext", ".local", "archctxd.json");
const lockPath = join(repo, ".archcontext", ".local", "archctxd.lock");

try {
  writeFileSync(join(repo, "README.md"), "# packaged cli smoke\n", "utf8");

  const started = await runArchctx("daemon", "start");
  assert(started.ok === true, "daemon start must succeed");
  assert(started.data?.running === true, "daemon start must report running");
  assert(started.data?.background === true, "daemon start must report background mode");
  assert(/^http:\/\/127\.0\.0\.1:/.test(String(started.data?.url)), "daemon start must return loopback RPC URL");
  assert(existsSync(connectionPath), "daemon start must write connection file");
  assert(existsSync(lockPath), "daemon start must write lock file");

  const init = await runArchctx("init", "--name", "Packaged CLI Smoke");
  assert(init.ok === true, "init must succeed through packaged bin");

  const status = await runArchctx("status");
  assert(status.ok === true, "status must succeed through packaged bin");
  assert(status.data?.running === true, "status must reuse daemon");
  assert(status.data?.sessions === 1, "status must observe shared daemon session");
  const repositoryId = status.data?.repositoryId;
  const initialWorktreeDigest = status.data?.worktreeDigest;

  const mcp = await runArchctxMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert(mcp.jsonrpc === "2.0", "mcp must return JSON-RPC");
  assert(mcp.id === 1, "mcp must preserve request id");
  assert(Array.isArray(mcp.result?.tools), "mcp must list tools");
  assert(mcp.result.tools.some((tool) => tool.name === "archcontext_prepare_task"), "mcp must expose prepare_task");

  const planned = await runArchctxMcp({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "archcontext_plan_update",
      arguments: {
        root: repo,
        id: "changeset.packaged-mcp",
        operations: [
          {
            op: "create_entity",
            path: ".archcontext/model/nodes/module.packaged-mcp.yaml",
            expectedHash: "missing",
            body: [
              "schemaVersion: archcontext.node/v1",
              "id: module.packaged-mcp",
              "kind: module",
              "name: Packaged MCP",
              "status: active",
              "summary: Packaged MCP smoke",
              "responsibilities:",
              "- prove cli and mcp share daemon state",
              ""
            ].join("\n")
          }
        ]
      }
    }
  });
  assert(planned.result?.content?.ok === true, "mcp plan_update must succeed through daemon RPC");

  const applied = await runArchctx(
    "apply",
    "--id",
    "changeset.packaged-mcp",
    "--approved",
    "--expected-worktree-digest",
    status.data.worktreeDigest
  );
  assert(applied.ok === true, "cli apply must consume the MCP-created daemon ChangeSet draft");
  assert(existsSync(join(repo, ".archcontext/model/nodes/module.packaged-mcp.yaml")), "cli apply must write the MCP-planned model file");

  const again = await runArchctx("daemon", "start");
  assert(again.ok === true, "second daemon start must succeed");
  assert(again.data?.alreadyRunning === true, "second daemon start must be idempotent");

  const daemonStatus = await runArchctx("daemon", "status");
  assert(daemonStatus.ok === true, "daemon status must succeed");
  assert(daemonStatus.data?.rpcVersionCompatible === true, "daemon status must report RPC compatibility");
  assert(daemonStatus.data?.product?.schemaVersion === "archcontext.product-version-manifest/v1", "daemon status must include product manifest");

  const stoppedForRestart = await runArchctx("daemon", "stop");
  assert(stoppedForRestart.ok === true, "daemon stop before restart must succeed");
  await waitForRemoved(connectionPath, "connection file");
  await waitForRemoved(lockPath, "lock file");

  const restarted = await runArchctx("daemon", "start");
  assert(restarted.ok === true, "daemon restart must succeed");
  assert(restarted.data?.background === true, "daemon restart must report background mode");

  const restoredStatus = await runArchctx("status");
  assert(restoredStatus.ok === true, "status after restart must succeed");
  assert(restoredStatus.data?.sessions === 1, `daemon restart must restore persisted repository session: ${JSON.stringify(restoredStatus.data)}`);
  assert(restoredStatus.data?.repositoryId === repositoryId, "restored session must keep the same repository id");
  assert(restoredStatus.data?.worktreeDigest === initialWorktreeDigest, "restored session must keep the same worktree digest");

  const plannedAfterRestart = await runArchctxMcp({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "archcontext_plan_update",
      arguments: {
        root: repo,
        id: "changeset.packaged-mcp-restart",
        operations: [
          {
            op: "create_entity",
            path: ".archcontext/model/nodes/module.packaged-mcp-restart.yaml",
            expectedHash: "missing",
            body: [
              "schemaVersion: archcontext.node/v1",
              "id: module.packaged-mcp-restart",
              "kind: module",
              "name: Packaged MCP Restart",
              "status: active",
              "summary: Packaged MCP restart smoke",
              "responsibilities:",
              "- prove cli and mcp share restarted daemon state",
              ""
            ].join("\n")
          }
        ]
      }
    }
  });
  assert(plannedAfterRestart.result?.content?.ok === true, "mcp plan_update after restart must succeed through restored daemon RPC");
  const restartDraftDigest = plannedAfterRestart.result?.content?.data?.draft?.base?.worktreeDigest;
  assert(/^sha256:/.test(String(restartDraftDigest)), "mcp plan_update after restart must return a draft worktree digest");

  const appliedAfterRestart = await runArchctx(
    "apply",
    "--id",
    "changeset.packaged-mcp-restart",
    "--approved",
    "--expected-worktree-digest",
    restartDraftDigest
  );
  assert(appliedAfterRestart.ok === true, "cli apply after restart must consume the MCP-created ChangeSet draft");
  assert(existsSync(join(repo, ".archcontext/model/nodes/module.packaged-mcp-restart.yaml")), "cli apply after restart must write the MCP-planned model file");

  const stopped = await runArchctx("daemon", "stop");
  assert(stopped.ok === true, "daemon stop must succeed");
  await waitForRemoved(connectionPath, "connection file");
  await waitForRemoved(lockPath, "lock file");

  console.log("[packaged-cli-smoke] OK");
} finally {
  await runArchctx("daemon", "stop").catch(() => undefined);
  rmSync(repo, { recursive: true, force: true });
}

function runArchctx(...args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(archctxBin, args, {
      cwd: repo,
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`
      }
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectPromise(new Error(`archctx ${args.join(" ")} timed out: ${stderr || stdout}`));
    }, PROCESS_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        rejectPromise(new Error(`archctx ${args.join(" ")} failed (${code}): ${stderr || stdout}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch (error) {
        rejectPromise(new Error(`archctx ${args.join(" ")} returned invalid JSON: ${stdout}\n${stderr}\n${error}`));
      }
    });
  });
}

function resolveArchctxBin() {
  const candidates = process.platform === "win32"
    ? [join(binDir, "archctx.cmd"), join(binDir, "archctx.exe"), join(binDir, "archctx")]
    : [join(binDir, "archctx")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function runArchctxMcp(message) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(archctxBin, ["mcp"], {
      cwd: repo,
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`
      }
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectPromise(new Error(`archctx mcp timed out: ${stderr || stdout}`));
    }, PROCESS_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        rejectPromise(new Error(`archctx mcp failed (${code}): ${stderr || stdout}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout.trim().split("\n").at(-1) ?? ""));
      } catch (error) {
        rejectPromise(new Error(`archctx mcp returned invalid JSON: ${stdout}\n${stderr}\n${error}`));
      }
    });
    child.stdin.end(`${JSON.stringify(message)}\n`);
  });
}

async function waitForRemoved(path, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!existsSync(path)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  fail(`timed out waiting for ${label} removal: ${path}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  console.error(`[packaged-cli-smoke] FAILED: ${message}`);
  process.exit(1);
}
