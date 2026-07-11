# Data Engine DE5 Readback

- Verdict: **PASS**
- Generated: 2026-07-11T12:38:33.603Z
- Baseline commit: `c48969451d45c9a082d019e6cb2e035a5d1a2fab`
- Source digest: `sha256:6db423d5eaac8ba1fd86cac9906f485cb468e4eecd0d08829821a79375470a31`
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
| 100000 | 99999 | 0.68 | 50 | 49 | PASS |

## Commands

| Command | Status | Duration ms |
|---|---|---:|
| `bun run typecheck` | PASS | 4812 |
| `bun test packages/local-runtime/local-store-sqlite packages/local-runtime/runtime-daemon` | PASS | 27980 |
| `bun run verify:explorer` | PASS | 285 |
| `node scripts/packaged-cli-smoke.mjs` | PASS | 5561 |
| `repo-harness run contract-run preflight --contract tasks/contracts/20260711-2005-data-engine-de5-cache-lifecycle-observability.contract.md --json` | PASS | 276 |
