import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dependencyAudit,
  diagnostics,
  installMarker,
  largeRepoPerfEstimate,
  launchGateReport,
  secretScan,
  secureDefaults,
  sprint2LaunchGateReport,
  uninstallMarker
} from "../src/index";

describe("@archcontext/hardening", () => {
  test("reports secure defaults and diagnostics inputs", () => {
    expect(secureDefaults()).toMatchObject({
      tunnelEnabledByDefault: false,
      cloudContentUpload: "deny",
      githubContentsPermission: "none",
      applyChangeSetRequiresApproval: true
    });
    expect(diagnostics().privacyRouteDigest).toMatch(/^sha256:/);
  });

  test("installs and removes host markers without touching surrounding content", () => {
    const marker = installMarker("codex");
    expect(marker).toContain("archcontext_prepare_task");
    expect(uninstallMarker(`before\n${marker}\nafter`, "codex")).toBe("before\nafter");
  });

  test("audits dependencies and local secret patterns", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-hardening-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ engines: { node: ">=24 <26" } }), "utf8");
      expect(dependencyAudit(root)).toEqual({ ok: true, issues: [] });
      writeFileSync(join(root, "leak.md"), "sk-12345678901234567890", "utf8");
      expect(secretScan(root)).toEqual({ ok: false, findings: ["leak.md"] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("summarizes launch gate evidence without claiming release completion", () => {
    expect(largeRepoPerfEstimate(2500).estimatedContextQuerySeconds).toBe(3);
    expect(launchGateReport()).toMatchObject({
      status: "mvp-proxy-evidence",
      sourceExfiltration: "privacy-route-audit",
      securityFindings: { scope: "deterministic-mvp-surface", critical: 0, high: 0, productionScan: "pending" },
      representativeEval: "pending",
      largeRepoBenchmark: "pending",
      timedInstallRehearsal: "pending"
    });
  });

  test("summarizes Sprint 2 launch evidence without claiming production capture", () => {
    expect(sprint2LaunchGateReport()).toMatchObject({
      status: "sprint-2-deterministic-evidence",
      organizationAttestation: "runner identity + installation + trustLevel tests",
      annualBilling: "$99 annual interval + per-person entitlement tests",
      securityFindings: { critical: 0, high: 0, productionScan: "pending" },
      packetCapture: "pending-production-environment"
    });
  });
});
