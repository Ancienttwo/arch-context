# Ledger administration extraction — issue #164

Status: targeted verification complete; full verification and hosted CI pending. Baseline: #214 head `a8848a5fdb58808879d75f02972a9a814885b0b0`.

## P1 — ownership

The daemon facade contained ledger project, migrate, rollback and rebuild orchestration, including recommendation-v3 migration and the ChangeSet projection/backup helper closure. These move into `ledger-admin.ts`. Shared ledger readback, task/book/Explorer context, repository scope resolution, freshness enforcement, generic ChangeSet apply and ledger append/feed remain at their existing owning boundary.

## P2 — trace

Project and rollback retain explicit write selection, the existing writer gate, worktree freshness, managed-model filtering and ChangeSet plan/approve/apply. Rollback preserves backup manifests and obsolete-file deletion with expected hashes. YAML migration still backs up SQLite before append, rebuilds materialized state, and verifies integrity and drift. Recommendation-v3 migration keeps its append-only event and unchanged graph digest. Rebuild preserves the separate cursor-refresh, initial rebuild, external-projection proposal and explicit acceptance paths.

The service receives the exact existing stores, model store, ChangeSet engine, modes, clock and callback boundaries. Shared recommendation folding, managed-path classification and digest helper remain single implementations. The public state/drift readers remain thin adapters to shared readback, because book, context and Explorer also use that authority.

## P3 — move boundary

Move only feature orchestration and private helper bodies. No new write authority, retries, cache, schema or migration policy. The facade keeps four public delegates with identical inputs/defaults and preserves all 34 runtime exports and the RPC table. At 10x events/files, existing full replay, YAML projection and SQLite backup costs remain; this move claims no performance improvement.

## Verification

Normalized text parity passes for all moved methods, private helpers, eight test bodies and the stale-projection fixture. The co-located admin tests and existing recommendation/refactor integrations pass together: 53 tests, 431 assertions. Coverage includes stale/obsolete projection files, concurrent target mutation, rollback backup, verified migration, idempotent rebuild, deferred derived feed and external-projection acceptance. Shared generic-apply rollback and readback tests stay in the daemon integration suite; CLI/RPC contracts remain at their existing boundaries.

Typecheck and package-boundary audit pass. The self-model component, facade exclusion and ledger relation were applied through daemon ChangeSet; validation reports no errors. Full verification and hosted matrix evidence will be recorded in the PR once complete.
