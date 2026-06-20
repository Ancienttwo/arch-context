import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { runCli } from "../src/main";

function runTestCli(command: string, args: string[], root: string) {
  return runCli(command, args, root, {
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider()
  });
}

describe("archctx CLI", () => {
  test("CLI delegates init and context to the runtime", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const init = await runTestCli("init", ["--name", "CLI App"], root);
      expect(init.ok).toBe(true);

      const context = await runTestCli("context", ["--task", "add teams"], root);
      expect(context.ok).toBe(true);
      expect((context.data as any).task).toBe("add teams");

      const status = await runTestCli("status", [], root);
      expect(status.ok).toBe(true);
      expect((status.data as any).worktreeDigest).toMatch(/^sha256:/);

      const prepare = await runTestCli("prepare", ["--task", "remove legacy v1 wrapper", "--max-items", "1"], root);
      expect(prepare.ok).toBe(true);
      expect((prepare.data as any).posture).toBeTruthy();

      const checkpoint = await runTestCli("checkpoint", ["--expected-worktree-digest", (status.data as any).worktreeDigest], root);
      expect((checkpoint.data as any).fresh).toBe(true);

      const complete = await runTestCli("complete", [
        "--task-session-id", "task_cli",
        "--head-sha", "abc123",
        "--model-digest", `sha256:${"a".repeat(64)}`,
        "--codefacts-digest", `sha256:${"b".repeat(64)}`
      ], root);
      expect(complete.ok).toBe(true);
      expect((complete.data as any).schemaVersion).toBe("archcontext.review/v1");

      const config = await runTestCli("config", [], root);
      expect((config.data as any).generic.transport).toBe("stdio");

      writeFileSync(join(root, "package.json"), JSON.stringify({ engines: { node: ">=24 <26" } }), "utf8");
      const install = await runTestCli("install", ["--host", "codex"], root);
      expect((install.data as any).marker).toContain("archcontext_prepare_task");
      const doctor = await runTestCli("doctor", [], root);
      expect((doctor.data as any).privacyRouteDigest).toMatch(/^sha256:/);
      const privacyAudit = await runTestCli("privacy-audit", [], root);
      expect((privacyAudit.data as any).dependencyAudit.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("CLI exposes repo and landscape commands without changing single-repo defaults", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-"));
    try {
      writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
      const added = await runTestCli("repo", ["add", "--name", "web"], root);
      expect(added.ok).toBe(true);
      expect((added.data as any).repository.name).toBe("web");
      const landscape = await runTestCli("landscape", [], root);
      expect(landscape.ok).toBe(true);
      expect((landscape.data as any).schemaVersion).toBe("archcontext.landscape/v1");
      const context = await runTestCli("context", ["--landscape", "--task", "change local API", "--max-symbols", "2"], root);
      expect(context.ok).toBe(true);
      expect((context.data as any).extensions.landscapeDigest).toMatch(/^sha256:/);
      const explore = await runTestCli("explore", ["projection"], root);
      expect(explore.ok).toBe(true);
      expect((explore.data as any).schemaVersion).toBe("archcontext.explorer-projection/v1");
      const start = await runTestCli("explore", ["start"], root);
      expect((start.data as any).command).toBe("archctx explore start --foreground");
      expect((start.data as any).readOnly).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("CLI exports and imports interop projections without overwriting Native model", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-"));
    try {
      writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
      initializeArchContextModel(root, "CLI Export App");
      const likec4 = await runTestCli("export", ["likec4"], root);
      expect(likec4.ok).toBe(true);
      expect((likec4.data as any).format).toBe("likec4");
      const imported = await runTestCli("import", ["likec4", "--content", (likec4.data as any).files[0].content], root);
      expect(imported.ok).toBe(true);
      expect((imported.data as any).mode).toBe("initialization-only");
      const structurizr = await runTestCli("export", ["structurizr"], root);
      expect((structurizr.data as any).files[0].path).toContain("structurizr");
      const mermaid = await runTestCli("export", ["mermaid"], root);
      expect((mermaid.data as any).files[0].path).toContain("architecture.mmd");
      const tunnel = await runTestCli("tunnel", [], root);
      expect((tunnel.data as any).bindHost).toBe("127.0.0.1");
      expect((tunnel.data as any).writes).toContain("disabled-by-default");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
