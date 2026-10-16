import { expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrivateControlFile, readPrivateControlFile } from "../src/index";

for (const knownMetadata of [true, false]) {
  test(`native process failure reports only safe scalar metadata (${knownMetadata ? "known" : "unknown"})`, () => {
    const secret = "credential-sentinel-must-not-escape";
    const previousSystemRoot = process.env.SystemRoot;
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    const nativeError = Object.assign(new Error(secret), {
      code: knownMetadata ? "ETIMEDOUT" : secret,
      status: knownMetadata ? 7 : secret,
      signal: knownMetadata ? "SIGTERM" : secret,
      path: secret, spawnargs: [secret], input: secret, stdout: secret, stderr: secret
    });
    const spawn = spyOn(childProcess, "execFileSync").mockImplementation(() => { throw nativeError; });
    try {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.SystemRoot = "native-diagnostic-fixture";
      let failure: Error | undefined;
      try { createPrivateControlFile(secret, secret); } catch (error) { failure = error as Error; }
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(failure).toBeInstanceOf(Error);
      expect(failure!.message).toStartWith("Windows native ACL operation failed: ");
      expect(failure!.stack).not.toContain(secret);
      expect(JSON.stringify(failure)).not.toContain(secret);
      expect(failure!.cause).toBeUndefined();
      const details = JSON.parse(failure!.message.slice("Windows native ACL operation failed: ".length));
      expect(details).toEqual({
        operation: "create", code: knownMetadata ? "ETIMEDOUT" : "UNKNOWN",
        status: knownMetadata ? 7 : null, signal: knownMetadata ? "SIGTERM" : null,
        phase: "none", elapsedMs: expect.any(Number)
      });
      expect(details.elapsedMs).toBeGreaterThanOrEqual(0);
    } finally {
      spawn.mockRestore();
      Object.defineProperty(process, "platform", platform);
      if (previousSystemRoot === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = previousSystemRoot;
    }
  });
}

test("a timed-out native child reports only the last exact progress marker it wrote (#367)", () => {
  const secret = "credential-sentinel-must-not-escape";
  const previousSystemRoot = process.env.SystemRoot;
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const stderr = [
    "archctx-acl-phase:script\r",
    secret,
    "archctx-acl-phase:input",
    "archctx-acl-phase:parsed\r",
    `archctx-acl-phase:opened ${secret}`,
    `archctx-acl-phase:${secret.replaceAll("-", "")}`,
    `prefix archctx-acl-phase:done`,
    ""
  ].join("\n");
  const nativeError = Object.assign(new Error(secret), { code: "ETIMEDOUT", status: null, signal: "SIGTERM", stderr });
  const spawn = spyOn(childProcess, "execFileSync").mockImplementation(() => { throw nativeError; });
  try {
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.SystemRoot = "native-diagnostic-fixture";
    let failure: Error | undefined;
    try { createPrivateControlFile(secret, secret); } catch (error) { failure = error as Error; }
    expect(failure).toBeInstanceOf(Error);
    expect(failure!.stack).not.toContain(secret);
    expect(JSON.stringify(failure)).not.toContain(secret);
    const details = JSON.parse(failure!.message.slice("Windows native ACL operation failed: ".length));
    expect(details).toEqual({ operation: "create", code: "ETIMEDOUT", status: null, signal: "SIGTERM", phase: "parsed", elapsedMs: expect.any(Number) });
  } finally {
    spawn.mockRestore();
    Object.defineProperty(process, "platform", platform);
    if (previousSystemRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = previousSystemRoot;
  }
});

test.skipIf(process.platform !== "win32")("the real native child writes every progress marker in order for create and read (#367)", () => {
  const realSpawnSync = childProcess.spawnSync;
  const markers: string[][] = [];
  const spawn = spyOn(childProcess, "execFileSync").mockImplementation(((file: string, args: string[], options: childProcess.SpawnSyncOptionsWithStringEncoding) => {
    const result = realSpawnSync(file, args, options);
    markers.push(String(result.stderr).split("\n").map((line) => line.trim()).filter((line) => line.startsWith("archctx-acl-phase:")));
    if (result.error) throw result.error;
    if (result.status !== 0) throw Object.assign(new Error("native child failed"), { status: result.status });
    return result.stdout;
  }) as typeof childProcess.execFileSync);
  const dir = mkdtempSync(join(tmpdir(), "archctx-acl-phase-"));
  try {
    const path = join(dir, "control.json");
    createPrivateControlFile(path, "phase body");
    expect(readPrivateControlFile(path)).toBe("phase body");
    const all = ["script", "input", "parsed", "opened", "verified", "done"].map((name) => `archctx-acl-phase:${name}`);
    expect(markers).toEqual([all, all]);
  } finally {
    spawn.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
}, 150_000);
