#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_OUTPUT = "docs/verification/fg6-release-distribution-readback.json";
const DEFAULT_REPORT = "docs/verification/fg6-release-distribution.md";
const DEFAULT_DRY_RUN = "docs/verification/fg6-npm-release-dry-run.json";
const INSTALL_CANDIDATES = ["archcontext", "@archcontext/cli", "archctx"] as const;
const EXPECTED_HOME_URL = "https://archcontext.repoharness.com";

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildReleaseDistributionReadbackConfig(process.env, args);
    const result = await runReleaseDistributionReadback(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.release.ready) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const result = inspectReleaseDistributionReadback(
      JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown
    );
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg6-release-distribution-readback] usage: run|inspect [--out path] [--report path] [--json] [--offline]");
    process.exit(2);
  }
}

export function buildReleaseDistributionReadbackConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_RELEASE_DISTRIBUTION_OUTPUT ?? DEFAULT_OUTPUT,
    reportPath: readFlag(args, "--report") ?? env.ARCHCONTEXT_FG6_RELEASE_DISTRIBUTION_REPORT ?? DEFAULT_REPORT,
    offline: args.includes("--offline"),
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runReleaseDistributionReadback(config: ReturnType<typeof buildReleaseDistributionReadbackConfig>) {
  const rootPackage = await readJsonFile(resolve(config.root, "package.json"));
  const workspacePackagePaths = [
    "packages/contracts/package.json",
    "packages/core/package.json",
    "packages/local-runtime/package.json",
    "packages/surfaces/package.json",
    "packages/cloud/package.json"
  ];
  const workspacePackages = await Promise.all(workspacePackagePaths.map(async (path) => ({
    path,
    manifest: await readJsonFile(resolve(config.root, path))
  })));
  const placeholder = await readOptionalJsonFile(resolve(config.root, "_ops/npm/archctx-placeholder/package.json"));
  const npmDryRun = await readOptionalJsonFile(resolve(config.root, DEFAULT_DRY_RUN));
  const registry = config.offline
    ? INSTALL_CANDIDATES.map((name) => ({ name, status: "not_checked" as const, version: null, errorCode: "offline" }))
    : INSTALL_CANDIDATES.map(queryNpmPackage);
  const recording = buildReleaseDistributionReadback({
    rootPackage,
    workspacePackages,
    placeholder,
    npmDryRun,
    registry,
    generatedAt: config.generatedAt()
  });
  await writeText(config.root, config.reportPath, renderReport(recording));
  await writeJson(config.root, config.outputPath, recording);
  return recording;
}

