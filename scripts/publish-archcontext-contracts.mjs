#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withNpmPublishCredentials } from "./npm-publish-credentials-lib.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const packageRoot = join(root, "packages/contracts");
const packageManifestPath = join(packageRoot, "package.json");
const DEFAULT_ENV_FILE = "_ops/env/archctx.npm.env";
const registry = readFlag("--registry") ?? "https://registry.npmjs.org/";
const sourcePackageName = "@archcontext/contracts";
const publishPackageName = readFlag("--package-name") ?? process.env.ARCHCONTEXT_CONTRACTS_NPM_NAME ?? "archctx-contracts";
const envFileFlag = readFlag("--npm-env-file") ?? readFlag("--env-file") ?? process.env.ARCHCTX_CONTRACTS_NPM_ENV_FILE ?? process.env.ARCHCTX_NPM_ENV_FILE ?? DEFAULT_ENV_FILE;
const otp = readFlag("--otp") ?? process.env.NPM_CONFIG_OTP;
const json = process.argv.includes("--json");
const allowBlocked = process.argv.includes("--allow-blocked");
const confirmPublish = process.argv.includes("--confirm-publish");
const keepTemp = process.argv.includes("--keep-temp");
const command = readCommand();

if (!["preflight", "publish"].includes(command)) {
  console.error("usage: node scripts/publish-archcontext-contracts.mjs [preflight|publish] [--confirm-publish] [--json] [--allow-blocked] [--registry <url>] [--package-name <name>] [--npm-env-file <path>] [--otp <code>]");
  process.exit(2);
}
if (command === "publish" && !confirmPublish) {
  console.error("publish requires --confirm-publish");
  process.exit(2);
}

