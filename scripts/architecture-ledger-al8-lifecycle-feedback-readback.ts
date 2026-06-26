#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { computeWorktreeDigest, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { planRecommendationRun, recommendationRunLedgerPayload } from "@archcontext/core/recommendation-engine";
import { digestJson, type ArchitectureEventV1, type Json } from "@archcontext/contracts";
import { SqliteLocalStore, runtimeStatePaths } from "@archcontext/local-runtime/local-store-sqlite";
import { createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { runCli } from "@archcontext/surfaces/cli";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al8-lifecycle-feedback-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al8-lifecycle-feedback-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al8-lifecycle-feedback.md";
const RAW_SOURCE_SENTINEL = "AL8_LIFECYCLE_RAW_SOURCE_SENTINEL";
const GATES = ["AL8-11", "AL8-12", "AL8-13"] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[architecture-ledger-al8-lifecycle-feedback-readback] usage: run|inspect [--out path] [--report path] [--evidence path] [--json]");
    process.exit(2);
  }
  const result = command === "run"
    ? await runArchitectureLedgerAl8LifecycleFeedbackReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT
      })
    : inspectArchitectureLedgerAl8LifecycleFeedbackReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export async function runArchitectureLedgerAl8LifecycleFeedbackReadback({
  outPath = DEFAULT_OUT,
  reportPath = DEFAULT_REPORT
} = {}) {
  const packet = await buildArchitectureLedgerAl8LifecycleFeedbackReadbackPacket();
  const inspected = inspectArchitectureLedgerAl8LifecycleFeedbackReadback(packet);
  const finalPacket = {
    ...packet,
    status: inspected.ok ? "verified" : "blocked",
    failures: inspected.failures
  };
  const finalInspection = inspectArchitectureLedgerAl8LifecycleFeedbackReadback(finalPacket);
  const absoluteOut = resolve(ROOT, outPath);
  const absoluteReport = resolve(ROOT, reportPath);
  mkdirSync(dirname(absoluteOut), { recursive: true });
  mkdirSync(dirname(absoluteReport), { recursive: true });
  writeFileSync(absoluteOut, `${JSON.stringify(finalPacket, null, 2)}\n`, "utf8");
  writeFileSync(absoluteReport, renderReport(finalPacket), "utf8");
  return finalInspection;
}

export async function buildArchitectureLedgerAl8LifecycleFeedbackReadbackPacket() {
  const workspace = mkdtempSync(join(tmpdir(), "archctx-al8-lifecycle-"));
  const previousStateDir = process.env.ARCHCONTEXT_STATE_DIR;
  process.env.ARCHCONTEXT_STATE_DIR = join(workspace, "state");
  const root = join(workspace, "repo");
  const databasePath = join(workspace, "runtime.sqlite");
  const store = new SqliteLocalStore(databasePath);
  const daemon = await createStartedDaemon({
    localStore: store,
    clock: () => "2026-06-26T12:05:00.000Z"
  });
  try {
    createInitializedGitRepo(root);
    const plan = await appendRecommendationRunFixture(store, root, "2026-06-26T12:00:00.000Z");
    const recommendationId = plan.recommendations[0].recommendationId;
    const accept = await runCli("recommendations", [
      "accept",
      "--id", recommendationId,
      "--reason", "accepted after explicit AL8 lifecycle readback",
      "--actor", "worker.al8",
      "--actor-kind", "subagent",
      "--source", "subagent",
      "--agent-job-id", "agent_job.al8_lifecycle",
      "--expected-worktree-digest", computeWorktreeDigest(root),
      "--now", "2026-06-26T12:10:00.000Z"
    ], root, { runtimeClient: daemon as any });
    const bookOpen = await runCli("book", ["recommendations", "--open", "--explain"], root, { runtimeClient: daemon as any });
    const bookAll = await runCli("book", ["recommendations", "--explain"], root, { runtimeClient: daemon as any });
    const metrics = await runCli("recommendations", ["metrics", "--now", "2026-06-26T12:11:00.000Z"], root, { runtimeClient: daemon as any });
    const duplicate = await runCli("recommendations", [
      "accept",
      "--id", recommendationId,
      "--reason", "duplicate accept should not append"
    ], root, { runtimeClient: daemon as any });
    const sqlite = sqliteReadback(databasePath);
    const packet = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      status: "verified",
      gates: [...GATES],
      recommendationId,
      lifecycle: {
        cliOk: accept.ok,
        requestId: accept.requestId,
        previousStatus: (accept.data as any)?.previousStatus,
        nextStatus: (accept.data as any)?.nextStatus,
        appendedEventCount: (accept.data as any)?.append?.appendedEventCount,
        duplicateRejected: duplicate.ok === false,
        duplicateErrorCode: (duplicate as any).error?.code
      },
      feedback: {
        schemaVersion: (accept.data as any)?.feedback?.schemaVersion,
        feedbackId: (accept.data as any)?.feedback?.feedbackId,
        explicit: (accept.data as any)?.feedback?.explicit,
        implicitAcceptance: (accept.data as any)?.feedback?.implicitAcceptance,
        actorKind: (accept.data as any)?.feedback?.actor?.kind,
        actorSource: (accept.data as any)?.feedback?.actor?.source
      },
      book: {
        openCount: (bookOpen.data as any)?.recommendations?.length,
        latestStatuses: ((bookAll.data as any)?.recommendations ?? []).map((recommendation: any) => recommendation.status),
        explanationReasonCodes: ((bookAll.data as any)?.explanations ?? []).flatMap((explanation: any) => explanation.reasonCodes ?? [])
      },
      metrics: {
        schemaVersion: (metrics.data as any)?.schemaVersion,
        recommendationCount: (metrics.data as any)?.recommendationCount,
        feedbackCount: (metrics.data as any)?.feedbackCount,
        acceptedRecommendationRate: (metrics.data as any)?.acceptedRecommendationRate,
        agentAssistedResolutionRate: (metrics.data as any)?.agentAssistedResolutionRate,
        timeToResolution: (metrics.data as any)?.timeToResolution,
        reasonCodes: (metrics.data as any)?.reasonCodes ?? []
      },
      sqlite,
      privacy: inspectPrivacy({ accept, bookOpen, bookAll, metrics, sqlite }, [RAW_SOURCE_SENTINEL, "diff --git"])
    };
    return {
      ...packet,
      status: inspectArchitectureLedgerAl8LifecycleFeedbackReadback(packet).ok ? "verified" : "blocked"
    };
  } finally {
    await daemon.stop();
    store.close();
    if (previousStateDir === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previousStateDir;
    rmSync(workspace, { recursive: true, force: true });
  }
}

