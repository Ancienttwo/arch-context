#!/usr/bin/env bun
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ControlPlane, projectCloudPrivacySurface } from "@archcontext/cloud/control-plane";
import { assertNotificationEventMinimal, auditNotificationPayload, serializeNotificationEvent } from "@archcontext/cloud/notifications";
import { validateJsonSchema, type Json } from "@archcontext/contracts";

const DEFAULT_OUTPUT = "docs/verification/fg3-cloud-dlp-readback.json";
const DEFAULT_FG3_TAIL_LATEST = "_ops/env/fg3-eg8-tail.latest";
const DEFAULT_TAIL_LATEST = "_ops/env/fg2-staging-tail-sync.latest";
const BAIT_FIXTURE = "docs/security/fixtures/cloud-private-content-bait.json";
const NOTIFICATION_FIXTURE = "packages/contracts/fixtures/valid/notification-event.json";
const NOTIFICATION_SCHEMA = "schemas/runtime/notification-event.schema.json";
const EGRESS_SCHEMA = "schemas/cloud/cloud-egress-envelope.schema.json";
const EGRESS_FIXTURE = "packages/contracts/fixtures/valid/cloud-egress-envelope.json";
const ALLOWED_EGRESS_CATEGORIES = new Set(["github.pull-head", "github.check-list-for-ref", "github.check-create", "github.check-update"]);
const DEFAULT_EVIDENCE_FILES = [
  "docs/verification/fg3-developer-review-process-e2e.json",
  "docs/verification/fg3-negative-identity-matrix.json",
  "docs/verification/fg3-adversarial-review-conclusion.json",
  "docs/verification/fg3-attestation-security-suite.json",
  "docs/verification/fg3-check-supersede-readback.json",
  "docs/verification/fg3-developer-review-check-readback.json",
  "docs/verification/fg3-real-pr-synchronize-e2e.json",
  "docs/verification/fg3-required-trust-staging-readback.json"
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = await buildFg3CloudDlpReadbackConfig(process.env, args);
    const result = await runFg3CloudDlpReadback(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg3CloudDlpReadback(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg3-cloud-dlp-readback] usage: run|inspect [--tail-file path] [--out path] [--json]");
    process.exit(2);
  }
}

export async function buildFg3CloudDlpReadbackConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  const root = readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd();
  const outputPath = readFlag(args, "--out") ?? env.ARCHCONTEXT_FG3_CLOUD_DLP_OUTPUT ?? DEFAULT_OUTPUT;
  const tailFile = readFlag(args, "--tail-file")
    ?? env.ARCHCONTEXT_FG3_CLOUD_DLP_TAIL_FILE
    ?? await readLatestTailFile(root);
  return {
    root,
    outputPath,
    tailFile,
    evidenceFiles: DEFAULT_EVIDENCE_FILES,
    json: args.includes("--json"),
    now: () => new Date().toISOString()
  };
}

