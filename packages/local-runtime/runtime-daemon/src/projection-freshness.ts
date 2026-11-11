import type { ProjectionFreshnessV2 } from "@archcontext/contracts";
import type { ArchitectureProjectionFreshnessEvaluation } from "@archcontext/core/projection-engine";

/**
 * The `ProjectionFreshnessV2` contract shape of the engine's evaluation (ADR-0056 §1). `check`, the
 * `complete` gate and `projection freshness` all read `plan.freshness` of one projection build, so
 * on the same tree they report the same answer.
 */
export function projectionFreshnessContract(evaluation: ArchitectureProjectionFreshnessEvaluation): ProjectionFreshnessV2 {
  return {
    ok: evaluation.ok,
    reasonCodes: [...evaluation.reasonCodes].sort(),
    staleTargets: evaluation.staleTargets.map((target) => ({ ...target }))
  };
}
