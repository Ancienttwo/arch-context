# Plan: Self-architecture ownership and enforced layer boundaries (#163)

> **Status**: Executing
> **Created**: 20260925-0115
> **Slug**: self-architecture-boundaries
> **Planning Source**: codex-plan-or-waza-think
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: human_decision_boundary
> **Verification Boundary**: validate, docs drift, refactor scan, bun run verify, per-PR targeted tests
> **Rollback Surface**: git revert per PR; drop failOn category via ChangeSet
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260925-0115-self-architecture-boundaries.contract.md`
> **Task Review**: `tasks/reviews/20260925-0115-self-architecture-boundaries.review.md`
> **Implementation Notes**: `tasks/notes/20260925-0115-self-architecture-boundaries.notes.md`

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

- Active plan: `plans/plan-20260925-0115-self-architecture-boundaries.md`
- Sprint contract: `tasks/contracts/20260925-0115-self-architecture-boundaries.contract.md`
- Sprint review: `tasks/reviews/20260925-0115-self-architecture-boundaries.review.md`
- Implementation notes: `tasks/notes/20260925-0115-self-architecture-boundaries.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260925-0115-self-architecture-boundaries.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260925-0115-self-architecture-boundaries.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260925-0115-self-architecture-boundaries.md`.

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
- Contract file: `tasks/contracts/20260925-0115-self-architecture-boundaries.contract.md`
- Review file: `tasks/reviews/20260925-0115-self-architecture-boundaries.review.md`
- Implementation notes file: `tasks/notes/20260925-0115-self-architecture-boundaries.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260925-0115-self-architecture-boundaries.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260925-0115-self-architecture-boundaries.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: git revert per PR; drop failOn category via ChangeSet
- **Verification boundary**: validate, docs drift, refactor scan, bun run verify, per-PR targeted tests
- **Review/acceptance boundary**: `tasks/reviews/20260925-0115-self-architecture-boundaries.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: human_decision_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260925-0115-self-architecture-boundaries.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260925-0115-self-architecture-boundaries.contract.md`, `tasks/reviews/20260925-0115-self-architecture-boundaries.review.md`, and `tasks/notes/20260925-0115-self-architecture-boundaries.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260925-0115-self-architecture-boundaries.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: git revert per PR; drop failOn category via ChangeSet

## Captured Planning Output

# Self-architecture ownership and enforced layer boundaries (#163)

## Context
The repo-harness recommendation `unowned-paths` (high confidence, medium risk) and issue #163 (scope corrected in its comment: observed dependency ≠ approved dependency).

Measured on main f3201a2:
- 1244 of 1325 tracked files have no owner. Every non-test file under `packages/**/src/**` is already owned; the unowned ones are docs, tasks, plans, scripts, tests and fixtures.
- `forbid-dependency` constraints can be declared, but nothing evaluates them. A deliberately added core → local-runtime import was caught only by `scripts/package-boundary-audit.mjs`.
- Neither the manifest `review.failOn` nor `policies/review.yaml` `failOn` is read at runtime.
- None of the 105 ADR `appliesTo` references resolves to a node, and the loader ignores the field.

## Decisions (user-approved 2026-09-25)
- Four PRs, each gated separately.
- Do not register observed imports as `depends_on`. Allowed directions are the complement of the forbidden constraints.
- cloud → local-runtime (#166) is a warning; it becomes an error once #166 is fixed. The other four layer constraints are errors.
- An undetermined dependency result (CodeFacts missing, truncated or stale) blocks the review (fail closed). It never reports as healthy.
- `.archcontext/policies/review.yaml` becomes the single effective `failOn` source. The manifest `review.failOn` is removed by hand in PR-4, because it is outside the ChangeSet allowlist.
- The remaining ~1154 non-architecture paths stay unowned on purpose. The recommendation gets acknowledged, not resolved; driving the count to zero is not a goal.

## Steps
- **PR-1 (model only).** One ChangeSet via `scripts/apply-model-proposal.ts` (preview, then `--approved`):
  - Create 7 components: core.module-statistics, core.refactor-assessment, local-runtime.runtime-daemon, local-runtime.local-store-sqlite, surfaces.cli (src + bin), surfaces.mcp-local, cloud.control-plane.
  - Widen ownership: the contracts module gets `schemas/**` and its package.json; each of the other 4 modules gets its package.json; practice-catalog gets `assets/**`.
  - Set capability configs, then run docs apply until it reaches a fixed point.
  - Expected result: 30 nodes, unowned 1154, ambiguous 0.
- **PR-2.** Migrate ADR `appliesTo` to real node ids. Add an `appliesTo` integrity check in architecture-domain, wired into `YamlModelStore.validateModel` and ledger `validateModelFiles`. A dangling reference rolls back a ChangeSet.
- **PR-3 (product).**
  - Add DependencyConstraint contract types.
  - Add `evaluateDependencyConstraints` in module-statistics, with states pass / violated / undetermined / not-applicable. It also fills `directionViolationCount`.
  - review-engine emits `prohibited-dependency` findings plus an `undetermined` finding.
  - The daemon `completeTask` wires it in with worktree-aware ownership.
  - A review policy loader enforces `failOn`.
  - `apply-model-proposal` also covers constraints.
- **PR-4 (model).** ChangeSet with 5 layer constraints plus the 5-item review policy. Remove the manifest `review.failOn`. Real-repo acceptance: a core → local-runtime import produces an error-level `prohibited-dependency`.

## Verification
Each PR runs `validate`, `docs drift`, `refactor scan`, `bun run verify`, and targeted tests (see the per-PR list in the research notes). The acceptance tests are in PR-3/PR-4.

## Rollback
- PR-1 and PR-4: `git revert`.
- PR-2: revert the code and the ADRs together.
- PR-3: revert, after which the constraints are inert declarations.
- To stop blocking without a revert, remove the category from `policies/review.yaml` `failOn` with one ChangeSet.

## Risk
- The CodeGraph import query cap is 5000; today there are 1694. At about 3× the results truncate to undetermined, and every review blocks.
- There are now two layer rule sources: the audit script and the model constraints.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [ ] Execute captured plan: Self-architecture ownership and enforced layer boundaries (#163)
