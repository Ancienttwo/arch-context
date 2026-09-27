# Task Contract: linux-arm64-descriptor-flags

> **Status**: Fulfilled
> **Plan**: plans/plan-20260927-1318-linux-arm64-descriptor-flags.md
> **Task Profile**: bugfix
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: chris
> **Capability ID**: root
> **Last Updated**: 2026-09-27 13:18
> **Review File**: `tasks/reviews/20260927-1318-linux-arm64-descriptor-flags.review.md`
> **Notes File**: `tasks/notes/20260927-1318-linux-arm64-descriptor-flags.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

The merged-main 0.5.12 tarball cannot initialize a repository on Linux arm64: the native no-follow writer opens its trusted root with x86_64 Linux flag values and receives `EINVAL`. This blocks public release despite passing x86_64/macOS/Windows CI. The writer protects against symlink redirection, so any repair must keep that security boundary.

## Goal

Use platform-owned Linux directory/no-follow flag values, fail closed if unavailable, and prove the existing private-file behavior test and full changeset suite pass on Linux arm64. Add a focused hosted ARM guard and verify an installed source-built tarball can complete the cold CLI/daemon path; do not publish npm packages.

## Scope

- In scope: `descriptor-relative-write.ts`, a focused Linux arm64 CI job, red/green evidence using the existing behavior test, release-boundary research and workflow records.
- Out of scope: changes to Darwin/Windows write semantics, expected-hash or no-follow policy, npm publication, unrelated architecture model work.
- Taste constraints: no pathname fallback and no flag value inferred from architecture names; Node's `fs.constants` is the platform authority.

## Stop Conditions

- Stop if the patch weakens `O_NOFOLLOW`, expected-hash checks, atomic commit or private modes.
- Stop if a cold ARM tarball still fails after runtime flag selection; then this root-cause hypothesis is false or incomplete.
- Do not publish npm; another agent owns release and must rebuild from exact merged source.

## Falsifier

The direction is wrong if `node:fs.constants.O_DIRECTORY` / `O_NOFOLLOW` on Linux arm64 still produce `EINVAL` in the same root-open call. Cheapest proof: the existing private-file behavior test in a disposable Linux arm64 container.

## Root Cause Evidence

- root_cause: packages/core/changeset-engine/src/descriptor-relative-write.ts:39-46 assigns x86_64 `O_DIRECTORY` and `O_NOFOLLOW` numbers to every Linux CPU; arm64 root open rejects the resulting flags with errno 22.
- repro: on Linux arm64 run `bun test packages/core/changeset-engine/test/changeset-engine.test.ts -t "creates a private file"` against pre-fix source, or install the merged-main 0.5.12 tarball and run `archctx init` in a CodeGraph-indexed repo.
- regression_guard: packages/core/changeset-engine/test/changeset-engine.test.ts
- pre_fix_failure_artifact: tasks/notes/20260927-1318-linux-arm64-descriptor-flags.pre-fix.txt

## Workflow Inventory

- Source plan: `plans/plan-20260927-1318-linux-arm64-descriptor-flags.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260927-1318-linux-arm64-descriptor-flags.review.md`
- Notes file: `tasks/notes/20260927-1318-linux-arm64-descriptor-flags.notes.md`
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
{"protocol":2,"reviewer":"Codex","source":"codex-plugin","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - .github/workflows/verify.yml
  - packages/core/changeset-engine/src/descriptor-relative-write.ts
  - docs/researches/20260927-linux-arm64-descriptor-flags.md
  - plans/plan-20260927-1318-linux-arm64-descriptor-flags.md
  - tasks/todos.md
  - tasks/contracts/20260927-1318-linux-arm64-descriptor-flags.contract.md
  - tasks/reviews/20260927-1318-linux-arm64-descriptor-flags.review.md
  - tasks/notes/20260927-1318-linux-arm64-descriptor-flags.notes.md
  - tasks/notes/20260927-1318-linux-arm64-descriptor-flags.pre-fix.txt
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
    - packages/core/changeset-engine/src/descriptor-relative-write.ts
    - docs/researches/20260927-linux-arm64-descriptor-flags.md
  artifacts_exist:
    - tasks/notes/20260927-1318-linux-arm64-descriptor-flags.pre-fix.txt
```

## Verification Plan

```json
{
  "protocol": 1,
  "checks": [
    {
      "id": "changeset-behavior",
      "kind": "package_test",
      "path": "packages/core/changeset-engine/test/changeset-engine.test.ts",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Exercises private mode, no-follow traversal, expected hashes and atomic writes; the same guard failed before and passed after on Linux arm64.",
      "inputs": { "env": [] }
    },
    {
      "id": "typecheck",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun run typecheck",
      "cwd": ".",
      "phase": "preflight",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "The Node fs constant access and POSIX flag guard must typecheck across the supported targets.",
      "inputs": { "env": [] }
    },
    {
      "id": "package-dry-run",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun scripts/fg6-npm-release-dry-run.ts run --out _ops/npm/linux-open-fixed/evidence.json --artifact-dir _ops/npm/linux-open-fixed",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Checks that the fixed source is included in a valid release artifact without publishing it.",
      "inputs": { "env": [] }
    },
    {
      "id": "installed-tarball-smoke",
      "kind": "command",
      "command": "node scripts/local-product-tarball-smoke.mjs --artifact-dir _ops/npm/linux-open-fixed/smoke --timeout-ms 90000",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Checks the installed Node-only CLI and daemon lifecycle from source-built package bytes.",
      "inputs": { "env": [] }
    }
  ]
}
```

## Acceptance Notes (Human Review)

- Functional behavior: native root open and no-follow writes work on Linux arm64 without changing Darwin/Windows semantics.
- Edge cases: symlinked destination/parent, concurrent replacement, private mode and expected-hash mismatch remain covered by the existing suite.
- Regression risks: platform flag availability, cross-architecture package bundling and ARM runner availability.

## Rollback Point

- Commit / checkpoint: source main `331c526` before this fix.
- Revert strategy: revert source and focused CI job before npm publication.
