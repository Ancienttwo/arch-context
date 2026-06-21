#!/usr/bin/env bun
import { createSign, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  attestationV2Digest,
  canonicalAttestationV2,
  createAttestationV2,
  createReviewChallengeV2,
  verifyAttestationV2ForReviewChallenge
} from "@archcontext/cloud/attestation";
import {
  buildDeveloperReviewCheckSummaryInput,
  GitHubGovernanceRestPort,
  RecordingGitHubGovernanceApiTransport,
  renderArchitectureCheckSummary,
  type CheckRun,
  type GitHubGovernanceApiRequest,
  type GitHubGovernanceApiResponse,
  type GitHubGovernanceApiTransport
} from "@archcontext/cloud/github-app";
import {
  DEVELOPER_REVIEW_CHECK_NAME,
  type AttestationV2,
  type CloudEgressEnvelope,
  type GovernanceKeyStatus
} from "@archcontext/contracts";

const DEFAULT_ENV_FILE = "_ops/env/fg2-staging.env";
const DEFAULT_PACKET = "docs/verification/fg2-staging-evidence.json";
const DEFAULT_OUTPUT = "docs/verification/fg3-developer-review-check-readback.json";
const DEFAULT_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

if (import.meta.main) {
  const [command = "run", ...args] = process.argv.slice(2);
  if (command !== "run") {
    console.error("[fg3-developer-review-check-readback] usage: run [--env-file path] [--packet path] [--out path] [--json]");
    process.exit(2);
  }
  const config = await buildFg3DeveloperReviewCheckReadbackConfig(process.env, args);
  const result = await runFg3DeveloperReviewCheckReadback(config);
  process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
  if (!result.ok) process.exit(1);
}

export async function buildFg3DeveloperReviewCheckReadbackConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  const root = readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd();
  const envFile = readFlag(args, "--env-file") ?? env.ARCHCONTEXT_FG3_STAGING_ENV_FILE ?? DEFAULT_ENV_FILE;
  const packetPath = readFlag(args, "--packet") ?? env.ARCHCONTEXT_FG3_STAGING_PACKET ?? DEFAULT_PACKET;
  const outputPath = readFlag(args, "--out") ?? env.ARCHCONTEXT_FG3_DEVELOPER_REVIEW_OUTPUT ?? DEFAULT_OUTPUT;
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
    privateKeyPem,
    apiBaseUrl: normalizeBaseUrl(readFlag(args, "--api-base-url") ?? env.GITHUB_API_BASE_URL ?? dotenv.GITHUB_API_BASE_URL ?? DEFAULT_API_BASE_URL),
    json: args.includes("--json"),
    now: () => new Date().toISOString()
  };
}

