import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { canonicalAttestationV2 } from "@archcontext/contracts";
import { assertNoCodeGraphInternalPathAccess, CodeGraphAdapter, REQUIRED_CODEGRAPH_VERSION } from "@archcontext/local-runtime/codegraph-adapter";
import { removeDetachedReviewWorktree } from "@archcontext/local-runtime/git-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { migrationSql, assertNoSourceStorageSchema, SQLITE_PRAGMAS } from "@archcontext/local-runtime/local-store-sqlite";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { initializeArchContextModel, listModelFiles } from "@archcontext/local-runtime/model-store-yaml";
import {
  ArchctxRuntimeRpcServer,
  RUNTIME_RPC_VERSION,
  RuntimeRpcClient,
  assertProductionRuntimeDeps,
  createStartedProductionDaemon,
  createStartedDaemon,
  defaultDeveloperReviewRunStateDir,
  defaultDaemonConnectionPath,
  defaultDaemonLockPath,
  recoverStaleDaemonControlFiles,
  readRuntimeRpcConnection
} from "../src/index";

function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-"));
  writeFileSync(join(root, "README.md"), "# tmp\n", "utf8");
  return root;
}

function removeTempRepo(root: string): void {
  try {
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

function expectSameExistingPath(actual: string, expected: string): void {
  expect(normalizeExistingPath(actual)).toBe(normalizeExistingPath(expected));
}

function normalizeExistingPath(path: string): string {
  const real = realpathSync.native(path);
  return process.platform === "win32" ? real.toLowerCase() : real;
}

function createStartedTestDaemon(deps: Parameters<typeof createStartedDaemon>[0] = {}) {
  return createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore(),
    ...deps
  });
}

