import { describe, expect, test } from "bun:test";
import {
  RECOMMENDATION_V3_SCHEMA_VERSION,
  recommendationV3InvariantIssues,
  type ModuleStatisticsSnapshotV1,
  type RecommendationV3,
  type RefactorAssessmentV1,
  type RefactorProposalV1,
  type RefactorScale
} from "@archcontext/contracts";
import { assessRefactor, type RefactorAssessmentInputV1 } from "../../refactor-assessment/src/index";
import {
  CONTESTED_MODEL,
  CYCLE_EDGES,
  TRACKED_FILES,
  digestOf,
  makeAssessmentInput,
  makeProposal,
  makeRequest,
  makeSnapshot,
  makeTargetDelta
} from "../../refactor-assessment/test/factories";
import {
  REFACTOR_ACTIVE_RECOMMENDATION_STATUSES,
  planRefactorRecommendationRun,
  recommendationFingerprint,
  recommendationV3Fingerprint,
  refactorRecommendationRunLedgerPayload,
  type PlanRefactorRecommendationRunInput,
  type PreviousRecommendationV3
} from "../src/index";

const NOW = "2026-09-03T07:30:00.000Z";
const CATALOG_DIGEST = digestOf("refactor-classifier-ruleset");

function planFor(
  overrides: Partial<RefactorAssessmentInputV1> = {},
  planOverrides: Partial<PlanRefactorRecommendationRunInput> = {}
) {
  const assessmentInput = makeAssessmentInput(overrides);
  const result = assessRefactor(assessmentInput);
  return planWith(assessmentInput.snapshot, result.assessment, result.proposal, planOverrides);
}

function planWith(
  snapshot: ModuleStatisticsSnapshotV1,
  assessment: RefactorAssessmentV1,
  proposal: RefactorProposalV1 | undefined,
  planOverrides: Partial<PlanRefactorRecommendationRunInput> = {}
) {
  return planRefactorRecommendationRun({
    repository: snapshot.repository,
    worktree: snapshot.worktree,
    snapshot,
    assessment,
    ...(proposal ? { proposal } : {}),
    catalogDigest: CATALOG_DIGEST,
    now: NOW,
    ...planOverrides
  });
}

/** Every emitted record must be one the ledger can trust without re-validating it. */
function expectRecordsValid(records: readonly RecommendationV3[]): void {
  for (const record of records) {
    expect(recommendationV3InvariantIssues(record)).toEqual([]);
    expect(record.schemaVersion).toBe(RECOMMENDATION_V3_SCHEMA_VERSION);
    expect(record.subject).toBe(record.subjectSelectorId);
    expect(record.status).toBe("open");
    expect(record.runId).toMatch(/^recommendation_run\./);
  }
}

function proposalFor(scale: RefactorScale): { snapshot: ModuleStatisticsSnapshotV1; assessment: RefactorAssessmentV1; proposal?: RefactorProposalV1 } {
  const overrides: Record<RefactorScale, Partial<RefactorAssessmentInputV1>> = {
    module: { request: makeRequest({ proposal: makeProposal({ scopePaths: ["src/m/a/x.ts"] }) }) },
    cross_module: { request: makeRequest({ proposal: makeProposal({ scopePaths: ["src/m/a/x.ts", "src/m/b/y.ts"] }) }) },
    architecture: {
      request: makeRequest({
        proposal: makeProposal({
          scopePaths: ["src/m/a/x.ts"],
          targetDelta: makeTargetDelta({
            targetState: { owners: { primaryLifecycle: "module.c" }, requiredRelations: [], removedConcepts: ["relation.a-to-b"] }
          })
        })
      })
    },
    insufficient_evidence: {
      snapshot: makeSnapshot({ model: CONTESTED_MODEL }),
      model: CONTESTED_MODEL,
      request: makeRequest({ proposal: makeProposal({ scopePaths: ["src/m/a/x.ts"] }) })
    },
    model_adoption_required: { request: makeRequest({ proposal: makeProposal({ scopePaths: ["src/m/a/x.ts", "tools/gen.ts"] }) }) }
  };
  const assessmentInput = makeAssessmentInput(overrides[scale]);
  const result = assessRefactor(assessmentInput);
  expect(result.assessment.scale).toBe(scale);
  return { snapshot: assessmentInput.snapshot, assessment: result.assessment, proposal: result.proposal };
}

