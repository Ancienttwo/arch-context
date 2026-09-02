import { describe, expect, test } from "bun:test";
import {
  ERROR_CATALOG,
  type ArchContextErrorCode
} from "../src/schema";
import {
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATION_V3_SCHEMA_VERSION,
  type RecommendationV2,
  type RecommendationV3,
  type RecommendationV3Base,
  type RecommendationV3CategoryPayloadV1,
  type RefactorProposalPayloadV1
} from "../src/ledger";
import {
  MODULE_DYNAMIC_INVOCATION_LEVELS,
  MODULE_STATISTICS_SCHEMA_VERSION,
  MODULE_TESTS_COVERAGE_STATUSES,
  REFACTOR_ASSESSMENT_SCHEMA_VERSION,
  REFACTOR_EXECUTION_EVIDENCE_KINDS,
  REFACTOR_KILL_LIST_KINDS,
  REFACTOR_OBSERVATION_KINDS,
  REFACTOR_OUTCOME_DIRECTIONS,
  REFACTOR_OUTCOME_OPERATORS,
  REFACTOR_PROPOSAL_AUTHOR_PAIRS,
  REFACTOR_PROPOSAL_AUTHOR_SOURCES,
  REFACTOR_PROPOSAL_SCHEMA_VERSION,
  REFACTOR_REQUEST_SCHEMA_VERSION,
  REFACTOR_RESOLUTION_DISPOSITIONS,
  REFACTOR_RESOLUTION_EVIDENCE_SCHEMA_VERSION,
  REFACTOR_SCALES,
  REFACTOR_SCALE_REASON_CODES,
  architectureTargetDeltaInterventionId,
  architectureTargetDeltaInvariantIssues,
  moduleStatisticsDigest,
  moduleStatisticsInvariantIssues,
  moduleStatisticsSnapshotDigest,
  moduleStatisticsSnapshotInvariantIssues,
  recommendationV3FingerprintInput,
  recommendationV3InvariantIssues,
  refactorAssessmentDigest,
  refactorAssessmentInvariantIssues,
  refactorProposalDigest,
  refactorProposalInvariantIssues,
  refactorRequestInvariantIssues,
  refactorResolutionEvidenceDigest,
  refactorResolutionEvidenceInvariantIssues,
  refactorScanInvariantIssues,
  refactorVerifyInvariantIssues,
  type ArchitectureTargetDeltaV1,
  type ModuleStatisticsSnapshotV1,
  type ModuleStatisticsV1,
  type RefactorAssessmentV1,
  type RefactorProposalV1,
  type RefactorRequestV1,
  type RefactorResolutionEvidenceV1,
  type RefactorTargetOutcomeV1
} from "../src/refactor";
import { digestJson, type Json } from "../src/schema";

const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;

function digestOf(seed: string): string {
  return digestJson({ seed });
}

function fingerprintDigest(recommendation: RecommendationV3): string {
  return digestJson(recommendationV3FingerprintInput(recommendation) as unknown as Json);
}

function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => reverseKeys(item)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    return Object.fromEntries(entries.map(([key, entry]) => [key, reverseKeys(entry)])) as T;
  }
  return value;
}

function makeOutcome(overrides: Partial<RefactorTargetOutcomeV1> = {}): RefactorTargetOutcomeV1 {
  return {
    outcomeId: "outcome.cycle-count",
    metric: "cycleCount",
    subjectSelectorId: "selector.node.core",
    nodeId: "component.core",
    operator: "less_than",
    value: 1,
    required: true,
    ...overrides
  };
}

function makeTargetDelta(overrides: Partial<ArchitectureTargetDeltaV1> = {}): ArchitectureTargetDeltaV1 {
  const draft: ArchitectureTargetDeltaV1 = {
    interventionId: "intervention.unbound",
    trigger: ["bidirectional edge between core and local-runtime"],
    thesis: "collapse the duplicated serializer into a single owning module",
    targetState: {
      owners: { "component.core.serializer": "component.core" },
      requiredRelations: ["relation.core-owns-serializer"],
      removedConcepts: ["symbol.legacySerializerBridge"]
    },
    migrationState: {
      active: true,
      compatibilityContracts: [],
      temporaryRelations: []
    },
    completionCriteria: [makeOutcome()],
    falsifiers: ["cycleCount stays above zero after the merge"],
    benefitLedger: {
      benefits: ["single serializer owner"],
      costs: ["one migration window"],
      rollbackPoint: "revert the cutover commit"
    },
    unresolvedTargets: [],
    ...overrides
  };
  return { ...draft, interventionId: architectureTargetDeltaInterventionId(draft) };
}

function makeProposal(overrides: Partial<RefactorProposalV1> = {}): RefactorProposalV1 {
  const draft: RefactorProposalV1 = {
    schemaVersion: REFACTOR_PROPOSAL_SCHEMA_VERSION,
    authoredBy: { kind: "subagent", id: "agent.codex", source: "subagent" },
    intent: "merge the duplicated serializer implementations",
    scopePaths: ["packages/core/serializer", "packages/local-runtime/serializer"],
    targetDelta: makeTargetDelta(),
    targetOutcomes: [makeOutcome()],
    killList: [{ kind: "symbol", selectorId: "symbol.legacySerializerBridge", required: true }],
    proposalDigest: ZERO_DIGEST,
    ...overrides
  };
  return { ...draft, proposalDigest: refactorProposalDigest(draft) };
}

