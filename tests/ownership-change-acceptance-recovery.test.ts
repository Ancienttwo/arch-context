import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { canonicalRepositoryRoot, computeWorktreeDigest, repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { architectureDocumentationProjectionWorktreeDigest, loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { ArchctxRuntimeRpcServer, RUNTIME_RPC_VERSION, createStartedDaemon, type RuntimeDaemonClient } from "@archcontext/local-runtime/runtime-daemon";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { digestJson, stableYaml, type AcceptedArchitectureChangeReferenceV1, type ProjectionApplyReceiptV1, type ProjectionRequestV1, type ProjectionResultV2 } from "@archcontext/contracts";
import { runCli } from "../packages/surfaces/cli/src/main";

const timeout = process.platform === "win32" ? 240_000 : 30_000;

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function gitOut(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function stateRoot(root: string): string {
  return join(dirname(root), `.archctx-state-${basename(root)}`);
}

function runtimePaths(root: string) {
  const previous = process.env.ARCHCONTEXT_STATE_DIR;
  process.env.ARCHCONTEXT_STATE_DIR = stateRoot(root);
  return {
    localStorePath: join(stateRoot(root), "local-store.sqlite"),
    restore() {
      if (previous === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
      else process.env.ARCHCONTEXT_STATE_DIR = previous;
    }
  };
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

async function runTestCli(command: string, args: string[], root: string, runtimeClient?: RuntimeDaemonClient) {
  return withTestCli(root, () => runCli(command, args, root, {
    ...(runtimeClient ? { runtimeClient } : {}),
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider()
  }));
}

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-recovery-race-"));
  writeFileSync(join(root, "README.md"), "# recovery fixture\n", "utf8");
  initializeArchContextModel(root, "Recovery Fixture");
  git(root, "init");
  git(root, "config", "user.name", "ArchContext Test");
  git(root, "config", "user.email", "archcontext@example.test");
  git(root, "add", ".");
  git(root, "commit", "-m", "fixture");
  return root;
}

async function prepareAcceptedMajorChange(root: string, options: { codeGraphReady?: boolean } = {}) {
  const nodePath = join(root, ".archcontext/model/nodes/capability.runtime-harness.hook-adapters.yaml");
  const modulePath = join(root, "docs/architecture/modules/runtime-harness/hook-adapters.md");
  rmSync(join(root, ".archcontext/model/nodes/capability.architecture-context.yaml"), { force: true });
  writeFileSync(nodePath, stableYaml({
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
    rationale: "Recovery fixture."
  }), "utf8");
  mkdirSync(dirname(modulePath), { recursive: true });
  writeFileSync(modulePath, "# runtime-harness/hook-adapters\n\n## 1. Old P1\nlegacy\n\n## 2. Old P2\nlegacy flow\n\n## 3. P3 Decisions\nhuman decision  \n\n## 4. History\nhuman history\n", "utf8");
  if (options.codeGraphReady) {
    execFileSync("codegraph", ["init", root], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  }

  const preview = await runTestCli("docs", ["adopt", "--profile", "repo-harness/v1"], root);
  expect(preview.ok, JSON.stringify(preview)).toBe(true);
  const adopted = await runTestCli("docs", [
    "adopt", "--profile", "repo-harness/v1", "--approved",
    "--adoption-plan-id", (preview.data as any).adoptionPlanId,
    "--expected-worktree-digest", computeWorktreeDigest(root)
  ], root);
  expect(adopted.ok, JSON.stringify(adopted)).toBe(true);
  const clean = await runTestCli("docs", ["apply", "--profile", "repo-harness/v1", "--approved"], root);
  expect(clean.ok, JSON.stringify(clean)).toBe(true);

  writeFileSync(nodePath, readFileSync(nodePath, "utf8").replace("Routes runtime hook events.", "Routes and validates runtime hook events."), "utf8");
  const planned = await runTestCli("docs", ["plan", "--profile", "repo-harness/v1"], root);
  expect(planned.ok, JSON.stringify(planned)).toBe(true);
  const expected = (planned.data as any).provenance;
  const acceptedChange = {
    changeSetId: "changeset.hook-adapters-major",
    eventId: "architecture_event.hook-adapters-major",
    reasonCodes: ["responsibility-changed"],
    affectedNodeIds: ["capability.runtime-harness.hook-adapters"]
  } satisfies AcceptedArchitectureChangeReferenceV1;
  const request: ProjectionRequestV1 = {
    schemaVersion: "archcontext.projection-request/v1",
    requestId: "projection_request.recovery_race_apply",
    profile: "repo-harness/v1",
    mode: "apply",
    targets: ["agent-context", "architecture-docs"],
    changedPaths: [".archcontext/model/nodes/capability.runtime-harness.hook-adapters.yaml"],
    acceptedChange,
    expected: {
      repositoryId: repositoryFingerprint(root),
      workspaceId: `workspace.${digestJson({ root: canonicalRepositoryRoot(root) } as any).replace(/^sha256:/, "").slice(0, 16)}`,
      headSha: gitOut(root, "rev-parse", "HEAD"),
      worktreeDigest: expected.worktreeDigest
    }
  };
  return { nodePath, request };
}

function recoveryIntentFromReceipt(receipt: ProjectionApplyReceiptV1, requestId: string) {
  return {
    schemaVersion: "archcontext.projection-apply-recovery-intent/v1",
    requestId,
    profile: "repo-harness/v1",
    receipt: {
      lookupKey: receipt.identity.lookupKey,
      applyId: receipt.identity.applyId
    }
  };
}

test("semantic recovery delivers a raced accepted apply only after every immutable and current-state binding proves clean", async () => {
  const root = createFixture();
  const paths = runtimePaths(root);
  const daemon = await createStartedDaemon({
    localStorePath: paths.localStorePath,
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider()
  });
  let rpcServer: ArchctxRuntimeRpcServer | undefined;
  try {
    const { nodePath, request } = await prepareAcceptedMajorChange(root, { codeGraphReady: true });
    const readmePath = join(root, "README.md");
    const originalReadme = readFileSync(readmePath, "utf8");
    let applyCalls = 0;
    const racingClient = new Proxy(daemon, {
      get(target, property, receiver) {
        if (property === "applyUpdate") {
          return async (...args: Parameters<RuntimeDaemonClient["applyUpdate"]>) => {
            applyCalls += 1;
            const result = await target.applyUpdate(...args);
            if (applyCalls === 1 && result.ok) writeFileSync(join(root, "README.md"), "# concurrent non-owned mutation\n", "utf8");
            return result;
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      }
    }) as RuntimeDaemonClient;
    const raced = await runTestCli("projection", ["run", "--request-json", JSON.stringify(request)], root, racingClient);
    expect(raced.ok, JSON.stringify(raced)).toBe(true);
    expect(raced.data as ProjectionResultV2).toMatchObject({ status: "applied-reconcile-required", refreshSignals: [] });
    const lookupKey = (raced.data as ProjectionResultV2).applyReceipt!.lookupKey;
    const inspected = await daemon.inspectProjectionApplyReceipt(root, lookupKey);
    expect(inspected).toMatchObject({ ok: true, data: { found: true, deliveryStatus: "pending" } });
    const committedReceipt = (inspected.data as any).receipt;
    const recoveryIntent = (requestId: string) => recoveryIntentFromReceipt(committedReceipt, requestId);

    // An ordinary apply refuses an outstanding receipt; it cannot silently turn a stale retry into
    // recovery, even when its caller refreshes the expected worktree snapshot.
    writeFileSync(nodePath, readFileSync(nodePath, "utf8").replace("Routes and validates runtime hook events.", "Routes, validates, and retries runtime hook events."), "utf8");
    const retry = await runTestCli("projection", ["run", "--request-json", JSON.stringify({
      ...request,
      requestId: "projection_request.recovery_race_semantic_drift",
      expected: {
        ...request.expected,
        worktreeDigest: architectureDocumentationProjectionWorktreeDigest(root, loadNativeModelFromArchContext(root))
      }
    })], root, racingClient);

    expect(retry.ok, "semantic recovery proof must reject drift before receipt consumption").toBe(false);
    expect((retry as any).error).toMatchObject({ code: "AC_PRECONDITION_FAILED" });
    expect(applyCalls).toBe(1);

    const semanticDrift = await runTestCli("projection", ["recover", "--request-json", JSON.stringify(recoveryIntent("projection_request.recovery_semantic_drift"))], root, racingClient);
    expect(semanticDrift.ok, "recovery must rebuild the current fixed point before receipt consumption").toBe(false);
    expect((semanticDrift as any).error).toMatchObject({ code: "AC_PRECONDITION_FAILED" });
    expect(await daemon.inspectProjectionApplyReceipt(root, lookupKey)).toMatchObject({ ok: true, data: { deliveryStatus: "pending" } });

    writeFileSync(nodePath, readFileSync(nodePath, "utf8").replace("Routes, validates, and retries runtime hook events.", "Routes and validates runtime hook events."), "utf8");
    const flowPath = join(root, ".archcontext/model/flows/flow.hook-adapters.yaml");
    const originalFlow = readFileSync(flowPath, "utf8");
    writeFileSync(flowPath, originalFlow.replace("Recovery fixture.", "Recovery fixture changed after approval."), "utf8");
    const flowDrift = await runTestCli("projection", ["recover", "--request-json", JSON.stringify(recoveryIntent("projection_request.recovery_flow_drift"))], root, racingClient);
    expect(flowDrift.ok, "flow-proof drift must reject before receipt consumption").toBe(false);
    expect((flowDrift as any).error).toMatchObject({ code: "AC_PRECONDITION_FAILED" });
    expect(await daemon.inspectProjectionApplyReceipt(root, lookupKey)).toMatchObject({ ok: true, data: { deliveryStatus: "pending" } });
    writeFileSync(flowPath, originalFlow, "utf8");
    writeFileSync(readmePath, originalReadme, "utf8");
    const matchingRequest = recoveryIntent("projection_request.recovery_exact");
    rpcServer = new ArchctxRuntimeRpcServer(daemon, {
      root,
      token: "recovery-authority-bypass-token",
      connectionPath: join(stateRoot(root), "authority-bypass-rpc.json"),
      lockPath: join(stateRoot(root), "authority-bypass-rpc.lock")
    });
    const connection = await rpcServer.start();
    const rawRpc = async (method: string, params: unknown[]) => {
      const response = await fetch(new URL("rpc", connection.url), {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${connection.token}`,
          "Content-Type": "application/json",
          "X-ArchContext-RPC-Version": RUNTIME_RPC_VERSION
        },
        body: JSON.stringify({ schemaVersion: RUNTIME_RPC_VERSION, method, params })
      });
      return await response.json() as any;
    };
    const rawDirectDelivery = await rawRpc("deliverProjectionApplyReceiptDirect", [root, {
      lookupKey,
      applyId: committedReceipt.identity.applyId,
      expectedWorktreeDigest: request.expected.worktreeDigest
    }]);
    expect(rawDirectDelivery).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
    const rawForgedProof = await rawRpc("recoverProjectionApply", [root, {
      schemaVersion: "archcontext.projection-apply-recovery-proof/v1",
      requestId: "projection_request.forged_proof",
      requestDigest: `sha256:${"a".repeat(64)}`,
      proofDigest: `sha256:${"b".repeat(64)}`,
      deliveryStatus: "delivered",
      receipt: {
        lookupKey,
        applyId: committedReceipt.identity.applyId,
        receiptDigest: committedReceipt.result.receiptDigest
      },
      acceptedChange: {
        ...committedReceipt.identity.acceptedChange,
        eventId: "architecture_event.forged"
      },
      expectedResultingDigests: committedReceipt.recovery.expectedResultingDigests,
      current: { snapshot: request.expected, resultingDigests: committedReceipt.recovery.expectedResultingDigests, ownedOutputDigest: committedReceipt.recovery.ownedOutputDigest, fixedPointDigest: `sha256:${"c".repeat(64)}` }
    }]);
    expect(rawForgedProof).toMatchObject({ ok: false, error: { code: "AC_SCHEMA_INVALID" } });
    expect(await daemon.inspectProjectionApplyReceipt(root, lookupKey)).toMatchObject({ ok: true, data: { deliveryStatus: "pending" } });
    const mismatchRequests = [
      { ...matchingRequest, receipt: { ...matchingRequest.receipt, lookupKey: `sha256:${"f".repeat(64)}` } },
      { ...matchingRequest, receipt: { ...matchingRequest.receipt, applyId: `sha256:${"e".repeat(64)}` } },
      { ...matchingRequest, acceptedChange: { eventId: "architecture_event.other" } },
      { ...matchingRequest, expected: { worktreeDigest: `sha256:${"d".repeat(64)}` } }
    ];
    for (const mismatch of mismatchRequests) {
      const rejected = await runTestCli("projection", ["recover", "--request-json", JSON.stringify(mismatch)], root, racingClient);
      expect(rejected.ok, "only receipt identity is accepted from clients; forged semantic fields must reject before delivery").toBe(false);
      expect(await daemon.inspectProjectionApplyReceipt(root, lookupKey)).toMatchObject({ ok: true, data: { deliveryStatus: "pending" } });
    }

    const ownedPath = join(root, "docs/architecture/index.md");
    const ownedBefore = readFileSync(ownedPath, "utf8");
    writeFileSync(ownedPath, `${ownedBefore}\n<!-- dirty -->\n`, "utf8");
    const dirtyProjection = await runTestCli("projection", ["recover", "--request-json", JSON.stringify(recoveryIntent("projection_request.recovery_dirty"))], root, racingClient);
    expect(dirtyProjection.ok, "dirty projection-owned output must reject before receipt consumption").toBe(false);
    expect(await daemon.inspectProjectionApplyReceipt(root, lookupKey)).toMatchObject({ ok: true, data: { deliveryStatus: "pending" } });
    writeFileSync(ownedPath, ownedBefore, "utf8");

    const database = new Database(paths.localStorePath);
    const receiptRow = database.query("SELECT receipt_json FROM projection_apply_receipts WHERE lookup_key = ?").get(lookupKey) as { receipt_json: string };
    database.query("UPDATE projection_apply_receipts SET receipt_json = ? WHERE lookup_key = ?").run("{", lookupKey);
    database.close();
    const corruptReceipt = await runTestCli("projection", ["recover", "--request-json", JSON.stringify(recoveryIntent("projection_request.recovery_corrupt"))], root, racingClient);
    expect(corruptReceipt.ok, "corrupt durable receipts must reject without consumption").toBe(false);
    const repairedDatabase = new Database(paths.localStorePath);
    repairedDatabase.query("UPDATE projection_apply_receipts SET receipt_json = ? WHERE lookup_key = ?").run(receiptRow.receipt_json, lookupKey);
    repairedDatabase.close();
    expect(await daemon.inspectProjectionApplyReceipt(root, lookupKey)).toMatchObject({ ok: true, data: { deliveryStatus: "pending" } });

    // The CLI has proved the fixed point by now; mutate immediately before the daemon's writer
    // boundary to prove that its proof-bound recheck closes the check-to-consume window.
    let proofBoundMutation = false;
    const staleDeliveryClient = new Proxy(racingClient, {
      get(target, property, receiver) {
        if (property === "recoverProjectionApply") {
          return async (...args: Parameters<RuntimeDaemonClient["recoverProjectionApply"]>) => {
            proofBoundMutation = true;
            writeFileSync(readmePath, "# mutation after recovery proof\n", "utf8");
            return target.recoverProjectionApply(...args);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      }
    }) as RuntimeDaemonClient;
    const staleDelivery = await runTestCli("projection", ["recover", "--request-json", JSON.stringify(matchingRequest)], root, staleDeliveryClient);
    expect(proofBoundMutation).toBe(true);
    expect(staleDelivery.ok, "the daemon must recheck proof-bound state before consuming the receipt").toBe(false);
    expect((staleDelivery as any).error).toMatchObject({ code: "AC_PRECONDITION_FAILED" });
    expect(await daemon.inspectProjectionApplyReceipt(root, lookupKey)).toMatchObject({ ok: true, data: { deliveryStatus: "pending" } });
    writeFileSync(readmePath, originalReadme, "utf8");

    const recovered = await runTestCli("projection", ["recover", "--request-json", JSON.stringify(matchingRequest)], root, racingClient);
    expect(recovered.ok, JSON.stringify(recovered)).toBe(true);
    expect(recovered.data).toMatchObject({
      schemaVersion: "archcontext.projection-apply-recovery-result/v1",
      proof: { deliveryStatus: "delivered", receipt: { lookupKey } },
      refreshSignals: [expect.any(Object)]
    });
    expect(readFileSync(ownedPath, "utf8")).toBe(ownedBefore);

    const repeated = await runTestCli("projection", ["recover", "--request-json", JSON.stringify(matchingRequest)], root, racingClient);
    expect(repeated.ok, JSON.stringify(repeated)).toBe(true);
    expect(repeated.data).toMatchObject({ proof: { deliveryStatus: "already-delivered" }, refreshSignals: [] });
    expect({ ...(repeated.data as any).proof, deliveryStatus: "delivered" }).toEqual((recovered.data as any).proof);
    expect(readFileSync(ownedPath, "utf8")).toBe(ownedBefore);
    expect(applyCalls).toBe(1);
  } finally {
    if (rpcServer) await rpcServer.stop();
    else await daemon.stop();
    paths.restore();
    rmSync(stateRoot(root), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}, timeout);

test("semantic recovery rejects a committed receipt whose approved CodeGraph proof was unavailable", async () => {
  const root = createFixture();
  const paths = runtimePaths(root);
  const daemon = await createStartedDaemon({
    localStorePath: paths.localStorePath,
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider()
  });
  try {
    const { request } = await prepareAcceptedMajorChange(root);
    let injected = false;
    const racingClient = new Proxy(daemon, {
      get(target, property, receiver) {
        if (property === "applyUpdate") {
          return async (...args: Parameters<RuntimeDaemonClient["applyUpdate"]>) => {
            const applied = await target.applyUpdate(...args);
            if (!injected && applied.ok) {
              injected = true;
              writeFileSync(join(root, "README.md"), "# concurrent non-owned mutation\n", "utf8");
            }
            return applied;
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      }
    }) as RuntimeDaemonClient;
    const raced = await runTestCli("projection", ["run", "--request-json", JSON.stringify(request)], root, racingClient);
    expect(raced.ok, JSON.stringify(raced)).toBe(true);
    expect((raced.data as ProjectionResultV2).status).toBe("applied-reconcile-required");
    const lookupKey = (raced.data as ProjectionResultV2).applyReceipt!.lookupKey;
    const inspection = await daemon.inspectProjectionApplyReceipt(root, lookupKey);
    expect(inspection).toMatchObject({ ok: true, data: { deliveryStatus: "pending", receipt: { recovery: { generatedFrom: { codeGraphStatus: "unavailable" } } } } });
    const rejected = await runTestCli("projection", ["recover", "--request-json", JSON.stringify(
      recoveryIntentFromReceipt((inspection.data as any).receipt, "projection_request.recovery_codegraph_unavailable")
    )], root, racingClient);
    expect(rejected.ok).toBe(false);
    expect((rejected as any).error).toMatchObject({ code: "AC_PRECONDITION_FAILED" });
    expect(await daemon.inspectProjectionApplyReceipt(root, lookupKey)).toMatchObject({ ok: true, data: { deliveryStatus: "pending" } });
  } finally {
    await daemon.stop();
    paths.restore();
    rmSync(stateRoot(root), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}, timeout);
