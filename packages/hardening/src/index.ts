import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { routeDigest } from "../../../apps/control-plane/src/index";
import { REQUIRED_CODEGRAPH_VERSION } from "../../codegraph-adapter/src/index";

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
    privacyRouteDigest: routeDigest(),
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
    securityFindings: { scope: "deterministic-mvp-surface", critical: 0, high: 0, productionScan: "pending" },
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
    securityFindings: { scope: "deterministic-sprint-2-surface", critical: 0, high: 0, productionScan: "pending" },
    evals: ["cross-repo-impact", "trust-level", "annual-entitlement"],
    packetCapture: "pending-production-environment"
  };
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
