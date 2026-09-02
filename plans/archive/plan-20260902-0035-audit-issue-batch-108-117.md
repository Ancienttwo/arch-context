# Plan: Audit issue batch fix #108-#117

> **Status**: Archived
> **Created**: 20260902-0035
> **Slug**: audit-issue-batch-108-117
> **Planning Source**: repo-harness-plan
> **Orchestration Kind**: host-plan
> **Source Ref**: github:Ancienttwo/arch-context#108-#117
> **Artifact Level**: work-package
> **Promotion Reason**: Ten filed P1/P2 audit issues (#108-#117) require implementation edits across daemon, sqlite store, context compiler, and CLI; edit_plan_gate=enforce blocks all implementation edits without an approved active plan
> **Verification Boundary**: bun test per touched package + typecheck
> **Rollback Surface**: one commit per issue on isolated worktree branches
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260902-0035-audit-issue-batch-108-117.contract.md`
> **Task Review**: `tasks/reviews/20260902-0035-audit-issue-batch-108-117.review.md`
> **Implementation Notes**: `tasks/notes/20260902-0035-audit-issue-batch-108-117.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from repo-harness-plan planning output.
- Source ref: github:Ancienttwo/arch-context#108-#117
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260902-0035-audit-issue-batch-108-117.md`
- Sprint contract: `tasks/contracts/20260902-0035-audit-issue-batch-108-117.contract.md`
- Sprint review: `tasks/reviews/20260902-0035-audit-issue-batch-108-117.review.md`
- Implementation notes: `tasks/notes/20260902-0035-audit-issue-batch-108-117.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260902-0035-audit-issue-batch-108-117.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260902-0035-audit-issue-batch-108-117.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260902-0035-audit-issue-batch-108-117.md`.

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
- Contract file: `tasks/contracts/20260902-0035-audit-issue-batch-108-117.contract.md`
- Review file: `tasks/reviews/20260902-0035-audit-issue-batch-108-117.review.md`
- Implementation notes file: `tasks/notes/20260902-0035-audit-issue-batch-108-117.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260902-0035-audit-issue-batch-108-117.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260902-0035-audit-issue-batch-108-117.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: one commit per issue on isolated worktree branches
- **Verification boundary**: bun test per touched package + typecheck
- **Review/acceptance boundary**: `tasks/reviews/20260902-0035-audit-issue-batch-108-117.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: Ten filed P1/P2 audit issues (#108-#117) require implementation edits across daemon, sqlite store, context compiler, and CLI; edit_plan_gate=enforce blocks all implementation edits without an approved active plan

## Evidence Contract

- **State/progress path**: `plans/plan-20260902-0035-audit-issue-batch-108-117.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260902-0035-audit-issue-batch-108-117.contract.md`, `tasks/reviews/20260902-0035-audit-issue-batch-108-117.review.md`, and `tasks/notes/20260902-0035-audit-issue-batch-108-117.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260902-0035-audit-issue-batch-108-117.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: one commit per issue on isolated worktree branches

## Captured Planning Output

# Audit Issue Batch Fix: GitHub #108-#117

## Goal

Fix the ten audit findings filed as GitHub issues #108-#117 on Ancienttwo/arch-context (audit baseline main@f78a7e0). All fixes are fail-closed hardening or contract-accuracy corrections; no compatibility fallbacks.

## Scope / Implementation Surface

- packages/local-runtime/runtime-daemon/src/** (developer-review path containment #108, RPC server body limits and deadlines #114, RuntimeRpcClient timeouts #115, remote hostname rejection #110, removedPaths projection #112, context7 lock symlink-safe write #111, job handler scoping #109, repo remove durability #113)
- packages/local-runtime/runtime-daemon/src/github-issue-executor.ts (secret preflight matcher #117)
- packages/local-runtime/local-store-sqlite/src/** (job scope enforcement #109, repository_sessions deletion #113)
- packages/core/context-compiler/src/** and packages/core/application/src/** (final-payload byteLength #116)
- packages/surfaces/cli/src/** and packages/surfaces/mcp-local/src/** (client call-site updates only)
- Matching test files under each package's test/ directory

## Task Breakdown

- [ ] Group A: #108 + #114 + #115 daemon RPC lifecycle hardening
- [ ] Group B: #109 + #113 repository/worktree scope and repo remove durability
- [ ] Group C: #110 + #117 audit publisher remote validation and secret preflight precision
- [ ] Group D: #111 + #112 + #116 projection write safety, removedPaths, context byteLength

## Verification Boundary

bun test for each touched package (local-store-sqlite, runtime-daemon, context-compiler, cli, mcp-local) plus repo typecheck; TDD red-green per issue.

## Rollback Surface

Each issue lands as one conventional commit on an isolated worktree branch; rollback is dropping the branch or reverting the single commit. No schema-destructive migrations; no .archcontext/ model edits; no SQLite file edits.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [ ] Group A: #108 + #114 + #115 daemon RPC lifecycle hardening
- [ ] Group B: #109 + #113 repository/worktree scope and repo remove durability
- [ ] Group C: #110 + #117 audit publisher remote validation and secret preflight precision
- [ ] Group D: #111 + #112 + #116 projection write safety, removedPaths, context byteLength
