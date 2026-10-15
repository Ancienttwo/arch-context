# Task Contract: complete remaining #328 D6 and post-write D7 guard

> **Status**: Active
> **Task Profile**: code-change
> **Plan**: plans/plan-20261015-0845-issue-328-public-failure-closure.md
> **Owner**: delegated Codex sole writer
> **Review File**: tasks/reviews/20261015-0845-issue-328-public-failure-closure.review.md
> **Notes File**: tasks/notes/20261015-0845-issue-328-public-failure-closure.notes.md

## Goal and Scope

Explicit latest coordinator authorization expands the prior finite recovery/floors package. Close all original ten partial C2 and six lifecycle symbols plus confirmed adjacent public projection/waiver exits. Preserve success identity, calling conventions and internal sequencing. D7 detects post-write external manifest conflict, preserves bytes/backup and reports manual recovery. Exact allowed paths follow; no arbitrary internal catch migration.

## Allowed Paths

```yaml
allowed_paths:
  - packages/contracts/src/failure.ts
  - packages/contracts/src/index.ts
  - packages/contracts/src/changeset-recovery.ts
  - packages/core/changeset-engine/src/index.ts
  - packages/local-runtime/local-store-sqlite/src/index.ts
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/local-runtime/runtime-daemon/src/changeset-recovery-error.ts
  - packages/local-runtime/runtime-daemon/src/public-operation-failure.ts
  - packages/local-runtime/runtime-daemon/src/changeset-authority.ts
  - packages/local-runtime/runtime-daemon/src/projection-service.ts
  - packages/local-runtime/runtime-daemon/src/projection-apply.ts
  - packages/local-runtime/runtime-daemon/src/recommendations.ts
  - packages/local-runtime/runtime-daemon/src/external-documentation.ts
  - packages/local-runtime/runtime-daemon/src/rpc-client.ts
  - packages/local-runtime/runtime-daemon/src/rpc-server.ts
  - packages/local-runtime/runtime-daemon/src/rpc-methods.ts
  - packages/contracts/test/failure-envelope.test.ts
  - packages/contracts/test/changeset-recovery.test.ts
  - packages/core/changeset-engine/test/projection-manifest-floors.test.ts
  - packages/local-runtime/local-store-sqlite/test/changeset-recovery.test.ts
  - packages/local-runtime/runtime-daemon/test/public-operation-failures.test.ts
  - packages/local-runtime/runtime-daemon/test/final-public-failures.test.ts
  - packages/local-runtime/runtime-daemon/test/rpc-v2-failure-compat.test.ts
  - packages/local-runtime/runtime-daemon/test/fixtures/runtime-rpc-v2-386d.ts
  - docs/spec.md
  - docs/runbooks/crash-recovery.md
  - plans/plan-20261015-0845-issue-328-public-failure-closure.md
  - tasks/contracts/20261015-0845-issue-328-public-failure-closure.contract.md
  - tasks/notes/20261015-0845-issue-328-public-failure-closure.notes.md
  - tasks/notes/20261015-0845-issue-328-public-failure-closure.scope.json
  - tasks/reviews/20261015-0845-issue-328-public-failure-closure.review.md
  - packages/local-runtime/runtime-daemon/src/committed-change-acceptance.ts
  - packages/local-runtime/runtime-daemon/test/accepted-committed-change.test.ts
  - packages/local-runtime/runtime-daemon/test/audit.test.ts
  - packages/local-runtime/runtime-daemon/test/ledger-admin.test.ts
  - packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
  - packages/local-runtime/runtime-daemon/test/rpc-methods.test.ts
  - packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts
  - packages/surfaces/cli/test/projection-protocol-lifecycle.test.ts
  - packages/local-runtime/runtime-daemon/test/git-visible-worktree-digest.test.ts
  - packages/local-runtime/runtime-daemon/src/developer-review-run.ts
  - packages/local-runtime/runtime-daemon/src/practice-checkpoint.ts
  - packages/local-runtime/runtime-daemon/test/developer-review-run.test.ts
```

## Verification Plan

```json
{"protocol":1,"checks":[{"id":"scoped-tests","command":"bun test --timeout 60000 packages/contracts/test/failure-envelope.test.ts packages/contracts/test/changeset-recovery.test.ts packages/core/changeset-engine/test/projection-manifest-floors.test.ts packages/local-runtime/runtime-daemon/test/final-public-failures.test.ts packages/local-runtime/runtime-daemon/test/rpc-v2-failure-compat.test.ts"},{"id":"type-boundary","command":"bun run typecheck && node scripts/package-boundary-audit.mjs"},{"id":"production-audit","command":"node scripts/production-mock-reachability-audit.mjs"},{"id":"packaged","command":"node scripts/packaged-cli-smoke.mjs"}]}
```

Broaden only to affected whole files when new edits justify it. Record exact command/results in notes/review. No full-root or hosted matrix restart. Rollback removes task delta only, never persistent actual runtime state.
