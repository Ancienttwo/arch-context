import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { canonicalRepositoryRoot, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { architectureDocumentationProjectionWorktreeDigest, loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { PROJECTION_FILE_PREVIEW_MAX_BYTES, architectureRefreshSignalInvariantIssues, digestJson, projectionResultInvariantIssues, stableYaml, validateJsonSchema, type ProjectionRequestV1, type ProjectionResultV2 } from "@archcontext/contracts";
import { runCli } from "../src/main";

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
  commitAll(root, "projection lifecycle fixture");
  execFileSync("codegraph", ["init", root], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

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
    worktreeDigest: architectureDocumentationProjectionWorktreeDigest(root, loadNativeModelFromArchContext(root)) as `sha256:${string}`
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
  const target = manifest.targets.find((entry: any) => entry.scope?.id === scopeId);
  if (!target) throw new Error(`fixture manifest has no target for ${scopeId}`);
  return target.path;
}

function projectionResult(envelope: { ok: boolean; data?: unknown }): ProjectionResultV2 {
  expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
  const result = envelope.data as unknown as ProjectionResultV2;
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
    seedTwoCapabilityFixture(root);
    const baseline = await cli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"]);
    expect(baseline.ok, JSON.stringify(baseline)).toBe(true);
    commitAll(root, "project architecture documentation");
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

    // Remove both capabilities together with their relations and flows.
    removeCapability(root, REMOVED, "automation-budget");
    removeCapability(root, REMOVED_GENERATED, "legacy-queue");

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
    seedTwoCapabilityFixture(root);
    const baseline = await cli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"]);
    expect(baseline.ok, JSON.stringify(baseline)).toBe(true);
    commitAll(root, "project architecture documentation");
    await run({ root, daemon, localStore, cli, request, projectionRun });
  } finally {
    await daemon.stop();
    rmSync(stateRoot, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
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
    const acceptedChange = applied.applyReceipt!.acceptedChange;
    expect(acceptedChange).toMatchObject({ reasonCodes: observedSignal.reasonCodes, affectedNodeIds: observedSignal.affectedNodeIds });
    expect(acceptedChange.changeSetId).toMatch(/^changeset\.observed-major-change-[a-f0-9]{16}$/);
    expect(acceptedChange.eventId).toMatch(/^projection_event\.observed_major_change\.[a-f0-9]{16}$/);
    expect(applied.refreshSignals).toHaveLength(1);
    expect(applied.refreshSignals[0]).toMatchObject({ mode: "refresh-required", cause: "accepted-semantic-delta", acceptedChange });
    const inspected = await daemon.inspectProjectionApplyReceipt(root, applied.applyReceipt!.lookupKey);
    expect(inspected).toMatchObject({ ok: true, data: { found: true, deliveryStatus: "delivered", receipt: { identity: { acceptedChange } } } });

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

/**
 * Runs one write between classification and the ChangeSet write: the receipt lookup sits between
 * the two. Returns the lookup key the request used, so the caller can prove no receipt landed.
 */
function editAfterClassification(daemon: Awaited<ReturnType<typeof createStartedDaemon>>, edit: () => void) {
  const host = daemon as unknown as Record<"inspectProjectionApplyReceipt", (...args: unknown[]) => Promise<unknown>>;
  const inspect = host.inspectProjectionApplyReceipt.bind(daemon);
  const state: { lookupKey?: string } = {};
  host.inspectProjectionApplyReceipt = async (...args: unknown[]) => {
    const inspected = await inspect(...args);
    if (state.lookupKey === undefined) {
      state.lookupKey = args[1] as string;
      edit();
    }
    return inspected;
  };
  return { state, inspect };
}

/** The apply failed its write precondition: typed refusal, no receipt, no prior committed apply. */
async function expectApplyRefusedBeforeWrite(
  daemon: Awaited<ReturnType<typeof createStartedDaemon>>,
  root: string,
  refused: { ok: boolean },
  lookup: ReturnType<typeof editAfterClassification>,
  requestId: string
): Promise<void> {
  expect(lookup.state.lookupKey).toBeString();
  expect(refused.ok, JSON.stringify(refused)).toBe(false);
  expect((refused as any).error).toMatchObject({ code: "AC_PRECONDITION_FAILED" });
  expect((refused as any).error.message).toContain("Expected hash mismatch");
  expect(await lookup.inspect(root, lookup.state.lookupKey)).toMatchObject({ ok: true, data: { found: false } });
  const prior = await daemon.listProjectionPriorCommittedApplies(root, requestId) as any;
  expect(prior.ok, JSON.stringify(prior)).toBe(true);
  expect(JSON.stringify(prior.data)).not.toContain(lookup.state.lookupKey!);
}

test("an observed-change apply fails closed when the manifest moves mid-request", async () => {
  await withProtocolFixture("archctx-projection-observed-baseline-", async ({ root, daemon, request, projectionRun }) => {
    editKeptSummary(root);
    const manifestPath = join(root, "docs/architecture/.projection-manifest.json");
    const classifiedManifest = readFileSync(manifestPath, "utf8");

    // The semantic baseline lives in the manifest, which the worktree digest does not cover. A
    // moved baseline would also see REMOVED's responsibilities change; the write is bound to the
    // bytes classification read, so the move fails the hash precondition before any file is written.
    const tampered = JSON.parse(classifiedManifest);
    const removedBaseline = tampered.semanticBaseline.semanticState.capabilities.find((entry: any) => entry.capabilityId === REMOVED);
    removedBaseline.facets.responsibilities = `sha256:${"0".repeat(64)}`;
    removedBaseline.semanticFingerprint = `sha256:${"1".repeat(64)}`;
    const tamperedBody = `${JSON.stringify(tampered, null, 2)}\n`;
    const docsBefore = docsSnapshot(root);
    const lookup = editAfterClassification(daemon, () => writeFileSync(manifestPath, tamperedBody, "utf8"));

    const requestId = "projection_request.observed_baseline";
    const refused = await projectionRun(request("apply", requestId, { acceptObservedMajorChange: true }));
    await expectApplyRefusedBeforeWrite(daemon, root, refused, lookup, requestId);
    expect(docsSnapshot(root)).toEqual({ ...docsBefore, "docs/architecture/.projection-manifest.json": tamperedBody });
  });
}, TEST_TIMEOUT_MS);

test("an observed-change apply never overwrites a human note added after classification", async () => {
  await withProtocolFixture("archctx-projection-observed-human-note-", async ({ root, daemon, request, projectionRun }) => {
    editKeptSummary(root);
    // KEPT's module document is rewritten by this apply; the note sits outside its generated markers.
    const modulePath = manifestTargetPath(root, KEPT);
    const noted = `${readFileSync(join(root, modulePath), "utf8")}\nHuman hook adapter notes.\n`;
    const docsBefore = docsSnapshot(root);
    const lookup = editAfterClassification(daemon, () => writeFileSync(join(root, modulePath), noted, "utf8"));

    const requestId = "projection_request.observed_human_note";
    const refused = await projectionRun(request("apply", requestId, { acceptObservedMajorChange: true }));
    await expectApplyRefusedBeforeWrite(daemon, root, refused, lookup, requestId);
    expect(readFileSync(join(root, modulePath), "utf8")).toBe(noted);
    expect(docsSnapshot(root)).toEqual({ ...docsBefore, [modulePath]: noted });
  });
}, TEST_TIMEOUT_MS);

test("a repeated accepted apply returns the committed result without applying again (#265)", async () => {
  await withProtocolFixture("archctx-projection-replay-", async ({ root, daemon, request, projectionRun }) => {
    editKeptSummary(root);
    const original = request("apply", "projection_request.replay", { acceptObservedMajorChange: true });
    const first = projectionResult(await projectionRun(original));
    expect(first.status).toBe("applied");
    expect(first.replayed).toBeUndefined();
    const docsAfterFirst = docsSnapshot(root);

    // The same requestId and request digest — including the flag, never the generated ids —
    // returns the committed result, marked replayed, with the committed receipt digest.
    const replay = projectionResult(await projectionRun(original));
    expect(replay.replayed).toBe(true);
    const { replayed: _replayed, ...replayBody } = replay;
    expect(replayBody).toEqual(first);
    expect(docsSnapshot(root)).toEqual(docsAfterFirst);

    // Another request under the same requestId gets a typed refusal that names the lookup key.
    const different = await projectionRun({ ...original, changedPaths: [`.archcontext/model/nodes/${KEPT}.yaml`] });
    expect(different.ok).toBe(false);
    expect((different as any).error).toMatchObject({
      code: "AC_PROJECTION_APPLY_COMMITTED",
      reasonCode: "projection-apply-request-differs",
      retryable: false,
      details: { requestId: original.requestId, lookupKey: first.applyReceipt!.lookupKey, applyId: first.applyReceipt!.applyId }
    });

    // The same accepted change under a new requestId is refused with the same typed code.
    const { acceptObservedMajorChange: _flag, ...withoutFlag } = original;
    const sameChange = await projectionRun({ ...withoutFlag, requestId: "projection_request.replay_other", acceptedChange: first.applyReceipt!.acceptedChange });
    expect(sameChange.ok).toBe(false);
    expect((sameChange as any).error).toMatchObject({
      code: "AC_PROJECTION_APPLY_COMMITTED",
      reasonCode: "projection-accepted-change-committed",
      details: { lookupKey: first.applyReceipt!.lookupKey }
    });

    // Readback stays available: the original request with the committed acceptedChange in place of the flag.
    const readback = await daemon.readbackProjectionApply(root, { ...withoutFlag, acceptedChange: first.applyReceipt!.acceptedChange });
    expect(readback.ok, JSON.stringify(readback)).toBe(true);
    expect((readback.data as any).receipt.result.receiptDigest).toBe(first.receiptDigest);
    expect((readback.data as any).receipt.recovery.requestDigest).toBe(digestJson(original as any));
  });
}, TEST_TIMEOUT_MS);

test("AC_PROJECTION_APPLY_COMMITTED details are a readback request a flag-only caller can send (#278)", async () => {
  await withProtocolFixture("archctx-projection-committed-readback-", async ({ root, localStore, cli, request, projectionRun }) => {
    editKeptSummary(root);
    // The caller never holds an acceptedChange: it applies with the flag only.
    const original = request("apply", "projection_request.committed_readback", { acceptObservedMajorChange: true });
    const first = projectionResult(await projectionRun(original));
    expect(first.status).toBe("applied");
    const readBack = async (details: any) => {
      // Followed literally: the details' readback request goes to `projection readback` unchanged.
      const readback = await cli("projection", ["readback", "--request-json", JSON.stringify(details.readbackRequest)]);
      expect(readback.ok, JSON.stringify(readback)).toBe(true);
      expect((readback.data as any).receipt.result).toEqual(first);
    };

    const different = await projectionRun({ ...original, changedPaths: [`.archcontext/model/nodes/${KEPT}.yaml`] });
    expect(different.ok).toBe(false);
    const differs = (different as any).error;
    expect(differs).toMatchObject({
      code: "AC_PROJECTION_APPLY_COMMITTED",
      reasonCode: "projection-apply-request-differs",
      details: {
        requestId: original.requestId,
        lookupKey: first.applyReceipt!.lookupKey,
        applyId: first.applyReceipt!.applyId,
        requestDigest: digestJson(original as any),
        readbackRequest: { requestId: original.requestId, mode: "apply", acceptedChange: first.applyReceipt!.acceptedChange }
      }
    });
    expect(differs.message).toContain("new requestId");
    expect(differs.message).toContain("error.details.readbackRequest");
    await readBack(differs.details);

    // A pre-#265 receipt recorded no request digest: no request can be proven equal to it, so the
    // same request under that requestId stays refused, and the details still read it back.
    const journals = (localStore as any).changeSetJournals as Map<string, { projectionApplyReceipt?: { recovery?: { requestDigest?: string } } }>;
    const committed = [...journals.values()].find((entry) => entry.projectionApplyReceipt?.recovery?.requestDigest !== undefined);
    if (!committed) throw new Error("fixture committed no receipt with a request digest");
    delete committed.projectionApplyReceipt!.recovery!.requestDigest;
    const unrecorded = await projectionRun(original);
    expect(unrecorded.ok).toBe(false);
    const legacy = (unrecorded as any).error;
    expect(legacy).toMatchObject({
      code: "AC_PROJECTION_APPLY_COMMITTED",
      reasonCode: "projection-apply-request-digest-unrecorded",
      retryable: false,
      details: { requestId: original.requestId, lookupKey: first.applyReceipt!.lookupKey, applyId: first.applyReceipt!.applyId }
    });
    expect(legacy.details.requestDigest).toBeUndefined();
    expect(legacy.message).toContain("new requestId");
    await readBack(legacy.details);
  });
}, TEST_TIMEOUT_MS);

test("plan previews each file as a bounded body or unified diff and writes nothing (#264)", async () => {
  await withProtocolFixture("archctx-projection-preview-", async ({ root, daemon, request, projectionRun }) => {
    // A summary far larger than one preview bound turns the module document diff into a truncated one.
    const nodePath = join(root, `.archcontext/model/nodes/${KEPT}.yaml`);
    const summary = Array.from({ length: 3_000 }, (_, index) => `Hook adapters route event ${index} through the validated runtime boundary.`).join("\n");
    writeFileSync(nodePath, readFileSync(nodePath, "utf8").replace("summary: \"Hook Adapters capability.\"", `summary: ${JSON.stringify(summary)}`), "utf8");
    // A missing generated document becomes a create that previews its rendered body.
    const manifest = JSON.parse(readFileSync(join(root, "docs/architecture/.projection-manifest.json"), "utf8"));
    const changelogPath: string = manifest.targets.find((target: any) => target.type === "architecture-changelog").path;
    rmSync(join(root, changelogPath));
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
    const created = byPath.get(changelogPath)!;
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
    expect(readFileSync(join(root, changelogPath), "utf8")).toBe(created.preview!.content);
    const inspected = await daemon.inspectProjectionApplyReceipt(root, applied.applyReceipt!.lookupKey);
    expect(JSON.stringify(inspected)).not.toContain("\"preview\"");
  });
}, TEST_TIMEOUT_MS);
