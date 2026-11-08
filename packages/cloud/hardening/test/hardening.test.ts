import { localEgressStatus } from "../../../local-runtime/runtime-daemon/src/egress";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dependencyAudit,
  auditPacketCapture,
  diagnostics,
  isSupportedNodeVersion,
  installMarker,
  largeRepoPerfEstimate,
  launchGateReport,
  PLATFORM_STATE_PATHS,
  secretScan,
  secureDefaults,
  sprint2LaunchGateReport,
  sprint2RepresentativeEval,
  uninstallMarker
} from "../src/index";

describe("@archcontext/cloud/hardening", () => {
  test("reports secure defaults and diagnostics inputs", () => {
    expect(secureDefaults()).toMatchObject({
      tunnelEnabledByDefault: false,
      cloudContentUpload: "deny",
      githubContentsPermission: "none",
      thirdPartyTelemetry: "disabled-by-default",
      defaultEgress: "local-only",
      applyChangeSetRequiresApproval: true
    });
    // ADR-0053 removed hardening.privacyRouteDigest with the governance route table.
    expect(diagnostics(localEgressStatus({}))).not.toHaveProperty("privacyRouteDigest");
    expect(diagnostics(localEgressStatus({})).egress.ok).toBe(true);
    expect(isSupportedNodeVersion("v22.21.1")).toBe(false);
    expect(isSupportedNodeVersion("v22.22.0")).toBe(true);
    expect(isSupportedNodeVersion("v23.11.1")).toBe(true);
    expect(isSupportedNodeVersion("v24.18.0")).toBe(true);
    expect(isSupportedNodeVersion("v25.8.1")).toBe(true);
    expect(isSupportedNodeVersion("v26.0.0")).toBe(false);
    expect(isSupportedNodeVersion("22.22")).toBe(false);
    expect(localEgressStatus({}).codeGraph).toMatchObject({
      telemetry: "disabled",
      envVar: "DO_NOT_TRACK",
      effectiveValue: "1",
      source: "archcontext-default"
    });
    expect(localEgressStatus({ DO_NOT_TRACK: "0" })).toMatchObject({
      ok: false,
      thirdPartyTelemetry: "not-disabled-by-env",
      codeGraph: {
        telemetry: "not-disabled-by-env",
        configuredValue: "0",
        source: "environment"
      }
    });
    expect(PLATFORM_STATE_PATHS).toEqual({
      darwin: "~/Library/Application Support/ArchContext/repositories/<storage-repository-id>/worktrees/<storage-workspace-id>",
      linux: "~/.local/share/archcontext/repositories/<storage-repository-id>/worktrees/<storage-workspace-id>",
      win32: "%LOCALAPPDATA%/ArchContext/repositories/<storage-repository-id>/worktrees/<storage-workspace-id>"
    });
  });

  test("installs and removes host markers without touching surrounding content", () => {
    const marker = installMarker("codex");
    expect(marker).toContain("archcontext_prepare_task");
    expect(uninstallMarker(`before\n${marker}\nafter`, "codex")).toBe("before\nafter");
  });

  test("audits dependencies and local secret patterns", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-hardening-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ engines: { node: ">=22.22 <26" } }), "utf8");
      expect(dependencyAudit(root)).toEqual({ ok: true, issues: [] });
      writeFileSync(join(root, "package.json"), JSON.stringify({ engines: { node: ">=22 <26" } }), "utf8");
      expect(dependencyAudit(root)).toEqual({
        ok: false,
        issues: ["node engine must equal >=22.22 <26"]
      });
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

  test("runs Sprint 2 representative eval across impact and entitlement", () => {
    const report = sprint2RepresentativeEval();
    // ADR-0053 removed the three trust-level cases along with Developer and Organization attestation.
    expect(report).toMatchObject({
      status: "passed",
      threshold: 1,
      score: 1,
      passed: 5,
      total: 5
    });
    expect(report.cases.map((item) => item.category)).toEqual(
      expect.arrayContaining(["cross-repo-impact", "annual-entitlement"])
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
