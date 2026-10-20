import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { jsonSchemaResolver, stableYaml, validateJsonSchema, type Json, type ProjectionPrVerificationV1, type ProjectionPublishRunV1, type ProjectionPublishStatusV1 } from "@archcontext/contracts";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider, declareOptionalCodeFacts } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { createStartedDaemon, projectionWriterPaths, runProjectionVerifyPrCommand } from "@archcontext/local-runtime/runtime-daemon";
import { runCli } from "../src/main";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../../..");
const schema = (name: string) => JSON.parse(readFileSync(join(REPOSITORY_ROOT, "schemas/runtime", name), "utf8"));
const RUN_SCHEMA = schema("projection-publish-run.schema.json");
const STATUS_SCHEMA = schema("projection-publish-status.schema.json");
const VERIFY_SCHEMA = schema("projection-pr-verification.schema.json");
const resolveSchema = jsonSchemaResolver([RUN_SCHEMA, STATUS_SCHEMA, VERIFY_SCHEMA]);
const TEST_TIMEOUT_MS = process.platform === "win32" ? 240_000 : 120_000;

const ENV = {
  GIT_AUTHOR_NAME: "ArchContext Writer Test",
  GIT_AUTHOR_EMAIL: "writer@example.test",
  GIT_COMMITTER_NAME: "ArchContext Writer Test",
  GIT_COMMITTER_EMAIL: "writer@example.test",
  DO_NOT_TRACK: "1"
};
const previousEnv: Record<string, string | undefined> = {};
let stateRoot = "";

beforeAll(() => {
  stateRoot = mkdtempSync(join(tmpdir(), "archctx-writer-cli-state-"));
  for (const [key, value] of Object.entries({ ...ENV, ARCHCONTEXT_STATE_DIR: stateRoot })) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }
});

