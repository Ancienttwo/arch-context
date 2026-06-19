import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dependencyAudit,
  auditPacketCapture,
  diagnostics,
  installMarker,
  largeRepoPerfEstimate,
  launchGateReport,
  secretScan,
  secureDefaults,
  sprint2LaunchGateReport,
  sprint2RepresentativeEval,
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
      securityFindings: {
        scope: "deterministic-mvp-surface",
        critical: 0,
        high: 0,
        manifest: "docs/security/scans/manifest.json",
        readback: "scripts/security-scan-manifest.mjs readback",
        productionScan: "pending"
      },
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
      securityFindings: {
        critical: 0,
        high: 0,
        manifest: "docs/security/scans/manifest.json",
        readback: "scripts/security-scan-manifest.mjs readback",
        productionScan: "pending"
      },
      representativeEval: "docs/verification/s2-representative-eval.md",
      packetCapture: {
        verifier: "scripts/privacy-packet-capture-audit.mjs",
        manifest: "docs/security/captures/manifest.json",
        readback: "scripts/privacy-capture-manifest.mjs readback",
        production: "pending-production-environment"
      }
    });
  });

  test("runs Sprint 2 representative eval across impact, trust, and entitlement", () => {
    const report = sprint2RepresentativeEval();
    expect(report).toMatchObject({
      status: "passed",
      threshold: 1,
      score: 1,
      passed: 8,
      total: 8
    });
    expect(report.cases.map((item) => item.category)).toEqual(
      expect.arrayContaining(["cross-repo-impact", "trust-level", "annual-entitlement"])
    );
    expect(report.cases.every((item) => item.passed)).toBe(true);
  });

  test("audits packet captures for code-bearing payloads and unredacted secrets", () => {
    const clean = auditPacketCapture({
      log: {
        entries: [
          {
            request: {
              method: "POST",
              url: "https://api.archcontext.dev/attestations/verify",
              headers: [{ name: "authorization", value: "Bearer [REDACTED]" }],
              postData: {
                text: JSON.stringify({
                  attestationId: "att_1",
                  headSha: "abc",
                  worktreeDigest: `sha256:${"1".repeat(64)}`,
                  reviewDigest: `sha256:${"2".repeat(64)}`,
                  trustLevel: "organization",
                  repositoryNumericId: 1001
                })
              }
            },
            response: { status: 200, content: { text: "{\"accepted\":true}" } }
          }
        ]
      }
    });
    expect(clean).toMatchObject({ ok: true, entries: 1 });

    const dirty = auditPacketCapture([
      {
        request: {
          headers: [{ name: "authorization", value: "Bearer live_token" }],
          body: { sourceCode: "function leaked() {}", findingDetail: "do not upload" }
        }
      }
    ]);
    expect(dirty.ok).toBe(false);
    expect(dirty.findings.map((finding) => finding.pattern)).toEqual(
      expect.arrayContaining(["key:sourceCode", "key:findingDetail", "/Bearer\\s+(?!\\[REDACTED\\])/i"])
    );
  });
});
