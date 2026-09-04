import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EVIDENCE_BINDING_SCHEMA_VERSION,
  EVIDENCE_ITEM_SCHEMA_VERSION,
  REFACTOR_PROPOSAL_SCHEMA_VERSION,
  REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
  digestJson,
  refactorProposalDigest,
  refactorResolutionEvidenceInvariantIssues,
  type ArchitectureWorktreeIdentityV1,
  type ArchitectureEventV1,
  type EvidenceBindingV1,
  type EvidenceItemV2,
  type EvidenceStateAtCursorV1,
  type Json,
  type JsonEnvelope,
  type ModuleStatisticsSnapshotV1,
  type RecommendationV3,
  type RefactorProposalV1,
  type RefactorResolutionEvidenceV1,
  type RefactorTargetOutcomeV1
} from "@archcontext/contracts";
import { computeWorktreeDigest, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { ARCHITECTURE_EVIDENCE_LIFECYCLE_PAYLOAD_VERSION } from "@archcontext/core/architecture-ledger";
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
  digestOf,
  makeAssessmentInput,
  makeRequest,
  makeSnapshot
} from "../../../core/refactor-assessment/test/factories";
import { evidenceLifecycleOperations } from "../src/refactor-recording";
import { baselineSnapshotForRecommendation, resolutionEvidenceItems, runRefactorVerify } from "../src/refactor-verify";
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

interface VerificationInput {
  store: TestLocalStore;
  root: string;
  recommendation: RecommendationV3;
  before: ModuleStatisticsSnapshotV1;
  after: ModuleStatisticsSnapshotV1;
  verifiedAt?: string;
}

/** Runs the daemon's own planner over a chosen AFTER state, without persisting anything. */
async function planVerification(input: VerificationInput) {
  const scope = await input.store.resolveArchitectureLedgerScope(gitScopeOf(input.root));
  const replay = await input.store.replayArchitectureLedger({ ...scope, mode: "genesis" });
  return runRefactorVerify({
    recommendation: input.recommendation,
    repository: scope.repository,
    worktree: scope.worktree,
    beforeSnapshotDigest: input.before.snapshotDigest,
    beforeSnapshot: input.before,
    afterSnapshot: input.after,
    afterModel: MODEL,
    afterTrackedFiles: TRACKED_FILES,
    evidenceState: replay.evidenceState,
    graphDigest: replay.graphDigest,
    verifiedAt: input.verifiedAt ?? "2026-09-03T14:00:00.000Z"
  });
}

/** Plans one verification and appends the event it produced. */
async function planAndAppendVerification(input: VerificationInput) {
  const plan = await planVerification(input);
  await input.store.appendArchitectureEvents({ writer: "runtime-daemon", events: [plan.event] });
  return plan;
}

/**
 * Persists one resolution verdict through the same item/binding builder a real verification uses,
 * so a forged body reaches the ledger in exactly the shape the resolve gate reads.
 */
async function appendResolutionEvidence(input: {
  store: TestLocalStore;
  root: string;
  evidence: RefactorResolutionEvidenceV1;
  afterSnapshot: ModuleStatisticsSnapshotV1;
  rebind?: (binding: EvidenceBindingV1) => EvidenceBindingV1;
}): Promise<void> {
  const scope = await input.store.resolveArchitectureLedgerScope(gitScopeOf(input.root));
  const replay = await input.store.replayArchitectureLedger({ ...scope, mode: "genesis" });
  const items = resolutionEvidenceItems({
    evidence: input.evidence,
    afterSnapshot: input.afterSnapshot,
    repository: scope.repository,
    evidenceState: replay.evidenceState
  });
  const binding = input.rebind ? input.rebind(items.binding) : items.binding;
  const operations = evidenceLifecycleOperations(
    replay.evidenceState,
    [items.resolutionItem, items.afterSnapshotItem],
    [binding]
  );
  const inputDigest = digestJson({ forged: items.resolutionItem.evidenceId, binding: binding.bindingId } as unknown as Json);
  const event: ArchitectureEventV1 = {
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: `architecture_event.refactor_resolution.${inputDigest.replace(/^sha256:/, "").slice(0, 16)}`,
    eventType: "architecture.refactor.resolution",
    payloadVersion: ARCHITECTURE_EVIDENCE_LIFECYCLE_PAYLOAD_VERSION,
    repository: scope.repository,
    worktree: scope.worktree,
    baseDigest: replay.graphDigest,
    resultingDigest: replay.graphDigest,
    headSha: scope.worktree.headSha,
    actor: { kind: "daemon", id: "archctxd" },
    source: "refactor_scan",
    timestamp: input.evidence.verifiedAt,
    idempotencyKey: `refactor-resolution:${inputDigest}`,
    provenance: { producer: "runtime-daemon", command: "refactor-verify.test", inputDigest },
    payload: {
      recommendationRuns: [],
      recommendations: [],
      feedback: [],
      waivers: [],
      operations: [],
      evidenceOperations: operations as unknown as Json,
      title: "Refactor resolution verification",
      summary: "Hand-persisted resolution evidence."
    } as unknown as Json
  };
  await input.store.appendArchitectureEvents({ writer: "runtime-daemon", events: [event] });
}

