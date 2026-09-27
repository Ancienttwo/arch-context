import { createInitializedGitRepo, gitOut, rmSync, removeTempRepo, createStartedTestDaemon } from "./runtime-test-fixtures";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeWorktreeDigest, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { planRecommendationRun, recommendationRunLedgerPayload } from "@archcontext/core/recommendation-engine";
import { digestJson } from "@archcontext/contracts";
import { runtimeStatePaths } from "@archcontext/local-runtime/local-store-sqlite";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";

const PREVIOUS_ARCHCONTEXT_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const RUNTIME_TEST_STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-recommendations-state-"));
const WINDOWS_RUNTIME_IO_TEST_TIMEOUT_MS = process.platform === "win32" ? 30_000 : 5_000;
process.env.ARCHCONTEXT_STATE_DIR = RUNTIME_TEST_STATE_ROOT;

afterAll(() => {
  if (PREVIOUS_ARCHCONTEXT_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_ARCHCONTEXT_STATE_DIR;
  rmSync(RUNTIME_TEST_STATE_ROOT, { recursive: true, force: true });
});

describe("daemon recommendations", () => {
  test("runtime recommendation lifecycle appends explicit feedback and reports local metrics", async () => {
    const root = createInitializedGitRepo();
    const store = new TestLocalStore();
    try {
      const daemon = await createStartedTestDaemon({
        localStore: store,
        clock: () => "2026-06-26T12:05:00.000Z"
      });
      const plan = await appendRecommendationRunFixture(store, root, "2026-06-26T12:00:00.000Z");
      const recommendationId = plan.recommendations[0].recommendationId;

      await expect(daemon.recommendations(root, {
        command: "accept",
        recommendationId,
        reason: "token=super-secret-value",
        actor: "developer",
        source: "cli",
        now: "2026-06-26T12:09:00.000Z"
      })).rejects.toThrow("architecture-ledger-privacy-denied");
      expect(store.architectureEvents).toHaveLength(1);

      const accepted = await daemon.recommendations(root, {
        command: "accept",
        recommendationId,
        reason: "accepted after agent-assisted local readback",
        actor: "worker.al8",
        actorKind: "subagent",
        source: "subagent",
        agentJobId: "agent_job.al8",
        now: "2026-06-26T12:10:00.000Z"
      });

      expect(accepted.ok).toBe(true);
      expect((accepted.data as any)).toMatchObject({
        schemaVersion: "archcontext.runtime-recommendation-lifecycle/v1",
        action: "accept",
        recommendationId,
        previousStatus: "open",
        nextStatus: "accepted",
        privacy: {
          writes: "architecture-ledger-event-only",
          rawSourcePersisted: false,
          rawDiffPersisted: false,
          implicitAcceptance: false
        }
      });
      expect((accepted.data as any).feedback).toMatchObject({
        schemaVersion: "archcontext.recommendation-feedback/v1",
        action: "accept",
        explicit: true,
        implicitAcceptance: false,
        actor: { kind: "subagent", source: "subagent" }
      });
      expect(JSON.stringify(accepted.data)).not.toContain("sourceCode");
      expect(JSON.stringify(accepted.data)).not.toContain("diff --git");
      expect(store.architectureEventAppends.at(-1)?.events[0]?.eventType).toBe("architecture.recommendation.lifecycle");
      expect((store.architectureEventAppends.at(-1)?.events[0]?.payload as any).feedback).toHaveLength(1);

      const open = await daemon.book(root, { command: "recommendations", openOnly: true });
      expect((open.data as any).recommendations).toEqual([]);
      const all = await daemon.book(root, { command: "recommendations" });
      expect((all.data as any).recommendations.map((recommendation: any) => recommendation.status)).toEqual(["accepted"]);

      const metrics = await daemon.recommendations(root, { command: "metrics", now: "2026-06-26T12:11:00.000Z" });
      expect((metrics.data as any)).toMatchObject({
        schemaVersion: "archcontext.recommendation-lifecycle-metrics/v1",
        recommendationCount: 1,
        feedbackCount: 1,
        acceptedRecommendationRate: 1,
        agentAssistedResolutionRate: 1
      });

      const duplicate = await daemon.recommendations(root, {
        command: "accept",
        recommendationId,
        reason: "duplicate accept should not append",
        now: "2026-06-26T12:12:00.000Z"
      });
      expect(duplicate.ok).toBe(false);
      expect((duplicate as any).error.code).toBe("AC_PRECONDITION_FAILED");
    } finally {
      removeTempRepo(root);
    }
  }, WINDOWS_RUNTIME_IO_TEST_TIMEOUT_MS);
});

async function appendRecommendationRunFixture(store: TestLocalStore, root: string, now: string) {
  const paths = runtimeStatePaths(root);
  const repository = {
    repositoryId: repositoryFingerprint(root),
    storageRepositoryId: paths.storageRepositoryId
  };
  const worktree = {
    workspaceId: paths.workspaceId,
    storageWorkspaceId: paths.storageWorkspaceId,
    branch: gitOut(root, "branch", "--show-current") || "HEAD",
    headSha: gitOut(root, "rev-parse", "HEAD"),
    worktreeDigest: computeWorktreeDigest(root)
  };
  const plan = planRecommendationRun({
    repository,
    worktree,
    triggerSource: "checkpoint",
    policyMode: "advisory",
    catalogDigest: digestJson({ fixture: "runtime-recommendation-catalog" } as any),
    inputCursor: {
      source: "candidate-delta",
      baseDigest: digestJson({ base: "runtime-recommendation" } as any),
      headDigest: digestJson({ head: "runtime-recommendation" } as any),
      headSha: worktree.headSha,
      candidateDeltaDigest: digestJson({ delta: "runtime-recommendation" } as any)
    },
    candidates: [{
      practiceId: "practice.runtime-boundary",
      subject: "module.runtime-ledger",
      confidence: "medium",
      enforcement: "advisory",
      evidenceBindingIds: ["binding.al8.lifecycle"],
      explanation: ["Runtime ledger recommendation requires explicit lifecycle feedback."],
      riskSignals: ["boundary-change"],
      uncertaintySignals: [],
      score: 52
    }],
    now
  });
  const graphDigest = digestJson({ fixture: "empty-architecture-graph" } as any);
  const inputDigest = digestJson({ runId: plan.run.runId, recommendationIds: plan.run.recommendationIds } as any);
  await store.appendArchitectureEvents({
    writer: "runtime-daemon",
    events: [{
      schemaVersion: "archcontext.architecture-event/v1",
      eventId: `architecture_event.recommendation_run.${inputDigest.replace(/^sha256:/, "").slice(0, 16)}`,
      eventType: "architecture.recommendation.run",
      payloadVersion: "archcontext.recommendation-run/v1",
      repository,
      worktree,
      baseDigest: graphDigest,
      resultingDigest: graphDigest,
      headSha: worktree.headSha,
      actor: { kind: "daemon", id: "archctxd" },
      source: "checkpoint",
      timestamp: now,
      idempotencyKey: `architecture-ledger-recommendation-run:${plan.run.runId}`,
      provenance: {
        producer: "runtime-daemon-test",
        command: "appendRecommendationRunFixture",
        inputDigest
      },
      payload: recommendationRunLedgerPayload(plan) as any
    }]
  });
  return plan;
}
