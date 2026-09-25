# Projection receipt service extraction — issue #164

Status: extraction and targeted verification complete; full verification and hosted CI pending. Baseline: #212 head `81fdd981d1dc1195eb1d628e4cf836fdf40d3d04`.

## P1 — ownership

The remaining receipt inspection, prior-commit journal listing, readback and recovery methods live in the daemon facade beside unrelated features. Their private fixed-point builder and proof helpers are used only by readback/recovery. The shared ChangeSet apply path records receipts inside the same journal transaction and must remain intact.

## P2 — trace

Readback/recovery validates its request, acquires the daemon writer gate, opens the repository session, inspects the committed receipt, rebuilds the fixed point from current Git/model/CodeGraph authority and checks the original approval bindings. Readback never consumes; recovery consumes once through the local store. Prior-commit listing deliberately does not open a source session or hash runtime churn. The extracted service receives the exact running guard, writer gate, session opener, shared worktree digest and source-stamp loader callbacks.

## P3 — move boundary

Move only the four public method bodies and recovery-only helper closure into `projection-apply.ts`; the facade delegates and preserves the RPC table/API. Keep `applyAuthorizedUpdate`, receipt journal insertion, `runtimeWorktreeDigest` and the shared source-stamp loader in their current owning boundaries. No new write path, lock, persistence, caching or concurrency policy. At 10x receipt requests, rebuilding CodeGraph-backed fixed points remains the cost; this move makes no performance claim.

Co-locate the existing journal-read integration test with the service; it verifies reads create neither sessions nor snapshots. Cross-surface CLI/RPC recovery and replay tests remain at the repository integration boundary. Their behavior and daemon fault-injection points are unchanged. Verify normalized method/helper parity, targeted protocol tests, typecheck, package boundaries and full verification before merging.

## Verification and test locations

Normalized text comparison confirms all four moved method bodies and the recovery-only helper closure are unchanged apart from context callback qualification. Runtime exports remain the same 34 names. Initial targeted execution of all four journal/recovery integration scenarios passes (93 assertions).

`packages/local-runtime/runtime-daemon/test/projection-apply.test.ts` owns the journal-only no-session/no-snapshot regression, using the existing initialized Git repository fixture. `tests/projection-prior-committed-applies.test.ts` and `tests/ownership-change-acceptance-recovery.test.ts` continue to own cross-surface replay/recovery coverage. The new component, facade exclusion and two relations were written through daemon ChangeSet; model validation passes with no errors.
