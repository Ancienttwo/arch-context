# Plan: Audit residuals 108 111 113 117 remediation

> **Status**: Ready for review
> **Created**: 20260902-2222
> **Slug**: audit-residuals-108-117-remediation
> **Artifact Level**: work-package
> **Promotion Reason**: Current origin/main reproduces the three release-blocking residuals from the external audit; the existing green suite lacks the exact negative controls.
> **Verification Boundary**: Red-green focused regressions for #108/#113/#117, affected package suites, root typecheck/test, and strict task workflow.
> **Rollback Surface**: Developer Review cleanup RPC shape, runtime landscape startup/removal persistence, GitHub issue secret preflight, and their tests.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260902-2222-audit-residuals-108-117-remediation.contract.md`
> **Task Review**: `tasks/reviews/20260902-2222-audit-residuals-108-117-remediation.review.md`
> **Implementation Notes**: `tasks/notes/20260902-2222-audit-residuals-108-117-remediation.notes.md`

## Agentic Routing
- Selected route: main-thread regression-first implementation in an isolated worktree.
- Routing reason: the user explicitly authorized execution; the four surfaces share one runtime contract and need one integrator to preserve authority and transaction ordering.
- Due diligence:
  - P1 map: runtime-daemon owns Developer Review lifecycle and live landscape; local-store-sqlite owns durable sessions/landscape; github-issue-executor owns outbound DLP; changeset-engine owns Context7 no-follow writes.
  - P2 trace: authenticated cleanup RPC -> decoder -> daemon cleanup -> filesystem deletion; daemon start -> session restore -> repoRemove -> SQLite; audit approve -> secret preflight -> gh; docs pin -> Context7 lock read -> no-follow writer.
  - P3 decision rationale: make persisted daemon state, not caller manifests, the cleanup authority; restore the single local landscape and commit repo removal atomically; use explicit credential value shapes; retain #111's same-UID concurrent-swap limitation unless a cross-platform descriptor-relative primitive exists rather than claiming a false guarantee.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260902-2222-audit-residuals-108-117-remediation.md`
- Sprint contract: `tasks/contracts/20260902-2222-audit-residuals-108-117-remediation.contract.md`
- Sprint review: `tasks/reviews/20260902-2222-audit-residuals-108-117-remediation.review.md`
- Implementation notes: `tasks/notes/20260902-2222-audit-residuals-108-117-remediation.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260902-2222-audit-residuals-108-117-remediation.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260902-2222-audit-residuals-108-117-remediation.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260902-2222-audit-residuals-108-117-remediation.md`.

## Approach
### Strategy
1. Add exact negative controls that reproduce the three blockers on origin/main.
2. Narrow cleanup RPC to `{ repositoryRoot, challengeId, runId }` and load/validate daemon-owned manifest plus lock before deletion.
3. Restore `landscape.local` at startup and add one atomic store operation for session deletion plus landscape save.
4. Replace ambiguous GitHub/Bearer regexes with explicit prefix and authorization-context detectors.
5. Re-evaluate #111 against Node/Bun cross-platform filesystem primitives; do not introduce a heuristic or availability-breaking helper.

### Trade-offs
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Keep full cleanup manifest on RPC | Minimal diff | Caller remains an authority over deletion metadata | Reject |
| Identity-only cleanup with disk readback | One daemon authority; crash recovery remains possible | Requires client/RPC shape change | Adopt |
| Restore landscape only | Fixes restart order | Still allows partial durable removal | Reject |
| Atomic store removal projection | Restores restart semantics and failure atomicity | Adds one store port method | Adopt |
| Heuristic rechecks for #111 | Narrows race | Still writes through pathnames and cannot prove no-follow | Reject as false closure |

## Detailed Design
### File Changes
| File | Action | Description |
|------|--------|-------------|
| `packages/local-runtime/runtime-daemon/src/index.ts` | modify | Identity-only cleanup RPC, disk authority validation, landscape restore, atomic removal call. |
| `packages/local-runtime/runtime-daemon/src/github-issue-executor.ts` | modify | Explicit GitHub token prefixes and Authorization-context Bearer detector. |
| `packages/local-runtime/local-store-sqlite/src/index.ts` | modify | Transactional session delete + landscape save port. |
| `packages/local-runtime/local-store-sqlite/test/factories.ts` | modify | In-memory projection of the atomic port for daemon tests. |
| `packages/local-runtime/runtime-daemon/test/local-runtime.test.ts` | modify | #108, #113, #117 red-green regressions and call-site updates. |
| `packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts` | modify | SQLite atomic removal persistence/readback. |
| `packages/surfaces/cli/src/main.ts` | modify | Pass cleanup identity rather than a path-bearing manifest. |
| `scripts/fg3-negative-identity-matrix.ts` | modify | Use the daemon-owned in-process cleanup entrypoint in the existing negative matrix. |
| `plans/`, `tasks/` | modify | File-backed execution, evidence, and bounded #111 residual. |

### Code Snippets
### Data Flow
`cleanup identity -> fixed state directory -> persisted manifest + lock validation -> owned target derivation -> cleanup`.

`daemon start -> read landscape.local -> validate -> restore sessions -> repoRemove computes next landscape -> one SQLite transaction -> in-memory commit`.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Cleanup cannot recover a partially missing control pair | Low | Stale local state | Fail closed and leave recovery evidence; never guess authority. |
| Landscape/session transaction changes test doubles | Medium | Compile/test break | Update the sole RuntimeLocalStore test implementation and add port tests. |
| Secret detector regains prose false positives | Medium | Audit publish blocked | Positive benign-prose matrix plus value-shaped negatives. |
| #111 overclaimed | High if described as absolute | Security contract drift | Preserve conditional status unless descriptor-relative cross-platform proof exists. |

## Task Contracts
- Contract file: `tasks/contracts/20260902-2222-audit-residuals-108-117-remediation.contract.md`
- Review file: `tasks/reviews/20260902-2222-audit-residuals-108-117-remediation.review.md`
- Implementation notes file: `tasks/notes/20260902-2222-audit-residuals-108-117-remediation.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260902-2222-audit-residuals-108-117-remediation.contract.md --strict`
- Active plan rule: `.ai/harness/active-plan` is authoritative for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: one bounded source candidate for audit residuals #108/#113/#117 plus exact tests.
- **Rollback surface**: revert the candidate commit; no migration or external state mutation.
- **Verification boundary**: affected suites, root gates, strict workflow, and exact negative-control readback.
- **Review/acceptance boundary**: local source evidence only; no push, PR, publish, or release authorization.
- **High-risk surface**: filesystem deletion, SQLite durability, outbound credential DLP.
- **Why not checklist row**: three live security/durability defects cross package and RPC boundaries.

## Evidence Contract

- **State/progress path**: this plan, its task contract, notes, review, and `.ai/harness/checks/latest.json`.
- **Verification evidence**: captured pre-fix failures and post-fix command output.
- **Evaluator rubric**: exact attached acceptance triggers must invert red to green without widening product semantics.
- **Stop condition**: after three fix/reverify rounds per issue, or if #111 requires a new native distribution contract.
- **Rollback surface**: source and tests listed above.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] Capture #108/#113/#117 pre-fix negative controls.
- [x] Implement Developer Review persisted cleanup authority and identity-only RPC.
- [x] Implement landscape startup hydration and atomic repository removal persistence.
- [x] Implement value-shaped GitHub/Bearer credential detection.
- [x] Reassess #111 without a compatibility or heuristic fallback; record the bounded result.
- [x] Run focused and root verification, then synchronize task evidence.
