#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ARCHITECTURE_EVENT_SCHEMA_VERSION, digestJson, type ArchitectureEventV1, type Json, type RecommendationV2 } from "@archcontext/contracts";
import { emptyArchitectureLedgerState, queryArchitectureLedgerBookRecommendations } from "@archcontext/core/architecture-ledger";
import {
  RECOMMENDATION_EXPLANATION_TREE_SCHEMA_VERSION,
  planRecommendationRun,
  recommendationRunLedgerPayload,
  transitionRecommendationLifecycle,
  type PlanRecommendationRunInput,
  type RecommendationRunPlan,
  type RecommendationSchedulerCandidate
} from "@archcontext/core/recommendation-engine";
import { SqliteLocalStore } from "@archcontext/local-runtime/local-store-sqlite";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al8-scheduler-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al8-scheduler-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al8-scheduler-core.md";
const RAW_SOURCE_SENTINEL = "AL8_RAW_SOURCE_SENTINEL_do_not_emit_source_body";
const FORBIDDEN_KEYS = new Set(["body", "sourceCode", "sourceBody", "rawSource", "rawDiff", "prompt", "completion"]);
const GATES = [
  "AL8-01",
  "AL8-02",
  "AL8-03",
  "AL8-04",
  "AL8-05",
  "AL8-06",
  "AL8-07",
  "AL8-08",
  "AL8-14",
  "AL8-EG1",
  "AL8-EG2",
  "AL8-EG5"
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[architecture-ledger-al8-scheduler-readback] usage: run|inspect [--out path] [--report path] [--evidence path] [--json]");
    process.exit(2);
  }
  const result = command === "run"
    ? await runArchitectureLedgerAl8SchedulerReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT
      })
    : inspectArchitectureLedgerAl8SchedulerReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export async function runArchitectureLedgerAl8SchedulerReadback({
  outPath = DEFAULT_OUT,
  reportPath = DEFAULT_REPORT
} = {}) {
  const packet = await buildArchitectureLedgerAl8SchedulerReadbackPacket();
  const inspected = inspectArchitectureLedgerAl8SchedulerReadback(packet);
  const finalPacket = {
    ...packet,
    status: inspected.ok ? "verified" : "blocked",
    failures: inspected.failures
  };
  const finalInspection = inspectArchitectureLedgerAl8SchedulerReadback(finalPacket);
  const absoluteOut = resolve(ROOT, outPath);
  const absoluteReport = resolve(ROOT, reportPath);
  mkdirSync(dirname(absoluteOut), { recursive: true });
  mkdirSync(dirname(absoluteReport), { recursive: true });
  writeFileSync(absoluteOut, `${JSON.stringify(finalPacket, null, 2)}\n`, "utf8");
  writeFileSync(absoluteReport, renderReport(finalPacket), "utf8");
  return finalInspection;
}

