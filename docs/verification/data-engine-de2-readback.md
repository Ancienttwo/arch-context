# Data Engine DE2 Readback

- Verdict: **PASS**
- Generated: 2026-07-11T09:44:16.921Z
- Commit: `70be09a0ffde0b766862509d43a50439afbdac81`
- Branch: `codex/data-engine-authority-incremental`

## Invariants

| Invariant | Status |
|---|---|
| snapshotCarriesGraphAndEvidence | PASS |
| exactSequenceIdHashAnchor | PASS |
| newestBoundedAnchor | PASS |
| hotReplayHasNoPrefixCount | PASS |
| eventCountCheckpointIsImmutableAndScoped | PASS |
| independentGenesisAudit | PASS |
| completeRowIntegrityBinding | PASS |
| directIndexedScopeReads | PASS |
| compactRequiresVerifiedAnchor | PASS |
| explorerUsesAnchoredReplay | PASS |
| corruptionAndTailTests | PASS |
| migrationIsV2Only | PASS |

## Commands

| Command | Status | Duration ms |
|---|---|---:|
| `bun run typecheck` | PASS | 3235 |
| `bun run check:package-boundaries` | PASS | 104 |
| `bun test packages/contracts/test/contracts.test.ts packages/core/architecture-ledger packages/local-runtime/local-store-sqlite packages/local-runtime/runtime-daemon packages/surfaces/cli/test/cli.test.ts scripts/architecture-ledger-al10-release-packaging-readback.test.ts` | PASS | 48434 |
| `bun run verify:explorer` | PASS | 2347 |
| `repo-harness run contract-run preflight --contract tasks/contracts/20260711-1720-data-engine-de2-snapshot-replay.contract.md --json` | PASS | 452 |
