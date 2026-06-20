import { createHmac, timingSafeEqual } from "node:crypto";
import { attestationLabel, createReviewChallenge, type LocalAttestation, type ReviewChallenge, type TrustLevel } from "@archcontext/cloud/attestation";
import {
  DEVELOPER_REVIEW_CHECK_NAME,
  GITHUB_APP_PERMISSION_MANIFEST,
  ORGANIZATION_RUNNER_CHECK_NAME,
  type CheckReference,
  type CloudEgressEnvelope,
  type CreateGovernanceCheckInput,
  type GitHubGovernancePort,
  type GovernanceCheckName,
  type NotificationResult,
  type NotificationRiskLevel,
  type PullHeadMetadata,
  type UpdateGovernanceCheckInput
} from "@archcontext/contracts";

export const GITHUB_APP_PERMISSIONS = GITHUB_APP_PERMISSION_MANIFEST.repositoryPermissions;
export const GITHUB_PULL_HEAD_METADATA_PATH_TEMPLATE = "/repositories/{repository_id}/pulls/{pull_number}" as const;
export const GITHUB_CHECK_CREATE_PATH_TEMPLATE = "/repositories/{repository_id}/check-runs" as const;
export const GITHUB_CHECK_UPDATE_PATH_TEMPLATE = "/repositories/{repository_id}/check-runs/{check_run_id}" as const;
export const GITHUB_FORBIDDEN_ACCEPT_MEDIA_TYPES = [
  "application/vnd.github.diff",
  "application/vnd.github.patch",
  "application/vnd.github.v3.diff",
  "application/vnd.github.v3.patch"
] as const;
export const GITHUB_FORBIDDEN_API_ENDPOINTS = [
  {
    name: "github.pr-files",
    method: "GET",
    pathPattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/[1-9]\d*\/files(?:\?.*)?$/
  },
  {
    name: "github.pr-files-by-repository-id",
    method: "GET",
    pathPattern: /^\/repositories\/[1-9]\d*\/pulls\/[1-9]\d*\/files(?:\?.*)?$/
  },
  {
    name: "github.contents",
    method: "GET",
    pathPattern: /^\/repos\/[^/]+\/[^/]+\/contents(?:\/[^?#]*)?(?:\?.*)?$/
  },
  {
    name: "github.contents-by-repository-id",
    method: "GET",
    pathPattern: /^\/repositories\/[1-9]\d*\/contents(?:\/[^?#]*)?(?:\?.*)?$/
  },
  {
    name: "github.blob",
    method: "GET",
    pathPattern: /^\/repos\/[^/]+\/[^/]+\/git\/blobs\/[^/?#]+(?:\?.*)?$/
  },
  {
    name: "github.blob-by-repository-id",
    method: "GET",
    pathPattern: /^\/repositories\/[1-9]\d*\/git\/blobs\/[^/?#]+(?:\?.*)?$/
  },
  {
    name: "github.tree",
    method: "GET",
    pathPattern: /^\/repos\/[^/]+\/[^/]+\/git\/trees\/[^/?#]+(?:\?.*)?$/
  },
  {
    name: "github.tree-by-repository-id",
    method: "GET",
    pathPattern: /^\/repositories\/[1-9]\d*\/git\/trees\/[^/?#]+(?:\?.*)?$/
  }
] as const;

export type GitHubGovernanceApiRequest =
  | GitHubPullHeadApiRequest
  | GitHubCheckCreateApiRequest
  | GitHubCheckUpdateApiRequest;

export interface GitHubPullHeadApiRequest {
  category: "github.pull-head";
  installationId: number;
  repositoryId: number;
  pullRequestNumber: number;
  method: "GET";
  pathTemplate: typeof GITHUB_PULL_HEAD_METADATA_PATH_TEMPLATE;
  path: string;
  accept: "application/vnd.github+json";
}

export interface GitHubCheckCreateApiRequest {
  category: "github.check-create";
  installationId: number;
  repositoryId: number;
  method: "POST";
  pathTemplate: typeof GITHUB_CHECK_CREATE_PATH_TEMPLATE;
  path: string;
  accept: "application/vnd.github+json";
  body: {
    name: GovernanceCheckName;
    head_sha: string;
    status: CreateGovernanceCheckInput["status"];
  };
}

export interface GitHubCheckUpdateApiRequest {
  category: "github.check-update";
  installationId: number;
  repositoryId: number;
  checkRunId: string;
  method: "PATCH";
  pathTemplate: typeof GITHUB_CHECK_UPDATE_PATH_TEMPLATE;
  path: string;
  accept: "application/vnd.github+json";
  body: {
    name: GovernanceCheckName;
    status: UpdateGovernanceCheckInput["status"];
    conclusion?: NonNullable<UpdateGovernanceCheckInput["conclusion"]>;
    output: {
      title: string;
      summary: string;
    };
  };
}

export interface GitHubGovernanceApiResponse {
  statusCode: number;
  body: unknown;
  requestId?: string;
}

export interface GitHubGovernanceApiTransport {
  request(input: GitHubGovernanceApiRequest): Promise<GitHubGovernanceApiResponse>;
}

export interface GitHubGovernanceEgressRecorder {
  record(envelope: CloudEgressEnvelope): void | Promise<void>;
}

export interface RecordingGitHubGovernanceApiTransportOptions {
  transport: GitHubGovernanceApiTransport;
  recorder: GitHubGovernanceEgressRecorder;
  now?: () => string;
  monotonicNowMs?: () => number;
}

export function identifyForbiddenGitHubGovernanceApiEndpoint(input: { method?: unknown; path?: unknown }): typeof GITHUB_FORBIDDEN_API_ENDPOINTS[number]["name"] | undefined {
  const method = typeof input.method === "string" ? input.method.toUpperCase() : "";
  const path = typeof input.path === "string" ? input.path : "";
  return GITHUB_FORBIDDEN_API_ENDPOINTS.find((endpoint) => endpoint.method === method && endpoint.pathPattern.test(path))?.name;
}

export function identifyForbiddenGitHubGovernanceAcceptHeader(input: { accept?: unknown }): typeof GITHUB_FORBIDDEN_ACCEPT_MEDIA_TYPES[number] | undefined {
  if (typeof input.accept !== "string") return undefined;
  for (const part of input.accept.split(",")) {
    const mediaType = part.trim().split(";")[0]?.toLowerCase();
    const forbiddenMediaType = GITHUB_FORBIDDEN_ACCEPT_MEDIA_TYPES.find((forbidden) => forbidden === mediaType);
    if (forbiddenMediaType) return forbiddenMediaType;
  }
  return undefined;
}

export class RecordingGitHubGovernanceApiTransport implements GitHubGovernanceApiTransport {
  private readonly now: () => string;
  private readonly monotonicNowMs: () => number;

  constructor(private readonly options: RecordingGitHubGovernanceApiTransportOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.monotonicNowMs = options.monotonicNowMs ?? (() => Date.now());
  }

  async request(input: GitHubGovernanceApiRequest): Promise<GitHubGovernanceApiResponse> {
    const allowed = assertGitHubGovernanceApiRequestAllowed(input);
    const startedAt = this.monotonicNowMs();
    const response = await this.options.transport.request(allowed);
    await this.options.recorder.record({
      schemaVersion: "archcontext.cloud-egress/v1",
      requestId: response.requestId ?? "github-request-id-unavailable",
      category: allowed.category,
      method: allowed.method,
      host: "api.github.com",
      pathTemplate: allowed.pathTemplate,
      statusCode: response.statusCode,
      latencyMs: Math.max(0, Math.round(this.monotonicNowMs() - startedAt)),
      recordedAt: this.now()
    });
    return response;
  }
}

export function assertGitHubGovernanceApiRequestAllowed(input: GitHubGovernanceApiRequest): GitHubGovernanceApiRequest {
  const denied = () => new Error(`github-api-request-denied: ${String((input as { method?: unknown }).method)} ${String((input as { path?: unknown }).path)}`);
  const forbiddenEndpoint = identifyForbiddenGitHubGovernanceApiEndpoint(input);
  if (forbiddenEndpoint) throw new Error(`github-api-forbidden-endpoint: ${forbiddenEndpoint}`);
  const forbiddenAccept = identifyForbiddenGitHubGovernanceAcceptHeader(input);
  if (forbiddenAccept) throw new Error(`github-api-forbidden-accept: ${forbiddenAccept}`);
  if (input.accept !== "application/vnd.github+json") throw denied();
  if (input.category === "github.pull-head") {
    if (
      input.method === "GET" &&
      input.pathTemplate === GITHUB_PULL_HEAD_METADATA_PATH_TEMPLATE &&
      input.path === `/repositories/${input.repositoryId}/pulls/${input.pullRequestNumber}`
    ) return input;
    throw denied();
  }
  if (input.category === "github.check-create") {
    if (
      input.method === "POST" &&
      input.pathTemplate === GITHUB_CHECK_CREATE_PATH_TEMPLATE &&
      input.path === `/repositories/${input.repositoryId}/check-runs`
    ) return input;
    throw denied();
  }
  if (input.category === "github.check-update") {
    if (
      input.method === "PATCH" &&
      input.pathTemplate === GITHUB_CHECK_UPDATE_PATH_TEMPLATE &&
      input.path === `/repositories/${input.repositoryId}/check-runs/${encodeURIComponent(input.checkRunId)}`
    ) return input;
    throw denied();
  }
  throw denied();
}

export class GitHubGovernanceRestPort implements Pick<GitHubGovernancePort, "getPullHeadMetadata" | "createCheckRun" | "updateCheckRun"> {
  constructor(private readonly transport: GitHubGovernanceApiTransport) {}

  async getPullHeadMetadata(input: { installationId: number; repositoryId: number; pullRequestNumber: number }): Promise<PullHeadMetadata> {
    const installationId = requirePositiveInteger(input.installationId, "installationId");
    const repositoryId = requirePositiveInteger(input.repositoryId, "repositoryId");
    const pullRequestNumber = requirePositiveInteger(input.pullRequestNumber, "pullRequestNumber");
    const response = await this.transport.request(assertGitHubGovernanceApiRequestAllowed({
      category: "github.pull-head",
      installationId,
      repositoryId,
      pullRequestNumber,
      method: "GET",
      pathTemplate: GITHUB_PULL_HEAD_METADATA_PATH_TEMPLATE,
      path: `/repositories/${repositoryId}/pulls/${pullRequestNumber}`,
      accept: "application/vnd.github+json"
    }));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`github-pull-head-metadata-fetch-failed: ${response.statusCode}`);
    }
    const body = requireApiRecord(response.body, "pull");
    return {
      installationId,
      repositoryId,
      pullRequestNumber,
      headSha: requireApiString(requireApiRecord(body.head, "pull.head").sha, "pull.head.sha"),
      baseSha: requireApiString(requireApiRecord(body.base, "pull.base").sha, "pull.base.sha")
    };
  }

  async createCheckRun(input: CreateGovernanceCheckInput): Promise<CheckReference> {
    const installationId = requirePositiveInteger(input.installationId, "installationId");
    const repositoryId = requirePositiveInteger(input.repositoryId, "repositoryId");
    requirePositiveInteger(input.pullRequestNumber, "pullRequestNumber");
    const response = await this.transport.request(assertGitHubGovernanceApiRequestAllowed({
      category: "github.check-create",
      installationId,
      repositoryId,
      method: "POST",
      pathTemplate: GITHUB_CHECK_CREATE_PATH_TEMPLATE,
      path: `/repositories/${repositoryId}/check-runs`,
      accept: "application/vnd.github+json",
      body: {
        name: requireGovernanceCheckName(input.name),
        head_sha: requireNonEmptyInputString(input.headSha, "headSha"),
        status: requireCheckStatus(input.status)
      }
    }));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`github-check-create-failed: ${response.statusCode}`);
    }
    const body = requireApiRecord(response.body, "check_run");
    const htmlUrl = body.html_url === undefined ? undefined : requireApiString(body.html_url, "check_run.html_url");
    return {
      checkRunId: requireStringId(body.id, "check_run.id"),
      ...(htmlUrl ? { htmlUrl } : {})
    };
  }

  async updateCheckRun(input: UpdateGovernanceCheckInput): Promise<void> {
    const installationId = requirePositiveInteger(input.installationId, "installationId");
    const repositoryId = requirePositiveInteger(input.repositoryId, "repositoryId");
    const checkRunId = requireNonEmptyInputString(input.checkRunId, "checkRunId");
    const body: GitHubCheckUpdateApiRequest["body"] = {
      name: requireGovernanceCheckName(input.name),
      status: requireCheckStatus(input.status),
      output: {
        title: requireNonEmptyInputString(input.output.title, "output.title"),
        summary: requireNonEmptyInputString(input.output.summary, "output.summary")
      }
    };
    if (input.conclusion !== undefined) body.conclusion = requireCheckConclusion(input.conclusion);
    const response = await this.transport.request(assertGitHubGovernanceApiRequestAllowed({
      category: "github.check-update",
      installationId,
      repositoryId,
      checkRunId,
      method: "PATCH",
      pathTemplate: GITHUB_CHECK_UPDATE_PATH_TEMPLATE,
      path: `/repositories/${repositoryId}/check-runs/${encodeURIComponent(checkRunId)}`,
      accept: "application/vnd.github+json",
      body
    }));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`github-check-update-failed: ${response.statusCode}`);
    }
  }
}

export interface PullRequestEvent {
  deliveryId: string;
  action: "opened" | "synchronize" | "reopened";
  repository: { owner: string; name: string; visibility: "public" | "private" };
  pullRequest: { number: number; headSha: string };
}

export interface CheckRunRerequestEvent {
  deliveryId: string;
  action: "rerequested";
  repository: { owner: string; name: string; visibility: "public" | "private" };
  pullRequest: { number: number };
  checkRun: { id: string; name: GovernanceCheckName; headSha: string };
}

export interface GitHubInstallationRepository {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  visibility: "public" | "private";
}

export interface InstallationEvent {
  deliveryId: string;
  action: "created" | "deleted";
  installationId: number;
  repositories: GitHubInstallationRepository[];
}

export interface InstallationRepositoriesEvent {
  deliveryId: string;
  action: "added" | "removed";
  installationId: number;
  repositoriesAdded: GitHubInstallationRepository[];
  repositoriesRemoved: GitHubInstallationRepository[];
}

export interface ProjectVerifiedGitHubWebhookInput {
  secret: string;
  rawBody: string | Uint8Array;
  signature256: string;
  deliveryId: string;
  eventName: "pull_request" | "check_run" | "installation" | "installation_repositories";
}

export type ProjectedGitHubWebhookEvent =
  | { eventName: "pull_request"; event: PullRequestEvent; rawBodyRetained: false }
  | { eventName: "check_run"; event: CheckRunRerequestEvent; rawBodyRetained: false }
  | { eventName: "installation"; event: InstallationEvent; rawBodyRetained: false }
  | { eventName: "installation_repositories"; event: InstallationRepositoriesEvent; rawBodyRetained: false };

export interface WebhookDeliveryReceipt {
  provider: "github";
  deliveryId: string;
  receivedAt: string;
  replay: boolean;
  action: "process" | "ignore-duplicate";
}

export interface WebhookDeliveryLedger {
  recordDelivery(input: { provider: "github"; deliveryId: string; receivedAt: string }): WebhookDeliveryReceipt;
}

export class InMemoryWebhookDeliveryLedger implements WebhookDeliveryLedger {
  private readonly receipts = new Map<string, WebhookDeliveryReceipt>();

  recordDelivery(input: { provider: "github"; deliveryId: string; receivedAt: string }): WebhookDeliveryReceipt {
    const key = `${input.provider}:${input.deliveryId}`;
    const existing = this.receipts.get(key);
    if (existing) return { ...existing, replay: true, action: "ignore-duplicate" };
    const receipt: WebhookDeliveryReceipt = {
      provider: input.provider,
      deliveryId: input.deliveryId,
      receivedAt: input.receivedAt,
      replay: false,
      action: "process"
    };
    this.receipts.set(key, receipt);
    return receipt;
  }
}

export interface CheckRun {
  id: string;
  name: GovernanceCheckName;
  status: "queued" | "completed";
  conclusion?: "success" | "failure" | "neutral";
  headSha: string;
  output?: {
    title: "Developer-attested" | "Organization-attested" | "Attestation required";
    summary: string;
    trustLevel?: TrustLevel;
  };
}

export class GitHubAppState {
  installationId?: number;
  readonly selectedRepositories = new Set<string>();
  readonly organizationAttestationRequired = new Set<string>();
  readonly challenges = new Map<string, ReviewChallenge>();
  readonly checks = new Map<string, CheckRun>();

  constructor(private readonly deliveryLedger: WebhookDeliveryLedger = new InMemoryWebhookDeliveryLedger()) {}

  install(repositories: string[], installationId?: number): void {
    if (installationId !== undefined) this.installationId = installationId;
    for (const repository of repositories) this.selectedRepositories.add(repository);
  }

  uninstall(): void {
    this.installationId = undefined;
    this.selectedRepositories.clear();
    this.organizationAttestationRequired.clear();
  }

  handleInstallation(event: InstallationEvent, now = "2026-06-19T00:00:00Z"): { idempotent: boolean; replayRejected: boolean; delivery: WebhookDeliveryReceipt; selectedRepositories: string[] } {
    const delivery = this.deliveryLedger.recordDelivery({ provider: "github", deliveryId: event.deliveryId, receivedAt: now });
    if (delivery.replay) return { idempotent: true, replayRejected: true, delivery, selectedRepositories: this.repositoryList() };
    if (event.action === "created") {
      this.installationId = event.installationId;
      this.selectedRepositories.clear();
      for (const repository of event.repositories) this.selectedRepositories.add(repository.fullName);
    } else {
      this.uninstall();
    }
    return { idempotent: false, replayRejected: false, delivery, selectedRepositories: this.repositoryList() };
  }

  handleInstallationRepositories(event: InstallationRepositoriesEvent, now = "2026-06-19T00:00:00Z"): { idempotent: boolean; replayRejected: boolean; delivery: WebhookDeliveryReceipt; selectedRepositories: string[] } {
    const delivery = this.deliveryLedger.recordDelivery({ provider: "github", deliveryId: event.deliveryId, receivedAt: now });
    if (delivery.replay) return { idempotent: true, replayRejected: true, delivery, selectedRepositories: this.repositoryList() };
    this.installationId = event.installationId;
    for (const repository of event.repositoriesAdded) this.selectedRepositories.add(repository.fullName);
    for (const repository of event.repositoriesRemoved) {
      this.selectedRepositories.delete(repository.fullName);
      this.organizationAttestationRequired.delete(repository.fullName);
    }
    return { idempotent: false, replayRejected: false, delivery, selectedRepositories: this.repositoryList() };
  }

  requireOrganizationAttestation(repository: string, required = true): void {
    if (required) this.organizationAttestationRequired.add(repository);
    else this.organizationAttestationRequired.delete(repository);
  }

  handlePullRequest(event: PullRequestEvent, now = "2026-06-19T00:00:00Z"): { idempotent: boolean; replayRejected: boolean; delivery: WebhookDeliveryReceipt; challenge?: ReviewChallenge; checkRun?: CheckRun } {
    const repositoryKey = `${event.repository.owner}/${event.repository.name}`;
    this.assertRepositorySelected(repositoryKey);
    const delivery = this.deliveryLedger.recordDelivery({ provider: "github", deliveryId: event.deliveryId, receivedAt: now });
    if (delivery.replay) return { idempotent: true, replayRejected: true, delivery };
    this.invalidateHead(event.repository.owner, event.repository.name, event.pullRequest.number, event.pullRequest.headSha);
    const checkName = this.organizationAttestationRequired.has(repositoryKey)
      ? ORGANIZATION_RUNNER_CHECK_NAME
      : DEVELOPER_REVIEW_CHECK_NAME;
    const challenge = createReviewChallenge({
      repository: { provider: "github", owner: event.repository.owner, name: event.repository.name, visibility: event.repository.visibility },
      headSha: event.pullRequest.headSha,
      expiresAt: new Date(Date.parse(now) + 10 * 60 * 1000).toISOString()
    });
    const checkRun: CheckRun = {
      id: `check_${event.pullRequest.number}_${event.pullRequest.headSha.slice(0, 8)}`,
      name: checkName,
      status: "queued",
      headSha: event.pullRequest.headSha
    };
    this.challenges.set(challenge.challengeId, challenge);
    this.checks.set(checkRun.id, checkRun);
    return { idempotent: false, replayRejected: false, delivery, challenge, checkRun };
  }

  handleCheckRunRerequest(event: CheckRunRerequestEvent, now = "2026-06-19T00:00:00Z"): { idempotent: boolean; replayRejected: boolean; delivery: WebhookDeliveryReceipt; challenge?: ReviewChallenge; checkRun?: CheckRun } {
    this.assertRepositorySelected(`${event.repository.owner}/${event.repository.name}`);
    const delivery = this.deliveryLedger.recordDelivery({ provider: "github", deliveryId: event.deliveryId, receivedAt: now });
    if (delivery.replay) return { idempotent: true, replayRejected: true, delivery };
    const challenge = createReviewChallenge({
      repository: { provider: "github", owner: event.repository.owner, name: event.repository.name, visibility: event.repository.visibility },
      headSha: event.checkRun.headSha,
      expiresAt: new Date(Date.parse(now) + 10 * 60 * 1000).toISOString()
    });
    const checkRun: CheckRun = {
      id: event.checkRun.id,
      name: event.checkRun.name,
      status: "queued",
      headSha: event.checkRun.headSha
    };
    this.challenges.set(challenge.challengeId, challenge);
    this.checks.set(checkRun.id, checkRun);
    return { idempotent: false, replayRejected: false, delivery, challenge, checkRun };
  }

  updateCheckFromAttestation(checkRunId: string, attestation: LocalAttestation, accepted: boolean): CheckRun {
    const check = this.checks.get(checkRunId);
    if (!check) throw new Error(`Check run not found: ${checkRunId}`);
    const repositoryKey = `${attestation.repository.owner}/${attestation.repository.name}`;
    const requiresOrganization = check.name === ORGANIZATION_RUNNER_CHECK_NAME || this.organizationAttestationRequired.has(repositoryKey);
    const trustAllowed = !requiresOrganization || attestation.trustLevel === "organization";
    const title = accepted ? attestationLabel(attestation.trustLevel) : "Attestation required";
    const summary = renderArchitectureCheckSummary(
      buildArchitectureCheckSummaryInput({
        check,
        attestation,
        accepted,
        trustAllowed,
        requiresOrganization
      })
    );
    const updated: CheckRun = {
      ...check,
      status: "completed",
      conclusion: accepted && attestation.headSha === check.headSha && trustAllowed ? "success" : "failure",
      output: {
        title,
        summary,
        trustLevel: accepted ? attestation.trustLevel : undefined
      }
    };
    this.checks.set(checkRunId, updated);
    return updated;
  }

  private invalidateHead(owner: string, name: string, pr: number, newHeadSha: string): void {
    for (const [id, check] of this.checks) {
      if (id.startsWith(`check_${pr}_`) && check.headSha !== newHeadSha) {
        this.checks.set(id, { ...check, status: "completed", conclusion: "neutral" });
      }
    }
    for (const [id, challenge] of this.challenges) {
      if (challenge.repository.owner === owner && challenge.repository.name === name && challenge.headSha !== newHeadSha) {
        this.challenges.set(id, { ...challenge, consumed: true });
      }
    }
  }

  private assertRepositorySelected(repository: string): void {
    if (!this.selectedRepositories.has(repository)) throw new Error(`github-repository-not-selected: ${repository}`);
  }

  private repositoryList(): string[] {
    return [...this.selectedRepositories].sort();
  }
}

function buildArchitectureCheckSummaryInput(input: {
  check: CheckRun;
  attestation: LocalAttestation;
  accepted: boolean;
  trustAllowed: boolean;
  requiresOrganization: boolean;
}): ArchitectureCheckSummaryInput {
  const bound = input.attestation.headSha === input.check.headSha;
  const pass = input.accepted && bound && input.trustAllowed;
  const findings: ArchitectureCheckSummaryInput["findings"] = [];
  if (!input.accepted) {
    findings.push({ severity: "error", message: "Attestation was not accepted for this check run" });
  }
  if (!bound) {
    findings.push({ severity: "error", message: "Attestation head does not match the check head" });
  }
  if (!input.trustAllowed) {
    findings.push({
      severity: "error",
      message: input.requiresOrganization
        ? "Organization attestation required for this repository"
        : "Attestation trust level is not allowed"
    });
  }
  return {
    checkName: input.check.name,
    repository: { owner: input.attestation.repository.owner, name: input.attestation.repository.name },
    prNumber: checkRunPrNumber(input.check.id),
    headSha: input.check.headSha,
    result: pass ? "pass" : "fail_action_required",
    riskLevel: pass ? "low" : "high",
    pressureScore: pass ? 0 : 100,
    confidenceScore: input.accepted && bound ? 100 : 0,
    findings,
    attestation: {
      trustLevel: input.attestation.trustLevel,
      title: attestationLabel(input.attestation.trustLevel),
      verifiedAt: input.attestation.issuedAt,
      bound
    }
  };
}

function checkRunPrNumber(checkRunId: string): number {
  const match = /^check_(\d+)_/.exec(checkRunId);
  return match ? Number(match[1]) : 0;
}

export function verifyGitHubWebhookSignature(input: { secret: string; rawBody: string | Uint8Array; signature256: string }): boolean {
  if (!input.signature256.startsWith("sha256=")) return false;
  const signatureHex = input.signature256.slice("sha256=".length);
  if (!/^[0-9a-fA-F]{64}$/.test(signatureHex)) return false;
  const expected = Buffer.from(createHmac("sha256", input.secret).update(input.rawBody).digest("hex"), "hex");
  const received = Buffer.from(signatureHex, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function projectVerifiedGitHubWebhook(input: ProjectVerifiedGitHubWebhookInput): ProjectedGitHubWebhookEvent {
  if (!verifyGitHubWebhookSignature(input)) throw new Error("github-webhook-signature-invalid");
  const payload = parseJsonObject(input.rawBody);
  if (input.eventName === "pull_request") {
    return {
      eventName: "pull_request",
      event: projectPullRequestWebhook(input.deliveryId, payload),
      rawBodyRetained: false
    };
  }
  if (input.eventName === "check_run") {
    return {
      eventName: "check_run",
      event: projectCheckRunWebhook(input.deliveryId, payload),
      rawBodyRetained: false
    };
  }
  if (input.eventName === "installation") {
    return {
      eventName: "installation",
      event: projectInstallationWebhook(input.deliveryId, payload),
      rawBodyRetained: false
    };
  }
  if (input.eventName === "installation_repositories") {
    return {
      eventName: "installation_repositories",
      event: projectInstallationRepositoriesWebhook(input.deliveryId, payload),
      rawBodyRetained: false
    };
  }
  throw new Error(`github-webhook-event-unsupported: ${String(input.eventName)}`);
}

function parseJsonObject(rawBody: string | Uint8Array): Record<string, unknown> {
  const text = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8");
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("github-webhook-payload-invalid");
  }
  return parsed as Record<string, unknown>;
}

function projectPullRequestWebhook(deliveryId: string, payload: Record<string, unknown>): PullRequestEvent {
  const pullRequest = requireRecord(payload.pull_request, "pull_request");
  const repository = requireRecord(payload.repository, "repository");
  const owner = requireRecord(repository.owner, "repository.owner");
  const action = requirePullRequestAction(payload.action);
  return {
    deliveryId,
    action,
    repository: {
      owner: requireString(owner.login, "repository.owner.login"),
      name: requireString(repository.name, "repository.name"),
      visibility: repository.private === true ? "private" : "public"
    },
    pullRequest: {
      number: requireNumber(pullRequest.number ?? payload.number, "pull_request.number"),
      headSha: requireString(requireRecord(pullRequest.head, "pull_request.head").sha, "pull_request.head.sha")
    }
  };
}

function projectCheckRunWebhook(deliveryId: string, payload: Record<string, unknown>): CheckRunRerequestEvent {
  if (payload.action !== "rerequested") throw new Error(`github-webhook-action-unsupported: ${String(payload.action)}`);
  const checkRun = requireRecord(payload.check_run, "check_run");
  const repository = requireRecord(payload.repository, "repository");
  const owner = requireRecord(repository.owner, "repository.owner");
  const pullRequest = requireFirstRecord(checkRun.pull_requests, "check_run.pull_requests");
  return {
    deliveryId,
    action: "rerequested",
    repository: {
      owner: requireString(owner.login, "repository.owner.login"),
      name: requireString(repository.name, "repository.name"),
      visibility: repository.private === true ? "private" : "public"
    },
    pullRequest: {
      number: requireNumber(pullRequest.number, "check_run.pull_requests[0].number")
    },
    checkRun: {
      id: requireStringId(checkRun.external_id ?? checkRun.id, "check_run.id"),
      name: requireGovernanceCheckName(checkRun.name),
      headSha: requireString(checkRun.head_sha, "check_run.head_sha")
    }
  };
}

function projectInstallationWebhook(deliveryId: string, payload: Record<string, unknown>): InstallationEvent {
  const action = requireInstallationAction(payload.action);
  const installation = requireRecord(payload.installation, "installation");
  return {
    deliveryId,
    action,
    installationId: requireNumber(installation.id, "installation.id"),
    repositories: projectInstallationRepositories(payload.repositories, "repositories")
  };
}

function projectInstallationRepositoriesWebhook(deliveryId: string, payload: Record<string, unknown>): InstallationRepositoriesEvent {
  const action = requireInstallationRepositoriesAction(payload.action);
  const installation = requireRecord(payload.installation, "installation");
  return {
    deliveryId,
    action,
    installationId: requireNumber(installation.id, "installation.id"),
    repositoriesAdded: projectInstallationRepositories(payload.repositories_added, "repositories_added"),
    repositoriesRemoved: projectInstallationRepositories(payload.repositories_removed, "repositories_removed")
  };
}

function requirePullRequestAction(value: unknown): PullRequestEvent["action"] {
  if (value === "opened" || value === "synchronize" || value === "reopened") return value;
  throw new Error(`github-webhook-action-unsupported: ${String(value)}`);
}

function requireInstallationAction(value: unknown): InstallationEvent["action"] {
  if (value === "created" || value === "deleted") return value;
  throw new Error(`github-webhook-action-unsupported: ${String(value)}`);
}

function requireInstallationRepositoriesAction(value: unknown): InstallationRepositoriesEvent["action"] {
  if (value === "added" || value === "removed") return value;
  throw new Error(`github-webhook-action-unsupported: ${String(value)}`);
}

function requireGovernanceCheckName(value: unknown): GovernanceCheckName {
  if (value === DEVELOPER_REVIEW_CHECK_NAME || value === ORGANIZATION_RUNNER_CHECK_NAME) return value;
  throw new Error(`github-webhook-check-unsupported: ${String(value)}`);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`github-webhook-field-invalid: ${path}`);
  return value as Record<string, unknown>;
}

function requireFirstRecord(value: unknown, path: string): Record<string, unknown> {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`github-webhook-field-invalid: ${path}`);
  return requireRecord(value[0], `${path}[0]`);
}

function projectInstallationRepositories(value: unknown, path: string): GitHubInstallationRepository[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`github-webhook-field-invalid: ${path}`);
  return value.map((item, index) => projectInstallationRepository(item, `${path}[${index}]`));
}

