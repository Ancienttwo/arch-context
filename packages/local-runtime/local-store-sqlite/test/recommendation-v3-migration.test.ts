import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync as nodeRmSync, type RmDirOptions } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RECOMMENDATION_SCHEMA_VERSION,
  RECOMMENDATION_V3_SCHEMA_VERSION,
  digestJson,
  recommendationV3InvariantIssues,
  type ArchitectureEventV1,
  type Json,
  type RecommendationV2,
  type RecommendationV3
} from "@archcontext/contracts";
import { planRecommendationV3Migration } from "../../runtime-daemon/src/refactor-recording";
import { LOCAL_SQLITE_MIGRATIONS, SqliteLocalStore } from "../src/index";

const SCOPE = {
  repository: {
    repositoryId: "repo.recommendation-v3-migration",
    storageRepositoryId: "repo.storage.recommendation-v3-migration"
  },
  worktree: {
    workspaceId: "workspace.recommendation-v3-migration",
    storageWorkspaceId: "workspace.storage.recommendation-v3-migration",
    branch: "main",
    headSha: "9f1c2d3e4a5b60718293a4b5c6d7e8f901234567",
    worktreeDigest: digestJson({ worktree: "recommendation-v3-migration" } as unknown as Json)
  }
};

function rmSync(path: string, options?: RmDirOptions): void {
  try {
    nodeRmSync(path, { maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100, ...options });
  } catch (error) {
    if (process.platform === "win32" && isTransientWindowsCleanupError(error)) return;
    throw error;
  }
}

function isTransientWindowsCleanupError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY";
}

const roots: string[] = [];
const stores: SqliteLocalStore[] = [];

afterAll(() => {
  for (const store of stores) store.close();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function createStore(): Promise<{ store: SqliteLocalStore; dbPath: string }> {
  const root = mkdtempSync(join(tmpdir(), "archctx-recommendation-v3-"));
  roots.push(root);
  const dbPath = join(root, "runtime.sqlite");
  const store = new SqliteLocalStore(dbPath);
  stores.push(store);
  await store.migrate();
  return { store, dbPath };
}

function v2Recommendation(overrides: Partial<RecommendationV2> = {}): RecommendationV2 {
  return {
    schemaVersion: RECOMMENDATION_SCHEMA_VERSION,
    recommendationId: "recommendation.v2fixture0000001",
    runId: "recommendation_run.v2fixture0001",
    fingerprint: digestJson({ fingerprint: "v2-fixture" } as unknown as Json),
    subject: "module.legacy-practice",
    practiceId: "practice.record-significant-change",
    status: "open",
    confidence: "high",
    enforcement: "checkpoint",
    risk: "medium",
    uncertainty: "low",
    evidenceBindingIds: [],
    explanation: ["A significant change needs a durable decision record."],
    createdAt: "2026-06-25T00:00:04.000Z",
    updatedAt: "2026-06-25T00:00:05.000Z",
    extensions: { baselineDigest: digestJson({ baseline: "v2-fixture" } as unknown as Json) },
    ...overrides
  };
}

function v2RunEvent(recommendations: readonly RecommendationV2[], graphDigest: string): ArchitectureEventV1 {
  const run = {
    schemaVersion: "archcontext.recommendation-run/v1",
    runId: recommendations[0]!.runId,
    repository: SCOPE.repository,
    worktree: SCOPE.worktree,
    trigger: { level: "L2", source: "checkpoint" },
    engineVersion: "archcontext.recommendation-scheduler/v1",
    catalogDigest: digestJson({ catalog: "v2-fixture" } as unknown as Json),
    inputDigest: digestJson({ input: "v2-fixture" } as unknown as Json),
    outputDigest: digestJson({ output: "v2-fixture" } as unknown as Json),
    policyMode: "advisory",
    status: "succeeded",
    startedAt: "2026-06-25T00:00:02.000Z",
    completedAt: "2026-06-25T00:00:03.000Z",
    recommendationIds: recommendations.map((recommendation) => recommendation.recommendationId),
    metrics: { matchCount: recommendations.length, evidenceBindingCount: 0, unboundEvidenceCount: recommendations.length }
  };
  return {
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: "architecture_event.recommendation_run.v2fixture",
    eventType: "architecture.recommendation.run",
    payloadVersion: "archcontext.recommendation-run/v1",
    repository: SCOPE.repository,
    worktree: SCOPE.worktree,
    baseDigest: graphDigest,
    resultingDigest: graphDigest,
    headSha: SCOPE.worktree.headSha,
    actor: { kind: "daemon", id: "archctxd" },
    source: "checkpoint",
    timestamp: "2026-06-25T00:00:03.000Z",
    idempotencyKey: "architecture-ledger-recommendation-run:v2-fixture",
    provenance: {
      producer: "recommendation-v3-migration.test",
      command: "bun test packages/local-runtime/local-store-sqlite/test/recommendation-v3-migration.test.ts",
      inputDigest: digestJson({ event: "v2-fixture" } as unknown as Json)
    },
    payload: {
      title: "Recommendation run",
      summary: "Fixture v2 recommendation run.",
      operations: [],
      recommendationRuns: [run],
      recommendations,
      feedback: [],
      waivers: []
    } as unknown as Json
  };
}

function recommendationRow(dbPath: string, recommendationId: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare(
      "SELECT recommendation_id, run_id, fingerprint, subject, practice_id, status, created_at, updated_at, recommendation_json FROM recommendations WHERE recommendation_id LIKE ?"
    ).get(`%${recommendationId}`) as Record<string, unknown> | null;
    return row
      ? {
          columns: row,
          recommendation: JSON.parse(String(row.recommendation_json)) as RecommendationV2 | RecommendationV3
        }
      : undefined;
  } finally {
    db.close();
  }
}

function feedbackRows(dbPath: string): unknown[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare("SELECT feedback_id, recommendation_id FROM recommendation_feedback").all();
  } finally {
    db.close();
  }
}

