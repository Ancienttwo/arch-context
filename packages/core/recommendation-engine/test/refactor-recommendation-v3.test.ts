import { describe, expect, test } from "bun:test";
import {
  RECOMMENDATION_V3_SCHEMA_VERSION,
  REFACTOR_EVIDENCE_ID_LIST_LIMIT,
  REFACTOR_OBSERVATION_EVIDENCE_LIMIT,
  recommendationV3InvariantIssues,
  refactorAssessmentDigest,
  type ModuleStatisticsSnapshotV1,
  type RecommendationV3,
  type RefactorAssessmentV1,
  type RefactorObservationEvidenceV1,
  type RefactorObservationKind,
  type RefactorObservationV1,
  type RefactorProposalV1,
  type RefactorScale
} from "@archcontext/contracts";
import { assessRefactor, type RefactorAssessmentInputV1 } from "@archcontext/core/refactor-assessment";
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
import { publishedSchemaIssues } from "../../../contracts/test/published-schemas";
import {
  REFACTOR_ACTIVE_RECOMMENDATION_STATUSES,
  REFACTOR_DECIDED_RECOMMENDATION_STATUSES,
  planRefactorRecommendationRun,
  recommendationFingerprint,
  recommendationV3Fingerprint,
  refactorRecommendationRunLedgerPayload,
  type PlanRefactorRecommendationRunInput,
  type PreviousRecommendationV3
} from "../src/index";
import { architectureSubjectSelectorId } from "@archcontext/core/architecture-delta";

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

/** The planner's view of a ledger record, as the daemon builds it. */
function priorOf(
  record: RecommendationV3,
  status: PreviousRecommendationV3["status"],
  updatedAt = "2026-09-03T07:31:00.000Z"
): PreviousRecommendationV3 {
  return {
    recommendationId: record.recommendationId,
    fingerprint: record.fingerprint,
    status,
    updatedAt,
    observationMetrics: record.category === "structural_observation" ? { ...record.payload.metrics } : null
  };
}

/** A contract-valid observation of `kind` with exactly `metrics`, its evidence sample left empty. */
function observationOf(snapshot: ModuleStatisticsSnapshotV1, kind: RefactorObservationKind, metrics: Record<string, number>, subject?: string): RefactorObservationV1 {
  const count = (value: number | undefined) => ({ totalCount: value ?? 0, truncated: (value ?? 0) > 0 });
  const moduleId = snapshot.modules[0]!.nodeId;
  const repository = `repository:${snapshot.repository.repositoryId}`;
  const shapes: Record<RefactorObservationKind, { subjectSelectorId: string; evidence: RefactorObservationEvidenceV1 }> = {
    cycle: {
      subjectSelectorId: "scc:fixture",
      evidence: {
        kind: "cycle",
        memberNodeIds: Array.from({ length: Math.min(metrics.memberCount ?? 0, REFACTOR_EVIDENCE_ID_LIST_LIMIT) }, (_, index) => `module.member-${String(index).padStart(3, "0")}`),
        edges: [],
        ...count(metrics.cycleEdgeCount)
      }
    },
    "direction-violation": {
      subjectSelectorId: moduleId,
      evidence: { kind: "direction-violation", constraintIds: ["constraint.fixture"], constraintCount: 1, violations: [], ...count(metrics.directionViolationCount) }
    },
    "ownership-ambiguous": { subjectSelectorId: moduleId, evidence: { kind: "ownership-ambiguous", paths: [], ...count(3) } },
    "undeclared-footprint": { subjectSelectorId: moduleId, evidence: { kind: "undeclared-footprint", paths: [], ...count(0) } },
    "unowned-paths": { subjectSelectorId: repository, evidence: { kind: "unowned-paths", paths: [], ...count(metrics.unownedFileCount) } },
    "evidence-gap": {
      subjectSelectorId: repository,
      evidence: { kind: "evidence-gap", coverage: "partial", reasonCodes: [], unresolvedImports: [], ...count(metrics.unresolvedImportCount) }
    }
  };
  const shape = shapes[kind];
  return { kind, subjectSelectorId: subject ?? shape.subjectSelectorId, signalIds: [`signal.${kind}.fixture`], metrics, evidence: shape.evidence };
}

/** The default fixture's assessment with its observations replaced, re-digested. */
function assessmentWith(observations: RefactorObservationV1[]): { snapshot: ModuleStatisticsSnapshotV1; assessment: RefactorAssessmentV1 } {
  const input = makeAssessmentInput();
  const base = assessRefactor(input).assessment;
  const draft: RefactorAssessmentV1 = { ...base, observations, assessmentDigest: "" };
  return { snapshot: input.snapshot, assessment: { ...draft, assessmentDigest: refactorAssessmentDigest(draft) } };
}

