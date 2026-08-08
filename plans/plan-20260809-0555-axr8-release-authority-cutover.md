# Plan: AXR8 Release and Authority Cutover

> **Status**: Executing
> **Created**: 20260809-0555
> **Slug**: axr8-release-authority-cutover
> **Planning Source**: repo-harness-sprint
> **Orchestration Kind**: host-plan
> **Source Ref**: sprint:plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md#AXR8
> **Artifact Level**: work-package
> **Promotion Reason**: human_decision_boundary
> **Verification Boundary**: registry integrity, clean-room installs, selected runtime status/readiness/Stop, strict architecture gates
> **Rollback Surface**: version manifests, exact npm dependencies, selected Bun-global install, architecture gate policy
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260809-0555-axr8-release-authority-cutover.contract.md`
> **Task Review**: `tasks/reviews/20260809-0555-axr8-release-authority-cutover.review.md`
> **Implementation Notes**: `tasks/notes/20260809-0555-axr8-release-authority-cutover.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from repo-harness-sprint planning output.
- Source ref: sprint:plans/sprints/20260808-1433-archctx-repo-harness-projection-runtime-integration.sprint.md#AXR8
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260809-0555-axr8-release-authority-cutover.md`
- Sprint contract: `tasks/contracts/20260809-0555-axr8-release-authority-cutover.contract.md`
- Sprint review: `tasks/reviews/20260809-0555-axr8-release-authority-cutover.review.md`
- Implementation notes: `tasks/notes/20260809-0555-axr8-release-authority-cutover.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260809-0555-axr8-release-authority-cutover.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260809-0555-axr8-release-authority-cutover.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260809-0555-axr8-release-authority-cutover.md`.

## Approach
### Strategy
Cut the producer release first, because repo-harness must resolve exact public
`0.4.0` dependencies without a file overlay. Align every ArchContext product
version authority, reproduce the AXR7 package integrities, publish contracts
before the CLI, and require registry plus clean-room readback before touching
the consumer release. The consumer half then cuts `repo-harness@0.14.0`, installs
that exact Bun-global runtime, promotes projection/freshness gates to strict,
and proves the ten-capability source tree remains fixed-point clean.

### Trade-offs
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Captured plan | Preserves the approved Codex Plan or Waza think decision | Requires the captured text to be concrete enough to execute | Use |

## Detailed Design
### File Changes
| File | Action | Description |
|------|--------|-------------|
| `package.json`, `packages/*/package.json`, `bun.lock` | Update | Align product and workspace versions at `0.4.0` |
| `packages/contracts/src/product-version.ts` and version fixtures | Update | Keep runtime capability handshake and contract fixtures exact |
| `docs/runbooks/`, `docs/examples/` | Update | Point current install/runbook surfaces at `0.4.0` |
| `docs/verification/` | Generate | Record dry-run, registry, tarball, and release provenance readbacks |
| repo-harness release surfaces | Follow-on repository unit | Pin exact public dependencies, release `0.14.0`, enable strict gates |

### Code Snippets
See captured planning output.

### Data Flow
See captured planning output.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Captured plan lacks enough detail | Medium | Execution may need clarification | Stop before implementation if the captured output contradicts repo rules or lacks concrete file targets |
| Registry integrity differs from AXR7 tarball | Low | Consumer proof no longer matches accepted producer | Stop before consumer cutover; do not publish the dependent package |
| Interactive 2FA cannot complete | Medium | Registry mutation remains blocked | Keep release commit and tarball; do not claim release or proceed to dependent publish |
| Strict gate exposes pending runtime state | Medium | Stop/readiness fails closed | Drain or explicitly resolve the existing projection queue before final cutover |

## Task Contracts
- Contract file: `tasks/contracts/20260809-0555-axr8-release-authority-cutover.contract.md`
- Review file: `tasks/reviews/20260809-0555-axr8-release-authority-cutover.review.md`
- Implementation notes file: `tasks/notes/20260809-0555-axr8-release-authority-cutover.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260809-0555-axr8-release-authority-cutover.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260809-0555-axr8-release-authority-cutover.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: version manifests, exact npm dependencies, selected Bun-global install, architecture gate policy
- **Verification boundary**: registry integrity, clean-room installs, selected runtime status/readiness/Stop, strict architecture gates
- **Review/acceptance boundary**: `tasks/reviews/20260809-0555-axr8-release-authority-cutover.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: human_decision_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260809-0555-axr8-release-authority-cutover.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260809-0555-axr8-release-authority-cutover.contract.md`, `tasks/reviews/20260809-0555-axr8-release-authority-cutover.review.md`, and `tasks/notes/20260809-0555-axr8-release-authority-cutover.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260809-0555-axr8-release-authority-cutover.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: version manifests, exact npm dependencies, selected Bun-global install, architecture gate policy

## Captured Planning Output

# AXR8 Release and Authority Cutover

Release archctx-contracts@0.4.0, archctx@0.4.0, and repo-harness@0.14.0 in dependency order. Verify exact registry integrity against AXR7 tarballs, install the selected Bun-global runtime, promote architecture projection gates from advisory to strict, and prove 10/10 ArchContext capability authority with clean Stop/readiness readback. Skip Claude review under the user-authorized typed waiver. Trigger browser authentication only at the actual npm publish boundary.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] Align ArchContext and contracts version authorities at `0.4.0`.
- [x] Run producer verification, package dry-runs, and compare AXR7 integrities; refresh the release baseline for the two pre-publish correctness fixes recorded in implementation notes.
- [ ] Publish and read back `archctx-contracts@0.4.0`.
- [ ] Publish and read back `archctx@0.4.0`.
- [ ] Cut and publish `repo-harness@0.14.0` with exact public dependencies.
- [ ] Install the selected Bun-global `repo-harness@0.14.0` runtime.
- [ ] Promote architecture projection/freshness gates to strict and prove clean Stop/readiness.
- [ ] Record typed user waiver, close AXR8, push both repositories, and read back final state.
