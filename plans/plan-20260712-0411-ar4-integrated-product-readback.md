# Plan: AR4 Integrated Product Readback and Closeout

> **Status**: Executing
> **Created**: 20260712-0411
> **Slug**: ar4-integrated-product-readback
> **Planning Source**: repo-harness-sprint
> **Orchestration Kind**: sprint-contract-row
> **Source Ref**: sprint:plans/sprints/20260712-0258-authority-aware-architecture-reading-completion.sprint.md#AR4
> **Artifact Level**: work-package
> **Promotion Reason**: product_acceptance_boundary
> **Verification Boundary**: Visible browser/design/performance/privacy/package/full verify/architecture/security/governance/lifecycle readback
> **Rollback Surface**: AR4 ADR, capability registry, and evidence-only revert; AR0-AR3 product commits remain independently revertible
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260712-0411-ar4-integrated-product-readback.contract.md`
> **Task Review**: `tasks/reviews/20260712-0411-ar4-integrated-product-readback.review.md`
> **Implementation Notes**: `tasks/notes/20260712-0411-ar4-integrated-product-readback.notes.md`

## Agentic Routing
- Selected route: plan-design-review
- Routing reason: Captured from repo-harness-sprint planning output.
- Source ref: sprint:plans/sprints/20260712-0258-authority-aware-architecture-reading-completion.sprint.md#AR4
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260712-0411-ar4-integrated-product-readback.md`
- Sprint contract: `tasks/contracts/20260712-0411-ar4-integrated-product-readback.contract.md`
- Sprint review: `tasks/reviews/20260712-0411-ar4-integrated-product-readback.review.md`
- Implementation notes: `tasks/notes/20260712-0411-ar4-integrated-product-readback.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260712-0411-ar4-integrated-product-readback.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree; `.claude/.active-plan` is a legacy fallback during transition. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260712-0411-ar4-integrated-product-readback.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260712-0411-ar4-integrated-product-readback.md`.

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
- Contract file: `tasks/contracts/20260712-0411-ar4-integrated-product-readback.contract.md`
- Review file: `tasks/reviews/20260712-0411-ar4-integrated-product-readback.review.md`
- Implementation notes file: `tasks/notes/20260712-0411-ar4-integrated-product-readback.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260712-0411-ar4-integrated-product-readback.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan`, the owning worktree is written to `.ai/harness/active-worktree`, and the plan is mirrored to `.claude/.active-plan` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260712-0411-ar4-integrated-product-readback.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: AR4 ADR, capability registry, and evidence-only revert; AR0-AR3 product commits remain independently revertible
- **Verification boundary**: Visible browser/design/performance/privacy/package/full verify/architecture/security/governance/lifecycle readback
- **Review/acceptance boundary**: `tasks/reviews/20260712-0411-ar4-integrated-product-readback.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: product_acceptance_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260712-0411-ar4-integrated-product-readback.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260712-0411-ar4-integrated-product-readback.contract.md`, `tasks/reviews/20260712-0411-ar4-integrated-product-readback.review.md`, and `tasks/notes/20260712-0411-ar4-integrated-product-readback.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260712-0411-ar4-integrated-product-readback.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: AR4 ADR, capability registry, and evidence-only revert; AR0-AR3 product commits remain independently revertible

## Captured Planning Output

# Objective

Close the full Authority-Aware Architecture Reading program with real local product
acceptance, design review, performance/privacy/package evidence, ADR readback,
capability-registry repair, full verification, and clean workflow lifecycle proof.

# Success Criteria

- Real token-gated loopback Explorer is exercised in a visible browser for all five
  views, overview/context/detail navigation, group toggle, focus/breadcrumb return,
  fit/zoom/pan, narrow viewport, empty and truncated states, no-JS structure, both SSE
  event contracts, disconnect, and token expiry.
- Screenshots feed the required `plan-design-review`; all seven passes, implementation
  tasks artifact, review log/dashboard, and terminal GSTACK review report complete with
  no unresolved decisions.
- Renderer/compiler readback proves determinism, privacy, external-asset absence, body
  size, and p95 budgets at 80/160 and 1000/5000.
- Packaged CLI accepts all five views and remains loopback-only, token-gated, GET-only,
  read-only, no-store, self-contained, no-egress, and fail-closed.
- ADR-0044 describes the accepted topology/interaction/Inspector/five-view boundary;
  ADR-0045 and Git-visible `.archcontext/` authority remain unchanged.
- The orphan capability-module governance blocker is repaired through the supported
  capability-config helper and registry validation passes; no generated architecture
  document or model authority is deleted.
- Focused matrix, typecheck, packaged smoke, privacy audit, full `bun run verify`,
  strict contract/Sprint, architecture review, and security review pass.
- After integration, no active plan/contract/worktree markers remain and no user-owned
  untracked file is changed.

# P1 · Architecture Map

- Product: Explorer V2 contracts/compiler/daemon/HTML/CLI landed in AR0-AR3 and are
  read-only in this phase unless a verified acceptance defect requires a bounded fix.
- Design evidence: real loopback browser screenshots and `plan-design-review` artifacts
  live under `~/.gstack/projects/...`; only textual review/readback is committed.
- Performance/privacy authority: `scripts/explorer-view-compiler-readback.mjs`,
  package smoke, privacy route audit, and full verify.
- Architecture authority: ADR-0044 is the Explorer boundary; ADR-0045 remains the
  data-engine authority and is read-only.
- Workflow authority: phase plan/contract/review/notes, Sprint row, checks snapshots,
  capability registry, and final clean marker/worktree readback.
- User state: `.ai/harness/delegation/subagent-stop-quality.json` is out of scope and
  must remain byte-identical.

# P2 · Concrete Acceptance Flow

```text
archctx daemon/explore start
  -> loopback token session
  -> visible browser opens token-bearing URL
  -> projection/v2 + self-contained HTML
  -> exercise navigation/transient controls/five views/states
  -> trigger authority-changed and projection-invalidated through real daemon paths
  -> observe bounded reload qualification, disconnect, and expiry
  -> capture screenshots and design findings
  -> package/privacy/performance/full verification
  -> ADR/governance readback
  -> strict lifecycle archive and merge
