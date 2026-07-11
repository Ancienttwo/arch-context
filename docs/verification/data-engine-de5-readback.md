# Data Engine DE5 Readback

- Verdict: **PASS**
- Generated: 2026-07-11T13:20:52.053Z
- Baseline commit: `2ba11f9fa3b5e66070ce5241e0f1a82bf46afbcf`
- Source digest: `sha256:f2586c0807a80a465a289657a7874ad4385f8cf7405faa8e302b097d0afb1777`
- Branch: `codex/data-engine-authority-incremental`

## Invariants

| Invariant | Status |
|---|---|
| additiveLifecycleMigration | PASS |
| deterministicBoundedGc | PASS |
| boundedDeltaPins | PASS |
| startupRecoveryAndOrphans | PASS |
| allowListedMetadataOnlyMetrics | PASS |
| requiredOperationalSignals | PASS |
| cacheIsDisposable | PASS |
| representative10k100k | PASS |

## Representative scale

| Entities | Relations | p95 ms | Returned nodes | Returned relations | Bounded |
|---:|---:|---:|---:|---:|---|
| 10000 | 9999 | 1.83 | 50 | 49 | PASS |
| 100000 | 99999 | 0.55 | 50 | 49 | PASS |

## Commands

| Command | Status | Duration ms |
|---|---|---:|
| `bun run typecheck` | PASS | 3677 |
| `bun test packages/local-runtime/local-store-sqlite packages/local-runtime/runtime-daemon` | PASS | 27854 |
| `bun run verify:explorer` | PASS | 238 |
| `node scripts/packaged-cli-smoke.mjs` | PASS | 5105 |
| `repo-harness run contract-run preflight --contract tasks/contracts/20260711-2005-data-engine-de5-cache-lifecycle-observability.contract.md --json` | PASS | 282 |
