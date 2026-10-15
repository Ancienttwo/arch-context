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
  - deploy/release-checklists/archctx-0.8.0.md
  - packages/surfaces/cli/src/main.ts
  - packages/surfaces/mcp-local/src/index.ts
  - packages/local-runtime/runtime-daemon/src/ledger-admin.ts
  - packages/local-runtime/runtime-daemon/test/rpc-version.test.ts
  - packages/local-runtime/runtime-daemon/test/rpc-argument-codec.test.ts
  - packages/local-runtime/runtime-daemon/test/refactor-scan.test.ts
  - packages/local-runtime/runtime-daemon/test/complete-architecture-debt.test.ts
  - packages/surfaces/mcp-local/test/mcp-local.test.ts
  - packages/surfaces/cli/test/projection-capability-isolation.test.ts
  - packages/surfaces/cli/test/cli.test.ts
  - packages/surfaces/cli/test/failure-envelope.test.ts
  - packages/core/changeset-engine/test/changeset-engine.test.ts
  - packages/core/changeset-engine/test/manifest-update.test.ts
  - packages/core/changeset-engine/test/adr-reference-update.test.ts
  - packages/core/changeset-engine/test/refactor-decision-write.test.ts
```

## Verification Plan

```json
{"protocol":1,"checks":[{"id":"scoped-tests","command":"bun test --timeout 60000 packages/contracts/test/failure-envelope.test.ts packages/contracts/test/changeset-recovery.test.ts packages/core/changeset-engine/test/projection-manifest-floors.test.ts packages/local-runtime/runtime-daemon/test/final-public-failures.test.ts packages/local-runtime/runtime-daemon/test/rpc-v2-failure-compat.test.ts"},{"id":"type-boundary","command":"bun run typecheck && node scripts/package-boundary-audit.mjs"},{"id":"production-audit","command":"node scripts/production-mock-reachability-audit.mjs"},{"id":"packaged","command":"node scripts/packaged-cli-smoke.mjs"}]}
```

Broaden only to affected whole files when new edits justify it. Record exact command/results in notes/review. No full-root or hosted matrix restart. Rollback removes task delta only, never persistent actual runtime state.

Coordinator follow-through: accepted main be19d8ec is tree-identical to original C1 baseline 1fd88cf6; merge alignment preserves tested product bytes. Create one final PR now. Record planned 0.8.0 compatibility and existing release gates only; do not bump/publish/upload/tag in this task.

PR360 follow-up authorization: pause release-prep, reproduce and fix the in-process pending-journal gate under the existing writer. Cover status, J1→J2 refusal and restart preservation in local-runtime.test.ts; do not automatically recover active journals. No push, CI cancellation, dispatch, or rerun from this worktree while parent reviews are active.

Parent additionally authorizes exact CI151 classification/migration, CLI and MCP typed failure preservation, explicit stale-preimage producer typing and ledger invalid-base-model refusal. Preserve every permission/no-write/throw-vs-return assertion. Run complete affected files and the full test suite after fixes. Do not change the disproved D6 await suspects or redesign filesystem concurrency; external-byte protection remains observed-byte checks under cooperative single-writer assumptions.

Latest coordinator authorization supersedes the temporary push hold: original CI38714639113 is terminal failure. After product/contract fixes and affected whole-file verification, commit and ordinary push on the existing PR360 branch without further approval. Preserve all failed attempts, classify unchanged-budget execution failures separately, and do not repeat the whole root indefinitely or raise budgets. A single added CLI assertion message exposes an otherwise opaque refusal; it changes no predicate. Complete remaining existing post/readback checks individually without relabeling the failed overall governance command as green. No additional scope; release-prep and CodeGraph candidate stay queued.


Coordinator publication update: after the local hold above, the coordinator explicitly requests completing the necessary post checks and promptly delivering the exact HEAD for remote verification. All post checks and23 inspect commands are now complete and green; final typecheck passes. Proceed with ordinary same-branch push under that latest instruction, retaining the full/CLI failed attempts and unresolved intermittent W1 in the handoff and PR validation. This supersedes the earlier temporary publication hold; it does not claim local overall-governance success, classify the intermittent cause, or authorize merge/CI cancellation/manual rerun. Product inputs remain unchanged from805eed21.
