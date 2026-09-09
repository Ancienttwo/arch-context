# Task Review: projection-prior-committed-applies

> **Status**: Pending
> **Plan**: plans/plan-20260909-2250-projection-prior-committed-applies.md
> **Contract**: tasks/contracts/20260909-2250-projection-prior-committed-applies.contract.md
> **Notes File**: tasks/notes/20260909-2250-projection-prior-committed-applies.notes.md
> **Checks File**: .ai/harness/checks/latest.json
> **Last Updated**: 2026-09-09 23:30
> **Recommendation**: pass
> **Review Rubric Version**: 2
> **Reviewed Subject SHA256**: sha256:07277b9b0c357d93446a5bab77b993405838543bce9465d648a02c161924011a
> **Reviewed Subject Scope**: substantive-change-diff
> **Reviewed Target Revision**: 7ab6a994b506cad9b5a135777bf742724516c3c4
> **Substantive Change SHA256**: `sha256:07277b9b0c357d93446a5bab77b993405838543bce9465d648a02c161924011a`

The subject digest above is the substantive-change digest emitted by
`REPO_HARNESS_DIFF_BASE=origin/main REPO_HARNESS_DIFF_MODE=merge-base repo-harness run check-task-sync`
for this branch's substantive diff against `origin/main`; the substantive paths have been frozen
since `7ab6a99`, which is the target revision recorded above. The scope is labelled for what it is rather than as
`normalized-final-content`, because no acceptance run has produced that digest for this
subject; see the Acceptance Receipt Projection below.

## Human Review Card

- Verdict: pending external acceptance
- Change type: code-change
- Intended files changed: projection result contract and its JSON schema plus capabilities fixture, ChangeSet journal body hash, SQLite journal lookup, daemon RPC method, CLI projection-run threading, focused tests
- Actual files changed: `packages/contracts/src/projection.ts`, `packages/contracts/test/contracts.test.ts`, `packages/contracts/fixtures/valid/archctx-capabilities.json`, `schemas/runtime/projection-result.schema.json`, `schemas/runtime/archctx-capabilities.schema.json`, `packages/core/changeset-engine/src/index.ts`, `packages/local-runtime/local-store-sqlite/src/index.ts`, `packages/local-runtime/local-store-sqlite/test/factories.ts`, `packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts`, `packages/local-runtime/runtime-daemon/src/index.ts`, `packages/surfaces/cli/src/main.ts`, `packages/surfaces/cli/test/cli.test.ts`, `tests/projection-prior-committed-applies.test.ts`
- Commands passed: `bun run typecheck`; `bun test --timeout 60000` (1771 pass / 0 fail / 170 files); `repo-harness run verify-contract` (total=10 failed=0 status=Fulfilled); `bun run check:package-boundaries`; `bun run check:architecture-sync`; `bun run check:context-files`; `bun run check:sprint`; `bun run check:production-mock-reachability`; `bun run verify:architecture-mermaid`
- Residual risks: a committed journal row written before `bodyHash` existed fails the lookup closed with `changeset-journal-file-body-hash-missing`, so an operator upgrading mid-incident sees an error rather than a partial answer; `applyId`/`lookupKey` are absent on the drift-repair path, so `projection recover` remains unavailable for exactly the incident shape that motivated this change
- Reviewer action required: inspect diff and card
- Rollback: revert the branch merge; the result field is additive and optional, and consumers that ignore it recompute the same receipt digest

## Mode Evidence

- Selected route: work-package plan captured with `repo-harness run capture-plan --artifact-level work-package --status Approved --execute --promotion-reason verification_boundary`, executed in the isolated worktree `codex/projection-prior-committed-applies`
- P1/P2/P3 evidence: plan sections "Problem" (writer call chain from CLI RPC client through `archctxd` `withWriter` to the journal), "Decision 1" (consumer decoder and receipt-digest evidence at `repo-harness src/core/architecture/projection.ts:236,329`), "Decision 5" (why the body hash has no other durable source)
- Root cause or plan evidence: `docs/researches/20260909-projection-manifest-late-writer.md` §9 in the repo-harness repository — journal committed at 09:29:58.858Z with the manifest in `manifestFiles`, while the same job's receipt is a 09:31:19.504Z attempt-2 `noop` with `files: []`

