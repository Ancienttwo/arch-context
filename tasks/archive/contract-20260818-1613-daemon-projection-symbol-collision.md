> **Archived**: 2026-08-18 16:13
> **Related Plan**: plans/archive/plan-20260818-1224-daemon-projection-symbol-collision.md
> **Outcome**: Completed
> **Lifecycle**: contract
> **Parent Run ID**: run-20260818-1613

# Task Contract: daemon-projection-symbol-collision

> **Status**: Fulfilled
> **Plan**: plans/plan-20260818-1224-daemon-projection-symbol-collision.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-08-18 12:25
> **Review File**: `tasks/reviews/20260818-1224-daemon-projection-symbol-collision.review.md`
> **Notes File**: `tasks/notes/20260818-1224-daemon-projection-symbol-collision.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

`packages/local-runtime/runtime-daemon/src/index.ts` declares `completeTaskProjectionDrift`
twice: a private delegate on `ArchctxDaemon` (`:2398`) and the module-level function that
actually calls `renderArchitectureDocumentationProjection` (`:6638`). The CodeGraph selector
resolves the declared architecture anchor to the private one, so the daemon's projection
trigger is reported `selector-evidence-unmatched` and cannot be declared in the architecture
model. `completeTaskProjectionFreshness` has the same shape.

If this is skipped, the architecture model stays quietly incomplete: a real trigger path is
undeclared, and any future declaration of it silently resolves to the wrong symbol.

## Goal

Remove both duplicate names so the declared daemon anchor resolves to the function that calls
the renderer, restore the `render-from-daemon` step in
`flow.architecture-context.projection-render`, and have the projected `## 2. P2` section report
`Proof: proven` with `selectors 2/2`.

## Scope

- In scope: deleting the two private delegates on `ArchctxDaemon` and rewriting their two call
  sites in `completeTask`; restoring the daemon step in the flow through a ChangeSet; the
  resulting re-projection output.
- Out of scope: the projection engine, the stamp lifecycle, the CLI surface, and the renderer
  contract — all landed in `fa0a165`/`34f5dc0`. No behaviour change to the daemon.
- Scope widened during closeout: `.ai/context/capabilities.json`. Adding the renderer component
  node in `34f5dc0` projected a new module document that no capability claims, and the capability
  resolver rejects any unclaimed `docs/architecture/modules/**.md`. That leaves `main` failing
  `check-architecture-sync` and blocks this contract's own closeout, so registering the component
  is a prerequisite for finishing rather than new work. The registry rejects an empty `prefixes`
  list, so the component declares its real footprint — `packages/core/projection-engine/src/**` —
  in both the archcontext node and the registry, rather than one authority claiming a prefix the
  other does not have.
- Taste constraints: no rename-around; remove the shadowing symbol rather than preserving an
  indirection that carries no behaviour.

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

If the rendered `## 2. P2` still reports `selector-evidence-unmatched` for
`entrypoint.architecture-context.daemon` after both duplicates are gone, the diagnosis was
wrong: the collision was not what defeated the selector. Cheapest proof point — run
`bun packages/surfaces/cli/src/main.ts docs plan` immediately after the deletion, before
touching the flow file, and read the selector evidence.

Do not adjust the declaration to make the diagram appear.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260818-1224-daemon-projection-symbol-collision.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260818-1224-daemon-projection-symbol-collision.review.md`
- Notes file: `tasks/notes/20260818-1224-daemon-projection-symbol-collision.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Acceptance Policy

```json
{"protocol":1,"reviewer":"Claude","user_waiver":"allowed"}
```

## Change Assessment

```json
{"protocol":1,"oracles":[{"id":"daemon-suite","kind":"deterministic_test","paths":["*"]},{"id":"projection-p2-selectors","kind":"runtime_readback","paths":["*"]}]}
```

## Allowed Paths

```yaml
allowed_paths:
  - plans/
  - tasks/todos.md
  - tasks/contracts/20260818-1224-daemon-projection-symbol-collision.contract.md
  - tasks/reviews/20260818-1224-daemon-projection-symbol-collision.review.md
  - tasks/notes/20260818-1224-daemon-projection-symbol-collision.notes.md
  - packages/local-runtime/runtime-daemon/src/index.ts
  - .archcontext/model/flows/
  - .archcontext/model/nodes/
  - docs/architecture/
  - .ai/context/capabilities.json
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
    - docs/architecture/modules/capability-architecture-context.md
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260818-1224-daemon-projection-symbol-collision.notes.md
  tests_pass:
    - path: packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
  commands_succeed:
    - bun run typecheck
    - bun test
```

## Acceptance Notes (Human Review)

- Functional behavior: none changed. Both call sites already resolved to the module-level
  functions through a one-line delegate; this removes the hop and the shadowing name.
- Edge cases: none introduced. The delegates had one caller each, no override, no test seam.
- Regression risks: `bun run typecheck` catches any call site missed by the deletion; the
  daemon's own suite covers `complete_task` end to end.

## Rollback Point

- Commit / checkpoint: `34f5dc0` (contract worktree base)
- Revert strategy: `git revert` the single publication commit; no persisted state, no migration.
