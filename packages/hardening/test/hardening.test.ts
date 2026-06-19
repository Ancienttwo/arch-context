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
      sourceExfiltration: "privacy-route-audit",
      securityFindings: { critical: 0, high: 0 }
    });
  });
});
