import { describe, expect, test } from "bun:test";
import { inspectFg6PrivacyDlpReadback } from "./fg6-privacy-dlp-readback";

describe("fg6 privacy DLP readback evidence", () => {
  test("accepts AC-05 static, dynamic, and storage DLP evidence", () => {
    expect(inspectFg6PrivacyDlpReadback(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects static findings, code-content routes, storage leaks, and failed source inspections", () => {
    const recording: any = verifiedRecording();
    recording.evidence.staticPrivacyContract.ok = false;
    recording.evidence.staticPrivacyContract.findingCount = 1;
    recording.evidence.dynamicCloud.egress.unexpectedCategories = ["github.contents"];
    recording.evidence.dynamicCloud.workerLeak = {
      sourceCode: "diff --git a/private.ts b/private.ts",
      pathTemplate: "/repositories/{repository_id}/contents/{path}"
    };
    recording.evidence.storageAndControlPlane.scans.queue.codeContentMatches = 1;
    recording.evidence.sourceInspections.fg3CloudDlp.ok = false;
    recording.evidence.assertions.allCodeContentRoutesZero = false;

    const result = inspectFg6PrivacyDlpReadback(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("static Privacy Contract audit must pass");
    expect(result.failures).toContain("static Privacy Contract findingCount must be 0");
    expect(result.failures).toContain("dynamicCloud egress unexpectedCategories must be empty");
    expect(result.failures).toContain("storage queue.codeContentMatches must be 0");
    expect(result.failures).toContain("fg3CloudDlp source inspection must pass");
    expect(result.failures).toContain("assertion allCodeContentRoutesZero must be true");
    expect(result.failures.some((failure) => failure.includes("forbidden code-content marker"))).toBe(true);
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg6-privacy-dlp-readback/v1",
    acceptanceId: "AC-05",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T08:00:00.000Z",
    sources: {
      fg3CloudDlpSource: "docs/verification/fg3-cloud-dlp-readback.json",
      fg4RunnerDlpSource: "docs/verification/fg4-runner-dlp-readback.json",
      fg5FullPlaneDlpSource: "docs/verification/fg5-full-plane-dlp-readback.json"
    },
    evidence: {
      staticPrivacyContract: {
        command: "bun run verify:privacy-contract",
        scanRoots: ["packages/cloud", "packages/contracts/src"],
        scannedFiles: 18,
        ok: true,
        findingCount: 0
      },
      dynamicCloud: {
        dtoScan: {
          surfaces: ["log", "trace", "queue", "error", "notification", "egress"],
          baitValueMatches: 0,
          forbiddenKeyRetained: 0,
          notificationMinimalRejectedBait: true,
          egressSchemaRejectedBait: true
        },
        egress: {
          totalRecordedRequests: 13,
          categories: {
            "github.pull-head": 3,
            "github.check-create": 5,
            "github.check-update": 5
          },
          unexpectedCategories: [],
          forbiddenEndpointOrMediaMatches: 0
        },
        tail: {
          egressEnvelopeMatches: 8,
          acceptedWebhookLogMatches: 0,
          baitValueMatches: 0,
          baitMarkerMatches: 0,
          forbiddenEndpointOrMediaMatches: 0
        }
      },
      runnerDynamic: {
        artifact: zeroRunnerScan({ fileCount: 1, totalBytes: 9987 }),
        log: zeroRunnerScan({ lineCount: 301, maskedTokenMentions: 2 }),
        cache: zeroRunnerScan({ cacheLineCount: 6 }),
        cloudDto: {
          egressCategories: ["github.pull-head", "github.check-create", "github.check-update"],
          ...zeroRunnerScan()
        }
      },
      storageAndControlPlane: {
        database: {
          schemaPrivacyOk: true,
          tableCount: 13,
          rowCount: 11,
          tables: [
            { name: "accounts", rowCount: 1 },
            { name: "attestations", rowCount: 1 },
            { name: "check_deliveries", rowCount: 1 },
            { name: "review_challenges", rowCount: 1 },
            { name: "webhook_deliveries", rowCount: 1 }
          ]
        },
        exports: {
          logRecordCount: 1,
          traceRecordCount: 1,
          queueRecordCount: 2,
          errorRecordCount: 1,
          queueHasCheckDeliveryMessage: true
        },
        scans: {
          database: zeroStorageScan("database", 11),
          log: zeroStorageScan("log", 1),
          trace: zeroStorageScan("trace", 1),
          queue: zeroStorageScan("queue", 2),
          error: zeroStorageScan("error", 1)
        }
      },
      sourceInspections: {
        fg3CloudDlp: { ok: true, failures: [] },
        fg4RunnerDlp: { ok: true, failures: [] },
        fg5FullPlaneDlp: { ok: true, failures: [] }
      },
      assertions: {
        staticGitHubApiAllowlistPassed: true,
        dynamicGitHubClientNoCodeEndpointCalls: true,
        runnerArtifactLogCacheDlpZero: true,
        workerQueueD1LogStorageDlpZero: true,
        databaseSchemaPrivacyOk: true,
        queueSerializationDlpZero: true,
        allCodeContentRoutesZero: true
      }
    },
    failures: []
  };
}

function zeroRunnerScan(extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    codeContentMatches: 0,
    baitValueMatches: 0,
    forbiddenEndpointOrMediaMatches: 0,
    secretMatches: 0
  };
}

function zeroStorageScan(surface: string, exportedRecordCount: number) {
  return {
    surface,
    exportedRecordCount,
    codeContentMatches: 0,
    baitValueMatches: 0,
    forbiddenKeyMatches: 0,
    forbiddenEndpointOrMediaMatches: 0,
    secretMatches: 0
  };
}
