# Task Contract: audit-residuals-108-117-remediation

> **Status**: Fulfilled
> **Plan**: plans/plan-20260902-2222-audit-residuals-108-117-remediation.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: kito
> **Capability ID**: root
> **Last Updated**: 2026-09-02 22:42
> **Review File**: `tasks/reviews/20260902-2222-audit-residuals-108-117-remediation.review.md`
> **Notes File**: `tasks/notes/20260902-2222-audit-residuals-108-117-remediation.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

Current `origin/main@961f965` still permits an authenticated cleanup caller to delete another Developer Review run's control files, leaves a persisted landscape stale when `repo remove` follows daemon restart, and can publish fine-grained GitHub PATs while rejecting benign Bearer terminology. These are live security and durability failures despite green CI.

## Goal

Close #108, #113, and #117 with exact red-green regressions: cleanup authority comes only from persisted daemon state, restart-before-remove updates session and landscape atomically, and issue preflight distinguishes real GitHub/Bearer credential values from benign prose. Reassess #111 without claiming an unprovable no-follow guarantee or adding a compatibility helper.

## Scope

- In scope: runtime-daemon cleanup RPC/lifecycle, runtime landscape hydration/removal, local-store-sqlite atomic removal, GitHub issue secret preflight, focused tests, and task evidence.
- Out of scope: push, PR, npm publish, release, deployment, migration, unrelated issue #108-#117 behavior, and a new native binary/distribution contract for #111.
- Taste constraints: one persisted authority per datum; no caller path authority, no dual cleanup shape, no best-effort landscape update, no broad keyword blacklist, and no heuristic claim of descriptor-relative filesystem safety.

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

If the exact negative controls pass on unmodified `origin/main`, or if the runtime cannot load a unique canonical local landscape, stop and revise the design before implementation. Cheapest proof: focused Bun tests against the frozen base.

## Change Assessment

```json
{"protocol":1,"oracles":[{"id":"audit-residual-regression-suite","kind":"deterministic_test","paths":["*"]},{"id":"audit-residual-runtime-readback","kind":"runtime_readback","paths":["*"]}]}
```

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: `runtime-daemon/src/index.ts:6622` treats absent runRoot as cleanup authority, `start():1113` omits persisted landscape hydration and `repoRemove():4191` splits durable writes, while `github-issue-executor.ts:202-203` omits `github_pat_` and matches any Bearer word.
- repro: run the focused residual tests in `packages/local-runtime/runtime-daemon/test/local-runtime.test.ts` on base `961f965`.
- regression_guard: `packages/local-runtime/runtime-daemon/test/local-runtime.test.ts`
- pre_fix_failure_artifact: `tasks/notes/20260902-2222-audit-residuals-108-117-remediation.pre-fix.log`

## Workflow Inventory

- Source plan: `plans/plan-20260902-2222-audit-residuals-108-117-remediation.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260902-2222-audit-residuals-108-117-remediation.review.md`
- Notes file: `tasks/notes/20260902-2222-audit-residuals-108-117-remediation.notes.md`
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
  - tasks/contracts/20260902-2222-audit-residuals-108-117-remediation.contract.md
  - tasks/reviews/20260902-2222-audit-residuals-108-117-remediation.review.md
  - tasks/notes/20260902-2222-audit-residuals-108-117-remediation.notes.md
  - .ai/context/capabilities.json
  - .claude/templates/
  - packages/local-runtime/runtime-daemon/
  - packages/local-runtime/local-store-sqlite/
  - packages/surfaces/cli/
  - packages/core/changeset-engine/
  - scripts/fg3-negative-identity-matrix.ts
  - tasks/notes/20260902-2222-audit-residuals-108-117-remediation.pre-fix.log
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
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260902-2222-audit-residuals-108-117-remediation.notes.md
  # The nearest workspace grouping manifests for the focused files do not define
  # scripts.test, so the exact regression files are executed via commands_succeed.
  commands_succeed:
    - bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts packages/core/changeset-engine/test/changeset-engine.test.ts packages/surfaces/cli/test/cli.test.ts packages/surfaces/mcp-local/test/mcp-local.test.ts
    - bun run typecheck
    - bun run test
    - repo-harness run check-task-workflow --strict
```

## Acceptance Notes (Human Review)

- Functional behavior: #108, #113, and #117 exact negative controls pass; the public cleanup contract is identity-only.
- Edge cases: cleanup rejects missing/mismatched persisted control state; SQLite rollback preserves the session if the landscape write fails.
- Regression risks: #111 remains conditional against same-UID concurrent parent-directory swaps because the supported Node/Bun runtime has no cross-platform descriptor-relative child write primitive.

## Rollback Point

- Commit / checkpoint: base `origin/main@961f965b18d2196fdc3950082414f82b4bf47b29`.
- Revert strategy: revert the bounded candidate commit; no migration or external state rollback exists.
