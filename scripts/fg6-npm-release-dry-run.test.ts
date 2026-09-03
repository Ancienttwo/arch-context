import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARCHCONTEXT_NODE_RANGE } from "@archcontext/contracts";
import {
  buildPublicContractsReleaseDryRunReadback,
  buildNpmReleaseDryRunReadback,
  buildReleaseManifest,
  inspectNpmReleaseDryRun
} from "./fg6-npm-release-dry-run";

describe("fg6 npm release dry-run", () => {
  test("accepts a publishable archctx dry-run artifact", () => {
    const stageDir = createReleaseStageFixture();
    const recording = buildNpmReleaseDryRunReadback({
      rootManifest: {
        name: "archcontext",
        version: "0.1.5",
        engines: { node: ARCHCONTEXT_NODE_RANGE },
        dependencies: { "@colbymchenry/codegraph": "1.5.0" }
      },
      packageJson: {
        name: "archctx",
        version: "0.1.5",
        private: false,
        homepage: "https://archcontext.repoharness.com",
        license: "Apache-2.0",
        engines: { node: ARCHCONTEXT_NODE_RANGE },
        bin: { archctx: "./bin/archctx.mjs" },
        dependencies: {
          "@colbymchenry/codegraph": "1.5.0",
          "@node-rs/jieba": "^2.0.1",
          koffi: "3.1.6"
        },
        publishConfig: { registry: "https://registry.npmjs.org/" }
      },
      stageDir,
      artifactDir: "/tmp/archctx-artifact",
      pack: [
        {
          filename: "archctx-0.1.5.tgz"
        }
      ],
      publishDryRun: {
        id: "archctx@0.1.5",
        name: "archctx",
        version: "0.1.5",
        filename: "archctx-0.1.5.tgz",
        integrity: "sha512-test",
        shasum: "abc",
        size: 100,
        unpackedSize: 200,
        entryCount: 16,
        files: [
          { path: "bin/archctx.mjs" },
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
      contracts: createPublicContractsDryRunFixture(),
      generatedAt: "2026-06-22T00:00:00.000Z"
    });

    expect(recording.status).toBe("verified");
    expect(recording.ok).toBe(true);
    expect(recording.package.name).toBe("archctx");
    expect(recording.releaseAssets.sourceRecordCount).toBe(1);
    expect(recording.rollout.postPublishInstallCommand).toBe("npm install -g archctx@0.1.5");
    expect(inspectNpmReleaseDryRun(recording)).toEqual({ ok: true, failures: [] });
    rmSync(stageDir, { recursive: true, force: true });
  });

  test("assembles and requires the descriptor-relative filesystem dependency", () => {
    const manifest = buildReleaseManifest(
      {
        name: "archctx",
        version: "0.1.5",
        engines: { node: ARCHCONTEXT_NODE_RANGE },
        dependencies: { "@colbymchenry/codegraph": "1.5.0" }
      },
      {
        dependencies: { "@node-rs/jieba": "^2.0.1", koffi: "3.1.6" }
      }
    );

    expect(manifest.dependencies.koffi).toBe("3.1.6");

    const withoutKoffi = structuredClone(manifest);
    delete withoutKoffi.dependencies.koffi;
    const result = inspectNpmReleaseDryRun({
      schemaVersion: "archcontext.fg6-npm-release-dry-run/v1",
      taskId: "FG6-release-distribution-dry-run",
      environment: "npm-release-dry-run",
      status: "verified",
      ok: true,
      package: withoutKoffi
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("release package must declare descriptor-relative filesystem dependency");
  });

  test("rejects the scoped workspace manifest when it tries to stand in for the public contracts artifact", () => {
    const sourceManifest = {
      name: "@archcontext/contracts",
      version: "0.1.5",
      private: false,
      type: "module",
      license: "Apache-2.0",
      files: ["src", "fixtures"],
      publishConfig: { access: "public" },
      exports: { ".": "./src/index.ts" }
    };
    const contracts = buildPublicContractsReleaseDryRunReadback({
      sourceManifest,
      packageJson: sourceManifest,
      pack: [{
        name: "@archcontext/contracts",
        version: "0.1.5",
        filename: "archcontext-contracts-0.1.5.tgz"
      }],
      publishDryRun: [{
        name: "@archcontext/contracts",
        version: "0.1.5",
        filename: "archcontext-contracts-0.1.5.tgz",
        files: [
          { path: "src/projection.ts" },
          { path: "fixtures/valid/projection-apply-recovery.json" }
        ]
      }]
    });

    expect(contracts.ok).toBe(false);
    expect(contracts.assertions.publicNameUnscoped).toBe(false);
    expect(contracts.assertions.publicFilesMatchPublishedContract).toBe(false);
    expect(contracts.assertions.publicExportsMatchPublishedContract).toBe(false);
    expect(contracts.assertions.packageContentsIncludeRecoverySchema).toBe(false);
    expect(contracts.failures).toContain("public contracts package must be unscoped archctx-contracts");
  });

  test("rejects repository source publication and wrong package name", () => {
    const recording = buildNpmReleaseDryRunReadback({
      rootManifest: {
        name: "archcontext",
        version: "0.1.5",
        engines: { node: ARCHCONTEXT_NODE_RANGE },
        dependencies: { "@colbymchenry/codegraph": "1.5.0" }
      },
      packageJson: {
        name: "archcontext",
        version: "0.1.5",
        private: false,
        homepage: "https://github.com/Ancienttwo/arch-context#readme",
        packageManager: "bun@1.4.0",
        engines: { node: ARCHCONTEXT_NODE_RANGE, bun: ">=1.4.0" },
        repository: { type: "git", url: "git+https://github.com/Ancienttwo/arch-context.git" },
        bin: { archctx: "./bin/archctx.mjs", codegraph: "./bin/codegraph.mjs" },
        dependencies: {
          "@colbymchenry/codegraph": "1.5.0"
        },
        publishConfig: { registry: "https://registry.npmjs.org/" }
      },
      stageDir: "/tmp/archctx-stage",
      artifactDir: "/tmp/archctx-artifact",
      pack: [
        {
          filename: "archcontext-0.1.5.tgz"
        }
      ],
      publishDryRun: {
        id: "archcontext@0.1.5",
        name: "archcontext",
        version: "0.1.5",
        filename: "archcontext-0.1.5.tgz",
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
    expect(recording.assertions.binExposesOnlyArchctx).toBe(false);
    const result = inspectNpmReleaseDryRun(recording);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("dry-run must be verified ok");
  });

  test("rejects Mermaid or Chromium tooling from the production manifest and tarball", () => {
    const stageDir = createReleaseStageFixture();
    const recording = buildNpmReleaseDryRunReadback({
      rootManifest: {
        name: "archcontext",
        version: "0.1.5",
        engines: { node: ARCHCONTEXT_NODE_RANGE },
        dependencies: { "@colbymchenry/codegraph": "1.5.0" }
      },
      packageJson: {
        name: "archctx",
        version: "0.1.5",
        private: false,
        homepage: "https://archcontext.repoharness.com",
        license: "Apache-2.0",
        engines: { node: ARCHCONTEXT_NODE_RANGE },
        bin: { archctx: "./bin/archctx.mjs" },
        dependencies: {
          "@colbymchenry/codegraph": "1.5.0",
          "@mermaid-js/mermaid-cli": "11.16.0",
          "@node-rs/jieba": "^2.0.1"
        },
        publishConfig: { registry: "https://registry.npmjs.org/" }
      },
      stageDir,
      artifactDir: "/tmp/archctx-artifact",
      pack: [{ filename: "archctx-0.1.5.tgz" }],
      publishDryRun: {
        id: "archctx@0.1.5",
        name: "archctx",
        version: "0.1.5",
        filename: "archctx-0.1.5.tgz",
        files: [
          { path: "bin/archctx.mjs" },
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
          { path: "vendor/chromium/chrome-headless" },
          { path: "package.json" }
        ]
      },
      generatedAt: "2026-06-22T00:00:00.000Z"
    });

    expect(recording.assertions.mermaidChromiumRuntimeAbsent).toBe(false);
    expect(recording.assertions.mermaidChromiumFilesAbsent).toBe(false);
    expect(inspectNpmReleaseDryRun(recording).ok).toBe(false);
    rmSync(stageDir, { recursive: true, force: true });
  });

  test("rejects browser tooling declared through peer or bundled dependencies", () => {
    const stageDir = createReleaseStageFixture();
    const basePackage = {
      name: "archctx",
      version: "0.1.5",
      private: false,
      homepage: "https://archcontext.repoharness.com",
      license: "Apache-2.0",
      engines: { node: ARCHCONTEXT_NODE_RANGE },
      bin: { archctx: "./bin/archctx.mjs" },
      dependencies: {
        "@colbymchenry/codegraph": "1.5.0",
        "@node-rs/jieba": "^2.0.1"
      },
      peerDependencies: { puppeteer: "24.16.0" },
      bundleDependencies: ["chrome-headless-shell"],
      publishConfig: { registry: "https://registry.npmjs.org/" }
    };
    const recording = buildNpmReleaseDryRunReadback({
      rootManifest: {
        name: "archcontext",
        version: "0.1.5",
        engines: { node: ARCHCONTEXT_NODE_RANGE },
        dependencies: { "@colbymchenry/codegraph": "1.5.0" }
      },
      packageJson: basePackage,
      stageDir,
      artifactDir: "/tmp/archctx-artifact",
      pack: [{ filename: "archctx-0.1.5.tgz" }],
      publishDryRun: {
        id: "archctx@0.1.5",
        name: "archctx",
        version: "0.1.5",
        filename: "archctx-0.1.5.tgz",
        files: [
          { path: "bin/archctx.mjs" },
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

    expect(recording.assertions.mermaidChromiumRuntimeAbsent).toBe(false);
    expect(inspectNpmReleaseDryRun(recording).failures).toContain(
      "release package runtime dependency surfaces must exclude Mermaid and browser runtimes"
    );
    rmSync(stageDir, { recursive: true, force: true });
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

function createPublicContractsDryRunFixture() {
  return buildPublicContractsReleaseDryRunReadback({
    sourceManifest: {
      name: "@archcontext/contracts",
      version: "0.1.5",
      private: false,
      type: "module",
      license: "Apache-2.0",
      files: ["src", "fixtures"],
      publishConfig: { access: "public" },
      exports: { ".": "./src/index.ts" }
    },
    packageJson: {
      name: "archctx-contracts",
      version: "0.1.5",
      private: false,
      type: "module",
      license: "Apache-2.0",
      files: ["src", "fixtures", "schemas"],
      publishConfig: { access: "public" },
      exports: {
        ".": "./src/index.ts",
        "./schemas/*": "./schemas/*"
      }
    },
    pack: [{
      name: "archctx-contracts",
      version: "0.1.5",
      filename: "archctx-contracts-0.1.5.tgz"
    }],
    publishDryRun: [{
      id: "archctx-contracts@0.1.5",
      name: "archctx-contracts",
      version: "0.1.5",
      filename: "archctx-contracts-0.1.5.tgz",
      integrity: "sha512-contracts-test",
      shasum: "contracts-test",
      size: 100,
      unpackedSize: 200,
      entryCount: 4,
      files: [
        { path: "src/projection.ts" },
        { path: "fixtures/valid/projection-apply-recovery.json" },
        { path: "schemas/runtime/projection-apply-recovery.schema.json" },
        { path: "package.json" }
      ]
    }]
  });
}
