import { createPrivateControlFile } from "@archcontext/local-runtime/control-file-security";
import { grantEveryoneRead } from "../../../local-runtime/control-file-security/test/windows-acl-fixtures";
import { expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, chmodSync } from "node:fs";
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
      rmSync(paths.daemonConnectionPath, { force: true });
      createPrivateControlFile(paths.daemonConnectionPath, JSON.stringify({
        schemaVersion: RUNTIME_RPC_VERSION, protocol: "http-loopback", version: 1,
        url, token: "parity-fixture", pid: process.pid
      }));
      const result = await runFastHookEnqueue(["hook", "enqueue", "--event", "post-edit", "--path", "src/中文.ts"], cwd);
      expect((result.envelope as any).data).toMatchObject({ enqueued: true, hookLog: { reasonCode: "enqueued", failOpen: false } });
      const call = calls.at(-1);
      expect(call.method).toBe("jobsEnqueueGitHook");
      expect(realpathSync.native(call.params[0])).toBe(paths.repositoryRoot);
      expect(call.params[1]).toMatchObject({ source: "worktree", event: "post-edit" });
    }
    expect(calls.length).toBe(3);
    const path = runtimeStatePaths(repo).daemonConnectionPath;
    if (process.platform === "win32") grantEveryoneRead(path);
    else chmodSync(path, 0o644);
    const denied = await runFastHookEnqueue(["hook", "enqueue", "--path", "src/private.ts"], repo);
    expect((denied.envelope as any).data.enqueued).toBe(false);
    expect(calls.length).toBe(3);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previous;
    rmSync(workspace, { recursive: true, force: true });
  }
}, 30_000);