function makeModule(overrides: Partial<ModuleStatisticsV1> = {}): ModuleStatisticsV1 {
  const draft: ModuleStatisticsV1 = {
    nodeId: "component.core",
    nodeDigest: digestOf("node.component.core"),
    parentNodeId: null,
    footprintDeclared: true,
    footprint: {
      fileCount: 12,
      lineCount: 2400,
      sourceFilesDigest: digestOf("files.component.core"),
      includePatterns: ["packages/core/**"],
      excludePatterns: []
    },
    surfaces: {
      declaredEntrypoints: ["packages/core/src/index.ts"],
      observedEntrypoints: [],
      lifecycleOwners: [],
      datastoreSubjects: []
    },
    dependencyGraph: {
      internalEdgeCount: 40,
      inboundModuleEdges: 3,
      outboundModuleEdges: 2,
      fanIn: 3,
      fanOut: 2,
      stronglyConnectedComponentId: null,
      cycleCount: 0,
      instability: null,
      directionViolationCount: null
    },
    tests: { testFileCount: 4, observedTestEdges: 9, callerCoverage: 0.75, coverageStatus: "measured" },
    uncertainty: { unresolvedImports: 1, dynamicInvocation: "none_observed", ambiguousOwnership: false },
    moduleDigest: ZERO_DIGEST,
    ...overrides
  };
  return { ...draft, moduleDigest: moduleStatisticsDigest(draft) };
}

function makeSnapshot(overrides: Partial<ModuleStatisticsSnapshotV1> = {}): ModuleStatisticsSnapshotV1 {
  const draft: ModuleStatisticsSnapshotV1 = {
    schemaVersion: MODULE_STATISTICS_SCHEMA_VERSION,
    repository: { repositoryId: "repo.archcontext", storageRepositoryId: "storage.repo.archcontext" },
    worktree: {
      workspaceId: "workspace.main",
      storageWorkspaceId: "storage.workspace.main",
      branch: "main",
      headSha: "83636c7c1f6a4a0b9d2e5f7081a3b4c6d8e9f012",
      worktreeDigest: digestOf("worktree.main")
    },
    modelDigest: digestOf("model"),
    codeFacts: {
      provider: "codegraph",
      version: "0.9.1",
      binaryDigest: digestOf("codegraph-binary"),
      indexedWorktreeDigest: digestOf("worktree.main"),
      coverage: "complete",
      truncated: false,
      edgeLimit: 20000,
      reasonCodes: []
    },
    modules: [makeModule()],
    repositorySummary: {
      moduleCount: 1,
      undeclaredFootprintNodeCount: 0,
      ownedFileCount: 12,
      unownedFileCount: 3,
      multiplyOwnedFileCount: 0,
      crossModuleEdgeCount: 5,
      crossModuleCycleCount: 0,
      stronglyConnectedComponentCount: 0,
      unresolvedImportCount: 1,
      dynamicInvocationRiskCount: 0
    },
    createdAt: "2026-09-03T03:05:00.000Z",
    snapshotDigest: ZERO_DIGEST,
    ...overrides
  };
  return { ...draft, snapshotDigest: moduleStatisticsSnapshotDigest(draft) };
}

function makeAssessment(overrides: Partial<RefactorAssessmentV1> = {}): RefactorAssessmentV1 {
  const draft: RefactorAssessmentV1 = {
    schemaVersion: REFACTOR_ASSESSMENT_SCHEMA_VERSION,
    requestId: "request.refactor.1",
    statisticsSnapshotDigest: makeSnapshot().snapshotDigest,
    modelDigest: digestOf("model"),
    codeFactsDigest: digestOf("code-facts"),
    requestedScope: { kind: "repository" },
    proposalDigest: makeProposal().proposalDigest,
    observations: [
      {
        kind: "cycle",
        subjectSelectorId: "selector.node.core",
        signalIds: ["signal.cycle.core-runtime"],
        metrics: { cycleCount: 1, instability: null }
      }
    ],
    scale: "cross_module",
    scaleReasonCodes: ["multi-node-scope"],
    affectedNodeIds: ["component.core", "component.local-runtime"],
    majorChangeReasons: [],
    pressure: { level: "medium", score: 42, signalIds: ["signal.cycle.core-runtime"] },
    confidence: {
      level: "medium",
      callerCoverage: 0.75,
      testsObserved: true,
      rollbackObserved: null,
      unresolvedEvidence: []
    },
    createdAt: "2026-09-03T03:06:00.000Z",
    assessmentDigest: ZERO_DIGEST,
    ...overrides
  };
  return { ...draft, assessmentDigest: refactorAssessmentDigest(draft) };
}

function makeResolutionEvidence(overrides: Partial<RefactorResolutionEvidenceV1> = {}): RefactorResolutionEvidenceV1 {
  const draft: RefactorResolutionEvidenceV1 = {
    schemaVersion: REFACTOR_RESOLUTION_EVIDENCE_SCHEMA_VERSION,
    recommendationId: "recommendation.abc123",
    recommendationDigest: digestOf("recommendation.abc123"),
    beforeSnapshotDigest: digestOf("snapshot.before"),
    afterSnapshotDigest: makeSnapshot().snapshotDigest,
    verifiedHeadSha: "83636c7c1f6a4a0b9d2e5f7081a3b4c6d8e9f012",
    verifiedWorktreeDigest: digestOf("worktree.main"),
    expectedOutcomes: [makeOutcome()],
    observedOutcomes: [{ outcomeId: "outcome.cycle-count", observedValue: 0, satisfied: true, direction: "improved" }],
    residuals: [],
    executionEvidenceRefs: [
      { kind: "merge_receipt", locator: "pr:124", sha256: "a".repeat(64) }
    ],
    disposition: "resolved",
    verifiedAt: "2026-09-03T04:00:00.000Z",
    resolutionDigest: ZERO_DIGEST,
    ...overrides
  };
  return { ...draft, resolutionDigest: refactorResolutionEvidenceDigest(draft) };
}