export function inspectArchitectureLedgerAl8LifecycleFeedbackReadback(packet: any) {
  const failures: string[] = [];
  if (packet?.schemaVersion !== SCHEMA_VERSION) failures.push("schema-version");
  for (const gate of GATES) {
    if (!packet?.gates?.includes(gate)) failures.push(`gate-missing:${gate}`);
  }
  if (packet?.lifecycle?.cliOk !== true) failures.push("lifecycle-cli-command-failed");
  if (packet?.lifecycle?.previousStatus !== "open") failures.push("lifecycle-previous-status");
  if (packet?.lifecycle?.nextStatus !== "accepted") failures.push("lifecycle-next-status");
  if (packet?.lifecycle?.appendedEventCount !== 1) failures.push("lifecycle-not-appended-once");
  if (packet?.lifecycle?.duplicateRejected !== true) failures.push("lifecycle-duplicate-not-rejected");
  if (packet?.feedback?.schemaVersion !== "archcontext.recommendation-feedback/v1") failures.push("feedback-schema-version");
  if (packet?.feedback?.explicit !== true) failures.push("feedback-not-explicit");
  if (packet?.feedback?.implicitAcceptance !== false) failures.push("feedback-implicit-acceptance");
  if (packet?.feedback?.actorKind !== "subagent") failures.push("feedback-agent-actor-missing");
  if (packet?.book?.openCount !== 0) failures.push("book-open-includes-accepted");
  if (!packet?.book?.latestStatuses?.includes("accepted")) failures.push("book-latest-status-missing");
  if (packet?.metrics?.schemaVersion !== "archcontext.recommendation-lifecycle-metrics/v1") failures.push("metrics-schema-version");
  if (packet?.metrics?.recommendationCount !== 1) failures.push("metrics-recommendation-count");
  if (packet?.metrics?.feedbackCount !== 1) failures.push("metrics-feedback-count");
  if (packet?.metrics?.acceptedRecommendationRate !== 1) failures.push("metrics-accepted-rate");
  if (packet?.metrics?.agentAssistedResolutionRate !== 1) failures.push("metrics-agent-assisted-rate");
  if (packet?.metrics?.timeToResolution?.resolvedRecommendationCount !== 1) failures.push("metrics-time-to-resolution-count");
  if (packet?.sqlite?.feedbackRows !== 1) failures.push("sqlite-feedback-row-count");
  if (packet?.privacy?.containsForbiddenToken !== false) failures.push("privacy-forbidden-token");
  if (packet?.privacy?.topLevelRawFieldSeen !== false) failures.push("privacy-raw-field");
  return {
    ok: failures.length === 0,
    schemaVersion: `${SCHEMA_VERSION}.inspection`,
    gates: [...GATES],
    failures
  };
}