export function buildReleaseDistributionReadback(input: {
  rootPackage: Record<string, unknown>;
  workspacePackages: Array<{ path: string; manifest: Record<string, unknown> }>;
  placeholder?: Record<string, unknown>;
  npmDryRun?: Record<string, unknown>;
  registry: Array<{
    name: string;
    status: string;
    version: string | null;
    errorCode?: string;
    homepage?: string | null;
    license?: string | null;
    engines?: Record<string, unknown>;
    packageManager?: string | null;
    bin?: Record<string, unknown>;
  }>;
  generatedAt: string;
}) {
  const rootPackage = summarizePackage("package.json", input.rootPackage);
  const workspacePackages = input.workspacePackages.map((entry) => summarizePackage(entry.path, entry.manifest));
  const placeholder = input.placeholder ? summarizePackage("_ops/npm/archctx-placeholder/package.json", input.placeholder) : null;
  const npmDryRun = summarizeDryRun(input.npmDryRun);
  const publishedCandidates = input.registry.filter((entry) => entry.status === "published");
  const releasePackageName = npmDryRun?.packageName ?? "";
  const releaseCandidates = publishedCandidates.filter((entry) => entry.version === rootPackage.version && entry.name === releasePackageName);
  const releaseCandidate = releaseCandidates[0];
  const placeholderRegistry = input.registry.find((entry) => entry.name === "archctx");
  const publishableManifests = [rootPackage, ...workspacePackages].filter((entry) => entry.private === false);
  const packageNameSources = unique([
    rootPackage.name,
    ...workspacePackages.map((entry) => entry.name),
    placeholder?.name,
    ...INSTALL_CANDIDATES
  ].filter((value): value is string => Boolean(value)));
  const dryRunReady = npmDryRun?.ok === true
    && npmDryRun.packageName === "archctx"
    && npmDryRun.version === rootPackage.version
    && npmDryRun.homepage === EXPECTED_HOME_URL
    && npmDryRun.postPublishInstallCommand === `npm install -g archctx@${rootPackage.version}`;
  const assertions = {
    canonicalNameResolved: dryRunReady || releaseCandidates.length === 1,
    npmDryRunVerified: dryRunReady,
    npmDryRunLicenseApache: npmDryRun?.license === "Apache-2.0",
    rootManifestPublishable: rootPackage.private === false,
    workspaceReleaseManifestPublishable: publishableManifests.some((entry) => entry.binNames.includes("archctx")),
    npmReleasePublished: releaseCandidates.length >= 1,
    publishedRuntimeNodeOnly: releaseCandidates.length >= 1
      && readRecord(releaseCandidate?.engines).node === ">=24 <26"
      && !("bun" in readRecord(releaseCandidate?.engines))
      && !releaseCandidate?.packageManager
      && isArchctxReleaseBinPath(readRecord(releaseCandidate?.bin).archctx),
    publishedLicenseApache: releaseCandidates.length >= 1 && releaseCandidate?.license === "Apache-2.0",
    placeholderIsNotRelease: placeholderRegistry?.name !== "archctx" || placeholderRegistry.version !== rootPackage.version,
    installCommandPublic: dryRunReady && releaseCandidates.length >= 1,
    homeUrlCorrect: EXPECTED_HOME_URL === "https://archcontext.repoharness.com"
  };
  const blockers: string[] = [];
  if (!assertions.canonicalNameResolved) blockers.push(`canonical npm package name is unresolved: ${INSTALL_CANDIDATES.join(", ")}`);
  if (!assertions.npmDryRunVerified) blockers.push("npm release dry-run evidence is missing or failed");
  if (!dryRunReady && !assertions.rootManifestPublishable) blockers.push("root package.json is private");
  if (!dryRunReady && !assertions.workspaceReleaseManifestPublishable) blockers.push("no publishable workspace manifest exposes the archctx bin");
  if (!assertions.npmReleasePublished) blockers.push(`npm release ${releasePackageName || "archctx"}@${rootPackage.version} is not published`);
  if (assertions.npmReleasePublished && !assertions.publishedRuntimeNodeOnly) {
    blockers.push(`npm release ${releasePackageName || "archctx"}@${rootPackage.version} is not a Node-only CLI artifact`);
  }
  if (!assertions.npmDryRunLicenseApache) blockers.push("npm release dry-run package license is not Apache-2.0");
  if (assertions.npmReleasePublished && !assertions.publishedLicenseApache) {
    blockers.push(`npm release ${releasePackageName || "archctx"}@${rootPackage.version} license is not Apache-2.0`);
  }
  if (releaseCandidates.length === 0 && placeholderRegistry?.name === "archctx" && placeholderRegistry.version !== rootPackage.version && !dryRunReady) {
    blockers.push(`archctx npm package is placeholder/version ${placeholderRegistry.version}, not release ${rootPackage.version}`);
  }
  if (!assertions.installCommandPublic) blockers.push("public npm install command is not available for rollout");
  const ready = blockers.length === 0;
  return {
    schemaVersion: "archcontext.fg6-release-distribution-readback/v1",
    taskId: "FG6-release-distribution",
    environment: "release-distribution",
    status: ready ? "verified" : "blocked",
    ok: ready,
    generatedAt: input.generatedAt,
    sources: {
      homeUrl: EXPECTED_HOME_URL,
      outputPath: DEFAULT_OUTPUT,
      reportPath: DEFAULT_REPORT,
      registry: "https://registry.npmjs.org/"
    },
    packageNames: {
      candidates: INSTALL_CANDIDATES,
      observedSources: packageNameSources
    },
    local: {
      rootPackage,
      workspacePackages,
      placeholder,
      npmDryRun
    },
    registry: input.registry,
    release: {
      ready,
      packageName: releasePackageName || null,
      installCommand: ready ? `npm install -g ${releaseCandidates[0]?.name}` : null,
      postPublishInstallCommand: npmDryRun?.postPublishInstallCommand ?? null,
      version: rootPackage.version,
      blockers
    },
    assertions
  };
}

export function inspectReleaseDistributionReadback(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const sources = readRecord(record.sources);
  const release = readRecord(record.release);
  const assertions = readRecord(record.assertions);
  if (record.schemaVersion !== "archcontext.fg6-release-distribution-readback/v1") failures.push("schemaVersion mismatch");
  if (record.taskId !== "FG6-release-distribution") failures.push("taskId mismatch");
  if (record.environment !== "release-distribution") failures.push("environment mismatch");
  if (sources.homeUrl !== EXPECTED_HOME_URL) failures.push("homeUrl must be archcontext.repoharness.com");
  if (record.status === "verified" && record.ok !== true) failures.push("verified status must have ok true");
  if (record.status === "blocked" && record.ok !== false) failures.push("blocked status must have ok false");
  if (!["verified", "blocked"].includes(String(record.status))) failures.push("status must be verified or blocked");
  if (release.ready === true && record.status !== "verified") failures.push("ready release must be verified");
  if (release.ready !== true && record.status !== "blocked") failures.push("not-ready release must be blocked");
  if (release.ready !== true && readArray(release.blockers).length === 0) failures.push("blocked release must list blockers");
  if (assertions.homeUrlCorrect !== true) failures.push("homeUrl assertion must be true");
  return { ok: failures.length === 0, failures };
}

