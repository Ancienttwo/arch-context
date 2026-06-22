import { createHmac, createSign, timingSafeEqual } from "node:crypto";
import { checkDeliveryIdempotencyKey } from "../../packages/cloud/cloud-db/src/index.ts";
import {
  CHECK_DELIVERY_QUEUE_MESSAGE_SCHEMA_VERSION,
  ControlPlane,
  DEFAULT_CHECK_DELIVERY_RETRY_POLICY,
  type CheckDeliveryQueueMessage,
  type CheckDeliveryQueueSendOptions
} from "../../packages/cloud/control-plane/src/index.ts";
import {
  DEVELOPER_REVIEW_CHECK_NAME,
  digestJson,
  type CheckDelivery,
  type CloudEgressEnvelope
} from "../../packages/contracts/src/index.ts";
import {
  GitHubGovernanceRestPort,
  RecordingGitHubGovernanceApiTransport,
  projectVerifiedGitHubWebhook,
  renderSupersededCheckSummary,
  verifyGitHubWebhookSignature,
  type GitHubGovernanceApiRequest,
  type GitHubGovernanceApiResponse,
  type GitHubGovernanceApiTransport,
  type ProjectVerifiedGitHubWebhookInput
} from "../../packages/cloud/github-app/src/index.ts";

interface Env {
  ARCHCONTEXT_ENV?: string;
  GITHUB_API_BASE_URL?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY_PEM?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  FG2_STAGING_REPOSITORY?: string;
}

const supportedGitHubEvents = new Set<ProjectVerifiedGitHubWebhookInput["eventName"]>([
  "pull_request",
  "check_run",
  "installation",
  "installation_repositories"
]);

