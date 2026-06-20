import { describe, expect, test } from "bun:test";
import type { ArchitecturePressure } from "@archcontext/pressure-engine";
import { computeRefactorConfidence, createInterventionProposal, createProofPoint, decidePosture } from "../src/index";

const highPressure: ArchitecturePressure = {
  level: "high",
  score: 80,
  signals: [{ type: "unjustified-wrapper-adapter", severity: "high", evidence: ["task-text"], evidenceKind: "heuristic" }]
};

describe("@archcontext/refactor-decision", () => {
  test("separates pressure from confidence when choosing posture", () => {
    const low = computeRefactorConfidence({
      callerCoverage: 0.2,
      testsAvailable: false,
      rollbackAvailable: false,
      externalConsumers: ["public-api"],
      persistedData: ["billing-db"]
    });
    const high = computeRefactorConfidence({ callerCoverage: 1, testsAvailable: true, rollbackAvailable: true });

    expect(low.level).toBe("low");
    expect(high.level).toBe("high");
    expect(decidePosture(highPressure, low)).toBe("proof-required");
    expect(decidePosture(highPressure, high)).toBe("intervention");
    expect(decidePosture({ ...highPressure, level: "medium", score: 35 }, high)).toBe("structural");
  });

  test("creates proof points and intervention proposals with cleanup state", () => {
    const confidence = computeRefactorConfidence({
      callerCoverage: 0.9,
      testsAvailable: true,
      rollbackAvailable: true,
      externalConsumers: ["mobile-app"]
    });
    const proof = createProofPoint("Unify billing lifecycle owner");
    const proposal = createInterventionProposal({
      task: "Unify billing lifecycle owner",
      pressure: highPressure,
      confidence
    });

    expect(proof.falsifiers).toContain("untracked-external-consumer");
    expect(proposal.id).toBe("intervention.unify-billing-lifecycle-owner");
    expect(proposal.migrationState.active).toBe(true);
    expect(proposal.killList.every((item) => item.required)).toBe(true);
    expect(proposal.constraints.real).toContain("mobile-app");
  });
});