describe("planRefactorRecommendationRun observations", () => {
  test("S7 records every observation as an advisory daemon-authored structural_observation", () => {
    const plan = planFor({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) });

    expect(plan.recommendations.length).toBe(plan.run.metrics.matchCount);
    expect(plan.recommendations.length).toBeGreaterThan(1);
    expect(plan.recommendations.map((record) => record.category)).toEqual(
      plan.recommendations.map(() => "structural_observation")
    );
    for (const record of plan.recommendations) {
      expect(record.enforcement).toBe("advisory");
      expect(record.authoredBy).toEqual({ kind: "daemon", id: "archctxd", source: "daemon" });
      expect(record.relations).toEqual({});
      expect(record.evidenceBindingIds).toHaveLength(1);
    }
    expect(plan.evidenceItems).toHaveLength(1);
    expectRecordsValid(plan.recommendations);
  });

  test("a cycle observation names its component members and one derived outcome", () => {
    const plan = planFor({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) });
    const cycle = plan.recommendations.find((record) => record.category === "structural_observation" && record.payload.kind === "cycle");

    expect(cycle).toBeDefined();
    const payload = cycle!.payload as { affectedNodeIds: string[]; derivedOutcomes: unknown[]; baselineSnapshotDigest: string };
    expect(payload.affectedNodeIds).toEqual(["component.a", "module.c"]);
    // RF4 owns the kind-to-outcome derivation; RF3 records the fact and its baseline, not the
    // acceptance test for it.
    expect(payload.derivedOutcomes).toEqual([]);
    expect(cycle!.risk).toBe("high");
  });

  test("the run trigger, catalogDigest and ledger payload are refactor_scan shaped", () => {
    const plan = planFor();

    expect(plan.run.trigger).toEqual({ level: "L2", source: "refactor_scan" });
    expect(plan.run.catalogDigest).toBe(CATALOG_DIGEST);
    expect(plan.run.policyMode).toBe("advisory");
    expect(plan.run.status).toBe("succeeded");
    expect(plan.run.recommendationIds).toEqual(plan.recommendations.map((record) => record.recommendationId));
    const payload = refactorRecommendationRunLedgerPayload(plan);
    expect(payload.recommendationRuns).toEqual([plan.run as never]);
    expect(payload.feedback).toEqual([]);
  });

  test("every run persists the baseline snapshot and binds each record to it", () => {
    const plan = planFor({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) });
    const baseline = plan.evidenceItems.find((item) => item.kind === "module-statistics-snapshot");

    expect(baseline).toBeDefined();
    const firstPayload = plan.recommendations[0]!.payload as { baselineSnapshotDigest: string };
    expect(baseline!.selector).toEqual({ kind: "snapshot", id: firstPayload.baselineSnapshotDigest });
    expect(baseline!.strength).toBe("observed");
    expect(baseline!.origin).toBe("runtime-daemon");
    expect(baseline!.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    // RF4 re-measures against this body to decide direction and regression.
    expect((baseline!.extensions?.moduleStatisticsSnapshot as { snapshotDigest: string }).snapshotDigest)
      .toBe(baseline!.selector.id);

    expect(plan.evidenceBindings).toHaveLength(plan.recommendations.length);
    for (const record of plan.recommendations) {
      const binding = plan.evidenceBindings.find((entry) => entry.target.id === record.recommendationId);
      expect(binding).toBeDefined();
      expect(binding!.target.kind).toBe("recommendation");
      expect(binding!.evidenceId).toBe(baseline!.evidenceId);
      expect(record.evidenceBindingIds).toEqual([binding!.bindingId]);
    }
    expect(plan.run.metrics.evidenceBindingCount).toBe(plan.evidenceBindings.length);
    expect(plan.run.metrics.unboundEvidenceCount).toBe(0);
  });

  test("the baseline evidence item is bound to the snapshot, not to the clock", () => {
    const left = planFor({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) });
    const right = planFor({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) }, { now: "2026-12-01T00:00:00.000Z" });

    expect(right.evidenceItems[0]).toEqual(left.evidenceItems[0]!);
  });
});

