# Plan: #238 live proof: bunfig.toml ownership via v2 committed-change acceptance

> **Status**: Executing
> **Created**: 20260929-1123
> **Slug**: bunfig-ownership-acceptance
> **Planning Source**: repo-harness-plan
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: User approved full #238 on 2026-09-28; live proof step after #247
> **Verification Boundary**: validate, repo-harness/v1 drift clean, unownedFileCount 0, scripts test, typecheck, full test, gatekeeper, hosted CI
> **Rollback Surface**: git revert plus inverse ChangeSet; no SQLite edits
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260929-1123-bunfig-ownership-acceptance.contract.md`
> **Task Review**: `tasks/reviews/20260929-1123-bunfig-ownership-acceptance.review.md`
> **Implementation Notes**: `tasks/notes/20260929-1123-bunfig-ownership-acceptance.notes.md`

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

- Active plan: `plans/plan-20260929-1123-bunfig-ownership-acceptance.md`
- Sprint contract: `tasks/contracts/20260929-1123-bunfig-ownership-acceptance.contract.md`
- Sprint review: `tasks/reviews/20260929-1123-bunfig-ownership-acceptance.review.md`
- Implementation notes: `tasks/notes/20260929-1123-bunfig-ownership-acceptance.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260929-1123-bunfig-ownership-acceptance.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260929-1123-bunfig-ownership-acceptance.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260929-1123-bunfig-ownership-acceptance.md`.

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
- Contract file: `tasks/contracts/20260929-1123-bunfig-ownership-acceptance.contract.md`
- Review file: `tasks/reviews/20260929-1123-bunfig-ownership-acceptance.review.md`
- Implementation notes file: `tasks/notes/20260929-1123-bunfig-ownership-acceptance.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260929-1123-bunfig-ownership-acceptance.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260929-1123-bunfig-ownership-acceptance.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: git revert plus inverse ChangeSet; no SQLite edits
- **Verification boundary**: validate, repo-harness/v1 drift clean, unownedFileCount 0, scripts test, typecheck, full test, gatekeeper, hosted CI
- **Review/acceptance boundary**: `tasks/reviews/20260929-1123-bunfig-ownership-acceptance.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: User approved full #238 on 2026-09-28; live proof step after #247

## Evidence Contract

- **State/progress path**: `plans/plan-20260929-1123-bunfig-ownership-acceptance.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260929-1123-bunfig-ownership-acceptance.contract.md`, `tasks/reviews/20260929-1123-bunfig-ownership-acceptance.review.md`, and `tasks/notes/20260929-1123-bunfig-ownership-acceptance.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260929-1123-bunfig-ownership-acceptance.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: git revert plus inverse ChangeSet; no SQLite edits

## Captured Planning Output

## Authority and goal

On 2026-09-28 the user approved doing all of #238 ("238可以做"). #247 (v2 committed-change acceptance) is merged. This plan is the live proof that design called for: fix the last `unowned-paths` gap (5 per-workspace `bunfig.toml` files) with a real ChangeSet, accept it through `ledger accept-committed` v2, and deliver the accepted projection through `projection run`, all before the #238 move-only extraction. If the live path turns up a defect, fix it here, before that code moves.

## P1 architecture map

- `unownedFileCount` (packages/core/module-statistics/src/ownership.ts) reports 5. The files are `packages/{cloud,contracts,core,local-runtime,surfaces}/bunfig.toml`.
  - Each sits under a top-level directory where the model declares source.
  - No node claims any of them.
  - The root `bunfig.toml` scopes only itself and is not counted.
- Owners: `module.architecture-context.{cloud,contracts,core,local-runtime,surfaces}`. Each module's `source.include` already lists `packages/<ws>/package.json`.
- Write path, parent-owned because subagents must not mutate YAML: `scripts/apply-model-proposal.ts` → daemon `planUpdate`/`applyUpdate` → ChangeSet journal with the #247 model transition.
- Then:
  - `archctx ledger accept-committed --journal <id>=<changeSetId>` (preview, then `--approved`);
  - `archctx projection run` with the returned `acceptedChange` tuple, profile `repo-harness/v1`.

## P2 concrete trace

1. The proposal carries five `update_entity_fields` operations. Each body is the current YAML plus one `"packages/<ws>/bunfig.toml"` include line after `package.json`; `expectedHash` is the current body hash.
2. Preview, then apply with `--approved`. The journal commits and records `{before, after}`.
3. Accept preview gives `acceptancePlanId`. Approve appends the v2 event and returns the tuple.
4. `projection run` applies the generated docs and records the receipt and refresh signal.
5. `docs drift --profile repo-harness/v1` is clean.
6. `refactor scan` shows `unownedFileCount: 0`.

Gap: the proposal script's receipt drops `journalId`, which #247 added to `apply_update` for exactly this flow. Add it to the receipt.

## P3 decision

- Keep the ChangeSet minimal: add one include line per module. No exclude changes, no new nodes, no root bunfig ownership.
- Expected majorChange: `ownership-changed` on `capability.architecture.context`.
- If acceptance refuses a legitimate change, stop and record the evidence; do not hand-edit around it.
- Generated docs change only through `projection run` or `docs apply`, never by hand.

At 10x (many ownership edits) the pressure point is the writer lock during the preview/approve docs builds.

## Allowed paths

- `.archcontext/model/nodes/module.architecture-context.cloud.yaml`
- `.archcontext/model/nodes/module.architecture-context.contracts.yaml`
- `.archcontext/model/nodes/module.architecture-context.core.yaml`
- `.archcontext/model/nodes/module.architecture-context.local-runtime.yaml`
- `.archcontext/model/nodes/module.architecture-context.surfaces.yaml`
- `docs/architecture/`
- `scripts/apply-model-proposal.ts`
- `scripts/apply-model-proposal.test.ts`
- `tasks/todos.md`
- `tasks/notes/**`
- `plans/**`

## Verification boundary

With Bun 1.4.0:
- `archctx validate`;
- `docs drift --profile repo-harness/v1` clean;
- `refactor scan` shows `unownedFileCount` 0;
- the scripts test for the proposal receipt;
- typecheck;
- full `bun test`;
- gatekeeper;
- hosted CI.

## Rollback surface

`git revert` of the PR, plus an inverse ChangeSet if the model must return while the local ledger keeps its record-only acceptance event. No SQLite edits.

## Task Breakdown

- [ ] Add `journalId` to the apply-model-proposal receipt, with a test (worker).
- [ ] Parent: apply the ownership ChangeSet, then accept it (preview, then approve).
- [ ] Parent: run `projection run` with the tuple, check drift is clean, and confirm the scan shows 0 unowned files.
- [ ] Record evidence in the notes, then run verification, gatekeeper, and open the PR.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [ ] Add `journalId` to the apply-model-proposal receipt, with a test (worker).
- [ ] Parent: apply the ownership ChangeSet, then accept it (preview, then approve).
- [ ] Parent: run `projection run` with the tuple, check drift is clean, and confirm the scan shows 0 unowned files.
- [ ] Record evidence in the notes, then run verification, gatekeeper, and open the PR.
