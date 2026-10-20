import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { okEnvelope, type Json, type JsonEnvelope, type ProjectionPublishRunV1, type ProjectionPublishStatusV1, type ProjectionRequestV1 } from "@archcontext/contracts";
import { createPrivateControlFile } from "@archcontext/local-runtime/control-file-security";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { declareOptionalCodeFacts } from "@archcontext/local-runtime/test/codegraph-factories";
import {
  PROJECTION_PR_BODY_MARKER,
  createCommandProjectionPublisher,
  createGhProjectionPublisher,
  createNoneProjectionPublisher,
  projectionWriterPaths,
  runProjectionPublishCommand,
  runProjectionPublishFollow,
  runProjectionPublishStatusCommand,
  type ProjectionPublisherExec,
  type ProjectionPublisherInput,
  type ProjectionPublisherPort,
  type ProjectionWriterApplyPort
} from "../src/projection-writer";

const IDENTITY = {
  GIT_AUTHOR_NAME: "ArchContext Writer Test",
  GIT_AUTHOR_EMAIL: "writer@example.test",
  GIT_COMMITTER_NAME: "ArchContext Writer Test",
  GIT_COMMITTER_EMAIL: "writer@example.test"
};
const previousEnv: Record<string, string | undefined> = {};
const roots: string[] = [];

beforeAll(() => {
  for (const [key, value] of Object.entries({ ...IDENTITY, DO_NOT_TRACK: "1" })) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }
});