/** Every emitted record must be one the ledger can trust without re-validating it. */
function expectRecordsValid(records: readonly RecommendationV3[]): void {
  for (const record of records) {
    expect(recommendationV3InvariantIssues(record)).toEqual([]);
    expect(record.schemaVersion).toBe(RECOMMENDATION_V3_SCHEMA_VERSION);
    // Canonical selector identity, produced by architectureSubjectSelectorId.
    expect(record.subjectSelectorId).toMatch(/^subject\.(node|repository)\.[a-f0-9]{16}$/);
    expect(record.subject.trim()).not.toBe("");
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

  test("each observation payload is self-contained: metrics, signals and evidence ride with it", () => {
    const input = makeAssessmentInput({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES.map((edge, index) => ({ ...edge, line: index + 3 })) }) });
    const assessment = assessRefactor(input).assessment;
    const plan = planWith(input.snapshot, assessment, undefined);
    for (const record of plan.recommendations) {
      if (record.category !== "structural_observation") continue;
      const observation = assessment.observations.find((entry) => entry.kind === record.payload.kind && entry.subjectSelectorId === record.subject);
      expect(observation).toBeDefined();
      expect(record.payload.metrics).toEqual(observation!.metrics);
      expect(record.payload.signalIds).toEqual(observation!.signalIds);
      expect(record.payload.evidence).toEqual(observation!.evidence);
    }
    expectRecordsValid(plan.recommendations);
  });

  test("the explanation is built from the observation's own evidence", () => {
    const plan = planFor({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES.map((edge, index) => ({ ...edge, line: index + 3 })) }) });
    const byKind = (kind: string) => plan.recommendations.find((record) => record.category === "structural_observation" && record.payload.kind === kind)!;
    expect(byKind("cycle").explanation).toEqual([
      "Import cycle between 2 modules (component.a, module.c): 2 file-level import edge(s) keep them mutually dependent.",
      "src/c/z.ts:4 → src/m/a/x.ts via ../m/a/x (module.c → component.a).",
      "src/m/a/x.ts:3 → src/c/z.ts via ../../c/z (component.a → module.c)."
    ]);
    expect(byKind("unowned-paths").explanation).toEqual([
      "1 tracked file(s) under a declared source root are owned by no declared node.",
      "src/gen.ts (no node owns a file in its directory)."
    ]);
  });

  test("evidence is not identity: a relocated import keeps the recommendation id", () => {
    const unlocated = planFor({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) });
    const located = planFor({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES.map((edge) => ({ ...edge, line: 9 })) }) });
    expect(located.recommendations.map((record) => record.recommendationId)).toEqual(
      unlocated.recommendations.map((record) => record.recommendationId)
    );
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
      // Derived from the same measurement as the item it binds: its input digest, never its id.
      expect(binding!.provenance.inputDigest).toBe(baseline!.provenance.inputDigest);
      expect(binding!.provenance.inputDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(publishedSchemaIssues("runtime/evidence-binding.schema.json", binding)).toEqual([]);
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
    const previous: PreviousRecommendationV3[] = [priorOf(record, "accepted")];

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
    const second = planFor({}, { previousRecommendations: [priorOf(record, "resolved")] });
    const regressed = second.recommendations.find((entry) => entry.fingerprint === record.fingerprint);

    expect(regressed).toBeDefined();
    expect(regressed!.relations).toEqual({ regressesFrom: record.recommendationId });
    // The resolved record is never overwritten: a colliding id would INSERT OR REPLACE it away.
    expect(regressed!.recommendationId).not.toBe(record.recommendationId);
    expect(second.suppressed).toEqual([]);
    expectRecordsValid(second.recommendations);
  });

  test("an equal updatedAt on one id resolves to the later ledger entry", () => {
    const first = planFor();
    const record = first.recommendations[0]!;
    const at = "2026-09-03T07:31:00.000Z";
    // A record and its resolution appended under one clock: the resolution is the later entry.
    const resolvedLast = planFor({}, {
      previousRecommendations: [priorOf(record, "open", at), priorOf(record, "resolved", at)]
    });
    expect(resolvedLast.suppressed.map((entry) => entry.fingerprint)).not.toContain(record.fingerprint);
    expect(resolvedLast.recommendations.find((entry) => entry.fingerprint === record.fingerprint)!.relations)
      .toEqual({ regressesFrom: record.recommendationId });

    const openLast = planFor({}, {
      previousRecommendations: [priorOf(record, "resolved", at), priorOf(record, "open", at)]
    });
    expect(openLast.suppressed).toContainEqual({
      reasonCode: "duplicate-active-fingerprint",
      fingerprint: record.fingerprint,
      subject: record.subjectSelectorId,
      previousRecommendationId: record.recommendationId
    });
  });

  for (const status of ["rejected", "waived"] as const) {
    test(`a ${status} prior with an unchanged measured fact stays suppressed`, () => {
      const first = planFor();
      const record = first.recommendations[0]!;
      expect(REFACTOR_DECIDED_RECOMMENDATION_STATUSES.has(status)).toBe(true);
      const second = planFor({}, { previousRecommendations: [priorOf(record, status)] });

      expect(second.recommendations.map((entry) => entry.fingerprint)).not.toContain(record.fingerprint);
      // Never `open` again under the decided id.
      expect(second.recommendations.map((entry) => entry.recommendationId)).not.toContain(record.recommendationId);
      expect(second.suppressed).toContainEqual({
        reasonCode: "decided-fingerprint",
        fingerprint: record.fingerprint,
        subject: record.subjectSelectorId,
        previousRecommendationId: record.recommendationId
      });
    });

  }

  /**
   * One row per observation kind: the measurement the decision was taken against, the
   * re-measurements that are worse on a severity metric, and the ones that are not.
   */
  const SEVERITY_CASES: { kind: RefactorObservationKind; decided: Record<string, number>; worse: Record<string, number>[]; notWorse: Record<string, number>[] }[] = [
    {
      kind: "cycle",
      decided: { memberCount: 2, cycleEdgeCount: 3 },
      worse: [{ memberCount: 3, cycleEdgeCount: 3 }, { memberCount: 2, cycleEdgeCount: 4 }],
      notWorse: [{ memberCount: 2, cycleEdgeCount: 3 }, { memberCount: 2, cycleEdgeCount: 2 }]
    },
    {
      kind: "direction-violation",
      decided: { directionViolationCount: 2 },
      worse: [{ directionViolationCount: 3 }],
      notWorse: [{ directionViolationCount: 2 }, { directionViolationCount: 1 }]
    },
    {
      kind: "unowned-paths",
      decided: { unownedFileCount: 4 },
      worse: [{ unownedFileCount: 5 }],
      notWorse: [{ unownedFileCount: 4 }, { unownedFileCount: 1 }]
    },
    // `ownedFileCount` measures module size, not ambiguity: no change of it reopens.
    {
      kind: "ownership-ambiguous",
      decided: { ownedFileCount: 10 },
      worse: [],
      notWorse: [{ ownedFileCount: 10 }, { ownedFileCount: 50 }, { ownedFileCount: 1 }]
    },
    // A gap in the code facts, not a finding: neither more unresolved imports nor a new edge limit reopens.
    {
      kind: "evidence-gap",
      decided: { unresolvedImportCount: 2, edgeLimit: 5000 },
      worse: [],
      notWorse: [{ unresolvedImportCount: 2, edgeLimit: 5000 }, { unresolvedImportCount: 9, edgeLimit: 5000 }, { unresolvedImportCount: 2, edgeLimit: 10000 }]
    },
    { kind: "undeclared-footprint", decided: {}, worse: [], notWorse: [{}] }
  ];

  for (const { kind, decided, worse, notWorse } of SEVERITY_CASES) {
    test(`a decided ${kind} reopens with regressesFrom only when a severity metric got worse`, () => {
      const before = assessmentWith([observationOf(makeAssessmentInput().snapshot, kind, decided)]);
      const record = planWith(before.snapshot, before.assessment, undefined).recommendations[0]!;
      for (const status of ["rejected", "waived"] as const) {
        const prior = priorOf(record, status);
        for (const metrics of worse) {
          const after = assessmentWith([observationOf(before.snapshot, kind, metrics)]);
          const plan = planWith(after.snapshot, after.assessment, undefined, { previousRecommendations: [prior] });
          expect(plan.recommendations, `${status} ${JSON.stringify(metrics)}`).toHaveLength(1);
          const reopened = plan.recommendations[0]!;
          expect(reopened.fingerprint).toBe(record.fingerprint);
          expect(reopened.relations).toEqual({ regressesFrom: record.recommendationId });
          expect(reopened.recommendationId).not.toBe(record.recommendationId);
          expectRecordsValid(plan.recommendations);
        }
        for (const metrics of notWorse) {
          const after = assessmentWith([observationOf(before.snapshot, kind, metrics)]);
          const plan = planWith(after.snapshot, after.assessment, undefined, { previousRecommendations: [prior] });
          expect(plan.recommendations, `${status} ${JSON.stringify(metrics)}`).toEqual([]);
          expect(plan.suppressed).toEqual([expect.objectContaining({ reasonCode: "decided-fingerprint", previousRecommendationId: record.recommendationId })]);
        }
      }
    });
  }

  test("a decided record that does not carry a severity metric never reopens", () => {
    const before = assessmentWith([observationOf(makeAssessmentInput().snapshot, "direction-violation", { directionViolationCount: 2 })]);
    const record = planWith(before.snapshot, before.assessment, undefined).recommendations[0]!;
    const after = assessmentWith([observationOf(before.snapshot, "direction-violation", { directionViolationCount: 9 })]);
    for (const observationMetrics of [null, {}, { directionViolationCount: null }] as PreviousRecommendationV3["observationMetrics"][]) {
      const prior = { ...priorOf(record, "rejected"), observationMetrics };
      const plan = planWith(after.snapshot, after.assessment, undefined, { previousRecommendations: [prior] });
      expect(plan.recommendations, JSON.stringify(observationMetrics)).toEqual([]);
      expect(plan.suppressed[0]).toMatchObject({ reasonCode: "decided-fingerprint" });
    }
  });

  test("a decided refactor proposal never reopens: every material field is in its fingerprint", () => {
    const { snapshot, assessment, proposal } = proposalFor("module");
    const first = planWith(snapshot, assessment, proposal);
    const record = first.recommendations.find((entry) => entry.category === "refactor_proposal")!;
    const prior = priorOf(record, "rejected");
    expect(prior.observationMetrics).toBeNull();

    const second = planWith(snapshot, assessment, proposal, { previousRecommendations: [prior] });
    expect(second.recommendations.map((entry) => entry.fingerprint)).not.toContain(record.fingerprint);
    expect(second.suppressed).toContainEqual(expect.objectContaining({ reasonCode: "decided-fingerprint", fingerprint: record.fingerprint }));
  });
});

