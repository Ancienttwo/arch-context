import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson } from "@archcontext/contracts";
import { ChangeSetEngine } from "@archcontext/core/changeset-engine";
import { initializeArchContextModel, planGeneratedProjection, YamlModelStore } from "../src/index";

const NODE_PATH = ".archcontext/model/nodes/module.api.yaml";
const NODE_BODY = "schemaVersion: archcontext.node/v2\nid: module.api\nkind: module\nname: API\nstatus: active\nparent: capability.architecture-context\nsummary: Serves API requests.\n";
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
      writeAdr(root, ["module.api", "capability.architecture-context"]);
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
