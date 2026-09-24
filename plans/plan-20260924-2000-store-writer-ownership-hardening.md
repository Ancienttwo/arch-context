# Plan: Harden store writer ownership for PR #176

> **Status**: Approved
> **Created**: 20260924-2000
> **Slug**: store-writer-ownership-hardening
> **Planning Source**: codex-plan-or-waza-think
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: human_decision_boundary
> **Verification Boundary**: store+daemon tests, CLI concurrent cold-start test, stress scripts
> **Rollback Surface**: revert PR #176 branch commits; unreleased lock format
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260924-2000-store-writer-ownership-hardening.contract.md`
> **Task Review**: `tasks/reviews/20260924-2000-store-writer-ownership-hardening.review.md`
> **Implementation Notes**: `tasks/notes/20260924-2000-store-writer-ownership-hardening.notes.md`

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

- Active plan: `plans/plan-20260924-2000-store-writer-ownership-hardening.md`
- Sprint contract: `tasks/contracts/20260924-2000-store-writer-ownership-hardening.contract.md`
- Sprint review: `tasks/reviews/20260924-2000-store-writer-ownership-hardening.review.md`
- Implementation notes: `tasks/notes/20260924-2000-store-writer-ownership-hardening.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260924-2000-store-writer-ownership-hardening.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260924-2000-store-writer-ownership-hardening.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260924-2000-store-writer-ownership-hardening.md`.

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
- Contract file: `tasks/contracts/20260924-2000-store-writer-ownership-hardening.contract.md`
- Review file: `tasks/reviews/20260924-2000-store-writer-ownership-hardening.review.md`
- Implementation notes file: `tasks/notes/20260924-2000-store-writer-ownership-hardening.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260924-2000-store-writer-ownership-hardening.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260924-2000-store-writer-ownership-hardening.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: revert PR #176 branch commits; unreleased lock format
- **Verification boundary**: store+daemon tests, CLI concurrent cold-start test, stress scripts
- **Review/acceptance boundary**: `tasks/reviews/20260924-2000-store-writer-ownership-hardening.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: human_decision_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260924-2000-store-writer-ownership-hardening.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260924-2000-store-writer-ownership-hardening.contract.md`, `tasks/reviews/20260924-2000-store-writer-ownership-hardening.review.md`, and `tasks/notes/20260924-2000-store-writer-ownership-hardening.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260924-2000-store-writer-ownership-hardening.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: revert PR #176 branch commits; unreleased lock format

## Captured Planning Output

# Harden store writer ownership for PR #176 (#160, #172)

## Context

PR #176 claims store writer ownership before ChangeSet recovery (#160) and gates writes on unresolved journals (#172). The acceptance gate failed it on head 29114d3:

1. Concurrent cold starts regress: losing daemons exit with `local-store-writer-owned` before the winner is ready, and `waitForDaemonReady` stops on child exit (reproduced 10/80 failures; 0 on main).
2. Stale-lock takeover is check-then-delete, so two starters can both own the store after the previous owner dies (reproduced 4/12 trials).
3. `docs pin --approved` writes `.archcontext/integrations/context7.lock.yaml` outside `withWriter`, bypassing the #172 gate.
4. `ArchctxRuntimeRpcServer.start()`, `ArchctxDaemon.stop()` and `SqliteLocalStore.close()` can leak ownership on failure paths.

## Decision

- Replace the pid-file lock authority with an OS-released lock: `<store>.owner.lock` is a SQLite database held in `BEGIN EXCLUSIVE` with `busy_timeout = 0` for the owner's lifetime. Verified on bun:sqlite (bun 1.4.2) and node:sqlite (node 25.9.0): cross-process and same-process second acquirers fail fast; SIGKILL releases the lock. A separate `<store>.owner.json` (pid, acquiredAt, token) is diagnostics only. Bounded jittered retry (≤ ~100ms) covers the SHARED→EXCLUSIVE step between two starters racing for a free lock.
- The foreground daemon exits with a dedicated code when another live owner holds the store; `waitForDaemonReady` keeps polling `runningDaemonInfo` until the start deadline on that code.
- Wrap the approved `docs pin` branch in `withWriter`.
- Release ownership in `finally` in `stop()`/`close()`; `RpcServer.start()` stops a daemon it started when a later step fails.
- Optional: surface `changeSetRecovery` in `/health` and `doctor`.

## Verification

- New tests: ≥2 concurrent CLI cold starts all succeed; N starters against a dead owner → exactly one owner; SIGKILLed owner → next starter acquires; #172 test asserts `docs pin --approved` is refused while gated.
- `bun test --timeout 60000 packages/local-runtime/local-store-sqlite packages/local-runtime/runtime-daemon`, `bun run typecheck`, touched CLI tests.
- Stress scripts before/after: parallel cold start and stale takeover counts.

## Rollback

Revert the PR branch commits; the lock format is unreleased, so no migration is needed.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [ ] Execute captured plan: Harden store writer ownership for PR #176
