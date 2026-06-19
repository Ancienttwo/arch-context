#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { digestFile } from "./privacy-capture-lib.mjs";

const DEFAULT_MANIFEST = "docs/security/scans/manifest.json";
const EXTERNAL_ENVIRONMENTS = ["staging", "production"];

if (import.meta.main) {
  const [command = "readback", ...args] = process.argv.slice(2);
  if (command === "record") {
    await record(args);
  } else if (command === "readback") {
    await readback(args);
  } else {
    console.error("[security-scan-manifest] usage: record|readback");
    process.exit(2);
  }
}

export async function recordSecurityScan({
  artifactPath,
  environment,
  critical,
  high,
  manifestPath = DEFAULT_MANIFEST,
  id,
  auditedAt,
  scanner,
  scope,
  root = process.cwd()
}) {
  if (!artifactPath || !environment) {
    throw new Error("record requires --artifact and --environment");
  }
  if (!["deterministic", ...EXTERNAL_ENVIRONMENTS].includes(environment)) {
    throw new Error("environment must be deterministic, staging, or production");
  }
  const criticalCount = parseCount(critical, "critical");
  const highCount = parseCount(high, "high");
  const absoluteArtifactPath = resolve(root, artifactPath);
  const artifactDigest = await digestFile(absoluteArtifactPath);
  const manifest = await readManifest(root, manifestPath);
  const normalizedArtifactPath = normalizeRepoPath(root, artifactPath);
  const entry = {
    id: id ?? `${environment}.${normalizedArtifactPath.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`,
    environment,
    status: "verified",
    artifactPath: normalizedArtifactPath,
    artifactDigest,
    auditedAt: auditedAt ?? new Date().toISOString(),
    scanner: scanner ?? "security-scan",
    scope,
    critical: criticalCount,
    high: highCount
  };
  const next = {
    ...manifest,
    scans: [...(manifest.scans ?? []).filter((item) => item.id !== entry.id), entry].sort((a, b) => a.id.localeCompare(b.id))
  };
  await writeManifest(root, manifestPath, next);
  return entry;
}

export async function readbackSecurityScanManifest({
  manifestPath = DEFAULT_MANIFEST,
  root = process.cwd(),
  requireExternal = false,
  requireEnvironment = ""
} = {}) {
  const failures = [];
  if (requireEnvironment && !EXTERNAL_ENVIRONMENTS.includes(requireEnvironment)) {
    failures.push(`unsupported required environment: ${requireEnvironment}`);
  }
  const manifest = await readManifest(root, manifestPath);
  const verifiedEntries = [];
  let verified = 0;
  let pending = 0;
  for (const entry of manifest.scans ?? []) {
    if (entry.status === "pending") {
      pending += 1;
      continue;
    }
    if (entry.status !== "verified") {
      failures.push(`${entry.id}: unsupported status ${entry.status}`);
      continue;
    }
    let artifactDigest = "";
    if (entry.artifactPath) {
      try {
        artifactDigest = await digestFile(resolve(root, entry.artifactPath));
      } catch {
        failures.push(`${entry.id}: artifact missing or unreadable`);
      }
    }
    if (!entry.artifactPath) failures.push(`${entry.id}: missing artifactPath`);
    if (!entry.artifactDigest) failures.push(`${entry.id}: missing artifactDigest`);
    if (entry.artifactDigest && artifactDigest !== entry.artifactDigest) failures.push(`${entry.id}: digest mismatch ${artifactDigest} != ${entry.artifactDigest}`);
    if (!Number.isInteger(entry.critical) || entry.critical < 0) failures.push(`${entry.id}: critical must be a non-negative integer`);
    if (!Number.isInteger(entry.high) || entry.high < 0) failures.push(`${entry.id}: high must be a non-negative integer`);
    if (entry.critical > 0) failures.push(`${entry.id}: critical findings ${entry.critical} > 0`);
    if (entry.high > 0) failures.push(`${entry.id}: high findings ${entry.high} > 0`);
    verified += 1;
    verifiedEntries.push(entry);
  }
  const externalVerified = verifiedEntries.filter((entry) => EXTERNAL_ENVIRONMENTS.includes(entry.environment)).length;
  if (requireExternal && externalVerified === 0) {
    failures.push("missing verified staging or production security scan");
  }
  if (requireEnvironment && !verifiedEntries.some((entry) => entry.environment === requireEnvironment)) {
    failures.push(`missing verified ${requireEnvironment} security scan`);
  }
  return { ok: failures.length === 0, verified, pending, externalVerified, failures };
}

async function record(args) {
  try {
    const entry = await recordSecurityScan({
      artifactPath: readFlag(args, "--artifact"),
      environment: readFlag(args, "--environment"),
      critical: readFlag(args, "--critical"),
      high: readFlag(args, "--high"),
      manifestPath: readFlag(args, "--manifest") ?? DEFAULT_MANIFEST,
      id: readFlag(args, "--id"),
      auditedAt: readFlag(args, "--audited-at"),
      scanner: readFlag(args, "--scanner"),
      scope: readFlag(args, "--scope")
    });
    console.log(`[security-scan-manifest] recorded ${entry.id} ${entry.artifactDigest}`);
  } catch (error) {
    console.error(`[security-scan-manifest] ${error.message}`);
    process.exit(1);
  }
}

async function readback(args) {
  const requireEnvironment = readFlag(args, "--require-environment");
  const result = await readbackSecurityScanManifest({
    manifestPath: readFlag(args, "--manifest") ?? DEFAULT_MANIFEST,
    requireExternal: args.includes("--require-external"),
    requireEnvironment
  });
  if (!result.ok) {
    console.error("[security-scan-manifest] FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  const externalText = args.includes("--require-external") || requireEnvironment ? ` externalVerified=${result.externalVerified}` : "";
  console.log(`[security-scan-manifest] OK verified=${result.verified} pending=${result.pending}${externalText}`);
}

async function readManifest(root, path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

async function writeManifest(root, path, manifest) {
  const absolutePath = resolve(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function readFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function normalizeRepoPath(root, path) {
  return relative(root, resolve(root, path)).split("\\").join("/");
}

function parseCount(value, label) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) throw new Error(`${label} must be a non-negative integer`);
  return count;
}