function projectInstallationRepository(value: unknown, path: string): GitHubInstallationRepository {
  const repository = requireRecord(value, path);
  const owner = requireRecord(repository.owner, `${path}.owner`);
  const fullName = requireString(repository.full_name, `${path}.full_name`);
  return {
    id: requireNumber(repository.id, `${path}.id`),
    fullName,
    owner: requireString(owner.login, `${path}.owner.login`),
    name: requireString(repository.name, `${path}.name`),
    visibility: repository.private === true ? "private" : "public"
  };
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`github-webhook-field-invalid: ${path}`);
  return value;
}

function requireStringId(value: unknown, path: string): string {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).length === 0) throw new Error(`github-webhook-field-invalid: ${path}`);
  if (typeof value === "number" && !Number.isInteger(value)) throw new Error(`github-webhook-field-invalid: ${path}`);
  return String(value);
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`github-webhook-field-invalid: ${path}`);
  return value;
}

function requirePositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new Error(`github-governance-input-invalid: ${path}`);
  return value;
}

function requireNonEmptyInputString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`github-governance-input-invalid: ${path}`);
  return value;
}

function requireCheckStatus(value: unknown): CreateGovernanceCheckInput["status"] {
  if (value === "queued" || value === "in_progress" || value === "completed") return value;
  throw new Error(`github-governance-input-invalid: status`);
}

