# Plan: Close #111 with descriptor-relative no-follow writes

> **Status**: Executing
> **Created**: 20260903-0008
> **Slug**: fix-111-descriptor-relative
> **Planning Source**: codex-plan
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: User approved closing the remaining same-UID TOCTOU security boundary as a separately reviewable work-package.
> **Verification Boundary**: Focused adversarial tests, typecheck, packaged CLI smoke, full bun run verify, strict task workflow and contract verification, followed by exact-SHA hosted Verify.
> **Rollback Surface**: Revert the single merged work-package; preserve the dirty primary checkout and remove only the isolated branch/worktree after merge.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260903-0008-fix-111-descriptor-relative.contract.md`
> **Task Review**: `tasks/reviews/20260903-0008-fix-111-descriptor-relative.review.md`
> **Implementation Notes**: `tasks/notes/20260903-0008-fix-111-descriptor-relative.notes.md`

## Agentic Routing
- Selected route: security-hardening
- Routing reason: Captured from codex-plan planning output.
- Source ref: (none)
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260903-0008-fix-111-descriptor-relative.md`
- Sprint contract: `tasks/contracts/20260903-0008-fix-111-descriptor-relative.contract.md`
- Sprint review: `tasks/reviews/20260903-0008-fix-111-descriptor-relative.review.md`
- Implementation notes: `tasks/notes/20260903-0008-fix-111-descriptor-relative.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260903-0008-fix-111-descriptor-relative.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260903-0008-fix-111-descriptor-relative.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260903-0008-fix-111-descriptor-relative.md`.

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
- Contract file: `tasks/contracts/20260903-0008-fix-111-descriptor-relative.contract.md`
- Review file: `tasks/reviews/20260903-0008-fix-111-descriptor-relative.review.md`
- Implementation notes file: `tasks/notes/20260903-0008-fix-111-descriptor-relative.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260903-0008-fix-111-descriptor-relative.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260903-0008-fix-111-descriptor-relative.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Revert the single merged work-package; preserve the dirty primary checkout and remove only the isolated branch/worktree after merge.
- **Verification boundary**: Focused adversarial tests, typecheck, packaged CLI smoke, full bun run verify, strict task workflow and contract verification, followed by exact-SHA hosted Verify.
- **Review/acceptance boundary**: `tasks/reviews/20260903-0008-fix-111-descriptor-relative.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: User approved closing the remaining same-UID TOCTOU security boundary as a separately reviewable work-package.

## Evidence Contract