export async function runFg3CloudDlpReadback(config: Awaited<ReturnType<typeof buildFg3CloudDlpReadbackConfig>>) {
  const failures: string[] = [];
  const generatedAt = config.now();
  const bait = await readJson(resolve(config.root, BAIT_FIXTURE)) as { payload: Record<string, string> };
  const baitNeedles = Object.values(bait.payload);
  const evidenceRecords = [];
  const egressCategories: Record<string, number> = {};
  let evidenceBaitValueMatches = 0;
  let evidenceForbiddenEndpointOrMediaMatches = 0;

  for (const path of config.evidenceFiles) {
    const value = await readJson(resolve(config.root, path));
    const serialized = JSON.stringify(value);
    const status = readRecord(value).status;
    const ok = readRecord(value).ok;
    if (status !== "verified" || ok !== true) failures.push(`${path} must be verified and ok`);
    evidenceBaitValueMatches += countNeedles(serialized, baitNeedles);
    evidenceForbiddenEndpointOrMediaMatches += countForbiddenEndpointOrMedia(serialized);
    collectEgressCategories(value, egressCategories);
    evidenceRecords.push({ path, status, ok });
  }

  const dtoScan = await scanDtoSurfaces(config.root, bait.payload, baitNeedles);
  if (!dtoScan.ok) failures.push(...dtoScan.failures);

  const unexpectedEgressCategories = Object.keys(egressCategories).filter((category) => !ALLOWED_EGRESS_CATEGORIES.has(category));
  if (unexpectedEgressCategories.length > 0) failures.push(`unexpected egress categories: ${unexpectedEgressCategories.join(",")}`);
  if (evidenceBaitValueMatches !== 0) failures.push("FG3 evidence contains private bait values");
  if (evidenceForbiddenEndpointOrMediaMatches !== 0) failures.push("FG3 evidence contains forbidden endpoint or media markers");

  const tailText = config.tailFile ? await readFile(resolve(config.root, config.tailFile), "utf8") : "";
  const tailScan = scanTailText(tailText, baitNeedles);
  if (!config.tailFile) failures.push("tail capture file is required");
  if (tailScan.egressEnvelopeMatches <= 0) failures.push("tail capture must include at least one sanitized egress envelope");
  if (tailScan.baitValueMatches !== 0) failures.push("tail capture contains private bait values");
  if (tailScan.baitMarkerMatches !== 0) failures.push("tail capture contains DLP bait markers");
  if (tailScan.forbiddenEndpointOrMediaMatches !== 0) failures.push("tail capture contains forbidden endpoint or media markers");

  const result = {
    schemaVersion: "archcontext.fg3-cloud-dlp-readback/v1",
    environment: "staging",
    status: failures.length === 0 ? "verified" : "failed",
    ok: failures.length === 0,
    generatedAt,
    evidence: {
      baitFixture: BAIT_FIXTURE,
      evidenceFiles: evidenceRecords,
      dtoScan: {
        surfaces: dtoScan.surfaces,
        baitValueMatches: dtoScan.baitValueMatches,
        forbiddenKeyRetained: dtoScan.forbiddenKeyRetained,
        notificationMinimalRejectedBait: dtoScan.notificationMinimalRejectedBait,
        egressSchemaRejectedBait: dtoScan.egressSchemaRejectedBait
      },
      egressScan: {
        totalRecordedRequests: Object.values(egressCategories).reduce((sum, count) => sum + count, 0),
        categories: egressCategories,
        unexpectedCategories: unexpectedEgressCategories,
        forbiddenEndpointOrMediaMatches: evidenceForbiddenEndpointOrMediaMatches
      },
      tailScan: {
        tailCaptureLocal: config.tailFile,
        egressEnvelopeMatches: tailScan.egressEnvelopeMatches,
        acceptedWebhookLogMatches: tailScan.acceptedWebhookLogMatches,
        baitValueMatches: tailScan.baitValueMatches,
        baitMarkerMatches: tailScan.baitMarkerMatches,
        forbiddenEndpointOrMediaMatches: tailScan.forbiddenEndpointOrMediaMatches
      }
    },
    failures
  };

  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export function inspectFg3CloudDlpReadback(recording: unknown) {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const dtoScan = readRecord(evidence.dtoScan);
  const egressScan = readRecord(evidence.egressScan);
  const tailScan = readRecord(evidence.tailScan);
  const evidenceFiles = Array.isArray(evidence.evidenceFiles) ? evidence.evidenceFiles : [];
  const unexpectedCategories = Array.isArray(egressScan.unexpectedCategories) ? egressScan.unexpectedCategories : [];
  const serialized = JSON.stringify(recording);

  if (record.schemaVersion !== "archcontext.fg3-cloud-dlp-readback/v1") failures.push("schemaVersion must be archcontext.fg3-cloud-dlp-readback/v1");
  if (record.environment !== "staging") failures.push("environment must be staging");
  if (record.status !== "verified") failures.push("status must be verified");
  if (record.ok !== true) failures.push("ok must be true");
  if (evidenceFiles.length < DEFAULT_EVIDENCE_FILES.length) failures.push("evidenceFiles must cover FG3 readbacks");
  for (const [index, item] of evidenceFiles.entries()) {
    const file = readRecord(item);
    if (file.status !== "verified" || file.ok !== true) failures.push(`evidenceFiles[${index}] must be verified and ok`);
  }
  if (!Array.isArray(dtoScan.surfaces) || dtoScan.surfaces.length < 4) failures.push("dtoScan.surfaces must include cloud surfaces");
  if (dtoScan.baitValueMatches !== 0) failures.push("dtoScan.baitValueMatches must be 0");
  if (dtoScan.forbiddenKeyRetained !== 0) failures.push("dtoScan.forbiddenKeyRetained must be 0");
  if (dtoScan.notificationMinimalRejectedBait !== true) failures.push("notification bait payload must be rejected");
  if (dtoScan.egressSchemaRejectedBait !== true) failures.push("egress bait payload must be rejected");
  if (!Number.isInteger(egressScan.totalRecordedRequests) || Number(egressScan.totalRecordedRequests) <= 0) failures.push("egressScan.totalRecordedRequests must be positive");
  if (unexpectedCategories.length !== 0) failures.push("egressScan.unexpectedCategories must be empty");
  if (egressScan.forbiddenEndpointOrMediaMatches !== 0) failures.push("egressScan.forbiddenEndpointOrMediaMatches must be 0");
  if (typeof tailScan.tailCaptureLocal !== "string" || tailScan.tailCaptureLocal.length === 0) failures.push("tailScan.tailCaptureLocal must be present");
  if (!Number.isInteger(tailScan.egressEnvelopeMatches) || Number(tailScan.egressEnvelopeMatches) <= 0) failures.push("tailScan.egressEnvelopeMatches must be positive");
  if (tailScan.baitValueMatches !== 0) failures.push("tailScan.baitValueMatches must be 0");
  if (tailScan.baitMarkerMatches !== 0) failures.push("tailScan.baitMarkerMatches must be 0");
  if (tailScan.forbiddenEndpointOrMediaMatches !== 0) failures.push("tailScan.forbiddenEndpointOrMediaMatches must be 0");
  for (const forbidden of [/gh[opsu]_[A-Za-z0-9_]+/, /Bearer\s+/i, /-----BEGIN/i, /private[_-]?key/i, /GITHUB_WEBHOOK_SECRET/i, /x-hub-signature/i]) {
    if (forbidden.test(serialized)) failures.push(`recording contains forbidden secret marker: ${forbidden}`);
  }

  return { ok: failures.length === 0, failures };
}

async function scanDtoSurfaces(root: string, baitPayload: Record<string, string>, baitNeedles: string[]) {
  const failures: string[] = [];
  const cp = new ControlPlane();
  const telemetry = {
    requestId: "req_fg3_dlp",
    routeId: "github.review",
    installationId: 141544438,
    repositoryId: 1274353501,
    pullRequestNumber: 2,
    headSha: "87d036e06c7c0e2b179ed3c3a5169331c0cc4547",
    challengeId: "chal_fg3_dlp",
    attestationId: "att_fg3_dlp",
    checkDeliveryId: "check_fg3_dlp",
    status: "rejected",
    reasonCode: "PAYLOAD_PRIVACY_VIOLATION",
    latencyMs: 12,
    attempt: 1,
    runtimeVersion: "archctx/0.2.0",
    ...baitPayload
  };
  const surfaces = [
    projectCloudPrivacySurface("log", telemetry),
    projectCloudPrivacySurface("trace", { ...telemetry, spanId: "span_fg3_dlp" }),
    cp.buildQueueMessage({ kind: "notification.event", id: "evt_fg3_dlp", accountId: "acct_fg3_dlp", ...baitPayload } as any),
    cp.projectErrorObject(new Error("private bait should not be retained"), { errorCode: "PAYLOAD_PRIVACY_VIOLATION", requestId: "req_fg3_dlp", ...baitPayload })
  ];
  const serializedSurfaces = JSON.stringify(surfaces);
  const forbiddenKeyRetained = Object.keys(baitPayload).filter((key) => serializedSurfaces.includes(`"${key}"`)).length;
  const baitValueMatches = countNeedles(serializedSurfaces, baitNeedles);
  if (baitValueMatches !== 0) failures.push("projected DTO surfaces retained private bait values");
  if (forbiddenKeyRetained !== 0) failures.push("projected DTO surfaces retained forbidden bait keys");

  const notificationSchema = await readJson(resolve(root, NOTIFICATION_SCHEMA));
  const notification = await readJson(resolve(root, NOTIFICATION_FIXTURE)) as Record<string, Json>;
  const notificationMinimalRejectedBait =
    validateJsonSchema(notificationSchema as any, { ...notification, ...baitPayload }).valid === false
    && throws(() => assertNotificationEventMinimal({ ...notification, ...baitPayload } as any))
    && auditNotificationPayload({ ...serializeNotificationEvent(notification as any), ...baitPayload }).ok === false;
  if (!notificationMinimalRejectedBait) failures.push("notification payload accepted bait fields");

  const egressSchema = await readJson(resolve(root, EGRESS_SCHEMA));
  const egress = await readJson(resolve(root, EGRESS_FIXTURE)) as Record<string, Json>;
  const egressSchemaRejectedBait = validateJsonSchema(egressSchema as any, { ...egress, ...baitPayload }).valid === false;
  if (!egressSchemaRejectedBait) failures.push("egress schema accepted bait fields");

  return {
    ok: failures.length === 0,
    failures,
    surfaces: ["log", "trace", "queue", "error", "notification", "egress"],
    baitValueMatches,
    forbiddenKeyRetained,
    notificationMinimalRejectedBait,
    egressSchemaRejectedBait
  };
}

function collectEgressCategories(value: unknown, categories: Record<string, number>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectEgressCategories(item, categories);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.category === "string" && record.category.startsWith("github.")) {
    categories[record.category] = (categories[record.category] ?? 0) + 1;
  }
  for (const child of Object.values(record)) collectEgressCategories(child, categories);
}

