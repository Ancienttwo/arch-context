# Task Contract: Complete Authority-Aware Explorer View Compiler

> **Status**: Approved
> **Approved by**: explicit user goal on 2026-07-11 to complete the entire Sprint
> **Program**: `plans/sprints/archctx-explorer-view-compiler.md`
> **Plan**: `plans/plan-20260711-1100-explorer-view-compiler-complete.md`

## Allowed Paths

- `docs/adr/ADR-0044-authority-aware-explorer-view-compiler.md`
- `docs/runbooks/explorer-projection-v2-migration.md`
- `docs/verification/explorer-view-compiler-readback.json`
- `plans/sprints/archctx-explorer-view-compiler.md`
- `plans/plan-20260711-1100-explorer-view-compiler-complete.md`
- `tasks/contracts/20260711-1100-explorer-view-compiler-complete.contract.md`
- `tasks/notes/20260711-1100-explorer-view-compiler-complete.notes.md`
- `tasks/reviews/20260711-1100-explorer-view-compiler-complete.review.md`
- `packages/contracts/src/ports.ts`
- `packages/contracts/src/product-version.ts`
- `packages/contracts/test/contracts.test.ts`
- `packages/contracts/fixtures/valid/product-version-manifest.json`
- `packages/contracts/fixtures/{valid,invalid,boundary}/explorer-*`
- `schemas/runtime/explorer-*`
- `packages/local-runtime/explorer-html/src/index.ts`
- `packages/local-runtime/local-store-sqlite/src/index.ts`
- `packages/local-runtime/local-store-sqlite/test/factories.ts`
- `packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts`
- `packages/local-runtime/runtime-daemon/src/explorer-projection.ts`
- `packages/local-runtime/runtime-daemon/src/index.ts`
- `packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts`
- `packages/local-runtime/runtime-daemon/test/local-runtime.test.ts`
- `packages/surfaces/explorer-ui/test/explorer-ui.test.ts`
- `packages/surfaces/cli/src/main.ts`
- `packages/surfaces/cli/test/cli.test.ts`
- `scripts/explorer-view-compiler-readback.mjs`
- `scripts/architecture-ledger-al10-release-packaging-readback.ts`
- `scripts/architecture-ledger-al10-release-packaging-readback.test.ts`
- `scripts/packaged-cli-smoke.mjs`
- `scripts/privacy-route-audit.mjs`
- `package.json`

## Exit Criteria

- Every EV1–EV4 checklist item has direct current-state evidence.
- V1 projection has no runtime/CLI/HTML consumer or route.
- Task-impact rejects missing/stale task sessions.
- Drift-pressure is based on real drift/pressure/binding inputs.
- Delta requires compatible explicit base/head projections and separates all three classes.
- Dependency index is rebuildable and SSE contains digests only.
- 10k and 100k inputs stay within output budgets with measured p95.
- Full `bun run verify` passes.
