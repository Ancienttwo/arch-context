import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

test("the Bun version gate rejects a mismatch before test code loads", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-toolchain-"));
  try {
    mkdirSync(join(root, "scripts"));
    copyFileSync(fileURLToPath(new URL("../scripts/check-bun-version.mjs", import.meta.url)), join(root, "scripts/check-bun-version.mjs"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ packageManager: "bun@0.0.0" }));
    const repository = fileURLToPath(new URL("../", import.meta.url));
    for (const directory of [".", "packages/contracts", "packages/core", "packages/local-runtime", "packages/surfaces", "packages/cloud"]) {
      const cwd = join(root, directory);
      mkdirSync(cwd, { recursive: true });
      copyFileSync(join(repository, directory, "bunfig.toml"), join(cwd, "bunfig.toml"));
      if (directory !== ".") writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "bun test" } }));
      writeFileSync(join(cwd, "probe.test.ts"), 'import { writeFileSync } from "node:fs"; writeFileSync("loaded", "yes");\n');
      const commands = directory === "." ? [["test", "probe.test.ts"]] : [["test", "probe.test.ts"], ["run", "test"]];
      for (const command of commands) {
        expect(() => execFileSync(process.execPath, command, { cwd, stdio: "pipe", env: { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}` } })).toThrow("requires bun@0.0.0");
        expect(existsSync(join(cwd, "loaded"))).toBe(false);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
