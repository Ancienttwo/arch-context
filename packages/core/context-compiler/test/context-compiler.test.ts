import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateJsonSchema, type CodeFactsPort, type ModelStorePort, type WorkspaceRef } from "@archcontext/contracts";
import { MultiRepoCodeGraphAdapter } from "../../../local-runtime/codegraph-adapter/src/index";
import { MockCodeGraphProvider } from "../../../local-runtime/codegraph-adapter/test/factories";
import { compileLandscapeTaskContext, compileTaskContext } from "../src/index";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const workspace: WorkspaceRef = { root: "/tmp/repo", repositoryId: "repo.test", headSha: "abc" };

function readJson(path: string) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function codeFacts(): CodeFactsPort {
  return {
    async ensureReady() {
      return {
        provider: "codegraph",
        version: "1.0.1",
        schemaDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        indexedAt: "2026-06-19T00:00:00.000Z",
        workspaceDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      };
    },
    async sync() {
      throw new Error("not used");
    },
    async buildTaskContext() {
      return {
        task: "remove duplicate wrapper v1/v2",
        symbols: [
          { id: "symbol.billingV1", name: "billingV1", kind: "function", path: "src/billing.ts" },
          { id: "symbol.billingV2", name: "billingV2", kind: "function", path: "src/billing.ts" },
          { id: "symbol.mapper", name: "mapper", kind: "function", path: "src/mapper.ts" }
        ],
        edges: [],
        evidence: [
          {
            id: "evidence.test",
            selector: { path: "src/billing.ts" },
            summary: "verified caller path",
            confidence: "verified",
            snapshot: {
              repositoryId: "repo.test",
              headSha: "abc",
              worktreeDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
            }
          }
        ],
        digest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
      };
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
}

function modelStore(): ModelStorePort {
  return {
    async loadManifest() {
      return {};
    },
    async loadModel() {
      return [];
    },
    async validateModel() {
      return {
        valid: true,
        errors: [],
        modelDigest: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      };
    },
    async writeChangeSetPreview() {
      return { digest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", summary: "preview" };
    }
  };
}

describe("@archcontext/core/context-compiler", () => {
  test("compiles schema-valid task context with budget metadata in extensions", async () => {
    const context = await compileTaskContext({
      workspace,
      task: "Remove duplicate wrapper v1/v2",
      codeFacts: codeFacts(),
      modelStore: modelStore(),
      budget: { maxBytes: 12_288, maxItems: 2 }
    });

    expect(context.schemaVersion).toBe("archcontext.task-context/v1");
    expect(context.relevantNodes).toEqual(["symbol.billingV1", "symbol.billingV2"]);
    expect(context.architecturePressure.signals).toContain("duplicate-responsibility");
    expect(context.refactorConfidence.coverage).toEqual(["caller-coverage:1"]);
    expect(context.practiceGuidance.schemaVersion).toBe("archcontext.practice-guidance/v1");
    expect(context.practiceGuidance.matches.map((match) => match.practiceId)).toContain("compatibility.single-owner");
    expect(context.resources.some((resource) => resource.uri?.startsWith("archcontext://practice/"))).toBe(true);
    expect(context.extensions.catalogDigest).toMatch(/^sha256:/);
    expect(context.extensions.practiceGuidanceDigest).toMatch(/^sha256:/);
    expect(context.extensions.digest).toMatch(/^sha256:/);

    const result = validateJsonSchema(readJson("schemas/runtime/task-context.schema.json") as any, context as any);
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test("trims context resources when the byte budget is exceeded", async () => {
    const context = await compileTaskContext({
      workspace,
      task: "Remove duplicate wrapper v1/v2",
      codeFacts: codeFacts(),
      modelStore: modelStore(),
      budget: { maxBytes: 1, maxItems: 4 }
    });

    expect(context.resources[0].type).toBe("code-context");
    expect(context.practiceGuidance.matches.length).toBeLessThanOrEqual(2);
    expect(context.relevantNodes.length).toBeLessThanOrEqual(2);
    expect(context.extensions.budgetExceeded).toBe(true);
  });

  test("compiles cross-repo task context from a bounded landscape scope", async () => {
    const context = await compileLandscapeTaskContext({
      landscape: {
        schemaVersion: "archcontext.landscape/v1",
        id: "landscape.product",
        name: "Product",
        repositories: [
          { repositoryId: "repo.web", numericRepositoryId: 1001, name: "web", role: "frontend" },
          { repositoryId: "repo.api", numericRepositoryId: 1002, name: "api", role: "runtime" },
          { repositoryId: "repo.worker", numericRepositoryId: 1003, name: "worker", role: "worker" }
        ],
        relations: ["relation.web-calls-api"],
        scope: { defaultActiveRepositories: ["repo.web"], maxActiveRepositories: 2 },
        syncPolicy: { mode: "git-worktree-only", archcontextSyncService: "forbidden" }
      },
      relations: [
        {
          schemaVersion: "archcontext.cross-repo-relation/v1",
          id: "relation.web-calls-api",
          kind: "calls",
          source: { repositoryId: "repo.web", nodeId: "module.checkout-ui" },
          target: { repositoryId: "repo.api", nodeId: "module.billing-api" },
          via: { kind: "interface", id: "interface.billing-http" },
          intent: "checkout to billing"
        }
      ],
      workspaces: [
        { root: "/tmp/web", repositoryId: "repo.web", headSha: "abc" },
        { root: "/tmp/api", repositoryId: "repo.api", headSha: "def" },
        { root: "/tmp/worker", repositoryId: "repo.worker", headSha: "ghi" }
      ],
      task: "change api contract used by web checkout",
      codeFacts: new MultiRepoCodeGraphAdapter({
        "repo.web": new MockCodeGraphProvider(),
        "repo.api": new MockCodeGraphProvider()
      }),
      modelStore: modelStore(),
      budget: { maxBytes: 4096, maxItems: 4 }
    });

    expect(context.resources[0].type).toBe("landscape");
    expect(context.practiceGuidance.catalogDigest).toMatch(/^sha256:/);
    expect(context.extensions.landscapeDigest).toMatch(/^sha256:/);
    expect(context.extensions.activeRepositories).toEqual(["repo.api", "repo.web"]);
    expect(context.extensions.crossRepoRelations).toEqual(["relation.web-calls-api"]);
    expect(context.relevantNodes).toEqual(["repo.api::symbol.preparetask", "repo.web::symbol.preparetask"]);
    expect(validateJsonSchema(readJson("schemas/runtime/task-context.schema.json") as any, context as any).valid).toBe(true);
  });
});
