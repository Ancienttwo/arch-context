import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stableYaml } from "@archcontext/contracts";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { declareOptionalCodeFacts } from "@archcontext/local-runtime/test/codegraph-factories";
import { buildArchitectureDocsProjection, runProjectionFreshnessCommand } from "../src/projection-service";

function git(root: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

test("an empty changed-path list is the whole-tree form: it reports a stale tree exactly as an unscoped run does (#327)", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-freshness-empty-scope-"));
  try {
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
