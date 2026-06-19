import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateJsonSchema, type CodeFactsPort, type ModelStorePort, type WorkspaceRef } from "../../contracts/src/index";
import { compileTaskContext } from "../src/index";

const root = new URL("../../../", import.meta.url).pathname;
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

describe("@archcontext/context-compiler", () => {
  test("compiles schema-valid task context with budget metadata in extensions", async () => {
    const context = await compileTaskContext({
      workspace,
      task: "Remove duplicate wrapper v1/v2",
      codeFacts: codeFacts(),
      modelStore: modelStore(),
      budget: { maxBytes: 4096, maxItems: 2 }
    });

    expect(context.schemaVersion).toBe("archcontext.task-context/v1");
    expect(context.relevantNodes).toEqual(["symbol.billingV1", "symbol.billingV2"]);
    expect(context.architecturePressure.signals).toContain("duplicate-responsibility");
    expect(context.refactorConfidence.coverage).toEqual(["caller-coverage:1"]);
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

    expect(context.resources).toHaveLength(1);
    expect(context.relevantNodes.length).toBeLessThanOrEqual(2);
    expect(context.extensions.budgetExceeded).toBe(true);
  });
});
