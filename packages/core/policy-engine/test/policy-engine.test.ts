import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertAllowedArchContextPath, evaluateChangeSetPaths, validateCompatibilityContract } from "../src/index";

describe("@archcontext/core/policy-engine", () => {
  test("requires durable compatibility contract fields", () => {
    expect(validateCompatibilityContract()).toContainEqual(
      expect.objectContaining({ id: "compatibility-contract-required", severity: "error" })
    );
    expect(validateCompatibilityContract({ reason: "just in case" }).map((finding) => finding.id)).toContain(
      "compatibility-reason"
    );
    expect(
      validateCompatibilityContract({
        kind: "external-contract",
        reason: "mobile app version 2.1 still consumes this route",
        owner: "team.billing",
        consumers: ["mobile-app"],
        removalConditions: ["mobile app 2.1 unsupported"],
        reviewAt: "2026-07-01"
      })
    ).toEqual([]);
  });

  test("allows only repo-relative ArchContext paths", () => {
      const root = mkdtempSync(join(tmpdir(), "archctx-policy-"));
      try {
        expect(() => assertAllowedArchContextPath(root, ".archcontext/policies/review.yaml")).not.toThrow();
        expect(() => assertAllowedArchContextPath(root, ".archcontext/practices/compatibility.yaml")).not.toThrow();
        expect(evaluateChangeSetPaths(root, ["src/app.ts"])[0].id).toBe("path-denied:src/app.ts");
        expect(() => assertAllowedArchContextPath(root, "../escape.yaml")).toThrow("Repository path");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
