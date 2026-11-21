import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

test("core and local-runtime cannot import higher architectural layers", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-boundaries-"));
  const names = ["contracts", "core", "local-runtime", "surfaces"];
  const audit = () => execFileSync("node", [fileURLToPath(new URL("./package-boundary-audit.mjs", import.meta.url))], { cwd: root, stdio: "pipe" });
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: names.map((name) => `packages/${name}`) }));
    for (const name of names) {
      mkdirSync(join(root, "packages", name, "src"), { recursive: true });
      writeFileSync(join(root, "packages", name, "package.json"), JSON.stringify({ name: `@archcontext/${name}` }));
    }
    expect(() => audit()).not.toThrow();

    writeFileSync(join(root, "packages/core/package.json"), JSON.stringify({ name: "@archcontext/core", dependencies: { "@archcontext/local-runtime": "workspace:*" } }));
    writeFileSync(join(root, "packages/core/src/index.ts"), 'import "@archcontext/local-runtime/git-adapter";\n');
    expect(() => audit()).toThrow("core must stay pure");

    writeFileSync(join(root, "packages/core/package.json"), JSON.stringify({ name: "@archcontext/core" }));
    writeFileSync(join(root, "packages/core/src/index.ts"), "");
    writeFileSync(join(root, "packages/local-runtime/package.json"), JSON.stringify({ name: "@archcontext/local-runtime", dependencies: { "@archcontext/surfaces": "workspace:*" } }));
    writeFileSync(join(root, "packages/local-runtime/src/index.ts"), 'import "@archcontext/surfaces/cli";\n');
    expect(() => audit()).toThrow("runtime must not depend on surfaces");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
