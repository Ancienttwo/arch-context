# Task Contract: projection-adoption-accepted-change-fixed-point

> **Status**: Complete
> **Plan**: plans/plan-20260904-2113-projection-adoption-accepted-change-fixed-point.md
> **Task Profile**: bugfix
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-09-04 21:13
> **Review File**: `tasks/reviews/20260904-2113-projection-adoption-accepted-change-fixed-point.review.md`
> **Notes File**: `tasks/notes/20260904-2113-projection-adoption-accepted-change-fixed-point.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

The stable projection protocol cannot atomically adopt an existing human-owned architecture module and consume an exact approved semantic change. Downstream consumers remain unable to close an otherwise approved architecture projection.

## Goal

Make `mode=adopt` consume `acceptedChange` exactly once, commit the ownership adoption and canonical semantic projection in one daemon transaction, and return the same durable apply identity and refresh delivery guarantees as accepted `mode=apply`.

## Scope

- In scope: projection-protocol adoption preparation, accepted-change fixed-point proof, durable apply receipt/delivery, regression coverage, and the 0.5.6 release surfaces.
- Out of scope: renderer changes, relaxed approval validation, compatibility fallbacks, or consumer-side semantic inference.
- Taste constraints: <!-- advisory only, no run gate; default style/taste lives in AGENTS.md and the minimal-change policy, use this to record a per-task override -->

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

If a fixture containing both a legacy human-owned module and an approved node-added delta already completes `mode=adopt` with a valid apply receipt on 0.5.4, the root-cause hypothesis is false. The focused CLI regression test is the cheapest proof.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: `packages/surfaces/cli/src/main.ts:1320` rebuilds the post-adoption projection with the already-consumed `acceptedChange`, so the classifier rejects the second consumption as `architecture-major-change-accepted-reference-without-semantic-delta`; omitting it leaves the semantic delta unresolved.
- repro: `bun test packages/surfaces/cli/test/cli.test.ts --test-name-pattern "projection adopt composes ownership adoption with one accepted semantic change"`
- regression_guard: packages/surfaces/cli/test/cli.test.ts
- pre_fix_failure_artifact: docs/verification/20260904-projection-adoption-accepted-change-fixed-point-pre-fix.txt

## Workflow Inventory

- Source plan: `plans/plan-20260904-2113-projection-adoption-accepted-change-fixed-point.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260904-2113-projection-adoption-accepted-change-fixed-point.review.md`
- Notes file: `tasks/notes/20260904-2113-projection-adoption-accepted-change-fixed-point.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Change Assessment

```json
{"protocol":1,"oracles":[{"id":"projection-adoption-regression","kind":"test","path":"packages/surfaces/cli/test/cli.test.ts"},{"id":"type-contract","kind":"command","command":"bun run check:type"}]}
```

## Acceptance Policy

```json
{"protocol":2,"reviewer":"Codex","source":"codex-plugin","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - package.json
  - bun.lock
  - actions/review-action/action.yml
  - docs/examples/github-hosted-runner-workflow.yml
  - docs/examples/reusable-organization-runner-caller.yml
  - docs/runbooks/personal-user-install.md
  - docs/spec.md
  - docs/verification/archctx-0.5.6-release.json
  - docs/verification/archctx-0.5.3-release.json
  - docs/verification/archctx-0.5.4-release.json
  - packages/cloud/package.json
  - packages/contracts/package.json
  - packages/contracts/src/product-version.ts
  - packages/contracts/fixtures/valid/archctx-capabilities.json
  - packages/contracts/fixtures/valid/product-version-manifest.json
  - packages/core/package.json
  - packages/core/practice-catalog/assets/catalog.yaml
  - packages/local-runtime/package.json
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/local-runtime/runtime-daemon/test/refactor-verify.test.ts
  - packages/surfaces/package.json
  - packages/surfaces/cli/package.json
  - packages/surfaces/cli/src/main.ts
  - packages/surfaces/cli/test/cli.test.ts
  - scripts/packaged-cli-smoke.mjs
  - docs/verification/20260904-projection-adoption-accepted-change-fixed-point-pre-fix.txt
  - plans/plan-20260904-2113-projection-adoption-accepted-change-fixed-point.md
  - tasks/todos.md
  - tasks/contracts/20260904-2113-projection-adoption-accepted-change-fixed-point.contract.md
  - tasks/reviews/20260904-2113-projection-adoption-accepted-change-fixed-point.review.md
  - tasks/notes/20260904-2113-projection-adoption-accepted-change-fixed-point.notes.md
  - tasks/current.md
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
    - packages/surfaces/cli/src/main.ts
    - docs/verification/20260904-projection-adoption-accepted-change-fixed-point-pre-fix.txt
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260904-2113-projection-adoption-accepted-change-fixed-point.notes.md
  tests_pass:
    - path: packages/surfaces/cli/test/cli.test.ts
  commands_succeed:
    - bun test packages/surfaces/cli/test/cli.test.ts --test-name-pattern "projection adopt composes ownership adoption with one accepted semantic change"
    - bun run typecheck
# Optional exact-subject reuse is fail-closed and opt-in. List only deterministic
# criteria whose inputs are fully bound by the frozen subject/toolchain context.
# criterion_reuse:
#   tests_pass:
#     - path/to/deterministic.test.ts
#   commands_succeed:
#     - bun test --timeout 60000
```

## Acceptance Notes (Human Review)

- Functional behavior: `mode=adopt` commits ownership adoption plus one exact accepted semantic change in one daemon transaction and returns the durable apply receipt.
- Edge cases: the post-adoption fixed-point rebuild omits the single-use accepted reference; stale plan, digest, node, and approval mismatches remain fail closed.
- Regression risks: CLI promise lifetime and projection fixed-point behavior are covered by the full CLI suite and focused adoption tests.

## Rollback Point

- Commit / checkpoint: `91210e7 fix(projection): compose adoption with accepted changes`; `bd0ce65 chore(release): prepare 0.5.6 on published 0.5.5 baseline`
- Revert strategy: revert the provider and release closeout commits together and pin consumers to 0.5.4.
