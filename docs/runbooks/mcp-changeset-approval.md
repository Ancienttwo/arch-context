# Approving a ChangeSet (CLI and MCP)

CLI and MCP share one approval model. A ChangeSet applies only when the caller passes all three:

- an explicit approval: `--approved` on the CLI, `approved: true` on MCP;
- the expected worktree digest from the preview (`draft.base.worktreeDigest`);
- for every entity operation, the expected hash of the file it replaces (`missing` for a create).

There is no separate approval command and no approval token.

## CLI

1. Plan one entity operation. Create, update and delete use the same shape:

   ```sh
   archctx plan --id changeset.ID --path .archcontext/model/nodes/NODE.yaml --body '<complete YAML>'
   archctx plan --id changeset.ID --op update_entity_fields --path .archcontext/model/nodes/NODE.yaml --expected-hash sha256:CURRENT --body '<complete YAML>'
   archctx plan --id changeset.ID --op delete_entity --path .archcontext/model/flows/FLOW.yaml --expected-hash sha256:CURRENT
   ```

   `--body` is the complete new YAML document, not a field patch. Update and delete require `--expected-hash`; delete accepts no `--body`.

2. Review `preview`. `preview.allowed` is `false` when a finding blocks the write. A stale or wrong hash shows `Expected hash mismatch: PATH (current sha256:...)`. Re-read the file and plan again; do not copy the reported hash without reviewing the current content.
3. Apply with the preview's worktree digest:

   ```sh
   archctx apply --id changeset.ID --approved --expected-worktree-digest WORKTREE_DIGEST
   ```

## MCP

1. Call `archcontext_plan_update` with the same entity operation shape. Review `draft` and `preview`.
2. Call `archcontext_apply_update` with the same ChangeSet ID, repository root, `expectedWorktreeDigest: draft.base.worktreeDigest` and `approved: true`.

`archcontext_projection` follows the same rule. `run` with `mode: apply|adopt` and `recover` need `approved: true`, and the request's `expected` snapshot must match the repository.

## What fails closed

- A missing, `false` or non-boolean approval returns `AC_USER_CONFIRMATION_REQUIRED` and writes nothing.
- A malformed CLI operation returns `AC_SCHEMA_INVALID` before the daemon is contacted.
- An apply from another repository than the one that planned the ChangeSet returns `AC_PRECONDITION_FAILED`.
- A changed worktree digest, HEAD or model digest, or a file whose hash no longer matches, aborts under the daemon writer lock. A failed apply rolls back. A second apply of the same draft fails because the first apply changed the worktree.

The ChatGPT HTTP surface still excludes `archcontext_apply_update` and `archcontext_projection` from both the tool list and tool calls unless write mode is explicitly enabled.

The decision record is [ADR-0012](../adr/ADR-0012-changeset-only-architecture-writes.md) and [the explicit-approval note](../researches/20261010-changeset-explicit-approval.md).
