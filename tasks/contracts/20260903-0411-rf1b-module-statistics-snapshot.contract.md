# Task Contract: rf1b-module-statistics-snapshot

> **Status**: Partial
> **Plan**: plans/plan-20260903-0411-rf1b-module-statistics-snapshot.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-09-03 04:17
> **Review File**: `tasks/reviews/20260903-0411-rf1b-module-statistics-snapshot.review.md`
> **Notes File**: `tasks/notes/20260903-0411-rf1b-module-statistics-snapshot.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

The frozen refactor contracts (PR #129) define `ModuleStatisticsSnapshotV1`, but nothing produces one. Every later slice (assessment, recording, verification) and the repo-harness consumer depend on a snapshot that is deterministic, ownership-correct against the 23-node three-level model (PR #128), and honest about what CodeGraph can and cannot see. Today the repo has no ownership resolver honoring ancestor/descendant overlap, no module-level import graph or SCC, and only a working-tree footprint that counts untracked files (behavior pinned by the RF0 fixtures). Without this slice RF2 has no measured facts to classify.

## Goal

Add `packages/core/module-statistics` exporting `buildModuleStatisticsSnapshot(input: ModuleStatisticsInputV1): ModuleStatisticsSnapshotV1`, a pure synchronous builder that: resolves every tracked source file to its deepest owning node (ancestor/descendant overlap allowed, non-ancestor overlap ⇒ `ambiguousOwnership`); builds footprint (git-tracked files only), surfaces, the derived module import graph with Tarjan SCC (`cycleCount`, `fanIn`, `fanOut`, edge counts), `uncertainty`, `tests` (all unknown/null in v1), `codeFacts` (coverage complete/partial/unknown with `indexedWorktreeDigest` bound to the measured worktree digest), `repositorySummary`; computes digests with the frozen contract functions; and passes `moduleStatisticsSnapshotInvariantIssues` with `[]`. Add two thin producers: `readTrackedSourceFiles` (git-adapter) and `repositoryImportPairs` (codegraph-adapter), both additive. Correct one frozen-validator rule: `tests.callerCoverage` is no longer required to be null when `coverageStatus` is `unknown` (the two concepts are independent per PRD §0.3-16).

## Scope

- In scope: the new core package and its tests; `packages/core/package.json` export and `tsconfig.json` path; additive `readTrackedSourceFiles` in git-adapter (+ test with a temp git repo proving an untracked `dist/x.ts` inside an include glob is excluded, and a missing tracked file fails closed); additive `repositoryImportPairs` in codegraph-adapter (+ test with the existing fake CLI pattern); the single validator correction in `packages/contracts/src/refactor.ts` and its test update; notes recording design decisions (e) callerCoverage always null in v1 and the PRD clarification RF2 needs.
- Out of scope: RPC / CLI / daemon wiring (RF5a); `.archcontext/` edits; behavior changes to `loadCapabilitySourceFootprints`, `countFileLines`, `listScaleScanFiles`, `capabilityImportGraphs`; `docs/architecture`; `instability` and `directionViolationCount` (emit `null`); any other contract change.
- Taste constraints: reuse `matchesGlob` and `nativeNodeSource` from projection-engine; do not call `resolveArchitectureOwnerForPath` (different tie-break rule). Sort with plain `.sort()`. No I/O and no clock in the core package. Keep new core `src/**` under 2,800 lines / 26 files and keep `module.architecture-context.local-runtime` inside its current scale bucket so `docs plan` reports zero owned drift.

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.
- Stop if any RF0 characterization fixture fails, or if satisfying the validator would require any contract change beyond the single documented rule.
- Stop if the new source cannot fit the line budget without weakening tests; do not re-project `docs/architecture`.

## Falsifier

If two `buildModuleStatisticsSnapshot` calls on the same input produce different JSON, or if a file matched by both `packages/core/**/src/**` and `packages/core/pressure-engine/src/**` resolves to the module instead of the component, or if an untracked file inside an include glob changes `lineCount` through `readTrackedSourceFiles`, the builder is not the instrument the PRD needs. Cheapest proof: the determinism test and the deepest-owner test, run first.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260903-0411-rf1b-module-statistics-snapshot.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260903-0411-rf1b-module-statistics-snapshot.review.md`
- Notes file: `tasks/notes/20260903-0411-rf1b-module-statistics-snapshot.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Change Assessment

```json
{"protocol":1,"oracles":[{"id":"module-statistics-suites","kind":"deterministic_test","paths":["*"]},{"id":"docs-plan-zero-drift-readback","kind":"runtime_readback","paths":["*"]}]}
```

## Acceptance Policy

```json
{"protocol":2,"reviewer":"Codex","source":"codex-review","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - packages/core/module-statistics/
  - packages/core/package.json
  - tsconfig.json
  - packages/local-runtime/git-adapter/src/index.ts
  - packages/local-runtime/git-adapter/test/
  - packages/local-runtime/codegraph-adapter/src/index.ts
  - packages/local-runtime/codegraph-adapter/test/module-import-pairs.test.ts
  - packages/contracts/src/refactor.ts
  - packages/contracts/test/refactor-contracts.test.ts
  - plans/plan-20260903-0411-rf1b-module-statistics-snapshot.md
  - tasks/todos.md
  - tasks/contracts/20260903-0411-rf1b-module-statistics-snapshot.contract.md
  - tasks/reviews/20260903-0411-rf1b-module-statistics-snapshot.review.md
  - tasks/notes/20260903-0411-rf1b-module-statistics-snapshot.notes.md
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
    - packages/core/module-statistics/src/index.ts
    - packages/core/module-statistics/test/ownership.test.ts
    - packages/core/module-statistics/test/snapshot.test.ts
    - packages/core/module-statistics/test/graph.test.ts
    - packages/local-runtime/codegraph-adapter/test/module-import-pairs.test.ts
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260903-0411-rf1b-module-statistics-snapshot.notes.md
  tests_pass: []
  commands_succeed:
    - bun run typecheck
    - bun test packages/core/module-statistics/test/ownership.test.ts --timeout 60000
    - bun test packages/core/module-statistics/test/snapshot.test.ts --timeout 60000
    - bun test packages/core/module-statistics/test/graph.test.ts --timeout 60000
    - bun test packages/local-runtime/git-adapter/test/git-adapter.test.ts --timeout 60000
    - bun test packages/local-runtime/codegraph-adapter/test/module-import-pairs.test.ts --timeout 60000
    - bun test packages/core/projection-engine/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/local-runtime/codegraph-adapter/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/contracts/test/refactor-contracts.test.ts --timeout 60000
    - grep -q '"./module-statistics"' packages/core/package.json
    - grep -q 'export function readTrackedSourceFiles' packages/local-runtime/git-adapter/src/index.ts
    - grep -q 'export function repositoryImportPairs' packages/local-runtime/codegraph-adapter/src/index.ts
    - test -z "$(grep -n 'callerCoverage must be null when coverageStatus is unknown' packages/contracts/src/refactor.ts)"
    - node scripts/package-boundary-audit.mjs
    - bun packages/surfaces/cli/src/main.ts docs plan --json | jq -e '[.data.drift.diffs[]? | select(.targetId != null)] | length == 0'
    - test -z "$(git diff --stat -- docs/architecture .archcontext)"
# Optional exact-subject reuse is fail-closed and opt-in. List only deterministic
# criteria whose inputs are fully bound by the frozen subject/toolchain context.
# criterion_reuse:
#   tests_pass:
#     - path/to/deterministic.test.ts
#   commands_succeed:
#     - bun test --timeout 60000
```

## Acceptance Notes (Human Review)

- Functional behavior: additive core package and adapter functions; no existing runtime path changes; one validator rule relaxed with documented rationale.
- Edge cases: ancestor/descendant vs non-ancestor overlap; nodes without include; unresolved imports (`to: null`); truncated graph; missing index; self-loops in the module graph; deleted tracked file.
- Regression risks: RF0 fixtures (projection-engine footprint, codegraph-adapter edges) must stay byte-stable; the 1–2–5 scale bucket of `module.architecture-context.core` and `module.architecture-context.local-runtime` must not flip.

## Rollback Point

- Commit / checkpoint: branch `codex/rf1b-module-statistics-snapshot` from `main` at `144b975`.
- Revert strategy: delete `packages/core/module-statistics/`, revert the export/tsconfig lines, the two additive adapter functions with their tests, and the validator rule change with its test; nothing persisted, no projection touched.
