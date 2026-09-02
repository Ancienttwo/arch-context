import { describe, expect, test } from "bun:test";
import { refactorAssessmentInvariantIssues, refactorScanInvariantIssues } from "@archcontext/contracts";
import { assessRefactor, type RefactorAssessmentInputV1 } from "../src/index";
import {
  CONTESTED_MODEL,
  MODEL,
  UNDECLARED_MODEL,
  digestOf,
  makeAssessmentInput,
  makeProposal,
  makeRequest,
  makeSnapshot,
  makeTargetDelta
} from "./factories";

/** Placeholder identifiers `createInterventionProposal()` invents; RF2 must never emit them. */
const PLACEHOLDER = /module\.target-owner|relation\.target-|legacy-wrapper|fallbackMapper/;

function assess(overrides: Partial<RefactorAssessmentInputV1> = {}) {
  const input = makeAssessmentInput(overrides);
  const result = assessRefactor(input);
  expect(refactorAssessmentInvariantIssues(result.assessment)).toEqual([]);
  expect(refactorScanInvariantIssues({
    snapshot: input.snapshot,
    assessment: result.assessment,
    proposal: result.proposal
  })).toEqual([]);
  return result;
}

function assessProposal(scopePaths: string[], overrides: Partial<RefactorAssessmentInputV1> = {}) {
  const proposal = makeProposal({ scopePaths });
  return assess({ ...overrides, request: makeRequest({ ...overrides.request, proposal }) });
}

describe("S1 single module", () => {
  test("classifies one owned file under one node as module", () => {
    const { assessment } = assessProposal(["src/m/a/x.ts"]);
    expect(assessment.scale).toBe("module");
    expect(assessment.affectedNodeIds).toEqual(["component.a"]);
    expect(assessment.scaleReasonCodes).toEqual(["caller-coverage-unknown", "single-node-scope"]);
    expect(assessment.majorChangeReasons).toEqual([]);
  });
});

describe("S2 cross module", () => {
  test("classifies two sibling components as cross_module", () => {
    const proposal = makeProposal({
      scopePaths: ["src/m/a/x.ts", "src/m/b/y.ts"],
      killList: [{ kind: "symbol", selectorId: "symbol.sharedBoundary", required: true }]
    });
    const { assessment } = assess({ request: makeRequest({ proposal }) });
    expect(assessment.scale).toBe("cross_module");
    expect(assessment.affectedNodeIds).toEqual(["component.a", "component.b"]);
    expect(assessment.scaleReasonCodes).toEqual(["caller-coverage-unknown", "multi-node-scope"]);
  });

  test("a component plus its parent's own file is two owners, so cross_module", () => {
    const { assessment } = assessProposal(["src/m/a/x.ts", "src/m/root.ts"]);
    expect(assessment.scale).toBe("cross_module");
    // Ancestors never count on their own; `module.m` is here because it owns `src/m/root.ts`.
    expect(assessment.affectedNodeIds).toEqual(["component.a", "module.m"]);
  });
});

describe("S3 architecture", () => {
  const proposal = makeProposal({
    scopePaths: ["src/m/a/x.ts"],
    targetDelta: makeTargetDelta({
      targetState: {
        owners: { primaryLifecycle: "module.c" },
        requiredRelations: [],
        removedConcepts: ["relation.a-to-b"]
      }
    })
  });

  test("classifies an owner change plus a relation removal as architecture", () => {
    const { assessment } = assess({ request: makeRequest({ proposal }) });
    expect(assessment.scale).toBe("architecture");
    expect(assessment.majorChangeReasons).toEqual(["ownership-changed", "relation-changed"]);
    expect(assessment.scaleReasonCodes).toEqual(["caller-coverage-unknown", "major-change-detected"]);
    expect(assessment.affectedNodeIds).toEqual(["component.a", "module.c"]);
  });

  test("fills unresolvedTargets as empty and keeps the authored proposal digest", () => {
    const { assessment, proposal: filled } = assess({ request: makeRequest({ proposal }) });
    expect(filled?.targetDelta?.unresolvedTargets).toEqual([]);
    expect(filled?.proposalDigest).toBe(proposal.proposalDigest);
    expect(assessment.proposalDigest).toBe(proposal.proposalDigest);
  });

  test("emits no placeholder target strings", () => {
    const { assessment, proposal: filled } = assess({ request: makeRequest({ proposal }) });
    expect(JSON.stringify(assessment)).not.toMatch(PLACEHOLDER);
    expect(JSON.stringify(filled)).not.toMatch(PLACEHOLDER);
  });
});

