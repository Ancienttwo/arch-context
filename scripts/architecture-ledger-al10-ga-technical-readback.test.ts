import { describe, expect, test } from "bun:test";
import { inspectArchitectureLedgerAl10GaTechnicalReadback } from "./architecture-ledger-al10-ga-technical-readback";

describe("AL10 GA technical readback", () => {
  test("accepts a complete GA technical packet", () => {
    const result = inspectArchitectureLedgerAl10GaTechnicalReadback(completePacket());

    expect(result.ok).toBe(true);
    const gates = result.gates as Record<string, string>;
    expect(gates["AL10-GA-1"]).toBe("verified");
    expect(gates["AL10-GA-5"]).toBe("verified");
  });

  test("rejects event loss, duplication, and over-budget incremental analysis", () => {
    const packet = completePacket();
    packet.stress.lostEventCount = 1;
    packet.stress.duplicateEventCount = 1;
    packet.incrementalAnalysis.p95Ms = 2_001;
    packet.incrementalAnalysis.nonCoalescedSampleCount = 4;
    packet.assertions["AL10-GA-1"] = false;
    packet.assertions["AL10-GA-3"] = false;

    const result = inspectArchitectureLedgerAl10GaTechnicalReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("stress lost event count must be 0");
    expect(result.failures).toContain("stress duplicate event count must be 0");
    expect(result.failures).toContain("incremental analysis p95 exceeds GA budget");
    expect(result.failures).toContain("incremental analysis samples must not be coalesced");
  });

  test("rejects missing security coverage and hard-gate false positives", () => {
    const packet = completePacket();
    packet.security.requiredCases[0].ok = false;
    packet.security.verifiedCaseCount = 4;
    packet.security.passRate = 0.8;
    packet.recommendations.hardGateFalsePositiveRate = 0.1;
    packet.assertions["AL10-GA-4"] = false;
    packet.assertions["AL10-GA-5"] = false;

    const result = inspectArchitectureLedgerAl10GaTechnicalReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("security verified case count mismatch");
    expect(result.failures).toContain("security pass rate must be 1");
    expect(result.failures).toContain("security case must pass: stale-replay");
    expect(result.failures).toContain("hard gate false positive rate must be 0");
  });

  test("rejects runtime SQLite privacy hits and subagent mutation gaps", () => {
    const packet = completePacket();
    packet.runtimeStatePrivacy.forbiddenRawContentHitCount = 1;
    packet.runtimeStatePrivacy.clean = false;
    packet.subagentMutation.directMutationAttempt.rejected = false;
    packet.subagentMutation.proposalOnlyJob.accepted = false;
    packet.assertions.runtimeSqlitePayloadPrivacyVerified = false;
    packet.assertions.subagentDirectMutationRejected = false;
    packet.assertions.noPrivateContent = false;

    const result = inspectArchitectureLedgerAl10GaTechnicalReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("runtime SQLite payload privacy audit must be clean");
    expect(result.failures).toContain("runtime SQLite forbidden raw content hit count must be 0");
    expect(result.failures).toContain("subagent direct mutation attempt must be rejected");
    expect(result.failures).toContain("proposal-only subagent job must be accepted");
    expect(result.failures).toContain("assertions.runtimeSqlitePayloadPrivacyVerified must be true");
    expect(result.failures).toContain("assertions.subagentDirectMutationRejected must be true");
  });

  test("rejects gate overclaim", () => {
    const packet = completePacket();
    packet.gates.push("AL10-GA-6");
    packet.scope.closedGates.push("AL10-GA-6");
    packet.assertions["AL10-GA-6"] = true;

    const result = inspectArchitectureLedgerAl10GaTechnicalReadback(packet);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("gates must be exactly AL10-GA-1 through AL10-GA-5");
    expect(result.failures).toContain("scope.closedGates must be exactly AL10-GA-1 through AL10-GA-5");
    expect(result.failures).toContain("unexpected gate assertion: AL10-GA-6");
  });
});

