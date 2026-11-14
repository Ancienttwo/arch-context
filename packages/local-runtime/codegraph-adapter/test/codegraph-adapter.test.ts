import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FailureError, digestJson, type Json } from "@archcontext/contracts";
import { CODEGRAPH_TELEMETRY_ENV, CodeGraphAdapter, CodeGraphSdkProvider, MultiRepoCodeGraphAdapter, REQUIRED_CODEGRAPH_VERSION, codeGraphCliInvocation, disableCodeGraphTelemetryByDefault, openCodeGraphSymbolReader, packagedCodeGraphCliInvocation, pinnedCodeGraphProvider, prepareProjectionCodeFacts, type CodeGraphReadProvider } from "../src/index";
import * as readSessionModule from "../src/read-session";
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
    expect(REQUIRED_CODEGRAPH_VERSION).toBe("1.6.2");
    const root = mkdtempSync(join(tmpdir(), "archctx-packaged-codegraph-runtime-"));
    try {
      const prepared = prepareProjectionCodeFacts(root, { nodes: [], relations: [] }, {
        sourceTreeDigest: `sha256:${"0".repeat(64)}`
      });
      expect(prepared.handshake).toMatchObject({
        actualVersion: "1.6.2",
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
        actualVersion: "1.6.2",
        availability: "ready",
        requiredVersion: "1.6.2"
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

      const provider = new CodeGraphSdkProvider(root, shimPath, fakeReadProvider(root));
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

      const adapter = new CodeGraphAdapter(new CodeGraphSdkProvider(root, shimPath, provider));
      await adapter.sync({
        workspace: { root, repositoryId: "repo.test", headSha: "abc" },
        changedPaths: [" src\\web\\page.ts", "../escape.ts", "/tmp/escape.ts"]
      });
      const context = await adapter.buildTaskContext({
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

      const git = {
        schemaVersion: "archcontext.git-change-metadata/v1" as const,
        source: "commit" as const,
        baseSha: "base-001",
        headSha: "head-002",
        paths: [{ path: "src/web/page.ts", status: "modified" as const, rawStatus: "M" }],
        pathCount: 1,
        metadataDigest: digestJson({ baseSha: "base-001", headSha: "head-002", path: "src/web/page.ts" } as unknown as Json)
      };
      const delta = await adapter.analyzeChangedSubjects({
        workspace: { root, repositoryId: "repo.checkout", headSha: "head-002" },
        repository: {
          repositoryId: "repo.checkout",
          storageRepositoryId: "repo.storage.checkout"
        },
        worktree: {
          workspaceId: "workspace.checkout",
          storageWorkspaceId: "workspace.storage.checkout",
          branch: "main",
          headSha: "head-002",
          worktreeDigest: digestJson({ worktree: root } as unknown as Json)
        },
        git,
        declaredGraph: {
          entities: [
            {
              entityId: "module.web",
              kind: "module",
              canonicalName: "Web",
              status: "active",
              path: "src/web",
              metadata: { owner: "team.web" }
            },
            {
              entityId: "module.domain",
              kind: "module",
              canonicalName: "Domain",
              status: "active",
              path: "src/domain"
            }
          ],
          relations: [
            {
              relationId: "relation.web-domain",
              kind: "depends_on",
              sourceEntityId: "module.web",
              targetEntityId: "module.domain",
              status: "active"
            }
          ],
          constraints: []
        },
        createdAt: "2026-06-25T04:10:00.000Z"
      });

      expect(delta.schemaVersion).toBe("archcontext.architecture-candidate-delta/v1");
      expect(delta.changeCursor).toMatchObject({
        changeSource: "commit",
        baseSha: "base-001",
        headSha: "head-002",
        pathCount: 1
      });
      expect(delta.subjectSelectors.some((selector) => selector.kind === "path" && selector.path === "src/web/page.ts")).toBe(true);
      expect(delta.subjectSelectors.some((selector) => selector.kind === "symbol" && selector.path === "src/web/page.ts")).toBe(true);
      expect(delta.subjectSelectors.some((selector) => selector.kind === "relation")).toBe(true);
      expect(delta.declaredSubjectMappings.some((mapping) => mapping.target.kind === "entity" && mapping.target.id === "module.web")).toBe(true);
      expect(delta.declaredSubjectMappings.some((mapping) => mapping.target.kind === "relation" && mapping.target.id === "relation.web-domain")).toBe(true);
      expect(delta.candidateChanges.some((change) => change.kind === "node-materially-changed" && change.target.id === "module.web")).toBe(true);
      expect(delta.interpretations.every((interpretation) => interpretation.evidenceIds.length > 0)).toBe(true);
      expect(delta.evidenceBindings.some((binding) => binding.target.kind === "candidate-delta")).toBe(true);
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
        const failure = await readFailure(new CodeGraphSdkProvider(root, undefined, counted).findSymbols({ query: "render" }));
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
      const failure = await readFailure(new CodeGraphSdkProvider(root).findSymbols({ query: "render" }));
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

  const symbolId = async (query: string, kind: string) => (await new CodeGraphSdkProvider(root).findSymbols({ query, kinds: [kind] }))[0]!.id;

  test("buildContext returns the query nodes, then the relevant files in relevance order, deterministically", async () => {
    const provider = new CodeGraphSdkProvider(root);
    const build = () => provider.buildContext("basePrice", { maxSymbols: 4, includeSource: false });
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

  test("findSymbols keeps only the requested kinds", async () => {
    const provider = new CodeGraphSdkProvider(root);
    expect(await provider.findSymbols({ query: "render", kinds: ["method"] })).toEqual([
      { id: expect.stringMatching(/^method:[0-9a-f]{32}$/), name: "render", kind: "method", path: "src/views/widget.ts", range: { startLine: 2, endLine: 4 } }
    ]);
    expect((await provider.findSymbols({ query: "render", kinds: ["function"] })).map((symbol) => [symbol.kind, symbol.path])).toEqual([["function", "src/views/page.ts"]]);
    // Unfiltered, both definitions tie on the search; the file path breaks the tie.
    expect((await provider.findSymbols({ query: "render" })).map((symbol) => [symbol.kind, symbol.path])).toEqual([
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
      failure = await readFailure(new CodeGraphSdkProvider(root, undefined, provider).buildContext("basePrice", { maxSymbols: 4, includeSource: false }));
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
