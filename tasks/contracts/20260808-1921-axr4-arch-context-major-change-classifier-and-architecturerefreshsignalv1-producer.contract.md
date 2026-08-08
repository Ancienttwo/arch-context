# Task Contract: axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer

> **Status**: Fulfilled
> **Plan**: plans/plan-20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-08-08 20:04
> **Review File**: `tasks/reviews/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.review.md`
> **Notes File**: `tasks/notes/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

repo-harness must receive an explicit, typed architecture invalidation signal. If this
classifier is missing or guesses from LOC/source hashes, context either stays stale or
refreshes on ordinary refactors and generated output.

## Goal

Emit one stable `ArchitectureRefreshSignalV1` for an accepted semantic/proof delta,
no signal for implementation/render/layout/generated-only change, and a
`human-action-required` signal for unresolved major candidates.

## Scope

- In scope: canonical capability semantic state, closed taxonomy diff, accepted
  ChangeSet/event binding, projection receipt binding, manifest baseline, manual CLI
  readback, focused schemas/tests.
- Out of scope: repo-harness consumer/orchestration, npm publication, authority cutover,
  LLM semantic inference, SQLite/ledger mutation.
- Taste constraints: <!-- advisory only, no run gate; default style/taste lives in AGENTS.md and the minimal-change policy, use this to record a per-task override -->

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

If formatting/source-only fixture changes alter semantic state or emit a refresh signal,
or two identical inputs produce different signal IDs, the design is falsified. The
cheapest proof is the pure projection-engine classifier test before CLI integration.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.review.md`
- Notes file: `tasks/notes/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Acceptance Policy

```json
{"protocol":1,"reviewer":"Claude","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - docs/spec.md
  - plans/
  - tasks/todos.md
  - tasks/contracts/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.contract.md
  - tasks/reviews/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.review.md
  - tasks/notes/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.notes.md
  - .ai/context/capabilities.json
  - .claude/templates/
  - packages/contracts/
  - packages/core/projection-engine/
  - packages/surfaces/cli/
  - schemas/runtime/
  - package.json
  - src/
  - tests/
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
    - docs/spec.md
    - packages/core/projection-engine/src/major-change.ts
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.notes.md
  tests_pass:
    - path: packages/core/projection-engine/test/major-change.test.ts
    - path: packages/contracts/test/contracts.test.ts
    - path: packages/surfaces/cli/test/cli.test.ts
  commands_succeed:
    - bun run typecheck
    - bun run verify
```

## Acceptance Notes (Human Review)

- Functional behavior: accepted semantic/proof deltas emit one stable receipt-bound signal.
- Edge cases: bootstrap baseline, unresolved proof, duplicate run, stale worktree, privacy.
- Regression risks: projection manifest fixed point and existing docs apply/noop behavior.

## Rollback Point

- Commit / checkpoint: `833bb06`
- Revert strategy: revert `833bb06` before enabling the AXR5 consumer.
