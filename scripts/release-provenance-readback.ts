#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { productVersionManifest } from "@archcontext/contracts";

const SCHEMA_VERSION = "archcontext.release-provenance-readback/v1";
const DEFAULT_OUT = "docs/verification/release-provenance-readback.json";
const DEFAULT_REPORT = "docs/verification/release-provenance.md";
const RELEASE_PACKAGE_NAME = "archctx";
const REGISTRY = "https://registry.npmjs.org/";
const WORKSPACE_PACKAGE_PATHS = [
  "packages/contracts/package.json",
  "packages/core/package.json",
  "packages/local-runtime/package.json",
  "packages/surfaces/package.json",
  "packages/cloud/package.json"
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildReleaseProvenanceConfig(process.env, args);
    const result = await runReleaseProvenanceReadback(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUT;
    const result = inspectReleaseProvenanceReadback(
      JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown
    );
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[release-provenance-readback] usage: run|inspect [--out path] [--report path] [--json]");
    process.exit(2);
  }
}

export function buildReleaseProvenanceConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    outputPath: readFlag(args, "--out") ?? DEFAULT_OUT,
    reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runReleaseProvenanceReadback(config: ReturnType<typeof buildReleaseProvenanceConfig>) {
  const rootPackage = await readJsonFile(resolve(config.root, "package.json"));
  const workspacePackages = await Promise.all(WORKSPACE_PACKAGE_PATHS.map(async (path) => ({
    path,
    manifest: await readJsonFile(resolve(config.root, path))
  })));
  const dryRun = await readJsonFile(resolve(config.root, "docs/verification/fg6-npm-release-dry-run.json"));
  const distribution = await readJsonFile(resolve(config.root, "docs/verification/fg6-release-distribution-readback.json"));
  const officialRelease = await readJsonFile(resolve(config.root, "docs/verification/architecture-ledger-al10-npm-release-readback.json"));
  const quickstart = await readFile(resolve(config.root, "docs/runbooks/local-core-quickstart.md"), "utf8");
  const personalInstall = await readFile(resolve(config.root, "docs/runbooks/personal-user-install.md"), "utf8");
  const distributionAdr = await readFile(resolve(config.root, "docs/adr/ADR-0034-one-package-local-product-distribution.md"), "utf8");
  const packageScripts = readRecord(rootPackage.scripts);
  const registryPackage = queryNpmJson([
    "view",
    `${RELEASE_PACKAGE_NAME}@latest`,
    "name",
    "version",
    "bin",
    "engines",
    "homepage",
    "license",
    "dist.tarball",
    "dist.shasum",
    "dist.integrity",
    "--json",
    `--registry=${REGISTRY}`
  ]);
  const registryTags = queryNpmJson(["view", RELEASE_PACKAGE_NAME, "dist-tags", "versions", "--json", `--registry=${REGISTRY}`]);
  const sourceHelp = runCliHelp(["bun", "packages/surfaces/cli/src/main.ts", "help"], config.root);
  const publishedHelp = runCliHelp(["npx", "-y", `${RELEASE_PACKAGE_NAME}@latest`, "help"], config.root);
  const recording = buildReleaseProvenanceReadback({
    rootPackage,
    workspacePackages,
    productManifest: productVersionManifest(),
    packageScripts,
    dryRun,
    distribution,
    officialRelease,
    registryPackage,
    registryTags,
    sourceHelp,
    publishedHelp,
    docs: { quickstart, personalInstall, distributionAdr },
    generatedAt: config.generatedAt()
  });
  await writeText(config.root, config.reportPath, renderReport(recording));
  await writeJson(config.root, config.outputPath, recording);
  return recording;
}

