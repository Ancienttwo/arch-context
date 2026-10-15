import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createProjectionApplyIdentity, projectionApplyReceiptInvariantIssues, projectionResultReceiptDigest, type ProjectionApplyReceiptV1, type ProjectionResultV2 } from "@archcontext/contracts";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { createInitializedGitRepo, createStartedTestDaemon } from "./runtime-test-fixtures";

function oversizedReceipt(): ProjectionApplyReceiptV1 {
  const result: ProjectionResultV2 = JSON.parse(readFileSync(new URL("../../../contracts/fixtures/valid/projection-result.json", import.meta.url), "utf8"));
  result.requestId = "r".repeat(256 * 1024 + 1);
  const identity = createProjectionApplyIdentity({
    repositoryId: result.inputSnapshot.repositoryId, workspaceId: result.inputSnapshot.workspaceId,
    acceptedChange: { changeSetId: "changeset.direct", eventId: "event.direct", reasonCodes: ["responsibility-changed"], affectedNodeIds: ["capability.api"] },
    changeSetId: "changeset.direct", idempotencyKey: "idem.direct", files: result.files, refreshSignals: result.refreshSignals
  });
  result.applyReceipt = identity;
  const { receiptDigest: _oldDigest, ...resultBody } = result;
  result.receiptDigest = projectionResultReceiptDigest(resultBody);
  const receipt: ProjectionApplyReceiptV1 = { schemaVersion: "archcontext.projection-apply-receipt/v1", identity, result };
  expect(projectionApplyReceiptInvariantIssues(receipt)).toEqual([]);
  return receipt;
}

test("direct applyUpdate rejects oversized final recovery metadata before business journal/receipt/ledger/files", async () => {
  const root = createInitializedGitRepo();
  const store = new TestLocalStore();
  const daemon = await createStartedTestDaemon({ localStore: store });
  try {
    const planned = await daemon.planUpdate(root, { id: "changeset.direct", operations: [{ op: "render_projection", expectedHash: "missing", projectionFiles: [{ path: "docs/architecture/budget.md", expectedHash: "missing", body: "business output\n" }] }] });
    expect(planned.ok).toBe(true);
    const snapshots = store.snapshots.size;
    const result = await daemon.applyUpdate(root, { id: "changeset.direct", approved: true, expectedWorktreeDigest: (planned.data as any).draft.base.worktreeDigest, projectionApplyReceipt: oversizedReceipt() });
    expect(result).toMatchObject({ ok: false, error: { code: "AC_PRECONDITION_FAILED", reasonCode: "projection-apply-recovery-metadata-too-large", details: { limitBytes: 262144 } } });
    expect(existsSync(join(root, "docs/architecture/budget.md"))).toBe(false);
    expect(store.changeSetJournals.size).toBe(0);
    expect(store.architectureEventAppends).toHaveLength(0);
    // Existing openSession administrative snapshots remain visible; this is not a zero-all-SQLite claim.
    expect(store.snapshots.size).toBeGreaterThan(snapshots);
    expect(await store.inspectProjectionApplyReceipt(oversizedReceipt().identity.lookupKey)).toBeUndefined();
  } finally { await daemon.stop(); rmSync(root, { recursive: true, force: true }); }
});

test("a direct writer recognizes a historical committed receipt before the new-commit capacity guard", async () => {
  const root = createInitializedGitRepo();
  const store = new TestLocalStore();
  const daemon = await createStartedTestDaemon({ localStore: store });
  try {
    const planned = await daemon.planUpdate(root, { id: "changeset.direct", operations: [{ op: "render_projection", expectedHash: "missing", projectionFiles: [{ path: "docs/architecture/budget.md", expectedHash: "missing", body: "business output\n" }] }] });
    const receipt = oversizedReceipt();
    const journal = await store.beginChangeSet(root, (planned.data as any).draft);
    await store.recordProjectionApplyReceipt(journal, receipt);
    await store.commitChangeSet(journal);
    const before = JSON.stringify(await store.inspectProjectionApplyReceipt(receipt.identity.lookupKey));
    const result = await daemon.applyUpdate(root, { id: "changeset.direct", approved: true, expectedWorktreeDigest: (planned.data as any).draft.base.worktreeDigest, projectionApplyReceipt: receipt });
    expect(result).toMatchObject({ ok: false, error: { code: "AC_PROJECTION_APPLY_COMMITTED", reasonCode: "projection-apply-committed-manual-only", details: { lookupKey: receipt.identity.lookupKey, applyId: receipt.identity.applyId, written: false, requestIdUnavailable: true } } });
    expect(store.changeSetJournals.size).toBe(1);
    expect(existsSync(join(root, "docs/architecture/budget.md"))).toBe(false);
    expect(JSON.stringify(await store.inspectProjectionApplyReceipt(receipt.identity.lookupKey))).toBe(before);
  } finally { await daemon.stop(); rmSync(root, { recursive: true, force: true }); }
});