function makeRefactorProposalPayload(overrides: Partial<RefactorProposalPayloadV1> = {}): RefactorProposalPayloadV1 {
  const proposal = makeProposal();
  return {
    assessmentDigest: makeAssessment().assessmentDigest,
    proposalDigest: proposal.proposalDigest,
    scale: "cross_module",
    affectedNodeIds: ["component.core", "component.local-runtime"],
    majorChangeReasons: [],
    baselineSnapshotDigest: makeSnapshot().snapshotDigest,
    targetDelta: proposal.targetDelta,
    targetOutcomes: proposal.targetOutcomes,
    killList: proposal.killList,
    ...overrides
  };
}

function makeRecommendationV3(
  overrides: Partial<RecommendationV3Base> = {},
  categoryPayload: RecommendationV3CategoryPayloadV1 = {
    category: "refactor_proposal",
    payload: makeRefactorProposalPayload()
  }
): RecommendationV3 {
  const base: RecommendationV3Base = {
    schemaVersion: RECOMMENDATION_V3_SCHEMA_VERSION,
    recommendationId: "recommendation.abc123",
    runId: "run.refactor.1",
    fingerprint: digestOf("fingerprint.abc123"),
    subject: "component.core",
    status: "open",
    confidence: "medium",
    enforcement: "checkpoint",
    risk: "medium",
    uncertainty: "medium",
    evidenceBindingIds: ["binding.1", "binding.2"],
    explanation: ["two serializer implementations own the same paths"],
    authoredBy: { kind: "subagent", id: "agent.codex", source: "subagent" },
    subjectSelectorId: "selector.node.core",
    relations: {},
    createdAt: "2026-09-03T03:07:00.000Z",
    updatedAt: "2026-09-03T03:07:00.000Z"
  };
  return { ...base, ...categoryPayload, ...overrides };
}

describe("refactor contract digest determinism", () => {
  test("every digest is stable across repeated calls and key reordering", () => {
    const proposal = makeProposal();
    const snapshot = makeSnapshot();
    const assessment = makeAssessment();
    const evidence = makeResolutionEvidence();
    const delta = makeTargetDelta();
    const module = makeModule();

    expect(refactorProposalDigest(proposal)).toBe(refactorProposalDigest(reverseKeys(proposal)));
    expect(moduleStatisticsDigest(module)).toBe(moduleStatisticsDigest(reverseKeys(module)));
    expect(moduleStatisticsSnapshotDigest(snapshot)).toBe(moduleStatisticsSnapshotDigest(reverseKeys(snapshot)));
    expect(refactorAssessmentDigest(assessment)).toBe(refactorAssessmentDigest(reverseKeys(assessment)));
    expect(refactorResolutionEvidenceDigest(evidence)).toBe(refactorResolutionEvidenceDigest(reverseKeys(evidence)));
    expect(architectureTargetDeltaInterventionId(delta)).toBe(architectureTargetDeltaInterventionId(reverseKeys(delta)));

    expect(refactorProposalDigest(proposal)).toBe(proposal.proposalDigest);
    expect(moduleStatisticsSnapshotDigest(snapshot)).toBe(snapshot.snapshotDigest);
    expect(refactorAssessmentDigest(assessment)).toBe(assessment.assessmentDigest);
    expect(refactorResolutionEvidenceDigest(evidence)).toBe(evidence.resolutionDigest);
  });

  test("extensions and timestamps are excluded from every digest", () => {
    const proposal = makeProposal();
    const snapshot = makeSnapshot();
    const assessment = makeAssessment();
    const evidence = makeResolutionEvidence();
    const delta = makeTargetDelta();

    expect(refactorProposalDigest({ ...proposal, extensions: { note: "ignored" } })).toBe(proposal.proposalDigest);
    expect(
      moduleStatisticsSnapshotDigest({ ...snapshot, createdAt: "2030-01-01T00:00:00.000Z", extensions: { note: "ignored" } })
    ).toBe(snapshot.snapshotDigest);
    expect(
      refactorAssessmentDigest({ ...assessment, createdAt: "2030-01-01T00:00:00.000Z", extensions: { note: "ignored" } })
    ).toBe(assessment.assessmentDigest);
    expect(
      refactorResolutionEvidenceDigest({ ...evidence, verifiedAt: "2030-01-01T00:00:00.000Z", extensions: { note: "ignored" } })
    ).toBe(evidence.resolutionDigest);
    expect(architectureTargetDeltaInterventionId({ ...delta, extensions: { note: "ignored" } })).toBe(delta.interventionId);
  });

  test("assessmentDigest excludes the per-invocation requestId but binds the measured payload", () => {
    const assessment = makeAssessment();
    expect(refactorAssessmentDigest({ ...assessment, requestId: "request.refactor.999" })).toBe(assessment.assessmentDigest);
    expect(refactorAssessmentDigest({ ...assessment, scale: "architecture" })).not.toBe(assessment.assessmentDigest);
  });

  test("proposalDigest is bound to the authoring actor", () => {
    const proposal = makeProposal();
    const reauthored = { ...proposal, authoredBy: { ...proposal.authoredBy, id: "agent.claude" } };
    expect(refactorProposalDigest(reauthored)).not.toBe(proposal.proposalDigest);
    expect(refactorProposalDigest({ ...proposal, intent: "something else" })).not.toBe(proposal.proposalDigest);
  });

  test("interventionId ignores ArchContext-filled unresolvedTargets", () => {
    const delta = makeTargetDelta();
    const resolvedByArchContext = { ...delta, unresolvedTargets: ["component.unknown"] };
    expect(architectureTargetDeltaInterventionId(resolvedByArchContext)).toBe(delta.interventionId);
    expect(delta.interventionId).toMatch(/^intervention\.[a-f0-9]{16}$/);
    expect(architectureTargetDeltaInterventionId({ ...delta, thesis: "a different thesis" })).not.toBe(delta.interventionId);
  });

  test("proposalDigest ignores ArchContext-filled targetDelta.unresolvedTargets", () => {
    const proposal = makeProposal();
    const afterAssessment = {
      ...proposal,
      targetDelta: { ...proposal.targetDelta!, unresolvedTargets: ["component.unknown"] }
    };
    expect(refactorProposalDigest(afterAssessment)).toBe(proposal.proposalDigest);
  });

  test("proposalDigest moves with every other targetDelta field", () => {
    const proposal = makeProposal();
    const rethought = { ...proposal, targetDelta: { ...proposal.targetDelta!, thesis: "a different thesis" } };
    const refalsified = { ...proposal, targetDelta: { ...proposal.targetDelta!, falsifiers: ["a different falsifier"] } };
    const recriteria = {
      ...proposal,
      targetDelta: { ...proposal.targetDelta!, completionCriteria: [makeOutcome({ value: 2 })] }
    };
    expect(refactorProposalDigest(rethought)).not.toBe(proposal.proposalDigest);
    expect(refactorProposalDigest(refalsified)).not.toBe(proposal.proposalDigest);
    expect(refactorProposalDigest(recriteria)).not.toBe(proposal.proposalDigest);
  });

  test("nested extensions are hashed content; only top-level extensions are excluded", () => {
    const snapshot = makeSnapshot();
    const annotatedModule = { ...snapshot.modules[0]!, extensions: { note: "nested and hashed" } };
    expect(moduleStatisticsSnapshotDigest({ ...snapshot, modules: [annotatedModule] })).not.toBe(snapshot.snapshotDigest);
    // The exclusion is relative to the record being hashed: the same field is
    // top-level, and therefore excluded, when the module is hashed on its own.
    expect(moduleStatisticsDigest(annotatedModule)).toBe(snapshot.modules[0]!.moduleDigest);
  });

  test("module and snapshot digests move with the measured payload", () => {
    const snapshot = makeSnapshot();
    const module = makeModule();
    expect(moduleStatisticsDigest({ ...module, footprint: { ...module.footprint!, lineCount: 2401 } })).not.toBe(module.moduleDigest);
    expect(
      moduleStatisticsSnapshotDigest({
        ...snapshot,
        repositorySummary: { ...snapshot.repositorySummary, unownedFileCount: 4 }
      })
    ).not.toBe(snapshot.snapshotDigest);
  });
});

