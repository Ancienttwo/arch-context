# Plan: Projection Adoption Accepted Change Fixed Point

> **Status**: Executing
> **Created**: 20260904-2113
> **Slug**: projection-adoption-accepted-change-fixed-point
> **Planning Source**: user-approved-plan
> **Orchestration Kind**: repo-harness-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: risk_boundary
> **Verification Boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260904-2113-projection-adoption-accepted-change-fixed-point.contract.md --strict`.
> **Rollback Surface**: Before execution remove `plans/plan-20260904-2113-projection-adoption-accepted-change-fixed-point.md`; after execution revert branch `codex/projection-adoption-accepted-change-fixed-point` or the explicitly reviewed diff.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260904-2113-projection-adoption-accepted-change-fixed-point.contract.md`
> **Task Review**: `tasks/reviews/20260904-2113-projection-adoption-accepted-change-fixed-point.review.md`
> **Implementation Notes**: `tasks/notes/20260904-2113-projection-adoption-accepted-change-fixed-point.notes.md`

## Agentic Routing
- Selected route: bugfix
- Routing reason: Captured from user-approved-plan planning output.
- Source ref: (none)
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260904-2113-projection-adoption-accepted-change-fixed-point.md`
- Sprint contract: `tasks/contracts/20260904-2113-projection-adoption-accepted-change-fixed-point.contract.md`
- Sprint review: `tasks/reviews/20260904-2113-projection-adoption-accepted-change-fixed-point.review.md`
- Implementation notes: `tasks/notes/20260904-2113-projection-adoption-accepted-change-fixed-point.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260904-2113-projection-adoption-accepted-change-fixed-point.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260904-2113-projection-adoption-accepted-change-fixed-point.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260904-2113-projection-adoption-accepted-change-fixed-point.md`.

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
- Contract file: `tasks/contracts/20260904-2113-projection-adoption-accepted-change-fixed-point.contract.md`
- Review file: `tasks/reviews/20260904-2113-projection-adoption-accepted-change-fixed-point.review.md`
- Implementation notes file: `tasks/notes/20260904-2113-projection-adoption-accepted-change-fixed-point.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260904-2113-projection-adoption-accepted-change-fixed-point.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260904-2113-projection-adoption-accepted-change-fixed-point.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Before execution remove `plans/plan-20260904-2113-projection-adoption-accepted-change-fixed-point.md`; after execution revert branch `codex/projection-adoption-accepted-change-fixed-point` or the explicitly reviewed diff.
- **Verification boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260904-2113-projection-adoption-accepted-change-fixed-point.contract.md --strict`.
- **Review/acceptance boundary**: `tasks/reviews/20260904-2113-projection-adoption-accepted-change-fixed-point.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: risk_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260904-2113-projection-adoption-accepted-change-fixed-point.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260904-2113-projection-adoption-accepted-change-fixed-point.contract.md`, `tasks/reviews/20260904-2113-projection-adoption-accepted-change-fixed-point.review.md`, and `tasks/notes/20260904-2113-projection-adoption-accepted-change-fixed-point.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260904-2113-projection-adoption-accepted-change-fixed-point.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Before execution remove `plans/plan-20260904-2113-projection-adoption-accepted-change-fixed-point.md`; after execution revert branch `codex/projection-adoption-accepted-change-fixed-point` or the explicitly reviewed diff.

## Captured Planning Output

# Projection adoption accepted-change fixed-point

## Goal
Allow an explicit architecture adoption plan and an exact accepted semantic change to compose in one provider transaction, then prove the post-adoption projection reaches a no-accepted-change fixed point.

## Root cause hypothesis
runArchitectureDocsAdoptionCommand rebuilds already-adopted simulated files while carrying acceptedChange again. The major-change classifier correctly rejects that second consumption as accepted-reference-without-semantic-delta. Without acceptedChange, the same fixed-point check still sees the unresolved semantic delta and returns projection-adoption-fixed-point-unproven.

## Scope
- Add a pre-fix regression test covering adoption-required ownership plus node-added semantic acceptance.
- Change only the provider-owned adoption fixed-point calculation and result projection required to consume acceptedChange exactly once.
- Preserve exact adoptionPlanId, expectedWorktreeDigest, affected nodes, reason codes, daemon transaction, and fail-closed stale/mismatch behavior.
- Prepare and publish archctx 0.5.5 only after the focused and release checks pass.

## Non-scope
- No manual rendered-doc fallback.
- No repo-harness-side semantic inference or compatibility path.
- No relaxation of adoption or accepted-change validation.

## Verification
- Regression test fails on 0.5.4 source and passes after the fix.
- CLI/provider focused tests pass.
- Package/release checks pass.
- npm readback proves 0.5.5, then repo-harness pins the exact published version and re-runs its blocked adoption flow.

## Rollback
Revert the provider fix/release commits and keep repo-harness on 0.5.4 until a corrected release exists.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] Prove the accepted-change double-consumption root cause and bind a regression guard.
- [ ] Make protocol adoption commit a no-accepted-change fixed point with a durable apply receipt.
- [ ] Verify the focused CLI path and full release surface.
- [ ] Publish 0.5.5 and record registry readback evidence.
