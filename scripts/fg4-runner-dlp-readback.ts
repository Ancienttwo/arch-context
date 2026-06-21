#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const DEFAULT_SOURCE = "docs/verification/fg4-github-hosted-runner-readback.json";
const DEFAULT_OUTPUT = "docs/verification/fg4-runner-dlp-readback.json";
const BAIT_FIXTURE = "docs/security/fixtures/cloud-private-content-bait.json";
const CODE_CONTENT_PATTERNS = [
  /"findings"\s*:/i,
  /"patch"\s*:/i,
  /"fileBody"\s*:/i,
  /"modelBody"\s*:/i,
  /"sourceBody"\s*:/i,
  /"diffBody"\s*:/i,
  /"symbolPayload"\s*:/i,
  /source\s+code/i,
  /diff\s+--git/i,
  /^@@\s/m
] as const;
const SECRET_PATTERNS = [
  /gh[opsu]_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /GITHUB_WEBHOOK_SECRET=/i,
  /installation[_-]?token\s*[:=]\s*[A-Za-z0-9._-]+/i
] as const;
const FORBIDDEN_ENDPOINT_OR_MEDIA = [
  /\/contents(?:\/|\b)/i,
  /\/git\/blobs(?:\/|\b)/i,
  /\/git\/trees(?:\/|\b)/i,
  /\/pulls\/\d+\/files/i,
  /application\/vnd\.github\.v3\.(?:diff|patch)/i
] as const;

