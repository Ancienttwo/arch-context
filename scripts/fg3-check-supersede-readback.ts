#!/usr/bin/env bun
import { createSign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  GitHubGovernanceRestPort,
  RecordingGitHubGovernanceApiTransport,
  renderSupersededCheckSummary,
  type GitHubGovernanceApiRequest,
  type GitHubGovernanceApiResponse,
  type GitHubGovernanceApiTransport
} from "@archcontext/cloud/github-app";
import {
  DEVELOPER_REVIEW_CHECK_NAME,
  type CloudEgressEnvelope
} from "@archcontext/contracts";

const DEFAULT_ENV_FILE = "_ops/env/fg2-staging.env";
const DEFAULT_PACKET = "docs/verification/fg2-staging-evidence.json";
const DEFAULT_OUTPUT = "docs/verification/fg3-check-supersede-readback.json";
const DEFAULT_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const SUPERSEDED_TEXT = "Superseded by a newer PR head";

if (import.meta.main) {
  const [command = "run", ...args] = process.argv.slice(2);
  if (command !== "run") {
    console.error("[fg3-check-supersede-readback] usage: run [--env-file path] [--packet path] [--out path] [--old-head sha] [--json]");
    process.exit(2);
  }
  const config = await buildFg3CheckSupersedeReadbackConfig(process.env, args);
  const result = await runFg3CheckSupersedeReadback(config);
  process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
  if (!result.ok) process.exit(1);
}

export async function buildFg3CheckSupersedeReadbackConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  const root = readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd();
  const envFile = readFlag(args, "--env-file") ?? env.ARCHCONTEXT_FG3_STAGING_ENV_FILE ?? DEFAULT_ENV_FILE;
  const packetPath = readFlag(args, "--packet") ?? env.ARCHCONTEXT_FG3_STAGING_PACKET ?? DEFAULT_PACKET;
  const outputPath = readFlag(args, "--out") ?? env.ARCHCONTEXT_FG3_CHECK_SUPERSEDE_OUTPUT ?? DEFAULT_OUTPUT;
  const dotenv = parseDotenv(await readFile(resolve(root, envFile), "utf8"));
  const packet = JSON.parse(await readFile(resolve(root, packetPath), "utf8")) as Record<string, unknown>;
  const githubApp = readRecord(readRecord(packet.evidence).githubApp);
  const privateKeyPath = readFlag(args, "--private-key-path")
    ?? env.GITHUB_APP_PRIVATE_KEY_PEM_PATH
    ?? dotenv.GITHUB_APP_PRIVATE_KEY_PEM_PATH;
  const privateKeyPem = readFlag(args, "--private-key-pem")
    ?? env.GITHUB_APP_PRIVATE_KEY_PEM
    ?? dotenv.GITHUB_APP_PRIVATE_KEY_PEM
    ?? (privateKeyPath ? await readFile(resolve(root, privateKeyPath), "utf8") : "");

  return {
    root,
    envFile,
    packetPath,
    outputPath,
    appId: readFlag(args, "--app-id") ?? env.GITHUB_APP_ID ?? dotenv.GITHUB_APP_ID ?? stringValue(githubApp.appId),
    appSlug: readFlag(args, "--app-slug") ?? env.GITHUB_APP_SLUG ?? dotenv.GITHUB_APP_SLUG ?? stringValue(githubApp.appSlug),
    installationId: parsePositiveInteger(
      readFlag(args, "--installation-id") ?? env.GITHUB_APP_INSTALLATION_ID ?? dotenv.GITHUB_APP_INSTALLATION_ID ?? githubApp.installationId,
      "installationId"
    ),
    repository: readFlag(args, "--repository")
      ?? env.FG2_STAGING_REPOSITORY
      ?? dotenv.FG2_STAGING_REPOSITORY
      ?? firstString(readRecord(packet.evidence).githubApp, "repositories"),
    repositoryId: optionalPositiveInteger(readFlag(args, "--repository-id") ?? githubApp.repositoryId, "repositoryId"),
    pullRequestNumber: parsePositiveInteger(
      readFlag(args, "--pull-request") ?? extractPullNumber(stringValue(githubApp.pullRequestUrl)),
      "pullRequestNumber"
    ),
    oldHeadSha: readFlag(args, "--old-head") ?? env.ARCHCONTEXT_FG3_OLD_HEAD_SHA ?? stringValue(githubApp.headCommit),
    privateKeyPem,
    apiBaseUrl: normalizeBaseUrl(readFlag(args, "--api-base-url") ?? env.GITHUB_API_BASE_URL ?? dotenv.GITHUB_API_BASE_URL ?? DEFAULT_API_BASE_URL),
    json: args.includes("--json"),
    now: () => new Date().toISOString()
  };
}

