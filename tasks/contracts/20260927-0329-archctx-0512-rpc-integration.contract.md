# Task Contract: archctx-0512-rpc-integration

> **Status**: Fulfilled
> **Plan**: plans/plan-20260927-0329-archctx-0512-rpc-integration.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: chris
> **Capability ID**: root
> **Last Updated**: 2026-09-27 03:29
> **Review File**: `tasks/reviews/20260927-0329-archctx-0512-rpc-integration.review.md`
> **Notes File**: `tasks/notes/20260927-0329-archctx-0512-rpc-integration.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

Main already contains the RPC `Connection: close` fix from #180, but public `archctx@0.5.11` does not. `repo-harness@0.19.2` still pins `archctx@0.5.10`; a future package release needs source version identity and packaged bytes that agree. A wrong 0.5.12 merge could cause the publication agent to ship the older tag-based candidate or publish an unverified main snapshot under the same version.

## Goal

Merge a reviewable current-main PR that aligns the 0.5.12 version anchors and hands off an explicitly main-based package candidate. Do not publish npm packages in this task.

## Scope

- In scope: root/workspace versions, lockfile, product constant, contract fixtures, practice catalog digest, runner templates, release research, plan/review/notes, exact package smoke and PR/CI merge.
- Out of scope: runtime transport source (already merged), npm publication, `repo-harness` dependency upgrade, ledger/YAML model edits, unrelated PR #223.
- Taste constraints: preserve current main's private `@archcontext/contracts` source manifest; no new transport shim or retry path.

## Stop Conditions

- Stop if a change would ship tag-based tarball bytes while claiming current-main provenance.
- Stop if version anchors disagree, current-main packaging checks fail, or required PR CI is not green.
- Do not publish to npm; that is owned by another agent.

## Falsifier

If the current-main dry-run reports a different package version from the installed CLI, or current-main `verify` fails, the integration is not ready. The cheapest first proof is the product-version fixture and RPC client test.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260927-0329-archctx-0512-rpc-integration.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260927-0329-archctx-0512-rpc-integration.review.md`
- Notes file: `tasks/notes/20260927-0329-archctx-0512-rpc-integration.notes.md`
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
  - actions/review-action/action.yml
  - bun.lock
  - docs/examples/github-hosted-runner-workflow.yml
  - docs/examples/reusable-organization-runner-caller.yml
  - docs/researches/20260927-rpc-keepalive-hotfix-0512.md
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
  - plans/plan-20260927-0329-archctx-0512-rpc-integration.md
  - tasks/todos.md
  - tasks/contracts/20260927-0329-archctx-0512-rpc-integration.contract.md
  - tasks/reviews/20260927-0329-archctx-0512-rpc-integration.review.md
  - tasks/notes/20260927-0329-archctx-0512-rpc-integration.notes.md
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
    - packages/local-runtime/runtime-daemon/src/rpc-client.ts
    - docs/researches/20260927-rpc-keepalive-hotfix-0512.md
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
      "necessity": "All package and product-version anchors must typecheck together on the pinned Bun toolchain.",
      "inputs": { "env": [] }
    },
    {
      "id": "rpc-client",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun test packages/local-runtime/runtime-daemon/test/rpc-client.test.ts",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Confirms the merged keep-alive fix remains in the main-based candidate.",
      "inputs": { "env": [] }
    },
    {
      "id": "contracts-and-runner",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun test packages/contracts/test/contracts.test.ts packages/cloud/runner/test/runner.test.ts",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Validates package capability identity and the review-action/runtime-version template contract.",
      "inputs": { "env": [] }
    },
    {
      "id": "npm-release-dry-run",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun scripts/fg6-npm-release-dry-run.ts run --out _ops/npm/main-0512/evidence.json --artifact-dir _ops/npm/main-0512",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Produces and validates both 0.5.12 package artifacts from the current-main integration branch without publishing.",
      "inputs": { "env": [] }
    },
    {
      "id": "installed-tarball-smoke",
      "kind": "command",
      "command": "node scripts/local-product-tarball-smoke.mjs --artifact-dir _ops/npm/main-0512/smoke",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Exercises the installed Node-only CLI, daemon, upgrade, uninstall and retained state from source-built release bytes.",
      "inputs": { "env": [] }
    },
    {
      "id": "deterministic-gate-evidence",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun scripts/fg4-deterministic-conclusion-readback.ts inspect --evidence docs/verification/fg4-deterministic-conclusion-readback.json --json",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "The release version changes the no-provider model digest; inspect the regenerated deterministic gate evidence.",
      "inputs": { "env": [] }
    },
    {
      "id": "no-provider-release-evidence",
      "kind": "command",
      "command": "npm exec --yes --package bun@1.4.0 -- bun scripts/fg6-no-provider-deterministic-readback.ts inspect --evidence docs/verification/fg6-no-provider-deterministic-readback.json --json",
      "cwd": ".",
      "phase": "verification",
      "cost": "normal",
      "evidence_policy": "current_exact",
      "necessity": "Governance Verify consumes this aggregate release evidence and must see the current model digest.",
      "inputs": { "env": [] }
    }
  ]
}
```

## Acceptance Notes (Human Review)

- Functional behavior: source versions, installed CLI and package artifacts all identify as 0.5.12; no npm mutation.
- Edge cases: tag-based hotfix bytes differ from current-main bytes and must not be mixed.
- Regression risks: PR #223 overlaps runner templates/lockfile; recheck main before merge. Publication must rebuild from the exact merged source.

## Rollback Point

- Commit / checkpoint: `e3d8077` before 0.5.12 integration.
- Revert strategy: revert the version-metadata merge before any npm publication.
