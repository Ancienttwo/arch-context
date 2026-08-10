# archctx 0.4.2 release checklist

Scope: exclude the exact Claude runtime trace files from architecture projection worktree identity so a CodeGraph-backed projection can remain stable while repo-harness records its active session. This patch keeps `.claude` configuration authoritative and does not change protocol identifiers, renderer/layout versions, or the Node engine range.

- [ ] `bun run verify` passes under Node `>=24 <26`.
- [ ] `archctx` and `archctx-contracts` package versions are exactly `0.4.2`.
- [ ] Focused architecture-domain tests prove runtime traces are ignored and `.claude/settings.json` remains digest-significant.
- [ ] A real repo-harness projection apply completes while `.claude/.session-id` and `.claude/.trace.jsonl` are active.
- [ ] Pull request is merged to `main`; Claude review is waived by the user's explicit instruction.
- [ ] Publish `archctx-contracts@0.4.2` and read back version, integrity, and shasum.
- [ ] Publish `archctx@0.4.2` and read back version, integrity, shasum, Node engine, and exact CodeGraph dependency.
- [ ] Clean-room Node 24 smoke returns the `0.4.2` capabilities handshake.
- [ ] Update repo-harness to exact `archctx@0.4.2` and `archctx-contracts@0.4.2`, then prove the accepted refresh signal end to end.
