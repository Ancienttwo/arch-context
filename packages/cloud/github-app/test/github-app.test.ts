import { describe, expect, test } from "bun:test";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { createReviewChallenge, signLocalAttestation, signOrganizationAttestation } from "@archcontext/cloud/attestation";
import { DEVELOPER_REVIEW_CHECK_NAME, GITHUB_APP_PERMISSION_MANIFEST, ORGANIZATION_RUNNER_CHECK_NAME, type CloudEgressEnvelope } from "@archcontext/contracts";
import {
  GITHUB_APP_PERMISSIONS,
  GITHUB_CHECK_CREATE_PATH_TEMPLATE,
  GITHUB_CHECK_UPDATE_PATH_TEMPLATE,
  GITHUB_PULL_HEAD_METADATA_PATH_TEMPLATE,
  GitHubAppState,
  GitHubGovernanceRestPort,
  InMemoryWebhookDeliveryLedger,
  RecordingGitHubGovernanceApiTransport,
  assertGitHubGovernanceApiRequestAllowed,
  identifyForbiddenGitHubGovernanceAcceptHeader,
  identifyForbiddenGitHubGovernanceApiEndpoint,
  projectVerifiedGitHubWebhook,
  verifyGitHubWebhookSignature,
  type GitHubGovernanceApiRequest
} from "../src/index";

