import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync as nodeRmSync, writeFileSync, type RmDirOptions } from "node:fs";
import { createServer as createHttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { canonicalRepositoryRoot, computeWorktreeDigest, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { architectureDocumentationProjectionWorktreeDigest, loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { CodeGraphAdapter, codeGraphCliInvocation } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider, declareOptionalCodeFacts } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { createStartedDaemon, type RuntimeDaemonClient } from "@archcontext/local-runtime/runtime-daemon";
import { SqliteLocalStore, runtimeStatePaths } from "@archcontext/local-runtime/local-store-sqlite";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { ARCHCONTEXT_PRODUCT_VERSION, ARCHCTX_FEATURES, archctxCapabilities, digestJson, productVersionManifest, validateJsonSchema, projectionResultInvariantIssues, stableYaml, type AcceptedArchitectureChangeReferenceV1, type JsonEnvelope, type ProjectionRequestV1, type ProjectionResultV3 } from "@archcontext/contracts";
import { CLI_COMMAND_FLAGS, resolveCommandExitCode, runCapabilitiesCommand, runCli } from "../src/main";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../../..");
const CLI_ENTRY = join(REPOSITORY_ROOT, "packages/surfaces/cli/src/main.ts");
/** The dev launcher: under Bun on darwin it preloads the SQLite library that can open the index read-only. */
const CLI_LAUNCHER = join(REPOSITORY_ROOT, "packages/surfaces/cli/bin/archctx");
const CLI_PROCESS_TIMEOUT_MS = process.platform === "win32" ? 180_000 : 30_000;
const CLI_DOCS_TEST_TIMEOUT_MS = 15_000;
const DAEMON_TEST_TIMEOUT_MS = process.platform === "win32" ? 240_000 : 30_000;
// These scenarios perform the full adoption flow plus repeated real CodeGraph syncs. One scenario
// runs 19 CodeGraph handshakes (95 CLI launches): 62 s alone on macOS, 114 s on a loaded host.
const PROJECTION_CODEGRAPH_TEST_TIMEOUT_MS = 240_000;

function rmSync(path: string, options?: RmDirOptions): void {
  try {
    nodeRmSync(path, { maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100, ...options });
  } catch (error) {
    if (isIgnorableWindowsCleanupError(error)) return;
    throw error;
  }
}

function runTestCli(command: string, args: string[], root: string, stateRoot = testStateRoot(root)) {
  const previousStateDir = process.env.ARCHCONTEXT_STATE_DIR;
  process.env.ARCHCONTEXT_STATE_DIR = stateRoot;
  return runCli(command, args, root, {
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider()
  }).finally(() => {
    if (previousStateDir === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previousStateDir;
  });
}

function testStateRoot(root: string): string {
  return join(dirname(root), `.archctx-state-${basename(root)}`);
}

function testStateEnv(root: string): NodeJS.ProcessEnv {
  return { ...process.env, ARCHCONTEXT_STATE_DIR: testStateRoot(root) };
}

function testRuntimePaths(root: string) {
  return runtimeStatePaths(root, testStateEnv(root));
}

/** Worktree digests hash Git-visible files, so CLI fixtures that bind one are Git roots. */
function gitTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  return root;
}

function removeTempRoot(root: string): void {
  try {
    rmSync(testStateRoot(root), { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
    rmSync(root, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
  } catch (error) {
    if (isIgnorableWindowsCleanupError(error)) return;
    throw error;
  }
}

function isIgnorableWindowsCleanupError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return process.platform === "win32" && (code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY");
}

test("CLI capabilities exposes the exact local protocol and renderer handshake without daemon access", async () => {
  const capabilities = runCapabilitiesCommand();
  expect(capabilities).toEqual(archctxCapabilities(ARCHCONTEXT_PRODUCT_VERSION));
  expect(capabilities.features).toEqual([...ARCHCTX_FEATURES]);
  // Consumers gate on this handshake, not on field presence, because the result field is omitted
  // whenever no earlier attempt of the request committed.
  expect(capabilities.features).toContain("projection-prior-committed-applies-v1");
  expect(capabilities.renderers.architectureDocs).toBe("archcontext.docs-renderer/v6");
  const processOutput = execFileSync("bun", [CLI_ENTRY, "capabilities", "--json"], { encoding: "utf8" });
  expect(JSON.parse(processOutput)).toEqual(capabilities);
  expect(await runCli("capabilities", [], "/path/that/does/not/exist")).toEqual(capabilities);
  const invalid = await runCli("capabilities", ["unexpected"], "/path/that/does/not/exist");
  expect("ok" in invalid && invalid.ok).toBe(false);
});

test("CLI init help never calls the runtime, including with a product name", async () => {
  for (const args of [["--help"], ["-h"], ["--name", "Existing App", "--help"], ["--help", "--name", "Existing App"]]) {
    let initCalls = 0;
    const result = await runCli("init", args, "/path/that/does/not/exist", {
      runtimeClient: {
        init: async () => {
          initCalls += 1;
          throw new Error("Help must not initialize the model");
        }
      } as unknown as RuntimeDaemonClient
    });
    expect(initCalls).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.requestId).toBe("help");
    expect((result.data as any).usage).toContain("archctx init");
  }
});

/** One capability whose declared footprint is `README.md`, committed on a fresh Git repository. */
function seedProjectionProtocolFixture(root: string): void {
  nodeRmSync(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"), { force: true });
  writeFileSync(join(root, ".archcontext/model/nodes/capability.runtime-harness.hook-adapters.yaml"), stableYaml({
    schemaVersion: "archcontext.node/v2",
    id: "capability.runtime-harness.hook-adapters",
    kind: "capability",
    name: "Hook Adapters",
    status: "active",
    summary: "Routes runtime hook events.",
    responsibilities: ["Own hook routing."],
    source: { include: ["README.md"] },
    extensions: { contractFiles: { agents: "AGENTS.md", claude: "CLAUDE.md" } }
  }), "utf8");
  mkdirSync(join(root, ".archcontext/model/flows"), { recursive: true });
  writeFileSync(join(root, ".archcontext/model/flows/flow.hook-adapters.yaml"), stableYaml({
    schemaVersion: "archcontext.flow/v1",
    id: "flow.hook-adapters",
    capabilityId: "capability.runtime-harness.hook-adapters",
    name: "Hook routing",
    applicability: "not-applicable",
    rationale: "The protocol fixture only validates the projection transport."
  }), "utf8");
  writeFileSync(join(root, "AGENTS.md"), "# Agent context\n", "utf8");
  writeFileSync(join(root, "CLAUDE.md"), "# Agent context\n", "utf8");
  git(root, "init");
  git(root, "add", ".");
  git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "projection protocol fixture");
}

function projectionProtocolExpectedSnapshot(root: string): ProjectionRequestV1["expected"] {
  return {
    repositoryId: repositoryFingerprint(root),
    workspaceId: `workspace.${digestJson({ root: canonicalRepositoryRoot(root) } as any).replace(/^sha256:/, "").slice(0, 16)}`,
    headSha: gitOut(root, "rev-parse", "HEAD"),
    worktreeDigest: architectureDocumentationProjectionWorktreeDigest(root, loadNativeModelFromArchContext(root), listGitVisibleFiles(root)) as `sha256:${string}`
  };
}

test("CLI projection run consumes ProjectionRequestV1 and returns a receipt-valid ProjectionResultV3", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-projection-"));
  writeFileSync(join(root, "README.md"), "# projection fixture\n", "utf8");
  initializeArchContextModel(root, "Projection App");
  declareOptionalCodeFacts(root);
  const daemon = await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
  const cli = (command: string, args: string[]) => runCli(command, args, root, { runtimeClient: daemon });
  try {
    seedProjectionProtocolFixture(root);
    const plan = await cli("docs", ["plan", "--profile", "repo-harness/v1"]);
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    const runtimeSnapshot = (plan.data as any).runtimeSnapshot;
    const request = {
      schemaVersion: "archcontext.projection-request/v1",
      requestId: "projection_request.cli_contract",
      profile: "repo-harness/v1",
      mode: "check",
      targets: ["architecture-docs"],
      changedPaths: ["README.md"],
      expected: {
        repositoryId: repositoryFingerprint(root),
        workspaceId: `workspace.${digestJson({ root: canonicalRepositoryRoot(root) } as any).replace(/^sha256:/, "").slice(0, 16)}`,
        headSha: gitOut(root, "rev-parse", "HEAD"),
        worktreeDigest: runtimeSnapshot.worktreeDigest
      }
    };
    mkdirSync(join(root, ".ai/harness/journal/post-edit/pending"), { recursive: true });
    writeFileSync(join(root, ".ai/harness/journal/post-edit/pending/change.json"), "{}\n", "utf8");
    const result = await cli("projection", ["run", "--request-json", JSON.stringify(request)]);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const projection = result.data as unknown as ProjectionResultV3;
    expect(projection.schemaVersion).toBe("archcontext.projection-result/v3");
    expect(projection.requestId).toBe(request.requestId);
    expect(projection.inputSnapshot).not.toBe(projection.outputSnapshot);
    expect(projectionResultInvariantIssues(projection)).toEqual([]);
    // Nothing has been projected yet, so `check` reports that nothing records a verification.
    expect(projection.freshness).toEqual({
      ok: false,
      reasonCodes: ["projection-manifest-missing"],
      staleTargets: []
    });

    const stale = await cli("projection", ["run", "--request-json", JSON.stringify({
      ...request,
      expected: { ...request.expected, worktreeDigest: `sha256:${"f".repeat(64)}` }
    })]);
    expect(stale.ok).toBe(false);
    expect((stale as any).error?.code).toBe("AC_PRECONDITION_FAILED");
    expect((stale as any).error).toMatchObject({reasonCode: "projection-snapshot-mismatch", details: {field: "worktreeDigest"}});

    const partialAcceptance = await cli("projection", ["run", "--request-json", JSON.stringify({
      ...request,
      acceptedChange: { changeSetId: "changeset.partial" }
    })]);
    expect(partialAcceptance.ok).toBe(false);
    expect((partialAcceptance as any).error?.code).toBe("AC_SCHEMA_INVALID");

    const nonCanonicalAcceptance = await cli("projection", ["run", "--request-json", JSON.stringify({
      ...request,
      acceptedChange: {
        changeSetId: "changeset.noncanonical",
        eventId: "architecture_event.noncanonical",
        reasonCodes: ["responsibility-changed", "ownership-changed"],
        affectedNodeIds: ["capability.z", "capability.a"]
      }
    })]);
    expect(nonCanonicalAcceptance.ok).toBe(false);
    expect((nonCanonicalAcceptance as any).error).toMatchObject({code: "AC_SCHEMA_INVALID", reasonCode: "projection-check-input-invalid"});
    expect((nonCanonicalAcceptance as any).error?.message).toContain("sorted and unique");
  } finally {
    await daemon.stop();
    removeTempRoot(root);
  }
}, CLI_DOCS_TEST_TIMEOUT_MS);

test("CLI check, complete and projection freshness report the same stale targets; a source-only edit stays fresh (#259)", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-projection-freshness-"));
  writeFileSync(join(root, "README.md"), "# projection fixture\n", "utf8");
  initializeArchContextModel(root, "Projection Freshness App");
  declareOptionalCodeFacts(root);
  const daemon = await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
  const cli = (command: string, args: string[]) => runCli(command, args, root, { runtimeClient: daemon });
  const nodeId = "capability.runtime-harness.hook-adapters";
  const nodePath = join(root, `.archcontext/model/nodes/${nodeId}.yaml`);
  const manifestPath = join(root, "docs/architecture/.projection-manifest.json");
  const noRuntime = new Proxy({}, {
    get(_target, property) {
      if (property === "then") return undefined;
      throw new Error(`projection freshness reached the runtime: ${String(property)}`);
    }
  }) as unknown as RuntimeDaemonClient;
  const commit = (message: string) => {
    git(root, "add", "-A");
    git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-q", "-m", message);
  };
  const run = async (mode: ProjectionRequestV1["mode"], requestId: string) => {
    const result = await cli("projection", ["run", "--request-json", JSON.stringify({
      schemaVersion: "archcontext.projection-request/v1",
      requestId,
      profile: "repo-harness/v1",
      mode,
      targets: ["agent-context", "architecture-docs"],
      changedPaths: [],
      expected: projectionProtocolExpectedSnapshot(root)
    } satisfies ProjectionRequestV1)]);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const projection = result.data as unknown as ProjectionResultV3;
    expect(projectionResultInvariantIssues(projection)).toEqual([]);
    expect(validateJsonSchema(JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../schemas/runtime/projection-result.schema.json"), "utf8")), projection as any).issues).toEqual([]);
    return projection;
  };
  const freshnessCommand = async () => {
    const result = await runCli("projection", ["freshness", "--json"], root, { runtimeClient: noRuntime });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    return (result as JsonEnvelope).data as unknown as { profile: string | null; freshness: NonNullable<ProjectionResultV3["freshness"]> };
  };
  const completeGate = async (task: string) => {
    const completed = await cli("complete", ["--task", task]);
    expect((completed.data as any).extensions.projectionFreshnessChecksSkipped, JSON.stringify(completed)).toBeUndefined();
    return (completed.data as any).extensions.projectionFreshnessGate;
  };
  try {
    seedProjectionProtocolFixture(root);
    const applied = await cli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"]);
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    commit("project architecture documentation");
    const fresh = { ok: true, reasonCodes: [], staleTargets: [] };

    // A committed edit inside the node's footprint that keeps its scale bucket renders no document differently.
    writeFileSync(join(root, "README.md"), "# projection fixture with hook routing notes\n", "utf8");
    commit("change the declared footprint");
    expect((await run("check", "projection_request.freshness_source_only")).freshness).toEqual(fresh);
    expect(await freshnessCommand()).toEqual({ profile: "repo-harness/v1", freshness: fresh });
    expect(await completeGate("finish after a source-only edit")).toBeUndefined();

    // A committed model edit that the node's document prints, without re-projecting.
    const committedRows = JSON.parse(readFileSync(manifestPath, "utf8")).targets as Record<string, { type: string; scope: { id?: string }; outputDigest: `sha256:${string}` }>;
    const nodeTargetId = Object.entries(committedRows).find(([, row]) => row.type === "entity-summary" && row.scope.id === nodeId)?.[0];
    if (!nodeTargetId) throw new Error("the fixture manifest has no row for the capability document");
    writeFileSync(nodePath, readFileSync(nodePath, "utf8").replace("Routes runtime hook events.", "Routes and validates runtime hook events."), "utf8");
    commit("change the capability summary");
    const manifestBefore = readFileSync(manifestPath, "utf8");
    const checked = (await run("check", "projection_request.freshness_stale")).freshness!;
    expect(checked.ok).toBe(false);
    expect(checked.reasonCodes).toEqual(["projection-output-changed"]);
    expect(checked.staleTargets.map((target) => target.targetId)).toContain(nodeTargetId);
    for (const target of checked.staleTargets) {
      expect(target.committedOutputDigest, target.targetId).toBe(committedRows[target.targetId]?.outputDigest ?? null);
      expect(target.renderedOutputDigest, target.targetId).not.toBe(target.committedOutputDigest);
    }
    // `check` is read-only: the committed projection and the worktree are untouched.
    expect(readFileSync(manifestPath, "utf8")).toBe(manifestBefore);
    expect(gitOut(root, "status", "--porcelain")).toBe("");
    // One evaluator over one render: projection freshness and the complete gate give check's answer.
    expect((await freshnessCommand()).freshness).toEqual(checked);
    const gate = await completeGate("finish after a model edit");
    expect({ ok: gate.ok, reasonCodes: gate.reasonCodes, staleTargets: gate.staleTargets }).toEqual(checked);

    // Only `check` carries the field.
    expect((await run("plan", "projection_request.freshness_plan")).freshness).toBeUndefined();
  } finally {
    await daemon.stop();
    removeTempRoot(root);
  }
}, PROJECTION_CODEGRAPH_TEST_TIMEOUT_MS);

test("CLI projection check under repo-harness/v1 is fresh after apply when a member node declares a footprint (#290)", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-projection-member-freshness-"));
  writeFileSync(join(root, "README.md"), "# projection fixture\n", "utf8");
  initializeArchContextModel(root, "Projection Member Freshness App");
  declareOptionalCodeFacts(root);
  const daemon = await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
  const cli = (command: string, args: string[]) => runCli(command, args, root, { runtimeClient: daemon });
  const capabilityId = "capability.runtime-harness.hook-adapters";
  const componentId = "component.runtime-harness.hook-engine";
  const commit = (message: string) => {
    git(root, "add", "-A");
    git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-q", "-m", message);
  };
  const check = async (requestId: string) => {
    const result = await cli("projection", ["run", "--request-json", JSON.stringify({
      schemaVersion: "archcontext.projection-request/v1",
      requestId,
      profile: "repo-harness/v1",
      mode: "check",
      targets: ["architecture-docs"],
      changedPaths: [],
      expected: projectionProtocolExpectedSnapshot(root)
    } satisfies ProjectionRequestV1)]);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const projection = result.data as unknown as ProjectionResultV3;
    expect(projectionResultInvariantIssues(projection)).toEqual([]);
    return projection.freshness;
  };
  try {
    seedProjectionProtocolFixture(root);
    // A member node with its own footprint. repo-harness/v1 writes no document for it.
    writeFileSync(join(root, `.archcontext/model/nodes/${componentId}.yaml`), stableYaml({
      schemaVersion: "archcontext.node/v2",
      id: componentId,
      kind: "component",
      name: "Hook Engine",
      status: "active",
      parent: capabilityId,
      summary: "Runs the routed hooks.",
      source: { include: ["src/engine/**"] }
    }), "utf8");
    mkdirSync(join(root, "src/engine"), { recursive: true });
    writeFileSync(join(root, "src/engine/index.ts"), "export const engine = 1;\n", "utf8");
    commit("declare a member footprint");
    const applied = await cli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"]);
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    commit("project architecture documentation");

    expect(await check("projection_request.member_freshness_clean")).toEqual({ ok: true, reasonCodes: [], staleTargets: [] });
  } finally {
    await daemon.stop();
    removeTempRoot(root);
  }
}, CLI_DOCS_TEST_TIMEOUT_MS);

function commitProjectionFixture(root: string, message: string): void {
  git(root, "add", "-A");
  git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-q", "-m", message);
}

/** The files a `docs plan` ChangeSet would write or delete, as the draft records them. */
function plannedProjectionFiles(plan: { data?: unknown }): { path: string; delete?: true }[] {
  const operation = (plan.data as any).draft.operations.find((entry: any) => entry.op === "render_projection");
  return operation?.projectionFiles ?? [];
}

test("repo-harness/v1 plans capability documents, the architecture history and the manifest only (#433)", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-433-plan-"));
  writeFileSync(join(root, "README.md"), "# projection fixture\n", "utf8");
  initializeArchContextModel(root, "Projection Targets App");
  declareOptionalCodeFacts(root);
  const daemon = await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
  const cli = (command: string, args: string[]) => runCli(command, args, root, { runtimeClient: daemon });
  try {
    seedProjectionProtocolFixture(root);
    const plan = await cli("docs", ["plan", "--profile", "repo-harness/v1"]);
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    expect(plannedProjectionFiles(plan).map((file) => file.path).sort()).toEqual([
      "docs/architecture/.projection-manifest.json",
      "docs/architecture/history.md",
      "docs/architecture/modules/runtime-harness/hook-adapters.md"
    ]);
  } finally {
    await daemon.stop();
    removeTempRoot(root);
  }
}, CLI_DOCS_TEST_TIMEOUT_MS);

test("repo-harness/v1 plans the topology pair beside capability documents when the model has topology (#433)", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-433-topology-"));
  writeFileSync(join(root, "README.md"), "# projection fixture\n", "utf8");
  initializeArchContextModel(root, "Projection Topology App");
  declareOptionalCodeFacts(root);
  const daemon = await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
  const cli = (command: string, args: string[]) => runCli(command, args, root, { runtimeClient: daemon });
  try {
    seedProjectionProtocolFixture(root);
    writeFileSync(join(root, ".archcontext/model/nodes/process.shop.web.yaml"), stableYaml({
      schemaVersion: "archcontext.node/v2",
      id: "process.shop.web",
      kind: "process",
      name: "Web",
      status: "active",
      summary: "Serves the storefront."
    }), "utf8");
    commitProjectionFixture(root, "declare a topology node");
    const plan = await cli("docs", ["plan", "--profile", "repo-harness/v1"]);
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    expect(plannedProjectionFiles(plan).map((file) => file.path).sort()).toEqual([
      "docs/architecture/.projection-manifest.json",
      "docs/architecture/diagrams/runtime-topology.mmd",
      "docs/architecture/history.md",
      "docs/architecture/modules/runtime-harness/hook-adapters.md",
      "docs/architecture/runtime-topology.md"
    ]);
  } finally {
    await daemon.stop();
    removeTempRoot(root);
  }
}, CLI_DOCS_TEST_TIMEOUT_MS);

test("repo-harness/v1 apply removes the intact whole-model files an earlier default projection recorded (#433)", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-433-retired-"));
  writeFileSync(join(root, "README.md"), "# projection fixture\n", "utf8");
  initializeArchContextModel(root, "Projection Migration App");
  declareOptionalCodeFacts(root);
  const daemon = await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
  const cli = (command: string, args: string[]) => runCli(command, args, root, { runtimeClient: daemon });
  const manifestPath = join(root, "docs/architecture/.projection-manifest.json");
  try {
    seedProjectionProtocolFixture(root);
    const defaultApply = await cli("docs", ["apply", "--profile", "default", "--approved"]);
    expect(defaultApply.ok, JSON.stringify(defaultApply)).toBe(true);
    commitProjectionFixture(root, "default profile projection");
    const retiredTypes = new Set(["architecture-index", "decision-index", "diagram-mermaid", "diagram-structurizr", "diagram-likec4"]);
    const globalPaths = (Object.values(JSON.parse(readFileSync(manifestPath, "utf8")).targets) as Array<{ type: string; path: string }>)
      .filter((target) => retiredTypes.has(target.type)).map((target) => target.path).sort();
    expect(globalPaths).toHaveLength(5);

    const plan = await cli("docs", ["plan", "--profile", "repo-harness/v1"]);
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    const planned = plannedProjectionFiles(plan);
    for (const path of globalPaths) {
      expect(planned.find((file) => file.path === path)?.delete, path).toBe(true);
    }

    const applied = await cli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"]);
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    for (const path of globalPaths) expect(existsSync(join(root, path)), path).toBe(false);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.profile).toBe("repo-harness/v1");
    // The fixture's contractFiles are the root files, which get no agent-context row (#580).
    expect(Object.values(manifest.targets).map((target: any) => [target.type, target.path])).toEqual([
      ["architecture-history", "docs/architecture/history.md"],
      ["entity-summary", "docs/architecture/modules/runtime-harness/hook-adapters.md"]
    ]);
  } finally {
    await daemon.stop();
    removeTempRoot(root);
  }
}, CLI_DOCS_TEST_TIMEOUT_MS);

