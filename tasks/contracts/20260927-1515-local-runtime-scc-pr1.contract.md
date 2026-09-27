# Task Contract: local-runtime-scc-pr1

> **Status**: Fulfilled
> **Plan**: plans/plan-20260927-1515-local-runtime-scc-pr1.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: chris
> **Capability ID**: root
> **Last Updated**: 2026-09-27 15:20
> **Review File**: `tasks/reviews/20260927-1515-local-runtime-scc-pr1.review.md`
> **Notes File**: `tasks/notes/20260927-1515-local-runtime-scc-pr1.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

The daemon measured SCC `scc.50085af2f3acf4b2` (12 members, 39 cycle edges at 331c526, recommendation.5377a3da596dedcd). Its hub is `runtime-daemon`: a catch-all ownership glob silently absorbs shared helpers (egress-admission, loopback-auth, audit helpers, the v3 migration planner) and `index.ts` hosts facade types other services import back. Left alone, every new helper under runtime-daemon/src re-enters the cycle; shipping wrong would break the public `@archcontext/local-runtime/*` surface, the RPC wire contract or v3 migration event bytes.

## Goal

Deliver PR-1 of the approved plan: (T1) egress-admission becomes a leaf directory/component behind the unchanged `./egress-admission` subpath; (T2) one ChangeSet re-owns loopback-auth to rpc-server and audit-consent/github-issue-executor/investigation-transport to audit, creates the egress-admission component and excludes the five files from runtime-daemon; (T3) agent-jobs, external-documentation, developer-review-run, rpc-server and projection-service stop importing facade types from `./index` (structural ports; ledger rollout types move to ledger-admin); (T4) the v3 migration planner moves byte-identically into ledger-admin. The post-commit scan shows a strictly smaller SCC with every removed edge explained.

## Scope

- In scope: T1–T4 and verification in the plan's Task Breakdown; recording PR-2 (type relocation into rpc-client's rpc-methods.ts/developer-review-codec.ts) and scan precision (type-only vs value edges, re-export and `typeof import()` coverage) as deferred goals in tasks/todos.md.
- Out of scope: PR-2 type relocation; any change to the scan/edge-derivation code; RPC method table, codecs, RUNTIME_RPC_VERSION or wire baseline; package.json subpath names; SQLite/runtime state; 0.5.12 publication.
- Taste constraints: move code unchanged where possible; no new abstraction; model YAML only through `scripts/apply-model-proposal.ts` ChangeSet executed by the parent, never by a subagent.

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

If the post-commit `archctx refactor scan --json` (same CodeGraph version, fresh index, complete coverage) does not shrink the SCC, or any removed edge cannot be mapped to a planned file move / re-ownership / removed import, or unowned / multiply-owned path counts increase, the direction is wrong. Cheapest proof point: after T1+T2 alone, the parent module `module.architecture-context.local-runtime` must leave the SCC.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260927-1515-local-runtime-scc-pr1.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260927-1515-local-runtime-scc-pr1.review.md`
- Notes file: `tasks/notes/20260927-1515-local-runtime-scc-pr1.notes.md`
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
  - packages/local-runtime/egress-admission/src/index.ts
  - packages/local-runtime/runtime-daemon/src/egress-admission.ts
  - packages/local-runtime/package.json
  - packages/local-runtime/src/index.ts
  - tsconfig.json
  - packages/local-runtime/runtime-daemon/src/agent-jobs.ts
  - packages/local-runtime/runtime-daemon/src/external-documentation.ts
  - packages/local-runtime/runtime-daemon/src/developer-review-run.ts
  - packages/local-runtime/runtime-daemon/src/rpc-server.ts
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/local-runtime/runtime-daemon/src/ledger-admin.ts
  - packages/local-runtime/runtime-daemon/src/projection-service.ts
  - packages/local-runtime/runtime-daemon/src/refactor-recording.ts
  - packages/local-runtime/runtime-daemon/test/egress-admission.test.ts
  - packages/local-runtime/local-store-sqlite/test/recommendation-v3-migration.test.ts
  - docs/runbooks/local-egress-policy.md
  - .archcontext/
  - docs/architecture/
  - bun.lock
  - plans/
  - tasks/todos.md
  - tasks/current.md
  - tasks/workflow-state.yaml
  - tasks/contracts/20260927-1515-local-runtime-scc-pr1.contract.md
  - tasks/reviews/20260927-1515-local-runtime-scc-pr1.review.md
  - tasks/notes/20260927-1515-local-runtime-scc-pr1.notes.md
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
    - packages/local-runtime/egress-admission/src/index.ts
    - .archcontext/model/nodes/component.architecture-context.local-runtime.egress-admission.yaml
  artifacts_exist:
    - tasks/notes/20260927-1515-local-runtime-scc-pr1.notes.md
```

## Verification Plan

```json
{
  "protocol": 1,
  "checks": [
    {
      "id": "typecheck",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun run typecheck",
      "cwd": ".",
      "phase": "preflight",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Moved files, structural ports and type re-exports must compile together on the pinned toolchain.",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "package-boundary-audit",
      "kind": "command",
      "command": "node scripts/package-boundary-audit.mjs",
      "cwd": ".",
      "phase": "preflight",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "The egress-admission subpath retarget must keep workspace package boundaries valid.",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "model-validate",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun packages/surfaces/cli/src/main.ts validate",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "The re-ownership ChangeSet must leave a valid architecture model.",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "affected-tests",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun test --timeout 60000 packages/local-runtime/runtime-daemon/test/agent-jobs.test.ts packages/local-runtime/runtime-daemon/test/audit.test.ts packages/local-runtime/runtime-daemon/test/developer-review-run.test.ts packages/local-runtime/runtime-daemon/test/external-documentation.test.ts packages/local-runtime/runtime-daemon/test/ledger-admin.test.ts packages/local-runtime/runtime-daemon/test/explorer-server.test.ts packages/local-runtime/runtime-daemon/test/projection-apply.test.ts packages/local-runtime/runtime-daemon/test/rpc-server.test.ts packages/local-runtime/runtime-daemon/test/rpc-client.test.ts packages/local-runtime/runtime-daemon/test/rpc-methods.test.ts packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts packages/local-runtime/runtime-daemon/test/egress-admission.test.ts packages/local-runtime/context7-adapter/test/egress-admission.test.ts packages/local-runtime/local-store-sqlite/test/recommendation-v3-migration.test.ts",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Covers every moved/retyped service, the RPC wire table and the byte-identical v3 migration event (baseline 226 pass at 331c526).",
      "inputs": {
        "env": []
      }
    },
    {
      "id": "packaged-cli-smoke",
      "kind": "command",
      "command": "node scripts/packaged-cli-smoke.mjs",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "The packaged CLI and daemon must still start after the egress-admission file move.",
      "inputs": {
        "env": []
      }
    }
  ]
}
```

## Acceptance Notes (Human Review)

- Functional behavior:
- Edge cases:
- Regression risks:

## Rollback Point

- Commit / checkpoint: base 331c526 (main); branch codex/local-runtime-scc-pr1.
- Revert strategy: `git revert` the PR for code; revert the model through an inverse ChangeSet via `scripts/apply-model-proposal.ts`, never by hand-editing YAML. No SQLite, wire protocol or subpath-name change to undo.
