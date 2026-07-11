# Task Contract: ar4-integrated-product-readback

> **Status**: Fulfilled
> **Plan**: plans/plan-20260712-0411-ar4-integrated-product-readback.md
> **Task Profile**: code-change
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-07-12 04:11
> **Review File**: `tasks/reviews/20260712-0411-ar4-integrated-product-readback.review.md`
> **Notes File**: `tasks/notes/20260712-0411-ar4-integrated-product-readback.notes.md`

## Goal

Close AR0-AR4 with real visible-browser/design acceptance, maximum-budget and privacy
evidence, package/full verification, ADR readback, capability-registry repair, and a
clean merge/workflow lifecycle without changing architecture authority.

## Why

AR0-AR3 are individually correct, but the program is not finished until the real local
product, packaging, security/privacy, design hierarchy, 10x stop, and repository
workflow closeout are verified together.

## Falsifier

Stop if acceptance needs compatibility code, a database migration, cache rewrite,
remote service, token bypass, new authority source, or destructive cleanup of user
state. Product code changes require an explicit contract widening with a reproducible
acceptance defect.

## Scope

- In scope:
  - visible local browser screenshots and interaction/freshness/expiry acceptance;
  - required seven-pass plan-design review and terminal review report;
  - performance/privacy/package/focused/full verification and architecture/security review;
  - ADR-0044 accepted-boundary update and supported capability-registry repair;
  - durable AR4 readback and workflow/worktree/marker cleanup proof.
- Out of scope:
  - AR0-AR3 refactors without a verified ship blocker;
  - ADR-0045/data-engine authority, database/cache migrations, compatibility paths;
  - remote/deployed acceptance or mutation/editing features;
  - user untracked `.ai/harness/delegation/subagent-stop-quality.json`.

## Workflow Inventory

- Source plan: `plans/plan-20260712-0411-ar4-integrated-product-readback.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260712-0411-ar4-integrated-product-readback.review.md`
- Notes file: `tasks/notes/20260712-0411-ar4-integrated-product-readback.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: `scripts/verify-sprint.sh` must see this contract pass, the review recommend pass, and `## External Acceptance Advice` pass or record a manual override.

## Allowed Paths

```yaml
allowed_paths:
  - plans/plan-20260712-0411-ar4-integrated-product-readback.md
  - plans/plan-20260712-0225-authority-aware-architecture-reading-completion.md
  - tasks/contracts/20260712-0411-ar4-integrated-product-readback.contract.md
  - tasks/reviews/20260712-0411-ar4-integrated-product-readback.review.md
  - tasks/notes/20260712-0411-ar4-integrated-product-readback.notes.md
  - .ai/context/capabilities.json
  - packages/local-runtime/explorer-html/src/index.ts
  - packages/local-runtime/explorer-html/test/runtime-script.test.ts
  - packages/local-runtime/runtime-daemon/src/explorer-projection.ts
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts
  - packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
  - packages/surfaces/explorer-ui/test/explorer-ui.test.ts
  - docs/adr/ADR-0044-authority-aware-explorer-view-compiler.md
  - docs/verification/ar4-product-readback.json
  - docs/verification/ar4-product-readback.md
```

## Delegation Contract

```yaml
delegation:
  budget:
    tokens: null
    tool_calls: null
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
```

## Exit Criteria (Machine Verifiable)

```yaml
exit_criteria:
  files_exist:
    - docs/verification/ar4-product-readback.json
    - docs/verification/ar4-product-readback.md
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260712-0411-ar4-integrated-product-readback.notes.md
    - tasks/reviews/20260712-0411-ar4-integrated-product-readback.review.md
  tests_pass: []
  commands_succeed:
    - bun test packages/contracts/test/contracts.test.ts packages/local-runtime/explorer-html/test/topology.test.ts packages/local-runtime/explorer-html/test/runtime-script.test.ts packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts packages/local-runtime/runtime-daemon/test/local-runtime.test.ts packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts packages/surfaces/cli/test/cli.test.ts packages/surfaces/explorer-ui/test/explorer-ui.test.ts
    - bun run typecheck
    - bun run verify:explorer
    - node scripts/privacy-route-audit.mjs
    - bun run scripts/packaged-cli-smoke.mjs
    - repo-harness run capability-resolver -- validate --format json
    - node -e "const r=require('./docs/verification/ar4-product-readback.json'); if(r.verification.fullVerify.verdict!=='PASS'||r.verification.fullVerify.failed!==0) process.exit(1)"
  qa_scores: []
  manual_checks: []
```

## Acceptance Notes (Human Review)

- Functional behavior: real browser five-view reading/navigation/transient/freshness
  surface plus package/full-system acceptance.
- Edge cases: empty, truncated, narrow, no-JS structure, SSE qualification,
  disconnect, expiry, public maximum, capability orphan, workflow cleanup.
- Regression risks: local test acceptance masking browser/design defects; stale ADR;
  privacy/egress regression; governance marker/orphan preventing clean finish.
- Full `bun run verify` remains a required phase command and was run directly. The
  contract helper validates its durable PASS record instead of rerunning it inside the
  helper's 120-second aggregate timeout; the strict Sprint still checks this contract.

## Rollback Point

- Commit / checkpoint: branch base `a874a89`; user untracked checksum
  `10fc961f78b6a26a16b9fa9d1fea368d4b4493e7d825add46495df0b760e14ea`.
- Revert strategy: revert AR4 ADR/registry/evidence changes only; never mutate cache,
  Git authority, ledger state, or AR0-AR3 acceptance commits.
