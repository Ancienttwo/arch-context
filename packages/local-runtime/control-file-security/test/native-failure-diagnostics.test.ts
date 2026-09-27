import { expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { createPrivateControlFile } from "../src/index";

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
        elapsedMs: expect.any(Number)
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