describe("S5 incomplete evidence", () => {
  test("1. an unavailable index yields insufficient_evidence with code-facts-missing", () => {
    const snapshot = makeSnapshot({ codeFacts: {
      version: "0.9.1",
      binaryDigest: digestOf("index-binary"),
      availability: "unavailable",
      indexedWorktreeDigest: null
    } });
    const { assessment } = assessProposal(["src/m/a/x.ts"], { snapshot });
    expect(assessment.scale).toBe("insufficient_evidence");
    expect(assessment.scaleReasonCodes).toContain("code-facts-missing");
    expect(assessment.confidence.level).toBe("low");
  });

  test("2. a truncated index yields insufficient_evidence with code-facts-truncated", () => {
    const { assessment } = assessProposal(["src/m/a/x.ts"], { snapshot: makeSnapshot({ truncated: true }) });
    expect(assessment.scale).toBe("insufficient_evidence");
    expect(assessment.scaleReasonCodes).toContain("code-facts-truncated");
  });

  test("3. a non-ancestor ownership contest yields insufficient_evidence", () => {
    const { assessment } = assessProposal(["src/m/a/x.ts"], {
      snapshot: makeSnapshot({ model: CONTESTED_MODEL }),
      model: CONTESTED_MODEL
    });
    expect(assessment.scale).toBe("insufficient_evidence");
    expect(assessment.scaleReasonCodes).toContain("ownership-ambiguous");
    expect(assessment.confidence.unresolvedEvidence).toContain("ownership-ambiguous:src/m/a/x.ts");
  });

  test("4. an unowned scope path yields model_adoption_required", () => {
    const { assessment } = assessProposal(["src/m/a/x.ts", "tools/gen.ts"]);
    expect(assessment.scale).toBe("model_adoption_required");
    expect(assessment.scaleReasonCodes).toContain("unowned-paths");
    expect(assessment.confidence.unresolvedEvidence).toContain("unowned-path:tools/gen.ts");
  });

  test("5. a node scope on an undeclared footprint yields model_adoption_required", () => {
    const proposal = makeProposal({ scopePaths: ["src/m/a/x.ts"] });
    const { assessment } = assess({
      snapshot: makeSnapshot({ model: UNDECLARED_MODEL }),
      model: UNDECLARED_MODEL,
      request: makeRequest({ scope: { kind: "node", nodeId: "module.m" }, proposal })
    });
    expect(assessment.scale).toBe("model_adoption_required");
    expect(assessment.scaleReasonCodes).toContain("node-footprint-undeclared");
    expect(assessment.confidence.unresolvedEvidence).toContain("undeclared-footprint:module.m");
  });

  test.each([
    ["a glob", "src/m/**"],
    ["a character class", "src/m/[ab]/x.ts"],
    ["a brace expansion", "src/m/{a,b}/x.ts"],
    ["an extglob", "src/m/a/+(x).ts"],
    ["a directory", "src/m/a"],
    ["a plausible but untracked file", "src/m/a/absent.ts"]
  ])("%s scope entry is not a tracked file, so it is unowned", (_label, scopePath) => {
    const { assessment } = assessProposal([scopePath]);
    expect(assessment.scale).toBe("model_adoption_required");
    expect(assessment.scaleReasonCodes).toContain("unowned-paths");
    expect(assessment.confidence.unresolvedEvidence).toContain(`unowned-path:${scopePath}`);
  });

  test("an untracked path is unowned even though a node glob claims it", () => {
    // `src/m/a/absent.ts` matches `component.a`'s include; only the tracked-file test rejects it.
    const { assessment } = assessProposal(["src/m/a/absent.ts"]);
    expect(assessment.affectedNodeIds).toEqual([]);
    expect(assessment.scale).toBe("model_adoption_required");
  });

  test("an unresolvable targetDelta id is insufficient_evidence, never architecture", () => {
    const proposal = makeProposal({
      scopePaths: ["src/m/a/x.ts"],
      targetDelta: makeTargetDelta({
        targetState: { owners: { primaryLifecycle: "module.absent" }, requiredRelations: [], removedConcepts: [] }
      })
    });
    const { assessment, proposal: filled } = assess({ request: makeRequest({ proposal }) });
    expect(assessment.scale).toBe("insufficient_evidence");
    expect(assessment.scaleReasonCodes).toContain("target-unresolved");
    expect(filled?.targetDelta?.unresolvedTargets).toEqual(["module.absent"]);
  });

  test("an unresolved target outranks the model gate, as the frozen scan invariant requires", () => {
    const proposal = makeProposal({
      scopePaths: ["tools/gen.ts"],
      targetDelta: makeTargetDelta({
        targetState: { owners: { primaryLifecycle: "module.absent" }, requiredRelations: [], removedConcepts: [] }
      })
    });
    const { assessment } = assess({ request: makeRequest({ proposal }) });
    expect(assessment.scale).toBe("insufficient_evidence");
    expect(assessment.scaleReasonCodes).toContain("target-unresolved");
    expect(assessment.scaleReasonCodes).toContain("unowned-paths");
  });
});

