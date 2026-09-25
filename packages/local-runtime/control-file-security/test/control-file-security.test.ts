import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { grantEveryoneRead } from "./windows-acl-fixtures";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPrivateControlFile, readPrivateControlFile } from "../src/index";


test("control credentials are private at creation, readable and never overwrite another file", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-control-file-"));
  const path = join(root, "credential.json");
  try {
    createPrivateControlFile(path, '{"token":"fixture-中文"}');
    expect(readPrivateControlFile(path)).toBe('{"token":"fixture-中文"}');
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(() => createPrivateControlFile(path, "replacement")).toThrow();
    expect(readFileSync(path, "utf8")).toBe('{"token":"fixture-中文"}');
    if (process.platform === "win32") grantEveryoneRead(path);
    else chmodSync(path, 0o644);
    expect(readPrivateControlFile(path)).toBeUndefined();
    expect(readPrivateControlFile(join(root, "missing"))).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);

test.skipIf(process.platform !== "win32")("native Windows rejects inherited ACLs without changing their content", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-inherited-acl-"));
  const path = join(root, "inherited.json");
  try {
    writeFileSync(path, "untrusted", "utf8");
    expect(readPrivateControlFile(path)).toBeUndefined();
    expect(readFileSync(path, "utf8")).toBe("untrusted");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
