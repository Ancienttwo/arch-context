# Task Contract: Explorer View Compiler EV0

> **Status**: Approved
> **Approved by**: explicit user instruction on 2026-07-11
> **Program**: `plans/sprints/archctx-explorer-view-compiler.md`
> **Plan**: `plans/plan-20260711-0900-explorer-view-compiler-ev0.md`

## Allowed Paths

- `docs/adr/ADR-0044-authority-aware-explorer-view-compiler.md`
- `docs/adr/README.md`
- `docs/runbooks/explorer-projection-v2-migration.md`
- `plans/sprints/archctx-explorer-view-compiler.md`
- `plans/plan-20260711-0900-explorer-view-compiler-ev0.md`
- `tasks/contracts/20260711-0900-explorer-view-compiler-ev0.contract.md`
- `tasks/reviews/20260711-0900-explorer-view-compiler-ev0.review.md`
- `tasks/notes/20260711-0900-explorer-view-compiler-ev0.notes.md`
- `packages/contracts/src/ports.ts`
- `packages/contracts/src/product-version.ts`
- `packages/contracts/test/contracts.test.ts`
- `packages/contracts/fixtures/valid/explorer-projection-query-v2.json`
- `packages/contracts/fixtures/valid/explorer-projection-v2.json`
- `packages/contracts/fixtures/invalid/explorer-projection-query-v2-caller-scope.json`
- `packages/contracts/fixtures/invalid/explorer-projection-v2-derived-subject.json`
- `packages/contracts/fixtures/boundary/explorer-projection-v2-budget.json`
- `schemas/runtime/explorer-projection-query-v2.schema.json`
- `schemas/runtime/explorer-projection-v2.schema.json`
- `packages/local-runtime/runtime-daemon/src/explorer-projection.ts`
- `packages/local-runtime/runtime-daemon/src/index.ts`
- `packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts`
- `packages/local-runtime/runtime-daemon/test/local-runtime.test.ts`
- `packages/surfaces/cli/src/main.ts`
- `packages/surfaces/cli/test/cli.test.ts`

## Required Behavior

- V2 actual cursor and scope are daemon-owned.
- Query only carries an optional expected cursor precondition.
- System map is compiled from the current authority-mode graph.
- Occurrence identity never replaces canonical subject identity.
- Derived groups cannot appear in subject references.
- Declared/observed facts remain separate without accepted bindings.
- Output is deterministic and budget bounded.
- No raw source, diff, prompt/completion, or full CodeGraph body enters projection.
- V1 remains only as a bounded migration surface with removal before `0.3.0`.

## Exit Criteria

- Focused contracts/compiler/runtime/CLI tests pass.
- 10,000-entity input returns no more than requested budget.
- Reversed input order produces identical projection digest.
- Stale expected cursor returns `AC_PRECONDITION_FAILED`.
- Existing Explorer loopback/token/GET-only/no-egress test passes.
- Typecheck and package-boundary audit pass.
