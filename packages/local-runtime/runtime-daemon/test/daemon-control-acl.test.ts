import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { defaultDaemonConnectionPath, readRuntimeRpcConnection } from "../src/daemon-control";
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
