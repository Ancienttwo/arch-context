import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson, type Json } from "@archcontext/contracts";
import { CODEGRAPH_TELEMETRY_ENV, CodeGraphAdapter, CodeGraphCliProvider, MultiRepoCodeGraphAdapter, REQUIRED_CODEGRAPH_VERSION, codeGraphCliInvocation, disableCodeGraphTelemetryByDefault, packagedCodeGraphCliInvocation, prepareProjectionCodeFacts } from "../src/index";
import { MockCodeGraphProvider } from "./factories";

// Mirrors the synthetic id CodeGraphCliProvider assigns to a CLI node that has no hash id
// of its own (e.g. entries parsed from the `codegraph node` text trail).
function expectedSyntheticId(name: string, path: string): string {
  return `codegraph.${digestJson({ name, path } as unknown as Json).slice(7, 19)}`;
}

describe("@archcontext/local-runtime/codegraph-adapter multi-repo", () => {
  test("resolves the projection binary from the exact package instead of PATH", () => {
    const invocation = packagedCodeGraphCliInvocation();
    expect(invocation.command).toBe(process.execPath);
    expect(invocation.argsPrefix[0]).toEndWith(join("node_modules", "@colbymchenry", "codegraph", "npm-shim.js"));
    expect(REQUIRED_CODEGRAPH_VERSION).toBe("1.5.0");
    const root = mkdtempSync(join(tmpdir(), "archctx-packaged-codegraph-runtime-"));
    try {
      const prepared = prepareProjectionCodeFacts(root, { nodes: [], relations: [] }, {
        sourceTreeDigest: `sha256:${"0".repeat(64)}`
      });
      expect(prepared.handshake).toMatchObject({
        actualVersion: "1.5.0",
        availability: "unavailable",
        reasonCode: "index-missing"
      });
      expect(prepared.handshake.binaryDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(prepared.handshake.indexedWorktreeDigest).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("binds actual version, public status, sync, and source snapshot into one projection handshake", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-codegraph-projection-handshake-"));
    const binary = join(root, "fake-codegraph.js");
    const synced = join(root, "synced");
    const actualRoot = realpathSync.native(root);
    try {
      mkdirSync(join(root, ".codegraph"));
      writeFileSync(binary, `
import { existsSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
if (argv[0] === "--version") { process.stdout.write("1.5.0\\n"); process.exit(0); }
if (argv[0] === "sync") { writeFileSync(${JSON.stringify(synced)}, "ok"); process.exit(0); }
if (argv[0] === "status") {
  const clean = existsSync(${JSON.stringify(synced)});
  process.stdout.write(JSON.stringify({
    initialized: true,
    version: "1.5.0",
    projectPath: ${JSON.stringify(actualRoot)},
    lastIndexed: clean ? "2026-08-08T09:00:00.000Z" : "2026-08-08T08:00:00.000Z",
    fileCount: 2,
    nodeCount: 4,
    edgeCount: 3,
    nodesByKind: { file: 2, function: 2 },
    languages: ["typescript"],
    pendingChanges: { added: 0, modified: clean ? 0 : 1, removed: 0 },
    worktreeMismatch: null,
    index: { builtWithVersion: "1.5.0", builtWithExtractionVersion: 24, currentExtractionVersion: 24, reindexRecommended: false, state: "complete", pendingRefs: 0 }
  }));
  process.exit(0);
}
process.stderr.write("unexpected invocation " + JSON.stringify(argv));
process.exit(2);
`);
      const prepared = prepareProjectionCodeFacts(root, { nodes: [], relations: [] }, {
        binary,
        sourceTreeDigest: `sha256:${"1".repeat(64)}`
      });
      expect(prepared.importGraphs).toEqual([]);
      expect(prepared.handshake).toMatchObject({
        actualVersion: "1.5.0",
        availability: "ready",
        requiredVersion: "1.5.0"
      });
      expect(prepared.handshake.binaryDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(prepared.handshake.preSyncStatusDigest).not.toBe(prepared.handshake.postSyncStatusDigest);
      expect(prepared.handshake.indexedWorktreeDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(prepared.handshake.graphDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails closed on actual-version and post-sync snapshot mismatches", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-codegraph-projection-mismatch-"));
    const binary = join(root, "fake-codegraph.js");
    try {
      mkdirSync(join(root, ".codegraph"));
      writeFileSync(binary, "if (process.argv[2] === '--version') process.stdout.write('1.4.0\\n');\n");
      expect(() => prepareProjectionCodeFacts(root, { nodes: [], relations: [] }, {
        binary,
        sourceTreeDigest: `sha256:${"2".repeat(64)}`
      })).toThrow("actual binary 1.4.0");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails closed when the package-local handshake exceeds its bounded deadline", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-codegraph-projection-timeout-"));
    const binary = join(root, "fake-codegraph.js");
    try {
      writeFileSync(binary, "setTimeout(() => process.stdout.write('1.5.0\\n'), 500);\n");
      expect(() => prepareProjectionCodeFacts(root, { nodes: [], relations: [] }, {
        binary,
        sourceTreeDigest: `sha256:${"3".repeat(64)}`,
        timeouts: { versionMs: 20 }
      })).toThrow("CodeGraph projection handshake failed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails closed when sync leaves the public index status stale", () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-codegraph-projection-stale-"));
    const binary = join(root, "fake-codegraph.js");
    const actualRoot = realpathSync.native(root);
    try {
      mkdirSync(join(root, ".codegraph"));
      writeFileSync(binary, `
const argv = process.argv.slice(2);
if (argv[0] === "--version") process.stdout.write("1.5.0\\n");
else if (argv[0] === "sync") process.exit(0);
else if (argv[0] === "status") process.stdout.write(JSON.stringify({
  initialized: true, version: "1.5.0", projectPath: ${JSON.stringify(actualRoot)}, lastIndexed: "2026-08-08T09:00:00.000Z",
  pendingChanges: { added: 0, modified: 1, removed: 0 }, worktreeMismatch: null,
  index: { builtWithVersion: "1.5.0", builtWithExtractionVersion: 24, currentExtractionVersion: 24, reindexRecommended: false, state: "complete", pendingRefs: 0 }
}));
else process.exit(2);
`);
      expect(() => prepareProjectionCodeFacts(root, { nodes: [], relations: [] }, {
        binary,
        sourceTreeDigest: `sha256:${"4".repeat(64)}`
      })).toThrow("post-sync index still has pending source changes");
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
writeFileSync(${JSON.stringify(logPath)}, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  execPath: process.execPath
}));
`);

      const provider = new CodeGraphCliProvider(root, shimPath);
      await provider.indexAll(root);

      expect(existsSync(logPath)).toBe(true);
      const log = JSON.parse(readFileSync(logPath, "utf8")) as { argv: string[]; cwd: string; execPath: string };
      expect(log.argv).toEqual(["sync", root]);
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
      mkdirSync(join(root, ".codegraph"), { recursive: true });
      mkdirSync(join(root, "src", "web"), { recursive: true });
      mkdirSync(join(root, "src", "domain"), { recursive: true });
      writeFileSync(join(root, "src", "domain", "order-service.ts"), "export const orderService = true;\n", "utf8");
      writeFileSync(join(root, "src", "web", "page.ts"), "import { orderService } from \"../domain/order-service\";\nexport const page = orderService;\n", "utf8");
      writeFileSync(shimPath, `
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "sync") process.exit(0);
if (args[0] === "explore") {
  console.log("## Exploration: fake\\n\\n#### src/web/page.ts — page.ts(file)\\n");
  process.exit(0);
}
if (args[0] === "query") {
  writeFileSync(${JSON.stringify(logPath)}, JSON.stringify({ argv: args }));
  console.log(JSON.stringify([
    { node: {
      id: "import:order-service",
      kind: "import",
      name: "../domain/order-service",
      qualifiedName: "../domain/order-service",
      filePath: "src/web/page.ts",
      language: "typescript",
      startLine: 1,
      endLine: 1
    } },
    { node: {
      id: "file:src/web/page.ts",
      kind: "file",
      name: "page.ts",
      qualifiedName: "src/web/page.ts",
      filePath: "src/web/page.ts",
      language: "typescript",
      startLine: 1,
      endLine: 2
    } }
  ]));
  process.exit(0);
}
console.error("unexpected fake codegraph args", args);
process.exit(2);
`);

      const adapter = new CodeGraphAdapter(new CodeGraphCliProvider(root, shimPath));
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
      const log = JSON.parse(readFileSync(logPath, "utf8")) as { argv: string[] };
      expect(log.argv).toEqual(expect.arrayContaining(["-k", "import"]));
      expect(log.argv.at(-1)).toContain("src/web/page.ts");
      expect(log.argv.at(-1)).toContain("import");
      expect(log.argv.at(-1)).not.toContain("respect dependency layer import");
      expect(log.argv.at(-1)).not.toContain("escape.ts");

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

  test("extracts callers and callees from the CodeGraph node trail", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-codegraph-trail-"));
    const shimPath = join(root, "fake-codegraph.js");
    try {
      writeFileSync(shimPath, `
const args = process.argv.slice(2);
if (args[0] === "impact") {
  console.log(JSON.stringify({
    symbol: args[args.length - 1],
    depth: 1,
    nodeCount: 1,
    edgeCount: 0,
    affected: [
      { name: "getImpact", kind: "method", filePath: "packages/local-runtime/codegraph-adapter/src/index.ts", startLine: 274 }
    ]
  }));
  process.exit(0);
}
if (args[0] === "node") {
  console.log("**getImpact** (method)");
  console.log("");
  console.log("**Location:** packages/local-runtime/codegraph-adapter/src/index.ts:274");
  console.log("**Calls →** assertCompatible (packages/local-runtime/codegraph-adapter/src/index.ts:303), assertCompatible (packages/local-runtime/codegraph-adapter/src/index.ts:303), ImpactQuery (packages/contracts/src/ports.ts:111)");
  console.log("**Called by ←** getCallers (packages/local-runtime/codegraph-adapter/src/index.ts:279), getCallees (packages/local-runtime/codegraph-adapter/src/index.ts:283), +28 more");
  process.exit(0);
}
console.error("unexpected fake codegraph args", args);
process.exit(2);
`);

      const adapter = new CodeGraphAdapter(new CodeGraphCliProvider(root, shimPath));
      const impact = await adapter.getImpact({ symbolId: "CodeGraphAdapter::getImpact", depth: 1 });

      expect(impact.affectedPaths).toEqual(["packages/local-runtime/codegraph-adapter/src/index.ts"]);
      // Duplicate "assertCompatible" entry in the canned trail above must collapse to one
      // edge, proving uniqueEdges() is applied before the result is returned.
      expect(impact.callees).toEqual([
        {
          source: "CodeGraphAdapter::getImpact",
          target: expectedSyntheticId("assertCompatible", "packages/local-runtime/codegraph-adapter/src/index.ts"),
          kind: "calls",
          confidence: "high"
        },
        {
          source: "CodeGraphAdapter::getImpact",
          target: expectedSyntheticId("ImpactQuery", "packages/contracts/src/ports.ts"),
          kind: "calls",
          confidence: "high"
        }
      ]);
      // The trailing "+28 more" truncation marker must not be parsed as a third entry.
      expect(impact.callers).toEqual([
        {
          source: expectedSyntheticId("getCallers", "packages/local-runtime/codegraph-adapter/src/index.ts"),
          target: "CodeGraphAdapter::getImpact",
          kind: "calls",
          confidence: "high"
        },
        {
          source: expectedSyntheticId("getCallees", "packages/local-runtime/codegraph-adapter/src/index.ts"),
          target: "CodeGraphAdapter::getImpact",
          kind: "calls",
          confidence: "high"
        }
      ]);

      const callers = await adapter.getCallers("CodeGraphAdapter::getImpact");
      const callees = await adapter.getCallees("CodeGraphAdapter::getImpact");
      expect(callers).toEqual(impact.callers);
      expect(callees).toEqual(impact.callees);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("resolves callers and callees to empty arrays when the CLI node trail has no recognizable calls", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-codegraph-trail-empty-"));
    const shimPath = join(root, "fake-codegraph.js");
    try {
      writeFileSync(shimPath, `
const args = process.argv.slice(2);
if (args[0] === "impact") {
  console.log(JSON.stringify({ affected: [] }));
  process.exit(0);
}
if (args[0] === "node") {
  console.log('Symbol "' + args[1] + '" not found in the codebase');
  process.exit(0);
}
console.error("unexpected fake codegraph args", args);
process.exit(2);
`);

      const provider = new CodeGraphCliProvider(root, shimPath);
      const impact = await provider.getImpactRadius("class:a58304a6dfe8667b0efd3c9c5b707eaf", 1);

      expect(impact).toEqual({
        symbolId: "class:a58304a6dfe8667b0efd3c9c5b707eaf",
        callers: [],
        callees: [],
        affectedPaths: []
      });
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
});