describe("refactor contract enums", () => {
  test("every closed enum is sorted and unique", () => {
    const enums: Record<string, readonly string[]> = {
      REFACTOR_SCALES,
      REFACTOR_SCALE_REASON_CODES,
      REFACTOR_OBSERVATION_KINDS,
      REFACTOR_RESOLUTION_DISPOSITIONS,
      REFACTOR_OUTCOME_OPERATORS,
      REFACTOR_OUTCOME_DIRECTIONS,
      REFACTOR_KILL_LIST_KINDS,
      REFACTOR_EXECUTION_EVIDENCE_KINDS,
      REFACTOR_PROPOSAL_AUTHOR_SOURCES,
      MODULE_DYNAMIC_INVOCATION_LEVELS,
      MODULE_TESTS_COVERAGE_STATUSES,
      RECOMMENDATION_CATEGORIES
    };
    for (const [name, values] of Object.entries(enums)) {
      expect([...values].sort(), name).toEqual([...values]);
      expect(new Set(values).size, name).toBe(values.length);
    }
  });

  test("schema version constants are frozen", () => {
    expect(REFACTOR_REQUEST_SCHEMA_VERSION).toBe("archcontext.refactor-request/v1");
    expect(REFACTOR_PROPOSAL_SCHEMA_VERSION).toBe("archcontext.refactor-proposal/v1");
    expect(MODULE_STATISTICS_SCHEMA_VERSION).toBe("archcontext.module-statistics/v1");
    expect(REFACTOR_ASSESSMENT_SCHEMA_VERSION).toBe("archcontext.refactor-assessment/v1");
    expect(REFACTOR_RESOLUTION_EVIDENCE_SCHEMA_VERSION).toBe("archcontext.refactor-resolution-evidence/v1");
    expect(RECOMMENDATION_V3_SCHEMA_VERSION).toBe("archcontext.recommendation/v3");
  });

  test("refactor proposal author sources exclude system and daemon", () => {
    expect(REFACTOR_PROPOSAL_AUTHOR_SOURCES).not.toContain("system");
    expect(REFACTOR_PROPOSAL_AUTHOR_SOURCES).not.toContain("daemon");
  });
});