export function buildReleaseProvenanceReadback(input: {
  rootPackage: Record<string, unknown>;
  workspacePackages: Array<{ path: string; manifest: Record<string, unknown> }>;
  productManifest: ReturnType<typeof productVersionManifest>;
  packageScripts: Record<string, unknown>;
  dryRun: Record<string, unknown>;
  distribution: Record<string, unknown>;
  officialRelease: Record<string, unknown>;
  registryPackage: Record<string, unknown>;
  registryTags: Record<string, unknown>;
  sourceHelp: HelpReadback;
  publishedHelp: HelpReadback;
  docs: {
    quickstart: string;
    personalInstall: string;
    distributionAdr: string;
  };
  generatedAt: string;
}) {
  const root = summarizePackage("package.json", input.rootPackage);
  const workspaces = input.workspacePackages.map((entry) => summarizePackage(entry.path, entry.manifest));
  const allSourcePackages = [root, ...workspaces];
  const product = input.productManifest.product;
  const dryRunPackage = readRecord(input.dryRun.package);
  const distributionRelease = readRecord(input.distribution.release);
  const officialPackage = readRecord(input.officialRelease.package);
  const officialSmoke = readRecord(input.officialRelease.smoke);
  const officialAssertions = readRecord(input.officialRelease.assertions);
  const distTags = readRecord(input.registryTags["dist-tags"]);
  const registryVersions = readArray(input.registryTags.versions).map(String);
  const sourceCommands = input.sourceHelp.commands;
  const publishedCommands = input.publishedHelp.commands;
  const assertions = {
    sourceManifestVersionsAligned: allSourcePackages.every((entry) => entry.version === root.version),
    sourcePackagesRemainPrivate: allSourcePackages.every((entry) => entry.private === true),
    productManifestMatchesRoot: product.name === RELEASE_PACKAGE_NAME
      && product.version === root.version
      && product.distribution === "one-package",
    generatedPackageMatchesRoot: dryRunPackage.name === RELEASE_PACKAGE_NAME
      && dryRunPackage.version === root.version
      && dryRunPackage.private === false,
    distributionReadbackVerified: input.distribution.status === "verified"
      && input.distribution.ok === true
      && distributionRelease.packageName === RELEASE_PACKAGE_NAME
      && distributionRelease.version === root.version,
    officialNpmReadbackVerified: input.officialRelease.status === "verified"
      && officialPackage.name === RELEASE_PACKAGE_NAME
      && officialPackage.version === root.version,
    registryLatestMatchesRoot: input.registryPackage.name === RELEASE_PACKAGE_NAME
      && input.registryPackage.version === root.version
      && distTags.latest === root.version
      && registryVersions.includes(root.version),
    registryMetadataMatchesOfficialRelease: officialPackage.tarball === readDistField(input.registryPackage, "tarball")
      && officialPackage.shasum === readDistField(input.registryPackage, "shasum")
      && officialPackage.integrity === readDistField(input.registryPackage, "integrity")
      && recordsEqual(readRecord(officialPackage.bin), readRecord(input.registryPackage.bin))
      && recordsEqual(readRecord(officialPackage.engines), readRecord(input.registryPackage.engines)),
    sourceHelpSucceeded: input.sourceHelp.ok === true,
    publishedHelpSucceeded: input.publishedHelp.ok === true,
    sourceHelpMatchesPublishedHelp: arraysEqual(sourceCommands, publishedCommands),
    officialSmokeHelpCountMatchesSource: Number(officialSmoke.helpCommandCount) === sourceCommands.length,
    sourceIncludesLedgerBetaCommands: ["ledger", "book", "recommendations", "investigate", "agents", "jobs"].every((command) => sourceCommands.includes(command)),
    quickstartDocumentsNpmAndCheckoutPaths: input.docs.quickstart.includes("npm install -g archctx@latest")
      && input.docs.quickstart.includes("bun install")
      && input.docs.quickstart.includes("Checkout development path"),
    personalInstallDocumentsLatestAndPinnedPaths: input.docs.personalInstall.includes("npm install -g archctx@latest")
      && input.docs.personalInstall.includes(`npm install -g archctx@${root.version}`),
    distributionBoundaryDocumented: input.docs.distributionAdr.includes("Generated npm package")
      && input.docs.distributionAdr.includes("Root workspace package")
      && input.docs.distributionAdr.includes("Private source packages"),
    readbackScriptInstalled: String(input.packageScripts["readback:release"] ?? "").includes("scripts/release-provenance-readback.ts"),
    authorityPromotionNotImplied: officialAssertions.doesNotEnableLedgerAuthoritativeProductionByItself === true
      && officialAssertions.doesNotBypassChangeSetOrDaemonMutationRules === true
  };
  const failures = Object.entries(assertions)
    .filter(([, ok]) => ok !== true)
    .map(([key]) => key);
  const ok = failures.length === 0;
  return {
    schemaVersion: SCHEMA_VERSION,
    taskId: "release-source-truth-cleanup",
    status: ok ? "verified" : "failed",
    ok,
    generatedAt: input.generatedAt,
    packageRelationship: {
      rootWorkspacePackage: {
        path: root.path,
        name: root.name,
        version: root.version,
        private: root.private,
        role: "workspace-source-manifest"
      },
      privateSourcePackages: workspaces.map((entry) => ({
        path: entry.path,
        name: entry.name,
        version: entry.version,
        private: entry.private,
        binNames: entry.binNames
      })),
      generatedNpmPackage: {
        name: String(dryRunPackage.name ?? officialPackage.name ?? RELEASE_PACKAGE_NAME),
        version: String(dryRunPackage.version ?? officialPackage.version ?? ""),
        private: dryRunPackage.private === true,
        sourceEvidence: "docs/verification/fg6-npm-release-dry-run.json",
        publishedEvidence: "docs/verification/architecture-ledger-al10-npm-release-readback.json"
      }
    },
    versions: {
      product: product.version,
      root: root.version,
      sourcePackages: allSourcePackages.map((entry) => ({ path: entry.path, version: entry.version })),
      npmLatest: String(input.registryPackage.version ?? ""),
      distTags
    },
    helpSurface: {
      source: {
        command: input.sourceHelp.command,
        ok: input.sourceHelp.ok,
        commandCount: sourceCommands.length,
        commands: sourceCommands
      },
      published: {
        command: input.publishedHelp.command,
        ok: input.publishedHelp.ok,
        commandCount: publishedCommands.length,
        commands: publishedCommands
      },
      officialReleaseCommandCount: Number(officialSmoke.helpCommandCount ?? 0)
    },
    releaseArtifacts: {
      dryRun: {
        status: input.dryRun.status,
        ok: input.dryRun.ok,
        package: {
          name: dryRunPackage.name,
          version: dryRunPackage.version,
          private: dryRunPackage.private,
          bin: readRecord(dryRunPackage.bin)
        }
      },
      distribution: {
        status: input.distribution.status,
        ok: input.distribution.ok,
        release: distributionRelease
      },
      officialNpmRelease: {
        status: input.officialRelease.status,
        package: officialPackage,
        smoke: officialSmoke
      },
      registry: {
        package: input.registryPackage,
        tags: distTags,
        versions: registryVersions
      }
    },
    docs: {
      quickstart: "docs/runbooks/local-core-quickstart.md",
      personalInstall: "docs/runbooks/personal-user-install.md",
      distributionAdr: "docs/adr/ADR-0034-one-package-local-product-distribution.md"
    },
    assertions,
    failures
  };
}

