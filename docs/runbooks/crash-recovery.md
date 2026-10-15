# Crash Recovery Runbook

## Scope

ArchContext local state is rebuildable. Git `.archcontext/` files remain the source of truth; local SQLite stores derived sessions, evidence, verification, and reviews.

## Drill

1. Stop `archctxd`.
2. Run `archctx paths` and move the reported `runtime.sqlite*` files aside, or move the reported workspace runtime state directory aside if daemon connection, lock, log, or review-run state is suspect.
3. Run `archctx init` if `.archcontext/manifest.yaml` is absent.
4. Run `archctx sync`.
5. Run `archctx validate`.
6. Run `archctx context --task "recovery smoke"`.

Expected result: model digest is restored from Git files and CodeGraph adapter state is regenerated.


## Committed projection metadata over budget

`AC_PROJECTION_APPLY_COMMITTED` with reason `projection-apply-committed-manual-only` means the apply
already committed. Its stored receipt is retained, while the failure's details omit the complete
readback request because it exceeds 256 KiB. Automatic restore/replay refuses this receipt. Keep
both full `lookupKey` and `applyId`; `requestIdUnavailable: true` means the original request ID did
not fit the bounded failure, not that it was deleted from the receipt.

Use the existing source maintenance client from an authorized checkout connected to the local
daemon. `createRuntimeRpcClientFromConnectionFile(root)` takes the repository root, discovers its
existing connection file and does not start a replacement daemon. The ordinary packaged CLI has
no lookup/export-by-ID command; this procedure does not add one.

```ts
import { createRuntimeRpcClientFromConnectionFile } from "@archcontext/local-runtime/runtime-rpc-client";
import { projectionApplyReadbackRequestFromReceipt } from "@archcontext/contracts";

const client = createRuntimeRpcClientFromConnectionFile(root);
if (!client) throw new Error("The existing daemon connection is unavailable");
const inspected = await client.inspectProjectionApplyReceipt(root, lookupKey);
if (!inspected.ok) throw new Error("Receipt inspection failed");
// Validate the successful found/receipt shape before using data in an operator script.
const { found, receipt } = inspected.data as unknown as {
  found: boolean; receipt?: Parameters<typeof projectionApplyReadbackRequestFromReceipt>[0];
};
if (!found || !receipt || receipt.identity.applyId !== applyId) {
  throw new Error("The stored receipt does not match both original identities");
}
const request = projectionApplyReadbackRequestFromReceipt(receipt);
if (!request) throw new Error("The historical receipt has no recovery binding");
const proof = await client.readbackProjectionApply(root, request);
if (!proof.ok) throw new Error("The current fixed point cannot prove this receipt");
```

Lookup returns the original full receipt and its pending/delivered checkpoint. Compare its full
`applyId` before deriving the readback request, then send that complete request unchanged. Readback
proves the current fixed point; it neither restores files nor consumes pending refresh signals.
The isolated protocol fixture verifies this flow over the real local RPC registry with oversized
historical metadata, including a receipt without an original request digest.

After a successful proof and explicit delivery intent, the existing `recoverProjectionApply`
method or `projection recover --request-json` can process the original identities under the
existing recovery contract. A failed proof requires operator investigation of the original
snapshot/outputs; the manual-only error does not authorize reconstruction or automatic replay.
The existing RPC request-body limit remains 16 MiB. A legacy request beyond that transport limit
cannot be proved by this wire flow; never truncate a request, identity or approval binding to fit.


## Unresolved journals and a manifest rollback conflict

`changeset-recovery-unresolved` keeps each original journalId, changeSetId, root and reason.
If `authorityReadbackRequired` is true, read the complete list through the existing authenticated
`runtimeStatus` RPC or `/health` and compare its count and `digestJson(unresolvedJournals)` with
`journalCount` and `authorityDigest`. The failure is not a partial list or an authorization to
reconstruct/truncate recovery bindings. Repair the original cause before restarting to retry.

`changeset-rollback-conflict` means another writer replaced a projection manifest after this
ChangeSet published it, and rollback could not safely restore all files. Existing conflicting bytes,
including raised engine floors, are preserved; the original backup and pending journal are kept.
Other safely reversible files are restored. Do not report this outcome as a complete rollback or
retry the write as if it were uncommitted and harmless. Inspect the original journal and backup.
Startup recovery refuses the same conflicting existing bytes, including a first-created manifest.

A missing destination has no external bytes to protect, so existing recovery may restore its
complete backup. The current journal cannot distinguish a crash before publication from an
external deletion after publication; absence follows that existing recovery rule. No new persistent
publication state or automatic reconstruction is introduced. A non-regular/unreadable replacement
or non-UTF8 bytes cannot be mistaken for a missing or matching manifest.
