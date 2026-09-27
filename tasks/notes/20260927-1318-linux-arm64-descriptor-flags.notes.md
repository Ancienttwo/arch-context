# Implementation Notes: linux-arm64-descriptor-flags

> **Status**: Active
> **Plan**: plans/plan-20260927-1318-linux-arm64-descriptor-flags.md
> **Contract**: tasks/contracts/20260927-1318-linux-arm64-descriptor-flags.contract.md
> **Review**: tasks/reviews/20260927-1318-linux-arm64-descriptor-flags.review.md
> **Last Updated**: 2026-09-27 13:18
> **Lifecycle**: notes

## Design Decisions

- Use `node:fs.constants.O_DIRECTORY` and `O_NOFOLLOW` only for Linux, where the numeric values differ between x86_64 and arm64. Keep the existing `O_CLOEXEC` value and Darwin/Windows paths unchanged.
- Fail closed if either platform-owned flag is unavailable; missing `O_NOFOLLOW` must never silently become a pathname-following write.
- Reuse the existing private-file/no-follow behavior suite as the regression guard and run it on a focused hosted Linux arm64 job instead of creating a test that merely asserts constants.

## Deviations From Plan Or Spec

- The first cold container install did not initialize CodeGraph; after adding that required setup, public 0.5.11 and the narrow tag-based 0.5.12 candidate passed while merged-main 0.5.12 still failed. `npm` also required `--allow-scripts=koffi` in Node 24 to install its native dependency. These setup corrections were applied equally across candidates.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Detect `process.arch` and choose literal flags | Rejected | Linux platform constants are the actual authority and cover future CPU variants without adding an architecture table. |
| Use `fs.constants` for the two architecture-varying flags | Selected | Preserves native no-follow semantics while letting Node supply the correct ABI values. |
| Add a full Linux arm64 verify matrix | Rejected | The existing changeset behavior suite is the smallest guard for this security-critical boundary. |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Red guard: `tasks/notes/20260927-1318-linux-arm64-descriptor-flags.pre-fix.txt`, `PRE_FIX_EXIT=1` on Linux arm64.
- Green guard and full suite: same test passed after the fix; 25/25 changeset tests passed in the same Linux arm64 container.
- Fixed source-built 0.5.12 tarball: `_ops/npm/linux-open-fixed/evidence.json` verified, `archctx-0.5.12.tgz` SHA-256 `354b683d122908305c45fcddff5a0c30e599480a18d97f4630f868d1e0001952` before final commit. Cold Node 24 Linux arm64 install/CLI/daemon/CodeGraph flow passed 7/7; no host build worktree was mounted.
- macOS pinned Bun 1.4.0 typecheck and 25 changeset tests passed. Full `bun run verify` exited 0 with 2,148 tests and configured evaluation verdict PASS.
- `repo-harness run verify-contract` passed 17/17 with pinned Bun on PATH after the guard and packaged smoke checks were configured.

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
