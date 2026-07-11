> **Archived**: 2026-07-12 04:08
> **Related Plan**: plans/archive/plan-20260712-0349-ar3-typed-domain-perspectives.md
> **Outcome**: Completed
> **Lifecycle**: contract
> **Parent Run ID**: run-20260712-0408

# Task Contract: ar3-typed-domain-perspectives

> **Status**: Fulfilled
> **Plan**: plans/plan-20260712-0349-ar3-typed-domain-perspectives.md
> **Task Profile**: code-change
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-07-12 03:49
> **Review File**: `tasks/reviews/20260712-0349-ar3-typed-domain-perspectives.review.md`
> **Notes File**: `tasks/notes/20260712-0349-ar3-typed-domain-perspectives.notes.md`

## Goal

Atomically extend Explorer V2 with typed `data-flow` and
`external-integrations` perspectives across contract, compiler, runtime, CLI, HTML,
and packaged product without inference, compatibility paths, or cache mutation.

## Why

Explorer already owns typed entity/relation authority but cannot answer the two
highest-value domain questions directly. Exact typed subgraphs make that authority
legible while keeping the daemon read plan as the sole scale and trust boundary.

## Falsifier

If either view requires names, paths, Mermaid/CodeGraph prose, a wider authority read,
a database migration, a cache rewrite, or a compatibility reader, stop AR3. Honest
empty output is required when the bounded typed input contains no match.

## Scope

- In scope:
  - atomic five-view public union/schema/fixture/runtime/CLI/package cutover;
  - exact typed data-flow and external-adjacency subgraph selection;
  - view-definition digest policies, overview/focus/backlink/budget semantics;
  - positive, adversarial negative, empty, stale, deterministic, and package evidence.
- Out of scope:
  - new entity/relation vocabularies, graph inference, parser authority;
  - name/path/prose inference, view aliases, fallback readers or compatibility adapters;
  - database/cache migrations, cache mutation, wider reads, browser semantics.

## Workflow Inventory

- Source plan: `plans/plan-20260712-0349-ar3-typed-domain-perspectives.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260712-0349-ar3-typed-domain-perspectives.review.md`
- Notes file: `tasks/notes/20260712-0349-ar3-typed-domain-perspectives.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: `scripts/verify-sprint.sh` must see this contract pass, the review recommend pass, and `## External Acceptance Advice` pass or record a manual override.

## Allowed Paths

```yaml
allowed_paths:
  - plans/plan-20260712-0349-ar3-typed-domain-perspectives.md
  - tasks/contracts/20260712-0349-ar3-typed-domain-perspectives.contract.md
  - tasks/reviews/20260712-0349-ar3-typed-domain-perspectives.review.md
  - tasks/notes/20260712-0349-ar3-typed-domain-perspectives.notes.md
  - packages/contracts/src/ports.ts
  - schemas/runtime/explorer-projection-query-v2.schema.json
  - schemas/runtime/explorer-projection-v2.schema.json
  - packages/contracts/fixtures/valid/explorer-projection-v2.json
  - packages/contracts/test/contracts.test.ts
  - packages/local-runtime/runtime-daemon/src/explorer-projection.ts
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts
  - packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
  - packages/surfaces/cli/src/main.ts
  - packages/surfaces/cli/test/cli.test.ts
  - packages/surfaces/explorer-ui/test/explorer-ui.test.ts
  - scripts/packaged-cli-smoke.mjs
  - docs/verification/ar3-domain-perspectives-readback.json
  - docs/verification/ar3-domain-perspectives-readback.md
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
    - docs/verification/ar3-domain-perspectives-readback.json
    - docs/verification/ar3-domain-perspectives-readback.md
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260712-0349-ar3-typed-domain-perspectives.notes.md
    - tasks/reviews/20260712-0349-ar3-typed-domain-perspectives.review.md
  tests_pass: []
  commands_succeed:
    - bun test packages/contracts/test/contracts.test.ts
    - bun test packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts
    - bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
    - bun test packages/surfaces/cli/test/cli.test.ts
    - bun test packages/surfaces/explorer-ui/test/explorer-ui.test.ts
    - bun run typecheck
    - bun run verify:explorer
    - bun run scripts/packaged-cli-smoke.mjs
  qa_scores: []
  manual_checks: []
```

## Acceptance Notes (Human Review)

- Functional behavior: exact typed flow/external subgraphs, canonical five-view
  catalog, manifest-addressed digest invalidation, honest empty output.
- Edge cases: adversarial names/paths, unrelated neighbor edges, zero typed matches,
  focus outside view, stale cursor, hard budgets, reversed inputs.
- Regression risks: incomplete atomic view union, accidental semantic inference,
  old digest reuse, generic surface/packaged command mismatch.

## Rollback Point

- Commit / checkpoint: branch base `17770d3`.
- Revert strategy: revert the whole AR3 atomic merge commit; do not rewrite cache or
  authoritative Git/ledger state.