## Verification Evidence

- Waza `/check` run: not run; verification went through the contract's own Verification Plan
- Commands run: see Human Review Card "Commands passed"; contract checks executed through `repo-harness run verify-contract --read-only`
- Manual checks: the duplicate-changeSetId regression was proved load-bearing by temporarily keying the daemon map on `journalId`, which reproduced `AC_SCHEMA_INVALID: priorCommittedApplies.changeSetId must be sorted and unique` before the fix was restored
- Supporting artifacts: `tests/projection-prior-committed-applies.test.ts` (end-to-end, including the raw RPC hop and the duplicate journal row), `packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts` (lookup scoping, duplicate rows, fail-closed parsing, closed operation vocabulary)
- Implementation notes reviewed: `tasks/notes/20260909-2250-projection-prior-committed-applies.notes.md`
- Run snapshot: none recorded; `.ai/harness/checks/latest.json` is empty because no Stop-gate check pipeline ran in this worktree

## Manual Check Evidence

The contract declares no `manual_checks` requirements.

## Acceptance Receipt Projection

> **Disposition**: unavailable
> **Reviewer**: unavailable
> **Source**: unavailable
> **Actor**: not-applicable
> **Reviewed Subject SHA256**: pending
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: pending
> **Verification Evidence SHA256**: pending
> **Issued At**: pending

- Summary: No AcceptanceReceipt has been recorded. Acceptance and the ship decision stay with the reviewing gate; this branch was deliberately not run through `verify-sprint --prepare-acceptance` or `contract-worktree finish`.
- Findings: none

## Behavior Diff Notes

- `archcontext.projection-result/v2` gains an optional `priorCommittedApplies` array. It is omitted, never empty, so every result that has nothing to report is byte-identical to before and no stored receipt digest shifts.
- The field is inside `projectionResultReceiptDigest`, so a prior-apply claim cannot be edited without breaking the digest.
- `archctx capabilities --json` advertises `projection-prior-committed-applies-v1`; consumers gate on the handshake, not on field presence.
- `ChangeSetJournalFile` gains `bodyHash`, so every new committed journal row records the digest of the bytes it wrote.
- `projection run` now performs one journal lookup before it can mutate anything, and fails the run closed when that lookup is unreadable.

## Residual Risks / Follow-ups

- The repo-harness consumer side is not wired: its retry path still reads `noop, files: []` as "nothing happened". Closing that loop needs `assertProjectionResult` to decode the field and `archctx-provider` to require the `projection-prior-committed-applies-v1` feature.
- `bun run check:task-workflow --strict` is red on a pre-existing sprint-schema migration for `plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md`, which this branch does not touch and which is not part of the CI `verify` gate.

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functionality | 8/10 | End-to-end behavior proved, including the duplicate-changeSetId state that would otherwise fail every later run permanently; the recovery identity is still unavailable on the drift-repair path |
| Product depth | 7/10 | Closes the observability gap on the archctx side only; the consumer that suffers the gap is a separate work package |
| Design quality | 8/10 | Additive optional field justified against the real consumer decoder, single lookup taken before any mutation, one canonicalization authority for the root |
| Code quality | 8/10 | Fail-closed parsing with named errors, closed operation vocabulary, regression proved load-bearing by reverting the fix |

## Failing Items

- None. `repo-harness run verify-contract` reports `total=10 failed=0 status=Fulfilled`.

## Retest Steps

- Re-run: `bun run typecheck && repo-harness run verify-contract --contract tasks/contracts/20260909-2250-projection-prior-committed-applies.contract.md --read-only`
- Re-check: `REPO_HARNESS_DIFF_BASE=origin/main REPO_HARNESS_DIFF_MODE=merge-base repo-harness run check-task-sync`

## Summary

A `projection run` attempt killed by its caller's timeout after `archctxd` committed leaves no
trace the caller can read: the retry sees the fixed point reached and returns `noop` with an empty
file list. The projection result now carries an optional `priorCommittedApplies` array naming the
ChangeSets already committed under the same `requestId`, with the files each one wrote, sourced
from the ChangeSet journal and bound into the receipt digest. The protocol version is unchanged
because the known consumer neither rejects unknown properties nor digests a subset of the body.
