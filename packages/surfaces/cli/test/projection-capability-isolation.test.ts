import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { canonicalRepositoryRoot, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { architectureDocumentationProjectionWorktreeDigest, loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { CodeGraphAdapter, codeGraphCliInvocation } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { digestJson, projectionResultInvariantIssues, stableYaml, validateJsonSchema, type ProjectionRequestV1, type ProjectionResultV2 } from "@archcontext/contracts";
import { runCli } from "../src/main";

/**
 * #327 finding 3, Phase 1 isolation end to end, on a real CodeGraph index: a source edit makes one
 * capability's P2 flow unprovable without touching the model, while another capability's sources
 * move. `projection run` plans and applies the second capability and carries the first forward.
 */

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../../..");
const RESULT_SCHEMA = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "schemas/runtime/projection-result.schema.json"), "utf8"));
const TEST_TIMEOUT_MS = process.platform === "win32" ? 300_000 : 180_000;
const RENDERER = "capability.flows.renderer";
const CATALOG = "capability.flows.catalog";
const RENDERER_DOC = "docs/architecture/modules/flows/renderer.md";
const CATALOG_DOC = "docs/architecture/modules/flows/catalog.md";
const MANIFEST = "docs/architecture/.projection-manifest.json";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commitAll(root: string, message: string): void {
  git(root, "add", "-A");
  git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-q", "-m", message);
}

function write(root: string, path: string, body: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body, "utf8");
}

function writeYaml(root: string, path: string, value: Parameters<typeof stableYaml>[0]): void {
  write(root, path, stableYaml(value));
}

const DIRECT_CALL = "import { renderBlock } from \"./render\";\n\nexport function handle(): string {\n  return renderBlock();\n}\n";
// The selector's only evidence is a reference by value, so P2 becomes unprovable; the model is untouched.
const REFERENCE_ONLY = "import { renderBlock } from \"./render\";\n\nfunction run(step: () => string): string {\n  return step();\n}\n\nexport function handle(): string {\n  return run(renderBlock);\n}\n";

