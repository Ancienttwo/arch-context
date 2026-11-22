import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { canonicalRepositoryRoot, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { architectureDocumentationProjectionWorktreeDigest, loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider, declareOptionalCodeFacts } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { PROJECTION_FILE_PREVIEW_MAX_BYTES, architectureRefreshSignalInvariantIssues, digestJson, projectionResultInvariantIssues, stableYaml, validateJsonSchema, type ProjectionRequestV1, type ProjectionResultV3 } from "@archcontext/contracts";
import { runCli } from "../src/main";
import { preparedFixture } from "./prepared-fixture";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../../..");
const RESULT_SCHEMA = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "schemas/runtime/projection-result.schema.json"), "utf8"));
// Accepted applies re-prove the snapshot, which requires a ready CodeGraph index (`codegraph init`).
const TEST_TIMEOUT_MS = process.platform === "win32" ? 240_000 : 120_000;
const KEPT = "capability.runtime-harness.hook-adapters";
const REMOVED = "capability.runtime-harness.automation-budget";
const REMOVED_GENERATED = "capability.runtime-harness.legacy-queue";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commitAll(root: string, message: string): void {
  git(root, "add", "-A");
  git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-q", "-m", message);
}

function writeYaml(root: string, path: string, value: Parameters<typeof stableYaml>[0]): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), stableYaml(value), "utf8");
}

function capability(id: string, name: string, slug: string) {
  return {
    schemaVersion: "archcontext.node/v2",
    id,
    kind: "capability",
    name,
    status: "active",
    summary: `${name} capability.`,
    responsibilities: [`Own ${name.toLowerCase()}.`],
    extensions: { contractFiles: { agents: `packages/${slug}/AGENTS.md`, claude: `packages/${slug}/CLAUDE.md` } }
  };
}

function selfRelation(capabilityId: string, slug: string) {
  return {
    schemaVersion: "archcontext.relation/v1",
    id: `relation.${slug}-journal`,
    kind: "writes",
    source: capabilityId,
    target: capabilityId,
    intent: `Persist ${slug} events`
  };
}

function flow(capabilityId: string, slug: string) {
  return {
    schemaVersion: "archcontext.flow/v1",
    id: `flow.${slug}`,
    capabilityId,
    name: `${slug} flow`,
    applicability: "not-applicable",
    rationale: "The lifecycle fixture only validates projection transport."
  };
}

