import type { ArchitecturePosture } from "@archcontext/core/architecture-domain";
import type { ArchitecturePressure } from "@archcontext/core/pressure-engine";

export interface RefactorConfidence {
  level: "low" | "medium" | "high";
  score: number;
  coverage: string[];
  externalConsumers: string[];
  persistedData: string[];
  rollbackPoints: string[];
  evidence: {
    callerCoverage: number | null;
    testsAvailable: boolean | null;
    rollbackAvailable: boolean | null;
  };
}

export function computeRefactorConfidence(input: {
  callerCoverage?: number;
  testsAvailable?: boolean;
  rollbackAvailable?: boolean;
  externalConsumers?: string[];
  persistedData?: string[];
}): RefactorConfidence {
  validateReadinessEvidence(input);
  let score = input.callerCoverage === undefined ? 0 : Math.round(input.callerCoverage * 70);
  if (input.testsAvailable === true) score += 15;
  if (input.rollbackAvailable === true) score += 15;
  if ((input.externalConsumers?.length ?? 0) > 0) score -= 20;
  if ((input.persistedData?.length ?? 0) > 0) score -= 10;
  score = Math.max(0, Math.min(100, score));
  return {
    level: score >= 70 ? "high" : score >= 40 ? "medium" : "low",
    score,
    coverage: input.callerCoverage === undefined ? [] : [`caller-coverage:${input.callerCoverage}`],
    externalConsumers: input.externalConsumers ?? [],
    persistedData: input.persistedData ?? [],
    // Availability is a readiness fact, not proof of a concrete rollback mechanism.
    rollbackPoints: [],
    evidence: {
      callerCoverage: input.callerCoverage ?? null,
      testsAvailable: input.testsAvailable ?? null,
      rollbackAvailable: input.rollbackAvailable ?? null
    }
  };
}

export function decidePosture(
  pressure: ArchitecturePressure,
  _confidence: RefactorConfidence
): ArchitecturePosture {
  if (pressure.level === "high") {
    // This legacy path observes pressure and readiness evidence, but does not own
    // target-architecture authoring. An intervention must be authored through RF2.
    return "proof-required";
  }
  if (pressure.level === "medium") return "structural";
  return "normal";
}

export function createProofPoint(task: string): { description: string; successCriteria: string[]; falsifiers: string[] } {
  return {
    description: `Prove the smallest end-to-end path for: ${task}`,
    successCriteria: ["accountable-target-proposal-authored", "one-owner-observed", "no-fallback-path", "current-tests-pass"],
    falsifiers: ["untracked-external-consumer", "unacceptable-migration-risk"]
  };
}

function validateReadinessEvidence(input: {
  callerCoverage?: number;
  testsAvailable?: boolean;
  rollbackAvailable?: boolean;
}): void {
  if (input.callerCoverage !== undefined &&
    (!Number.isFinite(input.callerCoverage) || input.callerCoverage < 0 || input.callerCoverage > 1)) {
    throw new TypeError("callerCoverage must be a finite ratio between 0 and 1");
  }
  if (input.testsAvailable !== undefined && typeof input.testsAvailable !== "boolean") {
    throw new TypeError("testsAvailable must be a boolean");
  }
  if (input.rollbackAvailable !== undefined && typeof input.rollbackAvailable !== "boolean") {
    throw new TypeError("rollbackAvailable must be a boolean");
  }
}
