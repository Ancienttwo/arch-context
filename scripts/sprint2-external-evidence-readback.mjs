#!/usr/bin/env node
import { readbackManifest } from "./privacy-capture-manifest.mjs";
import { readbackSecurityScanManifest } from "./security-scan-manifest.mjs";

const DEFAULT_CAPTURE_MANIFEST = "docs/security/captures/manifest.json";
const DEFAULT_SECURITY_SCAN_MANIFEST = "docs/security/scans/manifest.json";

if (import.meta.main) {
  const [command = "readback", ...args] = process.argv.slice(2);
  if (command !== "readback") {
    console.error("[sprint2-external-evidence-readback] usage: readback");
    process.exit(2);
  }
  const config = buildSprint2ExternalEvidenceConfig(process.env, args);
  const result = await readbackSprint2ExternalEvidence(config);
  const text = config.json ? JSON.stringify(result, null, 2) : renderHuman(result);
  process.stdout.write(`${text}\n`);
  if (result.status === "blocked") process.exit(1);
}

export function buildSprint2ExternalEvidenceConfig(env = process.env, args = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    captureManifestPath: readFlag(args, "--capture-manifest") ?? env.ARCHCONTEXT_CAPTURE_MANIFEST_PATH ?? DEFAULT_CAPTURE_MANIFEST,
    securityScanManifestPath: readFlag(args, "--security-scan-manifest") ?? env.ARCHCONTEXT_SECURITY_SCAN_MANIFEST_PATH ?? DEFAULT_SECURITY_SCAN_MANIFEST,
    externalEnvironment: readFlag(args, "--require-environment") ?? "",
    json: args.includes("--json")
  };
}

export async function readbackSprint2ExternalEvidence(config = {}) {
  const normalized = {
    root: config.root ?? process.cwd(),
    captureManifestPath: config.captureManifestPath ?? DEFAULT_CAPTURE_MANIFEST,
    securityScanManifestPath: config.securityScanManifestPath ?? DEFAULT_SECURITY_SCAN_MANIFEST,
    externalEnvironment: config.externalEnvironment ?? ""
  };
  const [capture, securityScan] = await Promise.all([
    readCapture(normalized),
    readSecurityScan(normalized)
  ]);
  const gates = [
    gate({
      id: "MR-EG5/TR-EG4/HL-EG1",
      name: "External packet capture proves metadata-only SaaS traffic",
      evidence: normalized.captureManifestPath,
      readback: capture
    }),
    gate({
      id: "HL-EG5",
      name: "External security scan has zero Critical/High findings",
      evidence: normalized.securityScanManifestPath,
      readback: securityScan
    })
  ];
  const blockers = gates
    .filter((item) => item.status !== "verified")
    .map((item) => `${item.id}: ${item.failures.join("; ")}`);
  return {
    schemaVersion: "archcontext.sprint2-external-evidence-readback/v1",
    sprint: "archctx-s2",
    status: blockers.length === 0 ? "ready" : "blocked",
    blockers,
    gates,
    acquisitionPlan: acquisitionPlan()
  };
}

async function readCapture(config) {
  try {
    return await readbackManifest({
      root: config.root,
      manifestPath: config.captureManifestPath,
      requireExternal: !config.externalEnvironment,
      requireEnvironment: config.externalEnvironment
    });
  } catch (error) {
    return failedReadback(error);
  }
}

async function readSecurityScan(config) {
  try {
    return await readbackSecurityScanManifest({
      root: config.root,
      manifestPath: config.securityScanManifestPath,
      requireExternal: !config.externalEnvironment,
      requireEnvironment: config.externalEnvironment
    });
  } catch (error) {
    return failedReadback(error);
  }
}

function gate({ id, name, evidence, readback }) {
  return {
    id,
    name,
    status: readback.ok ? "verified" : "blocked",
    evidence,
    failures: readback.failures ?? [],
    verified: readback.verified,
    pending: readback.pending,
    externalVerified: readback.externalVerified
  };
}

function failedReadback(error) {
  return { ok: false, verified: 0, pending: 0, externalVerified: 0, failures: [error.message] };
}

function acquisitionPlan() {
  return [
    {
      gate: "MR-EG5/TR-EG4/HL-EG1",
      command: "node scripts/privacy-capture-manifest.mjs record --environment production --capture docs/security/captures/production-redacted.har.json --id production.real-capture"
    },
    {
      gate: "HL-EG5",
      command: "node scripts/security-scan-manifest.mjs record --environment production --artifact docs/security/reviews/production-security-scan.md --id production.security-scan --critical 0 --high 0 --scanner external-security-scan"
    }
  ];
}

function renderHuman(result) {
  const lines = [`[sprint2-external-evidence-readback] ${result.status} sprint=${result.sprint}`];
  for (const blocker of result.blockers) lines.push(`- blocker: ${blocker}`);
  for (const gate of result.gates) lines.push(`- ${gate.id}: ${gate.status}`);
  return lines.join("\n");
}

function readFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
