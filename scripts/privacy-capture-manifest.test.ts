import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { digestFile } from "./privacy-capture-lib.mjs";
import { readbackManifest } from "./privacy-capture-manifest.mjs";

describe("privacy-capture-manifest", () => {
  test("default readback verifies fixture captures while leaving external captures pending", async () => {
    await withCaptureFixture(async (root, fixtureDigest) => {
      await writeManifest(root, [
        verifiedCapture("fixture.metadata-only", "fixture", "docs/security/captures/metadata-only.har.json", fixtureDigest),
        {
          id: "production.real-capture",
          environment: "production",
          status: "pending",
          artifactPath: "docs/security/captures/production-redacted.har.json",
          verifier: "scripts/privacy-packet-capture-audit.mjs"
        }
      ]);

      await expect(readbackManifest({ root })).resolves.toMatchObject({
        ok: true,
        verified: 1,
        pending: 1,
        externalVerified: 0
      });
    });
  });

  test("strict external readback rejects fixture-only evidence", async () => {
    await withCaptureFixture(async (root, fixtureDigest) => {
      await writeManifest(root, [
        verifiedCapture("fixture.metadata-only", "fixture", "docs/security/captures/metadata-only.har.json", fixtureDigest),
        {
          id: "staging.real-capture",
          environment: "staging",
          status: "pending",
          artifactPath: "docs/security/captures/staging-redacted.har.json",
          verifier: "scripts/privacy-packet-capture-audit.mjs"
        }
      ]);

      await expect(readbackManifest({ root, requireExternal: true })).resolves.toMatchObject({
        ok: false,
        verified: 1,
        pending: 1,
        externalVerified: 0,
        failures: ["missing verified staging or production capture"]
      });
    });
  });

  test("strict production readback accepts a verified redacted production capture", async () => {
    await withCaptureFixture(async (root, fixtureDigest, productionDigest) => {
      await writeManifest(root, [
        verifiedCapture("fixture.metadata-only", "fixture", "docs/security/captures/metadata-only.har.json", fixtureDigest),
        verifiedCapture("production.real-capture", "production", "docs/security/captures/production-redacted.har.json", productionDigest)
      ]);

      await expect(readbackManifest({ root, requireEnvironment: "production" })).resolves.toMatchObject({
        ok: true,
        verified: 2,
        pending: 0,
        externalVerified: 1,
        failures: []
      });
    });
  });
});

async function withCaptureFixture(run: (root: string, fixtureDigest: string, productionDigest: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "archctx-capture-manifest-"));
  try {
    const fixturePath = "docs/security/captures/metadata-only.har.json";
    const productionPath = "docs/security/captures/production-redacted.har.json";
    await write(root, fixturePath, JSON.stringify(capture("https://archcontext.test/attestations/verify")));
    await write(root, productionPath, JSON.stringify(capture("https://archcontext.dev/attestations/verify")));
    await run(root, await digestFile(join(root, fixturePath)), await digestFile(join(root, productionPath)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function verifiedCapture(id: string, environment: string, artifactPath: string, captureDigest: string) {
  return {
    id,
    environment,
    status: "verified",
    artifactPath,
    captureDigest,
    auditedAt: "2026-06-20T00:00:00.000Z",
    entries: 1,
    checkedValues: 16,
    verifier: "scripts/privacy-packet-capture-audit.mjs"
  };
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

async function writeManifest(root: string, captures: unknown[]) {
  await write(
    root,
    "docs/security/captures/manifest.json",
    JSON.stringify({ schemaVersion: "archcontext.privacy-capture-manifest/v1", captures }, null, 2)
  );
}

async function write(root: string, path: string, content: string) {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${content}\n`, "utf8");
}
