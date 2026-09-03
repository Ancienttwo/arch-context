import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REFACTOR_PROPOSAL_SCHEMA_VERSION,
  digestJson,
  refactorProposalDigest,
  refactorResolutionEvidenceInvariantIssues,
  type ArchitectureWorktreeIdentityV1,
  type EvidenceBindingV1,
  type EvidenceItemV2,
  type Json,
  type JsonEnvelope,
  type ModuleStatisticsSnapshotV1,
  type RecommendationV3,
  type RefactorProposalV1,
  type RefactorTargetOutcomeV1
} from "@archcontext/contracts";
import { computeWorktreeDigest, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import type { ArchitectureLedgerScope } from "@archcontext/core/architecture-ledger";
import { planRecommendationRun, recommendationRunLedgerPayload } from "@archcontext/core/recommendation-engine";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { runtimeStatePaths } from "@archcontext/local-runtime/local-store-sqlite";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { assessRefactor } from "../../../core/refactor-assessment/src/index";
import { refactorResolutionOutcomeId } from "../../../core/refactor-assessment/src/resolution";
import {
  CYCLE_EDGES,
  MODEL,
  TRACKED_FILES,
  TRACKED_PATHS,
  digestOf,
  makeAssessmentInput,
  makeRequest,
  makeSnapshot
} from "../../../core/refactor-assessment/test/factories";
import { runRefactorVerify } from "../src/refactor-verify";
import { ArchctxRuntimeRpcServer, RuntimeRpcClient, createStartedDaemon } from "../src/index";

const PREVIOUS_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-refactor-verify-state-"));
process.env.ARCHCONTEXT_STATE_DIR = STATE_ROOT;

const roots: string[] = [];

afterAll(() => {
  if (PREVIOUS_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_STATE_DIR;
  for (const root of [...roots, STATE_ROOT]) rmSync(root, { recursive: true, force: true });
});

function createGitRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-refactor-verify-"));
  roots.push(root);
  writeFileSync(join(root, "README.md"), "# refactor verify fixture\n", "utf8");
  initializeArchContextModel(root, "Refactor Verify App");
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

function startDaemon(store: TestLocalStore, now = "2026-09-03T13:30:00.000Z") {
  return createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: store,
    clock: () => now
  });
}

function gitScopeOf(root: string): ArchitectureLedgerScope {
  const paths = runtimeStatePaths(root);
  return {
    repository: { repositoryId: repositoryFingerprint(root), storageRepositoryId: paths.storageRepositoryId },
    worktree: worktreeIdentity(root)
  };
}

function worktreeIdentity(root: string, overrides: Partial<ArchitectureWorktreeIdentityV1> = {}): ArchitectureWorktreeIdentityV1 {
  const paths = runtimeStatePaths(root);
  return {
    workspaceId: paths.workspaceId,
    storageWorkspaceId: paths.storageWorkspaceId,
    branch: gitOut(root, "branch", "--show-current") || "HEAD",
    headSha: gitOut(root, "rev-parse", "HEAD"),
    worktreeDigest: computeWorktreeDigest(root),
    ...overrides
  };
}

/**
 * A contract-valid module-statistics measurement carrying this repository's real identity.
 *
 * The RF2 factory graph is used deliberately: the fixture repository has no CodeGraph index, so a
 * live `refactor scan` there can only report `coverage: unknown`. Every `resolved` path below is
 * therefore driven through the same pure planner the daemon calls, over a measurement that is
 * complete — which is exactly the state a real indexed repository is in.
 */
function measuredSnapshot(
  root: string,
  importEdges: typeof CYCLE_EDGES | [],
  worktreeOverrides: Partial<ArchitectureWorktreeIdentityV1> = {}
): ModuleStatisticsSnapshotV1 {
  const worktree = worktreeIdentity(root, worktreeOverrides);
  const paths = runtimeStatePaths(root);
  return makeSnapshot({
    repository: { repositoryId: repositoryFingerprint(root), storageRepositoryId: paths.storageRepositoryId },
    worktree,
    importEdges,
    codeFacts: {
      version: "0.9.1",
      binaryDigest: digestOf("index-binary"),
      availability: "ready",
      indexedWorktreeDigest: worktree.worktreeDigest
    }
  });
}

