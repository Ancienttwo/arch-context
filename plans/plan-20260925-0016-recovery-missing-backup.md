# Plan: Fail ChangeSet recovery when an existing file's backup is missing (#179)

> **Status**: Approved
> **Created**: 20260925-0016
> **Slug**: recovery-missing-backup
> **Planning Source**: codex-plan-or-waza-think
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: human_decision_boundary
> **Verification Boundary**: store-level recovery tests, typecheck
> **Rollback Surface**: revert commit
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260925-0016-recovery-missing-backup.contract.md`
> **Task Review**: `tasks/reviews/20260925-0016-recovery-missing-backup.review.md`
> **Implementation Notes**: `tasks/notes/20260925-0016-recovery-missing-backup.notes.md`

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

- Active plan: `plans/plan-20260925-0016-recovery-missing-backup.md`
- Sprint contract: `tasks/contracts/20260925-0016-recovery-missing-backup.contract.md`
- Sprint review: `tasks/reviews/20260925-0016-recovery-missing-backup.review.md`
- Implementation notes: `tasks/notes/20260925-0016-recovery-missing-backup.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260925-0016-recovery-missing-backup.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260925-0016-recovery-missing-backup.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260925-0016-recovery-missing-backup.md`.

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
- Contract file: `tasks/contracts/20260925-0016-recovery-missing-backup.contract.md`
- Review file: `tasks/reviews/20260925-0016-recovery-missing-backup.review.md`
- Implementation notes file: `tasks/notes/20260925-0016-recovery-missing-backup.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260925-0016-recovery-missing-backup.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260925-0016-recovery-missing-backup.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: revert commit
- **Verification boundary**: store-level recovery tests, typecheck
- **Review/acceptance boundary**: `tasks/reviews/20260925-0016-recovery-missing-backup.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: human_decision_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260925-0016-recovery-missing-backup.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260925-0016-recovery-missing-backup.contract.md`, `tasks/reviews/20260925-0016-recovery-missing-backup.review.md`, and `tasks/notes/20260925-0016-recovery-missing-backup.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260925-0016-recovery-missing-backup.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: revert commit

## Captured Planning Output

# Fail ChangeSet recovery when an existing file's backup is missing (#179)

## Context
`recoverJournalFiles()` (local-store-sqlite) skips an `existed: true` entry whose backup is missing, and `recoverPendingChangeSets()` still marks the journal `recovered`. If both the backup and the destination are gone, the original content is lost and nothing reports it.

## Decision
- `existed: true`, backup missing, destination present: the crash happened before the rename to backup. Keep the current recovery.
- `existed: true`, both backup and destination missing: throw a descriptive error. The journal stays `pending` with `recoveryError`, and the #172 gate then refuses writes and reports it in `status().changeSetRecovery`.

## Verification
Store-level tests cover both cases, reusing the pending-journal recovery fixture. Also run `bun run typecheck` and `bun test --timeout 60000 packages/local-runtime/local-store-sqlite packages/local-runtime/runtime-daemon`.

## Rollback
Revert the commit. Recovery goes back to silently marking such journals recovered.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [ ] Execute captured plan: Fail ChangeSet recovery when an existing file's backup is missing (#179)