describe("scheduler policy", () => {
  test("decided fingerprints do not take cap slots from a lower-scoring new candidate", () => {
    const snapshot = makeAssessmentInput().snapshot;
    const cycles = Array.from({ length: 26 }, (_, index) =>
      observationOf(snapshot, "cycle", { memberCount: 2, cycleEdgeCount: 2 }, `scc:fixture-${String(index).padStart(2, "0")}`));
    const unowned = observationOf(snapshot, "unowned-paths", { unownedFileCount: 1 });
    const { assessment } = assessmentWith([...cycles, unowned]);
    const all = planWith(snapshot, assessment, undefined, { schedulerPolicy: { budgets: { maxRecommendationsPerRun: 100 } } });
    const cycleRecords = all.recommendations.filter((record) => record.category === "structural_observation" && record.payload.kind === "cycle");
    const newcomer = all.recommendations.find((record) => record.category === "structural_observation" && record.payload.kind === "unowned-paths")!;
    expect(cycleRecords).toHaveLength(26);
    for (const record of cycleRecords) expect(record.extensions!.score as number).toBeGreaterThan(newcomer.extensions!.score as number);

    const plan = planWith(snapshot, assessment, undefined, {
      previousRecommendations: cycleRecords.map((record, index) => priorOf(record, index % 2 === 0 ? "rejected" : "waived"))
    });
    expect(plan.recommendations.map((record) => record.fingerprint)).toEqual([newcomer.fingerprint]);
    expect(plan.suppressed.filter((entry) => entry.reasonCode === "decided-fingerprint")).toHaveLength(26);
    // Only the cap omits, and nothing was left for it to cut.
    expect(plan.candidateBudget).toEqual({ maxRecommendationsPerRun: 25, candidateCount: 27, omittedCandidateCount: 0 });
  });

  test("a disabled scheduler records the run and emits nothing", () => {
    const plan = planFor({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) }, {
      schedulerPolicy: { enabled: false }
    });

    expect(plan.recommendations).toEqual([]);
    expect(plan.evidenceBindings).toEqual([]);
    expect(plan.run.status).toBe("succeeded");
    expect(plan.run.metrics.matchCount).toBeGreaterThan(0);
    expect(plan.run.extensions?.schedulerBudget).toMatchObject({
      enabled: false,
      selectedCandidateCount: 0,
      omittedCandidateCount: plan.run.metrics.matchCount
    } as never);
  });

  test("maxRecommendationsPerRun truncates deterministically by score then selector then fingerprint", () => {
    const full = planFor({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) });
    expect(full.recommendations.length).toBeGreaterThan(1);
    const ranked = [...full.recommendations].sort((left, right) =>
      (right.extensions!.score as number) - (left.extensions!.score as number)
      || left.subjectSelectorId.localeCompare(right.subjectSelectorId)
      || left.fingerprint.localeCompare(right.fingerprint)
    );

    const capped = planFor({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) }, {
      schedulerPolicy: { budgets: { maxRecommendationsPerRun: 1 } }
    });

    expect(capped.recommendations).toHaveLength(1);
    expect(capped.recommendations[0]!.fingerprint).toBe(ranked[0]!.fingerprint);
    expect(capped.run.extensions?.schedulerBudget).toMatchObject({
      maxRecommendationsPerRun: 1,
      selectedCandidateCount: 1,
      omittedCandidateCount: full.recommendations.length - 1
    } as never);
    // The same cut, typed on the plan so a scan can report it without reading run extensions.
    expect(capped.candidateBudget).toEqual({
      maxRecommendationsPerRun: 1,
      candidateCount: full.recommendations.length,
      omittedCandidateCount: full.recommendations.length - 1
    });
    expect(full.candidateBudget.omittedCandidateCount).toBe(0);
    expect(full.evidenceSampleLimit).toBe(REFACTOR_OBSERVATION_EVIDENCE_LIMIT);
    const repeat = planFor({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) }, {
      schedulerPolicy: { budgets: { maxRecommendationsPerRun: 1 } }
    });
    expect(repeat.recommendations[0]!.recommendationId).toBe(capped.recommendations[0]!.recommendationId);
  });

  test("policyMode comes from the scheduler policy unless the caller overrides it", () => {
    const fromPolicy = planFor({}, { schedulerPolicy: { policyMode: "checkpoint" } });
    const overridden = planFor({}, { schedulerPolicy: { policyMode: "checkpoint" }, policyMode: "complete" });

    expect(fromPolicy.run.policyMode).toBe("checkpoint");
    expect(overridden.run.policyMode).toBe("complete");
    expect(planFor().run.policyMode).toBe("advisory");
  });
});

