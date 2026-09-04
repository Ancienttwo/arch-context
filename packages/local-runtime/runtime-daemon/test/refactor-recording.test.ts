import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RECOMMENDATION_SCHEMA_VERSION,
  RECOMMENDATION_V3_SCHEMA_VERSION,
  digestJson,
  recommendationV3InvariantIssues,
  type Json,
  type JsonEnvelope,
  type ModuleStatisticsSnapshotV1,
  type RecommendationV3,
  type RefactorAssessmentV1,
  type RefactorProposalV1
} from "@archcontext/contracts";
import { computeWorktreeDigest, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { planRecommendationRun, recommendationRunLedgerPayload } from "@archcontext/core/recommendation-engine";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { runtimeStatePaths } from "@archcontext/local-runtime/local-store-sqlite";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { assessRefactor, deriveObservationOutcomes, type RefactorAssessmentInputV1 } from "../../../core/refactor-assessment/src/index";
import {
  CYCLE_EDGES,
  makeAssessmentInput,
  makeProposal,
  makeRequest,
  makeSnapshot
} from "../../../core/refactor-assessment/test/factories";
import { REFACTOR_ASSESSMENT_REGISTRY_CAPACITY, RefactorAssessmentRegistry } from "../src/refactor-recording";
import {
  ArchctxRuntimeRpcServer,
  RuntimeRpcClient,
  createStartedDaemon,
  type RuntimeRefactorRecordInput
} from "../src/index";

const PREVIOUS_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-refactor-recording-state-"));
process.env.ARCHCONTEXT_STATE_DIR = STATE_ROOT;

const roots: string[] = [];

afterAll(() => {
  if (PREVIOUS_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_STATE_DIR;
  for (const root of [...roots, STATE_ROOT]) rmSync(root, { recursive: true, force: true });
});

function createGitRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-refactor-recording-"));
  roots.push(root);
  writeFileSync(join(root, "README.md"), "# refactor recording fixture\n", "utf8");
  initializeArchContextModel(root, "Refactor Recording App");
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  commitAll(root, "fixture");
  return root;
}

function commitAll(root: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync(
    "git",
    ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", message],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] }
  );
}

function gitOut(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function startDaemon(store: TestLocalStore, now = "2026-09-03T08:00:00.000Z") {
  return createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: store,
    clock: () => now
  });
}

/** A daemon whose clock advances one minute per read, mirroring real wall-clock invocations. */
function startTickingDaemon(store: TestLocalStore) {
  let tick = 0;
  return createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: store,
    clock: () => new Date(Date.parse("2026-09-03T08:00:00.000Z") + tick++ * 60_000).toISOString()
  });
}

function measured(overrides: Partial<RefactorAssessmentInputV1> = {}): {
  snapshot: ModuleStatisticsSnapshotV1;
  assessment: RefactorAssessmentV1;
  proposal?: RefactorProposalV1;
} {
  const input = makeAssessmentInput({ snapshot: makeSnapshot({ importEdges: CYCLE_EDGES }), ...overrides });
  const result = assessRefactor(input);
  return { snapshot: input.snapshot, assessment: result.assessment, proposal: result.proposal };
}

function registerAt(daemon: Awaited<ReturnType<typeof startDaemon>>, root: string, overrides: Partial<RefactorAssessmentInputV1> = {}) {
  const { snapshot, assessment, proposal } = measured(overrides);
  const digest = daemon.registerRefactorAssessment({
    snapshot,
    assessment,
    ...(proposal ? { proposal } : {}),
    headSha: gitOut(root, "rev-parse", "HEAD"),
    worktreeDigest: computeWorktreeDigest(root)
  });
  return { digest, snapshot, assessment, proposal };
}

function recordInput(root: string, assessmentDigest: string): RuntimeRefactorRecordInput {
  return { assessmentDigest, expectedWorktreeDigest: computeWorktreeDigest(root) };
}

function recordedRecommendations(store: TestLocalStore): RecommendationV3[] {
  return store.architectureEvents.flatMap((event) =>
    ((event.payload as { recommendations?: RecommendationV3[] }).recommendations ?? [])
  );
}

