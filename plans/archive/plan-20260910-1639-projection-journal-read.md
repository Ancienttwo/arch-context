> **Archived**: 2026-09-10 18:32
> **Related Plan**: plans/archive/plan-20260910-1639-projection-journal-read.md
> **Outcome**: Completed
> **Lifecycle**: plan
> **Parent Run ID**: run-20260910-1832
> **Archive Projection V1**: `plans/plan-20260910-1639-projection-journal-read.md` => `plans/archive/plan-20260910-1639-projection-journal-read.md`
> **Archive Projection V1**: `tasks/notes/20260910-1639-projection-journal-read.notes.md` => `tasks/archive/notes-20260910-1832-projection-journal-read.md`
> **Archive Projection V1**: `tasks/contracts/20260910-1639-projection-journal-read.contract.md` => `tasks/archive/contract-20260910-1832-projection-journal-read.md`
> **Archive Projection V1**: `tasks/reviews/20260910-1639-projection-journal-read.review.md` => `tasks/archive/review-20260910-1832-projection-journal-read.md`

# Plan: Avoid workspace hashing for prior projection journal reads

> **Status**: Archived
> **Substantive Change SHA256**: `sha256:56263e1bf0dca8966a4d0d96d877bf3ff648a29efb706566eaead17b514f9290`
> **Created**: 20260910-1639
> **Slug**: projection-journal-read
> **Planning Source**: waza-think
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: verification_boundary
> **Verification Boundary**: Historical journal reads stay independent of workspace bytes; real daemon SQLite replay tests and packaged Node check
> **Rollback Surface**: Revert the bounded runtime/test diff; no schema or runtime evidence migration
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/archive/contract-20260910-1832-projection-journal-read.md`
> **Task Review**: `tasks/archive/review-20260910-1832-projection-journal-read.md`
> **Implementation Notes**: `tasks/archive/notes-20260910-1832-projection-journal-read.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from waza-think planning output.
- Source ref: (none)
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/archive/plan-20260910-1639-projection-journal-read.md`
- Sprint contract: `tasks/archive/contract-20260910-1832-projection-journal-read.md`
- Sprint review: `tasks/archive/review-20260910-1832-projection-journal-read.md`
- Implementation notes: `tasks/archive/notes-20260910-1832-projection-journal-read.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/archive/contract-20260910-1832-projection-journal-read.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/archive/plan-20260910-1639-projection-journal-read.md` and may start `repo-harness run contract-worktree start --plan plans/archive/plan-20260910-1639-projection-journal-read.md`.

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
- Contract file: `tasks/archive/contract-20260910-1832-projection-journal-read.md`
- Review file: `tasks/archive/review-20260910-1832-projection-journal-read.md`
- Implementation notes file: `tasks/archive/notes-20260910-1832-projection-journal-read.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/archive/contract-20260910-1832-projection-journal-read.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/archive/plan-20260910-1639-projection-journal-read.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Revert the bounded runtime/test diff; no schema or runtime evidence migration
- **Verification boundary**: Historical journal reads stay independent of workspace bytes; real daemon SQLite replay tests and packaged Node check
- **Review/acceptance boundary**: `tasks/archive/review-20260910-1832-projection-journal-read.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: verification_boundary

## Evidence Contract

- **State/progress path**: `plans/archive/plan-20260910-1639-projection-journal-read.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/archive/contract-20260910-1832-projection-journal-read.md`, `tasks/archive/review-20260910-1832-projection-journal-read.md`, and `tasks/archive/notes-20260910-1832-projection-journal-read.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/archive/review-20260910-1832-projection-journal-read.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Revert the bounded runtime/test diff; no schema or runtime evidence migration

## Captured Planning Output

## Scope

Fix the approved repo-harness projection timeout in archctx's prior-committed-apply journal lookup. The source baseline is origin/main e4a3a56640155bf9889b2dbb02754774035493b4 (0.5.9). Preserve the dirty primary checkout; execute in codex/projection-journal-read.

P1: runtime-daemon listProjectionPriorCommittedApplies owns the RPC boundary; SqliteLocalStore listCommittedChangeSetsForTaskSession owns canonical-root/task-session filtering and receipt data. Existing tests/projection-prior-committed-applies.test.ts owns replay/dedup/RPC verification.
P2: projection run calls list prior applies before projection construction. It currently calls openSession -> bindRepository -> full generic worktree digest before the journal SELECT. In repo-harness this unnecessarily reads 31.2 GiB of ignored runtime evidence. A live daemon sample during the RPC shows file reads/SHA-256; the bounded check times out before snapshot creation.
P3: Remove only the unnecessary openSession call from this historical journal read. Keep assertRunning, canonical root/task session filtering, error envelopes and deduplication. Do not change generic digest semantics, provider timeouts, snapshot/worktree preconditions of actual writes, or installed dependencies by hand. At 10x source/runtime size this read must remain independent of the source tree. Its remaining cost is the journal query.

Owned paths: packages/local-runtime/runtime-daemon/src/index.ts; tests/projection-prior-committed-applies.test.ts; docs/researches/20260910-projection-journal-read.md; canonical plan/contract/review/notes for this slice.

## Verification

A real daemon/SQLite regression must prove a historical journal read returns its response without creating a snapshot or repository session; observe it fail before changing production code. Existing replay, deduplication, RPC and task/root isolation tests must continue to pass.
Run bun test tests/projection-prior-committed-applies.test.ts --timeout 60000; bun run typecheck; bun run check:package-boundaries. Build the package through the existing packaged CLI builder and perform a real Node runtime journal read against the target repository with an isolated runtime store. Preserve prior browser test evidence; no full-suite or public release is requested.

## Task Breakdown

- [x] Add and run the regression on unchanged runtime source.
- [x] Remove session initialization from the journal read and run focused verification.
- [x] Record source/package/runtime evidence and the remaining consumer release boundary.


## Acceptance status

Implementation and local package proof complete. The declared strict verification preparation passed in run run-20260910T171526-31882-20260910-1639-projection-journal-read (3 exact checks). Evidence-event emission reported contract_not_committed, so the ignored latest read model was not materialized. The official semantic AcceptanceReceipt and workflow close remain pending; no receipt is invented. The consumer release is outside this approval.

## Approved 0.5.10 publication

The user approved archctx 0.5.10 on 2026-09-10. Extend this same bounded work-package through version synchronization, package verification, required PR CI, npm publication of archctx-contracts and archctx, registry readback, and the separate repo-harness 0.19.0 dependency update. Preserve the one-method journal fix and its regression; no digest, timeout, schema, or cloud behavior changes.

- [ ] Synchronize 0.5.10 release version surfaces and deterministic generated readbacks.
- [ ] Verify targeted journal behavior, package contracts, tarball/runtime and required CI.
- [ ] Publish both packages, verify registry bytes and release provenance.

The prior local package evidence is a 0.5.9 fixture baseline only. New 0.5.10 evidence must bind the actual candidate. npm login currently needs restoration (E401); no public or installed success is claimed.

## Published release closeout

`archctx@0.5.10` and `archctx-contracts@0.5.10` are published through npm Web Auth. The source PR passed all ten CI jobs and merged at dc4fcc3d9ee7e70f66654d934f50a55f30381cf2; tag v0.5.10 points there. Registry tarball digests and a fresh Node 24 installation match the tested artifacts. Full details are promoted to docs/verification/archctx-0.5.10-release.json and the personal install guide. This archive records the completed implementation and publication; existing shared MCP hosts have not been restarted.

> **Substantive Change SHA256**: `sha256:ca305a9b77f634eafbe171902427c94635956f3a1c6ea6bcdc620415079379cd`
