# Task Contract: ownership-change-acceptance-recovery

> **Status**: Fulfilled
> **Plan**: plans/plan-20260901-1836-ownership-change-acceptance-recovery.md
> **Task Profile**: bugfix
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-09-02
> **Review File**: `tasks/reviews/20260901-1836-ownership-change-acceptance-recovery.review.md`
> **Notes File**: `tasks/notes/20260901-1836-ownership-change-acceptance-recovery.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

ArchContext durably records an accepted projection apply before refresh delivery, but its
reconcile path consumes that receipt by lookup identity without proving that the current
architecture state is still the exact state covered by the approval. repo-harness therefore
must either reject a now-stale candidate forever or risk terminalizing a later semantic state
under the old approval. This currently leaves strict architecture checks and downstream
AcceptanceReceipt issuance blocked after a committed `applied-reconcile-required` result.

## Goal

Add one typed semantic recovery protocol that inspects the committed apply receipt, proves the
current model/source/flow-proof/projection state and owned outputs equal the approved resulting
state, and only then atomically delivers the original refresh signals. Recovery must be
idempotent, must never replay the write or human approval, and must expose a proof that a
consumer can bind to its own candidate receipt.

## Scope

- In scope:
  - Strict identity-only recovery intent/proof contracts and JSON schemas.
  - Projection provenance fixed-point correction so projection-owned outputs cannot change the
    CodeGraph/projection proof that generated them, while real source/model/flow drift remains
    visible and fail-closed.
  - Cut the repository development/CI/readback toolchain authority over to `bun@1.4.0` and repair
    the owning SQLite migration lifecycle exposed by Bun 1.4.0 without retries, sleeps, or journal
    mode fallbacks.
  - Daemon-writer-owned non-consuming receipt inspection, fixed-point reconstruction, and
    proof-bound atomic delivery through local store, RPC client, and CLI projection protocol.
  - Current clean-fixed-point reconstruction and exact semantic/owned-output comparison.
  - Regression coverage for the real committed post-write race, semantic drift, corrupt or
    missing receipts, identity mismatches, raw-RPC direct-delivery and forged-proof bypasses,
    unavailable proof, repeat delivery, and no-write idempotency.
  - Release preparation for the unreleased `0.4.8` recovery capability: align all current
    source package identities, product-version projections, catalog/fixtures, generated
    release readback sources, action defaults, and rollout docs. The public contracts artifact
    must stage as unscoped `archctx-contracts` with `src`, `fixtures`, `schemas`, and schema
    exports; the scoped workspace manifest must not masquerade as that consumer artifact.
    Retain historical `0.4.7` evidence and fail-close public rollout before publication.
  - Product documentation and workflow artifacts needed to explain and verify the boundary.
- Out of scope:
  - repo-harness candidate storage, deletion of consumer runtime artifacts, v1 fallback, automatic reapply, receipt fabrication, package publication, registry mutation, or unrelated projection refactors.
- Taste constraints: <!-- advisory only, no run gate; default style/taste lives in AGENTS.md and the minimal-change policy, use this to record a per-task override -->

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

The design is wrong if current semantic equality cannot be proven before receipt consumption
without inventing a second receipt authority. The cheapest proof is a race fixture that commits
an accepted apply, mutates an architecture model input, and attempts recovery: it must reject
without consuming the receipt; after reverting exactly that mutation, the same receipt must
recover successfully once and return an idempotent already-delivered proof thereafter.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: `packages/surfaces/cli/src/main.ts:1268-1286` reconciles and consumes a committed projection receipt by lookup identity before rebuilding and comparing the current semantic fixed point to the approved resulting digests.
- repro: run the accepted-apply race fixture to obtain `applied-reconcile-required`, change one `.archcontext/model/nodes/*.yaml` semantic input, then retry the same accepted change with a current expected snapshot; v0.4.7 delivers the stored receipt instead of rejecting the changed semantic state.
- regression_guard: tests/ownership-change-acceptance-recovery.test.ts
- pre_fix_failure_artifact: docs/verification/20260901-ownership-change-acceptance-recovery-pre-fix.txt

## Workflow Inventory

- Source plan: `plans/plan-20260901-1836-ownership-change-acceptance-recovery.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260901-1836-ownership-change-acceptance-recovery.review.md`
- Notes file: `tasks/notes/20260901-1836-ownership-change-acceptance-recovery.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Acceptance Policy

```json
{"protocol":1,"reviewer":"Claude","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - .github/workflows/verify.yml
  - actions/review-action/action.yml
  - package.json
  - bun.lock
  - docs/examples/
  - docs/runbooks/
  - docs/spec.md
  - docs/verification/20260901-ownership-change-acceptance-recovery-pre-fix.txt
  - plans/
  - tasks/todos.md
  - tasks/contracts/20260901-1836-ownership-change-acceptance-recovery.contract.md
  - tasks/reviews/20260901-1836-ownership-change-acceptance-recovery.review.md
  - tasks/notes/20260901-1836-ownership-change-acceptance-recovery.notes.md
  - packages/contracts/
  - packages/core/package.json
  - packages/core/practice-catalog/
  - packages/core/projection-engine/
  - packages/local-runtime/package.json
  - packages/local-runtime/local-store-sqlite/
  - packages/local-runtime/runtime-daemon/
  - packages/surfaces/package.json
  - packages/surfaces/cli/
  - packages/cloud/package.json
  - schemas/runtime/
  - scripts/
  - tests/
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
      - codex-exec
      - main-thread
    fallback: main-thread
    brief_is_authoritative: true
```

## Exit Criteria (Machine Verifiable)

```yaml
exit_criteria:
  files_exist:
    - docs/spec.md
    - schemas/runtime/projection-apply-recovery.schema.json
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260901-1836-ownership-change-acceptance-recovery.notes.md
  tests_pass:
    - path: tests/ownership-change-acceptance-recovery.test.ts
  commands_succeed:
    - bun --version
    - bun run typecheck
    - bun test tests/ownership-change-acceptance-recovery.test.ts packages/contracts/test/contracts.test.ts --timeout 60000
    - bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts --test-name-pattern "projection apply" --timeout 60000
    - bun test packages/surfaces/cli/test/cli.test.ts --test-name-pattern "accepted projection apply|projection recovery" --timeout 60000
    - bun test packages/core/practice-catalog/test/practice-catalog.test.ts scripts/fg6-npm-release-dry-run.test.ts --timeout 60000
    - bun scripts/fg6-npm-release-dry-run.ts run --out /tmp/archctx-0.4.8-npm-release-dry-run.json --artifact-dir /tmp/archctx-0.4.8-artifacts --json
    - bun run e2e:local-product-tarball
    - bun test --timeout 60000
    - repo-harness run check-task-workflow --strict
    - repo-harness run check-task-sync
    - repo-harness run check-architecture-sync
    - git diff --check
```

## Acceptance Notes (Human Review)

- Functional behavior: a committed accepted apply can be recovered exactly once only after the
  current semantic fixed point is proven equal to the original approved result.
- Edge cases: missing/corrupt receipt, later model/source/proof/projection drift, changed
  approval/reasons/nodes, dirty owned output, unavailable CodeGraph proof, crash/retry, and
  already-delivered receipt.
- Regression risks: consuming before proof, weakening pre-write stale rejection, replaying a
  ChangeSet, changing existing receipt identity, or creating a second recovery authority.

## Rollback Point

- Commit / checkpoint: the single work-package commit before any package release.
- Revert strategy: revert recovery contracts, store/daemon plumbing, CLI proof, and tests as one
  unit; keep the v0.4.7 committed apply receipt schema and data untouched.
