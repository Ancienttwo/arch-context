#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readbackGovernanceApproval } from "./governance-approval-check.mjs";
import { auditCaptureFile, digestFile } from "./privacy-capture-lib.mjs";
import { recordCapture } from "./privacy-capture-manifest.mjs";
import { recordSecurityScan } from "./security-scan-manifest.mjs";
import { readbackSprint2ExternalEvidence } from "./sprint2-external-evidence-readback.mjs";

const DEFAULT_APPROVAL_ARTIFACT = "docs/approvals/archctx-sprint-2.md";
const DEFAULT_CAPTURE_MANIFEST = "docs/security/captures/manifest.json";
const DEFAULT_SECURITY_SCAN_MANIFEST = "docs/security/scans/manifest.json";
const DEFAULT_REQUIRED_ADRS = ["ADR-0026", "ADR-0027", "ADR-0028"];
const EXTERNAL_ENVIRONMENTS = ["staging", "production"];

if (import.meta.main) {
  const [command = "record", ...args] = process.argv.slice(2);
  if (command !== "record") {
    console.error("[sprint2-external-evidence-record] usage: record");
    process.exit(2);
  }
  const config = buildSprint2ExternalEvidenceRecordConfig(process.env, args);
  const result = await recordSprint2ExternalEvidence(config);
  const text = config.json ? JSON.stringify(result, null, 2) : renderHuman(result);
  process.stdout.write(`${text}\n`);
  if (!result.ok) process.exit(1);
}

export function buildSprint2ExternalEvidenceRecordConfig(env = process.env, args = []) {
  const environment = readFlag(args, "--environment") ?? env.ARCHCONTEXT_EXTERNAL_ENVIRONMENT ?? "production";
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    environment,
    approvalArtifact: readFlag(args, "--approval-artifact") ?? env.ARCHCONTEXT_SPRINT2_APPROVAL_ARTIFACT ?? DEFAULT_APPROVAL_ARTIFACT,
    captureManifestPath: readFlag(args, "--capture-manifest") ?? env.ARCHCONTEXT_CAPTURE_MANIFEST_PATH ?? DEFAULT_CAPTURE_MANIFEST,
    capturePath: readFlag(args, "--capture") ?? env.ARCHCONTEXT_CAPTURE_PATH ?? `docs/security/captures/${environment}-redacted.har.json`,
    captureId: readFlag(args, "--capture-id") ?? env.ARCHCONTEXT_CAPTURE_ID ?? `${environment}.real-capture`,
    securityScanManifestPath: readFlag(args, "--security-scan-manifest") ?? env.ARCHCONTEXT_SECURITY_SCAN_MANIFEST_PATH ?? DEFAULT_SECURITY_SCAN_MANIFEST,
    scanArtifactPath: readFlag(args, "--scan-artifact") ?? env.ARCHCONTEXT_SECURITY_SCAN_ARTIFACT ?? `docs/security/reviews/${environment}-security-scan.md`,
    scanId: readFlag(args, "--scan-id") ?? env.ARCHCONTEXT_SECURITY_SCAN_ID ?? `${environment}.security-scan`,
    critical: readFlag(args, "--critical") ?? env.ARCHCONTEXT_SECURITY_SCAN_CRITICAL,
    high: readFlag(args, "--high") ?? env.ARCHCONTEXT_SECURITY_SCAN_HIGH,
    scanner: readFlag(args, "--scanner") ?? env.ARCHCONTEXT_SECURITY_SCAN_SCANNER ?? "external-security-scan",
    scope: readFlag(args, "--scope") ?? env.ARCHCONTEXT_SECURITY_SCAN_SCOPE ?? `${environment}-readback`,
    auditedAt: readFlag(args, "--audited-at") ?? env.ARCHCONTEXT_AUDITED_AT,
    json: args.includes("--json")
  };
}

export async function recordSprint2ExternalEvidence(config = {}) {
  const normalized = normalizeConfig(config);
  const preflight = await preflightExternalEvidence(normalized);
  if (!preflight.ok) {
    return {
      schemaVersion: "archcontext.sprint2-external-evidence-record/v1",
      sprint: "archctx-s2",
      ok: false,
      environment: normalized.environment,
      recorded: {},
      rolledBack: false,
      failures: preflight.failures
    };
  }

  const snapshot = await snapshotManifests(normalized);
  try {
    const capture = await recordCapture({
      root: normalized.root,
      capturePath: normalized.capturePath,
      environment: normalized.environment,
      manifestPath: normalized.captureManifestPath,
      id: normalized.captureId,
      auditedAt: normalized.auditedAt
    });
    const securityScan = await recordSecurityScan({
      root: normalized.root,
      artifactPath: normalized.scanArtifactPath,
      environment: normalized.environment,
      manifestPath: normalized.securityScanManifestPath,
      id: normalized.scanId,
      auditedAt: normalized.auditedAt,
      scanner: normalized.scanner,
      scope: normalized.scope,
      critical: normalized.critical,
      high: normalized.high
    });
    const readback = await readbackSprint2ExternalEvidence({
      root: normalized.root,
      approvalArtifact: normalized.approvalArtifact,
      captureManifestPath: normalized.captureManifestPath,
      securityScanManifestPath: normalized.securityScanManifestPath,
      externalEnvironment: normalized.environment
    });
    if (readback.status !== "ready") {
      throw new Error(`strict readback blocked: ${readback.blockers.join("; ")}`);
    }
    return {
      schemaVersion: "archcontext.sprint2-external-evidence-record/v1",
      sprint: "archctx-s2",
      ok: true,
      environment: normalized.environment,
      recorded: { capture, securityScan },
      rolledBack: false,
      failures: [],
      readback
    };
  } catch (error) {
    const rollbackFailures = await restoreManifests(normalized, snapshot);
    return {
      schemaVersion: "archcontext.sprint2-external-evidence-record/v1",
      sprint: "archctx-s2",
      ok: false,
      environment: normalized.environment,
      recorded: {},
      rolledBack: rollbackFailures.length === 0,
      failures: [error.message, ...rollbackFailures]
    };
  }
}

