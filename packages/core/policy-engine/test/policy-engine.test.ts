import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDependencyConstraints } from "@archcontext/core/architecture-domain";
import type { Json } from "@archcontext/contracts";
import {
  assertAllowedArchContextPath,
  evaluateChangeSetPaths,
  validateCompatibilityContract,
  type ArchContextPathScope
} from "../src/index";

describe("forbid-dependency exemption declarations", () => {
  const nodes = [
    ["module.consumer"], ["capability.runtime"], ["module.runtime", "capability.runtime"],
    ["component.runtime.contract", "module.runtime"], ["component.runtime.contract-lookalike", "module.consumer"]
  ].map(([id, parent]) => ({
    path: `.archcontext/model/nodes/${id}.yaml`,
    body: JSON.stringify({ schemaVersion: "archcontext.node/v2", id, parent })
  }));

  function read(allowedTargets: Json) {
    return readDependencyConstraints([...nodes, {
      path: ".archcontext/model/constraints/constraint.public-contract.yaml",
      body: JSON.stringify({
        schemaVersion: "archcontext.constraint/v1", id: "constraint.public-contract", severity: "error",
        scope: { nodes: ["module.consumer"] },
        rule: { type: "forbid-dependency", targets: ["capability.runtime"], allowedTargets }
      })
    }]);
  }

  test("accepts a contract connected to a forbidden target by a transitive parent chain", () => {
    const allowedTargets = ["component.runtime.contract", "module.runtime"];
    expect(read(allowedTargets)).toMatchObject({
      errors: [],
      constraints: [{ rule: { type: "forbid-dependency", targets: ["capability.runtime"], allowedTargets } }]
    });
  });

  test.each([
    ["empty list", [], "non-empty list of unique node ids"],
    ["duplicate", ["component.runtime.contract", "component.runtime.contract"], "unique node ids"],
    ["wildcard", ["component.runtime.*"], "unique node ids"],
    ["missing node", ["component.runtime.missing"], "references unknown node"],
    ["target itself", ["capability.runtime"], "strict descendant"],
    ["unrelated node with a similar ID", ["component.runtime.contract-lookalike"], "strict descendant"]
  ] satisfies [string, Json, string][])("rejects a %s in allowedTargets", (_label, allowedTargets, error) => {
    const result = read(allowedTargets);
    expect(result.constraints).toEqual([]);
    expect(result.errors).toEqual(result.allowedTargetErrors);
    expect(result.errors).toEqual([expect.stringContaining(error)]);
  });
});

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
        expect(() => assertAllowedArchContextPath(root, "docs/architecture/index.md")).not.toThrow();
        expect(() => assertAllowedArchContextPath(root, "docs/architecture/modules/module-runtime.md")).not.toThrow();
        expect(evaluateChangeSetPaths(root, ["src/app.ts"])[0].id).toBe("path-denied:src/app.ts");
        expect(() => assertAllowedArchContextPath(root, "../escape.yaml")).toThrow("Repository path");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects an allowlisted path whose existing parent symlink escapes the repository", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-policy-symlink-root-"));
    const outside = mkdtempSync(join(tmpdir(), "archctx-policy-symlink-outside-"));
    try {
      mkdirSync(join(root, ".archcontext"), { recursive: true });
      symlinkSync(outside, join(root, ".archcontext/policies"), "dir");
      expect(() => assertAllowedArchContextPath(root, ".archcontext/policies/escaped.yaml"))
        .toThrow("Path escapes repository through symlink");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  describe("agent-context scoped widening", () => {
    const scoped = (...paths: string[]): ArchContextPathScope => ({
      operation: "agent-context",
      agentContextPaths: new Set(paths)
    });

    test("widens only for the agent-context operation, and only for the derived path set", () => {
      const root = mkdtempSync(join(tmpdir(), "archctx-policy-agent-context-"));
      const target = "packages/core/policy-engine/CLAUDE.md";
      try {
        // No scope at all, and the default operation, stay on the base allowlist.
        expect(() => assertAllowedArchContextPath(root, target)).toThrow("Path is outside ArchContext write allowlist");
        expect(() => assertAllowedArchContextPath(root, target, { operation: "default", agentContextPaths: new Set([target]) }))
          .toThrow("Path is outside ArchContext write allowlist");
        // Scoped, and inside the derived set: allowed.
        expect(() => assertAllowedArchContextPath(root, target, scoped(target))).not.toThrow();
        // Scoped, but outside the derived set: still denied.
        expect(() => assertAllowedArchContextPath(root, "packages/core/changeset-engine/CLAUDE.md", scoped(target)))
          .toThrow("Path is outside ArchContext write allowlist");
        // The base allowlist is untouched by a scope.
        expect(evaluateChangeSetPaths(root, ["src/app.ts"], scoped(target))[0].id).toBe("path-denied:src/app.ts");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("root contracts require exact operation scope, and neighbours remain forbidden", () => {
      const root = mkdtempSync(join(tmpdir(), "archctx-policy-agent-context-guard-"));
      try {
        // Root content/hash validation belongs to ChangeSetEngine; path scope alone is not write authorization.
        expect(() => assertAllowedArchContextPath(root, "CLAUDE.md", scoped("CLAUDE.md"))).not.toThrow();
        expect(() => assertAllowedArchContextPath(root, "AGENTS.md", scoped("AGENTS.md"))).not.toThrow();
        expect(() => assertAllowedArchContextPath(root, "AGENTS.md")).toThrow("allowlist");
        // A scoped set that names a non-contract file in an allowed directory is still denied.
        expect(() => assertAllowedArchContextPath(root, "packages/core/policy-engine/NOTES.md", scoped("packages/core/policy-engine/NOTES.md")))
          .toThrow("Path is outside ArchContext write allowlist");
        expect(() => assertAllowedArchContextPath(root, "packages/core/policy-engine/CLAUDE.md.bak", scoped("packages/core/policy-engine/CLAUDE.md.bak")))
          .toThrow("Path is outside ArchContext write allowlist");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("a scoped path still fails the symlink escape check", () => {
      const root = mkdtempSync(join(tmpdir(), "archctx-policy-agent-context-symlink-"));
      const outside = mkdtempSync(join(tmpdir(), "archctx-policy-agent-context-outside-"));
      const target = "packages/core/policy-engine/CLAUDE.md";
      try {
        mkdirSync(join(root, "packages/core"), { recursive: true });
        symlinkSync(outside, join(root, "packages/core/policy-engine"), "dir");
        expect(() => assertAllowedArchContextPath(root, target, scoped(target)))
          .toThrow("Path escapes repository through symlink");
        expect(() => assertAllowedArchContextPath(root, "../escape/CLAUDE.md", scoped("../escape/CLAUDE.md")))
          .toThrow("Repository path");
      } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });
});

describe("refactor decision write scope (ADR-0046)", () => {
  test("only the refactor-decision scope grants exactly one decision file path", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-policy-decision-"));
    try {
      const path = ".archcontext/refactor-decisions/recommendation.0123456789abcdef.json";
      const scope = (operation: "default" | "refactor-decision") => ({ operation, agentContextPaths: new Set<string>() });
      expect(() => assertAllowedArchContextPath(root, path)).toThrow("outside ArchContext write allowlist");
      expect(() => assertAllowedArchContextPath(root, path, scope("default"))).toThrow("outside ArchContext write allowlist");
      expect(() => assertAllowedArchContextPath(root, path, scope("refactor-decision"))).not.toThrow();
      for (const other of [
        ".archcontext/refactor-decisions/notes.md",
        ".archcontext/refactor-decisions/recommendation.0123.json",
        ".archcontext/refactor-decisions/nested/recommendation.0123456789abcdef.json",
        ".archcontext/manifest.yaml"
      ]) {
        expect(() => assertAllowedArchContextPath(root, other, scope("refactor-decision")), other).toThrow();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
