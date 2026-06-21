import { describe, expect, test } from "bun:test";
import { inspectFg4DeterministicConclusionReadback } from "./fg4-deterministic-conclusion-readback";
import { REVIEW_ACTION_NO_LLM_MODEL_DIGEST } from "@archcontext/cloud/runner";

describe("fg4 deterministic conclusion readback evidence", () => {
  test("accepts verified deterministic conclusion evidence", () => {
    expect(inspectFg4DeterministicConclusionReadback(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects provider, advisory, upload, and nonce leaks", () => {
    const recording = verifiedRecording();
    recording.evidence.providerEnvCleared.OPENAI_API_KEY = false;
    recording.evidence.deterministicGate.modelDigest = "sha256:wrong";
    recording.evidence.attestation.result = "fail_action_required";
    recording.evidence.advisory.injectedAdvisoryRejected = false;
    recording.evidence.upload.containsAdvisory = true;
    recording.evidence.leakCounters.plaintextNonceLeaks = 1;
    (recording.evidence as Record<string, unknown>).leaked = "nonce_fg4_deterministic_conclusion_secret";

    const result = inspectFg4DeterministicConclusionReadback(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("OPENAI_API_KEY must be cleared");
    expect(result.failures).toContain("model digest must be no-provider digest");
    expect(result.failures).toContain("attestation result must match deterministic result");
    expect(result.failures).toContain("injected advisory must be rejected");
    expect(result.failures).toContain("upload must not contain advisory");
    expect(result.failures).toContain("plaintextNonceLeaks must be 0");
    expect(result.failures).toContain("recording contains plaintext nonce marker");
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg4-deterministic-conclusion-readback/v1",
    environment: "process-fixture",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-21T00:00:00.000Z",
    evidence: {
      processLevelFixture: true,
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
        injectedAdvisoryReason: "llm-advisory-conclusion-field-forbidden: result"
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
    failures: []
  };
}
