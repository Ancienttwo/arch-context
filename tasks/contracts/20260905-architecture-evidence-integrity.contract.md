# Task Contract: architecture-evidence-integrity

> **Status**: Fulfilled
> **Plan**: plans/plan-20260905-architecture-evidence-integrity.md
> **Task Profile**: code-change
> **Owner**: Codex parent
> **Capability ID**: capability-architecture-context
> **Last Updated**: 2026-09-05
> **Review File**: `tasks/reviews/20260905-architecture-evidence-integrity.review.md`
> **Notes File**: `tasks/notes/20260905-architecture-evidence-integrity.notes.md`

## Goal

Deliver the approved evidence-integrity behavior change and downstream handoff. See plan for exact source ownership and frozen requirements.

## Scope

In scope: pressure evidence truthfulness, missing readiness evidence, removal of fabricated intervention semantics, required consumer tests and documentation. Out of scope: downstream changes, ledger/model writes, publish/deploy, broad rewrites.

## Change Assessment

```json
{"protocol":1,"oracles":[{"id":"pressure-and-prepare-evidence-regression","kind":"deterministic_test","paths":["*"]},{"id":"refactor-assessment-nonregression","kind":"deterministic_test","paths":["*"]},{"id":"packaged-cli-daemon-refactor-lifecycle-smoke","kind":"runtime_readback","paths":["*"]}]}
```

## Acceptance Policy

```json
{"protocol":2,"reviewer":"Codex","source":"codex-review","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - packages/core/pressure-engine/
  - packages/core/application/
  - packages/core/refactor-decision/
  - packages/core/context-compiler/
  - packages/contracts/src/refactor.ts
  - packages/contracts/test/refactor-contracts.test.ts
  - evals/
  - packages/local-runtime/runtime-daemon/test/
  - packages/surfaces/cli/test/
  - packages/surfaces/mcp-local/test/
  - docs/spec.md
  - docs/verification/m6-representative-eval-report.md
  - docs/researches/20260905-repo-harness-upstream-architecture-review.md
  - docs/researches/20260905-repo-harness-refactor-discovery-handoff.md
  - plans/plan-20260905-architecture-evidence-integrity.md
  - tasks/contracts/20260905-architecture-evidence-integrity.contract.md
  - tasks/reviews/20260905-architecture-evidence-integrity.review.md
  - tasks/notes/20260905-architecture-evidence-integrity.notes.md
  - tasks/todos.md
  - tasks/current.md
```

## Exit Criteria (Machine Verifiable)

```yaml
exit_criteria:
  files_exist:
    - docs/researches/20260905-repo-harness-refactor-discovery-handoff.md
  commands_succeed:
    - bun run verify
```

## Evidence Requirements

```yaml
evidence_requirements:
  # Product correctness is covered by bun run verify; no harness profile benchmark matrix is consumed.
  benchmark: not_applicable
```

## Acceptance Notes

Parent performs one post-integration review, full verification where feasible, and records precise blockers. No made-up acceptance receipt. User granted acceptance, commits and merge; no npm publication/deployment.