describe("refactor proposal and target delta validators", () => {
  test("an agent-authored proposal is valid", () => {
    expect(refactorProposalInvariantIssues(makeProposal())).toEqual([]);
    expect(architectureTargetDeltaInvariantIssues(makeTargetDelta())).toEqual([]);
    const request: RefactorRequestV1 = {
      schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION,
      scope: { kind: "paths", paths: ["packages/core/serializer"] },
      proposal: makeProposal()
    };
    expect(refactorRequestInvariantIssues(request)).toEqual([]);
  });

  test("a daemon-authored proposal is rejected", () => {
    const proposal = makeProposal({ authoredBy: { kind: "daemon", id: "archctx-daemon", source: "daemon" } });
    expect(refactorProposalInvariantIssues(proposal)).toContain(
      "proposal.authoredBy.source must not be daemon; refactor proposals are agent or human authored"
    );
  });

  test("a system-authored proposal is rejected", () => {
    const proposal = makeProposal({ authoredBy: { kind: "system", id: "archctx", source: "system" } });
    expect(refactorProposalInvariantIssues(proposal).some((issue) => issue.includes("must not be system"))).toBe(true);
  });

  test("a proposal with a stale digest is rejected", () => {
    const proposal = { ...makeProposal(), proposalDigest: ZERO_DIGEST };
    expect(refactorProposalInvariantIssues(proposal)).toContain("proposal.proposalDigest must bind the authored proposal payload");
  });

  test("absolute scope paths are rejected", () => {
    const proposal = makeProposal({ scopePaths: ["/tmp/packages/core"] });
    expect(refactorProposalInvariantIssues(proposal).some((issue) => issue.includes("repo-relative POSIX"))).toBe(true);
  });

  test("a target delta without falsifiers is rejected", () => {
    const delta = makeTargetDelta({ falsifiers: [] });
    expect(architectureTargetDeltaInvariantIssues(delta)).toContain("targetDelta.falsifiers must state at least one falsifier");
  });

  test("a hand-written interventionId is rejected", () => {
    const delta = { ...makeTargetDelta(), interventionId: "intervention.merge-serializers" };
    expect(architectureTargetDeltaInvariantIssues(delta)).toContain(
      "targetDelta.interventionId must be derived from the authored delta"
    );
  });

  test("a daemon actor kind cannot author a proposal even with an allowed source", () => {
    const proposal = makeProposal({ authoredBy: { kind: "daemon", id: "archctx-daemon", source: "subagent" } });
    expect(refactorProposalInvariantIssues(proposal)).toContain(
      "proposal.authoredBy.kind must not be daemon; refactor proposals are agent or human authored"
    );
  });

  test("an actor kind incompatible with its source is rejected", () => {
    const proposal = makeProposal({ authoredBy: { kind: "cli", id: "archctx-cli", source: "mcp" } });
    expect(refactorProposalInvariantIssues(proposal)).toContain(
      "proposal.authoredBy.kind cli is not compatible with source mcp"
    );
  });

  test("the declared kind and source pairs are accepted", () => {
    for (const [kind, sources] of Object.entries(REFACTOR_PROPOSAL_AUTHOR_PAIRS)) {
      for (const source of sources) {
        const proposal = makeProposal({ authoredBy: { kind: kind as "cli", id: `actor.${kind}`, source } });
        expect(refactorProposalInvariantIssues(proposal), `${kind}/${source}`).toEqual([]);
      }
    }
  });

  test("an outcome with a value-free operator carrying a value is rejected", () => {
    const proposal = makeProposal({ targetOutcomes: [makeOutcome({ operator: "absent", value: 3 })] });
    expect(refactorProposalInvariantIssues(proposal).some((issue) => issue.includes("must not carry a value"))).toBe(true);
  });
});

describe("module statistics validators", () => {
  test("a measured snapshot is valid", () => {
    expect(moduleStatisticsInvariantIssues(makeModule())).toEqual([]);
    expect(moduleStatisticsSnapshotInvariantIssues(makeSnapshot())).toEqual([]);
  });

  test("an undeclared footprint must not carry footprint numbers", () => {
    const module = makeModule({ footprintDeclared: false });
    expect(moduleStatisticsInvariantIssues(module)).toContain(
      "module.footprint must be present exactly when footprintDeclared is true"
    );
  });

  test("unknown code-facts coverage forbids a dependency graph", () => {
    const draft = makeSnapshot({
      codeFacts: {
        provider: "codegraph",
        version: "0.9.1",
        binaryDigest: digestOf("codegraph-binary"),
        indexedWorktreeDigest: null,
        coverage: "unknown",
        truncated: true,
        edgeLimit: null,
        reasonCodes: ["code-facts-missing"]
      }
    });
    const issues = moduleStatisticsSnapshotInvariantIssues(draft);
    expect(issues).toContain("snapshot.modules[0].dependencyGraph must be null when codeFacts.coverage is unknown");
  });

  test("a stale code-facts index is rejected once coverage is claimed", () => {
    const snapshot = makeSnapshot();
    const stale = {
      ...snapshot,
      codeFacts: { ...snapshot.codeFacts, indexedWorktreeDigest: digestOf("worktree.older-head") }
    };
    expect(moduleStatisticsSnapshotInvariantIssues(stale)).toContain(
      "snapshot.codeFacts.indexedWorktreeDigest must match the measured worktreeDigest"
    );
    const unindexed = { ...snapshot, codeFacts: { ...snapshot.codeFacts, indexedWorktreeDigest: null } };
    expect(moduleStatisticsSnapshotInvariantIssues(unindexed)).toContain(
      "snapshot.codeFacts.indexedWorktreeDigest must be present when coverage is complete"
    );
  });

  test("negative and fractional counts are rejected", () => {
    const negativeEdges = makeModule({
      dependencyGraph: {
        internalEdgeCount: -1,
        inboundModuleEdges: 3,
        outboundModuleEdges: 2,
        fanIn: 3,
        fanOut: 2,
        stronglyConnectedComponentId: null,
        cycleCount: 0,
        instability: null,
        directionViolationCount: null
      }
    });
    expect(moduleStatisticsInvariantIssues(negativeEdges)).toContain(
      "module.dependencyGraph.internalEdgeCount must be a non-negative integer"
    );
    const overCoverage = makeModule({
      tests: { testFileCount: 4, observedTestEdges: 9, callerCoverage: 2, coverageStatus: "measured" }
    });
    expect(moduleStatisticsInvariantIssues(overCoverage)).toContain("module.tests.callerCoverage must be a ratio between 0 and 1");
    const snapshot = makeSnapshot();
    expect(
      moduleStatisticsSnapshotInvariantIssues({
        ...snapshot,
        repositorySummary: { ...snapshot.repositorySummary, unownedFileCount: 1.5 }
      })
    ).toContain("snapshot.repositorySummary.unownedFileCount must be a non-negative integer");
  });

  test("a repositorySummary that disagrees with the measured modules is rejected", () => {
    const snapshot = makeSnapshot();
    const drifted = {
      ...snapshot,
      repositorySummary: { ...snapshot.repositorySummary, moduleCount: 9 }
    };
    expect(moduleStatisticsSnapshotInvariantIssues(drifted)).toContain(
      "snapshot.repositorySummary.moduleCount must equal the module count"
    );
  });
});

