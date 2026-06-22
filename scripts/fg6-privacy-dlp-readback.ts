#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { auditGitHubApiContract, DEFAULT_GITHUB_API_CONTRACT_SCAN_ROOTS } from "./github-api-contract-audit.mjs";
import { inspectFg3CloudDlpReadback } from "./fg3-cloud-dlp-readback";
import { inspectFg4RunnerDlpReadback } from "./fg4-runner-dlp-readback";
import { inspectFg5FullPlaneDlp } from "./fg5-full-plane-dlp-readback";

const DEFAULT_FG3_CLOUD_DLP_SOURCE = "docs/verification/fg3-cloud-dlp-readback.json";
const DEFAULT_FG4_RUNNER_DLP_SOURCE = "docs/verification/fg4-runner-dlp-readback.json";
const DEFAULT_FG5_FULL_PLANE_DLP_SOURCE = "docs/verification/fg5-full-plane-dlp-readback.json";
const DEFAULT_OUTPUT = "docs/verification/fg6-privacy-dlp-readback.json";
const REQUIRED_DYNAMIC_CLOUD_SURFACES = ["log", "trace", "queue", "error", "notification", "egress"] as const;
const REQUIRED_STORAGE_SURFACES = ["database", "log", "trace", "queue", "error"] as const;
const REQUIRED_RUNNER_SURFACES = ["artifact", "log", "cache", "cloudDto"] as const;
const ALLOWED_GITHUB_EGRESS_CATEGORIES = new Set(["github.pull-head", "github.check-list-for-ref", "github.check-create", "github.check-update"]);
const ZERO_SCAN_KEYS = ["codeContentMatches", "baitValueMatches", "forbiddenEndpointOrMediaMatches", "secretMatches"] as const;
const STORAGE_ZERO_SCAN_KEYS = ["codeContentMatches", "baitValueMatches", "forbiddenKeyMatches", "forbiddenEndpointOrMediaMatches", "secretMatches"] as const;
const CODE_CONTENT_PATTERNS = [
  /"source"\s*:/i,
  /"sourceCode"\s*:/i,
  /"diff"\s*:/i,
  /"patch"\s*:/i,
  /"filename"\s*:/i,
  /"fileName"\s*:/i,
  /"filePath"\s*:/i,
  /"symbol"\s*:/i,
  /"codeGraph"\s*:/i,
  /"modelBody"\s*:/i,
  /"finding"\s*:/i,
  /"findingBody"\s*:/i,
  /"findings"\s*:/i,
  /"prompt"\s*:/i,
  /"completion"\s*:/i,
  /diff\s+--git/i,
  /^@@\s/m,
  /\/pulls\/\d+\/files/i,
  /\/contents(?:\/|\b)/i,
  /\/git\/blobs(?:\/|\b)/i,
  /\/git\/trees(?:\/|\b)/i,
  /application\/vnd\.github\.(?:v3\.)?(?:diff|patch)/i
] as const;
const SECRET_PATTERNS = [
  /gh[opsu]_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /GITHUB_WEBHOOK_SECRET/i,
  /x-hub-signature/i,
  /installation[_-]?token/i,
  /private[_-]?key/i
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildFg6PrivacyDlpConfig(process.env, args);
    const result = await runFg6PrivacyDlp(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg6PrivacyDlpReadback(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg6-privacy-dlp-readback] usage: run|inspect [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg6PrivacyDlpConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    fg3CloudDlpSource: readFlag(args, "--fg3-cloud-dlp-source") ?? env.ARCHCONTEXT_FG6_FG3_CLOUD_DLP_SOURCE ?? DEFAULT_FG3_CLOUD_DLP_SOURCE,
    fg4RunnerDlpSource: readFlag(args, "--fg4-runner-dlp-source") ?? env.ARCHCONTEXT_FG6_FG4_RUNNER_DLP_SOURCE ?? DEFAULT_FG4_RUNNER_DLP_SOURCE,
    fg5FullPlaneDlpSource: readFlag(args, "--fg5-full-plane-dlp-source") ?? env.ARCHCONTEXT_FG6_FG5_FULL_PLANE_DLP_SOURCE ?? DEFAULT_FG5_FULL_PLANE_DLP_SOURCE,
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_PRIVACY_DLP_OUTPUT ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg6PrivacyDlp(config: ReturnType<typeof buildFg6PrivacyDlpConfig>) {
  const [fg3CloudDlpSource, fg4RunnerDlpSource, fg5FullPlaneDlpSource] = await Promise.all([
    readJson(resolve(config.root, config.fg3CloudDlpSource)),
    readJson(resolve(config.root, config.fg4RunnerDlpSource)),
    readJson(resolve(config.root, config.fg5FullPlaneDlpSource))
  ]);
  const staticAudit = await auditGitHubApiContract({ root: config.root });
  const fg3Inspection = inspectFg3CloudDlpReadback(fg3CloudDlpSource);
  const fg4Inspection = inspectFg4RunnerDlpReadback(fg4RunnerDlpSource);
  const fg5Inspection = inspectFg5FullPlaneDlp(fg5FullPlaneDlpSource);

  const recording = {
    schemaVersion: "archcontext.fg6-privacy-dlp-readback/v1",
    acceptanceId: "AC-05",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: config.generatedAt(),
    sources: {
      fg3CloudDlpSource: config.fg3CloudDlpSource,
      fg4RunnerDlpSource: config.fg4RunnerDlpSource,
      fg5FullPlaneDlpSource: config.fg5FullPlaneDlpSource
    },
    evidence: {
      staticPrivacyContract: {
        command: "bun run verify:privacy-contract",
        scanRoots: DEFAULT_GITHUB_API_CONTRACT_SCAN_ROOTS,
        scannedFiles: staticAudit.scannedFiles,
        ok: staticAudit.ok,
        findingCount: staticAudit.findings.length
      },
      dynamicCloud: summarizeFg3CloudDlp(fg3CloudDlpSource),
      runnerDynamic: summarizeFg4RunnerDlp(fg4RunnerDlpSource),
      storageAndControlPlane: summarizeFg5FullPlaneDlp(fg5FullPlaneDlpSource),
      sourceInspections: {
        fg3CloudDlp: fg3Inspection,
        fg4RunnerDlp: fg4Inspection,
        fg5FullPlaneDlp: fg5Inspection
      },
      assertions: {
        staticGitHubApiAllowlistPassed: staticAudit.ok === true && staticAudit.findings.length === 0,
        dynamicGitHubClientNoCodeEndpointCalls: fg3Inspection.ok === true,
        runnerArtifactLogCacheDlpZero: fg4Inspection.ok === true,
        workerQueueD1LogStorageDlpZero: fg5Inspection.ok === true,
        databaseSchemaPrivacyOk: readRecord(readRecord(readRecord(fg5FullPlaneDlpSource).evidence).database).schemaPrivacyOk === true,
        queueSerializationDlpZero: Number(readRecord(readRecord(readRecord(readRecord(fg5FullPlaneDlpSource).evidence).scans).queue).codeContentMatches ?? 1) === 0,
        allCodeContentRoutesZero: fg3Inspection.ok === true && fg4Inspection.ok === true && fg5Inspection.ok === true && staticAudit.ok === true
      }
    },
    failures: [] as string[]
  };
  const inspection = inspectFg6PrivacyDlpReadback(recording);
  recording.status = inspection.ok ? "verified" : "failed";
  recording.ok = inspection.ok;
  recording.failures = inspection.failures;
  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(recording, null, 2)}\n`, "utf8");
  return recording;
}

export function inspectFg6PrivacyDlpReadback(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const staticPrivacyContract = readRecord(evidence.staticPrivacyContract);
  const dynamicCloud = readRecord(evidence.dynamicCloud);
  const runnerDynamic = readRecord(evidence.runnerDynamic);
  const storageAndControlPlane = readRecord(evidence.storageAndControlPlane);
  const sourceInspections = readRecord(evidence.sourceInspections);
  const assertions = readRecord(evidence.assertions);

  if (record.schemaVersion !== "archcontext.fg6-privacy-dlp-readback/v1") failures.push("schemaVersion mismatch");
  if (record.acceptanceId !== "AC-05") failures.push("acceptanceId must be AC-05");
  if (record.environment !== "staging-release-readback") failures.push("environment must be staging-release-readback");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");

  if (staticPrivacyContract.command !== "bun run verify:privacy-contract") failures.push("static Privacy Contract command mismatch");
  if (staticPrivacyContract.ok !== true) failures.push("static Privacy Contract audit must pass");
  if (Number(staticPrivacyContract.findingCount ?? 1) !== 0) failures.push("static Privacy Contract findingCount must be 0");
  if (Number(staticPrivacyContract.scannedFiles ?? 0) < 18) failures.push("static Privacy Contract scannedFiles must cover production cloud/contracts sources");
  const scanRoots = Array.isArray(staticPrivacyContract.scanRoots) ? staticPrivacyContract.scanRoots.map(String) : [];
  for (const root of DEFAULT_GITHUB_API_CONTRACT_SCAN_ROOTS) {
    if (!scanRoots.includes(root)) failures.push(`static Privacy Contract scanRoots must include ${root}`);
  }

  for (const [name, inspection] of Object.entries(sourceInspections)) {
    if (readRecord(inspection).ok !== true) failures.push(`${name} source inspection must pass`);
  }

  inspectDynamicCloud(dynamicCloud, failures);
  inspectRunnerDynamic(runnerDynamic, failures);
  inspectStorageAndControlPlane(storageAndControlPlane, failures);

  for (const key of [
    "staticGitHubApiAllowlistPassed",
    "dynamicGitHubClientNoCodeEndpointCalls",
    "runnerArtifactLogCacheDlpZero",
    "workerQueueD1LogStorageDlpZero",
    "databaseSchemaPrivacyOk",
    "queueSerializationDlpZero",
    "allCodeContentRoutesZero"
  ]) {
    if (assertions[key] !== true) failures.push(`assertion ${key} must be true`);
  }

  const fullSerialized = JSON.stringify(recording);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(fullSerialized)) failures.push(`recording contains forbidden secret marker: ${pattern}`);
  }
  const dlpSurfaceSerialized = JSON.stringify({ staticPrivacyContract, dynamicCloud, runnerDynamic, storageAndControlPlane });
  for (const pattern of CODE_CONTENT_PATTERNS) {
    if (pattern.test(dlpSurfaceSerialized)) failures.push(`recording contains forbidden code-content marker: ${pattern}`);
  }
  return { ok: failures.length === 0, failures };
}

function summarizeFg3CloudDlp(recording: unknown) {
  const evidence = readRecord(readRecord(recording).evidence);
  const dtoScan = readRecord(evidence.dtoScan);
  const egressScan = readRecord(evidence.egressScan);
  const tailScan = readRecord(evidence.tailScan);
  return {
    dtoScan: {
      surfaces: Array.isArray(dtoScan.surfaces) ? dtoScan.surfaces : [],
      baitValueMatches: Number(dtoScan.baitValueMatches ?? 0),
      forbiddenKeyRetained: Number(dtoScan.forbiddenKeyRetained ?? 0),
      notificationMinimalRejectedBait: dtoScan.notificationMinimalRejectedBait === true,
      egressSchemaRejectedBait: dtoScan.egressSchemaRejectedBait === true
    },
    egress: {
      totalRecordedRequests: Number(egressScan.totalRecordedRequests ?? 0),
      categories: readRecord(egressScan.categories),
      unexpectedCategories: Array.isArray(egressScan.unexpectedCategories) ? egressScan.unexpectedCategories : [],
      forbiddenEndpointOrMediaMatches: Number(egressScan.forbiddenEndpointOrMediaMatches ?? 0)
    },
    tail: {
      egressEnvelopeMatches: Number(tailScan.egressEnvelopeMatches ?? 0),
      acceptedWebhookLogMatches: Number(tailScan.acceptedWebhookLogMatches ?? 0),
      baitValueMatches: Number(tailScan.baitValueMatches ?? 0),
      baitMarkerMatches: Number(tailScan.baitMarkerMatches ?? 0),
      forbiddenEndpointOrMediaMatches: Number(tailScan.forbiddenEndpointOrMediaMatches ?? 0)
    }
  };
}

function summarizeFg4RunnerDlp(recording: unknown) {
  const evidence = readRecord(readRecord(recording).evidence);
  const artifactScan = readRecord(evidence.artifactScan);
  const logScan = readRecord(evidence.logScan);
  const cacheScan = readRecord(evidence.cacheScan);
  const cloudDtoScan = readRecord(evidence.cloudDtoScan);
  return {
    artifact: {
      fileCount: Number(artifactScan.fileCount ?? 0),
      totalBytes: Number(artifactScan.totalBytes ?? 0),
      ...pickScanCounts(artifactScan)
    },
    log: {
      lineCount: Number(logScan.lineCount ?? 0),
      maskedTokenMentions: Number(logScan.maskedTokenMentions ?? 0),
      ...pickScanCounts(logScan)
    },
    cache: {
      cacheLineCount: Number(cacheScan.cacheLineCount ?? 0),
      ...pickScanCounts(cacheScan)
    },
    cloudDto: {
      egressCategories: Array.isArray(cloudDtoScan.egressCategories) ? cloudDtoScan.egressCategories : [],
      ...pickScanCounts(cloudDtoScan)
    }
  };
}

function summarizeFg5FullPlaneDlp(recording: unknown) {
  const evidence = readRecord(readRecord(recording).evidence);
  const database = readRecord(evidence.database);
  const exports = readRecord(evidence.exports);
  const scans = readRecord(evidence.scans);
  return {
    database: {
      schemaPrivacyOk: database.schemaPrivacyOk === true,
      tableCount: Number(database.tableCount ?? 0),
      rowCount: Number(database.rowCount ?? 0),
      tables: Array.isArray(database.tables) ? database.tables : []
    },
    exports: {
      logRecordCount: Number(exports.logRecordCount ?? 0),
      traceRecordCount: Number(exports.traceRecordCount ?? 0),
      queueRecordCount: Number(exports.queueRecordCount ?? 0),
      errorRecordCount: Number(exports.errorRecordCount ?? 0),
      queueHasCheckDeliveryMessage: exports.queueHasCheckDeliveryMessage === true
    },
    scans: Object.fromEntries(REQUIRED_STORAGE_SURFACES.map((surface) => [surface, pickStorageScanCounts(readRecord(scans[surface]))]))
  };
}

function inspectDynamicCloud(dynamicCloud: Record<string, unknown>, failures: string[]): void {
  const dtoScan = readRecord(dynamicCloud.dtoScan);
  const egress = readRecord(dynamicCloud.egress);
  const tail = readRecord(dynamicCloud.tail);
  const surfaces = Array.isArray(dtoScan.surfaces) ? dtoScan.surfaces.map(String) : [];
  for (const surface of REQUIRED_DYNAMIC_CLOUD_SURFACES) {
    if (!surfaces.includes(surface)) failures.push(`dynamicCloud dtoScan must include ${surface}`);
  }
  if (Number(dtoScan.baitValueMatches ?? 1) !== 0) failures.push("dynamicCloud dtoScan.baitValueMatches must be 0");
  if (Number(dtoScan.forbiddenKeyRetained ?? 1) !== 0) failures.push("dynamicCloud dtoScan.forbiddenKeyRetained must be 0");
  if (dtoScan.notificationMinimalRejectedBait !== true) failures.push("dynamicCloud notification bait must be rejected");
  if (dtoScan.egressSchemaRejectedBait !== true) failures.push("dynamicCloud egress bait must be rejected");
  if (Number(egress.totalRecordedRequests ?? 0) <= 0) failures.push("dynamicCloud egress.totalRecordedRequests must be positive");
  if (Number(egress.forbiddenEndpointOrMediaMatches ?? 1) !== 0) failures.push("dynamicCloud egress.forbiddenEndpointOrMediaMatches must be 0");
  const unexpectedCategories = Array.isArray(egress.unexpectedCategories) ? egress.unexpectedCategories : [];
  if (unexpectedCategories.length !== 0) failures.push("dynamicCloud egress unexpectedCategories must be empty");
  for (const category of Object.keys(readRecord(egress.categories))) {
    if (!ALLOWED_GITHUB_EGRESS_CATEGORIES.has(category)) failures.push(`dynamicCloud egress category not allowlisted: ${category}`);
  }
  if (Number(tail.egressEnvelopeMatches ?? 0) <= 0) failures.push("dynamicCloud tail.egressEnvelopeMatches must be positive");
  for (const key of ["baitValueMatches", "baitMarkerMatches", "forbiddenEndpointOrMediaMatches"]) {
    if (Number(tail[key] ?? 1) !== 0) failures.push(`dynamicCloud tail.${key} must be 0`);
  }
}

function inspectRunnerDynamic(runnerDynamic: Record<string, unknown>, failures: string[]): void {
  const artifact = readRecord(runnerDynamic.artifact);
  const log = readRecord(runnerDynamic.log);
  const cache = readRecord(runnerDynamic.cache);
  const cloudDto = readRecord(runnerDynamic.cloudDto);
  if (Number(artifact.fileCount ?? 0) <= 0) failures.push("runnerDynamic artifact.fileCount must be positive");
  if (Number(log.lineCount ?? 0) <= 0) failures.push("runnerDynamic log.lineCount must be positive");
  if (Number(cache.cacheLineCount ?? 0) <= 0) failures.push("runnerDynamic cache.cacheLineCount must be positive");
  for (const [surface, scan] of [
    ["artifact", artifact],
    ["log", log],
    ["cache", cache],
    ["cloudDto", cloudDto]
  ] as const) {
    assertZeroScan(`runnerDynamic ${surface}`, scan, ZERO_SCAN_KEYS, failures);
  }
  const egressCategories = Array.isArray(cloudDto.egressCategories) ? cloudDto.egressCategories.map(String) : [];
  for (const category of egressCategories) {
    if (!ALLOWED_GITHUB_EGRESS_CATEGORIES.has(category)) failures.push(`runnerDynamic cloudDto egress category not allowlisted: ${category}`);
  }
}

function inspectStorageAndControlPlane(storageAndControlPlane: Record<string, unknown>, failures: string[]): void {
  const database = readRecord(storageAndControlPlane.database);
  const exports = readRecord(storageAndControlPlane.exports);
  const scans = readRecord(storageAndControlPlane.scans);
  if (database.schemaPrivacyOk !== true) failures.push("storage database.schemaPrivacyOk must be true");
  if (Number(database.tableCount ?? 0) < 13) failures.push("storage database.tableCount must cover control-plane tables");
  if (Number(database.rowCount ?? 0) < 10) failures.push("storage database.rowCount must include representative rows");
  if (Number(exports.logRecordCount ?? 0) <= 0) failures.push("storage exports.logRecordCount must be positive");
  if (Number(exports.traceRecordCount ?? 0) <= 0) failures.push("storage exports.traceRecordCount must be positive");
  if (Number(exports.queueRecordCount ?? 0) <= 0) failures.push("storage exports.queueRecordCount must be positive");
  if (Number(exports.errorRecordCount ?? 0) <= 0) failures.push("storage exports.errorRecordCount must be positive");
  if (exports.queueHasCheckDeliveryMessage !== true) failures.push("storage queue must include Check delivery message");
  for (const surface of REQUIRED_STORAGE_SURFACES) {
    const scan = readRecord(scans[surface]);
    if (scan.surface !== surface) failures.push(`storage ${surface}.surface mismatch`);
    if (Number(scan.exportedRecordCount ?? 0) <= 0) failures.push(`storage ${surface}.exportedRecordCount must be positive`);
    assertZeroScan(`storage ${surface}`, scan, STORAGE_ZERO_SCAN_KEYS, failures);
  }
}

function assertZeroScan(prefix: string, scan: Record<string, unknown>, keys: readonly string[], failures: string[]): void {
  for (const key of keys) {
    if (Number(scan[key] ?? 1) !== 0) failures.push(`${prefix}.${key} must be 0`);
  }
}

function pickScanCounts(scan: Record<string, unknown>) {
  return Object.fromEntries(ZERO_SCAN_KEYS.map((key) => [key, Number(scan[key] ?? 0)]));
}

function pickStorageScanCounts(scan: Record<string, unknown>) {
  return {
    surface: String(scan.surface ?? ""),
    exportedRecordCount: Number(scan.exportedRecordCount ?? 0),
    ...Object.fromEntries(STORAGE_ZERO_SCAN_KEYS.map((key) => [key, Number(scan[key] ?? 0)]))
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
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
  return result.ok === true ? "FG6 privacy DLP readback verified" : `FG6 privacy DLP readback failed: ${failures.join("; ")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }): string {
  return result.ok ? "FG6 privacy DLP evidence verified" : `FG6 privacy DLP evidence failed: ${result.failures.join("; ")}`;
}
