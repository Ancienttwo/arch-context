#!/usr/bin/env bun
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { digestJson } from "../packages/contracts/src/schema.ts";
import { architectureLedgerStateDigest } from "../packages/core/architecture-ledger/src/index.ts";
import { compileSystemMapProjection, planProjectionRead, projectionReadSetFromGraph, selectProjectionGraphFromAuthority } from "../packages/local-runtime/runtime-daemon/src/explorer-projection.ts";

const CHECK = process.argv.includes("--check");
const ITERATIONS = 5;
const P95_LIMIT_MS = 3_000;

const repository = { repositoryId: "repo.explorer-benchmark", storageRepositoryId: "repo.storage.explorer-benchmark" };
const worktree = {
  workspaceId: "workspace.explorer-benchmark",
  storageWorkspaceId: "workspace.storage.explorer-benchmark",
  branch: "main",
  headSha: "a".repeat(40),
  worktreeDigest: digestJson({ worktree: "explorer-benchmark" })
};
const observed = { task: "Explorer bounded benchmark", symbols: [], edges: [], evidence: [], digest: digestJson({ observed: "empty" }) };

const results = [10_000, 100_000].map(benchmark);
const runtimeSource = readFileSync(new URL("../packages/local-runtime/runtime-daemon/src/index.ts", import.meta.url), "utf8");
const cliSource = readFileSync(new URL("../packages/surfaces/cli/src/main.ts", import.meta.url), "utf8");
const htmlSource = readFileSync(new URL("../packages/local-runtime/explorer-html/src/index.ts", import.meta.url), "utf8");
const v1RuntimeReferences = [runtimeSource, cliSource, htmlSource].flatMap((source, index) => {
  const hits = ["archcontext.explorer-projection/v1", "buildExplorerProjection(", "projection-v2"].filter((token) => source.includes(token));
  return hits.map((token) => ({ fileIndex: index, token }));
});

const readback = {
  schemaVersion: "archcontext.explorer-view-compiler-readback/v1",
  compilerVersion: "archcontext.explorer-view-compiler/v1",
  iterations: ITERATIONS,
  outputBudget: { maxNodes: 50, maxRelations: 100 },
  p95LimitMs: P95_LIMIT_MS,
  benchmarks: results,
  migration: { v1RuntimeReferences, passed: v1RuntimeReferences.length === 0 },
  privacy: {
    forbiddenFields: ["sourceBody", "rawDiff", "prompt", "completion", "codeGraphBody"],
    passed: results.every((result) => result.forbiddenFieldsFound.length === 0)
  },
  verdict: results.every((result) => result.p95Ms <= P95_LIMIT_MS && result.budgetBounded && result.forbiddenFieldsFound.length === 0) && v1RuntimeReferences.length === 0 ? "PASS" : "FAIL"
};

process.stdout.write(`${JSON.stringify(readback, null, 2)}\n`);
if (CHECK && readback.verdict !== "PASS") process.exit(1);

function benchmark(entityCount) {
  const graph = {
    entities: Array.from({ length: entityCount }, (_, index) => ({
      entityId: `module.${index.toString().padStart(6, "0")}`,
      kind: "module",
      canonicalName: `Module ${index}`,
      status: "active"
    })),
    relations: Array.from({ length: entityCount - 1 }, (_, index) => ({
      relationId: `relation.${index.toString().padStart(6, "0")}`,
      kind: "calls",
      sourceEntityId: `module.${index.toString().padStart(6, "0")}`,
      targetEntityId: `module.${(index + 1).toString().padStart(6, "0")}`,
      status: "active"
    })),
    constraints: []
  };
  const query = { schemaVersion: "archcontext.explorer-projection-query/v2", viewId: "system-map", semanticLevel: "context", depth: 1, budget: { maxNodes: 50, maxRelations: 100 } };
  const graphDigest = architectureLedgerStateDigest(graph);
  const readPlan = planProjectionRead(query, "git-authority");
  const selectedGraph = selectProjectionGraphFromAuthority(readPlan, graph);
  const readSet = projectionReadSetFromGraph(readPlan, selectedGraph, { entities: graph.entities.length, relations: graph.relations.length, constraints: 0 }, {}, [{ kind: "module", count: graph.entities.length }]);
  compileSystemMapProjection({ query, repository, worktree, authoritySource: "git", authorityCursor: null, evidenceAuthorityCursor: null, graph: selectedGraph, graphDigest, evidenceStateDigest: digestJson([]), readPlan, readSet, observed, bindings: [], tokenRequired: true });
  const durations = [];
  let projection;
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const started = performance.now();
    projection = compileSystemMapProjection({ query, repository, worktree, authoritySource: "git", authorityCursor: null, evidenceAuthorityCursor: null, graph: selectedGraph, graphDigest, evidenceStateDigest: digestJson([]), readPlan, readSet, observed, bindings: [], tokenRequired: true });
    durations.push(performance.now() - started);
  }
  durations.sort((a, b) => a - b);
  const p95Ms = durations[Math.ceil(durations.length * 0.95) - 1];
  const serialized = JSON.stringify(projection);
  const forbiddenFieldsFound = ["sourceBody", "rawDiff", "prompt", "completion", "codeGraphBody"].filter((field) => serialized.includes(field));
  return {
    entityCount,
    relationCount: entityCount - 1,
    durationsMs: durations.map(round),
    p95Ms: round(p95Ms),
    returnedNodes: projection.occurrences.length,
    returnedRelations: projection.relations.length,
    omittedNodeCount: projection.page.omittedNodeCount,
    omittedRelationCount: projection.page.omittedRelationCount,
    budgetBounded: projection.occurrences.length <= query.budget.maxNodes && projection.relations.length <= query.budget.maxRelations,
    forbiddenFieldsFound
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}
