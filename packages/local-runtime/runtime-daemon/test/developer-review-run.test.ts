import { afterAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { realpathSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { ARCHCONTEXT_PRODUCT_VERSION, canonicalAttestationV2 } from "@archcontext/contracts";
import { CodeGraphAdapter, REQUIRED_CODEGRAPH_VERSION } from "@archcontext/local-runtime/codegraph-adapter";
import { removeDetachedReviewWorktree } from "@archcontext/local-runtime/git-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { ArchctxRuntimeRpcServer, RUNTIME_RPC_VERSION, RuntimeRpcClient, defaultDeveloperReviewRunStateDir } from "../src/index";
import { expectSameExistingPath, createGitRepo, createInitializedGitRepo, gitOut, rmSync, removeTempRepo, removeTempPath, readText, createStartedTestDaemon } from "./runtime-test-fixtures";

const PREVIOUS_ARCHCONTEXT_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const RUNTIME_TEST_STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-review-run-state-"));
const DEVELOPER_REVIEW_TEST_TIMEOUT_MS = process.platform === "win32" ? 30_000 : 5_000;
process.env.ARCHCONTEXT_STATE_DIR = RUNTIME_TEST_STATE_ROOT;
afterAll(() => {
  if (PREVIOUS_ARCHCONTEXT_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_ARCHCONTEXT_STATE_DIR;
  rmSync(RUNTIME_TEST_STATE_ROOT, { recursive: true, force: true });
});

describe("developer review run lifecycle", () => {
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
      expect(readText(join(worktree!.worktreeRoot, "README.md"))).toBe("# fixture\n");
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
      removeTempPath(tempRoot);
      removeTempRepo(root);
    }
  }, DEVELOPER_REVIEW_TEST_TIMEOUT_MS);

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
          version: ARCHCONTEXT_PRODUCT_VERSION,
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
      removeTempPath(tempRoot);
      removeTempRepo(root);
    }
  }, DEVELOPER_REVIEW_TEST_TIMEOUT_MS);

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

      const cleanup = await client.cleanupDeveloperReviewRun({
        repositoryRoot: prepared.run!.sourceRoot,
        challengeId: prepared.run!.challengeId,
        runId: prepared.run!.runId
      });
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

  // Cleanup/recovery delete real filesystem paths, so a caller-supplied manifest must never be
  // able to name the deletion target: every target is re-derived from daemon-owned state and
  // proven with an ownership marker before anything is unlinked.
  test("developer review cleanup refuses deletion targets outside daemon-owned review roots", async () => {
    const root = createInitializedGitRepo();
    const tempRoot = mkdtempSync(join(tmpdir(), "archctx-runtime-review-ownership-"));
    const outside = mkdtempSync(join(tmpdir(), "archctx-not-an-archctx-run-"));
    const victim = join(outside, "important.txt");
    writeFileSync(victim, "unrelated\n", "utf8");
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
      expect(existsSync(join(run.runRoot, ".archctx-developer-review-run.json"))).toBe(true);

      const detachedRunRoot = (runRoot: string) => ({
        ...run,
        status: "preparing" as const,
        worktree: undefined,
        runRoot,
        worktreeTempRoot: join(runRoot, "worktrees"),
        codeGraphTemporaryState: { root: runRoot, cleanup: "remove-run-root" as const }
      });

      // A conventionally named but absent run root must not turn the caller's manifest into
      // authority for the real challenge control files.
      const absentImpostorRunRoot = join(tempRoot, basename(run.runRoot).replace(/.{6}$/, "cccccc"));
      expect(existsSync(absentImpostorRunRoot)).toBe(false);
      expect(() => daemon!.cleanupOwnedDeveloperReviewRun(detachedRunRoot(absentImpostorRunRoot)))
        .toThrow("developer-review-run-not-owned");
      expect(existsSync(run.manifestPath)).toBe(true);
      expect(existsSync(run.lockPath)).toBe(true);

      // Absolute escape: an unrelated directory is not a review run root.
      expect(() => daemon!.cleanupOwnedDeveloperReviewRun(detachedRunRoot(outside)))
        .toThrow("developer-review-run-not-owned");
      // `..` traversal that lands outside the daemon temp parent.
      expect(() => daemon!.cleanupOwnedDeveloperReviewRun(detachedRunRoot(join(run.runRoot, "..", "..", basename(outside)))))
        .toThrow("developer-review-run-not-owned");
      // Manifest/lock are derived from the repository state dir, so a caller-named file is rejected.
      expect(() => daemon!.cleanupOwnedDeveloperReviewRun({ ...run, manifestPath: victim }))
        .toThrow("developer-review-run-not-owned");
      expect(() => daemon!.cleanupOwnedDeveloperReviewRun({ ...run, lockPath: victim }))
        .toThrow("developer-review-run-not-owned");
      expect(() => daemon!.cleanupOwnedDeveloperReviewRun({ ...run, manifestPath: join(run.manifestPath, "..", "..", "escaped.json") }))
        .toThrow("developer-review-run-not-owned");

      // A directory that merely looks like a run root carries no ownership marker.
      const impostorRunRoot = join(tempRoot, basename(run.runRoot).replace(/.{6}$/, "bbbbbb"));
      mkdirSync(impostorRunRoot, { recursive: true });
      expect(() => daemon!.cleanupOwnedDeveloperReviewRun(detachedRunRoot(impostorRunRoot)))
        .toThrow("developer-review-run-not-owned");
      expect(existsSync(impostorRunRoot)).toBe(true);

      if (process.platform !== "win32") {
        const symlinkedRunRoot = join(tempRoot, basename(run.runRoot).replace(/.{6}$/, "aaaaaa"));
        symlinkSync(outside, symlinkedRunRoot);
        expect(() => daemon!.cleanupOwnedDeveloperReviewRun(detachedRunRoot(symlinkedRunRoot)))
          .toThrow("developer-review-run-not-owned");
      }

      // None of the rejected requests touched anything.
      expect(existsSync(victim)).toBe(true);
      expect(existsSync(run.runRoot)).toBe(true);
      expect(existsSync(run.manifestPath)).toBe(true);
      expect(existsSync(run.lockPath)).toBe(true);

      const cleanup = daemon.cleanupOwnedDeveloperReviewRun(run);
      expect(cleanup.cleaned).toBe(true);
      expect(cleanup.removed).toEqual(expect.arrayContaining(["worktree", "run-root", "manifest", "lock"]));
      expect(existsSync(run.runRoot)).toBe(false);
      expect(existsSync(run.manifestPath)).toBe(false);
      expect(existsSync(run.lockPath)).toBe(false);
      expect(existsSync(victim)).toBe(true);
    } finally {
      await daemon?.stop().catch(() => undefined);
      rmSync(tempRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
      removeTempRepo(root);
    }
  }, DEVELOPER_REVIEW_TEST_TIMEOUT_MS);

  test("runtime RPC rejects caller-selected developer review roots and malformed manifests", async () => {
    const root = createInitializedGitRepo();
    const outside = mkdtempSync(join(tmpdir(), "archctx-not-an-archctx-state-"));
    writeFileSync(join(outside, "stale.json"), "{ not json", "utf8");
    writeFileSync(join(outside, "stale.lock"), JSON.stringify({ pid: 999999999 }), "utf8");
    const daemon = await createStartedTestDaemon();
    const rpc = new ArchctxRuntimeRpcServer(daemon, { root, port: 0, token: "developer-review-ownership-token" });
    try {
      const connection = await rpc.start();
      const challenge = preparedChallenge(gitOut(root, "rev-parse", "HEAD"));
      const rpcCall = async (method: string, params: unknown[]) => {
        const response = await fetch(`${connection.url}rpc`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${connection.token}`,
            "Content-Type": "application/json",
            "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION
          },
          body: JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method, params })
        });
        return { status: response.status, body: await response.json() as any };
      };

      const recovered = await rpcCall("recoverDeveloperReviewRuns", [{ repositoryRoot: root, stateDir: outside, force: true }]);
      expect(recovered.body.ok).toBe(false);
      expect(String(recovered.body.error)).toContain("runtime-rpc-input-invalid");
      expect(existsSync(join(outside, "stale.json"))).toBe(true);
      expect(existsSync(join(outside, "stale.lock"))).toBe(true);

      const started = await rpcCall("startDeveloperReviewRun", [{ repositoryRoot: root, challenge, tempRoot: outside }]);
      expect(started.body.ok).toBe(false);
      expect(String(started.body.error)).toContain("runtime-rpc-input-invalid");

      const malformed = await rpcCall("cleanupDeveloperReviewRun", [{
        schemaVersion: "archcontext.developer-review-run/v1",
        runId: "forged",
        challengeId: challenge.challengeId
      }]);
      expect(malformed.body.ok).toBe(false);
      expect(String(malformed.body.error)).toContain("runtime-rpc-input-invalid");

      const wrongChallengeShape = await rpcCall("startDeveloperReviewRun", [{
        repositoryRoot: root,
        challenge: { ...challenge, status: "NOT_A_STATUS" }
      }]);
      expect(wrongChallengeShape.body.ok).toBe(false);
      expect(String(wrongChallengeShape.body.error)).toContain("runtime-rpc-input-invalid");
    } finally {
      await rpc.stop().catch(() => undefined);
      rmSync(outside, { recursive: true, force: true });
      removeTempRepo(root);
    }
  }, DEVELOPER_REVIEW_TEST_TIMEOUT_MS);

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

});

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

