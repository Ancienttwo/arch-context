import { describe, expect, test } from "bun:test";
import { inspectFg2InstallRevokeReadback } from "./fg2-install-revoke-readback.mjs";

describe("fg2-install-revoke-readback", () => {
  test("accepts sanitized verified install revoke readback", () => {
    expect(inspectFg2InstallRevokeReadback(verifiedRecording())).toEqual({
      ok: true,
      failures: []
    });
  });

  test("rejects persisted secret material", () => {
    const recording = verifiedRecording({
      operations: {
        revoke: {
          leakedAuthorization: "Bearer ghs_abcdefghijklmnopqrstuvwxyz123456"
        }
      }
    });

    const result = inspectFg2InstallRevokeReadback(recording);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("GitHub token value must not be persisted");
  });

  test("requires restore after reversible suspend readback", () => {
    const recording = verifiedRecording({
      evidence: {
        ...verifiedRecording().evidence,
        restoredAfterReadback: false
      }
    });

    expect(inspectFg2InstallRevokeReadback(recording)).toMatchObject({
      ok: false,
      failures: ["evidence.restoredAfterReadback must be true"]
    });
  });
});

function verifiedRecording(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "archcontext.fg2-install-revoke-readback/v1",
    environment: "staging",
    status: "verified",
    evidence: {
      installationRevoked: true,
      tokenRejectedAfterRevoke: true,
      challengeCreationStopped: true,
      checkUpdateStopped: true,
      restoredAfterReadback: true
    },
    secretValuesPersisted: false,
    privateContentPersisted: false,
    operations: {},
    ...overrides
  };
}
