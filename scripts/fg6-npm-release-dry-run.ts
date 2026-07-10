#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_OUTPUT = "docs/verification/fg6-npm-release-dry-run.json";
const DEFAULT_ARTIFACT_DIR = "_ops/npm/fg6-release-dry-run";
const RELEASE_PACKAGE_NAME = "archctx";
const HOME_URL = "https://archcontext.repoharness.com";
const REGISTRY = "https://registry.npmjs.org/";
const RELEASE_ASSET_FILES = [
  "assets/catalog.yaml",
  "assets/practices/s6-expanded.yaml",
  "assets/profiles/s6.yaml",
  "assets/sources/core.yaml",
  "assets/sources/s6.yaml"
] as const;
const RELEASE_SCHEMA_FILES = [
  "schemas/repo/practices/practice.schema.json",
  "schemas/repo/practices/practice-source.schema.json",
  "schemas/repo/practices/practice-profile.schema.json",
  "schemas/runtime/practice-catalog-manifest.schema.json",
  "schemas/runtime/practice-match.schema.json",
  "schemas/runtime/practice-guidance.schema.json",
  "schemas/runtime/practice-checkpoint.schema.json"
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildNpmReleaseDryRunConfig(process.env, args);
    const result = await runNpmReleaseDryRun(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const result = inspectNpmReleaseDryRun(JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg6-npm-release-dry-run] usage: run|inspect [--out path] [--artifact-dir path] [--json] [--keep-temp]");
    process.exit(2);
  }
}

export function buildNpmReleaseDryRunConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_NPM_RELEASE_DRY_RUN_OUTPUT ?? DEFAULT_OUTPUT,
    artifactDir: readFlag(args, "--artifact-dir") ?? env.ARCHCONTEXT_FG6_NPM_RELEASE_ARTIFACT_DIR ?? DEFAULT_ARTIFACT_DIR,
    keepTemp: args.includes("--keep-temp"),
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runNpmReleaseDryRun(config: ReturnType<typeof buildNpmReleaseDryRunConfig>) {
  const rootManifest = JSON.parse(readFileSync(resolve(config.root, "package.json"), "utf8")) as Record<string, unknown>;
  const coreManifest = JSON.parse(readFileSync(resolve(config.root, "packages/core/package.json"), "utf8")) as Record<string, unknown>;
  const artifactDir = resolve(config.root, config.artifactDir);
  mkdirSync(artifactDir, { recursive: true });
  const stageDir = mkdtempSync(join(tmpdir(), "archctx-npm-release-stage-"));
  try {
    const packageJson = buildReleaseManifest(rootManifest, coreManifest);
    buildReleaseStage(config.root, stageDir, packageJson);
    const pack = runJsonCommand("npm", ["pack", "--json", "--pack-destination", artifactDir], stageDir);
    const publishDryRun = runJsonCommand("npm", ["pack", "--dry-run", "--json"], stageDir);
    const recording = buildNpmReleaseDryRunReadback({
      rootManifest,
      packageJson,
      stageDir,
      artifactDir,
      pack,
      publishDryRun,
      generatedAt: config.generatedAt()
    });
    await writeJson(config.root, config.outputPath, recording);
    return recording;
  } finally {
    if (!config.keepTemp) rmSync(stageDir, { recursive: true, force: true });
  }
}

