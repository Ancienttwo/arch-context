import { describe, expect, test } from "bun:test";
import { inspectFg5CheckFailureReadback } from "./fg5-check-failure-readback";

describe("fg5 Check failure readback evidence", () => {
  test("accepts sanitized staging retry DLQ replay evidence", () => {
    expect(inspectFg5CheckFailureReadback(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects missing DLQ replay and secret markers", () => {
    const recording = verifiedRecording();
    recording.evidence.retry.maxAttemptsReached = false;
    recording.evidence.deadLetter.status = "RETRYING";
    recording.evidence.replay.replayed = false;
    recording.evidence.queue.replayEnqueued = false;
    recording.privacy.privateContentHits = 1;
    (recording.config as Record<string, unknown>).note = "Bearer ghs_private_token";

    const result = inspectFg5CheckFailureReadback(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("retry.maxAttemptsReached must be true");
    expect(result.failures).toContain("deadLetter.status must be DEAD_LETTER");
    expect(result.failures).toContain("replay.replayed must be true");
    expect(result.failures).toContain("queue.replayEnqueued must be true");
    expect(result.failures).toContain("privacy.privateContentHits must be 0");
    expect(result.failures.some((failure) => failure.includes("forbidden secret marker"))).toBe(true);
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg5-check-failure-readback/v1",
    environment: "staging",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T01:02:03.000Z",
    route: "/v1/fg5/check-delivery/failure-injection",
    config: {
      envFile: "_ops/env/fg2-staging.env",
      output: "docs/verification/fg5-check-failure-readback.json",
      stagingUrl: "https://archcontext.repoharness.com"
    },
    evidence: {
      checkApiFailureInjected: true,
      checkDeliveryId: "chkdel_fixture",
      challengeId: "chal_fg5_eg3_check_failure",
      checkName: "ArchContext / Developer Review",
      headSha: "ffffffffffffffffffffffffffffffffffffffff",
      injectedGitHubApiFailures: [
        {
          operation: "github.check-update",
          pathTemplate: "/repositories/{repository_id}/check-runs/{check_run_id}",
          statusCode: 503,
          retryAfterSeconds: 2
        },
        {
          operation: "github.check-update",
          pathTemplate: "/repositories/{repository_id}/check-runs/{check_run_id}",
          statusCode: 503,
          retryAfterSeconds: null
        }
      ],
      retry: {
        policy: {
          maxAttempts: 3,
          baseDelaySeconds: 1,
          maxDelaySeconds: 5,
          jitterRatio: 0
        },
        scheduled: [
          {
            retry: true,
            reason: "retry-scheduled",
            status: "RETRYING",
            attemptCount: 1,
            maxAttempts: 3,
            delaySeconds: 2,
            retryAfterDelaySeconds: 2,
            nextAttemptAt: "2026-06-22T01:02:06.000Z",
            lastErrorCode: null,
            queueMessageDigest: `sha256:${"1".repeat(64)}`
          },
          {
            retry: true,
            reason: "retry-scheduled",
            status: "RETRYING",
            attemptCount: 2,
            maxAttempts: 3,
            delaySeconds: 2,
            retryAfterDelaySeconds: null,
            nextAttemptAt: "2026-06-22T01:02:08.000Z",
            lastErrorCode: null,
            queueMessageDigest: `sha256:${"2".repeat(64)}`
          }
        ],
        maxAttemptsReached: true,
        maxAttemptDecision: {
          retry: false,
          reason: "check-delivery-max-attempts-reached",
          attemptCount: 3,
          maxAttempts: 3
        }
      },
      deadLetter: {
        status: "DEAD_LETTER",
        attemptCount: 2,
        lastErrorCode: "CHECK_DELIVERY_MAX_ATTEMPTS",
        nextAttemptAt: null,
        updatedAt: "2026-06-22T01:02:10.000Z"
      },
      replay: {
        replayed: true,
        source: "manual-ops",
        replayDigest: `sha256:${"3".repeat(64)}`,
        statusAfterReplay: "PENDING",
        attemptCountAfterReplay: 0,
        lastErrorCodeAfterReplay: null
      },
      queue: {
        schemaVersion: "archcontext.check-delivery-queue-message/v1",
        retryEnqueueCount: 2,
        replayEnqueued: true,
        replayMessageDigest: `sha256:${"4".repeat(64)}`,
        sentMessages: [
          {
            message: {
              schemaVersion: "archcontext.check-delivery-queue-message/v1",
              deliveryId: "chkdel_fixture",
              challengeId: "chal_fg5_eg3_check_failure",
              checkName: "ArchContext / Developer Review",
              headSha: "ffffffffffffffffffffffffffffffffffffffff",
              status: "RETRYING",
              attempt: 1,
              payloadDigest: `sha256:${"5".repeat(64)}`
            },
            options: { delaySeconds: 2 }
          },
          {
            message: {
              schemaVersion: "archcontext.check-delivery-queue-message/v1",
              deliveryId: "chkdel_fixture",
              challengeId: "chal_fg5_eg3_check_failure",
              checkName: "ArchContext / Developer Review",
              headSha: "ffffffffffffffffffffffffffffffffffffffff",
              status: "RETRYING",
              attempt: 2,
              payloadDigest: `sha256:${"5".repeat(64)}`
            },
            options: { delaySeconds: 2 }
          },
          {
            message: {
              schemaVersion: "archcontext.check-delivery-queue-message/v1",
              deliveryId: "chkdel_fixture",
              challengeId: "chal_fg5_eg3_check_failure",
              checkName: "ArchContext / Developer Review",
              headSha: "ffffffffffffffffffffffffffffffffffffffff",
              status: "PENDING",
              attempt: 0,
              payloadDigest: `sha256:${"5".repeat(64)}`
            },
            options: null
          }
        ]
      }
    },
    privacy: {
      privateContentHits: 0,
      secretMarkerHits: 0,
      forbiddenEndpointOrMediaHits: 0,
      forbiddenKeys: []
    },
    failures: []
  };
}