test("repo-harness/v1 apply keeps and reports a hand-modified whole-model file (#433)", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-433-edited-"));
  writeFileSync(join(root, "README.md"), "# projection fixture\n", "utf8");
  initializeArchContextModel(root, "Projection Edited Global App");
  declareOptionalCodeFacts(root);
  const daemon = await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
  const cli = (command: string, args: string[]) => runCli(command, args, root, { runtimeClient: daemon });
  const manifestPath = join(root, "docs/architecture/.projection-manifest.json");
  const editedPath = "docs/architecture/index.md";
  try {
    seedProjectionProtocolFixture(root);
    const defaultApply = await cli("docs", ["apply", "--profile", "default", "--approved"]);
    expect(defaultApply.ok, JSON.stringify(defaultApply)).toBe(true);
    commitProjectionFixture(root, "default profile projection");
    const edited = `${readFileSync(join(root, editedPath), "utf8")}\nHuman note outside the generated region.\n`;
    writeFileSync(join(root, editedPath), edited, "utf8");
    const manifestBefore = readFileSync(manifestPath, "utf8");

    const refused = await cli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"]);
    expect(refused.ok).toBe(false);
    expect((refused as any).error).toMatchObject({
      code: "AC_PRECONDITION_FAILED",
      reasonCode: "projection-orphan-review-required",
      details: { issueCount: 1 }
    });
    // The edited global file and the row that keeps it visible both remain.
    expect(readFileSync(join(root, editedPath), "utf8")).toBe(edited);
    expect(readFileSync(manifestPath, "utf8")).toBe(manifestBefore);

    const drift = await cli("docs", ["drift", "--profile", "repo-harness/v1"]);
    expect((drift.data as any).drift.orphans).toContainEqual(expect.objectContaining({ path: editedPath, disposition: "human-review" }));
  } finally {
    await daemon.stop();
    removeTempRoot(root);
  }
}, CLI_DOCS_TEST_TIMEOUT_MS);

