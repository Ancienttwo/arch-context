# Task Contract: DE4 Bounded Projection Read Planner

> **Status**: Complete
> **Approved by**: accepted DE0-DE5 program plan and explicit user instruction to execute the complete Sprint sequentially
> **Program Plan**: `plans/plan-20260711-1328-data-engine-authority-incremental.md`
> **Task Profile**: code-change
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-07-11 20:02
> **Review File**: `tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md`
> **Notes File**: `tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md`

## Goal

Complete only DE4 of the accepted data-engine program:

1. Add a canonical `ProjectionReadPlanV1` with a stable planner version, explicit
   authority read source, typed plan kind, required domains, ordering, hard row limits,
   authoritative totals, actual rows read, selected read-set digest, and truncation.
2. Execute overview as aggregate/group reads, context as bounded current-state reads,
   and focus/detail through the existing recursive-CTE neighborhood reader.
3. Read only selected bindings and event backlinks for the planned graph subjects.
4. Refactor the compiler to consume the selected graph/read set plus authoritative
   totals without silently expanding beyond the plan.
5. Prove ledger-backed focus/detail paths never call the full-graph reader and retain
   deterministic ordering, cache identity, and truncation semantics.

## Why

DE2 bounded replay history, and DE3 bounded cache identity, but Explorer compilation
still receives the complete graph, sorts every entity/relation, and scans all event
backlinks before applying a UI budget. At 10x scale this makes focus/detail latency and
peak memory proportional to repository size. DE4 moves the selection boundary into an
explicit authority-aware read plan so the compiler cannot accidentally regain a full
read while preserving exact Git/ledger ownership.

## Authority Boundary

- Git-visible `.archcontext/` remains product authority. A null ledger cursor never
  authorizes SQLite current-state rows as graph truth.
- Partial SQLite reads are allowed only when the verified ledger cursor binds the exact
  repository/worktree/full graph digest/evidence-state digest used by the manifest.
- Graph and evidence authority are explicit independently. A Git graph projection may
  retain bounded ledger evidence/backlinks only through a separate verified
  `evidenceAuthorityCursor` bound into the cursor, manifest, authority digest, and cache.
- Git-authority requests use an explicit `git-authority` read source. They may select a
  bounded compiler read set only from the already verified Git state; they do not claim
  a partial SQLite optimization and never substitute stale operational rows.
- The read planner is a projection optimization. It cannot change fact/evidence delta
  authority or synthesize missing graph/evidence/observed inputs.

## Scope

- In scope: read-plan contracts; planner selection; bounded SQLite graph/aggregate/
  binding/backlink readers; compiler selected-set/totals input; manifest planner/read-set
  identity; TestLocalStore parity; focused/context/overview integration tests; readback.
- Out of scope: cache retention/GC/pins/metrics (DE5), Global Subject Search, UI redesign,
  cloud sync, ledger authority promotion, or changing Git-visible model ownership.

## Allowed Paths

```yaml
allowed_paths:
  - docs/adr/ADR-0045-authority-separated-data-engine.md
  - docs/verification/data-engine-de4-readback.json
  - docs/verification/data-engine-de4-readback.md
  - package.json
  - plans/plan-20260711-1328-data-engine-authority-incremental.md
  - tasks/contracts/20260711-1836-data-engine-de4-bounded-read-planner.contract.md
  - tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md
  - tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md
  - packages/contracts/src/ports.ts
  - packages/contracts/test/contracts.test.ts
  - packages/contracts/fixtures/valid/explorer-projection-v2.json
  - packages/contracts/fixtures/invalid/explorer-projection-v2-derived-subject.json
  - packages/contracts/fixtures/boundary/explorer-projection-v2-budget.json
  - schemas/runtime/explorer-projection-v2.schema.json
  - packages/local-runtime/local-store-sqlite/src/index.ts
  - packages/local-runtime/local-store-sqlite/test/factories.ts
  - packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts
  - packages/local-runtime/runtime-daemon/src/explorer-projection.ts
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts
  - packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
  - packages/surfaces/explorer-ui/test/explorer-ui.test.ts
  - scripts/explorer-view-compiler-readback.mjs
  - scripts/packaged-cli-smoke.mjs
  - scripts/data-engine-de4-readback.ts
```

## Invariants

- Planner choice is pure and deterministic for canonical query + authority source.
- Every SQL statement has a hard plan-derived limit. Actual rows read cannot exceed the
  plan; limit overflow is explicit truncation or a stable precondition error.
- The compiler consumes only the selected graph/read set and explicit totals. It has no
  local-store dependency and cannot issue hidden expansion reads.
- `graphDigest` remains the full authoritative graph digest. `selectedGraphDigest` binds
  the partial compiler input. Both, plus the complete plan, contribute to the manifest.
- Focus/detail on verified ledger current state uses a recursive frontier capped at
  `maxEntities + 1` for overflow detection and never calls
  `readArchitectureLedgerState`. Overview uses aggregate counts/groups; context reads a
  bounded canonical prefix/frontier.
- Selected current graph/evidence/binding/backlink rows are re-proven against immutable
  event payload/hash/scope and latest-subject or change-feed digests before compilation.
- Selected binding/backlink rows are scoped to selected subjects and remain digest-only/
  metadata-only. No raw source, diff, prompt/completion, or full CodeGraph body persists.

## Stop Conditions

- A null/unverified ledger cursor is allowed to authorize SQLite graph rows.
- Focus/detail still calls the full SQLite graph reader before applying its budget.
- The compiler computes full-authority digests or totals from a partial read set.
- An overflow silently widens SQL limits or invents missing rows.

## Exit Criteria

```yaml
exit_criteria:
  files_exist:
    - docs/verification/data-engine-de4-readback.json
  commands_succeed:
    - bun run typecheck
    - bun test packages/contracts/test/contracts.test.ts packages/local-runtime/local-store-sqlite packages/local-runtime/runtime-daemon
    - bun run record:de4:data-engine
    - bun run readback:de4:data-engine
    - bun run verify:explorer
    - bun run verify
  manual_checks:
    - "Planner output is canonical and included in the manifest digest"
    - "Verified-ledger focus/detail executes no full graph read"
    - "Git authority never reads stale SQLite graph rows"
    - "Rows read stay within hard plan limits and truncation is explicit"
    - "Overview/context/focus outputs remain deterministic for identical inputs"
```

## Rollback Point

- Checkpoint: DE4 commit after DE3 commit `1990df6`.
- Revert strategy: revert the DE4 checkpoint. Read plans and cache rows are disposable;
  never edit authoritative events, verified snapshots, or Git-visible model files.
