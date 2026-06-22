#!/usr/bin/env bun
import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_ENV_FILE = "_ops/env/fg2-staging.env";
const DEFAULT_OUTPUT = "docs/verification/fg5-check-failure-readback.json";
const DEFAULT_STAGING_URL = "https://archcontext.repoharness.com";
const FG5_CHECK_FAILURE_READBACK_PATH = "/v1/fg5/check-delivery/failure-injection";
const READBACK_SIGNATURE_HEADER = "x-archcontext-readback-signature";
const READBACK_TIMESTAMP_HEADER = "x-archcontext-readback-timestamp";
const SECRET_PATTERNS = [
  /gh[opsu]_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /GITHUB_WEBHOOK_SECRET/i,
  /installation[_-]?token/i,
  /jwt/i,
  /x-hub-signature/i,
  /signature256/i,
  /webhookSecret/i
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
    const config = await buildFg5CheckFailureReadbackConfig(process.env, args);
    const result = await runFg5CheckFailureReadback(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg5CheckFailureReadback(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg5-check-failure-readback] usage: run|inspect [--env-file path] [--out path] [--staging-url url] [--json]");
    process.exit(2);
  }
}

export async function buildFg5CheckFailureReadbackConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  const root = readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd();
  const envFile = readFlag(args, "--env-file") ?? env.ARCHCONTEXT_FG5_STAGING_ENV_FILE ?? DEFAULT_ENV_FILE;
  const outputPath = readFlag(args, "--out") ?? env.ARCHCONTEXT_FG5_CHECK_FAILURE_OUTPUT ?? DEFAULT_OUTPUT;
  const dotenv = parseDotenv(await readFile(resolve(root, envFile), "utf8"));
  return {
    root,
    envFile,
    outputPath,
    stagingUrl: normalizeBaseUrl(readFlag(args, "--staging-url") ?? env.ARCHCONTEXT_STAGING_URL ?? dotenv.ARCHCONTEXT_STAGING_URL ?? DEFAULT_STAGING_URL),
    webhookSecret: readFlag(args, "--webhook-secret") ?? env.GITHUB_WEBHOOK_SECRET ?? dotenv.GITHUB_WEBHOOK_SECRET ?? "",
    json: args.includes("--json"),
    now: () => new Date().toISOString()
  };
}

export async function runFg5CheckFailureReadback(config: Awaited<ReturnType<typeof buildFg5CheckFailureReadbackConfig>>) {
  const generatedAt = config.now();
  const failures: string[] = [];
  if (!config.webhookSecret) failures.push("GITHUB_WEBHOOK_SECRET missing");
  if (failures.length > 0) {
    const failed = failedRecording(config, generatedAt, failures);
    await writeRecording(config, failed);
    return failed;
  }

  const url = new URL(FG5_CHECK_FAILURE_READBACK_PATH, config.stagingUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      [READBACK_TIMESTAMP_HEADER]: generatedAt,
      [READBACK_SIGNATURE_HEADER]: signReadback({
        secret: config.webhookSecret,
        method: "POST",
        path: FG5_CHECK_FAILURE_READBACK_PATH,
        timestamp: generatedAt
      })
    }
  });
  const text = await response.text();
  const body = text.length > 0 ? JSON.parse(text) as unknown : {};
  if (!response.ok) {
    failures.push(`staging readback failed: ${response.status}`);
    const failed = failedRecording(config, generatedAt, failures, {
      status: response.status,
      ok: response.ok,
      body: sanitizeFailureBody(body)
    });
    await writeRecording(config, failed);
    return failed;
  }

  const recording = addConfig(body, config);
  const inspection = inspectFg5CheckFailureReadback(recording);
  const result = {
    ...recording,
    status: inspection.ok ? String(readRecord(recording).status ?? "verified") : "failed",
    ok: readRecord(recording).ok === true && inspection.ok,
    failures: mergeFailures(readStringArray(readRecord(recording).failures), inspection.failures)
  };
  await writeRecording(config, result);
  return result;
}

