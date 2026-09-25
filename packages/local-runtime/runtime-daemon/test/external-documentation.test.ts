import { rmSync, tempRepo, removeTempRepo, removeTempPath, readText, createStartedTestDaemon } from "./runtime-test-fixtures";
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type ExternalDocumentationPort } from "@archcontext/contracts";
import { Context7ExternalDocumentationAdapter, Context7ProviderError, type Context7Transport } from "@archcontext/local-runtime/context7-adapter";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";

const PREVIOUS_ARCHCONTEXT_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const RUNTIME_TEST_STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-external-docs-state-"));
process.env.ARCHCONTEXT_STATE_DIR = RUNTIME_TEST_STATE_ROOT;
afterAll(() => {
  if (PREVIOUS_ARCHCONTEXT_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_ARCHCONTEXT_STATE_DIR;
  rmSync(RUNTIME_TEST_STATE_ROOT, { recursive: true, force: true });
});

const CONTEXT7_FAILURE_MATRIX_CASES = ["disabled", "no-key", "no-network", "429", "timeout", "malformed"] as const;
type Context7FailureMatrixCase = typeof CONTEXT7_FAILURE_MATRIX_CASES[number];

describe("daemon external documentation", () => {
  test("explicit allowNetwork cannot override local-only for manual docs", async () => {
    const root = tempRepo();
    let providerCalls = 0;
    const daemon = await createStartedTestDaemon({ externalDocumentation: fakeExternalDocumentation(() => providerCalls++) });
    const previousMode = process.env.ARCHCONTEXT_EGRESS_MODE;
    try {
      await daemon.init(root, "Local docs");
      await daemon.docs(root, { command: "pin", libraryId: "/facebook/react", version: "18.2.0", approved: true });
      process.env.ARCHCONTEXT_EGRESS_MODE = "local-only";
      for (const input of [
        { command: "resolve" as const, libraryName: "React", query: "state hooks", allowNetwork: true },
        { command: "fetch" as const, libraryId: "/facebook/react", intent: "state hooks", allowNetwork: true }
      ]) {
        const result = await daemon.docs(root, input);
        expect(result).toMatchObject({ ok: false, error: { code: "AC_POLICY_VIOLATION" } });
      }
      expect(providerCalls).toBe(0);
    } finally {
      if (previousMode === undefined) delete process.env.ARCHCONTEXT_EGRESS_MODE;
      else process.env.ARCHCONTEXT_EGRESS_MODE = previousMode;
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

});

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