afterAll(() => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

interface WriterFixture {
  root: string;
  origin: string;
  /** The developer checkout that pushes base commits. */
  dev: string;
  /** The checkout the writer is started from. */
  clone: string;
  env: Record<string, string>;
}

/** A bare origin with `main`, a developer checkout and a separate clone the writer runs from. */
function writerFixture(): WriterFixture {
  const root = mkdtempSync(join(tmpdir(), "archctx-projection-writer-"));
  roots.push(root);
  const origin = join(root, "origin.git");
  const dev = join(root, "dev");
  const clone = join(root, "clone");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  mkdirSync(join(dev, "app/src"), { recursive: true });
  writeFileSync(join(dev, "README.md"), "# writer fixture\n", "utf8");
  writeFileSync(join(dev, "app/src/index.ts"), "export const app = 1;\n", "utf8");
  initializeArchContextModel(dev, "Writer Fixture");
  declareOptionalCodeFacts(dev);
  git(dev, "init", "-q", "-b", "main");
  git(dev, "config", "core.autocrlf", "false");
  git(dev, "add", "-A");
  git(dev, "commit", "-q", "-m", "fixture");
  git(dev, "remote", "add", "origin", origin);
  git(dev, "push", "-q", "origin", "main");
  git(root, "clone", "-q", origin, clone);
  return { root, origin, dev, clone, env: { ARCHCONTEXT_STATE_DIR: join(root, "state") } };
}

function pushBaseCommit(fixture: WriterFixture, body: string): string {
  writeFileSync(join(fixture.dev, "app/src/index.ts"), body, "utf8");
  git(fixture.dev, "commit", "-q", "-am", "base change");
  git(fixture.dev, "push", "-q", "origin", "main");
  return git(fixture.dev, "rev-parse", "HEAD");
}

function originRef(fixture: WriterFixture, ref: string): string | null {
  const result = spawnSync("git", ["rev-parse", "--verify", "-q", ref], { cwd: fixture.origin, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** A fake apply: writes owned outputs into the worktree and reports them like ProjectionResultV2. */
function fakeApply(write: (worktree: string, request: ProjectionRequestV1, call: number) => { status?: string; files?: Record<string, string | null>; reported?: string[]; humanActions?: unknown[] } | JsonEnvelope) {
  const calls: { worktree: string; request: ProjectionRequestV1 }[] = [];
  const apply: ProjectionWriterApplyPort = async (worktree, request) => {
    calls.push({ worktree, request });
    const outcome = write(worktree, request, calls.length);
    if ("schemaVersion" in outcome && (outcome as JsonEnvelope).schemaVersion === "archcontext.envelope/v1") return outcome as JsonEnvelope;
    const plan = outcome as { status?: string; files?: Record<string, string | null>; reported?: string[]; humanActions?: unknown[] };
    for (const [path, body] of Object.entries(plan.files ?? {})) {
      const absolute = join(worktree, path);
      if (body === null) rmSync(absolute, { force: true });
      else {
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, body, "utf8");
      }
    }
    const reported = plan.reported ?? Object.keys(plan.files ?? {});
    return okEnvelope("projection.run", {
      schemaVersion: "archcontext.projection-result/v2",
      requestId: request.requestId,
      status: plan.status ?? (reported.length > 0 ? "applied" : "noop"),
      files: reported.map((path) => ({ path, action: "update" })),
      humanActions: plan.humanActions ?? []
    } as unknown as Json);
  };
  return { apply, calls };
}

function recordingPublisher(kind: "gh" | "command" = "gh", fail: () => boolean = () => false) {
  const calls: (ProjectionPublisherInput & { body: string })[] = [];
  const publisher: ProjectionPublisherPort = {
    kind,
    async ensurePullRequest(input) {
      calls.push({ ...input, body: readFileSync(input.bodyFile, "utf8") });
      if (fail()) throw new Error("publisher unavailable");
      return { url: "https://example.test/pull/7", number: 7 };
    }
  };
  return { publisher, calls };
}

function runOf(envelope: JsonEnvelope): ProjectionPublishRunV1 {
  expect(envelope.requestId).toBe("projection.publish");
  return envelope.data as unknown as ProjectionPublishRunV1;
}

function changedFiles(fixture: WriterFixture, commit: string): string[] {
  return git(fixture.origin, "diff-tree", "--no-commit-id", "--name-only", "-r", commit).split("\n").filter(Boolean).sort();
}

test("first run publishes one generated-only commit on the base tip; the same SHA is then already processed", async () => {
  const fixture = writerFixture();
  const baseSha = git(fixture.dev, "rev-parse", "HEAD");
  const { apply, calls } = fakeApply((_worktree, request) => ({ files: { "docs/architecture/overview.md": `# overview for ${request.expected.headSha}\n` } }));
  const { publisher, calls: published } = recordingPublisher();

  const first = await runProjectionPublishCommand({ cwd: fixture.clone, publisher, apply, env: fixture.env });
  expect(first.ok, JSON.stringify(first)).toBe(true);
  const run = runOf(first);
  expect(run).toMatchObject({ result: "published", remote: "origin", base: "main", branch: "archctx/projection", baseSha, pushed: true, publisher: "gh", files: ["docs/architecture/overview.md"], projectionStatus: "applied", error: null, iterations: 1, pullRequest: { url: "https://example.test/pull/7", number: 7 } });

  const tip = originRef(fixture, "refs/heads/archctx/projection");
  expect(tip).toBe(run.publishedCommit);
  expect(git(fixture.origin, "rev-list", "--parents", "-n", "1", tip!).split(" ")).toEqual([tip!, baseSha]);
  expect(changedFiles(fixture, tip!)).toEqual(["docs/architecture/overview.md"]);
  expect(git(fixture.origin, "log", "-1", "--format=%B", tip!)).toContain(`Archctx-Projection-Source: ${baseSha}`);
  // main never moves.
  expect(originRef(fixture, "refs/heads/main")).toBe(baseSha);

  // The apply ran in the owned worktree with a protocol apply request bound to the base tip.
  const paths = projectionWriterPaths(fixture.clone, "origin", "main", fixture.env);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.worktree).toBe(paths.worktree);
  expect(calls[0]!.request).toMatchObject({ mode: "apply", profile: "repo-harness/v1", targets: ["agent-context", "architecture-docs"], changedPaths: [], expected: { headSha: baseSha } });
  expect(calls[0]!.request.acceptObservedMajorChange).toBeUndefined();

  // The publisher got the run's inputs and a paths-only body.
  expect(published).toHaveLength(1);
  expect(published[0]).toMatchObject({ worktree: paths.worktree, remote: "origin", base: "main", branch: "archctx/projection", baseSha, commitSha: tip });
  expect(published[0]!.title).toBe(`chore(projection): refresh generated architecture outputs for main@${baseSha.slice(0, 12)}`);
  expect(published[0]!.body).toContain(PROJECTION_PR_BODY_MARKER);
  expect(published[0]!.body).toContain("`docs/architecture/overview.md`");
  expect(published[0]!.body).toContain("archctx projection verify-pr --base main");
  expect(published[0]!.body).not.toContain("# overview");
  expect(existsSync(published[0]!.bodyFile)).toBe(false);

  const again = runOf(await runProjectionPublishCommand({ cwd: fixture.clone, publisher, apply, env: fixture.env }));
  expect(again).toMatchObject({ result: "already-processed", baseSha, pushed: false, publishedCommit: tip });
  expect(calls).toHaveLength(1);
  expect(published).toHaveLength(1);
  expect(originRef(fixture, "refs/heads/archctx/projection")).toBe(tip);

  // A third run is still a no-op: an already-processed run does not reopen the SHA.
  expect(runOf(await runProjectionPublishCommand({ cwd: fixture.clone, publisher, apply, env: fixture.env })).result).toBe("already-processed");
  expect(calls).toHaveLength(1);

  const status = runProjectionPublishStatusCommand({ cwd: fixture.clone, env: fixture.env });
  expect(status.ok, JSON.stringify(status)).toBe(true);
  expect(status.data as unknown as ProjectionPublishStatusV1).toMatchObject({
    schemaVersion: "archcontext.projection-publish-status/v1",
    remote: "origin",
    base: "main",
    branch: "archctx/projection",
    worktreePath: paths.worktree,
    running: null,
    lastProcessedSha: baseSha,
    lastSuccessfulSha: baseSha,
    lastRun: { result: "already-processed", baseSha }
  });
  // State and lock are private and the lock is released.
  expect(readFileSync(paths.state, "utf8")).toContain("archcontext.projection-writer-state/v1");
  expect(existsSync(paths.lock)).toBe(false);
});

test("a new base commit force-updates the rolling branch to that base plus exactly one commit", async () => {
  const fixture = writerFixture();
  const { apply } = fakeApply((_worktree, request) => ({ files: { "docs/architecture/overview.md": `# overview for ${request.expected.headSha}\n` } }));
  const { publisher } = recordingPublisher();
  const first = runOf(await runProjectionPublishCommand({ cwd: fixture.clone, publisher, apply, env: fixture.env }));
  expect(first.result).toBe("published");

  const nextBase = pushBaseCommit(fixture, "export const app = 2;\n");
  const second = runOf(await runProjectionPublishCommand({ cwd: fixture.clone, publisher, apply, env: fixture.env }));
  expect(second).toMatchObject({ result: "published", baseSha: nextBase, pushed: true });
  const tip = originRef(fixture, "refs/heads/archctx/projection")!;
  expect(tip).toBe(second.publishedCommit);
  expect(tip).not.toBe(first.publishedCommit);
  expect(git(fixture.origin, "rev-list", "--parents", "-n", "1", tip).split(" ")).toEqual([tip, nextBase]);
  expect(git(fixture.origin, "rev-list", "--count", `${nextBase}..${tip}`)).toBe("1");
  expect(changedFiles(fixture, tip)).toEqual(["docs/architecture/overview.md"]);
});

test("render-equal is up to date and pushes nothing; an apply that touches a non-owned path fails and pushes nothing", async () => {
  const fixture = writerFixture();
  const { publisher, calls: published } = recordingPublisher();
  const noop = fakeApply(() => ({ status: "noop" }));
  const upToDate = runOf(await runProjectionPublishCommand({ cwd: fixture.clone, publisher, apply: noop.apply, env: fixture.env }));
  expect(upToDate).toMatchObject({ result: "up-to-date", pushed: false, publishedCommit: null, projectionStatus: "noop", files: [] });
  expect(originRef(fixture, "refs/heads/archctx/projection")).toBeNull();
  expect(published).toHaveLength(0);

  const other = writerFixture();
  const hostile = fakeApply(() => ({ files: { "docs/architecture/overview.md": "# ok\n", "app/src/index.ts": "export const app = 666;\n" } }));
  const refused = await runProjectionPublishCommand({ cwd: other.clone, publisher, apply: hostile.apply, env: other.env });
  expect(refused.ok).toBe(false);
  expect(refused.error).toMatchObject({ code: "AC_POLICY_VIOLATION", reasonCode: "projection-writer-non-owned-change" });
  expect(refused.error!.message).toContain("app/src/index.ts");
  expect(runOf(refused)).toMatchObject({ result: "failed", pushed: false, publishedCommit: null });
  expect(originRef(other, "refs/heads/archctx/projection")).toBeNull();

  // An owned path the apply did not report writing is refused as well.
  const third = writerFixture();
  const unreported = fakeApply(() => ({ files: { "docs/architecture/a.md": "a\n", "docs/architecture/b.md": "b\n" }, reported: ["docs/architecture/a.md"] }));
  const unreportedRun = await runProjectionPublishCommand({ cwd: third.clone, publisher, apply: unreported.apply, env: third.env });
  expect(unreportedRun.error).toMatchObject({ code: "AC_POLICY_VIOLATION" });
  expect(unreportedRun.error!.message).toContain("docs/architecture/b.md");
  expect(originRef(third, "refs/heads/archctx/projection")).toBeNull();
  expect(published).toHaveLength(0);
});

test("a live lock is busy, a dead owner's lock is recovered", async () => {
  const fixture = writerFixture();
  const paths = projectionWriterPaths(fixture.clone, "origin", "main", fixture.env);
  mkdirSync(paths.dir, { recursive: true });
  const { apply, calls } = fakeApply(() => ({ files: { "docs/architecture/overview.md": "# overview\n" } }));
  const { publisher } = recordingPublisher();

  createPrivateControlFile(paths.lock, JSON.stringify({ pid: process.pid, startedAt: "2026-10-20T00:00:00.000Z" }));
  const busy = await runProjectionPublishCommand({ cwd: fixture.clone, publisher, apply, env: fixture.env });
  expect(busy.ok).toBe(true);
  expect(runOf(busy)).toMatchObject({ result: "busy", holderPid: process.pid, baseSha: null, pushed: false });
  expect(calls).toHaveLength(0);
  expect(existsSync(paths.lock)).toBe(true);
  expect(existsSync(paths.state)).toBe(false);
  expect((runProjectionPublishStatusCommand({ cwd: fixture.clone, env: fixture.env }).data as any).running).toEqual({ pid: process.pid, startedAt: "2026-10-20T00:00:00.000Z" });

  rmSync(paths.lock);
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  createPrivateControlFile(paths.lock, JSON.stringify({ pid: dead, startedAt: "2026-10-20T00:00:00.000Z" }));
  const recovered = runOf(await runProjectionPublishCommand({ cwd: fixture.clone, publisher, apply, env: fixture.env }));
  expect(recovered.result).toBe("published");
  expect(existsSync(paths.lock)).toBe(false);
});

test("a branch outside archctx/, equal to the base, or an unknown remote is rejected before any fetch, lock or state", async () => {
  const fixture = writerFixture();
  const { apply, calls } = fakeApply(() => ({ files: { "docs/architecture/overview.md": "# overview\n" } }));
  const { publisher } = recordingPublisher();
  const before = git(fixture.clone, "rev-parse", "refs/remotes/origin/main");
  pushBaseCommit(fixture, "export const app = 3;\n");
  for (const [branch, base, remote] of [["main", "main", "origin"], ["feature/x", "main", "origin"], ["archctx/x", "archctx/x", "origin"], ["--force", "main", "origin"], ["archctx/x", "main", "upstream"], ["archctx/x", "main", "--upload-pack=x"]] as const) {
    const refused = await runProjectionPublishCommand({ cwd: fixture.clone, branch, base, remote, publisher, apply, env: fixture.env });
    expect(refused.ok, `${branch} ${base} ${remote}`).toBe(false);
    expect(refused.error?.code, `${branch} ${base} ${remote}`).toBe("AC_SCHEMA_INVALID");
    expect(refused.data).toBeUndefined();
  }
  expect(calls).toHaveLength(0);
  expect(git(fixture.clone, "rev-parse", "refs/remotes/origin/main")).toBe(before);
  expect(existsSync(join(fixture.env.ARCHCONTEXT_STATE_DIR, "repositories"))).toBe(false);
});

test("human-action-required pushes nothing and records the reason codes", async () => {
  const fixture = writerFixture();
  const { apply } = fakeApply(() => ({ status: "human-action-required", humanActions: [{ reasonCode: "unresolved-major-change", affectedNodeIds: [], requestPayloadDigest: "sha256:x" }, { reasonCode: "orphaned-document-review", affectedNodeIds: [], path: "docs/architecture/modules/gone.md", requestPayloadDigest: "sha256:x" }] }));
  const { publisher, calls } = recordingPublisher();
  const envelope = await runProjectionPublishCommand({ cwd: fixture.clone, publisher, apply, env: fixture.env, acceptObservedMajorChange: undefined });
  expect(envelope.ok).toBe(true);
  expect(runOf(envelope)).toMatchObject({
    result: "human-action-required",
    pushed: false,
    projectionStatus: "human-action-required",
    humanActions: [{ reasonCode: "unresolved-major-change" }, { reasonCode: "orphaned-document-review", path: "docs/architecture/modules/gone.md" }]
  });
  expect(originRef(fixture, "refs/heads/archctx/projection")).toBeNull();
  expect(calls).toHaveLength(0);

  // --accept-observed-major-change is forwarded to the apply request, and only then.
  const accepted = fakeApply(() => ({ status: "noop" }));
  await runProjectionPublishCommand({ cwd: fixture.clone, publisher, apply: accepted.apply, env: fixture.env, acceptObservedMajorChange: true });
  expect(accepted.calls[0]!.request.acceptObservedMajorChange).toBe(true);
});

test("a publisher failure records the pushed commit; the rerun retries the publisher only", async () => {
  const fixture = writerFixture();
  const { apply, calls } = fakeApply(() => ({ files: { "docs/architecture/overview.md": "# overview\n" } }));
  let failing = true;
  const { publisher, calls: published } = recordingPublisher("gh", () => failing);
  const failed = await runProjectionPublishCommand({ cwd: fixture.clone, publisher, apply, env: fixture.env });
  expect(failed.ok).toBe(false);
  expect(failed.error).toMatchObject({ code: "AC_PRECONDITION_FAILED", reasonCode: "projection-publisher-failed" });
  const failedRun = runOf(failed);
  expect(failedRun).toMatchObject({ result: "failed", pushed: true, files: ["docs/architecture/overview.md"] });
  const tip = originRef(fixture, "refs/heads/archctx/projection");
  expect(failedRun.publishedCommit).toBe(tip);

  failing = false;
  const retried = runOf(await runProjectionPublishCommand({ cwd: fixture.clone, publisher, apply, env: fixture.env }));
  expect(retried).toMatchObject({ result: "published", pushed: false, publishedCommit: tip, files: ["docs/architecture/overview.md"], pullRequest: { number: 7 } });
  expect(calls).toHaveLength(1);
  expect(published).toHaveLength(2);
  expect(published[1]!.commitSha).toBe(tip!);
  expect(originRef(fixture, "refs/heads/archctx/projection")).toBe(tip);
  expect(runOf(await runProjectionPublishCommand({ cwd: fixture.clone, publisher, apply, env: fixture.env })).result).toBe("already-processed");
});

test("ARCHCONTEXT_EGRESS_MODE=local-only fails with AC_POLICY_VIOLATION before any fetch", async () => {
  const fixture = writerFixture();
  const { apply, calls } = fakeApply(() => ({ files: { "docs/architecture/overview.md": "# overview\n" } }));
  const { publisher } = recordingPublisher();
  const before = git(fixture.clone, "rev-parse", "refs/remotes/origin/main");
  pushBaseCommit(fixture, "export const app = 4;\n");
  const denied = await runProjectionPublishCommand({ cwd: fixture.clone, publisher, apply, env: { ...fixture.env, ARCHCONTEXT_EGRESS_MODE: "local-only" } });
  expect(denied.ok).toBe(false);
  expect(denied.error).toMatchObject({ code: "AC_POLICY_VIOLATION", reasonCode: "egress-policy-denied" });
  expect(denied.error!.message).toContain("projection-publishing");
  expect(git(fixture.clone, "rev-parse", "refs/remotes/origin/main")).toBe(before);
  expect(calls).toHaveLength(0);
});

test("latest wins: a base tip that moves during the run is re-evaluated and the stale commit is never pushed", async () => {
  const fixture = writerFixture();
  let movedTo = "";
  const { apply, calls } = fakeApply((_worktree, request, call) => {
    if (call === 1) movedTo = pushBaseCommit(fixture, "export const app = 5;\n");
    return { files: { "docs/architecture/overview.md": `# overview for ${request.expected.headSha}\n` } };
  });
  const { publisher, calls: published } = recordingPublisher();
  const run = runOf(await runProjectionPublishCommand({ cwd: fixture.clone, publisher, apply, env: fixture.env }));
  expect(run).toMatchObject({ result: "published", baseSha: movedTo, iterations: 2, pushed: true });
  expect(calls.map((call) => call.request.expected.headSha)[1]).toBe(movedTo);
  const tip = originRef(fixture, "refs/heads/archctx/projection")!;
  expect(git(fixture.origin, "rev-list", "--parents", "-n", "1", tip).split(" ")).toEqual([tip, movedTo]);
  expect(published).toHaveLength(1);
  expect(published[0]!.baseSha).toBe(movedTo);
});

test("an apply failure is recorded as failed with its code, and code facts name the one-time codegraph init", async () => {
  const fixture = writerFixture();
  const { publisher } = recordingPublisher();
  const { apply } = fakeApply(() => ({ schemaVersion: "archcontext.envelope/v1", ok: false, requestId: "projection.run", error: { code: "AC_CODE_FACTS_UNAVAILABLE", reasonCode: "index-missing", message: "no CodeGraph index", severity: "error", retryable: true, action: "codegraph-init" } }) as JsonEnvelope);
  const failed = await runProjectionPublishCommand({ cwd: fixture.clone, publisher, apply, env: fixture.env });
  expect(failed.error).toMatchObject({ code: "AC_CODE_FACTS_UNAVAILABLE", reasonCode: "index-missing" });
  const paths = projectionWriterPaths(fixture.clone, "origin", "main", fixture.env);
  expect(failed.error!.message).toContain(`codegraph init ${paths.worktree}`);
  expect(runOf(failed)).toMatchObject({ result: "failed", pushed: false });
  const status = runProjectionPublishStatusCommand({ cwd: fixture.clone, env: fixture.env }).data as unknown as ProjectionPublishStatusV1;
  expect(status.lastRun?.result).toBe("failed");
  expect(status.lastSuccessfulSha).toBeNull();
});

test("the command publisher runs with only PATH, HOME and the ARCHCTX_PUBLISH_* inputs and parses its JSON stdout", async () => {
  const fixture = writerFixture();
  const record = join(fixture.root, "publisher-env.txt");
  const script = join(fixture.root, "publish.sh");
  writeFileSync(script, `#!/bin/sh\nenv > "${record}"\npwd >> "${record}"\nprintf '%s' '{"url":"https://example.test/pull/9","number":9}'\n`, "utf8");
  chmodSync(script, 0o755);
  process.env.ARCHCTX_WRITER_TEST_SENTINEL = "must-not-leak";
  try {
    const { apply } = fakeApply(() => ({ files: { "docs/architecture/overview.md": "# overview\n" } }));
    const run = runOf(await runProjectionPublishCommand({ cwd: fixture.clone, publisher: createCommandProjectionPublisher({ command: script, env: fixture.env }), apply, env: fixture.env }));
    expect(run).toMatchObject({ result: "published", publisher: "command", pullRequest: { url: "https://example.test/pull/9", number: 9 } });
    const recorded = readFileSync(record, "utf8");
    const baseSha = git(fixture.dev, "rev-parse", "HEAD");
    expect(recorded).toContain("ARCHCTX_PUBLISH_REMOTE=origin");
    expect(recorded).toContain("ARCHCTX_PUBLISH_BASE=main");
    expect(recorded).toContain("ARCHCTX_PUBLISH_BRANCH=archctx/projection");
    expect(recorded).toContain(`ARCHCTX_PUBLISH_BASE_SHA=${baseSha}`);
    expect(recorded).toContain(`ARCHCTX_PUBLISH_COMMIT=${run.publishedCommit}`);
    expect(recorded).toContain(`ARCHCTX_PUBLISH_TITLE=chore(projection): refresh generated architecture outputs for main@${baseSha.slice(0, 12)}`);
    expect(recorded).toContain("ARCHCTX_PUBLISH_BODY_FILE=");
    expect(recorded).not.toContain("ARCHCTX_WRITER_TEST_SENTINEL");
    expect(recorded).not.toContain("GIT_AUTHOR_NAME");
    expect(recorded).toContain(projectionWriterPaths(fixture.clone, "origin", "main", fixture.env).worktree.split("/").pop()!);

    // Output that is not a JSON object is ignored; a non-zero exit is a failure.
    const failing = join(fixture.root, "fail.sh");
    writeFileSync(failing, "#!/bin/sh\necho nope >&2\nexit 3\n", "utf8");
    chmodSync(failing, 0o755);
    const input: ProjectionPublisherInput = { worktree: fixture.clone, remote: "origin", base: "main", branch: "archctx/projection", baseSha, commitSha: baseSha, title: "t", bodyFile: record };
    await expect(createCommandProjectionPublisher({ command: failing, env: fixture.env }).ensurePullRequest(input)).rejects.toThrow("nope");
    const plain = join(fixture.root, "plain.sh");
    writeFileSync(plain, "#!/bin/sh\necho opened a pull request\n", "utf8");
    chmodSync(plain, 0o755);
    expect(await createCommandProjectionPublisher({ command: plain, env: fixture.env }).ensurePullRequest(input)).toEqual({});
  } finally {
    delete process.env.ARCHCTX_WRITER_TEST_SENTINEL;
  }
});

test("the gh publisher lists, then creates or edits, with no shell and prompts disabled", async () => {
  const input: ProjectionPublisherInput = { worktree: "/owned/worktree", remote: "origin", base: "main", branch: "archctx/projection", baseSha: "a".repeat(40), commitSha: "b".repeat(40), title: "chore(projection): refresh", bodyFile: "/tmp/body.md" };
  const fakeGh = (listed: string) => {
    const calls: { file: string; args: string[]; cwd: string; env: Record<string, string> }[] = [];
    const exec: ProjectionPublisherExec = async (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd, env: options.env });
      if (args[1] === "list") return { stdout: listed };
      if (args[1] === "create") return { stdout: "https://github.com/example/repo/pull/12\n" };
      return { stdout: "" };
    };
    return { exec, calls };
  };

  const created = fakeGh("[]");
  expect(await createGhProjectionPublisher({ exec: created.exec, env: {} }).ensurePullRequest(input)).toEqual({ url: "https://github.com/example/repo/pull/12", number: 12 });
  expect(created.calls.map((call) => [call.file, ...call.args])).toEqual([
    ["gh", "pr", "list", "--head", "archctx/projection", "--base", "main", "--state", "open", "--json", "number,url", "--limit", "1"],
    ["gh", "pr", "create", "--base", "main", "--head", "archctx/projection", "--title", "chore(projection): refresh", "--body-file", "/tmp/body.md"]
  ]);
  for (const call of created.calls) {
    expect(call.cwd).toBe("/owned/worktree");
    expect(call.env.GH_PROMPT_DISABLED).toBe("1");
  }

  const edited = fakeGh('[{"number":5,"url":"https://github.com/example/repo/pull/5"}]');
  expect(await createGhProjectionPublisher({ exec: edited.exec, env: {} }).ensurePullRequest(input)).toEqual({ url: "https://github.com/example/repo/pull/5", number: 5 });
  expect(edited.calls.map((call) => call.args)).toEqual([
    ["pr", "list", "--head", "archctx/projection", "--base", "main", "--state", "open", "--json", "number,url", "--limit", "1"],
    ["pr", "edit", "5", "--title", "chore(projection): refresh", "--body-file", "/tmp/body.md"]
  ]);

  const denied = fakeGh("[]");
  await expect(createGhProjectionPublisher({ exec: denied.exec, env: { ARCHCONTEXT_EGRESS_MODE: "local-only" } }).ensurePullRequest(input)).rejects.toThrow("egress-denied: projection-publishing");
  expect(denied.calls).toHaveLength(0);
  expect(createNoneProjectionPublisher().kind).toBe("none");
});

test("the follow loop runs one publish per interval until stopped", async () => {
  const slept: number[] = [];
  let runs = 0;
  const results: JsonEnvelope[] = [];
  const count = await runProjectionPublishFollow({
    runOnce: async () => {
      runs += 1;
      if (runs === 2) throw new Error("transient");
      return okEnvelope("projection.publish", { run: runs });
    },
    intervalMs: 300_000,
    sleep: async (ms) => { slept.push(ms); },
    shouldStop: () => runs >= 3,
    onResult: (envelope) => results.push(envelope)
  });
  expect(count).toBe(3);
  expect(slept).toEqual([300_000, 300_000]);
  expect(results.map((envelope) => envelope.ok)).toEqual([true, false, true]);
  expect(results[1]!.requestId).toBe("projection.publish");
});
