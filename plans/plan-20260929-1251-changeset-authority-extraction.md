# Plan: #238: move-only extraction of ChangeSet and MCP approval authority from the runtime daemon

> **Status**: Executing
> **Created**: 20260929-1251
> **Slug**: changeset-authority-extraction
> **Planning Source**: repo-harness-plan
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: User approved full #238 on 2026-09-28; prerequisite #247 merged, live proof #248
> **Verification Boundary**: Pinned Bun typecheck, boundary audit, daemon/mcp/cli/store/tests suites, DE predicates, Context7 scan, verbatim-move checker with negative control, full test, verify, dual-track security review, gatekeeper, hosted CI
> **Rollback Surface**: git revert; no data, wire or contract change
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260929-1251-changeset-authority-extraction.contract.md`
> **Task Review**: `tasks/reviews/20260929-1251-changeset-authority-extraction.review.md`
> **Implementation Notes**: `tasks/notes/20260929-1251-changeset-authority-extraction.notes.md`

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

- Active plan: `plans/plan-20260929-1251-changeset-authority-extraction.md`
- Sprint contract: `tasks/contracts/20260929-1251-changeset-authority-extraction.contract.md`
- Sprint review: `tasks/reviews/20260929-1251-changeset-authority-extraction.review.md`
- Implementation notes: `tasks/notes/20260929-1251-changeset-authority-extraction.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260929-1251-changeset-authority-extraction.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260929-1251-changeset-authority-extraction.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260929-1251-changeset-authority-extraction.md`.

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
- Contract file: `tasks/contracts/20260929-1251-changeset-authority-extraction.contract.md`
- Review file: `tasks/reviews/20260929-1251-changeset-authority-extraction.review.md`
- Implementation notes file: `tasks/notes/20260929-1251-changeset-authority-extraction.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260929-1251-changeset-authority-extraction.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260929-1251-changeset-authority-extraction.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: git revert; no data, wire or contract change
- **Verification boundary**: Pinned Bun typecheck, boundary audit, daemon/mcp/cli/store/tests suites, DE predicates, Context7 scan, verbatim-move checker with negative control, full test, verify, dual-track security review, gatekeeper, hosted CI
- **Review/acceptance boundary**: `tasks/reviews/20260929-1251-changeset-authority-extraction.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: User approved full #238 on 2026-09-28; prerequisite #247 merged, live proof #248

## Evidence Contract

- **State/progress path**: `plans/plan-20260929-1251-changeset-authority-extraction.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260929-1251-changeset-authority-extraction.contract.md`, `tasks/reviews/20260929-1251-changeset-authority-extraction.review.md`, and `tasks/notes/20260929-1251-changeset-authority-extraction.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260929-1251-changeset-authority-extraction.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: git revert; no data, wire or contract change

## Captured Planning Output

## Authority and goal

On 2026-09-28 the user approved doing #238 in full. Its prerequisite has landed: #247 (v2 committed-change acceptance) is merged, and #248 carries the live proof. This plan is #238 itself: a strictly move-only extraction of the ChangeSet plan/apply and MCP approval authority out of `packages/local-runtime/runtime-daemon/src/index.ts`, the `ArchContextRuntime` facade (2127 lines at `dadef1c`). A dual-track security review of the move is required.

## P1 architecture map

**Moves into a new `runtime-daemon/src/changeset-authority.ts` (`ChangeSetAuthorityService`):**
- State fields (index.ts:369-373):
  - `changesets`
  - `changeSetRoots`
  - `mcpChangeSets`
  - `mcpApprovals` (the one-time approval tokens)
  - `changeSetWorktreeDigestProfiles`
- Methods:
  - `planPracticeWaiver` (:780), which writes the draft maps
  - `planUpdate` (:849)
  - `approveMcpProjection` / `mcpProjection` (:988 / :1005)
  - `approveMcpUpdate` / `applyMcpUpdate` / `applyUpdate` (:1022-1062)
  - `applyAuthorizedUpdate` (:1070)
  - `appendAppliedChangeSetToArchitectureLedger` (:1160)
  - `acceptCommittedChange` (:1194)
