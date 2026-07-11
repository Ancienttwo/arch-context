# Implementation Notes: Complete Authority-Aware Explorer View Compiler

## Starting state

- Branch: `codex/explorer-view-compiler`
- Base: `main@aacccf16fea8ca49bb386048061725bf8bf13e5e`
- EV0 is complete and verified; EV1–EV4 are open.
- Existing worktree changes are the EV0 program and implementation from this task.

## Verification log

- `bun run typecheck` — pass.
- Focused contracts/compiler/SQLite/Explorer HTML tests — pass.
- Explorer HTTP integration — token, CSP self-connect, V2 HTML/projection,
  task current/missing/stale, drift-pressure, delta, SSE, malformed repository,
  stale cursor, denial budget, revocation — pass.
- `bun test` — 1,027 pass, 0 fail, 6,192 expectations across 139 files.
- `bun run verify:explorer` — pass. 10k p95 36.07 ms; 100k p95 598.07 ms;
  both returned 50 nodes/49 relations under 50/100 budgets; no forbidden fields.
- `node scripts/packaged-cli-smoke.mjs` — pass, including declared-only system
  map when CodeGraph is explicitly unavailable.
- package boundary, production mock reachability, privacy route, diff check — pass.
- `bun run verify` — pass, including full tests, Explorer scale gate, packaged
  smoke, security/privacy audits, acceptance ledgers, sprint status and evals.
- Deep ship review fixed latest-projection cache ordering for same-millisecond
  writes and added a deterministic SQLite regression test; the full verify gate
  passed again after the fix.
- `claude-review` was invoked as a read-only cross-model gate, but the installed
  Claude account returned `session limit`; no second-model result was available.

## Delivered state

- V2 is the only public/runtime Explorer projection contract.
- `system-map`, daemon-owned `task-impact`, and evaluated `drift-pressure` views.
- Typed Inspector, backlinks, authority states, semantic zoom and hard budgets.
- Explicit architecture-fact/evidence/projection deltas from cached base/head digests.
- Rebuildable SQLite projection cache/dependency index and affected-occurrence invalidation.
- Token-authenticated digest-only SSE; CSP permits only same-origin connection.
- V1 builder, RPC, HTTP routes, CLI semantic path, TypeScript types, schemas and fixtures removed.
