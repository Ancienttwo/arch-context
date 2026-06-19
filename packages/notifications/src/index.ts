import { createHmac } from "node:crypto";
import {
  digestJson,
  type Json,
  type NotificationDeliveryResult,
  type NotificationEvent,
  type NotificationProviderConfig,
  type NotificationPublisher
} from "../../contracts/src/index";

export const NOTIFICATION_EVENT_FIELDS = [
  "schemaVersion",
  "eventId",
  "prUrl",
  "result",
  "riskLevel",
  "commitSha",
  "runtimeVersion",
  "occurredAt"
] as const;

export const FORBIDDEN_NOTIFICATION_FIELDS = ["code", "diff", "finding", "findings", "architectureBody", "modelBody", "reviewDetail"] as const;

export interface NotificationTransportResponse {
  statusCode: number;
  body?: string;
}

export interface NotificationTransportRequest {
  provider: NotificationProviderConfig;
  payload: Record<(typeof NOTIFICATION_EVENT_FIELDS)[number], string>;
  signature?: string;
}

export interface NotificationTransport {
  send(request: NotificationTransportRequest): Promise<NotificationTransportResponse>;
}

export class MemoryNotificationTransport implements NotificationTransport {
  readonly deliveries: NotificationTransportRequest[] = [];

  constructor(private failRemaining = 0) {}

  async send(request: NotificationTransportRequest): Promise<NotificationTransportResponse> {
    if (this.failRemaining > 0) {
      this.failRemaining -= 1;
      throw new Error("transport-failed");
    }
    this.deliveries.push(request);
    return { statusCode: 202 };
  }
}

export class NotificationPublisherService implements NotificationPublisher {
  readonly deadLetters: { providerId: string; eventId: string; reason: string }[] = [];
  private readonly delivered = new Set<string>();

  constructor(
    private readonly configs: NotificationProviderConfig[] = defaultNotificationProviderConfigs(),
    private readonly transports: Partial<Record<NotificationProviderConfig["provider"], NotificationTransport>> = {}
  ) {}

  async publish(event: NotificationEvent): Promise<NotificationDeliveryResult[]> {
    assertNotificationEventMinimal(event as unknown as Record<string, unknown>);
    const payload = serializeNotificationEvent(event);
    const enabled = this.configs.filter((config) => config.enabled);
    const results: NotificationDeliveryResult[] = [];
    for (const config of enabled) {
      validateProviderConfig(config);
      results.push(await this.deliver(config, event, payload));
    }
    return results;
  }

  private async deliver(
    config: NotificationProviderConfig,
    event: NotificationEvent,
    payload: Record<(typeof NOTIFICATION_EVENT_FIELDS)[number], string>
  ): Promise<NotificationDeliveryResult> {
    const idempotencyKey = digestJson({ providerId: config.id, eventId: event.eventId, commitSha: event.commitSha } as unknown as Json);
    if (this.delivered.has(idempotencyKey)) {
      return { providerId: config.id, delivered: true, idempotencyKey, attempt: 0, reason: "duplicate-suppressed" };
    }
    const transport = this.transports[config.provider] ?? new MemoryNotificationTransport();
    const maxAttempts = config.retry.maxAttempts;
    let lastError = "not-attempted";
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await transport.send({
          provider: config,
          payload,
          signature: config.provider === "webhook" ? signWebhookPayload(payload, config.secretRef ?? "secret://missing") : undefined
        });
        this.delivered.add(idempotencyKey);
        return { providerId: config.id, delivered: true, idempotencyKey, attempt, statusCode: response.statusCode };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    this.deadLetters.push({ providerId: config.id, eventId: event.eventId, reason: lastError });
    return { providerId: config.id, delivered: false, idempotencyKey, attempt: maxAttempts, deadLettered: true, reason: lastError };
  }
}

export function defaultNotificationProviderConfigs(): NotificationProviderConfig[] {
  return [
    {
      schemaVersion: "archcontext.notification-provider/v1",
      id: "notification-provider.github-check",
      provider: "github-check",
      enabled: true,
      target: "github-check://default",
      retry: { maxAttempts: 3, backoffSeconds: 30 }
    },
    disabledProvider("notification-provider.slack", "slack", "slack://disabled"),
    disabledProvider("notification-provider.webhook", "webhook", "webhook://disabled"),
    disabledProvider("notification-provider.email", "email", "email://disabled")
  ];
}

export function createNotificationPublisher(input: {
  configs?: NotificationProviderConfig[];
  transports?: Partial<Record<NotificationProviderConfig["provider"], NotificationTransport>>;
} = {}): NotificationPublisherService {
  return new NotificationPublisherService(input.configs ?? defaultNotificationProviderConfigs(), input.transports ?? {});
}

export function serializeNotificationEvent(event: NotificationEvent): Record<(typeof NOTIFICATION_EVENT_FIELDS)[number], string> {
  return Object.fromEntries(NOTIFICATION_EVENT_FIELDS.map((field) => [field, String(event[field])])) as Record<
    (typeof NOTIFICATION_EVENT_FIELDS)[number],
    string
  >;
}

export function assertNotificationEventMinimal(event: Record<string, unknown>): void {
  const allowed = new Set<string>(NOTIFICATION_EVENT_FIELDS);
  for (const key of Object.keys(event)) {
    if (!allowed.has(key)) throw new Error(`NotificationEvent contains non-minimal field: ${key}`);
  }
  for (const forbidden of FORBIDDEN_NOTIFICATION_FIELDS) {
    if (forbidden in event) throw new Error(`NotificationEvent contains forbidden private content field: ${forbidden}`);
  }
}

export function validateProviderConfig(config: NotificationProviderConfig): void {
  if (config.provider === "email" && config.enabled && !config.unsubscribeUrl) {
    throw new Error("email-provider-requires-unsubscribe");
  }
  if (["slack", "webhook"].includes(config.provider) && config.enabled && !config.secretRef) {
    throw new Error(`${config.provider}-provider-requires-secret-ref`);
  }
}

export function signWebhookPayload(payload: Json, secretRef: string): string {
  return `sha256=${createHmac("sha256", secretRef).update(JSON.stringify(payload)).digest("hex")}`;
}

export function auditNotificationPayload(payload: Record<string, unknown>): { ok: boolean; findings: string[] } {
  const findings = Object.keys(payload)
    .filter((key) => !NOTIFICATION_EVENT_FIELDS.includes(key as any) || FORBIDDEN_NOTIFICATION_FIELDS.includes(key as any))
    .map((key) => `forbidden notification field: ${key}`);
  return { ok: findings.length === 0, findings };
}

function disabledProvider(
  id: string,
  provider: NotificationProviderConfig["provider"],
  target: string
): NotificationProviderConfig {
  return {
    schemaVersion: "archcontext.notification-provider/v1",
    id,
    provider,
    enabled: false,
    target,
    retry: { maxAttempts: 3, backoffSeconds: 30 }
  };
}
