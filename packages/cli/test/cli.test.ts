import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/main";

describe("archctx CLI", () => {
  test("CLI delegates init and context to the runtime", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const init = await runCli("init", ["--name", "CLI App"], root);
      expect(init.ok).toBe(true);

      const context = await runCli("context", ["--task", "add teams"], root);
      expect(context.ok).toBe(true);
      expect((context.data as any).task).toBe("add teams");

      const status = await runCli("status", [], root);
      expect(status.ok).toBe(true);
      expect((status.data as any).worktreeDigest).toMatch(/^sha256:/);

      const prepare = await runCli("prepare", ["--task", "remove legacy v1 wrapper", "--max-items", "1"], root);
      expect(prepare.ok).toBe(true);
      expect((prepare.data as any).posture).toBeTruthy();

      const checkpoint = await runCli("checkpoint", ["--expected-worktree-digest", (status.data as any).worktreeDigest], root);
      expect((checkpoint.data as any).fresh).toBe(true);

      const complete = await runCli("complete", ["--task-session-id", "task_cli"], root);
      expect(complete.ok).toBe(true);
      expect((complete.data as any).schemaVersion).toBe("archcontext.review/v1");

      const config = await runCli("config", [], root);
      expect((config.data as any).generic.transport).toBe("stdio");

      writeFileSync(join(root, "package.json"), JSON.stringify({ engines: { node: ">=24 <26" } }), "utf8");
      const install = await runCli("install", ["--host", "codex"], root);
      expect((install.data as any).marker).toContain("archcontext_prepare_task");
      const doctor = await runCli("doctor", [], root);
      expect((doctor.data as any).privacyRouteDigest).toMatch(/^sha256:/);
      const privacyAudit = await runCli("privacy-audit", [], root);
      expect((privacyAudit.data as any).dependencyAudit.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("CLI exposes repo and landscape commands without changing single-repo defaults", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-"));
    try {
      writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
      const added = await runCli("repo", ["add", "--name", "web"], root);
      expect(added.ok).toBe(true);
      expect((added.data as any).repository.name).toBe("web");
      const landscape = await runCli("landscape", [], root);
      expect(landscape.ok).toBe(true);
      expect((landscape.data as any).schemaVersion).toBe("archcontext.landscape/v1");
      const context = await runCli("context", ["--landscape", "--task", "change local API", "--max-symbols", "2"], root);
      expect(context.ok).toBe(true);
      expect((context.data as any).extensions.landscapeDigest).toMatch(/^sha256:/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
