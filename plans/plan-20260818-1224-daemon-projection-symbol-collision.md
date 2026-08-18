# Plan: Remove the duplicate completeTaskProjection* symbols in the runtime daemon

> **Status**: Executing
> **Created**: 20260818-1224
> **Slug**: daemon-projection-symbol-collision
> **Artifact Level**: work-package
> **Promotion Reason**: human_decision_boundary
> **Verification Boundary**: `bun test`, `bun run typecheck`, and `archctx docs plan` reporting P2 selectors `2/2` for `capability.architecture-context`
> **Rollback Surface**: one commit touching `packages/local-runtime/runtime-daemon/src/index.ts` and `.archcontext/model/flows/flow.architecture-context.projection-render.yaml`
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260818-1224-daemon-projection-symbol-collision.contract.md`
> **Task Review**: `tasks/reviews/20260818-1224-daemon-projection-symbol-collision.review.md`
> **Implementation Notes**: `tasks/notes/20260818-1224-daemon-projection-symbol-collision.notes.md`

## Agentic Routing
- Selected route: single contract worktree, no delegation
- Routing reason: the change is two deletions and two call-site rewrites in one file, plus one model file; the cost is in verification, not in authoring
- Due diligence:
  - P1 map: `packages/local-runtime/runtime-daemon/src/index.ts` owns both the `ArchctxDaemon` class (`:922`) and the module-level projection helpers (`:6638`, `:6684`). The CodeGraph selector index resolves declared `source.entrypoints[].symbols[].name` against this file; `packages/core/projection-engine` consumes the resolved evidence as `selectorEvidence` and refuses to draw an unproven P2. The architecture model in `.archcontext/model/` is the authority for what is declared. Out of scope: the projection engine, the CLI surface, and the stamp lifecycle — all landed in `fa0a165`.
  - P2 trace: `completeTask` (`:2340`) calls `this.completeTaskProjectionDrift(root)` (`:2375`) → private method (`:2398`) → module-level `completeTaskProjectionDrift` (`:6638`) → `renderArchitectureDocumentationProjection` (`:6647`). The flow declares `entrypoint.architecture-context.daemon :: completeTaskProjectionDrift :: sink.architecture-context.render-daemon`. The selector resolves the name to the private method at `:2398`, which reaches the renderer only through one more hop, so the evidence is reported `selector-evidence-unmatched` and P2 falls back to `human-action-required`. The pressure point is the duplicated name, not the declaration.
  - P3 decision rationale: the private methods carry no behaviour — each is a one-line delegate with a single caller, no override, no test seam (verified: no subclass of `ArchctxDaemon`, no test references either name). They exist as incidental indirection. Renaming them would preserve an indirection that earns nothing while still costing a symbol; deleting them removes the collision at its source. `completeTaskProjectionFreshness` has the identical shape and is fixed in the same pass, because a class-of-bug fixed on one instance leaves the other to resurface.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260818-1224-daemon-projection-symbol-collision.md`
- Sprint contract: `tasks/contracts/20260818-1224-daemon-projection-symbol-collision.contract.md`
- Sprint review: `tasks/reviews/20260818-1224-daemon-projection-symbol-collision.review.md`
- Implementation notes: `tasks/notes/20260818-1224-daemon-projection-symbol-collision.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260818-1224-daemon-projection-symbol-collision.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260818-1224-daemon-projection-symbol-collision.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260818-1224-daemon-projection-symbol-collision.md`.

## Approach
### Strategy
Delete the two private delegate methods and call the module-level functions directly from `completeTask`. Then restore the daemon step in `flow.architecture-context.projection-render` through a ChangeSet, re-project, and require P2 to report selectors `2/2`.

### Trade-offs
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Delete the private delegates | Removes the collision at its source; two fewer symbols; no indirection left to re-collide | Touches `completeTask`'s call sites | **Chosen** — the delegates have no behaviour, one caller each, and no seam |
| Rename the private delegates | Smallest possible diff | Keeps indirection that earns nothing, and leaves a name a future edit can collide with again | Rejected |
| Rename the module-level functions | Also resolves the collision | The module functions are the ones the model declares; renaming them churns the model declaration too | Rejected |
| Leave it and drop the daemon step permanently | No code change | The daemon trigger is a real architectural fact; leaving it undeclared makes the model quietly incomplete | Rejected |

