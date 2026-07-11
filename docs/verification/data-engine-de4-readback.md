# Data Engine DE4 Readback

- Verdict: **PASS**
- Generated: 2026-07-11T11:51:22.929Z
- Commit: `1990df630c9e08d6a41c01ad68afa2272cd087aa`
- Branch: `codex/data-engine-authority-incremental`

## Invariants

| Invariant | Status |
|---|---|
| canonicalTypedPlan | PASS |
| manifestBindsPlanAndReadSet | PASS |
| verifiedCursorBindsPartialSqlite | PASS |
| boundedFocusNoFullGraphRead | PASS |
| boundedGraphAndMetadataSql | PASS |
| actualRowsAndAuthoritativeTotals | PASS |
| gitAuthoritySelectsFromGitState | PASS |
| compilerHasNoStoreDependency | PASS |

## Commands

| Command | Status | Duration ms |
|---|---|---:|
| `bun run typecheck` | PASS | 4290 |
| `bun test packages/contracts/test/contracts.test.ts packages/local-runtime/local-store-sqlite packages/local-runtime/runtime-daemon` | PASS | 28730 |
| `bun run verify:explorer` | PASS | 245 |
| `node scripts/packaged-cli-smoke.mjs` | PASS | 6223 |
| `repo-harness run contract-run preflight --contract tasks/contracts/20260711-1836-data-engine-de4-bounded-read-planner.contract.md --json` | PASS | 303 |