function scanTailText(text: string, baitNeedles: string[]) {
  return {
    egressEnvelopeMatches: countRegex(text, /archcontext\.github-egress/g),
    acceptedWebhookLogMatches: countRegex(text, /archcontext\.github-webhook\.accepted/g),
    baitValueMatches: countNeedles(text, baitNeedles),
    baitMarkerMatches: countRegex(text, /ARCHCTX_DLP_BAIT/g),
    forbiddenEndpointOrMediaMatches: countForbiddenEndpointOrMedia(text)
  };
}

function countForbiddenEndpointOrMedia(text: string): number {
  return countRegex(text, /\/pulls\/\d+\/files|\/contents(?:\/|")|\/git\/blobs|\/git\/trees|application\/vnd\.github\.(?:diff|patch)|"pathTemplate"\s*:\s*"[^"]*(?:diff|patch|contents|blobs|trees|files)/gi);
}

function countNeedles(text: string, needles: string[]): number {
  return needles.reduce((sum, needle) => sum + countLiteral(text, needle), 0);
}

function countRegex(text: string, regex: RegExp): number {
  return text.match(regex)?.length ?? 0;
}

function countLiteral(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

async function readLatestTailFile(root: string): Promise<string> {
  try {
    const fg3Tail = (await readFile(resolve(root, DEFAULT_FG3_TAIL_LATEST), "utf8")).trim();
    if (fg3Tail) return fg3Tail;
  } catch {
    // Fall through to the older FG2 staging capture pointer.
  }
  try {
    return (await readFile(resolve(root, DEFAULT_TAIL_LATEST), "utf8")).trim();
  } catch {
    return "";
  }
}

async function readJson(path: string): Promise<Json> {
  return JSON.parse(await readFile(path, "utf8")) as Json;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function throws(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

function renderHuman(result: Awaited<ReturnType<typeof runFg3CloudDlpReadback>>): string {
  const lines = [`[fg3-cloud-dlp-readback] ${result.ok ? "OK" : "FAILED"}`];
  lines.push(`- evidenceFiles: ${result.evidence.evidenceFiles.length}`);
  lines.push(`- egressRequests: ${result.evidence.egressScan.totalRecordedRequests}`);
  lines.push(`- tailEgressMatches: ${result.evidence.tailScan.egressEnvelopeMatches}`);
  for (const failure of result.failures) lines.push(`- ${failure}`);
  return lines.join("\n");
}

function renderInspectHuman(result: ReturnType<typeof inspectFg3CloudDlpReadback>): string {
  if (result.ok) return "[fg3-cloud-dlp-readback] OK";
  return ["[fg3-cloud-dlp-readback] FAILED", ...result.failures.map((failure) => `- ${failure}`)].join("\n");
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
