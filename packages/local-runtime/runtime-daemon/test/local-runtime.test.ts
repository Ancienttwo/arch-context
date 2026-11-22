import { normalizeExistingPath, createGitRepo, createInitializedGitRepo, gitOut, rmSync, tempRepo, removeTempRepo, sleep, readText, createStartedTestDaemon } from "./runtime-test-fixtures";
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { verify } from "node:crypto";
import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync as nodeRmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { computeWorktreeDigest, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { emptyArchitectureLedgerEvidenceState, planYamlToArchitectureLedgerImport, projectArchitectureLedgerStateToYamlFiles, type ArchitectureLedgerGraphState } from "@archcontext/core/architecture-ledger";
import { ARCHITECTURE_DOCS_RENDERER_VERSION, digestJson, stableYaml, type ProjectionRequestV1, type ProjectionResultV3, type StateMachineV1, type CodeFactsPort, type Json, type ModelStorePort, type NormalizedCodeContext } from "@archcontext/contracts";
import { gitSpy } from "../../codegraph-adapter/test/git-spy";
import { syncCodeGraphFixture } from "../../codegraph-adapter/test/real-index";
import { assertNoCodeGraphInternalPathAccess, CodeGraphAdapter, CodeGraphSdkProvider, REQUIRED_CODEGRAPH_VERSION, loadCapabilityCodeGraphProjectionInputs, prepareArchitectureDocumentationProjectionSnapshot } from "@archcontext/local-runtime/codegraph-adapter";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { MockCodeGraphProvider, declareOptionalCodeFacts } from "@archcontext/local-runtime/test/codegraph-factories";
import { SQLITE_PRAGMAS, SqliteLocalStore, localStoreWriterOwnershipPath } from "@archcontext/local-runtime/local-store-sqlite";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { runArchitectureDebtCommand } from "@archcontext/local-runtime/architecture-debt";
import { extractSchemaVersion, initializeArchContextModel, listModelFiles, planGeneratedProjection, YamlModelStore } from "@archcontext/local-runtime/model-store-yaml";
import { ChangeSetEngine, type ApplyOptions, type ChangeSetDraft } from "@archcontext/core/changeset-engine";
import { architectureDocumentationSourceDigest, architectureDocumentationProjectionWorktreeDigest, loadAgentContextProjectionFiles, loadArchitectureDocumentationInputs, loadCapabilitySourceScaleSignals, loadNativeModelFromArchContext, projectionOwnedWriteBody, renderAgentContextProjection, renderArchitectureDocumentationProjection, type ArchitectureProjectionProfile } from "@archcontext/core/projection-engine";
import * as projectionEngine from "@archcontext/core/projection-engine";
import { runArchitectureDocsProjectionCommand } from "../src/projection-adoption";
import { runProjectionProtocolCommand } from "../src/projection-protocol";
import { architectureHistoryRenderInput, buildArchitectureDocsProjection, currentProjectionExpectedSnapshot } from "../src/projection-service";
import { assertProductionRuntimeDeps, createStartedProductionDaemon, createStartedDaemon, runtimeDefaultClock } from "../src/index";

const PREVIOUS_ARCHCONTEXT_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const RUNTIME_TEST_STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-runtime-state-"));
const WINDOWS_RUNTIME_IO_TEST_TIMEOUT_MS = process.platform === "win32" ? 30_000 : 5_000;
process.env.ARCHCONTEXT_STATE_DIR = RUNTIME_TEST_STATE_ROOT;

afterAll(() => {
  if (PREVIOUS_ARCHCONTEXT_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_ARCHCONTEXT_STATE_DIR;
  rmSync(RUNTIME_TEST_STATE_ROOT, { recursive: true, force: true });
});

async function waitForStdoutLine(child: ChildProcess, line: string, timeoutMs = 30_000): Promise<void> {
  await new Promise<void>((resolveLine, rejectLine) => {
    let buffered = "";
    const timer = setTimeout(() => rejectLine(new Error(`child did not print ${line} within ${timeoutMs}ms`)), timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      rejectLine(new Error(`child exited with ${code} before printing ${line}`));
    });
    child.stdout!.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      if (buffered.split("\n").includes(line)) {
        clearTimeout(timer);
        resolveLine();
      }
    });
  });
}

function projectionTestProvenance(root: string, model: ReturnType<typeof loadNativeModelFromArchContext>) {
  return prepareArchitectureDocumentationProjectionSnapshot(root, model).provenance;
}

function writeArchitectureDocsProjection(root: string, profile: ArchitectureProjectionProfile = "default"): void {
  const loaded = loadArchitectureDocumentationInputs(root, profile);
  const sourceDigest = architectureDocumentationSourceDigest({
    model: loaded.model,
    profile,
    decisions: loaded.decisions
  });
  const plan = renderArchitectureDocumentationProjection({
    model: loaded.model,
    profile,
    decisions: loaded.decisions,
    existingFiles: loaded.existingFiles,
    sourceScaleSignals: loadCapabilitySourceScaleSignals(root, loaded.model, listGitVisibleFiles(root)),
    ...loadCapabilityCodeGraphProjectionInputs(root, loaded.model),
    sourceDigest,
    provenance: projectionTestProvenance(root, loaded.model),
    ...architectureHistoryRenderInput(root, profile, loaded.existingFiles, false)
  });
  for (const file of [
    ...plan.files.map((file) => ({ path: file.path, body: file.body })),
    plan.manifest
  ]) {
    const absolute = resolve(root, file.path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, file.body, "utf8");
  }
}

/** The `render_projection` operation `archctx docs plan|apply` builds, for the ChangeSet path. */
function architectureDocsProjectionOperation(root: string) {
  const loaded = loadArchitectureDocumentationInputs(root);
  const plan = renderArchitectureDocumentationProjection({
    model: loaded.model,
    decisions: loaded.decisions,
    existingFiles: loaded.existingFiles,
    sourceScaleSignals: loadCapabilitySourceScaleSignals(root, loaded.model, listGitVisibleFiles(root)),
    ...loadCapabilityCodeGraphProjectionInputs(root, loaded.model),
    sourceDigest: architectureDocumentationSourceDigest({ model: loaded.model, decisions: loaded.decisions }),
    provenance: projectionTestProvenance(root, loaded.model)
  });
  return {
    op: "render_projection" as const,
    expectedHash: "missing",
    projectionFiles: [...plan.files.map((file) => ({ path: file.path, body: file.body })), plan.manifest]
      .map((file) => ({ path: file.path, expectedHash: currentBodyHash(root, file.path), body: projectionOwnedWriteBody(file.body, currentBody(root, file.path)) }))
  };
}

/** `archctx docs apply` end to end: render, plan the ChangeSet, apply it. */
async function applyArchitectureDocsProjection(
  root: string,
  daemon: { planUpdate: Function; applyUpdate: Function },
  changeSetId: string
): Promise<void> {
  const plan = await daemon.planUpdate(root, {
    id: changeSetId,
    reason: { taskSessionId: "task_docs_projection" },
    operations: [architectureDocsProjectionOperation(root)]
  });
  expect(plan.ok).toBe(true);
  const apply = await daemon.applyUpdate(root, {
    id: changeSetId,
    approved: true,
    expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
  });
  expect(apply.ok).toBe(true);
}

const CAPABILITY_TARGET_ID = "projection_target.entity.capability-architecture-context";

/** The committed manifest row of one projection target. */
function projectionManifestRow(root: string, targetId: string): { path: string; outputDigest: string } {
  const manifest = JSON.parse(readText(join(root, "docs/architecture/.projection-manifest.json")));
  return manifest.targets[targetId];
}

/** The `render_agent_context` operation `archctx agent-context plan|apply` builds. */
function agentContextProjectionOperation(root: string) {
  const model = loadNativeModelFromArchContext(root);
  const plan = renderAgentContextProjection({
    model,
    existingFiles: loadAgentContextProjectionFiles(root, model)
  });
  return {
    op: "render_agent_context" as const,
    expectedHash: "missing",
    projectionFiles: plan.files.map((file) => ({
      path: file.path,
      expectedHash: currentBodyHash(root, file.path),
      body: projectionOwnedWriteBody(file.body, currentBody(root, file.path))
    }))
  };
}

function currentBody(root: string, path: string): string | undefined {
  const absolute = resolve(root, path);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
}

function currentBodyHash(root: string, path: string): string {
  const body = currentBody(root, path);
  return body === undefined ? "missing" : digestJson({ body } as unknown as Json);
}

function countingCheckpointFacts(): { port: CodeFactsPort; counts: () => { sync: number; buildTaskContext: number } } {
  let sync = 0;
  let buildTaskContext = 0;
  const port: CodeFactsPort = {
    async ensureReady() {
      return {
        provider: "codegraph",
        version: "1.0.1",
        schemaDigest: `sha256:${"f".repeat(64)}`,
        indexedAt: "2026-06-19T00:00:00.000Z",
        workspaceDigest: `sha256:${"1".repeat(64)}`
      };
    },
    async sync() {
      sync += 1;
      return {
        provider: "codegraph",
        version: "1.0.1",
        schemaDigest: `sha256:${"f".repeat(64)}`,
        indexedAt: "2026-06-19T00:00:00.000Z",
        workspaceDigest: `sha256:${"1".repeat(64)}`
      };
    },
    async buildTaskContext(input) {
      buildTaskContext += 1;
      const symbols = [
        { id: "symbol.legacyWrapperV1", name: "legacyWrapperV1", kind: "public-api", path: "src/billing/legacy-wrapper-v1.ts" },
        { id: "symbol.fallbackMapperV2", name: "fallbackMapperV2", kind: "public-api", path: "src/billing/fallback-mapper-v2.ts" }
      ].slice(0, input.maxSymbols);
      return {
        task: input.task,
        symbols,
        edges: [{ source: "symbol.legacyWrapperV1", target: "symbol.fallbackMapperV2", kind: "imports", confidence: "high" }],
        evidence: [],
        digest: digestJson({ task: input.task, symbols } as any)
      } satisfies NormalizedCodeContext;
    },
    async findSymbols() {
      return [];
    },
    async resolveEvidence() {
      return [];
    }
  };
  return { port, counts: () => ({ sync, buildTaskContext }) };
}

function mutableCycleFacts(): { port: CodeFactsPort; setCycle: (enabled: boolean) => void } {
  let cycle = false;
  const port: CodeFactsPort = {
    async ensureReady() {
      return {
        provider: "codegraph",
        version: "1.0.1",
        schemaDigest: `sha256:${"f".repeat(64)}`,
        indexedAt: "2026-06-19T00:00:00.000Z",
        workspaceDigest: `sha256:${"1".repeat(64)}`
      };
    },
    async sync() {
      return {
        provider: "codegraph",
        version: "1.0.1",
        schemaDigest: `sha256:${"f".repeat(64)}`,
        indexedAt: "2026-06-19T00:00:00.000Z",
        workspaceDigest: `sha256:${"1".repeat(64)}`
      };
    },
    async buildTaskContext(input) {
      const symbols = [
        { id: "module.orders", name: "OrdersModule", kind: "module", path: "src/orders.ts" },
        { id: "module.billing", name: "BillingModule", kind: "module", path: "src/billing.ts" }
      ].slice(0, input.maxSymbols);
      const edges = cycle
        ? [
          { source: "module.orders", target: "module.billing", kind: "imports" as const, confidence: "high" as const },
          { source: "module.billing", target: "module.orders", kind: "imports" as const, confidence: "high" as const }
        ]
        : [
          { source: "module.orders", target: "module.billing", kind: "imports" as const, confidence: "high" as const }
        ];
      return {
        task: input.task,
        symbols,
        edges,
        evidence: [],
        digest: digestJson({ task: input.task, cycle } as any)
      } satisfies NormalizedCodeContext;
    },
    async findSymbols() {
      return [];
    },
    async resolveEvidence() {
      return [];
    }
  };
  return { port, setCycle: (enabled) => { cycle = enabled; } };
}

