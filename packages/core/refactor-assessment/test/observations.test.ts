import { describe, expect, test } from "bun:test";
import { REFACTOR_EVIDENCE_SPECIFIER_MAX_LENGTH, REFACTOR_OBSERVATION_EVIDENCE_LIMIT, refactorAssessmentInvariantIssues, refactorScanInvariantIssues, type Json } from "@archcontext/contracts";
import type { NativeModel } from "@archcontext/core/projection-engine";
import { assessRefactor } from "../src/index";
import {
  CONTESTED_MODEL,
  CYCLE_EDGES,
  MODEL,
  TRACKED_FILES,
  UNDECLARED_MODEL,
  digestOf,
  makeAssessmentInput,
  makeRequest,
  makeSnapshot,
  structureOf
} from "./factories";

const SIGNAL_ID = /^signal\.[a-z-]+\.[a-f0-9]{16}$/;

function assessObservationOnly(overrides: Parameters<typeof makeAssessmentInput>[0] = {}) {
  const input = makeAssessmentInput(overrides);
  const result = assessRefactor(input);
  expect(refactorAssessmentInvariantIssues(result.assessment)).toEqual([]);
  expect(refactorScanInvariantIssues({ snapshot: input.snapshot, assessment: result.assessment })).toEqual([]);
  return result.assessment;
}

describe("observation-only scan (S7)", () => {
  const snapshot = makeSnapshot({ importEdges: CYCLE_EDGES });

  test("emits no scale and no proposal digest", () => {
    const assessment = assessObservationOnly({ snapshot });
    expect(assessment.scale).toBeNull();
    expect(assessment.proposalDigest).toBeNull();
    expect(assessment.scaleReasonCodes).toEqual([]);
    expect(assessment.affectedNodeIds).toEqual([]);
    expect(assessment.majorChangeReasons).toEqual([]);
  });

  test("reports one cycle record per bidirectional module pair, not per member", () => {
    const assessment = assessObservationOnly({ snapshot });
    const cycles = assessment.observations.filter((observation) => observation.kind === "cycle");
    expect(cycles).toHaveLength(1);
    expect(cycles[0].subjectSelectorId).toBe("pair:component.a|module.c");
    expect(cycles[0].affectedNodeIds).toEqual(["component.a", "module.c"]);
    expect(cycles[0].metrics).toEqual({ forwardEdgeCount: 1, backwardEdgeCount: 1, thinDirectionEdgeCount: 1, totalEdgeCount: 2 });
    expect(assessment.observations.some((observation) => observation.kind === "residual-cycle")).toBe(false);
    expect(snapshot.modules.filter((module) => module.dependencyGraph?.stronglyConnectedComponentId !== null)).toHaveLength(2);
  });

  test("carries the repository unowned-paths count and reaches high confidence", () => {
    const assessment = assessObservationOnly({ snapshot });
    const unowned = assessment.observations.filter((observation) => observation.kind === "unowned-paths");
    expect(unowned).toHaveLength(1);
    expect(unowned[0].subjectSelectorId).toBe("repository:repo.rf2");
    expect(unowned[0].metrics).toEqual({ unownedFileCount: 1 });
    expect(assessment.confidence.unresolvedEvidence).toEqual([]);
    expect(assessment.confidence.level).toBe("high");
  });

  test("derives pressure from its own observations with the pressure-engine weights", () => {
    const assessment = assessObservationOnly({ snapshot });
    expect(assessment.observations.map((observation) => observation.kind)).toEqual(["cycle", "unowned-paths"]);
    expect(assessment.pressure.score).toBe(40);
    expect(assessment.pressure.level).toBe("medium");
    expect(assessment.pressure.signalIds).toEqual(
      [...assessment.observations.flatMap((observation) => observation.signalIds)].sort()
    );
  });
});

describe("observation kinds", () => {
  test("emits evidence-gap exactly when coverage is not complete", () => {
    const complete = assessObservationOnly();
    expect(complete.observations.some((observation) => observation.kind === "evidence-gap")).toBe(false);

    const snapshot = makeSnapshot({ codeFacts: {
      version: "0.9.1",
      binaryDigest: digestOf("index-binary"),
      availability: "unavailable",
      indexedWorktreeDigest: null
    } });
    const assessment = assessObservationOnly({ snapshot });
    const gaps = assessment.observations.filter((observation) => observation.kind === "evidence-gap");
    expect(gaps).toHaveLength(1);
    expect(gaps[0].subjectSelectorId).toBe("repository:repo.rf2");
    expect(assessment.confidence.level).toBe("low");
  });

  test("emits one undeclared-footprint record per node without a declared footprint", () => {
    const snapshot = makeSnapshot({ model: UNDECLARED_MODEL });
    const assessment = assessObservationOnly({ snapshot, model: UNDECLARED_MODEL });
    const undeclared = assessment.observations.filter((observation) => observation.kind === "undeclared-footprint");
    expect(undeclared.map((observation) => observation.subjectSelectorId)).toEqual(["module.m"]);
  });

  test("emits one ownership-ambiguous record per contesting node", () => {
    const snapshot = makeSnapshot({ model: CONTESTED_MODEL });
    const assessment = assessObservationOnly({ snapshot, model: CONTESTED_MODEL });
    const ambiguous = assessment.observations.filter((observation) => observation.kind === "ownership-ambiguous");
    expect(ambiguous.map((observation) => observation.subjectSelectorId)).toEqual([
      "component.a",
      "component.shadow",
      "module.m"
    ]);
  });

  test("never emits direction-violation while the snapshot reports a null count", () => {
    const snapshot = makeSnapshot({ importEdges: CYCLE_EDGES });
    expect(snapshot.modules.every((module) => (module.dependencyGraph?.directionViolationCount ?? null) === null)).toBe(true);
    const assessment = assessObservationOnly({ snapshot });
    expect(assessment.observations.some((observation) => observation.kind === "direction-violation")).toBe(false);
  });

  test("emits direction-violation for a declared forbid-dependency constraint the edges break", () => {
    const constraints = [{
      id: "constraint.a-not-c",
      severity: "error" as const,
      scope: { nodes: ["component.a"] },
      rule: { type: "forbid-dependency" as const, targets: ["module.c"] },
      rationale: "fixture"
    }];
    const snapshot = makeSnapshot({ importEdges: CYCLE_EDGES, constraints });

    const assessment = assessObservationOnly({ snapshot, constraints });
    const direction = assessment.observations.filter((observation) => observation.kind === "direction-violation");
    expect(direction.map((observation) => [observation.subjectSelectorId, observation.metrics])).toEqual([
      ["component.a", { directionViolationCount: 1 }]
    ]);
    // The constraints are part of the model the snapshot measured: omitting them unbinds it.
    expect(() => assessRefactor(makeAssessmentInput({ snapshot }))).toThrow(/does not bind snapshot\.modelDigest/);
  });

  test("sorts observations by kind then subject and gives each exactly one signal id", () => {
    const snapshot = makeSnapshot({ model: CONTESTED_MODEL, importEdges: CYCLE_EDGES, truncated: true });
    const assessment = assessObservationOnly({ snapshot, model: CONTESTED_MODEL });
    const keys = assessment.observations.map((observation) => `${observation.kind}\u0000${observation.subjectSelectorId}`);
    expect(keys).toEqual([...keys].sort());
    for (const observation of assessment.observations) {
      expect(observation.signalIds).toHaveLength(1);
      expect(observation.signalIds[0]).toMatch(SIGNAL_ID);
    }
    expect(new Set(assessment.pressure.signalIds).size).toBe(assessment.observations.length);
  });
});

describe("binding and determinism", () => {
  test("is byte-identical across two calls on the same input", () => {
    const input = makeAssessmentInput({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) });
    expect(assessRefactor(input).assessment).toEqual(assessRefactor(input).assessment);
  });

  test("rejects a snapshot whose payload no longer binds its own digest", () => {
    const snapshot = makeSnapshot();
    const tampered = {
      ...snapshot,
      repositorySummary: { ...snapshot.repositorySummary, crossModuleCycleCount: 99 }
    };
    expect(() => assessRefactor(makeAssessmentInput({ snapshot: tampered }))).toThrow(/AC_SCHEMA_INVALID/);
  });

  test("rejects a model that does not bind the measured snapshot", () => {
    expect(() => assessRefactor(makeAssessmentInput({ model: CONTESTED_MODEL }))).toThrow(/AC_SCHEMA_INVALID/);
  });

  test("rejects a node scope naming an undeclared node", () => {
    const input = makeAssessmentInput({
      request: { schemaVersion: "archcontext.refactor-request/v1", scope: { kind: "node", nodeId: "module.absent" } }
    });
    expect(() => assessRefactor(input)).toThrow(/AC_SCHEMA_INVALID/);
  });

  test("accepts a node scope naming a declared node", () => {
    const assessment = assessObservationOnly({
      request: { schemaVersion: "archcontext.refactor-request/v1", scope: { kind: "node", nodeId: "module.m" } }
    });
    expect(assessment.requestedScope).toEqual({ kind: "node", nodeId: "module.m" });
    expect(MODEL.nodes.some((node) => node.id === "module.m")).toBe(true);
  });
});

