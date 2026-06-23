import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeGraphAdapter } from "../../../local-runtime/codegraph-adapter/src/index";
import { MockCodeGraphProvider } from "../../../local-runtime/codegraph-adapter/test/factories";
import { ChangeSetEngine } from "@archcontext/core/changeset-engine";
import { digestJson, type CodeFactsPort, type NormalizedCodeContext } from "@archcontext/contracts";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import { initializeArchContextModel, rebuildGeneratedProjection, YamlModelStore } from "../../../local-runtime/model-store-yaml/src/index";
import { detectArchitecturePressure } from "@archcontext/core/pressure-engine";
import { validateCompatibilityContract } from "@archcontext/core/policy-engine";
import { assertNoHumanEditableGeneratedSection } from "@archcontext/core/reconcile-engine";
import { computeRefactorConfidence, createInterventionProposal, decidePosture } from "@archcontext/core/refactor-decision";
import { applyArchitectureUpdate, checkpointTask, completeTask, prepareTask } from "../src/index";

function tempModel(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-m2-"));
  writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
  initializeArchContextModel(root, "M2 App");
  return root;
}

function structuralCompatibilityFacts(): CodeFactsPort {
  return {
    async ensureReady() {
      return {
        provider: "codegraph",
        version: "1.0.1",
        schemaDigest: `sha256:${"a".repeat(64)}`,
        indexedAt: "2026-06-19T00:00:00.000Z",
        workspaceDigest: `sha256:${"b".repeat(64)}`
      };
    },
    async sync() {
      return {
        provider: "codegraph",
        version: "1.0.1",
        schemaDigest: `sha256:${"a".repeat(64)}`,
        indexedAt: "2026-06-19T00:00:00.000Z",
        workspaceDigest: `sha256:${"b".repeat(64)}`
      };
    },
    async buildTaskContext(input) {
      const symbols = [
        { id: "symbol.legacyWrapperV1", name: "legacyWrapperV1", kind: "public-api", path: "src/billing/legacy-wrapper-v1.ts" },
        { id: "symbol.fallbackMapperV2", name: "fallbackMapperV2", kind: "public-api", path: "src/billing/fallback-mapper-v2.ts" },
        { id: "symbol.paymentRepository", name: "paymentRepository", kind: "service", path: "src/billing/payment-repository.ts" }
      ].slice(0, input.maxSymbols);
      return {
        task: input.task,
        symbols,
        edges: [
          { source: "symbol.legacyWrapperV1", target: "symbol.fallbackMapperV2", kind: "imports", confidence: "high" },
          { source: "symbol.fallbackMapperV2", target: "symbol.paymentRepository", kind: "reads", confidence: "high" }
        ],
        evidence: [
          {
            id: "evidence.compatibility-test",
            selector: { path: "src/billing/legacy-wrapper-v1.ts", symbolId: "symbol.legacyWrapperV1" },
            summary: "verified compatibility path",
            confidence: "verified",
            snapshot: {
              repositoryId: "repo.test",
              headSha: "abc",
              worktreeDigest: `sha256:${"c".repeat(64)}`
            }
          }
        ],
        digest: digestJson({ task: input.task, symbols } as any)
      };
    },
    async findSymbols() {
      return [];
    },
    async getImpact() {
      return { symbolId: "symbol.none", callers: [], callees: [], affectedPaths: [] };
    },
    async getCallers() {
      return [];
    },
    async getCallees() {
      return [];
    },
    async resolveEvidence() {
      return [];
    }
  };
}

