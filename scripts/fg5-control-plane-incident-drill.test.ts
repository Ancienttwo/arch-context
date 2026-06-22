import { describe, expect, test } from "bun:test";
import { inspectFg5IncidentDrill } from "./fg5-control-plane-incident-drill";

describe("fg5 control-plane incident drill evidence", () => {
  test("accepts verified metadata-only incident drill evidence", () => {
    expect(inspectFg5IncidentDrill(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects missing incident rows and secret markers", () => {
    const recording = verifiedRecording();
    recording.evidence.dashboard.rows = recording.evidence.dashboard.rows.filter((row) => row.failureClass !== "github-api");
    recording.privacy.privateContentHits = 1;
    (recording.config as Record<string, unknown>).note = "Bearer ghs_private_token";

    const result = inspectFg5IncidentDrill(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("dashboard row missing: github-api");
    expect(result.failures).toContain("privacy.privateContentHits must be 0");
    expect(result.failures.some((failure) => failure.includes("forbidden secret marker"))).toBe(true);
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg5-control-plane-incident-drill/v1",
    environment: "staging-drill",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T03:00:00.000Z",
    config: {
      output: "docs/verification/fg5-control-plane-incident-drill.json",
      now: "2026-06-21T18:00:00.000Z"
    },
    evidence: {
      alertKinds: ["webhook-backlog", "verify-failure", "check-dlq", "github-api-failure"],
      alerts: [
        alert("webhook-backlog", "webhook", { pendingCount: 24, oldestAgeMs: 600000 }),
        alert("verify-failure", "verify", { failureCount: 3, thresholdCount: 1 }),
        alert("check-dlq", "queue", { deadLetterCount: 1, oldestLagMs: 600000 }),
        alert("github-api-failure", "github-api", { failureCount: 4, statusCode: 503, retryable: 1 })
      ],
      dashboard: {
        schemaVersion: "archcontext.control-plane-incident-dashboard/v1",
        rows: [
          row("webhook", "webhook-backlog", "webhook", ["oldestAgeMs", "pendingCount"]),
          row("verify", "verify-failure", "verify", ["failureCount", "thresholdCount"]),
          row("queue", "check-dlq", "queue", ["deadLetterCount", "oldestLagMs"]),
          row("github-api", "github-api-failure", "github-api", ["failureCount", "statusCode"])
        ]
      }
    },
    privacy: {
      privateContentHits: 0,
      secretMarkerHits: 0,
      codeContentMarkerHits: 0
    },
    failures: []
  };
}

function alert(kind: string, surface: string, metrics: Record<string, number>) {
  return {
    schemaVersion: "archcontext.control-plane-alert/v1",
    alertId: `alert_${kind.replace(/-/g, "_")}`,
    kind,
    severity: "critical",
    status: "firing",
    firedAt: "2026-06-21T18:00:00.000Z",
    summary: `${kind} incident`,
    labels: { kind, surface, status: "failed" },
    metrics,
    runbook: {
      path: "docs/runbooks/control-plane-incidents.md",
      section: kind
    },
    metadataDigest: `sha256:${"a".repeat(64)}`
  };
}

function row(failureClass: string, alertKind: string, surface: string, metricKeys: string[]) {
  return {
    failureClass,
    alertKind,
    severity: "critical",
    surface,
    status: "failed",
    runbookPath: "docs/runbooks/control-plane-incidents.md",
    runbookSection: alertKind,
    metricKeys
  };
}
