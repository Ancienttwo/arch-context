# Task Contract: DE0 Authority-Separated Delta

> **Status**: Complete
> **Approved by**: explicit user choice on 2026-07-11 for a separate DE0 slice, full manifest in DE0, and explicit evidence lifecycle
> **Program Plan**: `plans/plan-20260711-1328-data-engine-authority-incremental.md`
> **Plan**: `plans/plan-20260711-1328-data-engine-authority-incremental.md`
> **Task Profile**: code-change
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-07-11 16:05
> **Review File**: `tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md`
> **Notes File**: `tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md`

## Goal

Complete only DE0 of the accepted data-engine program:

1. Projection delta compares compatible complete input manifests and can emit only
   projection changes.
2. Fact delta compares authoritative graph state at explicit base/head cursors.
3. Evidence delta compares authoritative evidence/binding lifecycle state at the
   same cursors, including explicit removal tombstones.
4. Delta query/response V2, daemon HTTP/RPC, CLI, schemas, fixtures, and tests move
   together; the digest-only V1 path is removed with no product compatibility path.

## Why

The current `compileExplorerProjectionDelta` compares two bounded projections and
labels top-N presence changes as architecture facts. A newly sorted subject can push
an unchanged subject outside the budget and fabricate a deletion. Evidence is also
inferred from rendered occurrence fields rather than an authoritative historical
state. Delta correctness must be fixed before change-feed, snapshot, planner, or
cache optimizations can safely depend on it.

## Scope

- In scope: `ProjectionInputManifestV1`; manifest digest on Explorer V2; explicit
  AuthorityCursor; ArchitectureEvent payload V2 evidence item/binding create/update/remove
  operations; evidence tombstones and state-at-cursor replay; pure fact/evidence/
  projection comparisons; delta query/response V2; all local daemon/HTTP/RPC/CLI
  callers; schemas/fixtures/tests; ADR-0045 DE0 decision section and DE0 evidence.
- Out of scope: DE1 transactional subject index/change feed, DE2 snapshot-anchor
  acceleration/direct scope lookup, DE3 manifest-addressed cache hardening, DE4 read
  planner, DE5 retention/telemetry, Explorer Global Subject Search, UI redesign,
  cloud sync, and SQLite authority promotion.

## Migration Contract

- Historical ArchitectureEvent payload V1 `evidenceItems` and `evidenceBindings` replay as
  immutable create operations. Repeated IDs are valid only when canonical digests
  are identical; conflicting duplicates fail closed.
- New writers emit ArchitectureEvent payload V2 lifecycle operations under the
  existing event envelope. `create` requires no
  live/tombstoned ID, `update` requires a matching previous digest, and `remove`
  requires a live value and writes a tombstone.
- This historical V1 rule is bounded to replay of already-persisted events. No new
  writer or external request may submit the V1 evidence shape after DE0.

## Allowed Paths