function seedFixture(root: string): void {
  write(root, "README.md", "# capability isolation fixture\n");
  initializeArchContextModel(root, "Capability Isolation App");
  rmSync(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"), { force: true });
  write(root, "src/renderer/render.ts", "export function renderBlock(): string {\n  return \"block\";\n}\n");
  write(root, "src/renderer/main.ts", DIRECT_CALL);
  write(root, "src/catalog/list.ts", "export const entries: string[] = [];\n");
  const contractFiles = (slug: string) => ({ contractFiles: { agents: `packages/${slug}/AGENTS.md`, claude: `packages/${slug}/CLAUDE.md` } });
  writeYaml(root, `.archcontext/model/nodes/${RENDERER}.yaml`, {
    schemaVersion: "archcontext.node/v2",
    id: RENDERER,
    kind: "capability",
    name: "Renderer",
    status: "active",
    summary: "Renders one block.",
    source: {
      include: ["src/renderer/**"],
      entrypoints: [{
        id: "entrypoint.renderer.main",
        path: "src/renderer/main.ts",
        symbols: [{ name: "handle", sinks: [{ id: "sink.renderer.render", path: "src/renderer/render.ts", symbol: "renderBlock" }] }]
      }]
    },
    extensions: contractFiles("renderer")
  });
  for (const [id, name] of [["component.renderer.handler", "Handler"], ["component.renderer.output", "Output"]] as const) {
    writeYaml(root, `.archcontext/model/nodes/${id}.yaml`, { schemaVersion: "archcontext.node/v2", id, kind: "component", name, status: "active", parent: RENDERER, summary: `${name} of the renderer.` });
  }
  writeYaml(root, ".archcontext/model/relations/relation.renderer.handler-output.yaml", {
    schemaVersion: "archcontext.relation/v1", id: "relation.renderer.handler-output", kind: "calls", source: "component.renderer.handler", target: "component.renderer.output", intent: "Render one block"
  });
  const step = (id: string) => ({ id, from: "handler", to: "output", label: `Step ${id}`, evidence: { entrypointId: "entrypoint.renderer.main", sourceSymbol: "handle", sinkId: "sink.renderer.render" } });
  writeYaml(root, ".archcontext/model/flows/flow.renderer.render.yaml", {
    schemaVersion: "archcontext.flow/v1",
    id: "flow.renderer.render",
    capabilityId: RENDERER,
    name: "Render through the handler",
    applicability: "required",
    participants: [{ id: "handler", nodeId: "component.renderer.handler" }, { id: "output", nodeId: "component.renderer.output" }],
    steps: [step("render")],
    outcomes: [
      { id: "rendered", kind: "success", label: "Rendered", steps: [step("rendered")], terminal: { participant: "handler", label: "Return the block" } },
      { id: "failed", kind: "error", label: "Failed", steps: [step("failed")], terminal: { participant: "handler", label: "Return the failure" } }
    ]
  });
  writeYaml(root, `.archcontext/model/nodes/${CATALOG}.yaml`, {
    schemaVersion: "archcontext.node/v2", id: CATALOG, kind: "capability", name: "Catalog", status: "active", summary: "Lists entries.",
    source: { include: ["src/catalog/**"] }, extensions: contractFiles("catalog")
  });
  writeYaml(root, ".archcontext/model/relations/relation.catalog-journal.yaml", {
    schemaVersion: "archcontext.relation/v1", id: "relation.catalog-journal", kind: "writes", source: CATALOG, target: CATALOG, intent: "Persist catalog entries"
  });
  writeYaml(root, ".archcontext/model/flows/flow.catalog.yaml", {
    schemaVersion: "archcontext.flow/v1", id: "flow.catalog", capabilityId: CATALOG, name: "Catalog flow", applicability: "not-applicable", rationale: "A static list."
  });
  git(root, "init", "-q");
  git(root, "config", "core.autocrlf", "false");
  commitAll(root, "capability isolation fixture");
  const invocation = codeGraphCliInvocation("codegraph", root);
  execFileSync(invocation.command, [...invocation.argsPrefix, "init", root], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function expectedSnapshot(root: string): ProjectionRequestV1["expected"] {
  return {
    repositoryId: repositoryFingerprint(root),
    workspaceId: `workspace.${digestJson({ root: canonicalRepositoryRoot(root) } as any).replace(/^sha256:/, "").slice(0, 16)}`,
    headSha: git(root, "rev-parse", "HEAD"),
    worktreeDigest: architectureDocumentationProjectionWorktreeDigest(root, loadNativeModelFromArchContext(root), listGitVisibleFiles(root)) as `sha256:${string}`
  };
}

function docsSnapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const absolute = join(directory, entry);
      if (statSync(absolute).isDirectory()) walk(absolute);
      else files[relative(root, absolute).split(sep).join("/")] = readFileSync(absolute, "utf8");
    }
  };
  walk(join(root, "docs/architecture"));
  return files;
}

function projectionResult(envelope: { ok: boolean; data?: unknown }): ProjectionResultV2 {
  expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
  const result = envelope.data as unknown as ProjectionResultV2;
  expect(projectionResultInvariantIssues(result)).toEqual([]);
  expect(validateJsonSchema(RESULT_SCHEMA, result as any).issues).toEqual([]);
  return result;
}

/** The lines of the manifest one target row or one baseline capability entry owns, without line endings. */
function ownedLines(manifest: string, key: "row" | "capability", id: string): string[] {
  const lines = manifest.split(/\r?\n/);
  if (key === "row") {
    const index = lines.indexOf(`    ${JSON.stringify(entityTargetId(manifest, id))}:`);
    if (index < 0) throw new Error(`manifest has no row for ${id}`);
    return lines.slice(index, index + 2);
  }
  const index = lines.indexOf(`        "capabilityId": ${JSON.stringify(id)},`);
  if (index < 0) throw new Error(`manifest has no baseline entry for ${id}`);
  const end = lines.findIndex((line, at) => at > index && /^ {6}\},?$/.test(line));
  return lines.slice(index - 1, end + 1);
}

function entityTargetId(manifest: string, nodeId: string): string {
  const entry = Object.entries(JSON.parse(manifest).targets as Record<string, { scope: { id?: string } }>).find(([, row]) => row.scope.id === nodeId);
  if (!entry) throw new Error(`manifest has no target for ${nodeId}`);
  return entry[0];
}

type StartedDaemon = Awaited<ReturnType<typeof createStartedDaemon>>;

/**
 * The daemon runs in this process, and so does the CodeGraph index it opens to read selector
 * evidence. Under Bun, closing that index leaves the database, WAL and shared-memory files open
 * until its prepared statements are collected, and Windows refuses to delete a directory that
 * still holds open files. The daemon is stopped and a full collection releases those handles
 * before the fixture is removed; a removal that still fails is a real leak and fails the test.
 */
