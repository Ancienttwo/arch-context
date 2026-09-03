# Task Contract: rf3-recommendation-v3-ledger-recording

> **Status**: Partial
> **Plan**: plans/plan-20260903-0715-rf3-recommendation-v3-ledger-recording.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-09-03 07:15
> **Review File**: `tasks/reviews/20260903-0715-rf3-recommendation-v3-ledger-recording.review.md`
> **Notes File**: `tasks/notes/20260903-0715-rf3-recommendation-v3-ledger-recording.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

Contracts are frozen (RF1a), measurements exist (RF1b), classification exists (RF2), but nothing writes `RecommendationV3` to the ledger. Without RF3 the ledger cannot hold structural observations or agent proposals, `refactor_scan` is an unused enum arm, and RF4/RF5a have no record to verify or expose. The v2→v3 migration is the sole reason `0.5.0` is a minor bump, so its replay parity is the release gate.

## Goal

Materialize RF2's `{assessment, proposal, snapshot}` as `RecommendationV3` records through a daemon-owned `refactorRecord` transaction: `planRefactorRecommendationRun` in recommendation-engine (additive beside the RF0-frozen v2 planner; fingerprint via `recommendationV3FingerprintInput`; dedup/cooldown reused; `relations.regressesFrom` when the prior record with the same fingerprint is `resolved`; refactor-category ids derived from `{fingerprint, regressesFrom}` so a regression never overwrites the resolved record); a daemon-internal `registerRefactorAssessment` registry (bounded LRU) plus `refactorRecord` RPC in the dispatch table and clients (stale HEAD/worktree ⇒ `AC_REFACTOR_STALE`; unknown digest ⇒ `AC_SCHEMA_INVALID`; bad author pair ⇒ `AC_REFACTOR_PROPOSAL_UNAUTHORED`; one `appendArchitectureEvents` transaction with `source: refactor_scan`, `operations: []`, `catalogDigest` = classifier ruleset digest); `ledger migrate --recommendation-v3` as one appended migration event (never a row rewrite) whose `ledger rebuild` graphDigest is identical before and after; `recommendations resolve` gate: non-practice categories require `--evidence-digest` and, in 0.5.0, are rejected with `AC_REFACTOR_EVIDENCE_REQUIRED` because no resolution evidence can exist yet; `practice` unchanged. Re-project `docs/architecture` for the local-runtime module if its bucket flips.

## Scope

- In scope: recommendation-engine (`RecommendationStatus` re-export, `REFACTOR_ACTIVE_RECOMMENDATION_STATUSES`, `recommendationV3Fingerprint`, `planRefactorRecommendationRun`, `refactorRecommendationRunLedgerPayload`) + its new test; architecture-delta export of `architectureSubjectSelectorId`; architecture-ledger payload type widening (v2 | v3, v2 arm removable at 0.6.0); local-store-sqlite (expected no source change; test for migration replay parity + FK integrity); runtime-daemon (`refactor-recording.ts`, dispatch/client wiring, `ledgerMigrate` mode, resolve gate) + tests; CLI `--evidence-digest` and `ledger migrate` mode selector + cli test; docs regeneration through `archctx docs apply` only; notes.
- Out of scope: `packages/contracts/**` (frozen); `refactor scan` RPC, `refactor` CLI verb, `ARCHCTX_FEATURES`, version bump, packaged-cli-smoke (RF5a); `refactorVerify` / real evidence lookup (RF4); `supersedes` (RF4); any schema/column change to `recommendations` (`LOCAL_SQLITE_MIGRATIONS` stays at 20); `.archcontext/**`; RF0 fixtures; `planRecommendationRun` behavior.
- Taste constraints: `planRecommendationRun` and `ACTIVE_RECOMMENDATION_STATUSES` byte-frozen (RF0 fixture); practice fingerprint delegates to the frozen hasher; migration upcast never invents `practiceId` (missing ⇒ `AC_SCHEMA_INVALID`); v3-only reader afterwards fails closed with `AC_PRECONDITION_FAILED` naming the migrate command; at most one new local-runtime src file.

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.
- Stop if the migration event would need `operations` or any graph mutation (rebuild parity would break).
- Stop if `docs plan --json` reports `human-action-required` or owned drift outside the local-runtime module doc (and index.md).
- Stop after two failed fix rounds on migration replay parity; hand to the orchestrator instead of a third same-viewpoint retry.

## Falsifier

If `ledger rebuild` graphDigest differs before vs after `ledger migrate --recommendation-v3`, or if recording the same assessment twice at the same HEAD creates two records instead of one `duplicate-active-fingerprint` suppression, or if a re-detected fingerprint whose prior record is `resolved` overwrites that record instead of creating a new one with `relations.regressesFrom`, the ledger is not the single semantic authority the PRD requires. Cheapest proof: the daemon rebuild-parity test and the engine regressesFrom test, run first.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260903-0715-rf3-recommendation-v3-ledger-recording.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260903-0715-rf3-recommendation-v3-ledger-recording.review.md`
- Notes file: `tasks/notes/20260903-0715-rf3-recommendation-v3-ledger-recording.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Change Assessment

```json
{"protocol":1,"oracles":[{"id":"refactor-recording-suites","kind":"deterministic_test","paths":["*"]},{"id":"ledger-rebuild-parity-readback","kind":"runtime_readback","paths":["*"]}]}
```

## Acceptance Policy

```json
{"protocol":2,"reviewer":"Codex","source":"codex-review","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - packages/core/recommendation-engine/src/index.ts
  - packages/core/recommendation-engine/test/refactor-recommendation-v3.test.ts
  - packages/core/architecture-delta/src/index.ts
  - packages/core/architecture-ledger/src/index.ts
  - packages/local-runtime/local-store-sqlite/src/index.ts
  - packages/local-runtime/local-store-sqlite/test/recommendation-v3-migration.test.ts
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/local-runtime/runtime-daemon/src/refactor-recording.ts
  - packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts
  - packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
  - packages/surfaces/cli/src/main.ts
  - packages/surfaces/cli/test/cli.test.ts
  - docs/architecture/
  - plans/plan-20260903-0715-rf3-recommendation-v3-ledger-recording.md
  - tasks/todos.md
  - tasks/contracts/20260903-0715-rf3-recommendation-v3-ledger-recording.contract.md
  - tasks/reviews/20260903-0715-rf3-recommendation-v3-ledger-recording.review.md
  - tasks/notes/20260903-0715-rf3-recommendation-v3-ledger-recording.notes.md
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
    - packages/local-runtime/runtime-daemon/src/refactor-recording.ts
    - packages/core/recommendation-engine/test/refactor-recommendation-v3.test.ts
    - packages/local-runtime/local-store-sqlite/test/recommendation-v3-migration.test.ts
    - packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260903-0715-rf3-recommendation-v3-ledger-recording.notes.md
  tests_pass: []
  commands_succeed:
    - bun run typecheck
    - node scripts/package-boundary-audit.mjs
    - bun test packages/core/recommendation-engine/test/refactor-recommendation-v3.test.ts --timeout 60000
    - bun test packages/core/recommendation-engine/test/recommendation-engine.test.ts --timeout 60000
    - bun test packages/core/recommendation-engine/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/core/refactor-decision/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/core/pressure-engine/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/core/projection-engine/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/core/application/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/local-runtime/codegraph-adapter/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/contracts/test/refactor-contracts.test.ts --timeout 60000
    - bun test packages/contracts/test/contracts.test.ts --timeout 60000
    - bun test packages/core/module-statistics/test/snapshot.test.ts --timeout 60000
    - bun test packages/core/refactor-assessment/test/scale.test.ts --timeout 60000
    - bun test packages/local-runtime/local-store-sqlite/test/recommendation-v3-migration.test.ts --timeout 60000
    - bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts --timeout 60000
    - bun test packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts --timeout 120000
    - bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --timeout 120000
    - bun test packages/surfaces/cli/test/cli.test.ts --timeout 120000
    - grep -q '"refactor_scan"' packages/local-runtime/runtime-daemon/src/refactor-recording.ts
    - grep -q 'refactorRecord' packages/local-runtime/runtime-daemon/src/index.ts
    - grep -q -- '--evidence-digest' packages/surfaces/cli/src/main.ts
    - grep -q -- '--recommendation-v3' packages/surfaces/cli/src/main.ts
    - test -z "$(git status --short -- packages/contracts .archcontext packages/core/recommendation-engine/test/fixtures)"
    - bun packages/surfaces/cli/src/main.ts docs plan --json | jq -e '[.data.drift.diffs[]? | select(.targetId != null)] | length == 0'
    - bun packages/surfaces/cli/src/main.ts docs drift --json | jq -e '.data.ok == true'
    - bun run verify
# Optional exact-subject reuse is fail-closed and opt-in. List only deterministic
# criteria whose inputs are fully bound by the frozen subject/toolchain context.
# criterion_reuse:
#   tests_pass:
#     - path/to/deterministic.test.ts
#   commands_succeed:
#     - bun test --timeout 60000
```

## Acceptance Notes (Human Review)

- Functional behavior: additive engine planner, daemon RPC + registry, append-only migration event, resolve gate, CLI flags; practice recommendations unchanged; v2 planner byte-frozen.
- Edge cases: duplicate record at same HEAD; resolved prior ⇒ regressesFrom with distinct id; HEAD drift; unknown/evicted assessment digest; daemon-authored proposal rejected; migration idempotent (second run upgrades 0); missing practiceId fails closed; v2 record read after migration fails closed.
- Regression risks: ledger replay parity; RF0 recommendation-engine fixtures; local-runtime file-count bucket (add ≤ 7 files; plan adds 1); docs regeneration confined to generated regions.

## Rollback Point

- Commit / checkpoint: branch `codex/rf3-recommendation-v3-ledger-recording` from `main` at `0185ed5`.
- Revert strategy: revert the touched src files and remove the four new files; no SQLite schema migration added; an applied `--recommendation-v3` event is append-only and inert if the code is reverted.
