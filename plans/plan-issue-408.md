# Issue 408: Ordered layers and evaluated dependency direction

Status: Review

## Authorization

The user explicitly requested parallel implementation of issues #402, #407, #408 and #409 on 2026-10-26. This isolated lane implements #408. Baseline: `0e08d30cb9e3daf87730a7126ca9b785d7663f72`.

On 2026-10-27 the user approved completing #411's missing daemon-free constraint query, GitHub CI verification, merge and #408 closure. The repair starts from `c1938df4` with main `4a562d54` merged; unrelated local work and #412 are outside this slice.

## Task Breakdown

- [x] Implement ordered layers, evaluated direction constraints and explicit unknown/error states.
- [x] Add focused regressions and run affected tests and typecheck.
- [x] Expose `archctx constraints check --json` through the existing read-only evaluator, rejecting invalid declarations and preserving unknown code-facts coverage.
- [x] Exercise the real CLI with an actual CodeGraph index for violations, a passing direction, missing evidence, invalid declarations, and absence of daemon/runtime writes.
- [x] Independently review and repair findings; check shared-interface composition.
- [ ] Update #411, pass GitHub CI, merge the validated head and close #408.

## Boundaries

Full verification runs in GitHub CI. Local checks are limited to the new behavior and its regression guard. No release, deployment, services, secrets, permission expansion or user-data/model repair. Synthetic fixtures only. Preserve existing worktrees.

## Evidence and remaining gates

The isolated lane passed 36 focused tests (188 assertions), 74 contract/adapter
tests (235), 64 native tests (1558), 58 recovery tests (243) and the final pure
ledger validator regression (1 test, 4 assertions); these sets overlap.
Typecheck and whitespace checks passed. Independent review passed 37 tests (193
assertions) and four recovery tests (17), then identified the ledger metadata gap.
The final validator delta preserves `layerOrderErrors` and unrelated blocking
errors; its pure regression passed. Shared-interface composition is still pending.
Logs remain in the parent task directory as `issue408-*.log`.

The 2026-10-27 query repair adds five real CLI tests. They failed before the
command existed (0 pass / 5 fail), then passed (5 pass / 36 assertions), including
fresh actual imports, stale/missing evidence and read-only filesystem checks.
The read-only incremental review passed with no blocking findings and confirmed
that no existing assertions were removed or relaxed. Typecheck and full-platform
verification are delegated to GitHub CI for the final pushed candidate.

The optional order preserves existing layer behavior when absent. Rollback is a
code revert; any adopted manifest `model.layers` must first be removed through an
approved ChangeSet before using a runtime that cannot read it. No user model has
been migrated by this task.
