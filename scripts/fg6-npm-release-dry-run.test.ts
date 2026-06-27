import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildNpmReleaseDryRunReadback,
  inspectNpmReleaseDryRun
} from "./fg6-npm-release-dry-run";

describe("fg6 npm release dry-run", () => {
  test("accepts a publishable archctx dry-run artifact", () => {
    const stageDir = createReleaseStageFixture();
    const recording = buildNpmReleaseDryRunReadback({
      rootManifest: {
        name: "archcontext",
        version: "0.1.4",
        engines: { node: ">=24 <26" }
      },
      packageJson: {
        name: "archctx",
        version: "0.1.4",
        private: false,
        homepage: "https://archcontext.repoharness.com",
        license: "UNLICENSED",
        engines: { node: ">=24 <26" },
        bin: { archctx: "./bin/archctx.mjs", codegraph: "./bin/codegraph.mjs" },
        dependencies: {
          "@colbymchenry/codegraph": "1.0.1",
          "@node-rs/jieba": "^2.0.1"
        },
        publishConfig: { registry: "https://registry.npmjs.org/" }
      },
      stageDir,
      artifactDir: "/tmp/archctx-artifact",
      pack: [
        {
          filename: "archctx-0.1.4.tgz"
        }
      ],
      publishDryRun: {
        id: "archctx@0.1.4",
        name: "archctx",
        version: "0.1.4",
        filename: "archctx-0.1.4.tgz",
        integrity: "sha512-test",
        shasum: "abc",
        size: 100,
        unpackedSize: 200,
        entryCount: 16,
        files: [
          { path: "bin/archctx.mjs" },
          { path: "bin/codegraph.mjs" },
          { path: "assets/catalog.yaml" },
          { path: "assets/practices/s6-expanded.yaml" },
          { path: "assets/profiles/s6.yaml" },
          { path: "assets/sources/core.yaml" },
          { path: "assets/sources/s6.yaml" },
          { path: "schemas/repo/practices/practice.schema.json" },
          { path: "schemas/repo/practices/practice-source.schema.json" },
          { path: "schemas/repo/practices/practice-profile.schema.json" },
          { path: "schemas/runtime/practice-catalog-manifest.schema.json" },
          { path: "schemas/runtime/practice-match.schema.json" },
          { path: "schemas/runtime/practice-guidance.schema.json" },
          { path: "schemas/runtime/practice-checkpoint.schema.json" },
          { path: "NOTICE.md" },
          { path: "README.md" },
          { path: "package.json" }
        ]
      },
      generatedAt: "2026-06-22T00:00:00.000Z"
    });

    expect(recording.status).toBe("verified");
    expect(recording.ok).toBe(true);
    expect(recording.package.name).toBe("archctx");
    expect(recording.releaseAssets.sourceRecordCount).toBe(1);
    expect(recording.rollout.postPublishInstallCommand).toBe("npm install -g archctx@0.1.4");
    expect(inspectNpmReleaseDryRun(recording)).toEqual({ ok: true, failures: [] });
    rmSync(stageDir, { recursive: true, force: true });
  });

  test("rejects repository source publication and wrong package name", () => {
    const recording = buildNpmReleaseDryRunReadback({
      rootManifest: {
        name: "archcontext",
        version: "0.1.4",
        engines: { node: ">=24 <26" }
      },
      packageJson: {
        name: "archcontext",
        version: "0.1.4",
        private: false,
        homepage: "https://github.com/Ancienttwo/arch-context#readme",
        packageManager: "bun@1.3.10",
        engines: { node: ">=24 <26", bun: ">=1.3.10" },
        repository: { type: "git", url: "git+https://github.com/Ancienttwo/arch-context.git" },
        bin: { archctx: "./bin/archctx.mjs" },
        dependencies: {
          "@colbymchenry/codegraph": "1.0.1"
        },
        publishConfig: { registry: "https://registry.npmjs.org/" }
      },
      stageDir: "/tmp/archctx-stage",
      artifactDir: "/tmp/archctx-artifact",
      pack: [
        {
          filename: "archcontext-0.1.4.tgz"
        }
      ],
      publishDryRun: {
        id: "archcontext@0.1.4",
        name: "archcontext",
        version: "0.1.4",
        filename: "archcontext-0.1.4.tgz",
        files: [
          { path: "bin/archctx.mjs" },
          { path: "README.md" },
          { path: "package.json" }
        ]
      },
      generatedAt: "2026-06-22T00:00:00.000Z"
    });

    expect(recording.status).toBe("failed");
    expect(recording.assertions.packageNameResolved).toBe(false);
    expect(recording.assertions.noBunRuntimeDeclared).toBe(false);
    expect(recording.assertions.homeUrlCorrect).toBe(false);
    expect(recording.assertions.noSourceRepositoryUrl).toBe(false);
    const result = inspectNpmReleaseDryRun(recording);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("dry-run must be verified ok");
  });
});

function createReleaseStageFixture() {
  const stageDir = mkdtempSync(join(tmpdir(), "archctx-release-stage-test-"));
  const files = [
    "assets/practices/s6-expanded.yaml",
    "assets/profiles/s6.yaml",
    "schemas/repo/practices/practice.schema.json",
    "schemas/repo/practices/practice-source.schema.json",
    "schemas/repo/practices/practice-profile.schema.json",
    "schemas/runtime/practice-catalog-manifest.schema.json",
    "schemas/runtime/practice-match.schema.json",
    "schemas/runtime/practice-guidance.schema.json",
    "schemas/runtime/practice-checkpoint.schema.json"
  ];
  for (const file of files) {
    mkdirSync(join(stageDir, file, ".."), { recursive: true });
    writeFileSync(join(stageDir, file), "{}\n", "utf8");
  }
  mkdirSync(join(stageDir, "assets", "sources"), { recursive: true });
  writeFileSync(join(stageDir, "assets", "catalog.yaml"), "{}\n", "utf8");
  writeFileSync(join(stageDir, "assets", "sources", "core.yaml"), JSON.stringify([{
    id: "archcontext.spec",
    name: "ArchContext Product Specification",
    revision: "2026-06-23",
    licenseSpdx: "LicenseRef-ArchContext-Repo",
    licenseLevel: "A",
    usagePolicy: "repo-authored",
    contentDigest: `sha256:${"1".repeat(64)}`,
    attribution: "ArchContext maintainers"
  }], null, 2), "utf8");
  writeFileSync(join(stageDir, "assets", "sources", "s6.yaml"), "[]\n", "utf8");
  writeFileSync(join(stageDir, "NOTICE.md"), "ArchContext maintainers\n", "utf8");
  return stageDir;
}