describe("refactor assessment validators", () => {
  test("a scored assessment is valid", () => {
    expect(refactorAssessmentInvariantIssues(makeAssessment())).toEqual([]);
  });

  test("a scan without a proposal must not carry a scale", () => {
    const assessment = makeAssessment({ proposalDigest: null });
    expect(refactorAssessmentInvariantIssues(assessment)).toContain(
      "assessment.scale must be null exactly when proposalDigest is null"
    );
  });

  test("an observation-only assessment is valid", () => {
    const assessment = makeAssessment({ proposalDigest: null, scale: null, scaleReasonCodes: [] });
    expect(refactorAssessmentInvariantIssues(assessment)).toEqual([]);
  });

  test("architecture scale requires a major change reason", () => {
    const assessment = makeAssessment({ scale: "architecture", majorChangeReasons: [] });
    expect(refactorAssessmentInvariantIssues(assessment)).toContain(
      "assessment.architecture scale requires at least one majorChangeReason"
    );
  });

  test("major change reasons are constrained to the shared vocabulary", () => {
    const assessment = makeAssessment({
      scale: "architecture",
      majorChangeReasons: ["migration-target-state-changed" as never]
    });
    expect(refactorAssessmentInvariantIssues(assessment).some((issue) => issue.includes("unsupported reason"))).toBe(true);
  });

  test("a pressure score outside 0-100 is rejected", () => {
    for (const score of [-5, 101, 42.5]) {
      const assessment = makeAssessment({ pressure: { level: "medium", score, signalIds: ["signal.cycle.core-runtime"] } });
      expect(refactorAssessmentInvariantIssues(assessment), String(score)).toContain(
        "assessment.pressure.score must be an integer between 0 and 100"
      );
    }
    const boundary = makeAssessment({ pressure: { level: "high", score: 100, signalIds: [] } });
    expect(refactorAssessmentInvariantIssues(boundary)).toEqual([]);
  });

  test("an accepted major change reason passes", () => {
    const assessment = makeAssessment({ scale: "architecture", majorChangeReasons: ["ownership-changed"] });
    expect(refactorAssessmentInvariantIssues(assessment)).toEqual([]);
  });
});

describe("resolution evidence validators", () => {
  test("a resolved verification is valid", () => {
    expect(refactorResolutionEvidenceInvariantIssues(makeResolutionEvidence())).toEqual([]);
  });

  test("an unmet required outcome cannot be resolved", () => {
    const evidence = makeResolutionEvidence({
      observedOutcomes: [{ outcomeId: "outcome.cycle-count", observedValue: 2, satisfied: false, direction: "unchanged" }]
    });
    expect(refactorResolutionEvidenceInvariantIssues(evidence)).toContain(
      "resolutionEvidence.disposition must be not_improved when no required outcome is satisfied"
    );
  });

  test("a regressed outcome forces the regressed disposition", () => {
    const evidence = makeResolutionEvidence({
      observedOutcomes: [{ outcomeId: "outcome.cycle-count", observedValue: 4, satisfied: false, direction: "regressed" }]
    });
    expect(refactorResolutionEvidenceInvariantIssues(evidence)).toContain(
      "resolutionEvidence.disposition must be regressed when any observed outcome regressed"
    );
  });

  test("a self-reported satisfied flag that contradicts the measurement is rejected", () => {
    const evidence = makeResolutionEvidence({
      observedOutcomes: [{ outcomeId: "outcome.cycle-count", observedValue: 99, satisfied: true, direction: "improved" }]
    });
    const issues = refactorResolutionEvidenceInvariantIssues(evidence);
    expect(issues).toContain(
      "resolutionEvidence.observedOutcomes outcome.cycle-count claims satisfied=true but cycleCount less_than 1 against 99 is false"
    );
    expect(issues).toContain("resolutionEvidence.disposition must be not_improved when no required outcome is satisfied");
    expect(refactorVerifyInvariantIssues(makeSnapshot(), evidence).length).toBeGreaterThan(0);
  });

  test("an expected outcome without an observation is rejected", () => {
    const evidence = makeResolutionEvidence({ observedOutcomes: [] });
    expect(refactorResolutionEvidenceInvariantIssues(evidence)).toContain(
      "resolutionEvidence.observedOutcomes is missing outcome outcome.cycle-count"
    );
  });

  test("execution evidence references carry a bare sha256 locator hash", () => {
    const evidence = makeResolutionEvidence({
      executionEvidenceRefs: [{ kind: "task_contract", locator: "tasks/contracts/x.md", sha256: "not-a-digest" }]
    });
    expect(refactorResolutionEvidenceInvariantIssues(evidence).some((issue) => issue.includes("bare SHA-256"))).toBe(true);
  });
});

