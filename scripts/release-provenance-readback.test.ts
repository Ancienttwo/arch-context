import { describe, expect, test } from "bun:test";
import { productVersionManifest } from "@archcontext/contracts";
import {
  buildReleaseProvenanceReadback,
  inspectReleaseProvenanceReadback
} from "./release-provenance-readback";

const HELP_COMMANDS = ["ledger", "book", "recommendations", "investigate", "agents", "jobs"];
const RELEASE_VERSION = productVersionManifest().product.version;

describe("release provenance readback", () => {
  test("verifies source manifests, generated npm package, registry, docs, and help surface", () => {
    const recording = buildReleaseProvenanceReadback(validInput());

    expect(recording.status).toBe("verified");
    expect(recording.ok).toBe(true);
    expect(recording.packageRelationship.rootWorkspacePackage.name).toBe("archcontext");
    expect(recording.packageRelationship.rootWorkspacePackage.private).toBe(true);
    expect(recording.packageRelationship.generatedNpmPackage.name).toBe("archctx");
    expect(recording.helpSurface.source.commandCount).toBe(HELP_COMMANDS.length);
    expect(recording.helpSurface.published.commandCount).toBe(HELP_COMMANDS.length);
    expect(inspectReleaseProvenanceReadback(recording)).toEqual({ ok: true, failures: [] });
  });

  test("fails when published help is behind source help", () => {
    const input = validInput();
    input.publishedHelp = {
      command: "npx -y archctx@latest help",
      ok: true,
      commands: HELP_COMMANDS.filter((command) => command !== "jobs")
    };
    const recording = buildReleaseProvenanceReadback(input);

    expect(recording.status).toBe("failed");
    expect(recording.assertions.sourceHelpMatchesPublishedHelp).toBe(false);
    expect(inspectReleaseProvenanceReadback(recording).ok).toBe(false);
  });

  test("fails when release evidence implies production authority promotion", () => {
    const input = validInput();
    (input.officialRelease.assertions as Record<string, unknown>).doesNotEnableLedgerAuthoritativeProductionByItself = false;
    const recording = buildReleaseProvenanceReadback(input);

    expect(recording.status).toBe("failed");
    expect(recording.assertions.authorityPromotionNotImplied).toBe(false);
    expect(recording.failures).toContain("authorityPromotionNotImplied");
  });
});

function validInput(): Parameters<typeof buildReleaseProvenanceReadback>[0] {
  return {
    rootPackage: {
      name: "archcontext",
      version: RELEASE_VERSION,
      private: true
    },
    workspacePackages: [
      sourcePackage("packages/contracts/package.json", "@archcontext/contracts"),
      sourcePackage("packages/core/package.json", "@archcontext/core"),
      sourcePackage("packages/local-runtime/package.json", "@archcontext/local-runtime"),
      sourcePackage("packages/surfaces/package.json", "@archcontext/surfaces", { archctx: "./cli/bin/archctx" }),
      sourcePackage("packages/cloud/package.json", "@archcontext/cloud")
    ],
    productManifest: productVersionManifest(),
    packageScripts: {
      "readback:release": "bun scripts/release-provenance-readback.ts run --out docs/verification/release-provenance-readback.json --report docs/verification/release-provenance.md --json"
    },
    dryRun: {
      schemaVersion: "archcontext.fg6-npm-release-dry-run/v1",
      status: "verified",
      ok: true,
      package: {
        name: "archctx",
        version: RELEASE_VERSION,
        private: false,
        bin: {
          archctx: "./bin/archctx.mjs",
          codegraph: "./bin/codegraph.mjs"
        }
      }
    },
    distribution: {
      schemaVersion: "archcontext.fg6-release-distribution-readback/v1",
      status: "verified",
      ok: true,
      release: {
        packageName: "archctx",
        version: RELEASE_VERSION
      }
    },
    officialRelease: {
      schemaVersion: "archcontext.al10-npm-release-readback/v1",
      status: "verified",
      package: {
        name: "archctx",
        version: RELEASE_VERSION,
        tarball: `https://registry.npmjs.org/archctx/-/archctx-${RELEASE_VERSION}.tgz`,
        shasum: "abc",
        integrity: "sha512-test",
        bin: {
          archctx: "bin/archctx.mjs",
          codegraph: "bin/codegraph.mjs"
        },
        engines: {
          node: ">=24 <26"
        }
      },
      smoke: {
        helpCommandCount: HELP_COMMANDS.length
      },
      assertions: {
        doesNotEnableLedgerAuthoritativeProductionByItself: true,
        doesNotBypassChangeSetOrDaemonMutationRules: true
      }
    },
    registryPackage: {
      name: "archctx",
      version: RELEASE_VERSION,
      dist: {
        tarball: `https://registry.npmjs.org/archctx/-/archctx-${RELEASE_VERSION}.tgz`,
        shasum: "abc",
        integrity: "sha512-test"
      },
      bin: {
        archctx: "bin/archctx.mjs",
        codegraph: "bin/codegraph.mjs"
      },
      engines: {
        node: ">=24 <26"
      }
    },
    registryTags: {
      "dist-tags": {
        latest: RELEASE_VERSION,
        beta: "0.1.4-beta.0"
      },
      versions: ["0.1.4-beta.0", "0.1.4", RELEASE_VERSION]
    },
    sourceHelp: {
      command: "bun packages/surfaces/cli/src/main.ts help",
      ok: true,
      commands: HELP_COMMANDS
    },
    publishedHelp: {
      command: "npx -y archctx@latest help",
      ok: true,
      commands: HELP_COMMANDS
    },
    docs: {
      quickstart: "npm install -g archctx@latest\nbun install\nCheckout development path\n",
      personalInstall: `npm install -g archctx@latest\nnpm install -g archctx@${RELEASE_VERSION}\n`,
      distributionAdr: "Root workspace package\nPrivate source packages\nGenerated npm package\n"
    },
    generatedAt: "2026-06-27T00:00:00.000Z"
  };
}

function sourcePackage(path: string, name: string, bin?: Record<string, string>) {
  return {
    path,
    manifest: {
      name,
      version: RELEASE_VERSION,
      private: true,
      ...(bin ? { bin } : {})
    }
  };
}