/**
 * Mutates the working tree on a chosen `beginSnapshot` call. `openSession` reads HEAD before it
 * opens a snapshot, so this fires inside one identity read and is observed only by the next one.
 */
class MutatingSnapshotLocalStore extends TestLocalStore {
  mutateOnSnapshotCall: number | undefined;
  mutate: (() => void) | undefined;
  private snapshotCalls = 0;

  override async beginSnapshot(snapshot: Parameters<TestLocalStore["beginSnapshot"]>[0]) {
    this.snapshotCalls += 1;
    if (this.mutateOnSnapshotCall !== undefined && this.snapshotCalls === this.mutateOnSnapshotCall) {
      this.mutateOnSnapshotCall = undefined;
      this.snapshotCalls = 0;
      this.mutate?.();
    }
    return super.beginSnapshot(snapshot);
  }

  /** Re-arms the counter for the next command; each RPC opens its own sessions. */
  armForNextCommand(call: number, mutate: () => void): void {
    this.snapshotCalls = 0;
    this.mutateOnSnapshotCall = call;
    this.mutate = mutate;
  }
}

/** One snapshot evidence item bound to `recommendation.rf4`, exactly as `refactor record` binds it. */
function baselineState(snapshot: ModuleStatisticsSnapshotV1): EvidenceStateAtCursorV1 {
  const evidenceId = "evidence.module_statistics_snapshot.baseline";
  const item: EvidenceItemV2 = {
    schemaVersion: EVIDENCE_ITEM_SCHEMA_VERSION,
    evidenceId,
    kind: "module-statistics-snapshot",
    strength: "observed",
    polarity: "positive",
    origin: "runtime-daemon",
    subject: "repository:repo.rf2",
    selector: { kind: "snapshot", id: snapshot.snapshotDigest },
    summary: "baseline",
    coverage: { level: snapshot.codeFacts.coverage, scope: "module-statistics-snapshot" },
    supports: ["recommendation"],
    provenance: { producer: "runtime-daemon", command: "archctx refactor record", inputDigest: snapshot.snapshotDigest },
    createdAt: snapshot.createdAt,
    digest: digestJson({ evidenceId } as unknown as Json),
    extensions: { moduleStatisticsSnapshot: snapshot as unknown as Json }
  };
  return {
    schemaVersion: "archcontext.evidence-state-at-cursor/v1",
    evidenceItems: [item],
    evidenceBindings: [{
      schemaVersion: EVIDENCE_BINDING_SCHEMA_VERSION,
      bindingId: "binding.baseline",
      evidenceId,
      target: { kind: "recommendation", id: "recommendation.rf4" },
      bindingReason: "deterministic-check",
      authorityEffect: "complete-eligible",
      createdAt: snapshot.createdAt,
      provenance: { producer: "runtime-daemon", command: "archctx refactor record", inputDigest: evidenceId }
    }],
    tombstones: [],
    stateDigest: digestJson({ state: "baseline" } as unknown as Json)
  };
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

      const recordedWorktree = worktreeIdentity(root);
      writeFileSync(join(root, "README.md"), "# completed cutover\n");
      commitAll(root, "complete cutover after recommendation recording");
      const finalWorktree = worktreeIdentity(root);
      expect(finalWorktree.headSha).not.toBe(recordedWorktree.headSha);

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
      const book = await daemon.book(root, { command: "recommendations" });
      expect(book.ok).toBe(true);
      const data = book.data as any;
      expect(data.recommendations.find((entry: RecommendationV3) => entry.recommendationId === recommendation.recommendationId).status).toBe("resolved");
      expect(data.freshness.worktree).toEqual(finalWorktree);
      expect(data.freshness.headSha).toBe(finalWorktree.headSha);
      expect(data.freshness.worktreeDigest).toBe(finalWorktree.worktreeDigest);
      expect(data.provenance.headSha).toBe(recordedWorktree.headSha);
      expect(data.provenance.worktreeDigest).toBe(recordedWorktree.worktreeDigest);

      writeFileSync(join(root, "README.md"), "# uncommitted follow-up\n");
      const dirtyBook = await daemon.book(root, { command: "recommendations" });
      expect((dirtyBook.data as any).freshness.worktree).toEqual(worktreeIdentity(root));
      expect((dirtyBook.data as any).freshness.worktreeDigest).not.toBe(finalWorktree.worktreeDigest);
      expect((dirtyBook.data as any).provenance).toEqual(data.provenance);
      const historical = await daemon.book(root, { command: "evidence", id: recommendation.recommendationId });
      expect((historical.data as any).freshness.worktree).toEqual(recordedWorktree);
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

      const recordedHead = gitOut(root, "rev-parse", "HEAD");
      writeFileSync(join(root, "README.md"), "# advanced verification HEAD\n", "utf8");
      commitAll(root, "advance HEAD after recommendation recording");
      const liveWorktree = worktreeIdentity(root);
      expect(liveWorktree.headSha).not.toBe(recordedHead);

      const first = await daemon.refactorVerify(root, { schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION, recommendationId: recommendation.recommendationId });

      expect(first.ok, JSON.stringify(first)).toBe(true);
      const data = first.data as any;
      expect(data.schemaVersion).toBe("archcontext.runtime-refactor-verify/v1");
      expect(data.append.status).toBe("appended");
      expect(data.append.appendedEventCount).toBe(1);
      expect(data.worktree).toEqual(liveWorktree);
      expect(data.evidence.verifiedHeadSha).toBe(gitOut(root, "rev-parse", "HEAD"));
      // The baseline `refactor record` persisted is found and bound, not re-measured.
      expect(data.evidence.beforeSnapshotDigest).toBe(before.snapshotDigest);
      // The fixture repository carries no CodeGraph index, so the honest verdict is that this
      // measurement decides nothing — never `resolved`. A daemon-level `resolved` is unreachable
      // from a test: `runRefactorScan` reads its code facts from the on-disk `.codegraph` index and
      // the real `codegraph` binary, not from the injectable `codeGraphProviderFactory`, so the
      // complete-coverage path stays covered by the planner-level S4 test above.
      expect(data.disposition).toBe("stale");
      expect(data.resolveCommand).toBeNull();
      expect(data.evidence.residuals.map((residual: any) => residual.code)).toContain("after-coverage-incomplete");
      expect(resolutionEventCount(store)).toBe(1);
      const event = store.architectureEvents.find((event) => event.eventType === "architecture.refactor.resolution")!;
      // The event stays in the recommendation's ledger partition across Git commits.
      expect(event.headSha).toBe(recordedHead);

      const second = await daemon.refactorVerify(root, { schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION, recommendationId: recommendation.recommendationId });

      expect(second.ok, JSON.stringify(second)).toBe(true);
      expect((second.data as any).append.status).toBe("already-recorded");
      expect((second.data as any).worktree).toEqual(liveWorktree);
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
        schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
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

      const result = await daemon.refactorVerify(root, { schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION, recommendationId: "recommendation.never-recorded" });

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

      const result = await daemon.refactorVerify(root, { schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION, recommendationId: seeded.recommendationId });

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
      writeFileSync(join(root, "README.md"), "# advanced terminal HEAD\n", "utf8");
      commitAll(root, "advance HEAD after resolution");

      const result = await daemon.refactorVerify(root, { schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION, recommendationId: recommendation.recommendationId });

      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect((result.data as any).append.status).toBe("not-appended");
      expect((result.data as any).recommendationStatus).toBe("resolved");
      expect((result.data as any).worktree).toEqual(worktreeIdentity(root));
      expect((result.data as any).evidence.verifiedHeadSha).toBe(plan.evidence.verifiedHeadSha);
      expect((result.data as any).evidence.verifiedHeadSha).not.toBe(worktreeIdentity(root).headSha);
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

      const result = await client.refactorVerify(root, { schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION, recommendationId: recommendation.recommendationId });

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

      const badRefs = await daemon.refactorVerify(root, {
        schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
        recommendationId: "x",
        executionEvidenceRefs: "nope"
      } as never);
      expect(badRefs.ok).toBe(false);
      expect(errorOf(badRefs).message).toContain("executionEvidenceRefs");

      // RF5b made the RPC ingress the frozen contract type, so a request that names no schema
      // version is refused before anything measures on its behalf.
      const noSchemaVersion = await daemon.refactorVerify(root, { recommendationId: "recommendation.x" } as never);
      expect(noSchemaVersion.ok).toBe(false);
      expect(errorOf(noSchemaVersion).code).toBe("AC_SCHEMA_INVALID");
      expect(errorOf(noSchemaVersion).message).toContain("schemaVersion");

      // The contract invariants run over the rebuilt request, so a claim the daemon would later
      // compare against a real Git identity is rejected at ingress rather than at comparison time.
      const badHeadSha = await daemon.refactorVerify(root, {
        schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
        recommendationId: "recommendation.x",
        expectedHeadSha: "not-a-sha"
      });
      expect(badHeadSha.ok).toBe(false);
      expect(errorOf(badHeadSha).code).toBe("AC_SCHEMA_INVALID");
      expect(errorOf(badHeadSha).message).toContain("expectedHeadSha");
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
        schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
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
        schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
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

  test("an unbounded locator is refused at the dispatch boundary before anything is appended", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation } = await recordCycleProposal(daemon, root);

      // The locator is the one free-text field on a record whose envelope promises
      // `privacy.rawDiffPersisted: false`, so a body parked in it must not reach the ledger.
      const rawDiffLocator = await daemon.refactorVerify(root, {
        schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
        recommendationId: recommendation.recommendationId,
        executionEvidenceRefs: [
          { kind: "task_contract", locator: "--- a/secrets.ts\n+const key = 'AKIA';", sha256: "a".repeat(64) }
        ]
      });
      expect(rawDiffLocator.ok).toBe(false);
      expect(errorOf(rawDiffLocator).code).toBe("AC_SCHEMA_INVALID");
      expect(errorOf(rawDiffLocator).message).toContain("executionEvidenceRefs[0].locator");
      expect(errorOf(rawDiffLocator).message).toContain("bounded reference");
      expect(resolutionEventCount(store)).toBe(0);

      const tooLong = await daemon.refactorVerify(root, {
        schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
        recommendationId: recommendation.recommendationId,
        executionEvidenceRefs: [{ kind: "task_contract", locator: "a".repeat(257), sha256: "a".repeat(64) }]
      });
      expect(tooLong.ok).toBe(false);
      expect(errorOf(tooLong).code).toBe("AC_SCHEMA_INVALID");
      expect(errorOf(tooLong).message).toContain("bounded reference");
      expect(resolutionEventCount(store)).toBe(0);
    } finally {
      await daemon.stop();
    }
  });

  test("an unknown top-level request key is refused rather than dropped by the rebuild", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation } = await recordCycleProposal(daemon, root);

      // Without this the decoder rebuilds only the declared keys, so the typo removes the
      // freshness claim and the verification answers under a weaker precondition than it stated.
      const typo = await daemon.refactorVerify(root, {
        schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
        recommendationId: recommendation.recommendationId,
        expectedWorktreeDigset: `sha256:${"b".repeat(64)}`
      } as never);
      expect(typo.ok).toBe(false);
      expect(errorOf(typo).code).toBe("AC_SCHEMA_INVALID");
      expect(errorOf(typo).message).toContain("expectedWorktreeDigset");
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
        schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
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

  test("F1: an uncommitted edit at the same HEAD is worktree drift, and nothing is appended", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation, before } = await recordCycleProposal(daemon, root);
      const plan = await planAndAppendVerification({ store, root, recommendation, before, after: measuredSnapshot(root, []) });
      expect(plan.evidence.disposition).toBe("resolved");
      const verifiedHeadSha = plan.evidence.verifiedHeadSha;
      const eventsBefore = store.architectureEvents.length;

      // The uncommitted case a HEAD-only gate cannot see: the tree the verdict measured is gone,
      // but the commit it names is still checked out, so `verifiedHeadSha` still matches.
      const original = readFileSync(join(root, "README.md"), "utf8");
      writeFileSync(join(root, "README.md"), `${original}re-introduced without committing\n`, "utf8");
      expect(gitOut(root, "rev-parse", "HEAD")).toBe(verifiedHeadSha);
      expect(computeWorktreeDigest(root)).not.toBe(plan.evidence.verifiedWorktreeDigest);

      const drifted = await daemon.recommendations(root, {
        command: "resolve",
        recommendationId: recommendation.recommendationId,
        reason: "resolving against a verdict whose tree was edited without a commit",
        now: "2026-09-03T14:45:00.000Z",
        evidenceDigest: plan.evidence.resolutionDigest
      });

      expect(drifted.ok).toBe(false);
      expect(errorOf(drifted).code).toBe("AC_REFACTOR_STALE");
      expect(errorOf(drifted).reasonCode).toBe("evidence-worktree-drift");
      expect(store.architectureEvents).toHaveLength(eventsBefore);
      const blocked = await daemon.book(root, { command: "recommendations", openOnly: false });
      expect(((blocked.data as any).recommendations as RecommendationV3[])
        .find((candidate) => candidate.recommendationId === recommendation.recommendationId)!.status)
        .not.toBe("resolved");

      // Control: the edit is the only variable. Put the tree back and the same call succeeds.
      writeFileSync(join(root, "README.md"), original, "utf8");
      expect(computeWorktreeDigest(root)).toBe(plan.evidence.verifiedWorktreeDigest);

      const resolved = await daemon.recommendations(root, {
        command: "resolve",
        recommendationId: recommendation.recommendationId,
        reason: "resolving against the tree the verdict actually measured",
        now: "2026-09-03T14:46:00.000Z",
        evidenceDigest: plan.evidence.resolutionDigest
      });

      expect(resolved.ok, JSON.stringify(resolved)).toBe(true);
      expect((resolved.data as any).nextStatus).toBe("resolved");
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