export async function buildArchitectureLedgerAl8SchedulerReadbackPacket() {
  const workspace = mkdtempSync(join(tmpdir(), "archctx-al8-scheduler-"));
  const databasePath = join(workspace, "runtime.sqlite");
  const store = new SqliteLocalStore(databasePath);
  const scope = schedulerScope();
  try {
    await store.migrate();
    const primaryPlan = planRecommendationRun(schedulerInput({
      candidates: [highRiskUncertainCandidate(), mediumRiskCandidate()]
    }));
    const duplicatePlan = planRecommendationRun(schedulerInput({
      candidates: [highRiskUncertainCandidate(), mediumRiskCandidate()],
      previousRecommendations: primaryPlan.recommendations.map(previousFromRecommendation)
    }));
    const cooldownPlan = planRecommendationRun(schedulerInput({
      candidates: [mediumRiskCandidate()],
      cooldowns: [{
        practiceId: "practice.runtime-boundary",
        subject: "module.checkout-runtime",
        lastRecommendedAt: "2026-06-25T12:00:00.000Z",
        cooldownUntil: "2026-06-30T12:00:00.000Z"
      }]
    }));
    const accepted = transitionRecommendationLifecycle(primaryPlan.recommendations[0], {
      action: "accept",
      now: "2026-06-26T12:05:00.000Z",
      actor: "developer",
      reason: "AL8 lifecycle readback"
    });
    const events = [
      schedulerEvent("primary", primaryPlan),
      schedulerEvent("dedupe", duplicatePlan),
      schedulerEvent("cooldown", cooldownPlan)
    ];
    const append = await store.appendArchitectureEvents({
      writer: "runtime-daemon",
      events
    });
    const replay = await store.replayArchitectureLedger(scope);
    const book = queryArchitectureLedgerBookRecommendations({
      events: replay.events,
      openOnly: true,
      explain: true,
      maxItems: 20,
      maxBytes: 32_768
    });
    store.close();
    const sqlite = sqliteReadback(databasePath);
    const packet = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      status: "verified",
      scope,
      inputCursor: (primaryPlan.run.extensions?.inputCursor ?? {}) as Json,
      scheduler: {
        primaryRun: summarizePlan(primaryPlan),
        duplicateRun: summarizePlan(duplicatePlan),
        cooldownRun: summarizePlan(cooldownPlan),
        lifecycle: {
          before: primaryPlan.recommendations[0].status,
          after: accepted.status,
          lifecycle: accepted.extensions?.lifecycle
        }
      },
      sqlite,
      append: {
        appendedEvents: append.appendedEvents.length,
        duplicateEvents: append.duplicateEvents.length,
        graphDigest: append.graphDigest,
        entityCount: append.entityCount,
        relationCount: append.relationCount,
        constraintCount: append.constraintCount
      },
      replay: {
        eventCount: replay.events.length,
        graphDigest: replay.graphDigest,
        emptyGraphStable: digestJson(emptyArchitectureLedgerState() as unknown as Json) === digestJson(replay.state as unknown as Json)
      },
      book: {
        schemaVersion: book.schemaVersion,
        openOnly: book.openOnly,
        recommendationCount: book.recommendations.length,
        recommendationIds: book.recommendations.map((recommendation) => recommendation.recommendationId),
        risks: book.recommendations.map((recommendation) => recommendation.risk),
        uncertainties: book.recommendations.map((recommendation) => recommendation.uncertainty),
        explanations: book.explanations ?? [],
        budget: book.budget,
        reasonCodes: book.reasonCodes
      },
      privacy: inspectPrivacy({
        primaryPlan,
        duplicatePlan,
        cooldownPlan,
        accepted,
        sqlite,
        book
      }, [RAW_SOURCE_SENTINEL, "function rawPrivateArchitectureBody"]),
      assertions: {
        "AL8-01": Boolean(primaryPlan.run.inputDigest && primaryPlan.run.outputDigest && primaryPlan.run.engineVersion && primaryPlan.run.catalogDigest && primaryPlan.run.extensions?.inputCursor),
        "AL8-02": primaryPlan.recommendations.every((recommendation) => recommendation.fingerprint.startsWith("sha256:"))
          && primaryPlan.recommendations[0].fingerprint !== primaryPlan.recommendations[1].fingerprint,
        "AL8-03": duplicatePlan.recommendations.length === 0
          && duplicatePlan.suppressed.length === 2
          && duplicatePlan.suppressed.every((entry) => entry.reasonCode === "duplicate-active-fingerprint"),
        "AL8-04": accepted.status === "accepted" && accepted.extensions?.lifecycle !== undefined,
        "AL8-05": primaryPlan.run.trigger.level === "L3"
          && duplicatePlan.run.trigger.level === "L3"
          && cooldownPlan.run.trigger.level === "L1",
        "AL8-06": primaryPlan.recommendations.some((recommendation) => recommendation.risk === "high")
          && primaryPlan.recommendations.some((recommendation) => recommendation.risk === "medium"),
        "AL8-07": primaryPlan.investigationEligibleRecommendationIds.length === 1
          && primaryPlan.recommendations.find((recommendation) => recommendation.risk === "high")?.uncertainty === "high"
          && primaryPlan.recommendations.find((recommendation) => recommendation.risk === "medium")?.uncertainty === "low",
        "AL8-08": cooldownPlan.recommendations.length === 0
          && cooldownPlan.suppressed.some((entry) => entry.reasonCode === "cooldown-active"),
        "AL8-14": primaryPlan.recommendations.every((recommendation) => {
          const tree = recommendation.extensions?.explanationTree as any;
          return tree?.schemaVersion === RECOMMENDATION_EXPLANATION_TREE_SCHEMA_VERSION
            && tree?.trigger?.source === "checkpoint"
            && tree?.subject === recommendation.subject
            && Array.isArray(tree?.evidenceBindingIds)
            && typeof tree?.score === "number"
            && typeof tree?.policyOutcome?.l3InvestigationEligible === "boolean";
        }),
        "AL8-EG1": duplicatePlan.recommendations.length === 0,
        "AL8-EG2": primaryPlan.recommendations.some((recommendation) => recommendation.enforcement === "checkpoint")
          && primaryPlan.investigationEligibleRecommendationIds.length === 1,
        "AL8-EG5": sqlite.recommendationRuns === 3
          && sqlite.recommendations === 2
          && append.appendedEvents.length === 3
          && replay.events.length === 3
          && book.recommendations.length === 2
      },
      readback: {
        command: `bun scripts/architecture-ledger-al8-scheduler-readback.ts inspect --evidence ${DEFAULT_OUT} --json`,
        reportPath: DEFAULT_REPORT
      },
      failures: [] as string[]
    };
    const inspection = inspectArchitectureLedgerAl8SchedulerReadback(packet);
    return {
      ...packet,
      status: inspection.ok ? "verified" : "blocked",
      failures: inspection.failures
    };
  } finally {
    store.close();
    rmSync(workspace, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
  }
}