const result = await runWithNpmEnv(command === "publish" ? publishContracts : preflightContracts);
process.stdout.write(`${json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
if (!result.ok && !allowBlocked) process.exit(1);

async function runWithNpmEnv(handler) {
  const needsCacheDir = !process.env.NPM_CONFIG_CACHE;
  const cacheDir = needsCacheDir ? mkdtempSync(join(tmpdir(), "archctx-contracts-npm-cache.")) : null;
  const resolvedEnvFile = resolve(root, envFileFlag);
  const envFilePath = existsSync(resolvedEnvFile) ? resolvedEnvFile : null;
  try {
    return await withNpmPublishCredentials(envFilePath, (env) => handler(cacheDir ? { ...env, NPM_CONFIG_CACHE: cacheDir } : env), { registry });
  } finally {
    if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
  }
}

function preflightContracts(env) {
  const context = buildContext(env);
  const blockers = collectPreflightBlockers(context, false);
  return {
    schemaVersion: "archcontext.contracts-publish-readiness/v1",
    mode: "preflight",
    ok: blockers.length === 0,
    status: blockers.length === 0 ? "ready" : "blocked",
    package: context.package,
    registry,
    checks: context.checks,
    blockers,
    nextCommand: blockers.length === 0
      ? `node scripts/publish-archcontext-contracts.mjs publish --confirm-publish --registry ${registry}${publishPackageName === "archctx-contracts" ? "" : ` --package-name ${publishPackageName}`}`
      : "fix npm scope authorization, then rerun preflight"
  };
}

function publishContracts(env) {
  const before = buildContext(env);
  let blockers = collectPreflightBlockers(before, true);
  const publishedBefore = before.checks.registryReadback.published === true;
  let publish = { skipped: publishedBefore, exitCode: 0, reason: publishedBefore ? "already-published" : "" };
  if (blockers.length === 0 && !publishedBefore) {
    const publishRoot = preparePublishPackage(before.sourceManifest);
    const publishArgs = [
      "publish",
      publishRoot,
      "--access",
      "public",
      "--ignore-scripts",
      "--registry",
      registry
    ];
    if (otp) publishArgs.push("--otp", otp);
    const publishResult = run("npm", publishArgs, { env });
    cleanupPublishPackage(publishRoot);
    publish = {
      skipped: false,
      exitCode: publishResult.status,
      reason: publishResult.status === 0 ? "published" : summarizeFailure(publishResult)
    };
    if (publishResult.status !== 0) blockers.push(`npm publish failed: ${publish.reason}`);
  }

  const after = buildContext(env);
  if (after.checks.registryReadback.published !== true) {
    blockers.push(`registry does not expose ${before.package.name}@${before.package.version}`);
  }
  const smoke = after.checks.registryReadback.published === true
    ? runCleanRoomSmoke(before.package.name, before.package.version, env)
    : { ok: false, skipped: true, reason: "package-not-published" };
  if (!smoke.ok) blockers.push(`clean-room import smoke failed: ${smoke.reason}`);

  return {
    schemaVersion: "archcontext.contracts-publish-readiness/v1",
    mode: "publish",
    ok: blockers.length === 0,
    status: blockers.length === 0 ? "published" : "blocked",
    package: before.package,
    registry,
    checks: after.checks,
    publish,
    smoke,
    blockers
  };
}

function buildContext(env) {
  const manifest = JSON.parse(readFileSync(packageManifestPath, "utf8"));
  const expected = {
    sourceName: sourcePackageName,
    publishName: publishPackageName,
    version: manifest.version,
    license: "Apache-2.0",
    sourceFiles: ["src", "fixtures"],
    publishFiles: ["src", "fixtures", "schemas"],
    exportRoot: "./src/index.ts",
    schemaExportRoot: "./schemas/*"
  };
  const pack = npmPackDryRun(manifest, env);
  const whoami = run("npm", ["whoami", "--registry", registry], { env });
  const npmIdentity = {
    ok: whoami.status === 0,
    account: whoami.status === 0 ? whoami.stdout.trim() : null,
    exitCode: whoami.status,
    error: whoami.status === 0 ? null : summarizeFailure(whoami)
  };
  const scopeAccess = checkScopeAccess(expected.publishName, npmIdentity.account, env);
  const registryReadback = readRegistryPackage(expected.publishName, expected.version, env);
  return {
    sourceManifest: manifest,
    package: {
      name: expected.publishName,
      sourceName: manifest.name,
      version: manifest.version,
      private: manifest.private,
      publishConfigAccess: manifest.publishConfig?.access ?? null,
      license: manifest.license ?? null,
      sourceFiles: manifest.files ?? [],
      publishFiles: expected.publishFiles,
      exportRoot: manifest.exports?.["."] ?? null,
      schemaExportRoot: expected.schemaExportRoot
    },
    expected,
    checks: {
      manifest: {
        ok: manifest.name === expected.sourceName
          && manifest.private === false
          && manifest.license === expected.license
          && manifest.publishConfig?.access === "public"
          && JSON.stringify(manifest.files ?? []) === JSON.stringify(expected.sourceFiles)
          && manifest.exports?.["."] === expected.exportRoot
      },
      pack,
      npmIdentity,
      scopeAccess,
      registryReadback
    }
  };
}

function collectPreflightBlockers(context, publishing) {
  const blockers = [];
  if (!context.checks.manifest.ok) blockers.push("contracts package manifest is not publishable");
  if (!context.checks.pack.ok) blockers.push(`npm pack dry-run failed: ${context.checks.pack.reason}`);
  if (!context.checks.npmIdentity.ok) blockers.push(`npm identity unavailable: ${context.checks.npmIdentity.error}`);
  if (context.checks.scopeAccess.ok !== true && context.checks.registryReadback.published !== true) {
    blockers.push(`npm scope for ${context.expected.publishName} is not accessible: ${context.checks.scopeAccess.error}`);
  }
  if (context.checks.registryReadback.published !== true && context.checks.registryReadback.notFound !== true) {
    blockers.push(`registry readback failed for ${context.package.name}@${context.package.version}: ${context.checks.registryReadback.error}`);
  }
  if (context.checks.registryReadback.published === true && context.checks.registryReadback.license !== context.expected.license) {
    blockers.push(`registry license is ${context.checks.registryReadback.license ?? "missing"}, expected ${context.expected.license}`);
  }
  return blockers;
}

function npmPackDryRun(manifest, env) {
  const publishRoot = preparePublishPackage(manifest);
  const result = run("npm", ["pack", publishRoot, "--dry-run", "--json"], { env });
  cleanupPublishPackage(publishRoot);
  if (result.status !== 0) {
    return { ok: false, exitCode: result.status, fileCount: 0, reason: summarizeFailure(result) };
  }
  try {
    const [entry] = JSON.parse(result.stdout);
    const files = entry.files.map((file) => file.path);
    const hasSource = files.some((file) => file.startsWith("src/"));
    const hasFixtures = files.some((file) => file.startsWith("fixtures/valid/"));
    const hasSchemas = files.some((file) => file.startsWith("schemas/"));
    const hasArchitectureNodeSchema = files.includes("schemas/repo/architecture-node.schema.json");
    const hasProjectionTargetSchema = files.includes("schemas/runtime/projection-target.schema.json");
    const hasTests = files.some((file) => file.startsWith("test/"));
    const ok = hasSource && hasFixtures && hasSchemas && hasArchitectureNodeSchema && hasProjectionTargetSchema && !hasTests;
    return {
      ok,
      exitCode: 0,
      packageName: entry.name,
      fileCount: files.length,
      shasum: entry.shasum,
      integrity: entry.integrity,
      reason: ok ? null : "pack must include src, fixtures, schemas and exclude tests"
    };
  } catch (error) {
    return { ok: false, exitCode: 0, fileCount: 0, reason: error instanceof Error ? error.message : String(error) };
  }
}

function readRegistryPackage(name, version, env) {
  const result = run("npm", [
    "view",
    `${name}@${version}`,
    "name",
    "version",
    "license",
    "dist.tarball",
    "dist.shasum",
    "dist.integrity",
    "--json",
    "--registry",
    registry
  ], { env });
  if (result.status !== 0) {
    const error = summarizeFailure(result);
    return { published: false, notFound: /E404/.test(error), exitCode: result.status, error };
  }
  const metadata = JSON.parse(result.stdout || "{}");
  return {
    published: metadata.name === name && metadata.version === version,
    notFound: false,
    exitCode: 0,
    license: metadata.license ?? null,
    tarball: metadata.dist?.tarball ?? metadata["dist.tarball"] ?? null,
    shasum: metadata.dist?.shasum ?? metadata["dist.shasum"] ?? null,
    integrity: metadata.dist?.integrity ?? metadata["dist.integrity"] ?? null,
    error: null
  };
}

function preparePublishPackage(manifest) {
  const workspace = mkdtempSync(join(tmpdir(), "archctx-contracts-publish."));
  cpSync(join(packageRoot, "src"), join(workspace, "src"), { recursive: true });
  cpSync(join(packageRoot, "fixtures"), join(workspace, "fixtures"), { recursive: true });
  cpSync(join(root, "schemas"), join(workspace, "schemas"), { recursive: true });
  writeFileSync(join(workspace, "package.json"), `${JSON.stringify({
    name: publishPackageName,
    version: manifest.version,
    private: false,
    type: manifest.type,
    license: manifest.license,
    files: ["src", "fixtures", "schemas"],
    publishConfig: manifest.publishConfig,
    exports: {
      ".": "./src/index.ts",
      "./schemas/*": "./schemas/*"
    }
  }, null, 2)}\n`, "utf8");
  return workspace;
}

function cleanupPublishPackage(workspace) {
  if (!keepTemp) rmSync(workspace, { recursive: true, force: true });
}

function checkScopeAccess(name, account, env) {
  const scope = packageScope(name);
  if (!scope) return { ok: true, exitCode: 0, reason: "unscoped", error: null };
  if (account && scope === account) return { ok: true, exitCode: 0, reason: "personal-scope", error: null };
  const result = run("npm", ["access", "list", "packages", `@${scope}`, "--json", "--registry", registry], { env });
  return {
    ok: result.status === 0,
    exitCode: result.status,
    reason: result.status === 0 ? "org-scope" : null,
    error: result.status === 0 ? null : summarizeFailure(result)
  };
}

function packageScope(name) {
  if (!name.startsWith("@")) return null;
  const slash = name.indexOf("/");
  return slash === -1 ? null : name.slice(1, slash);
}

function runCleanRoomSmoke(name, version, env) {
  const workspace = mkdtempSync(join(tmpdir(), "archctx-contracts-consume."));
  try {
    writeFileSync(join(workspace, "package.json"), "{\"type\":\"module\"}\n", "utf8");
    const add = run("bun", ["add", `${name}@${version}`], { cwd: workspace, env });
    if (add.status !== 0) return { ok: false, skipped: false, reason: summarizeFailure(add), workspace: keepTemp ? workspace : null };
    writeFileSync(join(workspace, "smoke.ts"), [
      "import { readFileSync } from \"node:fs\";",
      "import { createRequire } from \"node:module\";",
      `import { digestJson, productVersionManifest } from "${name}";`,
      "const require = createRequire(import.meta.url);",
      `const architectureNodeSchemaPath = require.resolve("${name}/schemas/repo/architecture-node.schema.json");`,
      `const projectionTargetSchemaPath = require.resolve("${name}/schemas/runtime/projection-target.schema.json");`,
      "const architectureNodeSchema = JSON.parse(readFileSync(architectureNodeSchemaPath, \"utf8\"));",
      "const projectionTargetSchema = JSON.parse(readFileSync(projectionTargetSchemaPath, \"utf8\"));",
      "if (!digestJson({ ok: true }).startsWith(\"sha256:\")) throw new Error(\"bad digest\");",
      `if (productVersionManifest().product.version !== "${version}") throw new Error("bad version");`,
      "if (architectureNodeSchema.properties?.schemaVersion?.const !== \"archcontext.node/v1\") throw new Error(\"bad architecture node schema\");",
      "if (!projectionTargetSchema.properties?.type?.enum?.includes(\"agent-context\")) throw new Error(\"missing agent-context schema target\");",
      "console.log(\"ok\");",
      ""
    ].join("\n"), "utf8");
    const smoke = run("bun", ["smoke.ts"], { cwd: workspace, env });
    return {
      ok: smoke.status === 0,
      skipped: false,
      reason: smoke.status === 0 ? "ok" : summarizeFailure(smoke),
      workspace: keepTemp ? workspace : null
    };
  } finally {
    if (!keepTemp) rmSync(workspace, { recursive: true, force: true });
  }
}

function run(commandName, args, { cwd = root, env = process.env } = {}) {
  const result = spawnSync(commandName, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ? result.error.message : null
  };
}

function summarizeFailure(result) {
  const text = `${result.stderr || result.stdout || result.error || "unknown error"}`.trim();
  const firstLine = text.split("\n").find((line) => line.trim() && !line.startsWith("npm notice")) ?? text;
  return firstLine.slice(0, 240);
}

function renderHuman(result) {
  const lines = [
    `[contracts-publish] ${result.status}`,
    `package: ${result.package.name}@${result.package.version}`,
    `source package: ${result.package.sourceName}`,
    `license: ${result.package.license}`,
    `registry: ${result.registry}`,
    `manifest: ${result.checks.manifest.ok ? "ok" : "failed"}`,
    `pack: ${result.checks.pack.ok ? `ok (${result.checks.pack.fileCount} files)` : result.checks.pack.reason}`,
    `npm identity: ${result.checks.npmIdentity.ok ? result.checks.npmIdentity.account : result.checks.npmIdentity.error}`,
    `scope access: ${result.checks.scopeAccess.ok ? `ok (${result.checks.scopeAccess.reason})` : result.checks.scopeAccess.error}`,
    `registry readback: ${result.checks.registryReadback.published ? "published" : result.checks.registryReadback.notFound ? "not-published" : result.checks.registryReadback.error}`
  ];
  if (result.publish) lines.push(`publish: ${result.publish.skipped ? result.publish.reason : result.publish.reason || `exit ${result.publish.exitCode}`}`);
  if (result.smoke) lines.push(`clean-room smoke: ${result.smoke.ok ? "ok" : result.smoke.reason}`);
  if (result.blockers.length > 0) {
    lines.push("blockers:");
    for (const blocker of result.blockers) lines.push(`- ${blocker}`);
  }
  lines.push(`next: ${result.nextCommand ?? "none"}`);
  return lines.join("\n");
}

function readFlag(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function readCommand() {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--registry" || arg === "--package-name" || arg === "--env-file" || arg === "--npm-env-file" || arg === "--otp") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) continue;
    return arg;
  }
  return "preflight";
}
