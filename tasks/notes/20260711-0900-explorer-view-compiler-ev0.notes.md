# Implementation Notes: Explorer View Compiler EV0

## Starting state

- Branch: `codex/explorer-view-compiler`
- Base: `main@aacccf16fea8ca49bb386048061725bf8bf13e5e`
- Worktree was clean before plan/implementation files were added.
- No database migration or ledger authority promotion is in scope.

## Decisions carried from the program

- Entire EV0–EV4 program is durable in
  `plans/sprints/archctx-explorer-view-compiler.md`.
- EV0 implements only the common protocol foundation and `system-map`.
- V1 coexistence is temporary and bounded by `0.3.0` removal.

## Verification log

- `bun install --frozen-lockfile` — restored the lockfile-pinned CodeGraph 1.4.0;
  the pre-existing local `node_modules` contained 1.0.1 and initially caused two
  unrelated resolver tests to fail.
- Focused contracts + compiler tests — 156 pass, 0 fail.
- Focused Explorer HTTP test — 1 pass, 0 fail.
- Focused CLI test — 1 pass, 0 fail.
- Focused CodeGraph adapter test after dependency repair — 8 pass, 0 fail.
- `bun run typecheck` — pass.
- `node scripts/package-boundary-audit.mjs` — pass.
- `node scripts/privacy-route-audit.mjs` — pass.
- `bun test` — 1,020 pass, 0 fail, 6,156 expectations across 139 files.
- `bun run verify` — pass, including package boundary, production mock
  reachability, practice gates, full tests, packaged CLI smoke, privacy/security
  audits, acceptance ledgers, sprint status, and representative evals.

## Delivered behavior

- V2 query/projection types, JSON Schemas, and positive/negative/boundary fixtures.
- Pure `compileSystemMapProjection` with stable occurrence IDs, ordering, digests,
  cursor preconditions, focus/expansion depth, and hard budgets.
- Daemon-selected authority-mode graph plus bounded CodeGraph observations and
  accepted EvidenceBinding reconciliation.
- Additive RPC, token-authenticated GET `/projection/v2`, and
  `archctx explore projection-v2` readback.
- Explicit V1 consumer inventory and mandatory removal before `0.3.0`.
