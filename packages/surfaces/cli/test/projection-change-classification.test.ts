import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import { digestJson, projectionResultInvariantIssues, stableYaml, validateJsonSchema, type ProjectionRequestV1, type ProjectionResultV2, type ProjectionTargetChangeV1 } from "@archcontext/contracts";
import { runCli } from "../src/main";

/**
 * #327 finding 2 end to end, on a real CodeGraph index: `projection run` `check` and `plan` classify
 * every target (stamp-only, output, semantic, proof, blocked, baseline-missing), and the targets
 * whose `plannedAction` is not `none` are exactly the documents the result's `files[]` and the
 * following apply write. The projection manifest is never a change target.
 */

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../../..");
const RESULT_SCHEMA = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "schemas/runtime/projection-result.schema.json"), "utf8"));
const TEST_TIMEOUT_MS = process.platform === "win32" ? 300_000 : 180_000;
const RENDERER = "capability.flows.renderer";
const CATALOG = "capability.flows.catalog";
const GAMMA = "capability.flows.gamma";
const RENDERER_DOC = "docs/architecture/modules/flows/renderer.md";
const CATALOG_DOC = "docs/architecture/modules/flows/catalog.md";
const GAMMA_DOC = "docs/architecture/modules/flows/gamma.md";
const INDEX_DOC = "docs/architecture/index.md";
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

const contractFiles = (slug: string) => ({ contractFiles: { agents: `packages/${slug}/AGENTS.md`, claude: `packages/${slug}/CLAUDE.md` } });

/** A capability without a sequence flow: a self relation proves P1 and a not-applicable flow settles P2. */
function writeStaticCapability(root: string, id: string, name: string, slug: string, include: string, extra: Record<string, unknown> = {}): void {
  writeYaml(root, `.archcontext/model/nodes/${id}.yaml`, {
    schemaVersion: "archcontext.node/v2", id, kind: "capability", name, status: "active", summary: `${name} capability.`,
    source: { include: [include] }, extensions: contractFiles(slug), ...extra
  } as Parameters<typeof stableYaml>[0]);
  writeYaml(root, `.archcontext/model/relations/relation.${slug}-journal.yaml`, {
    schemaVersion: "archcontext.relation/v1", id: `relation.${slug}-journal`, kind: "writes", source: id, target: id, intent: `Persist ${slug} entries`
  });
  writeYaml(root, `.archcontext/model/flows/flow.${slug}.yaml`, {
    schemaVersion: "archcontext.flow/v1", id: `flow.${slug}`, capabilityId: id, name: `${name} flow`, applicability: "not-applicable", rationale: "A static list."
  });
}

function removeStaticCapability(root: string, id: string, slug: string): void {
  for (const path of [`nodes/${id}.yaml`, `relations/relation.${slug}-journal.yaml`, `flows/flow.${slug}.yaml`]) rmSync(join(root, ".archcontext/model", path));
}

