# Task Contract: DE1 Transactional Subject Index And Change Feed

> **Status**: Complete
> **Approved by**: accepted DE0-DE5 program plan and explicit user instruction to execute the complete Sprint sequentially
> **Program Plan**: `plans/plan-20260711-1328-data-engine-authority-incremental.md`
> **Task Profile**: code-change
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-07-11 17:00
> **Review File**: `tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md`
> **Notes File**: `tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md`

## Goal

Complete only DE1 of the accepted data-engine program:

1. Persist typed event-subject rows and one durable outbox record for every newly
   committed ArchitectureEvent in the same SQLite transaction.
2. Extract graph, evidence item, evidence binding, target/reference, and live-binding
   effects without scanning event JSON in consumers.
3. Replace Explorer event backlinks with indexed reads.
4. Drive dependency invalidation and digest-only SSE from durable feed records, with
   monotonic consumer checkpoints and restart-safe replay.

## Why

DE0 made fact/evidence/projection authority explicit, but event backlinks still scan
every payload and cache invalidation is inferred only when a new projection happens to
be compiled. A process crash after event commit can therefore lose the notification,
and evidence-only transitions can leave binding-dependent projections stale. DE1 adds
the transactional typed recovery boundary required before replay/cache optimization.

## Scope

- In scope: `ArchitectureAffectedSubjectV1`, `ArchitectureChangeFeedRecordV1`, feed
  failure/consumer contracts; SQLite migration `0014`; transactional extraction and
  outbox append; indexed backlink reads; feed poll/ack; daemon invalidation/SSE;
  TestLocalStore parity; crash/restart/duplicate/evidence-only tests; DE1 readback.
- Out of scope: DE2 snapshot anchors, DE3 manifest cache ownership, DE4 read planner,
  DE5 retention/telemetry, global search, cloud sync, and authority promotion.

## Allowed Paths

```yaml
allowed_paths:
  - docs/adr/ADR-0045-authority-separated-data-engine.md
  - docs/verification/data-engine-de1-readback.json
  - docs/verification/data-engine-de1-readback.md
  - package.json
  - plans/plan-20260711-1328-data-engine-authority-incremental.md
  - tasks/todos.md
  - tasks/contracts/20260711-1605-data-engine-de1-change-feed.contract.md
  - tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md
  - tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md
  - packages/contracts/src/ledger.ts
  - packages/contracts/src/ports.ts
  - packages/contracts/test/contracts.test.ts
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
  - scripts/data-engine-de1-readback.ts
```

## Invariants

- Event, materialized state, subject rows, and feed row share one `BEGIN IMMEDIATE`
  transaction. No feed row exists without its event and no event exists without its
  subject/feed projection.
- Feed sequence and consumer checkpoint are monotonic. Duplicate poll/ack is
  idempotent; acknowledging an unseen or cross-scope sequence fails closed.
- Consumers read typed tables only; they never parse, regex, or infer subjects from
  persisted event JSON.
- Evidence item updates include every live binding affected by the item transition.
- SSE contains cursors/digests/counts only. It is a notification, never the durable
  recovery source.
- Cache invalidation may over-delete rebuildable derived rows but can never mutate
  ledger authority or fabricate architecture/evidence state.

## Stop Conditions

- Atomic outbox insertion would require a second transaction or post-commit event scan.
- Evidence-only invalidation requires semantic inference outside validated lifecycle
  state or an event-body compatibility parser.
- Recovery requires SSE history, process memory, or raw payload persistence.

## Exit Criteria

```yaml
exit_criteria:
  files_exist:
    - docs/verification/data-engine-de1-readback.json
  commands_succeed:
    - bun run typecheck
    - bun test packages/contracts/test/contracts.test.ts
    - bun test packages/local-runtime/local-store-sqlite packages/local-runtime/runtime-daemon
    - bun run record:de1:data-engine
    - bun run readback:de1:data-engine
    - bun run verify:explorer
    - bun run verify
  manual_checks:
    - "Crash before commit exposes no event subject or feed row"
    - "Crash after commit before notification is recovered from unread feed"
    - "Duplicate poll and ack are idempotent"
    - "Event backlinks are served from the typed index"
    - "Evidence-only lifecycle events invalidate binding-dependent projections"
    - "SSE payload contains no raw event source diff prompt completion or CodeGraph body"
```

## Rollback Point

- Checkpoint: DE1 commit after DE0 commit `5cef4ace889712c7b1faffe8df3b4835cfaf06e9`.
- Revert strategy: revert the DE1 migration/code checkpoint before release. Derived
  subject/feed/checkpoint rows may be deleted and rebuilt; authoritative events are
  not edited or deleted.
