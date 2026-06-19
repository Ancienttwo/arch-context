import { createInterventionId, type ArchitectureInterventionModel, type ArchitecturePosture } from "../../architecture-domain/src/index";
import type { ArchitecturePressure } from "../../pressure-engine/src/index";

export interface RefactorConfidence {
  level: "low" | "medium" | "high";
  score: number;
  coverage: string[];
  externalConsumers: string[];
  persistedData: string[];
  rollbackPoints: string[];
}

export function computeRefactorConfidence(input: {
  callerCoverage: number;
  testsAvailable: boolean;
  rollbackAvailable: boolean;
  externalConsumers?: string[];
  persistedData?: string[];
}): RefactorConfidence {
  let score = Math.round(input.callerCoverage * 70);
  if (input.testsAvailable) score += 15;
  if (input.rollbackAvailable) score += 15;
  if ((input.externalConsumers?.length ?? 0) > 0) score -= 20;
  if ((input.persistedData?.length ?? 0) > 0) score -= 10;
  score = Math.max(0, Math.min(100, score));
  return {
    level: score >= 70 ? "high" : score >= 40 ? "medium" : "low",
    score,
    coverage: [`caller-coverage:${input.callerCoverage}`],
    externalConsumers: input.externalConsumers ?? [],
    persistedData: input.persistedData ?? [],
    rollbackPoints: input.rollbackAvailable ? ["git-worktree"] : []
  };
}

export function decidePosture(pressure: ArchitecturePressure, confidence: RefactorConfidence): ArchitecturePosture {
  if (pressure.level === "high" && confidence.level === "low") return "proof-required";
  if (pressure.level === "high" && confidence.level === "high") return "intervention";
  if (pressure.level === "medium") return "structural";
  return "normal";
}

export function createProofPoint(task: string): { description: string; successCriteria: string[]; falsifiers: string[] } {
  return {
    description: `Prove the smallest end-to-end path for: ${task}`,
    successCriteria: ["one-owner-observed", "no-fallback-path", "current-tests-pass"],
    falsifiers: ["untracked-external-consumer", "unacceptable-migration-risk"]
  };
}

export function createInterventionProposal(input: {
  task: string;
  pressure: ArchitecturePressure;
  confidence: RefactorConfidence;
}): ArchitectureInterventionModel {
  const proofPoint = createProofPoint(input.task);
  return {
    id: createInterventionId(input.task),
    status: "proposed",
    thesis: `Resolve ${input.pressure.signals.map((signal) => signal.type).join(", ")} by moving to a single target architecture rather than adding a permanent compatibility layer.`,
    targetState: {
      owners: { primaryLifecycle: "module.target-owner" },
      requiredRelations: ["relation.target-calls-boundary"],
      removedConcepts: ["legacy-wrapper", "fallback-mapper"]
    },
    migrationState: {
      active: true,
      compatibilityContracts: [],
      cleanupBy: "next-release",
      temporaryRelations: ["relation.temporary-migration"]
    },
    constraints: {
      real: [...input.confidence.externalConsumers, ...input.confidence.persistedData],
      inherited: ["internal-callers", "legacy-layout"]
    },
    proofPoint,
    killList: [
      { id: "remove-legacy-wrapper", target: "symbol.legacyWrapper", required: true },
      { id: "remove-fallback-mapper", target: "symbol.fallbackMapper", required: true }
    ],
    benefitLedger: {
      benefits: ["single lifecycle owner", "bounded migration cleanup", "fewer compatibility paths"],
      costs: ["larger coordinated change"],
      rollbackPoint: input.confidence.rollbackPoints[0] ?? "git"
    }
  };
}
