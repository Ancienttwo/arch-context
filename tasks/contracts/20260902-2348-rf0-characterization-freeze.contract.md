# Task Contract: rf0-characterization-freeze

> **Status**: Fulfilled
> **Plan**: plans/plan-20260902-2348-rf0-characterization-freeze.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-09-03 00:20
> **Review File**: `tasks/reviews/20260902-2348-rf0-characterization-freeze.review.md`
> **Notes File**: `tasks/notes/20260902-2348-rf0-characterization-freeze.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

RF1–RF4 of the Refactor Instrumentation PRD (`plans/prds/20260902-2312-refactor-intelligence-resolution-ledger.prd.md`) will rewrite footprint sourcing, add scale classification, migrate recommendation v2→v3, and add resolution verification. Today none of the six surfaces they ride on has a behavioral pin: `loadCapabilitySourceScaleSignals` has one happy-path test and no bucket-label test; the codegraph-adapter outbound-only import filter and global `truncated` copy are untested; `computeRefactorConfidence`, `decidePosture`, and `prepareTask` defaults are asserted only indirectly; `evals/run.ts --check` imports these engines, so an engine drift would be misattributed to eval data. Without this freeze, "RF1–RF4 did not change existing behavior" is unfalsifiable and `docs/architecture` bucket churn cannot be caught.

## Goal

Add committed, literal-digest characterization fixtures and tests for six surfaces so that any later behavior drift fails a test:

1. `packages/core/projection-engine`: `loadCapabilitySourceScaleSignals` / `loadCapabilitySourceFootprints` over a synthetic tmpdir tree, plus the 1–2–5 bucket labels observed through `renderArchitectureDocumentationProjection`.
2. `packages/local-runtime/codegraph-adapter`: `resolveImportTarget` candidate order and refusals, `importEdgesFromQueryNodes` edge shape, outbound-only scope filter, global `truncated` copy at `importNodeLimit`, handshake field list with `requiredVersion` `1.5.0`.
3. `packages/core/pressure-engine`: `detectArchitecturePressure` full `{level,score,signals}` per case, heuristic-only cap 25, bidirectional-import → `dependency-cycle`, level thresholds.
4. `packages/core/refactor-decision`: `computeRefactorConfidence` score table, `decidePosture` matrix, `createProofPoint` strings, `createInterventionProposal` including its placeholder target strings frozen as-is.
5. `packages/core/recommendation-engine`: `recommendationFingerprint` digests, `planRecommendationRun` dedup (`duplicate-active-fingerprint`) and cooldown at fixed `now`, id digest suffixes.
6. `packages/core/application`: `prepareTask` defaults (`callerCoverage ?? 0.8`, `testsAvailable ?? true`, `rollbackAvailable ?? true`) and the resulting posture branch.

Plus one perturbation-probe artifact proving the fixtures bite. Zero production behavior change; zero edits under any `src/`.

## Scope

- In scope:
  - New `refactor-baseline.test.ts` and `test/fixtures/refactor-baseline/*.json` in the six packages named above.
  - `docs/verification/rf0-characterization-drift-probe.txt` (captured perturbation probe output).
  - Notes file entries recording the two pre-existing defects found while freezing (worktree-dependent `lineCount`; global `truncated` copied per node) as RF1/RF2 input.
- Out of scope:
  - Any edit under any `src/`. No `export` added: `scaleMagnitudeBucketLabel` is private (`packages/core/projection-engine/src/index.ts:814`) but reachable through `renderArchitectureDocumentationProjection` (`:1693`); freeze it through the rendered line. If an export seems unavoidable, stop and hand back.
  - Fixing found defects. Record them; do not change behavior.
  - Regeneration scripts, `--update-fixtures` flags, mismatch-tolerant branches, writes into `docs/architecture`, changes to `evals/`.
- Taste constraints: follow existing test conventions in each package (`mkdtempSync` + `rmSync` in `finally`; fake CodeGraph CLI from `capability-projection-inputs.test.ts`; `CodeFactsPort` fake from `packages/core/application/test/control-loop.test.ts`). Fixture JSON shape is `{ id, description, input, expected, digest }` with `digestJson` from `@archcontext/contracts`.

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.
- Stop if a codegraph fixture digest is unstable across two consecutive runs after removing `binaryDigest`, `indexedWorktreeDigest`, `generatedAt`, and absolute paths from the normalized payload.
- Stop if freezing any surface appears to require an `export`, a `src/` edit, or a regeneration script.

## Falsifier

If perturbing one production constant (`score += 15` → `+= 16` in `packages/core/refactor-decision/src/index.ts`) leaves all six suites green, the fixtures are shape-only and the freeze is worthless. Cheapest proof point: run the perturbation probe before the exit criteria; the captured artifact must contain a non-zero `PROBE_EXIT=` line and the perturbation must then be reverted with `git checkout -- packages/core/refactor-decision/src/index.ts`.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260902-2348-rf0-characterization-freeze.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260902-2348-rf0-characterization-freeze.review.md`
- Notes file: `tasks/notes/20260902-2348-rf0-characterization-freeze.notes.md`
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
  - packages/core/projection-engine/test/
  - packages/core/pressure-engine/test/
  - packages/core/refactor-decision/test/
  - packages/core/recommendation-engine/test/
  - packages/core/application/test/
  - packages/local-runtime/codegraph-adapter/test/
  - docs/verification/rf0-characterization-drift-probe.txt
  - plans/plan-20260902-2348-rf0-characterization-freeze.md
  - tasks/todos.md
  - tasks/contracts/20260902-2348-rf0-characterization-freeze.contract.md
  - tasks/reviews/20260902-2348-rf0-characterization-freeze.review.md
  - tasks/notes/20260902-2348-rf0-characterization-freeze.notes.md
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
    - packages/core/projection-engine/test/refactor-baseline.test.ts
    - packages/local-runtime/codegraph-adapter/test/refactor-baseline.test.ts
    - packages/core/pressure-engine/test/refactor-baseline.test.ts
    - packages/core/refactor-decision/test/refactor-baseline.test.ts
    - packages/core/recommendation-engine/test/refactor-baseline.test.ts
    - packages/core/application/test/refactor-baseline.test.ts
    - docs/verification/rf0-characterization-drift-probe.txt
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260902-2348-rf0-characterization-freeze.notes.md
  tests_pass: []
  commands_succeed:
    - bun test packages/core/refactor-decision/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/core/pressure-engine/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/core/recommendation-engine/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/core/application/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/core/projection-engine/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/local-runtime/codegraph-adapter/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/core/refactor-decision packages/core/pressure-engine packages/core/recommendation-engine packages/core/projection-engine packages/core/application packages/local-runtime/codegraph-adapter --timeout 60000
    - bun evals/run.ts --check
    - bun run typecheck
    - node scripts/privacy-route-audit.mjs
    - test -z "$(git diff --stat -- docs/architecture)"
    - test -z "$(git status --short -- packages | grep '/src/')"
    - grep -Eq 'PROBE_EXIT=[1-9][0-9]*' docs/verification/rf0-characterization-drift-probe.txt
# Optional exact-subject reuse is fail-closed and opt-in. List only deterministic
# criteria whose inputs are fully bound by the frozen subject/toolchain context.
# criterion_reuse:
#   tests_pass:
#     - path/to/deterministic.test.ts
#   commands_succeed:
#     - bun test --timeout 60000
```

## Acceptance Notes (Human Review)

- Functional behavior: no production behavior changes; only additive tests, fixtures, and one verification artifact.
- Edge cases: bucket boundaries (0, 1, 2, 5, 9, 10, 199, 200, 500, 999, 1000, …), `countFileLines` without trailing newline, bare-specifier and `../` escape refusals, `importNodeLimit` boundary, heuristic-only cap, cooldown boundary at fixed `now`.
- Regression risks: fixtures that encode machine-dependent fields (digests, absolute paths) would be flaky; fixtures that pass under perturbation are shape-only and must be rejected.

## Rollback Point

- Commit / checkpoint: branch `codex/rf0-characterization-freeze` from `main` at `ca2c8e5`.
- Revert strategy: entirely additive; `git rm` the new test/fixture files and the probe artifact restores the pre-RF0 tree exactly.
