import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failureIssues } from "@archcontext/contracts";
import { runCli } from "../src/main";

/** The issue #427 shape: a superseded manifest with counts but no `targets` array. */
const SUPERSEDED = [
  "archcontext.architecture-docs-projection-manifest/v1",
  "archcontext.architecture-docs-projection-manifest/v2"
] as const;
const SUPPORTED = "archcontext.architecture-docs-projection-manifest/v3";
const MANIFEST_DIRECTORY = "docs/architecture";
const MIGRATION_DETAILS = {
  manifestPath: "docs/architecture/.projection-manifest.json",
  supportedSchemaVersion: SUPPORTED,
  upgradeCommand: "archctx docs apply --approved --profile <default|repo-harness/v1>",
  migrationGuide: "docs/runbooks/architecture-documentation-projections.md"
} as const;

type CliResult = { ok: boolean; requestId: string; error: any };

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-manifest-diagnostics-"));
  execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "ignore" });
  return root;
}

function writeManifest(root: string, body: Record<string, unknown>): void {
  mkdirSync(join(root, MANIFEST_DIRECTORY), { recursive: true });
  writeFileSync(join(root, MIGRATION_DETAILS.manifestPath), `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

/** Everything the fail-closed refusal must leave untouched: bytes, directory entries and Git status. */
function snapshot(root: string): Record<string, unknown> {
  return {
    manifest: readFileSync(join(root, MIGRATION_DETAILS.manifestPath), "utf8"),
    entries: readdirSync(join(root, MANIFEST_DIRECTORY)).sort(),
    modelPresent: existsSync(join(root, ".archcontext")),
    status: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })
  };
}

async function freshness(root: string): Promise<CliResult> {
  return await runCli("projection", ["freshness", "--json"], root) as unknown as CliResult;
}

test("a v1 or v2 manifest with targetCount/fileCount but no targets returns structured upgrade diagnostics without writes", async () => {
  for (const foundSchemaVersion of SUPERSEDED) {
    const root = fixture();
    try {
      // Exactly the reported shape: counts only, no targets array, and no model or docs to read.
      writeManifest(root, { schemaVersion: foundSchemaVersion, targetCount: 9, fileCount: 27 });
      const before = snapshot(root);

      const result = await freshness(root);
      expect(result.ok).toBe(false);
      expect(result.requestId).toBe("projection.freshness");
      expect(result.error).toEqual({
        code: "AC_PRECONDITION_FAILED",
        message: expect.stringContaining("re-baselining"),
        severity: "warning",
        retryable: true,
        action: "rebuild-plan",
        reasonCode: "projection-manifest-upgrade-required",
        details: {
          ...MIGRATION_DETAILS,
          foundSchemaVersion
        }
      });
      // The public details are a closed registered vocabulary, not free-form diagnostics.
      expect(failureIssues(result.error)).toEqual([]);
      // The refusal names the committed manifest and both formats without leaking the worktree.
      expect(result.error.details.manifestPath).toBe("docs/architecture/.projection-manifest.json");
      expect(JSON.stringify(result)).not.toContain(root);

      // Fail closed means zero writes: the manifest bytes, the docs directory and Git status hold.
      expect(snapshot(root)).toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("a malformed v3 manifest keeps the distinct invalid-contract refusal, never the upgrade hint", async () => {
  for (const body of [
    { schemaVersion: SUPPORTED, targetCount: 9, fileCount: 27 },
    { schemaVersion: SUPPORTED, targets: [] }
  ]) {
    const root = fixture();
    try {
      writeManifest(root, body);
      const before = snapshot(root);

      const result = await freshness(root);
      expect(result.ok).toBe(false);
      expect(result.error).toMatchObject({
        code: "AC_PRECONDITION_FAILED",
        reasonCode: "projection-manifest-invalid",
        action: "rebuild-plan",
        details: {}
      });
      // No upgrade facts: a v3 that fails its contract is a different repair, not a migration.
      for (const key of ["manifestPath", "foundSchemaVersion", "supportedSchemaVersion", "upgradeCommand", "migrationGuide"]) {
        expect(result.error.details).not.toHaveProperty(key);
      }
      expect(failureIssues(result.error)).toEqual([]);
      expect(snapshot(root)).toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("the two refusals stay separate: upgrade-required names both schemas, invalid names none", async () => {
  const upgradeRoot = fixture();
  const invalidRoot = fixture();
  try {
    writeManifest(upgradeRoot, { schemaVersion: SUPERSEDED[0], targetCount: 9, fileCount: 27 });
    writeManifest(invalidRoot, { schemaVersion: SUPPORTED, targets: [] });
    const upgrade = await freshness(upgradeRoot);
    const invalid = await freshness(invalidRoot);
    expect(upgrade.error.reasonCode).toBe("projection-manifest-upgrade-required");
    expect(invalid.error.reasonCode).toBe("projection-manifest-invalid");
    expect(upgrade.error.reasonCode).not.toBe(invalid.error.reasonCode);
    expect(upgrade.error.details.foundSchemaVersion).toBe(SUPERSEDED[0]);
    expect(invalid.error.details).toEqual({});
  } finally {
    rmSync(upgradeRoot, { recursive: true, force: true });
    rmSync(invalidRoot, { recursive: true, force: true });
  }
});