describe("local runtime foundation", () => {
  test("init, validate, sync, context, and status share one runtime session", async () => {
    const root = tempRepo();
    try {
      const daemon = await createStartedTestDaemon();
      const init = await daemon.init(root, "Test App");
      expect(init.ok).toBe(true);
      expect(readFileSync(join(root, ".archcontext/manifest.yaml"), "utf8")).toContain("archcontext.manifest/v1");
      mkdirSync(join(root, ".archcontext/decisions"), { recursive: true });
      writeFileSync(
        join(root, ".archcontext/decisions/ADR-0001-test.md"),
        "---\nschemaVersion: archcontext.adr/v1\nid: adr.0001.test\n---\n# Test\n",
        "utf8"
      );
      expect(listModelFiles(root).map((file) => file.path)).toContain(".archcontext/decisions/ADR-0001-test.md");

      const validateA = await daemon.validate(root);
      const validateB = await daemon.validate(root);
      expect(validateA).toEqual(validateB);
      expect((validateA.data as any).valid).toBe(true);

      const sync = await daemon.sync(root);
      expect(sync.ok).toBe(true);
      expect((sync.data as any).codeFactsDigest).toMatch(/^sha256:/);

      const context = await daemon.context(root, "add billing");
      expect(context.ok).toBe(true);
      expect((context.data as any).schemaVersion).toBe("archcontext.task-context/v1");
      expect((context.data as any).resources.length).toBeGreaterThanOrEqual(3);

      const status = await daemon.runtimeStatus(root);
      expect((status.data as any).repositoryId).toBe(repositoryFingerprint(root));
      expect((status.data as any).worktreeDigest).toMatch(/^sha256:/);
      expect(daemon.status().sessions).toBe(1);
    } finally {
      removeTempRepo(root);
    }
  });

  test("SQLite contract enables WAL, foreign keys, busy timeout, and stores no source bodies", () => {
    const sql = migrationSql();
    for (const pragma of SQLITE_PRAGMAS) expect(sql).toContain(pragma);
    expect(() => assertNoSourceStorageSchema(sql)).not.toThrow();
  });

  test("runtime store recovers pending snapshots without losing committed state", async () => {
    const store = new TestLocalStore();
    await store.migrate();
    const snapshot = { repositoryId: "repo.test", headSha: "abc", worktreeDigest: "sha256:test" };
    const pending = await store.beginSnapshot(snapshot);
    const committed = await store.beginSnapshot(snapshot);
    await store.commitSnapshot(committed);

    expect(store.recoverPendingSnapshots()).toBe(1);
    expect(store.snapshots.has(pending)).toBe(false);
    expect(store.snapshots.get(committed)?.state).toBe("committed");
  });

  test("daemon restart restores persisted repository sessions from the local store", async () => {
    const root = tempRepo();
    const dbPath = join(root, ".archcontext/.local/runtime.sqlite");
    let first: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
    let second: Awaited<ReturnType<typeof createStartedDaemon>> | undefined;
    try {
      first = await createStartedDaemon({
        codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
        codeGraphProviderFactory: () => new MockCodeGraphProvider(),
        localStorePath: dbPath,
        clock: () => "2026-06-20T00:00:00.000Z"
      });
      const init = await first.init(root, "Persistent Session");
      expect(init.ok).toBe(true);
      const before = await first.runtimeStatus(root);
      expect((before.data as any).sessions).toBe(1);
      await first.stop();
      first = undefined;

      second = await createStartedDaemon({
        codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
        codeGraphProviderFactory: () => new MockCodeGraphProvider(),
        localStorePath: dbPath,
        clock: () => "2026-06-20T00:01:00.000Z"
      });
      const after = await second.runtimeStatus(root);
      expect(after.data).toMatchObject({
        sessions: 1,
        repositories: [repositoryFingerprint(root)],
        repositoryId: repositoryFingerprint(root),
        headSha: (before.data as any).headSha,
        worktreeDigest: (before.data as any).worktreeDigest
      });
      await second.stop();
      second = undefined;
    } finally {
      await second?.stop().catch(() => undefined);
      await first?.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  });

  test("prepares Developer Review from Challenge head in a detached clean worktree", async () => {
    const root = createGitRepo();
    const tempRoot = mkdtempSync(join(tmpdir(), "archctx-runtime-worktrees-"));
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    let worktree: NonNullable<ReturnType<Awaited<ReturnType<typeof createStartedTestDaemon>>["prepareDeveloperReviewWorktree"]>["worktree"]> | undefined;
    try {
      daemon = await createStartedTestDaemon();
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const headTreeOid = gitOut(root, "rev-parse", "HEAD^{tree}");
      writeFileSync(join(root, "README.md"), "# dirty source checkout\n", "utf8");

      const prepared = daemon.prepareDeveloperReviewWorktree({
        repositoryRoot: root,
        challenge: {
          schemaVersion: "archcontext.review-challenge/v2",
          challengeId: "chal_runtime_worktree",
          installationId: 123,
          repositoryId: 456,
          pullRequestNumber: 7,
          headSha,
          baseSha: headSha,
          nonce: "nonce_runtime_worktree",
          requiredTrust: "developer",
          policyProfileId: "policy.default",
          createdAt: "2026-06-20T00:00:00.000Z",
          expiresAt: "2026-06-20T00:15:00.000Z",
          status: "LEASED"
        },
        expectedHeadTreeOid: headTreeOid,
        tempRoot
      });

      expect(prepared.accepted).toBe(true);
      worktree = prepared.worktree;
      expect(worktree?.headSha).toBe(headSha);
      expect(worktree?.headTreeOid).toBe(headTreeOid);
      expect(worktree?.detached).toBe(true);
      expect(worktree?.clean).toBe(true);
      expect(readFileSync(join(worktree!.worktreeRoot, "README.md"), "utf8")).toBe("# fixture\n");
      expect(gitOut(worktree!.worktreeRoot, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");

      const mismatch = daemon.prepareDeveloperReviewWorktree({
        repositoryRoot: root,
        challenge: {
          ...preparedChallenge(headSha),
          headSha: "d".repeat(40)
        },
        tempRoot
      });
      expect(mismatch).toMatchObject({ accepted: false, reasonCode: "HEAD_UNAVAILABLE" });
    } finally {
      if (worktree) removeDetachedReviewWorktree(worktree);
      await daemon?.stop().catch(() => undefined);
      rmSync(tempRoot, { recursive: true, force: true });
      removeTempRepo(root);
    }
  });

  test("computes Developer Review digest bundle from detached worktree model policy codefacts and runtime", async () => {
    const root = createInitializedGitRepo();
    const tempRoot = mkdtempSync(join(tmpdir(), "archctx-runtime-digests-"));
    const provider = new MockCodeGraphProvider();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    let worktree: NonNullable<ReturnType<Awaited<ReturnType<typeof createStartedTestDaemon>>["prepareDeveloperReviewWorktree"]>["worktree"]> | undefined;
    try {
      daemon = await createStartedTestDaemon({ codeFacts: new CodeGraphAdapter(provider) });
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const challenge = preparedChallenge(headSha);
      const prepared = daemon.prepareDeveloperReviewWorktree({
        repositoryRoot: root,
        challenge,
        expectedHeadTreeOid: gitOut(root, "rev-parse", "HEAD^{tree}"),
        tempRoot
      });
      expect(prepared.accepted).toBe(true);
      worktree = prepared.worktree;

      const bundle = await daemon.computeDeveloperReviewDigestBundle({ challenge, worktree: worktree! });

      expect(bundle).toMatchObject({
        schemaVersion: "archcontext.developer-review-digest-bundle/v1",
        challengeId: challenge.challengeId,
        repositoryId: challenge.repositoryId,
        headSha,
        headTreeOid: worktree!.headTreeOid,
        runtime: {
          version: "0.1.0",
          codeGraphVersion: REQUIRED_CODEGRAPH_VERSION
        }
      });
      expect(bundle.worktreeDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(bundle.modelDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(bundle.policyDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(bundle.codeFactsDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(bundle.runtime.buildDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(bundle.runtime.capabilitiesDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(provider.indexedRoots).toEqual([worktree!.worktreeRoot]);
      expect(JSON.stringify(bundle)).not.toContain("policy.review");
      expect(JSON.stringify(bundle)).not.toContain("Digest App");

      writeFileSync(join(worktree!.worktreeRoot, "README.md"), "# dirty detached worktree\n", "utf8");
      await expect(daemon.computeDeveloperReviewDigestBundle({ challenge, worktree: worktree! })).rejects.toThrow("WORKTREE_NOT_CLEAN");
    } finally {
      if (worktree) removeDetachedReviewWorktree(worktree);
      await daemon?.stop().catch(() => undefined);
      rmSync(tempRoot, { recursive: true, force: true });
      removeTempRepo(root);
    }
  });

  test("runs deterministic Developer Review inside detached worktree and persists the local result", async () => {
    const root = createInitializedGitRepo();
    const tempRoot = mkdtempSync(join(tmpdir(), "archctx-runtime-review-"));
    const provider = new MockCodeGraphProvider();
    const store = new TestLocalStore();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    let worktree: NonNullable<ReturnType<Awaited<ReturnType<typeof createStartedTestDaemon>>["prepareDeveloperReviewWorktree"]>["worktree"]> | undefined;
    try {
      daemon = await createStartedTestDaemon({ codeFacts: new CodeGraphAdapter(provider), localStore: store });
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const challenge = preparedChallenge(headSha);
      const prepared = daemon.prepareDeveloperReviewWorktree({
        repositoryRoot: root,
        challenge,
        expectedHeadTreeOid: gitOut(root, "rev-parse", "HEAD^{tree}"),
        tempRoot
      });
      expect(prepared.accepted).toBe(true);
      worktree = prepared.worktree;

      const passed = await daemon.runDeveloperReviewSession({
        challenge,
        worktree: worktree!,
        taskSessionId: "task_developer_review_detached"
      });

      expect(passed).toMatchObject({
        schemaVersion: "archcontext.developer-review-session/v1",
        challengeId: challenge.challengeId,
        taskSessionId: "task_developer_review_detached",
        reviewResult: "pass",
        attestationResult: "pass",
        summary: { errors: 0, warnings: 0, notices: 0 }
      });
      expect(passed.reviewDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(passed.digests.worktreeDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(provider.indexedRoots).toEqual([worktree!.worktreeRoot]);
      expect(store.reviews.get(passed.reviewId)).toMatchObject({
        schemaVersion: "archcontext.review/v1",
        reviewId: passed.reviewId,
        taskSessionId: "task_developer_review_detached",
        result: "pass"
      });

      const failed = await daemon.runDeveloperReviewSession({
        challenge,
        worktree: worktree!,
        taskSessionId: "task_developer_review_cleanup",
        cleanupRequired: 1,
        cleanupCompleted: 0
      });
      expect(failed.reviewResult).toBe("fail_action_required");
      expect(failed.attestationResult).toBe("fail");
      expect(store.reviews.get(failed.reviewId)).toMatchObject({ result: "fail_action_required" });
    } finally {
      if (worktree) removeDetachedReviewWorktree(worktree);
      await daemon?.stop().catch(() => undefined);
      rmSync(tempRoot, { recursive: true, force: true });
      removeTempRepo(root);
    }
  });

  test("developer review run lifecycle cleans temporary worktrees locks and CodeGraph state on success and failure", async () => {
    const root = createInitializedGitRepo();
    const tempRoot = mkdtempSync(join(tmpdir(), "archctx-runtime-review-lifecycle-"));
    const provider = new MockCodeGraphProvider();
    const store = new TestLocalStore();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    const successPaths: Record<string, string> = {};
    const failurePaths: Record<string, string> = {};
    try {
      daemon = await createStartedTestDaemon({ codeFacts: new CodeGraphAdapter(provider), localStore: store });
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const expectedHeadTreeOid = gitOut(root, "rev-parse", "HEAD^{tree}");
      const challenge = preparedChallenge(headSha);

      const passed = await daemon.withDeveloperReviewRun({
        repositoryRoot: root,
        challenge,
        expectedHeadTreeOid,
        tempRoot
      }, async (run) => {
        const codeGraphStateDir = join(run.runRoot, "codegraph-state");
        Object.assign(successPaths, {
          runRoot: run.runRoot,
          worktreeRoot: run.worktree.worktreeRoot,
          manifestPath: run.manifestPath,
          lockPath: run.lockPath,
          codeGraphStateFile: join(codeGraphStateDir, "state.db")
        });
        mkdirSync(codeGraphStateDir, { recursive: true });
        writeFileSync(successPaths.codeGraphStateFile, "temporary CodeGraph state\n", "utf8");
        return daemon!.runDeveloperReviewSession({
          challenge,
          worktree: run.worktree,
          taskSessionId: "task_developer_review_lifecycle"
        });
      });

      expect(passed.reviewResult).toBe("pass");
      expect(provider.indexedRoots).toEqual([successPaths.worktreeRoot]);
      for (const path of Object.values(successPaths)) expect(existsSync(path)).toBe(false);

      await expect(daemon.withDeveloperReviewRun({
        repositoryRoot: root,
        challenge,
        expectedHeadTreeOid,
        tempRoot
      }, async (run) => {
        Object.assign(failurePaths, {
          runRoot: run.runRoot,
          worktreeRoot: run.worktree.worktreeRoot,
          manifestPath: run.manifestPath,
          lockPath: run.lockPath
        });
        writeFileSync(join(run.worktree.worktreeRoot, "README.md"), "# dirty detached worktree\n", "utf8");
        return daemon!.runDeveloperReviewSession({
          challenge,
          worktree: run.worktree,
          taskSessionId: "task_developer_review_failure_cleanup"
        });
      })).rejects.toThrow("WORKTREE_NOT_CLEAN");

      for (const path of Object.values(failurePaths)) expect(existsSync(path)).toBe(false);
    } finally {
      await daemon?.stop().catch(() => undefined);
      rmSync(tempRoot, { recursive: true, force: true });
      removeTempRepo(root);
    }
  });

  test("developer review run recovery removes stale manifests and keeps active runs unless forced", async () => {
    const root = createInitializedGitRepo();
    const tempRoot = mkdtempSync(join(tmpdir(), "archctx-runtime-review-recovery-"));
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon();
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const challenge = preparedChallenge(headSha);
      const prepared = daemon.startDeveloperReviewRun({
        repositoryRoot: root,
        challenge,
        expectedHeadTreeOid: gitOut(root, "rev-parse", "HEAD^{tree}"),
        tempRoot
      });
      expect(prepared.accepted).toBe(true);
      const run = prepared.run!;
      expect(existsSync(run.worktree.worktreeRoot)).toBe(true);
      expect(existsSync(run.manifestPath)).toBe(true);
      expect(existsSync(run.lockPath)).toBe(true);

      const skipped = daemon.recoverDeveloperReviewRuns({ repositoryRoot: root });
      expect(skipped.skippedActive).toContain(run.runId);
      expect(skipped.recovered).toEqual([]);
      expect(existsSync(run.worktree.worktreeRoot)).toBe(true);

      const recovered = daemon.recoverDeveloperReviewRuns({ repositoryRoot: root, force: true });
      expectSameExistingPath(recovered.stateDir, defaultDeveloperReviewRunStateDir(realpathSync.native(root)));
      expect(recovered.recovered).toHaveLength(1);
      expect(recovered.recovered[0]).toMatchObject({
        runId: run.runId,
        challengeId: challenge.challengeId,
        cleaned: true
      });
      expect(recovered.recovered[0].removed).toEqual(expect.arrayContaining(["worktree", "run-root", "manifest", "lock"]));
      expect(existsSync(run.worktree.worktreeRoot)).toBe(false);
      expect(existsSync(run.runRoot)).toBe(false);
      expect(existsSync(run.manifestPath)).toBe(false);
      expect(existsSync(run.lockPath)).toBe(false);
    } finally {
      await daemon?.stop().catch(() => undefined);
      rmSync(tempRoot, { recursive: true, force: true });
      removeTempRepo(root);
    }
  });

  test("runtime RPC exposes Developer Review run start sign cleanup and recovery methods", async () => {
    const root = createInitializedGitRepo();
    const keyPair = generateKeyPairSync("ed25519");
    const keyRef = "keychain://archcontext/device/acct_rpc/key_rpc";
    const daemon = await createStartedTestDaemon({
      devicePrivateKeySigner: {
        signWithDevicePrivateKey(input) {
          expect(input.keyRef).toBe(keyRef);
          const payload = typeof input.payload === "string" ? input.payload : Buffer.from(input.payload).toString("utf8");
          return sign(null, Buffer.from(payload, "utf8"), keyPair.privateKey).toString("base64");
        }
      }
    });
    const rpc = new ArchctxRuntimeRpcServer(daemon, { root, port: 0, token: "developer-review-rpc-token" });
    let stopped = false;
    try {
      const connection = await rpc.start();
      const client = new RuntimeRpcClient(connection);
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const challenge = preparedChallenge(headSha);
      const prepared = await client.startDeveloperReviewRun({
        repositoryRoot: root,
        challenge,
        expectedHeadTreeOid: gitOut(root, "rev-parse", "HEAD^{tree}")
      });
      expect(prepared.accepted).toBe(true);
      expect(prepared.run?.worktree.headSha).toBe(headSha);

      const signed = await client.runSignedDeveloperReviewAttestation({
        challenge,
        worktree: prepared.run!.worktree,
        keyRef,
        principalId: "device_rpc",
        publicKeyId: "key_rpc",
        taskSessionId: "task_developer_review_rpc",
        startedAt: "2026-06-20T00:04:00.000Z",
        completedAt: "2026-06-20T00:05:00.000Z"
      });
      expect(signed.attestation.signature.value).not.toBe("");
      expect(signed.reviewSession.reviewResult).toBe("pass");

      const cleanup = await client.cleanupDeveloperReviewRun(prepared.run!);
      expect(cleanup.cleaned).toBe(true);
      expect(existsSync(prepared.run!.worktree.worktreeRoot)).toBe(false);

      const recovery = await client.recoverDeveloperReviewRuns({ repositoryRoot: root, force: true });
      expect(recovery.recovered).toEqual([]);

      await rpc.stop();
      stopped = true;
    } finally {
      if (!stopped) await rpc.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  });

  test("daemon signs canonical Attestation v2 without exposing Device private key material", async () => {
    const root = createInitializedGitRepo();
    const tempRoot = mkdtempSync(join(tmpdir(), "archctx-runtime-signed-attestation-"));
    const provider = new MockCodeGraphProvider();
    const store = new TestLocalStore();
    const keyPair = generateKeyPairSync("ed25519");
    const signedPayloads: string[] = [];
    const keyRef = "keychain://archcontext/device/acct_1/key_device_1";
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    let worktree: NonNullable<ReturnType<Awaited<ReturnType<typeof createStartedTestDaemon>>["prepareDeveloperReviewWorktree"]>["worktree"]> | undefined;
    try {
      daemon = await createStartedTestDaemon({
        codeFacts: new CodeGraphAdapter(provider),
        localStore: store,
        devicePrivateKeySigner: {
          signWithDevicePrivateKey(input) {
            expect(input.keyRef).toBe(keyRef);
            const payload = typeof input.payload === "string" ? input.payload : Buffer.from(input.payload).toString("utf8");
            signedPayloads.push(payload);
            return sign(null, Buffer.from(payload, "utf8"), keyPair.privateKey).toString("base64");
          }
        },
        clock: () => "2026-06-20T00:05:00.000Z"
      });
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const challenge = preparedChallenge(headSha);
      const prepared = daemon.prepareDeveloperReviewWorktree({
        repositoryRoot: root,
        challenge,
        expectedHeadTreeOid: gitOut(root, "rev-parse", "HEAD^{tree}"),
        tempRoot
      });
      expect(prepared.accepted).toBe(true);
      worktree = prepared.worktree;

      const signed = await daemon.runSignedDeveloperReviewAttestation({
        challenge,
        worktree: worktree!,
        keyRef,
        principalId: "device_1",
        publicKeyId: "key_device_1",
        taskSessionId: "task_signed_developer_review",
        startedAt: "2026-06-20T00:04:00.000Z",
        completedAt: "2026-06-20T00:05:00.000Z"
      });

      expect(signed).toMatchObject({
        schemaVersion: "archcontext.developer-review-attestation/v1",
        challengeId: challenge.challengeId,
        attestation: {
          schemaVersion: "archcontext.attestation/v2",
          challengeId: challenge.challengeId,
          installationId: challenge.installationId,
          repositoryId: challenge.repositoryId,
          pullRequestNumber: challenge.pullRequestNumber,
          headSha,
          baseSha: challenge.baseSha,
          mergeBaseSha: challenge.baseSha,
          result: "pass",
          execution: {
            trustLevel: "developer",
            source: "clean-commit-worktree",
            principalId: "device_1",
            publicKeyId: "key_device_1"
          },
          nonce: challenge.nonce,
          startedAt: "2026-06-20T00:04:00.000Z",
          completedAt: "2026-06-20T00:05:00.000Z",
          expiresAt: challenge.expiresAt
        }
      });
      expect(signed.reviewSession.reviewDigest).toBe(signed.attestation.reviewDigest);
      expect(signed.attestation.worktreeDigest).toBe(signed.reviewSession.digests.worktreeDigest);
      expect(signed.attestation.modelDigest).toBe(signed.reviewSession.digests.modelDigest);
      expect(signed.attestation.policyDigest).toBe(signed.reviewSession.digests.policyDigest);
      expect(signed.attestation.codeFactsDigest).toBe(signed.reviewSession.digests.codeFactsDigest);
      expect(signed.attestation.signature).toMatchObject({ algorithm: "ed25519" });
      expect(signed.attestation.signature.value).not.toBe("");
      expect(signed.attestationDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(signed.signingPayloadDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(signedPayloads).toEqual([canonicalAttestationV2(signed.attestation)]);
      expect(verify(null, Buffer.from(canonicalAttestationV2(signed.attestation), "utf8"), keyPair.publicKey, Buffer.from(signed.attestation.signature.value, "base64"))).toBe(true);
      expect(JSON.stringify(signed)).not.toContain(keyRef);
      expect(JSON.stringify(signed)).not.toContain("PRIVATE KEY");
      expect(store.reviews.get(signed.reviewSession.reviewId)).toMatchObject({ result: "pass" });

      await expect(daemon.runSignedDeveloperReviewAttestation({
        challenge,
        worktree: worktree!,
        keyRef,
        principalId: "device_1",
        publicKeyId: "key_device_1",
        signature: { algorithm: "ed25519", value: "forged" }
      } as any)).rejects.toThrow("developer-review-attestation-caller-provided-attestation-field-forbidden: signature");
    } finally {
      if (worktree) removeDetachedReviewWorktree(worktree);
      await daemon?.stop().catch(() => undefined);
      rmSync(tempRoot, { recursive: true, force: true });
      removeTempRepo(root);
    }
  });

  test("runtime-owned complete task computes digests and rejects caller-provided attestation fields", async () => {
    const root = createInitializedGitRepo();
    const provider = new MockCodeGraphProvider();
    const store = new TestLocalStore();
    let daemon: Awaited<ReturnType<typeof createStartedTestDaemon>> | undefined;
    try {
      daemon = await createStartedTestDaemon({ codeFacts: new CodeGraphAdapter(provider), localStore: store });
      const headSha = gitOut(root, "rev-parse", "HEAD");
      const passed = await daemon.completeTask(root, {
        taskSessionId: "task_runtime_complete",
        headSha
      });
      expect(passed.ok).toBe(true);
      expect((passed.data as any)).toMatchObject({
        schemaVersion: "archcontext.review/v1",
        taskSessionId: "task_runtime_complete",
        result: "pass"
      });
      expect(provider.indexedRoots.map((indexedRoot) => normalizeExistingPath(indexedRoot))).toEqual([normalizeExistingPath(root)]);
      expect(store.reviews.get((passed.data as any).reviewId)).toMatchObject({ result: "pass" });

      await expect(daemon.completeTask(root, {
        taskSessionId: "task_runtime_forged",
        headSha,
        result: "pass"
      } as any)).rejects.toThrow("complete-task-caller-provided-attestation-field-forbidden: result");
      await expect(daemon.completeTask(root, {
        taskSessionId: "task_runtime_forged_model",
        headSha,
        modelDigest: `sha256:${"a".repeat(64)}`
      } as any)).rejects.toThrow("complete-task-caller-provided-attestation-field-forbidden: modelDigest");
    } finally {
      await daemon?.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  });

  test("runtime RPC server is loopback, versioned, token-gated, and single-locked", async () => {
    const root = tempRepo();
    const daemon = await createStartedTestDaemon();
    const rpc = new ArchctxRuntimeRpcServer(daemon, {
      root,
      port: 0,
      token: "runtime-test-token",
      clock: () => "2026-06-20T00:00:00.000Z"
    });
    let stopped = false;
    try {
      const connection = await rpc.start();
      expect(connection.url.startsWith("http://127.0.0.1:")).toBe(true);
      expect(connection.schemaVersion).toBe(RUNTIME_RPC_VERSION);
      expect(existsSync(connection.connectionPath)).toBe(true);
      expect(existsSync(connection.lockPath)).toBe(true);
      if (process.platform !== "win32") {
        expect(statSync(connection.connectionPath).mode & 0o777).toBe(0o600);
        expect(statSync(connection.lockPath).mode & 0o777).toBe(0o600);
      }

      const health = await fetch(`${connection.url}health`, {
        headers: { "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION }
      });
      expect(health.status).toBe(200);
      const healthBody = await health.json() as any;
      expect(healthBody.schemaVersion).toBe(RUNTIME_RPC_VERSION);
      expect(healthBody.product.runtime.localRpc.schemaVersion).toBe(RUNTIME_RPC_VERSION);
      expect(healthBody.product.surfaces.daemon.rpcSchemaVersion).toBe(RUNTIME_RPC_VERSION);

      const mismatchedHealth = await fetch(`${connection.url}health`, {
        headers: { "X-ArchContext-RPC-Version": "archcontext.runtime-rpc/v0" }
      });
      expect(mismatchedHealth.status).toBe(426);
      expect((await mismatchedHealth.json() as any).expected).toBe(RUNTIME_RPC_VERSION);

      const denied = await fetch(`${connection.url}rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method: "runtimeStatus", params: [root] })
      });
      expect(denied.status).toBe(401);

      const mismatchedRpc = await fetch(`${connection.url}rpc`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${connection.token}`,
          "Content-Type": "application/json",
          "X-ArchContext-RPC-Version": "archcontext.runtime-rpc/v0"
        },
        body: JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method: "runtimeStatus", params: [root] })
      });
      expect(mismatchedRpc.status).toBe(426);

      const clientA = new RuntimeRpcClient(connection);
      const init = await clientA.init(root, "RPC App");
      expect(init.ok).toBe(true);
      const clientB = new RuntimeRpcClient(connection);
      const status = await clientB.runtimeStatus(root);
      expect((status.data as any).sessions).toBe(1);
      expect((status.data as any).repositoryId).toBe(repositoryFingerprint(root));

      const lockedDaemon = await createStartedTestDaemon();
      const locked = new ArchctxRuntimeRpcServer(lockedDaemon, { root, port: 0, token: "other-token" });
      await expect(locked.start()).rejects.toThrow("already running");
      await lockedDaemon.stop();

      await rpc.stop();
      stopped = true;
      expect(existsSync(connection.connectionPath)).toBe(false);
      expect(existsSync(connection.lockPath)).toBe(false);
    } finally {
      if (!stopped) await rpc.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  });

  test("production composition root uses real adapters and rejects injected runtime doubles", async () => {
    const root = tempRepo();
    try {
      const daemon = await createStartedProductionDaemon({ root });
      expect(daemon.compositionReport()).toMatchObject({
        mode: "production",
        productionSafe: true,
        adapters: {
          codeFacts: "codegraph-cli",
          codeGraphProviderFactory: "codegraph-cli",
          modelStore: "yaml",
          localStore: "sqlite",
          changeSetEngine: "default"
        }
      });
      await daemon.stop();

      const codeFacts = new CodeGraphAdapter(new MockCodeGraphProvider());
      expect(() => assertProductionRuntimeDeps({ codeFacts })).toThrow("codeFacts");
      expect(() => assertProductionRuntimeDeps({ codeGraphProviderFactory: () => new MockCodeGraphProvider() })).toThrow("codeGraphProviderFactory");
      expect(() => assertProductionRuntimeDeps({ localStore: new TestLocalStore() })).toThrow("localStore");
      expect(() => assertProductionRuntimeDeps({ clock: () => "2026-06-20T00:00:00.000Z" })).toThrow("clock");
    } finally {
      removeTempRepo(root);
    }
  });

  test("runtime RPC ignores insecure connection files and recovers stale locks", async () => {
    const root = tempRepo();
    const connectionPath = defaultDaemonConnectionPath(root);
    const lockPath = defaultDaemonLockPath(root);
    mkdirSync(join(root, ".archcontext/.local"), { recursive: true });
    writeFileSync(connectionPath, JSON.stringify({
      schemaVersion: RUNTIME_RPC_VERSION,
      protocol: "http-loopback",
      version: 1,
      root,
      url: "http://127.0.0.1:1/",
      token: "leaky-token",
      pid: process.pid,
      lockPath,
      connectionPath,
      startedAt: "2026-06-20T00:00:00.000Z"
    }, null, 2), { mode: 0o600 });
    if (process.platform === "win32") {
      expect(readRuntimeRpcConnection(root)?.token).toBe("leaky-token");
    } else {
      chmodSync(connectionPath, 0o644);
      expect(readRuntimeRpcConnection(root)).toBeUndefined();
    }
    const insecureRecovery = recoverStaleDaemonControlFiles(root);
    if (process.platform !== "win32") {
      expect(insecureRecovery.removed).toContain("insecure-connection-file");
      expect(existsSync(connectionPath)).toBe(false);
    } else {
      expect(insecureRecovery.removed).not.toContain("insecure-connection-file");
      rmSync(connectionPath, { force: true });
    }

    writeFileSync(lockPath, JSON.stringify({ pid: -1, root, startedAt: "2026-06-20T00:00:00.000Z" }, null, 2), { mode: 0o600 });
    const staleLockRecovery = recoverStaleDaemonControlFiles(root);
    expect(staleLockRecovery.removed).toContain("stale-lock-file");
    expect(existsSync(lockPath)).toBe(false);
    writeFileSync(lockPath, JSON.stringify({ pid: -1, root, startedAt: "2026-06-20T00:00:00.000Z" }, null, 2), { mode: 0o600 });
    const daemon = await createStartedTestDaemon();
    const rpc = new ArchctxRuntimeRpcServer(daemon, { root, port: 0, token: "stale-lock-token" });
    let stopped = false;
    try {
      const connection = await rpc.start();
      expect(connection.lockPath).toBe(lockPath);
      expect(JSON.parse(readFileSync(lockPath, "utf8")).pid).toBe(process.pid);
      expect(readRuntimeRpcConnection(root)?.token).toBe("stale-lock-token");
      await rpc.stop();
      stopped = true;
    } finally {
      if (!stopped) await rpc.stop().catch(() => undefined);
      removeTempRepo(root);
    }
  });

  test("CodeGraph adapter is version/capability checked and blocks internal storage access", async () => {
    delete process.env.DO_NOT_TRACK;
    const provider = new MockCodeGraphProvider();
    const adapter = new CodeGraphAdapter(provider);
    expect(String(process.env.DO_NOT_TRACK)).toBe("1");
    await expect(adapter.ensureReady({ root: "/tmp/repo", repositoryId: "repo.test", headSha: "abc" })).resolves.toMatchObject({
      provider: "codegraph",
      version: REQUIRED_CODEGRAPH_VERSION
    });

    provider.version = "0.0.0";
    await expect(adapter.sync({ workspace: { root: "/tmp/repo", repositoryId: "repo.test", headSha: "abc" } })).rejects.toThrow("required");
    expect(() => assertNoCodeGraphInternalPathAccess(".codegraph/state.db")).toThrow();
  });

  test("multi-repo sessions use LRU and landscape context stays local", async () => {
    const first = tempRepo();
    const second = tempRepo();
    const third = tempRepo();
    try {
      const daemon = await createStartedTestDaemon({ maxRepoSessions: 2 });
      const addedFirst = await daemon.repoAdd(first, "web");
      const addedSecond = await daemon.repoAdd(second, "api");
      const firstRepo = (addedFirst.data as any).repository.repositoryId;
      const secondRepo = (addedSecond.data as any).repository.repositoryId;
      await daemon.repoAdd(third, "worker");

      expect(daemon.status().sessions).toBe(2);
      expect(daemon.status().repositories).not.toContain(firstRepo);

      const list = await daemon.repoList();
      expect((list.data as any).repositories.map((repo: any) => repo.repositoryId)).toEqual([
        firstRepo,
        secondRepo,
        repositoryFingerprint(third)
      ].sort());

      const context = await daemon.contextLandscape("change api used by web", 4);
      expect(context.ok).toBe(true);
      expect((context.data as any).extensions.landscapeDigest).toMatch(/^sha256:/);
      expect(JSON.stringify(context.data)).not.toContain("archcontextSyncService\":\"allowed");
    } finally {
      removeTempRepo(first);
      removeTempRepo(second);
      removeTempRepo(third);
    }
  });

  test("Explorer loopback service is token-gated, read-only, and revocable", async () => {
    const root = tempRepo();
    try {
      const daemon = await createStartedTestDaemon({ clock: () => "2026-06-20T00:00:00.000Z" });
      await daemon.init(root, "Explorer App");
      const started = await daemon.startExplorer(root, { port: 0, tokenTtlSeconds: 60 });
      expect(started.ok).toBe(true);
      const data = started.data as any;
      expect(data.host).toBe("127.0.0.1");
      expect(data.readOnly).toBe(true);

      const projectionDenied = await fetch(`${data.url}projection`);
      expect(projectionDenied.status).toBe(401);

      const projectionWrite = await fetch(`${data.url}projection`, {
        method: "POST",
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(projectionWrite.status).toBe(405);

      const projection = await fetch(`${data.url}projection`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(projection.status).toBe(200);
      const body = await projection.json() as any;
      expect(body.data.schemaVersion).toBe("archcontext.explorer-projection/v1");
      expect(body.data.capabilities).toMatchObject({ readOnly: true, mutationMode: "forbidden", egress: "none" });
      expect(JSON.stringify(body.data)).not.toContain("sourceBody");

      const rootProjection = await fetch(`${data.url}?token=${data.token}`);
      expect((await rootProjection.json() as any).data.schemaVersion).toBe("archcontext.explorer-projection/v1");

      await daemon.revokeExplorerToken();
      const revoked = await fetch(`${data.url}projection`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      expect(revoked.status).toBe(401);
      await daemon.stopExplorer();
      expect((daemon.explorerStatus().data as any).running).toBe(false);
    } finally {
      removeTempRepo(root);
    }
  });
});

function createGitRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-runtime-git-"));
  writeFileSync(join(root, "README.md"), "# fixture\n", "utf8");
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["add", "."], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  return root;
}

function createInitializedGitRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-runtime-initialized-git-"));
  writeFileSync(join(root, "README.md"), "# fixture\n", "utf8");
  initializeArchContextModel(root, "Digest App");
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["add", "."], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  return root;
}

function gitOut(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function preparedChallenge(headSha: string) {
  return {
    schemaVersion: "archcontext.review-challenge/v2" as const,
    challengeId: "chal_runtime_worktree",
    installationId: 123,
    repositoryId: 456,
    pullRequestNumber: 7,
    headSha,
    baseSha: headSha,
    nonce: "nonce_runtime_worktree",
    requiredTrust: "developer" as const,
    policyProfileId: "policy.default",
    createdAt: "2026-06-20T00:00:00.000Z",
    expiresAt: "2026-06-20T00:15:00.000Z",
    status: "LEASED" as const
  };
}
