# Portable ChangeSet receipts

After `archctx apply` returns a `journalId`, export its committed evidence:

```sh
archctx ledger receipt --journal-id <journalId> --json > changeset-receipt.json
```

The daemon reads the journal for the requested repository. The command does not alter the model, append an acceptance event, or promote ledger authority. It may start the normal local daemon. Keep the exported JSON with the PR evidence or commit it outside `.archcontext/model/`.

`data` uses `archcontext.changeset-receipt/v1`. It contains the journal and ChangeSet ids, the recorded `baseModelDigest` and `resultModelDigest`, and each file's repository-relative path, operation, and `bodyHash`. No source bodies, machine-local roots, credentials, or journal metadata are exported. Missing committed journals, missing recorded model transitions, invalid file evidence, more than 10,000 file records, or a receipt exceeding 2 MiB fail closed. Historical journals without transition evidence cannot be reconstructed from the current worktree.

To check file content on another machine, read each write from the proposed commit with `git show <head>:<path>` and compare `digestJson({ body })` from `archctx-contracts` to `bodyHash`. Decode the blob as UTF-8 without changing line endings. A deletion has `operation: delete` and `bodyHash: missing`; confirm the path is absent at head. These hashes are not Git blob ids or bare SHA-256 hashes of file bytes.

The model digests are `digestJson(loadNativeModelFromModelFiles(files))`, using all direct YAML children of `.archcontext/model/nodes`, `relations`, and `flows` from the relevant base/head. They are not the native-export `inputDigest`. For several applies, compare the ordered receipt transitions for continuity and use the final writer for each path; every model path in the reviewed diff must be covered. A receipt for only one of several changes does not prove the entire diff.

`approvalAuthenticity: unverified` is intentional. This unsigned export lets a reviewer compare recorded content, but cannot authenticate a human approval or prevent somebody fabricating a self-consistent receipt. It is not accepted as ledger mutation authority. The command does not claim to perform the reviewer's Git-diff verification itself.
