import { describe, expect, test } from "bun:test";
import {
  buildReleaseDistributionReadback,
  inspectReleaseDistributionReadback
} from "./fg6-release-distribution-readback";

describe("fg6 release distribution readback", () => {
  test("blocks rollout when npm release distribution is not published", () => {
    const recording = buildReleaseDistributionReadback({
      rootPackage: {
        name: "archcontext",
        version: "0.1.4",
        private: true
      },
      workspacePackages: [
        {
          path: "packages/surfaces/package.json",
          manifest: {
            name: "@archcontext/surfaces",
            version: "0.1.4",
            private: true,
            bin: { archctx: "./cli/bin/archctx" }
          }
        }
      ],
      placeholder: {
        name: "archctx",
        version: "0.0.0",
        private: false,
        bin: { archctx: "bin/archctx.js" }
      },
      npmDryRun: undefined,
      registry: [
        { name: "archcontext", status: "missing", version: null, errorCode: "E404" },
        { name: "@archcontext/cli", status: "missing", version: null, errorCode: "E404" },
        {
          name: "archctx",
          status: "published",
          version: "0.0.0",
          engines: { node: ">=24 <26" },
          packageManager: null,
          bin: { archctx: "./bin/archctx.mjs" }
        }
      ],
      generatedAt: "2026-06-22T00:00:00.000Z"
    });

    expect(recording.status).toBe("blocked");
    expect(recording.ok).toBe(false);
    expect(recording.release.ready).toBe(false);
    expect(recording.release.blockers).toContain("root package.json is private");
    expect(recording.release.blockers).toContain("npm release archctx@0.1.4 is not published");
    expect(recording.release.blockers).toContain("npm release dry-run evidence is missing or failed");
    expect(recording.release.blockers).toContain("archctx npm package is placeholder/version 0.0.0, not release 0.1.4");
    expect(inspectReleaseDistributionReadback(recording)).toEqual({ ok: true, failures: [] });
  });

  test("verifies only after a publishable archctx release package exists", () => {
    const recording = buildReleaseDistributionReadback({
      rootPackage: {
        name: "archcontext",
        version: "0.1.4",
        private: true
      },
      workspacePackages: [],
      placeholder: {
        name: "archctx",
        version: "0.0.0",
        private: false,
        bin: { archctx: "bin/archctx.js" }
      },
      npmDryRun: {
        schemaVersion: "archcontext.fg6-npm-release-dry-run/v1",
        status: "verified",
        ok: true,
        package: {
          name: "archctx",
          version: "0.1.4",
          homepage: "https://archcontext.repoharness.com",
          license: "Apache-2.0"
        },
        artifact: {
          tarball: "archctx-0.1.4.tgz",
          publishDryRunId: "archctx@0.1.4"
        },
        rollout: {
          postPublishInstallCommand: "npm install -g archctx@0.1.4"
        }
      },
      registry: [
        { name: "archcontext", status: "missing", version: null, errorCode: "E404" },
        { name: "@archcontext/cli", status: "missing", version: null, errorCode: "E404" },
        {
          name: "archctx",
          status: "published",
          version: "0.1.4",
          license: "Apache-2.0",
          engines: { node: ">=24 <26" },
          packageManager: null,
          bin: { archctx: "bin/archctx.mjs" }
        }
      ],
      generatedAt: "2026-06-22T00:00:00.000Z"
    });

    expect(recording.status).toBe("verified");
    expect(recording.ok).toBe(true);
    expect(recording.release.installCommand).toBe("npm install -g archctx");
    expect(inspectReleaseDistributionReadback(recording)).toEqual({ ok: true, failures: [] });
  });

  test("keeps rollout blocked after dry-run while registry still has only the placeholder", () => {
    const recording = buildReleaseDistributionReadback({
      rootPackage: {
        name: "archcontext",
        version: "0.1.4",
        private: true
      },
      workspacePackages: [],
      placeholder: {
        name: "archctx",
        version: "0.0.0",
        private: false,
        bin: { archctx: "bin/archctx.js" }
      },
      npmDryRun: {
        schemaVersion: "archcontext.fg6-npm-release-dry-run/v1",
        status: "verified",
        ok: true,
        package: {
          name: "archctx",
          version: "0.1.4",
          homepage: "https://archcontext.repoharness.com",
          license: "Apache-2.0"
        },
        artifact: {
          tarball: "archctx-0.1.4.tgz",
          publishDryRunId: "archctx@0.1.4"
        },
        rollout: {
          postPublishInstallCommand: "npm install -g archctx@0.1.4"
        }
      },
      registry: [
        { name: "archcontext", status: "missing", version: null, errorCode: "E404" },
        { name: "@archcontext/cli", status: "missing", version: null, errorCode: "E404" },
        {
          name: "archctx",
          status: "published",
          version: "0.0.0",
          engines: { node: ">=24 <26" },
          packageManager: null,
          bin: { archctx: "./bin/archctx.mjs" }
        }
      ],
      generatedAt: "2026-06-22T00:00:00.000Z"
    });

    expect(recording.status).toBe("blocked");
    expect(recording.assertions.canonicalNameResolved).toBe(true);
    expect(recording.assertions.npmDryRunVerified).toBe(true);
    expect(recording.release.postPublishInstallCommand).toBe("npm install -g archctx@0.1.4");
    expect(recording.release.blockers).toContain("npm release archctx@0.1.4 is not published");
    expect(recording.release.blockers).toContain("public npm install command is not available for rollout");
    expect(recording.release.blockers).not.toContain("root package.json is private");
    expect(inspectReleaseDistributionReadback(recording)).toEqual({ ok: true, failures: [] });
  });

  test("rejects malformed readback status", () => {
    const result = inspectReleaseDistributionReadback({
      schemaVersion: "archcontext.fg6-release-distribution-readback/v1",
      taskId: "FG6-release-distribution",
      environment: "release-distribution",
      status: "verified",
      ok: false,
      sources: {
        homeUrl: "https://archcontext.repoharness.com"
      },
      release: {
        ready: true,
        blockers: []
      },
      assertions: {
        homeUrlCorrect: true
      }
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("verified status must have ok true");
  });

  test("blocks rollout when the published package still requires Bun", () => {
    const recording = buildReleaseDistributionReadback({
      rootPackage: {
        name: "archcontext",
        version: "0.1.1",
        private: true
      },
      workspacePackages: [],
      placeholder: undefined,
      npmDryRun: {
        schemaVersion: "archcontext.fg6-npm-release-dry-run/v1",
        status: "verified",
        ok: true,
        package: {
          name: "archctx",
          version: "0.1.1",
          homepage: "https://archcontext.repoharness.com",
          license: "Apache-2.0"
        },
        artifact: {
          tarball: "archctx-0.1.1.tgz",
          publishDryRunId: "archctx@0.1.1"
        },
        rollout: {
          postPublishInstallCommand: "npm install -g archctx@0.1.1"
        }
      },
      registry: [
        { name: "archcontext", status: "missing", version: null, errorCode: "E404" },
        { name: "@archcontext/cli", status: "missing", version: null, errorCode: "E404" },
        {
          name: "archctx",
          status: "published",
          version: "0.1.1",
          license: "Apache-2.0",
          engines: { node: ">=24 <26", bun: ">=1.3.10" },
          packageManager: "bun@1.3.10",
          bin: { archctx: "./bin/archctx.mjs" }
        }
      ],
      generatedAt: "2026-06-22T00:00:00.000Z"
    });

    expect(recording.status).toBe("blocked");
    expect(recording.assertions.npmReleasePublished).toBe(true);
    expect(recording.assertions.publishedRuntimeNodeOnly).toBe(false);
    expect(recording.release.blockers).toContain("npm release archctx@0.1.1 is not a Node-only CLI artifact");
    expect(inspectReleaseDistributionReadback(recording)).toEqual({ ok: true, failures: [] });
  });
});
