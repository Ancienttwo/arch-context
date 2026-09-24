# Plan: Make audit run/approve handle --help without side effects (#182)

> **Status**: Approved
> **Created**: 20260925-0016
> **Slug**: audit-help-side-effects
> **Planning Source**: codex-plan-or-waza-think
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: human_decision_boundary
> **Verification Boundary**: CLI audit tests, typecheck
> **Rollback Surface**: revert commit
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260925-0016-audit-help-side-effects.contract.md`
> **Task Review**: `tasks/reviews/20260925-0016-audit-help-side-effects.review.md`
> **Implementation Notes**: `tasks/notes/20260925-0016-audit-help-side-effects.notes.md`

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

- Active plan: `plans/plan-20260925-0016-audit-help-side-effects.md`
- Sprint contract: `tasks/contracts/20260925-0016-audit-help-side-effects.contract.md`
- Sprint review: `tasks/reviews/20260925-0016-audit-help-side-effects.review.md`
- Implementation notes: `tasks/notes/20260925-0016-audit-help-side-effects.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260925-0016-audit-help-side-effects.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260925-0016-audit-help-side-effects.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260925-0016-audit-help-side-effects.md`.

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
- Contract file: `tasks/contracts/20260925-0016-audit-help-side-effects.contract.md`
- Review file: `tasks/reviews/20260925-0016-audit-help-side-effects.review.md`
- Implementation notes file: `tasks/notes/20260925-0016-audit-help-side-effects.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260925-0016-audit-help-side-effects.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260925-0016-audit-help-side-effects.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: revert commit
- **Verification boundary**: CLI audit tests, typecheck
- **Review/acceptance boundary**: `tasks/reviews/20260925-0016-audit-help-side-effects.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: human_decision_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260925-0016-audit-help-side-effects.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260925-0016-audit-help-side-effects.contract.md`, `tasks/reviews/20260925-0016-audit-help-side-effects.review.md`, and `tasks/notes/20260925-0016-audit-help-side-effects.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260925-0016-audit-help-side-effects.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: revert commit

## Captured Planning Output

# Make audit run/approve handle --help without side effects (#182)

## Context
`runAuditCommand` (packages/surfaces/cli/src/main.ts) ignores `--help`/`-h` and unknown flags. As a result, `audit run --help` starts a real audit that sends repo content to the model provider, and `audit approve <id> --help` proceeds with publishing. This is the same class of bug as #149 and the `audit consent --help` fix in #181.

## Decision
- `--help`/`-h` on any audit subcommand prints usage and never calls the daemon.
- `run` and `approve` reject unknown flags with `AC_SCHEMA_INVALID`.
- Read-only subcommands (`list`, `show`) keep their current parsing unless they share the same helper.

## Verification
CLI tests check that `audit run --help`, `audit approve <id> --help` and `audit --help` never call the daemon, and that an unknown flag on `run`/`approve` is rejected. Also run `bun run typecheck` and the CLI tests matching `audit`.

## Rollback
Revert the commit.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [ ] Execute captured plan: Make audit run/approve handle --help without side effects (#182)