function requireCheckConclusion(value: unknown): NonNullable<UpdateGovernanceCheckInput["conclusion"]> {
  if (value === "success" || value === "failure" || value === "neutral" || value === "cancelled" || value === "timed_out" || value === "action_required") return value;
  throw new Error(`github-governance-input-invalid: conclusion`);
}

function requireApiRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`github-governance-response-invalid: ${path}`);
  return value as Record<string, unknown>;
}

function requireApiString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`github-governance-response-invalid: ${path}`);
  return value;
}

// ---------------------------------------------------------------------------
// Governance Check Summary builder
// Produces a GitHub-flavored Markdown string for CheckRun.output.summary.
// No HTML/CSS/images; pure GFM only.
// ---------------------------------------------------------------------------

export interface ArchitectureCheckSummaryInput {
  checkName: GovernanceCheckName;
  repository: { owner: string; name: string };
  prNumber: number;
  headSha: string;
  result: NotificationResult;
  riskLevel: NotificationRiskLevel;
  pressureScore: number;
  confidenceScore: number;
  killList?: { remainingCallers: number; targets?: string[] };
  findings?: { severity: "info" | "warning" | "error"; message: string; selector?: string }[];
  attestation: {
    trustLevel: TrustLevel;
    title: string;
    verifiedAt: string;
    bound: boolean;
  };
}

