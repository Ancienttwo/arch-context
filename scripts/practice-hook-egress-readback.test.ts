import { describe, expect, test } from "bun:test";
import { inspectPracticeHookEgress } from "./practice-hook-egress-readback.mjs";

describe("practice-hook-egress-readback", () => {
  test("accepts verified hook packet with zero network entries and local-only contracts", () => {
    expect(inspectPracticeHookEgress(verifiedPacket())).toMatchObject({
      ok: true,
      totalRequests: 0,
      dlp: { ok: true },
      failures: []
    });
  });

  test("rejects captured egress entries and network surfaces", () => {
    const packet = verifiedPacket({
      capture: {
        schemaVersion: "archcontext.local-egress-capture/v1",
        totalRequests: 1,
        entries: [{ method: "POST", url: "https://example.invalid/hook" }]
      }
    });

    const result = inspectPracticeHookEgress(packet);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("capture.totalRequests must be 0");
    expect(result.failures).toContain("capture.entries must be empty");
    expect(result.failures.some((failure: string) => failure.includes("network surface"))).toBe(true);
  });

  test("rejects raw changed path bodies in the packet", () => {
    const packet = verifiedPacket({
      hookCheckpoint: envelope("hook.checkpoint", {
        schemaVersion: "archcontext.practice-checkpoint/v1",
        reasonCode: "fresh",
        hook: { egress: "none", network: "forbidden" },
        hookLog: hookLog(false, {
          rawPathLeak: "src/example.ts"
        })
      })
    });

    const result = inspectPracticeHookEgress(packet);
    expect(result.ok).toBe(false);
    expect(result.failures.some((failure: string) => failure.includes("raw changed path body"))).toBe(true);
  });

  test("rejects hook and adapter contracts that stop declaring forbidden network", () => {
    const packet = verifiedPacket({
      hookCheckpoint: envelope("hook.checkpoint", {
        schemaVersion: "archcontext.practice-checkpoint/v1",
        reasonCode: "fresh",
        hook: { egress: "remote", network: "allowed" },
        hookLog: hookLog(false, { egress: "remote" })
      }),
      failOpenHook: envelope("hook.checkpoint", {
        schemaVersion: "archcontext.hook-checkpoint-fail-open/v1",
        failOpen: true,
        egress: "remote",
        network: "allowed",
        hookLog: hookLog(true, { network: "allowed" })
      }),
      hookAdapter: envelope("hooks.install", {
        ...adapterData(),
        entrypoint: {
          ...adapterData().entrypoint,
          egress: "remote",
          network: "allowed"
        }
      })
    });

    expect(inspectPracticeHookEgress(packet)).toMatchObject({
      ok: false,
      failures: [
        "hookCheckpoint.data.hook.egress must be none",
        "hookCheckpoint.data.hook.network must be forbidden",
        "hookCheckpoint.data.hookLog.egress must be none",
        "failOpenHook.data.egress must be none",
        "failOpenHook.data.network must be forbidden",
        "failOpenHook.data.hookLog.network must be forbidden",
        "hookAdapter.data.entrypoint.egress must be none",
        "hookAdapter.data.entrypoint.network must be forbidden"
      ]
    });
  });

  test("rejects packet-level source or diff payloads through shared DLP audit", () => {
    const packet = verifiedPacket({
      extraPayload: {
        sourceBody: "const secret = 1;",
        note: "diff body should not be exported"
      }
    });

    const result = inspectPracticeHookEgress(packet);
    expect(result.ok).toBe(false);
    expect(result.failures.some((failure: string) => failure.includes("DLP finding"))).toBe(true);
  });
});

function verifiedPacket(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "archcontext.practice-hook-egress-readback/v1",
    environment: "fixture",
    status: "verified",
    capture: {
      schemaVersion: "archcontext.local-egress-capture/v1",
      totalRequests: 0,
      entries: []
    },
    hookCheckpoint: envelope("hook.checkpoint", {
      schemaVersion: "archcontext.practice-checkpoint/v1",
      reasonCode: "fresh",
      hook: { egress: "none", network: "forbidden" },
      hookLog: hookLog(false)
    }),
    failOpenHook: envelope("hook.checkpoint", {
      schemaVersion: "archcontext.hook-checkpoint-fail-open/v1",
      failOpen: true,
      egress: "none",
      network: "forbidden",
      hookLog: hookLog(true)
    }),
    hookAdapter: envelope("hooks.install", adapterData()),
    assertions: {
      zeroNetworkEntries: true,
      hookCheckpointDeclaresNoEgress: true,
      failOpenDeclaresNoEgress: true,
      adapterDeclaresNoEgress: true,
      rawChangedPathBodyAbsent: true,
      sourceBodyAbsent: true
    },
    ...overrides
  };
}

function envelope(requestId: string, data: Record<string, unknown>) {
  return {
    schemaVersion: "archcontext.envelope/v1",
    ok: true,
    requestId,
    data
  };
}

function hookLog(failOpen: boolean, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "archcontext.hook-log/v1",
    event: "post-edit",
    elapsedMs: failOpen ? 1 : 3,
    pathCount: 1,
    changedPathDigest: failOpen
      ? "sha256:1d4407a90815a1ad3a1eed098f584542953a9a19b6d72b6c11bcec51a338f8bc"
      : "sha256:3f104fe1cd6368c3d911905fdf89c73f14630338847ef2c888a780fd27d2aef1",
    reasonCode: failOpen ? "runtime-unavailable" : "fresh",
    failOpen,
    egress: "none",
    network: "forbidden",
    ...overrides
  };
}

function adapterData() {
  return {
    schemaVersion: "archcontext.hook-adapter/v1",
    host: "codex",
    adapterName: "repo-harness-hook",
    ownership: "central-first",
    hookRuntime: "external-user-level",
    repoLocalRuntime: "not-vendored",
    entrypoint: {
      command: "archctx",
      args: ["hook", "checkpoint"],
      timeoutMs: 5000,
      failOpen: true,
      egress: "none",
      network: "forbidden"
    },
    acceptedInput: {
      eventFlag: "--event",
      changedPathFlags: ["--path", "--changed"],
      toolCallIdFlag: "--tool-call-id",
      taskSessionIdFlag: "--task-session-id"
    },
    output: {
      checkpointSchemaVersion: "archcontext.practice-checkpoint/v1",
      failOpenSchemaVersion: "archcontext.hook-checkpoint-fail-open/v1"
    },
    logContract: {
      schemaVersion: "archcontext.hook-log/v1",
      allowedFields: [
        "schemaVersion",
        "event",
        "elapsedMs",
        "pathCount",
        "changedPathDigest",
        "reasonCode",
        "failOpen",
        "egress",
        "network"
      ]
    },
    installed: true,
    writes: "manual-host-config"
  };
}
