import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  CONTRACT_SCHEMA_REGISTRY,
  RepoPathSchema,
  isCanonicalRepoRelativePosixPath,
  isValidRefactorKillListSymbolTarget,
  serializeSchemaDocument,
  validateJsonSchema,
  type Json
} from "../src";
import { publishedSchemaResolver } from "./published-schemas";

const REPO_ROOT = join(import.meta.dir, "../../..");

describe("single-source TypeBox schema registry", () => {
  test("every generated schema on disk matches its single-source TypeBox definition", () => {
    const entries = Object.entries(CONTRACT_SCHEMA_REGISTRY);
    expect(entries.length).toBeGreaterThanOrEqual(24);
    for (const [relPath, schema] of entries) {
      const disk = readFileSync(join(REPO_ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
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
              evidence: {
                summary: "Direct call to non-entrypoint internal symbol",
                observation: {
                  kind: "entrypoint-bypass",
                  declaredEntrypointPaths: ["src/index.ts"],
                  edges: [
                    {
                      fromPath: "src/caller.ts",
                      fromLine: 3,
                      toPath: "src/internal.ts",
                      specifier: "./internal",
                      fromNodeId: "capability.other",
                      toNodeId: "capability.cli"
                    }
                  ],
                  totalCount: 1,
                  truncated: false
                }
              }
            },
            {
              recommendationId: `recommendation.${"2".repeat(16)}`,
              fingerprint: zeroDigest,
              detector: "low-cohesion-god-file",
              severity: "warning",
              blocking: true,
              capabilityId: "capability.cli",
              affectedNodeIds: ["capability.cli"],
              affectedPaths: ["src/god.ts"],
              killList: [],
              metrics: { flaggedFileCount: 1 },
              evidence: {
                summary: "Low cohesion file split candidate",
                splitClusterCount: 2,
                lcomScore: 2,
                observation: {
                  kind: "low-cohesion-god-file",
                  files: [
                    {
                      path: "src/god.ts",
                      lineCount: 400,
                      topLevelSymbolCount: 10,
                      clusterCount: 2,
                      clusters: [
                        { symbols: ["alpha", "beta"], startLine: 1, endLine: 180, intraClusterEdges: 3, crossClusterEdges: 0 },
                        { symbols: ["gamma", "delta"], startLine: 185, endLine: 400, intraClusterEdges: 2, crossClusterEdges: 0 }
                      ]
                    }
                  ],
                  totalCount: 1,
                  truncated: false
                }
              }
            },
            {
              recommendationId: `recommendation.${"3".repeat(16)}`,
              fingerprint: zeroDigest,
              detector: "unstable-dependency",
              severity: "warning",
              blocking: false,
              capabilityId: "capability.cli",
              affectedNodeIds: ["capability.cli"],
              affectedPaths: [],
              killList: [],
              metrics: { unstableDependencyCount: 1 },
              evidence: {
                summary: "Stable module depends on unstable leaf",
                instabilitySource: 0.2,
                instabilityTarget: 0.9,
                observation: {
                  kind: "unstable-dependency",
                  sourceFanIn: 4,
                  sourceInstability: 0.2,
                  targets: [{ targetNodeId: "capability.leaf", targetInstability: 0.9, delta: 0.7, edgeCount: 3 }],
                  totalCount: 1,
                  truncated: false
                }
              }
            },
            {
              recommendationId: `recommendation.${"4".repeat(16)}`,
              fingerprint: zeroDigest,
              detector: "co-change-coupling",
              severity: "warning",
              blocking: false,
              capabilityId: "capability.cli",
              affectedNodeIds: ["capability.cli", "capability.leaf"],
              affectedPaths: ["src/a.ts", "src/b.ts"],
              killList: [],
              metrics: { coChangePairCount: 1 },
              evidence: {
                summary: "Files change together across commits",
                coChangeSupport: 5,
                coChangeCoverageOk: true,
                observation: {
                  kind: "co-change-coupling",
                  memberNodeIds: ["capability.cli", "capability.leaf"],
                  coverageStatus: "complete",
                  windowLimit: 200,
                  observedCommitCount: 12,
                  pairs: [{ pathA: "src/a.ts", pathB: "src/b.ts", coChangeCount: 5, jaccard: 0.8 }],
                  totalCount: 1,
                  truncated: false
                }
              }
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
              recommendationId: `recommendation.${"5".repeat(16)}`,
              fingerprint: zeroDigest,
              detector: "unstable-dependency",
              severity: "warning",
              blocking: false,
              capabilityId: "capability.cli",
              affectedNodeIds: ["capability.cli"],
              affectedPaths: [],
              killList: [],
              metrics: {},
              evidence: {
                summary: "Rejects invalid typed observation evidence",
                observation: {
                  kind: "unstable-dependency",
                  sourceFanIn: -1,
                  sourceInstability: 0.2,
                  targets: [],
                  totalCount: 0,
                  truncated: false
                }
              }
            }
          ],
          suppressed: []
        } as Json,
        { resolveSchema }
      ).valid
    ).toBe(false);

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

    const simulateValid = {
      schemaVersion: "archcontext.runtime-refactor-simulate/v1",
      beforeSnapshotDigest: zeroDigest,
      modelDigest: zeroDigest,
      codeFactsCoverage: "complete",
      moves: [{ path: "src/a.ts", toNodeId: "component.b" }],
      targetSubject: "component.a<->component.b",
      measurementStatus: "measured",
      unmeasuredReasons: [],
      metricsDelta: {
        before: {
          pairThinDirectionEdgeCount: 1,
          crossModuleEdgeCount: 2,
          crossModuleCycleCount: 1,
          residualCycleCount: 1,
          directionViolationCount: 0
        },
        after: {
          pairThinDirectionEdgeCount: 0,
          crossModuleEdgeCount: 1,
          crossModuleCycleCount: 0,
          residualCycleCount: 0,
          directionViolationCount: 0
        },
        delta: {
          pairThinDirectionEdgeCount: -1,
          crossModuleEdgeCount: -1,
          crossModuleCycleCount: -1,
          residualCycleCount: -1,
          directionViolationCount: 0
        }
      },
      newlyIntroducedCycles: [],
      resolvedCycles: ["component.a<->component.b"],
      newlyIntroducedViolations: [],
      cutCandidates: [
        {
          strategy: "move-source-file",
          measured: true,
          measurementStatus: "measured",
          summary: "Move src/a.ts to component.b",
          moves: [{ path: "src/a.ts", toNodeId: "component.b" }],
          thinDirectionEdgeDelta: -1,
          crossModuleCycleDelta: -1,
          directionViolationDelta: 0,
          newlyIntroducedViolationCount: 0,
          breaksPair: true,
          caveats: []
        },
        {
          strategy: "extract-shared-leaf",
          measured: false,
          measurementStatus: "unmeasured",
          summary: "Extract shared leaf helper without rewriting imports",
          moves: [],
          thinDirectionEdgeDelta: null,
          crossModuleCycleDelta: null,
          directionViolationDelta: null,
          newlyIntroducedViolationCount: null,
          breaksPair: null,
          caveats: ["Requires synthesizing a new module and rewriting import edges."]
        }
      ],
      simulationDigest: zeroDigest,
      privacy: {
        writes: "none",
        rawSourcePersisted: false,
        rawDiffPersisted: false,
        promptPersisted: false
      }
    } as Json;
    expect(
      validateJsonSchema(
        CONTRACT_SCHEMA_REGISTRY["schemas/runtime/refactor-simulate.schema.json"] as any,
        simulateValid,
        { resolveSchema }
      ).issues
    ).toEqual([]);
    expect(
      validateJsonSchema(
        CONTRACT_SCHEMA_REGISTRY["schemas/runtime/refactor-simulate.schema.json"] as any,
        { ...simulateValid as Record<string, unknown>, privacy: { writes: "disk", rawSourcePersisted: false, rawDiffPersisted: false, promptPersisted: false } } as Json,
        { resolveSchema }
      ).valid
    ).toBe(false);
  });

  test("canonical repo-relative POSIX path validators and schemas reject aliases and drive prefixes", () => {
    const valid = [".gitignore", ".archcontext/manifest.yaml", "src/index.ts", "packages/a/.hidden/file.ts"];
    for (const path of valid) {
      expect(isCanonicalRepoRelativePosixPath(path), path).toBe(true);
      expect(validateJsonSchema(RepoPathSchema, path).issues, path).toEqual([]);
      expect(isValidRefactorKillListSymbolTarget(`${path}#sym`), path).toBe(true);
    }

    const rejected = [
      "",
      "./src/a.ts",
      "src/./a.ts",
      "src/.",
      "src//a.ts",
      "src/a.ts/",
      "/src/a.ts",
      "../a.ts",
      "src/../a.ts",
      "src\\a.ts",
      "C:/src/a.ts",
      "c:src/a.ts",
      "src/\u0000a.ts"
    ];
    for (const bad of rejected) {
      expect(isCanonicalRepoRelativePosixPath(bad), bad).toBe(false);
      expect(validateJsonSchema(RepoPathSchema, bad).valid, bad).toBe(false);
      expect(isValidRefactorKillListSymbolTarget(`${bad}#sym`), bad).toBe(false);
    }
  });
});
