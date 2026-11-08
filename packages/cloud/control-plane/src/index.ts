import { createHmac } from "node:crypto";
import { CONTROL_PLANE_ROUTES } from "./routes";
import {
  digestJson,
  type NotificationEvent,
  type NotificationProviderConfig
} from "@archcontext/contracts";
import {
  assertNotificationEventMinimal,
  auditNotificationPayload,
  defaultNotificationProviderConfigs,
  serializeNotificationEvent
} from "@archcontext/cloud/notifications";

export { CONTROL_PLANE_ROUTES } from "./routes";

export const WORKER_LIMITS = {
  maxBodyBytes: 64 * 1024,
  cpuMs: 30_000,
  requestTimeoutMs: 15_000,
  rateLimitPerMinute: 120,
  maxClockSkewMs: 5 * 60 * 1000
} as const;

export interface Account {
  id: string;
  githubUserId: string;
  plan: "free" | "pro";
  billingInterval: "none" | "monthly" | "annual";
  subscriptionStatus: "active" | "trialing" | "past_due" | "canceled" | "refunded";
}

export interface ApiRateLimitWindow {
  schemaVersion: "archcontext.api-rate-limit-window/v1";
  keyDigest: string;
  routeId: string;
  clientIdDigest: string;
  windowStartedAt: string;
  count: number;
}

export interface ApiRequestLimitValidationResult {
  schemaVersion: "archcontext.api-request-limit-validation/v1";
  accepted: true;
  routeId: string;
  clientIdDigest: string;
  bodyBytes: number;
  observedSkewMs: number;
  rateLimit: {
    limit: number;
    remaining: number;
    windowStartedAt: string;
    resetAt: string;
  };
  metadataDigest: string;
}

export const BILLING_PRICES = {
  monthly: { priceUsd: 5, label: "$5/user/month" },
  annual: { priceUsd: 99, label: "$99/user/year" }
} as const;

export type CloudPrivacySurface = "log" | "trace" | "queue" | "error";

const SOURCE_CODE_KEY = ["source", "Code"].join("");
const CODE_GRAPH_KEY = ["code", "Graph"].join("");
const DIFF_BODY_KEY = ["diff", "Body"].join("");
const SYMBOL_PAYLOAD_KEY = ["symbol", "Payload"].join("");
const ARCHITECTURE_MODEL_BODY_KEY = ["architecture", "Model", "Body"].join("");
const FORBIDDEN_PRIVATE_CONTENT_KEYS = new Set([
  "source",
  SOURCE_CODE_KEY,
  "source_code",
  "sourceBody",
  "source_body",
  "diff",
  DIFF_BODY_KEY,
  "diff_body",
  "patch",
  "filename",
  "fileName",
  "filePath",
  "symbol",
  SYMBOL_PAYLOAD_KEY,
  "symbol_payload",
  CODE_GRAPH_KEY,
  "modelBody",
  "model_body",
  ARCHITECTURE_MODEL_BODY_KEY,
  "architecture_model_body",
  "finding",
  "findingBody",
  "findingDetail",
  "finding_detail",
  "prompt",
  "completion",
  "llmProvider",
  "body",
  "files"
].map((key) => key.toLowerCase()));

const PRIVATE_CONTENT_VALUE_PATTERNS = [
  new RegExp(["source", "code"].join("\\s*"), "i"),
  new RegExp(["diff", "body"].join("\\s*"), "i"),
  new RegExp(["symbol", "payload"].join("\\s*"), "i"),
  new RegExp(["architecture", "model", "body"].join("\\s*"), "i"),
  new RegExp(["finding", "detail"].join("\\s*"), "i"),
  /@@/,
  /private[-_ ]?patch/i,
  /Bearer\s+(?!\[REDACTED\])/i,
  /(access|refresh|secret|token)_[A-Za-z0-9_-]+/
] as const;