export async function runFg3CheckSupersedeReadback(config: Awaited<ReturnType<typeof buildFg3CheckSupersedeReadbackConfig>>) {
  const failures: string[] = [];
  const generatedAt = config.now();
  const envelopes: CloudEgressEnvelope[] = [];
  const appJwt = createGitHubAppJwt({ appId: requireString(config.appId, "appId", failures), privateKeyPem: requireString(config.privateKeyPem, "privateKeyPem", failures) });
  const installationAccess = await createInstallationAccessToken({
    apiBaseUrl: config.apiBaseUrl,
    installationId: config.installationId,
    appJwt
  });
  if (!installationAccess.access) failures.push(`installation access failed: ${installationAccess.status}`);
  const repositoryId = config.repositoryId ?? await fetchRepositoryId({
    apiBaseUrl: config.apiBaseUrl,
    repository: requireString(config.repository, "repository", failures),
    access: installationAccess.access
  });
  if (repositoryId === undefined) {
    failures.push("repositoryId must be available from packet, args, or GitHub metadata readback");
    throw new Error(failures.join("; "));
  }
  if (failures.length > 0) throw new Error(failures.join("; "));
  const checkedRepositoryId = repositoryId;

  const port = new GitHubGovernanceRestPort(new RecordingGitHubGovernanceApiTransport({
    transport: new GitHubFetchTransport({ apiBaseUrl: config.apiBaseUrl, token: installationAccess.access }),
    recorder: { record: (envelope) => { envelopes.push(envelope); } },
    now: () => generatedAt,
    monotonicNowMs: monotonicClock()
  }));
  const pullHead = await port.getPullHeadMetadata({
    installationId: config.installationId,
    repositoryId: checkedRepositoryId,
    pullRequestNumber: config.pullRequestNumber
  });
  const oldHeadSha = requireSha(config.oldHeadSha, "oldHeadSha", failures);
  if (oldHeadSha === pullHead.headSha) failures.push("oldHeadSha must differ from current PR head");
  if (failures.length > 0) throw new Error(failures.join("; "));

  const oldCheck = await port.createCheckRun({
    installationId: config.installationId,
    repositoryId: checkedRepositoryId,
    pullRequestNumber: config.pullRequestNumber,
    headSha: oldHeadSha,
    name: DEVELOPER_REVIEW_CHECK_NAME,
    status: "in_progress"
  });
  await port.updateCheckRun({
    installationId: config.installationId,
    repositoryId: checkedRepositoryId,
    checkRunId: oldCheck.checkRunId,
    name: DEVELOPER_REVIEW_CHECK_NAME,
    status: "completed",
    conclusion: "success",
    output: {
      title: "Developer-attested",
      summary: [
        `## ${DEVELOPER_REVIEW_CHECK_NAME}`,
        "",
        "**Result: PASS**",
        "",
        "Developer-attested baseline for supersede readback.",
        "",
        "Generated by ArchContext"
      ].join("\n")
    }
  });

  const newCheck = await port.createCheckRun({
    installationId: config.installationId,
    repositoryId: checkedRepositoryId,
    pullRequestNumber: config.pullRequestNumber,
    headSha: pullHead.headSha,
    name: DEVELOPER_REVIEW_CHECK_NAME,
    status: "queued"
  });
  const supersededSummary = renderSupersededCheckSummary({
    checkName: DEVELOPER_REVIEW_CHECK_NAME,
    previousHeadSha: oldHeadSha,
    currentHeadSha: pullHead.headSha
  });
  await port.updateCheckRun({
    installationId: config.installationId,
    repositoryId: checkedRepositoryId,
    checkRunId: oldCheck.checkRunId,
    name: DEVELOPER_REVIEW_CHECK_NAME,
    status: "completed",
    conclusion: "neutral",
    output: {
      title: "Superseded",
      summary: supersededSummary
    }
  });

  const oldReadback = await readCheckRun({
    apiBaseUrl: config.apiBaseUrl,
    repositoryId: checkedRepositoryId,
    checkRunId: oldCheck.checkRunId,
    access: installationAccess.access
  });
  const newReadback = await readCheckRun({
    apiBaseUrl: config.apiBaseUrl,
    repositoryId: checkedRepositoryId,
    checkRunId: newCheck.checkRunId,
    access: installationAccess.access
  });
  const oldCheckRecord = readRecord(oldReadback.body);
  const oldOutput = readRecord(oldCheckRecord.output);
  const oldSummary = stringValue(oldOutput.summary);
  const newCheckRecord = readRecord(newReadback.body);

  if (!oldReadback.ok) failures.push(`old check readback failed: ${oldReadback.status}`);
  if (!newReadback.ok) failures.push(`new check readback failed: ${newReadback.status}`);
  if (stringValue(oldCheckRecord.name) !== DEVELOPER_REVIEW_CHECK_NAME) failures.push("old check name mismatch");
  if (stringValue(newCheckRecord.name) !== DEVELOPER_REVIEW_CHECK_NAME) failures.push("new check name mismatch");
  if (stringValue(oldCheckRecord.conclusion) !== "neutral") failures.push("old check conclusion must be neutral");
  if (stringValue(oldOutput.title) !== "Superseded") failures.push("old check output title must be Superseded");
  if (!oldSummary.includes(SUPERSEDED_TEXT)) failures.push("old check summary missing superseded text");
  if (stringValue(newCheckRecord.head_sha) !== pullHead.headSha) failures.push("new check head must match current PR head");

  const result = {
    schemaVersion: "archcontext.fg3-check-supersede-readback/v1",
    environment: "staging",
    status: failures.length === 0 ? "verified" : "failed",
    ok: failures.length === 0,
    generatedAt,
    config: {
      envFile: config.envFile,
      packet: config.packetPath,
      repository: config.repository,
      repositoryId: checkedRepositoryId,
      pullRequestNumber: config.pullRequestNumber,
      appSlug: config.appSlug,
      installationId: config.installationId
    },
    evidence: {
      checkName: DEVELOPER_REVIEW_CHECK_NAME,
      oldHeadSha,
      newHeadSha: pullHead.headSha,
      headsDiffer: oldHeadSha !== pullHead.headSha,
      oldCheckRunId: oldCheck.checkRunId,
      oldCheckRunUrl: stringValue(oldCheckRecord.html_url) || oldCheck.htmlUrl,
      oldConclusion: stringValue(oldCheckRecord.conclusion),
      oldOutputTitle: stringValue(oldOutput.title),
      oldSummarySuperseded: oldSummary.includes(SUPERSEDED_TEXT),
      oldSummaryPrivatePhraseMatches: /source\s*code/i.test(oldSummary) ? 1 : 0,
      staleConclusionAttempted: false,
      newCheckRunId: newCheck.checkRunId,
      newCheckRunUrl: stringValue(newCheckRecord.html_url) || newCheck.htmlUrl,
      newCheckStatus: stringValue(newCheckRecord.status),
      newCheckHeadSha: stringValue(newCheckRecord.head_sha),
      egress: envelopes.map((envelope) => ({
        category: envelope.category,
        method: envelope.method,
        pathTemplate: envelope.pathTemplate,
        statusCode: envelope.statusCode,
        requestId: envelope.requestId
      })),
      readbackRequests: {
        oldStatus: oldReadback.status,
        oldRequestId: oldReadback.requestId,
        newStatus: newReadback.status,
        newRequestId: newReadback.requestId
      }
    },
    failures
  };

  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export function inspectFg3CheckSupersedeReadback(recording: unknown) {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const serialized = JSON.stringify(recording);

  if (record.schemaVersion !== "archcontext.fg3-check-supersede-readback/v1") {
    failures.push("schemaVersion must be archcontext.fg3-check-supersede-readback/v1");
  }
  if (record.environment !== "staging") failures.push("environment must be staging");
  if (record.status !== "verified") failures.push("status must be verified");
  if (record.ok !== true) failures.push("ok must be true");
  if (evidence.checkName !== DEVELOPER_REVIEW_CHECK_NAME) failures.push("evidence.checkName must be Developer Review");
  if (evidence.headsDiffer !== true) failures.push("evidence.headsDiffer must be true");
  if (evidence.oldConclusion !== "neutral" && evidence.oldConclusion !== "cancelled") failures.push("evidence.oldConclusion must be neutral or cancelled");
  if (evidence.oldOutputTitle !== "Superseded") failures.push("evidence.oldOutputTitle must be Superseded");
  if (evidence.oldSummarySuperseded !== true) failures.push("evidence.oldSummarySuperseded must be true");
  if (evidence.oldSummaryPrivatePhraseMatches !== 0) failures.push("evidence.oldSummaryPrivatePhraseMatches must be 0");
  if (evidence.staleConclusionAttempted !== false) failures.push("evidence.staleConclusionAttempted must be false");
  if (evidence.newCheckHeadSha !== evidence.newHeadSha) failures.push("evidence.newCheckHeadSha must match newHeadSha");
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/runs\/\d+$/.test(stringValue(evidence.oldCheckRunUrl))) {
    failures.push("evidence.oldCheckRunUrl must be a GitHub Check run URL");
  }
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/runs\/\d+$/.test(stringValue(evidence.newCheckRunUrl))) {
    failures.push("evidence.newCheckRunUrl must be a GitHub Check run URL");
  }
  for (const forbidden of [/Bearer\s+/i, /-----BEGIN/i, /private[_-]?key/i, /GITHUB_WEBHOOK_SECRET/i, /token/i, /jwt/i]) {
    if (forbidden.test(serialized)) failures.push(`recording contains forbidden secret marker: ${forbidden}`);
  }

  return { ok: failures.length === 0, failures };
}