describe("local runtime foundation", () => {
  test("prepare seeds a stable baseline, debt checkpoint leaves it unchanged, explicit practice writer advances it", async () => {
    const root = tempRepo();
    initializeArchContextModel(root, "Read/Writer Cutover");
    const facts = mutableCycleFacts();
    const store = new TestLocalStore();
    const daemon = await createStartedTestDaemon({ codeFacts: facts.port, localStore: store });
    const key = `practice-checkpoint:${repositoryFingerprint(root)}:task_cutover`;
    try {
      const task = "untangle dependency cycle between billing and orders";
      expect((await daemon.prepare(root, task, 12_288, 5, "task_cutover")).ok).toBe(true);
      const before = structuredClone(await store.readTaskState(key)) as any;
      expect((await daemon.prepare(root, task, 12_288, 5, "task_cutover")).ok).toBe(true);
      expect((await store.readTaskState(key) as any).snapshot).toEqual(before.snapshot);
      facts.setCycle(true);
      const read = runArchitectureDebtCommand(root, { changedPaths: ["src/orders.ts"] });
      expect(read.ok).toBe(true);
      expect((read.data as any).schemaVersion).toBe("archcontext.architecture-debt/v1");
      expect((await store.readTaskState(key) as any).snapshot).toEqual(before.snapshot);
      const writer = await daemon.practiceCheckpoint(root, { taskSessionId: "task_cutover", event: "post-edit", changedPaths: ["src/orders.ts"] });
      expect(writer.ok).toBe(true);
      expect((writer.data as any).delta.added.map((match: any) => match.practiceId)).toContain("modularity.no-new-cycle");
      const next = structuredClone(await store.readTaskState(key)) as any;
      expect(next.snapshot).not.toEqual(before.snapshot);
      const repeated = await daemon.practiceCheckpoint(root, { taskSessionId: "task_cutover", event: "post-edit", changedPaths: ["src/orders.ts"] });
      // A fresh result advances the baseline, so the next key differs; the stable no-op can coalesce.
      expect((repeated.data as any).reasonCode).toBe("no-op");
      const coalesced = await daemon.practiceCheckpoint(root, { taskSessionId: "task_cutover", event: "post-edit", changedPaths: ["src/orders.ts"] });
      expect((coalesced.data as any).hook.coalesced).toBe(true);
      expect((await store.readTaskState(key) as any).snapshot).toEqual(next.snapshot);
      rmSync(join(root, ".archcontext/manifest.yaml"));
      const failedRead = runArchitectureDebtCommand(root);
      expect(failedRead).toMatchObject({ ok: false, error: { code: "AC_MODEL_ADOPTION_REQUIRED" } });
      expect((await store.readTaskState(key) as any).snapshot).toEqual(next.snapshot);
      const failedWriter = await daemon.practiceCheckpoint(root, { taskSessionId: "task_cutover" });
      expect(failedWriter.ok).toBe(false);
      expect((await store.readTaskState(key) as any).snapshot).toEqual(next.snapshot);
    } finally {
      await daemon.stop();
      removeTempRepo(root);
    }
  });
  test("init, validate, sync, context, and status share one runtime session", async () => {
    const root = tempRepo();
    try {
      const daemon = await createStartedTestDaemon();
      const init = await daemon.init(root, "Test App");
      expect(init.ok).toBe(true);
      expect(readFileSync(join(root, ".archcontext/manifest.yaml"), "utf8")).toContain("archcontext.manifest/v1");
      mkdirSync(join(root, ".archcontext/decisions"), { recursive: true });
      writeFileSync(
        join(root, ".archcontext/decisions/ADR-0001-test.md"),
        "---\nschemaVersion: archcontext.adr/v1\nid: adr.0001.test\n---\n# Test\n",
        "utf8"
      );
      expect(listModelFiles(root).map((file) => file.path)).toContain(".archcontext/decisions/ADR-0001-test.md");

      const validateA = await daemon.validate(root);
      const validateB = await daemon.validate(root);
      expect(validateA).toEqual(validateB);
      expect((validateA.data as any).valid).toBe(true);

      const sync = await daemon.sync(root);
      expect(sync.ok).toBe(true);
      expect(sync.data).toMatchObject({
        schemaVersion: "archcontext.sync/v2",
        worktreeDigest: expect.stringMatching(/^sha256:/),
        modelDigest: expect.stringMatching(/^sha256:/)
      });

      const context = await daemon.context(root, "add billing");
      expect(context.ok).toBe(true);
      expect((context.data as any).schemaVersion).toBe("archcontext.task-context/v1");
      expect((context.data as any).resources.length).toBeGreaterThanOrEqual(3);

      const prepare = await daemon.prepare(root, "remove legacy v1 wrapper", 12_288, 2, "task_runtime_test");
      expect(prepare.ok).toBe(true);
      const checkpoint = await daemon.practiceCheckpoint(root, {
        taskSessionId: "task_runtime_test",
        event: "post-edit",
        changedPaths: ["src/example.ts"],
        maxItems: 2
      });
      expect((checkpoint.data as any).schemaVersion).toBe("archcontext.practice-checkpoint/v1");
      expect((checkpoint.data as any).reasonCode).toBe("no-op");
      expect((checkpoint.data as any).delta.unchanged.length).toBeGreaterThan(0);
      expect((checkpoint.data as any).debt.schemaVersion).toBe("archcontext.architecture-debt/v1");
      expect((checkpoint.data as any).debt.checks.find((check: any) => check.check === "dependencies").coverage).toBe("unknown");

      const status = await daemon.runtimeStatus(root);
      expect((status.data as any).repositoryId).toBe(repositoryFingerprint(root));
      expect((status.data as any).worktreeDigest).toMatch(/^sha256:/);
      expect(daemon.status().sessions).toBe(1);
    } finally {
      removeTempRepo(root);
    }
  });

  test("checkpoint coalesces repeated hook events without re-running analysis", async () => {
    const root = tempRepo();
    initializeArchContextModel(root, "Checkpoint Debt App");
    const facts = countingCheckpointFacts();
    try {
      const daemon = await createStartedTestDaemon({ codeFacts: facts.port });
      const prepare = await daemon.prepare(root, "remove legacy v1 wrapper", 12_288, 3, "task_coalesce");
      expect(prepare.ok).toBe(true);
      expect(facts.counts().buildTaskContext).toBe(1);

      const input = {
        taskSessionId: "task_coalesce",
        event: "post-edit" as const,
        changedPaths: ["src/billing/legacy-wrapper-v1.ts"],
        toolCallId: "toolu_coalesce",
        maxItems: 3
      };
      const first = await daemon.practiceCheckpoint(root, input);
      expect((first.data as any).hook.coalesced).toBe(false);
      expect(facts.counts()).toEqual({ sync: 1, buildTaskContext: 2 });

      let last = first;
      for (let index = 0; index < 9; index += 1) {
        last = await daemon.practiceCheckpoint(root, input);
      }
      expect((last.data as any).hook.coalesced).toBe(true);
      expect((last.data as any).hook.skippedAnalysis).toBe(true);
      expect((last.data as any).hook.coalescedEventCount).toBe(10);
      expect((last.data as any).resultDigest).toBe((first.data as any).resultDigest);
      expect((last.data as any).debt).toEqual((first.data as any).debt);
      expect(facts.counts()).toEqual({ sync: 1, buildTaskContext: 2 });
    } finally {
      removeTempRepo(root);
    }
  });

  test("checkpoint restores persisted baseline after daemon restart", async () => {
    const root = tempRepo();
    initializeArchContextModel(root, "Checkpoint Debt Restart App");
    const facts = mutableCycleFacts();
    const store = new TestLocalStore();
    let first: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    let second: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      first = await createStartedTestDaemon({ codeFacts: facts.port, localStore: store });
      const prepare = await first.prepare(root, "untangle dependency cycle between billing and orders", 12_288, 5, "task_restart");
      expect(prepare.ok).toBe(true);
      await first.stop();
      first = undefined;

      facts.setCycle(true);
      second = await createStartedTestDaemon({ codeFacts: facts.port, localStore: store });
      const checkpoint = await second.practiceCheckpoint(root, {
        taskSessionId: "task_restart",
        event: "post-edit",
        changedPaths: ["src/orders.ts", "src/billing.ts"],
        maxItems: 5
      });

      expect(checkpoint.ok).toBe(true);
      expect((checkpoint.data as any).reasonCode).toBe("fresh");
      expect((checkpoint.data as any).previousPracticeGuidanceDigest).toMatch(/^sha256:/);
      expect((checkpoint.data as any).delta.added.map((match: any) => match.practiceId)).toContain("modularity.no-new-cycle");
      expect((checkpoint.data as any).hook.coalesced).toBe(false);
    } finally {
      await first?.stop();
      await second?.stop();
      removeTempRepo(root);
    }
  });

  test("complete_task applies repo opt-in deterministic practice enforcement from daemon-owned state", async () => {
    const root = tempRepo();
    const facts = mutableCycleFacts();
    try {
      const daemon = await createStartedTestDaemon({ codeFacts: facts.port });
      await daemon.init(root, "Practice Enforcement App");
      mkdirSync(join(root, ".archcontext/policies"), { recursive: true });
      writeFileSync(join(root, ".archcontext/policies/practices.yaml"), JSON.stringify({
        schemaVersion: "archcontext.practice-enforcement-policy/v1",
        mode: "active",
        rules: [
          {
            practiceId: "modularity.no-new-cycle",
            enforcement: "complete",
            checkIds: ["no-new-cycle"]
          }
        ]
      }, null, 2), "utf8");

      const prepare = await daemon.prepare(root, "remove import cycle", 12_288, 5, "task_enforcement");
      expect(prepare.ok).toBe(true);
      facts.setCycle(true);

      const review = await daemon.completeTask(root, {
        taskSessionId: "task_enforcement",
        task: "remove import cycle"
      });

      expect(review.ok).toBe(true);
      expect((review.data as any).result).toBe("fail_action_required");
      expect((review.data as any).practiceViolations).toHaveLength(1);
      expect((review.data as any).practiceViolations[0]).toMatchObject({
        practiceId: "modularity.no-new-cycle",
        checkId: "no-new-cycle",
        status: "fail",
        deterministic: true
      });
      expect((review.data as any).debt.items.filter((item: any) => item.kind === "practice-regression")).toHaveLength(1);
      expect((review.data as any).findings.filter((finding: any) => finding.type === "practice-violation")).toHaveLength(1);
      const practiceDebtIds = (review.data as any).debt.items.filter((item: any) => item.kind === "practice-regression").map((item: any) => item.id);
      expect((review.data as any).findings.some((finding: any) => practiceDebtIds.includes(finding.id))).toBe(false);
      expect((review.data as any).snapshot.practiceCatalogDigest).toMatch(/^sha256:/);
      expect((review.data as any).snapshot.practicePolicyDigest).toMatch(/^sha256:/);
      expect((review.data as any).snapshot.practiceCheckResultDigest).toMatch(/^sha256:/);
    } finally {
      removeTempRepo(root);
    }
  });

  test("complete_task reports fail-open practice policy findings without blocking completion", async () => {
    const root = tempRepo();
    const facts = mutableCycleFacts();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ codeFacts: facts.port });
      await daemon.init(root, "Practice Fail Open App");
      // This test isolates its named gate; declare source ownership so scaffold files are not debt.
      writeFileSync(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`, "utf8");
      mkdirSync(join(root, ".archcontext/policies"), { recursive: true });
      writeFileSync(join(root, ".archcontext/policies/practices.yaml"), JSON.stringify({
        schemaVersion: "archcontext.practice-enforcement-policy/v1",
        mode: "fail-open",
        rules: [
          {
            practiceId: "modularity.no-new-cycle",
            enforcement: "complete",
            checkIds: ["no-new-cycle"]
          }
        ]
      }, null, 2), "utf8");

      const prepare = await daemon.prepare(root, "remove import cycle", 12_288, 5, "task_fail_open");
      expect(prepare.ok).toBe(true);
      facts.setCycle(true);

      const review = await daemon.completeTask(root, {
        taskSessionId: "task_fail_open",
        task: "remove import cycle"
      });

      expect(review.ok).toBe(true);
      expect((review.data as any).result).toBe("pass_with_warnings");
      expect((review.data as any).summary).toMatchObject({ errors: 0, warnings: 2 });
      expect((review.data as any).practiceViolations).toEqual([]);
      expect((review.data as any).actionsRequired).toEqual([]);
      expect((review.data as any).findings).toContainEqual(expect.objectContaining({
        id: "practice-advisory:modularity.no-new-cycle:no-new-cycle",
        type: "practice-advisory",
        severity: "warning"
      }));
      expect((review.data as any).extensions.nonBlockingPracticeViolations).toHaveLength(1);
      expect((review.data as any).snapshot.practiceCatalogDigest).toMatch(/^sha256:/);
      expect((review.data as any).snapshot.practicePolicyDigest).toMatch(/^sha256:/);
      expect((review.data as any).snapshot.practiceCheckResultDigest).toMatch(/^sha256:/);
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("complete_task blocks active documentation projection drift until projections are reconciled", async () => {
    // Git-backed: the documentation projection stamps `Verified against: <branch>@<commit>` and
    // fails closed when the Git state is unreadable, so this gate needs a real repository root.
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-06-26T10:40:00.000Z" });
      await daemon.init(root, "Projection Gate App");
      // This test isolates its named gate; declare source ownership so scaffold files are not debt.
      writeFileSync(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`, "utf8");
      // No CodeGraph index here: required code facts would refuse complete_task (#279).
      declareOptionalCodeFacts(root);

      const beforeActivation = await daemon.completeTask(root, {
        taskSessionId: "task_projection_gate",
        task: "finish non-architecture setup before docs projection activation"
      });
      expect(beforeActivation.ok).toBe(true);
      expect((beforeActivation.data as any).snapshot.projectionDigest).toBeUndefined();

      mkdirSync(join(root, "docs/architecture"), { recursive: true });
      const profileManifest = join(root, "docs/architecture/.projection-manifest.json");
      for (const profile of [undefined, "unknown/v1", null]) {
        writeFileSync(profileManifest, JSON.stringify({ profile }), "utf8");
        await expect(daemon.completeTask(root, { taskSessionId: "task_invalid_profile" }))
          .resolves.toMatchObject({ ok: false, error: { code: "AC_UNCLASSIFIED_FAILURE", reasonCode: "failure-unclassified", action: "inspect-diagnostics", retryable: false, details: { stage: "complete" } } });
      }
      writeFileSync(profileManifest, JSON.stringify({ profile: "default" }), "utf8");
      const drifted = await daemon.completeTask(root, {
        taskSessionId: "task_projection_gate",
        task: "finish architecture projection update"
      });
      expect(drifted.ok).toBe(true);
      expect((drifted.data as any).result).toBe("fail_action_required");
      expect((drifted.data as any).findings).toContainEqual(expect.objectContaining({
        id: "projection-drift",
        type: "projection-drift",
        severity: "error"
      }));
      expect((drifted.data as any).extensions.projectionDriftGate.reasonCodes).toContain("projection-file-missing");

      writeArchitectureDocsProjection(root);
      const clean = await daemon.completeTask(root, {
        taskSessionId: "task_projection_gate",
        task: "finish architecture projection update"
      });
      expect(clean.ok).toBe(true);
      expect((clean.data as any).result).toBe("pass_with_warnings");
      expect((clean.data as any).snapshot.projectionDigest).toMatch(/^sha256:/);
      expect((clean.data as any).findings.some((finding: any) => finding.id === "projection-drift")).toBe(false);

      const manifestPath = join(root, "docs/architecture/.projection-manifest.json");
      writeFileSync(manifestPath, readText(manifestPath).replace(
        ARCHITECTURE_DOCS_RENDERER_VERSION,
        "archcontext.docs-renderer/tampered"
      ), "utf8");
      const tamperedManifest = await daemon.completeTask(root, {
        taskSessionId: "task_projection_gate",
        task: "finish with a tampered projection manifest"
      });
      expect((tamperedManifest.data as any).result).toBe("fail_action_required");
      expect((tamperedManifest.data as any).extensions.projectionDriftGate.reasonCodes)
        .toContain("projection-manifest-stale");
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("complete_task refuses with AC_CODE_FACTS_UNAVAILABLE when required code facts have no index (#279)", async () => {
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-06-26T10:40:00.000Z" });
      await daemon.init(root, "Projection Code Facts App");
      // The default manifest requires code facts, and this fixture never runs `codegraph init`.
      expect(readText(join(root, ".archcontext/manifest.yaml"))).toMatch(/^codeFacts:\n(?: {2}.*\n)*? {2}required: true$/m);
      expect(existsSync(join(root, ".codegraph"))).toBe(false);
      writeArchitectureDocsProjection(root);
      const refused = await daemon.completeTask(root, {
        taskSessionId: "task_projection_code_facts",
        task: "finish with an active projection and no CodeGraph index"
      });
      expect(refused.ok, JSON.stringify(refused)).toBe(false);
      expect(refused.requestId).toBe("complete_task");
      expect(refused.error).toMatchObject({
        code: "AC_CODE_FACTS_UNAVAILABLE",
        reasonCode: "index-missing",
        retryable: true,
        action: "codegraph-init"
      });
      expect(refused.error?.message).toContain("codegraph init");
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("complete_task blocks a projection whose declared source now renders a different document", async () => {
    // Git-backed so the "outside the footprint" case is a real commit; the gate itself compares the
    // committed manifest rows with one render of the current tree and reads no Git history.
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-08-08T10:40:00.000Z" });
      await daemon.init(root, "Freshness Gate App");
      declareOptionalCodeFacts(root);
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`,
        "utf8"
      );
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/app.ts"), "export const app = 1;\n", "utf8");
      gitCommitAll(root, "declare capability source");
      writeArchitectureDocsProjection(root);

      const verified = projectionManifestRow(root, CAPABILITY_TARGET_ID);
      const fresh = await daemon.completeTask(root, {
        taskSessionId: "task_projection_freshness",
        task: "finish with the projection verified against the current source"
      });
      expect(fresh.ok).toBe(true);
      expect((fresh.data as any).result).toBe("pass_with_warnings");
      expect((fresh.data as any).extensions.projectionFreshnessGate).toBeUndefined();

      // A commit outside every declared footprint leaves both projection gates silent: no render
      // input reads Git history, so a moved HEAD alone is not drift either.
      writeFileSync(join(root, "NOTES.md"), "# notes\n", "utf8");
      gitCommitAll(root, "change outside the declared footprint");
      const stillFresh = await daemon.completeTask(root, {
        taskSessionId: "task_projection_freshness",
        task: "finish after an unrelated commit"
      });
      expect((stillFresh.data as any).result).toBe("pass_with_warnings");
      expect((stillFresh.data as any).findings.some((finding: any) => finding.id === "stale-context")).toBe(false);
      expect((stillFresh.data as any).extensions.projectionFreshnessGate).toBeUndefined();

      // A second line inside `source.include` moves the capability's line count from the 1–2 bucket
      // into 2–5, which the capability document prints.
      writeFileSync(join(root, "src/app.ts"), "export const app = 1;\nexport const extra = 2;\n", "utf8");
      gitCommitAll(root, "change inside the declared footprint");
      const stale = await daemon.completeTask(root, {
        taskSessionId: "task_projection_freshness",
        task: "finish after changing the declared capability source"
      });
      expect((stale.data as any).result).toBe("fail_action_required");
      const finding = (stale.data as any).findings.find((entry: any) => entry.id === "stale-context");
      expect(finding.type).toBe("stale-context");
      expect(finding.message).toContain("Architecture documentation projection would render differently (projection-output-changed)");
      expect(finding.message).toContain(CAPABILITY_TARGET_ID);
      const gate = (stale.data as any).extensions.projectionFreshnessGate;
      expect(gate.ok).toBe(false);
      expect(gate.reasonCodes).toEqual(["projection-output-changed"]);
      expect(gate.staleTargets).toEqual([{
        targetId: CAPABILITY_TARGET_ID,
        path: verified.path,
        committedOutputDigest: verified.outputDigest,
        renderedOutputDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
      }]);
      expect(gate.staleTargets[0].renderedOutputDigest).not.toBe(verified.outputDigest);
      // Freshness that is not ok implies drift that is not ok.
      expect((stale.data as any).extensions.projectionDriftGate.ok).toBe(false);

      // Re-running the projection records the new output and clears the finding.
      writeArchitectureDocsProjection(root);
      const reprojected = await daemon.completeTask(root, {
        taskSessionId: "task_projection_freshness",
        task: "finish after refreshing the projection"
      });
      expect((reprojected.data as any).findings.some((entry: any) => entry.id === "stale-context")).toBe(false);
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("complete_task grades a repo-harness/v1 projection by the documents that profile renders (#290)", async () => {
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-08-08T10:40:00.000Z" });
      await daemon.init(root, "Profile Freshness App");
      declareOptionalCodeFacts(root);
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/app/**"\nextensions:\n  contractFiles:\n    agents: "AGENTS.md"\n    claude: "CLAUDE.md"\n`,
        "utf8"
      );
      // A member with its own footprint: repo-harness/v1 writes no document for it, but prints its
      // scale in the capability document's component table.
      writeFileSync(
        join(root, ".archcontext/model/nodes/component.architecture-context.engine.yaml"),
        [
          "schemaVersion: \"archcontext.node/v2\"",
          "id: \"component.architecture-context.engine\"",
          "kind: \"component\"",
          "name: \"Engine\"",
          "status: \"active\"",
          "parent: \"capability.architecture.context\"",
          "source:",
          "  include:",
          "    - \"src/engine/**\"",
          ""
        ].join("\n"),
        "utf8"
      );
      mkdirSync(join(root, "src/app"), { recursive: true });
      mkdirSync(join(root, "src/engine"), { recursive: true });
      writeFileSync(join(root, "src/app/index.ts"), "export const app = 1;\n", "utf8");
      writeFileSync(join(root, "src/engine/index.ts"), "export const engine = 1;\n", "utf8");
      gitCommitAll(root, "declare capability and member source");
      writeArchitectureDocsProjection(root, "repo-harness/v1");

      const fresh = await daemon.completeTask(root, {
        taskSessionId: "task_projection_profile_freshness",
        task: "finish with a repo-harness projection verified against the current source"
      });
      expect((fresh.data as any).extensions.projectionFreshnessGate).toBeUndefined();
      expect((fresh.data as any).findings.some((entry: any) => entry.id === "stale-context")).toBe(false);

      // The member's footprint is outside the capability's footprint, but a second line moves the
      // member's line bucket, which the capability document prints, so the capability is stale.
      writeFileSync(join(root, "src/engine/index.ts"), "export const engine = 1;\nexport const extra = 2;\n", "utf8");
      gitCommitAll(root, "change the member source");
      const stale = await daemon.completeTask(root, {
        taskSessionId: "task_projection_profile_freshness",
        task: "finish after changing the member source"
      });
      expect((stale.data as any).result).toBe("fail_action_required");
      const gate = (stale.data as any).extensions.projectionFreshnessGate;
      expect(gate.ok).toBe(false);
      expect(gate.reasonCodes).toEqual(["projection-output-changed"]);
      expect(gate.staleTargets.map((entry: any) => entry.targetId)).toEqual([CAPABILITY_TARGET_ID]);
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("committing the projection itself does not block the next complete_task", async () => {
    // plan → apply → commit the projection → complete, with no second projection run in between.
    // No render input reads Git history or a projection-owned path, so committing the projection
    // does not invalidate it.
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-08-08T10:40:00.000Z" });
      await daemon.init(root, "Projection Fixed Point App");
      declareOptionalCodeFacts(root);
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`,
        "utf8"
      );
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/app.ts"), "export const app = 1;\n", "utf8");
      gitCommitAll(root, "declare capability source");

      const appliedAtCommit = gitOut(root, "rev-parse", "HEAD");
      const plan = await daemon.planUpdate(root, {
        id: "changeset.docs-fixed-point",
        reason: { taskSessionId: "task_docs_projection" },
        operations: [architectureDocsProjectionOperation(root)]
      });
      expect(plan.ok).toBe(true);
      expect((plan.data as any).preview.allowed).toBe(true);
      const apply = await daemon.applyUpdate(root, {
        id: "changeset.docs-fixed-point",
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      });
      expect(apply.ok).toBe(true);

      // Commit the projection output. HEAD now differs from the commit the projection ran on.
      gitCommitAll(root, "project architecture documentation");
      expect(gitOut(root, "rev-parse", "HEAD")).not.toBe(appliedAtCommit);
      expect(gitOut(root, "status", "--porcelain")).toBe("");

      const complete = await daemon.completeTask(root, {
        taskSessionId: "task_docs_projection",
        task: "finish right after committing the projection, without re-projecting"
      });
      expect(complete.ok).toBe(true);
      expect((complete.data as any).extensions.projectionDriftGate).toBeUndefined();
      expect((complete.data as any).extensions.projectionFreshnessGate).toBeUndefined();
      expect((complete.data as any).findings).toEqual([expect.objectContaining({
        type: "architecture-debt-coverage", severity: "warning"
      })]);
      expect((complete.data as any).result).toBe("pass_with_warnings");

      // The manifest records rendered outputs and names no commit, so nothing in it can dangle
      // after a squash merge — and the document itself names no commit at all.
      const manifest = readText(join(root, "docs/architecture/.projection-manifest.json"));
      expect(manifest).not.toContain(appliedAtCommit);
      expect(manifest).not.toMatch(/"(?:baseHeadSha|worktreeDigest|verifiedAgainst)"/);
      expect(readText(join(root, "docs/architecture/modules/capability-architecture-context.md")))
        .not.toContain(appliedAtCommit);
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("a covered source edit that moves no rendered assertion keeps complete_task passing without re-projecting", async () => {
    // The fixed point (ADR-0056). An edit inside the capability footprint that changes nothing the
    // document asserts (same file count bucket, same line count bucket, same import edges) renders
    // every target and the manifest byte-identically, so freshness and drift both stay ok.
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-08-08T10:40:00.000Z" });
      await daemon.init(root, "Projection Deadlock App");
      declareOptionalCodeFacts(root);
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`,
        "utf8"
      );
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/app.ts"), "export const app = 1;\n", "utf8");
      gitCommitAll(root, "declare capability source");

      await applyArchitectureDocsProjection(root, daemon, "changeset.docs-deadlock-initial");
      gitCommitAll(root, "project architecture documentation");
      const docPath = join(root, "docs/architecture/modules/capability-architecture-context.md");
      const manifestPath = join(root, "docs/architecture/.projection-manifest.json");
      const beforeDoc = readText(docPath);
      const beforeManifest = readText(manifestPath);

      // Same line, same line count, same files, same imports: no rendered assertion moves.
      writeFileSync(join(root, "src/app.ts"), "export const app = 2;\n", "utf8");
      gitCommitAll(root, "change a literal inside the declared footprint");

      const complete = await daemon.completeTask(root, {
        taskSessionId: "task_docs_deadlock",
        task: "finish after an assertion-free change inside the footprint"
      });
      expect((complete.data as any).result).toBe("pass_with_warnings");
      expect((complete.data as any).findings).toEqual([expect.objectContaining({
        type: "architecture-debt-coverage", severity: "warning"
      })]);
      expect((complete.data as any).extensions.projectionFreshnessGate).toBeUndefined();
      expect((complete.data as any).extensions.projectionDriftGate).toBeUndefined();

      // Re-projecting writes the same bytes: there is no documentation or manifest diff to commit.
      await applyArchitectureDocsProjection(root, daemon, "changeset.docs-deadlock-idempotent");
      expect(readText(docPath)).toBe(beforeDoc);
      expect(readText(manifestPath)).toBe(beforeManifest);
      expect(gitOut(root, "status", "--porcelain")).toBe("");
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("a projection applied on a squash-merged branch stays fresh on the default branch (#257)", async () => {
    // Squash merges discard the branch commit the projection ran on. The manifest records rendered
    // outputs and never names that commit, so the default branch can still measure freshness and
    // needs no re-projection or manifest-only commit.
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-08-08T10:40:00.000Z" });
      await daemon.init(root, "Projection Squash App");
      declareOptionalCodeFacts(root);
      // Windows runners default to `core.autocrlf=true`, which would rewrite the projected documents
      // with CRLF on checkout; this test is about squash merges, so keep the checkout byte-exact.
      execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      gitCommitAll(root, "initialize architecture model");
      const defaultBranch = gitOut(root, "rev-parse", "--abbrev-ref", "HEAD");
      execFileSync("git", ["checkout", "-q", "-b", "feature/projection"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`,
        "utf8"
      );
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/app.ts"), "export const app = 1;\n", "utf8");
      gitCommitAll(root, "declare capability source");
      await applyArchitectureDocsProjection(root, daemon, "changeset.docs-squash");
      gitCommitAll(root, "project architecture documentation");
      const branchCommits = gitOut(root, "rev-list", `${defaultBranch}..HEAD`).split("\n");
      const manifestBefore = readText(join(root, "docs/architecture/.projection-manifest.json"));

      execFileSync("git", ["checkout", "-q", defaultBranch], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      execFileSync("git", ["merge", "--squash", "feature/projection"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      gitCommitAll(root, "squash: project architecture documentation");
      execFileSync("git", ["branch", "-D", "feature/projection"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      for (const commit of branchCommits) {
        expect(gitExitCode(root, "merge-base", "--is-ancestor", commit, "HEAD")).not.toBe(0);
        expect(manifestBefore).not.toContain(commit);
      }

      const complete = await daemon.completeTask(root, {
        taskSessionId: "task_docs_squash",
        task: "finish on the default branch after the squash merge"
      });
      expect((complete.data as any).result).toBe("pass_with_warnings");
      expect((complete.data as any).extensions.projectionFreshnessGate).toBeUndefined();
      expect((complete.data as any).extensions.projectionDriftGate).toBeUndefined();

      // Re-projecting on the default branch is a byte-identical no-op.
      await applyArchitectureDocsProjection(root, daemon, "changeset.docs-squash-noop");
      expect(readText(join(root, "docs/architecture/.projection-manifest.json"))).toBe(manifestBefore);
      expect(gitOut(root, "status", "--porcelain")).toBe("");
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("a core.autocrlf checkout of the projected documents passes the drift gate and re-projects in place", async () => {
    // Windows runners and developer machines check the LF documents out with CRLF. Line endings are
    // not drift; a hand edit inside a machine region still is.
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-08-08T10:45:00.000Z" });
      await daemon.init(root, "Projection CRLF App");
      declareOptionalCodeFacts(root);
      execFileSync("git", ["config", "core.autocrlf", "true"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`,
        "utf8"
      );
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/app.ts"), "export const app = 1;\n", "utf8");
      const projected = await daemon.docsProjection(root, { action: "apply", approved: true, id: "changeset.docs-crlf" });
      expect(projected).toMatchObject({ ok: true });
      gitCommitAll(root, "project architecture documentation");
      // `readText` folds CRLF; this test compares the bytes on disk.
      const rawText = (path: string) => readFileSync(path, "utf8");
      const manifestPath = join(root, "docs/architecture/.projection-manifest.json");
      const lfManifest = rawText(manifestPath);
      const docPath = join(root, "docs/architecture/modules/capability-architecture-context.md");
      const lfDoc = rawText(docPath);
      expect(lfDoc).toContain("<!-- BEGIN ARCHCONTEXT:generated");
      expect(lfDoc).not.toContain("\r");
      const checkOutWithCrlf = () => {
        rmSync(join(root, "docs/architecture"), { recursive: true, force: true });
        execFileSync("git", ["checkout", "--", "docs/architecture"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
        expect(rawText(docPath)).toBe(lfDoc.replaceAll("\n", "\r\n"));
        expect(rawText(manifestPath)).toBe(lfManifest.replaceAll("\n", "\r\n"));
      };
      checkOutWithCrlf();

      const complete = await daemon.completeTask(root, {
        taskSessionId: "task_docs_crlf",
        task: "finish on a CRLF checkout"
      });
      expect((complete.data as any).result).toBe("pass_with_warnings");
      expect((complete.data as any).extensions.projectionDriftGate).toBeUndefined();
      expect((complete.data as any).extensions.projectionFreshnessGate).toBeUndefined();

      // `archctx docs apply` on this checkout: the ChangeSet preconditions hash the CRLF bytes on
      // disk, and the write keeps each file's CRLF line endings, so Git sees no change at all.
      const reapplied = await daemon.docsProjection(root, { action: "apply", approved: true, id: "changeset.docs-crlf-reapply" });
      expect(reapplied).toMatchObject({ ok: true });
      expect(rawText(docPath)).toBe(lfDoc.replaceAll("\n", "\r\n"));
      expect(rawText(manifestPath)).toBe(lfManifest.replaceAll("\n", "\r\n"));
      expect(gitOut(root, "status", "--porcelain")).toBe("");
      const drift = await daemon.docsProjection(root, { action: "drift" });
      expect((drift.data as any).drift).toMatchObject({ ok: true, reasonCodes: [], diffs: [], orphans: [] });

      checkOutWithCrlf();
      const generatedLine = rawText(docPath).split("\r\n").findIndex((line) => line.startsWith("- 規模量級:"));
      expect(generatedLine).toBeGreaterThan(0);
      writeFileSync(docPath, rawText(docPath).split("\r\n").map((line, index) => index === generatedLine ? `${line} (hand edit)` : line).join("\r\n"), "utf8");
      const edited = await daemon.completeTask(root, {
        taskSessionId: "task_docs_crlf",
        task: "finish after a hand edit inside the machine region"
      });
      expect((edited.data as any).result).toBe("fail_action_required");
      expect((edited.data as any).extensions.projectionDriftGate.reasonCodes).toEqual(["projection-generated-region-manually-edited"]);
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("cross-process SQLite cache persists ChangeSet drafts and enforces exclusive cache lock", async () => {
    const dir = mkdtempSync(join(tmpdir(), "archctx-cache-drafts-"));
    const root = join(dir, "repo");
    const dbPath = join(dir, "state", "runtime.sqlite");
    let daemonA: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    let daemonB: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      mkdirSync(root, { recursive: true });
      execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      initializeArchContextModel(root, "Cache Drafts App");
      daemonA = await createStartedTestDaemon({ localStore: undefined, localStorePath: dbPath });
      expect(existsSync(localStoreWriterOwnershipPath(dbPath))).toBe(true);
      await expect(createStartedTestDaemon({ localStore: undefined, localStorePath: dbPath })).rejects.toMatchObject({
        code: "AC_PRECONDITION_FAILED",
        reasonCode: "runtime-writer-owned"
      });
      const plan = await daemonA.planUpdate(root, {
        id: "changeset.cross-process-draft",
        operations: [{
          op: "create_entity",
          path: ".archcontext/model/nodes/module.cross-process.yaml",
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v2\nid: module.cross-process\nkind: module\nname: Cross Process\nstatus: active\nsummary: Persisted across CLI runs\n"
        }]
      });
      expect(plan.ok).toBe(true);
      await daemonA.stop();
      daemonA = undefined;

      daemonB = await createStartedTestDaemon({ localStore: undefined, localStorePath: dbPath });
      const apply = await daemonB.applyUpdate(root, {
        id: "changeset.cross-process-draft",
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      });
      expect(apply.ok, JSON.stringify(apply)).toBe(true);
      expect(existsSync(join(root, ".archcontext/model/nodes/module.cross-process.yaml"))).toBe(true);
    } finally {
      await daemonA?.stop().catch(() => undefined);
      await daemonB?.stop().catch(() => undefined);
      removeTempRepo(dir);
    }
  });

  test("a manifest output digest that is not a digest fails closed and never reaches git (#159)", async () => {
    // The projection manifest is committed repository content, i.e. untrusted input. Freshness
    // compares rendered output digests and runs no Git command, so a hostile value such as
    // `--output=output` (which once truncated `output..HEAD` through `git diff`) can only be reported
    // as invalid.
    const root = createGitRepo();
    const sentinelDir = mkdtempSync(join(tmpdir(), "archctx-manifest-sentinel-"));
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-08-08T10:40:00.000Z" });
      await daemon.init(root, "Projection Manifest Injection App");
      declareOptionalCodeFacts(root);
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`,
        "utf8"
      );
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/app.ts"), "export const app = 1;\n", "utf8");
      gitCommitAll(root, "declare capability source");
      await applyArchitectureDocsProjection(root, daemon, "changeset.docs-manifest-injection");
      gitCommitAll(root, "project architecture documentation");

      const { outputDigest } = projectionManifestRow(root, CAPABILITY_TARGET_ID);
      const manifestPath = join(root, "docs/architecture/.projection-manifest.json");
      writeFileSync(manifestPath, readText(manifestPath).replaceAll(outputDigest, "--output=output"), "utf8");
      const sentinel = join(sentinelDir, "sentinel.txt");
      writeFileSync(sentinel, "preserve me\n", "utf8");
      const trap = join(root, "output..HEAD");
      if (process.platform !== "win32") symlinkSync(sentinel, trap);

      const complete = await daemon.completeTask(root, {
        taskSessionId: "task_manifest_injection",
        task: "complete with a hostile projection manifest"
      });
      // The manifest contract requires every output digest to be a digest, so the hostile value is
      // refused when the manifest is read, before any output is compared (#327).
      expect(complete.ok).toBe(false);
      expect((complete as any).error).toMatchObject({ code: "AC_PRECONDITION_FAILED", reasonCode: "projection-manifest-invalid" });

      expect(readText(sentinel)).toBe("preserve me\n");
      if (process.platform === "win32") expect(existsSync(trap)).toBe(false);
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
      nodeRmSync(sentinelDir, { recursive: true, force: true });
    }
  });

  test("a non-ASCII path added inside the footprint moves the rendered scale (#173)", async () => {
    // Paths enter the footprint verbatim from the filesystem, so a non-ASCII file name is counted
    // like any other — no Git quoting can hide it.
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-08-08T10:40:00.000Z" });
      await daemon.init(root, "Projection Path Framing App");
      declareOptionalCodeFacts(root);
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`,
        "utf8"
      );
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/app.ts"), "export const app = 1;\n", "utf8");
      gitCommitAll(root, "declare capability source");
      await applyArchitectureDocsProjection(root, daemon, "changeset.docs-path-framing");
      gitCommitAll(root, "project architecture documentation");
      const committed = projectionManifestRow(root, CAPABILITY_TARGET_ID);

      writeFileSync(join(root, "src/資料.ts"), "export const data = 1;\n", "utf8");
      gitCommitAll(root, "add a non-ASCII source path");

      const loaded = loadArchitectureDocumentationInputs(root);
      const scale = loadCapabilitySourceScaleSignals(root, loaded.model, listGitVisibleFiles(root))
        .find((entry) => entry.nodeId === "capability.architecture.context")!;
      // Two files move the capability from the 1–2 file bucket into 2–5.
      expect(scale.fileCount).toBe(2);
      const complete = await daemon.completeTask(root, {
        taskSessionId: "task_path_framing",
        task: "complete after adding a non-ASCII source path"
      });
      const gate = (complete.data as any).extensions.projectionFreshnessGate;
      expect(gate.reasonCodes).toEqual(["projection-output-changed"]);
      expect(gate.staleTargets.map((entry: any) => ({ targetId: entry.targetId, committedOutputDigest: entry.committedOutputDigest })))
        .toEqual([{ targetId: CAPABILITY_TARGET_ID, committedOutputDigest: committed.outputDigest }]);
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("init on an already-initialized repository is a precondition failure that changes nothing (#167)", async () => {
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-08-08T10:40:00.000Z" });
      expect((await daemon.init(root, "First App")).ok).toBe(true);
      const manifestPath = join(root, ".archcontext/manifest.yaml");
      const productPath = join(root, ".archcontext/product.yaml");
      const manifestBefore = readText(manifestPath);
      const productBefore = readText(productPath);

      const again = await daemon.init(root, "Second App");
      expect(again.ok).toBe(false);
      expect(again.error?.code).toBe("AC_PRECONDITION_FAILED");
      expect(again.error?.reasonCode).toBe("init-would-overwrite-existing-model");
      expect(readText(manifestPath)).toBe(manifestBefore);
      expect(readText(productPath)).toBe(productBefore);
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("explicit root contract projection preserves human bytes and rejects forged bodies", async () => {
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon();
      await daemon.init(root, "Root Contract App");
      const nodePath = join(root, ".archcontext/model/nodes/capability.architecture.context.yaml");
      writeFileSync(nodePath, `${readText(nodePath)}extensions:\n  contractFiles:\n    agents: "AGENTS.md"\n    claude: "CLAUDE.md"\n`);
      const human = "# Human routing\n\nKeep these trailing spaces.  \n\n\n";
      for (const path of ["AGENTS.md", "CLAUDE.md"]) writeFileSync(join(root, path), human);
      const operation = agentContextProjectionOperation(root);
      expect(operation.projectionFiles.every(file => file.body.startsWith(human))).toBe(true);
      const planned = await daemon.planUpdate(root, { id: "changeset.root-contract", reason: { taskSessionId: "task.root-contract" }, operations: [operation] });
      expect((planned.data as any).preview.allowed).toBe(true);
      const applied = await daemon.applyUpdate(root, { id: "changeset.root-contract", approved: true, expectedWorktreeDigest: (planned.data as any).draft.base.worktreeDigest });
      expect(applied.ok).toBe(true);
      expect(readText(join(root, "AGENTS.md"))).toBe(readText(join(root, "CLAUDE.md")));
      expect(agentContextProjectionOperation(root).projectionFiles).toEqual(operation.projectionFiles.map(file => ({ ...file, expectedHash: digestJson({ body: file.body }) })));
      const forged = agentContextProjectionOperation(root);
      forged.projectionFiles[0]!.body = forged.projectionFiles[0]!.body.replace("Human routing", "Attacker routing");
      const denied = await daemon.planUpdate(root, { id: "changeset.root-forged", reason: { taskSessionId: "task.root-contract" }, operations: [forged] });
      expect((denied.data as any).preview.allowed).toBe(false);
      await expect(daemon.applyUpdate(root, { id: "changeset.root-forged", approved: true, expectedWorktreeDigest: (denied.data as any).draft.base.worktreeDigest })).rejects.toThrow();
      expect(readText(join(root, "AGENTS.md"))).toBe(operation.projectionFiles.find(file => file.path === "AGENTS.md")!.body);
    } finally { await daemon?.stop(); removeTempRepo(root); }
  });

  test("repo-harness/v1 docs apply owns capability-local contract regions and writes none at the root (ADR-0056 §9, #580)", async () => {
    const root = createInitializedGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      const nodePath = join(root, ".archcontext/model/nodes/capability.architecture.context.yaml");
      const baseNode = readText(nodePath);
      const designate = (agents: string, claude: string) => writeFileSync(nodePath, `${baseNode}extensions:\n  contractFiles:\n    agents: "${agents}"\n    claude: "${claude}"\n`);
      designate("AGENTS.md", "CLAUDE.md");
      const relationPath = join(root, ".archcontext/model/relations/relation.context-journal.yaml");
      const relation = (intent: string) => JSON.stringify({ schemaVersion: "archcontext.relation/v1", id: "relation.context-journal", kind: "writes", source: "capability.architecture.context", target: "capability.architecture.context", intent });
      mkdirSync(dirname(relationPath), { recursive: true });
      writeFileSync(relationPath, relation("Persist context events"), "utf8");
      const flowPath = join(root, ".archcontext/model/flows/flow.context-fixture.yaml");
      mkdirSync(dirname(flowPath), { recursive: true });
      writeFileSync(flowPath, JSON.stringify({ schemaVersion: "archcontext.flow/v1", id: "flow.context-fixture", capabilityId: "capability.architecture.context", name: "Context fixture", applicability: "not-applicable", rationale: "Model-only contract file fixture." }), "utf8");
      const human = "# Human routing\n\nKeep these trailing spaces.  \n";
      const contracts = ["AGENTS.md", "CLAUDE.md", "context/AGENTS.md", "context/CLAUDE.md"];
      mkdirSync(join(root, "context"), { recursive: true });
      for (const path of contracts) writeFileSync(join(root, path), human);
      gitCommitAll(root, "declare root contracts");
      execFileSync("codegraph", ["init", root], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      daemon = await createStartedTestDaemon();
      const docs = (action: "plan" | "apply" | "drift") => runArchitectureDocsProjectionCommand({ action, profile: "repo-harness/v1", approved: true }, root, daemon!);
      const manifestRows = () => Object.values(JSON.parse(readText(join(root, "docs/architecture/.projection-manifest.json"))).targets as Record<string, { type: string; path: string }>)
        .filter((row) => row.type === "agent-context").map((row) => row.path);

      // Root contract files are routing text: the profile accepts them, and the projection writes no region there.
      const rootPlanned = await docs("plan");
      expect((rootPlanned.data as any).draft.operations.map((operation: { op: string }) => operation.op)).toEqual(["render_projection"]);
      expect((await docs("apply")).ok).toBe(true);
      for (const path of contracts) expect(readText(join(root, path))).toBe(human);
      expect(manifestRows()).toEqual([]);
      // The committed repo-harness/v1 manifest makes the projection the one writer, with no agent-context row.
      for (const action of ["plan", "preview", "apply"] as const) {
        expect(await daemon.agentContextProjection(root, { action, approved: true })).toMatchObject({ ok: false, error: { reasonCode: "agent-context-owned-by-projection" } });
      }
      gitCommitAll(root, "project without root contract regions");
      // Nor does a raw ChangeSet write a root region: the default-profile canonical render is refused.
      const raw = agentContextProjectionOperation(root);
      expect(raw.projectionFiles.map((file) => file.path)).toEqual(["AGENTS.md", "CLAUDE.md"]);
      const rawPlanned = await daemon.planUpdate(root, { id: "changeset.root-raw", reason: { taskSessionId: "task.root-raw" }, operations: [raw] });
      expect((rawPlanned.data as any).preview.allowed).toBe(false);
      expect((rawPlanned.data as any).preview.findings.join("\n")).toContain("Root contract has no agent-context region under repo-harness/v1");
      await expect(daemon.applyUpdate(root, { id: "changeset.root-raw", approved: true, expectedWorktreeDigest: (rawPlanned.data as any).draft.base.worktreeDigest })).rejects.toThrow();
      for (const path of contracts) expect(readText(join(root, path))).toBe(human);

      // One ChangeSet carries the manifest and both capability-local contracts.
      designate("context/AGENTS.md", "context/CLAUDE.md");
      const planned = await docs("plan");
      expect((planned.data as any).draft.operations.map((operation: { op: string }) => operation.op)).toEqual(["render_projection", "render_agent_context"]);
      expect((planned.data as any).preview).toMatchObject({ allowed: true, findings: [] });
      expect((await docs("apply")).ok).toBe(true);
      expect(manifestRows()).toEqual(["context/AGENTS.md", "context/CLAUDE.md"]);
      for (const path of ["AGENTS.md", "CLAUDE.md"]) expect(readText(join(root, path))).toBe(human);
      const projected = { agents: readText(join(root, "context/AGENTS.md")), claude: readText(join(root, "context/CLAUDE.md")) };
      // A contract file outside the root gets its region after the trimmed human text.
      expect(projected.agents.startsWith(`${human.trimEnd()}\n\n`)).toBe(true);
      expect(projected.agents).toContain('rendererVersion="archcontext.agent-context-renderer/v2"');
      expect(projected.agents).not.toContain("sourceDigest=");
      gitCommitAll(root, "project capability-local contracts");

      // A model edit that changes no region body leaves both contract files byte-identical.
      writeFileSync(relationPath, relation("Persist context lifecycle events"), "utf8");
      expect((await docs("apply")).ok).toBe(true);
      expect(readText(join(root, "context/AGENTS.md"))).toBe(projected.agents);
      expect(readText(join(root, "context/CLAUDE.md"))).toBe(projected.claude);

      // A hand-edited region is drift that apply rewrites, not a renderer error.
      writeFileSync(join(root, "context/AGENTS.md"), projected.agents.replace("# Agent Context: Architecture Context", "# Agent Context: Tampered"), "utf8");
      const drift = await docs("drift");
      expect(drift.ok, JSON.stringify(drift)).toBe(true);
      expect((drift.data as any).drift.diffs).toContainEqual(expect.objectContaining({ path: "context/AGENTS.md", reasonCode: "projection-generated-region-manually-edited" }));
      expect((await docs("apply")).ok).toBe(true);
      expect(readText(join(root, "context/AGENTS.md"))).toBe(projected.agents);

      // A v1 marker and a reordered v2 marker are the node's region, stale until apply rewrites the canonical bytes (#572 R3-F2, G3-F1).
      const v2 = 'rendererVersion="archcontext.agent-context-renderer/v2"';
      const [, idAttribute] = / (id="[^"]+") rendererVersion=/.exec(projected.agents)!;
      for (const stale of [
        projected.agents.replace(v2, `sourceDigest="sha256:${"1".repeat(64)}" rendererVersion="archcontext.agent-context-renderer/v1"`),
        projected.agents.replace(`${idAttribute} ${v2}`, `${v2} ${idAttribute}`)
      ]) {
        writeFileSync(join(root, "context/AGENTS.md"), stale, "utf8");
        expect(((await docs("drift")).data as any).drift.diffs).toContainEqual(expect.objectContaining({ path: "context/AGENTS.md", reasonCode: "projection-generated-region-stale" }));
        expect((await docs("apply")).ok).toBe(true);
        expect(readText(join(root, "context/AGENTS.md"))).toBe(projected.agents);
      }

      // A superseded manifest is refused as by every projection command, before the re-baseline.
      const manifestPath = join(root, "docs/architecture/.projection-manifest.json");
      const committed = JSON.parse(readText(manifestPath));
      writeFileSync(manifestPath, JSON.stringify({ ...committed, schemaVersion: "archcontext.architecture-docs-projection-manifest/v3" }), "utf8");
      expect(await daemon.agentContextProjection(root, { action: "plan" })).toMatchObject({ ok: false, error: { reasonCode: "projection-manifest-upgrade-required" } });
      // Under a v4 `default` manifest the command plans as it does without one.
      writeFileSync(manifestPath, JSON.stringify({ ...committed, profile: "default" }), "utf8");
      expect(await daemon.agentContextProjection(root, { action: "plan" })).toMatchObject({ ok: true });
    } finally { await daemon?.stop(); removeTempRepo(root); }
  }, 120_000);

  test("agent-context apply on CRLF root contracts keeps the human bytes and leaves git clean", async () => {
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-08-08T10:50:00.000Z" });
      await daemon.init(root, "Root Contract CRLF App");
      execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      const nodePath = join(root, ".archcontext/model/nodes/capability.architecture.context.yaml");
      writeFileSync(nodePath, `${readText(nodePath)}extensions:\n  contractFiles:\n    agents: "AGENTS.md"\n    claude: "CLAUDE.md"\n`);
      const human = "# Human routing\r\n\r\nKeep these trailing spaces.  \r\n\r\n\r\n";
      for (const path of ["AGENTS.md", "CLAUDE.md"]) writeFileSync(join(root, path), human);
      gitCommitAll(root, "declare root contracts with CRLF human text");
      const rawText = (path: string) => readFileSync(join(root, path), "utf8");

      // First apply goes through `validateRootWrite` against CRLF files: the human text above the
      // markers is untouched and the generated region is written with the file's CRLF endings.
      const first = await daemon.agentContextProjection(root, { action: "apply", approved: true, id: "changeset.agent-context-crlf" });
      expect(first).toMatchObject({ ok: true });
      for (const path of ["AGENTS.md", "CLAUDE.md"]) {
        expect(rawText(path).startsWith(human)).toBe(true);
        expect(rawText(path).length).toBeGreaterThan(human.length);
        expect(rawText(path).replaceAll("\r\n", "")).not.toContain("\n");
      }
      gitCommitAll(root, "project root contracts");
      const projected = { agents: rawText("AGENTS.md"), claude: rawText("CLAUDE.md") };

      const again = await daemon.agentContextProjection(root, { action: "apply", approved: true, id: "changeset.agent-context-crlf-again" });
      expect(again).toMatchObject({ ok: true });
      expect(rawText("AGENTS.md")).toBe(projected.agents);
      expect(rawText("CLAUDE.md")).toBe(projected.claude);
      expect(gitOut(root, "status", "--porcelain")).toBe("");
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("agent-context projection applies through its own ChangeSet operation kind and is idempotent", async () => {
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-08-08T10:40:00.000Z" });
      await daemon.init(root, "Agent Context App");
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`,
        "utf8"
      );
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/app.ts"), "export const app = 1;\n", "utf8");
      // Human-authored content that must survive every projection untouched.
      writeFileSync(join(root, "src/CLAUDE.md"), "# src\n\nHand-written routing notes.\n", "utf8");
      gitCommitAll(root, "declare capability source");

      const claudePath = join(root, "src/CLAUDE.md");
      const agentsPath = join(root, "src/AGENTS.md");

      // Plan alone writes nothing.
      const planned = await daemon.planUpdate(root, {
        id: "changeset.agent-context-1",
        reason: { taskSessionId: "task_agent_context" },
        operations: [agentContextProjectionOperation(root)]
      });
      expect(planned.ok).toBe(true);
      expect((planned.data as any).preview.allowed).toBe(true);
      expect((planned.data as any).preview.paths.sort()).toEqual(["src/AGENTS.md", "src/CLAUDE.md"]);
      expect(existsSync(agentsPath)).toBe(false);
      expect(readText(claudePath)).toBe("# src\n\nHand-written routing notes.\n");

      const applied = await daemon.applyUpdate(root, {
        id: "changeset.agent-context-1",
        approved: true,
        expectedWorktreeDigest: (planned.data as any).draft.base.worktreeDigest
      });
      expect(applied.ok).toBe(true);
      expect(readText(claudePath)).toContain("Hand-written routing notes.");
      expect(readText(claudePath)).toContain('id="capability.architecture.context"');
      expect(readText(agentsPath)).toContain("# Agent Context: Architecture Context");

      // Second pass over its own output is byte-identical.
      const before = { claude: readText(claudePath), agents: readText(agentsPath) };
      const replanned = await daemon.planUpdate(root, {
        id: "changeset.agent-context-2",
        reason: { taskSessionId: "task_agent_context" },
        operations: [agentContextProjectionOperation(root)]
      });
      await daemon.applyUpdate(root, {
        id: "changeset.agent-context-2",
        approved: true,
        expectedWorktreeDigest: (replanned.data as any).draft.base.worktreeDigest
      });
      expect(readText(claudePath)).toBe(before.claude);
      expect(readText(agentsPath)).toBe(before.agents);

      // A hand-edited machine region is rewritten to the canonical region, not refused.
      writeFileSync(claudePath, before.claude.replace("Architecture Context", "Tampered Name"), "utf8");
      expect(agentContextProjectionOperation(root).projectionFiles.find((file) => file.path === "src/CLAUDE.md")!.body).toBe(before.claude);
      writeFileSync(claudePath, before.claude, "utf8");

      // The same paths carried by any other operation kind stay outside the write allowlist.
      const misKinded = await daemon.planUpdate(root, {
        id: "changeset.agent-context-mis-kinded",
        reason: { taskSessionId: "task_agent_context" },
        operations: [{ ...agentContextProjectionOperation(root), op: "render_projection" as const }]
      });
      expect((misKinded.data as any).preview.allowed).toBe(false);
      expect((misKinded.data as any).preview.findings.join("\n")).toContain("Path is outside ArchContext write allowlist");
      await expect(daemon.applyUpdate(root, {
        id: "changeset.agent-context-mis-kinded",
        approved: true,
        expectedWorktreeDigest: (misKinded.data as any).draft.base.worktreeDigest
      })).rejects.toMatchObject({code:"AC_UNCLASSIFIED_FAILURE",reasonCode:"failure-unclassified"});
      expect(readText(claudePath)).toBe(before.claude);
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("practice waiver writes are owner-aware ChangeSets with apply readback", async () => {
    const root = tempRepo();
    try {
      const daemon = await createStartedTestDaemon();
      await daemon.init(root, "Practice Waiver App");
      writeFileSync(join(root, ".archcontext/model/nodes/module.waiver-owner.yaml"), [
        "schemaVersion: archcontext.node/v2",
        "id: module.waiver-owner",
        "kind: module",
        "name: Waiver Owner",
        "status: active",
        "summary: Owns waiver governance fixtures.",
        "ownership:",
        "  lifecycle: [\"team-architecture\"]",
        ""
      ].join("\n"), "utf8");

      const unknownOwner = await daemon.planPracticeWaiver(root, {
        practiceId: "modularity.no-new-cycle",
        checkId: "no-new-cycle",
        owner: "unknown-team",
        reason: "External migration window requires keeping this edge until the upstream cutover is complete.",
        reviewAt: "2026-07-10T00:00:00.000Z",
        expiresAt: "2026-07-24T00:00:00.000Z",
        evidenceDigest: `sha256:${"1".repeat(64)}`,
        subjects: ["module.a->module.b"]
      });
      expect(unknownOwner.ok).toBe(false);
      expect((unknownOwner as any).error.code).toBe("AC_SCHEMA_INVALID");

      await daemon.planUpdate(root, {
        id: "changeset.practice-waiver-cycle",
        operations: []
      });
      const plan = await daemon.planPracticeWaiver(root, {
        id: "changeset.practice-waiver-cycle",
        waiverId: "cycle-waiver",
        taskSessionId: "task_waiver",
        practiceId: "modularity.no-new-cycle",
        checkId: "no-new-cycle",
        owner: "team-architecture",
        reason: "External migration window requires keeping this edge until the upstream cutover is complete.",
        createdAt: "2026-06-24T00:00:00.000Z",
        reviewAt: "2026-07-10T00:00:00.000Z",
        expiresAt: "2026-07-24T00:00:00.000Z",
        evidenceDigest: `sha256:${"1".repeat(64)}`,
        subjects: ["module.a->module.b"]
      });

      expect(plan.ok).toBe(true);
      expect((plan.data as any).path).toBe(".archcontext/waivers/cycle-waiver.json");
      expect((plan.data as any).ownerRegistry.owners).toContain("team-architecture");
      expect((plan.data as any).draft.operations[0]).toMatchObject({
        op: "write_waiver",
        path: ".archcontext/waivers/cycle-waiver.json",
        expectedHash: "missing"
      });
      expect((plan.data as any).preview.allowed).toBe(true);

      const apply = await daemon.applyUpdate(root, {
        id: (plan.data as any).draft.id,
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      });
      expect(apply.ok).toBe(true);
      expect(readFileSync(join(root, ".archcontext/waivers/cycle-waiver.json"), "utf8")).toContain("team-architecture");

      const waivers = await daemon.practiceWaivers(root);
      expect(waivers.ok).toBe(true);
      expect((waivers.data as any).count).toBe(1);
      expect((waivers.data as any).waivers[0]).toMatchObject({
        practiceId: "modularity.no-new-cycle",
        checkId: "no-new-cycle",
        owner: "team-architecture",
        reviewAt: "2026-07-10T00:00:00.000Z"
      });
      expect((waivers.data as any).waivers[0].waiverDigest).toMatch(/^sha256:/);
    } finally {
      removeTempRepo(root);
    }
  });

  test("apply_update repairs a schema-invalid node and classifies an incomplete repair (#370)", async () => {
    const root = createInitializedGitRepo();
    const path = ".archcontext/model/nodes/capability.architecture.context.yaml";
    const original = readFileSync(join(root, path), "utf8");
    const invalid = original.replace(/^summary:.*\n/m, "");
    writeFileSync(join(root, path), invalid, "utf8");
    const daemon = await createStartedTestDaemon();
    try {
      for (const [id, body] of [["changeset.incomplete-repair", invalid], ["changeset.repair-node", original]] as const) {
        const plan = await daemon.planUpdate(root, {
          id,
          operations: [{ op: "update_entity_fields", path, expectedHash: digestJson({ body: invalid }), body }]
        });
        expect(plan.ok, JSON.stringify(plan)).toBe(true);
        const applied = daemon.applyUpdate(root, { id, approved: true, expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest });
        if (body === invalid) {
          await expect(applied).rejects.toMatchObject({ failure: { code: "AC_SCHEMA_INVALID", reasonCode: "native-context-model-invalid", details: { path } } });
          expect(readFileSync(join(root, path), "utf8")).toBe(invalid);
        } else {
          expect((await applied).ok).toBe(true);
          expect(readFileSync(join(root, path), "utf8")).toBe(original);
          expect((await daemon.validate(root)).data).toMatchObject({ valid: true, errors: [] });
        }
      }
    } finally {
      await daemon.stop();
      removeTempRepo(root);
    }
  });

  test("apply_update rejects a draft whose captured worktree digest is stale even when the caller supplies the new digest", async () => {
    const root = tempRepo();
    try {
      const daemon = await createStartedTestDaemon();
      await daemon.init(root, "Stale Worktree App");
      const plan = await daemon.planUpdate(root, {
        id: "changeset.stale-worktree",
        operations: [{
          op: "create_entity",
          path: ".archcontext/model/nodes/module.stale-worktree.yaml",
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v2\nid: module.stale-worktree\nkind: module\nname: Stale Worktree\nstatus: active\nsummary: Stale worktree\n"
        }]
      });
      writeFileSync(join(root, "unrelated.txt"), "changed after planning\n", "utf8");

      await expect(daemon.applyUpdate(root, {
        id: (plan.data as any).draft.id,
        approved: true,
        expectedWorktreeDigest: computeWorktreeDigest(root, listGitVisibleFiles(root))
      })).rejects.toMatchObject({code:"AC_PRECONDITION_FAILED",reasonCode:"apply-worktree-changed"});
      expect(existsSync(join(root, ".archcontext/model/nodes/module.stale-worktree.yaml"))).toBe(false);
    } finally {
      removeTempRepo(root);
    }
  });

  test("apply_update rejects a draft whose captured HEAD is stale", async () => {
    const root = createInitializedGitRepo();
    try {
      const daemon = await createStartedTestDaemon();
      const plan = await daemon.planUpdate(root, {
        id: "changeset.stale-head",
        operations: [{
          op: "create_entity",
          path: ".archcontext/model/nodes/module.stale-head.yaml",
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v2\nid: module.stale-head\nkind: module\nname: Stale Head\nstatus: active\nsummary: Stale head\n"
        }]
      });
      writeFileSync(join(root, "HEAD-ADVANCE.md"), "advance\n", "utf8");
      execFileSync("git", ["add", "HEAD-ADVANCE.md"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "advance head"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });

      await expect(daemon.applyUpdate(root, {
        id: (plan.data as any).draft.id,
        approved: true,
        expectedWorktreeDigest: computeWorktreeDigest(root, listGitVisibleFiles(root))
      })).rejects.toThrow("ChangeSet HEAD changed before apply");
    } finally {
      removeTempRepo(root);
    }
  });

  test("apply_update rejects a draft whose authoritative model digest is stale", async () => {
    const root = tempRepo();
    let validationCount = 0;
    const delegate = new YamlModelStore();
    const modelStore: ModelStorePort = {
      loadManifest: (workspace) => delegate.loadManifest(workspace),
      loadModel: (workspace) => delegate.loadModel(workspace),
      async validateModel(workspace) {
        const result = await delegate.validateModel(workspace);
        validationCount += 1;
        if (validationCount <= 2) return result;
        return { ...result, modelDigest: digestJson({ stale: validationCount } as unknown as Json) };
      },
      writeChangeSetPreview: (changeSet) => delegate.writeChangeSetPreview(changeSet)
    };
    try {
      const daemon = await createStartedTestDaemon({ modelStore });
      await daemon.init(root, "Stale Model App");
      const plan = await daemon.planUpdate(root, {
        id: "changeset.stale-model",
        operations: [{
          op: "create_entity",
          path: ".archcontext/model/nodes/module.stale-model.yaml",
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v2\nid: module.stale-model\nkind: module\nname: Stale Model\nstatus: active\nsummary: Stale model\n"
        }]
      });

      await expect(daemon.applyUpdate(root, {
        id: (plan.data as any).draft.id,
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      })).rejects.toThrow("ChangeSet model digest changed before apply");
      expect(existsSync(join(root, ".archcontext/model/nodes/module.stale-model.yaml"))).toBe(false);
    } finally {
      removeTempRepo(root);
    }
  });

  test("apply_update restores a hand-deleted node that an ADR references (#163)", async () => {
    const root = tempRepo();
    try {
      const daemon = await createStartedTestDaemon({ clock: () => "2026-09-25T04:10:00.000Z" });
      await daemon.init(root, "ADR Repair App");
      const path = ".archcontext/model/nodes/module.adr-repair.yaml";
      const body = "schemaVersion: archcontext.node/v2\nid: module.adr-repair\nkind: module\nname: ADR Repair\nstatus: active\nsummary: Node referenced by an ADR\n";
      const adrPath = "docs/adr/ADR-0001-adr-repair.md";
      mkdirSync(join(root, "docs/adr"), { recursive: true });
      writeFileSync(join(root, adrPath), [
        "---",
        "schemaVersion: archcontext.adr/v1",
        "id: adr.0001.adr-repair",
        "title: ADR Repair",
        "status: accepted",
        "decidedAt: 2026-09-25",
        "appliesTo:",
        "  - module.adr-repair",
        "supersedes: []",
        "---",
        ""
      ].join("\n"), "utf8");

      const dangling = (await daemon.validate(root)).data as any;
      expect(dangling.valid).toBe(false);
      expect(dangling.errors).toEqual([`${adrPath}: ADR appliesTo references unknown node module.adr-repair`]);

      const plan = await daemon.planUpdate(root, {
        id: "changeset.adr-repair-node",
        operations: [{ op: "create_entity", path, expectedHash: "missing", body }]
      });
      expect(plan.ok).toBe(true);
      const apply = await daemon.applyUpdate(root, {
        id: "changeset.adr-repair-node",
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      });
      expect(apply.ok).toBe(true);
      expect(readText(join(root, path))).toBe(body);
      expect(((await daemon.validate(root)).data as any)).toMatchObject({ valid: true, errors: [] });
    } finally {
      removeTempRepo(root);
    }
  });

  test("daemon restart restores persisted repository sessions from the local store", async () => {
    const root = tempRepo();
    const dbPath = join(root, "runtime-state", "runtime.sqlite");
    let first: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
    let second: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
    try {
      first = await createStartedDaemon({
        codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
        codeGraphProviderFactory: () => new MockCodeGraphProvider(),
        localStorePath: dbPath,
        clock: () => "2026-06-20T00:00:00.000Z"
      });
      const init = await first.init(root, "Persistent Session");
      expect(init.ok).toBe(true);
      const before = await first.runtimeStatus(root);
      expect((before.data as any).sessions).toBe(1);
      await first.stop();
      first = undefined;

      second = await createStartedDaemon({
        codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
        codeGraphProviderFactory: () => new MockCodeGraphProvider(),
        localStorePath: dbPath,
        clock: () => "2026-06-20T00:01:00.000Z"
      });
      const after = await second.runtimeStatus(root);
      expect(after.data).toMatchObject({
        sessions: 1,
        repositories: [repositoryFingerprint(root)],
        repositoryId: repositoryFingerprint(root),
        headSha: (before.data as any).headSha,
        worktreeDigest: computeWorktreeDigest(root, listGitVisibleFiles(root))
      });
      await second.stop();
      second = undefined;
    } finally {
      await second?.stop().catch(() => undefined);
      await first?.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  }, WINDOWS_RUNTIME_IO_TEST_TIMEOUT_MS);

  test("runtime-owned complete task computes digests and rejects caller-provided attestation fields", async () => {
    const root = createInitializedGitRepo();
    const provider = new MockCodeGraphProvider();
    const store = new TestLocalStore();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ codeFacts: new CodeGraphAdapter(provider), localStore: store });
      writeFileSync(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`, "utf8");
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const passed = await daemon.completeTask(root, {
        taskSessionId: "task_runtime_complete",
        headSha
      });
      expect(passed.ok).toBe(true);
      expect((passed.data as any)).toMatchObject({
        schemaVersion: "archcontext.review/v1",
        taskSessionId: "task_runtime_complete",
        result: "pass_with_warnings"
      });
      expect(provider.indexedRoots.map((indexedRoot) => normalizeExistingPath(indexedRoot))).toEqual([normalizeExistingPath(root)]);
      expect(store.reviews.get((passed.data as any).reviewId)).toMatchObject({ result: "pass_with_warnings" });

      await expect(daemon.completeTask(root, {
        taskSessionId: "task_runtime_forged",
        headSha,
        result: "pass"
      } as any)).resolves.toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID", reasonCode: "complete-input-invalid", action: "correct-command-arguments", details: {} } });
      await expect(daemon.completeTask(root, {
        taskSessionId: "task_runtime_forged_model",
        headSha,
        modelDigest: `sha256:${"a".repeat(64)}`
      } as any)).resolves.toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID", reasonCode: "complete-input-invalid", action: "correct-command-arguments", details: {} } });
    } finally {
      await daemon?.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  });

  test("runtime rejects untrusted worktree digest profiles before plan or apply state", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await createStartedTestDaemon({ localStore: store });
    try {
      expect((await daemon.init(root, "Runtime Profile Validation App")).ok).toBe(true);
      const repositoryDigest = computeWorktreeDigest(root, listGitVisibleFiles(root));
      const projectionDigest = architectureDocumentationProjectionWorktreeDigest(
        root,
        loadNativeModelFromArchContext(root),
        listGitVisibleFiles(root)
      );
      const invalidPlanProfiles = [
        { label: "unknown", profile: "not-a-real-profile", expectedDigest: projectionDigest },
        { label: "null", profile: null, expectedDigest: projectionDigest },
        { label: "malformed", profile: 7, expectedDigest: projectionDigest },
        { label: "repository", profile: "repository", expectedDigest: repositoryDigest }
      ];

      for (const { label, profile, expectedDigest } of invalidPlanProfiles) {
        const id = `changeset.invalid-profile-${label}`;
        const plan = await (daemon as any).planUpdate(root, {
          id,
          operations: [],
          worktreeDigestPrecondition: { profile, expectedDigest }
        });
        expect(plan).toMatchObject({
          schemaVersion: "archcontext.envelope/v1",
          ok: false,
          requestId: "plan_update",
          error: { code: "AC_SCHEMA_INVALID" }
        });

        const sameProfileApplyPromise = (daemon as any).applyUpdate(root, {
          id,
          approved: true,
          expectedWorktreeDigest: expectedDigest,
          worktreeDigestProfile: profile
        });
        if (profile === "repository") {
          await expect(sameProfileApplyPromise).rejects.toMatchObject({
            code: "AC_PRECONDITION_FAILED",
            reasonCode: "apply-draft-missing",
            details: { changeSetId: id }
          });
        } else {
          expect(await sameProfileApplyPromise).toMatchObject({
            schemaVersion: "archcontext.envelope/v1",
            ok: false,
            requestId: "apply_update",
            error: { code: "AC_SCHEMA_INVALID" }
          });
        }

        await expect(daemon.applyUpdate(root, {
          id,
          approved: true,
          expectedWorktreeDigest: repositoryDigest
        })).rejects.toMatchObject({
          code: "AC_PRECONDITION_FAILED",
          reasonCode: "apply-draft-missing",
          details: { changeSetId: id }
        });
      }

      const validPlan = await daemon.planUpdate(root, {
        id: "changeset.invalid-apply-profile",
        operations: []
      });
      expect(validPlan.ok).toBe(true);
      const expectedWorktreeDigest = (validPlan.data as any).draft.base.worktreeDigest;
      for (const profile of ["not-a-real-profile", null, 7]) {
        const apply = await (daemon as any).applyUpdate(root, {
          id: "changeset.invalid-apply-profile",
          approved: true,
          expectedWorktreeDigest,
          worktreeDigestProfile: profile,
          projectionApplyReceipt: {
            schemaVersion: "archcontext.projection-apply-receipt/v1",
            identity: { lookupKey: "projection_apply_lookup.invalid-profile" }
          }
        });
        expect(apply).toMatchObject({
          schemaVersion: "archcontext.envelope/v1",
          ok: false,
          requestId: "apply_update",
          error: { code: "AC_SCHEMA_INVALID" }
        });
      }

      expect(computeWorktreeDigest(root, listGitVisibleFiles(root))).toBe(repositoryDigest);
    } finally {
      await daemon.stop();
      removeTempRepo(root);
    }
  });

  test("production composition root uses real adapters and rejects injected runtime doubles", async () => {
    const root = tempRepo();
    let daemon: Awaited<ReturnType<typeof createStartedProductionDaemon>> | undefined;
    try {
      daemon = await createStartedProductionDaemon({ root });
      expect(daemon.compositionReport()).toMatchObject({
        mode: "production",
        productionSafe: true,
        adapters: {
          codeFacts: "codegraph-cli",
          codeGraphProviderFactory: "codegraph-cli",
          modelStore: "yaml",
          localStore: "sqlite",
          changeSetEngine: "default"
        }
      });
      await daemon.stop();
      daemon = undefined;

      const codeFacts = new CodeGraphAdapter(new MockCodeGraphProvider());
      const expectRefused = (deps: Parameters<typeof assertProductionRuntimeDeps>[0]) => {
        let caught: unknown;
        try { assertProductionRuntimeDeps(deps); } catch (error) { caught = error; }
        expect(caught).toMatchObject({code: "AC_SCHEMA_INVALID", reasonCode: "production-injections-refused", details: {issueCount: 1}});
      };
      expectRefused({ codeFacts });
      expectRefused({ codeGraphProviderFactory: () => new MockCodeGraphProvider() });
      expectRefused({ localStore: new TestLocalStore() });
      expectRefused({ clock: () => "2026-06-20T00:00:00.000Z" });
    } finally {
      if (daemon) await daemon.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  }, WINDOWS_RUNTIME_IO_TEST_TIMEOUT_MS);

  test("runtime default clock is a real wall clock for production composition, frozen epoch for embedded/test composition", () => {
    // `clock` itself is one of the blockedProductionInjections above (a caller cannot hand
    // production a fake clock), so the *default* used when nothing is injected is the only thing
    // that determines what a real `archctxd` process actually timestamps events with. Before this
    // fix, `createProductionDaemon` never overrode `clock`, so production silently fell through to
    // the same frozen "1970-01-01T00:00:00.000Z" every embedded/test daemon uses for determinism —
    // which is exactly the epoch `createdAt`/`startedAt`/`completedAt`/`issuedAt` (and `durationMs:
    // 0`, since every call returned the identical constant) a real `archctx audit run` recorded.
    const embeddedNow = runtimeDefaultClock("embedded")();
    expect(embeddedNow).toBe("1970-01-01T00:00:00.000Z");
    expect(runtimeDefaultClock("embedded")()).toBe(embeddedNow);

    const before = Date.now();
    const productionNow = Date.parse(runtimeDefaultClock("production")());
    const after = Date.now();
    expect(Number.isNaN(productionNow)).toBe(false);
    expect(productionNow).toBeGreaterThanOrEqual(before);
    expect(productionNow).toBeLessThanOrEqual(after);
  });

  test("CodeGraph adapter is version/capability checked and blocks internal storage access", async () => {
    delete process.env.DO_NOT_TRACK;
    const provider = new MockCodeGraphProvider();
    const adapter = new CodeGraphAdapter(provider);
    expect(String(process.env.DO_NOT_TRACK)).toBe("1");
    await expect(adapter.ensureReady({ root: "/tmp/repo", repositoryId: "repo.test", headSha: "abc" })).resolves.toMatchObject({
      provider: "codegraph",
      version: REQUIRED_CODEGRAPH_VERSION
    });

    provider.version = "0.0.0";
    await expect(adapter.sync({ workspace: { root: "/tmp/repo", repositoryId: "repo.test", headSha: "abc" } })).rejects.toThrow("required");
    expect(() => assertNoCodeGraphInternalPathAccess(".codegraph/state.db")).toThrow();
  });

  test("Explorer system-map fails closed when required observed facts are unavailable", async () => {
    const root = tempRepo();
    const baseFacts = countingCheckpointFacts().port;
    const unavailableFacts: CodeFactsPort = {
      ...baseFacts,
      async ensureReady() {
        throw new Error("CodeGraph index missing");
      }
    };
    try {
      const daemon = await createStartedTestDaemon({ codeFacts: unavailableFacts });
      await daemon.init(root, "Explorer Required Domain App");
      const result = await daemon.explorerProjectionV2(root, {
        schemaVersion: "archcontext.explorer-projection-query/v2",
        viewId: "system-map",
        depth: 1,
        budget: { maxNodes: 5, maxRelations: 5 }
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("AC_PRECONDITION_FAILED");
      expect(result.error).toMatchObject({reasonCode: "explorer-precondition-failed", details: {
        inputDomain: "observed", availability: "unavailable", cause: "unclassified"
      }});
      expect(JSON.stringify(result)).not.toContain("codegraph-index-missing");
    } finally {
      removeTempRepo(root);
    }
  });


});

function gitExitCode(root: string, ...args: string[]): number {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

function gitCommitAll(root: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync(
    "git",
    ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", message],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] }
  );
}

test("SM-S15 projection plan, apply and completion drift render the same statechart bytes", async () => {
  const root = createInitializedGitRepo();
  let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
  const renderSpy = spyOn(projectionEngine, "renderArchitectureDocumentationProjection");
  try {
    const nodePath = join(root, ".archcontext/model/nodes/capability.architecture.context.yaml");
    const capabilityNode = loadNativeModelFromArchContext(root).nodes.find((node) => node.kind === "capability")!;
    const node = { ...capabilityNode, extensions: { contractFiles: { agents: "AGENTS.md", claude: "CLAUDE.md" } } };
    writeFileSync(nodePath, JSON.stringify(node), "utf8");
    const relationPath = join(root, ".archcontext/model/relations/relation.statechart-journal.yaml");
    mkdirSync(dirname(relationPath), { recursive: true });
    writeFileSync(relationPath, JSON.stringify({ schemaVersion: "archcontext.relation/v1", id: "relation.statechart-journal", kind: "writes", source: node.id, target: node.id, intent: "Persist lifecycle events" }), "utf8");
    const flowPath = join(root, ".archcontext/model/flows/flow.statechart-fixture.yaml");
    mkdirSync(dirname(flowPath), { recursive: true });
    writeFileSync(flowPath, JSON.stringify({ schemaVersion: "archcontext.flow/v1", id: "flow.statechart-fixture", capabilityId: node.id, name: "Statechart fixture", applicability: "not-applicable", rationale: "This fixture checks model-only statechart projection transport." }), "utf8");
    const machine: StateMachineV1 = {
      schemaVersion: "archcontext.state-machine/v1", id: "state-machine.architecture-context.job", capabilityId: "capability.architecture.context", name: "Job lifecycle",
      regions: [{ id: "status", label: "Status", initial: "queued", states: [{ id: "queued", label: "Queued" }, { id: "done", label: "Done", terminal: true }] }],
      events: [{ id: "finish", label: "Finish", source: { kind: "environment" }, steps: [{ when: { status: ["queued"] }, then: { status: "done" } }] }],
      rules: [{ id: "done-is-final", label: "Done is final", final: { status: ["done"] } }]
    };
    const machinePath = `.archcontext/model/state-machines/${machine.id}.yaml`;
    mkdirSync(dirname(join(root, machinePath)), { recursive: true });
    writeFileSync(join(root, machinePath), JSON.stringify(machine), "utf8");
    // A real index is required for completion code-facts sync, even for a model-only fixture.
    execFileSync("codegraph", ["init", root], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    // Completion reuses its code-facts sync for the projection (#584), so that sync has to be CodeGraph's.
    daemon = await createStartedTestDaemon({ codeFacts: new CodeGraphAdapter(new CodeGraphSdkProvider()) });
    const baseline = await runArchitectureDocsProjectionCommand({ action: "apply", profile: "repo-harness/v1", approved: true }, root, daemon);
    expect(baseline.ok, JSON.stringify(baseline)).toBe(true);

    // A semantic edit applies the statechart projection so completion can verify identical bytes.
    writeFileSync(nodePath, JSON.stringify({ ...node, summary: "Architecture context with a declared job lifecycle." }), "utf8");
    const planned = buildArchitectureDocsProjection(undefined, root, "repo-harness/v1");
    const capability = planned.plan.files.find((file) => file.target.type === "entity-summary" && file.target.scope.id === machine.capabilityId)!;
    expect(capability.body).toContain("### 2.1 狀態機");
    expect(capability.body).toContain("status__queued --> status__done: Finish");
    const request: ProjectionRequestV1 = {
      schemaVersion: "archcontext.projection-request/v1", requestId: "projection_request.statechart", profile: "repo-harness/v1", mode: "apply", targets: ["architecture-docs"], changedPaths: [machinePath],
      expected: currentProjectionExpectedSnapshot(root, loadNativeModelFromArchContext(root)), acceptObservedMajorChange: true
    };
    const applied = await runProjectionProtocolCommand({ action: "run", request }, root, daemon);
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    const result = applied.data as unknown as ProjectionResultV3;
    expect(result.status, JSON.stringify(applied)).toBe("applied");
    expect(readText(join(root, capability.path))).toBe(capability.body);

    const beforeCompletion = renderSpy.mock.results.length;
    // One `codegraph sync` per completion (#584). A sync runs `git status`, a read never does
    // (ADR-0058 Decision 3), so completion runs as many as one sync of the same tree.
    const statusRuns = async <T>(run: () => T | Promise<T>): Promise<{ value: T; statuses: number }> => {
      const spy = gitSpy();
      const path = process.env.PATH;
      process.env.PATH = spy.env.PATH;
      try {
        const value = await run();
        return { value, statuses: spy.subcommands().filter((command) => command.startsWith("status ")).length };
      } finally {
        process.env.PATH = path;
        spy.restore();
      }
    };
    const completion = process.platform === "win32" ? undefined
      : await statusRuns(() => daemon!.completeTask(root, { taskSessionId: "task_statechart_projection", task: "Verify the statechart projection" }));
    const completed = completion?.value ?? await daemon.completeTask(root, { taskSessionId: "task_statechart_projection", task: "Verify the statechart projection" });
    if (completion) {
      const oneSync = await statusRuns(() => syncCodeGraphFixture(root));
      expect(oneSync.statuses).toBeGreaterThan(0);
      expect(completion.statuses).toBe(oneSync.statuses);
    }
    expect(completed.ok, JSON.stringify(completed)).toBe(true);
    expect((completed.data as any).extensions.projectionDriftGate).toBeUndefined();
    expect(renderSpy.mock.results.length).toBe(beforeCompletion + 1);
    const driftRender = renderSpy.mock.results.at(-1)!.value as ReturnType<typeof renderArchitectureDocumentationProjection>;
    expect(driftRender.files.find((file) => file.path === capability.path)!.body).toBe(capability.body);
    expect(driftRender.drift.ok).toBe(true);
    expect(readText(join(root, capability.path))).toBe(capability.body);

    // A model-only machine edit must invalidate the applied document on completion.
    machine.events[0]!.label = "Complete the job";
    writeFileSync(join(root, machinePath), JSON.stringify(machine), "utf8");
    const changed = await daemon.completeTask(root, { taskSessionId: "task_statechart_changed" });
    expect((changed.data as any).extensions.projectionDriftGate.reasonCodes).toContain("projection-generated-region-stale");
  } finally {
    renderSpy.mockRestore();
    await daemon?.stop();
    removeTempRepo(root);
  }
}, process.platform === "win32" ? 240_000 : 120_000);
