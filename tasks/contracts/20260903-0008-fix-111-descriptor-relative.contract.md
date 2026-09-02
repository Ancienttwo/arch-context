# Task Contract: fix-111-descriptor-relative

> **Status**: Fulfilled
> **Plan**: plans/plan-20260903-0008-fix-111-descriptor-relative.md
> **Task Profile**: bugfix
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: kito
> **Capability ID**: root
> **Last Updated**: 2026-09-03 00:08
> **Review File**: `tasks/reviews/20260903-0008-fix-111-descriptor-relative.review.md`
> **Notes File**: `tasks/notes/20260903-0008-fix-111-descriptor-relative.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

The Context7 lockfile write is a security boundary. Its current pathname-based commit can be redirected outside the repository by a same-UID process that swaps a previously validated parent directory for a symlink. Shipping the current absolute no-follow claim would overstate the real guarantee and could overwrite an attacker-selected file.

## Goal

Commit the no-follow file write through verified directory handles so concurrent parent replacement cannot redirect the write, while preserving expected-hash, private-mode, atomic replace, and durability behavior across supported Linux, macOS, and Windows release targets.

## Scope

- In scope:
  - descriptor-relative or handle-relative no-follow traversal and commit for `writeFileWithoutFollowingSymlinks`
  - deterministic same-UID parent replacement regression coverage
  - native runtime dependency and one-product release packaging projection
  - focused, full local, strict workflow/contract, and exact-SHA hosted verification
- Out of scope:
  - unrelated ChangeSet writes, #108/#113/#117 already closed on main, release publication, deployment, and the dirty primary checkout.
- Taste constraints: <!-- advisory only, no run gate; default style/taste lives in AGENTS.md and the minimal-change policy, use this to record a per-task override -->

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

The direction is falsified if the selected native runtime cannot load under both Bun 1.4.0 and supported Node 22.22/24/25, or cannot expose the required directory-handle operations on a supported OS. Cheapest proof: a focused import and syscall smoke before replacing production code. No pathname-only fallback may ship.

## Change Assessment

```json
{"protocol":1,"oracles":[{"id":"descriptor-relative-adversarial-regression","kind":"deterministic_test","paths":["*"]},{"id":"node-only-packaged-docs-pin","kind":"runtime_readback","paths":["*"]}]}
```

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: packages/core/changeset-engine/src/index.ts validates parents with lstatSync but later creates and renames the temp file through full pathnames, allowing parent replacement between validation and the first mutation.
- repro: bun test packages/core/changeset-engine/test/changeset-engine.test.ts --test-name-pattern "rejects concurrent parent replacement"
- regression_guard: packages/core/changeset-engine/test/changeset-engine.test.ts
- pre_fix_failure_artifact: tasks/notes/20260903-0008-fix-111-descriptor-relative.pre-fix.txt

## Workflow Inventory

- Source plan: `plans/plan-20260903-0008-fix-111-descriptor-relative.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260903-0008-fix-111-descriptor-relative.review.md`
- Notes file: `tasks/notes/20260903-0008-fix-111-descriptor-relative.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Acceptance Policy

```json
{"protocol":2,"reviewer":"Codex","source":"codex-review","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - docs/spec.md
  - plans/
  - tasks/todos.md
  - tasks/contracts/20260903-0008-fix-111-descriptor-relative.contract.md
  - tasks/reviews/20260903-0008-fix-111-descriptor-relative.review.md
  - tasks/notes/20260903-0008-fix-111-descriptor-relative.notes.md
  - tasks/notes/20260903-0008-fix-111-descriptor-relative.pre-fix.txt
  - .ai/context/capabilities.json
  - .claude/templates/
  - package.json
  - bun.lock
  - packages/core/package.json
  - packages/core/changeset-engine/src/index.ts
  - packages/core/changeset-engine/src/descriptor-relative-write.ts
  - packages/core/changeset-engine/test/changeset-engine.test.ts
  - scripts/local-product-tarball-smoke.mjs
```

## Evidence Requirements

```yaml
evidence_requirements:
  # Set benchmark to required when this contract consumes the harness profile benchmark matrix.
  benchmark: not_applicable
```

## Delegation Contract

```yaml
delegation:
  budget:
    tokens: null
    runner_invocations: null
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
  runner:
    preferred:
      - subagent
      - codex-exec
      - main-thread
    fallback: main-thread
    brief_is_authoritative: true
```

## Exit Criteria (Machine Verifiable)

```yaml
exit_criteria:
  files_exist:
    - packages/core/changeset-engine/src/descriptor-relative-write.ts
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260903-0008-fix-111-descriptor-relative.notes.md
  tests_pass:
    - path: packages/core/changeset-engine/test/changeset-engine.test.ts
  commands_succeed:
    - bun run typecheck
    - node scripts/local-product-tarball-smoke.mjs
    - bun run verify
    - repo-harness run check-task-workflow --strict
```

## Acceptance Notes (Human Review)

- Functional behavior: outside targets remain unchanged when a validated parent is replaced by a symlink before commit.
- Edge cases: missing destination, expected-hash mismatch, dangling/static symlinks, directory destination, private mode, native runtime load failure, and temporary-file cleanup.
- Regression risks: OS-specific syscall constants, native runtime packaging, Node/Bun addon compatibility, and Windows reparse-point semantics.

## Rollback Point

- Commit / checkpoint: the single accepted commit on `codex/fix-111-descriptor-relative`.
- Revert strategy: revert that merge commit; do not alter the dirty primary checkout.