class GitHubFetchTransport implements GitHubGovernanceApiTransport {
  constructor(private readonly options: { apiBaseUrl: string; token: string }) {}

  async request(input: GitHubGovernanceApiRequest): Promise<GitHubGovernanceApiResponse> {
    const response = await fetch(new URL(input.path, this.options.apiBaseUrl), {
      method: input.method,
      headers: {
        accept: input.accept,
        authorization: `Bearer ${this.options.token}`,
        "content-type": "application/json",
        "user-agent": "ArchContext-FG3-Check-Supersede-Readback",
        "x-github-api-version": GITHUB_API_VERSION
      },
      body: input.method === "GET" ? undefined : JSON.stringify(input.body)
    });
    return {
      statusCode: response.status,
      body: await readJsonOrUndefined(response),
      requestId: response.headers.get("x-github-request-id") ?? undefined
    };
  }
}

async function createInstallationAccessToken(input: { apiBaseUrl: string; installationId: number; appJwt: string }) {
  const response = await githubRequest({
    apiBaseUrl: input.apiBaseUrl,
    path: `/app/installations/${input.installationId}/access_tokens`,
    method: "POST",
    authorization: `Bearer ${input.appJwt}`
  });
  const body = readRecord(response.body);
  const access = response.ok && typeof body.token === "string" ? body.token : "";
  return { status: response.status, requestId: response.requestId, access };
}

