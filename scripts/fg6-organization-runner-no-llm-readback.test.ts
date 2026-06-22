import { describe, expect, test } from "bun:test";
import { inspectFg6OrganizationRunnerNoLlm } from "./fg6-organization-runner-no-llm-readback";

describe("fg6 Organization Runner no-LLM readback evidence", () => {
  test("accepts AC-04 Organization Runner no-LLM evidence", () => {
    expect(inspectFg6OrganizationRunnerNoLlm(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects provider use, Developer context substitution, and code-content markers", () => {
    const recording = verifiedRecording();
    recording.evidence.runner.artifact.llmProviderConfigured = true;
    recording.evidence.ruleset.ruleset.requiredStatusCheck.context = "ArchContext / Developer Review";
    recording.evidence.runner.egress.push({
      category: "github.contents",
      method: "GET",
      pathTemplate: "/repositories/{repository_id}/contents/{path}",
      statusCode: 200,
      requestId: "req_forbidden_contents"
    });

    const result = inspectFg6OrganizationRunnerNoLlm(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("runner artifact must have llmProviderConfigured=false");
    expect(result.failures).toContain("ruleset required context must be Organization Runner");
    expect(result.failures.some((failure) => failure.includes("forbidden code-content marker"))).toBe(true);
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg6-organization-runner-no-llm-readback/v1",
    acceptanceId: "AC-04",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T07:00:00.000Z",
    sources: {
      runnerSource: "docs/verification/fg4-github-hosted-runner-readback.json",
      rulesetSource: "docs/verification/fg4-organization-runner-ruleset-readback.json",
      deterministicSource: "docs/verification/fg4-deterministic-conclusion-readback.json"
    },
    evidence: {
      runner: {
        temporaryBranch: {
          name: "codex/fg4-eg1-github-hosted-readback",
          commit: "a".repeat(40),
          deletedAfterReadback: true
        },
        pullRequest: {
          number: 9,
          url: "https://github.com/Ancienttwo/arch-context/pull/9",
          closedAfterReadback: true
        },
        workflow: {
          name: "FG4 EG1 GitHub-hosted Organization Runner",
          runId: 27894392126,
          runUrl: "https://github.com/Ancienttwo/arch-context/actions/runs/27894392126",
          event: "pull_request",
          status: "completed",
          conclusion: "success",
          headSha: "a".repeat(40)
        },
        artifact: {
          schemaVersion: "archcontext.fg4-github-hosted-runner-attestation/v1",
          ok: true,
          environment: "github-actions",
          runnerOs: "Linux",
          llmProviderConfigured: false,
          attestationTrustLevel: "organization",
          attestationResult: "pass",
          attestationDigest: `sha256:${"b".repeat(64)}`,
          privacyAuditOk: true,
          verificationAccepted: true
        },
        organizationRunner: {
          checkName: "ArchContext / Organization Runner",
          checkRunId: "82543364407",
          checkRunUrl: "https://github.com/Ancienttwo/arch-context/runs/82543364407",
          conclusion: "success",
          outputTitle: "Organization-attested"
        },
        egress: [
          egress("github.pull-head", "GET", "/repositories/{repository_id}/pulls/{pull_number}", 200),
          egress("github.check-create", "POST", "/repositories/{repository_id}/check-runs", 201),
          egress("github.check-update", "PATCH", "/repositories/{repository_id}/check-runs/{check_run_id}", 200)
        ]
      },
      ruleset: {
        policy: {
          requiredTrust: "organization",
          developerTrustSatisfiesOrganization: false,
          developerAttestationVerification: {
            accepted: false,
            reasonCode: "TRUST_LEVEL_MISMATCH"
          }
        },
        developerReview: {
          checkName: "ArchContext / Developer Review",
          conclusion: "success",
          outputTitle: "Developer-attested"
        },
        organizationRunner: {
          checkName: "ArchContext / Organization Runner",
          conclusion: "failure",
          outputTitle: "Attestation required"
        },
        ruleset: {
          id: 17939058,
          enforcement: "active",
          requiredStatusCheck: {
            context: "ArchContext / Organization Runner",
            integrationId: 4102781
          },
          deletedAfterReadback: true,
          absentAfterDelete: true
        }
      },
      deterministic: {
        providerEnvCleared: {
          OPENAI_API_KEY: true,
          ANTHROPIC_API_KEY: true,
          GOOGLE_API_KEY: true,
          MISTRAL_API_KEY: true
        },
        deterministicGate: {
          llmProviderConfigured: false,
          result: "pass",
          reviewDigestMatchesAttestation: true
        },
        attestation: {
          accepted: true,
          result: "pass",
          conclusionSource: "deterministic-gate"
        },
        advisory: {
          allowedAdvisoryCreated: true,
          injectedAdvisoryRejected: true
        },
        upload: {
          privacyAuditOk: true,
          containsAdvisory: false,
          containsProviderCredential: false
        },
        leakCounters: {
          plaintextNonceLeaks: 0,
          privateKeyLeaks: 0,
          tokenLeaks: 0
        }
      },
      sourceInspections: {
        runner: { ok: true, failures: [] },
        ruleset: { ok: true, failures: [] },
        deterministic: { ok: true, failures: [] }
      },
      assertions: {
        organizationRunnerRequiredCheckPassed: true,
        noLlmProviderConfigured: true,
        organizationAttestationAccepted: true,
        developerAttestationCannotSatisfyOrganization: true,
        requiredContextBoundToArchContextApp: true,
        temporaryRunnerReadbackCleanedUp: true
      }
    },
    failures: []
  };
}

function egress(category: string, method: string, pathTemplate: string, statusCode: number) {
  return {
    category,
    method,
    pathTemplate,
    statusCode,
    requestId: `req_${category.replace(/[^a-z]+/g, "_")}`
  };
}