async function preflightExternalEvidence(config) {
  const failures = [];
  if (!EXTERNAL_ENVIRONMENTS.includes(config.environment)) {
    failures.push(`environment must be staging or production: ${config.environment}`);
  }

  const governance = await readbackGovernanceApproval({
    root: config.root,
    artifactPath: config.approvalArtifact,
    sprint: "archctx-s2",
    requiredAdrs: DEFAULT_REQUIRED_ADRS
  });
  if (!governance.ok) failures.push(...governance.failures);

  try {
    const audit = await auditCaptureFile(resolve(config.root, config.capturePath));
    if (!audit.ok) failures.push(`${config.capturePath}: packet capture audit failed`);
  } catch (error) {
    failures.push(`${config.capturePath}: ${error.message}`);
  }

  try {
    await digestFile(resolve(config.root, config.scanArtifactPath));
  } catch (error) {
    failures.push(`${config.scanArtifactPath}: ${error.message}`);
  }

  const critical = parseNonNegativeInteger(config.critical, "critical", failures);
  const high = parseNonNegativeInteger(config.high, "high", failures);
  if (critical > 0) failures.push(`critical findings ${critical} > 0`);
  if (high > 0) failures.push(`high findings ${high} > 0`);

  return { ok: failures.length === 0, failures };
}

function normalizeConfig(config) {
  const environment = config.environment ?? "production";
  return {
    root: config.root ?? process.cwd(),
    environment,
    approvalArtifact: config.approvalArtifact ?? DEFAULT_APPROVAL_ARTIFACT,
    captureManifestPath: config.captureManifestPath ?? DEFAULT_CAPTURE_MANIFEST,
    capturePath: config.capturePath ?? `docs/security/captures/${environment}-redacted.har.json`,
    captureId: config.captureId ?? `${environment}.real-capture`,
    securityScanManifestPath: config.securityScanManifestPath ?? DEFAULT_SECURITY_SCAN_MANIFEST,
    scanArtifactPath: config.scanArtifactPath ?? `docs/security/reviews/${environment}-security-scan.md`,
    scanId: config.scanId ?? `${environment}.security-scan`,
    critical: config.critical,
    high: config.high,
    scanner: config.scanner ?? "external-security-scan",
    scope: config.scope ?? `${environment}-readback`,
    auditedAt: config.auditedAt
  };
}

async function snapshotManifests(config) {
  return {
    capture: await readFile(resolve(config.root, config.captureManifestPath), "utf8"),
    securityScan: await readFile(resolve(config.root, config.securityScanManifestPath), "utf8")
  };
}

async function restoreManifests(config, snapshot) {
  const failures = [];
  await restoreManifest(resolve(config.root, config.captureManifestPath), snapshot.capture, failures);
  await restoreManifest(resolve(config.root, config.securityScanManifestPath), snapshot.securityScan, failures);
  return failures;
}

async function restoreManifest(path, content, failures) {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  } catch (error) {
    failures.push(`rollback failed for ${path}: ${error.message}`);
  }
}

function parseNonNegativeInteger(value, label, failures) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    failures.push(`${label} must be a non-negative integer`);
    return Number.NaN;
  }
  return parsed;
}

function renderHuman(result) {
  const lines = [`[sprint2-external-evidence-record] ${result.ok ? "OK" : "FAILED"} environment=${result.environment}`];
  if (result.recorded?.capture) lines.push(`- capture: ${result.recorded.capture.id} ${result.recorded.capture.captureDigest}`);
  if (result.recorded?.securityScan) lines.push(`- securityScan: ${result.recorded.securityScan.id} ${result.recorded.securityScan.artifactDigest}`);
  if (result.readback) lines.push(`- readback: ${result.readback.status}`);
  if (result.rolledBack) lines.push("- rolledBack: true");
  for (const failure of result.failures ?? []) lines.push(`- failure: ${failure}`);
  return lines.join("\n");
}

function readFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