```

Browser output is a disposable projection. Screenshots and review comments never become
architecture authority, and no test bypasses token/session or mutation boundaries.

# P3 · Decision

AR4 is acceptance-first. Do not refactor working AR0-AR3 code for polish. Fix only a
reproducible ship blocker inside an explicitly widened contract. The known capability
registry failure is in scope because it blocks supported workflow closeout; repair it
by registering the existing generated architecture module, not deleting truth or adding
a compatibility bypass.

At 10x scale the public query/read budget is the deliberate first stop. Browser DOM,
renderer time, and body-size budgets remain measured at the public maximum rather than
being hidden by client-side sampling.

# Allowed Paths

- `plans/plan-20260712-0225-authority-aware-architecture-reading-completion.md`
- `docs/adr/ADR-0044-authority-aware-explorer-view-compiler.md`
- `.ai/context/capabilities.json`
- `docs/verification/ar4-product-readback.json`
- `docs/verification/ar4-product-readback.md`
- phase plan/contract/review/notes and Sprint lifecycle artifacts

Read-only verification surfaces include all product code/tests, ADR-0045, schemas,
package metadata, harness policy, and generated architecture model/doc projections.
If a real acceptance defect requires product code, first update this plan and contract
with exact paths and the smallest coherent fix. Database migrations, compatibility
paths, cache rewrites, and authority changes are hard stops.

# Task Breakdown

- [ ] Create bounded AR4 contract/worktree and record base/user-untracked checksum.
- [ ] Start the real local product and capture visible-browser acceptance/screenshots.
- [ ] Execute the required seven-pass plan-design-review and terminal review report.
- [ ] Run renderer/compiler maximum-budget, privacy, package, CSP, and no-egress audits.
- [ ] Update ADR-0044 with the accepted AR0-AR3 boundary; leave ADR-0045 untouched.
- [ ] Repair and validate the capability registry through `capability-config`.
- [ ] Run focused matrix, typecheck, packaged smoke, privacy audit, full verify,
      architecture/security reviews, strict contract/Sprint verification.
- [ ] Write durable AR4 JSON/Markdown evidence, complete review/notes, archive, merge,
      and prove clean workflow/worktree markers plus preserved user untracked state.

# Verification

```bash
bun test packages/contracts/test/contracts.test.ts \
  packages/local-runtime/explorer-html/test/topology.test.ts \
  packages/local-runtime/explorer-html/test/runtime-script.test.ts \
  packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts \
  packages/local-runtime/runtime-daemon/test/local-runtime.test.ts \
  packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts \
  packages/surfaces/cli/test/cli.test.ts \
  packages/surfaces/explorer-ui/test/explorer-ui.test.ts
bun run typecheck
bun run verify:explorer
node scripts/privacy-route-audit.mjs
bun run scripts/packaged-cli-smoke.mjs
bun run verify
repo-harness run capability-resolver -- validate --format json
repo-harness run verify-contract --contract <ar4-contract> --strict
REPO_HARNESS_DIFF_BASE=<ar4-base> repo-harness run verify-sprint -- --strict
```

# Architecture and Security Review Rubric

- Architecture: one projection authority, bounded read plan, typed selection, disposable
  geometry/cache, no ledger/YAML/SQLite boundary regression, ADR consistency, 10x stop.
- Security: loopback bind, bearer token, expiry/revocation, GET-only, CSP, no-store,
  no external asset/egress, escaping, no source/event/diff/prompt bodies, no browser
  semantic authority, explicit failures.

# Rollback and Stop Conditions

Rollback only the ADR/registry/readback changes from this phase. AR0-AR3 product commits
already passed their own contracts and are not bundled into an AR4 rollback. Stop on any
need for compatibility code, database migration, cache rewrite, remote service, token
bypass, authority promotion, or destructive cleanup of user state.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [ ] Create bounded AR4 contract/worktree and record base/user-untracked checksum.
- [ ] Start the real local product and capture visible-browser acceptance/screenshots.
- [ ] Execute the required seven-pass plan-design-review and terminal review report.
- [ ] Run renderer/compiler maximum-budget, privacy, package, CSP, and no-egress audits.
- [ ] Update ADR-0044 with the accepted AR0-AR3 boundary; leave ADR-0045 untouched.
- [ ] Repair and validate the capability registry through `capability-config`.
- [ ] Run focused matrix, typecheck, packaged smoke, privacy audit, full verify,
- [ ] Write durable AR4 JSON/Markdown evidence, complete review/notes, archive, merge,
