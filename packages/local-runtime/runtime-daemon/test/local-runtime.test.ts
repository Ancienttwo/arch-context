import { normalizeExistingPath, createGitRepo, createInitializedGitRepo, gitOut, rmSync, tempRepo, removeTempRepo, removeTempPath, sleep, readText, createStartedTestDaemon } from "./runtime-test-fixtures";
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { verify } from "node:crypto";
import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync as nodeRmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { computeWorktreeDigest, repositoryFingerprint, validateLandscape, type CrossRepoRelation } from "@archcontext/core/architecture-domain";
import { planRecommendationRun, recommendationRunLedgerPayload } from "@archcontext/core/recommendation-engine";
import { ARCHITECTURE_DOCS_RENDERER_VERSION, digestJson, type CodeFactsPort, type ExternalDocumentationPort, type Json, type JsonEnvelope, type ModelStorePort, type NormalizedCodeContext } from "@archcontext/contracts";
import { investigationReportProposalValidationDigest } from "@archcontext/core/agent-orchestrator";
import { assertNoCodeGraphInternalPathAccess, CodeGraphAdapter, REQUIRED_CODEGRAPH_VERSION, loadCapabilityCodeGraphProjectionInputs, prepareArchitectureDocumentationProjectionSnapshot } from "@archcontext/local-runtime/codegraph-adapter";
import { Context7ExternalDocumentationAdapter, Context7ProviderError, type Context7Transport } from "@archcontext/local-runtime/context7-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { DEFAULT_EXPLORER_PROJECTION_CACHE_POLICY, migrationSql, assertNoSourceStorageSchema, SQLITE_PRAGMAS, runtimeStatePaths, SqliteLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { initializeArchContextModel, listModelFiles, YamlModelStore } from "@archcontext/local-runtime/model-store-yaml";
import { createNodeInvestigationTransport } from "../src/investigation-transport";
import {
  createNodeGithubIssueExecutor,
  preflightGithubIssueDrafts,
  withGithubIssueBodyFile,
  type GithubIssueExecutorPort,
  type GithubIssuePreflightDraft
} from "../src/github-issue-executor";
import {
  architectureDocumentationSourceDigest,
  architectureDocumentationProjectionWorktreeDigest,
  loadAgentContextProjectionFiles,
  loadArchitectureDocumentationInputs,
  loadCapabilitySourceScaleSignals,
  loadNativeModelFromArchContext,
  renderAgentContextProjection,
  renderArchitectureDocumentationProjection
} from "@archcontext/core/projection-engine";
import { ArchctxDaemon, ArchctxRuntimeRpcServer, RUNTIME_RPC_VERSION, RuntimeRpcClient, assertProductionRuntimeDeps, createStartedProductionDaemon, createStartedDaemon, loadCapabilitySourceChangesSinceStamps, runtimeDefaultClock } from "../src/index";

const PREVIOUS_ARCHCONTEXT_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const RUNTIME_TEST_STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-runtime-state-"));
const CONTEXT7_FAILURE_MATRIX_CASES = ["disabled", "no-key", "no-network", "429", "timeout", "malformed"] as const;
const WINDOWS_RUNTIME_IO_TEST_TIMEOUT_MS = process.platform === "win32" ? 30_000 : 5_000;
type Context7FailureMatrixCase = typeof CONTEXT7_FAILURE_MATRIX_CASES[number];
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

/**
 * Independent re-serialization of the canonical measured form: the returned context minus the three
 * self-referential extension fields. Deliberately does not import the compiler helper — the point is
 * to prove the recorded `byteLength` matches a payload measured by someone other than its producer.
 */
function canonicalContextByteLength(context: { extensions: Record<string, unknown> }): number {
  const extensions = { ...context.extensions };
  delete extensions.byteLength;
  delete extensions.budgetExceeded;
  delete extensions.digest;
  return Buffer.byteLength(JSON.stringify({ ...context, extensions }), "utf8");
}

function projectionTestProvenance(root: string, model: ReturnType<typeof loadNativeModelFromArchContext>) {
  return prepareArchitectureDocumentationProjectionSnapshot(root, model).provenance;
}

