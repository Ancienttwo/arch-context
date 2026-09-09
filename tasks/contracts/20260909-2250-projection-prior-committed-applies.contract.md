# Task Contract: projection-prior-committed-applies

> **Status**: Active
> **Plan**: plans/plan-20260909-2250-projection-prior-committed-applies.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-09-09 22:50
> **Review File**: `tasks/reviews/20260909-2250-projection-prior-committed-applies.review.md`
> **Notes File**: `tasks/notes/20260909-2250-projection-prior-committed-applies.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

`archctx projection run` is a short-lived RPC client while `applyUpdate` executes inside the
resident daemon. A caller whose CLI attempt is killed by its own timeout after the daemon
committed the ChangeSet has no contract surface telling it that projection-owned files were
already written under its `requestId`; the retry sees the fixed point reached and returns
`status: noop, files: []`. Without this field a caller cannot distinguish "nothing happened"
from "a prior attempt wrote", and `projection recover` is unusable because the killed attempt
never returned the `applyId`/`lookupKey`.

## Goal

`archcontext.projection-result/v2` carries an optional `priorCommittedApplies` array naming
every committed ChangeSet under this request's `requestId` other than this run's own, with the
files it committed, and `archctx capabilities --json` advertises
`projection-prior-committed-applies-v1` so consumers can require the surface.

## Scope

- In scope: projection result contract and its JSON schema/fixture, ChangeSet journal body hash,
  SQLite journal lookup by `reason.taskSessionId`, daemon RPC method, CLI threading through every
  `ProjectionResultV2` construction path, capabilities feature, focused tests.
- Out of scope: sticky provenance, digest ignore sets, snapshot fences, `acquireDaemonLock`,
  receipt admission rules, package version bump, publishing.
- Taste constraints: fail closed; omit the field when empty so existing results stay byte-identical.

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

If repo-harness's `assertProjectionResult` rejected unknown properties, or its `receiptDigest`
recomputation did not cover the whole received body, an additive optional field on v2 would break
existing consumers and a v3 bump would be required. Cheapest proof point:
`src/core/architecture/projection.ts:236,329` plus `src/core/evidence/canonical-json.ts` in
repo-harness — both read and both confirm the additive path.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260909-2250-projection-prior-committed-applies.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260909-2250-projection-prior-committed-applies.review.md`
- Notes file: `tasks/notes/20260909-2250-projection-prior-committed-applies.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Change Assessment

```json
{"protocol":1,"oracles":[]}
```

## Acceptance Policy

```json
{"protocol":2,"reviewer":"Codex","source":"codex-plugin","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - plans/
  - tasks/todos.md
  - tasks/contracts/20260909-2250-projection-prior-committed-applies.contract.md
  - tasks/reviews/20260909-2250-projection-prior-committed-applies.review.md
  - tasks/notes/20260909-2250-projection-prior-committed-applies.notes.md
  - packages/
  - schemas/
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
    fallback: null
    brief_is_authoritative: true
```

## Exit Criteria (Machine Verifiable)

```yaml
exit_criteria:
  files_exist:
    - schemas/runtime/projection-result.schema.json
  artifacts_exist:
    - tasks/notes/20260909-2250-projection-prior-committed-applies.notes.md
  tests_pass:
    - path: tests/projection-prior-committed-applies.test.ts
    - path: packages/contracts/test/contracts.test.ts
    - path: packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts
  commands_succeed:
    - bun run typecheck
    - bun run check:package-boundaries
# Optional exact-subject reuse is fail-closed and opt-in. List only deterministic
# criteria whose inputs are fully bound by the frozen subject/toolchain context.
# criterion_reuse:
#   tests_pass:
#     - path/to/deterministic.test.ts
#   commands_succeed:
#     - bun test --timeout 60000
```

## Acceptance Notes (Human Review)

- Functional behavior: a repeated `projection run` under one `requestId` reports the prior
  committed apply and its file list; a different `requestId` reports nothing.
- Edge cases: no apply receipt on a plain drift-repair apply (`applyId`/`lookupKey` omitted);
  a committed journal row written before `bodyHash` existed (run fails closed).
- Regression risks: `receiptDigest` shifts if the field is emitted when empty; the journal
  lookup must not leak ChangeSets from another repository root.

## Rollback Point

- Commit / checkpoint: `origin/main` at branch base `a2c34ca`
- Revert strategy: revert the branch merge; the field is additive and consumers ignore it.