function foreignKeyViolations(dbPath: string): unknown[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare("PRAGMA foreign_key_check").all();
  } finally {
    db.close();
  }
}

async function seedV2(recommendations: readonly RecommendationV2[]) {
  const { store, dbPath } = await createStore();
  const before = await store.replayArchitectureLedger({ ...SCOPE, mode: "genesis" });
  await store.appendArchitectureEvents({
    writer: "runtime-daemon",
    events: [v2RunEvent(recommendations, before.graphDigest)]
  });
  return { store, dbPath };
}

/**
 * An `acknowledge` on the seeded recommendation, so the migration re-persists a row that a
 * `recommendation_feedback` row references ON DELETE RESTRICT.
 */
function feedbackEvent(recommendation: RecommendationV2, graphDigest: string): ArchitectureEventV1 {
  const feedback = {
    schemaVersion: "archcontext.recommendation-feedback/v1",
    feedbackId: "recommendation_feedback.v2fixture0001",
    recommendationId: recommendation.recommendationId,
    runId: recommendation.runId,
    action: "acknowledge",
    previousStatus: "open",
    nextStatus: "acknowledged",
    actor: { kind: "cli", id: "developer", source: "cli" },
    reason: "acknowledged before the v3 migration",
    explicit: true,
    implicitAcceptance: false,
    repository: SCOPE.repository,
    worktree: SCOPE.worktree,
    createdAt: "2026-06-25T00:10:00.000Z"
  };
  return {
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: "architecture_event.recommendation_lifecycle.v2fixture",
    eventType: "architecture.recommendation.lifecycle",
    payloadVersion: "archcontext.recommendation-feedback/v1",
    repository: SCOPE.repository,
    worktree: SCOPE.worktree,
    baseDigest: graphDigest,
    resultingDigest: graphDigest,
    headSha: SCOPE.worktree.headSha,
    actor: { kind: "cli", id: "developer" },
    source: "manual",
    timestamp: "2026-06-25T00:10:00.000Z",
    idempotencyKey: "architecture-ledger-recommendation-lifecycle:v2-fixture",
    provenance: {
      producer: "recommendation-v3-migration.test",
      command: "feedbackEvent",
      inputDigest: digestJson({ event: "v2-feedback" } as unknown as Json)
    },
    payload: {
      operations: [],
      recommendationRuns: [],
      recommendations: [{ ...recommendation, status: "acknowledged", updatedAt: "2026-06-25T00:10:00.000Z" }],
      feedback: [feedback],
      waivers: []
    } as unknown as Json
  };
}