export function buildNpmReleaseDryRunReadback(input: {
  rootManifest: Record<string, unknown>;
  packageJson: Record<string, unknown>;
  stageDir: string;
  artifactDir: string;
  pack: unknown;
  publishDryRun: unknown;
  generatedAt: string;
}) {
  const packEntries = Array.isArray(input.pack) ? input.pack.map(readRecord) : [readRecord(input.pack)];
  const packEntry = packEntries[0] ?? {};
  const dryRunEntries = Array.isArray(input.publishDryRun)
    ? input.publishDryRun.map(readRecord)
    : [readRecord(input.publishDryRun)];
  const publish = dryRunEntries[0] ?? {};
  const publishFiles = readArray(publish.files).map(readRecord);
  const packageFiles = publishFiles.map((file) => String(file.path ?? ""));
  const tarballName = String(packEntry.filename ?? publish.filename ?? "");
  const releaseAssets = inspectReleaseAssetStage(input.stageDir, packageFiles);
  const assertions = {
    packageNameResolved: input.packageJson.name === RELEASE_PACKAGE_NAME,
    packageVersionMatchesRoot: input.packageJson.version === input.rootManifest.version,
    packagePublishable: input.packageJson.private === false,
    packageLicenseApache: input.packageJson.license === "Apache-2.0",
    nodeRuntimeDeclared: readRecord(input.packageJson.engines).node === readRecord(input.rootManifest.engines).node,
    noBunRuntimeDeclared: !("packageManager" in input.packageJson)
      && !("bun" in readRecord(input.packageJson.engines)),
    nativeTokenizerDependencyDeclared: readRecord(input.packageJson.dependencies)["@node-rs/jieba"] === "^2.0.1",
    homeUrlCorrect: input.packageJson.homepage === HOME_URL,
    noSourceRepositoryUrl: !("repository" in input.packageJson),
    binExposesOnlyArchctx: Object.keys(readRecord(input.packageJson.bin)).length === 1
      && readRecord(input.packageJson.bin).archctx === "./bin/archctx.mjs",
    codeGraphDependencyMatchesRoot: readRecord(input.packageJson.dependencies)["@colbymchenry/codegraph"]
      === readRecord(input.rootManifest.dependencies)["@colbymchenry/codegraph"],
    publishRegistryCorrect: readRecord(input.packageJson.publishConfig).registry === REGISTRY,
    npmPackProducedTarball: tarballName === `${RELEASE_PACKAGE_NAME}-${input.rootManifest.version}.tgz`,
    publishDryRunSucceeded: (publish.name ?? input.packageJson.name) === RELEASE_PACKAGE_NAME
      && (publish.version ?? input.packageJson.version) === input.rootManifest.version,
    packageContentsIncludePracticeCatalog: RELEASE_ASSET_FILES.every((path) => packageFiles.includes(path)),
    packageContentsIncludePracticeSchemas: RELEASE_SCHEMA_FILES.every((path) => packageFiles.includes(path)),
    packageContentsIncludeAttributionNotice: packageFiles.includes("NOTICE.md")
      && releaseAssets.noticeMentionsAllAttribution === true,
    releaseAssetsProvenanceComplete: releaseAssets.sourceRecordCount > 0
      && releaseAssets.sourcesMissingAttribution.length === 0
      && releaseAssets.sourcesMissingDigest.length === 0
      && releaseAssets.sourcesMissingLicense.length === 0,
    context7OptionalNotRequired: !Object.keys(readRecord(input.packageJson.dependencies)).some((name) => name.toLowerCase().includes("context7"))
      && !Object.keys(readRecord(input.packageJson.optionalDependencies)).some((name) => name.toLowerCase().includes("context7")),
    packageContentsBounded: packageFiles.includes("bin/archctx.mjs")
      && !packageFiles.includes("bin/codegraph.mjs")
      && packageFiles.includes("README.md")
      && packageFiles.includes("package.json")
      && !packageFiles.some((path) => path.includes("src/") || path.includes("packages/") || path.includes(".git") || path.includes("_ops"))
  };
  const failures = Object.entries(assertions)
    .filter(([, ok]) => ok !== true)
    .map(([key]) => key);
  return {
    schemaVersion: "archcontext.fg6-npm-release-dry-run/v1",
    taskId: "FG6-release-distribution-dry-run",
    environment: "npm-release-dry-run",
    status: failures.length === 0 ? "verified" : "failed",
    ok: failures.length === 0,
    generatedAt: input.generatedAt,
    package: {
      name: String(input.packageJson.name ?? ""),
      version: String(input.packageJson.version ?? ""),
      private: input.packageJson.private === true,
      homepage: String(input.packageJson.homepage ?? ""),
      license: String(input.packageJson.license ?? ""),
      packageManager: typeof input.packageJson.packageManager === "string" ? input.packageJson.packageManager : null,
      engines: readRecord(input.packageJson.engines),
      bin: readRecord(input.packageJson.bin),
      dependencies: readRecord(input.packageJson.dependencies),
      publishConfig: readRecord(input.packageJson.publishConfig)
    },
    artifact: {
      artifactDir: displayPath(input.artifactDir),
      tarball: tarballName,
      publishDryRunId: String(publish.id ?? `${input.packageJson.name}@${input.packageJson.version}`),
      integrity: String(publish.integrity ?? ""),
      shasum: String(publish.shasum ?? ""),
      size: Number(publish.size ?? 0),
      unpackedSize: Number(publish.unpackedSize ?? 0),
      entryCount: Number(publish.entryCount ?? 0),
      files: packageFiles
    },
    releaseAssets,
    rollout: {
      postPublishInstallCommand: `npm install -g ${RELEASE_PACKAGE_NAME}@${input.rootManifest.version}`,
      homeUrl: HOME_URL
    },
    assertions,
    failures
  };
}

