# Task Contract: self-architecture-boundaries

> **Status**: Active
> **Plan**: plans/plan-20260925-0115-self-architecture-boundaries.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: chris
> **Capability ID**: root
> **Last Updated**: 2026-09-25 02:07
> **Review File**: `tasks/reviews/20260925-0115-self-architecture-boundaries.review.md`
> **Notes File**: `tasks/notes/20260925-0115-self-architecture-boundaries.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

ArchContext governs other repositories' architecture but its own model does not govern itself
(#163). Most key runtime, surface and cloud code had no owning component, `forbid-dependency`
constraints are declared but never evaluated, neither `failOn` source is read at runtime, and
none of the 105 ADR `appliesTo` references resolves to a node. A boundary-violating import is
caught only by `scripts/package-boundary-audit.mjs`, so the product cannot show on its own
repository that it detects and blocks what it claims to.

## Goal

A deliberately introduced boundary-violating import in this repository is detected and blocked
by ArchContext's own review. When the required CodeFacts are missing, truncated or stale, the
result is reported as undetermined and blocks the review; it never reports as healthy. Delivered
as four separately gated PRs:

- PR-1: key components own their code (30 nodes, 0 ambiguous ownership).
- PR-2: ADR `appliesTo` holds real node ids and `archctx validate` rejects dangling references.
- PR-3: dependency constraints are evaluated and `failOn` is enforced from one policy source.
- PR-4: the five layer constraints and the review policy are declared in the model.

## Scope

- In scope: model ChangeSets for components, ownership, constraints and review policy; the ADR
  `appliesTo` migration and its validate-time integrity check; DependencyConstraint contract
  types; `evaluateDependencyConstraints` in module-statistics; review-engine
  `prohibited-dependency` and undetermined findings; daemon `completeTask` wiring; review policy
  `failOn` loader; `scripts/apply-model-proposal.ts` constraint support; regenerated architecture
  docs projection; focused tests.
- Out of scope: registering observed imports as `depends_on` relations; driving the unowned-path
  count to zero (the remaining non-architecture paths stay unowned on purpose); fixing
  cloud → local-runtime (#166); the daemon split; package version bump; publishing.
- Taste constraints: observed dependency is not approved dependency; fail closed on undetermined
  results; a model-repairing change must not be blocked by the dangling references it repairs.

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.
- Stop if `docs plan` reports a major change that needs `--accepted-*` flags; report its
  `reasonCodes` and `affectedNodeIds` instead of accepting it.

## Falsifier

If the CodeGraph import query cannot return complete import facts for this repository (its cap is
5000 results; today there are about 1694), every review would block as undetermined and the
direction would need a different fact source. Cheapest proof point: the import count reported by
the module-statistics evaluator on this repository in PR-3.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260925-0115-self-architecture-boundaries.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260925-0115-self-architecture-boundaries.review.md`
- Notes file: `tasks/notes/20260925-0115-self-architecture-boundaries.notes.md`
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
{"protocol":2,"reviewer":"Codex","source":"codex-review","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - .archcontext/
  - .ai/context/
  - docs/adr/
  - docs/architecture/
  - plans/
  - tasks/
  - scripts/apply-model-proposal.ts
  - packages/contracts/
  - packages/core/architecture-domain/
  - packages/core/changeset-engine/
  - packages/core/module-statistics/
  - packages/core/review-engine/
  - packages/core/refactor-assessment/
  - packages/local-runtime/model-store-yaml/
  - packages/local-runtime/runtime-daemon/
  - packages/local-runtime/codegraph-adapter/
  - packages/surfaces/cli/
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
    - .archcontext/model/nodes/component.architecture-context.surfaces.cli.yaml
    - .archcontext/policies/review.yaml
    - packages/local-runtime/model-store-yaml/test/validate-model.test.ts
  artifacts_exist:
    - tasks/notes/20260925-0115-self-architecture-boundaries.notes.md
  files_contain:
    - path: packages/core/architecture-domain/src/index.ts
      text: "validateAdrAppliesTo"
  commands_succeed:
    - bun run typecheck
    - bun packages/surfaces/cli/src/main.ts validate --json
    - bun packages/surfaces/cli/src/main.ts docs drift --json
    - bun run verify
```

## Verification Plan

```json
{
  "protocol": 1,
  "checks": [
    {
      "id": "typecheck",
      "kind": "command",
      "command": "bun run typecheck",
      "cwd": ".",
      "phase": "preflight",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "The program changes the ModelStorePort result and adds contract types consumed across packages.",
      "inputs": { "env": [] }
    },
    {
      "id": "model-validate",
      "kind": "command",
      "command": "bun packages/surfaces/cli/src/main.ts validate --json",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "The repository's own model, including ADR appliesTo references, must validate.",
      "inputs": { "env": ["ARCHCONTEXT_STATE_DIR"] }
    },
    {
      "id": "docs-drift",
      "kind": "command",
      "command": "bun packages/surfaces/cli/src/main.ts docs drift --json",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Model and source changes must leave the generated architecture projection at its fixed point.",
      "inputs": { "env": ["ARCHCONTEXT_STATE_DIR"] }
    },
    {
      "id": "refactor-scan",
      "kind": "command",
      "command": "bun packages/surfaces/cli/src/main.ts refactor scan --json",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Ownership and constraint changes feed the refactor assessment recommendations.",
      "inputs": { "env": ["ARCHCONTEXT_STATE_DIR"] }
    },
    {
      "id": "targeted-tests",
      "kind": "command",
      "command": "bun test --timeout 60000 packages/core/architecture-domain packages/local-runtime/model-store-yaml packages/local-runtime/runtime-daemon packages/surfaces/cli",
      "cwd": ".",
      "phase": "verification",
      "cost": "expensive",
      "evidence_policy": "current_exact",
      "necessity": "Covers the appliesTo integrity check, its ChangeSet rollback and model-repair paths, and the ledger read mode.",
      "inputs": { "env": [] }
    },
    {
      "id": "verify",
      "kind": "command",
      "command": "bun run verify",
      "cwd": ".",
      "phase": "verification",
      "cost": "expensive",
      "evidence_policy": "current_exact",
      "necessity": "Full repository gate, including the package boundary audit and the whole test suite.",
      "inputs": { "env": [] }
    }
  ]
}
```

This is the sole executable verification authority.

## Acceptance Notes (Human Review)

- Functional behavior: a core → local-runtime import produces an error-level
  `prohibited-dependency` finding; an unknown ADR `appliesTo` id fails `archctx validate` and
  names the ADR file; a ChangeSet that deletes a referenced node rolls back.
- Edge cases: missing, truncated or stale CodeFacts block as undetermined; a repository without
  `docs/adr` validates; a change that restores a deleted referenced node is not blocked by the
  dangling reference on the before-apply model.
- Regression risks: the CodeGraph import cap turning every review undetermined at about 3× the
  current import count; two layer-rule sources (the audit script and model constraints) drifting.

## Rollback Point

- Commit / checkpoint: `origin/main` at `f3201a2`
- Revert strategy: `git revert` per PR; PR-2 reverts code and ADRs together; to stop blocking
  without a revert, remove the category from `.archcontext/policies/review.yaml` `failOn` with
  one ChangeSet.