describe("declared selectors in targetDelta", () => {
  test("a removed declared entrypoint is resolved, so the scale is not insufficient_evidence", () => {
    const proposal = makeProposal({
      scopePaths: ["src/m/a/x.ts"],
      targetDelta: makeTargetDelta({
        targetState: { owners: {}, requiredRelations: [], removedConcepts: ["entrypoint.architecture-context.cli"] }
      })
    });
    const { assessment, proposal: filled } = assess({ request: makeRequest({ proposal }) });
    expect(filled?.targetDelta?.unresolvedTargets).toEqual([]);
    expect(assessment.scaleReasonCodes).not.toContain("target-unresolved");
    expect(assessment.scale).toBe("module");
    expect(assessment.majorChangeReasons).toEqual([]);
  });
});

describe("confidence", () => {
  test("caps any v1 proposal below high and never invents test or rollback evidence", () => {
    const { assessment } = assessProposal(["src/m/a/x.ts"]);
    expect(assessment.confidence.level).toBe("medium");
    expect(assessment.confidence.callerCoverage).toBeNull();
    expect(assessment.confidence.testsObserved).toBeNull();
    expect(assessment.confidence.rollbackObserved).toBeNull();
    expect(assessment.confidence.unresolvedEvidence).toEqual([
      "caller-coverage:component.a",
      "rollback:proposal",
      "tests:component.a"
    ]);
  });
});

describe("heuristic isolation", () => {
  test("task text does not move the assessment digest", () => {
    const proposal = makeProposal({ scopePaths: ["src/m/a/x.ts", "src/m/b/y.ts"] });
    const withoutTask = assess({ request: makeRequest({ proposal }) }).assessment;
    const withTask = assess({
      request: makeRequest({
        proposal,
        task: "urgent legacy migration: rewrite the god object, delete the compatibility layer, split module.m"
      })
    }).assessment;
    expect(withTask.assessmentDigest).toBe(withoutTask.assessmentDigest);
    expect(withTask.scale).toBe("cross_module");
    expect(withTask.pressure).toEqual(withoutTask.pressure);
  });
});

describe("model binding", () => {
  test("every fixture model is the one the snapshot measured", () => {
    expect(MODEL.nodes.map((node) => node.id).sort()).toEqual(["component.a", "component.b", "module.c", "module.m"]);
  });
});
