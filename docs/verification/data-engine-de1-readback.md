# Data Engine DE1 Readback

- Verdict: **PASS**
- Generated: 2026-07-11T08:49:27.794Z
- Commit: `5cef4ace889712c7b1faffe8df3b4835cfaf06e9`
- Branch: `codex/data-engine-authority-incremental`

## Invariants

| Invariant | Status |
|---|---|
| transactionalOutbox | PASS |
| typedSubjectIndex | PASS |
| durableMonotonicFeed | PASS |
| indexedBacklinks | PASS |
| feedDrivenInvalidation | PASS |
| digestOnlySse | PASS |
| crashAndRestartRecovery | PASS |
| evidenceBindingInvalidation | PASS |

## Commands

| Command | Status | Duration ms |
|---|---|---:|
| `bun run typecheck` | PASS | 4580 |
| `bun run check:package-boundaries` | PASS | 273 |
| `bun test packages/contracts/test/contracts.test.ts packages/local-runtime/local-store-sqlite packages/local-runtime/runtime-daemon scripts/architecture-ledger-al10-release-packaging-readback.test.ts` | PASS | 25631 |
| `bun run verify:explorer` | PASS | 2457 |
| `repo-harness run contract-run preflight --contract tasks/contracts/20260711-1605-data-engine-de1-change-feed.contract.md --json` | PASS | 289 |