```yaml
allowed_paths:
  - docs/adr/ADR-0045-authority-separated-data-engine.md
  - docs/adr/README.md
  - docs/verification/data-engine-de0-readback.md
  - docs/verification/data-engine-de0-readback.json
  - plans/plan-20260711-1328-data-engine-authority-incremental.md
  - tasks/todos.md
  - tasks/contracts/20260711-1328-data-engine-authority-incremental.contract.md
  - tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md
  - tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md
  - packages/contracts/src/ledger.ts
  - packages/contracts/src/ports.ts
  - packages/contracts/src/schema.ts
  - packages/contracts/src/validator.ts
  - packages/contracts/test/contracts.test.ts
  - packages/contracts/fixtures/boundary/architecture-event-extension.json
  - packages/contracts/fixtures/boundary/explorer-projection-v2-budget.json
  - packages/contracts/fixtures/invalid/architecture-event-source-body-field.json
  - packages/contracts/fixtures/invalid/explorer-projection-v2-derived-subject.json
  - packages/contracts/fixtures/valid/architecture-event.json
  - packages/contracts/fixtures/valid/explorer-delta-query.json
  - packages/contracts/fixtures/valid/explorer-projection-delta.json
  - packages/contracts/fixtures/valid/explorer-projection-v2.json
  - schemas/runtime/architecture-event.schema.json
  - schemas/runtime/explorer-delta-query.schema.json
  - schemas/runtime/explorer-projection-delta.schema.json
  - schemas/runtime/explorer-projection-v2.schema.json
  - packages/core/architecture-delta/src/index.ts
  - packages/core/architecture-delta/test/architecture-delta.test.ts
  - packages/core/architecture-ledger/src/index.ts
  - packages/core/architecture-ledger/test/architecture-ledger.test.ts
  - packages/local-runtime/local-store-sqlite/src/index.ts
  - packages/local-runtime/local-store-sqlite/test/factories.ts
  - packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts
  - packages/local-runtime/runtime-daemon/src/explorer-projection.ts
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts
  - packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
  - packages/surfaces/cli/src/main.ts
  - packages/surfaces/cli/test/cli.test.ts
  - packages/surfaces/explorer-ui/test/explorer-ui.test.ts
  - scripts/data-engine-de0-readback.ts
  - scripts/explorer-view-compiler-readback.mjs
  - scripts/architecture-ledger-al10-release-packaging-readback.ts
  - scripts/architecture-ledger-al10-release-packaging-readback.test.ts
  - scripts/architecture-ledger-al10-representative-benchmark-readback.ts
  - scripts/architecture-ledger-al7-book-readback.ts
  - package.json
```

## Delegation Contract

No subagent may mutate ledger, YAML, docs, policy, waiver, or this worktree. The
independent plan reviewer was read-only. Implementation remains in the owning
worktree.

## Stop Conditions

- A required DE0 path falls outside Allowed Paths.
- The existing event chain cannot distinguish historical V1 evidence creates from
  V2 lifecycle operations without rewriting authoritative events.
- Any implementation needs heuristic reconstruction, semantic fallback, or direct
  SQLite mutation outside the daemon/ChangeSet transaction boundary.
- A required input domain cannot produce a canonical digest for the complete
  projection manifest.

## Exit Criteria (Machine Verifiable)

```yaml
exit_criteria:
  files_exist:
    - docs/adr/ADR-0045-authority-separated-data-engine.md
    - docs/verification/data-engine-de0-readback.json
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md
    - tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md
  commands_succeed:
    - bun run typecheck
    - bun test packages/contracts/test/contracts.test.ts
    - bun test packages/core/architecture-delta packages/core/architecture-ledger
    - bun test packages/local-runtime/local-store-sqlite packages/local-runtime/runtime-daemon
    - bun test packages/surfaces/cli packages/surfaces/explorer-ui
    - bun run verify:explorer
    - bun run verify
  manual_checks:
    - "Budget displacement produces only projection changes"
    - "Illegal evidence lifecycle transitions fail closed"
    - "Delta V1 has no daemon HTTP RPC CLI or schema consumer"
    - "Independent evaluator review recommends pass"
```

## Acceptance Notes

- Fact/evidence delta output is impossible without explicit compatible authority
  cursors; projection output is impossible without compatible complete manifests.
- Manifest digest changes for query, graph, observed facts, evidence/bindings,
  backlinks, drift, pressure, task session, view definition, or compiler changes.
- Cross-repository/worktree cursors, reversed base/head, missing events, stale
  projection manifests, conflicting historical V1 evidence IDs, and illegal V2
  lifecycle transitions all reject with stable reason codes.

## Rollback Point

- Checkpoint: DE0 branch commit before DE1 begins.
- Revert strategy: revert the DE0 code/schema migration before release. Do not edit
  or delete authoritative event history; the bounded V1 historical replay rule
  remains the only migration input.
