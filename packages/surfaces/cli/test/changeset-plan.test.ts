import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson } from "@archcontext/contracts";
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
    [["--op", "update_entity_fields", "--path", path, "--expected-hash", hash], "plan --op update_entity_fields requires --body, --body - or --body-file with the complete YAML document"],
    [["--op", "delete_entity", "--path", path], "plan --op delete_entity requires --expected-hash sha256:<64-hex> of the current file"],
    [["--op", "delete_entity", "--path", path, "--expected-hash", hash, "--body", "x"], "plan --op delete_entity does not accept --body or --body-file"],
    [["--path", path, "--body", "x", "--body-file", "body.yaml"], "plan accepts exactly one body source: --body, --body - or --body-file"],
    [["--path", path, "--body-file"], "plan --body-file requires a path"],
    [["--path", path, "--body-file", "/absent/body.yaml"], "plan --body-file must be a repository-relative POSIX path inside the repository; use --body - to read stdin"]
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

function withTempRepo<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-plan-"));
  return run(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

test("archctx plan --body-file and --body - read the complete YAML from a file or stdin", () =>
  withTempRepo(async (root) => {
    const { calls, runtimeClient } = recordingClient();
    writeFileSync(join(root, "entity.yaml"), "from file\nsecond: line\n", "utf8");
    const plan = (args: string[], readStdin?: () => string) => runCli("plan", ["--id", "changeset.example", ...args], root, { runtimeClient, readStdin });
    await plan(["--path", path, "--body-file", "entity.yaml"]);
    await plan(["--op", "update_entity_fields", "--path", path, "--expected-hash", hash, "--body-file", "./entity.yaml"]);
    await plan(["--op", "update_entity_fields", "--path", path, "--expected-hash", hash, "--body", "-"], () => "from stdin\n");
    expect(calls.map((call) => (call.input as any).operations)).toEqual([
      [{ op: "create_entity", path, expectedHash: "missing", body: "from file\nsecond: line\n" }],
      [{ op: "update_entity_fields", path, expectedHash: hash, body: "from file\nsecond: line\n" }],
      [{ op: "update_entity_fields", path, expectedHash: hash, body: "from stdin\n" }]
    ]);
  }));

test("archctx plan --operations-file sends every operation of the MCP shape in one ChangeSet", () =>
  withTempRepo(async (root) => {
    const { calls, runtimeClient } = recordingClient();
    const operations = [
      { op: "update_entity_fields", path, expectedHash: hash, body: "node\n" },
      { op: "delete_entity", path: ".archcontext/model/flows/flow.example.yaml", expectedHash: hash },
      { op: "create_entity", path: ".archcontext/model/nodes/module.new.yaml", expectedHash: "missing", body: "new\n" }
    ];
    writeFileSync(join(root, "operations.json"), JSON.stringify(operations), "utf8");
    const planned = await runCli("plan", ["--id", "changeset.example", "--operations-file", "operations.json"], root, { runtimeClient });
    expect(planned.ok).toBe(true);
    expect(calls).toEqual([{ method: "planUpdate", input: { id: "changeset.example", operations } }]);
  }));

test("archctx plan --operations-file fails closed before reaching the daemon", () =>
  withTempRepo(async (root) => {
    const { calls, runtimeClient } = recordingClient();
    const write = (name: string, content: string) => writeFileSync(join(root, name), content, "utf8");
    write("not-json.json", "{");
    write("not-array.json", JSON.stringify({ op: "delete_entity" }));
    write("bad-operation.json", JSON.stringify([{ op: "rename_entity", path, expectedHash: hash }]));
    write("extra-field.json", JSON.stringify([{ op: "delete_entity", path, expectedHash: hash, surprise: true }]));
    write("ok.json", JSON.stringify([{ op: "delete_entity", path, expectedHash: hash }]));
    const plan = (args: string[]) => runCli("plan", ["--id", "changeset.example", ...args], root, { runtimeClient });
    for (const name of ["not-json.json", "not-array.json", "bad-operation.json", "extra-field.json"]) {
      expect(await plan(["--operations-file", name]), name).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
    }
    expect(await plan(["--operations-file", "missing.json"])).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
    expect(await plan(["--operations-file"])).toMatchObject({ ok: false, error: { message: "plan --operations-file requires a path" } });
    for (const extra of [["--op", "delete_entity"], ["--path", path], ["--expected-hash", hash], ["--body", "x"], ["--body-file", "body.yaml"]]) {
      expect(await plan(["--operations-file", "ok.json", ...extra])).toMatchObject({
        ok: false,
        error: { code: "AC_SCHEMA_INVALID", message: `plan --operations-file cannot be combined with ${extra[0]}` }
      });
    }
    expect(calls).toEqual([]);
  }));

test("archctx plan --body-file and --operations-file read only regular files inside the repository", () =>
  withTempRepo(async (root) => {
    const { calls, runtimeClient } = recordingClient();
    const outside = mkdtempSync(join(tmpdir(), "archctx-cli-outside-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "secret\n", "utf8");
      writeFileSync(join(outside, "operations.json"), "[]", "utf8");
      symlinkSync(join(outside, "secret.txt"), join(root, "linked-body.yaml"));
      symlinkSync(join(outside, "operations.json"), join(root, "linked-operations.json"));
      mkdirSync(join(root, "real"), { recursive: true });
      writeFileSync(join(root, "real", "body.yaml"), "x\n", "utf8");
      symlinkSync(join(root, "real"), join(root, "linked-dir"));
      const base = ["--id", "changeset.example", "--path", path];
      const cases: Array<[string, string[]]> = [
        ["--body-file absolute", [...base, "--body-file", join(outside, "secret.txt")]],
        ["--body-file ..", [...base, "--body-file", "../secret.txt"]],
        ["--body-file symlink", [...base, "--body-file", "linked-body.yaml"]],
        ["--body-file symlinked directory", [...base, "--body-file", "linked-dir/body.yaml"]],
        ["--body-file directory", [...base, "--body-file", "real"]],
        ["--operations-file absolute", ["--id", "changeset.example", "--operations-file", join(outside, "operations.json")]],
        ["--operations-file ..", ["--id", "changeset.example", "--operations-file", "../operations.json"]],
        ["--operations-file symlink", ["--id", "changeset.example", "--operations-file", "linked-operations.json"]],
        ["--operations-file directory", ["--id", "changeset.example", "--operations-file", "real"]]
      ];
      for (const [name, args] of cases) {
        expect(await runCli("plan", args, root, { runtimeClient }), name).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
      }
      expect(calls).toEqual([]);
      // Out-of-repository content stays possible through stdin.
      await runCli("plan", [...base, "--body", "-"], root, { runtimeClient, readStdin: () => "from stdin\n" });
      expect(calls).toHaveLength(1);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  }));

test("archctx hash prints the expected hash exactly as the ChangeSet precondition computes it", () =>
  withTempRepo(async (root) => {
    const body = "id: module.example\nname: Example \u00e9\n";
    mkdirSync(join(root, ".archcontext/model/nodes"), { recursive: true });
    writeFileSync(join(root, path), body, "utf8");
    const result = await runCli("hash", ["--path", path], root);
    expect(result).toMatchObject({ ok: true, data: { path, hash: digestJson({ body }) } });
    expect((result.data as { hash: string }).hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  }));

test("archctx hash accepts the manifest and ADR files that update_manifest_fields and update_adr_references precondition on", () =>
  withTempRepo(async (root) => {
    mkdirSync(join(root, "docs/adr"), { recursive: true });
    mkdirSync(join(root, ".archcontext"), { recursive: true });
    const files: Record<string, string> = {
      ".archcontext/manifest.yaml": "schemaVersion: archcontext.manifest/v1\n",
      "docs/adr/ADR-0001-example-decision.md": "# ADR 1\n"
    };
    for (const [file, body] of Object.entries(files)) {
      writeFileSync(join(root, file), body, "utf8");
      expect(await runCli("hash", ["--path", file], root), file).toMatchObject({ ok: true, data: { path: file, hash: digestJson({ body }) } });
    }
    writeFileSync(join(root, "docs/adr/notes.md"), "x\n", "utf8");
    writeFileSync(join(root, ".archcontext/other.yaml"), "x\n", "utf8");
    for (const file of ["docs/adr/notes.md", ".archcontext/other.yaml"]) {
      expect(await runCli("hash", ["--path", file], root), file).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID", message: `Path is outside ArchContext write allowlist: ${file}` } });
    }
  }));

test("archctx hash fails closed for paths a ChangeSet could not write or files that do not exist", () =>
  withTempRepo(async (root) => {
    mkdirSync(join(root, ".archcontext/model/nodes"), { recursive: true });
    writeFileSync(join(root, "package.json"), "{}\n", "utf8");
    writeFileSync(join(root, "outside.yaml"), "x\n", "utf8");
    symlinkSync(join(root, "outside.yaml"), join(root, ".archcontext/model/nodes/linked.yaml"));
    const cases: Array<[string[], string]> = [
      [[], "hash requires --path"],
      [["--path", "/etc/passwd"], "hash --path must be a repository-relative POSIX path"],
      [["--path", ".archcontext/model/../../package.json"], "hash --path must be a repository-relative POSIX path"],
      [["--path", "package.json"], "Path is outside ArchContext write allowlist: package.json"],
      [["--path", path], `hash --path is not an existing file: ${path}`],
      [["--path", ".archcontext/model/nodes"], "hash --path is not an existing file: .archcontext/model/nodes"],
      [["--path", ".archcontext/model/nodes/linked.yaml"], "Refusing to write through symlink: .archcontext/model/nodes/linked.yaml"]
    ];
    for (const [args, message] of cases) {
      expect(await runCli("hash", args, root), args.join(" ")).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID", message } });
    }
  }));

test("archctx plan and hash help state the hash formula, the single body source and that drafts live in daemon memory", async () => {
  const { calls, runtimeClient } = recordingClient();
  const planHelp = await runCli("plan", ["--help"], "/absent", { runtimeClient });
  const hashHelp = await runCli("hash", ["--help"], "/absent", { runtimeClient });
  expect(calls).toEqual([]);
  const text = JSON.stringify([planHelp.data, hashHelp.data]);
  for (const phrase of ["digestJson({ body })", "archctx hash --path", "--operations-file", "--body-file", "--body -", "daemon restart", "Unknown ChangeSet", "not sha256sum"]) {
    expect(text).toContain(phrase);
  }
  const help = await runCli("help", [], "/absent", { runtimeClient });
  expect((help.data as { commands: string[] }).commands).toContain("hash");
  expect((help.data as { examples: string[] }).examples.some((example) => example.startsWith("archctx hash --path"))).toBe(true);
  expect((help.data as { examples: string[] }).examples.some((example) => example.includes("--operations-file"))).toBe(true);
});
