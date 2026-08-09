# Task Contract: projection-accepted-change-protocol

> **Status**: Active
> **Plan**: plans/plan-20260810-0228-projection-accepted-change-protocol.md
> **Task Profile**: code-change
> **Owner**: ancienttwo
> **Capability ID**: architecture-projection
> **Last Updated**: 2026-08-10 02:28
> **Review File**: `tasks/reviews/20260810-0228-projection-accepted-change-protocol.review.md`
> **Notes File**: `tasks/notes/20260810-0228-projection-accepted-change-protocol.notes.md`

## Goal

Thread an explicit typed accepted semantic change through ProjectionRequestV1 so repo-harness can resolve an ArchContext major-change signal through the stable provider protocol.

## Scope

- In scope: additive request contract, JSON schema, runtime validation, deterministic projection forwarding, regression coverage, patch release surfaces.
- Out of scope: heuristic source-edit classification, HTML output, legacy request fallback.

## Stop Conditions

- Stop before writing outside Allowed Paths.
- Stop if the accepted reference can bypass schema or invariant validation.
- Stop if the change requires a second projection protocol version rather than an additive optional field.

## Workflow Inventory

- Source plan: `plans/plan-20260810-0228-projection-accepted-change-protocol.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260810-0228-projection-accepted-change-protocol.review.md`
- Notes file: `tasks/notes/20260810-0228-projection-accepted-change-protocol.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Scope gate: edit only paths listed under `allowed_paths`.

## Acceptance Policy

```json
{"protocol":1,"reviewer":"Claude","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - plans/plan-20260810-0228-projection-accepted-change-protocol.md
  - tasks/contracts/20260810-0228-projection-accepted-change-protocol.contract.md
  - tasks/reviews/20260810-0228-projection-accepted-change-protocol.review.md
  - tasks/notes/20260810-0228-projection-accepted-change-protocol.notes.md
  - package.json
  - bun.lock
  - packages/contracts/package.json
  - packages/contracts/src/projection.ts
  - packages/contracts/schemas/runtime/projection-request.schema.json
  - packages/contracts/fixtures/
  - packages/contracts/test/
  - packages/surfaces/cli/package.json
  - packages/surfaces/cli/src/main.ts
  - packages/surfaces/cli/test/cli.test.ts
  - docs/
  - deploy/release-checklists/
```

## Evidence Requirements

```yaml
evidence_requirements:
  benchmark: not_applicable
```

## Exit Criteria (Machine Verifiable)

```yaml
exit_criteria:
  files_exist:
    - packages/contracts/src/projection.ts
    - packages/contracts/schemas/runtime/projection-request.schema.json
  artifacts_exist:
    - .ai/harness/checks/latest.json
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
- Edge cases: malformed, empty, unsorted, unsupported, or partial accepted references fail closed.
- Regression risks: request receipt identity changes only when the optional field is present.

## Rollback Point

- Commit / checkpoint: `9e3c040eb285d21c040edfb2da8f39eb22fbe98f`
- Revert strategy: revert the protocol patch and publish a forward patch release if already public.
