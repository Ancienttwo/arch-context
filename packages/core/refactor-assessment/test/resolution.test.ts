import { describe, expect, test } from "bun:test";
import {
  RECOMMENDATION_V3_SCHEMA_VERSION,
  REFACTOR_OBSERVATION_KINDS,
  REFACTOR_OUTCOME_OPERATORS,
  REFACTOR_RESOLUTION_EVIDENCE_SCHEMA_VERSION,
  refactorResolutionEvidenceInvariantIssues,
  type ModuleStatisticsSnapshotV1,
  type RecommendationV3,
  type RefactorKillListEntryV1,
  type RefactorOutcomeOperator,
  type RefactorProposalPayloadV1,
  type RefactorTargetOutcomeV1,
  type StructuralObservationPayloadV1
} from "@archcontext/contracts";
import {
  REFACTOR_RESOLUTION_METRICS,
  deriveObservationOutcomes,
  evaluateResolution,
  readSnapshotMetric,
  refactorOutcomeVocabularyIssues,
  refactorResolutionOutcomeId,
  type RefactorResolutionInputV1,
  type RefactorResolutionMetric
} from "../src/resolution";
import { CYCLE_EDGES, MODEL, TRACKED_PATHS, WORKTREE_DIGEST, digestOf, makeSnapshot } from "./factories";

const VERIFIED_AT = "2026-09-03T13:30:00.000Z";

/** The BEFORE state: `component.a` and `module.c` import each other, so two cycle edges exist. */
const BEFORE = makeSnapshot({ importEdges: CYCLE_EDGES });
/** The AFTER state: the same repository with the cross-module cycle removed. */
const AFTER = makeSnapshot();

/** Truncated but attested: coverage degrades to `partial` while the index still covers the tree. */
const AFTER_PARTIAL = makeSnapshot({
  truncated: true,
  codeFacts: { version: "0.9.1", binaryDigest: digestOf("index-binary"), availability: "ready", indexedWorktreeDigest: WORKTREE_DIGEST }
});
/** An index that attested some other tree: nothing here describes the worktree being verified. */
const AFTER_FOREIGN_INDEX = makeSnapshot({
  truncated: true,
  codeFacts: {
    version: "0.9.1",
    binaryDigest: digestOf("index-binary"),
    availability: "unavailable",
    indexedWorktreeDigest: digestOf("some-other-worktree")
  }
});

function outcome(overrides: Partial<RefactorTargetOutcomeV1> & Pick<RefactorTargetOutcomeV1, "metric">): RefactorTargetOutcomeV1 {
  const draft = {
    subjectSelectorId: "repository:repo.rf2",
    nodeId: null,
    operator: "less_than" as RefactorOutcomeOperator,
    value: 1,
    required: true,
    ...overrides
  };
  return { ...draft, outcomeId: refactorResolutionOutcomeId(draft) };
}

function proposalRecommendation(input: {
  targetOutcomes: RefactorTargetOutcomeV1[];
  killList?: RefactorKillListEntryV1[];
  baselineSnapshotDigest?: string;
}): RecommendationV3 {
  const payload: RefactorProposalPayloadV1 = {
    assessmentDigest: digestOf("assessment.rf4"),
    proposalDigest: digestOf("proposal.rf4"),
    scale: "cross_module",
    affectedNodeIds: ["component.a", "module.c"],
    majorChangeReasons: [],
    baselineSnapshotDigest: input.baselineSnapshotDigest ?? BEFORE.snapshotDigest,
    targetOutcomes: input.targetOutcomes,
    killList: input.killList ?? []
  };
  return {
    schemaVersion: RECOMMENDATION_V3_SCHEMA_VERSION,
    recommendationId: "recommendation.rf4-proposal",
    runId: "recommendation_run.rf4",
    fingerprint: digestOf("fingerprint.rf4-proposal"),
    subject: "component.a",
    status: "accepted",
    confidence: "medium",
    enforcement: "checkpoint",
    risk: "medium",
    uncertainty: "low",
    evidenceBindingIds: [],
    explanation: ["Collapse the cross-module cycle."],
    authoredBy: { kind: "subagent", id: "agent.refactor-planner", source: "subagent" },
    subjectSelectorId: "repository:repo.rf2",
    relations: {},
    createdAt: "2026-09-03T05:13:00.000Z",
    updatedAt: "2026-09-03T05:13:00.000Z",
    category: "refactor_proposal",
    payload
  };
}

