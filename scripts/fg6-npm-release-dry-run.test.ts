import { describe, expect, test } from "bun:test";
import {
  buildNpmReleaseDryRunReadback,
  inspectNpmReleaseDryRun
} from "./fg6-npm-release-dry-run";

describe("fg6 npm release dry-run", () => {
  test("accepts a publishable archctx dry-run artifact", () => {
    const recording = buildNpmReleaseDryRunReadback({
      rootManifest: {
        name: "archcontext",
        version: "0.1.0",
        engines: { node: ">=24 <26" }
      },
      packageJson: {
        name: "archctx",
        version: "0.1.0",
        private: false,
        homepage: "https://archcontext.repoharness.com",
        license: "UNLICENSED",
        engines: { node: ">=24 <26" },
        bin: { archctx: "./bin/archctx.mjs", codegraph: "./bin/codegraph.mjs" },
        publishConfig: { registry: "https://registry.npmjs.org/" }
      },
      stageDir: "/tmp/archctx-stage",
      artifactDir: "/tmp/archctx-artifact",
      pack: [
        {
          filename: "archctx-0.1.0.tgz"
        }
      ],
      publishDryRun: {
        id: "archctx@0.1.0",
        name: "archctx",
        version: "0.1.0",
        filename: "archctx-0.1.0.tgz",
        integrity: "sha512-test",
        shasum: "abc",
        size: 100,
        unpackedSize: 200,
        entryCount: 4,
        files: [
          { path: "bin/archctx.mjs" },
          { path: "bin/codegraph.mjs" },
          { path: "README.md" },
          { path: "package.json" }
        ]
      },
      generatedAt: "2026-06-22T00:00:00.000Z"
    });

    expect(recording.status).toBe("verified");
    expect(recording.ok).toBe(true);
    expect(recording.package.name).toBe("archctx");
    expect(recording.rollout.postPublishInstallCommand).toBe("npm install -g archctx@0.1.0");
    expect(inspectNpmReleaseDryRun(recording)).toEqual({ ok: true, failures: [] });
  });

  test("rejects repository source publication and wrong package name", () => {
    const recording = buildNpmReleaseDryRunReadback({
      rootManifest: {
        name: "archcontext",
        version: "0.1.0",
        engines: { node: ">=24 <26" }
      },
      packageJson: {
        name: "archcontext",
        version: "0.1.0",
        private: false,
        homepage: "https://github.com/Ancienttwo/arch-context#readme",
        packageManager: "bun@1.3.10",
        engines: { node: ">=24 <26", bun: ">=1.3.10" },
        repository: { type: "git", url: "git+https://github.com/Ancienttwo/arch-context.git" },
        bin: { archctx: "./bin/archctx.mjs" },
        publishConfig: { registry: "https://registry.npmjs.org/" }
      },
      stageDir: "/tmp/archctx-stage",
      artifactDir: "/tmp/archctx-artifact",
      pack: [
        {
          filename: "archcontext-0.1.0.tgz"
        }
      ],
      publishDryRun: {
        id: "archcontext@0.1.0",
        name: "archcontext",
        version: "0.1.0",
        filename: "archcontext-0.1.0.tgz",
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
