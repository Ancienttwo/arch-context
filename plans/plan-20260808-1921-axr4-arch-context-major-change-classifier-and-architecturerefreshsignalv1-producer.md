# Plan: Sprint task: AXR4 [arch-context] major-change classifier and ArchitectureRefreshSignalV1 producer

> **Status**: Executing
> **Created**: 20260808-1921
> **Slug**: axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer
> **Planning Source**: repo-harness-sprint
> **Orchestration Kind**: sprint-task
> **Source Ref**: sprint:plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md#AXR4 [arch-context] major-change classifier and ArchitectureRefreshSignalV1 producer
> **Artifact Level**: work-package
> **Promotion Reason**: worktree_boundary
> **Verification Boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.contract.md --strict`.
> **Rollback Surface**: Before execution remove `plans/plan-20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.md`; after execution revert branch `codex/axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer` or the explicitly reviewed diff.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.contract.md`
> **Task Review**: `tasks/reviews/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.review.md`
> **Implementation Notes**: `tasks/notes/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from repo-harness-sprint planning output.
- Source ref: sprint:plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md#AXR4 [arch-context] major-change classifier and ArchitectureRefreshSignalV1 producer
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.md`
- Sprint contract: `tasks/contracts/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.contract.md`
- Sprint review: `tasks/reviews/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.review.md`
- Implementation notes: `tasks/notes/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.md`.

## Approach
### Strategy
Compile a canonical per-capability semantic state from accepted node/relation/flow
authority, persist that state in the projection manifest, and compare it with the
previous accepted manifest. A semantic delta without a typed accepted ChangeSet/event
reference is never promoted to truth: it emits only `human-action-required`. A delta
with an accepted reference emits one `ArchitectureRefreshSignalV1`; source-only,
render-only, layout-only and generated-file changes emit none.

The signal producer is pure. It receives repository/worktree identity and digest sets,
derives a stable idempotency key, binds the accepted reference when present, and binds
the surrounding projection receipt without putting file bodies, raw diffs, CodeGraph
output, prompts or secrets on the wire.

### Trade-offs
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Captured plan | Preserves the approved Codex Plan or Waza think decision | Requires the captured text to be concrete enough to execute | Use |

## Detailed Design
### File Changes
| File | Action | Description |
|------|--------|-------------|
| `packages/contracts/src/projection.ts` and runtime schemas/fixtures | Modify | Add the typed accepted semantic reference and enforce signal/receipt invariants. |
| `packages/core/projection-engine/src/major-change.ts` | Add | Canonical semantic-state compiler, closed-taxonomy diff, unresolved-candidate handling, and deterministic signal producer. |
| `packages/core/projection-engine/src/index.ts` | Modify | Persist semantic baseline in the manifest and expose classification/signals/receipt on the projection plan. |
| `packages/surfaces/cli/src/main.ts` | Modify | Surface refresh signals and optional accepted ChangeSet/event metadata on manual docs plan/apply readback. |
| focused contract/projection/CLI tests | Add/modify | Cover every reason code, negative cases, privacy, stale identity, and idempotency. |

### Code Snippets
`model + proven flow AST -> canonical capability states -> compare accepted manifest ->
major-change classification -> projection receipt -> ArchitectureRefreshSignalV1[]`.

`accepted reference missing -> unresolved-major-candidate -> human-action-required`.

### Data Flow
See captured planning output.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| First v2 manifest has no semantic baseline | Medium | False global refresh | Bootstrap the baseline with no accepted refresh signal; only unresolved proof failures remain visible. |
| Rename is guessed from remove/add | Medium | Wrong reason code | Reason taxonomy in an accepted ChangeSet/event reference is authoritative; never infer rename identity. |
| Receipt/signal circular hash | Medium | Unverifiable contract | Omit signal back-reference while hashing the receipt, then bind and validate it exactly as ProjectionResultV1 already does. |
| Source refactor changes snapshot digests | High | False refresh | Gate signals on semantic/proof classification, never on sourceTree/worktree/LOC/render digests alone. |

## P1 · Architecture Map

- Authority: `.archcontext/model/{nodes,relations,flows}` plus verified semantic compiler output.
- Baseline: `docs/architecture/.projection-manifest.json`; it is a generated read model,
  not a second model authority.