## Detailed Design
### File Changes
| File | Action | Description |
|------|--------|-------------|
| `packages/local-runtime/runtime-daemon/src/index.ts` | modify | Delete the private `completeTaskProjectionDrift` and `completeTaskProjectionFreshness` delegates (`:2398`–`:2404`); call the module-level functions directly at `:2375`–`:2376` |
| `.archcontext/model/flows/flow.architecture-context.projection-render.yaml` | modify (ChangeSet) | Restore the `render-from-daemon` step with `sourceSymbol: completeTaskProjectionDrift` |
| `docs/architecture/**` | regenerate | Re-projection output; not hand-edited |

### Code Snippets
```ts
// before
const projectionDrift = this.completeTaskProjectionDrift(session.workspace.root);
const projectionFreshness = this.completeTaskProjectionFreshness(session.workspace.root);

// after
const projectionDrift = completeTaskProjectionDrift(session.workspace.root);
const projectionFreshness = completeTaskProjectionFreshness(session.workspace.root);
```

### Data Flow
Unchanged. Both call sites already resolve to the module-level functions; this removes one hop and the shadowing name.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| A hidden caller or subclass depends on the private methods | Low | Build break | Verified absent before planning (`rg` across `packages/`: two call sites, no subclass, no test reference); `bun run typecheck` catches any miss |
| The selector still fails to match after the collision is removed | Medium | The daemon step goes back to unprovable | Acceptance requires `selectors 2/2` in the rendered document, not a code review opinion; if it still fails, revert the flow step and record why |
| CodeGraph index lag reports a stale match | Medium | False pass or false fail | Re-run `archctx docs plan` after the index settles; compare against the file's current symbol table |

## Task Contracts
- Contract file: `tasks/contracts/20260818-1224-daemon-projection-symbol-collision.contract.md`
- Review file: `tasks/reviews/20260818-1224-daemon-projection-symbol-collision.review.md`
- Implementation notes file: `tasks/notes/20260818-1224-daemon-projection-symbol-collision.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260818-1224-daemon-projection-symbol-collision.contract.md --strict`
- Active plan rule: `.ai/harness/active-plan` is authoritative for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: one commit — the daemon deletion plus the restored flow step and its re-projection
- **Rollback surface**: `git revert` of that single commit; no data migration, no persisted state
- **Verification boundary**: `bun test`, `bun run typecheck`, and the rendered `## 2. P2` section reporting `Proof: proven` with `selectors 2/2`
- **Review/acceptance boundary**: the rendered document, not the diff — the claim is that the evidence now resolves
- **High-risk surface**: none; the daemon's runtime behaviour is unchanged by construction
- **Why not checklist row**: it changes what the architecture model asserts about the daemon, which is a declaration boundary rather than a mechanical edit

## Evidence Contract

- **State/progress path**: `.ai/harness/checks/latest.json`
- **Verification evidence**: `bun test` summary, `bun run typecheck` exit code, and the `## 2. P2` block of `docs/architecture/modules/capability-architecture-context.md`
- **Evaluator rubric**: P2 reports `proven` with `selectors 2/2`; `bun test` reports 0 failures; `bun run typecheck` exits 0
- **Stop condition**: if the selector still reports `selector-evidence-unmatched` after the collision is removed, stop and report — do not adjust the declaration to make the diagram appear
- **Rollback surface**: single-commit revert

## Annotations

None outstanding. The one open question — whether removing the collision is
sufficient for the selector to resolve — is not answerable by review; it is
recorded as the acceptance rubric and the stop condition instead.

## Task Breakdown
- [ ] Delete the two private delegates and rewrite the `completeTask` call sites
- [ ] `bun run typecheck` and `bun test` green
- [ ] Restore the `render-from-daemon` flow step through a ChangeSet
- [ ] Re-project and confirm P2 reports `proven` with `selectors 2/2`
