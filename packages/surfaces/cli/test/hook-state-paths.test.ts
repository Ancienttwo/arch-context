import { expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runtimeStatePaths } from "@archcontext/local-runtime/local-store-sqlite";
import { RUNTIME_RPC_VERSION } from "@archcontext/local-runtime/runtime-rpc-client";
import { createCommittedGitRepo, git } from "../../../local-runtime/local-store-sqlite/test/git-fixtures";
import { runFastHookEnqueue } from "../src/hook-fast";

test("fast hook finds daemon connections written with store state paths for repository, subdirectory and linked worktree", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "archctx-hook-path-parity-"));
  const repo = join(workspace, "repo");
  const linked = join(workspace, "linked");
  const previous = process.env.ARCHCONTEXT_STATE_DIR;
  const calls: any[] = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    calls.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    expect(request.headers.authorization).toBe("Bearer parity-fixture");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "jobs.enqueue", data: { enqueued: true } }));
  });
  try {
    process.env.ARCHCONTEXT_STATE_DIR = join(workspace, "state");
    createCommittedGitRepo(repo);
    git(repo, "worktree", "add", "-b", "hook-path-parity", linked);
    mkdirSync(join(repo, "packages", "web"), { recursive: true });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    for (const cwd of [repo, join(repo, "packages", "web"), linked]) {
      const paths = runtimeStatePaths(cwd);
      mkdirSync(dirname(paths.daemonConnectionPath), { recursive: true });
      writeFileSync(paths.daemonConnectionPath, JSON.stringify({
        schemaVersion: RUNTIME_RPC_VERSION, protocol: "http-loopback", version: 1,
        url, token: "parity-fixture", pid: process.pid
      }), { mode: 0o600 });
      const result = await runFastHookEnqueue(["hook", "enqueue", "--event", "post-edit", "--path", "src/中文.ts"], cwd);
      expect((result.envelope as any).data).toMatchObject({ enqueued: true, hookLog: { reasonCode: "enqueued", failOpen: false } });
      expect(calls.at(-1)).toMatchObject({ method: "jobsEnqueueGitHook", params: [paths.repositoryRoot, { source: "worktree", event: "post-edit" }] });
    }
    expect(calls.length).toBe(3);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previous;
    rmSync(workspace, { recursive: true, force: true });
  }
});
