> **Archived**: 2026-09-10 18:32
> **Related Plan**: plans/archive/plan-20260910-1639-projection-journal-read.md
> **Outcome**: Completed
> **Lifecycle**: contract
> **Parent Run ID**: run-20260910-1832
> **Archive Projection V1**: `plans/plan-20260910-1639-projection-journal-read.md` => `plans/archive/plan-20260910-1639-projection-journal-read.md`
> **Archive Projection V1**: `tasks/notes/20260910-1639-projection-journal-read.notes.md` => `tasks/archive/notes-20260910-1832-projection-journal-read.md`
> **Archive Projection V1**: `tasks/contracts/20260910-1639-projection-journal-read.contract.md` => `tasks/archive/contract-20260910-1832-projection-journal-read.md`
> **Archive Projection V1**: `tasks/reviews/20260910-1639-projection-journal-read.review.md` => `tasks/archive/review-20260910-1832-projection-journal-read.md`

# Task Contract: projection-journal-read

> **Status**: Fulfilled
> **Plan**: plans/archive/plan-20260910-1639-projection-journal-read.md
> **Task Profile**: bugfix
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-09-10 16:39
> **Review File**: `tasks/archive/review-20260910-1832-projection-journal-read.md`
> **Notes File**: `tasks/archive/notes-20260910-1832-projection-journal-read.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

Every projection invocation reads prior committed applies before rendering. An unnecessary workspace scan makes this historical read exceed the consumer deadline as ignored runtime evidence grows.

## Goal

Read prior projection journal entries without creating a repository session or snapshot, preserving root/request filtering and deduplication.

## Scope

- In scope: one daemon journal-read method, its existing regression suite, and bounded evidence.
- Out of scope: digest definitions, write preconditions, timeout policy, cloud behavior and unrelated runtime cleanup.
- Taste constraints: <!-- advisory only, no run gate; default style/taste lives in AGENTS.md and the minimal-change policy, use this to record a per-task override -->

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

If prior apply lookup still creates a snapshot after removing the session initialization, the regression falsifies this fix. Existing replay/RPC assertions must retain their exact historical entries.

## Root Cause Evidence

- root_cause: runtime-daemon/src/index.ts listProjectionPriorCommittedApplies calls openSession before a journal-only lookup, hashing the source tree including 31.2 GiB of .ai/harness runtime evidence.
- repro: bounded provider check timed out; direct prior-applies RPC did not create a snapshot, and an in-flight daemon sample showed file reads and SHA-256.
- regression_guard: tests/projection-prior-committed-applies.test.ts
- pre_fix_failure_artifact: .ai/harness/runs/projection-journal-read.red.txt

## Workflow Inventory

- Source plan: `plans/archive/plan-20260910-1639-projection-journal-read.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/archive/review-20260910-1832-projection-journal-read.md`
- Notes file: `tasks/archive/notes-20260910-1832-projection-journal-read.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Change Assessment

```json
{"protocol":1,"oracles":[{"id":"journal-read-regression","kind":"deterministic_test","paths":["*"]},{"id":"isolated-node-package-readback","kind":"runtime_readback","paths":["*"]}]}
```

## Acceptance Policy

```json
{"protocol":2,"reviewer":"Codex","source":"codex-plugin","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - actions/review-action/action.yml
  - bun.lock
  - docs/examples/github-hosted-runner-workflow.yml
  - docs/examples/reusable-organization-runner-caller.yml
  - docs/runbooks/personal-user-install.md
  - docs/verification/fg4-deterministic-conclusion-readback.json
  - docs/verification/fg6-no-provider-deterministic-readback.json
  - package.json
  - packages/cloud/package.json
  - packages/contracts/fixtures/valid/archctx-capabilities.json
  - packages/contracts/fixtures/valid/product-version-manifest.json
  - packages/contracts/package.json
  - packages/contracts/src/product-version.ts
  - packages/core/package.json
  - packages/core/practice-catalog/assets/catalog.yaml
  - packages/local-runtime/package.json
  - packages/surfaces/package.json
  - docs/verification/archctx-0.5.10-release.json
  - packages/local-runtime/runtime-daemon/src/index.ts
  - tests/projection-prior-committed-applies.test.ts
  - tasks/todos.md
  - docs/researches/20260910-projection-journal-read.md
  - plans/archive/plan-20260910-1639-projection-journal-read.md
  - tasks/archive/contract-20260910-1832-projection-journal-read.md
  - tasks/archive/review-20260910-1832-projection-journal-read.md
  - tasks/archive/notes-20260910-1832-projection-journal-read.md
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
    - docs/researches/20260910-projection-journal-read.md

```

## Verification Plan