export function inspectNpmReleaseDryRun(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const pkg = readRecord(record.package);
  const artifact = readRecord(record.artifact);
  const rollout = readRecord(record.rollout);
  const assertions = readRecord(record.assertions);
  if (record.schemaVersion !== "archcontext.fg6-npm-release-dry-run/v1") failures.push("schemaVersion mismatch");
  if (record.taskId !== "FG6-release-distribution-dry-run") failures.push("taskId mismatch");
  if (record.environment !== "npm-release-dry-run") failures.push("environment mismatch");
  if (record.status !== "verified" || record.ok !== true) failures.push("dry-run must be verified ok");
  if (pkg.name !== RELEASE_PACKAGE_NAME) failures.push("package name must be archctx");
  if (pkg.private !== false) failures.push("release package must be publishable");
  if (pkg.license !== "Apache-2.0") failures.push("release package license must be Apache-2.0");
  if (pkg.homepage !== HOME_URL) failures.push("homepage must be archcontext.repoharness.com");
  if (pkg.packageManager !== null) failures.push("release package must not declare packageManager runtime");
  if (readRecord(pkg.engines).node !== ">=24 <26") failures.push("engines.node must be declared");
  if ("bun" in readRecord(pkg.engines)) failures.push("engines.bun must not be declared");
  if (readRecord(pkg.dependencies)["@node-rs/jieba"] !== "^2.0.1") failures.push("release package must declare native tokenizer dependency");
  const packageBin = readRecord(pkg.bin);
  if (Object.keys(packageBin).length !== 1 || packageBin.archctx !== "./bin/archctx.mjs") {
    failures.push("release package bin must expose only archctx");
  }
  if (readRecord(pkg.dependencies)["@colbymchenry/codegraph"] !== "1.4.0") {
    failures.push("release package must declare exact CodeGraph dependency 1.4.0");
  }
  if (!String(artifact.tarball ?? "").startsWith(`${RELEASE_PACKAGE_NAME}-`)) failures.push("tarball must use archctx package name");
  const releaseAssets = readRecord(record.releaseAssets);
  if (Number(releaseAssets.sourceRecordCount ?? 0) <= 0) failures.push("release assets must include source registry records");
  if (readArray(releaseAssets.sourcesMissingAttribution).length > 0) failures.push("release source registry must include attribution");
  if (readArray(releaseAssets.sourcesMissingDigest).length > 0) failures.push("release source registry must include content digests");
  if (readArray(releaseAssets.sourcesMissingLicense).length > 0) failures.push("release source registry must include license data");
  if (releaseAssets.noticeMentionsAllAttribution !== true) failures.push("NOTICE.md must mention all source attributions");
  if (!String(rollout.postPublishInstallCommand ?? "").startsWith(`npm install -g ${RELEASE_PACKAGE_NAME}@`)) {
    failures.push("post-publish install command must use archctx");
  }
  for (const [key, value] of Object.entries(assertions)) {
    if (value !== true) failures.push(`assertion ${key} must be true`);
  }
  return { ok: failures.length === 0, failures };
}

function buildReleaseManifest(rootManifest: Record<string, unknown>, coreManifest: Record<string, unknown> = {}) {
  return {
    name: RELEASE_PACKAGE_NAME,
    version: String(rootManifest.version ?? ""),
    description: "Local architecture context CLI for agentic coding workflows.",
    private: false,
    type: "module",
    bin: {
      archctx: "./bin/archctx.mjs"
    },
    files: [
      "bin",
      "assets",
      "schemas",
      "NOTICE.md",
      "README.md"
    ],
    homepage: HOME_URL,
    license: "Apache-2.0",
    publishConfig: {
      registry: REGISTRY
    },
    engines: readRecord(rootManifest.engines),
    dependencies: {
      "@colbymchenry/codegraph": readRecord(rootManifest.dependencies)["@colbymchenry/codegraph"],
      "@node-rs/jieba": readRecord(coreManifest.dependencies)["@node-rs/jieba"]
    }
  };
}

