import { describe, expect, test } from "bun:test";
import { inspectFg6RepresentativeBenchmark } from "./fg6-representative-benchmark-readback";

describe("fg6 representative benchmark readback evidence", () => {
  test("accepts representative clean worktree CodeGraph review latency and memory evidence", () => {
    expect(inspectFg6RepresentativeBenchmark(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects small dirty missing or over-budget benchmark evidence", () => {
    const recording: any = verifiedRecording();
    recording.evidence.targetRepository.trackedFiles = 10;
    recording.evidence.targetRepository.sourceClean = false;
    recording.evidence.cleanWorktree.dirtyLines = 2;
    recording.evidence.cleanWorktree.checkpointFresh = false;
    recording.evidence.codeGraph.initDurationMs = 400000;
    recording.evidence.codeGraph.codeFactsDigestPrefix = "bad";
    recording.evidence.review.reviewResult = "fail";
    recording.evidence.review.reviewErrors = 1;
    recording.evidence.latencyAndMemory.e2eLatencyMs = 400000;
    recording.evidence.latencyAndMemory.peakRssBytes = 0;
    recording.evidence.doctor.defaultOutbound = "internet";
    recording.evidence.assertions.representativeRepoLargeEnough = false;
    recording.evidence.assertions.sourceAndCloneClean = false;
    recording.evidence.assertions.cleanWorktreeMeasured = false;
    recording.evidence.assertions.codeGraphMeasured = false;
    recording.evidence.assertions.reviewMeasured = false;
    recording.evidence.assertions.e2eLatencyMeasured = false;
    recording.evidence.assertions.memoryMeasured = false;
    recording.evidence.assertions.withinPrdInitialIndexBudget = false;
    recording.evidence.assertions.noProviderRequired = false;

    const result = inspectFg6RepresentativeBenchmark(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("target trackedFiles must meet representative threshold");
    expect(result.failures).toContain("source and benchmark clone must be clean");
    expect(result.failures).toContain("clean worktree dirtyLines must be 0");
    expect(result.failures).toContain("checkpoint must be fresh");
    expect(result.failures).toContain("CodeGraph initDurationMs exceeds PRD initial index budget");
    expect(result.failures).toContain("CodeGraph codeFactsDigestPrefix must be sha256");
    expect(result.failures).toContain("complete and review results must pass");
    expect(result.failures).toContain("reviewErrors must be 0");
    expect(result.failures).toContain("e2eLatencyMs exceeds representative budget");
    expect(result.failures).toContain("peakRssBytes must be positive");
    expect(result.failures).toContain("doctor defaultOutbound must be local-only");
    expect(result.failures).toContain("assertion representativeRepoLargeEnough must be true");
    expect(result.failures).toContain("assertion sourceAndCloneClean must be true");
    expect(result.failures).toContain("assertion cleanWorktreeMeasured must be true");
    expect(result.failures).toContain("assertion codeGraphMeasured must be true");
    expect(result.failures).toContain("assertion reviewMeasured must be true");
    expect(result.failures).toContain("assertion e2eLatencyMeasured must be true");
    expect(result.failures).toContain("assertion memoryMeasured must be true");
    expect(result.failures).toContain("assertion withinPrdInitialIndexBudget must be true");
    expect(result.failures).toContain("assertion noProviderRequired must be true");
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg6-representative-benchmark-readback/v1",
    taskId: "FG6-13",
    environment: "local-representative-benchmark",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T10:00:00.000Z",
    sources: {
      sourceRepo: "~/Projects/aiphabee",
      reportPath: "docs/verification/fg6-representative-benchmark.md"
    },
    budgets: {
      minRepresentativeFiles: 1000,
      initialIndexBudgetMs: 300000,
      representativeE2eBudgetMs: 300000,
      memoryBudgetBytes: null
    },
    evidence: {
      targetRepository: {
        name: "aiphabee",
        sourceClean: true,
        sourceHeadSha: "a".repeat(40),
        sourceTrackedFiles: 1312,
        benchmarkCloneClean: true,
        cloneHeadSha: "a".repeat(40),
        trackedFiles: 1312,
        changedPath: "package.json"
      },
      cleanWorktree: {
        cloneDurationMs: 1200,
        dirtyLines: 0,
        headMatchesSource: true,
        checkpointFresh: true
      },
      codeGraph: {
        initDurationMs: 2500,
        initPeakRssBytes: 200000000,
        syncDurationMs: 900,
        syncPeakRssBytes: 180000000,
        codeFactsDigestPrefix: "sha256:abc123456789"
      },
      review: {
        prepareDurationMs: 400,
        completeDurationMs: 500,
        reviewDurationMs: 500,
        completeResult: "pass",
        reviewResult: "pass",
        reviewErrors: 0,
        reviewWarnings: 0
      },
      latencyAndMemory: {
        e2eLatencyMs: 8000,
        peakRssBytes: 220000000,
        measurements: [
          row("clean-worktree-clone"),
          row("codegraph-init"),
          row("archctx-init"),
          row("archctx-sync"),
          row("archctx-prepare"),
          row("archctx-checkpoint"),
          row("archctx-complete"),
          row("archctx-review")
        ]
      },
      doctor: {
        ok: true,
        defaultOutbound: "local-only",
        codeGraphRequiredVersion: "1.0.1"
      },
      assertions: {
        representativeRepoLargeEnough: true,
        sourceAndCloneClean: true,
        cleanWorktreeMeasured: true,
        codeGraphMeasured: true,
        reviewMeasured: true,
        e2eLatencyMeasured: true,
        memoryMeasured: true,
        withinPrdInitialIndexBudget: true,
        noProviderRequired: true
      }
    },
    failures: []
  };
}

function row(phase: string) {
  return { phase, durationMs: 100, peakRssBytes: 1000000 };
}
