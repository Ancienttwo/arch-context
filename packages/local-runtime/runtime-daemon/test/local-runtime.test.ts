import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { computeWorktreeDigest, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { planRecommendationRun, recommendationRunLedgerPayload } from "@archcontext/core/recommendation-engine";
import { ARCHCONTEXT_PRODUCT_VERSION, canonicalAttestationV2, digestJson, INVESTIGATION_REPORT_SCHEMA_VERSION, type CodeFactsPort, type ExternalDocumentationPort, type Json, type JsonEnvelope, type ModelStorePort, type NormalizedCodeContext } from "@archcontext/contracts";
import { investigationReportProposalValidationDigest, type CommandInvestigationRunnerTransportInput, type CommandInvestigationRunnerTransportResult } from "@archcontext/core/agent-orchestrator";
import { assertNoCodeGraphInternalPathAccess, CodeGraphAdapter, REQUIRED_CODEGRAPH_VERSION } from "@archcontext/local-runtime/codegraph-adapter";
import { Context7ExternalDocumentationAdapter, Context7ProviderError, type Context7Transport } from "@archcontext/local-runtime/context7-adapter";
import { removeDetachedReviewWorktree } from "@archcontext/local-runtime/git-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { migrationSql, assertNoSourceStorageSchema, SQLITE_PRAGMAS, runtimeStatePaths } from "@archcontext/local-runtime/local-store-sqlite";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { initializeArchContextModel, listModelFiles, YamlModelStore } from "@archcontext/local-runtime/model-store-yaml";
import { createNodeInvestigationTransport } from "../src/investigation-transport";
import {
  createNodeGithubIssueExecutor,
  githubIssueFooterMarker,
  withGithubIssueBodyFile,
  type GithubIssueCreatedRecord,
  type GithubIssueExecutorPort,
  type GithubIssueListedRecord
} from "../src/github-issue-executor";
import {
  architectureDocumentationSourceDigest,
  loadArchitectureDocumentationInputs,
  renderArchitectureDocumentationProjection
} from "@archcontext/core/projection-engine";
import {
  ArchctxRuntimeRpcServer,
  RUNTIME_RPC_VERSION,
  RuntimeRpcClient,
  assertProductionRuntimeDeps,
  createStartedProductionDaemon,
  createStartedDaemon,
  defaultDeveloperReviewRunStateDir,
  defaultDaemonConnectionPath,
  defaultDaemonLockPath,
  recoverStaleDaemonControlFiles,
  readRuntimeRpcConnection,
  runtimeDefaultClock,
  type RuntimeAuditApproveInput
} from "../src/index";

const PREVIOUS_ARCHCONTEXT_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const RUNTIME_TEST_STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-runtime-state-"));
const CONTEXT7_FAILURE_MATRIX_CASES = ["disabled", "no-key", "no-network", "429", "timeout", "malformed"] as const;
const DEVELOPER_REVIEW_TEST_TIMEOUT_MS = process.platform === "win32" ? 30_000 : 5_000;
const WINDOWS_RUNTIME_IO_TEST_TIMEOUT_MS = process.platform === "win32" ? 30_000 : 5_000;
type Context7FailureMatrixCase = typeof CONTEXT7_FAILURE_MATRIX_CASES[number];
process.env.ARCHCONTEXT_STATE_DIR = RUNTIME_TEST_STATE_ROOT;

afterAll(() => {
  if (PREVIOUS_ARCHCONTEXT_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_ARCHCONTEXT_STATE_DIR;
  rmSync(RUNTIME_TEST_STATE_ROOT, { recursive: true, force: true });
});

function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-"));
  writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
  return root;
}

function removeTempRepo(root: string): void {
  removeTempPath(root);
}

function removeTempPath(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 100 : 0, retryDelay: 100 });
  } catch (error) {
    if (isIgnorableWindowsCleanupError(error)) return;
    throw error;
  }
}

