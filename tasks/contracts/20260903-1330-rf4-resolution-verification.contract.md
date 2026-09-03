# Task Contract: rf4-resolution-verification

> **Status**: Fulfilled
> **Plan**: plans/plan-20260903-1330-rf4-resolution-verification.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-09-03 13:33
> **Review File**: `tasks/reviews/20260903-1330-rf4-resolution-verification.review.md`
> **Notes File**: `tasks/notes/20260903-1330-rf4-resolution-verification.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

RF3 records refactor proposals and observations but ships the resolve gate as an always-reject arm, so no non-practice `RecommendationV3` can ever leave `open`/`accepted`, and `refactor-resolution-evidence/v1` is frozen but never written. RF4 closes the measure → record → verify loop that the PRD (`plans/prds/20260902-2312-refactor-intelligence-resolution-ledger.prd.md` §RF4, S4, S6) promises for 0.5.1; RF5b only exposes it over the CLI. If it ships wrong, `resolved` could be manufactured from incomplete evidence or a drifted HEAD, which is exactly the fail-closed guarantee ArchContext exists to give the Agent.

## Goal

Implement `packages/core/refactor-assessment/src/resolution.ts` (closed metric vocabulary `REFACTOR_RESOLUTION_METRICS`, `readSnapshotMetric`, `refactorOutcomeVocabularyIssues`, `deriveObservationOutcomes` for the six observation kinds, `evaluateResolution` with the six-step disposition ladder and kill-list `path`/`relation` evaluation, `symbol` → `stale`), re-exported from `refactor-assessment/src/index.ts`. Implement daemon `refactorVerify` in the one new file `packages/local-runtime/runtime-daemon/src/refactor-verify.ts` (`RuntimeRefactorVerifyInput {recommendationId; expectedHeadSha?; expectedWorktreeDigest?; executionEvidenceRefs?}`, `runRefactorVerify`: load recommendation → guards → re-scan at HEAD via the RF5a composition → `evaluateResolution` → append ONE `architecture.refactor.resolution` event with `payload.evidenceOperations` creating the resolution `EvidenceItemV2`, the after-snapshot item, and one `EvidenceBindingV1`; `findResolutionEvidence`). Wire `refactorVerify` on the daemon interface/class, `RuntimeDaemonClient`, `RuntimeRpcClient`, the dispatch table and `RUNTIME_RPC_LONG_METHODS`. Make `refactorRecord` persist the baseline snapshot as a `selector.kind:"snapshot"` evidence item + binding. Replace RF3's `refactor-resolution-evidence-unavailable` resolve arm with the evidence lookup (`evidence-digest-missing`, `evidence-unknown`, `evidence-not-resolved` → `AC_REFACTOR_EVIDENCE_REQUIRED`; `evidence-head-drift` → `AC_REFACTOR_STALE`). Design authority: the plan's "## Captured Planning Output" decisions (a)–(f).

## Scope

- In scope: `packages/core/refactor-assessment/src/{resolution,index}.ts`, `packages/core/refactor-assessment/test/resolution.test.ts`, `packages/local-runtime/runtime-daemon/src/{refactor-verify,refactor-recording,index}.ts`, `packages/local-runtime/runtime-daemon/test/{refactor-verify,refactor-recording}.test.ts`; notes file.
- Out of scope: `packages/contracts/**` (no new type — `RefactorVerificationRequestV1` is frozen in RF5b), `packages/core/module-statistics/**`, `packages/surfaces/**` (CLI `refactor verify` is RF5b), `ARCHCTX_FEATURES`, `packaged-cli-smoke`, version bump, `relations.supersedes`, MCP, `.archcontext/**`, RF0 baseline fixtures, snapshot/assessment shape changes, `local-store-sqlite/**`.
- Taste constraints: the evaluator is pure (no IO, no clock); disposition comes from the frozen validator's rules, never from prose; `stale` is the only "cannot decide" arm and verify on a dirty worktree never returns `resolved`; no alias table for metrics; `partially_resolved`/`not_improved`/`regressed`/`stale` leave status untouched and write no feedback; evidence uses `payload.evidenceOperations` (legacy `evidenceItems` throws); `refactor-verify.ts` must not import test doubles.

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths (in particular `packages/contracts/**` or `local-store-sqlite/**`).
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.
- Stop if the core source line count would cross 20,000 (bucket guard) — do not force a docs regeneration inside RF4.
- Stop if making `evidence.disposition = resolved` reachable for S4 requires synthesizing an `observedValue` or bypassing `refactorVerifyInvariantIssues`.
- Stop after two failed rounds on evidence-event append or replay parity and hand to an independent review.

## Falsifier

If the S6 fixture (`crossModuleCycleCount less_than 1`, after = 1) can reach `resolved`, if verify at a HEAD different from `expectedHeadSha` returns anything but `AC_REFACTOR_STALE`, if an after-snapshot with `coverage != complete` ever yields `resolved`, or if `recommendations resolve --evidence-digest` succeeds with a digest whose disposition is not `resolved`, the design is wrong and this contract fails.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260903-1330-rf4-resolution-verification.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260903-1330-rf4-resolution-verification.review.md`
- Notes file: `tasks/notes/20260903-1330-rf4-resolution-verification.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Change Assessment

```json
{"protocol":1,"oracles":[{"id":"resolution-and-verify-suites","kind":"deterministic_test","paths":["*"]},{"id":"daemon-verify-resolve-readback","kind":"runtime_readback","paths":["*"]}]}
```

## Acceptance Policy

```json
{"protocol":2,"reviewer":"Codex","source":"codex-review","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - packages/core/refactor-assessment/src/resolution.ts
  - packages/core/refactor-assessment/src/index.ts
  - packages/core/refactor-assessment/test/resolution.test.ts
  - packages/local-runtime/runtime-daemon/src/refactor-verify.ts
  - packages/local-runtime/runtime-daemon/src/refactor-recording.ts
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/local-runtime/runtime-daemon/test/refactor-verify.test.ts
  - packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts
  - plans/plan-20260903-1330-rf4-resolution-verification.md
  - tasks/todos.md
  - tasks/contracts/20260903-1330-rf4-resolution-verification.contract.md
  - tasks/reviews/20260903-1330-rf4-resolution-verification.review.md
  - tasks/notes/20260903-1330-rf4-resolution-verification.notes.md
  - docs/architecture/   # regeneration only, via `archctx docs apply --approved` on a clean tree
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
    - packages/core/refactor-assessment/src/resolution.ts
    - packages/core/refactor-assessment/test/resolution.test.ts
    - packages/local-runtime/runtime-daemon/src/refactor-verify.ts
    - packages/local-runtime/runtime-daemon/test/refactor-verify.test.ts
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260903-1330-rf4-resolution-verification.notes.md
  tests_pass: []
  commands_succeed:
    - bun run typecheck
    - node scripts/package-boundary-audit.mjs
    - node scripts/production-mock-reachability-audit.mjs
    - bun test packages/core/refactor-assessment/test/resolution.test.ts --timeout 60000
    - bun test packages/core/refactor-assessment/test/scale.test.ts --timeout 60000
    - bun test packages/core/refactor-assessment/test/observations.test.ts --timeout 60000
    - bun test packages/core/refactor-assessment/test/target-delta.test.ts --timeout 60000
    - bun test packages/core/module-statistics/test/snapshot.test.ts --timeout 60000
    - bun test packages/core/module-statistics/test/graph.test.ts --timeout 60000
    - bun test packages/core/module-statistics/test/ownership.test.ts --timeout 60000
    - bun test packages/contracts/test/refactor-contracts.test.ts --timeout 60000
    - bun test packages/contracts/test/contracts.test.ts --timeout 60000
    - bun test packages/local-runtime/runtime-daemon/test/refactor-verify.test.ts --timeout 120000
    - bun test packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts --timeout 120000
    - bun test packages/local-runtime/runtime-daemon/test/refactor-scan.test.ts --timeout 120000
    - bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --timeout 180000
    - bun test packages/core/recommendation-engine/test/refactor-recommendation-v3.test.ts --timeout 60000
    - bun test packages/local-runtime/local-store-sqlite/test/recommendation-v3-migration.test.ts --timeout 60000
    - bun test packages/core/refactor-decision/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/core/pressure-engine/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/core/recommendation-engine/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/core/projection-engine/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/core/application/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/local-runtime/codegraph-adapter/test/refactor-baseline.test.ts --timeout 60000
    - test "$(git ls-files | grep -E '^packages/core/[^/]+/src/' | grep -v '/test/' | wc -l | tr -d ' ')" -le 50
    - test "$(git ls-files | grep -E '^packages/core/[^/]+/src/' | grep -v '/test/' | xargs cat | wc -l | tr -d ' ')" -lt 20000
    - bun packages/surfaces/cli/src/main.ts docs plan --json | jq -e '[.data.drift.diffs[]? | select(.targetId != null)] | length == 0'
    - bun packages/surfaces/cli/src/main.ts docs drift --json | jq -e '.data.ok == true'
    - test -z "$(git status --short | grep -E '^.. (\.archcontext/|packages/contracts/|packages/core/module-statistics/|packages/surfaces/)')"
    - bun run verify
```

## Acceptance Notes (Human Review)

- Functional behavior: S4 verify → `resolved` → `recommendations resolve --evidence-digest` succeeds; S6 verify → `not_improved` → resolve rejected with `AC_REFACTOR_EVIDENCE_REQUIRED` / `evidence-not-resolved`; `book evidence <recommendationId>` lists the resolution item and its `EvidenceBinding/v1`.
- Edge cases: baseline digest mismatch → `stale`; after-coverage incomplete or index not covering the worktree → `stale`, never `resolved`; HEAD drift → `AC_REFACTOR_STALE`; required `symbol` kill entry → `stale`; dissolved subject module → `observedValue: null` + residual; verify twice at the same HEAD → one appended event.
- Regression risks: RF3 `refactorRecord` now also writes a baseline-snapshot evidence item — `refactor-recording.test.ts` must keep its RF3 intent; the resolve gate for `practice` recommendations is unchanged; `ledger rebuild` parity survives because resolution events carry `operations: []`.

## Rollback Point

- Commit / checkpoint: branch `codex/rf4-resolution-verification` from main `65647fe`.
- Revert strategy: `git checkout -- packages/core/refactor-assessment/src/index.ts packages/local-runtime/runtime-daemon/src/index.ts packages/local-runtime/runtime-daemon/src/refactor-recording.ts packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts && rm -f packages/core/refactor-assessment/src/resolution.ts packages/core/refactor-assessment/test/resolution.test.ts packages/local-runtime/runtime-daemon/src/refactor-verify.ts packages/local-runtime/runtime-daemon/test/refactor-verify.test.ts`; no migration, no contract change, no publish.