function completePacket(): any {
  const gates = ["AL10-GA-1", "AL10-GA-2", "AL10-GA-3", "AL10-GA-4", "AL10-GA-5"];
  return {
    schemaVersion: "archcontext.architecture-ledger-al10-ga-technical-readback/v1",
    generatedAt: "1970-01-01T00:00:00.000Z",
    gates,
    status: "verified",
    scope: {
      closedGates: [...gates],
      explicitlyOpen: ["AL10-14", "AL10-GA-6", "AL10-GA-7"]
    },
    readbackDigest: `sha256:${"a".repeat(64)}`,
    sourceReadbacks: [
      source("representative-benchmark"),
      source("chaos-security"),
      source("recommendation-quality")
    ],
    stress: {
      eventCount: 10000,
      appendedEventCount: 10000,
      replayEventCount: 10000,
      uniqueEventIds: 10000,
      lostEventCount: 0,
      duplicateEventCount: 0,
      integrityOk: true
    },
    performance: {
      representativeFixtureCount: 3,
      warmQueryP95Ms: 96.8
    },
    incrementalAnalysis: {
      changedFileCount: 200,
      sampleCount: 5,
      p95Ms: 125,
      failedSampleCount: 0,
      nonCoalescedSampleCount: 5
    },
    security: {
      requiredCases: [
        securityCase("stale-replay"),
        securityCase("event-tamper"),
        securityCase("path-traversal"),
        securityCase("symlink-escape"),
        securityCase("forged-evidence")
      ],
      requiredCaseCount: 5,
      verifiedCaseCount: 5,
      passRate: 1
    },
    recommendations: {
      heuristicOnlyHardGateRate: 0,
      dynamicDocHardGateRate: 0,
      hardGateFalsePositiveRate: 0,
      failedEvalGateCount: 0
    },
    runtimeStatePrivacy: {
      databasePath: "$TMPDIR/archctx-al10-ga-stress/runtime.sqlite",
      tableCount: 12,
      jsonColumnCount: 8,
      scannedCellCount: 24,
      tableSummaries: [
        {
          table: "architecture_events",
          jsonColumns: ["event_json", "payload_json", "provenance_json"],
          rowCount: 10,
          scannedCellCount: 30
        }
      ],
      forbiddenRawContentHitCount: 0,
      forbiddenSecretHitCount: 0,
      rawContentHits: [],
      secretHits: [],
      clean: true
    },
    subagentMutation: {
      directMutationAttempt: {
        jobId: "agent_job.al10_ga_direct-mutation",
        rejected: true,
        reasonCode: "runtime-agent-job-direct-mutation-forbidden",
        queueRowsAfterRejected: 0,
        architectureEventRowsUnchanged: true
      },
      proposalOnlyJob: {
        jobId: "agent_job.al10_ga_proposal-only",
        accepted: true,
        status: "queued",
        directMutationAllowed: false,
        queueRowsAfterAccepted: 1,
        persistedJobJsonDigest: `sha256:${"c".repeat(64)}`,
        architectureEventRowsUnchanged: true
      }
    },
    privacy: {
      forbiddenSecretHitCount: 0,
      forbiddenRawContentHitCount: 0,
      secretHits: [],
      rawContentHits: [],
      clean: true
    },
    assertions: {
      "AL10-GA-1": true,
      "AL10-GA-2": true,
      "AL10-GA-3": true,
      "AL10-GA-4": true,
      "AL10-GA-5": true,
      sourceReadbacksVerified: true,
      runtimeSqlitePayloadPrivacyVerified: true,
      subagentDirectMutationRejected: true,
      openGatesPreserved: true,
      noPrivateContent: true
    }
  };
}

function source(id: string): any {
  return {
    id,
    path: `docs/verification/${id}.json`,
    sha256: `sha256:${"b".repeat(64)}`,
    status: "verified",
    gates: ["AL10"],
    missingTerms: [],
    verified: true
  };
}

function securityCase(caseId: string): any {
  return {
    caseId,
    ok: true,
    reasonCode: caseId,
    guard: caseId
  };
}