- Module-level helpers used only by these methods:
  - `runtimeWorktreeDigest` (:1686)
  - `acceptedCommittedChangeScope` (:1724)
  - `safePracticeWaiverId` (:1790)
  - `architectureLedgerWriteAppendsEvents` (:1961)
  - the RuntimePlanUpdate / apply input decoders

  A helper that is also used by code staying in the facade must stay shared and be imported, not moved.
- #247's pure acceptance helpers already live in `committed-change-acceptance.ts` and stay where they are.

**Stays in the facade:**
- engine construction (a single ChangeSet engine instance, shared with ledger-admin)
- `withWriter` / the writer lock
- `openSession`
- `appendArchitectureEventsWithFeed`
- `projectionHost` and `projection`, which keep calling `this.planUpdate` / `this.applyUpdate`; a test monkeypatches `daemon.applyUpdate`
- `completeTask`
- `stop()`, which clears approvals only (drafts are not cleared today)

Precedent: `landscape.ts` (#239), `explorer-projection-service.ts` (#237), `practice-checkpoint.ts` (#236). In each, the facade builds the service with a callback/port dependency object and delegates in one line. Moved bodies keep their member names so they stay byte-identical.

## P2 concrete trace

These paths must behave exactly as today:
- CLI/RPC/MCP `plan_update` → facade delegate → service `planUpdate` → draft maps.
- `approve_mcp_update` → service mints a token into `mcpApprovals`. `apply_mcp_update` consumes it synchronously, before any async work, then goes to `applyAuthorizedUpdate` → `withWriter` (facade callback) → engine apply → the #247 transition hook → optional ledger append (facade `appendArchitectureEventsWithFeed`).
- `ledger accept-committed` → service `acceptCommittedChange` → `withWriter` → `committed-change-acceptance` helpers → append.

Behavioural invariants to preserve:
- token TTL, the combined 256-token cap, and scope/root/draft binding
- error codes
- envelope shapes

## P3 decision

Strictly move-only. The only allowed textual changes are:
- `private` modifiers on moved members that the facade now reaches through the service
- import lists
- constructor wiring
- one-line facade delegates
- `stop()` calling a service `clearApprovals()`

No behaviour change, no renames inside moved bodies, and no fixes. If a real defect turns up, it gets its own prior PR; it is not smuggled into the move.

Verbatim evidence:
- extract each moved symbol's text from `dadef1c` with the TypeScript compiler API and assert byte identity in the new file;
- assert that every facade delegate is exactly `return this.changeSetAuthority.X(...)`;
- classify every hunk in `index.ts`;
- run a negative control where a one-byte edit makes the checker fail.

At 10x the unbounded draft map is the existing pressure point. It is not fixed here.

## Allowed paths

- `packages/local-runtime/runtime-daemon/src/`
- `packages/local-runtime/runtime-daemon/test/`
- `scripts/` (only if a readback reads `index.ts` and must add the new file, as #237 did for DE readbacks)
- `tasks/todos.md`
- `tasks/notes/**`
- `plans/**`

## Verification boundary

Run with Bun 1.4.0:
- typecheck
- package-boundary audit
- the runtime-daemon, mcp-local, cli, local-store-sqlite and `tests/` suites
- DE predicates and the Context7 scan (they read daemon sources)
- the verbatim-move checker plus its negative control
- the full `bun test`
- `bun run verify`

Then the dual-track security review (Opus + Codex), gatekeeper, and hosted CI.

## Rollback surface

`git revert`. There are no data, wire or contract changes.

## Task Breakdown

- [x] Move-only extraction to `ChangeSetAuthorityService` with facade delegates, plus the verbatim-move evidence script output recorded in the notes.
- [x] Adjust any source-reading readbacks or tests that must now also read `changeset-authority.ts`.
- [x] Full verification, dual-track security review, gatekeeper, and PR closing #238.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] Move-only extraction to `ChangeSetAuthorityService` with facade delegates, plus the verbatim-move evidence script output recorded in the notes.
- [x] Adjust any source-reading readbacks or tests that must now also read `changeset-authority.ts`.
- [x] Full verification, dual-track security review, gatekeeper, and PR closing #238.
