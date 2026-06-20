import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { d1MigrationSql } from "@archcontext/cloud/cloud-db";
import { GitHubAppState, projectVerifiedGitHubWebhook } from "@archcontext/cloud/github-app";

const SECRET = "github-webhook-secret";

describe("GitHub webhook security integration", () => {
  test("rejects every invalid signature before webhook projection", () => {
    const rawBody = pullRequestBody("abc123");
    const compactSignature = sign(rawBody);
    const invalidInputs = [
      { label: "wrong secret", rawBody, signature256: sign(rawBody, "wrong-secret") },
      { label: "reparsed body", rawBody: JSON.stringify(JSON.parse(rawBody), null, 2), signature256: compactSignature },
      { label: "legacy prefix", rawBody, signature256: compactSignature.replace("sha256=", "sha1=") },
      { label: "malformed hex", rawBody, signature256: "sha256=bad" }
    ];

    expect(invalidInputs.length).toBeGreaterThan(0);
    for (const input of invalidInputs) {
      expect(() => projectVerifiedGitHubWebhook({
        secret: SECRET,
        rawBody: input.rawBody,
        signature256: input.signature256,
        deliveryId: `invalid-${input.label}`,
        eventName: "pull_request"
      })).toThrow("github-webhook-signature-invalid");
    }
  });

  test("rejects stale delivery replay before new challenge or check side effects", () => {
    const state = new GitHubAppState();
    state.install(["ancienttwo/arch-context"]);

    const first = projectVerifiedGitHubWebhook({
      secret: SECRET,
      rawBody: pullRequestBody("abc123"),
      signature256: sign(pullRequestBody("abc123")),
      deliveryId: "delivery-old",
      eventName: "pull_request"
    });
    if (first.eventName !== "pull_request") throw new Error("expected pull_request projection");
    const accepted = state.handlePullRequest(first.event, "2026-06-20T00:00:00Z");

    expect(accepted.delivery.action).toBe("process");
    expect(accepted.replayRejected).toBe(false);
    expect(state.challenges.size).toBe(1);
    expect(state.checks.size).toBe(1);
    expect(accepted.checkRun?.headSha).toBe("abc123");

    const replayBody = pullRequestBody("def456");
    const replay = projectVerifiedGitHubWebhook({
      secret: SECRET,
      rawBody: replayBody,
      signature256: sign(replayBody),
      deliveryId: "delivery-old",
      eventName: "pull_request"
    });
    if (replay.eventName !== "pull_request") throw new Error("expected pull_request projection");
    const rejected = state.handlePullRequest(replay.event, "2026-06-20T00:10:00Z");

    expect(rejected.replayRejected).toBe(true);
    expect(rejected.delivery.action).toBe("ignore-duplicate");
    expect(state.challenges.size).toBe(1);
    expect(state.checks.size).toBe(1);
    expect([...state.checks.values()][0]?.headSha).toBe("abc123");
  });

  test("persists delivery idempotency at the D1 schema boundary without raw bodies", () => {
    const sql = d1MigrationSql();

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS webhook_deliveries");
    expect(sql).toContain("provider TEXT NOT NULL");
    expect(sql).toContain("delivery_id TEXT NOT NULL");
    expect(sql).toContain("PRIMARY KEY(provider, delivery_id)");
    expect(sql).not.toContain("raw_body");
  });
});

function pullRequestBody(headSha: string): string {
  return JSON.stringify({
    action: "opened",
    number: 1,
    pull_request: {
      number: 1,
      title: "ignored by projection",
      body: "ignored by projection",
      head: {
        sha: headSha,
        ref: "ignored-branch-name"
      }
    },
    repository: {
      name: "arch-context",
      private: true,
      owner: {
        login: "ancienttwo"
      }
    }
  });
}

function sign(rawBody: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}
