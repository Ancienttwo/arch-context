# Task Contract: rf2-assessment-observations-scale

> **Status**: Fulfilled
> **Plan**: plans/plan-20260903-0512-rf2-assessment-observations-scale.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-09-03 05:13
> **Review File**: `tasks/reviews/20260903-0512-rf2-assessment-observations-scale.review.md`
> **Notes File**: `tasks/notes/20260903-0512-rf2-assessment-observations-scale.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

RF1a froze the contract and RF1b measures; nothing classifies yet. Without RF2, RF3 has no `payload.scale` to record and repo-harness would build a second classifier. The PRD's essential-evidence rule is also unshippable as written: RF1b emits `tests.callerCoverage = null` for every module in v1, so treating caller coverage as essential would collapse every proposal to `insufficient_evidence`. This slice closes that gap in the PRD and ships the classifier that is the instrument's only judgement surface.

## Goal

Add `packages/core/refactor-assessment` exporting `assessRefactor({snapshot, model, request, requestId, createdAt}) → {assessment, proposal}` (pure, synchronous): deterministic `observations` derived only from the RF1b snapshot; when the request carries an agent-authored `proposal`, a fail-closed `scale` in the fixed order model → evidence → target delta → node count; `majorChangeReasons` derived from `targetDelta` against the declared model (only `ownership-changed`, `relation-changed`, `node-removed`); `unresolvedTargets` filled on the returned proposal; confidence and pressure computed from observations only (the pressure engine is not called; `request.task` is never read). Every emitted pair passes `refactorAssessmentInvariantIssues` and `refactorScanInvariantIssues` with `[]`. Apply the PRD amendment (essential evidence, unresolvedTargets sources, majorChangeReasons subset, pressure derivation, scopePaths are file paths, provenance Known Unknown).

## Scope

- In scope: the new core package (`src/index.ts`, `src/target-delta.ts`, `test/factories.ts`, `test/observations.test.ts`, `test/target-delta.test.ts`, `test/scale.test.ts`); `packages/core/package.json` export; `tsconfig.json` path; the PRD amendment in `plans/prds/20260902-2312-refactor-intelligence-resolution-ledger.prd.md` (§RF2 hard constraints + Known Unknowns rows exactly as the plan states); notes recording decisions and budgets.
- Out of scope: daemon/RPC/CLI (RF5a); ledger writes / `RecommendationV3` materialization (RF3); `refactor verify` (RF4); `.archcontext/` edits; `docs/architecture` (must not drift; no regeneration expected since core stays inside its bucket); `packages/contracts/**` (frozen); `packages/core/module-statistics/**`, `packages/core/pressure-engine/**`, `prepareTask()` / `createInterventionProposal()`.
- Taste constraints: reuse RF1b `resolveOwnership` for scopePaths ownership (never `resolveArchitectureOwnerForPath`); relative imports as in RF1b; sort every collection with plain `.sort()`; no clock, no I/O, no randomness; signal ids and digests via `digestJson`.

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.
- Stop if any fixture can only pass by changing `refactorAssessmentInvariantIssues` / `refactorScanInvariantIssues` (frozen contract) or RF1b's builder.
- Stop if new core `src/**` lines would push `packages/core/**/src/**` past 20,000 (bucket flip); do not regenerate docs.

## Falsifier

If the same request assessed with and without `task` text yields different `assessmentDigest`, or if a proposal whose scopePaths span a component and its parent module's other files is classified `module`, or if a `targetDelta` naming an unknown node id is classified `architecture` instead of `insufficient_evidence`, the classifier violates the PRD. Cheapest proof: the heuristic-isolation and S3/unresolved fixtures, run first.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260903-0512-rf2-assessment-observations-scale.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260903-0512-rf2-assessment-observations-scale.review.md`
- Notes file: `tasks/notes/20260903-0512-rf2-assessment-observations-scale.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Change Assessment

```json
{"protocol":1,"oracles":[{"id":"refactor-assessment-suites","kind":"deterministic_test","paths":["*"]},{"id":"docs-plan-zero-drift-readback","kind":"runtime_readback","paths":["*"]}]}
```

## Acceptance Policy

```json
{"protocol":2,"reviewer":"Codex","source":"codex-review","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - packages/core/refactor-assessment/
  - packages/core/package.json
  - tsconfig.json
  - plans/prds/20260902-2312-refactor-intelligence-resolution-ledger.prd.md
  - plans/plan-20260903-0512-rf2-assessment-observations-scale.md
  - tasks/todos.md
  - tasks/contracts/20260903-0512-rf2-assessment-observations-scale.contract.md
  - tasks/reviews/20260903-0512-rf2-assessment-observations-scale.review.md
  - tasks/notes/20260903-0512-rf2-assessment-observations-scale.notes.md
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
    - packages/core/refactor-assessment/src/index.ts
    - packages/core/refactor-assessment/src/target-delta.ts
    - packages/core/refactor-assessment/test/observations.test.ts
    - packages/core/refactor-assessment/test/target-delta.test.ts
    - packages/core/refactor-assessment/test/scale.test.ts
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260903-0512-rf2-assessment-observations-scale.notes.md
  tests_pass: []
  commands_succeed:
    - bun run typecheck
    - bun test packages/core/refactor-assessment/test/observations.test.ts --timeout 60000
    - bun test packages/core/refactor-assessment/test/target-delta.test.ts --timeout 60000
    - bun test packages/core/refactor-assessment/test/scale.test.ts --timeout 60000
    - bun test packages/core/module-statistics/test/snapshot.test.ts --timeout 60000
    - bun test packages/core/module-statistics/test/ownership.test.ts --timeout 60000
    - bun test packages/contracts/test/refactor-contracts.test.ts --timeout 60000
    - bun test packages/core/refactor-decision/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/core/pressure-engine/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/core/projection-engine/test/refactor-baseline.test.ts --timeout 60000
    - grep -q '"./refactor-assessment"' packages/core/package.json
    - grep -q 'Essential evidence' plans/prds/20260902-2312-refactor-intelligence-resolution-ledger.prd.md
    - grep -q 'scopePaths' plans/prds/20260902-2312-refactor-intelligence-resolution-ledger.prd.md
    - node scripts/package-boundary-audit.mjs
    - test "$(git ls-files 'packages/core/*/src/**' 'packages/core/*/*/src/**' | xargs wc -l | tail -1 | awk '{print $1}')" -lt 20000
    - bun packages/surfaces/cli/src/main.ts docs plan --json | jq -e '[.data.drift.diffs[]? | select(.targetId != null)] | length == 0'
    - test -z "$(git status --short -- .archcontext docs/architecture packages/contracts packages/core/module-statistics)"
# Optional exact-subject reuse is fail-closed and opt-in. List only deterministic
# criteria whose inputs are fully bound by the frozen subject/toolchain context.
# criterion_reuse:
#   tests_pass:
#     - path/to/deterministic.test.ts
#   commands_succeed:
#     - bun test --timeout 60000
```

## Acceptance Notes (Human Review)

- Functional behavior: additive core package; PRD amendment; no runtime path changes.
- Edge cases: ancestor-span scopePaths ⇒ cross_module; unknown targetDelta ids ⇒ insufficient_evidence (never architecture); model_adoption_required precedes insufficient_evidence; observation-only scan yields scale null and proposalDigest null; every pair validates `[]`.
- Regression risks: core bucket flip (budget ~2,300 lines; target ≤ 600); accidental dependency on pressure-engine heuristics; ownership rule fork from RF1b.

## Rollback Point

- Commit / checkpoint: branch `codex/rf2-assessment-observations-scale` from `main` at `01c9054`.
- Revert strategy: `git rm -r packages/core/refactor-assessment`, revert the export and tsconfig lines and the PRD hunk; no contract, ledger, `.archcontext/`, or projection change.