async function stopDaemonAndRemoveFixture(daemon: StartedDaemon, paths: string[]): Promise<void> {
  await daemon.stop();
  Bun.gc(true);
  for (const path of paths) rmSync(path, { recursive: true, force: true });
}

/** Runs `drift` once, after the render and the ChangeSet plan, immediately before the daemon applies it. */
function driftBeforeApply(daemon: StartedDaemon, drift: () => void): { drifted: boolean } {
  const host = daemon as unknown as Record<"applyUpdate", (...args: unknown[]) => Promise<unknown>>;
  const apply = host.applyUpdate.bind(daemon);
  const state = { drifted: false };
  host.applyUpdate = async (...args: unknown[]) => {
    if (!state.drifted) {
      state.drifted = true;
      drift();
    }
    return apply(...args);
  };
  return state;
}

interface IsolationFixture {
  root: string;
  daemon: StartedDaemon;
  cli: (command: string, args: string[]) => ReturnType<typeof runCli>;
  request: (mode: ProjectionRequestV1["mode"], requestId: string, extra?: Partial<ProjectionRequestV1>) => ProjectionRequestV1;
  run: (value: unknown) => ReturnType<typeof runCli>;
}

/** A fixture whose baseline projection is applied and committed, with CRLF line endings when asked. */
async function withIsolationFixture(prefix: string, crlf: boolean, scenario: (fixture: IsolationFixture) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const stateRoot = join(dirname(root), `.archctx-state-${basename(root)}`);
  const daemon = await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
  const cli = (command: string, args: string[]) => runCli(command, args, root, { runtimeClient: daemon });
  const request = (mode: ProjectionRequestV1["mode"], requestId: string, extra: Partial<ProjectionRequestV1> = {}): ProjectionRequestV1 => ({
    schemaVersion: "archcontext.projection-request/v1",
    requestId,
    profile: "repo-harness/v1",
    mode,
    targets: ["architecture-docs"],
    changedPaths: [],
    expected: expectedSnapshot(root),
    ...extra
  });
  const run = (value: unknown) => cli("projection", ["run", "--request-json", JSON.stringify(value)]);
  try {
    seedFixture(root);
    const baseline = await cli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"]);
    expect(baseline.ok, JSON.stringify(baseline)).toBe(true);
    if (crlf) {
      // A `core.autocrlf` checkout: every projected file is committed and read back with CRLF.
      for (const [path, body] of Object.entries(docsSnapshot(root))) writeFileSync(join(root, path), body.replaceAll("\n", "\r\n"), "utf8");
    }
    commitAll(root, "project architecture documentation");
    await scenario({ root, daemon, cli, request, run });
  } finally {
    await stopDaemonAndRemoveFixture(daemon, [stateRoot, root]);
  }
}

/** The renderer's flow loses its call evidence and the catalog's sources move; no model edit. */
function blockRendererAndMoveCatalog(root: string): void {
  write(root, "src/renderer/main.ts", REFERENCE_ONLY);
  write(root, "src/catalog/list.ts", "export const entries: string[] = [\"first\"];\n");
}