export function inspectArchitectureLedgerAl8SchedulerReadback(packet: any) {
  const failures: string[] = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return { ok: false, schemaVersion: SCHEMA_VERSION, failures: ["packet must be an object"], gates: {} };
  }
  if (packet.schemaVersion !== SCHEMA_VERSION) failures.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (packet.status !== "verified") failures.push("status must be verified");
  for (const gate of GATES) {
    if (packet.assertions?.[gate] !== true) failures.push(`${gate} assertion must be true`);
  }
  if (packet.sqlite?.recommendationRuns !== 3) failures.push("sqlite must persist three recommendation runs");
  if (packet.sqlite?.recommendations !== 2) failures.push("sqlite must persist two open recommendations");
  if (packet.book?.recommendationCount !== 2) failures.push("Book recommendations must expose two open recommendations");
  if (packet.privacy?.noRawSourceBody !== true) failures.push("raw source sentinel leaked");
  if (packet.privacy?.noForbiddenKeys !== true) failures.push("forbidden response key present");
  return {
    ok: failures.length === 0,
    schemaVersion: SCHEMA_VERSION,
    gates: Object.fromEntries(GATES.map((gate) => [gate, packet.assertions?.[gate] === true ? "verified" : "blocked"])),
    failures
  };
}

function schedulerScope() {
  return {
    repository: {
      repositoryId: "repo.arch-context.al8",
      storageRepositoryId: "repo.storage.arch-context.al8"
    },
    worktree: {
      workspaceId: "workspace.arch-context.al8",
      storageWorkspaceId: "workspace.storage.arch-context.al8",
      branch: "codex/architecture-ledger-al8-scheduler-core",
      headSha: "0123456789abcdef0123456789abcdef01234567",
      worktreeDigest: digestJson({ fixture: "al8-scheduler", sentinel: "metadata-only" } as unknown as Json)
    }
  };
}

function schedulerInput(overrides: Partial<PlanRecommendationRunInput> = {}): PlanRecommendationRunInput {
  const scope = schedulerScope();
  return {
    ...scope,
    triggerSource: "checkpoint",
    policyMode: "advisory",
    catalogDigest: digestJson({ fixture: "al8-catalog", practices: ["practice.runtime-boundary"] } as unknown as Json),
    inputCursor: {
      source: "candidate-delta",
      baseDigest: digestJson({ base: "architecture-ledger-before" } as unknown as Json),
      headDigest: digestJson({ head: "architecture-ledger-after" } as unknown as Json),
      headSha: scope.worktree.headSha,
      changedPathDigest: digestJson({ paths: ["packages/core/recommendation-engine/src/index.ts"] } as unknown as Json),
      candidateDeltaDigest: digestJson({ delta: "al8-scheduler" } as unknown as Json)
    },
    candidates: [],
    now: "2026-06-26T12:00:00.000Z",
    ...overrides
  };
}

