> **Archived**: 2026-07-12 03:16
> **Related Plan**: plans/archive/plan-20260712-0301-ar0-deterministic-topology-kernel.md
> **Outcome**: Completed
> **Lifecycle**: contract
> **Parent Run ID**: run-20260712-0316

# Task Contract: ar0-deterministic-topology-kernel

> **Status**: Fulfilled
> **Plan**: plans/plan-20260712-0301-ar0-deterministic-topology-kernel.md
> **Task Profile**: code-change
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-07-12 03:01
> **Review File**: `tasks/reviews/20260712-0301-ar0-deterministic-topology-kernel.review.md`
> **Notes File**: `tasks/notes/20260712-0301-ar0-deterministic-topology-kernel.notes.md`

## Why

The data-engine and projection contracts are complete, but the current card renderer
hides the typed relation topology and performs a relation scan for every subject. A
pure deterministic SVG consumer makes the existing bounded authority legible without
creating a second semantic or persistence layer.

## Falsifier

If the public-maximum 1,000-node/5,000-relation projection cannot render within the
declared 500 ms p95 and 8 MiB body budget using O(N + E) indexing without dropping
returned items, stop AR0 and revise the product budget; do not add a compatibility
renderer, hidden preload, or semantic omission.

## Goal

Replace the current Explorer card topology with one deterministic, self-contained SVG
renderer over the already bounded `ExplorerProjectionV2`, retaining the relation table
and Inspector while proving O(N + E) work, byte determinism, privacy, and declared
default/public-maximum budgets.

## Scope

- In scope:
  - pure package-internal topology indexes, three layouts, geometry, escaping, SVG;
  - explorer HTML renderer cutover with existing table/Inspector retained;
  - topology/surface tests and default/max readback evidence.
- Out of scope:
  - contracts, schemas, daemon query/SSE behavior, SQLite, ledger, cache semantics;
  - navigation, CSP/runtime-script behavior, new views, Inspector history;
  - dependencies, CDN/external assets, Mermaid parser, hidden preload;
  - compatibility renderer, V1/V2 semantic fork, heuristic/fallback output.

## Workflow Inventory

- Source plan: `plans/plan-20260712-0301-ar0-deterministic-topology-kernel.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260712-0301-ar0-deterministic-topology-kernel.review.md`
- Notes file: `tasks/notes/20260712-0301-ar0-deterministic-topology-kernel.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: `scripts/verify-sprint.sh` must see this contract pass, the review recommend pass, and `## External Acceptance Advice` pass or record a manual override.

## Allowed Paths

```yaml
allowed_paths:
  - plans/plan-20260712-0301-ar0-deterministic-topology-kernel.md
  - tasks/contracts/20260712-0301-ar0-deterministic-topology-kernel.contract.md
  - tasks/reviews/20260712-0301-ar0-deterministic-topology-kernel.review.md
  - tasks/notes/20260712-0301-ar0-deterministic-topology-kernel.notes.md
  - packages/local-runtime/explorer-html/src/index.ts
  - packages/local-runtime/explorer-html/src/topology.ts
  - packages/local-runtime/explorer-html/test/topology.test.ts
  - packages/surfaces/explorer-ui/test/explorer-ui.test.ts
  - scripts/explorer-view-compiler-readback.mjs
  - docs/verification/explorer-ar0-topology-readback.json
  - docs/verification/explorer-ar0-topology-readback.md
```

## Delegation Contract

```yaml
delegation:
  budget:
    tokens: null
    tool_calls: null
    wall_time_minutes: null
  permission_scope:
    mode: inherit_allowed_paths
    writable_paths: []
    network: inherited
  roles:
    parent:
      mode: narrate_and_gatekeep
      purpose: approval_checkpoint_owner
    explorer:
      mode: read_only
      purpose: codebase_research
    worker:
      mode: edit_within_allowed_paths
      purpose: implementation
    verifier:
      mode: read_only
      purpose: exit_criteria_review
```

## Exit Criteria (Machine Verifiable)

```yaml
exit_criteria:
  files_exist:
    - packages/local-runtime/explorer-html/src/topology.ts
    - packages/local-runtime/explorer-html/test/topology.test.ts
    - docs/verification/explorer-ar0-topology-readback.json
    - docs/verification/explorer-ar0-topology-readback.md
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260712-0301-ar0-deterministic-topology-kernel.notes.md
    - tasks/reviews/20260712-0301-ar0-deterministic-topology-kernel.review.md
  tests_pass: []
  commands_succeed:
    - bun test packages/local-runtime/explorer-html/test/topology.test.ts
    - bun test packages/surfaces/explorer-ui/test/explorer-ui.test.ts
    - bun test packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts
    - bun run typecheck
    - bun run verify:explorer
  qa_scores: []
  manual_checks: []
```

## Acceptance Notes (Human Review)

- Functional behavior: overview/context/detail render the exact bounded V2 graph.
- Edge cases: empty, cycles, loops, parallel edges, disconnected/missing endpoints,
  long Unicode/hostile labels, reversed arrays, maximum public budget.
- Regression risks: relation table/Inspector accessibility, query/compiler behavior,
  privacy denylist, body size, render latency.

## Rollback Point

- Commit / checkpoint: branch base `6817d82`.
- Revert strategy: revert AR0 code/readback commit; no data/cache/ledger operation.
