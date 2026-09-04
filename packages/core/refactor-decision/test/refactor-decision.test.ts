import { describe, expect, test } from "bun:test";
import type { ArchitecturePressure } from "@archcontext/core/pressure-engine";
import { computeRefactorConfidence, createProofPoint, decidePosture } from "../src/index";

const highPressure: ArchitecturePressure = {
  level: "high",
  score: 80,
  signals: [{
    type: "unjustified-wrapper-adapter",
    severity: "high",
    evidence: ["symbol.legacyWrapper"],
    evidenceKind: "observed",
    evidenceDetails: [{
      kind: "symbol",
      strength: "observed",
      subject: "symbol.legacyWrapper",
      digest: `sha256:${"a".repeat(64)}`,
      observedAt: "1970-01-01T00:00:00.000Z"
    }]
  }]
};

describe("@archcontext/core/refactor-decision", () => {
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
    expect(decidePosture(highPressure, high)).toBe("proof-required");
    expect(decidePosture({ ...highPressure, level: "medium", score: 35 }, high)).toBe("structural");
  });

  test("keeps missing evidence unknown instead of inventing readiness", () => {
    const confidence = computeRefactorConfidence({});

    expect(confidence).toMatchObject({
      level: "low",
      score: 0,
      coverage: [],
      rollbackPoints: [],
      evidence: {
        callerCoverage: null,
        testsAvailable: null,
        rollbackAvailable: null
      }
    });
  });

  test("distinguishes observed zero and false evidence from unknown", () => {
    const confidence = computeRefactorConfidence({
      callerCoverage: 0,
      testsAvailable: false,
      rollbackAvailable: false
    });

    expect(confidence.evidence).toEqual({
      callerCoverage: 0,
      testsAvailable: false,
      rollbackAvailable: false
    });
    expect(confidence.coverage).toEqual(["caller-coverage:0"]);
  });

  test("does not invent a rollback point from availability alone", () => {
    const confidence = computeRefactorConfidence({ rollbackAvailable: true });

    expect(confidence.evidence.rollbackAvailable).toBe(true);
    expect(confidence.rollbackPoints).toEqual([]);
  });

  test("rejects invalid explicit readiness evidence", () => {
    expect(() => computeRefactorConfidence({ callerCoverage: -0.1 })).toThrow("callerCoverage must be a finite ratio between 0 and 1");
    expect(() => computeRefactorConfidence({ callerCoverage: 1.1 })).toThrow("callerCoverage must be a finite ratio between 0 and 1");
    expect(() => computeRefactorConfidence({ callerCoverage: Number.NaN })).toThrow("callerCoverage must be a finite ratio between 0 and 1");
    expect(() => computeRefactorConfidence({ testsAvailable: "yes" as unknown as boolean })).toThrow("testsAvailable must be a boolean");
    expect(() => computeRefactorConfidence({ rollbackAvailable: 1 as unknown as boolean })).toThrow("rollbackAvailable must be a boolean");
  });

  test("creates proof points without authoring target architecture", () => {
    const proof = createProofPoint("Unify billing lifecycle owner");

    expect(proof.falsifiers).toContain("untracked-external-consumer");
    expect(proof.successCriteria).toContain("accountable-target-proposal-authored");
  });
});
