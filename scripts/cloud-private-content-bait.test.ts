import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ControlPlane, projectCloudPrivacySurface } from "@archcontext/cloud/control-plane";
import { assertNotificationEventMinimal, auditNotificationPayload, serializeNotificationEvent } from "@archcontext/cloud/notifications";
import { validateJsonSchema, type Json } from "@archcontext/contracts";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("cloud private content bait", () => {
  test("cannot enter Cloud DTO, queue, log, trace, or error surfaces", () => {
    const bait = readJson("docs/security/fixtures/cloud-private-content-bait.json") as { payload: Record<string, string> };
    const baitPayload = bait.payload;
    const baitNeedles = Object.values(baitPayload);
    const cp = new ControlPlane();

    const commonTelemetry = {
      requestId: "req_bait",
      routeId: "github.webhook",
      installationId: 123,
      repositoryId: 987,
      pullRequestNumber: 42,
      headSha: "abcdef1234567890",
      status: "rejected",
      reasonCode: "PAYLOAD_PRIVACY_VIOLATION",
      latencyMs: 9,
      attempt: 1,
      runtimeVersion: "archctx/1.1.0",
      ...baitPayload
    };
    const log = projectCloudPrivacySurface("log", commonTelemetry);
    const trace = projectCloudPrivacySurface("trace", { ...commonTelemetry, spanId: "span_bait" });
    const queue = cp.buildQueueMessage({ kind: "notification.event", id: "evt_bait", accountId: "acct_bait", ...baitPayload } as any);
    const error = cp.projectErrorObject(new Error("bait should not be retained"), { errorCode: "PAYLOAD_PRIVACY_VIOLATION", requestId: "req_bait", ...baitPayload });

    for (const projected of [log, trace, queue, error]) {
      assertNoBait(projected, baitNeedles);
      for (const key of Object.keys(baitPayload)) expect(projected).not.toHaveProperty(key);
    }
    expect(log).toHaveProperty("headShaPrefix", "abcdef123456");
    expect(JSON.stringify(log)).not.toContain("abcdef1234567890");

    const notificationSchema = readJson("schemas/runtime/notification-event.schema.json");
    const notification = readJson("packages/contracts/fixtures/valid/notification-event.json") as Record<string, Json>;
    expect(validateJsonSchema(notificationSchema as any, { ...notification, ...baitPayload }).valid).toBe(false);
    expect(() => assertNotificationEventMinimal({ ...notification, ...baitPayload })).toThrow("non-minimal");
    const notificationPayload = serializeNotificationEvent(notification as any);
    const notificationAudit = auditNotificationPayload({ ...notificationPayload, ...baitPayload });
    expect(notificationAudit.ok).toBe(false);

    const egressSchema = readJson("schemas/cloud/cloud-egress-envelope.schema.json");
    const egress = readJson("packages/contracts/fixtures/valid/cloud-egress-envelope.json") as Record<string, Json>;
    expect(validateJsonSchema(egressSchema as any, { ...egress, ...baitPayload }).valid).toBe(false);
  });
});

function readJson(path: string): Json {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function assertNoBait(value: unknown, baitNeedles: string[]): void {
  const serialized = JSON.stringify(value);
  for (const needle of baitNeedles) expect(serialized).not.toContain(needle);
}
