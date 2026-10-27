import { expect, test } from "bun:test";
import { exportChangeSetReceipt } from "../src/changeset-receipt";
import type { CommittedChangeSetForTaskSession } from "@archcontext/local-runtime/local-store-sqlite";

test("receipt refuses a historical journal without transition evidence instead of deriving current state", async () => {
  const journal: CommittedChangeSetForTaskSession = { journalId: "j", changeSetId: "c", committedAt: "2026-10-28T00:00:00Z", files: [] };
  expect(await exportChangeSetReceipt({ readCommittedChangeSet: async () => journal }, "/unused", "j")).toMatchObject({
    ok: false, error: { reasonCode: "changeset-receipt-transition-unavailable" }
  });
});

test("receipt rejects machine-local paths and invalid file hashes", async () => {
  for (const file of [{ path: "/private/model.yaml", operation: "write" as const, hash: `sha256:${"a".repeat(64)}` }, { path: "model.yaml", operation: "delete" as const, hash: "not-missing" }]) {
    const journal: CommittedChangeSetForTaskSession = {
      journalId: "j", changeSetId: "c", committedAt: "2026-10-28T00:00:00Z", files: [file],
      modelTransition: { schemaVersion: "archcontext.changeset-model-transition/v1", before: `sha256:${"a".repeat(64)}`, after: `sha256:${"b".repeat(64)}` }
    };
    expect((await exportChangeSetReceipt({ readCommittedChangeSet: async () => journal }, "/unused", "j")).error?.reasonCode).toBe("changeset-receipt-files-invalid");
  }
});
