import { describe, expect, test } from "bun:test";
import { refactorAssessmentInvariantIssues, refactorScanInvariantIssues } from "@archcontext/contracts";
import { assessRefactor } from "../src/index";
import {
  CONTESTED_MODEL,
  CYCLE_EDGES,
  MODEL,
  UNDECLARED_MODEL,
  digestOf,
  makeAssessmentInput,
  makeSnapshot
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

  test("reports one cycle record per strongly connected component, not per member", () => {
    const assessment = assessObservationOnly({ snapshot });
    const cycles = assessment.observations.filter((observation) => observation.kind === "cycle");
    expect(cycles).toHaveLength(1);
    expect(cycles[0].subjectSelectorId).toStartWith("scc:");
    expect(cycles[0].metrics.memberCount).toBe(2);
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
