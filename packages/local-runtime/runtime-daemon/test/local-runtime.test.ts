import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { ARCHCONTEXT_PRODUCT_VERSION, canonicalAttestationV2, digestJson, type CodeFactsPort, type ExternalDocumentationPort, type NormalizedCodeContext } from "@archcontext/contracts";
import { assertNoCodeGraphInternalPathAccess, CodeGraphAdapter, REQUIRED_CODEGRAPH_VERSION } from "@archcontext/local-runtime/codegraph-adapter";
import { Context7ExternalDocumentationAdapter, Context7ProviderError, type Context7Transport } from "@archcontext/local-runtime/context7-adapter";
import { removeDetachedReviewWorktree } from "@archcontext/local-runtime/git-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { migrationSql, assertNoSourceStorageSchema, SQLITE_PRAGMAS } from "@archcontext/local-runtime/local-store-sqlite";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { initializeArchContextModel, listModelFiles } from "@archcontext/local-runtime/model-store-yaml";
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
  readRuntimeRpcConnection
} from "../src/index";

const PREVIOUS_ARCHCONTEXT_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const RUNTIME_TEST_STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-runtime-state-"));
const CONTEXT7_FAILURE_MATRIX_CASES = ["disabled", "no-key", "no-network", "429", "timeout", "malformed"] as const;
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
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
  } catch (error) {
    if (isIgnorableWindowsCleanupError(error)) return;
    throw error;
  }
}

function isIgnorableWindowsCleanupError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return process.platform === "win32" && (code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY");
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
        owner: "team-architecture"
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
        readAuthority: "yaml",
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
        await super.appendArchitectureEvents(input);
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
        worktreeDigest: (before.data as any).worktreeDigest
      });
      await second.stop();
      second = undefined;
    } finally {
      await second?.stop().catch(() => undefined);
      await first?.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  });

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
      rmSync(tempRoot, { recursive: true, force: true });
      removeTempRepo(root);
    }
  });

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
      rmSync(tempRoot, { recursive: true, force: true });
      removeTempRepo(root);
    }
  });

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

  test("production composition root uses real adapters and rejects injected runtime doubles", async () => {
    const root = tempRepo();
    try {
      const daemon = await createStartedProductionDaemon({ root });
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

      const codeFacts = new CodeGraphAdapter(new MockCodeGraphProvider());
      expect(() => assertProductionRuntimeDeps({ codeFacts })).toThrow("codeFacts");
      expect(() => assertProductionRuntimeDeps({ codeGraphProviderFactory: () => new MockCodeGraphProvider() })).toThrow("codeGraphProviderFactory");
      expect(() => assertProductionRuntimeDeps({ localStore: new TestLocalStore() })).toThrow("localStore");
      expect(() => assertProductionRuntimeDeps({ clock: () => "2026-06-20T00:00:00.000Z" })).toThrow("clock");
    } finally {
      removeTempRepo(root);
    }
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
      const daemon = await createStartedTestDaemon({ clock: () => "2026-06-20T00:00:00.000Z" });
      await daemon.init(root, "Explorer App");
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
      expect(projection.status).toBe(200);
      const body = await projection.json() as any;
      expect(body.data.schemaVersion).toBe("archcontext.explorer-projection/v1");
      expect(body.data.capabilities).toMatchObject({ readOnly: true, mutationMode: "forbidden", egress: "none" });
      expect(JSON.stringify(body.data)).not.toContain("sourceBody");

      const rootProjection = await fetch(`${data.url}?token=${data.token}`);
      expect((await rootProjection.json() as any).data.schemaVersion).toBe("archcontext.explorer-projection/v1");

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
});

function createGitRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-runtime-git-"));
  writeFileSync(join(root, "README.md"), "# fixture\n", "utf8");
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["add", "."], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  return root;
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
