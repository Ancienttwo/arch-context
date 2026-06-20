import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { crossRepoImpact, type CrossRepoRelation } from "@archcontext/architecture-domain";
import { attestationLabel, deviceIntegritySignals } from "@archcontext/attestation";
import { REQUIRED_CODEGRAPH_VERSION } from "@archcontext/codegraph-adapter";
import { controlPlaneRouteDigest } from "@archcontext/contracts";
import { describeEntitlementScope, isOfflineEntitlementActive, type OfflineEntitlement } from "@archcontext/control-plane-client";

export const NODE_SUPPORT_MATRIX = [
  { runtime: "node", version: "24.x", status: "target-lts" },
  { runtime: "node", version: "25.x", status: "dev-compatible" }
] as const;

export const PLATFORM_STATE_PATHS = {
  darwin: "~/Library/Application Support/ArchContext/repos/<fingerprint>",
  linux: "~/.local/share/archcontext/repos/<fingerprint>",
  win32: "%LOCALAPPDATA%/ArchContext/repos/<fingerprint>"
} as const;

export function diagnostics() {
  return {
    node: process.version,
    supportedNode: /^v(24|25)\./.test(process.version),
    codeGraphVersion: REQUIRED_CODEGRAPH_VERSION,
    privacyRouteDigest: controlPlaneRouteDigest(),
    secureDefaults: secureDefaults()
  };
}

export function secureDefaults() {
  return {
    tunnelEnabledByDefault: false,
    cloudContentUpload: "deny",
    githubContentsPermission: "none",
    applyChangeSetRequiresApproval: true
  };
}

export function installMarker(host: "codex" | "claude" | "generic") {
  return `<!-- BEGIN ARCHCONTEXT ${host} -->\nUse archcontext_prepare_task before coding and archcontext_complete_task before final response.\n<!-- END ARCHCONTEXT ${host} -->`;
}

export function uninstallMarker(content: string, host: "codex" | "claude" | "generic") {
  return content
    .replace(new RegExp(`\\n?<!-- BEGIN ARCHCONTEXT ${host} -->[\\s\\S]*?<!-- END ARCHCONTEXT ${host} -->\\n?`, "g"), "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function dependencyAudit(root: string) {
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const issues: string[] = [];
  if (!packageJson.engines?.node?.includes(">=24")) issues.push("node engine must include >=24");
  return { ok: issues.length === 0, issues };
}

export function secretScan(root: string): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  for (const file of listFiles(root)) {
    if (!/\.(ts|js|json|md|yaml|yml|sql)$/.test(file)) continue;
    if (file === "packages/hardening/src/index.ts" || file.includes("/test/")) continue;
    const body = readFileSync(resolve(root, file), "utf8");
    if (/(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|BEGIN PRIVATE KEY)/.test(body)) findings.push(file);
  }
  return { ok: findings.length === 0, findings };
}

export function largeRepoPerfEstimate(fileCount: number) {
  return { fileCount, estimatedContextQuerySeconds: Math.max(1, Math.ceil(fileCount / 1000)) };
}

export function launchGateReport() {
  return {
    status: "mvp-proxy-evidence",
    sourceExfiltration: "privacy-route-audit",
    changesetPathSafety: "changeset-engine tests",
    reviewBinding: "review-engine stale tests",
    codeGraphCompatibility: REQUIRED_CODEGRAPH_VERSION,
    chatgptDisclosure: "chatgpt-ui tests",
    securityFindings: {
      scope: "deterministic-mvp-surface",
      critical: 0,
      high: 0,
      manifest: "docs/security/scans/manifest.json",
      readback: "scripts/security-scan-manifest.mjs readback",
      productionScan: "pending"
    },
    evals: ["compatibility-debt", "target-vs-migration", "high-pressure-low-confidence"],
    representativeEval: "pending",
    largeRepoBenchmark: "pending",
    recoveryRunbook: "docs/runbooks/crash-recovery.md",
    installWalkthrough: "docs/examples/public-demo.md",
    timedInstallRehearsal: "pending"
  };
}