function miniBar(score: number): string {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  return `${"█".repeat(filled)}${"░".repeat(empty)} ${score}/100`;
}

function resultBanner(result: NotificationResult): string {
  if (result === "pass") return "**Result: PASS**";
  if (result === "pass_with_warnings") return "**Result: PASS_WITH_WARNINGS**";
  return "**Result: FAIL — action required**";
}

function findingMark(severity: "info" | "warning" | "error"): string {
  if (severity === "error") return "[x]";
  if (severity === "warning") return "[!]";
  return "[ok]";
}

export function renderArchitectureCheckSummary(input: ArchitectureCheckSummaryInput): string {
  const shortSha = input.headSha.slice(0, 12);
  const label = attestationLabel(input.attestation.trustLevel);
  const lines: string[] = [];

  // placeholder comment (required by deliverable spec)
  lines.push(`<!-- placeholders: {{result}} {{headSha}} {{pressureScore}} {{confidenceScore}} {{riskLevel}} {{remainingCallers}} {{attestationTrustLevel}} {{verifiedAt}} -->`);
  lines.push("");

  // 1. Title
  lines.push(`## ${input.checkName}`);
  lines.push("");

  // 2. Result banner + risk + attestation title
  lines.push(resultBanner(input.result));
  lines.push(`Risk: ${input.riskLevel}  |  ${label}`);
  lines.push("");

  // 3. Metrics table: pressure, confidence, kill-list
  const killListCell =
    input.killList !== undefined ? `remaining callers: ${input.killList.remainingCallers}` : "—";

  lines.push("| Metric | Value |");
  lines.push("| --- | --- |");
  lines.push(`| Pressure | \`${miniBar(input.pressureScore)}\` |`);
  lines.push(`| Confidence | \`${miniBar(input.confidenceScore)}\` |`);
  lines.push(`| Kill list | ${killListCell} |`);
  lines.push("");

  // 4. Findings
  lines.push("### Findings");
  lines.push("");
  if (!input.findings || input.findings.length === 0) {
    lines.push("No blocking findings.");
  } else {
    for (const f of input.findings) {
      const mark = findingMark(f.severity);
      const selector = f.selector ? `  \`${f.selector}\`` : "";
      lines.push(`- ${mark} **${f.severity}** — ${f.message}${selector}`);
    }
  }
  lines.push("");

  // 5. Kill-list migration targets (if present)
  if (input.killList?.targets && input.killList.targets.length > 0) {
    lines.push("### Migration targets");
    lines.push("");
    for (const t of input.killList.targets) {
      lines.push(`- \`${t}\``);
    }
    lines.push("");
  }

  // 6. Attestation trust block (blockquote)
  lines.push("> **Signed attestation** — device-signed, commit-bound");
  lines.push(`> This attestation is valid only for \`${shortSha}\`. Pushing a new commit invalidates it`);
  lines.push(`> immediately and re-queues the review.`);
  lines.push(`> ${input.attestation.title} · verified ${input.attestation.verifiedAt}`);
  lines.push(`>`);
  lines.push(`> The SaaS verifies minimal fields only; it never receives your code, diffs, symbols, the dependency graph, model bodies, or detailed findings.`);
  lines.push(`>`);
  lines.push(`> Run locally: \`archctx review --attest\`  (\`egress none\`)`);
  lines.push("");

  // 7. Footer
  lines.push("---");
  lines.push("Generated by ArchContext");

  return lines.join("\n");
}
