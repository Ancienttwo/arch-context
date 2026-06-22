import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dependencyAudit,
  auditPacketCapture,
  diagnostics,
  installMarker,
  largeRepoPerfEstimate,
  launchGateReport,
  localEgressStatus,
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
    expect(diagnostics().privacyRouteDigest).toMatch(/^sha256:/);
    expect(diagnostics().egress.ok).toBe(true);
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

  test("documents self-hosted runner hardening minimum network and filesystem permissions", () => {
    const guide = readFileSync("docs/security/self-hosted-runner-hardening.md", "utf8");

    expect(guide).toContain("# Self-Hosted Organization Runner Hardening");
    expect(guide).toContain("config.sh --ephemeral");
    expect(guide).toContain("archcontext-organization-runners");
    expect(guide).toContain("archcontext-org-runner");
    expect(guide).toContain("no inbound listener");
    expect(guide).toContain("outbound TCP 443 only");
    for (const destination of [
      "github.com",
      "api.github.com",
      "*.actions.githubusercontent.com",
      "codeload.github.com",
      "results-receiver.actions.githubusercontent.com",
      "*.blob.core.windows.net",
      "objects.githubusercontent.com",
      "github-releases.githubusercontent.com",
      "release-assets.githubusercontent.com",
      "archcontext.repoharness.com"
    ]) {
      expect(guide).toContain(destination);
    }
    expect(guide).toContain("archctx-runner");
    expect(guide).toContain("0750");
    expect(guide).toContain("0700");
    expect(guide).toContain("keychain://archcontext/runner/<installation-id>/<public-key-id>");
    expect(guide).toContain("persist-credentials: false");
    expect(guide).toContain("trust-level: organization");
    expect(guide).toContain("fork-pr-mode: unsupported");
    expect(guide).toContain("expected-head-tree-oid");
    expect(guide).toContain("The job must not add:");
    expect(guide).toContain("contents: write");
    expect(guide).toContain("write-all");
    expect(guide).not.toContain("GITHUB_TOKEN: write");
    expect(guide).not.toContain("BEGIN PRIVATE KEY");
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