const FG5_CHECK_FAILURE_READBACK_PATH = "/v1/fg5/check-delivery/failure-injection";
const READBACK_SIGNATURE_HEADER = "x-archcontext-readback-signature";
const READBACK_TIMESTAMP_HEADER = "x-archcontext-readback-timestamp";
const FG5_READBACK_SECRET_PATTERNS = [
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
const FG5_READBACK_CODE_CONTENT_PATTERNS = [
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
const FG5_READBACK_FORBIDDEN_KEYS = new Set([
  "rawbody",
  "body",
  "content",
  "diff",
  "patch",
  "files",
  "blob",
  "tree",
  "token",
  "authorization",
  "privatekey",
  "webhooksecret",
  "signature256",
  "nonce"
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return healthResponse(env);
    if (url.pathname === "/v1/github/webhooks") return handleGitHubWebhook(request, env);
    if (url.pathname === FG5_CHECK_FAILURE_READBACK_PATH) {
      return handleFg5CheckFailureInjectionReadback(request, env, url.pathname);
    }
    return jsonResponse({ ok: false, error: "not_found" }, { status: 404 });
  }
};

async function handleFg5CheckFailureInjectionReadback(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }
  if ((env.ARCHCONTEXT_ENV ?? "staging") !== "staging") {
    return jsonResponse({ ok: false, error: "not_found" }, { status: 404 });
  }
  try {
    verifyReadbackSignature({ request, env, path });
  } catch {
    return jsonResponse({ ok: false, error: "readback_unauthorized" }, { status: 401 });
  }

  return jsonResponse(await buildFg5CheckFailureInjectionReadback({
    environment: env.ARCHCONTEXT_ENV ?? "staging",
    generatedAt: new Date().toISOString()
  }));
}

async function buildFg5CheckFailureInjectionReadback(input: { environment: string; generatedAt: string }) {
  const cp = new ControlPlane();
  const timestamp = createTimestampFactory(input.generatedAt);
  const challengeId = "chal_fg5_eg3_check_failure";
  const headSha = "f".repeat(40);
  const checkDelivery: CheckDelivery = {
    schemaVersion: "archcontext.check-delivery/v1",
    deliveryId: checkDeliveryIdempotencyKey({
      challengeId,
      checkName: DEVELOPER_REVIEW_CHECK_NAME,
      headSha
    }),
    challengeId,
    checkRunId: null,
    checkName: DEVELOPER_REVIEW_CHECK_NAME,
    headSha,
    status: "PENDING",
    attemptCount: 0,
    nextAttemptAt: null,
    lastErrorCode: null,
    createdAt: timestamp(0),
    updatedAt: timestamp(0)
  };
  const policy = {
    ...DEFAULT_CHECK_DELIVERY_RETRY_POLICY,
    maxAttempts: 3,
    baseDelaySeconds: 1,
    maxDelaySeconds: 5,
    jitterRatio: 0
  };
  const sentMessages: { message: CheckDeliveryQueueMessage; options?: CheckDeliveryQueueSendOptions }[] = [];
  const queue = {
    send(message: CheckDeliveryQueueMessage, options?: CheckDeliveryQueueSendOptions) {
      sentMessages.push({ message, ...(options === undefined ? {} : { options }) });
    }
  };
  const payloadDigest = digestJson({
    schemaVersion: "archcontext.fg5-check-delivery-payload/v1",
    deliveryId: checkDelivery.deliveryId,
    challengeId,
    checkName: DEVELOPER_REVIEW_CHECK_NAME,
    headSha
  });

  const firstRetry = cp.planCheckDeliveryRetry({
    checkDelivery,
    now: timestamp(1),
    errorCode: "github-503",
    retryAfter: "2",
    policy
  });
  if (!firstRetry.retry || firstRetry.delaySeconds === undefined) throw new Error("fg5-readback-first-retry-not-scheduled");
  const firstQueue = await cp.enqueueCheckDelivery({
    queue,
    checkDelivery: firstRetry.checkDelivery,
    payloadDigest,
    delaySeconds: firstRetry.delaySeconds
  });

  const secondRetry = cp.planCheckDeliveryRetry({
    checkDelivery: firstRetry.checkDelivery,
    now: timestamp(3),
    errorCode: "github-503",
    policy
  });
  if (!secondRetry.retry || secondRetry.delaySeconds === undefined) throw new Error("fg5-readback-second-retry-not-scheduled");
  const secondQueue = await cp.enqueueCheckDelivery({
    queue,
    checkDelivery: secondRetry.checkDelivery,
    payloadDigest,
    delaySeconds: secondRetry.delaySeconds
  });

  const maxed = cp.planCheckDeliveryRetry({
    checkDelivery: secondRetry.checkDelivery,
    now: timestamp(6),
    errorCode: "github-503",
    policy
  });
  if (maxed.retry || maxed.reason !== "check-delivery-max-attempts-reached") {
    throw new Error("fg5-readback-max-attempts-not-reached");
  }

  const deadLetter = cp.deadLetterCheckDelivery({
    checkDelivery: secondRetry.checkDelivery,
    now: timestamp(7),
    errorCode: "CHECK_DELIVERY_MAX_ATTEMPTS"
  });
  const replay = cp.replayDeadLetterCheckDelivery({
    checkDelivery: deadLetter,
    now: timestamp(8),
    authorization: {
      actorId: "ops:fg5-eg3-readback",
      permissionSource: "manual-ops",
      verifiedAt: timestamp(8),
      reason: "fg5-eg3-injected-github-check-api-failure"
    }
  });
  const replayQueue = await cp.enqueueCheckDelivery({
    queue,
    checkDelivery: replay.checkDelivery,
    payloadDigest
  });

  const evidence = {
    checkApiFailureInjected: true,
    checkDeliveryId: checkDelivery.deliveryId,
    challengeId,
    checkName: DEVELOPER_REVIEW_CHECK_NAME,
    headSha,
    injectedGitHubApiFailures: [
      {
        operation: "github.check-update",
        pathTemplate: "/repositories/{repository_id}/check-runs/{check_run_id}",
        statusCode: 503,
        retryAfterSeconds: 2
      },
      {
        operation: "github.check-update",
        pathTemplate: "/repositories/{repository_id}/check-runs/{check_run_id}",
        statusCode: 503,
        retryAfterSeconds: null
      }
    ],
    retry: {
      policy,
      scheduled: [
        summarizeRetry(firstRetry, firstQueue.messageDigest),
        summarizeRetry(secondRetry, secondQueue.messageDigest)
      ],
      maxAttemptsReached: true,
      maxAttemptDecision: {
        retry: maxed.retry,
        reason: maxed.reason,
        attemptCount: maxed.attemptCount,
        maxAttempts: maxed.maxAttempts
      }
    },
    deadLetter: {
      status: deadLetter.status,
      attemptCount: deadLetter.attemptCount,
      lastErrorCode: deadLetter.lastErrorCode,
      nextAttemptAt: deadLetter.nextAttemptAt,
      updatedAt: deadLetter.updatedAt
    },
    replay: {
      replayed: replay.replayed,
      source: replay.source,
      replayDigest: replay.replayDigest,
      statusAfterReplay: replay.checkDelivery.status,
      attemptCountAfterReplay: replay.checkDelivery.attemptCount,
      lastErrorCodeAfterReplay: replay.checkDelivery.lastErrorCode
    },
    queue: {
      schemaVersion: CHECK_DELIVERY_QUEUE_MESSAGE_SCHEMA_VERSION,
      retryEnqueueCount: 2,
      replayEnqueued: true,
      replayMessageDigest: replayQueue.messageDigest,
      sentMessages: sentMessages.map(({ message, options }) => ({
        message,
        options: options ?? null
      }))
    }
  };
  const record = {
    schemaVersion: "archcontext.fg5-check-failure-readback/v1",
    environment: input.environment,
    status: "verified",
    ok: true,
    generatedAt: input.generatedAt,
    route: FG5_CHECK_FAILURE_READBACK_PATH,
    evidence,
    privacy: scanFg5ReadbackPrivacy(evidence),
    failures: [] as string[]
  };
  record.privacy = scanFg5ReadbackPrivacy(record);
  if (record.privacy.privateContentHits !== 0 || record.privacy.secretMarkerHits !== 0 || record.privacy.forbiddenEndpointOrMediaHits !== 0) {
    return {
      ...record,
      status: "failed",
      ok: false,
      failures: ["fg5 check failure readback contained forbidden private content markers"]
    };
  }
  return record;
}

async function handleGitHubWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const deliveryId = requireHeader(request, "x-github-delivery");
  const eventName = requireHeader(request, "x-github-event");
  const signature256 = requireHeader(request, "x-hub-signature-256");
  const secret = requireEnv(env.GITHUB_WEBHOOK_SECRET, "GITHUB_WEBHOOK_SECRET");
  const rawBody = await request.text();

  if (!verifyGitHubWebhookSignature({ secret, rawBody, signature256 })) {
    return jsonResponse({ ok: false, error: "github_webhook_signature_invalid" }, { status: 401 });
  }

  if (!supportedGitHubEvents.has(eventName as ProjectVerifiedGitHubWebhookInput["eventName"])) {
    return ignoredWebhookResponse(eventName, deliveryId);
  }

  let projection;
  try {
    projection = projectVerifiedGitHubWebhook({
      secret,
      rawBody,
      signature256,
      deliveryId,
      eventName: eventName as ProjectVerifiedGitHubWebhookInput["eventName"]
    });
  } catch (error) {
    if (safeErrorCode(error) === "github-webhook-action-unsupported") {
      return ignoredWebhookResponse(eventName, deliveryId);
    }
    throw error;
  }

  if (projection.eventName === "pull_request") {
    return handlePullRequestWebhook({ rawBody, env, deliveryId, projection });
  }

  console.log(JSON.stringify({
    message: "archcontext.github-webhook.accepted",
    eventName: projection.eventName,
    deliveryId,
    rawBodyRetained: projection.rawBodyRetained
  }));

  return jsonResponse({
    ok: true,
    status: "accepted",
    eventName: projection.eventName,
    deliveryId,
    rawBodyRetained: projection.rawBodyRetained
  });
}