const CYCLE_OUTCOME_DRAFT: Omit<RefactorTargetOutcomeV1, "outcomeId"> = {
  metric: "repositorySummary.crossModuleCycleCount",
  subjectSelectorId: "repository:repo.rf2",
  nodeId: null,
  operator: "less_than",
  value: 1,
  required: true
};

function cycleProposal(): RefactorProposalV1 {
  const authored: RefactorProposalV1 = {
    schemaVersion: REFACTOR_PROPOSAL_SCHEMA_VERSION,
    authoredBy: { kind: "subagent", id: "agent.refactor-planner", source: "subagent" },
    intent: "Break the cross-module cycle between component.a and module.c.",
    scopePaths: ["src/m/a/x.ts"],
    targetOutcomes: [{ ...CYCLE_OUTCOME_DRAFT, outcomeId: refactorResolutionOutcomeId(CYCLE_OUTCOME_DRAFT) }],
    killList: [],
    proposalDigest: ""
  };
  return { ...authored, proposalDigest: refactorProposalDigest(authored) };
}

/** Records the S1 proposal against the cycle baseline and returns the ledger record it produced. */
async function recordCycleProposal(
  daemon: Awaited<ReturnType<typeof startDaemon>>,
  root: string
): Promise<{ recommendation: RecommendationV3; before: ModuleStatisticsSnapshotV1 }> {
  const before = measuredSnapshot(root, CYCLE_EDGES);
  const assessed = assessRefactor(makeAssessmentInput({
    snapshot: before,
    request: makeRequest({ proposal: cycleProposal() })
  }));
  const digest = daemon.registerRefactorAssessment({
    snapshot: before,
    assessment: assessed.assessment,
    ...(assessed.proposal ? { proposal: assessed.proposal } : {}),
    headSha: gitOut(root, "rev-parse", "HEAD"),
    worktreeDigest: computeWorktreeDigest(root)
  });
  const recorded = await daemon.refactorRecord(root, { assessmentDigest: digest, expectedWorktreeDigest: computeWorktreeDigest(root) });
  expect(recorded.ok, JSON.stringify(recorded)).toBe(true);
  const recommendation = ((recorded.data as any).recommendations as RecommendationV3[])
    .find((record) => record.category === "refactor_proposal")!;
  expect(recommendation).toBeDefined();
  return { recommendation, before };
}

/** Runs the daemon's own planner over a chosen AFTER state and appends the resulting event. */
async function planAndAppendVerification(input: {
  store: TestLocalStore;
  root: string;
  recommendation: RecommendationV3;
  before: ModuleStatisticsSnapshotV1;
  after: ModuleStatisticsSnapshotV1;
  verifiedAt?: string;
}) {
  const scope = await input.store.resolveArchitectureLedgerScope(gitScopeOf(input.root));
  const replay = await input.store.replayArchitectureLedger({ ...scope, mode: "genesis" });
  const plan = runRefactorVerify({
    recommendation: input.recommendation,
    repository: scope.repository,
    worktree: scope.worktree,
    beforeSnapshotDigest: input.before.snapshotDigest,
    beforeSnapshot: input.before,
    afterSnapshot: input.after,
    afterModel: MODEL,
    afterTrackedFiles: TRACKED_PATHS,
    evidenceState: replay.evidenceState,
    graphDigest: replay.graphDigest,
    verifiedAt: input.verifiedAt ?? "2026-09-03T14:00:00.000Z"
  });
  await input.store.appendArchitectureEvents({ writer: "runtime-daemon", events: [plan.event] });
  return plan;
}

function errorOf(envelope: JsonEnvelope): { code: string; message: string; reasonCode?: string } {
  return (envelope as { error?: { code: string; message: string; reasonCode?: string } }).error!;
}