function observationRecommendation(derivedOutcomes: RefactorTargetOutcomeV1[]): RecommendationV3 {
  const payload: StructuralObservationPayloadV1 = {
    assessmentDigest: digestOf("assessment.rf4"),
    kind: "cycle",
    affectedNodeIds: ["component.a"],
    baselineSnapshotDigest: BEFORE.snapshotDigest,
    derivedOutcomes
  };
  return {
    ...proposalRecommendation({ targetOutcomes: [] }),
    recommendationId: "recommendation.rf4-observation",
    category: "structural_observation",
    authoredBy: { kind: "daemon", id: "archctxd", source: "daemon" },
    enforcement: "advisory",
    payload
  };
}

function evaluate(overrides: Partial<RefactorResolutionInputV1> = {}): ReturnType<typeof evaluateResolution> {
  return evaluateResolution({
    recommendation: proposalRecommendation({ targetOutcomes: [outcome({ metric: "repositorySummary.crossModuleCycleCount" })] }),
    beforeSnapshotDigest: BEFORE.snapshotDigest,
    afterSnapshot: AFTER,
    afterModel: MODEL,
    afterTrackedFiles: TRACKED_PATHS,
    verifiedAt: VERIFIED_AT,
    ...overrides
  });
}

function residualCodes(evidence: { residuals: { code: string }[] }): string[] {
  return evidence.residuals.map((residual) => residual.code);
}

describe("REFACTOR_RESOLUTION_METRICS", () => {
  test("is a closed, sorted, unique vocabulary of pure field paths", () => {
    expect([...REFACTOR_RESOLUTION_METRICS]).toEqual([...new Set(REFACTOR_RESOLUTION_METRICS)].sort());
    expect(REFACTOR_RESOLUTION_METRICS).toHaveLength(28);
    for (const metric of REFACTOR_RESOLUTION_METRICS) {
      expect(metric).not.toContain("<");
      expect(metric.startsWith("repositorySummary.") || metric.startsWith("module.") || metric.startsWith("killList."))
        .toBe(true);
    }
  });

  test("rejects an unknown metric and a nodeId shape mismatch", () => {
    expect(refactorOutcomeVocabularyIssues([outcome({ metric: "crossModuleCycleCount" })])[0])
      .toContain("outside the resolution vocabulary");
    expect(refactorOutcomeVocabularyIssues([outcome({ metric: "repositorySummary.moduleCount", nodeId: "component.a" })])[0])
      .toContain("must be null");
    expect(refactorOutcomeVocabularyIssues([outcome({ metric: "module.dependencyGraph.cycleCount", nodeId: null })])[0])
      .toContain("nodeId is required");
    expect(refactorOutcomeVocabularyIssues([outcome({ metric: "module.dependencyGraph.cycleCount", nodeId: "component.a" })]))
      .toEqual([]);
  });
});

describe("readSnapshotMetric", () => {
  test("reads every repository-summary and module field the vocabulary names", () => {
    expect(readSnapshotMetric(BEFORE, "repositorySummary.crossModuleCycleCount", null)).toBe(2);
    expect(readSnapshotMetric(AFTER, "repositorySummary.crossModuleCycleCount", null)).toBe(0);
    expect(readSnapshotMetric(BEFORE, "repositorySummary.moduleCount", null)).toBe(4);
    expect(readSnapshotMetric(BEFORE, "module.dependencyGraph.cycleCount", "component.a")).toBe(1);
    expect(readSnapshotMetric(BEFORE, "module.footprintDeclared", "component.a")).toBe(1);
    expect(readSnapshotMetric(BEFORE, "module.uncertainty.ambiguousOwnership", "component.a")).toBe(0);
    expect(readSnapshotMetric(BEFORE, "module.footprint.lineCount", "component.a")).toBe(8);
    expect(readSnapshotMetric(BEFORE, "module.tests.callerCoverage", "component.a")).toBeNull();
  });

  test("answers null for a node the snapshot never measured and for kill-list metrics", () => {
    expect(readSnapshotMetric(AFTER, "module.dependencyGraph.cycleCount", "component.dissolved")).toBeNull();
    expect(readSnapshotMetric(AFTER, "killList.path.present", null)).toBeNull();
  });
});