export function sprint2LaunchGateReport() {
  return {
    status: "sprint-2-deterministic-evidence",
    multiRepoPrivacy: "landscape numeric repository IDs only",
    organizationAttestation: "runner identity + installation + trustLevel tests",
    annualBilling: "$99 annual interval + per-person entitlement tests",
    singleRepoRegression: "bun test",
    securityFindings: {
      scope: "deterministic-sprint-2-surface",
      critical: 0,
      high: 0,
      manifest: "docs/security/scans/manifest.json",
      readback: "scripts/security-scan-manifest.mjs readback",
      productionScan: "pending"
    },
    evals: ["cross-repo-impact", "trust-level", "annual-entitlement"],
    representativeEval: "docs/verification/s2-representative-eval.md",
    packetCapture: {
      verifier: "scripts/privacy-packet-capture-audit.mjs",
      fixture: "docs/security/captures/metadata-only.har.json",
      manifest: "docs/security/captures/manifest.json",
      readback: "scripts/privacy-capture-manifest.mjs readback",
      production: "pending-production-environment"
    }
  };
}

export interface Sprint2EvalCase {
  id: string;
  category: "cross-repo-impact" | "trust-level" | "annual-entitlement";
  expected: unknown;
  actual: unknown;
  passed: boolean;
}

export interface Sprint2RepresentativeEval {
  status: "passed" | "failed";
  threshold: number;
  score: number;
  passed: number;
  total: number;
  cases: Sprint2EvalCase[];
}

export function sprint2RepresentativeEval(): Sprint2RepresentativeEval {
  const cases = [
    ...crossRepoImpactEvalCases(),
    ...trustLevelEvalCases(),
    ...annualEntitlementEvalCases()
  ];
  const passed = cases.filter((item) => item.passed).length;
  const score = passed / cases.length;
  const threshold = 1;
  return {
    status: score >= threshold ? "passed" : "failed",
    threshold,
    score,
    passed,
    total: cases.length,
    cases
  };
}

export interface PacketCaptureFinding {
  entry: string;
  path: string;
  pattern: string;
  valuePreview: string;
}

function crossRepoImpactEvalCases(): Sprint2EvalCase[] {
  const relations: CrossRepoRelation[] = [
    {
      schemaVersion: "archcontext.cross-repo-relation/v1",
      id: "relation.web-calls-api",
      kind: "calls",
      source: { repositoryId: "repo.web", nodeId: "module.checkout-ui" },
      target: { repositoryId: "repo.api", nodeId: "module.billing-api" },
      via: { kind: "interface", id: "interface.billing-http" },
      intent: "Checkout creates subscriptions through the API."
    },
    {
      schemaVersion: "archcontext.cross-repo-relation/v1",
      id: "relation.worker-subscribes-api",
      kind: "subscribes",
      source: { repositoryId: "repo.worker", nodeId: "module.billing-worker" },
      target: { repositoryId: "repo.api", nodeId: "event.subscription-created" },
      via: { kind: "event", id: "event.subscription-created" },
      intent: "Worker reacts to subscription creation."
    }
  ];
  return [
    evalCase("s2.eval.cross-repo-impact.api", "cross-repo-impact", ["relation.web-calls-api", "relation.worker-subscribes-api"], crossRepoImpact(relations, "repo.api").map((item) => item.id)),
    evalCase("s2.eval.cross-repo-impact.noise", "cross-repo-impact", [], crossRepoImpact(relations, "repo.docs").map((item) => item.id))
  ];
}

function trustLevelEvalCases(): Sprint2EvalCase[] {
  const organizationSignals = deviceIntegritySignals({ trustLevel: "organization", runnerControlled: true });
  return [
    evalCase("s2.eval.trust-level.organization-label", "trust-level", "Organization-attested", attestationLabel("organization")),
    evalCase("s2.eval.trust-level.developer-label", "trust-level", "Developer-attested", attestationLabel("developer")),
    evalCase("s2.eval.trust-level.honest-limitation", "trust-level", true, organizationSignals.signals.includes("customer-controlled-runner") && organizationSignals.limitation.includes("does not prove"))
  ];
}

function annualEntitlementEvalCases(): Sprint2EvalCase[] {
  const entitlement: OfflineEntitlement = {
    accountId: "acct_42",
    plan: "pro",
    billingInterval: "annual",
    privateRepositoryScope: "user-all-private-repositories",
    offlineUntil: "2026-06-26T00:00:00Z"
  };
  return [
    evalCase("s2.eval.annual-entitlement.active", "annual-entitlement", true, isOfflineEntitlementActive(entitlement, "2026-06-20T00:00:00Z")),
    evalCase("s2.eval.annual-entitlement.expired", "annual-entitlement", false, isOfflineEntitlementActive(entitlement, "2026-06-27T00:00:00Z")),
    evalCase("s2.eval.annual-entitlement.scope", "annual-entitlement", "annual personal Pro covers all private repositories the user can access", describeEntitlementScope(entitlement))
  ];
}

