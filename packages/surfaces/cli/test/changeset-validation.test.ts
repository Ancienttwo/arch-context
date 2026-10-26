import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { runCli } from "../src/main";
import { createStartedProductionDaemon } from "@archcontext/local-runtime/runtime-daemon";

test("plan rejects an invalid ADR base before approval and succeeds after its schema is repaired", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "archctx-base-validation-"));
  const previous = process.env.ARCHCONTEXT_STATE_DIR;
  process.env.ARCHCONTEXT_STATE_DIR = join(scratch, "state");
  const root = join(scratch, "repo");
  mkdirSync(root);
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: root, stdio: "pipe" });
  git("init", "-q");
  initializeArchContextModel(root, "Base validation");
  mkdirSync(join(root, "docs/adr"), { recursive: true });
  const adr = join(root, "docs/adr/ADR-0001-x.md");
  writeFileSync(adr, "---\ntitle: Example\n---\n# Example\n");
  git("add", "."); git("commit", "-qm", "invalid ADR");
  const daemon = await createStartedProductionDaemon({ root, localStorePath: join(scratch, "state/runtime.sqlite") });
  const path = ".archcontext/model/nodes/module.validation.yaml";
  const args = ["--id", "changeset.validation", "--op", "create_entity", "--path", path, "--body", "schemaVersion: archcontext.node/v2\nid: module.validation\nkind: module\nname: Validation\nstatus: active\nsummary: Fixture\n", "--json"];
  try {
    const rejected = await runCli("plan", args, root, { runtimeClient: daemon });
    expect(rejected).toMatchObject({ ok: false, error: {
      reasonCode: "plan-model-invalid", retryable: false, action: "repair-model",
      details: { issueCount: 1, diagnostics: [{ path: "docs/adr/ADR-0001-x.md", code: "schema-version-missing" }], omittedIssueCount: 0 }
    } });
    expect(existsSync(join(root, path))).toBe(false);
    writeFileSync(adr, "---\nschemaVersion: archcontext.adr/v1\ntitle: Example\n---\n# Example\n");
    git("add", "."); git("commit", "-qm", "repair ADR schema");
    const planned = await runCli("plan", args, root, { runtimeClient: daemon });
    expect(planned.ok).toBe(true);
    const applied = await runCli("apply", ["--id", "changeset.validation", "--approved", "--expected-worktree-digest", (planned.data as any).draft.base.worktreeDigest, "--json"], root, { runtimeClient: daemon });
    expect(applied.ok).toBe(true);
    expect(existsSync(join(root, path))).toBe(true);
  } finally {
    await daemon.stop();
    if (previous === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previous;
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 30_000);