export function inspectFg5CheckFailureReadback(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const retry = readRecord(evidence.retry);
  const maxAttemptDecision = readRecord(retry.maxAttemptDecision);
  const deadLetter = readRecord(evidence.deadLetter);
  const replay = readRecord(evidence.replay);
  const queue = readRecord(evidence.queue);
  const privacy = readRecord(record.privacy);

  if (record.schemaVersion !== "archcontext.fg5-check-failure-readback/v1") failures.push("schemaVersion mismatch");
  if (record.environment !== "staging") failures.push("environment must be staging");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  if (record.route !== FG5_CHECK_FAILURE_READBACK_PATH) failures.push("route mismatch");
  if (evidence.checkApiFailureInjected !== true) failures.push("checkApiFailureInjected must be true");
  if (String(evidence.checkDeliveryId ?? "").length === 0) failures.push("checkDeliveryId missing");
  if (String(evidence.checkName ?? "") !== "ArchContext / Developer Review") failures.push("checkName mismatch");

  const injectedFailures = Array.isArray(evidence.injectedGitHubApiFailures) ? evidence.injectedGitHubApiFailures : [];
  if (injectedFailures.length < 2) failures.push("at least two injected GitHub API failures required");
  if (!injectedFailures.every((item) => Number(readRecord(item).statusCode) >= 500)) {
    failures.push("injected failures must be GitHub 5xx Check API failures");
  }

  const scheduled = Array.isArray(retry.scheduled) ? retry.scheduled : [];
  if (scheduled.length !== 2) failures.push("retry.scheduled must contain two retry attempts");
  if (retry.maxAttemptsReached !== true) failures.push("retry.maxAttemptsReached must be true");
  if (maxAttemptDecision.retry !== false) failures.push("maxAttemptDecision.retry must be false");
  if (maxAttemptDecision.reason !== "check-delivery-max-attempts-reached") failures.push("max attempt reason mismatch");
  if (deadLetter.status !== "DEAD_LETTER") failures.push("deadLetter.status must be DEAD_LETTER");
  if (deadLetter.lastErrorCode !== "CHECK_DELIVERY_MAX_ATTEMPTS") failures.push("deadLetter.lastErrorCode mismatch");
  if (replay.replayed !== true) failures.push("replay.replayed must be true");
  if (replay.source !== "manual-ops") failures.push("replay.source must be manual-ops");
  if (replay.statusAfterReplay !== "PENDING") failures.push("replay.statusAfterReplay must be PENDING");
  if (Number(replay.attemptCountAfterReplay) !== 0) failures.push("replay attempt count must reset to 0");
  if (replay.lastErrorCodeAfterReplay !== null) failures.push("replay last error must reset to null");
  if (queue.schemaVersion !== "archcontext.check-delivery-queue-message/v1") failures.push("queue schemaVersion mismatch");
  if (Number(queue.retryEnqueueCount) !== 2) failures.push("queue.retryEnqueueCount must be 2");
  if (queue.replayEnqueued !== true) failures.push("queue.replayEnqueued must be true");
  const sentMessages = Array.isArray(queue.sentMessages) ? queue.sentMessages : [];
  if (sentMessages.length !== 3) failures.push("queue.sentMessages must include two retries and one replay");
  const messageStatuses = sentMessages.map((item) => String(readRecord(readRecord(item).message).status ?? ""));
  if (messageStatuses.filter((status) => status === "RETRYING").length !== 2) failures.push("queue must include two RETRYING messages");
  if (messageStatuses[2] !== "PENDING") failures.push("queue replay message must be PENDING");

  if (Number(privacy.privateContentHits) !== 0) failures.push("privacy.privateContentHits must be 0");
  if (Number(privacy.secretMarkerHits) !== 0) failures.push("privacy.secretMarkerHits must be 0");
  if (Number(privacy.forbiddenEndpointOrMediaHits) !== 0) failures.push("privacy.forbiddenEndpointOrMediaHits must be 0");
  if (Array.isArray(privacy.forbiddenKeys) && privacy.forbiddenKeys.length !== 0) failures.push("privacy.forbiddenKeys must be empty");

  const serialized = JSON.stringify(recording);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden secret marker: ${pattern}`);
  }
  for (const pattern of CODE_CONTENT_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden code-content marker: ${pattern}`);
  }
  return { ok: failures.length === 0, failures };
}

function signReadback(input: { secret: string; method: string; path: string; timestamp: string }): string {
  return `sha256=${createHmac("sha256", input.secret)
    .update(`${input.method.toUpperCase()}\n${input.path}\n${input.timestamp}`)
    .digest("hex")}`;
}

function addConfig(recording: unknown, config: Awaited<ReturnType<typeof buildFg5CheckFailureReadbackConfig>>) {
  const record = readRecord(recording);
  return {
    ...record,
    config: {
      envFile: config.envFile,
      output: config.outputPath,
      stagingUrl: config.stagingUrl
    }
  };
}

function failedRecording(
  config: Awaited<ReturnType<typeof buildFg5CheckFailureReadbackConfig>>,
  generatedAt: string,
  failures: string[],
  http?: Record<string, unknown>
) {
  return {
    schemaVersion: "archcontext.fg5-check-failure-readback/v1",
    environment: "staging",
    status: "failed",
    ok: false,
    generatedAt,
    route: FG5_CHECK_FAILURE_READBACK_PATH,
    config: {
      envFile: config.envFile,
      output: config.outputPath,
      stagingUrl: config.stagingUrl
    },
    evidence: {
      http: http ?? null
    },
    privacy: {
      privateContentHits: 0,
      secretMarkerHits: 0,
      forbiddenEndpointOrMediaHits: 0,
      forbiddenKeys: []
    },
    failures
  };
}

function sanitizeFailureBody(value: unknown): unknown {
  const record = readRecord(value);
  return {
    ok: record.ok ?? false,
    error: typeof record.error === "string" ? record.error : "unavailable"
  };
}

async function writeRecording(config: Awaited<ReturnType<typeof buildFg5CheckFailureReadbackConfig>>, recording: unknown): Promise<void> {
  const output = resolve(config.root, config.outputPath);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(recording, null, 2)}\n`, "utf8");
}

function mergeFailures(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseDotenv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function normalizeBaseUrl(value: string): string {
  return new URL(value).toString().replace(/\/$/, "");
}

function renderHuman(result: { ok?: unknown; route?: unknown; failures?: unknown }): string {
  const failures = readStringArray(readRecord(result).failures);
  if (result.ok === true) return `FG5 Check API failure readback verified at ${String(result.route ?? FG5_CHECK_FAILURE_READBACK_PATH)}`;
  return `FG5 Check API failure readback failed: ${failures.join("; ") || "unknown failure"}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }): string {
  return result.ok ? "FG5 Check API failure readback evidence verified" : `FG5 Check API failure readback evidence failed: ${result.failures.join("; ")}`;
}
