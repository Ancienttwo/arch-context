import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODEGRAPH_TELEMETRY_ENV, CodeGraphCliProvider, MultiRepoCodeGraphAdapter, disableCodeGraphTelemetryByDefault } from "../src/index";
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