describe("planRefactorRecommendationRun proposals", () => {
  test("enforcement follows scale across all five classifications", () => {
    const expected: Record<RefactorScale, "complete" | "checkpoint" | undefined> = {
      architecture: "complete",
      cross_module: "checkpoint",
      module: "checkpoint",
      insufficient_evidence: "checkpoint",
      model_adoption_required: undefined
    };
    for (const [scale, enforcement] of Object.entries(expected) as [RefactorScale, "complete" | "checkpoint" | undefined][]) {
      const { snapshot, assessment, proposal } = proposalFor(scale);
      const plan = planWith(snapshot, assessment, proposal);
      const record = plan.recommendations.find((entry) => entry.category === "refactor_proposal");
      if (enforcement === undefined) {
        expect(record).toBeUndefined();
        continue;
      }
      expect(record).toBeDefined();
      expect(record!.enforcement).toBe(enforcement);
      expect(record!.authoredBy).toEqual(proposal!.authoredBy);
      expect((record!.payload as { scale: RefactorScale }).scale).toBe(scale);
      expectRecordsValid(plan.recommendations);
    }
  });

  test("insufficient_evidence still records the proposal, so RF4 can refuse to resolve it", () => {
    const { snapshot, assessment, proposal } = proposalFor("insufficient_evidence");
    const plan = planWith(snapshot, assessment, proposal);
    const record = plan.recommendations.find((entry) => entry.category === "refactor_proposal");

    expect(record).toBeDefined();
    expect(record!.uncertainty).toBe("high");
    expect(plan.evidenceItems.map((item) => item.kind)).toEqual(["module-statistics-snapshot"]);
  });

  test("model_adoption_required records one evidence item and zero proposal records", () => {
    const { snapshot, assessment, proposal } = proposalFor("model_adoption_required");
    const plan = planWith(snapshot, assessment, proposal);

    expect(plan.recommendations.some((record) => record.category === "refactor_proposal")).toBe(false);
    expect(plan.evidenceItems).toHaveLength(2);
    const adoption = plan.evidenceItems.find((item) => item.kind === "refactor-model-adoption-required");
    expect(adoption).toMatchObject({
      polarity: "absence",
      origin: "runtime-daemon",
      supports: ["recommendation"]
    });
    expect(adoption!.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.run.extensions?.evidenceItemIds).toEqual(plan.evidenceItems.map((item) => item.evidenceId));
    // The adoption gap is evidence, not a recommendation, so nothing binds to it.
    expect(plan.evidenceBindings.some((binding) => binding.evidenceId === adoption!.evidenceId)).toBe(false);
    expect(plan.run.metrics.unboundEvidenceCount).toBe(1);
  });

  test("a daemon-authored proposal is rejected instead of recorded", () => {
    const { snapshot, assessment, proposal } = proposalFor("module");
    const selfAuthored = { ...proposal!, authoredBy: { kind: "daemon" as const, id: "archctxd", source: "daemon" as const } };

    expect(() => planWith(snapshot, assessment, selfAuthored)).toThrow("AC_SCHEMA_INVALID");
  });
});