async function isolationScenario(prefix: string, crlf: boolean): Promise<void> {
  await withIsolationFixture(prefix, crlf, async ({ root, cli, request, run }) => {
    const committed = docsSnapshot(root);
    const baseManifest = committed[MANIFEST]!;
    expect(JSON.parse(baseManifest).semanticBaseline.capabilities.map((entry: any) => [entry.capabilityId, entry.proofStatus.p2])).toEqual([[CATALOG, "not-applicable"], [RENDERER, "proven"]]);
    expect(projectionResult(await run(request("check", "projection_request.isolation_baseline"))).status).toBe("noop");

    blockRendererAndMoveCatalog(root);
    const stale = request("apply", "projection_request.isolation_stale");

    for (const mode of ["check", "plan"] as const) {
      const planned = projectionResult(await run(request(mode, `projection_request.isolation_${mode}`)));
      expect(planned.status, mode).toBe("planned-partial");
      expect(planned.coverage).toMatchObject({
        complete: false,
        blockedCapabilityIds: [RENDERER],
        blockedTargets: [{ path: RENDERER_DOC, capabilityIds: [RENDERER], reasonCodes: ["unprovable-required-flow", "verified-flow-proof-changed"] }]
      });
      expect(planned.coverage!.blockedTargets.map((target) => target.targetId)).toEqual([entityTargetId(baseManifest, RENDERER)]);
      expect(planned.coverage!.appliedTargetIds).toContain(entityTargetId(baseManifest, CATALOG));
      expect(planned.coverage!.appliedTargetIds).not.toContain(entityTargetId(baseManifest, RENDERER));
      expect(planned.files.map((file) => file.path)).toEqual([MANIFEST]);
      expect(planned.humanActions).toEqual([]);
      expect(planned.refreshSignals).toEqual([]);
    }
    expect(docsSnapshot(root)).toEqual(committed);

    // A global failure still blocks everything: a stale expected snapshot writes nothing.
    write(root, "src/catalog/extra.ts", "export const extra = 1;\n");
    const refused = await run(stale);
    expect(refused.ok).toBe(false);
    expect((refused as any).error?.code).toBe("AC_PRECONDITION_FAILED");
    expect(docsSnapshot(root)).toEqual(committed);
    rmSync(join(root, "src/catalog/extra.ts"));

    // The apply writes the catalog's stamp and carries the renderer forward, byte for byte. The
    // flag cannot accept an unprovable proof; the run still applies the rest, without a receipt.
    const applied = projectionResult(await run(request("apply", "projection_request.isolation_apply", { acceptObservedMajorChange: true })));
    expect(applied.status).toBe("applied-partial");
    expect(applied.coverage!.blockedTargets.map((target) => target.path)).toEqual([RENDERER_DOC]);
    expect(applied.applyReceipt).toBeUndefined();
    expect(applied.majorChangeAcceptance).toBeUndefined();
    expect(applied.files.map((file) => file.path)).toEqual([MANIFEST]);
    const after = docsSnapshot(root);
    expect(after[RENDERER_DOC]).toBe(committed[RENDERER_DOC]!);
    expect(after[CATALOG_DOC]).toBe(committed[CATALOG_DOC]!);
    const manifest = after[MANIFEST]!;
    expect(manifest).not.toBe(baseManifest);
    expect(manifest.includes("\r\n")).toBe(crlf);
    if (crlf) expect(manifest.replaceAll("\r\n", "")).not.toContain("\n");
    expect(ownedLines(manifest, "row", RENDERER)).toEqual(ownedLines(baseManifest, "row", RENDERER));
    expect(ownedLines(manifest, "capability", RENDERER)).toEqual(ownedLines(baseManifest, "capability", RENDERER));
    expect(ownedLines(manifest, "row", CATALOG)).not.toEqual(ownedLines(baseManifest, "row", CATALOG));
    expect(ownedLines(manifest, "capability", CATALOG)).toEqual(ownedLines(baseManifest, "capability", CATALOG));

    // Partial is never acceptance: with nothing else to write, every surface still asks a human.
    const blocked = projectionResult(await run(request("check", "projection_request.isolation_after")));
    expect(blocked.status).toBe("human-action-required");
    expect(blocked.humanActions.map((action) => action.reasonCode)).toEqual(["unresolved-major-change"]);
    expect(blocked.coverage).toBeUndefined();
    const drift = await cli("docs", ["drift", "--profile", "repo-harness/v1"]);
    expect(drift.ok, JSON.stringify(drift)).toBe(true);
    expect((drift.data as any).ok).toBe(false);
    const again = projectionResult(await run(request("apply", "projection_request.isolation_apply_again")));
    expect(again.status).toBe("human-action-required");
    expect(docsSnapshot(root)).toEqual(after);

    // Restoring the call restores the carried-forward baseline: the projection is a clean fixed point.
    write(root, "src/renderer/main.ts", DIRECT_CALL);
    expect(projectionResult(await run(request("check", "projection_request.isolation_restored"))).status).toBe("noop");
  });
}

test("an unprovable capability blocks only its own targets; the rest is applied without a receipt (#327)", async () => {
  await isolationScenario("archctx-isolation-", false);
}, TEST_TIMEOUT_MS);

test("a CRLF checkout carries the blocked document forward byte for byte and keeps CRLF on the written manifest (#327)", async () => {
  await isolationScenario("archctx-isolation-crlf-", true);
}, TEST_TIMEOUT_MS);

