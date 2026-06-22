#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { inspectFg5CheckFailureReadback } from "./fg5-check-failure-readback";
import { inspectFg5IncidentDrill } from "./fg5-control-plane-incident-drill";

const DEFAULT_CHECK_FAILURE_SOURCE = "docs/verification/fg5-check-failure-readback.json";
const DEFAULT_INCIDENT_DRILL_SOURCE = "docs/verification/fg5-control-plane-incident-drill.json";
const DEFAULT_CONTROL_PLANE_GATE = "docs/verification/fg5-control-plane-gate.md";
const DEFAULT_CONTROL_PLANE_TEST = "packages/cloud/control-plane/test/control-plane.test.ts";
const DEFAULT_OUTPUT = "docs/verification/fg6-chaos-fault-matrix-readback.json";
const REQUIRED_FAILURE_CLASSES = ["webhook", "verify", "queue", "github-api"] as const;
const SECRET_PATTERNS = [
  /gh[opsu]_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /GITHUB_WEBHOOK_SECRET/i,
  /sha256=[a-f0-9]{64}/i,
  /keychain:\/\//i,
  /sk-[A-Za-z0-9_-]{16,}/i
] as const;
const CODE_CONTENT_PATTERNS = [
  /diff\s+--git/i,
  /^@@\s/m,
  /"patch"\s*:/i,
  /"sourceBody"\s*:/i,
  /"diffBody"\s*:/i,
  /\/contents(?:\/|\b)/i,
  /\/git\/blobs(?:\/|\b)/i,
  /\/git\/trees(?:\/|\b)/i,
  /\/pulls\/\d+\/files/i,
  /application\/vnd\.github\.(?:v3\.)?(?:diff|patch)/i
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildFg6ChaosFaultMatrixConfig(process.env, args);
    const result = await runFg6ChaosFaultMatrix(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg6ChaosFaultMatrix(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg6-chaos-fault-matrix-readback] usage: run|inspect [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg6ChaosFaultMatrixConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    checkFailureSource: readFlag(args, "--check-failure-source") ?? env.ARCHCONTEXT_FG6_CHECK_FAILURE_SOURCE ?? DEFAULT_CHECK_FAILURE_SOURCE,
    incidentDrillSource: readFlag(args, "--incident-drill-source") ?? env.ARCHCONTEXT_FG6_INCIDENT_DRILL_SOURCE ?? DEFAULT_INCIDENT_DRILL_SOURCE,
    controlPlaneGate: readFlag(args, "--control-plane-gate") ?? env.ARCHCONTEXT_FG6_CONTROL_PLANE_GATE ?? DEFAULT_CONTROL_PLANE_GATE,
    controlPlaneTest: readFlag(args, "--control-plane-test") ?? env.ARCHCONTEXT_FG6_CONTROL_PLANE_TEST ?? DEFAULT_CONTROL_PLANE_TEST,
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_CHAOS_FAULT_MATRIX_OUTPUT ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg6ChaosFaultMatrix(config: ReturnType<typeof buildFg6ChaosFaultMatrixConfig>) {
  const [checkFailureSource, incidentDrillSource, controlPlaneGate, controlPlaneTest] = await Promise.all([
    readJson(resolve(config.root, config.checkFailureSource)),
    readJson(resolve(config.root, config.incidentDrillSource)),
    readFile(resolve(config.root, config.controlPlaneGate), "utf8"),
    readFile(resolve(config.root, config.controlPlaneTest), "utf8")
  ]);
  const checkFailureInspection = inspectFg5CheckFailureReadback(checkFailureSource);
  const incidentDrillInspection = inspectFg5IncidentDrill(incidentDrillSource);
  const checkFailure = summarizeCheckFailure(checkFailureSource);
  const incidents = summarizeIncidents(incidentDrillSource);
  const controlPlaneFaultContracts = summarizeControlPlaneFaultContracts(controlPlaneGate, controlPlaneTest);
  const recording = {
    schemaVersion: "archcontext.fg6-chaos-fault-matrix-readback/v1",
    taskId: "FG6-10",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: config.generatedAt(),
    sources: {
      checkFailureSource: config.checkFailureSource,
      incidentDrillSource: config.incidentDrillSource,
      controlPlaneGate: config.controlPlaneGate,
      controlPlaneTest: config.controlPlaneTest
    },
    evidence: {
      checkFailure,
      incidents,
      controlPlaneFaultContracts,
      sourceInspections: {
        checkFailure: checkFailureInspection,
        incidentDrill: incidentDrillInspection
      },
      assertions: {
        webhookChaosCovered: incidents.failureClasses.includes("webhook")
          && controlPlaneFaultContracts.webhookIdempotency.duplicateDeliveryLeavesOneRow === true,
        databaseChaosCovered: controlPlaneFaultContracts.databaseTransactionRollback.statementLevelFaultInjection === true
          && controlPlaneFaultContracts.databaseTransactionRollback.checkDeliveryInsertRollback === true
          && controlPlaneFaultContracts.databaseTransactionRollback.challengeUpdateRollback === true
          && controlPlaneFaultContracts.databaseTransactionRollback.challengeLeftLeased === true,
        queueChaosCovered: checkFailure.queueRetryEnqueueCount === 2
          && checkFailure.queueReplayEnqueued === true
          && incidents.failureClasses.includes("queue")
          && controlPlaneFaultContracts.queueAfterCommitFailure.doesNotRollbackAcceptedPersistence === true,
        githubApiChaosCovered: checkFailure.checkApiFailureInjected === true
          && checkFailure.injectedGitHubApiFailureCount >= 2
          && incidents.failureClasses.includes("github-api"),
        clockSkewChaosCovered: controlPlaneFaultContracts.clockSkewLimits.testRejectsClockSkew === true
          && controlPlaneFaultContracts.clockSkewLimits.gateRejectsClockSkew === true,
        noDuplicateCheckConclusionGuarded: controlPlaneFaultContracts.currentHeadCheckGuards.supersededHeadDeadLetters === true
          && controlPlaneFaultContracts.currentHeadCheckGuards.headShaMismatchDeadLetters === true
          && controlPlaneFaultContracts.currentHeadCheckGuards.noStaleConclusion === true,
        replayRestoresPendingWithoutAttempts: checkFailure.replayStatusAfterReplay === "PENDING"
          && checkFailure.replayAttemptCountAfterReplay === 0
      }
    },
    failures: [] as string[]
  };
  const inspection = inspectFg6ChaosFaultMatrix(recording);
  recording.status = inspection.ok ? "verified" : "failed";
  recording.ok = inspection.ok;
  recording.failures = inspection.failures;
  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(recording, null, 2)}\n`, "utf8");
  return recording;
}

export function inspectFg6ChaosFaultMatrix(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const checkFailure = readRecord(evidence.checkFailure);
  const incidents = readRecord(evidence.incidents);
  const contracts = readRecord(evidence.controlPlaneFaultContracts);
  const sourceInspections = readRecord(evidence.sourceInspections);
  const assertions = readRecord(evidence.assertions);

  if (record.schemaVersion !== "archcontext.fg6-chaos-fault-matrix-readback/v1") failures.push("schemaVersion mismatch");
  if (record.taskId !== "FG6-10") failures.push("taskId must be FG6-10");
  if (record.environment !== "staging-release-readback") failures.push("environment must be staging-release-readback");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  for (const [name, inspection] of Object.entries(sourceInspections)) {
    if (readRecord(inspection).ok !== true) failures.push(`${name} source inspection must pass`);
  }

  inspectCheckFailure(checkFailure, failures);
  inspectIncidents(incidents, failures);
  inspectControlPlaneFaultContracts(contracts, failures);
  for (const key of [
    "webhookChaosCovered",
    "databaseChaosCovered",
    "queueChaosCovered",
    "githubApiChaosCovered",
    "clockSkewChaosCovered",
    "noDuplicateCheckConclusionGuarded",
    "replayRestoresPendingWithoutAttempts"
  ]) {
    if (assertions[key] !== true) failures.push(`assertion ${key} must be true`);
  }

  const serialized = JSON.stringify(recording);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden secret marker: ${pattern}`);
  }
  for (const pattern of CODE_CONTENT_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden code-content marker: ${pattern}`);
  }
  return { ok: failures.length === 0, failures };
}

function summarizeCheckFailure(source: unknown) {
  const evidence = readRecord(readRecord(source).evidence);
  const retry = readRecord(evidence.retry);
  const maxAttemptDecision = readRecord(retry.maxAttemptDecision);
  const deadLetter = readRecord(evidence.deadLetter);
  const replay = readRecord(evidence.replay);
  const queue = readRecord(evidence.queue);
  const injectedFailures = Array.isArray(evidence.injectedGitHubApiFailures) ? evidence.injectedGitHubApiFailures.map(readRecord) : [];
  const sentMessages = Array.isArray(queue.sentMessages) ? queue.sentMessages.map(readRecord) : [];
  return {
    checkApiFailureInjected: evidence.checkApiFailureInjected,
    checkName: evidence.checkName,
    injectedGitHubApiFailureCount: injectedFailures.length,
    injectedStatusCodes: injectedFailures.map((failure) => Number(failure.statusCode ?? 0)),
    retryScheduledCount: Array.isArray(retry.scheduled) ? retry.scheduled.length : 0,
    maxAttemptsReached: retry.maxAttemptsReached,
    maxAttemptRetry: maxAttemptDecision.retry,
    maxAttemptReason: maxAttemptDecision.reason,
    deadLetterStatus: deadLetter.status,
    deadLetterErrorCode: deadLetter.lastErrorCode,
    replayed: replay.replayed,
    replaySource: replay.source,
    replayStatusAfterReplay: replay.statusAfterReplay,
    replayAttemptCountAfterReplay: Number(replay.attemptCountAfterReplay ?? -1),
    replayLastErrorCodeAfterReplay: replay.lastErrorCodeAfterReplay,
    queueSchemaVersion: queue.schemaVersion,
    queueRetryEnqueueCount: Number(queue.retryEnqueueCount ?? -1),
    queueReplayEnqueued: queue.replayEnqueued,
    queueMessageStatuses: sentMessages.map((item) => String(readRecord(item.message).status ?? "")),
    queueSentMessageCount: sentMessages.length
  };
}

function summarizeIncidents(source: unknown) {
  const evidence = readRecord(readRecord(source).evidence);
  const dashboard = readRecord(evidence.dashboard);
  const rows = Array.isArray(dashboard.rows) ? dashboard.rows.map(readRecord) : [];
  return {
    alertKinds: Array.isArray(evidence.alertKinds) ? evidence.alertKinds.map(String).sort() : [],
    failureClasses: rows.map((row) => String(row.failureClass ?? "")).sort(),
    rows: rows.map((row) => ({
      failureClass: row.failureClass,
      alertKind: row.alertKind,
      severity: row.severity,
      surface: row.surface,
      status: row.status,
      runbookPath: row.runbookPath,
      runbookSection: row.runbookSection,
      metricKeys: Array.isArray(row.metricKeys) ? row.metricKeys.map(String).sort() : []
    }))
  };
}

function summarizeControlPlaneFaultContracts(gateText: string, testText: string) {
  return {
    webhookIdempotency: {
      duplicateDeliveryLeavesOneRow: gateText.includes("duplicate Webhook delivery") && gateText.includes("leave one Webhook projection")
        || gateText.includes("duplicate Webhook delivery insert must throw and leave one row"),
      durablePrimaryKeyMentioned: gateText.includes("durable primary key leaves one Webhook projection")
    },
    databaseTransactionRollback: {
      statementLevelFaultInjection: gateText.includes("statement-level failure shim"),
      checkDeliveryInsertRollback: gateText.includes("INSERT INTO check_deliveries") && gateText.includes("zero Attestation and zero Check delivery rows"),
      challengeUpdateRollback: gateText.includes("UPDATE review_challenges") && gateText.includes("zero Attestation and zero Check delivery rows"),
      challengeLeftLeased: gateText.includes("Challenge in `LEASED`") && gateText.includes("`consumed_at` null"),
      leasePreserved: gateText.includes("preserves lease owner/expiry")
    },
    queueAfterCommitFailure: {
      doesNotRollbackAcceptedPersistence: gateText.includes("Queue send failure after accepted persistence does not roll back the submitted Challenge or persisted Attestation"),
      acceptedSubmitCreatesPendingDelivery: gateText.includes("Accepted submit creates a PENDING Check delivery row before queue publication")
    },
    clockSkewLimits: {
      testRejectsClockSkew: testText.includes("api-clock-skew-too-large")
        && testText.includes("enforces API body rate clock skew and Challenge expiry limits"),
      gateRejectsClockSkew: gateText.includes("Request clock skew greater than `WORKER_LIMITS.maxClockSkewMs` rejects"),
      bodyLimitGuard: testText.includes("api-body-too-large"),
      rateLimitGuard: testText.includes("api-rate-limit-exceeded")
    },
    currentHeadCheckGuards: {
      supersededHeadDeadLetters: testText.includes("CHALLENGE_SUPERSEDED") && gateText.includes("Success publication rejects superseded old-head deliveries"),
      headShaMismatchDeadLetters: testText.includes("HEAD_SHA_MISMATCH") && gateText.includes("Success publication rejects current PR head races"),
      trustMismatchDeadLetters: testText.includes("TRUST_LEVEL_MISMATCH") && gateText.includes("Success publication rejects Check context mismatches"),
      noStaleConclusion: testText.includes("not.toContain(\"stale\")") && gateText.includes("does not emit or depend on a `stale` Check conclusion")
    }
  };
}

function inspectCheckFailure(checkFailure: Record<string, unknown>, failures: string[]): void {
  if (checkFailure.checkApiFailureInjected !== true) failures.push("checkFailure must inject GitHub Check API failure");
  if (checkFailure.checkName !== "ArchContext / Developer Review") failures.push("checkFailure checkName mismatch");
  if (Number(checkFailure.injectedGitHubApiFailureCount ?? 0) < 2) failures.push("checkFailure must include at least two GitHub API failures");
  const statusCodes = Array.isArray(checkFailure.injectedStatusCodes) ? checkFailure.injectedStatusCodes.map(Number) : [];
  if (!statusCodes.every((status) => status >= 500)) failures.push("checkFailure injected status codes must be 5xx");
  if (Number(checkFailure.retryScheduledCount ?? 0) !== 2) failures.push("checkFailure retryScheduledCount must be 2");
  if (checkFailure.maxAttemptsReached !== true) failures.push("checkFailure maxAttemptsReached must be true");
  if (checkFailure.maxAttemptRetry !== false) failures.push("checkFailure maxAttemptRetry must be false");
  if (checkFailure.maxAttemptReason !== "check-delivery-max-attempts-reached") failures.push("checkFailure max attempt reason mismatch");
  if (checkFailure.deadLetterStatus !== "DEAD_LETTER") failures.push("checkFailure deadLetterStatus must be DEAD_LETTER");
  if (checkFailure.deadLetterErrorCode !== "CHECK_DELIVERY_MAX_ATTEMPTS") failures.push("checkFailure deadLetterErrorCode mismatch");
  if (checkFailure.replayed !== true) failures.push("checkFailure replayed must be true");
  if (checkFailure.replaySource !== "manual-ops") failures.push("checkFailure replaySource must be manual-ops");
  if (checkFailure.replayStatusAfterReplay !== "PENDING") failures.push("checkFailure replay status must be PENDING");
  if (Number(checkFailure.replayAttemptCountAfterReplay ?? -1) !== 0) failures.push("checkFailure replay attempt count must reset");
  if (checkFailure.replayLastErrorCodeAfterReplay !== null) failures.push("checkFailure replay last error must reset");
  if (checkFailure.queueSchemaVersion !== "archcontext.check-delivery-queue-message/v1") failures.push("checkFailure queue schema mismatch");
  if (Number(checkFailure.queueRetryEnqueueCount ?? -1) !== 2) failures.push("checkFailure queueRetryEnqueueCount must be 2");
  if (checkFailure.queueReplayEnqueued !== true) failures.push("checkFailure queueReplayEnqueued must be true");
  if (Number(checkFailure.queueSentMessageCount ?? -1) !== 3) failures.push("checkFailure queueSentMessageCount must be 3");
  const statuses = Array.isArray(checkFailure.queueMessageStatuses) ? checkFailure.queueMessageStatuses.map(String) : [];
  if (statuses.filter((status) => status === "RETRYING").length !== 2) failures.push("checkFailure queue must include two RETRYING messages");
  if (!statuses.includes("PENDING")) failures.push("checkFailure queue must include PENDING replay message");
}

function inspectIncidents(incidents: Record<string, unknown>, failures: string[]): void {
  const alertKinds = readStringArray(incidents.alertKinds);
  const failureClasses = readStringArray(incidents.failureClasses);
  for (const kind of ["webhook-backlog", "verify-failure", "check-dlq", "github-api-failure"]) {
    if (!alertKinds.includes(kind)) failures.push(`incident alert kind missing: ${kind}`);
  }
  for (const failureClass of REQUIRED_FAILURE_CLASSES) {
    if (!failureClasses.includes(failureClass)) failures.push(`incident failureClass missing: ${failureClass}`);
  }
  const rows = Array.isArray(incidents.rows) ? incidents.rows.map(readRecord) : [];
  for (const failureClass of REQUIRED_FAILURE_CLASSES) {
    const row = rows.find((candidate) => candidate.failureClass === failureClass);
    if (!row) continue;
    if (row.runbookPath !== "docs/runbooks/control-plane-incidents.md") failures.push(`${failureClass} runbook path mismatch`);
    if (row.runbookSection !== row.alertKind) failures.push(`${failureClass} runbook section mismatch`);
    if (!Array.isArray(row.metricKeys) || row.metricKeys.length === 0) failures.push(`${failureClass} metric keys missing`);
  }
}

function inspectControlPlaneFaultContracts(contracts: Record<string, unknown>, failures: string[]): void {
  const webhook = readRecord(contracts.webhookIdempotency);
  const db = readRecord(contracts.databaseTransactionRollback);
  const queue = readRecord(contracts.queueAfterCommitFailure);
  const clock = readRecord(contracts.clockSkewLimits);
  const currentHead = readRecord(contracts.currentHeadCheckGuards);
  for (const key of ["duplicateDeliveryLeavesOneRow", "durablePrimaryKeyMentioned"]) {
    if (webhook[key] !== true) failures.push(`webhookIdempotency.${key} must be true`);
  }
  for (const key of ["statementLevelFaultInjection", "checkDeliveryInsertRollback", "challengeUpdateRollback", "challengeLeftLeased", "leasePreserved"]) {
    if (db[key] !== true) failures.push(`databaseTransactionRollback.${key} must be true`);
  }
  for (const key of ["doesNotRollbackAcceptedPersistence", "acceptedSubmitCreatesPendingDelivery"]) {
    if (queue[key] !== true) failures.push(`queueAfterCommitFailure.${key} must be true`);
  }
  for (const key of ["testRejectsClockSkew", "gateRejectsClockSkew", "bodyLimitGuard", "rateLimitGuard"]) {
    if (clock[key] !== true) failures.push(`clockSkewLimits.${key} must be true`);
  }
  for (const key of ["supersededHeadDeadLetters", "headShaMismatchDeadLetters", "trustMismatchDeadLetters", "noStaleConclusion"]) {
    if (currentHead[key] !== true) failures.push(`currentHeadCheckGuards.${key} must be true`);
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function renderHuman(result: Awaited<ReturnType<typeof runFg6ChaosFaultMatrix>>): string {
  return [
    `[fg6-chaos-fault-matrix-readback] ${result.ok ? "OK" : "FAILED"}`,
    `- failure classes: ${result.evidence.incidents.failureClasses.join(",")}`,
    `- retry queue: ${result.evidence.checkFailure.queueRetryEnqueueCount} retries replay=${result.evidence.checkFailure.queueReplayEnqueued}`,
    ...result.failures.map((failure) => `- ${failure}`)
  ].join("\n");
}

function renderInspectHuman(result: ReturnType<typeof inspectFg6ChaosFaultMatrix>): string {
  if (result.ok) return "[fg6-chaos-fault-matrix-readback] OK";
  return ["[fg6-chaos-fault-matrix-readback] FAILED", ...result.failures.map((failure) => `- ${failure}`)].join("\n");
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
