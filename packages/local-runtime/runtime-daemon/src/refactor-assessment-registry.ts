import {
  ARCHITECTURE_MAJOR_CHANGE_REASON_CODES,
  REFACTOR_OBSERVATION_KINDS,
  REFACTOR_SCALES,
  REFACTOR_SCALE_REASON_CODES,
  digestJson,
  type Json,
  type ModuleStatisticsSnapshotV1,
  type RefactorAssessmentV1,
  type RefactorProposalV1
} from "@archcontext/contracts";

/**
 * A scan holds its measured snapshot and assessment in memory only. The cap keeps the daemon
 * from turning into an unbounded parallel store of measurements the ledger never accepted; an
 * evicted digest fails closed at `refactor record` and the caller re-runs the scan.
 */
export const REFACTOR_ASSESSMENT_REGISTRY_CAPACITY = 8;
export const REFACTOR_CLASSIFIER_RULESET_SCHEMA_VERSION = "archcontext.refactor-classifier-ruleset/v1" as const;

export interface RegisteredRefactorAssessmentV1 {
  snapshot: ModuleStatisticsSnapshotV1;
  assessment: RefactorAssessmentV1;
  /** The proposal returned by `assessRefactor`, carrying resolved `unresolvedTargets`. */
  proposal?: RefactorProposalV1;
  /**
   * The manifest `product.id` the scan scoped its selectors by. Carried so a record or a decision
   * re-plans the measured run under exactly the identity the scan previewed.
   */
  namespace: string;
  headSha: string;
  worktreeDigest: string;
  decisionSnapshot?: {
    digest: string;
    structuralWorktreeDigest: string;
    recommendationIds: ReadonlySet<string>;
  };
}

/** Bounded LRU shared by explicit records and snapshot-backed decisions. In-process only. */
export class RefactorAssessmentRegistry {
  private readonly entries = new Map<string, RegisteredRefactorAssessmentV1>();

  constructor(private readonly capacity: number = REFACTOR_ASSESSMENT_REGISTRY_CAPACITY) {}

  register(entry: RegisteredRefactorAssessmentV1): string {
    const key = entry.assessment.assessmentDigest;
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return key;
  }

  get(assessmentDigest: string): RegisteredRefactorAssessmentV1 | undefined {
    const entry = this.entries.get(assessmentDigest);
    if (!entry) return undefined;
    this.entries.delete(assessmentDigest);
    this.entries.set(assessmentDigest, entry);
    return entry;
  }

  getBySnapshotDigest(snapshotDigest: string): RegisteredRefactorAssessmentV1 | undefined {
    for (const [key, entry] of this.entries) {
      if (entry.decisionSnapshot?.digest === snapshotDigest) return this.get(key);
    }
    return undefined;
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * `RecommendationRunV1.catalogDigest` has no practice catalog to bind for a refactor run, so it
 * binds the classifier ruleset instead: the closed enums plus the engine version that decided the
 * scale. A run replayed under a changed ruleset is visibly a different run.
 */
export function refactorClassifierRulesetDigest(engineVersion: string): string {
  return digestJson({
    schemaVersion: REFACTOR_CLASSIFIER_RULESET_SCHEMA_VERSION,
    engineVersion,
    scales: [...REFACTOR_SCALES],
    scaleReasonCodes: [...REFACTOR_SCALE_REASON_CODES],
    observationKinds: [...REFACTOR_OBSERVATION_KINDS],
    majorChangeReasonCodes: [...ARCHITECTURE_MAJOR_CHANGE_REASON_CODES]
  } as unknown as Json);
}
