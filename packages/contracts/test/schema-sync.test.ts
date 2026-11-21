import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { CONTRACT_SCHEMA_REGISTRY, serializeSchemaDocument, validateJsonSchema, type Json } from "../src";
import { publishedSchemaResolver } from "./published-schemas";

const REPO_ROOT = join(import.meta.dir, "../../..");

describe("single-source TypeBox schema registry", () => {
  test("every generated schema on disk matches its single-source TypeBox definition", () => {
    const entries = Object.entries(CONTRACT_SCHEMA_REGISTRY);
    expect(entries.length).toBeGreaterThanOrEqual(24);
    for (const [relPath, schema] of entries) {
      const disk = readFileSync(join(REPO_ROOT, relPath), "utf8");
      expect(disk).toBe(serializeSchemaDocument(schema));
    }
  });

  test("new #640, #641, #642, and #643 single-source schemas accept representative valid payloads and reject invalid ones", () => {
    const resolveSchema = publishedSchemaResolver();
    const zeroSha = "a".repeat(40);
    const zeroDigest = `sha256:${"a".repeat(64)}`;

    expect(
      validateJsonSchema(
        CONTRACT_SCHEMA_REGISTRY["schemas/runtime/doctor-code-facts.schema.json"] as any,
        { state: "ready", codeGraphVersion: "1.6.4", issues: [] } as Json,
        { resolveSchema }
      ).issues
    ).toEqual([]);
    expect(
      validateJsonSchema(
        CONTRACT_SCHEMA_REGISTRY["schemas/runtime/doctor-code-facts.schema.json"] as any,
        { state: "bogus", codeGraphVersion: "1.6.4", issues: [] } as Json,
        { resolveSchema }
      ).valid
    ).toBe(false);

    expect(
      validateJsonSchema(
        CONTRACT_SCHEMA_REGISTRY["schemas/runtime/cli-help.schema.json"] as any,
        { commands: ["init", "sync", "check"], examples: ["archctx check --json"] } as Json,
        { resolveSchema }
      ).issues
    ).toEqual([]);

    expect(
      validateJsonSchema(
        CONTRACT_SCHEMA_REGISTRY["schemas/runtime/resolve-path.schema.json"] as any,
        {
          results: [
            { path: "src/index.ts", matched: true, ambiguous: false, owningCapabilityId: "capability.cli", stableId: "capability.cli", kind: "capability", name: "CLI" },
            { path: "src/loose.ts", matched: false, ambiguous: false, owningCapabilityId: null }
          ]
        } as Json,
        { resolveSchema }
      ).issues
    ).toEqual([]);

    expect(
      validateJsonSchema(
        CONTRACT_SCHEMA_REGISTRY["schemas/runtime/index-seed.schema.json"] as any,
        {
          schemaVersion: "archcontext.index-seed/v1",
          mode: "worktree-seed",
          worktreeRole: "linked",
          seededFromBase: true,
          hardlinkedFiles: 3,
          copiedFiles: 1,
          elapsedMs: 14,
          indexDigest: zeroDigest
        } as Json,
        { resolveSchema }
      ).issues
    ).toEqual([]);

    expect(
      validateJsonSchema(
        CONTRACT_SCHEMA_REGISTRY["schemas/runtime/refactor-scan-v2.schema.json"] as any,
        {
          schemaVersion: "archcontext.refactor-scan/v2",
          scope: { kind: "repository" },
          headSha: zeroSha,
          snapshotDigest: zeroDigest,
          coverage: { imports: "complete", gitHistory: "complete", reasonCodes: [] },
          findings: [
            {
              recommendationId: `recommendation.${"1".repeat(16)}`,
              fingerprint: zeroDigest,
              detector: "entrypoint-bypass",
              severity: "error",
              blocking: true,
              capabilityId: "capability.cli",
              affectedNodeIds: ["capability.cli"],
              affectedPaths: ["src/internal.ts"],
              killList: [
                { kind: "symbol", target: "src/internal.ts#secretHelper", required: true },
                { kind: "path", target: "src/legacy.ts", required: true }
              ],
              metrics: { callsIntoInternal: 1 },
              evidence: { summary: "Direct call to non-entrypoint internal symbol" }
            }
          ],
          suppressed: []
        } as Json,
        { resolveSchema }
      ).issues
    ).toEqual([]);

    expect(
      validateJsonSchema(
        CONTRACT_SCHEMA_REGISTRY["schemas/runtime/refactor-scan-v2.schema.json"] as any,
        {
          schemaVersion: "archcontext.refactor-scan/v2",
          scope: { kind: "repository" },
          headSha: zeroSha,
          snapshotDigest: zeroDigest,
          coverage: { imports: "complete", gitHistory: "complete", reasonCodes: [] },
          findings: [
            {
              recommendationId: `recommendation.${"1".repeat(16)}`,
              fingerprint: zeroDigest,
              detector: "entrypoint-bypass",
              severity: "error",
              blocking: true,
              capabilityId: "capability.cli",
              affectedNodeIds: ["capability.cli"],
              affectedPaths: ["src/internal.ts"],
              killList: [{ kind: "symbol", target: "../escape.ts#bad", required: true }],
              metrics: {},
              evidence: { summary: "Rejects traversal in symbol killList" }
            }
          ],
          suppressed: []
        } as Json,
        { resolveSchema }
      ).valid
    ).toBe(false);

    expect(
      validateJsonSchema(
        CONTRACT_SCHEMA_REGISTRY["schemas/runtime/refactor-verify-v2.schema.json"] as any,
        {
          schemaVersion: "archcontext.refactor-verify/v2",
          recommendationId: `recommendation.${"1".repeat(16)}`,
          headSha: zeroSha,
          snapshotDigest: zeroDigest,
          disposition: "resolved",
          resolutionDigest: zeroDigest,
          killListChecks: [{ kind: "symbol", target: "src/internal.ts#secretHelper", required: true, status: "removed" }],
          metricChecks: [{ metric: "callsIntoInternal", before: 1, after: 0, satisfied: true }],
          blockingReasons: []
        } as Json,
        { resolveSchema }
      ).issues
    ).toEqual([]);

    expect(
      validateJsonSchema(
        CONTRACT_SCHEMA_REGISTRY["schemas/runtime/refactor-simulate.schema.json"] as any,
        {
          schemaVersion: "archcontext.refactor-simulate/v1",
          headSha: zeroSha,
          operation: { kind: "cut-edge", from: "src/a.ts", to: "src/b.ts" },
          before: { cycleCount: 1, undeclaredEdgeCount: 1 },
          after: { cycleCount: 0, undeclaredEdgeCount: 0 },
          coverage: "static-graph-only",
          caveats: ["Dynamic imports are excluded from static edge cut simulation."],
          readOnly: true
        } as Json,
        { resolveSchema }
      ).issues
    ).toEqual([]);
  });
});
