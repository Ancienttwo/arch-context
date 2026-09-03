# Task Contract: rf5a-cli-rpc-capabilities-0-5-0

> **Status**: Fulfilled
> **Plan**: plans/plan-20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-09-03 09:09
> **Review File**: `tasks/reviews/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.review.md`
> **Notes File**: `tasks/notes/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

RF1b/RF2 measure and classify, RF3 records, but nothing reaches a caller: no RPC composes snapshot → assessment → registry, no CLI verb exists, and repo-harness fails closed on the missing capability features. `0.5.0` is a minor bump because RF3 rewrites persisted recommendations. This slice is what makes Program B's shadow canary possible.

## Goal

Add daemon `refactorScan` (new `packages/local-runtime/runtime-daemon/src/refactor-scan.ts`): validate `RefactorRequestV1`; compute repository/worktree identity; `readTrackedSourceFiles` (HEAD blobs) once and feed the same `trackedFiles` to `buildModuleStatisticsSnapshot` and `assessRefactor`; `readWorkspacePackages`; `repositoryImportPairs`; `createdAt` = HEAD committer date (`readHeadCommitterDate` added to git-adapter) and `requestId` derived from the request digest so `scan --json` is byte-identical across runs; `registerRefactorAssessment` (RF3); return `{snapshot, assessment, proposal?, proposedRecommendations}`; failures `AC_MODEL_ADOPTION_REQUIRED` / `AC_REFACTOR_STALE` / `AC_SCHEMA_INVALID`; wire RPC client/interface/dispatch with LONG timeout. Add CLI `archctx refactor scan [--request-json <json>] [--json]` (default scope repository) and `archctx refactor record --assessment-digest --expected-worktree-digest [--json]` as thin adapters; `help` commands/examples updated; NO MCP tool. Add `module-statistics-v1`, `refactor-assessment-v1`, `recommendation-v3` to `ARCHCTX_FEATURES` (sorted) with the capabilities schema enum and fixture updated. Bump the product to `0.5.0` everywhere the version is pinned (product-version, all package manifests + bun.lock, product-version-manifest fixture, `catalog.yaml` regenerated so its digest matches, review-action, spec/runbook/examples) and draft `deploy/release-checklists/archctx-0.5.0.md` from the 0.4.8 template (unticked). Extend `packaged-cli-smoke.mjs` to cover `refactor scan`. Re-project docs only if a bucket flips.

## Scope

- In scope: exactly the file list in the plan's File Changes table plus tests (`runtime-daemon/test/refactor-scan.test.ts`, `cli/test/cli.test.ts`), the release checklist skeleton, docs regeneration via `archctx docs apply` only.
- Out of scope: `refactorVerify` / `refactor-resolution-v1` (RF5b); MCP tools; `packages/contracts/src/{refactor,ledger}.ts` (frozen); `packages/core/module-statistics`, `packages/core/refactor-assessment` logic; RF0 fixtures; `.archcontext/**`; the npm publish itself (row 7); `packages/cloud/**` beyond its manifest version.
- Taste constraints: no clock reads in the scan path; CLI never post-processes/sorts the envelope; smoke repo gets `git init` + commit AFTER the last `apply` and before the final `daemon stop`; `refactor-scan.ts` must not reference `MockCodeGraphProvider`/`TestLocalStore`; at most ONE new local-runtime src file.

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.
- Stop if two `scan --json` runs differ and the difference cannot be traced to a real source of nondeterminism (never mask it in the CLI).
- Stop if `practice-catalog.test.ts` fails after the bump and the fix would be editing the catalog digest by hand.
- Stop if `docs plan --json` reports `human-action-required` or `rejected` entries.

## Falsifier

If `archctx refactor scan --json` twice at the same HEAD produces different bytes, or if `capabilities --json` does not list the three new features, or if a downstream exact-version check would still see `0.4.8` anywhere in shipped code, this slice does not deliver 0.5.0. Cheapest proof: the determinism cmp and the scoped `rg` sweep, run first.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.review.md`
- Notes file: `tasks/notes/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Change Assessment

```json
{"protocol":1,"oracles":[{"id":"refactor-scan-and-cli-suites","kind":"deterministic_test","paths":["*"]},{"id":"packaged-cli-smoke-readback","kind":"runtime_readback","paths":["*"]}]}
```

## Acceptance Policy

```json
{"protocol":2,"reviewer":"Codex","source":"codex-review","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - packages/contracts/src/projection.ts
  - packages/contracts/src/product-version.ts
  - packages/contracts/package.json
  - packages/contracts/fixtures/valid/archctx-capabilities.json
  - packages/contracts/fixtures/valid/product-version-manifest.json
  - schemas/runtime/archctx-capabilities.schema.json
  - packages/core/practice-catalog/assets/catalog.yaml
  - packages/core/package.json
  - packages/local-runtime/package.json
  - packages/surfaces/package.json
  - packages/cloud/package.json
  - packages/local-runtime/git-adapter/src/index.ts
  - packages/local-runtime/runtime-daemon/src/refactor-scan.ts
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/local-runtime/runtime-daemon/test/refactor-scan.test.ts
  - packages/surfaces/cli/src/main.ts
  - packages/surfaces/cli/test/cli.test.ts
  - scripts/packaged-cli-smoke.mjs
  - package.json
  - bun.lock
  - actions/review-action/action.yml
  - deploy/release-checklists/archctx-0.5.0.md
  - docs/spec.md
  - docs/runbooks/personal-user-install.md
  - docs/examples/github-hosted-runner-workflow.yml
  - docs/examples/reusable-organization-runner-caller.yml
  - docs/architecture/
  - plans/plan-20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.md
  - tasks/todos.md
  - tasks/contracts/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.contract.md
  - tasks/reviews/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.review.md
  - tasks/notes/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.notes.md
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
    - packages/local-runtime/runtime-daemon/src/refactor-scan.ts
    - packages/local-runtime/runtime-daemon/test/refactor-scan.test.ts
    - deploy/release-checklists/archctx-0.5.0.md
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260903-0909-rf5a-cli-rpc-capabilities-0-5-0.notes.md
  tests_pass: []
  commands_succeed:
    - bun run typecheck
    - node scripts/package-boundary-audit.mjs
    - node scripts/production-mock-reachability-audit.mjs
    - bun test packages/local-runtime/runtime-daemon/test/refactor-scan.test.ts --timeout 120000
    - bun test packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts --timeout 120000
    - bun test packages/surfaces/cli/test/cli.test.ts --timeout 120000
    - bun test packages/contracts/test/contracts.test.ts --timeout 60000
    - bun test packages/contracts/test/refactor-contracts.test.ts --timeout 60000
    - bun test packages/core/practice-catalog/test/practice-catalog.test.ts --timeout 60000
    - bun test packages/core/module-statistics/test/snapshot.test.ts --timeout 60000
    - bun test packages/core/refactor-assessment/test/scale.test.ts --timeout 60000
    - bun test packages/core/recommendation-engine/test/refactor-baseline.test.ts --timeout 60000
    - bun test packages/local-runtime/codegraph-adapter/test/refactor-baseline.test.ts --timeout 60000
    - bun packages/surfaces/cli/src/main.ts capabilities --json | jq -e '(.features | index("module-statistics-v1")) != null and (.features | index("refactor-assessment-v1")) != null and (.features | index("recommendation-v3")) != null and (.package.version == "0.5.0")'
    - bun packages/surfaces/cli/src/main.ts help --json | jq -e '.data.commands | index("refactor") != null'
    - test "$(bun packages/surfaces/cli/src/main.ts refactor scan --json | shasum -a 256 | cut -c1-64)" = "$(bun packages/surfaces/cli/src/main.ts refactor scan --json | shasum -a 256 | cut -c1-64)"
    - grep -q '"version": "0.5.0"' package.json
    - grep -q '"version": "0.5.0"' packages/contracts/package.json
    - test -z "$(rg -n --fixed-strings '0.4.8' --glob '!CHANGELOG*' --glob '!docs/**' --glob '!deploy/**' --glob '!plans/**' --glob '!tasks/**' --glob '!.claude/**' --glob '!.ai/**' --glob '!bun.lock' .)"
    - node scripts/packaged-cli-smoke.mjs
    - bun packages/surfaces/cli/src/main.ts docs plan --json | jq -e '[.data.drift.diffs[]? | select(.targetId != null)] | length == 0'
    - bun packages/surfaces/cli/src/main.ts docs drift --json | jq -e '.data.ok == true'
    - test -z "$(git status --short | grep -E '^.. (\.archcontext/|packages/contracts/src/(refactor|ledger)\.ts|packages/core/(module-statistics|refactor-assessment)/)')"
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

- Functional behavior: new scan RPC + CLI verb; feature flags; version bump; no behavior change to existing verbs; no MCP change.
- Edge cases: model missing on a fresh repo; stale expected head/worktree; request JSON invalid; two scans byte-identical; record twice ⇒ dedup; smoke repo without git before the added init.
- Regression risks: catalog digest parity; version pins missed (scoped rg); surfaces/local-runtime bucket flips; smoke timeout (30s per process).

## Rollback Point

- Commit / checkpoint: branch `codex/rf5a-cli-rpc-capabilities-0-5-0` from `main` at `b0da678`.
- Revert strategy: `git checkout` the touched files and remove the two new files plus the checklist; nothing published, no database migrated.