function resolutionEventCount(store: TestLocalStore): number {
  return store.architectureEvents.filter((event) => event.eventType === "architecture.refactor.resolution").length;
}

/** Seeds one v2 practice recommendation so the practice ingress arm has a real record to refuse. */
async function seedV2Practice(store: TestLocalStore, root: string, now: string) {
  const scope = gitScopeOf(root);
  const plan = planRecommendationRun({
    repository: scope.repository,
    worktree: scope.worktree,
    triggerSource: "checkpoint",
    policyMode: "advisory",
    catalogDigest: digestJson({ fixture: "refactor-verify-catalog" } as unknown as Json),
    inputCursor: {
      source: "candidate-delta",
      headDigest: digestJson({ head: "refactor-verify" } as unknown as Json),
      headSha: scope.worktree.headSha
    },
    candidates: [{
      practiceId: "practice.runtime-boundary",
      subject: "module.runtime-ledger",
      confidence: "medium",
      enforcement: "advisory",
      evidenceBindingIds: ["binding.rf4.practice"],
      explanation: ["Practice recommendation seeded before the v3 migration."],
      baselineDigest: digestJson({ baseline: "refactor-verify" } as unknown as Json),
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
      repository: scope.repository,
      worktree: scope.worktree,
      baseDigest: graphDigest,
      resultingDigest: graphDigest,
      headSha: scope.worktree.headSha,
      actor: { kind: "daemon", id: "archctxd" },
      source: "checkpoint",
      timestamp: now,
      idempotencyKey: `architecture-ledger-recommendation-run:${plan.run.runId}`,
      provenance: { producer: "refactor-verify.test", command: "seedV2Practice", inputDigest },
      payload: recommendationRunLedgerPayload(plan) as unknown as Json
    }]
  });
  return plan.recommendations[0]!;
}

