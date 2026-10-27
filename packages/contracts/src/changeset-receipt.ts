/** Portable content evidence, not an authenticated approval or ledger acceptance. */
export interface ChangeSetReceiptV1 {
  schemaVersion: "archcontext.changeset-receipt/v1";
  journalId: string;
  changeSetId: string;
  baseModelDigest: string;
  resultModelDigest: string;
  files: Array<{ path: string; operation: "write" | "delete"; bodyHash: string }>;
  hashAlgorithm: "sha256-canonical-json-body";
  approvalAuthenticity: "unverified";
}
