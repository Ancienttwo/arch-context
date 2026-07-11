# Task Contract: DE5 Cache Lifecycle and Operational Evidence

> **Status**: Complete
> **Approved by**: accepted DE0-DE5 program plan and explicit user instruction to execute the complete Sprint sequentially
> **Program Plan**: `plans/plan-20260711-1328-data-engine-authority-incremental.md`
> **Task Profile**: code-change
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-07-11 21:00
> **Review File**: `tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md`
> **Notes File**: `tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md`

## Goal

Complete DE5 and the operational closeout of the accepted data-engine program:

1. Define a typed, bounded per-scope Explorer projection cache policy.
2. Persist byte/access accounting and bounded delta-base pins.
3. Run deterministic GC and startup recovery without touching authoritative state.
4. Persist numeric/reason-code-only engine metrics for feed, replay, planner, compiler,
   cache, eviction, and rebuild diagnosis.
5. Prove retention, recovery, privacy, authority independence, and representative
   10k/100k behavior through executable readback and an operator runbook.

## Why

DE1-DE4 made invalidation, replay, manifests, and bounded reads authority-correct,
but projection rows could still grow without a count/byte/age limit and operators
could not distinguish feed lag, replay cost, planner volume, compiler cost, or cache
pressure. DE5 closes that operational boundary while keeping all retained state
strictly disposable and content-free outside the already validated projection body.

## Authority Boundary

- `.archcontext/` remains Git-visible product authority; verified ledger events and
  snapshots remain historical/runtime authority under ADR-0040.
- Projection cache rows, dependency rows, pins, and metric aggregates are disposable
  operational state. Deleting all of them can cause only recomputation or an explicit
  delta cache miss; it cannot change graph/evidence facts.
- Metrics persist only enum reason codes, numeric values, digests, timestamps, and
  scope storage IDs. Source bodies, diffs, prompts/completions, and CodeGraph output
  are forbidden.

## Scope

- In scope: additive SQLite migration; cache policy/stats/GC/pin/metric contracts;
  startup recovery; daemon instrumentation; delta pinning; TestLocalStore parity;
  focused tests; 10k/100k readback; operations runbook; final program artifacts.
- Out of scope: Global Subject Search, UI changes, cloud telemetry, remote cache,
  ledger-authoritative promotion, source persistence, or a generic metrics framework.

## Allowed Paths

```yaml
allowed_paths:
  - docs/adr/ADR-0045-authority-separated-data-engine.md
  - docs/runbooks/data-engine-cache-operations.md
  - docs/verification/data-engine-de5-readback.json
  - docs/verification/data-engine-de5-readback.md
  - package.json
  - plans/plan-20260711-1328-data-engine-authority-incremental.md
  - tasks/contracts/20260711-2005-data-engine-de5-cache-lifecycle-observability.contract.md
  - tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md
  - tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md
  - packages/local-runtime/local-store-sqlite/src/index.ts
  - packages/contracts/src/ports.ts
  - packages/contracts/test/contracts.test.ts
  - packages/local-runtime/local-store-sqlite/test/factories.ts
  - packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
  - scripts/data-engine-de5-readback.ts
  - scripts/architecture-ledger-al10-release-packaging-readback.ts
  - scripts/architecture-ledger-al10-release-packaging-readback.test.ts
```

## Invariants

- GC is deterministic for identical rows, policy, and time: invalid/expired unpinned
  rows first, then least-recently-used unpinned rows, with stable digest tie-breaking.
- An unexpired pin protects an exact digest only and is bounded by an explicit expiry.
  Pins never turn cache state into authority and never permit unbounded retention.
- Count and byte limits apply per storage repository/workspace scope after every save,
  explicit collection, and startup recovery.
- Dependency orphans are deleted transactionally; cache deletes cascade only through
  derived dependency rows.
- Cache reads validate body/schema/privacy before recording a hit. Corrupt rows fail
  closed and are never returned as synthesized output.
- Operational metrics have an allow-listed name/reason vocabulary and numeric values;
  no arbitrary string payload can cross the persistence boundary.

## Stop Conditions

- A cache deletion, miss, or metric failure changes authoritative ledger/evidence data.
- A pin has no expiry or allows a scope to exceed limits indefinitely.
- GC depends on wall-clock reads hidden from its input or has unstable tie ordering.
- Metrics accept source bodies, arbitrary labels, or high-cardinality user content.
- Startup cleanup can delete authoritative events, snapshots, or materialized state.

## Exit Criteria

```yaml
exit_criteria:
  files_exist:
    - docs/verification/data-engine-de5-readback.json
    - docs/runbooks/data-engine-cache-operations.md
  commands_succeed:
    - bun run typecheck
    - bun test packages/local-runtime/local-store-sqlite packages/local-runtime/runtime-daemon
    - bun run record:de5:data-engine
    - bun run readback:de5:data-engine
    - bun run verify:explorer
    - bun run verify
  manual_checks:
    - "Pinned delta bases survive GC until expiry"
    - "Unpinned LRU rows evict deterministically under count and byte pressure"
    - "Restart removes orphans and reapplies retention"
    - "Deleting the entire projection cache changes no authoritative digest"
    - "Metrics contain only allow-listed numeric and reason-code data"
    - "10k and 100k representative Explorer evidence stays within stored acceptance budgets"
```

## Rollback Point

- Checkpoint: DE5 commit after DE4 commit `c489694`.
- Revert strategy: revert DE5 and delete/rebuild disposable projection cache/metric
  tables if necessary. Never SQL-reverse authoritative events or snapshots.