async function handlePullRequestWebhook(input: {
  rawBody: string;
  env: Env;
  deliveryId: string;
  projection: ReturnType<typeof projectVerifiedGitHubWebhook> & { eventName: "pull_request" };
}): Promise<Response> {
  const repository = `${input.projection.event.repository.owner}/${input.projection.event.repository.name}`;
  if (input.env.FG2_STAGING_REPOSITORY && repository.toLowerCase() !== input.env.FG2_STAGING_REPOSITORY.toLowerCase()) {
    return jsonResponse({
      ok: true,
      status: "ignored",
      reason: "repository_not_in_staging_scope",
      deliveryId: input.deliveryId,
      repository
    }, { status: 202 });
  }

  const context = extractPullRequestContext(input.rawBody);
  const appJwt = createGitHubAppJwt({
    appId: requireEnv(input.env.GITHUB_APP_ID, "GITHUB_APP_ID"),
    privateKeyPem: requireEnv(input.env.GITHUB_APP_PRIVATE_KEY_PEM, "GITHUB_APP_PRIVATE_KEY_PEM")
  });
  const apiBaseUrl = normalizeApiBaseUrl(input.env.GITHUB_API_BASE_URL ?? "https://api.github.com");
  const installationToken = await createInstallationAccessToken({ apiBaseUrl, installationId: context.installationId, appJwt });
  const port = new GitHubGovernanceRestPort(new RecordingGitHubGovernanceApiTransport({
    transport: new GitHubFetchTransport({ apiBaseUrl, token: installationToken }),
    recorder: new ConsoleEgressRecorder()
  }));
  const pullHead = await port.getPullHeadMetadata({
    installationId: context.installationId,
    repositoryId: context.repositoryId,
    pullRequestNumber: input.projection.event.pullRequest.number
  });
  const supersededCheckRunIds = await supersedePreviousDeveloperReviewChecks({
    port,
    installationId: context.installationId,
    repositoryId: context.repositoryId,
    pullRequestNumber: input.projection.event.pullRequest.number,
    action: input.projection.event.action,
    previousHeadSha: context.previousHeadSha,
    currentHeadSha: pullHead.headSha
  });

  const check = await port.createCheckRun({
    installationId: context.installationId,
    repositoryId: context.repositoryId,
    pullRequestNumber: input.projection.event.pullRequest.number,
    headSha: pullHead.headSha,
    name: DEVELOPER_REVIEW_CHECK_NAME,
    status: "in_progress"
  });

  await port.updateCheckRun({
    installationId: context.installationId,
    repositoryId: context.repositoryId,
    checkRunId: check.checkRunId,
    name: DEVELOPER_REVIEW_CHECK_NAME,
    status: "completed",
    conclusion: "neutral",
    output: {
      title: "ArchContext staging webhook verified",
      summary: [
        "FG2 staging received a signed GitHub pull_request webhook and created then updated this Check Run.",
        "",
        "This staging Worker uses only installation metadata, repository numeric ID, pull request number, and head SHA.",
        "It does not call PR files, Contents, Blob, Tree, Diff, Patch, or any code-content GitHub API."
      ].join("\n")
    }
  });

  return jsonResponse({
    ok: true,
    status: "check_updated",
    deliveryId: input.deliveryId,
    repository,
    pullRequestNumber: input.projection.event.pullRequest.number,
    headSha: pullHead.headSha,
    checkRunId: check.checkRunId,
    checkHtmlUrl: check.htmlUrl,
    supersededCheckRunIds,
    rawBodyRetained: input.projection.rawBodyRetained
  });
}

