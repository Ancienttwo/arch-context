# Task Contract: projection-accepted-change-protocol

> **Status**: Active
> **Plan**: plans/plan-20260810-0228-projection-accepted-change-protocol.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: architecture-projection
> **Last Updated**: 2026-08-10 02:35
> **Review File**: `tasks/reviews/20260810-0228-projection-accepted-change-protocol.review.md`
> **Notes File**: `tasks/notes/20260810-0228-projection-accepted-change-protocol.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

The stable repo-harness projection provider cannot currently carry the explicit acceptance that turns an ArchContext major semantic delta from `human-action-required` into `refresh-required`. Without this bridge, a legitimate architecture refresh cannot complete through the cross-repository protocol.

## Goal

Thread an explicit typed accepted semantic change through `ProjectionRequestV1`, publish `archctx` and `archctx-contracts` 0.4.1, and let repo-harness resolve a major-change signal without bypassing the provider protocol.

## Scope

- In scope: additive request contract, JSON schema, runtime validation, deterministic projection forwarding, regression coverage, aligned patch-release surfaces, and a release checklist.
- Out of scope: heuristic source-edit classification, HTML output, legacy request fallback, or a second protocol version.
- Taste constraints: architecture output remains Markdown with Mermaid; no generated HTML.

## Stop Conditions

- Stop before writing outside Allowed Paths; widen this contract explicitly first if a verified release surface is missing.
- Stop if the accepted reference can bypass schema or invariant validation.
- Stop if the change requires a second projection protocol version rather than an additive optional field.

## Falsifier

The direction is wrong if an accepted request still returns `human-action-required`, or if an absent/partial/unsorted/unsupported accepted reference reaches `refresh-required`. The cheapest proof point is the focused contracts and CLI projection tests.

## Root Cause Evidence

Not applicable: this contract is a shared-protocol code change, not the `bugfix` task profile.

## Workflow Inventory

- Source plan: `plans/plan-20260810-0228-projection-accepted-change-protocol.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260810-0228-projection-accepted-change-protocol.review.md`
- Notes file: `tasks/notes/20260810-0228-projection-accepted-change-protocol.notes.md`
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
  - plans/plan-20260810-0228-projection-accepted-change-protocol.md
  - tasks/todos.md
  - tasks/contracts/20260810-0228-projection-accepted-change-protocol.contract.md
  - tasks/reviews/20260810-0228-projection-accepted-change-protocol.review.md
  - tasks/notes/20260810-0228-projection-accepted-change-protocol.notes.md
  - package.json
  - bun.lock
  - .github/workflows/archcontext-organization-runner.yml
  - actions/review-action/action.yml
  - docs/examples/github-hosted-runner-workflow.yml
  - docs/examples/reusable-organization-runner-caller.yml
  - docs/runbooks/personal-user-install.md
  - docs/runbooks/trusted-runner.md
  - packages/cloud/package.json
  - packages/contracts/package.json
  - packages/contracts/src/product-version.ts
  - packages/contracts/src/projection.ts
  - packages/contracts/fixtures/
  - packages/contracts/test/
  - packages/core/package.json
  - packages/core/practice-catalog/assets/catalog.yaml
  - packages/local-runtime/package.json
  - packages/surfaces/package.json
  - packages/surfaces/cli/src/main.ts
  - packages/surfaces/cli/test/cli.test.ts
  - schemas/runtime/projection-request.schema.json
  - deploy/release-checklists/
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
    - packages/contracts/src/product-version.ts
    - packages/contracts/src/projection.ts
    - schemas/runtime/projection-request.schema.json
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260810-0228-projection-accepted-change-protocol.notes.md
  tests_pass:
    - path: packages/contracts/test/contracts.test.ts
    - path: packages/surfaces/cli/test/cli.test.ts
  commands_succeed:
    - bun run typecheck
    - bun test packages/contracts/test/contracts.test.ts packages/surfaces/cli/test/cli.test.ts
    - bun run verify
```

## Acceptance Notes (Human Review)

- Functional behavior: accepted major-change references produce `refresh-required`; absent references remain `human-action-required`.
- Edge cases: malformed, empty, unsorted, unsupported, partial, or extra-property accepted references fail closed.
- Regression risks: request receipt identity changes only when the optional field is present; post-adoption fixed-point builds preserve the same accepted reference.

## Rollback Point

- Commit / checkpoint: `9e3c040eb285d21c040edfb2da8f39eb22fbe98f`
- Revert strategy: revert the protocol patch and publish a forward patch release if already public.
