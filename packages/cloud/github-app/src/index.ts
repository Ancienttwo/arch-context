import { createHmac, timingSafeEqual } from "node:crypto";
import { attestationLabel, createReviewChallenge, type LocalAttestation, type ReviewChallenge, type TrustLevel } from "@archcontext/cloud/attestation";
import {
  DEVELOPER_REVIEW_CHECK_NAME,
  ORGANIZATION_RUNNER_CHECK_NAME,
  type GovernanceCheckName,
  type NotificationResult,
  type NotificationRiskLevel
} from "@archcontext/contracts";

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
    const repositoryKey = `${event.repository.owner}/${event.repository.name}`;
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
    return { idempotent: false, challenge, checkRun };
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

export function verifyGitHubWebhookSignature(input: { secret: string; body: string; signature256: string }): boolean {
  const expected = `sha256=${createHmac("sha256", input.secret).update(input.body).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(input.signature256);
  return a.length === b.length && timingSafeEqual(a, b);
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
