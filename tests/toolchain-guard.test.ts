import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

test("the Bun version gate rejects a mismatch before test code loads", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-toolchain-"));
  try {
    mkdirSync(join(root, "scripts"));
    copyFileSync(fileURLToPath(new URL("../scripts/check-bun-version.mjs", import.meta.url)), join(root, "scripts/check-bun-version.mjs"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ packageManager: "bun@0.0.0" }));
    writeFileSync(join(root, "bunfig.toml"), '[test]\npreload = ["./scripts/check-bun-version.mjs"]\n');
    writeFileSync(join(root, "probe.test.ts"), 'import { writeFileSync } from "node:fs"; writeFileSync("loaded", "yes");\n');
    expect(() => execFileSync(process.execPath, ["test", "probe.test.ts"], { cwd: root, stdio: "pipe" })).toThrow("requires bun@0.0.0");
    expect(existsSync(join(root, "loaded"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
