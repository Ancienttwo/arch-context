# Plan: Integrate archctx 0.5.12 RPC fix release metadata

> **Status**: Executing
> **Created**: 20260927-0329
> **Slug**: archctx-0512-rpc-integration
> **Planning Source**: repo-harness-plan
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: User authorized PR and merge; npm publication is delegated separately
> **Verification Boundary**: Pinned Bun full verify, release dry-run, package smoke, strict contract and CI
> **Rollback Surface**: Revert version metadata before npm publication
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260927-0329-archctx-0512-rpc-integration.contract.md`
> **Task Review**: `tasks/reviews/20260927-0329-archctx-0512-rpc-integration.review.md`
> **Implementation Notes**: `tasks/notes/20260927-0329-archctx-0512-rpc-integration.notes.md`

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

- Active plan: `plans/plan-20260927-0329-archctx-0512-rpc-integration.md`
- Sprint contract: `tasks/contracts/20260927-0329-archctx-0512-rpc-integration.contract.md`
- Sprint review: `tasks/reviews/20260927-0329-archctx-0512-rpc-integration.review.md`
- Implementation notes: `tasks/notes/20260927-0329-archctx-0512-rpc-integration.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260927-0329-archctx-0512-rpc-integration.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260927-0329-archctx-0512-rpc-integration.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260927-0329-archctx-0512-rpc-integration.md`.

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
- Contract file: `tasks/contracts/20260927-0329-archctx-0512-rpc-integration.contract.md`
- Review file: `tasks/reviews/20260927-0329-archctx-0512-rpc-integration.review.md`
- Implementation notes file: `tasks/notes/20260927-0329-archctx-0512-rpc-integration.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260927-0329-archctx-0512-rpc-integration.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260927-0329-archctx-0512-rpc-integration.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Revert version metadata before npm publication
- **Verification boundary**: Pinned Bun full verify, release dry-run, package smoke, strict contract and CI
- **Review/acceptance boundary**: `tasks/reviews/20260927-0329-archctx-0512-rpc-integration.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: User authorized PR and merge; npm publication is delegated separately

## Evidence Contract

- **State/progress path**: `plans/plan-20260927-0329-archctx-0512-rpc-integration.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260927-0329-archctx-0512-rpc-integration.contract.md`, `tasks/reviews/20260927-0329-archctx-0512-rpc-integration.review.md`, and `tasks/notes/20260927-0329-archctx-0512-rpc-integration.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260927-0329-archctx-0512-rpc-integration.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Revert version metadata before npm publication

## Captured Planning Output

# Integrate archctx 0.5.12 source version for the merged RPC fix

## Authority and goal
The user authorized submitting and merging an arch-context PR while another agent owns npm publication. Current main already contains #178's `Connection: close` runtime RPC fix. Published 0.5.10/0.5.11 packages lack it. This work package advances current-main source release metadata to 0.5.12, verifies exact source and package behavior, and merges only after review and CI. It does not publish to npm or update downstream repo-harness pins.

## P1 architecture map
`packages/local-runtime/runtime-daemon` owns the loopback RPC transport; `packages/contracts/src/product-version.ts` and the six workspace manifests define product identity; `packages/core/practice-catalog/assets/catalog.yaml`, contract fixtures and runner examples project that identity. `scripts/fg6-npm-release-dry-run.ts` produces isolated tarballs, while npm publication uses explicit publish scripts. `.archcontext/` and generated architecture docs remain daemon-owned and out of scope.

## P2 concrete trace
A CLI health/read RPC succeeds, synchronous architecture projection work runs, then a pooled stale loopback socket can reset on `planUpdate` in published packages. Main source already sends `Connection: close` and its regression test passes. This branch changes release identity to 0.5.12, then pinned Bun tests, full `verify`, dry-run tarball build and installed-package smoke validate the source. Merge leaves npm registry unchanged; the other agent must rebuild and publish from the exact merged source.

## P3 decision
Integrate the version bump from current main, preserving `@archcontext/contracts` as private source. The old tag-based hotfix tarball is a separate diagnostic candidate with different bytes and must not be called the main release. The smallest change is release metadata and a durable handoff note; no new runtime abstraction or network fallback. At 10x the per-RPC loopback connection handshake is the first cost to measure, not an excuse to retry unknown committed mutations.


## Allowed paths
.github/workflows/verify.yml
package.json
bun.lock
packages/cloud/package.json
packages/contracts/package.json
packages/core/package.json
packages/local-runtime/package.json
packages/surfaces/package.json
packages/contracts/src/product-version.ts
packages/contracts/fixtures/valid/archctx-capabilities.json
packages/contracts/fixtures/valid/product-version-manifest.json
packages/core/practice-catalog/assets/catalog.yaml
actions/review-action/action.yml
docs/examples/github-hosted-runner-workflow.yml
docs/examples/reusable-organization-runner-caller.yml
docs/researches/20260927-rpc-keepalive-hotfix-0512.md
docs/verification/fg4-deterministic-conclusion-readback.json
docs/verification/fg6-no-provider-deterministic-readback.json
plans/plan-*-archctx-0512-rpc-integration.md
tasks/contracts/*-archctx-0512-rpc-integration.contract.md
tasks/reviews/*-archctx-0512-rpc-integration.review.md
tasks/notes/*-archctx-0512-rpc-integration.notes.md
tasks/current.md
tasks/workflow-state.yaml

## Verification boundary
Exact current-main `bun run verify` with pinned Bun 1.4.0, targeted RPC test, npm dry-run and installed-package smoke. Confirm no package or generated model source outside the listed paths changed. CI must pass on the PR head. No registry mutation is included.

## Rollback surface
Revert the version-metadata merge commit before npm publication. After publication, rollback requires a new npm version rather than replacing 0.5.12 bytes.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] Rebase the version bump onto current main and preserve main's private contracts source manifest.
- [x] Align all product/package, lockfile, fixture, catalog and runner-template version anchors to 0.5.12.
- [x] Run current-main pinned-Bun typecheck, RPC tests, full verify, npm dry-run and installed tarball smoke; bind the handoff to the current-main artifact bytes.
- [x] Complete contract/review and final PR-head CI; hand the ready PR to the merge step while leaving npm publication to the other agent.