/** Three capabilities, each with its flow, committed on a fresh Git repository. */
function seedTwoCapabilityFixture(root: string): void {
  writeFileSync(join(root, "README.md"), "# projection lifecycle fixture\n", "utf8");
  initializeArchContextModel(root, "Projection Lifecycle App");
  rmSync(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"), { force: true });
  for (const [id, name, slug] of [[KEPT, "Hook Adapters", "hook-adapters"], [REMOVED, "Automation Budget", "automation-budget"], [REMOVED_GENERATED, "Legacy Queue", "legacy-queue"]] as const) {
    writeYaml(root, `.archcontext/model/nodes/${id}.yaml`, capability(id, name, slug));
    writeYaml(root, `.archcontext/model/relations/relation.${slug}-journal.yaml`, selfRelation(id, slug));
    writeYaml(root, `.archcontext/model/flows/flow.${slug}.yaml`, flow(id, slug));
  }
  git(root, "init", "-q");
  // Windows runners default to `core.autocrlf=true`, which would rewrite generated documents with
  // CRLF on `git checkout`; tests that revert outputs mean their committed bytes, so keep checkouts
  // byte-exact.
  git(root, "config", "core.autocrlf", "false");
  commitAll(root, "projection lifecycle fixture");
  execFileSync("codegraph", ["init", root], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * The seeded repository with its baseline projection applied and committed. The daemon that
 * applied it is discarded, so each case's daemon starts with an empty store.
 */
const baselineFixture = preparedFixture("archctx-projection-baseline-", async (root) => {
  seedTwoCapabilityFixture(root);
  const daemon = await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
  try {
    const baseline = await runCli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"], root, { runtimeClient: daemon });
    expect(baseline.ok, JSON.stringify(baseline)).toBe(true);
  } finally {
    await daemon.stop();
  }
  commitAll(root, "project architecture documentation");
});
afterAll(() => baselineFixture.dispose());

function removeCapability(root: string, id: string, slug: string): void {
  for (const path of [`nodes/${id}.yaml`, `relations/relation.${slug}-journal.yaml`, `flows/flow.${slug}.yaml`]) {
    rmSync(join(root, ".archcontext/model", path));
  }
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

function manifestTargetPath(root: string, scopeId: string): string {
  const manifest = JSON.parse(readFileSync(join(root, "docs/architecture/.projection-manifest.json"), "utf8"));
  const target = Object.values(manifest.targets as Record<string, any>).find((entry) => entry.type === "entity-summary" && entry.scope?.id === scopeId);
  if (!target) throw new Error(`fixture manifest has no target for ${scopeId}`);
  return target.path;
}

function projectionResult(envelope: { ok: boolean; data?: unknown }): ProjectionResultV3 {
  expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
  const result = envelope.data as unknown as ProjectionResultV3;
  expect(projectionResultInvariantIssues(result)).toEqual([]);
  expect(validateJsonSchema(RESULT_SCHEMA, result as any).issues).toEqual([]);
  return result;
}

test("check, plan and apply agree on orphaned module documents after a node is removed (#268)", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-projection-orphans-"));
  const stateRoot = join(dirname(root), `.archctx-state-${basename(root)}`);
  const daemon = await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
  const cli = (command: string, args: string[]) => runCli(command, args, root, { runtimeClient: daemon });
  const run = async (mode: ProjectionRequestV1["mode"], requestId: string, extra: Partial<ProjectionRequestV1> = {}) =>
    cli("projection", ["run", "--request-json", JSON.stringify({
      schemaVersion: "archcontext.projection-request/v1",
      requestId,
      profile: "repo-harness/v1",
      mode,
      targets: ["architecture-docs"],
      changedPaths: [],
      expected: expectedSnapshot(root),
      ...extra
    } satisfies ProjectionRequestV1)]);
  try {
    await baselineFixture.copyTo(root);
    const modulePath = manifestTargetPath(root, REMOVED);
    const generatedPath = manifestTargetPath(root, REMOVED_GENERATED);
    // One module document carries one line of human text in its §3 skeleton section; the other is
    // exactly as the renderer wrote it, skeleton included (#276).
    const section3 = "## 3. P3:設計決策與不變量\n";
    const moduleBody = readFileSync(join(root, modulePath), "utf8");
    expect(moduleBody).toContain(section3);
    writeFileSync(join(root, modulePath), moduleBody.replace(section3, `${section3}Human budget notes.\n`), "utf8");
    const generatedBody = readFileSync(join(root, generatedPath), "utf8");
    expect(generatedBody).toContain(section3);
    // Whole-document digests are part of the manifest, so the edits are restamped first.
    const restamped = await cli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"]);
    expect(restamped.ok, JSON.stringify(restamped)).toBe(true);
    const preRemoval = await cli("docs", ["drift", "--profile", "repo-harness/v1"]);
    expect(preRemoval.data, JSON.stringify(preRemoval)).toMatchObject({ ok: true });
    commitAll(root, "human notes and a generated-only document");

    // Remove both capabilities together with their relations and flows. Their contract files go
    // too: a contract region left behind is its own review orphan, covered by the ADR-0056 §9 test.
    removeCapability(root, REMOVED, "automation-budget");
    removeCapability(root, REMOVED_GENERATED, "legacy-queue");
    for (const slug of ["automation-budget", "legacy-queue"]) rmSync(join(root, "packages", slug), { recursive: true, force: true });

    const checked = projectionResult(await run("check", "projection_request.orphans_check"));
    const planned = projectionResult(await run("plan", "projection_request.orphans_plan"));
    for (const result of [checked, planned]) {
      expect(result.status).toBe("human-action-required");
      expect(result.humanActions.map((action) => [action.reasonCode, action.path])).toEqual([
        ["unresolved-major-change", undefined],
        ["orphaned-document-review", modulePath]
      ]);
      // The review orphan is never a file action; the generated-only orphan is a real delete.
      expect(result.files.find((file) => file.path === modulePath)).toBeUndefined();
      expect(result.files.find((file) => file.path === generatedPath)).toMatchObject({ action: "delete", outputDigest: null });
    }
    const signal = checked.refreshSignals.find((entry) => entry.mode === "human-action-required");
    if (!signal) throw new Error("removing a capability did not produce an unresolved major change");
    expect(signal.reasonCodes).toContain("node-removed");
    const acceptedChange = {
      changeSetId: "changeset.remove-automation-budget",
      eventId: "architecture_event.remove-automation-budget",
      reasonCodes: signal.reasonCodes,
      affectedNodeIds: signal.affectedNodeIds
    };

    // The accepted apply stops before writing anything: the orphan needs a human first.
    const docsBefore = docsSnapshot(root);
    const blocked = projectionResult(await run("apply", "projection_request.orphans_apply_blocked", { acceptedChange }));
    expect(blocked.status).toBe("human-action-required");
    expect(blocked.humanActions.map((action) => [action.reasonCode, action.path])).toEqual([["orphaned-document-review", modulePath]]);
    expect(blocked.files.find((file) => file.path === modulePath)).toBeUndefined();
    expect(blocked.applyReceipt).toBeUndefined();
    expect(docsSnapshot(root)).toEqual(docsBefore);

    // A human reviews and removes the module document; the same accepted apply then commits.
    rmSync(join(root, modulePath));
    const applied = projectionResult(await run("apply", "projection_request.orphans_apply", { acceptedChange }));
    expect(applied.status).toBe("applied");
    expect(applied.humanActions).toEqual([]);
    expect(applied.files.find((file) => file.path === generatedPath)).toMatchObject({ action: "delete", preimageDigest: digestJson({ path: generatedPath, body: generatedBody } as any), outputDigest: null });
    expect(existsSync(join(root, generatedPath))).toBe(false);
    expect(applied.refreshSignals).toHaveLength(1);
    expect(applied.refreshSignals[0]).toMatchObject({ mode: "refresh-required", acceptedChange });

    // The projection is a clean fixed point: check, plan and docs drift all agree.
    for (const mode of ["check", "plan"] as const) {
      const after = projectionResult(await run(mode, `projection_request.orphans_after_${mode}`));
      expect(after.status).toBe("noop");
      expect(after.files).toEqual([]);
      expect(after.humanActions).toEqual([]);
    }
    const drift = await cli("docs", ["drift", "--profile", "repo-harness/v1"]);
    expect(drift.ok, JSON.stringify(drift)).toBe(true);
    expect(drift.data).toMatchObject({ ok: true, majorChange: { mode: "none" } });
  } finally {
    await daemon.stop();
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}, TEST_TIMEOUT_MS);

async function withProtocolFixture(prefix: string, run: (context: {
  root: string;
  daemon: Awaited<ReturnType<typeof createStartedDaemon>>;
  localStore: TestLocalStore;
  cli: (command: string, args: string[]) => ReturnType<typeof runCli>;
  request: (mode: ProjectionRequestV1["mode"], requestId: string, extra?: Partial<ProjectionRequestV1>) => ProjectionRequestV1;
  projectionRun: (request: unknown) => ReturnType<typeof runCli>;
}) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const stateRoot = join(dirname(root), `.archctx-state-${basename(root)}`);
  const localStore = new TestLocalStore();
  const daemon = await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore
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
  const projectionRun = (value: unknown) => cli("projection", ["run", "--request-json", JSON.stringify(value)]);
  try {
    await baselineFixture.copyTo(root);
    await run({ root, daemon, localStore, cli, request, projectionRun });
  } finally {
    await daemon.stop();
    rmSync(stateRoot, { recursive: true, force: true });
    // This process holds no file under root after stop(); a transient Windows hold outside it is retried.
    rmSync(root, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
  }
}

/** A summary edit is a responsibility change: a major change that stops an unaccepted apply. */
function editKeptSummary(root: string): void {
  const nodePath = join(root, `.archcontext/model/nodes/${KEPT}.yaml`);
  writeFileSync(nodePath, readFileSync(nodePath, "utf8").replace("Hook Adapters capability.", "Hook Adapters route and validate events."), "utf8");
}

test("projection apply accepts the major change it observes in one request (#261)", async () => {
  await withProtocolFixture("archctx-projection-observed-", async ({ root, daemon, request, projectionRun }) => {
    editKeptSummary(root);

    // The flag is an apply/adopt-only request field, exclusive with a caller-supplied acceptedChange.
    for (const invalid of [
      request("check", "projection_request.observed_check", { acceptObservedMajorChange: true }),
      request("plan", "projection_request.observed_plan", { acceptObservedMajorChange: true }),
      { ...request("apply", "projection_request.observed_false"), acceptObservedMajorChange: false },
      request("apply", "projection_request.observed_both", {
        acceptObservedMajorChange: true,
        acceptedChange: { changeSetId: "changeset.x", eventId: "event.x", reasonCodes: ["responsibility-changed"], affectedNodeIds: [KEPT] }
      })
    ]) {
      const refused = await projectionRun(invalid);
      expect(refused.ok, JSON.stringify(invalid)).toBe(false);
      expect((refused as any).error?.code).toBe("AC_SCHEMA_INVALID");
    }

    // Without the flag the major change still stops the apply.
    const docsBefore = docsSnapshot(root);
    const stopped = projectionResult(await projectionRun(request("apply", "projection_request.observed_without_flag")));
    expect(stopped.status).toBe("human-action-required");
    expect(stopped.humanActions.map((action) => action.reasonCode)).toEqual(["unresolved-major-change"]);
    expect(docsSnapshot(root)).toEqual(docsBefore);
    const observedSignal = stopped.refreshSignals.find((signal) => signal.mode === "human-action-required")!;

    const applied = projectionResult(await projectionRun(request("apply", "projection_request.observed_apply", { acceptObservedMajorChange: true })));
    expect(applied.status).toBe("applied");
    expect(applied.refreshSignals).toHaveLength(1);
    const acceptedChange = applied.refreshSignals[0]!.acceptedChange!;
    expect(acceptedChange).toMatchObject({ reasonCodes: observedSignal.reasonCodes, affectedNodeIds: observedSignal.affectedNodeIds });
    expect(acceptedChange.changeSetId).toMatch(/^changeset\.observed-major-change-[a-f0-9]{16}$/);
    expect(acceptedChange.eventId).toMatch(/^projection_event\.observed_major_change\.[a-f0-9]{16}$/);
    expect(applied.refreshSignals[0]).toMatchObject({ mode: "refresh-required", cause: "accepted-semantic-delta", acceptedChange });

    // The observed change is now the baseline: the projection is a clean fixed point.
    const after = projectionResult(await projectionRun(request("check", "projection_request.observed_after")));
    expect(after.status).toBe("noop");
    // With nothing left to accept, the flag is a plain apply.
    expect(projectionResult(await projectionRun(request("apply", "projection_request.observed_noop", { acceptObservedMajorChange: true }))).status).toBe("noop");
  });
}, TEST_TIMEOUT_MS);

test("acceptObservedMajorChange is declined, not ignored, when a capability proof is unprovable (#275)", async () => {
  await withProtocolFixture("archctx-projection-declined-", async ({ root, request, projectionRun }) => {
    editKeptSummary(root);
    // A capability with no flow has an unprovable P2 proof, so no observed change can be accepted.
    rmSync(join(root, ".archcontext/model/flows/flow.automation-budget.yaml"));
    const docsBefore = docsSnapshot(root);

    // Without the flag the result is unchanged: an unresolved major change, no acceptance field.
    const withoutFlag = projectionResult(await projectionRun(request("apply", "projection_request.declined_without_flag")));
    expect(withoutFlag.status).toBe("human-action-required");
    expect(withoutFlag.humanActions.map((action) => action.reasonCode)).toEqual(["unresolved-major-change"]);
    expect(withoutFlag.majorChangeAcceptance).toBeUndefined();

    // With the flag, apply and adopt both say it was declined and name the unprovable capability.
    // The adoption plan is never reached: the declined change stops adopt before adoption runs.
    for (const declinedRequest of [
      request("apply", "projection_request.declined_apply", { acceptObservedMajorChange: true }),
      request("adopt", "projection_request.declined_adopt", { acceptObservedMajorChange: true, adoptionPlanId: "adoption_plan.not_reached" })
    ]) {
      const declined = projectionResult(await projectionRun(declinedRequest));
      expect(declined.status, declinedRequest.mode).toBe("human-action-required");
      expect(declined.majorChangeAcceptance).toBe("declined-unprovable-proof");
      expect(declined.humanActions.map((action) => [action.reasonCode, action.affectedNodeIds])).toEqual([["unprovable-required-flow", [REMOVED]]]);
      expect(declined.applyReceipt).toBeUndefined();
    }
    expect(docsSnapshot(root)).toEqual(docsBefore);
  });
}, TEST_TIMEOUT_MS);

test("a contract region left in a shared file by a removed designation stops the run for review (ADR-0056 §9)", async () => {
  await withProtocolFixture("archctx-projection-agent-orphan-", async ({ root, cli, request, projectionRun }) => {
    const shared = ["packages/hook-adapters/AGENTS.md", "packages/hook-adapters/CLAUDE.md"];
    const designate = (slug: string) => writeYaml(root, `.archcontext/model/nodes/${REMOVED}.yaml`, { ...capability(REMOVED, "Automation Budget", "automation-budget"), extensions: { contractFiles: { agents: `packages/${slug}/AGENTS.md`, claude: `packages/${slug}/CLAUDE.md` } } });
    const region = (nodeId: string) => new RegExp(`<!-- BEGIN ARCHCONTEXT AGENT CONTEXT id="${nodeId.replaceAll(".", "\\.")}"[\\s\\S]*?<!-- END ARCHCONTEXT AGENT CONTEXT id="${nodeId.replaceAll(".", "\\.")}" -->\\n`);
    // REMOVED moves into KEPT's contract files; a human removes the regions it left behind.
    designate("hook-adapters");
    for (const path of ["packages/automation-budget/AGENTS.md", "packages/automation-budget/CLAUDE.md"]) rmSync(join(root, path));
    const moved = await cli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"]);
    expect(moved.ok, JSON.stringify(moved)).toBe(true);
    for (const path of shared) expect(readFileSync(join(root, path), "utf8")).toMatch(region(REMOVED));
    commitAll(root, "two capabilities share one contract file");

    // The designation leaves the shared file while KEPT's own region there changes.
    designate("automation-budget");
    editKeptSummary(root);
    const before = Object.fromEntries(shared.map((path) => [path, readFileSync(join(root, path), "utf8")]));
    for (const mode of ["check", "plan", "apply"] as const) {
      const result = projectionResult(await projectionRun(request(mode, `projection_request.agent_orphan_${mode}`, mode === "apply" ? { acceptObservedMajorChange: true } : {})));
      expect(result.status).toBe("human-action-required");
      expect(result.humanActions.filter((action) => action.reasonCode === "orphaned-document-review").map((action) => action.path)).toEqual(shared);
      expect(result.files.filter((file) => shared.includes(file.path))).toEqual([]);
      expect(result.applyReceipt).toBeUndefined();
    }
    for (const path of shared) expect(readFileSync(join(root, path), "utf8")).toBe(before[path]);
    const refused = await cli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"]);
    expect((refused as any).error).toMatchObject({ reasonCode: "projection-orphan-review-required", details: { issueCount: 2 } });

    // Once a human removes the region, the apply writes KEPT's region and drops REMOVED's rows there.
    for (const path of shared) writeFileSync(join(root, path), before[path]!.replace(region(REMOVED), ""), "utf8");
    const applied = projectionResult(await projectionRun(request("apply", "projection_request.agent_orphan_applied", { acceptObservedMajorChange: true })));
    expect(applied.status).toBe("applied");
    const rows = Object.values(JSON.parse(readFileSync(join(root, "docs/architecture/.projection-manifest.json"), "utf8")).targets as Record<string, any>);
    expect(rows.filter((row) => shared.includes(row.path)).map((row) => row.scope.id)).toEqual([KEPT, KEPT]);
    for (const path of shared) expect(readFileSync(join(root, path), "utf8")).toContain("Hook Adapters route and validate events.");
  });
}, TEST_TIMEOUT_MS);

test("plan previews each file as a bounded body or unified diff and writes nothing (#264)", async () => {
  await withProtocolFixture("archctx-projection-preview-", async ({ root, daemon, request, projectionRun }) => {
    // A summary far larger than one preview bound turns the module document diff into a truncated one.
    const nodePath = join(root, `.archcontext/model/nodes/${KEPT}.yaml`);
    const summary = Array.from({ length: 3_000 }, (_, index) => `Hook adapters route event ${index} through the validated runtime boundary.`).join("\n");
    writeFileSync(nodePath, readFileSync(nodePath, "utf8").replace("summary: \"Hook Adapters capability.\"", `summary: ${JSON.stringify(summary)}`), "utf8");
    // A missing document becomes a create that previews its rendered body. repo-harness/v1 has no
    // whole-model generated view without topology nodes, so the module document is the missing target.
    const createPath = manifestTargetPath(root, REMOVED_GENERATED);
    rmSync(join(root, createPath));
    const modulePath = manifestTargetPath(root, KEPT);

    const calls: string[] = [];
    const host = daemon as unknown as Record<"planUpdate" | "applyUpdate", (...args: unknown[]) => unknown>;
    for (const method of ["planUpdate", "applyUpdate"] as const) {
      const original = host[method].bind(daemon);
      host[method] = (...args: unknown[]) => {
        calls.push(method);
        return original(...args);
      };
    }
    const docsBefore = docsSnapshot(root);
    const planned = projectionResult(await projectionRun(request("plan", "projection_request.preview_plan", { expected: expectedSnapshot(root) })));
    // Plan is read-only: no ChangeSet is planned or applied and no document moves.
    expect(calls).toEqual([]);
    expect(docsSnapshot(root)).toEqual(docsBefore);
    expect(planned.status).toBe("human-action-required");

    const byPath = new Map(planned.files.map((file) => [file.path, file]));
    const created = byPath.get(createPath)!;
    expect(created).toMatchObject({ action: "create", preview: { format: "body", truncated: false } });
    expect(created.preview!.content).toContain("<!-- BEGIN ARCHCONTEXT:generated");
    expect(created.preview!.byteLength).toBe(new TextEncoder().encode(created.preview!.content).length);

    const moduleDoc = byPath.get(modulePath)!;
    expect(moduleDoc).toMatchObject({ action: "update", preview: { format: "unified-diff", truncated: true } });
    expect(moduleDoc.preview!.content.startsWith(`--- a/${modulePath}\n+++ b/${modulePath}\n@@ -`)).toBe(true);
    expect(moduleDoc.preview!.content.endsWith("\n")).toBe(true);
    expect(new TextEncoder().encode(moduleDoc.preview!.content).length).toBeLessThanOrEqual(PROJECTION_FILE_PREVIEW_MAX_BYTES);
    expect(moduleDoc.preview!.byteLength).toBeGreaterThan(PROJECTION_FILE_PREVIEW_MAX_BYTES);
    expect(byPath.get("docs/architecture/.projection-manifest.json")).toMatchObject({ action: "update", preview: { format: "unified-diff", truncated: false } });

    // The unresolved major change names the capability and the facet that moved.
    const signal = planned.refreshSignals.find((entry) => entry.mode === "human-action-required")!;
    expect(architectureRefreshSignalInvariantIssues(signal)).toEqual([]);
    expect(signal.capabilities).toEqual([{
      capabilityId: KEPT,
      reasonCodes: ["responsibility-changed"],
      changedFacets: ["responsibilities"],
      proofStatusBefore: expect.any(Object),
      proofStatusAfter: expect.any(Object)
    }]);

    // Only plan previews: check reports the same files without bodies.
    const checked = projectionResult(await projectionRun(request("check", "projection_request.preview_check")));
    expect(checked.files.map(({ path, action }) => ({ path, action }))).toEqual(planned.files.map(({ path, action }) => ({ path, action })));
    expect(checked.files.every((file) => file.preview === undefined)).toBe(true);

    // The accepted apply writes the body the plan previewed, and its committed result carries no preview.
    const applied = projectionResult(await projectionRun(request("apply", "projection_request.preview_apply", { acceptObservedMajorChange: true })));
    expect(applied.status).toBe("applied");
    // The spies see the apply's ChangeSet, so their silence during plan was real.
    expect(calls).toEqual(["planUpdate", "applyUpdate"]);
    expect(applied.files.every((file) => file.preview === undefined)).toBe(true);
    expect(readFileSync(join(root, createPath), "utf8")).toBe(created.preview!.content);
  });
}, TEST_TIMEOUT_MS);

const MANIFEST_PATH = "docs/architecture/.projection-manifest.json";
const LEGACY_TARGET_ID = "projection_target.diagram.legacy";
const LEGACY_PATH = "docs/architecture/diagrams/legacy.mmd";
const LEGACY_BODY = "flowchart LR\n  legacy_a --> legacy_b\n";

/**
 * Records a whole-file output the current layout no longer renders: a committed manifest row for
 * `legacy.mmd` and the file itself. A whole-file output carries no marker, so that row is the only
 * record that the file is projection output (#327).
 */
function seedWholeFileOrphan(root: string, onDiskBody: string): void {
  const manifest = JSON.parse(readFileSync(join(root, MANIFEST_PATH), "utf8"));
  // The row is self-contained: repo-harness/v1 records no Mermaid diagram of its own.
  manifest.targets[LEGACY_TARGET_ID] = {
    type: "diagram-mermaid",
    scope: { kind: "diagram", id: "architecture" },
    path: LEGACY_PATH,
    ownership: "generated",
    format: "mermaid",
    outputDigest: digestJson({ targetId: LEGACY_TARGET_ID, body: LEGACY_BODY } as any)
  };
  writeFileSync(join(root, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  mkdirSync(dirname(join(root, LEGACY_PATH)), { recursive: true });
  writeFileSync(join(root, LEGACY_PATH), onDiskBody, "utf8");
  commitAll(root, "a whole-file output the layout no longer renders");
}

function manifestRowPaths(root: string): string[] {
  return (Object.values(JSON.parse(readFileSync(join(root, MANIFEST_PATH), "utf8")).targets) as Array<{ path: string }>).map((row) => row.path);
}

for (const lineEnding of ["lf", "crlf"] as const) {
  test(`docs apply deletes an intact whole-file orphan and drops its manifest row (${lineEnding}, #327)`, async () => {
    await withProtocolFixture(`archctx-projection-orphan-${lineEnding}-`, async ({ root, request, projectionRun, cli }) => {
      const onDisk = lineEnding === "crlf" ? LEGACY_BODY.replaceAll("\n", "\r\n") : LEGACY_BODY;
      seedWholeFileOrphan(root, onDisk);

      // check and plan both name the delete apply performs, bound to the bytes on disk.
      const expectedDelete = { path: LEGACY_PATH, action: "delete", preimageDigest: digestJson({ path: LEGACY_PATH, body: onDisk } as any), outputDigest: null };
      for (const mode of ["check", "plan"] as const) {
        const result = projectionResult(await projectionRun(request(mode, `projection_request.legacy_orphan_${mode}`)));
        expect(result.status).toBe("planned");
        expect(result.files.find((file) => file.path === LEGACY_PATH)).toMatchObject(expectedDelete);
      }
      const docsDrift = await cli("docs", ["drift", "--profile", "repo-harness/v1"]);
      expect((docsDrift.data as any).drift.orphans).toEqual([expect.objectContaining({ path: LEGACY_PATH, disposition: "delete" })]);

      const applied = await cli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"]);
      expect(applied.ok, JSON.stringify(applied)).toBe(true);
      // The one transactional apply removed the file and the row that owned it.
      expect(existsSync(join(root, LEGACY_PATH))).toBe(false);
      expect(manifestRowPaths(root)).not.toContain(LEGACY_PATH);

      // Reloaded from disk, the projection is a clean fixed point.
      const drift = await cli("docs", ["drift", "--profile", "repo-harness/v1"]);
      expect(drift.data, JSON.stringify(drift)).toMatchObject({ ok: true, drift: { orphans: [] } });
      const checked = projectionResult(await projectionRun(request("check", "projection_request.legacy_orphan_after")));
      expect(checked.status).toBe("noop");
      expect(checked.files).toEqual([]);
    });
  }, TEST_TIMEOUT_MS);
}

test("docs apply refuses a manually edited whole-file orphan and keeps its manifest row (#327)", async () => {
  await withProtocolFixture("archctx-projection-orphan-edited-", async ({ root, request, projectionRun, cli }) => {
    const edited = `${LEGACY_BODY}  legacy_b --> hand_added\n`;
    seedWholeFileOrphan(root, edited);
    const docsBefore = docsSnapshot(root);

    for (const action of ["plan", "apply"] as const) {
      const refused = await cli("docs", [action, "--profile", "repo-harness/v1", ...(action === "apply" ? ["--approved"] : [])]);
      expect(refused.ok, JSON.stringify(refused)).toBe(false);
      expect((refused as any).error.code).toBe("AC_PRECONDITION_FAILED");
      expect((refused as any).error).toMatchObject({reasonCode:"projection-orphan-review-required",details:{issueCount:1}});
    }
    // Nothing was written: the edited file and the row that keeps it visible both remain.
    expect(docsSnapshot(root)).toEqual(docsBefore);
    expect(manifestRowPaths(root)).toContain(LEGACY_PATH);

    const drift = await cli("docs", ["drift", "--profile", "repo-harness/v1"]);
    expect((drift.data as any).drift.orphans).toEqual([expect.objectContaining({ path: LEGACY_PATH, disposition: "human-review" })]);
    const checked = projectionResult(await projectionRun(request("check", "projection_request.legacy_orphan_edited_check")));
    expect(checked.status).toBe("human-action-required");
    expect(checked.humanActions.map((action) => [action.reasonCode, action.path])).toEqual([["orphaned-document-review", LEGACY_PATH]]);
    expect(checked.files.find((file) => file.path === LEGACY_PATH)).toBeUndefined();
  });
}, TEST_TIMEOUT_MS);

const V5_RENDERER_VERSION = "archcontext.docs-renderer/v5";
const V5_SOURCE_DIGEST = `sha256:${"5".repeat(64)}`;

/**
 * Turns the committed v6 outputs into what the v5 renderer wrote for the same bodies: every marked
 * region's marker carries a source digest and the v5 renderer version, and every whole-file output
 * is wrapped in such a marker. Generated bodies stay byte-equal, so only the markers differ.
 */
function rewriteOutputsAsV5(root: string, lineEnding: "lf" | "crlf"): string[] {
  const manifest = JSON.parse(readFileSync(join(root, MANIFEST_PATH), "utf8"));
  const changed: string[] = [];
  for (const [targetId, row] of Object.entries(manifest.targets as Record<string, { type: string; path: string; ownership: string; outputDigest: string }>)) {
    // history.md and the contract files were never v5 docs outputs: they became rows with manifest
    // v4 (ADR-0056 §8, §9).
    if (row.type === "architecture-history" || row.type === "agent-context") continue;
    const absolute = join(root, row.path);
    const body = readFileSync(absolute, "utf8");
    const v5Marker = (markerTargetId: string, outputDigest: string) =>
      `<!-- BEGIN ARCHCONTEXT:generated target="${markerTargetId}" sourceDigest="${V5_SOURCE_DIGEST}" rendererVersion="${V5_RENDERER_VERSION}" outputDigest="${outputDigest}" -->`;
    const next = row.ownership === "generated"
      ? `${v5Marker(targetId, row.outputDigest)}\n${body.trimEnd()}\n<!-- END ARCHCONTEXT:generated target="${targetId}" -->\n`
      : body.replace(
        /<!-- BEGIN ARCHCONTEXT:generated target="([^"]+)" rendererVersion="[^"]+" outputDigest="([^"]+)" -->/g,
        (_match, regionTargetId: string, outputDigest: string) => v5Marker(regionTargetId, outputDigest)
      );
    const written = lineEnding === "crlf" ? next.replaceAll("\n", "\r\n") : next;
    if (written === body) continue;
    writeFileSync(absolute, written, "utf8");
    changed.push(row.path);
  }
  return changed.sort();
}

for (const lineEnding of ["lf", "crlf"] as const) {
  test(`plan and check list every file a marker-only v5 upgrade rewrites, and apply writes exactly those (${lineEnding}, #327)`, async () => {
    await withProtocolFixture(`archctx-projection-v5-${lineEnding}-`, async ({ root, request, projectionRun }) => {
      const v5Paths = rewriteOutputsAsV5(root, lineEnding);
      expect(v5Paths.length).toBeGreaterThan(0);
      commitAll(root, "outputs as the v5 renderer wrote them");
      const docsBefore = docsSnapshot(root);

      const planned = projectionResult(await projectionRun(request("plan", "projection_request.v5_plan")));
      const checked = projectionResult(await projectionRun(request("check", "projection_request.v5_check")));
      expect(planned.status).toBe("planned");
      expect(checked.files.map(({ path, action }) => ({ path, action }))).toEqual(planned.files.map(({ path, action }) => ({ path, action })));
      const plannedPaths = planned.files.map((file) => file.path);
      expect(plannedPaths).toEqual(v5Paths);
      expect(planned.files.every((file) => file.action === "update")).toBe(true);
      // A marker-only rewrite keeps every rendered output: each rewritten target is an output
      // change of its bytes alone, and the planned actions are exactly the files apply writes.
      expect(checked.changes).toEqual(planned.changes);
      for (const entry of planned.changes!) {
        expect(entry, entry.path).toMatchObject(v5Paths.includes(entry.path)
          ? { classification: "output-change", plannedAction: "update", semanticChanged: false, proofChanged: false, reasonCodes: ["file-bytes-changed"] }
          : { classification: "unchanged", plannedAction: "none" });
      }
      expect(planned.changes!.filter((entry) => entry.plannedAction !== "none").map((entry) => entry.path)).toEqual(v5Paths);

      const applied = projectionResult(await projectionRun(request("apply", "projection_request.v5_apply")));
      expect(applied.status).toBe("applied");
      // The plan is the preview of this apply: the same files with the same digests, and the files
      // that actually changed on disk are exactly those.
      expect(applied.files.map(({ path, action, preimageDigest, outputDigest }) => ({ path, action, preimageDigest, outputDigest })))
        .toEqual(planned.files.map(({ path, action, preimageDigest, outputDigest }) => ({ path, action, preimageDigest, outputDigest })));
      const docsAfter = docsSnapshot(root);
      const written = Object.keys({ ...docsBefore, ...docsAfter }).filter((path) => docsBefore[path] !== docsAfter[path]).sort();
      expect(written).toEqual(plannedPaths);
      for (const path of written) expect(docsAfter[path]).not.toContain("sourceDigest=");

      const after = projectionResult(await projectionRun(request("check", "projection_request.v5_after")));
      expect(after.status).toBe("noop");
      expect(after.files).toEqual([]);
    });
  }, TEST_TIMEOUT_MS);
}
