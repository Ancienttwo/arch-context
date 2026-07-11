# Data Engine DE5 Readback

- Verdict: **PASS**
- Generated: 2026-07-11T13:00:04.146Z
- Baseline commit: `92be322c28fc0c98f252c45d3a24ce36513e877f`
- Source digest: `sha256:15212ea34091f57fc60d43131e18cba62d35ae7ec059163f4f52468bb9d6a163`
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
| 10000 | 9999 | 1.71 | 50 | 49 | PASS |
| 100000 | 99999 | 0.58 | 50 | 49 | PASS |

## Commands

| Command | Status | Duration ms |
|---|---|---:|
| `bun run typecheck` | PASS | 3902 |
| `bun test packages/local-runtime/local-store-sqlite packages/local-runtime/runtime-daemon` | PASS | 29390 |
| `bun run verify:explorer` | PASS | 323 |
| `node scripts/packaged-cli-smoke.mjs` | PASS | 4581 |
| `repo-harness run contract-run preflight --contract tasks/contracts/20260711-2005-data-engine-de5-cache-lifecycle-observability.contract.md --json` | PASS | 257 |