describe("daemon refactorVerify", () => {
  test("S4: a resolved verdict lets recommendations resolve succeed", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation, before } = await recordCycleProposal(daemon, root);

      const plan = await planAndAppendVerification({
        store,
        root,
        recommendation,
        before,
        after: measuredSnapshot(root, [])
      });

      expect(plan.evidence.disposition).toBe("resolved");
      expect(plan.evidence.recommendationId).toBe(recommendation.recommendationId);
      expect(plan.evidence.beforeSnapshotDigest).toBe(before.snapshotDigest);
      expect(plan.evidence.verifiedHeadSha).toBe(gitOut(root, "rev-parse", "HEAD"));
      expect(refactorResolutionEvidenceInvariantIssues(plan.evidence)).toEqual([]);
      expect(plan.event.eventType).toBe("architecture.refactor.resolution");
      expect(plan.event.source).toBe("refactor_scan");
      expect(plan.event.actor).toEqual({ kind: "daemon", id: "archctxd" });
      expect(plan.event.idempotencyKey).toBe(`refactor-resolution:${plan.evidence.resolutionDigest}`);
      expect(plan.event.baseDigest).toBe(plan.event.resultingDigest);
      expect((plan.event.payload as any).operations).toEqual([]);
      expect((plan.event.payload as any).evidenceItems).toBeUndefined();
      expect(plan.evidenceOperations.map((operation) => `${operation.target}:${operation.action}`))
        .toEqual(["item:create", "item:create", "binding:create"]);

      const resolved = await daemon.recommendations(root, {
        command: "resolve",
        recommendationId: recommendation.recommendationId,
        reason: "cross-module cycle removed and re-measured",
        evidenceDigest: plan.evidence.resolutionDigest,
        now: "2026-09-03T14:05:00.000Z"
      });

      expect(resolved.ok, JSON.stringify(resolved)).toBe(true);
      expect((resolved.data as any).nextStatus).toBe("resolved");
    } finally {
      await daemon.stop();
    }
  });

  test("book evidence <recommendationId> returns the resolution item and its binding", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation, before } = await recordCycleProposal(daemon, root);
      const plan = await planAndAppendVerification({ store, root, recommendation, before, after: measuredSnapshot(root, []) });

      const book = await daemon.book(root, { command: "evidence", id: recommendation.recommendationId });

      expect(book.ok, JSON.stringify(book)).toBe(true);
      const items = (book.data as any).evidenceItems as EvidenceItemV2[];
      const bindings = (book.data as any).evidenceBindings as EvidenceBindingV1[];
      const resolutionItem = items.find((item) => item.kind === "refactor-resolution-evidence")!;
      expect(resolutionItem).toBeDefined();
      expect(resolutionItem.evidenceId).toBe(plan.resolutionItem.evidenceId);
      expect(resolutionItem.strength).toBe("verified");
      expect(resolutionItem.supports).toEqual(["recommendation", "complete"]);
      expect((resolutionItem.extensions as any).refactorResolution.resolutionDigest).toBe(plan.evidence.resolutionDigest);
      const binding = bindings.find((candidate) => candidate.bindingId === plan.binding.bindingId)!;
      expect(binding).toBeDefined();
      expect(binding.schemaVersion).toBe("archcontext.evidence-binding/v1");
      expect(binding.target).toEqual({ kind: "recommendation", id: recommendation.recommendationId });
      expect(binding.authorityEffect).toBe("complete-eligible");
    } finally {
      await daemon.stop();
    }
  });

  test("measures the live HEAD, binds the persisted baseline, and appends exactly one event", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation, before } = await recordCycleProposal(daemon, root);

      const first = await daemon.refactorVerify(root, { recommendationId: recommendation.recommendationId });

      expect(first.ok, JSON.stringify(first)).toBe(true);
      const data = first.data as any;
      expect(data.schemaVersion).toBe("archcontext.runtime-refactor-verify/v1");
      expect(data.append.status).toBe("appended");
      expect(data.append.appendedEventCount).toBe(1);
      expect(data.evidence.verifiedHeadSha).toBe(gitOut(root, "rev-parse", "HEAD"));
      // The baseline `refactor record` persisted is found and bound, not re-measured.
      expect(data.evidence.beforeSnapshotDigest).toBe(before.snapshotDigest);
      // The fixture repository carries no CodeGraph index, so the honest verdict is that this
      // measurement decides nothing — never `resolved`.
      expect(data.disposition).toBe("stale");
      expect(data.resolveCommand).toBeNull();
      expect(data.evidence.residuals.map((residual: any) => residual.code)).toContain("after-coverage-incomplete");
      expect(resolutionEventCount(store)).toBe(1);

      const second = await daemon.refactorVerify(root, { recommendationId: recommendation.recommendationId });

      expect(second.ok, JSON.stringify(second)).toBe(true);
      expect((second.data as any).append.status).toBe("already-recorded");
      expect((second.data as any).append.appendedEventCount).toBe(0);
      expect((second.data as any).resolutionDigest).toBe(data.resolutionDigest);
      expect(resolutionEventCount(store)).toBe(1);
    } finally {
      await daemon.stop();
    }
  });

  test("a HEAD other than the one the caller claims is stale, and nothing is appended", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation } = await recordCycleProposal(daemon, root);

      const result = await daemon.refactorVerify(root, {
        recommendationId: recommendation.recommendationId,
        expectedHeadSha: "0".repeat(40)
      });

      expect(result.ok).toBe(false);
      expect(errorOf(result).code).toBe("AC_REFACTOR_STALE");
      expect(errorOf(result).message).toContain("expected HEAD");
      expect(resolutionEventCount(store)).toBe(0);
    } finally {
      await daemon.stop();
    }
  });

  test("an unknown recommendation id fails closed with no evidence written", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      await recordCycleProposal(daemon, root);

      const result = await daemon.refactorVerify(root, { recommendationId: "recommendation.never-recorded" });

      expect(result.ok).toBe(false);
      expect(errorOf(result).code).toBe("AC_SCHEMA_INVALID");
      expect(errorOf(result).message).toContain("recommendation not found");
      expect(resolutionEventCount(store)).toBe(0);
    } finally {
      await daemon.stop();
    }
  });

  test("a practice recommendation carries no measurable outcome and is refused", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const seeded = await seedV2Practice(store, root, "2026-09-03T13:00:00.000Z");
      const migrated = await daemon.ledgerMigrate(root, {
        recommendationV3: true,
        dryRun: false,
        expectedWorktreeDigest: computeWorktreeDigest(root)
      });
      expect(migrated.ok, JSON.stringify(migrated)).toBe(true);

      const result = await daemon.refactorVerify(root, { recommendationId: seeded.recommendationId });

      expect(result.ok).toBe(false);
      expect(errorOf(result).code).toBe("AC_SCHEMA_INVALID");
      expect(errorOf(result).message).toContain("practice recommendation");
      expect(resolutionEventCount(store)).toBe(0);
    } finally {
      await daemon.stop();
    }
  });

  test("a recommendation already resolved returns the recorded verdict and appends nothing", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation, before } = await recordCycleProposal(daemon, root);
      const plan = await planAndAppendVerification({ store, root, recommendation, before, after: measuredSnapshot(root, []) });
      const resolved = await daemon.recommendations(root, {
        command: "resolve",
        recommendationId: recommendation.recommendationId,
        reason: "cross-module cycle removed and re-measured",
        evidenceDigest: plan.evidence.resolutionDigest,
        now: "2026-09-03T14:05:00.000Z"
      });
      expect(resolved.ok, JSON.stringify(resolved)).toBe(true);
      const eventsBefore = store.architectureEvents.length;

      const result = await daemon.refactorVerify(root, { recommendationId: recommendation.recommendationId });

      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect((result.data as any).append.status).toBe("not-appended");
      expect((result.data as any).recommendationStatus).toBe("resolved");
      expect((result.data as any).resolutionDigest).toBe(plan.evidence.resolutionDigest);
      expect(store.architectureEvents).toHaveLength(eventsBefore);
    } finally {
      await daemon.stop();
    }
  });

  test("is reachable through the RuntimeRpcClient dispatch table", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    const rpc = new ArchctxRuntimeRpcServer(daemon, { root, port: 0, token: "refactor-verify-rpc-token" });
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation } = await recordCycleProposal(daemon, root);
      const connection = await rpc.start();
      const client = new RuntimeRpcClient(connection);

      const result = await client.refactorVerify(root, { recommendationId: recommendation.recommendationId });

      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect((result.data as any).schemaVersion).toBe("archcontext.runtime-refactor-verify/v1");
      expect((result.data as any).recommendationId).toBe(recommendation.recommendationId);
    } finally {
      await rpc.stop();
      await daemon.stop();
    }
  });

  test("rejects an ingress the daemon cannot honour", async () => {
    const root = createGitRepo();
    const daemon = await startDaemon(new TestLocalStore());
    try {
      await daemon.init(root, "Refactor Verify App");

      const missingId = await daemon.refactorVerify(root, {} as never);
      expect(missingId.ok).toBe(false);
      expect(errorOf(missingId).code).toBe("AC_SCHEMA_INVALID");
      expect(errorOf(missingId).message).toContain("recommendationId");

      const badRefs = await daemon.refactorVerify(root, { recommendationId: "x", executionEvidenceRefs: "nope" } as never);
      expect(badRefs.ok).toBe(false);
      expect(errorOf(badRefs).message).toContain("executionEvidenceRefs");
    } finally {
      await daemon.stop();
    }
  });

  test("an execution evidence ref carrying an unknown kind or an extra key is refused at the dispatch boundary", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation } = await recordCycleProposal(daemon, root);

      const smuggled = await daemon.refactorVerify(root, {
        recommendationId: recommendation.recommendationId,
        executionEvidenceRefs: [
          { kind: "not-a-real-kind", locator: "x", sha256: "a".repeat(64), rawDiff: "--- a/secrets.ts" }
        ]
      } as never);

      expect(smuggled.ok).toBe(false);
      expect(errorOf(smuggled).code).toBe("AC_SCHEMA_INVALID");
      // The extra key is named before the kind is even considered: a caller must learn which key
      // was rejected, not just that the payload was.
      expect(errorOf(smuggled).message).toContain("rawDiff");
      expect(resolutionEventCount(store)).toBe(0);

      const badKind = await daemon.refactorVerify(root, {
        recommendationId: recommendation.recommendationId,
        executionEvidenceRefs: [{ kind: "not-a-real-kind", locator: "x", sha256: "a".repeat(64) }]
      } as never);

      expect(badKind.ok).toBe(false);
      expect(errorOf(badKind).code).toBe("AC_SCHEMA_INVALID");
      expect(errorOf(badKind).message).toContain("not-a-real-kind");
      expect(errorOf(badKind).message).toContain("kind");
      expect(resolutionEventCount(store)).toBe(0);
    } finally {
      await daemon.stop();
    }
  });

  test("a well-formed execution evidence ref is persisted with exactly the three declared fields", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation } = await recordCycleProposal(daemon, root);

      const result = await daemon.refactorVerify(root, {
        recommendationId: recommendation.recommendationId,
        executionEvidenceRefs: [
          { kind: "acceptance_receipt", locator: "tasks/receipts/rf4.json", sha256: "b".repeat(64) }
        ]
      });

      expect(result.ok, JSON.stringify(result)).toBe(true);
      const refs = (result.data as any).evidence.executionEvidenceRefs;
      expect(refs).toHaveLength(1);
      expect(Object.keys(refs[0]).sort()).toEqual(["kind", "locator", "sha256"]);
      expect(refs[0]).toEqual({ kind: "acceptance_receipt", locator: "tasks/receipts/rf4.json", sha256: "b".repeat(64) });
      expect(resolutionEventCount(store)).toBe(1);
    } finally {
      await daemon.stop();
    }
  });
});

