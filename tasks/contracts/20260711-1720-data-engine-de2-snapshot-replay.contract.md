# Task Contract: DE2 Snapshot-Anchored Replay And Scope Reads

> **Status**: Complete
> **Approved by**: accepted DE0-DE5 program plan and explicit user instruction to execute the complete Sprint sequentially
> **Program Plan**: `plans/plan-20260711-1328-data-engine-authority-incremental.md`
> **Task Profile**: code-change
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-07-11 17:40
> **Review File**: `tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md`
> **Notes File**: `tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md`

## Goal

Complete only DE2 of the accepted data-engine program:

1. Promote ArchitectureSnapshot V2 to a verified graph + evidence + binding +
   tombstone anchor with exact scope and last event sequence/id/hash.
2. Make normal replay select the newest verified anchor at or before a target cursor,
   then query and apply only the ordered tail.
3. Preserve an explicit genesis integrity mode that independently proves anchored
   output equals full replay.
4. Replace scan-based scope/cursor resolution with direct composite indexed reads.

## Why

DE1 removed historical replay from steady writes, but normal reads and Delta still load
and replay every event from genesis. Existing snapshots contain counts/digests only and
`snapshotId` merely truncates the event list; they cannot restore evidence state or
bound read cost. DE2 establishes the verified historical state anchor needed before
cache/read-planner work.

## Scope

- In scope: snapshot V2 contract and migration `0015`; graph/evidence/tombstone state
  body; exact cursor/scope verification; anchor selection; tail query; genesis audit;
  direct scope/cursor lookup; TestLocalStore parity; corruption/equivalence/scale tests;
  DE2 readback and AL10 migration packaging compatibility.
- Out of scope: DE3 cache manifest ownership, DE4 bounded projection planner, DE5
  cache retention/telemetry, global search, cloud sync, and ledger authority promotion.

## Allowed Paths

```yaml
allowed_paths:
  - docs/adr/ADR-0045-authority-separated-data-engine.md
  - docs/verification/data-engine-de2-readback.json
  - docs/verification/data-engine-de2-readback.md
  - package.json
  - plans/plan-20260711-1328-data-engine-authority-incremental.md
  - tasks/contracts/20260711-1720-data-engine-de2-snapshot-replay.contract.md
  - tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md
  - tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md
  - packages/contracts/src/ledger.ts
  - packages/contracts/test/contracts.test.ts
  - packages/contracts/fixtures/valid/architecture-snapshot.json
  - packages/contracts/fixtures/invalid/architecture-snapshot-unknown-mode.json
  - schemas/runtime/architecture-snapshot.schema.json
  - packages/core/architecture-ledger/src/index.ts
  - packages/core/architecture-ledger/test/architecture-ledger.test.ts
  - packages/local-runtime/local-store-sqlite/src/index.ts
  - packages/local-runtime/local-store-sqlite/test/factories.ts
  - packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
  - packages/surfaces/cli/test/cli.test.ts
  - scripts/architecture-ledger-al10-release-packaging-readback.ts
  - scripts/architecture-ledger-al10-release-packaging-readback.test.ts
  - scripts/data-engine-de2-readback.ts
```

## Invariants

- Snapshot restore is an optimization, never an alternate authority. Snapshot body,
  digest, event sequence/id/hash, repository/worktree scope, and schema version must
  all verify before any tail event is applied.
- Normal replay reads no event at or before the selected anchor. Target and anchor are
  resolved by exact scoped indexed rows; missing, reversed, cross-scope, or corrupted
  cursors fail closed.
- Genesis audit never trusts the anchored result as its expected value. It independently
  replays ordered events from sequence one and compares graph/evidence/tombstone states.
- Snapshot state contains no raw source, raw diff, prompt/completion, CodeGraph body,
  secret, or credential material.
- Git-visible `.archcontext/` remains product authority; snapshots are disposable local
  acceleration state and may be deleted/rebuilt without semantic loss.

## Stop Conditions

- Snapshot equivalence requires accepting an unverified body or synthesizing missing
  evidence/tombstone state.
- Normal replay still queries the full prefix before choosing an anchor.
- Cursor/scope resolution requires event JSON scanning or a compatibility fallback.

## Exit Criteria

```yaml
exit_criteria:
  files_exist:
    - docs/verification/data-engine-de2-readback.json
  commands_succeed:
    - bun run typecheck
    - bun test packages/contracts/test/contracts.test.ts packages/core/architecture-ledger packages/local-runtime/local-store-sqlite packages/local-runtime/runtime-daemon
    - bun run record:de2:data-engine
    - bun run readback:de2:data-engine
    - bun run verify:explorer
    - bun run verify
  manual_checks:
    - "Normal replay restores newest verified anchor and reads only its ordered tail"
    - "Target before anchor missing target wrong scope and reversed cursor fail closed"
    - "Corrupted body digest sequence event hash and evidence tombstones fail closed"
    - "Genesis audit independently matches anchored graph and evidence state"
    - "Tail read count is independent of compacted prefix length"
```

## Rollback Point

- Checkpoint: DE2 commit after DE1 commit `70be09a`.
- Revert strategy: revert the DE2 checkpoint and rebuild/delete disposable snapshots;
  never edit or delete authoritative events to roll back the optimization.
