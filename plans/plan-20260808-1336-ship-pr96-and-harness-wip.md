# Plan: Ship PR #96 and repo-harness 0.13.2 WIP

> **Status**: Done
> **Created**: 20260808-1336
> **Slug**: ship-pr96-and-harness-wip
> **Planning Source**: codex-plan
> **Orchestration Kind**: host-plan
> **Source Ref**: user:A-2026-08-08
> **Artifact Level**: work-package
> **Promotion Reason**: human_decision_boundary
> **Verification Boundary**: PR CI green, strict harness gates pass, bun run verify passes, and final main matches origin/main
> **Rollback Surface**: Unpublished harness branch may be rebased or abandoned; merged PRs require explicit revert commits
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260808-1336-ship-pr96-and-harness-wip.contract.md`
> **Task Review**: `tasks/reviews/20260808-1336-ship-pr96-and-harness-wip.review.md`
> **Implementation Notes**: `tasks/notes/20260808-1336-ship-pr96-and-harness-wip.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from codex-plan planning output.
- Source ref: user:A-2026-08-08
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260808-1336-ship-pr96-and-harness-wip.md`
- Sprint contract: `tasks/contracts/20260808-1336-ship-pr96-and-harness-wip.contract.md`
- Sprint review: `tasks/reviews/20260808-1336-ship-pr96-and-harness-wip.review.md`
- Implementation notes: `tasks/notes/20260808-1336-ship-pr96-and-harness-wip.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260808-1336-ship-pr96-and-harness-wip.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260808-1336-ship-pr96-and-harness-wip.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260808-1336-ship-pr96-and-harness-wip.md`.

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
| `.ai/harness/*`, `.ai/hooks/*`, `.claude/templates/*`, `docs/reference-configs/*`, `package.json` | Refresh | Apply the audited repo-harness 0.13.2 generated assets |
| `.gitignore` | Merge | Keep the generated ignore block and the PR #96 repo-local `.archcontext/` authority override |
| plan/contract/notes/review/todos artifacts | Record | Keep the strict workflow package self-contained and auditable |

### Code Snippets
See captured planning output.

### Data Flow
`repo-harness init` projects the installed 0.13.2 assets into this repository;
the managed `.gitignore` block ignores runtime state, then the repo-local block
re-includes `.archcontext/**` and ignores only `.archcontext/.local/`. Strict
workflow checks and `bun run verify` validate the resulting tracked tree before
PR CI and merge provide the remote acceptance boundary.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Captured plan lacks enough detail | Medium | Execution may need clarification | Stop before implementation if the captured output contradicts repo rules or lacks concrete file targets |

## Task Contracts
- Contract file: `tasks/contracts/20260808-1336-ship-pr96-and-harness-wip.contract.md`
- Review file: `tasks/reviews/20260808-1336-ship-pr96-and-harness-wip.review.md`
- Implementation notes file: `tasks/notes/20260808-1336-ship-pr96-and-harness-wip.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260808-1336-ship-pr96-and-harness-wip.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260808-1336-ship-pr96-and-harness-wip.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Unpublished harness branch may be rebased or abandoned; merged PRs require explicit revert commits
- **Verification boundary**: PR CI green, strict harness gates pass, bun run verify passes, and final main matches origin/main
- **Review/acceptance boundary**: `tasks/reviews/20260808-1336-ship-pr96-and-harness-wip.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: human_decision_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260808-1336-ship-pr96-and-harness-wip.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260808-1336-ship-pr96-and-harness-wip.contract.md`, `tasks/reviews/20260808-1336-ship-pr96-and-harness-wip.review.md`, and `tasks/notes/20260808-1336-ship-pr96-and-harness-wip.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260808-1336-ship-pr96-and-harness-wip.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Unpublished harness branch may be rebased or abandoned; merged PRs require explicit revert commits

## Captured Planning Output

# Plan: Ship PR #96 and repo-harness 0.13.2 WIP

## Goal
Land PR #96, then publish the existing repo-harness 0.13.2 refresh as a separate reviewable PR without losing the .archcontext Git-authority override.

## Task Breakdown
- [x] Audit and commit the local 25-file repo-harness refresh on an isolated branch.
- [x] Verify PR #96 CI and merge it into main.
- [x] Rebase the harness refresh onto merged main and resolve only the .gitignore authority overlap.
- [x] Run strict workflow checks and full bun run verify on the combined tree.
- [x] Push, open, verify, and merge the harness refresh PR.
- [x] Clean safe branches/worktrees and read back final main.

## Invariants
- .archcontext remains Git-visible; only .archcontext/.local remains runtime state.
- Generated repo-harness files match repo-harness 0.13.2 and init dry-run remains plannedTotal 0.
- No unrelated WIP or ledger runtime state is edited.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] Audit and commit the local 25-file repo-harness refresh on an isolated branch.
- [x] Verify PR #96 CI and merge it into main.
- [x] Rebase the harness refresh onto merged main and resolve only the .gitignore authority overlap.
- [x] Run strict workflow checks and full bun run verify on the combined tree.
- [x] Push, open, verify, and merge the harness refresh PR.
- [x] Clean safe branches/worktrees and read back final main.
