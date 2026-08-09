# Task Contract: axr8-release-authority-cutover

> **Status**: Fulfilled
> **Plan**: plans/plan-20260809-0555-axr8-release-authority-cutover.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-08-09 05:55
> **Review File**: `tasks/reviews/20260809-0555-axr8-release-authority-cutover.review.md`
> **Notes File**: `tasks/notes/20260809-0555-axr8-release-authority-cutover.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

AXR7 proved the integration only with local tarballs and advisory gates. Until
the exact public packages and selected Bun-global runtime are cut over, normal
repo-harness sessions cannot resolve the provider or fail closed on stale
architecture truth.

## Goal

Publish `archctx-contracts@0.4.0`, `archctx@0.4.0`, and
`repo-harness@0.14.0` in dependency order, with registry integrity and
clean-room install evidence matching AXR7, then prove the selected runtime
serves ten ArchContext capabilities under strict projection/freshness gates.

## Scope

- In scope: version authorities, package artifacts, release scripts/readbacks,
  exact consumer dependencies, selected Bun-global install, strict gate policy,
  Sprint/review/acceptance closeout.
- Out of scope: new projection semantics, renderer/layout changes, cloud
  deployment, direct `.archcontext` model mutation, compatibility fallbacks.
- Taste constraints: architecture documentation remains Markdown with Mermaid
  `flowchart` and `sequenceDiagram` blocks only; do not generate HTML.

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

Any `0.4.0` tarball integrity differing from the AXR7 accepted artifact, any
registry readback mismatch, or any selected-runtime readiness/Stop failure under
strict policy falsifies the cutover. The cheapest first proof is package dry-run
plus exact integrity comparison before publish.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260809-0555-axr8-release-authority-cutover.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260809-0555-axr8-release-authority-cutover.review.md`
- Notes file: `tasks/notes/20260809-0555-axr8-release-authority-cutover.notes.md`
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
  - package.json
  - bun.lock
  - packages/
  - scripts/
  - actions/
  - .github/
  - docs/runbooks/
  - docs/examples/
  - docs/verification/
  - plans/
  - tasks/todos.md
  - tasks/contracts/20260809-0555-axr8-release-authority-cutover.contract.md
  - tasks/reviews/20260809-0555-axr8-release-authority-cutover.review.md
  - tasks/notes/20260809-0555-axr8-release-authority-cutover.notes.md
  - .ai/context/capabilities.json
  - .claude/templates/
  - src/
  - tests/
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
    - package.json
    - packages/contracts/package.json
    - packages/contracts/src/product-version.ts
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260809-0555-axr8-release-authority-cutover.notes.md
  tests_pass:
    - path: packages/contracts/test/contracts.test.ts
  commands_succeed:
    - bun run typecheck
    - bun run verify:architecture-mermaid
    - bun test packages/contracts/test/contracts.test.ts
    - bun scripts/release-provenance-readback.ts inspect --evidence docs/verification/release-provenance-readback.json --json
    - npm view archctx-contracts@0.4.0 version dist.integrity dist.shasum --json
    - npm view archctx@0.4.0 version dist.integrity dist.shasum --json
    - npm view repo-harness@0.14.0 version dist.integrity dist.shasum --json
```

## Acceptance Notes (Human Review)

- Functional behavior:
- Edge cases:
- Regression risks:

## Rollback Point

- Commit / checkpoint:
- Revert strategy:
