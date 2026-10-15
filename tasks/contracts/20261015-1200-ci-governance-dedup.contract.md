# Task Contract: Governance CI deduplication

> **Status**: Active
> **Task Profile**: code-change
> **Plan**: plans/plan-20261015-1200-ci-governance-dedup.md
> **Owner**: delegated Codex sole writer
> **Review File**: tasks/reviews/20261015-1200-ci-governance-dedup.review.md
> **Notes File**: tasks/notes/20261015-1200-ci-governance-dedup.notes.md

## Goal and Scope

Implement only the coordinator/user-approved independent Governance CI adjustment. The closed path allowlist is tasks/notes/20261015-1200-ci-governance-dedup.scope.json. Preserve product worktrees and existing worker/inspection semantics; no CI cancellation, dispatch, retry or budget/skip relaxation. Dedicated Linux full stays20min; Governance stays15min. Publication is an ordinary new branch and Draft PR, not an immediate main merge. Root alone writes all files; one small independent worker provides read-only review.

## Allowed Paths

```yaml
allowed_paths:
  - docs/architecture/.projection-manifest.json
  - docs/verification/architecture-ledger-al9-doc-projections-readback.json
  - .github/workflows/verify.yml
  - scripts/verify-ci.mjs
  - scripts/verify-governance.mjs
  - scripts/governance-verify-workflow.test.ts
  - scripts/verify-sharding-workflow.test.ts
  - plans/plan-20261015-1200-ci-governance-dedup.md
  - tasks/contracts/20261015-1200-ci-governance-dedup.contract.md
  - tasks/notes/20261015-1200-ci-governance-dedup.notes.md
  - tasks/reviews/20261015-1200-ci-governance-dedup.review.md
  - tasks/notes/20261015-1200-ci-governance-dedup.scope.json
```

## Verification Plan

```json
{"protocol":1,"checks":[{"id":"ci-workflow-tests","command":"bun test --timeout 60000 scripts/governance-verify-workflow.test.ts scripts/verify-sharding-workflow.test.ts"},{"id":"types","command":"bun run typecheck"},{"id":"syntax","command":"node --check scripts/verify-ci.mjs && node --check scripts/verify-governance.mjs"}]}
```

## Change Assessment

The change affects orchestration only: no product API/runtime, ledger data, dependency or version change. Failure propagation and current-provider binding require negative tests; all existing23 inspection entries, FG6-EG2 condition, nine-target coverage and permissions must be preserved.

## Later explicit authorization: accepted main integration

After #362 provider43of43success and exact-head independentLGTM, the coordinator directed root to Ready+squash362, keep358open, then ordinary merge accepted main into361, reverify and ordinary push. This authorizes upstream dependency/contracts/fixture changes through that merge despite the original CI-only change scope. It does not authorize a new dependency decision, product code changes, sharding takeover, runtime/flag/budget/exit relaxation or release. Refresh any necessary generated stamp only through supported docs apply and current AL9 record/readback; preserve the5original CI source hashes. Hosted evidence on the new exact head remains necessary.
