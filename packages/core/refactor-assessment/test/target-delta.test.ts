import { describe, expect, test } from "bun:test";
import { architectureTargetDeltaInterventionId, refactorProposalDigest } from "@archcontext/contracts";
import { deriveTargetDelta, withUnresolvedTargets } from "../src/index";
import { MODEL, makeProposal, makeTargetDelta } from "./factories";

const CURRENT_OWNERS = ["component.a"];

function derive(
  overrides: Parameters<typeof makeTargetDelta>[0] = {},
  currentOwnerIds: string[] = CURRENT_OWNERS
) {
  return deriveTargetDelta(makeTargetDelta(overrides), { model: MODEL, currentOwnerIds });
}

describe("majorChangeReasons", () => {
  test("is empty when the proposal carries no targetDelta", () => {
    expect(deriveTargetDelta(undefined, { model: MODEL, currentOwnerIds: CURRENT_OWNERS })).toEqual({
      reasons: [],
      unresolvedTargets: [],
      resolvedNodeIds: []
    });
  });

  test("is empty when the delta names no owner, relation or removal", () => {
    expect(derive().reasons).toEqual([]);
  });

  test("derives ownership-changed when the resolved owners differ from today's owners", () => {
    expect(derive({ targetState: { owners: { primaryLifecycle: "module.c" }, requiredRelations: [], removedConcepts: [] } }).reasons)
      .toEqual(["ownership-changed"]);
  });

  test("does not derive ownership-changed when the delta restates today's owners", () => {
    expect(derive({ targetState: { owners: { primaryLifecycle: "component.a" }, requiredRelations: [], removedConcepts: [] } }).reasons)
      .toEqual([]);
  });

  test("resolves only the owner values, never the free-form role labels", () => {
    const derivation = derive({
      targetState: { owners: { "module.c": "component.b" }, requiredRelations: [], removedConcepts: [] }
    });
    expect(derivation.resolvedNodeIds).toEqual(["component.b"]);
    expect(derivation.unresolvedTargets).toEqual([]);
  });

  test("derives relation-changed for a requiredRelation the model has not declared", () => {
    const derivation = derive({
      targetState: { owners: {}, requiredRelations: ["relation.a-to-c"], removedConcepts: [] }
    });
    expect(derivation.reasons).toEqual(["relation-changed"]);
    // A relation to be created is the point of the delta, not an unresolved target.
    expect(derivation.unresolvedTargets).toEqual([]);
  });

  test("derives relation-changed when removedConcepts names a declared relation", () => {
    expect(derive({ targetState: { owners: {}, requiredRelations: [], removedConcepts: ["relation.a-to-b"] } }).reasons)
      .toEqual(["relation-changed"]);
  });

  test("derives node-removed when removedConcepts names a declared node", () => {
    const derivation = derive({ targetState: { owners: {}, requiredRelations: [], removedConcepts: ["component.b"] } });
    expect(derivation.reasons).toEqual(["node-removed"]);
    expect(derivation.resolvedNodeIds).toEqual(["component.b"]);
  });

  test("never derives node-added or lifecycle-changed", () => {
    const derivation = derive({
      targetState: {
        owners: { primaryLifecycle: "module.absent" },
        requiredRelations: ["relation.absent"],
        removedConcepts: ["component.absent"]
      }
    });
    expect(derivation.reasons).not.toContain("node-added");
    expect(derivation.reasons).not.toContain("lifecycle-changed");
    expect(derivation.reasons).toEqual(["relation-changed"]);
  });

  test("ignores migrationState entirely", () => {
    const derivation = derive({
      migrationState: {
        active: true,
        compatibilityContracts: ["contract.temporary"],
        cleanupBy: "next-release",
        temporaryRelations: ["relation.temporary"]
      }
    });
    expect(derivation.reasons).toEqual([]);
    expect(derivation.unresolvedTargets).toEqual([]);
  });

  test("sorts and dedupes multiple reasons", () => {
    expect(derive({
      targetState: {
        owners: { primaryLifecycle: "module.c" },
        requiredRelations: ["relation.a-to-c"],
        removedConcepts: ["relation.a-to-b", "component.b"]
      }
    }).reasons).toEqual(["node-removed", "ownership-changed", "relation-changed"]);
  });
});

describe("unresolvedTargets", () => {
  test("collects owner values, removed concepts and completion nodeIds the model cannot resolve", () => {
    const derivation = derive({
      targetState: {
        owners: { primaryLifecycle: "module.absent" },
        requiredRelations: [],
        removedConcepts: ["concept.absent"]
      },
      completionCriteria: [
        {
          outcomeId: "outcome.absent-node",
          metric: "fanOut",
          subjectSelectorId: "module.ghost",
          nodeId: "module.ghost",
          operator: "less_than",
          value: 1,
          required: true
        }
      ]
    });
    expect(derivation.unresolvedTargets).toEqual(["concept.absent", "module.absent", "module.ghost"]);
  });

  test("resolves a completion criterion that names a declared node", () => {
    const derivation = derive({
      completionCriteria: [
        {
          outcomeId: "outcome.declared-node",
          metric: "fanOut",
          subjectSelectorId: "component.b",
          nodeId: "component.b",
          operator: "less_than",
          value: 1,
          required: true
        }
      ]
    });
    expect(derivation.unresolvedTargets).toEqual([]);
    expect(derivation.resolvedNodeIds).toEqual(["component.b"]);
  });

  test("is sorted and unique across the three sources", () => {
    const derivation = derive({
      targetState: { owners: { a: "module.absent", b: "module.absent" }, requiredRelations: [], removedConcepts: ["module.absent"] }
    });
    expect(derivation.unresolvedTargets).toEqual(["module.absent"]);
  });
});

describe("filling unresolvedTargets is digest-safe", () => {
  test("leaves proposalDigest and interventionId untouched", () => {
    const proposal = makeProposal({
      targetDelta: makeTargetDelta({
        targetState: { owners: { primaryLifecycle: "module.absent" }, requiredRelations: [], removedConcepts: [] }
      })
    });
    const derivation = deriveTargetDelta(proposal.targetDelta, { model: MODEL, currentOwnerIds: CURRENT_OWNERS });
    const filled = { ...proposal, targetDelta: withUnresolvedTargets(proposal.targetDelta!, derivation.unresolvedTargets) };

    expect(filled.targetDelta.unresolvedTargets).toEqual(["module.absent"]);
    expect(refactorProposalDigest(filled)).toBe(proposal.proposalDigest);
    expect(architectureTargetDeltaInterventionId(filled.targetDelta)).toBe(proposal.targetDelta!.interventionId);
  });
});
