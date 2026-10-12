import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { grantEveryoneRead, holdLikePrivateRead } from "./windows-acl-fixtures";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPrivateControlFile, readPrivateControlFile, removePrivateControlFile } from "../src/index";


test("control credentials are private at creation, readable and never overwrite another file", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-control-file-"));
  const path = join(root, "credential.json");
  try {
    const firstCreateStartedAt = performance.now();
    let firstCreateCompleted = false;
    try {
      createPrivateControlFile(path, '{"token":"fixture-中文"}');
      firstCreateCompleted = true;
    } finally {
      if (process.platform === "win32") console.info(JSON.stringify({
        event: "native-acl-first-create", completed: firstCreateCompleted,
        elapsedMs: Math.round(performance.now() - firstCreateStartedAt)
      }));
    }
    expect(readPrivateControlFile(path)).toBe('{"token":"fixture-中文"}');
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(() => createPrivateControlFile(path, "replacement")).toThrow();
    expect(readFileSync(path, "utf8")).toBe('{"token":"fixture-中文"}');
    if (process.platform === "win32") grantEveryoneRead(path);
    else chmodSync(path, 0o644);
    expect(readPrivateControlFile(path)).toBeUndefined();
    expect(readPrivateControlFile(join(root, "missing"))).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 60_000);

test.skipIf(process.platform !== "win32")("native Windows rejects inherited ACLs without changing their content", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-inherited-acl-"));
  const path = join(root, "inherited.json");
  try {
    writeFileSync(path, "untrusted", "utf8");
    expect(readPrivateControlFile(path)).toBeUndefined();
    expect(readFileSync(path, "utf8")).toBe("untrusted");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test.skipIf(process.platform !== "win32")("control-file removal waits for a concurrent private read to release its handle", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-control-file-remove-"));
  const path = join(root, "archctxd.json");
  try {
    createPrivateControlFile(path, '{"token":"fixture"}');
    const reader = await holdLikePrivateRead(path, 1_500);
    const exited = once(reader, "exit");
    let directError: NodeJS.ErrnoException | undefined;
    try { rmSync(path, { force: true }); } catch (error) { directError = error as NodeJS.ErrnoException; }
    console.info(JSON.stringify({ event: "control-file-remove-while-read", code: directError?.code ?? null }));
    expect(directError).toBeDefined();
    expect(existsSync(path)).toBe(true);
    await removePrivateControlFile(path);
    expect(existsSync(path)).toBe(false);
    expect(reader.exitCode ?? (await exited)[0]).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 60_000);
