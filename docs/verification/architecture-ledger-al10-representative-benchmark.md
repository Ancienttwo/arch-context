# AL10 Representative Replay And Benchmark Readback

Date: 2026-06-26

## Scope

This closes AL10-03 and AL10-04, and provides AL10-BETA-1 evidence, for the architecture ledger sprint.

It runs the daemon-owned loop on three temporary Git repositories: small app, medium monorepo and architecture-heavy service. Each repository exercises YAML-to-ledger migration, Book query, prepare/checkpoint, hook enqueue, sync, documentation projection apply, complete-task projection validation, ledger replay and YAML rollback.

## P1 Map

The measured path stays inside Local Core. CLI commands call the runtime daemon. The daemon owns migration, ledger append, job enqueue, checkpoint, complete, ChangeSet apply, replay and rollback. The temporary Git repositories provide representative model size and shape; no user repository or SQLite database is committed.

## P2 Traced Path

```text
temporary Git representative repo
  -> archctx init
  -> archctx ledger migrate --from-yaml --write
  -> archctx prepare / book query
  -> source worktree change
  -> archctx hook enqueue + sync + checkpoint
  -> archctx docs apply --approved
  -> archctx complete
  -> archctx ledger rebuild --from-git
  -> archctx ledger rollback --to-yaml --write
```

## P3 Decision

This readback intentionally uses synthetic representative repositories rather than mutating sibling user repositories. The tradeoff is that it proves workflow mechanics, drift and performance shape, not beta-user adoption. That is sufficient for AL10-03/04 and AL10-BETA-1, while AL10-13 and AL10-14 remain separate telemetry/product gates.

## Benchmark

Thresholds: warm query p95 <= 300 ms; hook enqueue p95 <= 150 ms; checkpoint p95 <= 3000 ms.

| Fixture | Entities | Relations | Hook ms | Sync ms | Warm query p95 ms | Checkpoint ms | Complete ms | Projection ms | Replay ms | Drift count |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Small App | 10 | 9 | 120.03 | 13.108 | 54.657 | 70.772 | 33.697 | 48.799 | 54.601 | 0 |
| Medium Monorepo | 54 | 105 | 136.045 | 17.937 | 70.68 | 97.962 | 54.446 | 107.38 | 91.603 | 0 |
| Architecture-Heavy Service | 108 | 213 | 154.458 | 24.593 | 96.8 | 136.244 | 85.346 | 169.13 | 138.902 | 0 |

Aggregate warm query p95: 96.8 ms.
Aggregate hook enqueue p95: 154.458 ms.
Aggregate checkpoint p95: 136.244 ms.
Dual-mode drift count: 0.

## Privacy

- Raw source sentinel leaked: no
- Forbidden response keys present: no
- Packet stores only digests, counts, request metadata and latency summaries.

## Assertions

- AL10-03: PASS
- AL10-04: PASS
- AL10-BETA-1: PASS
- warmQueryP95WithinBetaBudget: PASS
- hookEnqueueP95WithinBetaBudget: FAIL
- checkpointP95WithinBetaBudget: PASS
- privacyClean: PASS

## Verification

```bash
bun run record:al10:representative-benchmark
bun run readback:al10:representative-benchmark
bun test scripts/architecture-ledger-al10-representative-benchmark-readback.test.ts --timeout 120000
bun run typecheck
node scripts/sprint-status-check.mjs
git diff --check
```

Readback status: verified
