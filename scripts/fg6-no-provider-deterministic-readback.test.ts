import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { REVIEW_ACTION_NO_LLM_MODEL_DIGEST } from "@archcontext/cloud/runner";
import { buildFg6NoProviderDeterministicConfig, inspectFg6NoProviderDeterministic, runFg6NoProviderDeterministic } from "./fg6-no-provider-deterministic-readback";

describe("fg6 no-provider deterministic gate readback evidence", () => {
  test("runs with historical sources and a fresh deterministic recording without writing a file", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fg6-readback-"));
    try {
      const config = buildFg6NoProviderDeterministicConfig({}, []);
      const result = await runFg6NoProviderDeterministic({ ...config, root,
        localNoCloudSource: resolve(config.localNoCloudSource), runnerSource: resolve(config.runnerSource),
        orgNoLlmSource: resolve(config.orgNoLlmSource) });
      expect(result.ok).toBe(true);
      expect(result.evidence.sourceInspections.deterministic.ok).toBe(true);
      expect(result.sources).not.toHaveProperty("deterministicSource");
      expect(await readdir(root)).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  test("accepts AC-06 no-provider deterministic gate evidence", () => {
    expect(inspectFg6NoProviderDeterministic(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects provider configuration, conclusion drift, advisory/upload leakage, and failed source inspections", () => {
    const recording: any = verifiedRecording();
    recording.evidence.officialReviewAction.artifact.llmProviderConfigured = true;
    recording.evidence.deterministicGate.deterministicGate.modelDigest = `sha256:${"9".repeat(64)}`;
    recording.evidence.deterministicGate.upload.containsProviderCredential = true;
    recording.evidence.deterministicGate.advisory.injectedAdvisoryRejected = false;
    recording.evidence.deterministicGate.leakCounters.tokenLeaks = 1;
    recording.evidence.sourceInspections.runner.ok = false;
    recording.evidence.assertions.uploadPayloadProviderFree = false;

    const result = inspectFg6NoProviderDeterministic(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("officialReviewAction artifact must have llmProviderConfigured=false");
    expect(result.failures).toContain("deterministic gate modelDigest must be no-provider digest");
    expect(result.failures).toContain("deterministic upload must not contain provider credentials");
    expect(result.failures).toContain("injected advisory must be rejected");
    expect(result.failures).toContain("tokenLeaks must be 0");
    expect(result.failures).toContain("runner source inspection must pass");
    expect(result.failures).toContain("assertion uploadPayloadProviderFree must be true");
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg6-no-provider-deterministic-readback/v1",
    acceptanceId: "AC-06",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T09:00:00.000Z",
    sources: {
      localNoCloudSource: "docs/verification/fg6-local-no-cloud-readback.json",
      runnerSource: "docs/verification/fg4-github-hosted-runner-readback.json",
      orgNoLlmSource: "docs/verification/fg6-organization-runner-no-llm-readback.json"
    },
    evidence: {
      localCore: {
        commandCount: 10,
        providerEnvRemoved: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ARCHCONTEXT_TOKEN"],
        noLlmProviderRequired: true,
        localReviewComplete: true,
        completeResult: "pass",
        reviewResult: "pass",
        reviewErrors: 0
      },
      officialReviewAction: {
        workflow: {
          event: "pull_request",
          conclusion: "success",
          runUrl: "https://github.com/Ancienttwo/arch-context/actions/runs/27894392126"
        },
        artifact: {
          ok: true,
          environment: "github-actions",
          llmProviderConfigured: false,
          attestationTrustLevel: "organization",
          attestationResult: "pass",
          privacyAuditOk: true,
          verificationAccepted: true
        },
        organizationRunner: {
          checkName: "ArchContext / Organization Runner",
          conclusion: "success",
          outputTitle: "Organization-attested"
        }
      },
      deterministicGate: {
        providerEnvCleared: {
          OPENAI_API_KEY: true,
          ANTHROPIC_API_KEY: true,
          GOOGLE_API_KEY: true,
          MISTRAL_API_KEY: true
        },
        deterministicGate: {
          llmProviderConfigured: false,
          modelDigest: REVIEW_ACTION_NO_LLM_MODEL_DIGEST,
          result: "pass",
          reviewDigestMatchesAttestation: true
        },
        attestation: {
          accepted: true,
          result: "pass",
          runtimeBuildDigest: `sha256:${"8".repeat(64)}`,
          conclusionSource: "deterministic-gate"
        },
        advisory: {
          allowedAdvisoryCreated: true,
          deterministicReviewDigestMatches: true,
          injectedAdvisoryRejected: true,
          injectedAdvisoryReason: "llm-advisory-conclusion-field-forbidden: result,signature,checkConclusion"
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
      releaseAssertions: {
        organizationRunnerRequiredCheckPassed: true,
        noLlmProviderConfigured: true,
        organizationAttestationAccepted: true,
        developerAttestationCannotSatisfyOrganization: true,
        requiredContextBoundToArchContextApp: true
      },
      sourceInspections: {
        localNoCloud: { ok: true, failures: [] },
        runner: { ok: true, failures: [] },
        deterministic: { ok: true, failures: [] },
        orgNoLlm: { ok: true, failures: [] }
      },
      assertions: {
        localGateNoProviderRequired: true,
        officialReviewActionNoProviderRequired: true,
        deterministicConclusionUnchangedWithoutProvider: true,
        organizationRunnerNoProviderReleasePathVerified: true,
        attestationSubmittedFromDeterministicGate: true,
        advisoryCannotInfluenceConclusion: true,
        uploadPayloadProviderFree: true
      }
    },
    failures: []
  };
}