function queryNpmPackage(name: string) {
  const result = spawnSync("npm", [
    "view",
    name,
    "version",
    "homepage",
    "license",
    "engines",
    "packageManager",
    "bin",
    "--json"
  ], {
    encoding: "utf8",
    shell: false
  });
  if (result.status === 0) {
    const metadata = readRecord(JSON.parse(result.stdout || "null"));
    return {
      name,
      status: "published",
      version: typeof metadata.version === "string" ? metadata.version : "",
      homepage: typeof metadata.homepage === "string" ? metadata.homepage : null,
      license: typeof metadata.license === "string" ? metadata.license : null,
      engines: readRecord(metadata.engines),
      packageManager: typeof metadata.packageManager === "string" ? metadata.packageManager : null,
      bin: readRecord(metadata.bin),
      errorCode: undefined
    };
  }
  const text = `${result.stdout}\n${result.stderr}`;
  const errorCode = text.includes("E404") ? "E404" : `exit_${result.status ?? 1}`;
  return { name, status: "missing", version: null, errorCode };
}

function summarizePackage(path: string, manifest: Record<string, unknown>) {
  const bin = readRecord(manifest.bin);
  return {
    path,
    name: typeof manifest.name === "string" ? manifest.name : "",
    version: typeof manifest.version === "string" ? manifest.version : "",
    private: manifest.private === true,
    binNames: Object.keys(bin),
    publishConfigRegistry: typeof readRecord(manifest.publishConfig).registry === "string"
      ? String(readRecord(manifest.publishConfig).registry)
      : null
  };
}

function isArchctxReleaseBinPath(value: unknown): boolean {
  return value === "./bin/archctx.mjs" || value === "bin/archctx.mjs";
}

function summarizeDryRun(recording?: Record<string, unknown>) {
  if (!recording) return null;
  const pkg = readRecord(recording.package);
  const artifact = readRecord(recording.artifact);
  const rollout = readRecord(recording.rollout);
  return {
    path: DEFAULT_DRY_RUN,
    ok: recording.ok === true && recording.status === "verified",
    packageName: String(pkg.name ?? ""),
    version: String(pkg.version ?? ""),
    homepage: String(pkg.homepage ?? ""),
    license: String(pkg.license ?? ""),
    tarball: String(artifact.tarball ?? ""),
    publishDryRunId: String(artifact.publishDryRunId ?? ""),
    postPublishInstallCommand: String(rollout.postPublishInstallCommand ?? "")
  };
}

function renderHuman(recording: ReturnType<typeof buildReleaseDistributionReadback>) {
  return recording.release.ready
    ? `FG6 release distribution verified: ${recording.release.installCommand}`
    : `FG6 release distribution blocked:\n- ${recording.release.blockers.join("\n- ")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }) {
  return result.ok ? "FG6 release distribution readback is structurally valid" : `FG6 release distribution readback invalid:\n- ${result.failures.join("\n- ")}`;
}

function renderReport(recording: ReturnType<typeof buildReleaseDistributionReadback>) {
  return `# FG6 Release Distribution Readback

- Task: FG6 release distribution precondition
- Environment: release-distribution
- Home URL: ${EXPECTED_HOME_URL}
- Generated At: ${recording.generatedAt}
- Status: ${recording.status}

## Decision

${recording.release.ready ? `PASS: public install command is \`${recording.release.installCommand}\`.` : `BLOCKED: public npm release distribution is not ready.

${recording.release.blockers.map((blocker) => `- ${blocker}`).join("\n")}`}

## Registry

${recording.registry.map((entry) => `- \`${entry.name}\`: ${entry.status}${entry.version ? ` ${entry.version}` : ""}${entry.errorCode ? ` (${entry.errorCode})` : ""}`).join("\n")}

## Local Manifests

- Root package: \`${recording.local.rootPackage.name}\` ${recording.local.rootPackage.version}, private=${recording.local.rootPackage.private}
- Publishable manifests exposing \`archctx\`: ${[recording.local.rootPackage, ...recording.local.workspacePackages].filter((entry) => entry.private === false && entry.binNames.includes("archctx")).length}
- Placeholder package: ${recording.local.placeholder ? `\`${recording.local.placeholder.name}\` ${recording.local.placeholder.version}` : "missing"}
- Dry-run package: ${recording.local.npmDryRun ? `\`${recording.local.npmDryRun.packageName}\` ${recording.local.npmDryRun.version}, ok=${recording.local.npmDryRun.ok}` : "missing"}

## Rollout Implication

FG6-18 design-partner and opt-in beta rollout must remain deferred until this readback passes on a real public release artifact. Staging Cloudflare deploy and local tarball smoke are not a substitute for npm release distribution. When the dry-run package is verified but registry publication is still missing, the next action is npm publication, not design-partner rollout.
`;
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function readOptionalJsonFile(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return await readJsonFile(path);
  } catch {
    return undefined;
  }
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

function unique(values: string[]) {
  return [...new Set(values)];
}