describe("observation evidence", () => {
  /** The cycle edges, located: the code index reports each import's line. */
  const LOCATED_CYCLE_EDGES = [
    { ...CYCLE_EDGES[0]!, line: 3 },
    { ...CYCLE_EDGES[1]!, line: 5 }
  ];

  function evidenceOf(assessment: { observations: { kind: string; subjectSelectorId: string; evidence: unknown }[] }, kind: string, subject?: string) {
    const observation = assessment.observations.find((entry) => entry.kind === kind && (subject === undefined || entry.subjectSelectorId === subject));
    expect(observation, `${kind} ${subject ?? ""}`).toBeDefined();
    return observation!.evidence as Record<string, unknown>;
  }

  test("a cycle lists the file edges that close it, located by path and line", () => {
    const snapshot = makeSnapshot({ importEdges: LOCATED_CYCLE_EDGES });
    const assessment = assessObservationOnly({ snapshot });
    expect(evidenceOf(assessment, "cycle")).toEqual({
      kind: "cycle",
      memberNodeIds: ["component.a", "module.c"],
      directions: [
        { fromNodeId: "component.a", toNodeId: "module.c", totalCount: 1, sampledCount: 1 },
        { fromNodeId: "module.c", toNodeId: "component.a", totalCount: 1, sampledCount: 1 }
      ],
      edges: [
        { fromPath: "src/c/z.ts", fromLine: 5, toPath: "src/m/a/x.ts", specifier: "../m/a/x", fromNodeId: "module.c", toNodeId: "component.a" },
        { fromPath: "src/m/a/x.ts", fromLine: 3, toPath: "src/c/z.ts", specifier: "../../c/z", fromNodeId: "component.a", toNodeId: "module.c" }
      ],
      totalCount: 2,
      truncated: false
    });
  });

  test("a line the index did not report is null, never invented", () => {
    const assessment = assessObservationOnly({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) });
    const edges = evidenceOf(assessment, "cycle").edges as { fromLine: number | null }[];
    expect(edges.map((edge) => edge.fromLine)).toEqual([null, null]);
  });

  test("evidence never moves the signal id, which names the measured fact alone", () => {
    const located = assessObservationOnly({ snapshot: makeSnapshot({ importEdges: LOCATED_CYCLE_EDGES }) });
    const unlocated = assessObservationOnly({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) });
    expect(located.observations.map((observation) => observation.signalIds)).toEqual(
      unlocated.observations.map((observation) => observation.signalIds)
    );
    expect(located.assessmentDigest).not.toBe(unlocated.assessmentDigest);
  });

  test("a direction violation names the constraint and the edge that breaks it", () => {
    const constraints = [{
      id: "constraint.a-not-c",
      severity: "error" as const,
      scope: { nodes: ["component.a"] },
      rule: { type: "forbid-dependency" as const, targets: ["module.c"] },
      rationale: "fixture"
    }];
    const snapshot = makeSnapshot({ importEdges: LOCATED_CYCLE_EDGES, constraints });
    const assessment = assessObservationOnly({ snapshot, constraints });
    expect(evidenceOf(assessment, "direction-violation", "component.a")).toEqual({
      kind: "direction-violation",
      constraintIds: ["constraint.a-not-c"],
      constraintCount: 1,
      violations: [{
        constraintId: "constraint.a-not-c",
        fromPath: "src/m/a/x.ts",
        fromLine: 3,
        toPath: "src/c/z.ts",
        specifier: "../../c/z",
        fromNodeId: "component.a",
        toNodeId: "module.c"
      }],
      totalCount: 1,
      truncated: false
    });
  });

  test("unowned paths are listed with the nodes that own their directory neighbours", () => {
    const withModuleC = (source: Record<string, string[]>): NativeModel => ({
      ...MODEL,
      nodes: MODEL.nodes.map((node) => (node.id === "module.c" ? { ...node, source: { ...(node.source as Record<string, Json>), ...source } } : node))
    });
    const excluding = withModuleC({ exclude: ["src/c/*.gen"] });
    const assessment = assessObservationOnly({
      snapshot: makeSnapshot({ trackedFiles: [...TRACKED_FILES, { path: "src/c/orphan.gen", lineCount: 1 }], model: excluding }),
      model: excluding
    });
    // `src/c/orphan.gen` is explicitly excluded, so it is a declaration, not a gap.
    expect(evidenceOf(assessment, "unowned-paths")).toEqual({
      kind: "unowned-paths",
      paths: [{ path: "src/gen.ts", candidateOwnerNodeIds: [], candidateOwnerCount: 0 }],
      totalCount: 1,
      truncated: false
    });

    const narrowed = withModuleC({ include: ["src/c/z.ts"] });
    const crowded = assessObservationOnly({
      snapshot: makeSnapshot({ trackedFiles: [...TRACKED_FILES, { path: "src/c/loose.ts", lineCount: 1 }], model: narrowed }),
      model: narrowed
    });
    expect(evidenceOf(crowded, "unowned-paths").paths as unknown[]).toContainEqual({ path: "src/c/loose.ts", candidateOwnerNodeIds: ["module.c"], candidateOwnerCount: 1 });
  });

  test("a sample past the fixed bound is truncated with the true population beside it", () => {
    const extra = Array.from({ length: REFACTOR_OBSERVATION_EVIDENCE_LIMIT + 5 }, (_, index) => ({
      path: `src/loose-${String(index).padStart(2, "0")}.ts`,
      lineCount: 1
    }));
    const assessment = assessObservationOnly({ snapshot: makeSnapshot({ trackedFiles: [...TRACKED_FILES, ...extra] }) });
    const evidence = evidenceOf(assessment, "unowned-paths");
    expect(evidence.totalCount).toBe(extra.length + 1);
    expect(evidence.truncated).toBe(true);
    expect((evidence.paths as unknown[]).length).toBe(REFACTOR_OBSERVATION_EVIDENCE_LIMIT);
  });

  test("ownership ambiguity lists each contested file with every claimant", () => {
    const snapshot = makeSnapshot({ model: CONTESTED_MODEL });
    const assessment = assessObservationOnly({ snapshot, model: CONTESTED_MODEL });
    expect(evidenceOf(assessment, "ownership-ambiguous", "component.shadow")).toEqual({
      kind: "ownership-ambiguous",
      paths: [{ path: "src/m/a/x.ts", candidateOwnerNodeIds: ["component.a", "component.shadow", "module.m"], candidateOwnerCount: 3 }],
      totalCount: 1,
      truncated: false
    });
  });

  test("an undeclared footprint lists the entrypoint paths the node names and who owns them", () => {
    const entrypointOnly = {
      ...MODEL,
      nodes: [
        ...MODEL.nodes,
        {
          id: "module.cli",
          kind: "module",
          name: "CLI",
          source: { entrypoints: [{ id: "entrypoint.cli", path: "src/c/z.ts", symbols: [] }] }
        }
      ]
    };
    const snapshot = makeSnapshot({ model: entrypointOnly });
    const assessment = assessObservationOnly({ snapshot, model: entrypointOnly });
    expect(evidenceOf(assessment, "undeclared-footprint", "module.cli")).toEqual({
      kind: "undeclared-footprint",
      paths: [{ path: "src/c/z.ts", candidateOwnerNodeIds: ["module.c"], candidateOwnerCount: 1 }],
      totalCount: 1,
      truncated: false
    });
  });

  test("an evidence gap carries the coverage verdict and the specifiers left unresolved", () => {
    const snapshot = makeSnapshot({
      truncated: true,
      importEdges: [...LOCATED_CYCLE_EDGES, { from: "src/m/b/y.ts", specifier: "./missing", to: null, line: 2 }]
    });
    const assessment = assessObservationOnly({ snapshot });
    expect(evidenceOf(assessment, "evidence-gap")).toEqual({
      kind: "evidence-gap",
      coverage: "partial",
      reasonCodes: snapshot.codeFacts.reasonCodes,
      unresolvedImports: [{ fromPath: "src/m/b/y.ts", fromLine: 2, specifier: "./missing" }],
      totalCount: 1,
      truncated: false
    });
  });

  test("a specifier past the contract bound fails the assessment closed instead of being rewritten", () => {
    const unresolved = (specifier: string) => makeSnapshot({
      truncated: true,
      importEdges: [{ from: "src/m/b/y.ts", specifier, to: null, line: 2 }]
    });
    const atBound = assessObservationOnly({ snapshot: unresolved(`./${"s".repeat(REFACTOR_EVIDENCE_SPECIFIER_MAX_LENGTH - 2)}`) });
    expect((evidenceOf(atBound, "evidence-gap").unresolvedImports as { specifier: string }[])[0]!.specifier).toHaveLength(REFACTOR_EVIDENCE_SPECIFIER_MAX_LENGTH);

    const overLong = unresolved(`./${"s".repeat(REFACTOR_EVIDENCE_SPECIFIER_MAX_LENGTH - 1)}`);
    expect(() => assessRefactor(makeAssessmentInput({ snapshot: overLong }))).toThrow(
      new RegExp(`^AC_SCHEMA_INVALID: .*evidence\\.unresolvedImports\\.specifier must be a single-line specifier of 1-${REFACTOR_EVIDENCE_SPECIFIER_MAX_LENGTH} characters`)
    );
  });

  test("a structure measured for another snapshot is refused", () => {
    const snapshot = makeSnapshot({ importEdges: CYCLE_EDGES });
    const other = makeSnapshot();
    expect(() => assessRefactor(makeAssessmentInput({ snapshot, structure: structureOf(other) }))).toThrow(
      /structure does not bind snapshot\.snapshotDigest/
    );
  });
});