function buildReleaseStage(root: string, stageDir: string, packageJson: Record<string, unknown>) {
  const binDir = join(stageDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const binPath = join(binDir, "archctx.mjs");
  runCommand("bun", [
    "build",
    "packages/surfaces/cli/src/main.ts",
    "--target=node",
    "--format=esm",
    "--outdir",
    binDir,
    "--entry-naming",
    "archctx.mjs",
    "--external=@node-rs/jieba",
    "--external=@node-rs/jieba/dict.js"
  ], root);
  rewriteShebang(binPath, "#!/usr/bin/env node");
  chmodSync(binPath, 0o755);
  if (!existsSync(binPath)) throw new Error(`missing built bin: ${binPath}`);
  copyReleaseSupportFiles(root, stageDir);
  writeFileSync(join(stageDir, "README.md"), [
    "# archctx",
    "",
    "ArchContext local runtime and CLI for agentic coding workflows.",
    "",
    `Product home: ${HOME_URL}`,
    "",
    "This package contains the one-package Local Core distribution.",
    "It does not require a GitHub App, Cloud account, subscription, or LLM provider for Local Core."
  ].join("\n"), "utf8");
  writeFileSync(join(stageDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

function copyReleaseSupportFiles(root: string, stageDir: string) {
  cpSync(join(root, "packages/core/practice-catalog/assets"), join(stageDir, "assets"), { recursive: true });
  cpSync(join(root, "schemas"), join(stageDir, "schemas"), { recursive: true });
  writeFileSync(join(stageDir, "NOTICE.md"), renderNotice(stageDir), "utf8");
}

function renderNotice(stageDir: string): string {
  const sources = readReleaseSourceRecords(join(stageDir, "assets", "sources"));
  const lines = [
    "# archctx Notices",
    "",
    "This package includes curated architecture practice assets. The source registry bundled in `assets/sources/` is the authoritative provenance record.",
    ""
  ];
  for (const source of sources) {
    lines.push(`- ${String(source.name ?? source.id)} (${String(source.id ?? "unknown")}): ${String(source.licenseSpdx ?? "unknown license")}; ${String(source.attribution ?? "missing attribution")}; revision ${String(source.revision ?? "unknown")}.`);
  }
  lines.push("");
  return lines.join("\n");
}

function runJsonCommand(command: string, args: string[], cwd: string): unknown {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? 1}): ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout || "null");
}

function inspectReleaseAssetStage(stageDir: string, packageFiles: string[]) {
  const sources = readReleaseSourceRecords(join(stageDir, "assets", "sources"));
  const attributions = sources.map((source) => String(source.attribution ?? "")).filter(Boolean);
  const notice = existsSync(join(stageDir, "NOTICE.md")) ? readFileSync(join(stageDir, "NOTICE.md"), "utf8") : "";
  return {
    assetRoot: "assets",
    schemaRoot: "schemas",
    practiceFileCount: listFiles(join(stageDir, "assets", "practices")).length,
    profileFileCount: listFiles(join(stageDir, "assets", "profiles")).length,
    sourceFileCount: listFiles(join(stageDir, "assets", "sources")).length,
    sourceRecordCount: sources.length,
    schemaFileCount: listFiles(join(stageDir, "schemas")).filter((path) => path.endsWith(".json")).length,
    requiredAssetFiles: RELEASE_ASSET_FILES.map((path) => ({ path, packaged: packageFiles.includes(path), staged: existsSync(join(stageDir, path)) })),
    requiredSchemaFiles: RELEASE_SCHEMA_FILES.map((path) => ({ path, packaged: packageFiles.includes(path), staged: existsSync(join(stageDir, path)) })),
    sourcesMissingAttribution: sources.filter((source) => !source.attribution).map((source) => String(source.id ?? "unknown")),
    sourcesMissingDigest: sources.filter((source) => !String(source.contentDigest ?? "").startsWith("sha256:")).map((source) => String(source.id ?? "unknown")),
    sourcesMissingLicense: sources.filter((source) => !source.licenseSpdx || !source.licenseLevel || !source.usagePolicy).map((source) => String(source.id ?? "unknown")),
    noticeFile: "NOTICE.md",
    noticeMentionsAllAttribution: attributions.length > 0 && attributions.every((attribution) => notice.includes(attribution))
  };
}

function readReleaseSourceRecords(dir: string): Record<string, unknown>[] {
  return listFiles(dir)
    .filter((path) => path.endsWith(".yaml") || path.endsWith(".json"))
    .flatMap((path) => {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      return Array.isArray(parsed) ? parsed.map(readRecord) : [readRecord(parsed)];
    });
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function runCommand(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? 1}): ${result.stderr || result.stdout}`);
  }
}

function rewriteShebang(path: string, shebang: string) {
  const content = readFileSync(path, "utf8");
  const withoutExisting = content.startsWith("#!") ? content.slice(content.indexOf("\n") + 1) : content;
  writeFileSync(path, `${shebang}\n${withoutExisting}`, "utf8");
}

function renderHuman(recording: ReturnType<typeof buildNpmReleaseDryRunReadback>) {
  return recording.ok
    ? `FG6 npm release dry-run verified: ${recording.package.name}@${recording.package.version}`
    : `FG6 npm release dry-run failed:\n- ${recording.failures.join("\n- ")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }) {
  return result.ok ? "FG6 npm release dry-run verified" : `FG6 npm release dry-run invalid:\n- ${result.failures.join("\n- ")}`;
}

async function writeJson(root: string, path: string, value: unknown) {
  const absolute = resolve(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function displayPath(path: string) {
  return path.replace(`${process.cwd()}/`, "");
}