describe("GitHub App", () => {
  test("uses no Contents permission and handles PR challenge/check lifecycle", () => {
    expect(GITHUB_APP_PERMISSIONS).toBe(GITHUB_APP_PERMISSION_MANIFEST.repositoryPermissions);
    expect(GITHUB_APP_PERMISSIONS).toEqual({
      metadata: "read",
      pull_requests: "read",
      checks: "write",
      contents: "none"
    });
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
    expect(first.checkRun?.name).toBe(DEVELOPER_REVIEW_CHECK_NAME);
    expect(first.delivery.action).toBe("process");
    const duplicate = state.handlePullRequest({ deliveryId: "d1", action: "opened", repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" }, pullRequest: { number: 1, headSha: "abc123" } });
    expect(duplicate.idempotent).toBe(true);
    expect(duplicate.replayRejected).toBe(true);
    expect(duplicate.delivery.action).toBe("ignore-duplicate");
    expect(state.checks.size).toBe(1);
    expect(state.challenges.size).toBe(1);
    const second = state.handlePullRequest({
      deliveryId: "d2",
      action: "synchronize",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 1, headSha: "def456" }
    });
    expect(second.checkRun?.status).toBe("queued");
    expect(state.checks.get(first.checkRun!.id)?.conclusion).toBe("neutral");
  });

  test("rerequest creates a fresh challenge without reusing the prior nonce", () => {
    const state = new GitHubAppState();
    state.install(["ancienttwo/arch-context"]);
    const first = state.handlePullRequest({
      deliveryId: "d1",
      action: "opened",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 1, headSha: "abc123" }
    }, "2026-06-19T00:00:00Z");
    const retry = state.handleCheckRunRerequest({
      deliveryId: "d-rerun",
      action: "rerequested",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 1 },
      checkRun: { id: first.checkRun!.id, name: first.checkRun!.name, headSha: "abc123" }
    }, "2026-06-19T00:02:00Z");

    expect(retry.idempotent).toBe(false);
    expect(retry.checkRun).toMatchObject({ id: first.checkRun!.id, status: "queued", headSha: "abc123" });
    expect(retry.challenge?.nonce).not.toBe(first.challenge?.nonce);
    expect(state.challenges.size).toBe(2);

    const replay = state.handleCheckRunRerequest({
      deliveryId: "d-rerun",
      action: "rerequested",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 1 },
      checkRun: { id: first.checkRun!.id, name: first.checkRun!.name, headSha: "abc123" }
    }, "2026-06-19T00:03:00Z");
    expect(replay.replayRejected).toBe(true);
    expect(state.challenges.size).toBe(2);
  });

  test("getPullHeadMetadata uses typed GitHub pull endpoint and projects head metadata only", async () => {
    const requests: GitHubGovernanceApiRequest[] = [];
    const port = new GitHubGovernanceRestPort({
      async request(input) {
        requests.push(input);
        return {
          statusCode: 200,
          requestId: "req_1",
          body: {
            title: "not retained",
            body: "private-note",
            changed_files: 3,
            head: { sha: "head123", ref: "feature/private" },
            base: { sha: "base456", ref: "main" }
          }
        };
      }
    });

    const result = await port.getPullHeadMetadata({ installationId: 123, repositoryId: 987, pullRequestNumber: 42 });

    expect(requests).toEqual([{
      category: "github.pull-head",
      installationId: 123,
      repositoryId: 987,
      pullRequestNumber: 42,
      method: "GET",
      pathTemplate: GITHUB_PULL_HEAD_METADATA_PATH_TEMPLATE,
      path: "/repositories/987/pulls/42",
      accept: "application/vnd.github+json"
    }]);
    expect(result).toEqual({
      installationId: 123,
      repositoryId: 987,
      pullRequestNumber: 42,
      headSha: "head123",
      baseSha: "base456"
    });
    const serialized = JSON.stringify(result);
    for (const rejected of ["private-note", "changed_files", "feature/private", "main"]) {
      expect(serialized).not.toContain(rejected);
    }
  });

  test("getPullHeadMetadata rejects failed and malformed GitHub responses", async () => {
    const failed = new GitHubGovernanceRestPort({
      async request() {
        return { statusCode: 404, body: { message: "not found" } };
      }
    });
    await expect(failed.getPullHeadMetadata({ installationId: 123, repositoryId: 987, pullRequestNumber: 42 })).rejects.toThrow("github-pull-head-metadata-fetch-failed");

    const malformed = new GitHubGovernanceRestPort({
      async request() {
        return { statusCode: 200, body: { head: {}, base: { sha: "base456" } } };
      }
    });
    await expect(malformed.getPullHeadMetadata({ installationId: 123, repositoryId: 987, pullRequestNumber: 42 })).rejects.toThrow("github-governance-response-invalid");
  });

  test("recording transport captures only GitHub egress metadata", async () => {
    const envelopes: CloudEgressEnvelope[] = [];
    const monotonicReadings = [1000, 1017];
    const port = new GitHubGovernanceRestPort(new RecordingGitHubGovernanceApiTransport({
      transport: {
        async request() {
          return {
            statusCode: 200,
            requestId: "req_egress_1",
            body: {
              title: "not retained",
              body: "private-note",
              changed_files: 3,
              head: { sha: "head123", ref: "feature/private" },
              base: { sha: "base456", ref: "main" }
            }
          };
        }
      },
      recorder: {
        record(envelope) {
          envelopes.push(envelope);
        }
      },
      now: () => "2026-06-20T13:50:00Z",
      monotonicNowMs: () => monotonicReadings.shift() ?? 1017
    }));

    await port.getPullHeadMetadata({ installationId: 123, repositoryId: 987, pullRequestNumber: 42 });

    expect(envelopes).toEqual([{
      schemaVersion: "archcontext.cloud-egress/v1",
      requestId: "req_egress_1",
      category: "github.pull-head",
      method: "GET",
      host: "api.github.com",
      pathTemplate: GITHUB_PULL_HEAD_METADATA_PATH_TEMPLATE,
      statusCode: 200,
      latencyMs: 17,
      recordedAt: "2026-06-20T13:50:00Z"
    }]);
    expect(Object.keys(envelopes[0]).sort()).toEqual([
      "category",
      "host",
      "latencyMs",
      "method",
      "pathTemplate",
      "recordedAt",
      "requestId",
      "schemaVersion",
      "statusCode"
    ].sort());
    const serialized = JSON.stringify(envelopes[0]);
    for (const rejected of ["/repositories/987", "private-note", "feature/private", "head123", "base456", "installationId", "repositoryId", "pullRequestNumber", "changed_files"]) {
      expect(serialized).not.toContain(rejected);
    }
  });

  test("createCheckRun sends only the minimum GitHub Check create DTO", async () => {
    const requests: GitHubGovernanceApiRequest[] = [];
    const port = new GitHubGovernanceRestPort({
      async request(input) {
        requests.push(input);
        return { statusCode: 201, body: { id: 456, html_url: "https://github.example/checks/456", output: { summary: "not returned" } } };
      }
    });

    const result = await port.createCheckRun({
      installationId: 123,
      repositoryId: 987,
      pullRequestNumber: 42,
      headSha: "abc123",
      name: DEVELOPER_REVIEW_CHECK_NAME,
      status: "queued"
    });

    expect(result).toEqual({ checkRunId: "456", htmlUrl: "https://github.example/checks/456" });
    expect(requests).toEqual([{
      category: "github.check-create",
      installationId: 123,
      repositoryId: 987,
      method: "POST",
      pathTemplate: GITHUB_CHECK_CREATE_PATH_TEMPLATE,
      path: "/repositories/987/check-runs",
      accept: "application/vnd.github+json",
      body: {
        name: DEVELOPER_REVIEW_CHECK_NAME,
        head_sha: "abc123",
        status: "queued"
      }
    }]);
    const body = JSON.stringify((requests[0] as Extract<GitHubGovernanceApiRequest, { category: "github.check-create" }>).body);
    for (const rejected of ["pullRequestNumber", "private-note", "output", "summary"]) {
      expect(body).not.toContain(rejected);
    }
  });

  test("updateCheckRun sends only the minimum GitHub Check update DTO", async () => {
    const requests: GitHubGovernanceApiRequest[] = [];
    const port = new GitHubGovernanceRestPort({
      async request(input) {
        requests.push(input);
        return { statusCode: 200, body: {} };
      }
    });

    await port.updateCheckRun({
      installationId: 123,
      repositoryId: 987,
      checkRunId: "check/42",
      name: ORGANIZATION_RUNNER_CHECK_NAME,
      status: "completed",
      conclusion: "neutral",
      output: {
        title: "Attestation required",
        summary: "Minimal check summary"
      }
    });

    expect(requests).toEqual([{
      category: "github.check-update",
      installationId: 123,
      repositoryId: 987,
      checkRunId: "check/42",
      method: "PATCH",
      pathTemplate: GITHUB_CHECK_UPDATE_PATH_TEMPLATE,
      path: "/repositories/987/check-runs/check%2F42",
      accept: "application/vnd.github+json",
      body: {
        name: ORGANIZATION_RUNNER_CHECK_NAME,
        status: "completed",
        conclusion: "neutral",
        output: {
          title: "Attestation required",
          summary: "Minimal check summary"
        }
      }
    }]);
    const body = JSON.stringify((requests[0] as Extract<GitHubGovernanceApiRequest, { category: "github.check-update" }>).body);
    for (const rejected of ["installationId", "repositoryId", "checkRunId", "private-note"]) {
      expect(body).not.toContain(rejected);
    }
  });

  test("GitHub API allowlist accepts only known method and path pairs", () => {
    const allowed: GitHubGovernanceApiRequest[] = [
      {
        category: "github.pull-head",
        installationId: 123,
        repositoryId: 987,
        pullRequestNumber: 42,
        method: "GET",
        pathTemplate: GITHUB_PULL_HEAD_METADATA_PATH_TEMPLATE,
        path: "/repositories/987/pulls/42",
        accept: "application/vnd.github+json"
      },
      {
        category: "github.check-create",
        installationId: 123,
        repositoryId: 987,
        method: "POST",
        pathTemplate: GITHUB_CHECK_CREATE_PATH_TEMPLATE,
        path: "/repositories/987/check-runs",
        accept: "application/vnd.github+json",
        body: { name: DEVELOPER_REVIEW_CHECK_NAME, head_sha: "abc123", status: "queued" }
      },
      {
        category: "github.check-update",
        installationId: 123,
        repositoryId: 987,
        checkRunId: "check/42",
        method: "PATCH",
        pathTemplate: GITHUB_CHECK_UPDATE_PATH_TEMPLATE,
        path: "/repositories/987/check-runs/check%2F42",
        accept: "application/vnd.github+json",
        body: {
          name: DEVELOPER_REVIEW_CHECK_NAME,
          status: "completed",
          conclusion: "neutral",
          output: { title: "Attestation required", summary: "Minimal check summary" }
        }
      }
    ];

    for (const request of allowed) {
      expect(assertGitHubGovernanceApiRequestAllowed(request)).toBe(request);
    }
    for (const denied of [
      { ...allowed[0], method: "POST" },
      { ...allowed[1], path: "/repositories/987/issues/42" },
      { ...allowed[2], path: "/repositories/987/check-runs/check/42" },
      { ...allowed[2], accept: "application/json" },
      { ...allowed[0], category: "github.unknown" }
    ]) {
      expect(() => assertGitHubGovernanceApiRequestAllowed(denied as GitHubGovernanceApiRequest)).toThrow("github-api-request-denied");
    }
  });

  test("GitHub API allowlist explicitly rejects code-bearing endpoints", () => {
    const forbiddenCases = [
      { path: "/repos/ancienttwo/arch-context/pulls/42/files?per_page=100", name: "github.pr-files" },
      { path: "/repositories/987/pulls/42/files", name: "github.pr-files-by-repository-id" },
      { path: "/repos/ancienttwo/arch-context/contents/src/index.ts", name: "github.contents" },
      { path: "/repositories/987/contents?ref=main", name: "github.contents-by-repository-id" },
      { path: "/repos/ancienttwo/arch-context/git/blobs/abc123?ref=main", name: "github.blob" },
      { path: "/repositories/987/git/blobs/abc123", name: "github.blob-by-repository-id" },
      { path: "/repos/ancienttwo/arch-context/git/trees/abc123?recursive=1", name: "github.tree" },
      { path: "/repositories/987/git/trees/abc123?recursive=1", name: "github.tree-by-repository-id" }
    ] as const;

    const probe: GitHubGovernanceApiRequest = {
      category: "github.pull-head",
      installationId: 123,
      repositoryId: 987,
      pullRequestNumber: 42,
      method: "GET",
      pathTemplate: GITHUB_PULL_HEAD_METADATA_PATH_TEMPLATE,
      path: "/repositories/987/pulls/42",
      accept: "application/vnd.github+json"
    };

    for (const { path, name } of forbiddenCases) {
      const request = { ...probe, path };
      expect(identifyForbiddenGitHubGovernanceApiEndpoint(request)).toBe(name);
      expect(() => assertGitHubGovernanceApiRequestAllowed(request)).toThrow(`github-api-forbidden-endpoint: ${name}`);
    }
  });

  test("GitHub API allowlist explicitly rejects diff and patch accept headers", () => {
    const forbiddenAcceptCases = [
      { accept: "application/vnd.github.diff", mediaType: "application/vnd.github.diff" },
      { accept: "application/vnd.github.patch", mediaType: "application/vnd.github.patch" },
      { accept: "application/vnd.github.v3.diff; q=1", mediaType: "application/vnd.github.v3.diff" },
      { accept: "application/vnd.github+json, application/vnd.github.v3.patch", mediaType: "application/vnd.github.v3.patch" }
    ] as const;
    const probe: GitHubGovernanceApiRequest = {
      category: "github.check-update",
      installationId: 123,
      repositoryId: 987,
      checkRunId: "check/42",
      method: "PATCH",
      pathTemplate: GITHUB_CHECK_UPDATE_PATH_TEMPLATE,
      path: "/repositories/987/check-runs/check%2F42",
      accept: "application/vnd.github+json",
      body: {
        name: DEVELOPER_REVIEW_CHECK_NAME,
        status: "completed",
        conclusion: "neutral",
        output: { title: "Attestation required", summary: "Minimal check summary" }
      }
    };

    for (const { accept, mediaType } of forbiddenAcceptCases) {
      const request = { ...probe, accept };
      expect(identifyForbiddenGitHubGovernanceAcceptHeader(request)).toBe(mediaType);
      expect(() => assertGitHubGovernanceApiRequestAllowed(request as unknown as GitHubGovernanceApiRequest)).toThrow(`github-api-forbidden-accept: ${mediaType}`);
    }
  });

  test("createCheckRun and updateCheckRun reject failed GitHub responses", async () => {
    const failed = new GitHubGovernanceRestPort({
      async request(input) {
        return input.category === "github.check-create"
          ? { statusCode: 422, body: { message: "invalid" } }
          : { statusCode: 500, body: { message: "failed" } };
      }
    });

    await expect(failed.createCheckRun({
      installationId: 123,
      repositoryId: 987,
      pullRequestNumber: 42,
      headSha: "abc123",
      name: DEVELOPER_REVIEW_CHECK_NAME,
      status: "queued"
    })).rejects.toThrow("github-check-create-failed");

    await expect(failed.updateCheckRun({
      installationId: 123,
      repositoryId: 987,
      checkRunId: "check_42",
      name: DEVELOPER_REVIEW_CHECK_NAME,
      status: "completed",
      conclusion: "failure",
      output: { title: "Attestation required", summary: "Minimal check summary" }
    })).rejects.toThrow("github-check-update-failed");
  });

  test("delivery ledger rejects replayed delivery ids by provider", () => {
    const ledger = new InMemoryWebhookDeliveryLedger();
    const first = ledger.recordDelivery({ provider: "github", deliveryId: "delivery-1", receivedAt: "2026-06-20T00:00:00Z" });
    const replay = ledger.recordDelivery({ provider: "github", deliveryId: "delivery-1", receivedAt: "2026-06-20T00:01:00Z" });

    expect(first).toMatchObject({ replay: false, action: "process" });
    expect(replay).toMatchObject({ replay: true, action: "ignore-duplicate" });
    expect(replay.receivedAt).toBe(first.receivedAt);
  });

  test("validates webhook signature", () => {
    const rawBody = Buffer.from('{"ok": true, "nested": {"keep": "spacing"}}\n', "utf8");
    const signature256 = `sha256=${createHmac("sha256", "secret").update(rawBody).digest("hex")}`;
    const reparsedBody = Buffer.from(JSON.stringify(JSON.parse(rawBody.toString("utf8"))), "utf8");

    expect(verifyGitHubWebhookSignature({ secret: "secret", rawBody, signature256 })).toBe(true);
    expect(verifyGitHubWebhookSignature({ secret: "wrong-secret", rawBody, signature256 })).toBe(false);
    expect(verifyGitHubWebhookSignature({ secret: "secret", rawBody: reparsedBody, signature256 })).toBe(false);
    expect(verifyGitHubWebhookSignature({ secret: "secret", rawBody, signature256: signature256.replace("sha256=", "sha1=") })).toBe(false);
    expect(verifyGitHubWebhookSignature({ secret: "secret", rawBody, signature256: "sha256=bad" })).toBe(false);
  });

  test("projects a verified pull request webhook to minimum fields only", () => {
    const rawBody = Buffer.from(JSON.stringify({
      action: "opened",
      number: 42,
      installation: { id: 123 },
      repository: {
        id: 987,
        name: "arch-context",
        private: true,
        owner: { login: "ancienttwo" }
      },
      pull_request: {
        number: 42,
        title: "not retained",
        body: "private-note",
        diff_url: "https://example.invalid/pr.diff",
        patch_url: "https://example.invalid/pr.patch",
        files: [{ filename: "private.ts", patch: "private-patch" }],
        head: {
          sha: "abc123",
          ref: "feature/private"
        },
        base: {
          sha: "base123"
        }
      }
    }), "utf8");
    const projection = projectVerifiedGitHubWebhook({
      secret: "secret",
      rawBody,
      signature256: `sha256=${createHmac("sha256", "secret").update(rawBody).digest("hex")}`,
      deliveryId: "delivery-42",
      eventName: "pull_request"
    });

    expect(projection).toEqual({
      eventName: "pull_request",
      rawBodyRetained: false,
      event: {
        deliveryId: "delivery-42",
        action: "opened",
        repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
        pullRequest: { number: 42, headSha: "abc123" }
      }
    });
    expect("rawBody" in projection).toBe(false);
    const serialized = JSON.stringify(projection);
    for (const rejected of ["private-note", "diff_url", "patch_url", "files", "private-patch", "base123"]) {
      expect(serialized).not.toContain(rejected);
    }
  });

  test("projects all supported pull request actions", () => {
    for (const action of ["opened", "synchronize", "reopened"] as const) {
      const rawBody = Buffer.from(JSON.stringify({
        action,
        repository: { name: "arch-context", private: false, owner: { login: "ancienttwo" } },
        pull_request: { number: 7, head: { sha: `sha-${action}` } }
      }), "utf8");
      const projection = projectVerifiedGitHubWebhook({
        secret: "secret",
        rawBody,
        signature256: `sha256=${createHmac("sha256", "secret").update(rawBody).digest("hex")}`,
        deliveryId: `delivery-${action}`,
        eventName: "pull_request"
      });

      expect(projection.eventName).toBe("pull_request");
      if (projection.eventName !== "pull_request") throw new Error("expected pull request projection");
      expect(projection.event.action).toBe(action);
      expect(projection.event.pullRequest.headSha).toBe(`sha-${action}`);
    }
  });

  test("projects a rerequested check run webhook to minimum fields only", () => {
    const rawBody = Buffer.from(JSON.stringify({
      action: "rerequested",
      repository: {
        id: 987,
        name: "arch-context",
        private: true,
        owner: { login: "ancienttwo" }
      },
      check_run: {
        id: 123456,
        external_id: "check_42_abc123",
        name: DEVELOPER_REVIEW_CHECK_NAME,
        head_sha: "abc123",
        output: { title: "not retained", summary: "private-note" },
        pull_requests: [{ number: 42, head: { sha: "abc123" }, base: { sha: "base123" } }]
      }
    }), "utf8");
    const projection = projectVerifiedGitHubWebhook({
      secret: "secret",
      rawBody,
      signature256: `sha256=${createHmac("sha256", "secret").update(rawBody).digest("hex")}`,
      deliveryId: "delivery-check-rerun",
      eventName: "check_run"
    });

    expect(projection).toEqual({
      eventName: "check_run",
      rawBodyRetained: false,
      event: {
        deliveryId: "delivery-check-rerun",
        action: "rerequested",
        repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
        pullRequest: { number: 42 },
        checkRun: { id: "check_42_abc123", name: DEVELOPER_REVIEW_CHECK_NAME, headSha: "abc123" }
      }
    });
    const serialized = JSON.stringify(projection);
    for (const rejected of ["private-note", "base123", "pull_requests", "output"]) {
      expect(serialized).not.toContain(rejected);
    }
  });

  test("rejects unsupported check run events", () => {
    const rawBody = Buffer.from(JSON.stringify({
      action: "created",
      repository: { name: "arch-context", private: false, owner: { login: "ancienttwo" } },
      check_run: {
        id: 123456,
        name: DEVELOPER_REVIEW_CHECK_NAME,
        head_sha: "abc123",
        pull_requests: [{ number: 42 }]
      }
    }), "utf8");

    expect(() => projectVerifiedGitHubWebhook({
      secret: "secret",
      rawBody,
      signature256: `sha256=${createHmac("sha256", "secret").update(rawBody).digest("hex")}`,
      deliveryId: "delivery-created",
      eventName: "check_run"
    })).toThrow("github-webhook-action-unsupported");
  });

  test("rejects non-ArchContext check run names", () => {
    const rawBody = Buffer.from(JSON.stringify({
      action: "rerequested",
      repository: { name: "arch-context", private: false, owner: { login: "ancienttwo" } },
      check_run: {
        id: 123456,
        name: "Unrelated CI",
        head_sha: "abc123",
        pull_requests: [{ number: 42 }]
      }
    }), "utf8");

    expect(() => projectVerifiedGitHubWebhook({
      secret: "secret",
      rawBody,
      signature256: `sha256=${createHmac("sha256", "secret").update(rawBody).digest("hex")}`,
      deliveryId: "delivery-unrelated-check",
      eventName: "check_run"
    })).toThrow("github-webhook-check-unsupported");
  });

  test("rejects unsigned webhook payload before JSON projection", () => {
    expect(() => projectVerifiedGitHubWebhook({
      secret: "secret",
      rawBody: "{",
      signature256: `sha256=${"0".repeat(64)}`,
      deliveryId: "delivery-bad",
      eventName: "pull_request"
    })).toThrow("github-webhook-signature-invalid");
  });

  test("check runs display trust level and can require organization attestation", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const repository = { provider: "github" as const, owner: "ancienttwo", name: "arch-context", visibility: "private" as const };
    const state = new GitHubAppState();
    state.install(["ancienttwo/arch-context"]);
    state.requireOrganizationAttestation("ancienttwo/arch-context");
    const checkRun = state.handlePullRequest({
      deliveryId: "d3",
      action: "opened",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 2, headSha: "abc123" }
    }).checkRun!;
    expect(checkRun.name).toBe(ORGANIZATION_RUNNER_CHECK_NAME);
    const developerChallenge = createReviewChallenge({ repository, headSha: "abc123", expiresAt: "2026-06-19T00:10:00Z" });
    const developer = signLocalAttestation({
      challenge: developerChallenge,
      worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      reviewDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      deviceId: "device_1",
      publicKeyId: "pk_1",
      privateKey,
      issuedAt: "2026-06-19T00:00:00Z"
    });
    const developerUpdated = state.updateCheckFromAttestation(checkRun.id, developer, true);
    expect(developerUpdated.conclusion).toBe("failure");
    expect(developerUpdated.output?.summary).toContain("## ArchContext / Organization Runner");
    expect(developerUpdated.output?.summary).toContain("Organization attestation required");

    const organizationChallenge = createReviewChallenge({ repository, headSha: "abc123", expiresAt: "2026-06-19T00:10:00Z" });
    const organization = signOrganizationAttestation({
      challenge: organizationChallenge,
      worktreeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      reviewDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      runner: {
        schemaVersion: "archcontext.org-runner-identity/v1",
        runnerId: "runner_1",
        installationId: 123,
        publicKeyId: "org_pk_1",
        publicKeyFingerprint: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
        status: "active",
        createdAt: "2026-06-19T00:00:00Z"
      },
      privateKey,
      issuedAt: "2026-06-19T00:00:00Z"
    });
    const updated = state.updateCheckFromAttestation(checkRun.id, organization, true);
    expect(updated.conclusion).toBe("success");
    expect(updated.output?.title).toBe("Organization-attested");
    expect(updated.output?.summary).toContain("**Result: PASS**");
    expect(updated.output?.summary).toContain("No blocking findings.");
  });
});
