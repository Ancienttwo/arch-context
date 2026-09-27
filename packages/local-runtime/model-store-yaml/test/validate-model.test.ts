import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REVIEW_FAIL_ON_CATEGORIES, digestJson } from "@archcontext/contracts";
import { ChangeSetEngine } from "@archcontext/core/changeset-engine";
import { CONSTRAINT_RULE_TYPES, readDependencyConstraints, readReviewPolicy } from "@archcontext/core/architecture-domain";
import { initializeArchContextModel, listModelFiles, planGeneratedProjection, YamlModelStore } from "../src/index";

const NODE_PATH = ".archcontext/model/nodes/module.api.yaml";
const NODE_BODY = "schemaVersion: archcontext.node/v2\nid: module.api\nkind: module\nname: API\nstatus: active\nparent: capability.architecture.context\nsummary: Serves API requests.\n";
const ADR_PATH = "docs/adr/ADR-0001-api-boundary.md";
const digest = `sha256:${"a".repeat(64)}`;

function modelRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-validate-"));
  initializeArchContextModel(root, "Validate Test");
  writeFileSync(join(root, NODE_PATH), NODE_BODY, "utf8");
  return root;
}

function writeAdr(root: string, appliesTo: string[]): void {
  mkdirSync(join(root, "docs/adr"), { recursive: true });
  writeFileSync(join(root, ADR_PATH), [
    "---",
    "schemaVersion: archcontext.adr/v1",
    "id: adr.0001.api-boundary",
    "title: API Boundary",
    "status: accepted",
    "decidedAt: 2026-09-25",
    "appliesTo:",
    ...appliesTo.map((id) => `  - ${id}`),
    "supersedes: []",
    "---",
    "",
    "# API Boundary",
    ""
  ].join("\n"), "utf8");
}

function validate(root: string) {
  return new YamlModelStore().validateModel({ root, repositoryId: "repo.test", headSha: "abc" });
}