async function fetchRepositoryId(input: { apiBaseUrl: string; repository: string; access: string }): Promise<number | undefined> {
  const response = await githubRequest({
    apiBaseUrl: input.apiBaseUrl,
    path: `/repos/${input.repository}`,
    method: "GET",
    authorization: `Bearer ${input.access}`
  });
  const body = readRecord(response.body);
  return optionalPositiveInteger(body.id, "repositoryId");
}

async function readCheckRun(input: { apiBaseUrl: string; repositoryId: number; checkRunId: string; access: string }) {
  return githubRequest({
    apiBaseUrl: input.apiBaseUrl,
    path: `/repositories/${input.repositoryId}/check-runs/${encodeURIComponent(input.checkRunId)}`,
    method: "GET",
    authorization: `Bearer ${input.access}`
  });
}

async function githubRequest(input: {
  apiBaseUrl: string;
  path: string;
  method: "GET" | "POST";
  authorization: string;
  body?: unknown;
}) {
  const response = await fetch(new URL(input.path, input.apiBaseUrl), {
    method: input.method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: input.authorization,
      "content-type": "application/json",
      "user-agent": "ArchContext-FG3-Check-Supersede-Readback",
      "x-github-api-version": GITHUB_API_VERSION
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body)
  });
  return {
    ok: response.ok,
    status: response.status,
    requestId: response.headers.get("x-github-request-id") ?? undefined,
    body: await readJsonOrUndefined(response)
  };
}

