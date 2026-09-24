import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

test("cloud cannot reintroduce local-runtime through its manifest or production imports", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-boundaries-"));
  const names = ["contracts", "core", "local-runtime", "surfaces", "cloud"];
  const audit = () => execFileSync("node", [fileURLToPath(new URL("./package-boundary-audit.mjs", import.meta.url))], { cwd: root, stdio: "pipe" });
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: names.map((name) => `packages/${name}`) }));
    for (const name of names) {
      mkdirSync(join(root, "packages", name, "src"), { recursive: true });
      writeFileSync(join(root, "packages", name, "package.json"), JSON.stringify({ name: `@archcontext/${name}` }));
    }
    expect(() => audit()).not.toThrow();
    const manifest = join(root, "packages/cloud/package.json");
    writeFileSync(manifest, JSON.stringify({ name: "@archcontext/cloud", dependencies: { "@archcontext/local-runtime": "workspace:*" } }));
    expect(() => audit()).toThrow("cloud must receive local capabilities through contracts ports");
    writeFileSync(manifest, JSON.stringify({ name: "@archcontext/cloud" }));
    writeFileSync(join(root, "packages/cloud/src/index.ts"), 'import "@archcontext/local-runtime/git-adapter";\n');
    expect(() => audit()).toThrow("inject contracts ports instead");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
