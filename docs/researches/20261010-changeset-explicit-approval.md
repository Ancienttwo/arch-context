# One ChangeSet approval model for CLI and MCP — issue #260

Baseline: `cb3de48`. This note amends [ADR-0012](../adr/ADR-0012-changeset-only-architecture-writes.md) and supersedes the token decision in [the #168 MCP approval note](20260925-mcp-approval-boundary.md) and the projection grant in [the projection service note](20260925-projection-service-migration.md).

## Problem

`archctx plan` could only create entities. Updating or deleting an existing node, relation or flow went through MCP `archcontext_plan_update`, which marked the draft as MCP-owned. That draft then applied only with a one-time token from `archctx approve`, held in daemon memory with a five-minute expiry. One field change took three steps on two surfaces. Consumers bypassed the ChangeSet path and edited model YAML directly, which is what ADR-0012 exists to prevent.

## Decision

P1: the daemon owns ChangeSet mutation. CLI and MCP are thin adapters (ADR-0006) and both reach the same `applyUpdate` RPC. archctx runs locally; the agent that edits the model already works inside a task the user authorized, and pull request review is the human gate (ADR-0003). A token that the same local user mints and forwards does not separate two trust levels.

P2: `archctx plan` accepts `--op create_entity|update_entity_fields|delete_entity` in the MCP entity operation shape. Update and delete require `--expected-hash sha256:<64-hex>`; update requires the complete `--body`; delete rejects `--body`. `archctx apply --approved --expected-worktree-digest` and MCP `archcontext_apply_update { approved: true, expectedWorktreeDigest }` both call `applyUpdate`. The daemon returns `AC_USER_CONFIRMATION_REQUIRED` unless `approved` is `true`, then `AC_PRECONDITION_FAILED` if the draft was planned for another repository. Under the writer lock it rechecks the worktree digest, HEAD, model digest and each file's expected hash. The engine preview reports `Expected hash mismatch: PATH (current HASH)` and `update_entity_fields|delete_entity target does not exist`, so a stale plan is visible before apply.

`archcontext_projection` follows the same rule: writes need `approved: true`, and the request's expected snapshot is checked before work (`AC_PRECONDITION_FAILED`). The local CLI `archctx projection run` is unchanged.

P3: removed in the same change, with no alias or dual acceptance: the `archctx approve` command, `archctx projection approve`, the `approveMcpUpdate`, `applyMcpUpdate` and `approveMcpProjection` RPC methods, `RuntimePlanUpdateInput.approvalChannel`, and the in-memory approval registry. An unknown command such as `archctx approve` falls through to help, as every unknown command does. Capabilities advertise `changeset-entity-operations-v1` so consumers can require the CLI route.

## Trade-off

The token bound approval to one exact draft digest. Without it, re-planning the same ChangeSet ID before apply replaces the draft that `apply` consumes. The expected worktree digest and per-file expected hashes still bind apply to the reviewed repository state, and replay of an applied draft fails because the apply changed the worktree. At 10x, the cost is unchanged: one writer lock per apply and one hash read per entity operation in preview.
