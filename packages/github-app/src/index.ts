import { createHmac, timingSafeEqual } from "node:crypto";
import { attestationLabel, createReviewChallenge, type LocalAttestation, type ReviewChallenge, type TrustLevel } from "../../attestation/src/index";

export const GITHUB_APP_PERMISSIONS = {
  contents: "none",
  checks: "write",
  metadata: "read",
  pull_requests: "read"
} as const;

export interface PullRequestEvent {
  deliveryId: string;
  action: "opened" | "synchronize" | "reopened";
  repository: { owner: string; name: string; visibility: "public" | "private" };
  pullRequest: { number: number; headSha: string };
}

export interface CheckRun {
  id: string;
  name: "ArchContext / Architecture Review";
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
  readonly deliveries = new Set<string>();
  readonly selectedRepositories = new Set<string>();
  readonly organizationAttestationRequired = new Set<string>();
  readonly challenges = new Map<string, ReviewChallenge>();
  readonly checks = new Map<string, CheckRun>();

  install(repositories: string[]): void {
    for (const repository of repositories) this.selectedRepositories.add(repository);
  }

  uninstall(): void {
    this.selectedRepositories.clear();
    this.organizationAttestationRequired.clear();
  }

  requireOrganizationAttestation(repository: string, required = true): void {
    if (required) this.organizationAttestationRequired.add(repository);
    else this.organizationAttestationRequired.delete(repository);
  }

  handlePullRequest(event: PullRequestEvent, now = "2026-06-19T00:00:00Z"): { idempotent: boolean; challenge?: ReviewChallenge; checkRun?: CheckRun } {
    if (this.deliveries.has(event.deliveryId)) return { idempotent: true };
    this.deliveries.add(event.deliveryId);
    this.invalidateHead(event.repository.owner, event.repository.name, event.pullRequest.number, event.pullRequest.headSha);
    const challenge = createReviewChallenge({
      repository: { provider: "github", owner: event.repository.owner, name: event.repository.name, visibility: event.repository.visibility },
      headSha: event.pullRequest.headSha,
      expiresAt: new Date(Date.parse(now) + 10 * 60 * 1000).toISOString()
    });
    const checkRun: CheckRun = {
      id: `check_${event.pullRequest.number}_${event.pullRequest.headSha.slice(0, 8)}`,
      name: "ArchContext / Architecture Review",
      status: "queued",
      headSha: event.pullRequest.headSha
    };
    this.challenges.set(challenge.challengeId, challenge);
    this.checks.set(checkRun.id, checkRun);
    return { idempotent: false, challenge, checkRun };
  }

  updateCheckFromAttestation(checkRunId: string, attestation: LocalAttestation, accepted: boolean): CheckRun {
    const check = this.checks.get(checkRunId);
    if (!check) throw new Error(`Check run not found: ${checkRunId}`);
    const repositoryKey = `${attestation.repository.owner}/${attestation.repository.name}`;
    const requiresOrganization = this.organizationAttestationRequired.has(repositoryKey);
    const trustAllowed = !requiresOrganization || attestation.trustLevel === "organization";
    const updated: CheckRun = {
      ...check,
      status: "completed",
      conclusion: accepted && attestation.headSha === check.headSha && trustAllowed ? "success" : "failure",
      output: {
        title: accepted ? attestationLabel(attestation.trustLevel) : "Attestation required",
        summary: requiresOrganization
          ? "Repository requires organization-attested review from a customer-controlled runner."
          : "Repository accepts developer-attested or organization-attested review.",
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
}

export function verifyGitHubWebhookSignature(input: { secret: string; body: string; signature256: string }): boolean {
  const expected = `sha256=${createHmac("sha256", input.secret).update(input.body).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(input.signature256);
  return a.length === b.length && timingSafeEqual(a, b);
}