function errorOf(envelope: JsonEnvelope): { code: string; message: string; reasonCode?: string } {
  return (envelope as { error?: { code: string; message: string; reasonCode?: string } }).error!;
}

/** Seeds one v2 practice recommendation so the migration and the practice resolve path have input. */
async function seedV2Practice(store: TestLocalStore, root: string, now: string) {
  const paths = runtimeStatePaths(root);
  const repository = { repositoryId: repositoryFingerprint(root), storageRepositoryId: paths.storageRepositoryId };
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
    catalogDigest: digestJson({ fixture: "refactor-recording-catalog" } as unknown as Json),
    inputCursor: {
      source: "candidate-delta",
      headDigest: digestJson({ head: "refactor-recording" } as unknown as Json),
      headSha: worktree.headSha
    },
    candidates: [{
      practiceId: "practice.runtime-boundary",
      subject: "module.runtime-ledger",
      confidence: "medium",
      enforcement: "advisory",
      evidenceBindingIds: ["binding.rf3.practice"],
      explanation: ["Practice recommendation seeded before the v3 migration."],
      baselineDigest: digestJson({ baseline: "refactor-recording" } as unknown as Json),
      score: 40
    }],
    now
  });
  const graphDigest = digestJson({ fixture: "empty-architecture-graph" } as unknown as Json);
  const inputDigest = digestJson({ runId: plan.run.runId } as unknown as Json);
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
      provenance: { producer: "refactor-recording.test", command: "seedV2Practice", inputDigest },
      payload: recommendationRunLedgerPayload(plan) as unknown as Json
    }]
  });
  return plan.recommendations[0]!;
}

describe("RefactorAssessmentRegistry", () => {
  test("is a bounded LRU that evicts the least recently used assessment", () => {
    const registry = new RefactorAssessmentRegistry(2);
    const entry = (digest: string) => ({
      snapshot: {} as ModuleStatisticsSnapshotV1,
      assessment: { assessmentDigest: digest } as RefactorAssessmentV1,
      headSha: "sha",
      worktreeDigest: "digest"
    });

    registry.register(entry("a"));
    registry.register(entry("b"));
    expect(registry.get("a")).toBeDefined();
    registry.register(entry("c"));

    expect(registry.size).toBe(2);
    expect(registry.get("b")).toBeUndefined();
    expect(registry.get("a")).toBeDefined();
    expect(registry.get("c")).toBeDefined();
    expect(REFACTOR_ASSESSMENT_REGISTRY_CAPACITY).toBe(8);
  });
});

