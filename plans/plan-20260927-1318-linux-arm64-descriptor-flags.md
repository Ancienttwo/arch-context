# Plan: Fix Linux arm64 descriptor flags

> **Status**: Executing
> **Created**: 20260927-1318
> **Slug**: linux-arm64-descriptor-flags
> **Planning Source**: repo-harness-plan
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: User approved cold-release blocker repair
> **Verification Boundary**: Red-green ARM guard, full verify, source-built cold smoke, hosted ARM CI
> **Rollback Surface**: Revert source/CI change before npm publication
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260927-1318-linux-arm64-descriptor-flags.contract.md`
> **Task Review**: `tasks/reviews/20260927-1318-linux-arm64-descriptor-flags.review.md`
> **Implementation Notes**: `tasks/notes/20260927-1318-linux-arm64-descriptor-flags.notes.md`
> **Substantive Change SHA256**: `sha256:0703541b6f4bc6e28bc3e509cd2639f608b801681cfc3615fb5695e083dda948`

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

- Active plan: `plans/plan-20260927-1318-linux-arm64-descriptor-flags.md`
- Sprint contract: `tasks/contracts/20260927-1318-linux-arm64-descriptor-flags.contract.md`
- Sprint review: `tasks/reviews/20260927-1318-linux-arm64-descriptor-flags.review.md`
- Implementation notes: `tasks/notes/20260927-1318-linux-arm64-descriptor-flags.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260927-1318-linux-arm64-descriptor-flags.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260927-1318-linux-arm64-descriptor-flags.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260927-1318-linux-arm64-descriptor-flags.md`.

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
- Contract file: `tasks/contracts/20260927-1318-linux-arm64-descriptor-flags.contract.md`
- Review file: `tasks/reviews/20260927-1318-linux-arm64-descriptor-flags.review.md`
- Implementation notes file: `tasks/notes/20260927-1318-linux-arm64-descriptor-flags.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260927-1318-linux-arm64-descriptor-flags.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260927-1318-linux-arm64-descriptor-flags.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Revert source/CI change before npm publication
- **Verification boundary**: Red-green ARM guard, full verify, source-built cold smoke, hosted ARM CI
- **Review/acceptance boundary**: `tasks/reviews/20260927-1318-linux-arm64-descriptor-flags.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: User approved cold-release blocker repair

## Evidence Contract

- **State/progress path**: `plans/plan-20260927-1318-linux-arm64-descriptor-flags.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260927-1318-linux-arm64-descriptor-flags.contract.md`, `tasks/reviews/20260927-1318-linux-arm64-descriptor-flags.review.md`, and `tasks/notes/20260927-1318-linux-arm64-descriptor-flags.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260927-1318-linux-arm64-descriptor-flags.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Revert source/CI change before npm publication

## Captured Planning Output

# Fix secure descriptor writes on Linux arm64

## Authority and approval
The user approved the bounded fix after a cold Linux package validation failed. No npm publication is authorized in this work package; the publication agent will consume a reviewed fix and rebuild from the exact merged source.

## P1 / P2 / P3
P1: `packages/core/changeset-engine/src/descriptor-relative-write.ts` owns the no-follow, expected-hash writer reached by `archctx init`; public package bundling exposes it. Existing CI lacks Linux arm64.
P2: the source used x86_64 `O_DIRECTORY=0x10000` and `O_NOFOLLOW=0x20000` on all Linux CPUs. Linux arm64 provides `fs.constants.O_DIRECTORY=0x4000`, `O_NOFOLLOW=0x8000`; root open with `0x90000` returns `EINVAL`. The existing private-file behavior test failed before the fix and passed after it on arm64.
P3: read the two architecture-varying flags from `node:fs.constants`, fail closed if missing, keep O_CLOEXEC and no-follow writes. Run the existing changeset behavior suite in a focused `ubuntu-24.04-arm` CI job, then cold-test the source-built tarball. No new write abstraction or fallback.

## Workflow inventory
This isolated worktree owns its plan/contract/review/notes; `tasks/todos.md` remains the deferred ledger. Verification evidence is in `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and `_ops/linux-arm64-open/`. The exact allowed paths are frozen in the task contract. Do not alter another worktree's active plan or PR.

## Allowed paths
packages/core/changeset-engine/src/descriptor-relative-write.ts
.github/workflows/verify.yml
docs/researches/20260927-linux-arm64-descriptor-flags.md
plans/plan-*-linux-arm64-descriptor-flags.md
tasks/contracts/*-linux-arm64-descriptor-flags.contract.md
tasks/reviews/*-linux-arm64-descriptor-flags.review.md
tasks/notes/*-linux-arm64-descriptor-flags.notes.md
tasks/todos.md

## Verification boundary
The existing `writeFileWithoutFollowingSymlinks` guard fails with `PRE_FIX_EXIT=1` on Linux arm64 and passes after the fix. Its full 25-test suite and cold installed 7-check CLI/daemon/CodeGraph path pass on Linux arm64. Pinned Bun typecheck/full verify and hosted CI pass, including the new focused ARM job. Verify no change to public npm registry.

## Rollback surface
Revert the two source/workflow files before publication. A published package would require a new version, not replacement of 0.5.12 bytes.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] Prove the Linux arm64 root cause with a cold tarball and capture the existing behavior guard failing before the fix.
- [x] Use platform-provided directory/no-follow constants and add a focused Linux arm64 CI job for the existing security behavior suite.
- [x] Run pinned-Bun typecheck/full verify, Linux arm64 changeset tests and clean tarball smoke; record source/artefact checksums.
- [ ] Complete contract, independent review and PR-head CI; merge the fix without npm publication.