function isIgnorableWindowsCleanupError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return process.platform === "win32" && (code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate: () => boolean, timeoutMs: number, description: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for: ${description}`);
}

function expectSameExistingPath(actual: string, expected: string): void {
  expect(normalizeExistingPath(actual)).toBe(normalizeExistingPath(expected));
}

function normalizeExistingPath(path: string): string {
  const real = realpathSync.native(path);
  return process.platform === "win32" ? real.toLowerCase() : real;
}

function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
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
    sourceDigest
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

function createStartedTestDaemon(deps: Parameters<typeof createStartedDaemon>[0] = {}) {
  return createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore(),
    ...deps
  });
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

  test("audit run records pending drafts without external side-effect", async () => {
    const root = createGitRepo();
    writeAuditManifest(root, true);
    const store = new TestLocalStore();
    const draftRecords = [
      {
        kind: "spec",
        priority: "P1",
        title: "Split the daemon god-file",
        bodyMarkdown: "## Problem\n\nThe daemon module mixes RPC dispatch with ledger writes in one file.\n",
        labels: ["architecture"],
        evidence: [{ path: "packages/local-runtime/runtime-daemon/src/index.ts", startLine: 1, note: "single-file daemon module" }],
        acceptance: ["daemon RPC handlers live in a dedicated module"],
        verificationCommands: ["bun run typecheck"]
      },
      {
        kind: "task",
        priority: "P2",
        title: "Add direct sqlite coverage for audit_runs reads",
        bodyMarkdown: "## Task\n\nCover listAuditRuns/getAuditRun with a dedicated sqlite test.\n",
        labels: [],
        evidence: [{ path: "packages/local-runtime/local-store-sqlite/src/index.ts", startLine: 1, note: "audit run read path" }],
        acceptance: ["listAuditRuns and getAuditRun have direct sqlite coverage"],
        verificationCommands: []
      }
    ];
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:40:00.000Z",
        investigationTransport: async (input: CommandInvestigationRunnerTransportInput) => {
          const separatorIndex = input.stdin.lastIndexOf("\n\n");
          const runnerInput = JSON.parse(separatorIndex === -1 ? input.stdin : input.stdin.slice(separatorIndex + 2));
          const jobId = runnerInput.job.jobId as string;
          const report = {
            schemaVersion: INVESTIGATION_REPORT_SCHEMA_VERSION,
            reportId: `investigation_report.audit_test_${jobId.slice(-8)}`,
            jobId,
            status: "succeeded",
            findings: [],
            outputDigest: digestJson({ jobId, draftRecords } as unknown as Json),
            createdAt: "2026-06-25T02:40:03.000Z",
            directMutationAllowed: false,
            extensions: { githubIssueDrafts: draftRecords }
          };
          return { exitCode: 0, stdout: JSON.stringify({ report }) };
        }
      });

      const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(run.ok).toBe(true);
      expect((run.data as any).status).toBe("pending");
      expect((run.data as any).pendingDraftCount).toBe(2);
      const runId = (run.data as any).runId;

      const list = await daemon.auditList(root);
      expect((list.data as any).count).toBe(1);
      const [ledgerRun] = (list.data as any).runs;
      expect(ledgerRun.runId).toBe(runId);
      expect(ledgerRun.status).toBe("pending");
      expect(ledgerRun.issueDraftDigests).toHaveLength(2);
      expect(ledgerRun.repoNameWithOwner).toBe("local/unknown");
      expect(ledgerRun.repoVisibility).toBe("private");

      const show = await daemon.auditShow(root, runId);
      expect(show.ok).toBe(true);
      expect((show.data as any).run.runId).toBe(runId);
      expect((show.data as any).githubIssueDrafts).toHaveLength(2);
      expect((show.data as any).githubIssueDrafts.map((draft: any) => draft.priority).sort()).toEqual(["P1", "P2"]);

      const pendingOnly = await daemon.auditList(root, { statuses: ["pending"] });
      expect((pendingOnly.data as any).count).toBe(1);
      const failedOnly = await daemon.auditList(root, { statuses: ["failed"] });
      expect((failedOnly.data as any).count).toBe(0);

      // Zero external side-effect: no gh calls (the fake transport never shells out), and no
      // repository files were written by this advisory-only flow beyond the manifest fixture the
      // test itself seeded (auditRun never scaffolds/writes generated docs or model files).
      expect(existsSync(join(root, ".archcontext", "generated"))).toBe(false);
      const appendedEvent = store.architectureEvents.find((event) => event.eventType === "architecture.agent_audit.run_pending");
      expect(appendedEvent).toBeDefined();
      const serializedEvent = JSON.stringify(appendedEvent);
      expect(serializedEvent).not.toContain("https://github.com");
      expect(serializedEvent).not.toContain("issuedIssues");
      expect(serializedEvent).not.toContain("bodyMarkdown");
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit run records a failed run without pending drafts when the investigation fails", async () => {
    const root = createGitRepo();
    writeAuditManifest(root, true);
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:41:00.000Z",
        investigationTransport: async () => ({ exitCode: 1, stdout: "", stderr: "claude not installed" })
      });

      const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(run.ok).toBe(true);
      expect((run.data as any).status).toBe("failed");
      expect((run.data as any).pendingDraftCount).toBe(0);

      const list = await daemon.auditList(root);
      expect((list.data as any).count).toBe(1);
      expect((list.data as any).runs[0].status).toBe("failed");
      expect((list.data as any).runs[0].issueDraftDigests).toEqual([]);
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit run is gated by audit.githubIssues.enabled at the daemon layer, not only at the CLI", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    let transportCalls = 0;
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:52:00.000Z",
        investigationTransport: async () => {
          transportCalls += 1;
          return { exitCode: 1, stdout: "", stderr: "should never run while the gate is closed" };
        }
      });

      // No .archcontext/manifest.yaml at all: fails closed (disabled), matching the CLI default.
      const disabledByDefault = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(disabledByDefault.ok).toBe(false);
      expect((disabledByDefault as any).error.code).toBe("AC_CAPABILITY_UNSUPPORTED");
      expect(transportCalls).toBe(0);

      // Explicit `enabled: false` is also rejected before anything is spawned or enqueued.
      writeAuditManifest(root, false);
      const disabledExplicitly = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(disabledExplicitly.ok).toBe(false);
      expect((disabledExplicitly as any).error.code).toBe("AC_CAPABILITY_UNSUPPORTED");
      expect(transportCalls).toBe(0);
      const listWhileDisabled = await daemon.auditList(root);
      expect((listWhileDisabled.data as any).count).toBe(0);

      // Enabling it allows the run to reach the (fake) transport.
      writeAuditManifest(root, true);
      const enabled = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(enabled.ok).toBe(true);
      expect(transportCalls).toBe(1);
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit run claims only its own enqueued job and never steals an unrelated queued job's lease", async () => {
    const root = createGitRepo();
    writeAuditManifest(root, true);
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:55:00.000Z",
        investigationTransport: async (input: CommandInvestigationRunnerTransportInput) => {
          const separatorIndex = input.stdin.lastIndexOf("\n\n");
          const runnerInput = JSON.parse(separatorIndex === -1 ? input.stdin : input.stdin.slice(separatorIndex + 2));
          const jobId = runnerInput.job.jobId as string;
          const report = {
            schemaVersion: INVESTIGATION_REPORT_SCHEMA_VERSION,
            reportId: `investigation_report.claim_isolation_test_${jobId.slice(-8)}`,
            jobId,
            status: "succeeded",
            findings: [],
            outputDigest: digestJson({ jobId } as unknown as Json),
            createdAt: "2026-06-25T02:55:03.000Z",
            directMutationAllowed: false,
            extensions: {}
          };
          return { exitCode: 0, stdout: JSON.stringify({ report }) };
        }
      });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "changed.ts"), "export const changed = true;\n", "utf8");

      // Pre-seed a higher-priority queued job (e.g. a normal git-hook-triggered
      // architecture-delta job) in the same repository/workspace scope that is still waiting in
      // the queue when auditRun enqueues and claims its own job.
      const preseedEnqueue = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-edit",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.claim-isolation-preseed",
        priority: 100
      });
      expect((preseedEnqueue.data as any).enqueued).toBe(true);
      const preseedJobId = (preseedEnqueue.data as any).record.job.jobId;

      const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(run.ok).toBe(true);
      expect((run.data as any).status).toBe("pending");
      const auditJobId = (run.data as any).jobId;
      expect(auditJobId).not.toBe(preseedJobId);

      const jobs = await daemon.jobsList(root);
      const preseedRecord = (jobs.data as any).jobs.find((record: any) => record.job.jobId === preseedJobId);
      expect(preseedRecord).toBeDefined();
      // The pre-seeded job must be untouched: still queued, never leased by the audit claim.
      expect(preseedRecord.job.status).toBe("queued");
      expect(preseedRecord.leaseOwner).toBeUndefined();

      const auditRecord = (jobs.data as any).jobs.find((record: any) => record.job.jobId === auditJobId);
      expect(auditRecord).toBeDefined();
      expect(auditRecord.job.status).toBe("succeeded");
      expect(auditRecord.leaseOwner).toBeUndefined();
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit run binds the investigation transport's cwd to the audited repository root", async () => {
    const root = createGitRepo();
    writeAuditManifest(root, true);
    const store = new TestLocalStore();
    let capturedCwd: string | undefined;
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T02:57:00.000Z",
        investigationTransport: async (input: CommandInvestigationRunnerTransportInput) => {
          capturedCwd = input.cwd;
          const separatorIndex = input.stdin.lastIndexOf("\n\n");
          const runnerInput = JSON.parse(separatorIndex === -1 ? input.stdin : input.stdin.slice(separatorIndex + 2));
          const jobId = runnerInput.job.jobId as string;
          const report = {
            schemaVersion: INVESTIGATION_REPORT_SCHEMA_VERSION,
            reportId: `investigation_report.cwd_test_${jobId.slice(-8)}`,
            jobId,
            status: "succeeded",
            findings: [],
            outputDigest: digestJson({ jobId } as unknown as Json),
            createdAt: "2026-06-25T02:57:03.000Z",
            directMutationAllowed: false,
            extensions: {}
          };
          return { exitCode: 0, stdout: JSON.stringify({ report }) };
        }
      });

      const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(run.ok).toBe(true);
      expect(capturedCwd).toBeDefined();
      expectSameExistingPath(capturedCwd!, root);
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit run defaults to async: returns started immediately and the run reaches pending in the background, observable via audit list", async () => {
    const root = createGitRepo();
    writeAuditManifest(root, true);
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-07-05T06:00:00.000Z",
        investigationTransport: async (input: CommandInvestigationRunnerTransportInput) => {
          const separatorIndex = input.stdin.lastIndexOf("\n\n");
          const runnerInput = JSON.parse(separatorIndex === -1 ? input.stdin : input.stdin.slice(separatorIndex + 2));
          const jobId = runnerInput.job.jobId as string;
          const report = {
            schemaVersion: INVESTIGATION_REPORT_SCHEMA_VERSION,
            reportId: `investigation_report.async_test_${jobId.slice(-8)}`,
            jobId,
            status: "succeeded",
            findings: [],
            outputDigest: digestJson({ jobId } as unknown as Json),
            createdAt: "2026-07-05T06:00:03.000Z",
            directMutationAllowed: false,
            extensions: {}
          };
          return { exitCode: 0, stdout: JSON.stringify({ report }) };
        }
      });

      // No `wait: true`: the RPC call itself must resolve immediately with "started", never
      // blocking for the full (here fake, but in production 10-25 minute) investigation.
      const started = await daemon.auditRun(root, { timeoutMs: 5_000 });
      expect(started.ok).toBe(true);
      expect((started.data as any).status).toBe("started");
      expect((started.data as any).jobId).toBeDefined();
      // No runId yet: a runId is only assigned once the ledger append happens, which only
      // happens after the (still in-flight, backgrounded) investigation completes.
      expect((started.data as any).runId).toBeUndefined();
      const jobId = (started.data as any).jobId as string;

      // Poll audit list the same way the CLI does, until the detached background drive settles.
      let match: any;
      for (let attempt = 0; attempt < 200 && !match; attempt += 1) {
        const list = await daemon.auditList(root);
        match = ((list.data as any)?.runs ?? []).find((run: any) => run.jobId === jobId);
        if (!match) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(match).toBeDefined();
      expect(match.status).toBe("pending");

      const show = await daemon.auditShow(root, match.runId);
      expect(show.ok).toBe(true);
      expect((show.data as any).run.jobId).toBe(jobId);
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit run with wait: true keeps the original fully-synchronous contract", async () => {
    const root = createGitRepo();
    writeAuditManifest(root, true);
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-07-05T06:10:00.000Z",
        investigationTransport: async () => ({ exitCode: 1, stdout: "", stderr: "claude not installed" })
      });

      const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(run.ok).toBe(true);
      // Resolves directly to a terminal status, not "started" — wait: true never leaves anything
      // to poll for.
      expect((run.data as any).status).toBe("failed");
      expect((run.data as any).runId).toBeDefined();
    } finally {
      removeTempRepo(root);
    }
  });

  test("daemon stop aborts an in-flight audit run's investigation transport signal", async () => {
    const root = createGitRepo();
    writeAuditManifest(root, true);
    const store = new TestLocalStore();
    let capturedSignal: AbortSignal | undefined;
    let notifyTransportStarted: (() => void) | undefined;
    const transportStarted = new Promise<void>((resolve) => {
      notifyTransportStarted = resolve;
    });
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-07-05T07:00:00.000Z",
        investigationTransport: (input: CommandInvestigationRunnerTransportInput) => {
          capturedSignal = input.signal;
          notifyTransportStarted?.();
          // Simulates a real long-running `claude` subprocess: never resolves on its own, only in
          // response to the daemon aborting it (exactly what `stop()` below is expected to do).
          return new Promise<CommandInvestigationRunnerTransportResult>((_resolve, reject) => {
            input.signal?.addEventListener("abort", () => reject(new Error("investigation-runner-aborted")), { once: true });
          });
        }
      });

      const started = await daemon.auditRun(root, { timeoutMs: 60_000 });
      expect(started.ok).toBe(true);
      expect((started.data as any).status).toBe("started");

      await transportStarted;
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal!.aborted).toBe(false);

      await daemon.stop();

      // The one property `stop()` guarantees unconditionally: every in-flight audit's transport
      // signal is aborted (which, in the real node transport, kills the child process), so nothing
      // is ever left running orphaned past the daemon's own lifetime. Whether the resulting failed
      // run finishes being recorded before the store closes is a separate, best-effort race (see
      // the comment on `stop()` in src/index.ts) and is intentionally not asserted here.
      expect(capturedSignal!.aborted).toBe(true);
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit run job survives a concurrent stale-cancel sweep via advisory-only-on-stale, while a default-policy hook job in the same sweep still gets cancelled", async () => {
    const root = createGitRepo();
    writeAuditManifest(root, true);
    const store = new TestLocalStore();
    let sweepExpiredJobIds: string[] = [];
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-07-05T05:00:00.000Z",
        investigationTransport: async (input: CommandInvestigationRunnerTransportInput) => {
          // Simulate a concurrent git-hook enqueue racing in while the audit job is still
          // "running" — e.g. the audited repository's own untracked .archcontext/ content
          // shifting mid-flight (the exact e2e-observed trigger for F2). This bumps the worktree
          // digest and drives jobsEnqueueGitHook's own cancelStaleRuntimeAgentJobs sweep against
          // every queued/running job in scope, including the in-flight audit job itself.
          mkdirSync(join(root, "src"), { recursive: true });
          writeFileSync(join(root, "src", "concurrent-change.ts"), "export const concurrent = true;\n", "utf8");
          const sweep = await daemon.jobsEnqueueGitHook(root, {
            source: "worktree",
            event: "concurrent-sweep",
            analysisKind: "architecture-delta",
            risk: "high",
            uncertainty: "high",
            coalesceKey: "coalesce.stale-cancel-sweep"
          });
          expect((sweep.data as any).enqueued).toBe(true);
          sweepExpiredJobIds = (sweep.data as any).expiredJobIds as string[];

          const separatorIndex = input.stdin.lastIndexOf("\n\n");
          const runnerInput = JSON.parse(separatorIndex === -1 ? input.stdin : input.stdin.slice(separatorIndex + 2));
          const jobId = runnerInput.job.jobId as string;
          const report = {
            schemaVersion: INVESTIGATION_REPORT_SCHEMA_VERSION,
            reportId: `investigation_report.stale_cancel_test_${jobId.slice(-8)}`,
            jobId,
            status: "succeeded",
            findings: [],
            outputDigest: digestJson({ jobId } as unknown as Json),
            createdAt: "2026-07-05T05:00:03.000Z",
            directMutationAllowed: false,
            extensions: {}
          };
          return { exitCode: 0, stdout: JSON.stringify({ report }) };
        }
      });

      // Pre-seed a normal git-hook job (default stalePolicy: cancel-on-head-change) so it is
      // still "queued" — and already stale relative to the repository state at the time of the
      // concurrent sweep above — when that sweep runs.
      mkdirSync(join(root, "docs"), { recursive: true });
      writeFileSync(join(root, "docs", "pre-existing-change.md"), "# pre-existing\n", "utf8");
      const preseedEnqueue = await daemon.jobsEnqueueGitHook(root, {
        source: "worktree",
        event: "post-edit",
        analysisKind: "architecture-delta",
        risk: "high",
        uncertainty: "high",
        coalesceKey: "coalesce.stale-cancel-preseed"
      });
      expect((preseedEnqueue.data as any).enqueued).toBe(true);
      const hookJobId = (preseedEnqueue.data as any).record.job.jobId as string;

      const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(run.ok).toBe(true);
      expect((run.data as any).status).toBe("pending");
      const auditJobId = (run.data as any).jobId as string;

      // The audit job must survive the concurrent sweep (advisory-only-on-stale)...
      expect(sweepExpiredJobIds).not.toContain(auditJobId);
      // ...while the pre-seeded hook job (default cancel-on-head-change) is cancelled by the same
      // sweep, proving this is a policy-specific fix, not a blanket "never cancel" regression.
      expect(sweepExpiredJobIds).toContain(hookJobId);

      const jobs = await daemon.jobsList(root);
      const hookRecord = (jobs.data as any).jobs.find((record: any) => record.job.jobId === hookJobId);
      expect(hookRecord).toBeDefined();
      expect(hookRecord.job.status).toBe("expired");
      const auditRecord = (jobs.data as any).jobs.find((record: any) => record.job.jobId === auditJobId);
      expect(auditRecord).toBeDefined();
      expect(auditRecord.job.status).toBe("succeeded");
    } finally {
      removeTempRepo(root);
    }
  });

  test("ADR-0042 red line: the investigation runner never has a path to the github issue executor; only audit approve does", async () => {
    const { executor, calls } = fakeGithubIssueExecutor();
    const transportCalls: CommandInvestigationRunnerTransportInput[] = [];
    const root = createGitRepo();
    addGitRemote(root, "https://github.com/acme/widgets.git");
    writeAuditManifest(root, true);
    const store = new TestLocalStore();
    const draftRecords = [auditDraftRecord()];
    const now = "2026-07-05T01:00:00.000Z";
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => now,
        githubIssueExecutor: executor,
        investigationTransport: async (input: CommandInvestigationRunnerTransportInput) => {
          transportCalls.push(input);
          return auditInvestigationTransportWithDrafts(draftRecords, now)(input);
        }
      });

      const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect(run.ok).toBe(true);
      expect((run.data as any).status).toBe("pending");
      const runId = (run.data as any).runId as string;

      // The runner's own transport call used the exact ADR-0041 read-only claude invocation shape
      // (proving this really went through the same locked-down subagent path this codebase always
      // uses), and throughout the entire auditRun call the gh executor was never touched at all —
      // it is a separate injected dependency the investigation runner has no reference to.
      expect(transportCalls).toHaveLength(1);
      expect(transportCalls[0]!.command).toBe("claude");
      expect(transportCalls[0]!.args).toContain("--strict-mcp-config");
      expect(calls.repoView).toHaveLength(0);
      expect(calls.listRecentIssues).toHaveLength(0);
      expect(calls.createIssue).toHaveLength(0);

      // Reading the pending run back (list/show) is also gh-free: an unapproved run never
      // touches the executor no matter how many times it is read.
      await daemon.auditList(root);
      await daemon.auditShow(root, runId);
      expect(calls.repoView).toHaveLength(0);
      expect(calls.listRecentIssues).toHaveLength(0);
      expect(calls.createIssue).toHaveLength(0);

      // Only auditApprove reaches the executor.
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const approve = await daemon.auditApprove(root, { runId });
        expect(approve.ok).toBe(true);
      });
      expect(calls.repoView.length).toBeGreaterThan(0);
      expect(calls.createIssue.length).toBeGreaterThan(0);
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit approve is gated by audit.githubIssues.enabled, distinct from audit run's own gate, zero gh calls when disabled", async () => {
    const { executor, calls } = fakeGithubIssueExecutor();
    const root = createGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({ localStore: store, githubIssueExecutor: executor });
      const result = await daemon.auditApprove(root, { runId: "audit_run.does_not_matter" });
      expect(result.ok).toBe(false);
      expect((result as any).error.code).toBe("AC_CAPABILITY_UNSUPPORTED");
      expect(calls.repoView).toHaveLength(0);
      expect(calls.createIssue).toHaveLength(0);
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit approve rejects a repository with no resolvable git remote before any gh call", async () => {
    const { executor, calls } = fakeGithubIssueExecutor();
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor });
    try {
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const result = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(result.ok).toBe(false);
        expect((result as any).error.code).toBe("AC_PRECONDITION_FAILED");
        expect((result as any).error.message).toContain("resolvable GitHub owner/repo");
      });
      expect(calls.repoView).toHaveLength(0);
      expect(calls.createIssue).toHaveLength(0);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("audit approve requires ARCHCONTEXT_GH_ISSUES_TOKEN and never falls back to ambient gh auth", async () => {
    const { executor, calls } = fakeGithubIssueExecutor();
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git" });
    try {
      await withAuditApproveToken(undefined, async () => {
        const result = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(result.ok).toBe(false);
        expect((result as any).error.code).toBe("AC_PRECONDITION_FAILED");
        expect((result as any).error.message).toContain("ARCHCONTEXT_GH_ISSUES_TOKEN");
      });
      expect(calls.repoView).toHaveLength(0);
      expect(calls.createIssue).toHaveLength(0);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("audit approve fails closed when the repository visibility probe fails, zero issues created", async () => {
    const { executor, calls } = fakeGithubIssueExecutor({ repoViewError: new Error("gh repo view: network unreachable") });
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git" });
    try {
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const result = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(result.ok).toBe(false);
        expect((result as any).error.code).toBe("AC_PRECONDITION_FAILED");
        expect((result as any).error.message).toContain("visibility");
      });
      expect(calls.createIssue).toHaveLength(0);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("ADR-0042 red line: publishing to a public repository without a valid confirmation token never files an issue", async () => {
    const { executor, calls } = fakeGithubIssueExecutor({ visibility: "public" });
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git" });
    try {
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const withoutToken = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(withoutToken.ok).toBe(false);
        expect((withoutToken as any).error.code).toBe("AC_USER_CONFIRMATION_REQUIRED");
        expect((withoutToken as any).error.message).toContain("archctx audit approve");
        expect((withoutToken as any).error.message).toContain("--confirm-public-repo");

        const wrongToken = await fixture.daemon.auditApprove(fixture.root, {
          runId: fixture.runId,
          confirmPublicToken: "public:wrong/repo:0000000000000000000000000000000000000000:audit_run.wrong"
        });
        expect(wrongToken.ok).toBe(false);
        expect((wrongToken as any).error.code).toBe("AC_USER_CONFIRMATION_REQUIRED");
      });
      expect(calls.createIssue).toHaveLength(0);
      expect(calls.listRecentIssues).toHaveLength(0);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("audit approve publishes to a public repository once the exact confirmation token from the error message is supplied", async () => {
    const { executor, calls } = fakeGithubIssueExecutor({ visibility: "public" });
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git" });
    try {
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const rejected = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(rejected.ok).toBe(false);
        const tokenMatch = /--confirm-public-repo (\S+)/.exec((rejected as any).error.message);
        expect(tokenMatch).not.toBeNull();
        const token = tokenMatch![1]!;
        expect(token).toMatch(/^public:acme\/widgets:[0-9a-f]+:audit_run\./);

        const approved = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId, confirmPublicToken: token });
        expect(approved.ok).toBe(true);
        expect((approved.data as any).status).toBe("issued");
        expect((approved.data as any).issuedCount).toBe(fixture.draftRecords.length);
      });
      expect(calls.createIssue).toHaveLength(fixture.draftRecords.length);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("audit approve rejects a run whose drafts no longer match the recorded ledger digests, zero gh calls", async () => {
    const { executor, calls } = fakeGithubIssueExecutor();
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git" });
    try {
      const pendingEvent = fixture.store.architectureEvents.find((event) => event.eventType === "architecture.agent_audit.run_pending");
      expect(pendingEvent).toBeDefined();
      // Directly corrupt the ledger's recorded digest set (simulating drift between what the
      // ledger recorded at "audit run" time and what the completed job's proposal plan currently
      // says) rather than tamper the plan itself, so this exercises auditApprove's own
      // cross-check rather than validateRuntimeAgentProposalPlan's pre-existing digest checks.
      (pendingEvent!.payload as any).auditRuns[0].issueDraftDigests = [`sha256:${"9".repeat(64)}`];

      await withAuditApproveToken("gh_pat_test_token", async () => {
        const result = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(result.ok).toBe(false);
        expect((result as any).error.code).toBe("AC_SCHEMA_INVALID");
        expect((result as any).error.message).toContain("no longer match");
      });
      expect(calls.repoView).toHaveLength(0);
      expect(calls.createIssue).toHaveLength(0);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("audit approve aborts the entire batch when any draft matches a secret-shaped pattern", async () => {
    const { executor, calls } = fakeGithubIssueExecutor();
    const draftRecords = [
      auditDraftRecord({ title: "Draft One" }),
      auditDraftRecord({ title: "Draft Two", bodyMarkdown: "Rotate the leaked token ghp_abcdefghijklmnopqrstuvwxyz0123456789 immediately.\n" })
    ];
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git", draftRecords });
    try {
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const result = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(result.ok).toBe(false);
        expect((result as any).error.code).toBe("AC_PRECONDITION_FAILED");
        expect((result as any).error.message).toContain("secret-shaped");
      });
      expect(calls.createIssue).toHaveLength(0);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("audit approve rejects a draft whose body exceeds the GitHub issue length limit before any gh call", async () => {
    const { executor, calls } = fakeGithubIssueExecutor();
    const draftRecords = [auditDraftRecord({ title: "Oversized draft", bodyMarkdown: "x".repeat(70_000) })];
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git", draftRecords });
    try {
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const result = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(result.ok).toBe(false);
        expect((result as any).error.code).toBe("AC_PRECONDITION_FAILED");
        expect((result as any).error.message).toContain("exceeding");
      });
      expect(calls.createIssue).toHaveLength(0);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("audit approve rejects a run whose investigation failed, zero gh calls", async () => {
    const { executor, calls } = fakeGithubIssueExecutor();
    const root = createGitRepo();
    addGitRemote(root, "https://github.com/acme/widgets.git");
    writeAuditManifest(root, true);
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        githubIssueExecutor: executor,
        clock: () => "2026-07-05T02:00:00.000Z",
        investigationTransport: async () => ({ exitCode: 1, stdout: "", stderr: "claude not installed" })
      });
      const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
      expect((run.data as any).status).toBe("failed");
      const runId = (run.data as any).runId as string;

      await withAuditApproveToken("gh_pat_test_token", async () => {
        const result = await daemon.auditApprove(root, { runId });
        expect(result.ok).toBe(false);
        expect((result as any).error.code).toBe("AC_PRECONDITION_FAILED");
        expect((result as any).error.message).toContain("failed during investigation");
      });
      expect(calls.repoView).toHaveLength(0);
      expect(calls.createIssue).toHaveLength(0);
    } finally {
      removeTempRepo(root);
    }
  });

  test("audit approve publishes every draft to a private repository in one call, records the footer marker, and is idempotent once issued", async () => {
    const { executor, calls } = fakeGithubIssueExecutor({ visibility: "private" });
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git" });
    try {
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const approve = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(approve.ok).toBe(true);
        expect(approve.data).toMatchObject({ runId: fixture.runId, status: "issued", issuedCount: 2, totalCount: 2 });
      });

      expect(calls.createIssue).toHaveLength(2);
      for (const call of calls.createIssue) {
        expect(call.bodyText).toContain("Filed by archctx audit");
        expect(call.bodyText).toContain(fixture.runId);
      }

      const show = await fixture.daemon.auditShow(fixture.root, fixture.runId);
      expect((show.data as any).run.status).toBe("issued");
      expect((show.data as any).run.issuedIssues).toHaveLength(2);

      const list = await fixture.daemon.auditList(fixture.root, { statuses: ["issued"] });
      expect((list.data as any).count).toBe(1);

      // Idempotent no-op: calling approve again on an already-issued run touches gh zero times.
      const repoViewCountBefore = calls.repoView.length;
      const createCountBefore = calls.createIssue.length;
      const again = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
      expect(again.ok).toBe(true);
      expect((again.data as any).status).toBe("issued");
      expect(calls.createIssue.length).toBe(createCountBefore);
      expect(calls.repoView.length).toBe(repoViewCountBefore);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("two concurrent audit approve calls on the same run never both publish: the daemon's single-writer lock rejects the loser before it reads run state", async () => {
    const draftRecords = [auditDraftRecord({ title: "Draft Alpha" }), auditDraftRecord({ title: "Draft Beta" })];
    const { executor, calls } = fakeGithubIssueExecutor({ visibility: "private" });
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git", draftRecords });
    try {
      await withAuditApproveToken("gh_pat_test_token", async () => {
        // Both calls are issued back-to-back with no `await` between them, so (per the ordinary
        // synchronous-prefix-of-an-async-function evaluation order the JS spec guarantees) the
        // first call always reaches the daemon's writer lock before the second call is even
        // constructed. Without a lock serializing auditApprove, both would race past the "pending"
        // read and each call createIssue once per draft (4 calls total for 2 drafts instead of 2).
        const [first, second] = await Promise.allSettled([
          fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId }),
          fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId })
        ]);

        const settled = [first, second];
        const fulfilled = settled.filter((entry): entry is PromiseFulfilledResult<JsonEnvelope> => entry.status === "fulfilled");
        const rejected = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");

        // Exactly one caller gets to run the approve flow; the other is rejected outright by the
        // writer lock (a clear, retryable failure) rather than silently reading stale state.
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(fulfilled[0]!.value.ok).toBe(true);
        expect(fulfilled[0]!.value.data).toMatchObject({ status: "issued", issuedCount: 2, totalCount: 2 });
        expect(String(rejected[0]!.reason)).toContain("runtime writer is locked");
      });

      // The concurrency bug this test guards against would have created every draft twice (once
      // per racing call); with the lock, each draft is published exactly once.
      expect(calls.createIssue).toHaveLength(draftRecords.length);
      const titles = calls.createIssue.map((call) => call.title);
      expect(new Set(titles).size).toBe(titles.length);

      const show = await fixture.daemon.auditShow(fixture.root, fixture.runId);
      expect((show.data as any).run.status).toBe("issued");
      expect((show.data as any).run.issuedIssues).toHaveLength(2);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("audit approve stops in issuing after a mid-flight failure, recording already-published drafts, and --resume completes the run", async () => {
    const draftRecords = [
      auditDraftRecord({ title: "Draft Alpha" }),
      auditDraftRecord({ title: "Draft Beta" }),
      auditDraftRecord({ title: "Draft Gamma" })
    ];
    // githubIssueDraftsFromReport canonicalizes draft processing order by content-addressed
    // draftId, not by this array's input order, so which title ends up "first"/"second" is not
    // knowable ahead of time. Fail the second `createIssue` attempt overall (whichever draft that
    // turns out to be) rather than matching by title, so this test is independent of that
    // canonical ordering.
    let attemptsSoFar = 0;
    const { executor, calls } = fakeGithubIssueExecutor({
      createIssueImpl: async () => {
        attemptsSoFar += 1;
        if (attemptsSoFar === 2) throw new Error("gh issue create: temporary failure");
        const number = 6000 + calls.createIssue.length;
        return { number, url: `https://github.com/acme/widgets/issues/${number}` };
      }
    });
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git", draftRecords });
    try {
      let firstSucceededTitle = "";
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const firstAttempt = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(firstAttempt.ok).toBe(false);
        expect((firstAttempt as any).error.code).toBe("AC_PRECONDITION_FAILED");
        expect((firstAttempt as any).error.message).toContain("--resume");
        expect(calls.createIssue).toHaveLength(2);
        firstSucceededTitle = calls.createIssue[0]!.title;

        const stuck = await fixture.daemon.auditShow(fixture.root, fixture.runId);
        expect((stuck.data as any).run.status).toBe("issuing");
        expect((stuck.data as any).run.issuedIssues).toHaveLength(1);

        const withoutResume = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(withoutResume.ok).toBe(false);
        expect((withoutResume as any).error.code).toBe("AC_PRECONDITION_FAILED");
        expect((withoutResume as any).error.message).toContain("--resume");
        expect(calls.createIssue).toHaveLength(2);

        const resumed = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId, resume: true });
        expect(resumed.ok).toBe(true);
        expect(resumed.data).toMatchObject({ status: "issued", issuedCount: 3, totalCount: 3 });
      });

      const finalShow = await fixture.daemon.auditShow(fixture.root, fixture.runId);
      expect((finalShow.data as any).run.status).toBe("issued");
      expect((finalShow.data as any).run.issuedIssues).toHaveLength(3);
      // The draft that succeeded before the crash point was never re-created on resume.
      const firstDraftCreateCalls = calls.createIssue.filter((call) => call.title === firstSucceededTitle).length;
      expect(firstDraftCreateCalls).toBe(1);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("audit approve reuses an already-filed issue found via footer-marker dedup instead of re-publishing", async () => {
    const draftRecords = [auditDraftRecord({ title: "Draft Solo" })];
    const { executor, calls, existingIssues } = fakeGithubIssueExecutor();
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git", draftRecords });
    try {
      const show = await fixture.daemon.auditShow(fixture.root, fixture.runId);
      const draftDigest = (show.data as any).githubIssueDrafts[0].draftDigest as string;
      // Simulate a prior daemon crash: gh issue create already succeeded (issue #7777) but the
      // ledger progress event was never appended, so run.issuedIssues going into this call is
      // still empty; only the footer marker on the already-filed issue proves it was published.
      existingIssues.push({
        number: 7777,
        url: "https://github.com/acme/widgets/issues/7777",
        body: `Some existing body.\n\n${githubIssueFooterMarker(fixture.runId, draftDigest)}\n`
      });

      await withAuditApproveToken("gh_pat_test_token", async () => {
        const approve = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(approve.ok).toBe(true);
        expect((approve.data as any).issuedIssues[0]).toMatchObject({ number: 7777, url: "https://github.com/acme/widgets/issues/7777" });
      });
      expect(calls.createIssue).toHaveLength(0);
      expect(calls.listRecentIssues.length).toBeGreaterThan(0);
    } finally {
      removeTempRepo(fixture.root);
    }
  });

  test("audit approve rejects when the crash-recovery dedup listing itself fails (fail-closed, inconclusive)", async () => {
    const { executor, calls } = fakeGithubIssueExecutor({ listRecentIssuesError: new Error("gh issue list: rate limited") });
    const fixture = await createPendingApproveFixture({ githubIssueExecutor: executor, remoteUrl: "https://github.com/acme/widgets.git" });
    try {
      await withAuditApproveToken("gh_pat_test_token", async () => {
        const result = await fixture.daemon.auditApprove(fixture.root, { runId: fixture.runId });
        expect(result.ok).toBe(false);
        expect((result as any).error.code).toBe("AC_PRECONDITION_FAILED");
        expect((result as any).error.message).toContain("inconclusive");
      });
      expect(calls.createIssue).toHaveLength(0);
    } finally {
      removeTempRepo(fixture.root);
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
    const root = tempRepo();
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
      writeFileSync(join(root, "docs/architecture/.projection-manifest.json"), "{}\n", "utf8");
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
        "archcontext.docs-renderer/v1",
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
        "schemaVersion: archcontext.node/v1",
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
          body: "schemaVersion: archcontext.node/v1\nid: module.dual-ledger\nkind: module\nname: Dual Ledger\nstatus: active\nsummary: Dual ledger node\n"
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
      expect(JSON.stringify(event.payload)).not.toContain("schemaVersion: archcontext.node/v1");
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
          body: "schemaVersion: archcontext.node/v1\nid: module.stale-worktree\nkind: module\nname: Stale Worktree\nstatus: active\nsummary: Stale worktree\n"
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
          body: "schemaVersion: archcontext.node/v1\nid: module.stale-head\nkind: module\nname: Stale Head\nstatus: active\nsummary: Stale head\n"
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
          body: "schemaVersion: archcontext.node/v1\nid: module.stale-model\nkind: module\nname: Stale Model\nstatus: active\nsummary: Stale model\n"
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
          body: "schemaVersion: archcontext.node/v1\nid: module.ledger-projection\nkind: module\nname: Ledger Projection\nstatus: active\nsummary: Ledger projection node\n"
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
          body: "schemaVersion: archcontext.node/v1\nid: module.dual-rollback\nkind: module\nname: Dual Rollback\nstatus: active\nsummary: Dual rollback node\n"
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
          body: "schemaVersion: archcontext.node/v1\nid: module.ledger-read\nkind: module\nname: Ledger Read\nstatus: active\nsummary: Ledger read node\n"
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
          body: "schemaVersion: archcontext.node/v1\nid: module.ledger-runtime-read\nkind: module\nname: Ledger Runtime Read\nstatus: active\nsummary: Runtime reads from ledger state\n"
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

  test("ledger project restores missing Git projection from SQLite current state", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        architectureLedger: { rolloutMode: "ledger-authoritative" },
        clock: () => "2026-06-25T04:05:00.000Z"
      });
      await daemon.init(root, "Ledger Project App");
      const path = ".archcontext/model/nodes/module.ledger-project.yaml";
      const plan = await daemon.planUpdate(root, {
        id: "changeset.ledger-project-node",
        operations: [{
          op: "create_entity",
          path,
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v1\nid: module.ledger-project\nkind: module\nname: Ledger Project\nstatus: active\nsummary: Ledger project node\n"
        }]
      });
      await daemon.applyUpdate(root, {
        id: "changeset.ledger-project-node",
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      });
      rmSync(join(root, path), { force: true });

      const drift = await daemon.ledgerDrift(root);
      expect((drift.data as any).drift.reasonCodes).toContain("projection-file-missing");
      expect((drift.data as any).reconcile.schemaVersion).toBe("archcontext.architecture-ledger-reconcile/v1");
      expect((drift.data as any).reconcile.ledgerToGit.reasonCodes).toContain("projection-file-missing");
      expect((drift.data as any).reconcile.gitToLedger.reasonCodes).toContain("semantic-drift");
      expect((drift.data as any).reconcile.reconcileActions.map((action: any) => action.authority)).toContain("ledger");
      const status = await daemon.runtimeStatus(root);
      const project = await daemon.ledgerProject(root, {
        dryRun: false,
        expectedWorktreeDigest: (status.data as any).worktreeDigest
      });

      expect(project.ok).toBe(true);
      expect((project.data as any).writes).toBe("git-projection");
      expect((project.data as any).writtenPaths).toContain(path);
      expect((project.data as any).reconcile.ok).toBe(true);
      expect(readText(join(root, path))).toContain("module.ledger-project");
      expect([...store.changeSetJournals.values()].some((journal) =>
        journal.status === "committed" && journal.files.some((file) => file.path === path)
      )).toBe(true);
      const cleanDrift = await daemon.ledgerDrift(root);
      expect((cleanDrift.data as any).drift.ok).toBe(true);
      expect((cleanDrift.data as any).reconcile.ok).toBe(true);
    } finally {
      removeTempRepo(root);
    }
  });

  test("ledger rollback restores YAML authority projection from SQLite current state with backup", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        architectureLedger: { rolloutMode: "ledger-authoritative" },
        clock: () => "2026-06-25T04:08:00.000Z"
      });
      await daemon.init(root, "Ledger Rollback App");
      const path = ".archcontext/model/nodes/module.ledger-rollback.yaml";
      const stalePath = ".archcontext/model/nodes/module.rollback-stale.yaml";
      const plan = await daemon.planUpdate(root, {
        id: "changeset.ledger-rollback-node",
        operations: [{
          op: "create_entity",
          path,
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v1\nid: module.ledger-rollback\nkind: module\nname: Ledger Rollback\nstatus: active\nsummary: Ledger rollback node\n"
        }]
      });
      await daemon.applyUpdate(root, {
        id: "changeset.ledger-rollback-node",
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      });
      writeFileSync(join(root, path), "schemaVersion: archcontext.node/v1\nid: module.ledger-rollback\nkind: module\nname: Ledger Rollback\nstatus: active\nsummary: Corrupted rollback projection\n", "utf8");
      writeFileSync(join(root, stalePath), "schemaVersion: archcontext.node/v1\nid: module.rollback-stale\nkind: module\nname: Stale Rollback\nstatus: active\nsummary: Stale rollback projection\n", "utf8");

      const dryRun = await daemon.ledgerRollback(root, { toYaml: true, dryRun: true });
      expect(dryRun.ok).toBe(true);
      expect((dryRun.data as any).dryRun).toBe(true);
      expect((dryRun.data as any).writes).toBe("none");
      expect((dryRun.data as any).drift.ok).toBe(false);
      expect(existsSync(join(root, stalePath))).toBe(true);

      const status = await daemon.runtimeStatus(root);
      const rollback = await daemon.ledgerRollback(root, {
        toYaml: true,
        dryRun: false,
        expectedWorktreeDigest: (status.data as any).worktreeDigest
      });

      expect(rollback.ok).toBe(true);
      expect((rollback.data as any).targetAuthority).toBe("yaml");
      expect((rollback.data as any).recommendedEnvironment).toMatchObject({ ARCHCONTEXT_LEDGER_MODE: "yaml" });
      expect((rollback.data as any).removedPaths).toContain(stalePath);
      expect((rollback.data as any).writtenPaths).toContain(path);
      expect((rollback.data as any).drift.ok).toBe(true);
      const backup = (rollback.data as any).backup;
      expect(backup.path).toMatch(/\.archcontext\/backups\/ledger-rollback\//);
      expect(existsSync(join(root, backup.manifestPath))).toBe(true);
      expect(readText(join(root, backup.path, "model/nodes/module.ledger-rollback.yaml"))).toContain("Corrupted rollback projection");
      expect(readText(join(root, backup.path, "model/nodes/module.rollback-stale.yaml"))).toContain("Stale rollback projection");
      expect(readText(join(root, path))).toContain("Ledger rollback node");
      expect(existsSync(join(root, stalePath))).toBe(false);
      expect([...store.changeSetJournals.values()].some((journal) =>
        journal.status === "committed"
        && journal.files.some((file) => file.path === stalePath && file.operation === "delete_entity")
        && journal.files.some((file) => file.path.includes(".archcontext/backups/ledger-rollback/"))
      )).toBe(true);

      const yamlDaemon = await createStartedTestDaemon({
        architectureLedger: { rolloutMode: "yaml" },
        localStore: new TestLocalStore()
      });
      expect((await yamlDaemon.validate(root)).ok).toBe(true);
    } finally {
      removeTempRepo(root);
    }
  });

  test("ledger migrate write creates a backup, verifies replay, and advertises safe downgrade", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        architectureLedger: { rolloutMode: "yaml" },
        clock: () => "2026-06-26T08:00:00.000Z"
      });
      await daemon.init(root, "Ledger Migrate App");

      const dryRun = await daemon.ledgerMigrate(root, { fromYaml: true, dryRun: true });
      expect(dryRun.ok).toBe(true);
      expect((dryRun.data as any)).toMatchObject({
        schemaVersion: "archcontext.runtime-architecture-ledger-migrate/v1",
        status: "planned",
        dryRun: true,
        writes: "none",
        backup: { status: "not-created", reason: "dry-run" },
        append: { status: "not-applied" },
        verification: { status: "not-run", reason: "dry-run" }
      });
      expect((dryRun.data as any).architectureLedger.phaseFlags.safeDowngrade.environment).toMatchObject({
        ARCHCONTEXT_LEDGER_MODE: "yaml"
      });

      const status = await daemon.runtimeStatus(root);
      const migrated = await daemon.ledgerMigrate(root, {
        fromYaml: true,
        dryRun: false,
        expectedWorktreeDigest: (status.data as any).worktreeDigest
      });

      expect(migrated.ok).toBe(true);
      expect((migrated.data as any)).toMatchObject({
        schemaVersion: "archcontext.runtime-architecture-ledger-migrate/v1",
        status: "verified",
        dryRun: false,
        writes: "architecture-ledger",
        backup: {
          schemaVersion: "archcontext.runtime-architecture-ledger-sqlite-backup/v1",
          status: "created",
          integrity: "ok"
        },
        append: {
          status: "appended",
          appendedEventCount: 1
        },
        verification: {
          schemaVersion: "archcontext.runtime-architecture-ledger-migration-verification/v1",
          ok: true,
          driftOk: true,
          reconcileOk: true
        },
        recommendedEnvironment: {
          ARCHCONTEXT_LEDGER_MODE: "dual"
        }
      });
      expect(existsSync((migrated.data as any).backup.backupPath)).toBe(true);
      expect((migrated.data as any).rollback).toMatchObject({
        command: "archctx ledger rollback --to-yaml --write --expected-worktree-digest <current>",
        safeDowngradeEnvironment: {
          ARCHCONTEXT_LEDGER_MODE: "yaml"
        }
      });
      expect((migrated.data as any).verification.graphDigest).toBe((migrated.data as any).graphDigest);
      expect(store.architectureEventAppends.at(-1)?.events[0]?.eventType).toBe("architecture.yaml.import");
    } finally {
      removeTempRepo(root);
    }
  });

  test("ledger rebuild from Git appends once and no-ops when current state already matches Git", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-25T04:10:00.000Z"
      });
      await daemon.init(root, "Ledger Rebuild App");
      const status = await daemon.runtimeStatus(root);
      const first = await daemon.ledgerRebuild(root, {
        fromGit: true,
        expectedWorktreeDigest: (status.data as any).worktreeDigest
      });
      const second = await daemon.ledgerRebuild(root, {
        fromGit: true,
        expectedWorktreeDigest: (status.data as any).worktreeDigest
      });

      expect(first.ok).toBe(true);
      expect((first.data as any).appendedEventCount).toBe(1);
      expect((first.data as any).graphDigest).toMatch(/^sha256:/);
      expect((second.data as any).appendedEventCount).toBe(0);
      expect((second.data as any).duplicateEventCount).toBe(0);
      expect(((await daemon.ledgerState(root)).data as any).yaml.importedCount).toBeGreaterThan(0);
    } finally {
      removeTempRepo(root);
    }
  });

  test("ledger rebuild from Git proposes external projection changes before explicit reconcile", async () => {
    const root = tempRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        architectureLedger: { rolloutMode: "ledger-authoritative" },
        clock: () => "2026-06-25T04:15:00.000Z"
      });
      await daemon.init(root, "Ledger Delete Rebuild App");
      const path = ".archcontext/model/nodes/module.rebuild-delete.yaml";
      const plan = await daemon.planUpdate(root, {
        id: "changeset.rebuild-delete-node",
        operations: [{
          op: "create_entity",
          path,
          expectedHash: "missing",
          body: "schemaVersion: archcontext.node/v1\nid: module.rebuild-delete\nkind: module\nname: Rebuild Delete\nstatus: active\nsummary: Rebuild delete node\n"
        }]
      });
      await daemon.applyUpdate(root, {
        id: "changeset.rebuild-delete-node",
        approved: true,
        expectedWorktreeDigest: (plan.data as any).draft.base.worktreeDigest
      });
      expect(((await daemon.ledgerState(root)).data as any).state.entities.map((entity: any) => entity.entityId)).toContain("module.rebuild-delete");

      rmSync(join(root, path), { force: true });
      const status = await daemon.runtimeStatus(root);
      const proposed = await daemon.ledgerRebuild(root, {
        fromGit: true,
        expectedWorktreeDigest: (status.data as any).worktreeDigest
      });

      expect(proposed.ok).toBe(true);
      expect((proposed.data as any).status).toBe("external-projection-proposed");
      expect((proposed.data as any).reconcileRequired).toBe(true);
      expect((proposed.data as any).appendedEventCount).toBe(1);
      expect((proposed.data as any).proposedExternalProjectionChange).toMatchObject({
        baseGraphDigest: expect.stringMatching(/^sha256:/),
        proposedGraphDigest: expect.stringMatching(/^sha256:/)
      });
      expect(((await daemon.ledgerState(root)).data as any).state.entities.map((entity: any) => entity.entityId)).toContain("module.rebuild-delete");

      const accepted = await daemon.ledgerRebuild(root, {
        fromGit: true,
        acceptExternalProjection: true,
        expectedWorktreeDigest: (status.data as any).worktreeDigest
      });
      expect(accepted.ok).toBe(true);
      expect((accepted.data as any).status).toBe("external-projection-accepted");
      expect(((await daemon.ledgerState(root)).data as any).state.entities.map((entity: any) => entity.entityId)).not.toContain("module.rebuild-delete");
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

  test("prepares Developer Review from Challenge head in a detached clean worktree", async () => {
    const root = createGitRepo();
    const tempRoot = mkdtempSync(join(tmpdir(), "archctx-runtime-worktrees-"));
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    let worktree: NonNullable<ReturnType<Awaited<ReturnType<typeof createStartedTestDaemon>>["prepareDeveloperReviewWorktree"]>["worktree"]> | undefined;
    try {
      daemon = await createStartedTestDaemon();
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const headTreeOid = gitOut(root, "rev-parse", "HEAD^{tree}");
      writeFileSync(join(root, "README.md"), "# dirty source checkout\n", "utf8");

      const prepared = daemon.prepareDeveloperReviewWorktree({
        repositoryRoot: root,
        challenge: {
          schemaVersion: "archcontext.review-challenge/v2",
          challengeId: "chal_runtime_worktree",
          installationId: 123,
          repositoryId: 456,
          pullRequestNumber: 7,
          headSha,
          baseSha: headSha,
          nonce: "nonce_runtime_worktree",
          requiredTrust: "developer",
          policyProfileId: "policy.default",
          createdAt: "2026-06-20T00:00:00.000Z",
          expiresAt: "2026-06-20T00:15:00.000Z",
          status: "LEASED"
        },
        expectedHeadTreeOid: headTreeOid,
        tempRoot
      });

      expect(prepared.accepted).toBe(true);
      worktree = prepared.worktree;
      expect(worktree?.headSha).toBe(headSha);
      expect(worktree?.headTreeOid).toBe(headTreeOid);
      expect(worktree?.detached).toBe(true);
      expect(worktree?.clean).toBe(true);
      expect(readText(join(worktree!.worktreeRoot, "README.md"))).toBe("# fixture\n");
      expect(gitOut(worktree!.worktreeRoot, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");

      const mismatch = daemon.prepareDeveloperReviewWorktree({
        repositoryRoot: root,
        challenge: {
          ...preparedChallenge(headSha),
          headSha: "d".repeat(40)
        },
        tempRoot
      });
      expect(mismatch).toMatchObject({ accepted: false, reasonCode: "HEAD_UNAVAILABLE" });
    } finally {
      if (worktree) removeDetachedReviewWorktree(worktree);
      await daemon?.stop().catch(() => undefined);
      removeTempPath(tempRoot);
      removeTempRepo(root);
    }
  }, DEVELOPER_REVIEW_TEST_TIMEOUT_MS);

  test("computes Developer Review digest bundle from detached worktree model policy codefacts and runtime", async () => {
    const root = createInitializedGitRepo();
    const tempRoot = mkdtempSync(join(tmpdir(), "archctx-runtime-digests-"));
    const provider = new MockCodeGraphProvider();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    let worktree: NonNullable<ReturnType<Awaited<ReturnType<typeof createStartedTestDaemon>>["prepareDeveloperReviewWorktree"]>["worktree"]> | undefined;
    try {
      daemon = await createStartedTestDaemon({ codeFacts: new CodeGraphAdapter(provider) });
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const challenge = preparedChallenge(headSha);
      const prepared = daemon.prepareDeveloperReviewWorktree({
        repositoryRoot: root,
        challenge,
        expectedHeadTreeOid: gitOut(root, "rev-parse", "HEAD^{tree}"),
        tempRoot
      });
      expect(prepared.accepted).toBe(true);
      worktree = prepared.worktree;

      const bundle = await daemon.computeDeveloperReviewDigestBundle({ challenge, worktree: worktree! });

      expect(bundle).toMatchObject({
        schemaVersion: "archcontext.developer-review-digest-bundle/v1",
        challengeId: challenge.challengeId,
        repositoryId: challenge.repositoryId,
        headSha,
        headTreeOid: worktree!.headTreeOid,
        runtime: {
          version: ARCHCONTEXT_PRODUCT_VERSION,
          codeGraphVersion: REQUIRED_CODEGRAPH_VERSION
        }
      });
      expect(bundle.worktreeDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(bundle.modelDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(bundle.policyDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(bundle.codeFactsDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(bundle.runtime.buildDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(bundle.runtime.capabilitiesDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(provider.indexedRoots).toEqual([worktree!.worktreeRoot]);
      expect(JSON.stringify(bundle)).not.toContain("policy.review");
      expect(JSON.stringify(bundle)).not.toContain("Digest App");

      writeFileSync(join(worktree!.worktreeRoot, "README.md"), "# dirty detached worktree\n", "utf8");
      await expect(daemon.computeDeveloperReviewDigestBundle({ challenge, worktree: worktree! })).rejects.toThrow("WORKTREE_NOT_CLEAN");
    } finally {
      if (worktree) removeDetachedReviewWorktree(worktree);
      await daemon?.stop().catch(() => undefined);
      removeTempPath(tempRoot);
      removeTempRepo(root);
    }
  }, DEVELOPER_REVIEW_TEST_TIMEOUT_MS);

  test("runs deterministic Developer Review inside detached worktree and persists the local result", async () => {
    const root = createInitializedGitRepo();
    const tempRoot = mkdtempSync(join(tmpdir(), "archctx-runtime-review-"));
    const provider = new MockCodeGraphProvider();
    const store = new TestLocalStore();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    let worktree: NonNullable<ReturnType<Awaited<ReturnType<typeof createStartedTestDaemon>>["prepareDeveloperReviewWorktree"]>["worktree"]> | undefined;
    try {
      daemon = await createStartedTestDaemon({ codeFacts: new CodeGraphAdapter(provider), localStore: store });
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const challenge = preparedChallenge(headSha);
      const prepared = daemon.prepareDeveloperReviewWorktree({
        repositoryRoot: root,
        challenge,
        expectedHeadTreeOid: gitOut(root, "rev-parse", "HEAD^{tree}"),
        tempRoot
      });
      expect(prepared.accepted).toBe(true);
      worktree = prepared.worktree;

      const passed = await daemon.runDeveloperReviewSession({
        challenge,
        worktree: worktree!,
        taskSessionId: "task_developer_review_detached"
      });

      expect(passed).toMatchObject({
        schemaVersion: "archcontext.developer-review-session/v1",
        challengeId: challenge.challengeId,
        taskSessionId: "task_developer_review_detached",
        reviewResult: "pass",
        attestationResult: "pass",
        summary: { errors: 0, warnings: 0, notices: 0 }
      });
      expect(passed.reviewDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(passed.digests.worktreeDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(provider.indexedRoots).toEqual([worktree!.worktreeRoot]);
      expect(store.reviews.get(passed.reviewId)).toMatchObject({
        schemaVersion: "archcontext.review/v1",
        reviewId: passed.reviewId,
        taskSessionId: "task_developer_review_detached",
        result: "pass"
      });

      const failed = await daemon.runDeveloperReviewSession({
        challenge,
        worktree: worktree!,
        taskSessionId: "task_developer_review_cleanup",
        cleanupRequired: 1,
        cleanupCompleted: 0
      });
      expect(failed.reviewResult).toBe("fail_action_required");
      expect(failed.attestationResult).toBe("fail");
      expect(store.reviews.get(failed.reviewId)).toMatchObject({ result: "fail_action_required" });
    } finally {
      if (worktree) removeDetachedReviewWorktree(worktree);
      await daemon?.stop().catch(() => undefined);
      rmSync(tempRoot, { recursive: true, force: true });
      removeTempRepo(root);
    }
  });

  test("developer review run lifecycle cleans temporary worktrees locks and CodeGraph state on success and failure", async () => {
    const root = createInitializedGitRepo();
    const tempRoot = mkdtempSync(join(tmpdir(), "archctx-runtime-review-lifecycle-"));
    const provider = new MockCodeGraphProvider();
    const store = new TestLocalStore();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    const successPaths: Record<string, string> = {};
    const failurePaths: Record<string, string> = {};
    try {
      daemon = await createStartedTestDaemon({ codeFacts: new CodeGraphAdapter(provider), localStore: store });
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const expectedHeadTreeOid = gitOut(root, "rev-parse", "HEAD^{tree}");
      const challenge = preparedChallenge(headSha);

      const passed = await daemon.withDeveloperReviewRun({
        repositoryRoot: root,
        challenge,
        expectedHeadTreeOid,
        tempRoot
      }, async (run) => {
        const codeGraphStateDir = join(run.runRoot, "codegraph-state");
        Object.assign(successPaths, {
          runRoot: run.runRoot,
          worktreeRoot: run.worktree.worktreeRoot,
          manifestPath: run.manifestPath,
          lockPath: run.lockPath,
          codeGraphStateFile: join(codeGraphStateDir, "state.db")
        });
        mkdirSync(codeGraphStateDir, { recursive: true });
        writeFileSync(successPaths.codeGraphStateFile, "temporary CodeGraph state\n", "utf8");
        return daemon!.runDeveloperReviewSession({
          challenge,
          worktree: run.worktree,
          taskSessionId: "task_developer_review_lifecycle"
        });
      });

      expect(passed.reviewResult).toBe("pass");
      expect(provider.indexedRoots).toEqual([successPaths.worktreeRoot]);
      for (const path of Object.values(successPaths)) expect(existsSync(path)).toBe(false);

      await expect(daemon.withDeveloperReviewRun({
        repositoryRoot: root,
        challenge,
        expectedHeadTreeOid,
        tempRoot
      }, async (run) => {
        Object.assign(failurePaths, {
          runRoot: run.runRoot,
          worktreeRoot: run.worktree.worktreeRoot,
          manifestPath: run.manifestPath,
          lockPath: run.lockPath
        });
        writeFileSync(join(run.worktree.worktreeRoot, "README.md"), "# dirty detached worktree\n", "utf8");
        return daemon!.runDeveloperReviewSession({
          challenge,
          worktree: run.worktree,
          taskSessionId: "task_developer_review_failure_cleanup"
        });
      })).rejects.toThrow("WORKTREE_NOT_CLEAN");

      for (const path of Object.values(failurePaths)) expect(existsSync(path)).toBe(false);
    } finally {
      await daemon?.stop().catch(() => undefined);
      rmSync(tempRoot, { recursive: true, force: true });
      removeTempRepo(root);
    }
  });

  test("developer review run recovery removes stale manifests and keeps active runs unless forced", async () => {
    const root = createInitializedGitRepo();
    const tempRoot = mkdtempSync(join(tmpdir(), "archctx-runtime-review-recovery-"));
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon();
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const challenge = preparedChallenge(headSha);
      const prepared = daemon.startDeveloperReviewRun({
        repositoryRoot: root,
        challenge,
        expectedHeadTreeOid: gitOut(root, "rev-parse", "HEAD^{tree}"),
        tempRoot
      });
      expect(prepared.accepted).toBe(true);
      const run = prepared.run!;
      expect(existsSync(run.worktree.worktreeRoot)).toBe(true);
      expect(existsSync(run.manifestPath)).toBe(true);
      expect(existsSync(run.lockPath)).toBe(true);

      const skipped = daemon.recoverDeveloperReviewRuns({ repositoryRoot: root });
      expect(skipped.skippedActive).toContain(run.runId);
      expect(skipped.recovered).toEqual([]);
      expect(existsSync(run.worktree.worktreeRoot)).toBe(true);

      const recovered = daemon.recoverDeveloperReviewRuns({ repositoryRoot: root, force: true });
      expectSameExistingPath(recovered.stateDir, defaultDeveloperReviewRunStateDir(realpathSync.native(root)));
      expect(recovered.recovered).toHaveLength(1);
      expect(recovered.recovered[0]).toMatchObject({
        runId: run.runId,
        challengeId: challenge.challengeId,
        cleaned: true
      });
      expect(recovered.recovered[0].removed).toEqual(expect.arrayContaining(["worktree", "run-root", "manifest", "lock"]));
      expect(existsSync(run.worktree.worktreeRoot)).toBe(false);
      expect(existsSync(run.runRoot)).toBe(false);
      expect(existsSync(run.manifestPath)).toBe(false);
      expect(existsSync(run.lockPath)).toBe(false);
    } finally {
      await daemon?.stop().catch(() => undefined);
      rmSync(tempRoot, { recursive: true, force: true });
      removeTempRepo(root);
    }
  });

  test("runtime RPC exposes Developer Review run start sign cleanup and recovery methods", async () => {
    const root = createInitializedGitRepo();
    const keyPair = generateKeyPairSync("ed25519");
    const keyRef = "keychain://archcontext/device/acct_rpc/key_rpc";
    const daemon = await createStartedTestDaemon({
      devicePrivateKeySigner: {
        signWithDevicePrivateKey(input) {
          expect(input.keyRef).toBe(keyRef);
          const payload = typeof input.payload === "string" ? input.payload : Buffer.from(input.payload).toString("utf8");
          return sign(null, Buffer.from(payload, "utf8"), keyPair.privateKey).toString("base64");
        }
      }
    });
    const rpc = new ArchctxRuntimeRpcServer(daemon, { root, port: 0, token: "developer-review-rpc-token" });
    let stopped = false;
    try {
      const connection = await rpc.start();
      const client = new RuntimeRpcClient(connection);
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const challenge = preparedChallenge(headSha);
      const prepared = await client.startDeveloperReviewRun({
        repositoryRoot: root,
        challenge,
        expectedHeadTreeOid: gitOut(root, "rev-parse", "HEAD^{tree}")
      });
      expect(prepared.accepted).toBe(true);
      expect(prepared.run?.worktree.headSha).toBe(headSha);

      const signed = await client.runSignedDeveloperReviewAttestation({
        challenge,
        worktree: prepared.run!.worktree,
        keyRef,
        principalId: "device_rpc",
        publicKeyId: "key_rpc",
        taskSessionId: "task_developer_review_rpc",
        startedAt: "2026-06-20T00:04:00.000Z",
        completedAt: "2026-06-20T00:05:00.000Z"
      });
      expect(signed.attestation.signature.value).not.toBe("");
      expect(signed.reviewSession.reviewResult).toBe("pass");

      const cleanup = await client.cleanupDeveloperReviewRun(prepared.run!);
      expect(cleanup.cleaned).toBe(true);
      expect(existsSync(prepared.run!.worktree.worktreeRoot)).toBe(false);

      const recovery = await client.recoverDeveloperReviewRuns({ repositoryRoot: root, force: true });
      expect(recovery.recovered).toEqual([]);

      await rpc.stop();
      stopped = true;
    } finally {
      if (!stopped) await rpc.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  });

  test("daemon signs canonical Attestation v2 without exposing Device private key material", async () => {
    const root = createInitializedGitRepo();
    const tempRoot = mkdtempSync(join(tmpdir(), "archctx-runtime-signed-attestation-"));
    const provider = new MockCodeGraphProvider();
    const store = new TestLocalStore();
    const keyPair = generateKeyPairSync("ed25519");
    const signedPayloads: string[] = [];
    const keyRef = "keychain://archcontext/device/acct_1/key_device_1";
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    let worktree: NonNullable<ReturnType<Awaited<ReturnType<typeof createStartedTestDaemon>>["prepareDeveloperReviewWorktree"]>["worktree"]> | undefined;
    try {
      daemon = await createStartedTestDaemon({
        codeFacts: new CodeGraphAdapter(provider),
        localStore: store,
        devicePrivateKeySigner: {
          signWithDevicePrivateKey(input) {
            expect(input.keyRef).toBe(keyRef);
            const payload = typeof input.payload === "string" ? input.payload : Buffer.from(input.payload).toString("utf8");
            signedPayloads.push(payload);
            return sign(null, Buffer.from(payload, "utf8"), keyPair.privateKey).toString("base64");
          }
        },
        clock: () => "2026-06-20T00:05:00.000Z"
      });
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const challenge = preparedChallenge(headSha);
      const prepared = daemon.prepareDeveloperReviewWorktree({
        repositoryRoot: root,
        challenge,
        expectedHeadTreeOid: gitOut(root, "rev-parse", "HEAD^{tree}"),
        tempRoot
      });
      expect(prepared.accepted).toBe(true);
      worktree = prepared.worktree;

      const signed = await daemon.runSignedDeveloperReviewAttestation({
        challenge,
        worktree: worktree!,
        keyRef,
        principalId: "device_1",
        publicKeyId: "key_device_1",
        taskSessionId: "task_signed_developer_review",
        startedAt: "2026-06-20T00:04:00.000Z",
        completedAt: "2026-06-20T00:05:00.000Z"
      });

      expect(signed).toMatchObject({
        schemaVersion: "archcontext.developer-review-attestation/v1",
        challengeId: challenge.challengeId,
        attestation: {
          schemaVersion: "archcontext.attestation/v2",
          challengeId: challenge.challengeId,
          installationId: challenge.installationId,
          repositoryId: challenge.repositoryId,
          pullRequestNumber: challenge.pullRequestNumber,
          headSha,
          baseSha: challenge.baseSha,
          mergeBaseSha: challenge.baseSha,
          result: "pass",
          execution: {
            trustLevel: "developer",
            source: "clean-commit-worktree",
            principalId: "device_1",
            publicKeyId: "key_device_1"
          },
          nonce: challenge.nonce,
          startedAt: "2026-06-20T00:04:00.000Z",
          completedAt: "2026-06-20T00:05:00.000Z",
          expiresAt: challenge.expiresAt
        }
      });
      expect(signed.reviewSession.reviewDigest).toBe(signed.attestation.reviewDigest);
      expect(signed.attestation.worktreeDigest).toBe(signed.reviewSession.digests.worktreeDigest);
      expect(signed.attestation.modelDigest).toBe(signed.reviewSession.digests.modelDigest);
      expect(signed.attestation.policyDigest).toBe(signed.reviewSession.digests.policyDigest);
      expect(signed.attestation.codeFactsDigest).toBe(signed.reviewSession.digests.codeFactsDigest);
      expect(signed.attestation.signature).toMatchObject({ algorithm: "ed25519" });
      expect(signed.attestation.signature.value).not.toBe("");
      expect(signed.attestationDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(signed.signingPayloadDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(signedPayloads).toEqual([canonicalAttestationV2(signed.attestation)]);
      expect(verify(null, Buffer.from(canonicalAttestationV2(signed.attestation), "utf8"), keyPair.publicKey, Buffer.from(signed.attestation.signature.value, "base64"))).toBe(true);
      expect(JSON.stringify(signed)).not.toContain(keyRef);
      expect(JSON.stringify(signed)).not.toContain("PRIVATE KEY");
      expect(store.reviews.get(signed.reviewSession.reviewId)).toMatchObject({ result: "pass" });

      await expect(daemon.runSignedDeveloperReviewAttestation({
        challenge,
        worktree: worktree!,
        keyRef,
        principalId: "device_1",
        publicKeyId: "key_device_1",
        signature: { algorithm: "ed25519", value: "forged" }
      } as any)).rejects.toThrow("developer-review-attestation-caller-provided-attestation-field-forbidden: signature");
    } finally {
      if (worktree) removeDetachedReviewWorktree(worktree);
      await daemon?.stop().catch(() => undefined);
      rmSync(tempRoot, { recursive: true, force: true });
      removeTempRepo(root);
    }
  });

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

  test("runtime RPC server is loopback, versioned, token-gated, and single-locked", async () => {
    const root = tempRepo();
    const daemon = await createStartedTestDaemon();
    const rpc = new ArchctxRuntimeRpcServer(daemon, {
      root,
      port: 0,
      token: "runtime-test-token",
      clock: () => "2026-06-20T00:00:00.000Z"
    });
    let stopped = false;
    try {
      const connection = await rpc.start();
      expect(connection.url.startsWith("http://127.0.0.1:")).toBe(true);
      expect(connection.schemaVersion).toBe(RUNTIME_RPC_VERSION);
      expect(existsSync(connection.connectionPath)).toBe(true);
      expect(existsSync(connection.lockPath)).toBe(true);
      if (process.platform !== "win32") {
        expect(statSync(connection.connectionPath).mode & 0o777).toBe(0o600);
        expect(statSync(connection.lockPath).mode & 0o777).toBe(0o600);
      }

      const health = await fetch(`${connection.url}health`, {
        headers: { "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION }
      });
      expect(health.status).toBe(200);
      const healthBody = await health.json() as any;
      expect(healthBody.schemaVersion).toBe(RUNTIME_RPC_VERSION);
      expect(healthBody.product.runtime.localRpc.schemaVersion).toBe(RUNTIME_RPC_VERSION);
      expect(healthBody.product.surfaces.daemon.rpcSchemaVersion).toBe(RUNTIME_RPC_VERSION);

      const mismatchedHealth = await fetch(`${connection.url}health`, {
        headers: { "X-ArchContext-RPC-Version": "archcontext.runtime-rpc/v0" }
      });
      expect(mismatchedHealth.status).toBe(426);
      expect((await mismatchedHealth.json() as any).expected).toBe(RUNTIME_RPC_VERSION);

      const denied = await fetch(`${connection.url}rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method: "runtimeStatus", params: [root] })
      });
      expect(denied.status).toBe(401);

      const mismatchedRpc = await fetch(`${connection.url}rpc`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${connection.token}`,
          "Content-Type": "application/json",
          "X-ArchContext-RPC-Version": "archcontext.runtime-rpc/v0"
        },
        body: JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method: "runtimeStatus", params: [root] })
      });
      expect(mismatchedRpc.status).toBe(426);

      const clientA = new RuntimeRpcClient(connection);
      const init = await clientA.init(root, "RPC App");
      expect(init.ok).toBe(true);
      const clientB = new RuntimeRpcClient(connection);
      const status = await clientB.runtimeStatus(root);
      expect((status.data as any).sessions).toBe(1);
      expect((status.data as any).repositoryId).toBe(repositoryFingerprint(root));

      const lockedDaemon = await createStartedTestDaemon();
      const locked = new ArchctxRuntimeRpcServer(lockedDaemon, { root, port: 0, token: "other-token" });
      await expect(locked.start()).rejects.toThrow("already running");
      await lockedDaemon.stop();

      await rpc.stop();
      stopped = true;
      expect(existsSync(connection.connectionPath)).toBe(false);
      expect(existsSync(connection.lockPath)).toBe(false);
    } finally {
      if (!stopped) await rpc.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  });

  // Regression tests for the daemon idle self-exit (`archctxd` is spawned `detached`+`unref()`'d
  // with no other exit signal — see F5 in tasks/reviews/audit-approve-gh-publishing.review.md,
  // which caused cross-day zombie processes). `exit` is injected so the idle path's real
  // `process.exit(0)` call never terminates this test runner; real-process termination is covered
  // separately by the CLI-level `--idle-timeout-ms` e2e test.
  test("idle RPC server exits itself once genuinely idle, and a completed RPC request resets the deadline", async () => {
    const root = tempRepo();
    const daemon = await createStartedTestDaemon();
    const exitCodes: number[] = [];
    const rpc = new ArchctxRuntimeRpcServer(daemon, {
      root,
      port: 0,
      token: "idle-exit-token",
      idleTimeoutMs: 300,
      exit: (code) => { exitCodes.push(code); }
    });
    try {
      const connection = await rpc.start();
      // Completing an RPC request well before the original 300ms deadline must push the deadline
      // out again: checking after the *original* deadline has already elapsed (but before the
      // reset one) proves the reset actually happened rather than the timer never having started.
      await sleep(200);
      const init = await new RuntimeRpcClient(connection).init(root, "Idle Reset App");
      expect(init.ok).toBe(true);
      await sleep(150);
      expect(exitCodes).toEqual([]);
      expect(existsSync(connection.connectionPath)).toBe(true);

      await waitUntil(() => exitCodes.length > 0, 3_000, "idle-exit callback after reset");
      expect(exitCodes).toEqual([0]);
      expect(existsSync(connection.connectionPath)).toBe(false);
      expect(existsSync(connection.lockPath)).toBe(false);
      expect(daemon.status().running).toBe(false);
    } finally {
      await rpc.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  }, 10_000);

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

  test("idle RPC server does not exit while an audit investigation abort controller is active", async () => {
    const root = tempRepo();
    const daemon = await createStartedTestDaemon();
    // Simulates `auditRun`'s tracked background investigation without driving a real one: this
    // exercises the RPC server's idle check against `ArchctxDaemon.hasActiveBackgroundWork`
    // in isolation from the audit subsystem itself.
    (daemon as unknown as { auditRunAbortControllers: Map<string, AbortController> })
      .auditRunAbortControllers.set("agent_job.idle-test", new AbortController());
    const exitCodes: number[] = [];
    const rpc = new ArchctxRuntimeRpcServer(daemon, {
      root,
      port: 0,
      token: "idle-busy-audit-token",
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

  test("idle timeout of 0 disables idle exit", async () => {
    const root = tempRepo();
    const daemon = await createStartedTestDaemon();
    const exitCodes: number[] = [];
    const rpc = new ArchctxRuntimeRpcServer(daemon, {
      root,
      port: 0,
      token: "idle-disabled-token",
      idleTimeoutMs: 0,
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

  test("runtime RPC ignores insecure connection files and recovers stale locks", async () => {
    const root = tempRepo();
    const connectionPath = defaultDaemonConnectionPath(root);
    const lockPath = defaultDaemonLockPath(root);
    mkdirSync(dirname(connectionPath), { recursive: true });
    writeFileSync(connectionPath, JSON.stringify({
      schemaVersion: RUNTIME_RPC_VERSION,
      protocol: "http-loopback",
      version: 1,
      root,
      url: "http://127.0.0.1:1/",
      token: "leaky-token",
      pid: process.pid,
      lockPath,
      connectionPath,
      startedAt: "2026-06-20T00:00:00.000Z"
    }, null, 2), { mode: 0o600 });
    if (process.platform === "win32") {
      expect(readRuntimeRpcConnection(root)?.token).toBe("leaky-token");
    } else {
      chmodSync(connectionPath, 0o644);
      expect(readRuntimeRpcConnection(root)).toBeUndefined();
    }
    const insecureRecovery = recoverStaleDaemonControlFiles(root);
    if (process.platform !== "win32") {
      expect(insecureRecovery.removed).toContain("insecure-connection-file");
      expect(existsSync(connectionPath)).toBe(false);
    } else {
      expect(insecureRecovery.removed).not.toContain("insecure-connection-file");
      rmSync(connectionPath, { force: true });
    }

    writeFileSync(lockPath, JSON.stringify({ pid: -1, root, startedAt: "2026-06-20T00:00:00.000Z" }, null, 2), { mode: 0o600 });
    const staleLockRecovery = recoverStaleDaemonControlFiles(root);
    expect(staleLockRecovery.removed).toContain("stale-lock-file");
    expect(existsSync(lockPath)).toBe(false);
    writeFileSync(lockPath, JSON.stringify({ pid: -1, root, startedAt: "2026-06-20T00:00:00.000Z" }, null, 2), { mode: 0o600 });
    const daemon = await createStartedTestDaemon();
    const rpc = new ArchctxRuntimeRpcServer(daemon, { root, port: 0, token: "stale-lock-token" });
    let stopped = false;
    try {
      const connection = await rpc.start();
      expect(connection.lockPath).toBe(lockPath);
      expect(JSON.parse(readFileSync(lockPath, "utf8")).pid).toBe(process.pid);
      expect(readRuntimeRpcConnection(root)?.token).toBe("stale-lock-token");
      await rpc.stop();
      stopped = true;
    } finally {
      if (!stopped) await rpc.stop().catch(() => undefined);
      removeTempRepo(root);
    }
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

  test("Explorer loopback service is token-gated, read-only, and revocable", async () => {
    const root = tempRepo();
    try {
      const localStore = new TestLocalStore();
      const daemon = await createStartedTestDaemon({ localStore, clock: () => "2026-06-20T00:00:00.000Z" });
      await daemon.init(root, "Explorer App");
      await daemon.prepare(root, "change the Explorer runtime boundary", 12_288, 12, "task.explorer-current");
      const started = await daemon.startExplorer(root, { port: 0, tokenTtlSeconds: 60 });
      expect(started.ok).toBe(true);
      const data = started.data as any;
      expect(data.host).toBe("127.0.0.1");
      expect(data.readOnly).toBe(true);

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
      expect(bodyV2.data.occurrences.length).toBeLessThanOrEqual(5);
      expect(bodyV2.data.page.budget).toEqual({ maxNodes: 5, maxRelations: 5 });
      expect(JSON.stringify(bodyV2.data)).not.toContain("sourceBody");
      expect(bodyV2.data.capabilities).toMatchObject({ readOnly: true, mutationMode: "forbidden", egress: "none" });

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
      expect(html.headers.get("content-security-policy")).toContain("connect-src 'self'");
      const htmlBody = await html.text();
      expect(htmlBody).toContain("ArchContext Explorer");
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
      process.env.PATH = `${binDir}${previousPath ? `:${previousPath}` : ""}`;
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
      process.env.PATH = `${binDir}${previousPath ? `:${previousPath}` : ""}`;
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
});

function createGitRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-runtime-git-"));
  writeFileSync(join(root, "README.md"), "# fixture\n", "utf8");
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["add", "."], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  return root;
}

// Matches the exact indentation shape the daemon's auditGithubIssuesEnabledInManifestText (and the
// CLI's auditGithubIssuesEnabled) scan for: `audit:` at indent 0, `githubIssues:` at indent 2,
// `enabled: <bool>` at indent 4.
function writeAuditManifest(root: string, enabled: boolean): void {
  mkdirSync(join(root, ".archcontext"), { recursive: true });
  writeFileSync(
    join(root, ".archcontext", "manifest.yaml"),
    `schemaVersion: archcontext.manifest/v1\naudit:\n  githubIssues:\n    enabled: ${enabled}\n`,
    "utf8"
  );
}

function addGitRemote(root: string, url: string): void {
  execFileSync("git", ["remote", "add", "origin", url], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

/** ADR-0042 test double: never shells out, records every call for assertions. */
interface FakeGithubIssueExecutorOptions {
  visibility?: string;
  repoViewError?: Error;
  listRecentIssuesError?: Error;
  existingIssues?: GithubIssueListedRecord[];
  createIssueImpl?: (input: { repo: string; title: string; bodyFile: string }) => Promise<GithubIssueCreatedRecord>;
}

interface FakeGithubIssueExecutorCreateCall {
  repo: string;
  title: string;
  bodyFile: string;
  bodyText: string;
}

interface FakeGithubIssueExecutorCalls {
  repoView: { repo: string; env: { GH_TOKEN: string } }[];
  listRecentIssues: { repo: string; env: { GH_TOKEN: string } }[];
  createIssue: FakeGithubIssueExecutorCreateCall[];
}

function fakeGithubIssueExecutor(options: FakeGithubIssueExecutorOptions = {}): {
  executor: GithubIssueExecutorPort;
  calls: FakeGithubIssueExecutorCalls;
  existingIssues: GithubIssueListedRecord[];
} {
  const calls: FakeGithubIssueExecutorCalls = { repoView: [], listRecentIssues: [], createIssue: [] };
  const existingIssues: GithubIssueListedRecord[] = options.existingIssues ? [...options.existingIssues] : [];
  let nextNumber = 5000;
  const executor: GithubIssueExecutorPort = {
    async repoView(repo, env) {
      calls.repoView.push({ repo, env });
      if (options.repoViewError) throw options.repoViewError;
      return { visibility: options.visibility ?? "private" };
    },
    async listRecentIssues(repo, env) {
      calls.listRecentIssues.push({ repo, env });
      if (options.listRecentIssuesError) throw options.listRecentIssuesError;
      return existingIssues;
    },
    async createIssue(input) {
      const bodyText = readFileSync(input.bodyFile, "utf8");
      calls.createIssue.push({ repo: input.repo, title: input.title, bodyFile: input.bodyFile, bodyText });
      if (options.createIssueImpl) return options.createIssueImpl(input);
      nextNumber += 1;
      return { number: nextNumber, url: `https://github.com/${input.repo}/issues/${nextNumber}` };
    }
  };
  return { executor, calls, existingIssues };
}

function auditDraftRecord(overrides: Partial<{
  kind: string;
  priority: string;
  title: string;
  bodyMarkdown: string;
  labels: string[];
  evidence: unknown[];
  acceptance: string[];
  verificationCommands: string[];
}> = {}) {
  return {
    kind: "task",
    priority: "P2",
    title: "Add direct sqlite coverage for audit_runs reads",
    bodyMarkdown: "## Task\n\nCover listAuditRuns/getAuditRun with a dedicated sqlite test.\n",
    labels: [],
    evidence: [{ path: "packages/local-runtime/local-store-sqlite/src/index.ts", startLine: 1, note: "audit run read path" }],
    acceptance: ["listAuditRuns and getAuditRun have direct sqlite coverage"],
    verificationCommands: [],
    ...overrides
  };
}

function auditInvestigationTransportWithDrafts(draftRecords: unknown[], now: string) {
  return async (input: CommandInvestigationRunnerTransportInput) => {
    const separatorIndex = input.stdin.lastIndexOf("\n\n");
    const runnerInput = JSON.parse(separatorIndex === -1 ? input.stdin : input.stdin.slice(separatorIndex + 2));
    const jobId = runnerInput.job.jobId as string;
    const report = {
      schemaVersion: INVESTIGATION_REPORT_SCHEMA_VERSION,
      reportId: `investigation_report.approve_test_${jobId.slice(-8)}`,
      jobId,
      status: "succeeded",
      findings: [],
      outputDigest: digestJson({ jobId, draftRecords } as unknown as Json),
      createdAt: now,
      directMutationAllowed: false,
      extensions: { githubIssueDrafts: draftRecords }
    };
    return { exitCode: 0, stdout: JSON.stringify({ report }) };
  };
}

/**
 * Stands up a daemon and drives a real `auditRun` to completion (2 drafts by default) so
 * `auditApprove` tests exercise the actual pending-run/proposal-plan shape the daemon produces,
 * rather than a hand-built fixture. `githubIssueExecutor` is always an explicit fake (never the
 * real `createNodeGithubIssueExecutor` default) so no test in this suite can accidentally shell
 * out to a real `gh` binary.
 */
async function createPendingApproveFixture(options: {
  draftRecords?: unknown[];
  remoteUrl?: string;
  githubIssueExecutor: GithubIssueExecutorPort;
} ): Promise<{ root: string; store: TestLocalStore; daemon: Awaited<ReturnType<typeof createStartedTestDaemon>>; runId: string; draftRecords: unknown[] }> {
  const root = createGitRepo();
  if (options.remoteUrl) addGitRemote(root, options.remoteUrl);
  writeAuditManifest(root, true);
  const store = new TestLocalStore();
  const draftRecords = options.draftRecords ?? [auditDraftRecord({ title: "Draft One" }), auditDraftRecord({ title: "Draft Two" })];
  const now = "2026-07-05T00:00:00.000Z";
  const daemon = await createStartedTestDaemon({
    localStore: store,
    clock: () => now,
    githubIssueExecutor: options.githubIssueExecutor,
    investigationTransport: auditInvestigationTransportWithDrafts(draftRecords, now)
  });
  const run = await daemon.auditRun(root, { timeoutMs: 5_000, wait: true });
  if (!run.ok) throw new Error(`fixture audit run failed: ${JSON.stringify(run)}`);
  const runId = (run.data as any).runId as string;
  return { root, store, daemon, runId, draftRecords };
}

async function withAuditApproveToken<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.ARCHCONTEXT_GH_ISSUES_TOKEN;
  if (value === undefined) delete process.env.ARCHCONTEXT_GH_ISSUES_TOKEN;
  else process.env.ARCHCONTEXT_GH_ISSUES_TOKEN = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.ARCHCONTEXT_GH_ISSUES_TOKEN;
    else process.env.ARCHCONTEXT_GH_ISSUES_TOKEN = previous;
  }
}

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

function createInitializedGitRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-runtime-initialized-git-"));
  writeFileSync(join(root, "README.md"), "# fixture\n", "utf8");
  initializeArchContextModel(root, "Digest App");
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["add", "."], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  return root;
}

function gitOut(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function preparedChallenge(headSha: string) {
  return {
    schemaVersion: "archcontext.review-challenge/v2" as const,
    challengeId: "chal_runtime_worktree",
    installationId: 123,
    repositoryId: 456,
    pullRequestNumber: 7,
    headSha,
    baseSha: headSha,
    nonce: "nonce_runtime_worktree",
    requiredTrust: "developer" as const,
    policyProfileId: "policy.default",
    createdAt: "2026-06-20T00:00:00.000Z",
    expiresAt: "2026-06-20T00:15:00.000Z",
    status: "LEASED" as const
  };
}
