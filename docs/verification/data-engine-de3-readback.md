# Data Engine DE3 Readback

- Verdict: **PASS**
- Generated: 2026-07-11T10:32:53.805Z
- Commit: `d28fae1575a2cf0eaf321975e644332154e21ee1`
- Branch: `codex/data-engine-authority-incremental`

## Invariants

| Invariant | Status |
|---|---|
| typedViewDomainPolicy | PASS |
| requiredDomainsFailClosed | PASS |
| explicitAuthorityBinding | PASS |
| optionalMissingDiffersFromEmpty | PASS |
| exactManifestCacheLookup | PASS |
| storedBodyAndRowIntegrity | PASS |
| viewPolicyChangesIdentity | PASS |
| productionTestStoreParity | PASS |
| invalidationPrecedesExactHit | PASS |
| exactHitAndNegativeCoverage | PASS |
| compatibilityAllowsStateChange | PASS |
| migrationIsOneWay | PASS |

## Commands

| Command | Status | Duration ms |
|---|---|---:|
| `bun run typecheck` | PASS | 3495 |
| `bun run check:package-boundaries` | PASS | 101 |
| `bun test packages/contracts/test/contracts.test.ts packages/local-runtime/local-store-sqlite packages/local-runtime/runtime-daemon packages/surfaces/cli/test/cli.test.ts scripts/architecture-ledger-al10-release-packaging-readback.test.ts` | PASS | 49409 |
| `bun run verify:explorer` | PASS | 5122 |
| `node scripts/packaged-cli-smoke.mjs` | PASS | 4497 |
| `repo-harness run contract-run preflight --contract tasks/contracts/20260711-1749-data-engine-de3-manifest-cache.contract.md --json` | PASS | 252 |