describe("refactorRecord", () => {
  test("appends one refactor_scan event carrying valid v3 records", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Recording App");
      const { digest, assessment } = registerAt(daemon, root);

      const result = await daemon.refactorRecord(root, recordInput(root, digest));

      expect(result.ok).toBe(true);
      const data = result.data as any;
      expect(data.schemaVersion).toBe("archcontext.runtime-refactor-record/v1");
      expect(data.assessmentDigest).toBe(assessment.assessmentDigest);
      expect(data.append.eventSource).toBe("refactor_scan");
      expect(data.append.appendedEventCount).toBe(1);
      expect(data.recommendationIds.length).toBeGreaterThan(0);
      expect(data.catalogDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

      const appended = store.architectureEventAppends.at(-1)!.events[0]!;
      expect(appended.source).toBe("refactor_scan");
      expect(appended.actor).toEqual({ kind: "daemon", id: "archctxd" });
      expect((appended.payload as any).operations).toEqual([]);
      expect((appended.payload as any).recommendationRuns[0].trigger).toEqual({ level: "L2", source: "refactor_scan" });
      for (const record of recordedRecommendations(store)) {
        expect(recommendationV3InvariantIssues(record)).toEqual([]);
        expect(record.schemaVersion).toBe(RECOMMENDATION_V3_SCHEMA_VERSION);
      }
      expect(JSON.stringify(data)).not.toContain("diff --git");
    } finally {
      await daemon.stop();
    }
  });

  test("is reachable through the RuntimeRpcClient dispatch table", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    const rpc = new ArchctxRuntimeRpcServer(daemon, { root, port: 0, token: "refactor-record-rpc-token" });
    try {
      await daemon.init(root, "Refactor Recording App");
      const { digest } = registerAt(daemon, root);
      const connection = await rpc.start();
      const client = new RuntimeRpcClient(connection);

      const result = await client.refactorRecord(root, recordInput(root, digest));

      expect(result.ok).toBe(true);
      expect((result.data as any).append.eventSource).toBe("refactor_scan");
    } finally {
      await rpc.stop();
      await daemon.stop();
    }
  });

  test("recording the same assessment twice suppresses instead of duplicating", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Recording App");
      const { digest } = registerAt(daemon, root);
      const first = await daemon.refactorRecord(root, recordInput(root, digest));
      const recordedIds = (first.data as any).recommendationIds as string[];

      const second = await daemon.refactorRecord(root, recordInput(root, digest));

      expect(second.ok).toBe(true);
      expect((second.data as any).recommendationIds).toEqual([]);
      expect((second.data as any).suppressed.map((entry: any) => entry.reasonCode))
        .toEqual(recordedIds.map(() => "duplicate-active-fingerprint"));
      const ids = recordedRecommendations(store).map((record) => record.recommendationId);
      expect(ids).toEqual(recordedIds);
    } finally {
      await daemon.stop();
    }
  });

  test.each([false, true])("record response uses live identity after checkout change (committed=%s)", async (committed) => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startTickingDaemon(store);
    try {
      await daemon.init(root, "Refactor Recording App");
      const first = await daemon.refactorRecord(root, recordInput(root, registerAt(daemon, root).digest));
      expect(first.ok).toBe(true);
      const ledgerWorktree = (first.data as any).worktree;
      const history = JSON.stringify(store.architectureEvents);
      const count = store.architectureEvents.length;
      writeFileSync(join(root, "README.md"), "# measured changed checkout\n");
      if (committed) commitAll(root, "advance after ledger recording");
      const head = gitOut(root, "rev-parse", "HEAD");
      const digest = computeWorktreeDigest(root);
      expect(digest).not.toBe(ledgerWorktree.worktreeDigest);
      const input = recordInput(root, registerAt(daemon, root).digest);
      const result = await daemon.refactorRecord(root, input);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect((result.data as any).worktree.headSha).toBe(head);
      expect((result.data as any).worktree.worktreeDigest).toBe(digest);
      expect(store.architectureEvents.at(-1)!.worktree).toEqual(ledgerWorktree);
      expect(JSON.stringify(store.architectureEvents.slice(0, count))).toBe(history);
      const repeated = await daemon.refactorRecord(root, input);
      expect(repeated.ok).toBe(true);
      expect((repeated.data as any).worktree).toEqual((result.data as any).worktree);
    } finally {
      await daemon.stop();
    }
  });

  test("recording three times at the same HEAD on a moving clock appends runs instead of conflicting", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startTickingDaemon(store);
    try {
      await daemon.init(root, "Refactor Recording App");
      const { digest } = registerAt(daemon, root);

      const first = await daemon.refactorRecord(root, recordInput(root, digest));
      const recordedIds = (first.data as any).recommendationIds as string[];
      expect(recordedIds.length).toBeGreaterThan(0);

      // Both later scans suppress every candidate, so without the invocation clock in the run
      // identity they would derive the same runId, eventId and idempotency key with different
      // timestamps and throw architecture-ledger-idempotency-conflict.
      const second = await daemon.refactorRecord(root, recordInput(root, digest));
      const third = await daemon.refactorRecord(root, recordInput(root, digest));

      expect(second.ok).toBe(true);
      expect(third.ok).toBe(true);
      expect((second.data as any).recommendationIds).toEqual([]);
      expect((third.data as any).recommendationIds).toEqual([]);
      expect((third.data as any).suppressed.every((entry: any) => entry.reasonCode === "duplicate-active-fingerprint")).toBe(true);
      expect((second.data as any).runId).not.toBe((first.data as any).runId);
      expect((third.data as any).runId).not.toBe((second.data as any).runId);

      const scanEvents = store.architectureEvents.filter((event) => event.source === "refactor_scan");
      expect(scanEvents).toHaveLength(3);
      expect(recordedRecommendations(store).map((record) => record.recommendationId)).toEqual(recordedIds);
    } finally {
      await daemon.stop();
    }
  });

  test("a re-detected fact whose prior record resolved links regressesFrom instead of overwriting it", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Recording App");
      const { digest } = registerAt(daemon, root);
      const first = await daemon.refactorRecord(root, recordInput(root, digest));
      const prior = ((first.data as any).recommendations as RecommendationV3[])[0]!;

      // The resolve gate refuses this category, so the resolved lifecycle state is appended
      // directly: the assertion under test is the planner's regression link, not the gate.
      const resolvedEvent = store.architectureEvents.at(-1)!;
      await store.appendArchitectureEvents({
        writer: "runtime-daemon",
        events: [{
          ...resolvedEvent,
          eventId: `${resolvedEvent.eventId}.resolved`,
          eventType: "architecture.recommendation.lifecycle",
          idempotencyKey: `${resolvedEvent.idempotencyKey}:resolved`,
          payload: {
            operations: [],
            recommendationRuns: [],
            recommendations: [{ ...prior, status: "resolved", updatedAt: "2026-09-03T08:30:00.000Z" }],
            feedback: [],
            waivers: []
          } as unknown as Json
        }]
      });

      const second = await daemon.refactorRecord(root, recordInput(root, digest));
      const regressed = ((second.data as any).recommendations as RecommendationV3[])
        .find((record) => record.fingerprint === prior.fingerprint);

      expect(regressed).toBeDefined();
      expect(regressed!.relations).toEqual({ regressesFrom: prior.recommendationId });
      expect(regressed!.recommendationId).not.toBe(prior.recommendationId);
    } finally {
      await daemon.stop();
    }
  });

  test("persists the measured baseline snapshot as a bound evidence item", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Recording App");
      const { digest, snapshot } = registerAt(daemon, root);

      const recorded = await daemon.refactorRecord(root, recordInput(root, digest));
      const recommendationIds = (recorded.data as any).recommendationIds as string[];

      const appended = store.architectureEvents.at(-1)!;
      const operations = (appended.payload as any).evidenceOperations as any[];
      expect(appended.payloadVersion).toBe("archcontext.architecture-evidence-lifecycle/v2");
      expect((appended.payload as any).evidenceItems).toBeUndefined();
      const snapshotCreate = operations.find((operation) =>
        operation.target === "item" && operation.value.selector.kind === "snapshot"
      );
      expect(snapshotCreate).toBeDefined();
      expect(snapshotCreate.action).toBe("create");
      expect(snapshotCreate.value.selector.id).toBe(snapshot.snapshotDigest);
      expect(snapshotCreate.value.extensions.moduleStatisticsSnapshot.snapshotDigest).toBe(snapshot.snapshotDigest);

      // Bindings are emitted sorted by `bindingId` (a digest), so position carries no meaning:
      // assert the whole snapshot-bound set instead of whichever binding happens to sort first.
      const bindings = operations.filter((operation) =>
        operation.target === "binding"
        && operation.action === "create"
        && operation.value.evidenceId === snapshotCreate.value.evidenceId
      );
      expect(bindings.length).toBe(recommendationIds.length);
      for (const bound of bindings) expect(bound.value.target.kind).toBe("recommendation");
      expect(new Set(bindings.map((bound) => bound.value.target.id))).toEqual(new Set(recommendationIds));
    } finally {
      await daemon.stop();
    }
  });

  test("fills the acceptance test a structural observation would be closed by", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Recording App");
      const { digest } = registerAt(daemon, root);

      const recorded = await daemon.refactorRecord(root, recordInput(root, digest));
      const observations = ((recorded.data as any).recommendations as RecommendationV3[])
        .filter((record) => record.category === "structural_observation");

      expect(observations.length).toBeGreaterThan(0);
      for (const record of observations) {
        const payload = record.payload as { kind: string; affectedNodeIds: string[]; derivedOutcomes: any[] };
        // The engine records the fact and leaves the outcome derivation to refactor-assessment; a
        // record without it could never leave `open` because verify would have nothing to measure.
        expect(payload.derivedOutcomes).toEqual(deriveObservationOutcomes({
          kind: payload.kind as never,
          subjectSelectorId: record.subjectSelectorId,
          affectedNodeIds: payload.affectedNodeIds
        }));
        expect(recommendationV3InvariantIssues(record)).toEqual([]);
      }
    } finally {
      await daemon.stop();
    }
  });

  test("an unknown or evicted assessment digest fails closed", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Recording App");
      const missing = digestJson({ assessment: "never-registered" } as unknown as Json);

      const result = await daemon.refactorRecord(root, recordInput(root, missing));

      expect(result.ok).toBe(false);
      expect(errorOf(result).code).toBe("AC_SCHEMA_INVALID");
      expect(errorOf(result).message).toContain("refactor scan again");
      expect(store.architectureEvents).toHaveLength(0);
    } finally {
      await daemon.stop();
    }
  });

  test("a worktree that moved after the scan is stale, not recorded", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Recording App");
      const { digest } = registerAt(daemon, root);
      const staleDigest = computeWorktreeDigest(root);
      writeFileSync(join(root, "moved.ts"), "export const moved = 1;\n", "utf8");
      commitAll(root, "move the worktree");

      const result = await daemon.refactorRecord(root, { assessmentDigest: digest, expectedWorktreeDigest: staleDigest });

      expect(result.ok).toBe(false);
      expect(errorOf(result).code).toBe("AC_REFACTOR_STALE");
      expect(store.architectureEvents).toHaveLength(0);
    } finally {
      await daemon.stop();
    }
  });

  test("an assessment measured at another HEAD is stale even when the worktree matches", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Recording App");
      const { snapshot, assessment, proposal } = measured();
      const digest = daemon.registerRefactorAssessment({
        snapshot,
        assessment,
        ...(proposal ? { proposal } : {}),
        headSha: "0000000000000000000000000000000000000000",
        worktreeDigest: computeWorktreeDigest(root)
      });

      const result = await daemon.refactorRecord(root, recordInput(root, digest));

      expect(result.ok).toBe(false);
      expect(errorOf(result).code).toBe("AC_REFACTOR_STALE");
      expect(store.architectureEvents).toHaveLength(0);
    } finally {
      await daemon.stop();
    }
  });

  test("a self-authored proposal is rejected as unauthored", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Recording App");
      const { snapshot, assessment, proposal } = measured({
        request: makeRequest({ proposal: makeProposal({ scopePaths: ["src/m/a/x.ts"] }) })
      });
      const digest = daemon.registerRefactorAssessment({
        snapshot,
        assessment,
        proposal: { ...proposal!, authoredBy: { kind: "daemon", id: "archctxd", source: "daemon" } },
        headSha: gitOut(root, "rev-parse", "HEAD"),
        worktreeDigest: computeWorktreeDigest(root)
      });

      const result = await daemon.refactorRecord(root, recordInput(root, digest));

      expect(result.ok).toBe(false);
      expect(errorOf(result).code).toBe("AC_REFACTOR_PROPOSAL_UNAUTHORED");
      expect(store.architectureEvents).toHaveLength(0);
    } finally {
      await daemon.stop();
    }
  });

  test("a snapshot that no longer binds its assessment is rejected", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Recording App");
      const { snapshot, assessment } = measured();
      const digest = daemon.registerRefactorAssessment({
        snapshot: makeSnapshot(),
        assessment,
        headSha: gitOut(root, "rev-parse", "HEAD"),
        worktreeDigest: computeWorktreeDigest(root)
      });
      expect(snapshot.snapshotDigest).not.toBe(makeSnapshot().snapshotDigest);

      const result = await daemon.refactorRecord(root, recordInput(root, digest));

      expect(result.ok).toBe(false);
      expect(errorOf(result).code).toBe("AC_SCHEMA_INVALID");
      expect(store.architectureEvents).toHaveLength(0);
    } finally {
      await daemon.stop();
    }
  });
});