describe("deriveObservationOutcomes", () => {
  test("derives one required absent/present outcome per kind, never less_than 1", () => {
    const derived = Object.fromEntries(REFACTOR_OBSERVATION_KINDS.map((kind) => [
      kind,
      deriveObservationOutcomes({ kind, subjectSelectorId: "repository:repo.rf2", affectedNodeIds: ["component.a", "module.c"] })
    ]));

    expect(derived.cycle!.map((entry) => [entry.metric, entry.nodeId, entry.operator])).toEqual([
      ["module.dependencyGraph.cycleCount", "component.a", "absent"],
      ["module.dependencyGraph.cycleCount", "module.c", "absent"]
    ].sort((left, right) => String(left[1]).localeCompare(String(right[1]))));
    expect(derived["direction-violation"]!.map((entry) => entry.metric))
      .toEqual(["module.dependencyGraph.directionViolationCount", "module.dependencyGraph.directionViolationCount"]);
    expect(derived["ownership-ambiguous"]!.every((entry) => entry.metric === "module.uncertainty.ambiguousOwnership")).toBe(true);
    expect(derived["undeclared-footprint"]!.every((entry) => entry.operator === "present")).toBe(true);
    expect(derived["unowned-paths"]!.map((entry) => [entry.metric, entry.nodeId]))
      .toEqual([["repositorySummary.unownedFileCount", null]]);
    expect(derived["evidence-gap"]!.map((entry) => [entry.metric, entry.nodeId]))
      .toEqual([["repositorySummary.unresolvedImportCount", null]]);

    for (const outcomes of Object.values(derived)) {
      expect(refactorOutcomeVocabularyIssues(outcomes)).toEqual([]);
      expect(outcomes.every((entry) => entry.required && entry.value === null)).toBe(true);
      expect(outcomes.map((entry) => entry.outcomeId)).toEqual([...outcomes.map((entry) => entry.outcomeId)].sort());
      expect(outcomes.every((entry) => entry.operator !== "less_than")).toBe(true);
    }
  });
});