describe("recommendations resolve evidence lookup", () => {
  test("S6: a merged but unimproved verdict cannot resolve", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation, before } = await recordCycleProposal(daemon, root);
      const accepted = await daemon.recommendations(root, {
        command: "accept",
        recommendationId: recommendation.recommendationId,
        reason: "accepted for planning",
        now: "2026-09-03T13:40:00.000Z"
      });
      expect(accepted.ok, JSON.stringify(accepted)).toBe(true);

      // Merged, re-measured, and the cycle is still there.
      const plan = await planAndAppendVerification({
        store,
        root,
        recommendation,
        before,
        after: measuredSnapshot(root, CYCLE_EDGES)
      });
      expect(plan.evidence.disposition).toBe("not_improved");

      const result = await daemon.recommendations(root, {
        command: "resolve",
        recommendationId: recommendation.recommendationId,
        reason: "claiming the cycle is gone",
        evidenceDigest: plan.evidence.resolutionDigest,
        now: "2026-09-03T14:10:00.000Z"
      });

      expect(result.ok).toBe(false);
      expect(errorOf(result).code).toBe("AC_REFACTOR_EVIDENCE_REQUIRED");
      expect(errorOf(result).reasonCode).toBe("evidence-not-resolved");
      const status = await daemon.book(root, { command: "recommendations", openOnly: false });
      const record = ((status.data as any).recommendations as RecommendationV3[])
        .find((candidate) => candidate.recommendationId === recommendation.recommendationId)!;
      expect(record.status).toBe("accepted");
    } finally {
      await daemon.stop();
    }
  });

  test("a missing digest and an unrecorded digest are both refused", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation } = await recordCycleProposal(daemon, root);

      const missing = await daemon.recommendations(root, {
        command: "resolve",
        recommendationId: recommendation.recommendationId,
        reason: "no evidence supplied",
        now: "2026-09-03T14:20:00.000Z"
      });
      expect(missing.ok).toBe(false);
      expect(errorOf(missing).code).toBe("AC_REFACTOR_EVIDENCE_REQUIRED");
      expect(errorOf(missing).reasonCode).toBe("evidence-digest-missing");

      const unknown = await daemon.recommendations(root, {
        command: "resolve",
        recommendationId: recommendation.recommendationId,
        reason: "digest nobody verified",
        evidenceDigest: digestJson({ evidence: "never-verified" } as unknown as Json),
        now: "2026-09-03T14:21:00.000Z"
      });
      expect(unknown.ok).toBe(false);
      expect(errorOf(unknown).code).toBe("AC_REFACTOR_EVIDENCE_REQUIRED");
      expect(errorOf(unknown).reasonCode).toBe("evidence-unknown");
    } finally {
      await daemon.stop();
    }
  });

  test("a resolved verdict belonging to another recommendation is unknown, not accepted", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation, before } = await recordCycleProposal(daemon, root);
      const plan = await planAndAppendVerification({ store, root, recommendation, before, after: measuredSnapshot(root, []) });
      const observation = ((await daemon.book(root, { command: "recommendations", openOnly: true })).data as any)
        .recommendations
        .find((candidate: RecommendationV3) => candidate.category === "structural_observation") as RecommendationV3;

      const result = await daemon.recommendations(root, {
        command: "resolve",
        recommendationId: observation.recommendationId,
        reason: "borrowing another record's evidence",
        evidenceDigest: plan.evidence.resolutionDigest,
        now: "2026-09-03T14:30:00.000Z"
      });

      expect(result.ok).toBe(false);
      expect(errorOf(result).code).toBe("AC_REFACTOR_EVIDENCE_REQUIRED");
      expect(errorOf(result).reasonCode).toBe("evidence-unknown");
    } finally {
      await daemon.stop();
    }
  });

  test("a verdict measured at another HEAD is stale, even when it says resolved", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation, before } = await recordCycleProposal(daemon, root);

      const plan = await planAndAppendVerification({
        store,
        root,
        recommendation,
        before,
        after: measuredSnapshot(root, [], { headSha: "1".repeat(40) })
      });
      expect(plan.evidence.disposition).toBe("resolved");
      expect(plan.evidence.verifiedHeadSha).not.toBe(gitOut(root, "rev-parse", "HEAD"));

      const result = await daemon.recommendations(root, {
        command: "resolve",
        recommendationId: recommendation.recommendationId,
        reason: "resolving against a verdict from another commit",
        evidenceDigest: plan.evidence.resolutionDigest,
        now: "2026-09-03T14:40:00.000Z"
      });

      expect(result.ok).toBe(false);
      expect(errorOf(result).code).toBe("AC_REFACTOR_STALE");
      expect(errorOf(result).reasonCode).toBe("evidence-head-drift");
    } finally {
      await daemon.stop();
    }
  });

  test("a practice recommendation resolves without any refactor evidence", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const seeded = await seedV2Practice(store, root, "2026-09-03T13:00:00.000Z");
      await daemon.ledgerMigrate(root, {
        recommendationV3: true,
        dryRun: false,
        expectedWorktreeDigest: computeWorktreeDigest(root)
      });

      const resolved = await daemon.recommendations(root, {
        command: "resolve",
        recommendationId: seeded.recommendationId,
        reason: "practice adopted",
        now: "2026-09-03T14:50:00.000Z"
      });

      expect(resolved.ok, JSON.stringify(resolved)).toBe(true);
      expect((resolved.data as any).nextStatus).toBe("resolved");
    } finally {
      await daemon.stop();
    }
  });
});

describe("runRefactorVerify evidence shape", () => {
  test("reuses a snapshot evidence item the record already made live instead of rewriting it", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation, before } = await recordCycleProposal(daemon, root);

      // The AFTER state is byte-identical to the recorded baseline, so its evidence item id
      // collides with one the ledger already holds; `create` on a live id throws in the ledger.
      const plan = await planAndAppendVerification({ store, root, recommendation, before, after: before });

      expect(plan.afterSnapshotItem.provenance.command).toBe("archctx refactor record");
      expect(plan.evidenceOperations.map((operation) => `${operation.target}:${operation.action}`))
        .toEqual(["item:create", "binding:create"]);
      expect(TRACKED_FILES.length).toBeGreaterThan(0);
    } finally {
      await daemon.stop();
    }
  });
});