test("a 0.13.0 default tree with a renderer floor re-baselines: a placeholder-only changelog is deleted, one with human text refuses (ADR-0057, #579)", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-540-changelog-"));
  writeFileSync(join(root, "README.md"), "# projection fixture\n", "utf8");
  initializeArchContextModel(root, "Retired Changelog App");
  declareOptionalCodeFacts(root);
  const daemon = await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
  const cli = (command: string, args: string[]) => runCli(command, args, root, { runtimeClient: daemon });
  const manifestPath = join(root, "docs/architecture/.projection-manifest.json");
  const indexPath = join(root, "docs/architecture/index.md");
  const changelogPath = join(root, "docs/architecture/changelog.md");
  const changelogId = "projection_target.architecture.changelog";
  const region = (targetId: string, body: string) => [
    `<!-- BEGIN ARCHCONTEXT:generated target="${targetId}" rendererVersion="archcontext.docs-renderer/v6" outputDigest="${digestJson({ targetId, body })}" -->`,
    body.trimEnd(),
    `<!-- END ARCHCONTEXT:generated target="${targetId}" -->`,
    ""
  ].join("\n");
  // Every 0.13.0 default projection committed this: no production caller passed a timeline.
  const placeholder = region(changelogId, "# Architecture Changelog\n\n- No accepted architecture ledger events selected for this projection.\n");
  const humanText = `${placeholder}\n## Notes\n\nMigrated the payment ledger in Q3.\n`;
  const withEntry = region(changelogId, "# Architecture Changelog\n\n- 2026-06-26T00:00:00.000Z — Added payment module\n");
  try {
    git(root, "init");
    commitProjectionFixture(root, "model");
    expect((await cli("docs", ["apply", "--profile", "default", "--approved"])).ok).toBe(true);
    const projected = readFileSync(manifestPath, "utf8");
    const indexBody = /-->\n([\s\S]*)\n<!-- END/.exec(readFileSync(indexPath, "utf8"))![1]!;
    // A 0.13.0 default tree differs from this release's only by the changelog, the index link to it
    // and a v3 manifest that records both. On an initialized model this derivation reproduces, byte
    // for byte, what the 0.13.0 release's own `docs apply --profile default` writes, with the
    // `minimumRendererVersion` floor that repo-harness's committed 0.13.0 manifest carries (#579).
    const index013 = region("projection_target.architecture.index", `${indexBody}\n- [Architecture changelog](changelog.md)\n`);
    const manifest013 = projected
      .replace("projection-manifest/v4", "projection-manifest/v3")
      .replace(/(\n  "rendererVersion": "[^"]+",\n)/, '$1  "minimumRendererVersion": "archcontext.docs-renderer/v6",\n')
      .replace(/("projection_target\.architecture\.index":\n.*"outputDigest":")sha256:[a-f0-9]{64}/, `$1${/outputDigest="([^"]+)"/.exec(index013)![1]}`)
      .replace('    "projection_target.architecture.index":', `    "${changelogId}":\n      {"type":"architecture-changelog","scope":{"kind":"changelog"},"path":"docs/architecture/changelog.md","ownership":"mixed","format":"markdown","outputDigest":"sha256:1f723aeb74466aae7d607eeab8c438a830c36f49a48e6622f868a8151afabea6"},\n    "projection_target.architecture.index":`);
    expect(placeholder).toContain("sha256:1f723aeb74466aae7d607eeab8c438a830c36f49a48e6622f868a8151afabea6");
    expect(manifest013).toContain('\n  "rendererVersion": "archcontext.docs-renderer/v6",\n  "minimumRendererVersion": "archcontext.docs-renderer/v6",\n');
    const tree013 = (changelog: string, manifest = manifest013) => {
      writeFileSync(manifestPath, manifest, "utf8");
      writeFileSync(indexPath, index013, "utf8");
      writeFileSync(changelogPath, changelog, "utf8");
      commitProjectionFixture(root, "the 0.13.0 projection");
    };

    // Human text around the region, an event entry, or a changelog with no marker is left for a human.
    for (const changelog of [humanText, withEntry, "# Changelog\n\nWritten by hand.\n"]) {
      tree013(changelog);
      const refused = await cli("docs", ["apply", "--profile", "default", "--approved"]);
      expect((refused as any).error).toMatchObject({ reasonCode: "projection-orphan-review-required", details: { issueCount: 1 } });
      expect(readFileSync(changelogPath, "utf8")).toBe(changelog);
      expect(readFileSync(manifestPath, "utf8")).toBe(manifest013);
    }

    // The superseded manifest's floor is evaluated against this engine: one above it refuses.
    const aboveEngine = manifest013.replace('"minimumRendererVersion": "archcontext.docs-renderer/v6"', '"minimumRendererVersion": "archcontext.docs-renderer/v7"');
    tree013(placeholder, aboveEngine);
    const refusedFloor = await cli("docs", ["apply", "--profile", "default", "--approved"]);
    expect((refusedFloor as any).error).toMatchObject({ code: "AC_PRECONDITION_FAILED", reasonCode: "projection-manifest-incompatible" });
    expect(readFileSync(manifestPath, "utf8")).toBe(aboveEngine);
    expect(readFileSync(changelogPath, "utf8")).toBe(placeholder);

    // The floor this engine meets lets the re-baseline replace the v3 manifest with a fresh v4 one;
    // the floor is not carried over.
    tree013(placeholder);
    const applied = await cli("docs", ["apply", "--profile", "default", "--approved"]);
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(existsSync(changelogPath)).toBe(false);
    expect(readFileSync(manifestPath, "utf8")).toBe(projected);
    expect(readFileSync(indexPath, "utf8")).not.toContain("changelog.md");
    commitProjectionFixture(root, "re-baseline");

    // After the re-baseline the v4 manifest is the only authority: a file at that path is not owned.
    writeFileSync(changelogPath, placeholder, "utf8");
    commitProjectionFixture(root, "a later file at the retired path");
    const drift = await cli("docs", ["drift", "--profile", "default"]);
    expect((drift.data as any).drift.ok, JSON.stringify(drift)).toBe(true);
    expect((await cli("docs", ["apply", "--profile", "default", "--approved"])).ok).toBe(true);
    expect(readFileSync(changelogPath, "utf8")).toBe(placeholder);
  } finally {
    await daemon.stop();
    removeTempRoot(root);
  }
}, CLI_DOCS_TEST_TIMEOUT_MS);

test("a 0.7.x tree re-baselines once its v5-marked whole-file outputs are removed from Git (#327)", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-docs-rebaseline-v2-"));
  writeFileSync(join(root, "README.md"), "# projection fixture\n", "utf8");
  initializeArchContextModel(root, "Docs Rebaseline App");
  declareOptionalCodeFacts(root);
  const daemon = await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
  const cli = (command: string, args: string[]) => runCli(command, args, root, { runtimeClient: daemon });
  const commit = (message: string) => {
    git(root, "add", "-A");
    git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-q", "-m", message);
  };
  const manifestPath = join(root, "docs/architecture/.projection-manifest.json");
  try {
    seedProjectionProtocolFixture(root);
    // A topology node keeps whole-file (`generated`) targets in the repo-harness profile, which is
    // what the 0.7.x tree below wraps in v5 markers.
    writeFileSync(join(root, ".archcontext/model/nodes/process.shop.web.yaml"), stableYaml({
      schemaVersion: "archcontext.node/v2",
      id: "process.shop.web",
      kind: "process",
      name: "Web",
      status: "active",
      summary: "Serves the storefront."
    }), "utf8");
    commit("declare a topology node");
    expect((await cli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"])).ok).toBe(true);
    commit("project architecture documentation");
    const check = async (requestId: string) => {
      const result = await cli("projection", ["run", "--request-json", JSON.stringify({
        schemaVersion: "archcontext.projection-request/v1",
        requestId,
        profile: "repo-harness/v1",
        mode: "check",
        targets: ["architecture-docs"],
        changedPaths: [],
        expected: projectionProtocolExpectedSnapshot(root)
      } satisfies ProjectionRequestV1)]);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const projection = result.data as unknown as ProjectionResultV3;
      return { status: projection.status, freshness: projection.freshness, humanActions: projection.humanActions.map((action) => action.reasonCode) };
    };
    // What a check reports on a tree this release projected itself; the re-baselined tree must
    // report the same.
    const projectedHere = await check("projection_request.projected_here");

    // The shape 0.7.x committed: a v2 manifest (only its schemaVersion is ever read) and whole-file
    // outputs wrapped in renderer v5 markers.
    const projected = JSON.parse(readFileSync(manifestPath, "utf8"));
    const wholeFilePaths = (Object.entries(projected.targets) as Array<[string, any]>)
      .filter(([, row]) => row.ownership === "generated")
      .map(([targetId, row]) => {
        const body = readFileSync(join(root, row.path), "utf8");
        writeFileSync(join(root, row.path), [
          `<!-- BEGIN ARCHCONTEXT:generated target="${targetId}" sourceDigest="sha256:${"b".repeat(64)}" rendererVersion="archcontext.docs-renderer/v5" outputDigest="sha256:${"c".repeat(64)}" -->`,
          body.trimEnd(),
          `<!-- END ARCHCONTEXT:generated target="${targetId}" -->`,
          ""
        ].join("\n"), "utf8");
        return row.path as string;
      })
      .sort();
    expect(wholeFilePaths.length).toBeGreaterThan(0);
    writeFileSync(manifestPath, `${JSON.stringify({ ...projected, schemaVersion: "archcontext.architecture-docs-projection-manifest/v2", rendererVersion: "archcontext.docs-renderer/v5" }, null, 2)}\n`, "utf8");
    commit("the 0.7.x projection");
    const markedBodies = wholeFilePaths.map((path) => readFileSync(join(root, path), "utf8"));

    const drift = await cli("docs", ["drift"]);
    expect(drift.ok).toBe(false);
    // The operator gets the found and supported formats plus the one-time re-baseline, not an
    // empty details object (#427).
    expect((drift as any).requestId).toBe("docs.drift");
    expect((drift as any).error).toMatchObject({
      code: "AC_PRECONDITION_FAILED",
      reasonCode: "projection-manifest-upgrade-required",
      action: "rebuild-plan",
      details: {
        manifestPath: "docs/architecture/.projection-manifest.json",
        foundSchemaVersion: "archcontext.architecture-docs-projection-manifest/v2",
        supportedSchemaVersion: "archcontext.architecture-docs-projection-manifest/v4",
        upgradeCommand: "archctx docs apply --approved --profile <default|repo-harness/v1>",
        migrationGuide: "docs/runbooks/architecture-documentation-projections.md"
      }
    });

    // The re-baseline names every whole-file output nothing vouches for, says how to remove them,
    // and writes nothing.
    const refused = await cli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"]);
    expect(refused.ok).toBe(false);
    const error = (refused as any).error;
    expect(error).toMatchObject({ code: "AC_PRECONDITION_FAILED", reasonCode: "projection-ambiguous-ownership" });
    expect(error.details).toEqual({
      paths: wholeFilePaths,
      pathCount: wholeFilePaths.length,
      omittedPathCount: 0,
      omittedCommandCount: 0,
      action: "remove-whole-file-outputs-and-reapply",
      commands: [`git rm -- ${wholeFilePaths.join(" ")}`, "archctx docs apply --approved --profile repo-harness/v1"]
    });
    for (const path of wholeFilePaths) expect(error.details.paths).toContain(path);
    expect(error.details.commands).toContain(`git rm -- ${wholeFilePaths.join(" ")}`);
    expect(wholeFilePaths.map((path) => readFileSync(join(root, path), "utf8"))).toEqual(markedBodies);
    expect(JSON.parse(readFileSync(manifestPath, "utf8")).schemaVersion).toBe("archcontext.architecture-docs-projection-manifest/v2");

    // The operator follows the named step once; the re-baseline then reaches a fixed point.
    git(root, "rm", "-q", "--", ...wholeFilePaths);
    commit("remove the 0.7.x whole-file outputs");
    const rebaselined = await cli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"]);
    expect(rebaselined.ok, JSON.stringify(rebaselined)).toBe(true);
    commit("re-baseline the projection");
    const rebaselinedManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(rebaselinedManifest.schemaVersion).toBe("archcontext.architecture-docs-projection-manifest/v4");
    // A downstream consumer can resolve every generated path from the migrated v4 `targets`.
    const targetPaths = Object.values(rebaselinedManifest.targets as Record<string, { path: string }>).map((row) => row.path);
    expect(targetPaths.length).toBeGreaterThan(0);
    for (const path of targetPaths) expect(existsSync(join(root, path))).toBe(true);
    for (const path of wholeFilePaths) expect(targetPaths).toContain(path);

    const again = await cli("docs", ["apply", "--approved"]);
    expect(again.ok, JSON.stringify(again)).toBe(true);
    expect((again.data as any).status).toBe("noop");
    const clean = await cli("docs", ["drift"]);
    expect(clean.ok).toBe(true);
    expect((clean.data as any).ok).toBe(true);
    expect(await check("projection_request.rebaselined")).toEqual(projectedHere);
    expect(projectedHere.freshness).toEqual({ ok: true, reasonCodes: [], staleTargets: [] });
  } finally {
    await daemon.stop();
    removeTempRoot(root);
  }
}, CLI_DOCS_TEST_TIMEOUT_MS);

test("CLI docs commands without --profile keep the profile of the committed manifest (#293)", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-docs-committed-profile-"));
  writeFileSync(join(root, "README.md"), "# projection fixture\n", "utf8");
  initializeArchContextModel(root, "Docs Committed Profile App");
  declareOptionalCodeFacts(root);
  const daemon = await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
  const cli = (command: string, args: string[]) => runCli(command, args, root, { runtimeClient: daemon });
  const commit = (message: string) => {
    git(root, "add", "-A");
    git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-q", "-m", message);
  };
  const gitOutput = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const generatedPaths = () => gitOutput("ls-files", "--others", "--cached", "--exclude-standard", "docs/architecture").trim().split("\n").sort();
  try {
    seedProjectionProtocolFixture(root);
    // No manifest yet: the default profile applies.
    const firstPlan = await cli("docs", ["plan"]);
    expect(firstPlan.ok, JSON.stringify(firstPlan)).toBe(true);
    expect((firstPlan.data as any).drift.ok).toBe(false);
    const defaultDrift = await cli("docs", ["drift"]);
    expect((defaultDrift.data as any).profile).toBe("default");

    const applied = await cli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"]);
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    commit("project architecture documentation");
    const committedPaths = generatedPaths();

    // The runbook commands name no profile; they keep the committed repo-harness/v1 layout.
    const drift = await cli("docs", ["drift"]);
    expect(drift.ok, JSON.stringify(drift)).toBe(true);
    expect((drift.data as any).profile).toBe("repo-harness/v1");
    expect((drift.data as any).drift.ok).toBe(true);
    const reapplied = await cli("docs", ["apply", "--approved"]);
    expect(reapplied.ok, JSON.stringify(reapplied)).toBe(true);
    expect((reapplied.data as any).status).toBe("noop");
    expect(gitOutput("status", "--porcelain", "docs/architecture")).toBe("");
    expect(generatedPaths()).toEqual(committedPaths);

    // An explicit --profile still selects the layout.
    const explicitDefault = await cli("docs", ["drift", "--profile", "default"]);
    expect((explicitDefault.data as any).profile).toBe("default");
    expect((explicitDefault.data as any).drift.ok).toBe(false);
  } finally {
    await daemon.stop();
    removeTempRoot(root);
  }
}, CLI_DOCS_TEST_TIMEOUT_MS);

test("CLI projection check never starts a runtime, writes runtime state or needs a task session (#259)", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-projection-check-daemonless-"));
  writeFileSync(join(root, "README.md"), "# projection fixture\n", "utf8");
  initializeArchContextModel(root, "Projection Daemonless Check App");
  declareOptionalCodeFacts(root);
  const checkStateRoot = join(dirname(root), `.archctx-check-state-${basename(root)}`);
  const checkRequest = (requestId: string): string => JSON.stringify({
    schemaVersion: "archcontext.projection-request/v1",
    requestId,
    profile: "repo-harness/v1",
    mode: "check",
    targets: ["agent-context", "architecture-docs"],
    changedPaths: [],
    expected: projectionProtocolExpectedSnapshot(root)
  } satisfies ProjectionRequestV1);
  try {
    seedProjectionProtocolFixture(root);
    // Setup only: one daemon-backed projection is committed, then that daemon is gone.
    const daemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: new TestLocalStore()
    });
    try {
      const applied = await runCli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"], root, { runtimeClient: daemon });
      expect(applied.ok, JSON.stringify(applied)).toBe(true);
    } finally {
      await daemon.stop();
    }
    git(root, "add", "-A");
    git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-q", "-m", "project architecture documentation");

    const worktreeBefore = gitOut(root, "status", "--porcelain", "--ignored");

    // In-process: every runtime member access throws, so any daemon, store or session use fails the run.
    let runtimeAccesses = 0;
    const noRuntime = new Proxy({}, {
      get(_target, property) {
        if (property === "then") return undefined;
        runtimeAccesses += 1;
        throw new Error(`projection check reached the runtime: ${String(property)}`);
      }
    }) as unknown as RuntimeDaemonClient;
    const previousStateDir = process.env.ARCHCONTEXT_STATE_DIR;
    process.env.ARCHCONTEXT_STATE_DIR = checkStateRoot;
    let inProcess: Awaited<ReturnType<typeof runCli>>;
    try {
      inProcess = await runCli("projection", ["run", "--request-json", checkRequest("projection_request.daemonless_in_process")], root, { runtimeClient: noRuntime });
    } finally {
      if (previousStateDir === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
      else process.env.ARCHCONTEXT_STATE_DIR = previousStateDir;
    }
    expect(inProcess.ok, JSON.stringify(inProcess)).toBe(true);
    expect(runtimeAccesses).toBe(0);
    const inProcessResult = (inProcess as JsonEnvelope).data as unknown as ProjectionResultV3;
    expect(projectionResultInvariantIssues(inProcessResult)).toEqual([]);
    expect(inProcessResult.priorCommittedApplies).toBeUndefined();
    expect(inProcessResult.freshness).toEqual({ ok: true, reasonCodes: [], staleTargets: [] });

    // Real process with no runtime client injected: no daemon is discovered or started.
    const processOutput = execFileSync("bun", [CLI_ENTRY, "projection", "run", "--request-json", checkRequest("projection_request.daemonless_process"), "--json"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ARCHCONTEXT_STATE_DIR: checkStateRoot },
      timeout: CLI_PROCESS_TIMEOUT_MS
    });
    const processed = JSON.parse(processOutput);
    expect(processed.ok, processOutput).toBe(true);
    expect(processed.data.freshness).toEqual(inProcessResult.freshness);

    // Neither run created runtime state (no store, no daemon lock or connection file), and the
    // repository is untouched.
    expect(existsSync(checkStateRoot)).toBe(false);
    expect(existsSync(runtimeStatePaths(root, { ...process.env, ARCHCONTEXT_STATE_DIR: checkStateRoot }).stateRoot)).toBe(false);
    expect(gitOut(root, "status", "--porcelain", "--ignored")).toBe(worktreeBefore);
  } finally {
    rmSync(checkStateRoot, { recursive: true, force: true });
    removeTempRoot(root);
  }
}, PROJECTION_CODEGRAPH_TEST_TIMEOUT_MS);

test("CLI projection snapshot returns the expected snapshot a request is checked against, without a runtime (#323)", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-projection-snapshot-"));
  writeFileSync(join(root, "README.md"), "# projection snapshot fixture\n", "utf8");
  initializeArchContextModel(root, "Projection Snapshot App");
  const stateRoot = join(dirname(root), `.archctx-snapshot-state-${basename(root)}`);
  try {
    seedProjectionProtocolFixture(root);
    writeFileSync(join(root, ".gitignore"), "node_modules/\ndist/\n", "utf8");
    git(root, "add", "-A");
    git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-q", "-m", "ignore build output");
    const noRuntime = new Proxy({}, {
      get(_target, property) {
        if (property === "then") return undefined;
        throw new Error(`projection snapshot reached the runtime: ${String(property)}`);
      }
    }) as unknown as RuntimeDaemonClient;

    const inProcess = await runCli("projection", ["snapshot", "--json"], root, { runtimeClient: noRuntime });
    expect(inProcess.ok, JSON.stringify(inProcess)).toBe(true);
    expect((inProcess as JsonEnvelope).requestId).toBe("projection.snapshot");
    const expected = ((inProcess as JsonEnvelope).data as unknown as { expected: ProjectionRequestV1["expected"] }).expected;
    expect(expected).toEqual(projectionProtocolExpectedSnapshot(root));

    // Gitignored output does not move the snapshot; a visible edit does.
    mkdirSync(join(root, "packages/a/node_modules/dep"), { recursive: true });
    writeFileSync(join(root, "packages/a/node_modules/dep/index.js"), "module.exports = 1;\n", "utf8");
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist/out.js"), "console.log(1);\n", "utf8");
    const afterIgnored = await runCli("projection", ["snapshot"], root, { runtimeClient: noRuntime });
    expect(((afterIgnored as JsonEnvelope).data as { expected: unknown }).expected).toEqual(expected);

    const processOutput = execFileSync("bun", [CLI_ENTRY, "projection", "snapshot", "--json"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ARCHCONTEXT_STATE_DIR: stateRoot },
      timeout: CLI_PROCESS_TIMEOUT_MS
    });
    expect(JSON.parse(processOutput).data.expected).toEqual(expected);
    expect(existsSync(stateRoot)).toBe(false);

    writeFileSync(join(root, "README.md"), "# projection snapshot fixture\n\nEdited.\n", "utf8");
    const afterEdit = await runCli("projection", ["snapshot", "--json"], root, { runtimeClient: noRuntime });
    const edited = ((afterEdit as JsonEnvelope).data as unknown as { expected: ProjectionRequestV1["expected"] }).expected;
    expect(edited.worktreeDigest).not.toBe(expected.worktreeDigest);
    expect(edited).toEqual(projectionProtocolExpectedSnapshot(root));

    const rejected = await runCli("projection", ["snapshot", "--request-json", "{}"], root, { runtimeClient: noRuntime });
    expect(rejected).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
    removeTempRoot(root);
  }
}, CLI_PROCESS_TIMEOUT_MS * 2);

test("CLI projection freshness answers check's freshness without a runtime or repository writes (#327)", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-projection-freshness-command-"));
  writeFileSync(join(root, "README.md"), "# projection fixture\n", "utf8");
  initializeArchContextModel(root, "Projection Freshness Command App");
  declareOptionalCodeFacts(root);
  const manifestPath = join(root, "docs/architecture/.projection-manifest.json");
  const stateRoot = join(dirname(root), `.archctx-freshness-state-${basename(root)}`);
  const commit = (message: string) => {
    git(root, "add", "-A");
    git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-q", "-m", message);
  };
  let runtimeAccesses = 0;
  const noRuntime = new Proxy({}, {
    get(_target, property) {
      if (property === "then") return undefined;
      runtimeAccesses += 1;
      throw new Error(`projection freshness reached the runtime: ${String(property)}`);
    }
  }) as unknown as RuntimeDaemonClient;
  const freshness = async (...args: string[]) => {
    const result = await runCli("projection", ["freshness", ...args], root, { runtimeClient: noRuntime });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((result as JsonEnvelope).requestId).toBe("projection.freshness");
    return (result as JsonEnvelope).data as unknown as {
      profile: string | null;
      freshness: NonNullable<ProjectionResultV3["freshness"]>;
    };
  };
  const checkFreshness = async (requestId: string) => {
    const result = await runCli("projection", ["run", "--request-json", JSON.stringify({
      schemaVersion: "archcontext.projection-request/v1",
      requestId,
      profile: "repo-harness/v1",
      mode: "check",
      targets: ["agent-context", "architecture-docs"],
      changedPaths: [],
      expected: projectionProtocolExpectedSnapshot(root)
    } satisfies ProjectionRequestV1)], root, { runtimeClient: noRuntime });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    return ((result as JsonEnvelope).data as unknown as ProjectionResultV3).freshness!;
  };
  try {
    seedProjectionProtocolFixture(root);
    // No manifest yet: the same answer check gives, and no profile to name.
    const unprojected = await freshness("--json");
    expect(unprojected).toEqual({
      profile: null,
      freshness: { ok: false, reasonCodes: ["projection-manifest-missing"], staleTargets: [] }
    });
    expect(unprojected.freshness).toEqual(await checkFreshness("projection_request.freshness_command_unprojected"));

    // Setup only: one daemon-backed projection is committed, then that daemon is gone.
    const daemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: new TestLocalStore()
    });
    try {
      const applied = await runCli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"], root, { runtimeClient: daemon });
      expect(applied.ok, JSON.stringify(applied)).toBe(true);
    } finally {
      await daemon.stop();
    }
    commit("project architecture documentation");

    // The committed fixed point: the answer equals check's.
    const fresh = await freshness("--json");
    expect(fresh).toEqual({
      profile: "repo-harness/v1",
      freshness: { ok: true, reasonCodes: [], staleTargets: [] }
    });
    expect(fresh.freshness).toEqual(await checkFreshness("projection_request.freshness_command_fresh"));
    expect(runtimeAccesses).toBe(0);

    // A real process with no runtime client: same answer, no runtime state, repository untouched.
    const worktreeBefore = gitOut(root, "status", "--porcelain", "--ignored");
    const manifestBefore = readFileSync(manifestPath, "utf8");
    const processOutput = execFileSync("bun", [CLI_ENTRY, "projection", "freshness", "--json"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ARCHCONTEXT_STATE_DIR: stateRoot },
      timeout: CLI_PROCESS_TIMEOUT_MS
    });
    expect(JSON.parse(processOutput).data).toEqual(fresh);
    expect(existsSync(stateRoot)).toBe(false);
    expect(gitOut(root, "status", "--porcelain", "--ignored")).toBe(worktreeBefore);
    expect(readFileSync(manifestPath, "utf8")).toBe(manifestBefore);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
    removeTempRoot(root);
  }
}, PROJECTION_CODEGRAPH_TEST_TIMEOUT_MS);

test("CLI projection freshness refuses non-Git roots, the removed --changed-path and unknown flags before reading anything (#327)", async () => {
  const noRuntime = new Proxy({}, {
    get(_target, property) {
      if (property === "then") return undefined;
      throw new Error(`projection freshness reached the runtime: ${String(property)}`);
    }
  }) as unknown as RuntimeDaemonClient;
  const nonGit = mkdtempSync(join(tmpdir(), "archctx-cli-freshness-non-git-"));
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-freshness-refusals-"));
  const formatStateRoot = join(dirname(root), `.archctx-freshness-format-state-${basename(root)}`);
  try {
    writeFileSync(join(nonGit, "README.md"), "# tmp\n", "utf8");
    expect(await runCli("projection", ["freshness", "--json"], nonGit, { runtimeClient: noRuntime })).toMatchObject({
      ok: false,
      requestId: "projection.freshness",
      error: { code: "AC_REPO_NOT_FOUND", reasonCode: "git-worktree-required" }
    });

    writeFileSync(join(root, "README.md"), "# projection fixture\n", "utf8");
    initializeArchContextModel(root, "Projection Freshness Refusals App");
    seedProjectionProtocolFixture(root);
    const freshness = (...args: string[]) => runCli("projection", ["freshness", ...args], root, { runtimeClient: noRuntime });
    // The flag table refuses unknown flags before the handler runs; --changed-path is no longer a flag.
    expect(await freshness("--bogus")).toMatchObject({ ok: false, requestId: "projection.freshness", error: { code: "AC_SCHEMA_INVALID" } });
    expect(await freshness("--changed-path", "README.md")).toMatchObject({ ok: false, requestId: "projection.freshness", error: { code: "AC_SCHEMA_INVALID" } });
    expect(await freshness("--request-json", "{}")).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
    expect(await freshness("extra")).toMatchObject({ ok: false, requestId: "projection.freshness", error: { code: "AC_SCHEMA_INVALID" } });
    expect(await freshness("--format")).toMatchObject({ ok: false, requestId: "projection.freshness", error: { code: "AC_SCHEMA_INVALID" } });
    // The global rendering flag is consumed with its value; the entry point renders it.
    for (const format of ["human", "json"]) {
      expect(await freshness("--format", format), format).toMatchObject({ ok: true, requestId: "projection.freshness" });
      expect(await freshness("--format", format, "--json"), format).toMatchObject({ ok: true, requestId: "projection.freshness" });
    }
    expect(await freshness("--format", "human", "--bogus")).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
    const humanOutput = execFileSync("bun", [CLI_ENTRY, "projection", "freshness", "--format", "human"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ARCHCONTEXT_STATE_DIR: formatStateRoot },
      timeout: CLI_PROCESS_TIMEOUT_MS
    });
    expect(humanOutput.startsWith("OK projection.freshness\n")).toBe(true);
    const help = await freshness("--help");
    expect(help).toMatchObject({ ok: true, data: { capability: "projection-freshness-v2" } });
    expect(ARCHCTX_FEATURES).toContain("projection-freshness-v2");
    expect(ARCHCTX_FEATURES).not.toContain("projection-freshness-v1");
    // No refusal wrote anything.
    expect(gitOut(root, "status", "--porcelain", "--ignored")).toBe("");
  } finally {
    rmSync(formatStateRoot, { recursive: true, force: true });
    removeTempRoot(nonGit);
    removeTempRoot(root);
  }
}, CLI_PROCESS_TIMEOUT_MS);

test("CLI flows check reports each selector proof status from a real index without a runtime or runtime state (#300)", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-flows-check-"));
  const checkStateRoot = join(dirname(root), `.archctx-flows-check-state-${basename(root)}`);
  const capabilityId = "capability.flows-check";
  const write = (path: string, lines: string[]) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `${lines.join("\n")}\n`, "utf8");
  };
  const sink = (id: string, path: string, symbol: string) => ({ id: `sink.flows.${id}`, path, symbol });
  const step = (id: string, sinkId: string) => ({
    id,
    from: "handler",
    to: "renderer",
    label: `Step ${id}`,
    evidence: { entrypointId: "entrypoint.flows.main", sourceSymbol: "handle", sinkId: `sink.flows.${sinkId}` }
  });
  try {
    writeFileSync(join(root, "README.md"), "# flows check fixture\n", "utf8");
    initializeArchContextModel(root, "Flows Check App");
    write("src/render.ts", ["export function renderBlock(): string {", "  return \"block\";", "}"]);
    write("src/util.ts", ["export function resolve(value: string): string {", "  return value;", "}"]);
    write("src/main.ts", [
      "import { resolve } from \"node:path\";",
      "import { renderBlock } from \"./render\";",
      "",
      "export function handle(): string {",
      "  resolve(\"a\");",
      "  return renderBlock();",
      "}"
    ]);
    write("src/wiring.ts", [
      "import { renderBlock } from \"./render\";",
      "",
      "function run(step: () => string): string {",
      "  return step();",
      "}",
      "",
      "export function wireRender(): string {",
      "  return run(renderBlock);",
      "}",
      "",
      "export const helper = (): string => renderBlock();",
      "",
      "export function outer(): string {",
      "  function helper(): string {",
      "    return renderBlock();",
      "  }",
      "  return helper();",
      "}"
    ]);
    writeFileSync(join(root, `.archcontext/model/nodes/${capabilityId}.yaml`), stableYaml({
      schemaVersion: "archcontext.node/v2",
      id: capabilityId,
      kind: "capability",
      name: "Flows Check",
      status: "active",
      summary: "Exercises every selector proof status.",
      source: {
        include: ["src/**"],
        entrypoints: [
          {
            id: "entrypoint.flows.main",
            path: "src/main.ts",
            symbols: [{ name: "handle", sinks: [sink("render", "src/render.ts", "renderBlock"), sink("resolve", "src/util.ts", "resolve")] }]
          },
          {
            id: "entrypoint.flows.wiring",
            path: "src/wiring.ts",
            symbols: [
              { name: "wireRender", sinks: [sink("wired-render", "src/render.ts", "renderBlock"), sink("wired-resolve", "src/util.ts", "resolve")] },
              { name: "helper", sinks: [sink("helper-render", "src/render.ts", "renderBlock")] }
            ]
          }
        ]
      }
    }), "utf8");
    for (const [id, name] of [["component.flows.handler", "Handler"], ["component.flows.renderer", "Renderer"]] as const) {
      writeFileSync(join(root, `.archcontext/model/nodes/${id}.yaml`), stableYaml({
        schemaVersion: "archcontext.node/v2",
        id,
        kind: "component",
        name,
        status: "active",
        parent: capabilityId,
        summary: `${name} of the flows check fixture.`
      }), "utf8");
    }
    mkdirSync(join(root, ".archcontext/model/relations"), { recursive: true });
    writeFileSync(join(root, ".archcontext/model/relations/relation.flows.handler-renderer.yaml"), stableYaml({
      schemaVersion: "archcontext.relation/v1",
      id: "relation.flows.handler-renderer",
      kind: "calls",
      source: "component.flows.handler",
      target: "component.flows.renderer",
      intent: "Render one block"
    }), "utf8");
    mkdirSync(join(root, ".archcontext/model/flows"), { recursive: true });
    writeFileSync(join(root, ".archcontext/model/flows/flow.flows-check.yaml"), stableYaml({
      schemaVersion: "archcontext.flow/v1",
      id: "flow.flows-check",
      capabilityId,
      name: "Render through the handler",
      applicability: "required",
      participants: [{ id: "handler", nodeId: "component.flows.handler" }, { id: "renderer", nodeId: "component.flows.renderer" }],
      steps: [step("render", "render"), step("resolve", "resolve")],
      outcomes: [
        { id: "rendered", kind: "success", label: "Rendered", steps: [step("rendered", "render")], terminal: { participant: "handler", label: "Return the block" } },
        { id: "failed", kind: "error", label: "Failed", steps: [step("failed", "render")], terminal: { participant: "handler", label: "Return the failure" } }
      ]
    }), "utf8");
    git(root, "init");
    git(root, "add", "-A");
    git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-q", "-m", "flows check fixture");
    const invocation = codeGraphCliInvocation("codegraph", root);
    execFileSync(invocation.command, [...invocation.argsPrefix, "init", root], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    // Like a projection, the check runs `codegraph sync`, which owns `.codegraph/`. Every other
    // path must stay untouched.
    const worktreeStatus = () => gitOut(root, "status", "--porcelain", "--ignored", "--", ".", ":(exclude).codegraph");
    const worktreeBefore = worktreeStatus();

    let runtimeAccesses = 0;
    const noRuntime = new Proxy({}, {
      get(_target, property) {
        if (property === "then") return undefined;
        runtimeAccesses += 1;
        throw new Error(`flows check reached the runtime: ${String(property)}`);
      }
    }) as unknown as RuntimeDaemonClient;
    const previousStateDir = process.env.ARCHCONTEXT_STATE_DIR;
    process.env.ARCHCONTEXT_STATE_DIR = checkStateRoot;
    let inProcess: Awaited<ReturnType<typeof runCli>>;
    try {
      inProcess = await runCli("flows", ["check", "--json"], root, { runtimeClient: noRuntime });
    } finally {
      if (previousStateDir === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
      else process.env.ARCHCONTEXT_STATE_DIR = previousStateDir;
    }
    expect(inProcess.ok, JSON.stringify(inProcess)).toBe(true);
    expect(runtimeAccesses).toBe(0);
    const check = (inProcess as JsonEnvelope).data as any;
    expect(validateJsonSchema(JSON.parse(readFileSync(join(REPOSITORY_ROOT, "schemas/runtime/flow-selector-check.schema.json"), "utf8")), check).issues).toEqual([]);
    expect(check.codeGraph).toEqual({ availability: "ready", version: productVersionManifest().runtime.codeGraph.requiredVersion });
    expect(Object.fromEntries(check.selectors.map((selector: any) => [selector.sinkId.slice("sink.flows.".length), selector.status]))).toEqual({
      "render": "proven",
      // CodeGraph 1.6.2 omits the old false builtin edge; this selector remains unproven.
      "resolve": "no-direct-call",
      "wired-render": "only-references",
      "wired-resolve": "no-direct-call",
      "helper-render": "ambiguous-symbol"
    });
    const bySink = (id: string) => check.selectors.find((selector: any) => selector.sinkId === `sink.flows.${id}`);
    expect(bySink("render").callSites).toEqual([{ path: "src/main.ts", line: 6 }]);
    expect(bySink("resolve").callSites).toEqual([]);
    expect(bySink("resolve").rejectedBuiltinCallSites).toEqual([]);
    expect(bySink("wired-render").referenceSites).toEqual([{ path: "src/wiring.ts", line: 8 }]);
    expect(bySink("resolve").flowSteps).toEqual([{ flowId: "flow.flows-check", stepId: "resolve" }]);
    expect(bySink("wired-resolve").flowSteps).toEqual([]);
    expect(check.summary).toEqual({ selectors: 5, proven: 1, unproven: 4, usedUnproven: 1 });
    // The flow uses the false built-in selector, so its P2 proof is unprovable exactly as a projection reports it.
    expect(check.ok).toBe(false);
    expect(check.capabilities).toEqual([{
      capabilityId,
      p2Status: "unprovable",
      diagnostics: [{ code: "selector-evidence-unmatched", flowId: "flow.flows-check", stepId: "resolve", detail: "entrypoint.flows.main\u0000handle\u0000sink.flows.resolve" }]
    }]);

    // Real process with no runtime client injected: no daemon is discovered or started.
    const processOutput = execFileSync("bun", [CLI_LAUNCHER, "flows", "check", "--json"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ARCHCONTEXT_STATE_DIR: checkStateRoot },
      timeout: CLI_PROCESS_TIMEOUT_MS
    });
    expect(JSON.parse(processOutput).data).toEqual(check);
    expect(existsSync(checkStateRoot)).toBe(false);
    expect(worktreeStatus()).toBe(worktreeBefore);

    const invalid = await runCli("flows", ["verify"], root, { runtimeClient: noRuntime });
    expect(invalid.ok).toBe(false);
    expect((invalid as JsonEnvelope).error?.code).toBe("AC_SCHEMA_INVALID");
    const help = await runCli("help", [], root, { runtimeClient: noRuntime });
    expect((help as JsonEnvelope).data as any).toMatchObject({ commands: expect.arrayContaining(["flows"]) });
    const flowsHelp = JSON.parse(execFileSync("bun", [CLI_ENTRY, "flows", "--help"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ARCHCONTEXT_STATE_DIR: checkStateRoot },
      timeout: CLI_PROCESS_TIMEOUT_MS
    }));
    expect(flowsHelp.ok, JSON.stringify(flowsHelp)).toBe(true);
    expect(flowsHelp.data.command).toBe("archctx flows check [--no-sync] [--json]");
    expect(flowsHelp.data.writes).toContain("runs codegraph sync and writes the .codegraph index");
    expect(flowsHelp.data.writes).toContain("With --no-sync: no checkout or index writes");
  } finally {
    rmSync(checkStateRoot, { recursive: true, force: true });
    removeTempRoot(root);
  }
}, PROJECTION_CODEGRAPH_TEST_TIMEOUT_MS);

async function removeRuntimeSqliteFiles(localStorePath: string): Promise<void> {
  for (const path of [localStorePath, `${localStorePath}-wal`, `${localStorePath}-shm`]) {
    await removeFileWithTransientWindowsRetry(path);
  }
}

async function removeFileWithTransientWindowsRetry(path: string): Promise<void> {
  const deadline = Date.now() + (process.platform === "win32" ? 30_000 : 0);
  while (true) {
    try {
      rmSync(path, { force: true });
      return;
    } catch (error) {
      if (!isIgnorableWindowsCleanupError(error) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

function expectSameExistingPath(actual: string, expected: string): void {
  expect(normalizeExistingPath(actual)).toBe(normalizeExistingPath(expected));
}

function normalizeExistingPath(path: string): string {
  const normalized = realpathSync.native(resolve(path));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function createInitializedGitRepo(options: { codeFacts?: "required" | "optional" } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-cli-review-"));
  writeFileSync(join(root, "README.md"), "# review fixture\n", "utf8");
  initializeArchContextModel(root, "Review App");
  if (options.codeFacts === "optional") declareOptionalCodeFacts(root);
  git(root, "init");
  configureGitFixtureIdentity(root);
  git(root, "add", ".");
  git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture");
  return root;
}

async function writeTaskState(databasePath: string, taskSessionId: string, state: unknown): Promise<void> {
  const store = new SqliteLocalStore(databasePath);
  await store.migrate();
  await store.saveTaskState(taskSessionId, state);
  store.close();
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function gitExitCode(root: string, ...args: string[]): number {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

function configureGitFixtureIdentity(root: string): void {
  git(root, "config", "user.name", "ArchContext Test");
  git(root, "config", "user.email", "archcontext@example.test");
}

function gitOut(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function withEnv<T>(patch: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key]);
    const value = patch[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("archctx CLI", () => {
  test("CLI delegates init and context to the runtime", async () => {
    const root = gitTempRoot("archctx-cli-");
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const init = await runTestCli("init", ["--name", "CLI App"], root);
      expect(init.ok).toBe(true);
      writeFileSync(join(root, ".archcontext/model/nodes/module.waiver-owner.yaml"), [
        "schemaVersion: archcontext.node/v2",
        "id: module.waiver-owner",
        "kind: module",
        "name: Waiver Owner",
        "status: active",
        "summary: Owns waiver governance fixtures.",
        "ownership:",
        "  lifecycle: [\"team-architecture\"]",
        ""
      ].join("\n"), "utf8");

      const context = await runTestCli("context", ["--task", "add teams"], root);
      expect(context.ok).toBe(true);
      expect((context.data as any).task).toBe("add teams");
      expect((context.data as any).practiceGuidance.schemaVersion).toBe("archcontext.practice-guidance/v1");
      expect((context.data as any).practiceGuidance.catalogDigest).toMatch(/^sha256:/);

      const status = await runTestCli("status", [], root);
      expect(status.ok).toBe(true);
      expect((status.data as any).worktreeDigest).toMatch(/^sha256:/);

      const prepare = await runTestCli("prepare", ["--task", "remove legacy v1 wrapper", "--max-items", "1"], root);
      expect(prepare.ok).toBe(true);
      expect((prepare.data as any).posture).toBeTruthy();
      expect((prepare.data as any).context.practiceGuidance.matches.length).toBeGreaterThan(0);

      const practices = await runTestCli("practices", ["list", "--json"], root);
      expect(practices.ok).toBe(true);
      expect((practices.data as any).schemaVersion).toBe("archcontext.practice-list/v1");
      expect((practices.data as any).count).toBeGreaterThanOrEqual(12);
      expect((practices.data as any).catalogDigest).toMatch(/^sha256:/);

      const practice = await runTestCli("practices", ["show", "compatibility.single-owner"], root);
      expect(practice.ok).toBe(true);
      expect((practice.data as any).practice.id).toBe("compatibility.single-owner");

      const practiceValidation = await runTestCli("practices", ["validate", "--strict"], root);
      expect((practiceValidation.data as any).valid).toBe(true);

      const practiceSources = await runTestCli("practices", ["sources"], root);
      expect((practiceSources.data as any).sources.some((source: any) => source.id === "madr")).toBe(true);

      const waiverPlan = await runTestCli("practices", [
        "waive",
        "--practice-id", "modularity.no-new-cycle",
        "--check-id", "no-new-cycle",
        "--waiver-id", "cycle-waiver",
        "--owner", "team-architecture",
        "--reason", "External migration window requires keeping this edge until the upstream cutover is complete.",
        "--review-at", "2026-07-10T00:00:00.000Z",
        "--expires-at", "2026-07-24T00:00:00.000Z",
        "--evidence-digest", `sha256:${"1".repeat(64)}`,
        "--subject", "module.a->module.b"
      ], root);
      expect(waiverPlan.ok).toBe(true);
      expect((waiverPlan.data as any).draft.operations[0]).toMatchObject({
        op: "write_waiver",
        path: ".archcontext/waivers/cycle-waiver.json"
      });
      expect((waiverPlan.data as any).preview.allowed).toBe(true);

      const waiverList = await runTestCli("practices", ["waivers"], root);
      expect(waiverList.ok).toBe(true);
      expect((waiverList.data as any).count).toBe(0);
      expect((waiverList.data as any).ownerRegistry.owners).toContain("team-architecture");

      const unknownWaiverOwner = await runTestCli("practices", [
        "waive",
        "--practice-id", "modularity.no-new-cycle",
        "--owner", "unknown-team",
        "--reason", "External migration window requires keeping this edge until the upstream cutover is complete.",
        "--review-at", "2026-07-10T00:00:00.000Z",
        "--expires-at", "2026-07-24T00:00:00.000Z",
        "--evidence-digest", `sha256:${"1".repeat(64)}`,
        "--subject", "module.a->module.b"
      ], root);
      expect(unknownWaiverOwner.ok).toBe(false);
      expect((unknownWaiverOwner as any).error.code).toBe("AC_SCHEMA_INVALID");

      const checkpoint = await runTestCli("practices", ["checkpoint", "--expected-worktree-digest", (status.data as any).worktreeDigest], root);
      expect((checkpoint.data as any).schemaVersion).toBe("archcontext.practice-checkpoint/v1");
      expect((checkpoint.data as any).fresh).toBe(true);
      expect(["fresh", "no-op", "no-baseline"]).toContain((checkpoint.data as any).reasonCode);
      expect((checkpoint.data as any).hook.egress).toBe("none");
      if ((checkpoint.data as any).reasonCode === "fresh") {
        expect((checkpoint.data as any).previousPracticeGuidanceDigest).toMatch(/^sha256:/);
      }

      const hookCheckpoint = await runTestCli("hook", ["checkpoint", "--event", "post-edit", "--changed-path", "src/example.ts"], root);
      expect(hookCheckpoint.requestId).toBe("hook.checkpoint");
      expect((hookCheckpoint.data as any).schemaVersion).toBe("archcontext.hook-debt-checkpoint/v1");
      expect((hookCheckpoint.data as any).hookLog).toMatchObject({
        schemaVersion: "archcontext.hook-log/v1",
        event: "post-edit",
        pathCount: 1,
        egress: "none",
        network: "forbidden"
      });
      expect((hookCheckpoint.data as any).hookLog.changedPathDigest).toMatch(/^sha256:/);
      expect(JSON.stringify((hookCheckpoint.data as any).hookLog)).not.toContain("src/example.ts");

      const complete = await runTestCli("complete", [
        "--task-session-id", "task_cli",
        "--head-sha", "abc123"
      ], root);
      expect(complete.ok).toBe(true);
      expect((complete.data as any).schemaVersion).toBe("archcontext.review/v1");

      const review = await runTestCli("review", [
        "--task-session-id", "task_cli_review",
        "--head-sha", "abc123"
      ], root);
      expect(review.requestId).toBe("review");
      expect((review.data as any).schemaVersion).toBe("archcontext.review/v1");

      const forgedReview = await runTestCli("review", [
        "--task-session-id", "task_cli_forged",
        "--head-sha", "abc123",
        "--result", "pass"
      ], root);
      expect(forgedReview.ok).toBe(false);
      expect((forgedReview as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((forgedReview as any).error).toMatchObject({ reasonCode: "cli-input-invalid", action: "correct-command-arguments" });
      expect((forgedReview as any).error.details).toEqual({});
      expect((forgedReview as any).error.message).not.toContain("--result");

      const forgedDigest = await runTestCli("complete", [
        "--task-session-id", "task_cli_forged_digest",
        "--head-sha", "abc123",
        "--model-digest", `sha256:${"a".repeat(64)}`
      ], root);
      expect(forgedDigest.ok).toBe(false);
      expect((forgedDigest as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((forgedDigest as any).error).toMatchObject({ reasonCode: "cli-input-invalid", action: "correct-command-arguments" });
      expect((forgedDigest as any).error.details).toEqual({});
      expect((forgedDigest as any).error.message).not.toContain("--model-digest");

      const forgedPractice = await runTestCli("complete", [
        "--task-session-id", "task_cli_forged_practice",
        "--head-sha", "abc123",
        "--practice-violations", "[]"
      ], root);
      expect(forgedPractice.ok).toBe(false);
      expect((forgedPractice as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((forgedPractice as any).error).toMatchObject({ reasonCode: "cli-input-invalid", action: "correct-command-arguments" });
      expect((forgedPractice as any).error.details).toEqual({});
      expect((forgedPractice as any).error.message).not.toContain("--practice-violations");

      writeFileSync(join(root, "package.json"), JSON.stringify({ engines: { node: ">=22.22 <26" } }), "utf8");
      const install = await runTestCli("install", ["--host", "codex"], root);
      expect((install.data as any).marker).toContain("archctx prepare");
      expect((install.data as any).marker).toContain("archctx check --changed");
      mkdirSync(join(root, ".git"), { recursive: true });
      const doctor = await runTestCli("doctor", [], root);
      expect((doctor.data as any).version.schemaSetVersion).toBeTruthy();
      expect((doctor.data as any).runtime).toMatchObject({ mode: "in-process" });
      expect((doctor.data as any).sqlite.path).toContain("runtime.sqlite");
      expect((doctor.data as any).git).toMatchObject({ ok: true, headSha: "unborn" });
      expectSameExistingPath((doctor.data as any).git.root, root);
      expect((doctor.data as any).permissions.workspace.writable).toBe(true);
      expect((doctor.data as any).codeGraph.requiredVersion).toBe("1.6.4");
      expect((doctor.data as any).update).toMatchObject({
        schemaVersion: "archcontext.update-check/v1",
        packageName: "archctx",
        currentVersion: ARCHCONTEXT_PRODUCT_VERSION,
        status: "not-checked",
        checkUpdates: false,
        updateAvailable: false
      });
      expect((doctor.data as any).egress).toMatchObject({
        ok: true,
        defaultOutbound: "local-only",
        cloudContentUpload: "deny",
        secureMcpTunnel: "disabled-by-default",
        thirdPartyTelemetry: "disabled",
        codeGraph: {
          telemetry: "disabled",
          envVar: "DO_NOT_TRACK",
          effectiveValue: "1"
        }
      });
      expect((doctor.data as any).hardening).not.toHaveProperty("privacyRouteDigest");
      const paths = await runTestCli("paths", [], root);
      expect(paths.ok).toBe(true);
      expect((paths.data as any).repositoryTruthDir).toBe(join(realpathSync.native(root), ".archcontext"));
      expect((paths.data as any).codeGraphIndexDir).toBe(join(realpathSync.native(root), ".codegraph"));
      expect((paths.data as any).runtimeRepositoryId).toBe(repositoryFingerprint(root));
      expect((paths.data as any).storageRepositoryId).toMatch(/^repo\.[0-9a-f]{16}$/);
      expect((paths.data as any).storageWorkspaceId).toMatch(/^ws\.[0-9a-f]{16}$/);
      expect((paths.data as any).localStorePath).toContain("runtime.sqlite");
      expect((paths.data as any).localStorePath.startsWith(root)).toBe(false);
      expect((paths.data as any).npmGlobalInstallState).toBe("forbidden");
    } finally {
      removeTempRoot(root);
    }
  }, CLI_PROCESS_TIMEOUT_MS);

  test("CLI update check is explicit and doctor can include the same advisory", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-update-check-"));
    writeFileSync(join(root, "README.md"), "# update check fixture\n", "utf8");
    try {
      await withEnv({
        ARCHCONTEXT_CHECK_UPDATES: undefined,
        ARCHCONTEXT_LATEST_VERSION: "99.0.0"
      }, async () => {
        const defaultDoctor = await runTestCli("doctor", [], root);
        expect((defaultDoctor.data as any).update).toMatchObject({
          status: "not-checked",
          checkUpdates: false,
          updateAvailable: false
        });

        const update = await runTestCli("update", ["--check"], root);
        expect(update.ok).toBe(true);
        expect((update.data as any)).toMatchObject({
          schemaVersion: "archcontext.update-check/v1",
          packageName: "archctx",
          currentVersion: ARCHCONTEXT_PRODUCT_VERSION,
          latestVersion: "99.0.0",
          source: "env",
          status: "update-available",
          checkUpdates: true,
          updateAvailable: true,
          installCommand: "npm install -g archctx@latest"
        });

        const checkedDoctor = await runTestCli("doctor", ["--check-updates"], root);
        expect((checkedDoctor.data as any).update).toMatchObject({
          latestVersion: "99.0.0",
          source: "env",
          status: "update-available",
          updateAvailable: true
        });

        const unsupported = await runTestCli("update", [], root);
        expect(unsupported.ok).toBe(false);
        expect((unsupported as any).error.code).toBe("AC_CAPABILITY_UNSUPPORTED");
      });
    } finally {
      removeTempRoot(root);
    }
  });

  test("hook checkpoint reports unknown coverage without runtime access outside a Git worktree", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-hook-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const result = await runCli("hook", ["checkpoint", "--event", "post-edit", "--changed-path", "src/app.ts"], root, {
        runtimeClient: {
          practiceCheckpoint() {
            throw new Error("runtime must not be accessed");
          }
        } as any
      });
      expect(result.ok).toBe(true);
      expect(result.requestId).toBe("hook.checkpoint");
      expect((result.data as any).schemaVersion).toBe("archcontext.hook-checkpoint-fail-open/v1");
      expect((result.data as any).failOpen).toBe(true);
      expect((result.data as any).egress).toBe("none");
      expect((result.data as any).network).toBe("forbidden");
      expect((result.data as any).hookLog).toMatchObject({
        schemaVersion: "archcontext.hook-log/v1",
        event: "post-edit",
        pathCount: 1,
        reasonCode: "git-worktree-required",
        failOpen: true,
        egress: "none",
        network: "forbidden"
      });
      expect((result.data as any).coverage).toBe("unknown");
      expect((result.data as any).error).toMatchObject({code: "AC_REPO_NOT_FOUND", reasonCode: "git-worktree-required"});
      expect(JSON.stringify((result.data as any).hookLog)).not.toContain("src/app.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("CLI renders central hook adapter install status and remove configuration", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-hooks-host-"));
    try {
      const install = await runCli("hooks", ["install", "--host", "codex"], root);
      expect(install.ok).toBe(true);
      expect(install.requestId).toBe("hooks.install");
      expect((install.data as any)).toMatchObject({
        schemaVersion: "archcontext.hook-adapter/v1",
        host: "codex",
        adapterName: "repo-harness-hook",
        ownership: "central-first",
        repoLocalRuntime: "not-vendored",
        writes: "manual-host-config",
        installed: true
      });
      expect((install.data as any).entrypoint).toMatchObject({
        command: "archctx",
        args: ["hook", "checkpoint"],
        failOpen: true,
        egress: "none",
        network: "forbidden"
      });
      expect((install.data as any).configExample).toMatchObject({
        configPath: "~/.codex/hooks.json",
        adapter: { command: "repo-harness-hook" },
        centralFirst: true,
        repoHookSourceRequired: false
      });
      expect((install.data as any).logContract.allowedFields).toEqual([
        "schemaVersion",
        "event",
        "elapsedMs",
        "pathCount",
        "changedPathDigest",
        "reasonCode",
        "failOpen",
        "egress",
        "network"
      ]);
      expect(JSON.stringify(install.data)).not.toContain("hook_source");
      expect(JSON.stringify(install.data)).not.toContain("sourceBody");

      const status = await runCli("hooks", ["status", "--host", "claude"], root);
      expect(status.ok).toBe(true);
      expect((status.data as any)).toMatchObject({
        host: "claude",
        installed: "config-ready",
        adapterName: "repo-harness-hook",
        writes: "manual-host-config"
      });
      expect((status.data as any).configExample.configPath).toBe("~/.claude/settings.json");

      const remove = await runCli("hooks", ["remove", "--host", "generic"], root);
      expect(remove.ok).toBe(true);
      expect((remove.data as any).removeConfig).toMatchObject({
        removeAdapter: "repo-harness-hook",
        removeEntrypoint: "archctx hook checkpoint",
        readEntrypoint: "archctx hook checkpoint",
        repoHookSourceRequired: false
      });

      const uninstall = await runCli("hooks", ["uninstall", "--host", "generic"], root);
      expect(uninstall.ok).toBe(true);
      expect(uninstall.requestId).toBe("hooks.uninstall");
      expect((uninstall.data as any).removeConfig.removeEntrypoint).toBe("archctx hook checkpoint");

      const doctor = await runCli("hooks", ["doctor", "--host", "codex"], root);
      expect(doctor.ok).toBe(true);
      expect(doctor.requestId).toBe("hooks.doctor");
      expect((doctor.data as any).checks).toContainEqual(expect.objectContaining({
        id: "entrypoint",
        status: "pass",
        command: "archctx hook checkpoint"
      }));

      const invalid = await runCli("hooks", ["install", "--host", "unknown"], root);
      expect(invalid.ok).toBe(false);
      expect((invalid as any).error.code).toBe("AC_SCHEMA_INVALID");
    } finally {
      removeTempRoot(root);
    }
  });

  test("one argument check runs before every handler: help, unknown flags and stray task options never reach the runtime (#322)", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-preflight-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    // Any handler that reached the runtime would throw here; the preflight answers first.
    const throwingRuntime = new Proxy({}, { get: () => () => { throw new Error("preflight let a handler reach the runtime"); } });
    const cli = async (command: string, ...args: string[]) => await runCli(command, args, root, { runtimeClient: throwingRuntime as any }) as JsonEnvelope;
    try {
      // checkpoint and complete used to run a real checkpoint and record a real completion review.
      for (const [command, ...args] of [["checkpoint", "--help"], ["complete", "--help"], ["complete", "--task", "x", "-h"], ["review", "--help"], ["prepare", "--help"], ["context", "-h"], ["sync", "--help"], ["doctor", "--help"]]) {
        const help = await cli(command!, ...args);
        expect(help, `${command} ${args.join(" ")}`).toMatchObject({ ok: true, requestId: "help", data: { command: `archctx ${command}` } });
      }
      for (const [command, ...args] of [["checkpoint", "--bogus"], ["complete", "--json", "--strict"], ["status", "--verbose"], ["practices", "validate", "--stric"], ["sync", "--changed"], ["recommendations", "list", "--run-id", "x"]]) {
        const rejected = await cli(command!, ...args);
        expect(rejected.ok, `${command} ${args.join(" ")}`).toBe(false);
        expect(rejected.error, `${command} ${args.join(" ")}`).toMatchObject({ code: "AC_SCHEMA_INVALID", retryable: false });
      }
      const checkpointRefusal = await cli("checkpoint", "--bogus");
      expect(checkpointRefusal.error).toMatchObject({ code: "AC_SCHEMA_INVALID", reasonCode: "cli-input-invalid", action: "correct-command-arguments" });
      expect(checkpointRefusal.error?.details).toEqual({});
      expect(checkpointRefusal.error?.message).not.toContain("--bogus");
      expect((await cli("sync", "--changed")).error?.message).toBe("sync requires a value for --changed");
      expect(await cli("recommendations", "list", "--run-id", "x")).toMatchObject({ requestId: "recommendations.list", error: { message: "recommendations list does not recognize the flag --run-id" } });
      // Daemon-owned review fields keep their own refusal, ahead of the unknown-flag scan.
      const attestationRefusal = await cli("complete", "--signature", "x");
      expect(attestationRefusal.error).toMatchObject({ code: "AC_SCHEMA_INVALID", reasonCode: "cli-input-invalid", action: "correct-command-arguments" });
      expect(attestationRefusal.error?.details).toEqual({});
      expect(attestationRefusal.error?.message).not.toContain("--signature");

      // prepare/context: options are never read as task text.
      for (const [command, option] of [["prepare", "--max-bytes"], ["context", "--max-symbols"]] as const) {
        const stray = await cli(command, option, "4096");
        expect(stray.error, command).toMatchObject({ code: "AC_SCHEMA_INVALID", message: `${command} takes options only together with --task <text>; bare task text cannot contain options` });
        expect((await cli(command, "fix", "the", "-x", "bug")).error?.code, command).toBe("AC_SCHEMA_INVALID");
        expect((await cli(command)).error?.message, command).toBe(`${command} requires --task or task text`);
      }
    } finally {
      removeTempRoot(root);
    }
  });

  test("the argument table knows every flag a handler reads, so the preflight never rejects a real option (#322)", () => {
    // A Windows checkout may have CRLF line endings; the source readers below match on "\n".
    const source = collectCliSourceText(join(REPOSITORY_ROOT, "packages/surfaces/cli/src"));
    const read = new Set([...source.matchAll(/\b(?:readFlag|readRepeatedFlag|requireFlag|copyOptionalFlag|refactorFlagValue|readOptional(?:Positive|NonNegative)?IntegerFlag|readRepositoryInputFile)\(\s*[\w.]+\s*,\s*"(--[a-z0-9-]+)"/g)].map((match) => match[1]!));
    const known = new Set(["--format", "--json", ...Object.values(CLI_COMMAND_FLAGS).flatMap((spec) => [
      ...spec.value,
      ...spec.boolean,
      ...Object.values(spec.subcommands ?? {}).flatMap((sub) => [...sub.value, ...sub.boolean])
    ])]);
    expect([...read].filter((flag) => !known.has(flag)).sort()).toEqual([]);

    // Per subcommand: every flag a subcommand branch reads is listed for that subcommand, so a
    // flag one subcommand ignores never passes the check under another one.
    const readFlags = (text: string) => new Set([...text.matchAll(/\b(?:readFlag|readRepeatedFlag|requireFlag|copyOptionalFlag|readOptional(?:Positive|NonNegative)?IntegerFlag|explorerProjectionQueryV2FromCli)\(\s*[\w.]+\s*,?\s*(?:"(--[a-z0-9-]+)")?/g)]
      .flatMap((match) => match[0].includes("explorerProjectionQueryV2FromCli")
        ? [...functionBody(source, "explorerProjectionQueryV2FromCli").matchAll(/"(--[a-z0-9-]+)"/g)].map((inner) => inner[1]!)
        : match[1] ? [match[1]] : [])
      .concat([...text.matchAll(/\b\w*[aA]rgs\.includes\("(--[a-z0-9-]+)"\)/g)].map((match) => match[1]!)));
    const accepted = (command: string, subcommand: string) => {
      const spec = CLI_COMMAND_FLAGS[command]!.subcommands![subcommand];
      expect(spec, `${command} ${subcommand}`).toBeDefined();
      return new Set([...spec!.value, ...spec!.boolean]);
    };
    const handlers: Record<string, string> = {
      practices: "runPracticesCommand",
      recommendations: "runRecommendationsCommand",
      explore: "runExploreCommand"
    };
    for (const [command, handler] of Object.entries(handlers)) {
      for (const [subcommands, block] of subcommandBlocks(functionBody(source, handler))) {
        for (const subcommand of subcommands) {
          const allowed = accepted(command, subcommand);
          expect([...readFlags(block)].filter((flag) => !allowed.has(flag)), `${command} ${subcommand}`).toEqual([]);
        }
      }
    }
    for (const [subcommand, handler] of [["checkpoint", "runHookCheckpointCommand"]] as const) {
      expect([...readFlags(functionBody(source, handler))].filter((flag) => !accepted("hook", subcommand).has(flag)), `hook ${subcommand}`).toEqual([]);
    }
    // projection: `run` takes only --request-json; snapshot takes no value flag.
    const projectionBody = functionBody(source, "runProjectionProtocolCommand");
    expect(projectionBody).toContain('action !== "run"');
    expect([...accepted("projection", "run")]).toEqual([...readFlags(projectionBody)]);
    expect(projectionBody).toContain('action === "snapshot"');
    expect([...accepted("projection", "snapshot")]).toEqual([]);
  });

  test("a flag another subcommand reads is refused before the runtime (#322)", async () => {
    const throwingRuntime = new Proxy({}, { get: () => () => { throw new Error("preflight let a handler reach the runtime"); } });
    for (const [command, ...args] of [["practices", "list", "--waiver-id", "x"], ["explore", "status", "--view", "x"], ["recommendations", "list", "--id", "x"], ["projection", "snapshot", "--request-json", "{}"]]) {
      const rejected = await runCli(command!, args, "/absent", { runtimeClient: throwingRuntime as any }) as JsonEnvelope;
      expect(rejected, `${command} ${args.join(" ")}`).toMatchObject({
        ok: false,
        requestId: `${command}.${args[0]}`,
        error: { code: "AC_SCHEMA_INVALID", message: `${command} ${args[0]} does not recognize the flag ${args[1]}` }
      });
    }
  });

  test("the removed docs --generated-at flag is refused before the runtime (#327)", async () => {
    const throwingRuntime = new Proxy({}, { get: () => () => { throw new Error("preflight let a handler reach the runtime"); } });
    for (const subcommand of ["plan", "drift"]) {
      const rejected = await runCli("docs", [subcommand, "--generated-at", "2020-01-01T00:00:00Z", "--json"], "/absent", { runtimeClient: throwingRuntime as any }) as JsonEnvelope;
      expect(rejected, `docs ${subcommand}`).toMatchObject({
        ok: false,
        error: { code: "AC_SCHEMA_INVALID", message: expect.stringContaining("does not recognize the flag --generated-at") }
      });
    }
  });

  test("spawned CLI: --help on commands without their own help and validate argument errors never start runtime state (#322)", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-help-no-daemon-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const paths = testRuntimePaths(root);
      const assertNoRuntimeFootprint = () => {
        expect(existsSync(paths.localStorePath)).toBe(false);
      };
      for (const args of [["docs", "--help"], ["docs", "pin", "-h"], ["validate", "--help"], ["status", "--help"], ["practices", "validate", "--help"]]) {
        const help = await runCliProcessRaw(root, ...args);
        const envelope = JSON.parse(help.stdout);
        expect(envelope.ok, `${args.join(" ")}: ${help.stdout}`).toBe(true);
        expect(envelope.requestId).toBe("help");
        expect(envelope.data.command).toBe(`archctx ${args[0]}`);
        assertNoRuntimeFootprint();
      }
      expect(JSON.parse((await runCliProcessRaw(root, "docs", "--help")).stdout).data.examples).toEqual(["archctx docs anchors --json"]);

      for (const args of [["validate", "--format", "json", "--strict"], ["validate", "-x"], ["validate", "--format"]]) {
        const rejected = await runCliProcessRaw(root, ...args);
        expect(rejected.code, args.join(" ")).toBe(1);
        expect(JSON.parse(rejected.stdout).error).toMatchObject({ code: "AC_SCHEMA_INVALID", retryable: false });
        assertNoRuntimeFootprint();
      }
    } finally {
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("CLI exposes recommendation lifecycle and metrics commands", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-recommendations-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const calls: any[] = [];
      const runtimeClient = {
        recommendations(_root: string, input: any) {
          calls.push(input);
          return {
            schemaVersion: "archcontext.envelope/v1",
            ok: true,
            requestId: `recommendations.${input.command}`,
            data: {
              schemaVersion: input.command === "metrics"
                ? "archcontext.recommendation-lifecycle-metrics/v1"
                : "archcontext.runtime-recommendation-lifecycle/v1",
              input
            }
          };
        }
      };

      const accepted = await runCli("recommendations", [
        "accept",
        "--id", "recommendation.cli_test",
        "--reason", "accepted after local readback",
        "--actor", "developer.al8",
        "--expected-worktree-digest", `sha256:${"1".repeat(64)}`,
        "--agent-job-id", "agent_job.cli"
      ], root, { runtimeClient: runtimeClient as any });
      expect(accepted.ok).toBe(true);
      expect(calls[0]).toMatchObject({
        command: "accept",
        recommendationId: "recommendation.cli_test",
        reason: "accepted after local readback",
        actor: "developer.al8",
        expectedWorktreeDigest: `sha256:${"1".repeat(64)}`,
        agentJobId: "agent_job.cli"
      });

      const metrics = await runCli("recommendations", ["metrics", "--now", "2026-06-26T12:00:00.000Z"], root, { runtimeClient: runtimeClient as any });
      expect(metrics.ok).toBe(true);
      expect(calls[1]).toEqual({ command: "metrics", now: "2026-06-26T12:00:00.000Z" });

      const missingReason = await runCli("recommendations", ["reject", "--id", "recommendation.cli_test"], root, { runtimeClient: runtimeClient as any });
      expect(missingReason.ok).toBe(false);
      expect((missingReason as any).error.code).toBe("AC_SCHEMA_INVALID");

      // `show` is a read: an id and nothing else reaches the daemon.
      const shown = await runCli("recommendations", ["show", "--id", "recommendation.cli_test", "--json"], root, { runtimeClient: runtimeClient as any });
      expect(shown.ok).toBe(true);
      expect(calls[2]).toEqual({ command: "show", recommendationId: "recommendation.cli_test" });
      const missingId = await runCli("recommendations", ["show"], root, { runtimeClient: runtimeClient as any });
      expect(missingId.ok).toBe(false);
      expect((missingId as any).error.message).toBe("recommendations show requires --id");
      expect(calls).toHaveLength(3);

      // `list` is a read: the status, and nothing else, reaches the daemon, which owns its vocabulary.
      const listed = await runCli("recommendations", ["list", "--status", "rejected", "--json"], root, { runtimeClient: runtimeClient as any });
      expect(listed.ok).toBe(true);
      expect(calls[3]).toEqual({ command: "list", status: "rejected" });
      await runCli("recommendations", ["list"], root, { runtimeClient: runtimeClient as any });
      expect(calls[4]).toEqual({ command: "list" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("CLI forwards --evidence-digest to the recommendation resolve gate", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-evidence-digest-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const calls: any[] = [];
      const runtimeClient = {
        recommendations(_root: string, input: any) {
          calls.push(input);
          return {
            schemaVersion: "archcontext.envelope/v1",
            ok: true,
            requestId: `recommendations.${input.command}`,
            data: { schemaVersion: "archcontext.runtime-recommendation-lifecycle/v1", input }
          };
        }
      };

      const resolved = await runCli("recommendations", [
        "resolve",
        "--id", "recommendation.cli_refactor",
        "--reason", "resolved after the structural change landed",
        "--evidence-digest", `sha256:${"a".repeat(64)}`
      ], root, { runtimeClient: runtimeClient as any });
      expect(resolved.ok).toBe(true);
      expect(calls[0]).toMatchObject({
        command: "resolve",
        recommendationId: "recommendation.cli_refactor",
        evidenceDigest: `sha256:${"a".repeat(64)}`
      });

      await runCli("recommendations", [
        "resolve",
        "--id", "recommendation.cli_refactor",
        "--reason", "resolved after the structural change landed"
      ], root, { runtimeClient: runtimeClient as any });
      expect("evidenceDigest" in calls[1]).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("CLI docs commands keep Context7 manual and lockfile explicit", async () => {
    const root = gitTempRoot("archctx-cli-docs-");
    initializeArchContextModel(root, "Docs App");
    const daemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: new TestLocalStore()
    });
    const cli = (args: string[]) => runCli("docs", args, root, { runtimeClient: daemon });
    try {
      const status = await cli(["status"]);
      expect(status.ok).toBe(true);
      expect((status.data as any)).toMatchObject({
        schemaVersion: "archcontext.external-docs-status/v1",
        provider: "context7",
        defaultPrepareEgress: "none"
      });
      expect((status.data as any).health).toMatchObject({
        enabled: false,
        egress: "none"
      });

      const blockedResolve = await cli(["resolve", "--library", "React", "--query", "state hooks"]);
      expect(blockedResolve.ok).toBe(false);
      expect((blockedResolve as any).error).toMatchObject({code: "AC_SCHEMA_INVALID", reasonCode: "docs-network-authorization-required"});
      expect((blockedResolve as any).error.message).toContain("--allow-network");

      const pinPreview = await cli(["pin", "--library-id", "/facebook/react", "--version", "18.2.0"]);
      expect(pinPreview.ok).toBe(true);
      expect((pinPreview.data as any).approved).toBe(false);
      expect(existsSync(join(root, ".archcontext", "integrations", "context7.lock.yaml"))).toBe(false);

      const pin = await cli(["pin", "--library-id", "/facebook/react", "--version", "18.2.0", "--approved"]);
      expect(pin.ok).toBe(true);
      expect((pin.data as any).approved).toBe(true);
      const lockPath = join(root, ".archcontext", "integrations", "context7.lock.yaml");
      expect(JSON.parse(readFileSync(lockPath, "utf8"))).toMatchObject({
        schemaVersion: "archcontext.context7-lock/v1",
        provider: "context7",
        libraries: [{ libraryId: "/facebook/react", version: "18.2.0" }]
      });

      const blockedFetch = await cli(["fetch", "--library-id", "/facebook/react", "--intent", "state hooks"]);
      expect(blockedFetch.ok).toBe(false);
      expect((blockedFetch as any).error).toMatchObject({code: "AC_SCHEMA_INVALID", reasonCode: "docs-network-authorization-required"});
      expect((blockedFetch as any).error.message).toContain("--allow-network");
    } finally {
      await daemon.stop();
      removeTempRoot(root);
    }
  }, CLI_DOCS_TEST_TIMEOUT_MS);

  test("first-party skills keep checkpoint SOP separate from practice logic", () => {
    const skillFiles = [
      "skills/archcontext-bootstrap/SKILL.md",
      "skills/archcontext-develop/SKILL.md",
      "skills/archcontext-intervene/SKILL.md",
      "skills/archcontext-review/SKILL.md"
    ];
    const forbidden = [
      "compatibility.single-owner",
      "modularity.no-new-cycle",
      "required-test-evidence",
      "candidateTerms",
      "structuralPredicates",
      "matchPracticesForTask"
    ];
    for (const file of skillFiles) {
      const body = readFileSync(join(REPOSITORY_ROOT, file), "utf8");
      expect(body).toContain("SOP");
      for (const token of [...forbidden, "archcontext_prepare_task", "archcontext_checkpoint", "archcontext_plan_update", "archcontext_apply_update", "archcontext_complete_task"]) {
        expect(body).not.toContain(token);
      }
    }
    const develop = readFileSync(join(REPOSITORY_ROOT, "skills/archcontext-develop/SKILL.md"), "utf8");
    expect(develop).toContain("archctx check --changed");
    expect(develop).toContain("archctx checkpoint");
    expect(develop).toContain("added/upgraded");
    expect(develop).toContain("removed/downgraded");
  });

  test("CLI init outside a Git worktree fails closed with a typed envelope (#323)", async () => {
    // A plain directory: archctx requires a Git worktree, and no ancestor of tmpdir is one.
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-non-git-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    const daemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: new TestLocalStore()
    });
    try {
      const typed = { ok: false, error: { code: "AC_REPO_NOT_FOUND", reasonCode: "git-worktree-required" } };
      const embedded = await runCli("init", ["--name", "Non Git App"], root, { runtimeClient: daemon });
      expect(embedded).toMatchObject({ ...typed, requestId: "init" });
      // The refusal comes before any write, so a retry after `git init` is not blocked by a partial model.
      expect(existsSync(join(root, ".archcontext"))).toBe(false);

      const snapshot = await runCli("projection", ["snapshot", "--json"], root, { runtimeClient: daemon });
      expect(snapshot).toMatchObject({ ...typed, requestId: "projection.snapshot" });
    } finally {
      await daemon.stop().catch(() => undefined);
      removeTempRoot(root);
    }
  });

  test("CLI refactor scan and record are thin adapters over the daemon RPC", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-refactor-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const scans: any[] = [];
      const records: any[] = [];
      const measured = {
        schemaVersion: "archcontext.runtime-refactor-scan/v1",
        snapshot: { snapshotDigest: `sha256:${"a".repeat(64)}`, modules: [{ nodeId: "module.b" }, { nodeId: "module.a" }] },
        assessment: { assessmentDigest: `sha256:${"b".repeat(64)}` },
        proposedRecommendations: []
      };
      const runtimeClient = {
        refactorScan(_root: string, input: any) {
          scans.push(input);
          return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "refactor.scan", data: measured };
        },
        refactorRecord(_root: string, input: any) {
          records.push(input);
          return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "refactor.record", data: { input } };
        }
      };

      const scanned = await runCli("refactor", ["scan", "--json"], root, { runtimeClient: runtimeClient as any });
      expect(scanned.ok).toBe(true);
      // No --request-json means the daemon applies its own default; the CLI invents no request.
      expect(scans[0]).toEqual({});
      // The envelope crosses the surface unchanged, module order included.
      expect(scanned.data).toBe(measured as any);
      expect((scanned.data as any).snapshot.modules.map((module: any) => module.nodeId)).toEqual(["module.b", "module.a"]);

      const request = {
        schemaVersion: "archcontext.refactor-request/v1",
        scope: { kind: "node", nodeId: "module.a" },
        task: "collapse the boundary"
      };
      const scoped = await runCli("refactor", ["scan", "--request-json", JSON.stringify(request)], root, { runtimeClient: runtimeClient as any });
      expect(scoped.ok).toBe(true);
      expect(scans[1]).toEqual({ request });

      const malformed = await runCli("refactor", ["scan", "--request-json", "{not json"], root, { runtimeClient: runtimeClient as any });
      expect(malformed.ok).toBe(false);
      expect((malformed as any).error.code).toBe("AC_SCHEMA_INVALID");

      const invalid = await runCli("refactor", ["scan", "--request-json", JSON.stringify({ schemaVersion: "archcontext.refactor-request/v0", scope: { kind: "repository" } })], root, { runtimeClient: runtimeClient as any });
      expect(invalid.ok).toBe(false);
      expect((invalid as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect(scans).toHaveLength(2);

      // --import-node-limit rides on the request: the repository default alone, or the caller's request.
      const limited = await runCli("refactor", ["scan", "--import-node-limit", "100000", "--json"], root, { runtimeClient: runtimeClient as any });
      expect(limited.ok).toBe(true);
      expect(scans[2]).toEqual({ request: { schemaVersion: "archcontext.refactor-request/v1", scope: { kind: "repository" }, importNodeLimit: 100000 } });
      const scopedLimited = await runCli("refactor", ["scan", "--request-json", JSON.stringify(request), "--import-node-limit", "7"], root, { runtimeClient: runtimeClient as any });
      expect(scopedLimited.ok).toBe(true);
      expect(scans[3]).toEqual({ request: { ...request, importNodeLimit: 7 } });
      for (const bad of ["0", "-5", "1e3", "abc"]) {
        const rejected = await runCli("refactor", ["scan", "--import-node-limit", bad], root, { runtimeClient: runtimeClient as any });
        expect(rejected.ok, bad).toBe(false);
        expect((rejected as any).error.code).toBe("AC_SCHEMA_INVALID");
      }
      const missingValue = await runCli("refactor", ["scan", "--import-node-limit", "--json"], root, { runtimeClient: runtimeClient as any });
      expect(missingValue.ok).toBe(false);
      expect(scans).toHaveLength(4);

      const scanFlags = (...flags: string[]) => runCli("refactor", ["scan", ...flags], root, { runtimeClient: runtimeClient as any });
      expect((await scanFlags("--node", "module.a", "--json")).ok).toBe(true);
      expect(scans[4]).toEqual({ request: { schemaVersion: request.schemaVersion, scope: request.scope } });
      expect((await scanFlags("--path", "src/z.ts", "--path", "./src/a.ts", "--path", "src/a.ts", "--import-node-limit", "7")).ok).toBe(true);
      expect(scans[5]).toEqual({ request: { schemaVersion: request.schemaVersion, scope: { kind: "paths", paths: ["src/a.ts", "src/z.ts"] }, importNodeLimit: 7 } });
      for (const flags of [
        ["--node"], ["--node", ""], ["--node", "module.a", "--node", "module.b"], ["--path"],
        ...["", "../src/a.ts", "/src/a.ts", "C:/src/a.ts"].map((path) => ["--path", path]),
        ["--node", "module.a", "--path", "src/a.ts"],
        ["--node", "module.a", "--request-json", JSON.stringify(request)],
        ["--path", "src/a.ts", "--request-json", JSON.stringify(request)]
      ]) {
        expect(await scanFlags(...flags)).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
      }
      expect(scans).toHaveLength(6);

      const recorded = await runCli("refactor", [
        "record",
        "--assessment-digest", `sha256:${"b".repeat(64)}`,
        "--expected-worktree-digest", `sha256:${"c".repeat(64)}`,
        "--json"
      ], root, { runtimeClient: runtimeClient as any });
      expect(recorded.ok).toBe(true);
      expect(records[0]).toEqual({
        assessmentDigest: `sha256:${"b".repeat(64)}`,
        expectedWorktreeDigest: `sha256:${"c".repeat(64)}`
      });

      const missingDigest = await runCli("refactor", ["record", "--assessment-digest", `sha256:${"b".repeat(64)}`], root, { runtimeClient: runtimeClient as any });
      expect(missingDigest.ok).toBe(false);
      expect((missingDigest as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect(records).toHaveLength(1);

      const unknownSubcommand = await runCli("refactor", ["resolve"], root, { runtimeClient: runtimeClient as any });
      expect(unknownSubcommand.ok).toBe(false);
      expect((unknownSubcommand as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect(String((unknownSubcommand as any).error.message)).toContain("scan|record|verify");
    } finally {
      removeTempRoot(root);
    }
  });

  test("CLI refactor node scope includes child-owned files, imports and open recommendations", async () => {
    const root = createInitializedGitRepo();
    const parent = "capability.fixture-parent";
    const api = "component.fixture-api";
    const internal = "component.fixture-internal";
    const ownerNodes = [api, internal];
    mkdirSync(join(root, "feature"));
    writeFileSync(join(root, "feature/api.ts"), 'import { internal } from "./internal"; export const api = () => internal();\n');
    writeFileSync(join(root, "feature/internal.ts"), 'import { api } from "./api"; export const internal = () => api();\n');
    for (const [id, include, parentId] of [[parent, "feature/**", undefined], [api, "feature/api.ts", parent], [internal, "feature/internal.ts", parent]] as const) {
      writeFileSync(join(root, ".archcontext/model/nodes", `${id}.yaml`), JSON.stringify({
        schemaVersion: "archcontext.node/v2",
        id, kind: parentId ? "component" : "capability", name: id, status: "active", summary: "Scoped refactor fixture",
        source: { include: [include] },
        ...(parentId ? { parent: parentId } : {})
      }));
    }
    commitProjectionFixture(root, "child-owned feature cycle");
    const invocation = codeGraphCliInvocation("codegraph", root);
    execFileSync(invocation.command, [...invocation.argsPrefix, "init", root], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const previousStateDir = process.env.ARCHCONTEXT_STATE_DIR;
    process.env.ARCHCONTEXT_STATE_DIR = testStateRoot(root);
    const daemon = await createStartedDaemon({
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider(),
      localStore: new TestLocalStore()
    });
    try {
      const run = (...args: string[]) => runCli("refactor", [...args, "--json"], root, { runtimeClient: daemon });
      const seed = await run("scan");
      expect(seed.ok, JSON.stringify(seed)).toBe(true);
      const data = seed.data as { recordCommand: string; proposedRecommendations: { recommendationId: string; subject: string }[] };
      const cycleId = data.proposedRecommendations.find((record) => record.subject === `pair:${api}|${internal}`)!.recommendationId;
      const recorded = await run(...data.recordCommand.split(" ").slice(2));
      expect(recorded.ok, JSON.stringify(recorded)).toBe(true);

      const scoped = await run("scan", "--node", parent);
      expect(scoped.ok, JSON.stringify(scoped)).toBe(true);
      expect(scoped.data).toMatchObject({
        trackedFileCount: 2,
        snapshot: {
          scope: { kind: "node", nodeId: parent },
          modules: expect.arrayContaining([
            expect.objectContaining({ nodeId: parent, footprint: expect.objectContaining({ fileCount: 0 }) }),
            ...ownerNodes.map((nodeId) => expect.objectContaining({ nodeId, footprint: expect.objectContaining({ fileCount: 1 }) }))
          ]),
          moduleDependencies: [
            { fromNodeId: api, toNodeId: internal, distinctFileEdgeCount: 1 },
            { fromNodeId: internal, toNodeId: api, distinctFileEdgeCount: 1 }
          ]
        },
        assessment: { observations: [expect.objectContaining({ kind: "cycle", affectedNodeIds: ownerNodes })] },
        proposedRecommendations: [],
        openRecommendations: [expect.objectContaining({ recommendationId: cycleId, status: "open" })]
      });
      const rawScope = await run("scan", "--request-json", JSON.stringify({
        schemaVersion: "archcontext.refactor-request/v1", scope: { kind: "node", nodeId: parent }
      }));
      expect(rawScope).toEqual(scoped);
      const leaf = await run("scan", "--node", api);
      expect(leaf.data).toMatchObject({
        snapshot: { scope: { kind: "node", nodeId: api } },
        assessment: { observations: [expect.objectContaining({ kind: "cycle", affectedNodeIds: ownerNodes })] }
      });
    } finally {
      await daemon.stop();
      if (previousStateDir === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
      else process.env.ARCHCONTEXT_STATE_DIR = previousStateDir;
      removeTempRoot(root);
    }
  });

  test("CLI refactor verify requires a request and dispatches it unchanged", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-refactor-verify-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const verifications: any[] = [];
      const envelope = {
        schemaVersion: "archcontext.runtime-refactor-verify/v1",
        recommendationId: "recommendation.rf5b",
        disposition: "resolved"
      };
      const runtimeClient = {
        refactorVerify(_root: string, input: any) {
          verifications.push(input);
          return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "refactor.verify", data: envelope };
        }
      };

      // Verify has no repository-scope default, so an absent flag is a caller that named no
      // subject rather than a caller asking for the default one.
      const missingFlag = await runCli("refactor", ["verify", "--json"], root, { runtimeClient: runtimeClient as any });
      expect(missingFlag.ok).toBe(false);
      expect((missingFlag as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect(String((missingFlag as any).error.message)).toBe("refactor verify --request-json is required");

      const malformed = await runCli("refactor", ["verify", "--request-json", "{not json"], root, { runtimeClient: runtimeClient as any });
      expect(malformed.ok).toBe(false);
      expect((malformed as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect(String((malformed as any).error.message)).toContain("not valid JSON");

      const notAnObject = await runCli("refactor", ["verify", "--request-json", "[]"], root, { runtimeClient: runtimeClient as any });
      expect(notAnObject.ok).toBe(false);
      expect((notAnObject as any).error.code).toBe("AC_SCHEMA_INVALID");

      const invalid = await runCli("refactor", ["verify", "--request-json", JSON.stringify({
        schemaVersion: "archcontext.refactor-verification-request/v1",
        recommendationId: "recommendation.rf5b",
        executionEvidenceRefs: [{ kind: "task_contract", locator: "x", sha256: "not-a-digest" }]
      })], root, { runtimeClient: runtimeClient as any });
      expect(invalid.ok).toBe(false);
      expect((invalid as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect(String((invalid as any).error.message)).toContain("sha256");
      expect(verifications).toHaveLength(0);

      // A typo in a top-level key is a claim the caller believes it made. Dropping it would run
      // the verification under a weaker precondition than the one that was typed.
      const typo = await runCli("refactor", ["verify", "--request-json", JSON.stringify({
        schemaVersion: "archcontext.refactor-verification-request/v1",
        recommendationId: "recommendation.rf5b",
        expectedWorktreeDigset: `sha256:${"b".repeat(64)}`
      })], root, { runtimeClient: runtimeClient as any });
      expect(typo.ok).toBe(false);
      expect((typo as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect(String((typo as any).error.message)).toContain("expectedWorktreeDigset");
      expect(verifications).toHaveLength(0);

      // A locator is a reference, not a body: an unbounded one could carry a raw diff or a
      // credential into a record whose envelope promises `privacy.rawDiffPersisted: false`.
      const unboundedLocator = await runCli("refactor", ["verify", "--request-json", JSON.stringify({
        schemaVersion: "archcontext.refactor-verification-request/v1",
        recommendationId: "recommendation.rf5b",
        executionEvidenceRefs: [{ kind: "task_contract", locator: "--- a/secrets.ts\n+const k = 1;", sha256: "c".repeat(64) }]
      })], root, { runtimeClient: runtimeClient as any });
      expect(unboundedLocator.ok).toBe(false);
      expect((unboundedLocator as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect(String((unboundedLocator as any).error.message)).toContain("executionEvidenceRefs[0].locator");
      expect(verifications).toHaveLength(0);

      const request = {
        schemaVersion: "archcontext.refactor-verification-request/v1",
        recommendationId: "recommendation.rf5b",
        expectedHeadSha: "a".repeat(40),
        executionEvidenceRefs: [
          { kind: "merge_receipt", locator: "tasks/receipts/rf5b.json", sha256: "c".repeat(64) }
        ]
      };
      const verified = await runCli("refactor", ["verify", "--request-json", JSON.stringify(request), "--json"], root, { runtimeClient: runtimeClient as any });
      expect(verified.ok).toBe(true);
      // The parsed request reaches the RPC exactly as typed, and the envelope crosses back unchanged.
      expect(verifications).toEqual([request]);
      expect(verified.data).toBe(envelope as any);
    } finally {
      removeTempRoot(root);
    }
  });

  test("CLI --import-node-limit reaches recommendations show, the decisions and refactor verify", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-import-node-limit-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const recommendations: any[] = [];
      const verifications: any[] = [];
      const runtimeClient = {
        recommendations(_root: string, input: any) {
          recommendations.push(input);
          return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "recommendations", data: {} };
        },
        refactorVerify(_root: string, input: any) {
          verifications.push(input);
          return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "refactor.verify", data: {} };
        }
      };
      const run = (command: string, args: string[]) => runCli(command, args, root, { runtimeClient: runtimeClient as any });

      expect((await run("recommendations", ["show", "--id", "recommendation.x", "--import-node-limit", "100000", "--json"])).ok).toBe(true);
      expect(recommendations[0]).toEqual({ command: "show", recommendationId: "recommendation.x", importNodeLimit: 100000 });
      expect((await run("recommendations", ["defer", "--id", "recommendation.x", "--reason", "later", "--import-node-limit", "7"])).ok).toBe(true);
      expect(recommendations[1]).toMatchObject({ command: "defer", recommendationId: "recommendation.x", reason: "later", importNodeLimit: 7 });
      // No flag sends no limit, so the daemon reads at its default.
      await run("recommendations", ["accept", "--id", "recommendation.x", "--reason", "now"]);
      expect(recommendations[2]).not.toHaveProperty("importNodeLimit");

      const request = { schemaVersion: "archcontext.refactor-verification-request/v1", recommendationId: "recommendation.x" };
      expect((await run("refactor", ["verify", "--request-json", JSON.stringify(request), "--import-node-limit", "100000"])).ok).toBe(true);
      expect(verifications[0]).toEqual({ ...request, importNodeLimit: 100000 });
      expect((await run("refactor", ["verify", "--request-json", JSON.stringify({ ...request, importNodeLimit: 9 })])).ok).toBe(true);
      expect(verifications[1]).toEqual({ ...request, importNodeLimit: 9 });

      for (const bad of ["0", "-5", "1e3", "abc", "--json"]) {
        for (const args of [
          ["recommendations", ["show", "--id", "recommendation.x", "--import-node-limit", bad]],
          ["recommendations", ["defer", "--id", "recommendation.x", "--reason", "later", "--import-node-limit", bad]],
          ["refactor", ["verify", "--request-json", JSON.stringify(request), "--import-node-limit", bad]]
        ] as const) {
          const rejected = await run(args[0], [...args[1]]);
          expect(rejected.ok, `${args[0]} ${args[1][0]} ${bad}`).toBe(false);
          expect((rejected as any).error.code).toBe("AC_SCHEMA_INVALID");
        }
      }
      const missingValue = await run("recommendations", ["show", "--id", "recommendation.x", "--import-node-limit"]);
      expect(missingValue.ok).toBe(false);
      expect(recommendations).toHaveLength(3);
      expect(verifications).toHaveLength(2);

      const snapshotDigest = `sha256:${"a".repeat(64)}`;
      const decide = (command: string, ...flags: string[]) => run("recommendations", [command, "--id", "recommendation.x", "--reason", "reviewed", ...flags]);
      for (const command of ["accept", "defer", "reject"]) {
        expect((await decide(command, "--snapshot-digest", snapshotDigest)).ok).toBe(true);
        expect(recommendations.at(-1)).toMatchObject({ command, snapshotDigest });
        expect(recommendations.at(-1)).not.toHaveProperty("importNodeLimit");
      }
      for (const flags of [["--snapshot-digest"], ["--snapshot-digest", ""], ["--snapshot-digest", "bad"], ["--snapshot-digest", snapshotDigest, "--snapshot-digest", snapshotDigest]]) {
        expect(await decide("accept", ...flags)).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
      }
      expect(await decide("waive", "--snapshot-digest", snapshotDigest)).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
      expect(recommendations).toHaveLength(6);
    } finally {
      removeTempRoot(root);
    }
  });

  test("CLI refactor rejects an invalid invocation without ever obtaining a runtime handle", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-refactor-no-runtime-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const client = {
        refactorScan(_root: string, _input: any) {
          return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "refactor.scan", data: {} };
        },
        refactorRecord(_root: string, _input: any) {
          return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "refactor.record", data: {} };
        },
        refactorVerify(_root: string, _input: any) {
          return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "refactor.verify", data: {} };
        }
      };
      // `createCliRuntime` reads `deps.runtimeClient` to decide whether it must build a handle, so
      // counting the reads counts the times the CLI reached for a runtime. Without an injected
      // client that same reach spawns a daemon: a connection file, a thirty-minute idle process,
      // possibly a state migration — none of which a rejected invocation asked for.
      let runtimeReaches = 0;
      const deps: any = {};
      Object.defineProperty(deps, "runtimeClient", {
        get() {
          runtimeReaches += 1;
          return client;
        },
        enumerable: false,
        configurable: true
      });

      const rejected: string[][] = [
        ["verify", "--json"],
        ["verify", "--request-json", "{not json"],
        ["verify", "--request-json", "[]"],
        ["verify", "--request-json", JSON.stringify({
          schemaVersion: "archcontext.refactor-verification-request/v1",
          recommendationId: "recommendation.rf5b",
          expectedWorktreeDigset: `sha256:${"b".repeat(64)}`
        })],
        ["verify", "--request-json", JSON.stringify({
          schemaVersion: "archcontext.refactor-verification-request/v1",
          recommendationId: "recommendation.rf5b",
          executionEvidenceRefs: [{ kind: "task_contract", locator: "a".repeat(257), sha256: "c".repeat(64) }]
        })],
        ["verify", "--request-json"],
        ["scan", "--request-json", "{not json"],
        ["scan", "--request-json", JSON.stringify({ schemaVersion: "archcontext.refactor-request/v0", scope: { kind: "repository" } })],
        ["record", "--assessment-digest", `sha256:${"b".repeat(64)}`],
        ["resolve"]
      ];
      for (const args of rejected) {
        const result = await runCli("refactor", args, root, deps);
        expect(result.ok, JSON.stringify({ args, result })).toBe(false);
        expect((result as any).error.code, JSON.stringify(args)).toBe("AC_SCHEMA_INVALID");
      }
      expect(runtimeReaches).toBe(0);

      // Control: the same surface does reach for a runtime once the invocation is valid, so the
      // count above is a property of the rejection and not of the injected deps.
      const accepted = await runCli("refactor", ["verify", "--request-json", JSON.stringify({
        schemaVersion: "archcontext.refactor-verification-request/v1",
        recommendationId: "recommendation.rf5b"
      })], root, deps);
      expect(accepted.ok).toBe(true);
      expect(runtimeReaches).toBeGreaterThan(0);
    } finally {
      removeTempRoot(root);
    }
  });

  test("CLI refactor rejects a value flag with no value and rejects --selection", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-refactor-flags-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const scans: any[] = [];
      const records: any[] = [];
      const runtimeClient = {
        refactorScan(_root: string, input: any) {
          scans.push(input);
          return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "refactor.scan", data: {} };
        },
        refactorRecord(_root: string, input: any) {
          records.push(input);
          return { schemaVersion: "archcontext.envelope/v1", ok: true, requestId: "refactor.record", data: { input } };
        }
      };

      // A bare --request-json is a caller that meant to pass one, not an absent flag.
      const bareRequestJson = await runCli("refactor", ["scan", "--request-json"], root, { runtimeClient: runtimeClient as any });
      expect(bareRequestJson.ok).toBe(false);
      expect((bareRequestJson as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((bareRequestJson as any).error.message).toContain("--request-json");
      expect(scans).toHaveLength(0);

      const swallowedFlag = await runCli("refactor", ["scan", "--request-json", "--json"], root, { runtimeClient: runtimeClient as any });
      expect(swallowedFlag.ok).toBe(false);
      expect((swallowedFlag as any).error.message).toContain("--request-json");
      expect(scans).toHaveLength(0);

      const missingDigestValue = await runCli("refactor", [
        "record",
        "--assessment-digest",
        "--expected-worktree-digest", `sha256:${"c".repeat(64)}`
      ], root, { runtimeClient: runtimeClient as any });
      expect(missingDigestValue.ok).toBe(false);
      expect((missingDigestValue as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((missingDigestValue as any).error.message).toContain("--assessment-digest");
      expect(records).toHaveLength(0);

      // Nothing consumes a selection yet, so it is an unknown flag rather than a passthrough.
      const selected = await runCli("refactor", [
        "record",
        "--assessment-digest", `sha256:${"b".repeat(64)}`,
        "--expected-worktree-digest", `sha256:${"c".repeat(64)}`,
        "--selection", "x",
        "--json"
      ], root, { runtimeClient: runtimeClient as any });
      expect(selected.ok).toBe(false);
      expect((selected as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((selected as any).error.message).toContain("unknown flag --selection");
      expect(records).toHaveLength(0);

      const accepted = await runCli("refactor", [
        "record",
        "--assessment-digest", `sha256:${"b".repeat(64)}`,
        "--expected-worktree-digest", `sha256:${"c".repeat(64)}`,
        "--json"
      ], root, { runtimeClient: runtimeClient as any });
      expect(accepted.ok).toBe(true);
      expect(records[0]).toEqual({
        assessmentDigest: `sha256:${"b".repeat(64)}`,
        expectedWorktreeDigest: `sha256:${"c".repeat(64)}`
      });
    } finally {
      removeTempRoot(root);
    }
  });

  // `import.meta.main` is false when the suite imports `runCli`, so the entrypoint block never runs
  // and a declaration hoisting bug below it stays invisible to every other refactor test here.
  test("spawned CLI refactor record rejects a value-less flag instead of a module-evaluation error", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-refactor-spawn-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const rejected = await runCliProcessRaw(root, "refactor", "record", "--assessment-digest", "--json");
      expect(rejected.code).toBe(1);
      const envelope = JSON.parse(rejected.stdout);
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe("AC_SCHEMA_INVALID");
      expect(String(envelope.error.message)).toContain("--assessment-digest");
    } finally {
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("spawned CLI refactor verify without a request rejects before any runtime work", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-refactor-verify-spawn-"));
    writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
    try {
      const rejected = await runCliProcessRaw(root, "refactor", "verify", "--json");
      expect(rejected.code).toBe(1);
      const envelope = JSON.parse(rejected.stdout);
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe("AC_SCHEMA_INVALID");
      expect(String(envelope.error.message)).toBe("refactor verify --request-json is required");
    } finally {
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("CLI help lists the refactor verb and one example", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-refactor-help-"));
    try {
      const help = await runCli("help", [], root);
      expect((help.data as any).commands).toContain("refactor");
      expect((help.data as any).examples).toContain("archctx refactor scan --json");
      expect((help.data as any).examples.filter((example: string) => example.includes("refactor verify"))).toHaveLength(1);
    } finally {
      removeTempRoot(root);
    }
  });

  test("github is not a command: it answers the command list, which omits it", async () => {
    const result = await runCli("github", ["connect"], tmpdir()) as any;
    expect(result).toMatchObject({ ok: true, requestId: "help" });
    expect(result.data.commands).not.toContain("github");
  });

  test("CLI exposes repo and landscape commands without changing single-repo defaults", async () => {
    const root = gitTempRoot("archctx-cli-");
    const otherRoot = gitTempRoot("archctx-cli-other-");
    try {
      writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
      writeFileSync(join(otherRoot, "README.md"), "# other\n", "utf8");
      const added = await runTestCli("repo", ["add", "--name", "web"], root);
      expect(added.ok).toBe(true);
      expect((added.data as any).repository.name).toBe("web");
      const denied = await runTestCli("repo", ["add", "--root", otherRoot, "--name", "other"], root);
      expect(denied.ok).toBe(false);
      expect((denied as any).error?.code).toBe("AC_CAPABILITY_UNSUPPORTED");
      const landscape = await runTestCli("landscape", [], root);
      expect(landscape.ok).toBe(true);
      expect((landscape.data as any).schemaVersion).toBe("archcontext.landscape/v1");
      const context = await runTestCli("context", ["--landscape", "--task", "change local API", "--max-symbols", "2"], root);
      expect(context.ok).toBe(true);
      expect((context.data as any).extensions.landscapeDigest).toMatch(/^sha256:/);
      const explore = await runTestCli("explore", ["projection", "--max-nodes", "5", "--max-relations", "5"], root);
      expect(explore.ok).toBe(true);
      expect((explore.data as any).schemaVersion).toBe("archcontext.explorer-projection/v2");
      expect((explore.data as any).view.id).toBe("system-map");
      expect((explore.data as any).page.budget).toEqual({ maxNodes: 5, maxRelations: 5 });
      expect((explore.data as any).occurrences.length).toBeLessThanOrEqual(5);
      for (const view of ["data-flow", "external-integrations"] as const) {
        const typedView = await runTestCli("explore", ["projection", "--view", view, "--max-nodes", "5", "--max-relations", "5"], root);
        expect(typedView.ok).toBe(true);
        expect((typedView.data as any).view.id).toBe(view);
      }
      await expect(runTestCli("explore", ["projection", "--view", "external-by-name"], root))
        .rejects.toThrow("unsupported Explorer view");
      const legacyDelta = await runTestCli("explore", [
        "delta",
        "--base-projection-digest", (explore.data as any).projectionDigest,
        "--head-projection-digest", (explore.data as any).projectionDigest
      ], root);
      expect(legacyDelta.ok).toBe(false);
      expect((legacyDelta as any).error.message).toContain("--base-event-id");
      const start = await runTestCli("explore", ["start"], root);
      expect((start.data as any).command).toBe("archctx explore start --foreground");
      expect((start.data as any).readOnly).toBe(true);
    } finally {
      removeTempRoot(root);
      removeTempRoot(otherRoot);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("CLI exports Mermaid projection without overwriting Native model", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-"));
    try {
      writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
      initializeArchContextModel(root, "CLI Export App");
      const mermaid = await runTestCli("export", ["mermaid"], root);
      expect(mermaid.ok).toBe(true);
      expect((mermaid.data as any).format).toBe("mermaid");
      expect((mermaid.data as any).files[0].path).toContain("architecture.mmd");
    } finally {
      removeTempRoot(root);
    }
  });

  test("required code facts without a CodeGraph index fail projection with AC_CODE_FACTS_UNAVAILABLE", async () => {
    const root = createInitializedGitRepo();
    try {
      // The default manifest requires code facts; the fixture never runs `codegraph init`.
      expect(readFileSync(join(root, ".archcontext/manifest.yaml"), "utf8")).toMatch(/^codeFacts:\n(?: {2}.*\n)*? {2}required: true$/m);
      expect(existsSync(join(root, ".codegraph"))).toBe(false);
      // A capability with a declared footprint and selector-bearing flow: without code facts every
      // selector is unproven, which is what used to surface as a major change.
      rmSync(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"), { force: true });
      writeFileSync(join(root, ".archcontext/model/nodes/capability.runtime-harness.hook-adapters.yaml"), stableYaml({
        schemaVersion: "archcontext.node/v2",
        id: "capability.runtime-harness.hook-adapters",
        kind: "capability",
        name: "Hook Adapters",
        status: "active",
        summary: "Routes runtime hook events.",
        source: { include: ["README.md"] },
        extensions: { contractFiles: { agents: "AGENTS.md", claude: "CLAUDE.md" } }
      }), "utf8");
      git(root, "add", "-A");
      git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "hook adapters");
      const expectUnavailable = (result: Awaited<ReturnType<typeof runTestCli>>, requestId: string) => {
        const envelope = result as JsonEnvelope;
        expect(envelope.ok, JSON.stringify(envelope)).toBe(false);
        expect(envelope.requestId).toBe(requestId);
        expect(envelope.error).toMatchObject({
          code: "AC_CODE_FACTS_UNAVAILABLE",
          reasonCode: "index-missing",
          retryable: true,
          action: "codegraph-init"
        });
        expect(envelope.error?.message).toContain("codegraph init");
      };

      expectUnavailable(await runTestCli("docs", ["plan", "--profile", "repo-harness/v1"], root), "docs.plan");
      const protocolRequest: ProjectionRequestV1 = {
        schemaVersion: "archcontext.projection-request/v1",
        requestId: "projection_request.code_facts_unavailable",
        profile: "repo-harness/v1",
        mode: "check",
        targets: ["agent-context", "architecture-docs"],
        changedPaths: [],
        expected: {
          repositoryId: repositoryFingerprint(root),
          workspaceId: `workspace.${digestJson({ root: canonicalRepositoryRoot(root) } as any).replace(/^sha256:/, "").slice(0, 16)}`,
          headSha: gitOut(root, "rev-parse", "HEAD"),
          worktreeDigest: architectureDocumentationProjectionWorktreeDigest(root, loadNativeModelFromArchContext(root), listGitVisibleFiles(root)) as `sha256:${string}`
        }
      };
      expectUnavailable(await runTestCli("projection", ["run", "--request-json", JSON.stringify(protocolRequest)], root), "projection.run");
      expectUnavailable(await runTestCli("projection", ["run", "--request-json", JSON.stringify({
        ...protocolRequest,
        requestId: "projection_request.code_facts_unavailable_apply",
        mode: "apply"
      })], root), "projection.run");
      // Nothing was classified, written, or signalled: the projection never reached the renderer.
      expect(existsSync(join(root, "docs/architecture"))).toBe(false);
      expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
      expect(gitOut(root, "status", "--porcelain")).toBe("");
    } finally {
      removeTempRoot(root);
    }
  }, PROJECTION_CODEGRAPH_TEST_TIMEOUT_MS);

  test("docs apply and complete agree on projection digest for default", async () => {
    const profile = "default";
    const root = createInitializedGitRepo({ codeFacts: "optional" });
    try {
      const applied = await runTestCli("docs", ["apply", "--profile", profile, "--approved"], root);
      expect(applied.ok).toBe(true);
      const drift = await runTestCli("docs", ["drift", "--profile", profile], root);
      expect((drift.data as any).ok).toBe(true);
      const completed = await runTestCli("complete", ["--task", "verify freshly applied documentation"], root);
      expect(completed.ok).toBe(true);
      expect((completed.data as any).findings.some((finding: any) => finding.id === "projection-drift")).toBe(false);
    } finally {
      removeTempRoot(root);
    }
  }, CLI_DOCS_TEST_TIMEOUT_MS);

  /**
   * Drives the shared adoption fixture and asserts its invariants: docs adopt is
   * preview-bound, human sections survive, the next profile apply is a noop, and an
   * accepted major change produces exactly one deduplicated refresh signal. Two tests
   * need that end state, so the scenario is driven once here and the caller owns cleanup.
   */
  async function runAdoptedHookAdaptersScenario(options: { codeGraphReady?: boolean } = {}) {
    const root = createInitializedGitRepo({ codeFacts: options.codeGraphReady ? "required" : "optional" });
    const modulePath = "docs/architecture/modules/runtime-harness/hook-adapters.md";
    const original = [
      "# runtime-harness/hook-adapters",
      "",
      "## 1. Old P1",
      "legacy architecture",
      "",
      "## 2. Old P2",
      "legacy dataflow",
      "",
      "## 3. P3 Decisions",
      "human decision  ",
      "",
      "## 4. History",
      "human history",
      ""
    ].join("\n");
    try {
      rmSync(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"), { force: true });
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.runtime-harness.hook-adapters.yaml"),
        stableYaml({
          schemaVersion: "archcontext.node/v2",
          id: "capability.runtime-harness.hook-adapters",
          kind: "capability",
          name: "Hook Adapters",
          status: "active",
          summary: "Routes runtime hook events.",
          extensions: {
            contractFiles: {
              agents: "packages/runtime-harness/AGENTS.md",
              claude: "packages/runtime-harness/CLAUDE.md"
            }
          }
        }),
        "utf8"
      );
      mkdirSync(join(root, ".archcontext/model/relations"), { recursive: true });
      writeFileSync(
        join(root, ".archcontext/model/relations/relation.hook-journal.yaml"),
        stableYaml({
          schemaVersion: "archcontext.relation/v1",
          id: "relation.hook-journal",
          kind: "writes",
          source: "capability.runtime-harness.hook-adapters",
          target: "capability.runtime-harness.hook-adapters",
          intent: "Persist hook event in the owned journal"
        }),
        "utf8"
      );
      mkdirSync(join(root, ".archcontext/model/flows"), { recursive: true });
      writeFileSync(
        join(root, ".archcontext/model/flows/flow.hook-adapters.yaml"),
        stableYaml({
          schemaVersion: "archcontext.flow/v1",
          id: "flow.hook-adapters",
          capabilityId: "capability.runtime-harness.hook-adapters",
          name: "Hook projection",
          applicability: "not-applicable",
          rationale: "This fixture verifies static journal ownership only."
        }),
        "utf8"
      );
      mkdirSync(dirname(join(root, modulePath)), { recursive: true });
      writeFileSync(join(root, modulePath), original, "utf8");
      if (options.codeGraphReady) {
        execFileSync("codegraph", ["init", root], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      }

      const ordinary = await runTestCli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"], root);
      expect(ordinary.ok).toBe(false);
      expect(readFileSync(join(root, modulePath), "utf8")).toBe(original);

      const preview = await runTestCli("docs", ["adopt", "--profile", "repo-harness/v1"], root);
      expect(preview.ok).toBe(true);
      expect((preview.data as any).allowed).toBe(true);
      expect(readFileSync(join(root, modulePath), "utf8")).toBe(original);

      const unbound = await runTestCli("docs", ["adopt", "--profile", "repo-harness/v1", "--approved"], root);
      expect(unbound.ok).toBe(false);
      expect(readFileSync(join(root, modulePath), "utf8")).toBe(original);

      const expectedWorktreeDigest = computeWorktreeDigest(root, listGitVisibleFiles(root));
      const mismatched = await runTestCli("docs", [
        "adopt",
        "--profile", "repo-harness/v1",
        "--approved",
        "--adoption-plan-id", "adoption_plan.wrong",
        "--expected-worktree-digest", expectedWorktreeDigest
      ], root);
      expect(mismatched.ok).toBe(false);
      expect(readFileSync(join(root, modulePath), "utf8")).toBe(original);

      const applied = await runTestCli("docs", [
        "adopt",
        "--profile", "repo-harness/v1",
        "--approved",
        "--adoption-plan-id", (preview.data as any).adoptionPlanId,
        "--expected-worktree-digest", expectedWorktreeDigest
      ], root);
      expect(applied.ok, JSON.stringify(applied)).toBe(true);
      const adopted = readFileSync(join(root, modulePath), "utf8");
      expect(adopted).toStartWith("# runtime-harness/hook-adapters\n<!-- BEGIN ARCHCONTEXT:generated");
      expect(adopted).toEndWith("## 3. P3 Decisions\nhuman decision  \n\n## 4. History\nhuman history\n");

      const second = await runTestCli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"], root);
      expect(second.ok).toBe(true);
      expect((second.data as any).status).toBe("noop");
      expect((second.data as any).provenance).toMatchObject({
        schemaVersion: "archcontext.architecture-docs-projection-provenance/v3",
        rendererVersion: "archcontext.docs-renderer/v6",
        layoutVersion: "archcontext.docs-layout/v1",
        generatedFrom: {
          codeGraphPackage: "@colbymchenry/codegraph",
          codeGraphVersion: "1.6.4"
        }
      });
      expect((second.data as any).provenance.projectionInputDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      // HEAD, worktree and CodeGraph index identity are runtime facts; the committed provenance carries none (#277).
      for (const field of ["baseHeadSha", "worktreeDigest", "codeGraphDigest", "indexedWorktreeDigest"]) {
        expect((second.data as any).provenance).not.toHaveProperty(field);
      }
      expect((second.data as any).provenance.generatedFrom).not.toHaveProperty("codeGraphStatus");
      expect((second.data as any).runtimeSnapshot).toMatchObject({ codeGraphStatus: options.codeGraphReady ? "ready" : "unavailable" });
      const manifest = JSON.parse(readFileSync(join(root, "docs/architecture/.projection-manifest.json"), "utf8"));
      // The provenance is runtime-only (#327): the manifest commits its header fields and the model
      // anchor, and records no source tree digest (ADR-0056).
      const provenance = (second.data as any).provenance;
      expect(manifest).not.toHaveProperty("provenance");
      expect({ rendererVersion: manifest.rendererVersion, layoutVersion: manifest.layoutVersion, generatedFrom: manifest.generatedFrom })
        .toEqual({ rendererVersion: provenance.rendererVersion, layoutVersion: provenance.layoutVersion, generatedFrom: provenance.generatedFrom });
      expect(manifest.semanticBaseline.modelDigest).toBe(provenance.modelDigest);
      const completed = await runTestCli("complete", ["--task", "verify adopted documentation"], root);
      expect(completed.ok).toBe(true);
      expect((completed.data as any).findings.some((finding: any) => finding.id === "projection-drift")).toBe(false);

      const nodePath = join(root, ".archcontext/model/nodes/capability.runtime-harness.hook-adapters.yaml");
      writeFileSync(nodePath, readFileSync(nodePath, "utf8").replace("Routes runtime hook events.", "Routes and validates runtime hook events."), "utf8");
      const unresolvedPlan = await runTestCli("docs", ["plan", "--profile", "repo-harness/v1"], root);
      expect(unresolvedPlan.ok).toBe(true);
      expect((unresolvedPlan.data as any).majorChange.mode).toBe("human-action-required");
      const protocolRequest: ProjectionRequestV1 = {
        schemaVersion: "archcontext.projection-request/v1",
        requestId: "projection_request.hook_adapters_major",
        profile: "repo-harness/v1",
        mode: "plan",
        targets: ["agent-context", "architecture-docs"],
        changedPaths: [".archcontext/model/nodes/capability.runtime-harness.hook-adapters.yaml"],
        expected: {
          repositoryId: repositoryFingerprint(root),
          workspaceId: `workspace.${digestJson({ root: canonicalRepositoryRoot(root) } as any).replace(/^sha256:/, "").slice(0, 16)}`,
          headSha: gitOut(root, "rev-parse", "HEAD"),
          worktreeDigest: (unresolvedPlan.data as any).runtimeSnapshot.worktreeDigest
        }
      };
      const unresolvedProtocol = await runTestCli("projection", ["run", "--request-json", JSON.stringify(protocolRequest)], root);
      expect(unresolvedProtocol.ok, JSON.stringify(unresolvedProtocol)).toBe(true);
      expect((unresolvedProtocol.data as ProjectionResultV3).status).toBe("human-action-required");
      expect((unresolvedProtocol.data as ProjectionResultV3).refreshSignals[0]?.mode).toBe("human-action-required");

      const acceptedChange = {
        changeSetId: "changeset.hook-adapters-major",
        eventId: "architecture_event.hook-adapters-major",
        reasonCodes: ["responsibility-changed"],
        affectedNodeIds: ["capability.runtime-harness.hook-adapters"]
      } satisfies AcceptedArchitectureChangeReferenceV1;
      const acceptedProtocol = await runTestCli("projection", ["run", "--request-json", JSON.stringify({
        ...protocolRequest,
        requestId: "projection_request.hook_adapters_major_accepted",
        acceptedChange
      })], root);
      expect(acceptedProtocol.ok).toBe(true);
      expect((acceptedProtocol.data as ProjectionResultV3).status).toBe("planned");
      expect((acceptedProtocol.data as ProjectionResultV3).refreshSignals[0]).toMatchObject({
        mode: "refresh-required",
        acceptedChange
      });

      const signalArgs = [
        "plan", "--profile", "repo-harness/v1",
        "--accepted-change-set-id", "changeset.hook-adapters-major",
        "--accepted-event-id", "architecture_event.hook-adapters-major",
        "--major-reason", "responsibility-changed",
        "--affected-node", "capability.runtime-harness.hook-adapters"
      ];
      const signalPlan = await runTestCli("docs", signalArgs, root);
      const duplicateSignalPlan = await runTestCli("docs", signalArgs, root);
      expect(signalPlan.ok).toBe(true);
      expect((signalPlan.data as any).majorChange.mode).toBe("refresh-required");
      expect((signalPlan.data as any).refreshSignals).toHaveLength(1);
      expect((duplicateSignalPlan.data as any).refreshSignals[0].signalId)
        .toBe((signalPlan.data as any).refreshSignals[0].signalId);
      return { root, modulePath, protocolRequest, acceptedChange, signalPlan };
    } catch (error) {
      removeTempRoot(root);
      throw error;
    }
  }

  test("docs adopt is preview-bound, preserves human sections, and makes the next profile apply a noop", async () => {
    const { root, modulePath } = await runAdoptedHookAdaptersScenario();
    try {
      // The scenario asserts each step; the committed end state is re-read here so the adopted
      // generated block and the human-owned tail are still pinned after the whole sequence.
      const adopted = readFileSync(join(root, modulePath), "utf8");
      expect(adopted).toStartWith("# runtime-harness/hook-adapters\n<!-- BEGIN ARCHCONTEXT:generated");
      expect(adopted).toEndWith("## 3. P3 Decisions\nhuman decision  \n\n## 4. History\nhuman history\n");
    } finally {
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("status reports and adoption refuses a model excluded by Git ignore rules (#399)", async () => {
    const root = createInitializedGitRepo();
    try {
      const clean = await runTestCli("status", [], root);
      expect(clean.ok, JSON.stringify(clean)).toBe(true);
      expect(clean.data as Record<string, unknown>).not.toHaveProperty("architectureModelIgnoredPaths");

      // A blanket rule after negations cancels them: Git cannot re-include below an excluded directory.
      writeFileSync(join(root, ".gitignore"), "!.archcontext/model/\n/.archcontext/\n", "utf8");
      const ignoredPaths = [
        ".archcontext/manifest.yaml",
        ".archcontext/product.yaml",
        ".archcontext/model/nodes/",
        ".archcontext/model/relations/",
        ".archcontext/model/flows/",
        ".archcontext/model/state-machines/",
        ".archcontext/decisions/",
        ".archcontext/policies/",
        ".archcontext/practices/",
        ".archcontext/projections/"
      ];
      const status = await runTestCli("status", [], root);
      expect(status.ok, JSON.stringify(status)).toBe(true);
      expect((status.data as any).architectureModelIgnoredPaths).toEqual(ignoredPaths.map((path) => ({ path, source: ".gitignore", line: 2, pattern: "/.archcontext/" })));

      const expectRefused = (result: Awaited<ReturnType<typeof runTestCli>>, requestId: string) => {
        const envelope = result as JsonEnvelope;
        expect(envelope.ok, JSON.stringify(envelope)).toBe(false);
        expect(envelope.requestId).toBe(requestId);
        expect(envelope.error).toMatchObject({
          code: "AC_PRECONDITION_FAILED",
          reasonCode: "architecture-model-ignored",
          action: "commit-architecture-model",
          details: {
            pathCount: 10,
            paths: ignoredPaths.slice(0, 8),
            commands: [`git check-ignore --verbose --no-index -- ${ignoredPaths.slice(0, 8).join(" ")}`],
            omittedPathCount: 2
          }
        });
      };
      expectRefused(await runTestCli("docs", ["adopt", "--profile", "repo-harness/v1"], root), "docs.adopt");
      expectRefused(await runTestCli("projection", ["run", "--request-json", JSON.stringify({
        schemaVersion: "archcontext.projection-request/v1",
        requestId: "projection_request.model_ignored_adopt",
        profile: "repo-harness/v1",
        mode: "adopt",
        targets: ["architecture-docs"],
        changedPaths: [],
        expected: {
          repositoryId: repositoryFingerprint(root),
          workspaceId: `workspace.${digestJson({ root: canonicalRepositoryRoot(root) } as any).replace(/^sha256:/, "").slice(0, 16)}`,
          headSha: gitOut(root, "rev-parse", "HEAD"),
          worktreeDigest: computeWorktreeDigest(root, listGitVisibleFiles(root)) as `sha256:${string}`
        },
        adoptionPlanId: "adoption_plan.model_ignored"
      } satisfies ProjectionRequestV1)], root), "projection.run");
      expect(existsSync(join(root, "docs/architecture"))).toBe(false);

      // A file rule leaves the directory visible, so the present model files are probed too.
      writeFileSync(join(root, ".gitignore"), ".archcontext/model/nodes/*.yaml\n", "utf8");
      const nodeFile = ".archcontext/model/nodes/capability.architecture.context.yaml";
      const fileRule = await runTestCli("status", [], root);
      expect((fileRule.data as any).architectureModelIgnoredPaths).toEqual([{ path: nodeFile, source: ".gitignore", line: 1, pattern: ".archcontext/model/nodes/*.yaml" }]);
      const fileRuleAdopt = await runTestCli("docs", ["adopt", "--profile", "repo-harness/v1"], root) as JsonEnvelope;
      expect(fileRuleAdopt.error).toMatchObject({ reasonCode: "architecture-model-ignored", details: { pathCount: 1, paths: [nodeFile], omittedPathCount: 0 } });
    } finally {
      removeTempRoot(root);
    }
  }, CLI_DOCS_TEST_TIMEOUT_MS);

  test("first docs adoption settles its manifest while preserving unresolved flow proof", async () => {
    const root = createInitializedGitRepo({ codeFacts: "optional" });
    const modulePath = "docs/architecture/modules/runtime-harness/hook-adapters.md";
    const humanTail = "## 3. Human decisions\nretain  exact spacing  \n";
    try {
      rmSync(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"), { force: true });
      writeFileSync(join(root, ".archcontext/model/nodes/capability.runtime-harness.hook-adapters.yaml"), stableYaml({
        schemaVersion: "archcontext.node/v2", id: "capability.runtime-harness.hook-adapters",
        kind: "capability", name: "Hook Adapters", status: "active", summary: "Routes hook events.",
        extensions: { contractFiles: { agents: "AGENTS.md", claude: "CLAUDE.md" } }
      }), "utf8");
      mkdirSync(dirname(join(root, modulePath)), { recursive: true });
      writeFileSync(join(root, modulePath), `# Hook Adapters\n\n## 1. Map\n\n## 2. Trace\n\n${humanTail}`, "utf8");
      expect(existsSync(join(root, "docs/architecture/.projection-manifest.json"))).toBe(false);
      const preview = await runTestCli("docs", ["adopt", "--profile", "repo-harness/v1"], root);
      expect(preview.ok, JSON.stringify(preview)).toBe(true);
      const binding = preview.data as { allowed: boolean; adoptionPlanId: string; expectedWorktreeDigest: string };
      expect(binding.allowed).toBe(true);
      const adopted = await runTestCli("docs", [
        "adopt", "--profile", "repo-harness/v1", "--approved",
        "--adoption-plan-id", binding.adoptionPlanId,
        "--expected-worktree-digest", binding.expectedWorktreeDigest
      ], root);
      expect(adopted.ok, JSON.stringify(adopted)).toBe(true);
      const body = readFileSync(join(root, modulePath), "utf8");
      expect(body).toStartWith("# Hook Adapters\n<!-- BEGIN ARCHCONTEXT:generated");
      expect(body).toEndWith(humanTail);
      const manifestBefore = readFileSync(join(root, "docs/architecture/.projection-manifest.json"), "utf8");
      const next = await runTestCli("docs", ["plan", "--profile", "repo-harness/v1"], root);
      expect(next.ok, JSON.stringify(next)).toBe(true);
      const plan = next.data as { drift: { ok: boolean }; majorChange: { mode: string }; refreshSignals: { mode: string }[] };
      expect(plan.drift.ok).toBe(true);
      expect(plan.majorChange.mode).toBe("human-action-required");
      expect(plan.refreshSignals).toHaveLength(1);
      expect(plan.refreshSignals[0]!.mode).toBe("human-action-required");
      expect(readFileSync(join(root, modulePath), "utf8")).toBe(body);
      expect(readFileSync(join(root, "docs/architecture/.projection-manifest.json"), "utf8")).toBe(manifestBefore);
    } finally {
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("projection adopt composes ownership adoption with one accepted semantic change", async () => {
    const root = createInitializedGitRepo();
    const modulePath = "docs/architecture/modules/runtime-harness/hook-adapters.md";
    const original = [
      "# runtime-harness/hook-adapters",
      "",
      "## 1. Old P1",
      "legacy architecture",
      "",
      "## 2. Old P2",
      "legacy dataflow",
      "",
      "## 3. P3 Decisions",
      "human decision  ",
      "",
      "## 4. History",
      "human history",
      ""
    ].join("\n");
    try {
      rmSync(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"), { force: true });
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.runtime-harness.hook-adapters.yaml"),
        stableYaml({
          schemaVersion: "archcontext.node/v2",
          id: "capability.runtime-harness.hook-adapters",
          kind: "capability",
          name: "Hook Adapters",
          status: "active",
          summary: "Routes runtime hook events.",
          extensions: {
            contractFiles: {
              agents: "packages/runtime-harness/AGENTS.md",
              claude: "packages/runtime-harness/CLAUDE.md"
            }
          }
        }),
        "utf8"
      );
      mkdirSync(join(root, ".archcontext/model/relations"), { recursive: true });
      writeFileSync(
        join(root, ".archcontext/model/relations/relation.hook-journal.yaml"),
        stableYaml({
          schemaVersion: "archcontext.relation/v1",
          id: "relation.hook-journal",
          kind: "writes",
          source: "capability.runtime-harness.hook-adapters",
          target: "capability.runtime-harness.hook-adapters",
          intent: "Persist hook event in the owned journal"
        }),
        "utf8"
      );
      mkdirSync(join(root, ".archcontext/model/flows"), { recursive: true });
      writeFileSync(
        join(root, ".archcontext/model/flows/flow.hook-adapters.yaml"),
        stableYaml({
          schemaVersion: "archcontext.flow/v1",
          id: "flow.hook-adapters",
          capabilityId: "capability.runtime-harness.hook-adapters",
          name: "Hook projection",
          applicability: "not-applicable",
          rationale: "This fixture verifies atomic ownership adoption and semantic acceptance."
        }),
        "utf8"
      );
      execFileSync("codegraph", ["init", root], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      const baseline = await runTestCli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"], root);
      expect(baseline.ok, JSON.stringify(baseline)).toBe(true);
      const nodePath = join(root, ".archcontext/model/nodes/capability.runtime-harness.hook-adapters.yaml");
      writeFileSync(nodePath, readFileSync(nodePath, "utf8").replace("Routes runtime hook events.", "Routes and validates runtime hook events."), "utf8");
      mkdirSync(dirname(join(root, modulePath)), { recursive: true });
      writeFileSync(join(root, modulePath), original, "utf8");

      const expected = {
        repositoryId: repositoryFingerprint(root),
        workspaceId: `workspace.${digestJson({ root: canonicalRepositoryRoot(root) } as any).replace(/^sha256:/, "").slice(0, 16)}`,
        headSha: gitOut(root, "rev-parse", "HEAD"),
        worktreeDigest: architectureDocumentationProjectionWorktreeDigest(root, loadNativeModelFromArchContext(root), listGitVisibleFiles(root)) as `sha256:${string}`
      };
      const changedPaths = [
        ".archcontext/model/nodes/capability.runtime-harness.hook-adapters.yaml",
        modulePath
      ];
      const unresolved = await runTestCli("projection", ["run", "--request-json", JSON.stringify({
        schemaVersion: "archcontext.projection-request/v1",
        requestId: "projection_request.hook_adapters_adopt_unresolved",
        profile: "repo-harness/v1",
        mode: "plan",
        targets: ["architecture-docs"],
        changedPaths,
        expected
      } satisfies ProjectionRequestV1)], root);
      expect(unresolved.ok, JSON.stringify(unresolved)).toBe(true);
      expect((unresolved.data as ProjectionResultV3).status).toBe("adoption-required");
      const unresolvedSignal = (unresolved.data as ProjectionResultV3).refreshSignals.find((signal) => signal.mode === "human-action-required");
      expect(unresolvedSignal).toBeDefined();
      if (!unresolvedSignal) throw new Error("fixture did not produce an unresolved semantic change");
      const acceptedChange = {
        changeSetId: "changeset.hook-adapters-adoption-major",
        eventId: "architecture_event.hook-adapters-adoption-major",
        reasonCodes: unresolvedSignal.reasonCodes,
        affectedNodeIds: unresolvedSignal.affectedNodeIds
      } satisfies AcceptedArchitectureChangeReferenceV1;
      const acceptedArgs = [
        "--profile", "repo-harness/v1",
        "--accepted-change-set-id", acceptedChange.changeSetId,
        "--accepted-event-id", acceptedChange.eventId,
        ...acceptedChange.reasonCodes.flatMap((reason) => ["--major-reason", reason]),
        ...acceptedChange.affectedNodeIds.flatMap((nodeId) => ["--affected-node", nodeId])
      ];
      const preview = await runTestCli("docs", ["adopt", ...acceptedArgs], root);
      expect(preview.ok, JSON.stringify(preview)).toBe(true);
      expect((preview.data as any).allowed).toBe(true);

      const request: ProjectionRequestV1 = {
        schemaVersion: "archcontext.projection-request/v1",
        requestId: "projection_request.hook_adapters_adopt_accepted",
        profile: "repo-harness/v1",
        mode: "adopt",
        targets: ["architecture-docs"],
        changedPaths,
        expected,
        adoptionPlanId: (preview.data as any).adoptionPlanId,
        acceptedChange
      };
      const daemon = await createStartedDaemon({
        localStorePath: testRuntimePaths(root).localStorePath,
        codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
        codeGraphProviderFactory: () => new MockCodeGraphProvider()
      });
      try {
        const adopted = await runCli("projection", ["run", "--request-json", JSON.stringify(request)], root, { runtimeClient: daemon });
        expect(adopted.ok, JSON.stringify(adopted)).toBe(true);
        expect(adopted.data as ProjectionResultV3).toMatchObject({
          status: "applied",
          refreshSignals: [{ mode: "refresh-required", acceptedChange }]
        });
        expect(projectionResultInvariantIssues(adopted.data as ProjectionResultV3)).toEqual([]);
        const adoptedBody = readFileSync(join(root, modulePath), "utf8");
        expect(adoptedBody).toStartWith("# runtime-harness/hook-adapters\n<!-- BEGIN ARCHCONTEXT:generated");
        expect(adoptedBody).toEndWith("## 3. P3 Decisions\nhuman decision  \n\n## 4. History\nhuman history\n");
      } finally {
        await daemon.stop();
      }

      const next = await runTestCli("docs", ["plan", "--profile", "repo-harness/v1"], root);
      expect(next.ok, JSON.stringify(next)).toBe(true);
      expect((next.data as any).drift.ok).toBe(true);
      expect((next.data as any).majorChange.mode).toBe("none");
    } finally {
      removeTempRoot(root);
    }
  }, PROJECTION_CODEGRAPH_TEST_TIMEOUT_MS);

  test.each(["present", "missing"])("an accepted projection apply with no concurrent mutation delivers refresh signals on the first pass (generated %s)", async (generatedState) => {
    const { root, protocolRequest, acceptedChange } = await runAdoptedHookAdaptersScenario({ codeGraphReady: true });
    const daemon = await createStartedDaemon({
      localStorePath: testRuntimePaths(root).localStorePath,
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider()
    });
    const originalWrite = process.stderr.write.bind(process.stderr);
    let stderrOutput = "";
    (process.stderr as { write: unknown }).write = (chunk: unknown) => {
      stderrOutput += String(chunk);
      return true;
    };
    try {
      const generatedPath = join(root, ".archcontext/generated/ARCHITECTURE.md");
      if (generatedState === "missing") nodeRmSync(generatedPath);
      const applyRequest: ProjectionRequestV1 = {
        ...protocolRequest,
        expected: { ...protocolRequest.expected, worktreeDigest: architectureDocumentationProjectionWorktreeDigest(root, loadNativeModelFromArchContext(root), listGitVisibleFiles(root)) as `sha256:${string}` },
        requestId: "projection_request.hook_adapters_major_apply_clean",
        mode: "apply",
        acceptedChange
      };
      const currentPlan = await runCli("projection", ["run", "--request-json", JSON.stringify({ ...applyRequest, mode: "plan" })], root, { runtimeClient: daemon });
      expect(currentPlan.ok, JSON.stringify(currentPlan)).toBe(true);
      const applied = await runCli("projection", ["run", "--request-json", JSON.stringify(applyRequest)], root, { runtimeClient: daemon });
      expect(applied.ok, JSON.stringify(applied)).toBe(true);
      expect(existsSync(generatedPath)).toBe(generatedState === "present");
      expect(architectureDocumentationProjectionWorktreeDigest(root, loadNativeModelFromArchContext(root), listGitVisibleFiles(root))).toBe(applyRequest.expected.worktreeDigest);
      expect((applied.data as ProjectionResultV3)).toMatchObject({
        status: "applied",
        refreshSignals: [{ signalId: (currentPlan.data as ProjectionResultV3).refreshSignals[0]!.signalId, acceptedChange }]
      });
    } finally {
      (process.stderr as { write: unknown }).write = originalWrite;
      await daemon.stop();
      removeTempRoot(root);
    }
    expect(stderrOutput).not.toContain("projection post-apply verification failed");
    expect(stderrOutput).not.toContain("accepted-reference-without-semantic-delta");
    expect(stderrOutput).not.toContain("projection post-apply worktree digest diverged");
  }, PROJECTION_CODEGRAPH_TEST_TIMEOUT_MS);

  test("projection apply ignores concurrent .ai/harness runtime churn", async () => {
    const { root, protocolRequest, acceptedChange, signalPlan } = await runAdoptedHookAdaptersScenario({ codeGraphReady: true });
    const daemon = await createStartedDaemon({
      localStorePath: testRuntimePaths(root).localStorePath,
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider()
    });
    try {
      let injected = false;
      const planUpdate = daemon.planUpdate.bind(daemon);
      daemon.planUpdate = async (...args) => {
        const planned = await planUpdate(...args);
        if (planned.ok && !injected) {
          injected = true;
          const runtimeEvidence = join(root, ".ai/harness/runs/live-projection.json");
          mkdirSync(dirname(runtimeEvidence), { recursive: true });
          writeFileSync(runtimeEvidence, "{\"status\":\"running\"}\n", "utf8");
        }
        return planned;
      };
      const request: ProjectionRequestV1 = {
        ...protocolRequest,
        requestId: "projection_request.runtime_churn",
        mode: "apply",
        acceptedChange
      };
      const applied = await runCli("projection", ["run", "--request-json", JSON.stringify(request)], root, { runtimeClient: daemon });
      expect(injected).toBe(true);
      expect(applied.ok, JSON.stringify(applied)).toBe(true);
      expect(applied.data as ProjectionResultV3).toMatchObject({
        status: "applied",
        refreshSignals: [{ signalId: (signalPlan.data as any).refreshSignals[0].signalId, acceptedChange }]
      });
    } finally {
      await daemon.stop().catch(() => undefined);
      removeTempRoot(root);
    }
  }, PROJECTION_CODEGRAPH_TEST_TIMEOUT_MS);

  test("projection apply rejects concurrent authority-input mutation without writing", async () => {
    const { root, protocolRequest, acceptedChange } = await runAdoptedHookAdaptersScenario({ codeGraphReady: true });
    const daemon = await createStartedDaemon({
      localStorePath: testRuntimePaths(root).localStorePath,
      codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
      codeGraphProviderFactory: () => new MockCodeGraphProvider()
    });
    const manifestPath = join(root, "docs/architecture/.projection-manifest.json");
    const manifestBefore = readFileSync(manifestPath, "utf8");
    try {
      let injected = false;
      const planUpdate = daemon.planUpdate.bind(daemon);
      daemon.planUpdate = async (...args) => {
        const planned = await planUpdate(...args);
        if (planned.ok && !injected) {
          injected = true;
          writeFileSync(join(root, "README.md"), "# concurrent authority input mutation\n", "utf8");
        }
        return planned;
      };
      const request: ProjectionRequestV1 = {
        ...protocolRequest,
        requestId: "projection_request.authority_race",
        mode: "apply",
        acceptedChange
      };
      const stale = await runCli("projection", ["run", "--request-json", JSON.stringify(request)], root, { runtimeClient: daemon });
      expect(injected).toBe(true);
      expect(stale.ok).toBe(false);
      expect(JSON.stringify(stale)).toContain("Worktree digest changed before apply");
      expect(readFileSync(manifestPath, "utf8")).toBe(manifestBefore);
    } finally {
      await daemon.stop().catch(() => undefined);
      removeTempRoot(root);
    }
  }, PROJECTION_CODEGRAPH_TEST_TIMEOUT_MS);

  test("CLI process exit code reflects the final envelope ok value", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-exitcode-"));
    try {
      writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");

      const failing = await runCliProcessRaw(root, "context");
      const failingBody = JSON.parse(failing.stdout);
      expect(failingBody.ok).toBe(false);
      expect(failingBody.error?.code).toBe("AC_SCHEMA_INVALID");
      expect(failing.code).not.toBe(0);

      const succeeding = await runCliProcessRaw(root, "help");
      const succeedingBody = JSON.parse(succeeding.stdout);
      expect(succeedingBody.ok).toBe(true);
      expect(succeeding.code).toBe(0);
    } finally {
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("archctx resolve rejects missing and empty models without runtime access (#370)", async () => {
    const root = gitTempRoot("archctx-cli-resolve-missing-");
    const deps = new Proxy({}, { get: () => { throw new Error("resolve accessed a runtime dependency"); } });
    try {
      writeFileSync(join(root, "paths.txt"), "src/app.ts\n", "utf8");
      for (const empty of [false, true]) {
        if (empty) {
          initializeArchContextModel(root, "Empty Model");
          rmSync(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"));
        }
        for (const args of [["--path", "src/app.ts"], ["--paths-from", "paths.txt"]]) {
          const result = await runCli("resolve", args, root, deps);
          expect(result).toMatchObject({ ok: false, error: { code: "AC_MODEL_ADOPTION_REQUIRED", retryable: false } });
          expect(resolveCommandExitCode(result)).toBe(1);
        }
      }
      expect(existsSync(testStateRoot(root))).toBe(false);
    } finally {
      removeTempRoot(root);
    }
  });

  test("archctx resolve rejects invalid nodes even when another node owns the path (#370)", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-resolve-invalid-"));
    try {
      writeResolveFixtureModel(root);
      writeFileSync(join(root, "paths.txt"), "packages/app/index.ts\n", "utf8");
      const path = join(root, ".archcontext/model/nodes/capability.shared-a.yaml");
      const body = readFileSync(path, "utf8");
      const node = { schemaVersion: "archcontext.node/v2", id: "module.invalid", kind: "module", name: "Invalid", status: "active", summary: "Fixture." };
      for (const invalid of [
        body.replace(/^summary:.*\n/m, ""),
        `${body}summary: duplicate\n`,
        `${body}invalid line\n`,
        JSON.stringify({ ...node, status: "unknown" }),
        JSON.stringify({ ...node, id: 42 }),
        "null"
      ]) {
        writeFileSync(path, invalid, "utf8");
        for (const args of [["--path", "packages/app/index.ts"], ["--paths-from", "paths.txt"]]) {
          const result = await runCliProcessRaw(root, "resolve", ...args, "--json");
          expect(result.code).toBe(1);
          expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID", retryable: false } });
        }
      }
      expect(existsSync(testStateRoot(root))).toBe(false);
      expect(existsSync(join(root, ".codegraph"))).toBe(false);
    } finally {
      removeTempRoot(root);
    }
  }, CLI_PROCESS_TIMEOUT_MS);

  test("archctx resolve reports a node directory as unreadable (#370)", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-resolve-unreadable-"));
    try {
      writeResolveFixtureModel(root);
      writeFileSync(join(root, "paths.txt"), "packages/app/index.ts\n", "utf8");
      mkdirSync(join(root, ".archcontext/model/nodes/x.yaml"));
      for (const args of [["--path", "packages/app/index.ts"], ["--paths-from", "paths.txt"]]) {
        const result = await runCliProcessRaw(root, "resolve", ...args, "--json");
        expect(result.code).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({
          ok: false,
          error: { code: "AC_PRECONDITION_FAILED", reasonCode: "native-context-input-unreadable", retryable: false, details: { category: "open-or-read" } }
        });
      }
      expect(existsSync(testStateRoot(root))).toBe(false);
    } finally {
      removeTempRoot(root);
    }
  }, CLI_PROCESS_TIMEOUT_MS);

  test("archctx validate exits nonzero for schema and YAML errors (#370)", async () => {
    const root = createInitializedGitRepo();
    const path = join(root, ".archcontext/model/nodes/capability.architecture.context.yaml");
    const body = readFileSync(path, "utf8");
    try {
      const valid = await runCliProcessRaw(root, "validate", "--json");
      expect(valid.code).toBe(0);
      expect(JSON.parse(valid.stdout)).toMatchObject({ ok: true, data: { valid: true, errors: [] } });
      for (const invalid of [body.replace(/^summary:.*\n/m, ""), `${body}summary: duplicate\n`, `${body}invalid line\n`]) {
        writeFileSync(path, invalid, "utf8");
        const result = await runCliProcessRaw(root, "validate", "--json");
        expect(result.code).toBe(1);
        const envelope = JSON.parse(result.stdout);
        expect(envelope.data.valid).toBe(false);
        expect(envelope.data.errors.length).toBeGreaterThan(0);
      }
    } finally {
      removeTempRoot(root);
    }
  }, DAEMON_TEST_TIMEOUT_MS);

  test("archctx resolve --path matches the most specific declared capability (ADR-0043)", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-resolve-"));
    try {
      writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
      initializeArchContextModel(root, "CLI Resolve App");
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.projection-engine.yaml"),
        stableYaml({
          schemaVersion: "archcontext.node/v2",
          id: "capability.projection-engine",
          kind: "capability",
          name: "Projection Engine",
          status: "active",
          summary: "Renders architecture and agent-context projections.",
          source: { include: ["packages/core/projection-engine/**"] },
          extensions: { lspProfile: "typescript-lsp", verification: ["bun test"] }
        }),
        "utf8"
      );

      const matched = await runTestCli("resolve", ["--path", "packages/core/projection-engine/src/index.ts"], root);
      expect(matched.ok).toBe(true);
      expect((matched.data as any).matched).toBe(true);
      expect((matched.data as any).stableId).toBe("capability.projection-engine");
      expect((matched.data as any).source.include).toEqual(["packages/core/projection-engine/**"]);
      expect((matched.data as any).extensions.lspProfile).toBe("typescript-lsp");
      expect(resolveCommandExitCode(matched)).toBe(0);

      const noMatch = await runTestCli("resolve", ["--path", "docs/unrelated.md"], root);
      expect((noMatch.data as any).matched).toBe(false);
      expect((noMatch.data as any).ambiguous).toBe(false);
      expect(resolveCommandExitCode(noMatch)).toBe(1);

      const missingPath = await runTestCli("resolve", [], root);
      expect(missingPath.ok).toBe(false);
      expect((missingPath as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect(resolveCommandExitCode(missingPath)).toBe(1);
    } finally {
      removeTempRoot(root);
    }
  });

  test("archctx resolve --path rejects equal-specificity ownership as ambiguous", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-resolve-ambiguous-"));
    try {
      writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
      initializeArchContextModel(root, "CLI Resolve Ambiguous App");
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.shared-a.yaml"),
        stableYaml({
          schemaVersion: "archcontext.node/v2",
          id: "capability.shared-a",
          kind: "capability",
          name: "Shared A",
          status: "active",
          summary: "First capability declaring the shared package.",
          source: { include: ["packages/shared/**"] }
        }),
        "utf8"
      );
      writeFileSync(
        join(root, ".archcontext/model/nodes/capability.shared-b.yaml"),
        stableYaml({
          schemaVersion: "archcontext.node/v2",
          id: "capability.shared-b",
          kind: "capability",
          name: "Shared B",
          status: "active",
          summary: "Second capability declaring the same shared package.",
          source: { include: ["packages/shared/**"] }
        }),
        "utf8"
      );

      const ambiguous = await runTestCli("resolve", ["--path", "packages/shared/utils.ts"], root);
      expect(ambiguous.ok).toBe(true);
      expect((ambiguous.data as any).matched).toBe(false);
      expect((ambiguous.data as any).ambiguous).toBe(true);
      expect((ambiguous.data as any).candidates.sort()).toEqual(["capability.shared-a", "capability.shared-b"]);
      expect(resolveCommandExitCode(ambiguous)).toBe(2);
    } finally {
      removeTempRoot(root);
    }
  });

  test("archctx resolve --path gives a file to the component that shares its capability's literal prefix (#296)", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-resolve-chain-"));
    try {
      writeResolveFixtureModel(root);

      const matched = await runTestCli("resolve", ["--path", "packages/app/src/api/handler.ts"], root);
      expect(matched.ok).toBe(true);
      expect(matched.data).toEqual({
        path: "packages/app/src/api/handler.ts",
        matched: true,
        ambiguous: false,
        stableId: "component.app.api",
        kind: "component",
        name: "App API",
        owningCapabilityId: "capability.app",
        source: { include: ["packages/app/**/api/**"] }
      });
      expect(resolveCommandExitCode(matched)).toBe(0);

      const capability = await runTestCli("resolve", ["--path", "packages/app/index.ts"], root);
      expect((capability.data as any).stableId).toBe("capability.app");
      expect((capability.data as any).owningCapabilityId).toBe("capability.app");

      const noMatch = await runTestCli("resolve", ["--path", "docs/unrelated.md"], root);
      expect(noMatch.data).toEqual({ path: "docs/unrelated.md", matched: false, ambiguous: false, owningCapabilityId: null });
    } finally {
      removeTempRoot(root);
    }
  });

  test("archctx resolve --paths-from <file> returns one result per path in input order", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-resolve-batch-"));
    try {
      writeResolveFixtureModel(root);
      writeFileSync(
        join(root, "paths.txt"),
        "packages/shared/utils.ts\r\n\n  packages/app/src/api/handler.ts  \n\ndocs/unrelated.md\npackages/app/index.ts",
        "utf8"
      );

      const batch = await runTestCli("resolve", ["--paths-from", "paths.txt"], root);
      expect(batch.ok).toBe(true);
      const results = (batch.data as any).results;
      expect(results.map((result: any) => result.path)).toEqual([
        "packages/shared/utils.ts",
        "packages/app/src/api/handler.ts",
        "docs/unrelated.md",
        "packages/app/index.ts"
      ]);
      expect(results[0]).toEqual({
        path: "packages/shared/utils.ts",
        matched: false,
        ambiguous: true,
        candidates: ["capability.shared-a", "capability.shared-b"],
        owningCapabilityId: null
      });
      expect(results[1]).toEqual((await runTestCli("resolve", ["--path", "packages/app/src/api/handler.ts"], root)).data);
      expect(results[2]).toEqual({ path: "docs/unrelated.md", matched: false, ambiguous: false, owningCapabilityId: null });
      expect(results[3].stableId).toBe("capability.app");
      expect(resolveCommandExitCode(batch)).toBe(2);

      writeFileSync(join(root, "owned.txt"), "packages/app/index.ts\ndocs/unrelated.md\n", "utf8");
      const unambiguous = await runTestCli("resolve", ["--paths-from", "owned.txt"], root);
      expect((unambiguous.data as any).results).toHaveLength(2);
      expect(resolveCommandExitCode(unambiguous)).toBe(0);

      writeFileSync(join(root, "empty.txt"), "\n\n", "utf8");
      const empty = await runTestCli("resolve", ["--paths-from", "empty.txt"], root);
      expect(empty.data).toEqual({ results: [] });
      expect(resolveCommandExitCode(empty)).toBe(0);

      writeFileSync(join(root, "invalid.txt"), "packages/app/index.ts\n../outside.ts\n", "utf8");
      const invalid = await runTestCli("resolve", ["--paths-from", "invalid.txt"], root);
      expect(invalid.ok).toBe(false);
      expect((invalid as any).error.code).toBe("AC_SCHEMA_INVALID");
      expect((invalid as any).error.message).toContain("line 2");
      expect(resolveCommandExitCode(invalid)).toBe(1);

      const both = await runTestCli("resolve", ["--path", "packages/app/index.ts", "--paths-from", "owned.txt"], root);
      expect(both.ok).toBe(false);
      expect((both as any).error.code).toBe("AC_SCHEMA_INVALID");

      const missing = await runTestCli("resolve", ["--paths-from", "absent.txt"], root);
      expect(missing.ok).toBe(false);
      expect((missing as any).error.code).toBe("AC_SCHEMA_INVALID");

      const help = await runTestCli("resolve", ["--help"], root);
      expect(help.ok).toBe(true);
      expect((help.data as any).exitCodes).toContain("--paths-from");
    } finally {
      removeTempRoot(root);
    }
  });

  test("archctx resolve --paths-from - reads paths from stdin in the real process and sets the exit code", async () => {
    const root = mkdtempSync(join(tmpdir(), "archctx-cli-resolve-stdin-"));
    try {
      writeResolveFixtureModel(root);
      const run = async (input: string) => {
        const child = spawn(process.execPath, [CLI_ENTRY, "resolve", "--paths-from", "-"], {
          cwd: root,
          env: testStateEnv(root),
          stdio: ["pipe", "pipe", "pipe"]
        });
        const result = collectProcess(child);
        child.stdin.end(input);
        return result;
      };

      const owned = await run("packages/app/src/api/handler.ts\n\ndocs/unrelated.md\n");
      expect(owned.code).toBe(0);
      const ownedBody = JSON.parse(owned.stdout);
      expect(ownedBody.data.results.map((result: any) => [result.path, result.stableId ?? null, result.owningCapabilityId])).toEqual([
        ["packages/app/src/api/handler.ts", "component.app.api", "capability.app"],
        ["docs/unrelated.md", null, null]
      ]);

      const contested = await run("docs/unrelated.md\npackages/shared/utils.ts\n");
      expect(contested.code).toBe(2);
      expect(JSON.parse(contested.stdout).data.results[1].ambiguous).toBe(true);
    } finally {
      removeTempRoot(root);
    }
  }, CLI_PROCESS_TIMEOUT_MS);
});

/**
 * `capability.app` declares `packages/app/**`; its component `component.app.api` declares
 * `packages/app/**\/api/**`, which has the same literal prefix. Two unrelated capabilities declare
 * the same `packages/shared/**` glob, so a shared path stays ambiguous across chains.
 */
function writeResolveFixtureModel(root: string): void {
  writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
  initializeArchContextModel(root, "CLI Resolve Chain App");
  const nodes: { id: string; name: string; [field: string]: string | { include: string[] } }[] = [
    { id: "capability.app", kind: "capability", name: "App", source: { include: ["packages/app/**"] } },
    { id: "component.app.api", kind: "component", name: "App API", parent: "capability.app", source: { include: ["packages/app/**/api/**"] } },
    { id: "capability.shared-a", kind: "capability", name: "Shared A", source: { include: ["packages/shared/**"] } },
    { id: "capability.shared-b", kind: "capability", name: "Shared B", source: { include: ["packages/shared/**"] } }
  ];
  for (const node of nodes) {
    writeFileSync(
      join(root, `.archcontext/model/nodes/${node.id}.yaml`),
      stableYaml({ schemaVersion: "archcontext.node/v2", status: "active", summary: `${node.name} fixture node.`, ...node }),
      "utf8"
    );
  }
}

async function runCliProcess(root: string, ...args: string[]): Promise<any> {
  const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
    cwd: root,
    env: testStateEnv(root)
  });
  const { stdout, stderr, code } = await collectProcess(child);
  if (code !== 0) throw new Error(`archctx ${args.join(" ")} failed (${code}): ${stderr || stdout}`);
  return JSON.parse(stdout);
}

