import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { defaultDaemonConnectionPath, listDaemonControlStates, readRuntimeRpcConnection } from "../src/daemon-control";
import { RUNTIME_RPC_VERSION } from "../src/rpc-protocol";

test("Windows discovery rejects credentials when the native ACL authority is unavailable", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-acl-unavailable-"));
  const previousState = process.env.ARCHCONTEXT_STATE_DIR;
  const previousSystemRoot = process.env.SystemRoot;
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  try {
    process.env.ARCHCONTEXT_STATE_DIR = join(root, "state");
    const connectionPath = defaultDaemonConnectionPath(root);
    mkdirSync(dirname(connectionPath), { recursive: true });
    writeFileSync(connectionPath, JSON.stringify({
      schemaVersion: RUNTIME_RPC_VERSION, protocol: "http-loopback", version: 1,
      root, connectionPath, lockPath: join(root, "lock"),
      url: "http://127.0.0.1:1/", token: "fixture-token", pid: process.pid
    }), { mode: 0o600 });
    Object.defineProperty(process, "platform", { value: "win32" });
    delete process.env.SystemRoot;
    expect(readRuntimeRpcConnection(root)).toBeUndefined();
  } finally {
    Object.defineProperty(process, "platform", platform);
    if (previousSystemRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = previousSystemRoot;
    if (previousState === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previousState;
    rmSync(root, { recursive: true, force: true });
  }
});

// A stand-in for the native ACL reader that the Windows read path launches, so the moment a daemon
// removes or writes its connection file during a `daemon list` read is reproduced exactly (#322).
const FAKE_NATIVE_READER = `#!/bin/sh
request=$(cat)
path=$(printf '%s' "$request" | sed -E 's/.*"path":"([^"]*)".*/\\1/')
echo read >> "$ARCHCTX_FAKE_READ_LOG"
case "$ARCHCTX_FAKE_READ_MODE" in
  vanish) rm -f "$path"; printf '{"ok":false,"code":"EACCES"}' ;;
  corrupt) printf '{"ok":true,"body":"not json"}' ;;
  late) if [ -f "$ARCHCTX_FAKE_READ_LOG.done" ]; then printf '{"ok":true,"body":%s}' "$ARCHCTX_FAKE_READ_BODY"; else touch "$ARCHCTX_FAKE_READ_LOG.done"; printf '{"ok":false,"code":"EACCES"}'; fi ;;
esac
`;

test.skipIf(process.platform === "win32")("daemon list judges a connection file that is removed or written during its read by a second look, and still reports corruption (#322)", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-list-race-"));
  const stateRoot = join(root, "state");
  const stateDir = join(stateRoot, "repositories", "repo.0000000000000001", "worktrees", "ws.0000000000000001");
  const connectionPath = join(stateDir, "archctxd.json");
  const readLog = join(root, "reads.log");
  const connection = {
    schemaVersion: RUNTIME_RPC_VERSION, protocol: "http-loopback", version: 1,
    root: join(root, "repo"), connectionPath, lockPath: join(stateDir, "archctxd.lock"),
    url: "http://127.0.0.1:1/", token: "fixture-token", pid: process.pid
  };
  const reader = join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  mkdirSync(dirname(reader), { recursive: true });
  writeFileSync(reader, FAKE_NATIVE_READER, "utf8");
  chmodSync(reader, 0o755);
  mkdirSync(stateDir, { recursive: true });
  const saved = { SystemRoot: process.env.SystemRoot, log: process.env.ARCHCTX_FAKE_READ_LOG, mode: process.env.ARCHCTX_FAKE_READ_MODE, body: process.env.ARCHCTX_FAKE_READ_BODY };
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const list = (mode: string) => {
    rmSync(readLog, { force: true });
    rmSync(`${readLog}.done`, { force: true });
    writeFileSync(connectionPath, JSON.stringify(connection), { mode: 0o600 });
    process.env.ARCHCTX_FAKE_READ_MODE = mode;
    return listDaemonControlStates(stateRoot);
  };
  const reads = () => readFileSync(readLog, "utf8").trim().split("\n").length;
  try {
    process.env.SystemRoot = root;
    process.env.ARCHCTX_FAKE_READ_LOG = readLog;
    process.env.ARCHCTX_FAKE_READ_BODY = JSON.stringify(JSON.stringify(connection));
    Object.defineProperty(process, "platform", { value: "win32" });

    // The daemon exits while the file is read: nothing is left to list, not an invalid file.
    expect(list("vanish")).toEqual([]);
    expect(existsSync(connectionPath)).toBe(false);
    expect(reads()).toBe(1);

    // The daemon is still writing the file on the first read: the second read sees it.
    expect(list("late")).toEqual([expect.objectContaining({ connection: "valid", pid: process.pid, pidAlive: true })]);
    expect(reads()).toBe(2);

    // A file that fails both reads is corrupt and stays reported as invalid, after two reads only.
    expect(list("corrupt")).toEqual([expect.objectContaining({ connection: "invalid", stateDir })]);
    expect(reads()).toBe(2);
  } finally {
    Object.defineProperty(process, "platform", platform);
    for (const [key, value] of [["SystemRoot", saved.SystemRoot], ["ARCHCTX_FAKE_READ_LOG", saved.log], ["ARCHCTX_FAKE_READ_MODE", saved.mode], ["ARCHCTX_FAKE_READ_BODY", saved.body]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
