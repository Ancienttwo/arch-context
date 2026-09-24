# Approving an MCP ChangeSet

MCP agents propose changes and forward approval credentials. They cannot approve their own proposals with `approved: true`.

1. Call `archcontext_plan_update`. Review its `draft` and `preview`; retain the returned `changeSetDigest` and `draft.base.worktreeDigest`.
2. In the local CLI, explicitly approve that exact preview:

   ```sh
   archctx approve --id CHANGESET_ID --expected-worktree-digest WORKTREE_DIGEST --expected-changeset-digest CHANGESET_DIGEST --approved
   ```

3. Pass the returned `approvalToken`, the same ChangeSet ID, repository root and worktree digest to `archcontext_apply_update`.

The daemon binds the random token to the canonical repository path, ChangeSet contents and worktree digest. Tokens expire after five minutes, are consumed before asynchronous apply work, and become invalid when the daemon stops. A rejected attempt also consumes its token; preview and approve again before retrying. Tokens are held only in daemon memory as hashed lookup keys and are not persisted to the ledger.

MCP-created ChangeSets cannot use the direct `applyUpdate` RPC with a boolean approval. Both stdio and HTTP MCP use the token-verifying daemon method. The approval issuer is a local CLI/RPC operation and is not an MCP tool. The existing trusted CLI and internal projection apply flows retain their explicit local approval contract; this boundary separates agent tools from the local operator, not mutually hostile processes running as the same OS user.

The ChatGPT HTTP surface applies the same allowlist to listing and calling tools. It excludes apply by default, even if the caller knows the tool name or supplies an approval token. Explicit write-enabled host composition still requires a valid token.
