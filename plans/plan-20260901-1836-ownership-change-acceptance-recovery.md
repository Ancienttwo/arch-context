# Plan: Ownership Change Acceptance Recovery

> **Status**: Ready for review
> **Created**: 20260901-1836
> **Slug**: ownership-change-acceptance-recovery
> **Planning Source**: repo-harness-plan
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: human_decision_boundary
> **Verification Boundary**: Semantic recovery proof, exact mismatch matrix, real apply race, and idempotent delivery
> **Rollback Surface**: Revert recovery protocol and implementation as one unit while retaining the v0.4.7 apply receipt
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260901-1836-ownership-change-acceptance-recovery.contract.md`
> **Task Review**: `tasks/reviews/20260901-1836-ownership-change-acceptance-recovery.review.md`
> **Implementation Notes**: `tasks/notes/20260901-1836-ownership-change-acceptance-recovery.notes.md`
> **Release Preparation**: unreleased `archctx@0.4.8` and `archctx-contracts@0.4.8` source identities; public npm rollout remains fail-closed until a separate publication decision.

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from repo-harness-plan planning output.
- Source ref: (none)
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260901-1836-ownership-change-acceptance-recovery.md`
- Sprint contract: `tasks/contracts/20260901-1836-ownership-change-acceptance-recovery.contract.md`
- Sprint review: `tasks/reviews/20260901-1836-ownership-change-acceptance-recovery.review.md`
- Implementation notes: `tasks/notes/20260901-1836-ownership-change-acceptance-recovery.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260901-1836-ownership-change-acceptance-recovery.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260901-1836-ownership-change-acceptance-recovery.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260901-1836-ownership-change-acceptance-recovery.md`.

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
- Contract file: `tasks/contracts/20260901-1836-ownership-change-acceptance-recovery.contract.md`
- Review file: `tasks/reviews/20260901-1836-ownership-change-acceptance-recovery.review.md`
- Implementation notes file: `tasks/notes/20260901-1836-ownership-change-acceptance-recovery.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260901-1836-ownership-change-acceptance-recovery.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260901-1836-ownership-change-acceptance-recovery.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Revert recovery protocol and implementation as one unit while retaining the v0.4.7 apply receipt
- **Verification boundary**: Semantic recovery proof, exact mismatch matrix, real apply race, and idempotent delivery
- **Review/acceptance boundary**: `tasks/reviews/20260901-1836-ownership-change-acceptance-recovery.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: human_decision_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260901-1836-ownership-change-acceptance-recovery.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260901-1836-ownership-change-acceptance-recovery.contract.md`, `tasks/reviews/20260901-1836-ownership-change-acceptance-recovery.review.md`, and `tasks/notes/20260901-1836-ownership-change-acceptance-recovery.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260901-1836-ownership-change-acceptance-recovery.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Revert recovery protocol and implementation as one unit while retaining the v0.4.7 apply receipt

## Captured Planning Output

# Ownership-change acceptance recovery

> **Task Profile**: bugfix

## Goal

Add one typed, semantic-proof-bound recovery path for an accepted ArchContext projection apply that committed durably but returned `applied-reconcile-required`. Recovery must prove the current architecture state is the exact approved resulting state before delivering the stored refresh signals, and must remain idempotent without replaying the write or the human approval.

## P1: Architecture Map

- ArchContext contract authority: `packages/contracts/src/projection.ts` and `schemas/runtime/` define the projection request/result, committed apply receipt, identity-only recovery intent, and daemon-produced proof.
- Durable receipt authority: `packages/local-runtime/local-store-sqlite/src/index.ts` owns committed receipt storage and exactly-once refresh delivery state.
- Runtime orchestration: `packages/local-runtime/runtime-daemon/src/index.ts` owns receipt inspection/consumption through local and RPC clients.
- Provider surface: `packages/surfaces/cli/src/main.ts` owns projection protocol commands and intent parsing; `packages/local-runtime/runtime-daemon/src/index.ts` owns current fixed-point reconstruction, semantic proof validation, and atomic delivery.
- Consumer candidate terminalization remains out of scope for this package and stays owned by repo-harness.

## P2: Concrete Trace

1. A normal accepted `projection run` writes projection-owned files through one ChangeSet and persists `ProjectionApplyReceiptV1` at the commit boundary.
2. A concurrent non-owned mutation can make the post-apply check return `applied-reconcile-required`; refresh signals remain unconsumed.
3. A recovery intent supplies only receipt lookup identity and apply identity.
4. The daemon writer reads the committed receipt without consuming it, rebuilds the current projection without reapplying the accepted change, and proves a clean fixed point from repository authority.
5. Recovery compares current model/source/flow-proof/projection digests, reason codes, affected nodes, renderer/layout, stored receipt identity, owned file outputs, and CodeGraph readiness to the approved result.
6. Only after every binding passes does the durable store atomically mark the original refresh delivery consumed and return a typed recovery proof plus the original signals.
7. A repeated recovery returns the same proof with `already-delivered`, performs no write, and cannot extend or replace the original human approval.