// The request's worktree digest leaves projection-owned outputs out, so the carried-forward
// document is bound only by the apply itself: a change after the render refuses the whole apply.
test.each(["edited", "deleted"] as const)("a partial apply refuses a carried-forward document %s after the render and writes nothing (#327)", async (drift) => {
  await withIsolationFixture(`archctx-isolation-carried-${drift}-`, false, async ({ root, daemon, request, run }) => {
    const committed = docsSnapshot(root);
    blockRendererAndMoveCatalog(root);
    const rendererPath = join(root, RENDERER_DOC);
    const edited = `${committed[RENDERER_DOC]!}\nHuman renderer notes.\n`;
    const hook = driftBeforeApply(daemon, () => {
      if (drift === "edited") writeFileSync(rendererPath, edited, "utf8");
      else rmSync(rendererPath);
    });

    const refused = await run(request("apply", `projection_request.isolation_carried_${drift}`));
    expect(hook.drifted).toBe(true);
    expect(refused.ok, JSON.stringify(refused)).toBe(false);
    expect((refused as any).error).toMatchObject({ code: "AC_PRECONDITION_FAILED" });
    expect((refused as any).error).toMatchObject({ reasonCode: "apply-preimage-changed", action: "rebuild-plan", details: { issueCount: 1 } });
    const expected = { ...committed };
    if (drift === "edited") expected[RENDERER_DOC] = edited;
    else delete expected[RENDERER_DOC];
    expect(docsSnapshot(root)).toEqual(expected);

    // With the document back as rendered, the same partial apply goes through.
    writeFileSync(rendererPath, committed[RENDERER_DOC]!, "utf8");
    const applied = projectionResult(await run(request("apply", `projection_request.isolation_carried_${drift}_restored`)));
    expect(applied.status).toBe("applied-partial");
    expect(applied.files.map((file) => file.path)).toEqual([MANIFEST]);
    expect(docsSnapshot(root)[RENDERER_DOC]).toBe(committed[RENDERER_DOC]!);
  });
}, TEST_TIMEOUT_MS);

// A whole-file output the layout no longer renders: a committed manifest row and the intact file.
const LEGACY_TARGET_ID = "projection_target.diagram.legacy";
const LEGACY_PATH = "docs/architecture/diagrams/legacy.mmd";
const LEGACY_BODY = "flowchart LR\n  legacy_a --> legacy_b\n";

function seedWholeFileOrphan(root: string): void {
  const manifest = JSON.parse(readFileSync(join(root, MANIFEST), "utf8"));
  // The row is self-contained: repo-harness/v1 records no Mermaid diagram of its own.
  manifest.targets[LEGACY_TARGET_ID] = {
    type: "diagram-mermaid",
    scope: { kind: "diagram", id: "architecture" },
    path: LEGACY_PATH,
    ownership: "generated",
    format: "mermaid",
    outputDigest: digestJson({ targetId: LEGACY_TARGET_ID, body: LEGACY_BODY } as any)
  };
  writeFileSync(join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  write(root, LEGACY_PATH, LEGACY_BODY);
  commitAll(root, "a whole-file output the layout no longer renders");
}

// An orphan is a path no current target renders, and a carried-forward document is a current
// target's path, so the orphan delete and the carried-file guard never name the same path; the
// ChangeSet refuses a guard on a path any write or delete of the same apply touches (#327).
test("a partial apply deletes an intact whole-file orphan beside the carried-forward document (#327)", async () => {
  await withIsolationFixture("archctx-isolation-orphan-", false, async ({ root, request, run }) => {
    seedWholeFileOrphan(root);
    const committed = docsSnapshot(root);
    blockRendererAndMoveCatalog(root);

    const planned = projectionResult(await run(request("plan", "projection_request.isolation_orphan_plan")));
    expect(planned.status).toBe("planned-partial");
    expect(planned.coverage!.blockedTargets.map((target) => target.path)).toEqual([RENDERER_DOC]);
    const expectedFiles = [
      { path: MANIFEST, action: "update" as const },
      { path: LEGACY_PATH, action: "delete" as const }
    ];
    expect(planned.files.map(({ path, action }) => ({ path, action }))).toEqual(expectedFiles);

    const applied = projectionResult(await run(request("apply", "projection_request.isolation_orphan_apply")));
    expect(applied.status).toBe("applied-partial");
    expect(applied.files.map(({ path, action }) => ({ path, action }))).toEqual(expectedFiles);
    const after = docsSnapshot(root);
    expect(after[LEGACY_PATH]).toBeUndefined();
    expect(Object.values(JSON.parse(after[MANIFEST]!).targets).map((row: any) => row.path)).not.toContain(LEGACY_PATH);
    expect(after[RENDERER_DOC]).toBe(committed[RENDERER_DOC]!);
  });
}, TEST_TIMEOUT_MS);
