# Plan: Declare prior committed applies on projection results

> **Status**: Executing
> **Created**: 20260909-2250
> **Slug**: projection-prior-committed-applies
> **Planning Source**: codex-plan-or-waza-think
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: verification_boundary
> **Verification Boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260909-2250-projection-prior-committed-applies.contract.md --strict`.
> **Rollback Surface**: Before execution remove `plans/plan-20260909-2250-projection-prior-committed-applies.md`; after execution revert branch `codex/projection-prior-committed-applies` or the explicitly reviewed diff.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260909-2250-projection-prior-committed-applies.contract.md`
> **Task Review**: `tasks/reviews/20260909-2250-projection-prior-committed-applies.review.md`
> **Implementation Notes**: `tasks/notes/20260909-2250-projection-prior-committed-applies.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from codex-plan-or-waza-think planning output.
- Source ref: (none)
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260909-2250-projection-prior-committed-applies.md`
- Sprint contract: `tasks/contracts/20260909-2250-projection-prior-committed-applies.contract.md`
- Sprint review: `tasks/reviews/20260909-2250-projection-prior-committed-applies.review.md`
- Implementation notes: `tasks/notes/20260909-2250-projection-prior-committed-applies.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260909-2250-projection-prior-committed-applies.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260909-2250-projection-prior-committed-applies.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260909-2250-projection-prior-committed-applies.md`.

## Approach
### Strategy
Use the captured planning output below as the execution source of truth.

### Trade-offs
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Captured plan | Preserves the approved Codex Plan or Waza think decision | Requires the captured text to be concrete enough to execute | Use |

## Detailed Design
### File Changes
| File | Action | Description |
|------|--------|-------------|
| See captured planning output | Follow | Implement only the approved scope named below |

### Code Snippets
See captured planning output.

### Data Flow
See captured planning output.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Captured plan lacks enough detail | Medium | Execution may need clarification | Stop before implementation if the captured output contradicts repo rules or lacks concrete file targets |

