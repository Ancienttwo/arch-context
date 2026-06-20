import { describe, expect, test } from "bun:test";
import { inspectGitHubEgressRecording } from "./github-egress-recording-readback.mjs";

describe("github-egress-recording-readback", () => {
  test("allows pending staging recording only when explicitly allowed", () => {
    const recording = {
      schemaVersion: "archcontext.github-egress-recording/v1",
      environment: "staging",
      status: "pending",
      reason: "Awaiting deployed staging GitHub App and sanitized egress export."
    };

    expect(inspectGitHubEgressRecording(recording)).toMatchObject({
      ok: false,
      pending: true,
      blockers: ["Awaiting deployed staging GitHub App and sanitized egress export."]
    });
    expect(inspectGitHubEgressRecording(recording, { allowPending: true })).toMatchObject({
      ok: true,
      pending: true
    });
  });

  test("accepts verified staging recording with only allowlisted egress and zero privacy hits", () => {
    expect(inspectGitHubEgressRecording(verifiedRecording())).toMatchObject({
      ok: true,
      pending: false,
      totalRequests: 3,
      failures: []
    });
  });

  test("rejects forbidden endpoint media and bait hit counts", () => {
    const recording = verifiedRecording({
      forbiddenEndpointCounts: { prFiles: 1, contents: 0, blob: 0, tree: 0 },
      forbiddenMediaTypeCounts: { diff: 0, patch: 1 },
      baitHits: { log: 0, trace: 1, queue: 0 }
    });

    expect(inspectGitHubEgressRecording(recording)).toMatchObject({
      ok: false,
      failures: [
        "forbiddenEndpointCounts.prFiles must be 0",
        "forbiddenMediaTypeCounts.patch must be 0",
        "baitHits.trace must be 0"
      ]
    });
  });

  test("rejects unexpected GitHub egress categories and empty recordings", () => {
    const recording = verifiedRecording({
      githubEgress: {
        totalRequests: 0,
        categories: {
          "github.pull-files": 1
        }
      }
    });

    expect(inspectGitHubEgressRecording(recording)).toMatchObject({
      ok: false,
      failures: [
        "githubEgress.totalRequests must be a positive integer",
        "unexpected GitHub egress category: github.pull-files"
      ]
    });
  });
});

function verifiedRecording(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "archcontext.github-egress-recording/v1",
    environment: "staging",
    status: "verified",
    recording: {
      recordedAt: "2026-06-20T14:30:00Z",
      githubEgress: {
        totalRequests: 3,
        categories: {
          "github.pull-head": 1,
          "github.check-create": 1,
          "github.check-update": 1
        }
      },
      forbiddenEndpointCounts: { prFiles: 0, contents: 0, blob: 0, tree: 0 },
      forbiddenMediaTypeCounts: { diff: 0, patch: 0 },
      baitHits: { log: 0, trace: 0, queue: 0 },
      ...overrides
    }
  };
}
