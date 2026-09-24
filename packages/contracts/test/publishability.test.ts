import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  preparePublicContractsReleaseStage,
  cleanupPublicContractsReleaseStage
} from "../../../scripts/contracts-release-stage.mjs";

type PackEntry = {
  name: string;
  files: Array<{ path: string }>;
};

const packageRoot = join(import.meta.dir, "..");

describe("@archcontext/contracts source package", () => {
  test("source manifest stays private and exposes the internal contracts surface", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      private?: boolean;
      license?: string;
      files?: string[];
      publishConfig?: { access?: string };
      exports?: Record<string, string>;
    };

    expect(manifest.private).toBe(true);
    expect(manifest.license).toBe("Apache-2.0");
    expect(manifest.publishConfig).toBeUndefined();
    expect(manifest.files).toEqual(["src", "fixtures"]);
    expect(manifest.exports?.["."]).toBe("./src/index.ts");
  });

  test("public staging from private source packs contracts and schemas without tests", () => {
    const sourceManifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    const stage = preparePublicContractsReleaseStage({ root: join(packageRoot, "../.."), sourceManifest });
    try {
      expect(stage.packageJson.name).toBe("archctx-contracts");
      expect(stage.packageJson.private).toBe(false);
      expect(stage.packageJson.version).toBe(sourceManifest.version);
      expect(stage.packageJson.publishConfig.access).toBe("public");
      const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
        cwd: stage.workspace,
        encoding: "utf8"
      });
      const [entry] = JSON.parse(raw) as PackEntry[];
      expect(entry.name).toBe("archctx-contracts");
      const files = entry.files.map((file) => file.path).sort();

      expect(files).toContain("package.json");
      expect(files).toContain("schemas/runtime/projection-apply-recovery.schema.json");
      expect(files).toContain("src/projection.ts");
      expect(files).toContain("fixtures/valid/projection-request.json");
      expect(files).toContain("fixtures/valid/projection-result.json");
      expect(files).toContain("fixtures/valid/architecture-refresh-signal.json");
      expect(files).toContain("fixtures/valid/archctx-capabilities.json");
      expect(files.some((file) => file.startsWith("src/"))).toBe(true);
      expect(files.some((file) => file.startsWith("fixtures/valid/"))).toBe(true);
      expect(files.some((file) => file.startsWith("test/"))).toBe(false);
    } finally {
      cleanupPublicContractsReleaseStage(stage.workspace);
    }
  });

  test("staging refuses source publication drift before creating an artifact", () => {
    const sourceManifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    for (const drift of [{ private: false }, { private: undefined }, { publishConfig: { access: "public" } }]) {
      expect(() => preparePublicContractsReleaseStage({
        root: join(packageRoot, "../.."), sourceManifest: { ...sourceManifest, ...drift }
      })).toThrow("Invalid contracts release manifest");
    }
  });
});
