import { describe, expect, test } from "bun:test";
import { inspectFg4SupplyChainNegativeReadback } from "./fg4-supply-chain-negative-readback";

describe("fg4 supply-chain negative readback evidence", () => {
  test("accepts verified preflight and tamper rejection evidence", () => {
    expect(inspectFg4SupplyChainNegativeReadback(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects missing negative cases and leaked material", () => {
    const recording = verifiedRecording();
    recording.evidence.baseline.attestationAccepted = false;
    recording.evidence.preflightCases = recording.evidence.preflightCases.filter((entry) => entry.name !== "runtime-artifact-url-invalid");
    recording.evidence.tamperCases[0].observedReasonCode = "";
    recording.evidence.allTamperRejectionsObserved = false;
    recording.evidence.leakCounters.plaintextNonceLeaks = 1;
    (recording.evidence as Record<string, unknown>).leaked = "nonce_fg4_supply_chain_secret";

    const result = inspectFg4SupplyChainNegativeReadback(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("baseline attestation must be accepted");
    expect(result.failures).toContain("missing preflight case: runtime-artifact-url-invalid");
    expect(result.failures).toContain("runtime-build-digest-mismatch must reject with SIGNATURE_INVALID");
    expect(result.failures).toContain("allTamperRejectionsObserved must be true");
    expect(result.failures).toContain("plaintextNonceLeaks must be 0");
    expect(result.failures).toContain("recording contains plaintext nonce marker");
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg4-supply-chain-negative-readback/v1",
    environment: "process-fixture",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-21T00:00:00.000Z",
    evidence: {
      processLevelFixture: true,
      baseline: {
        preflightOk: true,
        attestationAccepted: true,
        runtimeBuildDigest: `sha256:${"8".repeat(64)}`,
        payloadDigestMatchesAttestation: true,
        payloadPrivacyOk: true
      },
      preflightCases: [
        preflightCase("runtime-version-mismatch", "runtime-version-mismatch"),
        preflightCase("runtime-artifact-digest-invalid", "runtime-artifact-digest-invalid"),
        preflightCase("runtime-artifact-url-invalid", "runtime-artifact-url-invalid")
      ],
      tamperCases: [
        tamperCase("runtime-build-digest-mismatch"),
        tamperCase("run-attempt-mismatch")
      ],
      allPreflightRejectionsObserved: true,
      allTamperRejectionsObserved: true,
      leakCounters: {
        plaintextNonceLeaks: 0,
        privateKeyLeaks: 0,
        tokenLeaks: 0
      }
    },
    failures: []
  };
}

function preflightCase(name: string, reason: string) {
  return {
    name,
    expectedReason: reason,
    observedReason: reason,
    rejected: true
  };
}

function tamperCase(name: string) {
  return {
    name,
    expectedReasonCode: "SIGNATURE_INVALID",
    observedReasonCode: "SIGNATURE_INVALID",
    rejected: true
  };
}
