#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const workspaceRoot = process.cwd();
const root = mkdtempSync(join(tmpdir(), "archctx-platform-ipc-"));
const archctxCommand = resolveInstalledArchctxCommand();
const connectionPath = join(root, ".archcontext", ".local", "archctxd.json");
const lockPath = join(root, ".archcontext", ".local", "archctxd.lock");

try {
  writeFileSync(join(root, "README.md"), "# platform ipc readback\n", "utf8");
  const help = runArchctx();
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
    install: {
      binPath: redactPath(archctxCommand.path),
      binKind: archctxCommand.kind,
      helpOk: help.ok === true,
      hasDaemonCommand: Array.isArray(help.data?.commands) && help.data.commands.includes("daemon"),
      hasMcpCommand: Array.isArray(help.data?.commands) && help.data.commands.includes("mcp"),
      hasDoctorCommand: Array.isArray(help.data?.commands) && help.data.commands.includes("doctor")
    },
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

  assert(readback.install.helpOk, "installed archctx bin must render help");
  assert(readback.install.hasDaemonCommand, "installed archctx bin must expose daemon command");
  assert(readback.install.hasMcpCommand, "installed archctx bin must expose mcp command");
  assert(readback.install.hasDoctorCommand, "installed archctx bin must expose doctor command");
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
  const result = spawnSync(archctxCommand.command, [...archctxCommand.argsPrefix, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DO_NOT_TRACK: "1",
      PATH: `${join(workspaceRoot, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`
    },
    shell: archctxCommand.shell,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`archctx ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  if (!result.stdout.trim()) return {};
  return JSON.parse(result.stdout);
}

function bunVersion() {
  const bun = process.platform === "win32" ? "bun.exe" : "bun";
  const result = spawnSync(bun, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.stdout.trim();
}

function resolveInstalledArchctxCommand() {
  const binDir = join(workspaceRoot, "node_modules", ".bin");
  const candidates = process.platform === "win32"
    ? [
        { file: "archctx.cmd", kind: "cmd", shell: true, command: undefined, argsPrefix: [] },
        { file: "archctx.exe", kind: "exe", shell: false, command: undefined, argsPrefix: [] },
        { file: "archctx", kind: "shim", shell: false, command: undefined, argsPrefix: [] },
        { file: "archctx.ps1", kind: "powershell", shell: false, command: "powershell.exe", argsPrefix: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"] }
      ]
    : [
        { file: "archctx", kind: "posix-shim", shell: false, command: undefined, argsPrefix: [] }
      ];
  for (const candidate of candidates) {
    const path = join(binDir, candidate.file);
    if (!existsSync(path)) continue;
    return {
      path,
      kind: candidate.kind,
      shell: candidate.shell,
      command: candidate.command ?? path,
      argsPrefix: candidate.command ? [...candidate.argsPrefix, path] : candidate.argsPrefix
    };
  }
  throw new Error(`installed archctx bin not found in ${binDir}; run bun install first`);
}

function posixMode(path) {
  if (process.platform === "win32") return "win32-acl";
  return (statSync(path).mode & 0o777).toString(8);
}

function redactRoot(path) {
  return path.replace(root, "<repo>");
}

function redactPath(path) {
  return redactRoot(path).replace(workspaceRoot, "<workspace>");
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