if (import.meta.main) {
  const [command = "run", ...args] = process.argv.slice(2);
  if (command !== "run" && command !== "inspect") {
    console.error("[fg4-runner-dlp-readback] usage: run|inspect [--source path] [--out path] [--evidence path] [--json]");
    process.exit(2);
  }
  if (command === "run") {
    const config = await buildFg4RunnerDlpReadbackConfig(args);
    const result = await runFg4RunnerDlpReadback(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg4RunnerDlpReadback(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  }
}

export async function buildFg4RunnerDlpReadbackConfig(args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? process.cwd(),
    sourcePath: readFlag(args, "--source") ?? DEFAULT_SOURCE,
    outputPath: readFlag(args, "--out") ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    now: () => new Date().toISOString()
  };
}

export async function runFg4RunnerDlpReadback(config: Awaited<ReturnType<typeof buildFg4RunnerDlpReadbackConfig>>) {
  const failures: string[] = [];
  const generatedAt = config.now();
  const source = JSON.parse(await readFile(resolve(config.root, config.sourcePath), "utf8")) as unknown;
  const sourceRecord = readRecord(source);
  const sourceEvidence = readRecord(sourceRecord.evidence);
  const workflow = readRecord(sourceEvidence.workflow);
  const repository = String(readRecord(sourceRecord.config).repository ?? "");
  const runId = Number(workflow.runId);
  if (!repository) failures.push("source repository missing");
  if (!Number.isInteger(runId) || runId <= 0) failures.push("source workflow runId missing");
  const bait = JSON.parse(await readFile(resolve(config.root, BAIT_FIXTURE), "utf8")) as { payload: Record<string, string> };
  const baitNeedles = Object.values(bait.payload);
  const temp = mkdtempSync(join(tmpdir(), "archctx-fg4-eg8-"));
  try {
    const artifactsDir = join(temp, "artifacts");
    gh(["run", "download", String(runId), "--repo", repository, "--dir", artifactsDir]);
    const logText = gh(["run", "view", String(runId), "--repo", repository, "--log"]);
    const runJson = JSON.parse(gh(["run", "view", String(runId), "--repo", repository, "--json", "databaseId,status,conclusion,event,headBranch,headSha,url,workflowName,jobs"])) as unknown;
    const artifactScan = scanArtifactDirectory(artifactsDir, baitNeedles);
    const logScan = scanText(logText, baitNeedles);
    const cacheLines = logText.split(/\r?\n/).filter((line) => /cache/i.test(line));
    const cacheScan = {
      cacheLineCount: cacheLines.length,
      ...scanText(cacheLines.join("\n"), baitNeedles)
    };
    const cloudDtoScan = scanCloudDtoEvidence(source, baitNeedles);
    const evidence = {
      sourceEvidence: config.sourcePath,
      repository,
      runId,
      run: summarizeRun(runJson),
      artifactScan,
      logScan: {
        lineCount: logText.split(/\r?\n/).length,
        codeContentMatches: logScan.codeContentMatches,
        baitValueMatches: logScan.baitValueMatches,
        forbiddenEndpointOrMediaMatches: logScan.forbiddenEndpointOrMediaMatches,
        secretMatches: logScan.secretMatches,
        maskedTokenMentions: (logText.match(/token:\s+\*\*\*/gi) ?? []).length
      },
      cacheScan: {
        cacheLineCount: cacheScan.cacheLineCount,
        codeContentMatches: cacheScan.codeContentMatches,
        baitValueMatches: cacheScan.baitValueMatches,
        forbiddenEndpointOrMediaMatches: cacheScan.forbiddenEndpointOrMediaMatches,
        secretMatches: cacheScan.secretMatches
      },
      cloudDtoScan
    };
    if (artifactScan.fileCount <= 0) failures.push("artifact scan must include at least one file");
    if (evidence.logScan.lineCount <= 0) failures.push("log scan must include log lines");
    if (artifactScan.codeContentMatches !== 0) failures.push("artifact code content matches must be 0");
    if (evidence.logScan.codeContentMatches !== 0) failures.push("log code content matches must be 0");
    if (evidence.cacheScan.codeContentMatches !== 0) failures.push("cache code content matches must be 0");
    if (cloudDtoScan.codeContentMatches !== 0) failures.push("cloud DTO code content matches must be 0");
    for (const [surface, scan] of [
      ["artifact", artifactScan],
      ["log", evidence.logScan],
      ["cache", evidence.cacheScan],
      ["cloudDto", cloudDtoScan]
    ] as const) {
      if (scan.baitValueMatches !== 0) failures.push(`${surface} bait value matches must be 0`);
      if (scan.forbiddenEndpointOrMediaMatches !== 0) failures.push(`${surface} forbidden endpoint or media matches must be 0`);
      if (scan.secretMatches !== 0) failures.push(`${surface} secret matches must be 0`);
    }
    const result = {
      schemaVersion: "archcontext.fg4-runner-dlp-readback/v1",
      environment: "staging",
      status: failures.length === 0 ? "verified" : "failed",
      ok: failures.length === 0,
      generatedAt,
      evidence,
      failures
    };
    inspectFg4RunnerDlpReadback(result).failures.forEach((failure) => {
      if (!failures.includes(failure)) failures.push(failure);
    });
    result.status = failures.length === 0 ? "verified" : "failed";
    result.ok = failures.length === 0;
    result.failures = failures;
    await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
    await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    return result;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function inspectFg4RunnerDlpReadback(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  if (record.schemaVersion !== "archcontext.fg4-runner-dlp-readback/v1") failures.push("schemaVersion mismatch");
  if (record.environment !== "staging") failures.push("environment must be staging");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  if (!evidence.repository) failures.push("repository missing");
  if (!Number.isInteger(Number(evidence.runId))) failures.push("runId missing");
  const artifactScan = readRecord(evidence.artifactScan);
  const logScan = readRecord(evidence.logScan);
  const cacheScan = readRecord(evidence.cacheScan);
  const cloudDtoScan = readRecord(evidence.cloudDtoScan);
  if (Number(artifactScan.fileCount ?? 0) <= 0) failures.push("artifact scan must include files");
  if (Number(logScan.lineCount ?? 0) <= 0) failures.push("log scan must include lines");
  for (const [surface, scan] of [
    ["artifact", artifactScan],
    ["log", logScan],
    ["cache", cacheScan],
    ["cloudDto", cloudDtoScan]
  ] as const) {
    for (const key of ["codeContentMatches", "baitValueMatches", "forbiddenEndpointOrMediaMatches", "secretMatches"]) {
      if (Number(scan[key] ?? 0) !== 0) failures.push(`${surface}.${key} must be 0`);
    }
  }
  const serialized = JSON.stringify(recording);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden secret marker: ${pattern}`);
  }
  return { ok: failures.length === 0, failures };
}

function scanArtifactDirectory(dir: string, baitNeedles: string[]) {
  const files = listFiles(dir);
  let totalBytes = 0;
  let combined = "";
  for (const file of files) {
    const stat = statSync(file);
    totalBytes += stat.size;
    if (stat.size <= 256 * 1024) combined += `${readFileSync(file, "utf8")}\n`;
  }
  return {
    fileCount: files.length,
    totalBytes,
    fileNames: files.map((file) => file.slice(dir.length + 1)),
    ...scanText(combined, baitNeedles)
  };
}

function scanCloudDtoEvidence(source: unknown, baitNeedles: string[]) {
  const evidence = readRecord(readRecord(source).evidence);
  const egress = Array.isArray(evidence.egress) ? evidence.egress : [];
  const dto = {
    artifact: readRecord(evidence.artifact),
    organizationRunner: readRecord(evidence.organizationRunner),
    egress
  };
  const scan = scanText(JSON.stringify(dto), baitNeedles);
  return {
    ...scan,
    egressCategories: egress.map((item) => String(readRecord(item).category ?? "")).filter(Boolean)
  };
}

function scanText(text: string, baitNeedles: string[]) {
  return {
    codeContentMatches: countPatterns(text, CODE_CONTENT_PATTERNS),
    baitValueMatches: countNeedles(text, baitNeedles),
    forbiddenEndpointOrMediaMatches: countPatterns(text, FORBIDDEN_ENDPOINT_OR_MEDIA),
    secretMatches: countPatterns(text, SECRET_PATTERNS)
  };
}

function summarizeRun(value: unknown) {
  const record = readRecord(value);
  return {
    databaseId: record.databaseId,
    status: record.status,
    conclusion: record.conclusion,
    event: record.event,
    headBranch: record.headBranch,
    headSha: record.headSha,
    workflowName: record.workflowName,
    jobCount: Array.isArray(record.jobs) ? record.jobs.length : 0
  };
}

function gh(args: string[]): string {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function countPatterns(text: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + (text.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`)) ?? []).length, 0);
}

function countNeedles(text: string, needles: string[]): number {
  return needles.reduce((sum, needle) => sum + (needle ? text.split(needle).length - 1 : 0), 0);
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function readRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function renderHuman(result: { ok: boolean; evidence?: { artifactScan?: { codeContentMatches?: number }; logScan?: { codeContentMatches?: number }; cacheScan?: { codeContentMatches?: number }; cloudDtoScan?: { codeContentMatches?: number } }; failures?: string[] }) {
  return result.ok
    ? `[fg4-runner-dlp-readback] verified artifact=${result.evidence?.artifactScan?.codeContentMatches ?? "?"} log=${result.evidence?.logScan?.codeContentMatches ?? "?"} cache=${result.evidence?.cacheScan?.codeContentMatches ?? "?"} cloudDto=${result.evidence?.cloudDtoScan?.codeContentMatches ?? "?"}`
    : `[fg4-runner-dlp-readback] failed\n${(result.failures ?? []).map((failure) => `- ${failure}`).join("\n")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }) {
  return result.ok
    ? "[fg4-runner-dlp-readback] OK"
    : `[fg4-runner-dlp-readback] FAILED\n${result.failures.map((failure) => `- ${failure}`).join("\n")}`;
}