function createGitHubAppJwt(input: { appId: string; privateKeyPem: string }): string {
  if (!/^[1-9]\d*$/.test(input.appId)) throw new Error("github-app-id-invalid");
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({ iat: now - 60, exp: now + 540, iss: input.appId });
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(input.privateKeyPem);
  return `${signingInput}.${base64Url(signature)}`;
}

function renderHuman(result: Awaited<ReturnType<typeof runFg3CheckSupersedeReadback>>): string {
  const lines = [`[fg3-check-supersede-readback] ${result.ok ? "OK" : "FAILED"}`];
  lines.push(`- old: ${result.evidence.oldCheckRunId} ${result.evidence.oldConclusion}`);
  lines.push(`- new: ${result.evidence.newCheckRunId} ${result.evidence.newCheckStatus}`);
  lines.push(`- superseded: ${result.evidence.oldSummarySuperseded}`);
  for (const failure of result.failures) lines.push(`- ${failure}`);
  return lines.join("\n");
}

function monotonicClock() {
  let now = 1000;
  return () => {
    now += 17;
    return now;
  };
}

async function readJsonOrUndefined(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  return JSON.parse(text) as unknown;
}

function parseDotenv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) throw new Error(`invalid dotenv line: ${line}`);
    env[match[1]] = unquote(match[2] ?? "");
  }
  return env;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\n/g, "\n");
  }
  return trimmed;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function firstString(value: unknown, key: string): string {
  const record = readRecord(value);
  const items = record[key];
  return Array.isArray(items) && typeof items[0] === "string" ? items[0] : "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function requireString(value: unknown, label: string, failures: string[]): string {
  if (typeof value !== "string" || value.length === 0) {
    failures.push(`${label} must be a non-empty string`);
    return "";
  }
  return value;
}

function requireSha(value: unknown, label: string, failures: string[]): string {
  const text = stringValue(value);
  if (!/^[0-9a-f]{40}$/i.test(text)) {
    failures.push(`${label} must be a 40-character Git SHA`);
    return "";
  }
  return text;
}

function parsePositiveInteger(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return parsePositiveInteger(value, label);
}

function extractPullNumber(url: string): string {
  const match = /\/pull\/(\d+)(?:$|[/?#])/.exec(url);
  if (!match) return "";
  return match[1];
}

function normalizeBaseUrl(value: string): string {
  return new URL(String(value)).toString().replace(/\/$/, "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(Buffer.from(JSON.stringify(value)));
}

function base64Url(value: Buffer): string {
  return value.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
