import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stableYaml } from "@archcontext/contracts";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { runCli } from "../src/main";

const nodePath = (id: string) => `.archcontext/model/nodes/${id}.yaml`;
const constraintPath = ".archcontext/model/constraints/constraint.example.no-dependency.yaml";

const moduleNode = (id: string) => ({ schemaVersion: "archcontext.node/v2", id, kind: "module", name: id, status: "active", summary: `Example module ${id}.`, source: { include: [`src/${id}/**`] } });
const constraint = (target: string) => ({
  schemaVersion: "archcontext.constraint/v1", id: "constraint.example.no-dependency", name: "A does not depend on its target", rationale: "Fixture constraint.",
  severity: "error", scope: { nodes: ["module.example.a"] }, rule: { type: "forbid-dependency", targets: [target] }
});

test("archctx plan --operations-file applies a coordinated change that neither single-operation ChangeSet could apply", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-multi-op-"));
  try {
    writeFileSync(join(root, "README.md"), "# multi-operation fixture\n", "utf8");
    initializeArchContextModel(root, "Multi Operation App");
    mkdirSync(join(root, ".archcontext/model/constraints"), { recursive: true });
    for (const id of ["module.example.a", "module.example.b"]) writeFileSync(join(root, nodePath(id)), stableYaml(moduleNode(id) as never), "utf8");
    writeFileSync(join(root, constraintPath), stableYaml(constraint("module.example.b") as never), "utf8");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-q", "-m", "fixture"], { cwd: root });

    const daemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: new TestLocalStore()
    });
    try {
      const cli = (command: string, args: string[]) => runCli(command, args, root, { runtimeClient: daemon });
      const hashOf = async (path: string) => ((await cli("hash", ["--path", path])).data as { hash: string }).hash;
      // Replace module b with b2: the constraint must stop naming b in the same step b is deleted.
      const deleteB = { op: "delete_entity", path: nodePath("module.example.b"), expectedHash: await hashOf(nodePath("module.example.b")) };
      const retarget = { op: "update_entity_fields", path: constraintPath, expectedHash: await hashOf(constraintPath), body: stableYaml(constraint("module.example.b2") as never) };
      const createB2 = { op: "create_entity", path: nodePath("module.example.b2"), expectedHash: "missing", body: stableYaml(moduleNode("module.example.b2") as never) };
      const planWith = async (id: string, operations: unknown[]) => {
        const file = join(root, `${id}.json`);
        writeFileSync(file, JSON.stringify(operations), "utf8");
        return cli("plan", ["--id", id, "--operations-file", file]);
      };

      // Each single-operation ChangeSet would leave a dangling reference, so the engine blocks it.
      for (const [id, alone] of [["changeset.delete-only", deleteB], ["changeset.retarget-only", retarget]] as const) {
        const planned = await planWith(id, [alone]);
        const applied = await cli("apply", ["--id", id, "--approved", "--expected-worktree-digest", (planned.data as any).draft.base.worktreeDigest]).catch((error) => ({ ok: false, error }));
        expect(applied.ok, `${id} must not apply alone: ${JSON.stringify(planned)}`).toBe(false);
      }
      expect(readFileSync(join(root, constraintPath), "utf8")).toContain("module.example.b\"");

      const planned = await planWith("changeset.coordinated", [deleteB, retarget, createB2]);
      expect(planned.ok, JSON.stringify(planned)).toBe(true);
      expect((planned.data as any).draft.operations).toHaveLength(3);
      const applied = await cli("apply", ["--id", "changeset.coordinated", "--approved", "--expected-worktree-digest", (planned.data as any).draft.base.worktreeDigest]);
      expect(applied.ok, JSON.stringify(applied)).toBe(true);
      expect(readFileSync(join(root, constraintPath), "utf8")).toContain("module.example.b2");
      expect(existsSync(join(root, nodePath("module.example.b")))).toBe(false);
      expect(existsSync(join(root, nodePath("module.example.b2")))).toBe(true);
    } finally {
      await daemon.stop();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