function evalCase(
  id: string,
  category: Sprint2EvalCase["category"],
  expected: unknown,
  actual: unknown
): Sprint2EvalCase {
  return {
    id,
    category,
    expected,
    actual,
    passed: JSON.stringify(actual) === JSON.stringify(expected)
  };
}

export interface PacketCaptureAuditResult {
  ok: boolean;
  entries: number;
  checkedValues: number;
  findings: PacketCaptureFinding[];
}

const FORBIDDEN_CAPTURE_KEYS = new Set([
  "sourceCode",
  "source_code",
  "sourceBody",
  "source_body",
  "diff",
  "diffBody",
  "diff_body",
  "symbolPayload",
  "symbol_payload",
  "codegraph",
  "codeGraph",
  "architectureModelBody",
  "architecture_model_body",
  "findingDetail",
  "finding_detail",
  "embedding",
  "fileBody",
  "file_body",
  "modelBody",
  "model_body",
  "findings"
]);

const FORBIDDEN_CAPTURE_VALUE_PATTERNS = [
  /source\s*code/i,
  /diff\s*body/i,
  /symbol\s*payload/i,
  /architecture\s*model\s*body/i,
  /finding\s*detail/i,
  /codegraph/i,
  /\/Users\/[^/\s]+\/Projects\//,
  /file:\/\/\//i,
  /Bearer\s+(?!\[REDACTED\])/i,
  /(access|refresh|secret|token)_[A-Za-z0-9_-]+/
] as const;

export function auditPacketCapture(capture: unknown): PacketCaptureAuditResult {
  const entries = normalizeCaptureEntries(capture);
  const findings: PacketCaptureFinding[] = [];
  let checkedValues = 0;
  for (const entry of entries) {
    checkedValues += inspectValue(entry.payload, entry.id, "$", findings);
  }
  return { ok: findings.length === 0, entries: entries.length, checkedValues, findings };
}

function normalizeCaptureEntries(capture: unknown): { id: string; payload: unknown }[] {
  if (capture && typeof capture === "object" && "log" in capture) {
    const entries = (capture as { log?: { entries?: unknown[] } }).log?.entries ?? [];
    return entries.map((entry, index) => ({ id: `har.entries[${index}]`, payload: projectHarEntry(entry) }));
  }
  if (Array.isArray(capture)) {
    return capture.map((entry, index) => ({ id: `entries[${index}]`, payload: entry }));
  }
  return [{ id: "capture", payload: capture }];
}

function projectHarEntry(entry: unknown): unknown {
  if (!entry || typeof entry !== "object") return entry;
  const value = entry as Record<string, any>;
  return {
    request: {
      method: value.request?.method,
      url: value.request?.url,
      headers: value.request?.headers,
      postData: value.request?.postData?.text
    },
    response: {
      status: value.response?.status,
      headers: value.response?.headers,
      content: value.response?.content?.text
    }
  };
}

function inspectValue(value: unknown, entry: string, path: string, findings: PacketCaptureFinding[]): number {
  if (value === null || value === undefined) return 0;
  let checked = 1;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      checked += inspectValue(item, entry, `${path}[${index}]`, findings);
    });
    return checked;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = `${path}.${key}`;
      if (FORBIDDEN_CAPTURE_KEYS.has(key)) {
        findings.push({ entry, path: childPath, pattern: `key:${key}`, valuePreview: preview(child) });
      }
      checked += inspectValue(child, entry, childPath, findings);
    }
    return checked;
  }
  if (typeof value === "string") {
    for (const pattern of FORBIDDEN_CAPTURE_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        findings.push({ entry, path, pattern: pattern.toString(), valuePreview: preview(value) });
      }
    }
  }
  return checked;
}

function preview(value: unknown): string {
  return JSON.stringify(value).slice(0, 120);
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  walk(".");
  return out;

  function walk(relativeDir: string): void {
    for (const entry of readdirSync(resolve(root, relativeDir), { withFileTypes: true })) {
      if ([".git", "node_modules", "coverage"].includes(entry.name)) continue;
      const child = relativeDir === "." ? entry.name : `${relativeDir}/${entry.name}`;
      const full = resolve(root, child);
      if (entry.isDirectory()) walk(child);
      if (entry.isFile() && statSync(full).size < 1_000_000) out.push(child);
    }
  }
}