describe("evaluateResolution disposition ladder", () => {
  test("S4: every required outcome satisfied at a complete after-snapshot is resolved", () => {
    const evidence = evaluate({ beforeSnapshot: BEFORE });

    expect(evidence.schemaVersion).toBe(REFACTOR_RESOLUTION_EVIDENCE_SCHEMA_VERSION);
    expect(evidence.disposition).toBe("resolved");
    expect(evidence.observedOutcomes[0]).toMatchObject({ observedValue: 0, satisfied: true, direction: "improved" });
    expect(evidence.afterSnapshotDigest).toBe(AFTER.snapshotDigest);
    expect(evidence.verifiedHeadSha).toBe(AFTER.worktree.headSha);
    expect(evidence.residuals).toEqual([]);
    expect(refactorResolutionEvidenceInvariantIssues(evidence)).toEqual([]);
  });

  test("S6: merged but unimproved is not_improved and never resolved", () => {
    const evidence = evaluate({ afterSnapshot: BEFORE, beforeSnapshot: BEFORE });

    expect(evidence.disposition).toBe("not_improved");
    expect(evidence.observedOutcomes[0]).toMatchObject({ observedValue: 2, satisfied: false, direction: "unchanged" });
    expect(refactorResolutionEvidenceInvariantIssues(evidence)).toEqual([]);
  });

  test("some but not all required outcomes satisfied is partially_resolved", () => {
    const evidence = evaluate({
      recommendation: proposalRecommendation({
        targetOutcomes: [
          outcome({ metric: "repositorySummary.crossModuleCycleCount" }),
          outcome({ metric: "repositorySummary.moduleCount", value: 3 })
        ]
      })
    });

    expect(evidence.disposition).toBe("partially_resolved");
    expect(evidence.observedOutcomes.filter((entry) => entry.satisfied)).toHaveLength(1);
    expect(refactorResolutionEvidenceInvariantIssues(evidence)).toEqual([]);
  });

  test("a reverse-direction move against the persisted baseline is regressed", () => {
    const evidence = evaluate({
      recommendation: proposalRecommendation({
        targetOutcomes: [outcome({ metric: "repositorySummary.crossModuleCycleCount" })],
        baselineSnapshotDigest: AFTER.snapshotDigest
      }),
      beforeSnapshotDigest: AFTER.snapshotDigest,
      beforeSnapshot: AFTER,
      afterSnapshot: BEFORE
    });

    expect(evidence.disposition).toBe("regressed");
    expect(evidence.observedOutcomes[0]!.direction).toBe("regressed");
    expect(refactorResolutionEvidenceInvariantIssues(evidence)).toEqual([]);
  });

  test("a baseline digest that does not bind the recorded baseline is stale", () => {
    const evidence = evaluate({ beforeSnapshotDigest: AFTER.snapshotDigest, beforeSnapshot: AFTER });

    expect(evidence.disposition).toBe("stale");
    expect(residualCodes(evidence)).toContain("baseline-digest-mismatch");
    expect(refactorResolutionEvidenceInvariantIssues(evidence)).toEqual([]);
  });

  test("an after-snapshot whose coverage is not complete is stale, never resolved", () => {
    const evidence = evaluate({ afterSnapshot: AFTER_PARTIAL, beforeSnapshot: BEFORE });

    expect(AFTER_PARTIAL.codeFacts.coverage).toBe("partial");
    expect(evidence.disposition).toBe("stale");
    expect(residualCodes(evidence)).toContain("after-coverage-incomplete");
    // The outcome itself is satisfied; only the ladder's second rung keeps it out of `resolved`.
    expect(evidence.observedOutcomes[0]!.satisfied).toBe(true);
    expect(refactorResolutionEvidenceInvariantIssues(evidence)).toEqual([]);
  });

  test("an index that does not cover the verified worktree is stale", () => {
    const evidence = evaluate({ afterSnapshot: AFTER_FOREIGN_INDEX, beforeSnapshot: BEFORE });

    expect(AFTER_FOREIGN_INDEX.codeFacts.indexedWorktreeDigest).not.toBe(AFTER_FOREIGN_INDEX.worktree.worktreeDigest);
    expect(evidence.disposition).toBe("stale");
    expect(residualCodes(evidence)).toContain("after-index-stale");
    expect(refactorResolutionEvidenceInvariantIssues(evidence)).toEqual([]);
  });

  test("a required kill-list path still tracked at HEAD is not resolved", () => {
    const evidence = evaluate({
      recommendation: proposalRecommendation({
        targetOutcomes: [outcome({ metric: "repositorySummary.crossModuleCycleCount" })],
        killList: [{ kind: "path", selectorId: "src/m/a/x.ts", required: true }]
      }),
      beforeSnapshot: BEFORE
    });
    const killOutcome = evidence.expectedOutcomes.find((entry) => entry.metric === "killList.path.present")!;

    expect(evidence.disposition).toBe("partially_resolved");
    expect(evidence.observedOutcomes.find((entry) => entry.outcomeId === killOutcome.outcomeId))
      .toMatchObject({ observedValue: 1, satisfied: false, direction: "unknown" });
    expect(refactorResolutionEvidenceInvariantIssues(evidence)).toEqual([]);
  });

  test("a kill-list relation removed from the declared model is satisfied", () => {
    const evidence = evaluate({
      recommendation: proposalRecommendation({
        targetOutcomes: [outcome({ metric: "repositorySummary.crossModuleCycleCount" })],
        killList: [{ kind: "relation", selectorId: "relation.already-removed", required: true }]
      }),
      beforeSnapshot: BEFORE
    });

    expect(evidence.disposition).toBe("resolved");
    expect(evidence.observedOutcomes.every((entry) => entry.satisfied)).toBe(true);
    expect(refactorResolutionEvidenceInvariantIssues(evidence)).toEqual([]);
  });

  test("a required symbol kill entry is undecidable, so the verdict is stale", () => {
    const evidence = evaluate({
      recommendation: proposalRecommendation({
        targetOutcomes: [outcome({ metric: "repositorySummary.crossModuleCycleCount" })],
        killList: [{ kind: "symbol", selectorId: "symbol.legacyWrapper", required: true }]
      }),
      beforeSnapshot: BEFORE
    });

    expect(evidence.disposition).toBe("stale");
    expect(evidence.residuals).toContainEqual({
      code: "kill-list-symbol-unverifiable",
      subject: "symbol.legacyWrapper",
      severity: "error"
    });
    expect(evidence.expectedOutcomes.some((entry) => entry.metric.startsWith("killList.symbol"))).toBe(false);
    expect(refactorResolutionEvidenceInvariantIssues(evidence)).toEqual([]);
  });

  test("a non-required symbol kill entry is a warning residual, not a stale verdict", () => {
    const evidence = evaluate({
      recommendation: proposalRecommendation({
        targetOutcomes: [outcome({ metric: "repositorySummary.crossModuleCycleCount" })],
        killList: [{ kind: "symbol", selectorId: "symbol.legacyWrapper", required: false }]
      }),
      beforeSnapshot: BEFORE
    });

    expect(evidence.disposition).toBe("resolved");
    expect(evidence.residuals).toContainEqual({
      code: "kill-list-symbol-unverifiable",
      subject: "symbol.legacyWrapper",
      severity: "warning"
    });
  });

  test("a record with no required outcome is not_improved with a residual, never resolved", () => {
    const evidence = evaluate({ recommendation: observationRecommendation([]) });

    expect(evidence.disposition).toBe("not_improved");
    expect(residualCodes(evidence)).toEqual(["no-required-outcome"]);
    expect(refactorResolutionEvidenceInvariantIssues(evidence)).toEqual([]);
  });

  test("a dissolved subject module observes null plus a residual rather than failing closed", () => {
    const evidence = evaluate({
      recommendation: observationRecommendation(
        deriveObservationOutcomes({ kind: "cycle", subjectSelectorId: "repository:repo.rf2", affectedNodeIds: ["component.dissolved"] })
      ),
      beforeSnapshot: BEFORE
    });

    expect(evidence.observedOutcomes[0]).toMatchObject({ observedValue: null, satisfied: true, direction: "unknown" });
    expect(evidence.residuals).toContainEqual({ code: "outcome-subject-absent", subject: "component.dissolved", severity: "warning" });
    expect(evidence.disposition).toBe("resolved");
    expect(refactorResolutionEvidenceInvariantIssues(evidence)).toEqual([]);
  });

  test("an outcome outside the vocabulary throws instead of measuring nothing", () => {
    expect(() => evaluate({
      recommendation: proposalRecommendation({ targetOutcomes: [outcome({ metric: "crossModuleCycleCount" })] })
    })).toThrow(/AC_SCHEMA_INVALID/);
  });

  test("a practice recommendation carries no measurable outcome and throws", () => {
    const practice = {
      ...proposalRecommendation({ targetOutcomes: [] }),
      category: "practice",
      practiceId: "practice.runtime-boundary",
      payload: { practiceId: "practice.runtime-boundary", baselineDigest: null }
    } as unknown as RecommendationV3;

    expect(() => evaluate({ recommendation: practice })).toThrow(/AC_SCHEMA_INVALID/);
  });
});

