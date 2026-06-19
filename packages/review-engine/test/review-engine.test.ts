import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateJsonSchema } from "../../contracts/src/index";
import { completeTaskGate } from "../src/index";

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
});