async function supersedePreviousDeveloperReviewChecks(input: {
  port: GitHubGovernanceRestPort;
  installationId: number;
  repositoryId: number;
  pullRequestNumber: number;
  action: "opened" | "synchronize" | "reopened";
  previousHeadSha?: string;
  currentHeadSha: string;
}): Promise<string[]> {
  if (input.action !== "synchronize") return [];
  if (!input.previousHeadSha || input.previousHeadSha === input.currentHeadSha) return [];
  const previousChecks = await input.port.listCheckRunsForRef({
    installationId: input.installationId,
    repositoryId: input.repositoryId,
    ref: input.previousHeadSha,
    name: DEVELOPER_REVIEW_CHECK_NAME
  });
  const superseded: string[] = [];
  for (const check of previousChecks) {
    if (check.name !== DEVELOPER_REVIEW_CHECK_NAME || check.headSha !== input.previousHeadSha) continue;
    await input.port.updateCheckRun({
      installationId: input.installationId,
      repositoryId: input.repositoryId,
      checkRunId: check.checkRunId,
      name: DEVELOPER_REVIEW_CHECK_NAME,
      status: "completed",
      conclusion: "neutral",
      output: {
        title: "Superseded",
        summary: renderSupersededCheckSummary({
          checkName: DEVELOPER_REVIEW_CHECK_NAME,
          previousHeadSha: input.previousHeadSha,
          currentHeadSha: input.currentHeadSha
        })
      }
    });
    superseded.push(check.checkRunId);
  }
  return superseded;
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
        "user-agent": "ArchContext-FG2-Staging",
        "x-github-api-version": "2022-11-28"
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

class ConsoleEgressRecorder {
  record(envelope: CloudEgressEnvelope): void {
    console.log(JSON.stringify({
      message: "archcontext.github-egress",
      ...envelope
    }));
  }
}

async function createInstallationAccessToken(input: { apiBaseUrl: string; installationId: number; appJwt: string }): Promise<string> {
  const response = await fetch(new URL(`/app/installations/${input.installationId}/access_tokens`, input.apiBaseUrl), {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${input.appJwt}`,
      "content-type": "application/json",
      "user-agent": "ArchContext-FG2-Staging",
      "x-github-api-version": "2022-11-28"
    }
  });
  const body = await readJsonOrUndefined(response);
  if (!response.ok) throw new Error(`github-installation-token-failed: ${response.status}`);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("github-installation-token-response-invalid");
  }
  const record = body as Record<string, unknown>;
  if (typeof record.token !== "string" || record.token.length === 0) {
    throw new Error("github-installation-token-response-invalid");
  }
  return record.token;
}

function createGitHubAppJwt(input: { appId: string; privateKeyPem: string }): string {
  if (!/^[1-9]\d*$/.test(input.appId)) throw new Error("github-app-id-invalid");
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iat: now - 60,
    exp: now + 540,
    iss: input.appId
  });
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(input.privateKeyPem);
  return `${signingInput}.${base64Url(signature)}`;
}

function base64UrlJson(value: unknown): string {
  return base64Url(Buffer.from(JSON.stringify(value)));
}

function base64Url(value: Buffer): string {
  return value.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function extractPullRequestContext(rawBody: string): { installationId: number; repositoryId: number; previousHeadSha?: string } {
  const payload = parseRecord(rawBody);
  const installation = requireRecord(payload.installation, "installation");
  const repository = requireRecord(payload.repository, "repository");
  const before = typeof payload.before === "string" && payload.before.length > 0 ? payload.before : undefined;
  return {
    installationId: requirePositiveInteger(installation.id, "installation.id"),
    repositoryId: requirePositiveInteger(repository.id, "repository.id"),
    ...(before ? { previousHeadSha: before } : {})
  };
}

function parseRecord(rawBody: string): Record<string, unknown> {
  const parsed = JSON.parse(rawBody) as unknown;
  return requireRecord(parsed, "payload");
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`github-webhook-field-invalid: ${field}`);
  return value as Record<string, unknown>;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new Error(`github-webhook-field-invalid: ${field}`);
  return value;
}

function requireHeader(request: Request, name: string): string {
  const value = request.headers.get(name);
  if (!value) throw new Error(`github-webhook-header-missing: ${name}`);
  return value;
}

function requireEnv(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`env-missing: ${name}`);
  return value;
}

function normalizeApiBaseUrl(value: string): string {
  const url = new URL(value);
  return url.toString().replace(/\/$/, "");
}

async function readJsonOrUndefined(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  return JSON.parse(text) as unknown;
}

function ignoredWebhookResponse(eventName: string, deliveryId: string): Response {
  return jsonResponse({
    ok: true,
    status: "ignored",
    reason: "unsupported_event_or_action",
    eventName,
    deliveryId,
    rawBodyRetained: false
  }, { status: 202 });
}

function verifyReadbackSignature(input: { request: Request; env: Env; path: string }): void {
  const secret = requireEnv(input.env.GITHUB_WEBHOOK_SECRET, "GITHUB_WEBHOOK_SECRET");
  const timestamp = input.request.headers.get(READBACK_TIMESTAMP_HEADER);
  const signature = input.request.headers.get(READBACK_SIGNATURE_HEADER);
  if (!timestamp || !signature) throw new Error("readback-signature-missing");
  const expected = signReadbackPayload({
    secret,
    method: input.request.method,
    path: input.path,
    timestamp
  });
  if (!constantTimeEqual(signature, expected)) throw new Error("readback-signature-invalid");
}

function signReadbackPayload(input: { secret: string; method: string; path: string; timestamp: string }): string {
  return `sha256=${createHmac("sha256", input.secret)
    .update(`${input.method.toUpperCase()}\n${input.path}\n${input.timestamp}`)
    .digest("hex")}`;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function createTimestampFactory(generatedAt: string): (offsetSeconds: number) => string {
  const baseMs = Date.parse(generatedAt);
  if (!Number.isFinite(baseMs)) throw new Error("fg5-readback-generatedAt-invalid");
  return (offsetSeconds: number) => new Date(baseMs + offsetSeconds * 1000).toISOString();
}

function summarizeRetry(plan: ReturnType<ControlPlane["planCheckDeliveryRetry"]>, messageDigest: string) {
  return {
    retry: plan.retry,
    reason: plan.reason,
    status: plan.checkDelivery.status,
    attemptCount: plan.attemptCount,
    maxAttempts: plan.maxAttempts,
    delaySeconds: plan.delaySeconds,
    retryAfterDelaySeconds: plan.retryAfterDelaySeconds ?? null,
    nextAttemptAt: plan.nextAttemptAt ?? null,
    lastErrorCode: plan.checkDelivery.lastErrorCode,
    queueMessageDigest: messageDigest
  };
}

function scanFg5ReadbackPrivacy(value: unknown) {
  const serialized = JSON.stringify(value);
  return {
    privateContentHits: countPatterns(serialized, FG5_READBACK_SECRET_PATTERNS)
      + countPatterns(serialized, FG5_READBACK_CODE_CONTENT_PATTERNS)
      + collectForbiddenKeys(value).length,
    secretMarkerHits: countPatterns(serialized, FG5_READBACK_SECRET_PATTERNS),
    forbiddenEndpointOrMediaHits: countPatterns(serialized, FG5_READBACK_CODE_CONTENT_PATTERNS),
    forbiddenKeys: collectForbiddenKeys(value)
  };
}

function countPatterns(text: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function collectForbiddenKeys(value: unknown, path = "$", found: string[] = []): string[] {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeys(item, `${path}[${index}]`, found));
    return found;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (FG5_READBACK_FORBIDDEN_KEYS.has(key.toLowerCase())) found.push(childPath);
    collectForbiddenKeys(child, childPath, found);
  }
  return found;
}

function healthResponse(env: Env): Response {
  return jsonResponse({
    ok: true,
    service: "archcontext-fg2-staging",
    environment: env.ARCHCONTEXT_ENV ?? "staging",
    webhookPath: "/v1/github/webhooks",
    repositoryScope: env.FG2_STAGING_REPOSITORY ?? null
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers
    }
  });
}

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.split(":")[0] ?? "unknown").replace(/[^a-zA-Z0-9_.-]/g, "-");
}