afterAll(() => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(stateRoot, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function expectSchema(value: unknown, documentSchema: unknown): void {
  expect(validateJsonSchema(documentSchema as any, value as Json, { resolveSchema }).issues).toEqual([]);
}

function dataOf<T>(envelope: { ok: boolean; requestId: string; data?: unknown }, requestId: string, documentSchema: unknown): T {
  expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
  expect(envelope.requestId).toBe(requestId);
  expectSchema(envelope.data, documentSchema);
  return envelope.data as unknown as T;
}

async function startDaemon() {
  return createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
}

/**
 * A bare origin whose `main` carries one capability with a declared source footprint and its
 * committed repo-harness/v1 documentation, plus a clone the writer runs from.
 */
async function projectedOrigin(daemon: Awaited<ReturnType<typeof startDaemon>>) {
  const root = mkdtempSync(join(tmpdir(), "archctx-writer-cli-"));
  const origin = join(root, "origin.git");
  const dev = join(root, "dev");
  const clone = join(root, "clone");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  mkdirSync(join(dev, "app/src"), { recursive: true });
  writeFileSync(join(dev, "README.md"), "# writer CLI fixture\n", "utf8");
  writeFileSync(join(dev, "app/src/index.ts"), "export const app = 1;\n", "utf8");
  initializeArchContextModel(dev, "Writer CLI Fixture");
  declareOptionalCodeFacts(dev);
  rmSync(join(dev, ".archcontext/model/nodes/capability.architecture.context.yaml"), { force: true });
  writeFileSync(join(dev, ".archcontext/model/nodes/capability.app.service.yaml"), stableYaml({
    schemaVersion: "archcontext.node/v2",
    id: "capability.app.service",
    kind: "capability",
    name: "App Service",
    status: "active",
    summary: "Serves the application.",
    source: { include: ["app/**"] },
    extensions: { contractFiles: { agents: "app/AGENTS.md", claude: "app/CLAUDE.md" } }
  }), "utf8");
  // A relation and a flow keep the capability's P1/P2 proofs resolvable, so a source change is stamp-only.
  mkdirSync(join(dev, ".archcontext/model/relations"), { recursive: true });
  writeFileSync(join(dev, ".archcontext/model/relations/relation.app-journal.yaml"), stableYaml({
    schemaVersion: "archcontext.relation/v1",
    id: "relation.app-journal",
    kind: "writes",
    source: "capability.app.service",
    target: "capability.app.service",
    intent: "Persist app events"
  }), "utf8");
  mkdirSync(join(dev, ".archcontext/model/flows"), { recursive: true });
  writeFileSync(join(dev, ".archcontext/model/flows/flow.app.yaml"), stableYaml({
    schemaVersion: "archcontext.flow/v1",
    id: "flow.app",
    capabilityId: "capability.app.service",
    name: "app flow",
    applicability: "not-applicable",
    rationale: "The writer fixture only validates projection publishing."
  }), "utf8");
  git(dev, "init", "-q", "-b", "main");
  git(dev, "config", "core.autocrlf", "false");
  git(dev, "add", "-A");
  git(dev, "commit", "-q", "-m", "fixture");
  const baseline = await runCli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"], dev, { runtimeClient: daemon });
  expect(baseline.ok, JSON.stringify(baseline)).toBe(true);
  git(dev, "add", "-A");
  git(dev, "commit", "-q", "-m", "project architecture documentation");
  git(dev, "remote", "add", "origin", origin);
  git(dev, "push", "-q", "origin", "main");
  git(root, "clone", "-q", origin, clone);
  git(clone, "config", "core.autocrlf", "false");
  return { root, origin, dev, clone };
}

test("projection publish pushes a generated-only commit for a stamp-only source change, then is a no-op; publish-status reports it", async () => {
  const daemon = await startDaemon();
  const fixture = await projectedOrigin(daemon);
  try {
    // A source change inside the declared footprint moves only the projection stamps.
    writeFileSync(join(fixture.dev, "app/src/index.ts"), "export const app = 2;\n", "utf8");
    git(fixture.dev, "commit", "-q", "-am", "change app source");
    git(fixture.dev, "push", "-q", "origin", "main");
    const baseSha = git(fixture.dev, "rev-parse", "HEAD");

    const published = dataOf<ProjectionPublishRunV1>(
      await runCli("projection", ["publish", "--publisher", "none", "--json"], fixture.clone, { runtimeClient: daemon }),
      "projection.publish",
      RUN_SCHEMA
    );
    expect(published).toMatchObject({ result: "published", baseSha, pushed: true, publisher: "none", pullRequest: null, branch: "archctx/projection", projectionStatus: "applied", iterations: 1 });
    const tip = git(fixture.origin, "rev-parse", "refs/heads/archctx/projection");
    expect(published.publishedCommit).toBe(tip);
    expect(git(fixture.origin, "rev-list", "--parents", "-n", "1", tip).split(" ")).toEqual([tip, baseSha]);
    const touched = git(fixture.origin, "diff-tree", "--no-commit-id", "--name-only", "-r", tip).split("\n").filter(Boolean).sort();
    expect(touched.length).toBeGreaterThan(0);
    expect(touched).toEqual(published.files);
    expect(touched.every((path) => path.startsWith("docs/architecture/"))).toBe(true);
    expect(git(fixture.origin, "rev-parse", "refs/heads/main")).toBe(baseSha);
    // The writer worked in its own worktree; the clone the operator runs from is untouched.
    expect(git(fixture.clone, "status", "--porcelain")).toBe("");

    const again = dataOf<ProjectionPublishRunV1>(
      await runCli("projection", ["publish", "--publisher", "none"], fixture.clone, { runtimeClient: daemon }),
      "projection.publish",
      RUN_SCHEMA
    );
    expect(again).toMatchObject({ result: "already-processed", baseSha, pushed: false, publishedCommit: tip });
    expect(git(fixture.origin, "rev-parse", "refs/heads/archctx/projection")).toBe(tip);

    const status = dataOf<ProjectionPublishStatusV1>(
      await runCli("projection", ["publish-status", "--json"], fixture.clone, { runtimeClient: daemon }),
      "projection.publish-status",
      STATUS_SCHEMA
    );
    expect(status).toMatchObject({
      remote: "origin",
      base: "main",
      branch: "archctx/projection",
      worktreePath: projectionWriterPaths(fixture.clone, "origin", "main").worktree,
      running: null,
      lastProcessedSha: baseSha,
      lastSuccessfulSha: baseSha,
      lastRun: { result: "already-processed" }
    });

    // verify-pr on the writer's own branch: generated-only and render-equivalent.
    git(fixture.clone, "fetch", "-q", "origin", "+refs/heads/archctx/projection:refs/remotes/origin/archctx/projection");
    git(fixture.clone, "checkout", "-q", "--detach", "origin/archctx/projection");
    const verified = dataOf<ProjectionPrVerificationV1>(
      await runCli("projection", ["verify-pr", "--base", "origin/main", "--json"], fixture.clone),
      "projection.verify-pr",
      VERIFY_SCHEMA
    );
    expect(verified).toMatchObject({
      verdict: "generated-only-render-equivalent",
      baseSha,
      headSha: tip,
      mergeBase: baseSha,
      changedPaths: touched,
      nonGeneratedPaths: [],
      generatedOnly: true,
      renderEquivalent: true,
      differingPaths: [],
      projectionStatus: "noop"
    });

    // A hand edit inside a generated region is generated-only but not what the projection renders.
    const edited = git(fixture.clone, "ls-files", "docs/architecture").split("\n")
      .find((path) => path.endsWith(".md") && readFileSync(join(fixture.clone, path), "utf8").includes("<!-- BEGIN ARCHCONTEXT:generated"));
    if (!edited) throw new Error("the fixture projection has no document with a generated region");
    const body = readFileSync(join(fixture.clone, edited), "utf8");
    const marker = body.indexOf("\n", body.indexOf("<!-- BEGIN ARCHCONTEXT:generated"));
    writeFileSync(join(fixture.clone, edited), `${body.slice(0, marker + 1)}Hand-written claim.\n${body.slice(marker + 1)}`, "utf8");
    git(fixture.clone, "commit", "-q", "-am", "hand edit a generated region");
    const handEdited = dataOf<ProjectionPrVerificationV1>(
      await runCli("projection", ["verify-pr", "--base", "origin/main"], fixture.clone),
      "projection.verify-pr",
      VERIFY_SCHEMA
    );
    expect(handEdited).toMatchObject({ verdict: "generated-only-not-render-equivalent", generatedOnly: true, renderEquivalent: false, nonGeneratedPaths: [] });
    expect(handEdited.differingPaths).toContain(edited);

    // A source path in the diff is answered from the diff alone; the check is never invoked.
    writeFileSync(join(fixture.clone, "app/src/index.ts"), "export const app = 3;\n", "utf8");
    git(fixture.clone, "commit", "-q", "-am", "smuggle a source change");
    const smuggled = dataOf<ProjectionPrVerificationV1>(
      await runCli("projection", ["verify-pr", "--base", "origin/main"], fixture.clone),
      "projection.verify-pr",
      VERIFY_SCHEMA
    );
    expect(smuggled).toMatchObject({ verdict: "touches-non-generated", nonGeneratedPaths: ["app/src/index.ts"], generatedOnly: false, renderEquivalent: null, projectionStatus: null });
    let checks = 0;
    const injected = runProjectionVerifyPrCommand({ cwd: fixture.clone, base: "origin/main", check: () => { checks += 1; throw new Error("verify-pr rendered a diff that touches source"); } });
    expect((injected.data as any)?.verdict, JSON.stringify(injected)).toBe("touches-non-generated");
    expect(checks).toBe(0);

    // A dirty tracked worktree is refused; an empty diff is no-changes.
    writeFileSync(join(fixture.clone, "README.md"), "# dirty\n", "utf8");
    const dirty = await runCli("projection", ["verify-pr", "--base", "origin/main"], fixture.clone);
    expect(dirty).toMatchObject({ ok: false, requestId: "projection.verify-pr", error: { code: "AC_PRECONDITION_FAILED", reasonCode: "projection-verify-pr-worktree-dirty" } });
    git(fixture.clone, "checkout", "-q", "--", "README.md");
    git(fixture.clone, "checkout", "-q", "--detach", "origin/main");
    const empty = dataOf<ProjectionPrVerificationV1>(
      await runCli("projection", ["verify-pr", "--base", "origin/main"], fixture.clone),
      "projection.verify-pr",
      VERIFY_SCHEMA
    );
    expect(empty).toMatchObject({ verdict: "no-changes", changedPaths: [], generatedOnly: false, renderEquivalent: null, headSha: baseSha });
  } finally {
    await daemon.stop();
    rmSync(fixture.root, { recursive: true, force: true });
  }
}, TEST_TIMEOUT_MS);

test("projection publish, publish-status and verify-pr refuse bad arguments before any Git or network work", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "archctx-writer-cli-args-"));
  const unreachable = new Proxy({}, { get: () => () => { throw new Error("argument errors reached the runtime"); } }) as any;
  try {
    for (const [args, requestId] of [
      [["publish", "--publisher", "carrier-pigeon"], "projection.publish"],
      [["publish", "--publisher", "command"], "projection.publish"],
      [["publish", "--publisher-command", "/bin/true"], "projection.publish"],
      [["publish", "--interval", "300"], "projection.publish"],
      [["publish", "--follow", "--interval", "5"], "projection.publish"],
      [["publish", "--follow"], "projection.publish"],
      [["publish", "stray"], "projection.publish"],
      [["publish-status", "stray"], "projection.publish-status"],
      [["verify-pr"], "projection.verify-pr"]
    ] as const) {
      const refused = await runCli("projection", [...args], cwd, { runtimeClient: unreachable });
      expect(refused, args.join(" ")).toMatchObject({ ok: false, requestId, error: { code: "AC_SCHEMA_INVALID" } });
    }
    // Flags of one writer subcommand are not accepted by another.
    expect(await runCli("projection", ["verify-pr", "--base", "main", "--branch", "archctx/x"], cwd)).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
    expect(await runCli("projection", ["publish-status", "--publisher", "none"], cwd)).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
    for (const subcommand of ["publish", "publish-status", "verify-pr"]) {
      const help = await runCli("projection", [subcommand, "--help"], cwd, { runtimeClient: unreachable });
      expect(help.ok, subcommand).toBe(true);
      expect((help.data as any).usage, subcommand).toContain(`archctx projection ${subcommand}`);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
