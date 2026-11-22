import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  digestJson,
  FailureError,
  knownFailure,
  validateJsonSchema
} from "@archcontext/contracts";
import { initializeArchContextModel, planGeneratedProjection, YamlModelStore } from "../../../local-runtime/model-store-yaml/src/index";
import {
  ChangeSetEngine,
  type ChangeSetDraft,
  type ChangeSetJournalFile,
  type ChangeSetJournalPort
} from "../src/index";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const digest = `sha256:${"a".repeat(64)}`;

function readJson(path: string) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function tempModelRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "archctx-changeset-"));
  initializeArchContextModel(dir, "ChangeSet Test");
  return dir;
}

function yamlChangeSetEngine(journal?: ChangeSetJournalPort): ChangeSetEngine {
  return new ChangeSetEngine({
    modelStore: new YamlModelStore(),
    projection: { planGeneratedProjection },
    journal
  });
}

describe("@archcontext/core/changeset-engine", () => {
  test("plans schema-valid changesets and previews allowlist findings", () => {
    const engine = new ChangeSetEngine();
    const draft = engine.plan({
      id: "changeset.test",
      base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
      reason: { taskSessionId: "task.test" },
      operations: [
        { op: "write_policy", path: ".archcontext/policies/new.yaml", expectedHash: "missing", body: "schemaVersion: archcontext.policy/v1\n" },
        { op: "write_waiver", path: ".archcontext/waivers/cycle-waiver.json", expectedHash: "missing", body: "{}\n" }
      ]
    });

    expect(validateJsonSchema(readJson("schemas/runtime/changeset.schema.json") as any, draft as any).valid).toBe(true);
    expect(engine.preview("/tmp/repo", draft)).toMatchObject({ allowed: true, paths: [".archcontext/policies/new.yaml", ".archcontext/waivers/cycle-waiver.json"] });

    const denied = engine.plan({
      id: "changeset.denied",
      base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
      reason: { taskSessionId: "task.test" },
      operations: [{ op: "write_policy", path: "src/app.ts", expectedHash: "missing", body: "" }]
    });
    expect(engine.preview("/tmp/repo", denied).allowed).toBe(false);
  });

  test("previews the per-entity preimage that apply enforces for create, update and delete", () => {
    const modelRoot = tempModelRoot();
    try {
      const path = ".archcontext/model/nodes/module.preimage.yaml";
      const body = "schemaVersion: archcontext.node/v2\nid: module.preimage\nkind: module\nname: Preimage\nstatus: active\nsummary: Preimage\nresponsibilities:\n- preimage\n";
      const engine = new ChangeSetEngine();
      const preview = (op: "create_entity" | "update_entity_fields" | "delete_entity", expectedHash: string) => engine.preview(modelRoot, engine.plan({
        id: `changeset.${op}`,
        base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
        reason: { taskSessionId: "task.test" },
        operations: [{ op, path, expectedHash, ...(op === "delete_entity" ? {} : { body }) }]
      }));
      expect(preview("create_entity", "missing")).toMatchObject({ allowed: true, findings: [] });
      expect(preview("update_entity_fields", digest).findings).toEqual([`update_entity_fields target does not exist: ${path}`]);
      expect(preview("delete_entity", digest).findings).toEqual([`delete_entity target does not exist: ${path}`]);
      writeFileSync(join(modelRoot, path), body);
      const current = digestJson({ body });
      expect(preview("create_entity", "missing")).toMatchObject({ allowed: false, findings: [`Expected hash mismatch: ${path} (current ${current})`] });
      expect(preview("update_entity_fields", digest)).toMatchObject({ allowed: false, findings: [`Expected hash mismatch: ${path} (current ${current})`] });
      expect(preview("update_entity_fields", current)).toMatchObject({ allowed: true, findings: [] });
      expect(preview("delete_entity", current)).toMatchObject({ allowed: true, findings: [] });
    } finally {
      rmSync(modelRoot, { recursive: true, force: true });
    }
  });

  describe("render_agent_context write scope", () => {
    const agentContextPath = "packages/core/projection-engine/CLAUDE.md";

    function scopedEngine(journal?: ChangeSetJournalPort): ChangeSetEngine {
      return new ChangeSetEngine({
        modelStore: new YamlModelStore(),
        projection: { planGeneratedProjection },
        journal,
        agentContextScope: { derive: () => new Set([agentContextPath]) }
      });
    }

    test("allows the derived path only under render_agent_context, never under render_projection", () => {
      const engine = scopedEngine();
      const base = { headSha: "abc", worktreeDigest: digest, modelDigest: digest };
      const reason = { taskSessionId: "task.agent-context" };
      const projectionFiles = [{ path: agentContextPath, expectedHash: "missing", body: "x\n" }];

      const scoped = engine.plan({
        id: "changeset.agent-context",
        base,
        reason,
        operations: [{ op: "render_agent_context", expectedHash: "missing", projectionFiles }]
      });
      expect(engine.preview("/tmp/repo", scoped)).toMatchObject({ allowed: true, paths: [agentContextPath] });

      // Same path, wrong operation kind: the widening belongs to the operation, not to the draft.
      const misKinded = engine.plan({
        id: "changeset.agent-context-mis-kinded",
        base,
        reason,
        operations: [{ op: "render_projection", expectedHash: "missing", projectionFiles }]
      });
      const preview = engine.preview("/tmp/repo", misKinded);
      expect(preview.allowed).toBe(false);
      expect(preview.findings[0]).toContain("Path is outside ArchContext write allowlist");

      // A draft that mixes a legitimate widening with a mis-kinded one is denied as a whole.
      const mixed = engine.plan({
        id: "changeset.agent-context-mixed",
        base,
        reason,
        operations: [
          { op: "render_agent_context", expectedHash: "missing", projectionFiles },
          { op: "render_projection", expectedHash: "missing", projectionFiles }
        ]
      });
      expect(engine.preview("/tmp/repo", mixed).allowed).toBe(false);

      // Without a scope port the widening does not exist at all.
      const unscoped = yamlChangeSetEngine();
      expect(unscoped.preview("/tmp/repo", unscoped.plan({
        id: "changeset.agent-context-unscoped",
        base,
        reason,
        operations: [{ op: "render_agent_context", expectedHash: "missing", projectionFiles }]
      })).allowed).toBe(false);
    });

    test("apply writes the scoped path and refuses any other operation aimed at it", async () => {
      const modelRoot = tempModelRoot();
      try {
        const journal = new RecordingChangeSetJournal();
        const engine = scopedEngine(journal);
        const base = { headSha: "abc", worktreeDigest: digest, modelDigest: digest };
        const reason = { taskSessionId: "task.agent-context" };

        await engine.apply(modelRoot, engine.approve(engine.plan({
          id: "changeset.agent-context-apply",
          base,
          reason,
          operations: [{
            op: "render_agent_context",
            expectedHash: "missing",
            projectionFiles: [{ path: agentContextPath, expectedHash: "missing", body: "# Agent Context\n" }]
          }]
        })));
        expect(readFileSync(join(modelRoot, agentContextPath), "utf8")).toBe("# Agent Context\n");
        expect(journal.records[0].files[0]).toMatchObject({ path: agentContextPath, operation: "render_agent_context" });

        // A delete aimed at the same file is a different operation kind, so the scope does not
        // cover it: the file survives.
        const deletion = engine.approve(engine.plan({
          id: "changeset.agent-context-delete",
          base,
          reason,
          operations: [{
            op: "delete_entity",
            path: agentContextPath,
            expectedHash: digestJson({ body: "# Agent Context\n" } as any)
          }]
        }));
        await expect(engine.apply(modelRoot, deletion)).rejects.toThrow("Path is outside ArchContext write allowlist");
        expect(existsSync(join(modelRoot, agentContextPath))).toBe(true);
      } finally {
        rmSync(modelRoot, { recursive: true, force: true });
      }
    });
  });

  test("applies approved changes and rebuilds generated projection", async () => {
    const modelRoot = tempModelRoot();
    try {
      const journal = new RecordingChangeSetJournal();
      const engine = yamlChangeSetEngine(journal);
      const draft = engine.approve(
        engine.plan({
          id: "changeset.apply",
          base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
          reason: { taskSessionId: "task.test", interventionId: "intervention.test" },
          operations: [
            {
              op: "write_policy",
              path: ".archcontext/policies/compatibility.yaml",
              expectedHash: "missing",
              body: "schemaVersion: archcontext.policy/v1\nid: policy.compatibility\n"
            },
            {
              op: "write_waiver",
              path: ".archcontext/waivers/cycle-waiver.json",
              expectedHash: "missing",
              body: "{\"schemaVersion\":\"archcontext.practice-waiver/v1\"}\n"
            }
          ]
        })
      );

      await expect(engine.apply(modelRoot, draft)).resolves.toMatchObject({ status: "applied" });
      expect(readFileSync(join(modelRoot, ".archcontext/policies/compatibility.yaml"), "utf8")).toContain("policy.compatibility");
      expect(readFileSync(join(modelRoot, ".archcontext/waivers/cycle-waiver.json"), "utf8")).toContain("archcontext.practice-waiver/v1");
      expect(readFileSync(join(modelRoot, ".archcontext/generated/ARCHITECTURE.md"), "utf8")).toContain("Generated by ArchContext");
      expect(journal.records[0]).toMatchObject({ status: "committed" });
      expect(journal.records[0].files[0]).toMatchObject({
        path: ".archcontext/policies/compatibility.yaml",
        existed: false,
        operation: "write_policy"
      });
      expect(journal.records[0].files[1]).toMatchObject({
        path: ".archcontext/waivers/cycle-waiver.json",
        existed: false,
        operation: "write_waiver"
      });
      expect(journal.records[0].files[0].tempPath).toContain(".archctx-tmp-");
    } finally {
      rmSync(modelRoot, { recursive: true, force: true });
    }
  });

  test("applies multi-file render_projection operations through ChangeSet journal", async () => {
    const modelRoot = tempModelRoot();
    try {
      const journal = new RecordingChangeSetJournal();
      const engine = yamlChangeSetEngine(journal);
      const draft = engine.approve(
        engine.plan({
          id: "changeset.docs-projection",
          base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
          reason: { taskSessionId: "task.al9" },
          operations: [
            {
              op: "render_projection",
              expectedHash: "missing",
              projectionFiles: [
                {
                  path: "docs/architecture/index.md",
                  expectedHash: "missing",
                  body: "<!-- BEGIN ARCHCONTEXT:generated target=\"projection_target.architecture.index\" -->\n# Architecture\n<!-- END ARCHCONTEXT:generated target=\"projection_target.architecture.index\" -->\n"
                },
                {
                  path: "docs/architecture/diagrams/architecture.mmd",
                  expectedHash: "missing",
                  body: "flowchart LR\n"
                }
              ]
            }
          ]
        })
      );

      expect(engine.preview(modelRoot, draft)).toMatchObject({
        allowed: true,
        paths: ["docs/architecture/index.md", "docs/architecture/diagrams/architecture.mmd"]
      });
      await expect(engine.apply(modelRoot, draft)).resolves.toMatchObject({ status: "applied" });
      expect(readFileSync(join(modelRoot, "docs/architecture/index.md"), "utf8")).toContain("Architecture");
      expect(readFileSync(join(modelRoot, "docs/architecture/diagrams/architecture.mmd"), "utf8")).toContain("flowchart");
      expect(journal.records[0].files.map((file) => file.path)).toEqual([
        "docs/architecture/index.md",
        "docs/architecture/diagrams/architecture.mmd"
      ]);
      expect(journal.records[0].files.every((file) => file.operation === "render_projection")).toBe(true);
    } finally {
      rmSync(modelRoot, { recursive: true, force: true });
    }
  });

  test("render_projection deletes an exact-hash projection file inside the same write set", async () => {
    const modelRoot = tempModelRoot();
    try {
      const orphanPath = "docs/architecture/modules/orphan.md";
      const orphanBody = "<!-- BEGIN ARCHCONTEXT:generated target=\"projection_target.entity.orphan\" -->\n# Orphan\n<!-- END ARCHCONTEXT:generated target=\"projection_target.entity.orphan\" -->\n";
      mkdirSync(join(modelRoot, "docs/architecture/modules"), { recursive: true });
      writeFileSync(join(modelRoot, orphanPath), orphanBody, "utf8");
      const journal = new RecordingChangeSetJournal();
      const engine = yamlChangeSetEngine(journal);
      const plan = (id: string, op: "render_projection" | "render_agent_context", expectedHash: string) => engine.approve(engine.plan({
        id,
        base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
        reason: { taskSessionId: "task.orphan" },
        operations: [{
          op,
          expectedHash: "missing",
          projectionFiles: [
            { path: "docs/architecture/index.md", expectedHash: "missing", body: "# Architecture\n" },
            { path: orphanPath, expectedHash, delete: true }
          ]
        }]
      }));

      // Only render_projection may delete, and only with the exact current hash.
      expect(engine.preview(modelRoot, plan("changeset.orphan-agent", "render_agent_context", digestJson({ body: orphanBody }))).findings)
        .toContain(`Projection file delete is only allowed in render_projection: ${orphanPath}`);
      expect(engine.preview(modelRoot, plan("changeset.orphan-missing", "render_projection", "missing")).findings)
        .toContain(`Projection file delete requires the exact current hash: ${orphanPath}`);
      await expect(engine.apply(modelRoot, plan("changeset.orphan-stale", "render_projection", digestJson({ body: "stale" })))).rejects.toThrow();
      expect(readFileSync(join(modelRoot, orphanPath), "utf8")).toBe(orphanBody);
      expect(existsSync(join(modelRoot, "docs/architecture/index.md"))).toBe(false);

      await expect(engine.apply(modelRoot, plan("changeset.orphan", "render_projection", digestJson({ body: orphanBody }))))
        .resolves.toMatchObject({ status: "applied" });
      expect(existsSync(join(modelRoot, orphanPath))).toBe(false);
      const committed = journal.records.find((record) => record.status === "committed")!;
      expect(committed.files.map((file) => [file.path, file.operation, file.bodyHash])).toEqual([
        ["docs/architecture/index.md", "render_projection", digestJson({ body: "# Architecture\n" })],
        [orphanPath, "delete_entity", "missing"]
      ]);
    } finally {
      rmSync(modelRoot, { recursive: true, force: true });
    }
  });

  test("render_projection guards a carried file: nothing is written to it, and drift refuses the whole apply", async () => {
    const modelRoot = tempModelRoot();
    try {
      const carriedPath = "docs/architecture/modules/carried.md";
      const carriedBody = "# Carried\r\nkept as rendered\r\n";
      mkdirSync(join(modelRoot, "docs/architecture/modules"), { recursive: true });
      writeFileSync(join(modelRoot, carriedPath), carriedBody, "utf8");
      const journal = new RecordingChangeSetJournal();
      const engine = yamlChangeSetEngine(journal);
      const carriedHash = digestJson({ body: carriedBody });
      const plan = (id: string, op: "render_projection" | "render_agent_context", guardPath = carriedPath, expectedHash = carriedHash) => engine.approve(engine.plan({
        id,
        base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
        reason: { taskSessionId: "task.carried" },
        operations: [{
          op,
          expectedHash: "missing",
          projectionFiles: [
            { path: "docs/architecture/index.md", expectedHash: "missing", body: "# Architecture\n" },
            { path: guardPath, expectedHash, guard: true }
          ]
        }]
      }));

      expect(validateJsonSchema(readJson("schemas/runtime/changeset.schema.json") as any, plan("changeset.carried-schema", "render_projection") as any).valid).toBe(true);
      expect(engine.preview(modelRoot, plan("changeset.carried-agent", "render_agent_context")).findings)
        .toContain(`Projection file guard is only allowed in render_projection: ${carriedPath}`);
      expect(engine.preview(modelRoot, plan("changeset.carried-missing", "render_projection", carriedPath, "missing")).findings)
        .toContain(`Projection file guard requires the exact current hash: ${carriedPath}`);
      expect(engine.preview(modelRoot, plan("changeset.carried-overlap", "render_projection", "docs/architecture/index.md")).findings)
        .toContain("Projection file guard must not be written by the same ChangeSet: docs/architecture/index.md");

      // Drift between the render and the commit: the write already made is rolled back.
      await expect(engine.apply(modelRoot, plan("changeset.carried-stale", "render_projection", carriedPath, digestJson({ body: "stale" })))).rejects.toMatchObject({ code: "AC_PRECONDITION_FAILED", reasonCode: "apply-preimage-changed", details: { issueCount: 1 } });
      expect(existsSync(join(modelRoot, "docs/architecture/index.md"))).toBe(false);
      rmSync(join(modelRoot, carriedPath));
      await expect(engine.apply(modelRoot, plan("changeset.carried-deleted", "render_projection"))).rejects.toMatchObject({ code: "AC_PRECONDITION_FAILED", reasonCode: "apply-preimage-changed", details: { issueCount: 1 } });
      expect(existsSync(join(modelRoot, "docs/architecture/index.md"))).toBe(false);
      writeFileSync(join(modelRoot, carriedPath), carriedBody, "utf8");

      await expect(engine.apply(modelRoot, plan("changeset.carried", "render_projection"))).resolves.toMatchObject({ status: "applied" });
      expect(readFileSync(join(modelRoot, carriedPath), "utf8")).toBe(carriedBody);
      expect(readFileSync(join(modelRoot, "docs/architecture/index.md"), "utf8")).toBe("# Architecture\n");
      const committed = journal.records.find((record) => record.status === "committed")!;
      expect(committed.files.map((file) => file.path)).toEqual(["docs/architecture/index.md"]);
    } finally {
      rmSync(modelRoot, { recursive: true, force: true });
    }
  });

  test.each([
    ["missing", "render_projection"], ["drifted", "render_projection"],
    ["missing", "render_agent_context"], ["drifted", "render_agent_context"]
  ] as const)("explicit projection preserves unrelated generated state (%s, %s)", async (state, op) => {
    const modelRoot = tempModelRoot();
    const generatedPath = join(modelRoot, ".archcontext/generated/ARCHITECTURE.md");
    const unrelatedPath = join(modelRoot, ".archcontext/generated/other.md");
    try {
      if (state === "missing") rmSync(generatedPath);
      else writeFileSync(generatedPath, "<!-- Generated by ArchContext -->\nexisting generated state\n");
      writeFileSync(unrelatedPath, "<!-- Generated by ArchContext -->\nunrelated generated artifact\n");
      const journal = new RecordingChangeSetJournal();
      const engine = yamlChangeSetEngine(journal);
      const draft = engine.approve(engine.plan({
        id: "changeset.explicit-projection",
        base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
        reason: { taskSessionId: "task.explicit-projection" },
        operations: [{
          op, expectedHash: "missing",
          projectionFiles: [{ path: "docs/architecture/index.md", expectedHash: "missing", body: "# Architecture\n" }]
        }]
      }));
      await engine.apply(modelRoot, draft);
      expect(readFileSync(join(modelRoot, "docs/architecture/index.md"), "utf8")).toBe("# Architecture\n");
      expect(journal.records[0].files.map(file => file.path)).toEqual(["docs/architecture/index.md"]);
      expect(readFileSync(unrelatedPath, "utf8")).toBe("<!-- Generated by ArchContext -->\nunrelated generated artifact\n");
      if (state === "missing") expect(existsSync(generatedPath)).toBe(false);
      else expect(readFileSync(generatedPath, "utf8")).toBe("<!-- Generated by ArchContext -->\nexisting generated state\n");
    } finally {
      rmSync(modelRoot, { recursive: true, force: true });
    }
  });

  test("a mixed model and explicit projection draft still rebuilds generated output", async () => {
    const modelRoot = tempModelRoot();
    const generatedPath = join(modelRoot, ".archcontext/generated/ARCHITECTURE.md");
    try {
      rmSync(generatedPath);
      const engine = yamlChangeSetEngine();
      const draft = engine.approve(engine.plan({
        id: "changeset.mixed-projection",
        base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
        reason: { taskSessionId: "task.mixed-projection" },
        operations: [
          { op: "write_policy", path: ".archcontext/policies/mixed.yaml", expectedHash: "missing", body: "schemaVersion: archcontext.policy/v1\nid: policy.mixed\n" },
          { op: "render_projection", expectedHash: "missing", projectionFiles: [{ path: "docs/architecture/index.md", expectedHash: "missing", body: "# Architecture\n" }] }
        ]
      }));
      await engine.apply(modelRoot, draft);
      expect(readFileSync(generatedPath, "utf8")).toContain("Generated by ArchContext");
      expect(readFileSync(join(modelRoot, "docs/architecture/index.md"), "utf8")).toBe("# Architecture\n");
    } finally {
      rmSync(modelRoot, { recursive: true, force: true });
    }
  });

  test("generated projection replacement is journaled and rolls back on interruption", async () => {
    const modelRoot = tempModelRoot();
    const generatedPath = join(modelRoot, ".archcontext/generated/ARCHITECTURE.md");
    const staleGeneratedPath = join(modelRoot, ".archcontext/generated/obsolete.json");
    try {
      const original = `${readFileSync(generatedPath, "utf8")}Manual drift\n`;
      writeFileSync(generatedPath, original, "utf8");
      writeFileSync(staleGeneratedPath, "{}\n", "utf8");
      const journal = new RecordingChangeSetJournal();
      const engine = yamlChangeSetEngine(journal);
      const draft = engine.approve(engine.plan({
        id: "changeset.generated-projection-rollback",
        base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
        reason: { taskSessionId: "task.generated-projection" },
        operations: [{
          op: "write_policy",
          path: ".archcontext/policies/generated-projection.yaml",
          expectedHash: "missing",
          body: "schemaVersion: archcontext.policy/v1\nid: policy.generated-projection\n"
        }]
      }));

      await expect(engine.apply(modelRoot, draft, { faultAfterOperations: 2 })).rejects.toThrow("fault-injection");
      expect(readFileSync(generatedPath, "utf8")).toBe(original);
      expect(journal.records[0].files).toContainEqual(expect.objectContaining({
        path: ".archcontext/generated/ARCHITECTURE.md",
        operation: "render_projection"
      }));
      expect(journal.records[0].status).toBe("aborted");
      expect(existsSync(staleGeneratedPath)).toBe(true);

      const retryJournal = new RecordingChangeSetJournal();
      const retryEngine = yamlChangeSetEngine(retryJournal);
      await retryEngine.apply(modelRoot, retryEngine.approve(retryEngine.plan({
        ...draft,
        id: "changeset.generated-projection-retry"
      })));
      expect(existsSync(staleGeneratedPath)).toBe(false);
      expect(retryJournal.records[0].files).toContainEqual(expect.objectContaining({
        path: ".archcontext/generated/obsolete.json",
        operation: "delete_entity"
      }));
    } finally {
      rmSync(modelRoot, { recursive: true, force: true });
    }
  });

  test("rolls back file writes when apply is interrupted", async () => {
    const modelRoot = tempModelRoot();
    try {
      const original = readFileSync(join(modelRoot, ".archcontext/policies/review.yaml"), "utf8");
      const journal = new RecordingChangeSetJournal();
      const engine = yamlChangeSetEngine(journal);
      const draft = engine.approve(
        engine.plan({
          id: "changeset.rollback",
          base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
          reason: { taskSessionId: "task.test" },
          operations: [
            {
              op: "update_entity_fields",
              path: ".archcontext/policies/review.yaml",
              expectedHash: digestJson({ body: original }),
              body: "schemaVersion: archcontext.policy/v1\nid: policy.changed\n"
            }
          ]
        })
      );

      await expect(engine.apply(modelRoot, draft, { faultAfterOperations: 1 })).rejects.toThrow("fault-injection");
      expect(readFileSync(join(modelRoot, ".archcontext/policies/review.yaml"), "utf8")).toBe(original);
      expect(journal.records[0]).toMatchObject({ status: "aborted", reason: "fault-injection" });
    } finally {
      rmSync(modelRoot, { recursive: true, force: true });
    }
  });

  test("rejects an invalid post-apply model and restores the original files", async () => {
    const modelRoot = tempModelRoot();
    try {
      const path = ".archcontext/policies/review.yaml";
      const original = readFileSync(join(modelRoot, path), "utf8");
      const journal = new RecordingChangeSetJournal();
      const engine = yamlChangeSetEngine(journal);
      const draft = engine.approve(
        engine.plan({
          id: "changeset.invalid-postcondition",
          base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
          reason: { taskSessionId: "task.test" },
          operations: [{
            op: "write_policy",
            path,
            expectedHash: digestJson({ body: original }),
            body: "id: policy.invalid\n"
          }]
        })
      );

      const applied = engine.apply(modelRoot, draft);
      await expect(applied).rejects.toThrow("ChangeSet model validation failed after apply");
      await expect(applied).rejects.toMatchObject({ failure: { code: "AC_SCHEMA_INVALID", reasonCode: "native-context-model-invalid", action: "repair-native-input", retryable: false, details: { path } } });
      expect(readFileSync(join(modelRoot, path), "utf8")).toBe(original);
      expect(journal.records[0]).toMatchObject({ status: "aborted" });
    } finally {
      rmSync(modelRoot, { recursive: true, force: true });
    }
  });

  test("repairs node schema errors only on paths the ChangeSet writes (#370)", async () => {
    const modelRoot = tempModelRoot();
    const path = ".archcontext/model/nodes/capability.architecture.context.yaml";
    const original = readFileSync(join(modelRoot, path), "utf8");
    const invalid = original.replace(/^summary:.*\n/m, "");
    writeFileSync(join(modelRoot, path), invalid, "utf8");
    try {
      const journal = new RecordingChangeSetJournal();
      const engine = yamlChangeSetEngine(journal);
      const draft = (id: string, target: string, body: string) => engine.approve(engine.plan({
        id,
        base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
        reason: { taskSessionId: "task.test" },
        operations: [{ op: "update_entity_fields", path: target, expectedHash: digestJson({ body: readFileSync(join(modelRoot, target), "utf8") }), body }]
      }));
      const policy = ".archcontext/policies/review.yaml";
      await expect(engine.apply(modelRoot, draft("changeset.unrelated", policy, readFileSync(join(modelRoot, policy), "utf8"))))
        .rejects.toThrow("ChangeSet model validation failed before apply");
      expect(journal.records).toHaveLength(0);
      await expect(engine.apply(modelRoot, draft("changeset.incomplete-repair", path, invalid)))
        .rejects.toThrow("ChangeSet model validation failed after apply");
      expect(readFileSync(join(modelRoot, path), "utf8")).toBe(invalid);
      expect(journal.records[0]).toMatchObject({ status: "aborted" });
      await expect(engine.apply(modelRoot, draft("changeset.repair-node", path, original)))
        .resolves.toMatchObject({ status: "applied" });
      expect(readFileSync(join(modelRoot, path), "utf8")).toBe(original);
      expect(await new YamlModelStore().validateModel({ root: modelRoot, repositoryId: "test", headSha: "abc" })).toMatchObject({ valid: true, errors: [] });
    } finally {
      rmSync(modelRoot, { recursive: true, force: true });
    }
  });

  test("requires approval before applying", async () => {
    const modelRoot = tempModelRoot();
    try {
      const engine = new ChangeSetEngine();
      const draft = engine.plan({
        id: "changeset.unapproved",
        base: { headSha: "abc", worktreeDigest: digest, modelDigest: digest },
        reason: { taskSessionId: "task.test" },
        operations: [{ op: "write_policy", path: ".archcontext/policies/new.yaml", expectedHash: "missing", body: "" }]
      });

      await expect(engine.apply(modelRoot, draft)).rejects.toThrow("approved");
    } finally {
      rmSync(modelRoot, { recursive: true, force: true });
    }
  });
});

class RecordingChangeSetJournal implements ChangeSetJournalPort {
  readonly records: { id: string; root: string; draft: ChangeSetDraft; files: ChangeSetJournalFile[]; status: "pending" | "committed" | "aborted"; reason?: string }[] = [];

  async beginChangeSet(root: string, draft: ChangeSetDraft): Promise<string> {
    const id = `journal_${this.records.length + 1}`;
    this.records.push({ id, root, draft, files: [], status: "pending" });
    return id;
  }

  async recordChangeSetFile(journalId: string, file: ChangeSetJournalFile): Promise<void> {
    this.record(journalId).files.push(file);
  }

  async commitChangeSet(journalId: string): Promise<void> {
    this.record(journalId).status = "committed";
  }

  async completeChangeSetCleanup(): Promise<void> {}

  async abortChangeSet(journalId: string, reason: string): Promise<void> {
    const record = this.record(journalId);
    record.status = "aborted";
    record.reason = reason;
  }

  recoverPendingChangeSets(): number {
    return this.records.filter((record) => record.status === "pending").length;
  }

  private record(journalId: string) {
    const record = this.records.find((candidate) => candidate.id === journalId);
    if (!record) throw new Error(`Journal not found: ${journalId}`);
    return record;
  }
}