describe("persisted evidence is re-proved on read", () => {
  test("a hand-written resolved verdict at the current HEAD is unknown, not evidence", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation, before } = await recordCycleProposal(daemon, root);
      const after = measuredSnapshot(root, CYCLE_EDGES);
      const honest = await planVerification({ store, root, recommendation, before, after });
      expect(honest.evidence.disposition).toBe("not_improved");

      // Same recommendation, same HEAD, same digest field; only the body was rewritten.
      const forged: RefactorResolutionEvidenceV1 = { ...honest.evidence, disposition: "resolved" };
      await appendResolutionEvidence({ store, root, evidence: forged, afterSnapshot: after });

      const result = await daemon.recommendations(root, {
        command: "resolve",
        recommendationId: recommendation.recommendationId,
        reason: "resolving on a hand-written verdict",
        evidenceDigest: forged.resolutionDigest,
        now: "2026-09-03T15:00:00.000Z"
      });

      expect(result.ok).toBe(false);
      expect(errorOf(result).code).toBe("AC_REFACTOR_EVIDENCE_REQUIRED");
      expect(errorOf(result).reasonCode).toBe("evidence-unknown");
    } finally {
      await daemon.stop();
    }
  });

  test("a self-consistent verdict bound without completion authority is unknown too", async () => {
    const root = createGitRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation, before } = await recordCycleProposal(daemon, root);
      const after = measuredSnapshot(root, []);
      const plan = await planVerification({ store, root, recommendation, before, after });
      expect(plan.evidence.disposition).toBe("resolved");

      // Single variable: the body is the daemon's own, only the binding's authority is downgraded.
      await appendResolutionEvidence({
        store,
        root,
        evidence: plan.evidence,
        afterSnapshot: after,
        rebind: (binding) => ({ ...binding, authorityEffect: "ranking" })
      });

      const result = await daemon.recommendations(root, {
        command: "resolve",
        recommendationId: recommendation.recommendationId,
        reason: "resolving on a verdict nobody bound to completion",
        evidenceDigest: plan.evidence.resolutionDigest,
        now: "2026-09-03T15:05:00.000Z"
      });

      expect(result.ok).toBe(false);
      expect(errorOf(result).reasonCode).toBe("evidence-unknown");
    } finally {
      await daemon.stop();
    }
  });

  test("a persisted baseline whose body does not bind its digest is refused as unverifiable", () => {
    const snapshot = makeSnapshot({ importEdges: CYCLE_EDGES });
    const tampered = {
      ...snapshot,
      repositorySummary: { ...snapshot.repositorySummary, moduleCount: 99 }
    } as ModuleStatisticsSnapshotV1;

    expect(baselineSnapshotForRecommendation(baselineState(snapshot), "recommendation.rf4"))
      .toEqual({ snapshotDigest: snapshot.snapshotDigest, snapshot });
    expect(baselineSnapshotForRecommendation(baselineState(tampered), "recommendation.rf4"))
      .toEqual({ snapshotDigest: snapshot.snapshotDigest, unverifiable: true });
  });
});

