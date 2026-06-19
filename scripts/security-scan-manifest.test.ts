import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { digestFile } from "./privacy-capture-lib.mjs";
import { readbackSecurityScanManifest, recordSecurityScan } from "./security-scan-manifest.mjs";

describe("security-scan-manifest", () => {
  test("default readback verifies deterministic scans while leaving production pending", async () => {
    await withSecurityScanFixture(async (root, deterministicDigest) => {
      await writeManifest(root, [
        verifiedScan("deterministic.m6-review", "deterministic", "docs/security/reviews/m6-independent-threat-review.md", deterministicDigest),
        {
          id: "production.security-scan",
          environment: "production",
          status: "pending",
          artifactPath: "docs/security/reviews/production-security-scan.md",
          scanner: "external-security-scan"
        }
      ]);

      await expect(readbackSecurityScanManifest({ root })).resolves.toMatchObject({
        ok: true,
        verified: 1,
        pending: 1,
        externalVerified: 0
      });
    });
  });

  test("strict external readback rejects deterministic-only evidence", async () => {
    await withSecurityScanFixture(async (root, deterministicDigest) => {
      await writeManifest(root, [
        verifiedScan("deterministic.m6-review", "deterministic", "docs/security/reviews/m6-independent-threat-review.md", deterministicDigest),
        {
          id: "staging.security-scan",
          environment: "staging",
          status: "pending",
          artifactPath: "docs/security/reviews/staging-security-scan.md",
          scanner: "external-security-scan"
        }
      ]);

      await expect(readbackSecurityScanManifest({ root, requireExternal: true })).resolves.toMatchObject({
        ok: false,
        verified: 1,
        pending: 1,
        externalVerified: 0,
        failures: ["missing verified staging or production security scan"]
      });
    });
  });

  test("strict production readback accepts a verified zero Critical/High production scan", async () => {
    await withSecurityScanFixture(async (root, deterministicDigest, productionDigest) => {
      await writeManifest(root, [
        verifiedScan("deterministic.m6-review", "deterministic", "docs/security/reviews/m6-independent-threat-review.md", deterministicDigest),
        verifiedScan("production.security-scan", "production", "docs/security/reviews/production-security-scan.md", productionDigest)
      ]);

      await expect(readbackSecurityScanManifest({ root, requireEnvironment: "production" })).resolves.toMatchObject({
        ok: true,
        verified: 2,
        pending: 0,
        externalVerified: 1,
        failures: []
      });
    });
  });

  test("record writes a verified digest entry that strict production readback accepts", async () => {
    await withSecurityScanFixture(async (root) => {
      await writeManifest(root, []);

      const entry = await recordSecurityScan({
        root,
        environment: "production",
        artifactPath: "docs/security/reviews/production-security-scan.md",
        id: "production.security-scan",
        auditedAt: "2026-06-20T00:00:00.000Z",
        scanner: "external-security-scan",
        scope: "production-readback",
        critical: 0,
        high: 0
      });
      const manifest = JSON.parse(await readFile(join(root, "docs/security/scans/manifest.json"), "utf8"));

      expect(entry).toMatchObject({
        id: "production.security-scan",
        environment: "production",
        status: "verified",
        critical: 0,
        high: 0
      });
      expect(manifest.scans).toHaveLength(1);
      await expect(readbackSecurityScanManifest({ root, requireEnvironment: "production" })).resolves.toMatchObject({
        ok: true,
        verified: 1,
        pending: 0,
        externalVerified: 1,
        failures: []
      });
    });
  });

  test("verified production scan fails when High findings are open", async () => {
    await withSecurityScanFixture(async (root, deterministicDigest, productionDigest) => {
      await writeManifest(root, [
        verifiedScan("deterministic.m6-review", "deterministic", "docs/security/reviews/m6-independent-threat-review.md", deterministicDigest),
        { ...verifiedScan("production.security-scan", "production", "docs/security/reviews/production-security-scan.md", productionDigest), high: 1 }
      ]);

      await expect(readbackSecurityScanManifest({ root, requireEnvironment: "production" })).resolves.toMatchObject({
        ok: false,
        externalVerified: 1,
        failures: ["production.security-scan: high findings 1 > 0"]
      });
    });
  });
});

async function withSecurityScanFixture(run: (root: string, deterministicDigest: string, productionDigest: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "archctx-security-scan-"));
  try {
    const deterministicPath = "docs/security/reviews/m6-independent-threat-review.md";
    const productionPath = "docs/security/reviews/production-security-scan.md";
    await write(root, deterministicPath, "# Review\n\nCritical: 0\nHigh: 0\n");
    await write(root, productionPath, "# Production Security Scan\n\nCritical: 0\nHigh: 0\n");
    await run(root, await digestFile(join(root, deterministicPath)), await digestFile(join(root, productionPath)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function verifiedScan(id: string, environment: string, artifactPath: string, artifactDigest: string) {
  return {
    id,
    environment,
    status: "verified",
    artifactPath,
    artifactDigest,
    auditedAt: "2026-06-20T00:00:00.000Z",
    scanner: "security-review",
    scope: "test-surface",
    critical: 0,
    high: 0
  };
}

async function writeManifest(root: string, scans: unknown[]) {
  await write(
    root,
    "docs/security/scans/manifest.json",
    JSON.stringify({ schemaVersion: "archcontext.security-scan-manifest/v1", scans }, null, 2)
  );
}

async function write(root: string, path: string, content: string) {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}
