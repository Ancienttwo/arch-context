> **Archived**: 2026-09-10 20:36
> **Related Plan**: plans/archive/plan-20260910-2016-release-closeout-0-5-10.md
> **Outcome**: Completed
> **Lifecycle**: plan
> **Parent Run ID**: run-20260910-2036
> **Archive Projection V1**: `plans/plan-20260910-2016-release-closeout-0-5-10.md` => `plans/archive/plan-20260910-2016-release-closeout-0-5-10.md`
> **Archive Projection V1**: `tasks/notes/20260910-2016-release-closeout-0-5-10.notes.md` => `tasks/archive/notes-20260910-2036-release-closeout-0-5-10.md`
> **Archive Projection V1**: `tasks/contracts/20260910-2016-release-closeout-0-5-10.contract.md` => `tasks/archive/contract-20260910-2036-release-closeout-0-5-10.md`
> **Archive Projection V1**: `tasks/reviews/20260910-2016-release-closeout-0-5-10.review.md` => `tasks/archive/review-20260910-2036-release-closeout-0-5-10.md`

# Plan: Complete 0.5.10 release records and Windows fixture verification

> **Status**: Archived
> **Substantive Change SHA256**: `sha256:2ac16e1356998538dc05e20ba2e2686f326d6911c649cc0719b3ff02838458e1`
> **Created**: 20260910-2016
> **Slug**: release-closeout-0-5-10
> **Planning Source**: codex-plan
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: verification_boundary
> **Verification Boundary**: Exact-head Windows CI plus stable-identity sprint migration readback
> **Rollback Surface**: Revert bounded fixture and workflow delta without changing published package bytes
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/archive/contract-20260910-2036-release-closeout-0-5-10.md`
> **Task Review**: `tasks/archive/review-20260910-2036-release-closeout-0-5-10.md`
> **Implementation Notes**: `tasks/archive/notes-20260910-2036-release-closeout-0-5-10.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from codex-plan planning output.
- Source ref: (none)
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/archive/plan-20260910-2016-release-closeout-0-5-10.md`
- Sprint contract: `tasks/archive/contract-20260910-2036-release-closeout-0-5-10.md`
- Sprint review: `tasks/archive/review-20260910-2036-release-closeout-0-5-10.md`
- Implementation notes: `tasks/archive/notes-20260910-2036-release-closeout-0-5-10.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/archive/contract-20260910-2036-release-closeout-0-5-10.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/archive/plan-20260910-2016-release-closeout-0-5-10.md` and may start `repo-harness run contract-worktree start --plan plans/archive/plan-20260910-2016-release-closeout-0-5-10.md`.

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
- Contract file: `tasks/archive/contract-20260910-2036-release-closeout-0-5-10.md`
- Review file: `tasks/archive/review-20260910-2036-release-closeout-0-5-10.md`
- Implementation notes file: `tasks/archive/notes-20260910-2036-release-closeout-0-5-10.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/archive/contract-20260910-2036-release-closeout-0-5-10.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/archive/plan-20260910-2016-release-closeout-0-5-10.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Revert bounded fixture and workflow delta without changing published package bytes
- **Verification boundary**: Exact-head Windows CI plus stable-identity sprint migration readback
- **Review/acceptance boundary**: `tasks/archive/review-20260910-2036-release-closeout-0-5-10.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: verification_boundary

## Evidence Contract

- **State/progress path**: `plans/archive/plan-20260910-2016-release-closeout-0-5-10.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/archive/contract-20260910-2036-release-closeout-0-5-10.md`, `tasks/archive/review-20260910-2036-release-closeout-0-5-10.md`, and `tasks/archive/notes-20260910-2036-release-closeout-0-5-10.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/archive/review-20260910-2036-release-closeout-0-5-10.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Revert bounded fixture and workflow delta without changing published package bytes

## Captured Planning Output

## Goal

Complete the approved archctx 0.5.10 publication record by migrating the old sprint carrier and removing redundant lifecycle work from the two Windows CI timeout cases. The published 0.5.10 payload and production behavior remain unchanged.

## P1 / P2 / P3

The CLI fixture calls runTestCli five times per case, constructing and stopping an embedded daemon and SQLite store each time. The projection fixture creates two Git commits; the docs lockfile fixture creates an unused Git history. Required CI 34467186132 failed before projection runtime execution at git commit on Windows Node 24, and timed out in the docs case on Windows Node 25. Both cases pass in the opposite Windows lane. Reuse one explicitly injected daemon per case, retain the real YAML/lockfile and projection protocol paths, and keep the existing 15000 ms timeout. SQLite integration and daemon discovery remain covered by their existing dedicated cases. At ten times the fixture count, process and database startup costs dominate; removing unnecessary starts is the bounded fix.

The schema-1 sprint has seven completing leases whose canonical rows are already completed. Reconcile each against its exact claim and main, then use the official schema migrator bound to published dc4fcc3d9ee7e70f66654d934f50a55f30381cf2. Preserve row statuses, content, and derived identities. Unknown or live leases fail closed.

## Scope

Only the two CLI tests, the old sprint and generated migration receipt, the publication evidence, and workflow artifacts. No production source, package version, timeout policy, shared runtime installation, or unrelated archived acceptance changes.

## Task Breakdown

- [x] Reconcile the completed leases and migrate the sprint with stable identities.
- [x] Reduce the two CLI fixtures to one daemon each; projection uses one Git commit and docs requires no Git history.
- [ ] Run the two named tests, typecheck, strict workflow and repository closeout checks. Preserve all behavior assertions and record before/after evidence.
- [ ] Freeze the diff, prepare acceptance, and require the new PR head's complete Required CI, including Windows, before merging the publication record.

## Verification

Local before-fix baseline: 2 pass, 26 assertions, 2.02 seconds; Windows failures are the actual pre-fix timing oracle. Local tests establish semantic coverage, while exact-head Required CI establishes the affected OS result. No new local full suite: published source has passing final CI and governance baseline; this delta changes two test fixtures and workflow documentation only.

## Rollback

Revert this bounded test and workflow commit. Schema migration has its original-byte digest and stable task IDs in the canonical receipt; do not restore already completed leases.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] Reconcile the completed leases and migrate the sprint with stable identities.
- [x] Reduce the two CLI fixtures to one daemon each; projection uses one Git commit and docs requires no Git history.
- [ ] Run the two named tests, typecheck, strict workflow and repository closeout checks. Preserve all behavior assertions and record before/after evidence.
- [ ] Freeze the diff, prepare acceptance, and require the new PR head's complete Required CI, including Windows, before merging the publication record.