async function appendRecommendationRunFixture(store: SqliteLocalStore, root: string, now: string) {
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
    catalogDigest: digestJson({ fixture: "al8-lifecycle-catalog" } as unknown as Json),
    inputCursor: {
      source: "candidate-delta",
      baseDigest: digestJson({ base: "al8-lifecycle" } as unknown as Json),
      headDigest: digestJson({ head: "al8-lifecycle" } as unknown as Json),
      headSha: worktree.headSha,
      candidateDeltaDigest: digestJson({ delta: "al8-lifecycle" } as unknown as Json)
    },
    candidates: [{
      practiceId: "practice.al8.lifecycle",
      subject: "module.al8-lifecycle",
      confidence: "medium",
      enforcement: "advisory",
      evidenceBindingIds: ["binding.al8.lifecycle"],
      explanation: ["AL8 lifecycle recommendation requires explicit feedback."],
      riskSignals: ["boundary-change"],
      uncertaintySignals: [],
      score: 52
    }],
    now
  });
  const graphDigest = digestJson({ fixture: "empty-architecture-graph" } as unknown as Json);
  const inputDigest = digestJson({ runId: plan.run.runId, recommendationIds: plan.run.recommendationIds } as unknown as Json);
  const event: ArchitectureEventV1 = {
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
      producer: "architecture-ledger-al8-lifecycle-feedback-readback",
      command: "appendRecommendationRunFixture",
      inputDigest
    },
    payload: recommendationRunLedgerPayload(plan) as unknown as Json
  };
  await store.appendArchitectureEvents({ writer: "runtime-daemon", events: [event] });
  return plan;
}

function sqliteReadback(databasePath: string) {
  const db = new Database(databasePath, { readonly: true });
  try {
    const feedbackRows = Number((db.query("SELECT COUNT(*) AS count FROM recommendation_feedback").get() as any)?.count ?? 0);
    const recommendationRows = Number((db.query("SELECT COUNT(*) AS count FROM recommendations").get() as any)?.count ?? 0);
    const feedback = db.query("SELECT feedback_json FROM recommendation_feedback LIMIT 1").get() as { feedback_json?: string } | undefined;
    return {
      feedbackRows,
      recommendationRows,
      feedbackDigest: feedback?.feedback_json ? digestJson(JSON.parse(feedback.feedback_json) as Json) : null
    };
  } finally {
    db.close();
  }
}

function inspectPrivacy(packet: unknown, forbiddenTokens: string[]) {
  const serialized = JSON.stringify(packet);
  return {
    containsForbiddenToken: forbiddenTokens.some((token) => serialized.includes(token)),
    topLevelRawFieldSeen: findForbiddenKey(packet, new Set(["sourceCode", "rawDiff", "prompt", "completion"]))
  };
}

function findForbiddenKey(value: unknown, forbidden: Set<string>): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((entry) => findForbiddenKey(entry, forbidden));
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) return true;
    if (findForbiddenKey(child, forbidden)) return true;
  }
  return false;
}

function createInitializedGitRepo(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "README.md"), "# AL8 lifecycle readback\n", "utf8");
  initializeArchContextModel(root, "AL8 Lifecycle Readback");
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["config", "user.name", "ArchContext Readback"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["config", "user.email", "archcontext-readback@example.test"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["add", "."], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function gitOut(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function renderHuman(result: { ok: boolean; failures: string[] }) {
  return result.ok
    ? "[architecture-ledger-al8-lifecycle-feedback-readback] ok"
    : `[architecture-ledger-al8-lifecycle-feedback-readback] failed: ${result.failures.join(", ")}`;
}

function renderReport(packet: any) {
  return [
    "# AL8 Lifecycle Feedback Readback",
    "",
    `Generated: ${packet.generatedAt}`,
    `Status: ${packet.status}`,
    "",
    "## Gates",
    "",
    ...GATES.map((gate) => `- ${gate}`),
    "",
    "## Readback",
    "",
    `- Lifecycle: ${packet.lifecycle.previousStatus} -> ${packet.lifecycle.nextStatus}`,
    `- Feedback explicit: ${packet.feedback.explicit}`,
    `- Implicit acceptance: ${packet.feedback.implicitAcceptance}`,
    `- Book open count: ${packet.book.openCount}`,
    `- Accepted recommendation rate: ${packet.metrics.acceptedRecommendationRate}`,
    `- Agent-assisted resolution rate: ${packet.metrics.agentAssistedResolutionRate}`,
    `- Feedback rows: ${packet.sqlite.feedbackRows}`,
    "",
    "## Privacy",
    "",
    `- Forbidden token found: ${packet.privacy.containsForbiddenToken}`,
    `- Raw field found: ${packet.privacy.topLevelRawFieldSeen}`,
    ""
  ].join("\n");
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
