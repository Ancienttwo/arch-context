#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const workspaceRoot = process.cwd();
const root = mkdtempSync(join(tmpdir(), "archctx-platform-ipc-"));
const stateRoot = mkdtempSync(join(tmpdir(), "archctx-platform-ipc-state-"));
const archctxCommand = resolveInstalledArchctxCommand();

try {
  gitInit();
  writeFileSync(join(root, "README.md"), "# platform ipc readback\n", "utf8");
  const help = runArchctx();
  const paths = runArchctx("paths");
  const doctor = runArchctx("doctor");
  const initialized = runArchctx("init", "--name", "Platform Readback");
  const cacheLockPath = `${paths.data.localStorePath}.cache.lock`;

  const stateDirMode = posixMode(paths.data.workspaceStateDir);
  const storeMode = posixMode(paths.data.localStorePath);
  const readback = {
    schemaVersion: "archcontext.platform-ipc-permission-readback/v2",
    platform: process.platform,
    node: process.version,
    bun: bunVersion(),
    install: {
      binPath: redactPath(archctxCommand.path),
      binKind: archctxCommand.kind,
      helpOk: help.ok === true,
      hasIndexCommand: Array.isArray(help.data?.commands) && help.data.commands.includes("index"),
      hasDoctorCommand: Array.isArray(help.data?.commands) && help.data.commands.includes("doctor"),
      daemonRemoved: Array.isArray(help.data?.commands) && !help.data.commands.includes("daemon"),
      mcpRemoved: Array.isArray(help.data?.commands) && !help.data.commands.includes("mcp")
    },
    runtimeState: {
      mode: doctor.data?.runtime?.mode,
      runtimeStateRoot: redactPath(paths.data.stateRoot),
      workspaceStateDir: redactPath(paths.data.workspaceStateDir),
      localStorePath: redactPath(paths.data.localStorePath),
      storageRepositoryId: paths.data.storageRepositoryId,
      storageWorkspaceId: paths.data.storageWorkspaceId,
      npmGlobalInstallState: paths.data.npmGlobalInstallState,
      stateDirExists: existsSync(paths.data.workspaceStateDir),
      localStoreExists: existsSync(paths.data.localStorePath),
      daemonConnectionCreated: existsSync(paths.data.daemonConnectionPath),
      daemonLockCreated: existsSync(paths.data.daemonLockPath),
      cacheLockRemaining: existsSync(cacheLockPath),
      stateDirMode,
      storeMode
    },
    lifecycle: {
      doctorOk: doctor.ok === true,
      initOk: initialized.ok === true
    }
  };

  assert(readback.install.helpOk, "installed archctx bin must render help");
  assert(readback.install.hasIndexCommand, "installed archctx bin must expose index command");
  assert(readback.install.hasDoctorCommand, "installed archctx bin must expose doctor command");
  assert(readback.install.daemonRemoved && readback.install.mcpRemoved, "installed archctx bin must omit daemon and mcp commands");
  assert(readback.runtimeState.mode === "in-process", "doctor must report in-process runtime mode");
  assert(readback.runtimeState.npmGlobalInstallState === "forbidden", "mutable runtime state must not use npm global installation directories");
  assert(readback.runtimeState.stateDirExists && readback.runtimeState.localStoreExists, "runtime cache directory and SQLite store must exist");
  assert(!readback.runtimeState.daemonConnectionCreated && !readback.runtimeState.daemonLockCreated, "daemonless commands must never create daemon control files");
  assert(!readback.runtimeState.cacheLockRemaining, "SQLite cache writer lock must be released after command exit");
  assert(readback.lifecycle.doctorOk && readback.lifecycle.initOk, "in-process doctor/init readback failed");
  if (process.platform !== "win32") {
    assert(stateDirMode === "700", `workspace state dir must be 0700 on POSIX, got ${stateDirMode}`);
  }

  process.stdout.write(`${JSON.stringify(readback, null, 2)}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(stateRoot, { recursive: true, force: true });
}

function gitInit() {
  const result = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert(result.status === 0, `git init failed: ${result.stderr}`);
}

function runArchctx(...args) {
  const options = typeof args.at(-1) === "object" ? args.pop() : {};
  const result = spawnSync(archctxCommand.command, [...archctxCommand.argsPrefix, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DO_NOT_TRACK: "1",
      ARCHCONTEXT_STATE_DIR: stateRoot,
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
