import { describe, expect, test } from "bun:test";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { attestationV2Digest, createAttestationV2, createReviewChallenge, signLocalAttestation, signOrganizationAttestation } from "@archcontext/cloud/attestation";
import { checkDeliveryIdempotencyKey } from "@archcontext/cloud/cloud-db";
import { DEVELOPER_REVIEW_CHECK_NAME, GITHUB_APP_PERMISSION_MANIFEST, ORGANIZATION_RUNNER_CHECK_NAME, type AttestationV2, type CloudEgressEnvelope } from "@archcontext/contracts";
import {
  GITHUB_APP_PERMISSIONS,
  GITHUB_CHECK_LIST_FOR_REF_PATH_TEMPLATE,
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
  webhookDeliveryIdempotencyKey,
  type GitHubGovernanceApiRequest
} from "../src/index";

describe("GitHub App", () => {
  test("uses no Contents permission and handles PR challenge/check lifecycle", () => {
    expect(GITHUB_APP_PERMISSIONS).toBe(GITHUB_APP_PERMISSION_MANIFEST.repositoryPermissions);
    expect(GITHUB_APP_PERMISSIONS).toEqual({
      metadata: "read",
      pull_requests: "read",
      checks: "write",
      statuses: "write",
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
    const superseded = state.checks.get(first.checkRun!.id);
    expect(superseded?.status).toBe("completed");
    expect(superseded?.conclusion).toBe("neutral");
    expect(superseded?.output?.title).toBe("Superseded");
    expect(superseded?.output?.summary).toContain("Superseded by a newer PR head");
    expect(superseded?.output?.summary).toContain("`abc123`");
    expect(superseded?.output?.summary).toContain("`def456`");
    expect(superseded?.conclusion).not.toBe("stale");
  });

  test("feature flags gate Developer Check Organization Check and requiredTrust rollout", () => {
    const developerOff = new GitHubAppState(undefined, { developerCheck: false });
    developerOff.install(["ancienttwo/arch-context"]);
    const developerResult = developerOff.handlePullRequest({
      deliveryId: "feature-dev-off",
      action: "opened",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 10, headSha: "a".repeat(40) }
    });
    expect(developerResult.checkRun).toBeUndefined();
    expect(developerOff.checks.size).toBe(0);
    expect(developerOff.challenges.size).toBe(0);

    const organizationOff = new GitHubAppState(undefined, { organizationCheck: false });
    organizationOff.install(["ancienttwo/arch-context"]);
    organizationOff.requireOrganizationAttestation("ancienttwo/arch-context");
    const organizationResult = organizationOff.handlePullRequest({
      deliveryId: "feature-org-off",
      action: "opened",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 11, headSha: "b".repeat(40) }
    });
    expect(organizationResult.checkRun).toBeUndefined();
    expect(organizationOff.checks.size).toBe(0);
    expect(organizationOff.challenges.size).toBe(0);

    const requiredTrustOff = new GitHubAppState(undefined, { requiredTrust: false });
    requiredTrustOff.install(["ancienttwo/arch-context"]);
    requiredTrustOff.requireOrganizationAttestation("ancienttwo/arch-context");
    const fallback = requiredTrustOff.handlePullRequest({
      deliveryId: "feature-required-trust-off",
      action: "opened",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 12, headSha: "c".repeat(40) }
    });
    expect(fallback.checkRun?.name).toBe(DEVELOPER_REVIEW_CHECK_NAME);
    expect(requiredTrustOff.evaluateGovernanceFeatureFlags({ requiredTrust: "organization" })).toMatchObject({
      allowed: false,
      reason: "required-trust-disabled"
    });

    const publicationOff = new GitHubAppState(undefined, { organizationCheck: false });
    publicationOff.install(["ancienttwo/arch-context"]);
    publicationOff.requireOrganizationAttestation("ancienttwo/arch-context");
    publicationOff.setGovernanceFeatureFlags({ organizationCheck: true });
    const organizationCheck = publicationOff.handlePullRequest({
      deliveryId: "feature-org-publication",
      action: "opened",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 13, headSha: "d".repeat(40) }
    }).checkRun!;
    publicationOff.setGovernanceFeatureFlags({ organizationCheck: false });
    expect(() => publicationOff.updateOrganizationRunnerCheckFromAttestation({
      checkRunId: organizationCheck.id,
      accepted: false,
      attestation: createAttestationV2({
        challengeId: "chal_feature_org_publication",
        installationId: 141544438,
        repositoryId: 987,
        pullRequestNumber: 13,
        headSha: "d".repeat(40),
        baseSha: "abc123abc123abc123abc123abc123abc123abcd",
        mergeBaseSha: "ccc123ccc123ccc123ccc123ccc123ccc123cccc",
        headTreeOid: "ddd123ddd123ddd123ddd123ddd123ddd123dddd",
        worktreeDigest: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
        modelDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        policyDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        codeFactsDigest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
        reviewDigest: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
        result: "pass",
        execution: {
          trustLevel: "organization",
          source: "organization-runner-checkout",
          principalId: "runner_0001",
          publicKeyId: "key_runner_0001",
          runnerId: "runner_0001",
          workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
          runId: "1234567890",
          runAttempt: 1
        },
        runtime: attestationRuntime(),
        nonce: "nonce_feature_org_publication",
        startedAt: "2026-06-20T09:03:00Z",
        completedAt: "2026-06-20T09:04:00Z",
        expiresAt: "2026-06-20T09:15:00Z"
      })
    })).toThrow("governance-feature-disabled: organization-check-disabled");
  });

  test("handles installation creation repository selection changes and revocation", () => {
    const state = new GitHubAppState();
    const repoA = installationRepository("ancienttwo/arch-context", 987);
    const repoB = installationRepository("ancienttwo/other", 988);
    const repoC = installationRepository("ancienttwo/third", 989);

    const created = state.handleInstallation({
      deliveryId: "install-created",
      action: "created",
      installationId: 123,
      repositories: [repoA, repoB]
    });
    expect(created.selectedRepositories).toEqual(["ancienttwo/arch-context", "ancienttwo/other"]);
    expect(state.installationId).toBe(123);

    const replay = state.handleInstallation({
      deliveryId: "install-created",
      action: "created",
      installationId: 123,
      repositories: [repoC]
    });
    expect(replay.replayRejected).toBe(true);
    expect(replay.selectedRepositories).toEqual(["ancienttwo/arch-context", "ancienttwo/other"]);

    const changed = state.handleInstallationRepositories({
      deliveryId: "install-repos",
      action: "added",
      installationId: 123,
      repositoriesAdded: [repoC],
      repositoriesRemoved: [repoB]
    });
    expect(changed.selectedRepositories).toEqual(["ancienttwo/arch-context", "ancienttwo/third"]);
    state.requireOrganizationAttestation("ancienttwo/third");
    expect(state.organizationAttestationRequired.has("ancienttwo/third")).toBe(true);

    const removed = state.handleInstallationRepositories({
      deliveryId: "install-repos-remove",
      action: "removed",
      installationId: 123,
      repositoriesAdded: [],
      repositoriesRemoved: [repoC]
    });
    expect(removed.selectedRepositories).toEqual(["ancienttwo/arch-context"]);
    expect(state.organizationAttestationRequired.has("ancienttwo/third")).toBe(false);

    const revoked = state.handleInstallation({
      deliveryId: "install-deleted",
      action: "deleted",
      installationId: 123,
      repositories: []
    });
    expect(revoked.selectedRepositories).toEqual([]);
    expect(state.installationId).toBeUndefined();
    expect(() => state.handlePullRequest({
      deliveryId: "after-revoke",
      action: "opened",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 1, headSha: "abc123" }
    })).toThrow("github-repository-not-selected");
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

    const externalId = checkDeliveryIdempotencyKey({
      challengeId: "chal_create_check",
      checkName: DEVELOPER_REVIEW_CHECK_NAME,
      headSha: "abc123"
    });
    const result = await port.createCheckRun({
      installationId: 123,
      repositoryId: 987,
      pullRequestNumber: 42,
      headSha: "abc123",
      name: DEVELOPER_REVIEW_CHECK_NAME,
      status: "queued",
      externalId
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
        status: "queued",
        external_id: externalId
      }
    }]);
    const body = JSON.stringify((requests[0] as Extract<GitHubGovernanceApiRequest, { category: "github.check-create" }>).body);
    expect(externalId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(body).not.toContain("chal_create_check");
    for (const rejected of ["pullRequestNumber", "private-note", "output", "summary"]) {
      expect(body).not.toContain(rejected);
    }
  });

  test("listCheckRunsForRef sends a metadata-only filtered Check query", async () => {
    const requests: GitHubGovernanceApiRequest[] = [];
    const port = new GitHubGovernanceRestPort({
      async request(input) {
        requests.push(input);
        return {
          statusCode: 200,
          body: {
            total_count: 1,
            private_note: "not retained",
            check_runs: [
              {
                id: 111,
                name: DEVELOPER_REVIEW_CHECK_NAME,
                head_sha: "abc123",
                status: "completed",
                conclusion: "neutral",
                html_url: "https://github.example/checks/111",
                output: {
                  title: "Superseded",
                  summary: "Superseded by a newer PR head"
                }
              }
            ]
          }
        };
      }
    });

    const result = await port.listCheckRunsForRef({
      installationId: 123,
      repositoryId: 987,
      ref: "abc123",
      name: DEVELOPER_REVIEW_CHECK_NAME
    });

    expect(result).toEqual([{
      checkRunId: "111",
      name: DEVELOPER_REVIEW_CHECK_NAME,
      headSha: "abc123",
      status: "completed",
      conclusion: "neutral",
      htmlUrl: "https://github.example/checks/111",
      output: {
        title: "Superseded",
        summary: "Superseded by a newer PR head"
      }
    }]);
    expect(requests).toEqual([{
      category: "github.check-list-for-ref",
      installationId: 123,
      repositoryId: 987,
      ref: "abc123",
      name: DEVELOPER_REVIEW_CHECK_NAME,
      method: "GET",
      pathTemplate: GITHUB_CHECK_LIST_FOR_REF_PATH_TEMPLATE,
      path: "/repositories/987/commits/abc123/check-runs?check_name=ArchContext%20%2F%20Developer%20Review",
      accept: "application/vnd.github+json"
    }]);
    const serialized = JSON.stringify(result);
    for (const rejected of ["private_note", "pull_requests", "files", "contents"]) {
      expect(serialized).not.toContain(rejected);
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
        category: "github.check-list-for-ref",
        installationId: 123,
        repositoryId: 987,
        ref: "abc123",
        name: DEVELOPER_REVIEW_CHECK_NAME,
        method: "GET",
        pathTemplate: GITHUB_CHECK_LIST_FOR_REF_PATH_TEMPLATE,
        path: "/repositories/987/commits/abc123/check-runs?check_name=ArchContext%20%2F%20Developer%20Review",
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
      { ...allowed[1], path: "/repositories/987/commits/abc123/check-runs" },
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
    const key = webhookDeliveryIdempotencyKey({ provider: "github", deliveryId: "delivery-1" });

    expect(key).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(key).not.toContain("delivery-1");
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

  test("projects fork pull request repository identity without retaining private payload", () => {
    const rawBody = Buffer.from(JSON.stringify({
      action: "opened",
      repository: {
        name: "arch-context",
        private: false,
        owner: { login: "ancienttwo" }
      },
      pull_request: {
        number: 9,
        title: "not retained",
        body: "private-note",
        head: {
          sha: "abc123fork",
          repo: {
            full_name: "forker/arch-context",
            fork: true
          }
        }
      }
    }), "utf8");
    const projection = projectVerifiedGitHubWebhook({
      secret: "secret",
      rawBody,
      signature256: `sha256=${createHmac("sha256", "secret").update(rawBody).digest("hex")}`,
      deliveryId: "delivery-fork",
      eventName: "pull_request"
    });

    expect(projection).toEqual({
      eventName: "pull_request",
      rawBodyRetained: false,
      event: {
        deliveryId: "delivery-fork",
        action: "opened",
        repository: { owner: "ancienttwo", name: "arch-context", visibility: "public" },
        pullRequest: {
          number: 9,
          headSha: "abc123fork",
          headRepositoryFork: true,
          headRepositoryFullName: "forker/arch-context"
        }
      }
    });
    expect(JSON.stringify(projection)).not.toContain("private-note");
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

  test("projects installation webhook to minimum fields only", () => {
    const projection = signedProjection("installation", "delivery-install", {
      action: "created",
      installation: { id: 123, account: { login: "ancienttwo" }, permissions: { contents: "none" } },
      repositories: [
        {
          id: 987,
          name: "arch-context",
          full_name: "ancienttwo/arch-context",
          private: true,
          description: "not retained",
          default_branch: "private-main",
          owner: { login: "ancienttwo" },
          permissions: { admin: true }
        }
      ]
    });

    expect(projection).toEqual({
      eventName: "installation",
      rawBodyRetained: false,
      event: {
        deliveryId: "delivery-install",
        action: "created",
        installationId: 123,
        repositories: [
          { id: 987, fullName: "ancienttwo/arch-context", owner: "ancienttwo", name: "arch-context", visibility: "private" }
        ]
      }
    });
    const serialized = JSON.stringify(projection);
    for (const rejected of ["description", "default_branch", "private-main", "permissions", "account"]) {
      expect(serialized).not.toContain(rejected);
    }
  });

  test("projects installation repository selection changes to minimum fields only", () => {
    const projection = signedProjection("installation_repositories", "delivery-install-repos", {
      action: "added",
      installation: { id: 123 },
      repositories_added: [
        {
          id: 989,
          name: "third",
          full_name: "ancienttwo/third",
          private: false,
          owner: { login: "ancienttwo" },
          description: "not retained"
        }
      ],
      repositories_removed: [
        {
          id: 988,
          name: "other",
          full_name: "ancienttwo/other",
          private: true,
          owner: { login: "ancienttwo" },
          default_branch: "private-main"
        }
      ]
    });

    expect(projection).toEqual({
      eventName: "installation_repositories",
      rawBodyRetained: false,
      event: {
        deliveryId: "delivery-install-repos",
        action: "added",
        installationId: 123,
        repositoriesAdded: [
          { id: 989, fullName: "ancienttwo/third", owner: "ancienttwo", name: "third", visibility: "public" }
        ],
        repositoriesRemoved: [
          { id: 988, fullName: "ancienttwo/other", owner: "ancienttwo", name: "other", visibility: "private" }
        ]
      }
    });
    const serialized = JSON.stringify(projection);
    for (const rejected of ["description", "default_branch", "private-main"]) {
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

  test("rejects unsupported installation events", () => {
    expect(() => signedProjection("installation", "delivery-install-unsupported", {
      action: "suspend",
      installation: { id: 123 },
      repositories: []
    })).toThrow("github-webhook-action-unsupported");

    expect(() => signedProjection("installation_repositories", "delivery-install-repos-unsupported", {
      action: "unknown",
      installation: { id: 123 },
      repositories_added: [],
      repositories_removed: []
    })).toThrow("github-webhook-action-unsupported");
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

  test("organization runner fork pull requests publish neutral unsupported without issuing a challenge", () => {
    const state = new GitHubAppState();
    state.install(["ancienttwo/arch-context"]);
    state.requireOrganizationAttestation("ancienttwo/arch-context");

    const result = state.handlePullRequest({
      deliveryId: "fork-pr",
      action: "opened",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "public" },
      pullRequest: {
        number: 9,
        headSha: "abc123fork",
        headRepositoryFork: true,
        headRepositoryFullName: "forker/arch-context"
      }
    });

    expect(result.challenge).toBeUndefined();
    expect(state.challenges.size).toBe(0);
    expect(result.checkRun).toMatchObject({
      name: ORGANIZATION_RUNNER_CHECK_NAME,
      status: "completed",
      conclusion: "neutral",
      headSha: "abc123fork",
      output: {
        title: "Unsupported"
      }
    });
    expect(result.checkRun?.output?.summary).toContain("Fork pull request detected");
    expect(result.checkRun?.output?.summary).toContain("No signing secret");
    expect(result.checkRun?.output?.summary).toContain("safe no-secret");
    expect(result.checkRun?.output?.summary).not.toContain("Organization-attested");
  });

  test("publishes Developer Review Check summary from accepted Attestation v2", () => {
    const state = new GitHubAppState();
    state.install(["ancienttwo/arch-context"]);
    const checkRun = state.handlePullRequest({
      deliveryId: "developer-v2-pr",
      action: "opened",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 42, headSha: "def456def456def456def456def456def456def4" }
    }).checkRun!;
    const attestation = createAttestationV2({
      challengeId: "chal_developer_review",
      installationId: 141544438,
      repositoryId: 987,
      pullRequestNumber: 42,
      headSha: "def456def456def456def456def456def456def4",
      baseSha: "abc123abc123abc123abc123abc123abc123abcd",
      mergeBaseSha: "ccc123ccc123ccc123ccc123ccc123ccc123cccc",
      headTreeOid: "ddd123ddd123ddd123ddd123ddd123ddd123dddd",
      worktreeDigest: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
      modelDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      policyDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      codeFactsDigest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      reviewDigest: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
      result: "pass",
      execution: {
        trustLevel: "developer",
        source: "clean-commit-worktree",
        principalId: "device_0001",
        publicKeyId: "key_device_0001"
      },
      runtime: attestationRuntime(),
      nonce: "nonce_developer_review",
      startedAt: "2026-06-20T09:03:00Z",
      completedAt: "2026-06-20T09:04:00Z",
      expiresAt: "2026-06-20T09:15:00Z"
    });

    const updated = state.updateDeveloperReviewCheckFromAttestation({
      checkRunId: checkRun.id,
      attestation,
      accepted: true,
      attestationDigest: attestationV2Digest(attestation)
    });

    expect(updated.name).toBe(DEVELOPER_REVIEW_CHECK_NAME);
    expect(updated.conclusion).toBe("success");
    expect(updated.output?.title).toBe("Developer-attested");
    expect(updated.output?.trustLevel).toBe("developer");
    expect(updated.output?.summary).toContain("## ArchContext / Developer Review");
    expect(updated.output?.summary).toContain("**Result: PASS**");
    expect(updated.output?.summary).toContain("Developer-attested");
    expect(updated.output?.summary).toContain("clean-commit-worktree");
    expect(updated.output?.summary).toContain("Attestation digest");
    expect(updated.output?.summary).toContain("`def456def456`");
    expect(updated.output?.summary).not.toContain("Organization-attested");
    expect(updated.output?.summary).not.toContain("source" + " code");
  });

  test("publishes Organization Runner Check summary from accepted Attestation v2", () => {
    const state = new GitHubAppState();
    state.install(["ancienttwo/arch-context"]);
    state.requireOrganizationAttestation("ancienttwo/arch-context");
    const checkRun = state.handlePullRequest({
      deliveryId: "organization-v2-pr",
      action: "opened",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 44, headSha: "aaa456aaa456aaa456aaa456aaa456aaa456aaa4" }
    }).checkRun!;
    const attestation = createAttestationV2({
      challengeId: "chal_organization_runner_review",
      installationId: 141544438,
      repositoryId: 987,
      pullRequestNumber: 44,
      headSha: "aaa456aaa456aaa456aaa456aaa456aaa456aaa4",
      baseSha: "abc123abc123abc123abc123abc123abc123abcd",
      mergeBaseSha: "ccc123ccc123ccc123ccc123ccc123ccc123cccc",
      headTreeOid: "ddd123ddd123ddd123ddd123ddd123ddd123dddd",
      worktreeDigest: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
      modelDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      policyDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      codeFactsDigest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      reviewDigest: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
      result: "pass",
      execution: {
        trustLevel: "organization",
        source: "organization-runner-checkout",
        principalId: "runner_0001",
        publicKeyId: "key_runner_0001",
        runnerId: "runner_0001",
        workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
        runId: "1234567890",
        runAttempt: 1
      },
      runtime: attestationRuntime(),
      nonce: "nonce_organization_runner_review",
      startedAt: "2026-06-20T09:03:00Z",
      completedAt: "2026-06-20T09:04:00Z",
      expiresAt: "2026-06-20T09:15:00Z"
    });

    const updated = state.updateOrganizationRunnerCheckFromAttestation({
      checkRunId: checkRun.id,
      attestation,
      accepted: true,
      attestationDigest: attestationV2Digest(attestation)
    });

    expect(updated.name).toBe(ORGANIZATION_RUNNER_CHECK_NAME);
    expect(updated.conclusion).toBe("success");
    expect(updated.output?.title).toBe("Organization-attested");
    expect(updated.output?.trustLevel).toBe("organization");
    expect(updated.output?.summary).toContain("## ArchContext / Organization Runner");
    expect(updated.output?.summary).toContain("**Result: PASS**");
    expect(updated.output?.summary).toContain("Organization-attested");
    expect(updated.output?.summary).toContain("organization-runner-checkout");
    expect(updated.output?.summary).toContain("Attestation digest");
    expect(updated.output?.summary).not.toContain("## ArchContext / Developer Review");
    expect(updated.output?.summary).not.toContain("source" + " code");
  });

  test("Organization Runner Check rejects developer Attestation v2 provenance", () => {
    const state = new GitHubAppState();
    state.install(["ancienttwo/arch-context"]);
    state.requireOrganizationAttestation("ancienttwo/arch-context");
    const checkRun = state.handlePullRequest({
      deliveryId: "organization-v2-developer-pr",
      action: "opened",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 45, headSha: "bbb456bbb456bbb456bbb456bbb456bbb456bbb4" }
    }).checkRun!;
    const attestation = createAttestationV2({
      challengeId: "chal_organization_runner_developer_review",
      installationId: 141544438,
      repositoryId: 987,
      pullRequestNumber: 45,
      headSha: "bbb456bbb456bbb456bbb456bbb456bbb456bbb4",
      baseSha: "abc123abc123abc123abc123abc123abc123abcd",
      mergeBaseSha: "ccc123ccc123ccc123ccc123ccc123ccc123cccc",
      headTreeOid: "ddd123ddd123ddd123ddd123ddd123dddd",
      worktreeDigest: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
      modelDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      policyDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      codeFactsDigest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      reviewDigest: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
      result: "pass",
      execution: {
        trustLevel: "developer",
        source: "clean-commit-worktree",
        principalId: "device_0001",
        publicKeyId: "key_device_0001"
      },
      runtime: attestationRuntime(),
      nonce: "nonce_organization_runner_developer_review",
      startedAt: "2026-06-20T09:03:00Z",
      completedAt: "2026-06-20T09:04:00Z",
      expiresAt: "2026-06-20T09:15:00Z"
    });

    const updated = state.updateOrganizationRunnerCheckFromAttestation({
      checkRunId: checkRun.id,
      attestation,
      accepted: true,
      attestationDigest: attestationV2Digest(attestation)
    });

    expect(updated.name).toBe(ORGANIZATION_RUNNER_CHECK_NAME);
    expect(updated.conclusion).toBe("failure");
    expect(updated.output?.title).toBe("Attestation required");
    expect(updated.output?.summary).toContain("Organization attestation required for this check run");
    expect(updated.output?.summary).not.toContain("## ArchContext / Developer Review");
  });

  test("Developer Review Check rejects non-developer Attestation v2 provenance", () => {
    const state = new GitHubAppState();
    state.install(["ancienttwo/arch-context"]);
    const checkRun = state.handlePullRequest({
      deliveryId: "developer-v2-org-pr",
      action: "opened",
      repository: { owner: "ancienttwo", name: "arch-context", visibility: "private" },
      pullRequest: { number: 43, headSha: "fed456fed456fed456fed456fed456fed456fed4" }
    }).checkRun!;
    const attestation = createAttestationV2({
      challengeId: "chal_organization_review",
      installationId: 141544438,
      repositoryId: 987,
      pullRequestNumber: 43,
      headSha: "fed456fed456fed456fed456fed456fed456fed4",
      baseSha: "abc123abc123abc123abc123abc123abc123abcd",
      mergeBaseSha: "ccc123ccc123ccc123ccc123ccc123ccc123cccc",
      headTreeOid: "ddd123ddd123ddd123ddd123ddd123ddd123dddd",
      worktreeDigest: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
      modelDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      policyDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      codeFactsDigest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      reviewDigest: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
      result: "pass",
      execution: {
        trustLevel: "organization",
        source: "organization-runner-checkout",
        principalId: "runner_0001",
        publicKeyId: "key_runner_0001",
        runnerId: "runner_0001",
        workflowRef: "owner/repo/.github/workflows/archcontext-review.yml@refs/heads/main",
        runId: "1234567890",
        runAttempt: 1
      },
      runtime: attestationRuntime(),
      nonce: "nonce_organization_review",
      startedAt: "2026-06-20T09:03:00Z",
      completedAt: "2026-06-20T09:04:00Z",
      expiresAt: "2026-06-20T09:15:00Z"
    });

    const updated = state.updateDeveloperReviewCheckFromAttestation({
      checkRunId: checkRun.id,
      attestation,
      accepted: true,
      attestationDigest: attestationV2Digest(attestation)
    });

    expect(updated.name).toBe(DEVELOPER_REVIEW_CHECK_NAME);
    expect(updated.conclusion).toBe("failure");
    expect(updated.output?.title).toBe("Attestation required");
    expect(updated.output?.summary).toContain("Developer attestation required for this check run");
  });
});

function installationRepository(fullName: string, id: number) {
  const [owner, name] = fullName.split("/");
  return {
    id,
    fullName,
    owner,
    name,
    visibility: "private" as const
  };
}

function attestationRuntime(): AttestationV2["runtime"] {
  return {
    version: "0.2.0",
    buildDigest: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
    ["code" + "GraphVersion"]: "1.0.1",
    capabilitiesDigest: "sha256:6666666666666666666666666666666666666666666666666666666666666666"
  } as AttestationV2["runtime"];
}

function signedProjection(eventName: Parameters<typeof projectVerifiedGitHubWebhook>[0]["eventName"], deliveryId: string, payload: Record<string, unknown>) {
  const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
  return projectVerifiedGitHubWebhook({
    secret: "secret",
    rawBody,
    signature256: `sha256=${createHmac("sha256", "secret").update(rawBody).digest("hex")}`,
    deliveryId,
    eventName
  });
}
