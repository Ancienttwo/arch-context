#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ControlPlane, CONTROL_PLANE_ALERT_RUNBOOK_PATH, type ControlPlaneAlert } from "@archcontext/cloud/control-plane";
import type { CheckDelivery } from "@archcontext/contracts";

const DEFAULT_OUTPUT = "docs/verification/fg5-control-plane-incident-drill.json";
const REQUIRED_FAILURE_CLASSES = ["webhook", "verify", "queue", "github-api"] as const;
const SECRET_PATTERNS = [
  /gh[opsu]_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /GITHUB_WEBHOOK_SECRET/i,
  /installation[_-]?token/i,
  /jwt/i
] as const;
const CODE_CONTENT_PATTERNS = [
  /diff\s+--git/i,
  /^@@\s/m,
  /"patch"\s*:/i,
  /"fileBody"\s*:/i,
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
    const config = buildFg5IncidentDrillConfig(process.env, args);
    const result = await runFg5IncidentDrill(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg5IncidentDrill(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg5-control-plane-incident-drill] usage: run|inspect [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg5IncidentDrillConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG5_INCIDENT_DRILL_OUTPUT ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    now: readFlag(args, "--now") ?? "2026-06-21T18:00:00.000Z",
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg5IncidentDrill(config: ReturnType<typeof buildFg5IncidentDrillConfig>) {
  const cp = new ControlPlane();
  const deadLetter: CheckDelivery = {
    schemaVersion: "archcontext.check-delivery/v1",
    deliveryId: "chkdel_fg5_incident_queue",
    challengeId: "chal_fg5_incident_queue",
    checkRunId: null,
    checkName: "ArchContext / Developer Review",
    headSha: "a".repeat(40),
    status: "DEAD_LETTER",
    attemptCount: 3,
    nextAttemptAt: null,
    lastErrorCode: "CHECK_DELIVERY_MAX_ATTEMPTS",
    createdAt: "2026-06-21T17:45:00.000Z",
    updatedAt: "2026-06-21T17:50:00.000Z"
  };
  const alerts = cp.evaluateControlPlaneAlerts({
    now: config.now,
    webhookBacklog: {
      pendingCount: 24,
      oldestReceivedAt: "2026-06-21T17:50:00.000Z"
    },
    verifyFailures: {
      failureCount: 3,
      reasonCode: "TRUST_LEVEL_MISMATCH"
    },
    checkDeliveries: [deadLetter],
    githubApiFailures: {
      failureCount: 4,
      statusCode: 503,
      retryable: true,
      windowStartedAt: "2026-06-21T17:57:00.000Z"
    },
    thresholds: {
      webhookBacklogCount: 10,
      webhookBacklogOldestAgeMs: 5 * 60 * 1000,
      verifyFailureCount: 1,
      checkDlqCount: 1,
      githubApiFailureCount: 2,
      githubApiFailureWindowMs: 5 * 60 * 1000
    }
  });
  const dashboard = buildDashboardMatrix(alerts);
  const recording = {
    schemaVersion: "archcontext.fg5-control-plane-incident-drill/v1",
    environment: "staging-drill",
    status: "verified",
    ok: true,
    generatedAt: config.generatedAt(),
    config: {
      output: config.outputPath,
      now: config.now
    },
    evidence: {
      alertKinds: alerts.map((alert) => alert.kind),
      alerts,
      dashboard
    },
    privacy: scanPrivacy({ alerts, dashboard }),
    failures: [] as string[]
  };
  const inspection = inspectFg5IncidentDrill(recording);
  recording.status = inspection.ok ? "verified" : "failed";
  recording.ok = inspection.ok;
  recording.failures = inspection.failures;
  await writeRecording(config, recording);
  return recording;
}

export function inspectFg5IncidentDrill(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const dashboard = readRecord(evidence.dashboard);
  const privacy = readRecord(record.privacy);
  if (record.schemaVersion !== "archcontext.fg5-control-plane-incident-drill/v1") failures.push("schemaVersion mismatch");
  if (record.environment !== "staging-drill") failures.push("environment must be staging-drill");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  const alerts = Array.isArray(evidence.alerts) ? evidence.alerts.map(readRecord) : [];
  const alertKinds = alerts.map((alert) => String(alert.kind ?? ""));
  for (const kind of ["webhook-backlog", "verify-failure", "check-dlq", "github-api-failure"]) {
    if (!alertKinds.includes(kind)) failures.push(`alert kind missing: ${kind}`);
  }
  const rows = Array.isArray(dashboard.rows) ? dashboard.rows.map(readRecord) : [];
  for (const failureClass of REQUIRED_FAILURE_CLASSES) {
    const row = rows.find((item) => item.failureClass === failureClass);
    if (!row) {
      failures.push(`dashboard row missing: ${failureClass}`);
      continue;
    }
    if (row.runbookPath !== CONTROL_PLANE_ALERT_RUNBOOK_PATH) failures.push(`${failureClass} runbook path mismatch`);
    if (row.runbookSection !== row.alertKind) failures.push(`${failureClass} runbook section must match alert kind`);
    if (!Array.isArray(row.metricKeys) || row.metricKeys.length === 0) failures.push(`${failureClass} metric keys missing`);
  }
  if (Number(privacy.privateContentHits) !== 0) failures.push("privacy.privateContentHits must be 0");
  if (Number(privacy.secretMarkerHits) !== 0) failures.push("privacy.secretMarkerHits must be 0");
  if (Number(privacy.codeContentMarkerHits) !== 0) failures.push("privacy.codeContentMarkerHits must be 0");
  const serialized = JSON.stringify(recording);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden secret marker: ${pattern}`);
  }
  for (const pattern of CODE_CONTENT_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden code-content marker: ${pattern}`);
  }
  return { ok: failures.length === 0, failures };
}

function buildDashboardMatrix(alerts: ControlPlaneAlert[]) {
  const map: Record<(typeof REQUIRED_FAILURE_CLASSES)[number], string> = {
    webhook: "webhook-backlog",
    verify: "verify-failure",
    queue: "check-dlq",
    "github-api": "github-api-failure"
  };
  return {
    schemaVersion: "archcontext.control-plane-incident-dashboard/v1",
    rows: REQUIRED_FAILURE_CLASSES.map((failureClass) => {
      const alertKind = map[failureClass];
      const alert = alerts.find((candidate) => candidate.kind === alertKind);
      return {
        failureClass,
        alertKind,
        severity: alert?.severity ?? "missing",
        surface: alert?.labels.surface ?? "missing",
        status: alert?.labels.status ?? "missing",
        runbookPath: alert?.runbook.path ?? CONTROL_PLANE_ALERT_RUNBOOK_PATH,
        runbookSection: alert?.runbook.section ?? alertKind,
        metricKeys: alert ? Object.keys(alert.metrics).sort() : []
      };
    })
  };
}

function scanPrivacy(value: unknown) {
  const serialized = JSON.stringify(value);
  const secretMarkerHits = countPatterns(serialized, SECRET_PATTERNS);
  const codeContentMarkerHits = countPatterns(serialized, CODE_CONTENT_PATTERNS);
  return {
    privateContentHits: secretMarkerHits + codeContentMarkerHits,
    secretMarkerHits,
    codeContentMarkerHits
  };
}

function countPatterns(text: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

async function writeRecording(config: ReturnType<typeof buildFg5IncidentDrillConfig>, recording: unknown): Promise<void> {
  const output = resolve(config.root, config.outputPath);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(recording, null, 2)}\n`, "utf8");
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function renderHuman(result: { ok?: unknown; failures?: unknown }): string {
  const failures = Array.isArray(result.failures) ? result.failures.map(String) : [];
  return result.ok === true ? "FG5 control-plane incident drill verified" : `FG5 control-plane incident drill failed: ${failures.join("; ")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }): string {
  return result.ok ? "FG5 control-plane incident drill evidence verified" : `FG5 control-plane incident drill evidence failed: ${result.failures.join("; ")}`;
}