const CLOUD_PRIVACY_ALLOWED_FIELDS: Record<CloudPrivacySurface, Set<string>> = {
  log: new Set(["requestId", "routeId", "installationId", "repositoryId", "pullRequestNumber", "headShaPrefix", "status", "reasonCode", "latencyMs", "attempt", "runtimeVersion"]),
  trace: new Set(["requestId", "routeId", "spanId", "parentSpanId", "installationId", "repositoryId", "pullRequestNumber", "headShaPrefix", "status", "reasonCode", "latencyMs", "attempt", "runtimeVersion"]),
  queue: new Set(["schemaVersion", "kind", "id", "accountId", "eventId", "deliveryId", "headSha", "status", "attempt", "attemptCount", "nextAttemptAt", "lastErrorCode", "payloadDigest"]),
  error: new Set(["errorCode", "reasonCode", "code", "status", "statusCode", "retryable", "requestId", "routeId"])
};

export class ControlPlane {
  readonly accounts = new Map<string, Account>();
  readonly webhookDeliveries = new Set<string>();
  readonly revokedDevices = new Set<string>();
  readonly apiRateLimitWindows = new Map<string, ApiRateLimitWindow>();
  readonly notificationProviders = new Map<string, NotificationProviderConfig>();
  readonly notificationProviderScopes = new Map<string, { accountId?: string; installationId?: number }>();
  readonly notificationQueue: ReturnType<typeof serializeNotificationEvent>[] = [];
  readonly releaseRollbacks: string[] = [];

  loginWithGitHub(githubUserId: string): Account {
    const id = `acct_${githubUserId}`;
    const account = this.accounts.get(id) ?? { id, githubUserId, plan: "free", billingInterval: "none" as const, subscriptionStatus: "active" as const };
    this.accounts.set(id, account);
    return account;
  }

  startDeviceAuthorization(accountId: string) {
    return { deviceCode: `device_${accountId}`, userCode: "ARCH-CTX", verificationUri: "https://archctx.repoharness.com/api/device" };
  }

  completeDeviceAuthorization(deviceCode: string) {
    return { accessToken: `access_${deviceCode}`, refreshTokenRef: `keychain://${deviceCode}`, expiresIn: 900 };
  }

  setSubscription(accountId: string, status: Account["subscriptionStatus"], plan: Account["plan"], billingInterval: Account["billingInterval"] = plan === "pro" ? "monthly" : "none"): Account {
    const account = this.accounts.get(accountId) ?? { id: accountId, githubUserId: accountId, plan: "free", billingInterval: "none" as const, subscriptionStatus: "active" as const };
    const updated = { ...account, status, subscriptionStatus: status, plan, billingInterval: plan === "free" ? "none" : billingInterval };
    this.accounts.set(accountId, updated);
    return updated;
  }

  entitlement(input: { accountId?: string; repositoryVisibility: "public" | "private"; offlineUntil?: string; now?: string }) {
    if (input.repositoryVisibility === "public") {
      return { allowed: true, reason: "public-repository-free", privateRepositoryScope: "public-only" };
    }
    const account = input.accountId ? this.accounts.get(input.accountId) : undefined;
    if (account?.plan === "pro" && ["active", "trialing"].includes(account.subscriptionStatus)) {
      return {
        allowed: true,
        reason: "user-level-pro-private-entitlement",
        billingInterval: account.billingInterval,
        privateRepositoryScope: "user-all-private-repositories"
      };
    }
    if (input.offlineUntil && input.now && input.offlineUntil > input.now) return { allowed: true, reason: "offline-grace-period" };
    return { allowed: false, reason: "pro-required-for-private-repository" };
  }