function seedFixture(root: string): void {
  write(root, "README.md", "# change classification fixture\n");
  initializeArchContextModel(root, "Change Classification App");
  rmSync(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"), { force: true });
  write(root, "src/renderer/render.ts", "export function renderBlock(): string {\n  return \"block\";\n}\n");
  write(root, "src/renderer/main.ts", DIRECT_CALL);
  write(root, "src/catalog/list.ts", "export const entries: string[] = [];\n");
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
  writeStaticCapability(root, CATALOG, "Catalog", "catalog", "src/catalog/**");
  git(root, "init", "-q");
  git(root, "config", "core.autocrlf", "false");
  commitAll(root, "change classification fixture");
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

/** The paths whose bytes differ between two snapshots, the manifest excluded. */
function writtenDocs(before: Record<string, string>, after: Record<string, string>): string[] {
  return Object.keys({ ...before, ...after }).filter((path) => path !== MANIFEST && before[path] !== after[path]).sort();
}

function manifestRowPaths(root: string): string[] {
  return (Object.values(JSON.parse(readFileSync(join(root, MANIFEST), "utf8")).targets) as Array<{ path: string }>).map((row) => row.path).sort();
}

/**
 * A schema-valid result whose changes satisfy the S4 invariant: the targets with a planned action
 * are exactly the result's files[] without the projection manifest, with the same action.
 */
function projectionResult(envelope: { ok: boolean; data?: unknown }): ProjectionResultV2 {
  expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
  const result = envelope.data as unknown as ProjectionResultV2;
  expect(projectionResultInvariantIssues(result)).toEqual([]);
  expect(validateJsonSchema(RESULT_SCHEMA, result as any).issues).toEqual([]);
  expect(Array.isArray(result.changes), "check and plan results carry changes[]").toBe(true);
  expect(plannedActions(result)).toEqual(fileActions(result));
  expect(result.changes!.map((entry) => entry.path)).not.toContain(MANIFEST);
  return result;
}

/** `path action` of every change with a planned action. */
function plannedActions(result: ProjectionResultV2): string[] {
  return result.changes!.filter((entry) => entry.plannedAction !== "none").map((entry) => `${entry.path} ${entry.plannedAction}`);
}

/** `path action` of every files[] entry but the projection manifest. */
function fileActions(result: ProjectionResultV2): string[] {
  return result.files.filter((file) => file.path !== MANIFEST).map((file) => `${file.path} ${file.action}`);
}

function byPath(result: ProjectionResultV2): Map<string, ProjectionTargetChangeV1> {
  return new Map(result.changes!.map((entry) => [entry.path, entry]));
}

function classifications(result: ProjectionResultV2): Record<string, string> {
  return Object.fromEntries(result.changes!.map((entry) => [entry.path, `${entry.classification}/${entry.plannedAction}`]));
}

/** Every change classified `unchanged` except the listed paths. */
function expectOnly(result: ProjectionResultV2, expected: Record<string, string>): void {
  const actual = classifications(result);
  for (const [path, value] of Object.entries(actual)) expect(`${path} ${value}`).toBe(`${path} ${expected[path] ?? "unchanged/none"}`);
  for (const path of Object.keys(expected)) expect(actual[path], path).toBeDefined();
}

type StartedDaemon = Awaited<ReturnType<typeof createStartedDaemon>>;

async function stopDaemonAndRemoveFixture(daemon: StartedDaemon, paths: string[]): Promise<void> {
  await daemon.stop();
  Bun.gc(true);
  for (const path of paths) rmSync(path, { recursive: true, force: true });
}

interface Fixture {
  root: string;
  cli: (command: string, args: string[]) => ReturnType<typeof runCli>;
  request: (mode: ProjectionRequestV1["mode"], requestId: string, extra?: Partial<ProjectionRequestV1>) => ProjectionRequestV1;
  run: (value: unknown) => Promise<ProjectionResultV2>;
  runRaw: (value: unknown) => ReturnType<typeof runCli>;
}

/** A fixture whose baseline projection is applied and committed, with CRLF line endings when asked. */
async function withFixture(prefix: string, crlf: boolean, scenario: (fixture: Fixture) => Promise<void>): Promise<void> {
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
  const runRaw = (value: unknown) => cli("projection", ["run", "--request-json", JSON.stringify(value)]);
  const run = async (value: unknown) => {
    const envelope = await runRaw(value);
    expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
    return envelope.data as unknown as ProjectionResultV2;
  };
  try {
    seedFixture(root);
    const baseline = await cli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"]);
    expect(baseline.ok, JSON.stringify(baseline)).toBe(true);
    if (crlf) {
      // A `core.autocrlf` checkout: every projected file is committed and read back with CRLF.
      for (const [path, body] of Object.entries(docsSnapshot(root))) writeFileSync(join(root, path), body.replaceAll("\n", "\r\n"), "utf8");
    }
    commitAll(root, "project architecture documentation");
    await scenario({ root, cli, request, run, runRaw });
  } finally {
    await stopDaemonAndRemoveFixture(daemon, [stateRoot, root]);
  }
}

/** `check` and `plan` on the same tree: both results, which must report the same changes. */
async function checkAndPlan(fixture: Fixture, label: string): Promise<ProjectionResultV2> {
  const checked = projectionResult(await fixture.runRaw(fixture.request("check", `projection_request.${label}_check`)));
  const planned = projectionResult(await fixture.runRaw(fixture.request("plan", `projection_request.${label}_plan`)));
  expect(planned.changes).toEqual(checked.changes);
  expect(planned.status).toBe(checked.status);
  return checked;
}

/** A source-only edit: the catalog stamp moves, no rendered byte does. */
async function sourceOnlyScenario(fixture: Fixture, crlf: boolean): Promise<void> {
  const { root } = fixture;
  const baseline = await checkAndPlan(fixture, "baseline");
  expect(baseline.status).toBe("noop");
  expect(baseline.files).toEqual([]);
  // The changes cover every current target: one per committed row, all unchanged.
  expect(baseline.changes!.map((entry) => entry.path)).toEqual(manifestRowPaths(root));
  expectOnly(baseline, {});

  write(root, "src/catalog/list.ts", "export const entries: string[] = [\"first\"];\n");
  const checked = await checkAndPlan(fixture, "source_only");
  expect(checked.status).toBe("planned");
  expect(checked.files.map((file) => file.path)).toEqual([MANIFEST]);
  expectOnly(checked, { [CATALOG_DOC]: "stamp-only/none" });
  expect(byPath(checked).get(CATALOG_DOC)).toMatchObject({
    affectedCapabilityIds: [CATALOG], stampChanged: true, outputChanged: false, semanticChanged: false, proofChanged: false, reasonCodes: ["source-stamp-changed"]
  });

  const before = docsSnapshot(root);
  const applied = await fixture.run(fixture.request("apply", "projection_request.source_only_apply"));
  expect(applied.status).toBe("applied");
  expect(applied.changes).toBeUndefined();
  const after = docsSnapshot(root);
  expect(writtenDocs(before, after)).toEqual([]);
  expect(after[MANIFEST]).not.toBe(before[MANIFEST]);
  expect(after[MANIFEST]!.includes("\r\n")).toBe(crlf);
  expectOnly(await checkAndPlan(fixture, "source_only_after"), {});
  commitAll(root, "catalog source edit");
}

test("check and plan classify a source-only edit as stamp-only, then output, semantic, proof and baseline cases (#327)", async () => {
  await withFixture("archctx-classification-", false, async (fixture) => {
    const { root } = fixture;
    await sourceOnlyScenario(fixture, false);

    // Output change: a second catalog file moves the printed scale buckets and the stamp.
    write(root, "src/catalog/more.ts", `${Array.from({ length: 12 }, (_, index) => `export const entry${index} = ${index};`).join("\n")}\n`);
    const output = await checkAndPlan(fixture, "output");
    expect(output.status).toBe("planned");
    expectOnly(output, { [CATALOG_DOC]: "output-change/update" });
    expect(byPath(output).get(CATALOG_DOC)).toMatchObject({ affectedCapabilityIds: [CATALOG], reasonCodes: ["rendered-output-changed", "source-stamp-changed"] });
    const beforeOutput = docsSnapshot(root);
    expect((await fixture.run(fixture.request("apply", "projection_request.output_apply"))).status).toBe("applied");
    expect(writtenDocs(beforeOutput, docsSnapshot(root))).toEqual([CATALOG_DOC]);
    commitAll(root, "catalog grows");

    // Semantic change whose rendered bytes are unchanged: criticality is in no document.
    writeStaticCapability(root, CATALOG, "Catalog", "catalog", "src/catalog/**", { criticality: "high" });
    const semantic = await checkAndPlan(fixture, "semantic");
    expect(semantic.status).toBe("human-action-required");
    expect(semantic.files.map((file) => file.path)).toEqual([MANIFEST]);
    const semanticChanges = byPath(semantic);
    expect(semanticChanges.get(CATALOG_DOC)).toMatchObject({
      classification: "semantic-change", plannedAction: "none", semanticChanged: true, outputChanged: false, stampChanged: false, proofChanged: false, affectedCapabilityIds: [CATALOG], reasonCodes: ["semantic-fingerprint-changed"]
    });
    // Repository-wide targets describe the whole model: the same semantic change, nothing to write.
    for (const entry of semantic.changes!) {
      if (entry.path === RENDERER_DOC) expect(entry.classification).toBe("unchanged");
      else expect(`${entry.path} ${entry.classification}/${entry.plannedAction}`).toBe(`${entry.path} semantic-change/none`);
    }
    git(root, "checkout", "--", ".archcontext");

    // Without a committed manifest nothing can be compared: baseline-missing, never unchanged.
    rmSync(join(root, MANIFEST));
    const missing = await checkAndPlan(fixture, "baseline_missing");
    expect(missing.status).toBe("planned");
    expect(missing.files.map(({ path, action }) => ({ path, action }))).toEqual([{ path: MANIFEST, action: "create" }]);
    expect(missing.changes!.length).toBeGreaterThan(0);
    for (const entry of missing.changes!) {
      expect(entry).toMatchObject({ classification: "baseline-missing", plannedAction: "none", stampChanged: null, semanticChanged: null, proofChanged: null, reasonCodes: ["baseline-missing"] });
    }
    git(root, "checkout", "--", MANIFEST);

    // A committed manifest without a row for one target: that target alone is baseline-missing.
    const manifest = JSON.parse(readFileSync(join(root, MANIFEST), "utf8"));
    delete manifest.targets["projection_target.architecture.index"];
    writeFileSync(join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const rowMissing = await checkAndPlan(fixture, "row_missing");
    expect(rowMissing.files.map((file) => file.path)).toEqual([MANIFEST]);
    expectOnly(rowMissing, { [INDEX_DOC]: "baseline-missing/none" });
    expect(byPath(rowMissing).get(INDEX_DOC)).toMatchObject({ stampChanged: null, semanticChanged: false, proofChanged: false, reasonCodes: ["target-row-missing"] });
    git(root, "checkout", "--", MANIFEST);

    // A proof change without a semantic change: only the renderer's document, ahead of its stamp and output.
    write(root, "src/renderer/main.ts", REFERENCE_ONLY);
    const proof = await checkAndPlan(fixture, "proof");
    expect(proof.status).toBe("human-action-required");
    expectOnly(proof, { [RENDERER_DOC]: "proof-change/update" });
    expect(byPath(proof).get(RENDERER_DOC)).toMatchObject({
      affectedCapabilityIds: [RENDERER], stampChanged: true, outputChanged: true, semanticChanged: false, proofChanged: true,
      // The cited selector lost its call site, so its proof-relevant evidence moved with the proof.
      reasonCodes: ["flow-proof-changed", "rendered-output-changed", "selector-evidence-changed", "source-stamp-changed"]
    });
    write(root, "src/renderer/main.ts", DIRECT_CALL);
    expectOnly(await checkAndPlan(fixture, "proof_restored"), {});
  });
}, TEST_TIMEOUT_MS);

test("a CRLF checkout classifies a source-only edit as stamp-only and writes only the manifest (#327)", async () => {
  await withFixture("archctx-classification-crlf-", true, async (fixture) => {
    await sourceOnlyScenario(fixture, true);
  });
}, TEST_TIMEOUT_MS);

test("partial, added, removed and review-orphan targets are classified, and planned actions equal what apply writes (#327)", async () => {
  await withFixture("archctx-classification-targets-", false, async (fixture) => {
    const { root } = fixture;

    // Phase 1 isolation: the carried-forward renderer is blocked, the moved catalog is stamp-only.
    write(root, "src/renderer/main.ts", REFERENCE_ONLY);
    write(root, "src/catalog/list.ts", "export const entries: string[] = [\"first\"];\n");
    const partial = await checkAndPlan(fixture, "partial");
    expect(partial.status).toBe("planned-partial");
    expect(partial.files.map((file) => file.path)).toEqual([MANIFEST]);
    expectOnly(partial, { [RENDERER_DOC]: "blocked/none", [CATALOG_DOC]: "stamp-only/none" });
    const blocked = byPath(partial).get(RENDERER_DOC)!;
    expect(blocked).toMatchObject({ affectedCapabilityIds: [RENDERER], proofChanged: true, semanticChanged: false });
    expect(blocked.reasonCodes).toEqual(expect.arrayContaining(partial.coverage!.blockedTargets[0]!.reasonCodes));
    expect(partial.changes!.filter((entry) => entry.classification === "blocked").map((entry) => entry.path))
      .toEqual(partial.coverage!.blockedTargets.map((target) => target.path));
    const beforePartial = docsSnapshot(root);
    expect((await fixture.run(fixture.request("apply", "projection_request.partial_apply"))).status).toBe("applied-partial");
    expect(writtenDocs(beforePartial, docsSnapshot(root))).toEqual([]);
    write(root, "src/renderer/main.ts", DIRECT_CALL);
    expectOnly(await checkAndPlan(fixture, "partial_restored"), {});
    commitAll(root, "catalog source edit, renderer restored");

    // An added capability's document is created and a removed one's intact document is deleted.
    removeStaticCapability(root, CATALOG, "catalog");
    write(root, "src/gamma/list.ts", "export const gamma: string[] = [];\n");
    writeStaticCapability(root, GAMMA, "Gamma", "gamma", "src/gamma/**");
    const changed = await checkAndPlan(fixture, "add_remove");
    expect(changed.status).toBe("human-action-required");
    const changes = byPath(changed);
    expect(changes.get(GAMMA_DOC)).toMatchObject({ classification: "semantic-change", plannedAction: "create", affectedCapabilityIds: [GAMMA] });
    expect(changes.get(GAMMA_DOC)!.reasonCodes).toContain("target-added");
    expect(changes.get(CATALOG_DOC)).toMatchObject({ classification: "semantic-change", plannedAction: "delete", affectedCapabilityIds: [CATALOG] });
    expect(changes.get(CATALOG_DOC)!.reasonCodes).toContain("target-removed");
    expect(changes.get(RENDERER_DOC)!.classification).toBe("unchanged");
    expect(changes.get(INDEX_DOC)).toMatchObject({ classification: "semantic-change", plannedAction: "update", affectedCapabilityIds: [CATALOG, GAMMA] });
    const plannedPaths = changed.changes!.filter((entry) => entry.plannedAction !== "none").map((entry) => entry.path);
    expect(plannedPaths).toContain(GAMMA_DOC);
    expect(plannedPaths).toContain(CATALOG_DOC);
    // The planned actions are exactly the documents the accepting apply writes or deletes.
    const beforeAccept = docsSnapshot(root);
    const accepted = await fixture.run(fixture.request("apply", "projection_request.add_remove_apply", { acceptObservedMajorChange: true }));
    expect(accepted.status).toBe("applied");
    expect(fileActions(accepted)).toEqual(plannedActions(changed));
    expect(writtenDocs(beforeAccept, docsSnapshot(root))).toEqual(plannedPaths);
    commitAll(root, "gamma replaces catalog");

    // A removed capability whose document carries human text is blocked, never deleted.
    removeStaticCapability(root, GAMMA, "gamma");
    appendFileSync(join(root, GAMMA_DOC), "\nHuman gamma notes.\n", "utf8");
    const review = await checkAndPlan(fixture, "orphan_review");
    expect(review.status).toBe("human-action-required");
    expect(review.humanActions.map((action) => [action.reasonCode, action.path])).toContainEqual(["orphaned-document-review", GAMMA_DOC]);
    expect(byPath(review).get(GAMMA_DOC)).toMatchObject({ classification: "blocked", plannedAction: "none" });
    expect(byPath(review).get(GAMMA_DOC)!.reasonCodes).toEqual(expect.arrayContaining(["orphan-review-required", "target-removed"]));
    expect(review.files.map((file) => file.path)).not.toContain(GAMMA_DOC);
  });
}, TEST_TIMEOUT_MS);