- Producer: `@archcontext/core/projection-engine`; CLI is only a trigger/readback surface.
- Consumer is out of scope until AXR5/AXR6; no repo-harness config or runtime mutation lands here.

## P2 · Concrete Trace

`archctx docs plan|apply` loads the model and CodeGraph snapshot, compiles semantic P1/P2,
builds a canonical capability state, reads the previous manifest state, classifies the
closed reason taxonomy, builds the projection receipt, then emits zero or one sorted
signal. `apply` still writes only through the daemon ChangeSet path. Invalid baseline,
stale identity, unaccepted semantic change, or unprovable required flow fails closed or
returns human action; it never silently refreshes semantic truth.

## P3 · Decision Rationale

The existing renderer already owns model normalization, proof compilation, manifest and
ChangeSet writes, so classification belongs beside it. The invariant is that only
accepted semantic authority can trigger automatic refresh. At 10x capability count the
first pressure point is repeated whole-model compilation; deterministic sorted maps keep
the current implementation correct and leave per-capability incremental caching to a
later measured optimization.

## Task Contracts
- Contract file: `tasks/contracts/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.contract.md`
- Review file: `tasks/reviews/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.review.md`
- Implementation notes file: `tasks/notes/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Before execution remove `plans/plan-20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.md`; after execution revert branch `codex/axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer` or the explicitly reviewed diff.
- **Verification boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.contract.md --strict`.
- **Review/acceptance boundary**: `tasks/reviews/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: worktree_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.contract.md`, `tasks/reviews/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.review.md`, and `tasks/notes/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Before execution remove `plans/plan-20260808-1921-axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer.md`; after execution revert branch `codex/axr4-arch-context-major-change-classifier-and-architecturerefreshsignalv1-producer` or the explicitly reviewed diff.

## Captured Planning Output

# Sprint Task: AXR4 [arch-context] major-change classifier and ArchitectureRefreshSignalV1 producer

## Context

- Sprint: `plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md`
- Backlog row: 5
- Mode: contract
- Read the sprint Source PRD and Architecture Notes before implementation.
- The sprint row is a long-task waypoint, not a detailed implementation plan.

## Goal

Deliver backlog task `AXR4 [arch-context] major-change classifier and ArchitectureRefreshSignalV1 producer` so that the acceptance line holds: accepted semantic/proof changes emit one stable signal; refactor/generated/layout-only changes emit none; unresolved candidates emit human-action signal; duplicate run preserves signalId

## Planning Expansion

Before editing code, use `$think` to expand this sprint row into a decision-complete implementation plan. The `$think` pass should read the sprint file, preserve the acceptance line, name concrete files or commands, and produce the detailed `plans/plan-*.md` body that drives contract execution.

## Task Breakdown

- [x] Run `$think` for backlog task `AXR4 [arch-context] major-change classifier and ArchitectureRefreshSignalV1 producer` using sprint `plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md` and acceptance: accepted semantic/proof changes emit one stable signal; refactor/generated/layout-only changes emit none; unresolved candidates emit human-action signal; duplicate run preserves signalId
- [x] Capture the approved `$think` output with `repo-harness run capture-plan --source waza-think --source-ref sprint:plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md#AXR4 [arch-context] major-change classifier and ArchitectureRefreshSignalV1 producer`
- [x] Verify acceptance: accepted semantic/proof changes emit one stable signal; refactor/generated/layout-only changes emit none; unresolved candidates emit human-action signal; duplicate run preserves signalId

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] Run `$think` for backlog task `AXR4 [arch-context] major-change classifier and ArchitectureRefreshSignalV1 producer` using sprint `plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md` and acceptance: accepted semantic/proof changes emit one stable signal; refactor/generated/layout-only changes emit none; unresolved candidates emit human-action signal; duplicate run preserves signalId
- [x] Capture the approved `$think` output with `repo-harness run capture-plan --source waza-think --source-ref sprint:plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md#AXR4 [arch-context] major-change classifier and ArchitectureRefreshSignalV1 producer`
- [x] Verify acceptance: accepted semantic/proof changes emit one stable signal; refactor/generated/layout-only changes emit none; unresolved candidates emit human-action signal; duplicate run preserves signalId