describe("recommendation v3 contract", () => {
  test("v3 is a strict superset of v2", () => {
    const recommendation = makeRecommendationV3();
    const { schemaVersion: _schemaVersion, ...v3Fields } = recommendation;
    const asV2Shape: Omit<RecommendationV2, "schemaVersion"> = v3Fields;
    expect(asV2Shape.status).toBe("open");
    const missingFromV3: Exclude<keyof RecommendationV2, keyof RecommendationV3>[] = [];
    expect(missingFromV3).toEqual([]);
  });

  test("a refactor proposal recommendation is valid", () => {
    expect(recommendationV3InvariantIssues(makeRecommendationV3())).toEqual([]);
  });

  test("a daemon-authored refactor proposal is rejected", () => {
    const recommendation = makeRecommendationV3({
      authoredBy: { kind: "daemon", id: "archctx-daemon", source: "daemon" }
    });
    expect(recommendationV3InvariantIssues(recommendation)).toContain(
      "recommendation.refactor_proposal must not be authored by daemon"
    );
  });

  test("architecture scale requires complete enforcement", () => {
    const recommendation = makeRecommendationV3(
      {},
      { category: "refactor_proposal", payload: makeRefactorProposalPayload({ scale: "architecture" }) }
    );
    expect(recommendationV3InvariantIssues(recommendation)).toContain(
      "recommendation.refactor_proposal with scale architecture requires complete enforcement"
    );
  });

  test("a structural observation must be daemon authored and advisory", () => {
    const recommendation = makeRecommendationV3(
      { enforcement: "checkpoint", authoredBy: { kind: "subagent", id: "agent.codex", source: "subagent" } },
      {
        category: "structural_observation",
        payload: {
          assessmentDigest: makeAssessment().assessmentDigest,
          kind: "cycle",
          affectedNodeIds: ["component.core"],
          baselineSnapshotDigest: makeSnapshot().snapshotDigest,
          derivedOutcomes: [makeOutcome()]
        }
      }
    );
    const issues = recommendationV3InvariantIssues(recommendation);
    expect(issues).toContain("recommendation.structural_observation must be authored by the daemon");
    expect(issues).toContain("recommendation.structural_observation enforcement must be advisory");
  });

  test("a mismatched category and payload returns issues without throwing", () => {
    const mismatched = {
      ...makeRecommendationV3(),
      payload: { practiceId: "practice.boundary", baselineDigest: null }
    } as unknown as RecommendationV3;
    const issues = recommendationV3InvariantIssues(mismatched);
    expect(issues.some((issue) => issue.startsWith("recommendation.payload does not match category refactor_proposal"))).toBe(true);
  });

  test("a null or primitive payload returns issues without throwing", () => {
    for (const payload of [null, 42, "payload", [] as unknown]) {
      const broken = { ...makeRecommendationV3(), payload } as unknown as RecommendationV3;
      expect(() => recommendationV3InvariantIssues(broken)).not.toThrow();
      expect(recommendationV3InvariantIssues(broken), String(payload)).toContain(
        "recommendation.payload must be an object for category refactor_proposal"
      );
    }
  });

  test("a wrong schemaVersion and a malformed fingerprint are rejected", () => {
    const wrongVersion = { ...makeRecommendationV3(), schemaVersion: "archcontext.recommendation/v2" } as unknown as RecommendationV3;
    expect(recommendationV3InvariantIssues(wrongVersion)).toContain("recommendation.schemaVersion is invalid");
    const malformed = makeRecommendationV3({ fingerprint: "not-a-digest" });
    expect(recommendationV3InvariantIssues(malformed)).toContain("recommendation.fingerprint must be a sha256:<64-hex> digest");
  });

  test("a daemon actor kind cannot author a refactor proposal recommendation", () => {
    const recommendation = makeRecommendationV3({
      authoredBy: { kind: "daemon", id: "archctx-daemon", source: "subagent" }
    });
    expect(recommendationV3InvariantIssues(recommendation)).toContain(
      "recommendation.authoredBy.kind must not be daemon; refactor proposals are agent or human authored"
    );
  });

  test("a practice recommendation without a practiceId is rejected", () => {
    const recommendation = makeRecommendationV3(
      { enforcement: "advisory", authoredBy: { kind: "daemon", id: "archctx-daemon", source: "daemon" } },
      { category: "practice", payload: { practiceId: "practice.boundary", baselineDigest: null } }
    );
    expect(recommendationV3InvariantIssues(recommendation)).toContain(
      "recommendation.practiceId is required for practice recommendations"
    );
  });
});

