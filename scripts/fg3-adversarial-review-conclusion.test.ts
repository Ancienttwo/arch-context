import { describe, expect, test } from "bun:test";
import { CALLER_PROVIDED_ATTESTATION_FIELDS } from "@archcontext/contracts";
import { inspectFg3AdversarialReviewConclusion } from "./fg3-adversarial-review-conclusion";

describe("fg3 adversarial review conclusion evidence", () => {
  test("accepts sanitized adversarial review conclusion evidence", () => {
    expect(inspectFg3AdversarialReviewConclusion(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects weak adversarial proof and forged marker leakage", () => {
    const recording = verifiedRecording();
    recording.evidence.runtimeCompleteTask.deniedCases = recording.evidence.runtimeCompleteTask.deniedCases
      .filter((entry) => entry.field !== "result");
    recording.evidence.cli.deniedCases[0].reasonCode = "OK";
    recording.evidence.mcp.legalResult = "fail_action_required";
    recording.evidence.leakCounters.forgedMarkerLeaks = 1;
    (recording.evidence as Record<string, unknown>).note = "forged-adversarial-review-conclusion";

    const result = inspectFg3AdversarialReviewConclusion(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("runtimeCompleteTask missing denied case: result");
    expect(result.failures).toContain("cli result must return AC_SCHEMA_INVALID");
    expect(result.failures).toContain("mcp legal result must be pass");
    expect(result.failures).toContain("forgedMarkerLeaks must be 0");
    expect(result.failures).toContain("recording contains forged marker");
  });
});

function verifiedRecording() {
  const deniedFields = [...CALLER_PROVIDED_ATTESTATION_FIELDS];
  const reviewEngineDeniedFields = deniedFields.filter((field) => field !== "modelDigest" && field !== "practiceEnforcement");
  return {
    schemaVersion: "archcontext.fg3-adversarial-review-conclusion/v1",
    environment: "process-fixture",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-20T21:10:00.000Z",
    evidence: {
      processLevelFixture: true,
      deniedFields,
      contract: {
        denied: true,
        deniedFields,
        messageIncludesAllFields: true
      },
      reviewEngine: {
        legalResult: "pass",
        deniedCases: cases(reviewEngineDeniedFields)
      },
      runtimeCompleteTask: {
        legalResult: "pass",
        persistedLegalResult: "pass",
        deniedCases: cases(deniedFields)
      },
      cli: {
        deniedCases: cases(deniedFields, "AC_SCHEMA_INVALID")
      },
      mcp: {
        legalResult: "pass",
        deniedCases: cases(deniedFields, "AC_SCHEMA_INVALID")
      },
      developerReviewAttestation: {
        deniedCases: cases(deniedFields)
      },
      allAdversarialInputsDenied: true,
      leakCounters: {
        forgedMarkerLeaks: 0,
        privateKeyLeaks: 0,
        keyRefLeaks: 0,
        nonceSecretLeaks: 0
      }
    },
    failures: []
  };
}

function cases(fields: readonly string[], reasonCode?: string) {
  return fields.map((field) => ({
    field,
    denied: true,
    ...(reasonCode ? { reasonCode } : {}),
    messageIncludesField: true
  }));
}
