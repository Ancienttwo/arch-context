import { describe, expect, test } from "bun:test";
import { inspectFg6SecurityRelease } from "./fg6-security-release-readback";

describe("fg6 security release readback evidence", () => {
  test("accepts dependency vulnerability, SBOM, SAST, secret scan, and manifest evidence", () => {
    expect(inspectFg6SecurityRelease(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects high dependency, empty SBOM, SAST findings, secret hits, and weak manifest", () => {
    const recording: any = verifiedRecording();
    recording.evidence.dependencyAudit.high = 1;
    recording.evidence.dependencyAudit.totalAdvisories = 1;
    recording.evidence.sbom.componentCount = 0;
    recording.evidence.sast.high = 1;
    recording.evidence.sast.findingCount = 1;
    recording.evidence.secretScan.critical = 1;
    recording.evidence.secretScan.findingCount = 1;
    recording.evidence.secretScan.excludedDirs = [".git", "node_modules"];
    recording.evidence.manifestEntry.high = 1;
    recording.evidence.manifestReadback.ok = false;
    recording.evidence.manifestReadback.externalVerified = 0;
    recording.evidence.assertions.dependencyVulnerabilityScanClean = false;
    recording.evidence.assertions.sbomGenerated = false;
    recording.evidence.assertions.sastCriticalHighClean = false;
    recording.evidence.assertions.secretScanClean = false;
    recording.evidence.assertions.securityManifestVerified = false;
    recording.evidence.assertions.noCriticalHighReleaseFindings = false;

    const result = inspectFg6SecurityRelease(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("dependencyAudit high must be 0");
    expect(result.failures).toContain("dependencyAudit totalAdvisories must be 0");
    expect(result.failures).toContain("sbom componentCount must be positive");
    expect(result.failures).toContain("sast high must be 0");
    expect(result.failures).toContain("sast findingCount must be 0");
    expect(result.failures).toContain("secretScan critical must be 0");
    expect(result.failures).toContain("secretScan findingCount must be 0");
    expect(result.failures).toContain("secretScan must exclude _ops");
    expect(result.failures).toContain("manifest high must be 0");
    expect(result.failures).toContain("manifest readback must pass");
    expect(result.failures).toContain("manifest externalVerified must be positive");
    expect(result.failures).toContain("assertion dependencyVulnerabilityScanClean must be true");
    expect(result.failures).toContain("assertion sbomGenerated must be true");
    expect(result.failures).toContain("assertion sastCriticalHighClean must be true");
    expect(result.failures).toContain("assertion secretScanClean must be true");
    expect(result.failures).toContain("assertion securityManifestVerified must be true");
    expect(result.failures).toContain("assertion noCriticalHighReleaseFindings must be true");
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg6-security-release-readback/v1",
    taskId: "FG6-11",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T10:00:00.000Z",
    sources: {
      packageJson: "package.json",
      lockfile: "bun.lock",
      reportPath: "docs/security/reviews/fg6-release-security-scan.md",
      sbomPath: "docs/security/scans/fg6-release-sbom.cdx.json",
      manifestPath: "docs/security/scans/manifest.json"
    },
    evidence: {
      dependencyAudit: {
        tool: "bun audit",
        exitCode: 0,
        ok: true,
        stdoutDigest: "sha256:" + "a".repeat(64),
        stderrDigest: null,
        totalAdvisories: 0,
        critical: 0,
        high: 0,
        moderate: 0,
        low: 0
      },
      sbom: {
        path: "docs/security/scans/fg6-release-sbom.cdx.json",
        digest: "sha256:" + "b".repeat(64),
        componentCount: 7,
        workspaceComponentCount: 5,
        packageManager: "bun"
      },
      sast: {
        roots: ["actions", "deploy", "packages", "scripts"],
        scannedFiles: 42,
        findingCount: 0,
        critical: 0,
        high: 0,
        findings: []
      },
      secretScan: {
        roots: [".github", "actions", "deploy", "docs", "evals", "packages", "plans", "schemas", "scripts", "skills", "tasks"],
        scannedFiles: 120,
        findingCount: 0,
        critical: 0,
        high: 0,
        findings: [],
        excludedDirs: [".git", ".wrangler", "_ops", "artifacts", "node_modules"]
      },
      report: {
        path: "docs/security/reviews/fg6-release-security-scan.md",
        digest: "sha256:" + "c".repeat(64)
      },
      manifestEntry: {
        id: "staging.fg6-release-security-scan",
        environment: "staging",
        status: "verified",
        artifactPath: "docs/security/reviews/fg6-release-security-scan.md",
        artifactDigest: "sha256:" + "c".repeat(64),
        scanner: "fg6-release-security-bundle",
        scope: "dependency-vulnerability-sbom-sast-secret-scan",
        critical: 0,
        high: 0
      },
      manifestReadback: {
        ok: true,
        verified: 2,
        pending: 1,
        externalVerified: 1,
        failures: []
      },
      assertions: {
        dependencyVulnerabilityScanClean: true,
        sbomGenerated: true,
        sastCriticalHighClean: true,
        secretScanClean: true,
        securityManifestVerified: true,
        noCriticalHighReleaseFindings: true
      }
    },
    failures: []
  };
}