describe("recommendations resolve gate", () => {
  test("a non-practice v3 record cannot resolve with or without an evidence digest", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Recording App");
      const { digest } = registerAt(daemon, root);
      const recorded = await daemon.refactorRecord(root, recordInput(root, digest));
      const recommendationId = ((recorded.data as any).recommendationIds as string[])[0]!;

      const missing = await daemon.recommendations(root, {
        command: "resolve",
        recommendationId,
        reason: "resolved after the structural change landed",
        now: "2026-09-03T09:00:00.000Z"
      });
      expect(missing.ok).toBe(false);
      expect(errorOf(missing).code).toBe("AC_REFACTOR_EVIDENCE_REQUIRED");
      expect(errorOf(missing).reasonCode).toBe("evidence-digest-missing");

      // RF4 replaced the always-reject arm with the evidence lookup: an unrecorded digest is
      // now `evidence-unknown`, and no digest RF3 ever wrote can pass it.
      const supplied = await daemon.recommendations(root, {
        command: "resolve",
        recommendationId,
        reason: "resolved after the structural change landed",
        evidenceDigest: digestJson({ evidence: "never-verified" } as unknown as Json),
        now: "2026-09-03T09:01:00.000Z"
      });
      expect(supplied.ok).toBe(false);
      expect(errorOf(supplied).code).toBe("AC_REFACTOR_EVIDENCE_REQUIRED");
      expect(errorOf(supplied).reasonCode).toBe("evidence-unknown");
      expect(errorOf(supplied).message).toContain("refactor verify");

      const accepted = await daemon.recommendations(root, {
        command: "accept",
        recommendationId,
        reason: "accepted for planning",
        now: "2026-09-03T09:02:00.000Z"
      });
      expect(accepted.ok).toBe(true);
      expect((accepted.data as any).nextStatus).toBe("accepted");
    } finally {
      await daemon.stop();
    }
  });

  test("a practice recommendation resolves only after the v3 migration", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Recording App");
      const seeded = await seedV2Practice(store, root, "2026-09-03T07:50:00.000Z");

      const beforeMigration = await daemon.recommendations(root, {
        command: "resolve",
        recommendationId: seeded.recommendationId,
        reason: "resolved after the practice was adopted",
        now: "2026-09-03T09:03:00.000Z"
      });
      expect(beforeMigration.ok).toBe(false);
      expect(errorOf(beforeMigration).code).toBe("AC_PRECONDITION_FAILED");
      expect(errorOf(beforeMigration).message).toContain("ledger migrate --recommendation-v3");

      const migrated = await daemon.ledgerMigrate(root, {
        recommendationV3: true,
        dryRun: false,
        expectedWorktreeDigest: computeWorktreeDigest(root)
      });
      expect(migrated.ok).toBe(true);
      expect((migrated.data as any).upgradedCount).toBe(1);

      const resolved = await daemon.recommendations(root, {
        command: "resolve",
        recommendationId: seeded.recommendationId,
        reason: "resolved after the practice was adopted",
        now: "2026-09-03T09:04:00.000Z"
      });
      expect(resolved.ok).toBe(true);
      expect((resolved.data as any).nextStatus).toBe("resolved");
      expect((resolved.data as any).recommendation.schemaVersion).toBe(RECOMMENDATION_V3_SCHEMA_VERSION);
    } finally {
      await daemon.stop();
    }
  });
});