export function inspectReleaseProvenanceReadback(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  if (record.schemaVersion !== SCHEMA_VERSION) failures.push("schemaVersion mismatch");
  if (record.taskId !== "release-source-truth-cleanup") failures.push("taskId mismatch");
  if (record.status !== "verified" || record.ok !== true) failures.push("release provenance must be verified ok");
  const assertions = readRecord(record.assertions);
  for (const [key, value] of Object.entries(assertions)) {
    if (value !== true) failures.push(`assertion ${key} must be true`);
  }
  const helpSurface = readRecord(record.helpSurface);
  const source = readRecord(helpSurface.source);
  const published = readRecord(helpSurface.published);
  if (Number(source.commandCount) !== Number(published.commandCount)) failures.push("source and published help command counts must match");
  if (Number(helpSurface.officialReleaseCommandCount) !== Number(source.commandCount)) {
    failures.push("official release help command count must match source");
  }
  const generated = readRecord(readRecord(record.packageRelationship).generatedNpmPackage);
  if (generated.name !== RELEASE_PACKAGE_NAME) failures.push("generated npm package must be archctx");
  return { ok: failures.length === 0, failures };
}

interface HelpReadback {
  command: string;
  ok: boolean;
  commands: string[];
  error?: string;
}

function runCliHelp(command: string[], cwd: string): HelpReadback {
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
    shell: false
  });
  if (result.status !== 0) {
    return {
      command: command.join(" "),
      ok: false,
      commands: [],
      error: `${result.stdout}\n${result.stderr}`.trim()
    };
  }
  try {
    const envelope = readRecord(JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))));
    const data = readRecord(envelope.data);
    return {
      command: command.join(" "),
      ok: envelope.ok === true && envelope.requestId === "help",
      commands: readArray(data.commands).map(String)
    };
  } catch (error) {
    return {
      command: command.join(" "),
      ok: false,
      commands: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function queryNpmJson(args: string[]): Record<string, unknown> {
  const result = spawnSync("npm", args, {
    encoding: "utf8",
    shell: false
  });
  if (result.status !== 0) {
    return {
      error: `${result.stdout}\n${result.stderr}`.trim(),
      exitCode: result.status ?? 1
    };
  }
  return readRecord(JSON.parse(result.stdout || "null"));
}

function summarizePackage(path: string, manifest: Record<string, unknown>) {
  return {
    path,
    name: String(manifest.name ?? ""),
    version: String(manifest.version ?? ""),
    private: manifest.private === true,
    binNames: Object.keys(readRecord(manifest.bin))
  };
}

function renderHuman(recording: ReturnType<typeof buildReleaseProvenanceReadback>) {
  return recording.ok
    ? `release provenance verified: ${recording.packageRelationship.generatedNpmPackage.name}@${recording.packageRelationship.generatedNpmPackage.version}, helpCommands=${recording.helpSurface.source.commandCount}`
    : `release provenance failed:\n- ${recording.failures.join("\n- ")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }) {
  return result.ok ? "release provenance readback is structurally valid" : `release provenance readback invalid:\n- ${result.failures.join("\n- ")}`;
}

function renderReport(recording: ReturnType<typeof buildReleaseProvenanceReadback>) {
  return `# Release Provenance Readback

- Status: ${recording.status}
- Generated At: ${recording.generatedAt}
- Root source package: \`${recording.packageRelationship.rootWorkspacePackage.name}\` ${recording.packageRelationship.rootWorkspacePackage.version}, private=${recording.packageRelationship.rootWorkspacePackage.private}
- Generated npm package: \`${recording.packageRelationship.generatedNpmPackage.name}\` ${recording.packageRelationship.generatedNpmPackage.version}
- npm latest: ${recording.versions.npmLatest}
- Source help commands: ${recording.helpSurface.source.commandCount}
- Published help commands: ${recording.helpSurface.published.commandCount}
- Official release smoke help commands: ${recording.helpSurface.officialReleaseCommandCount}

## Package Relationship

The root workspace package and private workspace packages are source manifests. They stay private and version-aligned. The public npm artifact is generated as \`archctx\` from the release dry-run stage and is verified through registry and install-smoke evidence.

## Result

${recording.ok ? "PASS: release, source manifests, help surface, docs, and npm registry agree." : `FAILED:\n${recording.failures.map((failure) => `- ${failure}`).join("\n")}`}

## Boundary

This readback proves release/source consistency only. It does not promote \`ledger-authoritative\`, enable hard enforcement, or replace production GA external readback.
`;
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function writeJson(root: string, path: string, value: unknown) {
  await writeText(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(root: string, path: string, value: string) {
  const absolute = resolve(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, value, "utf8");
}

function readFlag(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readDistField(metadata: Record<string, unknown>, field: string): unknown {
  const flat = metadata[`dist.${field}`];
  if (flat !== undefined) return flat;
  return readRecord(metadata.dist)[field];
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function recordsEqual(left: Record<string, unknown>, right: Record<string, unknown>) {
  return JSON.stringify(sortRecord(left)) === JSON.stringify(sortRecord(right));
}

function sortRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}