describe("recommendationV3FingerprintInput", () => {
  test("a refactor proposal fingerprint input is the sorted stable subset", () => {
    const recommendation = makeRecommendationV3();
    const input = recommendationV3FingerprintInput(recommendation);
    expect(input.category).toBe("refactor_proposal");
    expect(input.subjectSelectorId).toBe("selector.node.core");
    expect(input.practiceId).toBeNull();
    expect(Object.keys(input.payload).sort()).toEqual(["affectedNodeIds", "majorChangeReasons", "proposalDigest", "scale"]);
  });

  test("re-detection at a new baseline dedups to the same fingerprint input", () => {
    const recommendation = makeRecommendationV3();
    const rescanned = makeRecommendationV3(
      {},
      {
        category: "refactor_proposal",
        payload: makeRefactorProposalPayload({
          assessmentDigest: digestOf("assessment.rerun"),
          baselineSnapshotDigest: digestOf("snapshot.newer-head")
        })
      }
    );
    expect(fingerprintDigest(rescanned)).toBe(fingerprintDigest(recommendation));
  });

  test("a different proposal changes the fingerprint input", () => {
    const recommendation = makeRecommendationV3();
    const other = makeRecommendationV3(
      {},
      { category: "refactor_proposal", payload: makeRefactorProposalPayload({ proposalDigest: digestOf("proposal.other") }) }
    );
    expect(fingerprintDigest(other)).not.toBe(fingerprintDigest(recommendation));
  });

  test("structural observation and practice inputs drop per-run digests", () => {
    const observation = recommendationV3FingerprintInput({
      category: "structural_observation",
      subjectSelectorId: "selector.node.core",
      payload: {
        assessmentDigest: digestOf("assessment.1"),
        kind: "cycle",
        affectedNodeIds: ["component.local-runtime", "component.core"],
        baselineSnapshotDigest: digestOf("snapshot.1"),
        derivedOutcomes: [makeOutcome()]
      }
    });
    expect(observation.payload).toEqual({ kind: "cycle", affectedNodeIds: ["component.core", "component.local-runtime"] });

    const practice = recommendationV3FingerprintInput({
      category: "practice",
      subjectSelectorId: "selector.repository",
      practiceId: "practice.boundary",
      payload: { practiceId: "practice.boundary", baselineDigest: null }
    });
    expect(practice.practiceId).toBe("practice.boundary");
    expect(practice.payload).toEqual({ baselineDigest: null });
  });
});

describe("cross-entity validators", () => {
  test("a coherent scan passes", () => {
    const snapshot = makeSnapshot();
    const proposal = makeProposal();
    const assessment = makeAssessment({
      statisticsSnapshotDigest: snapshot.snapshotDigest,
      proposalDigest: proposal.proposalDigest
    });
    expect(refactorScanInvariantIssues({ snapshot, assessment, proposal })).toEqual([]);
  });

  test("an assessment bound to a different snapshot is rejected", () => {
    const snapshot = makeSnapshot();
    const assessment = makeAssessment({ statisticsSnapshotDigest: digestOf("snapshot.other") });
    expect(refactorScanInvariantIssues({ snapshot, assessment, proposal: makeProposal() })).toContain(
      "assessment.statisticsSnapshotDigest must reference the measured snapshot"
    );
  });

  test("unresolved targets force insufficient_evidence", () => {
    const snapshot = makeSnapshot();
    const proposal = makeProposal({ targetDelta: makeTargetDelta({ unresolvedTargets: ["component.unknown"] }) });
    const assessment = makeAssessment({
      statisticsSnapshotDigest: snapshot.snapshotDigest,
      proposalDigest: proposal.proposalDigest
    });
    const issues = refactorScanInvariantIssues({ snapshot, assessment, proposal });
    expect(issues).toContain("assessment.scale must be insufficient_evidence while targetDelta.unresolvedTargets is non-empty");
    expect(issues).toContain("assessment.scaleReasonCodes must include target-unresolved while targets stay unresolved");
  });

  test("a coherent verification passes", () => {
    const snapshot = makeSnapshot();
    expect(refactorVerifyInvariantIssues(snapshot, makeResolutionEvidence())).toEqual([]);
  });

  test("a stale after-snapshot index cannot resolve", () => {
    const snapshot = makeSnapshot();
    const draft = { ...snapshot, codeFacts: { ...snapshot.codeFacts, indexedWorktreeDigest: digestOf("worktree.older-head") } };
    const stale = { ...draft, snapshotDigest: moduleStatisticsSnapshotDigest(draft) };
    const evidence = makeResolutionEvidence({ afterSnapshotDigest: stale.snapshotDigest });
    expect(refactorVerifyInvariantIssues(stale, evidence)).toContain(
      "resolutionEvidence.disposition must not be resolved while the after-snapshot index does not cover the verified worktree"
    );
  });

  test("incomplete after-snapshot coverage cannot resolve", () => {
    const snapshot = makeSnapshot({
      codeFacts: {
        provider: "codegraph",
        version: "0.9.1",
        binaryDigest: digestOf("codegraph-binary"),
        indexedWorktreeDigest: digestOf("worktree.main"),
        coverage: "partial",
        truncated: true,
        edgeLimit: 20000,
        reasonCodes: ["code-facts-truncated"]
      }
    });
    const evidence = makeResolutionEvidence({ afterSnapshotDigest: snapshot.snapshotDigest });
    expect(refactorVerifyInvariantIssues(snapshot, evidence)).toContain(
      "resolutionEvidence.disposition must not be resolved while after-snapshot coverage is incomplete"
    );
  });
});

describe("refactor error catalog", () => {
  test("the four refactor error codes are catalogued", () => {
    const expected: Record<string, { severity: string; retryable: boolean; action: string }> = {
      AC_MODEL_ADOPTION_REQUIRED: { severity: "error", retryable: false, action: "adopt-architecture-model" },
      AC_REFACTOR_STALE: { severity: "warning", retryable: true, action: "rerun-refactor-scan" },
      AC_REFACTOR_EVIDENCE_REQUIRED: { severity: "error", retryable: false, action: "run-refactor-verify" },
      AC_REFACTOR_PROPOSAL_UNAUTHORED: { severity: "error", retryable: false, action: "attach-authoring-actor" }
    };
    for (const [code, shape] of Object.entries(expected)) {
      const row = ERROR_CATALOG[code as ArchContextErrorCode];
      expect(row, code).toBeDefined();
      expect(row.code, code).toBe(code as ArchContextErrorCode);
      expect(row.severity, code).toBe(shape.severity as typeof row.severity);
      expect(row.retryable, code).toBe(shape.retryable);
      expect(row.action, code).toBe(shape.action);
    }
  });
});
