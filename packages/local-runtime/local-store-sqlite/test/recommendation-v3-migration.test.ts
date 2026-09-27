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
import { planRecommendationV3Migration } from "../../runtime-daemon/src/ledger-admin";
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

  /**
   * Fixed-input regression guard for the planner's move from refactor-recording.ts into
   * ledger-admin.ts: every field of the produced plan (upgraded recommendation, migration event
   * -- eventId, inputDigest, idempotencyKey, provenance, ordering -- and the plan's own
   * inputDigest) must stay byte-identical, captured from the pre-move implementation. This test
   * must pass unchanged both before and after the move.
   */
  test("produces the exact pre-move migration event for a fixed input (regression guard for the ledger-admin move)", () => {
    const fixedScope = {
      repository: {
        repositoryId: "repo.recommendation-v3-migration-fixed",
        storageRepositoryId: "repo.storage.recommendation-v3-migration-fixed"
      },
      worktree: {
        workspaceId: "workspace.recommendation-v3-migration-fixed",
        storageWorkspaceId: "workspace.storage.recommendation-v3-migration-fixed",
        branch: "main",
        headSha: "1111111111111111111111111111111111111111",
        worktreeDigest: digestJson({ worktree: "recommendation-v3-migration-fixed" } as unknown as Json)
      }
    };
    const fixedV2: RecommendationV2 = {
      schemaVersion: RECOMMENDATION_SCHEMA_VERSION,
      recommendationId: "recommendation.v3fixedinput00001",
      runId: "recommendation_run.v3fixedinput001",
      fingerprint: digestJson({ fingerprint: "v3-fixed-input" } as unknown as Json),
      subject: "module.fixed-input-subject",
      practiceId: "practice.record-significant-change",
      status: "open",
      confidence: "high",
      enforcement: "checkpoint",
      risk: "medium",
      uncertainty: "low",
      evidenceBindingIds: [],
      explanation: ["Fixed-input fixture for the pre-move migration event regression test."],
      createdAt: "2026-01-01T00:00:01.000Z",
      updatedAt: "2026-01-01T00:00:02.000Z",
      extensions: { baselineDigest: digestJson({ baseline: "v3-fixed-input" } as unknown as Json) }
    };
    const graphDigest = digestJson({ graph: "recommendation-v3-migration-fixed-input" } as unknown as Json);
    const now = "2026-01-01T00:00:03.000Z";

    const plan = planRecommendationV3Migration({
      repository: fixedScope.repository,
      worktree: fixedScope.worktree,
      recommendations: [fixedV2],
      graphDigest,
      now
    });

    const upgradedV3 = {
      schemaVersion: RECOMMENDATION_V3_SCHEMA_VERSION,
      recommendationId: "recommendation.v3fixedinput00001",
      runId: "recommendation_run.v3fixedinput001",
      fingerprint: "sha256:6c11ecaf7a031d776a79531e3c91df0709306aaabdf27e132e405789e6ced03a",
      subject: "module.fixed-input-subject",
      practiceId: "practice.record-significant-change",
      status: "open",
      confidence: "high",
      enforcement: "checkpoint",
      risk: "medium",
      uncertainty: "low",
      evidenceBindingIds: [],
      explanation: ["Fixed-input fixture for the pre-move migration event regression test."],
      createdAt: "2026-01-01T00:00:01.000Z",
      updatedAt: "2026-01-01T00:00:03.000Z",
      category: "practice",
      payload: {
        practiceId: "practice.record-significant-change",
        baselineDigest: "sha256:a425e83545b7a25d1d0f4ccf7bd2b80ebadbde1f7c9f9e11566bbd1f9c4dab78"
      },
      authoredBy: { kind: "daemon", id: "archctxd", source: "daemon" },
      subjectSelectorId: "subject.node.aca2ed9d1cdd842b",
      relations: {},
      extensions: {
        baselineDigest: "sha256:a425e83545b7a25d1d0f4ccf7bd2b80ebadbde1f7c9f9e11566bbd1f9c4dab78",
        recommendationV3Migration: {
          previousSchemaVersion: RECOMMENDATION_SCHEMA_VERSION,
          previousUpdatedAt: "2026-01-01T00:00:02.000Z",
          migratedAt: "2026-01-01T00:00:03.000Z"
        }
      }
    };

    expect(plan).toEqual({
      upgraded: [upgradedV3],
      inputDigest: "sha256:846fc9bffd8a84170bea803e086043a98204e60d5b46a44f08e132f361e79118",
      event: {
        schemaVersion: "archcontext.architecture-event/v1",
        eventId: "architecture_event.recommendation_v3_migration.846fc9bffd8a8417",
        eventType: "architecture.recommendation.v3-migration",
        payloadVersion: RECOMMENDATION_V3_SCHEMA_VERSION,
        repository: fixedScope.repository,
        worktree: fixedScope.worktree,
        baseDigest: graphDigest,
        resultingDigest: graphDigest,
        headSha: fixedScope.worktree.headSha,
        actor: { kind: "migration", id: "archctx-recommendation-v3-migration" },
        source: "migration",
        timestamp: now,
        idempotencyKey: "architecture-ledger-recommendation-v3-migration:sha256:846fc9bffd8a84170bea803e086043a98204e60d5b46a44f08e132f361e79118",
        provenance: {
          producer: "runtime-daemon",
          command: "archctx ledger migrate --recommendation-v3",
          inputDigest: "sha256:846fc9bffd8a84170bea803e086043a98204e60d5b46a44f08e132f361e79118"
        },
        payload: {
          recommendationRuns: [],
          recommendations: [upgradedV3],
          feedback: [],
          waivers: [],
          operations: [],
          title: "Recommendation v2 to v3 migration",
          summary: "Upgraded 1 recommendation(s) to archcontext.recommendation/v3."
        }
      }
    } as unknown as typeof plan);

    // Byte-exact check: `toEqual` above does not lock object key order or prove the
    // serialized bytes are unchanged. This does.
    expect(JSON.stringify(plan.event)).toBe(
      `{"schemaVersion":"archcontext.architecture-event/v1","eventId":"architecture_event.recommendation_v3_migration.846fc9bffd8a8417","eventType":"architecture.recommendation.v3-migration","payloadVersion":"archcontext.recommendation/v3","repository":{"repositoryId":"repo.recommendation-v3-migration-fixed","storageRepositoryId":"repo.storage.recommendation-v3-migration-fixed"},"worktree":{"workspaceId":"workspace.recommendation-v3-migration-fixed","storageWorkspaceId":"workspace.storage.recommendation-v3-migration-fixed","branch":"main","headSha":"1111111111111111111111111111111111111111","worktreeDigest":"sha256:5d4b20a572a1034b3ef72fe85835d9d15ba35950a1a8a814d76450f8b9c9f717"},"baseDigest":"sha256:5b6fda4b36b852a74098e916cd755f8a223e4404c80aeedd80ee9a4612c1113a","resultingDigest":"sha256:5b6fda4b36b852a74098e916cd755f8a223e4404c80aeedd80ee9a4612c1113a","headSha":"1111111111111111111111111111111111111111","actor":{"kind":"migration","id":"archctx-recommendation-v3-migration"},"source":"migration","timestamp":"2026-01-01T00:00:03.000Z","idempotencyKey":"architecture-ledger-recommendation-v3-migration:sha256:846fc9bffd8a84170bea803e086043a98204e60d5b46a44f08e132f361e79118","provenance":{"producer":"runtime-daemon","command":"archctx ledger migrate --recommendation-v3","inputDigest":"sha256:846fc9bffd8a84170bea803e086043a98204e60d5b46a44f08e132f361e79118"},"payload":{"recommendationRuns":[],"recommendations":[{"schemaVersion":"archcontext.recommendation/v3","recommendationId":"recommendation.v3fixedinput00001","runId":"recommendation_run.v3fixedinput001","fingerprint":"sha256:6c11ecaf7a031d776a79531e3c91df0709306aaabdf27e132e405789e6ced03a","subject":"module.fixed-input-subject","practiceId":"practice.record-significant-change","status":"open","confidence":"high","enforcement":"checkpoint","risk":"medium","uncertainty":"low","evidenceBindingIds":[],"explanation":["Fixed-input fixture for the pre-move migration event regression test."],"createdAt":"2026-01-01T00:00:01.000Z","updatedAt":"2026-01-01T00:00:03.000Z","category":"practice","payload":{"practiceId":"practice.record-significant-change","baselineDigest":"sha256:a425e83545b7a25d1d0f4ccf7bd2b80ebadbde1f7c9f9e11566bbd1f9c4dab78"},"authoredBy":{"kind":"daemon","id":"archctxd","source":"daemon"},"subjectSelectorId":"subject.node.aca2ed9d1cdd842b","relations":{},"extensions":{"baselineDigest":"sha256:a425e83545b7a25d1d0f4ccf7bd2b80ebadbde1f7c9f9e11566bbd1f9c4dab78","recommendationV3Migration":{"previousSchemaVersion":"archcontext.recommendation/v2","previousUpdatedAt":"2026-01-01T00:00:02.000Z","migratedAt":"2026-01-01T00:00:03.000Z"}}}],"feedback":[],"waivers":[],"operations":[],"title":"Recommendation v2 to v3 migration","summary":"Upgraded 1 recommendation(s) to archcontext.recommendation/v3."}}`
    );
  });

  /**
   * Second fixed-input regression guard: multiple recommendations supplied out of order, with
   * duplicate ids at different schema versions and timestamps, so both `latestRecommendationsById`
   * (an id's latest-by-`updatedAt` snapshot wins regardless of array position, and an id whose
   * latest snapshot is already v3 is excluded from re-upgrade) and the `recommendationId` sort in
   * `planRecommendationV3Migration` are exercised. Pinned bytes, captured from the current
   * implementation.
   */
  test("produces the exact migration event for out-of-order, duplicate-id fixed input (ordering and dedup regression guard)", () => {
    const fixedScope2 = {
      repository: {
        repositoryId: "repo.recommendation-v3-migration-fixed2",
        storageRepositoryId: "repo.storage.recommendation-v3-migration-fixed2"
      },
      worktree: {
        workspaceId: "workspace.recommendation-v3-migration-fixed2",
        storageWorkspaceId: "workspace.storage.recommendation-v3-migration-fixed2",
        branch: "main",
        headSha: "2222222222222222222222222222222222222222",
        worktreeDigest: digestJson({ worktree: "recommendation-v3-migration-fixed2" } as unknown as Json)
      }
    };

    const id1 = "recommendation.v3fixedmulti0001";
    const id2 = "recommendation.v3fixedmulti0002";
    const id3 = "recommendation.v3fixedmulti0003";
    const id4 = "recommendation.v3fixedmulti0004";

    const rec1 = v2Recommendation({
      recommendationId: id1,
      runId: "recommendation_run.v3fixedmulti01",
      fingerprint: digestJson({ fingerprint: "v3-fixed-multi-1" } as unknown as Json),
      subject: "module.fixed-multi-subject-1",
      explanation: ["Fixed-multi fixture 1 for ordering."],
      createdAt: "2026-03-01T00:00:01.000Z",
      updatedAt: "2026-03-01T00:00:02.000Z",
      extensions: { baselineDigest: digestJson({ baseline: "v3-fixed-multi-1" } as unknown as Json) }
    });
    const rec2Old = v2Recommendation({
      recommendationId: id2,
      runId: "recommendation_run.v3fixedmulti02",
      fingerprint: digestJson({ fingerprint: "v3-fixed-multi-2-old" } as unknown as Json),
      subject: "module.fixed-multi-subject-2",
      explanation: ["Fixed-multi fixture 2, superseded snapshot (must not survive dedup)."],
      createdAt: "2026-03-02T00:00:01.000Z",
      updatedAt: "2026-03-02T00:00:02.000Z",
      extensions: { baselineDigest: digestJson({ baseline: "v3-fixed-multi-2-old" } as unknown as Json) }
    });
    const rec2New = v2Recommendation({
      recommendationId: id2,
      runId: "recommendation_run.v3fixedmulti02",
      fingerprint: digestJson({ fingerprint: "v3-fixed-multi-2-new" } as unknown as Json),
      subject: "module.fixed-multi-subject-2",
      status: "acknowledged",
      explanation: ["Fixed-multi fixture 2, latest snapshot (must survive dedup)."],
      createdAt: "2026-03-02T00:00:01.000Z",
      updatedAt: "2026-03-02T00:05:00.000Z",
      extensions: { baselineDigest: digestJson({ baseline: "v3-fixed-multi-2-new" } as unknown as Json) }
    });
    const rec3 = v2Recommendation({
      recommendationId: id3,
      runId: "recommendation_run.v3fixedmulti03",
      fingerprint: digestJson({ fingerprint: "v3-fixed-multi-3" } as unknown as Json),
      subject: "module.fixed-multi-subject-3",
      explanation: ["Fixed-multi fixture 3 for ordering."],
      createdAt: "2026-03-03T00:00:01.000Z",
      updatedAt: "2026-03-03T00:00:02.000Z",
      extensions: { baselineDigest: digestJson({ baseline: "v3-fixed-multi-3" } as unknown as Json) }
    });
    const rec4V2 = v2Recommendation({
      recommendationId: id4,
      runId: "recommendation_run.v3fixedmulti04",
      fingerprint: digestJson({ fingerprint: "v3-fixed-multi-4" } as unknown as Json),
      subject: "module.fixed-multi-subject-4",
      explanation: [
        "Fixed-multi fixture 4, v2 snapshot (must not survive dedup: an already-migrated v3 snapshot is newer)."
      ],
      createdAt: "2026-03-04T00:00:01.000Z",
      updatedAt: "2026-03-04T00:00:02.000Z",
      extensions: { baselineDigest: digestJson({ baseline: "v3-fixed-multi-4" } as unknown as Json) }
    });
    const rec4V3: RecommendationV3 = {
      schemaVersion: RECOMMENDATION_V3_SCHEMA_VERSION,
      recommendationId: id4,
      runId: "recommendation_run.v3fixedmulti04",
      fingerprint: digestJson({ fingerprint: "v3-fixed-multi-4" } as unknown as Json),
      subject: "module.fixed-multi-subject-4",
      practiceId: "practice.record-significant-change",
      status: "open",
      confidence: "high",
      enforcement: "checkpoint",
      risk: "medium",
      uncertainty: "low",
      evidenceBindingIds: [],
      explanation: [
        "Fixed-multi fixture 4, already migrated to v3 in a prior run (wins dedup by timestamp; excluded from re-upgrade)."
      ],
      createdAt: "2026-03-04T00:00:01.000Z",
      updatedAt: "2026-03-04T00:10:00.000Z",
      category: "practice",
      payload: {
        practiceId: "practice.record-significant-change",
        baselineDigest: digestJson({ baseline: "v3-fixed-multi-4" } as unknown as Json)
      },
      authoredBy: { kind: "daemon", id: "archctxd", source: "daemon" },
      subjectSelectorId: "subject.node.fixedmulti4alreadymigrated",
      relations: {},
      extensions: {
        baselineDigest: digestJson({ baseline: "v3-fixed-multi-4" } as unknown as Json),
        recommendationV3Migration: {
          previousSchemaVersion: RECOMMENDATION_SCHEMA_VERSION,
          previousUpdatedAt: "2026-03-04T00:00:02.000Z",
          migratedAt: "2026-03-04T00:10:00.000Z"
        }
      }
    };

    const graphDigest2 = digestJson({ graph: "recommendation-v3-migration-fixed-multi" } as unknown as Json);
    const now2 = "2026-03-05T00:00:00.000Z";

    // Deliberately out of id-sort order, and each duplicate id's timestamp-winner placed at an
    // *earlier* array index than its loser, so a naive "last write wins" reduction would pick the
    // wrong snapshot: only comparing `updatedAt`, as `latestRecommendationsById` does, gets this right.
    const plan = planRecommendationV3Migration({
      repository: fixedScope2.repository,
      worktree: fixedScope2.worktree,
      recommendations: [rec3, rec4V3, rec1, rec2New, rec4V2, rec2Old],
      graphDigest: graphDigest2,
      now: now2
    });

    // id4's latest-by-updatedAt snapshot is already v3, so it is excluded; id2's newer snapshot
    // (not the array-later one) survives; the surviving ids come out sorted.
    expect(plan.upgraded.map((recommendation) => recommendation.recommendationId)).toEqual([id1, id2, id3]);

    expect(JSON.stringify(plan.event)).toBe(
      `{"schemaVersion":"archcontext.architecture-event/v1","eventId":"architecture_event.recommendation_v3_migration.c545ae87cc1ab817","eventType":"architecture.recommendation.v3-migration","payloadVersion":"archcontext.recommendation/v3","repository":{"repositoryId":"repo.recommendation-v3-migration-fixed2","storageRepositoryId":"repo.storage.recommendation-v3-migration-fixed2"},"worktree":{"workspaceId":"workspace.recommendation-v3-migration-fixed2","storageWorkspaceId":"workspace.storage.recommendation-v3-migration-fixed2","branch":"main","headSha":"2222222222222222222222222222222222222222","worktreeDigest":"sha256:d27ad6e12e37f175758a4e8facb4c24cd057d6ff8f97f679fc7a62d7ad3d9343"},"baseDigest":"sha256:656028b1cf6fd22b2495e5215bbc33ac60b68da64a3e7cf22a72c40b15cd2eec","resultingDigest":"sha256:656028b1cf6fd22b2495e5215bbc33ac60b68da64a3e7cf22a72c40b15cd2eec","headSha":"2222222222222222222222222222222222222222","actor":{"kind":"migration","id":"archctx-recommendation-v3-migration"},"source":"migration","timestamp":"2026-03-05T00:00:00.000Z","idempotencyKey":"architecture-ledger-recommendation-v3-migration:sha256:c545ae87cc1ab81799d81566cc4c02d445c88d20f1ebdb7a8dc95cc5dabea881","provenance":{"producer":"runtime-daemon","command":"archctx ledger migrate --recommendation-v3","inputDigest":"sha256:c545ae87cc1ab81799d81566cc4c02d445c88d20f1ebdb7a8dc95cc5dabea881"},"payload":{"recommendationRuns":[],"recommendations":[{"schemaVersion":"archcontext.recommendation/v3","recommendationId":"recommendation.v3fixedmulti0001","runId":"recommendation_run.v3fixedmulti01","fingerprint":"sha256:a974edb2ee672ad73cc72d9fe953b278db161944ddf24a6df4940ac7e6c40556","subject":"module.fixed-multi-subject-1","practiceId":"practice.record-significant-change","status":"open","confidence":"high","enforcement":"checkpoint","risk":"medium","uncertainty":"low","evidenceBindingIds":[],"explanation":["Fixed-multi fixture 1 for ordering."],"createdAt":"2026-03-01T00:00:01.000Z","updatedAt":"2026-03-05T00:00:00.000Z","category":"practice","payload":{"practiceId":"practice.record-significant-change","baselineDigest":"sha256:5faa7382775b02e719207bb17ee366ec8c470eec78b18a0f51fb1ef17b7eb4e4"},"authoredBy":{"kind":"daemon","id":"archctxd","source":"daemon"},"subjectSelectorId":"subject.node.f5eac13510271ead","relations":{},"extensions":{"baselineDigest":"sha256:5faa7382775b02e719207bb17ee366ec8c470eec78b18a0f51fb1ef17b7eb4e4","recommendationV3Migration":{"previousSchemaVersion":"archcontext.recommendation/v2","previousUpdatedAt":"2026-03-01T00:00:02.000Z","migratedAt":"2026-03-05T00:00:00.000Z"}}},{"schemaVersion":"archcontext.recommendation/v3","recommendationId":"recommendation.v3fixedmulti0002","runId":"recommendation_run.v3fixedmulti02","fingerprint":"sha256:67ebe54a97b5bc93cc30c63011f04faf01de18b784bcc7b27cf733e53d2250c6","subject":"module.fixed-multi-subject-2","practiceId":"practice.record-significant-change","status":"acknowledged","confidence":"high","enforcement":"checkpoint","risk":"medium","uncertainty":"low","evidenceBindingIds":[],"explanation":["Fixed-multi fixture 2, latest snapshot (must survive dedup)."],"createdAt":"2026-03-02T00:00:01.000Z","updatedAt":"2026-03-05T00:00:00.000Z","category":"practice","payload":{"practiceId":"practice.record-significant-change","baselineDigest":"sha256:5ae34b574c9fabf3b1029783715a8627817106fd98d44a097f826df1c3723781"},"authoredBy":{"kind":"daemon","id":"archctxd","source":"daemon"},"subjectSelectorId":"subject.node.f84d8c64f6379935","relations":{},"extensions":{"baselineDigest":"sha256:5ae34b574c9fabf3b1029783715a8627817106fd98d44a097f826df1c3723781","recommendationV3Migration":{"previousSchemaVersion":"archcontext.recommendation/v2","previousUpdatedAt":"2026-03-02T00:05:00.000Z","migratedAt":"2026-03-05T00:00:00.000Z"}}},{"schemaVersion":"archcontext.recommendation/v3","recommendationId":"recommendation.v3fixedmulti0003","runId":"recommendation_run.v3fixedmulti03","fingerprint":"sha256:46b9d0bd74047de03490adfebbf35ba0577dd30d004f011d10024d4d07a309e6","subject":"module.fixed-multi-subject-3","practiceId":"practice.record-significant-change","status":"open","confidence":"high","enforcement":"checkpoint","risk":"medium","uncertainty":"low","evidenceBindingIds":[],"explanation":["Fixed-multi fixture 3 for ordering."],"createdAt":"2026-03-03T00:00:01.000Z","updatedAt":"2026-03-05T00:00:00.000Z","category":"practice","payload":{"practiceId":"practice.record-significant-change","baselineDigest":"sha256:6760dabfb2a39fd49b7a6c7a239ba41dcfd35712729bb023c66fb8efe15698c4"},"authoredBy":{"kind":"daemon","id":"archctxd","source":"daemon"},"subjectSelectorId":"subject.node.0dfeb7c8546fa65c","relations":{},"extensions":{"baselineDigest":"sha256:6760dabfb2a39fd49b7a6c7a239ba41dcfd35712729bb023c66fb8efe15698c4","recommendationV3Migration":{"previousSchemaVersion":"archcontext.recommendation/v2","previousUpdatedAt":"2026-03-03T00:00:02.000Z","migratedAt":"2026-03-05T00:00:00.000Z"}}}],"feedback":[],"waivers":[],"operations":[],"title":"Recommendation v2 to v3 migration","summary":"Upgraded 3 recommendation(s) to archcontext.recommendation/v3."}}`
    );
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
