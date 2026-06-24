# AL2 SQLite Architecture Ledger Foundation

Date: 2026-06-25
Branch: `codex/architecture-ledger-al2`

## P1 Map

AL2 extends the existing per-worktree `runtime.sqlite` local store. It does not add a second database or a second daemon.

Authoritative implementation surfaces:

- `packages/core/architecture-ledger/src/index.ts`: canonical in-memory replay, event normalization, snapshot graph digest, payload validation.
- `packages/local-runtime/local-store-sqlite/src/index.ts`: forward-only migration `0006_architecture_ledger`, append transaction, current-state materialization, replay/readback, snapshot, compaction, integrity, backup, FTS and views.
- `packages/contracts/src/ledger.ts`: schema-versioned event, snapshot, evidence, recommendation and agent-job contract types.
- `packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts`: 1,000-event replay, duplicate retry, failure rollback, views, FTS, operation metadata, backup and integrity gates.
- `scripts/architecture-ledger-sqlite-adapter-readback.mjs`: same replay fixture through Bun SQLite and Node `node:sqlite`.

Out of scope for AL2: YAML import/export, dual-mode promotion, Git-hook capture, CodeGraph delta ingestion, CLI/MCP query commands and subagent orchestration. Those start in later AL3+ slices.

## P2 Trace

The concrete write path is:

1. Caller submits `appendArchitectureEvents({ writer: "runtime-daemon", events })`.
2. `SqliteLocalStore.appendArchitectureEvents` rejects non-daemon writers, validates payload shape, opens `BEGIN IMMEDIATE`, checks scoped idempotency by `storage_repository_id + storage_workspace_id + idempotency_key`, computes `previousEventHash` and `eventHash`, and inserts `architecture_events`.
3. The same transaction persists evidence, bindings, recommendation runs, recommendations, agent jobs, projection state, source cursors and waivers.
4. The same transaction materializes current entity/relation/constraint tables.
5. Replay reads ordered events, applies canonical operations in memory, and `verifyArchitectureLedgerReplay` compares the replayed state with materialized state after canonicalization.
6. Snapshots store the last event cursor plus canonical graph digest. Compaction only marks old events with `compacted_by_snapshot_id`; it does not delete audit history.

Failure trace: the rollback test injects `faultAfterEvents: 1` after the first insert/materialization attempt. The transaction rolls back to zero `architecture_events`, zero current rows and zero operation samples.

## P3 Decision

The implementation keeps SQL as operational state and `.archcontext/` as the later review projection boundary. The main invariant is that accepted event append and current-state materialization succeed or fail together. Optional record metadata is normalized so replay and SQL readback remain byte-for-byte equivalent when metadata is absent.

Tradeoff: current-state tables duplicate event-derived facts for query speed. The audit source remains append-only events, so rebuild can delete and rematerialize current state from events. At 10x event volume, the first pressure point will be replay latency and FTS growth; snapshots and compaction metadata are the bounded mitigation without discarding event history.

## Verification

- `bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts --timeout 30000`
  - Result: 21 pass, 0 fail.
  - Covers: migration/schema guard, 1,000-event replay, duplicate retry, injected rollback, snapshot, compaction, views, FTS, operation metadata, backup and integrity.
- `node scripts/architecture-ledger-sqlite-adapter-readback.mjs`
  - Result: Bun and Node adapters both verified replay/integrity with matching graph digest `sha256:0b526aeac5b37b8153a608d0bda661ac52c9027cd50f7670cae6a76b62da16f1`.
- `bun run typecheck`
  - Result: pass.
- `node scripts/package-boundary-audit.mjs`
  - Result: pass, 5 workspaces.
- `node scripts/sprint-status-check.mjs`
  - Result: structure and evidence claims OK.
