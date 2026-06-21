import { describe, expect, test } from "bun:test";
import { inspectFg3AttestationSecuritySuite } from "./fg3-attestation-security-suite";

describe("fg3 attestation security suite evidence", () => {
  test("accepts sanitized attestation security suite evidence", () => {
    expect(inspectFg3AttestationSecuritySuite(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects missing security cases and nonce leaks", () => {
    const recording = verifiedRecording();
    recording.evidence.cases = recording.evidence.cases.filter((entry) => entry.name !== "revoked-device-key");
    recording.evidence.cases[0].consumedSetPreserved = false;
    recording.evidence.baseline.plaintextNonceInNonceHash = true;
    recording.evidence.leakCounters.plaintextNonceLeaks = 1;
    (recording.evidence as Record<string, unknown>).note = "nonce_fg3_security_secret";

    const result = inspectFg3AttestationSecuritySuite(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("missing security case: revoked-device-key");
    expect(result.failures).toContain("replay-nonce-reuse must preserve consumed nonce set");
    expect(result.failures).toContain("baseline nonce hash must not contain plaintext nonce");
    expect(result.failures).toContain("plaintextNonceLeaks must be 0");
    expect(result.failures).toContain("recording contains plaintext nonce marker");
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg3-attestation-security-suite/v1",
    environment: "process-fixture",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-20T21:15:00.000Z",
    evidence: {
      processLevelFixture: true,
      baseline: {
        accepted: true,
        challengeStatus: "SUBMITTED",
        nonceHashRecorded: true,
        plaintextNonceInNonceHash: false
      },
      cases: [
        securityCase("replay-nonce-reuse", "CHALLENGE_ALREADY_CONSUMED", true),
        securityCase("challenge-expired", "CHALLENGE_EXPIRED", false),
        securityCase("attestation-expired", "CHALLENGE_EXPIRED", false),
        securityCase("revoked-device-key", "DEVICE_REVOKED", false),
        securityCase("nonce-mismatch", "NONCE_MISMATCH", false)
      ],
      allRejected: true,
      noUnexpectedNonceConsumption: true,
      leakCounters: {
        plaintextNonceLeaks: 0,
        privateKeyLeaks: 0,
        signatureLeaks: 0
      }
    },
    failures: []
  };
}

function securityCase(name: string, reasonCode: string, nonceHashConsumed: boolean) {
  return {
    name,
    expectedReasonCode: reasonCode,
    observedReasonCode: reasonCode,
    rejected: true,
    nonceHashConsumed,
    consumedSetPreserved: true
  };
}
