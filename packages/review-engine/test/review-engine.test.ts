import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateJsonSchema } from "../../contracts/src/index";
import { completeTaskGate, reviewCrossRepoLandscape } from "../src/index";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sha = `sha256:${"a".repeat(64)}`;

function readJson(path: string) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

describe("@archcontext/review-engine", () => {
  test("returns schema-valid pass results for fresh completed work", () => {
    const result = completeTaskGate({
      taskSessionId: "task.test",
      posture: "normal",
      headSha: "abc",
      currentHeadSha: "abc",
      worktreeDigest: sha,
      modelDigest: sha,
      codeFactsDigest: sha
    });

    expect(result.result).toBe("pass");
    expect(result.extensions.digest).toMatch(/^sha256:/);
    expect(validateJsonSchema(readJson("schemas/runtime/review-result.schema.json") as any, result as any).valid).toBe(true);
  });

  test("fails stale context and unjustified compatibility paths", () => {
    const result = completeTaskGate({
      taskSessionId: "task.test",
      posture: "structural",
      headSha: "old",
      currentHeadSha: "new",
      worktreeDigest: sha,
      modelDigest: sha,
      codeFactsDigest: sha,
      compatibilityPathIntroduced: true,
      compatibilityContract: { reason: "just in case" },
      cleanupRequired: 2,
      cleanupCompleted: 1
    });

    expect(result.result).toBe("fail_action_required");
    expect(result.summary.errors).toBeGreaterThanOrEqual(4);
    expect(result.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(["stale-context", "compatibility-reason", "cleanup-incomplete"])
    );
  });

  test("reviews cross-repo landscape drift and pressure", () => {
    const relation = {
      schemaVersion: "archcontext.cross-repo-relation/v1" as const,
      id: "relation.web-calls-api",
      kind: "calls" as const,
      source: { repositoryId: "repo.web", nodeId: "module.checkout-ui" },
      target: { repositoryId: "repo.api", nodeId: "module.billing-api" },
      via: { kind: "interface" as const, id: "interface.billing-http" },
      intent: "checkout to billing"
    };
    const result = reviewCrossRepoLandscape({
      landscape: {
        schemaVersion: "archcontext.landscape/v1",
        id: "landscape.product",
        name: "Product",
        repositories: [{ repositoryId: "repo.web", numericRepositoryId: 1001, name: "web", role: "frontend" }],
        relations: [relation.id],
        syncPolicy: { mode: "git-worktree-only", archcontextSyncService: "forbidden" }
      },
      relations: [relation]
    });
    expect(result.result).toBe("fail_action_required");
    expect(result.findings.map((finding) => finding.type)).toContain("landscape-invalid");
  });
});
