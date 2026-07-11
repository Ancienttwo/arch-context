# Plan: Complete Authority-Aware Explorer View Compiler

> **Status**: Complete
> **Created**: 20260711-1100
> **Slug**: `explorer-view-compiler-complete`
> **Program Authority**: `plans/sprints/archctx-explorer-view-compiler.md`
> **Decision**: `docs/adr/ADR-0044-authority-aware-explorer-view-compiler.md`
> **Task Contract**: `tasks/contracts/20260711-1100-explorer-view-compiler-complete.contract.md`
> **Task Review**: `tasks/reviews/20260711-1100-explorer-view-compiler-complete.review.md`
> **Implementation Notes**: `tasks/notes/20260711-1100-explorer-view-compiler-complete.notes.md`

## Objective

Complete the remaining EV1–EV4 phases without narrowing the accepted program:
move the HTML surface to V2, add authority-backed insight views, separate three
delta classes, add rebuildable dependency indexing and digest-only invalidation,
prove bounded scale/security, and remove the V1 runtime path.

## P1 · Map

- Contracts own view/query/projection/inspector/backlink/delta shapes.
- The pure compiler owns deterministic occurrences, views, budgets, and deltas.
- The daemon owns repository/worktree/task/cursor authority and SSE lifecycle.
- Runtime SQLite owns only rebuildable projection cache and dependency indexes.
- Explorer HTML is a self-contained, token-gated V2 reader.

## P2 · Trace

```text
HTML / CLI / HTTP query
→ daemon resolves repository, task session, graph, drift, events and CodeGraph
→ pure compiler emits bounded V2 view and typed inspector/backlinks
→ daemon replaces rebuildable dependency index and caches digest-addressed projection
→ HTML renders semantic level/focus/expand
→ a changed digest emits token-gated digest-only SSE invalidation
→ explicit base/head digest query emits fact/evidence/projection delta
```

## P3 · Decision

- No view is enabled without real inputs; task-impact requires a current persisted
  task session and drift-pressure requires evaluated drift/pressure/binding inputs.
- V1 runtime builders/routes/contracts are removed rather than kept behind an adapter.
- SQLite projection state is disposable cache, never architecture authority.
- SSE carries digests only; clients refetch the token-authenticated projection.

## Task Breakdown

- [x] EV1: V2 HTML, view switcher, breadcrumb, focus/expand, semantic levels, budgets.
- [x] EV2: Inspector, backlinks, task-impact, drift-pressure, authority states.
- [x] EV3: fact/evidence/projection delta contracts, compiler, API and tests.
- [x] EV4: SQLite dependency index/cache, digest-only SSE, 10k/100k benchmark.
- [x] Remove V1 runtime builder, routes, CLI path, HTML consumer and tests.
- [x] Add security, malformed input, stale cursor/task, denial-budget and packaged smoke evidence.
- [x] Complete program checklist, notes, review, readback and full verification.
