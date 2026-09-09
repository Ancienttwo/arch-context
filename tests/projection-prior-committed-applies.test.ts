import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { canonicalRepositoryRoot, computeWorktreeDigest, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { architectureDocumentationProjectionWorktreeDigest, loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { ArchctxRuntimeRpcServer, RUNTIME_RPC_VERSION, createStartedDaemon, type RuntimeDaemonClient } from "@archcontext/local-runtime/runtime-daemon";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { digestJson, projectionResultInvariantIssues, stableYaml, type ProjectionRequestV1, type ProjectionResultV2 } from "@archcontext/contracts";
import { runCli } from "../packages/surfaces/cli/src/main";

const timeout = process.platform === "win32" ? 240_000 : 60_000;
const MANIFEST_PATH = "docs/architecture/.projection-manifest.json";

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function gitOut(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function stateRoot(root: string): string {
  return join(dirname(root), `.archctx-state-${basename(root)}`);
}

async function withTestCli<T>(root: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.ARCHCONTEXT_STATE_DIR;
  process.env.ARCHCONTEXT_STATE_DIR = stateRoot(root);
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previous;
  }
}

async function runTestCli(command: string, args: string[], root: string, runtimeClient: RuntimeDaemonClient) {
  return withTestCli(root, () => runCli(command, args, root, {
    runtimeClient,
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider()
  }));
}

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-prior-applies-"));
  writeFileSync(join(root, "README.md"), "# prior applies fixture\n", "utf8");
  initializeArchContextModel(root, "Prior Applies Fixture");
  git(root, "init");
  git(root, "config", "user.name", "ArchContext Test");
  git(root, "config", "user.email", "archcontext@example.test");
  git(root, "add", ".");
  git(root, "commit", "-m", "fixture");
  return root;
}

function projectionRequest(root: string, requestId: string): ProjectionRequestV1 {
  return {
    schemaVersion: "archcontext.projection-request/v1",
    requestId,
    profile: "repo-harness/v1",
    mode: "apply",
    targets: ["agent-context", "architecture-docs"],
    changedPaths: [MANIFEST_PATH],
    expected: {
      repositoryId: repositoryFingerprint(root),
      workspaceId: `workspace.${digestJson({ root: canonicalRepositoryRoot(root) } as never).replace(/^sha256:/, "").slice(0, 16)}`,
      headSha: gitOut(root, "rev-parse", "HEAD"),
      worktreeDigest: architectureDocumentationProjectionWorktreeDigest(root, loadNativeModelFromArchContext(root))
    }
  };
}

/** The default initialized model is not a valid repo-harness-profile subject; give it one node,
 * relation and flow in the domain.capability shape that profile requires. */
function writeRepoHarnessProfileModel(root: string): void {
  rmSync(join(root, ".archcontext/model/nodes/capability.architecture-context.yaml"), { force: true });
  writeFileSync(join(root, ".archcontext/model/nodes/capability.runtime-harness.hook-adapters.yaml"), stableYaml({
    schemaVersion: "archcontext.node/v2",
    id: "capability.runtime-harness.hook-adapters",
    kind: "capability",
    name: "Hook Adapters",
    status: "active",
    summary: "Routes runtime hook events.",
    extensions: { contractFiles: { agents: "packages/runtime-harness/AGENTS.md", claude: "packages/runtime-harness/CLAUDE.md" } }
  }), "utf8");
  mkdirSync(join(root, ".archcontext/model/relations"), { recursive: true });
  writeFileSync(join(root, ".archcontext/model/relations/relation.hook-journal.yaml"), stableYaml({
    schemaVersion: "archcontext.relation/v1",
    id: "relation.hook-journal",
    kind: "writes",
    source: "capability.runtime-harness.hook-adapters",
    target: "capability.runtime-harness.hook-adapters",
    intent: "Persist hook event in the owned journal"
  }), "utf8");
  mkdirSync(join(root, ".archcontext/model/flows"), { recursive: true });
  writeFileSync(join(root, ".archcontext/model/flows/flow.hook-adapters.yaml"), stableYaml({
    schemaVersion: "archcontext.flow/v1",
    id: "flow.hook-adapters",
    capabilityId: "capability.runtime-harness.hook-adapters",
    name: "Hook projection",
    applicability: "not-applicable",
    rationale: "Prior-applies fixture."
  }), "utf8");
  mkdirSync(join(root, "docs/architecture/modules/runtime-harness"), { recursive: true });
  writeFileSync(
    join(root, "docs/architecture/modules/runtime-harness/hook-adapters.md"),
    "# runtime-harness/hook-adapters\n\n## 1. Old P1\nlegacy\n\n## 2. Old P2\nlegacy flow\n\n## 3. P3 Decisions\nhuman decision  \n\n## 4. History\nhuman history\n",
    "utf8"
  );
}

/** Reads the committed journal rows straight from the store, independently of whatever the CLI
 * result claims, so an assertion about the reported changeSetId can actually fail. */
function committedJournalRows(root: string, taskSessionId: string): { journalId: string; changeSetId: string; completedAt: string }[] {
  const database = new Database(join(stateRoot(root), "local-store.sqlite"), { readonly: true });
  try {
    return database.query("SELECT journal_id, changeset_id, metadata_json, completed_at FROM changeset_journal WHERE status = 'committed' ORDER BY completed_at ASC, journal_id ASC")
      .all()
      .filter((row) => (JSON.parse(String((row as { metadata_json: string }).metadata_json)) as { reason: { taskSessionId: string } }).reason.taskSessionId === taskSessionId)
      .map((row) => {
        const typed = row as { journal_id: string; changeset_id: string; completed_at: string };
        return { journalId: typed.journal_id, changeSetId: typed.changeset_id, completedAt: typed.completed_at };
      });
  } finally {
    database.close();
  }
}

async function reachCleanProjection(root: string, daemon: RuntimeDaemonClient): Promise<void> {
  const preview = await runTestCli("docs", ["adopt", "--profile", "repo-harness/v1"], root, daemon);
  expect(preview.ok, JSON.stringify(preview)).toBe(true);
  const adopted = await runTestCli("docs", [
    "adopt", "--profile", "repo-harness/v1", "--approved",
    "--adoption-plan-id", (preview.data as { adoptionPlanId: string }).adoptionPlanId,
    "--expected-worktree-digest", computeWorktreeDigest(root)
  ], root, daemon);
  expect(adopted.ok, JSON.stringify(adopted)).toBe(true);
  const applied = await runTestCli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"], root, daemon);
  expect(applied.ok, JSON.stringify(applied)).toBe(true);
}

test("a repeated projection request learns what its own killed attempt already committed", async () => {
  const root = createFixture();
  const previousStateDir = process.env.ARCHCONTEXT_STATE_DIR;
  process.env.ARCHCONTEXT_STATE_DIR = stateRoot(root);
  const daemon = await createStartedDaemon({
    localStorePath: join(stateRoot(root), "local-store.sqlite"),
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider()
  });
  let rpcServer: ArchctxRuntimeRpcServer | undefined;
  try {
    writeRepoHarnessProfileModel(root);
    await reachCleanProjection(root, daemon);

    // Drop a projection-owned output so the next apply has real work, exactly the drift-repair
    // shape that commits without an accepted semantic change and therefore without an apply receipt.
    unlinkSync(join(root, MANIFEST_PATH));
    expect(existsSync(join(root, MANIFEST_PATH))).toBe(false);

    const requestId = "repo-harness.projection.job-prior-committed";
    const first = await runTestCli("projection", ["run", "--request-json", JSON.stringify(projectionRequest(root, requestId))], root, daemon);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const firstResult = first.data as ProjectionResultV2;
    expect(firstResult.status).toBe("applied");
    expect(firstResult.files.map((file) => file.path)).toContain(MANIFEST_PATH);
    expect(firstResult.priorCommittedApplies).toBeUndefined();
    expect(existsSync(join(root, MANIFEST_PATH))).toBe(true);

    // This is the retry the killed caller performs: the fixed point is already reached, so status
    // and files carry no evidence of the earlier write.
    const retry = await runTestCli("projection", ["run", "--request-json", JSON.stringify(projectionRequest(root, requestId))], root, daemon);
    expect(retry.ok, JSON.stringify(retry)).toBe(true);
    const retryResult = retry.data as ProjectionResultV2;
    expect(retryResult.status).toBe("noop");
    expect(retryResult.files).toEqual([]);
    expect(projectionResultInvariantIssues(retryResult)).toEqual([]);

    const committedRows = committedJournalRows(root, requestId);
    expect(committedRows).toHaveLength(1);
    const expectedChangeSetId = committedRows[0]!.changeSetId;
    expect(expectedChangeSetId).toMatch(/^changeset\.docs-projection-[a-f0-9]{16}$/);

    const prior = retryResult.priorCommittedApplies;
    expect(prior).toHaveLength(1);
    expect(prior![0]!.requestId).toBe(requestId);
    expect(prior![0]!.changeSetId).toBe(expectedChangeSetId);
    expect(prior![0]!.committedAt).toBe(committedRows[0]!.completedAt);
    // A plain drift-repair apply commits without an apply receipt, so recovery identity is absent
    // rather than invented.
    expect(prior![0]!.applyId).toBeUndefined();
    expect(prior![0]!.lookupKey).toBeUndefined();
    const manifestEntry = prior![0]!.files.find((file) => file.path === MANIFEST_PATH);
    expect(manifestEntry).toBeDefined();
    expect(manifestEntry!.operation).toBe("write");
    expect(manifestEntry!.hash).toMatch(/^sha256:[a-f0-9]{64}$/);

    // A different requestId is a different caller identity and must not inherit the evidence.
    const other = await runTestCli("projection", [
      "run", "--request-json", JSON.stringify(projectionRequest(root, "repo-harness.projection.job-unrelated"))
    ], root, daemon);
    expect(other.ok, JSON.stringify(other)).toBe(true);
    const otherResult = other.data as ProjectionResultV2;
    expect(otherResult.status).toBe("noop");
    expect(otherResult.priorCommittedApplies).toBeUndefined();
    expect(otherResult.receiptDigest).not.toBe(retryResult.receiptDigest);

    // In production the CLI always reaches the daemon over RPC, and an unrouted method degrades to
    // a generic schema error rather than a type error, so the transport hop is asserted directly.
    rpcServer = new ArchctxRuntimeRpcServer(daemon, {
      root,
      token: "prior-committed-applies-token",
      connectionPath: join(stateRoot(root), "prior-applies-rpc.json"),
      lockPath: join(stateRoot(root), "prior-applies-rpc.lock")
    });
    const connection = await rpcServer.start();
    const response = await fetch(new URL("rpc", connection.url), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${connection.token}`,
        "Content-Type": "application/json",
        "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION
      },
      body: JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method: "listProjectionPriorCommittedApplies", params: [root, requestId] })
    });
    expect(await response.json()).toMatchObject({ ok: true, data: { applies: [{ requestId, changeSetId: expectedChangeSetId }] } });

    // A killed attempt and its retry both commit under one requestId, and the protocol changeSetId
    // is digest-derived, so the journal legitimately holds two committed rows carrying one
    // changeSetId. Reporting both would violate the result contract's sorted-unique invariant and
    // make every later run for this requestId fail permanently.
    const duplicateAt = new Date(Date.parse(committedRows[0]!.completedAt) + 1000).toISOString();
    const writable = new Database(join(stateRoot(root), "local-store.sqlite"));
    try {
      writable.query(
        `INSERT INTO changeset_journal
          (journal_id, changeset_id, root, status, metadata_json, files_json, created_at, updated_at, completed_at)
          SELECT ?, changeset_id, root, status, metadata_json, files_json, created_at, ?, ?
          FROM changeset_journal WHERE journal_id = ?`
      ).run("changeset_duplicate-retry", duplicateAt, duplicateAt, committedRows[0]!.journalId);
    } finally {
      writable.close();
    }
    expect(committedJournalRows(root, requestId)).toHaveLength(2);

    const afterDuplicate = await runTestCli("projection", ["run", "--request-json", JSON.stringify(projectionRequest(root, requestId))], root, daemon);
    expect(afterDuplicate.ok, JSON.stringify(afterDuplicate)).toBe(true);
    const afterDuplicateResult = afterDuplicate.data as ProjectionResultV2;
    expect(projectionResultInvariantIssues(afterDuplicateResult)).toEqual([]);
    expect(afterDuplicateResult.priorCommittedApplies).toHaveLength(1);
    expect(afterDuplicateResult.priorCommittedApplies![0]!.changeSetId).toBe(expectedChangeSetId);
    expect(afterDuplicateResult.priorCommittedApplies![0]!.committedAt).toBe(duplicateAt);
  } finally {
    if (rpcServer) await rpcServer.stop();
    await daemon.stop();
    if (previousStateDir === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previousStateDir;
    rmSync(stateRoot(root), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}, timeout);