describe("recommendations resolve re-reads the tree before it appends", () => {
  test("F4: a tree that moves between the gate and the append is stale, and nothing is appended", async () => {
    const root = createGitRepo();
    const store = new MutatingSnapshotLocalStore();
    const daemon = await startDaemon(store);
    try {
      await daemon.init(root, "Refactor Verify App");
      const { recommendation, before } = await recordCycleProposal(daemon, root);
      const plan = await planAndAppendVerification({ store, root, recommendation, before, after: measuredSnapshot(root, []) });
      const eventsBefore = store.architectureEvents.length;

      // `openSession` reads HEAD before it opens a snapshot, so mutating on the pre-append read's
      // own snapshot call lands after the gate has read the whole identity and inside the re-read.
      // Arming the gate's call instead would be caught by the gate itself, which now compares the
      // worktree digest too, and this test would stop covering the pre-append path.
      store.armForNextCommand(3, () => {
        writeFileSync(join(root, "moved.ts"), "export const moved = 1;\n", "utf8");
        commitAll(root, "moved under the resolve");
      });

      const result = await daemon.recommendations(root, {
        command: "resolve",
        recommendationId: recommendation.recommendationId,
        reason: "resolving while the tree moves",
        evidenceDigest: plan.evidence.resolutionDigest,
        now: "2026-09-03T15:10:00.000Z"
      });

      expect(result.ok).toBe(false);
      expect(errorOf(result).code).toBe("AC_REFACTOR_STALE");
      expect(errorOf(result).reasonCode).toBe("evidence-head-drift");
      // Named so the gate's own drift refusal cannot be mistaken for this one, and the moved
      // half of the identity is named so the assertion cannot pass on the wrong movement.
      expect(errorOf(result).message).toContain("before the recommendations resolve append");
      expect(errorOf(result).message).toContain("worktreeDigest");
      expect(store.architectureEvents).toHaveLength(eventsBefore);
      const status = await daemon.book(root, { command: "recommendations", openOnly: false });
      expect(((status.data as any).recommendations as RecommendationV3[])
        .find((candidate) => candidate.recommendationId === recommendation.recommendationId)!.status)
        .not.toBe("resolved");
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
