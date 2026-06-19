#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { auditCaptureFile, digestFile } from "./privacy-capture-lib.mjs";

const DEFAULT_MANIFEST = "docs/security/captures/manifest.json";
const [command = "readback", ...args] = process.argv.slice(2);

if (command === "record") {
  await record();
} else if (command === "readback") {
  await readback();
} else {
  console.error("[privacy-capture-manifest] usage: record|readback");
  process.exit(2);
}

async function record() {
  const capturePath = readFlag("--capture");
  const environment = readFlag("--environment");
  if (!capturePath || !environment) {
    console.error("[privacy-capture-manifest] record requires --capture and --environment");
    process.exit(2);
  }
  if (!["fixture", "staging", "production"].includes(environment)) {
    console.error("[privacy-capture-manifest] environment must be fixture, staging, or production");
    process.exit(2);
  }
  const manifestPath = readFlag("--manifest") ?? DEFAULT_MANIFEST;
  const absoluteCapturePath = resolve(process.cwd(), capturePath);
  const audit = await auditCaptureFile(absoluteCapturePath);
  if (!audit.ok) {
    console.error("[privacy-capture-manifest] capture audit failed; refusing to record");
    process.exit(1);
  }
  const manifest = await readManifest(manifestPath);
  const artifactPath = normalizeRepoPath(capturePath);
  const captureDigest = await digestFile(absoluteCapturePath);
  const entry = {
    id: readFlag("--id") ?? `${environment}.${artifactPath.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`,
    environment,
    status: "verified",
    artifactPath,
    captureDigest,
    auditedAt: readFlag("--audited-at") ?? new Date().toISOString(),
    entries: audit.entries,
    checkedValues: audit.checkedValues,
    verifier: "scripts/privacy-packet-capture-audit.mjs"
  };
  const next = {
    ...manifest,
    captures: [...manifest.captures.filter((item) => item.id !== entry.id), entry].sort((a, b) => a.id.localeCompare(b.id))
  };
  await writeManifest(manifestPath, next);
  console.log(`[privacy-capture-manifest] recorded ${entry.id} ${entry.captureDigest}`);
}

async function readback() {
  const manifestPath = readFlag("--manifest") ?? DEFAULT_MANIFEST;
  const manifest = await readManifest(manifestPath);
  const failures = [];
  let verified = 0;
  let pending = 0;
  for (const entry of manifest.captures ?? []) {
    if (entry.status === "pending") {
      pending += 1;
      continue;
    }
    const absolutePath = resolve(process.cwd(), entry.artifactPath);
    const audit = await auditCaptureFile(absolutePath);
    const digest = await digestFile(absolutePath);
    if (!audit.ok) failures.push(`${entry.id}: packet capture audit failed`);
    if (digest !== entry.captureDigest) failures.push(`${entry.id}: digest mismatch ${digest} != ${entry.captureDigest}`);
    if (audit.entries !== entry.entries) failures.push(`${entry.id}: entry count mismatch ${audit.entries} != ${entry.entries}`);
    verified += 1;
  }
  if (failures.length > 0) {
    console.error("[privacy-capture-manifest] FAILED");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`[privacy-capture-manifest] OK verified=${verified} pending=${pending}`);
}

async function readManifest(path) {
  return JSON.parse(await readFile(resolve(process.cwd(), path), "utf8"));
}

async function writeManifest(path, manifest) {
  const absolutePath = resolve(process.cwd(), path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function readFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function normalizeRepoPath(path) {
  return relative(process.cwd(), resolve(process.cwd(), path)).split("\\").join("/");
}
