import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeGraphAdapter } from "../../../local-runtime/codegraph-adapter/src/index";
import { MockCodeGraphProvider } from "../../../local-runtime/codegraph-adapter/test/factories";
import { ChangeSetEngine } from "@archcontext/core/changeset-engine";
import { digestJson } from "@archcontext/contracts";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import { initializeArchContextModel, rebuildGeneratedProjection, YamlModelStore } from "../../../local-runtime/model-store-yaml/src/index";
import { detectArchitecturePressure } from "@archcontext/core/pressure-engine";
import { validateCompatibilityContract } from "@archcontext/core/policy-engine";
import { assertNoHumanEditableGeneratedSection } from "@archcontext/core/reconcile-engine";
import { computeRefactorConfidence, createInterventionProposal, decidePosture } from "@archcontext/core/refactor-decision";
import { applyArchitectureUpdate, completeTask, prepareTask } from "../src/index";

function tempModel(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-m2-"));
  writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
  initializeArchContextModel(root, "M2 App");
  return root;
}

function yamlChangeSetEngine(): ChangeSetEngine {
  return new ChangeSetEngine({
    modelStore: new YamlModelStore(),
    projection: { rebuildGeneratedProjection }
  });
}

describe("M2 architecture control loop", () => {
  test("prepare_task enters intervention for high pressure and high confidence", async () => {
    const root = tempModel();
    try {
      const result = await prepareTask({
        workspace: { root, repositoryId: "repo.test", headSha: "abc" },
        task: "remove legacy v1 wrapper and fallback mapper with multiple lifecycle owner",
        codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
        modelStore: new YamlModelStore(),
        callerCoverage: 1,
        testsAvailable: true,
        rollbackAvailable: true
      });
      expect(result.posture).toBe("intervention");
      expect(result.intervention?.targetState.removedConcepts).toContain("legacy-wrapper");
      expect(result.intervention?.migrationState.active).toBe(true);
      expect(result.intervention?.thesis).not.toContain("minimal diff");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("high pressure with low confidence enters Proof Required", () => {
    const pressure = detectArchitecturePressure({
      task: "rewrite legacy v1 fallback mapper with multiple lifecycle owner and unknown external consumers"
    });
    const confidence = computeRefactorConfidence({
      callerCoverage: 0.1,
      testsAvailable: false,
      rollbackAvailable: false,
      externalConsumers: ["partner.unknown"],
      persistedData: ["status-values"]
    });
    expect(decidePosture(pressure, confidence)).toBe("proof-required");
  });

  test("target state and migration state stay separate", () => {
    const pressure = detectArchitecturePressure({ task: "remove legacy v1 wrapper fallback mapper with multiple lifecycle owner" });
    const confidence = computeRefactorConfidence({ callerCoverage: 1, testsAvailable: true, rollbackAvailable: true });
    const intervention = createInterventionProposal({ task: "unify subscription lifecycle", pressure, confidence });
    expect(intervention.targetState.removedConcepts).toContain("legacy-wrapper");
    expect(intervention.migrationState.temporaryRelations).toContain("relation.temporary-migration");
    expect(intervention.targetState.requiredRelations).not.toContain("relation.temporary-migration");
  });

  test("compatibility debt proxy fixture reaches required recall shape", () => {
    const cases = [
      { reason: "just in case", shouldFlag: true },
      { reason: "safer to keep", shouldFlag: true },
      { reason: "many internal callers", shouldFlag: true },
      { reason: "large diff", shouldFlag: true },
      { reason: "old code already exists", shouldFlag: true },
      { reason: undefined, shouldFlag: true },
      { reason: "External partner migration window is still active.", shouldFlag: false }
    ];
    let truePositives = 0;
    let positives = 0;
    for (const item of cases) {
      if (item.shouldFlag) positives += 1;
      const findings = validateCompatibilityContract({
        kind: "external-contract",
        reason: item.reason,
        owner: item.reason === undefined ? undefined : "module.integration",
        consumers: item.reason === undefined ? [] : ["partner.acme"],
        removalConditions: item.reason === undefined ? [] : ["remaining-consumers == 0"],
        reviewAt: item.reason === undefined ? undefined : "2026-08-01"
      });
      if (item.shouldFlag && findings.some((finding) => finding.severity === "error")) truePositives += 1;
      if (!item.shouldFlag) expect(findings).toEqual([]);
    }
    expect(truePositives / positives).toBeGreaterThanOrEqual(0.85);
  });

  test("ChangeSet apply uses allowlist, expected digest, and full rollback under fault injection", async () => {
    const root = tempModel();
    try {
      const existingPath = ".archcontext/model/nodes/capability.architecture-context.yaml";
      const existingBody = readFileSync(join(root, existingPath), "utf8");
      const expectedHash = digestJson({ body: existingBody });
      const engine = yamlChangeSetEngine();
      const draft = engine.plan({
        id: "changeset.m2",
        base: {
          headSha: "local",
          worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          modelDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
        },
        reason: { taskSessionId: "task_test" },
        operations: [
          {
            op: "update_entity_fields",
            path: existingPath,
            expectedHash,
            body: existingBody.replace("Keeps product", "Maintains product")
          },
          {
            op: "create_entity",
            path: ".archcontext/model/nodes/module.new.yaml",
            expectedHash: "missing",
            body: "schemaVersion: archcontext.node/v1\nid: module.new\nkind: module\nname: New\nstatus: active\nsummary: New module\nresponsibilities:\n- own-new\n"
          }
        ]
      });
      expect(engine.preview(root, draft).allowed).toBe(true);
      const approved = engine.approve(draft);
      await expect(engine.apply(root, approved, { faultAfterOperations: 1 })).rejects.toThrow("fault-injection");
      expect(readFileSync(join(root, existingPath), "utf8")).toBe(existingBody);
      expect(existsSync(join(root, ".archcontext/model/nodes/module.new.yaml"))).toBe(false);
      await expect(
        engine.apply(
          root,
          engine.approve(
            engine.plan({
              id: "changeset.escape",
              base: {
                headSha: "local",
                worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
                modelDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
              },
              reason: { taskSessionId: "task_test" },
              operations: [{ op: "create_entity", path: "../escape", expectedHash: "missing", body: "bad" }]
            })
          )
        )
      ).rejects.toThrow();

      const success = engine.approve(
        engine.plan({
          id: "changeset.success",
          base: {
            headSha: "local",
            worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            modelDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
          },
          reason: { taskSessionId: "task_test" },
          operations: [
            {
              op: "create_entity",
              path: ".archcontext/model/nodes/module.success.yaml",
              expectedHash: "missing",
              body: "schemaVersion: archcontext.node/v1\nid: module.success\nkind: module\nname: Success\nstatus: active\nsummary: Success module\nresponsibilities:\n- own-success\n"
            }
          ]
        })
      );
      await expect(engine.apply(root, success)).resolves.toMatchObject({ status: "applied" });
      expect(readFileSync(join(root, ".archcontext/generated/ARCHITECTURE.md"), "utf8")).toContain("Generated by ArchContext");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reconcile refuses to overwrite generated files with human sections", () => {
    const root = tempModel();
    try {
      writeFileSync(join(root, ".archcontext/generated/ARCHITECTURE.md"), "<!-- BEGIN HUMAN -->\nmanual\n", "utf8");
      expect(() => assertNoHumanEditableGeneratedSection(root)).toThrow("human-editable");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("complete_task gate fails stale context and unjustified compatibility", () => {
    const review = completeTask({
      taskSessionId: "task_1",
      posture: "intervention",
      headSha: "old",
      currentHeadSha: "new",
      worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      modelDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      codeFactsDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      compatibilityPathIntroduced: true,
      cleanupRequired: 1,
      cleanupCompleted: 0
    });
    expect(review.result).toBe("fail_action_required");
    expect(review.findings.map((finding) => finding.type)).toContain("stale-context");
    expect(review.findings.map((finding) => finding.type)).toContain("unjustified-compatibility-path");
  });

  test("apply_update refuses stale worktree digest before writing", async () => {
    const root = tempModel();
    try {
      const expectedWorktreeDigest = computeWorktreeDigest(root);
      writeFileSync(join(root, "README.md"), "# changed\n", "utf8");
      await expect(
        applyArchitectureUpdate(root, {
          id: "changeset.stale",
          approved: true,
          expectedWorktreeDigest,
          headSha: "abc",
          modelDigest: digestJson({ model: "before" }),
          operations: [
            {
              op: "create_entity",
              path: ".archcontext/model/nodes/module.stale.yaml",
              expectedHash: "missing",
              body: "schemaVersion: archcontext.node/v1\nid: module.stale\nkind: module\nname: Stale\nstatus: active\nsummary: Stale\nresponsibilities:\n- stale\n"
            }
          ]
        })
      ).rejects.toThrow("freshness");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
