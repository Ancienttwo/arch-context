#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { digestFile } from "./privacy-capture-lib.mjs";
import { readbackSecurityScanManifest, recordSecurityScan } from "./security-scan-manifest.mjs";

const DEFAULT_REPORT = "docs/security/reviews/fg6-release-security-scan.md";
const DEFAULT_SBOM = "docs/security/scans/fg6-release-sbom.cdx.json";
const DEFAULT_OUTPUT = "docs/verification/fg6-security-release-readback.json";
const DEFAULT_MANIFEST = "docs/security/scans/manifest.json";
const SCAN_ID = "staging.fg6-release-security-scan";
const SECRET_SCAN_EXCLUDED_DIRS = new Set([".git", ".wrangler", "_ops", "node_modules", "artifacts"]);
const SAST_ROOTS = ["actions", "deploy", "packages", "scripts"] as const;
const SECRET_SCAN_ROOTS = [".github", "actions", "deploy", "docs", "evals", "packages", "plans", "schemas", "scripts", "skills", "tasks"] as const;
const TEXT_EXTENSIONS = new Set([".cjs", ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".ts", ".tsx", ".txt", ".yaml", ".yml"]);
const SAST_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const TEST_FIXTURE_SUFFIXES = [".test.ts", ".test.mjs", ".spec.ts", ".spec.mjs"];
const SAST_PATTERNS = [
  { id: "js-eval", severity: "critical", pattern: /\beval\s*\(/ },
  { id: "js-new-function", severity: "critical", pattern: /\bnew\s+Function\s*\(/ },
  { id: "react-dangerous-html", severity: "high", pattern: /\bdangerouslySetInnerHTML\b/ }
] as const;
const SECRET_PATTERNS = [
  { id: "github-token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/ },
  { id: "github-pat", pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { id: "openai-key", pattern: /\bsk-[A-Za-z0-9_-]{32,}\b/ },
  { id: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { id: "pem-private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ }
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildFg6SecurityReleaseConfig(process.env, args);
    const result = await runFg6SecurityRelease(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg6SecurityRelease(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg6-security-release-readback] usage: run|inspect [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg6SecurityReleaseConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    reportPath: readFlag(args, "--report") ?? env.ARCHCONTEXT_FG6_SECURITY_REPORT ?? DEFAULT_REPORT,
    sbomPath: readFlag(args, "--sbom") ?? env.ARCHCONTEXT_FG6_SBOM ?? DEFAULT_SBOM,
    manifestPath: readFlag(args, "--manifest") ?? env.ARCHCONTEXT_SECURITY_SCAN_MANIFEST_PATH ?? DEFAULT_MANIFEST,
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_SECURITY_RELEASE_OUTPUT ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg6SecurityRelease(config: ReturnType<typeof buildFg6SecurityReleaseConfig>) {
  const generatedAt = config.generatedAt();
  const dependencyAudit = runDependencyAudit(config.root);
  const sbom = await generateSbom(config.root, generatedAt);
  await writeJson(config.root, config.sbomPath, sbom.document);
  const sbomDigest = await digestFile(resolve(config.root, config.sbomPath));
  const sast = await runSastScan(config.root);
  const secretScan = await runSecretScan(config.root);
  const critical = dependencyAudit.critical + sast.critical + secretScan.critical;
  const high = dependencyAudit.high + sast.high + secretScan.high;
  const report = renderSecurityReport({
    generatedAt,
    dependencyAudit,
    sbom: { ...sbom.summary, path: config.sbomPath, digest: sbomDigest },
    sast,
    secretScan,
    critical,
    high
  });
  await writeText(config.root, config.reportPath, report);
  const reportDigest = await digestFile(resolve(config.root, config.reportPath));
  const manifestEntry = await recordSecurityScan({
    artifactPath: config.reportPath,
    environment: "staging",
    critical,
    high,
    manifestPath: config.manifestPath,
    id: SCAN_ID,
    auditedAt: generatedAt,
    scanner: "fg6-release-security-bundle",
    scope: "dependency-vulnerability-sbom-sast-secret-scan",
    root: config.root
  });
  const manifestReadback = await readbackSecurityScanManifest({
    manifestPath: config.manifestPath,
    root: config.root,
    requireEnvironment: "staging"
  });
  const recording = {
    schemaVersion: "archcontext.fg6-security-release-readback/v1",
    taskId: "FG6-11",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt,
    sources: {
      packageJson: "package.json",
      lockfile: "bun.lock",
      reportPath: config.reportPath,
      sbomPath: config.sbomPath,
      manifestPath: config.manifestPath
    },
    evidence: {
      dependencyAudit,
      sbom: {
        path: config.sbomPath,
        digest: sbomDigest,
        componentCount: sbom.summary.componentCount,
        workspaceComponentCount: sbom.summary.workspaceComponentCount,
        packageManager: "bun"
      },
      sast,
      secretScan,
      report: {
        path: config.reportPath,
        digest: reportDigest
      },
      manifestEntry,
      manifestReadback,
      assertions: {
        dependencyVulnerabilityScanClean: dependencyAudit.ok === true && dependencyAudit.critical === 0 && dependencyAudit.high === 0,
        sbomGenerated: sbom.summary.componentCount > 0 && sbomDigest.startsWith("sha256:"),
        sastCriticalHighClean: sast.critical === 0 && sast.high === 0,
        secretScanClean: secretScan.critical === 0 && secretScan.high === 0 && secretScan.findingCount === 0,
        securityManifestVerified: manifestReadback.ok === true && manifestEntry.status === "verified",
        noCriticalHighReleaseFindings: critical === 0 && high === 0
      }
    },
    failures: [] as string[]
  };
  const inspection = inspectFg6SecurityRelease(recording);
  recording.status = inspection.ok ? "verified" : "failed";
  recording.ok = inspection.ok;
  recording.failures = inspection.failures;
  await writeJson(config.root, config.outputPath, recording);
  return recording;
}

export function inspectFg6SecurityRelease(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const dependencyAudit = readRecord(evidence.dependencyAudit);
  const sbom = readRecord(evidence.sbom);
  const sast = readRecord(evidence.sast);
  const secretScan = readRecord(evidence.secretScan);
  const report = readRecord(evidence.report);
  const manifestEntry = readRecord(evidence.manifestEntry);
  const manifestReadback = readRecord(evidence.manifestReadback);
  const assertions = readRecord(evidence.assertions);

  if (record.schemaVersion !== "archcontext.fg6-security-release-readback/v1") failures.push("schemaVersion mismatch");
  if (record.taskId !== "FG6-11") failures.push("taskId must be FG6-11");
  if (record.environment !== "staging-release-readback") failures.push("environment must be staging-release-readback");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  if (dependencyAudit.ok !== true) failures.push("dependencyAudit must pass");
  if (dependencyAudit.tool !== "bun audit") failures.push("dependencyAudit tool must be bun audit");
  if (Number(dependencyAudit.exitCode ?? -1) !== 0) failures.push("dependencyAudit exitCode must be 0");
  if (Number(dependencyAudit.critical ?? -1) !== 0) failures.push("dependencyAudit critical must be 0");
  if (Number(dependencyAudit.high ?? -1) !== 0) failures.push("dependencyAudit high must be 0");
  if (Number(dependencyAudit.totalAdvisories ?? -1) !== 0) failures.push("dependencyAudit totalAdvisories must be 0");

  if (Number(sbom.componentCount ?? 0) <= 0) failures.push("sbom componentCount must be positive");
  if (!String(sbom.digest ?? "").startsWith("sha256:")) failures.push("sbom digest must be sha256");
  if (sbom.packageManager !== "bun") failures.push("sbom packageManager must be bun");

  if (Number(sast.scannedFiles ?? 0) <= 0) failures.push("sast scannedFiles must be positive");
  if (Number(sast.critical ?? -1) !== 0) failures.push("sast critical must be 0");
  if (Number(sast.high ?? -1) !== 0) failures.push("sast high must be 0");
  if (Number(sast.findingCount ?? -1) !== 0) failures.push("sast findingCount must be 0");
  if (!Array.isArray(sast.roots) || sast.roots.length < 1) failures.push("sast roots missing");

  if (Number(secretScan.scannedFiles ?? 0) <= 0) failures.push("secretScan scannedFiles must be positive");
  if (Number(secretScan.critical ?? -1) !== 0) failures.push("secretScan critical must be 0");
  if (Number(secretScan.high ?? -1) !== 0) failures.push("secretScan high must be 0");
  if (Number(secretScan.findingCount ?? -1) !== 0) failures.push("secretScan findingCount must be 0");
  if (!Array.isArray(secretScan.excludedDirs) || !secretScan.excludedDirs.includes("_ops")) failures.push("secretScan must exclude _ops");

  if (report.path !== DEFAULT_REPORT) failures.push("report path mismatch");
  if (!String(report.digest ?? "").startsWith("sha256:")) failures.push("report digest must be sha256");
  if (manifestEntry.id !== SCAN_ID) failures.push("manifest entry id mismatch");
  if (manifestEntry.environment !== "staging") failures.push("manifest entry must be staging");
  if (manifestEntry.status !== "verified") failures.push("manifest entry must be verified");
  if (Number(manifestEntry.critical ?? -1) !== 0) failures.push("manifest critical must be 0");
  if (Number(manifestEntry.high ?? -1) !== 0) failures.push("manifest high must be 0");
  if (manifestReadback.ok !== true) failures.push("manifest readback must pass");
  if (Number(manifestReadback.externalVerified ?? 0) < 1) failures.push("manifest externalVerified must be positive");

  for (const key of [
    "dependencyVulnerabilityScanClean",
    "sbomGenerated",
    "sastCriticalHighClean",
    "secretScanClean",
    "securityManifestVerified",
    "noCriticalHighReleaseFindings"
  ]) {
    if (assertions[key] !== true) failures.push(`assertion ${key} must be true`);
  }
  return { ok: failures.length === 0, failures };
}

function runDependencyAudit(root: string) {
  const child = spawnSync("bun", ["audit", "--json"], {
    cwd: root,
    encoding: "utf8",
    shell: false
  });
  const stdout = stripAnsi(child.stdout ?? "");
  const stderr = stripAnsi(child.stderr ?? "");
  const parsed = parseLastJsonObject(stdout);
  const advisories = collectAdvisories(parsed);
  return {
    tool: "bun audit",
    exitCode: child.status ?? 1,
    ok: (child.status ?? 1) === 0,
    stdoutDigest: digestText(stdout),
    stderrDigest: stderr ? digestText(stderr) : null,
    totalAdvisories: advisories.length,
    critical: advisories.filter((item) => item.severity === "critical").length,
    high: advisories.filter((item) => item.severity === "high").length,
    moderate: advisories.filter((item) => item.severity === "moderate").length,
    low: advisories.filter((item) => item.severity === "low").length
  };
}

async function generateSbom(root: string, generatedAt: string) {
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as Record<string, unknown>;
  const listed = spawnSync("bun", ["pm", "ls", "--all"], {
    cwd: root,
    encoding: "utf8",
    shell: false
  });
  const components = parseBunPmList(stripAnsi(listed.stdout ?? ""));
  const workspaces = readStringArray(packageJson.workspaces);
  const document = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:archcontext-fg6-${generatedAt.replace(/[^0-9A-Za-z]+/g, "-")}`,
    version: 1,
    metadata: {
      timestamp: generatedAt,
      tools: [{ vendor: "Bun", name: "bun pm ls", version: "1.3.10" }],
      component: {
        type: "application",
        name: String(packageJson.name ?? "arch-context"),
        version: String(packageJson.version ?? "0.0.0")
      }
    },
    components
  };
  return {
    document,
    summary: {
      componentCount: components.length,
      workspaceComponentCount: workspaces.length,
      dependencyComponentCount: components.filter((component) => component.scope !== "workspace").length
    }
  };
}

async function runSastScan(root: string) {
  const files = (await collectFiles(root, [...SAST_ROOTS], SAST_EXTENSIONS)).filter((file) => {
    return !file.endsWith("fg6-security-release-readback.ts") && !isTestFixture(file);
  });
  const findings: Array<{ file: string; id: string; severity: string }> = [];
  for (const file of files) {
    const text = await readFile(resolve(root, file), "utf8");
    for (const rule of SAST_PATTERNS) {
      if (rule.pattern.test(text)) findings.push({ file, id: rule.id, severity: rule.severity });
    }
  }
  return scanSummary(files, findings, SAST_ROOTS);
}

async function runSecretScan(root: string) {
  const files = (await collectFiles(root, [...SECRET_SCAN_ROOTS], TEXT_EXTENSIONS)).filter((file) => !isTestFixture(file));
  const findings: Array<{ file: string; id: string; severity: string }> = [];
  for (const file of files) {
    const text = await readFile(resolve(root, file), "utf8");
    for (const rule of SECRET_PATTERNS) {
      if (rule.pattern.test(text)) findings.push({ file, id: rule.id, severity: "critical" });
    }
  }
  return {
    ...scanSummary(files, findings, SECRET_SCAN_ROOTS),
    excludedDirs: [...SECRET_SCAN_EXCLUDED_DIRS].sort()
  };
}

function scanSummary(files: string[], findings: Array<{ file: string; id: string; severity: string }>, roots: readonly string[]) {
  return {
    roots: [...roots],
    scannedFiles: files.length,
    findingCount: findings.length,
    critical: findings.filter((item) => item.severity === "critical").length,
    high: findings.filter((item) => item.severity === "high").length,
    findings
  };
}

async function collectFiles(root: string, roots: string[], extensions: Set<string>): Promise<string[]> {
  const out: string[] = [];
  for (const scanRoot of roots) {
    await walk(resolve(root, scanRoot), root, extensions, out);
  }
  return out.sort();
}

async function walk(absPath: string, root: string, extensions: Set<string>, out: string[]): Promise<void> {
  let info;
  try {
    info = await stat(absPath);
  } catch {
    return;
  }
  const name = absPath.split("/").at(-1) ?? "";
  if (info.isDirectory()) {
    if (SECRET_SCAN_EXCLUDED_DIRS.has(name)) return;
    for (const entry of await readdir(absPath)) await walk(resolve(absPath, entry), root, extensions, out);
    return;
  }
  if (!info.isFile()) return;
  if (!extensions.has(extname(absPath))) return;
  out.push(relative(root, absPath).split("\\").join("/"));
}

function parseBunPmList(stdout: string): Array<Record<string, unknown>> {
  const components: Array<Record<string, unknown>> = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.replace(/^[├└]──\s*/, "").trim();
    if (!trimmed || trimmed.endsWith("node_modules")) continue;
    const match = trimmed.match(/^(.+)@(.+)$/);
    if (!match) continue;
    const [, name, version] = match;
    components.push({
      type: "library",
      name,
      version: version.startsWith("workspace:") ? "workspace" : version,
      scope: version.startsWith("workspace:") ? "workspace" : "required",
      purl: version.startsWith("workspace:") ? undefined : `pkg:npm/${encodeURIComponent(name)}@${version}`
    });
  }
  return components;
}

function renderSecurityReport(input: {
  generatedAt: string;
  dependencyAudit: Record<string, unknown>;
  sbom: Record<string, unknown>;
  sast: Record<string, unknown>;
  secretScan: Record<string, unknown>;
  critical: number;
  high: number;
}) {
  return `# FG6 Release Security Scan

- Generated At: ${input.generatedAt}
- Environment: staging-release-readback
- Scanner: fg6-release-security-bundle
- Critical: ${input.critical}
- High: ${input.high}

| Surface | Tool | Result | Notes |
|---|---|---|---|
| Dependency vulnerability | bun audit --json | critical ${input.dependencyAudit.critical}; high ${input.dependencyAudit.high}; advisories ${input.dependencyAudit.totalAdvisories} | exit ${input.dependencyAudit.exitCode} |
| SBOM | bun pm ls --all | components ${input.sbom.componentCount} | ${input.sbom.path}; ${input.sbom.digest} |
| SAST | repo pattern scan | critical ${input.sast.critical}; high ${input.sast.high}; findings ${input.sast.findingCount} | scanned ${input.sast.scannedFiles} files |
| Secret scan | repo pattern scan | critical ${input.secretScan.critical}; high ${input.secretScan.high}; findings ${input.secretScan.findingCount} | scanned ${input.secretScan.scannedFiles} files; excludes _ops |

## Scope

The scan covers dependency advisories from the Bun audit database, a CycloneDX-style SBOM from the installed Bun dependency graph, high/critical SAST patterns in source roots, and real secret token/key material patterns in release-relevant repository text roots. Test fixtures and the _ops, .git, .wrangler, node_modules, and generated artifacts directories are excluded from secret scanning.
`;
}

function collectAdvisories(value: unknown): Array<{ severity: string }> {
  const out: Array<{ severity: string }> = [];
  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.severity === "string") out.push({ severity: record.severity });
    for (const child of Object.values(record)) visit(child);
  }
  visit(value);
  return out;
}

function parseLastJsonObject(text: string): unknown {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"));
  for (const line of lines.reverse()) {
    try {
      return JSON.parse(line);
    } catch {
      // Fall back to parsing from the first object below; Bun may print a banner before JSON.
    }
  }
  const start = text.indexOf("{");
  if (start === -1) return {};
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return {};
  }
}

async function writeJson(root: string, path: string, value: unknown): Promise<void> {
  await writeText(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(root: string, path: string, value: string): Promise<void> {
  const output = resolve(root, path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, value, "utf8");
}

function digestText(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function isTestFixture(path: string): boolean {
  return TEST_FIXTURE_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

function renderHuman(result: Awaited<ReturnType<typeof runFg6SecurityRelease>>): string {
  return [
    `[fg6-security-release-readback] ${result.ok ? "OK" : "FAILED"}`,
    `- dependency advisories: ${result.evidence.dependencyAudit.totalAdvisories}`,
    `- sbom components: ${result.evidence.sbom.componentCount}`,
    `- sast findings: ${result.evidence.sast.findingCount}`,
    `- secret findings: ${result.evidence.secretScan.findingCount}`,
    ...result.failures.map((failure) => `- ${failure}`)
  ].join("\n");
}

function renderInspectHuman(result: ReturnType<typeof inspectFg6SecurityRelease>): string {
  if (result.ok) return "[fg6-security-release-readback] OK";
  return ["[fg6-security-release-readback] FAILED", ...result.failures.map((failure) => `- ${failure}`)].join("\n");
}
