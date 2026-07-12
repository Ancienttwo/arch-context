# Task Contract: runtime-state-quarantine-rebuild

> **Status**: Fulfilled
> **Plan**: plans/plan-20260712-1245-runtime-state-quarantine-rebuild.md
> **Task Profile**: code-change
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-07-12 12:46
> **Review File**: `tasks/reviews/20260712-1245-runtime-state-quarantine-rebuild.review.md`
> **Notes File**: `tasks/notes/20260712-1245-runtime-state-quarantine-rebuild.notes.md`

## Goal

Ship an explicit `archctx state recover --from-git` dry-run/write workflow that
preserves an unusable canonical SQLite operational partition in verified private
quarantine, publishes a clean current-schema store, and delegates reconstruction from
Git-visible `.archcontext/` truth to the existing daemon-owned ledger rebuild API.

## Why

The current host partition fails closed during migration, so normal CLI startup cannot
reach the existing rebuild command. Recovery must work before daemon creation without
turning migration failure into silent deletion or a compatibility reader.

## Falsifier

Stop if recovery requires row-level salvage, old-shape semantic parsing, direct ledger
event append, an arbitrary database path, automatic handling of a current store, live
daemon takeover, `.archcontext/` mutation, or deletion of the quarantine.

## Scope

- In scope:
  - dry-run classification and bounded target-family fingerprinting;
  - exact worktree/target optimistic locks and migration-lock serialization;
  - disk preflight, clean staging, byte-verified private quarantine and publish rollback;
  - daemon-bypassing CLI control path followed by existing typed Git rebuild;
  - ADR, tests, durable readback, current-host acceptance and workflow closeout.
- Out of scope:
  - compatibility import, semantic salvage, in-place repair or migration-history rewrite;
  - explicit `ARCHCONTEXT_LOCAL_STORE_PATH`, arbitrary reset, current/absent target reset;
  - automatic acceptance of external projection changes;
  - Git authority promotion, YAML/model writes, quarantine restore or deletion.

## Workflow Inventory

- Source plan: `plans/plan-20260712-1245-runtime-state-quarantine-rebuild.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260712-1245-runtime-state-quarantine-rebuild.review.md`
- Notes file: `tasks/notes/20260712-1245-runtime-state-quarantine-rebuild.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: `scripts/verify-sprint.sh` must see this contract pass, the review recommend pass, and `## External Acceptance Advice` pass or record a manual override.

## Allowed Paths

```yaml
allowed_paths:
  - plans/plan-20260712-1245-runtime-state-quarantine-rebuild.md
  - tasks/todos.md
  - tasks/contracts/20260712-1245-runtime-state-quarantine-rebuild.contract.md
  - tasks/reviews/20260712-1245-runtime-state-quarantine-rebuild.review.md
  - tasks/notes/20260712-1245-runtime-state-quarantine-rebuild.notes.md
  - packages/local-runtime/local-store-sqlite/src/index.ts
  - packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts
  - packages/surfaces/cli/src/main.ts
  - packages/surfaces/cli/test/cli.test.ts
  - docs/adr/ADR-0037-runtime-state-placement.md
  - docs/verification/runtime-state-recovery-readback.json
  - docs/verification/runtime-state-recovery-readback.md
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
    - docs/verification/runtime-state-recovery-readback.json
    - docs/verification/runtime-state-recovery-readback.md
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260712-1245-runtime-state-quarantine-rebuild.notes.md
    - tasks/reviews/20260712-1245-runtime-state-quarantine-rebuild.review.md
  tests_pass: []
  commands_succeed:
    - bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts packages/surfaces/cli/test/cli.test.ts
    - bun run typecheck
    - node scripts/packaged-cli-smoke.mjs
    - node -e "const r=require('./docs/verification/runtime-state-recovery-readback.json'); if(r.verdict!=='PASS'||r.verification.fullVerify!=='PASS'||r.verification.hostRecovery!=='PASS') process.exit(1)"
  qa_scores: []
  manual_checks: []
```

## Acceptance Notes (Human Review)

- Functional behavior: dry-run before daemon startup; exact explicit write; verified
  quarantine; clean current-schema publish; existing daemon-owned Git rebuild.
- Edge cases: current/absent/override refusal, stale fingerprint/worktree, lock
  contention, insufficient disk, copy mismatch, publish rollback, rebuild failure.
- Regression risks: accidentally auto-recovering startup, allowing arbitrary targets,
  losing sidecars, restoring an invalid store over a valid target, or bypassing ledger
  mutation authority.

## Rollback Point

- Commit / checkpoint: branch base `f3aa337`; current user-untracked delegation
  artifact checksum must remain
  `10fc961f78b6a26a16b9fa9d1fea368d4b4493e7d825add46495df0b760e14ea`.
- Revert strategy: revert product commits only. Never delete quarantine or auto-restore
  it over a rebuilt runtime target.
