import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl9CompleteTaskProvenanceReadback } from "./architecture-ledger-al9-complete-task-provenance-readback";

describe("AL9 complete task projection gate and agent draft provenance readback", () => {
  test("accepts a complete AL9 closeout readback packet", () => {
    const packet = completePacket();
    const result = inspectArchitectureLedgerAl9CompleteTaskProvenanceReadback(packet);

    expect(result.ok).toBe(true);
    expect(result.status).toBe("verified");
  });

  test("rejects missing complete_task and agent provenance assertions", () => {
    const packet = completePacket();
    packet.assertions["AL9-EG4"] = false;
    packet.agentDraft.traceableToJobAndInputDigest = false;
    const result = inspectArchitectureLedgerAl9CompleteTaskProvenanceReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("AL9-EG4 assertion failed");
  });
});

function completePacket(): any {
  return {
    schemaVersion: "archcontext.architecture-ledger-al9-complete-task-provenance-readback/v1",
    generatedAt: "1970-01-01T00:00:00.000Z",
    gates: ["AL9-09", "AL9-10", "AL9-14", "AL9-16", "AL9-EG1", "AL9-EG4", "AL9-EG5"],
    completeTask: {
      acceptedProjectionManifestPresent: true,
      blocksDriftBeforeProjectionApply: true,
      projectionApplySucceeded: true,
      postApplyDriftOk: true,
      passesAfterProjectionApply: true,
      completeProjectionDriftClean: true
    },
    agentDraft: {
      validDraftReferencesSelectedDelta: true,
      invalidDraftRejected: true,
      advisoryOnly: true,
      acceptedProjection: false,
      forbidsDirectDocWrites: true,
      traceableToJobAndInputDigest: true
    },
    runbook: {
      path: "docs/runbooks/architecture-documentation-projections.md",
      present: true
    },
    privacy: {
      rawSourcePersisted: false,
      forbiddenKeys: []
    },
    assertions: {
      "AL9-09": true,
      "AL9-10": true,
      "AL9-14": true,
      "AL9-16": true,
      "AL9-EG1": true,
      "AL9-EG4": true,
      "AL9-EG5": true
    }
  };
}
