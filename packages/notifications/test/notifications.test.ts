import { describe, expect, test } from "bun:test";
import {
  auditNotificationPayload,
  createNotificationPublisher,
  defaultNotificationProviderConfigs,
  MemoryNotificationTransport,
  serializeNotificationEvent,
  signWebhookPayload
} from "../src/index";
import type { NotificationEvent, NotificationProviderConfig } from "../../contracts/src/index";

const event: NotificationEvent = {
  schemaVersion: "archcontext.notification-event/v1",
  eventId: "notification.review-complete",
  prUrl: "https://github.com/ancienttwo/arch-context/pull/12",
  result: "pass_with_warnings",
  riskLevel: "medium",
  commitSha: "abc1234",
  runtimeVersion: "archctx/1.1.0",
  occurredAt: "2026-06-19T00:00:00Z"
};

describe("@archcontext/notifications", () => {
  test("default provider remains GitHub Check and optional providers are opt-in", () => {
    const configs = defaultNotificationProviderConfigs();
    expect(configs.filter((config) => config.enabled).map((config) => config.provider)).toEqual(["github-check"]);
    expect(configs.find((config) => config.provider === "slack")?.enabled).toBe(false);
    expect(configs.find((config) => config.provider === "webhook")?.enabled).toBe(false);
    expect(configs.find((config) => config.provider === "email")?.enabled).toBe(false);
  });

  test("serializes only Check-level notification fields", async () => {
    const transport = new MemoryNotificationTransport();
    const publisher = createNotificationPublisher({ transports: { "github-check": transport } });
    const result = await publisher.publish(event);
    expect(result[0]).toMatchObject({ delivered: true, providerId: "notification-provider.github-check" });
    expect(Object.keys(transport.deliveries[0].payload).sort()).toEqual([
      "commitSha",
      "eventId",
      "occurredAt",
      "prUrl",
      "result",
      "riskLevel",
      "runtimeVersion",
      "schemaVersion"
    ]);
    expect(auditNotificationPayload(transport.deliveries[0].payload).ok).toBe(true);
    await expect(publisher.publish({ ...(event as any), findings: [{ message: "private" }] })).rejects.toThrow("non-minimal");
  });

  test("Slack, webhook, and email providers send minimal payloads", async () => {
    const configs: NotificationProviderConfig[] = [
      { schemaVersion: "archcontext.notification-provider/v1", id: "notification-provider.slack", provider: "slack", enabled: true, target: "https://hooks.slack.example", secretRef: "secret://slack", retry: { maxAttempts: 2, backoffSeconds: 1 } },
      { schemaVersion: "archcontext.notification-provider/v1", id: "notification-provider.webhook", provider: "webhook", enabled: true, target: "https://notify.example", secretRef: "secret://webhook", retry: { maxAttempts: 2, backoffSeconds: 1 } },
      { schemaVersion: "archcontext.notification-provider/v1", id: "notification-provider.email", provider: "email", enabled: true, target: "dev@example.com", unsubscribeUrl: "https://archcontext.dev/unsubscribe", retry: { maxAttempts: 2, backoffSeconds: 1 } }
    ];
    const slack = new MemoryNotificationTransport();
    const webhook = new MemoryNotificationTransport();
    const email = new MemoryNotificationTransport();
    const publisher = createNotificationPublisher({ configs, transports: { slack, webhook, email } });
    expect((await publisher.publish(event)).every((item) => item.delivered)).toBe(true);
    for (const transport of [slack, webhook, email]) {
      expect(JSON.stringify(transport.deliveries[0].payload)).not.toContain("private");
      expect(auditNotificationPayload(transport.deliveries[0].payload).ok).toBe(true);
    }
    expect(webhook.deliveries[0].signature).toMatch(/^sha256=/);
    expect(() => signWebhookPayload(serializeNotificationEvent(event), "secret://webhook")).not.toThrow();
  });

  test("retry, dead letter, and idempotency are enforced", async () => {
    const configs: NotificationProviderConfig[] = [
      { schemaVersion: "archcontext.notification-provider/v1", id: "notification-provider.webhook", provider: "webhook", enabled: true, target: "https://notify.example", secretRef: "secret://webhook", retry: { maxAttempts: 2, backoffSeconds: 1 } }
    ];
    const failing = new MemoryNotificationTransport(2);
    const publisher = createNotificationPublisher({ configs, transports: { webhook: failing } });
    const failed = await publisher.publish(event);
    expect(failed[0]).toMatchObject({ delivered: false, deadLettered: true, attempt: 2 });
    expect(publisher.deadLetters).toHaveLength(1);

    const working = new MemoryNotificationTransport();
    const second = createNotificationPublisher({ configs, transports: { webhook: working } });
    const delivered = await second.publish(event);
    expect(delivered[0].delivered).toBe(true);
    const duplicate = await second.publish(event);
    expect(duplicate[0]).toMatchObject({ delivered: true, attempt: 0, reason: "duplicate-suppressed" });
    expect(working.deliveries).toHaveLength(1);
  });
});