describe("canonical subject selectors", () => {
  test("node, repository and strongly connected component subjects all resolve canonically", () => {
    const plan = planFor({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) });
    const repositoryId = makeSnapshot().repository.repositoryId;
    const bySubject = new Map(plan.recommendations.map((record) => [record.subject, record]));

    // A proposal addresses a node *set*, so its stableKey is `nodes:<sorted>|...` even when the
    // set holds one node; an observation on that same node uses `node:<id>`. Both go through
    // architectureSubjectSelectorId, so the two ids differ by stableKey, never by derivation.
    const { snapshot, assessment, proposal } = proposalFor("module");
    const node = planWith(snapshot, assessment, proposal).recommendations
      .find((record) => record.category === "refactor_proposal")!;
    expect(node.subject).toBe("component.a");
    expect(node.subjectSelectorId).toBe(architectureSubjectSelectorId("node", repositoryId, "nodes:component.a"));

    const observedNode = planWith(snapshot, assessment, proposal).recommendations
      .find((record) => record.category === "structural_observation" && record.subject === "component.a");
    if (observedNode) {
      expect(observedNode.subjectSelectorId)
        .toBe(architectureSubjectSelectorId("node", repositoryId, "node:component.a"));
    }

    const repository = bySubject.get(`repository:${repositoryId}`);
    expect(repository).toBeDefined();
    expect(repository!.subjectSelectorId).toBe(architectureSubjectSelectorId("repository", repositoryId, "repository"));

    const scc = [...bySubject.entries()].find(([subject]) => subject.startsWith("scc:"));
    expect(scc).toBeDefined();
    // No `scc` arm exists in ArchitectureSubjectSelectorKind: a component is a repository-level
    // fact, so it is addressed as a repository selector whose stableKey carries the component id.
    expect(scc![1].subjectSelectorId).toBe(architectureSubjectSelectorId("repository", repositoryId, scc![0]));
  });
});

describe("determinism and fingerprints", () => {
  test("the same input twice yields identical run digests and ids", () => {
    const left = planFor({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) });
    const right = planFor({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) });

    expect(right.inputDigest).toBe(left.inputDigest);
    expect(planFor({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }) }, { now: "2026-09-04T00:00:00.000Z" }).run.runId)
      .not.toBe(left.run.runId);
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
