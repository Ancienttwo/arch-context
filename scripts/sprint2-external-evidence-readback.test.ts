import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { auditCaptureFile, digestFile } from "./privacy-capture-lib.mjs";
import { readbackSprint2ExternalEvidence } from "./sprint2-external-evidence-readback.mjs";

describe("sprint2-external-evidence-readback", () => {
  test("reports blocked until capture and security scan evidence are verified", async () => {
    await withFixture(async (root) => {
      await writeCaptureManifest(root, [
        {
          id: "production.real-capture",
          environment: "production",
          status: "pending",
          artifactPath: "docs/security/captures/production-redacted.har.json"
        }
      ]);
      await writeSecurityScanManifest(root, [
        {
          id: "production.security-scan",
          environment: "production",
          status: "pending",
          artifactPath: "docs/security/reviews/production-security-scan.md"
        }
      ]);

      const result = await readbackSprint2ExternalEvidence({ root });
      expect(result.status).toBe("blocked");
      expect(result.blockers.some((item) => item.includes("MR-EG5/TR-EG4/HL-EG1") && item.includes("missing verified staging or production capture"))).toBe(true);
      expect(result.blockers.some((item) => item.includes("HL-EG5") && item.includes("missing verified staging or production security scan"))).toBe(true);
    });
  });

  test("reports ready when all Sprint 2 external evidence gates are verified", async () => {
    await withFixture(async (root) => {
      await write(root, "docs/security/captures/production-redacted.har.json", JSON.stringify(capture()));
      const captureAudit = await auditCaptureFile(join(root, "docs/security/captures/production-redacted.har.json"));
      await writeCaptureManifest(root, [
        {
          id: "production.real-capture",
          environment: "production",
          status: "verified",
          artifactPath: "docs/security/captures/production-redacted.har.json",
          captureDigest: await digestFile(join(root, "docs/security/captures/production-redacted.har.json")),
          auditedAt: "2026-06-20T00:00:00.000Z",
          entries: captureAudit.entries,
          checkedValues: captureAudit.checkedValues,
          verifier: "scripts/privacy-packet-capture-audit.mjs"
        }
      ]);
      await write(root, "docs/security/reviews/production-security-scan.md", "# Production Security Scan\n\nCritical: 0\nHigh: 0\n");
      await writeSecurityScanManifest(root, [
        {
          id: "production.security-scan",
          environment: "production",
          status: "verified",
          artifactPath: "docs/security/reviews/production-security-scan.md",
          artifactDigest: await digestFile(join(root, "docs/security/reviews/production-security-scan.md")),
          auditedAt: "2026-06-20T00:00:00.000Z",
          scanner: "external-security-scan",
          scope: "production",
          critical: 0,
          high: 0
        }
      ]);

      const result = await readbackSprint2ExternalEvidence({ root });
      expect(result).toMatchObject({
        status: "ready",
        blockers: []
      });
      expect(result.gates.map((item) => item.id)).toEqual(["MR-EG5/TR-EG4/HL-EG1", "HL-EG5"]);
      expect(result.gates.map((item) => item.status)).toEqual(["verified", "verified"]);
    });
  });
});

async function withFixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "archctx-s2-external-evidence-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function capture() {
  return {
    log: {
      version: "1.2",
      entries: [
        {
          request: {
            method: "POST",
            url: "https://archcontext.dev/notifications/events",
            headers: [{ name: "authorization", value: "Bearer [REDACTED]" }],
            postData: {
              text: JSON.stringify({
                schemaVersion: "archcontext.notification-event/v1",
                eventId: "evt_1",
                repositoryNumericId: 1001,
                payloadDigest: `sha256:${"1".repeat(64)}`,
                result: "pass"
              })
            }
          },
          response: {
            status: 200,
            headers: [{ name: "content-type", value: "application/json" }],
            content: { text: JSON.stringify({ accepted: true, eventId: "evt_1" }) }
          }
        }
      ]
    }
  };
}

async function writeCaptureManifest(root: string, captures: unknown[]) {
  await write(
    root,
    "docs/security/captures/manifest.json",
    JSON.stringify({ schemaVersion: "archcontext.privacy-capture-manifest/v1", captures }, null, 2)
  );
}

async function writeSecurityScanManifest(root: string, scans: unknown[]) {
  await write(
    root,
    "docs/security/scans/manifest.json",
    JSON.stringify({ schemaVersion: "archcontext.security-scan-manifest/v1", scans }, null, 2)
  );
}

async function write(root: string, path: string, content: string) {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${content}\n`, "utf8");
}