describe("dedup, cooldown and regression", () => {
  test("an active prior fingerprint suppresses instead of duplicating", () => {
    const first = planFor();
    const record = first.recommendations[0]!;
    const previous: PreviousRecommendationV3[] = [{
      recommendationId: record.recommendationId,
      fingerprint: record.fingerprint,
      status: "accepted",
      updatedAt: "2026-09-03T07:31:00.000Z"
    }];

    expect(REFACTOR_ACTIVE_RECOMMENDATION_STATUSES.has("accepted")).toBe(true);
    const second = planFor({}, { previousRecommendations: previous });
    expect(second.recommendations.map((entry) => entry.recommendationId)).not.toContain(record.recommendationId);
    expect(second.suppressed).toContainEqual({
      reasonCode: "duplicate-active-fingerprint",
      fingerprint: record.fingerprint,
      subject: record.subjectSelectorId,
      previousRecommendationId: record.recommendationId
    });
  });

  test("an active cooldown suppresses the same subject", () => {
    const first = planFor();
    const record = first.recommendations[0]!;
    const second = planFor({}, {
      cooldowns: [{ subject: record.subjectSelectorId, lastRecommendedAt: "2026-09-03T07:00:00.000Z" }]
    });

    expect(second.recommendations).toEqual([]);
    expect(second.suppressed[0]).toMatchObject({ reasonCode: "cooldown-active", fingerprint: record.fingerprint });
  });

  test("a resolved prior yields a new record with regressesFrom and a distinct id", () => {
    const first = planFor();
    const record = first.recommendations[0]!;
    const second = planFor({}, {
      previousRecommendations: [{
        recommendationId: record.recommendationId,
        fingerprint: record.fingerprint,
        status: "resolved",
        updatedAt: "2026-09-03T07:31:00.000Z"
      }]
    });
    const regressed = second.recommendations.find((entry) => entry.fingerprint === record.fingerprint);

    expect(regressed).toBeDefined();
    expect(regressed!.relations).toEqual({ regressesFrom: record.recommendationId });
    // The resolved record is never overwritten: a colliding id would INSERT OR REPLACE it away.
    expect(regressed!.recommendationId).not.toBe(record.recommendationId);
    expect(second.suppressed).toEqual([]);
    expectRecordsValid(second.recommendations);
  });

  test("a rejected prior yields a new record with no relation", () => {
    const first = planFor();
    const record = first.recommendations[0]!;
    const second = planFor({}, {
      previousRecommendations: [{
        recommendationId: record.recommendationId,
        fingerprint: record.fingerprint,
        status: "rejected",
        updatedAt: "2026-09-03T07:31:00.000Z"
      }]
    });
    const reopened = second.recommendations.find((entry) => entry.fingerprint === record.fingerprint);

    expect(reopened!.relations).toEqual({});
    expect(reopened!.recommendationId).toBe(record.recommendationId);
  });
});

describe("determinism and fingerprints", () => {
  test("the same input twice yields identical run digests and ids", () => {
    const left = planFor({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) });
    const right = planFor({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) });

    expect(right.inputDigest).toBe(left.inputDigest);
    expect(right.outputDigest).toBe(left.outputDigest);
    expect(right.run.runId).toBe(left.run.runId);
    expect(right.recommendations.map((entry) => entry.recommendationId))
      .toEqual(left.recommendations.map((entry) => entry.recommendationId));
  });

  test("the practice fingerprint delegates to the frozen v1 hasher", () => {
    const baselineDigest = digestOf("practice-baseline");
    const practice = recommendationV3Fingerprint({
      category: "practice",
      subject: "module.runtime-ledger",
      subjectSelectorId: "subject.node.deadbeefdeadbeef",
      practiceId: "practice.runtime-boundary",
      payload: { practiceId: "practice.runtime-boundary", baselineDigest },
      evidenceBindingIds: ["binding.b", "binding.a"]
    });

    expect(practice).toBe(recommendationFingerprint({
      practiceId: "practice.runtime-boundary",
      subject: "module.runtime-ledger",
      evidenceBindingIds: ["binding.b", "binding.a"],
      baselineDigest
    }));
  });

  test("re-measuring the same fact at a new snapshot keeps the fingerprint but moves the baseline", () => {
    const left = planFor();
    const right = planFor({
      snapshot: makeSnapshot({ trackedFiles: TRACKED_FILES.map((file) => ({ ...file, lineCount: file.lineCount + 1 })) })
    });

    expect(right.recommendations[0]!.payload).not.toEqual(left.recommendations[0]!.payload);
    expect(right.recommendations.map((entry) => entry.fingerprint))
      .toEqual(left.recommendations.map((entry) => entry.fingerprint));
  });
});
