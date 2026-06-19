import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { GITHUB_APP_PERMISSIONS, GitHubAppState, verifyGitHubWebhookSignature } from "../src/index";

describe("GitHub App", () => {
  test("uses no Contents permission and handles PR challenge/check lifecycle", () => {
    expect(GITHUB_APP_PERMISSIONS.contents).toBe("none");
    const state = new GitHubAppState();
    state.install(["ancienttwo/arch-context"]);
    expect(state.selectedRepositories.has("ancienttwo/arch-context")).toBe(true);
    const first = state.handlePullRequest({
      deliveryId: "d1",
      action: "opened",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 1, headSha: "abc123" }
    });
    expect(first.checkRun?.status).toBe("queued");
    expect(state.handlePullRequest({ deliveryId: "d1", action: "opened", repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" }, pullRequest: { number: 1, headSha: "abc123" } }).idempotent).toBe(true);
    const second = state.handlePullRequest({
      deliveryId: "d2",
      action: "synchronize",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 1, headSha: "def456" }
    });
    expect(second.checkRun?.status).toBe("queued");
    expect(state.checks.get(first.checkRun!.id)?.conclusion).toBe("neutral");
  });

  test("validates webhook signature", () => {
    const body = JSON.stringify({ ok: true });
    const signature256 = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(verifyGitHubWebhookSignature({ secret: "secret", body, signature256 })).toBe(true);
    expect(verifyGitHubWebhookSignature({ secret: "secret", body, signature256: "sha256=bad" })).toBe(false);
  });
});