describe("recommendation v2 to v3 migration", () => {
  test("adds no schema migration: the recommendations table is unchanged", () => {
    expect(LOCAL_SQLITE_MIGRATIONS.length).toBe(20);
  });

  test("upcasts the row to v3 while preserving identity, run and creation time", async () => {
    const v2 = v2Recommendation();
    const { store, dbPath } = await seedV2([v2]);
    const beforeRow = recommendationRow(dbPath, v2.recommendationId);
    expect(beforeRow?.recommendation.schemaVersion).toBe(RECOMMENDATION_SCHEMA_VERSION);

    const replay = await store.replayArchitectureLedger({ ...SCOPE, mode: "genesis" });
    const plan = planRecommendationV3Migration({
      repository: SCOPE.repository,
      worktree: SCOPE.worktree,
      recommendations: [v2],
      graphDigest: replay.graphDigest,
      now: "2026-09-03T07:40:00.000Z"
    });
    expect(plan.event).toBeDefined();
    expect(plan.event!.source).toBe("migration");
    expect((plan.event!.payload as { operations: unknown[] }).operations).toEqual([]);
    await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [plan.event!] });

    const afterRow = recommendationRow(dbPath, v2.recommendationId);
    const upgraded = afterRow!.recommendation as RecommendationV3;
    expect(upgraded.schemaVersion).toBe(RECOMMENDATION_V3_SCHEMA_VERSION);
    expect(upgraded.recommendationId).toBe(v2.recommendationId);
    expect(upgraded.runId).toBe(v2.runId);
    expect(upgraded.fingerprint).toBe(v2.fingerprint);
    expect(upgraded.createdAt).toBe(v2.createdAt);
    expect(upgraded.status).toBe(v2.status);
    expect(String(afterRow!.columns.fingerprint)).toBe(v2.fingerprint);
    expect(String(afterRow!.columns.created_at)).toBe(v2.createdAt);
    expect(String(afterRow!.columns.run_id)).toBe(String(beforeRow!.columns.run_id));

    expect(upgraded.category).toBe("practice");
    expect(upgraded.authoredBy).toEqual({ kind: "daemon", id: "archctxd", source: "daemon" });
    expect(upgraded.subjectSelectorId).toMatch(/^subject\.node\./);
    expect(upgraded.relations).toEqual({});
    expect(upgraded.payload).toEqual({
      practiceId: v2.practiceId!,
      baselineDigest: v2.extensions!.baselineDigest as string
    });
    expect(upgraded.updatedAt).toBe("2026-09-03T07:40:00.000Z");
    expect(upgraded.extensions?.recommendationV3Migration).toEqual({
      previousSchemaVersion: RECOMMENDATION_SCHEMA_VERSION,
      previousUpdatedAt: v2.updatedAt,
      migratedAt: "2026-09-03T07:40:00.000Z"
    } as never);
    expect(recommendationV3InvariantIssues(upgraded)).toEqual([]);
    expect(foreignKeyViolations(dbPath)).toEqual([]);
  });

  test("replays to an identical graphDigest before and after the migration event", async () => {
    const v2 = v2Recommendation();
    const { store } = await seedV2([v2]);
    const before = await store.rebuildArchitectureLedgerCurrentState(SCOPE);

    const plan = planRecommendationV3Migration({
      repository: SCOPE.repository,
      worktree: SCOPE.worktree,
      recommendations: [v2],
      graphDigest: before.graphDigest,
      now: "2026-09-03T07:41:00.000Z"
    });
    await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [plan.event!] });
    const after = await store.rebuildArchitectureLedgerCurrentState(SCOPE);

    expect(after.graphDigest).toBe(before.graphDigest);
    expect(after.cursor.eventCount).toBe(before.cursor.eventCount + 1);
  });

  test("a second migration run upgrades nothing and appends no event", async () => {
    const v2 = v2Recommendation();
    const { store } = await seedV2([v2]);
    const replay = await store.replayArchitectureLedger({ ...SCOPE, mode: "genesis" });
    const first = planRecommendationV3Migration({
      repository: SCOPE.repository,
      worktree: SCOPE.worktree,
      recommendations: [v2],
      graphDigest: replay.graphDigest,
      now: "2026-09-03T07:42:00.000Z"
    });
    await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [first.event!] });

    const afterReplay = await store.replayArchitectureLedger({ ...SCOPE, mode: "genesis" });
    const recorded = afterReplay.events.flatMap((event) =>
      ((event.payload as { recommendations?: RecommendationV3[] }).recommendations ?? [])
    );
    const second = planRecommendationV3Migration({
      repository: SCOPE.repository,
      worktree: SCOPE.worktree,
      recommendations: recorded,
      graphDigest: afterReplay.graphDigest,
      now: "2026-09-03T07:43:00.000Z"
    });

    expect(second.upgraded).toEqual([]);
    expect(second.event).toBeUndefined();
  });

  test("migrates a recommendation that already carries lifecycle feedback without breaking the FK", async () => {
    const v2 = v2Recommendation();
    const { store, dbPath } = await seedV2([v2]);
    const seeded = await store.replayArchitectureLedger({ ...SCOPE, mode: "genesis" });
    await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [feedbackEvent(v2, seeded.graphDigest)] });
    expect(feedbackRows(dbPath)).toHaveLength(1);
    const before = await store.rebuildArchitectureLedgerCurrentState(SCOPE);

    const replay = await store.replayArchitectureLedger({ ...SCOPE, mode: "genesis" });
    const recorded = replay.events.flatMap((event) =>
      ((event.payload as { recommendations?: RecommendationV2[] }).recommendations ?? [])
    );
    const plan = planRecommendationV3Migration({
      repository: SCOPE.repository,
      worktree: SCOPE.worktree,
      recommendations: recorded,
      graphDigest: replay.graphDigest,
      now: "2026-09-03T07:46:00.000Z"
    });
    expect(plan.upgraded).toHaveLength(1);
    // INSERT OR REPLACE would delete the referenced row first and fail here.
    await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [plan.event!] });

    const row = recommendationRow(dbPath, v2.recommendationId)!;
    expect(row.recommendation.schemaVersion).toBe(RECOMMENDATION_V3_SCHEMA_VERSION);
    // The acknowledge survived, and the lifecycle status it produced is carried into v3.
    expect(row.recommendation.status).toBe("acknowledged");
    expect(feedbackRows(dbPath)).toHaveLength(1);
    expect(foreignKeyViolations(dbPath)).toEqual([]);
    const after = await store.rebuildArchitectureLedgerCurrentState(SCOPE);
    expect(after.graphDigest).toBe(before.graphDigest);
  });

  test("re-persisting a recommendation run that already owns recommendations keeps the FK intact", async () => {
    const v2 = v2Recommendation();
    const { store, dbPath } = await seedV2([v2]);
    const replay = await store.replayArchitectureLedger({ ...SCOPE, mode: "genesis" });

    // The same run event replayed under a new identity: INSERT OR REPLACE on recommendation_runs
    // would delete the row that recommendations.run_id references ON DELETE RESTRICT.
    const repeat = v2RunEvent([v2], replay.graphDigest);
    await store.appendArchitectureEvents({
      writer: "runtime-daemon",
      events: [{ ...repeat, eventId: `${repeat.eventId}.repeat`, idempotencyKey: `${repeat.idempotencyKey}:repeat` }]
    });

    expect(foreignKeyViolations(dbPath)).toEqual([]);
    expect(recommendationRow(dbPath, v2.recommendationId)).toBeDefined();
  });

  test("a v2 recommendation without a practiceId fails closed instead of inventing one", () => {
    const { practiceId: _practiceId, ...withoutPractice } = v2Recommendation();

    expect(() => planRecommendationV3Migration({
      repository: SCOPE.repository,
      worktree: SCOPE.worktree,
      recommendations: [withoutPractice as RecommendationV2],
      graphDigest: digestJson({ graph: "empty" } as unknown as Json),
      now: "2026-09-03T07:44:00.000Z"
    })).toThrow("AC_SCHEMA_INVALID");
  });

  test("the upgraded record survives a JSON round trip through the ledger row", async () => {
    const v2 = v2Recommendation();
    const { store, dbPath } = await seedV2([v2]);
    const replay = await store.replayArchitectureLedger({ ...SCOPE, mode: "genesis" });
    const plan = planRecommendationV3Migration({
      repository: SCOPE.repository,
      worktree: SCOPE.worktree,
      recommendations: [v2],
      graphDigest: replay.graphDigest,
      now: "2026-09-03T07:45:00.000Z"
    });
    await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [plan.event!] });

    const row = recommendationRow(dbPath, v2.recommendationId);
    expect(row!.recommendation).toEqual(plan.upgraded[0]!);
  });
});
