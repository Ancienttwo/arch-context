import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

type PackEntry = {
  files: Array<{ path: string }>;
};

const packageRoot = join(import.meta.dir, "..");

describe("@archcontext/contracts publishability", () => {
  test("package manifest exposes only the public contracts surface", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      private?: boolean;
      license?: string;
      files?: string[];
      publishConfig?: { access?: string };
      exports?: Record<string, string>;
    };

    expect(manifest.private).toBe(false);
    expect(manifest.license).toBe("Apache-2.0");
    expect(manifest.publishConfig?.access).toBe("public");
    expect(manifest.files).toEqual(["src", "fixtures"]);
    expect(manifest.exports?.["."]).toBe("./src/index.ts");
  });

  test("npm pack dry-run contains src and fixtures but excludes tests", () => {
    const raw = execFileSync("npm", ["pack", "--dry-run", "--json", packageRoot], {
      cwd: packageRoot,
      encoding: "utf8"
    });
    const [entry] = JSON.parse(raw) as PackEntry[];
    const files = entry.files.map((file) => file.path).sort();

    expect(files).toContain("package.json");
    expect(files.some((file) => file.startsWith("src/"))).toBe(true);
    expect(files.some((file) => file.startsWith("fixtures/valid/"))).toBe(true);
    expect(files.some((file) => file.startsWith("test/"))).toBe(false);
  });
});
