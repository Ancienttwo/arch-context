# Task Contract: projection-proof-apply-reconcile

> **Status**: Active
> **Plan**: plans/plan-20260826-1359-projection-proof-apply-reconcile.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-08-26 14:04
> **Review File**: `tasks/reviews/20260826-1359-projection-proof-apply-reconcile.review.md`
> **Notes File**: `tasks/notes/20260826-1359-projection-proof-apply-reconcile.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

Exact selector proof currently inherits whole-symbol display truncation, and accepted projection
writes can commit before a caller-visible post-check race. The first creates false-negative P2
proofs; the second loses the normal refresh-delivery path after a semantically committed write.

## Goal

Make exact CodeGraph selector proof independent of unrelated call fanout, and make accepted
projection apply acknowledgement durably reconcilable with exactly-once refresh delivery.

## Scope

- In scope: structured exact selector identity lookup; ambiguity/truncation proof semantics;
  projection result v2 apply identity; ChangeSet-bound durable receipt persistence; idempotent
  reconcile; contracts, schema, fixtures, and targeted tests.
- Out of scope: weakening negative proof, ignoring concurrent non-owned mutation, replaying Human
  acceptance, or adding a legacy protocol fallback.
- Taste constraints: <!-- advisory only, no run gate; default style/taste lives in AGENTS.md and the minimal-change policy, use this to record a per-task override -->

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

What observable evidence would prove this task's direction wrong, and the cheapest proof point to check first. Leave as-is if not applicable.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260826-1359-projection-proof-apply-reconcile.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260826-1359-projection-proof-apply-reconcile.review.md`
- Notes file: `tasks/notes/20260826-1359-projection-proof-apply-reconcile.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Change Assessment

```json
{"protocol":1,"oracles":[{"id":"projection-v2-deterministic-gates","kind":"deterministic_test","paths":["*"]},{"id":"repo-harness-provider-runtime-readback","kind":"runtime_readback","paths":["*"]}]}
```

## Acceptance Policy

```json
{"protocol":1,"reviewer":"Claude","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - plans/
  - tasks/todos.md
  - tasks/contracts/20260826-1359-projection-proof-apply-reconcile.contract.md
  - tasks/reviews/20260826-1359-projection-proof-apply-reconcile.review.md
  - tasks/notes/20260826-1359-projection-proof-apply-reconcile.notes.md
  - packages/contracts/
  - packages/core/projection-engine/
  - packages/core/projection-engine/test/fixtures/
  - scripts/
  - docs/verification/
  - packages/local-runtime/codegraph-adapter/
  - packages/local-runtime/local-store-sqlite/
  - packages/local-runtime/runtime-daemon/
  - packages/surfaces/cli/
  - schemas/runtime/
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
    - schemas/runtime/projection-result.schema.json
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260826-1359-projection-proof-apply-reconcile.notes.md
  commands_succeed:
    - bun run typecheck
    - bun test packages/local-runtime/codegraph-adapter/test/capability-projection-inputs.test.ts packages/core/projection-engine/test/semantic-diagrams.test.ts packages/contracts/test/contracts.test.ts scripts/architecture-ledger-al10-release-packaging-readback.test.ts --timeout 60000
    - bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts --test-name-pattern "projection apply receipts become visible only after commit and deliver refresh signals exactly once" --timeout 60000
    - bun test packages/surfaces/cli/test/cli.test.ts --test-name-pattern "CLI capabilities exposes|CLI projection run consumes" --timeout 60000
    - bun run readback:al10:release-packaging
```

## Acceptance Notes (Human Review)

- Functional behavior:
- Edge cases:
- Regression risks:

## Rollback Point

- Commit / checkpoint:
- Revert strategy:
