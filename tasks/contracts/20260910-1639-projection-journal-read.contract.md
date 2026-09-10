# Task Contract: projection-journal-read

> **Status**: Active
> **Plan**: plans/plan-20260910-1639-projection-journal-read.md
> **Task Profile**: bugfix
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-09-10 16:39
> **Review File**: `tasks/reviews/20260910-1639-projection-journal-read.review.md`
> **Notes File**: `tasks/notes/20260910-1639-projection-journal-read.notes.md`
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

- Source plan: `plans/plan-20260910-1639-projection-journal-read.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260910-1639-projection-journal-read.review.md`
- Notes file: `tasks/notes/20260910-1639-projection-journal-read.notes.md`
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
  - plans/plan-20260910-1639-projection-journal-read.md
  - tasks/contracts/20260910-1639-projection-journal-read.contract.md
  - tasks/reviews/20260910-1639-projection-journal-read.review.md
  - tasks/notes/20260910-1639-projection-journal-read.notes.md
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
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Version-derived deterministic governance readbacks must match 0.5.10.",
      "inputs": {
        "env": [
          "PATH"
        ]
      }
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
      "evidence_policy": "current_exact",
      "necessity": "Verify CLI, daemon, MCP, packaged assets and lifecycle from the Node-installed 0.5.10 tarball; source tests do not prove package contents.",
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