function writeArchitectureDocsProjection(root: string): void {
  const loaded = loadArchitectureDocumentationInputs(root);
  const sourceDigest = architectureDocumentationSourceDigest({
    model: loaded.model,
    decisions: loaded.decisions
  });
  const plan = renderArchitectureDocumentationProjection({
    model: loaded.model,
    decisions: loaded.decisions,
    existingFiles: loaded.existingFiles,
    verifiedAgainst: {
      branch: execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      committedAt: execFileSync("git", ["show", "-s", "--format=%cI", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
    },
    sourceChangesSinceStamp: loadCapabilitySourceChangesSinceStamps(root, loaded.model),
    sourceScaleSignals: loadCapabilitySourceScaleSignals(root, loaded.model),
    ...loadCapabilityCodeGraphProjectionInputs(root, loaded.model),
    sourceDigest,
    provenance: projectionTestProvenance(root, loaded.model)
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
    verifiedAgainst: {
      branch: execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      committedAt: execFileSync("git", ["show", "-s", "--format=%cI", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
    },
    sourceChangesSinceStamp: loadCapabilitySourceChangesSinceStamps(root, loaded.model),
    sourceScaleSignals: loadCapabilitySourceScaleSignals(root, loaded.model),
    ...loadCapabilityCodeGraphProjectionInputs(root, loaded.model),
    sourceDigest: architectureDocumentationSourceDigest({ model: loaded.model, decisions: loaded.decisions }),
    provenance: projectionTestProvenance(root, loaded.model)
  });
  return {
    op: "render_projection" as const,
    expectedHash: "missing",
    projectionFiles: [...plan.files.map((file) => ({ path: file.path, body: file.body })), plan.manifest]
      .map((file) => ({ path: file.path, expectedHash: currentBodyHash(root, file.path), body: file.body }))
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

/** Blanks the two places a stamp appears (marker attributes, intro line) for byte comparison. */
/**
 * The commit one node's documentation is stamped with. Since renderer v4 the stamp lives only in
 * the projection manifest — no document body or marker carries provenance — so this is where the
 * stamp lifecycle is observed.
 */
function projectionStampCommit(root: string, nodeId: string): string | undefined {
  const manifest = JSON.parse(readText(join(root, "docs/architecture/.projection-manifest.json")));
  const target = (manifest.targets as any[]).find((entry) => entry.type === "entity-summary" && entry.scope?.id === nodeId);
  return target?.verifiedAgainst?.commit;
}

/** The `render_agent_context` operation `archctx agent-context plan|apply` builds. */
function agentContextProjectionOperation(root: string) {
  const model = loadNativeModelFromArchContext(root);
  const plan = renderAgentContextProjection({
    model,
    sourceDigest: digestJson({ model } as unknown as Json),
    existingFiles: loadAgentContextProjectionFiles(root, model)
  });
  return {
    op: "render_agent_context" as const,
    expectedHash: "missing",
    projectionFiles: plan.files.map((file) => ({
      path: file.path,
      expectedHash: currentBodyHash(root, file.path),
      body: file.body
    }))
  };
}

function currentBodyHash(root: string, path: string): string {
  const absolute = resolve(root, path);
  return existsSync(absolute) ? digestJson({ body: readFileSync(absolute, "utf8") } as unknown as Json) : "missing";
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
  return { port, counts: () => ({ sync, buildTaskContext }) };
}

function fakeExternalDocumentation(
  onFetch: () => void,
  mode: "manual" | "prepare-unknowns" = "manual",
  options: { failFetch?: boolean } = {}
): ExternalDocumentationPort {
  return {
    health() {
      return {
        provider: "context7",
        enabled: true,
        mode,
        egress: mode === "prepare-unknowns" ? "prepare-unknowns" : "manual-only",
        cache: "sqlite",
        keySource: "none"
      };
    },
    async resolve() {
      return {
        schemaVersion: "archcontext.external-docs-resolve/v1",
        provider: "context7",
        queryDigest: `sha256:${"3".repeat(64)}`,
        searchFilterApplied: false,
        egress: "manual-only",
        candidates: [{
          id: "/facebook/react",
          title: "React",
          versions: ["18.2.0"]
        }]
      };
    },
    async fetch(input) {
      onFetch();
      if (options.failFetch) throw new Error("context7 unavailable");
      return {
        schemaVersion: "archcontext.external-docs-fetch/v1",
        provider: "context7",
        cacheStatus: "miss",
        request: {
          libraryId: input.libraryId,
          version: input.version,
          queryDigest: `sha256:${"4".repeat(64)}`,
          intent: input.intent
        },
        resource: {
          schemaVersion: "archcontext.external-document/v1",
          provider: "context7",
          libraryId: input.libraryId,
          requestedVersion: input.version,
          resolvedVersion: input.version,
          queryDigest: `sha256:${"4".repeat(64)}`,
          contentDigest: `sha256:${"5".repeat(64)}`,
          retrievedAt: "2026-06-24T00:00:00.000Z",
          expiresAt: "2026-07-24T00:00:00.000Z",
          trust: "external-unverified",
          enforcement: "advisory-only",
          cacheStatus: "miss",
          uri: `archcontext://external-docs/context7/sha256:${"5".repeat(64)}`,
          byteCount: 38,
          snippets: [{
            title: "React useState",
            contentPreview: "External documentation data for useState.",
            contentDigest: `sha256:${"5".repeat(64)}`,
            sourceUri: "https://react.dev/reference/react/useState",
            byteCount: 38
          }],
          warning: "untrusted-documentation-data"
        }
      };
    }
  };
}

function context7FailureMatrixProvider(label: Context7FailureMatrixCase): { port: ExternalDocumentationPort; fetchCalls: () => number } {
  let fetchCalls = 0;
  const adapter = new Context7ExternalDocumentationAdapter({
    enabled: label !== "disabled",
    mode: "prepare-unknowns",
    retryBudget: 0,
    rateLimit: false,
    circuitBreaker: false,
    transport: context7FailureMatrixTransport(label),
    clock: () => "2026-06-24T00:00:00.000Z"
  });
  return {
    port: {
      health: () => adapter.health(),
      resolve: (input) => adapter.resolve(input),
      async fetch(input) {
        fetchCalls += 1;
        return adapter.fetch(input);
      }
    },
    fetchCalls: () => fetchCalls
  };
}

function context7FailureMatrixTransport(label: Context7FailureMatrixCase): Context7Transport {
  return {
    async search() {
      return {
        searchFilterApplied: true,
        results: [{
          id: "/facebook/react",
          title: "React",
          versions: ["18.2.0"]
        }]
      };
    },
    async getContext(input) {
      if (label === "no-key" && !input.apiKey) {
        throw new Context7ProviderError("http-error", "Context7 provider rejected missing API key", { statusCode: 401, retryable: false });
      }
      if (label === "no-network") throw new TypeError("fetch failed");
      if (label === "429") {
        throw new Context7ProviderError("rate-limited", "Context7 provider rate limited request", { statusCode: 429, retryable: false });
      }
      if (label === "timeout") {
        throw new Context7ProviderError("timeout", "Context7 provider request timed out", { retryable: false });
      }
      if (label === "malformed") {
        throw new Context7ProviderError("malformed", "Context7 provider returned malformed response", { retryable: false });
      }
      throw new Error(`unexpected failure matrix case: ${label}`);
    }
  };
}

function projectLocalCorePrepareComplete(prepare: any, complete: any) {
  const context = prepare.data?.context;
  return {
    prepareOk: prepare.ok,
    completeOk: complete.ok,
    practiceIds: (context?.practiceGuidance?.matches ?? []).map((match: any) => match.practiceId),
    constraints: context?.constraints,
    realConstraints: context?.realConstraints,
    posture: prepare.data?.posture,
    pressure: prepare.data?.pressure,
    externalResourceCount: (context?.resources ?? []).filter((resource: any) => resource.type === "external-docs").length,
    complete: {
      result: complete.data?.result,
      summary: complete.data?.summary,
      findings: complete.data?.findings,
      practiceViolations: complete.data?.practiceViolations,
      actionsRequired: complete.data?.actionsRequired,
      cleanup: complete.data?.cleanup
    }
  };
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
  return { port, setCycle: (enabled) => { cycle = enabled; } };
}

describe("local runtime foundation", () => {
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
      expect((sync.data as any).codeFactsDigest).toMatch(/^sha256:/);

      const context = await daemon.context(root, "add billing");
      expect(context.ok).toBe(true);
      expect((context.data as any).schemaVersion).toBe("archcontext.task-context/v1");
      expect((context.data as any).resources.length).toBeGreaterThanOrEqual(3);

      const prepare = await daemon.prepare(root, "remove legacy v1 wrapper", 12_288, 2, "task_runtime_test");
      expect(prepare.ok).toBe(true);
      const checkpoint = await daemon.checkpoint(root, {
        taskSessionId: "task_runtime_test",
        event: "post-edit",
        changedPaths: ["src/example.ts"],
        maxItems: 2
      });
      expect((checkpoint.data as any).schemaVersion).toBe("archcontext.practice-checkpoint/v1");
      expect((checkpoint.data as any).reasonCode).toBe("no-op");
      expect((checkpoint.data as any).delta.unchanged.length).toBeGreaterThan(0);

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
      const first = await daemon.checkpoint(root, input);
      expect((first.data as any).hook.coalesced).toBe(false);
      expect(facts.counts()).toEqual({ sync: 1, buildTaskContext: 2 });

      let last = first;
      for (let index = 0; index < 9; index += 1) {
        last = await daemon.checkpoint(root, input);
      }
      expect((last.data as any).hook.coalesced).toBe(true);
      expect((last.data as any).hook.skippedAnalysis).toBe(true);
      expect((last.data as any).hook.coalescedEventCount).toBe(10);
      expect((last.data as any).resultDigest).toBe((first.data as any).resultDigest);
      expect(facts.counts()).toEqual({ sync: 1, buildTaskContext: 2 });
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime jobs enqueue Git metadata through daemon boundary and claim a lease", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:00:00.000Z"
      });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "changed.ts"), "export const changed = true;\n", "utf8");

      const first = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-edit",
        taskSessionId: "task.runtime-agent",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.runtime-test",
        maxAttempts: 2,
        cooldownMs: 1_000,
        contextMaxItems: 2
      });
      const duplicate = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-edit",
        taskSessionId: "task.runtime-agent",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.runtime-test",
        maxAttempts: 2,
        cooldownMs: 1_000,
        contextMaxItems: 2
      });
      expect(first.ok).toBe(true);
      expect(duplicate.ok).toBe(true);
      expect((first.data as any).enqueued).toBe(true);
      expect((first.data as any).backpressure).toMatchObject({ accepted: true, maxQueuedJobs: 32, priority: 0 });
      expect((duplicate.data as any).deduplicated).toBe(true);
      expect((first.data as any).change.paths).toEqual([{ path: "src/changed.ts", status: "added", rawStatus: "??" }]);
      expect(JSON.stringify(first.data)).not.toContain("export const changed");

      const list = await daemon.jobsList(root, { statuses: ["queued"] });
      expect((list.data as any).count).toBe(1);
      const queued = (list.data as any).jobs[0];
      expect(queued.job.trigger).toMatchObject({ source: "git_hook", reason: "post-edit" });
      expect(queued.debounceUntil).toBe("2026-06-25T02:00:01.000Z");
      expect(queued.job.inputDigest).toBe(queued.job.extensions.investigationContext.inputDigest);
      expect(queued.job.extensions.investigationContext).toMatchObject({
        schemaVersion: "archcontext.investigation-context-bundle/v1",
        taskSessionId: "task.runtime-agent",
        fingerprint: queued.job.fingerprint,
        extensions: {
          ledgerContext: {
            schemaVersion: "archcontext.investigation-ledger-context/v1",
            selected: {
              entities: [],
              relations: [],
              constraints: [],
              evidenceBindings: [],
              candidateChanges: []
            }
          },
          gitChange: {
            pathCount: 1,
            changedPaths: [{ path: "src/changed.ts", status: "added", rawStatus: "??" }]
          },
          analysisKind: "architecture-delta"
        }
      });
      expect(queued.job.extensions.queuePlanDigest).toMatch(/^sha256:/);
      expect(JSON.stringify(queued.job.extensions)).not.toContain("export const changed");
      expect(JSON.stringify(queued.job.extensions)).not.toContain("diff --git");

      const claim = await daemon.jobsClaim(root, {
        workerId: "worker.al4",
        leaseMs: 30_000,
        now: "2026-06-25T02:00:01.000Z"
      });
      expect((claim.data as any).job).toMatchObject({
        job: { status: "running" },
        attemptCount: 1,
        leaseOwner: "worker.al4"
      });
      const secondClaim = await daemon.jobsClaim(root, {
        workerId: "worker.al4-second",
        leaseMs: 30_000,
        now: "2026-06-25T02:00:02.000Z"
      });
      expect((secondClaim.data as any).job).toBeUndefined();

      const stats = await daemon.jobsStats(root, { now: "2026-06-25T02:00:03.000Z" });
      expect((stats.data as any)).toMatchObject({
        schemaVersion: "archcontext.runtime-agent-job-queue-stats/v1",
        queuedDepth: 0,
        runningDepth: 1,
        activeDepth: 1,
        totalJobCount: 1
      });
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime jobs reject stale successful completion before worker side effects", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:20:00.000Z"
      });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "changed.ts"), "export const changed = true;\n", "utf8");

      const enqueue = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-edit",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.runtime-stale-complete"
      });
      const jobId = (enqueue.data as any).record.job.jobId;
      const claim = await daemon.jobsClaim(root, {
        workerId: "worker.stale",
        leaseMs: 30_000,
        now: "2026-06-25T02:20:01.000Z"
      });
      expect((claim.data as any).job.job.jobId).toBe(jobId);

      execFileSync("git", ["add", "src/changed.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "advance-head"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      const complete = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.stale",
        status: "succeeded",
        outputDigest: digestJson({ staleWorkerOutput: true } as any),
        now: "2026-06-25T02:20:02.000Z"
      });

      expect(complete.ok).toBe(false);
      expect((complete as any).error.code).toBe("AC_CONTEXT_STALE");
      const expired = await daemon.jobsList(root, { statuses: ["expired"] });
      expect((expired.data as any).jobs).toHaveLength(1);
      expect((expired.data as any).jobs[0].job.jobId).toBe(jobId);
      expect((expired.data as any).jobs[0].lastError).toBe("stale-head-or-worktree");
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime jobs reject duplicate terminal completion before replacing output", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:25:00.000Z"
      });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "changed.ts"), "export const changed = true;\n", "utf8");

      const enqueue = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-edit",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.runtime-duplicate-complete"
      });
      const jobId = (enqueue.data as any).record.job.jobId;
      await daemon.jobsClaim(root, {
        workerId: "worker.duplicate",
        leaseMs: 30_000,
        now: "2026-06-25T02:25:01.000Z"
      });
      const outputDigest = digestJson({ workerOutput: "first-completion" } as any);
      const firstComplete = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.duplicate",
        status: "succeeded",
        outputDigest,
        now: "2026-06-25T02:25:02.000Z"
      });
      expect(firstComplete.ok).toBe(true);

      const duplicateComplete = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.duplicate",
        status: "succeeded",
        outputDigest: digestJson({ workerOutput: "duplicate-completion" } as any),
        now: "2026-06-25T02:25:03.000Z"
      });
      expect(duplicateComplete.ok).toBe(false);
      expect((duplicateComplete as any).error.code).toBe("AC_PRECONDITION_FAILED");

      const succeeded = await daemon.jobsList(root, { statuses: ["succeeded"] });
      expect((succeeded.data as any).jobs).toHaveLength(1);
      expect((succeeded.data as any).jobs[0].job.outputDigest).toBe(outputDigest);
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime jobs refuse completion, retry, and cancellation issued from another repository", async () => {
    const owner = createGitRepo();
    const foreign = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:40:00.000Z"
      });
      mkdirSync(join(owner, "src"), { recursive: true });
      writeFileSync(join(owner, "src", "changed.ts"), "export const changed = true;\n", "utf8");
      mkdirSync(join(foreign, "src"), { recursive: true });
      writeFileSync(join(foreign, "src", "changed.ts"), "export const changed = true;\n", "utf8");

      const enqueue = await daemon.jobsEnqueueGitHook(owner, {
        source: "worktree",
        event: "post-edit",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.runtime-cross-repository"
      });
      const jobId = (enqueue.data as any).record.job.jobId;
      const claim = await daemon.jobsClaim(owner, {
        workerId: "worker.owner",
        leaseMs: 30_000,
        now: "2026-06-25T02:40:01.000Z"
      });
      expect((claim.data as any).job.job.jobId).toBe(jobId);

      const crossComplete = await daemon.jobsComplete(foreign, {
        jobId,
        workerId: "worker.owner",
        status: "succeeded",
        outputDigest: digestJson({ workerOutput: "cross-repository" } as any),
        now: "2026-06-25T02:40:02.000Z"
      });
      expect(crossComplete.ok).toBe(false);
      expect((crossComplete as any).error.code).toBe("AC_PRECONDITION_FAILED");
      expect((crossComplete as any).error.reasonCode).toBe("runtime-agent-job-out-of-scope");

      const crossRetry = await daemon.jobsRetry(foreign, {
        jobId,
        reason: "cross-repository-retry",
        now: "2026-06-25T02:40:03.000Z"
      });
      expect(crossRetry.ok).toBe(false);
      expect((crossRetry as any).error.reasonCode).toBe("runtime-agent-job-out-of-scope");

      const crossCancel = await daemon.jobsCancel(foreign, {
        jobId,
        reason: "cross-repository-cancel",
        now: "2026-06-25T02:40:04.000Z"
      });
      expect(crossCancel.ok).toBe(false);
      expect((crossCancel as any).error.reasonCode).toBe("runtime-agent-job-out-of-scope");

      const stillRunning = await daemon.jobsList(owner, { statuses: ["running"] });
      expect((stillRunning.data as any).jobs).toHaveLength(1);
      expect((stillRunning.data as any).jobs[0]).toMatchObject({
        job: { jobId, status: "running" },
        leaseOwner: "worker.owner"
      });

      const complete = await daemon.jobsComplete(owner, {
        jobId,
        workerId: "worker.owner",
        status: "failed",
        error: "owner-failure",
        now: "2026-06-25T02:40:05.000Z"
      });
      expect(complete.ok).toBe(true);
      const retry = await daemon.jobsRetry(owner, { jobId, reason: "owner-retry", now: "2026-06-25T02:40:06.000Z" });
      expect(retry.ok).toBe(true);
      const cancel = await daemon.jobsCancel(owner, { jobId, reason: "owner-cancel", now: "2026-06-25T02:40:07.000Z" });
      expect(cancel.ok).toBe(true);
      expect((cancel.data as any).job.job.status).toBe("cancelled");
    } finally {
      removeTempRepo(owner);
      removeTempRepo(foreign);
    }
  });

  test("issue #169: runtime jobs reject unsafe completion metadata without changing the running job", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({ localStore: store });
      writeFileSync(join(root, "changed.ts"), "export const changed = true;\n");
      const enqueue = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree", event: "post-edit", analysisKind: "architecture-delta",
        risk: "high", uncertainty: "high", coalesceKey: "privacy-regression"
      });
      const jobId = (enqueue.data as any).record.job.jobId;
      await daemon.jobsClaim(root, { workerId: "privacy-test" });
      const before = await daemon.jobsList(root);
      const forbidden = [
        "-----BEGIN PRIVATE KEY-----",
        "ghp_" + "x".repeat(24),
        "github_pat_" + "x".repeat(24),
        "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-before\n+after",
        "x".repeat(8193)
      ];
      for (const value of forbidden) {
        for (const field of ["runMetadata", "error"]) {
          const result = await daemon.jobsComplete(root, {
            jobId, workerId: "privacy-test", status: "failed",
            [field]: field === "runMetadata" ? { summary: value } : value
          } as any);
          expect(result.ok).toBe(false);
          expect(result.error?.code).toBe("AC_SCHEMA_INVALID");
          expect(await daemon.jobsList(root)).toEqual(before);
        }
      }
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime jobs persist provider run metadata on completion", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:30:00.000Z"
      });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "changed.ts"), "export const changed = true;\n", "utf8");

      const enqueue = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-edit",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.runtime-metadata"
      });
      const jobId = (enqueue.data as any).record.job.jobId;
      const claim = await daemon.jobsClaim(root, {
        workerId: "worker.metadata",
        leaseMs: 30_000,
        now: "2026-06-25T02:30:01.000Z"
      });
      const claimedJob = (claim.data as any).job.job;
      const outputDigest = digestJson({ workerOutput: "metadata" } as any);

      const complete = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.metadata",
        status: "succeeded",
        outputDigest,
        runMetadata: {
          schemaVersion: "archcontext.agent-investigation-run-metadata/v1",
          runnerId: "runner.codex",
          provider: "codex",
          modelId: "codex-test",
          promptTemplateDigest: claimedJob.promptTemplateDigest,
          inputDigest: claimedJob.inputDigest,
          outputDigest,
          startedAt: "2026-06-25T02:30:01.000Z",
          completedAt: "2026-06-25T02:30:04.000Z",
          durationMs: 3_000,
          outcome: "succeeded",
          attempts: 1,
          maxAttempts: 1,
          fallbackUsed: false
        },
        now: "2026-06-25T02:30:04.000Z"
      });

      expect(complete.ok).toBe(true);
      expect((complete.data as any).job.job.extensions.agentRun).toMatchObject({
        schemaVersion: "archcontext.agent-investigation-run-metadata/v1",
        runnerId: "runner.codex",
        provider: "codex",
        modelId: "codex-test",
        outputDigest,
        outcome: "succeeded",
        attempts: 1,
        fallbackUsed: false
      });
      const succeeded = await daemon.jobsList(root, { statuses: ["succeeded"] });
      expect((succeeded.data as any).jobs[0].job.extensions.agentRun).toMatchObject({
        provider: "codex",
        durationMs: 3_000,
        outputDigest
      });
      expect(JSON.stringify((succeeded.data as any).jobs[0].job.extensions.agentRun)).not.toContain("export const changed");
      expect(JSON.stringify((succeeded.data as any).jobs[0].job.extensions.agentRun)).not.toContain("diff --git");
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime jobs store agent documentation drafts only inside advisory proposal metadata", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:35:00.000Z"
      });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "changed.ts"), "export const changed = true;\n", "utf8");

      const enqueue = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-edit",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.runtime-proposal-plan"
      });
      const jobId = (enqueue.data as any).record.job.jobId;
      const claim = await daemon.jobsClaim(root, {
        workerId: "worker.proposal",
        leaseMs: 30_000,
        now: "2026-06-25T02:35:01.000Z"
      });
      const claimedJob = (claim.data as any).job.job;
      const outputDigest = digestJson({ workerOutput: "proposal-plan" } as any);
      const proposedDeltaDigest = digestJson({ delta: "selected" } as any);
      const prose = "## Context\n\nThe deterministic delta selected module.runtime.proposal for review.\n";
      const proseDigest = digestJson({ prose } as any);
      const documentationDraftInput = {
        schemaVersion: "archcontext.agent-documentation-draft/v1",
        draftId: "agent_doc_draft.runtime_proposal",
        jobId,
        reportId: "investigation_report.runtime_proposal",
        kind: "adr-prose",
        title: "Runtime proposal ADR prose",
        prose,
        proseDigest,
        targetPath: "docs/adr/ADR-0041-runtime-proposal.md",
        proposedDeltaDigests: [proposedDeltaDigest],
        evidenceBindingIds: ["binding.runtime.proposal"],
        inputDigest: claimedJob.inputDigest,
        outputDigest,
        promptTemplateDigest: claimedJob.promptTemplateDigest,
        acceptedProjection: false,
        authority: "advisory-only",
        requiredNextStep: "deterministic-validation",
        createdAt: "2026-06-25T02:35:03.000Z"
      };
      const proposalPlanInput = {
        schemaVersion: "archcontext.investigation-report-proposal-plan/v1",
        proposalId: "investigation_proposal.runtime_proposal",
        jobId,
        reportId: "investigation_report.runtime_proposal",
        repository: claimedJob.repository,
        worktree: claimedJob.worktree,
        inputDigest: claimedJob.inputDigest,
        outputDigest,
        proposedDeltaDigests: [proposedDeltaDigest],
        proposedDeltas: [],
        documentationDraftDigests: [digestJson(documentationDraftInput as any)],
        documentationDrafts: [{
          ...documentationDraftInput,
          draftDigest: digestJson(documentationDraftInput as any)
        }],
        evidenceBindingIds: ["binding.runtime.proposal"],
        evidenceIds: ["evidence.runtime.proposal"],
        validationDigest: investigationReportProposalValidationDigest({
          jobId,
          reportId: "investigation_report.runtime_proposal",
          inputDigest: claimedJob.inputDigest,
          outputDigest,
          proposedDeltaDigests: [proposedDeltaDigest],
          documentationDraftDigests: [digestJson(documentationDraftInput as any)],
          githubIssueDraftDigests: []
        }),
        directMutationAllowed: false,
        requiredNextStep: "deterministic-validation",
        forbiddenActions: ["write-ledger", "write-yaml", "write-docs", "apply-changeset", "run-tool", "execute-command"],
        authority: "advisory-only",
        retention: "no-raw-source-or-diff-bodies",
        createdAt: "2026-06-25T02:35:03.000Z"
      };
      const proposalPlan = {
        ...proposalPlanInput,
        proposalDigest: digestJson(proposalPlanInput as any)
      } as any;

      const invalid = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.proposal",
        status: "succeeded",
        outputDigest,
        proposalPlan: {
          ...proposalPlan,
          documentationDrafts: [{
            ...proposalPlan.documentationDrafts[0],
            acceptedProjection: true
          }]
        },
        now: "2026-06-25T02:35:03.500Z"
      } as any);
      expect(invalid.ok).toBe(false);
      expect((invalid as any).error.code).toBe("AC_SCHEMA_INVALID");

      const complete = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.proposal",
        status: "succeeded",
        outputDigest,
        proposalPlan,
        now: "2026-06-25T02:35:04.000Z"
      });

      expect(complete.ok).toBe(true);
      expect((complete.data as any).job.job.extensions.agentRun.proposalPlan.documentationDrafts[0]).toMatchObject({
        draftId: "agent_doc_draft.runtime_proposal",
        acceptedProjection: false,
        authority: "advisory-only",
        inputDigest: claimedJob.inputDigest,
        outputDigest
      });
      expect(existsSync(join(root, "docs/adr/ADR-0041-runtime-proposal.md"))).toBe(false);
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime jobs reject tampered github issue drafts inside advisory proposal metadata", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:45:00.000Z"
      });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "changed.ts"), "export const changed = true;\n", "utf8");

      const enqueue = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-edit",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.runtime-issue-draft-proposal"
      });
      const jobId = (enqueue.data as any).record.job.jobId;
      const claim = await daemon.jobsClaim(root, {
        workerId: "worker.issue-draft",
        leaseMs: 30_000,
        now: "2026-06-25T02:45:01.000Z"
      });
      const claimedJob = (claim.data as any).job.job;
      const outputDigest = digestJson({ workerOutput: "issue-draft-plan" } as any);
      const bodyMarkdown = "## Problem\n\nThe legacy wrapper still duplicates the v2 fallback path.\n";
      const bodyDigest = digestJson({ bodyMarkdown } as any);
      const githubIssueDraftInput = {
        schemaVersion: "archcontext.github-issue-draft/v1",
        draftId: "github_issue_draft.runtime_proposal",
        jobId,
        reportId: "investigation_report.runtime_proposal",
        kind: "task",
        priority: "P2",
        title: "Remove legacy wrapper v1 duplication",
        bodyMarkdown,
        bodyDigest,
        labels: ["architecture"],
        evidence: [{ path: "src/billing/legacy-wrapper-v1.ts", startLine: 1, note: "duplicate of v2 fallback" }],
        acceptance: ["legacy wrapper removed"],
        verificationCommands: ["bun test"],
        baseSha: claimedJob.worktree.headSha,
        inputDigest: claimedJob.inputDigest,
        outputDigest,
        promptTemplateDigest: claimedJob.promptTemplateDigest,
        authority: "advisory-only",
        requiredNextStep: "deterministic-validation",
        createdAt: "2026-06-25T02:45:03.000Z"
      };
      const githubIssueDraft = {
        ...githubIssueDraftInput,
        draftDigest: digestJson(githubIssueDraftInput as any)
      };
      const proposalPlanInput = {
        schemaVersion: "archcontext.investigation-report-proposal-plan/v1",
        proposalId: "investigation_proposal.runtime_issue_draft",
        jobId,
        reportId: "investigation_report.runtime_proposal",
        repository: claimedJob.repository,
        worktree: claimedJob.worktree,
        inputDigest: claimedJob.inputDigest,
        outputDigest,
        proposedDeltaDigests: [],
        proposedDeltas: [],
        documentationDraftDigests: [],
        documentationDrafts: [],
        githubIssueDraftDigests: [githubIssueDraft.draftDigest],
        githubIssueDrafts: [githubIssueDraft],
        evidenceBindingIds: [],
        evidenceIds: [],
        validationDigest: investigationReportProposalValidationDigest({
          jobId,
          reportId: "investigation_report.runtime_proposal",
          inputDigest: claimedJob.inputDigest,
          outputDigest,
          proposedDeltaDigests: [],
          documentationDraftDigests: [],
          githubIssueDraftDigests: [githubIssueDraft.draftDigest]
        }),
        directMutationAllowed: false,
        requiredNextStep: "deterministic-validation",
        forbiddenActions: ["write-ledger", "write-yaml", "write-docs", "apply-changeset", "run-tool", "execute-command"],
        authority: "advisory-only",
        retention: "no-raw-source-or-diff-bodies",
        createdAt: "2026-06-25T02:45:03.000Z"
      };
      const proposalPlan = {
        ...proposalPlanInput,
        proposalDigest: digestJson(proposalPlanInput as any)
      } as any;

      const tamperedBodyDigest = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.issue-draft",
        status: "succeeded",
        outputDigest,
        proposalPlan: {
          ...proposalPlan,
          githubIssueDrafts: [{ ...proposalPlan.githubIssueDrafts[0], bodyDigest: `sha256:${"0".repeat(64)}` }]
        },
        now: "2026-06-25T02:45:03.500Z"
      } as any);
      expect(tamperedBodyDigest.ok).toBe(false);
      expect((tamperedBodyDigest as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((tamperedBodyDigest as any).error.message).toContain("bodyDigest mismatch");

      const tamperedAuthority = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.issue-draft",
        status: "succeeded",
        outputDigest,
        proposalPlan: {
          ...proposalPlan,
          githubIssueDrafts: [{ ...proposalPlan.githubIssueDrafts[0], authority: "direct-mutation" }]
        },
        now: "2026-06-25T02:45:03.600Z"
      } as any);
      expect(tamperedAuthority.ok).toBe(false);
      expect((tamperedAuthority as any).error.message).toContain("advisory-only");

      // A draft's own draftDigest is recomputed from its full content (not just bodyDigest), so
      // tampering the digest label itself is caught even though every other field is untouched.
      const tamperedDraftDigest = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.issue-draft",
        status: "succeeded",
        outputDigest,
        proposalPlan: {
          ...proposalPlan,
          githubIssueDrafts: [{ ...proposalPlan.githubIssueDrafts[0], draftDigest: `sha256:${"1".repeat(64)}` }]
        },
        now: "2026-06-25T02:45:03.700Z"
      } as any);
      expect(tamperedDraftDigest.ok).toBe(false);
      expect((tamperedDraftDigest as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((tamperedDraftDigest as any).error.message).toContain("draftDigest mismatch");

      // plan.githubIssueDraftDigests (what actually gets written to the architecture ledger) must
      // match the digests of plan.githubIssueDrafts, even though the drafts themselves are untouched.
      const tamperedDigestsArray = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.issue-draft",
        status: "succeeded",
        outputDigest,
        proposalPlan: {
          ...proposalPlan,
          githubIssueDraftDigests: []
        },
        now: "2026-06-25T02:45:03.800Z"
      } as any);
      expect(tamperedDigestsArray.ok).toBe(false);
      expect((tamperedDigestsArray as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((tamperedDigestsArray as any).error.message).toContain("githubIssueDraftDigests must match");

      // plan.validationDigest is a claimed top-level integrity digest over the plan's own digests
      // (proposedDeltaDigests/documentationDraftDigests/githubIssueDraftDigests); the daemon must
      // recompute it rather than trust the claim, so forging it must be caught even though every
      // array it covers is untouched.
      const tamperedValidationDigest = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.issue-draft",
        status: "succeeded",
        outputDigest,
        proposalPlan: {
          ...proposalPlan,
          validationDigest: digestJson({ validation: "forged" } as any)
        },
        now: "2026-06-25T02:45:03.850Z"
      } as any);
      expect(tamperedValidationDigest.ok).toBe(false);
      expect((tamperedValidationDigest as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((tamperedValidationDigest as any).error.message).toContain("validationDigest mismatch");

      // plan.proposalDigest is recomputed as digestJson(plan minus proposalDigest) and must cover
      // the whole plan; forging just the digest label, with every other field untouched, must
      // still be caught.
      const tamperedProposalDigest = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.issue-draft",
        status: "succeeded",
        outputDigest,
        proposalPlan: {
          ...proposalPlan,
          proposalDigest: `sha256:${"2".repeat(64)}`
        },
        now: "2026-06-25T02:45:03.900Z"
      } as any);
      expect(tamperedProposalDigest.ok).toBe(false);
      expect((tamperedProposalDigest as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((tamperedProposalDigest as any).error.message).toContain("proposalDigest mismatch");

      const complete = await daemon.jobsComplete(root, {
        jobId,
        workerId: "worker.issue-draft",
        status: "succeeded",
        outputDigest,
        proposalPlan,
        now: "2026-06-25T02:45:04.000Z"
      });
      expect(complete.ok).toBe(true);
      expect((complete.data as any).job.job.extensions.agentRun.proposalPlan.githubIssueDrafts[0]).toMatchObject({
        draftId: "github_issue_draft.runtime_proposal",
        authority: "advisory-only",
        priority: "P2"
      });
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime jobs skip generated projection hook changes without enqueueing", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:10:00.000Z"
      });
      mkdirSync(join(root, ".archcontext", "generated"), { recursive: true });
      writeFileSync(join(root, ".archcontext", "generated", "ARCHITECTURE.md"), "<!-- Generated by ArchContext. Do not edit by hand. -->\n", "utf8");

      const skipped = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-write"
      });
      expect(skipped.ok).toBe(true);
      expect((skipped.data as any)).toMatchObject({
        schemaVersion: "archcontext.runtime-agent-job-skip/v1",
        skipped: true,
        enqueued: false,
        reasonCode: "archcontext-generated-projection",
        source: "worktree"
      });
      expect((skipped.data as any).change.paths).toEqual([
        { path: ".archcontext/generated/ARCHITECTURE.md", status: "added", rawStatus: "??" }
      ]);
      expect(JSON.stringify(skipped.data)).not.toContain("Do not edit by hand");

      const list = await daemon.jobsList(root);
      expect((list.data as any).count).toBe(0);
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime jobs skip clean hook changes without enqueueing", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:11:00.000Z"
      });

      const skipped = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-write"
      });
      expect(skipped.ok).toBe(true);
      expect((skipped.data as any)).toMatchObject({
        schemaVersion: "archcontext.runtime-agent-job-skip/v1",
        skipped: true,
        enqueued: false,
        reasonCode: "no-changed-paths",
        source: "worktree",
        analysisKind: "architecture-delta"
      });

      const list = await daemon.jobsList(root);
      expect((list.data as any).count).toBe(0);
    } finally {
      removeTempRepo(root);
    }
  });

  test("checkpoint restores persisted baseline after daemon restart", async () => {
    const root = tempRepo();
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
      const checkpoint = await second.checkpoint(root, {
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
      expect((review.data as any).summary).toMatchObject({ errors: 0, warnings: 1 });
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
          .rejects.toThrow("projection-manifest-profile-invalid");
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
      expect((clean.data as any).result).toBe("pass");
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

  test("complete_task blocks a projection whose declared source moved after the verified commit", async () => {
    // Git-backed on purpose: the freshness gate diffs the manifest's verifiedAgainst commit against
    // HEAD, so it needs real commits rather than a synthetic worktree digest.
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-08-08T10:40:00.000Z" });
      await daemon.init(root, "Freshness Gate App");
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.architecture-context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture-context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`,
        "utf8"
      );
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/app.ts"), "export const app = 1;\n", "utf8");
      gitCommitAll(root, "declare capability source");
      writeArchitectureDocsProjection(root);

      const verifiedCommit = gitOut(root, "rev-parse", "HEAD");
      const fresh = await daemon.completeTask(root, {
        taskSessionId: "task_projection_freshness",
        task: "finish with the projection verified against HEAD"
      });
      expect(fresh.ok).toBe(true);
      expect((fresh.data as any).result).toBe("pass");
      expect((fresh.data as any).extensions.projectionFreshnessGate).toBeUndefined();

      // A commit outside every declared footprint leaves both projection gates silent: the stamp is
      // sticky, so a moved HEAD alone is not drift either.
      writeFileSync(join(root, "NOTES.md"), "# notes\n", "utf8");
      gitCommitAll(root, "change outside the declared footprint");
      const stillFresh = await daemon.completeTask(root, {
        taskSessionId: "task_projection_freshness",
        task: "finish after an unrelated commit"
      });
      expect((stillFresh.data as any).result).toBe("pass");
      expect((stillFresh.data as any).findings.some((finding: any) => finding.id === "stale-context")).toBe(false);
      expect((stillFresh.data as any).extensions.projectionFreshnessGate).toBeUndefined();

      // A commit inside `source.include` moves the code the projection describes.
      writeFileSync(join(root, "src/app.ts"), "export const app = 1;\nexport const extra = 2;\n", "utf8");
      gitCommitAll(root, "change inside the declared footprint");
      const stale = await daemon.completeTask(root, {
        taskSessionId: "task_projection_freshness",
        task: "finish after changing the declared capability source"
      });
      expect((stale.data as any).result).toBe("fail_action_required");
      const finding = (stale.data as any).findings.find((entry: any) => entry.id === "stale-context");
      expect(finding.type).toBe("stale-context");
      expect(finding.message).toContain("projection-source-changed-since-verified-commit");
      expect(finding.message).toContain(`capability.architecture-context(1@${verifiedCommit})`);
      const gate = (stale.data as any).extensions.projectionFreshnessGate;
      expect(gate.ok).toBe(false);
      expect(gate.staleNodes).toEqual([{
        nodeId: "capability.architecture-context",
        verifiedAgainst: expect.objectContaining({ commit: verifiedCommit }),
        changedPathCount: 1,
        changedPaths: ["src/app.ts"],
        changedPathsTruncated: false
      }]);

      // Re-running the projection against the new HEAD re-stamps the document (its measured scale
      // signal moved, so the generated region is genuinely re-derived) and clears the finding.
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

  test("committing the projection itself does not block the next complete_task", async () => {
    // The heart of the sticky stamp: plan → apply → commit the projection → complete, with no
    // second projection run in between. `verifiedAgainst` records when the content was generated,
    // not which HEAD happens to be checked out during the drift re-render, so the projection is a
    // fixed point: committing it does not invalidate it.
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-08-08T10:40:00.000Z" });
      await daemon.init(root, "Projection Fixed Point App");
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.architecture-context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture-context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`,
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

      // Commit the projection output. HEAD now differs from the commit the documents name.
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
      expect((complete.data as any).findings).toEqual([]);
      expect((complete.data as any).result).toBe("pass");

      // The manifest still names the commit the content was generated against, not the projection
      // commit — and the document itself names no commit at all.
      expect(projectionStampCommit(root, "capability.architecture-context")).toBe(appliedAtCommit);
      expect(readText(join(root, "docs/architecture/modules/capability-architecture-context.md")))
        .not.toContain(appliedAtCommit);
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("a covered source edit that moves no rendered assertion is cleared by re-projecting", async () => {
    // The other half of the fixed point. An edit inside the capability footprint that changes nothing
    // the document asserts (same file count, same line count, same import edges) leaves every render
    // digest identical. If the stamp stuck on digests alone, the freshness gate would report the
    // projection stale and re-projecting would produce byte-identical output — `complete_task` would
    // be wedged with no way out. The stamp lifecycle also asks "did covered source change since the
    // stamped commit?", so re-projecting genuinely re-verifies and clears the gate.
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-08-08T10:40:00.000Z" });
      await daemon.init(root, "Projection Deadlock App");
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.architecture-context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture-context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`,
        "utf8"
      );
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/app.ts"), "export const app = 1;\n", "utf8");
      gitCommitAll(root, "declare capability source");
      const verifiedCommit = gitOut(root, "rev-parse", "HEAD");

      await applyArchitectureDocsProjection(root, daemon, "changeset.docs-deadlock-initial");
      gitCommitAll(root, "project architecture documentation");
      const docPath = join(root, "docs/architecture/modules/capability-architecture-context.md");
      const beforeDoc = readText(docPath);
      expect(projectionStampCommit(root, "capability.architecture-context")).toBe(verifiedCommit);

      // Same line, same line count, same files, same imports: no rendered assertion moves.
      writeFileSync(join(root, "src/app.ts"), "export const app = 2;\n", "utf8");
      gitCommitAll(root, "change a literal inside the declared footprint");
      const reverifiedCommit = gitOut(root, "rev-parse", "HEAD");

      const stale = await daemon.completeTask(root, {
        taskSessionId: "task_docs_deadlock",
        task: "finish after an assertion-free change inside the footprint"
      });
      expect((stale.data as any).result).toBe("fail_action_required");
      expect((stale.data as any).findings).toContainEqual(expect.objectContaining({ id: "stale-context" }));
      expect((stale.data as any).extensions.projectionFreshnessGate.reasonCodes)
        .toContain("projection-source-changed-since-verified-commit");

      await applyArchitectureDocsProjection(root, daemon, "changeset.docs-deadlock-reverify");
      const afterDoc = readText(docPath);
      // The re-verification advanced the stamp in the manifest and left the document untouched —
      // byte-identical, marker attributes included. This is the churn fix: re-verifying a capability
      // whose footprint moved no longer produces a documentation diff to commit.
      expect(projectionStampCommit(root, "capability.architecture-context")).toBe(reverifiedCommit);
      expect(afterDoc).toBe(beforeDoc);

      gitCommitAll(root, "re-verify the architecture documentation");
      const complete = await daemon.completeTask(root, {
        taskSessionId: "task_docs_deadlock",
        task: "finish after re-verifying the projection"
      });
      expect((complete.data as any).result).toBe("pass");
      expect((complete.data as any).findings).toEqual([]);
      expect((complete.data as any).extensions.projectionFreshnessGate).toBeUndefined();
      expect((complete.data as any).extensions.projectionDriftGate).toBeUndefined();

      // Idempotent at the same HEAD: a second projection writes the same bytes.
      await applyArchitectureDocsProjection(root, daemon, "changeset.docs-deadlock-idempotent");
      expect(readText(docPath)).toBe(afterDoc);
      expect(gitOut(root, "status", "--porcelain")).toBe("");
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("a stamped commit this repository no longer has re-stamps with a notice instead of failing", async () => {
    // Rebase / shallow clone: the commit the projection is stamped with is gone, so the change set
    // cannot be measured. Failing closed would leave `docs apply` permanently unrunnable, so the
    // renderer re-stamps against the current ref and reports it on the plan surface.
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-08-08T10:40:00.000Z" });
      await daemon.init(root, "Projection Rebase App");
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.architecture-context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture-context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`,
        "utf8"
      );
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/app.ts"), "export const app = 1;\n", "utf8");
      gitCommitAll(root, "declare capability source");
      await applyArchitectureDocsProjection(root, daemon, "changeset.docs-rebase-initial");
      gitCommitAll(root, "project architecture documentation");

      // Rewrite the recorded stamp to a commit that is not in this repository. The manifest is the
      // only place it lives, so this is the whole rewrite.
      const orphanedCommit = "0".repeat(40);
      const appliedCommit = gitOut(root, "rev-parse", "HEAD~1");
      const manifestPath = join(root, "docs/architecture/.projection-manifest.json");
      writeFileSync(manifestPath, readText(manifestPath).replaceAll(appliedCommit, orphanedCommit), "utf8");

      const loaded = loadArchitectureDocumentationInputs(root);
      const measured = loadCapabilitySourceChangesSinceStamps(root, loaded.model);
      expect(measured).toEqual([{
        nodeId: "capability.architecture-context",
        commit: orphanedCommit,
        status: "unmeasurable",
        reason: expect.any(String)
      }]);

      await applyArchitectureDocsProjection(root, daemon, "changeset.docs-rebase-reverify");
      expect(projectionStampCommit(root, "capability.architecture-context")).toBe(gitOut(root, "rev-parse", "HEAD"));
      expect(readText(manifestPath)).not.toContain(orphanedCommit);
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("a second process cannot start on a store whose live writer is mid-ChangeSet; cold start still recovers (#160)", async () => {
    // Process A holds writer ownership with a pending journal: original moved to backup, temp file
    // half written. Before #160, process B's startup recovery treated that live transaction as crash
    // residue and rolled it back before any lock was checked.
    const dir = mkdtempSync(join(tmpdir(), "archctx-writer-barrier-"));
    const root = join(dir, "repo");
    const dbPath = join(dir, "state", "runtime.sqlite");
    const relativePath = ".archcontext/policies/review.yaml";
    const absolutePath = join(root, relativePath);
    const backupPath = `${absolutePath}.archctx-backup`;
    const tempPath = `${absolutePath}.archctx-tmp-barrier`;
    const original = "schemaVersion: archcontext.policy/v1\nid: policy.original\n";
    const writerScript = join(dir, "writer.ts");
    const storeModule = resolve(import.meta.dir, "../../local-store-sqlite/src/index.ts");
    let writer: ChildProcess | undefined;
    try {
      initializeArchContextModel(root, "Writer Barrier App");
      writeFileSync(absolutePath, original, "utf8");
      writeFileSync(writerScript, `
import { renameSync, writeFileSync } from "node:fs";
import { SqliteLocalStore } from ${JSON.stringify(storeModule)};
const [dbPath, root, relativePath, absolutePath, backupPath, tempPath] = process.argv.slice(2);
const store = new SqliteLocalStore(dbPath);
store.acquireWriterOwnership();
await store.migrate();
const journalId = await store.beginChangeSet(root, {
  schemaVersion: "archcontext.changeset/v1", id: "changeset.barrier", status: "approved",
  base: { headSha: "abc123", worktreeDigest: "sha256:${"0".repeat(64)}", modelDigest: "sha256:${"1".repeat(64)}" },
  reason: { taskSessionId: "task.barrier" },
  operations: [{ op: "update_entity_fields", path: relativePath, expectedHash: "sha256:${"2".repeat(64)}", body: "x" }],
  preconditions: [], postconditions: []
});
await store.recordChangeSetFile(journalId, { path: relativePath, tempPath, backupPath, existed: true, operation: "update_entity_fields", bodyHash: "sha256:${"3".repeat(64)}" });
renameSync(absolutePath, backupPath);
writeFileSync(tempPath, "partial write", "utf8");
process.stdout.write("READY\\n");
setInterval(() => undefined, 1 << 30);
`, "utf8");
      writer = spawn(process.execPath, [writerScript, dbPath, root, relativePath, absolutePath, backupPath, tempPath], { stdio: ["ignore", "pipe", "inherit"] });
      await waitForStdoutLine(writer, "READY");

      await expect(createStartedTestDaemon({ localStore: undefined, localStorePath: dbPath })).rejects.toThrow(`local-store-writer-owned: ${dbPath} is owned by another live process (owner record: pid ${writer.pid}`);
      expect(existsSync(absolutePath)).toBe(false);
      expect(readText(backupPath)).toBe(original);
      expect(readText(tempPath)).toBe("partial write");

      writer.kill("SIGKILL");
      await once(writer, "exit");
      writer = undefined;

      const recovered = await createStartedTestDaemon({ localStore: undefined, localStorePath: dbPath });
      expect(readText(absolutePath)).toBe(original);
      expect(existsSync(backupPath)).toBe(false);
      expect(existsSync(tempPath)).toBe(false);
      expect(recovered.status().changeSetRecovery).toBeUndefined();
      await recovered.stop();
      // The lock file itself stays (it is only ever locked, never deleted); the diagnostic owner
      // record leaves with its owner.
      expect(existsSync(`${dbPath}.writer.lock`)).toBe(true);
      expect(existsSync(`${dbPath}.owner.json`)).toBe(false);
    } finally {
      if (writer) {
        writer.kill("SIGKILL");
        await once(writer, "exit").catch(() => undefined);
      }
      removeTempRepo(dir);
    }
  });

  test("startup that leaves a ChangeSet journal unresolved refuses writes until a later start recovers it (#172)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "archctx-recovery-gate-"));
    const root = join(dir, "repo");
    const dbPath = join(dir, "state", "runtime.sqlite");
    const relativePath = ".archcontext/policies/review.yaml";
    const absolutePath = join(root, relativePath);
    const backupPath = join(root, "review.yaml.archctx-backup");
    const original = "schemaVersion: archcontext.policy/v1\nid: policy.original\n";
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      initializeArchContextModel(root, "Recovery Gate App");
      writeFileSync(absolutePath, original, "utf8");
      const store = new SqliteLocalStore(dbPath);
      await store.migrate();
      const journalId = await store.beginChangeSet(root, {
        schemaVersion: "archcontext.changeset/v1",
        id: "changeset.recovery-gate",
        status: "approved",
        base: { headSha: "abc123", worktreeDigest: `sha256:${"0".repeat(64)}`, modelDigest: `sha256:${"1".repeat(64)}` },
        reason: { taskSessionId: "task.recovery-gate" },
        operations: [{ op: "update_entity_fields", path: relativePath, expectedHash: `sha256:${"2".repeat(64)}`, body: "x" }],
        preconditions: [],
        postconditions: []
      } as any);
      await store.recordChangeSetFile(journalId, { path: relativePath, backupPath, existed: true, operation: "update_entity_fields", bodyHash: `sha256:${"3".repeat(64)}` });
      renameSync(absolutePath, backupPath);
      store.close();
      // Restoring the backup fails: its target directory has become a regular file.
      nodeRmSync(dirname(absolutePath), { recursive: true, force: true });
      writeFileSync(dirname(absolutePath), "not a directory", "utf8");

      daemon = await createStartedTestDaemon({ localStore: undefined, localStorePath: dbPath });
      const status = daemon.status();
      expect(status.running).toBe(true);
      expect(status.changeSetRecovery?.writable).toBe(false);
      expect(status.changeSetRecovery?.unresolvedJournals.map((journal) => journal.journalId)).toEqual([journalId]);
      await expect(daemon.init(join(dir, "other-repo"), "Blocked App")).rejects.toThrow("changeset-recovery-unresolved");
      // An approved docs pin writes tracked `.archcontext/` state too, so the gate covers it.
      const pin = await daemon.docs(root, { command: "pin", libraryId: "/facebook/react", version: "18.2.0", approved: true });
      expect(pin.ok).toBe(false);
      expect(pin.error?.code).toBe("AC_PRECONDITION_FAILED");
      expect(pin.error?.message).toContain("changeset-recovery-unresolved");
      expect(existsSync(join(root, ".archcontext", "integrations", "context7.lock.yaml"))).toBe(false);
      expect(readText(backupPath)).toBe(original);

      // Over RPC the refusal is a typed envelope, and /health reports the daemon as write-gated.
      const rpc = new ArchctxRuntimeRpcServer(daemon, {
        root,
        port: 0,
        connectionPath: join(dir, "control", "archctxd.json"),
        lockPath: join(dir, "control", "archctxd.lock")
      });
      const connection = await rpc.start();
      try {
        const health = await (await fetch(`${connection.url}health`, { headers: { "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION, Authorization: `Bearer ${connection.token}` } })).json() as any;
        expect(health.ok).toBe(true);
        expect(health.changeSetRecovery.writable).toBe(false);
        expect(health.changeSetRecovery.unresolvedJournals.map((journal: { journalId: string }) => journal.journalId)).toEqual([journalId]);
        const refused = await new RuntimeRpcClient(connection).init(join(dir, "other-repo"), "Blocked App");
        expect(refused.ok).toBe(false);
        expect(refused.error?.code).toBe("AC_PRECONDITION_FAILED");
        expect(refused.error?.message).toContain("changeset-recovery-unresolved");
      } finally {
        await rpc.stop();
      }
      daemon = undefined;

      nodeRmSync(dirname(absolutePath), { force: true });
      mkdirSync(dirname(absolutePath), { recursive: true });
      daemon = await createStartedTestDaemon({ localStore: undefined, localStorePath: dbPath });
      expect(daemon.status().changeSetRecovery).toBeUndefined();
      expect(readText(absolutePath)).toBe(original);
    } finally {
      await daemon?.stop();
      removeTempRepo(dir);
    }
  });

  test("startup leaves a ChangeSet journal unresolved when a recovered file's backup and destination are both missing (#179)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "archctx-recovery-lost-backup-"));
    const root = join(dir, "repo");
    const dbPath = join(dir, "state", "runtime.sqlite");
    const relativePath = ".archcontext/policies/review.yaml";
    const absolutePath = join(root, relativePath);
    const backupPath = join(root, "review.yaml.archctx-backup");
    const original = "schemaVersion: archcontext.policy/v1\nid: policy.original\n";
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      initializeArchContextModel(root, "Recovery Lost Backup App");
      writeFileSync(absolutePath, original, "utf8");
      const store = new SqliteLocalStore(dbPath);
      await store.migrate();
      const journalId = await store.beginChangeSet(root, {
        schemaVersion: "archcontext.changeset/v1",
        id: "changeset.recovery-lost-backup",
        status: "approved",
        base: { headSha: "abc123", worktreeDigest: `sha256:${"0".repeat(64)}`, modelDigest: `sha256:${"1".repeat(64)}` },
        reason: { taskSessionId: "task.recovery-lost-backup" },
        operations: [{ op: "update_entity_fields", path: relativePath, expectedHash: `sha256:${"2".repeat(64)}`, body: "x" }],
        preconditions: [],
        postconditions: []
      } as any);
      await store.recordChangeSetFile(journalId, { path: relativePath, backupPath, existed: true, operation: "update_entity_fields", bodyHash: `sha256:${"3".repeat(64)}` });
      // The crash happened after the rename to backup, and the backup itself was then lost too.
      renameSync(absolutePath, backupPath);
      nodeRmSync(backupPath, { force: true });
      store.close();

      daemon = await createStartedTestDaemon({ localStore: undefined, localStorePath: dbPath });
      const status = daemon.status();
      expect(status.running).toBe(true);
      expect(status.changeSetRecovery?.writable).toBe(false);
      expect(status.changeSetRecovery?.unresolvedJournals.map((journal) => journal.journalId)).toEqual([journalId]);
      expect(status.changeSetRecovery?.unresolvedJournals[0]?.reason).toContain(relativePath);
      await expect(daemon.init(join(dir, "other-repo"), "Blocked App")).rejects.toThrow("changeset-recovery-unresolved");
    } finally {
      await daemon?.stop();
      removeTempRepo(dir);
    }
  });

  test("a manifest stamp commit that is not a hex SHA never reaches git as an option (#159)", async () => {
    // The projection manifest is committed repository content, i.e. untrusted input. A stamp commit
    // of `--output=output` turns `git diff <commit>..HEAD` into `git diff --output=output..HEAD`,
    // which truncates `output..HEAD` — and follows it when the repository commits it as a symlink.
    const root = createGitRepo();
    const sentinelDir = mkdtempSync(join(tmpdir(), "archctx-stamp-sentinel-"));
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-08-08T10:40:00.000Z" });
      await daemon.init(root, "Projection Stamp Injection App");
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.architecture-context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture-context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`,
        "utf8"
      );
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/app.ts"), "export const app = 1;\n", "utf8");
      gitCommitAll(root, "declare capability source");
      await applyArchitectureDocsProjection(root, daemon, "changeset.docs-stamp-injection");
      gitCommitAll(root, "project architecture documentation");

      const appliedCommit = gitOut(root, "rev-parse", "HEAD~1");
      const manifestPath = join(root, "docs/architecture/.projection-manifest.json");
      writeFileSync(manifestPath, readText(manifestPath).replaceAll(appliedCommit, "--output=output"), "utf8");
      const sentinel = join(sentinelDir, "sentinel.txt");
      writeFileSync(sentinel, "preserve me\n", "utf8");
      const trap = join(root, "output..HEAD");
      if (process.platform !== "win32") symlinkSync(sentinel, trap);

      const loaded = loadArchitectureDocumentationInputs(root);
      // An unusable stamp is never measured, and never reported as `unchanged`.
      expect(loadCapabilitySourceChangesSinceStamps(root, loaded.model)).toEqual([]);
      await daemon.completeTask(root, {
        taskSessionId: "task_stamp_injection",
        task: "complete with a hostile projection manifest"
      });

      expect(readText(sentinel)).toBe("preserve me\n");
      if (process.platform === "win32") expect(existsSync(trap)).toBe(false);
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
      nodeRmSync(sentinelDir, { recursive: true, force: true });
    }
  });

  test("changed paths since a stamp are read NUL-framed, so non-ASCII paths still count as changes (#173)", async () => {
    // `git diff --name-only` C-quotes non-ASCII paths by default ("src/\350\263\207\346\226\231.ts"),
    // and that quoted string never matches `src/**`, so a covered edit read as `unchanged`.
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-08-08T10:40:00.000Z" });
      await daemon.init(root, "Projection Path Framing App");
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.architecture-context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture-context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`,
        "utf8"
      );
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/app.ts"), "export const app = 1;\n", "utf8");
      gitCommitAll(root, "declare capability source");
      await applyArchitectureDocsProjection(root, daemon, "changeset.docs-path-framing");
      gitCommitAll(root, "project architecture documentation");
      const stampCommit = gitOut(root, "rev-parse", "HEAD~1");
      expect(projectionStampCommit(root, "capability.architecture-context")).toBe(stampCommit);

      writeFileSync(join(root, "src/資料.ts"), "export const data = 1;\n", "utf8");
      gitCommitAll(root, "add a non-ASCII source path");

      const loaded = loadArchitectureDocumentationInputs(root);
      expect(loadCapabilitySourceChangesSinceStamps(root, loaded.model)).toEqual([{
        nodeId: "capability.architecture-context",
        commit: stampCommit,
        status: "changed",
        changedPathCount: 1
      }]);
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
      expect(again.error?.message).toContain("archcontext-init-refused");
      expect(readText(manifestPath)).toBe(manifestBefore);
      expect(readText(productPath)).toBe(productBefore);
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
        join(root, ".archcontext/model/nodes/capability.architecture-context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture-context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`,
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
      expect(readText(claudePath)).toContain('id="capability.architecture-context"');
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

      // A hand-edited machine region is reported with the file, the node and both digests.
      writeFileSync(claudePath, before.claude.replace("Architecture Context", "Tampered Name"), "utf8");
      expect(() => agentContextProjectionOperation(root)).toThrow("agent-context-marker-output-digest-mismatch: src/CLAUDE.md");
      expect(() => agentContextProjectionOperation(root)).toThrow("node capability.architecture-context");
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
      })).rejects.toThrow("Path is outside ArchContext write allowlist");
      expect(readText(claudePath)).toBe(before.claude);
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("complete_task fails closed when the projection's verified commit cannot be diffed", async () => {
    const root = createGitRepo();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => "2026-08-08T10:40:00.000Z" });
      await daemon.init(root, "Freshness Fail Closed App");
      // A declared capability footprint is what freshness grades, so the repository needs one
      // before an undiffable stamp can fail closed against anything.
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.architecture-context.yaml"),
        `${readText(join(root, ".archcontext/model/nodes/capability.architecture-context.yaml")).trimEnd()}\nsource:\n  include:\n    - "src/**"\n`,
        "utf8"
      );
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/app.ts"), "export const app = 1;\n", "utf8");
      gitCommitAll(root, "declare capability source");
      writeArchitectureDocsProjection(root);

      const manifestPath = join(root, "docs/architecture/.projection-manifest.json");
      const manifest = JSON.parse(readText(manifestPath));
      // A commit that is valid provenance in shape but absent from this repository — the shallow
      // clone / rewritten history case. The gate must report "could not measure", never "no change".
      for (const target of manifest.targets) {
        if (target.verifiedAgainst) target.verifiedAgainst.commit = "0".repeat(40);
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      const result = await daemon.completeTask(root, {
        taskSessionId: "task_projection_freshness_failclosed",
        task: "finish against an undiffable verified commit"
      });
      expect((result.data as any).result).toBe("fail_action_required");
      const finding = (result.data as any).findings.find((entry: any) => entry.id === "stale-context");
      expect(finding.message).toContain("projection-change-set-unavailable");
      expect((result.data as any).extensions.projectionFreshnessGate.reasonCodes)
        .toEqual(["projection-change-set-unavailable"]);
    } finally {
      await daemon?.stop();
      removeTempRepo(root);
    }
  });

  test("external docs manual fetch is pinned cached and excluded from prepare and complete", async () => {
    const root = tempRepo();
    let providerCalls = 0;
    const daemon = await createStartedTestDaemon({
      clock: () => "2026-06-24T00:00:00.000Z",
      externalDocumentation: fakeExternalDocumentation(() => providerCalls++)
    });
    try {
      await daemon.init(root, "Docs App");
      const defaultStatus = await daemon.docs(root, { command: "status" });
      expect((defaultStatus.data as any).defaultPrepareEgress).toBe("none");

      const blockedResolve = await daemon.docs(root, {
        command: "resolve",
        libraryName: "React",
        query: "state hooks"
      });
      expect(blockedResolve.ok).toBe(false);
      expect(providerCalls).toBe(0);

      const pin = await daemon.docs(root, {
        command: "pin",
        libraryId: "/facebook/react",
        version: "18.2.0",
        approved: true
      });
      expect(pin.ok).toBe(true);
      expect(existsSync(join(root, ".archcontext", "integrations", "context7.lock.yaml"))).toBe(true);

      const firstFetch = await daemon.docs(root, {
        command: "fetch",
        libraryId: "/facebook/react",
        intent: "state hooks",
        allowNetwork: true
      });
      expect(firstFetch.ok).toBe(true);
      expect((firstFetch.data as any).cacheStatus).toBe("miss");
      expect((firstFetch.data as any).resource.enforcement).toBe("advisory-only");
      expect(providerCalls).toBe(1);
      const resourceUri = (firstFetch.data as any).resource.uri as string;

      const secondFetch = await daemon.docs(root, {
        command: "fetch",
        libraryId: "/facebook/react",
        intent: "state hooks",
        allowNetwork: true
      });
      expect(secondFetch.ok).toBe(true);
      expect((secondFetch.data as any).cacheStatus).toBe("fresh");
      expect(providerCalls).toBe(1);

      const resourceRead = await daemon.readResource(root, resourceUri);
      expect(resourceRead.ok).toBe(true);
      expect((resourceRead.data as any)).toMatchObject({
        schemaVersion: "archcontext.resource-read/v1",
        uri: resourceUri,
        dataClassification: "external-unverified-documentation",
        resource: {
          provider: "context7",
          libraryId: "/facebook/react",
          resolvedVersion: "18.2.0",
          trust: "external-unverified",
          enforcement: "advisory-only",
          cacheStatus: "fresh"
        }
      });
      expect((await daemon.readResource(root, "https://context7.com/react")).ok).toBe(false);
      expect((await daemon.readResource(root, `archcontext://external-docs/context7/sha256:${"9".repeat(64)}`)).ok).toBe(false);

      await daemon.prepare(root, "Use React state hooks", 12_288, 12, "task_docs");
      await daemon.completeTask(root, { taskSessionId: "task_docs", headSha: "abc123" });
      expect(providerCalls).toBe(1);
    } finally {
      await daemon.stop();
      removeTempRepo(root);
    }
  });

  test("approved docs pin refuses a symlinked lockfile path and leaves the outside target untouched", async () => {
    const root = tempRepo();
    const outside = mkdtempSync(join(tmpdir(), "archctx-pin-target-"));
    const victim = join(outside, "victim.yaml");
    const daemon = await createStartedTestDaemon({ clock: () => "2026-06-24T00:00:00.000Z" });
    try {
      await daemon.init(root, "Pin Symlink App");
      writeFileSync(victim, "do-not-touch\n", { encoding: "utf8", mode: 0o644 });
      const modeBefore = statSync(victim).mode;
      mkdirSync(join(root, ".archcontext/integrations"), { recursive: true });
      symlinkSync(victim, join(root, ".archcontext/integrations/context7.lock.yaml"));

      const pin = await daemon.docs(root, {
        command: "pin",
        libraryId: "/facebook/react",
        version: "18.2.0",
        approved: true
      });

      expect(pin.ok).toBe(false);
      expect(JSON.stringify(pin)).toContain("symlink");
      expect(readText(victim)).toBe("do-not-touch\n");
      expect(statSync(victim).mode).toBe(modeBefore);
    } finally {
      await daemon.stop();
      removeTempPath(outside);
      removeTempRepo(root);
    }
  });

  test("approved docs pin refuses a symlinked parent of the lockfile path", async () => {
    const root = tempRepo();
    const outside = mkdtempSync(join(tmpdir(), "archctx-pin-parent-"));
    const daemon = await createStartedTestDaemon({ clock: () => "2026-06-24T00:00:00.000Z" });
    try {
      await daemon.init(root, "Pin Parent Symlink App");
      symlinkSync(outside, join(root, ".archcontext/integrations"));

      const pin = await daemon.docs(root, {
        command: "pin",
        libraryId: "/facebook/react",
        version: "18.2.0",
        approved: true
      });

      expect(pin.ok).toBe(false);
      expect(JSON.stringify(pin)).toContain("symlink");
      expect(existsSync(join(outside, "context7.lock.yaml"))).toBe(false);
    } finally {
      await daemon.stop();
      removeTempPath(outside);
      removeTempRepo(root);
    }
  });

  test("approved docs pin writes a private lockfile and re-pins over its own previous state", async () => {
    const root = tempRepo();
    const lockPath = join(root, ".archcontext/integrations/context7.lock.yaml");
    const daemon = await createStartedTestDaemon({ clock: () => "2026-06-24T00:00:00.000Z" });
    try {
      await daemon.init(root, "Pin Rewrite App");

      expect((await daemon.docs(root, { command: "pin", libraryId: "/facebook/react", version: "18.2.0", approved: true })).ok).toBe(true);
      if (process.platform !== "win32") {
        expect(statSync(lockPath).mode & 0o777).toBe(0o600);
      }

      const second = await daemon.docs(root, { command: "pin", libraryId: "/vercel/next.js", version: "14.0.0", approved: true });
      expect(second.ok).toBe(true);
      expect(((second.data as any).lock.libraries as any[]).map((library) => library.libraryId))
        .toEqual(["/facebook/react", "/vercel/next.js"]);
      expect(JSON.parse(readText(lockPath)).libraries).toHaveLength(2);
      if (process.platform !== "win32") {
        expect(statSync(lockPath).mode & 0o777).toBe(0o600);
      }
    } finally {
      await daemon.stop();
      removeTempRepo(root);
    }
  });

  test("prepare-unknowns adds only advisory external docs resources for exact pinned framework versions", async () => {
    const root = tempRepo();
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "react-docs-app",
      dependencies: { react: "18.2.0" }
    }, null, 2), "utf8");
    let providerCalls = 0;
    const daemon = await createStartedTestDaemon({
      clock: () => "2026-06-24T00:00:00.000Z",
      externalDocumentation: fakeExternalDocumentation(() => providerCalls++, "prepare-unknowns")
    });
    try {
      await daemon.init(root, "React Docs App");
      await daemon.docs(root, {
        command: "pin",
        libraryId: "/facebook/react",
        version: "18.2.0",
        approved: true
      });

      const noVersionUnknown = await daemon.prepare(root, "Use React state hooks without changing architecture constraints", 12_288, 12, "task_context7_no_version_unknown");
      expect(noVersionUnknown.ok).toBe(true);
      expect(((noVersionUnknown.data as any).context.resources as any[]).some((resource) => resource.type === "external-docs")).toBe(false);
      expect(providerCalls).toBe(0);

      const first = await daemon.prepare(root, "Use React state hooks and confirm package version unknowns without changing architecture constraints", 12_288, 12, "task_context7_prepare");
      expect(first.ok).toBe(true);
      const firstContext = (first.data as any).context;
      const external = firstContext.resources.find((resource: any) => resource.type === "external-docs");
      expect(external).toMatchObject({
        provider: "context7",
        libraryId: "/facebook/react",
        packageName: "react",
        version: "18.2.0",
        trust: "external-unverified",
        enforcement: "advisory-only",
        cacheStatus: "fresh"
      });
      expect(external.uri).toMatch(/^archcontext:\/\/external-docs\/context7\/sha256:/);
      expect(firstContext.unknowns.some((unknown: string) => unknown.includes("react@18.2.0"))).toBe(true);
      expect(JSON.stringify(firstContext.constraints)).not.toContain("External documentation");
      expect(JSON.stringify(firstContext.realConstraints)).not.toContain("External documentation");
      expect(JSON.stringify(firstContext.practiceGuidance.resources)).not.toContain("external-docs");
      expect(providerCalls).toBe(1);

      const second = await daemon.prepare(root, "Use React state hooks and confirm package version unknowns without changing architecture constraints", 12_288, 12, "task_context7_prepare_2");
      expect(second.ok).toBe(true);
      expect(((second.data as any).context.resources as any[]).some((resource) => resource.type === "external-docs")).toBe(true);
      expect(providerCalls).toBe(1);
    } finally {
      await daemon.stop();
      removeTempRepo(root);
    }
  });

  test("Context7 augmentation recomputes byteLength and budgetExceeded over the returned canonical payload", async () => {
    const root = tempRepo();
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "react-docs-app",
      dependencies: { react: "18.2.0" }
    }, null, 2), "utf8");
    const daemon = await createStartedTestDaemon({
      clock: () => "2026-06-24T00:00:00.000Z",
      externalDocumentation: fakeExternalDocumentation(() => undefined, "prepare-unknowns")
    });
    try {
      await daemon.init(root, "React Docs App");
      await daemon.docs(root, { command: "pin", libraryId: "/facebook/react", version: "18.2.0", approved: true });

      const plainTask = "Use React state hooks without changing architecture constraints";
      const docsTask = "Use React state hooks and confirm package version unknowns without changing architecture constraints";

      const plain = ((await daemon.prepare(root, plainTask, 1_048_576, 12, "task_bytes_no_docs")).data as any).context;
      expect(plain.resources.some((resource: any) => resource.type === "external-docs")).toBe(false);
      expect(plain.extensions.byteLength).toBe(canonicalContextByteLength(plain));
      expect(plain.extensions.budgetExceeded).toBe(false);

      const augmented = ((await daemon.prepare(root, docsTask, 1_048_576, 12, "task_bytes_docs")).data as any).context;
      expect(augmented.resources.some((resource: any) => resource.type === "external-docs")).toBe(true);
      expect(augmented.extensions.externalDocumentationDigest).toMatch(/^sha256:/);
      expect(augmented.extensions.byteLength).toBe(canonicalContextByteLength(augmented));
      expect(augmented.extensions.budgetExceeded).toBe(false);

      // A budget between the compiled size and the augmented size must surface as budgetExceeded:
      // Context7 is what pushes the returned payload over, and it says so on the payload it returns.
      const maxBytes = canonicalContextByteLength(augmented) - 1;
      const tight = ((await daemon.prepare(root, docsTask, maxBytes, 12, "task_bytes_docs_tight")).data as any).context;
      expect(tight.resources.some((resource: any) => resource.type === "external-docs")).toBe(true);
      expect(tight.extensions.byteLength).toBe(canonicalContextByteLength(tight));
      expect(tight.extensions.byteLength).toBeGreaterThan(maxBytes);
      expect(tight.extensions.budgetExceeded).toBe(true);
    } finally {
      await daemon.stop();
      removeTempRepo(root);
    }
  });

  test("prepare-unknowns refuses fuzzy manifest versions and missing pins", async () => {
    const root = tempRepo();
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "react-docs-app",
      dependencies: { react: "^18.2.0" }
    }, null, 2), "utf8");
    let providerCalls = 0;
    const daemon = await createStartedTestDaemon({
      clock: () => "2026-06-24T00:00:00.000Z",
      externalDocumentation: fakeExternalDocumentation(() => providerCalls++, "prepare-unknowns")
    });
    try {
      await daemon.init(root, "React Docs App");
      await daemon.docs(root, {
        command: "pin",
        libraryId: "/facebook/react",
        version: "18.2.0",
        approved: true
      });

      const prepare = await daemon.prepare(root, "Use React state hooks and confirm package version unknowns", 12_288, 12, "task_context7_fuzzy");
      expect(prepare.ok).toBe(true);
      expect(((prepare.data as any).context.resources as any[]).some((resource) => resource.type === "external-docs")).toBe(false);
      expect(providerCalls).toBe(0);
    } finally {
      await daemon.stop();
      removeTempRepo(root);
    }
  });

  test("prepare-unknowns failure matrix leaves static Local Core result unchanged", async () => {
    const root = tempRepo();
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "react-docs-app",
      dependencies: { react: "18.2.0" }
    }, null, 2), "utf8");
    const staticDaemon = await createStartedTestDaemon({ clock: () => "2026-06-24T00:00:00.000Z" });
    const failureDaemons: Array<Awaited<ReturnType<typeof createStartedTestDaemon>>> = [];
    try {
      await staticDaemon.init(root, "React Docs App");
      const staticPrepare = await staticDaemon.prepare(root, "Use React state hooks and confirm package version unknowns", 12_288, 12, "task_static");
      const staticComplete = await staticDaemon.completeTask(root, { taskSessionId: "task_static", task: "Use React state hooks and confirm package version unknowns" });
      const staticProjection = projectLocalCorePrepareComplete(staticPrepare, staticComplete);
      expect(staticProjection.prepareOk).toBe(true);
      expect(staticProjection.completeOk).toBe(true);

      for (const label of CONTEXT7_FAILURE_MATRIX_CASES) {
        const provider = context7FailureMatrixProvider(label);
        const daemon = await createStartedTestDaemon({
          clock: () => "2026-06-24T00:00:00.000Z",
          externalDocumentation: provider.port
        });
        failureDaemons.push(daemon);
        await daemon.init(root, `React Docs App ${label}`);
        await daemon.docs(root, {
          command: "pin",
          libraryId: "/facebook/react",
          version: "18.2.0",
          approved: true
        });

        const prepare = await daemon.prepare(root, "Use React state hooks and confirm package version unknowns", 12_288, 12, `task_context7_${label}`);
        const complete = await daemon.completeTask(root, {
          taskSessionId: `task_context7_${label}`,
          task: "Use React state hooks and confirm package version unknowns"
        });
        const projection = projectLocalCorePrepareComplete(prepare, complete);

        expect(projection).toEqual(staticProjection);
        expect(provider.fetchCalls()).toBe(label === "disabled" ? 0 : 1);
      }
    } finally {
      await staticDaemon.stop();
      await Promise.all(failureDaemons.map((daemon) => daemon.stop()));
      removeTempRepo(root);
    }
  });

  test("prepare-unknowns falls back to stale cached docs when provider fails after TTL expiry", async () => {
    const root = tempRepo();
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "react-docs-app",
      dependencies: { react: "18.2.0" }
    }, null, 2), "utf8");
    const store = new TestLocalStore();
    let warmCalls = 0;
    let failingCalls = 0;
    let warmDaemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    let failingDaemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      warmDaemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-24T00:00:00.000Z",
        externalDocumentation: fakeExternalDocumentation(() => warmCalls++, "prepare-unknowns")
      });
      await warmDaemon.init(root, "React Docs App");
      await warmDaemon.docs(root, {
        command: "pin",
        libraryId: "/facebook/react",
        version: "18.2.0",
        approved: true
      });
      const warm = await warmDaemon.prepare(root, "Use React state hooks and confirm package version unknowns", 12_288, 12, "task_context7_warm");
      expect(warm.ok).toBe(true);
      const warmExternal = ((warm.data as any).context.resources as any[]).find((resource) => resource.type === "external-docs");
      expect(warmExternal?.cacheStatus).toBe("fresh");
      expect(warmCalls).toBe(1);
      await warmDaemon.stop();
      warmDaemon = undefined;

      failingDaemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-07-25T00:00:00.000Z",
        externalDocumentation: fakeExternalDocumentation(() => failingCalls++, "prepare-unknowns", { failFetch: true })
      });
      await failingDaemon.init(root, "React Docs App");
      const fallback = await failingDaemon.prepare(root, "Use React state hooks and confirm package version unknowns", 12_288, 12, "task_context7_stale");
      expect(fallback.ok).toBe(true);
      const fallbackExternal = ((fallback.data as any).context.resources as any[]).find((resource) => resource.type === "external-docs");
      expect(fallbackExternal).toMatchObject({
        provider: "context7",
        libraryId: "/facebook/react",
        version: "18.2.0",
        trust: "external-unverified",
        enforcement: "advisory-only",
        cacheStatus: "stale"
      });
      expect(failingCalls).toBe(1);
    } finally {
      await failingDaemon?.stop();
      await warmDaemon?.stop();
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
        operations: [],
        approvalChannel: "mcp"
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

  test("dual architecture ledger mode appends an apply_update event after a successful ChangeSet", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        architectureLedger: { rolloutMode: "dual" },
        clock: () => "2026-06-25T03:00:00.000Z"
      });
      await daemon.init(root, "Dual Ledger App");
      const plan = await daemon.planUpdate(root, {
        id: "changeset.dual-ledger-node",
        operations: [{
          op: "create_entity",
          path: ".archcontext/model/nodes/module.dual-ledger.yaml",
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v2\nid: module.dual-ledger\nkind: module\nname: Dual Ledger\nstatus: active\nsummary: Dual ledger node\n"
        }]
      });
      expect(plan.ok).toBe(true);

      const apply = await daemon.applyUpdate(root, {
        id: "changeset.dual-ledger-node",
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      });

      expect(apply.ok).toBe(true);
      expect((apply.data as any)).toMatchObject({
        status: "applied",
        architectureLedger: {
          rolloutMode: "dual",
          readMode: "dual-compare",
          writeMode: "dual",
          readAuthority: "yaml",
          append: {
            status: "appended",
            appendedEventCount: 1
          }
        }
      });
      expect(readText(join(root, ".archcontext/model/nodes/module.dual-ledger.yaml"))).toContain("module.dual-ledger");
      expect(store.architectureEventAppends).toHaveLength(1);
      const event = store.architectureEventAppends[0]!.events[0]!;
      const journal = [...store.changeSetJournals.values()][0]!;
      expect(journal.status).toBe("committed");
      expect(journal.ledger?.plannedEvent?.idempotencyKey).toBe(event.idempotencyKey);
      expect(journal.ledger?.append?.appendedEvents.map((appended) => appended.idempotencyKey)).toContain(event.idempotencyKey);
      expect(event).toMatchObject({
        eventType: "architecture.changeset.apply",
        source: "apply_update",
        actor: { kind: "daemon", id: "archctxd" }
      });
      expect((event.payload as any).operations.map((operation: any) => operation.entity?.entityId)).toContain("module.dual-ledger");
      expect(JSON.stringify(event.payload)).not.toContain("schemaVersion: archcontext.node/v2");
      expect((await daemon.runtimeStatus(root)).data).toMatchObject({
        architectureLedger: {
          rolloutMode: "dual",
          readMode: "dual-compare",
          writeMode: "dual"
        }
      });
    } finally {
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
        expectedWorktreeDigest: computeWorktreeDigest(root)
      })).rejects.toThrow("ChangeSet worktree digest changed before apply");
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
        expectedWorktreeDigest: computeWorktreeDigest(root)
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

  test("ledger-authoritative write mode appends an event while keeping Git projection updates reviewable", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        architectureLedger: { rolloutMode: "ledger-authoritative" },
        clock: () => "2026-06-25T03:02:00.000Z"
      });
      await daemon.init(root, "Ledger Projection App");
      const plan = await daemon.planUpdate(root, {
        id: "changeset.ledger-projection-node",
        operations: [{
          op: "create_entity",
          path: ".archcontext/model/nodes/module.ledger-projection.yaml",
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v2\nid: module.ledger-projection\nkind: module\nname: Ledger Projection\nstatus: active\nsummary: Ledger projection node\n"
        }]
      });

      const apply = await daemon.applyUpdate(root, {
        id: "changeset.ledger-projection-node",
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      });

      expect(apply.ok).toBe(true);
      expect((apply.data as any).architectureLedger).toMatchObject({
        rolloutMode: "ledger-authoritative",
        readMode: "ledger",
        writeMode: "ledger-with-projection",
        readAuthority: "ledger",
        writeAuthority: "ledger-with-projection",
        append: {
          status: "appended",
          appendedEventCount: 1
        }
      });
      expect(readText(join(root, ".archcontext/model/nodes/module.ledger-projection.yaml"))).toContain("module.ledger-projection");
      expect(store.architectureEventAppends[0]!.events[0]!.payload).toMatchObject({
        changeSet: {
          id: "changeset.ledger-projection-node"
        },
        projectionState: {
          path: ".archcontext",
          writeMode: "ledger-with-projection"
        }
      });
    } finally {
      removeTempRepo(root);
    }
  });

  test("verified-ledger focused Explorer projection uses bounded reads without loading the full graph", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        architectureLedger: { rolloutMode: "ledger-authoritative" },
        clock: () => "2026-07-11T18:45:00.000Z"
      });
      await daemon.init(root, "Bounded Ledger Explorer");
      const plan = await daemon.planUpdate(root, {
        id: "changeset.bounded-ledger-explorer",
        operations: [{
          op: "create_entity",
          path: ".archcontext/model/nodes/module.bounded-ledger-explorer.yaml",
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v2\nid: module.bounded-ledger-explorer\nkind: module\nname: Bounded Ledger Explorer\nstatus: active\nsummary: Bounded projection fixture\n"
        }]
      });
      await daemon.applyUpdate(root, {
        id: "changeset.bounded-ledger-explorer",
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      });
      store.architectureLedgerFullStateReads = 0;
      store.explorerProjectionInputReads.length = 0;
      writeFileSync(join(root, ".archcontext", "model", "nodes", "ignored-by-ledger-focus.yaml"), "schemaVersion: broken\n", "utf8");

      const projection = await daemon.explorerProjectionV2(root, {
        schemaVersion: "archcontext.explorer-projection-query/v2",
        viewId: "system-map",
        semanticLevel: "detail",
        focus: { subjectId: "module.bounded-ledger-explorer" },
        depth: 1,
        budget: { maxNodes: 5, maxRelations: 5 }
      });

      expect(projection.ok).toBe(true);
      expect((projection.data as any).cursor.authoritySource).toBe("ledger");
      expect((projection.data as any).inputManifest.readPlan.kind).toBe("focused-neighborhood");
      expect(store.explorerProjectionInputReads).toHaveLength(1);
      expect(store.architectureLedgerFullStateReads).toBe(0);
    } finally {
      removeTempRepo(root);
    }
  });

  test("Git graph authority retains verified ledger evidence and backlinks through a separate cursor", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({ localStore: store, architectureLedger: { rolloutMode: "dual" }, clock: () => "2026-07-11T19:05:00.000Z" });
      await daemon.init(root, "Split Authority Explorer");
      const plan = await daemon.planUpdate(root, {
        id: "changeset.split-authority-explorer",
        operations: [{
          op: "create_entity",
          path: ".archcontext/model/nodes/module.split-authority.yaml",
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v2\nid: module.split-authority\nkind: module\nname: Split Authority\nstatus: active\nsummary: Original summary\n"
        }]
      });
      await daemon.applyUpdate(root, { id: "changeset.split-authority-explorer", approved: true, expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest });
      writeFileSync(
        join(root, ".archcontext", "model", "nodes", "module.split-authority.yaml"),
        "schemaVersion: archcontext.node/v2\nid: module.split-authority\nkind: module\nname: Split Authority\nstatus: active\nsummary: Git graph changed after ledger event\n",
        "utf8"
      );

      const result = await daemon.explorerProjectionV2(root, {
        schemaVersion: "archcontext.explorer-projection-query/v2",
        viewId: "system-map",
        semanticLevel: "detail",
        focus: { subjectId: "module.split-authority" },
        depth: 1,
        budget: { maxNodes: 5, maxRelations: 5 }
      });

      expect(result.ok).toBe(true);
      expect((result.data as any).cursor.authoritySource).toBe("git");
      expect((result.data as any).cursor.authorityCursor).toBeNull();
      expect((result.data as any).inputManifest.evidenceAuthorityCursor).toBeDefined();
      expect((result.data as any).inputManifest.evidenceAuthorityCursor.evidenceStateDigest).toBe((result.data as any).inputManifest.evidenceStateDigest);
      expect((result.data as any).occurrences[0].inspector.decisions.length).toBeGreaterThan(0);
    } finally {
      removeTempRepo(root);
    }
  });

  test("dual architecture ledger mode rolls back YAML writes when ledger append fails before commit", async () => {
    class FailingLedgerStore extends TestLocalStore {
      async appendArchitectureEvents(input: Parameters<TestLocalStore["appendArchitectureEvents"]>[0]): ReturnType<TestLocalStore["appendArchitectureEvents"]> {
        this.architectureEventAppends.push(input);
        throw new Error("ledger-append-down");
      }
    }
    const root = tempRepo();
    const store = new FailingLedgerStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        architectureLedger: { rolloutMode: "dual" },
        clock: () => "2026-06-25T03:05:00.000Z"
      });
      await daemon.init(root, "Dual Ledger Rollback App");
      const path = ".archcontext/model/nodes/module.dual-rollback.yaml";
      const plan = await daemon.planUpdate(root, {
        id: "changeset.dual-ledger-rollback",
        operations: [{
          op: "create_entity",
          path,
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v2\nid: module.dual-rollback\nkind: module\nname: Dual Rollback\nstatus: active\nsummary: Dual rollback node\n"
        }]
      });

      await expect(daemon.applyUpdate(root, {
        id: "changeset.dual-ledger-rollback",
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      })).rejects.toThrow("ledger-append-down");

      expect(existsSync(join(root, path))).toBe(false);
      expect([...store.changeSetJournals.values()].some((journal) => journal.status === "aborted" && journal.reason === "ledger-append-down")).toBe(true);
      expect(store.architectureEventAppends).toHaveLength(1);
    } finally {
      removeTempRepo(root);
    }
  });

  test("ledger read mode returns SQLite current state and Git drift readback", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        architectureLedger: { rolloutMode: "ledger-authoritative" },
        clock: () => "2026-06-25T04:00:00.000Z"
      });
      await daemon.init(root, "Ledger Read App");
      const plan = await daemon.planUpdate(root, {
        id: "changeset.ledger-read-node",
        operations: [{
          op: "create_entity",
          path: ".archcontext/model/nodes/module.ledger-read.yaml",
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v2\nid: module.ledger-read\nkind: module\nname: Ledger Read\nstatus: active\nsummary: Ledger read node\n"
        }]
      });
      await daemon.applyUpdate(root, {
        id: "changeset.ledger-read-node",
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      });

      const state = await daemon.ledgerState(root);

      expect(state.ok).toBe(true);
      expect((state.data as any).architectureLedger).toMatchObject({
        rolloutMode: "ledger-authoritative",
        readMode: "ledger",
        readAuthority: "ledger"
      });
      expect((state.data as any).state.entities.map((entity: any) => entity.entityId)).toContain("module.ledger-read");
      expect((state.data as any).ledger.graphDigest).toMatch(/^sha256:/);
      expect((state.data as any).drift.semanticDrift).toBe(false);
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime recommendation lifecycle appends explicit feedback and reports local metrics", async () => {
    const root = createInitializedGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-26T12:05:00.000Z"
      });
      const plan = await appendRecommendationRunFixture(store, root, "2026-06-26T12:00:00.000Z");
      const recommendationId = plan.recommendations[0].recommendationId;

      await expect(daemon.recommendations(root, {
        command: "accept",
        recommendationId,
        reason: "token=super-secret-value",
        actor: "developer",
        source: "cli",
        now: "2026-06-26T12:09:00.000Z"
      })).rejects.toThrow("architecture-ledger-privacy-denied");
      expect(store.architectureEvents).toHaveLength(1);

      const accepted = await daemon.recommendations(root, {
        command: "accept",
        recommendationId,
        reason: "accepted after agent-assisted local readback",
        actor: "worker.al8",
        actorKind: "subagent",
        source: "subagent",
        agentJobId: "agent_job.al8",
        now: "2026-06-26T12:10:00.000Z"
      });

      expect(accepted.ok).toBe(true);
      expect((accepted.data as any)).toMatchObject({
        schemaVersion: "archcontext.runtime-recommendation-lifecycle/v1",
        action: "accept",
        recommendationId,
        previousStatus: "open",
        nextStatus: "accepted",
        privacy: {
          writes: "architecture-ledger-event-only",
          rawSourcePersisted: false,
          rawDiffPersisted: false,
          implicitAcceptance: false
        }
      });
      expect((accepted.data as any).feedback).toMatchObject({
        schemaVersion: "archcontext.recommendation-feedback/v1",
        action: "accept",
        explicit: true,
        implicitAcceptance: false,
        actor: { kind: "subagent", source: "subagent" }
      });
      expect(JSON.stringify(accepted.data)).not.toContain("sourceCode");
      expect(JSON.stringify(accepted.data)).not.toContain("diff --git");
      expect(store.architectureEventAppends.at(-1)?.events[0]?.eventType).toBe("architecture.recommendation.lifecycle");
      expect((store.architectureEventAppends.at(-1)?.events[0]?.payload as any).feedback).toHaveLength(1);

      const open = await daemon.book(root, { command: "recommendations", openOnly: true });
      expect((open.data as any).recommendations).toEqual([]);
      const all = await daemon.book(root, { command: "recommendations" });
      expect((all.data as any).recommendations.map((recommendation: any) => recommendation.status)).toEqual(["accepted"]);

      const metrics = await daemon.recommendations(root, { command: "metrics", now: "2026-06-26T12:11:00.000Z" });
      expect((metrics.data as any)).toMatchObject({
        schemaVersion: "archcontext.recommendation-lifecycle-metrics/v1",
        recommendationCount: 1,
        feedbackCount: 1,
        acceptedRecommendationRate: 1,
        agentAssistedResolutionRate: 1
      });

      const duplicate = await daemon.recommendations(root, {
        command: "accept",
        recommendationId,
        reason: "duplicate accept should not append",
        now: "2026-06-26T12:12:00.000Z"
      });
      expect(duplicate.ok).toBe(false);
      expect((duplicate as any).error.code).toBe("AC_PRECONDITION_FAILED");
    } finally {
      removeTempRepo(root);
    }
  }, WINDOWS_RUNTIME_IO_TEST_TIMEOUT_MS);

  test("ledger-authoritative runtime read surfaces use SQLite current state when Git projection drifts", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        architectureLedger: { rolloutMode: "ledger-authoritative" },
        clock: () => "2026-06-25T04:03:00.000Z"
      });
      await daemon.init(root, "Ledger Runtime Read App");
      const path = ".archcontext/model/nodes/module.ledger-runtime-read.yaml";
      const plan = await daemon.planUpdate(root, {
        id: "changeset.ledger-runtime-read-node",
        operations: [{
          op: "create_entity",
          path,
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v2\nid: module.ledger-runtime-read\nkind: module\nname: Ledger Runtime Read\nstatus: active\nsummary: Runtime reads from ledger state\n"
        }]
      });
      await daemon.applyUpdate(root, {
        id: "changeset.ledger-runtime-read-node",
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      });
      const ledger = await daemon.ledgerState(root);
      rmSync(join(root, path), { force: true });

      const validate = await daemon.validate(root);
      const validation = validate.data as any;
      const yamlDigest = digestJson(listModelFiles(root).map((file) => ({ path: file.path, digest: file.digest })) as any);
      expect(validate.ok).toBe(true);
      expect(validation.valid).toBe(true);
      expect(validation.architectureLedger).toMatchObject({
        readAuthority: "ledger",
        graphDigest: (ledger.data as any).ledger.graphDigest,
        entityCount: (ledger.data as any).ledger.entityCount
      });
      expect(listModelFiles(root).map((file) => file.path)).not.toContain(path);
      expect(validation.modelDigest).not.toBe(yamlDigest);

      const context = await daemon.context(root, "change ledger runtime read model", 4);
      expect(context.ok).toBe(true);
      const contextData = context.data as any;
      expect(contextData.extensions.modelDigest).toBe(validation.modelDigest);
      expect(contextData.extensions.architectureLedgerDigest).toBe((ledger.data as any).ledger.graphDigest);
      expect(["ledger-first", "ledger-only"]).toContain(contextData.extensions.codeFactsMode);
      expect(contextData.relevantNodes).toContain("module.ledger-runtime-read");
      expect((contextData.resources as any[]).some((resource) => resource.type === "architecture-book" && resource.digest === (ledger.data as any).ledger.graphDigest)).toBe(true);
      expect((contextData.resources as any[]).some((resource) => resource.type === "model" && resource.digest === validation.modelDigest)).toBe(true);

      const prepare = await daemon.prepare(root, "change ledger runtime read model", 12_288, 4, "task_ledger_runtime_reads");
      expect((prepare.data as any).context.extensions.modelDigest).toBe(validation.modelDigest);
      expect((prepare.data as any).context.extensions.architectureLedgerDigest).toBe((ledger.data as any).ledger.graphDigest);
      const complete = await daemon.completeTask(root, {
        taskSessionId: "task_ledger_runtime_reads",
        task: "change ledger runtime read model"
      });
      expect((complete.data as any).snapshot.modelDigest).toBe(validation.modelDigest);
    } finally {
      removeTempRepo(root);
    }
  });

  test("ledger-authoritative validate resolves ADR appliesTo against ledger nodes (#163)", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        architectureLedger: { rolloutMode: "ledger-authoritative" },
        clock: () => "2026-09-25T04:03:00.000Z"
      });
      await daemon.init(root, "Ledger ADR Integrity App");
      const path = ".archcontext/model/nodes/module.ledger-adr.yaml";
      const plan = await daemon.planUpdate(root, {
        id: "changeset.ledger-adr-node",
        operations: [{
          op: "create_entity",
          path,
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v2\nid: module.ledger-adr\nkind: module\nname: Ledger ADR\nstatus: active\nsummary: ADR target held by the ledger\n"
        }]
      });
      await daemon.applyUpdate(root, {
        id: "changeset.ledger-adr-node",
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      });
      rmSync(join(root, path), { force: true });
      const adrPath = "docs/adr/ADR-0001-ledger-adr.md";
      const writeAdr = (appliesTo: string) => {
        mkdirSync(join(root, "docs/adr"), { recursive: true });
        writeFileSync(join(root, adrPath), [
          "---",
          "schemaVersion: archcontext.adr/v1",
          "id: adr.0001.ledger-adr",
          "title: Ledger ADR",
          "status: accepted",
          "decidedAt: 2026-09-25",
          "appliesTo:",
          `  - ${appliesTo}`,
          "supersedes: []",
          "---",
          ""
        ].join("\n"), "utf8");
      };

      writeAdr("module.ledger-adr");
      const resolved = (await daemon.validate(root)).data as any;
      expect(resolved.architectureLedger.readAuthority).toBe("ledger");
      expect(resolved).toMatchObject({ valid: true, errors: [] });

      writeAdr("package.bogus");
      const unresolved = (await daemon.validate(root)).data as any;
      expect(unresolved.architectureLedger.readAuthority).toBe("ledger");
      expect(unresolved.valid).toBe(false);
      expect(unresolved.errors).toEqual([`${adrPath}: ADR appliesTo references unknown node package.bogus`]);
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

  test("SQLite contract enables WAL, foreign keys, busy timeout, and stores no source bodies", () => {
    const sql = migrationSql();
    for (const pragma of SQLITE_PRAGMAS) expect(sql).toContain(pragma);
    expect(() => assertNoSourceStorageSchema(sql)).not.toThrow();
  });

  test("runtime store recovers pending snapshots without losing committed state", async () => {
    const store = new TestLocalStore();
    await store.migrate();
    const snapshot = { repositoryId: "repo.test", headSha: "abc", worktreeDigest: "sha256:test" };
    const pending = await store.beginSnapshot(snapshot);
    const committed = await store.beginSnapshot(snapshot);
    await store.commitSnapshot(committed);

    expect(store.recoverPendingSnapshots()).toBe(1);
    expect(store.snapshots.has(pending)).toBe(false);
    expect(store.snapshots.get(committed)?.state).toBe("committed");
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
        worktreeDigest: computeWorktreeDigest(root)
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
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const passed = await daemon.completeTask(root, {
        taskSessionId: "task_runtime_complete",
        headSha
      });
      expect(passed.ok).toBe(true);
      expect((passed.data as any)).toMatchObject({
        schemaVersion: "archcontext.review/v1",
        taskSessionId: "task_runtime_complete",
        result: "pass"
      });
      expect(provider.indexedRoots.map((indexedRoot) => normalizeExistingPath(indexedRoot))).toEqual([normalizeExistingPath(root)]);
      expect(store.reviews.get((passed.data as any).reviewId)).toMatchObject({ result: "pass" });

      await expect(daemon.completeTask(root, {
        taskSessionId: "task_runtime_forged",
        headSha,
        result: "pass"
      } as any)).rejects.toThrow("complete-task-caller-provided-attestation-field-forbidden: result");
      await expect(daemon.completeTask(root, {
        taskSessionId: "task_runtime_forged_model",
        headSha,
        modelDigest: `sha256:${"a".repeat(64)}`
      } as any)).rejects.toThrow("complete-task-caller-provided-attestation-field-forbidden: modelDigest");
    } finally {
      await daemon?.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  });

  test("runtime RPC rejects untrusted worktree digest profiles before plan or apply state", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await createStartedTestDaemon({ localStore: store });
    const rpc = new ArchctxRuntimeRpcServer(daemon, {
      root,
      port: 0,
      token: "runtime-profile-test-token",
      clock: () => "2026-08-27T00:00:00.000Z"
    });
    try {
      const connection = await rpc.start();
      const client = new RuntimeRpcClient(connection);
      expect((await client.init(root, "RPC Profile Validation App")).ok).toBe(true);
      const repositoryDigest = computeWorktreeDigest(root);
      const projectionDigest = architectureDocumentationProjectionWorktreeDigest(
        root,
        loadNativeModelFromArchContext(root)
      );
      const invalidPlanProfiles = [
        { label: "unknown", profile: "not-a-real-profile", expectedDigest: projectionDigest },
        { label: "null", profile: null, expectedDigest: projectionDigest },
        { label: "malformed", profile: 7, expectedDigest: projectionDigest },
        { label: "repository", profile: "repository", expectedDigest: repositoryDigest }
      ];

      for (const { label, profile, expectedDigest } of invalidPlanProfiles) {
        const id = `changeset.invalid-profile-${label}`;
        const plan = await (client as any).planUpdate(root, {
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

        const sameProfileApply = await (client as any).applyUpdate(root, {
          id,
          approved: true,
          expectedWorktreeDigest: expectedDigest,
          worktreeDigestProfile: profile
        });
        if (profile === "repository") {
          expect((sameProfileApply as any).ok).toBe(false);
          expect(String((sameProfileApply as any).error)).toContain(`Unknown ChangeSet: ${id}`);
        } else {
          expect(sameProfileApply).toMatchObject({
            schemaVersion: "archcontext.envelope/v1",
            ok: false,
            requestId: "apply_update",
            error: { code: "AC_SCHEMA_INVALID" }
          });
        }

        const missingDraft = await client.applyUpdate(root, {
          id,
          approved: true,
          expectedWorktreeDigest: repositoryDigest
        });
        expect(missingDraft.ok).toBe(false);
        expect(String((missingDraft as any).error)).toContain(`Unknown ChangeSet: ${id}`);
      }

      const validPlan = await client.planUpdate(root, {
        id: "changeset.invalid-apply-profile",
        operations: []
      });
      expect(validPlan.ok).toBe(true);
      const expectedWorktreeDigest = (validPlan.data as any).draft.base.worktreeDigest;
      for (const profile of ["not-a-real-profile", null, 7]) {
        const apply = await (client as any).applyUpdate(root, {
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

      expect(computeWorktreeDigest(root)).toBe(repositoryDigest);
      expect(store.changeSetJournals.size).toBe(0);
    } finally {
      await rpc.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  });

  test("idle RPC server does not exit while a runtime_job_queue entry is queued", async () => {
    const root = createGitRepo();
    const daemon = await createStartedTestDaemon();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "changed.ts"), "export const changed = true;\n", "utf8");
    const enqueue = await daemon.jobsEnqueueGitHook(root, {
      source: "worktree",
      event: "post-edit",
      taskSessionId: "task.idle-busy-queue",
      analysisKind: "architecture-delta",
      risk: "high",
      uncertainty: "high"
    });
    expect((enqueue.data as any).enqueued).toBe(true);
    const exitCodes: number[] = [];
    const rpc = new ArchctxRuntimeRpcServer(daemon, {
      root,
      port: 0,
      token: "idle-busy-queue-token",
      idleTimeoutMs: 150,
      exit: (code) => { exitCodes.push(code); }
    });
    try {
      const connection = await rpc.start();
      await sleep(450);
      expect(exitCodes).toEqual([]);
      expect(existsSync(connection.connectionPath)).toBe(true);
    } finally {
      await rpc.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  }, 10_000);

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
      expect(() => assertProductionRuntimeDeps({ codeFacts })).toThrow("codeFacts");
      expect(() => assertProductionRuntimeDeps({ codeGraphProviderFactory: () => new MockCodeGraphProvider() })).toThrow("codeGraphProviderFactory");
      expect(() => assertProductionRuntimeDeps({ localStore: new TestLocalStore() })).toThrow("localStore");
      expect(() => assertProductionRuntimeDeps({ clock: () => "2026-06-20T00:00:00.000Z" })).toThrow("clock");
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

  test("multi-repo sessions use LRU and landscape context stays local", async () => {
    const first = tempRepo();
    const second = tempRepo();
    const third = tempRepo();
    try {
      const daemon = await createStartedTestDaemon({ maxRepoSessions: 2 });
      const addedFirst = await daemon.repoAdd(first, "web");
      const addedSecond = await daemon.repoAdd(second, "api");
      const firstRepo = (addedFirst.data as any).repository.repositoryId;
      const secondRepo = (addedSecond.data as any).repository.repositoryId;
      await daemon.repoAdd(third, "worker");

      expect(daemon.status().sessions).toBe(2);
      expect(daemon.status().repositories).not.toContain(firstRepo);

      const list = await daemon.repoList();
      expect((list.data as any).repositories.map((repo: any) => repo.repositoryId)).toEqual([
        firstRepo,
        secondRepo,
        repositoryFingerprint(third)
      ].sort());

      const context = await daemon.contextLandscape("change api used by web", 4);
      expect(context.ok).toBe(true);
      expect((context.data as any).extensions.landscapeDigest).toMatch(/^sha256:/);
      expect(JSON.stringify(context.data)).not.toContain("archcontextSyncService\":\"allowed");
    } finally {
      removeTempRepo(first);
      removeTempRepo(second);
      removeTempRepo(third);
    }
  });

  test("repo remove survives a daemon restart and detaches dependent landscape state", async () => {
    const removedRoot = tempRepo();
    const keptRoot = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({ localStore: store });
      const addedRemoved = await daemon.repoAdd(removedRoot, "web");
      const addedKept = await daemon.repoAdd(keptRoot, "api");
      const removedId = (addedRemoved.data as any).repository.repositoryId;
      const keptId = (addedKept.data as any).repository.repositoryId;

      const outbound: CrossRepoRelation = {
        schemaVersion: "archcontext.cross-repo-relation/v1",
        id: "relation.outbound",
        kind: "calls",
        source: { repositoryId: removedId, nodeId: "node.web" },
        target: { repositoryId: keptId, nodeId: "node.api" },
        via: { kind: "interface", id: "interface.checkout" },
        intent: "web calls api"
      };
      const inbound: CrossRepoRelation = {
        schemaVersion: "archcontext.cross-repo-relation/v1",
        id: "relation.inbound",
        kind: "subscribes",
        source: { repositoryId: keptId, nodeId: "node.api" },
        target: { repositoryId: removedId, nodeId: "node.web" },
        via: { kind: "event", id: "event.checkout-completed" },
        intent: "api subscribes to web"
      };
      await store.saveCrossRepoRelation(outbound);
      await store.saveCrossRepoRelation(inbound);
      const registered = (await store.readLandscape("landscape.local"))!;
      expect(registered.scope?.defaultActiveRepositories).toEqual([removedId, keptId]);
      const loaded = await daemon.loadLandscape({ ...registered, relations: [inbound.id, outbound.id] });
      expect(loaded.ok).toBe(true);

      const removal = await daemon.repoRemove(removedId);
      expect(removal.ok).toBe(true);
      expect(removal.data).toMatchObject({
        repositoryId: removedId,
        removed: true,
        sessionRemoved: true,
        detachedRelationIds: [inbound.id, outbound.id]
      });

      const saved = (await store.readLandscape("landscape.local"))!;
      expect(saved.repositories.map((repo) => repo.repositoryId)).toEqual([keptId]);
      expect(saved.scope?.defaultActiveRepositories).toEqual([keptId]);
      expect(saved.relations).toEqual([]);
      expect(validateLandscape(saved, await store.listCrossRepoRelations(saved))).toEqual({ valid: true, errors: [] });
      expect([...store.repositorySessions.keys()]).toEqual([keptId]);
      expect([...store.crossRepoEdges.keys()].sort()).toEqual([inbound.id, outbound.id]);

      await daemon.stop();
      const restarted = await createStartedTestDaemon({ localStore: store });
      expect((await restarted.repoList()).data).toMatchObject({ activeSessions: [keptId] });

      const unknown = await restarted.repoRemove(removedId);
      expect(unknown.ok).toBe(false);
      expect((unknown as any).error.code).toBe("AC_REPO_NOT_FOUND");
      expect([...store.repositorySessions.keys()]).toEqual([keptId]);
      await restarted.stop();
    } finally {
      removeTempRepo(removedRoot);
      removeTempRepo(keptRoot);
    }
  });

  test("repo remove after daemon restart updates the persisted landscape", async () => {
    const removedRoot = tempRepo();
    const keptRoot = tempRepo();
    const store = new TestLocalStore();
    try {
      const first = await createStartedTestDaemon({ localStore: store });
      const removedId = ((await first.repoAdd(removedRoot, "web")).data as any).repository.repositoryId;
      const keptId = ((await first.repoAdd(keptRoot, "api")).data as any).repository.repositoryId;
      await first.stop();

      const restarted = await createStartedTestDaemon({ localStore: store });
      const removal = await restarted.repoRemove(removedId);
      expect(removal.ok).toBe(true);
      expect(removal.data).toMatchObject({ repositoryId: removedId, removed: true, sessionRemoved: true });

      const saved = (await store.readLandscape("landscape.local"))!;
      expect(saved.repositories.map((repo) => repo.repositoryId)).toEqual([keptId]);
      expect(saved.scope?.defaultActiveRepositories).toEqual([keptId]);
      expect([...store.repositorySessions.keys()]).toEqual([keptId]);
      await restarted.stop();
    } finally {
      removeTempRepo(removedRoot);
      removeTempRepo(keptRoot);
    }
  });

  test("repo remove rejected by landscape validation leaves every session untouched", async () => {
    const removedRoot = tempRepo();
    const keptRoot = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({ localStore: store });
      const addedRemoved = await daemon.repoAdd(removedRoot, "web");
      const addedKept = await daemon.repoAdd(keptRoot, "api");
      const removedId = (addedRemoved.data as any).repository.repositoryId;
      const keptId = (addedKept.data as any).repository.repositoryId;

      // A relation between the kept repository and one that was never registered. loadLandscape
      // validates without relations, so this reaches the saved landscape; repoRemove validates the
      // post-removal landscape *with* its active relations, so the dangling endpoint surfaces
      // there. Nothing about it involves the repository being removed.
      const dangling: CrossRepoRelation = {
        schemaVersion: "archcontext.cross-repo-relation/v1",
        id: "relation.dangling",
        kind: "depends-on",
        source: { repositoryId: keptId, nodeId: "node.api" },
        target: { repositoryId: "repo.never-registered", nodeId: "node.ghost" },
        via: { kind: "interface", id: "interface.ghost" },
        intent: "api depends on an unregistered repository"
      };
      await store.saveCrossRepoRelation(dangling);
      const registered = (await store.readLandscape("landscape.local"))!;
      expect((await daemon.loadLandscape({ ...registered, relations: [dangling.id] })).ok).toBe(true);

      const rejected = await daemon.repoRemove(removedId);
      expect(rejected.ok).toBe(false);
      expect((rejected as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((rejected as any).error.message).toContain("repo.never-registered");

      expect([...store.repositorySessions.keys()].sort()).toEqual([removedId, keptId].sort());
      expect((await daemon.repoList()).data).toMatchObject({ activeSessions: [removedId, keptId].sort() });
      const stillSaved = (await store.readLandscape("landscape.local"))!;
      expect(stillSaved.repositories.map((repo) => repo.repositoryId).sort()).toEqual([removedId, keptId].sort());
      expect(stillSaved.relations).toEqual([dangling.id]);

      await daemon.stop();
      const restarted = await createStartedTestDaemon({ localStore: store });
      expect((await restarted.repoList()).data).toMatchObject({ activeSessions: [removedId, keptId].sort() });
      await restarted.stop();
    } finally {
      removeTempRepo(removedRoot);
      removeTempRepo(keptRoot);
    }
  });

  test("Explorer loopback service is token-gated, read-only, and revocable", async () => {
    const root = tempRepo();
    try {
      const localStore = new TestLocalStore(DEFAULT_EXPLORER_PROJECTION_CACHE_POLICY, () => "2026-06-20T00:00:00.000Z");
      const daemon = await createStartedTestDaemon({ localStore, clock: () => "2026-06-20T00:00:00.000Z" });
      await daemon.init(root, "Explorer App");
      await daemon.prepare(root, "change the Explorer runtime boundary", 12_288, 12, "task.explorer-current");
      const started = await daemon.startExplorer(root, { port: 0, tokenTtlSeconds: 60 });
      expect(started.ok).toBe(true);
      const data = started.data as any;
      expect(data.host).toBe("127.0.0.1");
      expect(data.readOnly).toBe(true);

      expect((await fetch(`${data.url}health`)).status).toBe(401);
      for (const headers of [{ Host: "attacker.example" }, { Origin: "https://attacker.example" }, { Origin: "null" }] as Record<string, string>[]) {
        expect((await fetch(`${data.url}health`, { headers: { ...headers, Authorization: `Bearer ${data.token}` } })).status).toBe(403);
      }
      expect((await fetch(`${data.url}health`, { headers: { Authorization: `Bearer ${data.token}`, Origin: new URL(data.url).origin } })).status).toBe(200);

      const projectionDenied = await fetch(`${data.url}projection`);
      expect(projectionDenied.status).toBe(401);

      const projectionWrite = await fetch(`${data.url}projection`, {
        method: "POST",
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(projectionWrite.status).toBe(405);

      const projection = await fetch(`${data.url}projection`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(projection.status).toBe(404);

      const projectionV2 = await fetch(`${data.url}projection/v2?maxNodes=5&maxRelations=5`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(projectionV2.status).toBe(200);
      const bodyV2 = await projectionV2.json() as any;
      expect(bodyV2.data.schemaVersion).toBe("archcontext.explorer-projection/v2");
      expect(bodyV2.data.view.id).toBe("system-map");
      expect(bodyV2.data.availableViews.map((view: any) => view.id)).toEqual(["system-map", "task-impact", "drift-pressure", "data-flow", "external-integrations"]);
      expect(bodyV2.data.occurrences.length).toBeLessThanOrEqual(5);
      expect(bodyV2.data.page.budget).toEqual({ maxNodes: 5, maxRelations: 5 });
      expect(JSON.stringify(bodyV2.data)).not.toContain("sourceBody");
      expect(bodyV2.data.capabilities).toMatchObject({ readOnly: true, mutationMode: "forbidden", egress: "none" });
      const repeatedProjectionV2 = await fetch(`${data.url}projection/v2?maxNodes=5&maxRelations=5`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(repeatedProjectionV2.status).toBe(200);
      expect(((await repeatedProjectionV2.json()) as any).data.projectionDigest).toBe(bodyV2.data.projectionDigest);
      expect(localStore.explorerManifestCacheHits).toBe(1);
      expect(localStore.explorerRuntimeMetrics).toEqual(expect.arrayContaining([
        expect.objectContaining({ metricName: "cache-rebuild", reasonCode: "manifest-miss", value: 1 }),
        expect.objectContaining({ metricName: "compile-time-ms", reasonCode: "projection-compile" })
      ]));
      const testCacheStats = await localStore.readExplorerProjectionCacheStats({
        repository: bodyV2.data.inputManifest.repository,
        worktree: bodyV2.data.inputManifest.worktree
      });
      expect(testCacheStats.metrics).toEqual(expect.arrayContaining([
        expect.objectContaining({ metricName: "cache-hit", reasonCode: "manifest-read", sampleCount: 1 }),
        expect.objectContaining({ metricName: "cache-rebuild", reasonCode: "manifest-miss", sampleCount: 1 })
      ]));

      for (const view of ["data-flow", "external-integrations"] as const) {
        const typedView = await fetch(`${data.url}projection/v2?view=${view}&maxNodes=5&maxRelations=5`, {
          headers: { Authorization: `Bearer ${data.token}` }
        });
        expect(typedView.status).toBe(200);
        const typedBody = await typedView.json() as any;
        expect(typedBody.data.view.id).toBe(view);
        expect(typedBody.data.page.returnedNodes).toBeLessThanOrEqual(5);
        expect(typedBody.data.page.returnedRelations).toBeLessThanOrEqual(5);
      }

      const taskImpact = await fetch(`${data.url}projection/v2?view=task-impact&taskSessionId=task.explorer-current&maxNodes=5&maxRelations=5`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(taskImpact.status).toBe(200);
      expect(((await taskImpact.json()) as any).data.view.id).toBe("task-impact");
      writeFileSync(join(root, "TASK-SESSION-STALE.md"), "stale task cursor\n", "utf8");
      const staleTask = await fetch(`${data.url}projection/v2?view=task-impact&taskSessionId=task.explorer-current`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(staleTask.status).toBe(409);
      const systemMapWithStaleTaskHint = await fetch(`${data.url}projection/v2?view=system-map&taskSessionId=task.explorer-current`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(systemMapWithStaleTaskHint.status).toBe(200);
      const missingTask = await fetch(`${data.url}projection/v2?view=task-impact&taskSessionId=task.missing`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(missingTask.status).toBe(409);

      const driftPressure = await fetch(`${data.url}projection/v2?view=drift-pressure&maxNodes=5&maxRelations=5`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(driftPressure.status).toBe(200);
      expect(((await driftPressure.json()) as any).data.view.id).toBe("drift-pressure");

      const deniedBudget = await fetch(`${data.url}projection/v2?maxNodes=1001&maxRelations=5001`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(deniedBudget.status).toBe(400);

      const runtimeStatus = await daemon.runtimeStatus(root);
      const migrated = await daemon.ledgerMigrate(root, {
        fromYaml: true,
        dryRun: false,
        expectedWorktreeDigest: (runtimeStatus.data as any).worktreeDigest
      });
      expect(migrated.ok).toBe(true);
      const authorityProjectionResponse = await fetch(`${data.url}projection/v2?maxNodes=5&maxRelations=5`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(authorityProjectionResponse.status).toBe(200);
      const authorityProjection = await authorityProjectionResponse.json() as any;
      expect(authorityProjection.data.cursor.authorityCursor).toBeTruthy();
      const bookStatus = await daemon.book(root, { command: "status" });
      const eventId = (bookStatus.data as any).freshness.ledgerCursor.lastEventId;
      expect(eventId).toBeTruthy();
      const delta = await fetch(`${data.url}delta?baseEventId=${encodeURIComponent(eventId)}&headEventId=${encodeURIComponent(eventId)}&baseProjectionDigest=${encodeURIComponent(authorityProjection.data.projectionDigest)}&headProjectionDigest=${encodeURIComponent(authorityProjection.data.projectionDigest)}`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(delta.status).toBe(200);
      expect(((await delta.json()) as any).data.counts).toEqual({ "architecture-fact": 0, evidence: 0, projection: 0 });
      expect(localStore.explorerCacheMetadata.get(authorityProjection.data.projectionDigest)).toMatchObject({ pinReason: "delta-head" });
      const malformedDelta = await daemon.explorerProjectionDelta(root, {} as any);
      expect(malformedDelta.ok).toBe(false);
      expect((malformedDelta.error as any).reasonCode).toBe("invalid-delta-query");
      const missingEventDelta = await fetch(`${data.url}delta?baseEventId=arch_event.missing&headEventId=${encodeURIComponent(eventId)}&baseProjectionDigest=${encodeURIComponent(authorityProjection.data.projectionDigest)}&headProjectionDigest=${encodeURIComponent(authorityProjection.data.projectionDigest)}`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(missingEventDelta.status).toBe(409);
      expect(((await missingEventDelta.json()) as any).error.reasonCode).toBe("authority-event-missing");

      const authorityCursor = authorityProjection.data.cursor.authorityCursor;
      const observedSymbolId = authorityProjection.data.occurrences
        .flatMap((occurrence: any) => occurrence.provenance.observedSymbolIds)[0];
      const targetEntityId = authorityProjection.data.occurrences
        .flatMap((occurrence: any) => occurrence.provenance.declaredEntityIds)[0];
      expect(observedSymbolId).toBeTruthy();
      expect(targetEntityId).toBeTruthy();
      const explorerAnchor = await localStore.createArchitectureLedgerSnapshot({
        repository: authorityCursor.repository,
        worktree: authorityCursor.worktree,
        sourceMode: "dual",
        projectionDigest: authorityProjection.data.projectionDigest,
        inputDigests: { modelDigest: authorityCursor.graphDigest },
        createdAt: "2026-06-20T00:00:00.500Z"
      });
      expect(explorerAnchor.schemaVersion).toBe("archcontext.architecture-snapshot/v2");
      const evidenceItem = {
        schemaVersion: "archcontext.evidence-item/v2",
        evidenceId: "evidence.explorer-lifecycle",
        kind: "architecture-declaration",
        strength: "verified",
        polarity: "positive",
        origin: "runtime-daemon",
        subject: targetEntityId,
        selector: { kind: "symbol", id: observedSymbolId, symbolId: observedSymbolId },
        summary: "Explorer lifecycle binding",
        coverage: { level: "complete", scope: targetEntityId },
        supports: ["checkpoint"],
        provenance: { producer: "runtime-daemon.test", command: "test Explorer lifecycle", inputDigest: digestJson({ observedSymbolId, targetEntityId } as any) },
        createdAt: "2026-06-20T00:00:01.000Z",
        digest: digestJson({ evidenceId: "evidence.explorer-lifecycle", observedSymbolId, targetEntityId } as any)
      };
      const evidenceBinding = {
        schemaVersion: "archcontext.evidence-binding/v1",
        bindingId: "binding.explorer-lifecycle",
        evidenceId: evidenceItem.evidenceId,
        target: { kind: "entity", id: targetEntityId },
        bindingReason: "direct-selector",
        authorityEffect: "checkpoint-eligible",
        createdAt: "2026-06-20T00:00:01.000Z",
        provenance: evidenceItem.provenance
      };
      await localStore.appendArchitectureEvents({
        writer: "runtime-daemon",
        events: [{
          schemaVersion: "archcontext.architecture-event/v1",
          eventId: "arch_event.explorer_lifecycle",
          eventType: "architecture.evidence.lifecycle",
          payloadVersion: "archcontext.architecture-evidence-lifecycle/v2",
          repository: authorityCursor.repository,
          worktree: authorityCursor.worktree,
          baseDigest: authorityCursor.graphDigest,
          resultingDigest: authorityCursor.graphDigest,
          headSha: authorityCursor.worktree.headSha,
          actor: { kind: "daemon", id: "archctxd.test" },
          source: "apply_update",
          timestamp: "2026-06-20T00:00:01.000Z",
          idempotencyKey: "explorer-evidence-lifecycle",
          provenance: evidenceItem.provenance,
          payload: {
            summary: "Create Explorer evidence binding",
            evidenceOperations: [
              { target: "item", action: "create", evidenceId: evidenceItem.evidenceId, value: evidenceItem },
              { target: "binding", action: "create", bindingId: evidenceBinding.bindingId, value: evidenceBinding }
            ]
          }
        } as any]
      });
      const lifecycleFeedRecord = localStore.architectureChangeFeed.at(-1)!;
      expect(lifecycleFeedRecord.eventId).toBe("arch_event.explorer_lifecycle");
      expect(Math.max(...[...localStore.architectureChangeFeedConsumers.values()].map((consumer) => consumer.checkpoint), 0)).toBeLessThan(lifecycleFeedRecord.feedSequence);
      const lifecycleProjectionResponse = await fetch(`${data.url}projection/v2?maxNodes=5&maxRelations=5`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(lifecycleProjectionResponse.status).toBe(200);
      const lifecycleProjection = await lifecycleProjectionResponse.json() as any;
      expect(lifecycleProjection.data.inputManifest.bindingsDigest).not.toBe(authorityProjection.data.inputManifest.bindingsDigest);
      expect(lifecycleProjection.data.occurrences.some((occurrence: any) => occurrence.provenance.evidenceBindingIds.includes(evidenceBinding.bindingId))).toBe(true);
      expect(lifecycleProjection.data.occurrences.some((occurrence: any) => occurrence.backlinks.changedByEventIds.includes("arch_event.explorer_lifecycle"))).toBe(true);
      expect(lifecycleProjection.data.occurrences.some((occurrence: any) => occurrence.inspector.historyEvents.some((event: any) => event.eventId === "arch_event.explorer_lifecycle"))).toBe(true);
      expect(localStore.invalidatedExplorerProjections.has(authorityProjection.data.projectionDigest)).toBe(true);
      expect(Math.max(...[...localStore.architectureChangeFeedConsumers.values()].map((consumer) => consumer.checkpoint), 0)).toBe(lifecycleFeedRecord.feedSequence);
      const anchoredLifecycleReplay = await localStore.replayArchitectureLedger({ repository: authorityCursor.repository, worktree: authorityCursor.worktree });
      expect(anchoredLifecycleReplay.replay.anchorSnapshotId).toBe(explorerAnchor.snapshotId);
      expect(anchoredLifecycleReplay.replay.tailEventCount).toBe(1);
      const lifecycleEventId = lifecycleProjection.data.cursor.authorityCursor.eventId;
      const lifecycleDelta = await fetch(`${data.url}delta?baseEventId=${encodeURIComponent(eventId)}&headEventId=${encodeURIComponent(lifecycleEventId)}&baseProjectionDigest=${encodeURIComponent(authorityProjection.data.projectionDigest)}&headProjectionDigest=${encodeURIComponent(lifecycleProjection.data.projectionDigest)}`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(lifecycleDelta.status).toBe(200);
      expect(((await lifecycleDelta.json()) as any).data.counts.evidence).toBe(2);
      const mismatchedCursor = await fetch(`${data.url}delta?baseEventId=${encodeURIComponent(eventId)}&headEventId=${encodeURIComponent(lifecycleEventId)}&baseProjectionDigest=${encodeURIComponent(lifecycleProjection.data.projectionDigest)}&headProjectionDigest=${encodeURIComponent(lifecycleProjection.data.projectionDigest)}`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(mismatchedCursor.status).toBe(409);
      expect(((await mismatchedCursor.json()) as any).error.reasonCode).toBe("projection-authority-mismatch");
      const reversedCursor = await fetch(`${data.url}delta?baseEventId=${encodeURIComponent(lifecycleEventId)}&headEventId=${encodeURIComponent(eventId)}&baseProjectionDigest=${encodeURIComponent(lifecycleProjection.data.projectionDigest)}&headProjectionDigest=${encodeURIComponent(authorityProjection.data.projectionDigest)}`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(reversedCursor.status).toBe(409);
      expect(((await reversedCursor.json()) as any).error.reasonCode).toBe("authority-cursor-reversed");

      const detailProjection = await fetch(`${data.url}projection/v2?level=detail&maxNodes=5&maxRelations=5`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      const detailBody = await detailProjection.json() as any;
      const projectionOnlyDelta = await fetch(`${data.url}delta?baseEventId=${encodeURIComponent(lifecycleEventId)}&headEventId=${encodeURIComponent(lifecycleEventId)}&baseProjectionDigest=${encodeURIComponent(lifecycleProjection.data.projectionDigest)}&headProjectionDigest=${encodeURIComponent(detailBody.data.projectionDigest)}`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(projectionOnlyDelta.status).toBe(409);
      const projectionOnlyDeltaBody = await projectionOnlyDelta.json() as any;
      expect(projectionOnlyDeltaBody.error.message).toContain("incompatible Explorer delta: manifest");
      expect(projectionOnlyDeltaBody.error.reasonCode).toBe("projection-manifest-incompatible");

      const sseAbort = new AbortController();
      const sse = await fetch(`${data.url}events`, { headers: { Authorization: `Bearer ${data.token}` }, signal: sseAbort.signal });
      expect(sse.status).toBe(200);
      expect(sse.headers.get("content-type")).toContain("text/event-stream");
      const reader = sse.body!.getReader();
      await reader.read();
      await fetch(`${data.url}projection/v2?level=overview&maxNodes=5&maxRelations=5`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      const projectionInvalidationChunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Explorer projection invalidation timeout")), 2_000))
      ]);
      const projectionInvalidationText = new TextDecoder().decode(projectionInvalidationChunk.value);
      expect(projectionInvalidationText).toContain("projection-invalidated");
      expect(projectionInvalidationText).toContain("viewDefinitionDigest");
      expect(projectionInvalidationText).toContain("projectionDigest");
      expect(projectionInvalidationText).not.toContain("sourceBody");
      const updatedEvidenceItem = {
        ...evidenceItem,
        summary: "Explorer lifecycle binding updated",
        digest: digestJson({ evidenceId: evidenceItem.evidenceId, summary: "Explorer lifecycle binding updated" } as any)
      };
      await localStore.appendArchitectureEvents({
        writer: "runtime-daemon",
        events: [{
          schemaVersion: "archcontext.architecture-event/v1",
          eventId: "arch_event.explorer_lifecycle_update",
          eventType: "architecture.evidence.lifecycle",
          payloadVersion: "archcontext.architecture-evidence-lifecycle/v2",
          repository: authorityCursor.repository,
          worktree: authorityCursor.worktree,
          baseDigest: authorityCursor.graphDigest,
          resultingDigest: authorityCursor.graphDigest,
          headSha: authorityCursor.worktree.headSha,
          actor: { kind: "daemon", id: "archctxd.test" },
          source: "apply_update",
          timestamp: "2026-06-20T00:00:02.000Z",
          idempotencyKey: "explorer-evidence-lifecycle-update",
          provenance: evidenceItem.provenance,
          payload: {
            summary: "Update Explorer evidence item",
            evidenceOperations: [
              { target: "item", action: "update", evidenceId: updatedEvidenceItem.evidenceId, previousDigest: digestJson(evidenceItem as any), value: updatedEvidenceItem }
            ]
          }
        } as any]
      });
      await fetch(`${data.url}projection/v2?level=overview&maxNodes=5&maxRelations=5`, { headers: { Authorization: `Bearer ${data.token}` } });
      const eventChunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Explorer SSE invalidation timeout")), 2_000))
      ]);
      const eventText = new TextDecoder().decode(eventChunk.value);
      expect(eventText).toContain("authority-changed");
      expect(eventText).toContain("feedSequence");
      expect(eventText).toContain("subjectsDigest");
      expect(eventText).not.toContain("summary");
      expect(eventText).not.toContain("payload");
      expect(eventText).not.toContain("sourceBody");
      expect(eventText).not.toContain("src/");
      sseAbort.abort();

      const staleV2 = await fetch(`${data.url}projection/v2?expectedHeadSha=${"f".repeat(40)}&expectedWorktreeDigest=${encodeURIComponent(bodyV2.data.cursor.worktree.worktreeDigest)}&expectedGraphDigest=${encodeURIComponent(bodyV2.data.cursor.graphDigest)}`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(staleV2.status).toBe(409);
      expect(((await staleV2.json()) as any).error.code).toBe("AC_PRECONDITION_FAILED");

      const html = await fetch(`${data.url}?token=${data.token}`);
      expect(html.status).toBe(200);
      expect(html.headers.get("content-type")).toContain("text/html");
      expect(html.headers.get("content-security-policy")).toBe("default-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      const htmlBody = await html.text();
      expect(htmlBody).toContain("ArchContext Explorer");
      expect(htmlBody).toContain("Data Flow");
      expect(htmlBody).toContain("External Integrations");
      expect(htmlBody).toContain("read-only · local · no egress");
      expect(htmlBody).not.toContain("https://");

      await daemon.revokeExplorerToken();
      const revoked = await fetch(`${data.url}projection`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(revoked.status).toBe(401);
      await daemon.stopExplorer();
      expect((daemon.explorerStatus().data as any).running).toBe(false);
    } finally {
      removeTempRepo(root);
    }
  });

  test("Explorer token expiry fails closed for HTML and SSE without ambient authentication", async () => {
    const root = tempRepo();
    let now = "2026-06-20T00:00:00.000Z";
    let daemon: ArchctxDaemon | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let expireSession: (() => void) | undefined;
    try {
      daemon = await createStartedTestDaemon({ clock: () => now });
      await daemon.init(root, "Explorer Token Expiry App");
      const realSetTimeout = globalThis.setTimeout;
      // Drive the expiry callback with the injected clock; real socket setup may exceed 250ms.
      const schedule = spyOn(globalThis, "setTimeout").mockImplementation(((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
        if (delay !== 250) return realSetTimeout(callback, delay, ...args);
        expiryTimer = realSetTimeout(() => {}, 60_000);
        expiryTimer.unref();
        expireSession = () => {
          clearTimeout(expiryTimer);
          callback(...args);
        };
        return expiryTimer;
      }) as typeof setTimeout);
      let started: JsonEnvelope;
      try {
        started = await daemon.startExplorer(root, { port: 0, tokenTtlSeconds: 0.25 });
      } finally {
        schedule.mockRestore();
      }
      expect(expireSession).toBeDefined();
      const data = started.data as any;
      const beforeExpiry = await fetch(`${data.url}?token=${data.token}`);
      expect(beforeExpiry.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const connectedSse = await fetch(`${data.url}events?token=${data.token}`);
      expect(connectedSse.status).toBe(200);
      const connectedReader = connectedSse.body!.getReader();
      expect((await connectedReader.read()).done).toBe(false);
      now = "2026-06-20T00:00:02.000Z";
      const expiredHtml = await fetch(`${data.url}?token=${data.token}`);
      expect(expiredHtml.status).toBe(401);
      const expiredSse = await fetch(`${data.url}events?token=${data.token}`);
      expect(expiredSse.status).toBe(401);
      const ambient = await fetch(data.url, { headers: { Cookie: `token=${data.token}` } });
      expect(ambient.status).toBe(401);
      expireSession!();
      expect((await connectedReader.read()).done).toBe(true);
      expect((daemon.explorerStatus().data as any).revoked).toBe(true);
      await daemon.stopExplorer();
    } finally {
      clearTimeout(expiryTimer);
      await daemon?.stop();
      removeTempRepo(root);
    }
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
      expect(result.error?.message).toContain("required-input-unavailable:observed:codegraph-index-missing");
    } finally {
      removeTempRepo(root);
    }
  });

  test("Explorer fails closed over malformed repository model input without leaking its body", async () => {
    const root = tempRepo();
    try {
      const daemon = await createStartedTestDaemon();
      await daemon.init(root, "Malformed Explorer App");
      const malformedPath = join(root, ".archcontext", "model", "nodes", "malformed.yaml");
      writeFileSync(malformedPath, "schemaVersion: broken\nTOP_SECRET_BODY: should-not-leak\n", "utf8");
      const started = await daemon.startExplorer(root, { port: 0, tokenTtlSeconds: 60 });
      const data = started.data as any;
      const response = await fetch(`${data.url}projection/v2`, { headers: { Authorization: `Bearer ${data.token}` } });
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).not.toContain("TOP_SECRET_BODY");
      expect(body).not.toContain("should-not-leak");
      expect(body).not.toContain("malformed.yaml");
      await daemon.stopExplorer();
    } finally {
      removeTempRepo(root);
    }
  });
});

describe("createNodeInvestigationTransport", () => {
  test("unwraps a successful claude --output-format json envelope into a report stdout", async () => {
    const script = "process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:JSON.stringify({ok:true,findings:[]})}))";
    const transport = createNodeInvestigationTransport();
    const result = await transport({
      runnerPort: "claude-code",
      runnerId: "runner.claude-code",
      command: process.execPath,
      args: ["-e", script],
      stdin: "{}"
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ report: { ok: true, findings: [] } });
  });

  test("reports a non-zero exit without throwing when the envelope signals is_error", async () => {
    const script = "process.stdout.write(JSON.stringify({type:'result',subtype:'error_during_execution',is_error:true,result:'agent failed'}))";
    const transport = createNodeInvestigationTransport();
    const result = await transport({
      runnerPort: "claude-code",
      runnerId: "runner.claude-code",
      command: process.execPath,
      args: ["-e", script],
      stdin: "{}"
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("agent failed");
  });

  test("reports a non-zero exit without throwing when stdout is not an envelope", async () => {
    const transport = createNodeInvestigationTransport();
    const result = await transport({
      runnerPort: "claude-code",
      runnerId: "runner.claude-code",
      command: process.execPath,
      args: ["-e", "process.stdout.write('not json')"],
      stdin: "{}"
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("not json");
  });

  test("reports a non-zero exit without throwing when the envelope result is not JSON", async () => {
    const script = "process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'not json report'}))";
    const transport = createNodeInvestigationTransport();
    const result = await transport({
      runnerPort: "claude-code",
      runnerId: "runner.claude-code",
      command: process.execPath,
      args: ["-e", script],
      stdin: "{}"
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("not json report");
  });
});

describe("github issue executor", () => {
  test("withGithubIssueBodyFile removes its temp directory even when writing the body fails", async () => {
    let capturedBodyFile: string | undefined;
    const failingWrite = ((path: unknown) => {
      capturedBodyFile = path as string;
      throw new Error("simulated disk write failure");
    }) as unknown as typeof writeFileSync;

    let caught: unknown;
    try {
      await withGithubIssueBodyFile(
        "draft body",
        async () => {
          throw new Error("fn must never run: the write should have failed first");
        },
        { writeFile: failingWrite }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("simulated disk write failure");
    expect(capturedBodyFile).toBeDefined();
    // The temp directory `mkdtempSync` created still existed at the moment of the write failure
    // (that is what makes this a meaningful assertion); the fix's `finally` must have removed it.
    expect(existsSync(dirname(capturedBodyFile!))).toBe(false);
  });

  test("gh executor redacts the call's token and any gh-token-shaped substring from a failing call's error message", async () => {
    if (process.platform === "win32") return;
    const binDir = mkdtempSync(join(tmpdir(), "archctx-fake-gh-"));
    // Deliberately NOT gh-token-shaped, so it can only be stripped by the literal-token match.
    const callToken = "s3cr3t-pat-literal-000111222333";
    // gh-token-shaped but NOT the literal token passed to this call, so it can only be stripped by
    // the gh[opsu]_ pattern match (simulates gh's own output echoing a *different* credential).
    const otherToken = "ghu_otherLeakedTokenShape999888";
    try {
      writeFileSync(
        join(binDir, "gh"),
        `#!/bin/sh\necho "authentication failed for token ${callToken}; also saw ${otherToken}" 1>&2\nexit 1\n`
      );
      chmodSync(join(binDir, "gh"), 0o755);
      const previousPath = process.env.PATH;
      process.env.PATH = `${binDir}${previousPath ? `${delimiter}${previousPath}` : ""}`;
      try {
        const executor = createNodeGithubIssueExecutor({ timeoutMs: 5_000 });
        let caught: unknown;
        try {
          await executor.repoView("acme/widgets", { GH_TOKEN: callToken });
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(Error);
        const message = (caught as Error).message;
        expect(message).toContain("[REDACTED]");
        expect(message).not.toContain(callToken);
        expect(message).not.toContain(otherToken);
      } finally {
        process.env.PATH = previousPath;
      }
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  // ADR-0042 non-goal, reproducing a real `archctx audit approve` e2e failure: `gh issue create
  // --label archcontext-audit` rejected with `could not add label: 'archcontext-audit' not found`
  // because label existence on the target repo is never verified first. createIssue() has no
  // `labels` input at all (see GithubIssueExecutorPort's doc comment) — this pins the real
  // executor's actual `gh` argv to prove no `--label` is ever emitted, whatever a draft's labels
  // may be; those stay visible only via `archctx audit show`.
  test("ADR-0042: real gh executor's createIssue never sends --label to gh (label existence on the target repo is never verified server-side, so an unknown label would fail gh issue create outright)", async () => {
    if (process.platform === "win32") return;
    const binDir = mkdtempSync(join(tmpdir(), "archctx-fake-gh-label-"));
    const capturedArgsFile = join(binDir, "captured-args.txt");
    const bodyFile = join(binDir, "body.md");
    try {
      writeFileSync(bodyFile, "draft body", "utf8");
      writeFileSync(
        join(binDir, "gh"),
        `#!/bin/sh\nprintf '%s\\n' "$@" > "${capturedArgsFile}"\necho "https://github.com/acme/widgets/issues/4242"\n`
      );
      chmodSync(join(binDir, "gh"), 0o755);
      const previousPath = process.env.PATH;
      process.env.PATH = `${binDir}${previousPath ? `${delimiter}${previousPath}` : ""}`;
      try {
        const executor = createNodeGithubIssueExecutor({ timeoutMs: 5_000 });
        const result = await executor.createIssue({
          repo: "acme/widgets",
          title: "Some draft title",
          bodyFile,
          env: { GH_TOKEN: "gh_pat_test_token" }
        });
        expect(result).toEqual({ number: 4242, url: "https://github.com/acme/widgets/issues/4242" });
        const capturedArgs = readFileSync(capturedArgsFile, "utf8");
        expect(capturedArgs).not.toContain("--label");
      } finally {
        process.env.PATH = previousPath;
      }
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  // Issue #117: the preflight's job is to stop credential *values* from being published, not to
  // ban the vocabulary a security/architecture audit needs in order to describe them.
  const preflightDraft = (overrides: Partial<GithubIssuePreflightDraft> = {}): GithubIssuePreflightDraft => ({
    draftId: "draft_1",
    draftDigest: `sha256:${"a".repeat(64)}`,
    title: "Some advisory finding",
    bodyMarkdown: "## Task\n\nDo the thing.\n",
    labels: [],
    ...overrides
  });

  const benignSecurityProseDrafts: { name: string; draft: GithubIssuePreflightDraft }[] = [
    { name: "JWT in the title", draft: preflightDraft({ title: "Validate JWT audience and issuer checks" }) },
    { name: "lowercase jwt in prose", draft: preflightDraft({ bodyMarkdown: "The verifier never checks the jwt expiry claim.\n" }) },
    { name: "JWT trust-boundary prose", draft: preflightDraft({ bodyMarkdown: "## Task\n\nDocument JWT trust boundaries between the app and the daemon.\n" }) },
    { name: "installation-token prose", draft: preflightDraft({ title: "Rotate installation-token credentials safely" }) },
    { name: "installation_token identifier", draft: preflightDraft({ bodyMarkdown: "The `installation_token` field is read from the store and never logged.\n" }) },
    { name: "jwt label", draft: preflightDraft({ labels: ["area/jwt", "security"] }) },
    {
      name: "malformed near-miss token shape",
      draft: preflightDraft({ bodyMarkdown: "A truncated header-only value such as eyJhbGciOiJIUzI1NiJ9 is not a credential.\n" })
    },
    {
      name: "dotted identifiers that are not a compact token",
      draft: preflightDraft({ bodyMarkdown: "See packages.local-runtime.runtime-daemon for the handler.\n" })
    },
    {
      name: "Bearer authentication terminology",
      draft: preflightDraft({ bodyMarkdown: "Use Bearer authentication for this request.\n" })
    },
    {
      name: "provider key vocabulary without a value",
      draft: preflightDraft({ bodyMarkdown: "Keys start with sk-ant- or AKIA; the risk-free task-runner uses sk-learn and xoxb- tokens in docs only.\n" })
    }
  ];

  for (const { name, draft } of benignSecurityProseDrafts) {
    test(`preflight publishes benign security prose: ${name}`, () => {
      const result = preflightGithubIssueDrafts("audit_run.benign", [draft]);
      expect(result.ok).toBe(true);
    });
  }

  const credentialValueDrafts: { name: string; field: string; draft: GithubIssuePreflightDraft }[] = [
    {
      name: "compact token value in the body",
      field: "body",
      draft: preflightDraft({
        bodyMarkdown:
          "Observed value: eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIxMjM0NSIsImV4cCI6OTk5OTk5fQ.c2lnbmF0dXJlLXZhbHVlLWhlcmU\n"
      })
    },
    {
      name: "compact token value in the title",
      field: "title",
      draft: preflightDraft({
        title: "Leaked eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIxMjM0NSIsImV4cCI6OTk5OTk5fQ.c2lnbmF0dXJlLXZhbHVlLWhlcmU value"
      })
    },
    {
      name: "compact token value in a label",
      field: "label",
      draft: preflightDraft({
        labels: ["eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIxMjM0NSIsImV4cCI6OTk5OTk5fQ.c2lnbmF0dXJlLXZhbHVlLWhlcmU"]
      })
    },
    {
      name: "github token prefix",
      field: "body",
      draft: preflightDraft({ bodyMarkdown: "Rotate ghp_abcdefghijklmnopqrstuvwxyz0123456789 immediately.\n" })
    },
    {
      name: "fine-grained github token prefix",
      field: "body",
      draft: preflightDraft({ bodyMarkdown: `Rotate github_pat_${"A".repeat(40)} immediately.\n` })
    },
    {
      name: "github refresh token prefix",
      field: "body",
      draft: preflightDraft({ bodyMarkdown: "Rotate ghr_abcdefghijklmnopqrstuvwxyz0123456789 immediately.\n" })
    },
    {
      name: "bearer credential",
      field: "body",
      draft: preflightDraft({ bodyMarkdown: "Request header: Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345\n" })
    },
    {
      name: "private key header",
      field: "body",
      draft: preflightDraft({ bodyMarkdown: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKC\n" })
    },
    {
      name: "webhook secret",
      field: "body",
      draft: preflightDraft({ bodyMarkdown: "GITHUB_WEBHOOK_SECRET=hunter2hunter2hunter2\n" })
    },
    {
      name: "installation token assignment",
      field: "body",
      draft: preflightDraft({ bodyMarkdown: 'installation_token = "NOT-A-REAL-INSTALLATION-TOKEN-0000"\n' })
    },
    {
      name: "installation-token assignment in mixed case",
      field: "body",
      draft: preflightDraft({ bodyMarkdown: "Installation-Token: NOT-A-REAL-INSTALLATION-TOKEN-0000\n" })
    },
    // Issue #161: model-provider, cloud and chat credential values shared with the Context7 guard.
    {
      name: "anthropic api key",
      field: "body",
      draft: preflightDraft({ bodyMarkdown: "Found ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123 in config.\n" })
    },
    {
      name: "openai-style api key",
      field: "title",
      draft: preflightDraft({ title: "Remove sk-proj-abcdefghijklmnopqrstuvwxyz0123 from fixtures" })
    },
    {
      name: "aws access key id",
      field: "body",
      draft: preflightDraft({ bodyMarkdown: "aws_access_key_id = AKIAIOSFODNN7EXAMPLE\n" })
    },
    {
      name: "slack bot token",
      field: "label",
      draft: preflightDraft({ labels: ["xoxb-123456789012-abcdefghijkl"] })
    }
  ];

  for (const { name, field, draft } of credentialValueDrafts) {
    test(`preflight rejects a credential value: ${name}`, () => {
      const result = preflightGithubIssueDrafts("audit_run.credential", [draft]);
      expect(result.ok).toBe(false);
      const reason = (result as { ok: false; reason: string }).reason;
      expect(reason).toContain("secret-shaped");
      expect(reason).toContain(draft.draftId);
      expect(reason).toContain(field);
      // The reason names the detector and the field, never the matched credential text.
      const scanned = [draft.title, draft.bodyMarkdown, ...draft.labels].join("\n");
      for (const word of scanned.split(/\s+/).filter((token) => token.length >= 12)) {
        expect(reason).not.toContain(word);
      }
    });
  }

  test("preflight aborts the whole batch on one credential value and publishes nothing partially", () => {
    const result = preflightGithubIssueDrafts("audit_run.batch", [
      preflightDraft({ draftId: "draft_safe_1", title: "Validate JWT audience and issuer checks" }),
      preflightDraft({ draftId: "draft_bad", bodyMarkdown: "Rotate ghp_abcdefghijklmnopqrstuvwxyz0123456789 immediately.\n" }),
      preflightDraft({ draftId: "draft_safe_2", title: "Document installation-token lifecycle" })
    ]);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toContain("draft_bad");
    expect((result as { ok: false; reason: string }).reason).toContain("entire run");
  });

  test("preflight passes a multi-draft batch of benign security findings", () => {
    const result = preflightGithubIssueDrafts("audit_run.batch_ok", [
      preflightDraft({ draftId: "draft_1", title: "Validate JWT audience and issuer checks" }),
      preflightDraft({ draftId: "draft_2", title: "Rotate installation-token credentials safely", labels: ["area/jwt"] })
    ]);
    expect(result.ok).toBe(true);
    expect((result as { ok: true; bodies: Map<string, string> }).bodies.size).toBe(2);
  });
});

async function appendRecommendationRunFixture(store: TestLocalStore, root: string, now: string) {
  const paths = runtimeStatePaths(root);
  const repository = {
    repositoryId: repositoryFingerprint(root),
    storageRepositoryId: paths.storageRepositoryId
  };
  const worktree = {
    workspaceId: paths.workspaceId,
    storageWorkspaceId: paths.storageWorkspaceId,
    branch: gitOut(root, "branch", "--show-current") || "HEAD",
    headSha: gitOut(root, "rev-parse", "HEAD"),
    worktreeDigest: computeWorktreeDigest(root)
  };
  const plan = planRecommendationRun({
    repository,
    worktree,
    triggerSource: "checkpoint",
    policyMode: "advisory",
    catalogDigest: digestJson({ fixture: "runtime-recommendation-catalog" } as any),
    inputCursor: {
      source: "candidate-delta",
      baseDigest: digestJson({ base: "runtime-recommendation" } as any),
      headDigest: digestJson({ head: "runtime-recommendation" } as any),
      headSha: worktree.headSha,
      candidateDeltaDigest: digestJson({ delta: "runtime-recommendation" } as any)
    },
    candidates: [{
      practiceId: "practice.runtime-boundary",
      subject: "module.runtime-ledger",
      confidence: "medium",
      enforcement: "advisory",
      evidenceBindingIds: ["binding.al8.lifecycle"],
      explanation: ["Runtime ledger recommendation requires explicit lifecycle feedback."],
      riskSignals: ["boundary-change"],
      uncertaintySignals: [],
      score: 52
    }],
    now
  });
  const graphDigest = digestJson({ fixture: "empty-architecture-graph" } as any);
  const inputDigest = digestJson({ runId: plan.run.runId, recommendationIds: plan.run.recommendationIds } as any);
  await store.appendArchitectureEvents({
    writer: "runtime-daemon",
    events: [{
      schemaVersion: "archcontext.architecture-event/v1",
      eventId: `architecture_event.recommendation_run.${inputDigest.replace(/^sha256:/, "").slice(0, 16)}`,
      eventType: "architecture.recommendation.run",
      payloadVersion: "archcontext.recommendation-run/v1",
      repository,
      worktree,
      baseDigest: graphDigest,
      resultingDigest: graphDigest,
      headSha: worktree.headSha,
      actor: { kind: "daemon", id: "archctxd" },
      source: "checkpoint",
      timestamp: now,
      idempotencyKey: `architecture-ledger-recommendation-run:${plan.run.runId}`,
      provenance: {
        producer: "runtime-daemon-test",
        command: "appendRecommendationRunFixture",
        inputDigest
      },
      payload: recommendationRunLedgerPayload(plan) as any
    }]
  });
  return plan;
}

function gitCommitAll(root: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync(
    "git",
    ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", message],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] }
  );
}
