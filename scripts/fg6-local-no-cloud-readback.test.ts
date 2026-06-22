import { describe, expect, test } from "bun:test";
import { inspectFg6LocalNoCloud } from "./fg6-local-no-cloud-readback";

describe("fg6 local no-cloud readback evidence", () => {
  test("accepts AC-01 local first-experience evidence", () => {
    expect(inspectFg6LocalNoCloud(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects missing MCP/task lifecycle and secret markers", () => {
    const recording = verifiedRecording();
    recording.evidence.localEvidence.commands = recording.evidence.localEvidence.commands.filter((command) => command !== "mcp install");
    recording.evidence.localEvidence.taskLifecycle.checkpointFresh = false;
    (recording.evidence.localEvidence.paths as Record<string, unknown>).note = "Bearer ghs_private_token";

    const result = inspectFg6LocalNoCloud(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("local command missing: mcp install");
    expect(result.failures).toContain("checkpoint must be fresh");
    expect(result.failures.some((failure) => failure.includes("forbidden secret marker"))).toBe(true);
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg6-local-no-cloud-readback/v1",
    acceptanceId: "AC-01",
    environment: "local-release-readback",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T05:30:00.000Z",
    command: "node scripts/local-no-cloud-e2e.mjs",
    evidence: {
      localEvidence: {
        schemaVersion: "archcontext.local-no-cloud-e2e/v1",
        commands: ["doctor", "mcp install", "init", "sync", "context", "prepare", "status", "checkpoint", "complete", "review"],
        providerEnvRemoved: ["GH_TOKEN", "OPENAI_API_KEY"],
        git: {
          headSha: "a".repeat(40)
        },
        egress: {
          defaultOutbound: "local-only",
          cloudContentUpload: "deny",
          secureMcpTunnel: "disabled-by-default",
          thirdPartyTelemetry: "disabled"
        },
        mcp: {
          host: "codex",
          command: "archctx",
          args: ["mcp"]
        },
        taskLifecycle: {
          preparePosture: "clean",
          checkpointFresh: true,
          completeSchemaVersion: "archcontext.review/v1",
          completeResult: "pass"
        },
        review: {
          schemaVersion: "archcontext.review/v1",
          result: "pass",
          errors: 0,
          warnings: 0
        },
        paths: {
          repo: "$TMPDIR/archctx-local-no-cloud-fixture",
          bin: "/repo/node_modules/.bin/archctx"
        }
      },
      assertions: {
        noGitHubAppRequired: true,
        noArchContextCloudTokenRequired: true,
        noLlmProviderRequired: true,
        localMcpConfigured: true,
        agentTaskLifecycleComplete: true,
        localReviewComplete: true
      }
    },
    failures: []
  };
}