describe("evaluateResolution determinism", () => {
  test("the same inputs twice produce a byte-identical evidence record", () => {
    const first = evaluate({ beforeSnapshot: BEFORE });
    const second = evaluate({ beforeSnapshot: BEFORE });

    expect(second.resolutionDigest).toBe(first.resolutionDigest);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test("resolutionDigest ignores verifiedAt, so re-verifying at the same HEAD dedups", () => {
    const first = evaluate({ beforeSnapshot: BEFORE });
    const later = evaluate({ beforeSnapshot: BEFORE, verifiedAt: "2026-12-31T23:59:59.000Z" });

    expect(later.resolutionDigest).toBe(first.resolutionDigest);
    expect(later.verifiedAt).not.toBe(first.verifiedAt);
  });

  test("an execution evidence ref is copied field-explicitly, so an extra caller key never reaches the evidence", () => {
    const evidence = evaluate({
      beforeSnapshot: BEFORE,
      executionEvidenceRefs: [
        {
          kind: "merge_receipt",
          locator: "tasks/receipts/rf4.json",
          sha256: "c".repeat(64),
          rawDiff: "--- a/secrets.ts"
        } as never
      ]
    });

    expect(Object.keys(evidence.executionEvidenceRefs[0]!).sort()).toEqual(["kind", "locator", "sha256"]);
  });
});

/**
 * The full operator matrix against the four observation shapes the snapshot can produce. The
 * assertion that matters is not this table's `satisfied` column but that the frozen validator
 * agrees with it on every cell: `evaluateResolution` throws whenever it does not.
 */
describe("operator matrix round-trips the frozen validator", () => {
  const observedBy: Record<string, { metric: RefactorResolutionMetric; nodeId: string | null; expected: number | null }> = {
    null: { metric: "module.dependencyGraph.cycleCount", nodeId: "component.dissolved", expected: null },
    zero: { metric: "repositorySummary.unresolvedImportCount", nodeId: null, expected: 0 },
    equal: { metric: "repositorySummary.crossModuleCycleCount", nodeId: null, expected: 2 },
    above: { metric: "repositorySummary.moduleCount", nodeId: null, expected: 4 }
  };
  const truth: Record<RefactorOutcomeOperator, Record<string, boolean>> = {
    absent: { null: true, zero: true, equal: false, above: false },
    present: { null: false, zero: false, equal: true, above: true },
    equals: { null: false, zero: false, equal: true, above: false },
    greater_than: { null: false, zero: false, equal: false, above: true },
    less_than: { null: false, zero: true, equal: false, above: false }
  };

  for (const operator of REFACTOR_OUTCOME_OPERATORS) {
    for (const shape of Object.keys(observedBy)) {
      test(`${operator} against an observed ${shape} value`, () => {
        const subject = observedBy[shape]!;
        const valueless = operator === "absent" || operator === "present";
        const evidence = evaluate({
          recommendation: proposalRecommendation({
            targetOutcomes: [outcome({
              metric: subject.metric,
              nodeId: subject.nodeId,
              operator,
              value: valueless ? null : 2,
              required: false
            })]
          }),
          afterSnapshot: BEFORE
        });

        expect(evidence.observedOutcomes[0]!.observedValue).toBe(subject.expected as never);
        expect(evidence.observedOutcomes[0]!.satisfied).toBe(truth[operator]![shape]!);
        expect(refactorResolutionEvidenceInvariantIssues(evidence)).toEqual([]);
      });
    }
  }
});

describe("evaluateResolution direction", () => {
  test("stays unknown when the persisted baseline does not bind the recorded baseline digest", () => {
    const foreign: ModuleStatisticsSnapshotV1 = AFTER;
    const evidence = evaluate({ beforeSnapshot: foreign });

    expect(evidence.beforeSnapshotDigest).toBe(BEFORE.snapshotDigest);
    expect(evidence.observedOutcomes[0]!.direction).toBe("unknown");
    expect(evidence.disposition).toBe("resolved");
  });

  test("is unchanged when the measured value did not move", () => {
    const evidence = evaluate({ afterSnapshot: BEFORE, beforeSnapshot: BEFORE });
    expect(evidence.observedOutcomes[0]!.direction).toBe("unchanged");
  });
});
