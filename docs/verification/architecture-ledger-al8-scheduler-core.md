# AL8 Recommendation Scheduler Core Readback

Date: 2026-06-26

## Scope

This closes the scheduler-core portion of AL8: run records, stable fingerprints, duplicate suppression, lifecycle transitions, trigger levels, risk/uncertainty scoring, cooldowns, explanation trees and persisted Book readback.

Out of scope: CLI lifecycle commands, review-engine enforcement gates, waiver policy config and feedback metrics.

## P1 Map

The write boundary remains the architecture ledger append path. `@archcontext/core/recommendation-engine` owns deterministic scheduler decisions. `SqliteLocalStore.appendArchitectureEvents` owns persistence of `recommendation_runs` and `recommendations`. Book recommendations remain a read-only projection over replayed architecture events.

## P2 Traced Path

```text
AL8 scheduler candidate
  -> planRecommendationRun()
  -> RecommendationRunV1 + RecommendationV2 + explanation tree
  -> recommendationRunLedgerPayload()
  -> SqliteLocalStore.appendArchitectureEvents({ writer: "runtime-daemon" })
  -> recommendation_runs / recommendations SQLite tables
  -> replayArchitectureLedger()
  -> queryArchitectureLedgerBookRecommendations(openOnly=true)
```

## P3 Decision

The smallest coherent change is a pure scheduler core plus a SQLite readback packet. It preserves the AL0 invariant that CLI, MCP, hooks and agents are triggers/readers unless a daemon-owned event append crosses the mutation boundary. At 10x scale, duplicate/cooldown lookup and explanation payload size are the first pressure points; this module keeps both metadata-only and digest-based.

## Gates

| Gate | Status |
|---|---|
| AL8-01 | pass |
| AL8-02 | pass |
| AL8-03 | pass |
| AL8-04 | pass |
| AL8-05 | pass |
| AL8-06 | pass |
| AL8-07 | pass |
| AL8-08 | pass |
| AL8-14 | pass |
| AL8-EG1 | pass |
| AL8-EG2 | pass |
| AL8-EG5 | pass |

## Persistence

- Appended events: 3
- SQLite recommendation runs: 3
- SQLite recommendations: 2
- Book open recommendations: 2

## Verification

```bash
bun run record:al8:scheduler
bun run readback:al8:scheduler
bun test packages/core/recommendation-engine/test/recommendation-engine.test.ts
bun test scripts/architecture-ledger-al8-scheduler-readback.test.ts
bun run typecheck
node scripts/package-boundary-audit.mjs
node scripts/sprint-status-check.mjs
git diff --check
```

Readback status: verified
