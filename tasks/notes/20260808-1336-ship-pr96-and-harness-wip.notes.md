# Implementation Notes: ship-pr96-and-harness-wip

> **Status**: Complete
> **Plan**: plans/plan-20260808-1336-ship-pr96-and-harness-wip.md
> **Contract**: tasks/contracts/20260808-1336-ship-pr96-and-harness-wip.contract.md
> **Review**: tasks/reviews/20260808-1336-ship-pr96-and-harness-wip.review.md
> **Last Updated**: 2026-08-08 13:36
> **Lifecycle**: notes

## Design Decisions

- PR #96 was merged first so the capability-doc projection remains its own
  reviewable unit; the repo-harness refresh is a second PR based on merge commit
  `06d3b4957813e87775765061dc642ce50447aac0`.
- The generated `.gitignore` block remains byte-for-byte repo-harness-owned.
  A repo-local block after `# END: repo-harness generated-runtime` re-includes
  `.archcontext/**` and ignores only `.archcontext/.local/`, preserving the
  Architecture Ledger Contract without forking generated content.
- Ignored runtime directories and evidence remain local. They are neither
  staged nor removed; only the audited 25 tracked refresh files are published.

## Deviations From Plan Or Spec

- The source refresh commit was cherry-picked into the contract-owned worktree
  instead of rebasing the original staging branch in place. This preserves the
  already-audited commit while making the final branch start at merged `main`.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Edit the generated ignore block | Rejected | A later init would overwrite it and could hide Git-visible architecture truth. |
| Keep a post-managed repo override | Selected | It is explicit, stable across regeneration, and limits runtime ignore to `.local/`. |
| Commit local runtime evidence | Rejected | Checks, runs, handoff, state, and `_ops` are machine-local operational state. |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`

## Verification Evidence

- `repo-harness init --target both --mode standard --dry-run --json`:
  `104` operations skipped, `plannedTotal: 0`, `failedTotal: 0` after creating
  the worktree-local ignored runtime skeleton.
- `git diff --check`, `bash -n .ai/hooks/lib/workflow-state.sh`,
  `bun run check:context-files`, `bun run check:task-sync`,
  `bun run check:architecture-sync`, and strict `bun run check:task-workflow`:
  all passed.
- `bun run verify`: exit `0`; typecheck, package boundary, production adapter,
  full Bun tests, packaged CLI, privacy/security/governance readbacks, acceptance
  ledgers, sprint status, and all representative eval thresholds passed.
- Diff against `origin/main`: 30 files = 25 audited refresh files plus five
  work-package artifacts; no product source, ledger model, or runtime database.

## Remote Ship Evidence

- PR #97 merged at `2026-08-08T06:02:11Z` as
  `573fa10cc2a8d588a532aa2c143bcd59607192d6`.
- Required CI passed: Governance Verify plus Node 24/25 on Ubuntu, macOS, and
  Windows. The Developer Review integration was neutral/skipped, not failed.
- `origin/main` and the primary checkout both resolve to the PR #97 merge
  commit; head `48a8da5dd877bc6951fe975bb7765405f5b66462` is an ancestor.
- Merged PR #96/#97 branches and their clean worktrees were removed. The
  unrelated `audit/native-pending-run` worktree remains untouched.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
