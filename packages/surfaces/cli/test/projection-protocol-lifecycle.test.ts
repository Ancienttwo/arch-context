import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { canonicalRepositoryRoot, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { architectureDocumentationProjectionWorktreeDigest, loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { digestJson, projectionResultInvariantIssues, stableYaml, validateJsonSchema, type ProjectionRequestV1, type ProjectionResultV2 } from "@archcontext/contracts";
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
      else files[relative(root, absolute)] = readFileSync(absolute, "utf8");
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
    // One module document carries the human-owned skeleton plus a human note; the other holds
    // only its generated region.
    writeFileSync(join(root, modulePath), `${readFileSync(join(root, modulePath), "utf8")}\nHuman budget notes.\n`, "utf8");
    const generatedBody = readFileSync(join(root, generatedPath), "utf8");
    const regionStart = generatedBody.indexOf("<!-- BEGIN ARCHCONTEXT:generated");
    const regionEnd = generatedBody.indexOf("-->", generatedBody.indexOf("<!-- END ARCHCONTEXT:generated")) + "-->".length;
    writeFileSync(join(root, generatedPath), `${generatedBody.slice(regionStart, regionEnd)}\n`, "utf8");
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
    expect(applied.files.find((file) => file.path === generatedPath)).toMatchObject({ action: "delete", outputDigest: null });
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