function mutableCycleFacts(hasCycle: () => boolean): CodeFactsPort {
  return {
    async ensureReady() {
      return {
        provider: "codegraph",
        version: "1.0.1",
        schemaDigest: `sha256:${"d".repeat(64)}`,
        indexedAt: "2026-06-19T00:00:00.000Z",
        workspaceDigest: `sha256:${"e".repeat(64)}`
      };
    },
    async sync() {
      return {
        provider: "codegraph",
        version: "1.0.1",
        schemaDigest: `sha256:${"d".repeat(64)}`,
        indexedAt: "2026-06-19T00:00:00.000Z",
        workspaceDigest: `sha256:${"e".repeat(64)}`
      };
    },
    async buildTaskContext(input) {
      const symbols = hasCycle()
        ? [
          { id: "symbol.billingService", name: "billingService", kind: "service", path: "src/billing/service.ts" },
          { id: "symbol.orderService", name: "orderService", kind: "service", path: "src/orders/service.ts" }
        ].slice(0, input.maxSymbols)
        : [];
      const edges = hasCycle()
        ? [
          { source: "symbol.billingService", target: "symbol.orderService", kind: "imports" as const, confidence: "high" as const },
          { source: "symbol.orderService", target: "symbol.billingService", kind: "imports" as const, confidence: "high" as const }
        ]
        : [];
      return {
        task: input.task,
        symbols,
        edges,
        evidence: [],
        digest: digestJson({ task: input.task, symbols, edges } as any)
      } satisfies NormalizedCodeContext;
    },
    async findSymbols() {
      return [];
    },
    async getImpact() {
      return { symbolId: "symbol.none", callers: [], callees: [], affectedPaths: [] };
    },
    async getCallers() {
      return [];
    },
    async getCallees() {
      return [];
    },
    async resolveEvidence() {
      return [];
    }
  };
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
        codeFacts: structuralCompatibilityFacts(),
        modelStore: new YamlModelStore(),
        callerCoverage: 1,
        testsAvailable: true,
        rollbackAvailable: true
      });
      expect(result.posture).toBe("intervention");
      expect(result.intervention?.targetState.removedConcepts).toContain("legacy-wrapper");
      expect(result.intervention?.migrationState.active).toBe(true);
      expect(result.context.practiceGuidance.matches.map((match) => match.practiceId)).toContain("compatibility.single-owner");
      expect(result.intervention?.thesis).not.toContain("minimal diff");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("high pressure with low confidence enters Proof Required", () => {
    const pressure = detectArchitecturePressure({
      task: "rewrite legacy v1 fallback mapper with multiple lifecycle owner and unknown external consumers",
      symbols: ["legacyWrapperV1", "fallbackMapperV2", "multiple lifecycle owners"],
      files: ["src/billing/legacy-wrapper-v1.ts", "src/billing/fallback-mapper-v2.ts"],
      edges: [{ source: "legacyWrapperV1", target: "fallbackMapperV2", kind: "imports", confidence: "high" }]
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

  test("checkpoint_task returns practice delta and stale reasons", async () => {
    const root = tempModel();
    try {
      const workspace = { root, repositoryId: "repo.test", headSha: "abc" };
      const prepared = await prepareTask({
        workspace,
        task: "remove legacy v1 wrapper",
        codeFacts: structuralCompatibilityFacts(),
        modelStore: new YamlModelStore()
      });
      const baseline = {
        schemaVersion: "archcontext.practice-checkpoint-snapshot/v1" as const,
        task: prepared.context.task,
        headSha: workspace.headSha,
        worktreeDigest: computeWorktreeDigest(root),
        contextDigest: prepared.context.extensions.digest,
        practiceGuidanceDigest: prepared.context.extensions.practiceGuidanceDigest,
        catalogDigest: prepared.context.practiceGuidance.catalogDigest,
        matches: prepared.context.practiceGuidance.matches
      };

      const noOp = await checkpointTask({
        workspace,
        taskSessionId: "task_test",
        task: prepared.context.task,
        event: "post-edit",
        changedPaths: ["src/billing/legacy-wrapper-v1.ts"],
        expectedWorktreeDigest: baseline.worktreeDigest,
        previous: baseline,
        codeFacts: structuralCompatibilityFacts(),
        modelStore: new YamlModelStore()
      });
      expect(noOp.schemaVersion).toBe("archcontext.practice-checkpoint/v1");
      expect(noOp.reasonCode).toBe("no-op");
      expect(noOp.fresh).toBe(true);
      expect(noOp.delta.unchanged.length).toBeGreaterThan(0);
      expect(noOp.hook.egress).toBe("none");

      const stale = await checkpointTask({
        workspace,
        taskSessionId: "task_test",
        task: prepared.context.task,
        event: "post-edit",
        expectedWorktreeDigest: `sha256:${"0".repeat(64)}`,
        previous: baseline,
        codeFacts: structuralCompatibilityFacts(),
        modelStore: new YamlModelStore()
      });
      expect(stale.fresh).toBe(false);
      expect(stale.staleReasons).toContain("stale-worktree");

      const normalizedPaths = await checkpointTask({
        workspace,
        taskSessionId: "task_test",
        task: prepared.context.task,
        event: "post-edit",
        changedPaths: [" src/billing/legacy-wrapper-v1.ts", "src\\billing\\legacy-wrapper-v1.ts", "/tmp/escape.ts", "../escape.ts", "", "src/billing/fallback-mapper-v2.ts"],
        previous: baseline,
        codeFacts: structuralCompatibilityFacts(),
        modelStore: new YamlModelStore()
      });
      expect(normalizedPaths.changedPaths).toEqual(["src/billing/fallback-mapper-v2.ts", "src/billing/legacy-wrapper-v1.ts"]);
      expect(normalizedPaths.hook.pathCount).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("checkpoint_task summarizes rename delete generated ignored and binary path classes without path bodies", async () => {
    const root = tempModel();
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(join(root, "assets"), { recursive: true });
      writeFileSync(join(root, "src/new-name.ts"), "export const renamed = true;\n", "utf8");
      writeFileSync(join(root, "assets/logo.png"), "not-real-image-binary-fixture\n", "utf8");

      const result = await checkpointTask({
        workspace: { root, repositoryId: "repo.test", headSha: "abc" },
        taskSessionId: "task_paths",
        task: "inspect changed path classes",
        event: "post-edit",
        changedPaths: [
          "src/old-name.ts",
          "src/new-name.ts",
          ".archcontext/generated/model.json",
          "dist/bundle.js",
          "node_modules/pkg/index.js",
          "coverage/output.txt",
          "assets/logo.png"
        ],
        codeFacts: structuralCompatibilityFacts(),
        modelStore: new YamlModelStore()
      });

      expect(result.hook.pathSummary).toEqual({
        schemaVersion: "archcontext.checkpoint-path-summary/v1",
        total: 7,
        source: 1,
        generated: 2,
        ignored: 2,
        binary: 1,
        deleted: 1,
        renameHints: 1
      });
      expect(JSON.stringify(result.hook.pathSummary)).not.toContain("src/new-name.ts");
      expect(JSON.stringify(result.hook.pathSummary)).not.toContain("src/old-name.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("checkpoint_task adds and removes observed cycle guidance across edit and revert", async () => {
    const root = tempModel();
    let cycleObserved = false;
    const codeFacts = mutableCycleFacts(() => cycleObserved);
    try {
      const workspace = { root, repositoryId: "repo.test", headSha: "abc" };
      const prepared = await prepareTask({
        workspace,
        task: "untangle dependency cycle between billing and orders",
        codeFacts,
        modelStore: new YamlModelStore()
      });
      expect(prepared.context.practiceGuidance.matches.map((match) => match.practiceId)).not.toContain("modularity.no-new-cycle");
      const baseline = {
        schemaVersion: "archcontext.practice-checkpoint-snapshot/v1" as const,
        task: prepared.context.task,
        headSha: workspace.headSha,
        worktreeDigest: computeWorktreeDigest(root),
        contextDigest: prepared.context.extensions.digest,
        practiceGuidanceDigest: prepared.context.extensions.practiceGuidanceDigest,
        catalogDigest: prepared.context.practiceGuidance.catalogDigest,
        matches: prepared.context.practiceGuidance.matches
      };

      cycleObserved = true;
      const added = await checkpointTask({
        workspace,
        taskSessionId: "task_cycle",
        task: prepared.context.task,
        event: "post-edit",
        changedPaths: ["src/billing/service.ts", "src/orders/service.ts"],
        previous: baseline,
        codeFacts,
        modelStore: new YamlModelStore()
      });
      expect(added.delta.added.map((match) => match.practiceId)).toContain("modularity.no-new-cycle");
      expect(added.delta.removed).toHaveLength(0);

      cycleObserved = false;
      const removed = await checkpointTask({
        workspace,
        taskSessionId: "task_cycle",
        task: prepared.context.task,
        event: "post-edit",
        changedPaths: ["src/billing/service.ts", "src/orders/service.ts"],
        previous: added.nextSnapshot,
        codeFacts,
        modelStore: new YamlModelStore()
      });
      expect(removed.delta.removed.map((match) => match.practiceId)).toContain("modularity.no-new-cycle");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("target state and migration state stay separate", () => {
    const pressure = detectArchitecturePressure({
      task: "remove legacy v1 wrapper fallback mapper with multiple lifecycle owner",
      symbols: ["legacyWrapperV1", "fallbackMapperV2", "multiple lifecycle owners"],
      files: ["src/billing/legacy-wrapper-v1.ts", "src/billing/fallback-mapper-v2.ts"],
      edges: [{ source: "legacyWrapperV1", target: "fallbackMapperV2", kind: "imports", confidence: "high" }]
    });
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
