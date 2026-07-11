# Plan: Explorer View Compiler EV0

> **Status**: Complete
> **Created**: 20260711-0900
> **Slug**: `explorer-view-compiler-ev0`
> **Program Authority**: `plans/sprints/archctx-explorer-view-compiler.md`
> **Decision**: `docs/adr/ADR-0044-authority-aware-explorer-view-compiler.md`
> **Task Contract**: `tasks/contracts/20260711-0900-explorer-view-compiler-ev0.contract.md`
> **Task Review**: `tasks/reviews/20260711-0900-explorer-view-compiler-ev0.review.md`
> **Implementation Notes**: `tasks/notes/20260711-0900-explorer-view-compiler-ev0.notes.md`
> **Verification Boundary**: contracts schema tests + compiler/runtime/CLI focused tests + typecheck + package boundary audit
> **Rollback Surface**: revert this branch; no database migration or authority promotion

## Objective

Implement only EV0 from the durable Explorer View Compiler program: freeze V2
query/projection contracts, add a pure deterministic `system-map` compiler,
connect it to daemon-selected authority-mode graph reads, expose additive V2
readback, and record the bounded V1 migration contract.

EV1–EV4 remain governed by the program plan and are explicitly not discarded or
redefined by this work package.

## P1 · Map

- Contracts own public query/projection shapes and schemas.
- Runtime daemon owns repository/worktree identity, actual cursor, accepted graph
  selection, CodeGraph reads, tokenized HTTP, and RPC.
- A new pure module inside `runtime-daemon` owns deterministic view compilation;
  it performs no filesystem, SQLite, network, clock, or daemon-session I/O.
- Existing V1 HTML remains unchanged in EV0.

## P2 · Trace

```text
CLI/RPC/GET /projection/v2
→ daemon opens session and resolves authority-mode readback
→ daemon gets bounded observed CodeFacts and current-scope bindings
→ compiler validates expected cursor and system-map query
→ compiler emits sorted, budgeted, digested V2 projection
→ JsonEnvelope readback
```

## P3 · Decision

- V2 is additive only for this slice because V1 still feeds the current HTML.
- Coexistence ends by the next minor release boundary (`0.3.0`) after EV1 migrates
  the HTML/CLI default; no new V1 consumer may be introduced.
- EV0 ships only `system-map`. Task/pressure views remain unavailable until real
  inputs exist.
- Unknown view, stale expected cursor, invalid budget, or unavailable accepted
  graph fails closed.

## Task Breakdown

- [x] Freeze V2 TypeScript contracts and JSON Schemas with positive/negative/boundary fixtures.
- [x] Add pure deterministic `compileSystemMapProjection` with occurrence/subject separation.
- [x] Enforce node/relation/depth budgets, truncation, omitted counts, stable sort, and digest.
- [x] Connect daemon authority-mode graph read; remove model-file pseudo-nodes from V2.
- [x] Keep observed subjects separate unless accepted bindings support reconciliation.
- [x] Add V2 RPC, HTTP, and CLI readback without changing V1 HTML.
- [x] Record V1 consumer inventory and removal boundary.
- [x] Verify 10,000-entity bounded output, stale cursor rejection, determinism, privacy, and existing Explorer security.
- [x] Update program checklist, notes, and review evidence.

## Stop Conditions

- Stop if implementation needs heuristic name/path matching.
- Stop if accepted graph cannot be read through the current authority-mode path.
- Stop if V1 coexistence loses its named removal boundary.
- Stop if V2 exposes source bodies, raw diffs, or caller-owned scope authority.
