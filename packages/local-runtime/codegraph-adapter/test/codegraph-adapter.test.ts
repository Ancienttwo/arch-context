import { execFileSync, spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { FailureError, digestJson, type CodeGraphKeptPathV1, type Json } from "@archcontext/contracts";
import { CODEGRAPH_TELEMETRY_ENV, CodeGraphAdapter, CodeGraphSdkProvider, MultiRepoCodeGraphAdapter, REQUIRED_CODEGRAPH_VERSION, codeGraphBaseDirectory, codeGraphCliInvocation, codeGraphRewritesGitignore, disableCodeGraphTelemetryByDefault, inspectRepositoryCodeFacts, openCodeGraphSymbolReader, packagedCodeGraphCliInvocation, pinnedCodeGraphProvider, prepareArchitectureDocumentationProjectionSnapshot, prepareProjectionCodeFacts, refreshCodeGraphBase, seedCodeGraphIndexFromBase, withCodeGraphReadSession, type CodeGraphReadProvider } from "../src/index";
import * as readSessionModule from "../src/read-session";
import { StagingRun, publishBasePointer } from "../src/index-base";
import { CodeGraphProviderUnavailableError, codeGraphBundle } from "../src/read-session";
import { fakeReadProvider, type FakeIndexFacts, type FakeReadProvider } from "./read-provider-fixture";
import { MockCodeGraphProvider } from "./factories";
import { indexCodeGraphFixture } from "./real-index";

/** `fakeReadProvider`, with the SDK reads of `graph` on every handle it opens. */
function sdkReadProvider(root: string, graph: Record<string, unknown>, facts: FakeIndexFacts = {}): FakeReadProvider {
  const base = fakeReadProvider(root, facts);
  return { ...base, openReadOnly: (openedRoot) => Object.assign(base.openReadOnly(openedRoot), graph) };
}

async function readFailure(read: Promise<unknown>): Promise<FailureError> {
  const failure = await read.then(() => undefined, (error: unknown) => error);
  expect(failure).toBeInstanceOf(FailureError);
  return failure as FailureError;
}

function readyStatusCommands(root: string): string {
  const status = {
    initialized: true, version: REQUIRED_CODEGRAPH_VERSION, projectPath: realpathSync.native(root),
    pendingChanges: { added: 0, modified: 0, removed: 0 }, worktreeMismatch: null,
    index: { builtWithVersion: REQUIRED_CODEGRAPH_VERSION, builtWithExtractionVersion: 24, currentExtractionVersion: 24, reindexRecommended: false, state: "complete", pendingRefs: 0 }
  };
  return `
if (process.argv[2] === "--version") { console.log(${JSON.stringify(REQUIRED_CODEGRAPH_VERSION)}); process.exit(0); }
if (process.argv[2] === "status") { console.log(JSON.stringify(${JSON.stringify(status)})); process.exit(0); }
`;
}

describe("@archcontext/local-runtime/codegraph-adapter multi-repo", () => {
  test("resolves the projection binary from the exact package instead of PATH", () => {
    const invocation = packagedCodeGraphCliInvocation();
    expect(invocation.command).toBe(process.execPath);
    expect(invocation.argsPrefix[0]).toEndWith(join("node_modules", "@colbymchenry", "codegraph", "npm-shim.js"));
    expect(REQUIRED_CODEGRAPH_VERSION).toBe("1.6.4");
    const root = mkdtempSync(join(tmpdir(), "archctx-packaged-codegraph-runtime-"));
    try {
      const prepared = prepareProjectionCodeFacts(root, { nodes: [], relations: [] }, {
        sourceTreeDigest: `sha256:${"0".repeat(64)}`
      });
      expect(prepared.handshake).toMatchObject({
        actualVersion: "1.6.4",
        availability: "unavailable",
        reasonCode: "index-missing"
      });
      expect(prepared.handshake.binaryDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(prepared.handshake.indexedWorktreeDigest).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * A fake CLI that appends each subcommand to `calls`, marks the workspace synced on `sync` and
   * exits 0, or, with `syncExit`, writes `stderr` and exits with that code. With `syncDelayMs` the
   * sync outlasts its deadline.
   */
  function handshakeCli(root: string, options: { syncExit?: number; syncDelayMs?: number } = {}): { binary: string; calls(): string[] } {
    const binary = join(root, "fake-codegraph.js");
    const calls = join(root, "calls");
    writeFileSync(binary, `
import { appendFileSync, writeFileSync } from "node:fs";
appendFileSync(${JSON.stringify(calls)}, process.argv[2] + "\\n");
if (process.argv[2] !== "sync") process.exit(2);
${options.syncExit === undefined ? "" : `process.stderr.write("sync rejected"); process.exit(${options.syncExit});`}
${options.syncDelayMs === undefined ? "" : `await new Promise((resolve) => setTimeout(resolve, ${options.syncDelayMs}));`}
writeFileSync(${JSON.stringify(join(root, "synced"))}, "ok");
`);
    return { binary, calls: () => existsSync(calls) ? readFileSync(calls, "utf8").split("\n").filter(Boolean) : [] };
  }

  /** A read-only index that lags by one modified file, at an earlier index time, until the CLI synced. */
  function syncedIndex(root: string, facts: FakeIndexFacts = {}): FakeReadProvider {
    return fakeReadProvider(root, () => existsSync(join(root, "synced"))
      ? facts
      : { ...facts, lastIndexedAt: Date.UTC(2025, 0, 1), pending: { added: 0, modified: 1, removed: 0 } });
  }

  function handshakeFailure(run: () => unknown): { message: string; details: Record<string, unknown> } {
    let failure: unknown;
    try { run(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    return { message, details: JSON.parse(message.split("\nCodeGraph sync diagnostics: ")[1]!) };
  }

  test("binds the loaded version, the read-only index state, the sync and the source snapshot into one handshake", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-codegraph-projection-handshake-"));
    try {
      const cli = handshakeCli(root);
      const prepared = prepareProjectionCodeFacts(root, { nodes: [], relations: [] }, {
        binary: cli.binary,
        readProvider: syncedIndex(root),
        sourceTreeDigest: `sha256:${"1".repeat(64)}`
      });
      expect(prepared.importGraphs).toEqual([]);
      expect(prepared.handshake).toMatchObject({
        actualVersion: "1.6.4",
        availability: "ready",
        requiredVersion: "1.6.4"
      });
      // `sync` is the only CodeGraph process the handshake starts.
      expect(cli.calls()).toEqual(["sync"]);
      expect(prepared.handshake.binaryDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(prepared.handshake.indexedWorktreeDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(prepared.handshake.graphDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a command that already synced the index starts no second sync and still fails closed on a stale index (#584)", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-codegraph-projection-synced-"));
    try {
      const cli = handshakeCli(root);
      writeFileSync(join(root, "synced"), "ok");
      const prepared = prepareProjectionCodeFacts(root, { nodes: [], relations: [] }, {
        binary: cli.binary, readProvider: syncedIndex(root), indexSynced: true, sourceTreeDigest: `sha256:${"1".repeat(64)}`
      });
      expect(prepared.handshake.availability).toBe("ready");
      rmSync(join(root, "synced"));
      expect(() => prepareProjectionCodeFacts(root, { nodes: [], relations: [] }, {
        binary: cli.binary, readProvider: syncedIndex(root), indexSynced: true, sourceTreeDigest: `sha256:${"1".repeat(64)}`
      })).toThrow("post-query index still has pending source changes");
      expect(cli.calls()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails closed on a loaded provider of another version, before any sync", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-codegraph-projection-mismatch-"));
    try {
      const cli = handshakeCli(root);
      for (const version of ["1.4.0", "1.6.1"]) {
        expect(() => prepareProjectionCodeFacts(root, { nodes: [], relations: [] }, {
          binary: cli.binary,
          readProvider: syncedIndex(root, { version }),
          sourceTreeDigest: `sha256:${"2".repeat(64)}`
        })).toThrow(`got loaded provider ${version}`);
      }
      expect(cli.calls()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails closed when the sync exceeds its bounded deadline", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-codegraph-projection-timeout-"));
    try {
      const cli = handshakeCli(root, { syncDelayMs: 500 });
      const { message, details } = handshakeFailure(() => prepareProjectionCodeFacts(root, { nodes: [], relations: [] }, {
        binary: cli.binary,
        readProvider: syncedIndex(root),
        sourceTreeDigest: `sha256:${"3".repeat(64)}`,
        timeouts: { syncMs: 20 }
      }));
      expect(message).toContain("CodeGraph sync failed:");
      expect(details).toMatchObject({ subcommand: "sync", deadlineMs: 20, code: "ETIMEDOUT" });
      expect(Number.isFinite(details.elapsedMs)).toBe(true);
      expect(details.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(details).toHaveProperty("exitCode");
      expect(details).toHaveProperty("signal");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("handshake diagnostics distinguish a sync exit from a spawn failure without retry", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-handshake-diagnostics-"));
    try {
      const cli = handshakeCli(root, { syncExit: 7 });
      const prepare = (binary: string) => () => prepareProjectionCodeFacts(root, { nodes: [], relations: [] }, {
        binary, readProvider: syncedIndex(root), sourceTreeDigest: `sha256:${"3".repeat(64)}`
      });
      const exited = handshakeFailure(prepare(cli.binary));
      expect(exited.message).toContain("CodeGraph sync failed: sync rejected");
      expect(exited.details).toMatchObject({ subcommand: "sync", deadlineMs: 120000, exitCode: 7, signal: null });
      expect(exited.details.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(cli.calls()).toEqual(["sync"]);
      const missing = handshakeFailure(prepare(join(root, "missing-codegraph")));
      expect(missing.details).toMatchObject({ subcommand: "sync", deadlineMs: 120000, code: "ENOENT", exitCode: null, signal: null });
      expect(missing.details.elapsedMs).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** A capability whose footprint and entrypoint make the handshake read both imports and selectors. */
  const readingModel = { nodes: [{ id: "capability.reads", kind: "capability", name: "Reads", source: {
    include: ["src/**"],
    entrypoints: [{ id: "entrypoint.reads", path: "src/main.ts", symbols: [{ name: "main", sinks: [{ id: "sink.reads", path: "src/main.ts", symbol: "helper" }] }] }]
  } }], relations: [] } as unknown as Parameters<typeof prepareProjectionCodeFacts>[1];

  /**
   * The index of `readingModel`, ready until `during` reads the index (the import or the selector
   * read), where `change` lands one added, modified or removed source.
   */
  function editedDuringRead(root: string, during: "imports" | "selectors", change: "added" | "modified" | "removed"): FakeReadProvider {
    let edited = false;
    const base = fakeReadProvider(root, () => edited ? { pending: { added: 0, modified: 0, removed: 0, [change]: 1 } } : {});
    return {
      ...base,
      openReadOnly: (openedRoot) => Object.assign(base.openReadOnly(openedRoot), {
        getStats: () => ({ nodesByKind: { import: 0 } }),
        getNodesByKind: () => { if (during === "imports") edited = true; return []; },
        getNodesByName: () => { if (during === "selectors") edited = true; return []; },
        getNodesInFile: () => [],
        getNode: () => null,
        getOutgoingEdges: () => []
      })
    };
  }

  const editsDuringReads = (["imports", "selectors"] as const).flatMap((during) => (["added", "modified", "removed"] as const).flatMap((change) =>
    [false, true].map((indexSynced) => ({
      name: `a source ${change} during the ${during} read${indexSynced ? " of a reused sync" : ""}`,
      model: readingModel,
      provider: (root: string) => editedDuringRead(root, during, change),
      indexSynced,
      expected: "post-query index still has pending source changes"
    }))));

  for (const row of [
    { name: "sync leaves the index stale", model: { nodes: [], relations: [] }, indexSynced: false, expected: "post-query index still has pending source changes",
      provider: (root: string) => fakeReadProvider(root, { pending: { added: 0, modified: 1, removed: 0 } }) },
    // Only the session that spans the projection reads (the second open) sees the index move.
    { name: "the index moves during the projection reads", model: { nodes: [], relations: [] }, indexSynced: false, expected: "CodeGraph indexed snapshot changed during projection queries",
      provider: (root: string) => {
        let provider: FakeReadProvider | undefined;
        provider = fakeReadProvider(root, () => ({ revisionMoves: provider?.calls.open === 2 }));
        return provider;
      } },
    // The post-read inspection names the reason even when no index answers it.
    { name: "the index disappears during the selector read", model: readingModel, indexSynced: true, expected: "CodeGraph post-query index is not ready: index-missing",
      provider: (root: string) => {
        const base = fakeReadProvider(root);
        return { ...base, openReadOnly: (openedRoot: string) => Object.assign(base.openReadOnly(openedRoot), {
          getStats: () => ({ nodesByKind: { import: 0 } }),
          getNodesByKind: () => [],
          getNodesByName: () => { rmSync(join(root, ".codegraph"), { recursive: true, force: true }); return []; },
          getNodesInFile: () => [],
          getNode: () => null,
          getOutgoingEdges: () => []
        }) };
      } },
    ...editsDuringReads
  ]) test(`fails closed when ${row.name}`, () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-codegraph-projection-stale-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: root });
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "src/main.ts"), "export function main() { return helper(); }\nexport function helper() { return 1; }\n");
      const cli = handshakeCli(root);
      if (row.indexSynced) writeFileSync(join(root, "synced"), "ok");
      expect(() => prepareProjectionCodeFacts(root, row.model, {
        binary: cli.binary,
        readProvider: row.provider(root),
        indexSynced: row.indexSynced,
        sourceTreeDigest: `sha256:${"4".repeat(64)}`
      })).toThrow(row.expected);
      expect(cli.calls()).toEqual(row.indexSynced ? [] : ["sync"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("disables CodeGraph telemetry by default without overriding explicit env", () => {
    const defaultEnv: Record<string, string | undefined> = {};
    expect(disableCodeGraphTelemetryByDefault(defaultEnv)).toBe("1");
    expect(defaultEnv[CODEGRAPH_TELEMETRY_ENV]).toBe("1");

    const explicitEnv: Record<string, string | undefined> = { [CODEGRAPH_TELEMETRY_ENV]: "0" };
    expect(disableCodeGraphTelemetryByDefault(explicitEnv)).toBe("0");
    expect(explicitEnv[CODEGRAPH_TELEMETRY_ENV]).toBe("0");
  });

  test("runs JavaScript CodeGraph shims through the current runtime", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-codegraph-shim-"));
    const logPath = join(root, "codegraph-log.json");
    const shimPath = join(root, "fake-codegraph.js");
    try {
      mkdirSync(join(root, ".codegraph"));
      writeFileSync(shimPath, `
import { writeFileSync } from "node:fs";
${readyStatusCommands(root)}
writeFileSync(${JSON.stringify(logPath)}, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  execPath: process.execPath
}));
`);

      const provider = new CodeGraphSdkProvider(shimPath, fakeReadProvider(root));
      await provider.indexAll(root);

      expect(existsSync(logPath)).toBe(true);
      const log = JSON.parse(readFileSync(logPath, "utf8")) as { argv: string[]; cwd: string; execPath: string };
      expect(log.argv).toEqual(["sync", root, "--quiet"]);
      expect(realpathSync.native(log.cwd)).toBe(realpathSync.native(root));
      expect(log.execPath).toBe(process.execPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("uses PATH before the packaged CodeGraph dependency", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-codegraph-path-precedence-"));
    const pathShim = join(root, "codegraph");
    try {
      writeFileSync(pathShim, "#!/usr/bin/env node\n");
      chmodSync(pathShim, 0o755);

      expect(codeGraphCliInvocation("codegraph", root, root)).toEqual({
        command: process.execPath,
        argsPrefix: [realpathSync.native(pathShim)]
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("ignores a non-executable PATH collision when resolving the default command", () => {
    if (process.platform === "win32") return;
    const root = mkdtempSync(join(tmpdir(), "archctx-codegraph-path-collision-"));
    const collision = join(root, "codegraph");
    try {
      writeFileSync(collision, "not an executable\n", { mode: 0o644 });

      const invocation = codeGraphCliInvocation("codegraph", root, root);
      expect(invocation.command).toBe(process.execPath);
      expect(invocation.argsPrefix[0]).toEndWith(join("node_modules", "@colbymchenry", "codegraph", "npm-shim.js"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("uses the packaged CodeGraph dependency only for the unresolved default command", () => {
    const packaged = codeGraphCliInvocation("codegraph", process.cwd(), "");
    expect(packaged.command).toBe(process.execPath);
    expect(packaged.argsPrefix).toHaveLength(1);
    expect(packaged.argsPrefix[0]).toEndWith(join("node_modules", "@colbymchenry", "codegraph", "npm-shim.js"));

    expect(codeGraphCliInvocation("team-codegraph", process.cwd(), "")).toEqual({
      command: "team-codegraph",
      argsPrefix: []
    });
  });

  test("extracts import edges from CodeGraph import nodes scoped by changed paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-codegraph-import-edge-"));
    const logPath = join(root, "codegraph-query-log.json");
    const shimPath = join(root, "fake-codegraph.js");
    try {
      // Import targets resolve against the Git-visible files, so the fixture is a checkout.
      execFileSync("git", ["init", "-q"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      mkdirSync(join(root, ".codegraph"), { recursive: true });
      mkdirSync(join(root, "src", "web"), { recursive: true });
      mkdirSync(join(root, "src", "domain"), { recursive: true });
      writeFileSync(join(root, "src", "domain", "order-service.ts"), "export const orderService = true;\n", "utf8");
      writeFileSync(join(root, "src", "web", "page.ts"), "import { orderService } from \"../domain/order-service\";\nexport const page = orderService;\n", "utf8");
      writeFileSync(shimPath, `
const args = process.argv.slice(2);
${readyStatusCommands(root)}
if (args[0] === "sync") process.exit(0);
console.error("unexpected fake codegraph args", args);
process.exit(2);
`);
      const searches: { query: string; options: unknown }[] = [];
      const nodes = [
        { id: "import:order-service", kind: "import", name: "../domain/order-service", qualifiedName: "../domain/order-service", filePath: "src/web/page.ts", language: "typescript", startLine: 1, endLine: 1 },
        { id: "file:src/web/page.ts", kind: "file", name: "page.ts", qualifiedName: "src/web/page.ts", filePath: "src/web/page.ts", language: "typescript", startLine: 1, endLine: 2 }
      ];
      const provider = sdkReadProvider(root, {
        findRelevantContext: async () => ({ nodes: new Map([[nodes[1]!.id, nodes[1]]]), edges: [], roots: [nodes[1]!.id] }),
        getNodesInFiles: () => [nodes[1]],
        generatedFilePredicate: () => () => false,
        searchNodes: (query: string, options: unknown) => {
          searches.push({ query, options });
          writeFileSync(logPath, JSON.stringify(searches));
          return nodes.map((node) => ({ node, score: 1 }));
        }
      });

      const adapter = new CodeGraphAdapter(new CodeGraphSdkProvider(shimPath, provider));
      await adapter.sync({
        workspace: { root, repositoryId: "repo.test", headSha: "abc" },
        changedPaths: [" src\\web\\page.ts", "../escape.ts", "/tmp/escape.ts"]
      });
      const context = await adapter.buildTaskContext({
        workspace: { root, repositoryId: "repo.test", headSha: "abc" },
        task: "respect dependency layer import",
        maxSymbols: 6,
        includeSource: false,
        changedPaths: [" src\\web\\page.ts", "../escape.ts", "/tmp/escape.ts"]
      });

      expect(context.edges).toEqual([{
        source: "file:src/web/page.ts",
        target: "file:src/domain/order-service.ts",
        kind: "imports",
        confidence: "high"
      }]);
      expect(context.digest).toMatch(/^sha256:/);
      const log = JSON.parse(readFileSync(logPath, "utf8")) as { query: string; options: { kinds?: string[] } }[];
      expect(log.at(-1)!.options.kinds).toEqual(["import"]);
      expect(log.at(-1)!.query).toContain("src/web/page.ts");
      expect(log.at(-1)!.query).toContain("import");
      expect(log.at(-1)!.query).not.toContain("respect dependency layer import");
      expect(log.at(-1)!.query).not.toContain("escape.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("aggregates per-repo contexts with stable repo-scoped symbol ids", async () => {
    const web = new MockCodeGraphProvider();
    const api = new MockCodeGraphProvider();
    const adapter = new MultiRepoCodeGraphAdapter({ "repo.web": web, "repo.api": api });
    const workspaces = [
      { root: "/tmp/web", repositoryId: "repo.web", headSha: "abc" },
      { root: "/tmp/api", repositoryId: "repo.api", headSha: "def" }
    ];

    await adapter.syncRepositories(workspaces);
    const context = await adapter.buildLandscapeTaskContext({
      task: "change checkout subscription flow",
      workspaces,
      maxSymbols: 4,
      includeSource: false
    });

    expect(web.indexedRoots).toContain("/tmp/web");
    expect(api.indexedRoots).toContain("/tmp/api");
    expect(context.symbols.map((symbol) => symbol.id)).toEqual([
      "repo.web::symbol.preparetask",
      "repo.api::symbol.preparetask"
    ]);
    expect(context.symbols.map((symbol) => symbol.path)).toEqual([
      "repo.web:packages/core/application/src/index.ts",
      "repo.api:packages/core/application/src/index.ts"
    ]);
    expect(context.digest).toMatch(/^sha256:/);
    // Each repository's context is read from its own workspace only.
    expect([web.readRoots, api.readRoots]).toEqual([["/tmp/web"], ["/tmp/api"]]);
  });

  test("a read is served only for the workspace whose own sync succeeded, at the identity it verified", async () => {
    const A = { root: "/tmp/worktree-a", repositoryId: "repo.test", headSha: "a" };
    const B = { root: "/tmp/worktree-b", repositoryId: "repo.test", headSha: "b" };
    const read = (adapter: CodeGraphAdapter, workspace: typeof A) => adapter.buildTaskContext({ workspace, task: "t", maxSymbols: 1, includeSource: false });
    const refusal = async (run: Promise<unknown>) => { const error = await run.then(() => undefined, (caught: unknown) => caught) as FailureError; return [error.code, error.reasonCode, error.retryable]; };
    class Provider extends MockCodeGraphProvider {
      identities = new Map<string, string | undefined>();
      targets: { root: string; identity?: string }[] = [];
      readyChecks: string[] = [];
      override async indexAll(root: string): Promise<void> {
        if (root === B.root) throw new Error("sync timed out");
        await super.indexAll(root);
      }
      override indexIdentity(root?: string): string | undefined { const key = root ?? A.root; return this.identities.has(key) ? this.identities.get(key) : "id-1"; }
      assertReady(root: string): void { this.readyChecks.push(root); }
      override async buildContext(target: { root: string; identity?: string }, task: string, options: { maxSymbols: number; includeSource: boolean }) {
        this.targets.push(target);
        return super.buildContext(target, task, options);
      }
    }
    // [label, run against a fresh adapter, expected]
    const cases: [string, (adapter: CodeGraphAdapter, provider: Provider) => Promise<unknown>, unknown][] = [
      ["A, then a failed sync of B, then A: A is read, B is refused", async (adapter, provider) => {
        await adapter.sync({ workspace: A });
        await adapter.sync({ workspace: B }).catch(() => undefined);
        const refusedB = await refusal(read(adapter, B));
        await adapter.ensureReady(A);
        await read(adapter, A);
        return { refusedB, synced: provider.indexedRoots, read: provider.targets };
      }, { refusedB: ["AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", true], synced: [A.root], read: [{ root: A.root, identity: "id-1" }] }],
      ["a read path verifies an unseen index and a changed identity read-only, and never syncs", async (adapter, provider) => {
        await adapter.ensureReady(A);
        provider.identities.set(A.root, "id-2");
        await adapter.ensureReady(A);
        await read(adapter, A);
        return { synced: provider.indexedRoots, readyChecks: provider.readyChecks, read: provider.targets };
      }, { synced: [], readyChecks: [A.root, A.root], read: [{ root: A.root, identity: "id-2" }] }],
      ["a command that owns a sync syncs an unseen workspace once", async (adapter, provider) => {
        await adapter.ensureReady(A, { syncOnMiss: true });
        await adapter.ensureReady(A, { syncOnMiss: true });
        return { synced: provider.indexedRoots, readyChecks: provider.readyChecks };
      }, { synced: [A.root], readyChecks: [A.root] }],
      ["an identity archctx cannot verify never serves a read, also after an earlier success", async (adapter, provider) => {
        await adapter.sync({ workspace: A });
        provider.identities.set(A.root, undefined);
        const ready = await refusal(adapter.ensureReady(A));
        const reading = await refusal(read(adapter, A));
        await adapter.sync({ workspace: A });
        const afterSync = await refusal(read(adapter, A));
        return { ready, reading, afterSync, read: provider.targets };
      }, { ready: ["AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", true], reading: ["AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", true], afterSync: ["AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", true], read: [] }],
      ["cold read-only ensureReady binds resolveEvidence without starting a writable sync", async (adapter, provider) => {
        const snapshotB = await adapter.ensureReady(B);
        const evidence = await adapter.resolveEvidence([{ path: "src/a.ts" }]);
        return {
          synced: provider.indexedRoots,
          readyChecks: provider.readyChecks,
          snapshots: evidence.map((item) => item.snapshot),
          matchesDigest: evidence[0]?.snapshot.worktreeDigest === snapshotB.workspaceDigest
        };
      }, { synced: [], readyChecks: [B.root], snapshots: [{ repositoryId: B.repositoryId, headSha: B.headSha, worktreeDigest: digestJson({ root: B.root, changedPaths: [] }) }], matchesDigest: true }],
      ["sync(A) then read-only ensureReady(B) binds resolveEvidence to B and keeps explicit A lookup", async (adapter, provider) => {
        const snapshotA = await adapter.sync({ workspace: A, changedPaths: ["src/a.ts"] });
        const snapshotB = await adapter.ensureReady(B);
        const latestEvidence = await adapter.resolveEvidence([{ path: "src/b.ts" }]);
        const explicitA = await adapter.resolveEvidence([{ path: "src/a.ts" }], A);
        provider.identities.set(B.root, undefined);
        await adapter.ensureReady(B).catch(() => undefined);
        const afterFailedB = await adapter.resolveEvidence([{ path: "src/b.ts" }]).then(() => "ok", (error: Error) => error.message);
        const explicitAAfterFail = await adapter.resolveEvidence([{ path: "src/a.ts" }], A);
        return {
          synced: provider.indexedRoots,
          latestIsB: latestEvidence[0]?.snapshot.worktreeDigest === snapshotB.workspaceDigest && latestEvidence[0]?.snapshot.headSha === B.headSha,
          explicitIsA: explicitA[0]?.snapshot.worktreeDigest === snapshotA.workspaceDigest && explicitA[0]?.snapshot.headSha === A.headSha,
          afterFailedB,
          explicitAAfterFailIsA: explicitAAfterFail[0]?.snapshot.worktreeDigest === snapshotA.workspaceDigest
        };
      }, { synced: [A.root], latestIsB: true, explicitIsA: true, afterFailedB: "CodeGraph snapshot unavailable; call ensureReady first", explicitAAfterFailIsA: true }]
    ];
    for (const [label, run, expected] of cases) {
      const provider = new Provider();
      expect([label, await run(new CodeGraphAdapter(provider), provider)]).toEqual([label, expected]);
    }
  });

  test("returns cross-repo impact for the touched repository only", () => {
    const adapter = new MultiRepoCodeGraphAdapter({});
    const relation = {
      schemaVersion: "archcontext.cross-repo-relation/v1" as const,
      id: "relation.web-calls-api",
      kind: "calls" as const,
      source: { repositoryId: "repo.web", nodeId: "module.checkout-ui" },
      target: { repositoryId: "repo.api", nodeId: "module.billing-api" },
      via: { kind: "interface" as const, id: "interface.billing-http" },
      intent: "checkout to billing"
    };
    expect(adapter.crossRepoImpact([relation], "repo.api")).toEqual([relation]);
    expect(adapter.crossRepoImpact([relation], "repo.worker")).toEqual([]);
  });

  test("a read the session refuses fails closed, and an index that moves during the read is retryable", async () => {
    const graph = { searchNodes: () => [], generatedFilePredicate: () => () => false };
    const failingRead = () => { throw new Error("private raw provider error /outside/repository"); };
    // The revision answers at open, then every later revision check throws: the move is unprovable.
    const revisionCheckThrows = () => {
      let reads = 0;
      return { getIndexRevision: () => { if (reads++ > 0) failingRead(); return { lastIndexedAt: 1, fileCount: 1 }; } };
    };
    // [label, provider, code, reason, retryable, handles opened, close attempts]
    const cases: [string, (root: string) => FakeReadProvider, string, string, boolean, number, number][] = [
      ["no index", (root) => { const provider = sdkReadProvider(root, graph); rmSync(join(root, ".codegraph"), { recursive: true, force: true }); return provider; }, "AC_CODE_FACTS_UNAVAILABLE", "index-missing", true, 0, 0],
      ["open fails", (root) => sdkReadProvider(root, graph, { openFails: true }), "AC_CODE_FACTS_UNAVAILABLE", "index-open-failed", false, 1, 0],
      ["build lock", (root) => { const provider = sdkReadProvider(root, graph); writeFileSync(join(root, ".codegraph", "codegraph.lock"), String(process.pid)); return provider; }, "AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", true, 0, 0],
      ["revision moves", (root) => sdkReadProvider(root, graph, { revisionMoves: true }), "AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", true, 1, 1],
      // A read that throws because the index moved under it is the same retryable refusal (G4).
      ["read throws while the index moves", (root) => sdkReadProvider(root, { ...graph, searchNodes: failingRead }, { revisionMoves: true }), "AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", true, 1, 1],
      // A revision check that throws proves no move, so a good read is unusable, never retryable.
      ["the revision check throws after a good read", (root) => sdkReadProvider(root, { ...graph, ...revisionCheckThrows() }), "AC_CODE_FACTS_UNAVAILABLE", "index-open-failed", false, 1, 1],
      // A failing close keeps the read's own error, and after a good read it is the read failure.
      ["read and close throw", (root) => sdkReadProvider(root, { ...graph, searchNodes: failingRead, close: failingRead }), "AC_CODE_FACTS_UNAVAILABLE", "index-open-failed", false, 1, 1],
      ["close throws after a good read", (root) => sdkReadProvider(root, { ...graph, close: failingRead }), "AC_CODE_FACTS_UNAVAILABLE", "index-open-failed", false, 1, 1],
      ["close throws after a good read of a moved index", (root) => sdkReadProvider(root, { ...graph, close: failingRead }, { revisionMoves: true }), "AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", true, 1, 1],
      ["close throws after a failing read of a moved index", (root) => sdkReadProvider(root, { ...graph, searchNodes: failingRead, close: failingRead }, { revisionMoves: true }), "AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", true, 1, 1]
    ];
    for (const [label, provide, code, reasonCode, retryable, opened, closeAttempts] of cases) {
      const root = mkdtempSync(join(tmpdir(), "archctx-codegraph-read-refusal-"));
      try {
        const provider = provide(root);
        // Counts every close the read attempts, including one that throws.
        let attempts = 0;
        const counted: FakeReadProvider = { ...provider, openReadOnly: (openedRoot) => {
          const handle = provider.openReadOnly(openedRoot);
          const close = handle.close.bind(handle);
          return Object.assign(handle, { close: () => { attempts++; close(); } });
        } };
        const failure = await readFailure(new CodeGraphSdkProvider(undefined, counted).findSymbols({ root }, { query: "render" }));
        expect([label, failure.code, failure.reasonCode, failure.retryable]).toEqual([label, code, reasonCode, retryable]);
        expect([label, provider.calls.open, attempts]).toEqual([label, opened, closeAttempts]);
        expect(failure.message).not.toContain("outside");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test("a provider that cannot load is code-facts-unavailable, as the readiness gate maps it", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-codegraph-provider-unavailable-"));
    const open = spyOn(readSessionModule, "openCodeGraphReadSession").mockImplementation(() => {
      throw new CodeGraphProviderUnavailableError("CodeGraph SDK could not be loaded from /outside/repository");
    });
    try {
      const failure = await readFailure(new CodeGraphSdkProvider().findSymbols({ root }, { query: "render" }));
      expect([failure.code, failure.reasonCode, failure.action, failure.retryable]).toEqual(["AC_CODE_FACTS_UNAVAILABLE", "code-facts-unavailable", "inspect-diagnostics", false]);
      expect(failure.message).not.toContain("outside");
      expect(open).toHaveBeenCalledTimes(1);
    } finally {
      open.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("CodeGraphSdkProvider SDK reads on a real index (#574)", () => {
  const files: Record<string, string> = {
    "src/pricing/leaf.ts": "export function basePrice(sku: string): number {\n  return sku.length;\n}\n",
    "src/pricing/tax.ts": "import { basePrice } from \"./leaf\";\n\nexport function taxedPrice(sku: string): number {\n  return basePrice(sku) * 2;\n}\n",
    "src/checkout/cart.ts": "import { taxedPrice } from \"../pricing/tax\";\n\nexport function cartTotal(skus: string[]): number {\n  return skus.reduce((sum, sku) => sum + taxedPrice(sku), 0);\n}\n",
    "src/views/page.ts": "export function render(): string {\n  return \"page\";\n}\n\nexport function showPage(): string {\n  return render();\n}\n",
    "src/views/widget.ts": "export class Widget {\n  render(): string {\n    return \"widget\";\n  }\n}\n\nexport function showWidget(widget: Widget): string {\n  return widget.render();\n}\n",
    "src/pricing/sku.ts": "export interface Sku {\n  code: string;\n}\n",
    "src/checkout/label.ts": "import type { Sku } from \"../pricing/sku\";\n\nexport function label(sku: Sku): string {\n  return sku.code;\n}\n"
  };
  let root = "";
  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-codegraph-sdk-reads-")));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    execFileSync("git", ["init", "-q"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    indexCodeGraphFixture(root);
  }, 120_000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  const symbolId = async (query: string, kind: string) => (await new CodeGraphSdkProvider().findSymbols({ root }, { query, kinds: [kind] }))[0]!.id;

  test("buildContext returns the query nodes, then the relevant files in relevance order, deterministically", async () => {
    const provider = new CodeGraphSdkProvider();
    const build = () => provider.buildContext({ root }, "basePrice", { maxSymbols: 4, includeSource: false });
    const context = await build();
    // `basePrice` is the only search hit; the files come from its relevant context, its own file
    // and its caller's before the caller's caller.
    expect(context.symbols.map((symbol) => [symbol.kind, symbol.name, symbol.path, symbol.range])).toEqual([
      ["function", "basePrice", "src/pricing/leaf.ts", { startLine: 1, endLine: 3 }],
      ["file", "leaf.ts", "src/pricing/leaf.ts", { startLine: 1, endLine: 4 }],
      ["file", "tax.ts", "src/pricing/tax.ts", { startLine: 1, endLine: 6 }],
      ["file", "cart.ts", "src/checkout/cart.ts", { startLine: 1, endLine: 6 }]
    ]);
    expect(context.symbols[0]!.id).toBe(await symbolId("basePrice", "function"));
    expect(context.edges).toEqual([{ source: "file:src/pricing/tax.ts", target: "file:src/pricing/leaf.ts", kind: "imports", confidence: "high" }]);
    expect(context.evidence.map((item) => item.selector.symbolId)).toEqual(context.symbols.map((symbol) => symbol.id));
    expect(await build()).toEqual(context);
  });

  test("a read checks, once open, that the database is the one its target verified", async () => {
    const provider = new CodeGraphSdkProvider();
    const identity = provider.indexIdentity(root);
    expect(identity).toMatch(/^\d+:\d+:\d+$/);
    expect((await provider.findSymbols({ root, identity }, { query: "render" })).length).toBeGreaterThan(0);
    const stale = await readFailure(provider.findSymbols({ root, identity: "0:0:0" }, { query: "render" }));
    expect([stale.code, stale.reasonCode, stale.retryable]).toEqual(["AC_CODE_FACTS_NOT_READY", "code-facts-not-ready", true]);
    // With CODEGRAPH_DIR set, the SDK resolves another directory than the one archctx checks.
    const saved = process.env.CODEGRAPH_DIR;
    process.env.CODEGRAPH_DIR = ".codegraph-alt";
    try {
      expect(provider.indexIdentity(root)).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.CODEGRAPH_DIR; else process.env.CODEGRAPH_DIR = saved;
    }
  });

  test("findSymbols keeps only the requested kinds", async () => {
    const provider = new CodeGraphSdkProvider();
    expect(await provider.findSymbols({ root }, { query: "render", kinds: ["method"] })).toEqual([
      { id: expect.stringMatching(/^method:[0-9a-f]{32}$/), name: "render", kind: "method", path: "src/views/widget.ts", range: { startLine: 2, endLine: 4 } }
    ]);
    expect((await provider.findSymbols({ root }, { query: "render", kinds: ["function"] })).map((symbol) => [symbol.kind, symbol.path])).toEqual([["function", "src/views/page.ts"]]);
    // Unfiltered, both definitions tie on the search; the file path breaks the tie.
    expect((await provider.findSymbols({ root }, { query: "render" })).map((symbol) => [symbol.kind, symbol.path])).toEqual([
      ["function", "src/views/page.ts"],
      ["method", "src/views/widget.ts"]
    ]);
  });

  test("a write the read-only handle refuses inside an SDK call is a read failure, never retried writable", async () => {
    const pinned = pinnedCodeGraphProvider();
    const { CodeGraph } = codeGraphBundle().sdk;
    const sdkOpen = { open: CodeGraph.open, openSync: CodeGraph.openSync };
    const opens: unknown[] = [];
    const refusals: string[] = [];
    let closes = 0;
    const provider: CodeGraphReadProvider = {
      ...pinned,
      openReadOnly: (openedRoot) => {
        const graph = pinned.openReadOnly(openedRoot);
        const close = graph.close.bind(graph);
        graph.close = () => { closes++; close(); };
        const findRelevantContext = graph.findRelevantContext.bind(graph);
        // Fault injection: CodeGraph 1.6.2's findRelevantContext makes no heal write, so this wrapper
        // makes one, a real write through the read-only handle's database, which SQLite refuses.
        graph.findRelevantContext = async (query, options) => {
          try { (graph as unknown as { queries: { insertNameSegmentsBatch(names: string[]): void } }).queries.insertNameSegmentsBatch(["healed"]); }
          catch (error) { refusals.push(String(error)); throw error; }
          return findRelevantContext(query, options);
        };
        return graph;
      }
    };
    CodeGraph.open = ((...args: Parameters<typeof CodeGraph.open>) => { opens.push(["open", args[1]]); return sdkOpen.open.apply(CodeGraph, args); }) as typeof CodeGraph.open;
    CodeGraph.openSync = ((...args: Parameters<typeof CodeGraph.openSync>) => { opens.push(["openSync", args[1]]); return sdkOpen.openSync.apply(CodeGraph, args); }) as typeof CodeGraph.openSync;
    let failure: FailureError;
    try {
      failure = await readFailure(new CodeGraphSdkProvider(undefined, provider).buildContext({ root }, "basePrice", { maxSymbols: 4, includeSource: false }));
    } finally {
      Object.assign(CodeGraph, sdkOpen);
    }
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain("readonly");
    expect([failure.code, failure.reasonCode]).toEqual(["AC_CODE_FACTS_UNAVAILABLE", "index-open-failed"]);
    expect(failure.message).not.toContain("readonly");
    expect(opens).toEqual([["openSync", { readOnly: true }]]);
    expect(closes).toBe(1);
  });
});

describe("CodeGraph symbol reader (#298)", () => {
  test("a failed read-only open is index-open-failed and is never retried writable", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-symbol-reader-"));
    try {
      mkdirSync(join(root, ".codegraph"));
      const calls: unknown[] = [];
      const result = openCodeGraphSymbolReader(root, (_root, options) => {
        calls.push(options);
        throw new Error("unable to open database file");
      });
      expect(result).toEqual({ availability: "unavailable", reasonCode: "index-open-failed" });
      expect(calls).toEqual([{ readOnly: true }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/** A scratch repository with one commit; its base directory lives in its own `.git`. */
function baseIndexRepository(prefix: string): { primary: string; baseDir: string; git: (...args: string[]) => string; commit: (message: string) => void; cleanup: () => void } {
  const parent = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  const primary = join(parent, "primary");
  mkdirSync(join(primary, "src"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: primary, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  for (const [key, value] of [["gc.auto", "0"], ["maintenance.auto", "false"], ["core.hooksPath", join(parent, "no-hooks")]] as const) git("config", key, value);
  const commit = (message: string) => { git("add", "-A", "--", "src"); git("-c", "user.name=Base Test", "-c", "user.email=base@example.test", "commit", "-qm", message); };
  writeFileSync(join(primary, "src/a.ts"), "export function a(): number {\n  return 1;\n}\n");
  commit("base");
  return { primary, baseDir: codeGraphBaseDirectory(join(primary, ".git")), git, commit, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

/** Publishes `bytes` as the base, as a refresh would. */
function publishBase(baseDir: string, headSha: string, bytes = "base index bytes"): string {
  mkdirSync(baseDir, { recursive: true });
  const snapshot = `base-${randomUUID()}.db`;
  writeFileSync(join(baseDir, snapshot), bytes);
  writeFileSync(join(baseDir, "current.json"), JSON.stringify({ schemaVersion: "archcontext.codegraph-base/v1", codeGraphVersion: REQUIRED_CODEGRAPH_VERSION, extractionVersion: 7, headSha, snapshot, createdAt: new Date(0).toISOString() }));
  return snapshot;
}

/** Runs `run` with `CODEGRAPH_DIR` set in this process, as a user's shell can set it. */
function withCodeGraphDir<T>(name: string, run: () => T): T {
  const saved = process.env.CODEGRAPH_DIR;
  process.env.CODEGRAPH_DIR = name;
  try { return run(); }
  finally { if (saved === undefined) delete process.env.CODEGRAPH_DIR; else process.env.CODEGRAPH_DIR = saved; }
}

/** The two ways a path gets a new identity with old bytes: a backup restore (timestamps kept) and a same-bytes re-creation. */
const REPLACEMENTS: [string, (path: string) => void][] = [
  ["a backup restore", (path) => { const backup = `${path}.backup`; cpSync(path, backup, { recursive: true, preserveTimestamps: true }); rmSync(path, { recursive: true }); renameSync(backup, path); }],
  ["a same-bytes re-creation", (path) => {
    const stat = lstatSync(path);
    const files = stat.isDirectory() ? readdirSync(path).map(name => [name, readFileSync(join(path, name))] as const) : [];
    const bytes = stat.isDirectory() ? undefined : readFileSync(path);
    rmSync(path, { recursive: true });
    if (bytes) writeFileSync(path, bytes);
    else { mkdirSync(path); for (const [name, content] of files) writeFileSync(join(path, name), content); }
    utimesSync(path, stat.atime, stat.mtime);
  }]
];

function thrown(run: () => unknown): { code?: string; reasonCode?: string; retryable?: boolean } {
  try { run(); } catch (error) { return error as { code?: string; reasonCode?: string; retryable?: boolean }; }
  throw new Error("expected a refusal");
}

describe("base index seed and refresh (#608)", () => {
  test("prepareSync seeds only from a published base, and refuses what it cannot seed", () => {
    if (process.platform === "win32") return; // The seed is off on Windows.
    // [label, setup of the linked worktree and the base, code, reason]
    const cases: [string, (input: { worktree: string; baseDir: string; head: string }) => void, string, string][] = [
      ["no base", () => undefined, "AC_CODE_FACTS_UNAVAILABLE", "index-missing"],
      ["no base yet, a refresh is running", ({ baseDir }) => { mkdirSync(baseDir, { recursive: true }); writeFileSync(join(baseDir, "refresh.lock"), String(process.pid)); }, "AC_CODE_FACTS_UNAVAILABLE", "index-base-building"],
      ["a linked .codegraph, with a base", ({ worktree, baseDir, head }) => { publishBase(baseDir, head); symlinkSync(baseDir, join(worktree, ".codegraph"), process.platform === "win32" ? "junction" : "dir"); }, "AC_CODE_FACTS_UNAVAILABLE", "index-open-failed"]
    ];
    for (const [label, setup, code, reasonCode] of cases) {
      const repo = baseIndexRepository("archctx-base-refusal-");
      try {
        const worktree = join(dirname(repo.primary), "linked");
        repo.git("worktree", "add", "-q", worktree);
        setup({ worktree, baseDir: repo.baseDir, head: repo.git("rev-parse", "HEAD").trim() });
        const before = existsSync(repo.baseDir) ? readdirSync(repo.baseDir).sort() : [];
        // The provider is never opened on these paths; its fake index lives outside the worktree.
        const provider = fakeReadProvider(join(dirname(repo.primary), "unused"));
        const failure = thrown(() => new CodeGraphSdkProvider(undefined, provider).prepareSync(worktree));
        expect([label, failure.code, failure.reasonCode]).toEqual([label, code, reasonCode]);
        if (reasonCode === "index-base-building") expect(failure.retryable).toBe(true);
        expect([label, existsSync(repo.baseDir) ? readdirSync(repo.baseDir).sort() : []]).toEqual([label, before]);
        expect([label, existsSync(join(repo.baseDir, "codegraph.db"))]).toEqual([label, false]);
        if (!lstatSync(join(worktree, ".codegraph"), { throwIfNoEntry: false })?.isSymbolicLink()) expect([label, existsSync(join(worktree, ".codegraph"))]).toEqual([label, false]);
      } finally {
        repo.cleanup();
      }
    }
  });

  test("a read-only inspection never seeds", () => {
    const repo = baseIndexRepository("archctx-base-read-only-");
    try {
      const worktree = join(dirname(repo.primary), "linked");
      repo.git("worktree", "add", "-q", worktree);
      publishBase(repo.baseDir, repo.git("rev-parse", "HEAD").trim());
      expect(inspectRepositoryCodeFacts(worktree, { provider: fakeReadProvider(join(dirname(repo.primary), "unused")) })).toMatchObject({ state: "index-missing" });
      expect(existsSync(join(worktree, ".codegraph"))).toBe(false);
    } finally {
      repo.cleanup();
    }
  });

  test("the seed declines a destination it cannot prove, and leaves every existing entry as it was", () => {
    const header = "# CodeGraph data files — local to each machine, not for committing.\ncodegraph.db\ncodegraph.db-wal\ncodegraph.db-shm\n";
    // [label, setup of `.codegraph` in the linked worktree; returns the entries to compare]
    const cases: [string, (dir: string, worktree: string) => string[]][] = [
      ...["codegraph.db-wal", "codegraph.db-shm", "codegraph.db-journal", "codegraph.lock", "daemon.pid"].map((name): [string, (dir: string) => string[]] => [`a leftover ${name}`, (dir) => { mkdirSync(dir); writeFileSync(join(dir, name), "999999"); return [join(dir, name)]; }]),
      ["a linked .gitignore", (dir, worktree) => { mkdirSync(dir); writeFileSync(join(worktree, "ignore-target"), "*\n"); symlinkSync(join(worktree, "ignore-target"), join(dir, ".gitignore")); return [join(dir, ".gitignore")]; }],
      ["a .gitignore the provider would rewrite", (dir) => { mkdirSync(dir); writeFileSync(join(dir, ".gitignore"), header); return [join(dir, ".gitignore")]; }],
      ["the same, with a space before the header", (dir) => { mkdirSync(dir); writeFileSync(join(dir, ".gitignore"), ` ${header}`); return [join(dir, ".gitignore")]; }],
      ["the same, with a byte-order mark", (dir) => { mkdirSync(dir); writeFileSync(join(dir, ".gitignore"), `﻿${header}`); return [join(dir, ".gitignore")]; }],
      ["a .gitignore that does not ignore the database", (dir) => { mkdirSync(dir); writeFileSync(join(dir, ".gitignore"), "*.log\n"); return [join(dir, ".gitignore")]; }],
      ["a database path tracked by Git", (dir, worktree) => { mkdirSync(dir); writeFileSync(join(dir, "codegraph.db"), ""); execFileSync("git", ["add", "-f", ".codegraph/codegraph.db"], { cwd: worktree }); unlinkSync(join(dir, "codegraph.db")); writeFileSync(join(dir, ".gitignore"), "*\n"); return [join(dir, ".gitignore")]; }],
      ["a linked .codegraph", (dir, worktree) => { mkdirSync(join(worktree, "elsewhere")); symlinkSync(join(worktree, "elsewhere"), dir, process.platform === "win32" ? "junction" : "dir"); return [dir]; }]
    ];
    const fingerprint = (path: string) => { const stat = lstatSync(path, { bigint: true }); return [stat.ino, stat.isSymbolicLink() ? readlinkSync(path) : stat.isFile() ? readFileSync(path, "utf8") : "dir"]; };
    for (const [label, setup] of cases) {
      const repo = baseIndexRepository("archctx-base-destination-");
      try {
        const worktree = join(dirname(repo.primary), "linked");
        repo.git("worktree", "add", "-q", worktree);
        publishBase(repo.baseDir, repo.git("rev-parse", "HEAD").trim());
        const entries = setup(join(worktree, ".codegraph"), worktree);
        const before = entries.map(fingerprint);
        expect([label, seedCodeGraphIndexFromBase(worktree)]).toEqual([label, "declined"]);
        expect([label, entries.map(fingerprint)]).toEqual([label, before]);
        expect([label, existsSync(join(worktree, ".codegraph", "codegraph.db")), readdirSync(worktree).filter(name => name.startsWith(".codegraph-seed-"))]).toEqual([label, false, []]);
      } finally {
        repo.cleanup();
      }
    }
  }, 30_000);

  test("the ignore-file predicate is the pinned provider's, leading whitespace and byte-order mark included", () => {
    const validateDirectory = (require(join(codeGraphBundle().dist, "directory.js")) as { validateDirectory(root: string): unknown }).validateDirectory;
    const header = "# CodeGraph data files\ncodegraph.db\n";
    for (const content of [header, ` ${header}`, `\t${header}`, `﻿${header}`, `${header}*\n`, ` ${header} * \n`, "*.log\n", "*\n", `# mine\n${header}`]) {
      const root = mkdtempSync(join(tmpdir(), "archctx-gitignore-predicate-"));
      try {
        mkdirSync(join(root, ".codegraph"));
        writeFileSync(join(root, ".codegraph", ".gitignore"), content);
        validateDirectory(root);
        expect([JSON.stringify(content), readFileSync(join(root, ".codegraph", ".gitignore"), "utf8") !== content]).toEqual([JSON.stringify(content), codeGraphRewritesGitignore(content)]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test("the seed is off, and writes nothing, wherever its provider assumptions are unproven", () => {
    const withEnv = (name: string, value: string, run: () => unknown) => { const saved = process.env[name]; process.env[name] = value; try { return run(); } finally { if (saved === undefined) delete process.env[name]; else process.env[name] = saved; } };
    const withPlatform = (platform: string, run: () => unknown) => { const saved = Object.getOwnPropertyDescriptor(process, "platform")!; Object.defineProperty(process, "platform", { value: platform }); try { return run(); } finally { Object.defineProperty(process, "platform", saved); } };
    // [label, seed under the condition]
    const cases: [string, (worktree: string) => unknown][] = [
      ["CODEGRAPH_DIR set in archctx's own environment", (worktree) => withEnv("CODEGRAPH_DIR", ".codegraph-other", () => seedCodeGraphIndexFromBase(worktree))],
      ["a caller-named CodeGraph binary", (worktree) => seedCodeGraphIndexFromBase(worktree, { binary: "/usr/local/bin/codegraph" })],
      ["Windows", (worktree) => withPlatform("win32", () => seedCodeGraphIndexFromBase(worktree))],
      ["a platform bundle of another version", (worktree) => {
        const real = codeGraphBundle();
        const other = mkdtempSync(join(tmpdir(), "archctx-other-bundle-"));
        writeFileSync(join(other, "package.json"), JSON.stringify({ version: "0.0.0-other" }));
        const bundle = spyOn(readSessionModule, "codeGraphBundle").mockImplementation(() => ({ ...real, platformRoot: other }));
        try { return seedCodeGraphIndexFromBase(worktree); } finally { bundle.mockRestore(); rmSync(other, { recursive: true, force: true }); }
      }]
    ];
    for (const [label, seed] of cases) {
      const repo = baseIndexRepository("archctx-base-guard-");
      try {
        const worktree = join(dirname(repo.primary), "linked");
        repo.git("worktree", "add", "-q", worktree);
        publishBase(repo.baseDir, repo.git("rev-parse", "HEAD").trim());
        expect([label, seed(worktree)]).toEqual([label, "declined"]);
        expect([label, readdirSync(worktree).filter(name => name.startsWith(".codegraph"))]).toEqual([label, []]);
      } finally {
        repo.cleanup();
      }
    }
  });

  test("a seed attempt never removes another run's staging folder, and reports the abandoned ones, even beside a live index", () => {
    if (process.platform === "win32") return; // The seed is off on Windows.
    const repo = baseIndexRepository("archctx-base-reaper-");
    try {
      const worktree = join(dirname(repo.primary), "linked");
      repo.git("worktree", "add", "-q", worktree);
      const deadPid = spawnSync(process.execPath, ["-e", ""]).pid!;
      const staging = (pid: number, files: Record<string, string>) => {
        const dir = join(worktree, `.codegraph-seed-${pid}-${randomUUID()}`);
        mkdirSync(dir);
        for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content);
        return dir;
      };
      const tree = (dir: string) => readdirSync(dir).sort().map(name => { const path = join(dir, name); return [name, lstatSync(path).ino, readFileSync(path, "utf8")]; });
      const abandoned = staging(deadPid, { ".gitignore": "*\n", "codegraph.db": "x", "codegraph.db-wal": "", "codegraph.db-shm": "", "codegraph.lock": String(deadPid) });
      const liveOwner = staging(process.pid, { ".gitignore": "*\n", "codegraph.db": "x" });
      const liveWriter = staging(deadPid, { ".gitignore": "*\n", "codegraph.db": "x", "codegraph.lock": String(process.pid) });
      const unknownEntry = staging(deadPid, { ".gitignore": "*\n", "notes.txt": "keep" });
      // A crashed seed's folder whose WAL and lock were restored from a backup, beside a restored record.
      const restored = staging(deadPid, { ".gitignore": "*\n", "codegraph.db": "x", "codegraph.db-wal": "frames", "codegraph.lock": String(deadPid) });
      for (const name of ["codegraph.db-wal", "codegraph.lock"]) { const path = join(restored, name); cpSync(path, `${path}.backup`, { preserveTimestamps: true }); rmSync(path); renameSync(`${path}.backup`, path); }
      mkdirSync(join(repo.baseDir, "records"), { recursive: true });
      writeFileSync(join(repo.baseDir, "records", `${basename(restored)}@0-0-0`), "");
      mkdirSync(join(worktree, ".codegraph"));
      writeFileSync(join(worktree, ".codegraph", "codegraph.db"), "live index");
      const live = lstatSync(join(worktree, ".codegraph", "codegraph.db")).ino;
      const folders = [abandoned, liveOwner, liveWriter, unknownEntry, restored];
      const before = folders.map(tree);
      const kept: CodeGraphKeptPathV1[] = [];
      expect(seedCodeGraphIndexFromBase(worktree, { report: (path) => kept.push(path) })).toBe("present");
      expect(folders.map(tree)).toEqual(before);
      expect(readdirSync(join(repo.baseDir, "records"))).toEqual([`${basename(restored)}@0-0-0`]);
      expect(kept.map(({ path, kind }) => [path, kind]).sort()).toEqual([abandoned, unknownEntry, restored].map(path => [path, "abandoned-staging"]).sort());
      expect([lstatSync(join(worktree, ".codegraph", "codegraph.db")).ino, readFileSync(join(worktree, ".codegraph", "codegraph.db"), "utf8")]).toEqual([live, "live index"]);
    } finally {
      repo.cleanup();
    }
  });

  test("a refresh publishes only an unmoved snapshot of the primary checkout, under its lock", () => {
    const snapshotOf = (source: string, target: string) => writeFileSync(target, `snapshot of ${source}`);
    const headMovesOnce = () => { let reads = 0; return (root: string) => reads++ === 2 ? "0".repeat(40) : execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); };
    // [label, refresh, outcome]
    const cases: [string, (input: { primary: string; worktree: string; baseDir: string }) => string, string][] = [
      ["unmoved", ({ primary }) => refreshCodeGraphBase(primary, { provider: fakeReadProvider(primary), snapshot: snapshotOf }), "published"],
      ["the index revision moves during the snapshot", ({ primary }) => refreshCodeGraphBase(primary, { provider: fakeReadProvider(primary, { revisionMoves: true }), snapshot: snapshotOf }), "skipped-moved"],
      ["HEAD moves during the snapshot", ({ primary }) => refreshCodeGraphBase(primary, { provider: fakeReadProvider(primary), snapshot: snapshotOf, readHead: headMovesOnce() }), "skipped-moved"],
      ["another refresh holds the lock", ({ primary, baseDir }) => { mkdirSync(baseDir, { recursive: true }); writeFileSync(join(baseDir, "refresh.lock"), String(process.pid)); return refreshCodeGraphBase(primary, { provider: fakeReadProvider(primary), snapshot: () => { throw new Error("no snapshot under another lock"); } }); }, "skipped-busy"],
      ["a linked worktree", ({ worktree }) => refreshCodeGraphBase(worktree, { provider: fakeReadProvider(worktree), snapshot: snapshotOf }), "not-primary"],
      ["the database is re-created during the snapshot", ({ primary }) => refreshCodeGraphBase(primary, { provider: fakeReadProvider(primary), snapshot: (source, target) => { const database = join(primary, ".codegraph", "codegraph.db"); rmSync(database); writeFileSync(database, ""); snapshotOf(source, target); } }), "skipped-moved"],
      ["a stale refresh.lock", ({ primary, baseDir }) => { mkdirSync(baseDir, { recursive: true }); writeFileSync(join(baseDir, "refresh.lock"), "999999999"); return refreshCodeGraphBase(primary, { provider: fakeReadProvider(primary), snapshot: snapshotOf }); }, "skipped-unproven"],
      ["the SDK resolves another database than .codegraph/codegraph.db", ({ primary }) => withCodeGraphDir(".codegraph-alt", () => refreshCodeGraphBase(primary, { provider: fakeReadProvider(primary), snapshot: snapshotOf })), "skipped-unverifiable"]
    ];
    for (const [label, refresh, outcome] of cases) {
      const repo = baseIndexRepository("archctx-base-refresh-");
      try {
        const worktree = join(dirname(repo.primary), "linked");
        repo.git("worktree", "add", "-q", worktree);
        expect([label, refresh({ primary: repo.primary, worktree, baseDir: repo.baseDir })]).toEqual([label, outcome]);
        const snapshots = existsSync(repo.baseDir) ? readdirSync(repo.baseDir).filter(name => name.startsWith("base-")) : [];
        if (outcome === "published") {
          const pointer = JSON.parse(readFileSync(join(repo.baseDir, "current.json"), "utf8"));
          expect(pointer).toMatchObject({ schemaVersion: "archcontext.codegraph-base/v1", codeGraphVersion: REQUIRED_CODEGRAPH_VERSION, headSha: repo.git("rev-parse", "HEAD").trim(), snapshot: snapshots[0] });
          expect(snapshots).toHaveLength(1);
          expect(existsSync(join(repo.baseDir, "refresh.lock"))).toBe(false);
        } else {
          expect([label, existsSync(join(repo.baseDir, "current.json")), snapshots]).toEqual([label, false, []]);
        }
      } finally {
        repo.cleanup();
      }
    }
  });

  test("old unreferenced snapshots of its own version are reported for hand cleanup, never deleted", () => {
    const repo = baseIndexRepository("archctx-base-gc-");
    try {
      const refresh = () => refreshCodeGraphBase(repo.primary, { provider: fakeReadProvider(repo.primary), snapshot: (_source, target) => writeFileSync(target, "snapshot") });
      const moveHead = (n: number) => { writeFileSync(join(repo.primary, "src/a.ts"), `export const moved = ${n};\n`); repo.commit(`move HEAD ${n}`); };
      const pointed = () => JSON.parse(readFileSync(join(repo.baseDir, "current.json"), "utf8")).snapshot as string;
      expect(refresh()).toBe("published");
      const first = join(repo.baseDir, pointed());
      moveHead(1);
      expect(refresh()).toBe("published");
      const second = join(repo.baseDir, pointed());
      // The reporting refresh runs an hour later; `second` stays young by an mtime in that hour.
      const later = Date.now() + 60 * 60_000;
      utimesSync(second, new Date(later), new Date(later));
      const old = (path: string) => { writeFileSync(path, "x"); return path; };
      const otherVersion = join(dirname(repo.baseDir), "0.0.0-other");
      mkdirSync(otherVersion);
      const otherOld = old(join(repo.baseDir, `base-${randomUUID()}.db`));
      const foreignName = old(join(repo.baseDir, "notes.db"));
      const foreignVersion = old(join(otherVersion, `base-${randomUUID()}.db`));
      moveHead(2);
      const kept: CodeGraphKeptPathV1[] = [];
      expect(refreshCodeGraphBase(repo.primary, { provider: fakeReadProvider(repo.primary), snapshot: (_source, target) => writeFileSync(target, "snapshot"), report: (path) => kept.push(path), now: () => later })).toBe("published");
      const third = join(repo.baseDir, pointed());
      // Every file stays; only the old unreferenced snapshots of this version are reported.
      expect([first, second, third, otherOld, foreignName, foreignVersion].map(path => existsSync(path))).toEqual([true, true, true, true, true, true]);
      expect(kept.map(({ path, kind }) => [path, kind]).sort()).toEqual([first, otherOld].map(path => [path, "unreferenced-snapshot"]).sort());

      // CG-610-N1: repeated syncs on the same HEAD (`current`) still report snapshots that aged past
      // ten minutes and a stale refresh.lock, without reporting a live lock or the current snapshot.
      const evenLater = later + 20 * 60_000;
      const lock = join(repo.baseDir, "refresh.lock");
      writeFileSync(lock, "999999999");
      const keptCurrentStale: CodeGraphKeptPathV1[] = [];
      expect(refreshCodeGraphBase(repo.primary, { provider: fakeReadProvider(repo.primary), snapshot: (_source, target) => writeFileSync(target, "snapshot"), report: (path) => keptCurrentStale.push(path), now: () => evenLater })).toBe("current");
      expect(keptCurrentStale.map(({ path, kind }) => [path, kind]).sort()).toEqual([[first, "unreferenced-snapshot"], [second, "unreferenced-snapshot"], [otherOld, "unreferenced-snapshot"], [lock, "stale-refresh-lock"]].sort());

      writeFileSync(lock, String(process.pid));
      const keptCurrentLive: CodeGraphKeptPathV1[] = [];
      expect(refreshCodeGraphBase(repo.primary, { provider: fakeReadProvider(repo.primary), snapshot: (_source, target) => writeFileSync(target, "snapshot"), report: (path) => keptCurrentLive.push(path), now: () => evenLater })).toBe("current");
      expect(keptCurrentLive.map(({ path, kind }) => [path, kind]).sort()).toEqual([[first, "unreferenced-snapshot"], [second, "unreferenced-snapshot"], [otherOld, "unreferenced-snapshot"]].sort());
    } finally {
      repo.cleanup();
    }
  });

  test("StagingRun.remove preserves unrecorded entries even when creationIdentity is undefined (CG-610-N3)", () => {
    const dir = mkdtempSync(join(tmpdir(), "archctx-staging-n3-"));
    try {
      const staging = join(dir, `.codegraph-seed-${process.pid}-${randomUUID()}`);
      mkdirSync(staging);
      writeFileSync(join(staging, ".gitignore"), "*\n");
      const foreign = join(staging, "foreign.txt");
      writeFileSync(foreign, "user data");
      const run = new StagingRun(staging, (path) => path === foreign ? undefined : `id:${basename(path)}`);
      expect(run.ownFolder()).toBe(true);
      run.created(".gitignore");
      expect(run.remove()).toBe(false);
      expect(existsSync(staging)).toBe(true);
      expect(readFileSync(foreign, "utf8")).toBe("user data");
      expect(readFileSync(join(staging, ".gitignore"), "utf8")).toBe("*\n");

      const unowned = new StagingRun(staging, () => undefined);
      expect(unowned.ownFolder()).toBe(false);
      expect(unowned.remove()).toBe(false);
      expect(readFileSync(foreign, "utf8")).toBe("user data");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("pointer identity is recorded before rename (CG-610-10), and retained locks or pointer temps are reported (CG-610-N2)", () => {
    const repo = baseIndexRepository("archctx-base-n2-10-");
    try {
      mkdirSync(repo.baseDir, { recursive: true });
      const current = join(repo.baseDir, "current.json");
      const snapshot = `base-${randomUUID()}.db`;
      writeFileSync(join(repo.baseDir, snapshot), "snapshot");
      const pointerJson = `${JSON.stringify({ schemaVersion: "archcontext.codegraph-base/v1", codeGraphVersion: REQUIRED_CODEGRAPH_VERSION, extractionVersion: 7, headSha: repo.git("rev-parse", "HEAD").trim(), snapshot, createdAt: new Date(0).toISOString() }, null, 2)}\n`;
      const identityOf = (path: string) => { const stat = lstatSync(path, { bigint: true }); return `${stat.dev}-${stat.ino}-${stat.birthtimeNs}`; };

      // CG-610-10: records/current.json@<identity> is created on the temp file before renameSync.
      let tempIdentityBeforeRename = "";
      let recordPresentBeforeRename = false;
      let currentAbsentBeforeRename = false;
      const keptPublish: CodeGraphKeptPathV1[] = [];
      publishBasePointer(repo.baseDir, current, pointerJson, (item) => keptPublish.push(item), (temp) => {
        tempIdentityBeforeRename = identityOf(temp);
        recordPresentBeforeRename = existsSync(join(repo.baseDir, "records", `current.json@${tempIdentityBeforeRename}`));
        currentAbsentBeforeRename = !existsSync(current);
      });
      expect([recordPresentBeforeRename, currentAbsentBeforeRename, identityOf(current), keptPublish]).toEqual([true, true, tempIdentityBeforeRename, []]);

      // A later HEAD move recognizes the pre-rename record and publishes cleanly.
      writeFileSync(join(repo.primary, "src/a.ts"), "export const moved = 1;\n");
      repo.commit("move HEAD 1");
      expect(refreshCodeGraphBase(repo.primary, { provider: fakeReadProvider(repo.primary), snapshot: (_src, target) => writeFileSync(target, "snapshot") })).toBe("published");

      // CG-610-N2 (lock release): replacing refresh.lock during refresh leaves it untouched and reports refresh-lock-not-removed.
      writeFileSync(join(repo.primary, "src/a.ts"), "export const moved = 2;\n");
      repo.commit("move HEAD 2");
      const lock = join(repo.baseDir, "refresh.lock");
      const keptLock: CodeGraphKeptPathV1[] = [];
      expect(refreshCodeGraphBase(repo.primary, {
        provider: fakeReadProvider(repo.primary),
        report: (item) => keptLock.push(item),
        snapshot: (_src, target) => {
          Bun.sleepSync(30);
          rmSync(lock);
          writeFileSync(lock, "replacement-lock");
          writeFileSync(target, "snapshot");
        }
      })).toBe("published");
      expect(readFileSync(lock, "utf8")).toBe("replacement-lock");
      expect(keptLock.map(({ path, kind }) => [path, kind])).toEqual([[lock, "refresh-lock-not-removed"]]);
      expect(keptLock[0]!.cleanup.length).toBeGreaterThan(0);
      rmSync(lock);

      // CG-610-N2 (pointer temp cleanup): replacing the temp file before an error leaves it untouched and reports pointer-temp-not-removed.
      let retainedTemp = "";
      const keptTemp: CodeGraphKeptPathV1[] = [];
      expect(() => publishBasePointer(repo.baseDir, current, pointerJson, (item) => keptTemp.push(item), (temp) => {
        retainedTemp = temp;
        Bun.sleepSync(30);
        rmSync(temp);
        writeFileSync(temp, "replacement-temp");
        throw new Error("simulated rename failure");
      })).toThrow("simulated rename failure");
      expect(readFileSync(retainedTemp, "utf8")).toBe("replacement-temp");
      expect(keptTemp.map(({ path, kind }) => [path, kind])).toEqual([[retainedTemp, "pointer-temp-not-removed"]]);
      expect(keptTemp[0]!.cleanup.length).toBeGreaterThan(0);
    } finally {
      repo.cleanup();
    }
  });

  test("a backup restore or a same-bytes re-creation at current.json or a stale refresh.lock is never replaced or removed", () => {
    const fingerprint = (path: string) => { const stat = lstatSync(path); return [stat.ino, stat.isDirectory() ? readdirSync(path).sort().map(name => `${name}:${readFileSync(join(path, name), "utf8")}`) : readFileSync(path, "utf8")]; };
    const snapshotOf = (_source: string, target: string) => writeFileSync(target, "snapshot");
    // [target, set up the archctx-created occupant and return its path, run the operation that would remove or replace it, outcome]
    const targets: [string, (repo: ReturnType<typeof baseIndexRepository>) => string, (repo: ReturnType<typeof baseIndexRepository>, report: (path: CodeGraphKeptPathV1) => void) => unknown, unknown][] = [
      ["current.json", (repo) => {
        expect(refreshCodeGraphBase(repo.primary, { provider: fakeReadProvider(repo.primary), snapshot: snapshotOf })).toBe("published");
        writeFileSync(join(repo.primary, "src/a.ts"), "export const moved = 1;\n");
        repo.commit("move HEAD");
        return join(repo.baseDir, "current.json");
      }, (repo, report) => refreshCodeGraphBase(repo.primary, { provider: fakeReadProvider(repo.primary), snapshot: snapshotOf, report }), "skipped-unproven"],
      ["a stale refresh.lock", (repo) => {
        mkdirSync(repo.baseDir, { recursive: true });
        writeFileSync(join(repo.baseDir, "refresh.lock"), "999999999");
        return join(repo.baseDir, "refresh.lock");
      }, (repo, report) => refreshCodeGraphBase(repo.primary, { provider: fakeReadProvider(repo.primary), snapshot: snapshotOf, report }), "skipped-unproven"]
    ];
    for (const [target, setup, operate, outcome] of targets) {
      for (const [replacement, replace] of REPLACEMENTS) {
        const label = `${target}, after ${replacement}`;
        const repo = baseIndexRepository("archctx-base-provenance-");
        try {
          const path = setup(repo);
          const identity = () => { const stat = lstatSync(path, { bigint: true }); return `${stat.dev}-${stat.ino}-${stat.birthtimeNs}`; };
          const created = identity();
          // A re-creation in the same file-system time tick can reuse the inode and the birth time.
          Bun.sleepSync(30);
          replace(path);
          expect([label, identity() === created]).toEqual([label, false]);
          const before = fingerprint(path);
          const kept: string[] = [];
          expect([label, operate(repo, (reported) => kept.push(reported.path))]).toEqual([label, outcome]);
          expect([label, fingerprint(path), kept]).toEqual([label, before, [path]]);
        } finally {
          repo.cleanup();
        }
      }
    }
  }, 60_000);
});

describe("base index on a real index (#608)", () => {
  let repo: ReturnType<typeof baseIndexRepository>;
  beforeAll(() => {
    // No `.codegraph/` ignore rule: the provider's `.codegraph/.gitignore` is Git-visible here.
    repo = baseIndexRepository("archctx-base-real-");
    writeFileSync(join(repo.primary, "src/b.ts"), "import { a } from \"./a\";\n\nexport function b(): number {\n  return a() + 1;\n}\n");
    writeFileSync(join(repo.primary, "src/c.ts"), "export function c(): string {\n  return \"c\";\n}\n");
    repo.commit("sources");
    indexCodeGraphFixture(repo.primary);
  }, 120_000);
  afterAll(() => repo?.cleanup());

  /** Every file record and node of an index, read through the read-only handle. */
  const indexRows = (root: string) => withCodeGraphReadSession(root, (opened) => {
    if (opened.state !== "open") throw new Error(opened.state);
    const files = opened.session.graph.getFiles().map(file => [file.path, file.contentHash]).sort();
    const nodes = opened.session.graph.getNodesInFiles(files.map(([path]) => path!)).map(node => [node.id, node.kind, node.name, node.filePath, node.startLine, node.endLine].join("|")).sort();
    return { files, nodes };
  });
  /** The same worktree edits: base older than HEAD, then a dirty edit, a deletion and an untracked file. */
  const diverge = (worktree: string) => {
    writeFileSync(join(worktree, "src/a.ts"), "export function a(): number {\n  return 2;\n}\n\nexport function seededEdit(): number {\n  return 3;\n}\n");
    unlinkSync(join(worktree, "src/c.ts"));
    writeFileSync(join(worktree, "src/d.ts"), "export function untrackedAdd(): string {\n  return \"d\";\n}\n");
  };

  test("the primary checkout publishes a base; a linked worktree seeded from it syncs to a fresh index of its tree", async () => {
    if (process.platform === "win32") return; // The seed is off on Windows.
    expect((await new CodeGraphSdkProvider().indexAll(repo.primary)).codeGraphBase).toBe("published");
    expect((await new CodeGraphSdkProvider().indexAll(repo.primary)).codeGraphBase).toBe("current");
    const pointer = JSON.parse(readFileSync(join(repo.baseDir, "current.json"), "utf8"));
    expect(pointer.headSha).toBe(repo.git("rev-parse", "HEAD").trim());
    // HEAD moves past the base commit.
    writeFileSync(join(repo.primary, "src/b.ts"), "import { a } from \"./a\";\n\nexport function b(): number {\n  return a() + 10;\n}\n\nexport function afterBase(): number {\n  return 4;\n}\n");
    repo.commit("after base");

    const seeded = join(dirname(repo.primary), "seeded");
    const fresh = join(dirname(repo.primary), "fresh");
    repo.git("worktree", "add", "-q", seeded);
    repo.git("worktree", "add", "-q", fresh);
    diverge(seeded);
    diverge(fresh);
    const status = () => repo.git("-C", seeded, "status", "--porcelain=v1", "--untracked-files=all");
    const statusBefore = status();

    expect((await new CodeGraphSdkProvider().indexAll(seeded)).codeGraphBase).toBe("not-primary");
    expect(lstatSync(join(seeded, ".codegraph")).isDirectory()).toBe(true);
    expect(statSync(join(seeded, ".codegraph", "codegraph.db")).ino).not.toBe(statSync(join(repo.baseDir, pointer.snapshot)).ino);
    expect(readdirSync(join(seeded, ".codegraph")).sort()).toEqual([".gitignore", "codegraph.db"]);
    expect(readFileSync(join(seeded, ".codegraph", ".gitignore"), "utf8")).toBe("*\n");
    expect(readdirSync(seeded).filter(name => name.startsWith(".codegraph-seed-"))).toEqual([]);
    expect(status()).toBe(statusBefore);
    expect(inspectRepositoryCodeFacts(seeded)).toMatchObject({ state: "ready", pendingChanges: { added: 0, modified: 0, removed: 0 }, issues: [] });

    indexCodeGraphFixture(fresh);
    const rows = indexRows(seeded);
    expect(rows).toEqual(indexRows(fresh));
    expect(rows.nodes.some(node => node.includes("|seededEdit|"))).toBe(true);
    expect(rows.nodes.some(node => node.includes("|afterBase|"))).toBe(true);
    expect(rows.nodes.some(node => node.includes("|untrackedAdd|"))).toBe(true);
    expect(rows.files.some(([path]) => path === "src/c.ts")).toBe(false);
    // The published base is unchanged by the worktree's sync.
    expect(JSON.parse(readFileSync(join(repo.baseDir, "current.json"), "utf8"))).toEqual(pointer);
  }, 180_000);

  test("a staged index that is not proven complete and fresh is never linked in", async () => {
    expect(["published", "current"]).toContain((await new CodeGraphSdkProvider().indexAll(repo.primary)).codeGraphBase!);
    // [label, worktree edit, seed options]
    const cases: [string, (worktree: string) => void, { timeoutMs?: number }][] = [
      ["the staged sync does not finish", () => undefined, { timeoutMs: 1 }],
      // CodeGraph's sync skips a file whose size and mtime match its record, so only the staged
      // full-hash check sees this edit.
      ["a same-size edit that keeps the indexed mtime", (worktree) => {
        const source = join(worktree, "src/a.ts");
        writeFileSync(source, readFileSync(source, "utf8").replace("return 1;", "return 7;"));
        const indexed = statSync(join(repo.primary, "src/a.ts"));
        utimesSync(source, indexed.atime, indexed.mtime);
      }, {}]
    ];
    for (const [label, edit, options] of cases) {
      const worktree = join(dirname(repo.primary), `declined-${randomUUID()}`);
      repo.git("worktree", "add", "-q", "--detach", worktree);
      edit(worktree);
      expect([label, seedCodeGraphIndexFromBase(worktree, options)]).toEqual([label, "declined"]);
      expect([label, readdirSync(worktree).filter(name => name.startsWith(".codegraph"))]).toEqual([label, []]);
    }
  }, 180_000);

  test("an existing index is never replaced or rewritten by a seed, and a seed links into an accepted empty .codegraph", async () => {
    if (process.platform === "win32") return; // The seed is off on Windows.
    expect(["published", "current"]).toContain((await new CodeGraphSdkProvider().indexAll(repo.primary)).codeGraphBase!);
    // The CG-609-7 shape: an earlier seed died, then the user built the index themselves.
    const rebuilt = join(dirname(repo.primary), "rebuilt");
    repo.git("worktree", "add", "-q", "--detach", rebuilt);
    const dead = join(rebuilt, `.codegraph-seed-${spawnSync(process.execPath, ["-e", ""]).pid}-${randomUUID()}`);
    mkdirSync(dead);
    writeFileSync(join(dead, ".gitignore"), "*\n");
    writeFileSync(join(dead, "codegraph.db"), "partial");
    indexCodeGraphFixture(rebuilt);
    const database = join(rebuilt, ".codegraph", "codegraph.db");
    const digest = () => createHash("sha256").update(readFileSync(database)).digest("hex");
    const before = { ino: statSync(database).ino, digest: digest(), rows: indexRows(rebuilt) };
    expect(seedCodeGraphIndexFromBase(rebuilt)).toBe("present");
    expect([readFileSync(join(dead, "codegraph.db"), "utf8"), statSync(database).ino, digest()]).toEqual(["partial", before.ino, before.digest]);
    // The crashed seed's folder stays, and the sync reports it for hand cleanup.
    const synced = await new CodeGraphSdkProvider().indexAll(rebuilt);
    expect([synced.codeGraphBase, synced.codeGraphKept?.map(({ path, kind }) => [path, kind])]).toEqual(["not-primary", [[dead, "abandoned-staging"]]]);
    expect([statSync(database).ino, indexRows(rebuilt)]).toEqual([before.ino, before.rows]);

    // `.codegraph/` holding only the provider's own default ignore file receives the database.
    const accepted = join(dirname(repo.primary), "accepted");
    repo.git("worktree", "add", "-q", "--detach", accepted);
    mkdirSync(join(accepted, ".codegraph"));
    const providerIgnore = readFileSync(join(repo.primary, ".codegraph", ".gitignore"), "utf8");
    writeFileSync(join(accepted, ".codegraph", ".gitignore"), providerIgnore);
    const ignoreIno = statSync(join(accepted, ".codegraph", ".gitignore")).ino;
    expect(seedCodeGraphIndexFromBase(accepted)).toBe("seeded");
    expect([statSync(join(accepted, ".codegraph", ".gitignore")).ino, readFileSync(join(accepted, ".codegraph", ".gitignore"), "utf8")]).toEqual([ignoreIno, providerIgnore]);
    expect(inspectRepositoryCodeFacts(accepted)).toMatchObject({ state: "ready", issues: [] });
  }, 180_000);

  test("a projection snapshot seeds a fresh linked worktree before it lists the worktree's files", async () => {
    if (process.platform === "win32") return; // The seed is off on Windows.
    expect(["published", "current"]).toContain((await new CodeGraphSdkProvider().indexAll(repo.primary)).codeGraphBase!);
    const projected = join(dirname(repo.primary), "projected");
    repo.git("worktree", "add", "-q", projected);
    const prepared = prepareArchitectureDocumentationProjectionSnapshot(projected, { nodes: [], relations: [] });
    expect(prepared.handshake).toMatchObject({ availability: "ready" });
    // The installed `.codegraph/` ignores itself, so the listing taken before the sync still holds.
    expect(prepared.sourceFiles.filter(path => path.startsWith(".codegraph"))).toEqual([]);
  }, 120_000);
});
