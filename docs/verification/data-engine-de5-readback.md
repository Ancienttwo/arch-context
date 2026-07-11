# Data Engine DE5 Readback

- Verdict: **PASS**
- Generated: 2026-07-11T13:12:08.175Z
- Baseline commit: `ff7ae0edffd70cdf28843459ded4e2f71f1c5701`
- Source digest: `sha256:b982c9f12a97b7cef9d29b13cd81fb771bf54e90327f1070e46eeb2873ea54da`
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
| 10000 | 9999 | 1.76 | 50 | 49 | PASS |
| 100000 | 99999 | 0.52 | 50 | 49 | PASS |

## Commands

| Command | Status | Duration ms |
|---|---|---:|
| `bun run typecheck` | PASS | 4135 |
| `bun test packages/local-runtime/local-store-sqlite packages/local-runtime/runtime-daemon` | PASS | 27608 |
| `bun run verify:explorer` | PASS | 243 |
| `node scripts/packaged-cli-smoke.mjs` | PASS | 4551 |
| `repo-harness run contract-run preflight --contract tasks/contracts/20260711-2005-data-engine-de5-cache-lifecycle-observability.contract.md --json` | PASS | 283 |
