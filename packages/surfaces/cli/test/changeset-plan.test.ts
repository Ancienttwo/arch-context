import { expect, test } from "bun:test";
import type { RuntimeDaemonClient } from "@archcontext/local-runtime/runtime-daemon";
import { runCli } from "../src/main";

const hash = `sha256:${"a".repeat(64)}`;
const path = ".archcontext/model/nodes/module.example.yaml";

function recordingClient() {
  const calls: Array<{ method: string; input: unknown }> = [];
  const runtimeClient = new Proxy({}, {
    get(_target, method) {
      if (method === "then") return undefined;
      return async (_root: string, input: unknown) => {
        calls.push({ method: String(method), input });
        return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: String(method), data: {} };
      };
    }
  }) as RuntimeDaemonClient;
  return { calls, runtimeClient };
}

test("archctx plan rejects malformed entity operations before reaching the daemon", async () => {
  const { calls, runtimeClient } = recordingClient();
  const cases: Array<[string[], string]> = [
    [["--op", "rename_entity", "--path", path], "plan --op must be one of create_entity|update_entity_fields|delete_entity"],
    [["--op", "update_entity_fields", "--body", "x"], "plan requires --path"],
    [["--op", "update_entity_fields", "--path", path, "--body", "x"], "plan --op update_entity_fields requires --expected-hash sha256:<64-hex> of the current file"],
    [["--op", "update_entity_fields", "--path", path, "--expected-hash", "missing", "--body", "x"], "plan --op update_entity_fields requires --expected-hash sha256:<64-hex> of the current file"],
    [["--op", "update_entity_fields", "--path", path, "--expected-hash", hash], "plan --op update_entity_fields requires --body with the complete YAML document"],
    [["--op", "delete_entity", "--path", path], "plan --op delete_entity requires --expected-hash sha256:<64-hex> of the current file"],
    [["--op", "delete_entity", "--path", path, "--expected-hash", hash, "--body", "x"], "plan --op delete_entity does not accept --body"]
  ];
  for (const [args, message] of cases) {
    expect(await runCli("plan", ["--id", "changeset.example", ...args], "/absent", { runtimeClient })).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID", message } });
  }
  expect(calls).toEqual([]);
});

test("archctx plan sends create, update and delete in the MCP entity operation shape", async () => {
  const { calls, runtimeClient } = recordingClient();
  const plan = (args: string[]) => runCli("plan", ["--id", "changeset.example", ...args], "/repo", { runtimeClient });
  await plan(["--path", path, "--body", "created\n"]);
  await plan(["--op", "update_entity_fields", "--path", path, "--expected-hash", hash, "--body", "updated\n"]);
  await plan(["--op", "delete_entity", "--path", path, "--expected-hash", hash]);
  expect(calls).toEqual([
    { method: "planUpdate", input: { id: "changeset.example", operations: [{ op: "create_entity", path, expectedHash: "missing", body: "created\n" }] } },
    { method: "planUpdate", input: { id: "changeset.example", operations: [{ op: "update_entity_fields", path, expectedHash: hash, body: "updated\n" }] } },
    { method: "planUpdate", input: { id: "changeset.example", operations: [{ op: "delete_entity", path, expectedHash: hash }] } }
  ]);
});

test("archctx apply forwards the explicit approval flag and the expected worktree digest", async () => {
  const { calls, runtimeClient } = recordingClient();
  await runCli("apply", ["--id", "changeset.example", "--expected-worktree-digest", hash], "/repo", { runtimeClient });
  await runCli("apply", ["--id", "changeset.example", "--approved", "--expected-worktree-digest", hash], "/repo", { runtimeClient });
  expect(calls).toEqual([
    { method: "applyUpdate", input: { id: "changeset.example", approved: false, expectedWorktreeDigest: hash } },
    { method: "applyUpdate", input: { id: "changeset.example", approved: true, expectedWorktreeDigest: hash } }
  ]);
});

test("archctx help lists plan and apply but no separate approve command", async () => {
  const help = await runCli("help", [], "/absent", { runtimeClient: recordingClient().runtimeClient });
  const commands = (help.data as { commands: string[] }).commands;
  expect(commands).toContain("plan");
  expect(commands).toContain("apply");
  expect(commands).not.toContain("approve");
  expect((help.data as { examples: string[] }).examples.some((example) => example.includes("--op update_entity_fields"))).toBe(true);
});
