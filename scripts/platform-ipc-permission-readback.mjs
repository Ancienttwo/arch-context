#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "archctx-platform-ipc-"));
const cliEntry = join(process.cwd(), "packages/surfaces/cli/src/main.ts");
const bun = process.platform === "win32" ? "bun.exe" : "bun";
const connectionPath = join(root, ".archcontext", ".local", "archctxd.json");
const lockPath = join(root, ".archcontext", ".local", "archctxd.lock");

try {
  writeFileSync(join(root, "README.md"), "# platform ipc readback\n", "utf8");
  const started = runArchctx("daemon", "start");
  const connection = JSON.parse(readFileSync(connectionPath, "utf8"));
  const status = runArchctx("daemon", "status");
  const connectionMode = posixMode(connection.connectionPath);
  const lockMode = posixMode(connection.lockPath);
  const tokenRedactedFromStatus = !JSON.stringify(status).includes(connection.token);
  const stopped = runArchctx("daemon", "stop");
  await waitFor(() => !existsSync(connectionPath) && !existsSync(lockPath), 5_000);

  const readback = {
    schemaVersion: "archcontext.platform-ipc-permission-readback/v1",
    platform: process.platform,
    node: process.version,
    bun: bunVersion(),
    transport: {
      protocol: started.data.protocol,
      bindHost: new URL(connection.url).hostname,
      loopbackOnly: new URL(connection.url).hostname === "127.0.0.1"
    },
    controlFiles: {
      connectionPath: redactRoot(connectionPath),
      lockPath: redactRoot(lockPath),
      connectionMode,
      lockMode,
      tokenRedactedFromStatus
    },
    lifecycle: {
      started: started.ok === true,
      statusRunning: status.data?.running === true,
      stopped: stopped.ok === true
    }
  };

  assert(readback.transport.protocol === "http-loopback", "daemon transport must be loopback HTTP for MVP");
  assert(readback.transport.loopbackOnly, "daemon must bind loopback");
  assert(readback.controlFiles.tokenRedactedFromStatus, "daemon status must redact bearer token");
  if (process.platform !== "win32") {
    assert(readback.controlFiles.connectionMode === "600", "connection file must be 0600 on POSIX");
    assert(readback.controlFiles.lockMode === "600", "lock file must be 0600 on POSIX");
  }
  assert(readback.lifecycle.started && readback.lifecycle.statusRunning && readback.lifecycle.stopped, "daemon lifecycle readback failed");

  process.stdout.write(`${JSON.stringify(readback, null, 2)}\n`);
} finally {
  runArchctx("daemon", "stop", { allowFailure: true });
  rmSync(root, { recursive: true, force: true });
}

function runArchctx(...args) {
  const options = typeof args.at(-1) === "object" ? args.pop() : {};
  const result = spawnSync(bun, [cliEntry, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DO_NOT_TRACK: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`archctx ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  if (!result.stdout.trim()) return {};
  return JSON.parse(result.stdout);
}

function bunVersion() {
  const result = spawnSync(bun, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.stdout.trim();
}

function posixMode(path) {
  if (process.platform === "win32") return "win32-acl";
  return (statSync(path).mode & 0o777).toString(8);
}

function redactRoot(path) {
  return path.replace(root, "<repo>");
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