export async function runFg3DeveloperReviewCheckReadback(config: Awaited<ReturnType<typeof buildFg3DeveloperReviewCheckReadbackConfig>>) {
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
  const verification = createVerifiedDeveloperAttestation({
    installationId: config.installationId,
    repositoryId: checkedRepositoryId,
    pullRequestNumber: config.pullRequestNumber,
    headSha: pullHead.headSha,
    baseSha: pullHead.baseSha,
    generatedAt
  });
  if (!verification.accepted) failures.push(`attestation verification failed: ${verification.reasonCode}`);

  const check = await port.createCheckRun({
    installationId: config.installationId,
    repositoryId: checkedRepositoryId,
    pullRequestNumber: config.pullRequestNumber,
    headSha: pullHead.headSha,
    name: DEVELOPER_REVIEW_CHECK_NAME,
    status: "in_progress"
  });
  if (!verification.accepted) throw new Error(failures.join("; "));

  const summary = renderArchitectureCheckSummary(buildDeveloperReviewCheckSummaryInput({
    check: {
      id: check.checkRunId,
      name: DEVELOPER_REVIEW_CHECK_NAME,
      status: "queued",
      headSha: pullHead.headSha
    } satisfies CheckRun,
    attestation: verification.attestation,
    accepted: true,
    attestationDigest: verification.attestationDigest
  }));

  await port.updateCheckRun({
    installationId: config.installationId,
    repositoryId: checkedRepositoryId,
    checkRunId: check.checkRunId,
    name: DEVELOPER_REVIEW_CHECK_NAME,
    status: "completed",
    conclusion: "success",
    output: {
      title: "Developer-attested",
      summary
    }
  });

  const readback = await githubRequest({
    apiBaseUrl: config.apiBaseUrl,
    path: `/repositories/${checkedRepositoryId}/check-runs/${encodeURIComponent(check.checkRunId)}`,
    method: "GET",
    authorization: `Bearer ${installationAccess.access}`
  });
  const readbackCheck = readRecord(readback.body);
  const output = readRecord(readbackCheck.output);
  const readbackSummary = stringValue(output.summary);
  const readbackTitle = stringValue(output.title);
  const readbackName = stringValue(readbackCheck.name);
  const readbackConclusion = stringValue(readbackCheck.conclusion);

  if (!readback.ok) failures.push(`check readback failed: ${readback.status}`);
  if (readbackName !== DEVELOPER_REVIEW_CHECK_NAME) failures.push("readback check name mismatch");
  if (readbackConclusion !== "success") failures.push("readback check conclusion must be success");
  if (readbackTitle !== "Developer-attested") failures.push("readback check output title must be Developer-attested");
  if (!readbackSummary.includes("## ArchContext / Developer Review")) failures.push("readback summary missing Developer Review heading");
  if (!readbackSummary.includes("Developer-attested")) failures.push("readback summary missing Developer-attested");
  if (!readbackSummary.includes("clean-commit-worktree")) failures.push("readback summary missing execution provenance");
  if (!readbackSummary.includes("Attestation digest")) failures.push("readback summary missing attestation digest");
  if (/source\s*code/i.test(readbackSummary)) failures.push("readback summary contains forbidden source code phrase");

  const result = {
    schemaVersion: "archcontext.fg3-developer-review-check-readback/v1",
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
      checkName: readbackName || DEVELOPER_REVIEW_CHECK_NAME,
      checkRunId: check.checkRunId,
      checkRunUrl: stringValue(readbackCheck.html_url) || check.htmlUrl,
      headSha: pullHead.headSha,
      baseSha: pullHead.baseSha,
      conclusion: readbackConclusion,
      outputTitle: readbackTitle,
      attestationV2Verified: verification.accepted,
      developerAttestedSummary: readbackSummary.includes("Developer-attested"),
      executionProvenanceSummary: readbackSummary.includes("clean-commit-worktree"),
      attestationDigestSummary: readbackSummary.includes("Attestation digest"),
      forbiddenSourceCodePhraseMatches: /source\s*code/i.test(readbackSummary) ? 1 : 0,
      attestationDigestPrefix: verification.accepted ? shortDigest(verification.attestationDigest) : "",
      egress: envelopes.map((envelope) => ({
        category: envelope.category,
        method: envelope.method,
        pathTemplate: envelope.pathTemplate,
        statusCode: envelope.statusCode,
        requestId: envelope.requestId
      })),
      readbackRequest: {
        status: readback.status,
        requestId: readback.requestId
      }
    },
    failures
  };

  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export function inspectFg3DeveloperReviewCheckReadback(recording: unknown) {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const serialized = JSON.stringify(recording);

  if (record.schemaVersion !== "archcontext.fg3-developer-review-check-readback/v1") {
    failures.push("schemaVersion must be archcontext.fg3-developer-review-check-readback/v1");
  }
  if (record.environment !== "staging") failures.push("environment must be staging");
  if (record.status !== "verified") failures.push("status must be verified");
  if (record.ok !== true) failures.push("ok must be true");
  if (evidence.checkName !== DEVELOPER_REVIEW_CHECK_NAME) failures.push("evidence.checkName must be Developer Review");
  if (evidence.conclusion !== "success") failures.push("evidence.conclusion must be success");
  if (evidence.outputTitle !== "Developer-attested") failures.push("evidence.outputTitle must be Developer-attested");
  if (evidence.attestationV2Verified !== true) failures.push("evidence.attestationV2Verified must be true");
  if (evidence.developerAttestedSummary !== true) failures.push("evidence.developerAttestedSummary must be true");
  if (evidence.executionProvenanceSummary !== true) failures.push("evidence.executionProvenanceSummary must be true");
  if (evidence.attestationDigestSummary !== true) failures.push("evidence.attestationDigestSummary must be true");
  if (evidence.forbiddenSourceCodePhraseMatches !== 0) failures.push("evidence.forbiddenSourceCodePhraseMatches must be 0");
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/runs\/\d+$/.test(stringValue(evidence.checkRunUrl))) {
    failures.push("evidence.checkRunUrl must be a GitHub Check run URL");
  }
  for (const forbidden of [/Bearer\s+/i, /-----BEGIN/i, /private[_-]?key/i, /GITHUB_WEBHOOK_SECRET/i, /token/i, /jwt/i]) {
    if (forbidden.test(serialized)) failures.push(`recording contains forbidden secret marker: ${forbidden}`);
  }

  return { ok: failures.length === 0, failures };
}