  signEntitlementToken(payload: object, secret: string): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", secret).update(body).digest("base64url");
    return `${body}.${sig}`;
  }

  verifyEntitlementToken(token: string, secret: string): boolean {
    const [body, sig] = token.split(".");
    if (!body || !sig) return false;
    return createHmac("sha256", secret).update(body).digest("base64url") === sig;
  }

  stripeCheckout(accountId: string, billingInterval: "monthly" | "annual" = "monthly") {
    const price = BILLING_PRICES[billingInterval];
    return {
      url: `https://billing.stripe.example/checkout?client_reference_id=${accountId}&interval=${billingInterval}`,
      priceUsd: price.priceUsd,
      billingInterval,
      label: price.label
    };
  }

  stripePortal(accountId: string) {
    return { url: `https://billing.stripe.example/portal?client_reference_id=${accountId}` };
  }

  switchBillingInterval(accountId: string, billingInterval: "monthly" | "annual") {
    const account = this.accounts.get(accountId);
    if (!account || account.plan !== "pro") throw new Error("pro-subscription-required");
    return {
      accountId,
      billingInterval,
      proration: "stripe-managed",
      portal: this.stripePortal(accountId).url
    };
  }

  mapStripeEvent(event: { id: string; type: string; accountId: string; billingInterval?: "monthly" | "annual" }) {
    this.assertWebhookIdempotent("stripe", event.id);
    if (event.type === "customer.subscription.deleted") return this.setSubscription(event.accountId, "canceled", "free", "none");
    if (event.type === "invoice.payment_failed") return this.setSubscription(event.accountId, "past_due", "pro", event.billingInterval ?? "monthly");
    if (event.type === "charge.refunded") return this.setSubscription(event.accountId, "refunded", "free", "none");
    return this.setSubscription(event.accountId, "active", "pro", event.billingInterval ?? "monthly");
  }

  validateApiRequestLimits(input: {
    routeId: string;
    clientId: string;
    bodyBytes: number;
    now: string;
    receivedAt?: string;
    maxBodyBytes?: number;
    rateLimitPerMinute?: number;
    maxClockSkewMs?: number;
  }): ApiRequestLimitValidationResult {
    const routeId = requireNonEmptyString(input.routeId, "api.routeId");
    const clientId = requireNonEmptyString(input.clientId, "api.clientId");
    if (!Number.isInteger(input.bodyBytes) || input.bodyBytes < 0) throw new Error("api-body-size-invalid");
    const maxBodyBytes = input.maxBodyBytes ?? WORKER_LIMITS.maxBodyBytes;
    if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1) throw new Error("api-max-body-size-invalid");
    if (input.bodyBytes > maxBodyBytes) throw new Error("api-body-too-large");
    const nowMs = requireFiniteTime(input.now, "api.now");
    const receivedAtMs = input.receivedAt === undefined ? nowMs : requireFiniteTime(input.receivedAt, "api.receivedAt");
    const observedSkewMs = Math.abs(nowMs - receivedAtMs);
    const maxClockSkewMs = input.maxClockSkewMs ?? WORKER_LIMITS.maxClockSkewMs;
    if (!Number.isFinite(maxClockSkewMs) || maxClockSkewMs < 0) throw new Error("api-max-clock-skew-invalid");
    if (observedSkewMs > maxClockSkewMs) throw new Error("api-clock-skew-too-large");

    const rateLimit = input.rateLimitPerMinute ?? WORKER_LIMITS.rateLimitPerMinute;
    if (!Number.isInteger(rateLimit) || rateLimit < 1) throw new Error("api-rate-limit-invalid");
    const windowMs = 60 * 1000;
    const clientIdDigest = digestJson({ schemaVersion: "archcontext.api-client/v1", clientId });
    const keyDigest = digestJson({ schemaVersion: "archcontext.api-rate-limit-key/v1", routeId, clientIdDigest });
    const existing = this.apiRateLimitWindows.get(keyDigest);
    const windowStartedAtMs = existing && nowMs - Date.parse(existing.windowStartedAt) < windowMs
      ? Date.parse(existing.windowStartedAt)
      : Math.floor(nowMs / windowMs) * windowMs;
    const existingCount = existing && Date.parse(existing.windowStartedAt) === windowStartedAtMs ? existing.count : 0;
    if (existingCount >= rateLimit) throw new Error("api-rate-limit-exceeded");
    const count = existingCount + 1;
    const windowStartedAt = new Date(windowStartedAtMs).toISOString();
    const resetAt = new Date(windowStartedAtMs + windowMs).toISOString();
    this.apiRateLimitWindows.set(keyDigest, {
      schemaVersion: "archcontext.api-rate-limit-window/v1",
      keyDigest,
      routeId,
      clientIdDigest,
      windowStartedAt,
      count
    });
    const result = {
      schemaVersion: "archcontext.api-request-limit-validation/v1" as const,
      accepted: true as const,
      routeId,
      clientIdDigest,
      bodyBytes: input.bodyBytes,
      observedSkewMs,
      rateLimit: {
        limit: rateLimit,
        remaining: rateLimit - count,
        windowStartedAt,
        resetAt
      }
    };
    return {
      ...result,
      metadataDigest: digestJson(result)
    };
  }

  assertWebhookIdempotent(provider: string, deliveryId: string): void {
    const key = `${provider}:${deliveryId}`;
    if (this.webhookDeliveries.has(key)) throw new Error("duplicate-webhook-delivery");
    this.webhookDeliveries.add(key);
  }

  revokeDevice(deviceId: string): void {
    this.revokedDevices.add(requireNonEmptyString(deviceId, "device.deviceId"));
  }

  buildQueueMessage(input: { kind: string; id: string; accountId?: string }) {
    return projectCloudPrivacySurface("queue", input) as { kind: string; id: string; accountId?: string };
  }

  listNotificationProviders(scope: { accountId?: string; installationId?: number } = {}): NotificationProviderConfig[] {
    if (this.notificationProviders.size === 0) {
      for (const config of defaultNotificationProviderConfigs()) this.notificationProviders.set(config.id, config);
    }
    return [...this.notificationProviders.values()]
      .filter((config) => {
        const owner = this.notificationProviderScopes.get(config.id);
        if (!owner || (!scope.accountId && !scope.installationId)) return true;
        if (scope.accountId && owner.accountId === scope.accountId) return true;
        if (scope.installationId && owner.installationId === scope.installationId) return true;
        return false;
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  setNotificationProvider(config: NotificationProviderConfig, scope: { accountId?: string; installationId?: number } = {}): NotificationProviderConfig {
    if (config.enabled && config.provider !== "github-check" && !config.secretRef) {
      throw new Error("notification-provider-secret-ref-required");
    }
    this.notificationProviders.set(config.id, config);
    this.notificationProviderScopes.set(config.id, scope);
    return config;
  }

  enqueueNotification(event: NotificationEvent): { queued: boolean; queueMessage: { kind: string; id: string }; payloadDigest: string } {
    assertNotificationEventMinimal(event as unknown as Record<string, unknown>);
    const payload = serializeNotificationEvent(event);
    const audit = auditNotificationPayload(payload);
    if (!audit.ok) throw new Error(`notification-payload-invalid: ${audit.findings.join(", ")}`);
    this.notificationQueue.push(payload);
    return {
      queued: true,
      queueMessage: this.buildQueueMessage({ kind: "notification.event", id: event.eventId }),
      payloadDigest: digestJson(payload as any)
    };
  }

  buildChatGptDirectoryListing() {
    return {
      name: "ArchContext",
      slug: "archcontext",
      description: "Architecture runtime for coding agents.",
      permissions: ["account:read", "billing:read", "installations:read", "device_sessions:revoke"],
      repositoryContent: "local-runtime-only",
      privacyUrl: "https://archctx.repoharness.com/privacy",
      installUrl: "https://archctx.repoharness.com/chatgpt/install"
    };
  }

  appReviewChecklist() {
    return {
      oauth: "OAuth 2.1 + PKCE",
      dataUse: "Remote MCP metadata only; local runtime handles private repository context.",
      writes: "disabled-by-default-local-confirmation-required",
      rollback: "versioned-cloud-metadata-release"
    };
  }

  rollbackChatGptRelease(version: string): { rolledBack: boolean; version: string } {
    this.releaseRollbacks.push(version);
    return { rolledBack: true, version };
  }

  redactLog(value: string): string {
    return value.replace(/(access|refresh|secret|token)_[a-zA-Z0-9_-]+/g, "[REDACTED]");
  }

  projectLogRecord(input: Record<string, unknown>): Record<string, string | number | boolean> {
    return projectCloudPrivacySurface("log", input);
  }

  projectTraceRecord(input: Record<string, unknown>): Record<string, string | number | boolean> {
    return projectCloudPrivacySurface("trace", input);
  }

  projectQueuePayload(input: Record<string, unknown>): Record<string, string | number | boolean> {
    return projectCloudPrivacySurface("queue", input);
  }

  projectErrorObject(error: unknown, context: Record<string, unknown> = {}): Record<string, string | number | boolean> {
    const errorCode = typeof context.errorCode === "string"
      ? context.errorCode
      : error instanceof Error
        ? error.name
        : "UNKNOWN_ERROR";
    return projectCloudPrivacySurface("error", { ...context, errorCode });
  }

  retentionCutoff(now: string, days = 90): string {
    return new Date(Date.parse(now) - days * 24 * 60 * 60 * 1000).toISOString();
  }

  costAlert(input: { monthlyRevenueUsd: number; projectedCostUsd: number }) {
    return { alert: input.projectedCostUsd > input.monthlyRevenueUsd * 0.1 };
  }

  exportAccount(accountId: string) {
    return {
      account: this.accounts.get(accountId),
      revokedDevices: [...this.revokedDevices],
      deliveries: [...this.webhookDeliveries].filter((delivery) => delivery.includes(accountId) || !delivery.includes(":"))
    };
  }

  deleteAccount(accountId: string): void {
    this.accounts.delete(accountId);
    for (const [providerId, scope] of [...this.notificationProviderScopes.entries()]) {
      if (scope.accountId === accountId) {
        this.notificationProviderScopes.delete(providerId);
        this.notificationProviders.delete(providerId);
      }
    }
  }
}

export function routeDigest(): string {
  return digestJson([...CONTROL_PLANE_ROUTES]);
}

export function projectCloudPrivacySurface(surface: CloudPrivacySurface, input: Record<string, unknown>): Record<string, string | number | boolean> {
  const allowed = CLOUD_PRIVACY_ALLOWED_FIELDS[surface];
  const projected: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (isForbiddenPrivateContentKey(key) || containsPrivateContent(value)) continue;
    if (key === "headSha" && (surface === "log" || surface === "trace")) {
      if (typeof value === "string" && value.length >= 12) projected.headShaPrefix = value.slice(0, 12);
      continue;
    }
    if (!allowed.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") projected[key] = value;
  }
  return projected;
}

export function assertNoUploadRoutes(routes: readonly string[] = CONTROL_PLANE_ROUTES): void {
  const forbidden = /(upload|index|detail|embedding|blob|proxy)/i;
  for (const route of routes) {
    if (forbidden.test(route)) throw new Error(`Forbidden route: ${route}`);
  }
}

function isForbiddenPrivateContentKey(key: string): boolean {
  return FORBIDDEN_PRIVATE_CONTENT_KEYS.has(key.toLowerCase());
}

function containsPrivateContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((child) => containsPrivateContent(child));
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([key, child]) => isForbiddenPrivateContentKey(key) || containsPrivateContent(child));
  }
  if (typeof value !== "string") return false;
  return PRIVATE_CONTENT_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function requireFiniteTime(value: string, field: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${field}-invalid`);
  return time;
}

function requireNonEmptyString(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field}-required`);
  return value.trim();
}
