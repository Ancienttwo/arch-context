import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { recordSprint2ExternalEvidence } from "./sprint2-external-evidence-record.mjs";

describe("sprint2-external-evidence-record", () => {
  test("records external capture and security scan evidence, then verifies Sprint 2 readback", async () => {
    await withFixture(async (root) => {
      await writeApprovedFixture(root);
      await writeEvidenceFixture(root);
      await writePendingManifests(root);

      const result = await recordSprint2ExternalEvidence({
        root,
        environment: "production",
        capturePath: "docs/security/captures/production-redacted.har.json",
        scanArtifactPath: "docs/security/reviews/production-security-scan.md",
        critical: 0,
        high: 0,
        auditedAt: "2026-06-20T00:00:00.000Z"
      });

      expect(result.ok).toBe(true);
      expect(result.rolledBack).toBe(false);
      expect(result.readback?.status).toBe("ready");
      expect(result.recorded.capture).toMatchObject({
        id: "production.real-capture",
        environment: "production",
        status: "verified"
      });
      expect(result.recorded.securityScan).toMatchObject({
        id: "production.security-scan",
        environment: "production",
        status: "verified",
        critical: 0,
        high: 0
      });
    });
  });

  test("does not write manifests when governance approval is still pending", async () => {
    await withFixture(async (root) => {
      await writePendingApprovalFixture(root);
      await writeEvidenceFixture(root);
      await writePendingManifests(root);
      const beforeCaptureManifest = await readFile(join(root, "docs/security/captures/manifest.json"), "utf8");
      const beforeSecurityManifest = await readFile(join(root, "docs/security/scans/manifest.json"), "utf8");

      const result = await recordSprint2ExternalEvidence({
        root,
        environment: "production",
        capturePath: "docs/security/captures/production-redacted.har.json",
        scanArtifactPath: "docs/security/reviews/production-security-scan.md",
        critical: 0,
        high: 0
      });

      expect(result.ok).toBe(false);
      expect(result.failures).toContain("docs/approvals/archctx-sprint-2.md: Status must be Approved");
      expect(await readFile(join(root, "docs/security/captures/manifest.json"), "utf8")).toBe(beforeCaptureManifest);
      expect(await readFile(join(root, "docs/security/scans/manifest.json"), "utf8")).toBe(beforeSecurityManifest);
    });
  });

  test("rejects non-zero Critical or High counts before writing manifests", async () => {
    await withFixture(async (root) => {
      await writeApprovedFixture(root);
      await writeEvidenceFixture(root);
      await writePendingManifests(root);
      const beforeCaptureManifest = await readFile(join(root, "docs/security/captures/manifest.json"), "utf8");

      const result = await recordSprint2ExternalEvidence({
        root,
        environment: "production",
        capturePath: "docs/security/captures/production-redacted.har.json",
        scanArtifactPath: "docs/security/reviews/production-security-scan.md",
        critical: 0,
        high: 1
      });

      expect(result.ok).toBe(false);
      expect(result.failures).toContain("high findings 1 > 0");
      expect(await readFile(join(root, "docs/security/captures/manifest.json"), "utf8")).toBe(beforeCaptureManifest);
    });
  });
});

async function withFixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "archctx-s2-external-evidence-record-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeApprovedFixture(root: string) {
  await write(
    root,
    "docs/approvals/archctx-sprint-2.md",
    `# ArchContext Sprint 2 Approval Record

> **Status**: Approved
> **Date**: 2026-06-20
> **Approved By**: Repository Owner
> **Scope**: archctx-s2 contract delta and ADR-0026/ADR-0027/ADR-0028

## Approved Boundary

- ADR-0026, ADR-0027, and ADR-0028 are accepted.
`
  );
}

async function writePendingApprovalFixture(root: string) {
  await write(
    root,
    "docs/approvals/archctx-sprint-2.md",
    `# ArchContext Sprint 2 Approval Handoff

> **Status**: Pending
> **Date**: 2026-06-20
> **Approved By**: <human approver required>
> **Scope**: archctx-s2 contract delta and ADR-0026/ADR-0027/ADR-0028

## Approved Boundary

- ADR-0026, ADR-0027, and ADR-0028 require review.
`
  );
}

async function writeEvidenceFixture(root: string) {
  await write(root, "docs/security/captures/production-redacted.har.json", JSON.stringify(capture()));
  await write(root, "docs/security/reviews/production-security-scan.md", "# Production Security Scan\n\nCritical: 0\nHigh: 0\n");
}

async function writePendingManifests(root: string) {
  await write(
    root,
    "docs/security/captures/manifest.json",
    JSON.stringify(
      {
        schemaVersion: "archcontext.privacy-capture-manifest/v1",
        captures: [
          {
            id: "production.real-capture",
            environment: "production",
            status: "pending",
            artifactPath: "docs/security/captures/production-redacted.har.json",
            verifier: "scripts/privacy-packet-capture-audit.mjs"
          }
        ]
      },
      null,
      2
    )
  );
  await write(
    root,
    "docs/security/scans/manifest.json",
    JSON.stringify(
      {
        schemaVersion: "archcontext.security-scan-manifest/v1",
        scans: [
          {
            id: "production.security-scan",
            environment: "production",
            status: "pending",
            artifactPath: "docs/security/reviews/production-security-scan.md",
            scanner: "external-security-scan"
          }
        ]
      },
      null,
      2
    )
  );
}

function capture() {
  return {
    log: {
      version: "1.2",
      entries: [
        {
          request: {
            method: "POST",
            url: "https://archcontext.dev/attestations/verify",
            headers: [{ name: "authorization", value: "Bearer [REDACTED]" }],
            postData: {
              text: JSON.stringify({
                repositoryNumericId: 1001,
                worktreeDigest: `sha256:${"1".repeat(64)}`,
                trustLevel: "organization",
                accepted: true
              })
            }
          },
          response: {
            status: 200,
            headers: [{ name: "content-type", value: "application/json" }],
            content: { text: JSON.stringify({ accepted: true, attestationId: "att_1" }) }
          }
        }
      ]
    }
  };
}

async function write(root: string, path: string, content: string) {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${content}\n`, "utf8");
}