describe("YamlModelStore ADR appliesTo integrity (#163)", () => {
  test("ADR appliesTo ids that resolve to model nodes validate", async () => {
    const root = modelRoot();
    try {
      writeAdr(root, ["module.api", "capability.architecture.context"]);
      expect(await validate(root)).toMatchObject({ valid: true, errors: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an unknown appliesTo id fails validation and names the ADR file", async () => {
    const root = modelRoot();
    try {
      writeAdr(root, ["module.api", "package.bogus"]);
      const result = await validate(root);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([`${ADR_PATH}: ADR appliesTo references unknown node package.bogus`]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a repository without an ADR directory still validates", async () => {
    const root = modelRoot();
    try {
      expect(existsSync(join(root, "docs/adr"))).toBe(false);
      expect(await validate(root)).toMatchObject({ valid: true, errors: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a ChangeSet deleting a node that an ADR references rolls back", async () => {
    const root = modelRoot();
    try {
      writeAdr(root, ["module.api"]);
      expect((await validate(root)).valid).toBe(true);
      const engine = new ChangeSetEngine({ modelStore: new YamlModelStore(), projection: { planGeneratedProjection } });
      const draft = engine.approve(engine.plan({
        id: "changeset.delete-referenced-node",
        base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
        reason: { taskSessionId: "task.test" },
        operations: [{ op: "delete_entity", path: NODE_PATH, expectedHash: digestJson({ body: NODE_BODY }) }]
      }));

      await expect(engine.apply(root, draft)).rejects.toThrow(
        `ChangeSet model validation failed after apply: ${ADR_PATH}: ADR appliesTo references unknown node module.api`
      );
      expect(readFileSync(join(root, NODE_PATH), "utf8")).toBe(NODE_BODY);
      expect((await validate(root)).valid).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a ChangeSet restoring a hand-deleted referenced node is not blocked by the dangling reference", async () => {
    const root = modelRoot();
    try {
      writeAdr(root, ["module.api"]);
      rmSync(join(root, NODE_PATH));
      const broken = await validate(root);
      const dangling = `${ADR_PATH}: ADR appliesTo references unknown node module.api`;
      expect(broken).toMatchObject({ valid: false, errors: [dangling], referenceErrors: [dangling] });

      const engine = new ChangeSetEngine({ modelStore: new YamlModelStore(), projection: { planGeneratedProjection } });
      const unrelated = engine.approve(engine.plan({
        id: "changeset.unrelated-write",
        base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
        reason: { taskSessionId: "task.test" },
        operations: [{ op: "write_policy", path: ".archcontext/policies/extra.yaml", expectedHash: "missing", body: "schemaVersion: archcontext.policy/v1\nid: policy.extra\n" }]
      }));
      // A change that leaves the reference dangling is still rejected on the after-apply model.
      await expect(engine.apply(root, unrelated)).rejects.toThrow(`ChangeSet model validation failed after apply: ${dangling}`);
      expect(existsSync(join(root, ".archcontext/policies/extra.yaml"))).toBe(false);

      const restore = engine.approve(engine.plan({
        id: "changeset.restore-referenced-node",
        base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
        reason: { taskSessionId: "task.test" },
        operations: [{ op: "create_entity", path: NODE_PATH, expectedHash: "missing", body: NODE_BODY }]
      }));
      expect((await engine.apply(root, restore)).status).toBe("applied");
      expect(readFileSync(join(root, NODE_PATH), "utf8")).toBe(NODE_BODY);
      expect(await validate(root)).toMatchObject({ valid: true, errors: [] });
      expect((await validate(root)).referenceErrors).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a ChangeSet on a base model with a malformed ADR appliesTo is rejected before apply", async () => {
    const root = modelRoot();
    try {
      mkdirSync(join(root, "docs/adr"), { recursive: true });
      writeFileSync(join(root, ADR_PATH), "---\nschemaVersion: archcontext.adr/v1\nid: adr.0001.api-boundary\nappliesTo: |\n  module.api\n---\n", "utf8");
      const malformed = `${ADR_PATH}: ADR appliesTo must be a list of node ids`;
      const result = await validate(root);
      expect(result).toMatchObject({ valid: false, errors: [malformed] });
      expect(result.referenceErrors).toBeUndefined();

      const engine = new ChangeSetEngine({ modelStore: new YamlModelStore(), projection: { planGeneratedProjection } });
      const draft = engine.approve(engine.plan({
        id: "changeset.on-malformed-adr",
        base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
        reason: { taskSessionId: "task.test" },
        operations: [{ op: "write_policy", path: ".archcontext/policies/extra.yaml", expectedHash: "missing", body: "schemaVersion: archcontext.policy/v1\nid: policy.extra\n" }]
      }));
      await expect(engine.apply(root, draft)).rejects.toThrow(`ChangeSet model validation failed before apply: ${malformed}`);
      expect(existsSync(join(root, ".archcontext/policies/extra.yaml"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a ChangeSet on a base model with non-reference errors is still rejected before apply", async () => {
    const root = modelRoot();
    try {
      writeFileSync(join(root, ".archcontext/model/nodes/broken.yaml"), "id: broken\n", "utf8");
      const engine = new ChangeSetEngine({ modelStore: new YamlModelStore(), projection: { planGeneratedProjection } });
      const draft = engine.approve(engine.plan({
        id: "changeset.on-broken-base",
        base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
        reason: { taskSessionId: "task.test" },
        operations: [{ op: "write_policy", path: ".archcontext/policies/extra.yaml", expectedHash: "missing", body: "schemaVersion: archcontext.policy/v1\nid: policy.extra\n" }]
      }));
      await expect(engine.apply(root, draft)).rejects.toThrow("ChangeSet model validation failed before apply: .archcontext/model/nodes/broken.yaml");
      expect(existsSync(join(root, ".archcontext/policies/extra.yaml"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const CONSTRAINT_PATH = ".archcontext/model/constraints/constraint.api-not-capability.yaml";

function writeConstraint(root: string, overrides: Record<string, unknown> = {}): void {
  mkdirSync(join(root, ".archcontext/model/constraints"), { recursive: true });
  writeFileSync(join(root, CONSTRAINT_PATH), `${JSON.stringify({
    schemaVersion: "archcontext.constraint/v1",
    id: "constraint.api-not-capability",
    name: "API does not reach up",
    severity: "error",
    scope: { nodes: ["module.api"] },
    rule: { type: "forbid-dependency", targets: ["capability.architecture.context"] },
    rationale: "fixture",
    ...overrides
  }, null, 2)}\n`, "utf8");
}

describe("YamlModelStore dependency constraint and review policy integrity (#163)", () => {
  test("a fresh init writes the full review policy and no manifest failOn, and validates without warnings", async () => {
    const root = modelRoot();
    try {
      expect(readFileSync(join(root, ".archcontext/manifest.yaml"), "utf8")).not.toContain("failOn");
      expect(readFileSync(join(root, ".archcontext/policies/review.yaml"), "utf8")).toContain("prohibited-dependency");
      const result = await validate(root);
      expect(result).toMatchObject({ valid: true, errors: [] });
      expect(result.warnings).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a forbid-dependency constraint over known nodes validates", async () => {
    const root = modelRoot();
    try {
      writeConstraint(root);
      expect(await validate(root)).toMatchObject({ valid: true, errors: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("unknown scope or target nodes are reference errors", async () => {
    const root = modelRoot();
    try {
      writeConstraint(root, { scope: { nodes: ["module.ghost"] }, rule: { type: "forbid-dependency", targets: ["module.api"] } });
      const result = await validate(root);
      const error = `${CONSTRAINT_PATH}: constraint scope.nodes references unknown node module.ghost`;
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([error]);
      expect(result.referenceErrors).toEqual([error]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("empty targets are an error", async () => {
    const root = modelRoot();
    try {
      writeConstraint(root, { rule: { type: "forbid-dependency", targets: [] } });
      const result = await validate(root);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([`${CONSTRAINT_PATH}: rule.targets must be a non-empty list of node ids`]);
      expect(result.referenceErrors).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("allowedVia is schema-valid: it validates with a not-enforced warning and the constraint is still evaluated", async () => {
    const root = modelRoot();
    try {
      writeConstraint(root, { allowedVia: ["module.api"] });
      const result = await validate(root);
      expect(result).toMatchObject({ valid: true, errors: [] });
      expect(result.warnings).toEqual([
        `${CONSTRAINT_PATH}: constraint constraint.api-not-capability allowedVia is not enforced yet; the constraint is evaluated as if it were absent`
      ]);
      expect(readDependencyConstraints(listModelFiles(root)).constraints.map((constraint) => constraint.id)).toEqual(["constraint.api-not-capability"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a misspelled or missing rule.type is an error, and a known non-dependency type is not gated", async () => {
    const root = modelRoot();
    try {
      writeConstraint(root, { rule: { type: "forbid-dependecy", targets: ["module.api"] } });
      expect((await validate(root)).errors).toEqual([
        `${CONSTRAINT_PATH}: rule.type must be one of ${CONSTRAINT_RULE_TYPES.join(", ")} (got "forbid-dependecy")`
      ]);

      writeConstraint(root, { rule: { targets: ["module.api"] } });
      expect((await validate(root)).errors).toEqual([`${CONSTRAINT_PATH}: rule.type must be one of ${CONSTRAINT_RULE_TYPES.join(", ")}`]);

      writeConstraint(root, { rule: { type: "require-owner" } });
      expect(await validate(root)).toMatchObject({ valid: true, errors: [] });
      expect(readDependencyConstraints(listModelFiles(root)).constraints).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the rule.type list mirrors constraint.schema.json exactly", () => {
    const schema = JSON.parse(readFileSync(join(import.meta.dir, "../../../../schemas/repo/constraint.schema.json"), "utf8"));
    expect([...CONSTRAINT_RULE_TYPES]).toEqual(schema.properties.rule.properties.type.enum);
  });

  test("a policy with the wrong identity or an empty failOn is rejected and falls back to every category", async () => {
    const root = modelRoot();
    try {
      const policyPath = join(root, ".archcontext/policies/review.yaml");
      for (const [body, expected] of [
        ["schemaVersion: archcontext.policy/v0\nid: policy.review\nfailOn: []\n", [
          ".archcontext/policies/review.yaml: schemaVersion must be archcontext.policy/v1 (got \"archcontext.policy/v0\")",
          ".archcontext/policies/review.yaml: failOn must be a non-empty list of categories (incomplete-intervention, invalid-schema, prohibited-dependency, stale-context, unjustified-compatibility)"
        ]],
        ["id: policy.review\nfailOn: [\"invalid-schema\"]\n", [
          ".archcontext/policies/review.yaml: missing schemaVersion",
          ".archcontext/policies/review.yaml: schemaVersion must be archcontext.policy/v1"
        ]],
        ["schemaVersion: archcontext.policy/v1\nid: policy.other\nfailOn: [\"stale-context\"]\n", [".archcontext/policies/review.yaml: id must be policy.review (got \"policy.other\")"]]
      ] as const) {
        writeFileSync(policyPath, body, "utf8");
        const result = await validate(root);
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual([...expected]);
        expect(readReviewPolicy(listModelFiles(root)).policy).toEqual({ failOn: [...REVIEW_FAIL_ON_CATEGORIES], source: "default" });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a repeated constraint id is an error naming both files", async () => {
    const root = modelRoot();
    try {
      writeConstraint(root);
      const copy = ".archcontext/model/constraints/constraint.copy.yaml";
      writeFileSync(join(root, copy), readFileSync(join(root, CONSTRAINT_PATH), "utf8"), "utf8");
      const result = await validate(root);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([`${copy}: duplicate constraint id constraint.api-not-capability (also declared in ${CONSTRAINT_PATH})`]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("schema severities map onto the gate's two levels; anything else is an error", async () => {
    const root = modelRoot();
    try {
      for (const [declared, gate] of [["critical", "error"], ["error", "error"], ["warning", "warning"], ["notice", "warning"]] as const) {
        writeConstraint(root, { severity: declared });
        expect(await validate(root)).toMatchObject({ valid: true, errors: [] });
        const read = readDependencyConstraints(listModelFiles(root));
        expect(read.constraints.map((constraint) => constraint.severity)).toEqual([gate]);
      }
      writeConstraint(root, { severity: "fatal" });
      expect((await validate(root)).errors).toEqual([`${CONSTRAINT_PATH}: severity must be one of notice, warning, error, critical`]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an unknown failOn category is an error", async () => {
    const root = modelRoot();
    try {
      writeFileSync(join(root, ".archcontext/policies/review.yaml"), "schemaVersion: archcontext.policy/v1\nid: policy.review\nfailOn: [\"invalid-schema\", \"boundary-health\"]\n", "utf8");
      const result = await validate(root);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        ".archcontext/policies/review.yaml: unknown failOn category boundary-health (expected one of incomplete-intervention, invalid-schema, prohibited-dependency, stale-context, unjustified-compatibility)"
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a legacy manifest review.failOn is a warning naming what the policy does not enforce", async () => {
    const root = modelRoot();
    try {
      const manifestPath = join(root, ".archcontext/manifest.yaml");
      writeFileSync(manifestPath, `${readFileSync(manifestPath, "utf8")}review:\n  failOn:\n    - "prohibited-dependency"\n    - "stale-context"\n`, "utf8");
      writeFileSync(join(root, ".archcontext/policies/review.yaml"), "schemaVersion: archcontext.policy/v1\nid: policy.review\nfailOn: [\"stale-context\"]\n", "utf8");
      const result = await validate(root);
      expect(result).toMatchObject({ valid: true, errors: [] });
      expect(result.warnings).toEqual([
        ".archcontext/manifest.yaml: review.failOn is ignored; .archcontext/policies/review.yaml failOn is the single review policy source; not enforced by the policy: prohibited-dependency"
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