describe("ledger migrate --recommendation-v3", () => {
  test("rejects both mode flags and requires one", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Recording App");

      const both = await daemon.ledgerMigrate(root, { fromYaml: true, recommendationV3: true });
      expect(both.ok).toBe(false);
      expect(errorOf(both).message).toContain("not both");

      const neither = await daemon.ledgerMigrate(root, {});
      expect(neither.ok).toBe(false);
      expect(errorOf(neither).message).toContain("--recommendation-v3");
    } finally {
      await daemon.stop();
    }
  });

  test("keeps the rebuilt graphDigest identical and appends nothing on a second run", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Recording App");
      await seedV2Practice(store, root, "2026-09-03T07:51:00.000Z");

      const before = await daemon.ledgerRebuild(root, {
        fromGit: true,
        expectedWorktreeDigest: computeWorktreeDigest(root)
      });
      expect(before.ok).toBe(true);
      const beforeDigest = (before.data as any).graphDigest as string;

      const migrated = await daemon.ledgerMigrate(root, {
        recommendationV3: true,
        dryRun: false,
        expectedWorktreeDigest: computeWorktreeDigest(root)
      });
      expect(migrated.ok).toBe(true);
      expect((migrated.data as any).status).toBe("verified");
      expect((migrated.data as any).append.appendedEventCount).toBe(1);
      const migrationEvent = store.architectureEvents.find((event) => event.source === "migration")!;
      expect((migrationEvent.payload as any).operations).toEqual([]);
      expect((migrationEvent.payload as any).recommendations[0].schemaVersion).toBe(RECOMMENDATION_V3_SCHEMA_VERSION);

      const after = await daemon.ledgerRebuild(root, {
        fromGit: true,
        expectedWorktreeDigest: computeWorktreeDigest(root)
      });
      expect(after.ok).toBe(true);
      expect((after.data as any).graphDigest).toBe(beforeDigest);

      const secondMigration = await daemon.ledgerMigrate(root, {
        recommendationV3: true,
        dryRun: false,
        expectedWorktreeDigest: computeWorktreeDigest(root)
      });
      expect(secondMigration.ok).toBe(true);
      expect((secondMigration.data as any).upgradedCount).toBe(0);
      expect((secondMigration.data as any).status).toBe("up-to-date");
      expect((secondMigration.data as any).append.appendedEventCount).toBe(0);
      expect(store.architectureEvents.filter((event) => event.source === "migration")).toHaveLength(1);
    } finally {
      await daemon.stop();
    }
  });

  test("migrates a practice recommendation that already has feedback rows", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Recording App");
      const seeded = await seedV2Practice(store, root, "2026-09-03T07:53:00.000Z");

      const acknowledged = await daemon.recommendations(root, {
        command: "acknowledge",
        recommendationId: seeded.recommendationId,
        reason: "acknowledged before the v3 migration",
        now: "2026-09-03T07:54:00.000Z"
      });
      expect(acknowledged.ok).toBe(true);

      // The migration re-persists a recommendation row that recommendation_feedback references
      // ON DELETE RESTRICT; a delete-then-insert materializer fails the foreign key here.
      const migrated = await daemon.ledgerMigrate(root, {
        recommendationV3: true,
        dryRun: false,
        expectedWorktreeDigest: computeWorktreeDigest(root)
      });

      expect(migrated.ok).toBe(true);
      expect((migrated.data as any).upgradedCount).toBe(1);
      expect((migrated.data as any).status).toBe("verified");
      const upgraded = recordedRecommendations(store).at(-1)!;
      expect(upgraded.schemaVersion).toBe(RECOMMENDATION_V3_SCHEMA_VERSION);
      expect(upgraded.status).toBe("acknowledged");
    } finally {
      await daemon.stop();
    }
  });

  test("a dry run reports the plan without writing", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Recording App");
      await seedV2Practice(store, root, "2026-09-03T07:52:00.000Z");
      const eventCount = store.architectureEvents.length;

      const planned = await daemon.ledgerMigrate(root, { recommendationV3: true, dryRun: true });

      expect(planned.ok).toBe(true);
      expect((planned.data as any).status).toBe("planned");
      expect((planned.data as any).writes).toBe("none");
      expect((planned.data as any).upgradedCount).toBe(1);
      expect(store.architectureEvents).toHaveLength(eventCount);
      expect(recordedRecommendations(store)[0]!.schemaVersion as string).toBe(RECOMMENDATION_SCHEMA_VERSION);
    } finally {
      await daemon.stop();
    }
  });
});