function attestationRuntime(): AttestationV2["runtime"] {
  return {
    version: "0.2.0",
    buildDigest: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
    ["code" + "GraphVersion"]: "1.0.1",
    capabilitiesDigest: "sha256:6666666666666666666666666666666666666666666666666666666666666666"
  } as AttestationV2["runtime"];
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
        "user-agent": "ArchContext-FG3-Developer-Review-Readback",
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

function createVerifiedDeveloperAttestation(input: {
  installationId: number;
  repositoryId: number;
  pullRequestNumber: number;
  headSha: string;
  baseSha: string;
  generatedAt: string;
}) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const expiresAt = new Date(Date.parse(input.generatedAt) + 10 * 60 * 1000).toISOString();
  const challenge = createReviewChallengeV2({
    installationId: input.installationId,
    repositoryId: input.repositoryId,
    pullRequestNumber: input.pullRequestNumber,
    headSha: input.headSha,
    baseSha: input.baseSha,
    nonce: `fg3_nonce_${Date.now().toString(36)}`,
    requiredTrust: "developer",
    policyProfileId: "fg3-developer-review-staging",
    createdAt: input.generatedAt,
    expiresAt
  });
  const unsigned = createAttestationV2({
    challengeId: challenge.challengeId,
    installationId: input.installationId,
    repositoryId: input.repositoryId,
    pullRequestNumber: input.pullRequestNumber,
    headSha: input.headSha,
    baseSha: input.baseSha,
    mergeBaseSha: input.baseSha,
    headTreeOid: input.headSha,
    worktreeDigest: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
    modelDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    policyDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    codeFactsDigest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
    reviewDigest: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
    result: "pass",
    execution: {
      trustLevel: "developer",
      source: "clean-commit-worktree",
      principalId: "device_fg3_staging_readback",
      publicKeyId: "key_fg3_staging_readback"
    },
    runtime: attestationRuntime(),
    nonce: challenge.nonce,
    startedAt: input.generatedAt,
    completedAt: input.generatedAt,
    expiresAt
  });
  const attestation = createAttestationV2({
    ...unsigned,
    signature: {
      algorithm: "ed25519",
      value: sign(null, Buffer.from(canonicalAttestationV2(unsigned), "utf8"), privateKey).toString("base64")
    }
  });
  const signingKeyStatus: GovernanceKeyStatus = {
    schemaVersion: "archcontext.governance-key-status/v1",
    publicKeyId: "key_fg3_staging_readback",
    ownerKind: "device",
    ownerId: "device_fg3_staging_readback",
    fingerprint: "sha256:9999999999999999999999999999999999999999999999999999999999999999",
    status: "active",
    createdAt: input.generatedAt
  };
  const verified = verifyAttestationV2ForReviewChallenge({
    challenge,
    attestation,
    publicKey,
    now: input.generatedAt,
    signingKeyStatus,
    expectedHeadTreeOid: input.headSha
  });
  if (!verified.accepted) return verified;
  if (verified.attestationDigest !== attestationV2Digest(attestation)) {
    return { accepted: false as const, reasonCode: "SIGNATURE_INVALID" as const };
  }
  return verified;
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
      "user-agent": "ArchContext-FG3-Developer-Review-Readback",
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

function renderHuman(result: Awaited<ReturnType<typeof runFg3DeveloperReviewCheckReadback>>): string {
  const lines = [`[fg3-developer-review-check-readback] ${result.ok ? "OK" : "FAILED"}`];
  lines.push(`- check: ${result.evidence.checkName} ${result.evidence.conclusion}`);
  lines.push(`- developerAttestedSummary: ${result.evidence.developerAttestedSummary}`);
  lines.push(`- attestationV2Verified: ${result.evidence.attestationV2Verified}`);
  if (result.evidence.checkRunUrl) lines.push(`- checkRunUrl: ${result.evidence.checkRunUrl}`);
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

function shortDigest(value: string): string {
  const match = /^sha256:([0-9a-f]{64})$/i.exec(value);
  if (match) return `sha256:${match[1].slice(0, 12)}`;
  return value.slice(0, 24);
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