## Task Contracts
- Contract file: `tasks/contracts/20260909-2250-projection-prior-committed-applies.contract.md`
- Review file: `tasks/reviews/20260909-2250-projection-prior-committed-applies.review.md`
- Implementation notes file: `tasks/notes/20260909-2250-projection-prior-committed-applies.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260909-2250-projection-prior-committed-applies.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260909-2250-projection-prior-committed-applies.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Before execution remove `plans/plan-20260909-2250-projection-prior-committed-applies.md`; after execution revert branch `codex/projection-prior-committed-applies` or the explicitly reviewed diff.
- **Verification boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260909-2250-projection-prior-committed-applies.contract.md --strict`.
- **Review/acceptance boundary**: `tasks/reviews/20260909-2250-projection-prior-committed-applies.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: verification_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260909-2250-projection-prior-committed-applies.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260909-2250-projection-prior-committed-applies.contract.md`, `tasks/reviews/20260909-2250-projection-prior-committed-applies.review.md`, and `tasks/notes/20260909-2250-projection-prior-committed-applies.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260909-2250-projection-prior-committed-applies.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Before execution remove `plans/plan-20260909-2250-projection-prior-committed-applies.md`; after execution revert branch `codex/projection-prior-committed-applies` or the explicitly reviewed diff.

## Captured Planning Output

## Goal

Give a `projection run` caller a contract surface to learn that a prior attempt under the
same `requestId` already committed projection-owned writes, so a caller whose CLI attempt was
killed by its own timeout can distinguish "nothing happened" from "the daemon already wrote".

## Problem

`archctx projection run` is a short-lived RPC client; `planUpdate`/`applyUpdate` execute inside
the resident `archctxd`. When the caller's timeout kills the CLI after the daemon has committed
the ChangeSet, the journal records the commit under `reason.taskSessionId = request.requestId`
while the caller never receives the envelope. The retry with the same `requestId` observes the
fixed point already reached and returns `status: noop, files: []`. `projection recover` cannot
help because it needs the `applyId`/`lookupKey` the killed attempt never returned.

## Decision 1 — additive optional field on `archcontext.projection-result/v2`, no v3

`priorCommittedApplies?: ProjectionPriorCommittedApplyV1[]` is added to `ProjectionResultV2`
without bumping the protocol version.

Evidence for additive-safety in the only known consumer (repo-harness):

- `src/core/architecture/projection.ts:329 assertProjectionResult` decodes field by field and
  never rejects unknown properties.
- `src/core/architecture/projection.ts:236 projectionResultReceiptDigest` digests the whole
  received body (`digestProjectionJson({ ...input, refreshSignals })`) using
  `src/core/evidence/canonical-json.ts canonicalize`, which sorts object keys recursively.
  An un-upgraded consumer therefore recomputes the identical digest over the body it received,
  including the new field, and `receiptDigest mismatch` cannot fire because of it.
- `src/effects/architecture/archctx-provider.ts:499 assertProjectionResultAuthority` constrains
  `result.files` paths and `result.applyReceipt` only.

The field is included in `projectionResultReceiptDigest` for free because that function digests
the full result payload minus `receiptDigest`.

## Decision 2 — omit when empty

The field is omitted (not `[]`) when no prior committed apply exists. Reasons: every existing
result stays byte-identical, so no stored receipt digest shifts; and the codebase already uses
`...(applyReceipt ? { applyReceipt } : {})` for the same optionality shape. Consumers detect
support through the capabilities handshake, not through field presence.

## Decision 3 — `applyId`/`lookupKey` are optional, both-or-neither

`applyProjectionProtocolFixedPoint` creates a `ProjectionApplyIdentityV1` only when the request
carries an `acceptedChange`. A plain drift-repair apply commits a ChangeSet with no apply
receipt, which is the majority path and exactly the path the reported incident took. Requiring
`applyId`/`lookupKey` would fail-close that path out of the feature entirely. They are therefore
optional, present together whenever the committed journal row has a `projection_apply_receipts`
row, and an invariant rejects one-without-the-other.

## Decision 4 — snapshot the journal before this run mutates anything

The lookup runs once at the top of `runProjectionProtocolCommand`, before adoption or apply.
Anything committed under this `requestId` at that point is by construction a prior attempt, so
"exclude the ChangeSet produced by this very run" needs no changeSetId comparison. That matters
because the protocol changeSetId is derived from the projection digest and is not unique across
attempts.

## Decision 5 — record the committed body hash in the ChangeSet journal

`ChangeSetJournalFile` has `path`, `existed` and `operation` but no body hash, and
`changeSetMetadata` drops `projectionFiles`. `applyFileOperation` is the only place that holds
the body at journal-record time, so it gains `bodyHash`: `digestJson({ body })` for a write and
`"missing"` for `delete_entity`. That is the digest archctx already uses for bodies
(`assertExpectedHash`, `currentBodyHash`), so the value is directly comparable with a projection
result's `files[].outputDigest` preimage convention. A committed journal row that matches the
requestId but predates this field fails the run closed with a named error rather than silently
reporting an incomplete file list.

## Task Breakdown

- [ ] Contract: `ProjectionPriorCommittedApplyV1`, optional result field, invariants, capabilities feature `projection-prior-committed-applies-v1`, JSON schema and fixture updates
- [ ] Engine: `ChangeSetJournalFile.bodyHash` recorded by `applyFileOperation`
- [ ] Store: `listCommittedChangeSetsForTaskSession` over `changeset_journal` joined to `projection_apply_receipts`, fail-closed parsing
- [ ] Daemon: `listProjectionPriorCommittedApplies` RPC method, client method, dispatch case
- [ ] CLI: snapshot lookup at the top of `runProjectionProtocolCommand`, thread through every `ProjectionResultV2` construction path, fail closed on lookup failure
- [ ] Tests: store unit test, CLI same-requestId/different-requestId integration test, capabilities feature test

## Verification

- `bun test packages/contracts/test/contracts.test.ts`
- `bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts`
- `bun test tests/projection-prior-committed-applies.test.ts`
- `bun test packages/surfaces/cli/test/cli.test.ts`
- `bun run typecheck`

## Out of scope

Sticky provenance, digest ignore sets, snapshot fences, `acquireDaemonLock`, receipt admission
rules, package version bumps, publishing.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [ ] Contract: `ProjectionPriorCommittedApplyV1`, optional result field, invariants, capabilities feature `projection-prior-committed-applies-v1`, JSON schema and fixture updates
- [ ] Engine: `ChangeSetJournalFile.bodyHash` recorded by `applyFileOperation`
- [ ] Store: `listCommittedChangeSetsForTaskSession` over `changeset_journal` joined to `projection_apply_receipts`, fail-closed parsing
- [ ] Daemon: `listProjectionPriorCommittedApplies` RPC method, client method, dispatch case
- [ ] CLI: snapshot lookup at the top of `runProjectionProtocolCommand`, thread through every `ProjectionResultV2` construction path, fail closed on lookup failure
- [ ] Tests: store unit test, CLI same-requestId/different-requestId integration test, capabilities feature test
