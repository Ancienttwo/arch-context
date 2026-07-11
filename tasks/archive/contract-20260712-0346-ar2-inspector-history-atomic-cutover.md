> **Archived**: 2026-07-12 03:46
> **Related Plan**: plans/archive/plan-20260712-0332-ar2-inspector-history-atomic-cutover.md
> **Outcome**: Completed
> **Lifecycle**: contract
> **Parent Run ID**: run-20260712-0346

# Task Contract: ar2-inspector-history-atomic-cutover

> **Status**: Fulfilled
> **Plan**: plans/plan-20260712-0332-ar2-inspector-history-atomic-cutover.md
> **Task Profile**: code-change
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-07-12 03:32
> **Review File**: `tasks/reviews/20260712-0332-ar2-inspector-history-atomic-cutover.review.md`
> **Notes File**: `tasks/notes/20260712-0332-ar2-inspector-history-atomic-cutover.notes.md`

## Why

The current Inspector exposes only decision-like event backlinks and omits verified
event-ID-only history and several typed facets. A required atomic history contract makes
the existing manifest-bound evidence legible without a second query or event-body path.

## Falsifier

If complete history cannot be derived solely from the bounded verified event backlinks
already in the input manifest, stop AR2. Do not add a DB/event-store query, optional
reader, legacy shape, compatibility adapter, or raw event body.

## Goal

Atomically require canonical `historyEvents` across TypeScript, JSON Schema, compiler,
fixtures, cache/RPC/CLI pass-through, and HTML while rendering all Inspector/backlink/
cursor facets and invalidating old cache shapes by view-definition digest.

## Scope

- In scope:
  - required public type/schema/fixture migration;
  - deterministic event backlink canonicalization, conflict rejection, history and
    decision subset compilation;
  - Inspector/backlink/cursor/digest HTML parity;
  - view-definition digest discriminator and cache/RPC/CLI/privacy tests.
- Out of scope:
  - database/event schema/body storage, new history query, migrations;
  - optional/legacy/compatibility readers or shape adapters;
  - new views, navigation semantics, package/lockfile changes.

## Workflow Inventory

- Source plan: `plans/plan-20260712-0332-ar2-inspector-history-atomic-cutover.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260712-0332-ar2-inspector-history-atomic-cutover.review.md`
- Notes file: `tasks/notes/20260712-0332-ar2-inspector-history-atomic-cutover.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: `scripts/verify-sprint.sh` must see this contract pass, the review recommend pass, and `## External Acceptance Advice` pass or record a manual override.

## Allowed Paths

```yaml
allowed_paths:
  - plans/plan-20260712-0332-ar2-inspector-history-atomic-cutover.md
  - tasks/contracts/20260712-0332-ar2-inspector-history-atomic-cutover.contract.md
  - tasks/reviews/20260712-0332-ar2-inspector-history-atomic-cutover.review.md
  - tasks/notes/20260712-0332-ar2-inspector-history-atomic-cutover.notes.md
  - packages/contracts/src/ports.ts
  - schemas/runtime/explorer-projection-v2.schema.json
  - packages/contracts/fixtures/valid/explorer-projection-v2.json
  - packages/contracts/test/contracts.test.ts
  - packages/local-runtime/runtime-daemon/src/explorer-projection.ts
  - packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts
  - packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
  - packages/local-runtime/explorer-html/src/index.ts
  - packages/local-runtime/explorer-html/test/topology.test.ts
  - packages/surfaces/explorer-ui/test/explorer-ui.test.ts
  - packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts
  - docs/verification/explorer-ar2-inspector-history-readback.json
  - docs/verification/explorer-ar2-inspector-history-readback.md
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
    - docs/verification/explorer-ar2-inspector-history-readback.json
    - docs/verification/explorer-ar2-inspector-history-readback.md
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260712-0332-ar2-inspector-history-atomic-cutover.notes.md
    - tasks/reviews/20260712-0332-ar2-inspector-history-atomic-cutover.review.md
  tests_pass: []
  commands_succeed:
    - bun test packages/contracts/test/contracts.test.ts
    - bun test packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts
    - bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
    - bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts
    - bun test packages/local-runtime/explorer-html/test/topology.test.ts
    - bun test packages/surfaces/explorer-ui/test/explorer-ui.test.ts
    - bun test packages/surfaces/cli/test/cli.test.ts
    - bun run typecheck
    - bun run verify:explorer
    - node scripts/privacy-route-audit.mjs
  qa_scores: []
  manual_checks: []
```

## Acceptance Notes (Human Review)

- Functional behavior: required complete canonical history, decision subset, full typed
  Inspector/backlink/cursor output, digest-addressed old-cache miss.
- Edge cases: empty, event-ID-only, duplicate identical, duplicate conflict, reversed,
  unbound observed, hostile/long metadata, missing field, private unknown field.
- Regression risks: incomplete atomic caller migration, raw body leakage, stale cached
  V2 shape, schema acceptance of the pre-history shape.

## Rollback Point

- Commit / checkpoint: branch base `c7329a4`.
- Revert strategy: revert the whole AR2 atomic contract commit; no data/cache rewrite.
