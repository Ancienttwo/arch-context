#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { auditCaptureFile, digestFile } from "./privacy-capture-lib.mjs";

const DEFAULT_MANIFEST = "docs/security/captures/manifest.json";
const EXTERNAL_ENVIRONMENTS = ["staging", "production"];

if (import.meta.main) {
  const [command = "readback", ...args] = process.argv.slice(2);
  if (command === "record") {
    await record(args);
  } else if (command === "readback") {
    await readback(args);
  } else {
    console.error("[privacy-capture-manifest] usage: record|readback");
    process.exit(2);
  }
}

export async function recordCapture({
  capturePath,
  environment,
  manifestPath = DEFAULT_MANIFEST,
  id,
  auditedAt,
  root = process.cwd()
}) {
  if (!capturePath || !environment) {
    throw new Error("record requires --capture and --environment");
  }
  if (!["fixture", ...EXTERNAL_ENVIRONMENTS].includes(environment)) {
    throw new Error("environment must be fixture, staging, or production");
  }
  const absoluteCapturePath = resolve(root, capturePath);
  const audit = await auditCaptureFile(absoluteCapturePath);
  if (!audit.ok) {
    throw new Error("capture audit failed; refusing to record");
  }
  const manifest = await readManifest(root, manifestPath);
  const artifactPath = normalizeRepoPath(root, capturePath);
  const captureDigest = await digestFile(absoluteCapturePath);
  const entry = {
    id: id ?? `${environment}.${artifactPath.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`,
    environment,
    status: "verified",
    artifactPath,
    captureDigest,
    auditedAt: auditedAt ?? new Date().toISOString(),
    entries: audit.entries,
    checkedValues: audit.checkedValues,
    verifier: "scripts/privacy-packet-capture-audit.mjs"
  };
  const next = {
    ...manifest,
    captures: [...manifest.captures.filter((item) => item.id !== entry.id), entry].sort((a, b) => a.id.localeCompare(b.id))
  };
  await writeManifest(root, manifestPath, next);
  return entry;
}

export async function readbackManifest({
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
  for (const entry of manifest.captures ?? []) {
    if (entry.status === "pending") {
      pending += 1;
      continue;
    }
    const absolutePath = resolve(root, entry.artifactPath);
    const audit = await auditCaptureFile(absolutePath);
    const digest = await digestFile(absolutePath);
    if (!audit.ok) failures.push(`${entry.id}: packet capture audit failed`);
    if (digest !== entry.captureDigest) failures.push(`${entry.id}: digest mismatch ${digest} != ${entry.captureDigest}`);
    if (audit.entries !== entry.entries) failures.push(`${entry.id}: entry count mismatch ${audit.entries} != ${entry.entries}`);
    verified += 1;
    verifiedEntries.push(entry);
  }
  const externalVerified = verifiedEntries.filter((entry) => EXTERNAL_ENVIRONMENTS.includes(entry.environment)).length;
  if (requireExternal && externalVerified === 0) {
    failures.push("missing verified staging or production capture");
  }
  if (requireEnvironment && !verifiedEntries.some((entry) => entry.environment === requireEnvironment)) {
    failures.push(`missing verified ${requireEnvironment} capture`);
  }
  return { ok: failures.length === 0, verified, pending, externalVerified, failures };
}

async function record(args) {
  const capturePath = readFlag(args, "--capture");
  const environment = readFlag(args, "--environment");
  if (!capturePath || !environment) {
    console.error("[privacy-capture-manifest] record requires --capture and --environment");
    process.exit(2);
  }
  if (!["fixture", ...EXTERNAL_ENVIRONMENTS].includes(environment)) {
    console.error("[privacy-capture-manifest] environment must be fixture, staging, or production");
    process.exit(2);
  }
  try {
    const entry = await recordCapture({
      capturePath,
      environment,
      manifestPath: readFlag(args, "--manifest") ?? DEFAULT_MANIFEST,
      id: readFlag(args, "--id"),
      auditedAt: readFlag(args, "--audited-at")
    });
    console.log(`[privacy-capture-manifest] recorded ${entry.id} ${entry.captureDigest}`);
  } catch (error) {
    console.error(`[privacy-capture-manifest] ${error.message}`);
    process.exit(1);
  }
}

async function readback(args) {
  const requireEnvironment = readFlag(args, "--require-environment");
  const result = await readbackManifest({
    manifestPath: readFlag(args, "--manifest") ?? DEFAULT_MANIFEST,
    requireExternal: args.includes("--require-external"),
    requireEnvironment
  });
  if (!result.ok) {
    console.error("[privacy-capture-manifest] FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  const externalText = args.includes("--require-external") || requireEnvironment ? ` externalVerified=${result.externalVerified}` : "";
  console.log(`[privacy-capture-manifest] OK verified=${result.verified} pending=${result.pending}${externalText}`);
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
