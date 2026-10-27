import { failureEnvelope, isRepoRelativePosixPath, knownFailure, okEnvelope, type ChangeSetReceiptV1, type Json, type JsonEnvelope } from "@archcontext/contracts";
import type { RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";

/** The daemon reads committed journal authority; callers never open or reconstruct its database. */
export async function exportChangeSetReceipt(store: Pick<RuntimeLocalStore, "readCommittedChangeSet">, root: string, journalId: string): Promise<JsonEnvelope> {
  const refuse = (reason: string) => failureEnvelope("ledger.receipt", knownFailure("AC_PRECONDITION_FAILED", reason));
  const journal = await store.readCommittedChangeSet(root, journalId);
  if (!journal) return refuse("changeset-receipt-journal-unavailable");
  if (!journal.modelTransition) return refuse("changeset-receipt-transition-unavailable");
  // Bound the portable output; truncation could falsely appear to cover a committed diff.
  if (journal.files.length > 10_000) return refuse("changeset-receipt-limit-exceeded");
  const files = journal.files.map(file => ({ path: file.path, operation: file.operation, bodyHash: file.hash }));
  if (files.some(file => !isRepoRelativePosixPath(file.path)
    || (file.operation === "delete" ? file.bodyHash !== "missing" : !/^sha256:[a-f0-9]{64}$/.test(file.bodyHash)))) {
    return refuse("changeset-receipt-files-invalid");
  }
  const receipt: ChangeSetReceiptV1 = {
    schemaVersion: "archcontext.changeset-receipt/v1",
    journalId: journal.journalId,
    changeSetId: journal.changeSetId,
    baseModelDigest: journal.modelTransition.before,
    resultModelDigest: journal.modelTransition.after,
    files,
    hashAlgorithm: "sha256-canonical-json-body",
    approvalAuthenticity: "unverified"
  };
  if (Buffer.byteLength(JSON.stringify(receipt)) > 2 * 1024 * 1024) return refuse("changeset-receipt-limit-exceeded");
  return okEnvelope("ledger.receipt", receipt as unknown as Json);
}
