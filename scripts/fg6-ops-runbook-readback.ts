#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { inspectFg3AttestationSecuritySuite } from "./fg3-attestation-security-suite";
import { inspectFg4RunnerKeyLifecycleE2e } from "./fg4-runner-key-lifecycle-e2e";
import { inspectFg5IncidentDrill } from "./fg5-control-plane-incident-drill";
import { inspectFg6ChaosFaultMatrix } from "./fg6-chaos-fault-matrix-readback";

const DEFAULT_RUNBOOK = "docs/runbooks/control-plane-incidents.md";
const DEFAULT_DEVICE_SOURCE = "docs/verification/fg3-attestation-security-suite.json";
const DEFAULT_RUNNER_SOURCE = "docs/verification/fg4-runner-key-lifecycle-e2e.json";
const DEFAULT_INCIDENT_SOURCE = "docs/verification/fg5-control-plane-incident-drill.json";
const DEFAULT_CHAOS_SOURCE = "docs/verification/fg6-chaos-fault-matrix-readback.json";
const DEFAULT_OUTPUT = "docs/verification/fg6-ops-runbook-readback.json";
const DEFAULT_REPORT = "docs/verification/fg6-ops-runbook.md";
const REQUIRED_SECTIONS = ["device-key-compromise", "runner-key-compromise", "github-outage", "queue-backlog"] as const;
const SECRET_PATTERNS = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /secret:\/\//i
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
    const config = buildFg6OpsRunbookConfig(process.env, args);
    const result = await runFg6OpsRunbook(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg6OpsRunbook(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg6-ops-runbook-readback] usage: run|inspect [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg6OpsRunbookConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    runbookPath: readFlag(args, "--runbook") ?? env.ARCHCONTEXT_FG6_OPS_RUNBOOK ?? DEFAULT_RUNBOOK,
    deviceSource: readFlag(args, "--device-source") ?? env.ARCHCONTEXT_FG6_DEVICE_SOURCE ?? DEFAULT_DEVICE_SOURCE,
    runnerSource: readFlag(args, "--runner-source") ?? env.ARCHCONTEXT_FG6_RUNNER_SOURCE ?? DEFAULT_RUNNER_SOURCE,
    incidentSource: readFlag(args, "--incident-source") ?? env.ARCHCONTEXT_FG6_INCIDENT_SOURCE ?? DEFAULT_INCIDENT_SOURCE,
    chaosSource: readFlag(args, "--chaos-source") ?? env.ARCHCONTEXT_FG6_CHAOS_SOURCE ?? DEFAULT_CHAOS_SOURCE,
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_OPS_RUNBOOK_OUTPUT ?? DEFAULT_OUTPUT,
    reportPath: readFlag(args, "--report") ?? env.ARCHCONTEXT_FG6_OPS_RUNBOOK_REPORT ?? DEFAULT_REPORT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg6OpsRunbook(config: ReturnType<typeof buildFg6OpsRunbookConfig>) {
  const [runbook, deviceSource, runnerSource, incidentSource, chaosSource] = await Promise.all([
    readFile(resolve(config.root, config.runbookPath), "utf8"),
    readJson(resolve(config.root, config.deviceSource)),
    readJson(resolve(config.root, config.runnerSource)),
    readJson(resolve(config.root, config.incidentSource)),
    readJson(resolve(config.root, config.chaosSource))
  ]);
  const sourceInspections = {
    device: inspectFg3AttestationSecuritySuite(deviceSource),
    runner: inspectFg4RunnerKeyLifecycleE2e(runnerSource),
    incident: inspectFg5IncidentDrill(incidentSource),
    chaos: inspectFg6ChaosFaultMatrix(chaosSource)
  };
  const runbookCoverage = summarizeRunbook(runbook);
  const operationalEvidence = {
    deviceKeyCompromise: summarizeDeviceEvidence(deviceSource),
    runnerKeyCompromise: summarizeRunnerEvidence(runnerSource),
    githubOutage: summarizeGithubOutageEvidence(chaosSource),
    queueBacklog: summarizeQueueBacklogEvidence(incidentSource, chaosSource)
  };
  const assertions = {
    runbookSectionsComplete: REQUIRED_SECTIONS.every((section) => runbookCoverage.sections[section]?.complete === true),
    deviceCompromiseEvidenceCovered: operationalEvidence.deviceKeyCompromise.revokedDeviceRejected === true
      && operationalEvidence.deviceKeyCompromise.nonceConsumed === false,
    runnerCompromiseEvidenceCovered: operationalEvidence.runnerKeyCompromise.revokedRunnerRejected === true
      && operationalEvidence.runnerKeyCompromise.nonceConsumed === false
      && operationalEvidence.runnerKeyCompromise.auditMetadataOnly === true,
    githubOutageEvidenceCovered: operationalEvidence.githubOutage.injectedGitHubApiFailureCount >= 2
      && operationalEvidence.githubOutage.deadLetterStatus === "DEAD_LETTER"
      && operationalEvidence.githubOutage.replayStatusAfterReplay === "PENDING",
    queueBacklogEvidenceCovered: operationalEvidence.queueBacklog.webhookBacklogAlert === true
      && operationalEvidence.queueBacklog.checkDlqAlert === true
      && operationalEvidence.queueBacklog.queueRetryEnqueueCount >= 2,
    allSourceInspectionsPassed: Object.values(sourceInspections).every((inspection) => inspection.ok === true),
    noPrivateContent: runbookCoverage.secretMarkerHits === 0 && runbookCoverage.codeContentMarkerHits === 0
  };
  const recording = {
    schemaVersion: "archcontext.fg6-ops-runbook-readback/v1",
    taskId: "FG6-16",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: config.generatedAt(),
    sources: {
      runbookPath: config.runbookPath,
      deviceSource: config.deviceSource,
      runnerSource: config.runnerSource,
      incidentSource: config.incidentSource,
      chaosSource: config.chaosSource,
      reportPath: config.reportPath
    },
    evidence: {
      sourceInspections,
      runbookCoverage,
      operationalEvidence,
      assertions
    },
    failures: [] as string[]
  };
  const inspection = inspectFg6OpsRunbook(recording);
  recording.status = inspection.ok ? "verified" : "failed";
  recording.ok = inspection.ok;
  recording.failures = inspection.failures;
  await writeText(config.root, config.reportPath, renderReport(recording));
  await writeJson(config.root, config.outputPath, recording);
  return recording;
}

export function inspectFg6OpsRunbook(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const sourceInspections = readRecord(evidence.sourceInspections);
  const runbookCoverage = readRecord(evidence.runbookCoverage);
  const sections = readRecord(runbookCoverage.sections);
  const operationalEvidence = readRecord(evidence.operationalEvidence);
  const device = readRecord(operationalEvidence.deviceKeyCompromise);
  const runner = readRecord(operationalEvidence.runnerKeyCompromise);
  const github = readRecord(operationalEvidence.githubOutage);
  const queue = readRecord(operationalEvidence.queueBacklog);
  const assertions = readRecord(evidence.assertions);

  if (record.schemaVersion !== "archcontext.fg6-ops-runbook-readback/v1") failures.push("schemaVersion mismatch");
  if (record.taskId !== "FG6-16") failures.push("taskId must be FG6-16");
  if (record.environment !== "staging-release-readback") failures.push("environment must be staging-release-readback");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  for (const [name, inspection] of Object.entries(sourceInspections)) {
    if (readRecord(inspection).ok !== true) failures.push(`${name} source inspection must pass`);
  }
  for (const section of REQUIRED_SECTIONS) {
    const coverage = readRecord(sections[section]);
    if (coverage.present !== true) failures.push(`runbook section missing: ${section}`);
    if (coverage.complete !== true) failures.push(`runbook section incomplete: ${section}`);
  }
  if (device.revokedDeviceRejected !== true || device.reasonCode !== "DEVICE_REVOKED") failures.push("device compromise evidence must reject revoked Device Key");
  if (device.nonceConsumed !== false) failures.push("device compromise evidence must preserve nonce");
  if (runner.revokedRunnerRejected !== true || runner.reasonCode !== "RUNNER_REVOKED") failures.push("runner compromise evidence must reject revoked Runner Key");
  if (runner.nonceConsumed !== false) failures.push("runner compromise evidence must preserve nonce");
  if (runner.auditMetadataOnly !== true) failures.push("runner compromise audit must be metadata-only");
  if (Number(github.injectedGitHubApiFailureCount ?? 0) < 2) failures.push("github outage evidence must inject GitHub API failures");
  if (github.deadLetterStatus !== "DEAD_LETTER") failures.push("github outage evidence must reach DLQ");
  if (github.replayStatusAfterReplay !== "PENDING") failures.push("github outage evidence must replay to PENDING");
  if (queue.webhookBacklogAlert !== true) failures.push("queue backlog evidence must include webhook-backlog");
  if (queue.checkDlqAlert !== true) failures.push("queue backlog evidence must include check-dlq");
  if (Number(queue.queueRetryEnqueueCount ?? 0) < 2) failures.push("queue backlog evidence must include retry queue messages");
  if (Number(runbookCoverage.secretMarkerHits ?? -1) !== 0) failures.push("runbook secret marker hits must be 0");
  if (Number(runbookCoverage.codeContentMarkerHits ?? -1) !== 0) failures.push("runbook code content marker hits must be 0");
  for (const key of [
    "runbookSectionsComplete",
    "deviceCompromiseEvidenceCovered",
    "runnerCompromiseEvidenceCovered",
    "githubOutageEvidenceCovered",
    "queueBacklogEvidenceCovered",
    "allSourceInspectionsPassed",
    "noPrivateContent"
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

function summarizeRunbook(runbook: string) {
  const sections: Record<string, any> = {};
  for (const section of REQUIRED_SECTIONS) {
    const body = sectionBody(runbook, section);
    const requiredTerms = termsForSection(section);
    const hasRequiredTerms = requiredTerms.every((term) => body.includes(term));
    sections[section] = {
      present: body.length > 0,
      hasSignal: body.includes("Signal:"),
      hasTriage: body.includes("Triage:"),
      hasRemediation: body.includes("Remediation:"),
      hasVerification: body.includes("Verification:"),
      requiredTerms,
      hasRequiredTerms,
      complete: body.length > 0
        && body.includes("Signal:")
        && body.includes("Triage:")
        && body.includes("Remediation:")
        && body.includes("Verification:")
        && hasRequiredTerms
    };
  }
  return {
    sections,
    secretMarkerHits: countMatches(runbook, SECRET_PATTERNS),
    codeContentMarkerHits: countMatches(runbook, CODE_CONTENT_PATTERNS)
  };
}

function summarizeDeviceEvidence(source: unknown) {
  const cases = readArray(readRecord(readRecord(source).evidence).cases).map(readRecord);
  const revoked = cases.find((item) => item.name === "revoked-device-key") ?? {};
  return {
    revokedDeviceRejected: revoked.rejected === true,
    reasonCode: revoked.observedReasonCode,
    nonceConsumed: revoked.nonceHashConsumed,
    consumedSetPreserved: revoked.consumedSetPreserved
  };
}

function summarizeRunnerEvidence(source: unknown) {
  const evidence = readRecord(readRecord(source).evidence);
  const revoke = readRecord(evidence.revoke);
  const submit = readRecord(revoke.postRevokeSubmit);
  const audit = readRecord(evidence.audit);
  const leaks = readRecord(evidence.leakCounters);
  return {
    revokedRunnerRejected: submit.accepted === false,
    reasonCode: submit.observedReasonCode,
    nonceConsumed: submit.nonceHashConsumed,
    consumedSetPreserved: submit.consumedSetPreserved,
    recoveryAction: revoke.recoveryAction,
    replacementRequired: revoke.replacementRequired,
    auditMetadataOnly: audit.metadataOnly,
    leakCounters: leaks
  };
}

function summarizeGithubOutageEvidence(source: unknown) {
  const checkFailure = readRecord(readRecord(readRecord(source).evidence).checkFailure);
  return {
    injectedGitHubApiFailureCount: Number(checkFailure.injectedGitHubApiFailureCount ?? 0),
    injectedStatusCodes: readArray(checkFailure.injectedStatusCodes).map(Number),
    deadLetterStatus: checkFailure.deadLetterStatus,
    deadLetterErrorCode: checkFailure.deadLetterErrorCode,
    replayStatusAfterReplay: checkFailure.replayStatusAfterReplay,
    replayAttemptCountAfterReplay: Number(checkFailure.replayAttemptCountAfterReplay ?? -1)
  };
}

function summarizeQueueBacklogEvidence(incidentSource: unknown, chaosSource: unknown) {
  const incidentEvidence = readRecord(readRecord(incidentSource).evidence);
  const alertKinds = readArray(incidentEvidence.alertKinds).map(String);
  const checkFailure = readRecord(readRecord(readRecord(chaosSource).evidence).checkFailure);
  return {
    webhookBacklogAlert: alertKinds.includes("webhook-backlog"),
    checkDlqAlert: alertKinds.includes("check-dlq"),
    queueRetryEnqueueCount: Number(checkFailure.queueRetryEnqueueCount ?? -1),
    queueReplayEnqueued: checkFailure.queueReplayEnqueued,
    queueMessageStatuses: readArray(checkFailure.queueMessageStatuses).map(String)
  };
}

function renderReport(recording: any): string {
  const evidence = recording.evidence.operationalEvidence;
  return `# FG6-16 Ops Runbook Readback

- Task: FG6-16
- Environment: ${recording.environment}
- Generated At: ${recording.generatedAt}
- Status: ${recording.status}

## Runbook Sections

| Scenario | Section | Evidence |
|---|---|---|
| Device Key compromise | \`device-key-compromise\` | revoked Device reason ${evidence.deviceKeyCompromise.reasonCode}; nonceConsumed=${evidence.deviceKeyCompromise.nonceConsumed} |
| Runner Key compromise | \`runner-key-compromise\` | revoked Runner reason ${evidence.runnerKeyCompromise.reasonCode}; recovery=${evidence.runnerKeyCompromise.recoveryAction} |
| GitHub outage | \`github-outage\` | injected failures ${evidence.githubOutage.injectedGitHubApiFailureCount}; DLQ=${evidence.githubOutage.deadLetterStatus}; replay=${evidence.githubOutage.replayStatusAfterReplay} |
| Queue backlog | \`queue-backlog\` | webhookBacklog=${evidence.queueBacklog.webhookBacklogAlert}; checkDlq=${evidence.queueBacklog.checkDlqAlert}; retryMessages=${evidence.queueBacklog.queueRetryEnqueueCount} |

## Decision

${recording.ok ? "PASS" : "FAIL"} for FG6-16 ops/security runbook coverage.
`;
}

function termsForSection(section: string): string[] {
  if (section === "device-key-compromise") return ["Device Key", "DEVICE_REVOKED", "nonce consumption", "replacement Device Key"];
  if (section === "runner-key-compromise") return ["Runner Key", "RUNNER_REVOKED", "Secret Store", "Organization-required Challenge"];
  if (section === "github-outage") return ["github-api-failure", "retry/backoff", "DEAD_LETTER", "PENDING"];
  if (section === "queue-backlog") return ["webhook-backlog", "check-dlq", "pending webhook", "DLQ"];
  return [];
}

function sectionBody(text: string, section: string): string {
  const start = text.indexOf(`## ${section}\n`);
  if (start === -1) return "";
  const next = text.indexOf("\n## ", start + 1);
  return text.slice(start, next === -1 ? text.length : next);
}

function renderHuman(recording: any): string {
  return `[fg6-ops-runbook-readback] ${recording.status} sections=${Object.keys(recording.evidence.runbookCoverage.sections).length}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }): string {
  return result.ok ? "[fg6-ops-runbook-readback] ok" : `[fg6-ops-runbook-readback] failed\n${result.failures.map((failure) => `- ${failure}`).join("\n")}`;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function writeJson(root: string, path: string, value: unknown): Promise<void> {
  await writeText(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(root: string, path: string, value: string): Promise<void> {
  const absolutePath = resolve(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, value);
}

function readRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function countMatches(text: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}