async function runCliProcessRaw(root: string, ...args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
    cwd: root,
    env: testStateEnv(root)
  });
  return collectProcess(child);
}

function collectCliSourceText(dir: string): string {
  const parts: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) parts.push(collectCliSourceText(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".ts")) parts.push(readFileSync(fullPath, "utf8").replace(/\r\n/g, "\n"));
  }
  return `${parts.join("\n")}\n`;
}

/** The source of one top-level function across CLI modules, up to its closing brace at column 0. */
function functionBody(source: string, name: string): string {
  const start = source.search(new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`function ${name} not found`);
  const end = source.indexOf("\n}\n", start);
  if (end < 0) throw new Error(`function ${name} has no closing brace at column 0`);
  return source.slice(start, end + 2);
}

/** `if (subcommand === "a" || subcommand === "b") { ... }` (or a one-line return) blocks, by brace matching. */
function subcommandBlocks(text: string): Array<[string[], string]> {
  const blocks: Array<[string[], string]> = [];
  for (const match of text.matchAll(/if \(((?:subcommand === "[a-z-]+"(?: \|\| )?)+)\)\s*(\{|return)/g)) {
    const names = [...match[1]!.matchAll(/"([a-z-]+)"/g)].map((name) => name[1]!);
    let end = text.indexOf("\n", match.index!);
    if (match[2] === "{") {
      let depth = 0;
      for (let index = text.indexOf("{", match.index!); index < text.length; index += 1) {
        if (text[index] === "{") depth += 1;
        else if (text[index] === "}" && (depth -= 1) === 0) { end = index + 1; break; }
      }
    }
    blocks.push([names, text.slice(match.index!, end)]);
  }
  return blocks;
}

function collectProcess(child: ChildProcessWithoutNullStreams): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out waiting for process: ${stderr || stdout}`));
    }, CLI_PROCESS_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, code });
    });
  });
}

test("CLI state-machines check reads the model without runtime state and refuses other arguments (#510)", async () => {
  const root = gitTempRoot("archctx-cli-state-machines-");
  try {
    initializeArchContextModel(root, "State Machines");
    const result = await runTestCli("state-machines", ["check", "--json"], root);
    expect(result).toMatchObject({ ok: true, requestId: "state-machines.check", data: { schemaVersion: "archcontext.state-machine-check/v1", machines: [] } });
    expect(existsSync(testStateRoot(root))).toBe(false);
    writeFileSync(join(root, ".archcontext/model/nodes/capability.jobs.yaml"), stableYaml({ schemaVersion: "archcontext.node/v2", id: "capability.jobs", kind: "capability", name: "Jobs", status: "active", summary: "Runs jobs." }));
    mkdirSync(join(root, ".archcontext/model/state-machines"), { recursive: true });
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/job.ts"), "export function finish(): void {}\r\n");
    // Without the symbol reader a symbol-only anchor is unchecked, and its file is never read.
    writeFileSync(join(root, "src/locked.ts"), "export function lock(): void {}\n");
    if (process.platform !== "win32") chmodSync(join(root, "src/locked.ts"), 0o000);
    writeFileSync(join(root, ".archcontext/model/state-machines/job.yaml"), stableYaml({
      schemaVersion: "archcontext.state-machine/v1", id: "state-machine.jobs.job", capabilityId: "capability.jobs", name: "Job",
      regions: [{ id: "job", label: "Job", initial: "queued", states: [{ id: "queued", label: "Queued" }, { id: "done", label: "Done", terminal: true }], source: { kind: "code", path: "src/job.ts" } }],
      events: [{ id: "finish", label: "Finish", source: { kind: "code", path: "src/job.ts", symbol: "finish" }, steps: [{ when: { job: ["queued"] }, then: { job: "done" } }] },
        { id: "drop", label: "Drop", source: { kind: "code", path: "src/gone.ts" }, steps: [{ when: { job: ["queued"] }, then: { job: "done" } }] },
        { id: "lock", label: "Lock", source: { kind: "code", path: "src/locked.ts", symbol: "lock" }, steps: [{ when: { job: ["queued"] }, then: { job: "done" } }] }],
      rules: []
    }));
    // SM-S23: every anchor with its status; the file digest reads CRLF as LF; no index leaves the symbol unchecked.
    const anchored = await runTestCli("state-machines", ["check", "--json"], root);
    expect((anchored.data as any).machines[0].anchors).toEqual([
      { owner: "region", ownerId: "job", path: "src/job.ts", status: "anchor-unconfirmed", digest: `sha256:${createHash("sha256").update("export function finish(): void {}\n").digest("hex")}` },
      { owner: "event", ownerId: "finish", path: "src/job.ts", symbol: "finish", status: "unchecked", reason: "index-missing" },
      { owner: "event", ownerId: "drop", path: "src/gone.ts", status: "anchor-missing-path" },
      { owner: "event", ownerId: "lock", path: "src/locked.ts", symbol: "lock", status: "unchecked", reason: "index-missing" }
    ]);
    for (const args of [["check", "--all"], ["list"], []]) {
      expect(await runTestCli("state-machines", args, root)).toMatchObject({ ok: false, requestId: "state-machines.check", error: { code: "AC_SCHEMA_INVALID", reasonCode: "cli-input-invalid" } });
    }
  } finally {
    removeTempRoot(root);
  }
});

test("CLI state-machines check lists the machines by id, each with its own anchors", async () => {
  const root = gitTempRoot("archctx-cli-state-machines-order-");
  try {
    initializeArchContextModel(root, "State Machines");
    writeFileSync(join(root, ".archcontext/model/nodes/capability.jobs.yaml"), stableYaml({ schemaVersion: "archcontext.node/v2", id: "capability.jobs", kind: "capability", name: "Jobs", status: "active", summary: "Runs jobs." }));
    mkdirSync(join(root, ".archcontext/model/state-machines"), { recursive: true });
    // The file name order is the reverse of the id order.
    for (const [file, name] of [["a.yaml", "zeta"], ["b.yaml", "alpha"]]) {
      writeFileSync(join(root, ".archcontext/model/state-machines", file), stableYaml({
        schemaVersion: "archcontext.state-machine/v1", id: `state-machine.jobs.${name}`, capabilityId: "capability.jobs", name: "Job",
        regions: [{ id: "job", label: "Job", initial: "queued", states: [{ id: "queued", label: "Queued" }, { id: "done", label: "Done", terminal: true }], source: { kind: "code", path: `src/${name}.ts` } }],
        events: [{ id: "finish", label: "Finish", source: { kind: "environment" }, steps: [{ when: { job: ["queued"] }, then: { job: "done" } }] }],
        rules: []
      }));
    }
    const result = await runTestCli("state-machines", ["check", "--json"], root);
    expect((result.data as any).machines.map((machine: any) => [machine.id, machine.anchors.map((anchor: any) => anchor.path)]))
      .toEqual([["state-machine.jobs.alpha", ["src/alpha.ts"]], ["state-machine.jobs.zeta", ["src/zeta.ts"]]]);
  } finally {
    removeTempRoot(root);
  }
});
