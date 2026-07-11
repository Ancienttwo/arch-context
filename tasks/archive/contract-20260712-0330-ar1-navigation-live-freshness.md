> **Archived**: 2026-07-12 03:30
> **Related Plan**: plans/archive/plan-20260712-0317-ar1-navigation-live-freshness.md
> **Outcome**: Completed
> **Lifecycle**: contract
> **Parent Run ID**: run-20260712-0330

# Task Contract: ar1-navigation-live-freshness

> **Status**: Fulfilled
> **Plan**: plans/plan-20260712-0317-ar1-navigation-live-freshness.md
> **Task Profile**: code-change
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-07-12 03:17
> **Review File**: `tasks/reviews/20260712-0317-ar1-navigation-live-freshness.review.md`
> **Notes File**: `tasks/notes/20260712-0317-ar1-navigation-live-freshness.notes.md`

## Why

AR0 makes typed topology visible, but the current inline runtime appends duplicate
group expansion state, lacks visual navigation/accessibility, listens to only one SSE
event, and has no response CSP. AR1 closes those interaction and freshness gaps without
changing projection authority or query semantics.

## Falsifier

If exact navigation or freshness requires changing the public Explorer query/projection
contract, daemon compiler semantics, database state, or SSE producer payloads, stop AR1.
Do not add a compatibility runtime, retry fallback, ambient auth, or duplicate path.

## Goal

Deliver exact URL-preserving navigation, transient accessible topology controls,
fail-closed dual-SSE freshness, explicit disconnect state, and the declared daemon CSP
over the single AR0 renderer/runtime path.

## Scope

- In scope:
  - exact view/level/focus/breadcrumb/expand URL mutation;
  - fit/zoom/pan, keyboard, reduced-motion, narrow/no-JS behavior;
  - distinct debounced `authority-changed` and `projection-invalidated` handling;
  - disconnect/error state and exact HTML response CSP;
  - fake runtime, surface, daemon HTTP/SSE/token tests and readback.
- Out of scope:
  - contracts, schemas, view/compiler or SSE producer semantics, SQLite, ledger;
  - dependency/package/lockfile changes, browser framework, external assets;
  - compatibility runtime, retry fallback, ambient authentication.

## Workflow Inventory

- Source plan: `plans/plan-20260712-0317-ar1-navigation-live-freshness.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260712-0317-ar1-navigation-live-freshness.review.md`
- Notes file: `tasks/notes/20260712-0317-ar1-navigation-live-freshness.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: `scripts/verify-sprint.sh` must see this contract pass, the review recommend pass, and `## External Acceptance Advice` pass or record a manual override.

## Allowed Paths

```yaml
allowed_paths:
  - plans/plan-20260712-0317-ar1-navigation-live-freshness.md
  - tasks/contracts/20260712-0317-ar1-navigation-live-freshness.contract.md
  - tasks/reviews/20260712-0317-ar1-navigation-live-freshness.review.md
  - tasks/notes/20260712-0317-ar1-navigation-live-freshness.notes.md
  - packages/local-runtime/explorer-html/src/index.ts
  - packages/local-runtime/explorer-html/src/topology.ts
  - packages/local-runtime/explorer-html/test/runtime-script.test.ts
  - packages/surfaces/explorer-ui/test/explorer-ui.test.ts
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
  - docs/verification/explorer-ar1-navigation-freshness-readback.json
  - docs/verification/explorer-ar1-navigation-freshness-readback.md
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
    - packages/local-runtime/explorer-html/test/runtime-script.test.ts
    - docs/verification/explorer-ar1-navigation-freshness-readback.json
    - docs/verification/explorer-ar1-navigation-freshness-readback.md
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260712-0317-ar1-navigation-live-freshness.notes.md
    - tasks/reviews/20260712-0317-ar1-navigation-live-freshness.review.md
  tests_pass: []
  commands_succeed:
    - bun test packages/local-runtime/explorer-html/test/runtime-script.test.ts
    - bun test packages/surfaces/explorer-ui/test/explorer-ui.test.ts
    - bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
    - bun test packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts
    - bun run typecheck
    - bun run verify:explorer
  qa_scores: []
  manual_checks: []
```

## Acceptance Notes (Human Review)

- Functional behavior: exact URL state, transient visual controls, dual-SSE debounce,
  explicit disconnect state, exact CSP.
- Edge cases: duplicate expand values, editable keyboard focus, stale/same/mismatched/
  malformed SSE, burst events, token missing/expired, JavaScript disabled.
- Regression risks: token/query loss, reload loops, false freshness, external asset or
  executable URL, compiler/query semantic drift.

## Rollback Point

- Commit / checkpoint: branch base `b328f89`.
- Revert strategy: revert AR1 runtime/topology wrapper/CSP commit; no state rollback.
