import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isArchContextGeneratedProjectionPath } from "@archcontext/local-runtime/projection-paths";
import { runCli } from "../src/main";
import { runFastHookEnqueue } from "../src/hook-fast";

test("fast and regular hook guards and path digests preserve wire parity", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-hook-helper-"));
  const previous = process.env.ARCHCONTEXT_STATE_DIR;
  process.env.ARCHCONTEXT_STATE_DIR = join(root, "state");
  const cases = [
    { paths: [".archcontext/generated/ARCHITECTURE.md"], flags: [], skip: true },
    { paths: [".archcontext\\generated\\图.md"], flags: [], skip: true },
    { paths: [".archcontext/generated/a.md", "src/app.ts"], flags: [], skip: false },
    { paths: [".archcontext/generated-other/a.md"], flags: [], skip: false },
    { paths: [], flags: [], skip: false },
    { paths: ["src/中文.ts", "src/Z.ts", "src/a.ts", "src/中文.ts"], flags: ["--generated-projection"], skip: true },
    { paths: [".archcontext/generated/a.md"], flags: ["--no-generated-projection-guard", "--generated-projection"], skip: false }
  ];
  try {
    for (const scenario of cases) {
      let calls = 0;
      const args = ["enqueue", ...scenario.flags, ...scenario.paths.flatMap(path => ["--path", path])];
      const regular = await runCli("hook", args, root, {
        runtimeClient: { jobsEnqueueGitHook() { calls++; return Promise.resolve({ ok: true, data: { enqueued: true } }); } } as any
      });
      const fast = await runFastHookEnqueue(["hook", ...args], root);
      const regularData = regular.data as any;
      const fastData = (fast.envelope as any).data;
      expect(regularData.skipped === true).toBe(scenario.skip);
      expect(fastData.skipped === true).toBe(scenario.skip);
      expect(calls).toBe(scenario.skip ? 0 : 1);
      // This fixed wire shape predates the extraction: sort/deduplicate paths, then hash JSON.
      const expected = `sha256:${createHash("sha256").update(JSON.stringify({ paths: [...new Set(scenario.paths)].sort() })).digest("hex")}`;
      expect(fastData.hookLog.changedPathDigest).toBe(expected);
      expect(regularData.hookLog.changedPathDigest).toBe(expected);
    }
    expect(isArchContextGeneratedProjectionPath(".archcontext/generated/a.md")).toBe(true);
    expect(isArchContextGeneratedProjectionPath(".archcontext/generated-other/a.md")).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
