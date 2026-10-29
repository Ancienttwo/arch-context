import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { RuntimeRpcClient } from "../src/rpc-client";
import { RUNTIME_RPC_METHODS } from "../src/rpc-methods";
import { ArchctxRuntimeRpcServer } from "../src/rpc-server";
import { createInitializedGitRepo, createStartedTestDaemon, removeTempPath, removeTempRepo } from "./runtime-test-fixtures";

// JSON turns omitted tuple members into null; handlers must receive undefined so their defaults run.
test("prepare restores the omitted session after encode → JSON → decode", () => {
  const params = JSON.parse(JSON.stringify(RUNTIME_RPC_METHODS.prepare.encodeArgs("/fixture", "task-A")));
  expect(params).toEqual(["/fixture", "task-A", 12_288, 12, null]);
  expect(RUNTIME_RPC_METHODS.prepare.decodeArgs(params)).toEqual(["/fixture", "task-A", 12_288, 12, undefined]);
});

for (const transport of ["embedded", "json", "http"] as const) {
  for (const explicitSession of [false, true]) {
    test(`${transport} prepare ${explicitSession ? "explicit" : "default"} session seeds the next practice checkpoint`, async () => {
      const root = createInitializedGitRepo();
      const stateRoot = mkdtempSync(join(tmpdir(), "archctx-rpc-prepare-session-"));
      const store = new TestLocalStore();
      const daemon = await createStartedTestDaemon({ localStore: store });
      let rpc: ArchctxRuntimeRpcServer | undefined;
      try {
        let api: Pick<RuntimeRpcClient, "prepare" | "practiceCheckpoint"> = daemon;
        if (transport === "json") {
          // Exercise the same serialized argument boundary without requiring a listener.
          api = {
            prepare: (...args) => daemon.prepare(...RUNTIME_RPC_METHODS.prepare.decodeArgs(JSON.parse(JSON.stringify(RUNTIME_RPC_METHODS.prepare.encodeArgs(...args))))),
            practiceCheckpoint: (...args) => daemon.practiceCheckpoint(...RUNTIME_RPC_METHODS.practiceCheckpoint.decodeArgs(JSON.parse(JSON.stringify(RUNTIME_RPC_METHODS.practiceCheckpoint.encodeArgs(...args)))))
          };
        } else if (transport === "http") {
          rpc = new ArchctxRuntimeRpcServer(daemon, {
            root,
            lockPath: join(stateRoot, "daemon.lock"),
            connectionPath: join(stateRoot, "daemon.json"),
            idleTimeoutMs: 0
          });
          api = new RuntimeRpcClient(await rpc.start());
        }
        const session = explicitSession ? "task_explicit" : "task_runtime";
        const result = explicitSession
          ? await api.prepare(root, "task-A", 12_288, 12, session)
          : await api.prepare(root, "task-A");
        expect(result.ok).toBe(true);
        const key = `practice-checkpoint:${repositoryFingerprint(root)}:${session}`;
        const baseline = await store.readTaskState(key) as any;
        expect(baseline).toMatchObject({ taskSessionId: session, snapshot: { task: "task-A" } });
        expect([...store.taskStates.keys()].filter(key => key.startsWith("practice-checkpoint:"))).toEqual([key]);
        const checkpoint = await api.practiceCheckpoint(root, explicitSession ? { taskSessionId: session } : {});
        expect(checkpoint.ok).toBe(true);
        expect(checkpoint.data).toMatchObject({
          taskSessionId: session,
          reasonCode: "no-op",
          previousContextDigest: baseline.snapshot.contextDigest,
          previousPracticeGuidanceDigest: baseline.snapshot.practiceGuidanceDigest,
          nextSnapshot: { task: "task-A" }
        });
      } finally {
        if (rpc) await rpc.stop();
        else await daemon.stop();
        removeTempRepo(root);
        removeTempPath(stateRoot);
      }
    });
  }
}
