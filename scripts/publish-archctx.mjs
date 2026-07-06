#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withNpmPublishCredentials } from "./npm-publish-credentials-lib.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const rootManifestPath = resolve(root, "package.json");
const PACKAGE_NAME = "archctx";
const DEFAULT_ENV_FILE = "_ops/env/archctx.npm.env";
const DEFAULT_ARTIFACT_DIR = "_ops/npm/fg6-release-dry-run";

const registry = readFlag("--registry") ?? "https://registry.npmjs.org/";
const json = process.argv.includes("--json");
const confirmPublish = process.argv.includes("--confirm-publish");
const envFileFlag = readFlag("--npm-env-file") ?? readFlag("--env-file") ?? process.env.ARCHCTX_NPM_ENV_FILE ?? DEFAULT_ENV_FILE;

const result = await main();
process.stdout.write(`${json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
if (!result.ok) process.exit(1);

async function main() {
  const manifest = JSON.parse(readFileSync(rootManifestPath, "utf8"));
  const version = String(manifest.version ?? "");
  const tarballPath = resolve(root, readFlag("--tarball") ?? `${DEFAULT_ARTIFACT_DIR}/${PACKAGE_NAME}-${version}.tgz`);
  const resolvedEnvFile = resolve(root, envFileFlag);
  const envFilePath = existsSync(resolvedEnvFile) ? resolvedEnvFile : null;

  return withNpmPublishCredentials(
    envFilePath,
    (env) => runChecksAndMaybePublish({ version, tarballPath, env }),
    { registry }
  );
}

function runChecksAndMaybePublish({ version, tarballPath, env }) {
  const blockers = [];

  const tarballExists = existsSync(tarballPath);
  if (!tarballExists) blockers.push(`tarball not found: ${displayPath(tarballPath)}`);

  const registryReadback = readRegistryPackage(PACKAGE_NAME, version, env);
  if (registryReadback.published === true) {
    blockers.push(`${PACKAGE_NAME}@${version} is already published; refusing to publish a duplicate version`);
  } else if (registryReadback.notFound !== true) {
    blockers.push(`registry readback failed for ${PACKAGE_NAME}@${version}: ${registryReadback.error}`);
  }

  const whoami = run("npm", ["whoami", "--registry", registry], { env });
  const npmIdentity = {
    ok: whoami.status === 0,
    account: whoami.status === 0 ? whoami.stdout.trim() : null,
    exitCode: whoami.status,
    error: whoami.status === 0 ? null : summarizeFailure(whoami)
  };
  if (!npmIdentity.ok) blockers.push(`npm identity unavailable: ${npmIdentity.error}`);

  let publish = { skipped: true, exitCode: 0, reason: confirmPublish ? "" : "dry-run" };
  if (confirmPublish && blockers.length === 0 && tarballExists) {
    const publishResult = run("npm", [
      "publish",
      tarballPath,
      "--access",
      "public",
      "--registry",
      registry
    ], { env });
    publish = {
      skipped: false,
      exitCode: publishResult.status,
      reason: publishResult.status === 0 ? "published" : summarizeFailure(publishResult)
    };
    if (publishResult.status !== 0) blockers.push(`npm publish failed: ${publish.reason}`);
  }

  return {
    schemaVersion: "archcontext.archctx-publish-readiness/v1",
    mode: confirmPublish ? "publish" : "dry-run",
    ok: blockers.length === 0,
    status: blockers.length === 0 ? (confirmPublish ? "published" : "ready") : "blocked",
    package: { name: PACKAGE_NAME, version },
    registry,
    tarball: displayPath(tarballPath),
    checks: { tarballExists, registryReadback, npmIdentity },
    publish,
    blockers,
    nextCommand: blockers.length === 0 && !confirmPublish
      ? `node scripts/publish-archctx.mjs --confirm-publish --tarball ${displayPath(tarballPath)} --registry ${registry}`
      : blockers.length === 0
        ? "none"
        : "resolve blockers, then rerun"
  };
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
    `[archctx-publish] ${result.status}`,
    `package: ${result.package.name}@${result.package.version}`,
    `registry: ${result.registry}`,
    `tarball: ${result.tarball} (${result.checks.tarballExists ? "found" : "missing"})`,
    `registry readback: ${result.checks.registryReadback.published ? "already published" : result.checks.registryReadback.notFound ? "not-published" : result.checks.registryReadback.error}`,
    `npm identity: ${result.checks.npmIdentity.ok ? result.checks.npmIdentity.account : result.checks.npmIdentity.error}`,
    `publish: ${result.publish.skipped ? result.publish.reason : result.publish.reason || `exit ${result.publish.exitCode}`}`
  ];
  if (result.blockers.length > 0) {
    lines.push("blockers:");
    for (const blocker of result.blockers) lines.push(`- ${blocker}`);
  }
  lines.push(`next: ${result.nextCommand ?? "none"}`);
  return lines.join("\n");
}

function displayPath(path) {
  return path.startsWith(root) ? path.slice(root.length + 1) : path;
}

function readFlag(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}
