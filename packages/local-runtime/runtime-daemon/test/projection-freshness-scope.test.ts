import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH, architectureDocsProjectionManifestSourceStamps, stableYaml } from "@archcontext/contracts";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { declareOptionalCodeFacts } from "@archcontext/local-runtime/test/codegraph-factories";
import { buildArchitectureDocsProjection, runProjectionFreshnessCommand } from "../src/projection-service";

function git(root: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

/** A committed repository with one declared capability and its committed architecture projection. */
function projectedFixture(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, "app/src"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# freshness fixture\n", "utf8");
  writeFileSync(join(root, "app/src/index.ts"), "export const app = 1;\n", "utf8");
  initializeArchContextModel(root, "Freshness Scope App");
  declareOptionalCodeFacts(root);
  writeFileSync(join(root, ".archcontext/model/nodes/capability.app.yaml"), stableYaml({
    schemaVersion: "archcontext.node/v2",
    id: "capability.app",
    kind: "capability",
    name: "App",
    status: "active",
    summary: "Serves the application.",
    source: { include: ["app/**"] }
  }), "utf8");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
  for (const file of buildArchitectureDocsProjection(undefined, root).files) {
    mkdirSync(dirname(join(root, file.path)), { recursive: true });
    writeFileSync(join(root, file.path), file.body, "utf8");
  }
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "project architecture documentation");
  return root;
}

test("a superseded manifest and an invalid current-format manifest fail closed with the typed preconditions check uses (#327)", () => {
  const root = projectedFixture("archctx-freshness-manifest-refusals-");
  try {
    const manifestPath = join(root, ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH);
    const committed = readFileSync(manifestPath, "utf8");
    expect(runProjectionFreshnessCommand(root).ok).toBe(true);

    for (const schemaVersion of ["archcontext.architecture-docs-projection-manifest/v1", "archcontext.architecture-docs-projection-manifest/v2"]) {
      writeFileSync(manifestPath, `${JSON.stringify({ ...JSON.parse(committed), schemaVersion })}\n`, "utf8");
      for (const options of [{}, { changedPaths: ["app/src/index.ts"] }]) {
        const refused = runProjectionFreshnessCommand(root, options);
        expect(refused.ok, JSON.stringify(refused)).toBe(false);
        expect((refused as any).error).toMatchObject({ code: "AC_PRECONDITION_FAILED", reasonCode: "projection-manifest-upgrade-required" });
      }
    }

    // A current-format manifest whose stamp is not a digest is refused when read, never evaluated.
    const stamp = architectureDocsProjectionManifestSourceStamps(JSON.parse(committed))["capability.app"]!;
    expect(stamp).toMatch(/^sha256:[0-9a-f]{64}$/);
    writeFileSync(manifestPath, committed.replace(stamp, "7415329"), "utf8");
    for (const options of [{}, { changedPaths: ["app/src/index.ts"] }]) {
      const refused = runProjectionFreshnessCommand(root, options);
      expect(refused.ok, JSON.stringify(refused)).toBe(false);
      expect((refused as any).error).toMatchObject({ code: "AC_PRECONDITION_FAILED", reasonCode: "projection-manifest-invalid" });
    }

    // Nothing was rewritten: the refusals read only.
    writeFileSync(manifestPath, committed, "utf8");
    expect(runProjectionFreshnessCommand(root).ok).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 120_000);

test("an empty changed-path list is the whole-tree form: it reports a stale tree exactly as an unscoped run does (#327)", () => {
  const root = projectedFixture("archctx-freshness-empty-scope-");
  try {
    const fresh = runProjectionFreshnessCommand(root);
    expect(fresh.ok, JSON.stringify(fresh)).toBe(true);
    expect((fresh.data as any).freshness).toEqual({ ok: true, reasonCodes: [], staleNodes: [] });
    expect(runProjectionFreshnessCommand(root, { changedPaths: [] })).toEqual(fresh);

    writeFileSync(join(root, "app/src/index.ts"), "export const app = 2;\n", "utf8");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "change the declared footprint");

    const unscoped = runProjectionFreshnessCommand(root);
    expect(unscoped.ok, JSON.stringify(unscoped)).toBe(true);
    const unscopedData = unscoped.data as any;
    expect(unscopedData.freshness.ok).toBe(false);
    expect(unscopedData.freshness.staleNodes.map((entry: { nodeId: string }) => entry.nodeId)).toContain("capability.app");
    expect(unscopedData.changedPaths).toEqual([]);
    expect(runProjectionFreshnessCommand(root, { changedPaths: [] })).toEqual(unscoped);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 120_000);