function highRiskUncertainCandidate(): RecommendationSchedulerCandidate {
  return {
    practiceId: "practice.runtime-boundary",
    subject: "module.checkout-runtime",
    confidence: "low",
    enforcement: "checkpoint",
    evidenceBindingIds: ["evidence.checkout.payment-boundary", "evidence.checkout.persistence"],
    explanation: ["Checkout runtime changed a payment-facing persistence boundary with ambiguous mapping evidence."],
    baselineDigest: digestJson({ baseline: "checkout-runtime-v1" } as unknown as Json),
    riskSignals: ["persistence-change", "payment-domain-change"],
    uncertaintySignals: ["mapping-ambiguity"],
    score: 91
  };
}

function mediumRiskCandidate(): RecommendationSchedulerCandidate {
  return {
    practiceId: "practice.runtime-boundary",
    subject: "module.checkout-runtime",
    confidence: "medium",
    enforcement: "advisory",
    evidenceBindingIds: ["evidence.checkout.boundary"],
    explanation: ["Runtime boundary changed and should be reviewed by the architecture owner."],
    baselineDigest: digestJson({ baseline: "checkout-runtime-v1" } as unknown as Json),
    riskSignals: ["boundary-change"],
    uncertaintySignals: [],
    score: 52
  };
}

function schedulerEvent(label: string, plan: RecommendationRunPlan): ArchitectureEventV1 {
  const payload = {
    title: `AL8 recommendation scheduler ${label}`,
    summary: "Recommendation scheduler readback event with metadata-only recommendation artifacts.",
    ...recommendationRunLedgerPayload(plan)
  } as unknown as Json;
  return {
    schemaVersion: ARCHITECTURE_EVENT_SCHEMA_VERSION,
    eventId: `architecture_event.al8_scheduler.${label}.${digestSuffix(plan.run.runId)}`,
    eventType: "architecture.recommendation.run",
    payloadVersion: "archcontext.recommendation-scheduler-readback/v1",
    repository: plan.run.repository,
    worktree: plan.run.worktree,
    baseDigest: plan.run.inputDigest,
    resultingDigest: plan.run.outputDigest,
    headSha: plan.run.worktree.headSha,
    actor: { kind: "daemon", id: "archctx-recommendation-scheduler" },
    source: "checkpoint",
    timestamp: plan.run.startedAt,
    idempotencyKey: `architecture-ledger-al8-scheduler:${label}:${plan.run.inputDigest}`,
    provenance: {
      producer: "recommendation-engine",
      command: "planRecommendationRun",
      inputDigest: plan.run.inputDigest
    },
    payload
  };
}

function summarizePlan(plan: RecommendationRunPlan) {
  return {
    runId: plan.run.runId,
    triggerLevel: plan.run.trigger.level,
    engineVersion: plan.run.engineVersion,
    catalogDigest: plan.run.catalogDigest,
    inputDigest: plan.run.inputDigest,
    outputDigest: plan.run.outputDigest,
    recommendationIds: plan.recommendations.map((recommendation) => recommendation.recommendationId),
    fingerprints: plan.recommendations.map((recommendation) => recommendation.fingerprint),
    suppressed: plan.suppressed,
    investigationEligibleRecommendationIds: plan.investigationEligibleRecommendationIds,
    risks: plan.recommendations.map((recommendation) => recommendation.risk),
    uncertainties: plan.recommendations.map((recommendation) => recommendation.uncertainty)
  };
}

function previousFromRecommendation(recommendation: RecommendationV2) {
  return {
    recommendationId: recommendation.recommendationId,
    fingerprint: recommendation.fingerprint,
    subject: recommendation.subject,
    practiceId: recommendation.practiceId,
    status: recommendation.status,
    updatedAt: recommendation.updatedAt
  };
}

function sqliteReadback(databasePath: string) {
  const db = new Database(databasePath, { readonly: true });
  try {
    return {
      recommendationRuns: sqliteCount(db, "SELECT COUNT(*) AS count FROM recommendation_runs"),
      recommendations: sqliteCount(db, "SELECT COUNT(*) AS count FROM recommendations"),
      feedback: sqliteCount(db, "SELECT COUNT(*) AS count FROM recommendation_feedback"),
      openRecommendations: sqliteCount(db, "SELECT COUNT(*) AS count FROM recommendations WHERE status = 'open'"),
      runIds: db.prepare("SELECT run_id FROM recommendation_runs ORDER BY run_id").all().map((row: any) => String(row.run_id)),
      recommendationIds: db.prepare("SELECT recommendation_id FROM recommendations ORDER BY recommendation_id").all().map((row: any) => String(row.recommendation_id))
    };
  } finally {
    db.close();
  }
}