/**
 * A flat graph of modules `module.n1`..`module.nN`, each owning `src/nK/**`, with enough files per
 * module that one direction can carry many distinct file edges.
 */
describe("module pair and residual cycles", () => {
  const FILES_PER_MODULE = 31;

  function graphModel(count: number): NativeModel {
    return {
      nodes: Array.from({ length: count }, (_, index) => ({
        id: `module.n${index + 1}`,
        kind: "module" as const,
        name: `N${index + 1}`,
        source: { include: [`src/n${index + 1}/**`] }
      })),
      relations: []
    };
  }

  function graphFiles(count: number) {
    return Array.from({ length: count }, (_, module) => Array.from({ length: FILES_PER_MODULE }, (_, file) => ({
      path: `src/n${module + 1}/f${String(file).padStart(2, "0")}.ts`,
      lineCount: 3
    }))).flat();
  }

  /** `edges` distinct file edges from module `from` to module `to`, one per source file. */
  function imports(from: number, to: number, edges = 1) {
    return Array.from({ length: edges }, (_, file) => ({
      from: `src/n${from}/f${String(file).padStart(2, "0")}.ts`,
      specifier: `../n${to}/f00`,
      to: `src/n${to}/f00.ts`
    }));
  }

  function assessGraph(moduleCount: number, importEdges: ReturnType<typeof imports>, scope?: Parameters<typeof makeAssessmentInput>[0]) {
    const model = graphModel(moduleCount);
    const trackedFiles = graphFiles(moduleCount);
    const snapshot = makeSnapshot({ model, trackedFiles, importEdges });
    return assessObservationOnly({ snapshot, model, trackedFiles: trackedFiles.map((file) => file.path), ...scope });
  }

  const cyclesOf = (assessment: ReturnType<typeof assessGraph>) =>
    assessment.observations.filter((observation) => observation.kind === "cycle" || observation.kind === "residual-cycle");

  test("a module joining a large component leaves an unrelated pair's identity, metrics and evidence untouched", () => {
    // n1 <-> n2 sits inside one strongly connected component with n3 and n4.
    const base = [...imports(1, 2), ...imports(2, 1, 2), ...imports(2, 3), ...imports(3, 4), ...imports(4, 1)];
    const before = assessGraph(5, base);
    // n5 joins the component through n4 -> n5 -> n3.
    const after = assessGraph(5, [...base, ...imports(4, 5), ...imports(5, 3)]);
    const pairOf = (assessment: ReturnType<typeof assessGraph>) =>
      assessment.observations.find((observation) => observation.subjectSelectorId === "pair:module.n1|module.n2");
    expect(pairOf(before)).toBeDefined();
    expect(pairOf(after)).toEqual(pairOf(before));
    expect(pairOf(before)!.metrics).toEqual({ forwardEdgeCount: 1, backwardEdgeCount: 2, thinDirectionEdgeCount: 1, totalEdgeCount: 3 });
    // The component grew, so the residual it left is reported separately.
    expect(cyclesOf(before).map((observation) => observation.kind)).toEqual(["cycle"]);
    expect(cyclesOf(after).map((observation) => [observation.kind, observation.affectedNodeIds])).toEqual([
      ["cycle", ["module.n1", "module.n2"]],
      ["residual-cycle", ["module.n3", "module.n4", "module.n5"]]
    ]);
  });

  test("a pure three-module cycle has no pair and is reported as one residual cycle", () => {
    const assessment = assessGraph(3, [...imports(1, 2), ...imports(2, 3), ...imports(3, 1)]);
    const cycles = cyclesOf(assessment);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.kind).toBe("residual-cycle");
    expect(cycles[0]!.subjectSelectorId).toStartWith("cycle:");
    expect(cycles[0]!.affectedNodeIds).toEqual(["module.n1", "module.n2", "module.n3"]);
    expect(cycles[0]!.metrics).toEqual({ memberCount: 3, cycleEdgeCount: 3 });
  });

  test("a pair beside a three-module cycle yields the pair and a residual cycle", () => {
    const assessment = assessGraph(5, [
      ...imports(1, 2), ...imports(2, 1, 3), ...imports(2, 3),
      ...imports(3, 4), ...imports(4, 5), ...imports(5, 3)
    ]);
    expect(cyclesOf(assessment).map((observation) => [observation.kind, observation.affectedNodeIds])).toEqual([
      ["cycle", ["module.n1", "module.n2"]],
      ["residual-cycle", ["module.n3", "module.n4", "module.n5"]]
    ]);
    // Every original component counts once toward pressure, however many records it yields.
    expect(assessment.pressure.signalIds).toEqual([...assessment.observations.flatMap((observation) => observation.signalIds)].sort());
  });

  test("a single thin edge survives thirty thick edges in the evidence", () => {
    const assessment = assessGraph(2, [...imports(1, 2, 30), ...imports(2, 1)]);
    const pair = cyclesOf(assessment)[0]!;
    expect(pair.metrics).toEqual({ forwardEdgeCount: 30, backwardEdgeCount: 1, thinDirectionEdgeCount: 1, totalEdgeCount: 31 });
    const evidence = pair.evidence as Extract<typeof pair.evidence, { kind: "cycle" }>;
    expect(evidence.directions).toEqual([
      { fromNodeId: "module.n2", toNodeId: "module.n1", totalCount: 1, sampledCount: 1 },
      { fromNodeId: "module.n1", toNodeId: "module.n2", totalCount: 30, sampledCount: REFACTOR_OBSERVATION_EVIDENCE_LIMIT - 1 }
    ]);
    expect(evidence.edges.filter((edge) => edge.fromNodeId === "module.n2")).toEqual([
      { fromPath: "src/n2/f00.ts", fromLine: null, toPath: "src/n1/f00.ts", specifier: "../n1/f00", fromNodeId: "module.n2", toNodeId: "module.n1" }
    ]);
    expect(evidence.truncated).toBe(true);
  });

  test("pairs are ordered by thin count, then total, then ids", () => {
    const assessment = assessGraph(6, [
      ...imports(1, 2, 3), ...imports(2, 1, 3),
      ...imports(3, 4, 1), ...imports(4, 3, 5),
      ...imports(5, 6, 1), ...imports(6, 5, 1)
    ]);
    expect(cyclesOf(assessment).map((observation) => observation.subjectSelectorId)).toEqual([
      "pair:module.n5|module.n6",
      "pair:module.n3|module.n4",
      "pair:module.n1|module.n2"
    ]);
  });

  test("a node scope keeps only observations touching that node; a paths scope resolves owners", () => {
    const edges = [...imports(1, 2), ...imports(2, 1), ...imports(3, 4), ...imports(4, 3)];
    const repository = assessGraph(4, edges);
    expect(cyclesOf(repository).map((observation) => observation.subjectSelectorId)).toEqual([
      "pair:module.n1|module.n2",
      "pair:module.n3|module.n4"
    ]);
    const node = assessGraph(4, edges, { request: makeRequest({ scope: { kind: "node", nodeId: "module.n3" } }) });
    expect(node.observations.map((observation) => observation.subjectSelectorId)).toEqual(["pair:module.n3|module.n4"]);
    expect(node.observations.every((observation) => observation.affectedNodeIds.includes("module.n3"))).toBe(true);
    const paths = assessGraph(4, edges, { request: makeRequest({ scope: { kind: "paths", paths: ["src/n2/f05.ts"] } }) });
    expect(paths.observations.map((observation) => observation.subjectSelectorId)).toEqual(["pair:module.n1|module.n2"]);
  });
});