```json
{
  "protocol": 1,
  "checks": [
    {
      "id": "journal-regression",
      "kind": "package_test",
      "path": "tests/projection-prior-committed-applies.test.ts",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Real daemon journal read creates no session or snapshot and preserves historical replay/RPC identity.",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "typecheck",
      "kind": "command",
      "command": "bun run typecheck",
      "cwd": ".",
      "phase": "preflight",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Preserve daemon and RPC TypeScript contracts.",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "package-boundaries",
      "kind": "command",
      "command": "bun run check:package-boundaries",
      "cwd": ".",
      "phase": "preflight",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Preserve runtime package import boundaries.",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "governance",
      "kind": "command",
      "command": "bun run verify:governance",
      "cwd": ".",
      "phase": "verification",
      "cost": "expensive",
      "evidence_policy": "baseline_with_delta",
      "necessity": "Version-derived deterministic governance readbacks must match 0.5.10. Preserve the successful dd054768 baseline; only the public guide and release/workflow records changed afterward, checked by release-doc-delta.",
      "inputs": {
        "env": [
          "PATH"
        ]
      },
      "baseline": {
        "run_file": ".ai/harness/runs/verification-vx-bc74c8984926476aaded.json",
        "execution_id": "vx-bc74c8984926476aaded"
      },
      "delta_checks": [
        "release-doc-delta"
      ]
    },
    {
      "id": "release-tarballs",
      "kind": "command",
      "command": "bun scripts/fg6-npm-release-dry-run.ts run --out artifacts/release-0.5.10/package-readback.json --artifact-dir artifacts/release-0.5.10 --json",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "The official builder validates and packs both real 0.5.10 package distributions.",
      "inputs": {
        "env": [
          "PATH"
        ]
      }
    },
    {
      "id": "installed-product",
      "kind": "command",
      "command": "node scripts/local-product-tarball-smoke.mjs --artifact-dir artifacts/release-0.5.10/smoke --out artifacts/release-0.5.10/runtime-readback.json",
      "cwd": ".",
      "phase": "verification",
      "cost": "expensive",
      "evidence_policy": "baseline_with_delta",
      "necessity": "Verify CLI, daemon, MCP, packaged assets and lifecycle from the Node-installed 0.5.10 tarball; source tests do not prove package contents. Preserve the successful dd054768 baseline; only the public guide and release/workflow records changed afterward, checked by release-doc-delta.",
      "inputs": {
        "env": [
          "PATH"
        ]
      },
      "baseline": {
        "run_file": ".ai/harness/runs/verification-vx-74048205de4240fc9975.json",
        "execution_id": "vx-74048205de4240fc9975"
      },
      "delta_checks": [
        "release-doc-delta"
      ]
    },
    {
      "id": "release-doc-delta",
      "kind": "command",
      "command": "git diff --exit-code dd0547686634304752c74f5e11e8c10b753da23e -- . ':!docs/runbooks/personal-user-install.md' ':!tasks/**' ':!plans/**' ':!docs/verification/archctx-0.5.10-release.json' && git diff --exit-code e4a3a56640155bf9889b2dbb02754774035493b4 -- docs/runbooks/personal-user-install.md",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Prove candidate code, version manifests, generated product assets and test inputs remain byte-identical to the passing release baseline, and the installation guide retains the currently published 0.5.9 instructions.",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "migration-packaging",
      "kind": "command",
      "command": "bun scripts/architecture-ledger-al10-release-packaging-readback.ts run --out artifacts/release-0.5.10/migration-packaging.json --report artifacts/release-0.5.10/migration-packaging.md --json",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Verify the official tarball contains ledger runtime/migration support and passes the existing migration matrix.",
      "inputs": {
        "env": [
          "PATH"
        ]
      }
    }
  ]
}
```

## Acceptance Notes (Human Review)

- Functional behavior: historical records remain filtered and deduplicated by the existing store/protocol.
- Edge cases: new request, other root/request, repeated commits, and RPC serialization.
- Regression risks: accidental source scanning or session persistence in a journal read.
- Local package: official npm release dry-run builder and isolated install; Node 24.18.0 direct RPC against the 31.2 GiB consumer root returned in 0.1003 seconds with zero snapshots.
- Scope boundary: 0.5.10 release is now user-authorized; public state remains unchanged until CI, acceptance and registry authentication succeed.
- Prepared verification: run-20260910T171526-31882-20260910-1639-projection-journal-read passed all 3 exact checks. Evidence-event emission was cannot-bind (contract_not_committed); the contract remains Active until the committed authority and official semantic AcceptanceReceipt exist.

## Rollback Point

- Commit / checkpoint: e4a3a56640155bf9889b2dbb02754774035493b4.
- Revert strategy: revert only the runtime/test change; no runtime data migration.

## Release evidence delta

Baseline dd054768 passed all six checks in run-20260910T175146-81774, including full verify:governance (342551 ms) and installed-product smoke (22129 ms). The only post-baseline correction restores the public install guide to verified 0.5.9 pending registry publication; release records and workflow evidence reflect the actual candidate state. No package input or product behavior changes. Baseline_with_delta retains expensive evidence without claiming a full-suite pass for the newer documentation subject. Hosted Required CI still runs for the new PR head.
