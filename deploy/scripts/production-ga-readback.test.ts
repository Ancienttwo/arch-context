import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { digestFile } from "../../scripts/privacy-capture-lib.mjs";
import { buildReadbackConfig, preflightExternalReadback, runExternalReadback } from "./production-ga-readback.mjs";

describe("production GA external readback script", () => {
  test("preflight blocks production when endpoint and external evidence are missing", async () => {
    await withProductionEvidenceFixture(async (root) => {
      const config = buildReadbackConfig({}, ["--environment", "production", "--root", root, "--json"]);
      const result = await preflightExternalReadback(config);

      expect(result.status).toBe("blocked");
      expect(result.blockers).toContain("missing ARCHCONTEXT_PRODUCTION_BASE_URL or ARCHCONTEXT_READBACK_BASE_URL");
      expect(result.blockers.some((blocker) => blocker.includes("GPT App Directory"))).toBe(true);
      expect(result.blockers.some((blocker) => blocker.includes("provider delivery"))).toBe(true);
      expect(result.blockers.some((blocker) => blocker.includes("packet capture"))).toBe(true);
      expect(result.blockers.some((blocker) => blocker.includes("security scan"))).toBe(true);
      expect(result.checks.packetCaptureExternalEvidence.ok).toBe(false);
      expect(result.checks.securityScanExternalEvidence.ok).toBe(false);
    }, { writeExternalEvidence: false });
  });

  test("preflight accepts production only when external capture and scan manifests are verified", async () => {
    await withProductionEvidenceFixture(async (root) => {
      const config = buildReadbackConfig({}, [
        "--environment",
        "production",
        "--base-url",
        "https://archcontext.example",
        "--openai-directory-evidence",
        "docs/evidence/openai-directory.md",
        "--provider-evidence",
        "docs/evidence/provider-delivery.md",
        "--root",
        root,
        "--json"
      ]);
      const result = await preflightExternalReadback(config);

      expect(result.status).toBe("ready");
      expect(result.blockers).toEqual([]);
      expect(result.checks.packetCaptureExternalEvidence).toMatchObject({ ok: true, externalVerified: 1 });
      expect(result.checks.securityScanExternalEvidence).toMatchObject({ ok: true, externalVerified: 1 });
    });
  });

  test("allow-partial production preflight skips external evidence requirements", async () => {
    const config = buildReadbackConfig({}, ["--environment", "production", "--allow-partial", "--json"]);
    const result = await preflightExternalReadback(config);
    expect(result.status).toBe("blocked");
    expect(result).toMatchObject({
      status: "blocked",
      checks: {
        packetCaptureExternalEvidence: { notRequired: true },
        securityScanExternalEvidence: { notRequired: true }
      }
    });
  });

  test("staging readback can verify endpoint responses and writes redacted HAR", async () => {
    const seen: string[] = [];
    const fetchImpl = async (url: string) => {
      seen.push(url);
      const body = url.endsWith("/chatgpt/directory")
        ? JSON.stringify({ slug: "archcontext", repositoryContent: "local-runtime-only" })
        : url.endsWith("/privacy")
          ? "ArchContext privacy policy"
          : JSON.stringify({ issuer: "https://archcontext.example" });
      return new Response(body, { status: 200, headers: { "content-type": "application/json", "set-cookie": "session=secret" } });
    };
    const config = buildReadbackConfig({}, [
      "--environment",
      "staging",
      "--base-url",
      "https://archcontext.example",
      "--capture",
      "artifacts/test/staging-redacted.har.json"
    ]);
    const result = await runExternalReadback(config, fetchImpl as unknown as typeof fetch) as { status: string; checks: { id: string }[] };
    expect(result.status).toBe("verified");
    expect(result.checks.map((check: any) => check.id)).toEqual(["privacy", "chatgpt-directory-metadata", "oauth-discovery"]);
    expect(seen).toHaveLength(3);
  });
});

async function withProductionEvidenceFixture(
  run: (root: string) => Promise<void>,
  options: { writeExternalEvidence?: boolean } = {}
) {
  const root = await mkdtemp(join(tmpdir(), "archctx-ga-readback-"));
  try {
    if (options.writeExternalEvidence !== false) await writeProductionEvidence(root);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeProductionEvidence(root: string) {
  const capturePath = "docs/security/captures/production-redacted.har.json";
  const scanPath = "docs/security/reviews/production-security-scan.md";
  await write(root, "docs/evidence/openai-directory.md", "ArchContext GPT App Directory listing evidence.\n");
  await write(root, "docs/evidence/provider-delivery.md", "Provider delivery evidence without payload body.\n");
  await write(root, capturePath, JSON.stringify(capture("https://archcontext.example/attestations/verify")));
  await write(root, scanPath, "# Production Security Scan\n\nCritical: 0\nHigh: 0\n");
  await write(
    root,
    "docs/security/captures/manifest.json",
    JSON.stringify({
      schemaVersion: "archcontext.privacy-capture-manifest/v1",
      captures: [
        {
          id: "production.real-capture",
          environment: "production",
          status: "verified",
          artifactPath: capturePath,
          captureDigest: await digestFile(join(root, capturePath)),
          auditedAt: "2026-06-20T00:00:00.000Z",
          entries: 1,
          checkedValues: 30,
          verifier: "scripts/privacy-packet-capture-audit.mjs"
        }
      ]
    })
  );
  await write(
    root,
    "docs/security/scans/manifest.json",
    JSON.stringify({
      schemaVersion: "archcontext.security-scan-manifest/v1",
      scans: [
        {
          id: "production.security-scan",
          environment: "production",
          status: "verified",
          artifactPath: scanPath,
          artifactDigest: await digestFile(join(root, scanPath)),
          auditedAt: "2026-06-20T00:00:00.000Z",
          scanner: "external-security-scan",
          scope: "production-readback",
          critical: 0,
          high: 0
        }
      ]
    })
  );
}

function capture(url: string) {
  return {
    log: {
      version: "1.2",
      entries: [
        {
          request: {
            method: "POST",
            url,
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
