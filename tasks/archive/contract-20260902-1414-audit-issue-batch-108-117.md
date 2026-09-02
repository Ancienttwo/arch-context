> **Archived**: 2026-09-02 14:14
> **Related Plan**: plans/archive/plan-20260902-0035-audit-issue-batch-108-117.md
> **Outcome**: Completed
> **Lifecycle**: contract
> **Parent Run ID**: run-20260902-1414

# Task Contract: audit-issue-batch-108-117

> **Status**: Fulfilled
> **Plan**: plans/plan-20260902-0035-audit-issue-batch-108-117.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-09-02 00:35
> **Review File**: `tasks/reviews/20260902-0035-audit-issue-batch-108-117.review.md`
> **Notes File**: `tasks/notes/20260902-0035-audit-issue-batch-108-117.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

GitHub issues #108-#117 are P1/P2 audit findings against main@f78a7e0: local file deletion outside daemon-owned paths, cross-repository job mutation, issue publishing to wrong external hosts, symlink-following writes, stale projection YAML, non-durable repo removal, unbounded RPC bodies, missing client deadlines, understated context byteLength, and secret-preflight false positives. The six P1 items block the next release; shipping without them leaks daemon authority boundaries and can publish to the wrong external repository.

## Goal

All ten issues fixed fail-closed per each issue's Acceptance Criteria, one conventional commit per issue, each with a red-green regression test, with the touched packages' test suites and repo typecheck passing.

## Scope

- In scope: runtime-daemon (RPC server/client lifecycle, developer-review path containment, remote host validation, removedPaths projection, context7 lock write, job handler scoping, repo remove durability), github-issue-executor secret preflight, local-store-sqlite job scope and repository_sessions deletion, context-compiler and application final-payload byteLength, CLI/mcp-local client call-site and help-text updates.
- Out of scope: packages/contracts ledger schema changes (hostful repo provenance deferred), docs/adr updates, docs/verification readbacks, deploy/, scripts/fg*, release checklists, .archcontext/ model files, SQLite database files.
- Taste constraints: no compatibility fallbacks or best-effort paths; invalid states reject with explicit errors; reuse existing ChangeSet no-follow write capability for #111 instead of a second atomic writer.

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

- Source plan: `plans/plan-20260902-0035-audit-issue-batch-108-117.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260902-0035-audit-issue-batch-108-117.review.md`
- Notes file: `tasks/notes/20260902-0035-audit-issue-batch-108-117.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Change Assessment

```json
{"protocol":1,"oracles":[{"id":"audit-issue-regression-suite","kind":"deterministic_test","paths":["*"]},{"id":"hosted-matrix-governance-readback","kind":"runtime_readback","paths":["*"]}]}
```

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
  - tasks/contracts/20260902-0035-audit-issue-batch-108-117.contract.md
  - tasks/reviews/20260902-0035-audit-issue-batch-108-117.review.md
  - tasks/notes/20260902-0035-audit-issue-batch-108-117.notes.md
  - .ai/context/capabilities.json
  - .claude/templates/
  - packages/local-runtime/runtime-daemon/
  - packages/local-runtime/local-store-sqlite/
  - packages/core/context-compiler/
  - packages/core/application/
  - packages/core/changeset-engine/
  - docs/adr/ADR-0042-local-github-issue-publishing.md
  - package.json
  - bun.lock
  - .github/workflows/verify.yml
  - docs/verification/
  - deploy/release-checklists/
  - packages/surfaces/cli/
  - packages/surfaces/mcp-local/
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
    - tasks/notes/20260902-0035-audit-issue-batch-108-117.notes.md
  # tests_pass resolution walks up to the nearest package.json, which in this
  # repo is a workspace grouping manifest without scripts.test; the same five
  # test files are asserted via commands_succeed instead.
  commands_succeed:
    - bun run typecheck
    - bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts packages/core/context-compiler/test/context-compiler.test.ts packages/surfaces/cli/test/cli.test.ts packages/surfaces/mcp-local/test/mcp-local.test.ts
```

## Acceptance Notes (Human Review)

- Functional behavior:
- Edge cases:
- Regression risks:

## Rollback Point

- Commit / checkpoint: base main@f78a7e0
- Revert strategy: one conventional commit per issue on branch codex/audit-issue-batch-108-117; revert the single commit for a bad fix, or drop the branch entirely.
