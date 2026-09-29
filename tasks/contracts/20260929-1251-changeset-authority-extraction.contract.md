# Task Contract: changeset-authority-extraction

> **Status**: Active
> **Plan**: plans/plan-20260929-1251-changeset-authority-extraction.md
> **Task Profile**: code-change
> **Workflow Profile**: strict
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: chris
> **Capability ID**: root
> **Last Updated**: 2026-09-29 12:51
> **Review File**: `tasks/reviews/20260929-1251-changeset-authority-extraction.review.md`
> **Notes File**: `tasks/notes/20260929-1251-changeset-authority-extraction.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

`ArchContextRuntime` (`runtime-daemon/src/index.ts`, 2127 lines) still owns the highest-authority daemon code: ChangeSet plan/apply, MCP one-time approval tokens, the applied-change ledger append, and committed-change acceptance. #238 moves it into one auditable service. If the move is not strictly behaviour-preserving, it could silently alter token consumption, the writer-lock ordering, or apply semantics.

## Goal

A new `packages/local-runtime/runtime-daemon/src/changeset-authority.ts` exporting `ChangeSetAuthorityService`, holding:
- the five state fields: `changesets`, `changeSetRoots`, `mcpChangeSets`, `mcpApprovals`, `changeSetWorktreeDigestProfiles`;
- the methods `planPracticeWaiver`, `planUpdate`, `approveMcpProjection`, `mcpProjection`, `approveMcpUpdate`, `applyMcpUpdate`, `applyUpdate`, `applyAuthorizedUpdate`, `appendAppliedChangeSetToArchitectureLedger` and `acceptCommittedChange`;
- the module helpers used only by them.

Every moved body is byte-identical to its text at base `dadef1c`, because member names are preserved through a mirrored dependency object. The facade keeps one-line delegates for every public method, keeps engine construction, `withWriter`, `openSession`, `appendArchitectureEventsWithFeed`, `projectionHost`/`projection` (which still call `this.planUpdate`/`this.applyUpdate`) and `completeTask`, and `stop()` clears approvals through the service exactly as today.

The only permitted textual changes are:
- dropping `private` on moved members,
- imports,
- constructor wiring,
- delegates,
- the `stop()` call.

Record in the notes a verbatim-move checker: extract each symbol with the TypeScript compiler API at `dadef1c`, compare bytes, classify every `index.ts` hunk, and include a negative control. Closes #238.

## Scope

- In scope:
  - The move.
  - Delegates and wiring.
  - Source-reading readbacks or tests that must also read the new file.
  - Verbatim evidence.
- Out of scope:
- Taste constraints: <!-- advisory only, no run gate; default style/taste lives in AGENTS.md and the minimal-change policy, use this to record a per-task override -->

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

The direction is wrong if any moved body cannot stay byte-identical without a behaviour change, for example because it captures a facade-private member that cannot be mirrored. Stop and report that body instead of rewriting it. Cheapest proof point: list every `this.` member referenced by the moved bodies and classify each as moved, mirrored port, or delegate before editing.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear as a `package_test` check in Verification Plan).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260929-1251-changeset-authority-extraction.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260929-1251-changeset-authority-extraction.review.md`
- Notes file: `tasks/notes/20260929-1251-changeset-authority-extraction.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Change Assessment

```json
{"protocol":1,"oracles":[{"id":"changeset-authority-regressions","kind":"deterministic_test","paths":["*"]},{"id":"verbatim-move-checker","kind":"runtime_readback","paths":["*"]}]}
```

## Acceptance Policy

```json
{"protocol":2,"reviewer":"Codex","source":"codex-review","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - plans/
  - tasks/todos.md
  - tasks/contracts/20260929-1251-changeset-authority-extraction.contract.md
  - tasks/reviews/20260929-1251-changeset-authority-extraction.review.md
  - tasks/notes/20260929-1251-changeset-authority-extraction.notes.md
  - packages/local-runtime/runtime-daemon/src/
  - packages/local-runtime/runtime-daemon/test/
  - scripts/
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

This block contains only non-executable artifact requirements. Define every
executable check once in the canonical Verification Plan below. Each check must
state its phase, cost, evidence policy, necessity, and input environment; a
missing or malformed plan fails closed. Populate artifact requirements only
for deliverables this task actually owns; do not create a spec, notes or report
merely to fill this template.

```yaml
exit_criteria:
  files_exist: []
  artifacts_exist: []
```

## Verification Plan

```json
{
  "protocol": 1,
  "checks": [
    {
      "id": "typecheck",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun run typecheck",
      "cwd": ".",
      "phase": "preflight",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "The moved service, ports and delegates must compile together.",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "package-boundary-audit",
      "kind": "command",
      "command": "node scripts/package-boundary-audit.mjs",
      "cwd": ".",
      "phase": "preflight",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "The new module must keep workspace package boundaries valid.",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "affected-tests",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun test --timeout 60000 packages/local-runtime/runtime-daemon packages/surfaces/mcp-local packages/surfaces/cli packages/local-runtime/local-store-sqlite tests scripts/data-engine-source-invariants.test.ts scripts/practice-context7-readback.test.ts",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Covers ChangeSet plan/apply, MCP tokens, acceptance, CLI wiring and source-reading readbacks.",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "full-test",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun test --timeout 60000",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Move-only refactor of the facade must not break any consumer.",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "packaged-cli-smoke",
      "kind": "command",
      "command": "node scripts/packaged-cli-smoke.mjs",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "The packaged daemon must still start with the extracted service.",
      "inputs": {
        "env": []
      }
    }
  ]
}
```

Author the actual checks using [Testing Policy and Artifact Standards](../../docs/reference-configs/sprint-contracts.md#testing-policy-and-artifact-standards).
The empty array is not permission to omit required repository checks: retain it
only when no executable criterion applies and explain why in Acceptance Notes.
Prefer existing covering tests; creating a task-named test or adding typecheck
is not a template requirement. For each selected check declare `id`, `kind`,
`cwd`, `phase`, `cost`, `evidence_policy`, `necessity`, `inputs.env`, and its
`command` or `path`. Declare the same execution once, including checks nested
inside aggregate scripts. Use `baseline_with_delta` only with an immutable
baseline and named current delta checks; never infer it from paths or command text.

## Acceptance Notes (Human Review)

- Changed behavior/boundary, existing covering tests and remaining gap:
- New test case/file rationale, or why existing coverage is sufficient:
- Selected check IDs and why their coverage is sufficient; omitted coverage:
- Full/expensive check justification and expected cost, if applicable:
- Execution/baseline references, subject, current delta and disposition:
- Residual risks and incomplete observations:

## Rollback Point

- Commit / checkpoint: base `dadef1c` (main).
- Revert strategy: `git revert` of the PR; no data, wire or contract change.
