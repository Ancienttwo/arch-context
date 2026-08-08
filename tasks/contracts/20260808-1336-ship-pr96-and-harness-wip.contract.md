# Task Contract: ship-pr96-and-harness-wip

> **Status**: Partial
> **Plan**: plans/plan-20260808-1336-ship-pr96-and-harness-wip.md
> **Task Profile**: code-change
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-08-08 13:36
> **Review File**: `tasks/reviews/20260808-1336-ship-pr96-and-harness-wip.review.md`
> **Notes File**: `tasks/notes/20260808-1336-ship-pr96-and-harness-wip.notes.md`

## Goal

Publish the already-audited repo-harness 0.13.2 repo-local refresh as a separate
PR on top of merged PR #96, while preserving `.archcontext/` as Git-visible
architecture truth and keeping only `.archcontext/.local/` ignored runtime state.

## Scope

- In scope: the existing 25-file repo-harness refresh commit, the single
  `.gitignore` overlap with PR #96, and this work package's plan, contract,
  notes, review, and deferred-goal ledger entry.
- Out of scope: product behavior, source/tests, architecture-ledger model data,
  SQLite/WAL/runtime state, the unrelated audit worktree, npm publication, and
  production deployment.

## Workflow Inventory

- Source plan: `plans/plan-20260808-1336-ship-pr96-and-harness-wip.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260808-1336-ship-pr96-and-harness-wip.review.md`
- Notes file: `tasks/notes/20260808-1336-ship-pr96-and-harness-wip.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: `scripts/verify-sprint.sh` must see this contract pass, the review recommend pass, and `## External Acceptance Advice` pass or record a manual override.

## Allowed Paths

```yaml
allowed_paths:
  - plans/plan-20260808-1336-ship-pr96-and-harness-wip.md
  - tasks/todos.md
  - tasks/contracts/20260808-1336-ship-pr96-and-harness-wip.contract.md
  - tasks/reviews/20260808-1336-ship-pr96-and-harness-wip.review.md
  - tasks/notes/20260808-1336-ship-pr96-and-harness-wip.notes.md
  - .ai/harness/policy.json
  - .ai/harness/workflow-contract.json
  - .ai/hooks/README.md
  - .ai/hooks/lib/session-state.sh
  - .ai/hooks/lib/workflow-state.sh
  - .claude/templates/
  - .gitignore
  - docs/reference-configs/
  - package.json
```

## Evidence Requirements

```yaml
evidence_requirements:
  # This repository-local tooling refresh does not consume a benchmark matrix.
  benchmark: not_applicable
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
    - plans/plan-20260808-1336-ship-pr96-and-harness-wip.md
    - tasks/contracts/20260808-1336-ship-pr96-and-harness-wip.contract.md
    - tasks/notes/20260808-1336-ship-pr96-and-harness-wip.notes.md
    - tasks/reviews/20260808-1336-ship-pr96-and-harness-wip.review.md
    - .claude/templates/design-brief.template.md
    - docs/reference-configs/architecture-boundaries.md
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260808-1336-ship-pr96-and-harness-wip.notes.md
  commands_succeed:
    - git diff --check
    - bash -n .ai/hooks/lib/workflow-state.sh
    - bun run check:context-files
    - bun run check:task-sync
    - bun run check:architecture-sync
    - bun run check:task-workflow
    - bun run verify
  manual_checks:
    - "repo-harness 0.13.2 init dry-run reports plannedTotal 0"
    - ".archcontext repo-local override remains after the managed ignore block"
    - "Evaluator review file recommends pass"
```

## Acceptance Notes (Human Review)

- Functional behavior: repo-harness init is idempotent and both host workflow
  contracts remain internally consistent.
- Edge cases: the generated managed ignore block may ignore `.archcontext/`;
  the repo-local override must remain after it so Git authority is explicit.
- Regression risks: hook policy/template drift or accidental loss of tracked
  architecture models; cover both with init dry-run, strict checks, and full verify.

## Rollback Point

- Commit / checkpoint: merged PR #96 at `06d3b4957813e87775765061dc642ce50447aac0`;
  harness refresh source commit `815733c01c2f8d37051b8b1607a6f0e29f98db81`.
- Revert strategy: abandon the unpublished branch before merge; after merge,
  revert the harness-refresh and work-package commits without rewriting `main`.