## P3: Decision

- ArchContext owns the semantic recovery proof because repo-harness cannot safely re-derive ArchContext model/projection semantics.
- Add a distinct recovery surface; do not make ordinary `projection run apply` silently accept stale candidates.
- Keep `ProjectionApplyReceiptV1` as the single committed apply authority. The recovery proof references it; it is not a second receipt or compatibility fallback.
- Preserve the core invariant: later semantic drift, changed affected nodes/reasons, unavailable CodeGraph proof, dirty projection output, or missing/corrupt receipt fails before refresh consumption.
- At 10x scale, repeated full projection reconstruction is the first cost; protocol 1 deliberately chooses exact proof over a cache until measured demand justifies content-addressed reuse.

## Scope

- In scope: recovery intent/proof contracts and schemas; daemon-writer-owned non-consuming receipt inspection and fixed-point reconstruction; proof-bound atomic consumption; local/RPC/CLI plumbing; exact regression matrix; docs/spec and workflow artifacts; unreleased `0.4.8` product/package identity and local release-prep proof, including the unscoped public `archctx-contracts` staging artifact rather than the scoped source workspace manifest.
- Out of scope: repo-harness candidate storage, deletion of consumer runtime artifacts, v1 fallback, automatic reapply, receipt fabrication, package publication, registry mutation, or unrelated projection refactors.

## Failure Contract

Fail closed without consuming refresh delivery when any of the following changes: committed receipt identity, approval event, accepted change, expected resulting digests, reason codes, affected nodes, renderer/layout, CodeGraph readiness, current model/source/flow-proof/projection digest, owned output bytes, or clean fixed-point status.

## Task Breakdown

- [x] Capture a failing regression for committed `applied-reconcile-required` recovery after the original signal snapshot becomes stale.
- [x] Add strict recovery request/proof contracts and JSON schemas without accepting legacy or alternate shapes.
- [x] Add non-consuming receipt inspection plus proof-bound atomic delivery in the store/daemon/RPC path.
- [x] Add the distinct CLI recovery surface and current semantic fixed-point verifier.
- [x] Cover missing/corrupt receipt, semantic drift, reason/node mismatch, CodeGraph unavailable, dirty projection, repeat delivery, and real non-owned race cases.
- [x] Run focused package tests, typecheck, repository workflow checks, and exact-subject review.
- [x] Align the unreleased `0.4.8` product/package identity, generated catalog/fixtures/readback
  sources, current rollout documentation, and unscoped `archctx-contracts` public staging;
  retain historical `0.4.7` evidence and do not publish.

## Acceptance Criteria

- The original race reproduces `applied-reconcile-required` with a durable receipt and no delivered signals.
- Recovery succeeds only when current semantic state equals the original approved resulting state and projection outputs are a clean fixed point.
- Success returns a typed proof binding lookup/apply/receipt IDs, approval, resulting digests, current proof digest, and delivery status.
- Repeated recovery is byte-stable except for the explicit delivered/already-delivered state and never rewrites projection files.
- Every mismatch fails before consumption; the same receipt remains recoverable after the blocking mismatch is removed.
- Existing direct apply/reconcile behavior and pre-write stale rejection remain green.

## Verification

- `bun run typecheck`
- focused contracts, local-store, runtime-daemon, and CLI projection recovery tests
- existing accepted-apply race/no-race/pre-write-stale regression tests
- `bun install --frozen-lockfile`, generated `npm pack` plus `npm pack --dry-run`, and local
  generated-tarball installation smoke
- repository task/workflow and architecture checks

## Promotion Gate

- Merge/PR unit: recovery contracts, durable-store transition, CLI proof, and tests form one protocol boundary.
- Rollback surface: revert the recovery protocol and implementation as one unit; the existing v0.4.7 apply receipt remains readable and unchanged.
- Verification boundary: exact mismatch matrix plus the real accepted apply race and idempotent delivery.
- Review boundary: security-sensitive approval/receipt terminalization requires one independent gatekeeper review.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [ ] Capture a failing regression for committed `applied-reconcile-required` recovery after the original signal snapshot becomes stale.
- [ ] Add strict recovery request/proof contracts and JSON schemas without accepting legacy or alternate shapes.
- [ ] Add non-consuming receipt inspection plus proof-bound atomic delivery in the store/daemon/RPC path.
- [ ] Add the distinct CLI recovery surface and current semantic fixed-point verifier.
- [ ] Cover missing/corrupt receipt, semantic drift, reason/node mismatch, CodeGraph unavailable, dirty projection, repeat delivery, and real non-owned race cases.
- [ ] Unify repository, CI, generated workflow/readback, and product-version authority on `bun@1.4.0`; fix the SQLite migration lifecycle exposed by Bun 1.4.0 at the owning connection boundary with no retry/sleep fallback.
- [ ] Run focused package tests, typecheck, repository workflow checks, and exact-subject review.
