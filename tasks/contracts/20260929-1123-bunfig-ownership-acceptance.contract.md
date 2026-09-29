# Task Contract: bunfig-ownership-acceptance

> **Status**: Active
> **Plan**: plans/plan-20260929-1123-bunfig-ownership-acceptance.md
> **Task Profile**: code-change
> **Workflow Profile**: strict
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: chris
> **Capability ID**: root
> **Last Updated**: 2026-09-29 11:23
> **Review File**: `tasks/reviews/20260929-1123-bunfig-ownership-acceptance.review.md`
> **Notes File**: `tasks/notes/20260929-1123-bunfig-ownership-acceptance.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

`unowned-paths` still reports 5 unclaimed `packages/<ws>/bunfig.toml` files, the last hit after #240. This is also the first real use of the #247 v2 committed-change acceptance: ChangeSet → journal transition → accept-committed preview/approve → projection run with the accepted tuple. Any defect on that path must surface and be fixed before #238 moves the code.

## Goal

1. `scripts/apply-model-proposal.ts`: the receipt includes the `journalId` returned by `apply_update` in applied mode, with test coverage.
2. The parent (not a subagent) applies ChangeSet `changeset.bunfig-ownership`. It adds `"packages/<ws>/bunfig.toml"` to `source.include` directly after `package.json` in the five `module.architecture-context.{cloud,contracts,core,local-runtime,surfaces}` nodes.
3. The parent accepts the change: `archctx ledger accept-committed --journal <journalId>=changeset.bunfig-ownership` in preview mode, then `--approved`. It then applies the accepted projection with `archctx projection run` (profile `repo-harness/v1`) using the returned tuple.
4. End state:
   - `archctx validate` is valid;
   - `docs drift --profile repo-harness/v1` is ok;
   - `refactor scan` reports `unownedFileCount` 0;
   - evidence (journal id, event id, plan id, receipt, digests only) is recorded in the notes.

## Scope

- In scope:
  - The script receipt field and its test.
  - The five-node ownership ChangeSet.
  - Accepting it and delivering the projection.
  - Evidence in the notes.
- Out of scope:
- Taste constraints: <!-- advisory only, no run gate; default style/taste lives in AGENTS.md and the minimal-change policy, use this to record a per-task override -->

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

The direction is wrong if `accept-committed` refuses this legitimate single-journal ownership change, or if the classified change is not `ownership-changed` on `capability.architecture.context`. If so, stop and record the refusal code; a #247 follow-up fix is needed. Cheapest proof point: the accept preview right after the ChangeSet.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear as a `package_test` check in Verification Plan).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260929-1123-bunfig-ownership-acceptance.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260929-1123-bunfig-ownership-acceptance.review.md`
- Notes file: `tasks/notes/20260929-1123-bunfig-ownership-acceptance.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Change Assessment

```json
{"protocol":1,"oracles":[{"id":"apply-model-proposal-receipt","kind":"deterministic_test","paths":["*"]},{"id":"bunfig-ownership-live-acceptance","kind":"runtime_readback","paths":["*"]}]}
```

## Acceptance Policy

```json
{"protocol":2,"reviewer":"Codex","source":"codex-review","user_waiver":"allowed"}
```

## Allowed Paths

<!-- projection-engine added 2026-09-29: the live proof exposed repo-harness (pinned archctx 0.5.13) and the #247 renderer re-stamping each other's manifest; the drift comparison must tolerate an absent semanticBaseline.evidence. -->
```yaml
allowed_paths:
  - plans/
  - tasks/todos.md
  - tasks/contracts/20260929-1123-bunfig-ownership-acceptance.contract.md
  - tasks/reviews/20260929-1123-bunfig-ownership-acceptance.review.md
  - tasks/notes/20260929-1123-bunfig-ownership-acceptance.notes.md
  - .archcontext/model/nodes/module.architecture-context.cloud.yaml
  - .archcontext/model/nodes/module.architecture-context.contracts.yaml
  - .archcontext/model/nodes/module.architecture-context.core.yaml
  - .archcontext/model/nodes/module.architecture-context.local-runtime.yaml
  - .archcontext/model/nodes/module.architecture-context.surfaces.yaml
  - docs/architecture/
  - scripts/apply-model-proposal.ts
  - scripts/apply-model-proposal.test.ts
  - packages/core/projection-engine/src/
  - packages/core/projection-engine/test/
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
      "necessity": "The receipt field change must compile on the pinned toolchain.",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "model-validate",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun packages/surfaces/cli/src/main.ts validate",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "The ownership ChangeSet must leave a valid architecture model.",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "docs-drift",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun packages/surfaces/cli/src/main.ts docs drift --profile repo-harness/v1 | jq -e '.ok and .data.ok and .data.drift.ok'",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "The accepted projection must leave generated docs at the fixed point.",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "proposal-script-test",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun test --timeout 60000 scripts/apply-model-proposal.test.ts",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "The receipt exposes journalId for the acceptance flow.",
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
      "necessity": "Model and docs changes must not break fixture or projection tests.",
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
- Revert strategy: `git revert` of the PR plus an inverse ChangeSet for the five nodes. The v2 acceptance event is record-only and needs no rollback.
