import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson, type Json } from "@archcontext/contracts";
import { CODEGRAPH_TELEMETRY_ENV, CodeGraphAdapter, CodeGraphCliProvider, MultiRepoCodeGraphAdapter, disableCodeGraphTelemetryByDefault } from "../src/index";
import { MockCodeGraphProvider } from "./factories";

describe("@archcontext/local-runtime/codegraph-adapter multi-repo", () => {
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
