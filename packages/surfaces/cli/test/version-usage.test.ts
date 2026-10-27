import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ARCHCONTEXT_PRODUCT_VERSION } from "@archcontext/contracts";
import { runCli } from "../src/main";

const entry = resolve(import.meta.dir, "../src/main.ts");

test("--version reports the product authority outside a repository without creating state", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-version-"));
  try {
    const output = execFileSync(process.execPath, [entry, "--version"], {
      cwd: root, encoding: "utf8", env: { ...process.env, ARCHCONTEXT_STATE_DIR: join(root, "state") }
    });
    expect(JSON.parse(output)).toMatchObject({ ok: true, requestId: "version", data: { version: ARCHCONTEXT_PRODUCT_VERSION } });
    expect(readdirSync(root)).toEqual([]);
    const invalid = spawnSync(process.execPath, [entry, "--version", "--bogus"], { cwd: root, encoding: "utf8" });
    expect(invalid.status).toBe(1);
    expect(JSON.parse(invalid.stdout).error.action).toBe("correct-command-arguments");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("resolve usage errors request argument correction before reading a model", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-resolve-usage-"));
  try {
    for (const args of [["src/file.ts"], [], ["--path"], ["--unknown"], ["--path", "../outside"], ["--path", "src/file.ts", "--paths-from", "files.txt"]]) {
      const result = await runCli("resolve", args, root);
      expect(result).toMatchObject({ ok: false, error: { reasonCode: "cli-input-invalid", retryable: false, action: "correct-command-arguments" } });
    }
    expect(readdirSync(root)).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