function sqliteCount(db: Database, sql: string): number {
  const row = db.prepare(sql).get() as { count?: number | string } | undefined;
  return Number(row?.count ?? 0);
}

function inspectPrivacy(value: unknown, forbiddenStrings: string[]) {
  const serialized = JSON.stringify(value);
  const forbiddenKeyHits: string[] = [];
  collectForbiddenKeys(value, "$", forbiddenKeyHits);
  return {
    forbiddenStrings,
    noRawSourceBody: forbiddenStrings.every((item) => !serialized.includes(item)),
    noForbiddenKeys: forbiddenKeyHits.length === 0,
    forbiddenKeyHits
  };
}

function collectForbiddenKeys(value: unknown, path: string, hits: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeys(item, `${path}[${index}]`, hits));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) hits.push(`${path}.${key}`);
    collectForbiddenKeys(entry, `${path}.${key}`, hits);
  }
}

function digestSuffix(value: string): string {
  return value.replace(/^sha256:/, "").replace(/^recommendation_run\./, "").slice(0, 16);
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function renderHuman(result: { ok: boolean; failures: string[] }) {
  if (result.ok) return "[architecture-ledger-al8-scheduler-readback] OK";
  return ["[architecture-ledger-al8-scheduler-readback] FAILED", ...result.failures.map((failure) => `- ${failure}`)].join("\n");
}

function renderReport(packet: any): string {
  const gateRows = GATES
    .map((gate) => `| ${gate} | ${packet.assertions?.[gate] ? "pass" : "fail"} |`)
    .join("\n");
  return `# AL8 Recommendation Scheduler Core Readback

Date: 2026-06-26

## Scope

This closes the scheduler-core portion of AL8: run records, stable fingerprints, duplicate suppression, lifecycle transitions, trigger levels, risk/uncertainty scoring, cooldowns, explanation trees and persisted Book readback.

Out of scope: CLI lifecycle commands, review-engine enforcement gates, waiver policy config and feedback metrics.

## P1 Map

The write boundary remains the architecture ledger append path. \`@archcontext/core/recommendation-engine\` owns deterministic scheduler decisions. \`SqliteLocalStore.appendArchitectureEvents\` owns persistence of \`recommendation_runs\` and \`recommendations\`. Book recommendations remain a read-only projection over replayed architecture events.

## P2 Traced Path

\`\`\`text
AL8 scheduler candidate
  -> planRecommendationRun()
  -> RecommendationRunV1 + RecommendationV2 + explanation tree
  -> recommendationRunLedgerPayload()
  -> SqliteLocalStore.appendArchitectureEvents({ writer: "runtime-daemon" })
  -> recommendation_runs / recommendations SQLite tables
  -> replayArchitectureLedger()
  -> queryArchitectureLedgerBookRecommendations(openOnly=true)
\`\`\`

## P3 Decision

The smallest coherent change is a pure scheduler core plus a SQLite readback packet. It preserves the AL0 invariant that CLI, MCP, hooks and agents are triggers/readers unless a daemon-owned event append crosses the mutation boundary. At 10x scale, duplicate/cooldown lookup and explanation payload size are the first pressure points; this module keeps both metadata-only and digest-based.

## Gates

| Gate | Status |
|---|---|
${gateRows}

## Persistence

- Appended events: ${packet.append?.appendedEvents}
- SQLite recommendation runs: ${packet.sqlite?.recommendationRuns}
- SQLite recommendations: ${packet.sqlite?.recommendations}
- Book open recommendations: ${packet.book?.recommendationCount}

## Verification

\`\`\`bash
bun run record:al8:scheduler
bun run readback:al8:scheduler
bun test packages/core/recommendation-engine/test/recommendation-engine.test.ts
bun test scripts/architecture-ledger-al8-scheduler-readback.test.ts
bun run typecheck
node scripts/package-boundary-audit.mjs
node scripts/sprint-status-check.mjs
git diff --check
\`\`\`

Readback status: ${packet.status}
`;
}