- **State/progress path**: `plans/plan-20260903-0008-fix-111-descriptor-relative.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260903-0008-fix-111-descriptor-relative.contract.md`, `tasks/reviews/20260903-0008-fix-111-descriptor-relative.review.md`, and `tasks/notes/20260903-0008-fix-111-descriptor-relative.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260903-0008-fix-111-descriptor-relative.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Revert the single merged work-package; preserve the dirty primary checkout and remove only the isolated branch/worktree after merge.

## Captured Planning Output

## Goal and success criteria

Close audit residual #111 for the same-UID concurrent parent-directory replacement threat. A repository-controlled parent path replaced by a symlink after validation must never redirect the Context7 lockfile write outside the trusted repository root.

Success requires:

- The commit operation resolves and mutates the destination relative to verified directory handles, not full pathnames.
- Existing expected-hash, private-mode, atomic replace, file durability, and directory durability behavior remains intact.
- Static and dangling symlinks still fail closed.
- A deterministic adversarial test replaces a verified parent with an outside-pointing symlink at the former TOCTOU pressure point and proves the outside target is unchanged.
- The packaged one-product CLI installs and runs with the native filesystem dependency on supported Linux, macOS, and Windows CI runners.
- Focused tests, typecheck, package smoke, full `bun run verify`, strict task workflow, contract verification, and GitHub hosted Verify all pass for the exact accepted commit.

## P1 Architecture map

- Product authority: `docs/spec.md` and the existing audit residual notes.
- Mutation boundary: `packages/core/changeset-engine/src/index.ts`.
- Runtime consumer: `packages/local-runtime/runtime-daemon/src/index.ts` through the Context7 pin lockfile path.
- Release projection: `scripts/local-product-tarball-smoke.mjs` and the root/core package manifests.
- Verification surfaces: changeset-engine tests, runtime-daemon tests, package smoke, and the hosted Linux/macOS/Windows Node matrix.
- Out of scope: unrelated ChangeSet writes, #108/#113/#117 already closed on main, release publication, deployment, and the dirty primary checkout.

## P2 Concrete trace

Input begins as an approved Context7 pin operation with repository root, relative lockfile path, expected content hash, body, and mode. The daemon calls `writeFileWithoutFollowingSymlinks`. Current code validates segments by pathname, creates a sibling temp by pathname, renames it by pathname, and fsyncs the directory. A same-UID process can replace the validated parent with a symlink between the last `lstat` and temp creation, redirecting both temp and destination outside the repository. The pressure point is the first pathname syscall after the last segment check.

The corrected trace validates containment, opens/traverses the trusted root and each parent without following symlinks, computes the precondition from the destination reached through that parent authority, creates/writes/fsyncs a temp in the same verified directory, atomically replaces the destination through that directory authority, and fsyncs the directory. Any unsafe segment or changed precondition aborts before commit; temporary artifacts are removed through the same authority.

## P3 Decision rationale

Use one native filesystem boundary exposed to TypeScript through a maintained Node FFI/runtime dependency. POSIX uses descriptor-relative operations (`openat`, `renameat`, `unlinkat`) and `O_NOFOLLOW` directory traversal. Windows pins and validates directory handles without following reparse points, then commits within the pinned parent using handle-based Win32 operations. This is the smallest coherent cross-platform change because Node/Bun do not expose the required complete descriptor-relative API and further pathname rechecks cannot close the race.

The invariant is that a repository pathname may select a directory only while it is being opened and verified; after that point, it cannot become write authority. At 10x scale the first pressure is FFI call overhead and platform flag maintenance, not data correctness; the operation is rare and security-sensitive, so correctness dominates.

No compatibility fallback is allowed. Unsupported platforms, missing native runtime, unexpected file kinds, reparse points, or unavailable required syscalls fail closed with a clear error.

## Planned file changes

- `packages/core/changeset-engine/src/index.ts`: route no-follow writes through the native authority while preserving the public request contract.
- `packages/core/changeset-engine/src/descriptor-relative-write.ts`: implement the platform-specific native boundary and a test-only synchronization seam that cannot alter production semantics.
- `packages/core/changeset-engine/test/changeset-engine.test.ts`: add deterministic concurrent parent replacement coverage and preserve existing regression cases.
- `packages/core/package.json`, `bun.lock`: declare and lock the native runtime dependency.
- `scripts/local-product-tarball-smoke.mjs`: externalize and declare the native dependency in the one-product package, and assert it is present.
- Workflow plan/contract/review/notes artifacts: record scope and exact evidence.

## Verification and rollback

Run focused changeset-engine tests first, then `bun run typecheck`, packaged CLI smoke, `bun run verify`, `repo-harness run check-task-workflow --strict`, and strict contract verification. Push only the accepted branch, open a PR, require hosted Verify success for the exact head SHA, merge, verify remote main ancestry, then delete the remote branch and remove the isolated worktree/local branch. Rollback is a revert of the single merged work-package; the primary dirty checkout is never modified.

## Task Breakdown

- [x] Define and implement the descriptor-relative no-follow write authority on POSIX and Windows.
- [x] Replace the pathname commit path while preserving expected-hash, atomicity, mode, and durability semantics.
- [x] Add deterministic same-UID parent-replacement adversarial tests plus packaging assertions.
- [x] Run focused, typecheck, package, full verification, workflow, and strict contract gates.
- [ ] Record review and implementation evidence, commit, push, open PR, and require exact-SHA hosted Verify.
- [ ] Merge the accepted PR and clean the isolated local and remote branches without touching primary WIP.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [ ] Define and implement the descriptor-relative no-follow write authority on POSIX and Windows.
- [ ] Replace the pathname commit path while preserving expected-hash, atomicity, mode, and durability semantics.
- [ ] Add deterministic same-UID parent-replacement adversarial tests plus packaging assertions.
- [ ] Run focused, typecheck, package, full verification, workflow, and strict contract gates.
- [ ] Record review and implementation evidence, commit, push, open PR, and require exact-SHA hosted Verify.
- [ ] Merge the accepted PR and clean the isolated local and remote branches without touching primary WIP.
