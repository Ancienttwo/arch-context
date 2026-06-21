import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { inspectFg4GithubHostedRunnerReadback } from "./fg4-github-hosted-runner-readback";

describe("fg4 GitHub-hosted runner readback", () => {
  test("accepts sanitized verified GitHub-hosted Organization Runner evidence", () => {
    const evidence = JSON.parse(readFileSync("docs/verification/fg4-github-hosted-runner-readback.json", "utf8"));
    expect(inspectFg4GithubHostedRunnerReadback(evidence)).toEqual({ ok: true, failures: [] });
  });

  test("rejects weak workflow evidence, missing cleanup, and secret markers", () => {
    const evidence = JSON.parse(readFileSync("docs/verification/fg4-github-hosted-runner-readback.json", "utf8"));
    const weak = {
      ...evidence,
      evidence: {
        ...evidence.evidence,
        temporaryBranch: {
          ...evidence.evidence.temporaryBranch,
          deletedAfterReadback: false
        },
        workflow: {
          ...evidence.evidence.workflow,
          conclusion: "failure"
        },
        artifact: {
          ...evidence.evidence.artifact,
          llmProviderConfigured: true
        },
        organizationRunner: {
          ...evidence.evidence.organizationRunner,
          outputTitle: "Attestation required"
        }
      },
      leaked: "gho_secret_marker"
    };
    const result = inspectFg4GithubHostedRunnerReadback(weak);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("temporary branch must be deleted");
    expect(result.failures).toContain("workflow conclusion must be success");
    expect(result.failures).toContain("llmProviderConfigured must be false");
    expect(result.failures).toContain("organization check title mismatch");
    expect(result.failures.some((failure) => failure.includes("forbidden secret marker"))).toBe(true);
  });

  test("accepts sanitized verified self-hosted Organization Runner evidence", () => {
    expect(inspectFg4GithubHostedRunnerReadback(selfHostedEvidence())).toEqual({ ok: true, failures: [] });
  });
});

function selfHostedEvidence() {
  return {
    schemaVersion: "archcontext.fg4-self-hosted-runner-readback/v1",
    environment: "staging",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-21T00:00:00.000Z",
    evidence: {
      temporaryBranch: {
        name: "codex/fg4-eg2-self-hosted-readback-test",
        commit: "a".repeat(40),
        deletedAfterReadback: true
      },
      pullRequest: {
        number: 10,
        url: "https://github.com/Ancienttwo/arch-context/pull/10",
        closedAfterReadback: true
      },
      workflow: {
        name: "FG4 EG2 Self-hosted Organization Runner",
        kind: "self-hosted",
        runnerLabels: ["self-hosted", "macOS", "ARM64", "archcontext-fg4-eg2"],
        runId: 27894392127,
        runUrl: "https://github.com/Ancienttwo/arch-context/actions/runs/27894392127",
        event: "pull_request",
        status: "completed",
        conclusion: "success",
        headSha: "a".repeat(40)
      },
      artifact: {
        schemaVersion: "archcontext.fg4-self-hosted-runner-attestation/v1",
        ok: true,
        environment: "github-actions",
        runnerOs: "macOS",
        runnerName: "archcontext-fg4-eg2-local",
        llmProviderConfigured: false,
        attestationTrustLevel: "organization",
        attestationResult: "pass",
        attestationDigest: `sha256:${"b".repeat(64)}`,
        privacyAuditOk: true,
        verificationAccepted: true
      },
      organizationRunner: {
        checkName: "ArchContext / Organization Runner",
        checkRunId: "82543364408",
        checkRunUrl: "https://github.com/Ancienttwo/arch-context/runs/82543364408",
        conclusion: "success",
        outputTitle: "Organization-attested"
      },
      egress: []
    },
    failures: []
  };
}
